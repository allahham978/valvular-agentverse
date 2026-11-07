# Agent rules

Every agent reads this and `PRD.md` first. UI agents also read `docs/design-brief.md`. If these rules conflict with the PRD, these win.

## Approach

- Think about the high-level architecture first: how this piece fits the whole system, and what later requirements will need from it.
- Make the simplest change that passes the tests and looks good. No speculative features, abstractions or config.
- Reuse existing components and libraries before writing your own.
- Stay inside your requirement's listed files. If you truly need another file, keep the change minimal and say why in your result.

## Code style

- Keep comments minimal, only where the code can't explain itself. No narrating comments or banners.
- Clear names, small functions and strict TypeScript. No `any` to silence errors.

## Git

- Commit author must be `mohammadallahham978 <mohammadallahham978@gmail.com>`. Don't change git config, and check with `git log -1 --format=%ae`.
- **Never push and never touch a remote.** All commits and tags stay local for now.
- Work on your own branch, in your own worktree under `../valvular-worktrees/`. Only the merger touches `main`.
- Small commits with short, plain messages, ending with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never commit `.env*` files, `data/raw/`, or anything from `real_cohort`.

## Tests

- The spec `tests/e2e/req-N.spec.ts` is written first and must fail first.
- Builders must not edit or weaken the spec, skip tests or fake results. If a spec is truly wrong, stop and report it.
- `npm run verify` must stay green. Passing means actually run and seen passing.
- Run Playwright and dev servers on port `3000 + N` for REQ-N (`PORT` env var), so parallel sessions don't collide.
- `@gpu` and `@live` specs don't run in `verify`. The lag test is marked `pending` in this batch, because a human runs it later with nothing else running.
- Use the Playwright MCP tools for screenshots if available. Otherwise use Playwright's screenshot API, with WebGL enabled.

## Secrets and data

- The Gemini key is in `.env.local`. Never print, log or commit it, and never put it in a command line.
- The dataset zip is at `data/raw/verstraeten.zip` in the main checkout. Read only `virtual_cohort`. Never extract `real_cohort`.
- Label synthetic, sample and illustrative content as `docs/design-brief.md` requires.

## Design skills

- Build with `ui-ux-pro-max`.
- Use `design-taste-frontend` for audits only: its anti-slop, consistency, accessibility and "Never" guidance. Ignore its marketing-page rules: heroes, one section per screen, dealt styles, stock photos, big scenes and no captions. Don't run its scripts or `gate.mjs`.
