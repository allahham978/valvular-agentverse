import type { FitResult } from "@/contracts";
import { devHearts } from "@/lib/dev-hearts";
import { ToolError } from "./evidence";
import { applyChange, changedHearts, evaluate, evaluateOrThrow } from "./fit";
import type { z } from "zod";
import type { evaluateDesignInput, groupFailuresInput, inspectHeartInput, profileGroupInput, whatIfInput } from "./inputs";

export function evaluateDesignTool({ design, parent }: z.infer<typeof evaluateDesignInput>) {
  const { summary, results } = evaluateOrThrow(design, { parent });
  const changed = parent ? changedHearts(evaluateOrThrow(parent).results, results) : [];
  return { ...summary, changed };
}

const band = (value: number) => `${Math.floor(value / 2) * 2}-${Math.floor(value / 2) * 2 + 2}`;

export function groupFailuresTool({ design, by, measure }: z.infer<typeof groupFailuresInput>) {
  const hearts = new Map(devHearts().map((heart) => [heart.id, heart]));
  const keysOf = (result: FitResult): string[] => {
    if (by === "rule") return result.reasons.map((reason) => reason.ruleId);
    if (by === "size") return [result.sizeMm === undefined ? "none" : String(result.sizeMm)];
    const value = hearts.get(result.heartId)?.measures[measure];
    if (value === undefined) throw new ToolError(400, `measure: no dev heart measure named ${measure}.`);
    return [band(value)];
  };

  const groups = new Map<string, FitResult[]>();
  for (const result of evaluateOrThrow(design).results.filter((r) => r.status !== "fit")) {
    for (const key of new Set(keysOf(result))) groups.set(key, [...(groups.get(key) ?? []), result]);
  }
  return {
    by,
    groups: [...groups]
      .map(([key, members]) => ({
        key,
        count: members.length,
        risk: members.filter((m) => m.status === "risk").length,
        noFit: members.filter((m) => m.status === "no-fit").length,
        heartIds: members.map((m) => m.heartId),
      }))
      .sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : 1)),
  };
}

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

export function profileGroupTool({ heartIds }: z.infer<typeof profileGroupInput>) {
  const hearts = devHearts();
  const ids = new Set(heartIds);
  const group = hearts.filter((heart) => ids.has(heart.id));
  const rest = hearts.filter((heart) => !ids.has(heart.id));
  if (rest.length === 0) throw new ToolError(400, "heartIds: the group must leave some dev hearts out to compare against.");

  const measures = Object.keys(hearts[0].measures).map((measure) => {
    const all = hearts.map((heart) => heart.measures[measure]);
    const average = mean(all);
    const sd = Math.sqrt(mean(all.map((value) => (value - average) ** 2)));
    const groupMean = mean(group.map((heart) => heart.measures[measure]));
    const restMean = mean(rest.map((heart) => heart.measures[measure]));
    const difference = groupMean - restMean;
    return { measure, groupMean, restMean, difference, effectSize: sd === 0 ? 0 : difference / sd };
  });
  measures.sort((a, b) => Math.abs(b.effectSize) - Math.abs(a.effectSize));
  return { groupSize: group.length, restSize: rest.length, measures };
}

export function inspectHeartTool({ heartId, design }: z.infer<typeof inspectHeartInput>) {
  const heart = devHearts().find((candidate) => candidate.id === heartId);
  if (!heart) throw new ToolError(400, `heartId: no dev heart ${heartId}.`);
  const [result] = evaluateOrThrow(design, { hearts: [heart] }).results;
  return { heartId, measures: heart.measures, status: result.status, sizeMm: result.sizeMm, reasons: result.reasons };
}

export function whatIfTool({ design, heartIds, change }: z.infer<typeof whatIfInput>) {
  const ids = new Set(heartIds);
  const hearts = devHearts().filter((heart) => ids.has(heart.id));
  const changed = applyChange(design, change);
  if ("reasons" in changed) return { valid: false, reasons: changed.reasons };

  const before = evaluateOrThrow(design, { hearts }).results;
  const afterEvaluation = evaluate(changed.design, { hearts });
  if (!afterEvaluation.ok) return { valid: false, reasons: afterEvaluation.reasons };
  const after = new Map(afterEvaluation.results.map((result) => [result.heartId, result.status]));
  const rows = before.map(({ heartId, status }) => {
    const next = after.get(heartId) ?? status;
    return { heartId, before: status, after: next, fixed: status !== "fit" && next === "fit" };
  });
  return { valid: true, hearts: rows, fixedCount: rows.filter((row) => row.fixed).length };
}
