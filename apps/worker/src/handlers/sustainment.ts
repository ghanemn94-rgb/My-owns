// sustainment job handlers (T-DG4-BE-I2; p4-work-split §F+G FG.5; stub by T-DG4-BE-A): the two daily scans of slice G
// (ADR-0034 §6; REQ-S11-004 "after closure, the next scheduled review task is created on time", REQ-S03-002 "after a
// transformation is closed its linked performance area still generates scheduled review tasks", REQ-PB-083 "recurring
// BAU reviews", REQ-S11-008 "Control check due -> task"). Schedules seeded by 0050 (Asia/Riyadh default).
//
//   queue / consumer                  trigger          idempotency key (runOnce, one transaction per subject and slot)
//   sustainment.review_scan           daily schedule   review:<areaId>:v<area version>:<dueDate>
//   sustainment.control_check_scan    daily schedule   check:<controlId>:v<control version>:<dueDate>
//
// review_scan: for every performance area in BAU whose next_review_date <= the organization's business date + 7 days
// (its default calendar's timezone, else its default timezone), insert the review for next_review_date if absent
// (scheduleAreaReviewInTx; the unique key sustainment_review_due_key is the second line of defence), with its
// `performance_review_due` work item for the BAU owner, then advance next_review_date by one review period
// (review_frequency x review_interval, calendar weeks or months; version + 1, audited as the service). A due date that
// is still inside the window after the step (a worker outage) is processed in the same run, so the run catches up. The
// scan NEVER reads the transformation's status: after closure the area's reviews keep coming (REQ-S11-004, S03-002).
// The transition-decision part (benefit monitoring; T-DG4-BE-J, p4-work-split FG.6) runs after the area part in the
// same job: runMonitoringScan, below BE-I2's scans.
//
// control_check_scan: for every active control of a non-retired area whose next_check_date <= today + 7 days, insert
// the check for that date if absent (control_check_due_key), assignee = the control's owner, else the area's BAU owner,
// else none (unassigned: no work item, never a guessed person); with the `control_check_due` work item (dedupe
// `sustainment.control_check:<checkId>`), then advance next_check_date by one period (version + 1, audited).
//
// The run key carries the subject's version, so a rerun after the advance finds nothing due and does nothing, and a
// redelivered job is a ledger duplicate. scheduleAreaReviewInTx is the twin of the API's scheduleAreaReview
// (apps/api/src/modules/sustainment/performance-areas.ts): the worker imports no API code (ADR-0002 rule 5; D-102 (2));
// apps/api/test/integration/sustainment/controls.test.ts proves both write the same rows. The audit actor is the service
// (jobActor); a job never decides a business approval, accepts a handover or touches DG0-DG7.
import { insertAuditEvent, sql, type AuditActor, type Db, type Tx } from "@mth/db";
import { createWorkItemOnce, jobActor, runOnce } from "../kit.ts";
import type { JobHandler } from "./spec.ts";

export const REVIEW_SCAN_QUEUE = "sustainment.review_scan";
export const CONTROL_CHECK_SCAN_QUEUE = "sustainment.control_check_scan";
export const PERFORMANCE_REVIEW_TASK_KIND = "performance_review_due";
export const CONTROL_CHECK_TASK_KIND = "control_check_due";
/** A review or check is created at the latest this many calendar days before it is due (ADR-0034 §6). */
export const SCAN_HORIZON_DAYS = 7;
/** Bound on the catch-up steps for one subject in one run (a misconfigured weekly cadence after years of outage). */
const MAX_STEPS_PER_SUBJECT = 520;

/** The organization's business-date expression in SQL (default active calendar's timezone, else the organization's). */
const businessToday = (organizationIdCol: ReturnType<typeof sql.ref>) => sql<string>`p4_business_date(now(), coalesce(
  (SELECT c.timezone FROM business_calendar c
    WHERE c.organization_id = ${organizationIdCol} AND c.is_default AND c.status = 'active' LIMIT 1),
  (SELECT o.default_timezone FROM organization o WHERE o.id = ${organizationIdCol})))`;

