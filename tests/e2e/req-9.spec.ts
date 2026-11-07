import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";
import { z } from "zod";
import {
  EvidenceSchema,
  RunSchema,
  type Design,
  type FitResult,
  type Heart,
  type Run,
  type RunEvent,
  type Summary,
} from "../../src/contracts/index";

// REQ-9: Agent tools. Every call goes through POST /api/tools or the REQ-5 run API,
// using the scripted model only: no Gemini key and no network beyond localhost.

const ROOT = process.cwd();
const TOL = 1e-9;
const RUN_TIMEOUT_MS = 60_000;

const devHearts = (
  JSON.parse(readFileSync(path.join(ROOT, "data/hearts.dev.json"), "utf8")) as { hearts: Heart[] }
).hearts;
const hiddenHearts = (
  JSON.parse(readFileSync(path.join(ROOT, "server-data/hearts.hidden.json"), "utf8")) as { hearts: Heart[] }
).hearts;
const HIDDEN = hiddenHearts[0];
const EXPECTED_PROVENANCE = {
  rulesVersion: (JSON.parse(readFileSync(path.join(ROOT, "data/rules.json"), "utf8")) as { version: string })
    .version,
  dataHash: createHash("sha256").update(readFileSync(path.join(ROOT, "data/hearts.dev.json"))).digest("hex"),
  seed: (JSON.parse(readFileSync(path.join(ROOT, "data/sources.json"), "utf8")) as { seed: number }).seed,
};

const START: Design = {
  id: "start",
  label: "Starting valve",
  hypothetical: true,
  sizes: [
    { nominalMm: 23, minAnnulusMm: 21, maxAnnulusMm: 23 },
    { nominalMm: 25, minAnnulusMm: 23, maxAnnulusMm: 25 },
    { nominalMm: 27, minAnnulusMm: 25, maxAnnulusMm: 27 },
  ],
};
const SIZE_29 = { nominalMm: 29, minAnnulusMm: 27, maxAnnulusMm: 29 };
const ADD_29 = { kind: "add_size", size: SIZE_29 } as const;
const WIDER: Design = { id: "req9-wider", label: "Added 29 mm size", hypothetical: true, parentId: "start", sizes: [...START.sizes, SIZE_29] };
const CLAIM = { metric: "fitPct", comparator: ">=", threshold: 60 } as const;
const HYPOTHESIS = "A 1 mm larger reading moves hearts near a size edge into another status.";
const DISPROVED_IF = "No heart changes status after the shift.";

const ToolEvidence = z.object({
  id: z.string().regex(/^ev-[0-9a-f]{8,}$/),
  tool: z.string(),
  input: z.unknown(),
  result: z.unknown(),
  source: z.literal("computed"),
  provenance: z.object({ rulesVersion: z.string(), dataHash: z.string(), seed: z.number() }),
});
type ToolEvidence = z.infer<typeof ToolEvidence>;
const Changed = z.array(z.object({ heartId: z.string(), from: z.string(), to: z.string() }));
const SummaryShape = z.object({
  designId: z.string(),
  split: z.literal("dev"),
  total: z.number(),
  fit: z.number(),
  risk: z.number(),
  noFit: z.number(),
  fitPct: z.number(),
  newRiskHeartIds: z.array(z.string()),
});

type FitBody = { summary: Summary; results: FitResult[] };

async function callTool(request: APIRequestContext, tool: string, input: unknown): Promise<APIResponse> {
  return request.post("/api/tools", { data: { tool, input } });
}

async function okTool(request: APIRequestContext, tool: string, input: unknown): Promise<ToolEvidence> {
  const response = await callTool(request, tool, input);
  const body = (await response.json()) as { ok: boolean; evidence?: unknown; error?: string };
  expect(response.status(), `${tool}: ${body.error ?? ""}`).toBe(200);
  expect(body.ok, tool).toBe(true);
  const evidence = ToolEvidence.parse(body.evidence);
  expect(evidence.tool).toBe(tool);
  expect(evidence.provenance, `${tool} provenance`).toEqual(EXPECTED_PROVENANCE);
  expect(EvidenceSchema.parse(evidence), "the contract keeps source and provenance").toMatchObject({
    source: "computed",
    provenance: EXPECTED_PROVENANCE,
  });
  return evidence;
}

