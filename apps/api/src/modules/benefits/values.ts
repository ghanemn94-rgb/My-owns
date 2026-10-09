// Benefit value series and planned/forecast values (P4 slice B; ADR-0030 §1, §6, §8, §11; T-DG4-KBE-E; REQ-S08-001,
// REQ-PB-075, REQ-PB-076, REQ-S08-010):
//   GET   /transformations/{t}/benefits/{benefitId}/values            the seven value states kept apart (transformation.read)
//   POST  /transformations/{t}/benefits/{benefitId}/plan-values       add a planned or forecast value (benefit.edit)
//   PATCH /transformations/{t}/benefit-plan-values/{planValueId}      change one (benefit.edit; If-Match)
//
// - A value state is ONE of planned, forecast, measured, submitted, validated, sustained, rejected (the benefit_value_line
//   view of 0039). Each series has its own total and count; states are NEVER added together, and `measured` (what was
//   measured) overlaps `submitted` and `validated` by definition. A forecast is never validated, a scenario is never a
//   value line (REQ-S08-018) and a rejected value stays visible.
// - Totals are decimal.js sums of decimal strings (S-5); Unknown (a value without an amount) makes the series Unknown,
//   never 0; Value (SAR) of a non-financial benefit without an approved valuation method is n/a, never 0 (REQ-PB-076).
// - Every mutation: the permission held somewhere (403 for AUD and technical admins), the read gate (404), the scoped
//   write gate re-checked at commit time, zod (400), the ADR rules (422/409) before the database, If-Match (428/409;
//   creates start at version 1) and one audit event in the same transaction. No client or remote I/O in a transaction.
// Also the shared helpers of the KBE-E files: the slice B outbox writer (benefits cannot import jobs; same contract as
// jobs' enqueueOutboxEvent), the basis rule (REQ-S08-008) and `realizedFor` (the T14 Realized fields, read by the
// register through KBE-D's `realizationFor`, which reads the same view).
import { diffFields, type BenefitPlanValueRow, type BenefitRow, type DbOrTx, type Tx } from "@mth/db";
import { FORMULA_DECIMAL as D } from "@mth/shared/calc";
import {
  benefitPlanValueCreate,
  benefitPlanValueUpdate,
  BENEFIT_VALUE_STATES,
  isFinancialClass,
  outboxPayloadSchema,
  type BenefitAmount,
  type BenefitPlanValue,
  type BenefitRealized,
  type BenefitValueClass,
  type BenefitValueLine,
  type BenefitValues,
  type BenefitValueState,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { record } from "../audit/index.ts";
import { iso, parse, parseBody, problems, requireIfMatch, sendVersioned, type ModuleDeps } from "../platform/index.ts";
import { bumpStamps, maybeIdempotent, sendCreated, type WriteContext } from "../transformations/index.ts";
import {
  archivedBenefit,
  BENEFIT_EDIT,
  BENEFITS,
  benefitRule,
  JSON_BODY,
  lockBenefit,
  openBenefitWrite,
  parseBenefitParams,
  readBenefitRow,
  realizationFor,
} from "./register.ts";

export const BENEFIT_PLAN_VALUES = "/api/v1/transformations/:transformationId/benefit-plan-values";
export const BENEFIT_PLAN_VALUE_ITEM = `${BENEFIT_PLAN_VALUES}/:benefitPlanValueId`;

// ------------------------------------------------------------------------------------------------ decimal helpers

/** Exact decimal sum of decimal strings (decimal.js, precision 80; never a JavaScript number). */
export function sumExact(values: readonly string[]): string {
  return values.reduce((acc, v) => acc.plus(new D(v)), new D(0)).toFixed();
}

/** A money amount at the numeric(20,4) presentation scale (ROUND_HALF_UP; rounding only at presentation). */
export function money4(value: string): string {
  return new D(value).toDecimalPlaces(4, D.ROUND_HALF_UP).toFixed(4);
}

// ------------------------------------------------------------------------------------------------ problems (ADR-0029/0030 §11)

export const valueUnmonetised = (pointer = "/amount") =>
  benefitRule(
    "benefit_value.unmonetised",
    "A non-financial benefit has no SAR value without an approved valuation method. Record its KPI value instead.",
    pointer,
  );

export const parentRollup = (code: string) =>
  benefitRule("benefit_value.parent_rollup", `Benefit ${code} is a parent: its values come from its children.`);

/** True when the benefit carries no SAR amount: non-financial without an APPROVED valuation method (REQ-S08-010). */
export async function isUnmonetised(db: DbOrTx, benefit: BenefitRow): Promise<boolean> {
  if (isFinancialClass(benefit.value_class as BenefitValueClass)) return false;
  if (benefit.valuation_method_id === null) return true;
  const m = await db
    .selectFrom("benefit_valuation_method")
    .select("status")
    .where("id", "=", benefit.valuation_method_id)
    .executeTakeFirst();
  return m?.status !== "approved";
}

/** True when the benefit is a parent (a roll-up container whose children carry the values). */
export async function isParent(db: DbOrTx, benefitId: string): Promise<boolean> {
  const c = await db.selectFrom("benefit").select("id").where("parent_benefit_id", "=", benefitId).executeTakeFirst();
  return c !== undefined;
}

/** The ADR §1 value-row rules checked before the database (archived, parent, unmonetised). */
export async function checkValueRow(tx: DbOrTx, benefit: BenefitRow, amount: string | null | undefined): Promise<void> {
  if (benefit.status !== "active") throw archivedBenefit();
  if (await isParent(tx, benefit.id)) throw parentRollup(benefit.code);
  if (amount !== null && amount !== undefined && (await isUnmonetised(tx, benefit))) throw valueUnmonetised();
}

// ------------------------------------------------------------------------------------------------ basis (REQ-S08-008)

/**
 * The comparison basis of a value: `validated` only when the benefit's baseline is Finance-validated AND, when a formula
 * version was used, that version is Finance-validated; otherwise `provisional` (excluded from validated totals, and
 * Finance validation is refused with finance_validation.basis_provisional).
 */
export async function basisOf(
  db: DbOrTx,
  benefit: Pick<BenefitRow, "baseline_validation_status">,
  formulaVersionId: string | null,
): Promise<"validated" | "provisional"> {
  if (benefit.baseline_validation_status !== "validated") return "provisional";
  if (formulaVersionId === null) return "validated";
  const v = await db
    .selectFrom("benefit_formula_version")
    .select("validation_status")
    .where("id", "=", formulaVersionId)
    .executeTakeFirst();
  return v?.validation_status === "validated" ? "validated" : "provisional";
}

// ------------------------------------------------------------------------------------------------ outbox writer

export interface BenefitOutboxEvent {
  readonly organizationId: string;
  readonly aggregateType: "benefit_measurement" | "finance_validation";
  readonly aggregateId: string;
  readonly eventType:
    | "benefit.evidence_submitted"
    | "benefit.value_validated"
    | "benefit.value_rejected"
    | "benefit.variance_evaluated";
  readonly payload: Record<string, unknown>;
  /** `<event>:<subject id>` (unique; consumers dedupe on it through processed_message). */
  readonly idempotencyKey: string;
}

/**
 * Inserts one outbox row in the caller's transaction, after validating the payload against the shared registry (the
 * worker's relay validates it again). The benefits module does not depend on `jobs` (modules.ts), so this is the
 * module-local twin of jobs' enqueueOutboxEvent (the kpi-outbox.ts precedent). ON CONFLICT on the idempotency key does
 * nothing: an event is written once.
 */
export async function enqueueBenefitEvent(tx: Tx, event: BenefitOutboxEvent): Promise<void> {
  const schema = outboxPayloadSchema(event.eventType, 1);
  if (!schema) throw new Error(`outbox: no schema for ${event.eventType} v1`);
  const payload = schema.parse(event.payload) as Record<string, unknown>;
  await tx
    .insertInto("outbox_event")
    .values({
      id: uuidv7(),
      organization_id: event.organizationId,
      aggregate_type: event.aggregateType,
      aggregate_id: event.aggregateId,
      event_type: event.eventType,
      schema_version: 1,
      payload: JSON.stringify(payload),
      idempotency_key: event.idempotencyKey,
    })
    .onConflict((oc) => oc.column("idempotency_key").doNothing())
    .execute();
}

/**
 * benefit.variance_evaluated (ADR-0030 §6) for a validated or pending value: planned = the benefit's `planned` value of
 * the same period (exact period match), measured = the value's amount, variance = measured − planned. `offTrack` is null
 * (Unknown) when there is no planned value or no measured amount, never false; otherwise measured < planned.
 */
export async function enqueueVariance(
  tx: Tx,
  organizationId: string,
  m: {
    id: string;
    benefit_id: string;
    period_start: string | null;
    period_end: string | null;
    amount: string | null;
    validated_amount: string | null;
  },
): Promise<void> {
  if (m.period_start === null || m.period_end === null) return;
  const planned = await tx
    .selectFrom("benefit_plan_value")
    .select("amount")
    .where("benefit_id", "=", m.benefit_id)
    .where("value_kind", "=", "planned")
    .where("period_start", "=", m.period_start)
    .where("period_end", "=", m.period_end)
    .executeTakeFirst();
  const plannedAmount = planned?.amount ?? null;
  const measuredAmount = m.validated_amount ?? m.amount;
  const known = plannedAmount !== null && measuredAmount !== null;
  const variance = known ? money4(new D(measuredAmount).minus(new D(plannedAmount)).toFixed()) : null;
  await enqueueBenefitEvent(tx, {
    organizationId,
    aggregateType: "benefit_measurement",
    aggregateId: m.id,
    eventType: "benefit.variance_evaluated",
    idempotencyKey: `benefit.variance_evaluated:${m.id}`,
    payload: {
      benefitId: m.benefit_id,
      measurementId: m.id,
      periodStart: m.period_start,
      periodEnd: m.period_end,
      plannedAmount,
      measuredAmount,
      variance,
      offTrack: known ? new D(measuredAmount).lt(new D(plannedAmount)) : null,
    },
  });
}

// ------------------------------------------------------------------------------------------------ value series

interface ValueLineRow {
  readonly value_state: string;
  readonly period_start: string | null;
  readonly period_end: string | null;
  readonly amount: string | null;
  readonly kpi_value: string | null;
  readonly record_table: string;
  readonly record_id: string;
}

/**
 * The total of one state's lines (ADR-0030 §6-§8): n/a for an unmonetised benefit; Unknown when a line has no amount
 * (never summed as 0); otherwise the exact sum at money scale ("0.0000" for an empty state with count 0).
 */
export function seriesTotal(
  amounts: readonly (string | null)[],
  currency: string,
  unmonetised: boolean,
): BenefitAmount {
  if (unmonetised) return { status: "not_applicable", amount: null, currency: null, reason: null };
  if (amounts.some((a) => a === null))
    return { status: "unknown", amount: null, currency, reason: "benefit.value_amount_missing" };
  return { status: "known", amount: money4(sumExact(amounts as string[])), currency, reason: null };
}

/** The seven series of a benefit, in BENEFIT_VALUE_STATES order, each with its lines, count and total. */
export async function valuesOf(db: DbOrTx, benefit: BenefitRow): Promise<BenefitValues> {
  // View columns are typed nullable; value_state, record_table and record_id are never NULL (0039).
  const rows: ValueLineRow[] = (
    await db
      .selectFrom("benefit_value_line")
      .select(["value_state", "period_start", "period_end", "amount", "kpi_value", "record_table", "record_id"])
      .where("benefit_id", "=", benefit.id)
      .orderBy("period_start")
      .orderBy("record_id")
      .execute()
  ).map((r) => ({ ...r, value_state: r.value_state!, record_table: r.record_table!, record_id: r.record_id! }));
  const measurementIds = rows.filter((r) => r.record_table === "benefit_measurement").map((r) => r.record_id);
  const formulaOf = new Map<string, string | null>();
  if (measurementIds.length > 0)
    for (const m of await db
      .selectFrom("benefit_measurement")
      .select(["id", "formula_version_id"])
      .where("id", "in", measurementIds)
      .execute())
      formulaOf.set(m.id, m.formula_version_id);
  const basisCache = new Map<string, "validated" | "provisional">();
  const basisFor = async (id: string): Promise<"validated" | "provisional"> => {
    const fv = formulaOf.get(id) ?? null;
    const key = fv ?? "";
    if (!basisCache.has(key)) basisCache.set(key, await basisOf(db, benefit, fv));
    return basisCache.get(key)!;
  };
  const unmonetised = await isUnmonetised(db, benefit);
  const currency = benefit.currency.trim();
  const series: BenefitValues["series"] = [];
  for (const state of BENEFIT_VALUE_STATES) {
    const mine = rows.filter((r) => r.value_state === state);
    const lines: BenefitValueLine[] = [];
    for (const r of mine)
      lines.push({
        periodStart: r.period_start,
        periodEnd: r.period_end,
        amount: r.amount,
        kpiValue: r.kpi_value,
        recordType: r.record_table as BenefitValueLine["recordType"],
        recordId: r.record_id,
        basis:
          r.record_table !== "benefit_measurement"
            ? null
            : state === "validated" || state === "sustained"
              ? "validated"
              : await basisFor(r.record_id),
      });
    series.push({
      state: state as BenefitValueState,
      total: seriesTotal(
        mine.map((r) => r.amount),
        currency,
        unmonetised,
      ),
      count: mine.length,
      lines,
    });
  }
  return { benefitId: benefit.id, currency, series };
}

/**
 * The T14 Realized fields of each benefit (validated, sustained and pending apart, each with its count; ADR-0030 §6),
 * for consumers outside the register (FE-C, slice G/H/J). The register computes the same fields from the same view.
 */
export async function realizedFor(db: DbOrTx, benefitIds: readonly string[]): Promise<Map<string, BenefitRealized>> {
  const out = new Map<string, BenefitRealized>();
  if (benefitIds.length === 0) return out;
  const rows = await db
    .selectFrom("benefit")
    .selectAll()
    .where("id", "in", [...benefitIds])
    .execute();
  const facts = await realizationFor(db, rows);
  for (const [id, f] of facts) out.set(id, f.realized);
  return out;
}

// ------------------------------------------------------------------------------------------------ plan values

export const PLAN_VALUE_AUDIT_FIELDS = [
  "benefit_id",
  "value_kind",
  "period_start",
  "period_end",
  "amount",
  "kpi_value",
  "currency",
  "note",
] as const satisfies readonly (keyof BenefitPlanValueRow & string)[];

export function toBenefitPlanValue(r: BenefitPlanValueRow): BenefitPlanValue {
  return {
    id: r.id,
    benefitId: r.benefit_id,
    valueKind: r.value_kind as BenefitPlanValue["valueKind"],
    periodStart: r.period_start,
    periodEnd: r.period_end,
    amount: r.amount,
    kpiValue: r.kpi_value,
    currency: r.currency.trim(),
    note: r.note,
    version: r.version,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
    updatedAt: iso(r.updated_at),
  };
}

/** The rules of a planned/forecast value (ADR-0030 §1; ADR-0029 §11), before the database. */
async function checkPlanValue(
  tx: Tx,
  benefit: BenefitRow,
  v: { valueKind: string; periodStart: string; periodEnd: string; amount: string | null; kpiValue: string | null },
  selfId: string | null,
): Promise<void> {
  await checkValueRow(tx, benefit, v.amount);
  if (v.amount === null && v.kpiValue === null)
    throw benefitRule(
      "benefit_value.value_required",
      "A planned or forecast value needs an amount or a KPI value.",
      "/amount",
    );
  if (v.periodEnd < v.periodStart)
    throw benefitRule("benefit_value.period_range", "The period end cannot be before the period start.", "/periodEnd");
  let q = tx
    .selectFrom("benefit_plan_value")
    .select("id")
    .where("benefit_id", "=", benefit.id)
    .where("value_kind", "=", v.valueKind)
    .where("period_start", "=", v.periodStart);
  if (selfId !== null) q = q.where("id", "<>", selfId);
  if (await q.executeTakeFirst())
    throw problems.duplicate(
      "benefit_value.period_taken",
      `This benefit already has a ${v.valueKind} value for the period starting ${v.periodStart}.`,
    );
}

async function createPlanValue(tx: Tx, ctx: WriteContext, benefitId: string, request: FastifyRequest) {
  const body = parseBody(benefitPlanValueCreate, request.body);
  const benefit = await lockBenefit(tx, ctx.transformationId, benefitId, "share");
  const v = {
    valueKind: body.valueKind,
    periodStart: body.periodStart,
    periodEnd: body.periodEnd,
    amount: body.amount ?? null,
    kpiValue: body.kpiValue ?? null,
  };
  await checkPlanValue(tx, benefit, v, null);
  const id = uuidv7();
  const row = await tx
    .insertInto("benefit_plan_value")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: ctx.transformationId,
      benefit_id: benefitId,
      value_kind: v.valueKind,
      period_start: v.periodStart,
      period_end: v.periodEnd,
      amount: v.amount,
      kpi_value: v.kpiValue,
      currency: benefit.currency.trim(),
      note: body.note ?? null,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "benefit_plan_value.create",
    recordType: "benefit_plan_value",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    newVersion: row.version,
    changes: diffFields({} as BenefitPlanValueRow, row, [...PLAN_VALUE_AUDIT_FIELDS]),
  });
  return row;
}

