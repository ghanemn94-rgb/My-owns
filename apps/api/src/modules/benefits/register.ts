// T14 Benefits Register (P4 slice B; ADR-0029 §1, §4, §6, §9, §11, §12; T-DG4-KBE-D; REQ-PB-058, REQ-PB-075,
// REQ-PB-076, REQ-S08-003, REQ-S08-009):
//   GET   /transformations/{t}/benefits                    the T14 register: one row per canonical benefit, ten columns
//   POST  /transformations/{t}/benefits                    create at Identify (benefit.edit; TL, BO); code B01, B02…
//   GET   /transformations/{t}/benefits/{benefitId}        one benefit with profile, step, counting and realization state
//   PATCH /transformations/{t}/benefits/{benefitId}        profile and step outputs (benefit.edit; If-Match)
//   POST  /transformations/{t}/benefits/{benefitId}/archive archive with a reason (benefit.edit; If-Match)
//
// - ONE owner: `ownerUserId` is a single uuid in a strict body; a body naming two owners is 400 (REQ-PB-058).
// - A financial class needs a financial-statement line, `non_financial` an agreed KPI (422 benefit.mapping_required /
//   benefit.kpi_required; REQ-S08-003). Type and class must fit (REQ-S08-009). Value (SAR) of a non-financial benefit
//   is n/a unless an approved valuation method in the benefit's currency is referenced (REQ-PB-076, REQ-S08-010).
// - Baseline, formula and target are the Plan outputs: they can be absent at Identify/Plan and are required from Enable
//   on (lifecycle.ts; this file refuses clearing them later: 422 benefit.plan_outputs_missing).
// - Changing a Finance-validated (or rejected) baseline resets its validation to `unvalidated` in the same update.
// - Every mutation: the permission held somewhere (403 for AUD and technical admins whatever the body), the read gate
//   (404), the write gate re-checked at commit time (openWrite atCommit), zod validation (400) then the ADR-0029 §11
//   rules (422/409), If-Match (428/409; creates start at version 1) and one audit event in the same transaction. No
//   client or remote I/O inside a transaction.
// - Realized (T14) keeps validated, sustained and pending (submitted) apart; pending is never validated (REQ-PB-075).
//   Value (SAR) and Realized of a non-financial benefit without a valuation method are n/a, never 0 (REQ-PB-076).
// Finance validation is a human decision inside the product; nothing here validates or approves, and nothing touches
// the engineering gates DG0-DG7.
import { diffFields, sql, type BenefitRow, type DbOrTx, type Tx } from "@mth/db";
import {
  benefitCreate,
  benefitListQuery,
  benefitUpdate,
  isFinancialClass,
  missingFor,
  MONEY_COLUMN,
  planOutputsText,
  realizationStateOf,
  reasonRequest,
  sumDecimals,
  toColumnString,
  typeFitsClass,
  type Benefit,
  type BenefitAmount,
  type BenefitCreate,
  type BenefitKpiActual,
  type BenefitLifecycleStep,
  type BenefitRealizationState,
  type BenefitRealized,
  type BenefitRegisterRow,
  type InitiativeRef,
  type BenefitType,
  type BenefitUpdate,
  type BenefitValueClass,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import type { Permission } from "@mth/shared";
import { holdsAnywhere, principalOf, requireTransformationRead } from "../access/index.ts";
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
import {
  assertActiveUsers,
  assertSameTransformation,
  bumpStamps,
  maybeIdempotent,
  openWrite,
  sendCreated,
  type WriteContext,
} from "../transformations/index.ts";
import { countingFor, NOT_COUNTED } from "./counting.ts";

export const BENEFITS = "/api/v1/transformations/:transformationId/benefits";
export const BENEFIT_ITEM = `${BENEFITS}/:benefitId`;
export const JSON_BODY = ["application/json"] as const;
export const BENEFIT_EDIT = "benefit.edit" as const;

// ------------------------------------------------------------------------------------------------ problems

/** A 422 business rule of ADR-0029 §11 with one error at `pointer` (code = i18n key, detail = the exact English). */
export const benefitRule = (code: string, detail: string, pointer = "") =>
  new HttpProblem({
    status: 422,
    type: "urn:mth:problem:validation",
    code,
    title: "Business rule violated",
    detail,
    errors: [{ pointer, code, message: detail }],
  });

export const archivedBenefit = () => benefitRule("benefit.archived", "This benefit is archived and read-only.");

export const planOutputsMissing = (text: string) =>
  benefitRule(
    "benefit.plan_outputs_missing",
    `The Plan outputs are missing: ${text}. A benefit needs its baseline, formula, target and owner before Enable and Measure.`,
  );

// ------------------------------------------------------------------------------------------------ access helpers

const benefitParams = z.strictObject({ transformationId: z.uuid(), benefitId: z.uuid() });
const transformationParams = z.strictObject({ transformationId: z.uuid() });

export function parseBenefitParams(params: unknown): { transformationId: string; benefitId: string } {
  return parse(benefitParams, params, "params");
}

export function parseTransformationParam(params: unknown): string {
  return parse(transformationParams, params, "params").transformationId;
}

/**
 * The write permission must be held somewhere, or the caller gets 403 whatever the body and record (a read-only
 * auditor and a technical administrator never hold a slice B permission; ADR-0029 §9). Existence is not disclosed:
 * the answer does not depend on the record.
 */
export function requirePermissionSomewhere(request: FastifyRequest, permission: Permission): void {
  if (!holdsAnywhere(principalOf(request), permission)) throw problems.forbidden();
}

/** The gates of a slice B mutation inside a transformation (403 first, then 404, then the scoped write gate). */
export async function openBenefitWrite(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
  permission: Permission,
): Promise<WriteContext> {
  requirePermissionSomewhere(request, permission);
  return openWrite(tx, request, transformationId, [{ permission }], null, { atCommit: true });
}

/** The benefit of a transformation for a read (404 when it does not exist or the caller cannot read it). */
export async function readBenefitRow(
  db: DbOrTx,
  request: FastifyRequest,
  transformationId: string,
  benefitId: string,
): Promise<BenefitRow> {
  await requireTransformationRead(db, principalOf(request), transformationId);
  const row = await db
    .selectFrom("benefit")
    .selectAll()
    .where("id", "=", benefitId)
    .where("transformation_id", "=", transformationId)
    .executeTakeFirst();
  if (!row) throw problems.notFound();
  return row;
}

/** Locks the benefit for a change (FOR UPDATE) or for a dependent write (FOR SHARE); 404 when absent. */
export async function lockBenefit(
  tx: Tx,
  transformationId: string,
  benefitId: string,
  mode: "update" | "share" = "update",
): Promise<BenefitRow> {
  let q = tx
    .selectFrom("benefit")
    .selectAll()
    .where("id", "=", benefitId)
    .where("transformation_id", "=", transformationId);
  q = mode === "update" ? q.forUpdate() : q.forShare();
  const row = await q.executeTakeFirst();
  if (!row) throw problems.notFound();
  return row;
}

/** If-Match against the locked benefit (428 missing, 409 stale) and 422 benefit.archived. */
export function checkBenefitVersion(current: BenefitRow, expected: number): void {
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status === "archived") throw archivedBenefit();
}

