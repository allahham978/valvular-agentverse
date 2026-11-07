import { spawnSync, execFileSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { HeartSchema, type Heart } from "../../src/contracts/index";

const ROOT = process.cwd();
const ZIP =
  process.env.VALVULAR_DATA_ZIP ??
  "/Users/mohammadallahham/Desktop/code/hackathon-agentverse/data/raw/verstraeten.zip";
const TABLE_ENTRY =
  "data_repository_Verstraeten_et_al_2023/virtual_cohort/shapeFeatures.xlsx";
const PUBLISHED_MD5 = "9f40559c1d58d42321c0d8fb680b68e5";
const DEV_PATH = "data/hearts.dev.json";
const HIDDEN_PATH = "server-data/hearts.hidden.json";
const SOURCES_PATH = "data/sources.json";
const MAX_MESH_BYTES = 300 * 1024;
const MAX_THUMB_BYTES = 15 * 1024;
const MAX_ASSET_BYTES = 30 * 1024 * 1024;
const BAND_EDGES = [21, 23, 25, 27, 29];
const COLUMN_TO_KEY: Record<string, string> = {
  D_an: "annulusMm",
  D_sinus: "sinusMm",
  D_stj: "sinotubularJunctionMm",
  D_lvot: "lvotMm",
  H_sinus: "sinusHeightMm",
  AVA: "aorticValveArea",
  angle: "angleDeg",
  ratio_lvot_over_an_area: "lvotOverAnnulusAreaRatio",
};

type HeartFile = { hearts: Heart[] };
type Control = { mapping: string; r: number; overThreshold: number };
type Report = {
  source: { md5: string; expectedMd5: string; match: boolean };
  split: {
    seed: number;
    identicalOnRerun: boolean;
    dev: number;
    hidden: number;
    overlap: number;
    bands: {
      minMm: number | null;
      maxMm: number | null;
      dev: number;
      hidden: number;
    }[];
  };
  annulus: { excluded21to27: number; excluded21to29: number };
  rowMesh: {
    checked: number;
    failed: number;
    maxResidualMm: number;
    thresholdMm: number;
    r: number;
    minR: number;
    controls: Control[];
  };
};

const fromRoot = (relPath: string) => path.join(ROOT, relPath);

function readJson<T>(relPath: string): T {
  expect(existsSync(fromRoot(relPath)), `${relPath} should exist`).toBe(true);
  return JSON.parse(readFileSync(fromRoot(relPath), "utf8")) as T;
}

const devHearts = () => readJson<HeartFile>(DEV_PATH).hearts;
const hiddenHearts = () => readJson<HeartFile>(HIDDEN_PATH).hearts;
const caseNumber = (id: string) => Number(id.replace("heart-", ""));

function runDataCheck(zip = ZIP) {
  const result = spawnSync("npm", ["run", "--silent", "data:check"], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, VALVULAR_DATA_ZIP: zip },
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
  };
}

let cachedReport: Report | undefined;

function report(): Report {
  if (cachedReport) return cachedReport;
  const { status, output } = runDataCheck();
  expect(status, `data:check should pass:\n${output}`).toBe(0);
  const marker = "data:check report: ";
  const line = output
    .split("\n")
    .filter((text) => text.startsWith(marker))
    .at(-1);
  expect(line, "data:check should print its report").toBeDefined();
  cachedReport = JSON.parse((line ?? "").slice(marker.length)) as Report;
  return cachedReport;
}

