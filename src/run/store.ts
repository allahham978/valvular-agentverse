import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { RunSchema, type Run, type RunEvent } from "../contracts";
import { executeRun, type ExecuteRunOptions } from "../orchestrator";

export type RunStatus = "running" | "finished" | "interrupted";
export type RunView = { status: RunStatus; run: Run };
type Listener = (event: RunEvent) => void;
type ActiveRun = { run: Run | null; listeners: Set<Listener> };

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const globals = globalThis as { __valvularActiveRuns?: Map<string, ActiveRun> };
const active = (globals.__valvularActiveRuns ??= new Map());

export const isRunId = (id: string) => ID_PATTERN.test(id);

function runsDir() {
  return process.env.VALVULAR_RUNS_DIR ?? path.join(tmpdir(), "valvular-runs");
}

function persist(run: Run) {
  if (!isRunId(run.id)) throw new Error("Invalid run ID.");
  const dir = runsDir();
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${run.id}.json`);
  const temp = `${file}.tmp`;
  writeFileSync(temp, JSON.stringify(run));
  renameSync(temp, file);
}

function load(id: string): Run | null {
  if (!isRunId(id)) return null;
  try {
    const parsed = RunSchema.safeParse(JSON.parse(readFileSync(path.join(runsDir(), `${id}.json`), "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export const hasFinished = (run: Run) => run.events.at(-1)?.type === "run-stop";

export function getRunView(id: string): RunView | null {
  const live = active.get(id)?.run;
  if (live) return { status: hasFinished(live) ? "finished" : "running", run: live };
  const run = load(id);
  if (!run) return null;
  return { status: hasFinished(run) ? "finished" : "interrupted", run };
}

export function startRun(options: Omit<ExecuteRunOptions, "id" | "onEvent">): string {
  const id = crypto.randomUUID();
  const entry: ActiveRun = { run: null, listeners: new Set() };
  active.set(id, entry);
  executeRun({
    ...options,
    id,
    onEvent(run, event) {
      entry.run = run;
      try {
        persist(run);
      } catch {
        // Notify listeners even when the disk write fails.
      }
      for (const listener of entry.listeners) listener(event);
    },
  })
    .catch(() => undefined)
    .finally(() => active.delete(id));
  return id;
}

export function watchRun(id: string, listener: Listener) {
  const view = getRunView(id);
  if (!view) return null;
  const entry = active.get(id);
  const live = view.status === "running" && entry;
  if (live) entry.listeners.add(listener);
  return {
    backlog: [...view.run.events],
    live: Boolean(live),
    unsubscribe: () => entry?.listeners.delete(listener),
  };
}

export function importRun(run: Run): "created" | "same" | "conflict" {
  const existing = getRunView(run.id);
  if (!existing) {
    persist(run);
    return "created";
  }
  return isDeepStrictEqual(JSON.parse(JSON.stringify(existing.run)), JSON.parse(JSON.stringify(run)))
    ? "same"
    : "conflict";
}
