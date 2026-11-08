import { BufferAttribute, BufferGeometry, Color, MathUtils } from "three";
import type { FitResult } from "@/contracts";

export const WALL_ALPHA = 0.16;
// Vertex alpha scales the wall opacity, so the tint can be several times as opaque as the plain wall.
const TINT_BOOST = 0.5 / WALL_ALPHA;
const EDGE = 0.05;

const TINTS = { "no-fit": "#d04a43", risk: "#d9941e" } as const;

// Where each rule's problem sits along the root's long axis (0 = ventricular end, 1 = aortic end).
const BANDS: Record<string, [number, number]> = {
  "annulus-coverage": [0.05, 0.3],
  "sinus-clearance": [0.28, 0.55],
  "stj-excess": [0.5, 0.78],
};
const OTHER_BAND: [number, number] = [0.3, 0.6];

export function createWallColours(geometry: BufferGeometry) {
  const count = geometry.getAttribute("position").count;
  const colours = new BufferAttribute(new Float32Array(count * 4), 4);
  for (let i = 0; i < count; i++) colours.setXYZW(i, 1, 1, 1, 1);
  geometry.setAttribute("color", colours);
}

export function paintWall(geometry: BufferGeometry, fit: FitResult | undefined) {
  const colours = geometry.getAttribute("color");
  const position = geometry.getAttribute("position");
  const tint = fit && fit.status !== "fit" ? new Color(TINTS[fit.status]) : null;
  const bands = tint ? (fit?.reasons.length ? fit.reasons.map((r) => BANDS[r.ruleId] ?? OTHER_BAND) : [OTHER_BAND]) : [];

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < position.count; i++) {
    min = Math.min(min, position.getX(i));
    max = Math.max(max, position.getX(i));
  }
  for (let i = 0; i < position.count; i++) {
    const along = (position.getX(i) - min) / (max - min);
    let weight = 0;
    for (const [from, to] of bands) {
      weight = Math.max(weight, MathUtils.smoothstep(along, from - EDGE, from + EDGE) * (1 - MathUtils.smoothstep(along, to - EDGE, to + EDGE)));
    }
    if (tint) {
      colours.setXYZW(
        i,
        1 + (tint.r - 1) * weight,
        1 + (tint.g - 1) * weight,
        1 + (tint.b - 1) * weight,
        1 + (TINT_BOOST - 1) * weight,
      );
    } else colours.setXYZW(i, 1, 1, 1, 1);
  }
  colours.needsUpdate = true;
}
