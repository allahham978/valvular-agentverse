import type { Run } from "../contracts";
import { defaultBudget, defaultStartDesign, type Budget } from "../orchestrator";
import type { ReplayFile } from "./schema";

type RunStart = { design?: ReplayFile["startDesign"]; budget?: Partial<Budget> };
type ToolCallData = { tool: string; input: unknown };
type Turn = ReplayFile["turns"][number];

export function replayFromRun(run: Run, { id, title }: { id: string; title: string }): ReplayFile {
  const start = (run.events.find((event) => event.type === "run-start")?.data ?? {}) as RunStart;
  const budget = { ...defaultBudget, ...start.budget };
  const turns: Turn[] = [];
  let text: string | undefined;

  const flushText = () => {
    if (text !== undefined) turns.push({ text, toolCalls: [] });
    text = undefined;
  };

  for (const event of run.events) {
    if (event.type === "model-text") {
      flushText();
      text = event.text;
    } else if (event.type === "tool-call") {
      const call = event.data as ToolCallData;
      turns.push({ ...(text !== undefined && { text }), toolCalls: [{ name: call.tool, args: call.input }] });
      text = undefined;
    } else if (event.type === "step-start" || event.type === "run-stop") {
      flushText();
    }
  }

  const stop = run.events.findLast((event) => event.type === "run-stop")?.data as { reason?: string } | null;
  return {
    id,
    title,
    source: "recording",
    startDesign: start.design ?? defaultStartDesign,
    limits: run.limits,
    budget: { ...budget, maxStepsPerTurn: Math.max(budget.maxStepsPerTurn, budget.maxToolCallsPerTurn) },
    ...(stop?.reason === "investigated" && { stopAfter: "investigate" as const }),
    turns,
  };
}
