import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { Camera, Material, Mesh, Object3D, Scene, Vector3 } from "three";

const ROOT = process.cwd();
const HEART_GLB = path.join(ROOT, "public/models/heart.glb");
const CREDIT = path.join(ROOT, "public/models/heart.credit.txt");
const TICK = 120;
const SCENE_TIMEOUT = 15_000;
// Software WebGL uses every CPU core, and its cost scales with pixels. Behaviour
// runs small to keep the Mac responsive; design-sized checks ask for FULL.
const LIGHT = { width: 960, height: 600 };
const FULL = { width: 1440, height: 900 };

type Snapshot = {
  at: number;
  ready: boolean;
  frames: number;
  firstHeartFrameMs: number | null;
  progress: number;
  heartOpacity: number;
  heartScale: number;
  heartTurn: number;
  valveLocal: number[];
  valveGap: number;
  wallOpacity: number;
  wallTriangles: number;
  leafletOpacity: number;
  leafletTriangles: number;
  camera: number[];
  cameraToRoot: number;
};

type Hook = {
  scene: Scene;
  camera: Camera;
  frames: number;
  firstHeartFrameMs: number | null;
};

type ProbeWindow = {
  __valvular?: Hook;
  __probe: () => Snapshot;
  __sample: (ms: number) => Promise<Snapshot[]>;
  __sampleUntil: (progress: number, maxMs: number) => Promise<Snapshot[]>;
  __frameTimes: (stop: () => boolean, maxMs: number) => Promise<number[]>;
  __frameTimesUntil: (progress: number, maxMs: number) => Promise<number[]>;
  __frameTimesFor: (ms: number) => Promise<number[]>;
  __traceStart: () => void;
  __traceRead: () => number[];
};

