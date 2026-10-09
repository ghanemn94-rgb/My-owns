// KPI dictionary v2 and KPI versions (ADR-0027 §1, §2, §4, §11-§13; REQ-S07-001, REQ-S07-011; T-DG4-KBE-B):
//   GET   /transformations/{t}/kpi-dictionary                                    definitions with their active version
//   GET   /transformations/{t}/kpi-definitions/{k}/dictionary-entry              one entry (REQ-S07-001 "all listed fields")
//   GET   /transformations/{t}/kpi-definitions/{k}/versions                      versions, newest first
//   POST  /transformations/{t}/kpi-definitions/{k}/versions                      a new draft (kpi_version.edit)
//   GET   /transformations/{t}/kpi-versions/{v}
//   PATCH /transformations/{t}/kpi-versions/{v}                                  change a draft (kpi_version.edit; If-Match)
//   POST  /transformations/{t}/kpi-versions/{v}/activate                         (kpi_version.activate; If-Match; no body)
//   POST  /transformations/{t}/kpi-versions/{v}/withdraw                         draft -> withdrawn (kpi_version.edit; If-Match)
//
// - The DG2 kpi_definition keeps identity and descriptive fields; every measurement semantic is on kpi_version. The
//   version copies the definition's unit kind, currency and frequency (fixed once a version exists: trigger
//   kpi_definition_measure_lock, mapped to 422 kpi_definition.measure_locked in platform/db-errors.ts).
// - The aggregation rule is NOT required on create (D-089 Q1); it is required to ACTIVATE (422
//   kpi_version.aggregation_rule_required), so before any P4 use.
// - Activation order (ADR-0027 §2): definition active; version complete (aggregation rule, ratio labels, milestone due
//   date); under definition_approval = business_approval an APPROVED kpi_version_activation approval of this version;
//   no formula cycle. The previous active version is superseded first and the new one activated in the same
//   transaction (one audit event each), and the outbox event kpi.version_activated (key
//   kpi.version_activated:<versionId>:<versionNo>) is written in that transaction.
// - Every mutation: authorization re-checked at commit time (openWrite atCommit), validation, If-Match (428/409; creates
//   are version 1), exactly one audit event per changed row in the same transaction, no remote I/O in it (S-4).
// - POST /transformations/{t}/kpi-versions/{v}/approval-requests (requestKpiVersionApproval; kpi_version.activate;
//   If-Match; T-DG4-KBE-C, D-095): requests the kpi_version_activation BUSINESS approval through BE-B's approval service
//   (workflows/approvals.ts, ADR-0026 §4; S-14). kpi cannot import workflows (workflows depends on kpi), so the service
//   is reached through the KpiApprovalPort that the composition root (server.ts) passes to registerKpiModule, the
//   GateFactsProvider pattern. The port also registers the kpi_version_activation subject provider, whose onOutcome
//   never activates: activation stays the explicit activateKpiVersion call. An agent never grants a business approval:
//   activation under the business-approval policy needs a decision recorded by a person (requester excluded, SoD).
import { diffFields, sql, type ApprovalRow, type DbOrTx, type KpiVersionRow, type Tx } from "@mth/db";
import {
  canonicalDecimal,
  kpiReasonRequest,
  kpiVersionApprovalRequest,
  kpiVersionCreate,
  kpiVersionUpdate,
  type Approval,
  type KpiDictionaryEntry,
  type KpiVersion,
  type KpiVersionCreate,
} from "@mth/shared/schemas";
import { ENGINE_VERSION, FORMULA_DECIMAL as Decimal } from "@mth/shared/calc";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { principalOf, requireTransformationRead, type ResolvedTarget } from "../access/index.ts";
import { record, type AuditContext } from "../audit/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
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
import { maybeIdempotent, openWrite, sendCreated, type WriteContext } from "../transformations/index.ts";
import { enqueueKpiEvent } from "./kpi-outbox.ts";
import { assertNoFormulaCycle, checkKpiFormula, formulaInputsOf, insertFormulaInputs } from "./kpi-formulas.ts";
import { registerRagThresholdRoutes } from "./rag-thresholds.ts";
import { toKpiDefinition, type KpiDefinitionRow } from "./repository.ts";
import { ruleProblem } from "./support.ts";

export const JSON_BODY = ["application/json"] as const;
export const T_BASE = "/api/v1/transformations/:transformationId";
export const DEFINITION_ITEM = `${T_BASE}/kpi-definitions/:kpiDefinitionId`;
const DICTIONARY = `${T_BASE}/kpi-dictionary`;
const DICTIONARY_ENTRY = `${DEFINITION_ITEM}/dictionary-entry`;
const DEFINITION_VERSIONS = `${DEFINITION_ITEM}/versions`;
const VERSION_ITEM = `${T_BASE}/kpi-versions/:kpiVersionId`;

export const KPI_VERSION_AUDIT_FIELDS = [
  "status",
  "measure_type",
  "value_nature",
  "entry_scope_kind",
  "unit_kind",
  "unit_label",
  "currency",
  "frequency",
  "numerator_label",
  "denominator_label",
  "calculation_method",
  "calculation_description",
  "formula_expression",
  "formula_engine_version",
  "aggregation_rule",
  "stock_additive_across_scopes",
  "ytd_start_month",
  "baseline_id",
  "baseline_value",
  "baseline_date",
  "target_value",
  "target_date",
  "band_lower",
  "band_upper",
  "milestone_due_date",
  "dq_stale_after_days",
  "dq_valid_min",
  "dq_valid_max",
  "dq_evidence_required",
  "submission_route",
  "reviewer_party_code",
  "definition_approval",
  "approval_id",
  "change_reason",
  "activated_at",
  "activated_by",
  "superseded_at",
  "withdrawn_at",
  "withdrawn_by",
  "withdraw_reason",
] as const satisfies readonly (keyof KpiVersionRow)[];

// ------------------------------------------------------------------------------------------------ params

const definitionParams = z.strictObject({ transformationId: z.uuid(), kpiDefinitionId: z.uuid() });
const versionParams = z.strictObject({ transformationId: z.uuid(), kpiVersionId: z.uuid() });

const listQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });

// ------------------------------------------------------------------------------------------------ presenters

const dec = (v: string | null): string | null => (v === null ? null : canonicalDecimal(v));

export function toKpiVersion(r: KpiVersionRow, inputs: KpiVersion["formulaInputs"] = []): KpiVersion {
  return {
    id: r.id,
    transformationId: r.transformation_id,
    kpiDefinitionId: r.kpi_definition_id,
    versionNo: r.version_no,
    status: r.status as KpiVersion["status"],
    measureType: r.measure_type as KpiVersion["measureType"],
    valueNature: r.value_nature as KpiVersion["valueNature"],
    entryScopeKind: r.entry_scope_kind as KpiVersion["entryScopeKind"],
    unitKind: r.unit_kind as KpiVersion["unitKind"],
    unitLabel: r.unit_label,
    currency: r.currency === null ? null : r.currency.trim(),
    frequency: r.frequency as KpiVersion["frequency"],
    numeratorLabel: r.numerator_label,
    denominatorLabel: r.denominator_label,
    calculationMethod: r.calculation_method as KpiVersion["calculationMethod"],
    calculationDescription: r.calculation_description,
    formulaExpression: r.formula_expression,
    formulaEngineVersion: r.formula_engine_version,
    formulaInputs: inputs,
    aggregationRule: r.aggregation_rule as KpiVersion["aggregationRule"],
    stockAdditiveAcrossScopes: r.stock_additive_across_scopes,
    ytdStartMonth: r.ytd_start_month,
    baselineId: r.baseline_id,
    baselineValue: dec(r.baseline_value),
    baselineDate: r.baseline_date,
    targetValue: dec(r.target_value),
    targetDate: r.target_date,
    bandLower: dec(r.band_lower),
    bandUpper: dec(r.band_upper),
    milestoneDueDate: r.milestone_due_date,
    dataQuality: {
      staleAfterDays: r.dq_stale_after_days,
      validMin: dec(r.dq_valid_min),
      validMax: dec(r.dq_valid_max),
      evidenceRequired: r.dq_evidence_required,
    },
    submissionRoute: r.submission_route as KpiVersion["submissionRoute"],
    reviewerPartyCode: r.reviewer_party_code,
    definitionApproval: r.definition_approval as KpiVersion["definitionApproval"],
    approvalId: r.approval_id,
    changeReason: r.change_reason,
    activatedAt: isoOrNull(r.activated_at),
    activatedBy: r.activated_by,
    supersededAt: isoOrNull(r.superseded_at),
    withdrawnAt: isoOrNull(r.withdrawn_at),
    withdrawnBy: r.withdrawn_by,
    withdrawReason: r.withdraw_reason,
    version: r.version,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
    updatedAt: iso(r.updated_at),
  };
}

export async function presentVersions(db: DbOrTx, rows: readonly KpiVersionRow[]): Promise<KpiVersion[]> {
  const inputs = await formulaInputsOf(
    db,
    rows.filter((r) => r.calculation_method === "formula").map((r) => r.id),
  );
  return rows.map((r) => toKpiVersion(r, inputs.get(r.id) ?? []));
}

/** The dictionary entries of definitions: active version, draft id and what still blocks P4 use. */
async function presentEntries(db: DbOrTx, defs: readonly KpiDefinitionRow[]): Promise<KpiDictionaryEntry[]> {
  if (defs.length === 0) return [];
  const ids = defs.map((d) => d.id);
  const versions = await db
    .selectFrom("kpi_version")
    .selectAll()
    .where("kpi_definition_id", "in", ids)
    .where("status", "in", ["active", "draft"])
    .execute();
  const approved = await db
    .selectFrom("target_trajectory")
    .select("kpi_definition_id")
    .distinct()
    .where("kpi_definition_id", "in", ids)
    .where("status", "=", "approved")
    .execute();
  const withTrajectory = new Set(approved.map((a) => a.kpi_definition_id));
  const active = await presentVersions(
    db,
    versions.filter((v) => v.status === "active"),
  );
  const activeOf = new Map(active.map((v) => [v.kpiDefinitionId, v]));
  const draftOf = new Map(versions.filter((v) => v.status === "draft").map((v) => [v.kpi_definition_id, v.id]));
  return defs.map((d) => {
    const activeVersion = activeOf.get(d.id) ?? null;
    const missingForUse: KpiDictionaryEntry["missingForUse"] = [];
    if (d.status !== "active") missingForUse.push("definition_active");
    if (activeVersion === null) missingForUse.push("active_version");
    if (activeVersion === null || activeVersion.aggregationRule === null) missingForUse.push("aggregation_rule");
    if (!withTrajectory.has(d.id)) missingForUse.push("approved_trajectory");
    return { definition: toKpiDefinition(d), activeVersion, draftVersionId: draftOf.get(d.id) ?? null, missingForUse };
  });
}

// ------------------------------------------------------------------------------------------------ reads

async function readTransformation(db: DbOrTx, request: FastifyRequest, transformationId: string): Promise<void> {
  await requireTransformationRead(db, principalOf(request), transformationId);
}

export async function findDefinition(
  db: DbOrTx,
  transformationId: string,
  id: string,
  lock: "update" | "share" | null = null,
): Promise<KpiDefinitionRow | undefined> {
  let q = db
    .selectFrom("kpi_definition")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .where("id", "=", id);
  if (lock === "update") q = q.forUpdate();
  if (lock === "share") q = q.forShare();
  return q.executeTakeFirst();
}

async function findVersion(
  db: DbOrTx,
  transformationId: string,
  id: string,
  forUpdate = false,
): Promise<KpiVersionRow | undefined> {
  let q = db
    .selectFrom("kpi_version")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .where("id", "=", id);
  if (forUpdate) q = q.forUpdate();
  return q.executeTakeFirst();
}

// ------------------------------------------------------------------------------------------------ business rules