async function sourceTable(): Promise<Record<string, number>[]> {
  const bytes = execFileSync("unzip", ["-p", ZIP, TABLE_ENTRY], {
    maxBuffer: 16 * 1024 * 1024,
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  const rows: unknown[][] = [];
  workbook.worksheets[0].eachRow((row) => {
    rows.push((row.values as unknown[]).slice(1));
  });
  const [header, ...body] = rows;
  return body.map((row) =>
    Object.fromEntries(
      header.map((name, column) => [String(name), Number(row[column])]),
    ),
  );
}

function bandIndex(annulusMm: number): number {
  const index = BAND_EDGES.findIndex((edge) => annulusMm < edge);
  return index === -1 ? BAND_EDGES.length : index;
}

function excludedCount(hearts: Heart[], minMm: number, maxMm: number) {
  return hearts.filter(
    ({ measures }) =>
      measures.annulusMm < minMm || measures.annulusMm > maxMm,
  ).length;
}

function parseGlb(glb: Buffer) {
  expect(glb.subarray(0, 4).toString("latin1")).toBe("glTF");
  expect(glb.readUInt32LE(4)).toBe(2);
  return JSON.parse(
    glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8"),
  ) as {
    extensionsUsed?: string[];
    accessors: { count: number }[];
    meshes: {
      primitives: { attributes: { POSITION: number }; indices?: number }[];
    }[];
  };
}

function expectCompressedMesh(glb: Buffer, id: string) {
  expect(glb.length, `${id} mesh size`).toBeLessThan(MAX_MESH_BYTES);
  const gltf = parseGlb(glb);
  expect(gltf.extensionsUsed, id).toContain("EXT_meshopt_compression");
  const primitive = gltf.meshes[0].primitives[0];
  expect(primitive.indices, id).toBeDefined();
  expect(
    gltf.accessors[primitive.attributes.POSITION].count,
    id,
  ).toBeGreaterThan(1_000);
}

function withTamperedFile(relPath: string, tamper: (file: HeartFile) => void) {
  const original = readFileSync(fromRoot(relPath), "utf8");
  const file = JSON.parse(original) as HeartFile;
  tamper(file);
  writeFileSync(fromRoot(relPath), JSON.stringify(file));
  return () => writeFileSync(fromRoot(relPath), original);
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}

test.describe.configure({ timeout: 300_000 });

test.describe("dev hearts API", () => {
  test("GET /api/hearts returns 400 synthetic hearts with measurements and links", async ({
    request,
  }) => {
    const response = await request.get("/api/hearts");
    expect(response.status()).toBe(200);
    const { hearts } = (await response.json()) as HeartFile;

    expect(hearts).toHaveLength(400);
    expect(new Set(hearts.map((heart) => heart.id)).size).toBe(400);
    for (const heart of hearts) {
      expect(HeartSchema.safeParse(heart).success, heart.id).toBe(true);
      expect(heart.id).toMatch(/^heart-\d{3}$/);
      expect(heart.split).toBe("dev");
      expect(heart.provenance).toBe("synthetic");
      expect(Object.keys(heart.measures).sort()).toEqual(
        Object.values(COLUMN_TO_KEY).sort(),
      );
      expect(heart.thumbUrl).toBe(`/hearts/${heart.id}.png`);
      expect(heart.meshUrl).toBe(`/hearts/${heart.id}.glb`);
    }
    expect(hearts).toEqual(devHearts());
  });

  test("GET /api/hearts/:id returns a dev heart's measurements", async ({
    request,
  }) => {
    const [first] = devHearts();
    const response = await request.get(`/api/hearts/${first.id}`);
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ heart: first });
  });

  test("a dev heart's mesh and thumbnail load", async ({ request, page }) => {
    const hearts = devHearts();
    const sample = [hearts[0], hearts[199], hearts[399]];
    await page.goto("/about");

    for (const { id, meshUrl, thumbUrl } of sample) {
      const mesh = await request.get(meshUrl);
      expect(mesh.status(), id).toBe(200);
      expectCompressedMesh(await mesh.body(), id);

      const thumb = await request.get(thumbUrl);
      expect(thumb.status(), id).toBe(200);
      expect(thumb.headers()["content-type"]).toContain("image/png");

      const pixels = await page.evaluate(async (url) => {
        const blob = await (await fetch(url)).blob();
        const bitmap = await createImageBitmap(blob);
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("no 2d context");
        context.drawImage(bitmap, 0, 0);
        const { data, width, height } = context.getImageData(
          0,
          0,
          bitmap.width,
          bitmap.height,
        );
        const at = (x: number, y: number) =>
          Array.from(data.slice((y * width + x) * 4, (y * width + x) * 4 + 4));
        let drawn = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] !== 247 || data[i + 1] !== 248 || data[i + 2] !== 248) {
            drawn += 1;
          }
        }
        return {
          width,
          height,
          drawnShare: drawn / (width * height),
          corners: [
            at(0, 0),
            at(width - 1, 0),
            at(0, height - 1),
            at(width - 1, height - 1),
          ],
        };
      }, thumbUrl);

      expect([pixels.width, pixels.height], id).toEqual([160, 160]);
      for (const corner of pixels.corners) {
        expect(corner, `${id} background`).toEqual([247, 248, 248, 255]);
      }
      expect(pixels.drawnShare, `${id} shows a root`).toBeGreaterThan(0.05);
    }
  });

  test("every dev heart has one small mesh and thumbnail, within the size budget", () => {
    const assetDir = fromRoot("public/hearts");
    expect(existsSync(assetDir), "public/hearts should exist").toBe(true);
    const hearts = devHearts();
    const expected = hearts.flatMap(({ id }) => [`${id}.glb`, `${id}.png`]);
    expect(readdirSync(assetDir).sort()).toEqual(expected.sort());

    let total = 0;
    for (const { id } of hearts) {
      const glb = readFileSync(path.join(assetDir, `${id}.glb`));
      expectCompressedMesh(glb, id);
      const png = readFileSync(path.join(assetDir, `${id}.png`));
      expect(png.subarray(1, 4).toString("latin1"), id).toBe("PNG");
      expect(png.length, `${id} thumbnail size`).toBeLessThanOrEqual(
        MAX_THUMB_BYTES,
      );
      total += glb.length + png.length;
    }
    test.info().annotations.push({
      type: "public/hearts total",
      description: `${(total / 1024 / 1024).toFixed(1)} MB`,
    });
    expect(total).toBeLessThanOrEqual(MAX_ASSET_BYTES);
  });
});

