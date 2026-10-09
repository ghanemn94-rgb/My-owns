// T09 Benefit Formula register (ADR-0024 §6; REQ-PB-056, REQ-PB-057, REQ-S08-007; T-DG3-KBE-C):
//   GET  /benefit-formula-examples                  the two B0087 source examples (illustrative, synthetic values)
//   GET  /benefit-formulas?transformationId=…       list (transformation.read), newest first
//   POST /benefit-formulas                          create a T09 row (benefit_formula.edit), optionally with its
//                                                   version 1 (`initialVersion`) or from a seeded example (`fromExample`)
//   GET  /benefit-formulas/{id}                     read, with the current version (the T09 *Formula* column)
//   PATCH /benefit-formulas/{id}                    the T09 text columns (benefit_formula.edit; If-Match)
//   POST /benefit-formulas/{id}/archive             archive with a reason (benefit_formula.edit; If-Match)
//
// - All six T09 columns persist: Benefit (benefit_name), Baseline driver, Change assumption, Formula (the current
//   version's expression, formula-versions.ts), Ramp and Confidence (H/M/L only: 400 by the enum, DB CHECK too).
// - Codes BF-01… come from record_code_counter (prefix BF). An instantiated example is `is_illustrative` until the
//   row is edited or a new version is created.
// - Every expression is parsed and type-checked by the shared engine (`@mth/shared/calc`) BEFORE anything is written;
//   an expression the schema admits but the engine refuses is 422 with the engine's first `code` and `message`.
// - Every mutation: authorization re-checked at commit time inside the write transaction (openWrite atCommit, BE18A),
//   zod validation then business rules, If-Match 428/409 (creates start at version 1), audit events. No client or
//   remote I/O inside a transaction (the body is parsed before the handler runs).
// Product gates G1-G6 are business approvals inside the product; nothing here grants a business, Finance or IT
// approval, and nothing touches the engineering gates DG0-DG7.
import { createHash } from "node:crypto";
import {
  diffFields,
  sql,
  type BenefitFormulaRow,
  type BenefitFormulaVariableRow,
  type BenefitFormulaVersionRow,
  type DbOrTx,
  type Tx,
} from "@mth/db";
import { PROBLEM_TYPES } from "@mth/shared";
import { ENGINE_VERSION, evaluateAst, validateFormula, type CheckedFormula } from "@mth/shared/calc";
import {
  benefitFormulaCreate,
  benefitFormulaListQuery,
  benefitFormulaUpdate,
  canonicalDecimal,
  reasonRequest,
  type BenefitFormula,
  type BenefitFormulaExample,
  type BenefitFormulaVersion,
  type BenefitFormulaVersionCreate,
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
  filterHash,
  HttpProblem,
  iso,
  isoOrNull,
  limitSchema,
  materialChangePort,
  paginate,
  parse,
  parseBody,
  parseQuery,
  problems,
  requireIfMatch,
  sendVersioned,
  type ModuleDeps,
} from "../platform/index.ts";
import { bumpStamps, maybeIdempotent, openWrite, sendCreated, type WriteContext } from "../transformations/index.ts";
import { requireActiveUsers } from "./support.ts";

export const BENEFIT_FORMULAS = "/api/v1/benefit-formulas";
export const FORMULA_ITEM = `${BENEFIT_FORMULAS}/:benefitFormulaId`;
export const BENEFIT_FORMULA_EXAMPLES = "/api/v1/benefit-formula-examples";
export const JSON_BODY = ["application/json"] as const;
export const FORMULA_EDIT = "benefit_formula.edit" as const;

// ------------------------------------------------------------------------------------------------ problems

/** A 422 business rule with one error at `pointer` (code = i18n key, detail = English text). */
export const formulaRule = (code: string, detail: string, pointer: string) =>
  new HttpProblem({
    status: 422,
    type: PROBLEM_TYPES.validation,
    code,
    title: "Business rule violated",
    detail,
    errors: [{ pointer, code, message: detail }],
  });

export const archivedFormula = () =>
  problems.businessRule(
    "benefit_formula.archived",
    "Archived benefit formulas, their versions and their calculations are read-only.",
  );

