// Initiative lifecycle actions (ADR-0021 §3; REQ-PB-004, REQ-PB-006, REQ-PB-007, REQ-PB-022, REQ-S09-003; T-DG3-BE-B):
//   POST /api/v1/initiatives/{id}/submit    draft -> submitted        (initiative.edit; TransitionNote)
//   POST /api/v1/initiatives/{id}/withdraw  submitted|ranked -> draft (initiative.edit; reason)
//   POST /api/v1/initiatives/{id}/launch    funded -> launched        (initiative.launch; TransitionNote)
//   POST /api/v1/initiatives/{id}/cancel    non-terminal -> cancelled (initiative.edit; reason; not once launched)
// select / deselect are business approvals and live in selections.ts.
//
// The sequencing rules come from sequencing.ts (one implementation; no route re-implements them) with the facts of
// dispensations.ts (gate statuses G1-G3, counting waivers and inherited approvals); launch reads the funding state only
// through latestFundingState() (funding.ts). Preconditions are evaluated in the ADR-0021 §3 order and the FIRST failure
// is reported; `errors[]` lists every failing precondition of the transition. Launch checks direction (End-to-End: G2
// and G3 approved or waived) BEFORE funding, so an End-to-End launch without G3 reports the sequencing reason even for a
// selected-but-unfunded initiative. G4 is not a launch precondition (ADR-0021 §3 notes).
//
// Product gates G1-G6 are business approvals inside the product; a transition never grants one, a waiver never approves
// a gate, and nothing here touches the engineering gates DG0-DG7.
import type { InitiativeRow } from "@mth/db";
import type { Warning } from "@mth/shared/schemas";
import { reasonRequest, transitionNote } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpProblem, parse, sendVersioned, type ModuleDeps } from "../platform/index.ts";
import type { WriteContext } from "../transformations/index.ts";
import { loadSequencingFacts } from "./dispensations.ts";
import { latestFundingState } from "./funding.ts";
import { applyStatusChange, runInitiativeAction, transitionProblem } from "./repository.ts";
import { checkDirectionForLaunch, checkG1, type SequencingResult } from "./sequencing.ts";

const BASE = "/api/v1/initiatives/:initiativeId";
const JSON_BODY = ["application/json"] as const;
const idParams = z.strictObject({ initiativeId: z.uuid() });

/** The exact English texts of ADR-0021 §3 owned by the transitions (the sequencing ones live in sequencing.ts). */
export const TRANSITION_REASONS = {
  "initiative.outcome_before_activity":
    "Outcome before activity: link at least one measurable outcome with a KPI before submitting for prioritization",
  "initiative.selected_unfunded": "Selected - unfunded: a funding approval is required before launch",
  "initiative.not_launchable": "Only a funded initiative can be launched",
  "initiative.not_submittable": "Only a draft initiative can be submitted for prioritization",
  "initiative.not_withdrawable": "Only a submitted or ranked initiative can be withdrawn",
  "initiative.not_cancellable": "A launched, completed or cancelled initiative cannot be cancelled",
} as const;
type TransitionCode = keyof typeof TRANSITION_REASONS;

const REASONS: ReadonlyMap<string, string> = new Map(Object.entries(TRANSITION_REASONS));
const failure = (code: TransitionCode, pointer = ""): Warning => ({
  code,
  message: REASONS.get(code) ?? code,
  pointer,
});
const sequencingFailure = (r: SequencingResult): Warning[] =>
  r.ok ? [] : [{ code: r.code, message: r.reasonEn, pointer: "" }];

/** Throws the first failing precondition (422 invalid-transition) with all failing ones in `errors[]`. */
function refuseFirst(failures: readonly Warning[]): void {
  const first = failures[0];
  if (first !== undefined) throw transitionProblem(first.code, first.message, failures);
}

// ------------------------------------------------------------------------------------------------ submit

/** Does the initiative have >= 1 active outcome contribution that names a KPI (T02 row)? (REQ-PB-006) */
async function hasMeasurableContribution(ctx: WriteContext, initiativeId: string): Promise<boolean> {
  const row = await ctx.tx
    .selectFrom("initiative_outcome_contribution")
    .select("id")
    .where("initiative_id", "=", initiativeId)
    .where("status", "=", "active")
    .where("outcome_kpi_id", "is not", null)
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}

async function submit(ctx: WriteContext, current: InitiativeRow, note: string | undefined): Promise<void> {
  if (current.status !== "draft") refuseFirst([failure("initiative.not_submittable", "/status")]);
  const facts = await loadSequencingFacts(ctx.tx, ctx.transformationId);
  const g1 = sequencingFailure(checkG1(facts));
  const outcome = (await hasMeasurableContribution(ctx, current.id))
    ? []
    : [failure("initiative.outcome_before_activity", "/outcomeContributions")];
  // 1. G1 (invalid-transition), with every failing precondition listed.
  if (g1.length > 0) refuseFirst([...g1, ...outcome]);
  // 2. Outcome before activity: answered as a VALIDATION error (the acceptance calls it one), pointer /outcomeContributions.
  if (outcome.length > 0) {
    const o = outcome[0]!;
    throw new HttpProblem({
      status: 422,
      type: "urn:mth:problem:validation",
      code: o.code,
      title: "Business rule violated",
      detail: o.message,
      errors: [{ pointer: "/outcomeContributions", code: o.code, message: o.message }],
    });
  }
  await applyStatusChange(ctx, current, "submitted", "initiative.submit", { reason: note ?? null });
}