function installProbe() {
  const w = window as unknown as ProbeWindow;

  const shown = (object: Object3D): boolean => {
    for (let node: Object3D | null = object; node; node = node.parent) {
      if (!node.visible) return false;
    }
    return true;
  };

  const meshesOf = (scene: Scene | undefined, name: string): Mesh[] => {
    const meshes: Mesh[] = [];
    scene?.getObjectByName(name)?.traverse((object) => {
      if ((object as Mesh).isMesh) meshes.push(object as Mesh);
    });
    return meshes;
  };

  const opacityOf = (meshes: Mesh[]): number => {
    let opacity = 0;
    for (const mesh of meshes) {
      if (!shown(mesh)) continue;
      const materials: Material[] = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      for (const material of materials) {
        if (material.colorWrite) opacity = Math.max(opacity, material.opacity);
      }
    }
    return opacity;
  };

  const trianglesOf = (meshes: Mesh[]): number =>
    Math.max(
      0,
      ...meshes.map((mesh) => {
        const { index, attributes } = mesh.geometry;
        return (index ? index.count : attributes.position.count) / 3;
      }),
    );

  const readProgress = (): number =>
    Number(
      document
        .querySelector("[data-stage-progress]")
        ?.getAttribute("data-stage-progress") ?? NaN,
    );

  const boundsOf = (mesh: Mesh | undefined) => {
    if (!mesh) return null;
    mesh.updateWorldMatrix(true, false);
    mesh.geometry.computeBoundingSphere();
    const sphere = mesh.geometry.boundingSphere;
    if (!sphere) return null;
    return {
      centre: sphere.center.clone().applyMatrix4(mesh.matrixWorld),
      radius: sphere.radius * mesh.matrixWorld.getMaxScaleOnAxis(),
    };
  };

  w.__probe = () => {
    const hook = w.__valvular;
    const scene = hook?.scene;
    const heart = scene?.getObjectByName("heart-model");
    const marker = scene?.getObjectByName("heart-valve");
    const wall = meshesOf(scene, "root-wall");
    const leaflets = meshesOf(scene, "root-leaflets");
    const heartMeshes = meshesOf(scene, "heart-model");
    const leafletBounds = boundsOf(leaflets[0]);
    const wallBounds = boundsOf(wall[0]);

    let valveGap = Number.POSITIVE_INFINITY;
    if (marker && leafletBounds && wallBounds && hook) {
      const world: Vector3 = hook.camera.position.clone();
      marker.getWorldPosition(world);
      valveGap = world.distanceTo(leafletBounds.centre) / wallBounds.radius;
    }

    return {
      at: performance.now(),
      ready: Boolean(heartMeshes.length > 0 && leaflets.length > 0 && hook),
      frames: hook?.frames ?? 0,
      firstHeartFrameMs: hook?.firstHeartFrameMs ?? null,
      progress: readProgress(),
      heartOpacity: opacityOf(heartMeshes),
      heartScale: heart?.scale.x ?? 0,
      heartTurn: heart?.rotation.y ?? 0,
      valveLocal: marker ? marker.position.toArray() : [],
      valveGap,
      wallOpacity: opacityOf(wall),
      wallTriangles: trianglesOf(wall),
      leafletOpacity: opacityOf(leaflets),
      leafletTriangles: trianglesOf(leaflets),
      camera: hook ? hook.camera.position.toArray() : [],
      cameraToRoot:
        hook && leafletBounds
          ? hook.camera.position.distanceTo(leafletBounds.centre)
          : Number.NaN,
    };
  };

  const nextFrame = () =>
    new Promise<number>((resolve) => requestAnimationFrame(resolve));

  w.__sample = async (ms) => {
    const samples: Snapshot[] = [];
    const end = performance.now() + ms;
    while (performance.now() < end) {
      samples.push(w.__probe());
      await nextFrame();
    }
    return samples;
  };

  w.__sampleUntil = async (progress, maxMs) => {
    // Keeps sampling past the goal, because progress may land before the fade ends.
    const samples: Snapshot[] = [];
    let end = performance.now() + maxMs;
    let reached = false;
    while (performance.now() < end) {
      const snapshot = w.__probe();
      samples.push(snapshot);
      if (!reached && snapshot.progress === progress) {
        reached = true;
        end = performance.now() + 1_000;
      }
      await nextFrame();
    }
    return samples;
  };

  w.__frameTimes = async (stop, maxMs) => {
    const times: number[] = [];
    const start = performance.now();
    let last = await nextFrame();
    while (!stop() && last - start < maxMs) {
      const now = await nextFrame();
      times.push(now - last);
      last = now;
    }
    return times;
  };

  w.__frameTimesUntil = (progress, maxMs) =>
    w.__frameTimes(() => readProgress() === progress, maxMs);

  w.__frameTimesFor = (ms) => w.__frameTimes(() => false, ms);

  let trace: number[] = [];
  let observer: MutationObserver | null = null;
  w.__traceStart = () => {
    observer?.disconnect();
    trace = [];
    const target = document.querySelector("[data-stage-progress]");
    if (!target) throw new Error("no stage element");
    observer = new MutationObserver(() => trace.push(readProgress()));
    observer.observe(target, {
      attributes: true,
      attributeFilter: ["data-stage-progress"],
    });
  };
  w.__traceRead = () => trace;
}

const probe = (page: Page) =>
  page.evaluate(() => (window as unknown as ProbeWindow).__probe());

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function openScene(page: Page, url = "/", viewport = LIGHT) {
  await page.setViewportSize(viewport);
  await page.addInitScript(installProbe);
  await page.goto(url);
  await expect
    .poll(async () => (await probe(page)).ready, {
      message:
        "window.__valvular should expose a scene with heart-model and root-leaflets",
      timeout: SCENE_TIMEOUT,
    })
    .toBe(true);
  await page.mouse.move(
    Math.round(viewport.width * 0.35),
    Math.round(viewport.height * 0.5),
  );
}

async function settle(page: Page): Promise<number> {
  let stable = 0;
  let last = await probe(page);
  for (let i = 0; i < 80 && stable < 3; i++) {
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await page.waitForTimeout(120);
    const next = await probe(page);
    stable = Math.abs(next.progress - last.progress) < 0.002 ? stable + 1 : 0;
    last = next;
  }
  return last.progress;
}

async function scrubInto(page: Page, low: number, high: number): Promise<number> {
  for (let i = 0; i < 80; i++) {
    const progress = await settle(page);
    if (progress >= low && progress <= high) return progress;
    await page.mouse.wheel(0, progress < low ? TICK : -TICK / 2);
  }
  throw new Error(`could not scrub progress into ${low}-${high}`);
}

