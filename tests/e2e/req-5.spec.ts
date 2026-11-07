import { existsSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  EvidenceSchema,
  FindingSchema,
  ProposalSchema,
  RunEventSchema,
  RunSchema,
  SummarySchema,
  type Design,
  type Evidence,
  type Run,
  type RunEvent,
} from "../../src/contracts/index";
import type { ModelClient, ModelRequest, ModelTurn } from "../../src/agents/model-client";
import type { ToolRegistry } from "../../src/orchestrator/tools";

const LAST_EVIDENCE = "$lastEvidenceId";
const STREAM_TIMEOUT_MS = 30_000;

const realToolsMerged = () =>
  existsSync(path.join(process.cwd(), "tests/e2e/req-9.spec.ts"));

type Turn = {
  delayMs?: number;
  text?: string;
  toolCalls: { name: string; args: unknown }[];
};
type StopData = { reason: string; detail: string; limit?: string };
type RunView = { status: string; run: Run };
type Arrival = { event: RunEvent; arrivedAt: number };

const makeDesign = (id: string, extraSizes: Design["sizes"] = []): Design => ({
  id,
  label: id,
  hypothetical: true,
  sizes: [
    { nominalMm: 23, minAnnulusMm: 21, maxAnnulusMm: 23 },
    { nominalMm: 25, minAnnulusMm: 23, maxAnnulusMm: 25 },
    { nominalMm: 27, minAnnulusMm: 25, maxAnnulusMm: 27 },
    ...extraSizes,
  ],
});

const START = makeDesign("script-start");
const WIDER = makeDesign("script-wider", [
  { nominalMm: 29, minAnnulusMm: 27, maxAnnulusMm: 29 },
]);

const evaluate = (design: Design): Turn => ({
  text: `Checking ${design.label}.`,
  toolCalls: [{ name: "evaluate_design", args: { design } }],
});

