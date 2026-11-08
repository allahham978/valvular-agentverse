# REQ-14: Results

## Done when (verbatim)

1. User opens `/results` → sees the proposal and three baselines side by side, with hidden-heart coverage, new risks and designs tried.
2. A baseline ties or wins → user sees that shown as clearly as a win.
3. User reads the page → sees the output line, how many times hidden hearts were scored, and "Test hearts, not patients. All hearts come from one generator."

## Implementation

- Start from `step-1-pass` on `req-14`, as requested. Use explicitly labelled sample results until REQ-13 is merged.
- Keep the shared header, data label, contracts, stage, tokens and foundation test IDs unchanged.
- Add a server-rendered ResultsComparison taking typed scores built from existing Summary, Baseline and Run contracts. Isolate sample data in the results component directory so future scoring can replace it without changing presentation.
- Use one semantic table with equal-width columns for the proposal and all three baselines. Show percentage and numerator/denominator coverage, new risks relative to the starting design, and designs tried. Mark outcomes by coverage with identical neutral styling; do not imply risk or search cost is part of that ranking.
- Interpret the unspecified output line as a concise proposal summary: hidden-heart coverage, change from no change, new risks and designs tried. Show hiddenScoreCount unchanged on page reads, and the exact generator limitation.
- Follow the clinical brief and reference screenshot: off-white background, white bordered panel with a slight shadow, Geist type, mono measurements, restrained teal navigation. No design-brief changes.
- Write and run the spec against the shell first. Freeze it before implementation. Verify both desktop sizes, all three comparison outcomes, disclosure and parameterized score rendering. Run on PORT=3014. Stop at eight build attempts.
- Capture both desktop sizes using Playwright's screenshot API with WebGL enabled; Playwright MCP is unavailable. Record visual audit and verification results.

## Scope notes

Application and test edits stay within the REQ-14 file list. This plan, docs/status.md and docs/ui-review/req-14 are the additional documentation paths required by the repository workflow. The ui-ux-pro-max and design-taste-frontend skills are unavailable in the installed skill directories; the complete design brief and foundation reference guide implementation and audit directly. GPU lag test remains pending for a human.
