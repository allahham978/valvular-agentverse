import { z } from "zod";
import { DesignSchema, LimitSchema } from "../contracts";

const TurnSchema = z.object({
  delayMs: z.number().nonnegative().optional(),
  text: z.string().optional(),
  toolCalls: z.array(z.object({ name: z.string(), args: z.unknown() })),
});

export const ReplayFileSchema = z.object({
  id: z.string(),
  title: z.string(),
  source: z.enum(["recording", "transcript"]),
  startDesign: DesignSchema,
  limits: z.array(LimitSchema),
  budget: z
    .object({
      maxStepsPerTurn: z.number().int().positive(),
      maxToolCallsPerTurn: z.number().int().positive(),
      maxTurnMs: z.number().positive(),
      maxRounds: z.number().int().positive(),
    })
    .partial(),
  stopAfter: z.literal("investigate").optional(),
  turns: z.array(TurnSchema),
});

export type ReplayFile = z.infer<typeof ReplayFileSchema>;
