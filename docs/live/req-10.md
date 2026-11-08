# REQ-10 live check results

Run: 2026-11-08, `npm run build` then `PORT=3010 npx playwright test tests/e2e/req-10.spec.ts --grep @live`, one worker, real Gemini. No code changed. Failures were not network errors, so no retry.

| Check | Result | Time |
|---|---|---|
| Done when 7: starting valve, several tools, non-annulus mechanism | PASSED | 2.7 min |
| Done when 8: two valves, different tool calls | FAILED | 3.0 min |
| Done when 9: 10 runs, at least 9 finish, each saved | FAILED (4 of 10 finished) | 19.8 min |

## Failure reasons

- Done when 8: the first run stopped with reason `budget` ("The agent turn took longer than 180000 ms"), where `investigated` was expected. The second valve was never run.
- Done when 9: 6 of 10 runs stopped on `budget`, 4 finished (`investigated` with findings). 5 stops were "More than 16 tool calls in one turn" (49 s, 43 s, 98 s, 168 s, 180 s) and 1 was the 180 s turn timeout. The Breaker is hitting the 16-tool-call and 180 s limits on the starting valve. Flagged for a human.

## Timing

- Slowest run: 180.0 s (a timed-out run). Slowest finished run: 162.0 s.
- Finished runs: 59.5 s, 104.7 s, 140.1 s, 162.0 s.
- Demo-mode run time: not recorded. The @live spec only runs live Gemini and does not time a demo-mode run.

## Recordings saved

13 files in `fixtures/recordings/`: 12 run recordings (all passed the recording checks: saved, schema-valid, no key, events in live mode) and `req-10-live-summary.json` with the per-run results.
