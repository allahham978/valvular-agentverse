import { useSyncExternalStore } from "react";
import { RunEventSchema, SummarySchema, type FitResult, type RunEvent } from "@/contracts";
import { demoRequest } from "@/components/controls/demo-script";
import { sampleNewRisk } from "./sample-new-risk";

export type Phase = "idle" | "breaking" | "broken" | "fixing" | "done";
export type RunView = { phase: Phase; events: RunEvent[]; sample: boolean; runId: string | null };

const REVEAL_MS = 250;
const HIDDEN_TYPES = new Set(["run-start", "step-start", "run-stop"]);
const IDLE: RunView = { phase: "idle", events: [], sample: false, runId: null };

let view = IDLE;
const received: RunEvent[] = [];
let shown = 0;
let started = false;
let released = false;
let stopped = false;
let source: EventSource | undefined;
let runId: string | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

const held = (event: RunEvent | undefined) => !released && event?.actor === "fixer";

function phase(): Phase {
  if (!started) return "idle";
  const drained = shown >= received.length;
  if (!released) return held(received[shown]) || (drained && stopped) ? "broken" : "breaking";
  return drained && stopped ? "done" : "fixing";
}

function publish() {
  const events = received.slice(0, shown).filter((event) => !HIDDEN_TYPES.has(event.type));
  view = { phase: phase(), events, sample: started && received.every((event) => event.mode === "replay"), runId };
  listeners.forEach((listener) => listener());
}

function dispatchRisk(results: FitResult[]) {
  window.dispatchEvent(new CustomEvent("valvular:fit-results", { detail: { results } }));
}

function onRevealed(event: RunEvent) {
  const data = event.data as { improved?: boolean; designId?: string; summary?: unknown } | null;
  if (event.type !== "evaluation" || !data?.improved || !data.designId) return;
  const summary = SummarySchema.safeParse(data.summary);
  const ids = summary.success ? summary.data.newRiskHeartIds : [];
  const fallback = sampleNewRisk(data.designId);
  dispatchRisk(
    ids.length === 0
      ? fallback
      : ids.map((heartId) => ({ heartId, designId: data.designId!, status: "risk", reasons: [] })),
  );
}

function revealNext() {
  timer = undefined;
  while (shown < received.length && !held(received[shown])) {
    const event = received[shown++];
    if (HIDDEN_TYPES.has(event.type)) continue;
    onRevealed(event);
    break;
  }
  publish();
  schedule();
}

function schedule() {
  if (timer === undefined && shown < received.length && !held(received[shown])) {
    timer = setTimeout(revealNext, REVEAL_MS);
  }
}

function receive(event: RunEvent) {
  if (received.some((known) => known.seq === event.seq)) return;
  received.push(event);
  if (event.type === "run-stop") {
    stopped = true;
    source?.close();
  }
  publish();
  schedule();
}

async function begin(request: unknown) {
  started = true;
  publish();
  try {
    const response = await fetch("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!response.ok) throw new Error(`POST /api/runs ${response.status}`);
    const { id } = (await response.json()) as { id: string };
    runId = id;
    source = new EventSource(`/api/runs/${id}/events`);
    source.onmessage = (message) => receive(RunEventSchema.parse(JSON.parse(message.data)));
  } catch {
    stopped = true;
    publish();
  }
}

export function startRun() {
  if (!started) return begin(demoRequest);
}

export function startReplay(replayId: string) {
  source?.close();
  clearTimeout(timer);
  timer = undefined;
  received.length = 0;
  shown = 0;
  released = false;
  stopped = false;
  runId = null;
  return begin({ replayId });
}

export function releaseFix() {
  if (view.phase !== "broken") return;
  released = true;
  publish();
  schedule();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const useRun = () => useSyncExternalStore(subscribe, () => view, () => IDLE);
