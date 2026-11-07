import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { z } from "zod";
import {
  DesignSchema,
  FitResultSchema,
  SummarySchema,
  type Design,
  type FitResult,
  type Heart,
} from "../../src/contracts/index";

const ROOT = process.cwd();
const TOL = 1e-9;
const RULE_KINDS = [
  "annulus-coverage",
  "frame-outflow",
  "outflow-clearance",
  "outflow-excess",
  "size-width",
] as const;

const RuleSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(RULE_KINDS),
    effect: z.enum(["no-fit", "risk", "none", "reject-design"]),
    status: z.enum(["published", "demo-assumption"]),
    source: z.string().nullable(),
    description: z.string().min(1),
    params: z.record(z.string(), z.union([z.string(), z.number()])),
  })
  .refine((rule) => rule.status !== "published" || (rule.source ?? "").trim().length > 0, {
    message: "a published rule needs a source",
  });
const RuleFileSchema = z.object({ version: z.string().min(1), rules: z.array(RuleSchema).min(1) });
type RuleFile = z.infer<typeof RuleFileSchema>;

const RejectionSchema = z.object({
  ruleId: z.string(),
  sizeMm: z.number(),
  widthMm: z.number(),
  limitMm: z.number(),
  message: z.string().min(1),
});

type FitBody = {
  design: Design;
  rulesVersion: string;
  rules: RuleFile["rules"];
  summary: z.infer<typeof SummarySchema>;
  results: FitResult[];
};

const START_SIZES: Design["sizes"] = [
  { nominalMm: 23, minAnnulusMm: 21, maxAnnulusMm: 23 },
  { nominalMm: 25, minAnnulusMm: 23, maxAnnulusMm: 25 },
  { nominalMm: 27, minAnnulusMm: 25, maxAnnulusMm: 27 },
];
const start: Design = { id: "start", label: "Starting valve", hypothetical: true, sizes: START_SIZES };
const with29: Design = {
  id: "with-29",
  label: "Starting valve plus 29 mm",
  hypothetical: true,
  parentId: "start",
  sizes: [...START_SIZES, { nominalMm: 29, minAnnulusMm: 27, maxAnnulusMm: 29 }],
};
const widthDesign = (maxAnnulusMm: number): Design => ({
  id: `wide-${maxAnnulusMm}`,
  label: "Width test",
  hypothetical: true,
  parentId: "start",
  sizes: [{ nominalMm: 23, minAnnulusMm: 21, maxAnnulusMm }, ...START_SIZES.slice(1)],
});

const readJson = <T>(rel: string): T => JSON.parse(readFileSync(path.join(ROOT, rel), "utf8")) as T;
const devHearts = () => readJson<{ hearts: Heart[] }>("data/hearts.dev.json").hearts;
const hiddenHearts = () => readJson<{ hearts: Heart[] }>("server-data/hearts.hidden.json").hearts;
const ruleFile = () => RuleFileSchema.parse(readJson<unknown>("data/rules.json"));
const sortedIds = (hearts: { id: string }[]) => hearts.map((h) => h.id).sort();

type EngineModule = {
  evaluateDesign: (input: {
    hearts: Heart[];
    design: Design;
    parent?: Design;
    split?: "dev" | "hidden";
    rules?: RuleFile;
  }) =>
    | { ok: true; rulesVersion: string; results: FitResult[]; summary: z.infer<typeof SummarySchema> }
    | { ok: false; rulesVersion: string; reasons: z.infer<typeof RejectionSchema>[] };
  STARTING_VALVE: Design;
  defaultRules: RuleFile;
};
const ENGINE_PATH = "../../src/engine/index";
const loadEngine = async () => (await import(ENGINE_PATH)) as EngineModule;

type Reason = FitResult["reasons"][number];
type Expected = { status: FitResult["status"]; sizeMm?: number; reasons: Reason[] };

function num(rule: RuleFile["rules"][number], key: string): number {
  const value = rule.params[key];
  if (typeof value !== "number") throw new Error(`${rule.id}.${key} should be a number`);
  return value;
}
function str(rule: RuleFile["rules"][number], key: string): string {
  const value = rule.params[key];
  if (typeof value !== "string") throw new Error(`${rule.id}.${key} should be a string`);
  return value;
}
function measure(heart: Heart, key: string): number {
  const value = heart.measures[key];
  if (typeof value !== "number") throw new Error(`${heart.id} has no ${key}`);
  return value;
}

