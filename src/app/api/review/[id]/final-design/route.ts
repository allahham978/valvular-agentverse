import { NextResponse } from "next/server";
import { requireDecision, reviewedProposal } from "@/orchestrator/review-step";
import { getRunView } from "@/run/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const view = getRunView((await params).id);
  if (!view) return NextResponse.json({ error: "Run not found." }, { status: 404 });
  const refusal = requireDecision(view.run, "final-design");
  const reviewed = reviewedProposal(view.run);
  if (refusal || !reviewed) return NextResponse.json({ error: refusal?.error ?? "Nothing to release." }, { status: 409 });
  return NextResponse.json({ design: reviewed.design, decision: view.run.decision });
}
