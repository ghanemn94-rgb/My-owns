// approvals job handlers (T-DG4-BE-B; p4-work-split §I+C.2; ADR-0026 §6; REQ-S10-019; D-089 Q7):
// `approval.escalation_scan`, the overdue-approval timer. A TIMER NEVER DECIDES: for each open approval whose due date
// is before today's business date (in the approval's calendar timezone, else the organization's), in ONE transaction
// under the kit's runOnce with key `approval.escalate:<approvalId>:<round>:<dueDate>`, it
//   1. takes the next party after the current level in the escalation chain (the T11 row's `escalation_chain`; level 0
//      is the Approve party; an approval without a T11 row uses its assignee party then SP) and resolves it through
//      the role mapping (no fallback);
//   2. inserts ONE approval_escalation row: the target, or routing_error party_unmapped / party_not_approver /
//      no_next_authority (visible on the approval, never a silent skip);
//   3. when a target was found, sets the approval's escalation fields and escalation_level + 1 (nothing else: the
//      status is unchanged, no decision row is written), and creates an `approval_escalated` task for the target's
//      approvers (createWorkItemOnce).
// An approval with an Unknown due date (due_date NULL) is never selected. Retries, redeliveries and restarts escalate
// exactly once per (approval, round, due date): the processed_message ledger row, and behind it the 0031 unique key
// approval_escalation_once and trigger approval_escalation_guard. The audit actor is `service` (jobActor), which holds
// no permission and can never decide a business approval (the 0031 approval_guard refuses approved/rejected without a
// user's decision row). Nothing here touches the engineering gates DG0-DG7.
import { insertAuditEvent, sql, type Db, type Tx } from "@mth/db";
import { z } from "zod";
import { createWorkItemOnce, jobActor, runOnce } from "../kit.ts";
import type { JobHandler } from "./spec.ts";

export const ESCALATION_SCAN_QUEUE = "approval.escalation_scan";
export const ESCALATION_CONSUMER = "approval.escalation_scan.v1";
/** At most this many approvals per run; the next scheduled run continues (each one is its own transaction). */
const BATCH = 500;

/** Job data: the schedule sends {}; an operator (or a test) may scope one run to one organization. */
const scanData = z.object({ organizationId: z.uuid().optional() }).loose();

export interface EscalationScanResult {
  readonly selected: number;
  readonly escalated: number;
  readonly routingErrors: number;
  readonly duplicates: number;
  readonly skipped: number;
}

type RoutingError = "no_next_authority" | "party_unmapped" | "party_not_approver";

/** Users who hold approval.decide in the transformation's scope now (the policy's grant rule, ADR-0006, in SQL). */
async function approversAmong(tx: Tx, userIds: readonly string[], transformationId: string): Promise<string[]> {
  if (userIds.length === 0) return [];
  const r = await sql<{ user_id: string }>`
    SELECT DISTINCT sa.user_id
    FROM scoped_assignment sa
    JOIN role r ON r.id = sa.role_id
    JOIN role_permission rp ON rp.role_id = r.id AND rp.permission_code = 'approval.decide'
    JOIN app_user u ON u.id = sa.user_id AND u.status = 'active'
    JOIN transformation t ON t.id = ${transformationId}::uuid
    WHERE sa.user_id = ANY(${[...userIds]}::uuid[])
      AND sa.revoked_at IS NULL AND sa.effective_from <= now() AND (sa.effective_to IS NULL OR sa.effective_to > now())
      AND sa.organization_id = t.organization_id
      AND ((sa.scope_type = 'transformation' AND sa.scope_id = t.id)
        OR (r.inherits_downward AND sa.scope_type = 'organization' AND sa.scope_id = t.organization_id)
        OR (r.inherits_downward AND sa.scope_type = 'business_unit'
            AND sa.scope_id IN (SELECT c.ancestor_id FROM business_unit_closure c WHERE c.descendant_id = t.business_unit_id)))
    ORDER BY sa.user_id`.execute(tx);
  return r.rows.map((x) => x.user_id);
}

/** Current members of an active group (not removed, inside their window, active users). */
async function currentMembers(tx: Tx, groupId: string): Promise<string[]> {
  const r = await sql<{ user_id: string }>`
    SELECT m.user_id FROM access_group_member m
    JOIN access_group g ON g.id = m.group_id AND g.status = 'active'
    WHERE m.group_id = ${groupId}::uuid AND m.removed_at IS NULL AND m.effective_from <= now()
      AND (m.effective_to IS NULL OR m.effective_to > now())
    ORDER BY m.user_id`.execute(tx);
  return r.rows.map((x) => x.user_id);
}