async function wheelToEnd(page: Page, direction: 1 | -1) {
  const goal = direction > 0 ? 1 : 0;
  for (let i = 0; i < 150; i++) {
    await page.mouse.wheel(0, direction * TICK);
    await page.waitForTimeout(40);
    if ((await probe(page)).progress === goal) break;
  }
  await expect.poll(async () => (await probe(page)).progress).toBe(goal);
  await settle(page);
}

async function panelsHidden(page: Page) {
  for (const id of ["wall-panel", "feed-panel", "controls-panel"]) {
    await expect(page.getByTestId(id)).toBeHidden();
  }
}

async function panelsVisible(page: Page) {
  for (const id of ["wall-panel", "feed-panel", "controls-panel"]) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
}

type Clip = { x: number; y: number; width: number; height: number };

async function capture(page: Page, clip?: Clip): Promise<string> {
  return (await page.screenshot({ clip })).toString("base64");
}

// Pixels come from the composited page, because a WebGL buffer reads back empty
// outside its own frame.
async function pixelStats(page: Page, png: string) {
  return page.evaluate(async (data) => {
    const blob = await (await fetch(`data:image/png;base64,${data}`)).blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context");
    context.drawImage(bitmap, 0, 0);
    const { data: px } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const total = px.length / 4;
    let nonBackground = 0;
    let red = 0;
    for (let i = 0; i < px.length; i += 4) {
      const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
      const far = Math.max(Math.abs(r - 247), Math.abs(g - 248), Math.abs(b - 248));
      if (far > 12) nonBackground++;
      if (r - g > 25 && r - b > 15) red++;
    }
    return { nonBackground: nonBackground / total, red: red / total };
  }, png);
}

async function meanDifference(page: Page, a: string, b: string) {
  return page.evaluate(
    async ([first, second]) => {
      const read = async (data: string) => {
        const blob = await (await fetch(`data:image/png;base64,${data}`)).blob();
        const bitmap = await createImageBitmap(blob);
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("no 2d context");
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      };
      const [pa, pb] = [await read(first), await read(second)];
      let sum = 0;
      for (let i = 0; i < pa.length; i++) sum += Math.abs(pa[i] - pb[i]);
      return sum / pa.length;
    },
    [a, b],
  );
}

const freeArea = (page: Page): Clip => {
  const { width, height } = page.viewportSize() ?? { width: 1440, height: 900 };
  return {
    x: 0,
    y: Math.round(height * 0.08),
    width: Math.min(Math.round(width * 0.68), width - 440),
    height: Math.round(height * 0.72),
  };
};

const distance = (a: number[], b: number[]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
};

test.describe.configure({ timeout: 150_000 });

test.describe("heart model file", () => {
  test("is an optimised GLB, kept to the brief's budget", () => {
    expect(existsSync(HEART_GLB), "public/models/heart.glb").toBe(true);
    expect(statSync(HEART_GLB).size).toBeLessThan(5 * 1024 * 1024);

    const glb = readFileSync(HEART_GLB);
    expect(glb.subarray(0, 4).toString("latin1")).toBe("glTF");
    const gltf = JSON.parse(
      glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8"),
    ) as {
      extensionsUsed?: string[];
      images?: unknown[];
      animations?: unknown[];
      accessors: { count: number }[];
      meshes: {
        primitives: { attributes: Record<string, number>; indices?: number }[];
      }[];
    };

    expect(gltf.extensionsUsed).toContain("EXT_meshopt_compression");
    expect(gltf.images ?? []).toEqual([]);
    expect(gltf.animations ?? []).toEqual([]);

    const primitive = gltf.meshes[0].primitives[0];
    expect(primitive.indices).toBeDefined();
    expect(Object.keys(primitive.attributes)).toEqual(
      expect.arrayContaining(["POSITION", "NORMAL", "COLOR_0"]),
    );
    expect(
      Object.keys(primitive.attributes).filter((name) =>
        name.startsWith("TEXCOORD"),
      ),
    ).toEqual([]);

    const triangles = gltf.accessors[primitive.indices as number].count / 3;
    const vertices = gltf.accessors[primitive.attributes.POSITION].count;
    expect(triangles).toBeGreaterThanOrEqual(50_000);
    expect(
      vertices,
      "welded, smooth-shaded mesh: flat facets would need about 3 vertices per triangle",
    ).toBeLessThan(triangles);
  });

  test("carries its credit line", () => {
    expect(existsSync(CREDIT), "public/models/heart.credit.txt").toBe(true);
    const credit = readFileSync(CREDIT, "utf8");
    expect(credit).toContain("3DPX-022787");
    expect(credit).toMatch(/illustrative/i);
  });
});

