import { useSyncExternalStore } from "react";
import { FitResultSchema, type FitResult, type Heart } from "@/contracts";
import { loadWallData } from "./data-source";

export type WallState = {
  ready: boolean;
  label: string | null;
  hearts: Map<string, Heart>;
  results: FitResult[];
  indexById: Map<string, number>;
};

const EMPTY: WallState = {
  ready: false,
  label: null,
  hearts: new Map(),
  results: [],
  indexById: new Map(),
};

let state = EMPTY;
let started = false;
const listeners = new Set<() => void>();

function setState(next: WallState) {
  state = next;
  listeners.forEach((listener) => listener());
}

export function applyFitResults(changed: FitResult[]) {
  const results = [...state.results];
  let didChange = false;
  for (const result of changed) {
    const index = state.indexById.get(result.heartId);
    if (index === undefined) continue;
    if (JSON.stringify(results[index]) === JSON.stringify(result)) continue;
    results[index] = result;
    didChange = true;
  }
  if (didChange) setState({ ...state, results });
}

function onFitResults(event: Event) {
  const parsed = FitResultSchema.array().safeParse(
    (event as CustomEvent<{ results: unknown }>).detail?.results,
  );
  if (parsed.success) applyFitResults(parsed.data);
}

function start() {
  if (started) return;
  started = true;
  window.addEventListener("valvular:fit-results", onFitResults);
  void loadWallData().then(({ label, hearts, results }) =>
    setState({
      ready: true,
      label,
      hearts: new Map(hearts.map((heart) => [heart.id, heart])),
      results,
      indexById: new Map(results.map((result, index) => [result.heartId, index])),
    }),
  );
}

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const useWallData = () =>
  useSyncExternalStore(subscribe, () => state, () => EMPTY);
