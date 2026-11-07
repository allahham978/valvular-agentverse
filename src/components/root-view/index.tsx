"use client";

import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { BackSide, Box3, FrontSide, Mesh, MeshPhysicalMaterial, Vector3 } from "three";
import { ValveModel } from "@/components/valve-model";

const ROOT_URL = "/fixtures/root-sample.glb";
export const ROOT_SIZE = 2.7;
export const ROOT_LIFT = 0.15;

function createWallMaterial(side: typeof BackSide | typeof FrontSide) {
  return new MeshPhysicalMaterial({
    color: "#cfe3e0",
    transparent: true,
    opacity: 0.3,
    roughness: 0.35,
    clearcoat: 0.4,
    side,
    depthWrite: false,
  });
}

export function RootView() {
  const { scene } = useGLTF(ROOT_URL);
  const root = useMemo(() => {
    const clone = scene.clone(true);
    const meshes: Mesh[] = [];
    clone.traverse((object) => {
      if (object instanceof Mesh) meshes.push(object);
    });
    for (const mesh of meshes) {
      mesh.geometry.computeVertexNormals();
      mesh.material = createWallMaterial(BackSide);
      mesh.renderOrder = 1;
      const front = new Mesh(mesh.geometry, createWallMaterial(FrontSide));
      front.renderOrder = 2;
      mesh.add(front);
    }
    const box = new Box3().setFromObject(clone);
    const size = box.getSize(new Vector3());
    const scale = ROOT_SIZE / Math.max(size.x, size.y, size.z);
    clone.scale.setScalar(scale);
    clone.position.copy(box.getCenter(new Vector3()).multiplyScalar(-scale));
    return clone;
  }, [scene]);

  return (
    <group position={[-0.9, ROOT_LIFT, 0]} rotation={[0, 0, Math.PI / 2]}>
      <primitive object={root} />
      <ValveModel />
    </group>
  );
}