// ------------------------------------------------------------------------------------------------ engine boundary

/**
 * Parses and type-checks an expression with its typed variables through the shared engine, before anything is
 * written (ADR-0024 §6 "Status boundary for KBE-C"). The schema already ran (400); a refusal here is 422
 * `urn:mth:problem:validation` with the engine's first error: `code` as code, `message` as detail.
 */
export function checkWithEngine(body: Pick<BenefitFormulaVersionCreate, "expression" | "variables">, prefix = "") {
  const v = validateFormula(body.expression, body.variables);
  if (!v.ok) {
    const first = v.errors[0]!;
    const pointer = first.code === "formula.invalid_variable" ? `${prefix}/variables` : `${prefix}/expression`;
    throw formulaRule(first.code, first.message, pointer);
  }
  return v;
}

/** SHA-256 (hex) of the expression text as stored (UTF-8). */
export function expressionSha256(expression: string): string {
  return createHash("sha256").update(expression, "utf8").digest("hex");
}

// ------------------------------------------------------------------------------------------------ presenters

const canonicalOrNull = (v: string | null): string | null => (v === null ? null : canonicalDecimal(v));

export function toFormulaVariable(v: BenefitFormulaVariableRow): FormulaVariableView {
  return {
    name: v.name,
    kind: v.kind as FormulaVariableView["kind"],
    unit: v.unit,
    currency: v.currency === null ? null : v.currency.trim(),
    period: v.period as FormulaVariableView["period"],
    value: canonicalOrNull(v.value),
    description: v.description,
    source: v.source,
  };
}

export function toFormulaVersion(
  r: BenefitFormulaVersionRow,
  variables: readonly BenefitFormulaVariableRow[],
): BenefitFormulaVersion {
  return {
    id: r.id,
    formulaId: r.formula_id,
    versionNo: r.version_no,
    expression: r.expression,
    expressionSha256: r.expression_sha256.trim(),
    variables: [...variables].sort((a, b) => a.ordinal - b.ordinal).map(toFormulaVariable),
    resultKind: r.result_kind as BenefitFormulaVersion["resultKind"],
    resultUnit: r.result_unit,
    resultCurrency: r.result_currency === null ? null : r.result_currency.trim(),
    resultPeriod: r.result_period as BenefitFormulaVersion["resultPeriod"],
    previewResult: canonicalOrNull(r.preview_result),
    engineVersion: r.engine_version,
    changeNote: r.change_note,
    validationStatus: r.validation_status as BenefitFormulaVersion["validationStatus"],
    validatedBy: r.validated_by,
    validatedAt: isoOrNull(r.validated_at),
    validationNote: r.validation_note,
    version: r.version,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
  };
}

/** API versions of the given version rows (their variables loaded in one query). */
export async function presentVersions(
  db: DbOrTx,
  rows: readonly BenefitFormulaVersionRow[],
): Promise<BenefitFormulaVersion[]> {
  if (rows.length === 0) return [];
  const vars = await db
    .selectFrom("benefit_formula_variable")
    .selectAll()
    .where(
      "formula_version_id",
      "in",
      rows.map((r) => r.id),
    )
    .orderBy("ordinal")
    .execute();
  return rows.map((r) =>
    toFormulaVersion(
      r,
      vars.filter((v) => v.formula_version_id === r.id),
    ),
  );
}

export function toBenefitFormula(f: BenefitFormulaRow, current: BenefitFormulaVersion | null): BenefitFormula {
  return {
    id: f.id,
    organizationId: f.organization_id,
    transformationId: f.transformation_id,
    code: f.code,
    benefitName: f.benefit_name,
    baselineDriver: f.baseline_driver,
    changeAssumption: f.change_assumption,
    ramp: f.ramp,
    confidence: f.confidence === null ? null : (f.confidence.trim() as BenefitFormula["confidence"]),
    ownerUserId: f.owner_user_id,
    currentVersionNo: f.current_version_no,
    currentVersion: current,
    isIllustrative: f.is_illustrative,
    exampleCode: f.example_code as BenefitFormula["exampleCode"],
    status: f.status as BenefitFormula["status"],
    archivedAt: isoOrNull(f.archived_at),
    archivedBy: f.archived_by,
    archiveReason: f.archive_reason,
    version: f.version,
    createdAt: iso(f.created_at),
    createdBy: f.created_by,
    updatedAt: iso(f.updated_at),
    updatedBy: f.updated_by,
  };
}