interface Resolved {
  readonly toPartyCode: string | null;
  readonly toUserId: string | null;
  readonly toGroupId: string | null;
  readonly routingError: RoutingError | null;
  readonly approverIds: readonly string[];
}

/** The next authority of the chain, resolved like the API's routeToParty (no fallback; approver check, §8). */
async function resolveNext(tx: Tx, transformationId: string, party: string | undefined): Promise<Resolved> {
  if (party === undefined)
    return { toPartyCode: null, toUserId: null, toGroupId: null, routingError: "no_next_authority", approverIds: [] };
  const m = await tx
    .selectFrom("role_mapping")
    .select(["target_kind", "user_id", "group_id"])
    .where("transformation_id", "=", transformationId)
    .where("party_code", "=", party)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (!m)
    return { toPartyCode: party, toUserId: null, toGroupId: null, routingError: "party_unmapped", approverIds: [] };
  const candidates = m.target_kind === "user" ? [m.user_id!] : await currentMembers(tx, m.group_id!);
  const approverIds = await approversAmong(tx, candidates, transformationId);
  if (approverIds.length === 0)
    return { toPartyCode: party, toUserId: null, toGroupId: null, routingError: "party_not_approver", approverIds: [] };
  return {
    toPartyCode: party,
    toUserId: m.target_kind === "user" ? m.user_id : null,
    toGroupId: m.target_kind === "group" ? m.group_id : null,
    routingError: null,
    approverIds,
  };
}

type EscalateOutcome = "escalated" | "routing_error" | "skipped";

/** One approval, inside runOnce's transaction. Re-reads the row under lock; a changed row is skipped. */
async function escalateOne(
  tx: Tx,
  jobId: string,
  approvalId: string,
  roundNo: number,
  dueDate: string,
): Promise<EscalateOutcome> {
  const a = await tx.selectFrom("approval").selectAll().where("id", "=", approvalId).forUpdate().executeTakeFirst();
  if (!a || !["pending", "deferred"].includes(a.status) || a.round_no !== roundNo || a.due_date !== dueDate)
    return "skipped";
  const still = await sql<{ overdue: boolean }>`
    SELECT ${dueDate}::date < p4_business_date(now(), coalesce(
      (SELECT c.timezone FROM business_calendar c WHERE c.id = ${a.calendar_id}::uuid),
      (SELECT o.default_timezone FROM organization o WHERE o.id = ${a.organization_id}::uuid))) AS overdue`.execute(tx);
  if (still.rows[0]?.overdue !== true) return "skipped";

  let chain: string[] = [];
  if (a.decision_right_id !== null) {
    const row = await tx
      .selectFrom("transformation_decision_right")
      .select("escalation_chain")
      .where("id", "=", a.decision_right_id)
      .executeTakeFirst();
    chain = row?.escalation_chain ?? [];
  }
  // D-089 Q7 default: the Approve role, then SP.
  if (chain.length === 0) chain = [...new Set([a.assignee_party_code, "SP"])];
  const level = a.escalation_level;
  const fromParty = level === 0 ? a.assignee_party_code : (a.escalated_to_party_code ?? a.assignee_party_code);
  const next = await resolveNext(tx, a.transformation_id, chain[level + 1]);
  const rowLevel = Math.min(level + 1, 5);
  const actor = jobActor(jobId);

  const idRow = await sql<{ id: string }>`SELECT mth_uuid_v7() AS id`.execute(tx);
  const escalationId = idRow.rows[0]!.id;
  await tx
    .insertInto("approval_escalation")
    .values({
      id: escalationId,
      organization_id: a.organization_id,
      transformation_id: a.transformation_id,
      approval_id: a.id,
      round_no: a.round_no,
      due_date: dueDate,
      level: rowLevel,
      from_party_code: fromParty,
      to_party_code: next.toPartyCode,
      to_user_id: next.toUserId,
      to_group_id: next.toGroupId,
      routing_error: next.routingError,
    })
    .execute();
  await insertAuditEvent(tx, actor, {
    action: "approval_escalation.create",
    recordType: "approval_escalation",
    recordId: escalationId,
    organizationId: a.organization_id,
    transformationId: a.transformation_id,
    newVersion: 1,
    reason:
      next.routingError === null
        ? `Overdue since ${dueDate}: escalated to ${next.toPartyCode}; the approval stays undecided`
        : `Overdue since ${dueDate}: not escalated (${next.routingError}); the approval stays undecided`,
    changes: {
      approval_id: { from: null, to: a.id },
      round_no: { from: null, to: a.round_no },
      due_date: { from: null, to: dueDate },
      level: { from: null, to: rowLevel },
      to_party_code: { from: null, to: next.toPartyCode },
      routing_error: { from: null, to: next.routingError },
    },
  });
  if (next.routingError !== null) return "routing_error";

  // Only the escalation fields change (the 0031 guard refuses a status change together with a level change).
  const updated = await tx
    .updateTable("approval")
    .set({
      escalation_level: level + 1,
      escalated_to_party_code: next.toPartyCode,
      escalated_to_user_id: next.toUserId,
      escalated_to_group_id: next.toGroupId,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: null,
    })
    .where("id", "=", a.id)
    .where("version", "=", a.version)
    .returning(["version"])
    .executeTakeFirstOrThrow();
  await insertAuditEvent(tx, actor, {
    action: "approval.escalate",
    recordType: "approval",
    recordId: a.id,
    organizationId: a.organization_id,
    transformationId: a.transformation_id,
    priorVersion: a.version,
    newVersion: updated.version,
    changes: {
      escalation_level: { from: level, to: level + 1 },
      escalated_to_party_code: { from: a.escalated_to_party_code, to: next.toPartyCode },
      escalated_to_user_id: { from: a.escalated_to_user_id, to: next.toUserId },
      escalated_to_group_id: { from: a.escalated_to_group_id, to: next.toGroupId },
    },
  });
  for (const userId of next.approverIds) {
    if (userId === a.requested_by && a.sod_policy === "requester_excluded") continue;
    await createWorkItemOnce(tx, actor, {
      organizationId: a.organization_id,
      transformationId: a.transformation_id,
      kind: "approval_escalated",
      assigneeUserId: userId,
      subjectType: "approval",
      subjectId: a.id,
      linkPath: `/my-work/approvals/${a.id}`,
      messageKey: "approvals.task.escalated",
      messageParams: { title: a.title, dueDate, level: level + 1, fromParty, toParty: next.toPartyCode },
      dueDate: null,
      dedupeKey: `approval.escalated:${a.id}:${a.round_no}:${dueDate}:${userId}`,
    });
  }
  return "escalated";
}

