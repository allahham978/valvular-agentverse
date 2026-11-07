import { NextResponse } from "next/server";
import { z } from "zod";
import { DesignSchema } from "@/contracts";
import { defaultRules, evaluateDesign, STARTING_VALVE } from "@/engine";
import { devHearts } from "@/lib/dev-hearts";

const BodySchema = z.object({ design: DesignSchema, parent: DesignSchema.optional() });

function respond(design: z.infer<typeof DesignSchema>, parent?: z.infer<typeof DesignSchema>) {
  const evaluation = evaluateDesign({ hearts: devHearts(), design, parent: parent ?? STARTING_VALVE });
  if (!evaluation.ok) {
    return NextResponse.json(
      { error: "invalid-design", rulesVersion: evaluation.rulesVersion, reasons: evaluation.reasons },
      { status: 422 },
    );
  }
  return NextResponse.json({
    design,
    ...(parent ? { parent } : {}),
    rulesVersion: evaluation.rulesVersion,
    rules: defaultRules.rules,
    summary: evaluation.summary,
    results: evaluation.results,
  });
}

export function GET() {
  return respond(STARTING_VALVE);
}

export async function POST(request: Request) {
  const body = BodySchema.safeParse(await request.json().catch(() => undefined));
  if (!body.success) {
    return NextResponse.json({ error: "bad-request", message: body.error.message }, { status: 400 });
  }
  return respond(body.data.design, body.data.parent ?? STARTING_VALVE);
}
