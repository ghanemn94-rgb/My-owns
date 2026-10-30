// The external-change confirmation of a deliverable (P6 slice B; ADR-0055 §6, §9, §10; REQ-S01-005 "Never imply an
// external operational change happened because a task was marked complete; require verified evidence or a confirmed
// integration result"; p6-work-split §B/A.8; T-DG6-BE-O). Route stub created by T-DG6-BE-A.
//
//   GET  /api/v1/deliverables/{deliverableId}/confirmation      getDeliverableConfirmation        (transformation.read;
//                                                               ETag "0" when never flagged)
//   PUT  /api/v1/deliverables/{deliverableId}/external-change   putDeliverableExternalChange      (external_change.flag:
//                                                               TL, BO, WL, TO; IfMatchOrZero: "0" creates the flag)
//   POST /api/v1/deliverables/{deliverableId}/confirmation      confirmDeliverableExternalChange  (external_change.confirm:
//                                                               BO, TD; If-Match)
//
// The state lives in its own table `deliverable_external_change` (0106), additive on DG3: the deliverable row, its
// acceptance and every task table are unchanged and never write it. A deliverable with no row is NOT flagged; a flag is
// created `unconfirmed`, and only two things ever confirm it (terminal; 0106 `deliverable_external_change_final`):
//   reviewed_evidence  confirmDeliverableExternalChange with an `active`, `verified` evidence item of the deliverable's
//                      transformation that the confirmer may read (the evidence module's one read decision, ADR-0051
//                      §4, wired at composition as `setExternalChangeEvidenceGate`); a `file_reference` (filename-only
//                      link) can never be verified (0012) and never confirms (422 external_change.evidence_not_verified,
//                      also enforced by the 0106 trigger);
//   connector_result   a `deliverable_status_push` outbound write of THIS deliverable that becomes `confirmed`
//                      (integrations/outbound.ts transaction 2, BE-N2). The integrations module imports no portfolio
//                      code: server.ts registers `recordConnectorConfirmation` as its connector-confirmation port. It
//                      copies the write's connector, the configuration's source system id, its reference, its
//                      confirmed time and the connector's service identity (0106 trigger
//                      `deliverable_external_change_connector_confirmed`), audited with actor type `service`.
// Completing a task or accepting the deliverable (DG3) never sets it: nothing here reads either.
//
// Every mutation (p6-work-split §2 rule 4): validation (zod; shared free-text rules), the deliverableConfirmation
// advisory lock (key `<deliverableId>`; ADR-0055 §8), authorization re-checked inside the transaction on reloaded
// grants after the lock (commit time), If-Match (428 missing, 409 stale; "0" creates the flag), one audit event
// with prior and new version in the same transaction (0010 `p2_audit_required` backstops it), the history written by the
// 0106 trigger, and no remote I/O. AUD holds no external_change code and gets 403 on both mutations.
//
// Confirming an external change records a fact with its provenance. It is NOT a business approval (G1-G6), and nothing
// here reads or writes the engineering delivery gates DG0-DG7.
import { sql, type DbOrTx, type DeliverableExternalChangeRow, type EvidenceRow, type Tx } from "@mth/db";
import { PROBLEM_TYPES, type Permission } from "@mth/shared";
import { freeText, uuid } from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { principalOf, requireTransformationRead, type Principal } from "../access/index.ts";
import { record as audit, type AuditContext } from "../audit/index.ts";
import {
  ADVISORY_LOCK_CLASSES,
  etag,
  HttpProblem,
  iso,
  isoOrNull,
  parse,
  parseBody,
  parseQuery,
  problems,
  requireIfMatch,
  type ModuleDeps,
} from "../platform/index.ts";
import { openWrite, type WriteContext } from "../transformations/index.ts";
import { JSON_BODY } from "./waves.ts";

export const EXTERNAL_CHANGE_FLAG: Permission = "external_change.flag";
export const EXTERNAL_CHANGE_CONFIRM: Permission = "external_change.confirm";

export const EXTERNAL_CHANGE_TYPES = [
  "customer_system",
  "network_upgrade",
  "procurement_transaction",
  "other",
] as const;
export type ExternalChangeType = (typeof EXTERNAL_CHANGE_TYPES)[number];

// ------------------------------------------------------------------------------------------------ refusals (ADR-0055 §9)

