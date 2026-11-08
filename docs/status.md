# Valvular status

## Batch 3 (P0 steps 4-6, P1 step 8 backend)

Updated 8 Nov 2026 by the batch integrator on branch `batch-3-integration`, from main at `9b2ec24`. Nothing has been pushed.

### Requirements

| Req | Result | Why |
|---|---|---|
| REQ-6 Fit engine | Passed (re-merged) | Re-merged as `6c59582` (reverts the revert `3a835b6`) after the reduced-motion crossfade fix `ab98d54`. Tag `req-6-pass`. |
| REQ-9 Agent tools | Passed | Merge `cdd2b38`, tag `req-9-pass` on `879e1b5`. Merger saw its spec 34/34 and verify on main green. |
| REQ-10 Breaker agent | Passed, **live check failed** | Merge `4e9b602`, tag `req-10-pass` on `32bd2a0`. Spec 14/14. Live: see below. |
| REQ-11 Fixer and attack loop | Passed, **live check failed** | Merge `fb65558`, tag `req-11-pass` on `f5991be`. Spec 17/17. Live: see below. |
| REQ-13 Hidden scoring and baselines | Passed | Merge `c58ef3f`, tag `req-13-pass` on `e901581`. Spec 12/12. |
| REQ-15 Judge input and replanning | **Failed to merge** | Its spec passed 11/11 in its worktree, but verify on main failed at lint: `src/components/judge/index.tsx:19:83` `react/no-unescaped-entities` on "Judge's valve", added by `1f37c02`. Merge `a38aeac` was reverted as `9b2ec24`. Fix: escape the apostrophe on branch `req-15`, then re-merge. No `req-15-pass` tag. |
| REQ-16 Engineer review | Passed | Merge `4b5b312`, tag `req-16-pass` on `78b833b`. Spec 9/9 on main. |
| REQ-17 Replay | Passed | Merge `f711008`, tag `req-17-pass` on `77fbaab`. Spec 11/11. |
| REQ-7, 14, 18 | Not run | Teammate branches, not merged. |
| REQ-12 | Not run | Still to do. Note: PRD section 1 says P1 starts only after REQ-12 passes. REQ-13, 15, 16 and 17 were run before it. |

Step 3 is still missing REQ-7, and REQ-12 hasn't run, so no new `step-N-pass` tags were added.

### Merged app check

On a build of this branch (port 3030, scripted model, real tools):
- "Break it" posts a demo-mode run to `POST /api/runs` and the feed streams from `/api/runs/<id>/events`. Numbers now come from the real REQ-9 tools: "Starting valve fits 59.8%" (it was a sample 42.8% in batch 2).
- "Fix it" shows the proposal ("Added 29 mm size fits 66.8% (better than 59.8%)"), one `stress_test` attack and a code verdict.
- `/review?run=<id>` shows the change, trade-offs, attack, verdict, what it doesn't show, what wasn't tested, the evidence log, and the Approve and Reject form.
- A replay of `fixtures/replays/demo.json` runs in the workspace with "Replay, not live" and finishes through Fix it.
- No console errors at 1440x900 or 1920x1080.

