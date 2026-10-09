// KPI actuals (ADR-0027 §6, §8, §11-§13; REQ-S07-003, REQ-S07-006, REQ-S07-012, REQ-S07-013, REQ-S07-017,
// REQ-S12-006; T-DG4-KBE-C):
//   GET  /transformations/{t}/kpi-definitions/{k}/actuals        slots of a KPI, latest period first (transformation.read)
//   POST /transformations/{t}/kpi-definitions/{k}/actuals        the routine update: first value of a slot (kpi_actual.submit)
//   GET  /transformations/{t}/kpi-actuals/{a}                    one slot with every value, review and evidence link
//   POST /transformations/{t}/kpi-actuals/{a}/values             a new value version (kpi_actual.submit; If-Match)
//   POST /transformations/{t}/kpi-actuals/{a}/submit             submit the current draft (kpi_actual.submit; If-Match)
//   POST /transformations/{t}/kpi-actuals/{a}/accept             accept the submitted value (kpi_actual.accept; If-Match)
//   POST /transformations/{t}/kpi-actuals/{a}/reject             reject it with a reason (kpi_actual.accept; If-Match)
//   GET  /transformations/{t}/kpi-actual-reviews                 submitted values the caller may decide, oldest first
//
// - One SLOT per KPI, scope and reporting period: a second entry is value version 2 of the same slot (REQ-S07-003); the
//   routine-update POST on an existing slot is 409 (version conflict, with the slot's version: use the values route).
// - Every P4 use reads the KPI's ACTIVE version (422 kpi_actual.no_active_version); its submission_route decides:
//   review -> submitted, used only once a reviewer accepts it; direct_accept -> accepted at once (REQ-S07-012).
// - Missing data is explicit: "not available" is missing_reason with every value field NULL (Unknown, never 0).
// - Values are decimal strings in numeric(24,6); a currency other than the KPI's is refused, never converted.
// - Only the slot is audited: each user action (save draft, submit, add value, accept, reject) writes exactly ONE audit
//   event on kpi_actual, with the value, review and evidence rows in the same transaction (ADR-0027 §6). An accept
//   writes one kpi.actual_accepted outbox event (accept-pipeline.ts); the worker writes the calculation run.
// - Review tasks (kpi_actual_review) go to the people the version's reviewer party resolves to through the role
//   mapping who hold kpi_actual.accept (422 routing.role_unmapped when unmapped, nothing written); a rejection gives the
//   submitter a correction task (kpi_actual_rejected). Both through createWorkItemOnce (S-13).
// - Every mutation: authorization re-checked at commit time, validation, If-Match (428/409; creates are version 1), one
//   audit event, no remote I/O in the transaction (S-4).
import {
  diffFields,
  sql,
  type DbOrTx,
  type KpiActualRow,
  type KpiVersionRow,
  type ReportingPeriodRow,
  type Tx,
} from "@mth/db";
import { PROBLEM_TYPES } from "@mth/shared";
import {
  canonicalDecimal,
  freeText,
  KPI_ACTUAL_STATUSES,
  KPI_SCOPE_KINDS,
  kpiActualDecision,
  kpiActualEntry,
  kpiActualValueEntry,
  type KpiActual,
  type KpiActualSubmission,
  type KpiActualValueEntry,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  currentGroupMemberIds,
  decide,
  effectiveGroupIds,
  loadGrants,
  partyLabel,
  principalOf,
  requireTransformationRead,
  resolveParty,
  routingRefusals,
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
  type ModuleDeps,
} from "../platform/index.ts";
import { closeWorkItemsOfSubject, createWorkItemOnce } from "../tasks/index.ts";
import { openWrite, type WriteContext } from "../transformations/index.ts";
import { enqueueActualAccepted, insertReview, type Decider } from "./accept-pipeline.ts";
import { downstreamOf } from "./downstream.ts";
import type { KpiDefinitionRow } from "./repository.ts";
import { ruleProblem } from "./support.ts";

const JSON_BODY = ["application/json"] as const;
const T_BASE = "/api/v1/transformations/:transformationId";
const DEF_ACTUALS = `${T_BASE}/kpi-definitions/:kpiDefinitionId/actuals`;
const ACTUAL_ITEM = `${T_BASE}/kpi-actuals/:kpiActualId`;
const REVIEW_QUEUE = `${T_BASE}/kpi-actual-reviews`;
const SUBMIT = "kpi_actual.submit" as const;
const ACCEPT = "kpi_actual.accept" as const;

const definitionParams = z.strictObject({ transformationId: z.uuid(), kpiDefinitionId: z.uuid() });
const actualParams = z.strictObject({ transformationId: z.uuid(), kpiActualId: z.uuid() });
const listQuery = z.strictObject({
  cursor: cursorSchema,
  limit: limitSchema,
  scopeKind: z.enum(KPI_SCOPE_KINDS).optional(),
  scopeId: z.uuid().optional(),
  reportingPeriodId: z.uuid().optional(),
  status: z.enum(KPI_ACTUAL_STATUSES).optional(),
});
const queueQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });
/** ReasonRequest; a missing or null reason is the business rule's own 422 (ADR-0027 §13), not a 400. */
const rejectBody = z.strictObject({ reason: freeText(3, 1000).nullable().optional() });

// ------------------------------------------------------------------------------------------------ refusals (ADR-0027 §13)

const forbidden = (code: string, detail: string) =>
  new HttpProblem({ status: 403, type: PROBLEM_TYPES.forbidden, code, title: "Forbidden", detail });

