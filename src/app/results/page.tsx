import Link from "next/link";
import { DataLabel } from "@/components/data-label";
import { ResultsComparison } from "@/components/results";
import { sampleResults } from "@/components/results/sample-results";
import { SiteHeader } from "@/components/site-header";

export default function ResultsPage() {
  return (
    <>
      <SiteHeader />
      <main className="px-6 py-8">
        <div className="mb-6 flex items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-semibold tracking-tight">Results</h1>
              <DataLabel>Sample data</DataLabel>
            </div>
            <p className="mt-2 text-muted">Proposal and baselines for a hypothetical valve. Sample scores, not a completed run.</p>
          </div>
          <Link href="/?stage=workspace" className="rounded-sm text-sm font-medium text-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent">
            Back to workbench
          </Link>
        </div>
        <ResultsComparison results={sampleResults} />
      </main>
    </>
  );
}
