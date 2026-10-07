// Business cases (ADR-0024 §1, §3-§5; REQ-PB-053, REQ-PB-054, REQ-PB-055 part, REQ-S05-005; T-DG3-KBE-B):
//   GET  /business-cases?transformationId=…                list (transformation.read), newest first
//   POST /business-cases                                   create (business_case.edit); version 1
//   GET  /business-cases/{id}                              read, with missingSections and the baseline validation state
//   PATCH /business-cases/{id}                             title and sections (business_case.edit; If-Match)
//   POST /business-cases/{id}/archive                      archive with a reason (business_case.edit; If-Match)
//   GET  /business-cases/{id}/totals                       gross / cost / net per currency, roll-up by reference
//   POST /business-cases/{id}/baseline-validation          Finance validation of the baseline (finance.validate)
//
// - The transformation case: exactly one active per transformation, with all ten B0085 sections typed. An initiative
//   case links to exactly that case (parent) and to one initiative, and fills the lighter set (sections 1, 4-7, 9).
// - Roll-up by reference (totals.ts): the transformation case's totals read its own active lines ∪ the active lines
//   of its active initiative cases, as a set of line ids. Nothing is copied, so editing an initiative line changes
//   the roll-up on the next read and is never counted twice.
// - Finance validation of the baseline: by a holder of finance.validate who did not author the case (403
//   finance.validator_is_author; DB CHECK business_case_validator_not_author too). It stores SHA-256 of the baseline
//   section; a later baseline edit makes the state `stale`, which never counts (and is never shown as validated).
// - Permissions: business_case.edit (TL, TO; WL record-level: only the initiative cases of initiatives they lead,
//   ADR-0024 §4); AUD reads only (403 on every mutation, audited as authorization.denied).
// - Every mutation: authorization re-checked at commit time inside the write transaction (openWrite atCommit, the
//   BE18A pattern), zod validation then business rules, If-Match 428/409 (creates are version 1), one audit event.
//   No client or remote I/O happens inside a transaction (the body is parsed before the handler runs).
// Product gates G1-G6 are business approvals inside the product; a Finance validation here is a recorded human
// decision and nothing here touches the engineering gates DG0-DG7.
import { createHash } from "node:crypto";
import { diffFields, sql, type BusinessCaseRow, type DbOrTx, type Tx } from "@mth/db";
import { PROBLEM_TYPES } from "@mth/shared";
import {
  BUSINESS_CASE_SECTION_CODES,
  businessCaseCreate,
  businessCaseListQuery,
  businessCaseUpdate,
  financeValidationRequest,
  INITIATIVE_CASE_SECTION_CODES,
  reasonRequest,
  type BusinessCase,
  type BusinessCaseSectionCode,
  type BusinessCaseSections,
  type BusinessCaseValidationState,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { authorize, denialOf, holdsAnywhere, principalOf, requireTransformationRead } from "../access/index.ts";
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
import { bumpStamps, maybeIdempotent, openWrite, sendCreated, type WriteContext } from "../transformations/index.ts";
import { requireActiveUsers } from "./support.ts";
import { computeTotals, type TotalsLine } from "./totals.ts";

export const BUSINESS_CASES = "/api/v1/business-cases";
export const CASE_ITEM = `${BUSINESS_CASES}/:businessCaseId`;
export const JSON_BODY = ["application/json"] as const;
const EDIT = "business_case.edit" as const;

// ------------------------------------------------------------------------------------------------ problems (ADR texts)

export const rule = (code: string, detail: string, pointer: string) =>
  new HttpProblem({
    status: 422,
    type: PROBLEM_TYPES.validation,
    code,
    title: "Business rule violated",
    detail,
    errors: [{ pointer, code, message: detail }],
  });

export const archivedCase = () =>
  problems.businessRule("business_case.archived", "Archived business cases and their lines are read-only.");

const forbidden = (
  code: string,
  detail: string,
  ctx: WriteContext,
  permission: "business_case.edit" | "finance.validate",
) =>
  new HttpProblem({ status: 403, type: PROBLEM_TYPES.forbidden, code, title: "Forbidden", detail }).withDenial(
    denialOf(permission, ctx.target),
  );

// ------------------------------------------------------------------------------------------------ sections

/** API section key -> column (ADR-0024 §1). Text sections only; owners and the decision ask are handled apart. */
const TEXT_SECTIONS = [
  ["strategicRationale", "strategic_rationale"],
  ["baselineSummary", "baseline_summary"],
  ["valuePoolsSummary", "value_pools_summary"],
  ["interventionsSummary", "interventions_summary"],
  ["investmentSummary", "investment_summary"],
  ["benefitsSummary", "benefits_summary"],
  ["benefitRamp", "benefit_ramp"],
  ["recurrenceSummary", "recurrence_summary"],
  ["implementationHorizon", "implementation_horizon"],
  ["keyAssumptions", "key_assumptions"],
  ["downsideCase", "downside_case"],
  ["upsideCase", "upside_case"],
  ["decisionAskText", "decision_ask_text"],
] as const;
const OWNER_SECTIONS = [
  ["benefitOwnerUserId", "benefit_owner_user_id"],
  ["initiativeOwnerUserId", "initiative_owner_user_id"],
  ["financeValidatorUserId", "finance_validator_user_id"],
] as const;

/** Columns audited on a business case (every section, title, status and the validation decision). */
export const BUSINESS_CASE_AUDIT_FIELDS = [
  "title",
  "currency",
  ...TEXT_SECTIONS.map(([, c]) => c),
  ...OWNER_SECTIONS.map(([, c]) => c),
  "decision_ask_types",
  "baseline_validation_status",
  "baseline_validated_by",
  "baseline_validated_sha256",
  "baseline_validation_note",
  "status",
  "archive_reason",
] as const satisfies readonly (keyof BusinessCaseRow & string)[];

/** Columns to write from a (partial) sections object; absent keys are left alone, null clears. */
function sectionValues(sections: BusinessCaseSections | undefined): Record<string, unknown> {
  if (sections === undefined) return {};
  const given = new Map(Object.entries(sections));
  const out = new Map<string, unknown>();
  for (const [key, column] of [...TEXT_SECTIONS, ...OWNER_SECTIONS])
    if (given.has(key) && given.get(key) !== undefined) out.set(column, given.get(key));
  if (sections.decisionAskTypes !== undefined) out.set("decision_ask_types", [...sections.decisionAskTypes]);
  return Object.fromEntries(out);
}

const hasText = (v: string | null): boolean => v !== null && v.trim().length > 0;

/** Active line counts of a case by kind (the roll-up set for a transformation case). */
export interface LineCounts {
  readonly investment: number;
  readonly benefit: number;
}

/**
 * Sections still missing for the case's level (ADR-0024 §1): text sections non-blank; investment and benefits also need
 * ≥ 1 active line of that kind (for the transformation case, counted over its roll-up set); ownership needs all three
 * owners (initiative case: initiative owner and finance validator); the decision ask needs ≥ 1 ask type. Pure; KBE-C's
 * G4 fact loader reuses it.
 */
export function missingSections(c: BusinessCaseRow, lines: LineCounts): BusinessCaseSectionCode[] {
  const complete = new Map<BusinessCaseSectionCode, boolean>([
    ["strategic_rationale", hasText(c.strategic_rationale)],
    ["baseline", hasText(c.baseline_summary)],
    ["value_pools", hasText(c.value_pools_summary)],
    ["interventions", hasText(c.interventions_summary)],
    ["investment", hasText(c.investment_summary) && lines.investment > 0],
    ["benefits", hasText(c.benefits_summary) && lines.benefit > 0],
    ["timing", hasText(c.benefit_ramp) && hasText(c.recurrence_summary) && hasText(c.implementation_horizon)],
    ["risks", hasText(c.key_assumptions) && hasText(c.downside_case) && hasText(c.upside_case)],
    [
      "ownership",
      c.level === "initiative"
        ? c.initiative_owner_user_id !== null && c.finance_validator_user_id !== null
        : c.benefit_owner_user_id !== null &&
          c.initiative_owner_user_id !== null &&
          c.finance_validator_user_id !== null,
    ],
    ["decision_ask", c.decision_ask_types.length > 0],
  ]);
  const required = c.level === "initiative" ? INITIATIVE_CASE_SECTION_CODES : BUSINESS_CASE_SECTION_CODES;
  return required.filter((code) => complete.get(code) !== true);
}

/** SHA-256 (hex) of the baseline section as stored: what a Finance validation is bound to. */
export function baselineSha256(baselineSummary: string | null): string {
  return createHash("sha256")
    .update(baselineSummary ?? "", "utf8")
    .digest("hex");
}

/**
 * The baseline validation state as everyone must read it (ADR-0024 §5): `validated` only while the stored hash equals
 * the current baseline's hash; a changed baseline is `stale` (never counts, never shown as validated).
 */
export function baselineValidationState(
  c: Pick<BusinessCaseRow, "baseline_validation_status" | "baseline_validated_sha256" | "baseline_summary">,
): BusinessCaseValidationState {
  if (c.baseline_validation_status === "rejected") return "rejected";
  if (c.baseline_validation_status !== "validated" || c.baseline_validated_sha256 === null) return "unvalidated";
  return baselineSha256(c.baseline_summary) === c.baseline_validated_sha256 ? "validated" : "stale";
}

export function toBusinessCase(c: BusinessCaseRow, lines: LineCounts): BusinessCase {
  return {
    id: c.id,
    organizationId: c.organization_id,
    transformationId: c.transformation_id,
    code: c.code,
    level: c.level as BusinessCase["level"],
    initiativeId: c.initiative_id,
    parentCaseId: c.parent_case_id,
    title: c.title,
    currency: c.currency,
    sections: {
      strategicRationale: c.strategic_rationale,
      baselineSummary: c.baseline_summary,
      valuePoolsSummary: c.value_pools_summary,
      interventionsSummary: c.interventions_summary,
      investmentSummary: c.investment_summary,
      benefitsSummary: c.benefits_summary,
      benefitRamp: c.benefit_ramp,
      recurrenceSummary: c.recurrence_summary,
      implementationHorizon: c.implementation_horizon,
      keyAssumptions: c.key_assumptions,
      downsideCase: c.downside_case,
      upsideCase: c.upside_case,
      benefitOwnerUserId: c.benefit_owner_user_id,
      initiativeOwnerUserId: c.initiative_owner_user_id,
      financeValidatorUserId: c.finance_validator_user_id,
      decisionAskTypes: [...c.decision_ask_types] as BusinessCase["sections"]["decisionAskTypes"],
      decisionAskText: c.decision_ask_text,
    },
    missingSections: missingSections(c, lines),
    baselineValidation: baselineValidationState(c),
    baselineValidatedBy: c.baseline_validated_by,
    baselineValidatedAt: isoOrNull(c.baseline_validated_at),
    baselineValidationNote: c.baseline_validation_note,
    status: c.status as BusinessCase["status"],
    archivedAt: isoOrNull(c.archived_at),
    archivedBy: c.archived_by,
    archiveReason: c.archive_reason,
    version: c.version,
    createdAt: iso(c.created_at),
    createdBy: c.created_by,
    updatedAt: iso(c.updated_at),
    updatedBy: c.updated_by,
  };
}

/** Active initiative cases that roll up into each given transformation case: parent id -> child ids. */
async function childrenOf(db: DbOrTx, parentIds: readonly string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (parentIds.length === 0) return out;
  const rows = await db
    .selectFrom("business_case")
    .select(["id", "parent_case_id"])
    .where("parent_case_id", "in", [...parentIds])
    .where("level", "=", "initiative")
    .where("status", "<>", "archived")
    .orderBy("code")
    .execute();
  for (const r of rows) out.set(r.parent_case_id!, [...(out.get(r.parent_case_id!) ?? []), r.id]);
  return out;
}

/** The case ids whose lines a case's totals include: itself, then (transformation case) its active initiative cases. */
export async function includedCaseIds(db: DbOrTx, c: BusinessCaseRow): Promise<string[]> {
  if (c.level !== "transformation") return [c.id];
  return [c.id, ...((await childrenOf(db, [c.id])).get(c.id) ?? [])];
}

/** API representations of cases, with their roll-up line counts for missingSections. */
export async function presentCases(db: DbOrTx, rows: readonly BusinessCaseRow[]): Promise<BusinessCase[]> {
  if (rows.length === 0) return [];
  const children = await childrenOf(
    db,
    rows.filter((r) => r.level === "transformation").map((r) => r.id),
  );
  const ids = [...new Set([...rows.map((r) => r.id), ...[...children.values()].flat()])];
  const counts = await db
    .selectFrom("business_case_line")
    .select(["business_case_id", "line_kind", sql<string>`count(*)::text`.as("n")])
    .where("business_case_id", "in", ids)
    .where("status", "=", "active")
    .groupBy(["business_case_id", "line_kind"])
    .execute();
  const countOf = (caseIds: readonly string[], kind: string) =>
    counts
      .filter((c) => c.line_kind === kind && caseIds.includes(c.business_case_id))
      .reduce((s, c) => s + Number.parseInt(c.n, 10), 0);
  return rows.map((r) => {
    const set = [r.id, ...(children.get(r.id) ?? [])];
    return toBusinessCase(r, { investment: countOf(set, "investment"), benefit: countOf(set, "benefit") });
  });
}

export async function presentCase(db: DbOrTx, row: BusinessCaseRow): Promise<BusinessCase> {
  return (await presentCases(db, [row]))[0]!;
}

// ------------------------------------------------------------------------------------------------ access helpers

const caseParams = z.strictObject({ businessCaseId: z.uuid() });

export function parseCaseId(params: unknown): string {
  return parse(caseParams, params, "params").businessCaseId;
}

/** The case for a read: 404 when it does not exist or the caller cannot read its transformation. */
export async function readCase(db: DbOrTx, request: FastifyRequest, id: string): Promise<BusinessCaseRow> {
  const row = await db.selectFrom("business_case").selectAll().where("id", "=", id).executeTakeFirst();
  if (!row) throw problems.notFound();
  await requireTransformationRead(db, principalOf(request), row.transformation_id);
  return row;
}

/** The transformation a case belongs to (no lock; 404 when the case does not exist). */
export async function caseTransformation(db: DbOrTx, id: string): Promise<string> {
  const row = await db.selectFrom("business_case").select("transformation_id").where("id", "=", id).executeTakeFirst();
  if (!row) throw problems.notFound();
  return row.transformation_id;
}

/** Locks the case row for a change (FOR UPDATE) or for a line change (FOR SHARE). */
export async function lockCase(tx: Tx, transformationId: string, id: string, mode: "update" | "share") {
  let q = tx
    .selectFrom("business_case")
    .selectAll()
    .where("id", "=", id)
    .where("transformation_id", "=", transformationId);
  q = mode === "update" ? q.forUpdate() : q.forShare();
  const row = await q.executeTakeFirst();
  if (!row) throw problems.notFound();
  return row;
}

/**
 * Record-level edit right (ADR-0024 §4): business_case.edit through any role other than WL edits every case of the
 * transformation; held ONLY through WL, it covers the initiative cases of initiatives the caller leads
 * (`initiative.workstream_lead_user_id`). Otherwise 403 `business_case.not_initiative_lead`, audited as a denial.
 */
export async function requireCaseEdit(
  tx: Tx,
  ctx: WriteContext,
  target: { level: string; initiativeId: string | null },
): Promise<void> {
  const d = await authorize(tx, ctx.principal, EDIT, ctx.target);
  const via = new Set(d.viaAssignmentIds);
  if (ctx.principal.grants.some((g) => via.has(g.assignmentId) && g.roleCode !== "WL")) return;
  if (target.level === "initiative" && target.initiativeId !== null) {
    const ini = await tx
      .selectFrom("initiative")
      .select("workstream_lead_user_id")
      .where("id", "=", target.initiativeId)
      .where("transformation_id", "=", ctx.transformationId)
      .executeTakeFirst();
    if (ini?.workstream_lead_user_id === ctx.userId) return;
  }
  throw forbidden(
    "business_case.not_initiative_lead",
    "A Workstream Lead edits only the business cases of initiatives they lead.",
    ctx,
    EDIT,
  );
}

/** Per-transformation BC-01 code (the record_code_counter UPSERT serialises concurrent creates). */
async function nextCaseCode(tx: Tx, transformationId: string): Promise<string> {
  const row = await sql<{ last_value: number }>`
    INSERT INTO record_code_counter (transformation_id, prefix, last_value) VALUES (${transformationId}::uuid, 'BC', 1)
    ON CONFLICT (transformation_id, prefix) DO UPDATE SET last_value = record_code_counter.last_value + 1
    RETURNING last_value`.execute(tx);
  return `BC-${String(row.rows[0]!.last_value).padStart(2, "0")}`;
}

const activeTransformationCase = (tx: DbOrTx, transformationId: string) =>
  tx
    .selectFrom("business_case")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .where("level", "=", "transformation")
    .where("status", "<>", "archived")
    .executeTakeFirst();

async function requireSectionUsers(tx: Tx, organizationId: string, sections: BusinessCaseSections | undefined) {
  if (sections === undefined) return;
  await requireActiveUsers(tx, organizationId, [
    ["sections/benefitOwnerUserId", sections.benefitOwnerUserId],
    ["sections/initiativeOwnerUserId", sections.initiativeOwnerUserId],
    ["sections/financeValidatorUserId", sections.financeValidatorUserId],
  ]);
}

// ------------------------------------------------------------------------------------------------ create

const createScope = z.looseObject({ transformationId: z.uuid() });

async function createCase(tx: Tx, ctx: WriteContext, request: FastifyRequest) {
  const transformationId = ctx.transformationId;
  const body = parseBody(businessCaseCreate, request.body);
  const t = await tx
    .selectFrom("transformation")
    .select(["currency"])
    .where("id", "=", transformationId)
    .executeTakeFirstOrThrow();
  let parentCaseId: string | null = null;
  if (body.level === "transformation") {
    if (body.initiativeId !== undefined)
      throw rule(
        "business_case.initiative_not_allowed",
        "A transformation-level business case is not linked to an initiative.",
        "/initiativeId",
      );
    await requireCaseEdit(tx, ctx, { level: "transformation", initiativeId: null });
    if (await activeTransformationCase(tx, transformationId))
      throw problems.duplicate(
        "business_case.transformation_case_exists",
        "This transformation already has an active transformation-level business case.",
      );
  } else {
    if (body.initiativeId === undefined)
      throw rule(
        "business_case.initiative_required",
        "An initiative business case names its initiative.",
        "/initiativeId",
      );
    const ini = await tx
      .selectFrom("initiative")
      .select("id")
      .where("id", "=", body.initiativeId)
      .where("transformation_id", "=", transformationId)
      .executeTakeFirst();
    if (!ini)
      throw rule(
        "validation.reference",
        "The referenced record does not exist in this transformation.",
        "/initiativeId",
      );
    await requireCaseEdit(tx, ctx, { level: "initiative", initiativeId: body.initiativeId });
    const parent = await activeTransformationCase(tx, transformationId);
    if (!parent)
      throw rule(
        "business_case.transformation_case_required",
        "Create the transformation-level business case first; an initiative case links to it.",
        "/level",
      );
    parentCaseId = parent.id;
    const existing = await tx
      .selectFrom("business_case")
      .select("id")
      .where("initiative_id", "=", body.initiativeId)
      .where("level", "=", "initiative")
      .where("status", "<>", "archived")
      .executeTakeFirst();
    if (existing)
      throw problems.duplicate(
        "business_case.initiative_case_exists",
        "This initiative already has an active business case.",
      );
  }
  await requireSectionUsers(tx, ctx.organizationId, body.sections);
  const id = uuidv7();
  const row = await tx
    .insertInto("business_case")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      code: await nextCaseCode(tx, transformationId),
      level: body.level,
      initiative_id: body.initiativeId ?? null,
      parent_case_id: parentCaseId,
      title: body.title,
      currency: body.currency ?? t.currency,
      ...sectionValues(body.sections),
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "business_case.create",
    recordType: "business_case",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    newVersion: 1,
    changes: diffFields({} as BusinessCaseRow, row, [...BUSINESS_CASE_AUDIT_FIELDS, "level", "initiative_id"]),
  });
  return row;
}

