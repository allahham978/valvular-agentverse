import type { ModelClient, ModelMessage, ModelRequest, ModelTurn, ToolSpec } from "../model-client/types";
import { readGeminiKey } from "./key";
import { geminiSettings } from "./settings";

type Part = {
  text?: string;
  thought?: boolean;
  functionCall?: { id?: string; name: string; args?: unknown };
  functionResponse?: { id?: string; name: string; response: unknown };
};
type Content = { role: string; parts: Part[] };
type GeminiRequest = { model: string; body: unknown };
export type GeminiTransport = (request: GeminiRequest, signal: AbortSignal) => Promise<unknown>;

const endpoint = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:${geminiSettings.method}`;

function fetchTransport(getKey: () => string): GeminiTransport {
  return async ({ model, body }, signal) => {
    const key = getKey();
    const response = await fetch(endpoint(model), {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      signal,
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message = (payload as { error?: { message?: unknown } } | null)?.error?.message;
      const detail = typeof message === "string" ? `: ${message.split(key).join("[key]").slice(0, 300)}` : "";
      throw new Error(`Gemini request failed with HTTP ${response.status}${detail}`);
    }
    return payload;
  };
}

const callsIn = (content: Content | undefined) => content?.parts.filter((part) => part.functionCall) ?? [];

function modelContent(turn: ModelTurn): Content {
  if (turn.providerState) return turn.providerState as Content;
  return {
    role: "model",
    parts: [
      ...(turn.text ? [{ text: turn.text }] : []),
      ...turn.toolCalls.map((call) => ({ functionCall: { name: call.name, args: call.args } })),
    ],
  };
}

function toContents(messages: ModelMessage[]): Content[] {
  const contents: Content[] = [];
  for (const message of messages) {
    if (message.role === "user") contents.push({ role: "user", parts: [{ text: message.text }] });
    else if (message.role === "model") contents.push(modelContent(message.turn));
    else {
      const calls = callsIn(contents.at(-1));
      contents.push({
        role: "user",
        parts: message.replies.map((reply, index) => ({
          functionResponse: {
            ...(calls[index]?.functionCall?.id ? { id: calls[index].functionCall?.id } : {}),
            name: calls[index]?.functionCall?.name ?? reply.name,
            response: {
              ...(reply.error === undefined ? { evidenceId: reply.evidenceId, result: reply.result } : { error: reply.error }),
              ...(reply.budget ? { budgetLeft: reply.budget } : {}),
            },
          },
        })),
      });
    }
  }
  return contents;
}

function declaration({ name, description, parameters }: ToolSpec) {
  const parametersJsonSchema = Object.fromEntries(Object.entries(parameters).filter(([key]) => key !== "$schema"));
  return { name, description, parametersJsonSchema };
}

function buildBody(request: ModelRequest) {
  return {
    contents: toContents(request.messages),
    tools: [{ functionDeclarations: request.tools.map(declaration) }],
    toolConfig: {
      functionCallingConfig: {
        mode: geminiSettings.toolMode,
        ...(request.allowedTools ? { allowedFunctionNames: request.allowedTools } : {}),
      },
    },
    generationConfig: {
      thinkingConfig: { thinkingLevel: geminiSettings.thinkingLevel },
      maxOutputTokens: geminiSettings.maxOutputTokens,
    },
  };
}

function parseTurn(payload: unknown): ModelTurn {
  const candidate = (payload as { candidates?: { content?: Content; finishReason?: string }[] } | null)?.candidates?.[0];
  if (!candidate?.content?.parts) {
    throw new Error(`Gemini returned no content${candidate?.finishReason ? ` (finish reason ${candidate.finishReason})` : ""}.`);
  }
  const { parts } = candidate.content;
  return {
    text: parts.filter((part) => part.text && !part.thought).map((part) => part.text).join(""),
    toolCalls: callsIn(candidate.content).map(({ functionCall }) => ({
      name: functionCall?.name ?? "",
      args: functionCall?.args ?? {},
    })),
    providerState: candidate.content,
  };
}

export function createGeminiClient({ apiKey, transport }: { apiKey?: string; transport?: GeminiTransport } = {}): ModelClient {
  let key = apiKey;
  const send = transport ?? fetchTransport(() => (key ??= readGeminiKey()));
  return {
    mode: "live",
    async nextTurn(request) {
      const payload = await send({ model: geminiSettings.model, body: buildBody(request) }, request.signal);
      return parseTurn(payload);
    },
  };
}
