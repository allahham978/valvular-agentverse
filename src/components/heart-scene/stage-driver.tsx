"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { CameraControls, CameraControlsImpl } from "@react-three/drei";
import { MathUtils, Vector3, type PerspectiveCamera } from "three";
import { getStageProgress, setStageProgress } from "@/state/stage";
import {
  getStageTarget,
  onStageWake,
  prefersReducedMotion,
  syncStageTarget,
} from "./stage-input";
import {
  FADE_END,
  HEART_POSE,
  ROOT_POSE,
  cameraPathAt,
  panelShiftAt,
  returnBlendAt,
  visualAt,
  type Visual,
} from "./stage-math";

const DAMPING = 5;
const MAX_STEP_SECONDS = 0.1;
const SNAP = 0.001;
const CROSSFADE_SECONDS = 0.4;
const PANEL_MARGIN = 24;

const { ACTION } = CameraControlsImpl;
const blendedPosition = new Vector3();
const blendedTarget = new Vector3();

declare global {
  interface Window {
    __valvular?: {
      scene: unknown;
      camera: unknown;
      frames: number;
      firstHeartFrameMs: number | null;
    };
  }
}

function nextProgress(current: number, target: number, seconds: number, reduced: boolean) {
  if (reduced) {
    const step = seconds / CROSSFADE_SECONDS;
    return current < target ? Math.min(target, current + step) : Math.max(target, current - step);
  }
  const next = MathUtils.damp(current, target, DAMPING, seconds);
  return Math.abs(next - target) < SNAP ? target : next;
}

function panelShift() {
  const column = document.querySelector("[data-testid=wall-panel]")?.parentElement;
  return column ? (column.offsetWidth + PANEL_MARGIN) / 2 : 0;
}

export function StageDriver({ visual }: { visual: Visual }) {
  const controls = useRef<CameraControlsImpl>(null);
  const { camera: baseCamera, scene, size, setFrameloop, invalidate, get } = useThree();
  const camera = baseCamera as PerspectiveCamera;
  const rootPose = useRef({ position: ROOT_POSE.position.clone(), target: ROOT_POSE.target.clone() });
  const atRoot = useRef(false);
  const viewShift = useRef({ free: 0, applied: Number.NaN });

  useEffect(() => {
    window.__valvular = { scene, camera, frames: 0, firstHeartFrameMs: null };
    syncStageTarget();
    return onStageWake(() => {
      setFrameloop("always");
      invalidate();
    });
  }, [scene, camera, setFrameloop, invalidate]);

  useEffect(() => {
    viewShift.current = { free: panelShift(), applied: Number.NaN };
  }, [size]);

  useEffect(() => {
    const impl = controls.current;
    if (!impl) return;
    impl.mouseButtons.wheel = ACTION.NONE;
    impl.mouseButtons.middle = ACTION.NONE;
    impl.mouseButtons.right = ACTION.NONE;
    impl.touches.two = ACTION.NONE;
    impl.touches.three = ACTION.NONE;
    impl.minPolarAngle = 0.6;
    impl.maxPolarAngle = Math.PI - 0.6;
    impl.smoothTime = 0.2;
    impl.draggingSmoothTime = 0.08;
  }, []);

  useFrame((_, delta) => {
    const impl = controls.current;
    if (!impl) return;
    if (window.__valvular) window.__valvular.frames++;

    const reduced = prefersReducedMotion();
    const target = getStageTarget();
    const progress = nextProgress(
      getStageProgress(),
      target,
      Math.min(delta, MAX_STEP_SECONDS),
      reduced,
    );
    setStageProgress(progress);
    Object.assign(visual, visualAt(progress, reduced));

    const pose = reduced ? (progress < 0.5 ? 0 : 1) : progress === 1 ? 1 : cameraPathAt(progress);
    if (pose < 1) {
      if (atRoot.current) {
        impl.getPosition(rootPose.current.position);
        impl.getTarget(rootPose.current.target);
        atRoot.current = false;
      }
      const blend = returnBlendAt(progress);
      blendedPosition.copy(rootPose.current.position).lerp(ROOT_POSE.position, blend);
      blendedTarget.copy(rootPose.current.target).lerp(ROOT_POSE.target, blend);
      if (pose === 0) {
        rootPose.current.position.copy(ROOT_POSE.position);
        rootPose.current.target.copy(ROOT_POSE.target);
      }
      const { position: a, target: at } = HEART_POSE;
      const { position: b, target: bt } = { position: blendedPosition, target: blendedTarget };
      impl.lerpLookAt(a.x, a.y, a.z, at.x, at.y, at.z, b.x, b.y, b.z, bt.x, bt.y, bt.z, pose, false);
    } else if (!atRoot.current) {
      const { position: p, target: t } = rootPose.current;
      impl.setLookAt(p.x, p.y, p.z, t.x, t.y, t.z, false);
      atRoot.current = true;
    }
    impl.mouseButtons.left = pose === 1 ? ACTION.ROTATE : ACTION.NONE;
    impl.touches.one = pose === 1 ? ACTION.TOUCH_ROTATE : ACTION.NONE;

    const shift = viewShift.current.free * (reduced ? pose : panelShiftAt(progress));
    if (shift !== viewShift.current.applied) {
      viewShift.current.applied = shift;
      if (shift === 0) camera.clearViewOffset();
      else camera.setViewOffset(size.width, size.height, shift, 0, size.width, size.height);
    }

    const settled = progress === target;
    if (settled && (reduced || progress >= FADE_END) && get().frameloop !== "demand") {
      setFrameloop("demand");
    }
  }, -2);

  return <CameraControls ref={controls} makeDefault />;
}