**One fix in this batch** (`src/components/controls/demo-script.ts`, REQ-8's file). The button script came from before REQ-9 and REQ-11. Its proposal had no claim, and its "attack" was an `evaluate_design` call, so every button run ended with verdict `invalid_experiment` ("the proposal has no claim to test"). The script now submits a structured claim (`fitPct >= 66.75`), attacks with `stress_test` (1 mm `measurement_shift`, with a hypothesis and `disprovedIf`) and sends `demo: true`. The run now ends `supported_under_conditions` (the attack survived: 71.5% after the shift). `scripts/screenshot-batch-3.mjs` reproduces the screenshots.

### Tests actually seen

`npm run verify` in the batch-3 worktree (port 3030, one worker, through the memory gate) exited 0. Typecheck, lint (0 errors, 2 warnings: unused `thoughtSignature` in `research_notes/Valvular build/res-2/run.mjs` and unused `feed` in `scripts/screenshot-batch-2.mjs`), `data:check` and build passed. Playwright: **218 passed, 2 skipped, 0 failed** in 4.2 minutes.

| Spec | Passed | Skipped |
|---|---|---|
| req-1 | 28 | 2 (`replacedBy`: the wall to REQ-4, the feed to REQ-8) |
| req-2 | 17 | 0 |
| req-3 | 18 | 0 |
| req-4 | 28 | 0 |
| req-5 | 20 | 0 |
| req-6 | 9 | 0 |
| req-8 | 1 | 0 |
| req-9 | 34 | 0 |
| req-10 | 14 | 0 |
| req-11 | 17 | 0 |
| req-13 | 12 | 0 |
| req-16 | 9 | 0 |
| req-17 | 11 | 0 |

`test:gpu` and `test:live` weren't run by the integrator.

### Live checks (from `docs/live/`)

- **REQ-10** (`docs/live/req-10.md`): Done when 7 passed (2.7 min). Done when 8 failed: the first valve's turn hit the 180 s limit. Done when 9 failed: 4 of 10 runs finished (needs 9); 5 hit "More than 16 tool calls in one turn" and 1 hit 180 s. Slowest run 180 s, slowest finished 162 s. 12 recordings saved.
- **REQ-11** (`docs/live/req-11.md`): Done when 8 failed after 7.3 min: the round-1 attack turn hit the 16 tool-call limit, so no second Fixer step ran. Done when 9 didn't run (serial suite). Run time 437 s, against the 1-2 minute target. 1 recording saved.
- REQ-15's spec includes one `@live` test, and it passed in the req-15 worktree (one real Gemini call). That branch isn't merged.
- Common cause for a human to decide: on live Gemini the Breaker routinely needs more than 16 tool calls per turn and turns take about 2.5 min. The budget is set in PRD section 3. The options are to raise the budget, tighten the Breaker prompt, or use RES-2's fallbacks (lower thinking, a faster model, replay).

### Visuals flagged

Screenshots are in `docs/ui-review/batch-3/`: during and after Break, during and after Fix, `/review` (full page), and a replay during and after, each at 1440x900 and 1920x1080. They were taken with software WebGL.

1. **The feed still doesn't scroll.** After Fix it, the proposal, attack and verdict are below the fold at both sizes; only the wall totals change visibly. Open since REQ-8 (`src/components/feed/index.tsx`).
2. **The wall disagrees with the feed.** The wall still shows the REQ-1 sample fixture (Fit 219 / Risk 90 / No fit 91, going to 211 / 98 / 91), while the feed shows real tool numbers (59.8% to 66.8%, 18 new at-risk hearts). Both are labelled, but side by side they contradict each other. Wiring the wall to `/api/fit` is REQ-12's job.
3. **Scripted button runs show "Replay, not live"** and "Sample data" on the feed, because scripted events are `mode: "replay"`. That's correct labelling, but the presenter should know the buttons aren't live until REQ-12 wires Gemini.
4. **Nothing in the workspace links to `/review`.** The review only opens with `?run=<id>` typed by hand; the header link opens an empty review. REQ-19 connects the flow.
5. The attack finding text ("Hearts near 27 mm now sit at the size edge") is scripted and reads like a break, while the code verdict says the attack survived.
6. Still open: the 3D root doesn't react to the run (REQ-7), "(show)" text toggles, repeated actor labels, and the batch-1 and batch-2 audit items.

### Still sample data

- Wall statuses, totals, hover card and popup measurements: REQ-1 fixture on real thumbnails and meshes (until REQ-12).
- Button runs use the scripted model (real tools, recorded calls), labelled "Replay, not live". No live Gemini from the buttons yet.
- New amber hearts on the wall: the wall goes from Risk 90 to 98, so 8 dots turn amber. That matches the 8 fixed IDs in `sample-new-risk.ts`, not the 18 real new-risk hearts (`heart-NNN`). The wall is keyed by `sample-NNN` IDs, so real IDs can't land on it until REQ-12.
- The main root view is still `public/fixtures/root-sample.glb`, with no schematic valve (REQ-7).
- `/results` and `/about` are still REQ-1 placeholders (REQ-14, REQ-18).

### What's left

1. Fix REQ-15's lint error on its branch and re-merge.
2. Merge the teammate branches REQ-7, REQ-14 and REQ-18 when they're pushed (rebase, verify, `merge --no-ff`).
3. Decide on the live budget problem (REQ-10 and REQ-11 live failures) before REQ-12's `@live` check.
4. REQ-12 core demo end to end, run alone. It's the stop point for a human check. It also needs to fix flagged items 1, 2 and 4.
5. Then REQ-19 (run alone), then REQ-20.
6. Still open from earlier batches: the `@gpu` lag test, the `heart.glb` licence before any push, and the Gemini tier limits.

---

## Batch 2 (P0 step 3)

Updated 7 Nov 2026 by the batch integrator on branch `batch-2-integration`, from main at `054e4df`. Nothing has been pushed.

### Requirements

| Req | Result | Why |
|---|---|---|
| REQ-6 Fit engine | **Failed to merge** | The branch passed its own spec (R6-1 to R6-9) plus the req-1 smoke test: 38 passed, as reported by the merger and not rerun here. Main's verify after the merge had one failure, `req-3.spec.ts:804` "reduced motion › replaces the zoom with a short crossfade" (2551 ms against a 2000 ms limit). The same test also failed on main before the merge (2291-2350 ms), so REQ-6 didn't cause it. The merge `af0db9d` was reverted as `3a835b6`. To re-merge, first revert `3a835b6`. Branch `req-6` is still at `f089cb9`, with no `req-6-pass` tag. |
| REQ-7 Valve in the root | Not run | A teammate's branch. It hasn't been pushed or merged. |
| REQ-8 Agent feed and buttons | Passed | Merged as `054e4df`, tag `req-8-pass` on `b498bd0`. Visual audit had Clarity at 3: `docs/ui-review/req-8/flagged.md`. |

The agent chain stopped after REQ-6, so REQ-9 onward hasn't started. Step 3 isn't complete, so main has no `step-3-pass` tag.

### Merged app check

On a build of this branch (port 3020, scripted model):
- "Break it" starts a run through `POST /api/runs`. The button stays disabled, and Breaker steps stream into the feed (`/api/runs/<id>/events`).
- When the Break finishes, two named findings appear ("Annulus above the largest size", "Thin overlap between sizes") and "Fix it" is enabled.
- "Fix it" adds a proposal, two Code evaluations and one attack to the feed. Wall totals go from Fit 219 / Risk 90 / No fit 91 to Fit 211 / Risk 98 / No fit 91.
- No console errors at 1440x900 or 1920x1080.

Nothing needed fixing, so batch 2 changes no app code.

### Tests actually seen

`npm run verify` in the batch-2 worktree (port 3020, one worker, through the memory gate) exited 0. Typecheck, lint (0 errors, 1 warning: unused `thoughtSignature` in `research_notes/Valvular build/res-2/run.mjs`), `data:check` and build all passed. Playwright: **112 passed, 2 skipped, 0 failed** in 4.2 minutes. In this run the req-3 reduced-motion test passed.

| Spec | Passed | Skipped |
|---|---|---|
| req-1 | 28 | 2 (`replacedBy`: the wall to REQ-4, the feed to REQ-8) |
| req-2 | 17 | 0 |
| req-3 | 18 | 0 |
| req-4 | 28 | 0 |
| req-5 | 20 | 0 |
| req-8 | 1 (the whole Break and Fix flow) | 0 |

There's no req-6 spec on main, because the merge was reverted. `test:gpu` and `test:live` weren't run.

### Live checks

There's no `docs/live/` folder and no `@live` spec yet. REQ-10, 11 and 12 haven't been built, so there are no live results to record.

### Visuals flagged

Screenshots are in `docs/ui-review/batch-2/`: idle, during Break, after Break, during Fix and after Fix, each at 1440x900 and 1920x1080. They were taken with software WebGL, and `scripts/screenshot-batch-2.mjs` reproduces them.

1. **After Fix it, the feed doesn't scroll.** At 1440x900, `5-after-fix` looks the same as `3-after-break`: the proposal and the attack are below the fold. At 1920x1080 only "Fixer: Checking a wider range." shows. Only the wall totals change visibly. This is REQ-8 audit item 1 and is still open (`src/components/feed/index.tsx`). It's the most visible demo issue.
2. The scripted Break finishes in about a second, so `2-during-break` already shows the finished Break.
3. The 3D root doesn't react to the run. The leaflets still read as one grey crumpled bowl. This waits on REQ-7.
4. The rest of the REQ-8 audit list is still open: "(show)" text toggles, repeated actor labels, findings and attacks that look alike, "[Sample data]" inside the event text, and no marker on newly amber dots. Batch-1 items 1-6 also still stand.

### Still sample data

- Wall statuses, totals and popup measurements come from the REQ-1 fixture, matched to real REQ-2 thumbnails and meshes. Real fit results need REQ-6.
- Feed events come from the scripted model running stand-in tools. Each evaluation is tagged "[Sample data]" (for example, "Starting valve fits 42.8%"). Real tools need REQ-9.
- The main root view is `public/fixtures/root-sample.glb`, there's no schematic valve, and "Open in main view" doesn't change the mesh (REQ-7).

### Morning checklist

1. Decide on the req-3 reduced-motion timing test, `req-3.spec.ts:804`. It fails at about 2.2-2.5 s against a 2 s limit on a loaded machine, and passed here. Either fix the crossfade in `src/components/heart-scene/` or rule on the spec. Builders may not weaken it.
2. Re-merge REQ-6: run `git revert 3a835b6` on main, then verify. If it's green, tag `req-6-pass`.
3. Merge the teammate branches `req-7`, `req-14` and `req-18` when they're pushed. Rebase each one, run verify, then `merge --no-ff`.
4. Fix the feed auto-scroll (flagged item 1) before any demo.
5. Run REQ-9, 10 and 11, then REQ-12 on its own. REQ-12 is the stop point for a human check.
6. Still open from batch 1: the `@gpu` lag test, the licence for `heart.glb` (before any push), and the Gemini tier limits.

---

# Batch 1 (P0 step 1 and step 2)

Updated 7 Nov 2026 by the batch integrator on branch `batch-1-integration`. Nothing has been pushed.

## Requirements

| Req | Result | Notes |
|---|---|---|
| REQ-1 Foundation | Passed (spec and verify) | Merged as `9a21053`, tag `req-1-pass`. Visual audit did not reach 4 on every score; findings in `docs/ui-review/req-1/flagged.md`. One REQ-1 test (`wall shows 400 sample dots`) is skipped on purpose by its own `replacedBy(4)` rule, now that REQ-4 owns the wall. |
| REQ-2 Test heart data | Passed | Merged as `750bdee`. `data:check`: source MD5 matches, split identical on rerun, 400 dev / 100 hidden, no overlap, matching annulus bands, 116 left out at 21-27 mm and 59 at 21-29 mm, all 500 table rows match their meshes (max residual 2.62 mm against a 4 mm threshold, r = 0.95). |
| REQ-3 Heart and zoom | Passed, except the `@gpu` check | Merged as `490a63b`. Check 9 (`@gpu` performance) has not been run: **pending** for a human. Check 10 (audit at least 4) not met; see below and `docs/ui-review/req-3/flagged.md`. |
| REQ-4 Wall and heart panel | Passed (spec and verify) | Merged as `0c1eddf`. Audit did not pass: `docs/ui-review/req-4/flagged.md`. |
| REQ-5 Agent loop | Passed | Merged as `f56f887`. Scripted model only; no Gemini calls. |

None are BLOCKED. Step tags on main: `step-1-pass`, `step-2-pass`.

## What batch integration changed

- `src/components/wall/data-source.ts`: the wall and popup now use the real REQ-2 thumbnails and meshes from `GET /api/hearts`, matched to the 400 sample rows by position. Sample IDs, measurements and statuses stay, labelled "Sample data", until REQ-6. If the API fails it falls back to the fixture images.
- `scripts/screenshot-batch.mjs`: reproduces the screenshots in `docs/ui-review/batch-1/`.
- `research_notes/Valvular build/`: RES-2 and RES-3 notes committed (see below).

The main root view still loads `public/fixtures/root-sample.glb` (virtual cohort `Case_1`). Switching it to the median-annulus dev heart is REQ-7's job, and the leaflet split is tuned to this mesh.

## Tests actually seen

`npm run verify` in the batch worktree, port 3020, one Playwright worker: **exit 0**. Typecheck, lint, `data:check` and build passed. Playwright: **112 passed, 1 skipped, 0 failed** in 4.2 minutes.

| Spec | Passed | Skipped |
|---|---|---|
| req-1 | 29 | 1 (`replacedBy(4)`) |
| req-2 | 17 | 0 |
| req-3 | 18 | 0 |
| req-4 | 28 | 0 |
| req-5 | 20 | 0 |

Not run: `npm run test:gpu` (the `@gpu` lag test in `req-3.spec.ts`) and `npm run test:live`. There are no `@live` specs yet.

Log: the integrator's scratchpad `batch1-verify.log` (not committed).

## Visual audit, batch 1

Screenshots: `docs/ui-review/batch-1/`, at 1440x900 and 1920x1080. They were taken with software WebGL (SwiftShader), so lighting and edges can differ on a real GPU. Earlier rounds did not save numeric scores in the repo, so these scores are the integrator's own reading of the batch screenshots, from 1 to 5.

| Screen | First impression | Clarity | Craft | 3D quality | Restraint |
|---|---|---|---|---|---|
| Opening | 4 | 4 | 4 | 4 | 5 |
| Mid-zoom | 3 | 3 | 4 | 3 | 4 |
| Workspace | 3 | 3 | 3 | 3 | 4 |
| Expanded wall | 3 | 3 | 4 | n/a | 2 |
| Popup | 4 | 4 | 3 | 3 | 4 |

Every screen except the opening has a score under 4, so the batch **does not pass the visual audit**. The flagged items:

1. Workspace: the leaflets read as one grey bowl instead of three solid, light cusps. The sample mesh is one welded surface. This is blocked on REQ-7.
2. Mid-zoom: the faded heart sits over the root, and the root is barely visible yet. It doesn't read as one move into the aorta.
3. Workspace: "29 mm" and "1 mm" in the feed have uneven spacing. The dashed "Fix it" doesn't match "Break it". There's empty space under the feed, mostly at 1920.
4. Expanded wall: a saturated border and a status dot on every thumbnail make it read as 400 coloured boxes. Only about 11 of 21 rows show without scrolling at 1440.
5. Popup: "Drag to rotate" is set in mono, and the 3D view stops short of the button row.
6. Honesty: the hover card and popup show a sample ID and sample measurements beside a real heart's thumbnail and mesh. All of it is labelled "Sample data", but the ID doesn't match the image until REQ-6 brings real results.

Older findings are still in `docs/ui-review/req-1/flagged.md`, `req-3/flagged.md` and `req-4/flagged.md`.

## Research decisions

**RES-2: Gemini tool calls** (`research_notes/Valvular build/RES-2.md`). The agent design holds. For REQ-10, use `gemini-4-argon` through non-streaming `generateContent`, thinking level `low`, tool mode `ANY`, and a 60 s step timeout with one retry. If the retry fails, fail clearly and offer the replay. In 20 runs, no tool call broke the schema. 8 of 8 low runs succeeded, and 3 of 92 requests timed out at 120 s. One Breaker turn takes about 1 minute, so the full loop won't fit live in a 4-minute pitch. Show one live Breaker turn and labelled replay for the rest. The number guard must also read numbers inside text such as `16-18`. Tier and rate limits are not confirmed: a human must check AI Studio. The notes contain no key: `run.mjs` reads it from `.env.local` at runtime.

**RES-3: heart model** (`research_notes/Valvular build/RES-3.md`). Use NIH 3D 3DPX-022787, which is now `public/models/heart.glb`. The aortic valve target is about `(0.08, 0.00, 0.03)` in model units. **Licence warning:** NIH 3D lists the model as CC0, but its internal names show it was made with the Tripo AI generator. If the uploader used Tripo's free plan, the CC0 may not hold. Don't push the repo, host it or make it public with this file until the creator confirms a paid plan. The fallback is Sketchfab Freddan755 (CC BY 4.0). Raw downloads stay in `data/raw/` and are not committed.

## Pending

- **`@gpu` lag test (REQ-3 check 9):** pending, for a human to run with nothing else running. See below.
- REQ-3 check 10 and REQ-4: visual audit scores still under 4 (above).
- Licence confirmation for `public/models/heart.glb` before any push.
- RES-2: confirm the Gemini tier and rate limits.
- Step 3 (REQ-6, REQ-7, REQ-8) has not started.

## How a human runs and checks the app

From the main checkout, with `data/raw/verstraeten.zip` in place:

```bash
cd /Users/mohammadallahham/Desktop/code/hackathon-agentverse
npm ci
npm run build
npx next start -p 3000
```

Open http://localhost:3000 in Chrome at 1440x900 or larger, then check:

1. The beating heart, labelled "Illustrative", with a scroll cue and "Zoom to valve".
2. Scroll halfway and stop: the zoom holds. Scroll fully: the root, wall, feed and controls appear. Scroll up: it reverses.
3. Drag the root to rotate it. "Zoom to valve" and the arrow keys do the same as scrolling.
4. Hover a dot to see a real root thumbnail. Click "Expand" to see all 400. Click a red dot: the popup shows a rotatable root, measurements and the failed rule. Esc closes it.
5. "Sample data" appears on the wall, the feed and the popup, and "Synthetic test hearts" on the workspace.

Full checks: `npm run verify`, which uses port 3000 unless `PORT` is set.

Lag test, after quitting other heavy apps: `npm run build && PORT=3000 npm run test:gpu`. It opens a visible Chrome window and checks the brief's targets: at least 55 fps on average, a 95th-percentile frame under 25 ms, and no more than 2 frames over 50 ms during a zoom.

## Gaps

- Fit statuses, totals, measurements in the popup, and the feed are all sample data. Real fit results arrive with REQ-6, and real events with REQ-8 and REQ-12.
- "Open in main view" sends the heart ID, but the main view doesn't load that heart's mesh yet (REQ-7).
- No schematic valve yet (REQ-7). "Break it" and "Fix it" are disabled.
- Screenshots and Playwright runs used software WebGL, so real-GPU looks and frame rates are unverified.
- The audit scores above come from one integrator pass, not from a separate auditor's rounds.
