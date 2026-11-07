"use client";

import { Button } from "@/components/ui/button";
import { releaseFix, startRun, useRun } from "@/components/feed/run-store";

const DISABLED = "disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-100";
const DISABLED_QUIET = `${DISABLED} disabled:border-panel-border disabled:bg-background disabled:text-muted/70`;

export function Controls() {
  const { phase } = useRun();
  return (
    <section
      data-testid="controls-panel"
      className="panel flex items-center gap-3 p-3"
      aria-label="Controls"
    >
      <Button
        disabled={phase !== "idle"}
        onClick={() => void startRun()}
        className={`${DISABLED} disabled:bg-accent/40 disabled:text-white`}
      >
        Break it
      </Button>
      <Button
        variant="outline"
        disabled={phase !== "broken"}
        onClick={releaseFix}
        className={DISABLED_QUIET}
      >
        Fix it
      </Button>
    </section>
  );
}
