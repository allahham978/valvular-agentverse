import { cn } from "@/lib/utils";
import type { FitResult, FitStatus } from "@/contracts";
import { STATUS_META } from "./status";

const STATUSES = Object.keys(STATUS_META) as FitStatus[];

export function Legend({
  results,
  testIds = false,
  className,
}: {
  results: FitResult[];
  testIds?: boolean;
  className?: string;
}) {
  const count = (status: FitStatus) =>
    results.filter((result) => result.status === status).length;

  return (
    <dl className={cn("flex gap-5 text-sm text-muted min-[1800px]:text-base", className)}>
      {STATUSES.map((status) => (
        <div key={status} className="flex items-center gap-1.5">
          <span className={cn("size-2 rounded-full", STATUS_META[status].className)} />
          <dt>{STATUS_META[status].label}</dt>
          <dd
            data-testid={testIds ? `wall-total-${status}` : undefined}
            className="mono w-[3ch] font-medium text-foreground"
          >
            {count(status)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