const conflict = (code: string, detail: string) =>
  new HttpProblem({ status: 409, type: PROBLEM_TYPES.invalidTransition, code, title: "Conflict", detail });

/** The ADR-0055 §9 refusals of this file, English verbatim (Arabic in the web catalogues, labelled provisional). */
export const externalChangeRefusals = {
  notFlagged: () => conflict("external_change.not_flagged", "This deliverable is not flagged as an external change."),
  alreadyConfirmed: () =>
    conflict(
      "external_change.already_confirmed",
      "This external change is already confirmed. A confirmation never changes.",
    ),
  withdrawConfirmed: () =>
    conflict("external_change.withdraw_confirmed", "A confirmed external change cannot be withdrawn."),
  evidenceNotVerified: () =>
    new HttpProblem({
      status: 422,
      type: PROBLEM_TYPES.validation,
      code: "external_change.evidence_not_verified",
      title: "Business rule violated",
      detail: "Only reviewed (verified) evidence confirms an external change. A filename-only link never does.",
      errors: [
        {
          pointer: "/evidenceId",
          code: "external_change.evidence_not_verified",
          message: "Only reviewed (verified) evidence confirms an external change. A filename-only link never does.",
        },
      ],
    }),
};

// ------------------------------------------------------------------------------------------------ request schemas

/** DeliverableExternalChangeUpdate (openapi). `other` needs a description (0106 CHECK `..._other_described`). */
export const deliverableExternalChangeUpdate = z
  .strictObject({
    isExternalChange: z.boolean(),
    changeType: z.enum(EXTERNAL_CHANGE_TYPES),
    description: freeText(1, 2000).nullable(),
  })
  .superRefine((v, c) => {
    if (v.changeType === "other" && v.description === null)
      c.addIssue({ code: "custom", path: ["description"], message: "validation.required" });
  });
export type DeliverableExternalChangeUpdate = z.infer<typeof deliverableExternalChangeUpdate>;

/** DeliverableConfirmationRequest (openapi). */
export const deliverableConfirmationRequest = z.strictObject({
  evidenceId: uuid,
  note: freeText(3, 2000).nullable(),
});

const dParams = z.strictObject({ deliverableId: uuid });
const noQuery = z.strictObject({});

// ------------------------------------------------------------------------------------------------ response view

export interface DeliverableConfirmationEvent {
  recordVersion: number;
  isExternalChange: boolean;
  changeType: ExternalChangeType;
  confirmationStatus: "unconfirmed" | "confirmed";
  confirmationSource: string | null;
  actorUserId: string | null;
  occurredAt: string;
}

export interface DeliverableExternalChangeView {
  id: string;
  isExternalChange: boolean;
  changeType: ExternalChangeType;
  description: string | null;
  confirmationStatus: "unconfirmed" | "confirmed";
  confirmationSource: "reviewed_evidence" | "connector_result" | null;
  evidenceId: string | null;
  outboundWriteId: string | null;
  connectorId: string | null;
  sourceSystemId: string | null;
  sourceReference: string | null;
  sourceConfirmedAt: string | null;
  serviceIdentityId: string | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
  confirmationNote: string | null;
  version: number;
  events: DeliverableConfirmationEvent[];
}

/** DeliverableConfirmation (openapi): `externalChange` is null when the deliverable was never flagged. */
export interface DeliverableConfirmation {
  deliverableId: string;
  transformationId: string;
  externalChange: DeliverableExternalChangeView | null;
}

async function toView(db: DbOrTx, row: DeliverableExternalChangeRow): Promise<DeliverableExternalChangeView> {
  const events = await db
    .selectFrom("deliverable_external_change_event")
    .selectAll()
    .where("deliverable_external_change_id", "=", row.id)
    .orderBy("record_version")
    .execute();
  return {
    id: row.id,
    isExternalChange: row.is_external_change,
    changeType: row.change_type as ExternalChangeType,
    description: row.description,
    confirmationStatus: row.confirmation_status as "unconfirmed" | "confirmed",
    confirmationSource: row.confirmation_source as DeliverableExternalChangeView["confirmationSource"],
    evidenceId: row.evidence_id,
    outboundWriteId: row.outbound_write_id,
    connectorId: row.connector_id,
    sourceSystemId: row.source_system_id,
    sourceReference: row.source_reference,
    sourceConfirmedAt: isoOrNull(row.source_confirmed_at),
    serviceIdentityId: row.service_identity_id,
    confirmedAt: isoOrNull(row.confirmed_at),
    confirmedBy: row.confirmed_by,
    confirmationNote: row.confirmation_note,
    version: row.version,
    events: events.map((e) => ({
      recordVersion: e.record_version,
      isExternalChange: e.is_external_change,
      changeType: e.change_type as ExternalChangeType,
      confirmationStatus: e.confirmation_status as "unconfirmed" | "confirmed",
      confirmationSource: e.confirmation_source,
      actorUserId: e.actor_user_id,
      occurredAt: iso(e.occurred_at),
    })),
  };
}