const planValueParams = z.strictObject({ transformationId: z.uuid(), benefitPlanValueId: z.uuid() });

async function updatePlanValue(tx: Tx, request: FastifyRequest, transformationId: string, planValueId: string) {
  const ctx = await openBenefitWrite(tx, request, transformationId, BENEFIT_EDIT);
  const body = parseBody(benefitPlanValueUpdate, request.body);
  const expected = requireIfMatch(request);
  const current = await tx
    .selectFrom("benefit_plan_value")
    .selectAll()
    .where("id", "=", planValueId)
    .where("transformation_id", "=", transformationId)
    .forUpdate()
    .executeTakeFirst();
  if (!current) throw problems.notFound();
  const benefit = await lockBenefit(tx, transformationId, current.benefit_id, "share");
  if (current.version !== expected) throw problems.versionConflict(current.version);
  const given = new Map(Object.entries(body));
  const pick = <K extends keyof typeof body>(k: K, fallback: unknown) => (given.has(k) ? given.get(k) : fallback);
  const merged = {
    valueKind: current.value_kind,
    periodStart: pick("periodStart", current.period_start) as string,
    periodEnd: pick("periodEnd", current.period_end) as string,
    amount: pick("amount", current.amount) as string | null,
    kpiValue: pick("kpiValue", current.kpi_value) as string | null,
  };
  await checkPlanValue(tx, benefit, merged, current.id);
  const updated = await tx
    .updateTable("benefit_plan_value")
    .set({
      period_start: merged.periodStart,
      period_end: merged.periodEnd,
      amount: merged.amount,
      kpi_value: merged.kpiValue,
      note: pick("note", current.note) as string | null,
      ...bumpStamps(ctx.userId),
    })
    .where("id", "=", planValueId)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "benefit_plan_value.update",
    recordType: "benefit_plan_value",
    recordId: planValueId,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diffFields(current, updated, [...PLAN_VALUE_AUDIT_FIELDS]),
  });
  return updated;
}

