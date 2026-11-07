"use client";

import { memo } from "react";
import Image from "next/image";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataLabel } from "@/components/data-label";
import { cn } from "@/lib/utils";
import type { FitResult, Heart } from "@/contracts";
import { Legend } from "./legend";
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
  const { label, className, cell } = STATUS_META[result.status];
  return (
    <button
      type="button"
      data-testid="wall-thumb"
      data-heart-id={heart.id}
      data-status={result.status}
      aria-label={`${heart.id}, ${label}`}
      onClick={() => onSelect(heart.id)}
      className={cn(
        "group relative size-16 overflow-hidden rounded-md border-2 p-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent min-[1800px]:size-[72px]",
        cell,
      )}
    >
      <Image
        src={heart.thumbUrl}
        alt={`Root of ${heart.id}`}
        width={128}
        height={128}
        unoptimized
        loading="lazy"
        className="size-full rounded-sm bg-background object-cover"
      />
      <span
        data-testid="wall-thumb-status"
        className={cn("absolute right-1 top-1 size-2 rounded-full ring-1 ring-panel", className)}
      />
      <span className="mono absolute inset-x-0.5 bottom-0.5 hidden rounded-b-sm bg-foreground/85 py-0.5 text-center text-[10px] text-white group-hover:block group-focus-visible:block min-[1800px]:text-[11px]">
        {heart.id}
      </span>
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
      className="h-[calc(100vh-48px)] w-[calc(100vw-48px)]"
    >
      <div className="flex h-full flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-panel-border px-5 py-3">
          <h2 className="text-sm font-semibold min-[1800px]:text-base">All test hearts</h2>
          <div className="flex items-center gap-5">
            <Legend results={results} />
            {label && <DataLabel>{label}</DataLabel>}
            <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
              <X className="size-4" aria-hidden />
            </Button>
          </div>
        </header>
        <div className="grid flex-1 grid-cols-[repeat(auto-fill,4rem)] auto-rows-min content-start justify-center gap-1.5 overflow-y-auto p-5 min-[1800px]:grid-cols-[repeat(auto-fill,72px)]">
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
