import { createScriptedClient } from "../agents/model-client";
import type { Run, RunEvent } from "../contracts";
import { executeRun, type ExecuteRunOptions } from "../orchestrator";
import { startRun } from "../run/store";
import { createAgentTools } from "../tools";
import { loadReplay } from "./library";
import type { ReplayFile } from "./schema";

function runOptions(file: ReplayFile): Omit<ExecuteRunOptions, "id" | "onEvent"> {
  return {
    model: createScriptedClient(file.turns),
    tools: createAgentTools(),
    startDesign: file.startDesign,
    limits: file.limits,
    budget: file.budget,
    ...(file.stopAfter && { stopAfter: file.stopAfter }),
  };
}

export function replayRun(
  file: ReplayFile,
  { id, onEvent }: { id?: string; onEvent?: (run: Run, event: RunEvent) => void } = {},
): Promise<Run> {
  return executeRun({ ...runOptions(file), id, onEvent });
}

export function startReplayRun(replayId: string): string | null {
  const file = loadReplay(replayId);
  return file && startRun(runOptions(file));
}
