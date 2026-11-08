import { expect, test, type Page } from "@playwright/test";
import {
  DesignSchema,
  RunSchema,
  type Claim,
  type Design,
  type Evidence,
  type Limit,
  type Run,
  type RunEvent,
} from "../../src/contracts/index";
import type { ModelClient, ModelRequest, ModelTurn, ScriptedTurn } from "../../src/agents/model-client";

// REQ-16: Engineer review. Runs are made with the scripted model through the real tools: no key, no network.
// Evidence IDs and designs are computed by the tools at run time, never hard-coded.

const TEST_TIMEOUT_MS = 180_000;
const POLL_MS = 90_000;
const BANNED = [/\bsafe\b/i, /\bready\b/i, /clinically validated/i, /approved for use/i];
const STRESS_KINDS = ["measurement_shift", "assumption_shift", "subgroup"] as const;

const START: Design = {
  id: "start",
  label: "Starting valve",
  hypothetical: true,
  sizes: [
    { nominalMm: 23, minAnnulusMm: 21, maxAnnulusMm: 23 },
    { nominalMm: 25, minAnnulusMm: 23, maxAnnulusMm: 25 },
    { nominalMm: 27, minAnnulusMm: 25, maxAnnulusMm: 27 },
  ],
};

type EditResult = {
  valid: boolean;
  design: Design;
  comparison: { parent: { fitPct: number }; child: { fitPct: number } };
};
type RunView = { status: string; run: Run };
type Summaryish = { designId: string; summary: { fitPct: number }; improved?: boolean };

test.describe.configure({ timeout: TEST_TIMEOUT_MS });

const addSize = (nominalMm: number) => ({
  kind: "add_size",
  size: { nominalMm, minAnnulusMm: nominalMm - 2, maxAnnulusMm: nominalMm },
});

async function evidenceOf(tool: string, input: unknown): Promise<Evidence> {
  const { createAgentTools } = await import("../../src/tools");
  const outcome = await createAgentTools().call(tool, input);
  if (!outcome.ok) throw new Error(`${tool}: ${outcome.error}`);
  return outcome.evidence;
}
const editOf = (evidence: Evidence) => evidence.result as EditResult;

async function improvingEdit(parent: Design, sizes: number[], limits?: Limit[]): Promise<Evidence> {
  for (const size of sizes) {
    const edit = await evidenceOf("edit_design", { design: parent, change: addSize(size), ...(limits ? { limits } : {}) });
    const result = editOf(edit);
    if (result.valid && result.comparison.child.fitPct > result.comparison.parent.fitPct) return edit;
  }
  throw new Error(`Precondition: no size in ${sizes.join(", ")} improves ${parent.label}.`);
}

const call = (name: string, args: unknown): ScriptedTurn => ({ toolCalls: [{ name, args }] });
const finding = (title: string, explanation: string, evidenceIds: string[]) => ({
  title,
  explanation,
  heartIds: [],
  severity: "low",
  evidenceIds,
});
const report = (...mechanisms: ReturnType<typeof finding>[]) => call("report_findings", { mechanisms });
const fitClaim = (edit: Evidence): Claim => ({ metric: "fitPct", comparator: ">=", threshold: editOf(edit).comparison.child.fitPct });

const TRADE_OFF = "One more size to stock and train on.";
const ATTACK_TITLE = "Measurement shift attack ran";

async function investigateTurns(): Promise<ScriptedTurn[]> {
  const e1 = await evidenceOf("evaluate_design", { design: START });
  const e2 = await evidenceOf("group_failures", { design: START, by: "rule" });
  return [
    { toolCalls: [{ name: "evaluate_design", args: { design: START } }, { name: "group_failures", args: { design: START, by: "rule" } }] },
    report(finding("Failures cluster by rule", "Failing hearts share a rule, as the grouping shows.", [e1.id, e2.id])),
  ];
}

async function proposeAndAttack(edit: Evidence, rationale: string): Promise<ScriptedTurn[]> {
  const design = editOf(edit).design;
  const stress = await evidenceOf("stress_test", {
    design,
    kind: "measurement_shift",
    amount: 1,
    hypothesis: "The claim still holds after a small measurement shift.",
    disprovedIf: "The claimed metric crosses its threshold after the shift.",
  });
  return [
    call("edit_design", edit.input),
    call("submit_proposal", { design, rationale, claim: fitClaim(edit), tradeOffs: [TRADE_OFF], evidenceIds: [edit.id] }),
    call("stress_test", stress.input),
    report(finding(ATTACK_TITLE, "The shift attack on the proposal ran and its result is cited.", [stress.id])),
  ];
}

