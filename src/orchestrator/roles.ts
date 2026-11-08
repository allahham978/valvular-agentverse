import type { Design, Evidence, Finding, Limit, Proposal, Summary } from "../contracts";
import { breakerRoles } from "../agents/breaker/roles";
import type { LoopStep } from "../agents/model-client";

export type LoopContext = {
  step: LoopStep;
  round: number;
  design: Design;
  summary: Summary;
  findings: Finding[];
  proposals: Proposal[];
  limits: Limit[];
  evidence: Evidence[];
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
  investigate: breakerRoles.investigate,
  propose: {
    actor: "fixer",
    prompt: (ctx) =>
      `Propose one design change that fixes the findings. Evaluate it, then submit it with evidence IDs.\n${describe(ctx)}\nFindings: ${JSON.stringify(ctx.findings)}`,
    toolNames: ["evaluate_design", "edit_design", "submit_proposal"],
    terminalTool: "submit_proposal",
  },
  attack: breakerRoles.attack,
};