test.describe("opening", () => {
  test("/ shows a beating, slowly turning heart, labelled illustrative, with no panels", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openScene(page);

    await expect
      .poll(async () => (await probe(page)).firstHeartFrameMs, {
        message: "heart drawn",
        timeout: SCENE_TIMEOUT,
      })
      .not.toBeNull();
    const opening = await probe(page);
    expect(opening.progress).toBe(0);
    // The brief's 3 s target is enforced on the real GPU in the @gpu test.
    // This run uses software rendering on a shared machine.
    expect(opening.firstHeartFrameMs ?? Infinity).toBeLessThan(5_000);
    expect(opening.heartOpacity).toBe(1);

    await expect(page.getByText("Valvular").first()).toBeVisible();
    await expect(page.getByText(/illustrative/i).first()).toBeVisible();
    await expect(page.getByTestId("scroll-cue")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Zoom to valve" }),
    ).toBeVisible();
    await panelsHidden(page);

    const samples = await page.evaluate(() =>
      (window as unknown as ProbeWindow).__sample(3_200),
    );
    const scales = samples.map((sample) => sample.heartScale);
    const low = Math.min(...scales);
    const high = Math.max(...scales);
    expect(high - low, "the heart beats").toBeGreaterThan(0.002);
    expect((high - low) / low, "the beat is gentle").toBeLessThan(0.08);

    const middle = (low + high) / 2;
    let beats = 0;
    for (let i = 1; i < scales.length; i++) {
      if (scales[i - 1] < middle && scales[i] >= middle) beats++;
    }
    // Below about 6 fps a 1 Hz beat aliases, so a loaded machine can't count it.
    if (samples.length >= 20) {
      expect(beats, "about 60 beats per minute").toBeGreaterThanOrEqual(2);
      expect(beats).toBeLessThanOrEqual(8);
    }

    const turns = samples.map((sample) => sample.heartTurn);
    expect(
      Math.max(...turns) - Math.min(...turns),
      "the heart turns",
    ).toBeGreaterThan(0.002);
    for (const turn of turns) {
      expect(Math.abs(turn), "turn stays within 35 degrees of the front").toBeLessThan(
        0.62,
      );
    }
    expect(
      samples[samples.length - 1].frames - samples[0].frames,
      "renders continuously while beating",
    ).toBeGreaterThan(2);
    expect(errors).toEqual([]);
  });

  test("the heart fills the view in muted red, and moves", async ({ page }) => {
    await openScene(page);
    const first = await capture(page);
    const stats = await pixelStats(page, first);
    expect(stats.nonBackground, "heart fills the screen").toBeGreaterThan(0.12);
    expect(stats.red, "satin red-pink heart").toBeGreaterThan(0.08);

    await page.waitForTimeout(600);
    expect(
      await meanDifference(page, first, await capture(page)),
      "beating and turning changes the picture",
    ).toBeGreaterThan(0.02);
  });

  test("the valve marker sits at the location from RES-3", async ({ page }) => {
    await openScene(page);
    const { valveLocal } = await probe(page);
    expect(valveLocal).toHaveLength(3);
    const expected = [0.08, 0, 0.03];
    valveLocal.forEach((value, axis) => {
      expect(Math.abs(value - expected[axis])).toBeLessThan(0.002);
    });
  });
});