async function reviewTurns(): Promise<{ turns: ScriptedTurn[]; edit: Evidence }> {
  const edit = await improvingEdit(START, [29]);
  return { edit, turns: [...(await investigateTurns()), ...(await proposeAndAttack(edit, "Add the larger size the findings point to."))] };
}

async function replanTurns(): Promise<{ turns: ScriptedTurn[]; edit: Evidence }> {
  const edit = await improvingEdit(START, [21, 31, 19]);
  const design = editOf(edit).design;
  return {
    edit,
    turns: [
      ...(await proposeAndAttack(edit, "Add a different size, as the engineer asked.")),
      call("submit_proposal", { design, rationale: "No further change improves the fit.", claim: fitClaim(edit), tradeOffs: [TRADE_OFF], evidenceIds: [edit.id] }),
    ],
  };
}

async function getView(baseURL: string | undefined, id: string): Promise<RunView> {
  const response = await fetch(`${baseURL}/api/runs/${id}`);
  expect(response.status, `run ${id} exists`).toBe(200);
  return (await response.json()) as RunView;
}

async function waitFinished(baseURL: string | undefined, id: string): Promise<Run> {
  let view: RunView | undefined;
  await expect
    .poll(async () => (view = await getView(baseURL, id)).status, { timeout: POLL_MS, message: `run ${id} finishes` })
    .toBe("finished");
  return RunSchema.parse(view!.run);
}