// ------------------------------------------------------------------------------------------------ overlap hook

/** A change of a benefit's overlap keys (driver, population, realization window), or its creation (`before` null). */
export interface BenefitKeysChange {
  readonly before: BenefitRow | null;
  readonly after: BenefitRow;
}
export type BenefitKeysChangedHook = (tx: Tx, ctx: WriteContext, change: BenefitKeysChange) => Promise<void>;

/**
 * Hooks run inside the creating/updating transaction after the benefit row and its audit event are written, on
 * `createBenefit` and on an `updateBenefit` that changes `driver_key`, `population_key`, `realization_start` or
 * `realization_end` (ADR-0029 §7). KBE-D2 (`benefits/overlaps.ts`) registers the overlap rule here at module load:
 * `onBenefitKeysChanged.push(detectBenefitOverlapsHook)`. A hook throws to abort the write.
 */
export const onBenefitKeysChanged: BenefitKeysChangedHook[] = [];

/** True when an update changed one of the four overlap keys. */
export function overlapKeysChanged(before: BenefitRow, after: BenefitRow): boolean {
  return (
    before.driver_key !== after.driver_key ||
    before.population_key !== after.population_key ||
    before.realization_start !== after.realization_start ||
    before.realization_end !== after.realization_end
  );
}

async function runKeysChangedHooks(tx: Tx, ctx: WriteContext, change: BenefitKeysChange): Promise<void> {
  for (const hook of onBenefitKeysChanged) await hook(tx, ctx, change);
}

// ------------------------------------------------------------------------------------------------ presenters

const trimOrNull = (v: string | null): string | null => (v === null ? null : v.trim());
const money = (v: string): string => toColumnString(v, MONEY_COLUMN);

/** Value (SAR) of T14 (ADR-0029 §4): n/a for a non-financial benefit without a valuation method; Unknown when missing. */
export function valueSarOf(row: BenefitRow): BenefitAmount {
  const currency = row.currency.trim();
  if (row.value_class === "non_financial" && row.valuation_method_id === null)
    return { status: "not_applicable", amount: null, currency: null, reason: null };
  if (row.planned_value === null)
    return { status: "unknown", amount: null, currency, reason: "benefit.planned_value_missing" };
  return { status: "known", amount: money(row.planned_value), currency, reason: null };
}

/** The counts that decide the realization state, per benefit. */
interface RealizationFacts {
  readonly realized: BenefitRealized;
  readonly liveMeasurements: number;
  readonly activeEnablers: number;
  readonly deliveredEnablers: number;
}

/** A sum of one value state: known (0.0000 when empty), Unknown when a line has no amount, n/a when unmonetised. */
function stateAmount(row: BenefitRow, amounts: readonly (string | null)[]): BenefitAmount {
  const currency = row.currency.trim();
  if (row.value_class === "non_financial" && row.valuation_method_id === null)
    return { status: "not_applicable", amount: null, currency: null, reason: null };
  if (amounts.some((a) => a === null))
    return { status: "unknown", amount: null, currency, reason: "benefit.value_amount_missing" };
  return { status: "known", amount: money(sumDecimals(amounts as string[])), currency, reason: null };
}

/**
 * T14 Realized and the realization-state inputs of each benefit (ADR-0029 §2, §4; ADR-0030 §6): the `validated`,
 * `sustained` and `pending` (= `submitted`) states of `benefit_value_line` are summed SEPARATELY with decimal
 * arithmetic, each with its count; they are never added together, and a forecast or scenario is never read. For a
 * non-financial benefit, `kpiActual` is the latest accepted value of its agreed KPI (Unknown when none).
 */
