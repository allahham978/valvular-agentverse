"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export function Modal({
  testId,
  label,
  onClose,
  className,
  children,
}: {
  testId: string;
  label: string;
  onClose: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      data-testid={testId}
      aria-label={label}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className={cn(
        "panel m-auto max-h-[calc(100vh-48px)] max-w-[calc(100vw-48px)] overflow-hidden p-0 text-foreground backdrop:bg-foreground/30",
        className,
      )}
    >
      {children}
    </dialog>
  );
}
