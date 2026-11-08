import type { Design, Evidence, Finding, Limit, Proposal, Summary } from "../contracts";
import type { LoopStep } from "../agents/model-client";

export type LoopContext = {
  step: LoopStep;
  round: number;
  design: Design;
  summary: Summary;
  findings: Finding[];
  proposals: Proposal[];
  limits: Limit[];
};

export type AgentRole = {
  actor: "breaker" | "fixer";
  prompt(ctx: LoopContext): string;
  toolNames: string[];
  terminalTool: "report_findings" | "submit_proposal";
  validate?(evidence: Evidence, ctx: LoopContext): string | null;
};

const describe = (ctx: LoopContext) =>
  `Current design: ${JSON.stringify(ctx.design)}\nCurrent fit: ${ctx.summary.fitPct.toFixed(1)}%`;

export const defaultRoles: Record<LoopStep, AgentRole> = {
  investigate: {
    actor: "breaker",
    prompt: (ctx) =>
      `Find why hearts fail to fit this design. Evaluate it, then report findings with evidence IDs.\n${describe(ctx)}`,
    toolNames: ["evaluate_design", "group_failures", "profile_group", "inspect_heart", "what_if", "stress_test", "report_findings"],
    terminalTool: "report_findings",
  },
  propose: {
    actor: "fixer",
    prompt: (ctx) =>
      `Propose one design change that fixes the findings. Evaluate it, then submit it with evidence IDs.\n${describe(ctx)}\nFindings: ${JSON.stringify(ctx.findings)}`,
    toolNames: ["evaluate_design", "edit_design", "submit_proposal"],
    terminalTool: "submit_proposal",
  },
  attack: {
    actor: "breaker",
    prompt: (ctx) =>
      `Try to break the current design. Evaluate it, then report what still fails with evidence IDs.\n${describe(ctx)}`,
    toolNames: ["evaluate_design", "group_failures", "profile_group", "inspect_heart", "what_if", "stress_test", "report_findings"],
    terminalTool: "report_findings",
  },
};
