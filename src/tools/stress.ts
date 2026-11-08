import type { Heart } from "../contracts";
import { defaultRules, type RuleSet } from "../engine";
import { strParam } from "../engine/rules";
import { devHearts } from "../lib/dev-hearts";
import type { z } from "zod";
import { ToolError } from "./evidence";
import { changedHearts, evaluateOrThrow } from "./fit";
import type { stressTestInput } from "./inputs";

type StressInput = z.infer<typeof stressTestInput>;

const readMeasures = [
  ...new Set(defaultRules.rules.filter((rule) => typeof rule.params.measure === "string").map((rule) => strParam(rule, "measure"))),
];

const shiftMeasures = (hearts: Heart[], measures: string[], amount: number): Heart[] =>
  hearts.map((heart) => ({
    ...heart,
    measures: Object.fromEntries(
      Object.entries(heart.measures).map(([key, value]) => [key, measures.includes(key) ? value + amount : value]),
    ),
  }));

type Conditions = { hearts?: Heart[]; rules?: RuleSet };

export function stressConditions({ kind, amount = 0, measure, heartIds }: Pick<StressInput, "kind" | "amount" | "measure" | "heartIds">): Conditions {
  const hearts = devHearts();
  if (kind === "measurement_shift") return { hearts: shiftMeasures(hearts, measure ? [measure] : readMeasures, amount) };
  if (kind === "assumption_shift") {
    return {
      rules: {
        ...defaultRules,
        rules: defaultRules.rules.map((rule) =>
          rule.kind === "frame-outflow" ? { ...rule, params: { ...rule.params, offsetMm: Number(rule.params.offsetMm) + amount } } : rule,
        ),
      },
    };
  }
  return { hearts: hearts.filter((heart) => heartIds?.includes(heart.id)) };
}

export function stressTestTool(input: StressInput) {
  const { design, kind, amount = 0, hypothesis, disprovedIf, measure } = input;
  if (measure !== undefined && !readMeasures.includes(measure)) {
    throw new ToolError(400, `measure: expected one of ${readMeasures.join(", ")}.`);
  }
  const before = evaluateOrThrow(design);
  const after = evaluateOrThrow(design, stressConditions(input));
  const changed = kind === "subgroup" ? [] : changedHearts(before.results, after.results);
  return {
    kind,
    amount,
    hypothesis,
    disprovedIf,
    total: before.summary.total,
    changedCount: changed.length,
    changed,
    before: before.summary,
    after: after.summary,
  };
}
