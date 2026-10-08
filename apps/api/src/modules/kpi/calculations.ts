// T09 check (validate + preview) and the calculation lineage (ADR-0024 §6; REQ-PB-056, REQ-PB-057, REQ-S08-007;
// T-DG3-KBE-C):
//   POST /benefit-formulas/validate                                   parse + type-check + preview; writes NOTHING
//                                                                     (benefit_formula.edit held anywhere)
//   GET  /benefit-formulas/{id}/versions/{versionNo}/calculations     the lineage of a version, newest first
//   POST /benefit-formulas/{id}/versions/{versionNo}/calculations     evaluate the version with inputs, assumptions and a
//                                                                     period, and append one benefit_calculation row
//                                                                     (benefit_formula.edit)
//
// - Every value is computed by the shared engine (`@mth/shared/calc`, decimal.js precision 80, one storage rounding to
//   numeric(24,6) ROUND_HALF_UP); nothing here re-implements the arithmetic or holds a value in a JavaScript number.
// - Division by zero and a missing input give an Unknown result: `result` null with `outcome = error` and the engine's
//   `error_code` (formula.division_by_zero, formula.missing_input), never 0 and never Infinity.
// - The lineage row records the inputs actually used with their kind, unit, currency, period and source, the
//   assumptions, the period, the result (null when Unknown), the result type, the outcome, the error code, whether the
//   storage rounding changed the value (`rounded`) and the engine version. `benefit_calculation` is append-only (DB
//   trigger), and the full engine rounding record ({column, scale, mode, precision, exact, stored, rounded,
//   inexactIntermediate}) is kept as is in the row's audit event (the table has no column for it).
// - The request schema runs first (400); anything it admits but the engine refuses is 422 with the engine's first
//   error `code` and `message`.
import { type BenefitCalculationRow, type BenefitFormulaVariableRow, type Tx } from "@mth/db";
import { evaluateFormula, type FormulaVariable } from "@mth/shared/calc";
import {
  benefitCalculationCreate,
  canonicalDecimal,
  formulaCheckRequest,
  type BenefitCalculation,
  type FormulaCheckResult,
  type FormulaVariableView,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { holdsAnywhere, principalOf, requireTransformationRead } from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  cursorSchema,
  decodeCursor,
  etag,
  filterHash,
  iso,
  limitSchema,
  paginate,
  parseBody,
  parseQuery,
  problems,
  type ModuleDeps,
} from "../platform/index.ts";
import { openWrite } from "../transformations/index.ts";
import {
  archivedFormula,
  BENEFIT_FORMULAS,
  checkWithEngine,
  FORMULA_EDIT,
  formulaRule,
  formulaTransformation,
  JSON_BODY,
  lockFormula,
  toFormulaVariable,
} from "./benefit-formulas.ts";
import { lockVersion, parseVersionParams, VERSION_ITEM } from "./formula-versions.ts";

export const CALCULATIONS = `${VERSION_ITEM}/calculations`;
/** Source recorded for a value given in the calculation request instead of the version's own value. */
export const OVERRIDE_SOURCE = "Calculation input (overrides the version value)";

// ------------------------------------------------------------------------------------------------ presenters

const dateOrNull = (d: string | null): string | null => (d === null ? null : String(d).slice(0, 10));

export function toBenefitCalculation(r: BenefitCalculationRow): BenefitCalculation {
  return {
    id: r.id,
    formulaVersionId: r.formula_version_id,
    inputs: r.inputs as BenefitCalculation["inputs"],
    assumptions: r.assumptions,
    periodStart: dateOrNull(r.period_start),
    periodEnd: dateOrNull(r.period_end),
    outcome: r.outcome as BenefitCalculation["outcome"],
    result: r.result === null ? null : canonicalDecimal(r.result),
    resultKind: r.result_kind as BenefitCalculation["resultKind"],
    resultUnit: r.result_unit,
    resultCurrency: r.result_currency === null ? null : r.result_currency.trim(),
    resultPeriod: r.result_period as BenefitCalculation["resultPeriod"],
    errorCode: r.error_code,
    rounded: r.rounded,
    engineVersion: r.engine_version,
    computedAt: iso(r.computed_at),
    computedBy: r.computed_by,
  };
}

