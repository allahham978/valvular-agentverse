"use client";

import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import {
  BackSide,
  Box3,
  DoubleSide,
  FrontSide,
  Mesh,
  MeshPhysicalMaterial,
  Object3D,
  Vector3,
} from "three";
import { ValveModel } from "@/components/valve-model";
import { splitLeaflets } from "./leaflets";

export const ROOT_URL = "/fixtures/root-sample.glb";
export const ROOT_SIZE = 2.7;
export const ROOT_LIFT = 0.15;
const WALL_OPACITY = 0.2;

function createWallMaterial(side: typeof BackSide | typeof FrontSide) {
  return new MeshPhysicalMaterial({
    color: "#5fb8ad",
    transparent: true,
    opacity: WALL_OPACITY,
    roughness: 0.12,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
    envMapIntensity: 1.6,
    side,
    depthWrite: false,
  });
}

function createLeafletMaterial() {
  return new MeshPhysicalMaterial({
    color: "#f6f1ea",
    emissive: "#f6f1ea",
    emissiveIntensity: 0.22,
    roughness: 0.55,
    clearcoat: 0.3,
    clearcoatRoughness: 0.4,
    side: DoubleSide,
  });
}

function buildRoot(source: Object3D) {
  const clone = source.clone(true);
  const meshes: Mesh[] = [];
  clone.traverse((object) => {
    if (object instanceof Mesh) meshes.push(object);
  });
  const wallMaterials: MeshPhysicalMaterial[] = [];
  const leafletMaterial = createLeafletMaterial();
  for (const mesh of meshes) {
    mesh.geometry.computeVertexNormals();
    const parts = splitLeaflets(mesh.geometry);
    mesh.geometry = parts.wall;
    mesh.name = "root-wall";
    const back = createWallMaterial(BackSide);
    const front = createWallMaterial(FrontSide);
    mesh.material = back;
    mesh.renderOrder = 1;
    const frontMesh = new Mesh(parts.wall, front);
    frontMesh.renderOrder = 3;
    mesh.add(frontMesh);
    wallMaterials.push(back, front);

    const leaflets = new Mesh(parts.leaflets, leafletMaterial);
    leaflets.name = "root-leaflets";
    leaflets.renderOrder = 2;
    leaflets.position.copy(mesh.position);
    leaflets.quaternion.copy(mesh.quaternion);
    leaflets.scale.copy(mesh.scale);
    mesh.parent?.add(leaflets);
  }
  const box = new Box3().setFromObject(clone);
  const size = box.getSize(new Vector3());
  const scale = ROOT_SIZE / Math.max(size.x, size.y, size.z);
  clone.scale.setScalar(scale);
  clone.position.copy(box.getCenter(new Vector3()).multiplyScalar(-scale));
  return {
    root: clone,
    setOpacity(opacity: number) {
      clone.visible = opacity > 0;
      for (const material of wallMaterials) material.opacity = WALL_OPACITY * opacity;
      const solid = opacity >= 1;
      leafletMaterial.opacity = opacity;
      if (leafletMaterial.transparent === solid) {
        leafletMaterial.transparent = !solid;
        leafletMaterial.depthWrite = solid;
        leafletMaterial.needsUpdate = true;
      }
    },
  };
}

export function RootView({ visual }: { visual: { root: number } }) {
  const { scene } = useGLTF(ROOT_URL);
  const { gl, camera, scene: world } = useThree();
  const rig = useMemo(() => buildRoot(scene), [scene]);

  useEffect(() => {
    gl.compile(world, camera);
  }, [gl, world, camera]);

  useFrame(() => rig.setOpacity(visual.root));

  return (
    <group position={[0, ROOT_LIFT, 0]} rotation={[0, 0, Math.PI / 2]}>
      <primitive object={rig.root} />
      <ValveModel />
    </group>
  );
}

if (typeof window !== "undefined") useGLTF.preload(ROOT_URL);
