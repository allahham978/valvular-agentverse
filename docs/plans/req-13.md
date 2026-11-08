# REQ-13 plan: Hidden scoring and baselines

## Approach

Plain code, no model calls, no UI. It builds on the merged engine (`evaluateDesign`, `STARTING_VALVE`, `defaultRules`), the REQ-9 tools (`createAgentTools`) and the REQ-5 loop (`executeRun`, `PostLoopStep`). REQ-12 isn't built, so nothing is wired into `/api/runs` or the screens. REQ-14 reads the report from `GET /api/score`. **Rebase on main after REQ-10 merges, before building.** The Breaker baseline runs the Breaker through REQ-10's `runBreaker`, one Breaker turn per design.

**Hidden hearts.** `src/scoring/hidden-hearts.ts` is the only file under `src/` that reads `server-data/hearts.hidden.json`. Nothing in `src/tools` or `src/agents` imports `src/scoring`. Reports carry summaries only, with no per-heart results or measurements. Each scoring adds 1 to `run.hiddenScoreCount`, whether it comes from the API or the loop step.

**Scoring a run** (`scoreRun(run, limits)` in `src/scoring/score.ts`):
- The start design comes from the `run-start` event's `data.design`. The proposal design is the run's final design: the `proposal` event design of the last `evaluation` event with `improved: true`, or the start design if no proposal was accepted.
- Every row is scored on all 100 hidden hearts, with `parent` set to the start design. `newRiskHeartIds` are relative to the start design.
- Each row is `{ method, design, summary, coveragePct (= summary.fitPct), newRiskCount, designsTried }`. Baseline rows also get `marks: { coverage, newRisk }`, each `"proposal-wins" | "tie" | "baseline-wins"`, judged from the hidden fit count (higher is better) and the new-risk count (lower is better). Equal counts are a tie.
- `designsTried` is 1 for no-change and add-larger-size. For the proposal, it's the number of distinct size sets the Fixer evaluated, edited (valid `edit_design` results) or submitted in the run's `tool-call` events. For brute force, it's the number of candidates evaluated.
- **no-change:** the start design.
- **add-larger-size:** the start sizes plus `{ nominalMm: largest + 2, minAnnulusMm: largest max, maxAnnulusMm: largest max + 2 }`, so 29 mm covering 27-29, within the 2.5 mm rule.
- **brute-force:** a deterministic search on **dev** hearts only. The hidden hearts score only the winner. Candidates are contiguous chains: the start annulus `a0` runs from 19 to 25 in 0.5 mm steps, the width `w` is 2 or 2.5, and there are `k` sizes, from 1 to the `max-sizes` limit or 6 if there isn't one. Size `i` covers `[a0 + w*i, a0 + w*(i+1)]`, with `nominalMm` = the top of its range, as in the starting valve. That stops the search from shrinking frames to dodge the risk rules. The search keeps candidates that pass `min-fit-pct` and `max-new-risk` (dev, against the start design), and picks the highest dev fit count. Ties go to fewer sizes, then to the earlier candidate. Design IDs are deterministic. If no candidate passes, the row has `design: null` and says why.
- **Limits:** these are the run's limits plus any in the request. Only the REQ-9 kinds are supported (`max-sizes`, `min-fit-pct`, `max-new-risk`). Anything else returns a 400 that names the supported kinds.
- **Report:** `{ runId, heartSet: { split: "hidden", count: 100 }, hiddenScoreCount, limits, rows: [proposal, no-change, add-larger-size, brute-force] }`. Rescoring with the same inputs gives deep-equal `rows`.

**API** (`src/app/api/score/route.ts`, node runtime):
- `POST { runId, limits? }` scores a finished run. Unknown run: 404. Still running: 409. Bad body or unsupported limit: 400.
- On success it saves `run.baselines` (3 contract `Baseline`s) and `run.hiddenScoreCount` back to the run file, without adding events, so the run stays finished. It also writes the report to `<runsDir>/<id>.score.json`.
- `GET ?runId=` returns the last report without scoring again, so REQ-14 can display it without inflating the count. Never scored: 404.

**Loop step** (`src/orchestrator/scoring-step.ts`): `createScoringStep({ limits? }): PostLoopStep`. It scores `ctx.design` against the start design, sets `run.baselines` and `run.hiddenScoreCount`, and emits one `code` event of type `score` with the report as `data`, before `run-stop`.

