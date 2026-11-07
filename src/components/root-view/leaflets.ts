import { BufferAttribute, BufferGeometry } from "three";

const BANDS = 24;
const RADIUS_PERCENTILE = 0.85;
const INSIDE = 0.72;
const FROM = 0.12;
const TO = 0.4;

function bandStats(position: BufferAttribute, min: number, span: number) {
  const bandOf = (x: number) =>
    Math.min(BANDS - 1, Math.floor(((x - min) / span) * BANDS));
  const sums = Array.from({ length: BANDS }, () => ({ y: 0, z: 0, n: 0 }));
  for (let i = 0; i < position.count; i++) {
    const sum = sums[bandOf(position.getX(i))];
    sum.y += position.getY(i);
    sum.z += position.getZ(i);
    sum.n++;
  }
  const centres = sums.map(({ y, z, n }) => ({ y: y / (n || 1), z: z / (n || 1) }));
  const distances: number[][] = Array.from({ length: BANDS }, () => []);
  const radial = new Float32Array(position.count);
  for (let i = 0; i < position.count; i++) {
    const band = bandOf(position.getX(i));
    radial[i] = Math.hypot(
      position.getY(i) - centres[band].y,
      position.getZ(i) - centres[band].z,
    );
    distances[band].push(radial[i]);
  }
  const radii = distances.map((list) => {
    list.sort((a, b) => a - b);
    return list[Math.floor(list.length * RADIUS_PERCENTILE)] ?? 0;
  });
  return { bandOf, radial, radii };
}

function subset(source: BufferGeometry, triangles: number[]): BufferGeometry {
  const position = source.getAttribute("position");
  const normal = source.getAttribute("normal");
  const remap = new Map<number, number>();
  const positions: number[] = [];
  const normals: number[] = [];
  const index: number[] = [];
  for (const vertex of triangles) {
    let mapped = remap.get(vertex);
    if (mapped === undefined) {
      mapped = remap.size;
      remap.set(vertex, mapped);
      positions.push(position.getX(vertex), position.getY(vertex), position.getZ(vertex));
      normals.push(normal.getX(vertex), normal.getY(vertex), normal.getZ(vertex));
    }
    index.push(mapped);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("normal", new BufferAttribute(new Float32Array(normals), 3));
  geometry.setIndex(index);
  return geometry;
}

// Heuristic: the root meshes have no separate leaflet part, so take triangles that sit well
// inside the wall in the lowest part of the long (X) axis.
export function splitLeaflets(source: BufferGeometry) {
  const position = source.getAttribute("position");
  const index = source.index;
  const triangleCount = (index ? index.count : position.count) / 3;
  const vertexAt = (corner: number) => (index ? index.getX(corner) : corner);

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < position.count; i++) {
    min = Math.min(min, position.getX(i));
    max = Math.max(max, position.getX(i));
  }
  const span = max - min;
  const { bandOf, radial, radii } = bandStats(position, min, span);

  const wall: number[] = [];
  const leaflets: number[] = [];
  for (let t = 0; t < triangleCount; t++) {
    const corners = [vertexAt(t * 3), vertexAt(t * 3 + 1), vertexAt(t * 3 + 2)];
    const along =
      (corners.reduce((sum, v) => sum + position.getX(v), 0) / 3 - min) / span;
    const inside = corners.every(
      (v) => radial[v] < INSIDE * radii[bandOf(position.getX(v))],
    );
    (inside && along >= FROM && along <= TO ? leaflets : wall).push(...corners);
  }
  return { wall: subset(source, wall), leaflets: subset(source, leaflets) };
}
