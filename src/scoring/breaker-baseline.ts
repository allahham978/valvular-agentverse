import { readFileSync } from "node:fs";
import path from "node:path";
import type { Design, Evidence, FitStatus } from "../contracts";
import { evaluateDesign, STARTING_VALVE } from "../engine";
import { devHearts } from "../lib/dev-hearts";
import { BREAKER_TOOLS, runBreaker } from "../agents/breaker";
import type { ModelClient } from "../agents/model-client";
import { defaultBudget } from "../orchestrator";
import type { ToolRegistry } from "../orchestrator/tools";
import { createAgentTools } from "../tools";

type Planted = { version: string; designs: { flawId: string; design: Design }[] };
type Step = { tool: string; args: Record<string, unknown> };
type Checklist = {
  version: string;
  match: { minRecall: number; minPrecision: number };
  steps: Step[];
};
type Finding = { title: string; heartIds: string[] };
export type BaselineBudget = { maxToolCallsPerTurn: number; maxTurnMs: number };
export type Side = {
  flawsFound: number;
  misses: number;
  toolCalls: number;
  timeMs: number;
  cost: { modelSteps: number; usd: number | null };
  designs: { flawId: string; designId: string; found: boolean; toolCalls: number; findings: Finding[] }[];
};
export type BreakerBaselineResult = {
  label: "demo-assumption";
  flawSetVersion: string;
  checklistVersion: string;
  tools: string[];
  budget: BaselineBudget;
  sides: { breaker: Side; checklist: Side };
  verdict: "breaker-wins" | "tie" | "checklist-wins";
  summary: string;
};
type Turn = { toolCalls: number; timeMs: number; modelSteps: number; findings: Finding[] };

const RANK: Record<FitStatus, number> = { fit: 0, risk: 1, "no-fit": 2 };

const readFixture = <T>(name: string) =>
  JSON.parse(readFileSync(path.join(process.cwd(), "fixtures", "planted-flaws", name), "utf8")) as T;

export const plantedDesigns = () => readFixture<Planted>("designs.json").designs.map((entry) => entry.design.id);

function affectedHearts(design: Design): Set<string> {
  const hearts = devHearts();
  const before = evaluateDesign({ hearts, design: STARTING_VALVE });
  const after = evaluateDesign({ hearts, design });
  if (!before.ok || !after.ok) throw new Error(`${design.id} breaks a design rule.`);
  const was = new Map(before.results.map((result) => [result.heartId, result.status]));
  return new Set(
    after.results.filter((result) => RANK[result.status] > RANK[was.get(result.heartId) as FitStatus]).map((result) => result.heartId),
  );
}

function isFound(findings: Finding[], affected: Set<string>, match: Checklist["match"]) {
  return findings.some((finding) => {
    if (finding.heartIds.length === 0 || affected.size === 0) return false;
    const overlap = finding.heartIds.filter((id) => affected.has(id)).length;
    return overlap / affected.size >= match.minRecall && overlap / finding.heartIds.length >= match.minPrecision;
  });
}

async function breakerTurn(model: ModelClient, design: Design, budget: BaselineBudget): Promise<Turn> {
  let modelSteps = 0;
  const counted: ModelClient = {
    mode: model.mode,
    nextTurn(request) {
      modelSteps += 1;
      return model.nextTurn(request);
    },
  };
  const started = performance.now();
  const run = await runBreaker({ model: counted, design, budget });
  return {
    toolCalls: run.events.filter((event) => event.actor === "breaker" && event.type === "tool-call").length,
    timeMs: performance.now() - started,
    modelSteps,
    findings: run.findings.map(({ title, heartIds }) => ({ title, heartIds })),
  };
}

type Group = { key: string; heartIds: string[] };
type Result = { groups?: Group[]; changed?: { heartId: string }[] };

function checklistFindings(step: Step, evidence: Evidence) {
  const result = evidence.result as Result;
  const sets: { title: string; heartIds: string[] }[] =
    step.tool === "group_failures"
      ? (result.groups ?? []).map((group) => ({ title: `Failures grouped by ${String(step.args.by)}: ${group.key}`, heartIds: group.heartIds }))
      : step.tool === "stress_test" && result.changed
        ? [{ title: `Hearts that change under ${String(step.args.kind)}`, heartIds: result.changed.map((item) => item.heartId) }]
        : [];
  return sets
    .filter((set) => set.heartIds.length > 0)
    .map((set) => ({
      ...set,
      explanation: `${set.title}, from the cited ${step.tool} result.`,
      severity: "medium" as const,
      evidenceIds: [evidence.id],
    }));
}

