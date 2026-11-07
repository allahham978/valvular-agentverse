# REQ-3 plan: Heart and zoom (attempt 2)

Attempt 1's Builder died with nothing committed and no scene code written. This plan makes a second death cheap: reuse what exists, work in small milestones and commit after each one. See `docs/prompts/req-3.md`.

## Status of the model

RES-3 does **not** recommend the fallback, so this builds the opening on the real heart: NIH 3D 3DPX-022787.

**Licence hold:** NIH lists it as CC0, but its internal names show it was made with Tripo AI, and Tripo's free-plan terms may invalidate that. Local commits are fine. **`public/models/heart.glb` must not be pushed, hosted or made public** until the creator confirms a paid plan and no third-party input image. If that can't be cleared, swap to Sketchfab "Human heart" by Freddan755 (CC BY 4.0, login needed, valve location must be measured). Repeat this hold in your result, so the Merger and the human see it before pushing is turned on.

All the RES-3 values you need are in this plan. Don't re-read RES-3 unless a value here looks wrong (`research_notes/` isn't in this worktree; it's in the main checkout).

## How to work

These rules are the fix for attempt 1, so follow them exactly.

**Mac load.** One Playwright worker. Let Playwright start and stop `next start` on port 3003, so no server outlives a run. Don't start `next dev`. Check that port 3003 is free before you start and when you finish.

**Testing.**
- Run only the current milestone's tests, with `--grep`. Run the whole spec once, at M6. Never run `npm run verify` before M6.
- Rebuild with `npx next build` only when source changed since the last build.
- Start any run likely to take over 2 minutes in the background, and wait for its exit notification. Never poll in a loop.
- `PORT=3003 npx playwright test tests/e2e/req-3.spec.ts --workers=1 --grep "<pattern>"`

**Commits.** Commit when a milestone's tests pass, before starting the next. If a milestone is taking long, commit working partial progress anyway. Uncommitted work is what attempt 1 lost.

**Attempts.** After 3 failed runs of the same test, stop changing code at random: read the failure's screenshot and `error-context.md`. If the spec is truly wrong, stop and report it. Don't edit it.

## Milestones

| # | Build | `--grep` |
|---|---|---|
| M0 | Restore the asset work (below) and commit | `heart model file` |
| M1 | Scene hook, heart, beat, turn, opening UI and shared lighting | `opening` |
| M2 | Root split, then input, smoothed progress, camera path and fades | `scroll zoom` |
| M3 | Button and arrow keys | `stage backup` |
| M4 | Reduced motion | `reduced motion` |
| M5 | Drag, render modes, pixel cap | see below |
| M6 | Whole spec, `npm run verify`, screenshots for the auditor | no filter |

M5's filter is `--grep "dragging rotates|rendering rules|canvas capture"`. Don't filter on `root`, because that matches most of the spec.

`scroll down fully` needs the root split, so do that first in M2. The on-demand checks in `scroll zoom` also need the render switch, which belongs to M2 even though the rest of the rendering work is M5.

**M0, don't redo this work.** Attempt 1's asset files are complete and already meet the file tests (74,996 triangles, 37,476 vertices, 329 KB):

```sh
git checkout failed/req-3-1 -- public/models scripts/models src/components/root-view/leaflets.ts
```

Rerun `npx tsx scripts/models/build-heart.ts` only to change the tint. `leaflets.ts` has not been run in the browser, so test it in M2. No other code from attempt 1 exists.

## How it fits the system

- `HeartScene` keeps the one `Canvas`. REQ-7 replaces what's inside `root-view` and `valve-model`, and REQ-4 and REQ-8 only add panels, so `RootView` keeps its export and its place in the scene.
- `src/state/stage.ts` stays the single source of truth. It holds the **smoothed** progress, and camera, fades, beat and panels all derive from it. `tokens.css` shows panels at exactly 1, so progress must land on exactly 0 and 1.
- `/?stage=workspace` must keep opening at 1. `StageGate` sets it in a layout effect that runs after its children's, so read the initial target in a passive effect or the first frame, not in a child's layout effect.

## Approach

