import { expect, test, type Page } from "@playwright/test";

// Fix track B: demo consistency after batch 3. Scripted button runs through the real tools,
// so no Gemini key; every wait is on page state, not on wall-clock timing.

type RunEvent = { seq: number; type: string; text: string; data: unknown };
type AttackOutcome = { kind: string; outcome: "survived" | "broke" };
type VerdictData = { verdict: string; attacks: AttackOutcome[] };

declare global {
  interface Window {
    __feedGaps: number[];
  }
}

const RUN_TIMEOUT_MS = 60_000;

const feed = (page: Page) => page.getByTestId("feed-panel");
const feedList = (page: Page) => feed(page).locator("ol");
const feedEvents = (page: Page, type?: string) =>
  feed(page).locator(type ? `[data-testid=feed-event][data-type="${type}"]` : "[data-testid=feed-event]");
const button = (page: Page, name: string) => page.getByTestId("controls-panel").getByRole("button", { name });

function trackRun(page: Page) {
  const state = { id: "", errors: [] as string[] };
  page.on("console", (message) => {
    if (message.type() === "error") state.errors.push(message.text());
  });
  page.on("pageerror", (error) => state.errors.push(error.message));
  page.on("response", async (response) => {
    const url = new URL(response.url());
    if (response.request().method() !== "POST" || url.pathname !== "/api/runs" || response.status() !== 201) return;
    const body = (await response.json().catch(() => null)) as { id?: string } | null;
    if (body?.id) state.id = body.id;
  });
  return state;
}

async function breakIt(page: Page) {
  await page.goto("/?stage=workspace");
  await button(page, "Break it").click();
  await expect(button(page, "Fix it")).toBeEnabled({ timeout: RUN_TIMEOUT_MS });
}

async function fixIt(page: Page) {
  await button(page, "Fix it").click();
  await expect(feedEvents(page, "verdict")).toHaveCount(1, { timeout: RUN_TIMEOUT_MS });
}

const gapToBottom = (page: Page) =>
  feedList(page).evaluate((list) => list.scrollHeight - list.scrollTop - list.clientHeight);

test.describe.configure({ timeout: 120_000 });

test.describe("the feed follows the run", () => {
  test("after Fix it, the proposal, attack and verdict scroll into view", async ({ page }) => {
    const run = trackRun(page);
    await breakIt(page);
    await fixIt(page);

    const overflows = await feedList(page).evaluate((list) => list.scrollHeight > list.clientHeight + 1);
    expect(overflows, "at 1440x900 the finished run is taller than the feed").toBe(true);
    await expect(feedEvents(page, "verdict")).toBeInViewport({ ratio: 1 });
    await expect(feedEvents(page, "attack").last()).toBeInViewport();
    await expect.poll(() => gapToBottom(page)).toBeLessThanOrEqual(2);
    expect(run.errors).toEqual([]);
  });

  test("a user who scrolls back keeps their place while events arrive", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 640 });
    const run = trackRun(page);
    await breakIt(page);
    await expect
      .poll(() => feedList(page).evaluate((list) => list.scrollHeight > list.clientHeight + 40), {
        message: "the finished Break overflows the feed at this height",
      })
      .toBe(true);

    await feedList(page).evaluate((list) => {
      list.scrollTop = 0;
      list.dispatchEvent(new Event("scroll"));
    });
    await fixIt(page);

    expect(await feedList(page).evaluate((list) => list.scrollTop)).toBe(0);
    await expect(feedEvents(page).first()).toBeInViewport();
    await expect(feedEvents(page, "verdict")).not.toBeInViewport();
    expect(run.errors).toEqual([]);
  });

  test("with reduced motion, new events land at the bottom without a smooth scroll", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const run = trackRun(page);
    await page.goto("/?stage=workspace");
    await page.evaluate(() => {
      window.__feedGaps = [];
      new MutationObserver(() => {
        const list = document.querySelector<HTMLElement>("[data-testid=feed-panel] ol");
        if (!list || list.scrollHeight <= list.clientHeight + 1) return;
        window.__feedGaps.push(list.scrollHeight - list.scrollTop - list.clientHeight);
      }).observe(document.body, { subtree: true, childList: true });
    });
    await button(page, "Break it").click();
    await expect(button(page, "Fix it")).toBeEnabled({ timeout: RUN_TIMEOUT_MS });
    await fixIt(page);

    const gaps = await page.evaluate(() => window.__feedGaps);
    expect(gaps.length, "the feed overflowed while events arrived").toBeGreaterThan(0);
    expect(Math.max(...gaps), "each new event is already at the bottom when it appears").toBeLessThanOrEqual(2);
    await expect(feedEvents(page, "verdict")).toBeInViewport({ ratio: 1 });
    expect(run.errors).toEqual([]);
  });
});

test.describe("the feed links to the review", () => {
  test("once a proposal shows, the feed links to /review for this run", async ({ page }) => {
    const run = trackRun(page);
    await breakIt(page);
    await expect(feed(page).getByRole("link", { name: /review/i })).toHaveCount(0);
    await fixIt(page);

    expect(run.id, "the page started a run").not.toBe("");
    const link = feed(page).getByRole("link", { name: /review/i });
    await expect(link).toHaveAttribute("href", `/review?run=${run.id}`);
    await expect(link).toBeInViewport();
    await expect
      .poll(async () => (await (await page.request.get(`/api/runs/${run.id}`)).json()).status, { timeout: RUN_TIMEOUT_MS })
      .toBe("finished");
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/review\\?run=${run.id}$`));
    await expect(page.getByTestId("review-change")).toBeVisible();
    expect(run.errors).toEqual([]);
  });
});

test.describe("the attack wording matches the code verdict", () => {
  test("a survived attack reads as survived, and the verdict says so", async ({ page }) => {
    const run = trackRun(page);
    await breakIt(page);
    await fixIt(page);

    await expect
      .poll(async () => (await (await page.request.get(`/api/runs/${run.id}`)).json()).status, { timeout: RUN_TIMEOUT_MS })
      .toBe("finished");
    const body = (await (await page.request.get(`/api/runs/${run.id}`)).json()) as { run: { events: RunEvent[] } };
    const verdict = body.run.events.find((event) => event.type === "verdict")?.data as VerdictData | undefined;
    expect(verdict?.attacks.length, "the code verdict lists the attack").toBeGreaterThan(0);
    const survived = verdict!.attacks.every((attack) => attack.outcome === "survived");
    expect(survived, "the demo attack survives (71.5% after the shift)").toBe(true);

    const attackText = (await feedEvents(page, "attack").allTextContents()).join(" ");
    expect(attackText).toMatch(/held|survived|still/i);
    expect(attackText).not.toMatch(/now sit|break|broke|fails?\b|edge/i);

    const verdictRow = feedEvents(page, "verdict");
    await expect(verdictRow).toContainText(/survived/i);
    await expect(verdictRow).toContainText(/supported under conditions/i);
    await expect(verdictRow).not.toContainText("supported_under_conditions");
    expect(run.errors).toEqual([]);
  });
});
