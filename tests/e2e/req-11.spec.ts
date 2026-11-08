import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  ClaimSchema,
  RunSchema,
  SummarySchema,
  type Claim,
  type Design,
  type Evidence,
  type Heart,
  type Limit,
  type Run,
  type RunEvent,
  type Summary,
} from "../../src/contracts/index";
import type { ModelClient, ModelRequest, ModelTurn, ScriptedTurn } from "../../src/agents/model-client";

// REQ-11: Fixer and attack loop, code-assigned verdicts, demo mode.
// Scripted tests run in-process (and once over HTTP) against the real REQ-9 tools: no key, no network, no delays.
// Every threshold and design is computed from the tools at run time. @live tests call Gemini.

const ROOT = process.cwd();
const RECORDINGS = path.join(ROOT, "fixtures/recordings");
const FIXTURE = path.join(ROOT, "fixtures/transcripts/fixer/demo-run.json");
const RUN_TIMEOUT_MS = 90_000;
const SCRIPTED_TIMEOUT_MS = 180_000;
const INVENTED = 4242;

const VERDICTS = [
  "supported_under_conditions",
  "context_dependent",
  "contradicted",
  "inconclusive",
  "invalid_experiment",
] as const;
const AGENT_TOOLS = [
  "evaluate_design",
  "group_failures",
  "profile_group",
  "inspect_heart",
  "what_if",
  "stress_test",
  "report_findings",
  "edit_design",
  "submit_proposal",
];

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
const TOO_WIDE: Design = {
  id: "req11-too-wide",
  label: "Too wide",
  hypothetical: true,
  sizes: [
    { nominalMm: 23, minAnnulusMm: 20, maxAnnulusMm: 23 },
    { nominalMm: 25, minAnnulusMm: 23, maxAnnulusMm: 25 },
    { nominalMm: 27, minAnnulusMm: 25, maxAnnulusMm: 27 },
  ],
};
const addSize = (nominalMm: number) => ({
  kind: "add_size",
  size: { nominalMm, minAnnulusMm: nominalMm - 2, maxAnnulusMm: nominalMm },
});
const TOO_WIDE_CHANGE = { kind: "set_range", nominalMm: 23, minAnnulusMm: 20, maxAnnulusMm: 23 };
const DUPLICATE_CHANGE = addSize(25);
const SIZE_LIMIT: Limit = { id: "limit-sizes", kind: "max-sizes", value: 3, sourceText: "No more than three sizes" };

type StepData = { step: string; round: number };
type StopData = { reason: string; detail: string; limit?: string };
type ToolCallData = { tool: string; input: unknown; evidenceId?: string; result?: unknown; error?: string };
type EditResult = {
  valid: boolean;
  reasons?: { message: string }[];
  design: Design;
  comparison: { parent: Summary; child: Summary; newRiskHeartIds: string[] };
  limits: { id: string; kind: string; pass: boolean }[];
};
type StressResult = { kind: string; amount: number; before: Summary; after: Summary };
type AttackData = { evidenceId: string; kind: string; amount?: number; value: number; holds: boolean; outcome: string };
type VerdictData = {
  proposalId: string;
  verdict: string;
  notShown: string[];
  dev: { metric: string; value: number; holds: boolean };
  attacks: AttackData[];
};
type Comparison = { before: Summary; after: Summary; newRiskHeartIds: string[]; evidenceId: string };
type ProposalData = { proposal: { id: string }; design: Design; comparison: Comparison };

async function load() {
  const fixer = await import("../../src/agents/fixer");
  const attack = await import("../../src/agents/attack");
  const tools = await import("../../src/tools");
  const roles = await import("../../src/orchestrator/roles");
  const modelClient = await import("../../src/agents/model-client");
  return { fixer, attack, tools, roles, modelClient };
}

async function evidenceOf(tool: string, input: unknown): Promise<Evidence> {
  const { tools } = await load();
  const outcome = await tools.createAgentTools().call(tool, input);
  if (!outcome.ok) throw new Error(`${tool}: ${outcome.error}`);
  return outcome.evidence;
}
const editOf = (evidence: Evidence) => evidence.result as EditResult;
const stressOf = (evidence: Evidence) => evidence.result as StressResult;

function capture(inner: ModelClient) {
  const requests: ModelRequest[] = [];
  const client: ModelClient = {
    mode: inner.mode,
    nextTurn(request: ModelRequest): Promise<ModelTurn> {
      requests.push({ ...request, messages: JSON.parse(JSON.stringify(request.messages)) as ModelRequest["messages"] });
      return inner.nextTurn(request);
    },
  };
  return { client, requests };
}

const firstPrompt = (request: ModelRequest) => {
  const first = request.messages[0];
  return first && first.role === "user" ? first.text : "";
};
const turnStarts = (requests: ModelRequest[], step: string) =>
  requests.filter((r) => r.step === step && r.messages.length === 1);

const toolCalls = (run: Run) =>
  run.events.filter((e: RunEvent) => e.type === "tool-call").map((e) => e.data as ToolCallData);
const steps = (run: Run) =>
  run.events.filter((e) => e.type === "step-start").map((e) => [e.actor, (e.data as StepData).step]);
const stopOf = (run: Run) => {
  const last = run.events.at(-1);
  expect(last?.type).toBe("run-stop");
  return { ...(last?.data as StopData), text: last?.text ?? "" };
};
const verdictEvents = (run: Run) => run.events.filter((e) => e.type === "verdict");
const verdictsOf = (run: Run) => verdictEvents(run).map((e) => e.data as VerdictData);
const proposalEvents = (run: Run) => run.events.filter((e) => e.type === "proposal").map((e) => e.data as ProposalData);
const indexOf = (run: Run, match: (e: RunEvent) => boolean) => run.events.findIndex(match);
const stepIndex = (run: Run, step: string, round: number) =>
  indexOf(run, (e) => e.type === "step-start" && (e.data as StepData).step === step && (e.data as StepData).round === round);