/** API T09 rows, each with its current version. */
export async function presentFormulas(db: DbOrTx, rows: readonly BenefitFormulaRow[]): Promise<BenefitFormula[]> {
  const withCurrent = rows.filter((r) => r.current_version_no !== null);
  const versions =
    withCurrent.length === 0
      ? []
      : await db
          .selectFrom("benefit_formula_version")
          .selectAll()
          .where((eb) =>
            eb.or(
              withCurrent.map((r) =>
                eb.and([eb("formula_id", "=", r.id), eb("version_no", "=", r.current_version_no!)]),
              ),
            ),
          )
          .execute();
  const presented = await presentVersions(db, versions);
  return rows.map((r) => toBenefitFormula(r, presented.find((v) => v.formulaId === r.id) ?? null));
}

export async function presentFormula(db: DbOrTx, row: BenefitFormulaRow): Promise<BenefitFormula> {
  return (await presentFormulas(db, [row]))[0]!;
}

// ------------------------------------------------------------------------------------------------ access helpers

const formulaParams = z.strictObject({ benefitFormulaId: z.uuid() });

export function parseFormulaId(params: unknown): string {
  return parse(formulaParams, params, "params").benefitFormulaId;
}

/** The formula for a read: 404 when it does not exist or the caller cannot read its transformation. */
export async function readFormula(db: DbOrTx, request: FastifyRequest, id: string): Promise<BenefitFormulaRow> {
  const row = await db.selectFrom("benefit_formula").selectAll().where("id", "=", id).executeTakeFirst();
  if (!row) throw problems.notFound();
  await requireTransformationRead(db, principalOf(request), row.transformation_id);
  return row;
}

/** The transformation a formula belongs to (no lock; 404 when the formula does not exist). */
export async function formulaTransformation(db: DbOrTx, id: string): Promise<string> {
  const row = await db
    .selectFrom("benefit_formula")
    .select("transformation_id")
    .where("id", "=", id)
    .executeTakeFirst();
  if (!row) throw problems.notFound();
  return row.transformation_id;
}

/** Locks the formula row for a change (FOR UPDATE) or for a dependent write (FOR SHARE). */
export async function lockFormula(tx: Tx, transformationId: string, id: string, mode: "update" | "share") {
  let q = tx
    .selectFrom("benefit_formula")
    .selectAll()
    .where("id", "=", id)
    .where("transformation_id", "=", transformationId);
  q = mode === "update" ? q.forUpdate() : q.forShare();
  const row = await q.executeTakeFirst();
  if (!row) throw problems.notFound();
  return row;
}

/** Per-transformation BF-01 code (the record_code_counter UPSERT serialises concurrent creates). */
async function nextFormulaCode(tx: Tx, transformationId: string): Promise<string> {
  const row = await sql<{ last_value: number }>`
    INSERT INTO record_code_counter (transformation_id, prefix, last_value) VALUES (${transformationId}::uuid, 'BF', 1)
    ON CONFLICT (transformation_id, prefix) DO UPDATE SET last_value = record_code_counter.last_value + 1
    RETURNING last_value`.execute(tx);
  return `BF-${String(row.rows[0]!.last_value).padStart(2, "0")}`;
}

// ------------------------------------------------------------------------------------------------ versions (write)

/** Columns audited on a T09 row. */
export const BENEFIT_FORMULA_AUDIT_FIELDS = [
  "benefit_name",
  "baseline_driver",
  "change_assumption",
  "ramp",
  "confidence",
  "owner_user_id",
  "current_version_no",
  "is_illustrative",
  "example_code",
  "status",
  "archive_reason",
] as const satisfies readonly (keyof BenefitFormulaRow & string)[];

