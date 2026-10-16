// reports job handlers (P5; stub by T-DG5-BE-A, p5-plan §5.1 and §5.3). Each is idempotent through the kit (../kit.ts:
// runOnce, createWorkItemOnce).
//
// reports.owner_update_tasks (T-DG5-KBE-D; ADR-0045 §6, §10; REQ-S09-011 automation "Reporting period opens -> update
// tasks"; p5-work-split §F.3). Daily at 00:40 Asia/Riyadh (job_schedule seeded by 0080). For each OPEN `monthly`
// reporting period (the Executive SteerCo cadence of B0093) and each active transformation of its organization (read
// as a live one: not archived and not closed, so draft and on-hold transformations still report; the DG4 period-open
// job's scope minus closed ones), it creates one `owner_update_due` My Work item per subject owner without a submitted update:
//   - the transformation: each active user holding the TL role (with owner_update.submit) in a grant that applies to
//     the transformation (its own scope, or a business unit above it / the organization when the role inherits
//     downward; the API's write rule in portfolio/updates.ts, ADR-0045 §6);
//   - each active workstream: its `lead_user_id`. A workstream without a lead gets no task (the executive pack shows
//     it as "No owner").
// Exactly once: the dedupe key `owner_update_due:<periodId>:<subjectType>:<subjectId>:<userId>` (createWorkItemOnce;
// the work_item (organization_id, dedupe_key) unique key is the backstop), so a replay or a second run the same day
// creates nothing. One transaction per period and transformation, no remote I/O inside it. The audit actor is the
// service (jobActor); a service holds no permission and a task approves nothing (product gates G1-G6 are business
// approvals inside the product; nothing here touches the engineering gates DG0-DG7).
import { sql, type Db, type Tx } from "@mth/db";
import { REPORT_CONTENT_LABELS } from "@mth/shared";
import { z } from "zod";
import { createWorkItemOnce, jobActor } from "../kit.ts";
import { EXPORT_QUEUE, runExport, workerExportStore, type ExportRunnerDeps } from "../reports/export-runner.ts";
import type { JobHandler } from "./spec.ts";

export const OWNER_UPDATE_TASKS_QUEUE = "reports.owner_update_tasks";
export const OWNER_UPDATE_DUE_KIND = "owner_update_due";
export const OWNER_UPDATE_DUE_MESSAGE = "reports.task.owner_update_due";
const SUBMIT = "owner_update.submit";

/** The dedupe key of one owner's task (ADR-0045 §6); the API's portfolio/updates.ts completes tasks by its prefix. */
export const ownerUpdateDueKey = (periodId: string, subjectType: string, subjectId: string, userId: string): string =>
  `${OWNER_UPDATE_DUE_KIND}:${periodId}:${subjectType}:${subjectId}:${userId}`;

export interface OwnerUpdateTasksResult {
  readonly periods: number;
  readonly created: number;
  readonly existing: number;
}

const data = z.object({ organizationId: z.uuid().optional() }).loose();

interface Period {
  readonly id: string;
  readonly organization_id: string;
  readonly period_label: string;
  readonly update_due_date: string | null;
}

/** The active TL holders (with owner_update.submit) whose grant applies to the transformation. */
async function transformationLeads(tx: Tx, t: { id: string; organization_id: string; business_unit_id: string }) {
  const r = await sql<{ user_id: string }>`
    SELECT DISTINCT a.user_id
      FROM scoped_assignment a
      JOIN role r ON r.id = a.role_id AND r.code = 'TL'
      JOIN role_permission rp ON rp.role_id = r.id AND rp.permission_code = ${SUBMIT}
      JOIN app_user u ON u.id = a.user_id AND u.status = 'active'
     WHERE a.organization_id = ${t.organization_id}::uuid
       AND a.revoked_at IS NULL
       AND a.effective_from <= now()
       AND (a.effective_to IS NULL OR a.effective_to > now())
       AND (
            (a.scope_type = 'transformation' AND a.scope_id = ${t.id}::uuid)
         OR (r.inherits_downward AND a.scope_type = 'business_unit' AND a.scope_id IN (
               SELECT c.ancestor_id FROM business_unit_closure c WHERE c.descendant_id = ${t.business_unit_id}::uuid))
         OR (r.inherits_downward AND a.scope_type = 'organization' AND a.scope_id = ${t.organization_id}::uuid)
       )
     ORDER BY a.user_id`.execute(tx);
  return r.rows.map((x) => x.user_id);
}

