import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// REQ-12: Core demo end to end. The main path plays fixtures/replays/demo.json (a recorded Gemini
// demo-mode run) through the real tools by default; ?mode=live runs the same path on Gemini (@live).
// Every expected number below is recomputed from the real APIs (/api/hearts, /api/fit), never hard-coded.

type Status = "fit" | "risk" | "no-fit";
type Reason = { ruleId: string; measured: number; limit: number; margin: number };
type FitResult = { heartId: string; designId: string; status: Status; sizeMm?: number; reasons: Reason[] };
type Summary = { designId: string; total: number; fit: number; risk: number; noFit: number; fitPct: number; newRiskHeartIds: string[] };
type Heart = { id: string; measures: Record<string, number>; thumbUrl: string; meshUrl: string };
type Design = { id: string; label: string; sizes: unknown[] };
type Rule = { id: string; status: string };
type Fit = { summary: Summary; results: FitResult[]; rules: Rule[] };
type RunEvent = { seq: number; actor: string; type: string; text: string; data: unknown; mode: "live" | "replay" };
type Finding = { id: string; kind: "mechanism" | "attack"; title: string };
type Run = { id: string; events: RunEvent[]; findings: Finding[] };
type Snapshot = { feedEvents: number; label: string | null };
type SceneHook = { __valvular?: { scene: import("three").Scene } };

declare global {
  interface Window {
    __req12Log: Snapshot[];
  }
}

const ROOT = process.cwd();
const SCRIPTED_RUN_MS = 60_000;
const LIVE_RUN_MS = 12 * 60_000;
const STATUS_COLOURS: Record<Status, string> = {
  fit: "rgb(47, 158, 110)",
  risk: "rgb(217, 148, 30)",
  "no-fit": "rgb(208, 74, 67)",
};
const STATUSES = Object.keys(STATUS_COLOURS) as Status[];
const TOTAL_KEY: Record<Status, "fit" | "risk" | "noFit"> = { fit: "fit", risk: "risk", "no-fit": "noFit" };
const DEV_MESH = /\/hearts\/heart-\d+\.glb$/;
const MAIN_MEASURES = ["annulusMm", "sinusMm", "sinotubularJunctionMm"];

const wall = (page: Page) => page.getByTestId("wall-panel");
const feed = (page: Page) => page.getByTestId("feed-panel");
const popup = (page: Page) => page.getByTestId("heart-popup");
const overlay = (page: Page) => page.getByTestId("wall-overlay");
const controls = (page: Page) => page.getByTestId("controls-panel");
// REQ-7's main-view caption: data-heart-id, data-status, the status and "synthetic heart".
const mainView = (page: Page) => page.getByTestId("main-view-status");
const breakButton = (page: Page) => controls(page).getByRole("button", { name: "Break it" });
const fixButton = (page: Page) => controls(page).getByRole("button", { name: "Fix it" });
const dot = (page: Page, id: string) => page.locator(`[data-testid="wall-dot"][data-heart-id="${id}"]`);
const thumb = (page: Page, id: string) => page.locator(`[data-testid="wall-thumb"][data-heart-id="${id}"]`);
const feedEvents = (page: Page, type?: string) =>
  feed(page).locator(type ? `[data-testid=feed-event][data-type="${type}"]` : "[data-testid=feed-event]");
const pct = (value: number) => value.toFixed(1);
const mm = (value: number) => Math.abs(value).toFixed(1);

async function truth(request: APIRequestContext) {
  const hearts = ((await (await request.get("/api/hearts")).json()) as { hearts: Heart[] }).hearts;
  const start = (await (await request.get("/api/fit")).json()) as Fit;
  expect(hearts).toHaveLength(400);
  expect(start.summary.total).toBe(400);
  return { hearts: new Map(hearts.map((heart) => [heart.id, heart])), start };
}

