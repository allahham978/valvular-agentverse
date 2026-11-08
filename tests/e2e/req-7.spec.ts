import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { Material, Matrix4, Mesh, Object3D, Scene, Vector3 } from "three";

// REQ-7: Valve in the root. Scene contract (see docs/plans/req-7.md):
// - one object named "schematic-valve" with userData { sizeMm, designId }, built in the root's mm space
// - "root-wall" meshes carry userData.heartId and a vertex "color" attribute; tinted vertices mark the problem area
// - a "main-view-status" caption with data-selected-id (the ID the wall sent, or none), data-heart-id (the
//   synthetic heart drawn) and data-status (REQ-6 engine result), showing the status and "synthetic heart"

const FULL = { width: 1440, height: 900 };
const SCENE_TIMEOUT = 20_000;
const SWITCH_TIMEOUT = 20_000;
const RUN_TIMEOUT = 90_000;
const ACCENT = "0f766e";
const MASKED_TEST_IDS = ["wall-panel", "feed-panel", "controls-panel", "main-view-status"];

type Status = "fit" | "risk" | "no-fit";
type Design = {
  id: string;
  label: string;
  hypothetical: true;
  parentId?: string;
  sizes: { nominalMm: number; minAnnulusMm: number; maxAnnulusMm: number }[];
};
type FitResult = { heartId: string; status: Status; sizeMm?: number };

const START: Design = {
  id: "start",
  label: "Starting valve",
  hypothetical: true,
  sizes: [
    { nominalMm: 23, minAnnulusMm: 21, maxAnnulusMm: 23 },
    { nominalMm: 25, minAnnulusMm: 23, maxAnnulusMm: 25 },
    { nominalMm: 27, minAnnulusMm: 25, maxAnnulusMm: 27 },
  ],
};
// The proposal the scripted "Fix it" run submits (src/components/controls/demo-script.ts).
const WIDER: Design = {
  id: "demo-wider",
  label: "Added 29 mm size",
  hypothetical: true,
  parentId: "start",
  sizes: [...START.sizes, { nominalMm: 29, minAnnulusMm: 27, maxAnnulusMm: 29 }],
};

type ValveState = {
  sizeMm: number | null;
  designId: string | null;
  visible: boolean;
  meshes: number;
  opaque: boolean;
  colours: string[];
  extentMm: number[];
  centreMm: number[];
};

type SceneState = {
  ready: boolean;
  wallMeshes: number;
  heartIds: string[];
  geometryKey: string;
  wallSizeMm: number[];
  leafletCentreMm: number[] | null;
  valve: ValveState | null;
  valveCount: number;
  tint: { vertices: number; share: number; red: number; amber: number };
};

type Engine = {
  heartIds: string[];
  start: Map<string, FitResult>;
  wider: Map<string, FitResult>;
};

let engine: Engine | undefined;

async function loadEngine(request: APIRequestContext): Promise<Engine> {
  if (engine) return engine;
  const hearts = (await (await request.get("/api/hearts")).json()) as { hearts: { id: string }[] };
  const start = (await (await request.post("/api/fit", { data: { design: START } })).json()) as {
    results: FitResult[];
  };
  const wider = (await (
    await request.post("/api/fit", { data: { design: WIDER, parent: START } })
  ).json()) as { results: FitResult[] };
  engine = {
    heartIds: hearts.hearts.map((heart) => heart.id),
    start: new Map(start.results.map((result) => [result.heartId, result])),
    wider: new Map(wider.results.map((result) => [result.heartId, result])),
  };
  return engine;
}

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

