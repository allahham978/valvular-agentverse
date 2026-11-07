# REQ-5 plan: Agent loop

## Approach

Code runs the loop from PRD section 3: Breaker investigates, Fixer proposes, Breaker attacks, repeat. This requirement builds the loop, an append-only run log and a resumable stream, against two seams: `ModelClient` (scripted only) and `ToolRegistry` (stand-in only). There is no prompt writing, Gemini, fit engine, hidden scoring or review here, and no UI.

### Seams (the spec imports these names)

`src/agents/model-client/`

```ts
type ToolCall = { name: string; args: unknown };
type ToolSpec = { name: string; description: string; parameters: Record<string, unknown> };
type ModelTurn = { text: string; toolCalls: ToolCall[]; providerState?: unknown };
type ToolReply = { name: string; evidenceId?: string; result?: unknown; error?: string };
type ModelMessage =
  | { role: "user"; text: string }
  | { role: "model"; turn: ModelTurn }
  | { role: "tool"; replies: ToolReply[] };
type ModelRequest = {
  actor: "breaker" | "fixer";
  step: LoopStep; // "investigate" | "propose" | "attack"
  messages: ModelMessage[];
  tools: ToolSpec[];
  signal: AbortSignal;
};
interface ModelClient {
  readonly mode: "live" | "replay";
  nextTurn(request: ModelRequest): Promise<ModelTurn>;
}
```

- `providerState` is opaque and echoed back in `messages`. Gemini needs this to return its thought signatures on tool calls.
- `createScriptedClient(turns)` plays `ScriptedTurn { delayMs?, text?, toolCalls }` in order and has `mode: "replay"`. It honours `signal` during `delayMs`, and rejects when turns run out. The literal string `"$lastEvidenceId"` anywhere in `args` is replaced with the newest evidence ID in `messages`, so scripts can cite evidence without knowing how IDs are formed. REQ-10 and REQ-11 transcripts use this same format.
- `createModelClient(spec)` switches on `spec.kind`, which is only `"scripted"` here. REQ-10 adds one `"gemini"` case. That edit is outside REQ-10's listed files, so it should say so.

`src/orchestrator/tools.ts`

```ts
type ToolOutcome = { ok: true; evidence: Evidence } | { ok: false; error: string };
interface ToolRegistry {
  specs(): ToolSpec[];
  call(name: string, input: unknown): Promise<ToolOutcome>;
}
```

`src/orchestrator/stand-in-tools.ts` exports `createStandInTools()`, with the three tools the loop needs, under their PRD names. Keep this file after REQ-9: the spec uses it.
- `evaluate_design({ design })`: `evidence.result` is a `Summary` plus `label: "Sample data"`. A deterministic count on `split: "dev"`, total 400, from how much of 18-32 mm annulus the sizes cover. Same sizes give the same numbers, and wider coverage gives a higher `fitPct`.
- `report_findings({ mechanisms })`: result `{ findings }`, each `{ title, explanation, heartIds, severity, evidenceIds }`.
- `submit_proposal({ design, rationale, tradeOffs?, evidenceIds })`: result `{ design, rationale, tradeOffs, evidenceIds }`.
- Evidence IDs hash tool and input, so they are stable across runs. Invalid input returns `ok: false`.

`src/orchestrator/roles.ts` exports `defaultRoles: Record<LoopStep, AgentRole>`.

```ts
type AgentRole = {
  actor: "breaker" | "fixer";
  prompt(ctx: LoopContext): string;
  toolNames: string[];
  terminalTool: "report_findings" | "submit_proposal";
  validate?(evidence: Evidence, ctx: LoopContext): string | null;
};
```

REQ-10 and REQ-11 replace a role's prompt, tools and `validate`, and don't need to change the loop. `validate` runs only on a successful terminal tool call. A non-null result is a rejection: it goes back to the model as a tool error, and the turn continues within budget. That covers "no invented numbers" and "invalid design, try again". A call to a tool outside `toolNames` is refused the same way and logged.

