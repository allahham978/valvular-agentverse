import { FitResultSchema, HeartSchema, type FitResult, type Heart } from "@/contracts";

export type WallData = {
  label: string | null;
  hearts: Heart[];
  results: FitResult[];
  ruleTypes: Record<string, string>;
};

async function getJson(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} ${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}

export async function loadWallData(): Promise<WallData> {
  const [heartsBody, fitBody] = await Promise.all([getJson("/api/hearts"), getJson("/api/fit")]);
  const rules = (fitBody.rules as { id: string; status: string }[]) ?? [];
  return {
    label: null,
    hearts: HeartSchema.array().parse(heartsBody.hearts),
    results: FitResultSchema.array().parse(fitBody.results),
    ruleTypes: Object.fromEntries(rules.map((rule) => [rule.id, rule.status])),
  };
}