/** Engine variables from stored rows (values as exact decimal strings; null = no value). */
export function engineVariables(rows: readonly BenefitFormulaVariableRow[]): FormulaVariable[] {
  return [...rows]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((v) => {
      const view = toFormulaVariable(v);
      return {
        name: view.name,
        kind: view.kind,
        period: view.period,
        unit: view.unit,
        currency: view.currency,
        value: view.value,
        source: view.source,
        description: view.description,
      };
    });
}

// ------------------------------------------------------------------------------------------------ check (no write)

/**
 * POST /benefit-formulas/validate: the engine's verdict and preview for an expression with typed variables. A body
 * the engine refuses is 422 (first error); an accepted one returns its result type and preview, where `result` is
 * null (Unknown) with the evaluation warnings when a value is missing or a division by zero occurs.
 */
export function checkFormula(body: unknown): FormulaCheckResult {
  const req = parseBody(formulaCheckRequest, body);
  checkWithEngine(req);
  const evaluation = evaluateFormula(req.expression, req.variables);
  const t = evaluation.resultType!;
  return {
    valid: true,
    resultKind: t.kind,
    resultUnit: t.unit,
    resultCurrency: t.currency,
    resultPeriod: t.period,
    result: evaluation.result,
    errors: evaluation.errors.map((e) => ({ code: e.code, message: e.message, pointer: "/expression" })),
  };
}

// ------------------------------------------------------------------------------------------------ calculation (append)

async function createCalculation(tx: Tx, request: FastifyRequest, formulaId: string, versionNo: number) {
  const transformationId = await formulaTransformation(tx, formulaId);
  const ctx = await openWrite(tx, request, transformationId, [{ permission: FORMULA_EDIT }], null, {
    atCommit: true,
  });
  const body = parseBody(benefitCalculationCreate, request.body ?? {});
  const formula = await lockFormula(tx, transformationId, formulaId, "share");
  const version = await lockVersion(tx, transformationId, formulaId, versionNo, "share");
  if (formula.status === "archived") throw archivedFormula();
  const rows = await tx
    .selectFrom("benefit_formula_variable")
    .selectAll()
    .where("formula_version_id", "=", version.id)
    .orderBy("ordinal")
    .execute();
  const variables = engineVariables(rows);
  const inputs = body.inputs ?? {};
  for (const name of Object.keys(inputs))
    if (!variables.some((v) => v.name === name))
      throw formulaRule("formula.undefined_variable", `Undefined variable: ${name}`, `/inputs/${name}`);
  if (body.periodStart !== undefined && body.periodEnd !== undefined && body.periodEnd < body.periodStart)
    throw formulaRule("benefit_calculation.period_range", "The period ends before it starts.", "/periodEnd");
  const evaluation = evaluateFormula(version.expression, variables, inputs);
  const unknown = evaluation.result === null;
  const errorCode = unknown ? (evaluation.errorCode ?? "formula.missing_input") : null;
  // Lineage inputs: every variable with the value actually used and where it came from.
  const given = new Map(Object.entries(inputs));
  const used = new Map(Object.entries(evaluation.inputs));
  const lineage = Object.fromEntries(
    variables.map((v): [string, FormulaVariableView] => {
      const value = used.has(v.name) ? (used.get(v.name) ?? null) : (v.value ?? null);
      return [
        v.name,
        {
          name: v.name,
          kind: v.kind,
          unit: v.unit ?? null,
          currency: v.currency ?? null,
          period: v.period,
          value: value === null ? null : canonicalDecimal(value),
          description: v.description ?? null,
          source: given.has(v.name) ? OVERRIDE_SOURCE : (v.source ?? null),
        },
      ];
    }),
  );
  const id = uuidv7();
  const row = await tx
    .insertInto("benefit_calculation")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      formula_version_id: version.id,
      inputs: JSON.stringify(lineage),
      assumptions: body.assumptions ?? null,
      period_start: body.periodStart ?? null,
      period_end: body.periodEnd ?? null,
      outcome: unknown ? "error" : "ok",
      result: unknown ? null : evaluation.rounding.stored,
      result_kind: version.result_kind,
      result_unit: version.result_unit,
      result_currency: version.result_currency,
      result_period: version.result_period,
      error_code: errorCode,
      rounded: evaluation.rounding.rounded,
      engine_version: evaluation.engineVersion,
      computed_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "benefit_calculation.create",
    recordType: "benefit_calculation",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    changes: {
      formula_version_id: { from: null, to: version.id },
      outcome: { from: null, to: row.outcome },
      result: { from: null, to: row.result },
      error_code: { from: null, to: errorCode },
      engine_version: { from: null, to: row.engine_version },
      rounding: { from: null, to: evaluation.rounding },
      inputs: { from: null, to: lineage },
    },
  });
  return row;
}

