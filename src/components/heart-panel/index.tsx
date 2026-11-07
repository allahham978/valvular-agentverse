"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { DataLabel } from "@/components/data-label";
import { Modal } from "@/components/wall/modal";
import { STATUS_META } from "@/components/wall/status";
import { useWallData } from "@/components/wall/use-wall-data";
import { setMainViewPaused } from "@/state/stage";
import { cn } from "@/lib/utils";
import { HeartView } from "./heart-view";
import { ruleInfo } from "./sample-rules";

const MEASURE_LABELS: Record<string, string> = {
  annulusMm: "Annulus",
  sinusMm: "Sinus",
  sinotubularJunctionMm: "Sinotubular junction",
};

export function HeartPanel({
  heartId,
  onClose,
  onOpenInMain,
}: {
  heartId: string;
  onClose: () => void;
  onOpenInMain: (heartId: string) => void;
}) {
  const { label, hearts, results, indexById } = useWallData();
  const heart = hearts.get(heartId);
  const result = results[indexById.get(heartId) ?? -1];

  useEffect(() => {
    setMainViewPaused(true);
    return () => setMainViewPaused(false);
  }, []);

  if (!heart || !result) return null;
  const status = STATUS_META[result.status];

  return (
    <Modal
      testId="heart-popup"
      label={`Heart ${heart.id}`}
      onClose={onClose}
      className="w-[720px]"
    >
      <div className="grid grid-cols-[260px_1fr] gap-5 p-5">
        <div
          data-testid="heart-popup-view"
          className="h-[260px] w-[260px] rounded-md bg-background"
        >
          <HeartView meshUrl={heart.meshUrl} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <header className="flex items-start justify-between gap-2">
            <div>
              <h2 className="mono text-base font-semibold">{heart.id}</h2>
              <span className="mt-1 flex items-center gap-1.5 text-sm">
                <span className={cn("size-2 rounded-full", status.className)} />
                <span data-testid="heart-popup-status" className="font-medium">
                  {status.label}
                </span>
              </span>
            </div>
            {label && <DataLabel>{label}</DataLabel>}
          </header>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
            {Object.entries(heart.measures).map(([key, value]) => (
              <div key={key} data-testid={`heart-popup-measure-${key}`} className="contents">
                <dt className="text-muted">{MEASURE_LABELS[key] ?? key}</dt>
                <dd className="mono">{value.toFixed(1)} mm</dd>
              </div>
            ))}
          </dl>
          {result.reasons.map((reason) => {
            const rule = ruleInfo(reason.ruleId);
            return (
              <div
                key={reason.ruleId}
                data-testid="heart-popup-reason"
                data-rule-id={reason.ruleId}
                className={cn("rounded-md border border-panel-border border-l-2 p-3 text-sm", status.border)}
              >
                <p>
                  <span className="text-muted">Failed rule </span>
                  <span className="font-medium">{rule.name}</span>
                </p>
                <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                  <dt className="text-muted">Measured</dt>
                  <dd className="mono">{reason.measured}</dd>
                  <dt className="text-muted">Limit</dt>
                  <dd className="mono">{reason.limit}</dd>
                  <dt className="text-muted">Margin</dt>
                  <dd className="mono">{reason.margin}</dd>
                  <dt className="text-muted">Rule type</dt>
                  <dd>{rule.type}</dd>
                </dl>
              </div>
            );
          })}
          <div className="mt-auto flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button onClick={() => onOpenInMain(heart.id)}>Open in main view</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
