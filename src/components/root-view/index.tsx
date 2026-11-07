"use client";

import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { Box3, DoubleSide, Mesh, MeshPhysicalMaterial, Vector3 } from "three";
import { ValveModel } from "@/components/valve-model";

const ROOT_URL = "/fixtures/root-sample.glb";
const ROOT_SIZE = 3.1;

function createWallMaterial() {
  return new MeshPhysicalMaterial({
    color: "#9fc7c3",
    transparent: true,
    opacity: 0.5,
    roughness: 0.35,
    clearcoat: 0.4,
    side: DoubleSide,
    depthWrite: false,
  });
}

export function RootView() {
  const { scene } = useGLTF(ROOT_URL);
  const root = useMemo(() => {
    const clone = scene.clone(true);
    const material = createWallMaterial();
    clone.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.geometry.computeVertexNormals();
      object.material = material;
    });
    const box = new Box3().setFromObject(clone);
    const size = box.getSize(new Vector3());
    const scale = ROOT_SIZE / Math.max(size.x, size.y, size.z);
    clone.scale.setScalar(scale);
    clone.position.copy(box.getCenter(new Vector3()).multiplyScalar(-scale));
    return clone;
  }, [scene]);

  return (
    <group position={[-0.9, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
      <primitive object={root} />
      <ValveModel />
    </group>
  );
}
