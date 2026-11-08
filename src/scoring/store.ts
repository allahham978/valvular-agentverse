import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isRunId, runsDir } from "../run/store";
import type { ScoreReport } from "./score";

const reportFile = (runId: string) => path.join(runsDir(), `${runId}.score.json`);

export function saveReport(report: ScoreReport) {
  if (!isRunId(report.runId)) throw new Error("Invalid run ID.");
  mkdirSync(runsDir(), { recursive: true });
  const temp = `${reportFile(report.runId)}.tmp`;
  writeFileSync(temp, JSON.stringify(report));
  renameSync(temp, reportFile(report.runId));
}

export function loadReport(runId: string): ScoreReport | null {
  if (!isRunId(runId)) return null;
  try {
    return JSON.parse(readFileSync(reportFile(runId), "utf8")) as ScoreReport;
  } catch {
    return null;
  }
}
