import { DataLabel } from "@/components/data-label";

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <DataLabel>Synthetic test hearts</DataLabel>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">About</h1>
      <p className="mt-3 text-muted">Data sources, licences and the limits of this tool.</p>
    </main>
  );
}
