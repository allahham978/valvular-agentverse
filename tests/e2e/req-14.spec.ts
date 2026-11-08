import { expect, test } from "@playwright/test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const columns = ["Proposal", "No change", "Add one larger size", "Brute force"];

test.describe("REQ-14: Results", () => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    test(`compares all four designs side by side at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      const response = await page.goto("/results");
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { name: "Results", exact: true })).toBeVisible();
      const table = page.getByRole("table", { name: "Hidden-heart comparison" });
      await expect(table).toBeVisible();
      const boxes = [];
      for (const name of columns) {
        const heading = table.getByRole("columnheader", { name, exact: true });
        await expect(heading).toBeVisible();
        const box = await heading.boundingBox();
        expect(box).not.toBeNull();
        boxes.push(box!);
      }
      for (let index = 1; index < boxes.length; index++) {
        expect(boxes[index].y).toBe(boxes[0].y);
        expect(boxes[index].x).toBeGreaterThanOrEqual(boxes[index - 1].x + boxes[index - 1].width);
        expect(Math.abs(boxes[index].width - boxes[0].width)).toBeLessThan(2);
      }
      for (const [name, expected] of [
        ["Hidden-heart coverage", ["76%", "62%", "76%", "82%"]],
        ["New risks", ["3", "0", "3", "5"]],
        ["Designs tried", ["8", "1", "1", "120"]],
      ] as const) {
        const row = table.getByRole("row").filter({ has: page.getByRole("rowheader", { name, exact: true }) });
        const cells = row.getByRole("cell");
        await expect(cells).toHaveCount(4);
        for (const [index, value] of expected.entries()) await expect(cells.nth(index)).toContainText(value);
      }
      await expect(table.getByRole("row").filter({ hasText: "Hidden-heart coverage" })).toContainText("76 of 100 fit");
      await expect(page.getByText("Synthetic test hearts", { exact: true })).toBeVisible();
      await expect(page.getByText("Sample data", { exact: true })).toBeVisible();
      await expect(page.getByText("All four designs use the same 100 hidden test hearts.", { exact: true })).toBeVisible();
      const tableBox = await table.boundingBox();
      expect(tableBox!.x + tableBox!.width).toBeLessThanOrEqual(viewport.width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    });
  }

  test("shows a baseline tie and win as clearly as a proposal win", async ({ page }) => {
    await page.goto("/results");
    const outcomes = page.getByTestId("comparison-outcome");
    await expect(outcomes).toHaveText(["Proposal wins", "Tie with proposal", "Baseline wins"]);
    const styles = await outcomes.evaluateAll((elements) => elements.map((element) => {
      const style = getComputedStyle(element);
      return [style.fontSize, style.fontWeight, style.color, style.backgroundColor, style.opacity];
    }));
    expect(styles[1]).toEqual(styles[0]);
    expect(styles[2]).toEqual(styles[0]);
    await expect(page.getByText("Outcomes compare coverage only. New risks and designs tried are separate trade-offs.", { exact: true })).toBeVisible();
  });

  test("discloses the output, hidden scoring count and generator limitation", async ({ page }) => {
    await page.goto("/results");
    await expect(page.getByTestId("results-output")).toHaveText(
      "Proposal: 76 of 100 hidden test hearts fit (76%); +14 percentage points vs no change; 3 new risks; 8 designs tried.",
    );
    await expect(page.getByTestId("hidden-score-count")).toHaveText("Hidden hearts scored 1 time");
    await expect(page.getByText("Test hearts, not patients. All hearts come from one generator.", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("hidden-score-count")).toHaveText("Hidden hearts scored 1 time");
    await page.getByRole("link", { name: "Back to workbench" }).click();
    await expect(page).toHaveURL(/\/\?stage=workspace$/);
  });

  test("renders supplied scores and derives outcomes instead of fixing winners to methods", async ({ page }) => {
    const { ResultsComparison } = await import("../../src/components/results");
    const { sampleResults } = await import("../../src/components/results/sample-results");
    const { SummarySchema, BaselineSchema } = await import("../../src/contracts");
    expect(SummarySchema.safeParse(sampleResults.proposal.summary).success).toBe(true);
    for (const baseline of sampleResults.baselines) {
      expect(BaselineSchema.safeParse(baseline).success).toBe(true);
      expect(baseline.summary.split).toBe("hidden");
      expect(baseline.summary.fit + baseline.summary.risk + baseline.summary.noFit).toBe(baseline.summary.total);
    }
    const changed = {
      ...sampleResults,
      hiddenScoreCount: 3,
      proposal: {
        summary: { ...sampleResults.proposal.summary, fit: 60, fitPct: 60, risk: 20, noFit: 20, newRiskHeartIds: [] },
        designsTried: 12,
      },
      baselines: sampleResults.baselines.map((baseline, index) => ({
        ...baseline,
        summary: { ...baseline.summary, fit: [70, 50, 60][index], fitPct: [70, 50, 60][index], risk: 10, noFit: [20, 40, 30][index] },
      })),
    };
    await page.setContent(renderToStaticMarkup(createElement(ResultsComparison, { results: changed })));
    await expect(page.getByTestId("comparison-outcome")).toHaveText(["Baseline wins", "Proposal wins", "Tie with proposal"]);
    await expect(page.getByTestId("hidden-score-count")).toHaveText("Hidden hearts scored 3 times");
    await expect(page.getByTestId("results-output")).toHaveText(
      "Proposal: 60 of 100 hidden test hearts fit (60%); −10 percentage points vs no change; 0 new risks; 12 designs tried.",
    );
  });
});
