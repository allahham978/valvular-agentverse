import { crc32, deflateSync } from "node:zlib";

const SIZE = 160;
const SUPER = 2;
const PX_PER_MM = 2.1;
const CENTER_X_MM = 16;
const TILT = (30 * Math.PI) / 180;
const LIGHT = normalize([-0.4, 0.5, 0.75]);
const BACKGROUND = [0xf7, 0xf8, 0xf8];
const DARKEST = [0x3a, 0x4b, 0x57];
const LEVELS = 64;

function normalize(v: number[]): number[] {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return v.map((c) => c / length);
}

function project(x: number, y: number, z: number): number[] {
  const cos = Math.cos(TILT);
  const sin = Math.sin(TILT);
  return [y * cos - z * sin, x - CENTER_X_MM, y * sin + z * cos];
}

function smoothNormals(points: number[][]): number[][] {
  const sums = new Map<string, number[]>();
  const key = (p: number[]) =>
    p.map((c) => Math.round(c * 1000)).join(",");
  for (let i = 0; i < points.length; i += 3) {
    const [a, b, c] = [points[i], points[i + 1], points[i + 2]];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [
      u[1] * w[2] - u[2] * w[1],
      u[2] * w[0] - u[0] * w[2],
      u[0] * w[1] - u[1] * w[0],
    ];
    for (const p of [a, b, c]) {
      const sum = sums.get(key(p)) ?? [0, 0, 0];
      sums.set(key(p), [sum[0] + n[0], sum[1] + n[1], sum[2] + n[2]]);
    }
  }
  return points.map((p) => normalize(sums.get(key(p)) as number[]));
}

function render(positions: Float32Array): Float32Array {
  const side = SIZE * SUPER;
  const points: number[][] = [];
  for (let i = 0; i < positions.length; i += 3) {
    points.push(project(positions[i], positions[i + 1], positions[i + 2]));
  }
  const normals = smoothNormals(points);
  const depth = new Float32Array(side * side).fill(-Infinity);
  const tone = new Float32Array(side * side).fill(1);
  const toScreen = (p: number[]) => [
    side / 2 + p[0] * PX_PER_MM * SUPER,
    side / 2 - p[1] * PX_PER_MM * SUPER,
  ];

  for (let i = 0; i < points.length; i += 3) {
    const s = [0, 1, 2].map((k) => toScreen(points[i + k]));
    const area =
      (s[1][0] - s[0][0]) * (s[2][1] - s[0][1]) -
      (s[2][0] - s[0][0]) * (s[1][1] - s[0][1]);
    if (Math.abs(area) < 1e-9) continue;
    const minX = Math.max(0, Math.floor(Math.min(s[0][0], s[1][0], s[2][0])));
    const maxX = Math.min(side - 1, Math.ceil(Math.max(s[0][0], s[1][0], s[2][0])));
    const minY = Math.max(0, Math.floor(Math.min(s[0][1], s[1][1], s[2][1])));
    const maxY = Math.min(side - 1, Math.ceil(Math.max(s[0][1], s[1][1], s[2][1])));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const px = x + 0.5;
        const py = y + 0.5;
        const w0 =
          ((s[1][0] - px) * (s[2][1] - py) - (s[2][0] - px) * (s[1][1] - py)) / area;
        const w1 =
          ((s[2][0] - px) * (s[0][1] - py) - (s[0][0] - px) * (s[2][1] - py)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z =
          w0 * points[i][2] + w1 * points[i + 1][2] + w2 * points[i + 2][2];
        const at = y * side + x;
        if (z <= depth[at]) continue;
        depth[at] = z;
        const n = normalize([0, 1, 2].map((k) =>
          w0 * normals[i][k] + w1 * normals[i + 1][k] + w2 * normals[i + 2][k],
        ));
        const light = Math.abs(n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
        tone[at] = 0.15 + 0.6 * light;
      }
    }
  }

  const covered = depth.map((d) => (d === -Infinity ? 0 : 1));
  const out = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      let sum = 0;
      for (let dy = 0; dy < SUPER; dy += 1) {
        for (let dx = 0; dx < SUPER; dx += 1) {
          const at = (y * SUPER + dy) * side + x * SUPER + dx;
          sum += covered[at] ? tone[at] : 1;
        }
      }
      out[y * SIZE + x] = sum / (SUPER * SUPER);
    }
  }
  return out;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
}

function encodePng(indices: Uint8Array, palette: number[][]): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header.set([8, 3, 0, 0, 0], 8);
  const rows = Buffer.alloc((SIZE + 1) * SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    rows[y * (SIZE + 1)] = 1;
    for (let x = 0; x < SIZE; x += 1) {
      const left = x === 0 ? 0 : indices[y * SIZE + x - 1];
      rows[y * (SIZE + 1) + 1 + x] = (indices[y * SIZE + x] - left) & 255;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("PLTE", Buffer.from(palette.flat())),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function renderThumbnail(positions: Float32Array): Buffer {
  const palette = Array.from({ length: LEVELS }, (_, level) =>
    DARKEST.map((dark, k) =>
      Math.round(dark + ((BACKGROUND[k] - dark) * level) / (LEVELS - 1)),
    ),
  );
  const tones = render(positions);
  const indices = Uint8Array.from(tones, (t) =>
    t >= 1 ? LEVELS - 1 : Math.min(LEVELS - 2, Math.round(t * (LEVELS - 1))),
  );
  return encodePng(indices, palette);
}
