import type { Design, Evidence, Finding, Limit, Proposal, Summary } from "../contracts";
import { attackRole } from "../agents/attack/role";
import type { VerdictResult } from "../agents/attack/verdict";
import { breakerRoles } from "../agents/breaker/roles";
import { fixerRole } from "../agents/fixer/role";
import type { LoopStep } from "../agents/model-client";

export type LastAttack = Pick<VerdictResult, "verdict" | "notShown"> & {
  findings: Finding[];
  outcomes: VerdictResult["attacks"];
};

export type LoopContext = {
  step: LoopStep;
  round: number;
  design: Design;
  summary: Summary;
  findings: Finding[];
  proposals: Proposal[];
  limits: Limit[];
  evidence: Evidence[];
  lastAttack?: LastAttack;
};

export type AgentRole = {
  actor: "breaker" | "fixer";
  prompt(ctx: LoopContext): string;
  toolNames: string[];
  terminalTool: "report_findings" | "submit_proposal";
  validate?(evidence: Evidence, ctx: LoopContext): string | null;
};

export const defaultRoles: Record<LoopStep, AgentRole> = {
  investigate: breakerRoles.investigate,
  propose: fixerRole,
  attack: attackRole,
};
