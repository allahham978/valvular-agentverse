import net from "node:net";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { RunSchema, SummarySchema, type Run, type RunEvent } from "../../src/contracts/index";
import type { ModelClient, ModelRequest, ModelTurn, ScriptedTurn } from "../../src/agents/model-client";

// REQ-17: Replay. Recorded model turns play through the real tools, labelled "Replay, not live".
// No key and no network: Gemini failures are forced with the real REQ-10 client and a fake transport.

const RUN_TIMEOUT_MS = 60_000;
const STEP_TIMEOUT_MS = 200;
const HIDDEN_FEED_TYPES = new Set(["run-start", "step-start", "run-stop"]);
const TEST_KEY = "req17-not-a-real-key";

async function load() {
  const replay = await import("../../src/replay");
  const gemini = await import("../../src/agents/gemini");
  const tools = await import("../../src/tools");
  const orchestrator = await import("../../src/orchestrator");
  const modelClient = await import("../../src/agents/model-client");
  return { replay, gemini, tools, orchestrator, modelClient };
}

type ToolCallData = { tool: string; input: unknown; evidenceId?: string; result?: unknown; error?: string };
type StopData = { reason: string; detail: string; limit?: string };
type OfferData = { replayId: string; reason: string; detail: string };
type Transport = (request: { model: string; body: unknown }, signal: AbortSignal) => Promise<unknown>;

const toolCalls = (run: Run) =>
  run.events.filter((e: RunEvent) => e.type === "tool-call").map((e) => e.data as ToolCallData);
const stopOf = (run: Run) => {
  const last = run.events.at(-1);
  expect(last?.type).toBe("run-stop");
  return last?.data as StopData;
};
const offersIn = (run: Run) => run.events.filter((e) => e.type === "replay-offer");
const uniqueId = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;

const hang: Transport = (_request, signal) =>
  new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
const httpError: Transport = async () => {
  throw new Error("Gemini request failed with HTTP 503.");
};

async function forcedFailure(transport: Transport, id = uniqueId("req17-fail")): Promise<Run> {
  const { gemini, tools, orchestrator, replay } = await load();
  const model = gemini.withStepTimeout(gemini.createGeminiClient({ apiKey: TEST_KEY, transport }), {
    timeoutMs: STEP_TIMEOUT_MS,
    retries: 1,
  });
  return orchestrator.executeRun({
    id,
    model,
    tools: tools.createAgentTools(),
    postLoopSteps: [replay.offerRecording],
  });
}

function asLive(inner: ModelClient): ModelClient {
  return { mode: "live", nextTurn: (request: ModelRequest): Promise<ModelTurn> => inner.nextTurn(request) };
}

async function demoFile() {
  const { replay } = await load();
  const file = replay.loadReplay(replay.DEFAULT_REPLAY_ID);
  expect(file, `fixtures/replays/${replay.DEFAULT_REPLAY_ID}.json loads`).not.toBeNull();
  expect(replay.ReplayFileSchema.safeParse(file).success).toBe(true);
  return file!;
}

type ReplayFileLike = Awaited<ReturnType<typeof demoFile>>;

async function liveRecording(file: ReplayFileLike): Promise<Run> {
  const { tools, orchestrator, modelClient, replay } = await load();
  return orchestrator.executeRun({
    id: uniqueId("req17-rec"),
    model: asLive(modelClient.createScriptedClient(file.turns as ScriptedTurn[])),
    tools: tools.createAgentTools(),
    startDesign: file.startDesign,
    limits: file.limits,
    budget: file.budget,
    ...(file.stopAfter ? { stopAfter: file.stopAfter } : {}),
    postLoopSteps: [replay.offerRecording],
  });
}

function expectDemoShape(run: Run) {
  const stop = stopOf(run);
  expect(stop.reason, stop.detail).not.toBe("model-error");
  expect(run.findings.filter((f) => f.kind === "mechanism").length, "a Breaker finding").toBeGreaterThan(0);
  expect(run.proposals.length, "a Fixer proposal").toBeGreaterThan(0);
  expect(run.findings.filter((f) => f.kind === "attack").length, "an attack").toBeGreaterThan(0);
}

async function expectMatchesFreshCode(run: Run) {
  const { tools } = await load();
  const fresh = tools.createAgentTools();
  const computed = toolCalls(run).filter((c) => c.evidenceId);
  expect(computed.length).toBeGreaterThan(0);
  for (const call of computed) {
    const outcome = await fresh.call(call.tool, call.input);
    expect(outcome.ok, `${call.tool} reruns`).toBe(true);
    if (!outcome.ok) continue;
    expect(outcome.evidence.id, `${call.tool} evidence id`).toBe(call.evidenceId);
    expect(json(call.result), `${call.tool} result matches a fresh code run`).toEqual(json(outcome.evidence.result));
  }
  for (const event of run.events.filter((e) => e.type === "evaluation")) {
    const data = event.data as { evidenceId: string; summary: unknown };
    const evidence = run.evidence.find((e) => e.id === data.evidenceId);
    expect(evidence, `evaluation cites ${data.evidenceId}`).toBeDefined();
    const outcome = await fresh.call("evaluate_design", evidence!.input);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(json(data.summary), "evaluation summary matches a fresh code run").toEqual(
        json(SummarySchema.parse(outcome.evidence.result)),
      );
    }
  }
}

