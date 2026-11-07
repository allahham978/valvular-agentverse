import { useSyncExternalStore } from "react";

type Listener = () => void;

function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => value,
    set(next: T) {
      if (Object.is(next, value)) return;
      value = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const progress = createStore(0);
const mainHeart = createStore<string | null>(null);
const mainViewPaused = createStore(false);

export const getStageProgress = progress.get;
export const setStageProgress = (value: number) =>
  progress.set(Math.min(1, Math.max(0, value)));
export const subscribeStage = progress.subscribe;
export const useStageProgress = () =>
  useSyncExternalStore(progress.subscribe, progress.get, () => 0);

export const getMainHeartId = mainHeart.get;
export const setMainHeartId = mainHeart.set;
export const useMainHeartId = () =>
  useSyncExternalStore(mainHeart.subscribe, mainHeart.get, () => null);

export const setMainViewPaused = mainViewPaused.set;
export const useMainViewPaused = () =>
  useSyncExternalStore(mainViewPaused.subscribe, mainViewPaused.get, () => false);
