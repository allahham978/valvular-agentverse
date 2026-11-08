import type { PostLoopStep } from "../orchestrator";
import { DEFAULT_REPLAY_ID } from "./library";

export const offerRecording: PostLoopStep = async ({ stopReason, stopDetail, run, emit }) => {
  if (stopReason !== "model-error" || run.events.some((event) => event.mode === "replay")) return;
  emit({
    actor: "code",
    type: "replay-offer",
    text: `Gemini failed: ${stopDetail} This run stopped and is not live. The recording can be replayed instead (Replay, not live).`,
    data: { replayId: DEFAULT_REPLAY_ID, reason: stopReason, detail: stopDetail },
  });
};
