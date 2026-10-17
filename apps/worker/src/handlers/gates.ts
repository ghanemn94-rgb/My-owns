// gates job handlers (T-DG4-BE-K; ADR-0035 §7; p4-work-split §H H.1; stub by T-DG4-BE-A): the two consumers of the
// product-gate outbox events (REQ-S12-009, REQ-S12-010; M0229, M0230).
//
//   queue / consumer   trigger                        idempotency key (runOnce ledger)
//   gates.submitted    outbox event gate.submitted    gate.submitted:<submissionId>
//   gates.decided      outbox event gate.decided      gate.decided:<gateDecisionId>
//
// GATE.SUBMITTED -> APPROVER TASKS (REQ-S12-009 "each required approver receives exactly one task referencing the
// snapshot"). The required approvers are the configured approverUserId if set; otherwise every active user holding the
// approver role WITH gate.decide on the transformation (scoped assignments, ADR-0006 in SQL), excluding the submitter.
// One `gate_decision_due` work item each (subject gate_submission, message params {gateCode, submissionNo,
// snapshotSha256}, dedupe `gate_submission:<submissionId>:<userId>`). Open items of the superseded submission are
// cancelled. No approver found -> one inbox notification to the submitter with `routing.role_unmapped` (visible,
// never a silent skip).
//
// GATE.DECIDED -> CLOSE AND ENABLE (REQ-S12-010 "G2 approval enables Design tasks once; a conditional approval enables
// only its scope"). Every open gate_decision_due item of the submission is marked done (the decider's) or cancelled
// (the others'). When the outcome is approved: (a) with a next phase, the phase_step rows of that phase are inserted
// (not_started, enabled_by_gate_decision_id; ON CONFLICT DO NOTHING on (transformation, step)) and one
// `phase_step_enabled` item per step goes to the transformation lead, else the submitter (dedupe
// `phase_enabled:<gateDecisionId>:<stepKey>`); (b) for G5, one `scale_scope_enabled` item per APPROVED scope item for
// the initiative's executive owner, else its workstream lead, else the submitter (dedupe `scale_scope:<scopeItemId>`),
// and one `gate_condition_due` item per condition for its owner with its due date (dedupe `gate_condition:<conditionId>`).
// Nothing outside the approved scope is enabled. A redelivered event creates nothing (the ledger and the dedupe keys).
//
// The worker imports no API code (ADR-0002 rule 5; D-102): the SQL here mirrors the API's approver rule (gates.ts
// isApprover: role holder with gate.decide in scope) and the kit's createWorkItemOnce twin. A job never decides a
// business approval, never changes a gate status, and never touches the engineering delivery gates DG0-DG7.
import { insertAuditEvent, sql, type AuditActor, type Db, type Tx } from "@mth/db";
import { gateDecidedV1, gateSubmittedV1, outboxEnvelope } from "@mth/shared/schemas";
import { createWorkItemOnce, jobActor, runOnce } from "../kit.ts";
import type { JobHandler } from "./spec.ts";

export const GATE_SUBMITTED = "gate.submitted";
export const GATE_DECIDED = "gate.decided";
export const GATES_SUBMITTED_QUEUE = "gates.submitted";
export const GATES_DECIDED_QUEUE = "gates.decided";
export const GATES_SUBMITTED_CONSUMER = "gates.submitted";
export const GATES_DECIDED_CONSUMER = "gates.decided";

export const GATE_DECISION_DUE_KIND = "gate_decision_due";
export const GATE_DECISION_DUE_MESSAGE = "gates.task.gate_decision_due";
export const GATE_ROUTING_UNMAPPED_MESSAGE = "routing.role_unmapped";
export const PHASE_STEP_ENABLED_KIND = "phase_step_enabled";
export const PHASE_STEP_ENABLED_MESSAGE = "gates.task.phase_step_enabled";
export const SCALE_SCOPE_ENABLED_KIND = "scale_scope_enabled";
export const SCALE_SCOPE_ENABLED_MESSAGE = "gates.task.scale_scope_enabled";
export const GATE_CONDITION_DUE_KIND = "gate_condition_due";
export const GATE_CONDITION_DUE_MESSAGE = "gates.task.gate_condition_due";

const GATE_DECIDE = "gate.decide";

const gatePath = (transformationId: string, gateCode: string, submissionNo?: number) =>
  `/transformations/${transformationId}/gates/${gateCode}${submissionNo === undefined ? "" : `/submissions/${submissionNo}`}`;

