import type { Baseline, Run, Summary } from "@/contracts";

export type ResultsData = {
  proposal: { summary: Summary; designsTried: number };
  baselines: Baseline[];
  hiddenScoreCount: Run["hiddenScoreCount"];
};

const baselineLabels: Record<Baseline["method"], string> = {
  "no-change": "No change",
  "add-larger-size": "Add one larger size",
  "brute-force": "Brute force",
};

const number = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });

function signed(value: number) {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${number.format(Math.abs(value))}`;
}

export function ResultsComparison({ results }: { results: ResultsData }) {
  const { proposal, baselines, hiddenScoreCount } = results;
  const { summary } = proposal;
  const noChange = baselines.find((baseline) => baseline.method === "no-change");
  const designs = [
    { label: "Proposal", ...proposal },
    ...baselines.map((baseline) => ({ label: baselineLabels[baseline.method], ...baseline })),
  ];
  const change = noChange
    ? `; ${signed(summary.fitPct - noChange.summary.fitPct)} percentage points vs no change`
    : "";
  const output = `Proposal: ${number.format(summary.fit)} of ${number.format(summary.total)} hidden test hearts fit (${number.format(summary.fitPct)}%)${change}; ${number.format(summary.newRiskHeartIds.length)} new risks; ${number.format(proposal.designsTried)} designs tried.`;

  return (
    <>
      <section className="panel overflow-hidden" aria-labelledby="comparison-heading">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-panel-border px-6 py-4">
          <div>
            <h2 id="comparison-heading" className="text-lg font-semibold">Hidden-heart comparison</h2>
            <p className="mt-1 text-sm text-muted">
              All four designs use the same {number.format(summary.total)} hidden test hearts.
            </p>
          </div>
          <p data-testid="hidden-score-count" className="text-sm text-muted">
            Hidden hearts scored <span className="mono font-medium text-foreground">{number.format(hiddenScoreCount)}</span> {hiddenScoreCount === 1 ? "time" : "times"}
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] table-fixed text-left">
            <caption className="sr-only">Hidden-heart comparison</caption>
            <colgroup>
              <col className="w-[24%]" />
              {designs.map((design) => <col key={design.summary.designId} className="w-[19%]" />)}
            </colgroup>
            <thead>
              <tr className="border-b border-panel-border bg-background/60">
                <th scope="col" className="px-6 py-4 text-sm font-medium text-muted">Design</th>
                {designs.map((design) => (
                  <th key={design.summary.designId} scope="col" className="px-6 py-4 text-base font-semibold">
                    {design.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-panel-border">
                <th scope="row" className="px-6 py-5 font-medium">
                  Hidden-heart coverage
                  <span aria-hidden="true" className="mt-1 block text-sm font-normal text-muted">Fit / all hidden test hearts</span>
                </th>
                {designs.map(({ summary: score }) => (
                  <td key={score.designId} className="px-6 py-5">
                    <span className="mono text-3xl font-medium tracking-tight">{number.format(score.fitPct)}%</span>
                    <span className="mt-2 block text-sm text-muted">{number.format(score.fit)} of {number.format(score.total)} fit</span>
                  </td>
                ))}
              </tr>
              <tr className="border-b border-panel-border">
                <th scope="row" className="px-6 py-4 font-medium">
                  New risks
                  <span aria-hidden="true" className="mt-1 block text-sm font-normal text-muted">Newly at risk vs no change</span>
                </th>
                {designs.map(({ summary: score }) => (
                  <td key={score.designId} className="mono px-6 py-4 text-xl">{number.format(score.newRiskHeartIds.length)}</td>
                ))}
              </tr>
              <tr className="border-b border-panel-border">
                <th scope="row" className="px-6 py-4 font-medium">
                  Designs tried
                  <span aria-hidden="true" className="mt-1 block text-sm font-normal text-muted">Candidate designs evaluated</span>
                </th>
                {designs.map((design) => (
                  <td key={design.summary.designId} className="mono px-6 py-4 text-xl">{number.format(design.designsTried)}</td>
                ))}
              </tr>
              <tr>
                <th scope="row" className="px-6 py-4 font-medium">
                  Coverage outcome
                  <span aria-hidden="true" className="mt-1 block text-sm font-normal text-muted">Compared with the proposal</span>
                </th>
                <td className="px-6 py-4 text-sm text-muted">Reference</td>
                {baselines.map((baseline) => {
                  const difference = baseline.summary.fitPct - summary.fitPct;
                  const outcome = difference > 0 ? "Baseline wins" : difference < 0 ? "Proposal wins" : "Tie with proposal";
                  return (
                    <td key={baseline.designId} className="px-6 py-4">
                      <span data-testid="comparison-outcome" className="inline-flex rounded-md border border-panel-border bg-background px-3 py-1.5 text-sm font-semibold">
                        {outcome}
                      </span>
                      <span className="mt-2 block text-sm text-muted">
                        {difference === 0 ? "Same coverage" : `${number.format(Math.abs(difference))} pp ${difference > 0 ? "higher" : "lower"}`}
                      </span>
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="border-t border-panel-border px-6 py-3 text-sm text-muted">
          Outcomes compare coverage only. New risks and designs tried are separate trade-offs.
        </p>
      </section>

      <section aria-labelledby="output-heading" className="mt-6 border-l-2 border-accent pl-5">
        <h2 id="output-heading" className="text-sm font-semibold">Output</h2>
        <p data-testid="results-output" className="mt-2 text-base leading-relaxed">{output}</p>
      </section>

      <footer className="mt-6 text-sm leading-relaxed text-muted">
        <p className="font-medium text-foreground">Test hearts, not patients. All hearts come from one generator.</p>
        <p className="mt-1">Coverage describes fit under demo-assumption rules. It is not a safety assessment.</p>
      </footer>
    </>
  );
}
