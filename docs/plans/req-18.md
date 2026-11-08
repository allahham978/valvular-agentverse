# REQ-18 plan: About page

## Sections and sources

Build a quiet reference page in `src/app/about/page.tsx`, retaining `SiteHeader` and using `DataLabel`, existing Tailwind tokens, Geist Sans and Geist Mono with tabular figures. Use one readable text column, semantic headings, hairline section dividers and visible link focus. No hero, cards, new dependencies or contract changes.

| Section | Facts and source | Test ID |
|---|---|---|
| Dataset | Verstraeten et al. 2023; virtual cohort of 500 synthetic stenotic aortic roots; CC BY 4.0; source URL and `virtual_cohort` from `data/sources.json`. `real_cohort` is not used, per PRD §2 and handoff. | `about-dataset` |
| How the hearts were made | One shape model built on 97 patients, from PRD §7 and REQ-18. 400 dev / 100 hidden; fixed seed and annulus-band stratification with seeded shuffling and largest-remainder allocation, from `data/sources.json` and PRD §2. | `about-generation` |
| Limits | Fit only; test hearts, not patients; no safety claims; no coronaries or calcium and therefore no coronary-risk calculation; stenosis only; both splits from one generator and hidden scores do not measure real-world performance; `demo-assumption` fit rules are placeholders. PRD §2, §3, §7 and handoff. | `about-limits` |
| Heart model credit | Exact text from `public/models/heart.credit.txt`, an Illustrative label, NIH source link and licence confirmation still pending from `research_notes/Valvular build/RES-3.md`. | `about-heart-credit`, `about-credit-line` |

Numeric spans use `about-figure` for checking Geist Mono and tabular figures. Each section has a named heading; the page retains its About heading and existing header link.

## Tests and delivery

Write `tests/e2e/req-18.spec.ts` before implementation, matching REQ-1's Playwright style. Check visible dataset attribution/licence/source, generation and split, every required limit, exact heart credit with qualified licence, prohibited wording, and legible layout at 1440×900 and 1920×1080. Build and run it with REQ-1 on port 3018, one worker; confirm failure on missing content before committing the plan/spec. Never alter the spec after the first run. Limit build/test attempts to eight, including the initial failing run conservatively.

After implementation, capture and inspect both desktop screenshots once in `docs/ui-review/req-18/`. Apply `ui-ux-pro-max` readability guidance and `design-taste-frontend` audit guidance only; score the brief's rubric and flag anything below 4 without further audit loops. 3D quality is not applicable to a text reference page. Rebase on latest `origin/main`, observe `PORT=3018 npm run verify` exit 0, commit, tag `req-18-pass`, push only this branch/tag, and stop owned servers/browsers.

## Risks and scope

- The sources describe a shape model built on 97 patients but do not describe its sampling algorithm or training procedure. Omit those details rather than inventing them.
- Heart-model licence remains unconfirmed: preserve the exact “listed as CC0 1.0” credit and make no stronger claim. No asset changes.
- Do not read `server-data/hearts.hidden.json`, raw cohorts, or secrets during implementation. Existing verification runs as requested.
- Plan and visual-review artifacts are the handoff's expressly requested additions outside the PRD implementation paths. No other changes planned.
- The user's git instructions override the repo's local-only and author rules. Use Codex's own commit identity without changing repository config; never touch main or move an existing tag.
