import type { BudgetLeft } from "../agents/model-client";

type Limits = { maxStepsPerTurn: number; maxToolCallsPerTurn: number; maxTurnMs: number };

// The share of each limit kept for ending the turn: 3 of 16 tool calls, 1 of 8 steps, 45 of 180 s.
export function createTurnBudget(limits: Limits, terminalTool: string) {
  const startedAt = Date.now();
  const reserve = {
    calls: Math.floor(limits.maxToolCallsPerTurn / 5),
    steps: Math.floor(limits.maxStepsPerTurn / 8),
    ms: limits.maxTurnMs / 4,
  };
  let steps = 0;
  let calls = 0;
  const callsLeft = () => limits.maxToolCallsPerTurn - calls;
  const stepsLeft = () => limits.maxStepsPerTurn - steps;
  const msLeft = () => limits.maxTurnMs - (Date.now() - startedAt);

  const low = () =>
    (reserve.calls > 0 && callsLeft() <= reserve.calls) ||
    (reserve.steps > 0 && stepsLeft() <= reserve.steps) ||
    msLeft() < reserve.ms;

  return {
    get steps() {
      return steps;
    },
    get calls() {
      return calls;
    },
    startStep() {
      steps += 1;
    },
    useCall() {
      calls += 1;
    },
    low,
    // From the second step on, the model has been told what is left, so other tools can't spend the reserve.
    keepsReserve(name: string) {
      return name !== terminalTool && steps > 1 && reserve.calls > 0 && callsLeft() <= reserve.calls;
    },
    left(): BudgetLeft {
      return {
        toolCallsLeft: callsLeft(),
        stepsLeft: stepsLeft(),
        secondsLeft: Math.max(0, Math.floor(msLeft() / 1000)),
        ...(low() ? { note: `Budget nearly used: your next step can only call ${terminalTool}, so end your turn with it.` } : {}),
      };
    },
  };
}
