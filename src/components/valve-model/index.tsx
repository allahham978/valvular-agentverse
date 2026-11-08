"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Color, CylinderGeometry, DoubleSide, Group, MeshStandardMaterial, TorusGeometry, BoxGeometry } from "three";

const ACCENT = "#0f766e";
const TUBE = 0.035;
const BAND_HEIGHT = 0.26;
const POST_HEIGHT = 0.5;
const FLOOR = 0.03;

export type ValveProps = {
  sizeMm: number;
  designId: string;
  position: [number, number, number];
  visual: { root: number; heart: number };
};

function fade(material: MeshStandardMaterial, { root, heart }: ValveProps["visual"]) {
  const solid = root >= 1;
  material.depthTest = heart <= 0;
  material.opacity = root > 0 ? FLOOR + (1 - FLOOR) * root ** 2 : 0;
  if (material.transparent === solid) {
    material.transparent = !solid;
    material.depthWrite = solid;
    material.needsUpdate = true;
  }
}

export function ValveModel({ sizeMm, designId, position, visual }: ValveProps) {
  const group = useRef<Group>(null);
  const radius = sizeMm * (0.5 - TUBE);
  const tube = sizeMm * TUBE;
  const material = useMemo(
    () => new MeshStandardMaterial({ color: new Color(ACCENT), roughness: 0.45, metalness: 0.1, side: DoubleSide }),
    [],
  );
  const parts = useMemo(
    () => ({
      band: new CylinderGeometry(radius, radius, sizeMm * BAND_HEIGHT, 48, 1, true),
      ring: new TorusGeometry(radius, tube, 12, 48),
      post: new BoxGeometry(tube * 1.6, sizeMm * POST_HEIGHT, tube * 1.6),
    }),
    [radius, tube, sizeMm],
  );

  useEffect(() => () => Object.values(parts).forEach((geometry) => geometry.dispose()), [parts]);
  useEffect(() => () => material.dispose(), [material]);

  useFrame(() => {
    fade(material, visual);
    if (group.current) group.current.visible = visual.root > 0;
  });

  const half = (sizeMm * BAND_HEIGHT) / 2;
  const shift = -(sizeMm * POST_HEIGHT) / 4;
  return (
    <group
      ref={group}
      name="schematic-valve"
      userData={{ sizeMm, designId }}
      position={position}
      rotation={[0, 0, -Math.PI / 2]}
    >
      <group position={[0, shift, 0]}>
        <mesh geometry={parts.band} material={material} />
        <mesh geometry={parts.ring} material={material} position={[0, half, 0]} rotation={[Math.PI / 2, 0, 0]} />
        <mesh geometry={parts.ring} material={material} position={[0, -half, 0]} rotation={[Math.PI / 2, 0, 0]} />
        {[0, 1, 2].map((k) => {
          const angle = (k * 2 * Math.PI) / 3;
          return (
            <mesh
              key={k}
              geometry={parts.post}
              material={material}
              position={[radius * Math.cos(angle), -half + (sizeMm * POST_HEIGHT) / 2, radius * Math.sin(angle)]}
            />
          );
        })}
      </group>
    </group>
  );
}
