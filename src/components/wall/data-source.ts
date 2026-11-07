import sample from "@fixtures/sample-hearts.json";
import { FitResultSchema, HeartSchema, type FitResult, type Heart } from "@/contracts";

export type WallData = {
  label: string | null;
  hearts: Heart[];
  results: FitResult[];
};

export async function loadWallData(): Promise<WallData> {
  return {
    label: sample.label,
    hearts: HeartSchema.array().parse(sample.hearts),
    results: FitResultSchema.array().parse(sample.results),
  };
}
