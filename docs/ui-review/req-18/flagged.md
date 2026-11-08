# REQ-18 visual review

One review round, 8 November 2026. Production build, Chromium with WebGL enabled, at 1440×900 and 1920×1080. Inspected all three screenshots and compared typography, colour and labels with `docs/reference/workbench.png`.

| Design-brief criterion | Score | Observation |
|---|---|---|
| First impression | 4/5 | Quiet reference page with a clear title and consistent clinical styling. |
| Clarity | 5/5 | Dataset, generation, limits and credit have distinct headings; limitations are easy to scan. |
| Craft | 4/5 | Consistent spacing, aligned dividers, readable body text and Geist Mono tabular figures. |
| 3D quality | Not applicable | This requirement is a text reference page; no 3D content added. |
| Restraint | 5/5 | No hero, cards grid, animation or decoration. Labels and source links carry useful information. |

No applicable score is below 4. No visual fixes or further review rounds were needed.

## Evidence and limits

- `about-1440x900.png`: initial viewport. The document is 987px tall, so the final credit requires a short scroll.
- `about-1440x900-lower.png`: bottom of the same document, showing the complete credit and licence qualification.
- `about-1920x1080.png`: the complete page fits in the viewport.
- No horizontal overflow at either size. Source links have a visible 2px keyboard-focus outline; headings and source links have descriptive names. Existing `SiteHeader` and `DataLabel` are retained.
- Applied `ui-ux-pro-max` text readability guidance. Used `design-taste-frontend` only for plain copy, consistency, accessibility and restraint; no marketing rules or skill scripts.
- Projector viewing was not tested on physical hardware. 3D and GPU performance are outside REQ-18.

## Source limitations

The required files identify a shape model built on 97 patients but do not give its sampling algorithm or training procedure. Those details are omitted. The heart-model licence is still being confirmed; the page preserves the exact qualified credit and does not strengthen it.

## Verification record

- Attempt 1: production build failed because the sandbox blocked Turbopack's internal port binding; no specs ran.
- Attempt 2: the same cached build error recurred outside the sandbox; no specs ran. A separate local port-binding check succeeded, then generated `.next` output was cleared.
- Attempt 3, before implementation: production build passed; REQ-18 + REQ-1 gave 28 passed, 6 failed, 2 existing skips. All six failures were missing About sections/headings, as intended. Committed the plan and failing spec before implementation.
- Attempt 4, after implementation: production build passed; the unchanged REQ-18 + REQ-1 specs gave 34 passed, 0 failed, 2 existing skips. All six REQ-18 tests passed.
- Attempt 5, full verification after fetching/rebasing on `origin/main`: typecheck passed; lint passed with two existing warnings; data check stopped because `VALVULAR_DATA_ZIP` pointed to `/full/path/to/verstraeten.zip`. No specs ran. No local archive was found, so the official ZIP was requested into gitignored `data/raw/` for the next run; no source, spec or configuration changes were made to bypass the check.
- Attempt 6, full verification after refreshing/rebasing on `origin/main` again: `VALVULAR_DATA_ZIP=/Users/dash/valvular-worktrees/req-18/data/raw/verstraeten.zip PORT=3018 npm run verify` exited 0. Typecheck, lint, data check and production build passed; Playwright reported 245 passed, 0 failed, 2 existing skips in 9.3 minutes, including all six REQ-18 tests.

The downloaded archive matches the published MD5 and remains gitignored. The two lint warnings are unchanged unused variables in `research_notes/Valvular build/res-2/run.mjs` and `scripts/screenshot-batch-2.mjs`. The two skips are REQ-1's existing checks for replaced wall/feed stubs; no spec was edited, weakened or skipped for REQ-18. Six attempts were counted conservatively, including the environment failures.
