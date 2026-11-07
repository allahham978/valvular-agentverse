# REQ-3 flagged visual findings

## Fixed in this round (needs auditor recheck on stills and real GPU)
- Leaflet cut: now along the smoothed score's 0.5 isoline (boundary triangles split), smooth curve. Wall is the full mesh, continuous behind leaflets.
- Leaflet material: warm off-white, emissive 0.15. Wall: paler tint plus sheen for a rim, no custom shader.
- Depth pre-pass for leaflets while fading.
- Mid-zoom: heart fade starts at 0.3, root ease 1.5 (was 2.5). Label swap at 0.6.
- Aorta tint blend widened (build-heart.ts), heart.glb rebuilt. Opening cue and button moved down (bottom-6).
- Landing view tilted 0.3 rad downward (LANDING_TILT).

## Still open
- BLOCKER, clarity: the sample root mesh does not split into three clean cusps. At landing and after rotation the leaflets read as one grey bowl plus a few shards. Needs the Planner: a better source mesh (REQ-2/REQ-7) or a procedural cusp model. Not polished further.
- Heart minor: crumbly ventricle bottom edge and crease at about (1340, 1110) in 1440-1d not touched.
- Fresnel rim and mid-zoom balance unchecked on a real GPU.

## Owned outside REQ-3, route to REQ-4 / REQ-8
- '29 mm' and '1 mm' spacing in feed/index.tsx.
- Wall dots stretched at 1920 (about 17 x 14 px pitch) in wall/index.tsx.
- About 280 px of empty feed panel at 1920.
- Panel type not scaled up at 1920 for projector legibility.
- Dashed 'Fix it' border in controls/index.tsx does not match 'Break it'.
