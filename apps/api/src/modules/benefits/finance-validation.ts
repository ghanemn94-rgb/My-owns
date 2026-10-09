// The Finance validation queue and decisions (P4 slice B; ADR-0030 §3, §4, §9, §11; ADR-0029 §8; T-DG4-KBE-E;
// REQ-PB-013, REQ-S08-008, REQ-S08-015, REQ-S08-016, REQ-S16-017 "FinanceValidation"):
//   GET  /transformations/{t}/finance-validations                       the queue (queued first, oldest first) and decided
//   GET  /transformations/{t}/finance-validations/{id}                  one item with its six-item content snapshot
//   POST /transformations/{t}/finance-validations/{id}/decision         approve or reject (finance.validate; FIN only)
//   POST /transformations/{t}/benefits/{benefitId}/baseline-validation  Finance validates or rejects the baseline
//
// - FIN only: finance.validate is held by no other role, so a Business Owner, an auditor or an ADM-only user gets the
//   generic 403 (REQ-PB-013, REQ-S10-003). The submitter of a value never validates it (403
//   finance_validation.sod_submitter); the benefit's owner never validates its baseline (403
//   benefit.baseline_validator_is_owner).
// - A decision covers all six items: baseline, attribution/counterfactual, calculation, evidence, measurement period and
//   assumptions (422 finance_validation.content_incomplete naming the missing ones, REQ-S08-015). Approve = every item
//   accepted and, for a financial value, the approved amount; reject = every item decided, at least one rejected, and
//   a note. A value is validated only against a Finance-validated comparison basis (REQ-S08-008: 422
//   finance_validation.basis_provisional).
// - Decide, in ONE transaction under the financeValidationQueue advisory lock (key: the measurement id): the validation row and the measurement row
//   (validated with validated_amount = approvedAmount, or rejected), two audit events whose actor is the deciding
//   Finance user (the validator's identity, REQ-PB-013), the queue work item completed, and one outbox event
//   benefit.value_validated / benefit.value_rejected (+ benefit.variance_evaluated for a validated value). Approval
//   raises the validated total by exactly the approved amount (REQ-S08-016).
// This is a decision by a named Finance user inside the product. No agent, seed, job or trigger decides one, and it
// never relates to the engineering gates DG0-DG7.
import { diffFields, sql, type BenefitRow, type DbOrTx, type FinanceValidationRow, type Tx } from "@mth/db";
import {
  benefitBaselineDecision,
  financeItemsText,
  financeValidationDecision,
  financeValidationListQuery,
  missingFinanceItems,
  type FinanceItem,
  type FinanceValidation,
  type FinanceValidationContent,
  type FinanceValidationItemDecision,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Permission } from "@mth/shared";
import { PROBLEM_TYPES } from "@mth/shared";
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
import { bumpStamps, type WriteContext } from "../transformations/index.ts";
import { closeWorkItemsOfSubject } from "../tasks/index.ts";
import {
  archivedBenefit,
  BENEFIT_AUDIT_FIELDS,
  BENEFIT_ITEM,
  benefitRule,
  checkBenefitVersion,
  JSON_BODY,
  lockBenefit,
  openBenefitWrite,
  parseBenefitParams,
  presentBenefit,
} from "./register.ts";
import { lockMeasurement, lockQueue, MEASUREMENT_AUDIT_FIELDS } from "./measurements.ts";
import { basisOf, enqueueBenefitEvent, enqueueVariance } from "./values.ts";

export const FINANCE_VALIDATE: Permission = "finance.validate";
export const FINANCE_VALIDATIONS = "/api/v1/transformations/:transformationId/finance-validations";
export const FINANCE_VALIDATION_ITEM = `${FINANCE_VALIDATIONS}/:financeValidationId`;
export const FINANCE_TASK_KIND = "finance_validation_review";

// ------------------------------------------------------------------------------------------------ problems (ADR-0030 §11)

const forbidden = (code: string, detail: string) =>
  new HttpProblem({ status: 403, type: PROBLEM_TYPES.forbidden, code, title: "Forbidden", detail });

export const sodSubmitter = () =>
  forbidden("finance_validation.sod_submitter", "You submitted this value, so you cannot validate it.");
export const contentIncomplete = (missing: readonly FinanceItem[]) =>
  benefitRule(
    "finance_validation.content_incomplete",
    `A Finance decision covers all six items: baseline, attribution/counterfactual, calculation, evidence, measurement period and assumptions. Missing: ${financeItemsText(missing)}.`,
    `/items/${missing[0] ?? ""}`,
  );
export const notQueued = () => benefitRule("finance_validation.not_queued", "Only a queued item can be decided.");
export const itemsNotAccepted = () =>
  benefitRule(
    "finance_validation.items_not_accepted",
    "An approval needs every item accepted. Reject the value instead, with a note.",
    "/items",
  );
