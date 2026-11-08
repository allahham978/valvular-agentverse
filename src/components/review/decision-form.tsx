"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Decision } from "@/contracts";

type Saved = { decision: Decision; replanRunId?: string };

function Outcome({ decision, replanRunId }: Saved) {
  return (
    <section data-testid="review-decision" className="rounded-lg border border-accent bg-panel p-5 text-sm">
      {decision.status === "approved" ? (
        <p className="font-medium">Approved by {decision.by}</p>
      ) : (
        <>
          <p className="font-medium">Rejected by {decision.by}. Sent back to the Fixer.</p>
          {replanRunId && (
            <Link href={`/review?run=${replanRunId}`} className="mt-2 inline-block text-accent underline">
              Open the new proposal from the Fixer
            </Link>
          )}
        </>
      )}
      {decision.note && <p className="mt-2 text-muted">{decision.note}</p>}
    </section>
  );
}

export function DecisionForm({ runId, decision }: { runId: string; decision?: Decision }) {
  const [saved, setSaved] = useState<Saved | null>(decision ? { decision } : null);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (saved) return <Outcome {...saved} />;

  async function submit(status: Decision["status"]) {
    setError("");
    if (!name.trim()) return setError("Enter your name to record a decision.");
    if (status === "rejected" && !note.trim()) return setError("Add a note for the Fixer to reject.");
    setBusy(true);
    try {
      const response = await fetch(`/api/review/${runId}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, by: name, note }),
      });
      const body = (await response.json()) as Saved & { error?: string };
      if (!response.ok) return setError(body.error ?? "The decision was not saved.");
      setSaved(body);
    } catch {
      setError("The decision was not saved.");
    } finally {
      setBusy(false);
    }
  }

  const field = "mt-1 block w-full rounded-md border border-panel-border bg-panel px-3 py-2 text-sm font-normal focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";
  return (
    <form
      onSubmit={(event) => event.preventDefault()}
      className="space-y-4 rounded-lg border border-panel-border bg-panel p-5"
    >
      <label className="block text-sm font-medium">
        Name
        <input className={field} value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="block text-sm font-medium">
        Note
        <textarea className={field} rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      {error && (
        <p role="alert" className="border-l-2 border-foreground pl-3 text-sm font-medium">
          {error}
        </p>
      )}
      <div className="flex gap-3 pt-1">
        <Button type="button" className="h-10 px-5" disabled={busy} onClick={() => submit("approved")}>
          Approve
        </Button>
        <Button type="button" variant="outline" className="h-10 px-5" disabled={busy} onClick={() => submit("rejected")}>
          Reject
        </Button>
      </div>
    </form>
  );
}