export const actualRefusals = {
  noActiveVersion: () =>
    ruleProblem({
      code: "kpi_actual.no_active_version",
      detail: "This KPI has no active version. Activate a version with its aggregation rule before entering actuals.",
      pointer: "",
    }),
  periodNotOpen: (periodLabel: string, status: string) =>
    ruleProblem({
      code: "kpi_actual.period_not_open",
      detail: `The reporting period ${periodLabel} is ${status}. Actuals are entered only for an open period; a closed period is corrected through a restatement.`,
      pointer: "/reportingPeriodId",
    }),
  periodFrequency: (frequency: string) =>
    ruleProblem({
      code: "kpi_actual.period_frequency",
      detail: `A ${frequency} KPI is reported for ${frequency} periods.`,
      pointer: "/reportingPeriodId",
    }),
  scopeKind: (entryScopeKind: string) =>
    ruleProblem({
      code: "kpi_actual.scope_kind",
      detail: `This KPI is reported per ${entryScopeKind}.`,
      pointer: "/scopeKind",
    }),
  scopeInvalid: (scopeKind: string, scopeId: string) =>
    ruleProblem({
      code: "kpi.scope_invalid",
      detail: `The scope ${scopeKind} ${scopeId} is not part of this transformation.`,
      pointer: "/scopeId",
    }),
  currencyMismatch: (currency: string, kpiCurrency: string) =>
    ruleProblem({
      code: "kpi_actual.currency_mismatch",
      detail: `The value is in ${currency}, but the KPI is measured in ${kpiCurrency}. Values are never converted.`,
      pointer: "/currency",
    }),
  valueShape: (expectedFields: string) =>
    ruleProblem({
      code: "kpi_actual.value_shape",
      detail: `Enter ${expectedFields} for this KPI, or state why the value is not available.`,
      pointer: "/value",
    }),
  evidenceRequired: () =>
    ruleProblem({
      code: "kpi_actual.evidence_required",
      detail: "This KPI's data-quality rule requires evidence with every submitted value.",
      pointer: "/evidenceIds",
    }),
  notSubmitted: () =>
    ruleProblem({
      code: "kpi_actual.not_submitted",
      detail: "Only a submitted value can be accepted or rejected.",
      pointer: "",
    }),
  rejectReasonRequired: () =>
    ruleProblem({
      code: "kpi_actual.reject_reason_required",
      detail: "A rejection needs a reason.",
      pointer: "/reason",
    }),
  notOwner: () =>
    forbidden(
      "kpi_actual.not_owner",
      "Only the KPI's owner or steward, or the person assigned its update, can submit its actuals.",
    ),
  notReviewer: () =>
    forbidden("kpi_actual.not_reviewer", "Only the KPI's configured reviewer can accept or reject this actual."),
  sodSubmitter: () =>
    forbidden("kpi_actual.sod_submitter", "You submitted this value, so you cannot accept or reject it."),
} as const;

/** The fields a value of each nature needs (the {expectedFields} of kpi_actual.value_shape). */
const EXPECTED_FIELDS: ReadonlyMap<string, string> = new Map([
  ["flow", "a value"],
  ["stock", "a value"],
  ["ratio", "a numerator and a denominator"],
  ["milestone", "whether the milestone was achieved"],
]);

// ------------------------------------------------------------------------------------------------ presenters

const dec = (v: string | null): string | null => (v === null ? null : canonicalDecimal(v));

/** The slots with their values, evidence links and reviews (each in value-number order). */
export async function presentActuals(db: DbOrTx, rows: readonly KpiActualRow[]): Promise<KpiActual[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [values, evidence, reviews] = await Promise.all([
    db.selectFrom("kpi_actual_value").selectAll().where("kpi_actual_id", "in", ids).orderBy("value_no").execute(),
    db
      .selectFrom("kpi_actual_evidence")
      .select(["kpi_actual_id", "value_no", "evidence_id"])
      .where("kpi_actual_id", "in", ids)
      .orderBy("linked_at")
      .orderBy("evidence_id")
      .execute(),
    db.selectFrom("kpi_actual_review").selectAll().where("kpi_actual_id", "in", ids).orderBy("value_no").execute(),
  ]);
  const evidenceOf = new Map<string, string[]>();
  for (const e of evidence) {
    const key = `${e.kpi_actual_id}:${e.value_no}`;
    evidenceOf.set(key, [...(evidenceOf.get(key) ?? []), e.evidence_id]);
  }
  return rows.map((r) => ({
    id: r.id,
    transformationId: r.transformation_id,
    kpiDefinitionId: r.kpi_definition_id,
    scopeKind: r.scope_kind as KpiActual["scopeKind"],
    scopeId: r.scope_id,
    reportingPeriodId: r.reporting_period_id,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    periodLabel: r.period_label,
    currentValueNo: r.current_value_no,
    acceptedValueNo: r.accepted_value_no,
    status: r.status as KpiActual["status"],
    route: r.route as KpiActual["route"],
    submittedBy: r.submitted_by,
    submittedAt: isoOrNull(r.submitted_at),
    decidedBy: r.decided_by,
    decidedAt: isoOrNull(r.decided_at),
    decisionReason: r.decision_reason,
    values: values
      .filter((v) => v.kpi_actual_id === r.id)
      .map((v) => ({
        valueNo: v.value_no,
        kpiVersionId: v.kpi_version_id,
        value: dec(v.value),
        numerator: dec(v.numerator),
        denominator: dec(v.denominator),
        milestoneAchieved: v.milestone_achieved,
        achievedOn: v.achieved_on,
        currency: v.currency === null ? null : v.currency.trim(),
        missingReason: v.missing_reason,
        dataAsOf: v.data_as_of,
        comment: v.comment,
        evidenceIds: evidenceOf.get(`${r.id}:${v.value_no}`) ?? [],
        enteredAt: iso(v.entered_at),
        enteredBy: v.entered_by,
        businessDate: v.business_date,
      })),
    reviews: reviews
      .filter((v) => v.kpi_actual_id === r.id)
      .map((v) => ({
        valueNo: v.value_no,
        outcome: v.outcome as KpiActual["reviews"][number]["outcome"],
        reason: v.reason,
        decidedBy: v.decided_by,
        onBehalfOfUserId: v.on_behalf_of_user_id,
        decidedAt: iso(v.decided_at),
      })),
    version: r.version,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
    updatedAt: iso(r.updated_at),
  }));
}

