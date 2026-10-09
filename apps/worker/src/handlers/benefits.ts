// benefits job handlers (T-DG4-KBE-E; p4-work-split §B.3; ADR-0030 §3, §6; REQ-S12-014, REQ-S07-014, REQ-S12-006):
//
// 1. `benefits.finance_queue` (consumer benefits.finance_queue.v1), fed by benefit.evidence_submitted: in ONE transaction
//    under the kit's runOnce (key = the event's idempotency key) and lock 730233 (key: the measurement id) it inserts
//    exactly one finance_validation queue item (kind validation, status queued, idempotency_key = the event key, the
//    six-key content snapshot, assignee = the benefit's Finance validator or NULL = the transformation's FIN party), one
//    audit event by the service actor, and one finance_validation_review work item per recipient through
//    createWorkItemOnce (key finance_validation:<financeValidationId>:<userId>). Exactly once: a replayed event finds the
//    processed_message row; a second insert is refused by finance_validation_one_per_measurement and
//    finance_validation_idempotency_key, and the handler checks for the existing item first ("already done").
// 2. `benefits.recalculate_pending` (consumer benefits.recalculate_pending.v1), fed by kpi.values_recalculated: for a
//    run triggered by an ACCEPTED KPI actual, every active benefit at Measure, Correct or Sustain with
//    finance_validation_required whose agreed KPI is in the run gets ONE pending measurement for the run's reporting
//    period (source kpi_recalculation, status submitted, no submitter, calculation_run_id = the run; at most one per
//    benefit and run, benefit_measurement_run_key), its lineage (benefit_calculation + input rows bound to the accepted
//    KPI value version) and its queue item (key benefit.value_recalculated:<measurementId>). An earlier pending
//    kpi_recalculation value of the same benefit and period is superseded first and its queue item withdrawn. A benefit
//    whose period already has a manual or validated live measurement is left unchanged (listed in the result). The new
//    value is PENDING: the validated total is unchanged (REQ-S07-014).
// 3. `benefits.value_decided` (consumer benefits.value_decided.v1), fed by benefit.value_validated / value_rejected:
//    acknowledges the decision events (ledger row only; slice J reads the tables), so the relay always has a queue.
// After a pending value is created, benefit.variance_evaluated is written for slice E (REQ-PB-085).
// A job never decides a Finance validation or any business approval (S-13): it only creates queue items and pending
// values. Nothing here touches the engineering gates DG0-DG7. Money and KPI values are decimal strings (decimal.js).
import { insertAuditEvent, sql, type Db, type Tx } from "@mth/db";
import { evaluateFormula, FORMULA_DECIMAL as D, type FormulaVariable } from "@mth/shared/calc";
import {
  benefitEvidenceSubmittedV1,
  buildFinanceContent,
  canonicalDecimal,
  kpiValuesRecalculatedV1,
  outboxEnvelope,
  outboxPayloadSchema,
  type BenefitMeasurementInput,
} from "@mth/shared/schemas";
import { createWorkItemOnce, jobActor, runOnce } from "../kit.ts";
import type { JobHandler } from "./spec.ts";

export const FINANCE_QUEUE = "benefits.finance_queue";
export const FINANCE_QUEUE_CONSUMER = "benefits.finance_queue.v1";
export const RECALCULATE_PENDING_QUEUE = "benefits.recalculate_pending";
export const RECALCULATE_PENDING_CONSUMER = "benefits.recalculate_pending.v1";
export const VALUE_DECIDED_QUEUE = "benefits.value_decided";
export const VALUE_DECIDED_CONSUMER = "benefits.value_decided.v1";
/** ADR-0016 §6 lock class financeValidationQueue (apps/api platform/advisory-locks.ts; the worker imports no API code). */
export const FINANCE_VALIDATION_QUEUE_LOCK = 730233;
const FINANCE_PARTY = "FIN";
const TASK_KIND = "finance_validation_review";

type Actor = ReturnType<typeof jobActor>;