const finding = (title: string, explanation: string, evidenceIds: string[]) => ({
  title,
  explanation,
  heartIds: [],
  severity: "low",
  evidenceIds,
});
const report = (...mechanisms: ReturnType<typeof finding>[]): ScriptedTurn => ({
  toolCalls: [{ name: "report_findings", args: { mechanisms } }],
});
const call = (name: string, args: unknown): ScriptedTurn => ({ toolCalls: [{ name, args }] });

const fitClaim = (edit: Evidence): Claim => ({
  metric: "fitPct",
  comparator: ">=",
  threshold: editOf(edit).comparison.child.fitPct,
});
const submitTurn = (design: Design, claim: Claim, evidenceIds: string[], rationale = "Add the size the findings point to."): ScriptedTurn =>
  call("submit_proposal", { design, rationale, claim, tradeOffs: ["One more size to stock."], evidenceIds });
const proposeTurns = (edit: Evidence, claim: Claim): ScriptedTurn[] => [
  call("edit_design", edit.input),
  submitTurn(editOf(edit).design, claim, [edit.id]),
];
const stressArgs = (design: Design, kind: string, amount: number) => ({
  design,
  kind,
  amount,
  hypothesis: "The claim still holds after this shift.",
  disprovedIf: "The claimed metric crosses its threshold after the shift.",
});
const attackTurns = (stress: Evidence[], title = "Shift attack ran"): ScriptedTurn[] => [
  { toolCalls: stress.map((s) => ({ name: "stress_test", args: s.input })) },
  report(finding(title, "The shift attack on the proposal ran and its result is cited.", stress.map((s) => s.id))),
];

async function investigateTurns(): Promise<ScriptedTurn[]> {
  const e1 = await evidenceOf("evaluate_design", { design: START });
  const e2 = await evidenceOf("group_failures", { design: START, by: "rule" });
  return [
    { toolCalls: [{ name: "evaluate_design", args: { design: START } }, { name: "group_failures", args: { design: START, by: "rule" } }] },
    report(finding("Failures cluster by rule", "Failing hearts share a rule, as the grouping shows.", [e1.id, e2.id])),
  ];
}

async function chain() {
  const e1 = await evidenceOf("edit_design", { design: START, change: addSize(29) });
  const e2 = await evidenceOf("edit_design", { design: editOf(e1).design, change: addSize(21) });
  const e3 = await evidenceOf("edit_design", { design: editOf(e2).design, change: addSize(31) });
  const edits = [e1, e2, e3];
  for (const edit of edits) {
    expect(editOf(edit).valid, `precondition: ${JSON.stringify(edit.input)} is valid`).toBe(true);
    expect(editOf(edit).comparison.child.fitPct, "precondition: each step improves").toBeGreaterThan(
      editOf(edit).comparison.parent.fitPct,
    );
  }
  return edits;
}

async function attackCandidates(design: Design) {
  const kinds: [string, number][] = [
    ["measurement_shift", 1],
    ["measurement_shift", -1],
    ["assumption_shift", 1],
    ["assumption_shift", -1],
  ];
  return Promise.all(kinds.map(([kind, amount]) => evidenceOf("stress_test", stressArgs(design, kind, amount))));
}

type LoopOptions = { demo?: boolean; startAt?: "investigate" | "propose"; budget?: Record<string, number>; limits?: Limit[] };

async function scriptedLoop(turns: ScriptedTurn[], options: LoopOptions = {}) {
  const { attack, modelClient } = await load();
  const { client, requests } = capture(modelClient.createScriptedClient(turns));
  const run = await attack.runLoop({ model: client, ...options });
  expect(RunSchema.safeParse(run).success, "the run matches the Run contract").toBe(true);
  return { run, requests };
}

function expectNotShown(notShown: string[] | undefined) {
  expect(Array.isArray(notShown)).toBe(true);
  expect(notShown?.length).toBeGreaterThan(0);
  for (const item of notShown ?? []) expect(item.trim().length).toBeGreaterThan(0);
  expect(notShown?.some((item) => /dev hearts only/i.test(item)), JSON.stringify(notShown)).toBe(true);
  const rules = JSON.parse(readFileSync(path.join(ROOT, "data/rules.json"), "utf8")) as { rules: unknown[] };
  if (JSON.stringify(rules).includes("demo-assumption")) {
    expect(notShown?.some((item) => /demo-assumption/i.test(item)), JSON.stringify(notShown)).toBe(true);
  }
}

function onlyVerdict(run: Run): VerdictData {
  const verdicts = verdictsOf(run);
  expect(verdicts, "one proposal, one verdict").toHaveLength(1);
  const [verdict] = verdicts;
  expect(verdictEvents(run)[0].actor, "code assigns the verdict").toBe("code");
  expect(run.proposals).toHaveLength(1);
  expect(run.proposals[0].verdict).toBe(verdict.verdict);
  expect(run.proposals[0].notShown).toEqual(verdict.notShown);
  expect(verdict.proposalId).toBe(run.proposals[0].id);
  expect(indexOf(run, (e) => e.type === "verdict"), "verdict comes before run-stop").toBeLessThan(run.events.length - 1);
  expectNotShown(verdict.notShown);
  return verdict;
}

function expectAttack(attack: AttackData, stress: Evidence, holds: boolean) {
  expect(attack.evidenceId).toBe(stress.id);
  expect(attack.kind).toBe(stressOf(stress).kind);
  expect(attack.value, "attack value is the code-computed fitPct under the attack").toBeCloseTo(stressOf(stress).after.fitPct, 6);
  expect(attack.holds).toBe(holds);
  expect(attack.outcome).toBe(holds ? "survived" : "broke");
}