async function refused(request: APIRequestContext, tool: string, input: unknown, status: number) {
  const response = await callTool(request, tool, input);
  const text = await response.text();
  expect(response.status(), `${tool} → ${text}`).toBe(status);
  const body = JSON.parse(text) as { ok: boolean; error: unknown; evidence?: unknown };
  expect(body.ok).toBe(false);
  expect(typeof body.error).toBe("string");
  expect((body.error as string).length, "the error explains itself").toBeGreaterThan(10);
  expect(body.evidence).toBeUndefined();
  return { error: body.error as string, text };
}

async function fit(request: APIRequestContext, design?: Design, parent?: Design): Promise<FitBody> {
  const response = design ? await request.post("/api/fit", { data: { design, ...(parent ? { parent } : {}) } }) : await request.get("/api/fit");
  expect(response.status()).toBe(200);
  return (await response.json()) as FitBody;
}

const failing = (results: FitResult[]) => results.filter((r) => r.status !== "fit");
const shiftDesign = (design: Design, annulus: number, nominal: number): Design => ({
  ...design,
  id: `${design.id}-shifted`,
  sizes: design.sizes.map((s) => ({
    nominalMm: s.nominalMm + nominal,
    minAnnulusMm: s.minAnnulusMm + annulus,
    maxAnnulusMm: s.maxAnnulusMm + annulus,
  })),
});
const statusChanges = (a: FitResult[], b: FitResult[]) => {
  const before = new Map(a.map((r) => [r.heartId, r.status]));
  return b.filter((r) => before.get(r.heartId) !== r.status).map((r) => r.heartId).sort();
};
const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;

let base: FitBody;
let riskIds: string[];
test.beforeAll(async ({ playwright }, testInfo) => {
  const request = await playwright.request.newContext({ baseURL: testInfo.project.use.baseURL });
  base = await fit(request);
  await request.dispose();
  riskIds = base.results.filter((r) => r.status === "risk").map((r) => r.heartId);
  expect(riskIds.length).toBeGreaterThan(0);
  expect(new Set(devHearts.map((h) => h.id)).has(HIDDEN.id)).toBe(false);
});

