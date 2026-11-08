import { NextResponse } from "next/server";
import { z } from "zod";
import { createModelClient, ModelSpecSchema } from "@/agents/model-client";
import { plantedDesigns, runBreakerBaseline } from "@/scoring/breaker-baseline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  breakers: z.record(z.string(), ModelSpecSchema),
  budget: z.object({ maxToolCallsPerTurn: z.number().int().positive(), maxTurnMs: z.number().positive() }).partial().optional(),
});

export async function POST(request: Request) {
  const body = BodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: z.prettifyError(body.error) }, { status: 400 });
  const { breakers, budget } = body.data;

  const missing = plantedDesigns().filter((id) => !breakers[id]);
  if (missing.length) return NextResponse.json({ error: `Missing a Breaker for: ${missing.join(", ")}.` }, { status: 400 });

  return NextResponse.json(await runBreakerBaseline({ breaker: (design) => createModelClient(breakers[design.id]), budget }));
}
