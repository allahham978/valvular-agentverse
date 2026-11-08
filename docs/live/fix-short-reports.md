# Fix short-reports live check

Branch `fix-short-reports` at `7b42cb5`. `npm run build`, then `PORT=3091 npx playwright test tests/e2e/req-11.spec.ts --grep "Done when 8" --workers=1`, real Gemini, demo mode, through the memory gate. No app code changed. One run was needed (the first run was complete), so runs 2 and 3 were not made.

Result: REQ-11 Done when 8 PASSED, 8.4 min test time (run 502 s).

## Run 1: `1ad70280-f250-4c16-bcce-33173001fb6f`

Stop: `budget`, "Completed 2 attack rounds." (`maxRounds`, the normal demo end). 68 tool calls, 2 proposals.

| Step / turn | Starts at | Turn time |
|---|---|---|
| Breaker investigate | 0 s | 98 s |
| Fixer propose, round 1 | 98 s | 57 s |
| Breaker attack, round 1 | 155 s | 83 s |
| Fixer propose, round 2 | 238 s | 114 s |
| Breaker attack, round 2 | 352 s | 150 s |
| Run stop | 502 s | |

No turn hit the 180 s limit (longest 150 s). No step timeout, no model error, no rejected-report stop.

Proposals (dev hearts, 400):

| Proposal | Change | Fit | Risk | No fit | New-risk hearts | Verdict |
|---|---|---|---|---|---|---|
| proposal-1 | add 28 mm size (27 to 29.5 mm) | 59.75% to 72% | 68 to 76 | 93 to 36 | 8 | context_dependent |
| proposal-2 | add 19 mm size (19.5 to 22 mm) | 72% to 81.25% | 76 to 62 | 36 to 13 | 0 | supported_under_conditions |

Claims: proposal-1 `fitPct >= 72`; proposal-2 `newRiskCount <= 0`. Attack findings: 2 per round. The Fixer's round 2 proposal cites the round 1 attack evidence.

## Main-path replay

Chosen run: `1ad70280-f250-4c16-bcce-33173001fb6f`. It has Breaker mechanism findings, two Fixer proposals with claims, attacks, and code-assigned verdicts. The starting valve fits 59.8% (59.75%), and the 28 mm fix reaches 72% with 8 new-risk hearts. The full two-round run ends at 81.25%.

`fixtures/replays/demo.json` was regenerated from the recording with `replayFromRun` (id `demo`, source `recording`, 68 turns, `maxRounds` 2). The previous file was a one-round transcript replay.

`tests/e2e/req-17.spec.ts` through the gate: 11 of 11 passed, including "every tool result in an in-process replay equals a fresh tool call" and the HTTP version, so the replay numbers match a fresh code run. The spec was not edited.
