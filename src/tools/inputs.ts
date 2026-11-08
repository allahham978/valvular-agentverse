import { z } from "zod";
import { ClaimSchema, DesignSchema, FindingSchema, LimitSchema } from "../contracts";

export const ChangeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("add_size"),
    size: z.object({ nominalMm: z.number(), minAnnulusMm: z.number(), maxAnnulusMm: z.number() }),
  }),
  z.object({ kind: z.literal("remove_size"), nominalMm: z.number() }),
  z.object({ kind: z.literal("set_range"), nominalMm: z.number(), minAnnulusMm: z.number(), maxAnnulusMm: z.number() }),
]);
export type Change = z.infer<typeof ChangeSchema>;

const heartIds = z.array(z.string()).min(1);
const text = z.string().trim().min(1);

export const evaluateDesignInput = z.object({ design: DesignSchema, parent: DesignSchema.optional() });
export const groupFailuresInput = z.object({
  design: DesignSchema,
  by: z.enum(["rule", "size", "band"]),
  measure: z.string().default("annulusMm"),
});
export const profileGroupInput = z.object({ heartIds });
export const inspectHeartInput = z.object({ heartId: z.string().min(1), design: DesignSchema });
export const whatIfInput = z.object({ design: DesignSchema, heartIds, change: ChangeSchema });

export const stressTestInput = z
  .object({
    design: DesignSchema,
    kind: z.enum(["measurement_shift", "assumption_shift", "subgroup"]),
    amount: z.number().optional(),
    hypothesis: text,
    disprovedIf: text,
    measure: z.string().optional(),
    heartIds: heartIds.optional(),
  })
  .superRefine((input, ctx) => {
    if (input.kind === "subgroup" && !input.heartIds) {
      ctx.addIssue({ code: "custom", path: ["heartIds"], message: "heartIds are required for a subgroup attack" });
    }
    if (input.kind !== "subgroup" && input.amount === undefined) {
      ctx.addIssue({ code: "custom", path: ["amount"], message: "amount (mm) is required for a shift attack" });
    }
  });

export const reportFindingsInput = z.object({
  mechanisms: z.array(FindingSchema.omit({ id: true, kind: true }).extend({ evidenceIds: z.array(z.string()).min(1) })).min(1),
});
export const editDesignInput = z.object({ design: DesignSchema, change: ChangeSchema, limits: z.array(LimitSchema).optional() });
export const submitProposalInput = z.object({
  design: DesignSchema,
  rationale: text,
  claim: ClaimSchema.optional(),
  tradeOffs: z.array(z.string()).default([]),
  evidenceIds: z.array(z.string()).min(1),
});
