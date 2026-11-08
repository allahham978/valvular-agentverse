import type { Design, Evidence, Limit } from "../../contracts";

const EPSILON = 1e-9;
const NUMBER = /\d+(?:\.\d+)?/g;
const IDS = /heart-\d+|ev-[A-Za-z0-9]+/g;

type Allowed = { value: number }[];

const numbersIn = (text: string) =>
  [...text.replace(IDS, " ").matchAll(NUMBER)].map(([written]) => ({
    written,
    value: Number(written),
    halfUnit: 0.5 * 10 ** -(written.split(".")[1]?.length ?? 0),
  }));

function designNumbers(design: Design): Allowed {
  const sizes = design.sizes.flatMap((size) => [size.nominalMm, size.minAnnulusMm, size.maxAnnulusMm]);
  return [...sizes, ...numbersIn(design.label).map((n) => n.value)].map((value) => ({ value }));
}

function limitNumbers(limits: Limit[]): Allowed {
  return limits.flatMap((limit) => (Number.isFinite(Number(limit.value)) ? [{ value: Number(limit.value) }] : []));
}

export function inventedNumbers(text: string, evidence: Evidence[], design: Design, limits: Limit[]): string[] {
  const cited = evidence.flatMap((item) => numbersIn(JSON.stringify([item.input, item.result])).map(({ value }) => ({ value })));
  const allowed = [...cited, ...designNumbers(design), ...limitNumbers(limits)];
  return numbersIn(text)
    .filter(({ value, halfUnit }) => !allowed.some((known) => Math.abs(known.value - value) <= halfUnit + EPSILON))
    .map(({ written }) => written);
}
