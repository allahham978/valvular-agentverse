import { expect, test } from "@playwright/test";
import { RunSchema, type Design, type Evidence, type Run, type RunEvent } from "../../src/contracts/index";
import type { ModelClient, ModelMessage, ModelRequest, ModelTurn, ScriptedTurn } from "../../src/agents/model-client";

// Fix track A: live turns ran past the PRD budget (8 steps, 16 tool calls, 180 s) and stopped on "budget".
// The budget stays. Code tells the model what is left in every tool response, restricts the last step
// to the turn's ending tool, and answers parallel calls past the reserve with "skipped: budget".
// Scripted tests run in-process against the real tools. The scripted model honours the tool restriction
// the way Gemini's ANY mode with allowedFunctionNames does.

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

type ToolCallData = { tool: string; evidenceId?: string; error?: string };
type StopData = { reason: string; detail: string; limit?: string };
type BudgetLeft = { toolCallsLeft: number; stepsLeft: number; secondsLeft: number };
type Reply = { name: string; evidenceId?: string; error?: string; budget?: BudgetLeft };

async function load() {
  const orchestrator = await import("../../src/orchestrator");
  const roles = await import("../../src/orchestrator/roles");
  const modelClient = await import("../../src/agents/model-client");
  const gemini = await import("../../src/agents/gemini");
  const attack = await import("../../src/agents/attack");
  const tools = await import("../../src/tools");
  return { orchestrator, roles, modelClient, gemini, attack, tools };
}

async function evidenceOf(tool: string, input: unknown): Promise<Evidence> {
  const { tools } = await load();
  const outcome = await tools.createAgentTools().call(tool, input);
  if (!outcome.ok) throw new Error(`${tool}: ${outcome.error}`);
  return outcome.evidence;
}

function capture(inner: ModelClient) {
  const requests: ModelRequest[] = [];
  const client: ModelClient = {
    mode: inner.mode,
    nextTurn(request: ModelRequest): Promise<ModelTurn> {
      requests.push({ ...request, messages: JSON.parse(JSON.stringify(request.messages)) as ModelMessage[] });
      return inner.nextTurn(request);
    },
  };
  return { client, requests };
}

const toolCalls = (run: Run) =>
  run.events.filter((e: RunEvent) => e.type === "tool-call").map((e) => e.data as ToolCallData);
const stopOf = (run: Run) => {
  const last = run.events.at(-1);
  expect(last?.type).toBe("run-stop");
  return last?.data as StopData;
};
const allowedOf = (request: ModelRequest) => (request as ModelRequest & { allowedTools?: string[] }).allowedTools;
const repliesIn = (request: ModelRequest): Reply[][] =>
  request.messages.flatMap((m) => (m.role === "tool" ? [m.replies as Reply[]] : []));

const evaluateCall = (design: Design) => ({ name: "evaluate_design", args: { design } });
const groupCall = (design: Design) => ({ name: "group_failures", args: { design, by: "rule" } });
const finding = (title: string, explanation: string, evidenceIds: string[]) => ({
  title,
  explanation,
  heartIds: [],
  severity: "low",
  evidenceIds,
});
const report = (evidenceIds: string[], title = "Failures cluster by rule"): ScriptedTurn => ({
  toolCalls: [
    { name: "report_findings", args: { mechanisms: [finding(title, "Failing hearts share a rule, as the grouping shows.", evidenceIds)] } },
  ],
});
const repeat = (count: number, turn: ScriptedTurn) => Array.from({ length: count }, () => turn);

async function breakerRun(turns: ScriptedTurn[], budget?: Record<string, number>) {
  const { orchestrator, roles, modelClient, tools } = await load();
  const { client, requests } = capture(modelClient.createScriptedClient(turns));
  const run = await orchestrator.executeRun({
    model: client,
    tools: tools.createAgentTools(),
    roles: roles.defaultRoles,
    startDesign: START,
    stopAfter: "investigate",
    ...(budget ? { budget } : {}),
  });
  expect(RunSchema.safeParse(run).success, "the run matches the Run contract").toBe(true);
  return { run, requests };
}