test.describe("Done when 1: each of the 9 tools returns a result and evidence with source and provenance", () => {
  test("evaluate_design matches the fit engine and is repeatable", async ({ request }) => {
    const evidence = await okTool(request, "evaluate_design", { design: START });
    const result = evidence.result as Summary & { changed: unknown };
    const summary = SummaryShape.parse(result);
    expect(summary.total).toBe(400);
    expect(summary).toMatchObject({ fit: base.summary.fit, risk: base.summary.risk, noFit: base.summary.noFit });
    expect(summary.fit + summary.risk + summary.noFit).toBe(400);
    expect(Changed.parse(result.changed)).toEqual([]);
    expect(summary.newRiskHeartIds).toEqual([]);
    expect(await okTool(request, "evaluate_design", { design: START }), "fixed result for fixed input").toEqual(evidence);

    const withParent = await okTool(request, "evaluate_design", { design: WIDER, parent: START });
    const expected = await fit(request, WIDER, START);
    const r = withParent.result as Summary & { changed: unknown };
    expect([...r.newRiskHeartIds].sort()).toEqual([...expected.summary.newRiskHeartIds].sort());
    expect(Changed.parse(r.changed).map((c) => c.heartId)).toEqual(statusChanges(base.results, expected.results));
    expect(withParent.id).not.toBe(evidence.id);
  });

  test("group_failures counts by rule, size and measurement band", async ({ request }) => {
    const Group = z.object({ key: z.string(), count: z.number(), risk: z.number(), noFit: z.number(), heartIds: z.array(z.string()) });
    const Groups = z.object({ by: z.string(), groups: z.array(Group).min(1) });
    const failingIds = failing(base.results).map((r) => r.heartId).sort();

    const byRule = Groups.parse((await okTool(request, "group_failures", { design: START, by: "rule" })).result);
    const expectedByRule = new Map<string, Set<string>>();
    for (const r of failing(base.results)) {
      for (const reason of r.reasons) {
        expectedByRule.set(reason.ruleId, (expectedByRule.get(reason.ruleId) ?? new Set()).add(r.heartId));
      }
    }
    expect(byRule.groups.map((g) => g.key).sort()).toEqual([...expectedByRule.keys()].sort());
    for (const group of byRule.groups) {
      expect(group.count, group.key).toBe(expectedByRule.get(group.key)?.size);
      expect([...group.heartIds].sort()).toEqual([...(expectedByRule.get(group.key) ?? [])].sort());
      expect(group.risk + group.noFit).toBe(group.count);
    }

    for (const by of ["size", "band"]) {
      const grouped = Groups.parse((await okTool(request, "group_failures", { design: START, by })).result);
      expect(grouped.by).toBe(by);
      expect(grouped.groups.flatMap((g) => g.heartIds).sort(), `${by} covers every failing heart once`).toEqual(failingIds);
      expect(grouped.groups.reduce((sum, g) => sum + g.count, 0)).toBe(failingIds.length);
    }
  });

  test("profile_group, inspect_heart and what_if return computed results", async ({ request }) => {
    const profile = await okTool(request, "profile_group", { heartIds: riskIds.slice(0, 5) });
    expect((profile.result as { groupSize: number }).groupSize).toBe(5);

    const heartId = riskIds[0];
    const inspected = (await okTool(request, "inspect_heart", { heartId, design: START })).result as FitResult & {
      measures: Record<string, number>;
    };
    const expected = base.results.find((r) => r.heartId === heartId);
    expect(inspected.heartId).toBe(heartId);
    expect(inspected.status).toBe(expected?.status);
    expect(inspected.sizeMm).toBe(expected?.sizeMm);
    expect(inspected.reasons).toEqual(expected?.reasons);
    expect(inspected.measures).toEqual(devHearts.find((h) => h.id === heartId)?.measures);

    const wider = await fit(request, WIDER, START);
    const above27 = devHearts.filter((h) => (h.measures.annulusMm ?? 0) > 27 && (h.measures.annulusMm ?? 0) <= 29).map((h) => h.id).slice(0, 6);
    expect(above27.length).toBeGreaterThan(0);
    const whatIf = (await okTool(request, "what_if", { design: START, heartIds: above27, change: ADD_29 })).result as {
      valid: boolean;
      hearts: { heartId: string; before: string; after: string; fixed: boolean }[];
      fixedCount: number;
    };
    expect(whatIf.valid).toBe(true);
    expect(whatIf.hearts.map((h) => h.heartId).sort()).toEqual([...above27].sort());
    for (const h of whatIf.hearts) {
      expect(h.before).toBe(base.results.find((r) => r.heartId === h.heartId)?.status);
      expect(h.after).toBe(wider.results.find((r) => r.heartId === h.heartId)?.status);
      expect(h.fixed).toBe(h.before !== "fit" && h.after === "fit");
    }
    expect(whatIf.fixedCount).toBe(whatIf.hearts.filter((h) => h.fixed).length);
  });

  test("stress_test runs all three attack kinds and echoes the stated hypothesis", async ({ request }) => {
    const common = { design: START, hypothesis: HYPOTHESIS, disprovedIf: DISPROVED_IF };
    const shift = (await okTool(request, "stress_test", { ...common, kind: "measurement_shift", amount: 1 })).result as {
      hypothesis: string;
      disprovedIf: string;
      kind: string;
    };
    expect(shift).toMatchObject({ kind: "measurement_shift", hypothesis: HYPOTHESIS, disprovedIf: DISPROVED_IF });

    const assumption = (await okTool(request, "stress_test", { ...common, kind: "assumption_shift", amount: 1 })).result as {
      changedCount: number;
      after: Summary;
    };
    const frameOneMmLonger = await fit(request, shiftDesign(START, 0, 1));
    expect(assumption.changedCount).toBe(statusChanges(base.results, frameOneMmLonger.results).length);
    expect(assumption.after.risk).toBe(frameOneMmLonger.summary.risk);

    const subgroupIds = riskIds.slice(0, 7);
    const subgroup = (await okTool(request, "stress_test", { ...common, kind: "subgroup", amount: 0, heartIds: subgroupIds })).result as {
      after: Summary;
    };
    expect(subgroup.after.total).toBe(subgroupIds.length);
    expect(subgroup.after.risk).toBe(subgroupIds.length);
  });

  test("report_findings validates findings and edit_design and submit_proposal return evidence", async ({ request }) => {
    const cited = await okTool(request, "evaluate_design", { design: START });
    const mechanism = {
      title: "Narrow junction",
      explanation: "At-risk hearts have a narrower sinotubular junction.",
      heartIds: riskIds.slice(0, 3),
      severity: "high",
      evidenceIds: [cited.id],
    };
    const report = (await okTool(request, "report_findings", { mechanisms: [mechanism] })).result as { findings: unknown[] };
    expect(report.findings).toEqual([mechanism]);

    const edited = (await okTool(request, "edit_design", { design: START, change: ADD_29 })).result as { valid: boolean };
    expect(edited.valid).toBe(true);

    const submitted = (
      await okTool(request, "submit_proposal", {
        design: WIDER,
        rationale: "Add a 29 mm size.",
        claim: CLAIM,
        tradeOffs: ["One more size"],
        evidenceIds: [cited.id],
      })
    ).result as { design: Design; claim: unknown; evidenceIds: string[] };
    expect(submitted.design).toEqual(WIDER);
    expect(submitted.claim).toEqual(CLAIM);
    expect(submitted.evidenceIds).toEqual([cited.id]);
  });
});