test.describe("hidden hearts", () => {
  test("100 hidden hearts stay in server-data, with no assets", () => {
    const hearts = hiddenHearts();
    expect(hearts).toHaveLength(100);
    for (const heart of hearts) {
      expect(HeartSchema.safeParse(heart).success, heart.id).toBe(true);
      expect(heart.split).toBe("hidden");
      expect(heart.provenance).toBe("synthetic");
      expect(heart.meshUrl).toBe("");
      expect(heart.thumbUrl).toBe("");
    }

    const publicFiles = filesUnder(fromRoot("public")).map((file) =>
      path.basename(file),
    );
    for (const { id } of hearts) {
      expect(publicFiles.some((file) => file.startsWith(`${id}.`)), id).toBe(
        false,
      );
    }
    expect(publicFiles).not.toContain("hearts.hidden.json");
    expect(readdirSync(fromRoot("server-data"))).toEqual(["hearts.hidden.json"]);
  });

  test("every hidden heart's mesh, thumbnail and measurements return 404", async ({
    request,
  }) => {
    const unknown = await request.get("/api/hearts/heart-999");
    expect(unknown.status()).toBe(404);
    const unknownBody = await unknown.text();

    for (const { id } of hiddenHearts()) {
      for (const url of [`/hearts/${id}.glb`, `/hearts/${id}.png`]) {
        expect((await request.get(url)).status(), url).toBe(404);
      }
      const measures = await request.get(`/api/hearts/${id}`);
      expect(measures.status(), id).toBe(404);
      expect(await measures.text(), `${id} looks unknown`).toBe(unknownBody);
    }
  });

  test("the hidden file can't be fetched and isn't in the list", async ({
    request,
  }) => {
    const hiddenIds = new Set(hiddenHearts().map(({ id }) => id));
    for (const url of [
      "/server-data/hearts.hidden.json",
      "/hearts.hidden.json",
      "/hearts/hearts.hidden.json",
      "/hearts/..%2f..%2fserver-data%2fhearts.hidden.json",
      "/api/hearts/..%2f..%2fserver-data%2fhearts.hidden.json",
      "/data/hearts.dev.json",
    ]) {
      expect((await request.get(url)).status(), url).toBeGreaterThanOrEqual(400);
    }
    const { hearts } = (await (
      await request.get("/api/hearts")
    ).json()) as HeartFile;
    expect(hearts.filter(({ id }) => hiddenIds.has(id))).toEqual([]);
    expect(devHearts().filter(({ id }) => hiddenIds.has(id))).toEqual([]);
  });

  test("hearts API source and browser bundle never carry hidden data", () => {
    const apiDir = fromRoot("src/app/api/hearts");
    expect(existsSync(apiDir), "src/app/api/hearts should exist").toBe(true);
    for (const file of filesUnder(apiDir)) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toContain("server-data");
      expect(source, file).not.toContain("hearts.hidden");
    }

    const secrets = hiddenHearts().map(({ measures }) =>
      String(measures.annulusMm),
    );
    const bundles = filesUnder(fromRoot(".next/static")).filter((file) =>
      /\.(js|json|txt)$/.test(file),
    );
    expect(bundles.length).toBeGreaterThan(0);
    for (const file of bundles) {
      const text = readFileSync(file, "utf8");
      expect(text.includes("hearts.hidden"), file).toBe(false);
      expect(
        secrets.filter((secret) => text.includes(secret)),
        file,
      ).toEqual([]);
    }
  });
});

