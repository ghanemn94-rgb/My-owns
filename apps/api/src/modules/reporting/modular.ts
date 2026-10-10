// Modular entry (P4 slice K; ADR-0038 §7, §10-§12; T-DG4-BE-M2; REQ-PB-005, REQ-S03-005):
//   GET  /transformations/{t}/missing-links                                   (transformation.read)
//   GET  /transformations/{t}/inherited-records[?cursor&limit&includeRemoved] (transformation.read)
//   POST /transformations/{t}/inherited-records                               (inherited_record.record; TL, TO)
//   GET  /transformations/{t}/inherited-records/{inheritedRecordId}           (transformation.read; T-DG4-BE-R3)
//   POST /transformations/{t}/inherited-records/{inheritedRecordId}/withdraw  (inherited_record.record; If-Match)
//
// - The missing-link report is computed in one read-only transaction and stored nowhere (JK.10 item 2). Its rule is the
//   pure `deriveMissingLinks` over the facts of transformations/missing-links-facts.ts, the same rule the Modular G3
//   precondition of workflows/gates.ts reads (D-106 (e)).
// - Gate labels (§7.2): `approved` only when `gate_instance.status = 'approved'`; an inherited approval is `inherited`
//   (counts) or `inherited_pending_verification`, never `approved`. The annotation is the DG3 one (same facts loader,
//   same selection rule), so the DG3 gate list and this report always agree.
// - Inherited records reference the canonical evidence item or baseline; nothing is copied. Prior approvals are NOT
//   recorded here: they stay `gate_dispensation` rows of kind `inherited_approval` (ADR-0021 §5) and are listed
//   read-only as `prior_approval` entries. No path here writes `gate_decision` or changes `gate_instance.status`; an
//   inherited baseline stays `unvalidated`. Every inherited item carries the label "Inherited - recorded, not granted
//   in platform" (`label: "inherited"`, translated at render time; S-6).
// - Every write re-authorises at commit, validates, takes If-Match on the withdrawal (creates are version 1), writes one
//   audit event in its transaction and does no remote I/O inside it (S-4). Nothing here grants a business approval,
//   and nothing reads or writes the engineering delivery gates DG0-DG7.
// - T-DG4-BE-R3 (p4-work-split JK.10 item 3; ADR-0038 §10 "404 outside scope"): a caller who never could read the
//   transformation gets 404 on every write too, as on the workstream writes of portfolio/structure.ts; a right revoked
//   while the request waited is still the commit-time 403.
import type { InheritedRecordRow, Tx } from "@mth/db";
import {
  deriveMissingLinks,
  gateLabelOf,
  INHERITED_LABEL,
  inheritedApprovalAnnotation,
  inheritedRecordCreate,
  reasonRequest,
  type DerivedMissingLink,
  type GateDispensation,
  type InheritedRecord,
  type InheritedRecordCreate,
  type MissingLinkItem,
  type MissingLinks,
} from "@mth/shared/schemas";
import { PROBLEM_TYPES } from "@mth/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { principalOf, requireTransformationRead } from "../access/index.ts";
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
import { loadDispensations, loadInheritedApprovalFacts } from "../portfolio/index.ts";
import {
  bumpStamps,
  loadMissingLinkFacts,
  loadModularEntryFacts,
  maybeIdempotent,
  openWrite,
  sendCreated,
  type WriteContext,
} from "../transformations/index.ts";
import { hrefOf, readOnly } from "./traceability.ts";

const T_BASE = "/api/v1/transformations/:transformationId";
const MISSING = `${T_BASE}/missing-links`;
const RECORDS = `${T_BASE}/inherited-records`;
const RECORD = `${RECORDS}/:inheritedRecordId`;
const RECORD_WITHDRAW = `${RECORD}/withdraw`;
const JSON_BODY = ["application/json"] as const;
export const INHERITED_RECORD_PERMISSION = "inherited_record.record" as const;
const WRITE_RULES = [{ permission: INHERITED_RECORD_PERMISSION }];

/** ADR-0038 §12 refusal texts (exact; S-11), plus the one BE-M2 code reported in its handback. */
export const INHERITED_TEXT = Object.freeze({
  notModular: "Inherited records can be recorded only for a transformation in Modular entry.",
  priorApproval: "Record a prior approval as an inherited gate approval; it is never stored as a platform approval.",
  duplicate: "This record is already recorded as inherited.",
  notActive: "This inherited record has already been withdrawn.",
  /** BE-M2 (new code, handback §contract): the referenced record is not an active record of this transformation. */
  recordNotFound: "The evidence item or baseline does not exist in this transformation or is archived.",
});