async function fitOf(request: APIRequestContext, design: Design): Promise<Fit> {
  const response = await request.post("/api/fit", { data: { design } });
  expect(response.status(), `code evaluates ${design.label}`).toBe(200);
  return (await response.json()) as Fit;
}

function guard(page: Page) {
  const errors: string[] = [];
  const offsite: string[] = [];
  const runs: { id: string; body: unknown }[] = [];
  const meshes: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("CONTEXT_LOST")) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (DEV_MESH.test(url.pathname)) meshes.push(url.pathname);
  });
  page.on("response", async (response) => {
    const url = new URL(response.url());
    if (response.request().method() !== "POST" || url.pathname !== "/api/runs" || response.status() !== 201) return;
    const body = (await response.json().catch(() => null)) as { id?: string } | null;
    if (body?.id) runs.push({ id: body.id, body: response.request().postDataJSON() });
  });
  void page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (["localhost", "127.0.0.1"].includes(url.hostname) || url.protocol === "data:" || url.protocol === "blob:") {
      return route.continue();
    }
    offsite.push(url.href);
    return route.abort();
  });
  return { errors, offsite, runs, meshes };
}

async function wallState(page: Page) {
  const dots = await wall(page)
    .getByTestId("wall-dot")
    .evaluateAll((elements) =>
      elements.map((element) => ({
        id: (element as HTMLElement).dataset.heartId ?? "",
        status: (element as HTMLElement).dataset.status ?? "",
        colour: getComputedStyle(element).backgroundColor,
      })),
    );
  const totals: Record<string, number> = {};
  for (const status of STATUSES) {
    totals[status] = Number(await wall(page).getByTestId(`wall-total-${status}`).textContent());
  }
  return { dots, totals };
}

async function expectWallMatches(page: Page, fit: Fit, timeout = 15_000) {
  const expected = new Map(fit.results.map((result) => [result.heartId, result.status]));
  await expect
    .poll(
      async () => {
        const { dots } = await wallState(page);
        return dots.filter((entry) => expected.get(entry.id) !== entry.status).length;
      },
      { timeout, message: "every dot shows the code's status for this design" },
    )
    .toBe(0);
  const { dots, totals } = await wallState(page);
  expect(dots).toHaveLength(400);
  expect(new Set(dots.map((entry) => entry.id)), "the wall shows the 400 real dev hearts").toEqual(new Set(expected.keys()));
  for (const entry of dots) expect(entry.colour, entry.id).toBe(STATUS_COLOURS[entry.status as Status]);
  for (const status of STATUSES) {
    expect(totals[status], `${status} total comes from the fit engine`).toBe(fit.summary[TOTAL_KEY[status]]);
  }
}

async function scrollToValve(page: Page) {
  const area = await page.getByTestId("scene-area").boundingBox();
  if (!area) throw new Error("no scene area");
  await page.mouse.move(area.x + area.width * 0.3, area.y + area.height / 2);
  await expect
    .poll(
      async () => {
        await page.mouse.wheel(0, 240);
        return page.locator("[data-stage-progress]").getAttribute("data-stage-progress");
      },
      { timeout: 60_000, intervals: [50], message: "scrolling reaches the valve" },
    )
    .toBe("1");
}

function rootFingerprint(page: Page) {
  return page.evaluate(() => {
    const scene = (window as unknown as SceneHook).__valvular?.scene;
    const parts: string[] = [];
    scene?.traverse((object) => {
      const mesh = object as import("three").Mesh;
      if (!mesh.isMesh || !/^root-/.test(mesh.name)) return;
      const position = mesh.geometry.attributes.position;
      parts.push(`${mesh.name}:${position.count}:${position.getX(0).toFixed(4)}:${position.getY(0).toFixed(4)}`);
    });
    return parts.sort().join("|");
  });
}

async function startLabelLog(page: Page) {
  await page.evaluate(() => {
    window.__req12Log = [];
    const snap = () => {
      const label = document.querySelector<HTMLElement>("[data-testid=replay-label]");
      window.__req12Log.push({
        feedEvents: document.querySelectorAll("[data-testid=feed-panel] [data-testid=feed-event]").length,
        label: label && label.offsetParent !== null ? label.textContent?.trim() ?? "" : null,
      });
    };
    new MutationObserver(snap).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    snap();
  });
}

