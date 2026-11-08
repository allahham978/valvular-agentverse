import { expect, test } from "@playwright/test";
import type { Design, Run, RunEvent } from "../../src/contracts/index";
import type { ModelClient, ModelMessage, ModelRequest, ModelTurn, ScriptedTurn } from "../../src/agents/model-client";

// Fix: live reports were 8 to 16 KB (3 long findings) and a number-guard rejection cost a second long rewrite.
// Reports are capped in the tool schema, and the forced wrap-up message lists the numbers the guard allows.

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

async function load() {
  const orchestrator = await import("../../src/orchestrator");
  const roles = await import("../../src/orchestrator/roles");
  const modelClient = await import("../../src/agents/model-client");
  const tools = await import("../../src/tools");
  return { orchestrator, roles, modelClient, tools };
}

const finding = (explanation: string, evidenceIds: string[], title = "Failures cluster by rule") => ({
  title,
  explanation,
  heartIds: [],
  severity: "low",
  evidenceIds,
});

test.describe("short reports", () => {
  test("report_findings schema allows 2 short findings citing up to 3 evidence IDs", async () => {
    const { tools } = await load();
    const registry = tools.createAgentTools();
    const call = (mechanisms: unknown[]) => registry.call("report_findings", { mechanisms });
    const ok = finding("Short mechanism.", ["ev-a", "ev-b", "ev-c"]);

    expect((await call([ok, ok])).ok, "two short findings pass").toBe(true);
    expect((await call([ok, ok, ok])).ok, "three findings are rejected").toBe(false);
    expect((await call([finding("x".repeat(301), ["ev-a"])])).ok, "a 301 char explanation is rejected").toBe(false);
    expect((await call([finding("Short.", ["ev-a", "ev-b", "ev-c", "ev-d"])])).ok, "four evidence IDs are rejected").toBe(false);
    const spec = JSON.stringify(registry.specs().find((s) => s.name === "report_findings")?.parameters);
    expect(spec).toContain('"maxItems":2');
    expect(spec).toContain('"maxLength":300');
  });

  test("submit_proposal rationale and stress_test hypothesis are short", async () => {
    const { tools } = await load();
    const registry = tools.createAgentTools();
    const proposal = await registry.call("submit_proposal", {
      design: START,
      rationale: "r".repeat(301),
      tradeOffs: ["t"],
      evidenceIds: ["ev-a"],
    });
    expect(proposal.ok, "a 301 char rationale is rejected").toBe(false);
    const stress = await registry.call("stress_test", {
      design: START,
      kind: "measurement_shift",
      amount: 1,
      hypothesis: "h".repeat(301),
      disprovedIf: "Fit drops.",
    });
    expect(stress.ok, "a 301 char hypothesis is rejected").toBe(false);
  });

  test("the prompts ask for at most 2 one-line findings", async () => {
    const { roles } = await load();
    const ctx = { step: "investigate", round: 1, design: START, summary: { fitPct: 50, risk: 1, noFit: 1, total: 4 }, findings: [], proposals: [], limits: [], evidence: [] } as never;
    const text = roles.defaultRoles.investigate.prompt(ctx);
    expect(text).toMatch(/at most 2 findings/i);
    expect(text).toMatch(/one line/i);
  });

  test("the wrap-up message lists the numbers the guard allows, so the report passes first time", async () => {
    const { orchestrator, roles, modelClient, tools } = await load();
    const registry = tools.createAgentTools();
    const evaluated = await registry.call("evaluate_design", { design: START });
    if (!evaluated.ok) throw new Error(evaluated.error);
    const busy: ScriptedTurn = {
      toolCalls: [
        { name: "evaluate_design", args: { design: START } },
        { name: "group_failures", args: { design: START, by: "rule" } },
      ],
    };
    const turns: ScriptedTurn[] = [
      ...Array.from({ length: 12 }, () => busy),
      { toolCalls: [{ name: "report_findings", args: { mechanisms: [finding("Failures group by rule.", ["$lastEvidenceId"])] } }] },
    ];
    const inner = modelClient.createScriptedClient(turns);
    const requests: ModelRequest[] = [];
    const client: ModelClient = {
      mode: inner.mode,
      nextTurn(request: ModelRequest): Promise<ModelTurn> {
        requests.push({ ...request, messages: JSON.parse(JSON.stringify(request.messages)) as ModelMessage[] });
        return inner.nextTurn(request);
      },
    };
    const run: Run = await orchestrator.executeRun({
      model: client,
      tools: registry,
      roles: roles.defaultRoles,
      startDesign: START,
      stopAfter: "investigate",
    });
    expect(run.events.at(-1)?.data).toMatchObject({ reason: "investigated" });

    const last = requests.at(-1)!;
    expect(last.allowedTools).toEqual(["report_findings"]);
    const wrap = last.messages.filter((m) => m.role === "user").at(-1) as { text: string };
    expect(wrap.text).toMatch(/allowed numbers/i);
    const evidenceIds = run.events.flatMap((e: RunEvent) => (e.type === "tool-call" ? [(e.data as { evidenceId?: string }).evidenceId] : []));
    expect(wrap.text).toContain(evidenceIds[0]);
    for (const size of START.sizes) expect(wrap.text).toContain(String(size.nominalMm));
    expect(run.events.filter((e) => e.type === "tool-call" && (e.data as { error?: string }).error)).toHaveLength(0);
  });
});
