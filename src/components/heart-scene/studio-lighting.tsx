import { Environment, Lightformer } from "@react-three/drei";

export function StudioLighting() {
  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight position={[3, 4, 5]} intensity={1.2} />
      <Environment resolution={64}>
        <Lightformer intensity={2} position={[0, 5, -5]} scale={[10, 4, 1]} />
        <Lightformer intensity={1} position={[-5, 1, 3]} scale={[4, 6, 1]} />
        <Lightformer intensity={6} position={[4, 2, 4]} rotation={[0, -0.6, 0]} scale={[0.6, 7, 1]} />
      </Environment>
    </>
  );
}
