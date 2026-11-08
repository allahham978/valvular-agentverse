import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { RunSchema, type Limit, type Run, type Summary } from "../../src/contracts/index";

// REQ-14: Results. Runs come from the main-path replay over HTTP (scripted, no key, no network).
// Every number on the page is checked against the real REQ-13 score report for the same run.

const TEST_TIMEOUT_MS = 180_000;
const POLL_MS = 90_000;
const REPLAY_ID = "demo";
const DISCLAIMER = "Test hearts, not patients. All hearts come from one generator.";
const METHODS = ["proposal", "no-change", "add-larger-size", "brute-force"] as const;
const BASELINES = ["no-change", "add-larger-size", "brute-force"] as const;
const NAMES: Record<(typeof BASELINES)[number], RegExp> = {
  "no-change": /no change/i,
  "add-larger-size": /add one larger size/i,
  "brute-force": /brute force/i,
};
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];

type Method = (typeof METHODS)[number];
type Mark = "proposal-wins" | "tie" | "baseline-wins";
type Row = {
  method: Method;
  summary: Summary | null;
  coveragePct: number | null;
  newRiskCount: number | null;
  designsTried: number;
  marks?: { coverage: Mark; newRisk: Mark };
  reason?: string;
};
type ScoreReport = {
  runId: string;
  heartSet: { split: string; count: number };
  hiddenScoreCount: number;
  rows: Row[];
};

test.describe.configure({ timeout: TEST_TIMEOUT_MS });

const num = (value: number) => new RegExp(`(^|[^\\d.])${String(value).replace(".", "\\.")}([^\\d]|$)`);

async function replayRun(request: APIRequestContext): Promise<Run> {
  const started = await request.post("/api/runs", { data: { replayId: REPLAY_ID } });
  expect(started.status(), "main-path replay starts").toBe(201);
  const { id } = (await started.json()) as { id: string };
  let run: Run | undefined;
  await expect
    .poll(
      async () => {
        const view = (await (await request.get(`/api/runs/${id}`)).json()) as { status: string; run: unknown };
        run = RunSchema.parse(view.run);
        return view.status;
      },
      { timeout: POLL_MS, message: `replay run ${id} finishes` },
    )
    .toBe("finished");
  return run!;
}

async function reportFor(request: APIRequestContext, runId: string): Promise<ScoreReport> {
  const response = await request.get(`/api/score?runId=${runId}`);
  expect(response.status(), `run ${runId} has a saved score report`).toBe(200);
  return (await response.json()) as ScoreReport;
}

async function openResults(page: Page, url: string) {
  const response = await page.goto(url);
  expect(response?.status() ?? 0, `${url} loads`).toBeLessThan(400);
  await expect(page.getByTestId("results-table")).toBeVisible({ timeout: 60_000 });
}

const column = (page: Page, method: Method) => page.getByTestId(`results-col-${method}`);
const rowOf = (report: ScoreReport, method: Method) => {
  const row = report.rows.find((candidate) => candidate.method === method);
  expect(row, `report has a ${method} row`).toBeDefined();
  return row!;
};

async function expectNumbersMatch(page: Page, report: ScoreReport) {
  for (const method of METHODS) {
    const row = rowOf(report, method);
    const col = column(page, method);
    await expect(col, `${method} column`).toBeVisible();
    const coverage = col.getByTestId("coverage");
    const newRisk = col.getByTestId("new-risk");
    const tried = col.getByTestId("designs-tried");
    if (row.summary) {
      await expect(coverage).toHaveText(num(row.summary.fit));
      await expect(coverage).toHaveText(num(report.heartSet.count));
      await expect(newRisk).toHaveText(num(row.newRiskCount ?? -1));
    } else {
      await expect(col).toContainText(row.reason ?? "");
    }
    await expect(tried).toHaveText(num(row.designsTried));
  }
}