// ------------------------------------------------------------------------------------------------ update / archive

async function updateCase(tx: Tx, request: FastifyRequest, id: string) {
  const transformationId = await caseTransformation(tx, id);
  const ctx = await openWrite(tx, request, transformationId, [{ permission: EDIT }], null, { atCommit: true });
  const expected = requireIfMatch(request);
  const body = parseBody(businessCaseUpdate, request.body);
  const current = await lockCase(tx, transformationId, id, "update");
  if (current.version !== expected) throw problems.versionConflict(current.version);
  await requireCaseEdit(tx, ctx, { level: current.level, initiativeId: current.initiative_id });
  if (current.status === "archived") throw archivedCase();
  await requireSectionUsers(tx, ctx.organizationId, body.sections);
  const updated = await tx
    .updateTable("business_case")
    .set({
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...sectionValues(body.sections),
      ...bumpStamps(ctx.userId),
    })
    .where("id", "=", id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "business_case.update",
    recordType: "business_case",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diffFields(current, updated, [...BUSINESS_CASE_AUDIT_FIELDS]),
  });
  return updated;
}

async function archiveCase(tx: Tx, request: FastifyRequest, id: string) {
  const transformationId = await caseTransformation(tx, id);
  const ctx = await openWrite(tx, request, transformationId, [{ permission: EDIT }], null, { atCommit: true });
  const expected = requireIfMatch(request);
  const { reason } = parseBody(reasonRequest, request.body);
  const current = await lockCase(tx, transformationId, id, "update");
  if (current.version !== expected) throw problems.versionConflict(current.version);
  await requireCaseEdit(tx, ctx, { level: current.level, initiativeId: current.initiative_id });
  if (current.status === "archived")
    throw problems.businessRule("business_case.already_archived", "The business case is already archived.");
  if (current.level === "transformation" && ((await childrenOf(tx, [id])).get(id)?.length ?? 0) > 0)
    throw problems.businessRule(
      "business_case.has_initiative_cases",
      "Archive the initiative business cases linked to this transformation case first.",
    );
  const updated = await tx
    .updateTable("business_case")
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
    action: "business_case.archive",
    recordType: "business_case",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    reason,
    changes: diffFields(current, updated, [...BUSINESS_CASE_AUDIT_FIELDS]),
  });
  return updated;
}

