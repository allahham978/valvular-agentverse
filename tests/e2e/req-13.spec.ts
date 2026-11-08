import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";
import type { Design, Evidence, FitStatus, Heart, Limit, Run, RunEvent, Summary } from "../../src/contracts/index";
import type { ScriptedTurn } from "../../src/agents/model-client";
import { evaluateDesign } from "../../src/engine/index";
import type { PostLoopStep } from "../../src/orchestrator";

// REQ-13: Hidden scoring and baselines.
// Scripted tests use the scripted model only: no Gemini key, no network beyond localhost, no wall-clock races.
// H5-live (@live) runs the Breaker baseline with Gemini.
// Anything that needs the agent tools goes over HTTP: Playwright's loader can't resolve the "@/" alias src/tools uses.
// The in-process scoring-step test loads only relative-import modules (orchestrator, model-client, engine, scoring step).

const ROOT = process.cwd();
const RUN_TIMEOUT_MS = 60_000;
const LAST_EVIDENCE = "$lastEvidenceId";

const PLANTED_FILE = path.join(ROOT, "fixtures/planted-flaws/designs.json");
const CHECKLIST_FILE = path.join(ROOT, "fixtures/planted-flaws/checklist.json");
// Frozen before any comparison run. Changing either fixture must fail this spec.
const PLANTED_SHA256 = "eb1ba1ad9a7172b0cf7b4ef1ba0b0f8336fcdefee9290216ad55515c1f13aef3";
const CHECKLIST_SHA256 = "cb978ad6123f657e1de935b53d72d711097e782db2c833c58222f5df92de7c5c";

const BREAKER_TOOLS = [
  "evaluate_design",
  "group_failures",
  "profile_group",
  "inspect_heart",
  "what_if",
  "stress_test",
  "report_findings",
];
const METHODS = ["proposal", "no-change", "add-larger-size", "brute-force"] as const;
const BASELINE_METHODS = ["no-change", "add-larger-size", "brute-force"] as const;
const DID_NOT_BEAT = /The Breaker did not beat the checklist/i;

const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;
const devHearts = readJson<{ hearts: Heart[] }>(path.join(ROOT, "data/hearts.dev.json")).hearts;
const hiddenHearts = readJson<{ hearts: Heart[] }>(path.join(ROOT, "server-data/hearts.hidden.json")).hearts;

const START: Design = {
  id: "start",
  label: "Starting valve",
  hypothetical: true,
  sizes: [
    { nominalMm: 23, minAnnulusMm: 21, maxAnnulusMm: 23 },
    { nominalMm: 25, minAnnulusMm: 23, maxAnnulusMm: 25 },
    { nominalMm: 27, minAnnulusMm: 25, maxAnnulusMm: 27 },
  ],
};
const SIZE_29 = { nominalMm: 29, minAnnulusMm: 27, maxAnnulusMm: 29 };
const WIDER: Design = {
  id: "req13-wider",
  label: "Added a larger size",
  hypothetical: true,
  parentId: "start",
  sizes: [...START.sizes, SIZE_29],
};

// ---------- types the spec reads ----------

type Mark = "proposal-wins" | "tie" | "baseline-wins";
type Row = {
  method: (typeof METHODS)[number];
  design: Design | null;
  summary: Summary;
  coveragePct: number;
  newRiskCount: number;
  designsTried: number;
  marks?: { coverage: Mark; newRisk: Mark };
};
type ScoreReport = {
  runId: string;
  heartSet: { split: string; count: number };
  hiddenScoreCount: number;
  limits: Limit[];
  rows: Row[];
};
type RunView = { status: string; run: Run };

type SideDesign = {
  flawId: string;
  designId: string;
  found: boolean;
  toolCalls: number;
  findings: { title: string; heartIds: string[] }[];
};
type Side = {
  flawsFound: number;
  misses: number;
  toolCalls: number;
  timeMs: number;
  cost: { modelSteps: number; usd: number | null };
  designs: SideDesign[];
};
type BaselineResult = {
  label: string;
  flawSetVersion: string;
  checklistVersion: string;
  tools: string[];
  budget: { maxToolCallsPerTurn: number; maxTurnMs: number };
  sides: { breaker: Side; checklist: Side };
  verdict: "breaker-wins" | "tie" | "checklist-wins";
  summary: string;
};
type BreakerSpec = { kind: "scripted"; turns: ScriptedTurn[] } | { kind: "gemini" };
type ScoringStepModule = {
  createScoringStep(options?: { limits?: Limit[] }): PostLoopStep;
};

