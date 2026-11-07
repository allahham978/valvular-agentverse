import { writeFileSync } from "node:fs";
import type { FitResult, Heart, RunEvent } from "../../src/contracts";

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(2026);
const round = (value: number) => Math.round(value * 10) / 10;

const hearts: Heart[] = [];
const results: FitResult[] = [];

for (let i = 1; i <= 400; i++) {
  const id = `sample-${String(i).padStart(3, "0")}`;
  const annulus = round(20 + random() * 8);
  const sinus = round(annulus + 4 + random() * 6);
  const junction = round(annulus + 1 + random() * 6);
  hearts.push({
    id,
    split: "dev",
    provenance: "synthetic",
    measures: {
      annulusMm: annulus,
      sinusMm: sinus,
      sinotubularJunctionMm: junction,
    },
    thumbUrl: "/fixtures/sample-thumb.png",
    meshUrl: "/fixtures/root-sample.glb",
  });

  const outflow = round(Math.round(annulus) + 4);
  let result: FitResult = {
    heartId: id,
    designId: "sample-design",
    status: "fit",
    sizeMm: Math.min(27, Math.max(23, Math.round(annulus / 2) * 2 - 1)),
    reasons: [],
  };
  if (annulus < 21 || annulus > 27) {
    result = {
      ...result,
      status: "no-fit",
      sizeMm: undefined,
      reasons: [
        {
          ruleId: "annulus-range",
          measured: annulus,
          limit: annulus < 21 ? 21 : 27,
          margin: round(annulus < 21 ? annulus - 21 : 27 - annulus),
        },
      ],
    };
  } else if (outflow - junction > 2) {
    result = {
      ...result,
      status: "risk",
      reasons: [
        {
          ruleId: "outflow-vs-junction",
          measured: round(outflow - junction),
          limit: 2,
          margin: round(2 - (outflow - junction)),
        },
      ],
    };
  } else if (sinus - outflow < 1) {
    result = {
      ...result,
      status: "risk",
      reasons: [
        {
          ruleId: "sinus-clearance",
          measured: round(sinus - outflow),
          limit: 1,
          margin: round(sinus - outflow - 1),
        },
      ],
    };
  }
  results.push(result);
}

const at = "2026-01-01T00:00:00.000Z";
const lines: [RunEvent["actor"], string, string][] = [
  ["code", "run-start", "Run started on the starting valve."],
  ["breaker", "tool-call", "Grouped failing hearts by rule."],
  [
    "breaker",
    "finding",
    "Hearts with a narrow sinotubular junction are the largest at-risk group.",
  ],
  ["fixer", "proposal", "Proposed adding a 29 mm size."],
  ["breaker", "attack", "Shifted every measurement by 1 mm and retested."],
];
const events: RunEvent[] = lines.map(([actor, type, text], index) => ({
  seq: index + 1,
  at,
  actor,
  type,
  text,
  data: null,
  mode: "replay",
}));

const write = (file: string, value: unknown) =>
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n");

write("fixtures/sample-hearts.json", { label: "Sample data", hearts, results });
write("fixtures/sample-feed.json", { label: "Sample data", events });

const counts = { fit: 0, risk: 0, "no-fit": 0 };
results.forEach((result) => counts[result.status]++);
console.log(counts);