async function finishedRun(request: APIRequestContext, id: string): Promise<Run> {
  let run: Run | undefined;
  await expect
    .poll(
      async () => {
        const response = await request.get(`/api/runs/${id}`);
        if (!response.ok()) return "missing";
        const view = (await response.json()) as { status: string; run: Run };
        run = view.run;
        return view.status;
      },
      { timeout: RUN_TIMEOUT_MS },
    )
    .toBe("finished");
  expect(RunSchema.safeParse(run).success).toBe(true);
  return run!;
}

test.describe("Done when 1: a forced Gemini failure or timeout says so and offers the recording", () => {
  for (const [name, transport, pattern] of [
    ["timeout", hang, /timed out/i],
    ["HTTP error", httpError, /503/],
  ] as const) {
    test(`a Gemini ${name} stops the live run and offers a replay that loads`, async () => {
      const { replay } = await load();
      const run = await forcedFailure(transport);
      expect(RunSchema.safeParse(run).success).toBe(true);
      for (const e of run.events) expect(e.mode).toBe("live");
      const stop = stopOf(run);
      expect(stop.reason).toBe("model-error");
      expect(stop.detail).toMatch(pattern);

      const offers = offersIn(run);
      expect(offers, "exactly one replay offer").toHaveLength(1);
      const offer = offers[0];
      expect(offer.actor).toBe("code");
      expect(offer.seq, "the offer comes before run-stop").toBeLessThan(run.events.at(-1)!.seq);
      expect(offer.text).toMatch(/Gemini/);
      expect(offer.text, "the offer says why the run failed").toContain(stop.detail);
      expect(offer.text).toMatch(/not live/i);
      expect(offer.text).toMatch(/replay|recording/i);
      expect(JSON.stringify(run), "the key never appears in the run").not.toContain(TEST_KEY);

      const data = offer.data as OfferData;
      expect(data.reason).toBe("model-error");
      expect(data.detail).toBe(stop.detail);
      const file = replay.loadReplay(data.replayId);
      expect(file, `offered replay ${data.replayId} loads`).not.toBeNull();
      expect(replay.ReplayFileSchema.safeParse(file).success).toBe(true);
    });
  }

  test("no offer for a scripted run that fails, or for a live run that finishes", async () => {
    const { tools, orchestrator, modelClient, replay } = await load();
    const scripted = await orchestrator.executeRun({
      model: modelClient.createScriptedClient([]),
      tools: tools.createAgentTools(),
      postLoopSteps: [replay.offerRecording],
    });
    expect(stopOf(scripted).reason).toBe("model-error");
    expect(offersIn(scripted)).toEqual([]);

    const finished = await liveRecording(await demoFile());
    expect(stopOf(finished).reason).not.toBe("model-error");
    expect(offersIn(finished)).toEqual([]);
  });
});

test.describe("Done when 2: replays are marked replay", () => {
  test("an in-process replay marks every event replay", async () => {
    const { replay } = await load();
    const run = await replay.replayRun(await demoFile());
    expect(RunSchema.safeParse(run).success).toBe(true);
    expect(run.events.length).toBeGreaterThan(0);
    for (const e of run.events) expect(e.mode, `${e.seq} ${e.type}`).toBe("replay");
    expectDemoShape(run);
  });

  test("a replay over HTTP marks every event replay, and bad replay ids are refused", async ({ request }) => {
    const { replay } = await load();
    const response = await request.post("/api/runs", { data: { replayId: replay.DEFAULT_REPLAY_ID } });
    expect(response.status()).toBe(201);
    const { id } = (await response.json()) as { id: string };
    const run = await finishedRun(request, id);
    for (const e of run.events) expect(e.mode, `${e.seq} ${e.type}`).toBe("replay");
    expectDemoShape(run);

    const unknown = await request.post("/api/runs", { data: { replayId: "no-such-replay" } });
    expect(unknown.status()).toBe(404);
    const traversal = await request.post("/api/runs", { data: { replayId: "../package" } });
    expect([400, 404]).toContain(traversal.status());
  });
});

