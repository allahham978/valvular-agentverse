import { DataLabel } from "@/components/data-label";
import { SiteHeader } from "@/components/site-header";
import sources from "../../../data/sources.json";

const sourceLink =
  "text-accent underline underline-offset-4 hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent";

export default function AboutPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-3xl font-semibold tracking-tight">About</h1>
        <p className="mt-2 text-base leading-7 text-muted">
          Data sources, licences and the limits of this tool.
        </p>

        <div className="mt-8 divide-y divide-panel-border">
          <section
            aria-labelledby="dataset-heading"
            data-testid="about-dataset"
            className="pb-6"
          >
            <div className="flex flex-wrap items-center gap-3">
              <h2 id="dataset-heading" className="text-lg font-semibold">
                Dataset
              </h2>
              <DataLabel className="font-mono tabular-nums">
                {sources.licence}
              </DataLabel>
            </div>
            <div className="mt-3 space-y-2 text-base leading-7">
              <p>
                {sources.authors}{" "}
                <span data-testid="about-figure" className="font-mono tabular-nums">
                  {sources.year}
                </span>
                : a virtual cohort of{" "}
                <span data-testid="about-figure" className="font-mono tabular-nums">
                  500
                </span>{" "}
                synthetic stenotic aortic roots.
              </p>
              <p>
                We use <code className="font-mono">{sources.cohort}</code>.{" "}
                <code className="font-mono">real_cohort</code> is not used.{" "}
                <a href={sources.url} className={sourceLink}>
                  Dataset on 4TU
                </a>
                .
              </p>
            </div>
          </section>

          <section
            aria-labelledby="generation-heading"
            data-testid="about-generation"
            className="py-6"
          >
            <h2 id="generation-heading" className="text-lg font-semibold">
              How the hearts were made
            </h2>
            <div className="mt-3 space-y-2 text-base leading-7">
              <p>
                The synthetic hearts were generated from a shape model built on{" "}
                <span data-testid="about-figure" className="font-mono tabular-nums">
                  97
                </span>{" "}
                patients.
              </p>
              <p>
                <span data-testid="about-figure" className="font-mono tabular-nums">
                  {sources.split.dev}
                </span>{" "}
                dev /{" "}
                <span data-testid="about-figure" className="font-mono tabular-nums">
                  {sources.split.hidden}
                </span>{" "}
                hidden. The split is stratified by annulus band, with a fixed seed
                for seeded shuffling within each band and{" "}
                <span data-testid="about-figure" className="font-mono tabular-nums">
                  20%
                </span>{" "}
                of each band allocated to hidden by largest remainder.
              </p>
            </div>
          </section>

          <section
            aria-labelledby="limits-heading"
            data-testid="about-limits"
            className="py-6"
          >
            <h2 id="limits-heading" className="text-lg font-semibold">
              Limits
            </h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-base leading-7 marker:text-muted">
              <li>Fit only. Results describe test hearts, not patients. No safety claims.</li>
              <li>No coronaries or calcium; coronary risk cannot be calculated.</li>
              <li>Stenosis only.</li>
              <li>
                Both splits come from one generator built on{" "}
                <span data-testid="about-figure" className="font-mono tabular-nums">
                  97
                </span>{" "}
                patients. The hidden score tests our method, not real-world performance.
              </li>
              <li>
                Fit rules marked <code className="font-mono">demo-assumption</code>{" "}
                are placeholders.
              </li>
            </ul>
          </section>

          <section
            aria-labelledby="credit-heading"
            data-testid="about-heart-credit"
            className="pt-6"
          >
            <div className="flex flex-wrap items-center gap-3">
              <h2 id="credit-heading" className="text-lg font-semibold">
                Heart model credit
              </h2>
              <DataLabel>Illustrative</DataLabel>
            </div>
            <div className="mt-3 space-y-2 text-base leading-7">
              <p data-testid="about-credit-line">
                &quot;Human Heart 3d Model&quot; (<span className="font-mono tabular-nums">3DPX-022787</span>)
                {" "}by Sourav Pan, via NIH 3D, listed as{" "}
                <span className="font-mono tabular-nums">CC0 1.0</span>. Geometry
                simplified and materials replaced. Illustrative only.
              </p>
              <p>
                The licence is still being confirmed.{" "}
                <a href="https://3d.nih.gov/entries/3DPX-022787" className={sourceLink}>
                  NIH 3D entry
                </a>
                .
              </p>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
