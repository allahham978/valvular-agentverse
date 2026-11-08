"use client";

import { DataLabel } from "@/components/data-label";
import { startReplay, useRun } from "@/components/feed/run-store";

type Offer = { replayId: string };

export function ReplayLabel() {
  const { events, labelled, phase } = useRun();
  const offer = events.find((event) => event.type === "replay-offer");
  return (
    <>
      {labelled && phase !== "idle" && (
        <DataLabel className="fixed left-1/2 top-5 z-40 -translate-x-1/2">
          <span data-testid="replay-label">Replay, not live</span>
        </DataLabel>
      )}
      {offer && (
        <div
          data-testid="replay-offer"
          className="panel fixed bottom-6 left-1/2 z-40 flex max-w-md -translate-x-1/2 items-center gap-3 p-3 text-sm"
        >
          <span>The live run failed. A recording is available.</span>
          <button
            type="button"
            onClick={() => void startReplay((offer.data as Offer).replayId)}
            className="shrink-0 rounded border border-panel-border px-3 py-1.5 font-medium hover:bg-background focus-visible:outline-2 focus-visible:outline-accent"
          >
            Play the recording
          </button>
        </div>
      )}
    </>
  );
}
