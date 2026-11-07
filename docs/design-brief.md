# Valvular design brief

Every UI agent reads this before planning, building or auditing. These choices are decided. Don't change them without flagging it.

## The feel

**Opening:** feels like an Apple product page. Scroll-driven 3D on a light background, very little on screen and precise motion.

**After the zoom:** a precise clinical tool. Quiet, crisp panels around the 3D model. It must not look like a marketing page.

Borrow the feel only, never another company's code, assets or branding.

**Avoid:** purple gradients, glows, glassmorphism, neon sci-fi HUDs, cartoon hearts, stock photos, decoration with no meaning, and generic dashboard cards.

## Look

| Item | Decision |
|---|---|
| Background | Soft off-white, `#F7F8F8` |
| Panels | White, hairline border, slight shadow, floating over the scene |
| Text | Deep slate, `#1E2A32` |
| Accent | Muted clinical teal, `#0F766E` |
| Status | Green, amber and red, used only for fit status |
| Type | Geist Sans, with Geist Mono for measurements. Tabular numbers |
| Screens | Desktop only: 1440x900 and 1920x1080. Must stay legible on a projector |

## The experience

### 1. Opening

- The beating heart fills the screen on the off-white background, with a soft shadow beneath it.
- It has a gentle beat, about 60 per minute, and a slow turn. Use a subtle code-driven scale pulse, so the model doesn't need its own animation.
- On screen: the Valvular name, the "illustrative" label, a small scroll cue and a small "Zoom to valve" button. No panels.

### 2. Scroll zoom

- **The zoom follows the scroll exactly.** Scroll down moves in, scroll up moves back, and stopping holds that position.
- The heart fades as the real synthetic root appears in the same position, so it feels like one continuous move into the aorta.
- The beat and turn ease to a stop during the zoom.
- The "Zoom to valve" button and arrow keys do the same thing, as a stage backup.
- Motion is smoothed so a trackpad or mouse wheel doesn't feel jumpy.
- With `prefers-reduced-motion`, replace the zoom with a short crossfade.

### 3. Workspace (after the zoom)

- At 100%, the wall, feed and controls fade in over the full-screen root.
- Drag rotates the root. There's no wheel zoom on the root, because scrolling up returns to the heart.
- Scrolling over a panel scrolls that panel only.

```text
+----------------------------------------+
| Valvular       Synthetic test hearts   |
|                             +---------+|
|                             | WALL    ||
|           ROOT + VALVE      | ....... ||
|           (full screen)     | ....... ||
|                             +---------+|
| +----------+                | FEED    ||
| | Controls |                | > ...   ||
| +----------+                +---------+|
+----------------------------------------+
```

## Components

### Heart

Accurate anatomy in a muted, satin red-pink, with the aorta visible and subtly tinted. Smooth surface with a soft clearcoat. No blood or gore. It should look like a premium medical education model. It's fine to replace a sourced model's materials to get this look.

### Aortic root

- Outer wall: soft, translucent and lightly tinted.
- Leaflets: solid and light.
- Valve (from REQ-7): solid, in the accent colour.
- Problem area (from REQ-7): a soft red or amber tint on the wall.
- Render back faces and transparency carefully, to avoid sorting glitches when rotating.
- Lands on a typical heart: the dev heart closest to the median annulus.

### Wall

- **Panel:** 400 small dots coloured by status, plus fit, risk and no-fit totals. Hovering shows that heart's thumbnail and ID.
- **Expand button:** opens a large overlay of all 400 real root thumbnails, coloured by status.
- Clicking any dot or thumbnail opens the heart popup.

### Heart popup

A centred popup with a small rotatable 3D view of that heart, plus its ID, status, measurements, failed rule, limit, margin and rule type.

- Pause the main 3D view while it's open, so there's only one active render.
- An "Open in main view" button closes the popup and loads that heart in the main view.
- Esc or clicking outside closes it.

### Feed and controls in the first batch

- Feed: a few styled example events, labelled "Sample data".
- "Break it" and "Fix it": visible but disabled.
- Wall colours: labelled "Sample data" until the fit engine is connected.

### Required labels

These stay small but visible. Never remove them for looks: "Illustrative" on the heart, "Synthetic test hearts" on the workspace, "Sample data" on anything fake, and "Schematic valve" from REQ-7.

## Reuse before building

| Need | Use |
|---|---|
| UI components | shadcn/ui |
| 3D scene | React Three Fiber |
| Camera path and scroll | drei `CameraControls` or `ScrollControls`, whichever gives the smoothest scrub |
| Model loading | drei `useGLTF`, `Preload` |
| Studio lighting | drei `Environment` with a small local HDRI |
| Soft ground shadow | drei `ContactShadows`, baked once with `frames={1}` |
| Popup 3D view | drei `View` or a second small canvas, with the main view paused |
| Staying smooth | drei `PerformanceMonitor`, `AdaptiveDpr` |
| Model compression | `gltf-transform` with meshopt, and KTX2 textures where used |
| Panel motion | CSS transitions, or Motion if CSS can't do it |

Don't write custom shaders or a custom camera system unless these can't do the job, and record the reason in the plan.

## Rendering rules

- One shared lighting setup for the heart and root, so the transition doesn't jump.
- Cap pixel ratio at 2, and add no heavy post-processing.
- Render continuously while the heart beats or the zoom is moving. Once settled on the root, use on-demand rendering.
- Load one main root at a time.

## Performance targets

Measured on the demo laptop (MacBook Air, M5, 16 GB) in a real browser using its GPU, with no other heavy work running.

| Measure | Target |
|---|---|
| Average frame rate during beating, scroll zoom and rotation | At least 55 fps |
| 95th percentile frame time | Under 25 ms |
| Frames over 50 ms during a zoom | 2 at most |
| Time to a visible heart | Under 3 seconds |
| Heart model file | Under 5 MB |
| Root mesh file | Under 300 KB |

## Visual audit

The auditor scores screenshots of the opening, mid-zoom, workspace, expanded wall and popup from 1 to 5. Every score must be at least 4:

1. **First impression:** would a judge look twice in the first 3 seconds?
2. **Clarity:** is it obvious what this is and where to look?
3. **Craft:** are spacing, alignment and type consistent?
4. **3D quality:** clean edges and lighting, with no z-fighting, popping or flat shading?
5. **Restraint:** could anything be removed without losing meaning?

List each problem and fix it, then audit again, with up to 3 rounds. If a score is still under 4, flag it in `docs/ui-review/` instead of passing it.
