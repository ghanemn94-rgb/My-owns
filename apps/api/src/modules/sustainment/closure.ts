// The governed closure of an initiative and of a transformation (P4 slice G; ADR-0034 §7, §9, §10, §12; T-DG4-BE-J;
// REQ-PB-009 "an initiative with delivery=Complete and no validated benefit cannot be closed (API 422
// invalid-transition)", REQ-S03-003 "the API rejects a closure request while validated value is pending unless a
// transition decision exists", REQ-S11-007; D-089 Q4 "G6 approval does not close a transformation"):
//   POST /initiatives/{i}/close                      the closure record (initiative.close; TL)
//   POST /transformations/{t}/close                  the closure record and status closed, never archived
//                                                    (transformation.close; TL)
//   GET  /transformations/{t}/closure-records        the transformation's closure records, append-only
//                                                    (transformation.read)
//
// The checks run in ADR-0034 §7's order under lock class closure (ADVISORY_LOCK_CLASSES.closure; `initiative:<id>` / `transformation:<id>`),
// and the first failure answers. A closure is a `closure_record` (one per subject; append-only) with the basis and a
// snapshot of what was checked: per benefit the Finance-validated measurement ids or the approved transition decision,
// and for a transformation also the approved G6 gate decision and the accepted BAU handovers. Closing a transformation
// sets `status = 'closed'` (version + 1, audited) and NEVER `archived_at`, so the DG1-DG3 write guards (which test
// `archived_at`) keep accepting KPI actuals, register writes, reviews, control checks, the CI backlog and lessons
// (ADR-0034 Context 3; REQ-S03-002). The approved G6 is READ here, never written: G6 is the product's Sustain business
// approval, decided by a person; closure is a separate governed action (D-089 Q4), and nothing here reads or writes the
// engineering gates DG0-DG7 (product G6 never implies DG7).
//
// Every mutation: the read gate on the request principal (an ADM-only user or an outsider gets 404, ADR-0006), then the
// write permission re-checked at commit time on the reloaded grants (AUD 403), validation, one audit event per written
// row in the same transaction, and no remote I/O inside it (S-4). A close creates a record (version 1, no If-Match, as
// the contract declares); a repeated close is 409 closure.already_closed.
import { sql, type DbOrTx, type Tx } from "@mth/db";
import { freeText, type ClosureBasis, type ClosureRecord } from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { principalOf, requireTransformationRead } from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  ADVISORY_LOCK_CLASSES,
  cursorSchema,
  decodeCursor,
  filterHash,
  iso,
  limitSchema,
  paginate,
  parse,
  parseBody,
  parseQuery,
  problems,
  type ModuleDeps,
} from "../platform/index.ts";
import { JSON_BODY, openSustainmentWrite, parseTransformationParam, sustainTransition } from "./performance-areas.ts";
import { bauStateOf, isValuePending, valueStatusOf, type BenefitValueFact } from "./status-model.ts";

export const INITIATIVE_CLOSE = "/api/v1/initiatives/:initiativeId/close";
export const TRANSFORMATION_CLOSE = "/api/v1/transformations/:transformationId/close";
export const CLOSURE_RECORDS = "/api/v1/transformations/:transformationId/closure-records";
export const INITIATIVE_CLOSE_PERMISSION = "initiative.close" as const;
export const TRANSFORMATION_CLOSE_PERMISSION = "transformation.close" as const;

// ------------------------------------------------------------------------------------------------ problems (§12, S-11)

const DELIVERY_NOT_COMPLETE = () =>
  sustainTransition("closure.delivery_not_complete", "Initiative delivery is not complete.");
const ALREADY_CLOSED = (subject: "initiative" | "transformation") =>
  problems.duplicate("closure.already_closed", `This ${subject} is already closed.`);
const INITIATIVE_VALUE_PENDING = () =>
  sustainTransition(
    "closure.value_validation_pending",
    "Delivered — value validation pending: an initiative closes only when each of its benefits is validated by " +
      "Finance or covered by an approved transition decision.",
  );
const TRANSFORMATION_VALUE_PENDING = () =>
  sustainTransition(
    "closure.value_validation_pending",
    "Validated value is pending: a transformation closes only when each of its benefits is validated by Finance or " +
      "covered by an approved transition decision.",
  );
