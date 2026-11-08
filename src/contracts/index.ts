import { z } from "zod";

export const HeartSchema = z.object({
  id: z.string(),
  split: z.enum(["dev", "hidden"]),
  provenance: z.literal("synthetic"),
  measures: z.record(z.string(), z.number()),
  thumbUrl: z.string(),
  meshUrl: z.string(),
});

export const DesignSchema = z.object({
  id: z.string(),
  label: z.string(),
  hypothetical: z.literal(true),
  sizes: z.array(
    z.object({
      nominalMm: z.number(),
      minAnnulusMm: z.number(),
      maxAnnulusMm: z.number(),
    }),
  ),
  parentId: z.string().optional(),
});

export const FitStatusSchema = z.enum(["fit", "risk", "no-fit"]);

export const FitResultSchema = z.object({
  heartId: z.string(),
  designId: z.string(),
  status: FitStatusSchema,
  sizeMm: z.number().optional(),
  reasons: z.array(
    z.object({
      ruleId: z.string(),
      measured: z.number(),
      limit: z.number(),
      margin: z.number(),
    }),
  ),
});

export const SummarySchema = z.object({
  designId: z.string(),
  split: z.enum(["dev", "hidden"]),
  total: z.number(),
  fit: z.number(),
  risk: z.number(),
  noFit: z.number(),
  fitPct: z.number(),
  newRiskHeartIds: z.array(z.string()),
});

export const EvidenceSchema = z.object({
  id: z.string(),
  tool: z.string(),
  input: z.unknown(),
  result: z.unknown(),
  source: z.enum(["computed", "cached", "failed", "unsupported"]).optional(),
  provenance: z.object({ rulesVersion: z.string(), dataHash: z.string(), seed: z.number() }).optional(),
});

export const FindingSchema = z.object({
  id: z.string(),
  kind: z.enum(["mechanism", "attack"]),
  title: z.string(),
  explanation: z.string(),
  heartIds: z.array(z.string()),
  severity: z.enum(["low", "medium", "high"]),
  evidenceIds: z.array(z.string()),
});

export const ClaimSchema = z.object({
  metric: z.enum(["fitPct", "newRiskCount"]),
  comparator: z.enum([">=", "<="]),
  threshold: z.number(),
});

export const VerdictSchema = z.enum([
  "supported_under_conditions",
  "context_dependent",
  "contradicted",
  "inconclusive",
  "invalid_experiment",
]);

export const ProposalSchema = z.object({
  id: z.string(),
  fromDesignId: z.string(),
  toDesignId: z.string(),
  rationale: z.string(),
  tradeOffs: z.array(z.string()),
  claim: ClaimSchema.optional(),
  evidenceIds: z.array(z.string()),
  verdict: VerdictSchema.optional(),
  notShown: z.array(z.string()).optional(),
});

export const LimitSchema = z.object({
  id: z.string(),
  kind: z.string(),
  value: z.union([z.number(), z.string()]),
  sourceText: z.string(),
});

export const RunEventSchema = z.object({
  seq: z.number().int(),
  at: z.string(),
  actor: z.enum(["code", "breaker", "fixer", "engineer", "judge"]),
  type: z.string(),
  text: z.string(),
  data: z.unknown(),
  mode: z.enum(["live", "replay"]),
});

export const BaselineSchema = z.object({
  method: z.enum(["no-change", "add-larger-size", "brute-force"]),
  designId: z.string(),
  summary: SummarySchema,
  designsTried: z.number().int(),
});

export const DecisionSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  designId: z.string(),
  by: z.string(),
  note: z.string(),
  at: z.string(),
});

export const RunSchema = z.object({
  id: z.string(),
  seed: z.number(),
  startDesignId: z.string(),
  limits: z.array(LimitSchema),
  events: z.array(RunEventSchema),
  evidence: z.array(EvidenceSchema),
  findings: z.array(FindingSchema),
  proposals: z.array(ProposalSchema),
  baselines: z.array(BaselineSchema),
  hiddenScoreCount: z.number().int(),
  decision: DecisionSchema.optional(),
});

export type Heart = z.infer<typeof HeartSchema>;
export type Design = z.infer<typeof DesignSchema>;
export type FitStatus = z.infer<typeof FitStatusSchema>;
export type FitResult = z.infer<typeof FitResultSchema>;
export type Summary = z.infer<typeof SummarySchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
export type Claim = z.infer<typeof ClaimSchema>;
export type Finding = z.infer<typeof FindingSchema>;
export type Proposal = z.infer<typeof ProposalSchema>;
export type Limit = z.infer<typeof LimitSchema>;
export type RunEvent = z.infer<typeof RunEventSchema>;
export type Baseline = z.infer<typeof BaselineSchema>;
export type Decision = z.infer<typeof DecisionSchema>;
export type Run = z.infer<typeof RunSchema>;
