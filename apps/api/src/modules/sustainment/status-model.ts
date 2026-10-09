// The four separate statuses of an initiative and the transformation status model (P4 slice G; ADR-0034 §1, §2, §9,
// §11, §12; T-DG4-BE-J; REQ-S03-003 "views show all four side by side", REQ-PB-009, REQ-S11-006, REQ-PB-069 (adoption at
// risk from the indicator)):
//   GET  /initiatives/{i}/status-model                 delivery, adoption (+ source), validated value, closure, label
//                                                      (transformation.read)
//   POST /initiatives/{i}/complete-delivery            launched -> completed with the delivery stamps; nothing else
//                                                      changes (initiative.complete_delivery; WL, TL; If-Match)
//   POST /initiatives/{i}/adoption-status              the owner's adoption assessment with a note (adoption_status.set;
//                                                      BO; If-Match)
//   GET  /transformations/{t}/status-model             delivery complete, value validation pending, BAU accepted and
//                                                      closure as separate states, with the label (transformation.read)
//
// Delivery, adoption, validated value and closure never derive from one another (ADR-0034 §1, M0092): completing
// delivery writes only `status` and the delivery stamps; only setInitiativeAdoptionStatus writes `adoption_status`; the
// value status is computed here from Finance validations and approved transition decisions (valueStatusOf, which the
// workspace header of slice J reads too); closure is a `closure_record` (closure.ts). No label says "successful", and
// none is derived from initiative completion alone (M0218). The value status is computed from validations, never from
// amounts; a forecast is never reported as validated or sustained (§11).
//
// Every mutation: the read gate on the request principal (an ADM-only user or an outsider gets 404, ADR-0006), then the
// write permission re-checked at commit time on the reloaded grants (AUD 403), validation, If-Match (428/409), one audit
// event in the same transaction, and no remote I/O inside it (S-4). Nothing here is a G1-G6 business approval, and
// nothing touches DG0-DG7.
import { sql, type DbOrTx, type Tx } from "@mth/db";
import { PROBLEM_TYPES } from "@mth/shared";
import {
  initiativeAdoptionStatusSet,
  SETTABLE_ADOPTION_STATUSES,
  statusNote,
  type AdoptionStatus,
  type InitiativeStatusLabel,
  type InitiativeStatusModel,
  type SubjectValueStatus,
  type TransformationStatusLabel,
  type TransformationStatusModel,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { principalOf, requireTransformationRead, type Principal } from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  HttpProblem,
  isoOrNull,
  parse,
  parseBody,
  problems,
  requireIfMatch,
  sendVersioned,
  type ModuleDeps,
} from "../platform/index.ts";
import { JSON_BODY, openSustainmentWrite, parseTransformationParam, sustainTransition } from "./performance-areas.ts";

export const INITIATIVE_STATUS_MODEL = "/api/v1/initiatives/:initiativeId/status-model";
export const INITIATIVE_COMPLETE_DELIVERY = "/api/v1/initiatives/:initiativeId/complete-delivery";
export const INITIATIVE_ADOPTION_STATUS = "/api/v1/initiatives/:initiativeId/adoption-status";
export const TRANSFORMATION_STATUS_MODEL = "/api/v1/transformations/:transformationId/status-model";
export const COMPLETE_DELIVERY_PERMISSION = "initiative.complete_delivery" as const;
export const ADOPTION_STATUS_PERMISSION = "adoption_status.set" as const;

// ------------------------------------------------------------------------------------------------ problems (§12, S-11)

const DELIVERY_NOT_LAUNCHED = () =>
  sustainTransition("initiative.delivery_not_launched", "Only a launched initiative can be marked delivery complete.");
const ADOPTION_STATUS_INVALID = () =>
  new HttpProblem({
    status: 422,
    type: PROBLEM_TYPES.validation,
    code: "initiative.adoption_status_invalid",
    title: "Business rule violated",
    detail: "Adoption status must be On track, At risk or Adopted.",
    errors: [
      {
        pointer: "/adoptionStatus",
        code: "initiative.adoption_status_invalid",
        message: "Adoption status must be On track, At risk or Adopted.",
      },
    ],
  });

// ------------------------------------------------------------------------------------------------ value status (§2)

/** The state of one benefit for the value status (ADR-0034 §2). */
export type BenefitValueState = "validated" | "transition" | "pending";