async function toConfirmation(
  db: DbOrTx,
  deliverable: DeliverableRef,
  row: DeliverableExternalChangeRow | undefined,
): Promise<DeliverableConfirmation> {
  return {
    deliverableId: deliverable.id,
    transformationId: deliverable.transformation_id,
    externalChange: row ? await toView(db, row) : null,
  };
}

// ------------------------------------------------------------------------------------------------ reads

interface DeliverableRef {
  readonly id: string;
  readonly organization_id: string;
  readonly transformation_id: string;
}

async function findDeliverable(db: DbOrTx, deliverableId: string): Promise<DeliverableRef> {
  const row = await db
    .selectFrom("deliverable")
    .select(["id", "organization_id", "transformation_id"])
    .where("id", "=", deliverableId)
    .executeTakeFirst();
  if (!row) throw problems.notFound();
  return row;
}

function findFlag(db: DbOrTx, deliverableId: string): Promise<DeliverableExternalChangeRow | undefined> {
  return db
    .selectFrom("deliverable_external_change")
    .selectAll()
    .where("deliverable_id", "=", deliverableId)
    .executeTakeFirst();
}

function lockedFlag(tx: Tx, deliverableId: string): Promise<DeliverableExternalChangeRow | undefined> {
  return tx
    .selectFrom("deliverable_external_change")
    .selectAll()
    .where("deliverable_id", "=", deliverableId)
    .forUpdate()
    .executeTakeFirst();
}

/** getDeliverableConfirmation: the scoped read of the deliverable (404 when absent or not readable). */
export async function getDeliverableConfirmation(
  db: DbOrTx,
  principal: Principal,
  deliverableId: string,
): Promise<{ body: DeliverableConfirmation; version: number }> {
  const deliverable = await findDeliverable(db, deliverableId);
  await requireTransformationRead(db, principal, deliverable.transformation_id);
  const row = await findFlag(db, deliverableId);
  return { body: await toConfirmation(db, deliverable, row), version: row?.version ?? 0 };
}

// ------------------------------------------------------------------------------------------------ the evidence gate

/** What the confirmation needs from the evidence module's read decision (ADR-0051 §4). */
export type ExternalChangeEvidenceGate = (
  db: DbOrTx,
  principal: Principal,
  transformationId: string,
  evidenceId: string,
) => Promise<{ row: Pick<EvidenceRow, "id" | "kind" | "review_status" | "status" | "transformation_id"> }>;

let evidenceGate: ExternalChangeEvidenceGate | null = null;

/**
 * Registers the evidence read gate (composition: evidence/access.ts `requireEvidenceRead`, so the confirmer may cite
 * only evidence it may read: 404 outside its scope or another transformation's item, 403 evidence.parent_forbidden for
 * a sensitive item or parent it is not admitted to). Returns the previous gate. Unwired, a confirmation fails closed.
 */
export function setExternalChangeEvidenceGate(
  gate: ExternalChangeEvidenceGate | null,
): ExternalChangeEvidenceGate | null {
  const previous = evidenceGate;
  evidenceGate = gate;
  return previous;
}

// ------------------------------------------------------------------------------------------------ writes

