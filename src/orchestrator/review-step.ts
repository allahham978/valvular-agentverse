import type { ModelClient } from "../agents/model-client";
import type { Decision, Design, Finding, Proposal, Run, RunEvent } from "../contracts";
import { executeRun, type ExecuteRunOptions } from "./index";
import { defaultRoles, type AgentRole } from "./roles";
import type { ToolRegistry } from "./tools";
import { createAgentTools } from "../tools";

export const STRESS_KINDS = ["measurement_shift", "assumption_shift", "subgroup"] as const;

export type Refusal = { ok: false; status: 400 | 404 | 409; error: string };
export type Reviewed = {
  proposal: Proposal;
  design: Design;
  parent: Design;
  fitBefore: number;
  fitAfter: number;
  attacks: Finding[];
  stressKinds: string[];
};
export type DecisionInput = { status: Decision["status"]; by: string; note: string };

const hasFinished = (run: Run) => run.events.at(-1)?.type === "run-stop";
const dataOf = <T>(event: RunEvent) => event.data as T;

type Evaluated = { designId: string; summary: { fitPct: number }; improved?: boolean };
type Proposed = { proposal: { id: string }; design: Design };

export function reviewedProposal(run: Run): Reviewed | null {
  const proposalEvents = run.events.filter((event) => event.type === "proposal");
  for (let index = proposalEvents.length - 1; index >= 0; index--) {
    const { proposal: ref, design } = dataOf<Proposed>(proposalEvents[index]);
    const proposal = run.proposals.find((item) => item.id === ref.id);
    if (!proposal) continue;
    const evaluation = run.events
      .filter((event) => event.type === "evaluation" && event.seq > proposalEvents[index].seq)
      .map((event) => dataOf<Evaluated>(event))
      .find((data) => data.designId === proposal.toDesignId);
    if (!evaluation?.improved) continue;

    const before = run.events
      .filter((event) => event.type === "evaluation" && event.seq < proposalEvents[index].seq)
      .map((event) => dataOf<Evaluated>(event))
      .findLast((data) => data.designId === proposal.fromDesignId);
    const parent =
      [
        ...proposalEvents.slice(0, index).map((event) => dataOf<Proposed>(event).design),
        dataOf<{ design: Design }>(run.events.find((event) => event.type === "run-start")!).design,
      ].find((candidate) => candidate.id === proposal.fromDesignId) ?? null;
    if (!before || !parent) continue;

    const next = proposalEvents[index + 1]?.seq ?? Infinity;
    const window = run.events.filter((event) => event.seq > proposalEvents[index].seq && event.seq < next);
    return {
      proposal,
      design,
      parent,
      fitBefore: before.summary.fitPct,
      fitAfter: evaluation.summary.fitPct,
      attacks: window.filter((event) => event.type === "attack").map((event) => dataOf<Finding>(event)),
      stressKinds: window
        .filter((event) => event.type === "tool-call")
        .map((event) => dataOf<{ tool: string; input?: { kind?: string } }>(event))
        .filter((data) => data.tool === "stress_test" && data.input?.kind)
        .map((data) => data.input!.kind!),
    };
  }
  return null;
}

export function notTested(run: Run, reviewed: Reviewed): string[] {
  const lines: string[] = [];
  if (run.hiddenScoreCount === 0) lines.push("Hidden test hearts were not scored for this change.");
  for (const kind of STRESS_KINDS) {
    if (!reviewed.stressKinds.includes(kind)) lines.push(`No ${kind.replace("_", " ")} attack was run on the proposed design.`);
  }
  return lines;
}

export function saveDecision(run: Run, input: DecisionInput): { ok: true; decision: Decision } | Refusal {
  const by = input.by.trim();
  const note = input.note.trim();
  if (!by) return { ok: false, status: 400, error: "Enter your name to record a decision." };
  if (input.status === "rejected" && !note) return { ok: false, status: 400, error: "Add a note for the Fixer to reject." };
  if (!hasFinished(run)) return { ok: false, status: 409, error: "The run has not finished." };
  const reviewed = reviewedProposal(run);
  if (!reviewed) return { ok: false, status: 409, error: "This run has no improved proposal to review." };
  if (run.decision) return { ok: false, status: 409, error: "A decision is already saved for this run." };
  run.decision = { status: input.status, designId: reviewed.proposal.toDesignId, by, note, at: new Date().toISOString() };
  return { ok: true, decision: run.decision };
}

export function requireDecision(run: Run, use: "export" | "final-design"): Refusal | null {
  if (!run.decision) return { ok: false, status: 409, error: "Save an engineer decision first." };
  if (use === "final-design" && run.decision.status !== "approved") {
    return { ok: false, status: 409, error: "The engineer did not approve this design." };
  }
  return null;
}

export function replanOptions(run: Run, note: string): Pick<ExecuteRunOptions, "startAt" | "startDesign" | "limits" | "roles"> {
  const reviewed = reviewedProposal(run);
  if (!reviewed) throw new Error("This run has no improved proposal to replan from.");
  const fixer = defaultRoles.propose;
  const roles: Record<keyof typeof defaultRoles, AgentRole> = {
    ...defaultRoles,
    propose: {
      ...fixer,
      prompt: (ctx) =>
        `${fixer.prompt(ctx)}\n\nThe engineer rejected ${reviewed.design.label}: ${note}\nPropose a different change that respects this note.`,
    },
  };
  return { startAt: "propose", startDesign: reviewed.parent, limits: run.limits, roles };
}

export function replanAfterReject(run: Run, note: string, options: { model: ModelClient; tools?: ToolRegistry }): Promise<Run> {
  return executeRun({ model: options.model, tools: options.tools ?? createAgentTools(), ...replanOptions(run, note) });
}
