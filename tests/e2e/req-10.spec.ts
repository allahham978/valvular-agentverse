import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { RunSchema, type Design, type Evidence, type Heart, type Run, type RunEvent, type Summary } from "../../src/contracts/index";
import type { ModelClient, ModelRequest, ModelTurn, ScriptedTurn } from "../../src/agents/model-client";

// REQ-10: Breaker agent and the live Gemini ModelClient.
// Scripted tests run in-process against the real REQ-9 tools: no key, no network, no wall-clock races.
// @live tests read the key from .env.local and call Gemini.

const ROOT = process.cwd();
const RECORDINGS = path.join(ROOT, "fixtures/recordings");
const TRANSCRIPT = path.join(ROOT, "fixtures/transcripts/breaker/starting-valve.json");
const RUN_TIMEOUT_MS = 60_000;

const devHearts = (JSON.parse(readFileSync(path.join(ROOT, "data/hearts.dev.json"), "utf8")) as { hearts: Heart[] }).hearts;
const HIDDEN = (
  JSON.parse(readFileSync(path.join(ROOT, "server-data/hearts.hidden.json"), "utf8")) as { hearts: Heart[] }
).hearts[0];

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
const VALVE_B: Design = {
  id: "req10-valve-b",
  label: "Larger sizes valve",
  hypothetical: true,
  sizes: [
    { nominalMm: 25, minAnnulusMm: 23, maxAnnulusMm: 25 },
    { nominalMm: 27, minAnnulusMm: 25, maxAnnulusMm: 27 },
    { nominalMm: 29, minAnnulusMm: 27, maxAnnulusMm: 29 },
  ],
};
const BREAKER_TOOL_NAMES = [
  "evaluate_design",
  "group_failures",
  "profile_group",
  "inspect_heart",
  "what_if",
  "stress_test",
  "report_findings",
];
const NON_ANNULUS_KEYS = /sinusMm|sinotubularJunctionMm|lvotMm|sinusHeightMm|aorticValveArea|angleDeg|lvotOverAnnulusAreaRatio|sinus-clearance|stj-excess/;
const NON_ANNULUS_WORDS = /sinus|sinotubular|\bSTJ\b|junction|LVOT|outflow tract|height|angle|valve area/i;
const INVENTED = 4242;

async function load() {
  const breaker = await import("../../src/agents/breaker");
  const gemini = await import("../../src/agents/gemini");
  const tools = await import("../../src/tools");
  const orchestrator = await import("../../src/orchestrator");
  const roles = await import("../../src/orchestrator/roles");
  const modelClient = await import("../../src/agents/model-client");
  return { breaker, gemini, tools, orchestrator, roles, modelClient };
}

type ToolCallData = { tool: string; input: unknown; evidenceId?: string; result?: unknown; error?: string };
type StopData = { reason: string; detail: string; limit?: string };

const toolCalls = (run: Run) =>
  run.events.filter((e: RunEvent) => e.type === "tool-call").map((e) => e.data as ToolCallData);
const stopOf = (run: Run) => {
  const last = run.events.at(-1);
  expect(last?.type).toBe("run-stop");
  return last?.data as StopData;
};
const rejections = (run: Run) => toolCalls(run).filter((c) => c.tool === "report_findings" && c.error);

