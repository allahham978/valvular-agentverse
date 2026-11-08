import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";

type Status = "fit" | "risk" | "no-fit";
type Reason = {
  ruleId: string;
  measured: number;
  limit: number;
  margin: number;
};
type Result = {
  heartId: string;
  designId: string;
  status: Status;
  sizeMm?: number;
  reasons: Reason[];
};
type Sample = {
  label: string;
  hearts: { id: string; measures: Record<string, number> }[];
  results: Result[];
};

declare global {
  interface Window {
    __canvasDraws: (canvas: HTMLCanvasElement) => number;
    __canvasContextLost: (canvas: HTMLCanvasElement) => boolean;
    __stampedDots: WeakSet<Element>;
    __wallMutations: () => { dots: string[]; other: string[] };
  }
}

const ROOT = process.cwd();
const replacedBy = (req: number) =>
  existsSync(path.join(ROOT, `tests/e2e/req-${req}.spec.ts`));
const sample = JSON.parse(
  readFileSync(path.join(ROOT, "fixtures/sample-hearts.json"), "utf8"),
) as Sample;

const STATUS_COLOURS: Record<Status, string> = {
  fit: "rgb(47, 158, 110)",
  risk: "rgb(217, 148, 30)",
  "no-fit": "rgb(208, 74, 67)",
};
const STATUSES = Object.keys(STATUS_COLOURS) as Status[];
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];

const resultsWith = (status: Status) =>
  sample.results.filter((result) => result.status === status);
const countOf = (status: Status) => resultsWith(status).length;
const heartOf = (id: string) => {
  const heart = sample.hearts.find((candidate) => candidate.id === id);
  if (!heart) throw new Error(`no fixture heart ${id}`);
  return heart;
};
const firstId = (status: Status) => resultsWith(status)[0].heartId;

const wall = (page: Page) => page.getByTestId("wall-panel");
const popup = (page: Page) => page.getByTestId("heart-popup");
const overlay = (page: Page) => page.getByTestId("wall-overlay");
const popupCanvas = (page: Page) =>
  page.getByTestId("heart-popup-view").locator("canvas");
const mainCanvas = (page: Page) =>
  page.getByTestId("scene-area").locator("canvas").first();
const dot = (page: Page, id: string) =>
  page.locator(`[data-testid="wall-dot"][data-heart-id="${id}"]`);
const thumb = (page: Page, id: string) =>
  page.locator(`[data-testid="wall-thumb"][data-heart-id="${id}"]`);

function countCanvasDraws() {
  const draws = new WeakMap<object, number>();
  const contexts = new WeakMap<object, WebGLRenderingContextBase>();
  for (const context of [WebGLRenderingContext, WebGL2RenderingContext]) {
    const proto = context.prototype as unknown as Record<
      string,
      (...args: unknown[]) => unknown
    >;
    for (const method of [
      "drawArrays",
      "drawElements",
      "drawArraysInstanced",
      "drawElementsInstanced",
    ]) {
      const original = proto[method];
      if (!original) continue;
      proto[method] = function (
        this: WebGLRenderingContext,
        ...args: unknown[]
      ) {
        draws.set(this.canvas, (draws.get(this.canvas) ?? 0) + 1);
        contexts.set(this.canvas, this);
        return original.apply(this, args);
      };
    }
  }
  window.__canvasDraws = (canvas) => draws.get(canvas) ?? 0;
  window.__canvasContextLost = (canvas) =>
    contexts.get(canvas)?.isContextLost() ?? false;
}

const drawCount = (canvas: Locator) =>
  canvas.evaluate((element) =>
    window.__canvasDraws(element as HTMLCanvasElement),
  );

async function settledDrawCount(canvas: Locator) {
  let previous = -1;
  await expect
    .poll(
      async () => {
        const current = await drawCount(canvas);
        const settled = current === previous;
        previous = current;
        return settled;
      },
      { intervals: [700], timeout: 30_000 },
    )
    .toBe(true);
  return previous;
}