export async function realizationFor(db: DbOrTx, rows: readonly BenefitRow[]): Promise<Map<string, RealizationFacts>> {
  const out = new Map<string, RealizationFacts>();
  if (rows.length === 0) return out;
  const ids = rows.map((r) => r.id);
  const lines = await db
    .selectFrom("benefit_value_line")
    .select(["benefit_id", "value_state", "amount"])
    .where("benefit_id", "in", ids)
    .where("value_state", "in", ["validated", "sustained", "submitted"])
    .execute();
  const live = await db
    .selectFrom("benefit_measurement")
    .select(["benefit_id", (eb) => eb.fn.countAll<string>().as("n")])
    .where("benefit_id", "in", ids)
    .where("kind", "=", "measurement")
    .where("status", "<>", "superseded")
    .groupBy("benefit_id")
    .execute();
  const enablers = await enablerFacts(db, ids);
  const kpiIds = [
    ...new Set(rows.filter((r) => r.value_class === "non_financial").map((r) => r.measurement_kpi_definition_id!)),
  ].filter((v) => v !== null);
  const kpiActuals = await latestAcceptedKpiValues(db, kpiIds);
  for (const row of rows) {
    const mine = lines.filter((l) => l.benefit_id === row.id);
    const of = (state: string) => mine.filter((l) => l.value_state === state).map((l) => l.amount);
    const validated = of("validated");
    const sustained = of("sustained");
    const pending = of("submitted");
    let kpiActual: BenefitKpiActual = { status: "not_applicable", value: null, reason: null };
    if (row.value_class === "non_financial") {
      const v =
        row.measurement_kpi_definition_id === null ? undefined : kpiActuals.get(row.measurement_kpi_definition_id);
      kpiActual =
        v === undefined || v === null
          ? { status: "unknown", value: null, reason: "benefit.kpi_actual_missing" }
          : { status: "known", value: v, reason: null };
    }
    const e = enablers.get(row.id) ?? { active: 0, delivered: 0 };
    out.set(row.id, {
      realized: {
        validated: stateAmount(row, validated),
        validatedCount: validated.length,
        sustained: stateAmount(row, sustained),
        sustainedCount: sustained.length,
        pending: stateAmount(row, pending),
        pendingCount: pending.length,
        kpiActual,
      },
      liveMeasurements: Number(live.find((l) => l.benefit_id === row.id)?.n ?? 0),
      activeEnablers: e.active,
      deliveredEnablers: e.delivered,
    });
  }
  return out;
}

/**
 * Active and delivered enabler links per benefit (ADR-0029 §3): delivered = the deliverable is accepted, or, without a
 * deliverable, the initiative is completed. Delivered never means realized value (REQ-S08-002).
 */
export async function enablerFacts(
  db: DbOrTx,
  benefitIds: readonly string[],
): Promise<Map<string, { active: number; delivered: number }>> {
  const out = new Map<string, { active: number; delivered: number }>();
  if (benefitIds.length === 0) return out;
  const rows = await db
    .selectFrom("benefit_enabler as e")
    .innerJoin("initiative as i", "i.id", "e.initiative_id")
    .leftJoin("deliverable as d", "d.id", "e.deliverable_id")
    .select(["e.benefit_id", "e.deliverable_id", "d.acceptance_status", "i.status as initiative_status"])
    .where("e.benefit_id", "in", [...benefitIds])
    .where("e.status", "=", "active")
    .execute();
  for (const r of rows) {
    const cur = out.get(r.benefit_id) ?? { active: 0, delivered: 0 };
    const delivered =
      r.deliverable_id !== null ? r.acceptance_status === "accepted" : r.initiative_status === "completed";
    out.set(r.benefit_id, { active: cur.active + 1, delivered: cur.delivered + (delivered ? 1 : 0) });
  }
  return out;
}

/** The latest accepted value (by period end) of each KPI at transformation scope; null when it has no value. */
async function latestAcceptedKpiValues(db: DbOrTx, kpiIds: readonly string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (kpiIds.length === 0) return out;
  const rows = await db
    .selectFrom("kpi_actual as a")
    .innerJoin("kpi_actual_value as v", (j) =>
      j.onRef("v.kpi_actual_id", "=", "a.id").onRef("v.value_no", "=", "a.accepted_value_no"),
    )
    .select(["a.kpi_definition_id", "v.value", "a.period_end"])
    .where("a.kpi_definition_id", "in", [...kpiIds])
    .where("a.scope_kind", "=", "transformation")
    .where("a.accepted_value_no", "is not", null)
    .orderBy("a.period_end", "desc")
    .execute();
  for (const r of rows) if (!out.has(r.kpi_definition_id)) out.set(r.kpi_definition_id, r.value);
  return out;
}

function stateOf(f: RealizationFacts | undefined): BenefitRealizationState {
  return realizationStateOf({
    sustainedCount: f?.realized.sustainedCount ?? 0,
    validatedCount: f?.realized.validatedCount ?? 0,
    liveMeasurements: f?.liveMeasurements ?? 0,
    activeEnablers: f?.activeEnablers ?? 0,
    deliveredEnablers: f?.deliveredEnablers ?? 0,
  });
}

