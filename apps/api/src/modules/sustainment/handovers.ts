// BAU handovers with the M0217 content and receiving-owner acceptance (P4 slice G; ADR-0034 §5, §9, §10, §12;
// T-DG4-BE-I; REQ-PB-083, REQ-S11-005):
//   GET  /transformations/{t}/bau-handovers                     list (transformation.read; ?performanceAreaId, ?status)
//   POST /transformations/{t}/bau-handovers                     prepare for the current cycle of an establishing or
//                                                               reopened area (bau_handover.prepare; WL, TL)
//   GET  /transformations/{t}/bau-handovers/{h}                 one handover with controls, evidence, open CI items
//                                                               and the items submission still needs (missingItems)
//   PATCH /transformations/{t}/bau-handovers/{h}                edit the content while draft or returned (If-Match)
//   POST /transformations/{t}/bau-handovers/{h}/evidence        link an evidence item while draft or returned
//   POST /transformations/{t}/bau-handovers/{h}/submit          validate every M0217 item; My Work item for the
//                                                               receiving owner
//   POST /transformations/{t}/bau-handovers/{h}/accept          receiving-owner acceptance (business approval)
//   POST /transformations/{t}/bau-handovers/{h}/return          receiving owner returns it with a reason
//
// Acceptance is the T12 "BAU Handover" A/R decision of the Business Owner (B0101) and a business approval INSIDE the
// product: it needs `bau_handover.accept` AND the caller must be the handover's receiving owner, else 403
// `bau_handover.not_receiving_owner`; a technical-admin-only caller gets 403 (REQ-S10-003); a delegate does not accept
// for the receiving owner (D-099). It is never a DG0-DG7 engineering gate, and no job, seed or trigger accepts. In one
// transaction under lock class bauHandover on the area it: accepts the handover (final); moves the area to BAU with the
// receiving owner as BAU owner, the handover's KPI owner and the next review date (acceptance business date + one
// review period); transfers routine ownership (linked KPIs -> the KPI owner, the area's controls without an owner and
// linked benefits without a BAU owner -> the receiving owner), each row version + 1 with its audit event; and creates
// the first recurring review exactly once through scheduleAreaReview (REQ-PB-083).
import { diffFields, sql, type BauHandoverRow, type DbOrTx, type Tx } from "@mth/db";
import {
  BAU_HANDOVER_ITEMS,
  bauHandoverCreate,
  bauHandoverEvidenceAdd,
  bauHandoverUpdate,
  sustainmentStatusNote,
  type BauHandover,
  type BauHandoverItem,
  type SustainFrequency,
} from "@mth/shared/schemas";
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
import { closeWorkItemsOfSubject, createWorkItemOnce } from "../tasks/index.ts";
import { assertActiveUsers, type WriteContext } from "../transformations/index.ts";
import {
  areaChanges,
  businessDatePlusPeriod,
  findArea,
  lockAreaHandover,
  nextSustainmentCode,
  openSustainmentWrite,
  parseReason,
  parseTransformationParam,
  scheduleAreaReview,
  sustainRule,
  sustainTransition,
  userActor,
} from "./performance-areas.ts";

export const HANDOVERS = "/api/v1/transformations/:transformationId/bau-handovers";
export const HANDOVER_ITEM = `${HANDOVERS}/:bauHandoverId`;
export const HANDOVER_EVIDENCE = `${HANDOVER_ITEM}/evidence`;
export const HANDOVER_SUBMIT = `${HANDOVER_ITEM}/submit`;
export const HANDOVER_ACCEPT = `${HANDOVER_ITEM}/accept`;
export const HANDOVER_RETURN = `${HANDOVER_ITEM}/return`;
const JSON_BODY = ["application/json"] as const;
export const BAU_HANDOVER_PREPARE = "bau_handover.prepare" as const;
export const BAU_HANDOVER_ACCEPT = "bau_handover.accept" as const;
export const HANDOVER_TASK_KIND = "bau_handover_to_accept";

/**
 * The benefit `control_cadence` vocabulary (0037, `weekly` added by 0060) for a handover cadence, one to one (ADR-0034
 * amendment A1; T-DG4-BE-R2). The two spellings of semi-annual meet only here.
 */
