// Amendments and reversals of approved benefit values (P4 slice B; ADR-0030 §4, §11; T-DG4-KBE-E; REQ-S08-017):
//   POST /transformations/{t}/finance-validations/{id}/amendments  { correctedAmount, reason }  (finance.validate)
//   POST /transformations/{t}/finance-validations/{id}/reversals   { reason }                   (finance.validate)
//
// - A validated value is NEVER edited in place (updateBenefitMeasurement answers 409). A correction is a NEW pair of
//   rows linked to the original: a benefit_measurement of kind `amendment`/`reversal` (corrects_measurement_id = the
//   original) carrying its SIGNED contribution in amount = validated_amount, and a finance_validation of the same kind
//   (corrects_validation_id = the original decision), approved on creation by its Finance author. All rows stay
//   visible; the validated total is the signed sum, so a reversal nets the original (and its amendments) to zero.
//   amendment amount = correctedAmount − (original validated amount + earlier amendments); reversal amount =
//   −(original + amendments), once per original (422 finance_validation.already_reversed).
// - FIN only (BO, AUD and ADM-only callers get 403), If-Match on the original decision (428/409), the financeValidationQueue advisory lock on the
//   original measurement, decimal.js arithmetic only, and one audit event per new row whose actor is the Finance author.
// A correction is a Finance-authored record inside the product; it never relates to the engineering gates DG0-DG7.
import { diffFields, sql, type BenefitMeasurementRow, type FinanceValidationRow, type Tx } from "@mth/db";
import { FORMULA_DECIMAL as D } from "@mth/shared/calc";
import { buildFinanceContent, financeValidationAmendment, reasonRequest } from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { record } from "../audit/index.ts";
import { parseBody, problems, requireIfMatch, sendVersioned, type ModuleDeps } from "../platform/index.ts";
import type { WriteContext } from "../transformations/index.ts";
import { benefitRule, JSON_BODY, lockBenefit } from "./register.ts";
import { lockMeasurement, lockQueue, MEASUREMENT_AUDIT_FIELDS } from "./measurements.ts";
import {
  FINANCE_VALIDATE,
  FINANCE_VALIDATION_ITEM,
  findValidation,
  openFinanceWrite,
  parseValidationParams,
  toFinanceValidation,
  VALIDATION_AUDIT_FIELDS,
} from "./finance-validation.ts";
import { money4 } from "./values.ts";

// ------------------------------------------------------------------------------------------------ problems (ADR-0030 §11)

export const notApproved = () =>
  benefitRule("finance_validation.not_approved", "Only an approved validation can be amended or reversed.");
export const alreadyReversed = () =>
  benefitRule("finance_validation.already_reversed", "This value is already reversed.");
export const amendmentUnchanged = () =>
  benefitRule(
    "finance_validation.amendment_unchanged",
    "The corrected amount equals the current validated amount.",
    "/correctedAmount",
  );

// ------------------------------------------------------------------------------------------------ arithmetic (pure)

/** The current validated amount of an original: its validated amount plus every earlier amendment (signed). */
export function currentValidated(original: string, amendments: readonly string[]): string {
  return amendments.reduce((acc, a) => acc.plus(new D(a)), new D(original)).toFixed();
}

/** The signed amendment delta: corrected − current (money scale). */
export function amendmentDelta(corrected: string, current: string): string {
  return money4(new D(corrected).minus(new D(current)).toFixed());
}

/** The reversal amount: −current (money scale), which nets the original and its amendments to zero. */
export function reversalAmount(current: string): string {
  return money4(new D(current).negated().toFixed());
}

// ------------------------------------------------------------------------------------------------ the correction

interface Target {
  readonly validation: FinanceValidationRow;
  readonly original: BenefitMeasurementRow;
  readonly current: string;
}

/** Opens the original approved validation for a correction: locks, If-Match, the approved/reversed checks. */
async function openTarget(tx: Tx, request: FastifyRequest, transformationId: string, id: string): Promise<Target> {
  const expected = requireIfMatch(request);
  const peek = await findValidation(tx, transformationId, id);
  await lockQueue(tx, peek.benefit_measurement_id);
  const validation = await findValidation(tx, transformationId, id, true);
  if (validation.kind !== "validation" || validation.status !== "approved") throw notApproved();
  if (validation.version !== expected) throw problems.versionConflict(validation.version);
  const original = await lockMeasurement(tx, transformationId, validation.benefit_measurement_id);
  if (original.status !== "validated" || original.validated_amount === null) throw notApproved();
  const corrections = await tx
    .selectFrom("benefit_measurement")
    .select(["kind", "amount"])
    .where("corrects_measurement_id", "=", original.id)
    .execute();
  if (corrections.some((c) => c.kind === "reversal")) throw alreadyReversed();
  const amendments = corrections.filter((c) => c.kind === "amendment").map((c) => c.amount!);
  return { validation, original, current: currentValidated(original.validated_amount, amendments) };
}

