# REQ-17 plan: Replay

## Approach

A replay is a list of recorded model turns played by the existing scripted `ModelClient` (`mode: "replay"`) through the real `createAgentTools()` and `executeRun`. So every number is recomputed by code, never copied from the recording. Evidence IDs are hashes of tool and input (REQ-9), so recorded citations still resolve. REQ-12 isn't built, so nothing here wires "Break it" to Gemini. The live-failure path is proven with the real REQ-10 Gemini client and a failing transport. **Rebase on main after REQ-10 merges, before building.** The spec imports `createGeminiClient` and `withStepTimeout` from `src/agents/gemini`, and `stopAfter`.

### `src/replay/` (the spec imports these names from `src/replay`)

- `ReplayFileSchema` (zod) / `ReplayFile`: `{ id, title, source: "recording" | "transcript", startDesign: Design, limits: Limit[], budget: Partial<Budget>, stopAfter?: "investigate", turns: ScriptedTurn[] }`.
- `replayFromRun(run, { id, title }): ReplayFile` turns a REQ-10/11 recording (a `Run` JSON from `fixtures/recordings/`) into a replay. It takes `startDesign` and `budget` from the `run-start` event, `limits` from `run.limits`, and sets `stopAfter: "investigate"` when the stop reason is `investigated`. Each recorded `tool-call` event becomes one turn `{ text, toolCalls: [{ name: tool, args: input }] }`, failed calls included, so rejections and retries replay too. `text` is the `model-text` just before the call. A `model-text` with no call before the step ends becomes a turn with no calls. Recordings don't mark turn boundaries, so `budget.maxStepsPerTurn` is raised to at least `maxToolCallsPerTurn`. Recorded results are ignored.
- `loadReplay(id)`: reads `fixtures/replays/<id>.json`, or else converts `fixtures/recordings/<id>.json`. Ids must match `/^[A-Za-z0-9_-]{1,64}$/`. Returns `null` when the id is unknown or invalid. `listReplays()` returns the ids in `fixtures/replays/`. `DEFAULT_REPLAY_ID = "demo"`.
- `replayRun(file, { id?, onEvent? }): Promise<Run>` runs `executeRun` with `createScriptedClient(file.turns)`, `createAgentTools()` and the file's design, limits, budget and `stopAfter`. `startReplayRun(id)` does the same through `src/run/store.startRun` and returns the run id, or `null`.
- `offerRecording: PostLoopStep`: when a **live** run stops with `model-error` (a Gemini HTTP error, an empty response, or a step timeout after its one retry), it emits `{ actor: "code", type: "replay-offer", text: "Gemini failed: <stop detail> This run stopped and is not live. The recording can be replayed instead (Replay, not live).", data: { replayId: DEFAULT_REPLAY_ID, reason, detail } }`. It emits nothing for replay runs or live runs that end any other way.

### `fixtures/replays/demo.json`

A demo-mode transcript (`source: "transcript"`) from the starting valve: one Breaker turn, one Fixer proposal that improves fit with new risks, then one attack (`maxRounds: 1`). Reuse REQ-10's `fixtures/transcripts/breaker/starting-valve.json` for the Breaker part, so it passes the number guard. Write it with literal evidence IDs, not `$lastEvidenceId`.

### `src/components/replay-label/`

`ReplayLabel` is already mounted on `/`. It reads `useRun()` without changing it.
- While the feed's run is all replay events (`sample` and phase not `idle`), it shows `data-testid="replay-label"`: a small fixed `DataLabel` reading **"Replay, not live"**. It is never shown for a live run.
- When the feed holds a `replay-offer` event, it shows `data-testid="replay-offer"` with a **"Play the recording"** button. The button calls `startReplay(replayId)`.

### Small changes outside the listed files (minimal, needed for wiring)

- `src/orchestrator/index.ts`: `PostLoopContext` gets `stopDetail: string`, so the offer can say why the run failed.
- `src/app/api/runs/route.ts`: the body may be `{ replayId }`. That calls `startReplayRun`: 201 `{ id }`, 404 for an unknown replay, 400 for a bad id. `gemini` runs get `postLoopSteps: [offerRecording]`.
- `src/components/feed/run-store.ts` (REQ-8, **UI file outside our list, flagged**): an additive `startReplay(replayId)` export. It resets the store (closes the stream, clears events and flags) and posts `{ replayId }` through the same path as `startRun`, so the feed, the wall and "Fix it" play the replay exactly like a run. About 10 lines. The feed can't show a second run without this, and REQ-12 would need the same hook.

## Files

`src/replay/{index,schema,from-run,library,run,offer}.ts`, `src/components/replay-label/index.tsx`, `fixtures/replays/demo.json`, `tests/e2e/req-17.spec.ts`, plus the three small edits above.

## Tests (`tests/e2e/req-17.spec.ts`, port 3017, no key, no network)

- **R1** Forced Gemini timeout (the transport hangs until aborted, 200 ms step timeout, 1 retry) and forced HTTP error. Each gives a live run with `run-stop` `model-error` and a `replay-offer` event before it. The offer quotes the stop detail, names Gemini and points to a replay that loads. No offer for a scripted run that fails, or for a live run that finishes.
- **R1-UI / R2-UI / R4-UI** (one browser test): a forced-failure run is imported, and the "Break it" POST is fulfilled with its id, standing in for REQ-12. The feed shows the failure and the offer, "Play the recording" appears, and there is no replay label on the live run. Click Play. A MutationObserver logs every feed change, and the label is visible in every snapshot through to the end ("Fix it" is clicked when enabled). The server run is all `mode: "replay"`, and the browser makes no requests off localhost.
- **R2** In-process and HTTP replays: every event is `mode: "replay"`. An unknown or bad `replayId` is refused.
- **R3** Every tool call in a replay (in-process and over HTTP) equals a fresh `/api/tools` or `createAgentTools()` call: same evidence ID and result. Recording round trip: same tool calls, findings, proposals and stop. Tampered recorded numbers never reach the replay.
- **R4** With `fetch` and `net.Socket.connect` made to throw, every replay in `fixtures/replays/` finishes (not `model-error`) with a finding, a proposal and an attack, and makes 0 connection attempts.

## Risks

- **REQ-10/11 drift:** the spec relies on REQ-10's `createGeminiClient({ apiKey, transport })`, `withStepTimeout`, `stopAfter` and number guard. REQ-11 may change Fixer validation, so `demo.json` must still pass it after rebasing. If those names change, stop and report.
- **Run-store edit** is outside our UI files. If the merger refuses it, the UI half of Done when 1 and 2 moves to REQ-12/19.
- A failed run left in the feed enables "Fix it" (REQ-8 phase logic). Out of scope, so it's noted for REQ-12.
- `next build` type-checks `tests/`, so the build fails until `src/replay` exists. That's expected.
