import sample from "@fixtures/sample-hearts.json";
import { DataLabel } from "@/components/data-label";
import { HeartPanel } from "@/components/heart-panel";
import type { FitStatus } from "@/contracts";

const STATUSES: { status: FitStatus; label: string; className: string }[] = [
  { status: "fit", label: "Fit", className: "bg-fit" },
  { status: "risk", label: "Risk", className: "bg-risk" },
  { status: "no-fit", label: "No fit", className: "bg-no-fit" },
];

const results = sample.results as { heartId: string; status: FitStatus }[];

export function Wall() {
  return (
    <section
      data-testid="wall-panel"
      className="panel shrink-0 p-4"
      aria-label="Wall of test hearts"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Test hearts</h2>
        <DataLabel>{sample.label}</DataLabel>
      </div>
      <div className="grid grid-cols-[repeat(25,10px)] gap-[4px]">
        {results.map(({ heartId, status }) => (
          <span
            key={heartId}
            data-testid="wall-dot"
            data-status={status}
            className={`size-2.5 rounded-full ${STATUSES.find((s) => s.status === status)?.className}`}
          />
        ))}
      </div>
      <dl className="mt-4 flex gap-5 text-[13px] text-muted">
        {STATUSES.map(({ status, label, className }) => (
          <div key={status} className="flex items-center gap-1.5">
            <span className={`size-2 rounded-full ${className}`} />
            <dt>{label}</dt>
            <dd
              data-testid={`wall-total-${status}`}
              className="mono font-medium text-foreground"
            >
              {results.filter((result) => result.status === status).length}
            </dd>
          </div>
        ))}
      </dl>
      <HeartPanel />
    </section>
  );
}
