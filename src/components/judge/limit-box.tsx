import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { LimitCheck } from "./use-judge";

const SUGGESTIONS = ["No more than 4 sizes", "At least 75% must fit", "No more than 5 new at-risk hearts"];

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
          placeholder="e.g. No more than 4 sizes"
          aria-describedby="limit-help"
          onChange={(event) => setText(event.target.value)}
          className="h-9 rounded-md border border-panel-border bg-panel px-3 text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        />
      </label>
      <p id="limit-help" className="text-xs text-muted">
        A business rule the design must meet: sizes, coverage or new risk.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => setText(suggestion)}
            className="rounded-full border border-panel-border px-2.5 py-1 text-xs text-muted hover:bg-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent"
          >
            {suggestion}
          </button>
        ))}
      </div>
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
