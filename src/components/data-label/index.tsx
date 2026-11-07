import { cn } from "@/lib/utils";

export function DataLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-panel-border bg-panel px-2.5 py-0.5 text-[13px] font-medium text-muted",
        className,
      )}
    >
      {children}
    </span>
  );
}
