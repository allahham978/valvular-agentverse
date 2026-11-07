import type { FitStatus } from "@/contracts";

export const STATUS_META: Record<
  FitStatus,
  { label: string; className: string; cell: string }
> = {
  fit: { label: "Fit", className: "bg-fit", cell: "border-fit bg-fit/15" },
  risk: { label: "Risk", className: "bg-risk", cell: "border-risk bg-risk/15" },
  "no-fit": { label: "No fit", className: "bg-no-fit", cell: "border-no-fit bg-no-fit/15" },
};