// ------------------------------------------------------------------------------------------------ baseline validation

async function validateBaseline(tx: Tx, request: FastifyRequest, id: string) {
  const transformationId = await caseTransformation(tx, id);
  const ctx = await openWrite(tx, request, transformationId, [{ permission: "finance.validate" }], null, {
    atCommit: true,
  });
  const expected = requireIfMatch(request);
  const decision = parseBody(financeValidationRequest, request.body);
  const current = await lockCase(tx, transformationId, id, "update");
  // Separation of duties (ADR-0024 §5; DB CHECK business_case_validator_not_author): never the case's author.
  if (current.created_by === ctx.userId)
    throw forbidden(
      "finance.validator_is_author",
      "Finance validation is done by someone other than the record's author (separation of duties).",
      ctx,
      "finance.validate",
    );
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status === "archived") throw archivedCase();
  if (!hasText(current.baseline_summary))
    throw problems.businessRule(
      "business_case.baseline_missing",
      "The baseline section is empty; there is no baseline to validate.",
    );
  const updated = await tx
    .updateTable("business_case")
    .set({
      baseline_validation_status: decision.result,
      baseline_validated_by: ctx.userId,
      baseline_validated_at: sql<Date>`now()`,
      baseline_validation_note: decision.note,
      baseline_validated_sha256: decision.result === "validated" ? baselineSha256(current.baseline_summary) : null,
      ...bumpStamps(ctx.userId),
    })
    .where("id", "=", id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: decision.result === "validated" ? "business_case.baseline_validate" : "business_case.baseline_reject",
    recordType: "business_case",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    reason: decision.note,
    changes: diffFields(current, updated, [...BUSINESS_CASE_AUDIT_FIELDS]),
  });
  return updated;
}

