import { Controls } from "@/components/controls";
import { DataLabel } from "@/components/data-label";
import { Feed } from "@/components/feed";
import { HeartScene } from "@/components/heart-scene";
import { Judge } from "@/components/judge";
import { ReplayLabel } from "@/components/replay-label";
import { StageGate } from "@/components/stage-gate";
import { Wall } from "@/components/wall";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string }>;
}) {
  const { stage } = await searchParams;

  return (
    <main className="fixed inset-0">
      <StageGate initial={stage === "workspace" ? 1 : 0}>
        <HeartScene />
        <header className="pointer-events-none absolute left-6 top-5 flex items-center gap-3">
          <span className="text-lg font-semibold tracking-tight">Valvular</span>
          <span className="grid *:col-start-1 *:row-start-1 *:justify-self-start">
            <DataLabel className="stage-opening">Illustrative</DataLabel>
            <DataLabel className="stage-panel">Synthetic test hearts</DataLabel>
          </span>
        </header>
        <div className="stage-panel pointer-events-none absolute bottom-6 right-6 top-16 flex w-(--panel-col) flex-col gap-4 [&>*]:pointer-events-auto">
          <Wall />
          <Feed />
        </div>
        <div className="stage-panel pointer-events-none absolute bottom-6 left-6 [&>*]:pointer-events-auto">
          <Controls />
        </div>
        <Judge />
        <ReplayLabel />
      </StageGate>
    </main>
  );
}
