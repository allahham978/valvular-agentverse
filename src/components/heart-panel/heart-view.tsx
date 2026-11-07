"use client";

import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import { Box3, DoubleSide, Mesh, MeshStandardMaterial, Vector3 } from "three";

const SIZE = 2.7;

function Root({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  const root = useMemo(() => {
    const clone = scene.clone(true);
    const material = new MeshStandardMaterial({
      color: "#5fb8ad",
      transparent: true,
      opacity: 0.55,
      roughness: 0.35,
      side: DoubleSide,
      depthWrite: false,
    });
    clone.traverse((object) => {
      if (object instanceof Mesh) object.material = material;
    });
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
    <Canvas frameloop="demand" dpr={[1, 2]} camera={{ position: [0, 0, 6], fov: 35 }}>
      <ambientLight intensity={0.9} />
      <directionalLight position={[3, 4, 5]} intensity={1.6} />
      <Root url={meshUrl} />
      <OrbitControls enableZoom={false} enablePan={false} enableDamping={false} />
    </Canvas>
  );
}