type Planted = {
  label: string;
  version: string;
  designs: { flawId: string; description: string; design: Design }[];
};
type Checklist = {
  label: string;
  version: string;
  match: { minRecall: number; minPrecision: number };
  steps: { tool: string; args: Record<string, unknown> }[];
  report: { tool: string };
};

// ---------- loaders ----------

async function loadScoringStep(): Promise<ScoringStepModule> {
  return (await import("../../src/orchestrator/scoring-step")) as unknown as ScoringStepModule;
}
async function loadCore() {
  const modelClient = await import("../../src/agents/model-client");
  const orchestrator = await import("../../src/orchestrator");
  return { modelClient, orchestrator };
}

// A spec-local registry backed by the engine, so the in-process loop needs no "@/" imports.
function engineTools() {
  let next = 0;
  const evidence = (tool: string, input: unknown, result: unknown): Evidence => ({
    id: `ev-spec-${++next}`,
    tool,
    input,
    result,
    source: "computed",
  });
  return {
    specs: () => [],
    async call(name: string, input: unknown) {
      const args = input as { design: Design; parent?: Design; mechanisms?: unknown };
      if (name === "evaluate_design") {
        const evaluation = evaluateDesign({ hearts: devHearts, design: args.design, parent: args.parent });
        if (!evaluation.ok) return { ok: false as const, error: "invalid design" };
        return { ok: true as const, evidence: evidence(name, input, evaluation.summary) };
      }
      if (name === "report_findings") {
        return { ok: true as const, evidence: evidence(name, input, { findings: args.mechanisms }) };
      }
      if (name === "submit_proposal") return { ok: true as const, evidence: evidence(name, input, input) };
      return { ok: false as const, error: `unknown tool ${name}` };
    },
  };
}

// ---------- scripted runs over HTTP ----------

const evaluate = (design: Design): ScriptedTurn => ({ toolCalls: [{ name: "evaluate_design", args: { design } }] });
const report = (title: string): ScriptedTurn => ({
  toolCalls: [
    {
      name: "report_findings",
      args: {
        mechanisms: [
          {
            title,
            explanation: `${title}, as shown by the cited evaluation.`,
            heartIds: [],
            severity: "medium",
            evidenceIds: [LAST_EVIDENCE],
          },
        ],
      },
    },
  ],
});
const submit = (design: Design): ScriptedTurn => ({
  toolCalls: [
    {
      name: "submit_proposal",
      args: {
        design,
        rationale: "Add a larger size for hearts above the top range.",
        tradeOffs: ["One more size to make"],
        claim: { metric: "fitPct", comparator: ">=", threshold: 0 },
        evidenceIds: [LAST_EVIDENCE],
      },
    },
  ],
});

// Breaker, Fixer proposes WIDER (improves), attack, Fixer proposes WIDER again (no improvement, stop).
const runTurns = (): ScriptedTurn[] => [
  evaluate(START),
  report("Narrow junction"),
  evaluate(WIDER),
  submit(WIDER),
  evaluate(WIDER),
  report("Shift attack"),
  evaluate(WIDER),
  submit(WIDER),
];

