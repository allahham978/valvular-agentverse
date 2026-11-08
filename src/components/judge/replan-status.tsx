import type { RunEvent } from "@/contracts";
import type { RestartPoint } from "@/orchestrator/restart-point";
import type { RunResult } from "./use-judge";

const START_LABELS: Record<RestartPoint, string> = { investigate: "Breaker", propose: "Fixer" };

export function ReplanStatus({
  startAt,
  events,
  result,
}: {
  startAt: RestartPoint | null;
  events: RunEvent[];
  result: RunResult | null;
}) {
  if (!startAt) return null;
  const steps = events.filter((event) => event.type === "step-start");
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <p data-testid="judge-replan-status" className="text-muted">
        Restarted at the {START_LABELS[startAt]}
        {steps.map((event) => (
          <span key={event.seq} className="block text-xs">
            {event.text}
          </span>
        ))}
      </p>
      {result && (
        <div data-testid="judge-run-result" className="flex flex-col gap-0.5">
          <span>{result.stopText}</span>
          <span className="mono">
            {result.design.sizes.length} sizes: {result.design.sizes.map((size) => `${size.nominalMm} mm`).join(", ")}
          </span>
        </div>
      )}
    </div>
  );
}