export function toBenefit(
  r: BenefitRow,
  counting: Benefit["counting"],
  realizationState: BenefitRealizationState,
): Benefit {
  return {
    id: r.id,
    transformationId: r.transformation_id,
    code: r.code,
    title: r.title,
    description: r.description,
    benefitType: r.benefit_type as BenefitType,
    valueClass: r.value_class as BenefitValueClass,
    ownerUserId: r.owner_user_id,
    financeValidatorUserId: r.finance_validator_user_id,
    financeValidationRequired: r.finance_validation_required,
    financialStatementLine: r.financial_statement_line,
    measurementKpiDefinitionId: r.measurement_kpi_definition_id,
    measurementKpiVariable: r.measurement_kpi_variable,
    businessCaseLineId: r.business_case_line_id,
    benefitFormulaId: r.benefit_formula_id,
    baselineId: r.baseline_id,
    baselineValue: r.baseline_value,
    baselineUnit: r.baseline_unit,
    baselineDate: r.baseline_date,
    counterfactual: r.counterfactual,
    baselineValidationStatus: r.baseline_validation_status as Benefit["baselineValidationStatus"],
    baselineValidatedBy: r.baseline_validated_by,
    baselineValidatedAt: isoOrNull(r.baseline_validated_at),
    baselineValidationNote: r.baseline_validation_note,
    driverKey: r.driver_key,
    driverUnits: r.driver_units,
    populationKey: r.population_key,
    targetValue: r.target_value,
    targetDate: r.target_date,
    realizationStart: r.realization_start,
    realizationEnd: r.realization_end,
    recurrence: r.recurrence as Benefit["recurrence"],
    currency: r.currency.trim(),
    plannedValue: r.planned_value,
    valuationMethodId: r.valuation_method_id,
    measurementSource: r.measurement_source,
    confidence: trimOrNull(r.confidence) as Benefit["confidence"],
    assumptions: r.assumptions,
    parentBenefitId: r.parent_benefit_id,
    benefitGroupId: r.benefit_group_id,
    allocationSetNo: r.allocation_set_no,
    lifecycleStep: r.lifecycle_step as BenefitLifecycleStep,
    recoveryPlan: r.recovery_plan,
    bauOwnerUserId: r.bau_owner_user_id,
    controlCadence: r.control_cadence as Benefit["controlCadence"],
    statusRag: r.status_rag as Benefit["statusRag"],
    statusRagNote: r.status_rag_note,
    realizationState,
    counting,
    status: r.status as Benefit["status"],
    archivedAt: isoOrNull(r.archived_at),
    archivedBy: r.archived_by,
    archiveReason: r.archive_reason,
    version: r.version,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
    updatedAt: iso(r.updated_at),
    updatedBy: r.updated_by,
  };
}

/** API benefits with their counting status and realization state (one query per concern, not per row). */
export async function presentBenefits(db: DbOrTx, rows: readonly BenefitRow[]): Promise<Benefit[]> {
  const ids = rows.map((r) => r.id);
  const counting = await countingFor(db, ids);
  const facts = await realizationFor(db, rows);
  return rows.map((r) => {
    const c = counting.get(r.id);
    return toBenefit(
      r,
      c ? { counted: c.counted, exclusionReason: c.exclusionReason, overlapOpen: c.overlapOpen } : NOT_COUNTED,
      stateOf(facts.get(r.id)),
    );
  });
}

export async function presentBenefit(db: DbOrTx, row: BenefitRow): Promise<Benefit> {
  return (await presentBenefits(db, [row]))[0]!;
}

// ------------------------------------------------------------------------------------------------ BE-M: initiatives[]
// One source of truth (ADR-0038 §8; T-DG4-BE-M; REQ-PB-010): the optional `BenefitRegisterRow.initiatives[]` member
// lists the initiatives of each benefit's CURRENT allocation set (benefit_allocation rows of set_no =
// benefit.allocation_set_no), with the initiative's code and name read by join from `initiative` (never a stored copy),
// so one rename of an initiative shows here at once. Ordered by code.

/** The initiatives of each benefit's current allocation set, by benefit id (names read by join). */
export async function registerInitiativesOf(
  db: DbOrTx,
  rows: readonly BenefitRow[],
): Promise<Map<string, InitiativeRef[]>> {
  const out = new Map<string, InitiativeRef[]>();
  const withSet = rows.filter((r) => r.allocation_set_no > 0);
  if (withSet.length === 0) return out;
  const found = await db
    .selectFrom("benefit_allocation as a")
    .innerJoin("benefit as b", (j) =>
      j.onRef("b.id", "=", "a.benefit_id").onRef("b.allocation_set_no", "=", "a.set_no"),
    )
    .innerJoin("initiative as i", "i.id", "a.initiative_id")
    .select(["a.benefit_id", "i.id", "i.code", "i.name"])
    .where(
      "a.benefit_id",
      "in",
      withSet.map((r) => r.id),
    )
    .orderBy("i.code")
    .orderBy("i.id")
    .execute();
  for (const f of found) {
    if (!out.has(f.benefit_id)) out.set(f.benefit_id, []);
    out.get(f.benefit_id)!.push({ id: f.id, code: f.code, name: f.name });
  }
  return out;
}
// ------------------------------------------------------------------------------------------------ end BE-M block

/** T14 register rows (ADR-0029 §4): the ten columns plus step, realization state and counting status. */
export async function presentRegisterRows(
  db: DbOrTx,
  rows: readonly BenefitRow[],
): Promise<(BenefitRegisterRow & { initiatives: InitiativeRef[] })[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const initiativesOf = await registerInitiativesOf(db, rows); // BE-M (ADR-0038 §8)
  const counting = await countingFor(db, ids);
  const facts = await realizationFor(db, rows);
  const evidence = await db
    .selectFrom("benefit_evidence")
    .select(["benefit_id", "evidence_id", "created_at"])
    .where("benefit_id", "in", ids)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .execute();
  return rows.map((r) => {
    const c = counting.get(r.id);
    const f = facts.get(r.id)!;
    const mine = evidence.filter((e) => e.benefit_id === r.id);
    return {
      id: r.id,
      code: r.code,
      title: r.title,
      benefitType: r.benefit_type as BenefitType,
      valueClass: r.value_class as BenefitValueClass,
      baseline: {
        value: r.baseline_value,
        unit: r.baseline_unit,
        date: r.baseline_date,
        baselineId: r.baseline_id,
        validationStatus: r.baseline_validation_status as BenefitRegisterRow["baseline"]["validationStatus"],
      },
      target: { value: r.target_value, date: r.target_date },
      valueSar: valueSarOf(r),
      realized: f.realized,
      ownerUserId: r.owner_user_id,
      evidenceCount: mine.length,
      latestEvidenceIds: [...new Set(mine.map((e) => e.evidence_id))].slice(0, 5),
      status: (r.status_rag ?? "unknown") as BenefitRegisterRow["status"],
      lifecycleStep: r.lifecycle_step as BenefitLifecycleStep,
      realizationState: stateOf(f),
      counting: c
        ? { counted: c.counted, exclusionReason: c.exclusionReason, overlapOpen: c.overlapOpen }
        : NOT_COUNTED,
      currency: r.currency.trim(),
      version: r.version,
      initiatives: initiativesOf.get(r.id) ?? [], // BE-M (ADR-0038 §8)
    };
  });
}

