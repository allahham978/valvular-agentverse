# REQ-4 plan: Wall and heart panel

## How it fits

The wall is the app's main view of results. REQ-8 and REQ-12 will push new results into it, REQ-7 reads the heart it sends to the main view, and REQ-12 swaps fixtures for `/api/hearts` and the fit engine. So there are two seams to get right: one module that supplies the data, and one way to apply changed results. Everything else stays local to the wall and popup.

## Approach

**Data source.** `src/components/wall/data-source.ts` is the only file that imports `fixtures/sample-hearts.json`. It exports `loadWallData(): Promise<WallData>`, where `WallData` is `{ label: string | null; hearts: Heart[]; results: FitResult[] }`. It's async so REQ-12 can replace the body with a fetch and change nothing else. `label` is `"Sample data"` until real results are connected, and the UI shows whatever the source returns.

**Results store.** `src/components/wall/use-wall-data.ts` is a module store used through `useSyncExternalStore`, the same pattern as `src/state/stage.ts`.
- Results are held by heart ID. `applyFitResults(changed)` merges by ID, keeps the existing object for unchanged hearts, and ignores IDs not on the wall.
- The store also listens for a `valvular:fit-results` window event with `detail: { results: FitResult[] }`, checked with `FitResultSchema`. This is how the spec pushes results into a production build with no test-only code, and it lets REQ-8 publish without importing wall internals.
- Dots and thumbnails are `memo` components that take their result object, so an update touches only the changed hearts.

**Dot grid.** Keep the 25-column DOM grid from REQ-1. Each dot becomes a `<button>` with an `aria-label`, and keeps `data-status`. Totals are derived from the store. Set `data-ready="true"` on `wall-panel` once data has loaded and the client has mounted.

**Hover card.** One shared card, not one per dot. Place it with `position: fixed` to the left of the panel, using the dot's rect, so it isn't clipped and never covers the dot. `.stage-panel` has no transform, so `fixed` is safe.

**Expanded wall and popup.** Use native `<dialog>` with `showModal()`.
- `shadcn` dialog needs Radix, which isn't installed. Adding it means editing `package.json` while other sessions run. Native dialog gives us Esc, focus trapping, the top layer and correct stacking of the popup over the wall.
- Render each dialog only while open, so closed dialogs leave no "Sample data" text in `wall-panel`. The REQ-1 spec reads that text with a strict locator.
- Popup state lives in `Wall`. Closing paths: Esc, click on the backdrop, and "Open in main view". That last one closes the expanded wall too, or the main view would stay hidden behind it.
- Both dialogs show the source's `label`. Leave a margin around the expanded wall, and let its thumbnail grid scroll inside it.
- Thumbnails use `next/image` with `unoptimized`. They lazy-load, and it avoids sending 400 images through the optimiser.

**Popup 3D view.** `src/components/heart-panel/heart-view.tsx` is a second small `Canvas`, not drei `View`, because `View` draws through the main canvas, which has to pause.
- `frameloop="demand"`, `dpr={[1, 2]}`, `useGLTF(heart.meshUrl)` on a clone, a simple translucent material in the root's tint, and drei `OrbitControls` with zoom and pan off.
- The fixture's `meshUrl` is `/fixtures/root-sample.glb`, served from `public/fixtures/`. The requirement note's `fixtures/root-sample.glb` means this file.
- R3F force-releases the WebGL context on unmount. The spec opens the popup 17 times to check the main canvas survives Chrome's limit of 16 contexts.

**Pausing the main view.** Needs two small changes outside the listed files, because nothing else can reach the main `Canvas`:
- `src/state/stage.ts`: add a `mainViewPaused` store with `setMainViewPaused` and `useMainViewPaused`, next to `mainHeart`.
- `src/components/heart-scene/index.tsx`: `frameloop={paused ? "never" : <existing value>}`.

The popup sets the flag on mount and clears it on unmount, which covers every closing path. R3F invalidates on store changes, so the main view redraws when it resumes.

**Main view.** "Open in main view" calls `setMainHeartId` from `src/state/stage.ts`. `wall-panel` reads `useMainHeartId` and exposes it as `data-main-heart-id`. REQ-7 reads the same store to load the mesh.

**Rule type.** `FitResult.reasons` has no rule type or name, and `data/rules.json` arrives with REQ-6. `src/components/heart-panel/sample-rules.ts` maps the three fixture rule IDs to a readable name and `demo-assumption`, which is what the PRD says these placeholders are. REQ-12 replaces it with `rules.json`.

## Test contract

The spec relies on these. Keep the REQ-1 IDs: `wall-panel`, `wall-dot`, `wall-total-fit`, `wall-total-risk`, `wall-total-no-fit`.

| Thing | Contract |
|---|---|
| Dot | `wall-dot`, `data-heart-id`, `data-status` |
| Panel | `wall-panel`, `data-ready="true"`, `data-main-heart-id` once a heart is sent |
| Hover card | `wall-hover-card`, with an `img` and the heart ID |
| Expand | A button named "Expand" in the panel. Overlay is `wall-overlay`, a dialog, with a button named "Close" |
| Thumbnail | `wall-thumb`, `data-heart-id`, `data-status`, an `img` with the ID in its `alt`, and a `wall-thumb-status` marker whose background is the status colour |
| Popup | `heart-popup`, a dialog. `heart-popup-status`, `heart-popup-view` (holds the canvas), `heart-popup-measure-<key>` per measurement |
| Failed rule | `heart-popup-reason`, `data-rule-id`, showing the words "Failed rule", "Limit", "Margin" and "Rule type" in the popup. Measurements to 1 decimal place |
| Results event | `valvular:fit-results`, `detail: { results: FitResult[] }` |

## Files

Listed:
- `src/components/wall/index.tsx`, `data-source.ts`, `use-wall-data.ts`, `dot-grid.tsx`, `hover-card.tsx`, `expanded-wall.tsx`
- `src/components/heart-panel/index.tsx`, `heart-view.tsx`, `sample-rules.ts`
- `tests/e2e/req-4.spec.ts`

Outside the list, kept minimal for the reasons above:
- `src/state/stage.ts`
- `src/components/heart-scene/index.tsx`

Run on port 3004, with one worker and one server: `npm run build && PORT=3004 npx playwright test tests/e2e/req-4.spec.ts --workers=1`.

## Risks

- **Conflict with REQ-3.** REQ-3 owns `heart-scene` and will rewrite the `frameloop` line, because the heart renders continuously until the zoom settles. Whoever merges second must keep both: paused always wins. The spec's pause test catches a bad merge, since it fails if the main canvas draws while paused.
- **Scroll zoom.** Once REQ-3 merges, a window-level wheel handler could move the stage while the overlay is open. The spec wheels over the overlay and checks progress stays at 1. If this breaks after rebasing, stop the event in the dialog and don't change REQ-3's handler.
- **Render cost.** 400 buttons, each subscribed to the whole store, would rerender on each update. Pass result objects to `memo` components, so only changed hearts rerender.
- **Fake identities.** Every fixture heart has the same thumbnail and mesh, so per-heart images can't be checked until REQ-2 is connected in REQ-12. Always use `heart.thumbUrl` and `heart.meshUrl`, never a hard-coded path.
- **Heart IDs change.** REQ-2's IDs differ from the fixture's, and they change together when REQ-12 swaps the source. The spec reads its expected values from the fixture, so REQ-12 will need to update it or keep a fixture mode.
- **No `@gpu` or `@live` steps.** REQ-4's "Done when" has none. Software WebGL is enough to check the popup, and the lag test stays with REQ-3 and REQ-7.