/** One period after `date` (calendar weeks or months, never working days; the API's businessDatePlusPeriod rule). */
async function plusPeriod(tx: Tx, date: string, frequency: string, interval: number): Promise<string> {
  const months = ({ monthly: 1, quarterly: 3, semi_annual: 6, annual: 12 } as Record<string, number>)[frequency] ?? 0;
  const weeks = frequency === "weekly" ? interval : 0;
  if (months === 0 && weeks === 0) throw new Error(`sustainment scan: unknown frequency ${frequency}`);
  const r = await sql<{ d: string }>`
    SELECT (${date}::date + make_interval(months => ${months * interval}::int, weeks => ${weeks}::int))::date::text AS d`.execute(
    tx,
  );
  return r.rows[0]!.d;
}

async function uuidv7(tx: Tx): Promise<string> {
  const r = await sql<{ id: string }>`SELECT mth_uuid_v7() AS id`.execute(tx);
  return r.rows[0]!.id;
}

// ------------------------------------------------------------------------------------------------ the review twin

export interface ScheduledReview {
  readonly outcome: "created" | "existing";
  readonly reviewId: string;
}

/**
 * The twin of the API's scheduleAreaReview: inserts the area review due on `dueDate` once (subject performance_area, the
 * area's current cycle, assignee its BAU owner) with its audit event and its `performance_review_due` work item (dedupe
 * `sustainment.review:<areaId>:<dueDate>`); a second call for the same area and date returns `existing`.
 */
export async function scheduleAreaReviewInTx(
  tx: Tx,
  actor: AuditActor,
  areaId: string,
  dueDate: string,
): Promise<ScheduledReview> {
  const area = await tx
    .selectFrom("performance_area")
    .select(["id", "organization_id", "transformation_id", "code", "cycle_no", "bau_owner_user_id"])
    .where("id", "=", areaId)
    .executeTakeFirstOrThrow();
  if (area.bau_owner_user_id === null) throw new Error(`scheduleAreaReview: area ${areaId} has no BAU owner`);
  const byUser = actor.actorType === "user" ? actor.actorUserId : null;
  const id = await uuidv7(tx);
  const inserted = await sql<{ id: string }>`
    INSERT INTO sustainment_review (id, organization_id, transformation_id, subject_kind, performance_area_id, cycle_no,
                                    due_date, assignee_user_id, created_source, created_by, updated_by)
    VALUES (${id}::uuid, ${area.organization_id}::uuid, ${area.transformation_id}::uuid, 'performance_area',
            ${area.id}::uuid, ${area.cycle_no}, ${dueDate}::date, ${area.bau_owner_user_id}::uuid,
            ${byUser === null ? "worker" : "api"}, ${byUser}::uuid, ${byUser}::uuid)
    ON CONFLICT (subject_kind, (coalesce(performance_area_id, transition_decision_id)), due_date) DO NOTHING
    RETURNING id`.execute(tx);
  if (inserted.rows.length === 0) {
    const existing = await tx
      .selectFrom("sustainment_review")
      .select("id")
      .where("subject_kind", "=", "performance_area")
      .where("performance_area_id", "=", area.id)
      .where("due_date", "=", dueDate)
      .executeTakeFirstOrThrow();
    return { outcome: "existing", reviewId: existing.id };
  }
  await insertAuditEvent(tx, actor, {
    action: "sustainment_review.create",
    recordType: "sustainment_review",
    recordId: id,
    organizationId: area.organization_id,
    transformationId: area.transformation_id,
    newVersion: 1,
    changes: {
      subject_kind: { from: null, to: "performance_area" },
      performance_area_id: { from: null, to: area.id },
      cycle_no: { from: null, to: area.cycle_no },
      due_date: { from: null, to: dueDate },
      assignee_user_id: { from: null, to: area.bau_owner_user_id },
    },
  });
  await createWorkItemOnce(tx, actor, {
    organizationId: area.organization_id,
    transformationId: area.transformation_id,
    kind: PERFORMANCE_REVIEW_TASK_KIND,
    assigneeUserId: area.bau_owner_user_id,
    subjectType: "sustainment_review",
    subjectId: id,
    linkPath: `/transformations/${area.transformation_id}/performance-areas/${area.id}`,
    messageKey: "sustainment.task.performance_review_due",
    messageParams: { areaCode: area.code, dueDate },
    dueDate,
    dedupeKey: `sustainment.review:${area.id}:${dueDate}`,
  });
  return { outcome: "created", reviewId: id };
}