/** The content of a version in column terms (create body or draft + patch merged). */
export interface VersionContent {
  measure_type: string;
  value_nature: string;
  entry_scope_kind: string;
  unit_label: string | null;
  numerator_label: string | null;
  denominator_label: string | null;
  calculation_method: string;
  calculation_description: string | null;
  formula_expression: string | null;
  aggregation_rule: string | null;
  stock_additive_across_scopes: boolean;
  ytd_start_month: number;
  baseline_id: string | null;
  baseline_value: string | null;
  baseline_date: string | null;
  target_value: string | null;
  target_date: string | null;
  band_lower: string | null;
  band_upper: string | null;
  milestone_due_date: string | null;
  dq_stale_after_days: number;
  dq_valid_min: string | null;
  dq_valid_max: string | null;
  dq_evidence_required: boolean;
  submission_route: string;
  reviewer_party_code: string | null;
  definition_approval: string;
  change_reason: string | null;
}

const NATURE_RULE: ReadonlyMap<string, string> = new Map([
  ["flow", "sum"],
  ["stock", "last_value"],
  ["ratio", "weighted_ratio"],
  ["milestone", "none"],
]);
const POLARITY_MEASURES: ReadonlyMap<string, readonly string[]> = new Map([
  ["higher_is_better", ["higher_is_better", "binary_milestone"]],
  ["lower_is_better", ["lower_is_better"]],
  ["within_band", ["acceptable_band"]],
]);

const constraintProblem = (detail: string, pointer: string) =>
  ruleProblem({ code: "validation.constraint", detail, pointer });

/** The content rules a draft must satisfy at all times (ADR-0027 §1, §13), in a fixed order; throws the first. */
export function checkVersionContent(
  def: Pick<KpiDefinitionRow, "polarity">,
  c: VersionContent,
  versionNo: number,
): void {
  if (!(POLARITY_MEASURES.get(def.polarity) ?? []).includes(c.measure_type))
    throw ruleProblem({
      code: "kpi_version.measure_mismatch",
      detail: `The measure type ${c.measure_type} does not fit the KPI's polarity ${def.polarity}.`,
      pointer: "/measureType",
    });
  const band = c.measure_type === "acceptable_band";
  if (
    band !== (c.band_lower !== null && c.band_upper !== null) ||
    (c.band_lower === null) !== (c.band_upper === null) ||
    (c.band_lower !== null && c.band_upper !== null && new Decimal(c.band_lower).gt(c.band_upper))
  )
    throw ruleProblem({
      code: "kpi_version.band_required",
      detail:
        "An acceptable-band measure needs a lower and an upper bound, and the lower bound cannot be above the upper bound.",
      pointer: "/bandLower",
    });
  if ((c.measure_type === "binary_milestone") !== (c.value_nature === "milestone"))
    throw constraintProblem("A binary milestone measure has the value nature milestone, and only it.", "/valueNature");
  if (c.milestone_due_date !== null && c.measure_type !== "binary_milestone")
    throw constraintProblem("Only a binary milestone measure has a due date.", "/milestoneDueDate");
  if (c.value_nature !== "ratio" && (c.numerator_label !== null || c.denominator_label !== null))
    throw constraintProblem("Only a ratio KPI has a numerator and a denominator.", "/numeratorLabel");
  if (
    c.aggregation_rule !== null &&
    c.aggregation_rule !== "custom_formula" &&
    NATURE_RULE.get(c.value_nature) !== c.aggregation_rule
  )
    throw ruleProblem({
      code: "kpi_version.aggregation_not_allowed",
      detail: `The aggregation rule ${c.aggregation_rule} cannot be used for a ${c.value_nature} KPI. Use sum for flows, last value for stocks, weighted ratio for ratios, none for milestones, or an approved custom formula.`,
      pointer: "/aggregationRule",
    });
  if (
    c.aggregation_rule === "custom_formula" &&
    !(c.calculation_method === "formula" && c.definition_approval === "business_approval")
  )
    throw ruleProblem({
      code: "kpi_version.custom_formula_needs_approval",
      detail: "A custom aggregation formula needs a formula calculation and the business-approval policy.",
      pointer: "/aggregationRule",
    });
  if ((c.submission_route === "review") !== (c.reviewer_party_code !== null))
    throw ruleProblem({
      code: "kpi_version.reviewer_required",
      detail: "The review route needs a reviewer role, and the direct-accept route has none.",
      pointer: "/reviewerPartyCode",
    });
  if (versionNo > 1 && c.change_reason === null)
    throw ruleProblem({
      code: "kpi_version.change_reason_required",
      detail: "A new version of a KPI needs a reason for the change.",
      pointer: "/changeReason",
    });
  if (c.baseline_id !== null && c.baseline_value !== null)
    throw constraintProblem("A baseline comes from a baseline record or a value, not both.", "/baselineId");
  if (c.dq_valid_min !== null && c.dq_valid_max !== null && new Decimal(c.dq_valid_min).gt(c.dq_valid_max))
    throw constraintProblem("The data-quality minimum cannot be above the maximum.", "/dataQuality/validMin");
}

/** References a draft names: the reviewer party and the baseline record (422 validation.reference). */
async function checkReferences(tx: Tx, transformationId: string, c: VersionContent): Promise<void> {
  if (c.reviewer_party_code !== null) {
    const party = await tx
      .selectFrom("governance_party")
      .select("code")
      .where("code", "=", c.reviewer_party_code)
      .executeTakeFirst();
    if (!party)
      throw ruleProblem({
        code: "validation.reference",
        detail: `There is no governance party ${c.reviewer_party_code}.`,
        pointer: "/reviewerPartyCode",
      });
  }
  if (c.baseline_id !== null) {
    const baseline = await tx
      .selectFrom("baseline")
      .select("id")
      .where("id", "=", c.baseline_id)
      .where("transformation_id", "=", transformationId)
      .executeTakeFirst();
    if (!baseline)
      throw ruleProblem({
        code: "validation.reference",
        detail: "The referenced record does not exist in this transformation.",
        pointer: "/baselineId",
      });
  }
}

