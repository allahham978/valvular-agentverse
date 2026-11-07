import { SiteHeader } from "@/components/site-header";

export default function ResultsPage() {
  return (
    <>
      <SiteHeader />
      <main className="max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-semibold tracking-tight">Results</h1>
        <p className="mt-3 text-muted">
          Proposal and baselines, compared on hidden test hearts.
        </p>
      </main>
    </>
  );
}