const lockDeliverable = (tx: Tx, deliverableId: string) =>
  sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.deliverableConfirmation}::int4, hashtext(${deliverableId}::text))`.execute(
    tx,
  );

/** If-Match of the flag's version; `"0"` names "never flagged" (the IfMatchOrZero rule). */
function ifMatchOrZero(request: FastifyRequest): number {
  return request.headers["if-match"] === '"0"' ? 0 : requireIfMatch(request);
}

function stale(current: number): HttpProblem {
  if (current >= 1) return problems.versionConflict(current);
  // Never flagged: the Problem schema's currentVersion starts at 1, so it is left out.
  return new HttpProblem({
    status: 409,
    type: PROBLEM_TYPES.versionConflict,
    code: "version_conflict",
    title: "Version conflict",
    detail: 'This deliverable was never flagged as an external change. Send If-Match "0" to flag it.',
  });
}

/**
 * The write prologue (the DG3 `lockForWrite` order): the deliverable (404), the read gate (404), the lock, then the
 * write rule on grants reloaded inside the transaction after the lock (commit time: a right lost meanwhile is 403).
 */
async function openFlagWrite(
  tx: Tx,
  request: FastifyRequest,
  deliverableId: string,
  permission: Permission,
): Promise<{ ctx: WriteContext; deliverable: DeliverableRef }> {
  const deliverable = await findDeliverable(tx, deliverableId);
  // The read gate on the request's principal first: a caller who cannot see the deliverable gets 404 (never 403).
  await requireTransformationRead(tx, principalOf(request), deliverable.transformation_id);
  await lockDeliverable(tx, deliverableId);
  const ctx = await openWrite(tx, request, deliverable.transformation_id, [{ permission }], null, { atCommit: true });
  return { ctx, deliverable };
}

/**
 * putDeliverableExternalChange: flag (If-Match "0" creates it, `.flagged`), change the type or description (`.changed`),
 * withdraw (`isExternalChange: false`, `.withdrawn`) or re-flag a withdrawn flag (`.flagged`) while unconfirmed. A
 * request that changes nothing writes nothing and returns the flag as it is.
 */
export async function putExternalChange(
  tx: Tx,
  request: FastifyRequest,
  deliverableId: string,
  body: DeliverableExternalChangeUpdate,
): Promise<{ body: DeliverableConfirmation; version: number }> {
  const { ctx, deliverable } = await openFlagWrite(tx, request, deliverableId, EXTERNAL_CHANGE_FLAG);
  const expected = ifMatchOrZero(request);
  const current = await lockedFlag(tx, deliverableId);

  if (!current) {
    if (expected !== 0) throw stale(0);
    if (!body.isExternalChange) throw externalChangeRefusals.notFlagged();
    const row = await tx
      .insertInto("deliverable_external_change")
      .values({
        id: uuidv7(),
        organization_id: deliverable.organization_id,
        transformation_id: deliverable.transformation_id,
        deliverable_id: deliverableId,
        is_external_change: true,
        change_type: body.changeType,
        description: body.description,
        created_by: ctx.userId,
        updated_by: ctx.userId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await audit(tx, ctx.audit, {
      action: "deliverable_external_change.flagged",
      recordType: "deliverable_external_change",
      recordId: row.id,
      organizationId: row.organization_id,
      transformationId: row.transformation_id,
      priorVersion: null,
      newVersion: row.version,
      changes: {
        deliverable_id: { from: null, to: deliverableId },
        is_external_change: { from: null, to: true },
        change_type: { from: null, to: body.changeType },
        description: { from: null, to: body.description },
        confirmation_status: { from: null, to: "unconfirmed" },
      },
    });
    return { body: await toConfirmation(tx, deliverable, row), version: row.version };
  }

  if (current.confirmation_status === "confirmed")
    throw body.isExternalChange
      ? externalChangeRefusals.alreadyConfirmed()
      : externalChangeRefusals.withdrawConfirmed();
  if (current.version !== expected) throw stale(current.version);

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (current.is_external_change !== body.isExternalChange)
    changes["is_external_change"] = { from: current.is_external_change, to: body.isExternalChange };
  if (current.change_type !== body.changeType)
    changes["change_type"] = { from: current.change_type, to: body.changeType };
  if (current.description !== body.description)
    changes["description"] = { from: current.description, to: body.description };
  if (Object.keys(changes).length === 0)
    return { body: await toConfirmation(tx, deliverable, current), version: current.version };

  const action =
    changes["is_external_change"] === undefined ? "changed" : body.isExternalChange ? "flagged" : "withdrawn";
  const row = await tx
    .updateTable("deliverable_external_change")
    .set({
      is_external_change: body.isExternalChange,
      change_type: body.changeType,
      description: body.description,
      version: current.version + 1,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await audit(tx, ctx.audit, {
    action: `deliverable_external_change.${action}`,
    recordType: "deliverable_external_change",
    recordId: row.id,
    organizationId: row.organization_id,
    transformationId: row.transformation_id,
    priorVersion: current.version,
    newVersion: row.version,
    changes,
  });
  return { body: await toConfirmation(tx, deliverable, row), version: row.version };
}

/**
 * confirmDeliverableExternalChange: `unconfirmed` -> `confirmed` by reviewed evidence. Refusals in order: 409
 * not_flagged (no flag, or withdrawn), 409 already_confirmed, 409 stale If-Match, then the evidence: 404/403 from the
 * evidence read gate, 422 evidence_not_verified unless the item is active, verified and not a file_reference.
 */
export async function confirmExternalChange(
  tx: Tx,
  request: FastifyRequest,
  deliverableId: string,
  body: z.infer<typeof deliverableConfirmationRequest>,
): Promise<{ body: DeliverableConfirmation; version: number }> {
  const { ctx, deliverable } = await openFlagWrite(tx, request, deliverableId, EXTERNAL_CHANGE_CONFIRM);
  const expected = requireIfMatch(request);
  const current = await lockedFlag(tx, deliverableId);
  if (!current || !current.is_external_change) throw externalChangeRefusals.notFlagged();
  if (current.confirmation_status === "confirmed") throw externalChangeRefusals.alreadyConfirmed();
  if (current.version !== expected) throw stale(current.version);

  if (evidenceGate === null) throw new Error("deliverable-confirmation: the evidence read gate is not wired");
  const { row: evidence } = await evidenceGate(tx, ctx.principal, deliverable.transformation_id, body.evidenceId);
  if (evidence.status !== "active" || evidence.review_status !== "verified" || evidence.kind === "file_reference")
    throw externalChangeRefusals.evidenceNotVerified();

  const row = await tx
    .updateTable("deliverable_external_change")
    .set({
      confirmation_status: "confirmed",
      confirmation_source: "reviewed_evidence",
      evidence_id: evidence.id,
      confirmed_at: sql<Date>`now()`,
      confirmed_by: ctx.userId,
      confirmation_note: body.note,
      version: current.version + 1,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await audit(tx, ctx.audit, {
    action: "deliverable_external_change.confirmed",
    recordType: "deliverable_external_change",
    recordId: row.id,
    organizationId: row.organization_id,
    transformationId: row.transformation_id,
    priorVersion: current.version,
    newVersion: row.version,
    changes: {
      confirmation_status: { from: "unconfirmed", to: "confirmed" },
      confirmation_source: { from: null, to: "reviewed_evidence" },
      evidence_id: { from: null, to: evidence.id },
      confirmation_note: { from: null, to: body.note },
    },
  });
  return { body: await toConfirmation(tx, deliverable, row), version: row.version };
}

// ------------------------------------------------------------------------------------------------ connector result

/**
 * What integrations/outbound.ts hands its connector-confirmation port when a write becomes `confirmed` (structurally
 * its `OutboundConfirmedWrite`; portfolio imports no integrations code).
 */
export interface ConfirmedOutboundWrite {
  readonly write: {
    readonly id: string;
    readonly action_code: string;
    readonly deliverable_id: string | null;
    readonly transformation_id: string;
    readonly external_reference: string | null;
    readonly confirmed_at: Date | null;
    readonly service_identity_id: string;
  };
  readonly connector: { readonly id: string; readonly organization_id: string };
  readonly sourceSystemId: string;
}

/** The outbound action whose confirmed result confirms a flagged deliverable (D-195 Q14). */
export const DELIVERABLE_STATUS_PUSH = "deliverable_status_push";

/**
 * The connector-confirmation port (ADR-0055 §6; registered by server.ts with `setOutboundConfirmationPort`). Runs inside
 * the outbound write's transaction 2 (BE-N2), so the write and this confirmation commit together; a throw rolls both
 * back. A `deliverable_status_push` for a deliverable flagged and unconfirmed becomes its `connector_result`
 * confirmation; any other write (another action, no flag, a withdrawn flag, an already confirmed change) changes
 * nothing here. The actor is the connector's service identity (audit actor type `service`, on behalf of the user whose
 * request led to the confirmation). Returns the confirmed row, or null when nothing changed.
 */
export async function recordConnectorConfirmation(
  tx: Tx,
  ctx: AuditContext,
  confirmed: ConfirmedOutboundWrite,
): Promise<DeliverableExternalChangeRow | null> {
  const { write, connector, sourceSystemId } = confirmed;
  if (write.action_code !== DELIVERABLE_STATUS_PUSH || write.deliverable_id === null) return null;
  if (write.external_reference === null || write.confirmed_at === null) return null;
  await lockDeliverable(tx, write.deliverable_id);
  const current = await lockedFlag(tx, write.deliverable_id);
  if (!current || !current.is_external_change || current.confirmation_status !== "unconfirmed") return null;
  if (current.transformation_id !== write.transformation_id) return null;
  const row = await tx
    .updateTable("deliverable_external_change")
    .set({
      confirmation_status: "confirmed",
      confirmation_source: "connector_result",
      outbound_write_id: write.id,
      connector_id: connector.id,
      source_system_id: sourceSystemId,
      source_reference: write.external_reference,
      // Copied in SQL: the stored timestamp has microseconds, a JS Date only milliseconds (the 0106 trigger compares).
      source_confirmed_at: sql<Date>`(SELECT ow.confirmed_at FROM outbound_write ow WHERE ow.id = ${write.id})`,
      service_identity_id: write.service_identity_id,
      confirmed_at: sql<Date>`now()`,
      version: current.version + 1,
      updated_at: sql<Date>`now()`,
      ...(ctx.actorUserId !== null ? { updated_by: ctx.actorUserId } : {}),
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await audit(
    tx,
    { actorUserId: null, actorType: "service", onBehalfOfUserId: ctx.actorUserId, requestId: ctx.requestId },
    {
      action: "deliverable_external_change.confirmed",
      recordType: "deliverable_external_change",
      recordId: row.id,
      organizationId: row.organization_id,
      transformationId: row.transformation_id,
      priorVersion: current.version,
      newVersion: row.version,
      changes: {
        confirmation_status: { from: "unconfirmed", to: "confirmed" },
        confirmation_source: { from: null, to: "connector_result" },
        outbound_write_id: { from: null, to: write.id },
        connector_id: { from: null, to: connector.id },
        source_system_id: { from: null, to: sourceSystemId },
        source_reference: { from: null, to: write.external_reference },
        service_identity_id: { from: null, to: write.service_identity_id },
      },
    },
  );
  return row;
}

// ------------------------------------------------------------------------------------------------ routes

const CONFIRMATION = "/api/v1/deliverables/:deliverableId/confirmation";
const EXTERNAL_CHANGE = "/api/v1/deliverables/:deliverableId/external-change";

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerDeliverableConfirmationRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  // ---- BE-O: the external_change block (ADR-0055 §6). The DG3 deliverable routes (deliverables.ts) are unchanged.

  // getDeliverableConfirmation: ETag "0" while never flagged.
  app.get(CONFIRMATION, { config: { access: { permission: "transformation.read" } } }, async (request, reply) => {
    const { deliverableId } = parse(dParams, request.params, "params");
    parseQuery(noQuery, request.query);
    const { body, version } = await getDeliverableConfirmation(db, principalOf(request), deliverableId);
    reply.header("ETag", etag(version));
    return body;
  });

  // putDeliverableExternalChange: IfMatchOrZero.
  app.put(
    EXTERNAL_CHANGE,
    { config: { access: { permission: EXTERNAL_CHANGE_FLAG }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { deliverableId } = parse(dParams, request.params, "params");
      parseQuery(noQuery, request.query);
      const body = parseBody(deliverableExternalChangeUpdate, request.body);
      const result = await db.transaction().execute((tx) => putExternalChange(tx, request, deliverableId, body));
      reply.header("ETag", etag(result.version));
      return result.body;
    },
  );

  // confirmDeliverableExternalChange: If-Match.
  app.post(
    CONFIRMATION,
    { config: { access: { permission: EXTERNAL_CHANGE_CONFIRM }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { deliverableId } = parse(dParams, request.params, "params");
      parseQuery(noQuery, request.query);
      const body = parseBody(deliverableConfirmationRequest, request.body);
      const result = await db.transaction().execute((tx) => confirmExternalChange(tx, request, deliverableId, body));
      reply.header("ETag", etag(result.version));
      return result.body;
    },
  );

  return [`GET ${CONFIRMATION}`, `PUT ${EXTERNAL_CHANGE}`, `POST ${CONFIRMATION}`];
}
