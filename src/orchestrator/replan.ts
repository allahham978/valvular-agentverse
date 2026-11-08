import { DEMO_MAX_ROUNDS } from "../agents/attack";
import type { ModelClient } from "../agents/model-client";
import { startRun } from "../run/store";
import { createAgentTools } from "../tools";
import { restartPoint, type Planned } from "./restart-point";

export { restartPoint, type Planned, type RestartPoint } from "./restart-point";

export function startReplan({ model, before, after }: { model: ModelClient; before: Planned; after: Planned }) {
  const startAt = restartPoint(before, after);
  if (!startAt) return null;
  const id = startRun({
    model,
    record: model.mode === "live",
    tools: createAgentTools(),
    budget: { maxRounds: DEMO_MAX_ROUNDS },
    startDesign: after.design,
    limits: after.limits,
    startAt,
  });
  return { id, startAt };
}
