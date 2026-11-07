"use client";

import { useLayoutEffect } from "react";
import { setStageProgress, useStageProgress } from "@/state/stage";

export function StageGate({
  initial,
  children,
}: {
  initial: number;
  children: React.ReactNode;
}) {
  const progress = useStageProgress();
  useLayoutEffect(() => setStageProgress(initial), [initial]);

  return (
    <div data-stage-progress={progress} className="absolute inset-0">
      {children}
    </div>
  );
}
