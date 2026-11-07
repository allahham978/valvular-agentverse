"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  AdaptiveDpr,
  ContactShadows,
  Environment,
  Lightformer,
  PerformanceMonitor,
} from "@react-three/drei";
import type { Group, Mesh, MeshBasicMaterial } from "three";
import { useMainViewPaused } from "@/state/stage";
import { ROOT_LIFT, ROOT_SIZE, RootView } from "@/components/root-view";
import { HeartModel } from "./heart-model";
import { OpeningUi } from "./opening-ui";
import { attachStageInput } from "./stage-input";
import { StageDriver } from "./stage-driver";
import type { Visual } from "./stage-math";

const ROOT_SHADOW_OPACITY = 0.14;
const SHADOW_FADE_SECONDS = 0.6;

function RootShadow({ visual }: { visual: Visual }) {
  const group = useRef<Group>(null);
  const fade = useRef(0);
  const [mounted, setMounted] = useState(false);
  const { invalidate } = useThree();

  // Baked once, after the heart is hidden, so the heart never casts into it. This holds on any path,
  // including a direct load of the workspace.
  useFrame((_, delta) => {
    if (!mounted) {
      if (visual.heart === 0) setMounted(true);
      return;
    }
    fade.current = Math.min(1, fade.current + delta / SHADOW_FADE_SECONDS);
    const opacity = ROOT_SHADOW_OPACITY * visual.root * fade.current;
    group.current?.traverse((object) => {
      const material = (object as Mesh).material as MeshBasicMaterial | undefined;
      if (material?.isMeshBasicMaterial) material.opacity = opacity;
    });
    if (fade.current < 1) invalidate();
  });

  useEffect(() => {
    if (mounted) invalidate();
  }, [mounted, invalidate]);

  if (!mounted) return null;
  return (
    <group ref={group}>
      <ContactShadows
        frames={1}
        position={[0, ROOT_LIFT - ROOT_SIZE / 2, 0]}
        opacity={ROOT_SHADOW_OPACITY}
        blur={2.4}
        far={1.5}
        scale={7}
      />
    </group>
  );
}

export function HeartScene() {
  const area = useRef<HTMLDivElement>(null);
  const [visual] = useState<Visual>({ heart: 1, root: 0, motion: 1 });
  const [maxDpr, setMaxDpr] = useState(2);
  const paused = useMainViewPaused();

  useEffect(() => (area.current ? attachStageInput(area.current) : undefined), []);

  return (
    <div ref={area} data-testid="scene-area" className="absolute inset-0">
      <Canvas
        frameloop={paused ? "never" : "always"}
        dpr={[1, maxDpr]}
        camera={{ position: [0, 0, 6], fov: 35, near: 0.5, far: 80 }}
      >
        <PerformanceMonitor
          flipflops={3}
          onChange={({ factor }) => setMaxDpr(Math.max(1, Math.min(2, 1 + 2 * factor)))}
        />
        <AdaptiveDpr />
        <StageDriver visual={visual} />
        <ambientLight intensity={0.4} />
        <directionalLight position={[3, 4, 5]} intensity={1.2} />
        <Environment resolution={64}>
          <Lightformer intensity={2} position={[0, 5, -5]} scale={[10, 4, 1]} />
          <Lightformer intensity={1} position={[-5, 1, 3]} scale={[4, 6, 1]} />
          <Lightformer intensity={6} position={[4, 2, 4]} rotation={[0, -0.6, 0]} scale={[0.6, 7, 1]} />
        </Environment>
        <Suspense fallback={null}>
          <HeartModel visual={visual} />
        </Suspense>
        <Suspense fallback={null}>
          <RootView visual={visual} />
        </Suspense>
        <RootShadow visual={visual} />
      </Canvas>
      <OpeningUi />
    </div>
  );
}
