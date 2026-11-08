import type { Proposal, Run } from "@/contracts";
import type { ScoreReport, ScoreRow } from "@/scoring";
import { MarkBadge } from "./mark-badge";

export const DISCLAIMER = "Test hearts, not patients. All hearts come from one generator.";

const NAMES: Record<ScoreRow["method"], string> = {
  proposal: "Agents' proposal",
  "no-change": "No change",
  "add-larger-size": "Add one larger size",
  "brute-force": "Brute force",
};

const verdictLabel = (verdict: string) => {
  const text = verdict.replaceAll("_", " ");
  return text[0].toUpperCase() + text.slice(1);
};

function outputLine(report: ScoreReport) {
  const proposal = report.rows.find((row) => row.method === "proposal");
  if (!proposal?.summary) return "The agents made no proposal to score.";
  const total = report.heartSet.count;
  const better: string[] = [];
  const tied: string[] = [];
  for (const row of report.rows) {
    if (row.method === "proposal" || !row.summary || !row.marks) continue;
    if (row.marks.coverage === "baseline-wins") better.push(`${NAMES[row.method].toLowerCase()} did better with ${row.summary.fit}`);
    if (row.marks.coverage === "tie") tied.push(NAMES[row.method].toLowerCase());
  }
  const parts = [`The agents' proposal fits ${proposal.summary.fit} of ${total} hidden hearts`];
  if (better.length) parts.push(better.join("; "));
  if (tied.length) parts.push(`tie with ${tied.join(" and ")}`);
  if (!better.length && !tied.length) parts.push("it beats every baseline");
  return `${parts.join("; ")}.`;
}

function Stat({ label, testId, children }: { label: string; testId: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd data-testid={testId} className="mt-1 text-sm">
        {children}
      </dd>
    </div>
  );
}

function Column({ row, total, proposals }: { row: ScoreRow; total: number; proposals: Proposal[] }) {
  const isProposal = row.method === "proposal";
  return (
    <section data-testid={`results-col-${row.method}`} className="flex min-w-0 flex-col gap-4 rounded-lg border border-panel-border bg-panel p-5">
      <h2 className="text-base font-semibold">{NAMES[row.method]}</h2>
      {row.summary ? (
        <dl className="space-y-3">
          <Stat label="Hidden-heart coverage" testId="coverage">
            <span className="text-2xl font-semibold">{row.summary.fit}</span> of {total} hidden hearts fit ({row.summary.fitPct}%)
          </Stat>
          <Stat label="New risks" testId="new-risk">
            {row.newRiskCount} new risk{row.newRiskCount === 1 ? "" : "s"}
          </Stat>
          <Stat label="Designs tried" testId="designs-tried">
            {row.designsTried}
          </Stat>
        </dl>
      ) : (
        <>
          <p className="text-sm">{row.reason ?? "No design to score."}</p>
          <p data-testid="designs-tried" className="text-sm">
            Designs tried: {row.designsTried}
          </p>
        </>
      )}
      {row.marks && (
        <div className="flex flex-wrap gap-2">
          <MarkBadge testId="mark-coverage" metric="Coverage" mark={row.marks.coverage} baselineName={NAMES[row.method]} />
          <MarkBadge testId="mark-new-risk" metric="New risks" mark={row.marks.newRisk} baselineName={NAMES[row.method]} />
        </div>
      )}
      {isProposal && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Claim verdict</h3>
          {proposals.length === 0 && <p className="text-sm text-muted">No proposals.</p>}
          {proposals.map((proposal) => (
            <p key={proposal.id} data-testid="results-verdict" data-proposal-id={proposal.id} data-verdict={proposal.verdict} className="text-sm font-semibold text-accent">
              {proposal.verdict ? verdictLabel(proposal.verdict) : "No verdict recorded."}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

export function ResultsView({ run, report }: { run: Run; report: ScoreReport }) {
  const columns = (["proposal", "no-change", "add-larger-size", "brute-force"] as const).flatMap((method) => report.rows.filter((row) => row.method === method));
  return (
    <div className="space-y-6">
      <p data-testid="output-line" className="text-lg font-medium">
        {outputLine(report)}
      </p>
      <div data-testid="results-table" data-run-id={run.id} className="grid grid-cols-4 gap-4">
        {columns.map((row) => (
          <Column key={row.method} row={row} total={report.heartSet.count} proposals={run.proposals} />
        ))}
      </div>
      <p data-testid="hidden-score-count" className="text-sm text-muted">
        Hidden hearts scored {report.hiddenScoreCount} {report.hiddenScoreCount === 1 ? "time" : "times"} for this run.
      </p>
      <p className="text-sm text-muted">{DISCLAIMER}</p>
    </div>
  );
}
