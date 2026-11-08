"use client";

import { useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { DataLabel } from "@/components/data-label";
import type { RunEvent } from "@/contracts";
import { useRun } from "./run-store";

const FOLLOW_SLACK_PX = 24;

const MEASUREMENT = /(\d+(?:\.\d+)?)\s?mm\b/g;
const THIN_NBSP = " ";

function renderText(text: string) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(MEASUREMENT)) {
    parts.push(text.slice(last, match.index));
    parts.push(
      <span key={match.index} className="mono">
        {`${match[1]}${THIN_NBSP}mm`}
      </span>,
    );
    last = match.index + match[0].length;
  }
  parts.push(text.slice(last));
  return parts;
}

type ToolCallData = { tool: string; input?: unknown; result?: unknown; error?: string };

const pretty = (value: unknown) => JSON.stringify(value, null, 2) ?? "";

function ToolCall({ event }: { event: RunEvent }) {
  const [open, setOpen] = useState(false);
  const data = event.data as ToolCallData;
  return (
    <>
      <button
        type="button"
        data-testid="tool-call-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="rounded border border-panel-border px-2 py-1 text-left text-sm hover:bg-background focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span className="mono">{data.tool}</span>
        <span className="text-muted">{open ? " (hide)" : " (show)"}</span>
      </button>
      {open && (
        <div className="mt-1 space-y-2">
          <div>
            <p className="text-xs text-muted">Input</p>
            <pre data-testid="tool-call-input" className="mono max-h-40 overflow-auto rounded bg-background p-2 text-xs">
              {pretty(data.input)}
            </pre>
          </div>
          <div>
            <p className="text-xs text-muted">{data.error ? "Error" : "Result"}</p>
            <pre data-testid="tool-call-result" className="mono max-h-40 overflow-auto rounded bg-background p-2 text-xs">
              {data.error ?? pretty(data.result)}
            </pre>
          </div>
        </div>
      )}
    </>
  );
}

type VerdictData = { verdict?: string; attacks?: { kind: string; outcome: "survived" | "broke" }[] };

const words = (value: string) => value.replaceAll("_", " ");

function Verdict({ event }: { event: RunEvent }) {
  const data = (event.data ?? {}) as VerdictData;
  if (!data.verdict) return <span>{event.text}</span>;
  return (
    <>
      <span className="font-medium">Verdict: {words(data.verdict)}</span>
      {data.attacks?.map((attack, index) => (
        <span key={index} className="mt-0.5 block text-muted">
          {attack.outcome === "survived"
            ? `The claim survived the ${words(attack.kind)} attack.`
            : `The claim broke under the ${words(attack.kind)} attack.`}
        </span>
      ))}
    </>
  );
}

function EventBody({ event }: { event: RunEvent }) {
  if (event.type === "tool-call") return <ToolCall event={event} />;
  if (event.type === "verdict") return <Verdict event={event} />;
  const detail = (event.data as { explanation?: string } | null)?.explanation;
  const emphasised = event.type === "finding" || event.type === "attack";
  return (
    <>
      <span className={emphasised ? "font-medium" : undefined}>{renderText(event.text)}</span>
      {detail && <span className="mt-0.5 block text-muted">{renderText(detail)}</span>}
    </>
  );
}

export function Feed() {
  const { events, sample, runId } = useRun();
  const list = useRef<HTMLOListElement>(null);
  const stuck = useRef(true);
  const lastTop = useRef(0);
  const reviewable = runId !== null && events.some((event) => event.type === "proposal");

  // Follow new events unless the user has scrolled back up; reaching the bottom again resumes it.
  const onScroll = () => {
    const element = list.current;
    if (!element) return;
    if (element.scrollHeight - element.scrollTop - element.clientHeight <= FOLLOW_SLACK_PX) stuck.current = true;
    else if (element.scrollTop < lastTop.current) stuck.current = false;
    lastTop.current = element.scrollTop;
  };

  useLayoutEffect(() => {
    const element = list.current;
    if (!element || !stuck.current) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollTo({ top: element.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }, [events.length]);
  return (
    <section
      data-testid="feed-panel"
      className="panel flex min-h-0 flex-col p-4"
      aria-label="Agent feed"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Agent feed</h2>
        {sample && <DataLabel>Sample data</DataLabel>}
      </div>
      {events.length === 0 ? (
        <p className="text-sm text-muted">Press Break it to start a run.</p>
      ) : (
        <ol ref={list} onScroll={onScroll} className="min-h-0 divide-y divide-panel-border overflow-y-auto">
          {events.map((event) => (
            <li key={event.seq} data-testid="feed-event" data-type={event.type} data-actor={event.actor} className="py-2.5 text-sm first:pt-0 last:pb-0">
              <span className="mb-1 block text-xs font-medium capitalize tracking-wide text-muted">{event.actor}</span>
              <EventBody event={event} />
            </li>
          ))}
        </ol>
      )}
      {reviewable && (
        <div className="mt-3 shrink-0 border-t border-panel-border pt-3">
          <Link
            href={`/review?run=${runId}`}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
          >
            Open review
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </div>
      )}
    </section>
  );
}
