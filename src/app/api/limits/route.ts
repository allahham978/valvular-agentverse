import { NextResponse } from "next/server";
import { z } from "zod";
import { parseLimit } from "@/agents/limits";
import { createModelClient, ModelSpecSchema } from "@/agents/model-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({ text: z.string().min(1).max(200), model: ModelSpecSchema });

export async function POST(request: Request) {
  const body = BodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: z.prettifyError(body.error) }, { status: 400 });
  const parsed = await parseLimit({ text: body.data.text, model: createModelClient(body.data.model) });
  return NextResponse.json(parsed, { status: parsed.ok ? 200 : 422 });
}
