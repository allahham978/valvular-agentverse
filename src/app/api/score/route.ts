import { NextResponse } from "next/server";
import { z } from "zod";
import { LimitSchema } from "@/contracts";
import { getRunView, isRunId, saveRun } from "@/run/store";
import { loadReport, saveReport, scoreAndRecord, SUPPORTED_LIMIT_KINDS, unsupportedLimit } from "@/scoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({ runId: z.string(), limits: z.array(LimitSchema).optional() });

export async function POST(request: Request) {
  const body = BodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: z.prettifyError(body.error) }, { status: 400 });
  const { runId, limits = [] } = body.data;

  const view = getRunView(runId);
  if (!view) return NextResponse.json({ error: "Run not found." }, { status: 404 });
  if (view.status === "running") return NextResponse.json({ error: "The run is still running." }, { status: 409 });
  if (view.status !== "finished") return NextResponse.json({ error: "The run did not finish." }, { status: 409 });

  const unsupported = unsupportedLimit([...view.run.limits, ...limits]);
  if (unsupported) {
    return NextResponse.json(
      { error: `Unsupported limit type "${unsupported.kind}". Supported: ${SUPPORTED_LIMIT_KINDS.join(", ")}.` },
      { status: 400 },
    );
  }

  const report = scoreAndRecord(view.run, limits);
  saveRun(view.run);
  saveReport(report);
  return NextResponse.json(report);
}

export async function GET(request: Request) {
  const runId = new URL(request.url).searchParams.get("runId") ?? "";
  const report = isRunId(runId) ? loadReport(runId) : null;
  if (!report) return NextResponse.json({ error: "This run has not been scored." }, { status: 404 });
  return NextResponse.json(report);
}
