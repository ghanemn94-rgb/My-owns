// KPI restatements (ADR-0047 §2, §6-§9; M0163; REQ-S07-016; p5-work-split §G.1; T-DG5-KBE-E):
//   GET  /transformations/{t}/kpi-definitions/{k}/restatements        newest first (transformation.read)
//   POST /transformations/{t}/kpi-definitions/{k}/restatements        create a draft (kpi_restatement.request)
//   GET  /transformations/{t}/kpi-restatements/{r}                    one, with its periods (transformation.read)
//   GET  /transformations/{t}/kpi-restatements/{r}/reconciliation     draft: computed now (retained: false); from
//                                                                     submission on: the retained rows (retained: true)
//   POST /transformations/{t}/kpi-restatements/{r}/submit             retain the reconciliation, submit, decision tasks
//   POST /transformations/{t}/kpi-restatements/{r}/withdraw           the requester withdraws a draft or submitted one
// The decision (decideKpiRestatement, restatement-decisions.ts) and the reissue offers (listKpiRestatementReissueOffers,
// restatement-offers.ts) are KBE-E2's, registered from here (T-DG5-KBE-E2).
//
// - A restatement applies one APPROVED version (active or superseded) of the KPI to explicitly selected CLOSED
//   reporting periods of the version's frequency (1-24). An open period takes the new version prospectively (§1).
// - At most one restatement per KPI is in progress (draft, submitted or approved): 409 kpi_restatement.open_exists,
//   under the `kpiRestatement` advisory lock (key: the KPI id), which the 0085 guard also takes, before any read the
//   decision depends on; the unique index kpi_restatement_one_open_key is the backstop.
// - Submission, in ONE transaction under the lock: the reconciliation rows (restatement-reconciliation.ts), then the
//   status `submitted`, then one `kpi_restatement_to_decide` work item per holder of kpi_restatement.approve in the
//   transformation except the requester (createWorkItemOnce, dedupe kpi_restatement:<restatementId>:<userId>). The
//   retained rows are exactly the preview computed in that transaction, and are never recomputed afterwards.
// - Every mutation: commit-time authorization (openWrite atCommit), validation, If-Match on submit and withdraw
//   (428/409; the create is version 1), exactly one audit event on kpi_restatement in the same transaction (the
//   append-only children carry none of their own, ADR-0047 §6), no remote I/O inside the transaction.
// - Deciding a restatement is a business approval inside the product (KBE-E2), never DG0-DG7; nothing here decides.
import { diffFields, sql, type KpiRestatementRow, type Tx } from "@mth/db";
import { PROBLEM_TYPES } from "@mth/shared";
import {
  KPI_RESTATEMENT_MAX_PERIODS,
  kpiRestatementCreate,
  type KpiRestatement,
  type KpiRestatementCreate,
  type KpiRestatementReconciliation,
} from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  grantApplies,
  loadGrants,
  principalOf,
  requireTransformationRead,
  type ResolvedTarget,
} from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  ADVISORY_LOCK_CLASSES,
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
import { openWrite, type WriteContext } from "../transformations/index.ts";
import {
  computeReconciliation,
  fromStoredRow,
  toReconciliationRow,
  type ReconciliationRowData,
} from "./restatement-reconciliation.ts";
import { registerKpiRestatementDecisionRoutes } from "./restatement-decisions.ts";
import { registerKpiRestatementOfferRoutes } from "./restatement-offers.ts";
import { ruleProblem } from "./support.ts";

const JSON_BODY = ["application/json"] as const;
const T_BASE = "/api/v1/transformations/:transformationId";
const KPI_RESTATEMENTS = `${T_BASE}/kpi-definitions/:kpiDefinitionId/restatements`;
const ITEM = `${T_BASE}/kpi-restatements/:restatementId`;
const REQUEST = "kpi_restatement.request" as const;
const APPROVE = "kpi_restatement.approve" as const;
/** The work-item kind of the decision task (0085; My Work "Approvals"). */
export const DECIDE_KIND = "kpi_restatement_to_decide";

