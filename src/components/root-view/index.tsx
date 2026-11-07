"use client";

import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import {
  BackSide,
  Box3,
  Color,
  DoubleSide,
  FrontSide,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  Object3D,
  Vector3,
} from "three";
import { ValveModel } from "@/components/valve-model";
import { splitLeaflets } from "./leaflets";

export const ROOT_URL = "/fixtures/root-sample.glb";
export const ROOT_SIZE = 2.7;
export const ROOT_LIFT = 0.15;
const WALL_OPACITY = 0.16;
const LEAFLET_FLOOR = 0.03;
// The sample mesh has a flat step in its rim, so land on the side where it faces away.
const LANDING_YAW = -1.4;
const LANDING_TILT = 0.3;

function createWallMaterial(side: typeof BackSide | typeof FrontSide) {
  return new MeshPhysicalMaterial({
    color: "#d3ece8",
    transparent: true,
    opacity: WALL_OPACITY,
    roughness: 0.5,
    sheen: 1,
    sheenColor: new Color("#9fdcd2"),
    sheenRoughness: 0.35,
    envMapIntensity: 0.5,
    side,
    depthWrite: false,
  });
}

function createLeafletMaterial() {
  return new MeshPhysicalMaterial({
    color: "#f6eadc",
    emissive: "#f6eadc",
    emissiveIntensity: 0.15,
    roughness: 0.6,
    side: DoubleSide,
  });
}

export function createWallMeshes(root: Object3D) {
  const meshes: Mesh[] = [];
  root.traverse((object) => {
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
}

function buildRoot(source: Object3D) {
  const clone = source.clone(true);
  const meshes: Mesh[] = [];
  clone.traverse((object) => {
    if (object instanceof Mesh) meshes.push(object);
  });
  const wallMaterials: MeshPhysicalMaterial[] = [];
  const leafletMaterial = createLeafletMaterial();
  const prepassMaterial = new MeshBasicMaterial({ colorWrite: false, side: DoubleSide });
  const prepasses: Mesh[] = [];
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

    const prepass = new Mesh(parts.leaflets, prepassMaterial);
    prepass.renderOrder = 1.9;
    prepass.position.copy(leaflets.position);
    prepass.quaternion.copy(leaflets.quaternion);
    prepass.scale.copy(leaflets.scale);
    prepasses.push(prepass);
    mesh.parent?.add(prepass);
  }
  const box = new Box3().setFromObject(clone);
  const size = box.getSize(new Vector3());
  const scale = ROOT_SIZE / Math.max(size.x, size.y, size.z);
  clone.scale.setScalar(scale);
  clone.position.copy(box.getCenter(new Vector3()).multiplyScalar(-scale));
  return {
    root: clone,
    setOpacity(opacity: number, heart: number) {
      const overHeart = heart > 0;
      for (const material of [...wallMaterials, leafletMaterial, prepassMaterial]) material.depthTest = !overHeart;
      clone.visible = opacity > 0;
      for (const material of wallMaterials) material.opacity = WALL_OPACITY * opacity;
      const solid = opacity >= 1;
      for (const prepass of prepasses) prepass.visible = !solid && opacity > 0;
      leafletMaterial.opacity = opacity > 0 ? LEAFLET_FLOOR + (1 - LEAFLET_FLOOR) * opacity ** 2 : 0;
      if (leafletMaterial.transparent === solid) {
        leafletMaterial.transparent = !solid;
        leafletMaterial.depthWrite = solid;
        leafletMaterial.needsUpdate = true;
      }
    },
  };
}

export function RootView({ visual }: { visual: { root: number; heart: number } }) {
  const { scene } = useGLTF(ROOT_URL);
  const { gl, camera, scene: world } = useThree();
  const rig = useMemo(() => buildRoot(scene), [scene]);

  useEffect(() => {
    gl.compile(world, camera);
  }, [gl, world, camera]);

  useFrame(() => rig.setOpacity(visual.root, visual.heart));

  return (
    <group position={[0, ROOT_LIFT, 0]} rotation={[LANDING_TILT, LANDING_YAW, 0]}>
      <group rotation={[0, 0, Math.PI / 2]}>
        <primitive object={rig.root} />
        <ValveModel />
      </group>
    </group>
  );
}

if (typeof window !== "undefined") useGLTF.preload(ROOT_URL);
