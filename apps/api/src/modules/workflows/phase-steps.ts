// The phase catalogue, the phase workspace, guided phase steps, step evidence and the phase review queue (T-DG4-BE-L2;
// ADR-0035 §1, §7 item 3, §8, §11; REQ-PB-014, REQ-S04-001, REQ-S04-002 first clause; p4-work-split §H H.4):
//   GET  /phases                                                         the six phases in order (any signed-in user)
//   GET  /transformations/{t}/phases                                     the phase workspace (transformation.read)
//   GET  /transformations/{t}/phase-steps[?phase=&status=]               steps; status=in_review is the review queue
//   GET  /transformations/{t}/phase-steps/{stepKey}                      one step (ETag "0" while it has no row)
//   PATCH /transformations/{t}/phase-steps/{stepKey}                     assign the owner / start (phase_step.manage)
//   POST /transformations/{t}/phase-steps/{stepKey}/request-review       owner: rule met -> in review (phase_step.progress)
//   POST /transformations/{t}/phase-steps/{stepKey}/review               accept (rule re-evaluated) or return (phase_step.review)
//   GET  /transformations/{t}/phase-steps/{stepKey}/evidence             step evidence links, active and removed
//   POST /transformations/{t}/phase-steps/{stepKey}/evidence             owner links an evidence item (phase_step.progress)
//   POST /transformations/{t}/phase-steps/{stepKey}/evidence/{id}/remove owner removes a link (kept as history)
//
// Completion rules are evaluated here, server-side, through read-only queries in the writing transaction, at the review
// request and again at acceptance; the result is frozen into phase_step.completion_check, and the 0051 CHECKs refuse an
// in_review or complete step without a met check, so the API cannot be bypassed in SQL. A step with no row is shown
// not_started with version 0 and a null owner (Unknown). Steps NEVER move a product gate: nothing here reads or writes
// gate_instance, gate_submission or gate_decision beyond reading the gate status for the workspace (REQ-S04-002: "completing
// every phase task leaves the gate Draft"). G1-G6 are business approvals decided by people; nothing here approves
// anything, and nothing reads or writes the engineering delivery gates DG0-DG7.
import type { DbOrTx, Tx } from "@mth/db";
import { PROBLEM_TYPES } from "@mth/shared";
import {
  phaseStepEvidenceLink,
  phaseStepReview,
  phaseStepUpdate,
  type PhaseCompletionRule,
  type PhaseDefinition,
  type PhaseStep,
  type PhaseStepEvidence,
  type PhaseStepStatus,
  type PhaseWorkspace,
} from "@mth/shared/schemas";
import { sql } from "kysely";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { denialOf, principalOf, requireTransformationRead } from "../access/index.ts";
import { record, type AuditContext } from "../audit/index.ts";
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
import { closeWorkItemsOfSubject, createWorkItemOnce } from "../tasks/index.ts";
import { assertActiveUsers, assertSameTransformation, openWrite, type WriteContext } from "../transformations/index.ts";

const T_BASE = "/api/v1/transformations/:transformationId";
export const PHASES = "/api/v1/phases";
export const PHASE_WORKSPACE = `${T_BASE}/phases`;
export const PHASE_STEPS = `${T_BASE}/phase-steps`;
export const PHASE_STEP = `${PHASE_STEPS}/:stepKey`;
export const PHASE_STEP_REQUEST_REVIEW = `${PHASE_STEP}/request-review`;
export const PHASE_STEP_REVIEW = `${PHASE_STEP}/review`;
export const PHASE_STEP_EVIDENCE = `${PHASE_STEP}/evidence`;
export const PHASE_STEP_EVIDENCE_REMOVE = `${PHASE_STEP_EVIDENCE}/:phaseStepEvidenceId/remove`;
const JSON_BODY = ["application/json"] as const;

/** Permissions (0053; ADR-0035 §8). */
const MANAGE = "phase_step.manage" as const;
const PROGRESS = "phase_step.progress" as const;
const REVIEW = "phase_step.review" as const;

/** Work-item kinds (0053) and their i18n message keys (translated at render time, S-6). */
export const PHASE_STEP_REVIEW_KIND = "phase_step_review";
export const PHASE_STEP_REVIEW_MESSAGE = "gates.task.phase_step_review";
export const PHASE_STEP_ENABLED_KIND = "phase_step_enabled";
export const PHASE_STEP_ENABLED_MESSAGE = "gates.task.phase_step_enabled";

const STEP_KEY = /^(diagnose|define|design|mobilize|transform|realize)\.[a-z_]{1,48}$/;
const tParams = z.strictObject({ transformationId: z.uuid() });
const sParams = z.strictObject({ transformationId: z.uuid(), stepKey: z.string().regex(STEP_KEY) });
const eParams = sParams.extend({ phaseStepEvidenceId: z.uuid() });

// ------------------------------------------------------------------------------------------------ refusals (ADR-0035 §11)

/** The per-rule messages of `phase_step.completion_rule_unmet` (ADR-0035 §11, exact). */
export const COMPLETION_RULE_MESSAGES: ReadonlyMap<PhaseCompletionRule, string> = new Map(
  Object.entries({
    evidence_linked: "at least one verified evidence item must be linked",
    meeting_held: "no meeting has been held",
    kpi_actual_accepted: "no KPI actual has been accepted",
    raid_register_present: "the RAID register is empty",
    benefit_validated: "no benefit measurement has been validated by Finance",
    corrective_cases_owned: "an open corrective case has no owner or follow-up date",
    handover_accepted: "no BAU handover has been accepted",
    improvement_backlog_present: "the improvement backlog is empty",
  }) as [PhaseCompletionRule, string][],
);

