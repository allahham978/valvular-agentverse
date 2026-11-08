# REQ-7 plan: Valve in the root

## Approach

The single canvas stays in `heart-scene` and renders `RootView`, which renders `ValveModel`. `createWallMeshes` stays exported for the heart popup.

1. **Which heart.** `RootView` reads `useMainHeartId()`. It resolves the selection to a real synthetic heart through `meshUrl`: wall heart (`useWallData().hearts`) → `meshUrl` → the `/api/hearts` heart with that `meshUrl`. This works for today's `sample-NNN` wall and for the real `heart-NNN` wall REQ-12 may bring. With no selection it shows the landing root (`/fixtures/root-sample.glb`, the same bytes as `heart-001`), so it shows `heart-001`. The landing heart doesn't change, so REQ-3's tuning holds.
2. **Fit results, no fake data.** The current design is the latest revealed `proposal` event's `data.design` from `useRun()` (feed run-store), or `STARTING_VALVE`. A small module cache POSTs `/api/fit {design, parent}` once per design id and reads the heart's `FitResult` (status, `sizeMm`, reasons) from the REQ-6 engine.
3. **Mesh switch.** `useGLTF(meshUrl)` on selection, with no reload. The last root stays on screen until the next one has loaded, so there's no blank frame. Then the previous URL is released with `useGLTF.clear`, so only one main root is loaded at a time. `buildRoot` keeps the `root-wall`/`root-leaflets` names and puts `userData.heartId` on the wall meshes.
4. **Valve (`valve-model`).** It's a solid schematic valve in accent `#0F766E`: a short open stent ring (cylinder or torus band) with three thin commissure posts. Its material is opaque with `depthWrite` on. It's a child of the root clone, in the GLB's millimetre space (the heart GLBs are in mm), so its outer diameter is `sizeMm`, in true proportion to that root. It sits at the annulus, centred on the leaflets, with its axis along the root's long axis (X). The group is named `schematic-valve`, with `userData {sizeMm, designId}`. A `no-fit` heart (no `sizeMm`) shows the design size closest to its measured annulus. It fades with the root the same way as the leaflets (depthTest off while over the heart, opaque at full).
5. **Problem tint.** The wall gets a vertex `color` attribute: white where it's fine, soft red (`no-fit`) or amber (`risk`) on the band of the failed rule. The `annulus-coverage` band is at the annulus/leaflet base. The `outflow-*` band is the sinus to STJ, above the leaflets. Edges are smoothed over a few vertices. The tint sits on the existing two-pass wall, so there are no new transparent meshes and no new sorting problems. Vertex alpha (or a higher wall opacity in the band) makes the tint visible through a 0.16 wall. A `fit` heart has no tinted vertices.
6. **Caption.** `RootCaption`, exported from `root-view`, is rendered by `heart-scene/index.tsx`: one line plus the JSX, because HTML can't live inside the canvas. It's a small `stage-panel` chip in a place no panel covers (top-centre, below the header). It shows `Schematic valve`, the heart ID, the status (`Fit` / `Risk` / `No fit`, the `STATUS_META` labels), the failed rule in one line if any, and `Synthetic heart`. `data-testid="main-view-status"`, `data-selected-id`, `data-heart-id`, `data-status`.
7. Use `invalidate()` when the heart or design changes, for on-demand rendering.

## Files

- `src/components/root-view/index.tsx`, plus new `use-main-root.ts` (selection → heart, design, fit result) and `tint.ts` (vertex colours)
- `src/components/valve-model/index.tsx`
- `src/components/heart-scene/index.tsx`: render `<RootCaption />` only (outside the listed files, needed for an HTML caption)
- `tests/e2e/req-7.spec.ts`

No new dependencies. No changes to `page.tsx`, the wall, the engine or the PRD.

## Tests (`tests/e2e/req-7.spec.ts`)

| Test | Done when |
|---|---|
| `Done when 1: zooming to the valve shows the root and a schematic valve` | 1: "Zoom to valve" from `/` reaches progress 1. One `schematic-valve`, visible, opaque, colour equal to the `--accent` token, design `start`, `sizeMm` equal to the engine's, diameter 0.85–1.3 × `sizeMm` in root mm, at the leaflets. Leaflets opaque, light and solid; every wall pass opaque, or translucent with no depth write, one side, back faces drawn before front. The `main-view-status` caption shows "Schematic valve" and isn't covered. Teal pixels on screen, and the valve still visible, opaque and on screen after a drag rotation. |
| `Done when 2: selecting another heart changes the mesh with no page reload` | 2: through the wall popup "Open in main view", `root-wall` `heartId` and geometry change. Wall mesh count is unchanged (one root). A per-frame recorder sees at most one heart, no extra walls or leaflets and one valve during the switch, and the previous wall geometry is disposed. No navigation, and the window marker survives. |
| `Done when 3: changing the design changes the valve size` | 3: shows a heart whose size differs between `start` and `demo-wider`, then Break it → Fix it (REQ-8's scripted run submits `demo-wider`; no other way to change the design exists yet, so `RUN_TIMEOUT` is 150 s and the dependency is noted in the spec). Valve `designId` becomes `demo-wider`, `sizeMm` the engine's, drawn diameter ratio within 10 % of the size ratio, caption status follows. |
| `Done when 4: a red or amber heart shows its problem area tinted, its status and 'synthetic heart'` | 4: a fit heart has a tint share of 0 (baseline). A red/amber wall heart that's `no-fit` gets a red tint, and a `risk` one an amber tint, on 1–60 % of the wall. The caption shows the ID, status and "synthetic heart" and isn't covered. The status tokens are checked to be red for no-fit and amber for risk. Warm pixels exceed the fit baseline by 0.15 %. |
| `@gpu rotating the root with the valve meets the brief's performance targets` | 5: real GPU. Time to a visible heart under 3 s; beating at `/` with the root and valve loaded; landing root and every heart `meshUrl` under 300 KB; then a red/amber heart with the valve. Beating, rotation and zoom: average ≥ 55 fps, p95 < 25 ms, at most 2 frames over 50 ms in the zoom. A human runs it. |

The specs need no key or network: Break it/Fix it run the scripted demo model. All waits are `expect.poll` on state with long timeouts, with no fixed sleeps. `showInMain` tries the likely dots first (same id, or same position while the wall is sample data) and checks the main view's own `data-heart-id`, so it works before and after REQ-12.

## Risks

- **Sample wall vs real engine.** Until REQ-12 the wall's colours are sample data, so a red dot can show a heart that fits in the main view. The main view always tells the truth from the engine. REQ-12 resolves the mismatch.
- **Tint visibility** on a 0.16-opacity wall in SwiftShader. Needs vertex alpha or a stronger band. Check the pixel test early.
- **REQ-3 spec** depends on `root-wall`, `root-leaflets`, `heart-valve` and the fade behaviour. Keep the names and the `setOpacity` logic, and run `req-3` and `req-4` (popup uses `createWallMeshes`, wall-only) as a smoke test.
- **Mesh switch while paused.** The popup pauses the main canvas. The switch happens after it closes, so poll scene state, not frames.
- **Design brief:** "lands on the dev heart closest to the median annulus" (`heart-063`) isn't a REQ-7 Done when item, so it's left out to keep REQ-3's tuned landing.
