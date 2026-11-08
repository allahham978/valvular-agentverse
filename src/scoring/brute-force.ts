import type { Design, Limit, Summary } from "../contracts";
import { evaluateDesign } from "../engine";
import { devHearts } from "../lib/dev-hearts";

export const SUPPORTED_LIMIT_KINDS = ["max-sizes", "min-fit-pct", "max-new-risk"];

type Measured = { sizes: number; summary: Summary };

const checks: Record<string, (value: number, measured: Measured) => boolean> = {
  "max-sizes": (value, { sizes }) => sizes <= value,
  "min-fit-pct": (value, { summary }) => summary.fitPct >= value,
  "max-new-risk": (value, { summary }) => summary.newRiskHeartIds.length <= value,
};

const START_ANNULI_MM = Array.from({ length: 13 }, (_, i) => 19 + i * 0.5);
const WIDTHS_MM = [2, 2.5];
const DEFAULT_MAX_SIZES = 6;

export type BruteForceResult = { design: Design | null; designsTried: number; reason?: string };

function chain(start: Design, annulusMm: number, widthMm: number, count: number): Design {
  return {
    id: "baseline-brute-force",
    label: "Brute-force search winner",
    hypothetical: true,
    parentId: start.id,
    sizes: Array.from({ length: count }, (_, i) => {
      const max = annulusMm + widthMm * (i + 1);
      return { nominalMm: max, minAnnulusMm: annulusMm + widthMm * i, maxAnnulusMm: max };
    }),
  };
}

export function bruteForce(start: Design, limits: Limit[]): BruteForceResult {
  const hearts = devHearts();
  const maxSizes = limits
    .filter((limit) => limit.kind === "max-sizes")
    .reduce((cap, limit) => Math.min(cap, Number(limit.value)), DEFAULT_MAX_SIZES);

  let best: { design: Design; fit: number } | undefined;
  let designsTried = 0;
  for (const annulusMm of START_ANNULI_MM) {
    for (const widthMm of WIDTHS_MM) {
      for (let count = 1; count <= maxSizes; count++) {
        designsTried += 1;
        const design = chain(start, annulusMm, widthMm, count);
        const evaluation = evaluateDesign({ hearts, design, parent: start });
        if (!evaluation.ok) continue;
        const measured = { sizes: count, summary: evaluation.summary };
        if (!limits.every((limit) => checks[limit.kind](Number(limit.value), measured))) continue;
        const { fit } = evaluation.summary;
        if (!best || fit > best.fit || (fit === best.fit && count < best.design.sizes.length)) best = { design, fit };
      }
    }
  }
  if (!best) return { design: null, designsTried, reason: "No searched size set passes the active limits on the development hearts." };
  return { design: best.design, designsTried };
}
