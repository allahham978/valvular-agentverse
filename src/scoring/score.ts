import type { Baseline, Design, Limit, Run, Summary } from "../contracts";
import { evaluateDesign } from "../engine";
import { bruteForce, SUPPORTED_LIMIT_KINDS } from "./brute-force";
import { hiddenHearts } from "./hidden-hearts";

export { SUPPORTED_LIMIT_KINDS };

type Mark = "proposal-wins" | "tie" | "baseline-wins";
export type Method = "proposal" | "no-change" | "add-larger-size" | "brute-force";

export type ScoreRow = {
  method: Method;
  design: Design | null;
  summary: Summary | null;
  coveragePct: number | null;
  newRiskCount: number | null;
  designsTried: number;
  marks?: { coverage: Mark; newRisk: Mark };
  reason?: string;
};

export type ScoreReport = {
  runId: string;
  heartSet: { split: "hidden"; count: number };
  hiddenScoreCount: number;
  limits: Limit[];
  rows: ScoreRow[];
};

export const unsupportedLimit = (limits: Limit[]) => limits.find((limit) => !SUPPORTED_LIMIT_KINDS.includes(limit.kind));

const sizeSetKey = (design: Design) =>
  JSON.stringify(
    design.sizes
      .map((size) => [size.nominalMm, size.minAnnulusMm, size.maxAnnulusMm])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]),
  );

function startDesignOf(run: Run): Design {
  const event = run.events.find((candidate) => candidate.type === "run-start");
  const design = (event?.data as { design?: Design } | null)?.design;
  if (!design) throw new Error("The run has no start design.");
  return design;
}

function finalDesignOf(run: Run, start: Design): Design {
  const proposed = new Map<string, Design>();
  let final = start;
  for (const event of run.events) {
    const data = event.data as { design?: Design; designId?: string; improved?: boolean } | null;
    if (event.type === "proposal" && data?.design) proposed.set(data.design.id, data.design);
    if (event.type === "evaluation" && data?.improved && data.designId) final = proposed.get(data.designId) ?? final;
  }
  return final;
}

function fixerDesignsTried(run: Run): number {
  const tried = new Set<string>();
  for (const event of run.events) {
    if (event.actor !== "fixer" || event.type !== "tool-call") continue;
    const data = event.data as { tool?: string; input?: { design?: Design }; result?: { valid?: boolean; design?: Design }; error?: string } | null;
    if (!data || data.error) continue;
    const design = data.tool === "edit_design" ? (data.result?.valid ? data.result.design : undefined) : data.tool === "evaluate_design" || data.tool === "submit_proposal" ? data.input?.design : undefined;
    if (design) tried.add(sizeSetKey(design));
  }
  return tried.size;
}

function addLargerSize(start: Design): Design {
  const top = Math.max(...start.sizes.map((size) => size.maxAnnulusMm));
  return {
    id: "baseline-add-larger-size",
    label: "Add a larger size",
    hypothetical: true,
    parentId: start.id,
    sizes: [...start.sizes, { nominalMm: top + 2, minAnnulusMm: top, maxAnnulusMm: top + 2 }],
  };
}

function scoreDesign(method: Method, design: Design, start: Design, designsTried: number): ScoreRow {
  const evaluation = evaluateDesign({ hearts: hiddenHearts(), design, parent: start, split: "hidden" });
  if (!evaluation.ok) throw new Error(`${design.label} breaks a design rule.`);
  const { summary } = evaluation;
  return { method, design, summary, coveragePct: summary.fitPct, newRiskCount: summary.newRiskHeartIds.length, designsTried };
}

function mark(proposal: number, baseline: number, higherIsBetter: boolean): Mark {
  if (proposal === baseline) return "tie";
  return proposal > baseline === higherIsBetter ? "proposal-wins" : "baseline-wins";
}

function withMarks(row: ScoreRow, proposal: ScoreRow): ScoreRow {
  if (!row.summary || !proposal.summary) return row;
  return {
    ...row,
    marks: {
      coverage: mark(proposal.summary.fit, row.summary.fit, true),
      newRisk: mark(proposal.newRiskCount ?? 0, row.newRiskCount ?? 0, false),
    },
  };
}

export function scoreRun(run: Run, extraLimits: Limit[] = []): ScoreReport {
  const limits = [...run.limits, ...extraLimits];
  const start = startDesignOf(run);
  const proposal = scoreDesign("proposal", finalDesignOf(run, start), start, fixerDesignsTried(run));
  const brute = bruteForce(start, limits);
  const bruteRow: ScoreRow = brute.design
    ? scoreDesign("brute-force", brute.design, start, brute.designsTried)
    : { method: "brute-force", design: null, summary: null, coveragePct: null, newRiskCount: null, designsTried: brute.designsTried, reason: brute.reason };
  const baselines = [
    scoreDesign("no-change", start, start, 1),
    scoreDesign("add-larger-size", addLargerSize(start), start, 1),
    bruteRow,
  ];
  return {
    runId: run.id,
    heartSet: { split: "hidden", count: hiddenHearts().length },
    hiddenScoreCount: run.hiddenScoreCount + 1,
    limits,
    rows: [proposal, ...baselines.map((row) => withMarks(row, proposal))],
  };
}

export function scoreAndRecord(run: Run, extraLimits: Limit[] = []): ScoreReport {
  const report = scoreRun(run, extraLimits);
  run.baselines = report.rows.flatMap((row): Baseline[] =>
    row.method !== "proposal" && row.design && row.summary
      ? [{ method: row.method, designId: row.design.id, summary: row.summary, designsTried: row.designsTried }]
      : [],
  );
  run.hiddenScoreCount = report.hiddenScoreCount;
  return report;
}
