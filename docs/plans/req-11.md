# REQ-11 plan: Fixer and attack loop

## Approach

The REQ-5 loop already runs investigate → propose → attack. REQ-10 adds the Breaker roles, the number guard, `LoopContext.evidence`, the step budget, one retry after a `validate` rejection and `record`. REQ-11 adds the Fixer role, a thin attack role, **code-assigned verdicts** (PRD §3 "Claims and verdicts") and demo mode. No UI, no limit parsing (REQ-15), no hidden scoring (REQ-13). **Rebase on main after REQ-10 merges, before building.** The spec relies on REQ-10's guard and `createModelClient({ kind: "gemini" })`.

### `src/agents/fixer/` (the spec imports `fixerRole`)
- `fixerRole: AgentRole`: actor `fixer`, tools `evaluate_design`, `edit_design`, `submit_proposal`, terminal `submit_proposal`.
- **Prompt:** current design JSON and fit, active limits, the Breaker's mechanisms, and from round 2 the last attack findings (titles and evidence IDs) plus the last proposal's verdict and per-attack outcomes. It tells the Fixer to use `edit_design` (whose result already has the comparison and limit checks), to pick a trade-off, and to submit one design with a **structured claim** `{metric, comparator, threshold}`, non-empty `tradeOffs` and the `edit_design` evidence ID. It must only use numbers from cited evidence. From round 2 it must say how the attack findings changed this step, or why they didn't.
- **`validate`** (one retry, then REQ-10's `model-error`):
  1. The design must pass every active limit, using the REQ-9 limit checks. Export the check from `src/tools/design.ts` rather than copying it. The rejection names the limit.
  2. REQ-10's number guard on `rationale` and `tradeOffs`, against the cited evidence. Allowed: current and proposed design sizes and label digits, and active limit values.
- A missing claim is **not** rejected, because REQ-5, REQ-8 and REQ-9 merged specs submit without one. Instead it gets the verdict `invalid_experiment`.

### `src/agents/attack/` (the spec imports `attackRole`, `runLoop`, `DEMO_MAX_ROUNDS`)
- `attackRole` = REQ-10's `breakerRoles.attack`, with a prompt that also states the proposal under attack: its claim (metric, comparator, threshold) and parent design.
- **`assignVerdict`** is a pure function. Its inputs are the proposal, its design, the parent design, the run evidence and the `stress_test` evidence from that round's attack turn. **Attacks** = successful `stress_test` calls in the attack turn on the proposed design (same sizes), including calls made before a budget stop. The claim metric is computed by code:
  - `fitPct` from the engine summary.
  - `newRiskCount` = `newRiskHeartIds.length` against the parent.
  - On dev hearts, use `evaluate_design {design, parent}`.
  - Under an attack, evaluate child against parent under that attack's hearts or rules. Export the stress conditions from `src/tools/stress.ts` so the numbers equal `stress_test`'s `after`.
- **Verdict order:** `invalid_experiment` (no claim, or no cited evidence whose input or result holds a design with the proposed sizes) → `contradicted` (fails on dev) → `inconclusive` (no attack) → `context_dependent` (any attack fails) → `supported_under_conditions`.
- **`notShown`:** always "Dev hearts only: hidden hearts were not scored." Plus "Fit rules are demo-assumption." when any rule in `rules.json` is one. Plus the attacks that ran, "No attack finished." when there were none, and the reason for an invalid experiment.
- `runLoop({ model, tools?, design?, limits?, budget?, demo?, startAt?, onEvent? })` calls `executeRun` with `record: model.mode === "live"`. **Demo mode** sets `maxRounds = min(given ?? 2, 2)`: one Breaker turn, at most 2 Fixer rounds, one attack turn each. `DEMO_MAX_ROUNDS = 2`.

### Small changes outside the listed files (kept minimal)
- `src/orchestrator/roles.ts`: `defaultRoles.propose = fixerRole`, `defaultRoles.attack = attackRole`.
- `src/orchestrator/index.ts`:
  - Collect each attack turn's evidence. After each attack step, even one stopped by budget, call `assignVerdict`, set `proposal.verdict` and `notShown`, and emit a `code` event `verdict` with data `{ proposalId, verdict, notShown, dev: {metric, value, holds}, attacks: [{evidenceId, kind, amount, value, holds, outcome: "survived"|"broke"}] }`.
  - At the end of the run, any proposal still without a verdict (for example one stopped by `no-improvement`) gets one before `run-stop`.
  - The `proposal` event data gains `comparison: { before, after, newRiskHeartIds, evidenceId }` from a code-run `evaluate_design {design, parent}`, recorded in `run.evidence`. The existing `evaluation` event is unchanged, so the REQ-8 wall is unaffected.
  - `no-valid-fix` detail starts "No design fits:". A Fixer turn that hits `maxToolCallsPerTurn` or `maxStepsPerTurn` with no valid, in-limit `edit_design` result in that turn also stops `no-valid-fix`, because Gemini's tool mode `ANY` can never end a turn without a call. Any other Fixer budget stop stays `budget`.
- `src/app/api/runs/route.ts`: body accepts `demo?: boolean` and applies the same cap. The default stays the full loop, so REQ-5's spec is unchanged. REQ-12 points the buttons at demo mode.

## Files
`src/agents/fixer/{index,role,prompt}.ts`, `src/agents/attack/{index,role,verdict,run}.ts`, `fixtures/transcripts/fixer/demo-run.json` (a self-contained `ScriptedTurn[]` for a 2-round demo run: investigate, then propose via `edit_design` and a claim, attack with `stress_test`, then a second proposal that improves, then a second attack; guard-clean text), `fixtures/recordings/req-11-live-summary.json` (live), `tests/e2e/req-11.spec.ts`. Plus the five small edits above (`roles.ts`, `orchestrator/index.ts`, `api/runs/route.ts`, and exports in `tools/design.ts` and `tools/stress.ts`).

## Tests (`tests/e2e/req-11.spec.ts`, port 3011)
Scripted tests run in-process through `runLoop` with the real tools, plus one test over HTTP. They need no key and no network, and there are no delays. Thresholds and designs come from the tools at run time, with preconditions, never hard-coded.
- **DW1:** the fixture in demo mode gives steps `investigate, propose, attack, propose, attack` and stops `budget/maxRounds`. A `verdict` follows each attack and comes before the next propose. The round-2 Fixer prompt contains the round-1 attack titles and verdict. The attack prompt states the claim.
- **DW2:** `submit_proposal` with a design wider than 2.5 mm, and `edit_design` returning `valid:false`, are both rejected, the reason reaches the next request, and the retry gives one proposal. A 4-size design under a `max-sizes 3` limit is rejected, the rejection names the limit, and the retry is accepted.
- **DW3:** a Fixer that ends its turn, or uses up its tool calls on invalid edits, gives `no-valid-fix` with "no design fits" and no proposal. Using up the budget after a valid edit stays `budget`.
- **DW4:** each fixture proposal has a structured claim, trade-offs and cited run evidence (including an `edit_design` for its sizes). It also has `comparison` before, after and new risks, which match a code evidence item and an independent tool call.
- **DW5:** `supported_under_conditions` (two attacks that hold), `context_dependent` (one holds, one breaks), `contradicted` (`newRiskCount` fails on dev) and `inconclusive` (tool budget used up before any attack), plus `invalid_experiment` (cited evidence about another design). Each one's dev and attack values are cross-checked against tool results, and `notShown` includes "dev hearts only" and "demo-assumption".
- **DW6:** a "Survived" attack report is recorded as an `attack` finding with no error, with the outcome `survived`, and the run doesn't stop with `model-error`.
- **DW7:** demo mode, in-process and over HTTP with `maxRounds: 3` requested, runs 1 investigate and 2 rounds, with `run-start` budget `maxRounds` 2. Without demo, the same script runs 3 rounds. Every proposal gets a verdict.
- **Guardrail:** an invented number in the Fixer's rationale is rejected with one retry. `defaultRoles` use the REQ-11 roles.
- **DW8–DW9 `@live`:** one shared demo run with Gemini. DW8: the run starts from `STARTING_VALVE` (`run-start` design, `startDesignId`, proposal-1 `fromDesignId`). The round-2 Fixer sees the round-1 attack findings and either (a) proposal-2 cites round-1 attack evidence, (b) proposal-2's design or claim differs from proposal-1 and its rationale, trade-offs or Fixer text names a round-1 attack finding (evidence ID, title or `stress_test` kind), or (c) a round-2 event of type `attack-response` with data `{ changed, reason, evidenceIds }` gives a non-empty reason that cites or names a round-1 attack finding. DW9: no hidden IDs in any call or evidence, `hiddenScoreCount` 0, the recording's `run-start` to `run-stop` timestamps give a positive run time matching the measured time (no upper wall-clock bound), the time written to the summary is read back (`demoRunMs > 0`), and a recording that parses and contains no key.
- **Timeouts:** scripted tests use a 180 s test timeout (busy machine), the HTTP demo test 180 s + 90 s poll budget.

## Risks
- **REQ-10 contracts:** the guard API, `LoopContext.evidence`, the `record` option and the one-retry rule. If they merge differently, adapt the calls, not the spec. If the spec can't pass, stop and report.
- **Regressions:** the new `verdict` events and the proposal `comparison` could affect REQ-5 and the REQ-8 feed. Run `req-5`, `req-8`, `req-9` and `req-10` too.
- **Interpretation:** "one attack each" is read as one Breaker attack turn per Fixer round, not one `stress_test`.
- **Live:** with mode `ANY`, a Fixer that won't give up burns its budget. DW8 can fail if the Fixer ignores the prompt. Both are flagged, not blocking. The builder may make at most 5 live runs.
