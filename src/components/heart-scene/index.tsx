"use client";

import { Canvas } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer } from "@react-three/drei";
import { RootView } from "@/components/root-view";

export function HeartScene() {
  return (
    <div data-testid="scene-area" className="absolute inset-0">
      <Canvas
        frameloop="demand"
        dpr={[1, 2]}
        camera={{ position: [0, 0, 6], fov: 35 }}
      >
        <ambientLight intensity={0.4} />
        <directionalLight position={[3, 4, 5]} intensity={1.2} />
        <Environment resolution={64}>
          <Lightformer intensity={2} position={[0, 5, -5]} scale={[10, 4, 1]} />
          <Lightformer intensity={1} position={[-5, 1, 3]} scale={[4, 6, 1]} />
        </Environment>
        <RootView />
        <ContactShadows
          frames={1}
          position={[0, -1.9, 0]}
          opacity={0.25}
          blur={2.5}
          scale={10}
        />
      </Canvas>
    </div>
  );
}
