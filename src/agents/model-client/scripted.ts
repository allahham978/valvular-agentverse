import type { ModelClient, ModelMessage, ModelRequest, ModelTurn, ToolCall } from "./types";

export type ScriptedTurn = { delayMs?: number; text?: string; toolCalls: ToolCall[] };

const LAST_EVIDENCE = "$lastEvidenceId";

function lastEvidenceId(messages: ModelMessage[]): string {
  for (const message of [...messages].reverse()) {
    if (message.role !== "tool") continue;
    for (const reply of [...message.replies].reverse()) {
      if (reply.evidenceId) return reply.evidenceId;
    }
  }
  return "";
}

function substitute(value: unknown, evidenceId: string): unknown {
  if (value === LAST_EVIDENCE) return evidenceId;
  if (Array.isArray(value)) return value.map((item) => substitute(item, evidenceId));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, substitute(item, evidenceId)]),
    );
  }
  return value;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("Aborted"));
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

// Like Gemini's ANY mode with allowedFunctionNames: a restricted step plays the next turn that uses only allowed tools.
function nextAllowed(turns: ScriptedTurn[], from: number, allowed: string[] | undefined): number {
  if (!allowed) return from;
  const fits = (turn: ScriptedTurn) => turn.toolCalls.length > 0 && turn.toolCalls.every((call) => allowed.includes(call.name));
  const found = turns.findIndex((turn, index) => index >= from && fits(turn));
  return found === -1 ? from : found;
}

export function createScriptedClient(turns: ScriptedTurn[]): ModelClient {
  let next = 0;
  return {
    mode: "replay",
    async nextTurn(request: ModelRequest): Promise<ModelTurn> {
      next = nextAllowed(turns, next, request.allowedTools);
      const turn = turns[next++];
      if (!turn) throw new Error("The script has no more turns.");
      if (turn.delayMs) await wait(turn.delayMs, request.signal);
      const evidenceId = lastEvidenceId(request.messages);
      return {
        text: turn.text ?? "",
        toolCalls: turn.toolCalls.map((call) => ({
          name: call.name,
          args: substitute(call.args, evidenceId),
        })),
      };
    },
  };
}