async function finishedReviewRun(baseURL: string | undefined) {
  const { turns, edit } = await reviewTurns();
  const response = await fetch(`${baseURL}/api/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: { kind: "scripted", turns }, budget: { maxRounds: 1 } }),
  });
  expect(response.status).toBe(201);
  const { id } = (await response.json()) as { id: string };
  const run = await waitFinished(baseURL, id);
  expect(run.proposals, "precondition: the scripted run made one proposal").toHaveLength(1);
  return { id, run, proposal: run.proposals[0], design: editOf(edit).design };
}

const eventsOf = (run: Run, type: string) => run.events.filter((event: RunEvent) => event.type === type);
const evaluationOf = (run: Run, designId: string) =>
  eventsOf(run, "evaluation")
    .map((event) => event.data as Summaryish)
    .find((data) => data.designId === designId);
const pct = (value: number) => `${value.toFixed(1)}%`;
const verdictLabel = (verdict: string) => new RegExp(verdict.replaceAll("_", "[ _-]"), "i");
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const decisionUrl = (baseURL: string | undefined, id: string) => `${baseURL}/api/review/${id}/decision`;
const exportUrl = (baseURL: string | undefined, id: string) => `${baseURL}/api/review/${id}/export`;
const finalDesignUrl = (baseURL: string | undefined, id: string) => `${baseURL}/api/review/${id}/final-design`;

async function expectNoDecision(baseURL: string | undefined, id: string) {
  expect((await getView(baseURL, id)).run.decision, "no decision saved").toBeUndefined();
  expect((await fetch(decisionUrl(baseURL, id))).status).toBe(404);
  expect((await fetch(exportUrl(baseURL, id))).status).toBe(409);
}

async function openReview(page: Page, id: string) {
  await page.goto(`/review?run=${id}`);
  await expect(page.getByTestId("review-change")).toBeVisible();
}

const nameField = (page: Page) => page.getByLabel(/name/i);
const noteField = (page: Page) => page.getByLabel(/note/i);
const approveButton = (page: Page) => page.getByRole("button", { name: /^approve$/i });
const rejectButton = (page: Page) => page.getByRole("button", { name: /^reject$/i });

async function injectReplanModel(page: Page, id: string, turns: ScriptedTurn[]) {
  await page.route(`**/api/review/${id}/decision`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const body = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
    await route.continue({ postData: JSON.stringify({ ...body, model: { kind: "scripted", turns } }) });
  });
}

async function visibleWording(page: Page): Promise<string> {
  return page.evaluate(() => {
    const attributes = ["aria-label", "title", "placeholder", "alt"];
    const extra = [...document.querySelectorAll("*")].flatMap((element) =>
      attributes.map((name) => element.getAttribute(name) ?? "").filter(Boolean),
    );
    return [document.title, document.body.innerText, ...extra].join("\n");
  });
}

function expectNoBannedWords(where: string, text: string) {
  for (const word of BANNED) expect(text, `${where} contains ${word}`).not.toMatch(word);
}

test.describe("DW1: the review shows the change and its evidence", () => {
  test("change, trade-offs, attacks, evidence log and what wasn't tested", async ({ page, baseURL }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));

    const { id, run, proposal, design } = await finishedReviewRun(baseURL);
    await openReview(page, id);

    const change = page.getByTestId("review-change");
    for (const size of design.sizes) await expect(change).toContainText(new RegExp(`\\b${size.nominalMm}\\s?mm`));
    const before = evaluationOf(run, proposal.fromDesignId);
    const after = evaluationOf(run, proposal.toDesignId);
    expect(before && after, "precondition: both designs were evaluated by code").toBeTruthy();
    await expect(change).toContainText(pct(before!.summary.fitPct));
    await expect(change).toContainText(pct(after!.summary.fitPct));

    for (const tradeOff of proposal.tradeOffs) await expect(page.getByTestId("review-trade-offs")).toContainText(tradeOff);

    const attacks = page.getByTestId("review-attacks");
    const attackFindings = run.findings.filter((item) => item.kind === "attack");
    expect(attackFindings.length, "precondition: the attack was recorded").toBeGreaterThan(0);
    for (const item of attackFindings) await expect(attacks).toContainText(item.title);

    const evidence = page.getByTestId("review-evidence");
    expect(run.evidence.length).toBeGreaterThan(0);
    for (const item of run.evidence) await expect(evidence).toContainText(item.id);
    for (const cited of proposal.evidenceIds) await expect(evidence).toContainText(cited);

    const notTested = page.getByTestId("review-not-tested");
    expect(run.hiddenScoreCount).toBe(0);
    await expect(notTested).toContainText(/hidden/i);
    const ran = new Set(
      eventsOf(run, "tool-call")
        .map((event) => event.data as { tool: string; input?: { kind?: string } })
        .filter((data) => data.tool === "stress_test")
        .map((data) => data.input?.kind),
    );
    const unrun = STRESS_KINDS.filter((kind) => !ran.has(kind));
    expect(unrun.length, "precondition: some attack kinds were not run").toBeGreaterThan(0);
    for (const kind of unrun) await expect(notTested).toContainText(new RegExp(kind.replace("_", "[ _-]"), "i"));

    await expect(page.getByText("Synthetic test hearts").first()).toBeVisible();
    expect(errors, "no console errors").toEqual([]);
  });
});

test.describe("DW2: approve needs a name", () => {
  test("Approve with no name shows an error and saves nothing", async ({ page, baseURL }) => {
    const { id } = await finishedReviewRun(baseURL);
    await openReview(page, id);

    await noteField(page).fill("Looks consistent with the evidence.");
    await approveButton(page).click();
    await expect(page.getByRole("alert")).toContainText(/name/i);
    await expectNoDecision(baseURL, id);

    await nameField(page).fill("   ");
    await approveButton(page).click();
    await expect(page.getByRole("alert")).toContainText(/name/i);
    await expectNoDecision(baseURL, id);

    const blank = await fetch(decisionUrl(baseURL, id), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "approved", by: "  ", note: "No name given." }),
    });
    expect(blank.status, "the server refuses a decision without a name").toBe(400);
    await expectNoDecision(baseURL, id);
  });
});

test.describe("DW3: approve with a name saves the decision", () => {
  test("decision saved, shown, and in the export", async ({ page, baseURL }) => {
    const { id, proposal, design } = await finishedReviewRun(baseURL);
    await openReview(page, id);

    const name = `Dr Test ${Date.now()}`;
    const note = "Checked the attacks and the evidence log.";
    await nameField(page).fill(name);
    await noteField(page).fill(note);
    await approveButton(page).click();

    const shown = page.getByTestId("review-decision");
    await expect(shown).toContainText(/approved/i);
    await expect(shown).toContainText(name);

    const decision = (await getView(baseURL, id)).run.decision;
    expect(decision).toMatchObject({ status: "approved", by: name, note, designId: proposal.toDesignId });
    expect(Number.isNaN(Date.parse(decision!.at))).toBe(false);

    const saved = await fetch(decisionUrl(baseURL, id));
    expect(saved.status).toBe(200);
    expect(JSON.stringify(await saved.json())).toContain(name);

    const exported = await fetch(exportUrl(baseURL, id));
    expect(exported.status).toBe(200);
    const exportedRun = RunSchema.parse(await exported.json());
    expect(exportedRun.id).toBe(id);
    expect(exportedRun.decision).toEqual(decision);

    const final = await fetch(finalDesignUrl(baseURL, id));
    expect(final.status).toBe(200);
    const body = (await final.json()) as { design: unknown; decision: unknown };
    const finalDesign = DesignSchema.parse(body.design);
    expect(finalDesign.id).toBe(proposal.toDesignId);
    expect(finalDesign.sizes).toEqual(design.sizes);
    expect(body.decision).toEqual(decision);

    await page.reload();
    await expect(page.getByTestId("review-decision")).toContainText(name);
    await expect(approveButton(page)).toHaveCount(0);
    await expect(rejectButton(page)).toHaveCount(0);
  });
});

test.describe("DW4: reject with a note sends it back to the Fixer", () => {
  test("Reject without a note shows an error and saves nothing", async ({ page, baseURL }) => {
    const { id } = await finishedReviewRun(baseURL);
    await openReview(page, id);
    await nameField(page).fill("Dr Test");
    await rejectButton(page).click();
    await expect(page.getByRole("alert")).toContainText(/note/i);
    await expectNoDecision(baseURL, id);
  });

  test("Reject with a note saves it, and the Fixer replans from the parent design", async ({ page, baseURL }) => {
    const { id, proposal } = await finishedReviewRun(baseURL);
    const replan = await replanTurns();
    await injectReplanModel(page, id, replan.turns);
    await openReview(page, id);

    const note = `Avoid the larger size, try another route ${Date.now()}.`;
    await nameField(page).fill("Dr Test");
    await noteField(page).fill(note);
    await rejectButton(page).click();

    const shown = page.getByTestId("review-decision");
    await expect(shown).toContainText(note);
    await expect(shown).toContainText(/fixer/i);

    const decision = (await getView(baseURL, id)).run.decision;
    expect(decision).toMatchObject({ status: "rejected", by: "Dr Test", note, designId: proposal.toDesignId });
    expect((await fetch(finalDesignUrl(baseURL, id))).status, "a rejected design is not released").toBe(409);

    const link = shown.locator('a[href*="/review?run="]');
    await expect(link).toHaveCount(1);
    const replanId = new URL((await link.getAttribute("href"))!, baseURL).searchParams.get("run");
    expect(replanId).toBeTruthy();
    expect(replanId).not.toBe(id);

    const replanRun = await waitFinished(baseURL, replanId!);
    const steps = eventsOf(replanRun, "step-start").map((event) => [event.actor, (event.data as { step: string }).step]);
    expect(steps[0], "the replan starts at the Fixer").toEqual(["fixer", "propose"]);
    expect(steps.some(([, step]) => step === "investigate"), "no new Breaker investigation").toBe(false);
    const startData = eventsOf(replanRun, "run-start")[0]?.data as { design: Design };
    expect(startData.design.sizes, "the replan starts from the rejected change's parent").toEqual(START.sizes);
    expect(replanRun.startDesignId).toBe(proposal.fromDesignId);
    expect(replanRun.proposals.length).toBeGreaterThan(0);

    await link.click();
    await expect(page).toHaveURL(new RegExp(`run=${replanId}`));
    const newSize = editOf(replan.edit).design.sizes.at(-1)!.nominalMm;
    await expect(page.getByTestId("review-change")).toContainText(new RegExp(`\\b${newSize}\\s?mm`));
  });

  test("the rejection note reaches the Fixer's prompt and limits carry over", async () => {
    const { executeRun } = await import("../../src/orchestrator");
    const { createAgentTools } = await import("../../src/tools");
    const { createScriptedClient } = await import("../../src/agents/model-client");
    const { replanAfterReject } = await import("../../src/orchestrator/review-step");

    const limits: Limit[] = [{ id: "limit-sizes", kind: "max-sizes", value: 5, sourceText: "No more than five sizes" }];
    const original = await reviewTurns();
    const run = await executeRun({
      model: createScriptedClient(original.turns),
      tools: createAgentTools(),
      budget: { maxRounds: 1 },
      limits,
    });
    expect(run.proposals, "precondition: one proposal to reject").toHaveLength(1);

    const replan = await replanTurns();
    const requests: ModelRequest[] = [];
    const inner = createScriptedClient(replan.turns);
    const model: ModelClient = {
      mode: inner.mode,
      nextTurn(request: ModelRequest): Promise<ModelTurn> {
        requests.push({ ...request, messages: JSON.parse(JSON.stringify(request.messages)) as ModelRequest["messages"] });
        return inner.nextTurn(request);
      },
    };
    const note = `Prefer a smaller added size ${Date.now()}`;
    const replanned = await replanAfterReject(run, note, { model });

    const first = requests[0];
    expect(first?.actor).toBe("fixer");
    expect(first?.step).toBe("propose");
    const opening = first?.messages[0];
    const prompt = opening?.role === "user" ? opening.text : "";
    expect(prompt, "the Fixer sees the engineer's note").toContain(note);
    expect(requests.some((request) => request.step === "investigate")).toBe(false);
    expect(replanned.limits).toEqual(limits);
    expect(replanned.startDesignId).toBe(run.proposals[0].fromDesignId);
    expect(replanned.proposals.length).toBeGreaterThan(0);
  });
});

test.describe("DW5: wording scan", () => {
  test("no banned words on any screen or in server wording", async ({ page, baseURL }) => {
    const approved = await finishedReviewRun(baseURL);
    const rejected = await finishedReviewRun(baseURL);
    const replan = await replanTurns();

    for (const url of ["/", "/?stage=workspace", "/results", "/about", "/review"]) {
      await page.goto(url);
      await page.waitForLoadState("load");
      expectNoBannedWords(url, await visibleWording(page));
    }

    await openReview(page, approved.id);
    expectNoBannedWords("review before a decision", await visibleWording(page));
    await approveButton(page).click();
    await expect(page.getByRole("alert")).toBeVisible();
    expectNoBannedWords("review name error", await visibleWording(page));
    await nameField(page).fill("Dr Test");
    await noteField(page).fill("Checked.");
    await approveButton(page).click();
    await expect(page.getByTestId("review-decision")).toContainText("Dr Test");
    expectNoBannedWords("review after approval", await visibleWording(page));

    await injectReplanModel(page, rejected.id, replan.turns);
    await openReview(page, rejected.id);
    await nameField(page).fill("Dr Test");
    await noteField(page).fill("Try another size.");
    await rejectButton(page).click();
    await expect(page.getByTestId("review-decision")).toContainText("Try another size.");
    expectNoBannedWords("review after rejection", await visibleWording(page));

    const undecided = await finishedReviewRun(baseURL);
    const serverText: string[] = [];
    for (const url of [exportUrl(baseURL, undecided.id), finalDesignUrl(baseURL, undecided.id), decisionUrl(baseURL, undecided.id)]) {
      serverText.push(await (await fetch(url)).text());
    }
    for (const { id } of [approved, rejected, undecided]) {
      const run = (await getView(baseURL, id)).run;
      serverText.push(...run.events.map((event) => event.text));
      serverText.push(...run.proposals.flatMap((item) => item.notShown ?? []));
    }
    serverText.push(await (await fetch(exportUrl(baseURL, approved.id))).text());
    expectNoBannedWords("server wording", serverText.join("\n"));
  });
});

test.describe("DW6: the backend enforces the decision", () => {
  test("final design and export are refused with no decision saved", async ({ baseURL }) => {
    const { id, design } = await finishedReviewRun(baseURL);

    const final = await fetch(finalDesignUrl(baseURL, id));
    expect(final.status).toBe(409);
    const finalBody = await final.text();
    expect(finalBody).not.toContain(design.id);
    expect(finalBody).not.toContain("nominalMm");

    const exported = await fetch(exportUrl(baseURL, id));
    expect(exported.status).toBe(409);
    const exportBody = await exported.text();
    expect(exportBody).not.toContain('"evidence":');
    expect(exportBody).not.toContain("nominalMm");

    expect((await getView(baseURL, id)).run.decision).toBeUndefined();

    for (const url of [finalDesignUrl(baseURL, "no-such-run"), exportUrl(baseURL, "no-such-run"), decisionUrl(baseURL, "no-such-run")]) {
      expect((await fetch(url)).status, url).toBe(404);
    }
  });
});

test.describe("DW7: verdict and what it doesn't show", () => {
  test("the review shows the proposal's verdict and notShown", async ({ page, baseURL }) => {
    const { id, proposal } = await finishedReviewRun(baseURL);
    expect(proposal.verdict, "code gave the proposal a verdict (REQ-11)").toBeTruthy();
    expect(proposal.notShown?.length ?? 0).toBeGreaterThan(0);

    await openReview(page, id);
    await expect(page.getByTestId("review-verdict")).toContainText(verdictLabel(proposal.verdict!));
    const notShown = page.getByTestId("review-not-shown");
    for (const line of proposal.notShown!) await expect(notShown).toContainText(new RegExp(escape(line)));
  });
});