// ------------------------------------------------------------------------------------------------ scans

export interface ScanOptions {
  /**
   * The business date the scan treats as today, for every organization (tests and an operator's catch-up). Absent:
   * each organization's own business date now.
   */
  readonly asOf?: string;
  /** Scan one organization only (an operator's targeted run). Absent: every organization. */
  readonly organizationId?: string;
}

export interface ScanStep {
  readonly subjectId: string;
  readonly dueDate: string;
  readonly outcome: "created" | "existing" | "duplicate" | "skipped";
  /** The review or check id, when one was created or found. */
  readonly recordId: string | null;
}

export interface ScanResult {
  readonly steps: readonly ScanStep[];
  readonly created: number;
}

const summarize = (steps: ScanStep[]): ScanResult => ({
  steps,
  created: steps.filter((s) => s.outcome === "created").length,
});

/** The horizon (today + 7) per subject's organization, or the injected one. */
const horizonExpr = (opts: ScanOptions, organizationIdCol: ReturnType<typeof sql.ref>) =>
  opts.asOf !== undefined
    ? sql<string>`(${opts.asOf}::date + ${SCAN_HORIZON_DAYS}::int)`
    : sql<string>`(${businessToday(organizationIdCol)} + ${SCAN_HORIZON_DAYS}::int)`;

/** sustainment.review_scan: the next review of every area in BAU, once per due date (see the file header). */
export async function runReviewScan(db: Db, jobId: string, opts: ScanOptions = {}): Promise<ScanResult> {
  const actor = jobActor(jobId);
  const due = await db
    .selectFrom("performance_area as a")
    .select([
      "a.id",
      "a.version",
      sql<string>`a.next_review_date::text`.as("due"),
      sql<string>`(${horizonExpr(opts, sql.ref("a.organization_id"))})::text`.as("horizon"),
    ])
    .where("a.status", "=", "bau")
    .$if(opts.organizationId !== undefined, (q) => q.where("a.organization_id", "=", opts.organizationId!))
    .where("a.next_review_date", "is not", null)
    .where(sql<boolean>`a.next_review_date <= ${horizonExpr(opts, sql.ref("a.organization_id"))}`)
    .orderBy("a.id")
    .execute();
  const steps: ScanStep[] = [];
  for (const area of due) {
    const horizon = area.horizon;
    let version = area.version;
    let dueDate = area.due;
    for (let i = 0; i < MAX_STEPS_PER_SUBJECT && dueDate <= horizon; i += 1) {
      const key = `review:${area.id}:v${version}:${dueDate}`;
      const r = await runOnce(db, REVIEW_SCAN_QUEUE, key, async (tx) => {
        const a = await tx
          .selectFrom("performance_area")
          .select([
            "id",
            "organization_id",
            "transformation_id",
            "status",
            "version",
            "review_frequency",
            "review_interval",
          ])
          .select(sql<string | null>`next_review_date::text`.as("next_review_date"))
          .where("id", "=", area.id)
          .forUpdate()
          .executeTakeFirstOrThrow();
        if (a.status !== "bau" || a.version !== version || a.next_review_date !== dueDate) return null;
        const scheduled = await scheduleAreaReviewInTx(tx, actor, a.id, dueDate);
        const next = await plusPeriod(tx, dueDate, a.review_frequency, a.review_interval);
        await tx
          .updateTable("performance_area")
          .set({
            next_review_date: next,
            version: sql<number>`version + 1`,
            updated_at: sql<Date>`now()`,
            updated_by: null,
          })
          .where("id", "=", a.id)
          .where("version", "=", a.version)
          .executeTakeFirstOrThrow();
        await insertAuditEvent(tx, actor, {
          action: "performance_area.review_scheduled",
          recordType: "performance_area",
          recordId: a.id,
          organizationId: a.organization_id,
          transformationId: a.transformation_id,
          priorVersion: a.version,
          newVersion: a.version + 1,
          changes: { next_review_date: { from: dueDate, to: next } },
        });
        return { scheduled, next, version: a.version + 1 };
      });
      if (r.outcome === "duplicate") {
        steps.push({ subjectId: area.id, dueDate, outcome: "duplicate", recordId: null });
        break;
      }
      if (r.result === null) {
        steps.push({ subjectId: area.id, dueDate, outcome: "skipped", recordId: null });
        break;
      }
      steps.push({
        subjectId: area.id,
        dueDate,
        outcome: r.result.scheduled.outcome,
        recordId: r.result.scheduled.reviewId,
      });
      version = r.result.version;
      dueDate = r.result.next;
    }
  }
  return summarize(steps);
}