export interface BenefitValueFact {
  readonly benefitId: string;
  readonly code: string;
  readonly state: BenefitValueState;
  /** The Finance-validated measurement ids (state validated). */
  readonly validatedMeasurementIds: readonly string[];
  /** The approved transition decision (state transition), else null. */
  readonly transitionDecisionId: string | null;
  /** The approved transition decision's residual owner (its sustainment owner), else null. */
  readonly residualOwnerUserId: string | null;
  readonly bauOwnerUserId: string | null;
}

export interface ValueStatusResult {
  readonly status: SubjectValueStatus;
  readonly benefits: readonly BenefitValueFact[];
}

export type ValueSubject =
  | { readonly kind: "initiative"; readonly transformationId: string; readonly initiativeId: string }
  | { readonly kind: "transformation"; readonly transformationId: string };

/**
 * The validated-value status of an initiative or a transformation (ADR-0034 §2), with the per-benefit facts the closure
 * snapshot records. Benefits of an initiative: active benefits allocated to it in their allocation set in force, or
 * enabled by it through an active enabler; of a transformation: its active benefits. Per benefit: `validated` with at
 * least one Finance-validated measurement; else `transition` with an approved transition decision; else `pending`.
 * Status: `no_benefit` (none), `validation_pending` (any pending), `validated` (all validated), else
 * `validated_with_transition`. Computed from validations and decisions only, never from amounts.
 */
export async function valueStatusOf(db: DbOrTx, subject: ValueSubject): Promise<ValueStatusResult> {
  let q = db
    .selectFrom("benefit as b")
    .select(["b.id", "b.code", "b.bau_owner_user_id"])
    .where("b.transformation_id", "=", subject.transformationId)
    .where("b.status", "=", "active");
  if (subject.kind === "initiative") {
    const initiativeId = subject.initiativeId;
    q = q.where((eb) =>
      eb.or([
        eb.exists(
          eb
            .selectFrom("benefit_allocation as ba")
            .select("ba.id")
            .whereRef("ba.benefit_id", "=", "b.id")
            .whereRef("ba.set_no", "=", "b.allocation_set_no")
            .where("ba.initiative_id", "=", initiativeId),
        ),
        eb.exists(
          eb
            .selectFrom("benefit_enabler as be")
            .select("be.id")
            .whereRef("be.benefit_id", "=", "b.id")
            .where("be.status", "=", "active")
            .where("be.initiative_id", "=", initiativeId),
        ),
      ]),
    );
  }
  const benefits = await q.orderBy("b.code").orderBy("b.id").execute();
  if (benefits.length === 0) return { status: "no_benefit", benefits: [] };
  const ids = benefits.map((b) => b.id);
  const measurements = await db
    .selectFrom("benefit_measurement")
    .select(["id", "benefit_id"])
    .where("benefit_id", "in", ids)
    .where("status", "=", "validated")
    .orderBy("id")
    .execute();
  const decisions = await db
    .selectFrom("transition_decision")
    .select(["id", "benefit_id", "residual_owner_user_id"])
    .where("benefit_id", "in", ids)
    .where("status", "=", "approved")
    .execute();
  const facts: BenefitValueFact[] = benefits.map((b) => {
    const validated = measurements.filter((m) => m.benefit_id === b.id).map((m) => m.id);
    const decision = decisions.find((d) => d.benefit_id === b.id) ?? null;
    const state: BenefitValueState = validated.length > 0 ? "validated" : decision !== null ? "transition" : "pending";
    return {
      benefitId: b.id,
      code: b.code,
      state,
      validatedMeasurementIds: state === "validated" ? validated : [],
      transitionDecisionId: state === "transition" ? decision!.id : null,
      residualOwnerUserId: state === "transition" ? decision!.residual_owner_user_id : null,
      bauOwnerUserId: b.bau_owner_user_id,
    };
  });
  const status: SubjectValueStatus = facts.some((f) => f.state === "pending")
    ? "validation_pending"
    : facts.every((f) => f.state === "validated")
      ? "validated"
      : "validated_with_transition";
  return { status, benefits: facts };
}

const VALUE_PENDING: ReadonlySet<SubjectValueStatus> = new Set(["no_benefit", "validation_pending"]);
/** True when the value status is "no benefit" or "validation pending" (the closure refusal and the labels). */
export const isValuePending = (status: SubjectValueStatus): boolean => VALUE_PENDING.has(status);