test.describe("scroll zoom", () => {
  test("scroll down halfway holds, with the heart fading into the root", async ({
    page,
  }) => {
    await openScene(page);
    const opening = await page.evaluate(() =>
      (window as unknown as ProbeWindow).__sample(1_500),
    );
    const openingScales = opening.map((sample) => sample.heartScale);

    const progress = await scrubInto(page, 0.4, 0.6);
    expect(progress).toBeGreaterThan(0);

    const held = await probe(page);
    await page.waitForTimeout(1_000);
    const later = await probe(page);
    expect(Math.abs(later.progress - held.progress), "zoom holds").toBeLessThan(
      0.002,
    );
    expect(distance(later.camera, held.camera), "camera holds").toBeLessThan(
      0.01,
    );

    expect(later.heartOpacity, "heart is fading").toBeGreaterThan(0.02);
    expect(later.heartOpacity).toBeLessThan(0.98);
    expect(later.leafletOpacity, "root is appearing").toBeGreaterThan(0.02);
    expect(later.leafletOpacity).toBeLessThan(0.98);
    await panelsHidden(page);

    const midway = await page.evaluate(() =>
      (window as unknown as ProbeWindow).__sample(1_500),
    );
    const midwayScales = midway.map((sample) => sample.heartScale);
    const swing = (values: number[]) =>
      Math.max(...values) - Math.min(...values);
    expect(
      swing(midwayScales),
      "the beat is easing to a stop",
    ).toBeLessThan(swing(openingScales) * 0.8);
  });

  test("the zoom is scrubbed, smoothed and takes real distance", async ({
    page,
  }) => {
    await openScene(page);
    await page.evaluate(() =>
      (window as unknown as ProbeWindow).__traceStart(),
    );

    await page.mouse.wheel(0, TICK * 2);
    const first = await settle(page);
    expect(first, "scroll moves the zoom").toBeGreaterThan(0);
    expect(first, "the full range takes more than two ticks").toBeLessThan(0.5);

    const trace = await page.evaluate(() =>
      (window as unknown as ProbeWindow).__traceRead(),
    );
    expect(
      new Set(trace).size,
      "a wheel burst is smoothed over several frames",
    ).toBeGreaterThanOrEqual(2);

    await page.mouse.wheel(0, TICK * 2);
    const second = await settle(page);
    const firstStep = first;
    const secondStep = second - first;
    expect(secondStep, "same scroll, similar move").toBeGreaterThan(
      firstStep * 0.5,
    );
    expect(secondStep).toBeLessThan(firstStep * 1.5);

    const before = await probe(page);
    await page.mouse.wheel(0, -TICK * 2);
    const back = await settle(page);
    expect(back, "scroll up moves back").toBeLessThan(before.progress);
  });

  test("scroll down fully lands on the translucent root with solid leaflets and panels", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openScene(page);
    const heartView = await probe(page);

    await wheelToEnd(page, 1);
    await panelsVisible(page);
    await expect(page.getByText("Synthetic test hearts").first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Zoom to valve" }),
    ).toBeHidden();
    await expect(page.getByTestId("scroll-cue")).toBeHidden();

    const root = await probe(page);
    expect(root.heartOpacity, "heart has gone").toBe(0);
    expect(root.wallOpacity, "wall is translucent").toBeGreaterThan(0.05);
    expect(root.wallOpacity).toBeLessThan(0.6);
    expect(root.leafletOpacity, "leaflets are solid").toBeGreaterThan(0.999);
    expect(root.leafletTriangles).toBeGreaterThan(root.wallTriangles * 0.05);
    expect(root.leafletTriangles).toBeLessThan(root.wallTriangles);

    expect(root.heartTurn, "turn has eased to a stop").toBeCloseTo(0, 3);
    expect(root.heartScale, "beat has eased to a stop").toBeCloseTo(1, 3);
    expect(
      root.valveGap,
      "the heart's valve lines up with the root's leaflets",
    ).toBeLessThan(0.5);
    expect(root.cameraToRoot).toBeLessThan(heartView.cameraToRoot * 0.67);

    await page.waitForTimeout(600);
    const before = await probe(page);
    await page.waitForTimeout(1_200);
    const after = await probe(page);
    expect(after.heartScale).toBe(before.heartScale);
    expect(after.frames - before.frames, "renders on demand once settled").toBe(
      0,
    );

    const stats = await pixelStats(page, await capture(page, freeArea(page)));
    expect(stats.nonBackground, "the root is drawn").toBeGreaterThan(0.02);
    expect(stats.red, "no red heart remains").toBeLessThan(0.01);
    expect(errors).toEqual([]);
  });

  test("the camera moves in steadily with the zoom, as one move", async ({
    page,
  }) => {
    await openScene(page);
    const distances = [(await probe(page)).cameraToRoot];
    for (const [low, high] of [
      [0.2, 0.35],
      [0.45, 0.6],
      [0.7, 0.85],
    ]) {
      await scrubInto(page, low, high);
      distances.push((await probe(page)).cameraToRoot);
    }
    await wheelToEnd(page, 1);
    distances.push((await probe(page)).cameraToRoot);
    for (let i = 1; i < distances.length; i++) {
      expect(distances[i], `distance ${i}`).toBeLessThan(distances[i - 1]);
    }
  });

  test("scroll up reverses the zoom to the heart and fades panels out", async ({
    page,
  }) => {
    await openScene(page);
    await wheelToEnd(page, 1);
    await panelsVisible(page);

    const framesAtRoot = (await probe(page)).frames;
    await page.mouse.wheel(0, -TICK);
    await expect
      .poll(async () => (await probe(page)).progress, {
        message: "the on-demand scene wakes up on scroll",
      })
      .toBeLessThan(1);
    expect((await probe(page)).frames).toBeGreaterThan(framesAtRoot);
    await panelsHidden(page);

    await page.evaluate(() =>
      (window as unknown as ProbeWindow).__traceStart(),
    );
    await wheelToEnd(page, -1);
    const trace = await page.evaluate(() =>
      (window as unknown as ProbeWindow).__traceRead(),
    );
    for (let i = 1; i < trace.length; i++) {
      expect(trace[i], "moves back without jumping forward").toBeLessThanOrEqual(
        trace[i - 1],
      );
    }

    const heart = await probe(page);
    expect(heart.progress).toBe(0);
    expect(heart.heartOpacity).toBe(1);
    expect(heart.leafletOpacity).toBe(0);
    await expect(page.getByText(/illustrative/i).first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Zoom to valve" }),
    ).toBeVisible();

    const samples = await page.evaluate(() =>
      (window as unknown as ProbeWindow).__sample(1_500),
    );
    expect(
      new Set(samples.map((sample) => sample.heartScale)).size,
      "the beat restarts",
    ).toBeGreaterThan(1);
  });

  test("/?stage=workspace opens on the root and can scroll back to the heart", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openScene(page, "/?stage=workspace");
    await expect
      .poll(async () => (await probe(page)).leafletOpacity, {
        timeout: SCENE_TIMEOUT,
      })
      .toBeGreaterThan(0.999);
    const root = await probe(page);
    expect(root.progress).toBe(1);
    expect(root.heartOpacity).toBe(0);
    await panelsVisible(page);

    await wheelToEnd(page, -1);
    expect((await probe(page)).heartOpacity).toBe(1);
    await panelsHidden(page);
    expect(errors).toEqual([]);
  });

  test("scrolling over a panel scrolls that panel, not the zoom", async ({
    page,
  }) => {
    await openScene(page, "/?stage=workspace", FULL);
    await settle(page);
    for (const id of ["feed-panel", "wall-panel", "controls-panel"]) {
      const box = await page.getByTestId(id).boundingBox();
      if (!box) throw new Error(`${id} has no box`);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, -TICK * 3);
      await page.waitForTimeout(250);
      expect((await probe(page)).progress, id).toBe(1);
    }
  });
});

