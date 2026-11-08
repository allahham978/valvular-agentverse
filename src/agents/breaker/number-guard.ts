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

export function allowedNumbersNote(evidence: Evidence[], design: Design, limits: Limit[]): string {
  const distinct = (texts: string[]) => [...new Set(texts.flatMap((text) => numbersIn(text).map(({ written }) => written)))];
  const perEvidence = evidence.map((item) => `${item.id}: ${distinct([JSON.stringify([item.input, item.result])]).slice(0, 40).join(", ")}`);
  const fixed = distinct([JSON.stringify(designNumbers(design).map(({ value }) => value)), ...limitNumbers(limits).map(({ value }) => String(value))]);
  return [
    "Allowed numbers (the number check accepts only these; any other number is rejected and costs you a rewrite).",
    ...perEvidence,
    `Design and limits: ${fixed.join(", ")}`,
    "Call the ending tool now and keep it short (one line per finding, at most 2 findings, at most 3 evidence IDs each). Write no number outside the lists of the evidence you cite.",
  ].join("\n");
}