test.describe.configure({ timeout: SCRIPTED_TIMEOUT_MS });

let fixtureRun: Promise<{ run: Run; requests: ModelRequest[] }> | undefined;
function runFixture() {
  fixtureRun ??= (async () => {
    expect(existsSync(FIXTURE), "fixtures/transcripts/fixer/demo-run.json exists").toBe(true);
    const turns = JSON.parse(readFileSync(FIXTURE, "utf8")) as ScriptedTurn[];
    return scriptedLoop(turns, { demo: true });
  })();
  return fixtureRun;
}

test.describe("Done when 1: scripted transcripts → proposal, Breaker attacks, then a Fixer response", () => {
  test("the demo-run fixture runs propose → attack → propose → attack, with a verdict after each attack", async () => {
    const { run, requests } = await runFixture();
    expect(steps(run)).toEqual([
      ["breaker", "investigate"],
      ["fixer", "propose"],
      ["breaker", "attack"],
      ["fixer", "propose"],
      ["breaker", "attack"],
    ]);
    expect(stopOf(run)).toMatchObject({ reason: "budget", limit: "maxRounds" });
    expect(toolCalls(run).filter((c) => c.error), "the fixture runs clean").toEqual([]);
    for (const e of run.events) expect(e.mode).toBe("replay");

    expect(run.proposals.map((p) => p.id)).toEqual(["proposal-1", "proposal-2"]);
    const verdicts = verdictsOf(run);
    expect(verdicts.map((v) => v.proposalId)).toEqual(["proposal-1", "proposal-2"]);
    for (const v of verdicts) {
      expect(VERDICTS).toContain(v.verdict);
      expect(v.attacks.length, "each attack turn ran at least one stress_test on the proposal").toBeGreaterThan(0);
    }

    const proposal1 = indexOf(run, (e) => e.type === "proposal" && (e.data as ProposalData).proposal.id === "proposal-1");
    const attack1 = stepIndex(run, "attack", 1);
    const verdict1 = indexOf(run, (e) => e.type === "verdict" && (e.data as VerdictData).proposalId === "proposal-1");
    const propose2 = stepIndex(run, "propose", 2);
    const attackFindings1 = run.events
      .map((e, i) => ({ e, i }))
      .filter(({ e, i }) => e.type === "attack" && i > attack1 && i < propose2);
    expect(proposal1).toBeGreaterThan(-1);
    expect(attack1).toBeGreaterThan(proposal1);
    expect(attackFindings1.length).toBeGreaterThan(0);
    expect(verdict1).toBeGreaterThan(Math.max(...attackFindings1.map(({ i }) => i)));
    expect(propose2).toBeGreaterThan(verdict1);

    const attackPrompt = firstPrompt(turnStarts(requests, "attack")[0]);
    const claim = run.proposals[0].claim;
    expect(claim, "proposal-1 has a claim").toBeDefined();
    expect(attackPrompt, "the attack prompt states the claim").toContain(claim?.metric ?? "<none>");
    expect(attackPrompt).toContain(claim?.comparator ?? "<none>");
    expect(attackPrompt).toContain(String(claim?.threshold));

    const fixerResponse = firstPrompt(turnStarts(requests, "propose")[1]);
    for (const { e } of attackFindings1) expect(fixerResponse, "the Fixer sees the attack findings").toContain(e.text);
    expect(fixerResponse, "the Fixer sees the verdict").toContain(verdicts[0].verdict);
  });
});

test.describe("Done when 2: an invalid design is rejected by code and the Fixer tries again", () => {
  test("an invalid edit and an invalid submitted design are rejected, and the retry becomes the proposal", async () => {
    const [edit29] = await chain();
    const badEdit = await evidenceOf("edit_design", { design: START, change: TOO_WIDE_CHANGE });
    expect(editOf(badEdit).valid, "precondition: the edit is invalid").toBe(false);
    const holding = (await attackCandidates(editOf(edit29).design)).filter(
      (s) => stressOf(s).after.fitPct >= editOf(edit29).comparison.child.fitPct,
    );

    const { run, requests } = await scriptedLoop(
      [
        call("edit_design", { design: START, change: TOO_WIDE_CHANGE }),
        submitTurn(TOO_WIDE, fitClaim(edit29), [badEdit.id]),
        ...proposeTurns(edit29, fitClaim(edit29)),
        ...attackTurns(holding.slice(0, 1)),
      ],
      { startAt: "propose", budget: { maxRounds: 1 } },
    );

    const calls = toolCalls(run);
    const edits = calls.filter((c) => c.tool === "edit_design");
    expect((edits[0].result as EditResult).valid).toBe(false);
    expect(JSON.stringify((edits[0].result as EditResult).reasons)).toMatch(/2\.5/);
    const submits = calls.filter((c) => c.tool === "submit_proposal");
    expect(submits[0].error, "code rejects the invalid design").toMatch(/2\.5/);
    expect(submits[0].evidenceId).toBeUndefined();
    const retry = requests.find((r) => JSON.stringify(r.messages).includes(submits[0].error ?? "<none>"));
    expect(retry?.step, "the reason reaches the Fixer's next request").toBe("propose");
    expect(submits[1].evidenceId, "the retry is accepted").toMatch(/^ev-/);

    expect(run.proposals).toHaveLength(1);
    expect(proposalEvents(run)[0].design.sizes).toEqual(editOf(edit29).design.sizes);
    const evaluated = run.events.filter((e) => e.type === "evaluation").map((e) => (e.data as { designId: string }).designId);
    expect(evaluated).not.toContain(TOO_WIDE.id);
    expect(stopOf(run).reason).not.toBe("model-error");
  });

  test("a design that breaks an active limit is rejected with the limit named, and the retry is accepted", async () => {
    const [edit29] = await chain();
    const limited29 = await evidenceOf("edit_design", { design: START, change: addSize(29), limits: [SIZE_LIMIT] });
    const narrowEdit = await evidenceOf("edit_design", {
      design: START,
      change: { kind: "set_range", nominalMm: 27, minAnnulusMm: 25, maxAnnulusMm: 27.5 },
      limits: [SIZE_LIMIT],
    });
    expect(editOf(limited29).limits.some((l) => !l.pass), "precondition: four sizes fail the limit").toBe(true);
    expect(editOf(narrowEdit).valid, "precondition: the three-size edit is valid").toBe(true);
    expect(editOf(narrowEdit).limits.every((l) => l.pass)).toBe(true);
    const narrow = editOf(narrowEdit).design;

    const { run, requests } = await scriptedLoop(
      [
        call("edit_design", limited29.input),
        submitTurn(editOf(edit29).design, fitClaim(limited29), [limited29.id]),
        call("edit_design", narrowEdit.input),
        submitTurn(narrow, fitClaim(narrowEdit), [narrowEdit.id], "Widen the largest size slightly instead."),
        ...attackTurns([await evidenceOf("stress_test", stressArgs(narrow, "measurement_shift", 1))]),
      ],
      { startAt: "propose", budget: { maxRounds: 1 }, limits: [SIZE_LIMIT] },
    );

    const submits = toolCalls(run).filter((c) => c.tool === "submit_proposal");
    expect(submits[0].error, "the limit is named").toMatch(/max-sizes|limit-sizes/);
    expect(submits[0].evidenceId).toBeUndefined();
    const retry = requests.find((r) => JSON.stringify(r.messages).includes(submits[0].error ?? "<none>"));
    expect(retry?.step).toBe("propose");
    expect(submits[1].evidenceId).toMatch(/^ev-/);
    expect(run.proposals).toHaveLength(1);
    expect(proposalEvents(run)[0].design.sizes).toHaveLength(3);
    expect(stopOf(run).reason).not.toBe("model-error");
  });
});