async function startRun(baseURL: string | undefined, turns: ScriptedTurn[], budget?: Record<string, number>) {
  const response = await fetch(`${baseURL}/api/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: { kind: "scripted", turns }, ...(budget ? { budget } : {}) }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function getRun(baseURL: string | undefined, id: string): Promise<RunView> {
  const response = await fetch(`${baseURL}/api/runs/${id}`);
  expect(response.status).toBe(200);
  return (await response.json()) as RunView;
}

async function finishedRun(baseURL: string | undefined): Promise<RunView> {
  const id = await startRun(baseURL, runTurns());
  await expect
    .poll(async () => (await getRun(baseURL, id)).status, { timeout: RUN_TIMEOUT_MS, intervals: [100, 250, 500] })
    .toBe("finished");
  const view = await getRun(baseURL, id);
  const stop = view.run.events.at(-1) as RunEvent;
  expect((stop.data as { reason: string }).reason, "the scripted run stops because WIDER no longer improves").toBe(
    "no-improvement",
  );
  return view;
}

async function score(baseURL: string | undefined, body: unknown) {
  return fetch(`${baseURL}/api/score`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function scoreOk(baseURL: string | undefined, body: unknown): Promise<{ report: ScoreReport; text: string }> {
  const response = await score(baseURL, body);
  const text = await response.text();
  expect(response.status, text).toBe(200);
  return { report: JSON.parse(text) as ScoreReport, text };
}

// ---------- independent checks ----------

function hiddenSummary(design: Design): Summary {
  const evaluation = evaluateDesign({ hearts: hiddenHearts, design, parent: START, split: "hidden" });
  if (!evaluation.ok) throw new Error(`design ${design.id} is invalid`);
  return evaluation.summary;
}

function devFit(design: Design): number {
  const evaluation = evaluateDesign({ hearts: devHearts, design });
  if (!evaluation.ok) throw new Error(`design ${design.id} is invalid`);
  return evaluation.summary.fit;
}

function expectedMark(proposal: number, baseline: number, higherIsBetter: boolean): Mark {
  if (proposal === baseline) return "tie";
  return proposal > baseline === higherIsBetter ? "proposal-wins" : "baseline-wins";
}

const rowOf = (report: ScoreReport, method: Row["method"]) => {
  const row = report.rows.find((candidate) => candidate.method === method);
  if (!row) throw new Error(`no ${method} row`);
  return row;
};

const RANK: Record<FitStatus, number> = { fit: 0, risk: 1, "no-fit": 2 };

function affectedHearts(design: Design): Set<string> {
  const start = evaluateDesign({ hearts: devHearts, design: START });
  const planted = evaluateDesign({ hearts: devHearts, design });
  if (!start.ok || !planted.ok) throw new Error(`design ${design.id} is invalid`);
  const before = new Map(start.results.map((result) => [result.heartId, result.status]));
  return new Set(
    planted.results
      .filter((result) => RANK[result.status] > RANK[before.get(result.heartId) as FitStatus])
      .map((result) => result.heartId),
  );
}

function matchesFlaw(heartIds: string[], affected: Set<string>, match: Checklist["match"]): boolean {
  if (heartIds.length === 0 || affected.size === 0) return false;
  const overlap = heartIds.filter((id) => affected.has(id)).length;
  return overlap / affected.size >= match.minRecall && overlap / heartIds.length >= match.minPrecision;
}

const sortedIdLists = (lists: string[][]) => lists.map((ids) => [...ids].sort().join(",")).sort();

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

test.describe.configure({ timeout: 120_000 });

// ---------- H1: scoring a finished run ----------

test.describe("H1 scoring a finished run", () => {
  test("returns the proposal and three baselines, all on the same 100 hidden hearts", async ({ baseURL }) => {
    expect(hiddenHearts).toHaveLength(100);
    const view = await finishedRun(baseURL);
    const { report, text } = await scoreOk(baseURL, { runId: view.run.id });

    expect(report.runId).toBe(view.run.id);
    expect(report.heartSet).toEqual({ split: "hidden", count: 100 });
    expect(report.rows.map((row) => row.method)).toEqual([...METHODS]);
    for (const row of report.rows) {
      expect(row.design, `${row.method} has a design`).not.toBeNull();
      expect(row.summary.split).toBe("hidden");
      expect(row.summary.total).toBe(100);
      expect(row.summary.fit + row.summary.risk + row.summary.noFit).toBe(100);
      expect(row.summary, `${row.method} matches the engine on the hidden hearts`).toEqual(
        hiddenSummary(row.design as Design),
      );
    }
    expect(rowOf(report, "proposal").design).toEqual(WIDER);
    expect(rowOf(report, "no-change").design?.sizes).toEqual(START.sizes);

    // Short values like 21.5 also appear as design sizes, so only full-precision measurements are searched for.
    for (const heart of hiddenHearts) {
      for (const value of Object.values(heart.measures)) {
        const decimals = String(value).split(".")[1] ?? "";
        if (decimals.length < 3) continue;
        expect(text.includes(String(value)), `hidden measurement of ${heart.id} leaked`).toBe(false);
      }
    }
    expect(text).not.toContain('"measures"');
    expect(text).not.toContain('"results"');
  });

  test("refuses unfinished, unknown and malformed requests", async ({ baseURL }) => {
    const slow = await startRun(baseURL, [{ ...evaluate(START), delayMs: 60_000 }, ...runTurns()], {
      maxTurnMs: 120_000,
    });
    expect((await score(baseURL, { runId: slow })).status, "a running run is refused").toBe(409);
    expect((await score(baseURL, { runId: "no-such-run-req13" })).status).toBe(404);
    expect((await score(baseURL, { nope: true })).status).toBe(400);
  });

  test("only code under src/scoring reads the hidden hearts", () => {
    const files = walk(path.join(ROOT, "src")).filter((file) => /\.(ts|tsx)$/.test(file));
    const readers = files.filter((file) => /hearts\.hidden|server-data/.test(readFileSync(file, "utf8")));
    expect(readers.length, "scoring reads the hidden file").toBeGreaterThan(0);
    for (const file of readers) {
      expect(path.relative(ROOT, file), "hidden file read outside src/scoring").toMatch(/^src[\\/]scoring[\\/]/);
    }
    const agentSide = files.filter((file) => /src[\\/](tools|agents)[\\/]/.test(file));
    for (const file of agentSide) {
      expect(readFileSync(file, "utf8"), `${path.relative(ROOT, file)} imports scoring`).not.toMatch(
        /["'](@\/scoring|[./]+scoring)(\/[^"']*)?["']/,
      );
    }
  });
});

// ---------- H2: reading the scores ----------

test.describe("H2 reading the scores", () => {
  test("each row has coverage, new risks and designs tried, with ties and losses marked", async ({ baseURL }) => {
    const view = await finishedRun(baseURL);
    const { report } = await scoreOk(baseURL, { runId: view.run.id });
    const proposal = rowOf(report, "proposal");

    for (const row of report.rows) {
      expect(row.coveragePct).toBe(row.summary.fitPct);
      expect(row.newRiskCount).toBe(row.summary.newRiskHeartIds.length);
      expect(Number.isInteger(row.designsTried)).toBe(true);
      expect(row.designsTried).toBeGreaterThanOrEqual(1);
    }
    expect(proposal.marks).toBeUndefined();
    expect(proposal.designsTried, "the Fixer tried one distinct design in this script").toBe(1);
    expect(rowOf(report, "no-change").designsTried).toBe(1);
    expect(rowOf(report, "add-larger-size").designsTried).toBe(1);
    expect(rowOf(report, "brute-force").designsTried).toBeGreaterThan(1);

    for (const method of BASELINE_METHODS) {
      const row = rowOf(report, method);
      expect(row.marks, `${method} is marked`).toEqual({
        coverage: expectedMark(proposal.summary.fit, row.summary.fit, true),
        newRisk: expectedMark(proposal.newRiskCount, row.newRiskCount, false),
      });
    }
    expect(rowOf(report, "add-larger-size").marks, "same sizes as the proposal is a tie").toEqual({
      coverage: "tie",
      newRisk: "tie",
    });
    const marks = report.rows.flatMap((row) => (row.marks ? [row.marks.coverage, row.marks.newRisk] : []));
    expect(marks, "a baseline win (agent loss) is marked").toContain("baseline-wins");
    expect(marks).toContain("tie");

    const larger = rowOf(report, "add-larger-size").design as Design;
    expect(larger.hypothetical).toBe(true);
    expect(larger.sizes).toEqual([...START.sizes, SIZE_29]);

    const brute = rowOf(report, "brute-force").design as Design;
    expect(brute.hypothetical).toBe(true);
    for (const size of brute.sizes) {
      const width = size.maxAnnulusMm - size.minAnnulusMm;
      expect(width).toBeGreaterThan(0);
      expect(width, "within the 2.5 mm rule").toBeLessThanOrEqual(2.5);
      expect(size.nominalMm, "nominal is the top of its range, as in the starting valve").toBe(size.maxAnnulusMm);
    }
    expect(devFit(brute), "brute force searches dev hearts and beats no change there").toBeGreaterThanOrEqual(
      devFit(START),
    );
  });
});

// ---------- H3: adding a limit ----------

test.describe("H3 adding a limit", () => {
  test("brute force reruns under the limit and the hidden score count goes up", async ({ baseURL }) => {
    const view = await finishedRun(baseURL);
    expect(view.run.hiddenScoreCount).toBe(0);

    const first = (await scoreOk(baseURL, { runId: view.run.id })).report;
    expect(first.hiddenScoreCount).toBe(1);
    expect(first.limits).toEqual([]);
    const freeBrute = rowOf(first, "brute-force").design as Design;
    expect(freeBrute.sizes.length, "without a limit brute force uses more than 2 sizes").toBeGreaterThan(2);

    const limit: Limit = { id: "limit-req13", kind: "max-sizes", value: 2, sourceText: "no more than 2 sizes" };
    const second = (await scoreOk(baseURL, { runId: view.run.id, limits: [limit] })).report;
    expect(second.hiddenScoreCount, "the hidden score count goes up").toBe(2);
    expect(second.limits).toEqual([limit]);
    const limitedBrute = rowOf(second, "brute-force");
    expect((limitedBrute.design as Design).sizes.length).toBeLessThanOrEqual(2);
    expect(limitedBrute.design).not.toEqual(freeBrute);
    expect(limitedBrute.summary).toEqual(hiddenSummary(limitedBrute.design as Design));

    const stored = await getRun(baseURL, view.run.id);
    expect(stored.status, "scoring keeps the run finished").toBe("finished");
    expect(stored.run.events).toEqual(view.run.events);
    expect(stored.run.hiddenScoreCount).toBe(2);
    expect(stored.run.baselines.map((baseline) => baseline.method)).toEqual([...BASELINE_METHODS]);
    for (const baseline of stored.run.baselines) {
      const row = rowOf(second, baseline.method);
      expect(baseline.designId).toBe((row.design as Design).id);
      expect(baseline.summary).toEqual(row.summary);
      expect(baseline.designsTried).toBe(row.designsTried);
    }

    const shown = await fetch(`${baseURL}/api/score?runId=${view.run.id}`);
    expect(shown.status).toBe(200);
    expect(((await shown.json()) as ScoreReport).hiddenScoreCount, "reading the report does not score again").toBe(2);
    expect((await getRun(baseURL, view.run.id)).run.hiddenScoreCount).toBe(2);

    const bad = await score(baseURL, {
      runId: view.run.id,
      limits: [{ id: "limit-bad", kind: "safe-for-all", value: 1, sourceText: "make it safe" }],
    });
    expect(bad.status, "unsupported limit types are refused").toBe(400);
    expect(await bad.text()).toMatch(/max-sizes/);
    expect((await getRun(baseURL, view.run.id)).run.hiddenScoreCount, "a refused request is not a scoring").toBe(2);
  });
});

// ---------- H4: determinism ----------

test.describe("H4 same inputs, same numbers", () => {
  test("rescoring a run and scoring an identical run give identical numbers", async ({ baseURL }) => {
    const a = await finishedRun(baseURL);
    const b = await finishedRun(baseURL);
    const first = (await scoreOk(baseURL, { runId: a.run.id })).report;
    const again = (await scoreOk(baseURL, { runId: a.run.id })).report;
    const other = (await scoreOk(baseURL, { runId: b.run.id })).report;
    expect(again.rows).toEqual(first.rows);
    expect(other.rows).toEqual(first.rows);
    expect(again.hiddenScoreCount).toBe(first.hiddenScoreCount + 1);
  });

  test("the loop's scoring step gives the same rows and counts the scoring", async ({ baseURL }) => {
    const { modelClient, orchestrator } = await loadCore();
    const { createScoringStep } = await loadScoringStep();
    const run = await orchestrator.executeRun({
      model: modelClient.createScriptedClient(runTurns()),
      tools: engineTools(),
      postLoopSteps: [createScoringStep()],
    });
    expect(run.hiddenScoreCount).toBe(1);
    expect(run.baselines.map((baseline) => baseline.method)).toEqual([...BASELINE_METHODS]);
    const types = run.events.map((event) => event.type);
    const scoreAt = types.indexOf("score");
    expect(scoreAt, "a score event").toBeGreaterThan(-1);
    expect(types.indexOf("run-stop")).toBeGreaterThan(scoreAt);
    const event = run.events[scoreAt];
    expect(event.actor).toBe("code");
    const stepReport = event.data as ScoreReport;
    expect(stepReport.hiddenScoreCount).toBe(1);

    const view = await finishedRun(baseURL);
    const apiReport = (await scoreOk(baseURL, { runId: view.run.id })).report;
    expect(stepReport.rows).toEqual(apiReport.rows);
  });
});

// ---------- H5: scripted Breaker baseline ----------

const planted = readJson<Planted>(PLANTED_FILE);
const checklist = readJson<Checklist>(CHECKLIST_FILE);
const affectedById = new Map(planted.designs.map((entry) => [entry.design.id, affectedHearts(entry.design)]));

const weakScript = (design: Design): ScriptedTurn[] => [
  evaluate(design),
  {
    toolCalls: [
      {
        name: "report_findings",
        args: {
          mechanisms: [
            {
              title: "Some hearts fail",
              explanation: "The cited evaluation shows failing hearts.",
              heartIds: [],
              severity: "low",
              evidenceIds: [LAST_EVIDENCE],
            },
          ],
        },
      },
    ],
  },
];
const strongScript = (design: Design): ScriptedTurn[] => [
  { toolCalls: [{ name: "evaluate_design", args: { design, parent: START } }] },
  {
    toolCalls: [
      {
        name: "report_findings",
        args: {
          mechanisms: [
            {
              title: "Hearts this design makes worse",
              explanation: "These hearts lose status against the starting valve, as the cited evaluation shows.",
              heartIds: [...(affectedById.get(design.id) as Set<string>)].sort(),
              severity: "high",
              evidenceIds: [LAST_EVIDENCE],
            },
          ],
        },
      },
    ],
  },
];

// One turn of 5 calls: 4 evaluations, then the strong report. Under a budget of 3 the report never runs.
const overBudgetScript = (design: Design): ScriptedTurn[] => {
  const [, strongReport] = strongScript(design);
  const evaluation = { name: "evaluate_design", args: { design, parent: START } };
  return [{ toolCalls: [evaluation, evaluation, evaluation, evaluation, ...strongReport.toolCalls] }];
};

async function callTool(request: APIRequestContext, tool: string, input: unknown) {
  const response = await request.post("/api/tools", { data: { tool, input } });
  expect(response.status(), `checklist step ${tool}`).toBe(200);
  return ((await response.json()) as { evidence: Evidence }).evidence;
}

async function expectedChecklistFindings(request: APIRequestContext, designId: string): Promise<string[][]> {
  const design = planted.designs.find((entry) => entry.design.id === designId)?.design as Design;
  const lists: string[][] = [];
  for (const step of checklist.steps) {
    const args = Object.fromEntries(
      Object.entries(step.args).map(([key, value]) => [key, value === "$design" ? design : value]),
    );
    const result = (await callTool(request, step.tool, args)).result as {
      groups?: { heartIds: string[] }[];
      changed?: { heartId: string }[];
    };
    if (step.tool === "group_failures") {
      for (const group of result.groups ?? []) if (group.heartIds.length) lists.push(group.heartIds);
    }
    if (step.tool === "stress_test" && result.changed?.length) lists.push(result.changed.map((c) => c.heartId));
  }
  return lists;
}

function expectSide(side: Side, label: string) {
  expect(side.designs.map((entry) => entry.designId), `${label} covers every planted design`).toEqual(
    planted.designs.map((entry) => entry.design.id),
  );
  expect(side.designs.map((entry) => entry.flawId)).toEqual(planted.designs.map((entry) => entry.flawId));
  for (const entry of side.designs) {
    const affected = affectedById.get(entry.designId) as Set<string>;
    const found = entry.findings.some((finding) => matchesFlaw(finding.heartIds, affected, checklist.match));
    expect(entry.found, `${label} ${entry.flawId} found flag follows the frozen match rule`).toBe(found);
  }
  const found = side.designs.filter((entry) => entry.found).length;
  expect(side.flawsFound).toBe(found);
  expect(side.misses).toBe(planted.designs.length - found);
  expect(side.toolCalls).toBe(side.designs.reduce((sum, entry) => sum + entry.toolCalls, 0));
  expect(Number.isFinite(side.timeMs)).toBe(true);
  expect(side.timeMs).toBeGreaterThanOrEqual(0);
  expect(typeof side.cost.modelSteps).toBe("number");
  expect(side.cost.usd === null || (typeof side.cost.usd === "number" && side.cost.usd >= 0)).toBe(true);
}

function expectVerdict(result: BaselineResult) {
  const { breaker, checklist: list } = result.sides;
  const verdict =
    breaker.flawsFound > list.flawsFound ? "breaker-wins" : breaker.flawsFound === list.flawsFound ? "tie" : "checklist-wins";
  expect(result.verdict).toBe(verdict);
  if (verdict === "breaker-wins") expect(result.summary).not.toMatch(DID_NOT_BEAT);
  else expect(result.summary, "the results say the Breaker did not beat the checklist").toMatch(DID_NOT_BEAT);
}

async function runBaseline(
  request: APIRequestContext,
  breakerFor: (design: Design) => BreakerSpec,
  budget?: { maxToolCallsPerTurn?: number; maxTurnMs?: number },
): Promise<BaselineResult> {
  const breakers = Object.fromEntries(planted.designs.map(({ design }) => [design.id, breakerFor(design)]));
  const response = await request.post("/api/score/breaker-baseline", {
    data: { breakers, ...(budget ? { budget } : {}) },
    timeout: 0,
  });
  const text = await response.text();
  expect(response.status(), text).toBe(200);
  return JSON.parse(text) as BaselineResult;
}

const scripted = (turns: ScriptedTurn[]): BreakerSpec => ({ kind: "scripted", turns });

async function expectChecklistRan(request: APIRequestContext, result: BaselineResult) {
  const side = result.sides.checklist;
  expect(side.cost).toEqual({ modelSteps: 0, usd: 0 });
  for (const entry of side.designs) {
    expect(entry.toolCalls, "checklist steps plus its report").toBe(checklist.steps.length + 1);
    expect(sortedIdLists(entry.findings.map((finding) => finding.heartIds))).toEqual(
      sortedIdLists(await expectedChecklistFindings(request, entry.designId)),
    );
  }
}

test.describe("H5 scripted Breaker baseline", () => {
  test("planted flaws and checklist are frozen, labelled and valid", () => {
    const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
    expect(sha(PLANTED_FILE), "planted-flaw set changed after freezing").toBe(PLANTED_SHA256);
    expect(sha(CHECKLIST_FILE), "checklist changed after freezing").toBe(CHECKLIST_SHA256);
    expect(planted.label).toBe("demo-assumption");
    expect(checklist.label).toBe("demo-assumption");
    expect(planted.designs).toHaveLength(5);
    expect(new Set(planted.designs.map((entry) => entry.flawId)).size).toBe(5);
    for (const { design } of planted.designs) {
      expect(evaluateDesign({ hearts: devHearts, design }).ok, `${design.id} passes the size-width rule`).toBe(true);
      expect((affectedById.get(design.id) as Set<string>).size, `${design.id} hurts some dev hearts`).toBeGreaterThanOrEqual(5);
    }
    for (const step of checklist.steps) expect(BREAKER_TOOLS).toContain(step.tool);
    expect(checklist.report.tool).toBe("report_findings");
    expect(checklist.steps.length + 1, "the checklist fits the default per-turn tool budget").toBeLessThanOrEqual(12);
  });

  test("a weak Breaker loses to the checklist and the results say so", async ({ request }) => {
    const result = await runBaseline(request, (design) => scripted(weakScript(design)));

    expect(result.label).toBe("demo-assumption");
    expect(result.flawSetVersion).toBe(planted.version);
    expect(result.checklistVersion).toBe(checklist.version);
    expect([...result.tools].sort()).toEqual([...BREAKER_TOOLS].sort());
    expectSide(result.sides.breaker, "breaker");
    expectSide(result.sides.checklist, "checklist");
    await expectChecklistRan(request, result);
    expect(result.sides.breaker.flawsFound).toBe(0);
    expect(result.sides.breaker.toolCalls).toBe(10);
    expect(result.sides.breaker.cost.modelSteps, "one model step per scripted turn").toBe(10);
    expect(result.sides.checklist.flawsFound, "the frozen checklist finds some planted flaws").toBeGreaterThan(0);
    expect(result.verdict).toBe("checklist-wins");
    expectVerdict(result);
  });

  test("a Breaker that matches the checklist ties and the results say it did not beat it", async ({ request }) => {
    const checklistFound = new Set<string>();
    for (const entry of planted.designs) {
      const lists = await expectedChecklistFindings(request, entry.design.id);
      const affected = affectedById.get(entry.design.id) as Set<string>;
      if (lists.some((ids) => matchesFlaw(ids, affected, checklist.match))) checklistFound.add(entry.design.id);
    }
    expect(checklistFound.size, "the frozen checklist misses some planted flaws").toBeLessThan(5);

    const result = await runBaseline(request, (design) =>
      scripted(checklistFound.has(design.id) ? strongScript(design) : weakScript(design)),
    );
    expectSide(result.sides.breaker, "breaker");
    expectSide(result.sides.checklist, "checklist");
    expect(result.sides.breaker.flawsFound).toBe(checklistFound.size);
    expect(result.sides.checklist.flawsFound).toBe(checklistFound.size);
    expect(result.verdict).toBe("tie");
    expectVerdict(result);
  });

  test("a strong Breaker beats the checklist, with tool calls, time and cost for both", async ({ request }) => {
    const result = await runBaseline(request, (design) => scripted(strongScript(design)));

    expectSide(result.sides.breaker, "breaker");
    expectSide(result.sides.checklist, "checklist");
    await expectChecklistRan(request, result);
    expect(result.sides.breaker.flawsFound).toBe(5);
    expect(result.sides.breaker.misses).toBe(0);
    expect(result.sides.breaker.toolCalls).toBe(10);
    expect(result.sides.breaker.cost.modelSteps).toBe(10);
    expect(result.sides.checklist.toolCalls).toBe(5 * (checklist.steps.length + 1));
    expect(result.verdict).toBe("breaker-wins");
    expectVerdict(result);
  });

  test("the checklist and the Breaker run under the same budget", async ({ request }) => {
    const [first] = planted.designs;
    const result = await runBaseline(
      request,
      (design) => scripted(design.id === first.design.id ? overBudgetScript(design) : strongScript(design)),
      { maxToolCallsPerTurn: 3 },
    );
    expect(result.budget.maxToolCallsPerTurn).toBe(3);
    expectSide(result.sides.breaker, "breaker");
    expectSide(result.sides.checklist, "checklist");
    for (const entry of result.sides.checklist.designs) {
      expect(entry.toolCalls, "the checklist stops at the shared tool budget").toBeLessThanOrEqual(3);
    }
    expect(result.sides.checklist.flawsFound, "cut off before its report, the checklist finds nothing").toBe(0);

    const capped = result.sides.breaker.designs.find((entry) => entry.designId === first.design.id) as SideDesign;
    expect(capped.toolCalls, "the Breaker turn ran").toBeGreaterThan(0);
    expect(capped.toolCalls, "the Breaker stops at the shared tool budget").toBeLessThanOrEqual(3);
    expect(capped.found, "cut off before its report, the Breaker misses this flaw").toBe(false);
    expect(result.sides.breaker.flawsFound).toBe(4);
    expectVerdict(result);

    const partial = await request.post("/api/score/breaker-baseline", {
      data: { breakers: { [first.design.id]: scripted(weakScript(first.design)) } },
    });
    expect(partial.status(), "every planted design needs a Breaker").toBe(400);
  });

  test("@live H5-live the same comparison with the Gemini Breaker", async ({ request }) => {
    test.setTimeout(20 * 60_000);
    expect(existsSync(path.join(ROOT, ".env.local")), "the Gemini key lives in .env.local").toBe(true);
    const result = await runBaseline(request, () => ({ kind: "gemini" }));

    expectSide(result.sides.breaker, "breaker");
    expectSide(result.sides.checklist, "checklist");
    await expectChecklistRan(request, result);
    expect(result.sides.breaker.cost.modelSteps).toBeGreaterThanOrEqual(5);
    expectVerdict(result);
    test.info().annotations.push({ type: "breaker-baseline", description: result.summary });
  });
});