async function expectSideBySide(page: Page) {
  const boxes = [];
  for (const method of METHODS) {
    const box = await column(page, method).boundingBox();
    expect(box, `${method} column has a box`).not.toBeNull();
    boxes.push(box!);
  }
  const viewport = page.viewportSize()!;
  for (let i = 0; i < boxes.length; i++) {
    expect(Math.abs(boxes[i].y - boxes[0].y), `${METHODS[i]} column top aligns with the proposal`).toBeLessThanOrEqual(8);
    expect(boxes[i].x + boxes[i].width, `${METHODS[i]} column fits the viewport`).toBeLessThanOrEqual(viewport.width);
    expect(boxes[i].y, `${METHODS[i]} column starts well above the fold`).toBeLessThanOrEqual(viewport.height - 200);
    if (i > 0) expect(boxes[i].x, `${METHODS[i]} sits right of ${METHODS[i - 1]}`).toBeGreaterThanOrEqual(boxes[i - 1].x + boxes[i - 1].width - 1);
  }
}

type BadgeStyle = { fontSize: string; fontWeight: string; visible: boolean; hasFill: boolean; hasBorder: boolean; contrast: number; height: number };

async function badgeStyle(badge: Locator): Promise<BadgeStyle> {
  return badge.evaluate((el) => {
    const parse = (c: string) => (c.match(/[\d.]+/g) ?? ["0", "0", "0", "0"]).map(Number);
    const lum = ([r, g, b]: number[]) => {
      const ch = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
    };
    const over = (top: number[], base: number[]) => {
      const a = top.length > 3 ? top[3] : 1;
      return [0, 1, 2].map((i) => top[i] * a + base[i] * (1 - a));
    };
    let base = [255, 255, 255];
    const chain: Element[] = [];
    for (let node: Element | null = el; node; node = node.parentElement) chain.unshift(node);
    let visible = true;
    for (const node of chain) {
      const s = getComputedStyle(node);
      if (Number(s.opacity) < 1 || s.visibility !== "visible" || s.filter !== "none") visible = false;
      const bg = parse(s.backgroundColor);
      if ((bg.length > 3 ? bg[3] : 1) > 0) base = over(bg, base);
    }
    const style = getComputedStyle(el);
    const fill = parse(style.backgroundColor);
    const text = over(parse(style.color), base);
    const [l1, l2] = [lum(text), lum(base)].sort((a, b) => b - a);
    return {
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      visible,
      hasFill: (fill.length > 3 ? fill[3] : 1) > 0,
      hasBorder: parseFloat(style.borderTopWidth) >= 1 && style.borderTopStyle !== "none",
      contrast: (l1 + 0.05) / (l2 + 0.05),
      height: el.getBoundingClientRect().height,
    };
  });
}

function expectMarkText(mark: Mark, text: string, baseline: (typeof BASELINES)[number]) {
  if (mark === "tie") expect(text, "tie label").toMatch(/\btie\b|\bsame\b/i);
  if (mark === "proposal-wins") expect(text, "win label").toMatch(/proposal.*(wins|better|ahead)/i);
  if (mark === "baseline-wins") {
    expect(text, "baseline win label").toMatch(new RegExp(`(baseline|${NAMES[baseline].source}).*(wins|better|ahead|beats)`, "i"));
    expect(text, "baseline win is not worded as a proposal win").not.toMatch(/proposal (wins|is better|ahead)/i);
  }
}

