# REQ-14 Results: plan

## Fit in the system

REQ-13 already does the hard part: `POST /api/score` scores a finished run on the 100 hidden hearts and saves a `ScoreReport` (rows for proposal, no-change, add-larger-size, brute-force; coverage, new risks, designs tried, marks `proposal-wins | tie | baseline-wins`; `hiddenScoreCount`). `GET /api/score?runId=` reads it back. REQ-14 is a read-only view of that report plus the run's proposals (verdicts are code-assigned in `Proposal.verdict`). No new scoring, no contract changes, no new dependencies. REQ-19 will link to `/results?run=<id>` from the workspace; REQ-12's main-path replay becomes the default run.

## Approach

- `src/app/results/page.tsx` (server component, `dynamic = "force-dynamic"`): reads `searchParams.run`.
  - With `?run=<id>`: `getRunView(id)`. Missing or unfinished: render a `results-missing` message (no 500). Finished: `loadReport(id)`; only if none exists, call `scoreAndRecord(run)`, then `saveRun` + `saveReport` (same as the POST route). So opening the page scores a run once; reloads never rescore and the count stays honest.
  - With no param: the main-path run. Replay `DEFAULT_REPLAY_ID` once in process (`replayRun(file, { id: "results-main-path" })`, turn delays dropped), save it with `saveRun`, then the same load-or-score-once path. Later loads reuse the saved run and report.
- `src/components/results/*`: plain server-rendered markup, shadcn/Tailwind tokens already in the app.
  - `results-table` (with `data-run-id`): four equal columns in one row (CSS grid, 4 cols): "Agents' proposal", "No change", "Add one larger size", "Brute force". Each shows hidden-heart coverage as "N of 100 hidden hearts fit (P%)", new risks, designs tried. Brute force with no design shows its `reason`.
  - Baseline columns show two mark badges (`mark-coverage`, `mark-new-risk`, `data-mark`): "Proposal better", "Tie", "<Baseline> better". One badge component, same size, weight, border and fill for every mark; colour is neutral slate/teal, not fit-status green/amber/red, so a tie or loss reads exactly as loud as a win.
  - Proposal column lists each proposal's verdict (`results-verdict`, `data-proposal-id`, `data-verdict`), words = verdict with underscores as spaces, as on `/review`.
  - `output-line`: one sentence from the report, e.g. "The agents' proposal fits 67 of 100 hidden hearts; brute force did better with 70." It names every baseline that beats the proposal on coverage, and says "tie" when one matches.
  - `hidden-score-count`: "Hidden hearts scored 1 time for this run."
  - Footer text exactly: "Test hearts, not patients. All hearts come from one generator."
- Keep the `h1` "Results" and `SiteHeader` (req-1 checks both).

## Files

- `src/app/results/page.tsx` (rewrite)
- `src/components/results/index.tsx` (table, columns, output line, count, disclaimer)
- `src/components/results/mark-badge.tsx`
- `src/components/results/load.ts` (server-only: load-or-score-once, main-path run)
- `tests/e2e/req-14.spec.ts`

## Tests (`tests/e2e/req-14.spec.ts`, port 3014, all scripted, no key, no network)

Runs come from `POST /api/runs { replayId: "demo" }`; every number on screen is compared with `GET /api/score`.

| Done when | Tests |
|---|---|
| 1 | Four columns with labels, "hidden", "new risk", "designs tried", numbers equal the report; page scores an unscored run once; side by side (tops aligned, left to right, inside the viewport, no horizontal scroll) at 1440x900 and 1920x1080; verdict per proposal; `/results` with no param shows a finished replay run; unknown run shows `results-missing` |
| 2 | Every baseline mark visible with `data-mark` = report mark and worded (tie / baseline better / proposal better); all marks have equal font size, weight, fill and border, full opacity, contrast >= 4.5, height >= 16 px; precondition that the run has a tie or baseline win; output line names a baseline that beats the proposal |
| 3 | Output line has the proposal's fit, the 100 hidden hearts and "hidden"; count shows the report's `hiddenScoreCount` with "hidden" and "scored"; exact disclaimer; reload doesn't rescore; `POST /api/score` with a limit raises the count and the page shows the new numbers; no console errors |

No `@live` or `@gpu` steps: the page reads saved data only.

## Risks

- "The output line" is not defined elsewhere in the PRD. Interpreted as the one-sentence headline result above. Flag if a human meant something else.
- The DW2 precondition relies on the main-path run having a tie or baseline win (the agents' 29 mm proposal equals "add one larger size", so coverage ties). If REQ-12 changes the replay so the proposal beats every baseline on both metrics, that test fails on its precondition message and needs a human look, not a weaker spec.
- Server-side scoring on first page view writes to the runs dir; same code path and files as `POST /api/score`.
- REQ-12 may swap `fixtures/replays/demo.json` for the real Gemini main-path recording; the page and spec read whatever `DEFAULT_REPLAY_ID` / `"demo"` is, so no change needed.
