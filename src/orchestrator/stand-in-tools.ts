import { createHash } from "node:crypto";
import { z } from "zod";
import { DesignSchema, FindingSchema, type Design, type Summary } from "../contracts";
import type { ToolOutcome, ToolRegistry } from "./tools";

const ANNULUS_MIN_MM = 18;
const ANNULUS_MAX_MM = 32;
const SAMPLE_TOTAL = 400;

const EvaluateInput = z.object({ design: DesignSchema });
const FindingInput = FindingSchema.omit({ id: true, kind: true });
const ReportInput = z.object({ mechanisms: z.array(FindingInput).min(1) });
const ProposalInput = z.object({
  design: DesignSchema,
  rationale: z.string().min(1),
  tradeOffs: z.array(z.string()).default([]),
  evidenceIds: z.array(z.string()),
});

const specs = [
  {
    name: "evaluate_design",
    description: "Evaluate a design on the development hearts and return the fit summary.",
    parameters: { type: "object", properties: { design: { type: "object" } }, required: ["design"] },
  },
  {
    name: "report_findings",
    description: "Report the failure mechanisms found, each citing evidence IDs.",
    parameters: {
      type: "object",
      properties: { mechanisms: { type: "array", items: { type: "object" } } },
      required: ["mechanisms"],
    },
  },
  {
    name: "submit_proposal",
    description: "Submit one improved design with its rationale, trade-offs and evidence IDs.",
    parameters: {
      type: "object",
      properties: {
        design: { type: "object" },
        rationale: { type: "string" },
        tradeOffs: { type: "array", items: { type: "string" } },
        evidenceIds: { type: "array", items: { type: "string" } },
      },
      required: ["design", "rationale", "evidenceIds"],
    },
  },
];

function coveredMm(design: Design): number {
  const ranges = design.sizes
    .map((size) => [
      Math.max(size.minAnnulusMm, ANNULUS_MIN_MM),
      Math.min(size.maxAnnulusMm, ANNULUS_MAX_MM),
    ])
    .filter(([low, high]) => high > low)
    .sort((a, b) => a[0] - b[0]);
  let covered = 0;
  let reach = ANNULUS_MIN_MM;
  for (const [low, high] of ranges) {
    covered += Math.max(0, high - Math.max(low, reach));
    reach = Math.max(reach, high);
  }
  return covered;
}

function evaluate(design: Design): Summary & { label: string } {
  const fit = Math.round((coveredMm(design) / (ANNULUS_MAX_MM - ANNULUS_MIN_MM)) * SAMPLE_TOTAL);
  return {
    designId: design.id,
    split: "dev",
    total: SAMPLE_TOTAL,
    fit,
    risk: 0,
    noFit: SAMPLE_TOTAL - fit,
    fitPct: (fit / SAMPLE_TOTAL) * 100,
    newRiskHeartIds: [],
    label: "Sample data",
  };
}

function evidenceFor(tool: string, input: unknown, result: unknown): ToolOutcome {
  const hash = createHash("sha256").update(JSON.stringify([tool, input])).digest("hex");
  return { ok: true, evidence: { id: `ev-${hash.slice(0, 12)}`, tool, input, result } };
}

function invalid(error: z.ZodError): ToolOutcome {
  return { ok: false, error: `Invalid input: ${z.prettifyError(error)}` };
}

export function createStandInTools(): ToolRegistry {
  return {
    specs: () => specs,
    async call(name, input) {
      switch (name) {
        case "evaluate_design": {
          const parsed = EvaluateInput.safeParse(input);
          if (!parsed.success) return invalid(parsed.error);
          return evidenceFor(name, input, evaluate(parsed.data.design));
        }
        case "report_findings": {
          const parsed = ReportInput.safeParse(input);
          if (!parsed.success) return invalid(parsed.error);
          return evidenceFor(name, input, { findings: parsed.data.mechanisms });
        }
        case "submit_proposal": {
          const parsed = ProposalInput.safeParse(input);
          if (!parsed.success) return invalid(parsed.error);
          return evidenceFor(name, input, parsed.data);
        }
        default:
          return { ok: false, error: `Unknown tool: ${name}` };
      }
    },
  };
}