test.describe("Done when 2: invalid input gets a clear error the agent can act on", () => {
  const cases: { tool: string; input: unknown; field: string }[] = [
    { tool: "evaluate_design", input: {}, field: "design" },
    { tool: "group_failures", input: { design: START, by: "colour" }, field: "by" },
    { tool: "profile_group", input: { heartIds: [] }, field: "heartIds" },
    { tool: "inspect_heart", input: { design: START }, field: "heartId" },
    { tool: "what_if", input: { design: START, heartIds: ["heart-001"] }, field: "change" },
    {
      tool: "stress_test",
      input: { design: START, kind: "measurement_shift", amount: "one", hypothesis: HYPOTHESIS, disprovedIf: DISPROVED_IF },
      field: "amount",
    },
    { tool: "report_findings", input: { mechanisms: [] }, field: "mechanisms" },
    { tool: "edit_design", input: { design: START, change: { kind: "teleport" } }, field: "change" },
    {
      tool: "submit_proposal",
      input: { design: WIDER, rationale: "Wider.", claim: "it fits more hearts", evidenceIds: ["ev-0000000000000000"] },
      field: "claim",
    },
  ];
  for (const { tool, input, field } of cases) {
    test(`${tool} names the bad field ${field}`, async ({ request }) => {
      const { error } = await refused(request, tool, input, 400);
      expect(error).toContain(field);
    });
  }

  test("findings with no cited evidence are refused", async ({ request }) => {
    const { error } = await refused(
      request,
      "report_findings",
      { mechanisms: [{ title: "x", explanation: "y", heartIds: [], severity: "low", evidenceIds: [] }] },
      400,
    );
    expect(error).toContain("evidenceIds");
  });

  test("an unknown tool and a malformed body are refused", async ({ request }) => {
    const { error } = await refused(request, "score_hidden_hearts", {}, 404);
    expect(error).toContain("score_hidden_hearts");
    const malformed = await request.post("/api/tools", { headers: { "content-type": "application/json" }, data: "{not json" });
    expect(malformed.status()).toBe(400);
  });

  test("a design the engine rejects is refused with the reason", async ({ request }) => {
    const tooWide: Design = { ...START, id: "too-wide", sizes: [{ nominalMm: 25, minAnnulusMm: 21, maxAnnulusMm: 25 }] };
    const { error } = await refused(request, "evaluate_design", { design: tooWide }, 422);
    expect(error).toContain("2.5");
  });
});

