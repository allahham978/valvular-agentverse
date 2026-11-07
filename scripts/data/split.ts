import type { Heart } from "../../src/contracts/index";
import { toHearts, type SourceRow } from "./source";

export const SPLIT_SEED = 20230901;
export const BAND_EDGES = [21, 23, 25, 27, 29];
const HIDDEN_SHARE = 0.2;

export type HeartSets = { dev: Heart[]; hidden: Heart[] };

function mulberry32(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function bandIndex(annulusMm: number): number {
  const index = BAND_EDGES.findIndex((edge) => annulusMm < edge);
  return index === -1 ? BAND_EDGES.length : index;
}

export function bandBounds(band: number) {
  return {
    minMm: band === 0 ? null : BAND_EDGES[band - 1],
    maxMm: band === BAND_EDGES.length ? null : BAND_EDGES[band],
  };
}

function hiddenQuotas(sizes: number[]): number[] {
  const total = Math.round(sizes.reduce((a, b) => a + b, 0) * HIDDEN_SHARE);
  const exact = sizes.map((size) => size * HIDDEN_SHARE);
  const quotas = exact.map(Math.floor);
  const order = exact
    .map((value, band) => ({ band, rest: value - Math.floor(value) }))
    .sort((a, b) => b.rest - a.rest || a.band - b.band);
  let missing = total - quotas.reduce((a, b) => a + b, 0);
  for (const { band } of order) {
    if (missing <= 0) break;
    quotas[band] += 1;
    missing -= 1;
  }
  return quotas;
}

export function splitHearts(table: SourceRow[]): HeartSets {
  const base = toHearts(table);
  const bands: number[][] = Array.from({ length: BAND_EDGES.length + 1 }, () => []);
  base.forEach((heart, index) => {
    bands[bandIndex(heart.measures.annulusMm)].push(index);
  });

  const random = mulberry32(SPLIT_SEED);
  const quotas = hiddenQuotas(bands.map((members) => members.length));
  const hidden = new Set<number>();
  bands.forEach((members, band) => {
    const shuffled = [...members];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    shuffled.slice(0, quotas[band]).forEach((index) => hidden.add(index));
  });

  const sets: HeartSets = { dev: [], hidden: [] };
  base.forEach((heart, index) => {
    if (hidden.has(index)) {
      sets.hidden.push({ ...heart, split: "hidden", thumbUrl: "", meshUrl: "" });
    } else {
      sets.dev.push({
        ...heart,
        split: "dev",
        thumbUrl: `/hearts/${heart.id}.png`,
        meshUrl: `/hearts/${heart.id}.glb`,
      });
    }
  });
  return sets;
}