export const rejectionNoteRequired = () =>
  benefitRule(
    "finance_validation.rejection_note_required",
    "A rejection needs a note and at least one rejected item.",
    "/note",
  );
export const approvedAmountRequired = () =>
  benefitRule(
    "finance_validation.approved_amount_required",
    "Approving a financial value states the approved amount; a non-financial value has none.",
    "/approvedAmount",
  );
export const basisProvisional = () =>
  benefitRule(
    "finance_validation.basis_provisional",
    "The comparison basis is not validated by Finance, so this value is provisional. Validate the benefit's baseline and its formula version first.",
  );

// ------------------------------------------------------------------------------------------------ presenters

/** API item name -> column prefix of the six decisions. */
export const ITEM_COLUMNS: Readonly<Record<FinanceItem, string>> = {
  baseline: "baseline",
  attribution: "attribution",
  calculation: "calculation",
  evidence: "evidence",
  measurementPeriod: "period",
  assumptions: "assumptions",
};

export const VALIDATION_AUDIT_FIELDS = [
  "benefit_id",
  "benefit_measurement_id",
  "kind",
  "corrects_validation_id",
  "assignee_user_id",
  "status",
  "measurement_period_start",
  "measurement_period_end",
  "baseline_decision",
  "attribution_decision",
  "calculation_decision",
  "evidence_decision",
  "period_decision",
  "assumptions_decision",
  "baseline_note",
  "attribution_note",
  "calculation_note",
  "evidence_note",
  "period_note",
  "assumptions_note",
  "approved_amount",
  "decision_note",
  "decided_by",
  "reason",
] as const satisfies readonly (keyof FinanceValidationRow & string)[];

export function toFinanceValidation(r: FinanceValidationRow): FinanceValidation {
  const item = (decision: string | null, note: string | null): FinanceValidationItemDecision | null => {
    if (decision === null) return null;
    const d = decision as FinanceValidationItemDecision["decision"];
    return note === null ? { decision: d } : { decision: d, note };
  };
  return {
    id: r.id,
    benefitId: r.benefit_id,
    benefitMeasurementId: r.benefit_measurement_id,
    kind: r.kind as FinanceValidation["kind"],
    correctsValidationId: r.corrects_validation_id,
    assigneeUserId: r.assignee_user_id,
    status: r.status as FinanceValidation["status"],
    content: r.content as FinanceValidationContent,
    items: {
      baseline: item(r.baseline_decision, r.baseline_note),
      attribution: item(r.attribution_decision, r.attribution_note),
      calculation: item(r.calculation_decision, r.calculation_note),
      evidence: item(r.evidence_decision, r.evidence_note),
      measurementPeriod: item(r.period_decision, r.period_note),
      assumptions: item(r.assumptions_decision, r.assumptions_note),
    },
    approvedAmount: r.approved_amount,
    decisionNote: r.decision_note,
    decidedBy: r.decided_by,
    decidedAt: isoOrNull(r.decided_at),
    reason: r.reason,
    version: r.version,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
    updatedAt: iso(r.updated_at),
  };
}

const validationParams = z.strictObject({ transformationId: z.uuid(), financeValidationId: z.uuid() });
export function parseValidationParams(params: unknown): { transformationId: string; financeValidationId: string } {
  return parse(validationParams, params, "params");
}

/** The validation of a transformation (404 when absent); FOR UPDATE inside a write. */
export async function findValidation(
  db: DbOrTx,
  transformationId: string,
  id: string,
  forUpdate = false,
): Promise<FinanceValidationRow> {
  let q = db
    .selectFrom("finance_validation")
    .selectAll()
    .where("id", "=", id)
    .where("transformation_id", "=", transformationId);
  if (forUpdate) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) throw problems.notFound();
  return row;
}

/** The FIN gates of a Finance write: finance.validate somewhere (403), read scope (404), scoped write at commit. */
export function openFinanceWrite(tx: Tx, request: FastifyRequest, transformationId: string): Promise<WriteContext> {
  return openBenefitWrite(tx, request, transformationId, FINANCE_VALIDATE);
}

// ------------------------------------------------------------------------------------------------ decide