/** Columns audited on a formula version (immutable apart from the Finance validation). */
export const FORMULA_VERSION_AUDIT_FIELDS = [
  "version_no",
  "expression",
  "expression_sha256",
  "result_kind",
  "result_unit",
  "result_currency",
  "result_period",
  "preview_result",
  "engine_version",
  "change_note",
  "validation_status",
  "validated_by",
  "validation_note",
] as const satisfies readonly (keyof BenefitFormulaVersionRow & string)[];

/**
 * Writes one immutable formula version and its typed variables (append-only), from a body the engine has already
 * accepted (`checked`). The preview is the evaluation of the variables' own values: Unknown (null) when one is
 * missing or a division by zero occurs, never 0. Audited as `benefit_formula_version.create`.
 */
export async function insertFormulaVersion(
  tx: Tx,
  ctx: WriteContext,
  formula: Pick<BenefitFormulaRow, "id" | "transformation_id">,
  versionNo: number,
  body: BenefitFormulaVersionCreate,
  checked: CheckedFormula,
): Promise<BenefitFormulaVersionRow> {
  const preview = evaluateAst(checked);
  const id = uuidv7();
  const row = await tx
    .insertInto("benefit_formula_version")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: formula.transformation_id,
      formula_id: formula.id,
      version_no: versionNo,
      expression: body.expression,
      expression_sha256: expressionSha256(body.expression),
      result_kind: checked.resultType.kind,
      result_unit: checked.resultType.unit,
      result_currency: checked.resultType.currency,
      result_period: checked.resultType.period,
      preview_result: preview.rounding.stored,
      engine_version: ENGINE_VERSION,
      change_note: body.changeNote ?? null,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  if (body.variables.length > 0)
    await tx
      .insertInto("benefit_formula_variable")
      .values(
        body.variables.map((v, i) => ({
          id: uuidv7(),
          organization_id: ctx.organizationId,
          transformation_id: formula.transformation_id,
          formula_version_id: id,
          ordinal: i + 1,
          name: v.name,
          kind: v.kind,
          unit: v.unit ?? null,
          currency: v.currency ?? null,
          period: v.period,
          value: v.value ?? null,
          description: v.description ?? null,
          source: v.source ?? null,
          created_by: ctx.userId,
        })),
      )
      .execute();
  const changes = diffFields({} as BenefitFormulaVersionRow, row, [...FORMULA_VERSION_AUDIT_FIELDS]) ?? {};
  await record(tx, ctx.audit, {
    action: "benefit_formula_version.create",
    recordType: "benefit_formula_version",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId: formula.transformation_id,
    newVersion: 1,
    changes: {
      ...changes,
      variables: {
        from: null,
        to: body.variables.map((v) => ({
          name: v.name,
          kind: v.kind,
          unit: v.unit ?? null,
          currency: v.currency ?? null,
          period: v.period,
          value: v.value ?? null,
          source: v.source ?? null,
        })),
      },
    },
  });
  // T-DG4-BE-L (ADR-0036 §6 item 1, REQ-S04-014): a new version of a formula pinned by an approved G4 snapshot raises
  // and submits one automatic benefit_logic change request in this transaction; the response is unchanged.
  if (versionNo > 1) {
    const port = materialChangePort();
    if (port === null) throw problems.internal();
    await port.benefitFormulaVersionCreated(tx, {
      organizationId: ctx.organizationId,
      transformationId: formula.transformation_id,
      benefitFormulaId: formula.id,
      benefitFormulaVersionId: id,
      versionNo,
      editorUserId: ctx.userId,
      requestId: ctx.audit.requestId,
      changeNote: body.changeNote ?? null,
    });
  }
  return row;
}

/**
 * Points the T09 row at a new current version (version + 1, audited). A row instantiated from an example stops being
 * illustrative once it gets a version of its own (`keepIllustrative` only for the instantiation itself).
 */
export async function setCurrentVersion(
  tx: Tx,
  ctx: WriteContext,
  current: BenefitFormulaRow,
  versionNo: number,
  keepIllustrative: boolean,
): Promise<BenefitFormulaRow> {
  const updated = await tx
    .updateTable("benefit_formula")
    .set({
      current_version_no: versionNo,
      ...(keepIllustrative ? {} : { is_illustrative: false }),
      ...bumpStamps(ctx.userId),
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "benefit_formula.version_set",
    recordType: "benefit_formula",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId: current.transformation_id,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diffFields(current, updated, [...BENEFIT_FORMULA_AUDIT_FIELDS]),
  });
  return updated;
}

