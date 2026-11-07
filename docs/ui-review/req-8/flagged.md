# REQ-8 visual audit (one round)

Screenshots were taken from commit 17e4418 using `next start` on port 3008, with WebGL on (SwiftShader) and no console errors. The scripted run covered: idle (1), breaking (2), broken (3), tool call open (4), after Fix it (5), feed scrolled to the end (6) and a feed close-up (7). Each was shot at 1440x900 and 1920x1080.

## Scores

| Rubric | Score | Note |
|---|---|---|
| First impression | 4 | The panels are quiet and clinical. The feed streams visibly and the buttons read as one set. |
| Clarity | 3 | After Fix it, the feed doesn't show the new content (items 1-3). |
| Craft | 4 | Spacing, dividers, actor labels and `29 mm` mono are consistent. Small issues are in items 4-5. |
| 3D quality | 3 | REQ-8 didn't change it. The leaflets still render grey and crumpled. See items 9-10 in `docs/ui-review/req-4/flagged.md`, owned by REQ-2/REQ-3. |
| Restraint | 4 | Nothing decorative. Minor duplication is in item 6. |

## Under 4: Clarity (src/components/feed/index.tsx)

1. **The feed doesn't follow new events.** At 1440x900, `5-fixed` looks the same as `3-broken`. The proposal, the "Code: Added 29 mm size fits 57.3%" evaluation and the attack all land below the fold, so after clicking Fix it a judge sees no change in the feed (Done when 4). The same happens during Break: the second finding, "Thin overlap between sizes", is cut off in `3-broken-1440x900`. Fix: when `events.length` grows, scroll the `ol` to the bottom (`el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })`) unless the user has scrolled up more than about 40 px from the bottom.
2. **Findings, the proposal and attacks look alike.** The finding "Annulus above the largest size" and the attack "Hearts near 27 mm now sit at the size edge" have the same style and the same "Breaker" label. The proposal rationale ("Add a 29 mm size covering…") is plain body text, like narration. Fix: add the event kind to the actor line ("Breaker · Finding", "Fixer · Proposal", "Breaker · Attack"), and make the proposal `font-medium` like findings and attacks.
3. **The tool call result is hidden when opened.** In `4-tool-call-open-1440x900`, the Input block fills the rest of the panel and the Result block is clipped at the panel's bottom edge, so clicking shows only half of Done when 2. Fix: when it opens, call `scrollIntoView({ block: "nearest" })` on the expanded block, and cap each `pre` at `max-h-32` so both fit at 1440x900.

## Below the bar but not scored under 4

4. Craft: the "(show)"/"(hide)" text in parentheses reads like debug output. Use a small rotating chevron icon (lucide `ChevronRight`, already used through shadcn) and keep the accessible name, which includes the tool name.
5. Craft: each tool call row repeats the full actor label line above a bordered chip, so four tool rows take about 280 px at 1440. Put the actor label inline before the chip on the same line, or drop the label when it matches the previous event's actor.
6. Restraint: the evaluation text ends in "[Sample data]" while the panel header already shows the "Sample data" label. The text comes from the stand-in tools on the server, so it's left as is. Remove it at REQ-9/12 when real numbers replace the stand-ins.
7. Clarity, wall (outside REQ-8's files): the 8 new amber hearts are only visible as Risk 90 → 98. Nothing marks which dots changed. Consider a brief ring on newly changed dots in `src/components/wall/`, in a later requirement.
8. After the run ends, both buttons stay disabled and nothing says the run is complete. The PRD doesn't ask for a rerun, so this isn't a defect. It's noted so the Orchestrator can decide.
