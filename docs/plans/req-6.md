# REQ-6 plan: Fit engine

## Approach

A pure, deterministic function from hearts and a design to per-heart `FitResult`s and a `Summary`. The rule values live in `data/rules.json`, and code only knows a small fixed set of parameterised rule kinds, so RES-1 can swap values (or add another rule of a known kind) without touching code. No UI wiring (REQ-12), no tools or evidence IDs (REQ-9), no hidden scoring (REQ-13), no contract changes.

**Who consumes this:** REQ-9 wraps `evaluateDesign` in `evaluate_design`, `edit_design`, `what_if` and `stress_test` (a `measurement_shift` is new hearts, an `assumption_shift` is a modified `RuleSet`, which is why `rules` is an input). REQ-9 uses `rulesVersion` for `Evidence.provenance`. REQ-13 passes hidden hearts server-side. REQ-4 and REQ-12 read `results` and `rules` (rule type in the popup). REQ-12 can point the orchestrator's `defaultStartDesign` at `STARTING_VALVE`; they must stay identical.

### Engine (`src/engine/`, relative imports only, so the spec can import it outside Next)

```ts
type Rule = { id: string; kind: RuleKind; effect: "no-fit" | "risk" | "none" | "reject-design";
              status: "published" | "demo-assumption"; source: string | null; description: string;
              params: Record<string, string | number> };
type RuleSet = { version: string; rules: Rule[] };
type DesignRejection = { ruleId: string; sizeMm: number; widthMm: number; limitMm: number; message: string };
type Evaluation =
  | { ok: true; rulesVersion: string; results: FitResult[]; summary: Summary }
  | { ok: false; rulesVersion: string; reasons: DesignRejection[] };

export const defaultRules: RuleSet;        // data/rules.json, zod-validated at load
export const STARTING_VALVE: Design;       // id "start", label "Starting valve", 23/21-23, 25/23-25, 27/25-27
export function evaluateDesign(input: { hearts: Heart[]; design: Design; parent?: Design;
  split?: "dev" | "hidden"; rules?: RuleSet }): Evaluation;
```

No I/O, no clock, no randomness, inputs not mutated. Results sorted by heart ID. `summary.split` = `input.split ?? "dev"`. `fitPct = fit / total * 100`. `newRiskHeartIds` = hearts that are `risk` under `design` and not `risk` under `parent`, sorted; `[]` when no parent. An invalid parent also returns `ok: false`.

### Rule kinds (fixed) and `data/rules.json`

File shape `{ "version": "placeholder-1", "rules": Rule[] }`. All five start as `demo-assumption` with `source: null` (PRD section 2). `published` requires a non-empty `source`.

| id | kind | effect | params | Check |
|---|---|---|---|---|
| `annulus-coverage` | `annulus-coverage` | no-fit | `measure: "annulusMm"` | Size = smallest `nominalMm` with `min <= annulus <= max`. None: `no-fit` |
| `frame-outflow` | `frame-outflow` | none | `offsetMm: 4` | outflow = nominal + offset |
| `sinus-clearance` | `outflow-clearance` | risk | `measure: "sinusMm", minMm: 1` | risk if measure - outflow < minMm |
| `stj-excess` | `outflow-excess` | risk | `measure: "sinotubularJunctionMm", maxMm: 2` | risk if outflow - measure > maxMm |
| `size-width` | `size-width` | reject-design | `maxMm: 2.5` | reject if `max - min > maxMm` for any size (2.5 exactly is allowed) |

**Reasons** (failures only; `fit` has `[]`; order follows `rules.json`). `measured` is always the heart's own measurement, and `margin < 0` always means failed:
- `annulus-coverage`: `limit` = nearest range edge over all sizes (lower edge on a tie), `margin` = minus the distance to it. `sizeMm` absent. Only this reason on a `no-fit`.
- `outflow-clearance`: `limit = outflow + minMm`, `margin = measured - limit`.
- `outflow-excess`: `limit = outflow - maxMm`, `margin = measured - limit`.
- Rejections list every too-wide size: `ruleId "size-width"`, `sizeMm`, `widthMm`, `limitMm`, and a `message` naming both numbers in mm.