test.describe("Done when 1: proposal and three baselines side by side", () => {
  test("a finished run shows all four with hidden-heart coverage, new risks and designs tried from the score report", async ({ page, request }) => {
    const run = await replayRun(request);
    expect((await request.get(`/api/score?runId=${run.id}`)).status(), "not scored before the page opens").toBe(404);
    await openResults(page, `/results?run=${run.id}`);
    const report = await reportFor(request, run.id);
    expect(report.rows.map((row) => row.method).sort()).toEqual([...METHODS].sort());

    await expect(column(page, "proposal")).toContainText(/proposal/i);
    for (const baseline of BASELINES) await expect(column(page, baseline)).toContainText(NAMES[baseline]);
    for (const method of METHODS) {
      const col = column(page, method);
      await expect(col).toContainText(/hidden/i);
      await expect(col).toContainText(/new risk/i);
      await expect(col).toContainText(/designs tried/i);
    }
    await expectNumbersMatch(page, report);
  });

  for (const viewport of VIEWPORTS) {
    test(`the four columns sit side by side at ${viewport.width}x${viewport.height}`, async ({ page, request }) => {
      const run = await replayRun(request);
      await page.setViewportSize(viewport);
      await openResults(page, `/results?run=${run.id}`);
      await expectSideBySide(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, "no horizontal scroll").toBeLessThanOrEqual(0);
    });
  }

  test("each proposal shows its code-assigned claim verdict", async ({ page, request }) => {
    const run = await replayRun(request);
    const judged = run.proposals.filter((proposal) => proposal.verdict);
    expect(judged.length, "precondition: the replay run has a proposal with a verdict").toBeGreaterThan(0);
    await openResults(page, `/results?run=${run.id}`);
    const verdicts = page.getByTestId("results-verdict");
    await expect(verdicts).toHaveCount(run.proposals.length);
    for (const proposal of judged) {
      const el = page.locator(`[data-testid="results-verdict"][data-proposal-id="${proposal.id}"]`);
      await expect(el).toBeVisible();
      await expect(el).toHaveAttribute("data-verdict", proposal.verdict!);
      await expect(el).toContainText(new RegExp(proposal.verdict!.replaceAll("_", " "), "i"));
    }
  });

  test("/results with no run shows the main-path replay run, scored", async ({ page, request }) => {
    await openResults(page, "/results");
    const runId = await page.getByTestId("results-table").getAttribute("data-run-id");
    expect(runId, "the page names the run it shows").toBeTruthy();
    const view = (await (await request.get(`/api/runs/${runId}`)).json()) as { status: string; run: unknown };
    expect(view.status).toBe("finished");
    const run = RunSchema.parse(view.run);
    expect(run.events.every((event) => event.mode === "replay"), "the default run is a replay").toBe(true);
    await expectNumbersMatch(page, await reportFor(request, runId!));
  });

  test("an unknown run says so instead of crashing", async ({ page }) => {
    const response = await page.goto("/results?run=no-such-run-req14");
    expect(response?.status() ?? 500).toBeLessThan(500);
    await expect(page.getByRole("heading", { name: /results/i })).toBeVisible();
    await expect(page.getByTestId("results-missing")).toBeVisible();
    await expect(page.getByTestId("results-table")).toHaveCount(0);
  });
});

