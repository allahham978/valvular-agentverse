import { defineConfig } from "@playwright/test";

const port = Number(process.env.PORT ?? 3000);
const realGpu = process.env.VALVULAR_GPU === "1";

export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1440, height: 900 },
    headless: !realGpu,
    launchOptions: {
      args: realGpu
        ? ["--ignore-gpu-blocklist"]
        : [
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
            "--ignore-gpu-blocklist",
          ],
    },
  },
  webServer: {
    command: `npx next start -p ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
