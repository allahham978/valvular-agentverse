import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Document, NodeIO } from "@gltf-transform/core";
import { EXTMeshoptCompression, KHRMeshQuantization } from "@gltf-transform/extensions";
import { meshopt, quantize, simplify, weld } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

const ENTRY =
  "data_repository_Verstraeten_et_al_2023/virtual_cohort/Case_1.stl";
const OUT = "public/fixtures/root-sample.glb";

function mainCheckout(): string {
  const common = execFileSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { encoding: "utf8" },
  ).trim();
  return path.dirname(common);
}

async function main() {
  const zip = path.join(mainCheckout(), "data/raw/verstraeten.zip");
  const stl = execFileSync("unzip", ["-p", zip, ENTRY], {
    maxBuffer: 64 * 1024 * 1024,
  });
  const arrayBuffer = stl.buffer.slice(
    stl.byteOffset,
    stl.byteOffset + stl.byteLength,
  ) as ArrayBuffer;
  const positions = new Float32Array(
    new STLLoader().parse(arrayBuffer).getAttribute("position").array,
  );

  const doc = new Document();
  const buffer = doc.createBuffer();
  const vertexCount = positions.length / 3;
  const indices = Uint32Array.from({ length: vertexCount }, (_, i) => i);
  const primitive = doc
    .createPrimitive()
    .setAttribute(
      "POSITION",
      doc.createAccessor().setType("VEC3").setArray(positions).setBuffer(buffer),
    )
    .setIndices(
      doc.createAccessor().setType("SCALAR").setArray(indices).setBuffer(buffer),
    );
  const mesh = doc.createMesh("root").addPrimitive(primitive);
  doc.createScene("root").addChild(doc.createNode("root").setMesh(mesh));

  await MeshoptEncoder.ready;
  await MeshoptSimplifier.ready;
  await doc.transform(
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: 0.7, error: 0.01 }),
    quantize(),
    meshopt({ encoder: MeshoptEncoder, level: "high" }),
  );

  const io = new NodeIO()
    .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
    .registerDependencies({ "meshopt.encoder": MeshoptEncoder });
  const glb = await io.writeBinary(doc);
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, glb);
  console.log(`${OUT}: ${(glb.length / 1024).toFixed(0)} KB`);
}

main();