`src/orchestrator/index.ts` exports `executeRun(options): Promise<Run>`, with options:
- Required: `model`, `tools`.
- Optional: `budget` (partial), `roles`, `seed`, `startDesign`, `limits`, `startAt: "investigate" | "propose"` (default `investigate`, for REQ-15's replan), `postLoopSteps`.
- `PostLoopStep = (ctx: PostLoopContext) => Promise<void>`, where `ctx` has `stopReason` and `emit({ actor, type, text, data })`. Default is an empty list. Steps run after the stop reason is decided and before the final `run-stop`. REQ-13's `scoring-step.ts` plugs in here. REQ-16's review waits on a human, so it starts from the finished run and isn't a post-loop step.

### Loop rules

1. Emit `run-start`, then evaluate the start design with the `evaluate_design` tool as `actor: "code"`, not counted against any budget.
2. Run a step: emit `step-start` with `data: { step, round }`, then call the model repeatedly until the terminal tool succeeds.
3. After a proposal, code evaluates it. It improved only if its `fitPct` is above the current design's. If not, stop with `no-improvement`, with no attack. If so, it becomes the current design.
4. Attack, then repeat from the Fixer. Stop with `budget` once `maxRounds` attack steps are complete.

Budget defaults: `maxToolCallsPerTurn: 12`, `maxTurnMs: 60000`, `maxRounds: 3`. One model `nextTurn` may hold several calls, so check the count before each call. The time limit covers the whole agent turn, so race `nextTurn` against it and abort `signal`.

| `reason` in `run-stop` | When | Extra `data` |
|---|---|---|
| `no-improvement` | Proposal doesn't beat the current design | |
| `budget` | A limit was hit | `limit`: `maxToolCallsPerTurn`, `maxTurnMs` or `maxRounds` |
| `no-valid-fix` | Fixer ends a turn with no tool calls (it gave up). REQ-11 builds on this | |
| `model-error` | `nextTurn` throws, or the Breaker ends a turn with no tool calls | |

Every run ends with exactly one `run-stop`, whatever goes wrong: the stream's close depends on it.

### Events

`RunEvent.type` values, matching `fixtures/sample-feed.json` so REQ-8 lines up:

| Type | Actor | `data` |
|---|---|---|
| `run-start` | code | `{ design, budget }` |
| `step-start` | breaker or fixer | `{ step, round }` |
| `model-text` | breaker or fixer, only when `text` isn't empty | `null` |
| `tool-call` | breaker or fixer | `{ tool, input, evidenceId?, result?, error? }`, one event per call, after it runs |
| `finding` / `attack` | breaker | the `Finding` |
| `proposal` | fixer | `{ proposal, design }` |
| `evaluation` | code | `{ designId, summary, evidenceId, improved? }`, where `improved` is missing for the start design |
| `run-stop` | code | `{ reason, detail, limit? }` |

`seq` starts at 1 with no gaps. `mode` comes from `model.mode`. Findings get `kind` from the step (`investigate` = `mechanism`, `attack` = `attack`), and the orchestrator assigns finding and proposal IDs. `baselines` stays `[]` and `hiddenScoreCount` stays `0`.

The exported file is the `Run` contract and nothing else, so don't add fields. Status is derived: `finished` if the last event is `run-stop`, `running` if the run is active in this process, otherwise `interrupted`.

### Run log

`src/run/` holds the store. Keep active runs and their listeners on `globalThis`, and write each run through to `<VALVULAR_RUNS_DIR or os.tmpdir()/valvular-runs>/<id>.json` (temp file then rename) on every event. Run IDs must match `^[A-Za-z0-9_-]{1,64}$` before touching the disk.

### API

| Route | Behaviour |
|---|---|
| `POST /api/runs` | Body `{ model: { kind: "scripted", turns }, budget?, seed? }`. Returns `201 { id }` straight away while the run continues in the background. Invalid body: 400 |
| `GET /api/runs/:id` | `{ status, run }`, or 404 |
| `GET /api/runs/:id/events` | SSE. Default `message` events with `id: <seq>` and `data: <RunEvent JSON>`. Sends all events so far, then live ones, and closes after `run-stop`, or at once if `interrupted`. Honours `Last-Event-ID`. 404 if unknown |
| `GET /api/runs/:id/export` | The `Run` JSON as an attachment. 409 while running, 404 if unknown |
| `POST /api/runs/import` | Body is a `Run`. Returns `201 { id }`. Invalid shape or ID, or no final `run-stop`: 400. Same ID with different content: 409. Same ID with same content: 201, no change. Never re-executes |

Run handlers on the Node runtime with `dynamic = "force-dynamic"`, and `await params` (Next 16).

### Later requirements

- **REQ-8:** close `EventSource` on `run-stop`, or it reconnects forever.
- **REQ-9/10:** swap the tools in the API route's wiring. Real `evaluate_design` must return a `Summary` in `evidence.result`, or be adapted in that wiring. This spec keeps running in `verify`, so it asserts no exact numbers, and the "Sample data" check retires when `tests/e2e/req-9.spec.ts` exists. Its designs obey the 2.5 mm rule. Its improving proposal adds a 29 mm size, and it needs that to raise real `fitPct`. If it doesn't, stop and report it.
- **REQ-15:** `startAt` and `limits` are the restart inputs.
- **REQ-17:** a failed Gemini call becomes `model-error`, with the reason logged.

## Spec notes

- No step needs a GPU or Gemini, so nothing is tagged `@gpu` or `@live`.
- `Done when` 1-5 run over HTTP. Step 4 uses a real page reload and a real `EventSource`.
- Beyond `Done when`, on purpose: `no-valid-fix` and `model-error`, because they are PRD stop rules that would otherwise send REQ-11 and REQ-17 back into the loop, and a "seams" group that drives `executeRun` with a non-scripted client, so REQ-10 and REQ-11 can plug in.
- `next build` type-checks this spec, so `npm run build` fails until the seam modules exist. Create those first.
- Run the spec after `npm run build`, with `PORT=3005 npx playwright test tests/e2e/req-5.spec.ts --workers=1`.

## Files

- `src/agents/model-client/*`: types, scripted client, factory
- `src/orchestrator/*`: `index.ts`, `tools.ts`, `stand-in-tools.ts`, `roles.ts`, the start design (nominal 23, 25 and 27 mm, covering 21-23, 23-25 and 25-27 mm annulus; the spec's no-improvement script relies on these)
- `src/run/*`: store and listeners
- `src/app/api/runs/route.ts`, `src/app/api/runs/import/route.ts`, `src/app/api/runs/[id]/route.ts`, `src/app/api/runs/[id]/events/route.ts`, `src/app/api/runs/[id]/export/route.ts`
- `tests/e2e/req-5.spec.ts` (written, don't edit), `docs/plans/req-5.md`

No contract or dependency changes, and nothing outside this list.

## Risks

- **Split module state:** Next can bundle each route separately, so a plain module-level map isn't shared and the stream finds no run. Keep the registry on `globalThis`.
- **Buffered stream:** `next start` gzip can hold SSE until the end. Send `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`. The spec checks arrival times with a client that accepts gzip.
- **Gaps at the join:** subscribe first, then send the backlog, and skip any `seq` already sent. Remove the listener when the request aborts. A disconnect must not stop the run.
- **Hanging model call:** a race alone leaves a late result able to emit events. Once a turn is timed out or aborted, ignore its result, so nothing follows `run-stop`.
- **Crash mid-run:** a server restart leaves a file with no `run-stop`. `interrupted` means it doesn't look alive forever.
- **Hosting (REQ-19):** the background run and listeners need one long-lived Node process, and serverless can freeze them. Host on a long-lived Node server, or revisit at REQ-12. Not solved here.
- **Untrusted import:** parse with `RunSchema`, check the ID pattern, and never build a path from an unchecked ID.
- **Stand-in numbers:** they aren't real results. They carry `label: "Sample data"` and only reach a screen if REQ-8 connects before REQ-9, which should show that label.
- **Mac load:** no browser in most tests, one short page in the reload test, one worker and one server. Playwright stops the server it starts. Check that port 3005 is free before finishing.
