import { existsSync, readFileSync } from "node:fs";
import type { Heart } from "../../src/contracts/index";
import {
  checkRowMesh,
  meshScale,
  rowMeshPasses,
  tableSize,
} from "./row-mesh";
import {
  CASE_COUNT,
  PUBLISHED_MD5,
  readMesh,
  readTable,
  zipMd5,
} from "./source";
import { SPLIT_SEED, bandBounds, bandIndex, splitHearts } from "./split";

const DEV_PATH = "data/hearts.dev.json";
const HIDDEN_PATH = "server-data/hearts.hidden.json";

function fail(message: string): never {
  console.error(`data:check failed: ${message}`);
  process.exit(1);
}

function committed(file: string): Heart[] {
  if (!existsSync(file)) fail(`${file} is missing`);
  return (JSON.parse(readFileSync(file, "utf8")) as { hearts: Heart[] }).hearts;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function main() {
  const md5 = await zipMd5().catch((error: Error) => fail(error.message));
  if (md5 !== PUBLISHED_MD5) fail(`source MD5 ${md5} is not the published ${PUBLISHED_MD5}`);

  const table = await readTable();
  if (table.length !== CASE_COUNT) fail(`table has ${table.length} rows`);
  const first = splitHearts(table);
  const identicalOnRerun = same(first, splitHearts(table));
  if (!identicalOnRerun) fail("split differs on rerun");
  if (!same(committed(DEV_PATH), first.dev)) fail(`${DEV_PATH} differs from the rebuilt split`);
  if (!same(committed(HIDDEN_PATH), first.hidden)) fail(`${HIDDEN_PATH} differs from the rebuilt split`);

  const devIds = new Set(first.dev.map(({ id }) => id));
  const overlap = first.hidden.filter(({ id }) => devIds.has(id)).length;
  if (overlap !== 0 || first.dev.length !== 400 || first.hidden.length !== 100) {
    fail("split is not 400 dev, 100 hidden with no overlap");
  }
  const missingAssets = first.dev.filter(
    ({ id }) => !existsSync(`public/hearts/${id}.glb`) || !existsSync(`public/hearts/${id}.png`),
  );
  if (missingAssets.length > 0) fail(`${missingAssets.length} dev hearts lack assets`);

  const bands = Array.from({ length: 6 }, (_, band) => {
    const count = (hearts: Heart[]) =>
      hearts.filter(({ measures }) => bandIndex(measures.annulusMm) === band).length;
    return { ...bandBounds(band), dev: count(first.dev), hidden: count(first.hidden) };
  });
  const unbalanced = bands.filter(
    ({ dev, hidden }) => Math.abs(hidden - (dev + hidden) * 0.2) > 1,
  );
  if (unbalanced.length > 0) fail("annulus bands are not matched across the splits");

  const all = [...first.dev, ...first.hidden];
  const excluded = (min: number, max: number) =>
    all.filter(({ measures }) => measures.annulusMm < min || measures.annulusMm > max).length;
  const annulus = { excluded21to27: excluded(21, 27), excluded21to29: excluded(21, 29) };
  if (annulus.excluded21to27 !== 116 || annulus.excluded21to29 !== 59) {
    fail(`annulus exclusions are ${JSON.stringify(annulus)}`);
  }

  const scales = Array.from({ length: CASE_COUNT }, (_, index) =>
    meshScale(readMesh(index + 1)),
  );
  const rowMesh = checkRowMesh(table.map(tableSize), scales);
  if (!rowMeshPasses(rowMesh)) fail(`row-to-mesh check failed: ${JSON.stringify(rowMesh)}`);

  const report = {
    source: { md5, expectedMd5: PUBLISHED_MD5, match: true },
    split: {
      seed: SPLIT_SEED,
      identicalOnRerun,
      dev: first.dev.length,
      hidden: first.hidden.length,
      overlap,
      bands,
    },
    annulus,
    rowMesh,
  };
  console.log(`data:check report: ${JSON.stringify(report)}`);
}

main().catch((error: Error) => fail(error.message));
