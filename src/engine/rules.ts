import { z } from "zod";
import rulesJson from "../../data/rules.json";

export const RULE_KINDS = [
  "annulus-coverage",
  "frame-outflow",
  "outflow-clearance",
  "outflow-excess",
  "size-width",
] as const;

export const RuleSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(RULE_KINDS),
    effect: z.enum(["no-fit", "risk", "none", "reject-design"]),
    status: z.enum(["published", "demo-assumption"]),
    source: z.string().nullable(),
    description: z.string().min(1),
    params: z.record(z.string(), z.union([z.string(), z.number()])),
  })
  .refine((rule) => rule.status !== "published" || (rule.source ?? "").trim().length > 0, {
    message: "a published rule needs a source",
  });

export const RuleSetSchema = z.object({ version: z.string().min(1), rules: z.array(RuleSchema).min(1) });

export type Rule = z.infer<typeof RuleSchema>;
export type RuleSet = z.infer<typeof RuleSetSchema>;

export const defaultRules: RuleSet = RuleSetSchema.parse(rulesJson);

export function numParam(rule: Rule, key: string): number {
  const value = rule.params[key];
  if (typeof value !== "number") throw new Error(`rule ${rule.id}: param ${key} must be a number`);
  return value;
}

export function strParam(rule: Rule, key: string): string {
  const value = rule.params[key];
  if (typeof value !== "string") throw new Error(`rule ${rule.id}: param ${key} must be a string`);
  return value;
}
