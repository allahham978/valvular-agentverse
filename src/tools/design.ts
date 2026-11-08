import type { Design, Limit, Summary } from "../contracts";
import type { z } from "zod";
import { ToolError } from "./evidence";
import { applyChange, changedHearts, evaluate, evaluateOrThrow } from "./fit";
import type { editDesignInput, reportFindingsInput, submitProposalInput } from "./inputs";

type Check = (limit: { value: number }, child: Measured) => { pass: boolean; detail: string };

const limitChecks: Record<string, Check> = {
  "max-sizes": ({ value }, { sizes }) => ({ pass: sizes <= value, detail: `${sizes} sizes, limit ${value}.` }),
  "min-fit-pct": ({ value }, { fitPct }) => ({ pass: fitPct >= value, detail: `${fitPct.toFixed(1)}% fit, minimum ${value}%.` }),
  "max-new-risk": ({ value }, { newRisk }) => ({ pass: newRisk <= value, detail: `${newRisk} new at-risk hearts, limit ${value}.` }),
};

function checkedLimits(limits: Limit[]): (Limit & { value: number })[] {
  return limits.map((limit, index) => {
    if (!(limit.kind in limitChecks)) {
      throw new ToolError(
        400,
        `limits[${index}].kind: unsupported limit type "${limit.kind}". Supported: ${Object.keys(limitChecks).join(", ")}.`,
      );
    }
    const value = Number(limit.value);
    if (Number.isNaN(value)) throw new ToolError(400, `limits[${index}].value: expected a number.`);
    return { ...limit, value };
  });
}

export type Measured = { sizes: number; fitPct: number; newRisk: number };

export const measuredOf = (design: Design, summary: Summary): Measured => ({
  sizes: design.sizes.length,
  fitPct: summary.fitPct,
  newRisk: summary.newRiskHeartIds.length,
});

export const checkLimits = (limits: Limit[], measured: Measured) =>
  checkedLimits(limits).map((limit) => ({
    id: limit.id,
    kind: limit.kind,
    value: limit.value,
    ...limitChecks[limit.kind](limit, measured),
  }));

export function editDesignTool({ design, change, limits = [] }: z.infer<typeof editDesignInput>) {
  checkedLimits(limits);
  const parent = evaluateOrThrow(design);
  const edited = applyChange(design, change);
  if ("reasons" in edited) return { valid: false, reasons: edited.reasons };
  const child = evaluate(edited.design, { parent: design });
  if (!child.ok) return { valid: false, reasons: child.reasons };

  const { summary } = child;
  return {
    valid: true,
    design: edited.design,
    comparison: {
      parent: parent.summary,
      child: summary,
      fitPctDelta: summary.fitPct - parent.summary.fitPct,
      newRiskHeartIds: summary.newRiskHeartIds,
      changed: changedHearts(parent.results, child.results),
    },
    limits: checkLimits(limits, measuredOf(edited.design, summary)),
  };
}

export const reportFindingsTool = ({ mechanisms }: z.infer<typeof reportFindingsInput>) => ({ findings: mechanisms });

export function submitProposalTool(input: z.infer<typeof submitProposalInput>) {
  evaluateOrThrow(input.design);
  return input;
}