// ------------------------------------------------------------------------------------------------ rules

/** Columns audited on a benefit. */
export const BENEFIT_AUDIT_FIELDS = [
  "code",
  "title",
  "description",
  "benefit_type",
  "value_class",
  "owner_user_id",
  "finance_validator_user_id",
  "finance_validation_required",
  "financial_statement_line",
  "measurement_kpi_definition_id",
  "measurement_kpi_variable",
  "business_case_line_id",
  "benefit_formula_id",
  "baseline_id",
  "baseline_value",
  "baseline_unit",
  "baseline_date",
  "counterfactual",
  "baseline_validation_status",
  "baseline_validated_by",
  "baseline_validation_note",
  "driver_key",
  "driver_units",
  "population_key",
  "target_value",
  "target_date",
  "realization_start",
  "realization_end",
  "recurrence",
  "currency",
  "planned_value",
  "valuation_method_id",
  "measurement_source",
  "confidence",
  "assumptions",
  "parent_benefit_id",
  "benefit_group_id",
  "allocation_set_no",
  "lifecycle_step",
  "recovery_plan",
  "bau_owner_user_id",
  "control_cadence",
  "status_rag",
  "status_rag_note",
  "status",
  "archive_reason",
] as const satisfies readonly (keyof BenefitRow & string)[];

/** API body field -> column of the benefit row (the fields createBenefit and updateBenefit may set). */
const FIELD_COLUMNS = {
  title: "title",
  description: "description",
  benefitType: "benefit_type",
  valueClass: "value_class",
  ownerUserId: "owner_user_id",
  currency: "currency",
  financeValidatorUserId: "finance_validator_user_id",
  financeValidationRequired: "finance_validation_required",
  financialStatementLine: "financial_statement_line",
  measurementKpiDefinitionId: "measurement_kpi_definition_id",
  measurementKpiVariable: "measurement_kpi_variable",
  businessCaseLineId: "business_case_line_id",
  benefitFormulaId: "benefit_formula_id",
  baselineId: "baseline_id",
  baselineValue: "baseline_value",
  baselineUnit: "baseline_unit",
  baselineDate: "baseline_date",
  counterfactual: "counterfactual",
  driverKey: "driver_key",
  driverUnits: "driver_units",
  populationKey: "population_key",
  targetValue: "target_value",
  targetDate: "target_date",
  realizationStart: "realization_start",
  realizationEnd: "realization_end",
  recurrence: "recurrence",
  plannedValue: "planned_value",
  valuationMethodId: "valuation_method_id",
  measurementSource: "measurement_source",
  confidence: "confidence",
  assumptions: "assumptions",
  parentBenefitId: "parent_benefit_id",
  benefitGroupId: "benefit_group_id",
  recoveryPlan: "recovery_plan",
  bauOwnerUserId: "bau_owner_user_id",
  controlCadence: "control_cadence",
  statusRag: "status_rag",
  statusRagNote: "status_rag_note",
} as const satisfies Record<string, keyof BenefitRow & string>;

type ColumnValues = Partial<Record<keyof BenefitRow & string, unknown>>;

/** The columns a parsed body sets (only the properties present). */
export function columnsOf(body: BenefitCreate | BenefitUpdate): ColumnValues {
  const columns: ReadonlyMap<string, string> = new Map(Object.entries(FIELD_COLUMNS));
  return Object.fromEntries(
    Object.entries(body)
      .filter(([field]) => columns.has(field))
      .map(([field, value]) => [columns.get(field)!, value]),
  ) as ColumnValues;
}

const BASELINE_COLUMNS = ["baseline_value", "baseline_id", "baseline_date", "counterfactual"] as const;

/** The benefit row as it will be after the change (current + changes), as plain values. */
type Merged = BenefitRow;

async function hasValues(tx: DbOrTx, benefitId: string): Promise<boolean> {
  const r = await sql<{ any: boolean }>`
    SELECT EXISTS (SELECT 1 FROM benefit_plan_value WHERE benefit_id = ${benefitId}::uuid)
        OR EXISTS (SELECT 1 FROM benefit_scenario_value WHERE benefit_id = ${benefitId}::uuid)
        OR EXISTS (SELECT 1 FROM benefit_measurement WHERE benefit_id = ${benefitId}::uuid) AS any`.execute(tx);
  return r.rows[0]?.any === true;
}

/**
 * The ADR-0029 §1/§6/§11 rules on the merged row, checked BEFORE the database (which enforces them again). `current`
 * is null on create; `changed` lists the columns the body sets.
 */
