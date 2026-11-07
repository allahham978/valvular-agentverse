"use client";

import { useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getStageProgress, subscribeStage } from "@/state/stage";
import { smoothstep } from "./stage-math";
import { zoomToValve } from "./stage-input";

const GONE_BY = 0.15;
const LABEL_SWAP_AT = 0.5;

function showLabel(label: Element, shown: boolean) {
  const style = (label as HTMLElement).style;
  style.opacity = shown ? "1" : "0";
  style.visibility = shown ? "visible" : "hidden";
}

// "Illustrative" belongs to the heart only. The labels swap with no overlap, so one is always readable.
function syncHeaderLabels(progress: number) {
  const onHeart = progress < LABEL_SWAP_AT;
  document.querySelectorAll("header .stage-opening").forEach((label) => showLabel(label, onHeart));
  document.querySelectorAll("header .stage-panel").forEach((label) => showLabel(label, !onHeart));
}

export function OpeningUi() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const update = () => {
      const element = ref.current;
      if (!element) return;
      const opacity = 1 - smoothstep(0, GONE_BY, getStageProgress());
      element.style.opacity = String(opacity);
      element.style.pointerEvents = opacity < 0.5 ? "none" : "";
      syncHeaderLabels(getStageProgress());
    };
    update();
    return subscribeStage(update);
  }, []);

  return (
    <div
      ref={ref}
      className="stage-opening absolute bottom-10 left-1/2 flex -translate-x-1/2 flex-col items-center gap-4"
    >
      <div
        data-testid="scroll-cue"
        className="flex flex-col items-center gap-1 text-xs tracking-wide text-muted"
      >
        <span>Scroll to zoom into the aortic valve</span>
        <ChevronDown className="size-4 motion-safe:animate-bounce" aria-hidden />
      </div>
      <Button size="sm" onClick={zoomToValve}>
        Zoom to valve
      </Button>
    </div>
  );
}
