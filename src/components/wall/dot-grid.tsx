"use client";

import { memo, useCallback, useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import type { FitResult, Heart } from "@/contracts";
import { STATUS_META } from "./status";

type Props = {
  results: FitResult[];
  hearts: Map<string, Heart>;
  onSelect: (heartId: string) => void;
};

type Hover = { heartId: string; centreY: number; left: number };

const CARD_WIDTH = 144;
const CARD_HEIGHT = 176;
const CARD_GAP = 12;

const Dot = memo(function Dot({
  result,
  onHover,
  onSelect,
}: {
  result: FitResult;
  onHover: (heartId: string | null, element?: HTMLElement) => void;
  onSelect: (heartId: string) => void;
}) {
  const { heartId, status } = result;
  return (
    <button
      type="button"
      data-testid="wall-dot"
      data-heart-id={heartId}
      data-status={status}
      aria-label={`${heartId}, ${STATUS_META[status].label}`}
      className={cn(
        "size-2.5 rounded-full outline-offset-2 transition-transform hover:scale-125 focus-visible:outline-2 focus-visible:outline-accent motion-reduce:transition-none",
        STATUS_META[status].className,
      )}
      onPointerEnter={(event) => onHover(heartId, event.currentTarget)}
      onPointerLeave={() => onHover(null)}
      onFocus={(event) => onHover(heartId, event.currentTarget)}
      onBlur={() => onHover(null)}
      onClick={() => onSelect(heartId)}
    />
  );
});

export function DotGrid({ results, hearts, onSelect }: Props) {
  const [hover, setHover] = useState<Hover | null>(null);

  const onHover = useCallback((heartId: string | null, element?: HTMLElement) => {
    if (!heartId || !element) return setHover(null);
    const panel = element.closest("[data-testid=wall-panel]");
    const dot = element.getBoundingClientRect();
    const left = (panel?.getBoundingClientRect().left ?? dot.left) - CARD_GAP - CARD_WIDTH;
    setHover({ heartId, centreY: dot.top + dot.height / 2, left });
  }, []);

  const heart = hover && hearts.get(hover.heartId);
  const top = hover
    ? Math.min(
        Math.max(8, hover.centreY - CARD_HEIGHT / 2),
        window.innerHeight - CARD_HEIGHT - 8,
      )
    : 0;

  return (
    <>
      <div className="grid grid-cols-[repeat(25,1fr)] justify-items-center gap-y-[4px]">
        {results.map((result) => (
          <Dot
            key={result.heartId}
            result={result}
            onHover={onHover}
            onSelect={onSelect}
          />
        ))}
      </div>
      {hover && heart && (
        <div
          data-testid="wall-hover-card"
          style={{ left: hover.left, top, width: CARD_WIDTH }}
          className="panel pointer-events-none fixed z-10 p-2"
        >
          <Image
            src={heart.thumbUrl}
            alt=""
            width={128}
            height={128}
            unoptimized
            className="size-32 rounded-sm bg-background object-cover"
          />
          <p className="mono mt-1.5 text-center text-xs">{hover.heartId}</p>
        </div>
      )}
    </>
  );
}