// ------------------------------------------------------------------------------------------------ the initiative model

interface InitiativeFacts {
  id: string;
  organization_id: string;
  transformation_id: string;
  code: string;
  status: string;
  version: number;
  delivery_completed_at: Date | string | null;
  delivery_completed_by: string | null;
  adoption_status: string;
  adoption_status_note: string | null;
  adoption_status_set_at: Date | string | null;
  adoption_status_set_by: string | null;
}

async function findInitiative(db: DbOrTx, initiativeId: string, lock = false): Promise<InitiativeFacts | undefined> {
  let q = db
    .selectFrom("initiative")
    .select([
      "id",
      "organization_id",
      "transformation_id",
      "code",
      "status",
      "version",
      "delivery_completed_at",
      "delivery_completed_by",
      "adoption_status",
      "adoption_status_note",
      "adoption_status_set_at",
      "adoption_status_set_by",
    ])
    .where("id", "=", initiativeId);
  if (lock) q = q.forUpdate();
  return (await q.executeTakeFirst()) as InitiativeFacts | undefined;
}

/**
 * The initiative and its transformation for an `/initiatives/{id}` path: 404 when the initiative does not exist or its
 * transformation is not readable by `principal` (no existence disclosure, ADR-0006).
 */
export async function readableInitiative(db: DbOrTx, principal: Principal, initiativeId: string) {
  const i = await findInitiative(db, initiativeId);
  if (!i) throw problems.notFound();
  await requireTransformationRead(db, principal, i.transformation_id);
  return i;
}

/**
 * The adoption signal of ADR-0033 §1: an open (planned or in progress) below-trajectory intervention for a metric link
 * targeting the initiative, or for an evaluation scoped to the initiative.
 */
async function adoptionAtRiskByIndicator(db: DbOrTx, transformationId: string, initiativeId: string): Promise<boolean> {
  const row = await db
    .selectFrom("adoption_intervention as ai")
    .select("ai.id")
    .where("ai.transformation_id", "=", transformationId)
    .where("ai.origin", "=", "below_trajectory")
    .where("ai.status", "in", ["planned", "in_progress"])
    .where((eb) =>
      eb.or([
        eb.and([eb("ai.scope_kind", "=", "initiative"), eb("ai.scope_id", "=", initiativeId)]),
        eb.exists(
          eb
            .selectFrom("adoption_metric_link as ml")
            .select("ml.id")
            .whereRef("ml.id", "=", "ai.metric_link_id")
            .where("ml.target_kind", "=", "initiative")
            .where("ml.initiative_id", "=", initiativeId),
        ),
      ]),
    )
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}

/** The closure record id of an initiative, or null. */
async function initiativeClosureId(db: DbOrTx, initiativeId: string): Promise<string | null> {
  const r = await db
    .selectFrom("closure_record")
    .select("id")
    .where("subject_kind", "=", "initiative")
    .where("initiative_id", "=", initiativeId)
    .executeTakeFirst();
  return r?.id ?? null;
}

function initiativeLabel(delivery: string, value: SubjectValueStatus, closed: boolean): InitiativeStatusLabel {
  if (closed) return "Closed";
  if (delivery === "completed")
    return isValuePending(value) ? "Delivered — value validation pending" : "Delivered — value validated";
  return "In delivery";
}

/** The four separate statuses of one initiative and its label (ADR-0034 §2). */
export async function initiativeStatusModel(db: DbOrTx, initiativeId: string): Promise<InitiativeStatusModel> {
  const i = await findInitiative(db, initiativeId);
  if (!i) throw problems.notFound();
  const value = await valueStatusOf(db, {
    kind: "initiative",
    transformationId: i.transformation_id,
    initiativeId: i.id,
  });
  const byIndicator = await adoptionAtRiskByIndicator(db, i.transformation_id, i.id);
  const closureRecordId = await initiativeClosureId(db, i.id);
  return {
    initiativeId: i.id,
    version: i.version,
    delivery: i.status,
    deliveryCompletedAt: isoOrNull(i.delivery_completed_at as Date | null),
    deliveryCompletedBy: i.delivery_completed_by,
    adoption: byIndicator ? "at_risk" : (i.adoption_status as AdoptionStatus),
    adoptionSource: byIndicator ? "indicator" : "owner",
    value: value.status,
    closure: closureRecordId === null ? "open" : "closed",
    closureRecordId,
    label: initiativeLabel(i.status, value.status, closureRecordId !== null),
  };
}

