// RES-2 tool-loop test. Usage: node run.mjs model | probe | smoke | all
import { readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const MODEL = "gemini-4-argon";
const BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MAX_TURNS = 10;
const CALL_TIMEOUT_MS = 120_000;
const MAX_HTTP_RETRIES = 2;
const COST_CAP_USD = 3;
const PRICE = { input: 2 / 1e6, cached: 0.1 / 1e6, output: 10 / 1e6 };

const KEY = readFileSync(join(ROOT, ".env.local"), "utf8").match(/^GEMINI_API_KEY=(.+)$/m)?.[1]?.trim();
if (!KEY) throw new Error("GEMINI_API_KEY missing from .env.local");
const scrub = (s) => String(s).split(KEY).join("[redacted]");

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(42);
const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
const r2 = (n) => Math.round(n * 100) / 100;

const HEARTS = Array.from({ length: 400 }, (_, i) => {
  const annulus = r2(24 + gauss() * 2.2);
  return {
    id: `h-${String(i + 1).padStart(3, "0")}`,
    annulus,
    sinus: r2(annulus * (1.38 + gauss() * 0.07)),
    stj: r2(annulus * (1.2 + gauss() * 0.09)),
  };
});
const HEART_BY_ID = new Map(HEARTS.map((h) => [h.id, h]));

const VALVE_A = {
  label: "Start valve",
  sizes: [
    { nominalMm: 23, minAnnulusMm: 21, maxAnnulusMm: 23 },
    { nominalMm: 25, minAnnulusMm: 23, maxAnnulusMm: 25 },
    { nominalMm: 27, minAnnulusMm: 25, maxAnnulusMm: 27 },
  ],
};
const VALVE_B = {
  label: "Start valve plus 29 mm",
  sizes: [...VALVE_A.sizes, { nominalMm: 29, minAnnulusMm: 27, maxAnnulusMm: 29 }],
};

class ToolError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

function checkDesign(d) {
  if (!d || typeof d !== "object" || !Array.isArray(d.sizes) || d.sizes.length === 0)
    throw new ToolError("schema", "design.sizes must be a non-empty array");
  for (const s of d.sizes) {
    for (const k of ["nominalMm", "minAnnulusMm", "maxAnnulusMm"])
      if (typeof s?.[k] !== "number") throw new ToolError("schema", `sizes[].${k} must be a number`);
    if (s.maxAnnulusMm - s.minAnnulusMm > 2.5)
      throw new ToolError("domain", `size ${s.nominalMm} covers more than 2.5 mm of annulus`);
  }
}

function fit(h, design) {
  const size = design.sizes.find((s) => h.annulus >= s.minAnnulusMm && h.annulus <= s.maxAnnulusMm);
  if (!size) return { status: "no-fit", rules: ["R1_annulus_out_of_range"], sizeMm: null };
  const outflow = size.nominalMm + 4;
  const rules = [];
  if (h.sinus - outflow < 1) rules.push("R2_sinus_clearance");
  if (outflow - h.stj > 2) rules.push("R3_stj_oversize");
  return { status: rules.length ? "risk" : "fit", rules, sizeMm: size.nominalMm };
}

function bandOf(v, step) {
  const lo = Math.floor(v / step) * step;
  return `${r2(lo)}-${r2(lo + step)}`;
}

function checkArgs(args, allowed) {
  const extra = Object.keys(args ?? {}).filter((k) => !allowed.includes(k));
  if (extra.length) throw new ToolError("schema", `unknown arguments: ${extra.join(", ")}`);
}

const TOOLS = {
  evaluate_design({ design, ...rest }) {
    checkArgs(rest, []);
    checkDesign(design);
    const rows = HEARTS.map((h) => fit(h, design));
    const count = (s) => rows.filter((r) => r.status === s).length;
    return { total: HEARTS.length, fit: count("fit"), risk: count("risk"), noFit: count("no-fit") };
  },
  group_failures({ design, by, ...rest }) {
    checkArgs(rest, []);
    checkDesign(design);
    const keyers = {
      rule: (h, f) => f.rules,
      size: (h, f) => [String(f.sizeMm ?? "none")],
      annulus_band: (h) => [bandOf(h.annulus, 2)],
      stj_ratio_band: (h) => [bandOf(h.stj / h.annulus, 0.1)],
    };
    if (!keyers[by]) throw new ToolError("schema", `by must be one of ${Object.keys(keyers).join(", ")}`);
    const groups = new Map();
    for (const h of HEARTS) {
      const f = fit(h, design);
      if (f.status === "fit") continue;
      for (const key of keyers[by](h, f)) {
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(h.id);
      }
    }
    return {
      groups: [...groups].map(([key, ids]) => ({ key, count: ids.length, heartIds: ids.slice(0, 20) })),
    };
  },
  profile_group({ heartIds, ...rest }) {
    checkArgs(rest, []);
    if (!Array.isArray(heartIds) || heartIds.length === 0)
      throw new ToolError("schema", "heartIds must be a non-empty array");
    const unknown = heartIds.filter((id) => !HEART_BY_ID.has(id));
    if (unknown.length) throw new ToolError("bad_id", `unknown heart ids: ${unknown.slice(0, 5).join(", ")}`);
    const set = new Set(heartIds);
    const mean = (list, fn) => r2(list.reduce((a, h) => a + fn(h), 0) / list.length);
    const inGroup = HEARTS.filter((h) => set.has(h.id));
    const others = HEARTS.filter((h) => !set.has(h.id));
    const measures = {
      annulus: (h) => h.annulus,
      sinus: (h) => h.sinus,
      stj: (h) => h.stj,
      stj_ratio: (h) => h.stj / h.annulus,
    };
    return {
      groupSize: inGroup.length,
      measures: Object.entries(measures).map(([name, fn]) => ({
        name,
        groupMean: mean(inGroup, fn),
        restMean: mean(others, fn),
      })),
    };
  },
};

function numbersIn(value, out = new Set()) {
  if (typeof value === "number") {
    out.add(value);
    out.add(r2(value));
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) numbersIn(v, out);
  }
  return out;
}

