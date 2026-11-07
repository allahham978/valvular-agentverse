import { chromium } from "@playwright/test";

const port = process.env.PORT ?? "3000";

async function main() {
  const browser = await chromium.launch({
    args: [
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`http://localhost:${port}/?stage=workspace`);
  await page.waitForSelector("canvas");
  await page.waitForTimeout(2_000);
  await page.screenshot({ path: "docs/reference/workbench.png" });
  await browser.close();
}

main();
