import type { ScriptedTurn } from "@/agents/model-client";
import type { Design } from "@/contracts";

const LAST_EVIDENCE = "$lastEvidenceId";
const STEP_MS = 650;

const startDesign: Design = {
  id: "start",
  label: "Starting valve",
  hypothetical: true,
  sizes: [
    { nominalMm: 23, minAnnulusMm: 21, maxAnnulusMm: 23 },
    { nominalMm: 25, minAnnulusMm: 23, maxAnnulusMm: 25 },
    { nominalMm: 27, minAnnulusMm: 25, maxAnnulusMm: 27 },
  ],
};

const widerDesign: Design = {
  id: "demo-wider",
  label: "Added 29 mm size",
  hypothetical: true,
  parentId: startDesign.id,
  sizes: [...startDesign.sizes, { nominalMm: 29, minAnnulusMm: 27, maxAnnulusMm: 29 }],
};

const finding = (title: string, explanation: string) => ({
  title,
  explanation,
  heartIds: [],
  severity: "high",
  evidenceIds: [LAST_EVIDENCE],
});

export const demoTurns: ScriptedTurn[] = [
  {
    text: "Checking the starting valve against the test hearts.",
    toolCalls: [{ name: "evaluate_design", args: { design: startDesign } }],
  },
  {
    toolCalls: [
      {
        name: "report_findings",
        args: {
          mechanisms: [
            finding(
              "Annulus above the largest size",
              "Hearts with an annulus over 27 mm have no size that seats them.",
            ),
            finding(
              "Thin overlap between sizes",
              "Neighbouring sizes meet at one edge, so hearts on the boundary are marginal.",
            ),
          ],
        },
      },
    ],
  },
  {
    text: "Checking a wider range.",
    toolCalls: [{ name: "evaluate_design", args: { design: widerDesign } }],
  },
  {
    toolCalls: [
      {
        name: "submit_proposal",
        args: {
          design: widerDesign,
          rationale: "Add a 29 mm size covering the 27-29 mm annulus range the current sizes miss.",
          claim: { metric: "fitPct", comparator: ">=", threshold: 66.75 },
          tradeOffs: ["One more size to stock", "Hearts near 27 mm may sit closer to the limit"],
          evidenceIds: [LAST_EVIDENCE],
        },
      },
    ],
  },
  {
    text: "Shifting every measurement to see if the claim still holds.",
    toolCalls: [
      {
        name: "stress_test",
        args: {
          design: widerDesign,
          kind: "measurement_shift",
          amount: 1,
          hypothesis: "The claim still holds after this shift.",
          disprovedIf: "The claimed metric crosses its threshold after the shift.",
        },
      },
    ],
  },
  {
    toolCalls: [
      {
        name: "report_findings",
        args: {
          mechanisms: [
            finding(
              "The claim held after shifting every measurement",
              "Fit stayed above the claimed threshold after the shift, so the proposal survived this attack.",
            ),
          ],
        },
      },
    ],
  },
].map((turn) => ({ ...turn, delayMs: STEP_MS }));

export const demoRequest = {
  model: { kind: "scripted", turns: demoTurns },
  budget: { maxRounds: 1 },
  demo: true,
} as const;