function readScene(): SceneState {
  const hook = (window as unknown as { __valvular?: { scene: Scene } }).__valvular;
  const scene = hook?.scene;
  const empty: SceneState = {
    ready: false,
    wallMeshes: 0,
    heartIds: [],
    geometryKey: "",
    wallSizeMm: [],
    leafletCentreMm: null,
    valve: null,
    valveCount: 0,
    tint: { vertices: 0, share: 0, red: 0, amber: 0 },
  };
  if (!scene) return empty;

  const named = (name: string) => {
    const found: Object3D[] = [];
    scene.traverse((object) => {
      if (object.name === name) found.push(object);
    });
    return found;
  };
  const meshesUnder = (object: Object3D) => {
    const found: Mesh[] = [];
    object.traverse((child) => {
      if ((child as Mesh).isMesh) found.push(child as Mesh);
    });
    return found;
  };
  const shown = (object: Object3D) => {
    for (let node: Object3D | null = object; node; node = node.parent) {
      if (!node.visible) return false;
    }
    return true;
  };

  const walls = named("root-wall").filter((object) => (object as Mesh).isMesh) as Mesh[];
  const leaflets = named("root-leaflets").filter((object) => (object as Mesh).isMesh) as Mesh[];
  const valves = named("schematic-valve");
  if (walls.length === 0) return { ...empty, valveCount: valves.length };

  const wall = walls[0];
  scene.updateMatrixWorld(true);
  const toWall = wall.matrixWorld.clone().invert();
  const VectorType = wall.position.constructor as new (x?: number, y?: number, z?: number) => Vector3;

  const boxIn = (meshes: Mesh[], toLocal: (mesh: Mesh) => Matrix4) => {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const mesh of meshes) {
      const position = mesh.geometry.getAttribute("position");
      const matrix = toLocal(mesh);
      for (let i = 0; i < position.count; i++) {
        const point = new VectorType(position.getX(i), position.getY(i), position.getZ(i)).applyMatrix4(matrix);
        const values = [point.x, point.y, point.z];
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], values[k]);
          max[k] = Math.max(max[k], values[k]);
        }
      }
    }
    if (!Number.isFinite(min[0])) return null;
    return {
      extent: max.map((value, k) => value - min[k]),
      centre: max.map((value, k) => (value + min[k]) / 2),
    };
  };
  const wallLocal = (mesh: Mesh) => toWall.clone().multiply(mesh.matrixWorld);

  const wallBox = boxIn([wall], () => toWall.clone().multiply(wall.matrixWorld));
  const leafletBox = boxIn(leaflets, wallLocal);

  let valve: ValveState | null = null;
  if (valves.length > 0) {
    const object = valves[0];
    const meshes = meshesUnder(object);
    const box = boxIn(meshes, wallLocal);
    const materials = meshes.flatMap((mesh) =>
      (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as (Material & {
        color?: { getHexString(): string };
      })[],
    );
    valve = {
      sizeMm: typeof object.userData.sizeMm === "number" ? object.userData.sizeMm : null,
      designId: typeof object.userData.designId === "string" ? object.userData.designId : null,
      visible: shown(object),
      meshes: meshes.length,
      opaque:
        materials.length > 0 &&
        materials.every((material) => !material.transparent && material.opacity >= 0.999 && material.depthWrite),
      colours: materials.map((material) => material.color?.getHexString() ?? ""),
      extentMm: box?.extent ?? [],
      centreMm: box?.centre ?? [],
    };
  }

  let vertices = 0;
  let tinted = 0;
  let red = 0;
  let amber = 0;
  for (const mesh of walls) {
    const position = mesh.geometry.getAttribute("position");
    vertices += position.count;
    const colour = mesh.geometry.getAttribute("color");
    if (!colour) continue;
    for (let i = 0; i < colour.count; i++) {
      const [r, g, b] = [colour.getX(i), colour.getY(i), colour.getZ(i)];
      if (r - b <= 0.2) continue;
      tinted++;
      if (g - b >= 0.12) amber++;
      else red++;
    }
  }

  const heartIds = [...new Set(walls.map((mesh) => String(mesh.userData.heartId ?? "")))];
  return {
    ready: Boolean(wallBox && leaflets.length > 0),
    wallMeshes: walls.length,
    heartIds,
    geometryKey: walls
      .map((mesh) => `${mesh.geometry.uuid}:${mesh.geometry.getAttribute("position").count}`)
      .join("|"),
    wallSizeMm: wallBox?.extent ?? [],
    leafletCentreMm: leafletBox?.centre ?? null,
    valve,
    valveCount: valves.length,
    tint: { vertices, share: vertices ? tinted / vertices : 0, red, amber },
  };
}

const sceneState = (page: Page) => page.evaluate(readScene);

const wall = (page: Page) => page.getByTestId("wall-panel");
const popup = (page: Page) => page.getByTestId("heart-popup");
const caption = (page: Page) => page.getByTestId("main-view-status");
const controlButton = (page: Page, name: string) =>
  page.getByTestId("controls-panel").getByRole("button", { name });

