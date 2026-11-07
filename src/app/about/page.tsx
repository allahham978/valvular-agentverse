import { SiteHeader } from "@/components/site-header";

export default function AboutPage() {
  return (
    <>
      <SiteHeader />
      <main className="max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-semibold tracking-tight">About</h1>
        <p className="mt-3 text-muted">
          Data sources, licences and the limits of this tool.
        </p>
      </main>
    </>
  );
}