const BENEFIT_CADENCE: ReadonlyMap<string, string> = new Map([
  ["weekly", "weekly"],
  ["monthly", "monthly"],
  ["quarterly", "quarterly"],
  ["semi_annual", "semiannual"],
  ["annual", "annual"],
]);

// ------------------------------------------------------------------------------------------------ problems (§12, S-11)

export const NOT_RECEIVING_OWNER = () =>
  new HttpProblem({
    status: 403,
    type: "urn:mth:problem:forbidden",
    code: "bau_handover.not_receiving_owner",
    title: "Forbidden",
    detail: "Only the receiving owner can accept or return this handover.",
  });
export const HANDOVER_TRANSITION = (from: string, to: string) =>
  sustainTransition("bau_handover.status_transition", `This handover cannot move from ${from} to ${to}.`);
export const HANDOVER_FROZEN = () =>
  sustainRule("bau_handover.frozen", "A submitted handover can only be accepted or returned.");
export const HANDOVER_ACCEPTED_FINAL = () =>
  sustainRule("bau_handover.accepted_final", "An accepted handover is final and cannot be changed.");
export const HANDOVER_AREA_NOT_OPEN = () =>
  sustainRule(
    "bau_handover.area_not_open",
    "A handover is prepared for an establishing or reopened performance area.",
    "/performanceAreaId",
  );
export const HANDOVER_EXISTS = () =>
  problems.duplicate("bau_handover.exists", "This performance area already has a handover in progress for this cycle.");
const RETURN_REASON_REQUIRED = () =>
  problems.badRequest("bau_handover.return_reason_required", "A reason is required to return a handover.", "/reason");

/** 422 `bau_handover.incomplete`: one error per missing item at its field, the items named in the detail (§12). */
export function handoverIncomplete(missing: readonly BauHandoverItem[]): HttpProblem {
  const items = BAU_HANDOVER_ITEMS.filter((i) => missing.includes(i.item));
  const detail = `The BAU handover is incomplete. Missing: ${items.map((i) => i.label).join(", ")}.`;
  return new HttpProblem({
    status: 422,
    type: "urn:mth:problem:validation",
    code: "bau_handover.incomplete",
    title: "Business rule violated",
    detail,
    errors: items.map((i) => ({ pointer: i.pointer, code: "bau_handover.incomplete", message: i.label })),
  });
}

/**
 * The receiving owner changes only in draft: a returned handover keeps the person who returned it (the database ties
 * `returned_by` to `receiving_owner_user_id`, CHECK bau_handover_returned_stamps). 422 at /receivingOwnerUserId.
 */
const RECEIVING_OWNER_FIXED = () =>
  sustainRule(
    "validation.not_applicable",
    "A returned handover keeps the receiving owner who returned it.",
    "/receivingOwnerUserId",
  );

// ------------------------------------------------------------------------------------------------ reads

const handoverParams = z.strictObject({ transformationId: z.uuid(), bauHandoverId: z.uuid() });
const parseHandoverParams = (params: unknown) => parse(handoverParams, params, "params");

interface HandoverFacts {
  controlIds: string[];
  evidenceIds: string[];
  openImprovementItemIds: string[];
}

/** The content items a submission of `h` still needs (ADR-0034 §5 order), from the row and its counted facts. */
export function missingItemsOf(
  h: Pick<
    BauHandoverRow,
    | "kpi_owner_user_id"
    | "operating_procedures"
    | "capability_readiness"
    | "unresolved_accepted_risks"
    | "benefit_monitoring_cadence"
    | "data_access"
    | "improvement_backlog_summary"
  >,
  facts: Pick<HandoverFacts, "controlIds" | "evidenceIds">,
): BauHandoverItem[] {
  const present = new Map<BauHandoverItem, boolean>([
    ["kpi_owner", h.kpi_owner_user_id !== null],
    ["operating_procedures", h.operating_procedures !== null],
    ["controls", facts.controlIds.length > 0],
    ["evidence", facts.evidenceIds.length > 0],
    ["capability_readiness", h.capability_readiness !== null],
    ["unresolved_accepted_risks", h.unresolved_accepted_risks !== null],
    ["benefit_monitoring_cadence", h.benefit_monitoring_cadence !== null],
    ["data_access", h.data_access !== null],
    ["improvement_backlog", h.improvement_backlog_summary !== null],
  ]);
  return BAU_HANDOVER_ITEMS.map((i) => i.item).filter((item) => present.get(item) !== true);
}

