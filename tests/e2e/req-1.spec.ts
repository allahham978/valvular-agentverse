import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";

const ROOT = process.cwd();
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];
const SCREENS = [
  { url: "/", heading: /valvular/i },
  { url: "/results", heading: /results/i },
  { url: "/review", heading: /review/i },
  { url: "/about", heading: /about/i },
];

const fromRoot = (relPath: string) => path.join(ROOT, relPath);

function readRequired(relPath: string): Buffer {
  expect(existsSync(fromRoot(relPath)), `${relPath} should exist`).toBe(true);
  return readFileSync(fromRoot(relPath));
}

function readJson<T>(relPath: string): T {
  return JSON.parse(readRequired(relPath).toString("utf8")) as T;
}

// Every spec keeps running in verify, so checks of temporary stub behaviour
// retire once the requirement that replaces the stub adds its spec.
const replacedBy = (req: number) =>
  existsSync(fromRoot(`tests/e2e/req-${req}.spec.ts`));

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

function isTopmostAt(locator: Locator, x: number, y: number) {
  return locator.evaluate(
    (element, [px, py]) => {
      const hit = document.elementFromPoint(px, py);
      return hit !== null && element.contains(hit);
    },
    [x, y],
  );
}

function computedStyle(locator: Locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      borderTopWidth: style.borderTopWidth,
      boxShadow: style.boxShadow,
      color: style.color,
      fontFamily: style.fontFamily,
    };
  });
}

test.describe.configure({ timeout: 90_000 });

test.describe("screens", () => {
  for (const { url, heading } of SCREENS) {
    test(`${url} loads with no console errors`, async ({ page }) => {
      const errors = trackErrors(page);
      const response = await page.goto(url);
      expect(response?.status()).toBe(200);
      await expect(page.locator("main")).toBeVisible();
      await expect(page.getByText(heading).first()).toBeVisible();
      await page.waitForTimeout(1_000);
      expect(errors).toEqual([]);
    });
  }

  test("/?stage=workspace loads with no console errors", async ({ page }) => {
    const errors = trackErrors(page);
    const response = await page.goto("/?stage=workspace");
    expect(response?.status()).toBe(200);
    await expect(page.getByTestId("wall-panel")).toBeVisible();
    await page.waitForTimeout(1_000);
    expect(errors).toEqual([]);
  });

  for (const url of ["/?stage=workspace", "/results", "/review"]) {
    test(`${url} is labelled "Synthetic test hearts"`, async ({ page }) => {
      await page.goto(url);
      await expect(
        page.getByText("Synthetic test hearts").first(),
      ).toBeVisible();
    });
  }
});

test.describe("stage", () => {
  test("/ opens at progress 0 with the heart label and no panels", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("[data-stage-progress]")).toHaveAttribute(
      "data-stage-progress",
      "0",
    );
    await expect(page.getByText(/illustrative/i).first()).toBeVisible();
    await expect(page.getByTestId("scene-area")).toBeVisible();
    await expect(page.getByTestId("wall-panel")).toBeHidden();
    await expect(page.getByTestId("feed-panel")).toBeHidden();
    await expect(page.getByTestId("controls-panel")).toBeHidden();
  });

  test("/?stage=workspace opens at progress 1", async ({ page }) => {
    await page.goto("/?stage=workspace");
    await expect(page.locator("[data-stage-progress]")).toHaveAttribute(
      "data-stage-progress",
      "1",
    );
  });

  test("src/state/stage.ts holds progress clamped from 0 to 1", async () => {
    readRequired("src/state/stage.ts");
    const stage = await import("../../src/state/stage");
    expect(stage.getStageProgress()).toBe(0);
    stage.setStageProgress(0.5);
    expect(stage.getStageProgress()).toBe(0.5);
    stage.setStageProgress(2);
    expect(stage.getStageProgress()).toBe(1);
    stage.setStageProgress(-1);
    expect(stage.getStageProgress()).toBe(0);
  });
});

