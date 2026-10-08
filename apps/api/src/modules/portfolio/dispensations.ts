// Gate dispensations (ADR-0021 §4-§6; REQ-PB-004, REQ-PB-005, REQ-S03-004/005; T-DG3-BE-A):
//   GET  /transformations/{id}/gate-dispensations                              list, newest first (transformation.read)
//   POST /transformations/{id}/gate-dispensations                              record (gate.submit); status pending
//   POST /transformations/{id}/gate-dispensations/{dispensationId}/decision    accept / reject (gate.decide; If-Match)
//   POST /transformations/{id}/gate-dispensations/{dispensationId}/revoke      revoke an accepted one (gate.decide)
//
// Two kinds, both BUSINESS records inside the product and never a gate decision:
//  - inherited_approval (Modular): an approval granted before the product was used, CAPTURED AS EVIDENCE, never
//    fabricated: approving body, date and an evidence item are required. It counts for sequencing only while accepted
//    by a person holding gate.decide who is not the recorder AND its evidence is verified (ADR-0018) now.
//  - waiver (End-to-End, G2/G3 launch sequencing): reason, scope (the whole transformation or one initiative), expiry,
//    and the approver (the waived gate's configured approver, not the requester). It counts while accepted and not
//    expired (the transformation's time zone, Asia/Riyadh by default) and can be revoked.
// Nothing here writes gate_decision or gate_instance: the gate history never contains an approval the product did not
// record (ADR-0021 §5). Product gates G1-G6 are unrelated to the engineering gates DG0-DG7.
import type { DbOrTx, GateDispensationRow, Tx } from "@mth/db";
import { acceptanceDecision, gateDispensationCreate, reasonRequest, type GateDispensation } from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { requireTransformationRead, principalOf } from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
  HttpProblem,
  iso,
  isoOrNull,
  limitSchema,
  paginate,
  parse,
  parseBody,
  parseQuery,
  problems,
  requireIfMatch,
  sendVersioned,
  type ModuleDeps,
} from "../platform/index.ts";
import { assertSameTransformation, bumpStamps, openWrite, type WriteContext } from "../transformations/index.ts";
import { isGateApprover, type InheritedApprovalFact } from "../workflows/index.ts";
import {
  hasInheritedApproval,
  type DispensationFact,
  type SequencingFacts,
  type SequencingGate,
} from "./sequencing.ts";

const BASE = "/api/v1/transformations/:transformationId/gate-dispensations";
const tParams = z.strictObject({ transformationId: z.uuid() });
const dParams = z.strictObject({ transformationId: z.uuid(), dispensationId: z.uuid() });
const JSON_BODY = ["application/json"] as const;

// ------------------------------------------------------------------------------------------------ facts

type DispensationRow = GateDispensationRow;

/** YYYY-MM-DD of `now` in the time zone (the transformation's; Asia/Riyadh by default). */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** A `date` column as YYYY-MM-DD (@mth/db returns dates as text). */
function dateText(d: string | null): string | null {
  return d === null ? null : String(d).slice(0, 10);
}

/** Whether each evidence item is verified now (the ADR-0018 rule, as evidence/repository.ts applies it). */
async function verifiedEvidence(db: DbOrTx, transformationId: string, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .selectFrom("evidence")
    .select([
      "id",
      "kind",
      "status",
      "review_status",
      "accessibility_status",
      "current_content_id",
      "reviewed_content_id",
    ])
    .where("transformation_id", "=", transformationId)
    .where("id", "in", [...ids])
    .execute();
  return new Set(
    rows
      .filter(
        (r) =>
          r.status === "active" &&
          r.review_status === "verified" &&
          r.accessibility_status === "accessible" &&
          r.kind !== "file_reference" &&
          (r.kind !== "file" || (r.current_content_id !== null && r.current_content_id === r.reviewed_content_id)),
      )
      .map((r) => r.id),
  );
}

/** Does the dispensation satisfy its sequencing rule now (accepted, not expired, inherited: evidence verified)? */
function countsNow(row: DispensationRow, today: string, verified: Set<string>): boolean {
  if (row.status !== "accepted") return false;
  const expires = dateText(row.expires_on);
  if (expires !== null && expires < today) return false;
  return row.kind === "waiver" || (row.evidence_id !== null && verified.has(row.evidence_id));
}