// ------------------------------------------------------------------------------------------------ reads and helpers

/** Today's business date in the organization's default calendar timezone, else its default timezone (ADR-0025 §2). */
export async function businessDateOf(db: DbOrTx, organizationId: string): Promise<string> {
  const r = await sql<{ d: string }>`
    SELECT p4_business_date(now(), coalesce(
      (SELECT c.timezone FROM business_calendar c
        WHERE c.organization_id = ${organizationId}::uuid AND c.is_default AND c.status = 'active' LIMIT 1),
      (SELECT o.default_timezone FROM organization o WHERE o.id = ${organizationId}::uuid)))::text AS d`.execute(db);
  return r.rows[0]!.d;
}

export async function activeVersionOf(
  db: DbOrTx,
  kpiDefinitionId: string,
  lock = false,
): Promise<KpiVersionRow | undefined> {
  let q = db
    .selectFrom("kpi_version")
    .selectAll()
    .where("kpi_definition_id", "=", kpiDefinitionId)
    .where("status", "=", "active");
  if (lock) q = q.forShare();
  return q.executeTakeFirst();
}

async function findSlot(db: DbOrTx, transformationId: string, id: string, forUpdate = false) {
  let q = db
    .selectFrom("kpi_actual")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .where("id", "=", id);
  if (forUpdate) q = q.forUpdate();
  return q.executeTakeFirst();
}

export async function scopeValid(
  db: DbOrTx,
  organizationId: string,
  transformationId: string,
  scopeKind: string,
  scopeId: string,
): Promise<boolean> {
  const r = await sql<{ ok: boolean }>`
    SELECT p4_kpi_scope_valid(${organizationId}::uuid, ${transformationId}::uuid, ${scopeKind}, ${scopeId}::uuid) AS ok`.execute(
    db,
  );
  return r.rows[0]?.ok === true;
}

/** The users who may decide a value of `partyCode`: the mapped person or group members holding kpi_actual.accept. */
export async function reviewersOf(
  db: DbOrTx,
  transformationId: string,
  partyCodeValue: string,
  scope: ResolvedTarget,
): Promise<string[] | "unmapped"> {
  const target = await resolveParty(db, transformationId, partyCodeValue);
  if (target.status === "unmapped") return "unmapped";
  const candidates = target.kind === "user" ? [target.userId] : await currentGroupMemberIds(db, target.groupId);
  const out: string[] = [];
  for (const userId of candidates) {
    const user = await db.selectFrom("app_user").select("status").where("id", "=", userId).executeTakeFirst();
    if (user?.status !== "active") continue;
    const grants = await loadGrants(db, userId);
    if (decide({ kind: "user", userId, grants }, ACCEPT, scope).allowed) out.push(userId);
  }
  return out;
}

/** The record-level submit rule: the KPI's owner or steward, or the assignee of its open kpi_update_due item. */
async function assertMaySubmit(tx: Tx, def: KpiDefinitionRow, userId: string): Promise<void> {
  if (def.owner_user_id === userId || def.steward_user_id === userId) return;
  const assigned = await tx
    .selectFrom("work_item")
    .select("id")
    .where("kind", "=", "kpi_update_due")
    .where("subject_type", "=", "kpi_definition")
    .where("subject_id", "=", def.id)
    .where("assignee_user_id", "=", userId)
    .where("status", "=", "open")
    .executeTakeFirst();
  if (!assigned) throw actualRefusals.notOwner();
}

interface ValueColumns {
  value: string | null;
  numerator: string | null;
  denominator: string | null;
  milestone_achieved: boolean | null;
  achieved_on: string | null;
  missing_reason: string | null;
  currency: string | null;
}

/** The value fields of an entry for the version's value nature (ADR-0027 §6), or 422 value_shape / currency_mismatch. */
export function valueColumnsOf(
  version: Pick<KpiVersionRow, "value_nature" | "currency">,
  b: KpiActualValueEntry,
): ValueColumns {
  const kpiCurrency = version.currency === null ? null : version.currency.trim();
  const given = b.currency ?? null;
  if (given !== null && given !== kpiCurrency)
    throw actualRefusals.currencyMismatch(given, kpiCurrency ?? "no currency");
  const v = {
    value: b.value ?? null,
    numerator: b.numerator ?? null,
    denominator: b.denominator ?? null,
    milestone_achieved: b.milestoneAchieved ?? null,
    achieved_on: b.achievedOn ?? null,
  };
  const missing = b.missingReason ?? null;
  const shapeError = actualRefusals.valueShape(EXPECTED_FIELDS.get(version.value_nature) ?? "a value");
  const none =
    v.value === null &&
    v.numerator === null &&
    v.denominator === null &&
    v.milestone_achieved === null &&
    v.achieved_on === null;
  if (missing !== null) {
    if (!none) throw shapeError;
  } else {
    const ok =
      version.value_nature === "ratio"
        ? v.numerator !== null && v.denominator !== null && v.value === null && v.milestone_achieved === null
        : version.value_nature === "milestone"
          ? v.milestone_achieved !== null && v.value === null && v.numerator === null && v.denominator === null
          : v.value !== null && v.numerator === null && v.denominator === null && v.milestone_achieved === null;
    if (!ok) throw shapeError;
    if (v.achieved_on !== null && v.milestone_achieved !== true) throw shapeError;
  }
  return { ...v, missing_reason: missing, currency: kpiCurrency };
}

