# REQ-11 live check results

Run: 2026-11-08, `npm run build` then `PORT=3011 npx playwright test tests/e2e/req-11.spec.ts --grep @live`, one worker, real Gemini. No code changed. The failure was not a network error, so no retry.

| Check | Result | Time |
|---|---|---|
| Done when 8: attack findings change the Fixer's next step, or it says why not | FAILED | 7.3 min |
| Done when 9: no hidden scoring, demo run time recorded, run saved | NOT RUN (serial suite, skipped after DW8 failed) | - |

## Failure reasons

- Done when 8: the demo run (investigate, propose round 1, attack round 1) stopped with reason `budget`, "More than 16 tool calls in one turn" (`maxToolCallsPerTurn`), during the round-1 attack turn. No second Fixer step ran, so the assertion "a second Fixer step followed the attack" failed (`propose` round 2 index was -1). The starting-valve checks before it passed.
- Done when 9 depends on the same shared run and was skipped by the serial suite. From the recording: `hiddenScoreCount` is 0, one proposal was made with verdict `context_dependent`, and the recording has no Gemini key. The DW9 assertions themselves were not run.

## Timing

- Slowest run: 437 s (7.3 min), the only live run. Recording `run-start` to `run-stop`: 01:19:36.9Z to 01:26:53.9Z. Step starts: investigate 0 s, propose round 1 at about 171 s, attack round 1 at about 317 s.
- Demo-mode run time: 437 s, but it stopped early on the budget, so it is not a full 2-round demo run. The DW9 read-back of `demoRunMs` did not run.

## Recordings saved

1 file in `fixtures/recordings/`: `3b6b293e-8e8b-4445-ba9f-cec004b679b1.json` (58 events, live mode). `req-11-live-summary.json` was not written because DW9 did not run.

Flagged for a human: the Breaker attack turn exceeds the 16 tool call limit on live Gemini (same pattern as the REQ-10 live check), and the Fixer and Breaker turns are slow (about 2.5 min each).
