# REQ-12: stopped, 3 specs outside REQ-12 fail on the real recording

State: `tests/e2e/req-12.spec.ts` (non-live tests) and `tests/e2e/req-1.spec.ts` pass. `npm run build` is clean. `PORT=3012 npm run verify` exits 1: 237 passed, 3 failed. All 3 are specs written against the old hand-written `demo-script.ts` transcript. The Break/Fix buttons now replay the recorded `fixtures/replays/demo.json`, as the plan predicted. I may not edit these specs, so I stopped.

Failing, content-dependent:
1. `fix-demo-consistency.spec.ts:137` expects the demo attack to survive ("71.5% after the shift"). The recording's verdict has an attack that does not all survive.
2. `req-7.spec.ts:660` "changing the design changes the valve size" waits for design id `demo-wider` (the old script's proposal). The recording proposes a different design id (`start-...` is still shown, so the proposal's id or size differs).
3. `req-8.spec.ts:163` expects the old script's finding titles (e.g. "Annulus coverage gap below 21 mm and above 27 mm") before Fix it. The recording's findings have different titles/mechanisms.

Not blocking: `req-12.spec.ts` "@live" ran in a plain `playwright test` and failed after 12 min (no Breaker finding from Gemini in the window). It is excluded from verify (`--grep-invert @live`) and flagged only.

Sharper instruction for the next run: update the three specs' expectations to the recording's content, with the owner's approval to edit them (for example derive the finding titles, proposal design and attack outcome from `fixtures/replays/demo.json` or `/api/replays/demo` instead of hard-coding the old script). Or have the owner pick the recording and the specs follow. Then rerun verify once.
