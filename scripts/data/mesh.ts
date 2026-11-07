import { Document, NodeIO } from "@gltf-transform/core";
import { EXTMeshoptCompression, KHRMeshQuantization } from "@gltf-transform/extensions";
import { meshopt, quantize, simplify, weld } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";

export async function compressMesh(positions: Float32Array<ArrayBuffer>): Promise<Uint8Array> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const indices = Uint32Array.from({ length: positions.length / 3 }, (_, i) => i);
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
    simplify({ simplifier: MeshoptSimplifier, ratio: 0.7, error: 0.01, lockBorder: true }),
    quantize(),
    meshopt({ encoder: MeshoptEncoder, level: "high" }),
  );

  const io = new NodeIO()
    .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
    .registerDependencies({ "meshopt.encoder": MeshoptEncoder });
  return io.writeBinary(doc);
}