export async function checkBenefitRules(
  tx: Tx,
  ctx: WriteContext,
  merged: Merged,
  current: BenefitRow | null,
  changed: ColumnValues,
): Promise<void> {
  const type = merged.benefit_type as BenefitType;
  const valueClass = merged.value_class as BenefitValueClass;
  const touched = (c: keyof BenefitRow) => current === null || Object.hasOwn(changed, c);

  // Type, class and currency are fixed once the benefit has values (benefit_measure_locked).
  if (
    current !== null &&
    (merged.benefit_type !== current.benefit_type ||
      merged.value_class !== current.value_class ||
      merged.currency.trim() !== current.currency.trim()) &&
    (await hasValues(tx, current.id))
  )
    throw benefitRule(
      "benefit.measure_locked",
      "This benefit has values, so its type, class and currency can no longer change.",
      "/valueClass",
    );
  if (!typeFitsClass(type, valueClass))
    throw benefitRule(
      "benefit.type_class_mismatch",
      `The value class ${valueClass} does not fit the benefit type ${type}. Revenue uplift and margin are revenue classes; cash savings and avoided cost are cost classes.`,
      "/valueClass",
    );
  if (isFinancialClass(valueClass) && merged.financial_statement_line === null)
    throw benefitRule(
      "benefit.mapping_required",
      "A financial benefit needs a financial-statement line.",
      "/financialStatementLine",
    );
  if (!isFinancialClass(valueClass) && merged.measurement_kpi_definition_id === null)
    throw benefitRule(
      "benefit.kpi_required",
      "A non-financial benefit needs an agreed KPI.",
      "/measurementKpiDefinitionId",
    );
  if (isFinancialClass(valueClass) && !merged.finance_validation_required)
    throw benefitRule(
      "validation.constraint",
      "Finance validation is always required for a financial benefit.",
      "/financeValidationRequired",
    );
  if (valueClass === "non_financial" && merged.planned_value !== null && merged.valuation_method_id === null)
    throw benefitRule(
      "benefit.valuation_method_required",
      "A non-financial benefit has no SAR value (n/a) unless an approved valuation method is selected.",
      "/plannedValue",
    );
  if (merged.valuation_method_id !== null) {
    const m = await tx
      .selectFrom("benefit_valuation_method")
      .select(["code", "status", "currency"])
      .where("id", "=", merged.valuation_method_id)
      .where("transformation_id", "=", ctx.transformationId)
      .executeTakeFirst();
    if (!m)
      await assertSameTransformation(
        tx,
        "benefit_valuation_method",
        ctx.transformationId,
        merged.valuation_method_id,
        "/valuationMethodId",
      );
    const recheck = touched("valuation_method_id") || touched("planned_value");
    if (
      m &&
      (valueClass !== "non_financial" ||
        (recheck && (m.status !== "approved" || m.currency.trim() !== merged.currency.trim())))
    )
      throw benefitRule(
        "benefit.valuation_method_not_approved",
        `The valuation method ${m.code} is not approved by Finance, or is in another currency.`,
        "/valuationMethodId",
      );
  }
  if (
    merged.measurement_kpi_variable !== null &&
    (merged.measurement_kpi_definition_id === null || merged.benefit_formula_id === null)
  )
    throw benefitRule(
      "benefit.kpi_variable_unbound",
      "A KPI-fed formula variable needs both the measurement KPI and the formula.",
      "/measurementKpiVariable",
    );
  if (merged.finance_validator_user_id !== null && merged.finance_validator_user_id === merged.owner_user_id)
    throw benefitRule(
      "benefit.validator_is_owner",
      "The Finance validator cannot be the benefit's owner.",
      "/financeValidatorUserId",
    );

  // References in the same transformation (422 validation.reference) and named people (422 validation.user_invalid).
  const t = ctx.transformationId;
  if (touched("measurement_kpi_definition_id"))
    await assertSameTransformation(
      tx,
      "kpi_definition",
      t,
      merged.measurement_kpi_definition_id,
      "/measurementKpiDefinitionId",
    );
  if (touched("benefit_formula_id"))
    await assertSameTransformation(tx, "benefit_formula", t, merged.benefit_formula_id, "/benefitFormulaId");
  if (touched("baseline_id")) await assertSameTransformation(tx, "baseline", t, merged.baseline_id, "/baselineId");
  if (touched("benefit_group_id"))
    await assertSameTransformation(tx, "benefit_group", t, merged.benefit_group_id, "/benefitGroupId");
  await assertActiveUsers(tx, ctx.organizationId, [
    { id: touched("owner_user_id") ? merged.owner_user_id : null, pointer: "/ownerUserId" },
    {
      id: touched("finance_validator_user_id") ? merged.finance_validator_user_id : null,
      pointer: "/financeValidatorUserId",
    },
    { id: touched("bau_owner_user_id") ? merged.bau_owner_user_id : null, pointer: "/bauOwnerUserId" },
  ]);

  // Business-case line: a benefit line of this transformation, backing at most one active benefit.
  if (touched("business_case_line_id") && merged.business_case_line_id !== null) {
    const line = await tx
      .selectFrom("business_case_line")
      .select(["id", "line_kind"])
      .where("id", "=", merged.business_case_line_id)
      .where("transformation_id", "=", t)
      .executeTakeFirst();
    if (!line || line.line_kind !== "benefit")
      throw benefitRule(
        "benefit.case_line_invalid",
        "The business-case line must be a benefit line of this transformation.",
        "/businessCaseLineId",
      );
    const taken = await tx
      .selectFrom("benefit")
      .select("code")
      .where("business_case_line_id", "=", merged.business_case_line_id)
      .where("status", "=", "active")
      .where("id", "<>", merged.id)
      .executeTakeFirst();
    if (taken)
      throw problems.duplicate(
        "benefit.case_line_taken",
        `This business-case line already backs benefit ${taken.code}.`,
      );
  }

  // Parent/child, one level (ADR-0029 §6).
  if (touched("parent_benefit_id") && merged.parent_benefit_id !== null) {
    const parent = await tx
      .selectFrom("benefit")
      .select(["id", "parent_benefit_id", "currency"])
      .where("id", "=", merged.parent_benefit_id)
      .where("transformation_id", "=", t)
      .executeTakeFirst();
    if (!parent) await assertSameTransformation(tx, "benefit", t, merged.parent_benefit_id, "/parentBenefitId");
    const hasChildren =
      current !== null &&
      (await tx.selectFrom("benefit").select("id").where("parent_benefit_id", "=", current.id).executeTakeFirst()) !==
        undefined;
    if (parent!.id === merged.id || parent!.parent_benefit_id !== null || hasChildren)
      throw benefitRule(
        "benefit.parent_depth",
        "A child benefit cannot have children, and a parent cannot be a child.",
        "/parentBenefitId",
      );
    if (parent!.currency.trim() !== merged.currency.trim())
      throw benefitRule(
        "benefit.parent_currency",
        `A child benefit uses its parent's currency (${parent!.currency.trim()}).`,
        "/currency",
      );
    if (await hasValues(tx, parent!.id))
      throw benefitRule(
        "benefit.parent_has_values",
        "This benefit already has values, so it cannot become a parent. A parent is the roll-up of its children.",
        "/parentBenefitId",
      );
  } else if (current !== null && touched("currency") && merged.currency.trim() !== current.currency.trim()) {
    // A parent's children use its currency: a parent cannot change currency under them.
    const parentCurrency =
      merged.parent_benefit_id === null
        ? null
        : (
            await tx
              .selectFrom("benefit")
              .select("currency")
              .where("id", "=", merged.parent_benefit_id)
              .executeTakeFirst()
          )?.currency.trim();
    const child = await tx
      .selectFrom("benefit")
      .select("id")
      .where("parent_benefit_id", "=", current.id)
      .executeTakeFirst();
    if ((parentCurrency !== null && parentCurrency !== merged.currency.trim()) || child)
      throw benefitRule(
        "benefit.parent_currency",
        `A child benefit uses its parent's currency (${parentCurrency ?? current.currency.trim()}).`,
        "/currency",
      );
  }

  // The counted member of a shared-benefit group stays in its group (benefit_group_counted_member).
  if (current !== null && current.benefit_group_id !== null && merged.benefit_group_id !== current.benefit_group_id) {
    const g = await tx
      .selectFrom("benefit_group")
      .select("counted_benefit_id")
      .where("id", "=", current.benefit_group_id)
      .executeTakeFirst();
    if (g?.counted_benefit_id === current.id)
      throw benefitRule(
        "benefit_group.counted_member_leaving",
        `Benefit ${current.code} is the counted member of its shared-benefit group. Name another counted member first.`,
        "/benefitGroupId",
      );
  }

  // Step outputs cannot be cleared once the step needs them (REQ-PB-074).
  if (current !== null) {
    const step = merged.lifecycle_step as BenefitLifecycleStep;
    const missing = missingFor(step, {
      valueClass,
      ownerUserId: merged.owner_user_id,
      baselineValue: merged.baseline_value,
      baselineId: merged.baseline_id,
      benefitFormulaId: merged.benefit_formula_id,
      targetValue: merged.target_value,
      recoveryPlan: merged.recovery_plan,
      bauOwnerUserId: merged.bau_owner_user_id,
      controlCadence: merged.control_cadence,
      activeEnablers: 1, // enablers are not a column; removing them is a separate operation
    });
    const planText = planOutputsText(missing);
    if (planText !== "") throw planOutputsMissing(planText);
    if (missing.includes("recovery_plan"))
      throw benefitRule("benefit.recovery_plan_required", "The Correct step needs a recovery plan.", "/recoveryPlan");
    if (missing.includes("bau_owner") || missing.includes("control_cadence"))
      throw benefitRule(
        "benefit.sustain_outputs_missing",
        "The Sustain step needs a BAU owner and a control cadence.",
        missing.includes("bau_owner") ? "/bauOwnerUserId" : "/controlCadence",
      );
  }
}