test.describe("Done when 3: no valid fix → the run says no design fits", () => {
  test("a Fixer that ends its turn after invalid edits stops the run with no design fits", async () => {
    const { run } = await scriptedLoop(
      [
        call("edit_design", { design: START, change: TOO_WIDE_CHANGE }),
        call("edit_design", { design: START, change: DUPLICATE_CHANGE }),
        { text: "No change I tried is valid under these rules.", toolCalls: [] },
      ],
      { startAt: "propose" },
    );
    const stop = stopOf(run);
    expect(stop.reason).toBe("no-valid-fix");
    expect(stop.text).toMatch(/no design fits/i);
    expect(run.proposals).toHaveLength(0);
    expect(steps(run)).toEqual([["fixer", "propose"]]);
  });

  test("a Fixer that uses up its tool calls on invalid edits also stops with no design fits", async () => {
    const invalid = [TOO_WIDE_CHANGE, DUPLICATE_CHANGE, TOO_WIDE_CHANGE, DUPLICATE_CHANGE].map((change) =>
      call("edit_design", { design: START, change }),
    );
    const { run } = await scriptedLoop(invalid, { startAt: "propose", budget: { maxToolCallsPerTurn: 3 } });
    const stop = stopOf(run);
    expect(stop.reason).toBe("no-valid-fix");
    expect(stop.text).toMatch(/no design fits/i);
    expect(toolCalls(run)).toHaveLength(3);
    expect(run.proposals).toHaveLength(0);
  });

  test("a Fixer that runs out of tool calls after a valid edit is a budget stop, not no-valid-fix", async () => {
    const [edit29] = await chain();
    const design = editOf(edit29).design;
    const { run } = await scriptedLoop(
      [call("edit_design", edit29.input), call("evaluate_design", { design }), call("evaluate_design", { design })],
      { startAt: "propose", budget: { maxToolCallsPerTurn: 2 } },
    );
    expect(stopOf(run)).toMatchObject({ reason: "budget", limit: "maxToolCallsPerTurn" });
  });
});