test("Done when 3: a 1 mm measurement shift reports how many hearts changed status", async ({ request }) => {
  const result = (
    await okTool(request, "stress_test", {
      design: START,
      kind: "measurement_shift",
      amount: 1,
      hypothesis: HYPOTHESIS,
      disprovedIf: DISPROVED_IF,
    })
  ).result as { total: number; changedCount: number; changed: unknown };
  const changed = Changed.parse(result.changed);
  expect(result.total).toBe(400);
  expect(result.changedCount).toBe(changed.length);
  expect(result.changedCount).toBeGreaterThan(0);
  // Every rule-read measure 1 mm larger is the same as every size range and nominal 1 mm smaller.
  const shifted = await fit(request, shiftDesign(START, -1, -1));
  expect(changed.map((c) => c.heartId).sort()).toEqual(statusChanges(base.results, shifted.results));
});

test("Done when 4: profile_group on at-risk hearts shows which measurements differ most", async ({ request }) => {
  const result = (await okTool(request, "profile_group", { heartIds: riskIds })).result as {
    groupSize: number;
    restSize: number;
    measures: { measure: string; groupMean: number; restMean: number; difference: number; effectSize: number }[];
  };
  expect(result.groupSize).toBe(riskIds.length);
  expect(result.restSize).toBe(400 - riskIds.length);
  const keys = Object.keys(devHearts[0].measures).sort();
  expect(result.measures.map((m) => m.measure).sort()).toEqual(keys);
  const inGroup = new Set(riskIds);
  for (const m of result.measures) {
    const group = devHearts.filter((h) => inGroup.has(h.id)).map((h) => h.measures[m.measure] as number);
    const rest = devHearts.filter((h) => !inGroup.has(h.id)).map((h) => h.measures[m.measure] as number);
    expect(Math.abs(m.groupMean - mean(group)), m.measure).toBeLessThan(TOL);
    expect(Math.abs(m.restMean - mean(rest)), m.measure).toBeLessThan(TOL);
    expect(Math.abs(m.difference - (m.groupMean - m.restMean))).toBeLessThan(TOL);
    expect(Math.sign(m.effectSize)).toBe(Math.sign(m.difference));
  }
  const sizes = result.measures.map((m) => Math.abs(m.effectSize));
  expect(sizes, "sorted by how much each measurement differs").toEqual([...sizes].sort((a, b) => b - a));
  expect(sizes[0]).toBeGreaterThan(0);
});

test.describe("Done when 5: a hidden heart's ID is refused in every tool", () => {
  const hiddenInputs: { tool: string; input: (evidenceId: string) => unknown }[] = [
    { tool: "profile_group", input: () => ({ heartIds: [HIDDEN.id] }) },
    { tool: "profile_group", input: () => ({ heartIds: [riskIds[0], HIDDEN.id] }) },
    { tool: "inspect_heart", input: () => ({ heartId: HIDDEN.id, design: START }) },
    { tool: "what_if", input: () => ({ design: START, heartIds: [HIDDEN.id], change: ADD_29 }) },
    {
      tool: "stress_test",
      input: () => ({ design: START, kind: "subgroup", amount: 0, heartIds: [HIDDEN.id], hypothesis: HYPOTHESIS, disprovedIf: DISPROVED_IF }),
    },
    {
      tool: "report_findings",
      input: (evidenceId) => ({
        mechanisms: [{ title: "x", explanation: "y", heartIds: [HIDDEN.id], severity: "low", evidenceIds: [evidenceId] }],
      }),
    },
  ];
  hiddenInputs.forEach(({ tool, input }, index) => {
    test(`${tool} refuses a hidden heart (${index})`, async ({ request }) => {
      const cited = await okTool(request, "evaluate_design", { design: START });
      const { error, text } = await refused(request, tool, input(cited.id), 403);
      expect(error).toContain(HIDDEN.id);
      expect(error.toLowerCase()).toContain("hidden");
      for (const value of Object.values(HIDDEN.measures)) {
        expect(text, "no hidden measurement leaks").not.toContain(String(value));
      }
    });
  });

  test("no tool source reads the hidden hearts", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else files.push(full);
      }
    };
    for (const dir of ["src/tools", "src/app/api/tools"]) {
      expect(existsSync(path.join(ROOT, dir)), dir).toBe(true);
      walk(path.join(ROOT, dir));
    }
    expect(files.length).toBeGreaterThan(1);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toContain("hearts.hidden");
      expect(source, file).not.toContain("server-data");
    }
  });
});