async function expectMainRendersOnResize(page: Page) {
  const before = await settledDrawCount(mainCanvas(page));
  const size = page.viewportSize();
  if (!size) throw new Error("no viewport");
  await page.setViewportSize({
    width: size.width === 1440 ? 1460 : 1440,
    height: size.height,
  });
  await expect
    .poll(() => drawCount(mainCanvas(page)), { timeout: 15_000 })
    .toBeGreaterThan(before);
}

function comparePixels(page: Page, first: Buffer, second?: Buffer) {
  return page.evaluate(
    async ([a, b]) => {
      async function pixelsOf(base64: string) {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("no 2d context");
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, image.width, image.height).data;
      }
      const pixels = await pixelsOf(a);
      const total = pixels.length / 4;
      const counts = new Map<number, number>();
      for (let i = 0; i < pixels.length; i += 4) {
        const key = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const dominantShare = Math.max(...counts.values()) / total;
      if (!b) return { dominantShare, changedShare: 0 };

      const others = await pixelsOf(b);
      let changed = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (
          Math.abs(pixels[i] - others[i]) > 4 ||
          Math.abs(pixels[i + 1] - others[i + 1]) > 4 ||
          Math.abs(pixels[i + 2] - others[i + 2]) > 4
        ) {
          changed += 1;
        }
      }
      return { dominantShare, changedShare: changed / total };
    },
    [first.toString("base64"), second?.toString("base64") ?? ""] as const,
  );
}

async function expectPopupViewRendered(page: Page) {
  await expect(popupCanvas(page)).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(
      async () =>
        (await comparePixels(page, await popupCanvas(page).screenshot()))
          .dominantShare,
      { intervals: [500], timeout: 30_000 },
    )
    .toBeLessThan(0.98);
}

async function dragAcross(page: Page, canvas: Locator) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error("canvas has no box");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + box.width / 4, y + box.height / 8, { steps: 8 });
  await page.mouse.up();
}

function pushResults(page: Page, results: Result[]) {
  return page.evaluate((detailResults) => {
    window.dispatchEvent(
      new CustomEvent("valvular:fit-results", {
        detail: { results: detailResults },
      }),
    );
  }, results);
}

async function openWorkspace(page: Page) {
  await page.goto("/?stage=workspace");
  await expect(wall(page)).toHaveAttribute("data-ready", "true", {
    timeout: 15_000,
  });
}

async function openPopup(page: Page, id: string) {
  await dot(page, id).click();
  await expect(popup(page)).toBeVisible();
  await expect(popup(page)).toContainText(id);
}

async function openOverlay(page: Page) {
  await wall(page).getByRole("button", { name: /expand/i }).click();
  await expect(overlay(page)).toBeVisible();
}

const numberPattern = (value: number) =>
  new RegExp(
    `(^|[^\\d.])${value < 0 ? "[-−]" : ""}${Math.abs(value)
      .toString()
      .replace(".", "\\.")}(\\.0+)?(?![\\d.])`,
  );

let consoleErrors: string[];

test.describe.configure({ timeout: 90_000 });

