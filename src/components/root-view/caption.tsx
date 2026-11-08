"use client";

import { STATUS_META } from "@/components/wall/status";
import { defaultRules } from "@/engine/rules";
import { useMainRoot } from "./use-main-root";

export function RootCaption() {
  const { selectedId, heart, fit } = useMainRoot();
  const meta = fit && STATUS_META[fit.status];
  const failed = fit?.reasons[0] && defaultRules.rules.find((rule) => rule.id === fit.reasons[0].ruleId);

  return (
    <div
      data-testid="main-view-status"
      data-selected-id={selectedId ?? "none"}
      data-heart-id={heart?.id ?? ""}
      data-status={fit?.status ?? ""}
      className="panel stage-panel absolute left-1/2 top-14 z-10 flex -translate-x-1/2 flex-col items-center gap-0.5 px-3 py-1.5 text-sm"
    >
      <div className="flex items-center gap-2">
        <span className="font-medium">Schematic valve</span>
        <span className="text-muted">{heart?.id}</span>
        {meta && (
          <span className="inline-flex items-center gap-1.5 font-medium">
            <span className={`size-2 rounded-full ${meta.className}`} />
            {meta.label}
          </span>
        )}
        <span className="text-muted">Synthetic heart</span>
      </div>
      {failed && <span className="text-xs text-muted">{failed.description}</span>}
    </div>
  );
}
