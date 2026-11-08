import type { Design, Limit, Run, RunEvent } from "../../contracts";
import { defaultStartDesign, executeRun, type Budget } from "../../orchestrator";
import type { ToolRegistry } from "../../orchestrator/tools";
import { createAgentTools } from "../../tools";
import type { ModelClient } from "../model-client";

export type BreakerOptions = {
  model: ModelClient;
  tools?: ToolRegistry;
  design?: Design;
  limits?: Limit[];
  budget?: Partial<Budget>;
  onEvent?: (run: Run, event: RunEvent) => void;
};

export function runBreaker({ model, tools = createAgentTools(), design = defaultStartDesign, limits, budget, onEvent }: BreakerOptions): Promise<Run> {
  return executeRun({
    model,
    tools,
    startDesign: design,
    limits,
    budget,
    onEvent,
    stopAfter: "investigate",
    record: model.mode === "live",
  });
}
