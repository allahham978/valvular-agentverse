import type { Design, FitResult, FitStatus, Heart } from "@/contracts";
import { evaluateDesign, type DesignRejection, type RuleSet } from "@/engine";
import { devHearts } from "@/lib/dev-hearts";
import { shortHash, ToolError } from "./evidence";
import type { Change } from "./inputs";

export type Reason = { ruleId: string; message: string };
export type Changed = { heartId: string; from: FitStatus; to: FitStatus };

const rejectionText = (reasons: DesignRejection[]) =>
  `Design rejected: ${reasons.map((reason) => reason.message).join(" ")}`;

type Options = { parent?: Design; hearts?: Heart[]; rules?: RuleSet };

export const evaluate = (design: Design, options: Options = {}) =>
  evaluateDesign({ hearts: devHearts(), design, ...options });

export function evaluateOrThrow(design: Design, options: Options = {}) {
  const evaluation = evaluate(design, options);
  if (!evaluation.ok) throw new ToolError(422, rejectionText(evaluation.reasons));
  return evaluation;
}

export function changedHearts(before: FitResult[], after: FitResult[]): Changed[] {
  const was = new Map(before.map((result) => [result.heartId, result.status]));
  return after
    .filter((result) => was.get(result.heartId) !== result.status)
    .map((result) => ({ heartId: result.heartId, from: was.get(result.heartId) as FitStatus, to: result.status }));
}

export function applyChange(design: Design, change: Change): { design: Design } | { reasons: Reason[] } {
  const nominal = change.kind === "add_size" ? change.size.nominalMm : change.nominalMm;
  const exists = design.sizes.some((size) => size.nominalMm === nominal);
  const refuse = (message: string) => ({ reasons: [{ ruleId: "change", message }] });
  if (change.kind === "add_size" && exists) return refuse(`The design already has a ${nominal} mm size.`);
  if (change.kind !== "add_size" && !exists) return refuse(`The design has no ${nominal} mm size.`);
  if (change.kind === "remove_size" && design.sizes.length === 1) return refuse("A design needs at least one size.");

  const sizes =
    change.kind === "add_size"
      ? [...design.sizes, change.size]
      : change.kind === "remove_size"
        ? design.sizes.filter((size) => size.nominalMm !== nominal)
        : design.sizes.map((size) =>
            size.nominalMm === nominal
              ? { nominalMm: nominal, minAnnulusMm: change.minAnnulusMm, maxAnnulusMm: change.maxAnnulusMm }
              : size,
          );
  const verb = { add_size: "Added", remove_size: "Removed", set_range: "Changed range of" }[change.kind];
  return {
    design: {
      id: `${design.id}-${shortHash([design.sizes, change])}`,
      label: `${verb} ${nominal} mm size`,
      hypothetical: true,
      sizes,
      parentId: design.id,
    },
  };
}