/** The completeness rules of activation (ADR-0027 §2 step 2), in order. */
export function checkComplete(c: VersionContent): void {
  if (c.aggregation_rule === null)
    throw ruleProblem({
      code: "kpi_version.aggregation_rule_required",
      detail: "A KPI version needs an aggregation rule before it can be activated.",
      pointer: "/aggregationRule",
    });
  if (c.value_nature === "ratio" && (c.numerator_label === null || c.denominator_label === null))
    throw ruleProblem({
      code: "kpi_version.ratio_labels_required",
      detail: "A ratio KPI needs a numerator and a denominator.",
      pointer: "/numeratorLabel",
    });
  if (c.measure_type === "binary_milestone" && c.milestone_due_date === null)
    throw ruleProblem({
      code: "kpi_version.milestone_due_date_required",
      detail: "A binary milestone measure needs a due date.",
      pointer: "/milestoneDueDate",
    });
}

const notDraft = () =>
  problems.businessRule("kpi_version.not_draft", "Only a draft KPI version can be changed, activated or withdrawn.");

function contentOfCreate(def: KpiDefinitionRow, b: KpiVersionCreate): VersionContent {
  return {
    measure_type: b.measureType,
    value_nature: b.valueNature,
    entry_scope_kind: b.entryScopeKind,
    unit_label: b.unitLabel !== undefined ? b.unitLabel : def.unit_label,
    numerator_label: b.numeratorLabel,
    denominator_label: b.denominatorLabel,
    calculation_method: b.calculationMethod,
    calculation_description: b.calculationDescription,
    formula_expression: b.formulaExpression,
    aggregation_rule: b.aggregationRule,
    stock_additive_across_scopes: b.stockAdditiveAcrossScopes,
    ytd_start_month: b.ytdStartMonth,
    baseline_id: b.baselineId,
    baseline_value: b.baselineValue,
    baseline_date: b.baselineDate,
    target_value: b.targetValue,
    target_date: b.targetDate,
    band_lower: b.bandLower,
    band_upper: b.bandUpper,
    milestone_due_date: b.milestoneDueDate,
    dq_stale_after_days: b.dataQuality.staleAfterDays,
    dq_valid_min: b.dataQuality.validMin,
    dq_valid_max: b.dataQuality.validMax,
    dq_evidence_required: b.dataQuality.evidenceRequired,
    submission_route: b.submissionRoute,
    reviewer_party_code: b.reviewerPartyCode,
    definition_approval: b.definitionApproval,
    change_reason: b.changeReason,
  };
}

function contentOfRow(r: KpiVersionRow): VersionContent {
  return {
    measure_type: r.measure_type,
    value_nature: r.value_nature,
    entry_scope_kind: r.entry_scope_kind,
    unit_label: r.unit_label,
    numerator_label: r.numerator_label,
    denominator_label: r.denominator_label,
    calculation_method: r.calculation_method,
    calculation_description: r.calculation_description,
    formula_expression: r.formula_expression,
    aggregation_rule: r.aggregation_rule,
    stock_additive_across_scopes: r.stock_additive_across_scopes,
    ytd_start_month: r.ytd_start_month,
    baseline_id: r.baseline_id,
    baseline_value: r.baseline_value,
    baseline_date: r.baseline_date,
    target_value: r.target_value,
    target_date: r.target_date,
    band_lower: r.band_lower,
    band_upper: r.band_upper,
    milestone_due_date: r.milestone_due_date,
    dq_stale_after_days: r.dq_stale_after_days,
    dq_valid_min: r.dq_valid_min,
    dq_valid_max: r.dq_valid_max,
    dq_evidence_required: r.dq_evidence_required,
    submission_route: r.submission_route,
    reviewer_party_code: r.reviewer_party_code,
    definition_approval: r.definition_approval,
    change_reason: r.change_reason,
  };
}

/** The patched content columns (only the members present in the body; the formula never changes on a draft). */
function patchOf(b: z.output<typeof kpiVersionUpdate>): Partial<VersionContent> {
  const dq = b.dataQuality;
  return {
    ...(b.measureType !== undefined ? { measure_type: b.measureType } : {}),
    ...(b.valueNature !== undefined ? { value_nature: b.valueNature } : {}),
    ...(b.entryScopeKind !== undefined ? { entry_scope_kind: b.entryScopeKind } : {}),
    ...(b.unitLabel !== undefined ? { unit_label: b.unitLabel } : {}),
    ...(b.numeratorLabel !== undefined ? { numerator_label: b.numeratorLabel } : {}),
    ...(b.denominatorLabel !== undefined ? { denominator_label: b.denominatorLabel } : {}),
    ...(b.calculationDescription !== undefined ? { calculation_description: b.calculationDescription } : {}),
    ...(b.aggregationRule !== undefined ? { aggregation_rule: b.aggregationRule } : {}),
    ...(b.stockAdditiveAcrossScopes !== undefined ? { stock_additive_across_scopes: b.stockAdditiveAcrossScopes } : {}),
    ...(b.ytdStartMonth !== undefined ? { ytd_start_month: b.ytdStartMonth } : {}),
    ...(b.baselineId !== undefined ? { baseline_id: b.baselineId } : {}),
    ...(b.baselineValue !== undefined ? { baseline_value: b.baselineValue } : {}),
    ...(b.baselineDate !== undefined ? { baseline_date: b.baselineDate } : {}),
    ...(b.targetValue !== undefined ? { target_value: b.targetValue } : {}),
    ...(b.targetDate !== undefined ? { target_date: b.targetDate } : {}),
    ...(b.bandLower !== undefined ? { band_lower: b.bandLower } : {}),
    ...(b.bandUpper !== undefined ? { band_upper: b.bandUpper } : {}),
    ...(b.milestoneDueDate !== undefined ? { milestone_due_date: b.milestoneDueDate } : {}),
    ...(b.submissionRoute !== undefined ? { submission_route: b.submissionRoute } : {}),
    ...(b.reviewerPartyCode !== undefined ? { reviewer_party_code: b.reviewerPartyCode } : {}),
    ...(b.definitionApproval !== undefined ? { definition_approval: b.definitionApproval } : {}),
    ...(b.changeReason !== undefined ? { change_reason: b.changeReason } : {}),
    ...(dq !== undefined
      ? {
          dq_stale_after_days: dq.staleAfterDays,
          dq_valid_min: dq.validMin,
          dq_valid_max: dq.validMax,
          dq_evidence_required: dq.evidenceRequired,
        }
      : {}),
  };
}