const report = (title: string): Turn => ({
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

const submit = (design: Design): Turn => ({
  toolCalls: [
    {
      name: "submit_proposal",
      args: {
        design,
        rationale: `Try ${design.label}.`,
        tradeOffs: ["More sizes to manufacture"],
        evidenceIds: [LAST_EVIDENCE],
      },
    },
  ],
});

const investigateTurns = (): Turn[] => [evaluate(START), report("Narrow junction")];
const proposeTurns = (design: Design): Turn[] => [evaluate(design), submit(design)];
const attackTurns = (design: Design): Turn[] => [evaluate(design), report("Shift attack")];

const slow = (turns: Turn[], delayMs: number): Turn[] =>
  turns.map((turn) => ({ ...turn, delayMs }));

async function startRun(
  baseURL: string | undefined,
  turns: Turn[],
  budget?: Record<string, number>,
): Promise<string> {
  const response = await fetch(`${baseURL}/api/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: { kind: "scripted", turns }, budget }),
  });
  expect(response.status).toBe(201);
  const { id } = (await response.json()) as { id: string };
  expect(id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  return id;
}

async function readStream(
  baseURL: string | undefined,
  id: string,
  lastEventId?: number,
): Promise<Arrival[]> {
  const response = await fetch(`${baseURL}/api/runs/${id}/events`, {
    headers: lastEventId === undefined ? {} : { "last-event-id": String(lastEventId) },
    signal: AbortSignal.timeout(STREAM_TIMEOUT_MS),
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  if (!response.body) throw new Error("stream has no body");

  const arrivals: Arrival[] = [];
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
    let end = buffer.indexOf("\n\n");
    while (end !== -1) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const dataLine = block.split("\n").find((line) => line.startsWith("data:"));
      if (dataLine) {
        arrivals.push({
          event: RunEventSchema.parse(JSON.parse(dataLine.slice(5).trim())),
          arrivedAt: Date.now(),
        });
      }
      end = buffer.indexOf("\n\n");
    }
  }
  return arrivals;
}

async function finishRun(baseURL: string | undefined, id: string): Promise<RunEvent[]> {
  const arrivals = await readStream(baseURL, id);
  return arrivals.map((arrival) => arrival.event);
}

async function getRun(baseURL: string | undefined, id: string): Promise<RunView> {
  const response = await fetch(`${baseURL}/api/runs/${id}`);
  expect(response.status).toBe(200);
  return (await response.json()) as RunView;
}

function expectGapless(events: RunEvent[]) {
  expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index + 1));
}

function stopOf(events: RunEvent[]): StopData {
  const stops = events.filter((event) => event.type === "run-stop");
  expect(stops, "exactly one run-stop").toHaveLength(1);
  expect(events.at(-1)?.type, "run-stop is last").toBe("run-stop");
  expect(stops[0].actor).toBe("code");
  expect(stops[0].text.length, "stop text says why").toBeGreaterThan(0);
  const data = stops[0].data as StopData;
  expect(data.detail.length, "stop detail says why").toBeGreaterThan(0);
  return data;
}

const stepsOf = (events: RunEvent[]) =>
  events
    .filter((event) => event.type === "step-start")
    .map((event) => [event.actor, (event.data as { step: string }).step]);

const toolCallsOf = (events: RunEvent[]) =>
  events.filter((event) => event.type === "tool-call");

test.describe.configure({ timeout: 60_000 });

test.describe("a full scripted run", () => {
  const turns = (): Turn[] => [
    ...investigateTurns(),
    ...proposeTurns(WIDER),
    ...attackTurns(WIDER),
    ...proposeTurns(WIDER),
  ];

  test("events stream in order through Breaker, Fixer and attack, with no gaps", async ({
    baseURL,
  }) => {
    const events = await finishRun(baseURL, await startRun(baseURL, turns()));

    expectGapless(events);
    expect(events[0].type).toBe("run-start");
    expect(stepsOf(events)).toEqual([
      ["breaker", "investigate"],
      ["fixer", "propose"],
      ["breaker", "attack"],
      ["fixer", "propose"],
    ]);

    const order = events.map((event) => event.type);
    expect(order.indexOf("finding")).toBeGreaterThan(-1);
    expect(order.indexOf("proposal")).toBeGreaterThan(order.indexOf("finding"));
    expect(order.indexOf("attack")).toBeGreaterThan(order.indexOf("proposal"));
    expect(order.lastIndexOf("proposal")).toBeGreaterThan(order.indexOf("attack"));

    for (const event of events) {
      expect(event.mode, "a scripted run is labelled replay").toBe("replay");
      expect(Number.isNaN(Date.parse(event.at)), event.at).toBe(false);
    }
  });

  test("events arrive while the run is working, not all at the end", async ({ baseURL }) => {
    const id = await startRun(baseURL, slow(investigateTurns(), 800));
    const arrivals = await readStream(baseURL, id);
    expect(arrivals.length).toBeGreaterThan(2);
    const first = arrivals[0].arrivedAt;
    const last = arrivals[arrivals.length - 1].arrivedAt;
    expect(last - first).toBeGreaterThan(800);
  });

  test("the run record holds everything the events say", async ({ baseURL }) => {
    const id = await startRun(baseURL, turns());
    const events = await finishRun(baseURL, id);
    const { status, run } = await getRun(baseURL, id);

    expect(status).toBe("finished");
    expect(RunSchema.safeParse(run).success).toBe(true);
    expect(run.events).toEqual(events);
    expect(run.hiddenScoreCount).toBe(0);
    expect(run.baselines).toEqual([]);

    const evidenceIds = new Set(run.evidence.map((evidence) => evidence.id));
    for (const evidence of run.evidence) {
      expect(EvidenceSchema.safeParse(evidence).success).toBe(true);
    }
    const calls = toolCallsOf(events);
    expect(calls.length).toBeGreaterThanOrEqual(7);
    for (const call of calls) {
      const data = call.data as { tool: string; input: unknown; evidenceId: string };
      expect(typeof data.tool).toBe("string");
      expect(data.input).toBeDefined();
      expect(evidenceIds.has(data.evidenceId), data.tool).toBe(true);
    }

    expect(run.findings.map((finding) => finding.kind)).toEqual(["mechanism", "attack"]);
    for (const finding of run.findings) {
      expect(FindingSchema.safeParse(finding).success).toBe(true);
      expect(finding.evidenceIds.length).toBeGreaterThan(0);
      for (const cited of finding.evidenceIds) {
        expect(evidenceIds.has(cited), cited).toBe(true);
      }
    }
    expect(run.proposals).toHaveLength(2);
    for (const proposal of run.proposals) {
      expect(ProposalSchema.safeParse(proposal).success).toBe(true);
      expect(proposal.toDesignId).toBe(WIDER.id);
      expect(proposal.evidenceIds.length).toBeGreaterThan(0);
      for (const cited of proposal.evidenceIds) {
        expect(evidenceIds.has(cited), cited).toBe(true);
      }
    }
    expect(run.proposals[0].fromDesignId).toBe(run.startDesignId);

    const evaluation = run.evidence.find(
      (evidence) => evidence.tool === "evaluate_design",
    );
    expect(SummarySchema.safeParse(evaluation?.result).success).toBe(true);
    if (!realToolsMerged()) {
      expect((evaluation?.result as { label: string }).label).toBe("Sample data");
    }
  });

  test("a stream resumes after Last-Event-ID", async ({ baseURL }) => {
    const id = await startRun(baseURL, turns());
    const events = await finishRun(baseURL, id);
    const rest = await readStream(baseURL, id, 3);
    expect(rest.map((arrival) => arrival.event)).toEqual(events.slice(3));
  });

  test("bad requests are refused", async ({ baseURL }) => {
    const bad = await fetch(`${baseURL}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: { kind: "no-such-model" } }),
    });
    expect(bad.status).toBe(400);
    for (const route of ["", "/events", "/export"]) {
      const missing = await fetch(`${baseURL}/api/runs/no-such-run${route}`);
      expect(missing.status, route).toBe(404);
    }
  });
});

