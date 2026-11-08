import { NextResponse } from "next/server";
import { requireDecision } from "@/orchestrator/review-step";
import { getRunView } from "@/run/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const view = getRunView((await params).id);
  if (!view) return NextResponse.json({ error: "Run not found." }, { status: 404 });
  const refusal = requireDecision(view.run, "export");
  if (refusal) return NextResponse.json({ error: refusal.error }, { status: 409 });
  return NextResponse.json(view.run);
}