// ------------------------------------------------------------------------------------------------ mutations

const auditOf = (
  ctx: WriteContext,
  action: string,
  before: KpiVersionRow | null,
  after: KpiVersionRow,
  reason: string | null = null,
) =>
  record(ctx.tx, ctx.audit, {
    action,
    recordType: "kpi_version",
    recordId: after.id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    priorVersion: before?.version ?? null,
    newVersion: after.version,
    reason,
    changes: diffFields(before ?? ({} as KpiVersionRow), after, [...KPI_VERSION_AUDIT_FIELDS]),
  });

async function createVersion(
  ctx: WriteContext,
  kpiDefinitionId: string,
  body: KpiVersionCreate,
): Promise<KpiVersionRow> {
  const { tx, transformationId } = ctx;
  // The definition row lock serializes version numbering and the one-draft rule for this KPI.
  const def = await findDefinition(tx, transformationId, kpiDefinitionId, "update");
  if (!def) throw problems.notFound();
  if (def.status === "archived")
    throw problems.businessRule("kpi_definition.archived", "Archived records are read-only.");
  const last = await tx
    .selectFrom("kpi_version")
    .select(["version_no", "status"])
    .where("kpi_definition_id", "=", def.id)
    .orderBy("version_no", "desc")
    .execute();
  if (last.some((v) => v.status === "draft"))
    throw problems.duplicate(
      "kpi_version.draft_exists",
      "This KPI already has a draft version. Change or withdraw it first.",
    );
  const versionNo = (last[0]?.version_no ?? 0) + 1;
  const content = contentOfCreate(def, body);
  if ((content.calculation_method === "formula") !== (content.formula_expression !== null))
    throw constraintProblem("A formula calculation has a formula expression, and only it.", "/formulaExpression");
  if (content.calculation_method !== "formula" && body.formulaInputs.length > 0)
    throw constraintProblem("Only a formula calculation has formula inputs.", "/formulaInputs");
  checkVersionContent(def, content, versionNo);
  await checkReferences(tx, transformationId, content);
  let engineVersion: string | null = null;
  if (content.calculation_method === "formula") {
    // The cycle first (it names the path, before the trigger's last-line refusal; ADR-0027 §4), so a circular
    // reference is reported as circular whatever its units; then the inputs and units (ADR-0028 §8).
    await assertNoFormulaCycle(
      tx,
      transformationId,
      def.id,
      body.formulaInputs.map((i) => i.sourceKpiDefinitionId),
      "/formulaInputs",
    );
    await checkKpiFormula(tx, transformationId, def, content.formula_expression!, body.formulaInputs);
    engineVersion = ENGINE_VERSION;
  }
  const id = uuidv7();
  const row = await tx
    .insertInto("kpi_version")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      kpi_definition_id: def.id,
      version_no: versionNo,
      unit_kind: def.unit_kind,
      currency: def.currency,
      frequency: def.frequency,
      formula_engine_version: engineVersion,
      ...content,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await insertFormulaInputs(
    tx,
    { organizationId: ctx.organizationId, transformationId, kpiVersionId: id, userId: ctx.userId },
    body.formulaInputs,
  );
  await auditOf(ctx, "kpi_version.create", null, row);
  return row;
}

async function lockDraft(ctx: WriteContext, id: string, expected: number): Promise<KpiVersionRow> {
  const current = await findVersion(ctx.tx, ctx.transformationId, id, true);
  if (!current) throw problems.notFound();
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status !== "draft") throw notDraft();
  return current;
}

async function updateVersion(ctx: WriteContext, id: string, expected: number, body: z.output<typeof kpiVersionUpdate>) {
  const current = await lockDraft(ctx, id, expected);
  await assertNotFrozenByApproval(ctx.tx, current);
  const def = (await findDefinition(ctx.tx, ctx.transformationId, current.kpi_definition_id, "share"))!;
  const patch = patchOf(body);
  const merged: VersionContent = { ...contentOfRow(current), ...patch };
  checkVersionContent(def, merged, current.version_no);
  await checkReferences(ctx.tx, ctx.transformationId, merged);
  const updated = await ctx.tx
    .updateTable("kpi_version")
    .set({ ...patch, version: sql<number>`version + 1`, updated_at: sql<Date>`now()`, updated_by: ctx.userId })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await auditOf(ctx, "kpi_version.update", current, updated);
  return updated;
}

