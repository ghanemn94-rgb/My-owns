// Benefit measurements and their calculation lineage (P4 slice B; ADR-0030 §2, §3, §5, §8, §11; T-DG4-KBE-E;
// REQ-S08-004, REQ-S08-006, REQ-S08-008, REQ-S08-016, REQ-S08-017, REQ-S12-014, REQ-S16-017 "BenefitMeasurement"):
//   GET   /transformations/{t}/benefits/{benefitId}/measurements           newest first, with status, basis, corrections
//   POST  /transformations/{t}/benefits/{benefitId}/measurements           a draft, or submitted at once (submit: true)
//   GET   /transformations/{t}/benefit-measurements/{measurementId}        one measurement with its lineage and evidence
//   PATCH /transformations/{t}/benefit-measurements/{measurementId}        change a DRAFT (If-Match)
//   POST  /transformations/{t}/benefit-measurements/{measurementId}/submit submit a draft for Finance validation
//
// - Measurements start at Measure (Measure, Correct, Sustain): a delivered enabler is not realized value (422
//   benefit_measurement.step). One live measurement per benefit and period (409 benefit_measurement.period_taken).
// - A value is an amount, a KPI value, or a missing reason (Unknown: NULL, never 0; 422 benefit_measurement.value_shape).
// - With `formulaVersionId` the amount is computed by the DG3 restricted engine (`evaluateFormula` of @mth/shared/calc,
//   unchanged, S-9): a non-whitelisted call or a JavaScript payload is refused at parse time by the engine; there is
//   no eval/Function here. The benefit's KPI-bound variable takes the ACCEPTED KPI actual of the measurement period
//   (value version recorded); the other variables keep the formula version's values unless the body overrides them.
//   The lineage is one benefit_calculation row plus one benefit_measurement_input row per variable used, all for the
//   measurement period (REQ-S08-006, REQ-S08-008).
// - Submitting (create with submit: true, or submit): the period and, for a manual value, at least one piece of
//   evidence are required; under the financeValidationQueue advisory lock (key: measurement id) the row becomes `submitted` with one audit event and
//   one outbox event benefit.evidence_submitted (key benefit.evidence_submitted:<measurementId>); the worker creates
//   exactly one Finance queue item (REQ-S12-014). A submitted value is PENDING: it never changes a validated total.
// - A validated row is never edited: 409 benefit_measurement.validated_immutable (REQ-S08-017); corrections are
//   amendments and reversals (corrections.ts). Submitted, rejected and superseded rows are not drafts (422 not_draft).
// - Permission benefit.measure (BO, WL, KDS); AUD and ADM-only callers get 403; reads need transformation.read (404
//   outside scope). Every mutation re-checks authorization at commit time, validates, checks If-Match and writes its
//   audit events in the same transaction, with no client or remote I/O inside it.
// Nothing here validates a value: only a Finance decision does (finance-validation.ts). Nothing touches DG0-DG7.
import {
  diffFields,
  sql,
  type BenefitFormulaVariableRow,
  type BenefitMeasurementRow,
  type BenefitRow,
  type DbOrTx,
  type Tx,
} from "@mth/db";
import { evaluateFormula, type FormulaVariable } from "@mth/shared/calc";
import {
  benefitMeasurementCreate,
  benefitMeasurementUpdate,
  canonicalDecimal,
  type BenefitMeasurement,
  type BenefitMeasurementCreate,
  type BenefitMeasurementInput,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import type { Permission } from "@mth/shared";
import { PROBLEM_TYPES } from "@mth/shared";
import { principalOf, requireTransformationRead } from "../access/index.ts";
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
import {
  assertSameTransformation,
  bumpStamps,
  maybeIdempotent,
  sendCreated,
  type WriteContext,
} from "../transformations/index.ts";
import {
  archivedBenefit,
  BENEFITS,
  benefitRule,
  JSON_BODY,
  lockBenefit,
  openBenefitWrite,
  parseBenefitParams,
  readBenefitRow,
} from "./register.ts";
import {
  basisOf,
  enqueueBenefitEvent,
  isParent,
  isUnmonetised,
  money4,
  parentRollup,
  valueUnmonetised,
} from "./values.ts";

export const BENEFIT_MEASURE: Permission = "benefit.measure";
export const MEASUREMENTS = "/api/v1/transformations/:transformationId/benefit-measurements";
export const MEASUREMENT_ITEM = `${MEASUREMENTS}/:benefitMeasurementId`;
/** Source of a variable value given in the measurement request instead of the formula version's own value. */
export const MEASUREMENT_OVERRIDE_SOURCE = "Measurement input (overrides the version value)";

// ------------------------------------------------------------------------------------------------ problems (ADR-0030 §11)

export const measurementStep = (code: string, step: string) =>
  benefitRule(
    "benefit_measurement.step",
    `Benefit ${code} is at the ${step} step. Measurements start at Measure; a delivered enabler is not realized value.`,
  );
export const periodRequired = () =>
  benefitRule(
    "benefit_measurement.period_required",
    "A measurement needs its measurement period before it is submitted.",
    "/periodStart",
  );
export const periodTaken = (code: string, start: string, end: string) =>
  problems.duplicate(
    "benefit_measurement.period_taken",
    `Benefit ${code} already has a live measurement for ${start} to ${end}. Correct that one instead.`,
  );
export const valueShape = (pointer = "/amount") =>
  benefitRule(
    "benefit_measurement.value_shape",
    "Enter an amount, a KPI value, or why the value is not available.",
    pointer,
  );
export const evidenceRequired = () =>
  benefitRule(
    "benefit_measurement.evidence_required",
    "A measurement is submitted with at least one piece of evidence.",
    "/evidenceIds",
  );
export const notDraft = () =>
  benefitRule("benefit_measurement.not_draft", "Only a draft measurement can be changed or submitted.");
export const validatedImmutable = () =>
  new HttpProblem({
    status: 409,
    type: PROBLEM_TYPES.invalidTransition,
    code: "benefit_measurement.validated_immutable",
    title: "Invalid transition",
    detail: "A validated value is never edited. Record an amendment or a reversal.",
  });
export const lineagePeriod = (start: string, end: string) =>
  benefitRule(
    "benefit_measurement.lineage_period",
    `Every input is for the measurement period ${start} to ${end}.`,
    "/periodStart",
  );
const formulaProblem = (code: string, message: string, pointer = "/formulaVersionId") =>
  benefitRule(code, message, pointer);

// ------------------------------------------------------------------------------------------------ presenters

export const MEASUREMENT_AUDIT_FIELDS = [
  "benefit_id",
  "measurement_no",
  "kind",
  "corrects_measurement_id",
  "source",
  "calculation_run_id",
  "benefit_calculation_id",
  "formula_version_id",
  "period_start",
  "period_end",
  "amount",
  "kpi_value",
  "currency",
  "missing_reason",
  "attribution",
  "assumptions",
  "status",
  "sustain_phase",
  "validated_amount",
  "submitted_by",
  "decided_by",
  "reason",
] as const satisfies readonly (keyof BenefitMeasurementRow & string)[];

/** The lineage inputs of measurements (variable name order), keyed by measurement id. */
export async function inputsOf(
  db: DbOrTx,
  measurementIds: readonly string[],
): Promise<Map<string, BenefitMeasurementInput[]>> {
  const out = new Map<string, BenefitMeasurementInput[]>();
  if (measurementIds.length === 0) return out;
  const rows = await db
    .selectFrom("benefit_measurement_input")
    .selectAll()
    .where("measurement_id", "in", [...measurementIds])
    .orderBy("variable_name")
    .execute();
  for (const r of rows) {
    const list = out.get(r.measurement_id) ?? [];
    list.push({
      variableName: r.variable_name,
      kpiActualId: r.kpi_actual_id,
      kpiValueNo: r.kpi_value_no,
      value: canonicalDecimal(r.value),
      periodStart: r.period_start,
      periodEnd: r.period_end,
    });
    out.set(r.measurement_id, list);
  }
  return out;
}

/** Evidence linked to measurements (oldest link first), keyed by measurement id. */
export async function evidenceOf(db: DbOrTx, measurementIds: readonly string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (measurementIds.length === 0) return out;
  const rows = await db
    .selectFrom("benefit_evidence")
    .select(["measurement_id", "evidence_id"])
    .where("measurement_id", "in", [...measurementIds])
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  for (const r of rows) {
    const list = out.get(r.measurement_id!) ?? [];
    if (!list.includes(r.evidence_id)) list.push(r.evidence_id);
    out.set(r.measurement_id!, list);
  }
  return out;
}

/** API measurements with lineage, evidence, their Finance validation and basis (one query per concern). */
export async function presentMeasurements(
  db: DbOrTx,
  rows: readonly BenefitMeasurementRow[],
): Promise<BenefitMeasurement[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const inputs = await inputsOf(db, ids);
  const evidence = await evidenceOf(db, ids);
  const validations = await db
    .selectFrom("finance_validation")
    .select(["id", "benefit_measurement_id", "created_at"])
    .where("benefit_measurement_id", "in", ids)
    .orderBy("created_at", "desc")
    .execute();
  const benefits = await db
    .selectFrom("benefit")
    .select(["id", "baseline_validation_status"])
    .where("id", "in", [...new Set(rows.map((r) => r.benefit_id))])
    .execute();
  const out: BenefitMeasurement[] = [];
  for (const r of rows) {
    const benefit = benefits.find((b) => b.id === r.benefit_id)!;
    out.push({
      id: r.id,
      benefitId: r.benefit_id,
      measurementNo: r.measurement_no,
      kind: r.kind as BenefitMeasurement["kind"],
      correctsMeasurementId: r.corrects_measurement_id,
      source: r.source as BenefitMeasurement["source"],
      calculationRunId: r.calculation_run_id,
      benefitCalculationId: r.benefit_calculation_id,
      formulaVersionId: r.formula_version_id,
      periodStart: r.period_start,
      periodEnd: r.period_end,
      amount: r.amount,
      kpiValue: r.kpi_value,
      currency: r.currency.trim(),
      missingReason: r.missing_reason,
      attribution: r.attribution,
      assumptions: r.assumptions,
      status: r.status as BenefitMeasurement["status"],
      sustainPhase: r.sustain_phase,
      validatedAmount: r.validated_amount,
      basis: r.status === "validated" ? "validated" : await basisOf(db, benefit, r.formula_version_id),
      inputs: inputs.get(r.id) ?? [],
      evidenceIds: evidence.get(r.id) ?? [],
      financeValidationId: validations.find((v) => v.benefit_measurement_id === r.id)?.id ?? null,
      submittedBy: r.submitted_by,
      submittedAt: isoOrNull(r.submitted_at),
      decidedBy: r.decided_by,
      decidedAt: isoOrNull(r.decided_at),
      reason: r.reason,
      version: r.version,
      createdAt: iso(r.created_at),
      createdBy: r.created_by,
      updatedAt: iso(r.updated_at),
    });
  }
  return out;
}

export async function presentMeasurement(db: DbOrTx, row: BenefitMeasurementRow): Promise<BenefitMeasurement> {
  return (await presentMeasurements(db, [row]))[0]!;
}

// ------------------------------------------------------------------------------------------------ formula lineage

/** Engine variables of a formula version (ordinal order; values as exact decimal strings, null = no value). */
export function engineVariablesOf(rows: readonly BenefitFormulaVariableRow[]): FormulaVariable[] {
  return [...rows]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((v) => ({
      name: v.name,
      kind: v.kind as FormulaVariable["kind"],
      period: v.period as FormulaVariable["period"],
      unit: v.unit,
      currency: v.currency === null ? null : v.currency.trim(),
      value: v.value === null ? null : canonicalDecimal(v.value),
      source: v.source,
      description: v.description,
    }));
}

/** The accepted transformation-scope KPI actual of exactly this period, with its value version. */
export async function acceptedKpiActual(
  db: DbOrTx,
  kpiDefinitionId: string,
  periodStart: string,
  periodEnd: string,
): Promise<{ kpiActualId: string; valueNo: number; value: string } | null> {
  const r = await db
    .selectFrom("kpi_actual as a")
    .innerJoin("kpi_actual_value as v", (j) =>
      j.onRef("v.kpi_actual_id", "=", "a.id").onRef("v.value_no", "=", "a.accepted_value_no"),
    )
    .select(["a.id", "v.value_no", "v.value"])
    .where("a.kpi_definition_id", "=", kpiDefinitionId)
    .where("a.scope_kind", "=", "transformation")
    .where("a.period_start", "=", periodStart)
    .where("a.period_end", "=", periodEnd)
    .where("a.accepted_value_no", "is not", null)
    .executeTakeFirst();
  if (!r || r.value === null) return null;
  return { kpiActualId: r.id, valueNo: r.value_no, value: canonicalDecimal(r.value) };
}

/** One computed value with its lineage, ready to insert (ADR-0030 §5). */
export interface ComputedValue {
  readonly formulaVersionId: string;
  readonly result: string | null;
  readonly errorCode: string | null;
  readonly inputs: readonly {
    name: string;
    value: string;
    kpiActualId: string | null;
    kpiValueNo: number | null;
  }[];
  readonly calculation: {
    readonly inputs: Record<string, unknown>;
    readonly resultKind: string;
    readonly resultUnit: string | null;
    readonly resultCurrency: string | null;
    readonly resultPeriod: string;
    readonly rounded: boolean;
    readonly rounding: unknown;
    readonly engineVersion: string;
  };
}

/**
 * Evaluates a formula version of the benefit's formula for the measurement period on the DG3 engine (unchanged; S-9).
 * The benefit's KPI-bound variable takes the accepted KPI actual of the period; `overrides` replace other variables'
 * values. An engine refusal is 422 with the engine's code and message (parse time: no code ever runs). Division by
 * zero or a missing input gives `result: null` (Unknown) with the engine's error code, never 0.
 */
export async function computeWithFormula(
  db: DbOrTx,
  benefit: BenefitRow,
  formulaVersionId: string,
  period: { start: string; end: string },
  overrides: Readonly<Record<string, string>>,
): Promise<ComputedValue> {
  const version = await db
    .selectFrom("benefit_formula_version")
    .selectAll()
    .where("id", "=", formulaVersionId)
    .where("transformation_id", "=", benefit.transformation_id)
    .executeTakeFirst();
  if (!version)
    await assertSameTransformation(
      db,
      "benefit_formula_version",
      benefit.transformation_id,
      formulaVersionId,
      "/formulaVersionId",
    );
  if (version!.formula_id !== benefit.benefit_formula_id)
    throw formulaProblem(
      "validation.reference",
      "The formula version must be a version of the benefit's own formula.",
      "/formulaVersionId",
    );
  const rows = await db
    .selectFrom("benefit_formula_variable")
    .selectAll()
    .where("formula_version_id", "=", version!.id)
    .orderBy("ordinal")
    .execute();
  const variables = engineVariablesOf(rows);
  const given = new Map(Object.entries(overrides));
  for (const name of given.keys())
    if (!variables.some((v) => v.name === name))
      throw formulaProblem("formula.undefined_variable", `Undefined variable: ${name}`, `/variables/${name}`);
  const bound = benefit.measurement_kpi_variable;
  if (bound !== null && given.has(bound))
    throw formulaProblem(
      "benefit_measurement.lineage_period",
      `Every input is for the measurement period ${period.start} to ${period.end}.`,
      `/variables/${bound}`,
    );
  const inputs = new Map(given);
  let kpi: Awaited<ReturnType<typeof acceptedKpiActual>> = null;
  if (bound !== null && benefit.measurement_kpi_definition_id !== null && variables.some((v) => v.name === bound)) {
    kpi = await acceptedKpiActual(db, benefit.measurement_kpi_definition_id, period.start, period.end);
    if (kpi !== null) inputs.set(bound, kpi.value);
  }
  const evaluation = evaluateFormula(version!.expression, variables, Object.fromEntries(inputs));
  if (!evaluation.ok) {
    const first = evaluation.errors[0]!;
    throw formulaProblem(first.code, first.message);
  }
  const used = new Map(Object.entries(evaluation.inputs));
  const lineageInputs: ComputedValue["inputs"][number][] = [];
  const calculationEntries: [string, unknown][] = [];
  for (const v of variables) {
    const value = used.has(v.name) ? (used.get(v.name) ?? null) : (v.value ?? null);
    const fromKpi = kpi !== null && v.name === bound;
    calculationEntries.push([
      v.name,
      {
        name: v.name,
        kind: v.kind,
        unit: v.unit ?? null,
        currency: v.currency ?? null,
        period: v.period,
        value: value === null ? null : canonicalDecimal(value),
        description: v.description ?? null,
        source: fromKpi
          ? `KPI actual ${kpi!.kpiActualId} value ${kpi!.valueNo}`
          : given.has(v.name)
            ? MEASUREMENT_OVERRIDE_SOURCE
            : (v.source ?? null),
      },
    ]);
    if (value !== null)
      lineageInputs.push({
        name: v.name,
        value: canonicalDecimal(value),
        kpiActualId: fromKpi ? kpi!.kpiActualId : null,
        kpiValueNo: fromKpi ? kpi!.valueNo : null,
      });
  }
  return {
    formulaVersionId: version!.id,
    result: evaluation.result === null ? null : evaluation.rounding.stored,
    errorCode: evaluation.result === null ? (evaluation.errorCode ?? "formula.missing_input") : null,
    inputs: lineageInputs,
    calculation: {
      inputs: Object.fromEntries(calculationEntries),
      resultKind: version!.result_kind,
      resultUnit: version!.result_unit,
      resultCurrency: version!.result_currency === null ? null : version!.result_currency.trim(),
      resultPeriod: version!.result_period,
      rounded: evaluation.rounding.rounded,
      rounding: evaluation.rounding,
      engineVersion: evaluation.engineVersion,
    },
  };
}

/** Writes the benefit_calculation row of a computed value (append-only DG3 lineage); returns its id. */
export async function insertCalculation(
  tx: Tx,
  c: { organizationId: string; transformationId: string; userId: string },
  computed: ComputedValue,
  period: { start: string; end: string },
  assumptions: string | null,
): Promise<string> {
  const id = uuidv7();
  await tx
    .insertInto("benefit_calculation")
    .values({
      id,
      organization_id: c.organizationId,
      transformation_id: c.transformationId,
      formula_version_id: computed.formulaVersionId,
      inputs: JSON.stringify(computed.calculation.inputs),
      assumptions,
      period_start: period.start,
      period_end: period.end,
      outcome: computed.result === null ? "error" : "ok",
      result: computed.result,
      result_kind: computed.calculation.resultKind,
      result_unit: computed.calculation.resultUnit,
      result_currency: computed.calculation.resultCurrency,
      result_period: computed.calculation.resultPeriod,
      error_code: computed.errorCode,
      rounded: computed.calculation.rounded,
      rounding: JSON.stringify(computed.calculation.rounding),
      engine_version: computed.calculation.engineVersion,
      computed_by: c.userId,
    })
    .execute();
  return id;
}

/** Writes the measurement's lineage input rows (all for the measurement period; append-only). */
export async function insertInputs(
  tx: Tx,
  c: { organizationId: string; transformationId: string; userId: string },
  measurementId: string,
  computed: ComputedValue,
  period: { start: string; end: string },
): Promise<void> {
  for (const i of computed.inputs)
    await tx
      .insertInto("benefit_measurement_input")
      .values({
        id: uuidv7(),
        organization_id: c.organizationId,
        transformation_id: c.transformationId,
        measurement_id: measurementId,
        variable_name: i.name,
        kpi_actual_id: i.kpiActualId,
        kpi_value_no: i.kpiValueNo,
        value: i.value,
        period_start: period.start,
        period_end: period.end,
        created_by: c.userId,
      })
      .execute();
}

/** The amount (financial or valued) or KPI value of a computed result; money rounds once to numeric(20,4) HALF_UP. */
export function placeResult(
  result: string | null,
  unmonetised: boolean,
): { amount: string | null; kpiValue: string | null } {
  if (result === null) return { amount: null, kpiValue: null };
  return unmonetised ? { amount: null, kpiValue: result } : { amount: money4(result), kpiValue: null };
}

// ------------------------------------------------------------------------------------------------ rules

/** The ADR-0030 §2 value shape: one of amount / KPI value (both allowed) or a missing reason alone. */
function checkValueShape(v: { amount: string | null; kpiValue: string | null; missingReason: string | null }): void {
  const valued = v.amount !== null || v.kpiValue !== null;
  if (valued === (v.missingReason !== null)) throw valueShape(v.missingReason !== null ? "/missingReason" : "/amount");
}

/** 409 period_taken when another live measurement of the benefit has this period. */
async function checkPeriodFree(
  tx: Tx,
  benefit: BenefitRow,
  start: string | null,
  end: string | null,
  selfId: string | null,
): Promise<void> {
  if (start === null || end === null) return;
  let q = tx
    .selectFrom("benefit_measurement")
    .select("id")
    .where("benefit_id", "=", benefit.id)
    .where("kind", "=", "measurement")
    .where("status", "in", ["draft", "submitted", "validated"])
    .where("period_start", "=", start)
    .where("period_end", "=", end);
  if (selfId !== null) q = q.where("id", "<>", selfId);
  if (await q.executeTakeFirst()) throw periodTaken(benefit.code, start, end);
}

function checkPeriodRange(start: string | null, end: string | null): void {
  if (start !== null && end !== null && end < start)
    throw benefitRule("validation.constraint", "The period end cannot be before the period start.", "/periodEnd");
}

/** Evidence ids must be evidence records of the transformation (422 validation.reference). */
async function checkEvidence(tx: Tx, transformationId: string, ids: readonly string[]): Promise<void> {
  for (const [i, id] of ids.entries())
    await assertSameTransformation(tx, "evidence", transformationId, id, `/evidenceIds/${i}`);
}

async function linkEvidence(
  tx: Tx,
  ctx: WriteContext,
  m: BenefitMeasurementRow,
  ids: readonly string[],
): Promise<string[]> {
  const added: string[] = [];
  for (const evidenceId of ids) {
    const r = await tx
      .insertInto("benefit_evidence")
      .values({
        id: uuidv7(),
        organization_id: ctx.organizationId,
        transformation_id: ctx.transformationId,
        benefit_id: m.benefit_id,
        measurement_id: m.id,
        evidence_id: evidenceId,
        created_by: ctx.userId,
      })
      .onConflict((oc) => oc.doNothing())
      .returning("id")
      .executeTakeFirst();
    if (r) added.push(evidenceId);
  }
  return added;
}

async function evidenceCount(tx: Tx, measurementId: string): Promise<number> {
  const r = await tx
    .selectFrom("benefit_evidence")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where("measurement_id", "=", measurementId)
    .executeTakeFirstOrThrow();
  return Number(r.n);
}

/** The submit preconditions (ADR-0030 §2-§3): period, and evidence for a manual value. */
async function checkSubmittable(tx: Tx, m: BenefitMeasurementRow): Promise<void> {
  if (m.period_start === null || m.period_end === null) throw periodRequired();
  if (m.source === "manual" && (await evidenceCount(tx, m.id)) === 0) throw evidenceRequired();
}

/** Lock class financeValidationQueue (ADR-0016 §6), key = the measurement id: submission, queue item and decision. */
export async function lockQueue(tx: Tx, measurementId: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.financeValidationQueue}::int4, hashtext(${measurementId}))`.execute(
    tx,
  );
}

/** The submit side effects: the outbox event benefit.evidence_submitted (the worker creates the queue item). */
async function emitSubmitted(tx: Tx, ctx: WriteContext, m: BenefitMeasurementRow): Promise<void> {
  await enqueueBenefitEvent(tx, {
    organizationId: ctx.organizationId,
    aggregateType: "benefit_measurement",
    aggregateId: m.id,
    eventType: "benefit.evidence_submitted",
    idempotencyKey: `benefit.evidence_submitted:${m.id}`,
    payload: { benefitId: m.benefit_id, measurementId: m.id, transformationId: ctx.transformationId },
  });
}

// ------------------------------------------------------------------------------------------------ mutations

async function createMeasurement(
  tx: Tx,
  ctx: WriteContext,
  benefitId: string,
  body: BenefitMeasurementCreate,
): Promise<BenefitMeasurementRow> {
  // FOR UPDATE serialises measurement numbers of the benefit (benefit_measurement_no_step).
  const benefit = await lockBenefit(tx, ctx.transformationId, benefitId, "update");
  if (benefit.status !== "active") throw archivedBenefit();
  if (await isParent(tx, benefit.id)) throw parentRollup(benefit.code);
  if (!["measure", "correct", "sustain"].includes(benefit.lifecycle_step))
    throw measurementStep(benefit.code, benefit.lifecycle_step);
  const start = body.periodStart ?? null;
  const end = body.periodEnd ?? null;
  checkPeriodRange(start, end);
  const unmonetised = await isUnmonetised(tx, benefit);
  let amount = body.amount ?? null;
  let kpiValue = body.kpiValue ?? null;
  let missingReason = body.missingReason ?? null;
  let computed: ComputedValue | null = null;
  if (body.formulaVersionId !== undefined) {
    if (body.amount !== undefined || body.kpiValue !== undefined || body.missingReason !== undefined)
      throw valueShape("/formulaVersionId");
    if (start === null || end === null) throw periodRequired();
    computed = await computeWithFormula(tx, benefit, body.formulaVersionId, { start, end }, body.variables ?? {});
    if (
      !unmonetised &&
      computed.calculation.resultCurrency !== null &&
      computed.calculation.resultCurrency !== benefit.currency.trim()
    )
      throw benefitRule(
        "benefit_value.currency_mismatch",
        `The value is in ${computed.calculation.resultCurrency}, but the benefit is in ${benefit.currency.trim()}. Values are never converted.`,
        "/formulaVersionId",
      );
    ({ amount, kpiValue } = placeResult(computed.result, unmonetised));
    if (computed.result === null) missingReason = `Not computable: ${computed.errorCode}`;
  } else if (body.variables !== undefined) throw valueShape("/variables");
  checkValueShape({ amount, kpiValue, missingReason });
  if (amount !== null && unmonetised) throw valueUnmonetised();
  await checkPeriodFree(tx, benefit, start, end, null);
  await checkEvidence(tx, ctx.transformationId, body.evidenceIds ?? []);
  const submit = body.submit === true;
  if (submit) {
    if (start === null || end === null) throw periodRequired();
    if ((body.evidenceIds ?? []).length === 0) throw evidenceRequired();
  }
  const no = await tx
    .selectFrom("benefit_measurement")
    .select((eb) => eb.fn.max("measurement_no").as("n"))
    .where("benefit_id", "=", benefitId)
    .executeTakeFirstOrThrow();
  const id = uuidv7();
  if (submit) await lockQueue(tx, id);
  const calculationId =
    computed === null
      ? null
      : await insertCalculation(tx, ctx, computed, { start: start!, end: end! }, body.assumptions ?? null);
  const row = await tx
    .insertInto("benefit_measurement")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: ctx.transformationId,
      benefit_id: benefitId,
      measurement_no: Number(no.n ?? 0) + 1,
      kind: "measurement",
      source: "manual",
      benefit_calculation_id: calculationId,
      formula_version_id: computed?.formulaVersionId ?? null,
      period_start: start,
      period_end: end,
      amount,
      kpi_value: kpiValue,
      currency: benefit.currency.trim(),
      missing_reason: missingReason,
      attribution: body.attribution ?? null,
      assumptions: body.assumptions ?? null,
      status: submit ? "submitted" : "draft",
      submitted_by: submit ? ctx.userId : null,
      submitted_at: submit ? sql<Date>`now()` : null,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  if (computed !== null) await insertInputs(tx, ctx, id, computed, { start: start!, end: end! });
  await linkEvidence(tx, ctx, row, body.evidenceIds ?? []);
  await record(tx, ctx.audit, {
    action: "benefit_measurement.create",
    recordType: "benefit_measurement",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    newVersion: row.version,
    changes: {
      ...diffFields({} as BenefitMeasurementRow, row, [...MEASUREMENT_AUDIT_FIELDS]),
      evidence_ids: { from: null, to: body.evidenceIds ?? [] },
    },
  });
  if (submit) {
    await record(tx, ctx.audit, {
      action: "benefit_measurement.submitted",
      recordType: "benefit_measurement",
      recordId: id,
      organizationId: ctx.organizationId,
      transformationId: ctx.transformationId,
      newVersion: row.version,
      changes: { status: { from: null, to: "submitted" } },
    });
    await emitSubmitted(tx, ctx, row);
  }
  return row;
}

const measurementParams = z.strictObject({ transformationId: z.uuid(), benefitMeasurementId: z.uuid() });

export function parseMeasurementParams(params: unknown): { transformationId: string; benefitMeasurementId: string } {
  return parse(measurementParams, params, "params");
}

/** The measurement of a transformation, locked FOR UPDATE (404 when absent). */
export async function lockMeasurement(tx: Tx, transformationId: string, id: string): Promise<BenefitMeasurementRow> {
  const row = await tx
    .selectFrom("benefit_measurement")
    .selectAll()
    .where("id", "=", id)
    .where("transformation_id", "=", transformationId)
    .forUpdate()
    .executeTakeFirst();
  if (!row) throw problems.notFound();
  return row;
}

/** Validated rows: 409 validated_immutable; every other non-draft: 422 not_draft (ADR-0030 §2, §11). */
function checkDraft(m: BenefitMeasurementRow): void {
  if (m.status === "validated") throw validatedImmutable();
  if (m.status !== "draft") throw notDraft();
}

async function updateMeasurement(tx: Tx, request: FastifyRequest, transformationId: string, id: string) {
  const ctx = await openBenefitWrite(tx, request, transformationId, BENEFIT_MEASURE);
  const body = parseBody(benefitMeasurementUpdate, request.body);
  const expected = requireIfMatch(request);
  const current = await lockMeasurement(tx, transformationId, id);
  checkDraft(current);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  const benefit = await lockBenefit(tx, transformationId, current.benefit_id, "share");
  if (benefit.status !== "active") throw archivedBenefit();
  const given = new Map<string, unknown>(Object.entries(body));
  const pick = <T>(k: string, fallback: T): T => (given.has(k) ? (given.get(k) as T) : fallback);
  const merged = {
    period_start: pick("periodStart", current.period_start),
    period_end: pick("periodEnd", current.period_end),
    amount: pick("amount", current.amount),
    kpi_value: pick("kpiValue", current.kpi_value),
    missing_reason: pick("missingReason", current.missing_reason),
    attribution: pick("attribution", current.attribution),
    assumptions: pick("assumptions", current.assumptions),
  };
  if (current.formula_version_id !== null) {
    // A computed value keeps its lineage: the period and value come from the calculation (append-only inputs).
    if (merged.period_start !== current.period_start || merged.period_end !== current.period_end)
      throw lineagePeriod(current.period_start!, current.period_end!);
    if (
      merged.amount !== current.amount ||
      merged.kpi_value !== current.kpi_value ||
      merged.missing_reason !== current.missing_reason
    )
      throw valueShape("/amount");
  }
  checkPeriodRange(merged.period_start, merged.period_end);
  checkValueShape({ amount: merged.amount, kpiValue: merged.kpi_value, missingReason: merged.missing_reason });
  if (merged.amount !== null && (await isUnmonetised(tx, benefit))) throw valueUnmonetised();
  await checkPeriodFree(tx, benefit, merged.period_start, merged.period_end, current.id);
  await checkEvidence(tx, transformationId, body.evidenceIds ?? []);
  const updated = await tx
    .updateTable("benefit_measurement")
    .set({ ...merged, ...bumpStamps(ctx.userId) })
    .where("id", "=", id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  const added = await linkEvidence(tx, ctx, updated, body.evidenceIds ?? []);
  await record(tx, ctx.audit, {
    action: "benefit_measurement.update",
    recordType: "benefit_measurement",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: {
      ...diffFields(current, updated, [...MEASUREMENT_AUDIT_FIELDS]),
      ...(added.length > 0 ? { evidence_ids_added: { from: null, to: added } } : {}),
    },
  });
  return updated;
}

async function submitMeasurement(tx: Tx, request: FastifyRequest, transformationId: string, id: string) {
  const ctx = await openBenefitWrite(tx, request, transformationId, BENEFIT_MEASURE);
  const expected = requireIfMatch(request);
  await lockQueue(tx, id);
  const current = await lockMeasurement(tx, transformationId, id);
  if (current.status !== "draft") throw notDraft();
  if (current.version !== expected) throw problems.versionConflict(current.version);
  const benefit = await lockBenefit(tx, transformationId, current.benefit_id, "share");
  if (benefit.status !== "active") throw archivedBenefit();
  await checkSubmittable(tx, current);
  const updated = await tx
    .updateTable("benefit_measurement")
    .set({ status: "submitted", submitted_by: ctx.userId, submitted_at: sql<Date>`now()`, ...bumpStamps(ctx.userId) })
    .where("id", "=", id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "benefit_measurement.submitted",
    recordType: "benefit_measurement",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diffFields(current, updated, [...MEASUREMENT_AUDIT_FIELDS]),
  });
  await emitSubmitted(tx, ctx, updated);
  return updated;
}

// ------------------------------------------------------------------------------------------------ routes

const listQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });

export function registerBenefitMeasurementRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "transformation.read" as const } };
  const write = { access: { permission: BENEFIT_MEASURE }, consumes: JSON_BODY };
  const LIST = `${BENEFITS}/:benefitId/measurements`;

  app.get(LIST, { config: read }, async (request) => {
    const { transformationId, benefitId } = parseBenefitParams(request.params);
    const query = parseQuery(listQuery, request.query);
    await readBenefitRow(db, request, transformationId, benefitId);
    const hash = filterHash({ table: "benefit_measurement", benefitId });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("benefit_measurement").selectAll().where("benefit_id", "=", benefitId);
    if (after) q = q.where("measurement_no", "<", Number(after[0]));
    const rows = await q
      .orderBy("measurement_no", "desc")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.measurement_no], hash);
    return { items: await presentMeasurements(db, page.items), nextCursor: page.nextCursor };
  });

  app.post(LIST, { config: write }, async (request, reply) => {
    const { transformationId, benefitId } = parseBenefitParams(request.params);
    const result = await db.transaction().execute(async (tx) => {
      const ctx = await openBenefitWrite(tx, request, transformationId, BENEFIT_MEASURE);
      const body = parseBody(benefitMeasurementCreate, request.body);
      return maybeIdempotent(tx, request, ctx.userId, body, async () => {
        const row = await createMeasurement(tx, ctx, benefitId, body);
        return { status: 201, body: await presentMeasurement(tx, row) };
      });
    });
    return sendCreated(request, reply, result, `/api/v1/transformations/${transformationId}/benefit-measurements`);
  });

  app.get(MEASUREMENT_ITEM, { config: read }, async (request, reply) => {
    const { transformationId, benefitMeasurementId } = parseMeasurementParams(request.params);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const row = await db
      .selectFrom("benefit_measurement")
      .selectAll()
      .where("id", "=", benefitMeasurementId)
      .where("transformation_id", "=", transformationId)
      .executeTakeFirst();
    if (!row) throw problems.notFound();
    return sendVersioned(reply, 200, await presentMeasurement(db, row));
  });

  app.patch(MEASUREMENT_ITEM, { config: write }, async (request, reply) => {
    const { transformationId, benefitMeasurementId } = parseMeasurementParams(request.params);
    const body = await db
      .transaction()
      .execute(async (tx) =>
        presentMeasurement(tx, await updateMeasurement(tx, request, transformationId, benefitMeasurementId)),
      );
    return sendVersioned(reply, 200, body);
  });

  app.post(
    `${MEASUREMENT_ITEM}/submit`,
    { config: { access: { permission: BENEFIT_MEASURE } } },
    async (request, reply) => {
      const { transformationId, benefitMeasurementId } = parseMeasurementParams(request.params);
      const body = await db
        .transaction()
        .execute(async (tx) =>
          presentMeasurement(tx, await submitMeasurement(tx, request, transformationId, benefitMeasurementId)),
        );
      return sendVersioned(reply, 200, body);
    },
  );

  return [
    `GET ${LIST}`,
    `POST ${LIST}`,
    `GET ${MEASUREMENT_ITEM}`,
    `PATCH ${MEASUREMENT_ITEM}`,
    `POST ${MEASUREMENT_ITEM}/submit`,
  ];
}
