# REQ-1 flagged visual findings (unresolved)

Audit of the Round 3 code. Round budget is spent, so scores under 4 are flagged here instead of passed.

## In REQ-1 scope

1. 3D: jagged white streaks and hard-edged rectangular patches on the root wall (`src/components/heart-scene/index.tsx`, `src/components/root-view/index.tsx`). They read as crinkled cellophane, clearest in `workspace-root-detail-2x.png`. Likely cause, not verified: thin Lightformer at intensity 6, 64px Environment, roughness 0.12 mirroring uneven normals from the reduced mesh. Fix: replace the Lightformers with the small local HDRI the brief requires, raise wall roughness to about 0.35-0.5, and drop clearcoat and envMapIntensity until highlights are broad and soft.
2. 3D: broken-looking step in the root silhouette, about (645,645) in `workspace-1440x900.png` and (850,645) in `opening-1440x900.png`. The wall ends in a flat notch and a leaflet tip pokes past it. Check whether it comes from Case_1 or the weld and compression in `scripts/fixtures/build-root-sample.ts`. If it is in the source mesh, set a default rotation that hides it from the first view.
3. Craft: measurement spacing in `src/components/feed/index.tsx`. "29 mm size" has a wide gap before "mm" and almost none after, and the "mm" letters are squeezed (`feed-mono-detail-3x.png`). Remove tracking-tighter, stop the mono span swallowing the space, use a non-breaking thin space between number and unit, and keep normal word spacing after the unit.
4. Craft: wall grid at 1920 (`src/components/wall/index.tsx`). Dots are about 17px apart horizontally and 14px vertically, so the grid looks stretched, while 1440 is nearly square. Use a fixed square pitch or an aspect-square cell, and centre the grid or size dots to fill the column.
5. Projector legibility at 1920 (`src/styles/tokens.css`, panel text). The column widens from 380px to 460px but feed text and totals stay 14px, and the "Synthetic test hearts" and "Sample data" labels stay 13px. Scale panel type up at the min-width 1800px breakpoint, to about 16px body and 14px labels.
6. Craft: empty feed panel (`src/components/feed/index.tsx`, `src/app/page.tsx`). About 280px of blank panel below the last event at 1920, about 100px at 1440. Size the panel to its content up to a maximum height, and scroll past that.
7. Clarity: disabled controls (`src/components/controls/index.tsx`). The dashed Fix it border reads as a placeholder or drop zone, and the two disabled buttons use unrelated styles. Use a solid border, make the two buttons look like one disabled set, and keep Break it primary.
8. Label accuracy on `/` (`src/app/page.tsx`). A real synthetic root is labelled "Illustrative", but the brief reserves that label for the heart model. Until REQ-3 merges, either show no root at stage 0, or accept this explicitly as a temporary stub and record it in `docs/plans/req-1.md`.
9. Restraint: `/about` (`src/components/site-header/index.tsx`). The PRD requires the "Synthetic test hearts" label on workspace, results and review only, and About shows no heart data. Consider hiding it there. Minor.

## Handed to later requirements (do not build in REQ-1)

- REQ-3: replace the opening root with the satin heart, add the beat, turn, scroll cue and Zoom to valve button, add drag rotation, and pass the opening and mid-zoom audit. Opening First impression and Clarity cannot reach 4 before this.
- REQ-4: dot hover, expanded wall and popup; audit once they exist.
- REQ-7: solid, light leaflets and the Schematic valve label. Workspace 3D quality and First impression stay limited until then, because the darkest, most eye-catching shape is the leaflets the brief wants light.
- REQ-14, REQ-16, REQ-18: replace the near-empty shells, which account for their First impression score of 1.

## Notes for the orchestrator

- Audit rounds: the brief allows up to 3 and history already shows Round 2 and Round 3 polish. Decide whether REQ-1 is judged only on the fixes above, since the opening's low scores cannot be fixed in this scope.
- The earlier commit message says "round 4", but that run was the audit of the Round 3 code.
- `workspace-after-drag` and `workspace-dot-hover` are committed but match the base workspace pixel for pixel, so they show no working interaction.
- No app code changed. Untracked `AGENTS.md` left uncommitted.