async function activateVersion(ctx: WriteContext, id: string, expected: number, viaChangeRequest = false) {
  const current = await lockDraft(ctx, id, expected);
  const def = (await findDefinition(ctx.tx, ctx.transformationId, current.kpi_definition_id, "update"))!;
  // 1. the KPI definition is active.
  if (def.status !== "active")
    throw problems.businessRule(
      "kpi_version.definition_not_active",
      "Activate the KPI definition before activating one of its versions.",
    );
  // T-DG4-BE-L (ADR-0036 §6 item 2, D-101): a KPI that already has an active version changes its definition, baseline
  // or target only through an approved change request (M0163); the first activation is unchanged. The change-request
  // apply path (activateKpiVersionByChangeRequest) is the only caller with viaChangeRequest = true.
  if (!viaChangeRequest) {
    const active = await ctx.tx
      .selectFrom("kpi_version")
      .select("id")
      .where("kpi_definition_id", "=", def.id)
      .where("status", "=", "active")
      .executeTakeFirst();
    if (active)
      throw problems.businessRule(
        "kpi_version.change_request_required",
        "This KPI already has an active version; changing its definition, baseline or target needs an approved change request.",
      );
  }
  // 2. the version is complete (D-089 Q1: the aggregation rule first).
  checkComplete(contentOfRow(current));
  // 3. under the business-approval policy, an approved kpi_version_activation approval of this version.
  //    The approval must be of this version's current content (subject version = row version); activation stores its id
  //    on the version (T-DG4-KBE-C), and the 0033 guard re-checks it.
  let approvalId: string | null = current.approval_id;
  if (current.definition_approval === "business_approval") {
    approvalId = await approvedApprovalOf(ctx.tx, current);
    if (approvalId === null)
      throw problems.businessRule(
        "kpi_version.approval_required",
        "This KPI version needs an approved business approval before it can be activated.",
      );
  }
  // 4. no formula cycle with the active graph (the KPI's own active version is the one being replaced), and the units
  //    still type-check: REQ-S07-011 "on save and publish" (a source KPI without a version may have changed its unit
  //    since the draft was saved).
  if (current.calculation_method === "formula") {
    const inputs = (await formulaInputsOf(ctx.tx, [current.id])).get(current.id) ?? [];
    await assertNoFormulaCycle(
      ctx.tx,
      ctx.transformationId,
      def.id,
      inputs.map((i) => i.sourceKpiDefinitionId),
      "/formulaInputs",
    );
    await checkKpiFormula(ctx.tx, ctx.transformationId, def, current.formula_expression!, inputs);
  }
  // Supersede the previous active version first (the partial unique index is immediate), then activate.
  const previous = await ctx.tx
    .selectFrom("kpi_version")
    .selectAll()
    .where("kpi_definition_id", "=", def.id)
    .where("status", "=", "active")
    .forUpdate()
    .executeTakeFirst();
  if (previous) {
    const superseded = await ctx.tx
      .updateTable("kpi_version")
      .set({
        status: "superseded",
        superseded_at: sql<Date>`now()`,
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`,
        updated_by: ctx.userId,
      })
      .where("id", "=", previous.id)
      .where("version", "=", previous.version)
      .returningAll()
      .executeTakeFirstOrThrow();
    await auditOf(ctx, "kpi_version.supersede", previous, superseded);
  }
  const activated = await ctx.tx
    .updateTable("kpi_version")
    .set({
      status: "active",
      approval_id: approvalId,
      activated_at: sql<Date>`now()`,
      activated_by: ctx.userId,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await auditOf(ctx, "kpi_version.activate", current, activated);
  await enqueueKpiEvent(ctx.tx, {
    organizationId: ctx.organizationId,
    aggregateType: "kpi_version",
    aggregateId: activated.id,
    eventType: "kpi.version_activated",
    schemaVersion: 1,
    payload: {
      kpiVersionId: activated.id,
      kpiDefinitionId: def.id,
      transformationId: ctx.transformationId,
      versionNo: activated.version_no,
      supersededKpiVersionId: previous?.id ?? null,
      occurredAt: iso(activated.activated_at!),
    },
    idempotencyKey: `kpi.version_activated:${activated.id}:${activated.version_no}`,
  });
  return activated;
}

async function withdrawVersion(ctx: WriteContext, id: string, expected: number, reason: string) {
  const current = await lockDraft(ctx, id, expected);
  await assertNotFrozenByApproval(ctx.tx, current);
  const updated = await ctx.tx
    .updateTable("kpi_version")
    .set({
      status: "withdrawn",
      withdrawn_at: sql<Date>`now()`,
      withdrawn_by: ctx.userId,
      withdraw_reason: reason,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await auditOf(ctx, "kpi_version.withdraw", current, updated, reason);
  return updated;
}

/**
 * The change-request apply entry point (T-DG4-BE-L; ADR-0036 §2, §6): activates the draft KPI version named by an
 * APPROVED change request, in the approval decision's transaction, through the same activation rules (definition
 * active, complete, the business-approval policy, no formula cycle) except the change-request refusal itself. The
 * previous active version is superseded and stays readable (prospective by default, M0163). The caller (workflows'
 * change_request subject provider) has checked that a person approved the request; nothing here approves anything.
 */
export async function activateKpiVersionByChangeRequest(
  tx: Tx,
  input: {
    readonly organizationId: string;
    readonly transformationId: string;
    readonly userId: string;
    readonly audit: AuditContext;
    readonly kpiVersionId: string;
  },
): Promise<KpiVersionRow> {
  const row = await findVersion(tx, input.transformationId, input.kpiVersionId, true);
  if (!row) throw problems.notFound();
  const ctx = {
    tx,
    userId: input.userId,
    audit: input.audit,
    transformationId: input.transformationId,
    organizationId: input.organizationId,
  } as WriteContext;
  return activateVersion(ctx, row.id, row.version, true);
}

// ------------------------------------------------------------------------------------------------ business approval

/** The approval type of a KPI version's activation approval (0036 seeds it; subject table kpi_version). */
export const KPI_VERSION_APPROVAL_TYPE = "kpi_version_activation";
/** The party a KPI version approval is routed to by default (ADR-0027 §2 step 3: the Business Owner). */
export const KPI_VERSION_APPROVER_PARTY = "BO";
/** While an approval is pending or deferred the draft is frozen; under changes_requested it can be edited. */
const FREEZING_APPROVAL_STATUSES = ["pending", "deferred"] as const;

/** The subset of ADR-0026 §4's request input this module passes (structurally that of workflows' service). */
export interface KpiApprovalRequestInput {
  readonly organizationId: string;
  readonly transformationId: string;
  readonly scope: ResolvedTarget & { transformationId: string };
  readonly approvalType: string;
  readonly subjectId: string;
  readonly subjectVersion: number;
  readonly title: string;
  readonly requestNote: string | null;
  readonly assigneePartyCode: string;
  readonly decisionRightId: null;
  readonly slaType: null;
  readonly urgentReason: null;
  readonly due: null;
}

/** The subject provider shape of ADR-0026 §4 (structurally workflows' ApprovalSubjectProvider). */
export interface KpiApprovalSubjectProvider {
  readonly currentVersion: (db: DbOrTx, subjectId: string, transformationId: string) => Promise<number | null>;
  readonly onOutcome: (tx: Tx, event: { readonly approval: ApprovalRow; readonly outcome: string }) => Promise<void>;
}

/**
 * The approval service as the kpi module sees it. The composition root (server.ts) passes workflows'
 * `requestApprovalInTx`, `registerApprovalSubject` and `toApprovals`; kpi never writes approval rows itself (S-14).
 */
export interface KpiApprovalPort {
  readonly requestApproval: (tx: Tx, audit: AuditContext, input: KpiApprovalRequestInput) => Promise<ApprovalRow>;
  readonly registerSubject: (approvalType: string, provider: KpiApprovalSubjectProvider) => void;
  readonly present: (db: DbOrTx, rows: readonly ApprovalRow[]) => Promise<Approval[]>;
}

/**
 * The subject version of a KPI version for the approval engine: its row version, read FOR SHARE (a concurrent update of
 * the draft waits). It is exactly what the 0031 database guards compare (p4_approval_subject_version), so the service
 * and the database agree on staleness.
 */
export async function kpiVersionSubjectVersion(
  db: DbOrTx,
  subjectId: string,
  transformationId: string,
): Promise<number | null> {
  const row = await db
    .selectFrom("kpi_version")
    .select("version")
    .where("id", "=", subjectId)
    .where("transformation_id", "=", transformationId)
    .forShare()
    .executeTakeFirst();
  return row?.version ?? null;
}

/**
 * The kpi_version_activation subject provider. onOutcome deliberately changes nothing: an approved approval never
 * activates the version (activation is the explicit activateKpiVersion call, which looks the approval up and stores
 * its id), and a rejected, withdrawn, deferred or changes-requested one leaves the draft as it is.
 */
export const KPI_VERSION_SUBJECT_PROVIDER: KpiApprovalSubjectProvider = Object.freeze({
  currentVersion: kpiVersionSubjectVersion,
  onOutcome: async () => {},
});

/** 409 when a pending or deferred kpi_version_activation approval of the draft freezes it (ADR-0026 §4). */
async function assertNotFrozenByApproval(tx: Tx, row: KpiVersionRow): Promise<void> {
  const open = await tx
    .selectFrom("approval")
    .select("id")
    .where("approval_type", "=", KPI_VERSION_APPROVAL_TYPE)
    .where("subject_id", "=", row.id)
    .where("status", "in", [...FREEZING_APPROVAL_STATUSES])
    .executeTakeFirst();
  if (open) throw problems.duplicate("approval.already_open", "An approval for this record is already open.");
}

/**
 * The approved kpi_version_activation approval of this draft AT its current version (an approval of earlier content
 * does not count), or null. Activation stores its id on the version (approval_id), which the 0033 guard re-checks.
 */
async function approvedApprovalOf(tx: Tx, row: KpiVersionRow): Promise<string | null> {
  const approved = await tx
    .selectFrom("approval")
    .select("id")
    .where("approval_type", "=", KPI_VERSION_APPROVAL_TYPE)
    .where("subject_id", "=", row.id)
    .where("transformation_id", "=", row.transformation_id)
    .where("subject_version", "=", row.version)
    .where("status", "=", "approved")
    .orderBy("updated_at", "desc")
    .executeTakeFirst();
  return approved?.id ?? null;
}

/**
 * Requests the business approval (ADR-0027 §2 step 3) of a draft under the business-approval policy, at the version
 * named by If-Match, routed to the Business Owner party (requester excluded, SoD). The draft row itself is not changed:
 * the 0031 guards compare the approval's subject version with the row's version when the approval is decided, so a
 * stamp on the draft would make every such approval stale. The approval engine writes the approval, its audit event
 * and the approver tasks; while it is pending or deferred the draft is frozen (409 approval.already_open).
 */
async function requestVersionApproval(
  ctx: WriteContext,
  port: KpiApprovalPort,
  id: string,
  expected: number,
  requestNote: string | null,
): Promise<ApprovalRow> {
  const current = await lockDraft(ctx, id, expected);
  if (current.definition_approval !== "business_approval")
    throw constraintProblem(
      "This KPI version is activated directly; only a version with the business-approval policy is approved.",
      "/definitionApproval",
    );
  const def = (await findDefinition(ctx.tx, ctx.transformationId, current.kpi_definition_id, "share"))!;
  return port.requestApproval(ctx.tx, ctx.audit, {
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    scope: { ...ctx.target, transformationId: ctx.transformationId },
    approvalType: KPI_VERSION_APPROVAL_TYPE,
    subjectId: current.id,
    subjectVersion: current.version,
    title: `${def.name} v${current.version_no}`,
    requestNote,
    assigneePartyCode: KPI_VERSION_APPROVER_PARTY,
    decisionRightId: null,
    slaType: null,
    urgentReason: null,
    due: null,
  });
}

/** A server built without the approval port fails closed (500), never silently without an approval. */
const unwiredApprovals = () => problems.internal();

// ------------------------------------------------------------------------------------------------ routes

export function registerKpiVersionRoutes(
  app: FastifyInstance,
  deps: ModuleDeps,
  approvals: KpiApprovalPort | null = null,
): string[] {
  const { db } = deps;
  const read = { access: { permission: "transformation.read" as const } };
  const write = (permission: "kpi_version.edit" | "kpi_version.activate", body = true) => ({
    access: { permission },
    ...(body ? { consumes: JSON_BODY } : {}),
  });
  const openVersionWrite = (
    tx: Tx,
    request: FastifyRequest,
    transformationId: string,
    permission: "kpi_version.edit" | "kpi_version.activate",
  ) => openWrite(tx, request, transformationId, [{ permission }], null, { atCommit: true });

  app.get(DICTIONARY, { config: read }, async (request) => {
    const { transformationId } = parse(z.strictObject({ transformationId: z.uuid() }), request.params, "params");
    const query = parseQuery(listQuery, request.query);
    await readTransformation(db, request, transformationId);
    const hash = filterHash({ list: "kpi-dictionary", transformationId });
    const after = decodeCursor(query.cursor, hash, 2);
    let q = db
      .selectFrom("kpi_definition")
      .selectAll()
      .select(sql<string>`to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as("sort_key"))
      .where("transformation_id", "=", transformationId);
    if (after)
      q = q.where(sql<boolean>`(created_at, id) > (${String(after[0])}::timestamptz, ${String(after[1])}::uuid)`);
    const rows = await q
      .orderBy("created_at")
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const pageRows = paginate(rows, query.limit, (r) => [r.sort_key, r.id], hash);
    const items = await presentEntries(
      db,
      pageRows.items.map(({ sort_key: _k, ...r }) => r as KpiDefinitionRow),
    );
    return { items, nextCursor: pageRows.nextCursor };
  });

  app.get(DICTIONARY_ENTRY, { config: read }, async (request) => {
    const { transformationId, kpiDefinitionId } = parse(definitionParams, request.params, "params");
    await readTransformation(db, request, transformationId);
    const def = await findDefinition(db, transformationId, kpiDefinitionId);
    if (!def) throw problems.notFound();
    return (await presentEntries(db, [def]))[0]!;
  });

  app.get(DEFINITION_VERSIONS, { config: read }, async (request) => {
    const { transformationId, kpiDefinitionId } = parse(definitionParams, request.params, "params");
    const query = parseQuery(listQuery, request.query);
    await readTransformation(db, request, transformationId);
    if (!(await findDefinition(db, transformationId, kpiDefinitionId))) throw problems.notFound();
    const hash = filterHash({ list: "kpi-versions", transformationId, kpiDefinitionId });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("kpi_version").selectAll().where("kpi_definition_id", "=", kpiDefinitionId);
    if (after) q = q.where("version_no", "<", Number.parseInt(String(after[0]), 10));
    const rows = await q
      .orderBy("version_no", "desc")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.version_no], hash);
    return { items: await presentVersions(db, page.items), nextCursor: page.nextCursor };
  });

  app.post(DEFINITION_VERSIONS, { config: write("kpi_version.edit") }, async (request, reply) => {
    const { transformationId, kpiDefinitionId } = parse(definitionParams, request.params, "params");
    const result = await db.transaction().execute(async (tx) => {
      const ctx = await openVersionWrite(tx, request, transformationId, "kpi_version.edit");
      const body = parseBody(kpiVersionCreate, request.body);
      return maybeIdempotent(tx, request, ctx.userId, request.body, async () => {
        const row = await createVersion(ctx, kpiDefinitionId, body);
        return { status: 201, body: (await presentVersions(tx, [row]))[0]! };
      });
    });
    return sendCreated(request, reply, result, `/api/v1/transformations/${transformationId}/kpi-versions`);
  });

  app.get(VERSION_ITEM, { config: read }, async (request, reply) => {
    const { transformationId, kpiVersionId } = parse(versionParams, request.params, "params");
    await readTransformation(db, request, transformationId);
    const row = await findVersion(db, transformationId, kpiVersionId);
    if (!row) throw problems.notFound();
    return sendVersioned(reply, 200, (await presentVersions(db, [row]))[0]!);
  });

  app.patch(VERSION_ITEM, { config: write("kpi_version.edit") }, async (request, reply) => {
    const { transformationId, kpiVersionId } = parse(versionParams, request.params, "params");
    const row = await db.transaction().execute(async (tx) => {
      const ctx = await openVersionWrite(tx, request, transformationId, "kpi_version.edit");
      const expected = requireIfMatch(request);
      const body = parseBody(kpiVersionUpdate, request.body);
      return updateVersion(ctx, kpiVersionId, expected, body);
    });
    return sendVersioned(reply, 200, (await presentVersions(db, [row]))[0]!);
  });

  app.post(`${VERSION_ITEM}/activate`, { config: write("kpi_version.activate", false) }, async (request, reply) => {
    const { transformationId, kpiVersionId } = parse(versionParams, request.params, "params");
    const row = await db.transaction().execute(async (tx) => {
      const ctx = await openVersionWrite(tx, request, transformationId, "kpi_version.activate");
      const expected = requireIfMatch(request);
      return activateVersion(ctx, kpiVersionId, expected);
    });
    return sendVersioned(reply, 200, (await presentVersions(db, [row]))[0]!);
  });

  app.post(`${VERSION_ITEM}/withdraw`, { config: write("kpi_version.edit") }, async (request, reply) => {
    const { transformationId, kpiVersionId } = parse(versionParams, request.params, "params");
    const row = await db.transaction().execute(async (tx) => {
      const ctx = await openVersionWrite(tx, request, transformationId, "kpi_version.edit");
      const expected = requireIfMatch(request);
      const { reason } = parseBody(kpiReasonRequest, request.body);
      return withdrawVersion(ctx, kpiVersionId, expected, reason);
    });
    return sendVersioned(reply, 200, (await presentVersions(db, [row]))[0]!);
  });

  app.post(`${VERSION_ITEM}/approval-requests`, { config: write("kpi_version.activate") }, async (request, reply) => {
    const { transformationId, kpiVersionId } = parse(versionParams, request.params, "params");
    const row = await db.transaction().execute(async (tx) => {
      const ctx = await openVersionWrite(tx, request, transformationId, "kpi_version.activate");
      const expected = requireIfMatch(request);
      const body = parseBody(kpiVersionApprovalRequest, request.body);
      if (approvals === null) throw unwiredApprovals();
      return requestVersionApproval(ctx, approvals, kpiVersionId, expected, body.requestNote ?? null);
    });
    const [presented] = await approvals!.present(db, [row]);
    return sendVersioned(reply, 201, presented!, `/api/v1/approvals/${row.id}`);
  });

  return [
    `GET ${DICTIONARY}`,
    `GET ${DICTIONARY_ENTRY}`,
    `GET ${DEFINITION_VERSIONS}`,
    `POST ${DEFINITION_VERSIONS}`,
    `GET ${VERSION_ITEM}`,
    `PATCH ${VERSION_ITEM}`,
    `POST ${VERSION_ITEM}/activate`,
    `POST ${VERSION_ITEM}/withdraw`,
    `POST ${VERSION_ITEM}/approval-requests`,
    ...registerRagThresholdRoutes(app, deps),
  ];
}