test.describe("Done when 4: a proposal shows before and after, new risks and trade-offs, linked to evidence, with a structured claim", () => {
  test("each fixture proposal is complete and its numbers match code evidence and an independent tool call", async () => {
    const { run } = await runFixture();
    const byId = new Map(run.evidence.map((e) => [e.id, e]));
    const designs = new Map<string, Design>([[START.id, START]]);
    const startData = run.events.find((e) => e.type === "run-start")?.data as { design?: Design } | undefined;
    if (startData?.design) designs.set(startData.design.id, startData.design);
    const events = proposalEvents(run);
    expect(events).toHaveLength(run.proposals.length);
    expect(run.proposals.length).toBeGreaterThan(0);

    for (const [i, proposal] of run.proposals.entries()) {
      const data = events[i];
      expect(data.proposal.id).toBe(proposal.id);
      designs.set(data.design.id, data.design);
      expect(proposal.toDesignId).toBe(data.design.id);

      expect(ClaimSchema.safeParse(proposal.claim).success, "a structured claim").toBe(true);
      expect(proposal.tradeOffs.length, "trade-offs").toBeGreaterThan(0);
      for (const t of proposal.tradeOffs) expect(t.trim().length).toBeGreaterThan(0);
      expect(proposal.evidenceIds.length).toBeGreaterThan(0);
      for (const id of proposal.evidenceIds) expect(byId.has(id), `${proposal.id} cites ${id}`).toBe(true);
      const editCited = proposal.evidenceIds
        .map((id) => byId.get(id))
        .find((e) => e?.tool === "edit_design" && JSON.stringify(editOf(e).design?.sizes) === JSON.stringify(data.design.sizes));
      expect(editCited, `${proposal.id} cites the edit_design result for its design`).toBeDefined();

      const { comparison } = data;
      expect(SummarySchema.safeParse(comparison?.before).success, "before numbers").toBe(true);
      expect(SummarySchema.safeParse(comparison?.after).success, "after numbers").toBe(true);
      expect(Array.isArray(comparison.newRiskHeartIds), "new risks").toBe(true);
      const linked = byId.get(comparison.evidenceId);
      expect(linked?.tool, "the comparison is linked to code evidence").toBe("evaluate_design");
      const linkedInput = linked?.input as { design: Design; parent: Design };
      const from = designs.get(proposal.fromDesignId);
      expect(from, `known parent ${proposal.fromDesignId}`).toBeDefined();
      expect(linkedInput.design.sizes).toEqual(data.design.sizes);
      expect(linkedInput.parent.sizes).toEqual(from?.sizes);
      const linkedResult = linked?.result as Summary;
      expect(linkedResult.fitPct).toBe(comparison.after.fitPct);
      expect(linkedResult.newRiskHeartIds).toEqual(comparison.newRiskHeartIds);

      const parentEvaluation = run.events
        .filter((e) => e.type === "evaluation")
        .map((e) => e.data as { designId: string; summary: Summary })
        .find((e) => e.designId === proposal.fromDesignId);
      expect(parentEvaluation, "the parent was evaluated by code").toBeDefined();
      for (const key of ["fit", "risk", "noFit", "fitPct"] as const) {
        expect(comparison.before[key], `before.${key}`).toBe(parentEvaluation?.summary[key]);
      }

      const independent = (await evidenceOf("evaluate_design", { design: data.design, parent: from })).result as Summary;
      for (const key of ["fit", "risk", "noFit", "fitPct"] as const) expect(comparison.after[key], `after.${key}`).toBe(independent[key]);
      expect(comparison.newRiskHeartIds).toEqual(independent.newRiskHeartIds);

      expect(VERDICTS).toContain(proposal.verdict);
      expectNotShown(proposal.notShown);
    }
  });
});

test.describe("Done when 5: code assigns each verdict, with what it doesn't show", () => {
  async function setup() {
    const [edit29] = await chain();
    const design = editOf(edit29).design;
    const dev = editOf(edit29).comparison.child.fitPct;
    const candidates = await attackCandidates(design);
    const holding = candidates.filter((s) => stressOf(s).after.fitPct >= dev);
    const breaking = candidates.filter((s) => stressOf(s).after.fitPct < dev);
    expect(holding.length, "precondition: two attacks keep fitPct at or above the dev value").toBeGreaterThanOrEqual(2);
    expect(breaking.length, "precondition: an attack drops fitPct below the dev value").toBeGreaterThanOrEqual(1);
    return { edit29, design, dev, holding, breaking };
  }

  test("holds on the dev hearts and under every attack → supported_under_conditions", async () => {
    const { edit29, dev, holding } = await setup();
    const { run } = await scriptedLoop([...proposeTurns(edit29, fitClaim(edit29)), ...attackTurns(holding.slice(0, 2))], {
      startAt: "propose",
      budget: { maxRounds: 1 },
    });
    const v = onlyVerdict(run);
    expect(v.verdict).toBe("supported_under_conditions");
    expect(v.dev).toMatchObject({ metric: "fitPct", holds: true });
    expect(v.dev.value).toBeCloseTo(dev, 6);
    expect(v.attacks).toHaveLength(2);
    expectAttack(v.attacks[0], holding[0], true);
    expectAttack(v.attacks[1], holding[1], true);
  });

  test("holds on the dev hearts but fails under one attack → context_dependent", async () => {
    const { edit29, holding, breaking } = await setup();
    const { run } = await scriptedLoop(
      [...proposeTurns(edit29, fitClaim(edit29)), ...attackTurns([holding[0], breaking[0]], "One shift breaks the claim")],
      { startAt: "propose", budget: { maxRounds: 1 } },
    );
    const v = onlyVerdict(run);
    expect(v.verdict).toBe("context_dependent");
    expect(v.dev.holds).toBe(true);
    expect(v.attacks).toHaveLength(2);
    expectAttack(v.attacks[0], holding[0], true);
    expectAttack(v.attacks[1], breaking[0], false);
  });

  test("fails on the dev hearts → contradicted (newRiskCount claim)", async () => {
    const { edit29, design, holding } = await setup();
    const devNewRisk = ((await evidenceOf("evaluate_design", { design, parent: START })).result as Summary).newRiskHeartIds.length;
    expect(devNewRisk, "precondition: the change adds at-risk hearts").toBeGreaterThanOrEqual(1);
    const claim: Claim = { metric: "newRiskCount", comparator: "<=", threshold: devNewRisk - 1 };
    const { run } = await scriptedLoop([...proposeTurns(edit29, claim), ...attackTurns(holding.slice(0, 1))], {
      startAt: "propose",
      budget: { maxRounds: 1 },
    });
    const v = onlyVerdict(run);
    expect(v.verdict).toBe("contradicted");
    expect(v.dev).toEqual({ metric: "newRiskCount", value: devNewRisk, holds: false });
  });

  test("the budget runs out before any attack finishes → inconclusive", async () => {
    const { edit29, design, holding } = await setup();
    const { run } = await scriptedLoop(
      [
        ...proposeTurns(edit29, fitClaim(edit29)),
        { toolCalls: [{ name: "evaluate_design", args: { design } }, { name: "evaluate_design", args: { design } }] },
        ...attackTurns(holding.slice(0, 1)),
      ],
      { startAt: "propose", budget: { maxRounds: 1, maxToolCallsPerTurn: 2 } },
    );
    expect(stopOf(run)).toMatchObject({ reason: "budget", limit: "maxToolCallsPerTurn" });
    expect(toolCalls(run).some((c) => c.tool === "stress_test"), "no attack ran").toBe(false);
    const v = onlyVerdict(run);
    expect(v.verdict).toBe("inconclusive");
    expect(v.dev.holds).toBe(true);
    expect(v.attacks).toEqual([]);
    expect(v.notShown.some((item) => /no attack/i.test(item)), JSON.stringify(v.notShown)).toBe(true);
  });

  test("cited evidence that doesn't match the proposed design → invalid_experiment", async () => {
    const { edit29, design, holding } = await setup();
    const startEval = await evidenceOf("evaluate_design", { design: START });
    const { run } = await scriptedLoop(
      [
        call("evaluate_design", { design: START }),
        submitTurn(design, fitClaim(edit29), [startEval.id]),
        ...attackTurns(holding.slice(0, 1)),
      ],
      { startAt: "propose", budget: { maxRounds: 1 } },
    );
    const v = onlyVerdict(run);
    expect(v.verdict).toBe("invalid_experiment");
    expect(v.notShown.some((item) => /evidence/i.test(item)), JSON.stringify(v.notShown)).toBe(true);
  });
});