// ------------------------------------------------------------------------------------------------ totals

/** Totals of one case (ADR-0024 §3), by reference over its included cases' active lines. */
export async function loadCaseTotals(db: DbOrTx, c: BusinessCaseRow) {
  const included = await includedCaseIds(db, c);
  const rows = await db
    .selectFrom("business_case_line")
    .selectAll()
    .where("business_case_id", "in", included)
    .where("status", "=", "active")
    .orderBy("id")
    .execute();
  const lines: TotalsLine[] = rows.map((l) => ({
    id: l.id,
    businessCaseId: l.business_case_id,
    lineKind: l.line_kind as TotalsLine["lineKind"],
    class: (l.investment_class ?? l.benefit_class) as TotalsLine["class"],
    valueBasis: l.value_basis as TotalsLine["valueBasis"],
    title: l.title,
    amount: l.amount,
    currency: l.currency,
    periodStart: l.period_start === null ? null : String(l.period_start).slice(0, 10),
    periodEnd: l.period_end === null ? null : String(l.period_end).slice(0, 10),
  }));
  return computeTotals({
    businessCaseId: c.id,
    includedCaseIds: included,
    transformationCaseId: c.level === "transformation" ? c.id : null,
    lines,
  });
}

// ------------------------------------------------------------------------------------------------ routes

