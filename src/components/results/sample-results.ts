import type { ResultsData } from "./index";

export const sampleResults: ResultsData = {
  proposal: {
    summary: {
      designId: "sample-proposal",
      split: "hidden",
      total: 100,
      fit: 76,
      risk: 16,
      noFit: 8,
      fitPct: 76,
      newRiskHeartIds: ["sample-hidden-01", "sample-hidden-02", "sample-hidden-03"],
    },
    designsTried: 8,
  },
  baselines: [
    {
      method: "no-change",
      designId: "sample-start",
      summary: {
        designId: "sample-start",
        split: "hidden",
        total: 100,
        fit: 62,
        risk: 18,
        noFit: 20,
        fitPct: 62,
        newRiskHeartIds: [],
      },
      designsTried: 1,
    },
    {
      method: "add-larger-size",
      designId: "sample-larger",
      summary: {
        designId: "sample-larger",
        split: "hidden",
        total: 100,
        fit: 76,
        risk: 16,
        noFit: 8,
        fitPct: 76,
        newRiskHeartIds: ["sample-hidden-01", "sample-hidden-02", "sample-hidden-03"],
      },
      designsTried: 1,
    },
    {
      method: "brute-force",
      designId: "sample-brute-force",
      summary: {
        designId: "sample-brute-force",
        split: "hidden",
        total: 100,
        fit: 82,
        risk: 18,
        noFit: 0,
        fitPct: 82,
        newRiskHeartIds: [
          "sample-hidden-01", "sample-hidden-02", "sample-hidden-03",
          "sample-hidden-04", "sample-hidden-05",
        ],
      },
      designsTried: 120,
    },
  ],
  hiddenScoreCount: 1,
};
