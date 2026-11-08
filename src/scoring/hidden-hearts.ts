import { readFileSync } from "node:fs";
import path from "node:path";
import type { Heart } from "../contracts";

let cached: Heart[] | undefined;

export function hiddenHearts(): Heart[] {
  cached ??= (
    JSON.parse(readFileSync(path.join(process.cwd(), "server-data", "hearts.hidden.json"), "utf8")) as {
      hearts: Heart[];
    }
  ).hearts;
  return cached;
}
