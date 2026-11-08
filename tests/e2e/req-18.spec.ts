import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import sources from "../../data/sources.json";

const credit = readFileSync(
  path.join(process.cwd(), "public/models/heart.credit.txt"),
  "utf8",
).trim();
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];

test.describe.configure({ timeout: 90_000 });

test.describe("REQ-18: About", () => {
  test("identifies the dataset, licence and excluded real cohort", async ({ page }) => {
    await page.goto("/about");
    const dataset = page.getByTestId("about-dataset");
    await expect(dataset).toBeVisible();
    await expect(dataset).toContainText(sources.authors);
    await expect(dataset).toContainText(String(sources.year));
    await expect(dataset).toContainText(/500 synthetic stenotic aortic roots/i);
    await expect(dataset).toContainText(sources.cohort);
    await expect(dataset).toContainText(sources.licence);
    await expect(dataset).toContainText(/real_cohort is not used/i);
    await expect(dataset.getByRole("link", { name: /4TU/ })).toHaveAttribute(
      "href",
      sources.url,
    );
  });

  test("explains generation and the reproducible development/hidden split", async ({ page }) => {
    await page.goto("/about");
    const generation = page.getByTestId("about-generation");
    await expect(generation).toBeVisible();
    await expect(generation).toContainText(/shape model built on 97 patients/i);
    await expect(generation).toContainText(`${sources.split.dev} dev`);
    await expect(generation).toContainText(`${sources.split.hidden} hidden`);
    await expect(generation).toContainText(/stratified by annulus band/i);
    await expect(generation).toContainText(/fixed seed/i);
    await expect(generation).toContainText(/seeded shuffl\w* within (each )?band/i);
    await expect(generation).toContainText(/largest remainder/i);
  });

  test("states every fit, anatomy, cohort and placeholder limit", async ({ page }) => {
    await page.goto("/about");
    const limits = page.getByTestId("about-limits");
    await expect(limits).toBeVisible();
    for (const text of [
      /fit only/i,
      /test hearts, not patients/i,
      /no safety claims/i,
      /no coronaries or calcium/i,
      /coronary risk cannot be calculated/i,
      /stenosis only/i,
      /both splits come from one generator/i,
      /97 patients/i,
      /hidden score.*not real-world performance/i,
      /fit rules marked demo-assumption are placeholders/i,
    ]) {
      await expect(limits).toContainText(text);
    }
    await expect(page.locator("main")).not.toContainText(
      /\b(?:safe|ready)\b|clinically validated|approved for use/i,
    );
  });

  test("credits the illustrative heart exactly and qualifies its licence", async ({ page }) => {
    await page.goto("/about");
    const model = page.getByTestId("about-heart-credit");
    await expect(model).toBeVisible();
    await expect(model.getByText("Illustrative", { exact: true })).toBeVisible();
    await expect(page.getByTestId("about-credit-line")).toHaveText(credit);
    await expect(model).toContainText(/licence.*still being confirmed/i);
    await expect(model.getByRole("link", { name: /NIH 3D/ })).toHaveAttribute(
      "href",
      "https://3d.nih.gov/entries/3DPX-022787",
    );
  });

  for (const viewport of VIEWPORTS) {
    test(`reference page is readable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      await page.setViewportSize(viewport);
      const response = await page.goto("/about");
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: "About", exact: true })).toBeVisible();
      await expect(page.getByRole("banner").getByText("Synthetic test hearts")).toBeVisible();
      await expect(page.getByRole("banner").getByRole("link", { name: "Valvular" })).toHaveAttribute("href", "/?stage=workspace");
      await expect(page.locator("main").getByRole("heading", { level: 2 })).toHaveCount(4);
      for (const id of ["about-dataset", "about-generation", "about-limits", "about-heart-credit"]) {
        const section = page.getByTestId(id);
        await section.scrollIntoViewIfNeeded();
        await expect(section).toBeVisible();
        const box = await section.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
      const figures = page.getByTestId("about-figure");
      expect(await figures.count()).toBeGreaterThanOrEqual(5);
      for (const figure of await figures.all()) {
        const style = await figure.evaluate((element) => {
          const computed = getComputedStyle(element);
          return { family: computed.fontFamily, numbers: computed.fontVariantNumeric };
        });
        expect(style.family).toMatch(/geist.*mono/i);
        expect(style.numbers).toContain("tabular-nums");
      }
      expect(errors).toEqual([]);
    });
  }
});