/** The organization of a transformation. */
async function organizationOf(tx: Tx, transformationId: string): Promise<string> {
  const t = await tx
    .selectFrom("transformation")
    .select("organization_id")
    .where("id", "=", transformationId)
    .executeTakeFirstOrThrow();
  return t.organization_id;
}

/**
 * Active users holding the role `roleCode` WITH gate.decide on the transformation now (the API's holdsApproverRole over
 * scoped assignments: a transformation grant, or an inherited organization / business-unit grant).
 */
export async function approverRoleHolders(tx: Tx, transformationId: string, roleCode: string): Promise<string[]> {
  const r = await sql<{ user_id: string }>`
    SELECT DISTINCT sa.user_id
    FROM scoped_assignment sa
    JOIN role r ON r.id = sa.role_id AND r.code = ${roleCode}
    JOIN role_permission rp ON rp.role_id = r.id AND rp.permission_code = ${GATE_DECIDE}
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

/** Closes the open gate_decision_due items of a submission: `done` for `doneBy` (if given), `cancelled` for the rest. */
async function closeDecisionItems(
  tx: Tx,
  actor: AuditActor,
  organizationId: string,
  submissionId: string,
  doneBy: string | null,
): Promise<{ done: number; cancelled: number }> {
  const open = await tx
    .selectFrom("work_item")
    .selectAll()
    .where("organization_id", "=", organizationId)
    .where("kind", "=", GATE_DECISION_DUE_KIND)
    .where("subject_type", "=", "gate_submission")
    .where("subject_id", "=", submissionId)
    .where("status", "=", "open")
    .orderBy("id")
    .forUpdate()
    .execute();
  let done = 0;
  let cancelled = 0;
  for (const w of open) {
    const toDone = doneBy !== null && w.assignee_user_id === doneBy;
    await tx
      .updateTable("work_item")
      .set(
        toDone
          ? {
              status: "done",
              completed_at: sql<Date>`now()`,
              completed_by: doneBy,
              version: w.version + 1,
              updated_at: sql<Date>`now()`,
              updated_by: null,
            }
          : { status: "cancelled", version: w.version + 1, updated_at: sql<Date>`now()`, updated_by: null },
      )
      .where("id", "=", w.id)
      .execute();
    await insertAuditEvent(tx, actor, {
      action: toDone ? "work_item.complete" : "work_item.cancel",
      recordType: "work_item",
      recordId: w.id,
      organizationId: w.organization_id,
      transformationId: w.transformation_id,
      priorVersion: w.version,
      newVersion: w.version + 1,
      changes: { status: { from: "open", to: toDone ? "done" : "cancelled" } },
    });
    if (toDone) done += 1;
    else cancelled += 1;
  }
  return { done, cancelled };
}

/** One inbox notification, once per (organization, dedupe key), with its audit event (the kit's notification twin). */
async function notifyOnce(
  tx: Tx,
  actor: AuditActor,
  n: {
    organizationId: string;
    transformationId: string;
    recipientUserId: string;
    linkPath: string;
    messageKey: string;
    messageParams: Record<string, string | number | boolean | null>;
    dedupeKey: string;
  },
): Promise<boolean> {
  const id = (await sql<{ id: string }>`SELECT mth_uuid_v7() AS id`.execute(tx)).rows[0]!.id;
  const inserted = await tx
    .insertInto("inbox_notification")
    .values({
      id,
      organization_id: n.organizationId,
      transformation_id: n.transformationId,
      recipient_user_id: n.recipientUserId,
      work_item_id: null,
      link_path: n.linkPath,
      message_key: n.messageKey,
      message_params: JSON.stringify(n.messageParams),
      dedupe_key: n.dedupeKey,
      created_by: null,
      updated_by: null,
    })
    .onConflict((oc) => oc.columns(["organization_id", "dedupe_key"]).doNothing())
    .returning("id")
    .executeTakeFirst();
  if (!inserted) return false;
  await insertAuditEvent(tx, actor, {
    action: "inbox_notification.create",
    recordType: "inbox_notification",
    recordId: id,
    organizationId: n.organizationId,
    transformationId: n.transformationId,
    newVersion: 1,
    changes: {
      recipient_user_id: { from: null, to: n.recipientUserId },
      dedupe_key: { from: null, to: n.dedupeKey },
    },
  });
  return true;
}

// ------------------------------------------------------------------------------------------------ gate.submitted

export interface GateSubmittedResult {
  readonly outcome: "done" | "duplicate";
  readonly approverUserIds: readonly string[];
  readonly created: number;
  readonly cancelled: number;
  readonly unmapped: boolean;
}

export async function handleGateSubmitted(db: Db, data: unknown, jobId: string): Promise<GateSubmittedResult> {
  const envelope = outboxEnvelope.parse(data);
  if (envelope.eventType !== GATE_SUBMITTED)
    throw new Error(`${GATES_SUBMITTED_CONSUMER}: unexpected event ${envelope.eventType}`);
  const p = gateSubmittedV1.parse(envelope.payload);
  const actor = jobActor(jobId);
  const r = await runOnce(db, GATES_SUBMITTED_CONSUMER, envelope.idempotencyKey, async (tx) => {
    const organizationId = await organizationOf(tx, p.transformationId);
    const cancelled =
      p.supersededSubmissionId === null
        ? 0
        : (await closeDecisionItems(tx, actor, organizationId, p.supersededSubmissionId, null)).cancelled;
    const approvers = (
      p.approverUserId !== null
        ? [p.approverUserId]
        : await approverRoleHolders(tx, p.transformationId, p.approverRoleCode)
    ).filter((u) => u !== p.submittedBy);
    let created = 0;
    for (const userId of approvers) {
      const w = await createWorkItemOnce(tx, actor, {
        organizationId,
        transformationId: p.transformationId,
        kind: GATE_DECISION_DUE_KIND,
        assigneeUserId: userId,
        subjectType: "gate_submission",
        subjectId: p.submissionId,
        linkPath: gatePath(p.transformationId, p.gateCode, p.submissionNo),
        messageKey: GATE_DECISION_DUE_MESSAGE,
        messageParams: { gateCode: p.gateCode, submissionNo: p.submissionNo, snapshotSha256: p.snapshotSha256 },
        dedupeKey: `gate_submission:${p.submissionId}:${userId}`,
      });
      if (w.outcome === "created") created += 1;
    }
    let unmapped = false;
    if (approvers.length === 0) {
      unmapped = true;
      await notifyOnce(tx, actor, {
        organizationId,
        transformationId: p.transformationId,
        recipientUserId: p.submittedBy,
        linkPath: gatePath(p.transformationId, p.gateCode, p.submissionNo),
        messageKey: GATE_ROUTING_UNMAPPED_MESSAGE,
        messageParams: { gateCode: p.gateCode, submissionNo: p.submissionNo, roleCode: p.approverRoleCode },
        dedupeKey: `gate_submission_unrouted:${p.submissionId}`,
      });
    }
    return { approverUserIds: approvers, created, cancelled, unmapped };
  });
  return r.outcome === "duplicate"
    ? { outcome: "duplicate", approverUserIds: [], created: 0, cancelled: 0, unmapped: false }
    : { outcome: "done", ...r.result };
}

// ------------------------------------------------------------------------------------------------ gate.decided

export interface GateDecidedResult {
  readonly outcome: "done" | "duplicate";
  readonly closedDone: number;
  readonly closedCancelled: number;
  readonly stepsInserted: number;
  readonly phaseStepItems: number;
  readonly scopeItems: number;
  readonly conditionItems: number;
}

export async function handleGateDecided(db: Db, data: unknown, jobId: string): Promise<GateDecidedResult> {
  const envelope = outboxEnvelope.parse(data);
  if (envelope.eventType !== GATE_DECIDED)
    throw new Error(`${GATES_DECIDED_CONSUMER}: unexpected event ${envelope.eventType}`);
  const p = gateDecidedV1.parse(envelope.payload);
  const actor = jobActor(jobId);
  const r = await runOnce(db, GATES_DECIDED_CONSUMER, envelope.idempotencyKey, async (tx) => {
    const organizationId = await organizationOf(tx, p.transformationId);
    const closed = await closeDecisionItems(tx, actor, organizationId, p.submissionId, p.decidedBy);
    let stepsInserted = 0;
    let phaseStepItems = 0;
    let scopeItems = 0;
    let conditionItems = 0;
    if (p.outcome === "approved") {
      const submission = await tx
        .selectFrom("gate_submission")
        .select("submitted_by")
        .where("id", "=", p.submissionId)
        .executeTakeFirstOrThrow();
      const t = await tx
        .selectFrom("transformation")
        .select("lead_user_id")
        .where("id", "=", p.transformationId)
        .executeTakeFirstOrThrow();
      // (a) the next phase's steps (rows and one task per step), once.
      if (p.nextPhase !== null) {
        const steps = await tx
          .selectFrom("phase_step_definition")
          .select(["key", "phase_code", "ordinal"])
          .where("phase_code", "=", p.nextPhase)
          .orderBy("ordinal")
          .execute();
        const stepOwner = t.lead_user_id ?? submission.submitted_by;
        for (const s of steps) {
          const id = (await sql<{ id: string }>`SELECT mth_uuid_v7() AS id`.execute(tx)).rows[0]!.id;
          const inserted = await tx
            .insertInto("phase_step")
            .values({
              id,
              organization_id: organizationId,
              transformation_id: p.transformationId,
              step_key: s.key,
              phase_code: s.phase_code,
              status: "not_started",
              enabled_by_gate_decision_id: p.gateDecisionId,
              created_by: null,
              updated_by: null,
            })
            .onConflict((oc) => oc.constraint("phase_step_key").doNothing())
            .returning("id")
            .executeTakeFirst();
          if (inserted) {
            stepsInserted += 1;
            await insertAuditEvent(tx, actor, {
              action: "phase_step.enable",
              recordType: "phase_step",
              recordId: id,
              organizationId,
              transformationId: p.transformationId,
              newVersion: 1,
              changes: {
                step_key: { from: null, to: s.key },
                enabled_by_gate_decision_id: { from: null, to: p.gateDecisionId },
              },
            });
          }
          const stepId =
            inserted?.id ??
            (
              await tx
                .selectFrom("phase_step")
                .select("id")
                .where("transformation_id", "=", p.transformationId)
                .where("step_key", "=", s.key)
                .executeTakeFirstOrThrow()
            ).id;
          const w = await createWorkItemOnce(tx, actor, {
            organizationId,
            transformationId: p.transformationId,
            kind: PHASE_STEP_ENABLED_KIND,
            assigneeUserId: stepOwner,
            subjectType: "phase_step",
            subjectId: stepId,
            linkPath: `/transformations/${p.transformationId}/phases/${s.phase_code}/steps/${s.key}`,
            messageKey: PHASE_STEP_ENABLED_MESSAGE,
            messageParams: { gateCode: p.gateCode, phaseCode: s.phase_code, stepKey: s.key },
            dedupeKey: `phase_enabled:${p.gateDecisionId}:${s.key}`,
          });
          if (w.outcome === "created") phaseStepItems += 1;
        }
      }
      // (b) G5: only the approved scope items and conditions named in the event (ADR-0035 §5, §7).
      if (p.gateCode === "G5") {
        if (p.scaleScopeItemIds.length > 0) {
          const items = await tx
            .selectFrom("gate_decision_scale_scope as s")
            .innerJoin("initiative as i", "i.id", "s.initiative_id")
            .select([
              "s.id",
              "s.initiative_id",
              "s.business_unit_id",
              "i.code",
              "i.executive_owner_user_id",
              "i.workstream_lead_user_id",
            ])
            .where("s.gate_decision_id", "=", p.gateDecisionId)
            .where("s.id", "in", [...p.scaleScopeItemIds])
            .orderBy("s.id")
            .execute();
          for (const it of items) {
            const w = await createWorkItemOnce(tx, actor, {
              organizationId,
              transformationId: p.transformationId,
              kind: SCALE_SCOPE_ENABLED_KIND,
              assigneeUserId: it.executive_owner_user_id ?? it.workstream_lead_user_id ?? submission.submitted_by,
              subjectType: "gate_decision_scale_scope",
              subjectId: it.id,
              linkPath: `/transformations/${p.transformationId}/scale-scope`,
              messageKey: SCALE_SCOPE_ENABLED_MESSAGE,
              messageParams: {
                initiativeCode: it.code,
                initiativeId: it.initiative_id,
                businessUnitId: it.business_unit_id,
              },
              dedupeKey: `scale_scope:${it.id}`,
            });
            if (w.outcome === "created") scopeItems += 1;
          }
        }
        if (p.conditionIds.length > 0) {
          const conditions = await tx
            .selectFrom("gate_decision_condition")
            .select(["id", "ordinal", "owner_user_id", sql<string>`due_date::text`.as("due")])
            .where("gate_decision_id", "=", p.gateDecisionId)
            .where("id", "in", [...p.conditionIds])
            .orderBy("ordinal")
            .execute();
          for (const c of conditions) {
            const w = await createWorkItemOnce(tx, actor, {
              organizationId,
              transformationId: p.transformationId,
              kind: GATE_CONDITION_DUE_KIND,
              assigneeUserId: c.owner_user_id,
              subjectType: "gate_decision_condition",
              subjectId: c.id,
              linkPath: `/transformations/${p.transformationId}/scale-scope`,
              messageKey: GATE_CONDITION_DUE_MESSAGE,
              messageParams: { gateCode: p.gateCode, ordinal: c.ordinal },
              dueDate: c.due,
              dedupeKey: `gate_condition:${c.id}`,
            });
            if (w.outcome === "created") conditionItems += 1;
          }
        }
      }
    }
    return {
      closedDone: closed.done,
      closedCancelled: closed.cancelled,
      stepsInserted,
      phaseStepItems,
      scopeItems,
      conditionItems,
    };
  });
  return r.outcome === "duplicate"
    ? {
        outcome: "duplicate",
        closedDone: 0,
        closedCancelled: 0,
        stepsInserted: 0,
        phaseStepItems: 0,
        scopeItems: 0,
        conditionItems: 0,
      }
    : { outcome: "done", ...r.result };
}

// ------------------------------------------------------------------------------------------------ BE-K2: expiry scan
// T-DG4-BE-K2 (ADR-0035 §4 "Expiry notification"; REQ-S04-013 "an expired waiver no longer satisfies the item and the
// owner is notified"; p4-work-split §H H.2). The daily job gate.exception_expiry_scan (0054, 00:30 Asia/Riyadh) selects
// the ACCEPTED exceptions whose expires_on is before today's business date (the transformation's timezone, or the
// injected `asOf`) and whose expiry_notified_at is NULL, and per exception in one runOnce transaction (key
// gate.exception_expired:<exceptionId>): one `gate_exception_expired` work item for the requester (dedupe
// gate_exception_expired:<exceptionId>; it carries the requester's inbox notification), one inbox notification to each
// gate approver (the configured user, else the approver-role holders with gate.decide; dedupe
// gate_exception_expired:<exceptionId>:approver:<userId>), and expiry_notified_at set once (0051 trigger
// gate_exception_expiry_notified_once). The job ONLY notifies: it changes no exception status and no gate, decides no
// business approval, and the criterion is missing again on the day after expires_on whether or not it has run.

export const GATE_EXCEPTION_EXPIRY_SCAN_QUEUE = "gate.exception_expiry_scan";
export const GATE_EXCEPTION_EXPIRED_KIND = "gate_exception_expired";
export const GATE_EXCEPTION_EXPIRED_MESSAGE = "gates.task.gate_exception_expired";
export const GATE_EXCEPTION_EXPIRED_NOTICE = "gates.notice.gate_exception_expired";

export interface ExpiryScanOptions {
  /** The business date the scan treats as today for every transformation (tests, an operator's catch-up). */
  readonly asOf?: string;
}

export interface ExpiryScanStep {
  readonly exceptionId: string;
  readonly outcome: "notified" | "duplicate" | "skipped";
  readonly approverUserIds: readonly string[];
}

export interface ExpiryScanResult {
  readonly steps: readonly ExpiryScanStep[];
  readonly notified: number;
}

/**
 * T-DG5-BE-C3 (F-DG5-QA-A-1; ADR-0039 §3): the EFFECTIVE approver of one gate instance, the SQL twin of the API's
 * `routedApproverOf` (workflows/gates.ts; the worker imports no API code). The gate's default approver in the
 * transformation's pinned methodology version is the version's `gate` row value when it is a string inside the DG2
 * allowed set, else the catalogue default (workflows/criteria.ts `resolveGateDefinitions`); with no pin, version 1 of
 * `playbook` (ConfigResolver `pinnedVersion`). A gate whose approver was never configured (no named user, the catalogue
 * default role) follows that default; a configured approver, and every v1-pinned transformation, keep the stored one.
 * An instance whose approver was set through the approver configuration (`approver_configured`, 0094) keeps it too.
 */
export async function effectiveGateApproverOf(
  tx: Tx,
  gateInstanceId: string,
): Promise<{ transformationId: string; roleCode: string; userId: string | null }> {
  const r = await sql<{
    transformation_id: string;
    approver_role_code: string;
    approver_user_id: string | null;
    approver_configured: boolean;
    catalogue_default: string;
    allowed: string[];
    pinned_default: string | null;
  }>`
    SELECT i.transformation_id, i.approver_role_code, i.approver_user_id, i.approver_configured,
           g.default_approver_role_code AS catalogue_default, g.allowed_approver_role_codes AS allowed,
           (SELECT CASE WHEN jsonb_typeof(e.attributes -> 'defaultApproverRoleCode') = 'string'
                        THEN e.attributes ->> 'defaultApproverRoleCode' END
              FROM methodology_element e
             WHERE e.element_type = 'gate' AND e.stable_key = i.gate_code AND e.origin = 'source'
               AND e.methodology_version_id = COALESCE(
                 (SELECT p.methodology_version_id FROM transformation_config_pin p
                   WHERE p.transformation_id = i.transformation_id AND p.kind = 'methodology'),
                 (SELECT v.id FROM methodology_version v
                   WHERE v.config_kind = 'methodology' AND v.key = 'playbook' AND v.version_no = 1))) AS pinned_default
    FROM gate_instance i
    JOIN gate_definition g ON g.code = i.gate_code
    WHERE i.id = ${gateInstanceId}::uuid`.execute(tx);
  const i = r.rows[0];
  if (i === undefined) throw new Error(`gate instance ${gateInstanceId} not found`);
  const resolved =
    i.pinned_default !== null && i.allowed.includes(i.pinned_default) ? i.pinned_default : i.catalogue_default;
  // T-DG5-BE-C4 (D-164 b; 0094): an explicitly configured approver is kept, as in the API's routedApproverOf.
  const follows = !i.approver_configured && i.approver_user_id === null && i.approver_role_code === i.catalogue_default;
  return {
    transformationId: i.transformation_id,
    roleCode: follows ? resolved : i.approver_role_code,
    userId: i.approver_user_id,
  };
}

/** The gate approvers of one gate instance: the configured user, else the approver-role holders (API isGateApprover). */
async function gateApprovers(tx: Tx, gateInstanceId: string): Promise<string[]> {
  const i = await effectiveGateApproverOf(tx, gateInstanceId);
  if (i.userId !== null) return [i.userId];
  return approverRoleHolders(tx, i.transformationId, i.roleCode);
}

export async function runGateExceptionExpiryScan(
  db: Db,
  jobId: string,
  opts: ExpiryScanOptions = {},
): Promise<ExpiryScanResult> {
  const actor = jobActor(jobId);
  const today =
    opts.asOf !== undefined ? sql<string>`${opts.asOf}::date` : sql<string>`p4_business_date(now(), t.timezone)`;
  const due = await db
    .selectFrom("gate_exception as e")
    .innerJoin("transformation as t", "t.id", "e.transformation_id")
    .select("e.id")
    .where("e.status", "=", "accepted")
    .where("e.expiry_notified_at", "is", null)
    .where(sql<boolean>`e.expires_on < ${today}`)
    .orderBy("e.id")
    .execute();
  const steps: ExpiryScanStep[] = [];
  for (const { id } of due) {
    const r = await runOnce(db, GATE_EXCEPTION_EXPIRY_SCAN_QUEUE, `gate.exception_expired:${id}`, async (tx) => {
      const e = await tx
        .selectFrom("gate_exception")
        .select([
          "id",
          "organization_id",
          "transformation_id",
          "gate_instance_id",
          "gate_code",
          "criterion_key",
          "requested_by",
          "status",
          "expiry_notified_at",
          "version",
          sql<string>`expires_on::text`.as("expires_on"),
        ])
        .where("id", "=", id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      // Revoked meanwhile, or already notified: nothing to do (the ledger still records the key).
      if (e.status !== "accepted" || e.expiry_notified_at !== null) return null;
      const linkPath = `/transformations/${e.transformation_id}/gate-exceptions/${e.id}`;
      const params = { gateCode: e.gate_code, criterionKey: e.criterion_key, expiresOn: e.expires_on };
      await createWorkItemOnce(tx, actor, {
        organizationId: e.organization_id,
        transformationId: e.transformation_id,
        kind: GATE_EXCEPTION_EXPIRED_KIND,
        assigneeUserId: e.requested_by,
        subjectType: "gate_exception",
        subjectId: e.id,
        linkPath,
        messageKey: GATE_EXCEPTION_EXPIRED_MESSAGE,
        messageParams: params,
        dedupeKey: `gate_exception_expired:${e.id}`,
      });
      const approvers = await gateApprovers(tx, e.gate_instance_id);
      for (const userId of approvers)
        await notifyOnce(tx, actor, {
          organizationId: e.organization_id,
          transformationId: e.transformation_id,
          recipientUserId: userId,
          linkPath,
          messageKey: GATE_EXCEPTION_EXPIRED_NOTICE,
          messageParams: params,
          dedupeKey: `gate_exception_expired:${e.id}:approver:${userId}`,
        });
      // updated_by keeps the last person who changed the row (a job is not a person; the audit actor is `service`).
      const marked = await tx
        .updateTable("gate_exception")
        .set({ expiry_notified_at: sql<Date>`now()`, version: e.version + 1, updated_at: sql<Date>`now()` })
        .where("id", "=", e.id)
        .where("version", "=", e.version)
        .returning("expiry_notified_at")
        .executeTakeFirstOrThrow();
      await insertAuditEvent(tx, actor, {
        action: "gate_exception.expiry_notified",
        recordType: "gate_exception",
        recordId: e.id,
        organizationId: e.organization_id,
        transformationId: e.transformation_id,
        priorVersion: e.version,
        newVersion: e.version + 1,
        changes: { expiry_notified_at: { from: null, to: marked.expiry_notified_at?.toISOString() ?? null } },
      });
      return approvers;
    });
    if (r.outcome === "duplicate") steps.push({ exceptionId: id, outcome: "duplicate", approverUserIds: [] });
    else if (r.result === null) steps.push({ exceptionId: id, outcome: "skipped", approverUserIds: [] });
    else steps.push({ exceptionId: id, outcome: "notified", approverUserIds: r.result });
  }
  return { steps, notified: steps.filter((s) => s.outcome === "notified").length };
}

// ------------------------------------------------------------------------------------------------ BE-K: condition escalation
// T-DG5-BE-K (ADR-0044 §3 "Overdue conditions escalate"; REQ-S04-011 "overdue conditions escalate"; p5-work-split §E.2).
// The daily job gate.condition_escalation_scan (0075, 01:00 Asia/Riyadh) selects every condition of a conditional
// approval that is still OPEN (no closure row), not yet escalated, and whose due date is before today's business date
// in its transformation's time zone (or the injected `asOf`). Per condition, in one runOnce transaction (key
// gate.condition_escalation:<conditionId>): one gate_condition_escalation row (overdue_since = due date + 1, escalated to
// the G5 decision's approver gate_decision.decided_by; UNIQUE per condition, the 0075 guard refuses a closed one) with
// its audit event, and one URGENT `gate_condition_overdue` work item (with its notification) to that approver (dedupe
// gate_condition_overdue:<conditionId>). Once: the ledger, the UNIQUE key and the dedupe key. The escalation informs;
// it closes nothing, changes no gate or scope and decides no business approval.

export const GATE_CONDITION_ESCALATION_SCAN_QUEUE = "gate.condition_escalation_scan";
export const GATE_CONDITION_OVERDUE_KIND = "gate_condition_overdue";
export const GATE_CONDITION_OVERDUE_MESSAGE = "gates.task.gate_condition_overdue";

export interface ConditionEscalationStep {
  readonly conditionId: string;
  readonly outcome: "escalated" | "duplicate" | "skipped";
  readonly escalatedToUserId: string | null;
}

export interface ConditionEscalationOptions extends ExpiryScanOptions {
  /** Scope one run to one transformation (an operator's catch-up, or a test); the schedule sends nothing. */
  readonly transformationId?: string;
}

export interface ConditionEscalationResult {
  readonly steps: readonly ConditionEscalationStep[];
  readonly escalated: number;
}

export async function runGateConditionEscalationScan(
  db: Db,
  jobId: string,
  opts: ConditionEscalationOptions = {},
): Promise<ConditionEscalationResult> {
  const actor = jobActor(jobId);
  const today =
    opts.asOf !== undefined ? sql<string>`${opts.asOf}::date` : sql<string>`p4_business_date(now(), t.timezone)`;
  const due = await db
    .selectFrom("gate_decision_condition as c")
    .innerJoin("transformation as t", "t.id", "c.transformation_id")
    .select("c.id")
    .where(sql<boolean>`c.due_date < ${today}`)
    .$if(opts.transformationId !== undefined, (q) => q.where("c.transformation_id", "=", opts.transformationId!))
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom("gate_condition_closure as z")
            .select("z.id")
            .whereRef("z.gate_decision_condition_id", "=", "c.id"),
        ),
      ),
    )
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom("gate_condition_escalation as e")
            .select("e.id")
            .whereRef("e.gate_decision_condition_id", "=", "c.id"),
        ),
      ),
    )
    .orderBy("c.due_date")
    .orderBy("c.id")
    .execute();
  const steps: ConditionEscalationStep[] = [];
  for (const { id } of due) {
    const r = await runOnce(db, GATE_CONDITION_ESCALATION_SCAN_QUEUE, `gate.condition_escalation:${id}`, async (tx) => {
      const c = await tx
        .selectFrom("gate_decision_condition as c")
        .innerJoin("gate_decision as d", "d.id", "c.gate_decision_id")
        .select([
          "c.id",
          "c.organization_id",
          "c.transformation_id",
          "c.ordinal",
          "c.owner_user_id",
          "d.gate_code",
          "d.decided_by",
          sql<string>`c.due_date::text`.as("due_date"),
          sql<string>`(c.due_date + 1)::text`.as("overdue_since"),
        ])
        .where("c.id", "=", id)
        .executeTakeFirstOrThrow();
      // Closed or escalated meanwhile: nothing to do (the ledger still records the key).
      const closed = await tx
        .selectFrom("gate_condition_closure")
        .select("id")
        .where("gate_decision_condition_id", "=", id)
        .executeTakeFirst();
      const escalated = await tx
        .selectFrom("gate_condition_escalation")
        .select("id")
        .where("gate_decision_condition_id", "=", id)
        .executeTakeFirst();
      if (closed || escalated) return null;
      const linkPath = `/transformations/${c.transformation_id}/gate-conditions`;
      const w = await createWorkItemOnce(tx, actor, {
        organizationId: c.organization_id,
        transformationId: c.transformation_id,
        kind: GATE_CONDITION_OVERDUE_KIND,
        assigneeUserId: c.decided_by,
        subjectType: "gate_decision_condition",
        subjectId: c.id,
        linkPath,
        messageKey: GATE_CONDITION_OVERDUE_MESSAGE,
        messageParams: { gateCode: c.gate_code, ordinal: c.ordinal, dueDate: c.due_date },
        dedupeKey: `gate_condition_overdue:${c.id}`,
      });
      const escalationId = (await sql<{ id: string }>`SELECT mth_uuid_v7() AS id`.execute(tx)).rows[0]!.id;
      await tx
        .insertInto("gate_condition_escalation")
        .values({
          id: escalationId,
          organization_id: c.organization_id,
          transformation_id: c.transformation_id,
          gate_decision_condition_id: c.id,
          overdue_since: c.overdue_since,
          escalated_to_user_id: c.decided_by,
          work_item_id: w.workItemId,
          created_by: null,
        })
        .execute();
      await insertAuditEvent(tx, actor, {
        action: "gate_condition_escalation.create",
        recordType: "gate_condition_escalation",
        recordId: escalationId,
        organizationId: c.organization_id,
        transformationId: c.transformation_id,
        newVersion: 1,
        changes: {
          gate_decision_condition_id: { from: null, to: c.id },
          overdue_since: { from: null, to: c.overdue_since },
          escalated_to_user_id: { from: null, to: c.decided_by },
        },
      });
      return c.decided_by;
    });
    if (r.outcome === "duplicate") steps.push({ conditionId: id, outcome: "duplicate", escalatedToUserId: null });
    else if (r.result === null) steps.push({ conditionId: id, outcome: "skipped", escalatedToUserId: null });
    else steps.push({ conditionId: id, outcome: "escalated", escalatedToUserId: r.result });
  }
  return { steps, escalated: steps.filter((s) => s.outcome === "escalated").length };
}

export const GATES_HANDLERS: readonly JobHandler[] = [
  { queue: GATES_SUBMITTED_QUEUE, handle: handleGateSubmitted },
  { queue: GATES_DECIDED_QUEUE, handle: handleGateDecided },
  // T-DG4-BE-K2: started by its job_schedule row (0054); it consumes no outbox event.
  { queue: GATE_EXCEPTION_EXPIRY_SCAN_QUEUE, handle: (db, _data, jobId) => runGateExceptionExpiryScan(db, jobId) },
  // T-DG5-BE-K (ADR-0044 §3): started by its job_schedule row (0075); it consumes no outbox event.
  {
    queue: GATE_CONDITION_ESCALATION_SCAN_QUEUE,
    handle: (db, _data, jobId) => runGateConditionEscalationScan(db, jobId),
  },
];