async function checklistTurn(tools: ToolRegistry, checklist: Checklist, design: Design, budget: BaselineBudget): Promise<Turn> {
  const started = performance.now();
  let toolCalls = 0;
  const canCall = () => toolCalls < budget.maxToolCallsPerTurn && performance.now() - started < budget.maxTurnMs;
  const drafts: ReturnType<typeof checklistFindings> = [];
  let complete = true;

  for (const step of checklist.steps) {
    if (!canCall()) {
      complete = false;
      break;
    }
    toolCalls += 1;
    const args = Object.fromEntries(Object.entries(step.args).map(([key, value]) => [key, value === "$design" ? design : value]));
    const outcome = await tools.call(step.tool, args);
    if (outcome.ok) drafts.push(...checklistFindings(step, outcome.evidence));
  }

  let findings: Finding[] = [];
  if (complete && canCall() && drafts.length > 0) {
    toolCalls += 1;
    findings = drafts.map(({ title, heartIds }) => ({ title, heartIds }));
  }
  return { toolCalls, timeMs: performance.now() - started, modelSteps: 0, findings };
}

function side(
  entries: { flawId: string; designId: string; turn: Turn }[],
  affected: Map<string, Set<string>>,
  match: Checklist["match"],
  usd: number | null,
): Side {
  const designs = entries.map(({ flawId, designId, turn }) => ({
    flawId,
    designId,
    found: isFound(turn.findings, affected.get(designId) ?? new Set(), match),
    toolCalls: turn.toolCalls,
    findings: turn.findings,
  }));
  const flawsFound = designs.filter((entry) => entry.found).length;
  return {
    flawsFound,
    misses: designs.length - flawsFound,
    toolCalls: entries.reduce((sum, { turn }) => sum + turn.toolCalls, 0),
    timeMs: entries.reduce((sum, { turn }) => sum + turn.timeMs, 0),
    cost: { modelSteps: entries.reduce((sum, { turn }) => sum + turn.modelSteps, 0), usd },
    designs,
  };
}

export async function runBreakerBaseline({
  breaker,
  budget,
}: {
  breaker: (design: Design) => ModelClient;
  budget?: Partial<BaselineBudget>;
}): Promise<BreakerBaselineResult> {
  const planted = readFixture<Planted>("designs.json");
  const checklist = readFixture<Checklist>("checklist.json");
  const shared: BaselineBudget = { ...{ maxToolCallsPerTurn: defaultBudget.maxToolCallsPerTurn, maxTurnMs: defaultBudget.maxTurnMs }, ...budget };
  const affected = new Map(planted.designs.map(({ design }) => [design.id, affectedHearts(design)]));
  const tools = createAgentTools();

  const breakerEntries = [];
  const checklistEntries = [];
  for (const { flawId, design } of planted.designs) {
    breakerEntries.push({ flawId, designId: design.id, turn: await breakerTurn(breaker(design), design, shared) });
    checklistEntries.push({ flawId, designId: design.id, turn: await checklistTurn(tools, checklist, design, shared) });
  }
  const sides = {
    breaker: side(breakerEntries, affected, checklist.match, null),
    checklist: side(checklistEntries, affected, checklist.match, 0),
  };

  const { breaker: b, checklist: c } = sides;
  const verdict = b.flawsFound > c.flawsFound ? "breaker-wins" : b.flawsFound === c.flawsFound ? "tie" : "checklist-wins";
  const total = planted.designs.length;
  const counts = `The Breaker found ${b.flawsFound} of ${total} planted flaws and the checklist found ${c.flawsFound}`;
  return {
    label: "demo-assumption",
    flawSetVersion: planted.version,
    checklistVersion: checklist.version,
    tools: BREAKER_TOOLS,
    budget: shared,
    sides,
    verdict,
    summary: verdict === "breaker-wins" ? `${counts}. The Breaker beat the checklist.` : `The Breaker did not beat the checklist. ${counts}.`,
  };
}
