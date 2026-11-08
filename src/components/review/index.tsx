import type { Design, Run } from "@/contracts";
import { notTested, reviewedProposal, type Reviewed } from "@/orchestrator/review-step";
import { DecisionForm } from "./decision-form";

const label = (verdict: string) => {
  const text = verdict.replaceAll("_", " ");
  return text[0].toUpperCase() + text.slice(1);
};

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section data-testid={id} className="rounded-lg border border-panel-border bg-panel p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h2>
      <div className="mt-3 text-sm leading-relaxed">{children}</div>
    </section>
  );
}

const List = ({ items }: { items: string[] }) =>
  items.length === 0 ? <p className="text-muted">None.</p> : (
    <ul className="list-disc space-y-1 pl-5">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );

function Sizes({ design }: { design: Design }) {
  return (
    <div>
      <p className="font-medium">{design.label}</p>
      <ul className="mt-1 flex flex-wrap gap-2 font-mono tabular-nums">
        {design.sizes.map((size) => (
          <li key={size.nominalMm} className="rounded border border-panel-border px-2 py-0.5">
            {" "}
            {size.nominalMm} mm
          </li>
        ))}
      </ul>
    </div>
  );
}

export function EmptyReview({ message }: { message: string }) {
  return <p className="text-muted">{message}</p>;
}

export function ReviewView({ run }: { run: Run }) {
  const reviewed: Reviewed | null = reviewedProposal(run);
  if (!reviewed) return <EmptyReview message="This run has no improved proposal to review." />;
  const { proposal } = reviewed;

  return (
    <div className="space-y-4">
      <Section id="review-change" title="The change">
        <div className="grid grid-cols-2 gap-6">
          <Sizes design={reviewed.parent} />
          <Sizes design={reviewed.design} />
        </div>
        <p className="mt-4 border-t border-panel-border pt-3 font-mono tabular-nums">
          Fit {reviewed.fitBefore.toFixed(1)}% to {reviewed.fitAfter.toFixed(1)}%
        </p>
        <p className="mt-2 text-muted">{proposal.rationale}</p>
      </Section>
      <Section id="review-trade-offs" title="Trade-offs">
        <List items={proposal.tradeOffs} />
      </Section>
      <Section id="review-attacks" title="Attacks">
        {reviewed.attacks.length === 0 ? (
          <p className="text-muted">No attack findings were recorded.</p>
        ) : (
          <ul className="space-y-2">
            {reviewed.attacks.map((attack) => (
              <li key={attack.id}>
                <span className="font-medium">{attack.title}</span>
                <span className="text-muted"> ({attack.severity})</span>
                <p className="text-muted">{attack.explanation}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section id="review-verdict" title="Verdict">
        <p className="text-base font-semibold text-accent">{proposal.verdict ? label(proposal.verdict) : "No verdict recorded."}</p>
      </Section>
      <Section id="review-not-shown" title="What the verdict does not show">
        <List items={proposal.notShown ?? []} />
      </Section>
      <Section id="review-not-tested" title="Not tested">
        <List items={notTested(run, reviewed)} />
      </Section>
      <Section id="review-evidence" title="Evidence log">
        <ul className="max-h-64 space-y-1 overflow-y-auto font-mono text-xs">
          {run.evidence.map((item) => (
            <li key={item.id} className="break-all">
              {item.id} <span className="text-muted">{item.tool} {item.source ?? ""}</span>
            </li>
          ))}
        </ul>
      </Section>
      <DecisionForm runId={run.id} decision={run.decision} />
    </div>
  );
}