test.describe("stage backup", () => {
  test('"Zoom to valve" and the arrow keys do the same zoom, in and out', async ({
    page,
  }) => {
    await openScene(page);

    await page.evaluate(() =>
      (window as unknown as ProbeWindow).__traceStart(),
    );
    await page.getByRole("button", { name: "Zoom to valve" }).click();
    await expect
      .poll(async () => (await probe(page)).progress, { timeout: 20_000 })
      .toBe(1);
    const zoomIn = await page.evaluate(() =>
      (window as unknown as ProbeWindow).__traceRead(),
    );
    expect(
      zoomIn.some((value) => value > 0.05 && value < 0.95),
      "the button travels the zoom, it doesn't jump",
    ).toBe(true);
    await panelsVisible(page);

    const pressUntil = async (key: string, goal: number) => {
      const seen: number[] = [];
      for (let i = 0; i < 60; i++) {
        await page.keyboard.press(key);
        const progress = await settle(page);
        seen.push(progress);
        if (progress === goal) return seen;
      }
      throw new Error(`${key} did not reach ${goal}`);
    };

    const out = await pressUntil("ArrowUp", 0);
    expect(
      out.some((value) => value > 0 && value < 1),
      "ArrowUp stops partway",
    ).toBe(true);
    await panelsHidden(page);
    expect((await probe(page)).heartOpacity).toBe(1);

    const back = await pressUntil("ArrowDown", 1);
    expect(
      back.some((value) => value > 0 && value < 1),
      "ArrowDown stops partway",
    ).toBe(true);
    await panelsVisible(page);
  });

  test("arrow keys leave text fields alone", async ({ page }) => {
    await openScene(page, "/?stage=workspace");
    await settle(page);
    await page.evaluate(() => {
      const input = document.createElement("input");
      input.id = "req-3-probe-input";
      input.value = "23";
      input.style.cssText = "position:fixed;top:0;left:0;z-index:99";
      document.body.append(input);
      input.focus();
    });
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(400);
    expect((await probe(page)).progress).toBe(1);
  });
});