async function stageProgress(page: Page) {
  return Number(await page.locator("[data-stage-progress]").getAttribute("data-stage-progress"));
}

async function waitForRoot(page: Page) {
  await expect
    .poll(async () => (await sceneState(page)).ready, {
      message: "window.__valvular should expose root-wall and root-leaflets",
      timeout: SCENE_TIMEOUT,
    })
    .toBe(true);
}

async function openWorkspace(page: Page) {
  await page.setViewportSize(FULL);
  await page.goto("/?stage=workspace");
  await expect(wall(page)).toHaveAttribute("data-ready", "true", { timeout: SCENE_TIMEOUT });
  await waitForRoot(page);
  await expect(caption(page)).toHaveAttribute("data-heart-id", /^heart-\d+$/, { timeout: SWITCH_TIMEOUT });
}

async function shownHeartId(page: Page) {
  return (await caption(page).getAttribute("data-heart-id")) ?? "";
}

async function wallDots(page: Page) {
  return wall(page)
    .getByTestId("wall-dot")
    .evaluateAll((elements) =>
      elements.map((element) => ({
        id: (element as HTMLElement).dataset.heartId ?? "",
        status: (element as HTMLElement).dataset.status ?? "",
      })),
    );
}

async function openInMain(page: Page, dotId: string) {
  await wall(page).locator(`[data-testid="wall-dot"][data-heart-id="${dotId}"]`).click();
  await expect(popup(page)).toBeVisible();
  await popup(page).getByRole("button", { name: "Open in main view" }).click();
  await expect(popup(page)).toBeHidden();
  await expect(wall(page)).toHaveAttribute("data-main-heart-id", dotId);
}

// Opens wall hearts in the main view until the heart the main view shows passes `want`.
// Dots whose likely heart (same ID, or same position while the wall shows sample IDs) passes are
// tried first; the main view's own data-heart-id is what's checked.
async function showInMain(
  page: Page,
  want: (realId: string) => boolean,
  dotFilter: (dot: { id: string; status: string }) => boolean = () => true,
  maxTries = 30,
): Promise<{ dotId: string; heartId: string; dotStatus: string }> {
  const { heartIds } = await loadEngine(page.request);
  const dots = (await wallDots(page)).map((dot, index) => ({
    ...dot,
    likely: dot.id.startsWith("heart-") ? dot.id : heartIds[index],
  }));
  const current = await caption(page).getAttribute("data-selected-id");
  const candidates = dots
    .filter((dot) => dot.id !== current && dotFilter(dot))
    .sort((a, b) => Number(want(b.likely)) - Number(want(a.likely)));
  for (const dot of candidates.slice(0, maxTries)) {
    await openInMain(page, dot.id);
    await expect(caption(page)).toHaveAttribute("data-selected-id", dot.id, { timeout: SWITCH_TIMEOUT });
    await expect(caption(page)).toHaveAttribute("data-heart-id", /^heart-\d+$/, { timeout: SWITCH_TIMEOUT });
    const heartId = await shownHeartId(page);
    if (want(heartId)) return { dotId: dot.id, heartId, dotStatus: dot.status };
  }
  throw new Error("no wall heart opened a main view heart that matches");
}

async function waitForShownHeart(page: Page, heartId: string) {
  await expect
    .poll(async () => (await sceneState(page)).heartIds, { timeout: SWITCH_TIMEOUT })
    .toEqual([heartId]);
}

async function settleFrames(page: Page) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      ),
  );
}

async function maskRects(page: Page) {
  const rects: { x: number; y: number; width: number; height: number }[] = [];
  for (const id of MASKED_TEST_IDS) {
    const locator = page.getByTestId(id);
    if ((await locator.count()) === 0 || !(await locator.first().isVisible())) continue;
    const box = await locator.first().boundingBox();
    if (box) rects.push(box);
  }
  const header = await page.locator("header").first().boundingBox();
  if (header) rects.push(header);
  return rects;
}