async function runOf(request: APIRequestContext, id: string, timeout: number): Promise<Run> {
  await expect
    .poll(async () => ((await (await request.get(`/api/runs/${id}`)).json()) as { status: string }).status, { timeout })
    .toBe("finished");
  return ((await (await request.get(`/api/runs/${id}`)).json()) as { run: Run }).run;
}

function improvedDesign(run: Run): Design {
  const improved = new Set(
    run.events
      .filter((event) => event.type === "evaluation" && (event.data as { improved?: boolean }).improved === true)
      .map((event) => (event.data as { designId: string }).designId),
  );
  const proposals = run.events
    .filter((event) => event.type === "proposal")
    .map((event) => (event.data as { design: Design }).design)
    .filter((design) => improved.has(design.id));
  expect(proposals.length, "the run proposes a change that code confirms is better").toBeGreaterThan(0);
  return proposals[proposals.length - 1];
}

async function expectNoSampleWording(page: Page) {
  await expect(page.getByText("Sample data")).toHaveCount(0);
  await expect(page.getByText(/recorded from live/i)).toHaveCount(0);
}

async function mainPath(page: Page, request: APIRequestContext, live: boolean) {
  const runMs = live ? LIVE_RUN_MS : SCRIPTED_RUN_MS;
  const watch = guard(page);
  const { hearts, start } = await truth(request);

  await test.step("Done when 1: / shows the beating 3D heart", async () => {
    await page.goto(live ? "/?mode=live" : "/");
    await expect(page.getByTestId("scene-area").locator("canvas").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/illustrative/i).first()).toBeVisible();
    const scales = new Set<string>();
    await expect
      .poll(
        async () => {
          const scale = await page.evaluate(() => (window as unknown as SceneHook).__valvular?.scene.getObjectByName("heart-model")?.scale.x ?? null);
          if (scale !== null) scales.add(scale.toFixed(4));
          return scales.size;
        },
        { timeout: 30_000, intervals: [100], message: "the heart beats (its scale changes)" },
      )
      .toBeGreaterThanOrEqual(3);
  });

  let mainId = "";
  await test.step("Done when 2: scrolling to the valve shows the real root, schematic valve and real wall", async () => {
    await scrollToValve(page);
    await expect(wall(page)).toHaveAttribute("data-ready", "true", { timeout: 15_000 });
    await expect(page.getByText(/schematic valve/i).first()).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => rootFingerprint(page), { message: "the root is in the scene" }).not.toBe("");
    await expect(mainView(page)).toHaveAttribute("data-heart-id", /^heart-\d+$/, { timeout: 15_000 });
    mainId = (await mainView(page).getAttribute("data-heart-id")) ?? "";
    expect(hearts.has(mainId ?? ""), `the main view shows a real dev heart (${mainId})`).toBe(true);
    await expectWallMatches(page, start);
    expect(start.summary.fit + start.summary.risk + start.summary.noFit).toBe(400);
    await expectNoSampleWording(page);

    const firstId = start.results[0].heartId;
    await dot(page, firstId).hover();
    const card = page.getByTestId("wall-hover-card");
    await expect(card).toContainText(firstId);
    await expect(card.locator("img")).toHaveAttribute("src", hearts.get(firstId)!.thumbUrl);
    await page.mouse.move(8, 450);
  });

  let runId = "";
  await test.step("Done when 3: Break it runs the feed and failure mechanisms appear", async () => {
    await startLabelLog(page);
    const before = await feedEvents(page).count();
    expect(before).toBe(0);
    await breakButton(page).click();
    await expect(breakButton(page)).toBeDisabled();
    await expect.poll(() => watch.runs.length, { message: "Break it starts a run" }).toBeGreaterThan(0);
    runId = watch.runs[0].id;
    if (live) {
      expect(watch.runs[0].body, "?mode=live asks for Gemini in demo mode").toEqual(
        expect.objectContaining({ model: { kind: "gemini" }, demo: true }),
      );
    } else {
      expect(watch.runs[0].body, "the main path replays the recorded demo run").toEqual({ replayId: "demo" });
    }

    await expect(feed(page).locator('[data-testid=feed-event][data-actor="breaker"]').first()).toBeVisible({ timeout: runMs });
    await expect(feedEvents(page, "finding").first()).toBeVisible({ timeout: runMs });
    await expect(fixButton(page)).toBeEnabled({ timeout: runMs });
    await expect(breakButton(page)).toBeDisabled();

    const log = await page.evaluate(() => window.__req12Log);
    expect(new Set(log.map((snapshot) => snapshot.feedEvents)).size, "events streamed in, not all at once").toBeGreaterThanOrEqual(3);

    const view = (await (await request.get(`/api/runs/${runId}`)).json()) as { run: Run };
    const mechanisms = view.run.findings.filter((finding) => finding.kind === "mechanism");
    expect(mechanisms.length, "the Breaker named failure mechanisms").toBeGreaterThan(0);
    for (const finding of mechanisms) {
      await expect(feedEvents(page, "finding").filter({ hasText: finding.title }), finding.title).not.toHaveCount(0);
    }
    await expect(feedEvents(page, "proposal")).toHaveCount(0);
    await expectWallMatches(page, start);
    await expectNoSampleWording(page);
  });

  await test.step("Done when 4: a red heart's popup, then Open in main view changes the main view", async () => {
    const loaded = new Set(watch.meshes);
    const red = start.results.find(
      (result) =>
        result.status === "no-fit" &&
        result.reasons.length > 0 &&
        result.heartId !== mainId &&
        !loaded.has(hearts.get(result.heartId)!.meshUrl),
    );
    if (!red) throw new Error("no red heart outside the main view");
    const heart = hearts.get(red.heartId)!;
    const rootBefore = await rootFingerprint(page);

    await dot(page, red.heartId).click();
    await expect(popup(page)).toBeVisible();
    await expect(popup(page)).toContainText(red.heartId);
    await expect(popup(page).getByTestId("heart-popup-status")).toHaveText(/no.?fit/i);
    for (const key of MAIN_MEASURES) {
      await expect(popup(page).getByTestId(`heart-popup-measure-${key}`), key).toContainText(heart.measures[key].toFixed(1));
    }
    const ruleStatus = new Map(start.rules.map((rule) => [rule.id, rule.status]));
    await expect(popup(page).getByTestId("heart-popup-reason")).toHaveCount(red.reasons.length);
    for (const reason of red.reasons) {
      const row = popup(page).locator(`[data-testid="heart-popup-reason"][data-rule-id="${reason.ruleId}"]`);
      await expect(row, reason.ruleId).toBeVisible();
      await expect(row).toContainText(mm(reason.limit));
      await expect(row).toContainText(mm(reason.margin));
      await expect(row).toContainText(ruleStatus.get(reason.ruleId) ?? "rule type missing from /api/fit");
    }
    await expect(page.getByTestId("heart-popup-view").locator("canvas")).toBeVisible({ timeout: 15_000 });
    await expect(popup(page).getByText("Sample data")).toHaveCount(0);

    await popup(page).getByRole("button", { name: "Open in main view" }).click();
    await expect(popup(page)).toBeHidden();
    await expect(wall(page)).toHaveAttribute("data-main-heart-id", red.heartId);
    await expect(wall(page)).toContainText(`In main view: ${red.heartId}`);
    await expect
      .poll(() => rootFingerprint(page), { timeout: 30_000, message: "the main view's root mesh changes to that heart" })
      .not.toBe(rootBefore);
    await expect(mainView(page)).toHaveAttribute("data-heart-id", red.heartId);
    await expect(mainView(page)).toHaveAttribute("data-status", "no-fit");
    await expect(mainView(page)).toContainText(/synthetic heart/i);
    await expect(page.getByText(/schematic valve/i).first()).toBeVisible();
  });

  let after: Fit | undefined;
  let run: Run | undefined;
  await test.step("Done when 5: Fix it retests the change, attacks appear, new risks turn amber, totals update", async () => {
    await fixButton(page).click();
    await expect(feedEvents(page, "proposal").first()).toBeVisible({ timeout: runMs });
    await expect(feedEvents(page, "attack").first()).toBeVisible({ timeout: runMs });
    await expect(feedEvents(page, "verdict").first()).toBeVisible({ timeout: runMs });
    run = await runOf(request, runId, runMs);
    const design = improvedDesign(run);
    after = await fitOf(request, design);

    const retest = feedEvents(page, "evaluation").filter({ hasText: `${pct(after.summary.fitPct)}%` });
    await expect(retest, "the feed shows code retesting the change").not.toHaveCount(0);
    const verdictText = (await feedEvents(page, "verdict").allTextContents()).join(" ");
    expect(verdictText, "the verdict reads in plain words").not.toMatch(/_/);

    const newRisk = after.summary.newRiskHeartIds;
    expect(newRisk.length, "the change has real new-risk hearts").toBeGreaterThan(0);
    await expectWallMatches(page, after, runMs);
    for (const id of newRisk) {
      await expect(dot(page, id), id).toHaveAttribute("data-status", "risk");
      await expect(dot(page, id), id).toHaveCSS("background-color", STATUS_COLOURS.risk);
    }
    const startStatus = new Map(start.results.map((result) => [result.heartId, result.status]));
    expect(
      newRisk.filter((id) => startStatus.get(id) === "risk"),
      "new-risk hearts were not amber before",
    ).toEqual([]);
    await expect(wall(page).locator('[data-testid="wall-dot"][data-heart-id^="sample-"]')).toHaveCount(0);
  });

  await test.step("Done when 6: the result line, on dev hearts", async () => {
    if (!after || !run) throw new Error("Fix it did not finish");
    const line = page.getByTestId("result-line");
    await expect(line).toBeVisible({ timeout: runMs });
    await expect(line).toContainText(
      `This valve fits ${pct(start.summary.fitPct)}% of test hearts. With this change, it fits ${pct(after.summary.fitPct)}%, and here's the new risk`,
    );
    await expect(line, "the new risk is shown").toContainText(String(after.summary.newRiskHeartIds.length));
    await expect(line).toContainText(/dev hearts/i);
  });

  await test.step("labels and provenance hold for the whole run", async () => {
    if (!run) throw new Error("no run");
    const log = await page.evaluate(() => window.__req12Log);
    const withEvents = log.filter((snapshot) => snapshot.feedEvents > 0);
    expect(withEvents.length).toBeGreaterThan(0);
    for (const event of run.events) expect(event.mode, `${event.seq} ${event.type}`).toBe(live ? "live" : "replay");
    for (const snapshot of withEvents) {
      expect(snapshot.label, live ? "a live run is never labelled replay" : "Replay, not live stays up").toBe(
        live ? null : "Replay, not live",
      );
    }
    await expectNoSampleWording(page);
    expect(watch.offsite, "no network beyond localhost").toEqual([]);
    expect(watch.errors, "no console errors").toEqual([]);
  });
}

