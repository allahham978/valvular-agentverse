"use client";

import { useCallback, useState } from "react";
import { Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataLabel } from "@/components/data-label";
import { HeartPanel } from "@/components/heart-panel";
import { setMainHeartId, useMainHeartId } from "@/state/stage";
import { DotGrid } from "./dot-grid";
import { ExpandedWall } from "./expanded-wall";
import { Legend } from "./legend";
import { useWallData } from "./use-wall-data";

export function Wall() {
  const { ready, label, hearts, results } = useWallData();
  const mainHeartId = useMainHeartId();
  const [expanded, setExpanded] = useState(false);
  const [popupId, setPopupId] = useState<string | null>(null);

  const closePopup = useCallback(() => setPopupId(null), []);
  const closeExpanded = useCallback(() => setExpanded(false), []);
  const openInMain = useCallback((heartId: string) => {
    setMainHeartId(heartId);
    setPopupId(null);
    setExpanded(false);
  }, []);

  return (
    <section
      data-testid="wall-panel"
      data-ready={ready ? "true" : undefined}
      data-main-heart-id={mainHeartId ?? undefined}
      className="panel shrink-0 p-4"
      aria-label="Wall of test hearts"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold min-[1800px]:text-base">Test hearts</h2>
        <div className="flex items-center gap-2">
          {label && <DataLabel>{label}</DataLabel>}
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 px-2 text-[13px] min-[1800px]:h-8 min-[1800px]:text-sm"
            onClick={() => setExpanded(true)}
          >
            <Maximize2 className="size-3" aria-hidden />
            Expand
          </Button>
        </div>
      </div>
      <DotGrid
        results={results}
        hearts={hearts}
        mainHeartId={mainHeartId}
        onSelect={setPopupId}
      />
      <Legend results={results} testIds className="mt-4" />
      {mainHeartId && (
        <p className="mono mt-3 text-xs text-muted min-[1800px]:text-sm">
          In main view: <span className="text-foreground">{mainHeartId}</span>
        </p>
      )}
      {expanded && (
        <ExpandedWall
          label={label}
          results={results}
          hearts={hearts}
          onSelect={setPopupId}
          onClose={closeExpanded}
        />
      )}
      {popupId && (
        <HeartPanel
          key={popupId}
          heartId={popupId}
          onClose={closePopup}
          onOpenInMain={openInMain}
        />
      )}
    </section>
  );
}