function validateReport(args, evidence) {
  const { mechanisms, ...rest } = args ?? {};
  checkArgs(rest, []);
  if (!Array.isArray(mechanisms) || mechanisms.length === 0)
    throw new ToolError("schema", "mechanisms must be a non-empty array");
  for (const m of mechanisms) {
    for (const k of ["title", "explanation", "measurement"])
      if (typeof m?.[k] !== "string") throw new ToolError("schema", `mechanism.${k} must be a string`);
    if (!Array.isArray(m.evidenceIds) || m.evidenceIds.length === 0)
      throw new ToolError("schema", "mechanism.evidenceIds must be a non-empty array");
    const missing = m.evidenceIds.filter((id) => !evidence.has(id));
    if (missing.length) throw new ToolError("evidence", `unknown evidence ids: ${missing.join(", ")}`);
    const allowed = new Set();
    for (const id of m.evidenceIds) numbersIn(evidence.get(id), allowed);
    const text = `${m.title} ${m.explanation}`.replace(/\b(?:h|ev|R\d)[-_][\w-]*/g, " ");
    const stated = (text.match(/(?<![\w.-])\d+(?:\.\d+)?/g) ?? []).map(Number);
    const invented = stated.filter((n) => !allowed.has(n));
    if (invented.length)
      throw new ToolError("number", `numbers not in cited evidence: ${invented.join(", ")}. Rewrite without them.`);
  }
  return { accepted: true, mechanisms: mechanisms.length };
}

const DESIGN_SCHEMA = {
  type: "object",
  description: "Valve design to test.",
  properties: {
    label: { type: "string" },
    sizes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          nominalMm: { type: "number" },
          minAnnulusMm: { type: "number" },
          maxAnnulusMm: { type: "number" },
        },
        required: ["nominalMm", "minAnnulusMm", "maxAnnulusMm"],
      },
    },
  },
  required: ["sizes"],
};

const DECLARATIONS = [
  {
    name: "evaluate_design",
    description: "Counts fit, risk and no-fit test hearts for a design.",
    parameters: { type: "object", properties: { design: DESIGN_SCHEMA }, required: ["design"] },
  },
  {
    name: "group_failures",
    description: "Groups failing hearts by rule, size or measurement band. Lists at most 20 heart ids per group.",
    parameters: {
      type: "object",
      properties: {
        design: DESIGN_SCHEMA,
        by: { type: "string", enum: ["rule", "size", "annulus_band", "stj_ratio_band"] },
      },
      required: ["design", "by"],
    },
  },
  {
    name: "profile_group",
    description: "Compares mean measurements of the listed hearts against all other test hearts.",
    parameters: {
      type: "object",
      properties: { heartIds: { type: "array", items: { type: "string" } } },
      required: ["heartIds"],
    },
  },
  {
    name: "report_findings",
    description: "Submits validated failure mechanisms and ends your turn. Rejected if a number in the text is not in the cited evidence.",
    parameters: {
      type: "object",
      properties: {
        mechanisms: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              explanation: { type: "string" },
              measurement: { type: "string", enum: ["annulus", "sinus", "stj", "stj_ratio"] },
              evidenceIds: { type: "array", items: { type: "string" } },
            },
            required: ["title", "explanation", "measurement", "evidenceIds"],
          },
        },
      },
      required: ["mechanisms"],
    },
  },
];