// ------------------------------------------------------------------------------------------------ mutations

/** Per-transformation T14 code B01, B02… (the record_code_counter UPSERT serialises concurrent creates). */
async function nextBenefitCode(tx: Tx, transformationId: string): Promise<string> {
  const row = await sql<{ last_value: number }>`
    INSERT INTO record_code_counter (transformation_id, prefix, last_value) VALUES (${transformationId}::uuid, 'B', 1)
    ON CONFLICT (transformation_id, prefix) DO UPDATE SET last_value = record_code_counter.last_value + 1
    RETURNING last_value`.execute(tx);
  return `B${String(row.rows[0]!.last_value).padStart(2, "0")}`;
}

async function createBenefit(tx: Tx, ctx: WriteContext, body: BenefitCreate): Promise<BenefitRow> {
  const id = uuidv7();
  const columns = columnsOf(body);
  // Every column absent from the body is NULL, except the database defaults the rules read.
  const merged = {
    ...Object.fromEntries((BENEFIT_AUDIT_FIELDS as readonly string[]).map((c) => [c, null])),
    id,
    transformation_id: ctx.transformationId,
    finance_validation_required: true,
    baseline_validation_status: "unvalidated",
    lifecycle_step: "identify",
    allocation_set_no: 0,
    status: "active",
    ...columns,
  } as unknown as Merged;
  await checkBenefitRules(tx, ctx, merged, null, columns);
  const row = await tx
    .insertInto("benefit")
    .values(
      // The parsed body fixes the column set; the required columns are present (strict schema), checked above.
      {
        ...(columns as Record<string, never>),
        id,
        organization_id: ctx.organizationId,
        transformation_id: ctx.transformationId,
        code: await nextBenefitCode(tx, ctx.transformationId),
        created_by: ctx.userId,
        updated_by: ctx.userId,
      } as never,
    )
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "benefit.create",
    recordType: "benefit",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    newVersion: row.version,
    changes: diffFields({} as BenefitRow, row, [...BENEFIT_AUDIT_FIELDS]),
  });
  await runKeysChangedHooks(tx, ctx, { before: null, after: row });
  return row;
}

