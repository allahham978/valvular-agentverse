import { z } from "zod";
import { ClaimSchema, DesignSchema, FindingSchema, type Evidence } from "../contracts";

const FindingDraftSchema = FindingSchema.omit({ id: true, kind: true });
const ReportSchema = z.object({ findings: z.array(FindingDraftSchema).min(1) });
const SubmissionSchema = z.object({
  design: DesignSchema,
  rationale: z.string(),
  tradeOffs: z.array(z.string()),
  claim: ClaimSchema.optional(),
  evidenceIds: z.array(z.string()),
});

export type FindingDraft = z.infer<typeof FindingDraftSchema>;
export type Submission = z.infer<typeof SubmissionSchema>;
type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function parseWith<T>(schema: z.ZodType<T>, evidence: Evidence, known: Set<string>, cited: (value: T) => string[]): Parsed<T> {
  const parsed = schema.safeParse(evidence.result);
  if (!parsed.success) return { ok: false, error: z.prettifyError(parsed.error) };
  const ids = cited(parsed.data);
  if (ids.length === 0) return { ok: false, error: "Cite at least one evidence ID." };
  const unknown = ids.find((id) => !known.has(id));
  if (unknown) return { ok: false, error: `Unknown evidence ID: ${unknown}` };
  return { ok: true, value: parsed.data };
}

export const parseReport = (evidence: Evidence, known: Set<string>) =>
  parseWith(ReportSchema, evidence, known, (report) =>
    report.findings.some((finding) => finding.evidenceIds.length === 0)
      ? []
      : report.findings.flatMap((finding) => finding.evidenceIds),
  );

export const parseSubmission = (evidence: Evidence, known: Set<string>) =>
  parseWith(SubmissionSchema, evidence, known, (submission) => submission.evidenceIds);