function numbersIn(text: string): number[] {
  return (text.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

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

async function evidenceOf(tool: string, input: unknown): Promise<Evidence> {
  const { tools } = await load();
  const outcome = await tools.createAgentTools().call(tool, input);
  if (!outcome.ok) throw new Error(`${tool}: ${outcome.error}`);
  return outcome.evidence;
}

const finding = (title: string, explanation: string, evidenceIds: string[], heartIds: string[] = []) => ({
  title,
  explanation,
  heartIds,
  severity: "medium",
  evidenceIds,
});
const report = (...mechanisms: ReturnType<typeof finding>[]): ScriptedTurn => ({
  toolCalls: [{ name: "report_findings", args: { mechanisms } }],
});

async function breakerRun(model: ModelClient, budget?: Record<string, number>): Promise<Run> {
  const { orchestrator, roles, breaker, tools } = await load();
  return orchestrator.executeRun({
    model,
    tools: tools.createAgentTools(),
    roles: { ...roles.defaultRoles, ...breaker.breakerRoles },
    startDesign: START,
    stopAfter: "investigate",
    ...(budget ? { budget } : {}),
  });
}

async function scriptedBreaker(turns: ScriptedTurn[], budget?: Record<string, number>) {
  const { modelClient } = await load();
  const { client, requests } = capture(modelClient.createScriptedClient(turns));
  const run = await breakerRun(client, budget);
  expect(RunSchema.safeParse(run).success).toBe(true);
  return { run, requests };
}

function expectCitesRunEvidence(run: Run) {
  const known = new Set(run.evidence.map((e) => e.id));
  const produced = new Set(toolCalls(run).flatMap((c) => (c.evidenceId ? [c.evidenceId] : [])));
  expect(run.findings.length).toBeGreaterThan(0);
  for (const f of run.findings) {
    expect(f.evidenceIds.length, f.title).toBeGreaterThan(0);
    for (const id of f.evidenceIds) {
      expect(known.has(id), `${f.title} cites ${id}, which is in run.evidence`).toBe(true);
      expect(produced.has(id), `${f.title} cites ${id}, which a tool produced in this run`).toBe(true);
    }
  }
}

test.describe("Done when 1: scripted transcript → findings cite valid evidence", () => {
  test("the starting-valve transcript runs through the real tools and reports cited findings", async () => {
    const { breaker, modelClient } = await load();
    expect(existsSync(TRANSCRIPT), "fixtures/transcripts/breaker/starting-valve.json exists").toBe(true);
    const turns = JSON.parse(readFileSync(TRANSCRIPT, "utf8")) as ScriptedTurn[];
    const run = await breaker.runBreaker({ model: modelClient.createScriptedClient(turns) });

    expect(RunSchema.safeParse(run).success).toBe(true);
    expect(stopOf(run).reason).toBe("investigated");
    expectCitesRunEvidence(run);
    for (const f of run.findings) expect(f.kind).toBe("mechanism");
    expect(rejections(run), "no report was rejected").toEqual([]);
    const used = new Set(toolCalls(run).filter((c) => c.evidenceId && c.tool !== "report_findings").map((c) => c.tool));
    expect(used.size, `different tools: ${[...used].join(", ")}`).toBeGreaterThanOrEqual(3);
    for (const e of run.events) expect(e.mode).toBe("replay");
  });
});

test.describe("Done when 2: an invented number is rejected, with one retry", () => {
  test("a number not in the evidence is rejected with the reason, and the retry is accepted", async () => {
    const e1 = await evidenceOf("evaluate_design", { design: START });
    const e2 = await evidenceOf("group_failures", { design: START, by: "rule" });
    const cited = numbersIn(JSON.stringify([e1.input, e1.result, e2.input, e2.result]));
    expect(cited.some((n) => Math.abs(n - INVENTED) < 1), "precondition: the invented number is absent").toBe(false);

    const bad = `About ${INVENTED} hearts fail the sinus clearance rule.`;
    const { run, requests } = await scriptedBreaker([
      {
        toolCalls: [
          { name: "evaluate_design", args: { design: START } },
          { name: "group_failures", args: { design: START, by: "rule" } },
        ],
      },
      report(finding("Sinus clearance failures", bad, [e1.id, e2.id])),
      report(finding("Failures cluster by rule", "Most failing hearts share one rule, as grouped.", [e2.id])),
    ]);

    const rejected = rejections(run);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].error).toContain(String(INVENTED));
    expect(JSON.stringify(rejected[0].input), "the rejected text is logged").toContain(bad);
    expect(requests, "exactly one retry").toHaveLength(3);
    expect(JSON.stringify(requests[2].messages), "the retry carries the reason").toContain(String(INVENTED));
    expect(JSON.stringify(requests[2].messages)).toContain(rejected[0].error ?? "<none>");
    expect(run.findings.map((f) => f.title)).toEqual(["Failures cluster by rule"]);
    expect(stopOf(run).reason).toBe("investigated");
    expectCitesRunEvidence(run);
  });

  test("a second rejected report ends the run with the reason, and there is no third try", async () => {
    const e1 = await evidenceOf("evaluate_design", { design: START });
    const { run, requests } = await scriptedBreaker([
      { toolCalls: [{ name: "evaluate_design", args: { design: START } }] },
      report(finding("Invented count", `About ${INVENTED} hearts fail.`, [e1.id])),
      report(finding("Invented range", `Failing hearts sit in the 25-${INVENTED + 1} mm band.`, [e1.id])),
      report(finding("Never reached", "This report must never be requested.", [e1.id])),
    ]);

    const rejected = rejections(run);
    expect(rejected).toHaveLength(2);
    expect(rejected[0].error).toContain(String(INVENTED));
    expect(rejected[1].error, "a range end that isn't in the evidence is rejected").toContain(String(INVENTED + 1));
    expect(requests, "no third report attempt").toHaveLength(3);
    expect(run.findings).toEqual([]);
    const stop = stopOf(run);
    expect(stop.reason).toBe("model-error");
    expect(stop.detail).toMatch(/validation/i);
    expect(stop.detail).toMatch(/retry/i);
  });

  test("Break it runs over HTTP apply the same guard", async ({ request }) => {
    const turns: ScriptedTurn[] = [
      { toolCalls: [{ name: "evaluate_design", args: { design: START } }] },
      report(finding("Invented count", `About ${INVENTED} hearts fail.`, ["$lastEvidenceId"])),
      report(finding("Annulus above the largest size", "Hearts above the 27 mm size have no size.", ["$lastEvidenceId"])),
    ];
    const started = await request.post("/api/runs", { data: { model: { kind: "scripted", turns }, budget: { maxRounds: 1 } } });
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
    const rejected = rejections(run);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].error).toContain(String(INVENTED));
    expect(run.findings.map((f) => f.title)).toEqual(["Annulus above the largest size"]);
  });
});