test.beforeEach(async ({ page }) => {
  consoleErrors = [];
  page.on("console", (message) => {
    // Releasing the popup's WebGL context on close is expected.
    if (message.type() === "error" && !message.text().includes("CONTEXT_LOST")) {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await page.addInitScript(countCanvasDraws);
});

test.afterEach(() => {
  expect(consoleErrors).toEqual([]);
});

test.describe("dot grid", () => {
  for (const viewport of VIEWPORTS) {
    test(`400 status-coloured dots with matching totals at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      test.skip(replacedBy(12), "REQ-12 connects real results");
      await page.setViewportSize(viewport);
      await openWorkspace(page);

      await expect(wall(page).getByText("Sample data")).toBeVisible();
      const dots = wall(page).getByTestId("wall-dot");
      await expect(dots).toHaveCount(400);

      const rendered = await dots.evaluateAll((elements) =>
        elements.map((element) => ({
          id: (element as HTMLElement).dataset.heartId,
          status: (element as HTMLElement).dataset.status,
          colour: getComputedStyle(element).backgroundColor,
        })),
      );
      expect(rendered).toEqual(
        sample.results.map(({ heartId, status }) => ({
          id: heartId,
          status,
          colour: STATUS_COLOURS[status],
        })),
      );

      for (const status of STATUSES) {
        await expect(wall(page).getByTestId(`wall-total-${status}`)).toHaveText(
          String(countOf(status)),
        );
      }

      const panel = await wall(page).boundingBox();
      if (!panel) throw new Error("wall panel has no box");
      for (const id of [sample.results[0].heartId, sample.results[399].heartId]) {
        const box = await dot(page, id).boundingBox();
        if (!box) throw new Error(`${id} has no box`);
        expect(box.x).toBeGreaterThanOrEqual(panel.x);
        expect(box.x + box.width).toBeLessThanOrEqual(panel.x + panel.width);
        expect(box.y + box.height).toBeLessThanOrEqual(panel.y + panel.height);
      }
    });
  }

  test("the fixture is read in one swappable module", () => {
    test.skip(replacedBy(12), "REQ-12 connects real results");
    const readers = ["wall", "heart-panel"].flatMap((component) => {
      const directory = path.join("src/components", component);
      return readdirSync(path.join(ROOT, directory), { recursive: true })
        .map(String)
        .map((file) => path.join(directory, file))
        .filter((file) => /\.tsx?$/.test(file))
        .filter((file) =>
          readFileSync(path.join(ROOT, file), "utf8").includes("sample-hearts"),
        );
    });
    expect(readers).toEqual(["src/components/wall/data-source.ts"]);
  });
});

test.describe("hover", () => {
  for (const index of [0, 24, 399]) {
    test(`dot ${index} shows its thumbnail and ID`, async ({ page }) => {
      test.skip(replacedBy(12), "REQ-12 connects real results");
      await openWorkspace(page);
      const id = sample.results[index].heartId;
      await dot(page, id).hover();

      const card = page.getByTestId("wall-hover-card");
      await expect(card).toBeVisible();
      await expect(card).toContainText(id);
      const image = card.locator("img");
      await expect
        .poll(() =>
          image.evaluate((element) => (element as HTMLImageElement).naturalWidth),
        )
        .toBeGreaterThan(0);

      const cardBox = await card.boundingBox();
      const dotBox = await dot(page, id).boundingBox();
      const imageBox = await image.boundingBox();
      if (!cardBox || !dotBox || !imageBox) throw new Error("missing box");
      expect(imageBox.width).toBeGreaterThanOrEqual(96);
      expect(cardBox.x).toBeGreaterThanOrEqual(0);
      expect(cardBox.y).toBeGreaterThanOrEqual(0);
      expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(1440);
      expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(900);
      const coversDot =
        cardBox.x < dotBox.x + dotBox.width &&
        dotBox.x < cardBox.x + cardBox.width &&
        cardBox.y < dotBox.y + dotBox.height &&
        dotBox.y < cardBox.y + cardBox.height;
      expect(coversDot, "the card must not cover the hovered dot").toBe(false);
    });
  }

  test("the card follows the pointer and leaves with it", async ({ page }) => {
    test.skip(replacedBy(12), "REQ-12 connects real results");
    await openWorkspace(page);
    const card = page.getByTestId("wall-hover-card");
    const [first, second] = sample.results;

    await dot(page, first.heartId).hover();
    await expect(card).toContainText(first.heartId);
    await dot(page, second.heartId).hover();
    await expect(card).toContainText(second.heartId);
    await expect(card).not.toContainText(first.heartId);
    await expect(page.getByTestId("wall-hover-card")).toHaveCount(1);

    await page.mouse.move(300, 450);
    await expect(card).toBeHidden();
  });
});

test.describe("expanded wall", () => {
  test("shows all 400 thumbnails with the same colours", async ({ page }) => {
    test.skip(replacedBy(12), "REQ-12 connects real results");
    await openWorkspace(page);
    await openOverlay(page);

    await expect(overlay(page)).toHaveRole("dialog");
    await expect(overlay(page).getByText("Sample data")).toBeVisible();
    const box = await overlay(page).boundingBox();
    if (!box) throw new Error("overlay has no box");
    expect(box.width).toBeGreaterThanOrEqual(1440 * 0.7);
    expect(box.height).toBeGreaterThanOrEqual(900 * 0.7);

    const thumbs = overlay(page).getByTestId("wall-thumb");
    await expect(thumbs).toHaveCount(400);
    const rendered = await thumbs.evaluateAll((elements) =>
      elements.map((element) => {
        const marker = element.querySelector(
          '[data-testid="wall-thumb-status"]',
        );
        const id = (element as HTMLElement).dataset.heartId ?? "";
        return {
          id,
          status: (element as HTMLElement).dataset.status,
          colour: marker && getComputedStyle(marker).backgroundColor,
          altHasId: Boolean(element.querySelector("img")?.alt.includes(id)),
        };
      }),
    );
    expect(rendered).toEqual(
      sample.results.map(({ heartId, status }) => ({
        id: heartId,
        status,
        colour: STATUS_COLOURS[status],
        altHasId: true,
      })),
    );
  });

  test("first and last thumbnails load, and are large enough to read", async ({
    page,
  }) => {
    test.skip(replacedBy(12), "REQ-12 connects real results");
    await openWorkspace(page);
    await openOverlay(page);

    for (const { heartId } of [sample.results[0], sample.results[399]]) {
      const target = thumb(page, heartId);
      await target.scrollIntoViewIfNeeded();
      await expect
        .poll(() =>
          target
            .locator("img")
            .evaluate(
              (element) => (element as HTMLImageElement).naturalWidth,
            ),
        )
        .toBeGreaterThan(0);
      const box = await target.boundingBox();
      if (!box) throw new Error(`${heartId} has no box`);
      expect(box.width).toBeGreaterThanOrEqual(48);
      expect(box.y + box.height).toBeLessThanOrEqual(900);
    }
  });

  test("scrolling over it leaves the stage alone", async ({ page }) => {
    await openWorkspace(page);
    await openOverlay(page);
    const box = await overlay(page).boundingBox();
    if (!box) throw new Error("overlay has no box");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -600);
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(500);
    await expect(page.locator("[data-stage-progress]")).toHaveAttribute(
      "data-stage-progress",
      "1",
    );
    await expect(overlay(page)).toBeVisible();
  });

  test("Esc and the close button close it", async ({ page }) => {
    await openWorkspace(page);
    await openOverlay(page);
    await page.keyboard.press("Escape");
    await expect(overlay(page)).toBeHidden();

    await openOverlay(page);
    await overlay(page).getByRole("button", { name: /close/i }).click();
    await expect(overlay(page)).toBeHidden();
  });

  test("clicking a thumbnail opens the popup above it, and Esc closes one layer at a time", async ({
    page,
  }) => {
    test.skip(replacedBy(12), "REQ-12 connects real results");
    await openWorkspace(page);
    await openOverlay(page);
    const id = firstId("no-fit");

    await thumb(page, id).click();
    await expect(popup(page)).toBeVisible();
    await expect(popup(page)).toContainText(id);

    await page.keyboard.press("Escape");
    await expect(popup(page)).toBeHidden();
    await expect(overlay(page)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(overlay(page)).toBeHidden();
  });
});

test.describe("new results", () => {
  const [toNoFit, alsoToNoFit] = resultsWith("fit").map(
    ({ heartId }) => heartId,
  );
  const toFit = firstId("risk");
  const toRisk = firstId("no-fit");
  const designId = sample.results[0].designId;
  const newReason: Reason = {
    ruleId: "sinus-clearance",
    measured: 0.4,
    limit: 1,
    margin: -0.6,
  };
  const changes: Result[] = [
    { heartId: toNoFit, designId, status: "no-fit", reasons: [newReason] },
    { heartId: alsoToNoFit, designId, status: "no-fit", reasons: [newReason] },
    { heartId: toFit, designId, status: "fit", sizeMm: 25, reasons: [] },
    {
      heartId: toRisk,
      designId,
      status: "risk",
      sizeMm: 25,
      reasons: [newReason],
    },
  ];
  const totalsAfterChanges: Record<Status, number> = {
    fit: countOf("fit") - 1,
    risk: countOf("risk"),
    "no-fit": countOf("no-fit") + 1,
  };

  async function watchWallMutations(page: Page) {
    await wall(page).evaluate((panel) => {
      window.__stampedDots = new WeakSet(
        panel.querySelectorAll('[data-testid="wall-dot"]'),
      );
      const dots = new Set<string>();
      const other = new Set<string>();
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          const element =
            record.target instanceof Element
              ? record.target
              : record.target.parentElement;
          const changedDot = element?.closest<HTMLElement>(
            '[data-testid="wall-dot"]',
          );
          if (changedDot) {
            dots.add(changedDot.dataset.heartId ?? "");
          } else if (!element?.closest('[data-testid^="wall-total-"]')) {
            other.add(element?.outerHTML.slice(0, 120) ?? "");
          }
        }
      });
      observer.observe(panel, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
      window.__wallMutations = () => ({
        dots: [...dots].sort(),
        other: [...other],
      });
    });
  }

  async function expectTotals(page: Page, totals: Record<Status, number>) {
    for (const status of STATUSES) {
      await expect(wall(page).getByTestId(`wall-total-${status}`)).toHaveText(
        String(totals[status]),
      );
    }
  }

  test("only the changed hearts update, and the totals change", async ({
    page,
  }) => {
    test.skip(replacedBy(12), "REQ-12 connects real results");
    await openWorkspace(page);
    await watchWallMutations(page);
    await pushResults(page, changes);

    for (const { heartId, status } of changes) {
      await expect(dot(page, heartId)).toHaveAttribute("data-status", status);
      await expect(dot(page, heartId)).toHaveCSS(
        "background-color",
        STATUS_COLOURS[status],
      );
    }
    await expectTotals(page, totalsAfterChanges);
    await expect(wall(page).getByText("Sample data")).toBeVisible();

    const mutations = await page.evaluate(() => window.__wallMutations());
    expect(mutations.dots).toEqual(
      changes.map(({ heartId }) => heartId).sort(),
    );
    expect(mutations.other).toEqual([]);

    const untouched = await wall(page)
      .getByTestId("wall-dot")
      .evaluateAll((dots) =>
        dots.filter((element) => window.__stampedDots.has(element)).length,
      );
    expect(untouched, "dots must not be remounted").toBe(400);
  });

  test("the same results again change nothing", async ({ page }) => {
    test.skip(replacedBy(12), "REQ-12 connects real results");
    await openWorkspace(page);
    await pushResults(page, changes);
    await expectTotals(page, totalsAfterChanges);

    await watchWallMutations(page);
    await pushResults(page, changes);
    await page.waitForTimeout(500);
    const mutations = await page.evaluate(() => window.__wallMutations());
    expect(mutations).toEqual({ dots: [], other: [] });
    await expectTotals(page, totalsAfterChanges);
  });

  test("a result for a heart not on the wall is ignored", async ({ page }) => {
    test.skip(replacedBy(12), "REQ-12 connects real results");
    await openWorkspace(page);
    await pushResults(page, [
      { heartId: "not-on-the-wall", designId, status: "fit", reasons: [] },
      ...changes,
    ]);
    await expectTotals(page, totalsAfterChanges);
    await expect(wall(page).getByTestId("wall-dot")).toHaveCount(400);
  });

  test("the open overlay updates with the same colours", async ({ page }) => {
    test.skip(replacedBy(12), "REQ-12 connects real results");
    await openWorkspace(page);
    await openOverlay(page);
    await pushResults(page, changes);
    for (const { heartId, status } of changes) {
      await expect(thumb(page, heartId)).toHaveAttribute("data-status", status);
      await expect(
        thumb(page, heartId).getByTestId("wall-thumb-status"),
      ).toHaveCSS("background-color", STATUS_COLOURS[status]);
    }
  });

  test("the open popup shows the new result", async ({ page }) => {
    test.skip(replacedBy(12), "REQ-12 connects real results");
    await openWorkspace(page);
    await openPopup(page, toRisk);
    await expect(popup(page).getByTestId("heart-popup-status")).toHaveText(
      /no.?fit/i,
    );

    await pushResults(page, [
      { heartId: toRisk, designId, status: "fit", sizeMm: 25, reasons: [] },
    ]);
    await expect(popup(page).getByTestId("heart-popup-status")).toHaveText(
      /^\s*fit\s*$/i,
    );
    await expect(popup(page).getByTestId("heart-popup-reason")).toHaveCount(0);
  });
});

test.describe("popup", () => {
  async function expectReasonShown(page: Page, reason: Reason) {
    const row = popup(page).locator(
      `[data-testid="heart-popup-reason"][data-rule-id="${reason.ruleId}"]`,
    );
    await expect(row).toBeVisible();
    await expect(row).toContainText(numberPattern(reason.limit));
    await expect(row).toContainText(numberPattern(reason.margin));
    await expect(row).toContainText(/demo.assumption/i);
  }

  test("a red heart shows its 3D view, measurements and failed rule", async ({
    page,
  }) => {
    test.skip(replacedBy(12), "REQ-12 connects real results");
    await openWorkspace(page);
    const result = resultsWith("no-fit")[0];
    const heart = heartOf(result.heartId);
    await openPopup(page, heart.id);

    await expect(popup(page)).toHaveRole("dialog");
    await expect(popup(page).getByText("Sample data")).toBeVisible();
    await expect(popup(page).getByTestId("heart-popup-status")).toHaveText(
      /no.?fit/i,
    );
    for (const [key, value] of Object.entries(heart.measures)) {
      await expect(
        popup(page).getByTestId(`heart-popup-measure-${key}`),
      ).toContainText(value.toFixed(1));
    }
    for (const label of [
      /annulus/i,
      /sinus/i,
      /junction/i,
      /failed rule/i,
      /limit/i,
      /margin/i,
      /rule type/i,
    ]) {
      await expect(popup(page)).toContainText(label);
    }
    await expect(popup(page).getByTestId("heart-popup-reason")).toHaveCount(1);
    await expectReasonShown(page, result.reasons[0]);
    await expectPopupViewRendered(page);
  });

  test("the popup is centred and fits the screen", async ({ page }) => {
    test.skip(replacedBy(12), "REQ-12 connects real results");
    await openWorkspace(page);
    await openPopup(page, firstId("no-fit"));
    const box = await popup(page).boundingBox();
    if (!box) throw new Error("popup has no box");
    expect(Math.abs(box.x + box.width / 2 - 720)).toBeLessThanOrEqual(2);
    expect(Math.abs(box.y + box.height / 2 - 450)).toBeLessThanOrEqual(2);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(900);

    const view = await page.getByTestId("heart-popup-view").boundingBox();
    if (!view) throw new Error("3D view has no box");
    expect(view.width).toBeGreaterThanOrEqual(200);
    expect(view.height).toBeGreaterThanOrEqual(200);
    expect(view.width).toBeLessThan(box.width);
  });

  test("every sample rule shows its rule type", async ({ page }) => {
    test.skip(replacedBy(12), "REQ-12 connects real results");
    await openWorkspace(page);
    const ruleIds = [
      ...new Set(
        sample.results.flatMap(({ reasons }) =>
          reasons.map(({ ruleId }) => ruleId),
        ),
      ),
    ];
    expect(ruleIds.length).toBeGreaterThan(0);
    for (const ruleId of ruleIds) {
      const result = sample.results.find(({ reasons }) =>
        reasons.some((reason) => reason.ruleId === ruleId),
      );
      if (!result) throw new Error(`no heart for ${ruleId}`);
      await openPopup(page, result.heartId);
      await expectReasonShown(page, result.reasons[0]);
      await page.keyboard.press("Escape");
      await expect(popup(page)).toBeHidden();
    }
  });

  test("an amber heart shows its status and rule, and a green one has no failed rule", async ({
    page,
  }) => {
    test.skip(replacedBy(12), "REQ-12 connects real results");
    await openWorkspace(page);
    const risk = resultsWith("risk")[0];
    await openPopup(page, risk.heartId);
    await expect(popup(page).getByTestId("heart-popup-status")).toHaveText(
      /risk/i,
    );
    await expectReasonShown(page, risk.reasons[0]);
    await page.keyboard.press("Escape");
    await expect(popup(page)).toBeHidden();

    await openPopup(page, firstId("fit"));
    await expect(popup(page).getByTestId("heart-popup-status")).toHaveText(
      /^\s*fit\s*$/i,
    );
    await expect(popup(page).getByTestId("heart-popup-reason")).toHaveCount(0);
  });

  test("dragging rotates the 3D view, which is still when left alone", async ({
    page,
  }) => {
    test.skip(replacedBy(12), "REQ-12 connects real results");
    await openWorkspace(page);
    await openPopup(page, firstId("no-fit"));
    await expectPopupViewRendered(page);
    const canvas = popupCanvas(page);

    await settledDrawCount(canvas);
    const before = await canvas.screenshot();
    const drawsBefore = await drawCount(canvas);

    await dragAcross(page, canvas);
    await expect
      .poll(() => drawCount(canvas), { timeout: 15_000 })
      .toBeGreaterThan(drawsBefore);
    await settledDrawCount(canvas);

    await expect(popup(page), "dragging must not close it").toBeVisible();
    const { changedShare } = await comparePixels(
      page,
      before,
      await canvas.screenshot(),
    );
    expect(changedShare).toBeGreaterThan(0.005);
  });

  test("the main view pauses while it's open, and resumes after", async ({
    page,
  }) => {
    test.skip(replacedBy(12), "REQ-12 connects real results");
    await openWorkspace(page);
    await expect(mainCanvas(page)).toBeVisible({ timeout: 15_000 });
    await expectMainRendersOnResize(page);

    await openPopup(page, firstId("no-fit"));
    await expectPopupViewRendered(page);
    const pausedAt = await settledDrawCount(mainCanvas(page));
    const popupDraws = await drawCount(popupCanvas(page));

    const size = page.viewportSize();
    if (!size) throw new Error("no viewport");
    await page.setViewportSize({ width: size.width + 20, height: size.height });
    await dragAcross(page, popupCanvas(page));
    await expect
      .poll(() => drawCount(popupCanvas(page)), { timeout: 15_000 })
      .toBeGreaterThan(popupDraws);
    await page.waitForTimeout(1_000);
    expect(await drawCount(mainCanvas(page)), "main view drew while paused").toBe(
      pausedAt,
    );

    await page.keyboard.press("Escape");
    await expect(popup(page)).toBeHidden();
    await expect
      .poll(() => drawCount(mainCanvas(page)), { timeout: 15_000 })
      .toBeGreaterThan(pausedAt);
  });

  test('"Open in main view" closes the popup and sends the heart ID', async ({
    page,
  }) => {
    test.skip(replacedBy(12), "REQ-12 connects real results");
    await openWorkspace(page);
    const id = firstId("no-fit");
    await expect(wall(page)).not.toHaveAttribute("data-main-heart-id", /.+/);

    await openPopup(page, id);
    await popup(page).getByRole("button", { name: "Open in main view" }).click();
    await expect(popup(page)).toBeHidden();
    await expect(wall(page)).toHaveAttribute("data-main-heart-id", id);
    await expectMainRendersOnResize(page);

    const sources = ["wall", "heart-panel"].flatMap((component) => {
      const directory = path.join(ROOT, "src/components", component);
      return existsSync(directory)
        ? readdirSync(directory, { recursive: true })
            .map(String)
            .filter((file) => /\.tsx?$/.test(file))
            .map((file) => readFileSync(path.join(directory, file), "utf8"))
        : [];
    });
    expect(
      sources.some((source) => source.includes("setMainHeartId")),
      "must send the ID through src/state/stage.ts",
    ).toBe(true);
  });

  test('"Open in main view" from the expanded wall closes both', async ({
    page,
  }) => {
    test.skip(replacedBy(12), "REQ-12 connects real results");
    await openWorkspace(page);
    const id = firstId("risk");
    await openOverlay(page);
    await thumb(page, id).click();
    await expect(popup(page)).toBeVisible();

    await popup(page).getByRole("button", { name: "Open in main view" }).click();
    await expect(popup(page)).toBeHidden();
    await expect(overlay(page)).toBeHidden();
    await expect(wall(page)).toHaveAttribute("data-main-heart-id", id);
  });

  test("Esc closes the popup without changing the main view", async ({
    page,
  }) => {
    test.skip(replacedBy(12), "REQ-12 connects real results");
    await openWorkspace(page);
    await openPopup(page, firstId("no-fit"));
    await page.keyboard.press("Escape");
    await expect(popup(page)).toBeHidden();
    await expect(wall(page)).not.toHaveAttribute("data-main-heart-id", /.+/);
    await expectMainRendersOnResize(page);
  });

  test("clicking outside closes the popup, and clicking inside doesn't", async ({
    page,
  }) => {
    test.skip(replacedBy(12), "REQ-12 connects real results");
    await openWorkspace(page);
    await openPopup(page, firstId("no-fit"));
    await popup(page).getByTestId("heart-popup-status").click();
    await expect(popup(page)).toBeVisible();

    await page.mouse.click(8, 8);
    await expect(popup(page)).toBeHidden();
    await expect(wall(page)).not.toHaveAttribute("data-main-heart-id", /.+/);
    await expectMainRendersOnResize(page);
  });

  test("opening many popups in a row keeps the main view alive", async ({
    page,
  }) => {
    test.skip(replacedBy(12), "REQ-12 connects real results");
    test.setTimeout(240_000);
    await openWorkspace(page);
    await expect(mainCanvas(page)).toBeVisible({ timeout: 15_000 });

    // Chrome drops the oldest WebGL context past 16 active ones.
    for (const { heartId } of sample.results.slice(0, 17)) {
      await openPopup(page, heartId);
      await expect
        .poll(() => drawCount(popupCanvas(page)), { timeout: 15_000 })
        .toBeGreaterThan(0);
      await page.keyboard.press("Escape");
      await expect(popup(page)).toBeHidden();
    }

    await expect(page.getByTestId("heart-popup-view")).toHaveCount(0);
    expect(
      await mainCanvas(page).evaluate((element) =>
        window.__canvasContextLost(element as HTMLCanvasElement),
      ),
    ).toBe(false);
    await expectMainRendersOnResize(page);
  });
});
