import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Evidence } from "../contracts";
import { defaultRules } from "../engine";
import sources from "../../data/sources.json";

export class ToolError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 422,
    message: string,
  ) {
    super(message);
  }
}

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export const shortHash = (value: unknown) => sha256(canonical(value)).slice(0, 8);

let dataHash: string | undefined;

function provenance(): NonNullable<Evidence["provenance"]> {
  dataHash ??= sha256(readFileSync(path.join(process.cwd(), "data", "hearts.dev.json")));
  return { rulesVersion: defaultRules.version, dataHash, seed: sources.seed };
}

export function makeEvidence(tool: string, input: unknown, result: unknown): Evidence {
  return {
    id: `ev-${sha256(canonical([tool, input])).slice(0, 16)}`,
    tool,
    input,
    result,
    source: "computed",
    provenance: provenance(),
  };
}