test.describe("Done when 6: an attack that finds nothing is a valid result", () => {
  test("a 'Survived' report is recorded as an attack result, not an error", async () => {
    const [edit29] = await chain();
    const dev = editOf(edit29).comparison.child.fitPct;
    const holding = (await attackCandidates(editOf(edit29).design)).filter((s) => stressOf(s).after.fitPct >= dev);
    expect(holding.length, "precondition: an attack that keeps the claim").toBeGreaterThan(0);
    const survived = holding[0];
    const { run } = await scriptedLoop(
      [
        ...proposeTurns(edit29, fitClaim(edit29)),
        call("stress_test", survived.input),
        report(finding("Survived: the claim held under the shift", "The proposal's claim still held under this attack, so nothing broke.", [survived.id])),
      ],
      { startAt: "propose", budget: { maxRounds: 1 } },
    );

    const attacks = run.findings.filter((f) => f.kind === "attack");
    expect(attacks).toHaveLength(1);
    expect(attacks[0].title).toMatch(/^Survived/);
    expect(attacks[0].evidenceIds).toEqual([survived.id]);
    expect(run.events.some((e) => e.type === "attack" && /^Survived/.test(e.text)), "survived is in the feed").toBe(true);
    const reportCall = toolCalls(run).find((c) => c.tool === "report_findings");
    expect(reportCall?.evidenceId).toMatch(/^ev-/);
    expect(reportCall?.error).toBeUndefined();
    expect(toolCalls(run).filter((c) => c.error)).toEqual([]);
    expect(run.events.filter((e) => /error/i.test(e.type))).toEqual([]);
    expect(stopOf(run)).toMatchObject({ reason: "budget", limit: "maxRounds" });

    const v = onlyVerdict(run);
    expect(v.verdict).toBe("supported_under_conditions");
    expect(v.attacks).toHaveLength(1);
    expectAttack(v.attacks[0], survived, true);
  });
});

test.describe("Done when 7: demo mode is one Breaker turn and at most 2 Fixer rounds", () => {
  async function threeRoundScript(): Promise<ScriptedTurn[]> {
    const edits = await chain();
    const rounds = await Promise.all(
      edits.map(async (edit) => [
        ...proposeTurns(edit, fitClaim(edit)),
        ...attackTurns([await evidenceOf("stress_test", stressArgs(editOf(edit).design, "measurement_shift", 1))]),
      ]),
    );
    return [...(await investigateTurns()), ...rounds.flat()];
  }
  const DEMO_STEPS = [
    ["breaker", "investigate"],
    ["fixer", "propose"],
    ["breaker", "attack"],
    ["fixer", "propose"],
    ["breaker", "attack"],
  ];
  const expectDemo = (run: Run) => {
    expect(steps(run)).toEqual(DEMO_STEPS);
    expect(stopOf(run)).toMatchObject({ reason: "budget", limit: "maxRounds" });
    const start = run.events.find((e) => e.type === "run-start")?.data as { budget: { maxRounds: number } };
    expect(start.budget.maxRounds).toBe(2);
    expect(run.proposals).toHaveLength(2);
    for (const p of run.proposals) expect(VERDICTS, `${p.id} has a verdict`).toContain(p.verdict);
    expect(verdictsOf(run)).toHaveLength(2);
  };

  test("in code, demo mode caps a three-round script at one Breaker turn and two Fixer rounds", async () => {
    const { attack } = await load();
    expect(attack.DEMO_MAX_ROUNDS).toBe(2);
    const turns = await threeRoundScript();
    expectDemo((await scriptedLoop(turns, { demo: true, budget: { maxRounds: 3 } })).run);

    const full = (await scriptedLoop(turns, { budget: { maxRounds: 3 } })).run;
    expect(steps(full).filter(([, s]) => s === "propose"), "the full loop is still available").toHaveLength(3);
    expect(steps(full).filter(([, s]) => s === "investigate")).toHaveLength(1);
    expect(full.proposals.every((p) => p.verdict !== undefined)).toBe(true);
  });

  test("over HTTP, a demo run does the same", async ({ request }) => {
    test.setTimeout(SCRIPTED_TIMEOUT_MS + RUN_TIMEOUT_MS);
    const turns = await threeRoundScript();
    const started = await request.post("/api/runs", {
      data: { model: { kind: "scripted", turns }, demo: true, budget: { maxRounds: 3 } },
    });
    expect(started.status()).toBe(201);
    const { id } = (await started.json()) as { id: string };
    let run: Run | undefined;
    await expect
      .poll(
        async () => {
          const view = (await (await request.get(`/api/runs/${id}`)).json()) as { status: string; run: Run };
          run = view.run;
          return view.status;
        },
        { timeout: RUN_TIMEOUT_MS },
      )
      .toBe("finished");
    if (!run) throw new Error("no run");
    expect(RunSchema.safeParse(run).success).toBe(true);
    expectDemo(run);
  });
});

