# Fix track A (agent budget) live check results

Run: 2026-11-08, 02:45 to 03:22 UTC, on branch `fix-agent-budget` at `665ca0f`. `npm run build`, then `PORT=3091 npx playwright test tests/e2e/req-10.spec.ts tests/e2e/req-11.spec.ts --grep @live --workers=1`, real Gemini, through the memory gate. No code changed. Total 36.7 min: 1 passed, 3 failed, 1 not run.

| Check | Result | Time |
|---|---|---|
| REQ-10 Done when 7: starting valve, several tools, a non-annulus mechanism | PASSED | 2.3 min |
| REQ-10 Done when 8: two valves get different tool calls | FAILED | 4.6 min |
| REQ-10 Done when 9: 10 runs, at least 9 finish | FAILED (5 of 10) | 27.0 min |
| REQ-11 Done when 8: attack findings change the Fixer's next step | FAILED | 2.9 min |
| REQ-11 Done when 9: no hidden scoring, demo run time, run saved | NOT RUN (serial suite, skipped after DW8 failed) | - |

## What changed against the batch-3 live checks

- No run hit "More than 16 tool calls in one turn". In batch 3 that stopped 5 of 10 REQ-10 runs and the REQ-11 attack turn. Every run now reached the reserve: 11 of 14 logged `budget-wrap-up` ("next step can only call report_findings") and `tool-skipped`. Runs used 9 to 15 tool calls.
- The failures are now the 180 s turn limit and the 60 s model-step timeout.

## Failure reasons

- **REQ-10 DW8**: the starting valve run finished (`investigated`, 95 s). The second valve's run (`1ee1068a`) stopped `budget`, "The agent turn took longer than 180000 ms". Its first `report_findings` came at 157 s and was rejected ("numbers not in the cited evidence: 115"). The retry did not finish before 180 s.
- **REQ-10 DW9**: 5 of 10 finished (needs 9). Stops: 5 `investigated`, 3 `budget` (180 s turn limit), 2 `model-error` ("Model step timed out after 60 s, then again on its one retry").
  - 2 of the 3 time-limit stops (`2e70fe50`, `227aa00e`) had a `report_findings` rejected for an uncited number (68, 67). The retry then ran out of time.
  - The third (`357bf1f3`) reached the reserve at 142 s, and its report step didn't finish before 180 s.
  - The 2 model errors (`fbf9586d`, `3b29b56b`) came after 9 and 12 tool calls. Neither reached the reserve.
- **REQ-11 DW8**: the run (`8aa7012a`) stopped during the investigate step, before any proposal or attack. Reason `model-error`, "Model step timed out after 60 s, then again on its one retry". It had reached the reserve at 53 s (3 tool calls, 126 s left), then the report step timed out twice. `attack1` index was -1. The starting-valve checks before that passed.

## Timing

| Run | Test | Stop | Time |
|---|---|---|---|
| `84ac0588` | REQ-10 DW7 | investigated | 138 s |
| `e7012781` | REQ-10 DW8, starting valve | investigated | 95 s |
| `1ee1068a` | REQ-10 DW8, valve B | budget (180 s) | 180 s |
| `f558d4cc` | REQ-10 DW9 #1 | investigated | 167 s |
| `bbdf28bd` | REQ-10 DW9 #2 | investigated | 147 s |
| `2e70fe50` | REQ-10 DW9 #3 | budget (180 s) | 180 s |
| `4522decb` | REQ-10 DW9 #4 | investigated | 122 s |
| `227aa00e` | REQ-10 DW9 #5 | budget (180 s) | 180 s |
| `fbf9586d` | REQ-10 DW9 #6 | model-error | 175 s |
| `4f978cf9` | REQ-10 DW9 #7 | investigated | 126 s |
| `249241a8` | REQ-10 DW9 #8 | investigated | 174 s |
| `357bf1f3` | REQ-10 DW9 #9 | budget (180 s) | 180 s |
| `3b29b56b` | REQ-10 DW9 #10 | model-error | 165 s |
| `8aa7012a` | REQ-11 DW8 demo run | model-error | 173 s |

- REQ-10 DW9: slowest run 180,011 ms, slowest finished run 174,092 ms (from `req-10-live-summary.json`).
- REQ-11 demo run: 173 s, stopped in the investigate step. It isn't a full 2-round demo run. The `demoRunMs` read-back in DW9 didn't run.

## Recordings saved

14 new files in `fixtures/recordings/`, all live mode, one per run in the table above. `req-10-live-summary.json` was rewritten for this run. `req-11-live-summary.json` wasn't written because REQ-11 DW9 didn't run.

## Flagged for a human

The budget fix removes the tool-call stops. Live Breaker turns still take 95 to 180 s, so the 180 s turn limit and the 60 s step timeout now decide the outcome. A `report_findings` rejection late in a turn (an uncited number) leaves too little time for the one retry. The REQ-11 flow can't reach an attack while the investigate turn alone takes about 3 min. The PRD section 3 limits weren't changed.
