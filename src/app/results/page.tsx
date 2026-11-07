import { DataLabel } from "@/components/data-label";

export default function ResultsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <DataLabel>Synthetic test hearts</DataLabel>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">Results</h1>
      <p className="mt-3 text-muted">Proposal and baselines, compared on hidden test hearts.</p>
    </main>
  );
}