test.describe("Done when 3: allowed numbers are accepted", () => {
  test("heart IDs, design sizes and labels, a range whose ends are in the evidence and a rounded value pass", async () => {
    const e1 = await evidenceOf("evaluate_design", { design: START });
    const bands = await evidenceOf("group_failures", { design: START, by: "band" });
    const keys = (bands.result as { groups: { key: string }[] }).groups.map((g) => g.key);
    const ends = keys.flatMap((k) => (/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(k) ?? []).slice(1).map(Number));
    expect(ends.length, `band keys look like "25-27": ${keys.join(", ")}`).toBeGreaterThanOrEqual(4);
    const lo = Math.min(...ends);
    const hi = Math.max(...ends);
    const range = `${lo}-${hi}`;
    expect(keys.includes(range), "precondition: the range itself isn't a band key").toBe(false);
    expect(JSON.stringify(bands), "precondition: the range text isn't in the evidence").not.toContain(`"${range}"`);

    const fitPct = (e1.result as { fitPct: number }).fitPct;
    const failing = (bands.result as { groups: { heartIds: string[] }[] }).groups.flatMap((g) => g.heartIds);
    const [heartA, heartB] = [failing[0], devHearts.find((h) => !failing.includes(h.id))?.id ?? devHearts[0].id];
    const text =
      `${heartA} and ${heartB} were checked against the ${START.label}. ` +
      `The 23, 25 and 27 mm sizes cover a 21-27 mm annulus, and failures spread across ${range} mm. ` +
      `About ${fitPct.toFixed(1)}% of hearts fit.`;

    const { run } = await scriptedBreaker([
      {
        toolCalls: [
          { name: "evaluate_design", args: { design: START } },
          { name: "group_failures", args: { design: START, by: "band" } },
        ],
      },
      report(finding(`Failures spread across ${range} mm`, text, [e1.id, bands.id], [heartA])),
    ]);

    expect(rejections(run), JSON.stringify(rejections(run))).toEqual([]);
    expect(run.findings).toHaveLength(1);
    expect(run.findings[0].explanation).toBe(text);
    expect(stopOf(run).reason).toBe("investigated");
    expectCitesRunEvidence(run);
  });
});