function present(row: DispensationRow, today: string, verified: Set<string>): GateDispensation {
  return {
    id: row.id,
    organizationId: row.organization_id,
    transformationId: row.transformation_id,
    kind: row.kind as GateDispensation["kind"],
    gateCode: row.gate_code as GateDispensation["gateCode"],
    initiativeId: row.initiative_id,
    reason: row.reason,
    approvingBody: row.approving_body,
    approvedOn: dateText(row.approved_on),
    evidenceId: row.evidence_id,
    evidenceVerified:
      row.kind === "inherited_approval" ? row.evidence_id !== null && verified.has(row.evidence_id) : null,
    expiresOn: dateText(row.expires_on),
    status: row.status as GateDispensation["status"],
    counts: countsNow(row, today, verified),
    recordedBy: row.recorded_by,
    decidedBy: row.decided_by,
    decidedAt: isoOrNull(row.decided_at),
    decisionNote: row.decision_note,
    revokedBy: row.revoked_by,
    revokedAt: isoOrNull(row.revoked_at),
    revokeReason: row.revoke_reason,
    version: row.version,
    createdAt: iso(row.created_at),
    createdBy: row.created_by,
    updatedAt: iso(row.updated_at),
    updatedBy: row.updated_by,
  };
}

async function timeZoneOf(db: DbOrTx, transformationId: string): Promise<string> {
  const t = await db
    .selectFrom("transformation")
    .select("timezone")
    .where("id", "=", transformationId)
    .executeTakeFirst();
  return t?.timezone ?? "Asia/Riyadh";
}

/** Every dispensation of a transformation as API representations (newest first), with `counts` evaluated now. */
export async function loadDispensations(db: DbOrTx, transformationId: string): Promise<GateDispensation[]> {
  const rows = await db
    .selectFrom("gate_dispensation")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .execute();
  return presentAll(db, transformationId, rows);
}

async function presentAll(db: DbOrTx, transformationId: string, rows: DispensationRow[]): Promise<GateDispensation[]> {
  const today = todayIn(await timeZoneOf(db, transformationId));
  const verified = await verifiedEvidence(
    db,
    transformationId,
    rows.map((r) => r.evidence_id).filter((x): x is string => x !== null),
  );
  return rows.map((r) => present(r, today, verified));
}

/**
 * The facts the sequencing rules read (sequencing.ts): mode, the G1-G3 gate statuses and every dispensation with
 * `counts` evaluated now. Exported for the initiative transitions (BE-B) and the readiness view.
 */
export async function loadSequencingFacts(db: DbOrTx, transformationId: string): Promise<SequencingFacts> {
  const t = await db.selectFrom("transformation").select("mode").where("id", "=", transformationId).executeTakeFirst();
  if (!t) throw problems.notFound();
  const gates = await db
    .selectFrom("gate_instance")
    .select(["gate_code", "status"])
    .where("transformation_id", "=", transformationId)
    .where("gate_code", "in", ["G1", "G2", "G3"])
    .execute();
  const dispensations: DispensationFact[] = (await loadDispensations(db, transformationId)).map((d) => ({
    kind: d.kind,
    gateCode: d.gateCode as SequencingGate,
    initiativeId: d.initiativeId,
    counts: d.counts,
  }));
  return {
    mode: t.mode === "modular" ? "modular" : "end_to_end",
    gates: Object.fromEntries(gates.map((g) => [g.gate_code, g.status])),
    dispensations,
  };
}

// ------------------------------------------------------------------------------------------------ rules

const rule = (code: string, detail: string, pointer: string) =>
  new HttpProblem({
    status: 422,
    type: "urn:mth:problem:validation",
    code,
    title: "Business rule violated",
    detail,
    errors: [{ pointer, code, message: detail }],
  });
const transition = (code: string, detail: string) =>
  new HttpProblem({
    status: 422,
    type: "urn:mth:problem:invalid-transition",
    code,
    title: "Invalid transition",
    detail,
  });
const forbidden = (code: string, detail: string) =>
  new HttpProblem({ status: 403, type: "urn:mth:problem:forbidden", code, title: "Forbidden", detail });

async function lockRow(tx: Tx, transformationId: string, id: string): Promise<DispensationRow> {
  const row = await tx
    .selectFrom("gate_dispensation")
    .selectAll()
    .where("id", "=", id)
    .where("transformation_id", "=", transformationId)
    .forUpdate()
    .executeTakeFirst();
  if (!row) throw problems.notFound();
  return row;
}

async function presentOne(db: DbOrTx, row: DispensationRow): Promise<GateDispensation> {
  return (await presentAll(db, row.transformation_id, [row]))[0]!;
}

