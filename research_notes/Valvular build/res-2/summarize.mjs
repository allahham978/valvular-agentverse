import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const runs = readFileSync(join(HERE, "runs.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

const quantile = (values, q) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
};
const median = (values) => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const sum = (values) => values.reduce((a, b) => a + b, 0);
const invalidTotal = (r) => sum(Object.values(r.invalid));

function summarize(group) {
  const steps = group.flatMap((r) => r.steps);
  const stepMs = steps.map((s) => s.ms);
  const invalid = {};
  for (const r of group) for (const [k, v] of Object.entries(r.invalid)) invalid[k] = (invalid[k] ?? 0) + v;
  return {
    runs: group.length,
    ok: group.filter((r) => r.ok).length,
    okWithoutInvalid: group.filter((r) => r.ok && invalidTotal(r) === 0).length,
    nonAnnulusMechanism: group.filter((r) => r.measurements.some((m) => m !== "annulus")).length,
    atLeast3DistinctTools: group.filter((r) => new Set(r.toolSequence).size >= 3).length,
    stops: group.reduce((a, r) => ({ ...a, [r.stop]: (a[r.stop] ?? 0) + 1 }), {}),
    invalid,
    invalidTotal: sum(group.map(invalidTotal)),
    emptyOrMalformed: sum(group.map((r) => r.emptyOrMalformed)),
    httpEvents: sum(group.map((r) => r.httpEvents.length)),
    http429: group.flatMap((r) => r.httpEvents).filter((e) => e.status === 429).length,
    turnsMedian: median(group.map((r) => r.turns)),
    turnsMax: Math.max(...group.map((r) => r.turns)),
    toolCallsMedian: median(group.map((r) => r.toolSequence.length)),
    toolCallsMax: Math.max(...group.map((r) => r.toolSequence.length)),
    parallelTurns: sum(group.map((r) => r.parallelTurns)),
    steps: steps.length,
    stepMedianS: median(stepMs) / 1000,
    stepP90S: quantile(stepMs, 0.9) / 1000,
    stepMaxS: Math.max(...stepMs) / 1000,
    runMedianS: median(group.map((r) => r.totalMs)) / 1000,
    runMaxS: Math.max(...group.map((r) => r.totalMs)) / 1000,
    outputTokensMedian: median(steps.map((s) => s.output)),
    thoughtTokensMedian: median(steps.map((s) => s.thoughts)),
    uncountedTokensMedian: median(steps.map((s) => (s.total ?? 0) - s.prompt - s.output - s.thoughts)),
    costUsd: Math.round(sum(group.map((r) => r.costUsd)) * 1000) / 1000,
    costPerRunUsd: Math.round((sum(group.map((r) => r.costUsd)) / group.length) * 1000) / 1000,
  };
}

const by = (key) => Object.fromEntries([...new Set(runs.map((r) => r[key]))].map((v) => [v, summarize(runs.filter((r) => r[key] === v))]));
const sequences = (valve) => [...new Set(runs.filter((r) => r.valve === valve).map((r) => r.toolSequence.join(">")))].length;
const summary = {
  all: summarize(runs),
  byLevel: by("level"),
  byMode: by("mode"),
  byValve: by("valve"),
  byLevelMode: Object.fromEntries(
    [...new Set(runs.map((r) => `${r.level}/${r.mode}`))].map((k) => [k, summarize(runs.filter((r) => `${r.level}/${r.mode}` === k))]),
  ),
  distinctSequences: Object.fromEntries([...new Set(runs.map((r) => r.valve))].map((v) => [v, sequences(v)])),
  rateHeadersSeen: [...new Set(runs.flatMap((r) => Object.keys(r.lastRateHeaders)))],
  httpEvents: runs.flatMap((r) => r.httpEvents.map((e) => ({ run: r.id, ...e }))),
  perRun: runs.map((r) => ({
    id: r.id, level: r.level, mode: r.mode, valve: r.valve, ok: r.ok, stop: r.stop, turns: r.turns,
    tools: r.toolSequence.length, invalid: invalidTotal(r), slowestS: Math.max(...r.steps.map((s) => s.ms)) / 1000,
    totalS: r.totalMs / 1000, costUsd: Math.round(r.costUsd * 1000) / 1000,
  })),
};
writeFileSync(join(HERE, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 1));