function referenceWidthRejections(design: Design, rules: RuleFile) {
  return rules.rules
    .filter((rule) => rule.kind === "size-width")
    .flatMap((rule) =>
      design.sizes
        .filter((size) => size.maxAnnulusMm - size.minAnnulusMm > num(rule, "maxMm"))
        .map((size) => ({
          ruleId: rule.id,
          sizeMm: size.nominalMm,
          widthMm: size.maxAnnulusMm - size.minAnnulusMm,
          limitMm: num(rule, "maxMm"),
        })),
    );
}

function referenceFit(heart: Heart, design: Design, rules: RuleFile): Expected {
  const coverage = rules.rules.find((rule) => rule.kind === "annulus-coverage");
  const frame = rules.rules.find((rule) => rule.kind === "frame-outflow");
  if (!coverage || !frame) throw new Error("rules.json needs annulus-coverage and frame-outflow");
  const annulus = measure(heart, str(coverage, "measure"));
  const size = design.sizes
    .filter((s) => s.minAnnulusMm <= annulus && annulus <= s.maxAnnulusMm)
    .sort((a, b) => a.nominalMm - b.nominalMm)[0];
  if (!size) {
    let best = { limit: Number.POSITIVE_INFINITY, distance: Number.POSITIVE_INFINITY };
    for (const edge of design.sizes.flatMap((s) => [s.minAnnulusMm, s.maxAnnulusMm])) {
      const distance = Math.abs(annulus - edge);
      if (distance < best.distance || (distance === best.distance && edge < best.limit)) {
        best = { limit: edge, distance };
      }
    }
    return {
      status: "no-fit",
      reasons: [{ ruleId: coverage.id, measured: annulus, limit: best.limit, margin: -best.distance }],
    };
  }
  const outflow = size.nominalMm + num(frame, "offsetMm");
  const reasons: Reason[] = [];
  for (const rule of rules.rules) {
    if (rule.kind === "outflow-clearance") {
      const measured = measure(heart, str(rule, "measure"));
      const limit = outflow + num(rule, "minMm");
      if (measured - limit < 0) reasons.push({ ruleId: rule.id, measured, limit, margin: measured - limit });
    } else if (rule.kind === "outflow-excess") {
      const measured = measure(heart, str(rule, "measure"));
      const limit = outflow - num(rule, "maxMm");
      if (measured - limit < 0) reasons.push({ ruleId: rule.id, measured, limit, margin: measured - limit });
    }
  }
  return { status: reasons.length ? "risk" : "fit", sizeMm: size.nominalMm, reasons };
}

function expectMatchesReference(results: FitResult[], hearts: Heart[], design: Design, rules: RuleFile) {
  const byId = new Map(results.map((r) => [r.heartId, r]));
  for (const heart of hearts) {
    const actual = byId.get(heart.id);
    expect(actual, `${heart.id} should have a result`).toBeDefined();
    if (!actual) continue;
    const expected = referenceFit(heart, design, rules);
    expect(actual.designId).toBe(design.id);
    expect(actual.status, `${heart.id} status`).toBe(expected.status);
    expect(actual.sizeMm, `${heart.id} size`).toBe(expected.sizeMm);
    expect(actual.reasons.map((r) => r.ruleId), `${heart.id} rules`).toEqual(
      expected.reasons.map((r) => r.ruleId),
    );
    actual.reasons.forEach((reason, i) => {
      const want = expected.reasons[i];
      expect(Math.abs(reason.measured - want.measured), `${heart.id} measured`).toBeLessThan(TOL);
      expect(Math.abs(reason.limit - want.limit), `${heart.id} limit`).toBeLessThan(TOL);
      expect(Math.abs(reason.margin - want.margin), `${heart.id} margin`).toBeLessThan(TOL);
    });
  }
}

const countStatus = (results: FitResult[], status: FitResult["status"]) =>
  results.filter((r) => r.status === status).length;

async function getFit(request: APIRequestContext): Promise<FitBody> {
  const response = await request.get("/api/fit");
  expect(response.status()).toBe(200);
  return (await response.json()) as FitBody;
}