const AUDIT_FIELDS = [
  "kpi_definition_id",
  "kpi_version_id",
  "change_request_id",
  "reason",
  "status",
  "requested_by",
  "submitted_at",
  "period_count",
  "reconciliation_count",
  "withdrawn_at",
  "withdrawn_by",
] as const satisfies readonly (keyof KpiRestatementRow)[];

const definitionParams = z.strictObject({ transformationId: z.uuid(), kpiDefinitionId: z.uuid() });
const itemParams = z.strictObject({ transformationId: z.uuid(), restatementId: z.uuid() });
const listQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });

/** The ADR-0047 §8 refusals of this slice, with their exact English texts (KBE-E2 reuses the decision ones). */
export const restatementRefusals = {
  noAuthority: () =>
    new HttpProblem({
      status: 403,
      type: PROBLEM_TYPES.forbidden,
      code: "kpi_restatement.no_authority",
      title: "Forbidden",
      detail: "Only a person who holds the restatement approval right in this transformation can decide a restatement.",
    }),
  selfDecision: () =>
    new HttpProblem({
      status: 403,
      type: PROBLEM_TYPES.forbidden,
      code: "kpi_restatement.self_decision",
      title: "Forbidden",
      detail: "The requester of a restatement cannot decide it.",
    }),
  openExists: () =>
    problems.duplicate("kpi_restatement.open_exists", "This KPI already has a restatement in progress."),
  versionNotApproved: () =>
    ruleProblem({
      code: "kpi_restatement.version_not_approved",
      detail: "A restatement applies an approved KPI version (active or superseded) of this KPI.",
      pointer: "/kpiVersionId",
    }),
  periodsRequired: () =>
    ruleProblem({
      code: "kpi_restatement.periods_required",
      detail: "Select at least one closed reporting period to restate.",
      pointer: "/reportingPeriodIds",
    }),
  tooManyPeriods: () =>
    ruleProblem({
      code: "kpi_restatement.too_many_periods",
      detail: "A restatement covers at most 24 reporting periods.",
      pointer: "/reportingPeriodIds",
    }),
  periodNotClosed: (index: number) =>
    ruleProblem({
      code: "kpi_restatement.period_not_closed",
      detail:
        "Only closed reporting periods of the KPI's frequency can be restated; an open period takes the new version from now on.",
      pointer: `/reportingPeriodIds/${index}`,
    }),
  nothingToReconcile: (pointer = "") =>
    ruleProblem({
      code: "kpi_restatement.nothing_to_reconcile",
      detail: "None of the selected periods has a value to restate.",
      pointer,
    }),
  notDraft: () =>
    ruleProblem({
      code: "kpi_restatement.not_draft",
      detail: "Only a draft restatement can be changed or submitted.",
      pointer: "",
    }),
  notSubmitted: () =>
    ruleProblem({
      code: "kpi_restatement.not_submitted",
      detail: "Only a submitted restatement can be decided.",
      pointer: "",
    }),
  notWithdrawable: () =>
    ruleProblem({
      code: "kpi_restatement.not_withdrawable",
      detail: "A decided restatement cannot be withdrawn.",
      pointer: "",
    }),
  noteRequired: () =>
    ruleProblem({ code: "kpi_restatement.note_required", detail: "A rejection needs a note.", pointer: "/note" }),
} as const;

// ------------------------------------------------------------------------------------------------ mapping

export interface PeriodRef {
  readonly reportingPeriodId: string;
  readonly periodLabel: string;
}

