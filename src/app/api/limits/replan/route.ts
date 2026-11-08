import { NextResponse } from "next/server";
import { z } from "zod";
import { createModelClient, ModelSpecSchema } from "@/agents/model-client";
import { DesignSchema, LimitSchema } from "@/contracts";
import { startReplan } from "@/orchestrator/replan";
import { evaluate } from "@/tools/fit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PlannedSchema = z.object({ design: DesignSchema, limits: z.array(LimitSchema) });
const BodySchema = z.object({ model: ModelSpecSchema, before: PlannedSchema, after: PlannedSchema });

export async function POST(request: Request) {
  const body = BodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: z.prettifyError(body.error) }, { status: 400 });
  const { model, before, after } = body.data;

  const evaluation = evaluate(after.design);
  if (!evaluation.ok) {
    return NextResponse.json({ error: "invalid-design", reasons: evaluation.reasons }, { status: 400 });
  }
  const started = startReplan({ model: createModelClient(model), before, after });
  if (!started) return NextResponse.json({ error: "Nothing changed." }, { status: 409 });
  return NextResponse.json(started, { status: 201 });
}