async function decide(tx: Tx, request: FastifyRequest, transformationId: string, id: string) {
  const ctx = await openFinanceWrite(tx, request, transformationId);
  const body = parseBody(financeValidationDecision, request.body);
  const expected = requireIfMatch(request);
  const missing = missingFinanceItems(body.items);
  if (missing.length > 0) throw contentIncomplete(missing);
  const peek = await findValidation(tx, transformationId, id);
  await lockQueue(tx, peek.benefit_measurement_id);
  const current = await findValidation(tx, transformationId, id, true);
  if (current.kind !== "validation" || current.status !== "queued") throw notQueued();
  if (current.version !== expected) throw problems.versionConflict(current.version);
  const measurement = await lockMeasurement(tx, transformationId, current.benefit_measurement_id);
  if (measurement.submitted_by !== null && measurement.submitted_by === ctx.userId) throw sodSubmitter();
  const items = body.items as Record<FinanceItem, FinanceValidationItemDecision>;
  const decisions = Object.values(items).map((i) => i.decision);
  const approve = body.decision === "approved";
  if (approve) {
    if (decisions.some((d) => d !== "accepted")) throw itemsNotAccepted();
    const amount = body.approvedAmount ?? null;
    if ((amount === null) !== (measurement.amount === null)) throw approvedAmountRequired();
    if (measurement.missing_reason !== null)
      throw benefitRule(
        "benefit_measurement.value_shape",
        "Enter an amount, a KPI value, or why the value is not available.",
        "/approvedAmount",
      );
    const benefit = await lockBenefit(tx, transformationId, measurement.benefit_id, "share");
    if ((await basisOf(tx, benefit, measurement.formula_version_id)) !== "validated") throw basisProvisional();
  } else if (body.note === undefined || !decisions.includes("rejected")) throw rejectionNoteRequired();

  const set = {
    status: approve ? "approved" : "rejected",
    approved_amount: approve ? (body.approvedAmount ?? null) : null,
    decision_note: body.note ?? null,
    decided_by: ctx.userId,
    decided_at: new Date(),
    baseline_decision: items.baseline.decision,
    baseline_note: items.baseline.note ?? null,
    attribution_decision: items.attribution.decision,
    attribution_note: items.attribution.note ?? null,
    calculation_decision: items.calculation.decision,
    calculation_note: items.calculation.note ?? null,
    evidence_decision: items.evidence.decision,
    evidence_note: items.evidence.note ?? null,
    period_decision: items.measurementPeriod.decision,
    period_note: items.measurementPeriod.note ?? null,
    assumptions_decision: items.assumptions.decision,
    assumptions_note: items.assumptions.note ?? null,
    ...bumpStamps(ctx.userId),
  };
  const updated = await tx
    .updateTable("finance_validation")
    .set(set)
    .where("id", "=", id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  const decidedMeasurement = await tx
    .updateTable("benefit_measurement")
    .set({
      status: approve ? "validated" : "rejected",
      validated_amount: approve ? updated.approved_amount : null,
      decided_by: ctx.userId,
      decided_at: updated.decided_at,
      ...bumpStamps(ctx.userId),
    })
    .where("id", "=", measurement.id)
    .where("version", "=", measurement.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: approve ? "finance_validation.approved" : "finance_validation.rejected",
    recordType: "finance_validation",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diffFields(current, updated, [...VALIDATION_AUDIT_FIELDS]),
  });
  await record(tx, ctx.audit, {
    action: approve ? "benefit_measurement.validated" : "benefit_measurement.rejected",
    recordType: "benefit_measurement",
    recordId: measurement.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: measurement.version,
    newVersion: decidedMeasurement.version,
    changes: diffFields(measurement, decidedMeasurement, [...MEASUREMENT_AUDIT_FIELDS]),
  });
  await closeWorkItemsOfSubject(
    tx,
    { actorType: "user", actorUserId: ctx.userId, requestId: ctx.audit.requestId, source: "api" },
    {
      organizationId: ctx.organizationId,
      subjectType: "finance_validation",
      subjectId: id,
      kinds: [FINANCE_TASK_KIND],
    },
    "done",
  );
  await enqueueBenefitEvent(tx, {
    organizationId: ctx.organizationId,
    aggregateType: "finance_validation",
    aggregateId: id,
    eventType: approve ? "benefit.value_validated" : "benefit.value_rejected",
    idempotencyKey: `${approve ? "benefit.value_validated" : "benefit.value_rejected"}:${id}`,
    payload: {
      benefitId: updated.benefit_id,
      measurementId: measurement.id,
      financeValidationId: id,
      transformationId,
      approvedAmount: updated.approved_amount,
      decidedBy: ctx.userId,
    },
  });
  if (approve) await enqueueVariance(tx, ctx.organizationId, decidedMeasurement);
  return updated;
}

// ------------------------------------------------------------------------------------------------ baseline (ADR-0029 §8)