const tParams = z.strictObject({ transformationId: z.uuid() });
const wParams = z.strictObject({ transformationId: z.uuid(), inheritedRecordId: z.uuid() });
const listQuery = z.strictObject({
  cursor: cursorSchema,
  limit: limitSchema,
  includeRemoved: z.stringbool().default(false),
});

const rule = (code: string, detail: string, pointer?: string): HttpProblem =>
  new HttpProblem({
    status: 422,
    type: PROBLEM_TYPES.validation,
    code,
    title: "Business rule violated",
    detail,
    ...(pointer !== undefined ? { errors: [{ pointer, code, message: detail }] } : {}),
  });

const notActive = (): HttpProblem =>
  new HttpProblem({
    status: 422,
    type: PROBLEM_TYPES.invalidTransition,
    code: "inherited_record.not_active",
    title: "Invalid transition",
    detail: INHERITED_TEXT.notActive,
    errors: [{ pointer: "", code: "inherited_record.not_active", message: INHERITED_TEXT.notActive }],
  });

const dateOnly = (d: string | Date | null): string | null =>
  d === null ? null : typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10);

// ------------------------------------------------------------------------------------------------ presenters

export function toInheritedRecord(r: InheritedRecordRow): InheritedRecord {
  return {
    id: r.id,
    transformationId: r.transformation_id,
    kind: r.kind as InheritedRecord["kind"],
    label: INHERITED_LABEL,
    evidenceId: r.evidence_id,
    baselineId: r.baseline_id,
    gateDispensationId: null,
    gateCode: null,
    approvingBody: null,
    sourceDescription: r.source_description,
    originalOwner: r.original_owner,
    originalDate: dateOnly(r.original_date),
    recordedBy: r.recorded_by,
    status: r.status,
    withdrawnAt: isoOrNull(r.withdrawn_at),
    withdrawnBy: r.withdrawn_by,
    withdrawReason: r.withdraw_reason,
    version: r.version,
    createdAt: iso(r.created_at),
  };
}

/** A read-only `prior_approval` entry: one inherited-approval dispensation (ADR-0021 §5), labelled inherited. */
function priorApprovalOf(d: GateDispensation): InheritedRecord {
  return {
    id: d.id,
    transformationId: d.transformationId,
    kind: "prior_approval",
    label: INHERITED_LABEL,
    evidenceId: d.evidenceId,
    baselineId: null,
    gateDispensationId: d.id,
    gateCode: d.gateCode,
    approvingBody: d.approvingBody,
    sourceDescription: null,
    originalOwner: null,
    originalDate: d.approvedOn,
    recordedBy: d.recordedBy,
    // The DG3 annotation's wording: a pending dispensation is "pending_verification".
    status: d.status === "pending" ? "pending_verification" : d.status,
    withdrawnAt: d.revokedAt,
    withdrawnBy: d.revokedBy,
    withdrawReason: d.revokeReason,
    version: d.version,
    createdAt: d.createdAt,
  };
}

// ------------------------------------------------------------------------------------------------ missing links

/** The `href` of a missing-link item: the record's read operation, else the collection where it is supplied. */
function itemHref(transformationId: string, i: DerivedMissingLink): string {
  const t = `/api/v1/transformations/${transformationId}`;
  switch (i.code) {
    case "baseline_missing":
      return `${t}/baselines`;
    case "outcome_link_missing":
      return `${t}/outcome-kpis`;
    case "benefit_missing":
      return `${t}/benefits`;
    case "inherited_approval_unverified":
      return `${t}/gate-dispensations`;
    case "outcome_kpi_missing":
      return hrefOf("outcome", transformationId, i.recordId!);
    case "initiative_outcome_link_missing":
      return `/api/v1/initiatives/${i.recordId!}/outcome-contributions`;
    case "initiative_gap_link_missing":
      return `/api/v1/initiatives/${i.recordId!}/gap-links`;
    case "benefit_outcome_link_missing":
      return hrefOf("benefit", transformationId, i.recordId!);
  }
}

/** ADR-0038 §7.3: the report of one transformation (read-only; nothing stored). */
export async function buildMissingLinks(tx: Tx, transformationId: string): Promise<MissingLinks> {
  const entry = await loadModularEntryFacts(tx, transformationId);
  if (entry === null) throw problems.notFound();
  const facts = await loadMissingLinkFacts(tx, transformationId);
  const inherited = await loadInheritedApprovalFacts(tx, transformationId);
  const instances = await tx
    .selectFrom("gate_instance")
    .select(["gate_code", "status"])
    .where("transformation_id", "=", transformationId)
    .orderBy("gate_code")
    .execute();
  const items: MissingLinkItem[] = deriveMissingLinks(facts).map((i) => ({
    ...i,
    href: itemHref(transformationId, i),
  }));
  return {
    transformationId,
    mode: entry.mode,
    entryPhase: entry.entryPhase as MissingLinks["entryPhase"],
    standaloneDeliverableType: entry.standaloneDeliverableType,
    gates: instances.map((g) => {
      const annotation = inheritedApprovalAnnotation(inherited, g.gate_code);
      return {
        gateCode: g.gate_code,
        status: g.status,
        label: gateLabelOf(g.status, annotation),
        inheritedApproval: annotation,
      };
    }),
    items,
  };
}

