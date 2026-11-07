import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import ExcelJS from "exceljs";
import type { Heart } from "../../src/contracts/index";

export const ZIP_PATH =
  process.env.VALVULAR_DATA_ZIP ??
  "/Users/mohammadallahham/Desktop/code/hackathon-agentverse/data/raw/verstraeten.zip";
export const PUBLISHED_MD5 = "9f40559c1d58d42321c0d8fb680b68e5";
export const CASE_COUNT = 500;

const COHORT_DIR = "data_repository_Verstraeten_et_al_2023/virtual_cohort";

export const COLUMN_TO_KEY = {
  D_an: "annulusMm",
  D_sinus: "sinusMm",
  D_stj: "sinotubularJunctionMm",
  D_lvot: "lvotMm",
  H_sinus: "sinusHeightMm",
  AVA: "aorticValveArea",
  angle: "angleDeg",
  ratio_lvot_over_an_area: "lvotOverAnnulusAreaRatio",
} as const;

export type SourceRow = Record<keyof typeof COLUMN_TO_KEY, number>;

export const heartId = (caseNumber: number) =>
  `heart-${String(caseNumber).padStart(3, "0")}`;

function readEntry(name: string): Buffer {
  return execFileSync("unzip", ["-p", ZIP_PATH, `${COHORT_DIR}/${name}`], {
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

export function readMesh(caseNumber: number): Buffer {
  return readEntry(`Case_${caseNumber}.stl`);
}

export function zipMd5(): Promise<string> {
  if (!existsSync(ZIP_PATH)) {
    return Promise.reject(new Error(`data zip not found: ${ZIP_PATH}`));
  }
  return new Promise((resolve, reject) => {
    const hash = createHash("md5");
    createReadStream(ZIP_PATH)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

export async function readTable(): Promise<SourceRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    readEntry("shapeFeatures.xlsx") as unknown as ExcelJS.Buffer,
  );
  const rows: unknown[][] = [];
  workbook.worksheets[0].eachRow((row) => {
    rows.push((row.values as unknown[]).slice(1));
  });
  const [header, ...body] = rows;
  return body.map(
    (row) =>
      Object.fromEntries(
        header.map((name, column) => [String(name), Number(row[column])]),
      ) as SourceRow,
  );
}

export function toHearts(
  table: SourceRow[],
): Omit<Heart, "split" | "thumbUrl" | "meshUrl">[] {
  return table.map((row, index) => ({
    id: heartId(index + 1),
    provenance: "synthetic" as const,
    measures: Object.fromEntries(
      Object.entries(COLUMN_TO_KEY).map(([column, key]) => [
        key,
        row[column as keyof SourceRow],
      ]),
    ),
  }));
}

export function stlPositions(stl: Buffer): Float32Array<ArrayBuffer> {
  const triangles = stl.readUInt32LE(80);
  const positions = new Float32Array(triangles * 9);
  for (let t = 0; t < triangles; t += 1) {
    for (let k = 0; k < 9; k += 1) {
      positions[t * 9 + k] = stl.readFloatLE(84 + t * 50 + 12 + k * 4);
    }
  }
  return positions;
}