async function checkEvidence(
  tx: Tx,
  transformationId: string,
  ids: readonly string[],
  required: boolean,
): Promise<void> {
  if (ids.length > 0) {
    const found = await tx
      .selectFrom("evidence")
      .select("id")
      .where("transformation_id", "=", transformationId)
      .where("id", "in", [...ids])
      .execute();
    if (found.length !== ids.length)
      throw ruleProblem({
        code: "validation.reference",
        detail: "The referenced record does not exist in this transformation.",
        pointer: "/evidenceIds",
      });
  }
  if (required && ids.length === 0) throw actualRefusals.evidenceRequired();
}

function checkPeriod(def: KpiDefinitionRow, period: ReportingPeriodRow): void {
  if (period.frequency !== def.frequency) throw actualRefusals.periodFrequency(def.frequency);
  if (period.status !== "open") throw actualRefusals.periodNotOpen(period.period_label, period.status);
}

const linkOf = (transformationId: string, kpiDefinitionId: string, actualId: string) =>
  `/transformations/${transformationId}/kpis/${kpiDefinitionId}/actuals/${actualId}`;

const actor = (ctx: WriteContext) =>
  ({ actorType: "user", actorUserId: ctx.userId, requestId: ctx.audit.requestId, source: "api" }) as const;

/** Changes of the one audit event of a user action: the slot's status fields plus the value that was entered. */
function changesOf(
  before: KpiActualRow | null,
  after: KpiActualRow,
  value: (ValueColumns & { data_as_of: string; evidence: readonly string[] }) | null,
  decision: string | null,
) {
  const fields = ["status", "current_value_no", "accepted_value_no", "route", "decided_by", "decision_reason"] as const;
  const slot = diffFields(before ?? ({} as KpiActualRow), after, [...fields]);
  const entered = new Map<string, { from: null; to: unknown }>();
  if (value !== null)
    for (const [k, v] of Object.entries({
      value_no: after.current_value_no,
      value: value.value,
      numerator: value.numerator,
      denominator: value.denominator,
      milestone_achieved: value.milestone_achieved,
      achieved_on: value.achieved_on,
      missing_reason: value.missing_reason,
      currency: value.currency,
      data_as_of: value.data_as_of,
      evidence_ids: value.evidence.length > 0 ? [...value.evidence] : null,
    }))
      if (v !== null) entered.set(k, { from: null, to: v });
  return {
    ...slot,
    ...Object.fromEntries(entered),
    ...(decision !== null ? { decision: { from: null, to: decision } } : {}),
  };
}

// ------------------------------------------------------------------------------------------------ mutations

interface EntryContext {
  readonly def: KpiDefinitionRow;
  readonly version: KpiVersionRow;
  readonly businessDate: string;
}

async function entryContext(ctx: WriteContext, kpiDefinitionId: string): Promise<EntryContext> {
  const def = await ctx.tx
    .selectFrom("kpi_definition")
    .selectAll()
    .where("transformation_id", "=", ctx.transformationId)
    .where("id", "=", kpiDefinitionId)
    .forShare()
    .executeTakeFirst();
  if (!def) throw problems.notFound();
  const version = await activeVersionOf(ctx.tx, def.id, true);
  if (!version) throw actualRefusals.noActiveVersion();
  await assertMaySubmit(ctx.tx, def, ctx.userId);
  return { def, version, businessDate: await businessDateOf(ctx.tx, ctx.organizationId) };
}

/** The target status of an entry: draft, submitted (review route) or accepted (direct-accept route). */
const targetStatus = (version: KpiVersionRow, action: "save_draft" | "submit") =>
  action === "save_draft" ? "draft" : version.submission_route === "direct_accept" ? "accepted" : "submitted";

/** Reviewer ids for a submission on the review route (422 when unmapped or nobody can decide; nothing written). */
async function reviewersForSubmission(ctx: WriteContext, version: KpiVersionRow): Promise<string[]> {
  const party = version.reviewer_party_code!;
  const reviewers = await reviewersOf(ctx.tx, ctx.transformationId, party, ctx.target);
  if (reviewers === "unmapped") throw routingRefusals.roleUnmapped(await partyLabel(ctx.tx, party));
  if (reviewers.length === 0)
    throw routingRefusals.assigneeNotApprover("The mapped reviewer", await partyLabel(ctx.tx, party));
  return reviewers;
}

async function insertValue(
  ctx: WriteContext,
  slot: KpiActualRow,
  e: EntryContext,
  cols: ValueColumns,
  b: KpiActualValueEntry,
): Promise<void> {
  await ctx.tx
    .insertInto("kpi_actual_value")
    .values({
      id: uuidv7(),
      organization_id: ctx.organizationId,
      transformation_id: ctx.transformationId,
      kpi_actual_id: slot.id,
      value_no: slot.current_value_no,
      kpi_version_id: e.version.id,
      ...cols,
      data_as_of: b.dataAsOf,
      comment: b.comment ?? null,
      entered_by: ctx.userId,
      business_date: e.businessDate,
    })
    .execute();
  for (const evidenceId of b.evidenceIds ?? [])
    await ctx.tx
      .insertInto("kpi_actual_evidence")
      .values({
        id: uuidv7(),
        organization_id: ctx.organizationId,
        transformation_id: ctx.transformationId,
        kpi_actual_id: slot.id,
        value_no: slot.current_value_no,
        evidence_id: evidenceId,
        linked_by: ctx.userId,
      })
      .execute();
}

