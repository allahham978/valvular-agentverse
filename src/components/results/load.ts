import type { Run } from "@/contracts";
import { loadReplay, DEFAULT_REPLAY_ID, replayRun } from "@/replay";
import { getRunView, saveRun } from "@/run/store";
import { loadReport, saveReport, scoreAndRecord, type ScoreReport } from "@/scoring";

const MAIN_PATH_RUN_ID = "results-main-path";

export type ResultsData = { run: Run; report: ScoreReport } | { missing: string };

async function mainPathRun(): Promise<Run | null> {
  const saved = getRunView(MAIN_PATH_RUN_ID);
  if (saved?.status === "finished") return saved.run;
  const file = loadReplay(DEFAULT_REPLAY_ID);
  if (!file) return null;
  const run = await replayRun({ ...file, turns: file.turns.map((turn) => ({ ...turn, delayMs: 0 })) }, { id: MAIN_PATH_RUN_ID });
  saveRun(run);
  return run;
}

export async function loadResults(runId: string | undefined): Promise<ResultsData> {
  let run: Run | null;
  if (runId) {
    const view = getRunView(runId);
    run = view?.status === "finished" ? view.run : null;
    if (!run) return { missing: view ? "That run has not finished yet." : "That run was not found." };
  } else {
    run = await mainPathRun();
    if (!run) return { missing: "The main-path recording is not available." };
  }
  let report = loadReport(run.id);
  if (!report) {
    report = scoreAndRecord(run);
    saveRun(run);
    saveReport(report);
  }
  return { run, report };
}
