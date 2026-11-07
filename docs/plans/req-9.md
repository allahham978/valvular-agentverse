# REQ-9 plan: Agent tools

## Approach

Nine plain, deterministic functions in `src/tools/` that wrap the REQ-6 engine (`evaluateDesign`, `defaultRules`, `STARTING_VALVE`) and the dev hearts (`src/lib/dev-hearts.ts`). Each call is zod-validated and returns a `ToolOutcome` (`src/orchestrator/tools.ts`): `{ ok: true, evidence }` or `{ ok: false, error, status }`. One `createAgentTools(): ToolRegistry` exposes them, with JSON-schema `specs()`. `POST /api/tools` runs one tool for tests and later UI. `/api/runs` swaps the REQ-5 stand-in for `createAgentTools()`. No UI, no prompts (REQ-10/11), no verdicts (REQ-11), no limit parsing (REQ-15).

**Evidence.** `id = "ev-" + sha256(tool + canonical input).slice(0, 16)`, so a repeat call gives the same ID and result. `source: "computed"`. `provenance = { rulesVersion: defaultRules.version, dataHash: sha256 hex of data/hearts.dev.json bytes, seed: data/sources.json seed }`.

**Hidden hearts.** Tools read only `devHearts()`. Nothing in `src/tools/` mentions `server-data` or `hearts.hidden`. Any heart ID not in the dev set (hidden or unknown) gets a 403 refusal naming the ID and saying hidden hearts are refused. This applies to `profile_group`, `inspect_heart`, `what_if`, `stress_test` (`subgroup`) and `report_findings` (finding `heartIds`). No measurements of the refused heart go in the response.

**Errors.** Bad input returns 400 `{ ok: false, error }`. The error names the field path (for example `hypothesis`, `claim`, `heartIds`) and what is expected. An unknown tool returns 404 with the tool's name in the error. Errors go out in the order hidden heart (403), then shape (400), then engine rejection (422). A design the engine rejects returns 422 with the engine's reason. The exception is `edit_design`, where an invalid design is a normal result.

## Tool contracts (input, then `evidence.result`)

`Change` = `{kind:"add_size", size:{nominalMm,minAnnulusMm,maxAnnulusMm}}` | `{kind:"remove_size", nominalMm}` | `{kind:"set_range", nominalMm, minAnnulusMm, maxAnnulusMm}`.
"Failing" means `risk` or `no-fit`. `changed` = `{heartId, from, to}[]`, sorted by heart ID.

