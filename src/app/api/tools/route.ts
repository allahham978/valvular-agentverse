import { NextResponse } from "next/server";
import { z } from "zod";
import { createAgentTools } from "@/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({ tool: z.string().min(1), input: z.unknown() });
const tools = createAgentTools();

export async function POST(request: Request) {
  const body = BodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ ok: false, error: `Invalid body: ${z.prettifyError(body.error)}` }, { status: 400 });
  }
  const outcome = await tools.call(body.data.tool, body.data.input);
  if (outcome.ok) return NextResponse.json(outcome);
  return NextResponse.json({ ok: false, error: outcome.error }, { status: outcome.status ?? 400 });
}