test.describe("Done when 6: edit_design returns the new design, comparison and limits in one result", () => {
  const limits = [
    { id: "limit-4", kind: "max-sizes", value: 4, sourceText: "no more than 4 sizes" },
    { id: "limit-3", kind: "max-sizes", value: 3, sourceText: "no more than 3 sizes" },
  ];

  test("a valid change", async ({ request }) => {
    const evidence = await okTool(request, "edit_design", { design: START, change: ADD_29, limits });
    const result = evidence.result as {
      valid: boolean;
      design: Design;
      comparison: { parent: Summary; child: Summary; fitPctDelta: number; newRiskHeartIds: string[]; changed: unknown };
      limits: { id: string; kind: string; pass: boolean; detail: string }[];
    };
    expect(result.valid).toBe(true);
    expect(result.design.parentId).toBe(START.id);
    expect(result.design.id).not.toBe(START.id);
    expect(result.design.hypothetical).toBe(true);
    expect(result.design.sizes).toEqual([...START.sizes, SIZE_29]);

    const expected = await fit(request, result.design, START);
    const parent = SummaryShape.parse(result.comparison.parent);
    const child = SummaryShape.parse(result.comparison.child);
    expect(parent).toMatchObject({ fit: base.summary.fit, risk: base.summary.risk, noFit: base.summary.noFit });
    expect(child).toMatchObject({ fit: expected.summary.fit, risk: expected.summary.risk, noFit: expected.summary.noFit });
    expect(Math.abs(result.comparison.fitPctDelta - (expected.summary.fitPct - base.summary.fitPct))).toBeLessThan(TOL);
    expect([...result.comparison.newRiskHeartIds].sort()).toEqual([...expected.summary.newRiskHeartIds].sort());
    expect(result.comparison.newRiskHeartIds.length).toBeGreaterThan(0);
    expect(Changed.parse(result.comparison.changed).map((c) => c.heartId)).toEqual(statusChanges(base.results, expected.results));

    expect(result.limits.map((l) => [l.id, l.pass])).toEqual([
      ["limit-4", true],
      ["limit-3", false],
    ]);
    for (const limit of result.limits) expect(limit.detail.length).toBeGreaterThan(0);
  });

  test("an unsupported limit type is refused", async ({ request }) => {
    const { error } = await refused(
      request,
      "edit_design",
      { design: START, change: ADD_29, limits: [{ id: "x", kind: "safe-for-all-patients", value: 1, sourceText: "make it safe" }] },
      400,
    );
    expect(error).toContain("safe-for-all-patients");
  });

  test("a change that makes the design invalid gives the reason", async ({ request }) => {
    const result = (
      await okTool(request, "edit_design", {
        design: START,
        change: { kind: "add_size", size: { nominalMm: 29, minAnnulusMm: 27, maxAnnulusMm: 30 } },
      })
    ).result as { valid: boolean; reasons: { ruleId: string; message: string }[] };
    expect(result.valid).toBe(false);
    expect(result.reasons[0].ruleId).toBe("size-width");
    expect(result.reasons[0].message).toContain("2.5");
  });
});

test.describe("Done when 7: stress_test needs a hypothesis and what would disprove it", () => {
  const attack = { design: START, kind: "measurement_shift", amount: 1 };
  const cases: { name: string; input: unknown; field: string }[] = [
    { name: "no hypothesis", input: { ...attack, disprovedIf: DISPROVED_IF }, field: "hypothesis" },
    { name: "no disprovedIf", input: { ...attack, hypothesis: HYPOTHESIS }, field: "disprovedIf" },
    { name: "blank hypothesis", input: { ...attack, hypothesis: "   ", disprovedIf: DISPROVED_IF }, field: "hypothesis" },
    { name: "blank disprovedIf", input: { ...attack, hypothesis: HYPOTHESIS, disprovedIf: "" }, field: "disprovedIf" },
  ];
  for (const { name, input, field } of cases) {
    test(name, async ({ request }) => {
      const { error } = await refused(request, "stress_test", input, 400);
      expect(error).toContain(field);
    });
  }
});