async function postFit(request: APIRequestContext, data: unknown) {
  return request.post("/api/fit", { data });
}

test.describe("REQ-6 fit engine", () => {
  test("R6-1 starting valve fit adds up to 400 dev hearts and follows the rules", async ({ request }) => {
    const body = await getFit(request);
    const { defaultStartDesign } = await import("../../src/orchestrator/index");

    expect(DesignSchema.parse(body.design)).toEqual(start);
    expect(body.design).toEqual(defaultStartDesign);
    const { sizes } = body.design;
    expect(Math.min(...sizes.map((s) => s.minAnnulusMm))).toBe(21);
    expect(Math.max(...sizes.map((s) => s.maxAnnulusMm))).toBe(27);
    for (const size of sizes) expect(size.maxAnnulusMm - size.minAnnulusMm).toBeLessThanOrEqual(2.5);

    const summary = SummarySchema.parse(body.summary);
    const results = body.results.map((r) => FitResultSchema.parse(r));
    expect(summary.designId).toBe("start");
    expect(summary.split).toBe("dev");
    expect(summary.total).toBe(400);
    expect(results).toHaveLength(400);
    expect(summary.fit + summary.risk + summary.noFit).toBe(400);
    expect(summary.fit).toBe(countStatus(results, "fit"));
    expect(summary.risk).toBe(countStatus(results, "risk"));
    expect(summary.noFit).toBe(countStatus(results, "no-fit"));
    expect(Math.abs(summary.fitPct - (summary.fit / 400) * 100)).toBeLessThan(TOL);
    expect(summary.fit).toBeGreaterThan(0);
    expect(summary.risk).toBeGreaterThan(0);
    expect(summary.noFit).toBeGreaterThan(0);
    expect(summary.newRiskHeartIds).toEqual([]);
    expect(results.map((r) => r.heartId)).toEqual(sortedIds(devHearts()));

    expect(body.rulesVersion).toBe(ruleFile().version);
    expectMatchesReference(results, devHearts(), start, ruleFile());

    const engine = await loadEngine();
    expect(engine.STARTING_VALVE).toEqual(start);
  });

  test("R6-2 repeated requests give identical results", async ({ request }) => {
    const first = await getFit(request);
    const second = await getFit(request);
    expect(second).toEqual(first);

    const postA = await postFit(request, { design: with29 });
    const postB = await postFit(request, { design: with29 });
    expect(postA.status()).toBe(200);
    expect(await postB.json()).toEqual(await postA.json());

    const engine = await loadEngine();
    const hearts = devHearts();
    const heartsBefore = structuredClone(hearts);
    const designBefore = structuredClone(with29);
    const runA = engine.evaluateDesign({ hearts, design: with29, parent: start });
    const runB = engine.evaluateDesign({ hearts, design: with29, parent: start });
    expect(runB).toEqual(runA);
    expect(hearts).toEqual(heartsBefore);
    expect(with29).toEqual(designBefore);
  });

  test("R6-3 every no-fit or risk heart shows rule, measured value, limit and margin", async ({ request }) => {
    const body = await getFit(request);
    const fileRuleIds = new Set(ruleFile().rules.map((r) => r.id));
    const servedRules = new Map(body.rules.map((r) => [r.id, r]));
    const failing = body.results.filter((r) => r.status !== "fit");
    expect(failing.length).toBeGreaterThan(0);

    for (const result of body.results) {
      if (result.status === "fit") {
        expect(result.reasons, `${result.heartId} fit has no failure reasons`).toEqual([]);
        expect(typeof result.sizeMm).toBe("number");
        continue;
      }
      expect(result.reasons.length, `${result.heartId} needs a reason`).toBeGreaterThan(0);
      if (result.status === "no-fit") {
        expect(result.sizeMm).toBeUndefined();
        expect(result.reasons.map((r) => r.ruleId)).toEqual(["annulus-coverage"]);
      } else {
        expect(typeof result.sizeMm).toBe("number");
      }
      for (const reason of result.reasons) {
        expect(fileRuleIds.has(reason.ruleId), `${reason.ruleId} is in rules.json`).toBe(true);
        const rule = servedRules.get(reason.ruleId);
        expect(rule, `${reason.ruleId} is served with the result`).toBeDefined();
        expect(["published", "demo-assumption"]).toContain(rule?.status);
        for (const value of [reason.measured, reason.limit, reason.margin]) {
          expect(Number.isFinite(value)).toBe(true);
        }
        expect(reason.margin).toBeLessThan(0);
      }
    }
    expectMatchesReference(body.results, devHearts(), start, ruleFile());
  });

  test("R6-4 a design with a 29 mm size shows which hearts are newly at risk", async ({ request }) => {
    const response = await postFit(request, { design: with29 });
    expect(response.status()).toBe(200);
    const body = (await response.json()) as FitBody;
    const summary = SummarySchema.parse(body.summary);
    expect(summary.designId).toBe("with-29");
    expect(summary.total).toBe(400);
    expect(summary.fit + summary.risk + summary.noFit).toBe(400);
    expectMatchesReference(body.results, devHearts(), with29, ruleFile());

    const rules = ruleFile();
    const expectedNew = devHearts()
      .filter(
        (h) => referenceFit(h, with29, rules).status === "risk" && referenceFit(h, start, rules).status !== "risk",
      )
      .map((h) => h.id)
      .sort();
    expect(expectedNew.length).toBeGreaterThan(0);
    expect(summary.newRiskHeartIds).toEqual(expectedNew);

    const startStatus = new Map((await getFit(request)).results.map((r) => [r.heartId, r.status]));
    const newStatus = new Map(body.results.map((r) => [r.heartId, r]));
    for (const id of summary.newRiskHeartIds) {
      expect(newStatus.get(id)?.status).toBe("risk");
      expect(newStatus.get(id)?.reasons.length).toBeGreaterThan(0);
      expect(startStatus.get(id)).not.toBe("risk");
    }

    const explicit = await postFit(request, { design: with29, parent: start });
    expect(((await explicit.json()) as FitBody).summary.newRiskHeartIds).toEqual(expectedNew);

    const self = await postFit(request, { design: start });
    expect(self.status()).toBe(200);
    expect(((await self.json()) as FitBody).summary.newRiskHeartIds).toEqual([]);
  });

  test("R6-5 a size covering more than 2.5 mm is rejected with the reason", async ({ request }) => {
    const tooWide = widthDesign(23.6);
    const response = await postFit(request, { design: tooWide });
    expect(response.status()).toBe(422);
    const body = (await response.json()) as { error: string; reasons: unknown[]; results?: unknown };
    expect(body.error).toBe("invalid-design");
    expect(body.results).toBeUndefined();
    const reasons = body.reasons.map((r) => RejectionSchema.parse(r));
    expect(reasons).toHaveLength(1);
    expect(reasons[0].ruleId).toBe("size-width");
    expect(reasons[0].sizeMm).toBe(23);
    expect(Math.abs(reasons[0].widthMm - 2.6)).toBeLessThan(1e-6);
    expect(reasons[0].limitMm).toBe(2.5);
    expect(reasons[0].message).toContain("2.5");

    const exact = await postFit(request, { design: widthDesign(23.5) });
    expect(exact.status(), "exactly 2.5 mm is allowed").toBe(200);

    const engine = await loadEngine();
    const verdict = engine.evaluateDesign({ hearts: devHearts(), design: tooWide });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reasons.map((r) => r.ruleId)).toEqual(["size-width"]);
    expect(engine.evaluateDesign({ hearts: devHearts(), design: widthDesign(23.5) }).ok).toBe(true);
  });

  test("R6-6 rules.json marks every rule published with a source or demo-assumption", async ({ request }) => {
    const file = ruleFile();
    for (const rule of file.rules) {
      if (rule.status === "published") expect((rule.source ?? "").trim().length).toBeGreaterThan(0);
      else expect(rule.status).toBe("demo-assumption");
    }

    const byId = new Map(file.rules.map((r) => [r.id, r]));
    const placeholders: [string, string, string, Record<string, string | number>][] = [
      ["annulus-coverage", "annulus-coverage", "no-fit", { measure: "annulusMm" }],
      ["frame-outflow", "frame-outflow", "none", { offsetMm: 4 }],
      ["sinus-clearance", "outflow-clearance", "risk", { measure: "sinusMm", minMm: 1 }],
      ["stj-excess", "outflow-excess", "risk", { measure: "sinotubularJunctionMm", maxMm: 2 }],
      ["size-width", "size-width", "reject-design", { maxMm: 2.5 }],
    ];
    expect(file.rules).toHaveLength(placeholders.length);
    for (const [id, kind, effect, params] of placeholders) {
      const rule = byId.get(id);
      expect(rule, `${id} placeholder rule`).toBeDefined();
      expect(rule?.kind).toBe(kind);
      expect(rule?.effect).toBe(effect);
      expect(rule?.params).toEqual(params);
      expect(rule?.status, `${id} is a PRD placeholder`).toBe("demo-assumption");
    }

    const body = await getFit(request);
    expect(body.rules).toEqual(file.rules);
    const engine = await loadEngine();
    expect(engine.defaultRules).toEqual(file);
  });

  test("R6-7 rule values are data: changed values change results without code changes", async () => {
    const engine = await loadEngine();
    const changed = structuredClone(ruleFile());
    changed.version = "test-changed";
    const set = (id: string, key: string, value: number) => {
      const rule = changed.rules.find((r) => r.id === id);
      if (!rule) throw new Error(`missing ${id}`);
      rule.params[key] = value;
    };
    set("frame-outflow", "offsetMm", 5);
    set("sinus-clearance", "minMm", 2);
    set("stj-excess", "maxMm", 1);
    set("size-width", "maxMm", 2);

    const hearts = devHearts();
    const strict = engine.evaluateDesign({ hearts, design: start, rules: changed });
    expect(strict.ok).toBe(true);
    if (strict.ok) {
      expect(strict.rulesVersion).toBe("test-changed");
      expectMatchesReference(strict.results, hearts, start, changed);
      const baseline = engine.evaluateDesign({ hearts, design: start });
      if (baseline.ok) expect(strict.summary.risk).not.toBe(baseline.summary.risk);
    }

    const rejected = engine.evaluateDesign({ hearts, design: widthDesign(23.5), rules: changed });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.reasons.map(({ ruleId, sizeMm, limitMm }) => ({ ruleId, sizeMm, limitMm }))).toEqual(
        referenceWidthRejections(widthDesign(23.5), changed).map(({ ruleId, sizeMm, limitMm }) => ({
          ruleId,
          sizeMm,
          limitMm,
        })),
      );
    }
  });

  test("R6-8 the API serves dev hearts only", async ({ request }) => {
    const devIds = sortedIds(devHearts());
    const hiddenIds = new Set(hiddenHearts().map((h) => h.id));
    expect(hiddenIds.size).toBe(100);

    const body = await getFit(request);
    expect(body.results.map((r) => r.heartId)).toEqual(devIds);
    expect(body.results.some((r) => hiddenIds.has(r.heartId))).toBe(false);

    const sneaky = await postFit(request, { design: start, hearts: hiddenHearts().slice(0, 5) });
    expect(sneaky.status()).toBe(200);
    const sneakyBody = (await sneaky.json()) as FitBody;
    expect(sneakyBody.results.map((r) => r.heartId)).toEqual(devIds);
    expect(sneakyBody.summary.total).toBe(400);

    const sources: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else sources.push(full);
      }
    };
    walk(path.join(ROOT, "src/engine"));
    walk(path.join(ROOT, "src/app/api/fit"));
    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      const text = readFileSync(file, "utf8");
      expect(text, `${file} must not read hidden hearts`).not.toMatch(/server-data|hearts\.hidden/);
    }
  });

  test("R6-9 annulus sanity check on all 500 hearts", async () => {
    const engine = await loadEngine();
    const all = [...devHearts(), ...hiddenHearts()];
    expect(all).toHaveLength(500);
    const startRun = engine.evaluateDesign({ hearts: all, design: start });
    const wideRun = engine.evaluateDesign({ hearts: all, design: with29 });
    expect(startRun.ok && wideRun.ok).toBe(true);
    if (startRun.ok) expect(countStatus(startRun.results, "no-fit")).toBe(116);
    if (wideRun.ok) expect(countStatus(wideRun.results, "no-fit")).toBe(59);
  });
});
