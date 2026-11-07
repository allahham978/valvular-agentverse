"use client";

import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { BackSide, Box3, FrontSide, Mesh, MeshPhysicalMaterial, Vector3 } from "three";
import { ValveModel } from "@/components/valve-model";
import { useStageProgress } from "@/state/stage";

const ROOT_URL = "/fixtures/root-sample.glb";
export const ROOT_SIZE = 2.7;
export const ROOT_LIFT = 0.15;
const PANEL_MARGIN = 24;

function createWallMaterial(side: typeof BackSide | typeof FrontSide) {
  return new MeshPhysicalMaterial({
    color: "#5fb8ad",
    transparent: true,
    opacity: 0.2,
    roughness: 0.12,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
    envMapIntensity: 1.6,
    side,
    depthWrite: false,
  });
}

function useCentreInFreeArea() {
  const { camera, size, invalidate } = useThree();
  const progress = useStageProgress();
  useEffect(() => {
    const column = document.querySelector("[data-testid=wall-panel]")?.parentElement;
    const shift = column ? (column.offsetWidth + PANEL_MARGIN) / 2 : 0;
    camera.setViewOffset(size.width, size.height, shift * progress, 0, size.width, size.height);
    invalidate();
    return () => camera.clearViewOffset();
  }, [camera, size, progress, invalidate]);
}

export function RootView() {
  useCentreInFreeArea();
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
    <group position={[0, ROOT_LIFT, 0]} rotation={[0, 0, Math.PI / 2]}>
      <primitive object={root} />
      <ValveModel />
    </group>
  );
}
