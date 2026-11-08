import type { Heart } from "@/contracts";
import { defaultRules } from "@/engine";
import { strParam } from "@/engine/rules";
import { devHearts } from "@/lib/dev-hearts";
import type { z } from "zod";
import { ToolError } from "./evidence";
import { changedHearts, evaluateOrThrow } from "./fit";
import type { stressTestInput } from "./inputs";

const readMeasures = [
  ...new Set(defaultRules.rules.filter((rule) => typeof rule.params.measure === "string").map((rule) => strParam(rule, "measure"))),
];

const shiftMeasures = (hearts: Heart[], measures: string[], amount: number): Heart[] =>
  hearts.map((heart) => ({
    ...heart,
    measures: Object.fromEntries(
      Object.entries(heart.measures).map(([key, value]) => [key, measures.includes(key) ? value + amount : value]),
    ),
  }));

export function stressTestTool({ design, kind, amount = 0, hypothesis, disprovedIf, measure, heartIds }: z.infer<typeof stressTestInput>) {
  if (measure !== undefined && !readMeasures.includes(measure)) {
    throw new ToolError(400, `measure: expected one of ${readMeasures.join(", ")}.`);
  }
  const hearts = devHearts();
  const before = evaluateOrThrow(design);
  const after =
    kind === "measurement_shift"
      ? evaluateOrThrow(design, { hearts: shiftMeasures(hearts, measure ? [measure] : readMeasures, amount) })
      : kind === "assumption_shift"
        ? evaluateOrThrow(design, {
            rules: {
              ...defaultRules,
              rules: defaultRules.rules.map((rule) =>
                rule.kind === "frame-outflow"
                  ? { ...rule, params: { ...rule.params, offsetMm: Number(rule.params.offsetMm) + amount } }
                  : rule,
              ),
            },
          })
        : evaluateOrThrow(design, { hearts: hearts.filter((heart) => heartIds?.includes(heart.id)) });
  const changed = kind === "subgroup" ? [] : changedHearts(before.results, after.results);
  return {
    kind,
    amount,
    hypothesis,
    disprovedIf,
    total: before.summary.total,
    changedCount: changed.length,
    changed,
    before: before.summary,
    after: after.summary,
  };
}