// ------------------------------------------------------------------------------------------------ routes

export function registerBenefitValueRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "transformation.read" as const } };
  const write = { access: { permission: BENEFIT_EDIT }, consumes: JSON_BODY };
  const VALUES = `${BENEFITS}/:benefitId/values`;
  const PLAN = `${BENEFITS}/:benefitId/plan-values`;

  app.get(VALUES, { config: read }, async (request) => {
    const { transformationId, benefitId } = parseBenefitParams(request.params);
    const benefit = await readBenefitRow(db, request, transformationId, benefitId);
    return valuesOf(db, benefit);
  });

  app.post(PLAN, { config: write }, async (request, reply) => {
    const { transformationId, benefitId } = parseBenefitParams(request.params);
    const result = await db.transaction().execute(async (tx) => {
      const ctx = await openBenefitWrite(tx, request, transformationId, BENEFIT_EDIT);
      return maybeIdempotent(tx, request, ctx.userId, request.body, async () => ({
        status: 201,
        body: toBenefitPlanValue(await createPlanValue(tx, ctx, benefitId, request)),
      }));
    });
    return sendCreated(request, reply, result, `/api/v1/transformations/${transformationId}/benefit-plan-values`);
  });

  app.patch(BENEFIT_PLAN_VALUE_ITEM, { config: write }, async (request, reply) => {
    const { transformationId, benefitPlanValueId } = parse(planValueParams, request.params, "params");
    const body = await db
      .transaction()
      .execute(async (tx) =>
        toBenefitPlanValue(await updatePlanValue(tx, request, transformationId, benefitPlanValueId)),
      );
    return sendVersioned(reply, 200, body);
  });

  return [`GET ${VALUES}`, `POST ${PLAN}`, `PATCH ${BENEFIT_PLAN_VALUE_ITEM}`];
}
