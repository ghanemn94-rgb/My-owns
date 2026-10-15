// Structured owner updates (OpenAPI tag "owner-updates"; ADR-0045 §6, §9, §11; REQ-S09-011, M0185; p5-work-split §F.3;
// T-DG5-KBE-D):
//   GET  /transformations/{t}/updates                          listOwnerUpdates          (transformation.read)
//   POST /transformations/{t}/updates                          createOwnerUpdate         (owner_update.submit + owner)
//   GET  /transformations/{t}/updates/{u}                      getOwnerUpdate            (transformation.read)
//   PATCH /transformations/{t}/updates/{u}                     updateOwnerUpdate         (owner_update.submit + owner)
//   POST /transformations/{t}/updates/{u}/submit               submitOwnerUpdate         (owner_update.submit + owner)
//   POST /transformations/{t}/updates/{u}/reopen               reopenOwnerUpdate         (owner_update.submit + owner)
//   GET  /transformations/{t}/updates/{u}/revisions            listOwnerUpdateRevisions  (transformation.read)
//
// - One update per subject (the transformation, or one of its workstreams) and reporting period, with the eight M0185
//   fields. `draft -> submitted` (the next revision, its eight fields copied into owner_update_revision in the same
//   transaction; at least one field written) and `submitted -> draft` (reopen, reason required). Every write needs the
//   period `open` (the 0080 guard is the backstop, mapped in platform/db-errors.ts).
// - Who writes (ADR-0045 §6): `owner_update.submit` (TL, WL) in the transformation AND the subject's owner: for a
//   workstream its `lead_user_id`; for the transformation a holder of the TL role whose grant applies to it. Anyone
//   else who holds the permission gets 403 owner_update.not_owner; a reader without it (AUD) gets 403 forbidden.
// - Every write re-authorizes at commit on grants reloaded inside its transaction, validates (the shared free-text
//   rule), requires If-Match on changes (428 missing, 409 stale; the create is version 1), writes one audit event per
//   mutated owner_update row in the same transaction (`owner_update.create|update|submit|reopen`; the revision row is
//   covered by the submit event, ADR-0045 §9) and does no remote I/O inside it.
// - Submitting completes the subject owners' open `owner_update_due` tasks of that period (created by the worker's
//   `reports.owner_update_tasks`, dedupe key `owner_update_due:<periodId>:<subjectType>:<subjectId>:<userId>`), each
//   with its work_item.complete audit event.
// - Submitting an update approves nothing: product gates G1-G6 are business approvals inside the product, and nothing
//   here touches the engineering gates DG0-DG7.
import { sql, type DbOrTx, type OwnerUpdateRevisionRow, type OwnerUpdateRow, type Tx } from "@mth/db";
import { PROBLEM_TYPES } from "@mth/shared";
import {
  OWNER_UPDATE_REFUSALS,
  OWNER_UPDATE_STATUSES,
  OWNER_UPDATE_SUBJECT_TYPES,
  ownerUpdateCreate,
  ownerUpdatePatch,
  ownerUpdateReopen,
  type OwnerUpdate,
  type OwnerUpdateField,
  type OwnerUpdateRefusalCode,
  type OwnerUpdateRevision,
  type OwnerUpdateSubjectType,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  auditContextOf,
  commitTimeDenial,
  grantApplies,
  principalOf,
  refreshPrincipal,
  requireAction,
  requireTransformationRead,
  type Principal,
  type ResolvedTarget,
} from "../access/index.ts";
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
import { writableTransformation } from "../transformations/index.ts";

export const OWNER_UPDATE_SUBMIT = "owner_update.submit" as const;
/** The work-item kind of the update task (0080) and its dedupe key prefix (ADR-0045 §6). */
export const OWNER_UPDATE_DUE_KIND = "owner_update_due";
export const ownerUpdateDueKey = (periodId: string, subjectType: string, subjectId: string, userId: string): string =>
  `${OWNER_UPDATE_DUE_KIND}:${periodId}:${subjectType}:${subjectId}:${userId}`;