**One world, real scale.** The move feels continuous because heart and root share one anatomical scale.
- The root sample is 65.8 mm long and drawn 2.7 world units long, so 1 world unit is about 24.4 mm. One heart unit is about 225 mm, so scale the heart by about **9.2**.
- `heart-valve` marker at model `(0.08, 0.00, 0.03)`, ±0.03. Valve axis `(0.024, 0.932, 0.361)`. Model +X is the front of the heart, so a parent group yaws it towards the camera and tilts the valve axis to world up.
- Position the heart so the marker sits on the root's **leaflets, not its centre**: about world `(0, -0.53, 0)`.
- The camera ends at `RootView`'s framing, `(0, 0, 6)`, fov 35. It starts about 17 units back, with the whole heart filling the screen. It stays outside the heart's shell, so the heart has to fade to reveal the root.
- The GLB's node has a quantisation scale and translation. Never read model coordinates from its raw geometry, and put the marker on the `heart-model` group. Don't recentre or rescale the model.

**Input.** A native wheel listener on `scene-area` sets a target progress, about 2400 px of wheel for the full range. Panels are siblings of `scene-area`, so wheel events over a panel never reach it, which gives "scrolling over a panel scrolls that panel only" for free. A `useFrame` damp (`MathUtils.damp`, time-based, never per-frame) moves progress towards the target and snaps within 0.001. The button sets the target to 1. Arrow keys on `window` step the target: Down and Right go in, Up and Left go out. Ignore keys when focus is in an input, textarea, select, slider or contenteditable, because REQ-8 and REQ-15 add those.

**Why not drei `ScrollControls`:** it adds its own scrolling overlay above the canvas, which steals wheel events from panels and breaks REQ-1's canvas-topmost check, and `main` is `fixed`. This is a small input handler, not a custom camera system.

**Camera.** drei `CameraControls`, with `lerpLookAt(heart pose, root pose, progress, false)`, wheel set to `NONE`, and rotation only at progress 1. Drag orbits the root. When progress leaves 1, capture the current camera as the path's root pose, so scrolling back after a rotate doesn't jump. Reset it at 0.

**Materials and motion.**
- Heart: `MeshPhysicalMaterial`, satin red-pink, `vertexColors`, soft clearcoat. To fade without sorting glitches, use a depth-only pass (`colorWrite: false`), then the colour pass.
- Fades: heart `1 → 0` and root `0 → final`, both strictly mid-fade across progress 0.4 to 0.6, because the spec checks this. Set the heart `visible = false` once faded, but keep it mounted.
- Beat and turn are code-driven: about 60 bpm, scale pulse under 8%, turn at most **±35° about the front** (the back is weak). Both multiply by an ease that reaches 0 by progress 1.
- One shared lighting setup: move the existing `Environment` and lights so both models use them. The heart's `ContactShadows` fades out and the root's fades in, each baked once with `frames={1}`.
- The opening button and cue should fade with progress early in the zoom, using their own inline opacity. `.stage-opening` alone only hides them at exactly 1.

**Solid leaflets.** The root mesh is one connected component that contains the leaflets, and `splitLeaflets` in `leaflets.ts` separates them by a radial test.
- `RootView` uses it to make two meshes: `root-wall` (keep the existing two-pass back and front translucent wall) and `root-leaflets` (solid, light, opaque at progress 1).
- Render order: back wall, leaflets, front wall. Depth-write stays off on the wall.
- REQ-1's plan handed this to REQ-7, but REQ-3's Done-when 3 and the brief need it now. REQ-7 inherits it.

**Rendering.** `frameloop="always"` while beating or moving, and `"demand"` once settled at 1, with `invalidate()` on wheel, key and drag. Dpr `[1, 2]`, `AdaptiveDpr`, `PerformanceMonitor`. Heart and root each sit in their own `Suspense` so the heart doesn't wait for the root, but start loading both at once, because the spec expects both requested from `/`. Use `/fixtures/root-sample.glb` until REQ-2 merges; REQ-7 switches it. Software WebGL will trigger `PerformanceMonitor`: make sure it can't keep waking the scene once settled, or "renders on demand" fails.

**Reduced motion.** No scrub and no camera travel. Any wheel, button or arrow input runs a time-based crossfade of about 400 ms between the two end poses, using the same scene opacities, and progress ends on exactly 0 or 1. Stop the beat and turn too: a brief-level reading, not tested.

**Opening UI**, DOM inside `scene-area`, with `stage-opening`: a small scroll cue (`data-testid="scroll-cue"`) and a small "Zoom to valve" shadcn/ui `Button`. Keep both clear of the point at 35% width and 50% height, which REQ-1 checks. The name and "Illustrative" already exist in `page.tsx`.

## Test contract

Tests run under software WebGL and need to read the real scene. Set this once in `heart-scene`, and keep it in production builds. It costs nothing unless read:

```ts
window.__valvular = { scene, camera, frames, firstHeartFrameMs };
```

- `frames` counts `useFrame` calls. `firstHeartFrameMs` is `performance.now()` at the first frame with the heart drawn. Update both as the scene runs.
- Named objects: `heart-model` (`scale.x` is the beat, 1 at rest; `rotation.y` is the turn, 0 at the front; base scale, yaw and tilt go on a parent), `heart-valve` (child of `heart-model`), `root-wall`, `root-leaflets`. REQ-7 must keep these names.
- The heart stays mounted on `/?stage=workspace`, or the probe never reports ready.

## Spec notes

- Tests check behaviour: wheel, click, keys, pixels and the real scene graph. Wheel distances aren't assumed, beyond the full range taking more than two ticks.
- **Viewports:** behaviour runs at 960x600 to limit software rendering load. The panel-scroll, canvas-capture and `@gpu` tests run at 1440x900.
- **Time to heart:** the non-GPU test allows 5 s, because software rendering on a shared machine is slow. `@gpu` enforces the brief's 3 s.
- **Done-when 9 (`@gpu`) is written but not run here. Report it as pending.** `test:gpu` opens a headed browser, and only a human or the Merger runs it.
- **Done-when 10** is the visual auditor's job. Save heart, mid-zoom and workspace screenshots at 1440x900 and 1920x1080 to `docs/ui-review/`.

## Files

- `src/components/heart-scene/*`, `public/models/heart.glb`, `public/models/heart.credit.txt`, `tests/e2e/req-3.spec.ts` (written, don't edit)
- `docs/plans/req-3.md`, `docs/prompts/req-3.md` (Planner only)

**Outside the PRD's file list, and why**
- `src/components/root-view/index.tsx`, `src/components/root-view/leaflets.ts`: root fade, wall and leaflet split, object names. The scene can't fade or split the root from outside without reaching into its materials. Keep the change minimal.
- `scripts/models/build-heart.ts`: makes the GLB reproducible, as `build-root-sample.ts` does for the root. `data/raw/` is never committed.

Don't touch `page.tsx`, `tokens.css`, `stage.ts` or `stage-gate.tsx`. If one seems necessary, report why.

## Risks

- **Another Builder death:** the cause of the last one is unknown. Milestone commits limit the loss, and a new attempt resumes from the last commit rather than from zero.
- **Licence:** the one item that can force a model swap. Keep the valve coordinates and scale as named constants, so a swap only changes those.
- **Valve position is an estimate:** ±0.03 units and about ±15° on the axis. Good for a target that fades, but never show it as a measurement.
- **Close-up seams and a weak back:** the heart must be mostly faded before aorta seams fill the screen, and the turn stays within ±35°.
- **Leaflet split is a heuristic:** check it on screenshots at several angles, including the jagged rim where leaflets meet the wall. Only the sample root has been used in the browser path.
- **Aorta tint:** the salvaged colours haven't been reviewed on screen. RES-3's first test colour was barely visible, so check this at M1 and change only the constants in `build-heart.ts`.
- **Re-renders per frame:** `useCentreInFreeArea` and `StageGate` re-render on every progress change. Keep the heart and its memoised geometry out of those paths, and read progress in `useFrame` with `getStageProgress`, not the hook.
- **Polish time:** this is the centrepiece, but tests come first. Get M0 to M6 green and committed, then polish for the auditor. Don't polish between milestones.

## Round 3 decisions

- **Lighting:** the scene keeps drei `Environment` built from `Lightformer`s rather than a local HDRI file. No licensed HDRI is in the repo, the Lightformer set costs no download and no asset licence, and one shared setup lights the heart and root. Swap in an HDRI only if the highlights need it.
- **Heart shadow:** the heart keeps a gradient sprite, not `ContactShadows`. The heart beats and turns, so a shadow baked once with `frames={1}` would be stale straight away. The root uses `ContactShadows` with `frames={1}` because it is static.
- **Root axis and landing:** `VALVE_AXIS` is tilted about 10 degrees (z 0.361 to 0.18), inside the plan's 15 degree tolerance, so the root continues along the tinted aorta at 0.4 to 0.6. The root lands rotated 1.4 rad about the vertical, because the flat step in the sample mesh rim is in the source mesh and faces away from that view.
- **Not done:** aorta tint seam softening in `build-heart.ts`, and the ragged white rim where leaflets meet the wall.
