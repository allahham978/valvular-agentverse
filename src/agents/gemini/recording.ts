import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Run } from "../../contracts";

export function saveRecording(run: Run): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(run.id)) throw new Error("Invalid run ID.");
  const dir = path.join(process.cwd(), "fixtures", "recordings");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${run.id}.json`);
  writeFileSync(file, `${JSON.stringify(run, null, 2)}\n`);
  return file;
}