const JSON_BODY = ["application/json"] as const;
const UPDATES = "/api/v1/transformations/:transformationId/updates";
const ONE = `${UPDATES}/:updateId`;

const tParams = z.strictObject({ transformationId: z.uuid() });
const uParams = z.strictObject({ transformationId: z.uuid(), updateId: z.uuid() });
const listQuery = z.strictObject({
  cursor: cursorSchema,
  limit: limitSchema,
  reportingPeriodId: z.uuid().optional(),
  subjectType: z.enum(OWNER_UPDATE_SUBJECT_TYPES).optional(),
  status: z.enum(OWNER_UPDATE_STATUSES).optional(),
});
const pageQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });

type FieldColumn =
  | "achievements"
  | "next_steps"
  | "milestones"
  | "outcomes"
  | "adoption"
  | "risks"
  | "dependencies"
  | "asks";

/** The eight stored fields of a row, in M0185 order (no computed member access: architecture rule). */
type FieldValues = Readonly<Record<FieldColumn, string | null>>;

function columnsOf(r: FieldValues): FieldValues {
  return {
    achievements: r.achievements,
    next_steps: r.next_steps,
    milestones: r.milestones,
    outcomes: r.outcomes,
    adoption: r.adoption,
    risks: r.risks,
    dependencies: r.dependencies,
    asks: r.asks,
  };
}

/** The ADR-0045 §11 English texts by code (a Map: runtime keys are never computed members). */
const REFUSAL_TEXT: ReadonlyMap<string, string> = new Map(Object.entries(OWNER_UPDATE_REFUSALS));

// ------------------------------------------------------------------------------------------------ refusals

function refusal(code: OwnerUpdateRefusalCode): HttpProblem {
  const detail = REFUSAL_TEXT.get(code)!;
  if (code === "owner_update.not_owner")
    return new HttpProblem({ status: 403, type: PROBLEM_TYPES.forbidden, code, title: "Forbidden", detail });
  if (code === "owner_update.exists") return problems.duplicate(code, detail);
  return problems.businessRule(code, detail);
}

/** ADR-0045 §11 refusals with their exact English texts. */
export const ownerUpdateRefusals = Object.freeze({
  notOwner: () => refusal("owner_update.not_owner"),
  exists: () => refusal("owner_update.exists"),
  periodNotOpen: () => refusal("owner_update.period_not_open"),
  notDraft: () => refusal("owner_update.not_draft"),
  empty: () => refusal("owner_update.empty"),
  notSubmitted: () => refusal("owner_update.not_submitted"),
});

/** A reference that does not exist in this transformation (the generic DG2 `validation.reference`). */
function referenceProblem(pointer: string, what: string): HttpProblem {
  return new HttpProblem({
    status: 422,
    type: PROBLEM_TYPES.validation,
    code: "validation.reference",
    title: "Business rule violated",
    detail: "The referenced record does not exist in this transformation.",
    errors: [{ pointer, code: "validation.reference", message: `No ${what} with this id in this transformation.` }],
  });
}

// ------------------------------------------------------------------------------------------------ presenters

type Row = OwnerUpdateRow & { period_label: string };