/** sustainment.control_check_scan: the next check of every active control, once per due date (see the file header). */
export async function runControlCheckScan(db: Db, jobId: string, opts: ScanOptions = {}): Promise<ScanResult> {
  const actor = jobActor(jobId);
  const due = await db
    .selectFrom("control as c")
    .innerJoin("performance_area as a", "a.id", "c.performance_area_id")
    .select([
      "c.id",
      "c.version",
      sql<string>`c.next_check_date::text`.as("due"),
      sql<string>`(${horizonExpr(opts, sql.ref("c.organization_id"))})::text`.as("horizon"),
    ])
    .where("c.status", "=", "active")
    .$if(opts.organizationId !== undefined, (q) => q.where("c.organization_id", "=", opts.organizationId!))
    .where("a.status", "<>", "retired")
    .where("c.next_check_date", "is not", null)
    .where(sql<boolean>`c.next_check_date <= ${horizonExpr(opts, sql.ref("c.organization_id"))}`)
    .orderBy("c.id")
    .execute();
  const steps: ScanStep[] = [];
  for (const control of due) {
    const horizon = control.horizon;
    let version = control.version;
    let dueDate = control.due;
    for (let i = 0; i < MAX_STEPS_PER_SUBJECT && dueDate <= horizon; i += 1) {
      const key = `check:${control.id}:v${version}:${dueDate}`;
      const r = await runOnce(db, CONTROL_CHECK_SCAN_QUEUE, key, async (tx) => {
        const c = await tx
          .selectFrom("control")
          .select([
            "id",
            "organization_id",
            "transformation_id",
            "performance_area_id",
            "code",
            "owner_user_id",
            "status",
            "version",
            "frequency",
            "frequency_interval",
          ])
          .select(sql<string | null>`next_check_date::text`.as("next_check_date"))
          .where("id", "=", control.id)
          .forUpdate()
          .executeTakeFirstOrThrow();
        if (c.status !== "active" || c.version !== version || c.next_check_date !== dueDate) return null;
        const area = await tx
          .selectFrom("performance_area")
          .select(["status", "bau_owner_user_id"])
          .where("id", "=", c.performance_area_id)
          .executeTakeFirstOrThrow();
        if (area.status === "retired") return null;
        const assignee = c.owner_user_id ?? area.bau_owner_user_id;
        const id = await uuidv7(tx);
        const inserted = await sql<{ id: string }>`
          INSERT INTO control_check (id, organization_id, transformation_id, control_id, performance_area_id, due_date,
                                     assignee_user_id, created_source, created_by, updated_by)
          VALUES (${id}::uuid, ${c.organization_id}::uuid, ${c.transformation_id}::uuid, ${c.id}::uuid,
                  ${c.performance_area_id}::uuid, ${dueDate}::date, ${assignee}::uuid, 'worker', NULL, NULL)
          ON CONFLICT (control_id, due_date) DO NOTHING
          RETURNING id`.execute(tx);
        let check: { outcome: "created" | "existing"; id: string };
        if (inserted.rows.length === 0) {
          const existing = await tx
            .selectFrom("control_check")
            .select("id")
            .where("control_id", "=", c.id)
            .where("due_date", "=", dueDate)
            .executeTakeFirstOrThrow();
          check = { outcome: "existing", id: existing.id };
        } else {
          check = { outcome: "created", id };
          await insertAuditEvent(tx, actor, {
            action: "control_check.create",
            recordType: "control_check",
            recordId: id,
            organizationId: c.organization_id,
            transformationId: c.transformation_id,
            newVersion: 1,
            changes: {
              control_id: { from: null, to: c.id },
              due_date: { from: null, to: dueDate },
              assignee_user_id: { from: null, to: assignee },
            },
          });
          if (assignee !== null)
            await createWorkItemOnce(tx, actor, {
              organizationId: c.organization_id,
              transformationId: c.transformation_id,
              kind: CONTROL_CHECK_TASK_KIND,
              assigneeUserId: assignee,
              subjectType: "control_check",
              subjectId: id,
              linkPath: `/transformations/${c.transformation_id}/performance-areas/${c.performance_area_id}`,
              messageKey: "sustainment.task.control_check_due",
              messageParams: { controlCode: c.code, dueDate },
              dueDate,
              dedupeKey: `sustainment.control_check:${id}`,
            });
        }
        const next = await plusPeriod(tx, dueDate, c.frequency, c.frequency_interval);
        await tx
          .updateTable("control")
          .set({
            next_check_date: next,
            version: sql<number>`version + 1`,
            updated_at: sql<Date>`now()`,
            updated_by: null,
          })
          .where("id", "=", c.id)
          .where("version", "=", c.version)
          .executeTakeFirstOrThrow();
        await insertAuditEvent(tx, actor, {
          action: "control.check_scheduled",
          recordType: "control",
          recordId: c.id,
          organizationId: c.organization_id,
          transformationId: c.transformation_id,
          priorVersion: c.version,
          newVersion: c.version + 1,
          changes: { next_check_date: { from: dueDate, to: next } },
        });
        return { check, next, version: c.version + 1 };
      });
      if (r.outcome === "duplicate") {
        steps.push({ subjectId: control.id, dueDate, outcome: "duplicate", recordId: null });
        break;
      }
      if (r.result === null) {
        steps.push({ subjectId: control.id, dueDate, outcome: "skipped", recordId: null });
        break;
      }
      steps.push({ subjectId: control.id, dueDate, outcome: r.result.check.outcome, recordId: r.result.check.id });
      version = r.result.version;
      dueDate = r.result.next;
    }
  }
  return summarize(steps);
}

