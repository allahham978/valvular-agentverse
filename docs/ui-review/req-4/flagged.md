# REQ-4 unresolved visual findings

## Expanded wall (src/components/wall/expanded-wall.tsx)
1. (Fixed: overlay header now has its own Synthetic test hearts label.) Brief breach: the overlay covers the header's "Synthetic test hearts" label and shows no equivalent. Add it to the overlay header, independent of the Sample data label, which goes away when real data connects.
2. (Mitigated: footer says "400 hearts. Scroll for more rows."; still scrolls.) Clarity: at 1440x900 row 11 ends about 5px above the panel edge, so the wall looks complete with 209 hearts showing and 191 hidden (scrollHeight 1574, clientHeight 789). Size cells so all 400 fit without scrolling (story: "see all test hearts at once"). If thumbnails become too small, keep scrolling but add a visible "400 hearts" count and a clear cue that more rows exist.
3. Hover ID: "sample-031" wraps to two lines and covers the lower half of the thumbnail at both sizes (expanded-wall-thumb-hover-*.png). Stop it wrapping and fit it to the cell, or show the hovered ID in the header.
4. Alignment: grid left edge doesn't match the title (58 vs 45 at 1440, 66 vs 45 at 1920), and the right edge doesn't match the close button. Remove justify-center; use repeat(auto-fill, minmax(size, 1fr)) with square cells. Also helps the lone sample-400 on the last row at 1440.
5. Restraint: every thumbnail has a saturated 2px border plus a corner dot showing the same status; it reads as 400 coloured boxes, not 400 hearts. Keep the wall-thumb-status marker (spec requires it) and replace the border (status.ts cell class) with a neutral hairline or very light status tint.

## Popup (src/components/heart-panel/)
6. Alignment (index.tsx): on risk and no-fit hearts the 3D view stops short of the button row, leaving an empty block (view bottom 548 vs buttons 613 at 1440; 678 vs 723 at 1920). Stretch the view to the full column height in every state.
7. Caption (heart-view.tsx): "Drag to rotate" nearly touches the root at rest, and the rotated root reaches it (popup-rotated-1920x1080.png). Reduce SIZE, lift the model, or move the caption outside the 3D area.

## Type, brief breach
8. "Drag to rotate" (heart-view.tsx) and "In main view:" (wall/index.tsx) use Geist Mono but are labels, not measurements. Switch both to Geist Sans; keep the heart ID in mono.

## Root 3D quality (src/components/root-view/index.tsx, heart-scene/studio-lighting.tsx)
9. Pale rectangular patches and jagged white streaks read as crumpled plastic, in main view and popup. Likely sharp reflections of rectangular Lightformers at roughness 0.12 with full clearcoat (untested). Fixture mesh is fully welded (6039/6039 unique vertices), so seams are not the cause. Try roughness ~0.4, clearcoatRoughness ~0.3, lower envMapIntensity, softer and larger light shapes, then re-check. Coordinate with REQ-3, which owns this scene.

## Leaflets, brief breach (blocked, not a pass)
10. Brief asks for solid, light leaflets; they render as dark overlapping translucent layers. The fixture is one mesh and one primitive, so leaflets can't get their own material on this branch. REQ-2 or REQ-3 must provide leaflets as a separate mesh or material group.

## Minor polish (not blocking alone)
- a) "In main view" line appears only after a heart is sent, pushing the feed panel down 28px; reserve the space.
- b) Legend numbers use fixed 3ch width, so the gap after "Risk 90" is wider than after "Fit 219".
- c) Margins use a hyphen ("-0.7 mm"); use a true minus sign.
- d) Popup has a Close button but the overlay has an X; pick one pattern.

## For the Reviewer (not visual)
Round 3 changed files outside the plan's list: root-view, heart-scene/studio-lighting.tsx, tokens.css, ui/button.tsx, data-label. Reasons are now recorded in docs/plans/req-4.md. The global DataLabel restyle was reverted.
