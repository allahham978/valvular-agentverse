import { NextResponse } from "next/server";
import { z } from "zod";
import { createModelClient, ModelSpecSchema } from "@/agents/model-client";
import { replanOptions, saveDecision, type Refusal } from "@/orchestrator/review-step";
import { getRunView, saveRun, startRun } from "@/run/store";
import { createAgentTools } from "@/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  status: z.enum(["approved", "rejected"]),
  by: z.string(),
  note: z.string().default(""),
  model: ModelSpecSchema.default({ kind: "gemini" }),
});

const refuse = ({ status, error }: Refusal) => NextResponse.json({ error }, { status });

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const decision = getRunView((await params).id)?.run.decision;
  if (!decision) return NextResponse.json({ error: "No decision saved." }, { status: 404 });
  return NextResponse.json({ decision });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const view = getRunView((await params).id);
  if (!view) return NextResponse.json({ error: "Run not found." }, { status: 404 });
  const body = BodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: z.prettifyError(body.error) }, { status: 400 });

  const saved = saveDecision(view.run, body.data);
  if (!saved.ok) return refuse(saved);
  saveRun(view.run);

  if (saved.decision.status === "approved") return NextResponse.json({ decision: saved.decision });
  const replanRunId = startRun({
    model: createModelClient(body.data.model),
    tools: createAgentTools(),
    ...replanOptions(view.run, saved.decision.note),
  });
  return NextResponse.json({ decision: saved.decision, replanRunId });
}