const SUSTAINMENT_OWNER_MISSING = () =>
  sustainTransition("closure.sustainment_owner_missing", "Each validated benefit needs a BAU owner before closure.");
const NOT_OPEN = () =>
  sustainTransition("closure.transformation_not_open", "Only an active or on-hold transformation can be closed.");
const G6_NOT_APPROVED = () =>
  sustainTransition("closure.g6_not_approved", "Closure requires the G6 (Sustain) business approval.");
const BAU_NOT_ACCEPTED = () =>
  sustainTransition(
    "closure.bau_not_accepted",
    "Every performance area of this transformation needs an accepted BAU handover before closure.",
  );

/**
 * The close body (OpenAPI `StatusNote`). The `closure_record.closure_note` column holds 3-2000 characters, so a note
 * shorter than 3 characters is a 400 at /note here rather than a database error.
 */
const closeBody = z.strictObject({ note: freeText(3, 2000).optional() });

// ------------------------------------------------------------------------------------------------ rows and presenter

interface ClosureRow {
  id: string;
  transformation_id: string;
  subject_kind: string;
  initiative_id: string | null;
  basis: string;
  snapshot: unknown;
  closure_note: string | null;
  closed_at: Date | string;
  closed_by: string;
}

const toClosureRecord = (r: ClosureRow): ClosureRecord => ({
  id: r.id,
  transformationId: r.transformation_id,
  subjectKind: r.subject_kind as ClosureRecord["subjectKind"],
  initiativeId: r.initiative_id,
  basis: r.basis as ClosureBasis,
  snapshot: (typeof r.snapshot === "string" ? JSON.parse(r.snapshot) : r.snapshot) as Record<string, unknown>,
  closureNote: r.closure_note,
  closedAt: iso(r.closed_at as Date),
  closedBy: r.closed_by,
});

async function findClosure(db: DbOrTx, id: string): Promise<ClosureRecord> {
  const row = await db.selectFrom("closure_record").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
  return toClosureRecord(row as ClosureRow);
}

// ------------------------------------------------------------------------------------------------ shared steps