test("the orchestrator runs on the real tools", async ({ request }) => {
  const LAST = "$lastEvidenceId";
  const report = (title: string) => ({
    toolCalls: [
      {
        name: "report_findings",
        args: { mechanisms: [{ title, explanation: `${title}.`, heartIds: [], severity: "medium", evidenceIds: [LAST] }] },
      },
    ],
  });
  const turns = [
    {
      toolCalls: [
        { name: "evaluate_design", args: { design: START } },
        { name: "group_failures", args: { design: START, by: "rule" } },
      ],
    },
    { toolCalls: [{ name: "inspect_heart", args: { heartId: HIDDEN.id, design: START } }] },
    report("Narrow junction"),
    { toolCalls: [{ name: "edit_design", args: { design: START, change: ADD_29 } }] },
    {
      toolCalls: [
        {
          name: "submit_proposal",
          args: { design: WIDER, rationale: "Add a 29 mm size.", claim: CLAIM, tradeOffs: ["One more size"], evidenceIds: [LAST] },
        },
      ],
    },
    {
      toolCalls: [
        {
          name: "stress_test",
          args: { design: WIDER, kind: "measurement_shift", amount: 1, hypothesis: HYPOTHESIS, disprovedIf: DISPROVED_IF },
        },
      ],
    },
    report("Shift attack"),
  ];
  const started = await request.post("/api/runs", { data: { model: { kind: "scripted", turns }, budget: { maxRounds: 1 } } });
  expect(started.status()).toBe(201);
  const { id } = (await started.json()) as { id: string };

  let run: Run | undefined;
  await expect
    .poll(
      async () => {
        const view = (await (await request.get(`/api/runs/${id}`)).json()) as { status: string; run: Run };
        run = view.run;
        return view.status;
      },
      { timeout: RUN_TIMEOUT_MS },
    )
    .toBe("finished");
  if (!run) throw new Error("no run");

  const parsed = RunSchema.parse(run);
  const calls = run.events.filter((e: RunEvent) => e.type === "tool-call").map((e) => e.data as {
    tool: string;
    evidenceId?: string;
    error?: string;
  });
  const callOf = (tool: string) => calls.find((c) => c.tool === tool);
  for (const tool of ["evaluate_design", "group_failures", "edit_design", "submit_proposal", "stress_test"]) {
    expect(callOf(tool)?.evidenceId, `${tool}: ${callOf(tool)?.error ?? ""}`).toMatch(/^ev-/);
  }
  const hidden = callOf("inspect_heart");
  expect(hidden?.evidenceId).toBeUndefined();
  expect(hidden?.error).toContain(HIDDEN.id);
  expect(hidden?.error?.toLowerCase()).toContain("hidden");

  expect(parsed.evidence.length).toBeGreaterThan(0);
  for (const evidence of parsed.evidence) {
    expect(evidence.source, evidence.tool).toBe("computed");
    expect(evidence.provenance, evidence.tool).toEqual(EXPECTED_PROVENANCE);
  }

  const evaluations = run.events.filter((e) => e.type === "evaluation").map((e) => e.data as { summary: Summary; improved?: boolean });
  expect(evaluations[0].summary).toMatchObject({ total: 400, fit: base.summary.fit, risk: base.summary.risk, noFit: base.summary.noFit });
  expect(evaluations[1].improved).toBe(true);

  expect(parsed.proposals).toHaveLength(1);
  expect(parsed.proposals[0].claim).toEqual(CLAIM);
  const stop = run.events.at(-1)?.data as { reason: string; limit?: string };
  expect(stop).toMatchObject({ reason: "budget", limit: "maxRounds" });
});
