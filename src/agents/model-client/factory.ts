import { z } from "zod";
import { createGeminiClient } from "../gemini/client";
import { geminiSettings } from "../gemini/settings";
import { withStepTimeout } from "../gemini/step-timeout";
import { createScriptedClient } from "./scripted";
import type { ModelClient } from "./types";

const ScriptedTurnSchema = z.object({
  delayMs: z.number().nonnegative().optional(),
  text: z.string().optional(),
  toolCalls: z.array(z.object({ name: z.string(), args: z.unknown() })),
});

export const ModelSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("scripted"), turns: z.array(ScriptedTurnSchema) }),
  z.object({ kind: z.literal("gemini") }),
]);

export type ModelSpec = z.infer<typeof ModelSpecSchema>;

export function createModelClient(spec: ModelSpec): ModelClient {
  switch (spec.kind) {
    case "scripted":
      return createScriptedClient(spec.turns);
    case "gemini":
      return withStepTimeout(createGeminiClient(), {
        timeoutMs: geminiSettings.stepTimeoutMs,
        retries: geminiSettings.stepRetries,
      });
  }
}
