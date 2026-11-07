import type { FitStatus } from "@/contracts";

export const STATUS_META: Record<
  FitStatus,
  { label: string; className: string; border: string }
> = {
  fit: { label: "Fit", className: "bg-fit", border: "border-l-fit" },
  risk: { label: "Risk", className: "bg-risk", border: "border-l-risk" },
  "no-fit": { label: "No fit", className: "bg-no-fit", border: "border-l-no-fit" },
};