/** The `approval.escalation_scan` handler: selects overdue open approvals and escalates each exactly once. */
export async function scanOverdueApprovals(db: Db, data: unknown, jobId: string): Promise<EscalationScanResult> {
  const opts = scanData.parse(data ?? {});
  const org = opts.organizationId ?? null;
  const due = await sql<{ id: string; round_no: number; due_date: string }>`
    SELECT a.id, a.round_no, a.due_date::text AS due_date
    FROM approval a
    JOIN organization o ON o.id = a.organization_id
    LEFT JOIN business_calendar c ON c.id = a.calendar_id
    WHERE a.status IN ('pending', 'deferred') AND a.due_date IS NOT NULL
      AND a.due_date < p4_business_date(now(), coalesce(c.timezone, o.default_timezone))
      AND (${org}::uuid IS NULL OR a.organization_id = ${org}::uuid)
    ORDER BY a.due_date, a.id
    LIMIT ${BATCH}`.execute(db);
  let escalated = 0;
  let routingErrors = 0;
  let duplicates = 0;
  let skipped = 0;
  for (const row of due.rows) {
    const key = `approval.escalate:${row.id}:${row.round_no}:${row.due_date}`;
    const r = await runOnce(db, ESCALATION_CONSUMER, key, (tx) =>
      escalateOne(tx, jobId, row.id, row.round_no, row.due_date),
    );
    if (r.outcome === "duplicate") duplicates += 1;
    else if (r.result === "escalated") escalated += 1;
    else if (r.result === "routing_error") routingErrors += 1;
    else skipped += 1;
  }
  return { selected: due.rows.length, escalated, routingErrors, duplicates, skipped };
}

export const APPROVALS_HANDLERS: readonly JobHandler[] = [
  { queue: ESCALATION_SCAN_QUEUE, handle: (db, data, jobId) => scanOverdueApprovals(db, data, jobId) },
];
