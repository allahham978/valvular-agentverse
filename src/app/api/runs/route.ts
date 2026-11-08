import { NextResponse } from "next/server";
import { z } from "zod";
import { createModelClient, ModelSpecSchema } from "@/agents/model-client";
import { offerRecording, startReplayRun } from "@/replay";
import { isRunId, startRun } from "@/run/store";
import { createAgentTools } from "@/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ReplayBodySchema = z.object({ replayId: z.string() });

const BodySchema = z.object({
  model: ModelSpecSchema,
  budget: z
    .object({
      maxStepsPerTurn: z.number().int().positive(),
      maxToolCallsPerTurn: z.number().int().positive(),
      maxTurnMs: z.number().positive(),
      maxRounds: z.number().int().positive(),
    })
    .partial()
    .optional(),
  seed: z.number().optional(),
});

export async function POST(request: Request) {
  const payload: unknown = await request.json().catch(() => null);
  const replay = ReplayBodySchema.safeParse(payload);
  if (replay.success) {
    if (!isRunId(replay.data.replayId)) return NextResponse.json({ error: "Invalid replay ID." }, { status: 400 });
    const id = startReplayRun(replay.data.replayId);
    if (id === null) return NextResponse.json({ error: "Unknown replay." }, { status: 404 });
    return NextResponse.json({ id }, { status: 201 });
  }

  const body = BodySchema.safeParse(payload);
  if (!body.success) return NextResponse.json({ error: z.prettifyError(body.error) }, { status: 400 });

  const model = createModelClient(body.data.model);
  const id = startRun({
    model,
    record: model.mode === "live",
    tools: createAgentTools(),
    budget: body.data.budget,
    seed: body.data.seed,
    postLoopSteps: model.mode === "live" ? [offerRecording] : [],
  });
  return NextResponse.json({ id }, { status: 201 });
}