// ------------------------------------------------------------------------------------------------ benefit monitoring
// T-DG4-BE-J (p4-work-split §F+G FG.6; ADR-0034 §3, §6; REQ-S11-007 "monitoring tasks appear for the residual owner").
// The worker twin of the API's scheduleMonitoringReviews (apps/api/src/modules/sustainment/transition-decisions.ts;
// ADR-0002 rule 5, D-102 (2)); apps/api/test/integration/sustainment/transition-decisions.test.ts proves both write the
// same rows. For every APPROVED transition decision whose next_monitoring_date <= the organization's business date + 7
// days and <= its expected realization end: insert the `sustainment_review` of subject transition_decision for that date
// if absent (sustainment_review_due_key), assigned to the residual owner only (the 0048 trigger also checks it), audited,
// with its `benefit_monitoring_due` work item (dedupe `sustainment.monitoring:<decisionId>:<dueDate>`), then advance
// next_monitoring_date by one period (version + 1, audited as the service). One runOnce transaction per decision and
// slot, key `monitoring:<decisionId>:v<version>:<dueDate>`, so a rerun or a redelivered job creates nothing twice. The
// scan reads no transformation status (monitoring continues after closure) and never decides an approval.

export const BENEFIT_MONITORING_TASK_KIND = "benefit_monitoring_due";

