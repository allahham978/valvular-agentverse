import sample from "@fixtures/sample-hearts.json";
import { FitResultSchema, HeartSchema, type FitResult, type Heart } from "@/contracts";

export type WallData = {
  label: string | null;
  hearts: Heart[];
  results: FitResult[];
};

async function devHeartAssets(): Promise<Pick<Heart, "thumbUrl" | "meshUrl">[]> {
  try {
    const response = await fetch("/api/hearts");
    if (!response.ok) return [];
    const body = (await response.json()) as { hearts: unknown };
    return HeartSchema.array().parse(body.hearts);
  } catch {
    return [];
  }
}

// Statuses and measurements stay sample data until the fit engine (REQ-6) lands;
// thumbnails and meshes already come from the real dev hearts, matched by position.
export async function loadWallData(): Promise<WallData> {
  const assets = await devHeartAssets();
  const hearts = HeartSchema.array()
    .parse(sample.hearts)
    .map((heart, index) => ({ ...heart, ...pickAssets(assets[index]) }));
  return {
    label: sample.label,
    hearts,
    results: FitResultSchema.array().parse(sample.results),
  };
}

function pickAssets(asset: Pick<Heart, "thumbUrl" | "meshUrl"> | undefined) {
  return asset ? { thumbUrl: asset.thumbUrl, meshUrl: asset.meshUrl } : {};
}