test.describe("Done when 4: a hidden heart is refused and logged", () => {
  test("hidden IDs in inspect_heart, profile_group and findings are refused, logged and leak nothing", async () => {
    const devId = devHearts[0].id;
    const { run } = await scriptedBreaker([
      {
        toolCalls: [
          { name: "inspect_heart", args: { heartId: HIDDEN.id, design: START } },
          { name: "profile_group", args: { heartIds: [devId, HIDDEN.id] } },
        ],
      },
      { toolCalls: [{ name: "evaluate_design", args: { design: START } }] },
      report(finding("Hidden heart claim", "This heart fails the sinus rule.", ["$lastEvidenceId"], [HIDDEN.id])),
      report(finding("Dev heart check", "This heart was evaluated on the dev set.", ["$lastEvidenceId"], [devId])),
    ]);

    const calls = toolCalls(run);
    for (const tool of ["inspect_heart", "profile_group", "report_findings"]) {
      const refused = calls.find((c) => c.tool === tool && c.error);
      expect(refused, `${tool} refusal is logged`).toBeDefined();
      expect(refused?.evidenceId).toBeUndefined();
      expect(refused?.error).toContain(HIDDEN.id);
      expect(refused?.error?.toLowerCase()).toContain("hidden");
    }
    expect(run.evidence.some((e) => JSON.stringify(e.input).includes(HIDDEN.id))).toBe(false);
    const body = JSON.stringify(run);
    for (const [measure, value] of Object.entries(HIDDEN.measures)) {
      if (Number.isInteger(value)) continue;
      expect(body.includes(String(value)), `hidden ${measure} is not in the run`).toBe(false);
    }
    expect(run.findings.map((f) => f.heartIds)).toEqual([[devId]]);
    expect(stopOf(run).reason).toBe("investigated");
  });
});

type GeminiPart = {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { id?: string; name: string; args: unknown };
  functionResponse?: { id?: string; name: string; response: { evidenceId?: string; result?: unknown; error?: string } };
};
type GeminiContent = { role: string; parts: GeminiPart[] };
type GeminiBody = {
  contents: GeminiContent[];
  tools: { functionDeclarations: { name: string }[] }[];
  toolConfig: { functionCallingConfig: { mode: string } };
  generationConfig: { thinkingConfig: { thinkingLevel: string }; maxOutputTokens: number };
};
const candidate = (content: GeminiContent) => ({
  candidates: [{ content, finishReason: "STOP" }],
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 },
});

