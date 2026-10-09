// Change control (OpenAPI tag "change-requests"; P4 slice H; ADR-0036 §1-§4, §6-§10; T-DG4-BE-L; REQ-S04-014,
// REQ-S07-015, REQ-S09-010, REQ-S16-018 ChangeRequest, REQ-PB-065 change-request routing):
//   GET  /transformations/{t}/change-control-policy             the materiality thresholds (version 0 when none)
//   PUT  /transformations/{t}/change-control-policy             set them; If-Match "0" creates (change_control.configure)
//   GET  /transformations/{t}/change-requests                   list (status, kind filters)
//   POST /transformations/{t}/change-requests                   raise a draft against an approved record (subject lock)
//   GET  /transformations/{t}/change-requests/{id}              one request with its approval id
//   PATCH /transformations/{t}/change-requests/{id}             edit a draft / returned request (If-Match)
//   POST /transformations/{t}/change-requests/{id}/submit       materiality, frozen impact assessment, the business
//                                                               approval routed per T11 (If-Match)
//   POST /transformations/{t}/change-requests/{id}/withdraw     withdraw a request not yet in approval (If-Match)
//
// A change request is decided by a PERSON through the canonical approval (`POST /approvals/{id}/decisions`; approval
// type `change_request`, SoD requester_excluded; ADR-0026 §4). This file registers the subject provider whose onOutcome
// applies the change in the deciding transaction (ADR-0036 §2) or records rejected / changes_requested / withdrawn. It
// never writes approval, approval_decision or approval_escalation (S-14), never edits gate_submission,
// gate_submission_criterion or gate_decision (the original approval and snapshot stay unchanged and viewable), and
// nothing here touches the engineering gates DG0-DG7. No job or timer approves anything: the 0052 trigger refuses an
// outcome without a person's decision row.
//
// Every mutation: the write gate re-checked at commit time (AUD 403; outside scope 404), validation (S-1 free text,
// strict UTF-8), If-Match (428/409; creates are version 1), one audit event in the same transaction, no remote I/O.
import { diffFields, sql, type ChangeControlPolicyRow, type ChangeRequestRow, type DbOrTx, type Tx } from "@mth/db";
import { PROBLEM_TYPES } from "@mth/shared";
import {
  budgetChangeMateriality,
  CHANGE_CONTROL_REFUSALS,
  INVALID_CHARACTER_CODE,
  changeControlPolicyUpdate,
  changeKind as changeKindSchema,
  changeRequestCreate,
  changeRequestStatus,
  changeRequestUpdate,
  compareDecimal,
  dateShiftMateriality,
  isDecimalString,
  kindAppliesTo,
  proposedChangeSchema,
  ratioInRange,
  truncateText,
  type ChangeControlPolicy,
  type ChangeControlRefusalCode,
  type ChangeKind,
  type ChangeRequest,
  type ChangeSubjectType,
  type Materiality,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  denialOf,
  grantApplies,
  principalOf,
  requireTransformationRead,
  routeToParty,
  targetFor,
  type ResolvedTarget,
} from "../access/index.ts";
import { record, type AuditContext } from "../audit/index.ts";
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
  type BenefitFormulaVersionChange,
  type MaterialChangePort,
  type ModuleDeps,
} from "../platform/index.ts";
import { openWrite, type WriteContext } from "../transformations/index.ts";
import {
  defaultDecisionRightRouter,
  registerApprovalSubject,
  requestApprovalInTx,
  type ApprovalOutcomeEvent,
  type DueDate,
} from "./approvals.ts";
import {
  CHANGE_REQUESTS_PATH,
  deriveImpactItems,
  impactContentSha256,
  loadImpactFacts,
  setImpactPreviewPort,
} from "./impact.ts";

const JSON_BODY = ["application/json"] as const;
const BASE = "/api/v1/transformations/:transformationId";
const POLICY = `${BASE}/change-control-policy`;
const LIST = CHANGE_REQUESTS_PATH;
const ITEM = `${LIST}/:changeRequestId`;
const SUBMIT = `${ITEM}/submit`;
const WITHDRAW = `${ITEM}/withdraw`;
const RAISE = "change_request.raise" as const;
const CONFIGURE = "change_control.configure" as const;
export const CHANGE_REQUEST_APPROVAL_TYPE = "change_request";
/** ADR-0036 §8 (class changeRequestSubject): per subject `<subjectType>:<subjectId>` (raise, submit, apply). */
export const CHANGE_REQUEST_SUBJECT_LOCK_CLASS = ADVISORY_LOCK_CLASSES.changeRequestSubject;
const OPEN = ["draft", "submitted", "changes_requested"] as const;

// ------------------------------------------------------------------------------------------------ refusals (ADR-0036 §10)

const REFUSAL_TEXTS: ReadonlyMap<string, string> = new Map(Object.entries(CHANGE_CONTROL_REFUSALS));
const text = (code: ChangeControlRefusalCode): string => REFUSAL_TEXTS.get(code)!;
const ruleAt = (code: ChangeControlRefusalCode, pointer: string, detail: string = text(code)) =>
  new HttpProblem({
    status: 422,
    type: PROBLEM_TYPES.validation,
    code,
    title: "Business rule violated",
    detail,
    errors: [{ pointer, code, message: detail }],
  });
const transition = (code: ChangeControlRefusalCode) =>
  new HttpProblem({
    status: 422,
    type: PROBLEM_TYPES.invalidTransition,
    code,
    title: "Invalid transition",
    detail: text(code),
  });

export const changeRequestRefusals = {
  kindSubjectMismatch: () => ruleAt("change_request.kind_subject_mismatch", "/subjectType"),
  subjectNotApproved: () => ruleAt("change_request.subject_not_approved", "/subjectId"),
  alreadyOpen: (code: string) =>
    problems.duplicate("change_request.already_open", text("change_request.already_open").replace("{code}", code)),
  reasonRequired: () =>
    problems.validation([
      { pointer: "/reason", code: "change_request.reason_required", message: text("change_request.reason_required") },
    ]),
  proposedChangeInvalid: (pointer = "/proposedChange") => ruleAt("change_request.proposed_change_invalid", pointer),
  notEditable: () => transition("change_request.not_editable"),
  notSubmittable: () => transition("change_request.not_submittable"),
  notWithdrawable: () => transition("change_request.not_withdrawable"),
  subjectMoved: (currentVersion: number) =>
    new HttpProblem({
      status: 409,
      type: PROBLEM_TYPES.versionConflict,
      code: "change_request.subject_moved",
      title: "Version conflict",
      detail: text("change_request.subject_moved"),
      currentVersion,
    }),
  retrospective: () => ruleAt("change_request.retrospective_not_supported", "/proposedChange/effectiveFrom"),
  notRequester: () =>
    new HttpProblem({
      status: 403,
      type: PROBLEM_TYPES.forbidden,
      code: "change_request.not_requester",
      title: "Forbidden",
      detail: text("change_request.not_requester"),
    }),
  thresholdInvalid: (pointer: string) => ruleAt("change_control.threshold_invalid", pointer),
  /**
   * NOT in ADR-0036 §10 (for architect acceptance; see the BE-L handback): withdrawing a request whose approval is open
   * goes through the approval engine's withdrawal (POST /approvals/{id}/withdraw), whose outcome withdraws the request
   * in the same transaction, because workflows/approvals.ts exposes no in-transaction withdrawal (S-14).
   */
  withdrawViaApproval: () =>
    new HttpProblem({
      status: 422,
      type: PROBLEM_TYPES.invalidTransition,
      code: "change_request.withdraw_via_approval",
      title: "Invalid transition",
      detail: "This change request is in approval; withdraw its approval instead.",
    }),
} as const;

// ------------------------------------------------------------------------------------------------ helpers

const tParams = z.strictObject({ transformationId: z.uuid() });
const crParams = z.strictObject({ transformationId: z.uuid(), changeRequestId: z.uuid() });
const listQuery = z.strictObject({
  cursor: cursorSchema,
  limit: limitSchema,
  status: changeRequestStatus.optional(),
  kind: changeKindSchema.optional(),
});