// ------------------------------------------------------------------------------------------------ withdraw, cancel

async function withdraw(ctx: WriteContext, current: InitiativeRow, reason: string): Promise<void> {
  if (current.status !== "submitted" && current.status !== "ranked")
    refuseFirst([failure("initiative.not_withdrawable", "/status")]);
  await applyStatusChange(ctx, current, "draft", "initiative.withdraw", { reason });
}

async function cancel(ctx: WriteContext, current: InitiativeRow, reason: string): Promise<void> {
  if (["launched", "completed", "cancelled"].includes(current.status))
    refuseFirst([failure("initiative.not_cancellable", "/status")]);
  await applyStatusChange(ctx, current, "cancelled", "initiative.cancel", {
    reason,
    set: { cancelled_at: new Date(), cancelled_by: ctx.userId, cancel_reason: reason },
  });
}

// ------------------------------------------------------------------------------------------------ launch

/**
 * The launch preconditions in ADR-0021 §3 order, every failing one: 1. G1 (only while still draft); 2. End-to-End
 * direction (G2 and G3 approved, or a counting waiver for each missing one; Modular is not held to it); 3. selected
 * without a current approved funding decision ('Selected - unfunded'); 4. any other status than funded.
 */
export async function launchFailures(ctx: WriteContext, current: InitiativeRow): Promise<Warning[]> {
  const facts = await loadSequencingFacts(ctx.tx, ctx.transformationId);
  const out: Warning[] = [];
  if (current.status === "draft") out.push(...sequencingFailure(checkG1(facts)));
  out.push(...sequencingFailure(checkDirectionForLaunch(facts, current.id)));
  const funding = await latestFundingState(ctx.tx, current.id);
  if (current.status === "selected" || (current.status === "funded" && funding !== "funded"))
    out.push(failure("initiative.selected_unfunded", "/status"));
  else if (current.status !== "funded") out.push(failure("initiative.not_launchable", "/status"));
  return out;
}

async function launch(ctx: WriteContext, current: InitiativeRow, note: string | undefined): Promise<void> {
  refuseFirst(await launchFailures(ctx, current));
  await applyStatusChange(ctx, current, "launched", "initiative.launch", {
    reason: note ?? null,
    set: { launched_at: new Date(), launched_by: ctx.userId },
  });
}

// ------------------------------------------------------------------------------------------------ routes

export function registerInitiativeTransitionRoutes(app: FastifyInstance, { db }: ModuleDeps): readonly string[] {
  const edit = { access: { permission: "initiative.edit" as const }, consumes: JSON_BODY };
  const launchAccess = { access: { permission: "initiative.launch" as const }, consumes: JSON_BODY };

  app.post(`${BASE}/submit`, { config: edit }, async (request, reply) => {
    const { initiativeId } = parse(idParams, request.params, "params");
    const body = await runInitiativeAction(db, request, initiativeId, "initiative.edit", transitionNote, (ctx, c, b) =>
      submit(ctx, c, b.note),
    );
    return sendVersioned(reply, 200, body);
  });

  app.post(`${BASE}/withdraw`, { config: edit }, async (request, reply) => {
    const { initiativeId } = parse(idParams, request.params, "params");
    const body = await runInitiativeAction(db, request, initiativeId, "initiative.edit", reasonRequest, (ctx, c, b) =>
      withdraw(ctx, c, b.reason),
    );
    return sendVersioned(reply, 200, body);
  });

  app.post(`${BASE}/launch`, { config: launchAccess }, async (request, reply) => {
    const { initiativeId } = parse(idParams, request.params, "params");
    const body = await runInitiativeAction(
      db,
      request,
      initiativeId,
      "initiative.launch",
      transitionNote,
      (ctx, c, b) => launch(ctx, c, b.note),
    );
    return sendVersioned(reply, 200, body);
  });

  app.post(`${BASE}/cancel`, { config: edit }, async (request, reply) => {
    const { initiativeId } = parse(idParams, request.params, "params");
    const body = await runInitiativeAction(db, request, initiativeId, "initiative.edit", reasonRequest, (ctx, c, b) =>
      cancel(ctx, c, b.reason),
    );
    return sendVersioned(reply, 200, body);
  });

  return [`POST ${BASE}/submit`, `POST ${BASE}/withdraw`, `POST ${BASE}/launch`, `POST ${BASE}/cancel`];
}