async function factsOf(db: DbOrTx, rows: readonly BauHandoverRow[]): Promise<Map<string, HandoverFacts>> {
  const out = new Map<string, HandoverFacts>();
  if (rows.length === 0) return out;
  const areaIds = [...new Set(rows.map((r) => r.performance_area_id))];
  const [controls, evidence, items] = await Promise.all([
    db
      .selectFrom("control")
      .select(["id", "performance_area_id"])
      .where("performance_area_id", "in", areaIds)
      .where("status", "=", "active")
      .orderBy("id")
      .execute(),
    db
      .selectFrom("bau_handover_evidence")
      .select(["handover_id", "evidence_id"])
      .where(
        "handover_id",
        "in",
        rows.map((r) => r.id),
      )
      .orderBy("created_at")
      .orderBy("id")
      .execute(),
    db
      .selectFrom("improvement_item")
      .select(["id", "performance_area_id"])
      .where("performance_area_id", "in", areaIds)
      .where("status", "in", ["open", "in_progress"])
      .orderBy("id")
      .execute(),
  ]);
  for (const r of rows)
    out.set(r.id, {
      controlIds: controls.filter((c) => c.performance_area_id === r.performance_area_id).map((c) => c.id),
      evidenceIds: evidence.filter((e) => e.handover_id === r.id).map((e) => e.evidence_id),
      openImprovementItemIds: items.filter((i) => i.performance_area_id === r.performance_area_id).map((i) => i.id),
    });
  return out;
}

const toHandover = (r: BauHandoverRow, f: HandoverFacts): BauHandover => ({
  id: r.id,
  transformationId: r.transformation_id,
  performanceAreaId: r.performance_area_id,
  cycleNo: r.cycle_no,
  code: r.code,
  receivingOwnerUserId: r.receiving_owner_user_id,
  kpiOwnerUserId: r.kpi_owner_user_id,
  operatingProcedures: r.operating_procedures,
  capabilityReadiness: r.capability_readiness,
  unresolvedAcceptedRisks: r.unresolved_accepted_risks,
  benefitMonitoringCadence: r.benefit_monitoring_cadence as SustainFrequency | null,
  dataAccess: r.data_access,
  improvementBacklogSummary: r.improvement_backlog_summary,
  controlIds: f.controlIds,
  evidenceIds: f.evidenceIds,
  openImprovementItemIds: f.openImprovementItemIds,
  missingItems: missingItemsOf(r, f),
  status: r.status as BauHandover["status"],
  submittedAt: isoOrNull(r.submitted_at),
  submittedBy: r.submitted_by,
  acceptedAt: isoOrNull(r.accepted_at),
  acceptedBy: r.accepted_by,
  acceptanceNote: r.acceptance_note,
  returnedAt: isoOrNull(r.returned_at),
  returnedBy: r.returned_by,
  returnReason: r.return_reason,
  version: r.version,
  createdAt: iso(r.created_at),
  createdBy: r.created_by,
  updatedAt: iso(r.updated_at),
  updatedBy: r.updated_by,
});

async function presentHandovers(db: DbOrTx, rows: readonly BauHandoverRow[]): Promise<BauHandover[]> {
  const facts = await factsOf(db, rows);
  return rows.map((r) => toHandover(r, facts.get(r.id)!));
}

async function findHandover(db: DbOrTx, transformationId: string, id: string, lock = false): Promise<BauHandoverRow> {
  let q = db
    .selectFrom("bau_handover")
    .selectAll()
    .where("id", "=", id)
    .where("transformation_id", "=", transformationId);
  if (lock) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) throw problems.notFound();
  return row;
}

async function presentHandover(db: DbOrTx, transformationId: string, id: string): Promise<BauHandover> {
  return (await presentHandovers(db, [await findHandover(db, transformationId, id)]))[0]!;
}

// ------------------------------------------------------------------------------------------------ writes

const HANDOVER_AUDIT_FIELDS = [
  "performance_area_id",
  "cycle_no",
  "code",
  "receiving_owner_user_id",
  "kpi_owner_user_id",
  "operating_procedures",
  "capability_readiness",
  "unresolved_accepted_risks",
  "benefit_monitoring_cadence",
  "data_access",
  "improvement_backlog_summary",
  "status",
  "acceptance_note",
  "return_reason",
] as const satisfies readonly (keyof BauHandoverRow & string)[];

