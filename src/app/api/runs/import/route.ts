import { NextResponse } from "next/server";
import { RunSchema } from "@/contracts";
import { hasFinished, importRun, isRunId } from "@/run/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const parsed = RunSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !isRunId(parsed.data.id) || !hasFinished(parsed.data)) {
    return NextResponse.json({ error: "Not a finished run." }, { status: 400 });
  }
  const result = importRun(parsed.data);
  if (result === "conflict") {
    return NextResponse.json({ error: "A different run has this ID." }, { status: 409 });
  }
  return NextResponse.json({ id: parsed.data.id }, { status: 201 });
}
