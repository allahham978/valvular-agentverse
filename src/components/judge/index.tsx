"use client";

import { Button } from "@/components/ui/button";
import { LimitBox } from "./limit-box";
import { ReplanStatus } from "./replan-status";
import { Sliders } from "./sliders";
import { useJudge } from "./use-judge";

export function Judge() {
  const judge = useJudge();
  return (
    <section
      data-testid="judge-panel"
      data-design={JSON.stringify(judge.design)}
      data-run-id={judge.runId}
      aria-label="Judge"
      className="panel stage-panel absolute bottom-24 left-6 flex w-80 flex-col gap-4 p-4"
    >
      <Sliders design={judge.design} summary={judge.summary} error={judge.designError} onChange={judge.setNominal} />
      {judge.canReplan && (
        <Button size="sm" disabled={judge.busy} onClick={() => void judge.replan()}>
          Replan
        </Button>
      )}
      <LimitBox
        check={judge.limitCheck}
        busy={judge.busy}
        onCheck={(text) => void judge.checkLimit(text)}
        onConfirm={judge.confirmLimit}
        onDiscard={judge.discardLimit}
      />
      {judge.error && <p className="text-sm text-muted">{judge.error}</p>}
      <ReplanStatus startAt={judge.startAt} events={judge.events} result={judge.result} />
    </section>
  );
}