/** The tasks of one period and transformation, in `tx`. */
async function tasksOf(
  tx: Tx,
  jobId: string,
  p: Period,
  t: { id: string; organization_id: string; business_unit_id: string; code: string; name: string },
): Promise<{ created: number; existing: number }> {
  const submitted = await tx
    .selectFrom("owner_update")
    .select(["subject_type", "subject_id"])
    .where("transformation_id", "=", t.id)
    .where("reporting_period_id", "=", p.id)
    .where("status", "=", "submitted")
    .execute();
  const done = new Set(submitted.map((s) => `${s.subject_type}:${s.subject_id}`));
  const subjects: { type: string; id: string; code: string; name: string; owners: string[] }[] = [];
  if (!done.has(`transformation:${t.id}`))
    subjects.push({
      type: "transformation",
      id: t.id,
      code: t.code,
      name: t.name,
      owners: await transformationLeads(tx, t),
    });
  const workstreams = await tx
    .selectFrom("workstream as w")
    .innerJoin("app_user as u", "u.id", "w.lead_user_id")
    .select(["w.id", "w.code", "w.name", "w.lead_user_id"])
    .where("w.transformation_id", "=", t.id)
    .where("w.status", "=", "active")
    .where("u.status", "=", "active")
    .orderBy("w.code")
    .orderBy("w.id")
    .execute();
  for (const w of workstreams)
    if (!done.has(`workstream:${w.id}`) && w.lead_user_id !== null)
      subjects.push({ type: "workstream", id: w.id, code: w.code, name: w.name, owners: [w.lead_user_id] });
  let created = 0;
  let existing = 0;
  for (const s of subjects)
    for (const userId of s.owners) {
      const r = await createWorkItemOnce(tx, jobActor(jobId), {
        organizationId: p.organization_id,
        transformationId: t.id,
        kind: OWNER_UPDATE_DUE_KIND,
        assigneeUserId: userId,
        subjectType: s.type,
        subjectId: s.id,
        linkPath: `/transformations/${t.id}/owner-updates`,
        messageKey: OWNER_UPDATE_DUE_MESSAGE,
        messageParams: { subjectType: s.type, subjectCode: s.code, subjectName: s.name, periodLabel: p.period_label },
        dueDate: p.update_due_date,
        periodLabel: p.period_label,
        dedupeKey: ownerUpdateDueKey(p.id, s.type, s.id, userId),
      });
      if (r.outcome === "created") created += 1;
      else existing += 1;
    }
  return { created, existing };
}

/** The daily job (exported for the tests). `data.organizationId` narrows it to one organization (tests). */
export async function createOwnerUpdateTasks(db: Db, input: unknown, jobId: string): Promise<OwnerUpdateTasksResult> {
  const { organizationId } = data.parse(input ?? {});
  let q = db
    .selectFrom("reporting_period")
    .select(["id", "organization_id", "period_label", "update_due_date"])
    .where("status", "=", "open")
    .where("frequency", "=", "monthly");
  if (organizationId !== undefined) q = q.where("organization_id", "=", organizationId);
  const periods = await q.orderBy("period_start").orderBy("id").limit(500).execute();
  let created = 0;
  let existing = 0;
  for (const p of periods) {
    let tq = db
      .selectFrom("transformation")
      .select(["id", "organization_id", "business_unit_id", "code", "name"])
      .where("organization_id", "=", p.organization_id)
      .where("status", "<>", "closed")
      .where("archived_at", "is", null);
    tq = tq.orderBy("code").orderBy("id");
    const transformations = await tq.execute();
    for (const t of transformations) {
      const r = await db.transaction().execute(async (tx) => {
        // The period may have closed since the scan: no task for a closed period.
        const still = await tx
          .selectFrom("reporting_period")
          .select("status")
          .where("id", "=", p.id)
          .forShare()
          .executeTakeFirst();
        if (still?.status !== "open") return { created: 0, existing: 0 };
        return tasksOf(tx, jobId, p, t);
      });
      created += r.created;
      existing += r.existing;
    }
  }
  return { periods: periods.length, created, existing };
}

/**
 * The production dependencies of `reports.export` (T-DG5-KBE-D2; D-157 a; p5-work-split §F.11 item 10; REQ-S13-009): the
 * worker's export-file store and the en/ar content label table of every `report.*` key the assemblers emit
 * (`@mth/shared` REPORT_CONTENT_LABELS; the worker imports no API code, ADR-0002), so an Arabic export prints Arabic
 * content headings and labels, never English fallbacks.
 */
export const exportRunnerDeps = (): ExportRunnerDeps => ({ store: workerExportStore(), labels: REPORT_CONTENT_LABELS });

export const REPORTS_HANDLERS: readonly JobHandler[] = [
  { queue: OWNER_UPDATE_TASKS_QUEUE, handle: createOwnerUpdateTasks },
  // T-DG5-BE-M (ADR-0046 §5): reports.export renders one export job (apps/worker/src/reports/export-runner.ts).
  {
    queue: EXPORT_QUEUE,
    handle: (db, data, jobId, attempt) => runExport(db, data, jobId, attempt, exportRunnerDeps()),
  },
];
