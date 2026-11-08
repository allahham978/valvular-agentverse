# REQ-12 plan: core demo end to end

## Main path (repo owner's decision)

On the workspace, **Break it** and **Fix it** play `fixtures/replays/demo.json` by default: a recorded Gemini demo-mode run, replayed through the real tools, so code recomputes every number. The demo starts instantly and can't fail on stage. It's labelled only with the existing "Replay, not live". Don't add wording like "recorded from live Gemini". `?mode=live` sends the same buttons to Gemini in demo mode, for the `@live` check. This replaces PRD section 3's "demo mode is the default from the buttons" for the buttons only. Demo mode stays the setting for live runs.

## Approach (small fixes in the owning files)

1. **Buttons** (`src/components/controls/*`, `src/components/feed/run-store.ts`): `startRun()` posts `{ replayId: "demo" }` by default. With `?mode=live` in the URL, it posts `{ model: { kind: "gemini" }, demo: true }`. The scripted `demo-script.ts` is no longer used by the buttons. Keep it only if another spec imports it.
2. **Real wall** (`src/components/wall/data-source.ts`): load `GET /api/hearts` (ids, measures, thumbs, meshes) and `GET /api/fit` (starting-valve results, about 239/68/93). Show no "Sample data" label (`label: null`). The heart panel takes rule types from `/api/fit`'s `rules[].status` (`sample-rules.ts` goes or falls back). `sample-hearts.json` is no longer read by app code.
3. **Fix it on the wall** (`run-store.ts`): when an `evaluation` event with `improved: true` is revealed, take that design from the matching `proposal` event, `POST /api/fit { design }` and dispatch **all** of its results through `valvular:fit-results`. Only changed dots update, the real new-risk hearts turn amber, and the totals match code. Delete `sample-new-risk.ts`.
4. **Feed label** (`src/components/feed/index.tsx`): the feed stops showing "Sample data" for replay runs. "Replay, not live" (`replay-label`) is the replay's label. Nothing else changes.
5. **Result line** (new, in `src/components/feed/`): `data-testid="result-line"`, shown once Fix it settles: "This valve fits X% of test hearts. With this change, it fits Y%, and here's the new risk", followed by the new-risk count and "Dev hearts". X is the start design's `fitPct.toFixed(1)` and Y the improved design's (the same numbers code puts in the feed's evaluation lines). New risk is the improved design's `newRiskHeartIds` against the starting valve.
6. **3D**: REQ-7 (built in parallel) provides the real dev-heart root, the "schematic valve" and the `main-view-status` caption. REQ-12 only checks it end to end, so merge REQ-7 first.
7. **Demo fixture**: the short-reports fix replaces `fixtures/replays/demo.json` with a real recording (`source: "recording"`). Merge it before REQ-12. REQ-12 doesn't write the fixture.

## Files

`tests/e2e/req-12.spec.ts`, `src/components/controls/index.tsx` (+ `demo-script.ts` if unused), `src/components/feed/{run-store.ts,index.tsx,result-line.tsx}`, `src/components/feed/sample-new-risk.ts` (delete), `src/components/wall/data-source.ts`, `src/components/heart-panel/{index.tsx,sample-rules.ts}`, `docs/plans/req-12.md`, plus the spec retirements below.

## Test IDs (`tests/e2e/req-12.spec.ts`, port 3012)

| Test | Covers |
|---|---|
| "main path replays a recorded Gemini demo-mode run" | `demo.json` has `source: "recording"`, with findings, a proposal and a `stress_test` |
| "Done when 1-6" (scripted, one presenter path) | DW1: heart-model scale changes on `/`. DW2: wheel to stage 1, REQ-7's "schematic valve" label, `root-*` meshes in the scene, `main-view-status` `data-heart-id` is a real dev heart (REQ-7's landing root is `heart-001`'s bytes, so no `/hearts/*.glb` request is required before a selection), 400 dots whose ids, statuses, colours and totals equal `/api/fit`, hover shows the real thumbnail, no "Sample data". DW3: Break posts `{replayId:"demo"}`, the button is disabled, events stream in at least 3 batches, every mechanism finding from the run API is in the feed, Fix it is enabled, no Fixer output yet, wall unchanged. DW4: a red heart other than the one in the main view: popup with measures, rule rows (limit, margin, rule status from `/api/fit`), 3D view, then Open in main view: `data-main-heart-id`, caption `data-heart-id`/`data-status=no-fit`/"synthetic heart", root mesh fingerprint changes. DW5: proposal, attack and verdict (plain words) appear, an evaluation line shows Y%, the wall equals `POST /api/fit` for the improved design, every `newRiskHeartIds` dot is amber and none was amber before, no `sample-` ids. DW6: result-line text. Throughout: every event `mode: "replay"`, "Replay, not live" visible whenever the feed has events, no offsite requests, no console errors |
| "real wall keeps the REQ-4 hover, expand and popup behaviours" | Replaces the retired req-4 checks on real data: hover on dots 0 and 399, expanded wall with 400 thumbs in `/api/fit` order and status, amber popup, Esc closes one layer, Open in main view from the overlay, green heart has no rule, popup centred, clicking outside leaves the main view alone |
| "Done when 7 … @live" | The same `mainPath` with `/?mode=live`: Break posts `{model:{kind:"gemini"}, demo:true}`, events `mode: "live"`, no replay label. Not in `verify`. Run once after review. A failure is flagged, not blocking |

## Retired tests (only because they assert or select the REQ-1 sample fixture; `test.skip(replacedBy(12), "REQ-12 connects real results")` or `if (!replacedBy(12))`)

- `req-1.spec.ts` "Sample data" on the wall: it already has `replacedBy(12)` and skips once this spec exists. No edit.
- `req-8.spec.ts`: the single assertion `feed … "Sample data"` visible (line 186) is now guarded with `if (!replacedBy(12))`. The rest of the test is unchanged.
- `req-4.spec.ts` (keyed on `sample-NNN` ids or the fixture's statuses), 23 titles and 26 runs: "400 status-coloured dots … at 1440x900" and "… at 1920x1080"; "the fixture is read in one swappable module"; "dot 0 / 24 / 399 shows its thumbnail and ID"; "the card follows the pointer and leaves with it"; "shows all 400 thumbnails with the same colours"; "first and last thumbnails load, and are large enough to read"; "clicking a thumbnail opens the popup above it, and Esc closes one layer at a time"; "only the changed hearts update, and the totals change"; "the same results again change nothing"; "a result for a heart not on the wall is ignored"; "the open overlay updates with the same colours"; "the open popup shows the new result"; "a red heart shows its 3D view, measurements and failed rule"; "the popup is centred and fits the screen"; "every sample rule shows its rule type"; "an amber heart shows its status and rule, and a green one has no failed rule"; "dragging rotates the 3D view, which is still when left alone"; "the main view pauses while it's open, and resumes after"; "\"Open in main view\" closes the popup and sends the heart ID"; "\"Open in main view\" from the expanded wall closes both"; "Esc closes the popup without changing the main view"; "clicking outside closes the popup, and clicking inside doesn't"; "opening many popups in a row keeps the main view alive". Kept: "scrolling over it leaves the stage alone", "Esc and the close button close it".

## Risks

- **Coverage:** most of req-4 picks sample ids, so it can't run on real ids without edits. The third REQ-12 test covers the main behaviours again on real data. Popup drag-rotate, main-view pause and "17 popups keep the context" have no replacement. That code is unchanged, but a human should know.
- **Other specs that depend on the recording's content:** `req-8.spec.ts` expects a "29 mm" proposal and a risk total that rises. `fix-demo-consistency.spec.ts` expects the attack to survive ("71.5%") and the attack text to read as held. If the real recording proposes something else, those fail. The builder must stop and report it, not edit them.
- **Ordering:** the spec fails until REQ-7 (caption, schematic valve, dev-heart root) and the new `demo.json` are merged.
- **Live:** Breaker turns take 95-180 s and REQ-10/11 live checks failed before. The `@live` test allows 15 min and is flagged, not blocking.