const forbidden = (code: string, detail: string) =>
  new HttpProblem({ status: 403, type: PROBLEM_TYPES.forbidden, code, title: "Forbidden", detail });
const rule = (code: string, detail: string) =>
  new HttpProblem({ status: 422, type: PROBLEM_TYPES.validation, code, title: "Business rule violated", detail });

export const phaseStepRefusals = {
  completionRuleUnmet: (r: PhaseCompletionRule) =>
    rule(
      "phase_step.completion_rule_unmet",
      `The completion rule of this step is not met: ${COMPLETION_RULE_MESSAGES.get(r)!}.`,
    ),
  notOwner: () => forbidden("phase_step.not_owner", "Only the owner of this step can do this."),
  reviewerIsOwner: () => forbidden("phase_step.reviewer_is_owner", "The owner cannot review their own step."),
  invalidTransition: (from: PhaseStepStatus, to: PhaseStepStatus) =>
    new HttpProblem({
      status: 422,
      type: PROBLEM_TYPES.invalidTransition,
      code: "phase_step.invalid_transition",
      title: "Invalid transition",
      detail: `A step moves from ${from} to ${to} only as the phase procedure allows.`,
    }),
  ownerRequired: () => rule("phase_step.owner_required", "Assign an owner before the step can be reviewed."),
  returnNoteRequired: () =>
    new HttpProblem({
      status: 400,
      type: PROBLEM_TYPES.validation,
      code: "phase_step.return_note_required",
      title: "Validation failed",
      detail: "A note is required to return a step.",
      errors: [
        { pointer: "/note", code: "phase_step.return_note_required", message: "A note is required to return a step." },
      ],
    }),
  evidenceExists: () =>
    problems.duplicate("phase_step_evidence.exists", "This evidence is already linked to the step."),
  complete: () => rule("phase_step.complete", "This step is complete; its evidence can no longer change."),
} as const;

// ------------------------------------------------------------------------------------------------ catalogue

interface StepDefinitionRow {
  key: string;
  phase_code: string;
  ordinal: number;
  source_procedure_en: string;
  procedure_ar: string;
  required_evidence_en: string;
  required_evidence_ar: string;
  default_owner_role_code: string;
  reviewer_role_code: string;
  completion_rule: string;
}

interface StepRow {
  id: string;
  organization_id: string;
  transformation_id: string;
  step_key: string;
  phase_code: string;
  owner_user_id: string | null;
  status: string;
  enabled_by_gate_decision_id: string | null;
  review_requested_by: string | null;
  review_requested_at: Date | null;
  completion_check: unknown;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  review_outcome: string | null;
  review_note: string | null;
  completed_at: Date | null;
  version: number;
}

/** The six phases in order (phase_definition, read-only seed). */
export async function listPhases(db: DbOrTx): Promise<PhaseDefinition[]> {
  const rows = await db.selectFrom("phase_definition").selectAll().orderBy("ordinal").execute();
  return rows.map((r) => ({
    code: r.code as PhaseDefinition["code"],
    ordinal: r.ordinal,
    gateCode: r.gate_code,
    sourceNameEn: r.source_name_en,
    nameAr: r.name_ar,
    sourceTitleEn: r.source_title_en,
    titleAr: r.title_ar,
    sourcePurposeEn: r.source_purpose_en,
    purposeAr: r.purpose_ar,
    sourceKeyOutputsEn: r.source_key_outputs_en,
    keyOutputsAr: r.key_outputs_ar,
    sourceObjectiveEn: r.source_objective_en,
    objectiveAr: r.objective_ar,
    sourceRef: r.source_ref,
    arProvisional: r.ar_provisional,
  }));
}

/** Every step definition, ordered by phase then step ordinal. */
async function stepDefinitions(db: DbOrTx): Promise<StepDefinitionRow[]> {
  return db
    .selectFrom("phase_step_definition as s")
    .innerJoin("phase_definition as p", "p.code", "s.phase_code")
    .select([
      "s.key",
      "s.phase_code",
      "s.ordinal",
      "s.source_procedure_en",
      "s.procedure_ar",
      "s.required_evidence_en",
      "s.required_evidence_ar",
      "s.default_owner_role_code",
      "s.reviewer_role_code",
      "s.completion_rule",
    ])
    .orderBy("p.ordinal")
    .orderBy("s.ordinal")
    .execute();
}

async function stepDefinition(db: DbOrTx, stepKey: string): Promise<StepDefinitionRow> {
  const d = await db
    .selectFrom("phase_step_definition")
    .select([
      "key",
      "phase_code",
      "ordinal",
      "source_procedure_en",
      "procedure_ar",
      "required_evidence_en",
      "required_evidence_ar",
      "default_owner_role_code",
      "reviewer_role_code",
      "completion_rule",
    ])
    .where("key", "=", stepKey)
    .executeTakeFirst();
  if (!d) throw problems.notFound();
  return d;
}

