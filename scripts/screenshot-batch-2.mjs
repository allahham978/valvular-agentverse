import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const base = `http://localhost:${process.env.PORT ?? 3020}`;
const out = process.argv[2] ?? "docs/ui-review/batch-2";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const errors = [];
for (const viewport of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
  const tag = `${viewport.width}x${viewport.height}`;
  const page = await browser.newPage({ viewport });
  page.on("console", (m) => m.type() === "error" && errors.push(`${tag}: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`${tag}: ${e.message}`));
  await page.goto(`${base}/?stage=workspace`);
  const feed = page.getByTestId("feed-panel");
  const breakIt = page.getByRole("button", { name: /break it/i });
  const fixIt = page.getByRole("button", { name: /fix it/i });
  await breakIt.waitFor();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${out}/1-idle-${tag}.png` });

  await breakIt.click();
  await page.locator('[data-testid=feed-event][data-actor="breaker"]').first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/2-during-break-${tag}.png` });
  const breakDisabled = await breakIt.isDisabled();

  await page.waitForFunction((el) => el && !el.disabled, await fixIt.elementHandle(), { timeout: 90_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/3-after-break-${tag}.png` });

  await fixIt.click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/4-during-fix-${tag}.png` });
  await page.locator('[data-testid=feed-event][data-type="attack"]').first().waitFor({ timeout: 90_000 }).catch(() => {});
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${out}/5-after-fix-${tag}.png` });
  const counts = await page.evaluate(() => {
    const ev = [...document.querySelectorAll("[data-testid=feed-event]")];
    const by = {};
    for (const e of ev) by[e.getAttribute("data-type")] = (by[e.getAttribute("data-type")] ?? 0) + 1;
    return by;
  });
  console.log(tag, JSON.stringify({ breakDisabledDuringRun: breakDisabled, feedEventTypes: counts }));
  await page.close();
}
await browser.close();
console.log(errors.length ? `console errors:\n${errors.join("\n")}` : "no console errors");