test.describe("workspace", () => {
  for (const viewport of VIEWPORTS) {
    test(`full-screen 3D area with floating panels at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto("/?stage=workspace");

      const scene = page.getByTestId("scene-area");
      const canvas = scene.locator("canvas").first();
      await expect(canvas).toBeVisible({ timeout: 15_000 });
      await expect
        .poll(async () => {
          const box = await canvas.boundingBox();
          return box && [box.x, box.y, box.width, box.height].map(Math.round);
        })
        .toEqual([0, 0, viewport.width, viewport.height]);
      expect(
        await isTopmostAt(
          canvas,
          Math.round(viewport.width * 0.35),
          Math.round(viewport.height * 0.5),
        ),
      ).toBe(true);

      const panels = {
        wall: page.getByTestId("wall-panel"),
        feed: page.getByTestId("feed-panel"),
        controls: page.getByTestId("controls-panel"),
      };
      const boxes = {
        wall: await panels.wall.boundingBox(),
        feed: await panels.feed.boundingBox(),
        controls: await panels.controls.boundingBox(),
      };
      for (const [name, locator] of Object.entries(panels)) {
        const box = boxes[name as keyof typeof boxes];
        if (!box) throw new Error(`${name} panel has no box`);
        expect(box.x, `${name} left edge`).toBeGreaterThanOrEqual(0);
        expect(box.y, `${name} top edge`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, `${name} right edge`).toBeLessThanOrEqual(
          viewport.width,
        );
        expect(box.y + box.height, `${name} bottom edge`).toBeLessThanOrEqual(
          viewport.height,
        );
        expect(
          await isTopmostAt(
            locator,
            Math.round(box.x + box.width / 2),
            Math.round(box.y + box.height / 2),
          ),
          `${name} floats above the scene`,
        ).toBe(true);

        const style = await computedStyle(locator);
        expect(style.backgroundColor, `${name} background`).toBe(
          "rgb(255, 255, 255)",
        );
        expect(style.borderTopWidth, `${name} border`).toBe("1px");
        expect(style.boxShadow, `${name} shadow`).not.toBe("none");
      }

      const { wall, feed, controls } = boxes;
      if (!wall || !feed || !controls) throw new Error("missing panel box");
      expect(wall.x).toBeGreaterThan(viewport.width / 2);
      expect(feed.x).toBeGreaterThan(viewport.width / 2);
      expect(wall.y + wall.height).toBeLessThanOrEqual(feed.y);
      expect(controls.x + controls.width).toBeLessThan(viewport.width / 2);
      expect(controls.y).toBeGreaterThan(viewport.height / 2);
    });
  }

  test("wall shows 400 sample dots with matching totals", async ({ page }) => {
    test.skip(replacedBy(4), "REQ-4 owns the wall from here");
    const { results } = readJson<{ results: { status: string }[] }>(
      "fixtures/sample-hearts.json",
    );
    const count = (status: string) =>
      results.filter((result) => result.status === status).length;

    await page.goto("/?stage=workspace");
    const wall = page.getByTestId("wall-panel");
    const dots = wall.getByTestId("wall-dot");
    await expect(dots).toHaveCount(400);
    for (const status of ["fit", "risk", "no-fit"]) {
      await expect(wall.locator(`[data-status="${status}"]`)).toHaveCount(
        count(status),
      );
      await expect(wall.getByTestId(`wall-total-${status}`)).toContainText(
        String(count(status)),
      );
    }
    const colours = await dots.evaluateAll(
      (elements) =>
        new Set(elements.map((el) => getComputedStyle(el).backgroundColor))
          .size,
    );
    expect(colours).toBe(3);
  });

  test('wall colours are labelled "Sample data"', async ({ page }) => {
    test.skip(replacedBy(12), "REQ-12 connects real results");
    await page.goto("/?stage=workspace");
    await expect(
      page.getByTestId("wall-panel").getByText("Sample data"),
    ).toBeVisible();
  });

  test('feed shows static events labelled "Sample data"', async ({ page }) => {
    test.skip(replacedBy(8), "REQ-8 owns the feed from here");
    const { events } = readJson<{ events: { text: string }[] }>(
      "fixtures/sample-feed.json",
    );
    await page.goto("/?stage=workspace");
    const feed = page.getByTestId("feed-panel");
    await expect(feed.getByText("Sample data")).toBeVisible();
    await expect(feed.getByTestId("feed-event")).toHaveCount(events.length);
    await expect(feed.getByTestId("feed-event").first()).toContainText(
      events[0].text,
    );
  });

  test('"Break it" and "Fix it" are visible, and disabled', async ({
    page,
  }) => {
    await page.goto("/?stage=workspace");
    const controls = page.getByTestId("controls-panel");
    const breakIt = controls.getByRole("button", { name: "Break it" });
    const fixIt = controls.getByRole("button", { name: "Fix it" });
    await expect(breakIt).toBeVisible();
    await expect(fixIt).toBeVisible();
    await expect(fixIt).toBeDisabled();
    if (!replacedBy(8)) await expect(breakIt).toBeDisabled();
  });

  test("uses the brief's tokens and Geist", async ({ page }) => {
    const tokens = readRequired("src/styles/tokens.css")
      .toString("utf8")
      .toLowerCase();
    for (const value of ["#f7f8f8", "#1e2a32", "#0f766e"]) {
      expect(tokens).toContain(value);
    }
    await page.goto("/?stage=workspace");
    const body = await computedStyle(page.locator("body"));
    expect(body.backgroundColor).toBe("rgb(247, 248, 248)");
    expect(body.color).toBe("rgb(30, 42, 50)");
    expect(body.fontFamily).toMatch(/geist/i);
  });
});

test.describe("shared contracts and fixtures", () => {
  test("every contract has a schema that enforces the labels", async () => {
    readRequired("src/contracts/index.ts");
    const contracts = await import("../../src/contracts/index");
    for (const schema of [
      contracts.HeartSchema,
      contracts.DesignSchema,
      contracts.FitResultSchema,
      contracts.SummarySchema,
      contracts.EvidenceSchema,
      contracts.FindingSchema,
      contracts.ProposalSchema,
      contracts.LimitSchema,
      contracts.RunEventSchema,
      contracts.BaselineSchema,
      contracts.DecisionSchema,
      contracts.RunSchema,
    ]) {
      expect(typeof schema.safeParse).toBe("function");
    }

    const design = {
      id: "d1",
      label: "Starting valve",
      hypothetical: true,
      sizes: [{ nominalMm: 23, minAnnulusMm: 21, maxAnnulusMm: 23 }],
    };
    expect(contracts.DesignSchema.safeParse(design).success).toBe(true);
    expect(
      contracts.DesignSchema.safeParse({ ...design, hypothetical: false })
        .success,
    ).toBe(false);
  });

  test("400 labelled sample hearts with sample statuses", async () => {
    const fixture = readJson<{
      label: string;
      hearts: { id: string; provenance: string }[];
      results: {
        heartId: string;
        status: string;
        reasons: unknown[];
      }[];
    }>("fixtures/sample-hearts.json");
    readRequired("src/contracts/index.ts");
    const { HeartSchema, FitResultSchema } = await import(
      "../../src/contracts/index"
    );

    expect(fixture.label).toBe("Sample data");
    expect(fixture.hearts).toHaveLength(400);
    expect(fixture.results).toHaveLength(400);
    for (const heart of fixture.hearts) {
      expect(HeartSchema.safeParse(heart).success, heart.id).toBe(true);
      expect(heart.provenance).toBe("synthetic");
    }
    for (const result of fixture.results) {
      expect(FitResultSchema.safeParse(result).success, result.heartId).toBe(
        true,
      );
      if (result.status !== "fit") {
        expect(result.reasons.length, result.heartId).toBeGreaterThan(0);
      }
    }
    expect(new Set(fixture.hearts.map((heart) => heart.id)).size).toBe(400);
    expect(new Set(fixture.results.map((result) => result.heartId))).toEqual(
      new Set(fixture.hearts.map((heart) => heart.id)),
    );
    expect(new Set(fixture.results.map((result) => result.status))).toEqual(
      new Set(["fit", "risk", "no-fit"]),
    );
  });

  test("labelled sample feed events", async () => {
    const fixture = readJson<{
      label: string;
      events: { seq: number }[];
    }>("fixtures/sample-feed.json");
    readRequired("src/contracts/index.ts");
    const { RunEventSchema } = await import("../../src/contracts/index");

    expect(fixture.label).toBe("Sample data");
    expect(fixture.events.length).toBeGreaterThanOrEqual(3);
    for (const event of fixture.events) {
      expect(RunEventSchema.safeParse(event).success, String(event.seq)).toBe(
        true,
      );
    }
    const seqs = fixture.events.map((event) => event.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });

  test("root-sample.glb is a compressed mesh under the 300 KB target", () => {
    const glb = readRequired("public/fixtures/root-sample.glb");
    expect(glb.length).toBeLessThan(300 * 1024);
    expect(glb.subarray(0, 4).toString("latin1")).toBe("glTF");
    expect(glb.readUInt32LE(4)).toBe(2);

    const gltf = JSON.parse(
      glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8"),
    ) as {
      extensionsUsed?: string[];
      accessors: { count: number }[];
      meshes: {
        primitives: { attributes: { POSITION: number }; indices?: number }[];
      }[];
    };
    expect(gltf.extensionsUsed).toContain("EXT_meshopt_compression");
    const primitive = gltf.meshes[0].primitives[0];
    expect(primitive.indices).toBeDefined();
    expect(
      gltf.accessors[primitive.attributes.POSITION].count,
    ).toBeGreaterThan(1_000);
  });
});

test.describe("project setup", () => {
  type PackageJson = {
    scripts: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  test("all expected dependencies are installed", () => {
    const pkg = readJson<PackageJson>("package.json");
    const installed = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const name of [
      "next",
      "react",
      "react-dom",
      "typescript",
      "three",
      "@react-three/fiber",
      "@react-three/drei",
      "geist",
      "@playwright/test",
      "@gltf-transform/core",
      "@gltf-transform/extensions",
      "@gltf-transform/functions",
      "@google/genai",
      "zod",
    ]) {
      expect(installed, name).toHaveProperty([name]);
    }
    readRequired("components.json");
  });

  test("scripts run the agreed checks", () => {
    const { scripts } = readJson<PackageJson>("package.json");
    for (const name of [
      "typecheck",
      "lint",
      "build",
      "data:check",
      "test:e2e",
      "test:gpu",
      "test:live",
      "verify",
    ]) {
      expect(scripts, name).toHaveProperty([name]);
    }
    expect(scripts.verify).toMatch(
      /typecheck.*&&.*lint.*&&.*data:check.*&&.*build.*&&.*test:e2e/,
    );
    expect(scripts["test:e2e"]).toContain("--grep-invert");
    expect(scripts["test:e2e"]).toContain("@gpu");
    expect(scripts["test:e2e"]).toContain("@live");
    for (const tag of ["gpu", "live"]) {
      expect(scripts[`test:${tag}`]).toMatch(new RegExp(`--grep[ =]"?@${tag}`));
      expect(scripts[`test:${tag}`]).toContain("--pass-with-no-tests");
    }
  });

  test("Playwright runs one worker against PORT", ({ baseURL }) => {
    expect(readRequired("playwright.config.ts").toString("utf8")).toContain(
      "process.env.PORT",
    );
    expect(new URL(baseURL ?? "http://invalid").port).toBe(
      process.env.PORT ?? "3000",
    );
    expect(test.info().config.workers).toBe(1);
  });

  test("/ composes the stubs later requirements replace", () => {
    const page = readRequired("src/app/page.tsx").toString("utf8");
    for (const name of [
      "heart-scene",
      "wall",
      "feed",
      "controls",
      "judge",
      "replay-label",
    ]) {
      expect(page, name).toContain(`components/${name}`);
    }
    for (const name of [
      "heart-scene",
      "root-view",
      "valve-model",
      "wall",
      "heart-panel",
      "feed",
      "controls",
      "judge",
      "replay-label",
    ]) {
      readRequired(`src/components/${name}/index.tsx`);
    }
    expect(existsSync(fromRoot("src/components/data-label"))).toBe(true);
  });

  test("reference screenshot is saved at 1440x900", () => {
    const png = readRequired("docs/reference/workbench.png");
    expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(1440);
    expect(png.readUInt32BE(20)).toBe(900);
    expect(png.length).toBeGreaterThan(30_000);
  });
});

