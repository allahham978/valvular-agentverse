import { z } from "zod";
import { devHearts } from "../lib/dev-hearts";
import type { ToolSpec } from "../agents/model-client";
import type { ToolOutcome, ToolRegistry } from "../orchestrator/tools";
import { editDesignTool, reportFindingsTool, submitProposalTool } from "./design";
import { makeEvidence, ToolError } from "./evidence";
import * as inputs from "./inputs";
import { evaluateDesignTool, groupFailuresTool, inspectHeartTool, profileGroupTool, whatIfTool } from "./investigate";
import { stressTestTool } from "./stress";

type Tool = ToolSpec & { run(input: unknown): unknown };

function defineTool<S extends z.ZodType>(name: string, description: string, schema: S, run: (input: z.infer<S>) => unknown): Tool {
  return {
    name,
    description,
    parameters: z.toJSONSchema(schema, { io: "input" }),
    run(raw) {
      const parsed = schema.safeParse(raw);
      if (!parsed.success) throw new ToolError(400, `Invalid input: ${z.prettifyError(parsed.error)}`);
      return run(parsed.data);
    },
  };
}

const tools: Tool[] = [
  defineTool("evaluate_design", "Fit, risk and no-fit counts for a design on the dev hearts. With a parent, also lists new at-risk hearts and which hearts changed status.", inputs.evaluateDesignInput, evaluateDesignTool),
  defineTool("group_failures", "Count failing hearts grouped by rule, size or measurement band.", inputs.groupFailuresInput, groupFailuresTool),
  defineTool("profile_group", "How a group of hearts' measurements differ from the rest, sorted by effect size.", inputs.profileGroupInput, profileGroupTool),
  defineTool("inspect_heart", "One heart's measurements, assigned size and failure reasons under a design.", inputs.inspectHeartInput, inspectHeartTool),
  defineTool("what_if", "Whether a design change would fix the given hearts.", inputs.whatIfInput, whatIfTool),
  defineTool("stress_test", "Attack a design with a measurement_shift, assumption_shift or subgroup. State a short hypothesis and what result would disprove it (300 characters each or fewer).", inputs.stressTestInput, stressTestTool),
  defineTool("report_findings", "Report at most 2 failure mechanisms, each a one-line explanation (300 characters or fewer) citing at most 3 evidence IDs. Ends the turn.", inputs.reportFindingsInput, reportFindingsTool),
  defineTool("edit_design", "Apply one change to a design. Returns the new design, its comparison with the parent and which limits pass or fail, or why it is invalid.", inputs.editDesignInput, editDesignTool),
  defineTool("submit_proposal", "Submit one design with a short rationale (300 characters or fewer), a structured claim and evidence IDs. Ends the turn.", inputs.submitProposalInput, submitProposalTool),
];

function heartIdsIn(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(heartIdsIn);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, item]) => {
    if (key === "heartId") return typeof item === "string" ? [item] : [];
    if (key === "heartIds") return Array.isArray(item) ? item.filter((id): id is string => typeof id === "string") : [];
    return heartIdsIn(item);
  });
}

function refuseHiddenHearts(input: unknown) {
  const dev = new Set(devHearts().map((heart) => heart.id));
  const refused = heartIdsIn(input).find((id) => !dev.has(id));
  if (refused) throw new ToolError(403, `Heart ${refused} is not a development heart. Hidden hearts are refused.`);
}

export function createAgentTools(): ToolRegistry {
  return {
    specs: () => tools.map(({ name, description, parameters }) => ({ name, description, parameters })),
    async call(name, input): Promise<ToolOutcome> {
      try {
        const tool = tools.find((candidate) => candidate.name === name);
        if (!tool) throw new ToolError(404, `Unknown tool: ${name}.`);
        refuseHiddenHearts(input);
        return { ok: true, evidence: makeEvidence(name, input, tool.run(input)) };
      } catch (error) {
        if (error instanceof ToolError) return { ok: false, error: error.message, status: error.status };
        throw error;
      }
    },
  };
}