async function lockSubjectKey(tx: Tx, subjectType: string, subjectId: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(${CHANGE_REQUEST_SUBJECT_LOCK_CLASS}::integer, hashtext(${`${subjectType}:${subjectId}`}::text))`.execute(
    tx,
  );
}

/** Today's business date in the organization's timezone (ADR-0025 §2). */
async function businessToday(db: DbOrTx, organizationId: string): Promise<string> {
  const r = await sql<{ d: string }>`
    SELECT p4_business_date(now(), (SELECT o.default_timezone FROM organization o WHERE o.id = ${organizationId}::uuid))::text AS d`.execute(
    db,
  );
  return r.rows[0]!.d;
}

/** The organization's active default calendar with its active holidays, or null (ADR-0025 §1). */
async function defaultCalendar(db: DbOrTx, organizationId: string) {
  const calendar = await db
    .selectFrom("business_calendar")
    .select(["id", "workweek", "version"])
    .where("organization_id", "=", organizationId)
    .where("is_default", "=", true)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (!calendar) return null;
  const holidays = await db
    .selectFrom("business_calendar_holiday")
    .select(["id", "date_from", "date_to"])
    .where("calendar_id", "=", calendar.id)
    .where("status", "=", "active")
    .orderBy("date_from")
    .execute();
  return {
    id: calendar.id,
    version: calendar.version,
    calendar: {
      workweek: calendar.workweek.map(Number),
      holidays: holidays.map((h) => ({
        id: h.id,
        dateFrom: String(h.date_from).slice(0, 10),
        dateTo: String(h.date_to).slice(0, 10),
      })),
    },
  };
}

async function policyRow(db: DbOrTx, transformationId: string): Promise<ChangeControlPolicyRow | undefined> {
  return db
    .selectFrom("change_control_policy")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .executeTakeFirst();
}

function toPolicy(transformationId: string, r: ChangeControlPolicyRow | undefined): ChangeControlPolicy {
  return {
    transformationId,
    materialDateShiftWorkingDays: r?.material_date_shift_working_days ?? null,
    materialBudgetChangeRatio: r?.material_budget_change_ratio ?? null,
    note: r?.note ?? null,
    version: r?.version ?? 0,
    updatedAt: r ? iso(r.updated_at) : null,
    updatedBy: r?.updated_by ?? null,
  };
}

/** The approval of a request (the latest one of type change_request), for the API's `approvalId`. */
async function approvalIdsOf(db: DbOrTx, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .selectFrom("approval")
    .select(["id", "subject_id"])
    .where("approval_type", "=", CHANGE_REQUEST_APPROVAL_TYPE)
    .where("subject_id", "in", [...ids])
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  return new Map(rows.map((r) => [r.subject_id, r.id] as const));
}

export function toChangeRequest(r: ChangeRequestRow, approvalId: string | null): ChangeRequest {
  return {
    id: r.id,
    transformationId: r.transformation_id,
    code: r.code,
    changeKind: r.change_kind as ChangeKind,
    subjectType: r.subject_type as ChangeSubjectType,
    subjectId: r.subject_id,
    subjectVersion: r.subject_version,
    proposedRecordType: r.proposed_record_type as ChangeRequest["proposedRecordType"],
    proposedRecordId: r.proposed_record_id,
    proposedChange: r.proposed_change as Record<string, unknown>,
    reason: r.reason,
    origin: r.origin as ChangeRequest["origin"],
    materiality: r.materiality as ChangeRequest["materiality"],
    materialityBasis: (r.materiality_basis ?? null) as ChangeRequest["materialityBasis"],
    routePartyCode: r.route_party_code,
    decisionRightId: r.decision_right_id,
    approvalId,
    status: r.status as ChangeRequest["status"],
    raisedBy: r.raised_by,
    submittedBy: r.submitted_by,
    submittedAt: isoOrNull(r.submitted_at),
    currentImpactAssessmentId: r.current_impact_assessment_id,
    decidedAt: isoOrNull(r.decided_at),
    appliedAt: isoOrNull(r.applied_at),
    appliedRecordType: r.applied_record_type,
    appliedRecordId: r.applied_record_id,
    appliedVersion: r.applied_version,
    withdrawnAt: isoOrNull(r.withdrawn_at),
    version: r.version,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
    updatedAt: iso(r.updated_at),
    updatedBy: r.updated_by,
  };
}

async function present(db: DbOrTx, rows: readonly ChangeRequestRow[]): Promise<ChangeRequest[]> {
  const approvals = await approvalIdsOf(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => toChangeRequest(r, approvals.get(r.id) ?? null));
}

async function findRequest(db: DbOrTx, transformationId: string, id: string, lock = false) {
  let q = db
    .selectFrom("change_request")
    .selectAll()
    .where("id", "=", id)
    .where("transformation_id", "=", transformationId);
  if (lock) q = q.forUpdate();
  return q.executeTakeFirst();
}

// ------------------------------------------------------------------------------------------------ subjects

/** What change control needs to know about the subject record. */
export interface SubjectState {
  readonly version: number;
  /** ADR-0036 §2 "an approved record" (see `loadSubject` for the rule per type). */
  readonly approved: boolean;
  /** The current values of the fields a kind changes (decimals as strings, dates as YYYY-MM-DD). */
  readonly values: ReadonlyMap<string, unknown>;
}

const vals = (o: Record<string, unknown>): ReadonlyMap<string, unknown> => new Map(Object.entries(o));

async function gateApproved(db: DbOrTx, transformationId: string, gateCode: string): Promise<boolean> {
  const g = await db
    .selectFrom("gate_instance")
    .select("status")
    .where("transformation_id", "=", transformationId)
    .where("gate_code", "=", gateCode)
    .executeTakeFirst();
  return g?.status === "approved";
}

/** True when a version of the formula is pinned by an APPROVED G4 submission snapshot (ADR-0036 §6 item 1). */
export async function formulaPinnedByApprovedG4(db: DbOrTx, transformationId: string, formulaId: string) {
  const r = await sql<{ n: number }>`
    SELECT count(*)::int AS n FROM gate_decision d JOIN gate_submission s ON s.id = d.gate_submission_id
     WHERE d.outcome = 'approved' AND s.gate_code = 'G4' AND s.transformation_id = ${transformationId}::uuid
       AND s.snapshot->'g4'->'formulaVersions' @> jsonb_build_array(jsonb_build_object('formulaId', ${formulaId}::text))`.execute(
    db,
  );
  return (r.rows[0]?.n ?? 0) > 0;
}

/**
 * The subject in the transformation (undefined when it does not exist there). "Approved" per type (an interpretation
 * of ADR-0036 §2, listed in the BE-L handback): a charter after G1 approval; a KPI with an active version; an outcome
 * KPI after G2 approval; a TOM canvas cell after G3 approval; an initiative from `selected` on; a benefit formula with a
 * Finance-validated version or pinned by an approved G4 snapshot; a milestone with an approved date; an active budget
 * line with a budget amount.
 */
export async function loadSubject(
  db: DbOrTx,
  transformationId: string,
  subjectType: ChangeSubjectType,
  subjectId: string,
): Promise<SubjectState | undefined> {
  const T = transformationId;
  switch (subjectType) {
    case "charter": {
      const c = await db
        .selectFrom("charter")
        .selectAll()
        .where("id", "=", subjectId)
        .where("transformation_id", "=", T)
        .executeTakeFirst();
      if (!c) return undefined;
      return {
        version: c.version,
        approved: await gateApproved(db, T, "G1"),
        values: vals({ scopeIn: c.in_scope, scopeOut: c.out_of_scope }),
      };
    }
    case "kpi_definition": {
      const k = await db
        .selectFrom("kpi_definition")
        .select(["id", "version"])
        .where("id", "=", subjectId)
        .where("transformation_id", "=", T)
        .executeTakeFirst();
      if (!k) return undefined;
      const v = await db
        .selectFrom("kpi_version")
        .selectAll()
        .where("kpi_definition_id", "=", k.id)
        .where("status", "=", "active")
        .executeTakeFirst();
      return {
        version: k.version,
        approved: v !== undefined,
        values: vals(
          v
            ? {
                baselineValue: v.baseline_value,
                baselineDate: v.baseline_date,
                targetValue: v.target_value,
                targetDate: v.target_date,
                formulaExpression: v.formula_expression,
                calculationMethod: v.calculation_method,
                aggregationRule: v.aggregation_rule,
                activeVersionId: v.id,
                activeVersionNo: v.version_no,
              }
            : {},
        ),
      };
    }
    case "outcome_kpi": {
      const o = await db
        .selectFrom("outcome_kpi")
        .selectAll()
        .where("id", "=", subjectId)
        .where("transformation_id", "=", T)
        .executeTakeFirst();
      if (!o) return undefined;
      return {
        version: o.version,
        approved: o.status !== "archived" && (await gateApproved(db, T, "G2")),
        values: vals({ baselineValue: o.baseline_value, targetValue: o.target_value, targetDate: o.target_date }),
      };
    }
    case "tom_canvas_cell": {
      const c = await db
        .selectFrom("tom_canvas_cell")
        .selectAll()
        .where("id", "=", subjectId)
        .where("transformation_id", "=", T)
        .executeTakeFirst();
      if (!c) return undefined;
      return {
        version: c.version,
        approved: await gateApproved(db, T, "G3"),
        values: vals({ targetDesign: c.target_design }),
      };
    }
    case "initiative": {
      const i = await db
        .selectFrom("initiative")
        .selectAll()
        .where("id", "=", subjectId)
        .where("transformation_id", "=", T)
        .executeTakeFirst();
      if (!i) return undefined;
      return {
        version: i.version,
        approved: ["selected", "funded", "launched", "completed"].includes(i.status),
        values: vals({ name: i.name, objective: i.objective, scopeIn: i.scope_in, scopeOut: i.scope_out }),
      };
    }
    case "benefit_formula": {
      const f = await db
        .selectFrom("benefit_formula")
        .selectAll()
        .where("id", "=", subjectId)
        .where("transformation_id", "=", T)
        .executeTakeFirst();
      if (!f) return undefined;
      const validated = await db
        .selectFrom("benefit_formula_version")
        .select("id")
        .where("formula_id", "=", f.id)
        .where("validation_status", "=", "validated")
        .executeTakeFirst();
      return {
        version: f.version,
        approved:
          f.status !== "archived" && (validated !== undefined || (await formulaPinnedByApprovedG4(db, T, f.id))),
        values: vals({ currentVersionNo: f.current_version_no }),
      };
    }
    case "milestone": {
      const m = await db
        .selectFrom("milestone")
        .selectAll()
        .where("id", "=", subjectId)
        .where("transformation_id", "=", T)
        .executeTakeFirst();
      if (!m) return undefined;
      return {
        version: m.version,
        approved: m.approved_date !== null,
        values: vals({ approvedDate: m.approved_date, forecastDate: m.forecast_date }),
      };
    }
    case "budget_line": {
      const b = await db
        .selectFrom("budget_line")
        .selectAll()
        .where("id", "=", subjectId)
        .where("transformation_id", "=", T)
        .executeTakeFirst();
      if (!b) return undefined;
      return {
        version: b.version,
        approved: b.status === "active" && b.budget_amount !== null,
        values: vals({ budgetAmount: b.budget_amount, currency: b.currency }),
      };
    }
  }
}

/** Two stored values are the same (decimals compared as decimals; everything else exactly). */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  if (typeof a === "string" && typeof b === "string" && isDecimalString(a) && isDecimalString(b))
    return compareDecimal(a, b) === 0;
  return String(a) === String(b);
}

/** True when the subject moved since the request was raised (a benefit-logic request: a newer formula version). */
function subjectMoved(
  cr: Pick<ChangeRequestRow, "change_kind" | "subject_version" | "proposed_change">,
  s: SubjectState,
) {
  if (cr.change_kind === "benefit_logic") {
    const to = (cr.proposed_change as { toVersionNo?: number }).toVersionNo;
    return s.values.get("currentVersionNo") !== to;
  }
  return s.version !== cr.subject_version;
}

interface ValidChange {
  readonly kind: ChangeKind;
  readonly subjectType: ChangeSubjectType;
  readonly subjectId: string;
  readonly proposedChange: Record<string, unknown>;
  readonly proposedRecordType: "kpi_version" | "benefit_formula_version" | null;
  readonly proposedRecordId: string | null;
}

/**
 * Validates a change against its subject (ADR-0036 §2): the shape per kind (422 proposed_change_invalid), every
 * `from` equal to the subject's current value, the proposed record (a draft KPI version of that KPI; a version of
 * that formula), and no past `effectiveFrom` (422 retrospective_not_supported).
 */
async function validateChange(
  db: DbOrTx,
  transformationId: string,
  organizationId: string,
  c: ValidChange,
  subject: SubjectState,
): Promise<void> {
  const schema = proposedChangeSchema(c.kind, c.subjectType);
  if (schema === null) throw changeRequestRefusals.kindSubjectMismatch();
  const parsed = schema.safeParse(c.proposedChange);
  if (!parsed.success) throw changeRequestRefusals.proposedChangeInvalid();
  const pc = c.proposedChange as { currency?: unknown; effectiveFrom?: unknown; toVersionNo?: number };
  for (const [field, change] of Object.entries(c.proposedChange)) {
    if (field === "effectiveFrom" || field === "currency" || field === "fromVersionNo" || field === "toVersionNo")
      continue;
    const from = (change as { from?: unknown }).from;
    if (subject.values.has(field) && !sameValue(from ?? null, subject.values.get(field) ?? null))
      throw changeRequestRefusals.proposedChangeInvalid(`/proposedChange/${field}/from`);
  }
  const currentCurrency = subject.values.get("currency");
  if (typeof pc.currency === "string" && currentCurrency !== undefined && pc.currency !== currentCurrency)
    throw changeRequestRefusals.proposedChangeInvalid("/proposedChange/currency");
  if (typeof pc.effectiveFrom === "string" && pc.effectiveFrom < (await businessToday(db, organizationId)))
    throw changeRequestRefusals.retrospective();
  const kpiVersionKind = c.subjectType === "kpi_definition";
  if (kpiVersionKind) {
    if (c.proposedRecordType !== "kpi_version" || c.proposedRecordId === null)
      throw changeRequestRefusals.proposedChangeInvalid("/proposedRecordId");
    const v = await db
      .selectFrom("kpi_version")
      .select(["status", "kpi_definition_id"])
      .where("id", "=", c.proposedRecordId)
      .where("transformation_id", "=", transformationId)
      .executeTakeFirst();
    if (!v || v.kpi_definition_id !== c.subjectId || v.status !== "draft")
      throw changeRequestRefusals.proposedChangeInvalid("/proposedRecordId");
  } else if (c.kind === "benefit_logic") {
    if (c.proposedRecordType !== "benefit_formula_version" || c.proposedRecordId === null)
      throw changeRequestRefusals.proposedChangeInvalid("/proposedRecordId");
    const v = await db
      .selectFrom("benefit_formula_version")
      .select(["formula_id", "version_no"])
      .where("id", "=", c.proposedRecordId)
      .where("transformation_id", "=", transformationId)
      .executeTakeFirst();
    if (!v || v.formula_id !== c.subjectId || v.version_no !== pc.toVersionNo)
      throw changeRequestRefusals.proposedChangeInvalid("/proposedRecordId");
  } else if (c.proposedRecordType !== null || c.proposedRecordId !== null) {
    throw changeRequestRefusals.proposedChangeInvalid("/proposedRecordId");
  }
}

/** Materiality of a change at this moment (ADR-0036 §3). */
export async function materialityOfChange(
  db: DbOrTx,
  transformationId: string,
  organizationId: string,
  kind: ChangeKind,
  proposedChange: Record<string, unknown>,
  subject: SubjectState,
): Promise<Materiality> {
  const policy = await policyRow(db, transformationId);
  if (kind === "schedule_rebaseline") {
    const to = (proposedChange as { approvedDate: { to: string } }).approvedDate.to;
    const cal = await defaultCalendar(db, organizationId);
    return dateShiftMateriality(
      (subject.values.get("approvedDate") as string | null | undefined) ?? null,
      to,
      cal?.calendar ?? null,
      policy?.material_date_shift_working_days ?? null,
    );
  }
  if (kind === "cost" || kind === "budget_rebaseline") {
    const amount = (proposedChange as { budgetAmount: { from: string | null; to: string | null } }).budgetAmount;
    const from = subject.values.has("budgetAmount")
      ? (subject.values.get("budgetAmount") as string | null)
      : amount.from;
    return budgetChangeMateriality(from ?? null, amount.to, policy?.material_budget_change_ratio ?? null);
  }
  return { materiality: "material", basis: { rule: "always_material", kind } };
}

// ------------------------------------------------------------------------------------------------ direct-edit refusals (§3, §6)

/**
 * ADR-0036 §3 hook for DG3 `POST /milestones/{id}/approve-date`: a RE-approval (an approved date already exists) whose
 * working-day shift exceeds a CONFIGURED `material_date_shift_working_days` is refused 422
 * `milestone.rebaseline_requires_change_request`. With no policy row or a null threshold nothing changes (the DG3
 * behaviour on existing data). A shift that cannot be computed (no active calendar) counts as material.
 */
export async function assertMilestoneDateWithinThreshold(
  db: DbOrTx,
  organizationId: string,
  transformationId: string,
  approvedFrom: string | null,
  approvedTo: string,
): Promise<void> {
  if (approvedFrom === null) return;
  const threshold = (await policyRow(db, transformationId))?.material_date_shift_working_days ?? null;
  if (threshold === null) return;
  const cal = await defaultCalendar(db, organizationId);
  if (dateShiftMateriality(approvedFrom, approvedTo, cal?.calendar ?? null, threshold).materiality === "material")
    throw ruleAt(
      "milestone.rebaseline_requires_change_request",
      "/approvedDate",
      text("milestone.rebaseline_requires_change_request"),
    );
}

/**
 * ADR-0036 §3 hook for BE-E's budget-line update: a change of an existing `budget_amount` beyond a CONFIGURED
 * `material_budget_change_ratio` is refused 422 `budget_line.rebaseline_requires_change_request` (decimal.js; a zero
 * base or a cleared amount is material). Without a threshold, or for a first amount, nothing changes.
 */
export async function assertBudgetChangeWithinThreshold(
  db: DbOrTx,
  transformationId: string,
  from: string | null,
  to: string | null,
): Promise<void> {
  if (from === null || (to !== null && compareDecimal(from, to) === 0)) return;
  const threshold = (await policyRow(db, transformationId))?.material_budget_change_ratio ?? null;
  if (threshold === null) return;
  if (budgetChangeMateriality(from, to, threshold).materiality === "material")
    throw ruleAt(
      "budget_line.rebaseline_requires_change_request",
      "/budgetAmount",
      text("budget_line.rebaseline_requires_change_request"),
    );
}

// ------------------------------------------------------------------------------------------------ routing (ADR-0036 §4)

/** The T11 row (template key) of a kind, and the party used when no T11 row applies or the row is missing. */
const ROUTES: ReadonlyMap<ChangeKind, { readonly t11: string | null; readonly party: string }> = new Map([
  ["business_scope", { t11: "business_scope_change", party: "SP" }],
  ["cost", { t11: "funding_reallocation", party: "SP" }],
  ["budget_rebaseline", { t11: "funding_reallocation", party: "SP" }],
  ["tom", { t11: "target_state_design", party: "SP" }],
  ["baseline", { t11: null, party: "BO" }],
  ["target", { t11: null, party: "BO" }],
  ["kpi_definition", { t11: null, party: "BO" }],
  ["benefit_logic", { t11: null, party: "FIN" }],
  ["schedule_rebaseline", { t11: null, party: "SP" }],
]);

interface Route {
  readonly partyCode: string;
  readonly decisionRightId: string | null;
  readonly slaType: "working_days" | "next_steerco_or_urgent" | "release_plan" | null;
  readonly due: DueDate | null;
  readonly businessDate: string;
}

async function routeOf(tx: Tx, organizationId: string, transformationId: string, kind: ChangeKind): Promise<Route> {
  const r = ROUTES.get(kind)!;
  const businessDate = await businessToday(tx, organizationId);
  if (r.t11 !== null) {
    const row = await tx
      .selectFrom("transformation_decision_right")
      .select("id")
      .where("transformation_id", "=", transformationId)
      .where("template_key", "=", r.t11)
      .where("status", "=", "active")
      .executeTakeFirst();
    if (row) {
      const routing = await defaultDecisionRightRouter(tx, {
        organizationId,
        transformationId,
        decisionRightId: row.id,
        requestBusinessDate: businessDate,
        urgent: false,
        urgentReason: null,
        releaseMilestoneId: null,
      });
      return {
        partyCode: routing.approvePartyCode,
        decisionRightId: routing.decisionRightId,
        slaType: routing.slaType,
        due: routing.due,
        businessDate,
      };
    }
  }
  return { partyCode: r.party, decisionRightId: null, slaType: null, due: null, businessDate };
}

// ------------------------------------------------------------------------------------------------ write gates

async function transformationTarget(db: DbOrTx, transformationId: string): Promise<ResolvedTarget> {
  const t = await db
    .selectFrom("transformation")
    .select(["organization_id", "business_unit_id"])
    .where("id", "=", transformationId)
    .executeTakeFirstOrThrow();
  return targetFor(db, "transformation", {
    organizationId: t.organization_id,
    businessUnitId: t.business_unit_id,
    transformationId,
  });
}

/** Read gate on the request principal (404 outside scope), then the permission re-checked at commit time (AUD 403). */
async function openCrWrite(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
  permission: typeof RAISE | typeof CONFIGURE,
) {
  await requireTransformationRead(tx, principalOf(request), transformationId);
  return openWrite(tx, request, transformationId, [{ permission }], null, { atCommit: true });
}

/** ADR-0036 §7: edit/submit/withdraw by the requester, or a TL/TO of the transformation (403 not_requester). */
function requireRequesterOrLead(ctx: WriteContext, cr: ChangeRequestRow): void {
  if (cr.raised_by === ctx.userId) return;
  const lead = ctx.principal.grants.some(
    (g) => (g.roleCode === "TL" || g.roleCode === "TO") && grantApplies(g, RAISE, ctx.target),
  );
  if (!lead) throw changeRequestRefusals.notRequester().withDenial(denialOf(RAISE, ctx.target));
}

// ------------------------------------------------------------------------------------------------ mutations

const CR_AUDIT_FIELDS = [
  "code",
  "change_kind",
  "subject_type",
  "subject_id",
  "subject_version",
  "proposed_record_type",
  "proposed_record_id",
  "proposed_change",
  "reason",
  "origin",
  "materiality",
  "route_party_code",
  "decision_right_id",
  "status",
  "current_impact_assessment_id",
  "applied_record_type",
  "applied_record_id",
  "applied_version",
] as const satisfies readonly (keyof ChangeRequestRow & string)[];

function diff(before: ChangeRequestRow | null, after: ChangeRequestRow) {
  return diffFields(before ?? ({} as ChangeRequestRow), after, [...CR_AUDIT_FIELDS]) ?? {};
}

async function audit(
  tx: Tx,
  ctx: AuditContext,
  action: string,
  before: ChangeRequestRow | null,
  after: ChangeRequestRow,
  reason: string | null = null,
): Promise<void> {
  await record(tx, ctx, {
    action,
    recordType: "change_request",
    recordId: after.id,
    organizationId: after.organization_id,
    transformationId: after.transformation_id,
    priorVersion: before?.version ?? null,
    newVersion: after.version,
    ...(reason !== null ? { reason } : {}),
    changes: diff(before, after),
  });
}

async function nextCrCode(tx: Tx, transformationId: string): Promise<string> {
  const row = await sql<{ last_value: number }>`
    INSERT INTO record_code_counter (transformation_id, prefix, last_value) VALUES (${transformationId}::uuid, 'CR', 1)
    ON CONFLICT (transformation_id, prefix) DO UPDATE SET last_value = record_code_counter.last_value + 1
    RETURNING last_value`.execute(tx);
  return `CR-${String(row.rows[0]!.last_value).padStart(2, "0")}`;
}

interface RaiseInput {
  readonly organizationId: string;
  readonly transformationId: string;
  readonly userId: string;
  readonly audit: AuditContext;
  readonly origin: "manual" | "automatic";
  readonly change: ValidChange;
  readonly subjectVersion: number;
  readonly reason: string;
  /** false only for the automatic raise, whose subject is being edited in the same transaction. */
  readonly checkSubject: boolean;
}

/** Raises a draft request under the subject lock (one open request per subject; 409 already_open). */
async function raise(tx: Tx, input: RaiseInput): Promise<ChangeRequestRow> {
  const { change: c } = input;
  await lockSubjectKey(tx, c.subjectType, c.subjectId);
  const subject = await loadSubject(tx, input.transformationId, c.subjectType, c.subjectId);
  if (!subject) throw problems.notFound();
  if (input.checkSubject) {
    if (subject.version !== input.subjectVersion) throw problems.versionConflict(subject.version);
    if (!subject.approved) throw changeRequestRefusals.subjectNotApproved();
    await validateChange(tx, input.transformationId, input.organizationId, c, subject);
  }
  const open = await tx
    .selectFrom("change_request")
    .select("code")
    .where("subject_type", "=", c.subjectType)
    .where("subject_id", "=", c.subjectId)
    .where("status", "in", [...OPEN])
    .executeTakeFirst();
  if (open) throw changeRequestRefusals.alreadyOpen(open.code);
  const row = await tx
    .insertInto("change_request")
    .values({
      id: uuidv7(),
      organization_id: input.organizationId,
      transformation_id: input.transformationId,
      code: await nextCrCode(tx, input.transformationId),
      change_kind: c.kind,
      subject_type: c.subjectType,
      subject_id: c.subjectId,
      subject_version: input.subjectVersion,
      proposed_record_type: c.proposedRecordType,
      proposed_record_id: c.proposedRecordId,
      proposed_change: JSON.stringify(c.proposedChange),
      reason: input.reason,
      origin: input.origin,
      raised_by: input.userId,
      created_by: input.userId,
      updated_by: input.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await audit(tx, input.audit, "change_request.create", null, row);
  return row;
}

/** Parses the create body; a missing or blank reason is 400 change_request.reason_required at /reason. */
function parseCreate(body: unknown) {
  try {
    return parseBody(changeRequestCreate, body);
  } catch (err) {
    if (
      err instanceof HttpProblem &&
      err.status === 400 &&
      err.errors?.some((e) => e.pointer === "/reason" && e.code !== INVALID_CHARACTER_CODE)
    )
      throw changeRequestRefusals.reasonRequired();
    throw err;
  }
}

function changeOf(b: z.output<typeof changeRequestCreate>): ValidChange {
  return {
    kind: b.changeKind,
    subjectType: b.subjectType,
    subjectId: b.subjectId,
    proposedChange: b.proposedChange,
    proposedRecordType: b.proposedRecordType ?? null,
    proposedRecordId: b.proposedRecordId ?? null,
  };
}

async function createRequest(tx: Tx, request: FastifyRequest, transformationId: string): Promise<ChangeRequestRow> {
  const ctx = await openCrWrite(tx, request, transformationId, RAISE);
  const body = parseCreate(request.body);
  if (!kindAppliesTo(body.changeKind, body.subjectType)) throw changeRequestRefusals.kindSubjectMismatch();
  return raise(tx, {
    organizationId: ctx.organizationId,
    transformationId,
    userId: ctx.userId,
    audit: ctx.audit,
    origin: "manual",
    change: changeOf(body),
    subjectVersion: body.subjectVersion,
    reason: body.reason,
    checkSubject: true,
  });
}

async function lockRequest(ctx: WriteContext, id: string): Promise<ChangeRequestRow> {
  const cr = await findRequest(ctx.tx, ctx.transformationId, id, true);
  if (!cr) throw problems.notFound();
  return cr;
}

async function updateRequest(tx: Tx, request: FastifyRequest, transformationId: string, id: string) {
  const ctx = await openCrWrite(tx, request, transformationId, RAISE);
  const cr = await lockRequest(ctx, id);
  requireRequesterOrLead(ctx, cr);
  let body: z.output<typeof changeRequestUpdate>;
  try {
    body = parseBody(changeRequestUpdate, request.body);
  } catch (err) {
    if (
      err instanceof HttpProblem &&
      err.status === 400 &&
      err.errors?.some((e) => e.pointer === "/reason" && e.code !== INVALID_CHARACTER_CODE)
    )
      throw changeRequestRefusals.reasonRequired();
    throw err;
  }
  const expected = requireIfMatch(request);
  if (cr.version !== expected) throw problems.versionConflict(cr.version);
  if (cr.status !== "draft" && cr.status !== "changes_requested") throw changeRequestRefusals.notEditable();
  const change: ValidChange = {
    kind: cr.change_kind as ChangeKind,
    subjectType: cr.subject_type as ChangeSubjectType,
    subjectId: cr.subject_id,
    proposedChange: body.proposedChange ?? (cr.proposed_change as Record<string, unknown>),
    proposedRecordType: cr.proposed_record_type as ValidChange["proposedRecordType"],
    proposedRecordId: body.proposedRecordId ?? cr.proposed_record_id,
  };
  await lockSubjectKey(tx, change.subjectType, change.subjectId);
  const subject = await loadSubject(tx, transformationId, change.subjectType, change.subjectId);
  if (!subject) throw problems.notFound();
  const subjectVersion = body.subjectVersion ?? cr.subject_version;
  if (body.subjectVersion !== undefined && subject.version !== body.subjectVersion)
    throw problems.versionConflict(subject.version);
  await validateChange(tx, transformationId, ctx.organizationId, change, subject);
  const updated = await tx
    .updateTable("change_request")
    .set({
      proposed_change: JSON.stringify(change.proposedChange),
      proposed_record_id: change.proposedRecordId,
      subject_version: subjectVersion,
      ...(body.reason !== undefined ? { reason: body.reason } : {}),
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", cr.id)
    .where("version", "=", cr.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await audit(tx, ctx.audit, "change_request.update", cr, updated);
  return updated;
}

interface SubmitActor {
  readonly organizationId: string;
  readonly transformationId: string;
  readonly userId: string;
  readonly audit: AuditContext;
  readonly scope: ResolvedTarget & { transformationId: string };
}

/**
 * Submits a request (ADR-0036 §3-§5): materiality, the impact assessment frozen for exactly the submitted version
 * (append-only, content SHA-256), and, from draft, one business approval requested through `requestApprovalInTx`,
 * routed per §4 (an unmapped party is 422 routing.role_unmapped and nothing is written). After changes requested the
 * request's approval is resubmitted by the requester through the approval engine (POST /approvals/{id}/resubmit with
 * the request's new version).
 */
async function submitInTx(tx: Tx, actor: SubmitActor, cr: ChangeRequestRow, checkMoved: boolean) {
  if (cr.status !== "draft" && cr.status !== "changes_requested") throw changeRequestRefusals.notSubmittable();
  await lockSubjectKey(tx, cr.subject_type, cr.subject_id);
  const subject = await loadSubject(tx, cr.transformation_id, cr.subject_type as ChangeSubjectType, cr.subject_id);
  if (!subject) throw problems.notFound();
  if (checkMoved && subjectMoved(cr, subject)) throw changeRequestRefusals.subjectMoved(subject.version);
  const kind = cr.change_kind as ChangeKind;
  const proposed = cr.proposed_change as Record<string, unknown>;
  const materiality = await materialityOfChange(
    tx,
    cr.transformation_id,
    actor.organizationId,
    kind,
    proposed,
    subject,
  );
  const route = await routeOf(tx, actor.organizationId, cr.transformation_id, kind);
  // Resolve the party before anything is written (422 routing.role_unmapped / routing.assignee_not_approver).
  await routeToParty(tx, actor.scope, route.partyCode);
  const items = deriveImpactItems(
    await loadImpactFacts(tx, cr.transformation_id, {
      changeKind: kind,
      subjectType: cr.subject_type as ChangeSubjectType,
      subjectId: cr.subject_id,
    }),
  );
  const nextVersion = cr.version + 1;
  const assessmentId = uuidv7();
  const sha = impactContentSha256(items);
  await tx
    .insertInto("impact_assessment")
    .values({
      id: assessmentId,
      organization_id: cr.organization_id,
      transformation_id: cr.transformation_id,
      change_request_id: cr.id,
      change_request_version: nextVersion,
      item_count: items.length,
      content_sha256: sha,
      assessed_by: actor.userId,
    })
    .execute();
  if (items.length > 0)
    await tx
      .insertInto("impact_assessment_item")
      .values(
        items.map((i) => ({
          id: uuidv7(),
          organization_id: cr.organization_id,
          transformation_id: cr.transformation_id,
          impact_assessment_id: assessmentId,
          ordinal: i.ordinal,
          item_type: i.itemType,
          record_type: i.recordType,
          record_id: i.recordId,
          record_code: i.recordCode === null ? null : truncateText(i.recordCode, 50),
          label: truncateText(i.label, 300),
          effect: i.effect,
          gate_submission_id: i.gateSubmissionId,
          gate_decision_id: i.gateDecisionId,
          detail: JSON.stringify(i.detail),
        })),
      )
      .execute();
  await record(tx, actor.audit, {
    action: "impact_assessment.create",
    recordType: "impact_assessment",
    recordId: assessmentId,
    organizationId: cr.organization_id,
    transformationId: cr.transformation_id,
    newVersion: 1,
    changes: {
      change_request_id: { from: null, to: cr.id },
      change_request_version: { from: null, to: nextVersion },
      item_count: { from: null, to: items.length },
      content_sha256: { from: null, to: sha },
    },
  });
  const submitted = await tx
    .updateTable("change_request")
    .set({
      status: "submitted",
      submitted_by: actor.userId,
      submitted_at: sql<Date>`now()`,
      materiality: materiality.materiality,
      materiality_basis: JSON.stringify(materiality.basis),
      route_party_code: route.partyCode,
      decision_right_id: route.decisionRightId,
      current_impact_assessment_id: assessmentId,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: actor.userId,
    })
    .where("id", "=", cr.id)
    .where("version", "=", cr.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await audit(tx, actor.audit, "change_request.submit", cr, submitted);
  if (cr.status === "draft")
    await requestApprovalInTx(tx, actor.audit, {
      organizationId: actor.organizationId,
      transformationId: cr.transformation_id,
      scope: actor.scope,
      approvalType: CHANGE_REQUEST_APPROVAL_TYPE,
      subjectId: cr.id,
      subjectVersion: submitted.version,
      title: truncateText(`Change request ${cr.code}: ${cr.reason}`, 200),
      requestNote: null,
      assigneePartyCode: route.partyCode,
      decisionRightId: route.decisionRightId,
      slaType: route.slaType,
      urgentReason: null,
      due: route.due,
      requestBusinessDate: route.businessDate,
    });
  return submitted;
}

async function submitRequest(tx: Tx, request: FastifyRequest, transformationId: string, id: string) {
  const ctx = await openCrWrite(tx, request, transformationId, RAISE);
  const cr = await lockRequest(ctx, id);
  requireRequesterOrLead(ctx, cr);
  const expected = requireIfMatch(request);
  if (cr.version !== expected) throw problems.versionConflict(cr.version);
  return submitInTx(
    tx,
    {
      organizationId: ctx.organizationId,
      transformationId,
      userId: ctx.userId,
      audit: ctx.audit,
      scope: { ...ctx.target, transformationId },
    },
    cr,
    true,
  );
}

async function withdrawRequest(tx: Tx, request: FastifyRequest, transformationId: string, id: string) {
  const ctx = await openCrWrite(tx, request, transformationId, RAISE);
  const cr = await lockRequest(ctx, id);
  requireRequesterOrLead(ctx, cr);
  const expected = requireIfMatch(request);
  if (cr.version !== expected) throw problems.versionConflict(cr.version);
  if (!(OPEN as readonly string[]).includes(cr.status)) throw changeRequestRefusals.notWithdrawable();
  const open = await tx
    .selectFrom("approval")
    .select("id")
    .where("approval_type", "=", CHANGE_REQUEST_APPROVAL_TYPE)
    .where("subject_id", "=", cr.id)
    .where("status", "in", ["pending", "changes_requested", "deferred"])
    .executeTakeFirst();
  if (open) throw changeRequestRefusals.withdrawViaApproval();
  return setWithdrawn(tx, ctx.audit, cr, ctx.userId);
}

async function setWithdrawn(tx: Tx, auditCtx: AuditContext, cr: ChangeRequestRow, userId: string) {
  const updated = await tx
    .updateTable("change_request")
    .set({
      status: "withdrawn",
      withdrawn_at: sql<Date>`now()`,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: userId,
    })
    .where("id", "=", cr.id)
    .where("version", "=", cr.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await audit(tx, auditCtx, "change_request.withdraw", cr, updated);
  return updated;
}

// ------------------------------------------------------------------------------------------------ apply (ADR-0036 §2)

/** kpi's change-request apply entry point (kpi-versions.ts `activateKpiVersionByChangeRequest`), wired by server.ts. */
export type KpiVersionActivator = (
  tx: Tx,
  input: {
    readonly organizationId: string;
    readonly transformationId: string;
    readonly userId: string;
    readonly audit: AuditContext;
    readonly kpiVersionId: string;
  },
) => Promise<{ readonly id: string; readonly version: number }>;

let kpiVersionActivator: KpiVersionActivator | null = null;

/** The composition root wires kpi's activation (workflows imports only kpi/index.ts; the GateFactsProvider pattern). */
export function setKpiVersionActivator(activator: KpiVersionActivator | null): void {
  kpiVersionActivator = activator;
}

interface Applied {
  readonly recordType: string;
  readonly recordId: string;
  readonly version: number;
}

const toOf = (pc: ReadonlyMap<string, unknown>, field: string) => (pc.get(field) as { to: unknown } | undefined)?.to;

/** Updates one subject row (version + 1) with its audit event; returns the new version. */
async function updateSubject(
  tx: Tx,
  table: "charter" | "outcome_kpi" | "tom_canvas_cell" | "initiative" | "milestone" | "budget_line",
  cr: ChangeRequestRow,
  set: Record<string, unknown>,
  approverId: string,
  auditCtx: AuditContext,
): Promise<number> {
  const before = await sql<{
    version: number;
  }>`SELECT version FROM ${sql.table(table)} WHERE id = ${cr.subject_id}::uuid FOR UPDATE`.execute(tx);
  const prior = before.rows[0]!.version;
  const after = await tx
    .updateTable(table)
    .set({ ...set, version: sql<number>`version + 1`, updated_at: sql<Date>`now()`, updated_by: approverId } as never)
    .where("id", "=", cr.subject_id)
    .where("transformation_id", "=", cr.transformation_id)
    .returning("version")
    .executeTakeFirstOrThrow();
  await record(tx, auditCtx, {
    action: `${table}.change_request_applied`,
    recordType: table,
    recordId: cr.subject_id,
    organizationId: cr.organization_id,
    transformationId: cr.transformation_id,
    priorVersion: prior,
    newVersion: after.version,
    reason: truncateText(`Change request ${cr.code}: ${cr.reason}`, 1000),
    changes: Object.fromEntries(
      Object.entries(cr.proposed_change as Record<string, unknown>)
        .filter(([k]) => k !== "effectiveFrom")
        .map(([k, v]) => [k, v as { from: unknown; to: unknown }]),
    ),
  });
  return after.version;
}

/** Appends the charter_version snapshot of the charter's new version (DG2 charter versioning; ADR-0036 §2). */
async function snapshotCharter(tx: Tx, charterId: string, savedBy: string, summary: string): Promise<void> {
  const c = await tx.selectFrom("charter").selectAll().where("id", "=", charterId).executeTakeFirstOrThrow();
  const ns = c.north_star_id
    ? await tx.selectFrom("north_star").select("statement").where("id", "=", c.north_star_id).executeTakeFirst()
    : undefined;
  const tops = await tx
    .selectFrom("outcome")
    .selectAll()
    .where("transformation_id", "=", c.transformation_id)
    .where("is_top_outcome", "=", true)
    .where("status", "<>", "archived")
    .orderBy(sql`top_rank NULLS LAST`)
    .orderBy("id")
    .execute();
  const guardrails = await tx
    .selectFrom("strategic_guardrail")
    .selectAll()
    .where("transformation_id", "=", c.transformation_id)
    .where("status", "=", "active")
    .orderBy("id")
    .execute();
  const { id: _id, version: _v, created_at: _ca, created_by: _cb, updated_at: _ua, updated_by: _ub, ...fields } = c;
  await tx
    .insertInto("charter_version")
    .values({
      ...fields,
      id: uuidv7(),
      charter_id: c.id,
      version_no: c.version,
      north_star_statement: ns?.statement ?? null,
      top_outcomes_snapshot: JSON.stringify(
        tops.map((o) => ({ id: o.id, statement: o.statement, rank: o.top_rank, version: o.version })),
      ),
      guardrails_snapshot: JSON.stringify(
        guardrails.map((g) => ({ id: g.id, title: g.title, category: g.category, version: g.version })),
      ),
      change_summary: truncateText(summary, 1000),
      saved_by: savedBy,
    })
    .execute();
}

async function applyChange(tx: Tx, cr: ChangeRequestRow, approverId: string, auditCtx: AuditContext): Promise<Applied> {
  const pc: ReadonlyMap<string, unknown> = new Map(Object.entries(cr.proposed_change as Record<string, unknown>));
  const has = (f: string) => pc.get(f) !== undefined;
  const subject = { recordType: cr.subject_type, recordId: cr.subject_id };
  switch (cr.subject_type as ChangeSubjectType) {
    case "kpi_definition": {
      if (kpiVersionActivator === null) throw problems.internal();
      const v = await kpiVersionActivator(tx, {
        organizationId: cr.organization_id,
        transformationId: cr.transformation_id,
        userId: approverId,
        audit: auditCtx,
        kpiVersionId: cr.proposed_record_id!,
      });
      return { recordType: "kpi_version", recordId: v.id, version: v.version };
    }
    case "benefit_formula": {
      // The approved basis is the new formula version; no DG3 row changes (ADR-0036 §2).
      const v = await tx
        .selectFrom("benefit_formula_version")
        .select(["id", "version"])
        .where("id", "=", cr.proposed_record_id!)
        .executeTakeFirstOrThrow();
      return { recordType: "benefit_formula_version", recordId: v.id, version: v.version };
    }
    case "charter": {
      const version = await updateSubject(
        tx,
        "charter",
        cr,
        {
          ...(has("scopeIn") ? { in_scope: toOf(pc, "scopeIn") } : {}),
          ...(has("scopeOut") ? { out_of_scope: toOf(pc, "scopeOut") } : {}),
        },
        approverId,
        auditCtx,
      );
      await snapshotCharter(tx, cr.subject_id, approverId, `Change request ${cr.code}: ${cr.reason}`);
      return { ...subject, version };
    }
    case "initiative": {
      if (cr.change_kind === "cost") {
        // An initiative-level cost change records the approved basis; budget amounts live on budget lines.
        const i = await tx
          .selectFrom("initiative")
          .select("version")
          .where("id", "=", cr.subject_id)
          .executeTakeFirstOrThrow();
        return { ...subject, version: i.version };
      }
      const version = await updateSubject(
        tx,
        "initiative",
        cr,
        {
          ...(has("name") ? { name: toOf(pc, "name") } : {}),
          ...(has("objective") ? { objective: toOf(pc, "objective") } : {}),
          ...(has("scopeIn") ? { scope_in: toOf(pc, "scopeIn") } : {}),
          ...(has("scopeOut") ? { scope_out: toOf(pc, "scopeOut") } : {}),
        },
        approverId,
        auditCtx,
      );
      return { ...subject, version };
    }
    case "outcome_kpi": {
      const version = await updateSubject(
        tx,
        "outcome_kpi",
        cr,
        {
          ...(has("baselineValue") ? { baseline_value: toOf(pc, "baselineValue") } : {}),
          ...(has("targetValue") ? { target_value: toOf(pc, "targetValue") } : {}),
          ...(has("targetDate") ? { target_date: toOf(pc, "targetDate") } : {}),
        },
        approverId,
        auditCtx,
      );
      return { ...subject, version };
    }
    case "tom_canvas_cell": {
      const version = await updateSubject(
        tx,
        "tom_canvas_cell",
        cr,
        { target_design: toOf(pc, "targetDesign") },
        approverId,
        auditCtx,
      );
      return { ...subject, version };
    }
    case "budget_line": {
      const version = await updateSubject(
        tx,
        "budget_line",
        cr,
        { budget_amount: toOf(pc, "budgetAmount") },
        approverId,
        auditCtx,
      );
      return { ...subject, version };
    }
    case "milestone": {
      const version = await updateSubject(
        tx,
        "milestone",
        cr,
        {
          approved_date: toOf(pc, "approvedDate"),
          approved_by: approverId,
          approved_at: sql<Date>`now()`,
          approval_reason: truncateText(`Change request ${cr.code}: ${cr.reason}`, 1000),
        },
        approverId,
        auditCtx,
      );
      return { ...subject, version };
    }
  }
}

/**
 * The change_request approval subject provider (ADR-0036 §4): applies the outcome in the deciding transaction. On
 * approve, a subject that moved since submission is 409 change_request.subject_moved and nothing is applied (the whole
 * decision rolls back). The decision itself is the named person's, recorded by the approval engine.
 */
export async function applyChangeRequestOutcome(tx: Tx, event: ApprovalOutcomeEvent): Promise<void> {
  const a = event.approval;
  const cr = await tx
    .selectFrom("change_request")
    .selectAll()
    .where("id", "=", a.subject_id)
    .forUpdate()
    .executeTakeFirst();
  if (!cr) return;
  const auditCtx = event.audit;
  const set = async (values: Record<string, unknown>, action: string): Promise<void> => {
    const updated = await tx
      .updateTable("change_request")
      .set({
        ...values,
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`,
        updated_by: event.actorUserId,
      } as never)
      .where("id", "=", cr.id)
      .where("version", "=", cr.version)
      .returningAll()
      .executeTakeFirstOrThrow();
    await audit(tx, auditCtx, action, cr, updated);
  };
  switch (event.outcome) {
    case "approved": {
      await lockSubjectKey(tx, cr.subject_type, cr.subject_id);
      const subject = await loadSubject(tx, cr.transformation_id, cr.subject_type as ChangeSubjectType, cr.subject_id);
      if (!subject || subjectMoved(cr, subject))
        throw changeRequestRefusals.subjectMoved(subject?.version ?? cr.subject_version);
      const applied = await applyChange(tx, cr, event.actorUserId, auditCtx);
      await set(
        {
          status: "approved",
          decided_at: sql<Date>`now()`,
          applied_at: sql<Date>`now()`,
          applied_record_type: applied.recordType,
          applied_record_id: applied.recordId,
          applied_version: applied.version,
        },
        "change_request.approve",
      );
      return;
    }
    case "rejected":
      await set({ status: "rejected", decided_at: sql<Date>`now()` }, "change_request.reject");
      return;
    case "changes_requested":
      await set({ status: "changes_requested" }, "change_request.return");
      return;
    case "withdrawn":
      if ((OPEN as readonly string[]).includes(cr.status)) await setWithdrawn(tx, auditCtx, cr, event.actorUserId);
      return;
    default:
      // deferred: still in approval; resubmitted: the request was already resubmitted at this version (submit).
      return;
  }
}