// ------------------------------------------------------------------------------------------------ writes

/**
 * T-DG4-BE-R3 (JK.10 item 3): the write gate. The transformation read gate on the request-start grants first, so a
 * caller who never could read the transformation (another organization) gets 404, never a 403 that discloses it; then
 * openWrite's commit-time re-authorisation on grants reloaded inside `tx` (a right revoked meanwhile is 403, audited).
 * The same order as portfolio/structure.ts `openWorkstreamWrite`.
 */
async function openModularWrite(tx: Tx, request: FastifyRequest, transformationId: string): Promise<WriteContext> {
  await requireTransformationRead(tx, principalOf(request), transformationId);
  return openWrite(tx, request, transformationId, WRITE_RULES, null, { atCommit: true });
}

async function audit(
  ctx: WriteContext,
  action: string,
  id: string,
  versions: { prior?: number; next: number },
  changes: Record<string, { from: unknown; to: unknown }>,
  reason?: string,
): Promise<void> {
  await record(ctx.tx, ctx.audit, {
    action,
    recordType: "inherited_record",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    ...(versions.prior !== undefined ? { priorVersion: versions.prior } : {}),
    newVersion: versions.next,
    ...(reason !== undefined ? { reason } : {}),
    changes,
  });
}

/** ADR-0038 §7.1: records an inherited evidence item or baseline (Modular only); prior approvals are refused. */
async function createInheritedRecord(ctx: WriteContext, body: InheritedRecordCreate): Promise<InheritedRecord> {
  const { tx, transformationId } = ctx;
  if (body.kind === "prior_approval")
    throw rule("inherited_record.prior_approval_use_dispensation", INHERITED_TEXT.priorApproval, "/kind");
  const entry = await loadModularEntryFacts(tx, transformationId);
  if (entry?.mode !== "modular") throw rule("inherited_record.not_modular", INHERITED_TEXT.notModular);
  const isEvidence = body.kind === "evidence";
  const refId = (isEvidence ? body.evidenceId : body.baselineId)!;
  const pointer = isEvidence ? "/evidenceId" : "/baselineId";
  const ref = await tx
    .selectFrom(isEvidence ? "evidence" : "baseline")
    .select(["id", "status"])
    .where("transformation_id", "=", transformationId)
    .where("id", "=", refId)
    .executeTakeFirst();
  if (!ref || ref.status !== "active")
    throw rule("inherited_record.record_not_found", INHERITED_TEXT.recordNotFound, pointer);
  const dup = await tx
    .selectFrom("inherited_record")
    .select("id")
    .where("transformation_id", "=", transformationId)
    .where("status", "=", "active")
    .where(isEvidence ? "evidence_id" : "baseline_id", "=", refId)
    .executeTakeFirst();
  if (dup) throw problems.duplicate("inherited_record.duplicate", INHERITED_TEXT.duplicate);
  const id = uuidv7();
  const row = await tx
    .insertInto("inherited_record")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      kind: body.kind,
      evidence_id: isEvidence ? refId : null,
      baseline_id: isEvidence ? null : refId,
      source_description: body.sourceDescription,
      original_owner: body.originalOwner ?? null,
      original_date: body.originalDate ?? null,
      recorded_by: ctx.userId,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await audit(
    ctx,
    "inherited_record.create",
    id,
    { next: row.version },
    {
      kind: { from: null, to: row.kind },
      ...(isEvidence ? { evidenceId: { from: null, to: refId } } : { baselineId: { from: null, to: refId } }),
      sourceDescription: { from: null, to: row.source_description },
      originalOwner: { from: null, to: row.original_owner },
      originalDate: { from: null, to: dateOnly(row.original_date) },
    },
  );
  return toInheritedRecord(row);
}

