export type RuleInfo = { name: string; type: string };

const SAMPLE_RULES: Record<string, RuleInfo> = {
  "annulus-range": { name: "Annulus range", type: "demo-assumption" },
  "sinus-clearance": { name: "Sinus clearance", type: "demo-assumption" },
  "outflow-vs-junction": { name: "Outflow vs junction", type: "demo-assumption" },
};

export const ruleInfo = (ruleId: string): RuleInfo =>
  SAMPLE_RULES[ruleId] ?? { name: ruleId, type: "demo-assumption" };
