import { useSyncExternalStore } from "react";
import { DesignSchema, FitResultSchema, RunEventSchema, SummarySchema, type FitResult, type RunEvent } from "@/contracts";

export type Phase = "idle" | "breaking" | "broken" | "fixing" | "done";
export type RunView = {
  phase: Phase;
  events: RunEvent[];
  sample: boolean;
  labelled: boolean;
  runId: string | null;
  newRisk: number | null;
};

const REVEAL_MS = 250;
const HIDDEN_TYPES = new Set(["run-start", "step-start", "run-stop"]);
const IDLE: RunView = { phase: "idle", events: [], sample: false, labelled: false, runId: null, newRisk: null };

let view = IDLE;
const received: RunEvent[] = [];
let shown = 0;
let started = false;
let labelled = false;
let released = false;
let stopped = false;
let source: EventSource | undefined;
let runId: string | null = null;
let newRisk: number | null = null;
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
  const sample = started && received.every((event) => event.mode === "replay");
  view = { phase: phase(), events, sample, labelled: sample && labelled, runId, newRisk };
  listeners.forEach((listener) => listener());
}

function dispatchRisk(results: FitResult[]) {
  window.dispatchEvent(new CustomEvent("valvular:fit-results", { detail: { results } }));
}

async function showImprovedDesign(designId: string) {
  const proposal = received.find(
    (event) => event.type === "proposal" && (event.data as { design?: { id?: string } } | null)?.design?.id === designId,
  );
  const design = DesignSchema.safeParse((proposal?.data as { design?: unknown } | null)?.design);
  if (!design.success) return;
  try {
    const response = await fetch("/api/fit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ design: design.data }),
    });
    if (!response.ok) return;
    const body = (await response.json()) as { results: unknown; summary: unknown };
    newRisk = SummarySchema.parse(body.summary).newRiskHeartIds.length;
    dispatchRisk(FitResultSchema.array().parse(body.results));
    publish();
  } catch {
    // The feed already shows the code's verdict; the wall just keeps its last state.
  }
}

function onRevealed(event: RunEvent) {
  const data = event.data as { improved?: boolean; designId?: string } | null;
  if (event.type === "evaluation" && data?.improved && data.designId) void showImprovedDesign(data.designId);
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

const LIVE_REQUEST = { model: { kind: "gemini" }, demo: true } as const;

export function startRun() {
  if (started) return;
  const live = new URLSearchParams(window.location.search).get("mode") === "live";
  return begin(live ? LIVE_REQUEST : { replayId: "demo" });
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
  newRisk = null;
  labelled = true;
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