// Pixels come from the composited page, because a WebGL buffer reads back empty outside its frame.
async function colourShares(page: Page) {
  const png = (await page.screenshot()).toString("base64");
  const masks = await maskRects(page);
  return page.evaluate(
    async ({ data, masks }) => {
      const blob = await (await fetch(`data:image/png;base64,${data}`)).blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("no 2d context");
      context.drawImage(bitmap, 0, 0);
      const { data: px } = context.getImageData(0, 0, bitmap.width, bitmap.height);
      const scale = bitmap.width / window.innerWidth;
      const masked = (x: number, y: number) =>
        masks.some(
          (rect) =>
            x >= rect.x * scale - 4 &&
            x <= (rect.x + rect.width) * scale + 4 &&
            y >= rect.y * scale - 4 &&
            y <= (rect.y + rect.height) * scale + 4,
        );
      let total = 0;
      let teal = 0;
      let warm = 0;
      for (let y = 0; y < bitmap.height; y++) {
        for (let x = 0; x < bitmap.width; x++) {
          if (masked(x, y)) continue;
          const i = (y * bitmap.width + x) * 4;
          const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
          total++;
          if (r < 110 && g - r > 35 && b - r > 25) teal++;
          if (r > 120 && r - b > 35 && r - g > 15) warm++;
        }
      }
      return { teal: teal / total, warm: warm / total };
    },
    { data: png, masks },
  );
}

