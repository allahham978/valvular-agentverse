import type { FitResult } from "@/contracts";

const NEAR_27_MM_HEART_IDS = [
  "sample-017",
  "sample-019",
  "sample-033",
  "sample-043",
  "sample-060",
  "sample-084",
  "sample-089",
  "sample-095",
];

export function sampleNewRisk(designId: string): FitResult[] {
  return NEAR_27_MM_HEART_IDS.map((heartId) => ({
    heartId,
    designId,
    status: "risk",
    sizeMm: 27,
    reasons: [{ ruleId: "annulus-range", measured: 26.8, limit: 27, margin: 0.2 }],
  }));
}
