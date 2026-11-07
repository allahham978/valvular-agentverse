import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { compressMesh } from "./mesh";
import { ROW_MESH_MAX_RESIDUAL_MM, ROW_MESH_MIN_R } from "./row-mesh";
import {
  COLUMN_TO_KEY,
  PUBLISHED_MD5,
  readMesh,
  readTable,
  stlPositions,
  zipMd5,
} from "./source";
import { BAND_EDGES, SPLIT_SEED, splitHearts } from "./split";
import { renderThumbnail } from "./thumbnail";

const ASSET_DIR = "public/hearts";

const SOURCES = {
  name: "Verstraeten et al. 2023 data repository, virtual cohort of 500 synthetic stenotic aortic roots",
  url: "https://data.4tu.nl/datasets/3f6a3788-96e6-4b81-b37b-f07eeec85965",
  authors: "Verstraeten et al.",
  year: 2023,
  licence: "CC BY 4.0",
  cohort: "virtual_cohort",
  md5: PUBLISHED_MD5,
  files: ["shapeFeatures.xlsx", "Case_1.stl to Case_500.stl"],
  seed: SPLIT_SEED,
  split: {
    method: "Stratified by annulus band, 20% of each band hidden by largest remainder, seeded shuffle within band",
    bandEdgesMm: BAND_EDGES,
    dev: 400,
    hidden: 100,
  },
  columns: COLUMN_TO_KEY,
  rowToMesh: {
    method: "Row N of shapeFeatures.xlsx is Case_N.stl. Checked by fitting the mean of D_lvot, D_an, D_sinus and D_stj to the square root of each mesh's total triangle area.",
    maxResidualMm: ROW_MESH_MAX_RESIDUAL_MM,
    minR: ROW_MESH_MIN_R,
    limit: "Proves the ordering as a whole and catches outliers. Cannot detect a swap of two hearts of the same size.",
  },
  assets: "Dev hearts only: simplified meshes (meshopt GLB) and shaded thumbnails. Hidden hearts have measurements only.",
};

function writeJson(file: string, data: unknown) {
  mkdirSync(file.slice(0, file.lastIndexOf("/")), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

async function main() {
  if ((await zipMd5()) !== PUBLISHED_MD5) throw new Error("source MD5 mismatch");
  const { dev, hidden } = splitHearts(await readTable());
  writeJson("data/hearts.dev.json", { hearts: dev });
  writeJson("server-data/hearts.hidden.json", { hearts: hidden });
  writeJson("data/sources.json", SOURCES);

  rmSync(ASSET_DIR, { recursive: true, force: true });
  mkdirSync(ASSET_DIR, { recursive: true });
  let total = 0;
  for (const { id } of dev) {
    const positions = stlPositions(readMesh(Number(id.slice(6))));
    const glb = await compressMesh(positions);
    const png = renderThumbnail(positions);
    writeFileSync(`${ASSET_DIR}/${id}.glb`, glb);
    writeFileSync(`${ASSET_DIR}/${id}.png`, png);
    total += glb.length + png.length;
    if (Number(id.slice(6)) % 20 === 0) console.log(id, glb.length, png.length);
  }
  console.log(`built ${dev.length} hearts, ${(total / 1024 / 1024).toFixed(1)} MB`);
}

main();
