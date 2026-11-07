import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// REQ-8: Agent feed and buttons. Scripted demo run through the REQ-5 run API;
// no Gemini key and no network beyond localhost.

type RunEvent = {
  seq: number;
  actor: string;
  type: string;
  text: string;
  data: unknown;
  mode: "live" | "replay";
};
type Finding = { id: string; kind: "mechanism" | "attack"; title: string };
type Proposal = { id: string; rationale: string };
type Run = { id: string; events: RunEvent[]; findings: Finding[]; proposals: Proposal[] };
type RunView = { status: string; run: Run };
type ToolCallData = { tool: string; input: unknown; result?: unknown; error?: string };

type Snapshot = {
  events: { type: string; actor: string }[];
  breakDisabled: boolean | null;
  fixDisabled: boolean | null;
};

declare global {
  interface Window {
    __req8Log: Snapshot[];
  }
}

const RUN_TIMEOUT_MS = 60_000;
const PANEL_PAD_TOLERANCE_PX = 24;

const feed = (page: Page) => page.getByTestId("feed-panel");
const controls = (page: Page) => page.getByTestId("controls-panel");
const breakButton = (page: Page) => controls(page).getByRole("button", { name: "Break it" });
const fixButton = (page: Page) => controls(page).getByRole("button", { name: "Fix it" });
const feedEvents = (page: Page, type?: string) =>
  feed(page).locator(type ? `[data-testid=feed-event][data-type="${type}"]` : "[data-testid=feed-event]");

function guardPage(page: Page) {
  const errors: string[] = [];
  const offsite: string[] = [];
  const runIds: string[] = [];
  const streams: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (/^\/api\/runs\/[^/]+\/events$/.test(url.pathname)) streams.push(url.pathname);
  });
  page.on("response", async (response) => {
    const url = new URL(response.url());
    if (response.request().method() !== "POST" || url.pathname !== "/api/runs") return;
    if (response.status() !== 201) return;
    const body = (await response.json().catch(() => null)) as { id?: string } | null;
    if (body?.id) runIds.push(body.id);
  });
  void page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (["localhost", "127.0.0.1"].includes(url.hostname) || url.protocol === "data:") {
      return route.continue();
    }
    offsite.push(url.href);
    return route.abort();
  });
  return { errors, offsite, runIds, streams };
}

async function startLog(page: Page) {
  await page.evaluate(() => {
    window.__req8Log = [];
    const button = (name: string) =>
      [...document.querySelectorAll<HTMLButtonElement>("[data-testid=controls-panel] button")].find(
        (candidate) => candidate.textContent?.trim() === name,
      );
    const disabled = (element: HTMLButtonElement | undefined) =>
      element ? element.disabled || element.getAttribute("aria-disabled") === "true" : null;
    let last = "";
    const take = () => {
      const snapshot: Snapshot = {
        events: [...document.querySelectorAll<HTMLElement>("[data-testid=feed-panel] [data-testid=feed-event]")].map(
          (element) => ({ type: element.dataset.type ?? "", actor: element.dataset.actor ?? "" }),
        ),
        breakDisabled: disabled(button("Break it")),
        fixDisabled: disabled(button("Fix it")),
      };
      const key = JSON.stringify(snapshot);
      if (key === last) return;
      last = key;
      window.__req8Log.push(snapshot);
    };
    take();
    new MutationObserver(take).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
  });
}

const readLog = (page: Page) => page.evaluate(() => window.__req8Log);

async function finishedRuns(request: APIRequestContext, ids: string[]): Promise<Run[]> {
  expect(ids.length, "the page started a run through POST /api/runs").toBeGreaterThan(0);
  const runs: Run[] = [];
  for (const id of ids) {
    await expect
      .poll(
        async () => ((await (await request.get(`/api/runs/${id}`)).json()) as RunView).status,
        { timeout: RUN_TIMEOUT_MS },
      )
      .toBe("finished");
    runs.push(((await (await request.get(`/api/runs/${id}`)).json()) as RunView).run);
  }
  return runs;
}

function leaves(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string" && value.length > 0) out.push(value);
  else if (typeof value === "number" && Number.isInteger(value)) out.push(String(value));
  else if (Array.isArray(value)) value.forEach((item) => leaves(item, out));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => leaves(item, out));
  return out;
}

