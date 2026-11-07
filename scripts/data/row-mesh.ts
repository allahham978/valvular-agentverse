export const ROW_MESH_MAX_RESIDUAL_MM = 4;
export const ROW_MESH_MIN_R = 0.9;
const CONTROL_MAX_R = 0.5;
const CONTROL_MIN_OVER = 50;

export type SizeRow = {
  D_lvot: number;
  D_an: number;
  D_sinus: number;
  D_stj: number;
};

export type RowMeshReport = {
  checked: number;
  failed: number;
  maxResidualMm: number;
  thresholdMm: number;
  r: number;
  minR: number;
  controls: { mapping: string; r: number; overThreshold: number }[];
};

export function meshScale(stl: Buffer): number {
  const triangles = stl.readUInt32LE(80);
  let area = 0;
  for (let t = 0; t < triangles; t += 1) {
    const o = 84 + t * 50 + 12;
    const v = (i: number) => stl.readFloatLE(o + i * 4);
    const ux = v(3) - v(0);
    const uy = v(4) - v(1);
    const uz = v(5) - v(2);
    const wx = v(6) - v(0);
    const wy = v(7) - v(1);
    const wz = v(8) - v(2);
    const cx = uy * wz - uz * wy;
    const cy = uz * wx - ux * wz;
    const cz = ux * wy - uy * wx;
    area += 0.5 * Math.hypot(cx, cy, cz);
  }
  return Math.sqrt(area);
}

export function tableSize(row: SizeRow): number {
  return (row.D_lvot + row.D_an + row.D_sinus + row.D_stj) / 4;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function correlation(xs: number[], ys: number[]): number {
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  xs.forEach((x, i) => {
    sxy += (x - mx) * (ys[i] - my);
    sxx += (x - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  });
  return sxy / Math.sqrt(sxx * syy);
}

export function checkRowMesh(sizes: number[], scales: number[]): RowMeshReport {
  const mx = mean(scales);
  const my = mean(sizes);
  let sxy = 0;
  let sxx = 0;
  scales.forEach((s, i) => {
    sxy += (s - mx) * (sizes[i] - my);
    sxx += (s - mx) ** 2;
  });
  const a = sxy / sxx;
  const b = my - a * mx;
  const residuals = (mapped: number[]) =>
    sizes.map((d, i) => Math.abs(d - (a * mapped[i] + b)));

  const direct = residuals(scales);
  const count = scales.length;
  const lexicographic = Array.from({ length: count }, (_, i) => i + 1)
    .map(String)
    .sort()
    .map(Number);
  const mappings: Record<string, number[]> = {
    lexicographic: sizes.map((_, i) => scales[lexicographic[i] - 1]),
    "off-by-one": sizes.map((_, i) => scales[(i + 1) % count]),
  };

  return {
    checked: count,
    failed: direct.filter((e) => e > ROW_MESH_MAX_RESIDUAL_MM).length,
    maxResidualMm: Math.max(...direct),
    thresholdMm: ROW_MESH_MAX_RESIDUAL_MM,
    r: correlation(scales, sizes),
    minR: ROW_MESH_MIN_R,
    controls: Object.entries(mappings).map(([mapping, mapped]) => ({
      mapping,
      r: correlation(mapped, sizes),
      overThreshold: residuals(mapped).filter((e) => e > ROW_MESH_MAX_RESIDUAL_MM)
        .length,
    })),
  };
}

export function rowMeshPasses(report: RowMeshReport): boolean {
  return (
    report.checked === 500 &&
    report.failed === 0 &&
    report.r >= ROW_MESH_MIN_R &&
    report.controls.every(
      (c) => c.r <= CONTROL_MAX_R && c.overThreshold >= CONTROL_MIN_OVER,
    )
  );
}