// ------------------------------------------------------------------------------------------------ create

async function createDispensation(tx: Tx, request: FastifyRequest, transformationId: string) {
  const ctx = await openWrite(tx, request, transformationId, [{ permission: "gate.submit" }], null, { atCommit: true });
  const body = parseBody(gateDispensationCreate, request.body);
  const t = await tx
    .selectFrom("transformation")
    .select(["mode", "timezone"])
    .where("id", "=", transformationId)
    .executeTakeFirstOrThrow();
  const today = todayIn(t.timezone);
  if (body.kind === "inherited_approval") {
    // Modular entry only (ADR-0021 §5): approvals granted before the product was used, captured as evidence.
    if (t.mode !== "modular")
      throw rule(
        "dispensation.inherited_requires_modular",
        "An inherited approval can be recorded only for a Modular transformation.",
        "/kind",
      );
    const given = { approvingBody: body.approvingBody, approvedOn: body.approvedOn, evidenceId: body.evidenceId };
    const missing = Object.entries(given)
      .filter(([, v]) => v === undefined)
      .map(([k]) => k);
    if (missing.length > 0)
      throw new HttpProblem({
        status: 422,
        type: "urn:mth:problem:validation",
        code: "dispensation.inherited_incomplete",
        title: "Business rule violated",
        detail: "An inherited approval needs the approving body, the approval date and an evidence item.",
        errors: missing.map((k) => ({
          pointer: `/${k}`,
          code: "dispensation.inherited_incomplete",
          message: `${k} is required for an inherited approval.`,
        })),
      });
    if (body.initiativeId !== undefined)
      throw rule(
        "dispensation.inherited_scope",
        "An inherited approval covers the whole transformation, not one initiative.",
        "/initiativeId",
      );
    if (body.approvedOn! > today)
      throw rule("dispensation.approved_on_future", "The approval date cannot be in the future.", "/approvedOn");
    await assertSameTransformation(tx, "evidence", transformationId, body.evidenceId, "/evidenceId");
  } else {
    if (t.mode !== "end_to_end")
      throw rule(
        "dispensation.waiver_requires_end_to_end",
        "A waiver applies to the End-to-End launch sequencing; a Modular transformation is not held to it.",
        "/kind",
      );
    if (body.gateCode === "G1")
      throw rule(
        "dispensation.waiver_gate",
        "A waiver applies only to the launch sequencing of G2 or G3; G1 is never waived.",
        "/gateCode",
      );
    const given = { reason: body.reason, expiresOn: body.expiresOn };
    const missing = Object.entries(given)
      .filter(([, v]) => v === undefined)
      .map(([k]) => k);
    if (missing.length > 0)
      throw new HttpProblem({
        status: 422,
        type: "urn:mth:problem:validation",
        code: "dispensation.waiver_incomplete",
        title: "Business rule violated",
        detail: "A waiver needs a reason and an expiry date.",
        errors: missing.map((k) => ({
          pointer: `/${k}`,
          code: "dispensation.waiver_incomplete",
          message: `${k} is required for a waiver.`,
        })),
      });
    const extra = Object.entries({
      approvingBody: body.approvingBody,
      approvedOn: body.approvedOn,
      evidenceId: body.evidenceId,
    }).find(([, v]) => v !== undefined)?.[0];
    if (extra !== undefined)
      throw rule(
        "dispensation.waiver_shape",
        "A waiver carries no approving body, approval date or evidence.",
        `/${extra}`,
      );
    await assertSameTransformation(tx, "initiative", transformationId, body.initiativeId, "/initiativeId");
  }
  if (body.expiresOn !== undefined && body.expiresOn < today)
    throw rule("dispensation.expired", "The expiry date cannot be in the past.", "/expiresOn");
  const gate = await tx
    .selectFrom("gate_instance")
    .select("status")
    .where("transformation_id", "=", transformationId)
    .where("gate_code", "=", body.gateCode)
    .executeTakeFirst();
  if (gate?.status === "approved")
    throw rule("dispensation.gate_approved", `${body.gateCode} is already approved; nothing to dispense.`, "/gateCode");

  const id = uuidv7();
  const row = await tx
    .insertInto("gate_dispensation")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      kind: body.kind,
      gate_code: body.gateCode,
      initiative_id: body.initiativeId ?? null,
      reason: body.reason ?? null,
      approving_body: body.approvingBody ?? null,
      approved_on: body.approvedOn ?? null,
      evidence_id: body.evidenceId ?? null,
      expires_on: body.expiresOn ?? null,
      recorded_by: ctx.userId,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "gate_dispensation.create",
    recordType: "gate_dispensation",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    newVersion: 1,
    ...(body.reason !== undefined ? { reason: body.reason } : {}),
    changes: {
      kind: { from: null, to: body.kind },
      gateCode: { from: null, to: body.gateCode },
      initiativeId: { from: null, to: body.initiativeId ?? null },
      approvingBody: { from: null, to: body.approvingBody ?? null },
      approvedOn: { from: null, to: body.approvedOn ?? null },
      evidenceId: { from: null, to: body.evidenceId ?? null },
      expiresOn: { from: null, to: body.expiresOn ?? null },
      status: { from: null, to: "pending" },
    },
  });
  return row;
}