/** The API view of a step: its definition, merged with its row (or the not-started, owner-Unknown view, version 0). */
function toPhaseStep(transformationId: string, d: StepDefinitionRow, r: StepRow | undefined): PhaseStep {
  return {
    transformationId,
    stepKey: d.key,
    phase: d.phase_code as PhaseStep["phase"],
    ordinal: d.ordinal,
    sourceProcedureEn: d.source_procedure_en,
    procedureAr: d.procedure_ar,
    requiredEvidenceEn: d.required_evidence_en,
    requiredEvidenceAr: d.required_evidence_ar,
    defaultOwnerRoleCode: d.default_owner_role_code,
    reviewerRoleCode: d.reviewer_role_code,
    completionRule: d.completion_rule as PhaseCompletionRule,
    id: r?.id ?? null,
    ownerUserId: r?.owner_user_id ?? null,
    status: (r?.status ?? "not_started") as PhaseStepStatus,
    enabledByGateDecisionId: r?.enabled_by_gate_decision_id ?? null,
    reviewRequestedBy: r?.review_requested_by ?? null,
    reviewRequestedAt: r ? isoOrNull(r.review_requested_at) : null,
    completionCheck: (r?.completion_check ?? null) as PhaseStep["completionCheck"],
    reviewedBy: r?.reviewed_by ?? null,
    reviewedAt: r ? isoOrNull(r.reviewed_at) : null,
    reviewOutcome: (r?.review_outcome ?? null) as PhaseStep["reviewOutcome"],
    reviewNote: r?.review_note ?? null,
    completedAt: r ? isoOrNull(r.completed_at) : null,
    version: r?.version ?? 0,
  };
}

async function stepRows(db: DbOrTx, transformationId: string): Promise<Map<string, StepRow>> {
  const rows = await db
    .selectFrom("phase_step")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .execute();
  return new Map(rows.map((r) => [r.step_key, r]));
}

async function stepRow(tx: DbOrTx, transformationId: string, stepKey: string, forUpdate = false) {
  let q = tx
    .selectFrom("phase_step")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .where("step_key", "=", stepKey);
  if (forUpdate) q = q.forUpdate();
  return q.executeTakeFirst();
}

/** Every step of the transformation, merged, in procedure order. */
export async function allPhaseSteps(db: DbOrTx, transformationId: string): Promise<PhaseStep[]> {
  const [defs, rows] = await Promise.all([stepDefinitions(db), stepRows(db, transformationId)]);
  return defs.map((d) => toPhaseStep(transformationId, d, rows.get(d.key)));
}

export async function getPhaseStep(db: DbOrTx, transformationId: string, stepKey: string): Promise<PhaseStep> {
  const d = await stepDefinition(db, stepKey);
  return toPhaseStep(transformationId, d, await stepRow(db, transformationId, stepKey));
}

/** The phase workspace (REQ-PB-014, REQ-S04-001): per phase its definition, gate status, steps and review-queue count. */
export async function getPhaseWorkspace(db: DbOrTx, transformationId: string): Promise<PhaseWorkspace> {
  const t = await db
    .selectFrom("transformation")
    .select(["id", "current_phase"])
    .where("id", "=", transformationId)
    .executeTakeFirst();
  if (!t) throw problems.notFound();
  const [phases, steps, gates] = await Promise.all([
    listPhases(db),
    allPhaseSteps(db, transformationId),
    db
      .selectFrom("gate_instance")
      .select(["gate_code", "status"])
      .where("transformation_id", "=", transformationId)
      .execute(),
  ]);
  const gateStatus = new Map(gates.map((g) => [g.gate_code, g.status]));
  return {
    transformationId,
    currentPhase: t.current_phase as PhaseWorkspace["currentPhase"],
    phases: phases.map((p) => {
      const own = steps.filter((s) => s.phase === p.code);
      return {
        phase: p,
        isCurrent: p.code === t.current_phase,
        // A gate with no submission is draft (the DG2 default; every transformation has its six instances, 0018).
        gateStatus: (gateStatus.get(p.gateCode) ?? "draft") as PhaseWorkspace["phases"][number]["gateStatus"],
        steps: own,
        reviewQueueCount: own.filter((s) => s.status === "in_review").length,
      };
    }),
  };
}

// ------------------------------------------------------------------------------------------------ completion rules

export interface CompletionCheck {
  readonly rule: PhaseCompletionRule;
  readonly met: boolean;
  readonly facts: Readonly<Record<string, number>>;
}

const countOf = async (q: { executeTakeFirstOrThrow(): Promise<{ n: string | number | bigint }> }) =>
  Number((await q.executeTakeFirstOrThrow()).n);

/**
 * Evaluates the completion rule of ADR-0035 §1 for a step of a transformation, read-only, in the caller's transaction.
 * `stepId` is the step's row (evidence_linked counts the step's own ACTIVE links to VERIFIED evidence).
 */