async function expectUncovered(page: Page, testId: string) {
  const box = await page.getByTestId(testId).boundingBox();
  if (!box) throw new Error(`${testId} has no box`);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(FULL.width);
  expect(box.y + box.height).toBeLessThanOrEqual(FULL.height);
  const onTop = await page.evaluate(
    ({ id, x, y }) => {
      const element = document.elementFromPoint(x, y);
      return Boolean(element?.closest(`[data-testid="${id}"]`));
    },
    { id: testId, x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  expect(onTop, `${testId} is not covered by panels`).toBe(true);
}

function expectValveFitsRoot(state: SceneState, sizeMm: number) {
  const valve = state.valve;
  expect(valve, "schematic-valve exists").not.toBeNull();
  if (!valve) return;
  expect(valve.sizeMm).toBe(sizeMm);
  expect(valve.meshes).toBeGreaterThan(0);
  const diameter = Math.max(...valve.extentMm);
  expect(diameter / sizeMm, "valve is drawn at its size in the root's millimetres").toBeGreaterThan(0.85);
  expect(diameter / sizeMm).toBeLessThan(1.3);
  if (!state.leafletCentreMm) throw new Error("no leaflets");
  const gap = Math.hypot(...valve.centreMm.map((value, k) => value - state.leafletCentreMm![k]));
  expect(gap, "valve sits at the leaflets").toBeLessThan(0.35 * Math.max(...state.wallSizeMm));
}

test.describe("REQ-7 valve in the root", () => {
  test.setTimeout(240_000);

  test("Done when 1: zooming to the valve shows the root and a schematic valve", async ({ page, request }) => {
    const errors = trackErrors(page);
    const { start } = await loadEngine(request);
    await page.setViewportSize(FULL);
    await page.goto("/");
    await waitForRoot(page);
    expect(await stageProgress(page)).toBe(0);

    await page.getByRole("button", { name: "Zoom to valve" }).click();
    await expect.poll(() => stageProgress(page), { timeout: SCENE_TIMEOUT }).toBe(1);
    await expect(wall(page)).toBeVisible();
    await expect(caption(page)).toHaveAttribute("data-heart-id", /^heart-\d+$/, { timeout: SWITCH_TIMEOUT });

    const heartId = await shownHeartId(page);
    await waitForShownHeart(page, heartId);
    await expect
      .poll(async () => (await sceneState(page)).valve?.opaque ?? false, {
        message: "the valve is solid once the root is in view",
        timeout: SCENE_TIMEOUT,
      })
      .toBe(true);

    const state = await sceneState(page);
    expect(state.valveCount, "one schematic valve").toBe(1);
    expect(state.valve?.visible).toBe(true);
    expect(state.valve?.designId).toBe("start");
    expect(state.valve?.colours, "valve uses the accent colour").toContain(ACCENT);
    const expected = start.get(heartId);
    expect(expected?.sizeMm, `${heartId} gets a size under the starting valve`).toBeDefined();
    expectValveFitsRoot(state, expected!.sizeMm!);

    const label = page.getByText(/schematic valve/i).first();
    await expect(label).toBeVisible();
    await settleFrames(page);
    const shares = await colourShares(page);
    expect(shares.teal, "the accent valve is visible in the picture").toBeGreaterThan(0.0005);
    expect(errors).toEqual([]);
  });

  test("Done when 2: selecting another heart changes the mesh with no page reload", async ({ page }) => {
    const errors = trackErrors(page);
    let navigations = 0;
    await openWorkspace(page);
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) navigations++;
    });
    await page.evaluate(() => {
      (window as unknown as { __req7Marker?: number }).__req7Marker = 7;
    });

    const before = await sceneState(page);
    const firstId = await shownHeartId(page);
    expect(before.heartIds).toEqual([firstId]);

    const { heartId } = await showInMain(page, (id) => id !== firstId);
    expect(heartId).not.toBe(firstId);
    await waitForShownHeart(page, heartId);
    await expect
      .poll(async () => (await sceneState(page)).geometryKey, { timeout: SWITCH_TIMEOUT })
      .not.toBe(before.geometryKey);

    const after = await sceneState(page);
    expect(after.wallMeshes, "one main root at a time").toBe(before.wallMeshes);
    expect(after.heartIds).toEqual([heartId]);
    expect(after.valveCount).toBe(1);
    expect(navigations, "no page navigation").toBe(0);
    expect(
      await page.evaluate(() => (window as unknown as { __req7Marker?: number }).__req7Marker),
      "no page reload",
    ).toBe(7);
    expect(errors).toEqual([]);
  });

  test("Done when 3: changing the design changes the valve size", async ({ page }) => {
    const errors = trackErrors(page);
    await openWorkspace(page);
    const { start, wider } = await loadEngine(page.request);
    const changes = (id: string) => {
      const after = wider.get(id)?.sizeMm;
      return after !== undefined && after !== start.get(id)?.sizeMm;
    };
    const { heartId } = await showInMain(page, changes);
    await waitForShownHeart(page, heartId);

    await expect
      .poll(async () => (await sceneState(page)).valve?.sizeMm ?? null, { timeout: SWITCH_TIMEOUT })
      .not.toBeNull();
    const before = await sceneState(page);
    expect(before.valve?.designId).toBe("start");
    const beforeSize = before.valve!.sizeMm!;
    const beforeDiameter = Math.max(...before.valve!.extentMm);

    await controlButton(page, "Break it").click();
    await expect(controlButton(page, "Fix it")).toBeEnabled({ timeout: RUN_TIMEOUT });
    await controlButton(page, "Fix it").click();

    const afterSize = wider.get(heartId)!.sizeMm!;
    await expect
      .poll(async () => (await sceneState(page)).valve?.designId ?? null, { timeout: RUN_TIMEOUT })
      .toBe(WIDER.id);
    await expect
      .poll(async () => (await sceneState(page)).valve?.sizeMm ?? null, { timeout: SWITCH_TIMEOUT })
      .toBe(afterSize);

    const after = await sceneState(page);
    expect(afterSize).not.toBe(beforeSize);
    expect(after.heartIds, "same heart, new design").toEqual([heartId]);
    expectValveFitsRoot(after, afterSize);
    const ratio = Math.max(...after.valve!.extentMm) / beforeDiameter;
    expect(ratio, "the drawn valve changes size with the design").toBeGreaterThan(
      (afterSize / beforeSize) * 0.9,
    );
    expect(ratio).toBeLessThan((afterSize / beforeSize) * 1.1);
    await expect(caption(page)).toHaveAttribute("data-status", wider.get(heartId)!.status);
    expect(errors).toEqual([]);
  });

  test("Done when 4: a red or amber heart shows its problem area tinted, its status and 'synthetic heart'", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openWorkspace(page);
    const { start } = await loadEngine(page.request);
    const statusOf = (id: string) => start.get(id)?.status;
    const redOrAmber = (dot: { status: string }) => dot.status === "risk" || dot.status === "no-fit";

    const fitHeart = await showInMain(page, (id) => statusOf(id) === "fit");
    await waitForShownHeart(page, fitHeart.heartId);
    await expect(caption(page)).toHaveAttribute("data-status", "fit");
    expect((await sceneState(page)).tint.share, "a fitting heart has no problem tint").toBe(0);
    await settleFrames(page);
    const baseline = await colourShares(page);

    const expectations: { status: Status; label: RegExp; hue: "red" | "amber" }[] = [
      { status: "no-fit", label: /no fit/i, hue: "red" },
      { status: "risk", label: /risk/i, hue: "amber" },
    ];
    for (const { status, label, hue } of expectations) {
      const opened = await showInMain(page, (id) => statusOf(id) === status, redOrAmber);
      expect(["risk", "no-fit"]).toContain(opened.dotStatus);
      await waitForShownHeart(page, opened.heartId);

      await expect(caption(page)).toBeVisible();
      await expect(caption(page)).toHaveAttribute("data-status", status);
      await expect(caption(page)).toContainText(opened.heartId);
      await expect(caption(page)).toContainText(label);
      await expect(caption(page)).toContainText(/synthetic heart/i);
      await expectUncovered(page, "main-view-status");

      await expect
        .poll(async () => (await sceneState(page)).tint.share, {
          message: `${opened.heartId} has a tinted problem area`,
          timeout: SWITCH_TIMEOUT,
        })
        .toBeGreaterThan(0.01);
      const state = await sceneState(page);
      expect(state.tint.share, "the tint marks an area, not the whole wall").toBeLessThan(0.6);
      if (hue === "red") expect(state.tint.red).toBeGreaterThan(state.tint.amber);
      else expect(state.tint.amber).toBeGreaterThan(state.tint.red);

      await settleFrames(page);
      const shares = await colourShares(page);
      expect(shares.warm, `the ${hue} tint is visible on ${opened.heartId}`).toBeGreaterThan(
        Math.max(0.002, baseline.warm * 3),
      );
    }
    expect(errors).toEqual([]);
  });
});

