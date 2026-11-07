"use client";

import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import { Box3, Vector3 } from "three";
import { StudioLighting } from "@/components/heart-scene/studio-lighting";
import { createWallMeshes } from "@/components/root-view";

const SIZE = 3;

function Root({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  const root = useMemo(() => {
    const clone = scene.clone(true);
    createWallMeshes(clone);
    const box = new Box3().setFromObject(clone);
    const scale = SIZE / Math.max(...box.getSize(new Vector3()).toArray());
    clone.scale.setScalar(scale);
    clone.position.copy(box.getCenter(new Vector3()).multiplyScalar(-scale));
    return clone;
  }, [scene]);

  return (
    <group rotation={[0, 0, Math.PI / 2]}>
      <primitive object={root} />
    </group>
  );
}

export function HeartView({ meshUrl }: { meshUrl: string }) {
  return (
    <>
      <Canvas frameloop="demand" dpr={[1, 2]} camera={{ position: [0, 0, 6], fov: 35 }}>
        <StudioLighting />
        <Root url={meshUrl} />
        <OrbitControls enableZoom={false} enablePan={false} enableDamping={false} />
      </Canvas>
      <p className="mono pointer-events-none absolute inset-x-0 bottom-2 text-center text-[11px] text-muted min-[1800px]:text-sm">
        Drag to rotate
      </p>
    </>
  );
}