// ------------------------------------------------------------------------------------------------ examples

/** Source of every variable instantiated from a B0087 example. */
export const EXAMPLE_SOURCE = "B0087 example (illustrative calculation, synthetic values)";

/** The two seeded B0087 examples with their variables, in ordinal order (REQ-PB-057). */
export async function loadExamples(db: DbOrTx): Promise<BenefitFormulaExample[]> {
  const rows = await db.selectFrom("benefit_formula_example").selectAll().orderBy("ordinal").execute();
  if (rows.length === 0) return [];
  const vars = await db
    .selectFrom("benefit_formula_example_variable")
    .selectAll()
    .where(
      "example_id",
      "in",
      rows.map((r) => r.id),
    )
    .orderBy("ordinal")
    .execute();
  return rows.map((r) => ({
    code: r.code as BenefitFormulaExample["code"],
    ordinal: r.ordinal,
    sourceBenefitEn: r.source_benefit_en,
    sourceBaselineDriverEn: r.source_baseline_driver_en,
    sourceChangeAssumptionEn: r.source_change_assumption_en,
    sourceFormulaEn: r.source_formula_en,
    sourceRampEn: r.source_ramp_en,
    sourceConfidence: r.source_confidence.trim() as BenefitFormulaExample["sourceConfidence"],
    benefitAr: r.benefit_ar,
    baselineDriverAr: r.baseline_driver_ar,
    changeAssumptionAr: r.change_assumption_ar,
    formulaAr: r.formula_ar,
    expression: r.expression,
    variables: vars
      .filter((v) => v.example_id === r.id)
      .map((v) => ({
        name: v.name,
        kind: v.kind as FormulaVariableView["kind"],
        unit: v.unit,
        currency: v.currency === null ? null : v.currency.trim(),
        period: v.period as FormulaVariableView["period"],
        value: canonicalDecimal(v.example_value),
        description: v.label_en,
        source: EXAMPLE_SOURCE,
      })),
    resultKind: r.result_kind as BenefitFormulaExample["resultKind"],
    resultCurrency: r.result_currency === null ? null : r.result_currency.trim(),
    resultPeriod: r.result_period as BenefitFormulaExample["resultPeriod"],
    exampleResult: canonicalDecimal(r.example_result),
    isIllustrative: true,
    sourceRef: r.source_ref,
  }));
}

// ------------------------------------------------------------------------------------------------ create

const createScope = z.looseObject({ transformationId: z.uuid() });

async function createFormula(tx: Tx, ctx: WriteContext, request: FastifyRequest) {
  const body = parseBody(benefitFormulaCreate, request.body);
  if (body.fromExample !== undefined && body.initialVersion !== undefined)
    throw formulaRule(
      "benefit_formula.example_and_version",
      "Give either fromExample or initialVersion, not both.",
      "/initialVersion",
    );
  // The version is parsed and type-checked before anything is written (an invalid expression writes nothing).
  let version: BenefitFormulaVersionCreate | null = null;
  let example: BenefitFormulaExample | null = null;
  if (body.initialVersion !== undefined) version = body.initialVersion;
  if (body.fromExample !== undefined) {
    example = (await loadExamples(tx)).find((e) => e.code === body.fromExample) ?? null;
    if (example === null) throw problems.notFound();
    version = {
      expression: example.expression,
      variables: example.variables,
      changeNote: `Instantiated from the B0087 example ${example.code} (illustrative calculation, synthetic values).`,
    };
  }
  const checked = version === null ? null : checkWithEngine(version, body.initialVersion ? "/initialVersion" : "");
  await requireActiveUsers(tx, ctx.organizationId, [["ownerUserId", body.ownerUserId]]);
  const id = uuidv7();
  const row = await tx
    .insertInto("benefit_formula")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: ctx.transformationId,
      code: await nextFormulaCode(tx, ctx.transformationId),
      benefit_name: body.benefitName,
      baseline_driver: body.baselineDriver ?? example?.sourceBaselineDriverEn ?? null,
      change_assumption: body.changeAssumption ?? example?.sourceChangeAssumptionEn ?? null,
      ramp: body.ramp ?? example?.sourceRampEn ?? null,
      confidence: body.confidence ?? example?.sourceConfidence ?? null,
      owner_user_id: body.ownerUserId ?? null,
      is_illustrative: example !== null,
      example_code: example?.code ?? null,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "benefit_formula.create",
    recordType: "benefit_formula",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    newVersion: 1,
    changes: diffFields({} as BenefitFormulaRow, row, [...BENEFIT_FORMULA_AUDIT_FIELDS]),
  });
  if (version === null || checked === null) return row;
  // The T09 row and its version reference each other (non-deferrable FKs), so the row is written first at version 1
  // and then pointed at its version 1 (row version 2), both in this transaction and both audited.
  await insertFormulaVersion(tx, ctx, row, 1, version, checked.checked);
  return setCurrentVersion(tx, ctx, row, 1, example !== null);
}

