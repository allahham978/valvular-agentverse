"use client";

import { Canvas } from "@react-three/fiber";
import { ContactShadows } from "@react-three/drei";
import { useMainViewPaused } from "@/state/stage";
import { StudioLighting } from "./studio-lighting";
import { ROOT_LIFT, ROOT_SIZE, RootView } from "@/components/root-view";

export function HeartScene() {
  const paused = useMainViewPaused();
  return (
    <div data-testid="scene-area" className="absolute inset-0">
      <Canvas
        frameloop={paused ? "never" : "demand"}
        dpr={[1, 2]}
        camera={{ position: [0, 0, 6], fov: 35 }}
      >
        <StudioLighting />
        <RootView />
        <ContactShadows
          frames={1}
          position={[0, ROOT_LIFT - ROOT_SIZE / 2, 0]}
          opacity={0.2}
          blur={1.8}
          far={1.5}
          scale={7}
        />
      </Canvas>
    </div>
  );
}
