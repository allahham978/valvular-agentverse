# Requirement status

| Requirement | Branch / base | Status | Validation | Build attempts |
| --- | --- | --- | --- | --- |
| REQ-14 Results | `req-14` / `step-1-pass` | Passed with labelled sample data pending REQ-13 | `PORT=3014 npm run verify`: 35 passed, including all 5 REQ-14 tests; desktop visual review passed | 3 of 8 |

## REQ-14 verification record

- The acceptance spec was written before implementation and stayed unchanged afterward.
- An existing development server held the worktree's development lock on port 3000. It was left running. Test and screenshot production servers used port 3014.
- Build 1: normal shell build stopped at typechecking because the spec imports the not-yet-implemented Results components.
- Build 2: compile-only shell build succeeded to enable the failing-first browser check. `PORT=3014 npx playwright test tests/e2e/req-14.spec.ts --max-failures=1` failed on the missing Hidden-heart comparison table, as expected.
- Build 3: implemented Results; full `PORT=3014 npm run verify` passed typecheck, lint, the existing data check, normal production build and all 35 tests. The data check reports its foundation-stage skip because `data/hearts.dev.json` is absent.
- Captured and inspected Results at 1440x900 and 1920x1080. See `docs/ui-review/req-14/audit.md`. GPU lag test: pending human run.
- Shared contracts, foundation tests, header, data label and design tokens were unchanged. Additional documentation paths are the required plan, status log and UI review artifacts.