test.describe("reduced motion", () => {
  test("replaces the zoom with a short crossfade", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openScene(page);
    const heartPose = await probe(page);
    expect(heartPose.progress).toBe(0);

    const transition = async (goal: number, trigger: () => Promise<void>) => {
      const sampling = page.evaluate(
        ([to, max]) =>
          (window as unknown as ProbeWindow).__sampleUntil(to, max),
        [goal, 8_000],
      );
      await trigger();
      const samples = await sampling;
      expect((await probe(page)).progress, "ends on the goal").toBe(goal);
      const final = samples[samples.length - 1];
      const moving = samples.filter(
        (sample) =>
          sample.progress !== final.progress ||
          sample.heartOpacity !== final.heartOpacity ||
          sample.leafletOpacity !== final.leafletOpacity,
      );
      const elapsed = moving.length
        ? moving[moving.length - 1].at - samples[0].at
        : 0;
      return { samples, elapsed };
    };

    const partial = (samples: Snapshot[]) =>
      samples.some(
        (sample) =>
          (sample.heartOpacity > 0.02 && sample.heartOpacity < 0.98) ||
          (sample.leafletOpacity > 0.02 && sample.leafletOpacity < 0.98),
      );

    const toRoot = await transition(1, async () => {
      await page.getByRole("button", { name: "Zoom to valve" }).click();
    });
    await expect(page.getByTestId("wall-panel")).toBeVisible();
    await settle(page);
    const rootPose = await probe(page);
    const travel = distance(heartPose.camera, rootPose.camera);
    expect(travel).toBeGreaterThan(0);

    const toHeart = await transition(0, async () => {
      await page.mouse.move(300, 300);
      await page.mouse.wheel(0, -TICK);
    });
    await settle(page);
    expect((await probe(page)).heartOpacity).toBe(1);

    const toRootByWheel = await transition(1, async () => {
      await page.mouse.wheel(0, TICK);
    });

    const runs = [toRoot, toHeart, toRootByWheel];
    for (const { samples, elapsed } of runs) {
      expect(elapsed, "the crossfade is short").toBeLessThan(2_000);
      for (const sample of samples) {
        const offPath = Math.min(
          distance(sample.camera, heartPose.camera),
          distance(sample.camera, rootPose.camera),
        );
        expect(
          offPath / travel,
          "the camera never travels between the two views",
        ).toBeLessThan(0.01);
      }
    }
    expect(
      runs.some(({ samples }) => partial(samples)),
      "the views crossfade, they don't cut",
    ).toBe(true);
  });
});

test.describe("root", () => {
  test("dragging rotates the root and doesn't leave the workspace", async ({
    page,
  }) => {
    await openScene(page);
    const heartCamera = (await probe(page)).camera;
    await page.getByRole("button", { name: "Zoom to valve" }).click();
    await expect
      .poll(async () => (await probe(page)).progress, { timeout: 20_000 })
      .toBe(1);
    await settle(page);

    const start = await probe(page);
    const travel = distance(heartCamera, start.camera);
    const clip = freeArea(page);
    const before = await capture(page, clip);

    await page.mouse.move(300, 300);
    await page.mouse.down();
    await page.mouse.move(500, 300, { steps: 8 });
    await page.mouse.up();
    await settle(page);

    expect((await probe(page)).progress).toBe(1);
    await panelsVisible(page);
    expect(
      await meanDifference(page, before, await capture(page, clip)),
      "the picture changes when dragged",
    ).toBeGreaterThan(0.1);

    const dragged = await probe(page);
    await page.mouse.wheel(0, TICK);
    await page.waitForTimeout(400);
    const wheeled = await probe(page);
    expect(wheeled.progress, "scrolling further stays on the root").toBe(1);
    expect(
      distance(dragged.camera, wheeled.camera),
      "no wheel zoom on the root",
    ).toBeLessThan(0.001);

    await page.mouse.wheel(0, -TICK);
    await settle(page);
    const leaving = await probe(page);
    expect(leaving.progress).toBeLessThan(1);
    expect(
      distance(dragged.camera, leaving.camera),
      "scrolling back after a rotate doesn't jump",
    ).toBeLessThan(travel * 0.25);
  });
});