// ------------------------------------------------------------------------------------------------ material-change port

/**
 * ADR-0036 §6 item 1: a new version of a formula pinned by an approved G4 snapshot raises one automatic benefit_logic
 * request in the editor's name and submits it to Finance (FIN) when that party resolves; when it does not (unmapped),
 * the request stays a draft, visible in the list, so the DG3 response never changes. With an open request on the
 * formula already, nothing more is raised (one open request per subject).
 */
export const materialChangePortImpl: MaterialChangePort = {
  assertMilestoneDateWithinThreshold,
  assertBudgetChangeWithinThreshold,
  benefitFormulaVersionCreated: async (tx: Tx, e: BenefitFormulaVersionChange) => {
    if (!(await formulaPinnedByApprovedG4(tx, e.transformationId, e.benefitFormulaId))) return;
    await lockSubjectKey(tx, "benefit_formula", e.benefitFormulaId);
    const open = await tx
      .selectFrom("change_request")
      .select("id")
      .where("subject_type", "=", "benefit_formula")
      .where("subject_id", "=", e.benefitFormulaId)
      .where("status", "in", [...OPEN])
      .executeTakeFirst();
    if (open) return;
    const formula = await tx
      .selectFrom("benefit_formula")
      .select(["version", "current_version_no", "code"])
      .where("id", "=", e.benefitFormulaId)
      .executeTakeFirstOrThrow();
    const auditCtx: AuditContext = { actorUserId: e.editorUserId, requestId: e.requestId };
    const reason = truncateText(
      `Automatic: version ${e.versionNo} of benefit formula ${formula.code}, pinned by an approved G4 snapshot${e.changeNote ? `: ${e.changeNote}` : "."}`,
      4000,
    );
    const cr = await raise(tx, {
      organizationId: e.organizationId,
      transformationId: e.transformationId,
      userId: e.editorUserId,
      audit: auditCtx,
      origin: "automatic",
      change: {
        kind: "benefit_logic",
        subjectType: "benefit_formula",
        subjectId: e.benefitFormulaId,
        proposedChange: { fromVersionNo: formula.current_version_no, toVersionNo: e.versionNo },
        proposedRecordType: "benefit_formula_version",
        proposedRecordId: e.benefitFormulaVersionId,
      },
      subjectVersion: formula.version,
      reason,
      checkSubject: false,
    });
    const target = await transformationTarget(tx, e.transformationId);
    const scope = { ...target, transformationId: e.transformationId };
    try {
      await routeToParty(tx, scope, ROUTES.get("benefit_logic")!.party);
    } catch (err) {
      if (err instanceof HttpProblem && err.status === 422) return; // unmapped Finance: the draft waits for a person
      throw err;
    }
    await submitInTx(
      tx,
      {
        organizationId: e.organizationId,
        transformationId: e.transformationId,
        userId: e.editorUserId,
        audit: auditCtx,
        scope,
      },
      cr,
      false,
    );
  },
};

