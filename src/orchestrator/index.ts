import { randomUUID } from "node:crypto";
import {
  SummarySchema,
  type Design,
  type Evidence,
  type Limit,
  type Proposal,
  type Run,
  type RunEvent,
  type Summary,
} from "../contracts";
import type {
  LoopStep,
  ModelClient,
  ModelMessage,
  ModelRequest,
  ToolReply,
} from "../agents/model-client";
import { assignVerdict, type VerdictResult } from "../agents/attack/verdict";
import { saveRecording } from "../agents/gemini/recording";
import { defaultRoles, type AgentRole, type LastAttack, type LoopContext } from "./roles";
import { parseReport, parseSubmission } from "./terminal";
import type { ToolOutcome, ToolRegistry } from "./tools";
import { createTurnBudget } from "./turn-budget";

export type Budget = { maxStepsPerTurn: number; maxToolCallsPerTurn: number; maxTurnMs: number; maxRounds: number };

export const defaultBudget: Budget = { maxStepsPerTurn: 8, maxToolCallsPerTurn: 16, maxTurnMs: 180_000, maxRounds: 3 };

export const defaultStartDesign: Design = {
  id: "start",
  label: "Starting valve",
  hypothetical: true,
  sizes: [
    { nominalMm: 23, minAnnulusMm: 21, maxAnnulusMm: 23 },
    { nominalMm: 25, minAnnulusMm: 23, maxAnnulusMm: 25 },
    { nominalMm: 27, minAnnulusMm: 25, maxAnnulusMm: 27 },
  ],
};

type EmitInput = { actor: RunEvent["actor"]; type: string; text: string; data?: unknown };
export type StopReason = "no-improvement" | "budget" | "no-valid-fix" | "model-error" | "investigated";

export type PostLoopContext = {
  stopReason: StopReason;
  stopDetail: string;
  run: Run;
  design: Design;
  emit(event: EmitInput): void;
};
export type PostLoopStep = (ctx: PostLoopContext) => Promise<void>;

export type ExecuteRunOptions = {
  model: ModelClient;
  tools: ToolRegistry;
  id?: string;
  budget?: Partial<Budget>;
  roles?: Record<LoopStep, AgentRole>;
  seed?: number;
  startDesign?: Design;
  limits?: Limit[];
  startAt?: "investigate" | "propose";
  stopAfter?: "investigate";
  record?: boolean;
  postLoopSteps?: PostLoopStep[];
  onEvent?: (run: Run, event: RunEvent) => void;
};

class Stop extends Error {
  constructor(
    readonly reason: StopReason,
    readonly detail: string,
    readonly limit?: keyof Budget,
  ) {
    super(detail);
  }
}

type Called = ToolOutcome | { ok: false; error: string; rejected: true };

type Current = { design: Design; summary: Summary };
type Proposed = { design: Design; parent: Design; after: Summary };

const NO_VALID_FIX = "No design fits:";

const isInLimitEdit = (evidence: Evidence) => {
  const result = evidence.result as { valid?: boolean; limits?: { pass: boolean }[] } | null;
  return evidence.tool === "edit_design" && result?.valid === true && (result.limits ?? []).every((limit) => limit.pass);
};

const actorName = (role: AgentRole) => (role.actor === "fixer" ? "The Fixer" : "The Breaker");

function turnGuard(ms: number) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Stop("budget", `The agent turn took longer than ${ms} ms.`, "maxTurnMs"));
      controller.abort();
    }, ms);
  });
  expired.catch(() => undefined);
  return {
    signal: controller.signal,
    within: <T>(work: Promise<T>) => Promise.race([work, expired]),
    dispose() {
      clearTimeout(timer);
      controller.abort();
    },
  };
}

