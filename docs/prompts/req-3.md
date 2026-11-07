# REQ-3 prompt log

## Attempt 1: `failed/req-3-1`

**What went wrong:** the Builder died. The cause is unknown, because no error was recorded in the repo.

**What the worktree showed:**
- Only the plan and spec were committed.
- Untracked and complete: `public/models/heart.glb`, `public/models/heart.credit.txt`, `scripts/models/build-heart.ts`.
- Untracked and untested in the browser: `src/components/root-view/leaflets.ts`.
- `heart-scene` and `root-view/index.tsx` were unchanged, so no scene code existed.
- No server or browser was left running.

The untracked files are now committed on `failed/req-3-1` (`a9e9bd4`), so nothing was lost when the worktree was removed.

## Attempt 2: what changed

**More specific instructions** (in `docs/plans/req-3.md`):
- Restore the finished asset work from `failed/req-3-1` first, instead of redoing it.
- Work in milestones M0 to M6, each with its own test filter, and commit after each one. Uncommitted work was what attempt 1 lost.
- Run only the current milestone's tests. Run the whole spec and `npm run verify` once, at M6.
- Run long test runs in the background, and let Playwright own the server, so that no server can outlive a run.
- After 3 failed runs of the same test, read the failure output before changing more code.
- All RES-3 values are in the plan, so the Builder doesn't need to re-read it.
- Polish after the tests are green, not between milestones.

**Spec changes:**
- Behaviour tests now run at 960x600 to reduce software rendering load. The panel-scroll and canvas-capture tests stay at 1440x900, and so does `@gpu`.
- Fixed a race: the probe reported ready before the root had loaded, which made `cameraToRoot` `NaN` and failed two tests at random. It now waits for both models.
- Fixed a race: the opening test read `firstHeartFrameMs` once. It now waits for the first drawn frame.
- The beat count is checked only with at least 20 samples in its 3.2 s window, because a 1 Hz beat can't be counted below about 6 fps. The beat's size and the turn are still always checked.
- The drag and clip areas now fit the smaller viewport and stay clear of the panels, whose red dots would otherwise fail the "no red heart remains" check.

**Unchanged:** the approach, test contract, file list, licence hold and every Done-when. `@gpu` stays written but not run, so it's pending.