/** The twin of the API's monitoring-review insert: one review for (decision, dueDate), its audit and its work item. */
export async function scheduleMonitoringReviewInTx(
  tx: Tx,
  actor: AuditActor,
  decisionId: string,
  dueDate: string,
): Promise<ScheduledReview> {
  const d = await tx
    .selectFrom("transition_decision")
    .select(["id", "organization_id", "transformation_id", "code", "residual_owner_user_id"])
    .where("id", "=", decisionId)
    .executeTakeFirstOrThrow();
  const byUser = actor.actorType === "user" ? actor.actorUserId : null;
  const id = await uuidv7(tx);
  const inserted = await sql<{ id: string }>`
    INSERT INTO sustainment_review (id, organization_id, transformation_id, subject_kind, transition_decision_id,
                                    due_date, assignee_user_id, created_source, created_by, updated_by)
    VALUES (${id}::uuid, ${d.organization_id}::uuid, ${d.transformation_id}::uuid, 'transition_decision',
            ${d.id}::uuid, ${dueDate}::date, ${d.residual_owner_user_id}::uuid,
            ${byUser === null ? "worker" : "api"}, ${byUser}::uuid, ${byUser}::uuid)
    ON CONFLICT (subject_kind, (coalesce(performance_area_id, transition_decision_id)), due_date) DO NOTHING
    RETURNING id`.execute(tx);
  if (inserted.rows.length === 0) {
    const existing = await tx
      .selectFrom("sustainment_review")
      .select("id")
      .where("subject_kind", "=", "transition_decision")
      .where("transition_decision_id", "=", d.id)
      .where("due_date", "=", dueDate)
      .executeTakeFirstOrThrow();
    return { outcome: "existing", reviewId: existing.id };
  }
  await insertAuditEvent(tx, actor, {
    action: "sustainment_review.create",
    recordType: "sustainment_review",
    recordId: id,
    organizationId: d.organization_id,
    transformationId: d.transformation_id,
    newVersion: 1,
    changes: {
      subject_kind: { from: null, to: "transition_decision" },
      transition_decision_id: { from: null, to: d.id },
      due_date: { from: null, to: dueDate },
      assignee_user_id: { from: null, to: d.residual_owner_user_id },
    },
  });
  await createWorkItemOnce(tx, actor, {
    organizationId: d.organization_id,
    transformationId: d.transformation_id,
    kind: BENEFIT_MONITORING_TASK_KIND,
    assigneeUserId: d.residual_owner_user_id,
    subjectType: "sustainment_review",
    subjectId: id,
    linkPath: `/transformations/${d.transformation_id}/transition-decisions/${d.id}`,
    messageKey: "sustainment.task.benefit_monitoring_due",
    messageParams: { decisionCode: d.code, dueDate },
    dueDate,
    dedupeKey: `sustainment.monitoring:${d.id}:${dueDate}`,
  });
  return { outcome: "created", reviewId: id };
}