async function decideBaseline(tx: Tx, request: FastifyRequest, transformationId: string, benefitId: string) {
  const ctx = await openFinanceWrite(tx, request, transformationId);
  const body = parseBody(benefitBaselineDecision, request.body);
  const expected = requireIfMatch(request);
  const current: BenefitRow = await lockBenefit(tx, transformationId, benefitId);
  checkBenefitVersion(current, expected);
  if (current.status !== "active") throw archivedBenefit();
  if (current.owner_user_id === ctx.userId)
    throw forbidden(
      "benefit.baseline_validator_is_owner",
      "You own this benefit, so you cannot validate its baseline.",
    );
  if (current.baseline_value === null && current.baseline_id === null)
    throw benefitRule("benefit.baseline_missing", "There is no baseline to validate.", "/decision");
  if (body.decision === "rejected" && body.note === undefined)
    throw benefitRule("benefit.baseline_note_required", "A baseline rejection needs a note.", "/note");
  const updated = await tx
    .updateTable("benefit")
    .set({
      baseline_validation_status: body.decision,
      baseline_validated_by: ctx.userId,
      baseline_validated_at: new Date(),
      baseline_validation_note: body.note ?? null,
      ...bumpStamps(ctx.userId),
    })
    .where("id", "=", benefitId)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: body.decision === "validated" ? "benefit.baseline_validated" : "benefit.baseline_rejected",
    recordType: "benefit",
    recordId: benefitId,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diffFields(current, updated, [...BENEFIT_AUDIT_FIELDS, "baseline_validated_at"]),
  });
  return updated;
}

// ------------------------------------------------------------------------------------------------ routes

const listQuery = financeValidationListQuery.extend({ cursor: cursorSchema, limit: limitSchema });

export function registerFinanceValidationRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "transformation.read" as const } };
  const write = { access: { permission: FINANCE_VALIDATE }, consumes: JSON_BODY };
  const BASELINE = `${BENEFIT_ITEM}/baseline-validation`;

  app.get(FINANCE_VALIDATIONS, { config: read }, async (request) => {
    const transformationId = parse(
      z.strictObject({ transformationId: z.uuid() }),
      request.params,
      "params",
    ).transformationId;
    const query = parseQuery(listQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({ table: "finance_validation", transformationId, status: query.status });
    const after = decodeCursor(query.cursor, hash, 3);
    // Queued first (rank 0), then the decided ones (rank 1); oldest first within a rank; id breaks ties. The cursor
    // keeps created_at at microsecond precision (a millisecond key would repeat rows created within one millisecond).
    const rankExpr = sql<number>`(CASE WHEN status = 'queued' THEN 0 ELSE 1 END)`;
    const createdKey = sql<string>`to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
    let q = db
      .selectFrom("finance_validation")
      .selectAll()
      .select([rankExpr.as("rank"), createdKey.as("created_key")])
      .where("transformation_id", "=", transformationId);
    if (query.status !== undefined) q = q.where("status", "=", query.status);
    if (after) {
      const [r, at, aid] = [Number(after[0]), String(after[1]), String(after[2])];
      q = q.where(sql<boolean>`(${rankExpr}, created_at, id) > (${r}::int, ${at}::timestamptz, ${aid}::uuid)`);
    }
    const rows = await q
      .orderBy(rankExpr)
      .orderBy("created_at")
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [Number(r.rank), r.created_key, r.id], hash);
    return {
      items: page.items.map(({ rank: _rank, created_key: _key, ...r }) =>
        toFinanceValidation(r as FinanceValidationRow),
      ),
      nextCursor: page.nextCursor,
    };
  });

  app.get(FINANCE_VALIDATION_ITEM, { config: read }, async (request, reply) => {
    const { transformationId, financeValidationId } = parseValidationParams(request.params);
    await requireTransformationRead(db, principalOf(request), transformationId);
    return sendVersioned(
      reply,
      200,
      toFinanceValidation(await findValidation(db, transformationId, financeValidationId)),
    );
  });

  app.post(`${FINANCE_VALIDATION_ITEM}/decision`, { config: write }, async (request, reply) => {
    const { transformationId, financeValidationId } = parseValidationParams(request.params);
    const body = await db
      .transaction()
      .execute(async (tx) => toFinanceValidation(await decide(tx, request, transformationId, financeValidationId)));
    return sendVersioned(reply, 200, body);
  });

  app.post(BASELINE, { config: write }, async (request, reply) => {
    const { transformationId, benefitId } = parseBenefitParams(request.params);
    const body = await db
      .transaction()
      .execute(async (tx) => presentBenefit(tx, await decideBaseline(tx, request, transformationId, benefitId)));
    return sendVersioned(reply, 200, body);
  });

  return [
    `GET ${FINANCE_VALIDATIONS}`,
    `GET ${FINANCE_VALIDATION_ITEM}`,
    `POST ${FINANCE_VALIDATION_ITEM}/decision`,
    `POST ${BASELINE}`,
  ];
}
