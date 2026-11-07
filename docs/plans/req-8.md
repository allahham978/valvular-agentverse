# REQ-8 plan: Agent feed and buttons

## Approach

"Break it" starts one scripted demo-mode run through the merged REQ-5 API (`POST /api/runs`, then `GET /api/runs/:id/events` with `EventSource`). The feed renders the run's real events. REQ-12 later swaps the script for Gemini without touching the feed.

- **One run, gated in the UI.** The REQ-5 loop always goes on from the Breaker's findings to the Fixer, and the API has no "stop after investigate" option. So the feed shows everything up to and including the Breaker's `finding` events, then holds later events until the user clicks "Fix it". After that it releases them in order, and live ones follow as they arrive. Nothing is invented: every shown event came from the stream. This needs no file outside the list, and it matches REQ-11's demo mode (one run: one Breaker turn, then at most 2 Fixer rounds). A server-side pause would mean changing REQ-5's orchestrator and route, which is out of scope. **Orchestrator: confirm, or move the pause to the server at REQ-11/12.**
- **Demo script** (`src/components/controls/demo-script.ts`): `ScriptedTurn[]` in the REQ-5 format, using `$lastEvidenceId`. It has an investigate turn (`evaluate_design` on the start design, then `report_findings` with at least one named mechanism), and one Fixer round (`evaluate_design` plus `submit_proposal` adding a 29 mm size (27-29 mm annulus), with a rationale that says "29 mm"). Then an attack turn (`evaluate_design` plus `report_findings`). Use `budget: { maxRounds: 1 }`. Every turn has `delayMs` of about 500-800 ms, so steps visibly stream and the spec can see the button states between batches. The whole run takes under about 10 s.
- **Run state** (`src/components/feed/run-store.ts`): a small `useSyncExternalStore` store, like `wall/use-wall-data.ts`. It holds `phase: idle | breaking | broken | fixing | done`, the events and the reveal gate. `start()` posts the script, opens the `EventSource` and closes it on `run-stop` (REQ-5 note). Controls and Feed both read it.
- **Buttons:** "Break it" is enabled when idle and disabled from the click until the run's `run-stop` and the reveal are both done. "Fix it" is enabled only in `broken`. Keep the names fixed: no "Breaking…" text. Fix ui-review item 7: a solid border, both disabled buttons styled as one set, Break it stays primary.
- **Feed:** each event is an `li` with `data-testid="feed-event"`, `data-type` and `data-actor`. A `tool-call` has a toggle button (`tool-call-toggle`, `aria-expanded`, its name includes the tool) that shows `tool-call-input` and `tool-call-result`, pretty-printed JSON from `data.input` and `data.result` (or `data.error`). Findings show their titles, the proposal its rationale, and attacks their titles. Hide `step-start` if it's noisy, but keep every tool call, finding, proposal and attack. The idle feed shows one short hint line, with no sample events. The "Sample data" label shows while the run's events are `mode: "replay"`. Retire the static `fixtures/sample-feed.json` import (leave the file, because the REQ-1 spec reads it).
- **New amber hearts:** when the revealed Fixer `evaluation` event (`improved: true`) shows, dispatch `valvular:fit-results` (REQ-4's existing hook) with `status: "risk"` for `summary.newRiskHeartIds`. The stand-in tools return `[]`, so until REQ-9 is wired, fall back to a fixed sample list (`src/components/feed/sample-new-risk.ts`) of about 6-10 currently-fit sample hearts with annulus near 27 mm. Each gets a risk `FitResult` with a reason, so REQ-4's popup still renders. The wall already says "Sample data".
- **Look (ui-review items 3 and 6):** measurements render as `29&#x202F;mm` (narrow no-break space) in a mono span with no negative tracking, with normal spacing after the unit. The feed panel is content-sized (`flex-none`, not `flex-1`) up to `max-h` of the remaining column, and its list scrolls past that.

## Files

- `src/components/feed/index.tsx`, `src/components/feed/run-store.ts`, `src/components/feed/sample-new-risk.ts`
- `src/components/controls/index.tsx`, `src/components/controls/demo-script.ts`
- `tests/e2e/req-8.spec.ts` (written, don't edit), `docs/plans/req-8.md`
- Maybe `src/app/page.tsx`: only if the feed's content-sized max height can't be done inside `feed/` (the column wrapper is there). Keep it to one class and say why.

No contract, API, orchestrator or dependency changes.

## Test IDs

Kept: `feed-panel`, `controls-panel`, `feed-event`, and the REQ-4 `wall-panel`, `wall-dot[data-status]` and `wall-total-risk`. New: `feed-event[data-type][data-actor]`, `tool-call-toggle`, `tool-call-input` and `tool-call-result`. Buttons are found by role: "Break it" and "Fix it".

## Spec notes

One scripted test at 1440x900 covers Done when 1-4. It checks the following:
- POST `/api/runs` and the events stream are used.
- A MutationObserver log shows the Breaker steps arriving in several batches. Break it is disabled throughout, Fix it is disabled until findings show, and nothing from the Fixer shows before the click.
- The tool call's input and result show every string and integer leaf from the server's event.
- Findings, attacks and proposals match `GET /api/runs/:id`. Every server tool call is in the feed.
- Demo mode has 1 investigate step and 1-2 propose steps.
- The wall's risk total rises and matches the amber dots, and new amber dots appear only after Fix.
- It also checks the ui-review fixes: a solid Fix border, `29 mm` with a non-breaking space and no negative letter-spacing, the panel sized to its content (24 px or less blank under the content), the panel bottom inside the column, and overflow that scrolls.
- No offsite requests and no console errors. Nothing is `@live` or `@gpu`.
- Run with `PORT=3008` after `npm run build`, through `heavy.sh`.

## Risks

- **UI gate versus server pause:** see Approach. If REQ-11 adds a real pause, the store's gate becomes a no-op.
- **Stand-in numbers:** evaluation text is stand-in "Sample data" until REQ-9 is wired into the route. The feed label must stay.
- **Script validity after REQ-9:** real tools may reject the stand-in shapes. REQ-12 owns updating the script, and the spec reads the server's run, so it doesn't hard-code numbers.
- **EventSource reconnect loops:** close on `run-stop` and on unmount, and ignore events with a `seq` already seen.
- **REQ-1 layout test:** the feed must stay below the wall, on the right, white, with a hairline border and shadow, and topmost at its centre.
- **Mac load:** one worker, one server on 3008, short scripted run.
