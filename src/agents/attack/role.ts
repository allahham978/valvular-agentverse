import type { AgentRole, LoopContext } from "../../orchestrator/roles";
import { breakerRoles } from "../breaker/roles";

function underAttack(ctx: LoopContext) {
  const proposal = ctx.proposals.at(-1);
  if (!proposal) return "";
  const claim = proposal.claim ? `${proposal.claim.metric} ${proposal.claim.comparator} ${proposal.claim.threshold}` : "none";
  return [
    `Proposal under attack (${proposal.id}): ${proposal.rationale}`,
    `Its claim: ${claim}. Try to make this claim fail with stress_test on the proposed design, which is the current design below.`,
    `Parent design it changes: ${proposal.fromDesignId}`,
  ].join("\n");
}

export const attackRole: AgentRole = {
  ...breakerRoles.attack,
  prompt: (ctx) => [underAttack(ctx), breakerRoles.attack.prompt(ctx)].filter(Boolean).join("\n\n"),
};