export function toKpiRestatement(r: KpiRestatementRow, periods: readonly PeriodRef[]): KpiRestatement {
  return {
    id: r.id,
    transformationId: r.transformation_id,
    kpiDefinitionId: r.kpi_definition_id,
    kpiVersionId: r.kpi_version_id,
    changeRequestId: r.change_request_id,
    reason: r.reason,
    status: r.status as KpiRestatement["status"],
    periods: [...periods],
    requestedBy: r.requested_by,
    submittedAt: isoOrNull(r.submitted_at),
    decidedBy: r.decided_by,
    decidedAt: isoOrNull(r.decided_at),
    decisionNote: r.decision_note,
    authorityPermission: r.authority_permission as KpiRestatement["authorityPermission"],
    authorityRoleCode: r.authority_role_code,
    calculationRunId: r.calculation_run_id,
    appliedAt: isoOrNull(r.applied_at),
    withdrawnAt: isoOrNull(r.withdrawn_at),
    withdrawnBy: r.withdrawn_by,
    version: r.version,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

/** The selected periods of restatements, by restatement id, in period order. */
export async function periodsOf(db: Tx | ModuleDeps["db"], ids: readonly string[]): Promise<Map<string, PeriodRef[]>> {
  const out = new Map<string, PeriodRef[]>(ids.map((id) => [id, []]));
  if (ids.length === 0) return out;
  const rows = await db
    .selectFrom("kpi_restatement_period as p")
    .innerJoin("reporting_period as rp", "rp.id", "p.reporting_period_id")
    .select(["p.restatement_id", "p.reporting_period_id", "p.period_label"])
    .where("p.restatement_id", "in", [...ids])
    .orderBy("rp.period_start")
    .orderBy("p.reporting_period_id")
    .execute();
  for (const r of rows)
    out.get(r.restatement_id)!.push({ reportingPeriodId: r.reporting_period_id, periodLabel: r.period_label });
  return out;
}

async function present(db: Tx | ModuleDeps["db"], row: KpiRestatementRow): Promise<KpiRestatement> {
  return toKpiRestatement(row, (await periodsOf(db, [row.id])).get(row.id)!);
}

// ------------------------------------------------------------------------------------------------ helpers

/** The `kpiRestatement` advisory lock on one KPI (the 0085 guard takes the same lock on every write). */
export async function lockKpiRestatements(tx: Tx, kpiDefinitionId: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.kpiRestatement}::integer, hashtext(${kpiDefinitionId}::text))`.execute(
    tx,
  );
}

const actor = (ctx: WriteContext) =>
  ({ actorType: "user", actorUserId: ctx.userId, requestId: ctx.audit.requestId, source: "api" }) as const;

/** The active people holding kpi_restatement.approve on the transformation, sorted (technical admins hold none). */
export async function restatementApprovers(db: Tx, target: ResolvedTarget): Promise<string[]> {
  const candidates = await db
    .selectFrom("scoped_assignment as a")
    .innerJoin("app_user as u", "u.id", "a.user_id")
    .select("a.user_id")
    .distinct()
    .where("a.organization_id", "=", target.organizationId)
    .where("a.revoked_at", "is", null)
    .where("u.status", "=", "active")
    .execute();
  const out: string[] = [];
  for (const userId of candidates.map((c) => c.user_id).sort()) {
    const grants = await loadGrants(db, userId);
    if (grants.some((g) => grantApplies(g, APPROVE, target))) out.push(userId);
  }
  return out;
}

/** The restatement of the transformation, locked for update after the KPI's restatement lock (404 when absent). */
async function lockedRestatement(ctx: WriteContext, id: string): Promise<KpiRestatementRow> {
  const probe = await ctx.tx
    .selectFrom("kpi_restatement")
    .select("kpi_definition_id")
    .where("transformation_id", "=", ctx.transformationId)
    .where("id", "=", id)
    .executeTakeFirst();
  if (!probe) throw problems.notFound();
  await lockKpiRestatements(ctx.tx, probe.kpi_definition_id);
  return ctx.tx.selectFrom("kpi_restatement").selectAll().where("id", "=", id).forUpdate().executeTakeFirstOrThrow();
}

async function audit(
  ctx: WriteContext,
  action: string,
  before: KpiRestatementRow | null,
  after: KpiRestatementRow,
  reason?: string,
): Promise<void> {
  await record(ctx.tx, ctx.audit, {
    action,
    recordType: "kpi_restatement",
    recordId: after.id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    ...(before ? { priorVersion: before.version } : {}),
    newVersion: after.version,
    ...(reason !== undefined ? { reason } : {}),
    changes: diffFields(before ?? ({} as KpiRestatementRow), after, [...AUDIT_FIELDS]),
  });
}

// ------------------------------------------------------------------------------------------------ create

async function createRestatement(
  ctx: WriteContext,
  kpiDefinitionId: string,
  b: KpiRestatementCreate,
): Promise<KpiRestatementRow> {
  const { tx } = ctx;
  const def = await tx
    .selectFrom("kpi_definition")
    .select(["id", "frequency"])
    .where("transformation_id", "=", ctx.transformationId)
    .where("id", "=", kpiDefinitionId)
    .executeTakeFirst();
  if (!def) throw problems.notFound();
  await lockKpiRestatements(tx, def.id);
  // The version: an approved (active or superseded) version of THIS KPI.
  const version = await tx
    .selectFrom("kpi_version")
    .select(["id", "status", "frequency"])
    .where("transformation_id", "=", ctx.transformationId)
    .where("kpi_definition_id", "=", def.id)
    .where("id", "=", b.kpiVersionId)
    .executeTakeFirst();
  if (!version || (version.status !== "active" && version.status !== "superseded"))
    throw restatementRefusals.versionNotApproved();
  // The periods: 1-24, each a closed period of the version's frequency in this organization.
  if (b.reportingPeriodIds.length === 0) throw restatementRefusals.periodsRequired();
  if (b.reportingPeriodIds.length > KPI_RESTATEMENT_MAX_PERIODS) throw restatementRefusals.tooManyPeriods();
  const periods = await tx
    .selectFrom("reporting_period")
    .select(["id", "status", "frequency", "period_label"])
    .where("organization_id", "=", ctx.organizationId)
    .where("id", "in", [...b.reportingPeriodIds])
    .execute();
  const byId = new Map(periods.map((p) => [p.id, p]));
  b.reportingPeriodIds.forEach((id, i) => {
    if (!byId.has(id))
      throw ruleProblem({
        code: "validation.reference",
        detail: "The referenced record does not exist in this transformation.",
        pointer: `/reportingPeriodIds/${i}`,
      });
  });
  b.reportingPeriodIds.forEach((id, i) => {
    const p = byId.get(id)!;
    if (p.status !== "closed" || p.frequency !== version.frequency) throw restatementRefusals.periodNotClosed(i);
  });
  // The change request, when named: the approved KPI change request that applied this version.
  if (b.changeRequestId !== undefined && b.changeRequestId !== null) {
    const cr = await tx
      .selectFrom("change_request")
      .select(["id"])
      .where("transformation_id", "=", ctx.transformationId)
      .where("id", "=", b.changeRequestId)
      .where("status", "=", "approved")
      .where("applied_record_type", "=", "kpi_version")
      .where("applied_record_id", "=", version.id)
      .executeTakeFirst();
    if (!cr)
      throw ruleProblem({
        code: "validation.reference",
        detail: "The change request must be the approved KPI change request that applied this version.",
        pointer: "/changeRequestId",
      });
  }
  // One restatement in progress per KPI (checked under the lock; kpi_restatement_one_open_key is the backstop).
  const open = await tx
    .selectFrom("kpi_restatement")
    .select("id")
    .where("kpi_definition_id", "=", def.id)
    .where("status", "in", ["draft", "submitted", "approved"])
    .executeTakeFirst();
  if (open) throw restatementRefusals.openExists();
  const id = uuidv7();
  const row = await tx
    .insertInto("kpi_restatement")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: ctx.transformationId,
      kpi_definition_id: def.id,
      kpi_version_id: version.id,
      change_request_id: b.changeRequestId ?? null,
      reason: b.reason,
      requested_by: ctx.userId,
      period_count: b.reportingPeriodIds.length,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  for (const pid of b.reportingPeriodIds)
    await tx
      .insertInto("kpi_restatement_period")
      .values({
        id: uuidv7(),
        organization_id: ctx.organizationId,
        transformation_id: ctx.transformationId,
        restatement_id: id,
        reporting_period_id: pid,
        period_label: byId.get(pid)!.period_label,
      })
      .execute();
  await audit(ctx, "kpi_restatement.create", null, row, b.reason);
  return row;
}

// ------------------------------------------------------------------------------------------------ reconciliation

const reconciliationInput = (r: KpiRestatementRow, periods: readonly PeriodRef[]) => ({
  organizationId: r.organization_id,
  kpiDefinitionId: r.kpi_definition_id,
  kpiVersionId: r.kpi_version_id,
  periods: periods.map((p) => ({ id: p.reportingPeriodId, label: p.periodLabel })),
});

/** The retained rows of a submitted (or later) restatement, in the preview's order. */
async function retainedRows(
  db: Tx,
  r: KpiRestatementRow,
  periods: readonly PeriodRef[],
): Promise<ReconciliationRowData[]> {
  const def = await db
    .selectFrom("kpi_definition")
    .select("unit_kind")
    .where("id", "=", r.kpi_definition_id)
    .executeTakeFirstOrThrow();
  const rows = await db
    .selectFrom("kpi_restatement_reconciliation as c")
    .innerJoin("reporting_period as rp", "rp.id", "c.reporting_period_id")
    .selectAll("c")
    .where("c.restatement_id", "=", r.id)
    .orderBy("rp.period_start")
    .orderBy("c.scope_kind")
    .orderBy("c.scope_id")
    .orderBy(sql`CASE c.value_basis WHEN 'period' THEN 0 ELSE 1 END`)
    .execute();
  const labels = new Map(periods.map((p) => [p.reportingPeriodId, p.periodLabel]));
  return rows.map((c) =>
    fromStoredRow(c, labels.get(c.reporting_period_id) ?? "", def.unit_kind as ReconciliationRowData["unitKind"]),
  );
}

// ------------------------------------------------------------------------------------------------ submit, withdraw

async function submitRestatement(ctx: WriteContext, id: string, expected: number): Promise<KpiRestatementRow> {
  const { tx } = ctx;
  const current = await lockedRestatement(ctx, id);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status !== "draft") throw restatementRefusals.notDraft();
  const periods = (await periodsOf(tx, [current.id])).get(current.id)!;
  const rows = await computeReconciliation(tx, reconciliationInput(current, periods));
  if (rows.length === 0) throw restatementRefusals.nothingToReconcile();
  // Every selected period needs at least one row (kpi_restatement_reconciled); the first one without is named.
  const index = periods.findIndex((p) => !rows.some((r) => r.reportingPeriodId === p.reportingPeriodId));
  if (index >= 0) throw restatementRefusals.nothingToReconcile(`/periods/${index}`);
  // 1. the reconciliation rows (the restatement is still a draft: kpi_restatement_reconciliation_at_submit) ...
  for (const r of rows)
    await tx
      .insertInto("kpi_restatement_reconciliation")
      .values({
        id: uuidv7(),
        organization_id: current.organization_id,
        transformation_id: current.transformation_id,
        restatement_id: current.id,
        reporting_period_id: r.reportingPeriodId,
        scope_kind: r.scopeKind,
        scope_id: r.scopeId,
        value_basis: r.valueBasis,
        before_evaluation_id: r.before.evaluationId,
        before_kpi_version_id: r.before.kpiVersionId,
        before_value: r.before.value,
        before_value_status: r.before.valueStatus,
        before_rag: r.before.rag,
        before_target: r.before.target,
        after_value: r.after.value,
        after_value_status: r.after.valueStatus,
        after_rag: r.after.rag,
        after_target: r.after.target,
        difference: r.difference,
        currency: r.currency,
      })
      .execute();
  // 2. ... then the status (the guard stamps submitted_at with this transaction's time, equal to the rows' created_at)
  const updated = await tx
    .updateTable("kpi_restatement")
    .set({
      status: "submitted",
      reconciliation_count: rows.length,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await audit(ctx, "kpi_restatement.submit", current, updated);
  // 3. ... and the decision tasks: every holder of kpi_restatement.approve except the requester (D-142 Q10).
  const kpi = await tx
    .selectFrom("kpi_definition")
    .select("name")
    .where("id", "=", current.kpi_definition_id)
    .executeTakeFirstOrThrow();
  for (const userId of await restatementApprovers(tx, ctx.target))
    if (userId !== current.requested_by)
      await createWorkItemOnce(tx, actor(ctx), {
        organizationId: ctx.organizationId,
        transformationId: ctx.transformationId,
        kind: DECIDE_KIND,
        assigneeUserId: userId,
        subjectType: "kpi_restatement",
        subjectId: current.id,
        linkPath: `/transformations/${ctx.transformationId}/kpi-restatements/${current.id}`,
        messageKey: "kpi_restatement.to_decide",
        messageParams: { kpiName: kpi.name, periodCount: periods.length },
        dedupeKey: `kpi_restatement:${current.id}:${userId}`,
      });
  return updated;
}

async function withdrawRestatement(ctx: WriteContext, id: string, expected: number): Promise<KpiRestatementRow> {
  const { tx } = ctx;
  const current = await lockedRestatement(ctx, id);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  // Only the requester withdraws (the contract's "the requester"); audited like any other denial.
  if (current.requested_by !== ctx.userId)
    throw problems.forbidden("Only the requester of a restatement can withdraw it.").withDenial({
      permission: REQUEST,
      recordType: "kpi_restatement",
      recordId: current.id,
      organizationId: ctx.organizationId,
      transformationId: ctx.transformationId,
    });
  if (current.status !== "draft" && current.status !== "submitted") throw restatementRefusals.notWithdrawable();
  const updated = await tx
    .updateTable("kpi_restatement")
    .set({
      status: "withdrawn",
      withdrawn_at: sql<Date>`now()`,
      withdrawn_by: ctx.userId,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await audit(ctx, "kpi_restatement.withdraw", current, updated);
  // The open decision tasks of a submitted restatement are cancelled with it.
  if (current.status === "submitted")
    await closeWorkItemsOfSubject(
      tx,
      actor(ctx),
      {
        organizationId: ctx.organizationId,
        subjectType: "kpi_restatement",
        subjectId: current.id,
        kinds: [DECIDE_KIND],
      },
      "cancelled",
    );
  return updated;
}

// ------------------------------------------------------------------------------------------------ routes

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerKpiRestatementRoutes(app: FastifyInstance, deps: ModuleDeps): string[] {
  const { db } = deps;
  const read = { access: { permission: "transformation.read" as const } };
  const write = (body: boolean) => ({ access: { permission: REQUEST }, ...(body ? { consumes: JSON_BODY } : {}) });

  app.get(KPI_RESTATEMENTS, { config: read }, async (request) => {
    const { transformationId, kpiDefinitionId } = parse(definitionParams, request.params, "params");
    const query = parseQuery(listQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const def = await db
      .selectFrom("kpi_definition")
      .select("id")
      .where("transformation_id", "=", transformationId)
      .where("id", "=", kpiDefinitionId)
      .executeTakeFirst();
    if (!def) throw problems.notFound();
    const hash = filterHash({ list: "kpi-restatements", transformationId, kpiDefinitionId });
    const after = decodeCursor(query.cursor, hash, 1);
    // Ids are UUIDv7 (time-ordered), so id order is creation order: newest first.
    let q = db.selectFrom("kpi_restatement").selectAll().where("kpi_definition_id", "=", def.id);
    if (after) q = q.where("id", "<", String(after[0]));
    const rows = await q
      .orderBy("id", "desc")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    const periods = await periodsOf(
      db,
      page.items.map((r) => r.id),
    );
    return { items: page.items.map((r) => toKpiRestatement(r, periods.get(r.id)!)), nextCursor: page.nextCursor };
  });

  app.post(KPI_RESTATEMENTS, { config: write(true) }, async (request, reply) => {
    const { transformationId, kpiDefinitionId } = parse(definitionParams, request.params, "params");
    const body = await db.transaction().execute(async (tx) => {
      const ctx = await openWrite(tx, request, transformationId, [{ permission: REQUEST }], null, { atCommit: true });
      const b = parseBody(kpiRestatementCreate, request.body);
      return present(tx, await createRestatement(ctx, kpiDefinitionId, b));
    });
    return sendVersioned(reply, 201, body, `/api/v1/transformations/${transformationId}/kpi-restatements/${body.id}`);
  });

  app.get(ITEM, { config: read }, async (request, reply) => {
    const { transformationId, restatementId } = parse(itemParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    const row = await db
      .selectFrom("kpi_restatement")
      .selectAll()
      .where("transformation_id", "=", transformationId)
      .where("id", "=", restatementId)
      .executeTakeFirst();
    if (!row) throw problems.notFound();
    return sendVersioned(reply, 200, await present(db, row));
  });

  app.get(`${ITEM}/reconciliation`, { config: read }, async (request): Promise<KpiRestatementReconciliation> => {
    const { transformationId, restatementId } = parse(itemParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    // One repeatable-read, read-only snapshot: the preview reads many tables and must see one state of them.
    return db
      .transaction()
      .setIsolationLevel("repeatable read")
      .setAccessMode("read only")
      .execute(async (tx) => {
        const row = await tx
          .selectFrom("kpi_restatement")
          .selectAll()
          .where("transformation_id", "=", transformationId)
          .where("id", "=", restatementId)
          .executeTakeFirst();
        if (!row) throw problems.notFound();
        const periods = (await periodsOf(tx, [row.id])).get(row.id)!;
        // A draft is computed now and not stored; a restatement withdrawn as a draft retained nothing; from submission
        // on the retained rows are returned as stored, never recomputed (ADR-0047 §2).
        const retained = row.submitted_at !== null;
        const rows =
          row.status === "draft"
            ? await computeReconciliation(tx, reconciliationInput(row, periods))
            : retained
              ? await retainedRows(tx, row, periods)
              : [];
        return { restatementId: row.id, retained, rows: rows.map(toReconciliationRow) };
      });
  });

  app.post(`${ITEM}/submit`, { config: write(false) }, async (request, reply) => {
    const { transformationId, restatementId } = parse(itemParams, request.params, "params");
    const body = await db.transaction().execute(async (tx) => {
      const ctx = await openWrite(tx, request, transformationId, [{ permission: REQUEST }], null, { atCommit: true });
      const expected = requireIfMatch(request);
      return present(tx, await submitRestatement(ctx, restatementId, expected));
    });
    return sendVersioned(reply, 200, body);
  });

  app.post(`${ITEM}/withdraw`, { config: write(false) }, async (request, reply) => {
    const { transformationId, restatementId } = parse(itemParams, request.params, "params");
    const body = await db.transaction().execute(async (tx) => {
      const ctx = await openWrite(tx, request, transformationId, [{ permission: REQUEST }], null, { atCommit: true });
      const expected = requireIfMatch(request);
      return present(tx, await withdrawRestatement(ctx, restatementId, expected));
    });
    return sendVersioned(reply, 200, body);
  });

  return [
    `GET ${KPI_RESTATEMENTS}`,
    `POST ${KPI_RESTATEMENTS}`,
    `GET ${ITEM}`,
    `GET ${ITEM}/reconciliation`,
    `POST ${ITEM}/submit`,
    `POST ${ITEM}/withdraw`,
    // T-DG5-KBE-E2: decideKpiRestatement and listKpiRestatementReissueOffers.
    ...registerKpiRestatementDecisionRoutes(app, deps),
    ...registerKpiRestatementOfferRoutes(app, deps),
  ];
}