async function updateBenefit(tx: Tx, request: FastifyRequest, transformationId: string, benefitId: string) {
  const ctx = await openBenefitWrite(tx, request, transformationId, BENEFIT_EDIT);
  const body = parseBody(benefitUpdate, request.body);
  const expected = requireIfMatch(request);
  const current = await lockBenefit(tx, transformationId, benefitId);
  checkBenefitVersion(current, expected);
  const changes = columnsOf(body);
  // A Finance-validated (or rejected) baseline that changes goes back to unvalidated in the same update (ADR-0029 §8).
  const changeMap = new Map(Object.entries(changes));
  const currentMap = new Map(Object.entries(current));
  const baselineChanged = BASELINE_COLUMNS.some(
    (c) => changeMap.has(c) && String(changeMap.get(c) ?? "") !== String(currentMap.get(c) ?? ""),
  );
  if (baselineChanged && current.baseline_validation_status !== "unvalidated")
    Object.assign(changes, {
      baseline_validation_status: "unvalidated",
      baseline_validated_by: null,
      baseline_validated_at: null,
      baseline_validation_note: null,
    });
  const merged = { ...current, ...changes } as Merged;
  await checkBenefitRules(tx, ctx, merged, current, changes);
  const updated = await tx
    .updateTable("benefit")
    .set({ ...(changes as Record<string, never>), ...bumpStamps(ctx.userId) })
    .where("id", "=", benefitId)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "benefit.update",
    recordType: "benefit",
    recordId: benefitId,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diffFields(current, updated, [...BENEFIT_AUDIT_FIELDS]),
  });
  if (overlapKeysChanged(current, updated)) await runKeysChangedHooks(tx, ctx, { before: current, after: updated });
  return updated;
}

async function archiveBenefit(tx: Tx, request: FastifyRequest, transformationId: string, benefitId: string) {
  const ctx = await openBenefitWrite(tx, request, transformationId, BENEFIT_EDIT);
  const { reason } = parseBody(reasonRequest, request.body);
  const expected = requireIfMatch(request);
  const current = await lockBenefit(tx, transformationId, benefitId);
  checkBenefitVersion(current, expected);
  const updated = await tx
    .updateTable("benefit")
    .set({
      status: "archived",
      archived_at: sql<Date>`now()`,
      archived_by: ctx.userId,
      archive_reason: reason,
      ...bumpStamps(ctx.userId),
    })
    .where("id", "=", benefitId)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "benefit.archive",
    recordType: "benefit",
    recordId: benefitId,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    reason,
    changes: diffFields(current, updated, [...BENEFIT_AUDIT_FIELDS]),
  });
  return updated;
}

// ------------------------------------------------------------------------------------------------ routes

const listQuery = benefitListQuery.extend({ cursor: cursorSchema, limit: limitSchema });

export function registerBenefitRegisterRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "transformation.read" as const } };
  const write = { access: { permission: BENEFIT_EDIT }, consumes: JSON_BODY };

  app.get(BENEFITS, { config: read }, async (request) => {
    const transformationId = parseTransformationParam(request.params);
    const query = parseQuery(listQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({ table: "benefit", transformationId, step: query.lifecycleStep, status: query.status });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("benefit").selectAll().where("transformation_id", "=", transformationId);
    q = q.where("status", "=", query.status ?? "active");
    if (query.lifecycleStep !== undefined) q = q.where("lifecycle_step", "=", query.lifecycleStep);
    if (after) q = q.where("id", ">", String(after[0]));
    const rows = await q
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: await presentRegisterRows(db, page.items), nextCursor: page.nextCursor };
  });

  app.post(BENEFITS, { config: write }, async (request, reply) => {
    const transformationId = parseTransformationParam(request.params);
    const result = await db.transaction().execute(async (tx) => {
      const ctx = await openBenefitWrite(tx, request, transformationId, BENEFIT_EDIT);
      const body = parseBody(benefitCreate, request.body);
      return maybeIdempotent(tx, request, ctx.userId, body, async () => ({
        status: 201,
        body: await presentBenefit(tx, await createBenefit(tx, ctx, body)),
      }));
    });
    return sendCreated(request, reply, result);
  });

  app.get(BENEFIT_ITEM, { config: read }, async (request, reply) => {
    const { transformationId, benefitId } = parseBenefitParams(request.params);
    const row = await readBenefitRow(db, request, transformationId, benefitId);
    return sendVersioned(reply, 200, await presentBenefit(db, row));
  });

  app.patch(BENEFIT_ITEM, { config: write }, async (request, reply) => {
    const { transformationId, benefitId } = parseBenefitParams(request.params);
    const body = await db
      .transaction()
      .execute(async (tx) => presentBenefit(tx, await updateBenefit(tx, request, transformationId, benefitId)));
    return sendVersioned(reply, 200, body);
  });

  app.post(`${BENEFIT_ITEM}/archive`, { config: write }, async (request, reply) => {
    const { transformationId, benefitId } = parseBenefitParams(request.params);
    const body = await db
      .transaction()
      .execute(async (tx) => presentBenefit(tx, await archiveBenefit(tx, request, transformationId, benefitId)));
    return sendVersioned(reply, 200, body);
  });

  return [
    `GET ${BENEFITS}`,
    `POST ${BENEFITS}`,
    `GET ${BENEFIT_ITEM}`,
    `PATCH ${BENEFIT_ITEM}`,
    `POST ${BENEFIT_ITEM}/archive`,
  ];
}
