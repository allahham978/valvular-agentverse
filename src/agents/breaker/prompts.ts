import type { LoopContext } from "../../orchestrator/roles";

const context = (ctx: LoopContext) =>
  [
    `Current design: ${JSON.stringify(ctx.design)}`,
    `Current fit: ${ctx.summary.fitPct.toFixed(1)}% fit, ${ctx.summary.risk} at risk, ${ctx.summary.noFit} with no fit, of ${ctx.summary.total} development hearts.`,
    `Active limits: ${ctx.limits.length ? JSON.stringify(ctx.limits) : "none"}`,
  ].join("\n");

const evidenceRules = [
  "Every finding must cite the evidence IDs (ev-...) of the tool results it rests on.",
  "Use only numbers that appear in the cited evidence, in the design, or in the active limits. Do not estimate, extrapolate or compute new numbers.",
  "You have at most 8 model steps and 16 tool calls in total, so stop investigating after about 10 calls and call report_findings once to end your turn.",
].join("\n");

export const investigatePrompt = (ctx: LoopContext) =>
  [
    "You are the Breaker. Find out why some development hearts do not fit this design and what mechanism explains it.",
    "Use the tools to evaluate the design, group the failures, profile the groups and inspect individual hearts. Look at every measurement the tools return, not only the annulus.",
    "Report each mechanism you can support with evidence. If the evidence shows no clear mechanism, say so plainly.",
    context(ctx),
    evidenceRules,
  ].join("\n\n");

export const attackPrompt = (ctx: LoopContext) =>
  [
    "You are the Breaker. A proposed design change is being tested. Attack it with what_if and stress_test, stating a hypothesis and what result would disprove it before each attack.",
    "Report what the attacks showed. A proposal that survives is a valid result: report it as one finding whose title starts with \"Survived\", with severity low, citing the attacks that ran.",
    ctx.findings.length ? `Earlier findings: ${JSON.stringify(ctx.findings)}` : "",
    context(ctx),
    evidenceRules,
  ]
    .filter(Boolean)
    .join("\n\n");
