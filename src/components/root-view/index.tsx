"use client";

import { useDeferredValue, useEffect, useLayoutEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
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
import type { Design, FitResult } from "@/contracts";
import { ValveModel } from "@/components/valve-model";
import { splitLeaflets } from "./leaflets";
import { createWallColours, paintWall, WALL_ALPHA } from "./tint";
import { LANDING_URL, useMainRoot } from "./use-main-root";

export { RootCaption } from "./caption";

export const ROOT_URL = LANDING_URL;
export const ROOT_SIZE = 2.7;
export const ROOT_LIFT = 0.15;
const WALL_OPACITY = WALL_ALPHA;
const LEAFLET_FLOOR = 0.03;
// The sample mesh has a flat step in its rim, so land on the side where it faces away.
const LANDING_YAW = -1.4;
const LANDING_TILT = 0.3;

function createWallMaterial(side: typeof BackSide | typeof FrontSide, tinted = false) {
  return new MeshPhysicalMaterial({
    color: "#d3ece8",
    transparent: true,
    opacity: WALL_OPACITY,
    vertexColors: tinted,
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

function bakeToMillimetres(root: Object3D) {
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const source = object.geometry as BufferGeometry;
    const position = source.getAttribute("position");
    const floats = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      floats.set([position.getX(i), position.getY(i), position.getZ(i)], i * 3);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(floats, 3));
    if (source.index) geometry.setIndex(source.index.clone());
    geometry.applyMatrix4(object.matrixWorld);
    geometry.computeVertexNormals();
    object.geometry = geometry;
    object.position.set(0, 0, 0);
    object.quaternion.identity();
    object.scale.set(1, 1, 1);
    object.updateMatrix();
  });
}

function buildRoot(source: Object3D) {
  const clone = source.clone(true);
  bakeToMillimetres(clone);
  const meshes: Mesh[] = [];
  clone.traverse((object) => {
    if (object instanceof Mesh) meshes.push(object);
  });
  const wallMaterials: MeshPhysicalMaterial[] = [];
  const leafletMaterial = createLeafletMaterial();
  const prepassMaterial = new MeshBasicMaterial({ colorWrite: false, side: DoubleSide });
  const prepasses: Mesh[] = [];
  const wallGeometries: BufferGeometry[] = [];
  const leafletGeometries: BufferGeometry[] = [];
  const wallMeshes: Mesh[] = [];
  for (const mesh of meshes) {
    wallMeshes.push(mesh);
    const parts = splitLeaflets(mesh.geometry);
    createWallColours(parts.wall);
    wallGeometries.push(parts.wall);
    leafletGeometries.push(parts.leaflets);
    mesh.geometry = parts.wall;
    mesh.name = "root-wall";
    const back = createWallMaterial(BackSide, true);
    const front = createWallMaterial(FrontSide, true);
    mesh.material = back;
    mesh.renderOrder = 1;
    const frontMesh = new Mesh(parts.wall, front);
    frontMesh.renderOrder = 3;
    mesh.add(frontMesh);
    wallMaterials.push(back, front);

    const leaflets = new Mesh(parts.leaflets, leafletMaterial);
    leaflets.name = "root-leaflets";
    leaflets.renderOrder = 2;
    mesh.parent?.add(leaflets);

    const prepass = new Mesh(parts.leaflets, prepassMaterial);
    prepass.renderOrder = 1.9;
    prepasses.push(prepass);
    mesh.parent?.add(prepass);
  }
  const leafletBox = new Box3();
  for (const geometry of leafletGeometries) {
    geometry.computeBoundingBox();
    if (geometry.boundingBox) leafletBox.union(geometry.boundingBox);
  }
  const leafletCentre = leafletBox.getCenter(new Vector3()).toArray();
  const box = new Box3().setFromObject(clone);
  const size = box.getSize(new Vector3());
  const scale = ROOT_SIZE / Math.max(size.x, size.y, size.z);
  clone.scale.setScalar(scale);
  clone.position.copy(box.getCenter(new Vector3()).multiplyScalar(-scale));
  return {
    root: clone,
    leafletCentre: leafletCentre as [number, number, number],
    setHeart(heartId: string, fit: FitResult | undefined) {
      for (const mesh of wallMeshes) mesh.userData.heartId = heartId;
      for (const geometry of wallGeometries) paintWall(geometry, fit);
    },
    dispose() {
      for (const geometry of [...wallGeometries, ...leafletGeometries]) geometry.dispose();
      for (const material of [...wallMaterials, leafletMaterial, prepassMaterial]) material.dispose();
    },
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

function valveSizeMm(design: Design, fit: FitResult | undefined, annulusMm: number | undefined) {
  if (fit?.sizeMm !== undefined) return fit.sizeMm;
  if (!fit || annulusMm === undefined) return undefined;
  const sizes = design.sizes.map((size) => size.nominalMm);
  return sizes.sort((a, b) => Math.abs(a - annulusMm) - Math.abs(b - annulusMm))[0];
}

export function RootView({ visual }: { visual: { root: number; heart: number } }) {
  const shown = useDeferredValue(useMainRoot());
  const { scene } = useGLTF(shown.meshUrl);
  const { gl, camera, scene: world, invalidate } = useThree();
  const rig = useMemo(() => buildRoot(scene), [scene]);
  const heartId = shown.heart?.id ?? "";
  const sizeMm = valveSizeMm(shown.design, shown.fit, shown.heart?.measures.annulusMm);

  useEffect(
    () => () => {
      rig.dispose();
      scene.traverse((object) => {
        if (object instanceof Mesh) object.geometry.dispose();
      });
      useGLTF.clear(shown.meshUrl);
    },
    [rig, scene, shown.meshUrl],
  );

  useLayoutEffect(() => {
    rig.setHeart(heartId, shown.fit);
    invalidate();
  }, [rig, heartId, shown.fit, sizeMm, shown.design.id, invalidate]);

  useEffect(() => {
    gl.compile(world, camera);
  }, [gl, world, camera, rig]);

  useFrame(() => rig.setOpacity(visual.root, visual.heart));

  return (
    <group position={[0, ROOT_LIFT, 0]} rotation={[LANDING_TILT, LANDING_YAW, 0]}>
      <group rotation={[0, 0, Math.PI / 2]}>
        <primitive object={rig.root}>
          {sizeMm !== undefined && (
            <ValveModel sizeMm={sizeMm} designId={shown.design.id} position={rig.leafletCentre} visual={visual} />
          )}
        </primitive>
      </group>
    </group>
  );
}

if (typeof window !== "undefined") useGLTF.preload(ROOT_URL);
