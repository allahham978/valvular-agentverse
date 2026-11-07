export type LoopStep = "investigate" | "propose" | "attack";

export type ToolCall = { name: string; args: unknown };
export type ToolSpec = { name: string; description: string; parameters: Record<string, unknown> };
export type ModelTurn = { text: string; toolCalls: ToolCall[]; providerState?: unknown };
export type ToolReply = { name: string; evidenceId?: string; result?: unknown; error?: string };

export type ModelMessage =
  | { role: "user"; text: string }
  | { role: "model"; turn: ModelTurn }
  | { role: "tool"; replies: ToolReply[] };

export type ModelRequest = {
  actor: "breaker" | "fixer";
  step: LoopStep;
  messages: ModelMessage[];
  tools: ToolSpec[];
  signal: AbortSignal;
};

export interface ModelClient {
  readonly mode: "live" | "replay";
  nextTurn(request: ModelRequest): Promise<ModelTurn>;
}