test.describe("data:check", () => {
  test("the committed sources file documents the set", () => {
    const sources = readJson<Record<string, unknown>>(SOURCES_PATH);
    const text = JSON.stringify(sources);
    expect(text).toContain(PUBLISHED_MD5);
    expect(text).toContain("3f6a3788-96e6-4b81-b37b-f07eeec85965");
    expect(text).toContain("CC BY 4.0");
    expect(text).toContain("virtual_cohort");
    for (const column of Object.keys(COLUMN_TO_KEY)) {
      expect(text, column).toContain(column);
    }
  });

  test("source MD5 matches the published value", () => {
    const { source } = report();
    expect(source.expectedMd5).toBe(PUBLISHED_MD5);
    expect(source.md5).toBe(PUBLISHED_MD5);
    expect(source.match).toBe(true);
  });

  test("the split is identical on a rerun, with no overlap and matching annulus bands", () => {
    const { split } = report();
    expect(split.identicalOnRerun).toBe(true);
    expect(split.dev).toBe(400);
    expect(split.hidden).toBe(100);
    expect(split.overlap).toBe(0);

    const dev = devHearts();
    const hidden = hiddenHearts();
    const hiddenIds = new Set(hidden.map(({ id }) => id));
    expect(dev.filter(({ id }) => hiddenIds.has(id))).toEqual([]);
    expect(
      [...dev, ...hidden].map(({ id }) => caseNumber(id)).sort((a, b) => a - b),
    ).toEqual(Array.from({ length: 500 }, (_, index) => index + 1));

    const bandCount = BAND_EDGES.length + 1;
    expect(split.bands).toHaveLength(bandCount);
    for (let band = 0; band < bandCount; band += 1) {
      const inBand = ({ measures }: Heart) =>
        bandIndex(measures.annulusMm) === band;
      const devCount = dev.filter(inBand).length;
      const hiddenCount = hidden.filter(inBand).length;
      expect(split.bands[band].dev, `band ${band} dev`).toBe(devCount);
      expect(split.bands[band].hidden, `band ${band} hidden`).toBe(hiddenCount);
      expect(
        Math.abs(hiddenCount - (devCount + hiddenCount) * 0.2),
        `band ${band} is stratified`,
      ).toBeLessThanOrEqual(1);
    }
  });

  test("annulus-only exclusions on all 500 match the PRD", () => {
    const all = [...devHearts(), ...hiddenHearts()];
    expect(excludedCount(all, 21, 27)).toBe(116);
    expect(excludedCount(all, 21, 29)).toBe(59);
    expect(report().annulus).toEqual({
      excluded21to27: 116,
      excluded21to29: 59,
    });
  });

  test("measurements equal the source table on all 500, by numeric case order", async () => {
    const table = await sourceTable();
    expect(table).toHaveLength(500);
    const all = [...devHearts(), ...hiddenHearts()];
    expect(all).toHaveLength(500);
    for (const { id, measures } of all) {
      const row = table[caseNumber(id) - 1];
      for (const [column, key] of Object.entries(COLUMN_TO_KEY)) {
        expect(measures[key], `${id} ${key}`).toBe(row[column]);
      }
    }
  });

  test("table rows match meshes on all 500, against the threshold fixed in the plan", () => {
    const { rowMesh } = report();
    expect(rowMesh.thresholdMm).toBe(4);
    expect(rowMesh.minR).toBe(0.9);
    expect(rowMesh.checked).toBe(500);
    expect(rowMesh.failed).toBe(0);
    expect(rowMesh.maxResidualMm).toBeLessThanOrEqual(4);
    expect(rowMesh.r).toBeGreaterThanOrEqual(0.9);

    expect(rowMesh.controls.map(({ mapping }) => mapping).sort()).toEqual([
      "lexicographic",
      "off-by-one",
    ]);
    for (const control of rowMesh.controls) {
      expect(control.r, control.mapping).toBeLessThanOrEqual(0.5);
      expect(control.overThreshold, control.mapping).toBeGreaterThanOrEqual(50);
    }

    const source = readFileSync(fromRoot("scripts/data/row-mesh.ts"), "utf8");
    expect(source).toMatch(/ROW_MESH_MAX_RESIDUAL_MM\s*=\s*4\b/);
    expect(source).toMatch(/ROW_MESH_MIN_R\s*=\s*0\.9\b/);
  });

  test("fails when the zip is missing or isn't the published file", () => {
    const missing = runDataCheck(test.info().outputPath("no-such.zip"));
    expect(missing.status, "missing zip").not.toBe(0);

    const wrongFile = test.info().outputPath("wrong.zip");
    writeFileSync(wrongFile, "not the dataset");
    const wrong = runDataCheck(wrongFile);
    expect(wrong.status, "wrong zip").not.toBe(0);
    expect(wrong.output).not.toContain("data:check report: ");
  });

  test("fails when measurements or the split are tampered with", () => {
    report();
    const restoreMeasures = withTamperedFile(DEV_PATH, ({ hearts }) => {
      const [first, second] = hearts;
      [first.measures, second.measures] = [second.measures, first.measures];
    });
    try {
      const { status } = runDataCheck();
      expect(status, "swapped measurements").not.toBe(0);
    } finally {
      restoreMeasures();
    }

    const moved = hiddenHearts()[0];
    const moving = devHearts()[0];
    const restoreDev = withTamperedFile(DEV_PATH, ({ hearts }) => {
      hearts[0] = { ...moved, split: "dev" };
    });
    const restoreHidden = withTamperedFile(HIDDEN_PATH, ({ hearts }) => {
      hearts[0] = { ...moving, split: "hidden" };
    });
    try {
      const { status } = runDataCheck();
      expect(status, "moved across the split").not.toBe(0);
    } finally {
      restoreDev();
      restoreHidden();
    }
  });

  test("data scripts read only exact virtual_cohort entries", () => {
    const dir = fromRoot("scripts/data");
    for (const file of filesUnder(dir)) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toContain("real_cohort");
      expect(source, file).not.toMatch(/virtual_cohort_/);
      expect(source, file).not.toMatch(/virtual_cohort\/\*/);
    }
    const sourceFile = readFileSync(path.join(dir, "source.ts"), "utf8");
    expect(sourceFile).toContain("VALVULAR_DATA_ZIP");
  });
});