export async function evaluateCompletionRule(
  db: DbOrTx,
  transformationId: string,
  stepId: string,
  r: PhaseCompletionRule,
): Promise<CompletionCheck> {
  const count = (n: number, key: string) => ({ rule: r, met: n >= 1, facts: Object.fromEntries([[key, n]]) });
  switch (r) {
    case "evidence_linked":
      return count(
        await countOf(
          db
            .selectFrom("phase_step_evidence as l")
            .innerJoin("evidence as e", (j) =>
              j.onRef("e.id", "=", "l.evidence_id").onRef("e.transformation_id", "=", "l.transformation_id"),
            )
            .select((eb) => eb.fn.countAll().as("n"))
            .where("l.phase_step_id", "=", stepId)
            .where("l.status", "=", "active")
            .where("e.review_status", "=", "verified"),
        ),
        "verifiedEvidenceLinks",
      );
    case "meeting_held":
      return count(
        await countOf(
          db
            .selectFrom("meeting")
            .select((eb) => eb.fn.countAll().as("n"))
            .where("transformation_id", "=", transformationId)
            .where("status", "in", ["held", "minutes_published"]),
        ),
        "meetingsHeld",
      );
    case "kpi_actual_accepted":
      return count(
        await countOf(
          db
            .selectFrom("kpi_actual")
            .select((eb) => eb.fn.countAll().as("n"))
            .where("transformation_id", "=", transformationId)
            .where("status", "=", "accepted"),
        ),
        "acceptedKpiActuals",
      );
    case "raid_register_present":
      return count(
        await countOf(
          db
            .selectFrom("raid_entry")
            .select((eb) => eb.fn.countAll().as("n"))
            .where("transformation_id", "=", transformationId),
        ),
        "raidEntries",
      );
    case "benefit_validated":
      return count(
        await countOf(
          db
            .selectFrom("benefit_measurement")
            .select((eb) => eb.fn.countAll().as("n"))
            .where("transformation_id", "=", transformationId)
            .where("status", "=", "validated"),
        ),
        "validatedMeasurements",
      );
    case "corrective_cases_owned": {
      const open = await countOf(
        db
          .selectFrom("corrective_case")
          .select((eb) => eb.fn.countAll().as("n"))
          .where("transformation_id", "=", transformationId)
          .where("status", "<>", "closed"),
      );
      const lacking = await countOf(
        db
          .selectFrom("corrective_case")
          .select((eb) => eb.fn.countAll().as("n"))
          .where("transformation_id", "=", transformationId)
          .where("status", "<>", "closed")
          .where((eb) => eb.or([eb("owner_user_id", "is", null), eb("follow_up_date", "is", null)])),
      );
      // True when there is no open case (ADR-0035 §1).
      return { rule: r, met: lacking === 0, facts: { openCases: open, openCasesWithoutOwnerOrFollowUp: lacking } };
    }
    case "handover_accepted":
      return count(
        await countOf(
          db
            .selectFrom("bau_handover")
            .select((eb) => eb.fn.countAll().as("n"))
            .where("transformation_id", "=", transformationId)
            .where("status", "=", "accepted"),
        ),
        "acceptedHandovers",
      );
    case "improvement_backlog_present":
      return count(
        await countOf(
          db
            .selectFrom("improvement_item")
            .select((eb) => eb.fn.countAll().as("n"))
            .where("transformation_id", "=", transformationId),
        ),
        "improvementItems",
      );
  }
}

// ------------------------------------------------------------------------------------------------ writes

/** If-Match of a step write: `"0"` names "no row yet" (OpenAPI updatePhaseStep); otherwise a strong ETag (428/400). */
function stepIfMatch(request: FastifyRequest): number {
  return request.headers["if-match"] === '"0"' ? 0 : requireIfMatch(request);
}

/** 409 when the client's version is not the row's (no row = version 0; currentVersion only when a row exists). */
function assertVersion(row: { version: number } | undefined, expected: number): void {
  if ((row?.version ?? 0) === expected) return;
  if (row) throw problems.versionConflict(row.version);
  throw new HttpProblem({
    status: 409,
    type: PROBLEM_TYPES.versionConflict,
    code: "version_conflict",
    title: "Version conflict",
    detail: "The record was changed by someone else. Review the current version and re-apply your change.",
  });
}

const userActor = (audit: AuditContext) =>
  ({ actorType: "user", actorUserId: audit.actorUserId, requestId: audit.requestId, source: "api" }) as const;

const stepLink = (transformationId: string, d: { phase_code: string; key: string }) =>
  `/transformations/${transformationId}/phases/${d.phase_code}/steps/${d.key}`;

/**
 * The write gate of a step mutation: the read gate first (outsiders and ADM-only callers 404, existence not disclosed),
 * then the permission, re-checked at commit time on the re-resolved session (the BE-D2 corrective-case precedent).
 */
async function openStepWrite(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
  permission: typeof MANAGE | typeof PROGRESS | typeof REVIEW,
): Promise<WriteContext> {
  await requireTransformationRead(tx, principalOf(request), transformationId);
  return openWrite(tx, request, transformationId, [{ permission }], null, { atCommit: true });
}

/**
 * updatePhaseStep (phase_step.manage; TL, TO): assign the owner and/or start the step (not_started -> in_progress).
 * If-Match "0" creates the row (version 1); a second create races into 409. One audit event.
 */
