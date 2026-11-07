"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import {
  Box3,
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  Object3D,
} from "three";
import {
  HEART_PLACEMENT,
  HEART_SCALE,
  VALVE_MARKER,
  type Visual,
} from "./stage-math";

export const HEART_URL = "/models/heart.glb";

const BEATS_PER_SECOND = 1;
const BEAT_SIZE = 0.035;
const TURN_RADIANS = 0.45;
const TURN_SPEED = 0.4;

function createHeartMaterial() {
  return new MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.5,
    metalness: 0,
    clearcoat: 0.45,
    clearcoatRoughness: 0.35,
    sheen: 0.5,
    sheenRoughness: 0.5,
    sheenColor: "#ffd9d6",
    envMapIntensity: 0.9,
  });
}

function createShadowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2d context");
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, "rgba(30, 42, 50, 0.34)");
  gradient.addColorStop(0.55, "rgba(30, 42, 50, 0.12)");
  gradient.addColorStop(1, "rgba(30, 42, 50, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  return new CanvasTexture(canvas);
}

function createHeartRig(scene: Object3D) {
  const colour = createHeartMaterial();
  const depth = new MeshPhysicalMaterial({ colorWrite: false });
  const depthMeshes: Mesh[] = [];
  const meshes: Mesh[] = [];
  scene.traverse((object) => {
    if (object instanceof Mesh) meshes.push(object);
  });
  for (const mesh of meshes) {
    mesh.material = colour;
    const prepass = new Mesh(mesh.geometry, depth);
    prepass.renderOrder = -1;
    prepass.visible = false;
    mesh.add(prepass);
    depthMeshes.push(prepass);
  }

  let fading = false;
  return {
    update(visual: Visual, outer: Group, heart: Group, shadow: Mesh) {
      outer.visible = visual.heart > 0;
      const seconds = performance.now() / 1000;
      const pulse = Math.pow(Math.sin(Math.PI * ((seconds * BEATS_PER_SECOND) % 1)), 6);
      heart.scale.setScalar(1 + BEAT_SIZE * pulse * visual.motion);
      heart.rotation.y = TURN_RADIANS * Math.sin(seconds * TURN_SPEED) * visual.motion;

      const nowFading = visual.heart < 1;
      if (nowFading !== fading) {
        fading = nowFading;
        colour.transparent = nowFading;
        colour.depthWrite = !nowFading;
        colour.needsUpdate = true;
        depthMeshes.forEach((mesh) => (mesh.visible = nowFading));
      }
      colour.opacity = visual.heart;
      (shadow.material as MeshBasicMaterial).opacity = visual.heart;
    },
    placeShadow(outer: Group, shadow: Mesh) {
      outer.updateMatrixWorld(true);
      shadow.position.y = new Box3().setFromObject(outer).min.y - 0.2;
    },
  };
}

export function HeartModel({ visual }: { visual: Visual }) {
  const { scene } = useGLTF(HEART_URL);
  const rig = useMemo(() => createHeartRig(scene), [scene]);
  const { gl, camera, scene: world, invalidate } = useThree();
  const outer = useRef<Group>(null);
  const model = useRef<Group>(null);
  const shadow = useRef<Mesh>(null);
  const shadowTexture = useMemo(() => createShadowTexture(), []);
  const drawn = useRef<"waiting" | "drawing" | "done">("waiting");

  useEffect(() => {
    gl.compile(world, camera);
    if (outer.current && shadow.current) rig.placeShadow(outer.current, shadow.current);
  }, [gl, world, camera, rig]);

  useFrame(() => {
    if (!outer.current || !model.current || !shadow.current) return;
    rig.update(visual, outer.current, model.current, shadow.current);

    const hook = window.__valvular;
    if (outer.current.visible && hook && drawn.current !== "done") {
      if (drawn.current === "waiting") {
        drawn.current = "drawing";
        invalidate();
      } else {
        drawn.current = "done";
        hook.firstHeartFrameMs = performance.now();
      }
    }
  });

  return (
    <>
      <group
        ref={outer}
        position={HEART_PLACEMENT.position}
        quaternion={HEART_PLACEMENT.quaternion}
        scale={HEART_SCALE}
      >
        <group ref={model} name="heart-model">
          <primitive object={scene as Object3D} />
          <group name="heart-valve" position={VALVE_MARKER} />
        </group>
      </group>
      <mesh ref={shadow} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-2}>
        <planeGeometry args={[7.5, 7.5]} />
        <meshBasicMaterial
          map={shadowTexture}
          transparent
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </>
  );
}

if (typeof window !== "undefined") useGLTF.preload(HEART_URL);