test.describe("Done when 5: two function calls and a thought signature in one step", () => {
  test("both calls run and the model content is sent back unchanged", async () => {
    const { gemini, breaker } = await load();
    const step1: GeminiContent = {
      role: "model",
      parts: [
        { functionCall: { id: "call-a", name: "evaluate_design", args: { design: START } }, thoughtSignature: "c2lnbmF0dXJlLW9uZQ==" },
        { functionCall: { id: "call-b", name: "group_failures", args: { design: START, by: "rule" } } },
      ],
    };
    const sent: { model: string; body: GeminiBody }[] = [];
    let step2: GeminiContent | undefined;
    const transport = async (request: { model: string; body: unknown }, signal: AbortSignal): Promise<unknown> => {
      expect(signal).toBeInstanceOf(AbortSignal);
      const body = JSON.parse(JSON.stringify(request.body)) as GeminiBody;
      sent.push({ model: request.model, body });
      if (sent.length === 1) return candidate(step1);
      const responses = body.contents.at(-1)?.parts.map((p) => p.functionResponse?.response.evidenceId ?? "") ?? [];
      step2 = {
        role: "model",
        parts: [
          {
            functionCall: {
              id: "call-c",
              name: "report_findings",
              args: { mechanisms: [finding("Failures cluster by rule", "Failing hearts share a few rules.", responses)] },
            },
            thoughtSignature: "c2lnbmF0dXJlLXR3bw==",
          },
        ],
      };
      return candidate(step2);
    };

    const run = await breakerRun(gemini.createGeminiClient({ transport }));
    expect(RunSchema.safeParse(run).success).toBe(true);
    expect(stopOf(run).reason).toBe("investigated");
    expect(sent).toHaveLength(2);

    const calls = toolCalls(run);
    expect(calls.slice(0, 2).map((c) => c.tool)).toEqual(["evaluate_design", "group_failures"]);
    for (const c of calls.slice(0, 2)) expect(c.evidenceId, c.error).toMatch(/^ev-/);
    for (const e of run.events) expect(e.mode).toBe("live");

    const contents = sent[1].body.contents;
    const at = contents.findIndex((c) => c.role === "model");
    expect(at, "the model's content is in the second request").toBeGreaterThan(-1);
    expect(contents[at]).toEqual(step1);
    expect(JSON.stringify(contents[at]), "resent byte for byte").toBe(JSON.stringify(step1));
    expect(contents[at].parts[0].thoughtSignature).toBe("c2lnbmF0dXJlLW9uZQ==");

    const replies = contents[at + 1];
    expect(replies.role).toBe("user");
    expect(replies.parts, "both results go back together").toHaveLength(2);
    expect(replies.parts.map((p) => [p.functionResponse?.id, p.functionResponse?.name])).toEqual([
      ["call-a", "evaluate_design"],
      ["call-b", "group_failures"],
    ]);
    expect(replies.parts.map((p) => p.functionResponse?.response.evidenceId)).toEqual([calls[0].evidenceId, calls[1].evidenceId]);
    expect(run.findings[0].evidenceIds).toEqual([calls[0].evidenceId, calls[1].evidenceId]);

    for (const { model, body } of sent) {
      expect(model).toBe("gemini-4-argon");
      expect(body.generationConfig.thinkingConfig.thinkingLevel).toBe("low");
      expect(body.generationConfig.maxOutputTokens).toBe(32768);
      expect(body.toolConfig.functionCallingConfig.mode).toBe("ANY");
      expect(body.tools.flatMap((t) => t.functionDeclarations.map((d) => d.name)).sort()).toEqual([...BREAKER_TOOL_NAMES].sort());
    }
    expect([...breaker.BREAKER_TOOLS].sort()).toEqual([...BREAKER_TOOL_NAMES].sort());
  });

  test("the default transport posts to generateContent with the key in a header, and errors don't leak it", async () => {
    const { gemini } = await load();
    const key = "test-key-not-real-0000";
    const content: GeminiContent = {
      role: "model",
      parts: [{ functionCall: { id: "call-1", name: "evaluate_design", args: { design: START } }, thoughtSignature: "c2ln" }],
    };
    const seen: { url: string; method?: string; header: string | null; body: GeminiBody }[] = [];
    let status = 200;
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      seen.push({
        url,
        method: init?.method,
        header: new Headers(init?.headers).get("x-goog-api-key"),
        body: JSON.parse(String(init?.body)) as GeminiBody,
      });
      return status === 200
        ? new Response(JSON.stringify(candidate(content)), { status, headers: { "content-type": "application/json" } })
        : new Response(JSON.stringify({ error: { code: status, message: "Bad request" } }), { status });
    }) as typeof fetch;
    try {
      const client = gemini.createGeminiClient({ apiKey: key });
      expect(client.mode).toBe("live");
      const request: ModelRequest = {
        actor: "breaker",
        step: "investigate",
        messages: [{ role: "user", text: "Start." }],
        tools: [{ name: "evaluate_design", description: "Evaluate a design.", parameters: { type: "object", properties: {} } }],
        signal: new AbortController().signal,
      };
      const turn = await client.nextTurn(request);
      expect(turn.toolCalls.map((c) => ({ name: c.name, args: c.args }))).toEqual([{ name: "evaluate_design", args: { design: START } }]);
      expect(turn.providerState).toEqual(content);

      expect(seen[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-4-argon:generateContent");
      expect(seen[0].method).toBe("POST");
      expect(seen[0].header === key, "the key goes in the x-goog-api-key header").toBe(true);
      expect(seen[0].url.includes(key), "the key is never in the URL").toBe(false);
      expect(seen[0].body.generationConfig.thinkingConfig.thinkingLevel).toBe("low");

      status = 400;
      const error = await client.nextTurn(request).then(
        () => null,
        (e: unknown) => (e instanceof Error ? e.message : String(e)),
      );
      expect(error, "an HTTP error rejects").not.toBeNull();
      expect(error).toContain("400");
      expect(error?.includes(key), "the error doesn't contain the key").toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });
});

test.describe("Done when 6: a step that times out is retried once, then the run stops", () => {
  function hangingClient(script: ("hang" | ModelTurn)[]) {
    const signals: AbortSignal[] = [];
    const client: ModelClient = {
      mode: "replay",
      nextTurn(request: ModelRequest): Promise<ModelTurn> {
        signals.push(request.signal);
        const next = script[signals.length - 1];
        if (!next) return Promise.reject(new Error("The script has no more turns."));
        if (next !== "hang") return Promise.resolve(next);
        return new Promise((_, reject) => {
          request.signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
        });
      },
    };
    return { client, signals };
  }

  test("two timeouts → exactly one retry, then a model-error stop with the reason", async () => {
    const { gemini } = await load();
    const { client, signals } = hangingClient(["hang", "hang", { text: "", toolCalls: [] }]);
    const run = await breakerRun(gemini.withStepTimeout(client, { timeoutMs: 200, retries: 1 }));

    expect(signals, "one try plus one retry").toHaveLength(2);
    expect(signals[0].aborted, "the timed-out attempt was aborted").toBe(true);
    const stop = stopOf(run);
    expect(stop.reason).toBe("model-error");
    expect(stop.detail).toMatch(/timed out/i);
    expect(stop.detail).toMatch(/retry/i);
    expect(run.findings).toEqual([]);
  });

  test("a timeout followed by a good step carries on", async () => {
    const { gemini } = await load();
    const e1 = await evidenceOf("evaluate_design", { design: START });
    const { client, signals } = hangingClient([
      "hang",
      { text: "", toolCalls: [{ name: "evaluate_design", args: { design: START } }] },
      { text: "", toolCalls: [{ name: "report_findings", args: { mechanisms: [finding("Fit checked", "The design was evaluated.", [e1.id])] } }] },
    ]);
    const run = await breakerRun(gemini.withStepTimeout(client, { timeoutMs: 200, retries: 1 }));
    expect(signals).toHaveLength(3);
    expect(stopOf(run).reason).toBe("investigated");
    expect(run.findings.map((f) => f.title)).toEqual(["Fit checked"]);
  });
});

test.describe("PRD section 3: live settings, budget and prompt", () => {
  test("settings and default budget match the PRD, and the factory has a live gemini case", async () => {
    const { gemini, orchestrator, modelClient } = await load();
    expect(gemini.geminiSettings).toMatchObject({
      model: "gemini-4-argon",
      method: "generateContent",
      thinkingLevel: "low",
      toolMode: "ANY",
      maxOutputTokens: 32768,
      stepTimeoutMs: 60_000,
      stepRetries: 1,
      budget: { maxStepsPerTurn: 8, maxToolCallsPerTurn: 16, maxTurnMs: 180_000 },
    });
    expect(orchestrator.defaultBudget).toMatchObject({ maxStepsPerTurn: 8, maxToolCallsPerTurn: 16, maxTurnMs: 180_000 });
    expect(modelClient.ModelSpecSchema.safeParse({ kind: "gemini" }).success).toBe(true);
    expect(modelClient.createModelClient({ kind: "gemini" }).mode).toBe("live");
  });

  test("a turn stops after 8 model steps", async () => {
    const evaluate: ScriptedTurn = { toolCalls: [{ name: "evaluate_design", args: { design: START } }] };
    const { run, requests } = await scriptedBreaker(Array.from({ length: 10 }, () => evaluate));
    expect(requests).toHaveLength(8);
    const stop = stopOf(run);
    expect(stop.reason).toBe("budget");
    expect(stop.limit).toBe("maxStepsPerTurn");
  });

  test("a turn stops at 16 tool calls, even within one step", async () => {
    const many: ScriptedTurn = {
      toolCalls: Array.from({ length: 17 }, () => ({ name: "evaluate_design", args: { design: START } })),
    };
    const { run } = await scriptedBreaker([many]);
    expect(toolCalls(run)).toHaveLength(16);
    const stop = stopOf(run);
    expect(stop.reason).toBe("budget");
    expect(stop.limit).toBe("maxToolCallsPerTurn");
  });

  test("the Breaker prompts allow 'it survived' and don't push for a break", async () => {
    const { breaker } = await load();
    const e1 = await evidenceOf("evaluate_design", { design: START });
    const summary = e1.result as Summary;
    for (const step of ["investigate", "attack"] as const) {
      const role = breaker.breakerRoles[step];
      expect(role.actor).toBe("breaker");
      expect(role.terminalTool).toBe("report_findings");
      expect([...role.toolNames].sort()).toEqual([...BREAKER_TOOL_NAMES].sort());
      expect(typeof role.validate).toBe("function");
      const prompt = role.prompt({
        step,
        round: step === "attack" ? 1 : 0,
        design: START,
        summary,
        findings: [],
        proposals: [],
        limits: [],
        evidence: [e1],
      });
      expect(prompt).toContain(START.label);
      expect(prompt).not.toMatch(
        /(always|must|have to) (find|break)|until you (find|break)|find at least one (break|flaw|failure|weakness)|keep (trying|attacking|going) until/i,
      );
      if (step === "attack") {
        expect(prompt).toMatch(/surviv/i);
        expect(prompt).toMatch(/surviv[^.]*valid|valid[^.]*surviv/i);
      }
    }
  });
});

function maskDesigns(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskDesigns);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.hypothetical === true && Array.isArray(record.sizes)) return "<design>";
    return Object.fromEntries(Object.entries(record).map(([k, v]) => [k, maskDesigns(v)]));
  }
  return value;
}