// ------------------------------------------------------------------------------------------------ the transformation model

export type BauState = TransformationStatusModel["bauState"];

/** The BAU state of a transformation's performance areas (ADR-0034 §2), with the counts. */
export async function bauStateOf(
  db: DbOrTx,
  transformationId: string,
): Promise<{ bauState: BauState; total: number; bau: number }> {
  const areas = await db
    .selectFrom("performance_area")
    .select("status")
    .where("transformation_id", "=", transformationId)
    .where("status", "<>", "retired")
    .execute();
  const total = areas.length;
  const bau = areas.filter((a) => a.status === "bau").length;
  return { bauState: total === 0 ? "no_performance_area" : bau === total ? "bau_accepted" : "bau_pending", total, bau };
}

/** The transformation status model (ADR-0034 §2; REQ-S11-006). The transformation must exist. */
export async function transformationStatusModel(
  db: DbOrTx,
  transformationId: string,
): Promise<TransformationStatusModel> {
  const initiatives = await db
    .selectFrom("initiative")
    .select("status")
    .where("transformation_id", "=", transformationId)
    .where("status", "<>", "cancelled")
    .execute();
  const total = initiatives.length;
  const completed = initiatives.filter((i) => i.status === "completed").length;
  const deliveryState = total > 0 && completed === total ? "delivery_complete" : "in_delivery";
  const value = await valueStatusOf(db, { kind: "transformation", transformationId });
  const bau = await bauStateOf(db, transformationId);
  const closure = await db
    .selectFrom("closure_record")
    .select("id")
    .where("transformation_id", "=", transformationId)
    .where("subject_kind", "=", "transformation")
    .executeTakeFirst();
  const closureState = closure === undefined ? "open" : "closed";
  let label: TransformationStatusLabel = "In delivery";
  if (closureState === "closed") label = "Closed";
  else if (deliveryState === "delivery_complete" && isValuePending(value.status))
    label = "Delivery complete - value validation pending";
  else if (deliveryState === "delivery_complete")
    label =
      bau.bauState === "bau_accepted" ? "Value validated - BAU accepted" : "Value validated - BAU acceptance pending";
  return {
    transformationId,
    deliveryState,
    valueState: value.status,
    bauState: bau.bauState,
    closureState,
    label,
    initiatives: { total, completed },
    performanceAreas: { total: bau.total, bau: bau.bau },
  };
}

// ------------------------------------------------------------------------------------------------ writes

const initiativeParams = z.strictObject({ initiativeId: z.uuid() });
const parseInitiativeParam = (params: unknown): string => parse(initiativeParams, params, "params").initiativeId;

/**
 * The write gate of an initiative status action: the initiative's transformation is resolved first (404 when unknown or
 * unreadable), then openSustainmentWrite re-checks `permission` at commit time and refuses an archived transformation
 * (422 transformation.archived). Returns the locked initiative row.
 */
async function openInitiativeWrite(
  tx: Tx,
  request: FastifyRequest,
  initiativeId: string,
  permission: typeof COMPLETE_DELIVERY_PERMISSION | typeof ADOPTION_STATUS_PERMISSION,
) {
  const seen = await findInitiative(tx, initiativeId);
  if (!seen) throw problems.notFound();
  const ctx = await openSustainmentWrite(tx, request, seen.transformation_id, permission);
  const current = (await findInitiative(tx, initiativeId, true))!;
  return { ctx, current };
}

/**
 * completeInitiativeDelivery: launched -> completed with who and when (the database sets them once, with this move).
 * Writes nothing else: adoption, validated value and closure stay as they are (REQ-S03-003). The optional note is kept
 * in the audit event (the initiative has no delivery-note column).
 */
async function completeDelivery(tx: Tx, request: FastifyRequest, initiativeId: string): Promise<void> {
  const { ctx, current } = await openInitiativeWrite(tx, request, initiativeId, COMPLETE_DELIVERY_PERMISSION);
  const body = parseBody(statusNote, request.body ?? {});
  const expected = requireIfMatch(request);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status !== "launched") throw DELIVERY_NOT_LAUNCHED();
  const updated = await tx
    .updateTable("initiative")
    .set({
      status: "completed",
      delivery_completed_at: sql<Date>`now()`,
      delivery_completed_by: ctx.userId,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returning(["version", "delivery_completed_at"])
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "initiative.complete_delivery",
    recordType: "initiative",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId: current.transformation_id,
    priorVersion: current.version,
    newVersion: updated.version,
    ...(body.note !== undefined ? { reason: body.note } : {}),
    changes: {
      status: { from: current.status, to: "completed" },
      delivery_completed_by: { from: null, to: ctx.userId },
    },
  });
}

