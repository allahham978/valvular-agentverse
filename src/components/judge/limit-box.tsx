import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { LimitCheck } from "./use-judge";

const KIND_LABELS: Record<string, string> = {
  "max-sizes": "Max sizes",
  "min-fit-pct": "Min fit %",
  "max-new-risk": "Max new at-risk hearts",
};

export function LimitBox({
  check,
  busy,
  onCheck,
  onConfirm,
  onDiscard,
}: {
  check: LimitCheck;
  busy: boolean;
  onCheck(text: string): void;
  onConfirm(): void;
  onDiscard(): void;
}) {
  const [text, setText] = useState("");
  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm text-muted">
        Add a limit
        <input
          type="text"
          value={text}
          maxLength={200}
          onChange={(event) => setText(event.target.value)}
          className="h-9 rounded-md border border-panel-border bg-panel px-3 text-foreground"
        />
      </label>
      <Button variant="outline" size="sm" disabled={busy || text.trim() === ""} onClick={() => onCheck(text.trim())}>
        Check limit
      </Button>
      {check.state === "parsed" && (
        <div className="flex flex-col gap-2">
          <p data-testid="judge-parsed-limit" className="mono text-sm">
            {KIND_LABELS[check.limit.kind] ?? check.limit.kind}: {check.limit.value}
          </p>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={onConfirm}>
              Confirm limit
            </Button>
            <Button variant="ghost" size="sm" onClick={onDiscard}>
              Discard
            </Button>
          </div>
        </div>
      )}
      {check.state === "refused" && (
        <p data-testid="judge-limit-refused" role="status" className="text-sm text-muted">
          {check.reason}
        </p>
      )}
    </div>
  );
}
