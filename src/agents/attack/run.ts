import type { Design, Limit, Run, RunEvent } from "../../contracts";
import { STARTING_VALVE } from "../../engine";
import { executeRun, type Budget } from "../../orchestrator";
import type { ToolRegistry } from "../../orchestrator/tools";
import { createAgentTools } from "../../tools";
import type { ModelClient } from "../model-client";

export const DEMO_MAX_ROUNDS = 2;

export const demoBudget = (budget?: Partial<Budget>): Partial<Budget> => ({
  ...budget,
  maxRounds: Math.min(budget?.maxRounds ?? DEMO_MAX_ROUNDS, DEMO_MAX_ROUNDS),
});

export type LoopOptions = {
  model: ModelClient;
  tools?: ToolRegistry;
  design?: Design;
  limits?: Limit[];
  budget?: Partial<Budget>;
  demo?: boolean;
  startAt?: "investigate" | "propose";
  onEvent?: (run: Run, event: RunEvent) => void;
};

export function runLoop({ model, tools = createAgentTools(), design = STARTING_VALVE, limits, budget, demo, startAt, onEvent }: LoopOptions): Promise<Run> {
  return executeRun({
    model,
    tools,
    startDesign: design,
    limits,
    budget: demo ? demoBudget(budget) : budget,
    startAt,
    onEvent,
    record: model.mode === "live",
  });
}