test.describe("budget", () => {
  test("too many tool calls in a turn stops the run and logs why", async ({ baseURL }) => {
    const flood = Array.from({ length: 5 }, () => ({
      name: "evaluate_design",
      args: { design: START },
    }));
    const id = await startRun(
      baseURL,
      [{ toolCalls: flood }, ...investigateTurns(), ...proposeTurns(WIDER)],
      { maxToolCallsPerTurn: 2 },
    );
    const events = await finishRun(baseURL, id);

    expectGapless(events);
    const stop = stopOf(events);
    expect(stop.reason).toBe("budget");
    expect(stop.limit).toBe("maxToolCallsPerTurn");
    expect(toolCallsOf(events)).toHaveLength(2);
    expect(stepsOf(events)).toEqual([["breaker", "investigate"]]);
  });

  test("the round limit stops the run after the attack and logs why", async ({ baseURL }) => {
    const id = await startRun(
      baseURL,
      [
        ...investigateTurns(),
        ...proposeTurns(WIDER),
        ...attackTurns(WIDER),
        ...proposeTurns(WIDER),
      ],
      { maxRounds: 1 },
    );
    const events = await finishRun(baseURL, id);

    expectGapless(events);
    const stop = stopOf(events);
    expect(stop.reason).toBe("budget");
    expect(stop.limit).toBe("maxRounds");
    expect(stepsOf(events)).toEqual([
      ["breaker", "investigate"],
      ["fixer", "propose"],
      ["breaker", "attack"],
    ]);
  });

  test("a turn over its time limit stops without waiting for the model", async ({
    baseURL,
  }) => {
    const startedAt = Date.now();
    const id = await startRun(
      baseURL,
      [{ ...evaluate(START), delayMs: 25_000 }, report("Never reached")],
      { maxTurnMs: 300 },
    );
    const events = await finishRun(baseURL, id);

    expect(Date.now() - startedAt).toBeLessThan(10_000);
    expectGapless(events);
    const stop = stopOf(events);
    expect(stop.reason).toBe("budget");
    expect(stop.limit).toBe("maxTurnMs");
    expect(toolCallsOf(events)).toHaveLength(0);
  });
});