/** sustainment.review_scan, transition-decision part: the next monitoring review of every approved decision. */
export async function runMonitoringScan(db: Db, jobId: string, opts: ScanOptions = {}): Promise<ScanResult> {
  const actor = jobActor(jobId);
  const due = await db
    .selectFrom("transition_decision as d")
    .select([
      "d.id",
      "d.version",
      sql<string>`d.next_monitoring_date::text`.as("due"),
      sql<string>`d.expected_realization_end::text`.as("end"),
      sql<string>`(${horizonExpr(opts, sql.ref("d.organization_id"))})::text`.as("horizon"),
    ])
    .where("d.status", "=", "approved")
    .$if(opts.organizationId !== undefined, (q) => q.where("d.organization_id", "=", opts.organizationId!))
    .where("d.next_monitoring_date", "is not", null)
    .where(sql<boolean>`d.next_monitoring_date <= d.expected_realization_end`)
    .where(sql<boolean>`d.next_monitoring_date <= ${horizonExpr(opts, sql.ref("d.organization_id"))}`)
    .orderBy("d.id")
    .execute();
  const steps: ScanStep[] = [];
  for (const decision of due) {
    const horizon = decision.horizon;
    let version = decision.version;
    let dueDate = decision.due;
    for (let i = 0; i < MAX_STEPS_PER_SUBJECT && dueDate <= horizon && dueDate <= decision.end; i += 1) {
      const key = `monitoring:${decision.id}:v${version}:${dueDate}`;
      const r = await runOnce(db, REVIEW_SCAN_QUEUE, key, async (tx) => {
        const d = await tx
          .selectFrom("transition_decision")
          .select([
            "id",
            "organization_id",
            "transformation_id",
            "status",
            "version",
            "monitoring_frequency",
            "monitoring_interval",
          ])
          .select(sql<string | null>`next_monitoring_date::text`.as("next_monitoring_date"))
          .select(sql<string>`expected_realization_end::text`.as("expected_realization_end"))
          .where("id", "=", decision.id)
          .forUpdate()
          .executeTakeFirstOrThrow();
        if (
          d.status !== "approved" ||
          d.version !== version ||
          d.next_monitoring_date !== dueDate ||
          dueDate > d.expected_realization_end
        )
          return null;
        const scheduled = await scheduleMonitoringReviewInTx(tx, actor, d.id, dueDate);
        const next = await plusPeriod(tx, dueDate, d.monitoring_frequency, d.monitoring_interval);
        await tx
          .updateTable("transition_decision")
          .set({
            next_monitoring_date: next,
            version: sql<number>`version + 1`,
            updated_at: sql<Date>`now()`,
            updated_by: null,
          })
          .where("id", "=", d.id)
          .where("version", "=", d.version)
          .executeTakeFirstOrThrow();
        await insertAuditEvent(tx, actor, {
          action: "transition_decision.monitoring_scheduled",
          recordType: "transition_decision",
          recordId: d.id,
          organizationId: d.organization_id,
          transformationId: d.transformation_id,
          priorVersion: d.version,
          newVersion: d.version + 1,
          changes: { next_monitoring_date: { from: dueDate, to: next } },
        });
        return { scheduled, next, version: d.version + 1 };
      });
      if (r.outcome === "duplicate") {
        steps.push({ subjectId: decision.id, dueDate, outcome: "duplicate", recordId: null });
        break;
      }
      if (r.result === null) {
        steps.push({ subjectId: decision.id, dueDate, outcome: "skipped", recordId: null });
        break;
      }
      steps.push({
        subjectId: decision.id,
        dueDate,
        outcome: r.result.scheduled.outcome,
        recordId: r.result.scheduled.reviewId,
      });
      version = r.result.version;
      dueDate = r.result.next;
    }
  }
  return summarize(steps);
}

/** The whole sustainment.review_scan job: BE-I2's area reviews, then BE-J's benefit-monitoring reviews. */
export async function runSustainmentReviewJob(
  db: Db,
  jobId: string,
  opts: ScanOptions = {},
): Promise<{ areas: ScanResult; monitoring: ScanResult }> {
  const areas = await runReviewScan(db, jobId, opts);
  const monitoring = await runMonitoringScan(db, jobId, opts);
  return { areas, monitoring };
}

export const SUSTAINMENT_HANDLERS: readonly JobHandler[] = [
  { queue: REVIEW_SCAN_QUEUE, handle: (db, _data, jobId) => runSustainmentReviewJob(db, jobId) },
  { queue: CONTROL_CHECK_SCAN_QUEUE, handle: (db, _data, jobId) => runControlCheckScan(db, jobId) },
];
