# REQ-1 plan: Foundation

## Approach

Scaffold one Next.js (App Router) TypeScript app, and freeze everything that parallel requirements share: dependencies, contracts, stage state, tokens, stub component paths and `src/app/page.tsx`. Later requirements replace stub files. They shouldn't need to touch `package.json` or `page.tsx`.

**Scripts** (the spec checks these names)
- `verify`: `npm run typecheck && npm run lint && npm run data:check && npm run build && npm run test:e2e`
- `test:e2e`: `playwright test --grep-invert "@gpu|@live"`
- `test:gpu`: `playwright test --grep @gpu --pass-with-no-tests`, using the real GPU
- `test:live`: `playwright test --grep @live --pass-with-no-tests`
- `data:check`: `tsx scripts/data/check.ts`. The stub prints a note and exits 0 while `data/hearts.dev.json` is absent. REQ-2 replaces this file.

**Playwright config:** `workers: 1`, `baseURL` and the web server both from `PORT` (default 3000; use `PORT=3001` here), `reuseExistingServer: true`, viewport 1440x900, and Chromium args that enable WebGL headless (`--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`). No other browsers.

**Dependencies, all installed now**
- App: `next`, `react`, `react-dom`, `typescript`, `geist`, `zod`, `@google/genai`, Tailwind and shadcn/ui (`components.json`, `src/components/ui/*`)
- 3D: `three`, `@types/three`, `@react-three/fiber`, `@react-three/drei`
- Assets: `@gltf-transform/core`, `@gltf-transform/extensions`, `@gltf-transform/functions`, `meshoptimizer`
- Tooling: `@playwright/test`, `tsx`, ESLint, and `exceljs` because REQ-2 reads `shapeFeatures.xlsx`

**Contracts:** `src/contracts/index.ts` exports a zod schema and inferred type for each PRD section 3 contract: `HeartSchema`, `DesignSchema`, `FitResultSchema`, `SummarySchema`, `EvidenceSchema`, `FindingSchema`, `ProposalSchema`, `LimitSchema`, `RunEventSchema`, `BaselineSchema`, `DecisionSchema`, `RunSchema`. `provenance` is the literal `"synthetic"` and `hypothetical` the literal `true`.

**Stage:** `src/state/stage.ts` is a plain module store used through `useSyncExternalStore`, with no new dependency. It must import cleanly in Node.
- Exports `getStageProgress`, `setStageProgress` (clamps to 0-1), `subscribeStage`, `useStageProgress`.
- Also holds `mainHeartId` with a getter, setter and hook. REQ-4 sends the ID and REQ-7 reads it, and neither lists a shared file, so without this one of them would have to edit `page.tsx`.
- `page.tsx` passes `?stage=workspace` to a small gate that starts at 1. The element carrying `data-stage-progress` exposes the current value.
- Panels show only at progress 1. Hide them with `visibility: hidden` as well as opacity, so they are truly hidden and can't take clicks.

**Stubs:** each is `src/components/<name>/index.tsx` with a named PascalCase export.
- `page.tsx` imports `heart-scene`, `wall`, `feed`, `controls`, `judge` and `replay-label`. `judge` and `replay-label` render nothing yet, so REQ-15 and REQ-17 don't need `page.tsx`.
- `heart-panel` is a stub that `wall` renders (REQ-4 owns both).
- There must be one canvas, so `heart-scene` owns the R3F `Canvas` and renders `<RootView />` from `root-view`, which renders `<ValveModel />` from `valve-model`. That lets REQ-7 replace those two without touching REQ-3's files.
- `root-view` loads `public/fixtures/root-sample.glb` with drei `useGLTF`, using the translucent wall from the brief. Use `frameloop="demand"` and cap the pixel ratio at 2.
- `/` shows the Valvular name and the "Illustrative" label, with no panels. The scroll, beat and "Zoom to valve" belong to REQ-3.