test.describe("no improvement", () => {
  test("a proposal that doesn't beat the start design stops at once and logs why", async ({
    baseURL,
  }) => {
    const leftover = [...attackTurns(START), ...proposeTurns(WIDER)];
    const id = await startRun(baseURL, [
      ...investigateTurns(),
      ...proposeTurns(START),
      ...leftover,
    ]);
    const events = await finishRun(baseURL, id);

    expectGapless(events);
    expect(stopOf(events).reason).toBe("no-improvement");
    expect(stepsOf(events)).toEqual([
      ["breaker", "investigate"],
      ["fixer", "propose"],
    ]);
    const { run } = await getRun(baseURL, id);
    expect(run.proposals).toHaveLength(1);
    expect(events.filter((event) => event.type === "attack")).toHaveLength(0);
  });

  test("code judges each proposal against the current design, not the start", async ({
    baseURL,
  }) => {
    const id = await startRun(baseURL, [
      ...investigateTurns(),
      ...proposeTurns(WIDER),
      ...attackTurns(WIDER),
      ...proposeTurns(WIDER),
      ...attackTurns(WIDER),
    ]);
    const events = await finishRun(baseURL, id);

    expect(stopOf(events).reason).toBe("no-improvement");
    const evaluations = events
      .filter((event) => event.type === "evaluation")
      .map((event) => event.data as { designId: string; summary: unknown; improved?: boolean });
    expect(evaluations.map((evaluation) => evaluation.improved)).toEqual([
      undefined,
      true,
      false,
    ]);
    for (const evaluation of evaluations) {
      expect(SummarySchema.safeParse(evaluation.summary).success).toBe(true);
    }
    expect(events.filter((event) => event.type === "attack")).toHaveLength(1);
  });
});

test.describe("other stop rules", () => {
  test("a Fixer that gives up stops the run with no valid fix", async ({ baseURL }) => {
    const id = await startRun(baseURL, [
      ...investigateTurns(),
      { text: "No change can work under these limits.", toolCalls: [] },
    ]);
    const events = await finishRun(baseURL, id);
    expectGapless(events);
    expect(stopOf(events).reason).toBe("no-valid-fix");
  });

  test("a model failure ends the run and the stream, with the reason logged", async ({
    baseURL,
  }) => {
    const id = await startRun(baseURL, [evaluate(START)]);
    const events = await finishRun(baseURL, id);
    expectGapless(events);
    expect(stopOf(events).reason).toBe("model-error");
    expect((await getRun(baseURL, id)).status).toBe("finished");
  });
});

test.describe("reload during a run", () => {
  // These run in the page, so they can't share anything from this file.
  function collectUntilCount(page: Page, id: string, count: number) {
    return page.evaluate(
      ({ runId, target }) =>
        new Promise<string[]>((resolve, reject) => {
          const seen: string[] = [];
          const source = new EventSource(`/api/runs/${runId}/events`);
          source.onerror = () => reject(new Error("stream failed"));
          source.onmessage = (message) => {
            seen.push(message.data);
            if (seen.length >= target) resolve(seen);
          };
        }),
      { runId: id, target: count },
    );
  }

  function collectUntilStop(page: Page, id: string) {
    return page.evaluate(
      (runId) =>
        new Promise<string[]>((resolve, reject) => {
          const seen: string[] = [];
          const source = new EventSource(`/api/runs/${runId}/events`);
          source.onerror = () => reject(new Error("stream failed"));
          source.onmessage = (message) => {
            seen.push(message.data);
            if ((JSON.parse(message.data) as { type: string }).type === "run-stop") {
              source.close();
              resolve(seen);
            }
          };
        }),
      id,
    );
  }

  test("sees all earlier events, then the rest", async ({ page, baseURL }) => {
    await page.goto("/about");
    const id = await startRun(
      baseURL,
      slow(
        [
          ...investigateTurns(),
          ...proposeTurns(WIDER),
          ...attackTurns(WIDER),
          ...proposeTurns(WIDER),
        ],
        600,
      ),
    );

    const before = await collectUntilCount(page, id, 4);
    const midRun = await getRun(baseURL, id);
    expect(midRun.status, "the reload happens mid-run").toBe("running");
    expect(midRun.run.events.length).toBeGreaterThanOrEqual(4);
    expect(RunSchema.safeParse(midRun.run).success).toBe(true);

    const exportMidRun = await fetch(`${baseURL}/api/runs/${id}/export`);
    expect(exportMidRun.status, "only a finished run exports").toBe(409);

    await page.reload();
    const after = await collectUntilStop(page, id);

    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.length).toBeGreaterThan(before.length);
    const events = after.map((data) => RunEventSchema.parse(JSON.parse(data)));
    expectGapless(events);
    expect(stopOf(events).reason).toBe("no-improvement");
    expect(stepsOf(events)).toHaveLength(4);
  });

  test("the run carries on with nobody watching", async ({ baseURL }) => {
    const id = await startRun(baseURL, slow(investigateTurns(), 300));
    const controller = new AbortController();
    const dropped = await fetch(`${baseURL}/api/runs/${id}/events`, {
      signal: controller.signal,
    });
    expect(dropped.status).toBe(200);
    controller.abort();

    const events = await finishRun(baseURL, id);
    expectGapless(events);
    expect(stopOf(events).reason).toBe("model-error");
  });
});