// ------------------------------------------------------------------------------------------------ routes

/** If-Match for the policy PUT: `"0"` names "no row yet" (OpenAPI putChangeControlPolicy). */
function policyIfMatch(request: FastifyRequest): number {
  return request.headers["if-match"] === '"0"' ? 0 : requireIfMatch(request);
}

async function putPolicy(tx: Tx, request: FastifyRequest, transformationId: string): Promise<ChangeControlPolicy> {
  const ctx = await openCrWrite(tx, request, transformationId, CONFIGURE);
  const body = parseBody(changeControlPolicyUpdate, request.body);
  const days = body.materialDateShiftWorkingDays;
  if (days !== null && (days < 0 || days > 250))
    throw changeRequestRefusals.thresholdInvalid("/materialDateShiftWorkingDays");
  const ratio = body.materialBudgetChangeRatio;
  if (ratio !== null && !ratioInRange(ratio))
    throw changeRequestRefusals.thresholdInvalid("/materialBudgetChangeRatio");
  const expected = policyIfMatch(request);
  await sql`SELECT pg_advisory_xact_lock(${CHANGE_REQUEST_SUBJECT_LOCK_CLASS}::integer, hashtext(${`change_control_policy:${transformationId}`}::text))`.execute(
    tx,
  );
  const current = await tx
    .selectFrom("change_control_policy")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .forUpdate()
    .executeTakeFirst();
  if ((current?.version ?? 0) !== expected) {
    if (current) throw problems.versionConflict(current.version);
    // No row yet (version 0): the Problem schema's currentVersion starts at 1, so it is left out.
    throw new HttpProblem({
      status: 409,
      type: PROBLEM_TYPES.versionConflict,
      code: "version_conflict",
      title: "Version conflict",
      detail: "The record was changed by someone else. Review the current version and re-apply your change.",
    });
  }
  const note = body.note === undefined ? (current?.note ?? null) : body.note;
  let row: ChangeControlPolicyRow;
  if (!current) {
    row = await tx
      .insertInto("change_control_policy")
      .values({
        id: uuidv7(),
        organization_id: ctx.organizationId,
        transformation_id: transformationId,
        material_date_shift_working_days: days,
        material_budget_change_ratio: ratio,
        note,
        created_by: ctx.userId,
        updated_by: ctx.userId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  } else {
    row = await tx
      .updateTable("change_control_policy")
      .set({
        material_date_shift_working_days: days,
        material_budget_change_ratio: ratio,
        note,
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`,
        updated_by: ctx.userId,
      })
      .where("id", "=", current.id)
      .where("version", "=", current.version)
      .returningAll()
      .executeTakeFirstOrThrow();
  }
  await record(tx, ctx.audit, {
    action: current ? "change_control_policy.update" : "change_control_policy.create",
    recordType: "change_control_policy",
    recordId: row.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current?.version ?? null,
    newVersion: row.version,
    changes: {
      material_date_shift_working_days: {
        from: current?.material_date_shift_working_days ?? null,
        to: row.material_date_shift_working_days,
      },
      material_budget_change_ratio: {
        from: current?.material_budget_change_ratio ?? null,
        to: row.material_budget_change_ratio,
      },
      note: { from: current?.note ?? null, to: row.note },
    },
  });
  return toPolicy(transformationId, row);
}

/** The materiality of an unsaved draft, validated like a create without writing (impact.ts previewChangeImpact). */
async function previewDraft(db: DbOrTx, transformationId: string, body: z.output<typeof changeRequestCreate>) {
  if (!kindAppliesTo(body.changeKind, body.subjectType)) throw changeRequestRefusals.kindSubjectMismatch();
  const subject = await loadSubject(db, transformationId, body.subjectType, body.subjectId);
  if (!subject) throw problems.notFound();
  const t = await db
    .selectFrom("transformation")
    .select("organization_id")
    .where("id", "=", transformationId)
    .executeTakeFirstOrThrow();
  await validateChange(db, transformationId, t.organization_id, changeOf(body), subject);
  return materialityOfChange(db, transformationId, t.organization_id, body.changeKind, body.proposedChange, subject);
}

async function previewSaved(db: DbOrTx, cr: ChangeRequestRow) {
  const subject = await loadSubject(db, cr.transformation_id, cr.subject_type as ChangeSubjectType, cr.subject_id);
  if (!subject) throw problems.notFound();
  return materialityOfChange(
    db,
    cr.transformation_id,
    cr.organization_id,
    cr.change_kind as ChangeKind,
    cr.proposed_change as Record<string, unknown>,
    subject,
  );
}

export function registerChangeRequestRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  registerApprovalSubject(CHANGE_REQUEST_APPROVAL_TYPE, { onOutcome: applyChangeRequestOutcome });
  setImpactPreviewPort({ previewDraft, previewSaved });
  const read = { access: { permission: "transformation.read" as const } };
  const raiseCfg = { access: { permission: RAISE }, consumes: JSON_BODY };

  app.get(POLICY, { config: read }, async (request, reply) => {
    const { transformationId } = parse(tParams, request.params, "params");
    parseQuery(z.strictObject({}), request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const policy = toPolicy(transformationId, await policyRow(db, transformationId));
    // Version 0 (none configured) answers ETag "0", the value the PUT's If-Match "0" takes. The contract's ETag pattern
    // starts at "1": a contract defect reported in the BE-L handback for the architect.
    reply.header("ETag", `"${policy.version}"`);
    return policy;
  });

  app.put(POLICY, { config: { access: { permission: CONFIGURE }, consumes: JSON_BODY } }, async (request, reply) => {
    const { transformationId } = parse(tParams, request.params, "params");
    const policy = await db.transaction().execute((tx) => putPolicy(tx, request, transformationId));
    reply.header("ETag", `"${policy.version}"`);
    return policy;
  });

  app.get(LIST, { config: read }, async (request) => {
    const { transformationId } = parse(tParams, request.params, "params");
    const query = parseQuery(listQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({ table: "change_request", transformationId, status: query.status, kind: query.kind });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("change_request").selectAll().where("transformation_id", "=", transformationId);
    if (query.status) q = q.where("status", "=", query.status);
    if (query.kind) q = q.where("change_kind", "=", query.kind);
    if (after) q = q.where("id", "<", String(after[0]));
    const rows = await q
      .orderBy("id", "desc")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: await present(db, page.items), nextCursor: page.nextCursor };
  });

  app.post(LIST, { config: raiseCfg }, async (request, reply) => {
    const { transformationId } = parse(tParams, request.params, "params");
    const row = await db.transaction().execute((tx) => createRequest(tx, request, transformationId));
    const [body] = await present(db, [row]);
    return sendVersioned(reply, 201, body!, `/api/v1/transformations/${transformationId}/change-requests/${row.id}`);
  });

  app.get(ITEM, { config: read }, async (request, reply) => {
    const { transformationId, changeRequestId } = parse(crParams, request.params, "params");
    parseQuery(z.strictObject({}), request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const row = await findRequest(db, transformationId, changeRequestId);
    if (!row) throw problems.notFound();
    const [body] = await present(db, [row]);
    return sendVersioned(reply, 200, body!);
  });

  app.patch(ITEM, { config: raiseCfg }, async (request, reply) => {
    const { transformationId, changeRequestId } = parse(crParams, request.params, "params");
    const row = await db.transaction().execute((tx) => updateRequest(tx, request, transformationId, changeRequestId));
    const [body] = await present(db, [row]);
    return sendVersioned(reply, 200, body!);
  });

  // Bodiless action POSTs (OpenAPI declares no request body): config.consumes stays the platform default.
  app.post(SUBMIT, { config: { access: { permission: RAISE } } }, async (request, reply) => {
    const { transformationId, changeRequestId } = parse(crParams, request.params, "params");
    const row = await db.transaction().execute((tx) => submitRequest(tx, request, transformationId, changeRequestId));
    const [body] = await present(db, [row]);
    return sendVersioned(reply, 200, body!);
  });

  app.post(WITHDRAW, { config: { access: { permission: RAISE } } }, async (request, reply) => {
    const { transformationId, changeRequestId } = parse(crParams, request.params, "params");
    const row = await db.transaction().execute((tx) => withdrawRequest(tx, request, transformationId, changeRequestId));
    const [body] = await present(db, [row]);
    return sendVersioned(reply, 200, body!);
  });

  return [
    `GET ${POLICY}`,
    `PUT ${POLICY}`,
    `GET ${LIST}`,
    `POST ${LIST}`,
    `GET ${ITEM}`,
    `PATCH ${ITEM}`,
    `POST ${SUBMIT}`,
    `POST ${WITHDRAW}`,
  ];
}
