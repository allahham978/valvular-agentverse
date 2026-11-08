import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const base = `http://localhost:${process.env.PORT ?? 3030}`;
const out = process.argv[2] ?? "docs/ui-review/batch-3";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const errors = [];
const watch = (page, tag) => {
  page.on("console", (m) => m.type() === "error" && errors.push(`${tag}: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`${tag}: ${e.message}`));
};
const feedTypes = (page) =>
  page.evaluate(() => {
    const by = {};
    for (const e of document.querySelectorAll("[data-testid=feed-event]")) {
      const type = e.getAttribute("data-type");
      by[type] = (by[type] ?? 0) + 1;
    }
    return by;
  });

let runId;
for (const viewport of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
  const tag = `${viewport.width}x${viewport.height}`;
  const page = await browser.newPage({ viewport });
  watch(page, tag);
  await page.goto(`${base}/?stage=workspace`);
  const breakIt = page.getByRole("button", { name: /break it/i });
  const fixIt = page.getByRole("button", { name: /fix it/i });
  await breakIt.waitFor();
  await page.waitForTimeout(3000);

  const posted = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/runs" && r.request().method() === "POST");
  await breakIt.click();
  runId = ((await (await posted).json()).id);
  await page.locator('[data-testid=feed-event][data-actor="breaker"]').first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/1-during-break-${tag}.png` });

  await page.waitForFunction((el) => el && !el.disabled, await fixIt.elementHandle(), { timeout: 90_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/2-after-break-${tag}.png` });

  await fixIt.click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/3-during-fix-${tag}.png` });
  await page.locator('[data-testid=feed-event][data-type="verdict"]').first().waitFor({ timeout: 90_000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/4-after-fix-${tag}.png` });
  console.log(tag, runId, JSON.stringify(await feedTypes(page)));

  await page.goto(`${base}/review?run=${runId}`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/5-review-${tag}.png`, fullPage: true });

  const replayPage = await browser.newPage({ viewport });
  watch(replayPage, `${tag} replay`);
  let rewritten = false;
  await replayPage.route("**/api/runs", (route) => {
    if (route.request().method() !== "POST" || rewritten) return route.continue();
    rewritten = true;
    return route.continue({ postData: JSON.stringify({ replayId: "demo" }), headers: { ...route.request().headers(), "content-type": "application/json" } });
  });
  await replayPage.goto(`${base}/?stage=workspace`);
  const replayBreak = replayPage.getByRole("button", { name: /break it/i });
  await replayBreak.waitFor();
  await replayPage.waitForTimeout(2000);
  await replayBreak.click();
  await replayPage.getByTestId("replay-label").waitFor({ timeout: 30_000 });
  await replayPage.waitForTimeout(1500);
  await replayPage.screenshot({ path: `${out}/6-replay-${tag}.png` });
  const replayFix = replayPage.getByRole("button", { name: /fix it/i });
  await replayPage.waitForFunction((el) => el && !el.disabled, await replayFix.elementHandle(), { timeout: 90_000 });
  await replayFix.click();
  await replayPage.waitForTimeout(8000);
  await replayPage.screenshot({ path: `${out}/7-replay-done-${tag}.png` });
  console.log(tag, "replay", JSON.stringify(await feedTypes(replayPage)));
  await replayPage.close();
  await page.close();
}
await browser.close();
console.log(errors.length ? `console errors:\n${errors.join("\n")}` : "no console errors");