test.describe("Guardrails and wiring", () => {
  test("an invented number in the Fixer's rationale is rejected with the reason, and one retry is accepted", async () => {
    const [edit29] = await chain();
    const design = editOf(edit29).design;
    const cited = JSON.stringify([edit29.input, edit29.result]).match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    expect(cited.some((n) => Math.abs(n - INVENTED) < 1), "precondition: the number is absent").toBe(false);
    const { run, requests } = await scriptedLoop(
      [
        call("edit_design", edit29.input),
        submitTurn(design, fitClaim(edit29), [edit29.id], `This change seats ${INVENTED} more hearts.`),
        submitTurn(design, fitClaim(edit29), [edit29.id]),
        ...attackTurns([await evidenceOf("stress_test", stressArgs(design, "measurement_shift", 1))]),
      ],
      { startAt: "propose", budget: { maxRounds: 1 } },
    );
    const submits = toolCalls(run).filter((c) => c.tool === "submit_proposal");
    expect(submits[0].error).toContain(String(INVENTED));
    const retry = requests.find((r) => JSON.stringify(r.messages).includes(submits[0].error ?? "<none>"));
    expect(retry?.step).toBe("propose");
    expect(run.proposals).toHaveLength(1);
    expect(run.proposals[0].rationale).not.toContain(String(INVENTED));
  });

  test("the loop's default roles are the REQ-11 Fixer and attack roles", async () => {
    const { fixer, attack, roles } = await load();
    expect(roles.defaultRoles.propose).toBe(fixer.fixerRole);
    expect(roles.defaultRoles.attack).toBe(attack.attackRole);
    expect(fixer.fixerRole.actor).toBe("fixer");
    expect(fixer.fixerRole.terminalTool).toBe("submit_proposal");
    expect([...fixer.fixerRole.toolNames].sort()).toEqual(["edit_design", "evaluate_design", "submit_proposal"]);
    expect(typeof fixer.fixerRole.validate).toBe("function");
    expect(attack.attackRole.actor).toBe("breaker");
    expect(attack.attackRole.terminalTool).toBe("report_findings");
  });
});

let liveRun: Promise<{ run: Run; ms: number; requests: ModelRequest[]; key: string }> | undefined;
function runLive() {
  liveRun ??= (async () => {
    const { attack, modelClient } = await load();
    const gemini = await import("../../src/agents/gemini");
    const key = gemini.readGeminiKey();
    const { client, requests } = capture(modelClient.createModelClient({ kind: "gemini" }));
    const started = Date.now();
    const run = await attack.runLoop({ model: client, demo: true });
    return { run, ms: Date.now() - started, requests, key };
  })();
  return liveRun;
}