**Breaker baseline** (`src/scoring/breaker-baseline.ts`): `runBreakerBaseline({ breaker: (design) => ModelClient, budget? })`. `POST /api/score/breaker-baseline` (`src/app/api/score/breaker-baseline/route.ts`) takes `{ breakers: { [plantedDesignId]: ModelSpec }, budget? }` (REQ-5's `ModelSpecSchema`, so `scripted` now and `gemini` after REQ-10) and returns the result. A missing design or a bad body returns 400. It doesn't touch hidden hearts.
- The planted designs and checklist are frozen in `fixtures/planted-flaws/{designs,checklist}.json`, labelled `demo-assumption`. They were committed with this plan, before any comparison run.
- For each design: (a) one Breaker turn with `createAgentTools()` and the budget, counting `nextTurn` calls (`modelSteps`), `tool-call` events and elapsed time; (b) the checklist steps through the same registry, followed by its `report_findings`. The checklist stops when it reaches the Breaker's `maxToolCallsPerTurn` or `maxTurnMs`.
- A flaw counts as found per the checklist's `match` rule, against the affected hearts that code computes.
- The result is `{ label: "demo-assumption", flawSetVersion, checklistVersion, tools (the 7 Breaker tools), budget, sides: { breaker, checklist }, verdict, summary }`. Each side is `{ flawsFound, misses, toolCalls, timeMs, cost: { modelSteps, usd }, designs: [{ flawId, designId, found, toolCalls, findings: [{ title, heartIds }] }] }`.
- The checklist's cost is `{ modelSteps: 0, usd: 0 }`. The Breaker's `usd` is `null` while the model client reports no token usage.
- `verdict` is `breaker-wins` only when the Breaker finds more flaws. Otherwise it's `tie` or `checklist-wins`, and `summary` says "The Breaker did not beat the checklist".

**Import rule.** Playwright's loader doesn't resolve `@/`, and the spec loads `src/orchestrator/scoring-step.ts` in-process. So `scoring-step.ts`, and everything it imports (`src/scoring/score.ts`, `brute-force.ts`, `hidden-hearts.ts`, `store.ts`), use relative imports only and never import `src/tools`. Only `breaker-baseline.ts` and the routes use `@/tools`.

## Files

`src/scoring/{index,hidden-hearts,score,brute-force,breaker-baseline,store}.ts`, `src/orchestrator/scoring-step.ts`, `src/app/api/score/{route.ts,breaker-baseline/route.ts}`, `tests/e2e/req-13.spec.ts`. The planner adds `fixtures/planted-flaws/*.json` (per the requirement notes).

The build also needs one minimal change outside these files: `src/run/store.ts` exports a `saveRun(run)` (the existing `persist`), so scoring can update a finished run.

## Tests (`tests/e2e/req-13.spec.ts`, port 3013, no key or network except @live)

- **H1** A scripted run, then `POST /api/score` returns the 4 rows in order, each on 100 hidden hearts with fit + risk + no-fit = 100. Each summary matches the engine recomputed on the hidden file. Running, unknown and malformed requests return 409, 404 and 400. The response has no hidden measurements, and only `src/scoring` reads the hidden file.
- **H2** `coveragePct`, `newRiskCount` and `designsTried` are present (no-change and add-larger-size are 1, the proposal is 1 for this script, brute force is more than 1). Every mark matches the spec's own comparison, and the expected tie (add-larger-size equals the proposal) and losses appear. Add-larger-size adds exactly 29 mm covering 27-29. Brute-force sizes are valid, nominal = range top, and its dev fit is at least the start's.
- **H3** With `max-sizes: 2`, brute force has 2 sizes or fewer (more than 2 without it), and the count goes 1 to 2 in the report and the stored run. `run.baselines` is updated and the run is still finished. `GET` doesn't change the count. An unsupported limit kind returns 400.
- **H4** Rescoring the same run, and scoring a second identical run, give deep-equal rows. The loop step, run in-process with a spec-local engine registry, gives the same rows, a `score` event before `run-stop`, and a count of 1.
- **H5** (over HTTP) The fixture hashes, labels and validity are checked. The checklist findings are recomputed through `/api/tools`. Weak, tie and strong scripted Breakers each give the right found counts, misses, tool calls (10), model steps (10), cost, finite time and verdict, with "did not beat" whenever the Breaker doesn't win. With `maxToolCallsPerTurn: 3`, the checklist makes 3 or fewer calls per design, and a scripted Breaker turn of 5 calls is cut off at 3 or fewer counted calls, before its report, so that design counts as a miss (the baseline records a budget-stopped Breaker turn as a miss, not an error). A partial `breakers` map returns 400. **H5-live `@live`** runs the same comparison with the Gemini Breaker.

## Risks

- **Alias in tests:** in-process imports of `src/tools` fail in Playwright (`Cannot find module '@/lib/dev-hearts'`). That's why the import rule above exists. REQ-10's spec imports `src/tools` in-process, so it will hit the same problem.
- **REQ-10 changes the defaults and the number guard.** The scripted finding text contains no digits. If `runBreaker` or `createModelClient({ kind: "gemini" })` merge under other names, stop and report.
- **RES-1 rule changes** move the hidden numbers. The spec recomputes them from the engine, so only the fixture hashes are fixed.
- **Brute force beats the agents on coverage** in the scripted run. That's expected (PRD §7), and the marks show it.