test.describe("export and import", () => {
  async function exportRun(baseURL: string | undefined, id: string): Promise<Run> {
    const response = await fetch(`${baseURL}/api/runs/${id}/export`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    return RunSchema.parse(await response.json());
  }

  function postImport(baseURL: string | undefined, body: unknown) {
    return fetch(`${baseURL}/api/runs/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function finishedRun(baseURL: string | undefined): Promise<Run> {
    const id = await startRun(baseURL, [
      ...investigateTurns(),
      ...proposeTurns(WIDER),
      ...attackTurns(WIDER),
      ...proposeTurns(WIDER),
    ]);
    await finishRun(baseURL, id);
    return exportRun(baseURL, id);
  }

  test("an exported run imports back to an identical run", async ({ baseURL }) => {
    const exported = await finishedRun(baseURL);
    expect(exported.events.at(-1)?.type).toBe("run-stop");
    expect(exported.evidence.length).toBeGreaterThan(0);

    const copy: Run = { ...exported, id: `imported-${Date.now()}` };
    const imported = await postImport(baseURL, copy);
    expect(imported.status).toBe(201);
    expect(await imported.json()).toEqual({ id: copy.id });

    expect(await exportRun(baseURL, copy.id)).toEqual(copy);
    const view = await getRun(baseURL, copy.id);
    expect(view.status).toBe("finished");
    expect(view.run).toEqual(copy);

    const streamed = await finishRun(baseURL, copy.id);
    expect(streamed, "import doesn't re-execute").toEqual(exported.events);

    const again = await postImport(baseURL, exported);
    expect(again.status, "same ID, same content").toBe(201);
    expect(await exportRun(baseURL, exported.id)).toEqual(exported);
  });

  test("an import can't overwrite a run or smuggle in a bad one", async ({ baseURL }) => {
    const exported = await finishedRun(baseURL);

    const changed = await postImport(baseURL, { ...exported, seed: exported.seed + 1 });
    expect(changed.status, "same ID, different content").toBe(409);
    expect(await exportRun(baseURL, exported.id)).toEqual(exported);

    const { events, ...withoutEvents } = exported;
    const unfinished = events.slice(0, -1);
    for (const [label, body] of [
      ["not a run", withoutEvents],
      ["path in the ID", { ...exported, id: "../../escape" }],
      ["no final run-stop", { ...exported, id: `cut-${Date.now()}`, events: unfinished }],
    ] as const) {
      expect((await postImport(baseURL, body)).status, label).toBe(400);
    }
  });
});

test.describe("seams for later requirements", () => {
  function fakeModel(turns: Turn[], mode: ModelClient["mode"] = "live") {
    const requests: ModelRequest[] = [];
    const client: ModelClient = {
      mode,
      async nextTurn(request) {
        requests.push(request);
        const next = turns.shift();
        if (!next) throw new Error("no turns left");
        const lastEvidence = [...request.messages]
          .reverse()
          .flatMap((message) => (message.role === "tool" ? message.replies : []))
          .find((reply) => reply.evidenceId)?.evidenceId;
        const args = JSON.stringify(next.toolCalls).replaceAll(
          LAST_EVIDENCE,
          lastEvidence ?? "",
        );
        const turn: ModelTurn = {
          text: next.text ?? "",
          toolCalls: JSON.parse(args) as ModelTurn["toolCalls"],
        };
        return turn;
      },
    };
    return { client, requests };
  }

  function summaryFor(designId: string, fit: number) {
    return {
      designId,
      split: "dev" as const,
      total: 400,
      fit,
      risk: 0,
      noFit: 400 - fit,
      fitPct: fit / 4,
      newRiskHeartIds: [],
    };
  }

  async function knownNumberTools(): Promise<ToolRegistry> {
    const { createStandInTools } = await import("../../src/orchestrator/stand-in-tools");
    const base = createStandInTools();
    return {
      specs: () => base.specs(),
      async call(name, input) {
        if (name !== "evaluate_design") return base.call(name, input);
        const { design } = input as { design: Design };
        const fit = design.sizes.length * 40;
        const evidence: Evidence = {
          id: `known-${design.id}-${fit}`,
          tool: name,
          input,
          result: summaryFor(design.id, fit),
        };
        return { ok: true, evidence };
      },
    };
  }

  const fullScript = (): Turn[] => [
    ...investigateTurns(),
    ...proposeTurns(WIDER),
    ...attackTurns(WIDER),
    ...proposeTurns(WIDER),
  ];

  test("another ModelClient and ToolRegistry drive the loop through executeRun", async () => {
    const { executeRun } = await import("../../src/orchestrator");
    const { client, requests } = fakeModel(fullScript());
    const run = await executeRun({ model: client, tools: await knownNumberTools() });

    expect(RunSchema.safeParse(run).success).toBe(true);
    expectGapless(run.events);
    expect(stopOf(run.events).reason).toBe("no-improvement");
    for (const event of run.events) {
      expect(event.mode, "mode comes from the client").toBe("live");
    }

    const summaries = run.events
      .filter((event) => event.type === "evaluation")
      .map((event) => (event.data as { summary: { fit: number } }).summary.fit);
    expect(summaries, "numbers come from the tool").toEqual([120, 160, 160]);

    expect(requests[0].actor).toBe("breaker");
    expect(requests[0].step).toBe("investigate");
    expect(requests[0].signal).toBeInstanceOf(AbortSignal);
    expect(requests[0].tools.map((tool) => tool.name)).toContain("report_findings");
    const fixerRequest = requests.find((request) => request.actor === "fixer");
    expect(fixerRequest?.step).toBe("propose");
    expect(fixerRequest?.tools.map((tool) => tool.name)).toContain("submit_proposal");
  });

  test("a role's validate rejects a result and the model tries again", async () => {
    const { executeRun } = await import("../../src/orchestrator");
    const { defaultRoles } = await import("../../src/orchestrator/roles");
    const rejection = "Rejected: this design breaks a rule.";
    let rejected = false;
    const { client, requests } = fakeModel([
      ...investigateTurns(),
      ...proposeTurns(WIDER),
      submit(WIDER),
      ...attackTurns(WIDER),
      ...proposeTurns(WIDER),
    ]);

    const run = await executeRun({
      model: client,
      tools: await knownNumberTools(),
      roles: {
        ...defaultRoles,
        propose: {
          ...defaultRoles.propose,
          validate() {
            if (rejected) return null;
            rejected = true;
            return rejection;
          },
        },
      },
    });

    expect(rejected).toBe(true);
    expect(JSON.stringify(requests.map((request) => request.messages))).toContain(rejection);
    expect(
      run.events.some(
        (event) =>
          event.type === "tool-call" &&
          (event.data as { error?: string }).error === rejection,
      ),
      "the rejection is logged",
    ).toBe(true);
    expect(run.proposals, "a rejected proposal isn't recorded").toHaveLength(2);
    expect(stepsOf(run.events)).toEqual([
      ["breaker", "investigate"],
      ["fixer", "propose"],
      ["breaker", "attack"],
      ["fixer", "propose"],
    ]);
  });

  test("post-loop steps run after the loop and before run-stop", async () => {
    const { executeRun } = await import("../../src/orchestrator");
    const { client } = fakeModel(fullScript());
    const reasons: string[] = [];
    const run = await executeRun({
      model: client,
      tools: await knownNumberTools(),
      postLoopSteps: [
        async (ctx) => {
          reasons.push(ctx.stopReason);
          ctx.emit({ actor: "code", type: "later-step", text: "Later step ran.", data: null });
        },
      ],
    });

    expect(reasons).toEqual(["no-improvement"]);
    expectGapless(run.events);
    expect(stopOf(run.events).reason).toBe("no-improvement");
    expect(run.events.at(-2)?.type).toBe("later-step");
  });

  test("a replan can start at the Fixer", async () => {
    const { executeRun } = await import("../../src/orchestrator");
    const { client } = fakeModel([
      ...proposeTurns(WIDER),
      ...attackTurns(WIDER),
      ...proposeTurns(WIDER),
    ]);
    const run = await executeRun({
      model: client,
      tools: await knownNumberTools(),
      startAt: "propose",
    });
    expect(stepsOf(run.events)[0]).toEqual(["fixer", "propose"]);
    expect(stopOf(run.events).reason).toBe("no-improvement");
  });
});