test.describe.serial("live Gemini", () => {
  test("Done when 8: attack findings change the Fixer's next step, or it says why not @live", async () => {
    test.setTimeout(20 * 60_000);
    const { run, requests } = await runLive();
    const stop = stopOf(run);
    const { STARTING_VALVE } = await import("../../src/engine");
    expect(START.sizes, "the spec's starting valve is the project's canonical one").toEqual(STARTING_VALVE.sizes);
    const runStart = run.events.find((e) => e.type === "run-start")?.data as { design?: Design } | undefined;
    expect(runStart?.design?.id, "the run started from the starting valve").toBe(STARTING_VALVE.id);
    expect(runStart?.design?.sizes).toEqual(STARTING_VALVE.sizes);
    expect(run.startDesignId).toBe(STARTING_VALVE.id);
    const firstProposal = run.proposals.find((p) => p.id === "proposal-1");
    if (firstProposal) expect(firstProposal.fromDesignId, "proposal-1 starts from the starting valve").toBe(STARTING_VALVE.id);
    const attack1 = stepIndex(run, "attack", 1);
    expect(attack1, `the run reached an attack: ${stop.reason} ${stop.detail}`).toBeGreaterThan(-1);
    const propose2 = stepIndex(run, "propose", 2);
    expect(propose2, `a second Fixer step followed the attack: ${stop.reason} ${stop.detail}`).toBeGreaterThan(attack1);

    const attackFindings = run.events.filter((e, i) => e.type === "attack" && i > attack1 && i < propose2);
    expect(attackFindings.length).toBeGreaterThan(0);
    const fixerPrompt = firstPrompt(turnStarts(requests, "propose")[1]);
    for (const f of attackFindings) expect(fixerPrompt, "the Fixer was given the attack findings").toContain(f.text);

    const attackEvidence = new Set(attackFindings.flatMap((f) => (f.data as { evidenceIds?: string[] }).evidenceIds ?? []));
    const attackTitles = attackFindings.map((f) => f.text.trim().toLowerCase()).filter((t) => t.length > 0);
    const attackKinds = run.events
      .slice(attack1, propose2)
      .filter((e) => e.type === "tool-call")
      .map((e) => e.data as ToolCallData)
      .filter((c) => c.tool === "stress_test" && c.evidenceId)
      .map((c) => (c.input as { kind?: string }).kind ?? "")
      .filter((kind) => kind.length > 0);
    expect(attackEvidence.size, "the round-1 attack findings cite evidence").toBeGreaterThan(0);
    const namesAttackFinding = (text: string) => {
      const lower = text.replace(/\s+/g, " ").toLowerCase();
      return (
        [...attackEvidence].some((id) => lower.includes(id.toLowerCase())) ||
        attackTitles.some((title) => lower.includes(title.replace(/\s+/g, " "))) ||
        attackKinds.some((kind) => new RegExp(`\\b${kind}\\b`, "i").test(text))
      );
    };

    const round2 = run.events.slice(propose2);
    const round2End = round2.findIndex((e) => e.type === "step-start" && e.actor !== "fixer");
    const fixerEvents = round2End === -1 ? round2 : round2.slice(0, round2End);
    const proposal2 = fixerEvents.find((e) => e.type === "proposal")?.data as ProposalData | undefined;
    const proposal2Full = run.proposals.find((p) => p.id === proposal2?.proposal.id);
    const proposal1Full = run.proposals.find((p) => p.id === "proposal-1");
    const proposal1Design = proposalEvents(run).find((p) => p.proposal.id === "proposal-1")?.design;
    expect(proposal1Full, "proposal-1 exists").toBeDefined();

    const citesAttack = (proposal2Full?.evidenceIds ?? []).some((id) => attackEvidence.has(id));
    const fixerText = [
      proposal2Full?.rationale ?? "",
      ...(proposal2Full?.tradeOffs ?? []),
      ...fixerEvents.filter((e) => e.actor === "fixer" && e.type === "model-text").map((e) => e.text),
    ].join(" ");
    const stepChanged =
      proposal2 !== undefined &&
      (JSON.stringify(proposal2.design.sizes) !== JSON.stringify(proposal1Design?.sizes) ||
        JSON.stringify(proposal2Full?.claim) !== JSON.stringify(proposal1Full?.claim));
    const changedAndNamesFinding = stepChanged && namesAttackFinding(fixerText);
    const statedReasons = fixerEvents
      .filter((e) => e.type === "attack-response")
      .map((e) => e.data as { changed?: boolean; reason?: string; evidenceIds?: string[] });
    const statesWhyNot = statedReasons.some(
      (r) =>
        typeof r.reason === "string" &&
        r.reason.trim().length > 0 &&
        ((r.evidenceIds ?? []).some((id) => attackEvidence.has(id)) || namesAttackFinding(r.reason)),
    );
    expect(
      citesAttack || changedAndNamesFinding || statesWhyNot,
      `round-2 Fixer must cite attack evidence, change its design or claim while naming an attack finding, or emit an attack-response reason naming one: ${JSON.stringify({ stepChanged, statedReasons, fixerText: fixerText.slice(0, 400) })}`,
    ).toBe(true);
  });

  test("Done when 9: no agent call scores hidden hearts, demo run time recorded, run saved @live", async () => {
    test.setTimeout(20 * 60_000);
    const { run, ms, key } = await runLive();
    const hidden = (
      JSON.parse(readFileSync(path.join(ROOT, "server-data/hearts.hidden.json"), "utf8")) as { hearts: Heart[] }
    ).hearts.map((h) => h.id);
    const mentionsHidden = (value: unknown) => {
      const text = JSON.stringify(value);
      return hidden.filter((id) => new RegExp(`"${id}"`).test(text));
    };
    for (const c of toolCalls(run).filter((call) => call.evidenceId)) {
      expect(AGENT_TOOLS, `only the 9 agent tools ran: ${c.tool}`).toContain(c.tool);
      expect(c.tool).not.toMatch(/score/i);
      expect(mentionsHidden([c.input, c.result]), `${c.tool} touched hidden hearts`).toEqual([]);
    }
    expect(mentionsHidden(run.evidence), "no evidence mentions a hidden heart").toEqual([]);
    expect(run.hiddenScoreCount).toBe(0);

    expect(steps(run).filter(([, s]) => s === "investigate")).toHaveLength(1);
    expect(steps(run).filter(([, s]) => s === "propose").length).toBeLessThanOrEqual(2);
    for (const p of run.proposals) expect(VERDICTS).toContain(p.verdict);

    const stop = stopOf(run);
    const summary = { at: new Date().toISOString(), runId: run.id, demoRunMs: ms, stop: stop.reason, detail: stop.detail, steps: steps(run) };
    mkdirSync(RECORDINGS, { recursive: true });
    writeFileSync(path.join(RECORDINGS, "req-11-live-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
    test.info().annotations.push({ type: "demo-run-ms", description: String(ms) });
    console.log(`REQ-11 live demo run: ${ms} ms, stopped ${stop.reason}`);

    const file = path.join(RECORDINGS, `${run.id}.json`);
    expect(existsSync(file), `recording for ${run.id}`).toBe(true);
    const text = readFileSync(file, "utf8");
    expect(text.includes(key), "the recording doesn't contain the key").toBe(false);
    const saved = RunSchema.parse(JSON.parse(text));
    expect(saved.id).toBe(run.id);
    expect(saved.events.length).toBe(run.events.length);
    expect(saved.evidence.length).toBeGreaterThan(0);
    for (const e of saved.events) expect(e.mode).toBe("live");

    const savedStart = saved.events.find((e) => e.type === "run-start");
    const savedStop = saved.events.at(-1);
    expect(savedStart, "the recording has the run-start event").toBeDefined();
    expect(savedStop?.type, "the recording ends with run-stop").toBe("run-stop");
    const recordedMs = Date.parse(savedStop?.at ?? "") - Date.parse(savedStart?.at ?? "");
    expect(Number.isFinite(recordedMs), "run-start and run-stop carry parseable times").toBe(true);
    expect(recordedMs, "the system records a positive demo run time").toBeGreaterThan(0);
    expect(recordedMs, "the recorded run time fits inside the measured run").toBeLessThanOrEqual(ms + 1_000);
    expect(recordedMs, "the recorded run time matches the measured run").toBeGreaterThanOrEqual(ms - 5_000);

    const written = JSON.parse(readFileSync(path.join(RECORDINGS, "req-11-live-summary.json"), "utf8")) as {
      runId: string;
      demoRunMs: number;
    };
    expect(written.runId).toBe(run.id);
    expect(written.demoRunMs, "the demo run time is written to the summary").toBeGreaterThan(0);
    expect(written.demoRunMs).toBe(ms);
  });
});