// ------------------------------------------------------------------------------------------------ update / archive

async function updateFormula(tx: Tx, request: FastifyRequest, id: string) {
  const transformationId = await formulaTransformation(tx, id);
  const ctx = await openWrite(tx, request, transformationId, [{ permission: FORMULA_EDIT }], null, {
    atCommit: true,
  });
  const expected = requireIfMatch(request);
  const body = parseBody(benefitFormulaUpdate, request.body);
  const current = await lockFormula(tx, transformationId, id, "update");
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status === "archived") throw archivedFormula();
  await requireActiveUsers(tx, ctx.organizationId, [["ownerUserId", body.ownerUserId]]);
  const updated = await tx
    .updateTable("benefit_formula")
    .set({
      ...(body.benefitName !== undefined ? { benefit_name: body.benefitName } : {}),
      ...(body.baselineDriver !== undefined ? { baseline_driver: body.baselineDriver } : {}),
      ...(body.changeAssumption !== undefined ? { change_assumption: body.changeAssumption } : {}),
      ...(body.ramp !== undefined ? { ramp: body.ramp } : {}),
      ...(body.confidence !== undefined ? { confidence: body.confidence } : {}),
      ...(body.ownerUserId !== undefined ? { owner_user_id: body.ownerUserId } : {}),
      // An instantiated example is illustrative only until it is edited (ADR-0024 §6).
      is_illustrative: false,
      ...bumpStamps(ctx.userId),
    })
    .where("id", "=", id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "benefit_formula.update",
    recordType: "benefit_formula",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diffFields(current, updated, [...BENEFIT_FORMULA_AUDIT_FIELDS]),
  });
  return updated;
}

async function archiveFormula(tx: Tx, request: FastifyRequest, id: string) {
  const transformationId = await formulaTransformation(tx, id);
  const ctx = await openWrite(tx, request, transformationId, [{ permission: FORMULA_EDIT }], null, {
    atCommit: true,
  });
  const expected = requireIfMatch(request);
  const { reason } = parseBody(reasonRequest, request.body);
  const current = await lockFormula(tx, transformationId, id, "update");
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status === "archived")
    throw problems.businessRule("benefit_formula.already_archived", "The benefit formula is already archived.");
  const linked = await tx
    .selectFrom("business_case_line")
    .select("id")
    .where("benefit_formula_id", "=", id)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (linked)
    throw problems.businessRule(
      "benefit_formula.in_use",
      "This benefit formula backs an active business case line; archive the line or unlink the formula first.",
    );
  const updated = await tx
    .updateTable("benefit_formula")
    .set({
      status: "archived",
      archived_at: sql<Date>`now()`,
      archived_by: ctx.userId,
      archive_reason: reason,
      ...bumpStamps(ctx.userId),
    })
    .where("id", "=", id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "benefit_formula.archive",
    recordType: "benefit_formula",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    reason,
    changes: diffFields(current, updated, [...BENEFIT_FORMULA_AUDIT_FIELDS]),
  });
  return updated;
}

