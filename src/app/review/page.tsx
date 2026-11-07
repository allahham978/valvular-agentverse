import { SiteHeader } from "@/components/site-header";

export default function ReviewPage() {
  return (
    <>
      <SiteHeader />
      <main className="max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-semibold tracking-tight">Review</h1>
        <p className="mt-3 text-muted">
          The engineer approves or rejects a proposed change with the evidence
          in view.
        </p>
      </main>
    </>
  );
}