/** The handover locked for a status or content change: area lock (bauHandover), then the row FOR UPDATE. */
async function lockHandover(tx: Tx, transformationId: string, id: string): Promise<BauHandoverRow> {
  const first = await findHandover(tx, transformationId, id);
  await lockAreaHandover(tx, first.performance_area_id);
  return findHandover(tx, transformationId, id, true);
}

/** Content edits and evidence links: only in draft or returned (§12 bau_handover.frozen / accepted_final). */
function assertEditable(h: BauHandoverRow): void {
  if (h.status === "accepted") throw HANDOVER_ACCEPTED_FINAL();
  if (h.status === "submitted") throw HANDOVER_FROZEN();
}

async function updateHandoverRow(
  ctx: WriteContext,
  current: BauHandoverRow,
  set: Record<string, unknown>,
  action: string,
  reason?: string,
): Promise<BauHandoverRow> {
  const updated = await ctx.tx
    .updateTable("bau_handover")
    .set({
      ...set,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(ctx.tx, ctx.audit, {
    action,
    recordType: "bau_handover",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    ...(reason !== undefined ? { reason } : {}),
    changes: diffFields(current, updated, [...HANDOVER_AUDIT_FIELDS]),
  });
  return updated;
}

async function createHandover(tx: Tx, request: FastifyRequest): Promise<string> {
  const transformationId = parseTransformationParam(request.params);
  const ctx = await openSustainmentWrite(tx, request, transformationId, BAU_HANDOVER_PREPARE);
  const body = parseBody(bauHandoverCreate, request.body);
  const area = await tx
    .selectFrom("performance_area")
    .select("id")
    .where("id", "=", body.performanceAreaId)
    .where("transformation_id", "=", transformationId)
    .executeTakeFirst();
  if (!area)
    throw sustainRule(
      "validation.reference",
      "The referenced record does not exist in this transformation.",
      "/performanceAreaId",
    );
  await lockAreaHandover(tx, area.id);
  const current = await findArea(tx, transformationId, area.id, true);
  if (current.status !== "establishing" && current.status !== "reopened") throw HANDOVER_AREA_NOT_OPEN();
  const open = await tx
    .selectFrom("bau_handover")
    .select("id")
    .where("performance_area_id", "=", current.id)
    .where("cycle_no", "=", current.cycle_no)
    .where("status", "in", ["draft", "submitted", "returned"])
    .executeTakeFirst();
  if (open) throw HANDOVER_EXISTS();
  await assertActiveUsers(tx, ctx.organizationId, [
    { id: body.receivingOwnerUserId, pointer: "/receivingOwnerUserId" },
    { id: body.kpiOwnerUserId, pointer: "/kpiOwnerUserId" },
  ]);
  const id = uuidv7();
  const row = await tx
    .insertInto("bau_handover")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      performance_area_id: current.id,
      cycle_no: current.cycle_no,
      code: await nextSustainmentCode(tx, transformationId, "HO"),
      receiving_owner_user_id: body.receivingOwnerUserId,
      kpi_owner_user_id: body.kpiOwnerUserId ?? null,
      operating_procedures: body.operatingProcedures ?? null,
      capability_readiness: body.capabilityReadiness ?? null,
      unresolved_accepted_risks: body.unresolvedAcceptedRisks ?? null,
      benefit_monitoring_cadence: body.benefitMonitoringCadence ?? null,
      data_access: body.dataAccess ?? null,
      improvement_backlog_summary: body.improvementBacklogSummary ?? null,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "bau_handover.create",
    recordType: "bau_handover",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    newVersion: row.version,
    changes: diffFields({} as BauHandoverRow, row, [...HANDOVER_AUDIT_FIELDS]),
  });
  return id;
}

