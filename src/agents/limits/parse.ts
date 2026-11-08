import { createHash } from "node:crypto";
import type { Limit } from "../../contracts";
import type { ModelClient } from "../model-client";
import { LIMIT_KINDS, LIMIT_TOOLS, limitPrompt, type LimitKind } from "./prompt";

export type ParsedLimit = { ok: true; limit: Limit } | { ok: false; reason: string };

const NUMBER_WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

const isRange: Record<LimitKind, (value: number) => boolean> = {
  "max-sizes": (value) => Number.isInteger(value) && value >= 1,
  "min-fit-pct": (value) => value >= 0 && value <= 100,
  "max-new-risk": (value) => Number.isInteger(value) && value >= 0,
};

function appearsIn(text: string, value: number) {
  const lower = text.toLowerCase();
  if (new RegExp(`(^|[^\\d.])${value}(?![\\d])`).test(lower)) return true;
  const word = NUMBER_WORDS[value - 1];
  return Boolean(word) && new RegExp(`\\b${word}\\b`).test(lower);
}

const refusal = (detail?: string): ParsedLimit => ({
  ok: false,
  reason: `That is outside fit. Supported limits: ${LIMIT_KINDS.join(", ")}.${detail ? ` ${detail}` : ""}`,
});

export async function parseLimit({ text, model }: { text: string; model: ModelClient }): Promise<ParsedLimit> {
  const controller = new AbortController();
  let turn;
  try {
    turn = await model.nextTurn({
      actor: "fixer",
      step: "propose",
      messages: [{ role: "user", text: limitPrompt(text) }],
      tools: LIMIT_TOOLS,
      signal: controller.signal,
    });
  } catch {
    return refusal("The limit could not be checked.");
  }

  const [call] = turn.toolCalls;
  if (turn.toolCalls.length !== 1) return refusal();
  if (call.name === "refuse_limit") {
    const reason = (call.args as { reason?: unknown } | null)?.reason;
    return refusal(typeof reason === "string" ? reason : undefined);
  }
  if (call.name !== "set_limit") return refusal();

  const { kind, value } = (call.args ?? {}) as { kind?: unknown; value?: unknown };
  const supported = LIMIT_KINDS.find((known) => known === kind);
  if (!supported || typeof value !== "number" || !isRange[supported](value) || !appearsIn(text, value)) {
    return refusal();
  }
  const id = createHash("sha256").update(`${supported}:${value}:${text}`).digest("hex").slice(0, 8);
  return { ok: true, limit: { id: `limit-${id}`, kind: supported, value, sourceText: text } };
}
