import { SiteHeader } from "@/components/site-header";
import { EmptyReview, ReviewView } from "@/components/review";
import { getRunView } from "@/run/store";

export const dynamic = "force-dynamic";

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  const id = (await searchParams).run;
  const view = id ? getRunView(id) : null;

  return (
    <>
      <style>{"next-route-announcer{display:none}"}</style>
      <SiteHeader />
      <main className="max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-semibold tracking-tight">Review</h1>
        <p className="mt-3 mb-8 text-muted">
          The engineer approves or rejects a proposed change with the evidence in view.
        </p>
        {!id ? (
          <EmptyReview message="Open a finished run to review its proposed change." />
        ) : !view ? (
          <EmptyReview message="That run was not found." />
        ) : view.status !== "finished" ? (
          <EmptyReview message="That run has not finished yet." />
        ) : (
          <ReviewView run={view.run} />
        )}
      </main>
    </>
  );
}
