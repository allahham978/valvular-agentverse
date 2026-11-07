# Valvular status: batch 1 (P0 step 1 and step 2)

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