| Tool | Input | Result |
|---|---|---|
| `evaluate_design` | `design, parent?` | `Summary` fields at top level (so `SummarySchema` parses, orchestrator unchanged) + `changed`. `newRiskHeartIds`/`changed` are vs `parent`, empty when there's no parent (this keeps the REQ-8 sample wall fallback working) |
| `group_failures` | `design, by: "rule"\|"size"\|"band", measure?="annulusMm"` | `{ by, groups: {key, count, risk, noFit, heartIds}[] }`. The rule key is the reason `ruleId`, the size key is `"23"` etc. or `"none"`, and band is a 2 mm band such as `"25-27"` |
| `profile_group` | `heartIds` (≥1, not every dev heart) | `{ groupSize, restSize, measures: {measure, groupMean, restMean, difference, effectSize}[] }` covering every dev measure, sorted by `abs(effectSize)` desc. `difference = groupMean - restMean`, `effectSize = difference / SD(all dev hearts)` |
| `inspect_heart` | `heartId, design` | `{ heartId, measures, status, sizeMm?, reasons }` (same as the engine's `FitResult`) |
| `what_if` | `design, heartIds, change` | `{ valid, reasons? , hearts: {heartId, before, after, fixed}[], fixedCount }` |
| `stress_test` | `design, kind, amount, hypothesis, disprovedIf, measure?, heartIds?` | `{ kind, amount, hypothesis, disprovedIf, total, changedCount, changed, before: Summary, after: Summary }`. `measurement_shift` adds `amount` mm to every rule-read measure (`annulusMm`, `sinusMm`, `sinotubularJunctionMm`), or only to `measure` if given. `assumption_shift` adds `amount` to `frame-outflow.offsetMm`. `subgroup` needs `heartIds` and evaluates the design on that subgroup (`amount` optional). `hypothesis` and `disprovedIf` must be non-blank |
| `report_findings` | `mechanisms: {title, explanation, heartIds, severity, evidenceIds(≥1, "ev-…")}[]` (≥1) | `{ findings }` (the shape `parseReport` expects) |
| `edit_design` | `design, change, limits?: Limit[]` | Valid: `{ valid:true, design (new id, label, hypothetical, parentId=input id), comparison:{parent:Summary, child:Summary, fitPctDelta, newRiskHeartIds, changed}, limits:{id, kind, value, pass, detail}[] }`. Invalid: `{ valid:false, reasons }`. Supported limit kinds: `max-sizes`, `min-fit-pct`, `max-new-risk`. Any other kind is refused with 400 (typed limits) |
| `submit_proposal` | `design, rationale, claim?, tradeOffs?=[], evidenceIds(≥1)` | `{ design, rationale, tradeOffs, claim?, evidenceIds }`. `claim` must match `Claim` (`metric` `fitPct`\|`newRiskCount`, `comparator` `>=`\|`<=`, numeric `threshold`). Free text is refused. An invalid design is refused (422) |

## Contract changes (`src/contracts/index.ts`, additive only)

`ClaimSchema`/`Claim`. `EvidenceSchema` gets `source` (enum) and `provenance` `{rulesVersion, dataHash, seed}`. `ProposalSchema` gets `claim`, `verdict` (the 5 verdicts in section 3) and `notShown: string[]`. All of these are **optional** in the schema. Real tools always set `source`/`provenance`. Making them required would break REQ-5's merged spec, which builds `Evidence` without them and posts `submit_proposal` with no `claim`.

## Files

- `src/tools/*` (new): `index.ts` (registry + specs), `evidence.ts`, `inputs.ts` (zod), one module per tool group.
- `src/app/api/tools/route.ts` (new): `POST {tool, input}` → `{ok, evidence}` / `{ok:false, error}` with status.
- `src/contracts/index.ts`: the additive fields above.
- Outside the listed files (needed by "replace REQ-5's stand-in", kept minimal):
  - `src/app/api/runs/route.ts`: use `createAgentTools()`.
  - `src/orchestrator/roles.ts`: Breaker `toolNames` = the 7 Breaker tools, Fixer = `evaluate_design`, `edit_design`, `submit_proposal`.
  - `src/orchestrator/terminal.ts` + `index.ts`: carry `claim` from the submission into `run.proposals`.
  - `src/orchestrator/tools.ts`: optional `status` on the failed `ToolOutcome`, so the route can return 400, 403, 404 or 422.
  - `stand-in-tools.ts` stays because REQ-5's spec imports it.

## Tests (`tests/e2e/req-9.spec.ts`, port 3009, no key or network)

- **DW1:** each of the 9 tools with valid input returns 200 with an evidence ID (`ev-…`), `source: "computed"` and exact provenance. A repeat call gives identical evidence. Cross-checks: numbers match `/api/fit`, `inspect_heart` matches `/api/fit`, and `group_failures` counts match the per-rule failures in `/api/fit`.
- **DW2:** each tool with invalid input returns 400, and the error names the bad field. An unknown tool returns 404. A malformed body returns 400.
- **DW3:** a 1 mm `measurement_shift` reports `changedCount`, which equals a recount through the engine.
- **DW4:** `profile_group` on the at-risk hearts (from `/api/fit`) returns means that match the data, sorted by `abs(effectSize)`.
- **DW5:** a hidden heart ID gets 403 from every heart-taking tool, including a mixed list, with no hidden measurements in the body. `src/tools` never references hidden data. In a scripted run, the refusal is logged.
- **DW6:** `edit_design` adds 29 mm. One result holds the new design, a comparison with the parent that matches `/api/fit`, and limit pass/fail (`max-sizes` 4 passes, 3 fails). An unsupported limit is refused. A too-wide size gives `valid:false` with the reason.
- **DW7:** `stress_test` without `hypothesis` or `disprovedIf`, or with them blank, is refused, and the error names the field.
- **Integration:** a scripted `/api/runs` run uses the real tools. Its evidence carries `source` and provenance, its summary equals `/api/fit`, a Breaker-only tool runs, and `claim` reaches `run.proposals`.

## Risks

- **REQ-5/REQ-8 regressions:** the builder must also run `req-5` and `req-8` (the demo script's evaluate→submit flow, the "Sample data" label, and the new-amber fallback on the sample wall). `evaluate_design` without `parent` must keep `newRiskHeartIds: []`.
- **PRD vs merged spec:** the PRD writes `Proposal.claim` and `Evidence.source/provenance` without `?`. They're optional here for REQ-5 compatibility, and `submit_proposal` accepts a missing `claim`. REQ-11's Fixer `validate` can require it.
- The measured 1 mm shift is 124 of 400 on this split, not the PRD's 104 (different split). The spec checks the code's count, not a constant.
