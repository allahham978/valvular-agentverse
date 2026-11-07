"use client";

import { memo } from "react";
import Image from "next/image";
import { X } from "lucide-react";
import { DataLabel } from "@/components/data-label";
import { cn } from "@/lib/utils";
import type { FitResult, Heart } from "@/contracts";
import { Modal } from "./modal";
import { STATUS_META } from "./status";

const Thumb = memo(function Thumb({
  heart,
  result,
  onSelect,
}: {
  heart: Heart;
  result: FitResult;
  onSelect: (heartId: string) => void;
}) {
  const { label, className } = STATUS_META[result.status];
  return (
    <button
      type="button"
      data-testid="wall-thumb"
      data-heart-id={heart.id}
      data-status={result.status}
      aria-label={`${heart.id}, ${label}`}
      onClick={() => onSelect(heart.id)}
      className="relative overflow-hidden rounded-md border border-panel-border bg-background text-left transition-shadow hover:shadow-md"
    >
      <Image
        src={heart.thumbUrl}
        alt={`Root of ${heart.id}`}
        width={128}
        height={128}
        unoptimized
        loading="lazy"
        className="aspect-square w-full object-cover"
      />
      <span className="mono block px-2 py-1 text-[11px] text-muted">{heart.id}</span>
      <span
        data-testid="wall-thumb-status"
        className={cn("absolute inset-x-0 top-0 h-1", className)}
      />
    </button>
  );
});

export function ExpandedWall({
  label,
  results,
  hearts,
  onSelect,
  onClose,
}: {
  label: string | null;
  results: FitResult[];
  hearts: Map<string, Heart>;
  onSelect: (heartId: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal
      testId="wall-overlay"
      label="All test hearts"
      onClose={onClose}
      className="h-[calc(100vh-96px)] w-[min(1280px,calc(100vw-96px))]"
    >
      <div className="flex h-full flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-panel-border px-5 py-3">
          <h2 className="text-sm font-semibold">All test hearts</h2>
          <div className="flex items-center gap-3">
            {label && <DataLabel>{label}</DataLabel>}
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="rounded-md p-1.5 text-muted hover:bg-background hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
        </header>
        <div className="grid flex-1 grid-cols-[repeat(auto-fill,minmax(96px,1fr))] content-start gap-3 overflow-y-auto p-5">
          {results.map((result) => {
            const heart = hearts.get(result.heartId);
            return heart && (
              <Thumb
                key={result.heartId}
                heart={heart}
                result={result}
                onSelect={onSelect}
              />
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
