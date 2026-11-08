import type { LoopContext } from "../../orchestrator/roles";

const lines = (items: string[]) => (items.length ? items.map((item) => `- ${item}`).join("\n") : "- none");

const mechanisms = (ctx: LoopContext) =>
  lines(
    ctx.findings
      .filter((finding) => finding.kind === "mechanism")
      .map((finding) => `${finding.title}: ${finding.explanation} (evidence ${finding.evidenceIds.join(", ")})`),
  );

function lastAttack(ctx: LoopContext) {
  const last = ctx.lastAttack;
  if (!last) return "";
  const proposal = ctx.proposals.at(-1);
  return [
    `Your last proposal${proposal ? ` (${proposal.id})` : ""} got the verdict ${last.verdict}.`,
    `What the verdict does not show:\n${lines(last.notShown)}`,
    `Attack findings on it:\n${lines(last.findings.map((finding) => `${finding.title} (evidence ${finding.evidenceIds.join(", ")}): ${finding.explanation}`))}`,
    `Attack outcomes:\n${lines(last.outcomes.map((o) => `${o.kind}${o.amount === undefined ? "" : ` ${o.amount}`} on evidence ${o.evidenceId}: ${o.outcome}`))}`,
    "Say in your rationale how these attack findings changed this step, naming a finding by its title or evidence ID, or why they did not. Put the attack evidence IDs you respond to in evidenceIds.",
  ].join("\n\n");
}

export const fixerPrompt = (ctx: LoopContext) =>
  [
    "You are the Fixer. Propose one change to the current design that fixes the failure mechanisms the Breaker found.",
    "Use edit_design to apply one change to the current design. Its result already has the comparison with the current design and the check against every active limit, so pass the active limits to it. Pick a trade-off, then call submit_proposal once with the design from a valid edit_design result.",
    "The proposal needs a rationale, non-empty tradeOffs, a structured claim { metric: fitPct or newRiskCount, comparator: >= or <=, threshold } that the change should hold, and evidenceIds that include the edit_design evidence ID.",
    `Current design: ${JSON.stringify(ctx.design)}`,
    `Current fit: ${ctx.summary.fitPct.toFixed(1)}% fit, ${ctx.summary.risk} at risk, ${ctx.summary.noFit} with no fit, of ${ctx.summary.total} development hearts.`,
    `Active limits: ${ctx.limits.length ? JSON.stringify(ctx.limits) : "none"}`,
    `Failure mechanisms:\n${mechanisms(ctx)}`,
    lastAttack(ctx),
    "Use only numbers that appear in the cited evidence, the designs or the active limits. Do not estimate or compute new numbers. A design that breaks an active limit or has a size wider than the rules allow is rejected.",
    "You have at most 8 model steps, 16 tool calls and 180 seconds. Every tool response includes budgetLeft: the tool calls, model steps and seconds you have left. Call submit_proposal as soon as you have a valid edit, and before budgetLeft runs low.",
  ]
    .filter(Boolean)
    .join("\n\n");
