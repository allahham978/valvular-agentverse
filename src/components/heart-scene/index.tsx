"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import {
  AdaptiveDpr,
  ContactShadows,
  Environment,
  Lightformer,
  PerformanceMonitor,
} from "@react-three/drei";
import type { Group, Mesh, MeshBasicMaterial } from "three";
import { ROOT_LIFT, ROOT_SIZE, RootView } from "@/components/root-view";
import { subscribeStage } from "@/state/stage";
import { HeartModel } from "./heart-model";
import { OpeningUi } from "./opening-ui";
import { attachStageInput } from "./stage-input";
import { StageDriver } from "./stage-driver";
import type { Visual } from "./stage-math";

const ROOT_SHADOW_OPACITY = 0.2;

function RootShadow({ visual }: { visual: Visual }) {
  const group = useRef<Group>(null);
  const [mounted, setMounted] = useState(false);

  // Baked once, after the heart is hidden, so the heart never casts into it.
  useEffect(
    () =>
      subscribeStage(() => {
        if (visual.heart === 0) setMounted(true);
      }),
    [visual],
  );

  useFrame(() => {
    group.current?.traverse((object) => {
      const material = (object as Mesh).material as MeshBasicMaterial | undefined;
      if (material?.isMeshBasicMaterial) material.opacity = ROOT_SHADOW_OPACITY * visual.root;
    });
  });

  if (!mounted) return null;
  return (
    <group ref={group}>
      <ContactShadows
        frames={1}
        position={[0, ROOT_LIFT - ROOT_SIZE / 2, 0]}
        opacity={ROOT_SHADOW_OPACITY}
        blur={1.8}
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

  useEffect(() => (area.current ? attachStageInput(area.current) : undefined), []);

  return (
    <div ref={area} data-testid="scene-area" className="absolute inset-0">
      <Canvas
        frameloop="always"
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