function expectBudgetInReplies(requests: ModelRequest[]) {
  const last = requests.at(-1);
  expect(last).toBeDefined();
  const steps = repliesIn(last!);
  expect(steps.length, "tool replies went back to the model").toBeGreaterThan(0);
  let previous = Infinity;
  for (const replies of steps) {
    for (const reply of replies) {
      expect(reply.budget, `${reply.name} reply says what is left`).toBeDefined();
      expect(typeof reply.budget?.toolCallsLeft).toBe("number");
      expect(typeof reply.budget?.stepsLeft).toBe("number");
      expect(typeof reply.budget?.secondsLeft).toBe("number");
    }
    const left = replies[0].budget?.toolCallsLeft ?? Infinity;
    expect(left, "tool calls left only go down").toBeLessThanOrEqual(previous);
    previous = left;
  }
}

test.describe("a model that keeps calling tools still ends its turn inside the PRD budget", () => {
  test("the Breaker ends with report_findings and 'investigated', not 'budget'", async () => {
    const e1 = await evidenceOf("evaluate_design", { design: START });
    const e2 = await evidenceOf("group_failures", { design: START, by: "rule" });
    const busy: ScriptedTurn = { toolCalls: [evaluateCall(START), groupCall(START)] };
    const { run, requests } = await breakerRun([...repeat(12, busy), report([e1.id, e2.id])]);

    expect(stopOf(run).reason).toBe("investigated");
    expect(run.findings.length).toBeGreaterThan(0);
    const calls = toolCalls(run);
    expect(calls.length, "never more than 16 tool calls").toBeLessThanOrEqual(16);
    expect(requests.length, "never more than 8 model steps").toBeLessThanOrEqual(8);
    expect(calls.at(-1)?.tool).toBe("report_findings");

    expect(allowedOf(requests[0]), "the first step may use every Breaker tool").toBeUndefined();
    expect(allowedOf(requests.at(-1)!), "the last step may only end the turn").toEqual(["report_findings"]);
    expectBudgetInReplies(requests);
  });

  test("one step with more parallel calls than fit runs what fits and skips the rest", async () => {
    const e1 = await evidenceOf("evaluate_design", { design: START });
    const e2 = await evidenceOf("group_failures", { design: START, by: "rule" });
    const flood: ScriptedTurn = { toolCalls: Array.from({ length: 20 }, () => groupCall(START)) };
    const { run, requests } = await breakerRun([{ toolCalls: [evaluateCall(START)] }, flood, report([e1.id, e2.id])]);

    expect(stopOf(run).reason).toBe("investigated");
    const calls = toolCalls(run);
    expect(calls.length).toBeLessThanOrEqual(16);
    expect(calls.at(-1)?.tool).toBe("report_findings");

    const floodReplies = repliesIn(requests.at(-1)!)[1];
    expect(floodReplies, "every parallel call gets a reply").toHaveLength(20);
    const skipped = floodReplies.filter((reply) => /skipped: budget/i.test(reply.error ?? ""));
    expect(skipped.length, "calls past the reserve are skipped, not run").toBeGreaterThan(0);
    expect(floodReplies.length - skipped.length + 1, "the run calls leave room for the ending tool").toBeLessThan(16);
    expect(allowedOf(requests.at(-1)!)).toEqual(["report_findings"]);
  });

  test("a slow turn is told to wrap up before its time runs out", async () => {
    const e1 = await evidenceOf("evaluate_design", { design: START });
    const slow: ScriptedTurn = { delayMs: 700, toolCalls: [evaluateCall(START)] };
    const { run, requests } = await breakerRun([...repeat(10, slow), report([e1.id], "Evaluated the starting valve")], {
      maxTurnMs: 4_000,
    });
    expect(stopOf(run).reason).toBe("investigated");
    expect(allowedOf(requests.at(-1)!)).toEqual(["report_findings"]);
  });

  test("the Fixer ends with submit_proposal and the attack with report_findings", async () => {
    const { attack, modelClient } = await load();
    const edit = await evidenceOf("edit_design", {
      design: START,
      change: { kind: "add_size", size: { nominalMm: 29, minAnnulusMm: 27, maxAnnulusMm: 29 } },
    });
    const design = (edit.result as { valid: boolean; design: Design; comparison: { child: { fitPct: number } } }).design;
    const fitPct = (edit.result as { comparison: { child: { fitPct: number } } }).comparison.child.fitPct;
    const stressArgs = {
      design,
      kind: "measurement_shift",
      amount: 1,
      hypothesis: "The claim still holds after a 1 mm shift.",
      disprovedIf: "Fit drops below the claimed threshold after the shift.",
    };
    const stress = await evidenceOf("stress_test", stressArgs);

    const turns: ScriptedTurn[] = [
      { toolCalls: [{ name: "edit_design", args: edit.input }] },
      ...repeat(10, { toolCalls: [evaluateCall(design), evaluateCall(START)] }),
      {
        toolCalls: [
          {
            name: "submit_proposal",
            args: {
              design,
              rationale: "Add the size the findings point to.",
              tradeOffs: ["One more size to stock."],
              claim: { metric: "fitPct", comparator: ">=", threshold: fitPct },
              evidenceIds: [edit.id],
            },
          },
        ],
      },
      ...repeat(10, { toolCalls: [{ name: "stress_test", args: stressArgs }, evaluateCall(design)] }),
      report([stress.id], "Shift attack ran"),
    ];
    const { client, requests } = capture(modelClient.createScriptedClient(turns));
    const run = await attack.runLoop({ model: client, startAt: "propose", budget: { maxRounds: 1 } });
    expect(RunSchema.safeParse(run).success).toBe(true);

    expect(run.proposals).toHaveLength(1);
    expect(run.proposals[0].verdict).not.toBe("inconclusive");
    expect(run.findings.some((f) => f.kind === "attack")).toBe(true);
    expect(stopOf(run)).toMatchObject({ reason: "budget", limit: "maxRounds" });

    const propose = requests.filter((r) => r.step === "propose");
    const attackSteps = requests.filter((r) => r.step === "attack");
    expect(propose.length).toBeLessThanOrEqual(8);
    expect(attackSteps.length).toBeLessThanOrEqual(8);
    expect(allowedOf(propose.at(-1)!)).toEqual(["submit_proposal"]);
    expect(allowedOf(attackSteps.at(-1)!)).toEqual(["report_findings"]);
  });

  test("the hard budget stop is still the backstop and says why", async () => {
    const busy: ScriptedTurn = { toolCalls: [evaluateCall(START), groupCall(START)] };
    const { run, requests } = await breakerRun(repeat(12, busy));
    const stop = stopOf(run);
    expect(stop.reason).toBe("budget");
    expect(["maxStepsPerTurn", "maxToolCallsPerTurn"]).toContain(stop.limit);
    expect(stop.detail.length).toBeGreaterThan(0);
    expect(toolCalls(run).length).toBeLessThanOrEqual(16);
    expect(requests.length).toBeLessThanOrEqual(8);
  });
});