/** ADR-0038 §7.1: `active → withdrawn` (terminal) with a reason; the provenance never changes. */
async function withdrawInheritedRecord(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
  inheritedRecordId: string,
): Promise<InheritedRecord> {
  const ctx = await openModularWrite(tx, request, transformationId);
  const body = parseBody(reasonRequest, request.body);
  const expected = requireIfMatch(request);
  const current = await tx
    .selectFrom("inherited_record")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .where("id", "=", inheritedRecordId)
    .forUpdate()
    .executeTakeFirst();
  if (!current) throw problems.notFound();
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status !== "active") throw notActive();
  const updated = await tx
    .updateTable("inherited_record")
    .set({
      status: "withdrawn",
      withdrawn_at: new Date(),
      withdrawn_by: ctx.userId,
      withdraw_reason: body.reason,
      ...bumpStamps(ctx.userId),
    })
    .where("id", "=", inheritedRecordId)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await audit(
    ctx,
    "inherited_record.withdraw",
    inheritedRecordId,
    { prior: current.version, next: updated.version },
    { status: { from: "active", to: "withdrawn" } },
    body.reason,
  );
  return toInheritedRecord(updated);
}

// ------------------------------------------------------------------------------------------------ routes

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerModularRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "transformation.read" as const } };
  const write = { access: { permission: INHERITED_RECORD_PERMISSION }, consumes: JSON_BODY };

  app.get(MISSING, { config: read }, async (request): Promise<MissingLinks> => {
    const { transformationId } = parse(tParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    return readOnly(db, (tx) => buildMissingLinks(tx, transformationId));
  });

  app.get(RECORDS, { config: read }, async (request) => {
    const { transformationId } = parse(tParams, request.params, "params");
    const query = parseQuery(listQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({ table: "inherited_record", transformationId, includeRemoved: query.includeRemoved });
    const after = decodeCursor(query.cursor, hash, 2);
    const all = await readOnly(db, async (tx) => {
      let q = tx.selectFrom("inherited_record").selectAll().where("transformation_id", "=", transformationId);
      if (!query.includeRemoved) q = q.where("status", "=", "active");
      const own = (await q.execute()).map(toInheritedRecord);
      const prior = (await loadDispensations(tx, transformationId))
        .filter((d) => d.kind === "inherited_approval")
        .filter((d) => query.includeRemoved || d.status === "pending" || d.status === "accepted")
        .map(priorApprovalOf);
      return [...own, ...prior];
    });
    // Oldest first, then id: a stable keyset over both sources.
    const sorted = all.sort((a, b) =>
      a.createdAt === b.createdAt ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.createdAt < b.createdAt ? -1 : 1,
    );
    const rest =
      after === null
        ? sorted
        : sorted.filter(
            (r) => r.createdAt > String(after[0]) || (r.createdAt === String(after[0]) && r.id > String(after[1])),
          );
    const page = paginate(rest.slice(0, query.limit + 1), query.limit, (r) => [r.createdAt, r.id], hash);
    return { items: page.items, nextCursor: page.nextCursor };
  });

  // T-DG4-BE-R3 (ADR-0038 amendment B3): one inherited record, active or withdrawn, so createInheritedRecord's
  // Location keeps resolving after a withdrawal. Any other id (a `prior_approval` entry's dispensation id included)
  // is 404: those are read through listGateDispensations.
  app.get(RECORD, { config: read }, async (request, reply) => {
    const { transformationId, inheritedRecordId } = parse(wParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    const row = await readOnly(db, (tx) =>
      tx
        .selectFrom("inherited_record")
        .selectAll()
        .where("transformation_id", "=", transformationId)
        .where("id", "=", inheritedRecordId)
        .executeTakeFirst(),
    );
    if (!row) throw problems.notFound();
    return sendVersioned(reply, 200, toInheritedRecord(row));
  });

  app.post(RECORDS, { config: write }, async (request, reply) => {
    const { transformationId } = parse(tParams, request.params, "params");
    const result = await db.transaction().execute(async (tx) => {
      const ctx = await openModularWrite(tx, request, transformationId);
      const body = parseBody(inheritedRecordCreate, request.body);
      return maybeIdempotent(tx, request, ctx.userId, body, async () => ({
        status: 201,
        body: await createInheritedRecord(ctx, body),
      }));
    });
    return sendCreated(request, reply, result, `/api/v1/transformations/${transformationId}/inherited-records`);
  });

  app.post(RECORD_WITHDRAW, { config: write }, async (request, reply) => {
    const { transformationId, inheritedRecordId } = parse(wParams, request.params, "params");
    const body = await db
      .transaction()
      .execute((tx) => withdrawInheritedRecord(tx, request, transformationId, inheritedRecordId));
    return sendVersioned(reply, 200, body);
  });

  return [`GET ${MISSING}`, `GET ${RECORDS}`, `GET ${RECORD}`, `POST ${RECORDS}`, `POST ${RECORD_WITHDRAW}`];
}