async function updateHandover(tx: Tx, request: FastifyRequest): Promise<void> {
  const { transformationId, bauHandoverId } = parseHandoverParams(request.params);
  const ctx = await openSustainmentWrite(tx, request, transformationId, BAU_HANDOVER_PREPARE);
  const body = parseBody(bauHandoverUpdate, request.body);
  const expected = requireIfMatch(request);
  const current = await lockHandover(tx, transformationId, bauHandoverId);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  assertEditable(current);
  if (
    current.status === "returned" &&
    body.receivingOwnerUserId !== undefined &&
    body.receivingOwnerUserId !== current.receiving_owner_user_id
  )
    throw RECEIVING_OWNER_FIXED();
  await assertActiveUsers(tx, ctx.organizationId, [
    { id: body.receivingOwnerUserId, pointer: "/receivingOwnerUserId" },
    { id: body.kpiOwnerUserId, pointer: "/kpiOwnerUserId" },
  ]);
  await updateHandoverRow(
    ctx,
    current,
    {
      ...(body.receivingOwnerUserId !== undefined ? { receiving_owner_user_id: body.receivingOwnerUserId } : {}),
      ...(body.kpiOwnerUserId !== undefined ? { kpi_owner_user_id: body.kpiOwnerUserId } : {}),
      ...(body.operatingProcedures !== undefined ? { operating_procedures: body.operatingProcedures } : {}),
      ...(body.capabilityReadiness !== undefined ? { capability_readiness: body.capabilityReadiness } : {}),
      ...(body.unresolvedAcceptedRisks !== undefined
        ? { unresolved_accepted_risks: body.unresolvedAcceptedRisks }
        : {}),
      ...(body.benefitMonitoringCadence !== undefined
        ? { benefit_monitoring_cadence: body.benefitMonitoringCadence }
        : {}),
      ...(body.dataAccess !== undefined ? { data_access: body.dataAccess } : {}),
      ...(body.improvementBacklogSummary !== undefined
        ? { improvement_backlog_summary: body.improvementBacklogSummary }
        : {}),
    },
    "bau_handover.update",
  );
}

async function addEvidence(tx: Tx, request: FastifyRequest): Promise<void> {
  const { transformationId, bauHandoverId } = parseHandoverParams(request.params);
  const ctx = await openSustainmentWrite(tx, request, transformationId, BAU_HANDOVER_PREPARE);
  const { evidenceId } = parseBody(bauHandoverEvidenceAdd, request.body);
  const expected = requireIfMatch(request);
  const current = await lockHandover(tx, transformationId, bauHandoverId);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  assertEditable(current);
  const evidence = await tx
    .selectFrom("evidence")
    .select("id")
    .where("id", "=", evidenceId)
    .where("transformation_id", "=", transformationId)
    .executeTakeFirst();
  if (!evidence)
    throw sustainRule(
      "validation.reference",
      "The referenced record does not exist in this transformation.",
      "/evidenceId",
    );
  const linked = await tx
    .selectFrom("bau_handover_evidence")
    .select("id")
    .where("handover_id", "=", current.id)
    .where("evidence_id", "=", evidenceId)
    .executeTakeFirst();
  if (linked) return; // Already linked: nothing changes (the link is append-only and unique).
  const linkId = uuidv7();
  await tx
    .insertInto("bau_handover_evidence")
    .values({
      id: linkId,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      handover_id: current.id,
      evidence_id: evidenceId,
      created_by: ctx.userId,
    })
    .execute();
  await record(tx, ctx.audit, {
    action: "bau_handover_evidence.create",
    recordType: "bau_handover_evidence",
    recordId: linkId,
    organizationId: ctx.organizationId,
    transformationId,
    changes: { handover_id: { from: null, to: current.id }, evidence_id: { from: null, to: evidenceId } },
  });
  // The handover's own version steps, so a client's If-Match sees the new evidence list.
  await updateHandoverRow(ctx, current, {}, "bau_handover.evidence_add");
}

async function submitHandover(tx: Tx, request: FastifyRequest): Promise<void> {
  const { transformationId, bauHandoverId } = parseHandoverParams(request.params);
  const ctx = await openSustainmentWrite(tx, request, transformationId, BAU_HANDOVER_PREPARE);
  const expected = requireIfMatch(request);
  const current = await lockHandover(tx, transformationId, bauHandoverId);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status === "accepted") throw HANDOVER_ACCEPTED_FINAL();
  if (current.status !== "draft" && current.status !== "returned")
    throw HANDOVER_TRANSITION(current.status, "submitted");
  const facts = (await factsOf(tx, [current])).get(current.id)!;
  const missing = missingItemsOf(current, facts);
  if (missing.length > 0) throw handoverIncomplete(missing);
  const updated = await updateHandoverRow(
    ctx,
    current,
    { status: "submitted", submitted_at: sql<Date>`now()`, submitted_by: ctx.userId },
    "bau_handover.submit",
  );
  const area = await findArea(tx, transformationId, current.performance_area_id);
  await createWorkItemOnce(tx, userActor(ctx), {
    organizationId: ctx.organizationId,
    transformationId,
    kind: HANDOVER_TASK_KIND,
    assigneeUserId: updated.receiving_owner_user_id,
    subjectType: "bau_handover",
    subjectId: updated.id,
    linkPath: `/transformations/${transformationId}/bau-handovers/${updated.id}`,
    messageKey: "sustainment.task.bau_handover_to_accept",
    messageParams: { handoverCode: updated.code, areaCode: area.code, areaName: area.name },
    dedupeKey: `sustainment.handover:${updated.id}:${updated.version}`,
  });
}