export function toOwnerUpdate(r: Row): OwnerUpdate {
  return {
    id: r.id,
    transformationId: r.transformation_id,
    subjectType: r.subject_type as OwnerUpdateSubjectType,
    subjectId: r.subject_id,
    reportingPeriodId: r.reporting_period_id,
    periodLabel: r.period_label,
    ownerUserId: r.owner_user_id,
    achievements: r.achievements,
    nextSteps: r.next_steps,
    milestones: r.milestones,
    outcomes: r.outcomes,
    adoption: r.adoption,
    risks: r.risks,
    dependencies: r.dependencies,
    asks: r.asks,
    status: r.status as OwnerUpdate["status"],
    revisionNo: r.revision_no,
    submittedAt: isoOrNull(r.submitted_at),
    submittedBy: r.submitted_by,
    reopenReason: r.reopen_reason,
    version: r.version,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export function toOwnerUpdateRevision(r: OwnerUpdateRevisionRow): OwnerUpdateRevision {
  return {
    revisionNo: r.revision_no,
    achievements: r.achievements,
    nextSteps: r.next_steps,
    milestones: r.milestones,
    outcomes: r.outcomes,
    adoption: r.adoption,
    risks: r.risks,
    dependencies: r.dependencies,
    asks: r.asks,
    submittedAt: iso(r.submitted_at),
    submittedBy: r.submitted_by,
  };
}

// ------------------------------------------------------------------------------------------------ reads

async function loadUpdate(
  db: DbOrTx,
  transformationId: string,
  updateId: string,
  lock = false,
): Promise<Row | undefined> {
  let q = db
    .selectFrom("owner_update as u")
    .innerJoin("reporting_period as p", "p.id", "u.reporting_period_id")
    .selectAll("u")
    .select("p.period_label")
    .where("u.id", "=", updateId)
    .where("u.transformation_id", "=", transformationId);
  if (lock) q = q.forUpdate("u");
  return q.executeTakeFirst();
}

/**
 * The latest submitted revision of each subject's update for one period of a transformation (the executive pack's
 * source, ADR-0045 §6): keyed `<subjectType>:<subjectId>`, with the update row (its `version` and `revision_no`) and
 * the revision. A draft that was never submitted has no entry; a reopened update shows its last submitted revision.
 */
export async function submittedUpdatesOfPeriod(
  db: DbOrTx,
  transformationId: string,
  reportingPeriodId: string,
): Promise<Map<string, { update: OwnerUpdateRow; revision: OwnerUpdateRevisionRow }>> {
  const updates = await db
    .selectFrom("owner_update")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .where("reporting_period_id", "=", reportingPeriodId)
    .where("revision_no", ">=", 1)
    .orderBy("id")
    .execute();
  const out = new Map<string, { update: OwnerUpdateRow; revision: OwnerUpdateRevisionRow }>();
  if (updates.length === 0) return out;
  const revisions = await db
    .selectFrom("owner_update_revision")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .where(
      "owner_update_id",
      "in",
      updates.map((u) => u.id),
    )
    .orderBy("owner_update_id")
    .orderBy("revision_no", "desc")
    .execute();
  const latest = new Map<string, OwnerUpdateRevisionRow>();
  for (const r of revisions) if (!latest.has(r.owner_update_id)) latest.set(r.owner_update_id, r);
  for (const u of updates) {
    const revision = latest.get(u.id);
    if (revision !== undefined) out.set(`${u.subject_type}:${u.subject_id}`, { update: u, revision });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ authorization

interface WriteActor {
  readonly principal: Principal;
  readonly userId: string;
  readonly target: ResolvedTarget;
  readonly organizationId: string;
}

/**
 * The write gate (ADR-0045 §9), decided on grants reloaded inside `tx` (commit-time re-authorization): a transformation
 * the caller cannot read is 404; one it reads without owner_update.submit (e.g. AUD) is 403 forbidden; an archived
 * transformation is 422 transformation.archived (DG2).
 */
async function writeGate(tx: Tx, request: FastifyRequest, transformationId: string): Promise<WriteActor> {
  principalOf(request);
  const principal = await refreshPrincipal(tx, request);
  let target: ResolvedTarget;
  try {
    target = await requireTransformationRead(tx, principal, transformationId);
    await requireAction(tx, principal, OWNER_UPDATE_SUBMIT, target);
  } catch (err) {
    throw commitTimeDenial(err);
  }
  if (principal.userId === null) throw problems.forbidden();
  const t = await writableTransformation(tx, transformationId);
  return { principal, userId: principal.userId, target, organizationId: t.organization_id };
}

/**
 * Subject ownership (ADR-0045 §6): a workstream's lead; for the transformation, a holder of the TL role whose grant
 * applies to it (with owner_update.submit). Otherwise 403 owner_update.not_owner.
 */
async function requireSubjectOwner(
  tx: Tx,
  actor: WriteActor,
  transformationId: string,
  subjectType: string,
  subjectId: string,
): Promise<void> {
  if (subjectType === "workstream") {
    const ws = await tx
      .selectFrom("workstream")
      .select("lead_user_id")
      .where("id", "=", subjectId)
      .where("transformation_id", "=", transformationId)
      .executeTakeFirst();
    if (ws?.lead_user_id !== actor.userId) throw ownerUpdateRefusals.notOwner();
    return;
  }
  actor.principal.tracker.decisions += 1;
  const tl = actor.principal.grants.some(
    (g) => g.roleCode === "TL" && grantApplies(g, OWNER_UPDATE_SUBMIT, actor.target),
  );
  if (!tl) throw ownerUpdateRefusals.notOwner();
}

/** The period of the update, shared-locked so it cannot close under the write; 422 when it is not open. */
async function requireOpenPeriod(tx: Tx, organizationId: string, periodId: string, pointer: string | null) {
  const p = await tx
    .selectFrom("reporting_period")
    .select(["id", "status", "period_label"])
    .where("id", "=", periodId)
    .where("organization_id", "=", organizationId)
    .forShare()
    .executeTakeFirst();
  if (p === undefined) {
    if (pointer !== null) throw referenceProblem(pointer, "reporting period");
    throw problems.internal();
  }
  if (p.status !== "open") throw ownerUpdateRefusals.periodNotOpen();
  return p;
}

// ------------------------------------------------------------------------------------------------ writes

/** The columns a create or patch body sets (undefined members are left as they are; null clears). */
function fieldValues(body: Partial<Record<OwnerUpdateField, string | null | undefined>>): Partial<FieldValues> {
  const out: { -readonly [K in FieldColumn]?: string | null } = {};
  if (body.achievements !== undefined) out.achievements = body.achievements;
  if (body.nextSteps !== undefined) out.next_steps = body.nextSteps;
  if (body.milestones !== undefined) out.milestones = body.milestones;
  if (body.outcomes !== undefined) out.outcomes = body.outcomes;
  if (body.adoption !== undefined) out.adoption = body.adoption;
  if (body.risks !== undefined) out.risks = body.risks;
  if (body.dependencies !== undefined) out.dependencies = body.dependencies;
  if (body.asks !== undefined) out.asks = body.asks;
  return out;
}

/** The audit changes of the eight fields (only those that differ; a create compares with nothing). */
function changesOf(before: FieldValues | null, after: FieldValues): Record<string, { from: unknown; to: unknown }> {
  const prior = new Map<string, string | null>(before === null ? [] : Object.entries(columnsOf(before)));
  const changes: [string, { from: unknown; to: unknown }][] = [];
  for (const [column, to] of Object.entries(columnsOf(after))) {
    const from = prior.get(column) ?? null;
    if (from !== to) changes.push([column, { from, to }]);
  }
  return Object.fromEntries(changes);
}

async function createUpdate(tx: Tx, request: FastifyRequest, transformationId: string): Promise<Row> {
  const actor = await writeGate(tx, request, transformationId);
  const body = parseBody(ownerUpdateCreate, request.body);
  if (body.subjectType === "transformation") {
    if (body.subjectId !== transformationId) throw referenceProblem("/subjectId", "subject");
  } else {
    const ws = await tx
      .selectFrom("workstream")
      .select(["id", "status"])
      .where("id", "=", body.subjectId)
      .where("transformation_id", "=", transformationId)
      .executeTakeFirst();
    if (ws === undefined) throw referenceProblem("/subjectId", "workstream");
    if (ws.status !== "active") throw problems.businessRule("workstream.archived", "This workstream is archived.");
  }
  await requireSubjectOwner(tx, actor, transformationId, body.subjectType, body.subjectId);
  const period = await requireOpenPeriod(tx, actor.organizationId, body.reportingPeriodId, "/reportingPeriodId");
  const existing = await tx
    .selectFrom("owner_update")
    .select("id")
    .where("transformation_id", "=", transformationId)
    .where("subject_type", "=", body.subjectType)
    .where("subject_id", "=", body.subjectId)
    .where("reporting_period_id", "=", body.reportingPeriodId)
    .executeTakeFirst();
  if (existing !== undefined) throw ownerUpdateRefusals.exists();
  const id = uuidv7();
  const row = await tx
    .insertInto("owner_update")
    .values({
      id,
      organization_id: actor.organizationId,
      transformation_id: transformationId,
      subject_type: body.subjectType,
      subject_id: body.subjectId,
      reporting_period_id: body.reportingPeriodId,
      owner_user_id: actor.userId,
      ...fieldValues(body),
      created_by: actor.userId,
      updated_by: actor.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, auditContextOf(request), {
    action: "owner_update.create",
    recordType: "owner_update",
    recordId: id,
    organizationId: actor.organizationId,
    transformationId,
    newVersion: row.version,
    changes: {
      subject_type: { from: null, to: row.subject_type },
      subject_id: { from: null, to: row.subject_id },
      reporting_period_id: { from: null, to: row.reporting_period_id },
      owner_user_id: { from: null, to: row.owner_user_id },
      status: { from: null, to: row.status },
      ...changesOf(null, row),
    },
  });
  return { ...row, period_label: period.period_label };
}

/** The locked update of the transformation, owned by the caller, at the If-Match version (404, 403, 409). */
async function lockedOwnUpdate(
  tx: Tx,
  actor: WriteActor,
  transformationId: string,
  updateId: string,
  expected: number,
): Promise<Row> {
  const current = await loadUpdate(tx, transformationId, updateId, true);
  if (current === undefined) throw problems.notFound();
  await requireSubjectOwner(tx, actor, transformationId, current.subject_type, current.subject_id);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  return current;
}

async function updateUpdate(tx: Tx, request: FastifyRequest, transformationId: string, updateId: string) {
  const actor = await writeGate(tx, request, transformationId);
  const expected = requireIfMatch(request);
  const body = parseBody(ownerUpdatePatch, request.body);
  const current = await lockedOwnUpdate(tx, actor, transformationId, updateId, expected);
  if (current.status !== "draft") throw ownerUpdateRefusals.notDraft();
  await requireOpenPeriod(tx, actor.organizationId, current.reporting_period_id, null);
  const updated = await tx
    .updateTable("owner_update")
    .set({
      ...fieldValues(body),
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: actor.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, auditContextOf(request), {
    action: "owner_update.update",
    recordType: "owner_update",
    recordId: current.id,
    organizationId: current.organization_id,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: changesOf(current, updated),
  });
  return { ...updated, period_label: current.period_label };
}

async function submitUpdate(tx: Tx, request: FastifyRequest, transformationId: string, updateId: string) {
  const actor = await writeGate(tx, request, transformationId);
  const expected = requireIfMatch(request);
  const current = await lockedOwnUpdate(tx, actor, transformationId, updateId, expected);
  if (current.status !== "draft") throw ownerUpdateRefusals.notDraft();
  await requireOpenPeriod(tx, actor.organizationId, current.reporting_period_id, null);
  if (Object.values(columnsOf(current)).every((v) => v === null)) throw ownerUpdateRefusals.empty();
  const revisionNo = current.revision_no + 1;
  const updated = await tx
    .updateTable("owner_update")
    .set({
      status: "submitted",
      revision_no: revisionNo,
      submitted_at: sql<Date>`now()`,
      submitted_by: actor.userId,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: actor.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  const fields = columnsOf(updated);
  await tx
    .insertInto("owner_update_revision")
    .values({
      id: uuidv7(),
      organization_id: current.organization_id,
      transformation_id: transformationId,
      owner_update_id: current.id,
      revision_no: revisionNo,
      ...fields,
      submitted_at: sql<Date>`now()`,
      submitted_by: actor.userId,
    })
    .execute();
  await record(tx, auditContextOf(request), {
    action: "owner_update.submit",
    recordType: "owner_update",
    recordId: current.id,
    organizationId: current.organization_id,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: {
      status: { from: "draft", to: "submitted" },
      revision_no: { from: current.revision_no, to: revisionNo },
      submitted_by: { from: current.submitted_by, to: actor.userId },
    },
  });
  await completeDueTasks(tx, request, current);
  return { ...updated, period_label: current.period_label };
}

/**
 * Completes the open update tasks of this subject and period (every owner's: the update is in), each with its
 * work_item.complete audit event, in the submitting transaction (the tasks service's closing rule, narrowed to one
 * period by the dedupe key prefix).
 */
async function completeDueTasks(tx: Tx, request: FastifyRequest, u: OwnerUpdateRow): Promise<void> {
  const prefix = `${OWNER_UPDATE_DUE_KIND}:${u.reporting_period_id}:${u.subject_type}:${u.subject_id}:`;
  const open = await tx
    .selectFrom("work_item")
    .select(["id", "version", "organization_id", "transformation_id"])
    .where("organization_id", "=", u.organization_id)
    .where("kind", "=", OWNER_UPDATE_DUE_KIND)
    .where("status", "=", "open")
    .where("dedupe_key", "like", `${prefix}%`)
    .orderBy("id")
    .forUpdate()
    .execute();
  const ctx = auditContextOf(request);
  for (const item of open) {
    const updated = await tx
      .updateTable("work_item")
      .set({
        status: "done",
        completed_at: sql<Date>`now()`,
        completed_by: ctx.actorUserId,
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`,
        updated_by: ctx.actorUserId,
      })
      .where("id", "=", item.id)
      .where("version", "=", item.version)
      .returning("version")
      .executeTakeFirstOrThrow();
    await record(tx, ctx, {
      action: "work_item.complete",
      recordType: "work_item",
      recordId: item.id,
      organizationId: item.organization_id,
      transformationId: item.transformation_id,
      priorVersion: item.version,
      newVersion: updated.version,
      changes: { status: { from: "open", to: "done" } },
    });
  }
}

async function reopenUpdate(tx: Tx, request: FastifyRequest, transformationId: string, updateId: string) {
  const actor = await writeGate(tx, request, transformationId);
  const expected = requireIfMatch(request);
  const { reason } = parseBody(ownerUpdateReopen, request.body);
  const current = await lockedOwnUpdate(tx, actor, transformationId, updateId, expected);
  if (current.status !== "submitted") throw ownerUpdateRefusals.notSubmitted();
  await requireOpenPeriod(tx, actor.organizationId, current.reporting_period_id, null);
  const updated = await tx
    .updateTable("owner_update")
    .set({
      status: "draft",
      submitted_at: null,
      submitted_by: null,
      reopen_reason: reason,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: actor.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, auditContextOf(request), {
    action: "owner_update.reopen",
    recordType: "owner_update",
    recordId: current.id,
    organizationId: current.organization_id,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    reason,
    changes: {
      status: { from: "submitted", to: "draft" },
      reopen_reason: { from: current.reopen_reason, to: reason },
    },
  });
  return { ...updated, period_label: current.period_label };
}

// ------------------------------------------------------------------------------------------------ routes

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerOwnerUpdateRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  // Before the write transaction, on the request's grants: a transformation the caller cannot read is 404 (existence
  // never disclosed). The write gate re-decides inside the transaction (commit time), where a read right lost
  // meanwhile becomes 403 (commitTimeDenial).
  const precheck = (request: FastifyRequest, transformationId: string) =>
    requireTransformationRead(db, principalOf(request), transformationId);
  const read = { access: { permission: "transformation.read" as const } };
  const write = { access: { permission: OWNER_UPDATE_SUBMIT }, consumes: JSON_BODY };
  // submitOwnerUpdate declares no request body: the default media-type set (shared rule 3).
  const action = { access: { permission: OWNER_UPDATE_SUBMIT } };

  app.get(UPDATES, { config: read }, async (request) => {
    const { transformationId } = parse(tParams, request.params, "params");
    const query = parseQuery(listQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({
      table: "owner_update",
      transformationId,
      reportingPeriodId: query.reportingPeriodId ?? null,
      subjectType: query.subjectType ?? null,
      status: query.status ?? null,
    });
    const after = decodeCursor(query.cursor, hash, 1);
    // Newest first: ids are UUIDv7 (time-ordered).
    let q = db
      .selectFrom("owner_update as u")
      .innerJoin("reporting_period as p", "p.id", "u.reporting_period_id")
      .selectAll("u")
      .select("p.period_label")
      .where("u.transformation_id", "=", transformationId);
    if (query.reportingPeriodId !== undefined) q = q.where("u.reporting_period_id", "=", query.reportingPeriodId);
    if (query.subjectType !== undefined) q = q.where("u.subject_type", "=", query.subjectType);
    if (query.status !== undefined) q = q.where("u.status", "=", query.status);
    if (after) q = q.where("u.id", "<", String(after[0]));
    const rows = await q
      .orderBy("u.id", "desc")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: page.items.map(toOwnerUpdate), nextCursor: page.nextCursor };
  });

  app.post(UPDATES, { config: write }, async (request, reply) => {
    const { transformationId } = parse(tParams, request.params, "params");
    await precheck(request, transformationId);
    const row = await db.transaction().execute((tx) => createUpdate(tx, request, transformationId));
    return sendVersioned(
      reply,
      201,
      toOwnerUpdate(row),
      `/api/v1/transformations/${transformationId}/updates/${row.id}`,
    );
  });

  app.get(ONE, { config: read }, async (request, reply) => {
    const { transformationId, updateId } = parse(uParams, request.params, "params");
    parseQuery(z.strictObject({}), request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const row = await loadUpdate(db, transformationId, updateId);
    if (row === undefined) throw problems.notFound();
    return sendVersioned(reply, 200, toOwnerUpdate(row));
  });

  app.patch(ONE, { config: write }, async (request, reply) => {
    const { transformationId, updateId } = parse(uParams, request.params, "params");
    await precheck(request, transformationId);
    const row = await db.transaction().execute((tx) => updateUpdate(tx, request, transformationId, updateId));
    return sendVersioned(reply, 200, toOwnerUpdate(row));
  });

  app.post(`${ONE}/submit`, { config: action }, async (request, reply) => {
    const { transformationId, updateId } = parse(uParams, request.params, "params");
    await precheck(request, transformationId);
    const row = await db.transaction().execute((tx) => submitUpdate(tx, request, transformationId, updateId));
    return sendVersioned(reply, 200, toOwnerUpdate(row));
  });

  app.post(`${ONE}/reopen`, { config: write }, async (request, reply) => {
    const { transformationId, updateId } = parse(uParams, request.params, "params");
    await precheck(request, transformationId);
    const row = await db.transaction().execute((tx) => reopenUpdate(tx, request, transformationId, updateId));
    return sendVersioned(reply, 200, toOwnerUpdate(row));
  });

  app.get(`${ONE}/revisions`, { config: read }, async (request) => {
    const { transformationId, updateId } = parse(uParams, request.params, "params");
    const query = parseQuery(pageQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    if ((await loadUpdate(db, transformationId, updateId)) === undefined) throw problems.notFound();
    const hash = filterHash({ table: "owner_update_revision", updateId });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("owner_update_revision").selectAll().where("owner_update_id", "=", updateId);
    if (after) q = q.where("revision_no", "<", Number(after[0]));
    const rows = await q
      .orderBy("revision_no", "desc")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.revision_no], hash);
    return { items: page.items.map(toOwnerUpdateRevision), nextCursor: page.nextCursor };
  });

  return [
    `GET ${UPDATES}`,
    `POST ${UPDATES}`,
    `GET ${ONE}`,
    `PATCH ${ONE}`,
    `POST ${ONE}/submit`,
    `POST ${ONE}/reopen`,
    `GET ${ONE}/revisions`,
  ];
}
