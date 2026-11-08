import { randomUUID } from "node:crypto";
import {
  SummarySchema,
  type Design,
  type Evidence,
  type Limit,
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
import { defaultRoles, type AgentRole, type LoopContext } from "./roles";
import { parseReport, parseSubmission } from "./terminal";
import type { ToolOutcome, ToolRegistry } from "./tools";

export type Budget = { maxToolCallsPerTurn: number; maxTurnMs: number; maxRounds: number };

export const defaultBudget: Budget = { maxToolCallsPerTurn: 12, maxTurnMs: 60_000, maxRounds: 3 };

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
export type StopReason = "no-improvement" | "budget" | "no-valid-fix" | "model-error";

export type PostLoopContext = {
  stopReason: StopReason;
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

type Current = { design: Design; summary: Summary };

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

  async function evaluateAsCode(design: Design) {
    const outcome = await callTool("evaluate_design", { design });
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
    };
  }

  async function runStep(step: LoopStep, round: number): Promise<Evidence> {
    const role = roles[step];
    const ctx = context(step, round);
    emit({ actor: role.actor, type: "step-start", text: `${role.actor} started ${step}.`, data: { step, round } });

    const messages: ModelMessage[] = [{ role: "user", text: role.prompt(ctx) }];
    const toolSpecs = tools.specs().filter((spec) => role.toolNames.includes(spec.name));
    const guard = turnGuard(budget.maxTurnMs);
    let callCount = 0;
    try {
      for (;;) {
        const request: ModelRequest = {
          actor: role.actor,
          step,
          messages,
          tools: toolSpecs,
          signal: guard.signal,
        };
        const turn = await guard.within(model.nextTurn(request)).catch((error: unknown) => {
          if (error instanceof Stop) throw error;
          throw new Stop("model-error", error instanceof Error ? error.message : String(error));
        });
        if (turn.text) emit({ actor: role.actor, type: "model-text", text: turn.text });
        messages.push({ role: "model", turn });

        if (turn.toolCalls.length === 0) {
          if (role.actor === "fixer") throw new Stop("no-valid-fix", "The Fixer ended its turn without a proposal.");
          throw new Stop("model-error", "The Breaker ended its turn without reporting findings.");
        }

        const replies: ToolReply[] = [];
        for (const call of turn.toolCalls) {
          if (callCount >= budget.maxToolCallsPerTurn) {
            throw new Stop("budget", `More than ${budget.maxToolCallsPerTurn} tool calls in one turn.`, "maxToolCallsPerTurn");
          }
          callCount += 1;
          const outcome = await guard.within(callAs(role, call.name, call.args, ctx));
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
          if (outcome.ok && call.name === role.terminalTool) return outcome.evidence;
          replies.push(
            outcome.ok
              ? { name: call.name, evidenceId: outcome.evidence.id, result: outcome.evidence.result }
              : { name: call.name, error: outcome.error },
          );
        }
        messages.push({ role: "tool", replies });
      }
    } finally {
      guard.dispose();
    }
  }

  async function callAs(role: AgentRole, name: string, input: unknown, ctx: LoopContext): Promise<ToolOutcome> {
    if (!role.toolNames.includes(name)) return { ok: false, error: `Tool ${name} is not available to you.` };
    const outcome = await callTool(name, input);
    if (!outcome.ok) return outcome;
    if (name === role.terminalTool) {
      const error = checkTerminal(outcome.evidence) ?? role.validate?.(outcome.evidence, ctx) ?? null;
      if (error) return { ok: false, error };
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
    const proposal = {
      id: `proposal-${run.proposals.length + 1}`,
      fromDesignId: from.design.id,
      toDesignId: design.id,
      rationale,
      tradeOffs,
      ...(claim ? { claim } : {}),
      evidenceIds,
    };
    run.proposals.push(proposal);
    emit({ actor: "fixer", type: "proposal", text: rationale, data: { proposal, design } });

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

  async function loop(): Promise<never> {
    const first = await evaluateAsCode(startDesign);
    current = { design: startDesign, summary: first.summary };
    emit({
      actor: "code",
      type: "evaluation",
      text: `${startDesign.label} fits ${first.summary.fitPct.toFixed(1)}%${first.label ? ` [${first.label}]` : ""}.`,
      data: { designId: startDesign.id, summary: first.summary, evidenceId: first.evidenceId, ...(first.label ? { label: first.label } : {}) },
    });

    if (options.startAt !== "propose") recordFindings("investigate", await runStep("investigate", 0));
    for (let round = 1; ; round++) {
      current = await propose(round, current);
      recordFindings("attack", await runStep("attack", round));
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

  for (const step of options.postLoopSteps ?? []) {
    try {
      await step({ stopReason: stop.reason, run, design: current?.design ?? startDesign, emit });
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
  return run;
}