test.describe("Done when 2: a baseline that ties or wins is shown as clearly as a win", () => {
  test("every mark is labelled in words and styled with equal weight", async ({ page, request }) => {
    const run = await replayRun(request);
    const scored = await request.post("/api/score", { data: { runId: run.id } });
    expect(scored.status(), "the run scores").toBe(200);
    const report = (await scored.json()) as ScoreReport;
    const marks = BASELINES.flatMap((baseline) => {
      const row = rowOf(report, baseline);
      return row.marks
        ? [
            { baseline, metric: "coverage", mark: row.marks.coverage },
            { baseline, metric: "new-risk", mark: row.marks.newRisk },
          ]
        : [];
    });
    expect(
      marks.some((m) => m.mark !== "proposal-wins"),
      "precondition: the main-path run has a baseline that ties or wins",
    ).toBe(true);
    await openResults(page, `/results?run=${run.id}`);
    expect((await reportFor(request, run.id)).hiddenScoreCount, "the page shows the saved report").toBe(report.hiddenScoreCount);

    const styles: BadgeStyle[] = [];
    for (const { baseline, metric, mark } of marks) {
      const badge = column(page, baseline).getByTestId(`mark-${metric}`);
      await expect(badge, `${baseline} ${metric} mark`).toBeVisible();
      await expect(badge).toHaveAttribute("data-mark", mark);
      expectMarkText(mark, (await badge.innerText()).trim(), baseline);
      const style = await badgeStyle(badge);
      expect(style.visible, `${baseline} ${metric} mark is not faded or hidden`).toBe(true);
      expect(style.contrast, `${baseline} ${metric} mark text contrast`).toBeGreaterThanOrEqual(4.5);
      expect(style.height, `${baseline} ${metric} mark height`).toBeGreaterThanOrEqual(16);
      styles.push(style);
    }
    for (const style of styles) {
      expect(style.fontSize, "same font size for every mark").toBe(styles[0].fontSize);
      expect(style.fontWeight, "same font weight for every mark").toBe(styles[0].fontWeight);
      expect(style.hasFill, "same fill treatment for every mark").toBe(styles[0].hasFill);
      expect(style.hasBorder, "same border treatment for every mark").toBe(styles[0].hasBorder);
    }
  });

  test("the output line names a baseline that beats the proposal on coverage", async ({ page, request }) => {
    const run = await replayRun(request);
    await openResults(page, `/results?run=${run.id}`);
    const report = await reportFor(request, run.id);
    const line = page.getByTestId("output-line");
    await expect(line).toBeVisible();
    for (const baseline of BASELINES) {
      if (rowOf(report, baseline).marks?.coverage === "baseline-wins") await expect(line).toContainText(NAMES[baseline]);
    }
  });
});

test.describe("Done when 3: output line, hidden score count and the disclaimer", () => {
  test("the page reads the output line, the hidden score count and the disclaimer", async ({ page, request }) => {
    const run = await replayRun(request);
    await openResults(page, `/results?run=${run.id}`);
    const report = await reportFor(request, run.id);
    const proposal = rowOf(report, "proposal");

    const line = page.getByTestId("output-line");
    await expect(line).toBeVisible();
    await expect(line).toHaveText(num(proposal.summary!.fit));
    await expect(line).toHaveText(num(report.heartSet.count));
    await expect(line).toContainText(/hidden/i);

    const count = page.getByTestId("hidden-score-count");
    await expect(count).toBeVisible();
    await expect(count).toContainText(/hidden/i);
    await expect(count).toContainText(/scored/i);
    await expect(count).toHaveText(num(report.hiddenScoreCount));

    await expect(page.getByText(DISCLAIMER, { exact: true })).toBeVisible();
  });

  test("viewing does not rescore, and a new scoring shows the count go up", async ({ page, request }) => {
    const run = await replayRun(request);
    await openResults(page, `/results?run=${run.id}`);
    const first = await reportFor(request, run.id);
    await page.reload();
    await expect(page.getByTestId("results-table")).toBeVisible();
    expect((await reportFor(request, run.id)).hiddenScoreCount, "reload does not score again").toBe(first.hiddenScoreCount);
    await expect(page.getByTestId("hidden-score-count")).toHaveText(num(first.hiddenScoreCount));

    const limit: Limit = { id: "limit-req14", kind: "max-sizes", value: 2, sourceText: "no more than 2 sizes" };
    const rescored = await request.post("/api/score", { data: { runId: run.id, limits: [limit] } });
    expect(rescored.status()).toBe(200);
    const second = (await rescored.json()) as ScoreReport;
    expect(second.hiddenScoreCount).toBe(first.hiddenScoreCount + 1);
    await page.reload();
    await expect(page.getByTestId("hidden-score-count")).toHaveText(num(second.hiddenScoreCount));
    await expectNumbersMatch(page, second);
  });

  test("no console errors on the results page", async ({ page, request }) => {
    const errors: string[] = [];
    page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
    page.on("pageerror", (error) => errors.push(error.message));
    const run = await replayRun(request);
    await openResults(page, `/results?run=${run.id}`);
    await openResults(page, "/results");
    expect(errors).toEqual([]);
  });
});
