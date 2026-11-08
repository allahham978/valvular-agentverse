import type { ScoreRow } from "@/scoring";

type Mark = NonNullable<ScoreRow["marks"]>["coverage"];

export function MarkBadge({ testId, metric, mark, baselineName }: { testId: string; metric: string; mark: Mark; baselineName: string }) {
  const verdict = mark === "tie" ? "Tie" : mark === "proposal-wins" ? "Proposal better" : `${baselineName} better`;
  return (
    <span
      data-testid={testId}
      data-mark={mark}
      className="inline-flex min-h-6 items-center rounded-md border border-accent bg-[#e6f4f1] px-2 py-0.5 text-sm font-semibold text-[#0b3b36]"
    >
      {metric}: {verdict}
    </span>
  );
}
