import type { Limit } from "../contracts";
import { scoreAndRecord } from "../scoring/score";
import type { PostLoopStep } from "./index";

export function createScoringStep({ limits = [] }: { limits?: Limit[] } = {}): PostLoopStep {
  return async ({ run, emit }) => {
    const report = scoreAndRecord(run, limits);
    emit({ actor: "code", type: "score", text: "Scored the final design and the baselines on the hidden hearts.", data: report });
  };
}