/** After the slot reached `status`: the review row and outbox of an acceptance, or the review tasks of a submission. */
async function afterStatus(ctx: WriteContext, slot: KpiActualRow, e: EntryContext, reviewers: readonly string[]) {
  if (slot.status === "accepted") {
    await insertReview(ctx.tx, slot, "direct_accept", null, {
      userId: ctx.userId,
      onBehalfOfUserId: null,
      businessDate: e.businessDate,
    });
    await enqueueActualAccepted(ctx.tx, slot);
  }
  if (slot.status === "submitted")
    for (const reviewer of reviewers)
      await createWorkItemOnce(ctx.tx, actor(ctx), {
        organizationId: ctx.organizationId,
        transformationId: ctx.transformationId,
        kind: "kpi_actual_review",
        assigneeUserId: reviewer,
        subjectType: "kpi_actual",
        subjectId: slot.id,
        linkPath: linkOf(ctx.transformationId, slot.kpi_definition_id, slot.id),
        messageKey: "kpi_actual.review_due",
        messageParams: { kpiName: e.def.name, periodLabel: slot.period_label, valueNo: slot.current_value_no },
        periodLabel: slot.period_label,
        dedupeKey: `kpi.actual_review:${slot.id}:${slot.current_value_no}:${reviewer}`,
      });
}

const actionOf = (status: string) =>
  status === "accepted"
    ? "kpi_actual.accepted"
    : status === "submitted"
      ? "kpi_actual.submit"
      : "kpi_actual.save_draft";

