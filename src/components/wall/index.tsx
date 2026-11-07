"use client";

import { useCallback, useState } from "react";
import { Maximize2 } from "lucide-react";
import { DataLabel } from "@/components/data-label";
import { HeartPanel } from "@/components/heart-panel";
import { setMainHeartId, useMainHeartId } from "@/state/stage";
import type { FitStatus } from "@/contracts";
import { DotGrid } from "./dot-grid";
import { ExpandedWall } from "./expanded-wall";
import { STATUS_META } from "./status";
import { useWallData } from "./use-wall-data";

const STATUSES = Object.keys(STATUS_META) as FitStatus[];

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

  const count = (status: FitStatus) =>
    results.filter((result) => result.status === status).length;

  return (
    <section
      data-testid="wall-panel"
      data-ready={ready ? "true" : undefined}
      data-main-heart-id={mainHeartId ?? undefined}
      className="panel shrink-0 p-4"
      aria-label="Wall of test hearts"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Test hearts</h2>
        <div className="flex items-center gap-2">
          {label && <DataLabel>{label}</DataLabel>}
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="flex items-center gap-1.5 rounded-md border border-panel-border px-2 py-0.5 text-[13px] font-medium hover:bg-background"
          >
            <Maximize2 className="size-3" aria-hidden />
            Expand
          </button>
        </div>
      </div>
      <DotGrid results={results} hearts={hearts} onSelect={setPopupId} />
      <dl className="mt-4 flex gap-5 text-sm text-muted">
        {STATUSES.map((status) => (
          <div key={status} className="flex items-center gap-1.5">
            <span className={`size-2 rounded-full ${STATUS_META[status].className}`} />
            <dt>{STATUS_META[status].label}</dt>
            <dd
              data-testid={`wall-total-${status}`}
              className="mono font-medium text-foreground"
            >
              {count(status)}
            </dd>
          </div>
        ))}
      </dl>
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