// ------------------------------------------------------------------------------------------------ routes

const listQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });

export function registerCalculationRoutes(app: FastifyInstance, { db }: ModuleDeps): readonly string[] {
  app.post(
    `${BENEFIT_FORMULAS}/validate`,
    { config: { access: { permission: FORMULA_EDIT }, consumes: JSON_BODY } },
    async (request) => {
      // Writes nothing and has no transformation: the caller must hold benefit_formula.edit somewhere (403 otherwise,
      // so a read-only auditor is refused before the body is looked at).
      if (!holdsAnywhere(principalOf(request), FORMULA_EDIT)) throw problems.forbidden();
      return checkFormula(request.body);
    },
  );

  app.get(CALCULATIONS, { config: { access: { permission: "transformation.read" } } }, async (request) => {
    const { formulaId, versionNo } = parseVersionParams(request.params);
    const query = parseQuery(listQuery, request.query);
    const transformationId = await formulaTransformation(db, formulaId);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const version = await db
      .selectFrom("benefit_formula_version")
      .select("id")
      .where("formula_id", "=", formulaId)
      .where("version_no", "=", versionNo)
      .executeTakeFirst();
    if (!version) throw problems.notFound();
    const hash = filterHash({ table: "benefit_calculation", formulaVersionId: version.id });
    const after = decodeCursor(query.cursor, hash, 2);
    let q = db.selectFrom("benefit_calculation").selectAll().where("formula_version_id", "=", version.id);
    if (after)
      q = q.where((eb) =>
        eb.or([
          eb("computed_at", "<", new Date(String(after[0]))),
          eb.and([eb("computed_at", "=", new Date(String(after[0]))), eb("id", "<", String(after[1]))]),
        ]),
      );
    const rows = await q
      .orderBy("computed_at", "desc")
      .orderBy("id", "desc")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.computed_at.toISOString(), r.id], hash);
    return { items: page.items.map(toBenefitCalculation), nextCursor: page.nextCursor };
  });

  app.post(
    CALCULATIONS,
    { config: { access: { permission: FORMULA_EDIT }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { formulaId, versionNo } = parseVersionParams(request.params);
      const row = await db.transaction().execute((tx) => createCalculation(tx, request, formulaId, versionNo));
      // An append-only lineage row has no version column: it is created once and never changes (ETag "1").
      reply.header("ETag", etag(1));
      reply.header("Location", `/api/v1/benefit-formulas/${formulaId}/versions/${versionNo}/calculations/${row.id}`);
      return reply.code(201).send(toBenefitCalculation(row));
    },
  );

  return [`POST ${BENEFIT_FORMULAS}/validate`, `GET ${CALCULATIONS}`, `POST ${CALCULATIONS}`];
}