**Test IDs that later requirements must keep:** `scene-area`, `wall-panel`, `feed-panel`, `controls-panel`, and the `data-stage-progress` attribute. REQ-4 and REQ-8 may replace `wall-dot`, `wall-total-fit`, `wall-total-risk`, `wall-total-no-fit` and `feed-event`.

**Fixtures** (imported as JSON)
- `fixtures/sample-hearts.json`: `{ label: "Sample data", hearts: Heart[], results: FitResult[] }` with 400 of each, one result per heart, all three statuses present, and non-empty `reasons` on every `risk` and `no-fit`. Generate with a fixed seed.
- `fixtures/sample-feed.json`: `{ label: "Sample data", events: RunEvent[] }` with at least 3 events, `seq` ascending. `RunEvent.mode` allows only `live` or `replay`, so use `replay`.

**Root sample:** `scripts/fixtures/build-root-sample.ts` reads exactly `data_repository_Verstraeten_et_al_2023/virtual_cohort/Case_1.stl` with `unzip -p` from the main checkout's `data/raw/verstraeten.zip`. It parses with three's `STLLoader`, welds, and writes a meshopt-compressed GLB under 300 KB to `public/fixtures/root-sample.glb`. Never use a wildcard: the zip also holds `real_cohort` and `virtual_cohort_*` folders with the same file names.

**Screenshot:** capture `/?stage=workspace` at 1440x900 with Playwright's screenshot API to `docs/reference/workbench.png`, with WebGL on, once the shell is styled. The Playwright MCP isn't configured on this machine.

## Spec notes

- REQ-1 has no GPU or Gemini steps, so nothing is tagged `@gpu` or `@live`. That's why `test:gpu` and `test:live` need `--pass-with-no-tests`.
- All specs keep running in `verify`, and REQ-8 and REQ-12 legitimately change the sample feed, disabled "Break it" and sample labels. Those checks retire automatically once the replacing requirement's spec file exists on the branch. Until then, they run in full.
- The spec doesn't test whether the canvas is blank or that `root-sample.glb` is requested, because REQ-7 and REQ-12 swap the mesh. The auditor checks the root in `workbench.png`.

## Files

- `package.json`, `package-lock.json`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs`, `playwright.config.ts`, `components.json`, `.gitignore` (keep all current rules, add `next-env.d.ts` and `*.tsbuildinfo`)
- `src/contracts/index.ts`, `src/state/stage.ts`, `src/styles/tokens.css`, `src/lib/utils.ts`
- `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/results/page.tsx`, `src/app/review/page.tsx`, `src/app/about/page.tsx`
- `src/components/data-label/*`, `src/components/ui/*`
- `src/components/{heart-scene,root-view,valve-model,wall,heart-panel,feed,controls,judge,replay-label}/index.tsx`
- `fixtures/sample-hearts.json`, `fixtures/sample-feed.json`, `public/fixtures/root-sample.glb`
- `docs/reference/workbench.png`, `tests/e2e/req-1.spec.ts` (already written, don't edit)

**Outside the PRD's file list, and why**
- `scripts/data/check.ts`: `data:check` needs a target before REQ-2 exists.
- `scripts/fixtures/build-root-sample.ts`: makes the GLB reproducible.
- `public/fixtures/root-sample.glb`: named by the requirement notes.
- `src/components/ui/*`, `src/lib/utils.ts`: generated by shadcn/ui.

## Risks

- **`real_cohort` leakage:** the spec scans for it, and the script reads one exact zip entry through a pipe, leaving no extracted files in the repo.
- **Console errors under SwiftShader:** a lost WebGL context or a missing favicon fails the first check. Add an icon, and keep the stub scene on demand.
- **Hydration mismatch from `?stage=`:** read it from the server `searchParams` prop and seed the client from that, not from `window`.
- **`next dev` first compile is slow:** the spec allows 90 seconds per test.
- **Mac load:** one worker, one server, Chromium only. Playwright stops the server it starts. Check nothing is left on port 3001 before finishing.
- **Playwright browser build:** the cached build may not match the installed version. If so, run `npx playwright install chromium` once.