async function submitFirstValue(
  ctx: WriteContext,
  kpiDefinitionId: string,
  b: z.output<typeof kpiActualEntry>,
): Promise<KpiActualRow> {
  const e = await entryContext(ctx, kpiDefinitionId);
  if (b.scopeKind !== e.version.entry_scope_kind) throw actualRefusals.scopeKind(e.version.entry_scope_kind);
  if (!(await scopeValid(ctx.tx, ctx.organizationId, ctx.transformationId, b.scopeKind, b.scopeId)))
    throw actualRefusals.scopeInvalid(b.scopeKind, b.scopeId);
  const period = await ctx.tx
    .selectFrom("reporting_period")
    .selectAll()
    .where("organization_id", "=", ctx.organizationId)
    .where("id", "=", b.reportingPeriodId)
    .forShare()
    .executeTakeFirst();
  if (!period)
    throw ruleProblem({
      code: "validation.reference",
      detail: "The referenced record does not exist in this transformation.",
      pointer: "/reportingPeriodId",
    });
  checkPeriod(e.def, period);
  const cols = valueColumnsOf(e.version, b);
  const status = targetStatus(e.version, b.action);
  await checkEvidence(
    ctx.tx,
    ctx.transformationId,
    b.evidenceIds ?? [],
    status !== "draft" && e.version.dq_evidence_required,
  );
  const existing = await ctx.tx
    .selectFrom("kpi_actual")
    .select("version")
    .where("kpi_definition_id", "=", e.def.id)
    .where("scope_kind", "=", b.scopeKind)
    .where("scope_id", "=", b.scopeId)
    .where("reporting_period_id", "=", period.id)
    .executeTakeFirst();
  if (existing) throw problems.versionConflict(existing.version);
  const reviewers = status === "submitted" ? await reviewersForSubmission(ctx, e.version) : [];
  const now = sql<Date>`now()`;
  const slot = await ctx.tx
    .insertInto("kpi_actual")
    .values({
      id: uuidv7(),
      organization_id: ctx.organizationId,
      transformation_id: ctx.transformationId,
      kpi_definition_id: e.def.id,
      scope_kind: b.scopeKind,
      scope_id: b.scopeId,
      reporting_period_id: period.id,
      period_start: period.period_start,
      period_end: period.period_end,
      period_label: period.period_label,
      current_value_no: 1,
      accepted_value_no: status === "accepted" ? 1 : null,
      status,
      route: e.version.submission_route,
      submitted_by: status === "draft" ? null : ctx.userId,
      submitted_at: status === "draft" ? null : now,
      decided_by: status === "accepted" ? ctx.userId : null,
      decided_at: status === "accepted" ? now : null,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await insertValue(ctx, slot, e, cols, b);
  await afterStatus(ctx, slot, e, reviewers);
  await auditSlot(ctx, actionOf(status), null, slot, {
    ...cols,
    data_as_of: b.dataAsOf,
    evidence: b.evidenceIds ?? [],
  });
  return slot;
}

async function auditSlot(
  ctx: WriteContext,
  action: string,
  before: KpiActualRow | null,
  after: KpiActualRow,
  value: (ValueColumns & { data_as_of: string; evidence: readonly string[] }) | null,
  reason: string | null = null,
  decision: string | null = null,
) {
  await record(ctx.tx, ctx.audit, {
    action,
    recordType: "kpi_actual",
    recordId: after.id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    priorVersion: before?.version ?? null,
    newVersion: after.version,
    reason,
    changes: changesOf(before, after, value, decision),
  });
}

async function lockSlot(ctx: WriteContext, id: string, expected: number): Promise<KpiActualRow> {
  const slot = await findSlot(ctx.tx, ctx.transformationId, id, true);
  if (!slot) throw problems.notFound();
  if (slot.version !== expected) throw problems.versionConflict(slot.version);
  return slot;
}

async function addValue(
  ctx: WriteContext,
  id: string,
  expected: number,
  b: KpiActualValueEntry,
): Promise<KpiActualRow> {
  const current = await lockSlot(ctx, id, expected);
  const e = await entryContext(ctx, current.kpi_definition_id);
  const period = (await ctx.tx
    .selectFrom("reporting_period")
    .selectAll()
    .where("id", "=", current.reporting_period_id)
    .forShare()
    .executeTakeFirst())!;
  checkPeriod(e.def, period);
  const cols = valueColumnsOf(e.version, b);
  const status = targetStatus(e.version, b.action);
  await checkEvidence(
    ctx.tx,
    ctx.transformationId,
    b.evidenceIds ?? [],
    status !== "draft" && e.version.dq_evidence_required,
  );
  const reviewers = status === "submitted" ? await reviewersForSubmission(ctx, e.version) : [];
  const now = sql<Date>`now()`;
  const next = current.current_value_no + 1;
  // The value row must exist before the slot points at it (the guard checks the value number against the slot): the
  // slot moves to the next value first, then the value row is written, both in this transaction.
  const updated = await ctx.tx
    .updateTable("kpi_actual")
    .set({
      current_value_no: next,
      status,
      route: e.version.submission_route,
      accepted_value_no: status === "accepted" ? next : current.accepted_value_no,
      submitted_by: status === "draft" ? null : ctx.userId,
      submitted_at: status === "draft" ? null : now,
      decided_by: status === "accepted" ? ctx.userId : null,
      decided_at: status === "accepted" ? now : null,
      decision_reason: null,
      version: sql<number>`version + 1`,
      updated_at: now,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await insertValue(ctx, updated, e, cols, b);
  await afterStatus(ctx, updated, e, reviewers);
  // A new value answers an open correction task, and replaces a pending review of the previous value.
  await closeWorkItemsOfSubject(
    ctx.tx,
    actor(ctx),
    {
      organizationId: ctx.organizationId,
      subjectType: "kpi_actual",
      subjectId: current.id,
      kinds: ["kpi_actual_rejected"],
    },
    "done",
  );
  if (current.status === "submitted")
    await closeWorkItemsOfSubject(
      ctx.tx,
      actor(ctx),
      {
        organizationId: ctx.organizationId,
        subjectType: "kpi_actual",
        subjectId: current.id,
        kinds: ["kpi_actual_review"],
      },
      "cancelled",
    );
  await auditSlot(ctx, actionOf(status), current, updated, {
    ...cols,
    data_as_of: b.dataAsOf,
    evidence: b.evidenceIds ?? [],
  });
  return updated;
}

async function submitDraft(ctx: WriteContext, id: string, expected: number): Promise<KpiActualRow> {
  const current = await lockSlot(ctx, id, expected);
  const e = await entryContext(ctx, current.kpi_definition_id);
  if (current.status !== "draft")
    throw problems.invalidTransition("Only a draft value can be submitted; add a new value to change this actual.");
  const period = (await ctx.tx
    .selectFrom("reporting_period")
    .selectAll()
    .where("id", "=", current.reporting_period_id)
    .forShare()
    .executeTakeFirst())!;
  if (period.status !== "open") throw actualRefusals.periodNotOpen(period.period_label, period.status);
  const value = (await ctx.tx
    .selectFrom("kpi_actual_value")
    .select("kpi_version_id")
    .where("kpi_actual_id", "=", current.id)
    .where("value_no", "=", current.current_value_no)
    .executeTakeFirst())!;
  // A draft saved under an earlier active version is entered again (the database refuses a value of another version).
  if (value.kpi_version_id !== e.version.id) throw actualRefusals.noActiveVersion();
  const evidence = await ctx.tx
    .selectFrom("kpi_actual_evidence")
    .select("evidence_id")
    .where("kpi_actual_id", "=", current.id)
    .where("value_no", "=", current.current_value_no)
    .execute();
  if (e.version.dq_evidence_required && evidence.length === 0) throw actualRefusals.evidenceRequired();
  const status = targetStatus(e.version, "submit");
  const reviewers = status === "submitted" ? await reviewersForSubmission(ctx, e.version) : [];
  const now = sql<Date>`now()`;
  const updated = await ctx.tx
    .updateTable("kpi_actual")
    .set({
      status,
      route: e.version.submission_route,
      accepted_value_no: status === "accepted" ? current.current_value_no : current.accepted_value_no,
      submitted_by: ctx.userId,
      submitted_at: now,
      decided_by: status === "accepted" ? ctx.userId : null,
      decided_at: status === "accepted" ? now : null,
      version: sql<number>`version + 1`,
      updated_at: now,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await afterStatus(ctx, updated, e, reviewers);
  await auditSlot(ctx, actionOf(status), current, updated, null);
  return updated;
}

/** Shared checks of accept and reject: submitted, not the submitter (SoD), one of the version's reviewers. */
async function openDecision(ctx: WriteContext, id: string, expected: number) {
  const current = await lockSlot(ctx, id, expected);
  if (current.status !== "submitted") throw actualRefusals.notSubmitted();
  if (current.submitted_by === ctx.userId) throw actualRefusals.sodSubmitter();
  const value = (await ctx.tx
    .selectFrom("kpi_actual_value as v")
    .innerJoin("kpi_version as k", "k.id", "v.kpi_version_id")
    .select(["k.reviewer_party_code"])
    .where("v.kpi_actual_id", "=", current.id)
    .where("v.value_no", "=", current.current_value_no)
    .executeTakeFirst())!;
  const reviewers =
    value.reviewer_party_code === null
      ? []
      : await reviewersOf(ctx.tx, ctx.transformationId, value.reviewer_party_code, ctx.target);
  if (reviewers === "unmapped" || !reviewers.includes(ctx.userId)) throw actualRefusals.notReviewer();
  const def = (await ctx.tx
    .selectFrom("kpi_definition")
    .select("name")
    .where("id", "=", current.kpi_definition_id)
    .executeTakeFirst())!;
  return { current, kpiName: def.name, businessDate: await businessDateOf(ctx.tx, ctx.organizationId) };
}

/** acceptKpiActual: the accept transaction of ADR-0027 §8 step 1. */
async function acceptValue(ctx: WriteContext, id: string, expected: number, comment: string | null) {
  const { current, businessDate } = await openDecision(ctx, id, expected);
  const decider: Decider = { userId: ctx.userId, onBehalfOfUserId: null, businessDate };
  await insertReview(ctx.tx, current, "accept", comment, decider);
  const now = sql<Date>`now()`;
  const updated = await ctx.tx
    .updateTable("kpi_actual")
    .set({
      status: "accepted",
      accepted_value_no: current.current_value_no,
      decided_by: ctx.userId,
      decided_at: now,
      version: sql<number>`version + 1`,
      updated_at: now,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await enqueueActualAccepted(ctx.tx, updated);
  await closeWorkItemsOfSubject(
    ctx.tx,
    actor(ctx),
    {
      organizationId: ctx.organizationId,
      subjectType: "kpi_actual",
      subjectId: current.id,
      kinds: ["kpi_actual_review"],
    },
    "done",
  );
  await auditSlot(ctx, "kpi_actual.accepted", current, updated, null, comment, "accept");
  return updated;
}

async function rejectValue(ctx: WriteContext, id: string, expected: number, reason: string | null | undefined) {
  const { current, kpiName, businessDate } = await openDecision(ctx, id, expected);
  if (reason === undefined || reason === null) throw actualRefusals.rejectReasonRequired();
  await insertReview(ctx.tx, current, "reject", reason, { userId: ctx.userId, onBehalfOfUserId: null, businessDate });
  const now = sql<Date>`now()`;
  const updated = await ctx.tx
    .updateTable("kpi_actual")
    .set({
      status: "rejected",
      decided_by: ctx.userId,
      decided_at: now,
      decision_reason: reason,
      version: sql<number>`version + 1`,
      updated_at: now,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await closeWorkItemsOfSubject(
    ctx.tx,
    actor(ctx),
    {
      organizationId: ctx.organizationId,
      subjectType: "kpi_actual",
      subjectId: current.id,
      kinds: ["kpi_actual_review"],
    },
    "done",
  );
  await createWorkItemOnce(ctx.tx, actor(ctx), {
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    kind: "kpi_actual_rejected",
    assigneeUserId: current.submitted_by!,
    subjectType: "kpi_actual",
    subjectId: current.id,
    linkPath: linkOf(ctx.transformationId, current.kpi_definition_id, current.id),
    messageKey: "kpi_actual.rejected",
    messageParams: { kpiName, periodLabel: current.period_label, valueNo: current.current_value_no },
    periodLabel: current.period_label,
    dedupeKey: `kpi.actual_rejected:${current.id}:${current.current_value_no}`,
  });
  await auditSlot(ctx, "kpi_actual.rejected", current, updated, null, reason, "reject");
  return updated;
}

// ------------------------------------------------------------------------------------------------ routes

async function submission(db: DbOrTx, row: KpiActualRow): Promise<KpiActualSubmission> {
  const [actual] = await presentActuals(db, [row]);
  const { downstream, financeReview } = await downstreamOf(db, row.transformation_id, row.kpi_definition_id);
  return { actual: actual!, reviewPending: row.status === "submitted", downstream, financeReview };
}

function sendSubmission(reply: FastifyReply, status: number, body: KpiActualSubmission, location?: string) {
  reply.header("ETag", `"${body.actual.version}"`);
  if (location) reply.header("Location", location);
  return reply.code(status).send(body);
}

export function registerKpiActualRoutes(app: FastifyInstance, deps: ModuleDeps): string[] {
  const { db } = deps;
  const read = { access: { permission: "transformation.read" as const } };
  const write = (permission: typeof SUBMIT | typeof ACCEPT, body = true) => ({
    access: { permission },
    ...(body ? { consumes: JSON_BODY } : {}),
  });
  const open = (tx: Tx, request: FastifyRequest, transformationId: string, permission: typeof SUBMIT | typeof ACCEPT) =>
    openWrite(tx, request, transformationId, [{ permission }], null, { atCommit: true });

  app.get(DEF_ACTUALS, { config: read }, async (request) => {
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
    const hash = filterHash({
      list: "kpi-actuals",
      transformationId,
      kpiDefinitionId,
      scopeKind: query.scopeKind ?? null,
      scopeId: query.scopeId ?? null,
      reportingPeriodId: query.reportingPeriodId ?? null,
      status: query.status ?? null,
    });
    const after = decodeCursor(query.cursor, hash, 2);
    let q = db.selectFrom("kpi_actual").selectAll().where("kpi_definition_id", "=", kpiDefinitionId);
    if (query.scopeKind) q = q.where("scope_kind", "=", query.scopeKind);
    if (query.scopeId) q = q.where("scope_id", "=", query.scopeId);
    if (query.reportingPeriodId) q = q.where("reporting_period_id", "=", query.reportingPeriodId);
    if (query.status) q = q.where("status", "=", query.status);
    if (after) q = q.where(sql<boolean>`(period_end, id) < (${String(after[0])}::date, ${String(after[1])}::uuid)`);
    const rows = await q
      .orderBy("period_end", "desc")
      .orderBy("id", "desc")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.period_end, r.id], hash);
    return { items: await presentActuals(db, page.items), nextCursor: page.nextCursor };
  });

  app.post(DEF_ACTUALS, { config: write(SUBMIT) }, async (request, reply) => {
    const { transformationId, kpiDefinitionId } = parse(definitionParams, request.params, "params");
    const row = await db.transaction().execute(async (tx) => {
      const ctx = await open(tx, request, transformationId, SUBMIT);
      const body = parseBody(kpiActualEntry, request.body);
      return submitFirstValue(ctx, kpiDefinitionId, body);
    });
    return sendSubmission(
      reply,
      201,
      await submission(db, row),
      `/api/v1/transformations/${transformationId}/kpi-actuals/${row.id}`,
    );
  });

  app.get(ACTUAL_ITEM, { config: read }, async (request, reply) => {
    const { transformationId, kpiActualId } = parse(actualParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    const row = await findSlot(db, transformationId, kpiActualId);
    if (!row) throw problems.notFound();
    const [body] = await presentActuals(db, [row]);
    reply.header("ETag", `"${row.version}"`);
    return reply.code(200).send(body);
  });

  app.post(`${ACTUAL_ITEM}/values`, { config: write(SUBMIT) }, async (request, reply) => {
    const { transformationId, kpiActualId } = parse(actualParams, request.params, "params");
    const row = await db.transaction().execute(async (tx) => {
      const ctx = await open(tx, request, transformationId, SUBMIT);
      const expected = requireIfMatch(request);
      const body = parseBody(kpiActualValueEntry, request.body);
      return addValue(ctx, kpiActualId, expected, body);
    });
    return sendSubmission(reply, 200, await submission(db, row));
  });

  app.post(`${ACTUAL_ITEM}/submit`, { config: write(SUBMIT, false) }, async (request, reply) => {
    const { transformationId, kpiActualId } = parse(actualParams, request.params, "params");
    const row = await db.transaction().execute(async (tx) => {
      const ctx = await open(tx, request, transformationId, SUBMIT);
      const expected = requireIfMatch(request);
      return submitDraft(ctx, kpiActualId, expected);
    });
    return sendSubmission(reply, 200, await submission(db, row));
  });

  for (const [suffix, decideFn] of [
    [
      "accept",
      async (ctx: WriteContext, id: string, expected: number, request: FastifyRequest) =>
        acceptValue(ctx, id, expected, parseBody(kpiActualDecision, request.body).comment ?? null),
    ],
    [
      "reject",
      async (ctx: WriteContext, id: string, expected: number, request: FastifyRequest) =>
        rejectValue(ctx, id, expected, parseBody(rejectBody, request.body).reason),
    ],
  ] as const) {
    app.post(`${ACTUAL_ITEM}/${suffix}`, { config: write(ACCEPT) }, async (request, reply) => {
      const { transformationId, kpiActualId } = parse(actualParams, request.params, "params");
      const row = await db.transaction().execute(async (tx) => {
        const ctx = await open(tx, request, transformationId, ACCEPT);
        const expected = requireIfMatch(request);
        return decideFn(ctx, kpiActualId, expected, request);
      });
      const [body] = await presentActuals(db, [row]);
      reply.header("ETag", `"${row.version}"`);
      return reply.code(200).send(body);
    });
  }

  app.get(REVIEW_QUEUE, { config: read }, async (request) => {
    const { transformationId } = parse(z.strictObject({ transformationId: z.uuid() }), request.params, "params");
    const query = parseQuery(queueQuery, request.query);
    const principal = principalOf(request);
    const target = await requireTransformationRead(db, principal, transformationId);
    const userId = principal.userId!;
    // The parties the caller resolves to in this transformation (as the mapped person or a member of the mapped group),
    // and only when the caller holds kpi_actual.accept here; never the caller's own submissions (SoD).
    const grants = await loadGrants(db, userId);
    const mayAccept = decide({ kind: "user", userId, grants }, ACCEPT, target).allowed;
    const groups = await effectiveGroupIds(db, userId);
    const parties = mayAccept
      ? (
          await db
            .selectFrom("role_mapping")
            .select("party_code")
            .where("transformation_id", "=", transformationId)
            .where("status", "=", "active")
            .where((eb) =>
              eb.or([eb("user_id", "=", userId), ...(groups.length > 0 ? [eb("group_id", "in", groups)] : [])]),
            )
            .execute()
        ).map((r) => r.party_code)
      : [];
    const hash = filterHash({ list: "kpi-actual-reviews", transformationId, userId });
    const after = decodeCursor(query.cursor, hash, 2);
    if (parties.length === 0) return { items: [], nextCursor: null };
    let q = db
      .selectFrom("kpi_actual as a")
      .innerJoin("kpi_actual_value as v", (j) =>
        j.onRef("v.kpi_actual_id", "=", "a.id").onRef("v.value_no", "=", "a.current_value_no"),
      )
      .innerJoin("kpi_version as k", "k.id", "v.kpi_version_id")
      .selectAll("a")
      .select(sql<string>`to_char(a.submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as("sort_key"))
      .where("a.transformation_id", "=", transformationId)
      .where("a.status", "=", "submitted")
      .where("a.submitted_by", "<>", userId)
      .where("k.reviewer_party_code", "in", parties);
    if (after)
      q = q.where(sql<boolean>`(a.submitted_at, a.id) > (${String(after[0])}::timestamptz, ${String(after[1])}::uuid)`);
    const rows = await q
      .orderBy("a.submitted_at")
      .orderBy("a.id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.sort_key, r.id], hash);
    return {
      items: await presentActuals(
        db,
        page.items.map(({ sort_key: _k, ...r }) => r as KpiActualRow),
      ),
      nextCursor: page.nextCursor,
    };
  });

  return [
    `GET ${DEF_ACTUALS}`,
    `POST ${DEF_ACTUALS}`,
    `GET ${ACTUAL_ITEM}`,
    `POST ${ACTUAL_ITEM}/values`,
    `POST ${ACTUAL_ITEM}/submit`,
    `POST ${ACTUAL_ITEM}/accept`,
    `POST ${ACTUAL_ITEM}/reject`,
    `GET ${REVIEW_QUEUE}`,
  ];
}