// ------------------------------------------------------------------------------------------------ decide

async function decideDispensation(tx: Tx, request: FastifyRequest, transformationId: string, id: string) {
  const ctx: WriteContext = await openWrite(tx, request, transformationId, [{ permission: "gate.decide" }], null, {
    atCommit: true,
  });
  const current = await lockRow(tx, transformationId, id);
  const body = parseBody(acceptanceDecision, request.body);
  const expected = requireIfMatch(request);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  // Delegated decisions are not offered for dispensations: the named decider decides in person (no approval loops).
  if (body.onBehalfOfUserId !== undefined)
    throw rule(
      "dispensation.on_behalf_not_supported",
      "A dispensation is decided by the approver in person; deciding on someone's behalf is not available.",
      "/onBehalfOfUserId",
    );
  // Separation of duties (DB CHECK gate_dispensation_decider_not_recorder as well).
  if (current.recorded_by === ctx.userId)
    throw forbidden(
      "dispensation.decider_is_recorder",
      "A dispensation is accepted or rejected by someone other than the person who recorded it (separation of duties).",
    );
  // A waiver is granted by the waived gate's configured approver (ADR-0021 §5); an inherited approval by any holder
  // of gate.decide on the transformation (checked by openWrite).
  if (
    current.kind === "waiver" &&
    !(await isGateApprover(tx, ctx.principal, transformationId, current.gate_code, ctx.target))
  )
    throw forbidden("gate.not_approver", "Only the configured approver of this gate can decide a waiver of it.");
  if (current.status !== "pending")
    throw transition("dispensation.not_pending", "Only a pending dispensation can be accepted or rejected.");
  if (body.result === "accepted") {
    const today = todayIn(await timeZoneOf(tx, transformationId));
    const expires = dateText(current.expires_on);
    if (expires !== null && expires < today)
      throw transition("dispensation.expired", "The dispensation expired before it was accepted.");
    if (current.kind === "inherited_approval") {
      const verified = await verifiedEvidence(tx, transformationId, current.evidence_id ? [current.evidence_id] : []);
      if (current.evidence_id === null || !verified.has(current.evidence_id))
        throw rule(
          "dispensation.evidence_not_verified",
          "The inherited approval's evidence must be verified before it can be accepted (a filename never counts).",
          "/result",
        );
    }
  }
  const updated = await tx
    .updateTable("gate_dispensation")
    .set({
      status: body.result,
      decided_by: ctx.userId,
      decided_at: new Date(),
      decision_note: body.note ?? null,
      ...bumpStamps(ctx.userId),
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "gate_dispensation.decide",
    recordType: "gate_dispensation",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    ...(body.note !== undefined ? { reason: body.note } : {}),
    changes: {
      status: { from: current.status, to: body.result },
      decidedBy: { from: null, to: ctx.userId },
    },
  });
  return updated;
}

// ------------------------------------------------------------------------------------------------ revoke

async function revokeDispensation(tx: Tx, request: FastifyRequest, transformationId: string, id: string) {
  const ctx = await openWrite(tx, request, transformationId, [{ permission: "gate.decide" }], null, { atCommit: true });
  const current = await lockRow(tx, transformationId, id);
  const body = parseBody(reasonRequest, request.body);
  const expected = requireIfMatch(request);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (
    current.kind === "waiver" &&
    !(await isGateApprover(tx, ctx.principal, transformationId, current.gate_code, ctx.target))
  )
    throw forbidden("gate.not_approver", "Only the configured approver of this gate can revoke a waiver of it.");
  if (current.status !== "accepted")
    throw transition("dispensation.not_revocable", "Only an accepted dispensation can be revoked.");
  const updated = await tx
    .updateTable("gate_dispensation")
    .set({
      status: "revoked",
      revoked_by: ctx.userId,
      revoked_at: new Date(),
      revoke_reason: body.reason,
      ...bumpStamps(ctx.userId),
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "gate_dispensation.revoke",
    recordType: "gate_dispensation",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    reason: body.reason,
    changes: { status: { from: "accepted", to: "revoked" } },
  });
  return updated;
}

