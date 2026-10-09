// T09 formula versions and their Finance validation (ADR-0024 §5-§6; REQ-PB-055, REQ-PB-056, REQ-S08-007;
// T-DG3-KBE-C):
//   GET  /benefit-formulas/{id}/versions                          all versions, newest first, with validation state
//   POST /benefit-formulas/{id}/versions                          the next immutable version, made current
//                                                                 (benefit_formula.edit; If-Match = the T09 row's version)
//   GET  /benefit-formulas/{id}/versions/{versionNo}              one version with its typed variables
//   POST /benefit-formulas/{id}/versions/{versionNo}/validation   Finance validation of the benefit logic
//                                                                 (finance.validate; If-Match = the version's version)
//
// - A version is parsed and type-checked by the shared engine (`@mth/shared/calc`) BEFORE anything is written: an
//   invalid expression writes nothing. The schema check is 400; a body the schema admits but the engine refuses is 422
//   with the engine's first error (`formula.undefined_variable` 'Undefined variable: {name}', `formula.period_mismatch`
//   for monthly ARPU x annual customers, ...).
// - Versions are immutable (DB trigger benefit_formula_version_freeze); variables are append-only per version. Each
//   stores expression_sha256, the result kind/unit/currency/period, the preview result (Unknown = null, never 0) and
//   the engine version. A new version starts `unvalidated` and becomes the current one.
// - Finance validation: `validated` or `rejected` with a note, by a holder of finance.validate who did not author the
//   version (403 finance.validator_is_author; DB CHECK benefit_formula_version_validator_not_author too). Final once
//   recorded; a version never goes stale because it never changes.
// A Finance validation here is a recorded human decision inside the product; nothing here grants a real business,
// Finance or IT approval, and nothing touches the engineering gates DG0-DG7.
import { diffFields, sql, type BenefitFormulaVersionRow, type DbOrTx, type Tx } from "@mth/db";
import { PROBLEM_TYPES } from "@mth/shared";
import { benefitFormulaVersionCreate, financeValidationRequest } from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { denialOf, principalOf, requireTransformationRead } from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  HttpProblem,
  parse,
  parseBody,
  problems,
  requireIfMatch,
  sendVersioned,
  type ModuleDeps,
} from "../platform/index.ts";
import { openWrite, type WriteContext } from "../transformations/index.ts";
import {
  archivedFormula,
  checkWithEngine,
  FORMULA_EDIT,
  FORMULA_ITEM,
  FORMULA_VERSION_AUDIT_FIELDS,
  formulaTransformation,
  insertFormulaVersion,
  JSON_BODY,
  lockFormula,
  presentVersions,
  setCurrentVersion,
} from "./benefit-formulas.ts";

export const VERSIONS = `${FORMULA_ITEM}/versions`;
export const VERSION_ITEM = `${VERSIONS}/:versionNo`;

// ------------------------------------------------------------------------------------------------ params and reads

const versionParams = z.strictObject({
  benefitFormulaId: z.uuid(),
  versionNo: z
    .string()
    .regex(/^[1-9][0-9]{0,8}$/, "validation.version_no")
    .transform((v) => Number.parseInt(v, 10)),
});

export function parseVersionParams(params: unknown): { formulaId: string; versionNo: number } {
  const p = parse(versionParams, params, "params");
  return { formulaId: p.benefitFormulaId, versionNo: p.versionNo };
}

/** One version of a formula the caller can read (404 otherwise). */
export async function readVersion(
  db: DbOrTx,
  request: FastifyRequest,
  formulaId: string,
  versionNo: number,
): Promise<BenefitFormulaVersionRow> {
  const transformationId = await formulaTransformation(db, formulaId);
  await requireTransformationRead(db, principalOf(request), transformationId);
  const row = await db
    .selectFrom("benefit_formula_version")
    .selectAll()
    .where("formula_id", "=", formulaId)
    .where("version_no", "=", versionNo)
    .executeTakeFirst();
  if (!row) throw problems.notFound();
  return row;
}

/** Locks one version row (FOR UPDATE: the validation; FOR SHARE: a calculation recorded against it). */
export async function lockVersion(
  tx: Tx,
  transformationId: string,
  formulaId: string,
  versionNo: number,
  mode: "update" | "share",
): Promise<BenefitFormulaVersionRow> {
  let q = tx
    .selectFrom("benefit_formula_version")
    .selectAll()
    .where("formula_id", "=", formulaId)
    .where("version_no", "=", versionNo)
    .where("transformation_id", "=", transformationId);
  q = mode === "update" ? q.forUpdate() : q.forShare();
  const row = await q.executeTakeFirst();
  if (!row) throw problems.notFound();
  return row;
}

// ------------------------------------------------------------------------------------------------ create version

