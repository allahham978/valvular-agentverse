import type { Design, FitResult, Heart, Summary } from "../contracts/index";
import { defaultRules, numParam, strParam, type Rule, type RuleSet } from "./rules";

export { defaultRules, RuleSetSchema, type Rule, type RuleSet } from "./rules";
export { STARTING_VALVE } from "./starting-valve";

export type DesignRejection = {
  ruleId: string;
  sizeMm: number;
  widthMm: number;
  limitMm: number;
  message: string;
};

export type Evaluation =
  | { ok: true; rulesVersion: string; results: FitResult[]; summary: Summary }
  | { ok: false; rulesVersion: string; reasons: DesignRejection[] };

type Reason = FitResult["reasons"][number];
type Size = Design["sizes"][number];

export type EvaluateInput = {
  hearts: Heart[];
  design: Design;
  parent?: Design;
  split?: "dev" | "hidden";
  rules?: RuleSet;
};

function rulesOfKind(rules: RuleSet, kind: Rule["kind"]): Rule[] {
  return rules.rules.filter((rule) => rule.kind === kind);
}

function widthRejections(design: Design, rules: RuleSet): DesignRejection[] {
  return rulesOfKind(rules, "size-width").flatMap((rule) => {
    const limitMm = numParam(rule, "maxMm");
    return design.sizes
      .filter((size) => size.maxAnnulusMm - size.minAnnulusMm > limitMm)
      .map((size) => {
        const widthMm = size.maxAnnulusMm - size.minAnnulusMm;
        return {
          ruleId: rule.id,
          sizeMm: size.nominalMm,
          widthMm,
          limitMm,
          message: `The ${size.nominalMm} mm size covers ${widthMm} mm of annulus, more than the ${limitMm} mm limit.`,
        };
      });
  });
}

function measure(heart: Heart, key: string): number {
  const value = heart.measures[key];
  if (typeof value !== "number") throw new Error(`${heart.id} has no measure ${key}`);
  return value;
}

function nearestEdge(annulus: number, design: Design): { limit: number; distance: number } {
  let best = { limit: Number.POSITIVE_INFINITY, distance: Number.POSITIVE_INFINITY };
  for (const edge of design.sizes.flatMap((s) => [s.minAnnulusMm, s.maxAnnulusMm])) {
    const distance = Math.abs(annulus - edge);
    if (distance < best.distance || (distance === best.distance && edge < best.limit)) {
      best = { limit: edge, distance };
    }
  }
  return best;
}

function fitHeart(heart: Heart, design: Design, rules: RuleSet): FitResult {
  const [coverage] = rulesOfKind(rules, "annulus-coverage");
  const [frame] = rulesOfKind(rules, "frame-outflow");
  if (!coverage || !frame) throw new Error("rules need annulus-coverage and frame-outflow");

  const annulus = measure(heart, strParam(coverage, "measure"));
  const size: Size | undefined = design.sizes
    .filter((s) => s.minAnnulusMm <= annulus && annulus <= s.maxAnnulusMm)
    .sort((a, b) => a.nominalMm - b.nominalMm)[0];
  if (!size) {
    const { limit, distance } = nearestEdge(annulus, design);
    return {
      heartId: heart.id,
      designId: design.id,
      status: "no-fit",
      reasons: [{ ruleId: coverage.id, measured: annulus, limit, margin: -distance }],
    };
  }

  const outflow = size.nominalMm + numParam(frame, "offsetMm");
  const reasons: Reason[] = [];
  for (const rule of rules.rules) {
    if (rule.kind !== "outflow-clearance" && rule.kind !== "outflow-excess") continue;
    const measured = measure(heart, strParam(rule, "measure"));
    const limit =
      rule.kind === "outflow-clearance" ? outflow + numParam(rule, "minMm") : outflow - numParam(rule, "maxMm");
    const margin = measured - limit;
    if (margin < 0) reasons.push({ ruleId: rule.id, measured, limit, margin });
  }
  return {
    heartId: heart.id,
    designId: design.id,
    status: reasons.length ? "risk" : "fit",
    sizeMm: size.nominalMm,
    reasons,
  };
}

function fitAll(hearts: Heart[], design: Design, rules: RuleSet): FitResult[] {
  return hearts
    .map((heart) => fitHeart(heart, design, rules))
    .sort((a, b) => (a.heartId < b.heartId ? -1 : a.heartId > b.heartId ? 1 : 0));
}

export function evaluateDesign({ hearts, design, parent, split = "dev", rules = defaultRules }: EvaluateInput): Evaluation {
  const rejections = [...widthRejections(design, rules), ...(parent ? widthRejections(parent, rules) : [])];
  if (rejections.length) return { ok: false, rulesVersion: rules.version, reasons: rejections };

  const results = fitAll(hearts, design, rules);
  const parentRisk = new Set(
    parent
      ? fitAll(hearts, parent, rules)
          .filter((r) => r.status === "risk")
          .map((r) => r.heartId)
      : [],
  );
  const count = (status: FitResult["status"]) => results.filter((r) => r.status === status).length;
  const fit = count("fit");
  const summary: Summary = {
    designId: design.id,
    split,
    total: results.length,
    fit,
    risk: count("risk"),
    noFit: count("no-fit"),
    fitPct: results.length ? (fit / results.length) * 100 : 0,
    newRiskHeartIds: parent
      ? results.filter((r) => r.status === "risk" && !parentRisk.has(r.heartId)).map((r) => r.heartId)
      : [],
  };
  return { ok: true, rulesVersion: rules.version, results, summary };
}