/** Transaction-scoped lock class closure (ADR-0034 §10) on `initiative:<id>` or `transformation:<id>`. */
async function lockClosure(tx: Tx, key: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.closure}::int4, hashtext(${key}))`.execute(tx);
}

/** The basis of a closure from the per-benefit states (none is pending once the value check passed). */
function basisOf(benefits: readonly BenefitValueFact[]): ClosureBasis {
  const validated = benefits.some((b) => b.state === "validated");
  const transition = benefits.some((b) => b.state === "transition");
  return validated && transition
    ? "validated_value_and_transition_decision"
    : transition
      ? "transition_decision"
      : "validated_value";
}

/** The per-benefit part of the snapshot: what the value check saw. */
const benefitSnapshot = (benefits: readonly BenefitValueFact[]) =>
  benefits.map((b) => ({
    benefitId: b.benefitId,
    code: b.code,
    state: b.state,
    validatedMeasurementIds: b.validatedMeasurementIds,
    transitionDecisionId: b.transitionDecisionId,
    sustainmentOwnerUserId: b.state === "transition" ? b.residualOwnerUserId : b.bauOwnerUserId,
  }));

// ------------------------------------------------------------------------------------------------ closeInitiative

/**
 * closeInitiative (ADR-0034 §7): 1. not delivery-complete -> 422 closure.delivery_not_complete; 2. already closed ->
 * 409 closure.already_closed; 3. value status no_benefit or validation_pending -> 422 closure.value_validation_pending;
 * 4. a validated benefit without a BAU owner -> 422 closure.sustainment_owner_missing (a transition benefit's
 * sustainment owner is its residual owner). Then the closure record and its audit event; the initiative row is not
 * changed (its delivery status stays `completed`; closure is the record).
 */
async function closeInitiative(tx: Tx, request: FastifyRequest, initiativeId: string): Promise<string> {
  const seen = await tx
    .selectFrom("initiative")
    .select(["id", "transformation_id"])
    .where("id", "=", initiativeId)
    .executeTakeFirst();
  if (!seen) throw problems.notFound();
  const ctx = await openSustainmentWrite(tx, request, seen.transformation_id, INITIATIVE_CLOSE_PERMISSION);
  const body = parseBody(closeBody, request.body ?? {});
  await lockClosure(tx, `initiative:${initiativeId}`);
  const initiative = await tx
    .selectFrom("initiative")
    .select(["id", "status", "version"])
    .where("id", "=", initiativeId)
    .forShare()
    .executeTakeFirstOrThrow();
  if (initiative.status !== "completed") throw DELIVERY_NOT_COMPLETE();
  const existing = await tx
    .selectFrom("closure_record")
    .select("id")
    .where("subject_kind", "=", "initiative")
    .where("initiative_id", "=", initiativeId)
    .executeTakeFirst();
  if (existing) throw ALREADY_CLOSED("initiative");
  const value = await valueStatusOf(tx, {
    kind: "initiative",
    transformationId: seen.transformation_id,
    initiativeId,
  });
  if (isValuePending(value.status)) throw INITIATIVE_VALUE_PENDING();
  if (value.benefits.some((b) => b.state === "validated" && b.bauOwnerUserId === null))
    throw SUSTAINMENT_OWNER_MISSING();
  const id = uuidv7();
  const basis = basisOf(value.benefits);
  const snapshot = {
    valueStatus: value.status,
    initiativeVersion: initiative.version,
    benefits: benefitSnapshot(value.benefits),
  };
  await tx
    .insertInto("closure_record")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: seen.transformation_id,
      subject_kind: "initiative",
      initiative_id: initiativeId,
      basis,
      snapshot: JSON.stringify(snapshot),
      closure_note: body.note ?? null,
      closed_by: ctx.userId,
      created_by: ctx.userId,
    })
    .execute();
  await record(tx, ctx.audit, {
    action: "initiative.close",
    recordType: "closure_record",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId: seen.transformation_id,
    ...(body.note !== undefined ? { reason: body.note } : {}),
    changes: {
      subject_kind: { from: null, to: "initiative" },
      initiative_id: { from: null, to: initiativeId },
      basis: { from: null, to: basis },
    },
  });
  return id;
}

// ------------------------------------------------------------------------------------------------ closeTransformation

/**
 * closeTransformation (ADR-0034 §7): 1. archived -> 422 transformation.archived (the DG1 code and text, from the write
 * gate); already closed -> 409 closure.already_closed; 2. status not active or on_hold -> 422
 * closure.transformation_not_open; 3. G6 not approved -> 422 closure.g6_not_approved; 4. value status no_benefit or
 * validation_pending -> 422 closure.value_validation_pending (a pending benefit covered by an approved transition
 * decision is not pending); 5. a performance area not in BAU -> 422 closure.bau_not_accepted. Then, in this
 * transaction: the closure record, `status = 'closed'` (version + 1; never `archived_at`) and their audit events.
 */
async function closeTransformation(tx: Tx, request: FastifyRequest, transformationId: string): Promise<string> {
  const ctx = await openSustainmentWrite(tx, request, transformationId, TRANSFORMATION_CLOSE_PERMISSION);
  const body = parseBody(closeBody, request.body ?? {});
  await lockClosure(tx, `transformation:${transformationId}`);
  const t = await tx
    .selectFrom("transformation")
    .select(["id", "status", "version"])
    .where("id", "=", transformationId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  const existing = await tx
    .selectFrom("closure_record")
    .select("id")
    .where("subject_kind", "=", "transformation")
    .where("transformation_id", "=", transformationId)
    .executeTakeFirst();
  if (existing) throw ALREADY_CLOSED("transformation");
  if (t.status !== "active" && t.status !== "on_hold") throw NOT_OPEN();
  const g6 = await tx
    .selectFrom("gate_instance")
    .select(["id", "status"])
    .where("transformation_id", "=", transformationId)
    .where("gate_code", "=", "G6")
    .executeTakeFirst();
  if (!g6 || g6.status !== "approved") throw G6_NOT_APPROVED();
  const value = await valueStatusOf(tx, { kind: "transformation", transformationId });
  if (isValuePending(value.status)) throw TRANSFORMATION_VALUE_PENDING();
  const bau = await bauStateOf(tx, transformationId);
  if (bau.bauState === "bau_pending") throw BAU_NOT_ACCEPTED();
  const g6Decision = await tx
    .selectFrom("gate_decision")
    .select("id")
    .where("transformation_id", "=", transformationId)
    .where("gate_code", "=", "G6")
    .where("outcome", "=", "approved")
    .orderBy("decided_at", "desc")
    .orderBy("id", "desc")
    .executeTakeFirst();
  const handovers = await tx
    .selectFrom("bau_handover as h")
    .innerJoin("performance_area as a", "a.current_handover_id", "h.id")
    .select("h.id")
    .where("a.transformation_id", "=", transformationId)
    .where("a.status", "=", "bau")
    .where("h.status", "=", "accepted")
    .orderBy("h.id")
    .execute();
  const id = uuidv7();
  const basis = basisOf(value.benefits);
  const snapshot = {
    valueStatus: value.status,
    benefits: benefitSnapshot(value.benefits),
    g6: { gateInstanceId: g6.id, gateDecisionId: g6Decision?.id ?? null },
    bauState: bau.bauState,
    acceptedHandoverIds: handovers.map((h) => h.id),
  };
  await tx
    .insertInto("closure_record")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      subject_kind: "transformation",
      initiative_id: null,
      basis,
      snapshot: JSON.stringify(snapshot),
      closure_note: body.note ?? null,
      closed_by: ctx.userId,
      created_by: ctx.userId,
    })
    .execute();
  await record(tx, ctx.audit, {
    action: "transformation.close",
    recordType: "closure_record",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    ...(body.note !== undefined ? { reason: body.note } : {}),
    changes: {
      subject_kind: { from: null, to: "transformation" },
      basis: { from: null, to: basis },
    },
  });
  const updated = await tx
    .updateTable("transformation")
    .set({ status: "closed", version: sql<number>`version + 1`, updated_at: sql<Date>`now()`, updated_by: ctx.userId })
    .where("id", "=", transformationId)
    .where("version", "=", t.version)
    .returning("version")
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "transformation.closed",
    recordType: "transformation",
    recordId: transformationId,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: t.version,
    newVersion: updated.version,
    changes: { status: { from: t.status, to: "closed" } },
  });
  return id;
}

// ------------------------------------------------------------------------------------------------ routes

const initiativeParams = z.strictObject({ initiativeId: z.uuid() });
const listQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerClosureRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "transformation.read" as const } };

  app.post(
    INITIATIVE_CLOSE,
    { config: { access: { permission: INITIATIVE_CLOSE_PERMISSION }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { initiativeId } = parse(initiativeParams, request.params, "params");
      const body = await db
        .transaction()
        .execute(async (tx) => findClosure(tx, await closeInitiative(tx, request, initiativeId)));
      return reply.code(201).send(body);
    },
  );

  app.post(
    TRANSFORMATION_CLOSE,
    { config: { access: { permission: TRANSFORMATION_CLOSE_PERMISSION }, consumes: JSON_BODY } },
    async (request, reply) => {
      const transformationId = parseTransformationParam(request.params);
      const body = await db
        .transaction()
        .execute(async (tx) => findClosure(tx, await closeTransformation(tx, request, transformationId)));
      return reply.code(201).send(body);
    },
  );

  app.get(CLOSURE_RECORDS, { config: read }, async (request) => {
    const transformationId = parseTransformationParam(request.params);
    const query = parseQuery(listQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({ table: "closure_record", transformationId });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("closure_record").selectAll().where("transformation_id", "=", transformationId);
    if (after) q = q.where("id", ">", String(after[0]));
    const rows = (await q
      .orderBy("id")
      .limit(query.limit + 1)
      .execute()) as ClosureRow[];
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: page.items.map(toClosureRecord), nextCursor: page.nextCursor };
  });

  return [`POST ${INITIATIVE_CLOSE}`, `POST ${TRANSFORMATION_CLOSE}`, `GET ${CLOSURE_RECORDS}`];
}