/**
 * The inherited-approval dispensations of a transformation for the gate annotation (ADR-0021 §5; F-DG3-120): the
 * `inheritedApprovals` member of workflows' GateFactsProvider, wired by server.ts. `counts` is decided by the sequencing
 * rule itself (hasInheritedApproval: Modular, accepted, evidence verified now), never re-implemented here.
 */
export async function loadInheritedApprovalFacts(
  db: DbOrTx,
  transformationId: string,
): Promise<InheritedApprovalFact[]> {
  const t = await db.selectFrom("transformation").select("mode").where("id", "=", transformationId).executeTakeFirst();
  if (!t) return [];
  const mode = t.mode === "modular" ? "modular" : "end_to_end";
  // The DB CHECK gate_dispensation_inherited_shape guarantees body and date on every inherited approval.
  return (await loadDispensations(db, transformationId)).flatMap((d) => {
    if (d.kind !== "inherited_approval" || d.approvingBody === null || d.approvedOn === null) return [];
    const gate = d.gateCode as SequencingGate;
    const fact: DispensationFact = { kind: d.kind, gateCode: gate, initiativeId: d.initiativeId, counts: d.counts };
    return [
      {
        dispensationId: d.id,
        gateCode: d.gateCode,
        status: d.status,
        counts: hasInheritedApproval({ mode, gates: {}, dispensations: [fact] }, gate),
        approvingBody: d.approvingBody,
        approvedOn: d.approvedOn,
        createdAt: d.createdAt,
      },
    ];
  });
}

// ------------------------------------------------------------------------------------------------ routes

export function registerDispensationRoutes(app: FastifyInstance, { db }: ModuleDeps): readonly string[] {
  app.get(BASE, { config: { access: { permission: "transformation.read" } } }, async (request) => {
    const { transformationId } = parse(tParams, request.params, "params");
    const query = parseQuery(z.strictObject({ cursor: cursorSchema, limit: limitSchema }), request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({ transformationId });
    const after = decodeCursor(query.cursor, hash, 2);
    let q = db.selectFrom("gate_dispensation").selectAll().where("transformation_id", "=", transformationId);
    if (after)
      q = q.where((eb) =>
        eb.or([
          eb("created_at", "<", new Date(String(after[0]))),
          eb.and([eb("created_at", "=", new Date(String(after[0]))), eb("id", "<", String(after[1]))]),
        ]),
      );
    const rows = await q
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.created_at.toISOString(), r.id], hash);
    return { items: await presentAll(db, transformationId, page.items), nextCursor: page.nextCursor };
  });

  app.post(BASE, { config: { access: { permission: "gate.submit" }, consumes: JSON_BODY } }, async (request, reply) => {
    const { transformationId } = parse(tParams, request.params, "params");
    const row = await db.transaction().execute((tx) => createDispensation(tx, request, transformationId));
    return sendVersioned(
      reply,
      201,
      await presentOne(db, row),
      `/api/v1/transformations/${transformationId}/gate-dispensations/${row.id}`,
    );
  });

  app.post(
    `${BASE}/:dispensationId/decision`,
    { config: { access: { permission: "gate.decide" }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { transformationId, dispensationId } = parse(dParams, request.params, "params");
      const row = await db
        .transaction()
        .execute((tx) => decideDispensation(tx, request, transformationId, dispensationId));
      return sendVersioned(reply, 200, await presentOne(db, row));
    },
  );

  app.post(
    `${BASE}/:dispensationId/revoke`,
    { config: { access: { permission: "gate.decide" }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { transformationId, dispensationId } = parse(dParams, request.params, "params");
      const row = await db
        .transaction()
        .execute((tx) => revokeDispensation(tx, request, transformationId, dispensationId));
      return sendVersioned(reply, 200, await presentOne(db, row));
    },
  );

  return [
    `GET ${BASE}`,
    `POST ${BASE}`,
    `POST ${BASE}/:dispensationId/decision`,
    `POST ${BASE}/:dispensationId/revoke`,
  ];
}