export async function updatePhaseStep(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
  stepKey: string,
): Promise<PhaseStep> {
  const ctx = await openStepWrite(tx, request, transformationId, MANAGE);
  const body = parseBody(phaseStepUpdate, request.body);
  const expected = stepIfMatch(request);
  const d = await stepDefinition(tx, stepKey);
  await assertActiveUsers(tx, ctx.organizationId, [{ id: body.ownerUserId, pointer: "/ownerUserId" }]);
  const current = await stepRow(tx, transformationId, stepKey, true);
  assertVersion(current, expected);
  const from = (current?.status ?? "not_started") as PhaseStepStatus;
  let status: PhaseStepStatus = from;
  if (body.start === true) {
    if (from !== "not_started") throw phaseStepRefusals.invalidTransition(from, "in_progress");
    status = "in_progress";
  }
  const owner = body.ownerUserId ?? current?.owner_user_id ?? null;
  // The owner is fixed while the step is in review, and a complete step is final (0051 trigger; refused here first).
  if (owner !== (current?.owner_user_id ?? null) && (from === "in_review" || from === "complete"))
    throw phaseStepRefusals.invalidTransition(from, from);
  let row: StepRow;
  if (!current) {
    const inserted = await tx
      .insertInto("phase_step")
      .values({
        id: uuidv7(),
        organization_id: ctx.organizationId,
        transformation_id: transformationId,
        step_key: d.key,
        phase_code: d.phase_code,
        owner_user_id: owner,
        status,
        created_by: ctx.userId,
        updated_by: ctx.userId,
      })
      .onConflict((oc) => oc.constraint("phase_step_key").doNothing())
      .returningAll()
      .executeTakeFirst();
    if (!inserted) {
      const now = await stepRow(tx, transformationId, stepKey);
      throw problems.versionConflict(now?.version ?? 1);
    }
    row = inserted;
  } else {
    row = await tx
      .updateTable("phase_step")
      .set({
        owner_user_id: owner,
        status,
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
    action: current ? "phase_step.update" : "phase_step.create",
    recordType: "phase_step",
    recordId: row.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current?.version ?? null,
    newVersion: row.version,
    changes: {
      ...(current ? {} : { step_key: { from: null, to: row.step_key } }),
      owner_user_id: { from: current?.owner_user_id ?? null, to: row.owner_user_id },
      status: { from: current?.status ?? null, to: row.status },
    },
  });
  return toPhaseStep(transformationId, d, row);
}

/** Active users holding `roleCode` WITH phase_step.review on the transformation now (scoped grants, inherited ones). */
async function reviewerRoleHolders(tx: Tx, transformationId: string, roleCode: string): Promise<string[]> {
  const r = await sql<{ user_id: string }>`
    SELECT DISTINCT sa.user_id
    FROM scoped_assignment sa
    JOIN role r ON r.id = sa.role_id AND r.code = ${roleCode}
    JOIN role_permission rp ON rp.role_id = r.id AND rp.permission_code = ${REVIEW}
    JOIN app_user u ON u.id = sa.user_id AND u.status = 'active'
    JOIN transformation t ON t.id = ${transformationId}::uuid
    WHERE sa.revoked_at IS NULL AND sa.effective_from <= now() AND (sa.effective_to IS NULL OR sa.effective_to > now())
      AND sa.organization_id = t.organization_id
      AND ((sa.scope_type = 'transformation' AND sa.scope_id = t.id)
        OR (r.inherits_downward AND sa.scope_type = 'organization' AND sa.scope_id = t.organization_id)
        OR (r.inherits_downward AND sa.scope_type = 'business_unit'
            AND sa.scope_id IN (SELECT c.ancestor_id FROM business_unit_closure c WHERE c.descendant_id = t.business_unit_id)))
    ORDER BY sa.user_id`.execute(tx);
  return r.rows.map((x) => x.user_id);
}

/** The step owner's gate: 403 phase_step.not_owner (audited as a denied mutation) unless the caller owns the step. */
function assertOwner(ctx: WriteContext, owner: string | null | undefined): void {
  if (owner !== ctx.userId) throw phaseStepRefusals.notOwner().withDenial(denialOf(PROGRESS, ctx.target));
}

/**
 * requestPhaseStepReview (phase_step.progress; the step owner): owner required (422), the caller is the owner (403),
 * in_progress or returned -> in_review (422 invalid transition otherwise), the completion rule evaluated server-side
 * (422 phase_step.completion_rule_unmet) and frozen; one phase_step_review work item per holder of the definition's
 * reviewer role on the transformation, excluding the owner (ADR-0035 §7 item 3). One audit event for the step.
 */
export async function requestPhaseStepReview(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
  stepKey: string,
): Promise<PhaseStep> {
  const ctx = await openStepWrite(tx, request, transformationId, PROGRESS);
  const expected = stepIfMatch(request);
  const d = await stepDefinition(tx, stepKey);
  const current = await stepRow(tx, transformationId, stepKey, true);
  assertVersion(current, expected);
  if (!current || current.owner_user_id === null) throw phaseStepRefusals.ownerRequired();
  assertOwner(ctx, current.owner_user_id);
  const from = current.status as PhaseStepStatus;
  if (from !== "in_progress" && from !== "returned") throw phaseStepRefusals.invalidTransition(from, "in_review");
  const check = await evaluateCompletionRule(
    tx,
    transformationId,
    current.id,
    d.completion_rule as PhaseCompletionRule,
  );
  if (!check.met) throw phaseStepRefusals.completionRuleUnmet(check.rule);
  const row = await tx
    .updateTable("phase_step")
    .set({
      status: "in_review",
      review_requested_by: ctx.userId,
      review_requested_at: sql<Date>`now()`,
      completion_check: JSON.stringify(check),
      reviewed_by: null,
      reviewed_at: null,
      review_outcome: null,
      review_note: null,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "phase_step.request_review",
    recordType: "phase_step",
    recordId: row.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: row.version,
    changes: {
      status: { from: current.status, to: row.status },
      review_requested_by: { from: current.review_requested_by, to: row.review_requested_by },
      completion_check: { from: current.completion_check ?? null, to: check },
    },
  });
  const requestedAt = iso(row.review_requested_at!);
  for (const reviewer of await reviewerRoleHolders(tx, transformationId, d.reviewer_role_code)) {
    if (reviewer === row.owner_user_id) continue;
    await createWorkItemOnce(tx, userActor(ctx.audit), {
      organizationId: ctx.organizationId,
      transformationId,
      kind: PHASE_STEP_REVIEW_KIND,
      assigneeUserId: reviewer,
      subjectType: "phase_step",
      subjectId: row.id,
      linkPath: stepLink(transformationId, d),
      messageKey: PHASE_STEP_REVIEW_MESSAGE,
      messageParams: { phaseCode: d.phase_code, stepKey: d.key },
      dedupeKey: `phase_step_review:${row.id}:${requestedAt}:${reviewer}`,
    });
  }
  return toPhaseStep(transformationId, d, row);
}

/**
 * reviewPhaseStep (phase_step.review; SP, BO, FIN, TO): the step is in review (422 invalid transition otherwise); the
 * reviewer is neither the owner nor the requester (403 phase_step.reviewer_is_owner). Accept re-evaluates the completion
 * rule (422 phase_step.completion_rule_unmet; the step stays in review) and completes the step; it then creates one
 * phase_step_enabled work item for the owner of the next step of the same phase when that step has an owner (dedupe
 * phase_step_next:<stepId>). Return needs a note (400). The open review items are closed. One audit event for the step.
 * Completing steps never changes a gate: the gate stays as it is until a person submits and decides it.
 */
export async function reviewPhaseStep(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
  stepKey: string,
): Promise<PhaseStep> {
  const ctx = await openStepWrite(tx, request, transformationId, REVIEW);
  const body = parseBody(phaseStepReview, request.body);
  if (body.outcome === "returned" && body.note === undefined) throw phaseStepRefusals.returnNoteRequired();
  const expected = stepIfMatch(request);
  const d = await stepDefinition(tx, stepKey);
  const current = await stepRow(tx, transformationId, stepKey, true);
  assertVersion(current, expected);
  const from = (current?.status ?? "not_started") as PhaseStepStatus;
  const to: PhaseStepStatus = body.outcome === "accepted" ? "complete" : "returned";
  if (!current || from !== "in_review") throw phaseStepRefusals.invalidTransition(from, to);
  if (ctx.userId === current.owner_user_id || ctx.userId === current.review_requested_by)
    throw phaseStepRefusals.reviewerIsOwner().withDenial(denialOf(REVIEW, ctx.target));
  let check: CompletionCheck | null = null;
  if (body.outcome === "accepted") {
    check = await evaluateCompletionRule(tx, transformationId, current.id, d.completion_rule as PhaseCompletionRule);
    if (!check.met) throw phaseStepRefusals.completionRuleUnmet(check.rule);
  }
  const row = await tx
    .updateTable("phase_step")
    .set({
      status: to,
      ...(check ? { completion_check: JSON.stringify(check), completed_at: sql<Date>`now()` } : {}),
      reviewed_by: ctx.userId,
      reviewed_at: sql<Date>`now()`,
      review_outcome: body.outcome,
      review_note: body.note ?? null,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: body.outcome === "accepted" ? "phase_step.accept" : "phase_step.return",
    recordType: "phase_step",
    recordId: row.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: row.version,
    changes: {
      status: { from: current.status, to: row.status },
      reviewed_by: { from: current.reviewed_by, to: row.reviewed_by },
      review_outcome: { from: current.review_outcome, to: row.review_outcome },
      ...(check ? { completion_check: { from: current.completion_check ?? null, to: check } } : {}),
    },
  });
  // The review queue items of this step: done for the reviewer, cancelled for the other holders.
  const subject = { organizationId: ctx.organizationId, subjectType: "phase_step", subjectId: row.id };
  const mine = await tx
    .selectFrom("work_item")
    .select("id")
    .where("organization_id", "=", ctx.organizationId)
    .where("kind", "=", PHASE_STEP_REVIEW_KIND)
    .where("subject_type", "=", "phase_step")
    .where("subject_id", "=", row.id)
    .where("assignee_user_id", "=", ctx.userId)
    .where("status", "=", "open")
    .execute();
  if (mine.length > 0)
    await closeOwnReviewItems(
      tx,
      ctx,
      mine.map((m) => m.id),
    );
  await closeWorkItemsOfSubject(tx, userActor(ctx.audit), { ...subject, kinds: [PHASE_STEP_REVIEW_KIND] }, "cancelled");
  if (body.outcome === "accepted") await enableNextStep(tx, ctx, d, row.id);
  return toPhaseStep(transformationId, d, row);
}

/** Marks the reviewer's own open review items done (each with its audit event). */
async function closeOwnReviewItems(tx: Tx, ctx: WriteContext, ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    const item = await tx
      .selectFrom("work_item")
      .select(["id", "version", "organization_id", "transformation_id"])
      .where("id", "=", id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    const updated = await tx
      .updateTable("work_item")
      .set({
        status: "done",
        completed_at: sql<Date>`now()`,
        completed_by: ctx.userId,
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`,
        updated_by: ctx.userId,
      })
      .where("id", "=", id)
      .where("version", "=", item.version)
      .returning("version")
      .executeTakeFirstOrThrow();
    await record(tx, ctx.audit, {
      action: "work_item.complete",
      recordType: "work_item",
      recordId: id,
      organizationId: item.organization_id,
      transformationId: item.transformation_id,
      priorVersion: item.version,
      newVersion: updated.version,
      changes: { status: { from: "open", to: "done" } },
    });
  }
}

/** "Step completed -> next step task" (REQ-S04-001): the next step of the same phase, when it has an owner. */
async function enableNextStep(tx: Tx, ctx: WriteContext, d: StepDefinitionRow, stepId: string): Promise<void> {
  const next = await tx
    .selectFrom("phase_step_definition")
    .select(["key", "phase_code", "ordinal"])
    .where("phase_code", "=", d.phase_code)
    .where("ordinal", ">", d.ordinal)
    .orderBy("ordinal")
    .limit(1)
    .executeTakeFirst();
  if (!next) return;
  const nextRow = await stepRow(tx, ctx.transformationId, next.key);
  if (!nextRow || nextRow.owner_user_id === null || nextRow.status === "complete") return;
  await createWorkItemOnce(tx, userActor(ctx.audit), {
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    kind: PHASE_STEP_ENABLED_KIND,
    assigneeUserId: nextRow.owner_user_id,
    subjectType: "phase_step",
    subjectId: nextRow.id,
    linkPath: stepLink(ctx.transformationId, next),
    messageKey: PHASE_STEP_ENABLED_MESSAGE,
    messageParams: { phaseCode: next.phase_code, stepKey: next.key, previousStepKey: d.key },
    dedupeKey: `phase_step_next:${stepId}`,
  });
}

// ------------------------------------------------------------------------------------------------ step evidence

type EvidenceLinkRow = {
  id: string;
  transformation_id: string;
  phase_step_id: string;
  evidence_id: string;
  status: string;
  removed_by: string | null;
  removed_at: Date | null;
  version: number;
  created_at: Date;
  created_by: string;
  updated_at: Date;
  updated_by: string;
};

const toPhaseStepEvidence = (r: EvidenceLinkRow): PhaseStepEvidence => ({
  id: r.id,
  transformationId: r.transformation_id,
  phaseStepId: r.phase_step_id,
  evidenceId: r.evidence_id,
  status: r.status as PhaseStepEvidence["status"],
  removedBy: r.removed_by,
  removedAt: isoOrNull(r.removed_at),
  version: r.version,
  createdAt: iso(r.created_at),
  createdBy: r.created_by,
  updatedAt: iso(r.updated_at),
  updatedBy: r.updated_by,
});

/**
 * linkPhaseStepEvidence (phase_step.progress; the step owner): an evidence item of the same transformation (422
 * validation.reference otherwise), not already actively linked (409 phase_step_evidence.exists), on a step that is not
 * complete (422 phase_step.complete). Version 1; one audit event.
 */
export async function linkPhaseStepEvidence(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
  stepKey: string,
): Promise<PhaseStepEvidence> {
  const ctx = await openStepWrite(tx, request, transformationId, PROGRESS);
  const body = parseBody(phaseStepEvidenceLink, request.body);
  await stepDefinition(tx, stepKey);
  const step = await stepRow(tx, transformationId, stepKey, true);
  assertOwner(ctx, step?.owner_user_id);
  if (step!.status === "complete") throw phaseStepRefusals.complete();
  await assertSameTransformation(tx, "evidence", transformationId, body.evidenceId, "/evidenceId");
  const dup = await tx
    .selectFrom("phase_step_evidence")
    .select("id")
    .where("phase_step_id", "=", step!.id)
    .where("evidence_id", "=", body.evidenceId)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (dup) throw phaseStepRefusals.evidenceExists();
  const id = uuidv7();
  const row = await tx
    .insertInto("phase_step_evidence")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      phase_step_id: step!.id,
      evidence_id: body.evidenceId,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "phase_step_evidence.link",
    recordType: "phase_step_evidence",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    newVersion: row.version,
    changes: {
      phase_step_id: { from: null, to: row.phase_step_id },
      evidence_id: { from: null, to: row.evidence_id },
    },
  });
  return toPhaseStepEvidence(row);
}

/** removePhaseStepEvidence (phase_step.progress; the step owner): active -> removed, kept as history; If-Match. */
export async function removePhaseStepEvidence(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
  stepKey: string,
  phaseStepEvidenceId: string,
): Promise<PhaseStepEvidence> {
  const ctx = await openStepWrite(tx, request, transformationId, PROGRESS);
  const expected = requireIfMatch(request);
  await stepDefinition(tx, stepKey);
  const step = await stepRow(tx, transformationId, stepKey, true);
  const link = step
    ? await tx
        .selectFrom("phase_step_evidence")
        .selectAll()
        .where("id", "=", phaseStepEvidenceId)
        .where("phase_step_id", "=", step.id)
        .forUpdate()
        .executeTakeFirst()
    : undefined;
  if (!step || !link) throw problems.notFound();
  assertOwner(ctx, step.owner_user_id);
  if (link.version !== expected) throw problems.versionConflict(link.version);
  if (step.status === "complete") throw phaseStepRefusals.complete();
  if (link.status !== "active") throw problems.invalidTransition("The evidence link is already removed.");
  const row = await tx
    .updateTable("phase_step_evidence")
    .set({
      status: "removed",
      removed_by: ctx.userId,
      removed_at: sql<Date>`now()`,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", link.id)
    .where("version", "=", link.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "phase_step_evidence.remove",
    recordType: "phase_step_evidence",
    recordId: row.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: link.version,
    newVersion: row.version,
    changes: { status: { from: link.status, to: row.status } },
  });
  return toPhaseStepEvidence(row);
}

// ------------------------------------------------------------------------------------------------ routes

const stepListQuery = z.strictObject({
  cursor: cursorSchema,
  limit: limitSchema,
  phase: z.enum(["diagnose", "define", "design", "mobilize", "transform", "realize"]).optional(),
  status: z.enum(["not_started", "in_progress", "in_review", "complete", "returned"]).optional(),
});
const pageQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerPhaseStepRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "transformation.read" as const } };

  // The catalogue is the same for everyone (read-only seed); any signed-in user may read it (OpenAPI listPhases).
  app.get(PHASES, { config: { access: { permission: "authenticated" } } }, async (request) => {
    parseQuery(z.strictObject({}), request.query);
    return { items: await listPhases(db) };
  });

  app.get(PHASE_WORKSPACE, { config: read }, async (request) => {
    const { transformationId } = parse(tParams, request.params, "params");
    parseQuery(z.strictObject({}), request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    return getPhaseWorkspace(db, transformationId);
  });

  app.get(PHASE_STEPS, { config: read }, async (request) => {
    const { transformationId } = parse(tParams, request.params, "params");
    const query = parseQuery(stepListQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({ table: "phase_step", transformationId, phase: query.phase, status: query.status });
    const after = decodeCursor(query.cursor, hash, 1);
    const all = await allPhaseSteps(db, transformationId);
    // Procedure order: the position in the catalogue order is the cursor key.
    const indexed = all.map((s, i) => ({ s, i }));
    const rows = indexed.filter(
      ({ s, i }) =>
        (query.phase === undefined || s.phase === query.phase) &&
        (query.status === undefined || s.status === query.status) &&
        (after === null || i > Number(after[0])),
    );
    const page = paginate(rows.slice(0, query.limit + 1), query.limit, (r) => [r.i], hash);
    return { items: page.items.map((r) => r.s), nextCursor: page.nextCursor };
  });

  app.get(PHASE_STEP, { config: read }, async (request, reply) => {
    const { transformationId, stepKey } = parse(sParams, request.params, "params");
    parseQuery(z.strictObject({}), request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const body = await getPhaseStep(db, transformationId, stepKey);
    // Version 0 (no row yet) answers ETag "0", the value the PATCH's If-Match "0" takes (the getPhaseStep summary; the
    // BE-L change-control-policy precedent). The shared ETag header pattern starts at "1": a contract conflict reported
    // in the BE-L2 handback for the architect.
    reply.header("ETag", `"${body.version}"`);
    return body;
  });

  app.patch(PHASE_STEP, { config: { access: { permission: MANAGE }, consumes: JSON_BODY } }, async (request, reply) => {
    const { transformationId, stepKey } = parse(sParams, request.params, "params");
    const body = await db.transaction().execute((tx) => updatePhaseStep(tx, request, transformationId, stepKey));
    return sendVersioned(reply, 200, body);
  });

  app.post(PHASE_STEP_REQUEST_REVIEW, { config: { access: { permission: PROGRESS } } }, async (request, reply) => {
    const { transformationId, stepKey } = parse(sParams, request.params, "params");
    const body = await db.transaction().execute((tx) => requestPhaseStepReview(tx, request, transformationId, stepKey));
    return sendVersioned(reply, 200, body);
  });

  app.post(
    PHASE_STEP_REVIEW,
    { config: { access: { permission: REVIEW }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { transformationId, stepKey } = parse(sParams, request.params, "params");
      const body = await db.transaction().execute((tx) => reviewPhaseStep(tx, request, transformationId, stepKey));
      return sendVersioned(reply, 200, body);
    },
  );

  app.get(PHASE_STEP_EVIDENCE, { config: read }, async (request) => {
    const { transformationId, stepKey } = parse(sParams, request.params, "params");
    const query = parseQuery(pageQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    await stepDefinition(db, stepKey);
    const hash = filterHash({ table: "phase_step_evidence", transformationId, stepKey });
    const after = decodeCursor(query.cursor, hash, 1);
    const step = await stepRow(db, transformationId, stepKey);
    if (!step) return { items: [], nextCursor: null };
    let q = db.selectFrom("phase_step_evidence").selectAll().where("phase_step_id", "=", step.id);
    if (after) q = q.where("id", ">", String(after[0]));
    const rows = await q
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: page.items.map(toPhaseStepEvidence), nextCursor: page.nextCursor };
  });

  app.post(
    PHASE_STEP_EVIDENCE,
    { config: { access: { permission: PROGRESS }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { transformationId, stepKey } = parse(sParams, request.params, "params");
      const body = await db
        .transaction()
        .execute((tx) => linkPhaseStepEvidence(tx, request, transformationId, stepKey));
      return sendVersioned(
        reply,
        201,
        body,
        `/api/v1/transformations/${transformationId}/phase-steps/${stepKey}/evidence/${body.id}`,
      );
    },
  );

  app.post(PHASE_STEP_EVIDENCE_REMOVE, { config: { access: { permission: PROGRESS } } }, async (request, reply) => {
    const { transformationId, stepKey, phaseStepEvidenceId } = parse(eParams, request.params, "params");
    const body = await db
      .transaction()
      .execute((tx) => removePhaseStepEvidence(tx, request, transformationId, stepKey, phaseStepEvidenceId));
    return sendVersioned(reply, 200, body);
  });

  return [
    `GET ${PHASES}`,
    `GET ${PHASE_WORKSPACE}`,
    `GET ${PHASE_STEPS}`,
    `GET ${PHASE_STEP}`,
    `PATCH ${PHASE_STEP}`,
    `POST ${PHASE_STEP_REQUEST_REVIEW}`,
    `POST ${PHASE_STEP_REVIEW}`,
    `GET ${PHASE_STEP_EVIDENCE}`,
    `POST ${PHASE_STEP_EVIDENCE}`,
    `POST ${PHASE_STEP_EVIDENCE_REMOVE}`,
  ];
}
