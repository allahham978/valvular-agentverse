import { SummarySchema, type RunEvent, type Summary } from "@/contracts";

function evaluations(events: RunEvent[]) {
  return events.flatMap((event) => {
    if (event.type !== "evaluation") return [];
    const data = event.data as { summary?: unknown; improved?: boolean } | null;
    const summary = SummarySchema.safeParse(data?.summary);
    return summary.success ? [{ summary: summary.data, improved: data?.improved === true }] : [];
  });
}

const pct = (summary: Summary) => summary.fitPct.toFixed(1);

export function ResultLine({ events, newRisk }: { events: RunEvent[]; newRisk: number | null }) {
  const all = evaluations(events);
  const start = all[0];
  const improved = all.filter((entry) => entry.improved).at(-1);
  if (!start || !improved) return null;
  const risk = newRisk ?? 0;
  return (
    <p data-testid="result-line" className="mt-3 shrink-0 border-t border-panel-border pt-3 text-sm">
      This valve fits <span className="mono">{pct(start.summary)}%</span> of test hearts. With this change, it fits{" "}
      <span className="mono">{pct(improved.summary)}%</span>, and here&apos;s the new risk:{" "}
      <span className="mono">{risk}</span> {risk === 1 ? "heart" : "hearts"} now at risk. Dev hearts.
    </p>
  );
}