async function riskState(page: Page) {
  const wall = page.getByTestId("wall-panel");
  await expect(wall).toHaveAttribute("data-ready", "true");
  const statuses = await wall
    .getByTestId("wall-dot")
    .evaluateAll((dots) =>
      Object.fromEntries(dots.map((dot) => [dot.getAttribute("data-heart-id"), dot.getAttribute("data-status")])),
    );
  const total = Number(await wall.getByTestId("wall-total-risk").textContent());
  return { statuses: statuses as Record<string, string>, total };
}

async function bottomGap(page: Page) {
  return feed(page).evaluate((panel) => {
    const rect = panel.getBoundingClientRect();
    const padding = parseFloat(getComputedStyle(panel).paddingBottom);
    let contentBottom = rect.top;
    for (const element of panel.querySelectorAll<HTMLElement>("*")) {
      const box = element.getBoundingClientRect();
      if (box.height > 0 && box.width > 0) contentBottom = Math.max(contentBottom, box.bottom);
    }
    return rect.bottom - padding - Math.min(contentBottom, rect.bottom);
  });
}

test.describe("REQ-8 agent feed and buttons", () => {
  test.describe.configure({ timeout: 120_000 });

  test("Break it, tool calls, findings, then Fix it, on a scripted demo run", async ({ page, request }) => {
    const guard = guardPage(page);
    await page.goto("/?stage=workspace");
    await expect(feed(page)).toBeVisible();
    await expect(controls(page)).toBeVisible();
    await expect(breakButton(page)).toBeEnabled();
    await expect(fixButton(page), "Fix it waits for a finished Break").toBeDisabled();
    expect(
      await fixButton(page).evaluate((element) => getComputedStyle(element).borderTopStyle),
      "disabled Fix it has a solid border, not a dashed placeholder",
    ).toBe("solid");
    await expect(feedEvents(page, "finding")).toHaveCount(0);
    await expect(feedEvents(page, "proposal")).toHaveCount(0);
    expect(await bottomGap(page), "idle feed panel is sized to its content").toBeLessThanOrEqual(
      PANEL_PAD_TOLERANCE_PX,
    );
    const before = await riskState(page);

    await startLog(page);

    // Done when 1: Breaker steps stream, button disabled during the run.
    await breakButton(page).click();
    await expect(breakButton(page)).toBeDisabled();
    await expect(feed(page).getByText("Sample data")).toBeVisible();
    await expect(feed(page).locator('[data-testid=feed-event][data-actor="breaker"]').first()).toBeVisible({
      timeout: RUN_TIMEOUT_MS,
    });
    await expect.poll(() => guard.runIds.length, { message: "Break it starts a run through POST /api/runs" }).toBeGreaterThan(0);
    await expect
      .poll(() => guard.streams.some((stream) => stream === `/api/runs/${guard.runIds[0]}/events`), {
        message: "the feed reads the run's event stream",
      })
      .toBe(true);

    // Done when 3: Break finishes, named mechanisms and Fix it enabled.
    await expect(feedEvents(page, "finding").first()).toBeVisible({ timeout: RUN_TIMEOUT_MS });
    await expect(fixButton(page)).toBeEnabled({ timeout: RUN_TIMEOUT_MS });
    const preClickFindingTexts = (await feedEvents(page, "finding").allTextContents()).map((text) => text.trim());
    expect(preClickFindingTexts.length, "findings show when Fix it is enabled").toBeGreaterThan(0);
    for (const text of preClickFindingTexts) {
      expect(text, "each finding shows its title").not.toBe("");
    }
    await expect(breakButton(page), "Break it stays disabled while the run is going").toBeDisabled();
    const gapDuringRun = await bottomGap(page);
    expect(gapDuringRun, "feed panel has no blank space below its last event").toBeLessThanOrEqual(
      PANEL_PAD_TOLERANCE_PX,
    );

    const breakLog = await readLog(page);
    const preFinding = breakLog.filter((snapshot) => !snapshot.events.some((event) => event.type === "finding"));
    expect(
      preFinding.some((snapshot) => snapshot.events.some((event) => event.actor === "breaker")),
      "Breaker steps showed before the findings, not all at once",
    ).toBe(true);
    expect(
      new Set(preFinding.map((snapshot) => snapshot.events.length)).size,
      "feed events arrived in more than one batch",
    ).toBeGreaterThanOrEqual(3);
    for (const snapshot of breakLog) {
      if (snapshot.events.some((event) => event.actor === "breaker")) {
        expect(snapshot.breakDisabled, "Break it disabled for the whole Break").toBe(true);
      }
      expect(
        snapshot.events.some((event) => ["proposal", "attack"].includes(event.type) || event.actor === "fixer"),
        "no Fixer output before Fix it is clicked",
      ).toBe(false);
    }
    for (const snapshot of preFinding) {
      expect(snapshot.fixDisabled, "Fix it disabled until Break finishes").toBe(true);
    }
    const afterBreak = await riskState(page);
    expect(afterBreak.total, "no new amber hearts before Fix it").toBe(before.total);

    // Done when 2: clicking a tool call shows its inputs and results.
    const firstToolEvent = feedEvents(page, "tool-call").first();
    await expect(firstToolEvent).toBeVisible();
    const toolToggle = firstToolEvent.getByTestId("tool-call-toggle");
    await expect(toolToggle).toHaveAttribute("aria-expanded", "false");
    await expect(firstToolEvent.getByTestId("tool-call-input")).toBeHidden();
    await toolToggle.click();
    await expect(toolToggle).toHaveAttribute("aria-expanded", "true");
    await expect(firstToolEvent.getByTestId("tool-call-input")).toBeVisible();
    await expect(firstToolEvent.getByTestId("tool-call-result")).toBeVisible();
    const inputText = await firstToolEvent.getByTestId("tool-call-input").textContent();
    const resultText = await firstToolEvent.getByTestId("tool-call-result").textContent();

    // Done when 3: Fix it is enabled only once the Break has finished, so no Breaker output follows it.
    const preClickLog = await readLog(page);
    const breakerCount = (snapshot: Snapshot) => snapshot.events.filter((event) => event.actor === "breaker").length;
    const findingCount = (snapshot: Snapshot) => snapshot.events.filter((event) => event.type === "finding").length;
    const finalPreClick = preClickLog[preClickLog.length - 1];
    const fixEnabledSnapshots = preClickLog.filter((snapshot) => snapshot.fixDisabled === false);
    expect(fixEnabledSnapshots.length, "Fix it was seen enabled before the click").toBeGreaterThan(0);
    for (const snapshot of fixEnabledSnapshots) {
      expect(breakerCount(snapshot), "no Breaker step arrives after Fix it is enabled").toBe(
        breakerCount(finalPreClick),
      );
      expect(findingCount(snapshot), "no finding arrives after Fix it is enabled").toBe(findingCount(finalPreClick));
    }

    // Done when 4: Fix it shows the proposal, attacks and new amber hearts.
    await startLog(page);
    await fixButton(page).click();
    await expect(feedEvents(page, "proposal").first()).toBeVisible({ timeout: RUN_TIMEOUT_MS });
    await expect(feedEvents(page, "attack").first()).toBeVisible({ timeout: RUN_TIMEOUT_MS });
    const fixLog = await readLog(page);
    const fixerRunning = fixLog.filter(
      (entry) =>
        entry.events.some((event) => event.actor === "fixer" || event.type === "proposal") &&
        !entry.events.some((event) => event.type === "attack"),
    );
    expect(fixerRunning.length, "Fixer steps streamed before the attack").toBeGreaterThan(0);
    for (const snapshot of fixerRunning) {
      expect(snapshot.breakDisabled, "Break it disabled while the Fixer runs").toBe(true);
    }

    await expect
      .poll(async () => (await riskState(page)).total, { timeout: RUN_TIMEOUT_MS, message: "risk total rises" })
      .toBeGreaterThan(before.total);
    const after = await riskState(page);
    const riskDots = Object.values(after.statuses).filter((status) => status === "risk").length;
    expect(after.total, "risk total matches the amber dots").toBe(riskDots);
    const newlyAmber = Object.keys(after.statuses).filter(
      (id) => after.statuses[id] === "risk" && before.statuses[id] !== "risk",
    );
    expect(newlyAmber.length, "new amber hearts appear on the wall").toBeGreaterThan(0);

    // The feed shows what the run API recorded, not invented events.
    const runs = await finishedRuns(request, guard.runIds);
    const serverEvents = runs.flatMap((run) => run.events);
    const stepStarts = serverEvents
      .filter((event) => event.type === "step-start")
      .map((event) => (event.data as { step: string }).step);
    expect(stepStarts.filter((step) => step === "investigate"), "demo mode: one Breaker turn").toHaveLength(1);
    const proposeSteps = stepStarts.filter((step) => step === "propose").length;
    expect(proposeSteps, "demo mode: at least one Fixer round").toBeGreaterThanOrEqual(1);
    expect(proposeSteps, "demo mode: at most 2 Fixer rounds").toBeLessThanOrEqual(2);
    expect(serverEvents.every((event) => event.mode === "replay"), "scripted events are replay").toBe(true);

    const mechanisms = runs.flatMap((run) => run.findings).filter((finding) => finding.kind === "mechanism");
    const attacks = runs.flatMap((run) => run.findings).filter((finding) => finding.kind === "attack");
    expect(mechanisms.length).toBeGreaterThan(0);
    expect(attacks.length).toBeGreaterThan(0);
    for (const finding of mechanisms) {
      expect(
        preClickFindingTexts.some((text) => text.includes(finding.title)),
        `${finding.title} was named when the Break finished, before Fix it`,
      ).toBe(true);
      await expect(feedEvents(page, "finding").filter({ hasText: finding.title }), finding.title).not.toHaveCount(0);
    }
    for (const finding of attacks) {
      await expect(feedEvents(page, "attack").filter({ hasText: finding.title }), finding.title).not.toHaveCount(0);
    }
    for (const proposal of runs.flatMap((run) => run.proposals)) {
      await expect(feedEvents(page, "proposal").filter({ hasText: proposal.rationale })).not.toHaveCount(0);
    }

    const serverCalls = serverEvents.filter((event) => event.type === "tool-call");
    await expect(feedEvents(page, "tool-call"), "every tool call is in the feed").toHaveCount(serverCalls.length);
    const firstCall = serverCalls[0].data as ToolCallData;
    await expect(toolToggle).toContainText(firstCall.tool);
    for (const leaf of leaves(firstCall.input)) {
      expect(inputText, `input shows ${leaf}`).toContain(leaf);
    }
    expect(firstCall.result, "the first tool call succeeded").toBeDefined();
    for (const leaf of leaves(firstCall.result)) {
      expect(resultText, `result shows ${leaf}`).toContain(leaf);
    }

    // Spacing fix from docs/ui-review/req-1/flagged.md item 3.
    const eventTexts = await feedEvents(page).allTextContents();
    expect(
      eventTexts.some((text) => /29[  ]mm/.test(text)),
      'the proposal shows "29 mm" with a non-breaking space',
    ).toBe(true);
    for (const text of eventTexts) {
      expect(text, "number and unit joined by a non-breaking space").not.toMatch(/\d(?:\.\d+)? +mm\b/);
      expect(text, "normal word spacing after the unit").not.toMatch(/\dmm(?=[A-Za-z])|[  ]mm(?=[A-Za-z])/);
    }
    const tightened = await feed(page)
      .locator("*")
      .evaluateAll((elements) =>
        elements.filter((element) => parseFloat(getComputedStyle(element).letterSpacing) < 0).length,
      );
    expect(tightened, "no squeezed letter spacing in the feed").toBe(0);

    // Feed stays within its column, scrolling past the maximum height.
    const viewport = page.viewportSize();
    if (!viewport) throw new Error("no viewport");
    const box = await feed(page).boundingBox();
    if (!box) throw new Error("feed panel has no box");
    expect(box.y + box.height, "feed capped above the bottom edge").toBeLessThanOrEqual(viewport.height - 23);
    const scroll = await feed(page).evaluate((panel) =>
      [...panel.querySelectorAll<HTMLElement>("*")]
        .filter((element) => element.scrollHeight > element.clientHeight + 1)
        .map((element) => getComputedStyle(element).overflowY),
    );
    const panelOverflows = await feed(page).evaluate((panel) => panel.scrollHeight > panel.clientHeight + 1);
    if (panelOverflows || scroll.length > 0) {
      expect(
        scroll.some((value) => value === "auto" || value === "scroll"),
        "overflowing feed content scrolls",
      ).toBe(true);
    }
    expect(await bottomGap(page), "full feed has no blank space below").toBeLessThanOrEqual(PANEL_PAD_TOLERANCE_PX);

    expect(await fixButton(page).evaluate((element) => getComputedStyle(element).borderTopStyle)).toBe("solid");
    expect(guard.offsite, "no network beyond localhost").toEqual([]);
    expect(guard.errors, "no console errors").toEqual([]);
  });
});