test.describe("the Gemini adapter sends the restriction and the budget", () => {
  type Body = {
    contents: { role: string; parts: { functionResponse?: { response: Record<string, unknown> } }[] }[];
    toolConfig: { functionCallingConfig: { mode: string; allowedFunctionNames?: string[] } };
  };

  test("allowedFunctionNames goes out with mode ANY, and tool responses carry what is left", async () => {
    const { gemini } = await load();
    const sent: Body[] = [];
    const transport = async (request: { body: unknown }) => {
      sent.push(JSON.parse(JSON.stringify(request.body)) as Body);
      return { candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "report_findings", args: {} } }] } }] };
    };
    const client = gemini.createGeminiClient({ apiKey: "test-key", transport });
    const step1 = {
      role: "model",
      parts: [{ functionCall: { id: "call-a", name: "evaluate_design", args: { design: START } }, thoughtSignature: "c2ln" }],
    };
    const budget = { toolCallsLeft: 2, stepsLeft: 1, secondsLeft: 40 };
    const messages = [
      { role: "user", text: "Investigate." },
      { role: "model", turn: { text: "", toolCalls: [{ name: "evaluate_design", args: { design: START } }], providerState: step1 } },
      { role: "tool", replies: [{ name: "evaluate_design", evidenceId: "ev-1", result: { ok: 1 }, budget }] },
    ] as ModelMessage[];
    const base: Omit<ModelRequest, "messages"> = { actor: "breaker", step: "investigate", tools: [], signal: new AbortController().signal };

    await client.nextTurn({ ...base, messages, allowedTools: ["report_findings"] } as ModelRequest);
    await client.nextTurn({ ...base, messages } as ModelRequest);

    expect(sent[0].toolConfig.functionCallingConfig).toEqual({ mode: "ANY", allowedFunctionNames: ["report_findings"] });
    expect(sent[1].toolConfig.functionCallingConfig).toEqual({ mode: "ANY" });
    expect(sent[0].contents[1], "model content resent unchanged").toEqual(step1);
    const response = sent[0].contents[2].parts[0].functionResponse?.response;
    expect(response?.evidenceId).toBe("ev-1");
    expect(response?.budgetLeft).toEqual(budget);
  });
});
