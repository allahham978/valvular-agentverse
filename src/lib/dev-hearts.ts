import { readFileSync } from "node:fs";
import path from "node:path";
import type { Heart } from "../contracts";

let cached: Heart[] | undefined;

export function devHearts(): Heart[] {
  cached ??= (
    JSON.parse(
      readFileSync(path.join(process.cwd(), "data", "hearts.dev.json"), "utf8"),
    ) as { hearts: Heart[] }
  ).hearts;
  return cached;
}