async function createCorrection(
  tx: Tx,
  ctx: WriteContext,
  target: Target,
  kind: "amendment" | "reversal",
  amount: string,
  reason: string,
): Promise<FinanceValidationRow> {
  const { original, validation } = target;
  // FOR UPDATE on the benefit serialises measurement numbers (benefit_measurement_no_step).
  const benefit = await lockBenefit(tx, ctx.transformationId, original.benefit_id, "update");
  const no = await tx
    .selectFrom("benefit_measurement")
    .select((eb) => eb.fn.max("measurement_no").as("n"))
    .where("benefit_id", "=", original.benefit_id)
    .executeTakeFirstOrThrow();
  const measurementId = uuidv7();
  const m = await tx
    .insertInto("benefit_measurement")
    .values({
      id: measurementId,
      organization_id: ctx.organizationId,
      transformation_id: ctx.transformationId,
      benefit_id: original.benefit_id,
      measurement_no: Number(no.n ?? 0) + 1,
      kind,
      corrects_measurement_id: original.id,
      source: "correction",
      formula_version_id: null,
      period_start: original.period_start,
      period_end: original.period_end,
      amount,
      currency: original.currency.trim(),
      attribution: original.attribution,
      assumptions: original.assumptions,
      status: "validated",
      validated_amount: amount,
      submitted_by: ctx.userId,
      submitted_at: sql<Date>`now()`,
      decided_by: ctx.userId,
      decided_at: sql<Date>`now()`,
      reason,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  const content = buildFinanceContent({ benefit, measurement: m, inputs: [], evidenceIds: [] });
  const fvId = uuidv7();
  const fv = await tx
    .insertInto("finance_validation")
    .values({
      id: fvId,
      organization_id: ctx.organizationId,
      transformation_id: ctx.transformationId,
      benefit_id: original.benefit_id,
      benefit_measurement_id: measurementId,
      kind,
      corrects_validation_id: validation.id,
      idempotency_key: `finance_validation.${kind}:${measurementId}`,
      assignee_user_id: null,
      status: "approved",
      content: JSON.stringify(content),
      measurement_period_start: m.period_start,
      measurement_period_end: m.period_end,
      approved_amount: amount,
      decided_by: ctx.userId,
      decided_at: m.decided_at,
      reason,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: `benefit_measurement.${kind}`,
    recordType: "benefit_measurement",
    recordId: measurementId,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    newVersion: m.version,
    reason,
    changes: diffFields({} as BenefitMeasurementRow, m, [...MEASUREMENT_AUDIT_FIELDS]),
  });
  await record(tx, ctx.audit, {
    action: `finance_validation.${kind}`,
    recordType: "finance_validation",
    recordId: fvId,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    newVersion: fv.version,
    reason,
    changes: diffFields({} as FinanceValidationRow, fv, [...VALIDATION_AUDIT_FIELDS]),
  });
  return fv;
}

async function amend(tx: Tx, request: FastifyRequest, transformationId: string, id: string) {
  const ctx = await openFinanceWrite(tx, request, transformationId);
  const body = parseBody(financeValidationAmendment, request.body);
  const target = await openTarget(tx, request, transformationId, id);
  const delta = amendmentDelta(body.correctedAmount, target.current);
  if (new D(delta).isZero()) throw amendmentUnchanged();
  return createCorrection(tx, ctx, target, "amendment", delta, body.reason);
}

async function reverse(tx: Tx, request: FastifyRequest, transformationId: string, id: string) {
  const ctx = await openFinanceWrite(tx, request, transformationId);
  const body = parseBody(reasonRequest, request.body);
  const target = await openTarget(tx, request, transformationId, id);
  return createCorrection(tx, ctx, target, "reversal", reversalAmount(target.current), body.reason);
}

// ------------------------------------------------------------------------------------------------ routes

export function registerBenefitCorrectionRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const write = { access: { permission: FINANCE_VALIDATE }, consumes: JSON_BODY };
  const AMEND = `${FINANCE_VALIDATION_ITEM}/amendments`;
  const REVERSE = `${FINANCE_VALIDATION_ITEM}/reversals`;
  const location = (t: string, id: string) => `/api/v1/transformations/${t}/finance-validations/${id}`;

  app.post(AMEND, { config: write }, async (request, reply) => {
    const { transformationId, financeValidationId } = parseValidationParams(request.params);
    const body = await db
      .transaction()
      .execute(async (tx) => toFinanceValidation(await amend(tx, request, transformationId, financeValidationId)));
    return sendVersioned(reply, 201, body, location(transformationId, body.id));
  });

  app.post(REVERSE, { config: write }, async (request, reply) => {
    const { transformationId, financeValidationId } = parseValidationParams(request.params);
    const body = await db
      .transaction()
      .execute(async (tx) => toFinanceValidation(await reverse(tx, request, transformationId, financeValidationId)));
    return sendVersioned(reply, 201, body, location(transformationId, body.id));
  });

  return [`POST ${AMEND}`, `POST ${REVERSE}`];
}