const listQuery = businessCaseListQuery.extend({ cursor: cursorSchema, limit: limitSchema });

export function registerBusinessCaseRoutes(app: FastifyInstance, { db }: ModuleDeps): readonly string[] {
  const read = { access: { permission: "transformation.read" as const } };
  const write = { access: { permission: EDIT }, consumes: JSON_BODY };

  app.get(BUSINESS_CASES, { config: read }, async (request) => {
    const query = parseQuery(listQuery, request.query);
    await requireTransformationRead(db, principalOf(request), query.transformationId);
    const hash = filterHash({
      table: "business_case",
      transformationId: query.transformationId,
      level: query.level ?? null,
      includeArchived: query.includeArchived,
    });
    const after = decodeCursor(query.cursor, hash, 2);
    let q = db.selectFrom("business_case").selectAll().where("transformation_id", "=", query.transformationId);
    if (query.level !== undefined) q = q.where("level", "=", query.level);
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
    return { items: await presentCases(db, page.items), nextCursor: page.nextCursor };
  });

  app.post(BUSINESS_CASES, { config: write }, async (request, reply) => {
    // The scope comes from the body. Without a readable transformationId the request is malformed (400), unless the
    // caller holds business_case.edit nowhere: then it is 403 whatever the body (a read-only auditor never gets 400).
    const scope = createScope.safeParse(request.body);
    if (!scope.success) {
      if (!holdsAnywhere(principalOf(request), EDIT)) throw problems.forbidden();
      parseBody(businessCaseCreate, request.body);
      throw problems.badRequest("validation", "transformationId is required.", "/transformationId");
    }
    const transformationId = scope.data.transformationId;
    const result = await db.transaction().execute(async (tx) => {
      // Authorised (again at commit time) before any Idempotency-Key replay lookup, so a replay never outlives a
      // revoked grant.
      const ctx = await openWrite(tx, request, transformationId, [{ permission: EDIT }], null, { atCommit: true });
      return maybeIdempotent(tx, request, ctx.userId, request.body, async () => ({
        status: 201,
        body: await presentCase(tx, await createCase(tx, ctx, request)),
      }));
    });
    return sendCreated(request, reply, result, BUSINESS_CASES);
  });

  app.get(CASE_ITEM, { config: read }, async (request, reply) => {
    const row = await readCase(db, request, parseCaseId(request.params));
    return sendVersioned(reply, 200, await presentCase(db, row));
  });

  app.patch(CASE_ITEM, { config: write }, async (request, reply) => {
    const id = parseCaseId(request.params);
    const row = await db.transaction().execute((tx) => updateCase(tx, request, id));
    return sendVersioned(reply, 200, await presentCase(db, row));
  });

  app.post(`${CASE_ITEM}/archive`, { config: write }, async (request, reply) => {
    const id = parseCaseId(request.params);
    const row = await db.transaction().execute((tx) => archiveCase(tx, request, id));
    return sendVersioned(reply, 200, await presentCase(db, row));
  });

  app.get(`${CASE_ITEM}/totals`, { config: read }, async (request) => {
    const row = await readCase(db, request, parseCaseId(request.params));
    return loadCaseTotals(db, row);
  });

  app.post(
    `${CASE_ITEM}/baseline-validation`,
    { config: { access: { permission: "finance.validate" }, consumes: JSON_BODY } },
    async (request, reply) => {
      const id = parseCaseId(request.params);
      const row = await db.transaction().execute((tx) => validateBaseline(tx, request, id));
      return sendVersioned(reply, 200, await presentCase(db, row));
    },
  );

  return [
    `GET ${BUSINESS_CASES}`,
    `POST ${BUSINESS_CASES}`,
    `GET ${CASE_ITEM}`,
    `PATCH ${CASE_ITEM}`,
    `POST ${CASE_ITEM}/archive`,
    `GET ${CASE_ITEM}/totals`,
    `POST ${CASE_ITEM}/baseline-validation`,
  ];
}
