import type { Claim, Design, Evidence, Proposal, Summary } from "../../contracts";
import { defaultRules } from "../../engine";
import { canonical } from "../../tools/evidence";
import { evaluate } from "../../tools/fit";
import { stressTestInput } from "../../tools/inputs";
import { stressConditions } from "../../tools/stress";

type Verdict = NonNullable<Proposal["verdict"]>;

export type AttackOutcome = {
  evidenceId: string;
  kind: string;
  amount?: number;
  value: number;
  holds: boolean;
  outcome: "survived" | "broke";
};

export type VerdictResult = {
  verdict: Verdict;
  notShown: string[];
  dev: { metric: Claim["metric"]; value: number; holds: boolean } | null;
  attacks: AttackOutcome[];
};

export type VerdictInput = {
  proposal: Proposal;
  design: Design;
  parent: Design;
  dev: Summary;
  evidence: Evidence[];
  attacks: Evidence[];
};

const claimValue = (claim: Claim, summary: Summary) =>
  claim.metric === "fitPct" ? summary.fitPct : summary.newRiskHeartIds.length;

const holds = (claim: Claim, value: number) => (claim.comparator === ">=" ? value >= claim.threshold : value <= claim.threshold);

const sizesIn = (value: unknown) => canonical((value as { design?: { sizes?: unknown } } | null)?.design?.sizes);

function citesDesign(proposal: Proposal, design: Design, evidence: Evidence[]) {
  const sizes = canonical(design.sizes);
  return proposal.evidenceIds
    .map((id) => evidence.find((item) => item.id === id))
    .some((item) => item && (sizesIn(item.input) === sizes || sizesIn(item.result) === sizes));
}

function attackOutcomes({ design, parent, attacks }: VerdictInput, claim: Claim): AttackOutcome[] {
  const sizes = canonical(design.sizes);
  return attacks.flatMap((attack) => {
    const input = stressTestInput.safeParse(attack.input);
    if (attack.tool !== "stress_test" || !input.success || canonical(input.data.design.sizes) !== sizes) return [];
    const under = evaluate(design, { parent, ...stressConditions(input.data) });
    if (!under.ok) return [];
    const value = claimValue(claim, under.summary);
    const kept = holds(claim, value);
    return [
      {
        evidenceId: attack.id,
        kind: input.data.kind,
        ...(input.data.amount === undefined ? {} : { amount: input.data.amount }),
        value,
        holds: kept,
        outcome: kept ? ("survived" as const) : ("broke" as const),
      },
    ];
  });
}

const describeAttack = (attack: AttackOutcome) =>
  `${attack.kind}${attack.amount === undefined ? "" : ` ${attack.amount}`} (${attack.outcome})`;

function notShownFor(verdict: Verdict, attacks: AttackOutcome[], invalidReason: string | null): string[] {
  return [
    "Dev hearts only: hidden hearts were not scored.",
    ...(defaultRules.rules.some((rule) => rule.status === "demo-assumption") ? ["Fit rules are demo-assumption."] : []),
    attacks.length > 0 ? `Only these attacks ran: ${attacks.map(describeAttack).join(", ")}.` : "No attack finished.",
    ...(verdict === "invalid_experiment" && invalidReason ? [invalidReason] : []),
  ];
}

export function assignVerdict(input: VerdictInput): VerdictResult {
  const { proposal, design, dev, evidence } = input;
  const { claim } = proposal;
  if (!claim) {
    return { verdict: "invalid_experiment", notShown: notShownFor("invalid_experiment", [], "Invalid experiment: the proposal has no claim to test."), dev: null, attacks: [] };
  }

  const attacks = attackOutcomes(input, claim);
  const value = claimValue(claim, dev);
  const devResult = { metric: claim.metric, value, holds: holds(claim, value) };
  const invalid = citesDesign(proposal, design, evidence)
    ? null
    : "Invalid experiment: the cited evidence does not match the proposed design.";

  const verdict: Verdict = invalid
    ? "invalid_experiment"
    : !devResult.holds
      ? "contradicted"
      : attacks.length === 0
        ? "inconclusive"
        : attacks.some((attack) => !attack.holds)
          ? "context_dependent"
          : "supported_under_conditions";
  return { verdict, notShown: notShownFor(verdict, attacks, invalid), dev: devResult, attacks };
}
