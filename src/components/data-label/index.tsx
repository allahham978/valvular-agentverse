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
        "inline-flex items-center rounded-sm bg-background px-2 py-0.5 text-[13px] font-medium text-muted min-[1800px]:text-sm",
        className,
      )}
    >
      {children}
    </span>
  );
}
