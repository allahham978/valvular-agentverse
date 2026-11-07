import type { Evidence } from "../contracts";
import type { ToolSpec } from "../agents/model-client";

export type ToolOutcome = { ok: true; evidence: Evidence } | { ok: false; error: string };

export interface ToolRegistry {
  specs(): ToolSpec[];
  call(name: string, input: unknown): Promise<ToolOutcome>;
}