async function lockQueue(tx: Tx, measurementId: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(${FINANCE_VALIDATION_QUEUE_LOCK}::int4, hashtext(${measurementId}))`.execute(
    tx,
  );
}

async function uuid(tx: Tx): Promise<string> {
  return (await sql<{ id: string }>`SELECT mth_uuid_v7() AS id`.execute(tx)).rows[0]!.id;
}

const money4 = (v: string): string => new D(v).toDecimalPlaces(4, D.ROUND_HALF_UP).toFixed(4);

async function enqueue(
  tx: Tx,
  organizationId: string,
  eventType: "benefit.variance_evaluated",
  idempotencyKey: string,
  aggregateId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const schema = outboxPayloadSchema(eventType, 1)!;
  await tx
    .insertInto("outbox_event")
    .values({
      id: sql<string>`mth_uuid_v7()`,
      organization_id: organizationId,
      aggregate_type: "benefit_measurement",
      aggregate_id: aggregateId,
      event_type: eventType,
      schema_version: 1,
      payload: JSON.stringify(schema.parse(payload)),
      idempotency_key: idempotencyKey,
    })
    .onConflict((oc) => oc.column("idempotency_key").doNothing())
    .execute();
}

/** benefit.variance_evaluated for a pending value (offTrack null = Unknown when no planned value of the period). */
async function enqueueVariance(
  tx: Tx,
  organizationId: string,
  m: { id: string; benefit_id: string; period_start: string; period_end: string; amount: string | null },
): Promise<void> {
  const planned = await tx
    .selectFrom("benefit_plan_value")
    .select("amount")
    .where("benefit_id", "=", m.benefit_id)
    .where("value_kind", "=", "planned")
    .where("period_start", "=", m.period_start)
    .where("period_end", "=", m.period_end)
    .executeTakeFirst();
  const plannedAmount = planned?.amount ?? null;
  const known = plannedAmount !== null && m.amount !== null;
  await enqueue(tx, organizationId, "benefit.variance_evaluated", `benefit.variance_evaluated:${m.id}`, m.id, {
    benefitId: m.benefit_id,
    measurementId: m.id,
    periodStart: m.period_start,
    periodEnd: m.period_end,
    plannedAmount,
    measuredAmount: m.amount,
    variance: known ? money4(new D(m.amount!).minus(new D(plannedAmount)).toFixed()) : null,
    offTrack: known ? new D(m.amount!).lt(new D(plannedAmount)) : null,
  });
}

// ------------------------------------------------------------------------------------------------ the queue item

/**
 * The recipients of a queue item's task: the named assignee, else the transformation's mapped FIN party (the person, or
 * the mapped group's current active members). The submitter never receives it (they could not validate it). Sorted;
 * may be empty (the item is still listed in the queue).
 */
async function recipientsOf(
  tx: Tx,
  transformationId: string,
  assignee: string | null,
  submitter: string | null,
): Promise<string[]> {
  let ids: string[] = [];
  if (assignee !== null) ids = [assignee];
  else {
    const m = await tx
      .selectFrom("role_mapping")
      .select(["target_kind", "user_id", "group_id"])
      .where("transformation_id", "=", transformationId)
      .where("party_code", "=", FINANCE_PARTY)
      .where("status", "=", "active")
      .executeTakeFirst();
    if (m?.target_kind === "user" && m.user_id !== null) ids = [m.user_id];
    else if (m?.target_kind === "group" && m.group_id !== null) {
      const rows = await tx
        .selectFrom("access_group_member as gm")
        .innerJoin("access_group as g", "g.id", "gm.group_id")
        .innerJoin("app_user as u", "u.id", "gm.user_id")
        .select("gm.user_id")
        .where("gm.group_id", "=", m.group_id)
        .where("g.status", "=", "active")
        .where("u.status", "=", "active")
        .where(
          sql<boolean>`(gm.removed_at IS NULL AND gm.effective_from <= now() AND (gm.effective_to IS NULL OR gm.effective_to > now()))`,
        )
        .execute();
      ids = rows.map((r) => r.user_id);
    }
  }
  return [...new Set(ids)].filter((id) => id !== submitter).sort();
}

export type QueueItemOutcome = "created" | "already_queued" | "not_submitted";

/**
 * Inserts the one queue item of a submitted measurement (ADR-0030 §3) with its audit event and tasks, in `tx`. Call
 * under lock 730233 for the measurement. Returns "already_queued" when the item exists (exactly once).
 */
export async function insertQueueItem(
  tx: Tx,
  actor: Actor,
  measurementId: string,
  idempotencyKey: string,
): Promise<{ outcome: QueueItemOutcome; financeValidationId: string | null }> {
  const m = await tx.selectFrom("benefit_measurement").selectAll().where("id", "=", measurementId).executeTakeFirst();
  if (!m || m.kind !== "measurement" || m.status !== "submitted")
    return { outcome: "not_submitted", financeValidationId: null };
  const existing = await tx
    .selectFrom("finance_validation")
    .select("id")
    .where((eb) =>
      eb.or([eb("benefit_measurement_id", "=", measurementId), eb("idempotency_key", "=", idempotencyKey)]),
    )
    .where("kind", "=", "validation")
    .executeTakeFirst();
  if (existing) return { outcome: "already_queued", financeValidationId: existing.id };
  const b = await tx.selectFrom("benefit").selectAll().where("id", "=", m.benefit_id).executeTakeFirstOrThrow();
  const inputRows = await tx
    .selectFrom("benefit_measurement_input")
    .selectAll()
    .where("measurement_id", "=", m.id)
    .orderBy("variable_name")
    .execute();
  const inputs: BenefitMeasurementInput[] = inputRows.map((r) => ({
    variableName: r.variable_name,
    kpiActualId: r.kpi_actual_id,
    kpiValueNo: r.kpi_value_no,
    value: canonicalDecimal(r.value),
    periodStart: r.period_start,
    periodEnd: r.period_end,
  }));
  const evidence = await tx
    .selectFrom("benefit_evidence")
    .select("evidence_id")
    .where("measurement_id", "=", m.id)
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  const content = buildFinanceContent({
    benefit: b,
    measurement: m,
    inputs,
    evidenceIds: [...new Set(evidence.map((e) => e.evidence_id))],
  });
  const id = await uuid(tx);
  const createdBy = m.submitted_by ?? m.created_by;
  await tx
    .insertInto("finance_validation")
    .values({
      id,
      organization_id: m.organization_id,
      transformation_id: m.transformation_id,
      benefit_id: m.benefit_id,
      benefit_measurement_id: m.id,
      kind: "validation",
      idempotency_key: idempotencyKey,
      assignee_user_id: b.finance_validator_user_id,
      status: "queued",
      content: JSON.stringify(content),
      measurement_period_start: m.period_start,
      measurement_period_end: m.period_end,
      created_by: createdBy,
      updated_by: createdBy,
    })
    .execute();
  await insertAuditEvent(tx, actor, {
    action: "finance_validation.queued",
    recordType: "finance_validation",
    recordId: id,
    organizationId: m.organization_id,
    transformationId: m.transformation_id,
    newVersion: 1,
    changes: {
      benefit_measurement_id: { from: null, to: m.id },
      status: { from: null, to: "queued" },
      assignee_user_id: { from: null, to: b.finance_validator_user_id },
      idempotency_key: { from: null, to: idempotencyKey },
    },
  });
  for (const userId of await recipientsOf(tx, m.transformation_id, b.finance_validator_user_id, m.submitted_by))
    await createWorkItemOnce(tx, actor, {
      organizationId: m.organization_id,
      transformationId: m.transformation_id,
      kind: TASK_KIND,
      assigneeUserId: userId,
      subjectType: "finance_validation",
      subjectId: id,
      linkPath: `/transformations/${m.transformation_id}/finance-validations/${id}`,
      messageKey: "benefits.task.finance_validation_review",
      messageParams: { benefitCode: b.code, periodStart: m.period_start, periodEnd: m.period_end },
      dedupeKey: `finance_validation:${id}:${userId}`,
    });
  return { outcome: "created", financeValidationId: id };
}

export interface FinanceQueueResult {
  readonly outcome: "done" | "duplicate";
  readonly item: QueueItemOutcome | null;
  readonly financeValidationId: string | null;
}

/** benefits.finance_queue: one queue item per benefit.evidence_submitted (REQ-S12-014). Exported for the tests. */
export async function queueFinanceValidation(db: Db, data: unknown, jobId: string): Promise<FinanceQueueResult> {
  const envelope = outboxEnvelope.parse(data);
  const payload = benefitEvidenceSubmittedV1.parse(envelope.payload);
  const res = await runOnce(db, FINANCE_QUEUE_CONSUMER, envelope.idempotencyKey, async (tx) => {
    await lockQueue(tx, payload.measurementId);
    return insertQueueItem(tx, jobActor(jobId), payload.measurementId, envelope.idempotencyKey);
  });
  return res.outcome === "duplicate"
    ? { outcome: "duplicate", item: null, financeValidationId: null }
    : { outcome: "done", item: res.result.outcome, financeValidationId: res.result.financeValidationId };
}

// ------------------------------------------------------------------------------------------------ pending values

export interface PendingResult {
  readonly outcome: "done" | "duplicate" | "skipped";
  readonly created: readonly string[];
  readonly superseded: readonly string[];
  /** Benefits left unchanged, with the reason (the handler's run log). */
  readonly unchanged: readonly { benefitId: string; reason: string }[];
}

interface CalculationLineage {
  readonly inputs: Record<string, unknown>;
  readonly outcome: "ok" | "error";
  readonly result: string | null;
  readonly resultKind: string;
  readonly resultUnit: string | null;
  readonly resultCurrency: string | null;
  readonly resultPeriod: string;
  readonly errorCode: string | null;
  readonly rounded: boolean;
  readonly rounding: unknown;
  readonly engineVersion: string;
}

interface Computed {
  readonly amount: string | null;
  readonly kpiValue: string | null;
  readonly missingReason: string | null;
  readonly formulaVersionId: string | null;
  readonly calculation: CalculationLineage | null;
  readonly inputs: readonly { name: string; value: string; kpiActualId: string | null; kpiValueNo: number | null }[];
}

/**
 * The value of a benefit for an accepted KPI value (ADR-0030 §5): through its formula's CURRENT version with the
 * KPI-bound variable set to the accepted value (DG3 engine, unchanged), or, for a non-financial benefit without a SAR
 * value, the KPI value itself. Null when the benefit cannot be computed from the KPI (no formula binding).
 */
async function computeFor(
  tx: Tx,
  b: {
    benefit_formula_id: string | null;
    measurement_kpi_variable: string | null;
    value_class: string;
    currency: string;
  },
  unmonetised: boolean,
  kpi: { kpiActualId: string; valueNo: number; value: string },
): Promise<Computed | "no_formula_binding" | "formula_invalid"> {
  const variable = b.measurement_kpi_variable;
  if (b.benefit_formula_id === null || variable === null) {
    if (b.value_class !== "non_financial") return "no_formula_binding";
    return {
      amount: null,
      kpiValue: kpi.value,
      missingReason: null,
      formulaVersionId: null,
      calculation: null,
      inputs: [
        { name: variable ?? "kpi_value", value: kpi.value, kpiActualId: kpi.kpiActualId, kpiValueNo: kpi.valueNo },
      ],
    };
  }
  const version = await tx
    .selectFrom("benefit_formula as f")
    .innerJoin("benefit_formula_version as v", (j) =>
      j.onRef("v.formula_id", "=", "f.id").onRef("v.version_no", "=", "f.current_version_no"),
    )
    .selectAll("v")
    .where("f.id", "=", b.benefit_formula_id)
    .executeTakeFirst();
  if (!version) return "no_formula_binding";
  const rows = await tx
    .selectFrom("benefit_formula_variable")
    .selectAll()
    .where("formula_version_id", "=", version.id)
    .orderBy("ordinal")
    .execute();
  if (!rows.some((r) => r.name === variable)) return "no_formula_binding";
  const variables: FormulaVariable[] = rows.map((v) => ({
    name: v.name,
    kind: v.kind as FormulaVariable["kind"],
    period: v.period as FormulaVariable["period"],
    unit: v.unit,
    currency: v.currency === null ? null : v.currency.trim(),
    value: v.value === null ? null : canonicalDecimal(v.value),
    source: v.source,
    description: v.description,
  }));
  const evaluation = evaluateFormula(version.expression, variables, { [variable]: kpi.value });
  if (!evaluation.ok) return "formula_invalid";
  const used = new Map(Object.entries(evaluation.inputs));
  const inputs: Computed["inputs"][number][] = [];
  const lineage: Record<string, unknown> = {};
  for (const v of variables) {
    const value = used.has(v.name) ? (used.get(v.name) ?? null) : (v.value ?? null);
    lineage[v.name] = {
      name: v.name,
      kind: v.kind,
      unit: v.unit ?? null,
      currency: v.currency ?? null,
      period: v.period,
      value: value === null ? null : canonicalDecimal(value),
      description: v.description ?? null,
      source: v.name === variable ? `KPI actual ${kpi.kpiActualId} value ${kpi.valueNo}` : (v.source ?? null),
    };
    if (value !== null)
      inputs.push({
        name: v.name,
        value: canonicalDecimal(value),
        kpiActualId: v.name === variable ? kpi.kpiActualId : null,
        kpiValueNo: v.name === variable ? kpi.valueNo : null,
      });
  }
  const result = evaluation.result === null ? null : evaluation.rounding.stored;
  return {
    amount: result === null || unmonetised ? null : money4(result),
    kpiValue: result !== null && unmonetised ? result : null,
    missingReason: result === null ? `Not computable: ${evaluation.errorCode ?? "formula.missing_input"}` : null,
    formulaVersionId: version.id,
    calculation: {
      inputs: lineage,
      outcome: result === null ? "error" : "ok",
      result,
      resultKind: version.result_kind,
      resultUnit: version.result_unit,
      resultCurrency: version.result_currency,
      resultPeriod: version.result_period,
      errorCode: result === null ? (evaluation.errorCode ?? "formula.missing_input") : null,
      rounded: evaluation.rounding.rounded,
      rounding: evaluation.rounding,
      engineVersion: evaluation.engineVersion,
    },
    inputs,
  };
}

/** Supersedes an earlier pending kpi_recalculation value and withdraws its queue item (both audited, service actor). */
async function supersede(
  tx: Tx,
  actor: Actor,
  m: { id: string; version: number; organization_id: string; transformation_id: string },
) {
  await lockQueue(tx, m.id);
  const items = await tx
    .selectFrom("finance_validation")
    .selectAll()
    .where("benefit_measurement_id", "=", m.id)
    .where("status", "=", "queued")
    .forUpdate()
    .execute();
  for (const fv of items) {
    await tx
      .updateTable("finance_validation")
      .set({ status: "withdrawn", version: fv.version + 1, updated_at: sql<Date>`now()` })
      .where("id", "=", fv.id)
      .execute();
    await insertAuditEvent(tx, actor, {
      action: "finance_validation.withdrawn",
      recordType: "finance_validation",
      recordId: fv.id,
      organizationId: fv.organization_id,
      transformationId: fv.transformation_id,
      priorVersion: fv.version,
      newVersion: fv.version + 1,
      changes: { status: { from: "queued", to: "withdrawn" } },
    });
    const open = await tx
      .selectFrom("work_item")
      .selectAll()
      .where("organization_id", "=", fv.organization_id)
      .where("subject_type", "=", "finance_validation")
      .where("subject_id", "=", fv.id)
      .where("status", "=", "open")
      .forUpdate()
      .execute();
    for (const w of open) {
      await tx
        .updateTable("work_item")
        .set({ status: "cancelled", version: w.version + 1, updated_at: sql<Date>`now()`, updated_by: null })
        .where("id", "=", w.id)
        .execute();
      await insertAuditEvent(tx, actor, {
        action: "work_item.cancel",
        recordType: "work_item",
        recordId: w.id,
        organizationId: w.organization_id,
        transformationId: w.transformation_id,
        priorVersion: w.version,
        newVersion: w.version + 1,
        changes: { status: { from: "open", to: "cancelled" } },
      });
    }
  }
  await tx
    .updateTable("benefit_measurement")
    .set({ status: "superseded", version: m.version + 1, updated_at: sql<Date>`now()` })
    .where("id", "=", m.id)
    .execute();
  await insertAuditEvent(tx, actor, {
    action: "benefit_measurement.superseded",
    recordType: "benefit_measurement",
    recordId: m.id,
    organizationId: m.organization_id,
    transformationId: m.transformation_id,
    priorVersion: m.version,
    newVersion: m.version + 1,
    changes: { status: { from: "submitted", to: "superseded" } },
  });
}

async function createPending(
  tx: Tx,
  jobId: string,
  payload: { runId: string; transformationId: string; kpiDefinitionIds: string[]; reportingPeriodId: string | null },
): Promise<PendingResult> {
  const actor = jobActor(jobId);
  const empty = { created: [], superseded: [], unchanged: [] };
  if (payload.reportingPeriodId === null || payload.kpiDefinitionIds.length === 0)
    return { outcome: "skipped", ...empty };
  const run = await tx
    .selectFrom("calculation_run")
    .select(["id", "trigger_kind", "trigger_record_id"])
    .where("id", "=", payload.runId)
    .executeTakeFirst();
  // Only an accepted KPI actual brings a new value (REQ-S07-014); threshold, trajectory and version runs do not.
  if (!run || run.trigger_kind !== "actual_accepted") return { outcome: "skipped", ...empty };
  const benefits = await tx
    .selectFrom("benefit as b")
    .leftJoin("benefit_valuation_method as method", "method.id", "b.valuation_method_id")
    .selectAll("b")
    .select("method.status as method_status")
    .where("b.transformation_id", "=", payload.transformationId)
    .where("b.status", "=", "active")
    .where("b.finance_validation_required", "=", true)
    .where("b.lifecycle_step", "in", ["measure", "correct", "sustain"])
    .where("b.measurement_kpi_definition_id", "in", payload.kpiDefinitionIds)
    .orderBy("b.code")
    .execute();
  const created: string[] = [];
  const superseded: string[] = [];
  const unchanged: { benefitId: string; reason: string }[] = [];
  for (const b of benefits) {
    if (await tx.selectFrom("benefit").select("id").where("parent_benefit_id", "=", b.id).executeTakeFirst()) {
      unchanged.push({ benefitId: b.id, reason: "parent_rollup" });
      continue;
    }
    const actual = await tx
      .selectFrom("kpi_actual as a")
      .innerJoin("kpi_actual_value as v", (j) =>
        j.onRef("v.kpi_actual_id", "=", "a.id").onRef("v.value_no", "=", "a.accepted_value_no"),
      )
      .select(["a.id", "a.period_start", "a.period_end", "a.decided_by", "a.created_by", "v.value_no", "v.value"])
      .where("a.kpi_definition_id", "=", b.measurement_kpi_definition_id!)
      .where("a.scope_kind", "=", "transformation")
      .where("a.reporting_period_id", "=", payload.reportingPeriodId)
      .where("a.accepted_value_no", "is not", null)
      .executeTakeFirst();
    if (!actual || actual.value === null) {
      unchanged.push({ benefitId: b.id, reason: "no_accepted_value" });
      continue;
    }
    if (
      await tx
        .selectFrom("benefit_measurement")
        .select("id")
        .where("benefit_id", "=", b.id)
        .where("calculation_run_id", "=", payload.runId)
        .executeTakeFirst()
    ) {
      unchanged.push({ benefitId: b.id, reason: "already_pending_for_run" });
      continue;
    }
    const live = await tx
      .selectFrom("benefit_measurement")
      .select(["id", "source", "status", "version", "organization_id", "transformation_id"])
      .where("benefit_id", "=", b.id)
      .where("kind", "=", "measurement")
      .where("status", "in", ["draft", "submitted", "validated"])
      .where("period_start", "=", actual.period_start)
      .where("period_end", "=", actual.period_end)
      .executeTakeFirst();
    if (live && (live.source !== "kpi_recalculation" || live.status !== "submitted")) {
      unchanged.push({
        benefitId: b.id,
        reason: live.source === "manual" ? "manual_measurement_live" : "validated_live",
      });
      continue;
    }
    const unmonetised = b.value_class === "non_financial" && b.method_status !== "approved";
    const computed = await computeFor(tx, b, unmonetised, {
      kpiActualId: actual.id,
      valueNo: actual.value_no,
      value: canonicalDecimal(actual.value),
    });
    if (typeof computed === "string") {
      unchanged.push({ benefitId: b.id, reason: computed });
      continue;
    }
    if (live) {
      await supersede(tx, actor, live);
      superseded.push(live.id);
    }
    const by = actual.decided_by ?? actual.created_by;
    const period = { start: actual.period_start, end: actual.period_end };
    let calculationId: string | null = null;
    if (computed.calculation !== null && computed.formulaVersionId !== null) {
      const c = computed.calculation;
      calculationId = await uuid(tx);
      await tx
        .insertInto("benefit_calculation")
        .values({
          id: calculationId,
          organization_id: b.organization_id,
          transformation_id: b.transformation_id,
          formula_version_id: computed.formulaVersionId,
          inputs: JSON.stringify(c.inputs),
          assumptions: null,
          period_start: period.start,
          period_end: period.end,
          outcome: c.outcome,
          result: c.result,
          result_kind: c.resultKind,
          result_unit: c.resultUnit,
          result_currency: c.resultCurrency,
          result_period: c.resultPeriod,
          error_code: c.errorCode,
          rounded: c.rounded,
          rounding: JSON.stringify(c.rounding),
          engine_version: c.engineVersion,
          computed_by: by,
        })
        .execute();
    }
    const no = await tx
      .selectFrom("benefit_measurement")
      .select((eb) => eb.fn.max("measurement_no").as("n"))
      .where("benefit_id", "=", b.id)
      .executeTakeFirstOrThrow();
    const id = await uuid(tx);
    await lockQueue(tx, id);
    const row = await tx
      .insertInto("benefit_measurement")
      .values({
        id,
        organization_id: b.organization_id,
        transformation_id: b.transformation_id,
        benefit_id: b.id,
        measurement_no: Number(no.n ?? 0) + 1,
        kind: "measurement",
        source: "kpi_recalculation",
        calculation_run_id: payload.runId,
        benefit_calculation_id: calculationId,
        formula_version_id: computed.formulaVersionId,
        period_start: period.start,
        period_end: period.end,
        amount: computed.amount,
        kpi_value: computed.kpiValue,
        currency: b.currency.trim(),
        missing_reason: computed.missingReason,
        status: "submitted",
        submitted_by: null,
        submitted_at: sql<Date>`now()`,
        created_by: by,
        updated_by: by,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    for (const i of computed.inputs)
      await tx
        .insertInto("benefit_measurement_input")
        .values({
          id: await uuid(tx),
          organization_id: b.organization_id,
          transformation_id: b.transformation_id,
          measurement_id: id,
          variable_name: i.name,
          kpi_actual_id: i.kpiActualId,
          kpi_value_no: i.kpiValueNo,
          value: i.value,
          period_start: period.start,
          period_end: period.end,
          created_by: by,
        })
        .execute();
    await insertAuditEvent(tx, actor, {
      action: "benefit_measurement.recalculated",
      recordType: "benefit_measurement",
      recordId: id,
      organizationId: b.organization_id,
      transformationId: b.transformation_id,
      newVersion: 1,
      changes: {
        source: { from: null, to: "kpi_recalculation" },
        status: { from: null, to: "submitted" },
        calculation_run_id: { from: null, to: payload.runId },
        amount: { from: null, to: row.amount },
        kpi_value: { from: null, to: row.kpi_value },
        period_start: { from: null, to: period.start },
        period_end: { from: null, to: period.end },
      },
    });
    await insertQueueItem(tx, actor, id, `benefit.value_recalculated:${id}`);
    await enqueueVariance(tx, b.organization_id, {
      id,
      benefit_id: b.id,
      period_start: period.start,
      period_end: period.end,
      amount: row.amount,
    });
    created.push(id);
  }
  return { outcome: "done", created, superseded, unchanged };
}

/** benefits.recalculate_pending: pending values after an accepted KPI actual (REQ-S07-014). Exported for the tests. */
export async function recalculatePending(db: Db, data: unknown, jobId: string): Promise<PendingResult> {
  const envelope = outboxEnvelope.parse(data);
  const payload = kpiValuesRecalculatedV1.parse(envelope.payload);
  const res = await runOnce(db, RECALCULATE_PENDING_CONSUMER, envelope.idempotencyKey, (tx) =>
    createPending(tx, jobId, payload),
  );
  return res.outcome === "duplicate"
    ? { outcome: "duplicate", created: [], superseded: [], unchanged: [] }
    : res.result;
}

/** benefits.value_decided: acknowledges a Finance decision event once (ledger row only). */
export async function acknowledgeDecision(db: Db, data: unknown, _jobId: string): Promise<{ outcome: string }> {
  const envelope = outboxEnvelope.parse(data);
  const res = await runOnce(db, VALUE_DECIDED_CONSUMER, envelope.idempotencyKey, async () => null, "skipped");
  return { outcome: res.outcome };
}

export const BENEFITS_HANDLERS: readonly JobHandler[] = [
  { queue: FINANCE_QUEUE, handle: queueFinanceValidation },
  { queue: RECALCULATE_PENDING_QUEUE, handle: recalculatePending },
  { queue: VALUE_DECIDED_QUEUE, handle: acknowledgeDecision },
];
