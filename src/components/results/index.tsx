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

const MEANING: Record<ScoreRow["method"], string> = {
  proposal: "The final fix from the Breaker and Fixer loop",
  "no-change": "The starting valve as it was",
  "add-larger-size": "The obvious manual fix",
  "brute-force": "A computer trying every allowed size combination",
};

const VERDICT_PLAIN: Record<string, string> = {
  supported_under_conditions: "held up under attack",
  context_dependent: "broke under an attack",
  contradicted: "failed on the dev hearts",
  inconclusive: "no attack finished",
  invalid_experiment: "evidence didn't check out",
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
    if (row.marks.coverage === "baseline-wins") better.push(`${NAMES[row.method].toLowerCase()} fits more (${row.summary.fit})`);
    if (row.marks.coverage === "tie") tied.push(NAMES[row.method].toLowerCase());
  }
  const head = `The agents' fix fits ${proposal.summary.fit} of ${total} hidden hearts`;
  if (!better.length && !tied.length) return `${head}, more than every other approach.`;
  const parts = [head];
  if (better.length) parts.push(better.join("; "));
  if (tied.length) parts.push(`same as ${tied.join(" and ")}`);
  return `${parts.join("; ")}.`;
}

function Column({ row, total, proposals }: { row: ScoreRow; total: number; proposals: Proposal[] }) {
  const isProposal = row.method === "proposal";
  const pct = row.summary ? Math.round((row.summary.fit / total) * 100) : 0;
  return (
    <section
      data-testid={`results-col-${row.method}`}
      className={`flex min-w-0 flex-col gap-4 rounded-lg border bg-panel p-5 ${isProposal ? "border-accent ring-1 ring-accent" : "border-panel-border"}`}
    >
      <div>
        <h2 className="text-base font-semibold">{NAMES[row.method]}</h2>
        <p className="mt-0.5 text-xs text-muted">{MEANING[row.method]}</p>
      </div>
      {row.summary ? (
        <>
          <div>
            <p data-testid="coverage" className="text-sm text-muted">
              <span className={`text-4xl font-semibold ${isProposal ? "text-accent" : "text-foreground"}`}>{row.summary.fit}</span> of {total} hidden hearts fit
            </p>
            <div className="mt-2 h-2 rounded-full bg-background" aria-hidden>
              <div className={`h-2 rounded-full ${isProposal ? "bg-accent" : "bg-muted/50"}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
          <p data-testid="new-risk" className="text-sm">
            New risk: <span className="font-semibold">{row.newRiskCount}</span> {row.newRiskCount === 1 ? "heart" : "hearts"}
          </p>
          <p data-testid="designs-tried" className="text-xs text-muted">
            Designs tried: {row.designsTried}
          </p>
        </>
      ) : (
        <>
          <p className="text-sm">{row.reason ?? "No design to score."}</p>
          <p data-testid="designs-tried" className="text-xs text-muted">
            Designs tried: {row.designsTried}
          </p>
        </>
      )}
      {row.marks && (
        <div className="mt-auto flex flex-wrap gap-1.5">
          <MarkBadge testId="mark-coverage" metric="Fit" mark={row.marks.coverage} baselineName={NAMES[row.method]} />
          <MarkBadge testId="mark-new-risk" metric="New risk" mark={row.marks.newRisk} baselineName={NAMES[row.method]} />
        </div>
      )}
      {isProposal && (
        <div className="mt-auto space-y-1.5 border-t border-panel-border pt-3">
          <h3 className="text-xs font-medium text-muted">What the Breaker&rsquo;s attacks showed</h3>
          {proposals.length === 0 && <p className="text-sm text-muted">No proposals.</p>}
          {proposals.map((proposal, index) => (
            <p key={proposal.id} data-testid="results-verdict" data-proposal-id={proposal.id} data-verdict={proposal.verdict} className="text-sm">
              <span className="text-muted">Fix {index + 1}: </span>
              {proposal.verdict ? (
                <>
                  <span className="font-semibold">{VERDICT_PLAIN[proposal.verdict] ?? verdictLabel(proposal.verdict)}</span>
                  <span className="text-muted"> ({verdictLabel(proposal.verdict).toLowerCase()})</span>
                </>
              ) : (
                "No verdict recorded."
              )}
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
      <p className="max-w-3xl text-muted">
        The agents only ever worked on 400 hearts. We kept {report.heartSet.count} more hidden from them, and only our code scores them, to check the fix works on hearts it has never seen.
      </p>
      <p data-testid="output-line" className="text-2xl font-semibold tracking-tight">
        {outputLine(report)}
      </p>
      <div data-testid="results-table" data-run-id={run.id} className="grid grid-cols-4 gap-4">
        {columns.map((row) => (
          <Column key={row.method} row={row} total={report.heartSet.count} proposals={run.proposals} />
        ))}
      </div>
      <div className="space-y-1 text-xs text-muted">
        <p data-testid="hidden-score-count">
          Hidden hearts scored {report.hiddenScoreCount} {report.hiddenScoreCount === 1 ? "time" : "times"} for this run, so results can&rsquo;t be re-rolled until they look good.
        </p>
        <p>{DISCLAIMER}</p>
      </div>
    </div>
  );
}