test.describe("REQ-12 core demo end to end", () => {
  test("the main path replays a recorded Gemini demo-mode run", () => {
    const replay = JSON.parse(readFileSync(path.join(ROOT, "fixtures/replays/demo.json"), "utf8")) as {
      source: string;
      turns: { toolCalls: { name: string }[] }[];
    };
    expect(replay.source, "demo.json is a recording of a real Gemini run, not a hand-written transcript").toBe("recording");
    const tools = replay.turns.flatMap((turn) => turn.toolCalls.map((call) => call.name));
    expect(tools).toContain("report_findings");
    expect(tools).toContain("submit_proposal");
    expect(tools).toContain("stress_test");
  });

  test("Done when 1-6: heart, valve, real wall, Break it, popup to main view, Fix it, result line", async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    await mainPath(page, request, false);
  });

  test("the real wall keeps the REQ-4 hover, expand and popup behaviours", async ({ page, request }) => {
    test.setTimeout(120_000);
    const watch = guard(page);
    const { hearts, start } = await truth(request);
    await page.goto("/?stage=workspace");
    await expect(wall(page)).toHaveAttribute("data-ready", "true", { timeout: 15_000 });
    await expectWallMatches(page, start);

    for (const result of [start.results[0], start.results[399]]) {
      await dot(page, result.heartId).hover();
      const card = page.getByTestId("wall-hover-card");
      await expect(card).toContainText(result.heartId);
      await expect
        .poll(() => card.locator("img").evaluate((element) => (element as HTMLImageElement).naturalWidth))
        .toBeGreaterThan(0);
    }
    await page.mouse.move(8, 450);

    await wall(page).getByRole("button", { name: /expand/i }).click();
    await expect(overlay(page)).toBeVisible();
    const thumbs = overlay(page).getByTestId("wall-thumb");
    await expect(thumbs).toHaveCount(400);
    const shown = await thumbs.evaluateAll((elements) =>
      elements.map((element) => [(element as HTMLElement).dataset.heartId, (element as HTMLElement).dataset.status]),
    );
    expect(shown).toEqual(start.results.map((result) => [result.heartId, result.status]));
    await expect(overlay(page).getByText("Sample data")).toHaveCount(0);

    const amber = start.results.find((result) => result.status === "risk" && result.reasons.length > 0);
    if (!amber) throw new Error("no amber heart");
    await thumb(page, amber.heartId).click();
    await expect(popup(page)).toContainText(amber.heartId);
    await expect(popup(page).getByTestId("heart-popup-status")).toHaveText(/risk/i);
    await expect(popup(page).getByTestId("heart-popup-measure-annulusMm")).toContainText(
      hearts.get(amber.heartId)!.measures.annulusMm.toFixed(1),
    );
    await page.keyboard.press("Escape");
    await expect(popup(page)).toBeHidden();
    await expect(overlay(page)).toBeVisible();

    await thumb(page, amber.heartId).click();
    await popup(page).getByRole("button", { name: "Open in main view" }).click();
    await expect(popup(page)).toBeHidden();
    await expect(overlay(page)).toBeHidden();
    await expect(wall(page)).toHaveAttribute("data-main-heart-id", amber.heartId);

    const green = start.results.find((result) => result.status === "fit");
    if (!green) throw new Error("no green heart");
    await dot(page, green.heartId).click();
    await expect(popup(page).getByTestId("heart-popup-status")).toHaveText(/^\s*fit\s*$/i);
    await expect(popup(page).getByTestId("heart-popup-reason")).toHaveCount(0);
    const box = await popup(page).boundingBox();
    if (!box) throw new Error("popup has no box");
    expect(Math.abs(box.x + box.width / 2 - 720)).toBeLessThanOrEqual(2);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(900);
    await page.keyboard.press("Escape");
    await expect(popup(page)).toBeHidden();
    await dot(page, green.heartId).click();
    await expect(popup(page)).toBeVisible();
    await page.mouse.click(8, 8);
    await expect(popup(page)).toBeHidden();
    await expect(wall(page), "closing a popup leaves the main view alone").toHaveAttribute(
      "data-main-heart-id",
      amber.heartId,
    );

    expect(watch.offsite).toEqual([]);
    expect(watch.errors).toEqual([]);
  });

  test("Done when 7: the same path passes with Gemini (?mode=live) @live", async ({ page, request }) => {
    test.setTimeout(15 * 60_000);
    await mainPath(page, request, true);
  });
});