async function createVersion(tx: Tx, request: FastifyRequest, formulaId: string) {
  const transformationId = await formulaTransformation(tx, formulaId);
  const ctx = await openWrite(tx, request, transformationId, [{ permission: FORMULA_EDIT }], null, {
    atCommit: true,
  });
  const expected = requireIfMatch(request);
  const body = parseBody(benefitFormulaVersionCreate, request.body);
  // Parse and type-check before anything is written: an invalid expression writes nothing (422).
  const checked = checkWithEngine(body);
  const current = await lockFormula(tx, transformationId, formulaId, "update");
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status === "archived") throw archivedFormula();
  const versionNo = (current.current_version_no ?? 0) + 1;
  const version = await insertFormulaVersion(tx, ctx, current, versionNo, body, checked.checked);
  await setCurrentVersion(tx, ctx, current, versionNo, false);
  return version;
}

// ------------------------------------------------------------------------------------------------ Finance validation

const forbiddenAuthor = (ctx: WriteContext) =>
  new HttpProblem({
    status: 403,
    type: PROBLEM_TYPES.forbidden,
    code: "finance.validator_is_author",
    title: "Forbidden",
    detail: "Finance validation is done by someone other than the record's author (separation of duties).",
  }).withDenial(denialOf("finance.validate", ctx.target));

async function validateVersion(tx: Tx, request: FastifyRequest, formulaId: string, versionNo: number) {
  const transformationId = await formulaTransformation(tx, formulaId);
  const ctx = await openWrite(tx, request, transformationId, [{ permission: "finance.validate" }], null, {
    atCommit: true,
    technicalAdminRefusal: "finance.validate", // REQ-S10-003 (D-094)
  });
  const expected = requireIfMatch(request);
  const decision = parseBody(financeValidationRequest, request.body);
  const formula = await lockFormula(tx, transformationId, formulaId, "share");
  const current = await lockVersion(tx, transformationId, formulaId, versionNo, "update");
  // Separation of duties (ADR-0024 §5; DB CHECK benefit_formula_version_validator_not_author): never the author.
  if (current.created_by === ctx.userId) throw forbiddenAuthor(ctx);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (formula.status === "archived") throw archivedFormula();
  if (current.validation_status !== "unvalidated")
    throw problems.businessRule(
      "benefit_formula_version.validation_final",
      "The Finance validation of this formula version is final; create a new version to change the benefit logic.",
    );
  const updated = await tx
    .updateTable("benefit_formula_version")
    .set({
      validation_status: decision.result,
      validated_by: ctx.userId,
      validated_at: sql<Date>`now()`,
      validation_note: decision.note,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: decision.result === "validated" ? "benefit_formula_version.validate" : "benefit_formula_version.reject",
    recordType: "benefit_formula_version",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    reason: decision.note,
    changes: diffFields(current, updated, [...FORMULA_VERSION_AUDIT_FIELDS]),
  });
  return updated;
}

// ------------------------------------------------------------------------------------------------ routes

export function registerFormulaVersionRoutes(app: FastifyInstance, { db }: ModuleDeps): readonly string[] {
  const read = { access: { permission: "transformation.read" as const } };

  app.get(VERSIONS, { config: read }, async (request) => {
    const formulaId = parse(z.strictObject({ benefitFormulaId: z.uuid() }), request.params, "params").benefitFormulaId;
    const transformationId = await formulaTransformation(db, formulaId);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const rows = await db
      .selectFrom("benefit_formula_version")
      .selectAll()
      .where("formula_id", "=", formulaId)
      .orderBy("version_no", "desc")
      .execute();
    return { items: await presentVersions(db, rows) };
  });

  app.post(
    VERSIONS,
    { config: { access: { permission: FORMULA_EDIT }, consumes: JSON_BODY } },
    async (request, reply) => {
      const formulaId = parse(
        z.strictObject({ benefitFormulaId: z.uuid() }),
        request.params,
        "params",
      ).benefitFormulaId;
      const row = await db.transaction().execute((tx) => createVersion(tx, request, formulaId));
      const [body] = await presentVersions(db, [row]);
      return sendVersioned(reply, 201, body!, `/api/v1/benefit-formulas/${formulaId}/versions/${row.version_no}`);
    },
  );

  app.get(VERSION_ITEM, { config: read }, async (request, reply) => {
    const { formulaId, versionNo } = parseVersionParams(request.params);
    const row = await readVersion(db, request, formulaId, versionNo);
    const [body] = await presentVersions(db, [row]);
    return sendVersioned(reply, 200, body!);
  });

  app.post(
    `${VERSION_ITEM}/validation`,
    { config: { access: { permission: "finance.validate" }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { formulaId, versionNo } = parseVersionParams(request.params);
      const row = await db.transaction().execute((tx) => validateVersion(tx, request, formulaId, versionNo));
      const [body] = await presentVersions(db, [row]);
      return sendVersioned(reply, 200, body!);
    },
  );

  return [`GET ${VERSIONS}`, `POST ${VERSIONS}`, `GET ${VERSION_ITEM}`, `POST ${VERSION_ITEM}/validation`];
}
