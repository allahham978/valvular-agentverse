import { MathUtils, Quaternion, Vector3 } from "three";

export const smoothstep = (from: number, to: number, value: number) =>
  MathUtils.smoothstep(value, from, to);

export const FADE_START = 0.35;
export const FADE_END = 0.65;

export type Visual = { heart: number; root: number; motion: number };

export function visualAt(progress: number, reduced: boolean): Visual {
  if (reduced) {
    return {
      heart: 1 - smoothstep(0, 0.55, progress),
      root: smoothstep(0.45, 1, progress),
      motion: 0,
    };
  }
  const fade = smoothstep(FADE_START, FADE_END, progress);
  return { heart: 1 - fade, root: fade, motion: 1 - smoothstep(0, 0.6, progress) };
}

const CAMERA_EASE = 3;
const RETURN_FROM = 0.75;
const PANEL_SHIFT_FROM = 0.8;

// Eases out, so the camera has closed in on the aortic base by the time the heart is gone.
export const cameraPathAt = (progress: number) => 1 - Math.pow(1 - progress, CAMERA_EASE);

// Blend a rotated end pose back to the default one while scrolling out.
export const returnBlendAt = (progress: number) => 1 - smoothstep(RETURN_FROM, 1, progress);

// Hold the view centred until the panels arrive.
export const panelShiftAt = (progress: number) => smoothstep(PANEL_SHIFT_FROM, 1, progress);

const UP = new Vector3(0, 1, 0);

export const HEART_SCALE = 9.2;
export const VALVE_MARKER = new Vector3(0.08, 0, 0.03);
const VALVE_AXIS = new Vector3(0.024, 0.932, 0.361).normalize();
const VALVE_WORLD = new Vector3(0, -0.53, 0);

// Model +X is the front. Yaw it to the camera, then tilt the valve axis to world up.
function heartPlacement() {
  const yaw = new Quaternion().setFromAxisAngle(UP, -Math.PI / 2);
  const tilt = new Quaternion().setFromUnitVectors(VALVE_AXIS.clone().applyQuaternion(yaw), UP);
  const quaternion = tilt.multiply(yaw);
  const position = VALVE_WORLD.clone().sub(
    VALVE_MARKER.clone().multiplyScalar(HEART_SCALE).applyQuaternion(quaternion),
  );
  return { quaternion, position };
}

export const HEART_PLACEMENT = heartPlacement();

export const ROOT_POSE = {
  position: new Vector3(0, 0, 6),
  target: new Vector3(0, 0, 0),
};
export const HEART_POSE = {
  position: HEART_PLACEMENT.position.clone().add(new Vector3(0, -0.75, 21.5)),
  target: HEART_PLACEMENT.position.clone().add(new Vector3(0, -0.75, 0)),
};
