import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const base = `http://localhost:${process.env.PORT ?? 3020}`;
const out = process.argv[2] ?? "docs/ui-review/batch-1";
mkdirSync(out, { recursive: true });

const progress = (page) =>
  page.evaluate(() =>
    Number(document.querySelector("[data-stage-progress]")?.getAttribute("data-stage-progress") ?? NaN),
  );

async function settle(page) {
  let last = -1;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(150);
    const next = await progress(page);
    if (Math.abs(next - last) < 0.002) return next;
    last = next;
  }
  return last;
}

const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
for (const viewport of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
  const tag = `${viewport.width}x${viewport.height}`;
  const page = await browser.newPage({ viewport });
  await page.goto(`${base}/`);
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${out}/1-opening-${tag}.png` });

  await page.mouse.move(viewport.width / 2, viewport.height / 2);
  for (let i = 0; i < 60; i++) {
    const p = await settle(page);
    if (p >= 0.4 && p <= 0.6) break;
    await page.mouse.wheel(0, p < 0.4 ? 120 : -60);
  }
  await page.screenshot({ path: `${out}/2-mid-zoom-${tag}.png` });

  await page.goto(`${base}/?stage=workspace`);
  await page.getByTestId("wall-panel").waitFor();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${out}/3-workspace-${tag}.png` });

  await page.getByTestId("wall-panel").getByRole("button", { name: /expand/i }).click();
  await page.getByTestId("wall-overlay").waitFor();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/4-expanded-wall-${tag}.png` });
  await page.getByTestId("wall-overlay").getByRole("button", { name: /close/i }).click();

  const redDot = page.locator('[data-testid="wall-dot"][data-status="no-fit"]').first();
  const target = (await redDot.count()) ? redDot : page.getByTestId("wall-dot").nth(5);
  await target.click();
  await page.getByTestId("heart-popup").waitFor();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${out}/5-popup-${tag}.png` });
  await page.close();
}
await browser.close();