function percentile(values: number[], share: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))];
}

async function frameTimes(page: Page, ms: number, stopAtProgress?: number) {
  return page.evaluate(
    async ({ ms, stopAtProgress }) => {
      const next = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
      const progress = () =>
        Number(document.querySelector("[data-stage-progress]")?.getAttribute("data-stage-progress"));
      const times: number[] = [];
      const start = performance.now();
      let last = await next();
      while (last - start < ms && (stopAtProgress === undefined || progress() !== stopAtProgress)) {
        const now = await next();
        times.push(now - last);
        last = now;
      }
      return times;
    },
    { ms, stopAtProgress },
  );
}

// Run by a human on the demo laptop with nothing else running: npm run test:gpu.
test("@gpu rotating the root with the valve meets the brief's performance targets", async ({ page }) => {
  test.setTimeout(240_000);
  await openWorkspace(page);
  const { start } = await loadEngine(page.request);
  const opened = await showInMain(
    page,
    (id) => start.get(id)?.status === "risk" || start.get(id)?.status === "no-fit",
  );
  await waitForShownHeart(page, opened.heartId);
  expect((await sceneState(page)).valve?.visible).toBe(true);

  const check = (name: string, times: number[]) => {
    expect(times.length, `${name} frames measured`).toBeGreaterThan(30);
    const average = times.reduce((sum, time) => sum + time, 0) / times.length;
    expect(1000 / average, `${name} average fps`).toBeGreaterThanOrEqual(55);
    expect(percentile(times, 0.95), `${name} p95 ms`).toBeLessThan(25);
  };

  const rotation = frameTimes(page, 5_000);
  await page.mouse.move(500, 450);
  await page.mouse.down();
  for (let i = 0; i < 180; i++) {
    await page.mouse.move(500 + 150 * Math.sin(i / 20), 450);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  check("rotation with the valve", await rotation);

  // The zoom back into the root with the valve loaded.
  for (let i = 0; i < 400 && (await stageProgress(page)) !== 0; i++) {
    await page.mouse.wheel(0, -60);
    await page.waitForTimeout(16);
  }
  const zoomTimes = frameTimes(page, 30_000, 1);
  for (let i = 0; i < 400; i++) {
    await page.mouse.wheel(0, 30);
    await page.waitForTimeout(16);
    if ((await stageProgress(page)) === 1) break;
  }
  const zoom = await zoomTimes;
  check("scroll zoom into the root with the valve", zoom);
  expect(zoom.filter((time) => time > 50).length, "frames over 50 ms during the zoom").toBeLessThanOrEqual(2);
});
