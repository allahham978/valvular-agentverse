import { NextResponse } from "next/server";
import { z } from "zod";
import { createModelClient, ModelSpecSchema } from "@/agents/model-client";
import { startRun } from "@/run/store";
import { createAgentTools } from "@/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  model: ModelSpecSchema,
  budget: z
    .object({
      maxToolCallsPerTurn: z.number().int().positive(),
      maxTurnMs: z.number().positive(),
      maxRounds: z.number().int().positive(),
    })
    .partial()
    .optional(),
  seed: z.number().optional(),
});

export async function POST(request: Request) {
  const body = BodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: z.prettifyError(body.error) }, { status: 400 });

  const id = startRun({
    model: createModelClient(body.data.model),
    tools: createAgentTools(),
    budget: body.data.budget,
    seed: body.data.seed,
  });
  return NextResponse.json({ id }, { status: 201 });
}
