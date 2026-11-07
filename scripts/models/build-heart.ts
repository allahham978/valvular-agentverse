import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Document, NodeIO } from "@gltf-transform/core";
import {
  ALL_EXTENSIONS,
  EXTMeshoptCompression,
  KHRMeshQuantization,
} from "@gltf-transform/extensions";
import { meshopt, quantize, simplify, weld } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";

const SOURCE = "data/raw/heart-model/heart-nih3d.glb";
const OUT = "public/models/heart.glb";
const CREDIT_OUT = "public/models/heart.credit.txt";
const CREDIT =
  '"Human Heart 3d Model" (3DPX-022787) by Sourav Pan, via NIH 3D, listed as CC0 1.0. Geometry simplified and materials replaced. Illustrative only.\n';

const SMOOTHING_PASSES = 12;
const BODY_COLOUR = [0.79, 0.29, 0.31];
const AORTA_COLOUR = [0.93, 0.5, 0.45];
const AORTA_RADIUS = 0.075;
const AORTA_LINE = [
  [0.083, 0.09, 0.067],
  [0.083, 0.22, 0.067],
  [0.07, 0.3, 0.05],
  [0, 0.335, 0.03],
  [-0.07, 0.29, 0],
  [-0.1, 0.2, -0.012],
  [-0.106, 0.1, -0.013],
];

function mainCheckout(): string {
  const common = execFileSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { encoding: "utf8" },
  ).trim();
  return path.dirname(common);
}

function neighbours(indices: ArrayLike<number>, count: number): number[][] {
  const sets = Array.from({ length: count }, () => new Set<number>());
  for (let i = 0; i < indices.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const a = indices[i + k];
      const b = indices[i + ((k + 1) % 3)];
      sets[a].add(b);
      sets[b].add(a);
    }
  }
  return sets.map((set) => [...set]);
}

function taubin(positions: Float32Array, links: number[][]) {
  const next = new Float32Array(positions.length);
  const step = (factor: number) => {
    for (let v = 0; v < links.length; v++) {
      for (let axis = 0; axis < 3; axis++) {
        let mean = 0;
        for (const n of links[v]) mean += positions[n * 3 + axis];
        mean = links[v].length ? mean / links[v].length : positions[v * 3 + axis];
        next[v * 3 + axis] =
          positions[v * 3 + axis] + factor * (mean - positions[v * 3 + axis]);
      }
    }
    positions.set(next);
  };
  for (let pass = 0; pass < SMOOTHING_PASSES; pass++) {
    step(0.5);
    step(-0.53);
  }
}

function smoothNormals(positions: Float32Array, indices: ArrayLike<number>) {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [indices[i] * 3, indices[i + 1] * 3, indices[i + 2] * 3];
    const e1 = [0, 1, 2].map((k) => positions[b + k] - positions[a + k]);
    const e2 = [0, 1, 2].map((k) => positions[c + k] - positions[a + k]);
    const cross = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    for (const vertex of [a, b, c]) {
      for (let k = 0; k < 3; k++) normals[vertex + k] += cross[k];
    }
  }
  for (let v = 0; v < normals.length; v += 3) {
    const length = Math.hypot(normals[v], normals[v + 1], normals[v + 2]) || 1;
    for (let k = 0; k < 3; k++) normals[v + k] /= length;
  }
  return normals;
}

function distanceToLine(x: number, y: number, z: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < AORTA_LINE.length - 1; i++) {
    const [a, b] = [AORTA_LINE[i], AORTA_LINE[i + 1]];
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ap = [x - a[0], y - a[1], z - a[2]];
    const t = Math.min(
      1,
      Math.max(0, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) /
        (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2)),
    );
    best = Math.min(
      best,
      Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t),
    );
  }
  return best;
}

function tint(positions: Float32Array) {
  const colours = new Float32Array(positions.length);
  for (let v = 0; v < positions.length; v += 3) {
    const d = distanceToLine(positions[v], positions[v + 1], positions[v + 2]);
    const t = Math.min(1, Math.max(0, (AORTA_RADIUS * 1.3 - d) / (AORTA_RADIUS * 0.7)));
    const mix = t * t * (3 - 2 * t);
    for (let k = 0; k < 3; k++) {
      colours[v + k] = BODY_COLOUR[k] + (AORTA_COLOUR[k] - BODY_COLOUR[k]) * mix;
    }
  }
  return colours;
}

async function main() {
  const source = await new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .read(path.join(mainCheckout(), SOURCE));
  const primitive = source.getRoot().listMeshes()[0].listPrimitives()[0];

  const doc = new Document();
  const buffer = doc.createBuffer();
  const out = doc
    .createPrimitive()
    .setAttribute(
      "POSITION",
      doc
        .createAccessor()
        .setType("VEC3")
        .setArray(new Float32Array(primitive.getAttribute("POSITION")!.getArray()!))
        .setBuffer(buffer),
    )
    .setIndices(
      doc
        .createAccessor()
        .setType("SCALAR")
        .setArray(new Uint32Array(primitive.getIndices()!.getArray()!))
        .setBuffer(buffer),
    );
  doc.createScene("heart").addChild(
    doc.createNode("heart").setMesh(doc.createMesh("heart").addPrimitive(out)),
  );

  await MeshoptEncoder.ready;
  await MeshoptSimplifier.ready;
  await doc.transform(
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: 0.5, error: 0.01 }),
  );

  const positions = out.getAttribute("POSITION")!.getArray() as Float32Array<ArrayBuffer>;
  const indices = out.getIndices()!.getArray()!;
  taubin(positions, neighbours(indices, positions.length / 3));
  out.getAttribute("POSITION")!.setArray(positions);
  out
    .setAttribute(
      "NORMAL",
      doc.createAccessor().setType("VEC3").setArray(smoothNormals(positions, indices)).setBuffer(buffer),
    )
    .setAttribute(
      "COLOR_0",
      doc.createAccessor().setType("VEC3").setArray(tint(positions)).setBuffer(buffer),
    );

  await doc.transform(quantize(), meshopt({ encoder: MeshoptEncoder, level: "high" }));

  const io = new NodeIO()
    .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
    .registerDependencies({ "meshopt.encoder": MeshoptEncoder });
  const glb = await io.writeBinary(doc);
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, glb);
  writeFileSync(CREDIT_OUT, CREDIT);
  console.log(`${OUT}: ${(glb.length / 1024).toFixed(0)} KB, ${indices.length / 3} triangles`);
}

main();
