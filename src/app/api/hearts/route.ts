import { NextResponse } from "next/server";
import { devHearts } from "@/lib/dev-hearts";

export function GET() {
  return NextResponse.json({ hearts: devHearts() });
}
