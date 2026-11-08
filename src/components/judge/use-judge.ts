"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RunEventSchema, SummarySchema, type Design, type Limit, type RunEvent, type Summary } from "@/contracts";
import { STARTING_VALVE } from "@/engine/starting-valve";
import { restartPoint, type Planned, type RestartPoint } from "@/orchestrator/restart-point";

const MODEL = { kind: "gemini" } as const;

export type LimitCheck = { state: "idle" } | { state: "parsed"; limit: Limit } | { state: "refused"; reason: string };
export type RunResult = { stopText: string; design: Design };

const post = (url: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export function finalDesign(events: RunEvent[]): Design | null {
  const start = events.find((event) => event.type === "run-start");
  if (!start) return null;
  const improved = events.filter((event) => event.type === "evaluation" && (event.data as { improved?: boolean })?.improved);
  const id = (improved.at(-1)?.data as { designId?: string } | undefined)?.designId;
  const proposals = events.filter((event) => event.type === "proposal").map((event) => (event.data as { design: Design }).design);
  return (id && proposals.filter((design) => design.id === id).at(-1)) || (start.data as { design: Design }).design;
}

export function useJudge() {
  const [planned, setPlanned] = useState<Planned>({ design: STARTING_VALVE, limits: [] });
  const [design, setDesign] = useState<Design>(STARTING_VALVE);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [designError, setDesignError] = useState<string | null>(null);
  const [limitCheck, setLimitCheck] = useState<LimitCheck>({ state: "idle" });
  const [busy, setBusy] = useState(false);
  const [runId, setRunId] = useState("");
  const [startAt, setStartAt] = useState<RestartPoint | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const source = useRef<EventSource | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    post("/api/fit", { design })
      .then(async (response) => {
        const body = (await response.json()) as { summary?: unknown };
        const parsed = SummarySchema.safeParse(body.summary);
        if (controller.signal.aborted) return;
        setDesignError(parsed.success ? null : "The engine rejected this set of sizes.");
        if (parsed.success) setSummary(parsed.data);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [design]);

  useEffect(() => () => source.current?.close(), []);

  const setNominal = useCallback((index: number, nominalMm: number) => {
    setDesign((current) => {
      const sizes = current.sizes.map((size, i) =>
        i === index ? { nominalMm, minAnnulusMm: nominalMm - 2, maxAnnulusMm: nominalMm } : size,
      );
      return {
        id: `judge-${sizes.map((size) => size.nominalMm).join("-")}`,
        label: "Judge's valve",
        hypothetical: true,
        parentId: STARTING_VALVE.id,
        sizes,
      };
    });
  }, []);

  const watch = useCallback((id: string) => {
    source.current?.close();
    const stream = new EventSource(`/api/runs/${id}/events`);
    source.current = stream;
    stream.onmessage = (message) => {
      const parsed = RunEventSchema.safeParse(JSON.parse(message.data));
      if (!parsed.success) return;
      setEvents((current) => [...current, parsed.data]);
      if (parsed.data.type === "run-stop") stream.close();
    };
    stream.onerror = () => stream.close();
  }, []);

  const replan = useCallback(
    async (after: Planned) => {
      setBusy(true);
      setError(null);
      try {
        const response = await post("/api/limits/replan", { model: MODEL, before: planned, after });
        const body = (await response.json()) as { id?: string; startAt?: RestartPoint; error?: string };
        if (!response.ok || !body.id || !body.startAt) {
          setError(body.error ?? "The replan could not start.");
          return;
        }
        setPlanned(after);
        setStartAt(body.startAt);
        setEvents([]);
        setRunId(body.id);
        watch(body.id);
      } catch {
        setError("The replan could not start.");
      } finally {
        setBusy(false);
      }
    },
    [planned, watch],
  );

  const checkLimit = useCallback(async (text: string) => {
    setBusy(true);
    setLimitCheck({ state: "idle" });
    try {
      const response = await post("/api/limits", { text, model: MODEL });
      const body = (await response.json()) as { ok?: boolean; limit?: Limit; reason?: string };
      setLimitCheck(
        body.ok && body.limit
          ? { state: "parsed", limit: body.limit }
          : { state: "refused", reason: body.reason ?? "That is outside fit." },
      );
    } catch {
      setLimitCheck({ state: "refused", reason: "The limit could not be checked." });
    } finally {
      setBusy(false);
    }
  }, []);

  const confirmLimit = useCallback(() => {
    if (limitCheck.state !== "parsed") return;
    const limit = limitCheck.limit;
    setLimitCheck({ state: "idle" });
    void replan({ design, limits: [...planned.limits, limit] });
  }, [design, limitCheck, planned.limits, replan]);

  const stop = events.find((event) => event.type === "run-stop");
  const final = stop ? finalDesign(events) : null;

  return {
    design,
    summary,
    designError,
    runId,
    startAt,
    events,
    error,
    busy,
    limitCheck,
    canReplan: restartPoint(planned, { design, limits: planned.limits }) !== null && !designError,
    result: stop && final ? ({ stopText: stop.text, design: final } satisfies RunResult) : null,
    setNominal,
    replan: () => replan({ design, limits: planned.limits }),
    checkLimit,
    confirmLimit,
    discardLimit: () => setLimitCheck({ state: "idle" }),
  };
}