test.describe("Done when 3: replay numbers match a fresh code run", () => {
  test("every tool result in an in-process replay equals a fresh tool call", async () => {
    const { replay } = await load();
    await expectMatchesFreshCode(await replay.replayRun(await demoFile()));
  });

  test("every tool result in an HTTP replay equals a fresh /api/tools call", async ({ request }) => {
    const { replay } = await load();
    const response = await request.post("/api/runs", { data: { replayId: replay.DEFAULT_REPLAY_ID } });
    expect(response.status()).toBe(201);
    const run = await finishedRun(request, ((await response.json()) as { id: string }).id);
    const computed = toolCalls(run).filter((c) => c.evidenceId);
    expect(computed.length).toBeGreaterThan(0);
    for (const call of computed) {
      const fresh = await request.post("/api/tools", { data: { tool: call.tool, input: call.input } });
      expect(fresh.ok(), `${call.tool} reruns over HTTP`).toBe(true);
      const body = (await fresh.json()) as { evidence: { id: string; result: unknown } };
      expect(body.evidence.id).toBe(call.evidenceId);
      expect(json(call.result), `${call.tool} result`).toEqual(json(body.evidence.result));
    }
  });

  test("a recording replays to the same tool calls, findings, proposals and stop", async () => {
    const { replay } = await load();
    const recording = await liveRecording(await demoFile());
    for (const e of recording.events) expect(e.mode).toBe("live");
    const file = replay.replayFromRun(recording, { id: "req17-roundtrip", title: "Round trip" });
    expect(replay.ReplayFileSchema.safeParse(file).success).toBe(true);
    expect(file.source).toBe("recording");

    const replayed = await replay.replayRun(file);
    for (const e of replayed.events) expect(e.mode).toBe("replay");
    expect(json(toolCalls(replayed))).toEqual(json(toolCalls(recording)));
    expect(json(replayed.findings)).toEqual(json(recording.findings));
    expect(json(replayed.proposals)).toEqual(json(recording.proposals));
    expect(stopOf(replayed)).toEqual(stopOf(recording));
    await expectMatchesFreshCode(replayed);
  });

  test("tampered numbers in a recording never reach the replay: code recomputes them", async () => {
    const { replay } = await load();
    const recording = await liveRecording(await demoFile());
    const TAMPERED = 987654;
    const tampered = JSON.parse(JSON.stringify(recording)) as Run;
    let changed = 0;
    for (const event of tampered.events) {
      const data = event.data as ToolCallData | null;
      if (event.type !== "tool-call" || data?.tool !== "evaluate_design" || !data.result) continue;
      (data.result as Record<string, unknown>).fit = TAMPERED;
      changed++;
    }
    for (const evidence of tampered.evidence) {
      if (evidence.tool === "evaluate_design") (evidence.result as Record<string, unknown>).fit = TAMPERED;
    }
    expect(changed, "precondition: the recording has evaluate_design results").toBeGreaterThan(0);

    const replayed = await replay.replayRun(replay.replayFromRun(tampered, { id: "req17-tampered", title: "Tampered" }));
    expect(JSON.stringify(replayed)).not.toContain(String(TAMPERED));
    expect(json(toolCalls(replayed))).toEqual(json(toolCalls(recording)));
    await expectMatchesFreshCode(replayed);
  });
});

test.describe("Done when 4: with the network disconnected, the recorded run finishes on the laptop", () => {
  test("every replay in fixtures/replays finishes with fetch and sockets blocked", async () => {
    const { replay } = await load();
    const ids = replay.listReplays();
    expect(ids).toContain(replay.DEFAULT_REPLAY_ID);

    const realFetch = globalThis.fetch;
    const realConnect = net.Socket.prototype.connect;
    let attempts = 0;
    globalThis.fetch = (() => {
      attempts++;
      return Promise.reject(new Error("Network disconnected."));
    }) as typeof fetch;
    net.Socket.prototype.connect = function blocked(): net.Socket {
      attempts++;
      throw new Error("Network disconnected.");
    } as typeof net.Socket.prototype.connect;
    try {
      for (const id of ids) {
        const file = replay.loadReplay(id);
        expect(file, `${id} loads`).not.toBeNull();
        const run = await replay.replayRun(file!);
        expect(RunSchema.safeParse(run).success).toBe(true);
        for (const e of run.events) expect(e.mode).toBe("replay");
        expectDemoShape(run);
      }
    } finally {
      globalThis.fetch = realFetch;
      net.Socket.prototype.connect = realConnect;
    }
    expect(attempts, "no network attempts during replay").toBe(0);
  });
});

type Snapshot = { feedEvents: number; offerShown: boolean; label: string | null; labelVisible: boolean };
declare global {
  interface Window {
    __req17Log: Snapshot[];
  }
}

const feedPanel = (page: Page) => page.getByTestId("feed-panel");
const feedEvents = (page: Page) => feedPanel(page).locator("[data-testid=feed-event]");
const fixButton = (page: Page) => page.getByTestId("controls-panel").getByRole("button", { name: "Fix it" });

