# REQ-15 visual audit (one round)

I took the screenshots from commit e010710, after a fresh `npm run build`, using `next start` on port 3015 with WebGL on (SwiftShader). The judge's requests went to the real server, with the request's `model` swapped for the spec's scripted transcripts. The only console errors were the two expected 422 refusals per viewport.

I shot each state at 1440x900 and 1920x1080. Each state has a full-viewport shot and a `-panel-` crop of the judge panel:

1. `1-idle`: the panel as it first loads, with engine totals.
2. `2-slider-moved`: the largest size moved to 29 mm, with Replan offered.
3. `3-breaker-result`: the run restarted at the Breaker and finished.
4. `4-parsed-limit`: "no more than 4 sizes" parsed as "Max sizes: 4", with Confirm and Discard.
5. `5-fixer-result`: the run restarted at the Fixer and the final design has 4 sizes.
6. `6-refused-safety`: "make it safe for all patients" refused as outside fit.
7. `7-refused-injection`: the injection text refused, with no hidden data shown.
8. `8-no-design-fits`: "fit at least 100% of hearts" leads to "No design fits".

All seven "Done when" states can be seen on screen.

## Scores

| Rubric | Score | Note |
|---|---|---|
| First impression | 4 | A quiet white panel in the brief's palette, using the existing Button. It sits above Controls without clashing. |
| Clarity | 3 | The result area reads like a debug log. A judge can't tell what the final design is, or which limit it obeys. See items 1 to 4. |
| Craft | 3 | The panel doesn't match the wall's type system and doesn't scale at 1920. Size lists wrap in the middle of a unit. See items 5 to 8. |
| 3D quality | 3 | REQ-15 didn't change the scene. The leaflets still look grey and crumpled, and the teal REQ-7 valve isn't visible. This is already flagged in `docs/ui-review/req-4/flagged.md` items 9 and 10, owned by REQ-2/3/7. |
| Restraint | 4 | Nothing decorative. The step log (item 1) is the only extra noise. |

## Under 4: Clarity (src/components/judge/replan-status.tsx, src/agents/limits/parse.ts)

1. **The step list shows raw identifiers.** Under "Restarted at the Fixer" it prints `fixer started propose.`, `breaker started attack.` and `fixer started propose.` at 12 px, in lowercase with full stops. This is the orchestrator's `event.text`, and it reads like a server log. Fix: render each step-start from `event.actor` and `data.step` with the feed's wording, for example "Fixer · Propose", "Breaker · Attack". Capitalise the actor and use sentence case for the step, with no trailing full stop. Keep `text-xs` but use `text-foreground/70` so it doesn't compete with the heading.
2. **The stop text seems to contradict the result.** In `5-fixer-result`, "Added larger size does not beat the current design." sits right above "4 sizes: 23 mm, 25 mm, 27 mm, 29 mm". That reads as if the 4-size design failed, when it's actually the final design (the *second* proposal didn't beat it). In `3-breaker-result`, "Keep the judge's valve does not beat the current design." is also ungrammatical, because the proposal label is used as the subject. Fix: give the two lines their own labels. Put a small muted "Run stopped" label before the stop text, and start the design line with "Final design:" (for example "Final design: 4 sizes, 23 / 25 / 27 / 29 mm"). Leave the stop string from REQ-11 as it is.
3. **The confirmed limit disappears.** Once "Confirm limit" is clicked, the "Max sizes: 4" row goes away, and nothing in the result says which limit the final design obeys (Done when 4: "see the final design obey it"). Fix: in `ReplanStatus`, when the run has limits, show one muted mono line under "Restarted at the Fixer", for example "Limit: Max sizes 4". Move `KIND_LABELS` out of `limit-box.tsx` into a small shared export so the parsed limit and this line use the same wording.
4. **The refusal reason lists code identifiers.** "Supported limits: max-sizes, min-fit-pct, max-new-risk." shows raw kind IDs, and at 1440 the browser breaks "max-new-/risk" across two lines. Fix: in the reason builder in `parse.ts`, map each kind to the same plain words the panel uses: "Supported limits: max sizes, min fit %, max new at-risk hearts." Keep "outside fit" in the text, because the spec needs it.

## Under 4: Craft (src/components/judge/index.tsx, sliders.tsx, replan-status.tsx)

5. **The heading doesn't match the other panels.** "JUDGE'S VALVE" is `text-xs uppercase tracking-wide text-muted`. The wall and feed use `text-sm font-semibold` in sentence case ("Test hearts", "Agent feed"). Fix: change it to `text-sm font-semibold min-[1800px]:text-base` and "Judge's valve".
6. **The totals look different from the wall's.** The whole `dl` is mono, so the labels "Fit", "Risk" and "No fit" are mono too, and there are no status dots. The wall uses sans labels with a coloured dot and mono numbers only. Fix: drop `mono` from the `dl`, add it to each `dd` (with `tabular-nums`), and put the same status dot before each label as the wall's `Legend`. `Legend` is exported from `src/components/wall/legend.tsx`, so reuse its dot markup.
7. **The size lists wrap in the middle of a value.** "23 mm, 25 mm, 29 / mm" and "27 / mm, 29 mm" break across lines in the 256 px panel. Fix: list the sizes as "23 / 25 / 27 / 29 mm", one unit at the end, or wrap each `${n} mm` in `whitespace-nowrap`.
8. **The panel doesn't scale at 1920x1080.** The wall moves up to `text-base` with larger controls at `min-[1800px]`. The judge panel stays `w-64` with 12-14 px text and 11 px step lines, so at 1920 it's noticeably smaller than the wall and hard to read on a projector. Fix: add `min-[1800px]:w-72` to the panel, and `min-[1800px]:text-base` to the slider labels, totals and result text (`text-sm` for the step lines), matching the wall's breakpoint.

## Below the bar but not scored under 4

9. Slider focus uses the browser's default blue ring (`2-slider-moved`). The text input uses a teal `focus-visible:outline-accent`. Add the same `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent` classes to the range input.
10. When the page loads, "Check limit" shows as an outlined button with grey text even though it isn't disabled, so it looks disabled. Either disable it while the box is empty (and say so to screen readers) or give it normal text colour.
11. The judge's totals (239/68/93) and the wall's "Sample data" totals (219/90/91) are on screen together with no link between them. The plan expects this until REQ-12 feeds the judge's design to the wall. Note it for REQ-12.
12. The Agent feed still says "Press Break it to start a run." during and after a judge replan, so the restart can only be seen in the small panel text. The plan leaves wiring the feed to REQ-12/19. Note it for them.
