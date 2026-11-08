# REQ-10 plan: Breaker agent and live Gemini ModelClient

## Approach

The Breaker plugs into the REQ-5 loop as two `AgentRole`s (investigate, attack), as REQ-5's plan intended. The Gemini adapter is a second `ModelClient`. The loop gets small, named additions (step budget, one retry after a rejection, Breaker-only stop, recording). No UI, no Fixer prompt (REQ-11), no replay UI (REQ-17), no limit parsing (REQ-15). It builds on REQ-9's `createAgentTools()` (`src/tools/index.ts`) and its tool contracts (`docs/plans/req-9.md` on branch `req-9`). **Rebase on main after REQ-9 merges, before building**: the spec imports `src/tools`.

### `src/agents/breaker/` (the spec imports these names)

- `BREAKER_TOOLS`: `evaluate_design`, `group_failures`, `profile_group`, `inspect_heart`, `what_if`, `stress_test`, `report_findings`.
- `breakerRoles: { investigate: AgentRole; attack: AgentRole }`. Both have actor `breaker`, the 7 tools, terminal `report_findings`, and `validate` = the number guard. The prompts include the current design JSON, its fit summary and the active limits. They say to cite evidence IDs and to use only numbers from cited evidence. The **attack** prompt says a proposal that holds up is a valid result: report it as one finding whose title starts "Survived" (REQ-9's `report_findings` needs at least one mechanism), with severity `low`, citing the attacks that ran. Neither prompt tells the model it must or always find a break, to keep going until it does, or to find at least one flaw.
- **Number guard** (`number-guard.ts`), checked separately for each finding's `title` and `explanation` against **that finding's** cited evidence. First remove heart IDs (`heart-\d+`) and evidence IDs (`ev-…`) from the text. A number is allowed if one of these is true:
  1. It appears in the cited evidence's `input` or `result`. That includes numbers inside strings, such as the band key `"16-18"`. Heart and evidence IDs inside those strings are ignored. `provenance` doesn't count.
  2. It's a size or label number of the current design (`nominalMm`, `minAnnulusMm`, `maxAnnulusMm`, digits in `label`).
  3. It's an active limit's `value`.
  4. It's a range `a-b` (also `a–b`, or `a to b`) where both ends pass rules 1 to 3.

  Rounding: a number written with `d` decimals matches an evidence number within half a unit of its last decimal, inclusive, so `54.8` and `54.7` both match `54.75`. Use a small epsilon, not `Math.round`, because `toFixed` and binary floats disagree at exact halves. A leading minus is ignored. A rejection returns `Rejected: numbers not in the cited evidence: <list> (finding <n>). Remove them or cite evidence that contains them. One retry left.` The rejected text stays logged in the `tool-call` event's `input`.
- `runBreaker({ model, tools?, design?, limits?, budget?, onEvent? }): Promise<Run>`. This is one Breaker turn: `executeRun` with `stopAfter: "investigate"`, where `tools` defaults to `createAgentTools()` and `design` to the starting valve. Sets `record: model.mode === "live"`.

### `src/agents/gemini/`

- `geminiSettings`: `{ model: "gemini-4-argon", method: "generateContent", thinkingLevel: "low", toolMode: "ANY", maxOutputTokens: 32768, stepTimeoutMs: 60000, stepRetries: 1, budget: { maxStepsPerTurn: 8, maxToolCallsPerTurn: 16, maxTurnMs: 180000 } }`.
- `createGeminiClient({ apiKey?, transport? }): ModelClient` with `mode: "live"`. `transport(request: { model, body }, signal) => Promise<unknown>` returns the raw REST JSON. By default it's a `fetch` POST to `https://generativelanguage.googleapis.com/v1beta/models/gemini-4-argon:generateContent` (non-streaming), with the key in the `x-goog-api-key` header, never in the URL. If no `apiKey` is given, it's read lazily, on the first request, through `readGeminiKey()`. That function parses `GEMINI_API_KEY` from `<cwd>/.env.local` only. Error messages never contain the key. Use plain `fetch`, with no new dependencies.
- Body: `contents`, `tools: [{ functionDeclarations }]` (from `ToolSpec`, using `parametersJsonSchema`), `toolConfig.functionCallingConfig.mode = "ANY"`, `generationConfig: { thinkingConfig: { thinkingLevel: "low" }, maxOutputTokens: 32768 }`. A user message becomes `{ role: "user", parts: [{ text }] }`. **A model message is resent as `turn.providerState`, the candidate's `content` object exactly as returned**, signatures included. A tool message becomes one `{ role: "user", parts: [...] }` with one `functionResponse { id, name, response }` per call, in call order. `id` and `name` are echoed from the matching `functionCall` part (match by index). `response` is `{ evidenceId, result }`, or `{ error }`. Each `functionCall` part becomes a `ToolCall`, so several calls in one step all run. `text` joins the non-thought text parts. A response with no candidate content, or an HTTP error, throws a short message with the status.
- `withStepTimeout(client, { timeoutMs, retries }): ModelClient`. Each `nextTurn` attempt gets its own abort signal, linked to the turn's. On timeout, the attempt is aborted and the same request is retried once. A second timeout throws `Model step timed out after <s> s, then again on its one retry.`, which the loop logs as `run-stop` `model-error`. If the turn's own signal aborts, it doesn't retry.
- `saveRecording(run)` writes the `Run` JSON to `fixtures/recordings/<run.id>.json`. A Run already holds the events, the tool calls (with input and result) and the evidence, so REQ-17 can import it.

### Small changes outside the listed files (needed to wire the Breaker in, kept minimal)

- `src/orchestrator/index.ts`:
  - `Budget` gets `maxStepsPerTurn`. `defaultBudget` becomes `{ maxStepsPerTurn: 8, maxToolCallsPerTurn: 16, maxTurnMs: 180000, maxRounds: 3 }` (PRD §3). Making a 9th `nextTurn` call in one turn stops with `budget` and `limit: "maxStepsPerTurn"`.
  - A second `validate` rejection in the same turn stops with `model-error` and detail `<tool> failed validation again after one retry: <reason>`.
  - `stopAfter?: "investigate"` adds a stop reason `investigated` with the detail "The Breaker reported its findings."
  - `record?: boolean` calls `saveRecording(run)` after `run-stop`. It's opt-in, so REQ-5's spec (which has a `mode: "live"` fake) writes no files.
  - `LoopContext` gets `evidence: Evidence[]` (the run's evidence so far), so `validate` can read the cited items.
- `src/orchestrator/roles.ts`: `defaultRoles.investigate` and `.attack` = `breakerRoles`. The propose role is unchanged.
- `src/agents/model-client/factory.ts`: adds a `{ kind: "gemini" }` case, which is `withStepTimeout(createGeminiClient(), { timeoutMs: 60000, retries: 1 })`. REQ-5 planned this.
- `src/app/api/runs/route.ts`: the budget schema accepts `maxStepsPerTurn`. A `gemini` run passes `record: true`.

## Files

`src/agents/breaker/{index,roles,prompts,number-guard,run}.ts`, `src/agents/gemini/{index,settings,client,step-timeout,key,recording}.ts`, `fixtures/transcripts/breaker/starting-valve.json` (`ScriptedTurn[]`: at least 3 different non-terminal Breaker tools, then `report_findings` citing evidence from this run, with numbers that pass the guard), `fixtures/recordings/*` (live runs and `req-10-live-summary.json`), and `tests/e2e/req-10.spec.ts`. Plus the four small edits above.

## Tests (`tests/e2e/req-10.spec.ts`, port 3010)

Scripted tests run in-process (`executeRun`/`runBreaker` with real tools), plus one over HTTP. They need no key and no network. The timeout test uses a 200 ms step timeout against steps that hang until aborted, so it doesn't depend on machine speed.

- **B1** The transcript fixture → `investigated`, findings cite evidence present in `run.evidence` (and produced in this run), at least 3 different tools ran, and there are no rejections.
- **B2** An invented number → the rejection is logged with the number, the reason is in the next model request, and the retry is accepted. Two bad reports (an invented number, then a range with one end not in evidence) → `model-error` after the second, with no third model request. A scripted `/api/runs` run applies the same guard.
- **B3** Heart IDs, design sizes, the design label, a computed range and a rounded evidence number → accepted with no rejection.
- **B4** A hidden heart in `inspect_heart`, `profile_group` and finding `heartIds` → each refused and logged, with no evidence for it and none of its measurements anywhere in the run.
- **B5** A fake transport returns two `functionCall`s and a `thoughtSignature` → both run. The next request resends the content unchanged (deep-equal and JSON-equal) and returns both `functionResponse`s together, with the ids echoed. The settings are checked in the request body. A stubbed `fetch` checks the URL, method and key header, and that an HTTP error doesn't leak the key.
- **B6** Hang, hang → exactly 2 attempts (the first aborted), then a `model-error` stop with the reason. Hang, then a good step → the run finishes.
- **S** (PRD §3): `geminiSettings` and `defaultBudget` values, the 8-step and 16-call limits, prompts allowing "survived" without pushing for a break, and the `gemini` case in `createModelClient` (`mode: "live"`, no key read at creation).
- **L7–L9 `@live`**: they read the key from `.env.local`. L7: at least 3 different non-terminal tools, plus a mechanism naming a non-annulus measurement and citing evidence about it. L8: the starting valve against `25/27/29`, where the tool-call sequences differ once the design object is masked. L9: 10 runs, at least 9 finish, the slowest time is annotated and written to `fixtures/recordings/req-10-live-summary.json`, each run's recording exists and parses, and no recording contains the key.

## Risks

- **REQ-9 contracts:** the spec relies on `createAgentTools`, deterministic `ev-` IDs, 403 refusals naming hidden IDs, and `group_failures` `by: "band"` keys like `"25-27"`. If REQ-9 merges with different names, stop and report.
- **Budget defaults changed** (12/60 s to 16/180 s, plus 8 steps): run `req-5`, `req-8` and `req-9` too. The guard now applies to every Breaker report in `/api/runs`. The REQ-8 demo text ("27 mm") passes, because 27 is a design size.
- **L8 at `low`** may repeat one script (RES-2). Per RES-2, try `medium` before anything else, record it, and never use `high`. The valves already differ a lot.
- **PRD over RES-2:** one retry after a rejection, not 3. A 429 or 5xx isn't retried (the PRD retries only timeouts), so it stops and says so.
- Live checks are run once by the live checker. The builder may make at most 5 live calls.
