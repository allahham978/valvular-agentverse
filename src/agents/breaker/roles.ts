import type { Evidence } from "../../contracts";
import type { AgentRole, LoopContext } from "../../orchestrator/roles";
import { inventedNumbers } from "./number-guard";
import { attackPrompt, investigatePrompt } from "./prompts";

export const BREAKER_TOOLS = [
  "evaluate_design",
  "group_failures",
  "profile_group",
  "inspect_heart",
  "what_if",
  "stress_test",
  "report_findings",
];

type Draft = { title: string; explanation: string; evidenceIds: string[] };

function checkNumbers(report: Evidence, ctx: LoopContext): string | null {
  const findings = (report.result as { findings?: Draft[] } | null)?.findings ?? [];
  for (const [index, finding] of findings.entries()) {
    const cited = ctx.evidence.filter((item) => finding.evidenceIds.includes(item.id));
    const invented = [finding.title, finding.explanation].flatMap((text) => inventedNumbers(text, cited, ctx.design, ctx.limits));
    if (invented.length > 0) {
      return `Rejected: numbers not in the cited evidence: ${[...new Set(invented)].join(", ")} (finding ${index + 1}). Remove them or cite evidence that contains them. One retry left.`;
    }
  }
  return null;
}

const breakerRole = (prompt: AgentRole["prompt"]): AgentRole => ({
  actor: "breaker",
  prompt,
  toolNames: BREAKER_TOOLS,
  terminalTool: "report_findings",
  validate: checkNumbers,
});

export const breakerRoles = {
  investigate: breakerRole(investigatePrompt),
  attack: breakerRole(attackPrompt),
};
