import { BufferAttribute, BufferGeometry, InterleavedBufferAttribute } from "three";

const BANDS = 24;
const SECTORS = 24;
const INSIDE = 0.78;
const FROM = 0.12;
const TO = 0.4;

function bandStats(position: BufferAttribute | InterleavedBufferAttribute, min: number, span: number) {
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
  const angleOf = (i: number) => {
    const band = bandOf(position.getX(i));
    const turn = Math.atan2(position.getZ(i) - centres[band].z, position.getY(i) - centres[band].y);
    return Math.min(SECTORS - 1, Math.floor(((turn + Math.PI) / (2 * Math.PI)) * SECTORS));
  };
  const radial = new Float32Array(position.count);
  const outer = new Float32Array(BANDS * SECTORS);
  for (let i = 0; i < position.count; i++) {
    const band = bandOf(position.getX(i));
    radial[i] = Math.hypot(position.getY(i) - centres[band].y, position.getZ(i) - centres[band].z);
    const cell = band * SECTORS + angleOf(i);
    outer[cell] = Math.max(outer[cell], radial[i]);
  }
  const radii = (i: number) => {
    const band = bandOf(position.getX(i));
    const sector = angleOf(i);
    let largest = 0;
    for (let b = Math.max(0, band - 1); b <= Math.min(BANDS - 1, band + 1); b++) {
      for (let d = -1; d <= 1; d++) {
        largest = Math.max(largest, outer[b * SECTORS + ((sector + d + SECTORS) % SECTORS)]);
      }
    }
    return largest;
  };
  return { radial, radii };
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

const SMOOTH_PASSES = 8;
const ISLAND_SHARE = 0.1;

function weldVertices(position: BufferAttribute | InterleavedBufferAttribute) {
  const ids = new Map<string, number>();
  const welded = new Uint32Array(position.count);
  for (let i = 0; i < position.count; i++) {
    const key = `${position.getX(i).toFixed(4)},${position.getY(i).toFixed(4)},${position.getZ(i).toFixed(4)}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = ids.size;
      ids.set(key, id);
    }
    welded[i] = id;
  }
  return { welded, count: ids.size };
}

function neighbourLists(triangles: number[][], count: number) {
  const sets = Array.from({ length: count }, () => new Set<number>());
  for (const [a, b, c] of triangles) {
    sets[a].add(b).add(c);
    sets[b].add(a).add(c);
    sets[c].add(a).add(b);
  }
  return sets.map((set) => [...set]);
}

function smoothScores(scores: Float32Array, neighbours: number[][]) {
  let current = scores;
  for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
    const next = new Float32Array(current.length);
    for (let v = 0; v < current.length; v++) {
      let sum = current[v];
      for (const n of neighbours[v]) sum += current[n];
      next[v] = sum / (neighbours[v].length + 1);
    }
    current = next;
  }
  return current;
}

function dropIslands(triangles: number[][], keep: boolean[], count: number) {
  const parent = Array.from({ length: count }, (_, i) => i);
  const find = (v: number): number => (parent[v] === v ? v : (parent[v] = find(parent[v])));
  triangles.forEach(([a, b, c], t) => {
    if (!keep[t]) return;
    parent[find(a)] = find(b);
    parent[find(b)] = find(c);
  });
  const sizes = new Map<number, number>();
  triangles.forEach(([a], t) => {
    if (keep[t]) sizes.set(find(a), (sizes.get(find(a)) ?? 0) + 1);
  });
  const total = [...sizes.values()].reduce((sum, size) => sum + size, 0);
  triangles.forEach(([a], t) => {
    if (keep[t] && (sizes.get(find(a)) ?? 0) < total * ISLAND_SHARE) keep[t] = false;
  });
}

// Heuristic: the root meshes have no separate leaflet part, so take vertices that sit well
// inside the wall in the lowest part of the long (X) axis, smooth that region over the
// surface and drop small islands, so the cut between wall and leaflets is clean.
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
  const { radial, radii } = bandStats(position, min, span);
  const { welded, count } = weldVertices(position);

  const raw = new Float32Array(count);
  for (let i = 0; i < position.count; i++) {
    const along = (position.getX(i) - min) / span;
    const inside = radial[i] < INSIDE * radii(i);
    if (inside && along >= FROM && along <= TO) raw[welded[i]] = 1;
  }

  const corners: number[][] = [];
  const weldedTriangles: number[][] = [];
  for (let t = 0; t < triangleCount; t++) {
    const c = [vertexAt(t * 3), vertexAt(t * 3 + 1), vertexAt(t * 3 + 2)];
    corners.push(c);
    weldedTriangles.push(c.map((v) => welded[v]));
  }
  const scores = smoothScores(raw, neighbourLists(weldedTriangles, count));
  const keep = weldedTriangles.map((tri) => tri.every((v) => scores[v] >= 0.5));
  dropIslands(weldedTriangles, keep, count);

  const wall: number[] = [];
  const leaflets: number[] = [];
  corners.forEach((c, t) => (keep[t] ? leaflets : wall).push(...c));
  return { wall: subset(source, wall), leaflets: subset(source, leaflets) };
}
