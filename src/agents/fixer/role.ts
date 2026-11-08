import type { Evidence } from "../../contracts";
import type { AgentRole, LoopContext } from "../../orchestrator/roles";
import { parseSubmission } from "../../orchestrator/terminal";
import { checkLimits, measuredOf } from "../../tools/design";
import { ToolError } from "../../tools/evidence";
import { evaluate } from "../../tools/fit";
import { inventedNumbers } from "../breaker/number-guard";
import { fixerPrompt } from "./prompt";

function checkProposal(evidence: Evidence, ctx: LoopContext): string | null {
  const submission = parseSubmission(evidence, new Set(ctx.evidence.map((item) => item.id)));
  if (!submission.ok) return submission.error;
  const { design, rationale, tradeOffs, evidenceIds } = submission.value;

  if (ctx.limits.length > 0) {
    const child = evaluate(design, { parent: ctx.design });
    if (!child.ok) return `Rejected: ${child.reasons.map((reason) => reason.message).join(" ")}`;
    try {
      const broken = checkLimits(ctx.limits, measuredOf(design, child.summary)).find((limit) => !limit.pass);
      if (broken) return `Rejected: the design breaks limit ${broken.id} (${broken.kind}): ${broken.detail} Change the design or pick another trade-off.`;
    } catch (error) {
      if (error instanceof ToolError) return `Rejected: ${error.message}`;
      throw error;
    }
  }

  const cited = ctx.evidence.filter((item) => evidenceIds.includes(item.id));
  const invented = [rationale, ...tradeOffs].flatMap((text) => {
    const outsideProposed = inventedNumbers(text, cited, design, ctx.limits);
    const outsideCurrent = new Set(inventedNumbers(text, cited, ctx.design, ctx.limits));
    return outsideProposed.filter((written) => outsideCurrent.has(written));
  });
  if (invented.length > 0) {
    return `Rejected: numbers not in the cited evidence: ${[...new Set(invented)].join(", ")}. Remove them or cite evidence that contains them. One retry left.`;
  }
  return null;
}

export const fixerRole: AgentRole = {
  actor: "fixer",
  prompt: fixerPrompt,
  toolNames: ["evaluate_design", "edit_design", "submit_proposal"],
  terminalTool: "submit_proposal",
  validate: checkProposal,
};
