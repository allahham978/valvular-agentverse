import { NextResponse } from "next/server";
import { devHearts } from "@/lib/dev-hearts";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const heart = devHearts().find((candidate) => candidate.id === id);
  if (!heart) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ heart });
}
