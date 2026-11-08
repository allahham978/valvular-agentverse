import type { Design, Limit } from "../contracts";

export type Planned = { design: Design; limits: Limit[] };
export type RestartPoint = "investigate" | "propose";

const sizesKey = (design: Design) =>
  JSON.stringify(
    design.sizes
      .map((size) => [size.nominalMm, size.minAnnulusMm, size.maxAnnulusMm])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]),
  );
const limitsKey = (limits: Limit[]) => JSON.stringify(limits.map((limit) => [limit.kind, limit.value]).sort());

export function restartPoint(before: Planned, after: Planned): RestartPoint | null {
  if (sizesKey(before.design) !== sizesKey(after.design)) return "investigate";
  return limitsKey(before.limits) !== limitsKey(after.limits) ? "propose" : null;
}
