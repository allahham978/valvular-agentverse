import { NextResponse } from "next/server";
import { getRunView } from "@/run/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const view = getRunView((await params).id);
  if (!view) return NextResponse.json({ error: "Run not found." }, { status: 404 });
  if (view.status !== "finished") {
    return NextResponse.json({ error: "The run has not finished." }, { status: 409 });
  }
  return new Response(JSON.stringify(view.run), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${view.run.id}.json"`,
    },
  });
}
