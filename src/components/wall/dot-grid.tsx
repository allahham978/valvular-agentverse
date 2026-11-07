"use client";

import { memo, useCallback, useRef, useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import type { FitResult, Heart } from "@/contracts";
import { STATUS_META } from "./status";

type Props = {
  results: FitResult[];
  hearts: Map<string, Heart>;
  mainHeartId: string | null;
  onSelect: (heartId: string) => void;
};

type Hover = { heartId: string; centreY: number; right: number };

const CARD_HEIGHT = 176;
const CARD_HEIGHT_LARGE = 216;
const CARD_GAP = 12;
const LARGE_SCREEN = 1800;

const Dot = memo(function Dot({
  result,
  inMain,
  onHover,
  onFocusDot,
  onSelect,
}: {
  result: FitResult;
  inMain: boolean;
  onHover: (heartId: string | null, element?: HTMLElement) => void;
  onFocusDot: (heartId: string, element: HTMLElement) => void;
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
        "size-(--dot) rounded-full outline-offset-2 transition-transform hover:scale-125 focus-visible:outline-2 focus-visible:outline-accent motion-reduce:transition-none",
        STATUS_META[status].className,
        inMain && "ring-2 ring-foreground ring-offset-2 ring-offset-panel",
      )}
      onPointerEnter={(event) => onHover(heartId, event.currentTarget)}
      onKeyDown={(event) => event.key === "Tab" && onHover(null)}
      onPointerLeave={() => onHover(null)}
      onFocus={(event) => onFocusDot(heartId, event.currentTarget)}
      onBlur={() => onHover(null)}
      onClick={() => onSelect(heartId)}
    />
  );
});

export function DotGrid({ results, hearts, mainHeartId, onSelect }: Props) {
  const [hover, setHover] = useState<Hover | null>(null);
  const afterPopup = useRef(false);

  const select = useCallback(
    (heartId: string) => {
      afterPopup.current = true;
      setHover(null);
      onSelect(heartId);
    },
    [onSelect],
  );

  const onHover = useCallback((heartId: string | null, element?: HTMLElement) => {
    afterPopup.current = false;
    if (!heartId || !element) return setHover(null);
    const panel = element.closest("[data-testid=wall-panel]");
    const dot = element.getBoundingClientRect();
    const edge = panel?.getBoundingClientRect().left ?? dot.left;
    setHover({ heartId, centreY: dot.top + dot.height / 2, right: window.innerWidth - edge + CARD_GAP });
  }, []);

  const onFocusDot = useCallback(
    (heartId: string, element: HTMLElement) => {
      if (!afterPopup.current) onHover(heartId, element);
    },
    [onHover],
  );

  const heart = hover && hearts.get(hover.heartId);
  const cardHeight = hover && window.innerWidth >= LARGE_SCREEN ? CARD_HEIGHT_LARGE : CARD_HEIGHT;
  const top = hover
    ? Math.min(
        Math.max(8, hover.centreY - cardHeight / 2),
        window.innerHeight - cardHeight - 8,
      )
    : 0;

  return (
    <>
      <div className="grid grid-cols-[repeat(25,var(--dot))] gap-(--dot-gap)">
        {results.map((result) => (
          <Dot
            key={result.heartId}
            result={result}
            inMain={result.heartId === mainHeartId}
            onHover={onHover}
            onFocusDot={onFocusDot}
            onSelect={select}
          />
        ))}
      </div>
      {hover && heart && (
        <div
          data-testid="wall-hover-card"
          style={{ right: hover.right, top }}
          className="panel pointer-events-none fixed z-10 w-36 p-2 min-[1800px]:w-44"
        >
          <Image
            src={heart.thumbUrl}
            alt=""
            width={128}
            height={128}
            unoptimized
            className="aspect-square w-full rounded-sm bg-background object-cover"
          />
          <p className="mono mt-1.5 text-center text-xs min-[1800px]:text-sm">{hover.heartId}</p>
        </div>
      )}
    </>
  );
}