test.describe("canvas capture", () => {
  test("the canvas isn't blank in any view, and the views differ", async ({
    page,
  }) => {
    await openScene(page, "/", FULL);
    const clip = freeArea(page);
    const heart = await capture(page, clip);
    await scrubInto(page, 0.4, 0.6);
    const midway = await capture(page, clip);
    await wheelToEnd(page, 1);
    const root = await capture(page, clip);

    for (const [name, png] of [
      ["heart", heart],
      ["mid-zoom", midway],
      ["root", root],
    ]) {
      const stats = await pixelStats(page, png);
      expect(stats.nonBackground, name).toBeGreaterThan(0.02);
    }
    expect(await meanDifference(page, heart, midway)).toBeGreaterThan(0.5);
    expect(await meanDifference(page, midway, root)).toBeGreaterThan(0.5);
    expect(await meanDifference(page, heart, root)).toBeGreaterThan(0.5);
  });
});

test.describe("rendering rules", () => {
  test("loads the heart and one root, and caps the pixel ratio at 2", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 1000, height: 640 },
      deviceScaleFactor: 3,
    });
    const page = await context.newPage();
    const models: string[] = [];
    page.on("request", (request) => {
      const { pathname } = new URL(request.url());
      if (pathname.endsWith(".glb")) models.push(pathname);
    });
    try {
      await openScene(page);
      await page.waitForTimeout(1_000);
      expect(models.filter((url) => url === "/models/heart.glb")).toHaveLength(
        1,
      );
      expect(models.filter((url) => url !== "/models/heart.glb")).toHaveLength(
        1,
      );

      const ratio = await page
        .getByTestId("scene-area")
        .locator("canvas")
        .first()
        .evaluate((canvas: HTMLCanvasElement) => canvas.width / canvas.clientWidth);
      expect(ratio).toBeLessThanOrEqual(2);
    } finally {
      await context.close();
    }
  });
});

// Run by a human with nothing else running: npm run test:gpu. Pending in this batch.
test("@gpu heart, scroll zoom and rotation meet the brief's performance targets", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await openScene(page, "/", FULL);
  const opened = await probe(page);
  expect(opened.firstHeartFrameMs ?? Infinity).toBeLessThan(3_000);
  expect(statSync(HEART_GLB).size).toBeLessThan(5 * 1024 * 1024);

  const check = (name: string, times: number[]) => {
    const average = times.reduce((sum, time) => sum + time, 0) / times.length;
    expect(1000 / average, `${name} average fps`).toBeGreaterThanOrEqual(55);
    expect(percentile(times, 0.95), `${name} p95 ms`).toBeLessThan(25);
  };

  check(
    "beating",
    await page.evaluate(() =>
      (window as unknown as ProbeWindow).__frameTimesFor(6_000),
    ),
  );

  const zoomTimes = page.evaluate(() =>
    (window as unknown as ProbeWindow).__frameTimesUntil(1, 30_000),
  );
  for (let i = 0; i < 400; i++) {
    await page.mouse.wheel(0, 30);
    await page.waitForTimeout(16);
    if ((await probe(page)).progress === 1) break;
  }
  const zoom = await zoomTimes;
  check("scroll zoom", zoom);
  expect(
    zoom.filter((time) => time > 50).length,
    "frames over 50 ms during the zoom",
  ).toBeLessThanOrEqual(2);
  await settle(page);

  const rotateTimes = page.evaluate(() =>
    (window as unknown as ProbeWindow).__frameTimesFor(5_000),
  );
  await page.mouse.move(400, 450);
  await page.mouse.down();
  for (let i = 0; i < 180; i++) {
    await page.mouse.move(400 + 150 * Math.sin(i / 20), 450);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  check("rotation", await rotateTimes);
});