/**
 * Parses an InitiativeAdoptionStatusSet body: an `adoptionStatus` that is a string but not one of the three settable
 * values (e.g. `not_assessed`) is the business rule 422 initiative.adoption_status_invalid at /adoptionStatus
 * (ADR-0034 §12); every other error (missing member, wrong type, unknown member) is the generic 400.
 */
function parseAdoptionBody(raw: unknown) {
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    const value = (raw as Record<string, unknown>)["adoptionStatus"];
    if (typeof value === "string" && !(SETTABLE_ADOPTION_STATUSES as readonly string[]).includes(value))
      throw ADOPTION_STATUS_INVALID();
  }
  return parseBody(initiativeAdoptionStatusSet, raw);
}

/** setInitiativeAdoptionStatus: the Business Owner's assessment, stamped; never derived from delivery. */
async function setAdoptionStatus(tx: Tx, request: FastifyRequest, initiativeId: string): Promise<void> {
  const { ctx, current } = await openInitiativeWrite(tx, request, initiativeId, ADOPTION_STATUS_PERMISSION);
  const body = parseAdoptionBody(request.body);
  const expected = requireIfMatch(request);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  const note = body.note ?? null;
  const updated = await tx
    .updateTable("initiative")
    .set({
      adoption_status: body.adoptionStatus,
      adoption_status_note: note,
      adoption_status_set_at: sql<Date>`now()`,
      adoption_status_set_by: ctx.userId,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returning(["version"])
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "initiative.set_adoption_status",
    recordType: "initiative",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId: current.transformation_id,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: {
      adoption_status: { from: current.adoption_status, to: body.adoptionStatus },
      adoption_status_note: { from: current.adoption_status_note, to: note },
      adoption_status_set_by: { from: current.adoption_status_set_by, to: ctx.userId },
    },
  });
}

// ------------------------------------------------------------------------------------------------ routes

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerStatusModelRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "transformation.read" as const } };
  const completeCfg = { access: { permission: COMPLETE_DELIVERY_PERMISSION }, consumes: JSON_BODY };
  const adoptionCfg = { access: { permission: ADOPTION_STATUS_PERMISSION }, consumes: JSON_BODY };

  app.get(INITIATIVE_STATUS_MODEL, { config: read }, async (request, reply) => {
    const initiativeId = parseInitiativeParam(request.params);
    await readableInitiative(db, principalOf(request), initiativeId);
    return sendVersioned(reply, 200, await initiativeStatusModel(db, initiativeId));
  });

  app.post(INITIATIVE_COMPLETE_DELIVERY, { config: completeCfg }, async (request, reply) => {
    const initiativeId = parseInitiativeParam(request.params);
    const body = await db.transaction().execute(async (tx) => {
      await completeDelivery(tx, request, initiativeId);
      return initiativeStatusModel(tx, initiativeId);
    });
    return sendVersioned(reply, 200, body);
  });

  app.post(INITIATIVE_ADOPTION_STATUS, { config: adoptionCfg }, async (request, reply) => {
    const initiativeId = parseInitiativeParam(request.params);
    const body = await db.transaction().execute(async (tx) => {
      await setAdoptionStatus(tx, request, initiativeId);
      return initiativeStatusModel(tx, initiativeId);
    });
    return sendVersioned(reply, 200, body);
  });

  app.get(TRANSFORMATION_STATUS_MODEL, { config: read }, async (request) => {
    const transformationId = parseTransformationParam(request.params);
    await requireTransformationRead(db, principalOf(request), transformationId);
    return transformationStatusModel(db, transformationId);
  });

  return [
    `GET ${INITIATIVE_STATUS_MODEL}`,
    `POST ${INITIATIVE_COMPLETE_DELIVERY}`,
    `POST ${INITIATIVE_ADOPTION_STATUS}`,
    `GET ${TRANSFORMATION_STATUS_MODEL}`,
  ];
}
