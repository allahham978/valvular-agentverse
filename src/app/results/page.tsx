import { SiteHeader } from "@/components/site-header";
import { ResultsView } from "@/components/results";
import { loadResults } from "@/components/results/load";

export const dynamic = "force-dynamic";

export default async function ResultsPage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  const data = await loadResults((await searchParams).run);
  return (
    <>
      <SiteHeader />
      <main className="px-6 py-12">
        <h1 className="text-3xl font-semibold tracking-tight">Results</h1>
        <p className="mt-3 mb-8 text-muted">How the agents’ fix does on hearts it never saw, next to simpler approaches.</p>
        {"missing" in data ? (
          <p data-testid="results-missing" className="text-muted">
            {data.missing}
          </p>
        ) : (
          <ResultsView run={data.run} report={data.report} />
        )}
      </main>
    </>
  );
}
