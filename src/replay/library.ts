import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { RunSchema } from "../contracts";
import { replayFromRun } from "./from-run";
import { ReplayFileSchema, type ReplayFile } from "./schema";

export const DEFAULT_REPLAY_ID = "demo";
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const fixture = (...parts: string[]) => path.join(process.cwd(), "fixtures", ...parts);

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function loadReplay(id: string): ReplayFile | null {
  if (!ID_PATTERN.test(id)) return null;
  const replay = ReplayFileSchema.safeParse(readJson(fixture("replays", `${id}.json`)));
  if (replay.success) return replay.data;
  const recording = RunSchema.safeParse(readJson(fixture("recordings", `${id}.json`)));
  return recording.success ? replayFromRun(recording.data, { id, title: `Recording ${id}` }) : null;
}

export function listReplays(): string[] {
  return readdirSync(fixture("replays"))
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length))
    .sort();
}