async function startLabelLog(page: Page) {
  await page.evaluate(() => {
    window.__req17Log = [];
    const snap = () => {
      const label = document.querySelector<HTMLElement>("[data-testid=replay-label]");
      const box = label?.getBoundingClientRect();
      const style = label ? getComputedStyle(label) : null;
      window.__req17Log.push({
        feedEvents: document.querySelectorAll("[data-testid=feed-panel] [data-testid=feed-event]").length,
        offerShown: Boolean(document.querySelector('[data-testid=feed-panel] [data-testid=feed-event][data-type="replay-offer"]')),
        label: label?.textContent?.trim() ?? null,
        labelVisible: Boolean(
          box && box.width > 0 && box.height > 0 && style && style.visibility !== "hidden" && Number(style.opacity) > 0,
        ),
      });
    };
    new MutationObserver(snap).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    snap();
  });
}

test.describe("Done when 1, 2 and 4 on the workbench", () => {
  test("a Gemini failure offers the recording, which plays labelled 'Replay, not live' throughout, offline", async ({
    page,
    request,
  }) => {
    test.setTimeout(3 * RUN_TIMEOUT_MS);
    const failed = await forcedFailure(hang);
    const imported = await request.post("/api/runs/import", { data: failed });
    expect(imported.status()).toBe(201);

    const errors: string[] = [];
    const offsite: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.context().route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (["localhost", "127.0.0.1"].includes(url.hostname) || url.protocol === "data:") return route.continue();
      offsite.push(url.href);
      return route.abort("internetdisconnected");
    });
    let startedLive = false;
    // Stands in for REQ-12's "Break it" → Gemini wiring: the first run the page starts is the failed live run.
    await page.route("**/api/runs", async (route) => {
      if (route.request().method() === "POST" && !startedLive) {
        startedLive = true;
        return route.fulfill({ status: 201, json: { id: failed.id } });
      }
      return route.continue();
    });

    await page.goto("/?stage=workspace");
    await page.getByTestId("controls-panel").getByRole("button", { name: "Break it" }).click();

    const offerEvent = feedPanel(page).locator('[data-testid=feed-event][data-type="replay-offer"]');
    await expect(offerEvent, "the feed says Gemini failed").toBeVisible({ timeout: RUN_TIMEOUT_MS });
    await expect(offerEvent).toContainText("Gemini");
    await expect(offerEvent).toContainText(stopOf(failed).detail);
    const offer = page.getByTestId("replay-offer");
    const play = offer.getByRole("button", { name: "Play the recording" });
    await expect(play).toBeVisible();
    await expect(page.getByTestId("replay-label"), "a live run is never labelled replay").toHaveCount(0);

    await startLabelLog(page);
    const started = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/runs" && response.request().method() === "POST",
    );
    await play.click();
    const startResponse = await started;
    expect(startResponse.status()).toBe(201);
    expect(startResponse.request().postDataJSON()).toEqual({ replayId: expect.any(String) });
    const replayId = ((await startResponse.json()) as { id: string }).id;

    const label = page.getByTestId("replay-label");
    await expect(label).toBeVisible();
    await expect(label).toHaveText("Replay, not live");
    await expect(offerEvent, "the feed now shows the replay, not the failed run").toHaveCount(0);

    const run = await finishedRun(request, replayId);
    for (const e of run.events) expect(e.mode, `${e.seq} ${e.type}`).toBe("replay");
    expectDemoShape(run);
    const expectedVisible = run.events.filter((e) => !HIDDEN_FEED_TYPES.has(e.type)).length;

    await expect(fixButton(page)).toBeEnabled({ timeout: RUN_TIMEOUT_MS });
    await fixButton(page).click();
    await expect(feedEvents(page)).toHaveCount(expectedVisible, { timeout: RUN_TIMEOUT_MS });
    await expect(label).toBeVisible();
    await expect(label).toHaveText("Replay, not live");

    const log = await page.evaluate(() => window.__req17Log);
    const live = log.filter((snapshot) => snapshot.offerShown);
    const replaying = log.filter((snapshot) => !snapshot.offerShown);
    expect(live.length, "the log saw the failed live run first").toBeGreaterThan(0);
    for (const snapshot of live) expect(snapshot.label, "the live run is not labelled replay").toBeNull();
    expect(replaying.some((snapshot) => snapshot.feedEvents === expectedVisible), "the log saw the whole replay").toBe(true);
    for (const snapshot of replaying) {
      expect(snapshot, "the label stays visible throughout the replay").toEqual(
        expect.objectContaining({ label: "Replay, not live", labelVisible: true }),
      );
    }

    expect(offsite, "nothing left the laptop").toEqual([]);
    expect(errors).toEqual([]);
  });
});
