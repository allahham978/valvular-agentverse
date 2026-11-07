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

const formatMm = (value: number) => `${value.toFixed(1)} mm`;

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
      className="w-[720px] min-[1800px]:w-[860px]"
    >
      <div className="grid grid-cols-[260px_1fr] gap-5 p-5 text-sm min-[1800px]:grid-cols-[320px_1fr] min-[1800px]:gap-6 min-[1800px]:p-6 min-[1800px]:text-base">
        <div
          data-testid="heart-popup-view"
          className="relative size-[260px] rounded-md bg-background min-[1800px]:size-[320px]"
        >
          <HeartView meshUrl={heart.meshUrl} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <header className="flex items-start justify-between gap-2">
            <div>
              <h2 className="mono text-base font-semibold min-[1800px]:text-lg">{heart.id}</h2>
              <span className="mt-1 flex items-center gap-1.5">
                <span className={cn("size-2 rounded-full", status.className)} />
                <span data-testid="heart-popup-status" className="font-medium">
                  {status.label}
                </span>
              </span>
            </div>
            {label && <DataLabel>{label}</DataLabel>}
          </header>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
            {Object.entries(heart.measures).map(([key, value]) => (
              <div
                key={key}
                data-testid={`heart-popup-measure-${key}`}
                className="col-span-2 grid grid-cols-subgrid"
              >
                <dt className="text-muted">{MEASURE_LABELS[key] ?? key}</dt>
                <dd className="mono">{formatMm(value)}</dd>
              </div>
            ))}
            {result.reasons.length === 0 && (
              <p className="col-span-2 mt-2 border-t border-panel-border pt-3 text-muted">
                No rules failed
              </p>
            )}
            {result.reasons.map((reason) => {
              const rule = ruleInfo(reason.ruleId);
              return (
                <div
                  key={reason.ruleId}
                  data-testid="heart-popup-reason"
                  data-rule-id={reason.ruleId}
                  className="col-span-2 mt-2 grid grid-cols-subgrid gap-y-1 border-t border-panel-border pt-3"
                >
                  <dt className="text-muted">Failed rule</dt>
                  <dd className="font-medium">{rule.name}</dd>
                  <dt className="text-muted">Measured</dt>
                  <dd className="mono">{formatMm(reason.measured)}</dd>
                  <dt className="text-muted">Limit</dt>
                  <dd className="mono">{formatMm(reason.limit)}</dd>
                  <dt className="text-muted">Margin</dt>
                  <dd className="mono">{formatMm(reason.margin)}</dd>
                  <dt className="text-muted">Rule type</dt>
                  <dd>{rule.type}</dd>
                </div>
              );
            })}
          </dl>
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
