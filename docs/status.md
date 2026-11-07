# Valvular status

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