const SYSTEM = `You are the Breaker. You investigate why a hypothetical heart valve fails on synthetic test hearts.
Decide what to examine next from what each tool returns. Every tool result carries an evidenceId.
Finish by calling report_findings with up to 3 mechanisms. Each mechanism cites the evidenceIds that support it.
Any number in your text must appear in the evidence you cite. Do not calculate new numbers or number your points.`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pickHeaders(res) {
  const out = {};
  for (const [k, v] of res.headers) if (/rate|limit|retry|quota/i.test(k)) out[k] = scrub(v);
  return out;
}

async function post(body, log) {
  for (let attempt = 0; ; attempt++) {
    const started = performance.now();
    let res;
    try {
      res = await fetch(`${BASE}/${MODEL}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
    } catch (e) {
      log.push({ kind: "network", name: e.name, ms: Math.round(performance.now() - started) });
      if (attempt >= MAX_HTTP_RETRIES || e.name === "TimeoutError") return { ok: false, error: e.name };
      await sleep(2000 * (attempt + 1));
      continue;
    }
    const text = await res.text();
    const ms = Math.round(performance.now() - started);
    const headers = pickHeaders(res);
    if (res.ok) return { ok: true, json: JSON.parse(text), ms, headers };
    const message = scrub(text).slice(0, 600);
    log.push({ kind: "http", status: res.status, ms, headers, message });
    if (![429, 500, 502, 503, 504].includes(res.status) || attempt >= MAX_HTTP_RETRIES)
      return { ok: false, error: `http_${res.status}`, status: res.status, message };
    const hinted = Number(/"retryDelay":\s*"(\d+)/.exec(text)?.[1] ?? 0);
    await sleep(Math.min(60, Math.max(hinted, 2 * (attempt + 1))) * 1000);
  }
}

function requestBody(contents, level, mode) {
  return {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents,
    tools: [{ functionDeclarations: DECLARATIONS }],
    toolConfig: { functionCallingConfig: { mode } },
    generationConfig: { maxOutputTokens: 32768, thinkingConfig: { thinkingLevel: level } },
  };
}

function costOf(u = {}) {
  const cached = u.cachedContentTokenCount ?? 0;
  const input = (u.promptTokenCount ?? 0) - cached;
  return input * PRICE.input + cached * PRICE.cached + ((u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0)) * PRICE.output;
}

async function runLoop({ level, mode, valve, id }) {
  const contents = [
    {
      role: "user",
      parts: [{ text: `Design under test:\n${JSON.stringify(valve)}\nFind out why hearts fail, including anything beyond annulus size.` }],
    },
  ];
  const run = {
    id, level, mode, valve: valve.label, ok: false, stop: null, turns: 0, steps: [], toolSequence: [],
    invalid: { schema: 0, domain: 0, bad_id: 0, unknown_tool: 0, evidence: 0, number: 0 },
    httpEvents: [], emptyOrMalformed: 0, parallelTurns: 0, signaturesSeen: 0,
    costUsd: 0, measurements: [], reportAttempts: 0, lastRateHeaders: {},
  };
  const evidence = new Map();
  const started = performance.now();
  let evidenceSeq = 0;
  let blankRetried = false;

  while (run.turns < MAX_TURNS) {
    const res = await post(requestBody(contents, level, mode), run.httpEvents);
    if (!res.ok) {
      run.stop = res.error;
      break;
    }
    run.lastRateHeaders = res.headers;
    const cand = res.json.candidates?.[0];
    const u = res.json.usageMetadata ?? {};
    run.costUsd += costOf(u);
    const parts = cand?.content?.parts ?? [];
    const calls = parts.filter((p) => p.functionCall);
    run.signaturesSeen += parts.filter((p) => p.thoughtSignature).length;
    run.steps.push({
      ms: res.ms, finishReason: cand?.finishReason ?? "none", calls: calls.length,
      prompt: u.promptTokenCount, cached: u.cachedContentTokenCount ?? 0,
      output: u.candidatesTokenCount ?? 0, thoughts: u.thoughtsTokenCount ?? 0, total: u.totalTokenCount ?? 0,
    });
    run.turns++;

    if (calls.length === 0) {
      const hasText = parts.some((p) => p.text);
      if (hasText && cand?.finishReason === "STOP") {
        run.stop = "text_only_stop";
        break;
      }
      run.emptyOrMalformed++;
      if (blankRetried) {
        run.stop = `blank_${cand?.finishReason ?? "none"}`;
        break;
      }
      blankRetried = true;
      continue;
    }
    if (calls.length > 1) run.parallelTurns++;
    contents.push(cand.content);

    const responses = [];
    let finished = false;
    for (const { functionCall: fc } of calls) {
      run.toolSequence.push(fc.name);
      let response;
      try {
        if (fc.name === "report_findings") {
          run.reportAttempts++;
          response = validateReport(fc.args, evidence);
          finished = true;
          run.measurements = fc.args.mechanisms.map((m) => m.measurement);
          run.mechanismTitles = fc.args.mechanisms.map((m) => m.title);
        } else if (TOOLS[fc.name]) {
          const result = TOOLS[fc.name](fc.args ?? {});
          const evidenceId = `ev-${++evidenceSeq}`;
          evidence.set(evidenceId, { input: fc.args, result });
          response = { evidenceId, ...result };
        } else {
          throw new ToolError("unknown_tool", `no tool named ${fc.name}`);
        }
      } catch (e) {
        if (!(e instanceof ToolError)) throw e;
        run.invalid[e.kind]++;
        if (e.kind === "number") (run.numberRejections ??= []).push({ message: e.message, text: fc.args.mechanisms.map((m) => m.explanation) });
        response = { error: e.message };
      }
      responses.push({ functionResponse: { ...(fc.id ? { id: fc.id } : {}), name: fc.name, response } });
    }
    if (finished) {
      run.ok = true;
      run.stop = "report_accepted";
      break;
    }
    contents.push({ role: "user", parts: responses });
  }
  if (!run.stop) run.stop = "turn_budget";
  run.totalMs = Math.round(performance.now() - started);
  return run;
}

function schedule() {
  const combos = [
    ["AUTO", VALVE_A],
    ["ANY", VALVE_B],
    ["AUTO", VALVE_B],
    ["ANY", VALVE_A],
  ];
  const seen = { low: 0, medium: 0, high: 0 };
  const pattern = ["low", "medium", "high", "low", "medium", "high", "low", "medium", "high", "low", "medium", "high", "low", "medium", "low", "medium", "low", "medium", "low", "medium"];
  return pattern.map((level, i) => {
    const [mode, valve] = combos[seen[level]++ % combos.length];
    return { id: `run-${String(i + 1).padStart(2, "0")}`, level, mode, valve };
  });
}

async function all() {
  const path = join(HERE, "runs.jsonl");
  writeFileSync(path, "");
  let spent = 0;
  for (const spec of schedule()) {
    const run = await runLoop(spec);
    spent += run.costUsd;
    appendFileSync(path, scrub(JSON.stringify(run)) + "\n");
    console.log(`${run.id} ${run.level} ${run.mode} ok=${run.ok} stop=${run.stop} turns=${run.turns} ms=${run.totalMs} cost=$${spent.toFixed(3)}`);
    if (spent > COST_CAP_USD) {
      console.log("cost cap reached, stopping");
      break;
    }
    await sleep(1000);
  }
}

async function probe() {
  const log = [];
  const contents = [{ role: "user", parts: [{ text: `Design under test:\n${JSON.stringify(VALVE_A)}\nStart by evaluating it.` }] }];
  const first = await post(requestBody(contents, "low", "ANY"), log);
  if (!first.ok) return console.log(JSON.stringify({ first, log }));
  const content = first.json.candidates[0].content;
  const sigs = content.parts.filter((p) => p.thoughtSignature).length;
  const call = content.parts.find((p) => p.functionCall).functionCall;
  const stripped = { ...content, parts: content.parts.map(({ thoughtSignature, ...p }) => p) };
  const result = { functionResponse: { ...(call.id ? { id: call.id } : {}), name: call.name, response: { error: "probe" } } };
  const second = await post(requestBody([...contents, stripped, { role: "user", parts: [result] }], "low", "ANY"), log);
  console.log(JSON.stringify({
    firstCall: call.name, firstHasId: Boolean(call.id), partKinds: content.parts.map((p) => Object.keys(p)),
    signaturesOnFirstTurn: sigs, strippedStatus: second.ok ? 200 : second.status, strippedMessage: second.message ?? null,
    headers: first.headers,
  }, null, 2));
}

async function modelInfo() {
  const res = await fetch(`${BASE}/${MODEL}`, { headers: { "x-goog-api-key": KEY } });
  console.log(res.status, scrub(await res.text()));
  console.log(JSON.stringify(pickHeaders(res)));
}

async function diag() {
  for (const [i, valve] of [VALVE_A, VALVE_B, VALVE_A].entries()) {
    const run = await runLoop({ id: `diag-${i + 1}`, level: "low", mode: "ANY", valve });
    appendFileSync(join(HERE, "diag.jsonl"), scrub(JSON.stringify(run)) + "\n");
    console.log(run.id, run.stop, run.costUsd.toFixed(3), JSON.stringify(run.numberRejections ?? []));
  }
}

const commands = {
  model: modelInfo,
  probe,
  all,
  diag,
  smoke: async () => console.log(scrub(JSON.stringify(await runLoop({ id: "smoke", level: "low", mode: "AUTO", valve: VALVE_A }), null, 2))),
};
await commands[process.argv[2] ?? "model"]();
