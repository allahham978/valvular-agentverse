# REQ-16 visual audit (one round)

Screenshots come from commit ab99f27, served by `next start` on port 3016 with WebGL on (SwiftShader). Runs used the scripted model through the real tools, the same setup as the spec. There were no console errors. States shot: empty (1), undecided (2), Approve with no name (3), approved after a reload (4), Reject with no note (5), rejected with the replan link (6), and the replan run's review (7). Each was shot at 1440x900 and 1920x1080, as a viewport shot plus a `-full` page shot.

## Scores

| Rubric | Score | Note |
|---|---|---|
| First impression | 3 | Seven same-weight white boxes in a 768 px column pinned to the left. About half the screen is empty at 1440 and 60% at 1920. Nothing pulls the eye to the change or the decision. |
| Clarity | 3 | The before and after sets aren't labelled, the added size isn't marked, and the decision form sits below the fold at both sizes (items 2-4). |
| Craft | 4 | Spacing, section labels, mono sizes and focus rings are consistent. Small issues are in items 5-6. |
| 3D quality | n/a | This screen has no 3D. |
| Restraint | 4 | No decoration and no status colours. Hidden hearts show up in both "What the verdict does not show" and "Not tested", but DW1 and DW7 need both. |

## Under 4

### First impression: `src/app/review/page.tsx`, `src/components/review/index.tsx`

1. **The page reads as a plain form, not a review.** `main` is `max-w-3xl` with no `mx-auto`, so the content hugs the left edge (`2-undecided-1920x1080`). The fit change, the main result, is 14 px mono at the same weight as the body text. Fix: at `lg`, make `main` a centred two-column grid (`mx-auto max-w-6xl grid grid-cols-[minmax(0,1fr)_360px] gap-8`). Put the evidence sections in the left column, and put the verdict plus `DecisionForm` / `review-decision` in a right column with `sticky top-8 self-start`. In "The change", show the fit as `text-3xl font-mono tabular-nums` `59.8% → 66.8%`, with a muted `+7.0 pts` after it.

### Clarity: `src/components/review/index.tsx`, `src/components/review/decision-form.tsx`

2. **Before and after aren't labelled, and the new size isn't marked.** The two chip rows are headed only by design labels ("Starting valve", "Added 29 mm size"), so a judge has to compare the rows to find what changed. On the replan page the new size is appended out of order: `23 25 27 21 mm` (`7-replan-review-1440x900`). Fix: in `Sizes`, add a small muted "Before" / "After" caption above each label. Sort the sizes by `nominalMm`. Give a size missing from the parent `border-accent text-accent`, and an `aria-label` / `title` like "29 mm, added". Don't use status colours.
3. **The decision is out of sight.** The Name/Note form starts at about y=1360 in both viewports (`2-undecided-full-*`), so on first view an engineer can't see that this page asks for a decision. Fix: the sticky right column in item 1. Without that layout change, at least move `review-verdict` and the form above "Evidence log", and give the form an `h2` "Your decision" styled like the other section titles.
4. **The rejected outcome is out of order.** In `6-rejected-*`, the engineer's note comes after the "Open the new proposal from the Fixer" link, so it reads as a caption for the link. Fix: in `Outcome`, render the note (as "Note: …") straight after the "Rejected by … Sent back to the Fixer." line, and put the link last.

## Below the bar but not scored under 4

5. Craft: every evidence row ends in "computed", so the source column adds noise without information. Keep the source (DW1), but put tool and source in fixed-width columns (`grid grid-cols-[auto_auto_1fr] gap-x-4`) so the IDs, tools and sources line up.
6. Craft: `Sizes` renders a stray `{" "}` before each chip value. It's invisible now because flex trims it, but remove it.
7. The replan run's review (7) doesn't say it came from a rejection, or what note it answers. The PRD doesn't ask for this, so it's not a defect. The Orchestrator can decide whether to show "Replan after: <note>".
8. The `notShown` line "Only these attacks ran: measurement_shift 1 (survived)." shows the raw kind name. It's rendered word for word, as DW7 requires. Any change belongs in the REQ-11 wording, not this screen.
