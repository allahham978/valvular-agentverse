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
  const pressedBackdrop = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      data-testid={testId}
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onPointerDown={(event) => {
        pressedBackdrop.current = event.target === ref.current;
      }}
      onClick={(event) => {
        if (event.target === ref.current && pressedBackdrop.current) onClose();
        pressedBackdrop.current = false;
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