/** The gate of accept/return: bau_handover.accept at commit time, technical-admin-only callers 403 (REQ-S10-003). */
async function openDecision(tx: Tx, request: FastifyRequest, transformationId: string): Promise<WriteContext> {
  return openSustainmentWrite(tx, request, transformationId, BAU_HANDOVER_ACCEPT, BAU_HANDOVER_ACCEPT);
}

async function closeHandoverTasks(ctx: WriteContext, handoverId: string): Promise<void> {
  await closeWorkItemsOfSubject(
    ctx.tx,
    userActor(ctx),
    {
      organizationId: ctx.organizationId,
      subjectType: "bau_handover",
      subjectId: handoverId,
      kinds: [HANDOVER_TASK_KIND],
    },
    "done",
  );
}

/**
 * Routine ownership transfer on acceptance (ADR-0034 §5, M0237): every non-archived KPI linked to the area gets the
 * handover's KPI owner; every active control of the area without an owner gets the receiving owner; every non-archived
 * benefit linked to the area without a BAU owner gets the receiving owner and, where the benefit vocabulary has it, the
 * monitoring cadence as its control cadence. Each changed row: version + 1 and its audit event.
 */
async function transferOwnership(ctx: WriteContext, h: BauHandoverRow): Promise<void> {
  const tx = ctx.tx;
  const links = await tx
    .selectFrom("performance_area_link")
    .select(["link_kind", "kpi_definition_id", "benefit_id"])
    .where("performance_area_id", "=", h.performance_area_id)
    .where("status", "=", "active")
    .execute();
  const kpiIds = links.flatMap((l) => (l.kpi_definition_id !== null ? [l.kpi_definition_id] : []));
  const benefitIds = links.flatMap((l) => (l.benefit_id !== null ? [l.benefit_id] : []));
  const kpiOwner = h.kpi_owner_user_id!;
  if (kpiIds.length > 0) {
    const kpis = await tx
      .selectFrom("kpi_definition")
      .select(["id", "owner_user_id", "version"])
      .where("id", "in", kpiIds)
      .where("status", "<>", "archived")
      .where((eb) => eb.or([eb("owner_user_id", "is", null), eb("owner_user_id", "<>", kpiOwner)]))
      .forUpdate()
      .execute();
    for (const k of kpis) {
      const u = await tx
        .updateTable("kpi_definition")
        .set({
          owner_user_id: kpiOwner,
          version: sql<number>`version + 1`,
          updated_at: sql<Date>`now()`,
          updated_by: ctx.userId,
        })
        .where("id", "=", k.id)
        .where("version", "=", k.version)
        .returning("version")
        .executeTakeFirstOrThrow();
      await record(tx, ctx.audit, {
        action: "kpi_definition.ownership_transfer",
        recordType: "kpi_definition",
        recordId: k.id,
        organizationId: ctx.organizationId,
        transformationId: ctx.transformationId,
        priorVersion: k.version,
        newVersion: u.version,
        changes: { owner_user_id: { from: k.owner_user_id, to: kpiOwner } },
      });
    }
  }
  const controls = await tx
    .selectFrom("control")
    .select(["id", "version"])
    .where("performance_area_id", "=", h.performance_area_id)
    .where("status", "=", "active")
    .where("owner_user_id", "is", null)
    .forUpdate()
    .execute();
  for (const c of controls) {
    const u = await tx
      .updateTable("control")
      .set({
        owner_user_id: h.receiving_owner_user_id,
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`,
        updated_by: ctx.userId,
      })
      .where("id", "=", c.id)
      .where("version", "=", c.version)
      .returning("version")
      .executeTakeFirstOrThrow();
    await record(tx, ctx.audit, {
      action: "control.ownership_transfer",
      recordType: "control",
      recordId: c.id,
      organizationId: ctx.organizationId,
      transformationId: ctx.transformationId,
      priorVersion: c.version,
      newVersion: u.version,
      changes: { owner_user_id: { from: null, to: h.receiving_owner_user_id } },
    });
  }
  if (benefitIds.length > 0) {
    const cadence = BENEFIT_CADENCE.get(h.benefit_monitoring_cadence ?? "") ?? null;
    const benefits = await tx
      .selectFrom("benefit")
      .select(["id", "version", "control_cadence"])
      .where("id", "in", benefitIds)
      .where("status", "<>", "archived")
      .where("bau_owner_user_id", "is", null)
      .forUpdate()
      .execute();
    for (const b of benefits) {
      const setCadence = cadence !== null && b.control_cadence !== cadence;
      const u = await tx
        .updateTable("benefit")
        .set({
          bau_owner_user_id: h.receiving_owner_user_id,
          ...(setCadence ? { control_cadence: cadence } : {}),
          version: sql<number>`version + 1`,
          updated_at: sql<Date>`now()`,
          updated_by: ctx.userId,
        })
        .where("id", "=", b.id)
        .where("version", "=", b.version)
        .returning("version")
        .executeTakeFirstOrThrow();
      await record(tx, ctx.audit, {
        action: "benefit.ownership_transfer",
        recordType: "benefit",
        recordId: b.id,
        organizationId: ctx.organizationId,
        transformationId: ctx.transformationId,
        priorVersion: b.version,
        newVersion: u.version,
        changes: {
          bau_owner_user_id: { from: null, to: h.receiving_owner_user_id },
          ...(setCadence ? { control_cadence: { from: b.control_cadence, to: cadence } } : {}),
        },
      });
    }
  }
}

async function acceptHandover(tx: Tx, request: FastifyRequest): Promise<void> {
  const { transformationId, bauHandoverId } = parseHandoverParams(request.params);
  const ctx = await openDecision(tx, request, transformationId);
  const { note } = parseBody(sustainmentStatusNote, request.body ?? {});
  const expected = requireIfMatch(request);
  const current = await lockHandover(tx, transformationId, bauHandoverId);
  // Only the receiving owner (never a delegate, D-099; never another holder of bau_handover.accept).
  if (ctx.userId !== current.receiving_owner_user_id) throw NOT_RECEIVING_OWNER();
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status === "accepted") throw HANDOVER_ACCEPTED_FINAL();
  if (current.status !== "submitted") throw HANDOVER_TRANSITION(current.status, "accepted");
  const accepted = await updateHandoverRow(
    ctx,
    current,
    { status: "accepted", accepted_at: sql<Date>`now()`, accepted_by: ctx.userId, acceptance_note: note ?? null },
    "bau_handover.accept",
  );
  const area = await findArea(tx, transformationId, current.performance_area_id, true);
  const nextReviewDate = await businessDatePlusPeriod(
    tx,
    ctx.organizationId,
    area.review_frequency as SustainFrequency,
    area.review_interval,
  );
  const updatedArea = await tx
    .updateTable("performance_area")
    .set({
      status: "bau",
      current_handover_id: accepted.id,
      bau_owner_user_id: accepted.receiving_owner_user_id,
      kpi_owner_user_id: accepted.kpi_owner_user_id,
      next_review_date: nextReviewDate,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", area.id)
    .where("version", "=", area.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "performance_area.bau_accepted",
    recordType: "performance_area",
    recordId: area.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: area.version,
    newVersion: updatedArea.version,
    changes: areaChanges(area, updatedArea as Parameters<typeof areaChanges>[1]),
  });
  await closeHandoverTasks(ctx, accepted.id);
  await transferOwnership(ctx, accepted);
  // The first recurring review for the BAU owner, exactly once (sustainment_review_due_key; REQ-PB-083).
  await scheduleAreaReview(tx, area.id, nextReviewDate, userActor(ctx));
}

async function returnHandover(tx: Tx, request: FastifyRequest): Promise<void> {
  const { transformationId, bauHandoverId } = parseHandoverParams(request.params);
  const ctx = await openDecision(tx, request, transformationId);
  const reason = parseReason(request.body, RETURN_REASON_REQUIRED);
  const expected = requireIfMatch(request);
  const current = await lockHandover(tx, transformationId, bauHandoverId);
  if (ctx.userId !== current.receiving_owner_user_id) throw NOT_RECEIVING_OWNER();
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status === "accepted") throw HANDOVER_ACCEPTED_FINAL();
  if (current.status !== "submitted") throw HANDOVER_TRANSITION(current.status, "returned");
  await updateHandoverRow(
    ctx,
    current,
    { status: "returned", returned_at: sql<Date>`now()`, returned_by: ctx.userId, return_reason: reason },
    "bau_handover.return",
    reason,
  );
  await closeHandoverTasks(ctx, current.id);
}

// ------------------------------------------------------------------------------------------------ routes

const listQuery = z.strictObject({
  cursor: cursorSchema,
  limit: limitSchema,
  performanceAreaId: z.uuid().optional(),
  status: z.enum(["draft", "submitted", "accepted", "returned"]).optional(),
});

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerHandoverRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "transformation.read" as const } };
  const prepare = { access: { permission: BAU_HANDOVER_PREPARE }, consumes: JSON_BODY };
  const prepareBodiless = { access: { permission: BAU_HANDOVER_PREPARE } };
  const decide = { access: { permission: BAU_HANDOVER_ACCEPT }, consumes: JSON_BODY };

  app.get(HANDOVERS, { config: read }, async (request) => {
    const transformationId = parseTransformationParam(request.params);
    const query = parseQuery(listQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({
      table: "bau_handover",
      transformationId,
      performanceAreaId: query.performanceAreaId ?? null,
      status: query.status ?? null,
    });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("bau_handover").selectAll().where("transformation_id", "=", transformationId);
    if (query.performanceAreaId !== undefined) q = q.where("performance_area_id", "=", query.performanceAreaId);
    if (query.status !== undefined) q = q.where("status", "=", query.status);
    if (after) q = q.where("id", ">", String(after[0]));
    const rows = await q
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: await presentHandovers(db, page.items), nextCursor: page.nextCursor };
  });

  app.post(HANDOVERS, { config: prepare }, async (request, reply) => {
    const transformationId = parseTransformationParam(request.params);
    const body = await db.transaction().execute(async (tx) => {
      const id = await createHandover(tx, request);
      return presentHandover(tx, transformationId, id);
    });
    return sendVersioned(reply, 201, body, `${request.url.split("?")[0]!}/${body.id}`);
  });

  app.get(HANDOVER_ITEM, { config: read }, async (request, reply) => {
    const { transformationId, bauHandoverId } = parseHandoverParams(request.params);
    await requireTransformationRead(db, principalOf(request), transformationId);
    return sendVersioned(reply, 200, await presentHandover(db, transformationId, bauHandoverId));
  });

  const action =
    (run: (tx: Tx, request: FastifyRequest) => Promise<void>, status: number) =>
    async (request: FastifyRequest, reply: Parameters<typeof sendVersioned>[0]) => {
      const { transformationId, bauHandoverId } = parseHandoverParams(request.params);
      const body = await db.transaction().execute(async (tx) => {
        await run(tx, request);
        return presentHandover(tx, transformationId, bauHandoverId);
      });
      return sendVersioned(reply, status, body);
    };

  app.patch(HANDOVER_ITEM, { config: prepare }, action(updateHandover, 200));
  app.post(HANDOVER_EVIDENCE, { config: prepare }, action(addEvidence, 201));
  app.post(HANDOVER_SUBMIT, { config: prepareBodiless }, action(submitHandover, 200));
  app.post(HANDOVER_ACCEPT, { config: decide }, action(acceptHandover, 200));
  app.post(HANDOVER_RETURN, { config: decide }, action(returnHandover, 200));

  return [
    `GET ${HANDOVERS}`,
    `POST ${HANDOVERS}`,
    `GET ${HANDOVER_ITEM}`,
    `PATCH ${HANDOVER_ITEM}`,
    `POST ${HANDOVER_EVIDENCE}`,
    `POST ${HANDOVER_SUBMIT}`,
    `POST ${HANDOVER_ACCEPT}`,
    `POST ${HANDOVER_RETURN}`,
  ];
}