async function liveBreaker(design: Design): Promise<{ run: Run; ms: number }> {
  const { breaker, modelClient } = await load();
  const started = Date.now();
  const run = await breaker.runBreaker({ model: modelClient.createModelClient({ kind: "gemini" }), design });
  return { run, ms: Date.now() - started };
}

const finished = (run: Run) => stopOf(run).reason === "investigated" && run.findings.length > 0;

function expectRecorded(run: Run, key: string) {
  const file = path.join(RECORDINGS, `${run.id}.json`);
  expect(existsSync(file), `recording for ${run.id}`).toBe(true);
  const text = readFileSync(file, "utf8");
  expect(text.includes(key), "the recording doesn't contain the key").toBe(false);
  const saved = RunSchema.parse(JSON.parse(text));
  expect(saved.id).toBe(run.id);
  expect(saved.events.length).toBeGreaterThan(0);
  expect(saved.events.some((e) => e.type === "tool-call")).toBe(true);
  expect(saved.evidence.length).toBeGreaterThan(0);
  for (const e of saved.events) expect(e.mode).toBe("live");
}

test.describe("live Gemini", () => {
  test("Done when 7: on the starting valve it uses several tools and finds a non-annulus mechanism @live", async () => {
    test.setTimeout(6 * 60_000);
    const { gemini } = await load();
    const key = gemini.readGeminiKey();
    const { run } = await liveBreaker(START);
    expectRecorded(run, key);
    expect(stopOf(run).reason, stopOf(run).detail).toBe("investigated");
    expectCitesRunEvidence(run);

    const used = new Set(toolCalls(run).filter((c) => c.evidenceId && c.tool !== "report_findings").map((c) => c.tool));
    expect(used.size, `different tools: ${[...used].join(", ")}`).toBeGreaterThanOrEqual(3);

    const byId = new Map(run.evidence.map((e) => [e.id, e]));
    const nonAnnulus = run.findings.filter(
      (f) =>
        f.kind === "mechanism" &&
        NON_ANNULUS_WORDS.test(`${f.title} ${f.explanation}`) &&
        f.evidenceIds.some((id) => NON_ANNULUS_KEYS.test(JSON.stringify([byId.get(id)?.input, byId.get(id)?.result]))),
    );
    expect(nonAnnulus.length, JSON.stringify(run.findings.map((f) => f.title))).toBeGreaterThan(0);
  });

  test("Done when 8: two different valves get different tool calls, not one fixed script @live", async () => {
    test.setTimeout(12 * 60_000);
    const { gemini } = await load();
    const key = gemini.readGeminiKey();
    const sequences: string[] = [];
    for (const design of [START, VALVE_B]) {
      const { run } = await liveBreaker(design);
      expectRecorded(run, key);
      expect(stopOf(run).reason, stopOf(run).detail).toBe("investigated");
      sequences.push(JSON.stringify(toolCalls(run).map((c) => ({ tool: c.tool, input: maskDesigns(c.input) }))));
    }
    expect(sequences[0], "tool calls or inputs differ once the design itself is masked").not.toBe(sequences[1]);
  });

  test("Done when 9: 10 runs, at least 9 finish, slowest time recorded, each saved @live", async () => {
    test.setTimeout(40 * 60_000);
    const { gemini } = await load();
    const key = gemini.readGeminiKey();
    const results: { id: string; ok: boolean; ms: number; reason: string; detail: string }[] = [];
    for (let i = 0; i < 10; i++) {
      const { run, ms } = await liveBreaker(START);
      const stop = run.events.at(-1)?.data as StopData | undefined;
      results.push({ id: run.id, ok: finished(run), ms, reason: stop?.reason ?? "none", detail: stop?.detail ?? "" });
      expectRecorded(run, key);
    }
    const done = results.filter((r) => r.ok);
    const slowestMs = Math.max(...results.map((r) => r.ms));
    const slowestFinishedMs = done.length ? Math.max(...done.map((r) => r.ms)) : null;
    const summary = { at: new Date().toISOString(), finished: done.length, total: results.length, slowestMs, slowestFinishedMs, runs: results };
    mkdirSync(RECORDINGS, { recursive: true });
    writeFileSync(path.join(RECORDINGS, "req-10-live-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
    test.info().annotations.push({ type: "slowest-run-ms", description: String(slowestMs) });
    console.log(`REQ-10 live: ${done.length}/10 finished, slowest ${slowestMs} ms`);
    expect(done.length, JSON.stringify(results.map((r) => r.reason))).toBeGreaterThanOrEqual(9);
  });
});