export async function executeRun(options: ExecuteRunOptions): Promise<Run> {
  const { model, tools } = options;
  const budget = { ...defaultBudget, ...options.budget };
  const roles = options.roles ?? defaultRoles;
  const startDesign = options.startDesign ?? defaultStartDesign;

  const run: Run = {
    id: options.id ?? randomUUID(),
    seed: options.seed ?? 0,
    startDesignId: startDesign.id,
    limits: options.limits ?? [],
    events: [],
    evidence: [],
    findings: [],
    proposals: [],
    baselines: [],
    hiddenScoreCount: 0,
  };
  let current: Current | undefined;
  let lastAttack: LastAttack | undefined;
  let turnEvidence: Evidence[] = [];
  const proposed = new Map<string, Proposed>();

  function emit({ actor, type, text, data = null }: EmitInput) {
    const event: RunEvent = {
      seq: run.events.length + 1,
      at: new Date().toISOString(),
      actor,
      type,
      text,
      data,
      mode: model.mode,
    };
    run.events.push(event);
    options.onEvent?.(run, event);
  }

  const record = (evidence: Evidence) => {
    if (!run.evidence.some((known) => known.id === evidence.id)) run.evidence.push(evidence);
  };

  async function evaluateAsCode(design: Design, parent?: Design) {
    const outcome = await callTool("evaluate_design", parent ? { design, parent } : { design });
    if (!outcome.ok) throw new Stop("model-error", `Could not evaluate ${design.label}: ${outcome.error}`);
    const summary = SummarySchema.safeParse(outcome.evidence.result);
    if (!summary.success) throw new Stop("model-error", "evaluate_design returned no summary.");
    record(outcome.evidence);
    const raw = outcome.evidence.result as { label?: unknown } | null;
    const label = typeof raw?.label === "string" ? raw.label : undefined;
    return { summary: summary.data, evidenceId: outcome.evidence.id, label };
  }

  async function callTool(name: string, input: unknown): Promise<ToolOutcome> {
    try {
      return await tools.call(name, input);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  function context(step: LoopStep, round: number): LoopContext {
    if (!current) throw new Error("No current design.");
    return {
      step,
      round,
      design: current.design,
      summary: current.summary,
      findings: run.findings,
      proposals: run.proposals,
      limits: run.limits,
      evidence: run.evidence,
      lastAttack,
    };
  }

  async function runStep(step: LoopStep, round: number): Promise<Evidence> {
    const role = roles[step];
    const ctx = context(step, round);
    emit({ actor: role.actor, type: "step-start", text: `${role.actor} started ${step}.`, data: { step, round } });

    const messages: ModelMessage[] = [{ role: "user", text: role.prompt(ctx) }];
    const toolSpecs = tools.specs().filter((spec) => role.toolNames.includes(spec.name));
    const guard = turnGuard(budget.maxTurnMs);
    const turnBudget = createTurnBudget(budget, role.terminalTool);
    let warned = false;
    let rejections = 0;
    const produced: Evidence[] = [];
    turnEvidence = produced;
    const budgetStop = (detail: string, limit: keyof Budget) =>
      role.actor === "fixer" && !produced.some(isInLimitEdit)
        ? new Stop("no-valid-fix", `${NO_VALID_FIX} ${detail.replace(/\.$/, "")} without a valid edit.`)
        : new Stop("budget", detail, limit);
    try {
      for (;;) {
        if (turnBudget.steps >= budget.maxStepsPerTurn) {
          throw budgetStop(`More than ${budget.maxStepsPerTurn} model steps in one turn.`, "maxStepsPerTurn");
        }
        const wrapUp = turnBudget.low();
        if (wrapUp && !warned) {
          warned = true;
          const left = turnBudget.left();
          emit({
            actor: "code",
            type: "budget-wrap-up",
            text: `${actorName(role)} has ${left.toolCallsLeft} tool calls, ${left.stepsLeft} model steps and ${left.secondsLeft} s left, so its next step can only call ${role.terminalTool}.`,
            data: { step, ...left, allowedTools: [role.terminalTool] },
          });
        }
        turnBudget.startStep();
        const request: ModelRequest = {
          actor: role.actor,
          step,
          messages,
          tools: toolSpecs,
          ...(wrapUp ? { allowedTools: [role.terminalTool] } : {}),
          signal: guard.signal,
        };
        const turn = await guard.within(model.nextTurn(request)).catch((error: unknown) => {
          if (error instanceof Stop) throw error;
          throw new Stop("model-error", error instanceof Error ? error.message : String(error));
        });
        if (turn.text) emit({ actor: role.actor, type: "model-text", text: turn.text });
        messages.push({ role: "model", turn });

        if (turn.toolCalls.length === 0) {
          if (role.actor === "fixer") throw new Stop("no-valid-fix", `${NO_VALID_FIX} the Fixer ended its turn without a proposal.`);
          throw new Stop("model-error", "The Breaker ended its turn without reporting findings.");
        }

        const replies: ToolReply[] = [];
        const skipped: string[] = [];
        const logSkipped = () => {
          if (skipped.length === 0) return;
          emit({
            actor: "code",
            type: "tool-skipped",
            text: `Skipped ${skipped.length} ${role.actor} tool call${skipped.length === 1 ? "" : "s"} to keep budget for ${role.terminalTool}.`,
            data: { step, tools: skipped },
          });
        };
        for (const call of turn.toolCalls) {
          if (turnBudget.calls >= budget.maxToolCallsPerTurn) {
            throw budgetStop(`More than ${budget.maxToolCallsPerTurn} tool calls in one turn.`, "maxToolCallsPerTurn");
          }
          if (turnBudget.keepsReserve(call.name)) {
            skipped.push(call.name);
            replies.push({ name: call.name, error: `skipped: budget. Not run, to keep tool calls for ${role.terminalTool}.` });
            continue;
          }
          turnBudget.useCall();
          const outcome = await guard.within(callAs(role, call.name, call.args, ctx));
          if (outcome.ok) produced.push(outcome.evidence);
          emit({
            actor: role.actor,
            type: "tool-call",
            text: outcome.ok ? `Called ${call.name}.` : `${call.name} failed: ${outcome.error}`,
            data: {
              tool: call.name,
              input: call.args,
              ...(outcome.ok
                ? { evidenceId: outcome.evidence.id, result: outcome.evidence.result }
                : { error: outcome.error }),
            },
          });
          if (!outcome.ok && "rejected" in outcome && (rejections += 1) > 1) {
            throw new Stop("model-error", `${call.name} failed validation again after one retry: ${outcome.error}`);
          }
          if (outcome.ok && call.name === role.terminalTool) {
            logSkipped();
            return outcome.evidence;
          }
          replies.push(
            outcome.ok
              ? { name: call.name, evidenceId: outcome.evidence.id, result: outcome.evidence.result }
              : { name: call.name, error: outcome.error },
          );
        }
        logSkipped();
        const left = turnBudget.left();
        messages.push({ role: "tool", replies: replies.map((reply) => ({ ...reply, budget: left })) });
      }
    } finally {
      guard.dispose();
    }
  }

  async function callAs(role: AgentRole, name: string, input: unknown, ctx: LoopContext): Promise<Called> {
    if (!role.toolNames.includes(name)) return { ok: false, error: `Tool ${name} is not available to you.` };
    const outcome = await callTool(name, input);
    if (!outcome.ok) return outcome;
    if (name === role.terminalTool) {
      const unparsed = checkTerminal(outcome.evidence);
      if (unparsed) return { ok: false, error: unparsed };
      const rejected = role.validate?.(outcome.evidence, ctx);
      if (rejected) return { ok: false, error: rejected, rejected: true };
    }
    record(outcome.evidence);
    return outcome;
  }

  function checkTerminal(evidence: Evidence): string | null {
    const known = new Set(run.evidence.map((item) => item.id));
    const parsed =
      evidence.tool === "report_findings"
        ? parseReport(evidence, known)
        : parseSubmission(evidence, known);
    return parsed.ok ? null : parsed.error;
  }

  function recordFindings(step: LoopStep, evidence: Evidence) {
    const known = new Set(run.evidence.map((item) => item.id));
    const report = parseReport(evidence, known);
    if (!report.ok) throw new Stop("model-error", report.error);
    const kind = step === "attack" ? "attack" : "mechanism";
    for (const draft of report.value.findings) {
      const finding = { ...draft, id: `finding-${run.findings.length + 1}`, kind } as const;
      run.findings.push(finding);
      emit({ actor: "breaker", type: kind === "attack" ? "attack" : "finding", text: finding.title, data: finding });
    }
  }

  async function propose(round: number, from: Current): Promise<Current> {
    const evidence = await runStep("propose", round);
    const submission = parseSubmission(evidence, new Set(run.evidence.map((item) => item.id)));
    if (!submission.ok) throw new Stop("model-error", submission.error);
    const { design, rationale, tradeOffs, claim, evidenceIds } = submission.value;
    const comparison = await evaluateAsCode(design, from.design);
    const proposal: Proposal = {
      id: `proposal-${run.proposals.length + 1}`,
      fromDesignId: from.design.id,
      toDesignId: design.id,
      rationale,
      tradeOffs,
      ...(claim ? { claim } : {}),
      evidenceIds,
    };
    run.proposals.push(proposal);
    proposed.set(proposal.id, { design, parent: from.design, after: comparison.summary });
    emit({
      actor: "fixer",
      type: "proposal",
      text: rationale,
      data: {
        proposal: { ...proposal },
        design,
        comparison: {
          before: from.summary,
          after: comparison.summary,
          newRiskHeartIds: comparison.summary.newRiskHeartIds,
          evidenceId: comparison.evidenceId,
        },
      },
    });

    const { summary, evidenceId, label } = await evaluateAsCode(design);
    const improved = summary.fitPct > from.summary.fitPct;
    emit({
      actor: "code",
      type: "evaluation",
      text: `${design.label} fits ${summary.fitPct.toFixed(1)}% (${improved ? "better than" : "no better than"} ${from.summary.fitPct.toFixed(1)}%)${label ? ` [${label}]` : ""}.`,
      data: { designId: design.id, summary, evidenceId, improved, ...(label ? { label } : {}) },
    });
    if (!improved) throw new Stop("no-improvement", `${design.label} does not beat the current design.`);
    return { design, summary };
  }

  function settle(proposal: Proposal, attacks: Evidence[]): VerdictResult | undefined {
    const info = proposed.get(proposal.id);
    if (!info) return undefined;
    const result = assignVerdict({ proposal, design: info.design, parent: info.parent, dev: info.after, evidence: run.evidence, attacks });
    proposal.verdict = result.verdict;
    proposal.notShown = result.notShown;
    emit({
      actor: "code",
      type: "verdict",
      text: `${proposal.id} is ${result.verdict}.`,
      data: { proposalId: proposal.id, verdict: result.verdict, notShown: result.notShown, dev: result.dev, attacks: result.attacks },
    });
    return result;
  }

  async function attackRound(round: number, proposal: Proposal) {
    const findingsBefore = run.findings.length;
    let stop: unknown;
    try {
      recordFindings("attack", await runStep("attack", round));
    } catch (error) {
      stop = error;
    }
    const result = settle(proposal, turnEvidence);
    if (result) {
      lastAttack = {
        verdict: result.verdict,
        notShown: result.notShown,
        outcomes: result.attacks,
        findings: run.findings.slice(findingsBefore),
      };
    }
    if (stop) throw stop;
  }

  async function loop(): Promise<never> {
    const first = await evaluateAsCode(startDesign);
    current = { design: startDesign, summary: first.summary };
    emit({
      actor: "code",
      type: "evaluation",
      text: `${startDesign.label} fits ${first.summary.fitPct.toFixed(1)}%${first.label ? ` [${first.label}]` : ""}.`,
      data: { designId: startDesign.id, summary: first.summary, evidenceId: first.evidenceId, ...(first.label ? { label: first.label } : {}) },
    });

    if (options.startAt !== "propose") {
      recordFindings("investigate", await runStep("investigate", 0));
      if (options.stopAfter === "investigate") throw new Stop("investigated", "The Breaker reported its findings.");
    }
    for (let round = 1; ; round++) {
      current = await propose(round, current);
      await attackRound(round, run.proposals[run.proposals.length - 1]);
      if (round >= budget.maxRounds) {
        throw new Stop("budget", `Completed ${budget.maxRounds} attack rounds.`, "maxRounds");
      }
    }
  }

  emit({ actor: "code", type: "run-start", text: "Run started on the starting valve.", data: { design: startDesign, budget } });

  let stop: Stop;
  try {
    stop = await loop();
  } catch (error) {
    stop =
      error instanceof Stop
        ? error
        : new Stop("model-error", error instanceof Error ? error.message : String(error));
  }

  for (const proposal of run.proposals) if (!proposal.verdict) settle(proposal, []);

  for (const step of options.postLoopSteps ?? []) {
    try {
      await step({ stopReason: stop.reason, stopDetail: stop.detail, run, design: current?.design ?? startDesign, emit });
    } catch (error) {
      emit({ actor: "code", type: "post-loop-error", text: error instanceof Error ? error.message : String(error) });
    }
  }
  emit({
    actor: "code",
    type: "run-stop",
    text: stop.detail,
    data: { reason: stop.reason, detail: stop.detail, ...(stop.limit && { limit: stop.limit }) },
  });
  if (options.record) saveRecording(run);
  return run;
}
