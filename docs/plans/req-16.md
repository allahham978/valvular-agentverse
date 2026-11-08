# REQ-16 plan: Engineer review

## Approach

Step 6 of the loop (PRD §3). REQ-12 isn't built, so `/review?run=<id>` reads any finished run straight from the REQ-5 store, with the merged engine, tools and agents. Verdicts and `notShown` come from REQ-11. **Rebase on main after REQ-11 merges, before building.** DW7 can't pass until then.

### `src/orchestrator/review-step.ts` (pure logic, relative imports only, because the spec imports it in-process)
- `reviewedProposal(run)`: the last proposal whose code `evaluation` event has `improved: true`, its design (from the `proposal` event), its parent design (from `run-start` or an earlier `proposal` event), before and after `fitPct` (from `evaluation` events), the attack findings and `stress_test` calls between that proposal and the next one, and the verdict and `notShown`. Returns null if there's nothing to review.
- `notTested(run, reviewed)`: hidden hearts not scored (when `hiddenScoreCount` is 0), plus each `stress_test` kind (`measurement_shift`, `assumption_shift`, `subgroup`) not run on the proposed design.
- `saveDecision(run, { status, by, note })`: `by` is trimmed and must be non-empty, and a rejection needs a non-empty note. Refuses an unfinished run, a run with nothing to review, or a run that already has a decision. Sets `run.decision = { status, designId: toDesignId, by, note, at }`.
- `requireDecision(run, "export" | "final-design")`: export needs any saved decision, and the final design needs `approved`. Otherwise it gives a refusal (409) the routes return.
- `replanOptions(run, note)` → `{ startAt: "propose", startDesign: parent, limits: run.limits, roles }`. `roles` = `defaultRoles` with the Fixer's prompt extended by "The engineer rejected <design label>: <note>". `replanAfterReject(run, note, { model, tools? })` runs `executeRun` with these options and resolves with the new run (used by the spec). The route starts the same options through `startRun`.

### API (thin handlers that call review-step)
- `POST /api/review/[id]/decision` with body `{ status, by, note, model? }` (`model` = `ModelSpecSchema`, default `{ kind: "gemini" }`). Saves the decision, and a rejection also starts the replan. Returns `{ decision, replanRunId? }`. The responses are 400 (bad input), 404 (no run) and 409 (unfinished, nothing to review, or already decided). `GET` returns the decision, or 404.
- `GET /api/review/[id]/final-design` → `{ design, decision }` only once approved, otherwise 409 with no design.
- `GET /api/review/[id]/export` → the run with `decision` (RunSchema) once any decision is saved, otherwise 409.

### UI (`src/app/review/page.tsx` server component, `src/components/review/*`)
SiteHeader (keeps "Synthetic test hearts"), then one quiet column, per the design brief. Sections with test IDs:
- `review-change`: from → to sizes in mm, fit before → after.
- `review-trade-offs`
- `review-attacks`: titles and kinds.
- `review-verdict`: a readable label, e.g. "Context dependent".
- `review-not-shown`: each `notShown` line verbatim.
- `review-not-tested`
- `review-evidence`: every run evidence ID, tool and source.

Then a client form with "Name" and "Note" fields and "Approve" and "Reject" buttons. Errors go to `role="alert"`. `review-decision` shows "Approved by …", or the note and "Sent back to the Fixer" with a link to `/review?run=<replanRunId>`. Without a run, the page shows an empty state. Status colours aren't used, and nothing is labelled ready, safe or approved for use.

## Files
`src/orchestrator/review-step.ts`, `src/app/review/page.tsx`, `src/components/review/{index,decision-form}.tsx`, `tests/e2e/req-16.spec.ts`.
**Outside the list, kept minimal (say so in the result):**
- `src/app/api/review/[id]/{decision,final-design,export}/route.ts`, because API routes live under `src/app/api`, and a route handler can't share the `/review` segment with its page.
- `src/run/store.ts`: one additive `saveDecision(id, decision)` export that persists `run.decision` to disk and in memory, because the store owns persistence.

## Tests (`tests/e2e/req-16.spec.ts`, PORT=3016)
Runs are made with the scripted model through the real tools (`POST /api/runs`, `maxRounds: 1`): investigate, an add-29 proposal with a claim, and one `measurement_shift` attack. Evidence IDs are computed in-process, so nothing is hard-coded. No key, no network and no timing assertions. Polls have generous deadlines.
- **DW1:** the page shows the sizes, before and after %, each trade-off, the attack title, every evidence ID, and "not tested" naming hidden hearts and the unrun kinds. No console errors.
- **DW2:** Approve with an empty or blank name gives an alert, no `run.decision`, a decision GET 404 and export 409. The API refuses a blank `by` (400).
- **DW3:** a name and note, then Approve, shows "Approved by". `run.decision`, the decision GET, the export and the final design all carry it, it survives a reload, and the buttons are gone.
- **DW4:** Reject without a note gives an alert and nothing is saved. Reject with a note (the scripted replan model is injected into the POST body via `page.route`) shows the note. `run.decision` is rejected, the final design is refused, the linked replan run starts at Fixer `propose` (no investigate) from the parent design and gives a new proposal shown on its review page. In-process, `replanAfterReject`'s first Fixer prompt contains the note, and the limits carry over.
- **DW5:** the rendered text, plus aria-label, title, placeholder and alt, on every screen (the review page before and after both decisions), plus run event texts and API messages, contain no whole-word "safe" or "ready", "clinically validated" or "approved for use".
- **DW6:** with no decision, the final design and export give 409 with no design or evidence in the body. An unknown run gives 404.
- **DW7:** the verdict label and each `notShown` line are visible. The verdict must exist, which needs REQ-11.

## Risks
- **Interpretation, flagged:** the REQ-5 `/api/runs/[id]/export` stays ungated, because `req-5.spec.ts` exports undecided runs and expects 200. The approval-gated "export" is `/api/review/[id]/export`. If the merger wants the REQ-5 export gated too, the REQ-5 spec must change first.
- REQ-11 shape changes (verdict placement): read `proposal.verdict` and `notShown` from `run.proposals`, and adapt the reading, not the spec.
- With no key, the default live replan stops with `model-error`. REQ-12 and REQ-17 own live wiring and fallback.
- Run `req-1`, `req-5` and `req-11` as regression checks (store edit, review page shell).
