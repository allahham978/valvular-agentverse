import type { FitStatus } from "@/contracts";

export const STATUS_META: Record<
  FitStatus,
  { label: string; className: string }
> = {
  fit: { label: "Fit", className: "bg-fit" },
  risk: { label: "Risk", className: "bg-risk" },
  "no-fit": { label: "No fit", className: "bg-no-fit" },
};
