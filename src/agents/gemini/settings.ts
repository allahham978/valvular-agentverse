export const geminiSettings = {
  model: "gemini-4-argon",
  method: "generateContent",
  thinkingLevel: "low",
  toolMode: "ANY",
  maxOutputTokens: 32768,
  stepTimeoutMs: 60_000,
  stepRetries: 1,
  budget: { maxStepsPerTurn: 8, maxToolCallsPerTurn: 16, maxTurnMs: 180_000 },
} as const;