test.describe("repo scan", () => {
  const SKIP_CONTENT_SCAN =
    /\.(glb|png|jpe?g|webp|ico|woff2?|hdr|ktx2|stl|mat|xlsx)$|package-lock\.json$/;
  const SECRET_PATTERNS = [
    /AIza[0-9A-Za-z_-]{35}/,
    /\bsk-[A-Za-z0-9]{32,}/,
    /AKIA[0-9A-Z]{16}/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /GEMINI_API_KEY\s*[=:]\s*['"]?[A-Za-z0-9_-]{20,}/,
  ];

  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });

  const repoFiles = () =>
    git("ls-files", "--cached", "--others", "--exclude-standard", "-z")
      .split("\0")
      .filter((file) => file && existsSync(fromRoot(file)));

  function localSecretValues(): string[] {
    const commonDir = git(
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ).trim();
    return [fromRoot(".env.local"), path.join(path.dirname(commonDir), ".env.local")]
      .filter((file) => existsSync(file))
      .flatMap((file) => readFileSync(file, "utf8").split("\n"))
      .map((line) =>
        line
          .split("=")
          .slice(1)
          .join("=")
          .trim()
          .replace(/^['"]|['"]$/g, ""),
      )
      .filter((value) => value.length >= 16);
  }

  // Failures list file names only, so a leaked key is never printed.
  test("finds no API keys", () => {
    const files = repoFiles();
    expect(files.length).toBeGreaterThan(0);
    const secrets = localSecretValues();
    const leaking = files.filter((file) => {
      if (SKIP_CONTENT_SCAN.test(file)) return false;
      if (statSync(fromRoot(file)).size > 5_000_000) return false;
      const text = readFileSync(fromRoot(file), "utf8");
      return (
        SECRET_PATTERNS.some((pattern) => pattern.test(text)) ||
        secrets.some((secret) => text.includes(secret))
      );
    });
    expect(leaking).toEqual([]);
  });

  test("finds no real_cohort, raw data or env files", () => {
    const forbidden = repoFiles().filter(
      (file) =>
        file.includes("real_cohort") ||
        file.startsWith("data/raw/") ||
        /(^|\/)\.env(\.(?!example$)|$)/.test(file),
    );
    expect(forbidden).toEqual([]);
  });

  test(".gitignore still covers secrets and raw data", () => {
    for (const file of [
      ".env.local",
      "data/raw/verstraeten.zip",
      "any/real_cohort/Case_1.stl",
    ]) {
      expect(() => git("check-ignore", "-q", "--no-index", file), file).not.toThrow();
    }
  });
});
