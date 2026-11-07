import { getStageProgress } from "@/state/stage";

const WHEEL_RANGE_PX = 2400;
const KEY_STEP = 0.25;
const LINE_PX = 16;

let target = 0;
const wakeListeners = new Set<() => void>();

export const getStageTarget = () => target;
export const syncStageTarget = () => {
  target = getStageProgress();
};
export const onStageWake = (listener: () => void) => {
  wakeListeners.add(listener);
  return () => {
    wakeListeners.delete(listener);
  };
};
export const prefersReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function setStageTarget(next: number) {
  const clamped = Math.min(1, Math.max(0, next));
  if (clamped === target) return;
  target = clamped;
  wakeListeners.forEach((listener) => listener());
}

// Reduced motion jumps straight to an end, because the scene crossfades there.
function nudgeStage(delta: number) {
  setStageTarget(prefersReducedMotion() ? (delta > 0 ? 1 : 0) : target + delta);
}

export const zoomToValve = () => setStageTarget(1);

const TEXT_FIELDS = "input, textarea, select, [contenteditable], [role=slider]";

export function attachStageInput(area: HTMLElement) {
  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey || event.deltaY === 0) return;
    event.preventDefault();
    const pixels = event.deltaMode === 1 ? event.deltaY * LINE_PX : event.deltaY;
    nudgeStage(pixels / WHEEL_RANGE_PX);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.target instanceof Element && event.target.closest(TEXT_FIELDS)) return;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") nudgeStage(KEY_STEP);
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") nudgeStage(-KEY_STEP);
  };
  area.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("keydown", onKey);
  return () => {
    area.removeEventListener("wheel", onWheel);
    window.removeEventListener("keydown", onKey);
  };
}