### API (`src/app/api/fit/route.ts`, dev hearts only via `src/lib/dev-hearts.ts`)

- `GET /api/fit` → 200 `{ design: STARTING_VALVE, rulesVersion, rules, summary, results }`.
- `POST /api/fit` body `{ design, parent? }` (zod; unknown keys such as `hearts` are ignored). `parent` defaults to `STARTING_VALVE`. 200 same shape plus `parent`; 422 `{ error: "invalid-design", rulesVersion, reasons }`; 400 `{ error: "bad-request", message }` for a malformed body.
- Nothing under `src/engine` or `src/app/api/fit` reads `server-data/`.

Placeholder numbers on dev hearts, starting valve: 239 fit, 68 risk, 93 no-fit. With a 29 mm size (27-29): 18 newly at risk. All 500 hearts: 116 no-fit, 59 with the 29 mm size (REQ-2 sanity check).

## Files

- `src/engine/index.ts`, `src/engine/rules.ts`, `src/engine/starting-valve.ts` (the builder may merge or split within `src/engine/`)
- `data/rules.json`
- `src/app/api/fit/route.ts`
- `tests/e2e/req-6.spec.ts`
- Reads, without editing: `src/lib/dev-hearts.ts`, `src/contracts/index.ts`

## Test IDs (`tests/e2e/req-6.spec.ts`, run with `PORT=3006`, one worker, no `@live` or `@gpu`)

| ID | Done when | Checks |
|---|---|---|
| R6-1 | 1 | `GET /api/fit`: starting valve equals PRD sizes and orchestrator's `defaultStartDesign`; 400 results; fit + risk + noFit = 400 and match result statuses; every result matches an independent reference built from `rules.json` params |
| R6-2 | 2 | GET twice and POST twice are deep-equal; engine twice is deep-equal and inputs are not mutated |
| R6-3 | 3 | Every `no-fit`/`risk` heart has reasons with a known rule (in `rules` and `rules.json`), finite measured, limit, margin, margin < 0, and values equal to the reference; `fit` has none |
| R6-4 | 4 | POST a design with a 29 mm size: `newRiskHeartIds` equals the reference set, is non-empty and sorted; each is `risk` now and wasn't under the starting valve; starting valve vs itself gives `[]` |
| R6-5 | 5 | 2.6 mm-wide size: 422 with `size-width`, width, limit 2.5 and a message; exactly 2.5 mm: 200; engine agrees |
| R6-6 | 6 | `rules.json` schema: each rule `published` with a source or `demo-assumption`; kinds from the fixed set; PRD placeholder values present and all `demo-assumption`; API `rules` mirrors the file |
| R6-7 | notes | Engine with changed rule values follows the reference with those values, including a stricter width limit |
| R6-8 | notes | API results are exactly the 400 dev IDs, even when a hidden heart is posted; no `server-data` reference in engine or API source |
| R6-9 | notes | Engine on all 500 hearts: 116 no-fit with the starting valve, 59 with a 29 mm size |

## Risks

- **RES-1 changes values:** only R6-6's "PRD placeholder values" test needs updating. A rule needing a new kind is a code change by design.
- **Overlapping or boundary ranges:** resolved by "smallest nominal wins, bounds inclusive". No dev heart sits exactly on an edge.
- **Rules are baked in at build:** editing `rules.json` needs a rebuild, but no code change.
- **Duplicate start design:** `STARTING_VALVE` and the orchestrator's `defaultStartDesign` must match (R6-1 checks). Unifying them is REQ-12's job.
- **Spec imports `src/engine` and `src/orchestrator`** in Node; the engine must avoid `@/` aliases and Next-only modules.
