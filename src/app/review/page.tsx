import { DataLabel } from "@/components/data-label";

export default function ReviewPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <DataLabel>Synthetic test hearts</DataLabel>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">Review</h1>
      <p className="mt-3 text-muted">The engineer approves or rejects a proposed change with the evidence in view.</p>
    </main>
  );
}