// ------------------------------------------------------------------------------------------------ routes

const listQuery = benefitFormulaListQuery.extend({ cursor: cursorSchema, limit: limitSchema });

export function registerBenefitFormulaRoutes(app: FastifyInstance, { db }: ModuleDeps): readonly string[] {
  const read = { access: { permission: "transformation.read" as const } };
  const write = { access: { permission: FORMULA_EDIT }, consumes: JSON_BODY };

  // The examples are a methodology catalogue (no transformation): any signed-in user reads them.
  app.get(BENEFIT_FORMULA_EXAMPLES, { config: { access: { permission: "authenticated" } } }, async () => {
    return { items: await loadExamples(db) };
  });

  app.get(BENEFIT_FORMULAS, { config: read }, async (request) => {
    const query = parseQuery(listQuery, request.query);
    await requireTransformationRead(db, principalOf(request), query.transformationId);
    const hash = filterHash({
      table: "benefit_formula",
      transformationId: query.transformationId,
      includeArchived: query.includeArchived,
    });
    const after = decodeCursor(query.cursor, hash, 2);
    let q = db.selectFrom("benefit_formula").selectAll().where("transformation_id", "=", query.transformationId);
    if (!query.includeArchived) q = q.where("status", "<>", "archived");
    if (after)
      q = q.where((eb) =>
        eb.or([
          eb("created_at", "<", new Date(String(after[0]))),
          eb.and([eb("created_at", "=", new Date(String(after[0]))), eb("id", "<", String(after[1]))]),
        ]),
      );
    const rows = await q
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.created_at.toISOString(), r.id], hash);
    return { items: await presentFormulas(db, page.items), nextCursor: page.nextCursor };
  });

  app.post(BENEFIT_FORMULAS, { config: write }, async (request, reply) => {
    // The scope comes from the body. Without a readable transformationId the request is malformed (400), unless the
    // caller holds benefit_formula.edit nowhere: then it is 403 whatever the body (a read-only auditor never gets 400).
    const scope = createScope.safeParse(request.body);
    if (!scope.success) {
      if (!holdsAnywhere(principalOf(request), FORMULA_EDIT)) throw problems.forbidden();
      parseBody(benefitFormulaCreate, request.body);
      throw problems.badRequest("validation", "transformationId is required.", "/transformationId");
    }
    const transformationId = scope.data.transformationId;
    const result = await db.transaction().execute(async (tx) => {
      // Authorised (again at commit time) before any Idempotency-Key replay lookup.
      const ctx = await openWrite(tx, request, transformationId, [{ permission: FORMULA_EDIT }], null, {
        atCommit: true,
      });
      return maybeIdempotent(tx, request, ctx.userId, request.body, async () => ({
        status: 201,
        body: await presentFormula(tx, await createFormula(tx, ctx, request)),
      }));
    });
    return sendCreated(request, reply, result, BENEFIT_FORMULAS);
  });

  app.get(FORMULA_ITEM, { config: read }, async (request, reply) => {
    const row = await readFormula(db, request, parseFormulaId(request.params));
    return sendVersioned(reply, 200, await presentFormula(db, row));
  });

  app.patch(FORMULA_ITEM, { config: write }, async (request, reply) => {
    const id = parseFormulaId(request.params);
    const row = await db.transaction().execute((tx) => updateFormula(tx, request, id));
    return sendVersioned(reply, 200, await presentFormula(db, row));
  });

  app.post(`${FORMULA_ITEM}/archive`, { config: write }, async (request, reply) => {
    const id = parseFormulaId(request.params);
    const row = await db.transaction().execute((tx) => archiveFormula(tx, request, id));
    return sendVersioned(reply, 200, await presentFormula(db, row));
  });

  return [
    `GET ${BENEFIT_FORMULA_EXAMPLES}`,
    `GET ${BENEFIT_FORMULAS}`,
    `POST ${BENEFIT_FORMULAS}`,
    `GET ${FORMULA_ITEM}`,
    `PATCH ${FORMULA_ITEM}`,
    `POST ${FORMULA_ITEM}/archive`,
  ];
}
