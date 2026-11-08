"use client";

import { useEffect, useMemo, useState } from "react";
import { DesignSchema, HeartSchema, type Design, type FitResult, type Heart } from "@/contracts";
import { STARTING_VALVE } from "@/engine/starting-valve";
import { useRun } from "@/components/feed/run-store";
import { useWallData } from "@/components/wall/use-wall-data";
import { useMainHeartId } from "@/state/stage";

export const LANDING_URL = "/fixtures/root-sample.glb";
const LANDING_HEART_ID = "heart-001";

let heartsLoad: Promise<Heart[]> | undefined;
const fitLoads = new Map<string, Promise<Map<string, FitResult>>>();

function loadHearts() {
  heartsLoad ??= fetch("/api/hearts")
    .then((response) => response.json())
    .then((body: { hearts: unknown }) => HeartSchema.array().parse(body.hearts));
  return heartsLoad;
}

function loadFits(design: Design) {
  const key = JSON.stringify(design);
  let load = fitLoads.get(key);
  if (!load) {
    load = fetch("/api/fit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ design }),
    })
      .then((response) => response.json())
      .then((body: { results: FitResult[] }) => new Map(body.results.map((result) => [result.heartId, result])));
    fitLoads.set(key, load);
  }
  return load;
}

function useHearts() {
  const [hearts, setHearts] = useState<Heart[]>();
  useEffect(() => {
    loadHearts().then(setHearts, () => undefined);
  }, []);
  return hearts;
}

function useFits(design: Design) {
  const [loaded, setLoaded] = useState<{ design: Design; fits: Map<string, FitResult> }>();
  useEffect(() => {
    let current = true;
    loadFits(design).then(
      (fits) => current && setLoaded({ design, fits }),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [design]);
  return loaded?.design === design ? loaded.fits : undefined;
}

function useCurrentDesign(): Design {
  const { events } = useRun();
  const proposal = events.findLast((event) => event.type === "proposal");
  return useMemo(() => {
    const parsed = DesignSchema.safeParse((proposal?.data as { design?: unknown } | null)?.design);
    return parsed.success ? parsed.data : STARTING_VALVE;
  }, [proposal]);
}

export type MainRoot = {
  selectedId: string | null;
  meshUrl: string;
  heart: Heart | undefined;
  design: Design;
  fit: FitResult | undefined;
};

export function useMainRoot(): MainRoot {
  const selectedId = useMainHeartId();
  const wall = useWallData();
  const design = useCurrentDesign();
  const hearts = useHearts();
  const fits = useFits(design);

  const wallMesh = selectedId ? wall.hearts.get(selectedId)?.meshUrl : undefined;
  const heart = selectedId
    ? hearts?.find((item) => (wallMesh ? item.meshUrl === wallMesh : item.id === selectedId))
    : hearts?.find((item) => item.id === LANDING_HEART_ID);
  const meshUrl = selectedId && heart ? heart.meshUrl : LANDING_URL;
  const fit = heart ? fits?.get(heart.id) : undefined;
  return useMemo(() => ({ selectedId, meshUrl, heart, design, fit }), [selectedId, meshUrl, heart, design, fit]);
}
