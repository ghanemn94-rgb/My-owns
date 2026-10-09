// escalations job handlers (T-DG4-BE-G; p4-work-split §D.2; stub by T-DG4-BE-A): the two starter automations of slice D
// (ADR-0032 §7, §8, §10; REQ-S12-011, REQ-PB-082; M0231, M0233).
//
//   queue / consumer                      trigger                                     idempotency key
//   governance.decision_sla_scan          daily schedule (organization timezone)      decision.escalate:<decisionId>:<slaDueDate>
//   governance.blocker_escalation         outbox event blocker_status.recorded         blocker_status.recorded:<blockerStatusId>
//   governance.blocker_escalation_scan    daily schedule                               blocker_escalation_scan:<forumId>:<type>:<id>:<businessDate>
//
// DECISION-SLA SCAN (REQ-S12-011 "an SLA expiring on a working day escalates once to the next authority and shows the
// delay impact text"). Per organization, only on a WORKING day of its default business calendar (nothing on a
// non-working day or without a calendar; never elapsed days). It selects the executive asks (ask_origin NOT NULL) that
// are open or deferred with sla_due_date before today's business date; an Unknown SLA date (NULL) is never selected.
// Each ask is one runOnce transaction under pg_advisory_xact_lock(730240, hashtext('<decisionId>')):
//   1. the chain: the T11 row's escalation_chain, else the stored decision_sla rule's chain, else ['SP'] (a disabled
//      stored rule escalates nothing); the next entry after the last escalated party; a mapped person who is the
//      ask's owner is skipped;
//   2. ONE decision_escalation row (level = previous + 1) with the target, or a routing error: party_unmapped,
//      party_not_executive (the person, or every current member of the group, lacks executive_decision.decide),
//      no_next_authority (chain exhausted); delay_impact = the ask's impact of delay at that moment;
//   3. the target (each current executive member of a group) gets an `executive_decision_escalated` My Work item;
//      the owner and the creator get an inbox notification naming the delay impact and any routing error.
// The job writes NO decision column: an escalation never decides (decision_escalation_once and the guard are the
// database's second line; the ledger row is the first).
//
// BLOCKER-RED ESCALATION (REQ-PB-082 "a blocker Red in 2 consecutive cycles (N=2) produces exactly one open T16 ask;
// re-running the job creates no duplicate"). `evaluateBlocker` runs under pg_advisory_xact_lock(730239,
// hashtext('<transformationId>:<type>:<id>')) — the lock the API's createExecutiveDecision takes for a blocker link:
//   1. the blocker_red rule or its default (2 cycles, 10 working days, owner SP); disabled -> nothing;
//   2. the forum's latest N meetings that are in session, held or minutes-published on or before the observation's
//      cycle date; red for N cycles only when there are N and each has a `red` observation (redForCycles: a missing,
//      amber, green or unknown cycle ends the run);
//   3. an open or deferred ask of the blocker (any origin) -> nothing (decision_one_open_blocker_ask is the second line);
//   4. otherwise ONE decision of kind executive: ask_origin blocker_escalation, created_source worker, DEC-nn, title =
//      the blocker's name, owner = the owner party mapped to a person holding executive_decision.decide (else NULL:
//      ownerStatus unassigned, never guessed), due and SLA date = addWorkingDays(cycle date, deadline) on the default
//      calendar; created_by = the person who recorded the N-th red observation, audit actor `system` on their behalf
//      with the reason "Blocker red for N consecutive cycles"; the owner's executive_decision_due item. Without a
//      calendar no ask is created and the transformation lead gets ONE `calendar_not_configured` notice.
//
// The worker imports no API code (ADR-0002 rule 5; D-102 item 2): the SQL here mirrors the API's (resolveParty,
// holdsExecutiveDecide, nextCode, the work-item twin in ../kit.ts); the rule parts are the pure @mth/shared/schemas
// helpers both sides use. No job decides a business approval or touches the engineering gates DG0-DG7.
import { insertAuditEvent, sql, type AuditActor, type Db, type Tx } from "@mth/db";
import {
  blockerStatusRecordedV1,
  decCode,
  ESCALATION_RULE_DEFAULTS,
  outboxEnvelope,
  redForCycles,
  truncateText,
  type BlockerRag,
  type BlockerRecordType,
  type EscalationRoutingError,
} from "@mth/shared/schemas";
import { addWorkingDays, isWorkingDay, type WorkingCalendar } from "@mth/shared/time";
import { z } from "zod";
import { createWorkItemOnce, jobActor, runOnce } from "../kit.ts";
import type { JobHandler } from "./spec.ts";

/** ADR-0016 §6 / apps/api platform/advisory-locks.ts (the worker imports no API code). */
export const EXECUTIVE_ASK_BLOCKER_LOCK_CLASS = 730239;
export const DECISION_ESCALATION_LOCK_CLASS = 730240;
export const DECISION_SLA_SCAN_QUEUE = "governance.decision_sla_scan";
export const DECISION_SLA_SCAN_CONSUMER = "governance.decision_sla_scan";
export const BLOCKER_ESCALATION_QUEUE = "governance.blocker_escalation";
export const BLOCKER_ESCALATION_CONSUMER = "governance.blocker_escalation";
export const BLOCKER_ESCALATION_SCAN_QUEUE = "governance.blocker_escalation_scan";
export const BLOCKER_ESCALATION_SCAN_CONSUMER = "governance.blocker_escalation_scan";
export const BLOCKER_STATUS_RECORDED = "blocker_status.recorded";

export const EXECUTIVE_DECISION_DUE_KIND = "executive_decision_due";
export const EXECUTIVE_DECISION_DUE_MESSAGE = "governance.task.executive_decision_due";
export const EXECUTIVE_DECISION_ESCALATED_KIND = "executive_decision_escalated";
export const EXECUTIVE_DECISION_ESCALATED_MESSAGE = "governance.task.executive_decision_escalated";
export const ESCALATION_NOTICE = "governance.notice.executive_decision_escalated";
export const BLOCKER_CALENDAR_NOTICE = "governance.notice.blocker_ask_calendar_not_configured";
const DECIDE = "executive_decision.decide";
const BATCH = 500;
/** How far before the start date the calendar's holidays are loaded. */
const CALENDAR_LOOKBACK_DAYS = 120;

const scanData = z.object({ organizationId: z.uuid().optional() }).loose();

// ------------------------------------------------------------------------------------------------ shared SQL

async function uuidv7(tx: Tx): Promise<string> {
  const r = await sql<{ id: string }>`SELECT mth_uuid_v7() AS id`.execute(tx);
  return r.rows[0]!.id;
}

/** The organization's active default calendar (workweek and holidays from `from` - lookback), or null. */
async function defaultCalendar(
  db: Db | Tx,
  organizationId: string,
  from: string,
): Promise<{ calendar: WorkingCalendar; timezone: string } | null> {
  const c = await db
    .selectFrom("business_calendar")
    .select(["id", "workweek", "timezone"])
    .where("organization_id", "=", organizationId)
    .where("is_default", "=", true)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (!c) return null;
  const holidays = await db
    .selectFrom("business_calendar_holiday")
    .select(["id", "date_from", "date_to"])
    .where("calendar_id", "=", c.id)
    .where("status", "=", "active")
    .where("date_to", ">=", sql<string>`(${from}::date - ${CALENDAR_LOOKBACK_DAYS}::integer)`)
    .execute();
  return {
    calendar: {
      workweek: c.workweek.map(Number),
      holidays: holidays.map((h) => ({ id: h.id, dateFrom: h.date_from, dateTo: h.date_to })),
    },
    timezone: c.timezone,
  };
}

async function businessDateIn(db: Db | Tx, timezone: string): Promise<string> {
  return (await sql<{ d: string }>`SELECT p4_business_date(now(), ${timezone})::text AS d`.execute(db)).rows[0]!.d;
}

/** Users among `userIds` who hold executive_decision.decide in the transformation's scope now (ADR-0006 in SQL). */
export async function executivesAmong(tx: Tx, userIds: readonly string[], transformationId: string): Promise<string[]> {
  if (userIds.length === 0) return [];
  const r = await sql<{ user_id: string }>`
    SELECT DISTINCT sa.user_id
    FROM scoped_assignment sa
    JOIN role r ON r.id = sa.role_id
    JOIN role_permission rp ON rp.role_id = r.id AND rp.permission_code = ${DECIDE}
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

type PartyTarget =
  | { readonly status: "unmapped" }
  | { readonly status: "mapped"; readonly kind: "user"; readonly userId: string }
  | { readonly status: "mapped"; readonly kind: "group"; readonly groupId: string };

/** The API's resolveParty (role mapping, no fallback). */
async function resolveParty(tx: Tx, transformationId: string, partyCode: string): Promise<PartyTarget> {
  const m = await tx
    .selectFrom("role_mapping")
    .select(["target_kind", "user_id", "group_id"])
    .where("transformation_id", "=", transformationId)
    .where("party_code", "=", partyCode)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (!m) return { status: "unmapped" };
  return m.target_kind === "group"
    ? { status: "mapped", kind: "group", groupId: m.group_id! }
    : { status: "mapped", kind: "user", userId: m.user_id! };
}

/** The API's currentGroupMemberIds. */
async function groupMembers(tx: Tx, groupId: string): Promise<string[]> {
  const rows = await tx
    .selectFrom("access_group_member as m")
    .innerJoin("access_group as g", "g.id", "m.group_id")
    .innerJoin("app_user as u", "u.id", "m.user_id")
    .select("m.user_id")
    .where("m.group_id", "=", groupId)
    .where("g.status", "=", "active")
    .where("u.status", "=", "active")
    .where(
      sql<boolean>`(m.removed_at IS NULL AND m.effective_from <= now() AND (m.effective_to IS NULL OR m.effective_to > now()))`,
    )
    .orderBy("m.user_id")
    .execute();
  return rows.map((r) => r.user_id);
}

/** A standalone inbox notification (no work item), once per dedupe key, with its audit event. */
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
  const id = await uuidv7(tx);
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

const decisionLink = (transformationId: string, decisionId: string) =>
  `/transformations/${transformationId}/executive-decisions/${decisionId}`;

// ------------------------------------------------------------------------------------------------ decision-SLA scan

export interface SlaEscalationOutcome {
  readonly decisionId: string;
  readonly outcome: "escalated" | "routing_error" | "duplicate" | "skipped";
  readonly level: number | null;
  readonly routingError: EscalationRoutingError | null;
}

export interface DecisionSlaScanResult {
  /** Organizations whose business day was a working day with a default calendar. */
  readonly organizationsScanned: number;
  /** Organizations skipped: no default calendar, or not a working day. */
  readonly organizationsSkipped: number;
  readonly asks: readonly SlaEscalationOutcome[];
}

/**
 * Escalates one expired ask once (the caller holds the ledger row). Re-reads the ask under lock 730240; an ask that
 * was decided, cancelled or re-dated since the scan selected it is skipped.
 */
export async function escalateDecisionInTx(
  tx: Tx,
  actor: AuditActor,
  decisionId: string,
  slaDueDate: string,
  businessDate: string,
): Promise<Omit<SlaEscalationOutcome, "decisionId">> {
  await sql`SELECT pg_advisory_xact_lock(${DECISION_ESCALATION_LOCK_CLASS}::integer, hashtext(${decisionId}::text))`.execute(
    tx,
  );
  const d = await tx.selectFrom("decision").selectAll().where("id", "=", decisionId).executeTakeFirst();
  const skipped = { outcome: "skipped", level: null, routingError: null } as const;
  if (
    !d ||
    d.kind !== "executive" ||
    d.ask_origin === null ||
    (d.status !== "open" && d.status !== "deferred") ||
    d.sla_due_date !== slaDueDate ||
    !(slaDueDate < businessDate)
  )
    return skipped;
  // 1. The chain (ADR-0032 §7 step 1; D-089 Q7).
  let chain: readonly string[] = ESCALATION_RULE_DEFAULTS.decision_sla.escalationChain;
  const rule = await tx
    .selectFrom("governance_escalation_rule")
    .selectAll()
    .where("transformation_id", "=", d.transformation_id)
    .where("rule_kind", "=", "decision_sla")
    .executeTakeFirst();
  if (rule && !rule.enabled) return skipped;
  if (rule?.escalation_chain) chain = rule.escalation_chain;
  if (d.decision_right_id !== null) {
    const t11 = await tx
      .selectFrom("transformation_decision_right")
      .select("escalation_chain")
      .where("id", "=", d.decision_right_id)
      .executeTakeFirst();
    if (t11 && t11.escalation_chain.length > 0) chain = t11.escalation_chain;
  }
  const previous = await tx
    .selectFrom("decision_escalation")
    .select(["level", "party_code", "routing_error"])
    .where("decision_id", "=", decisionId)
    .orderBy("level", "desc")
    .executeTakeFirst();
  const level = (previous?.level ?? 0) + 1;
  if (level > 5) return skipped;
  // The next entry after the last escalated party (an exhausted chain stays exhausted).
  let position = 0;
  if (previous) {
    if (previous.routing_error === "no_next_authority") position = chain.length;
    else {
      const i = previous.party_code === null ? -1 : chain.lastIndexOf(previous.party_code);
      position = i < 0 ? chain.length : i + 1;
    }
  }
  // 2. Resolve the next party; a mapped person who is the owner is skipped to the next entry.
  let partyCode: string | null = null;
  let targetUserId: string | null = null;
  let targetGroupId: string | null = null;
  let routingError: EscalationRoutingError | null = null;
  let recipients: string[] = [];
  for (;;) {
    if (position >= chain.length) {
      partyCode = null;
      routingError = "no_next_authority";
      break;
    }
    partyCode = chain[position]!;
    const t = await resolveParty(tx, d.transformation_id, partyCode);
    if (t.status === "unmapped") {
      routingError = "party_unmapped";
      break;
    }
    if (t.kind === "user") {
      if (t.userId === d.owner_user_id) {
        position += 1;
        continue;
      }
      const ok = await executivesAmong(tx, [t.userId], d.transformation_id);
      if (ok.length === 0) routingError = "party_not_executive";
      else {
        targetUserId = t.userId;
        recipients = ok;
      }
      break;
    }
    const members = await executivesAmong(tx, await groupMembers(tx, t.groupId), d.transformation_id);
    if (members.length === 0) routingError = "party_not_executive";
    else {
      targetGroupId = t.groupId;
      recipients = members;
    }
    break;
  }
  const id = await uuidv7(tx);
  await tx
    .insertInto("decision_escalation")
    .values({
      id,
      organization_id: d.organization_id,
      transformation_id: d.transformation_id,
      decision_id: decisionId,
      sla_due_date: slaDueDate,
      business_date: businessDate,
      level,
      party_code: partyCode,
      target_user_id: targetUserId,
      target_group_id: targetGroupId,
      routing_error: routingError,
      delay_impact: d.impact_of_delay,
    })
    .execute();
  await insertAuditEvent(tx, actor, {
    action: "decision_escalation.create",
    recordType: "decision_escalation",
    recordId: id,
    organizationId: d.organization_id,
    transformationId: d.transformation_id,
    changes: {
      decision_id: { from: null, to: decisionId },
      sla_due_date: { from: null, to: slaDueDate },
      level: { from: null, to: level },
      party_code: { from: null, to: partyCode },
      target_user_id: { from: null, to: targetUserId },
      target_group_id: { from: null, to: targetGroupId },
      routing_error: { from: null, to: routingError },
    },
  });
  // 3. Notify: the target(s) get a task; the owner and the creator a notice naming the delay impact and any error.
  const link = decisionLink(d.transformation_id, decisionId);
  const params = {
    code: d.code,
    title: d.title,
    slaDueDate,
    level,
    partyCode,
    routingError,
    delayImpact: d.impact_of_delay,
  };
  for (const userId of recipients)
    await createWorkItemOnce(tx, actor, {
      organizationId: d.organization_id,
      transformationId: d.transformation_id,
      kind: EXECUTIVE_DECISION_ESCALATED_KIND,
      assigneeUserId: userId,
      subjectType: "decision",
      subjectId: decisionId,
      linkPath: link,
      messageKey: EXECUTIVE_DECISION_ESCALATED_MESSAGE,
      messageParams: params,
      dueDate: null,
      dedupeKey: `t16.escalated:${decisionId}:${slaDueDate}:${userId}`,
    });
  for (const userId of new Set([d.owner_user_id, d.created_by].filter((x): x is string => x !== null)))
    await notifyOnce(tx, actor, {
      organizationId: d.organization_id,
      transformationId: d.transformation_id,
      recipientUserId: userId,
      linkPath: link,
      messageKey: ESCALATION_NOTICE,
      messageParams: params,
      dedupeKey: `t16.escalation_notice:${decisionId}:${slaDueDate}:${userId}`,
    });
  return { outcome: routingError === null ? "escalated" : "routing_error", level, routingError };
}

/** The scheduled decision-SLA scan (working days only, per organization). */
export async function handleDecisionSlaScan(db: Db, data: unknown, jobId: string): Promise<DecisionSlaScanResult> {
  const { organizationId } = scanData.parse(data ?? {});
  let orgs = db.selectFrom("organization").select("id");
  if (organizationId !== undefined) orgs = orgs.where("id", "=", organizationId);
  const organizations = await orgs.orderBy("id").execute();
  let scanned = 0;
  let skippedOrgs = 0;
  const asks: SlaEscalationOutcome[] = [];
  for (const org of organizations) {
    const tz =
      (
        await db
          .selectFrom("business_calendar")
          .select("timezone")
          .where("organization_id", "=", org.id)
          .where("is_default", "=", true)
          .where("status", "=", "active")
          .executeTakeFirst()
      )?.timezone ?? null;
    if (tz === null) {
      skippedOrgs += 1;
      continue;
    }
    const today = await businessDateIn(db, tz);
    const cal = await defaultCalendar(db, org.id, today);
    if (cal === null || !isWorkingDay(today, cal.calendar)) {
      skippedOrgs += 1;
      continue;
    }
    scanned += 1;
    const due = await db
      .selectFrom("decision")
      .select(["id", "sla_due_date"])
      .where("organization_id", "=", org.id)
      .where("kind", "=", "executive")
      .where("ask_origin", "is not", null)
      .where("status", "in", ["open", "deferred"])
      .where("sla_due_date", "is not", null)
      .where("sla_due_date", "<", today)
      .orderBy("sla_due_date")
      .orderBy("id")
      .limit(BATCH)
      .execute();
    for (const a of due) {
      const slaDueDate = a.sla_due_date!;
      const r = await runOnce(db, DECISION_SLA_SCAN_CONSUMER, `decision.escalate:${a.id}:${slaDueDate}`, (tx) =>
        escalateDecisionInTx(tx, jobActor(jobId), a.id, slaDueDate, today),
      );
      asks.push(
        r.outcome === "duplicate"
          ? { decisionId: a.id, outcome: "duplicate", level: null, routingError: null }
          : { decisionId: a.id, ...r.result },
      );
    }
  }
  return { organizationsScanned: scanned, organizationsSkipped: skippedOrgs, asks };
}

// ------------------------------------------------------------------------------------------------ blocker escalation

export interface BlockerEvaluation {
  readonly outcome:
    | "ask_created"
    | "ask_open"
    | "not_red_for_cycles"
    | "rule_disabled"
    | "calendar_not_configured"
    | "duplicate";
  readonly decisionId: string | null;
}

/** The blocker's name, the title of its ask (ADR-0032 §8.3 step 3). */
async function blockerName(tx: Tx, type: BlockerRecordType, id: string): Promise<string | null> {
  switch (type) {
    case "raid_entry":
      return (
        (await tx.selectFrom("raid_entry").select("description").where("id", "=", id).executeTakeFirst())
          ?.description ?? null
      );
    case "dependency":
      return (
        (await tx.selectFrom("dependency").select("description").where("id", "=", id).executeTakeFirst())
          ?.description ?? null
      );
    case "corrective_case":
      return (
        (await tx.selectFrom("corrective_case").select("title").where("id", "=", id).executeTakeFirst())?.title ?? null
      );
    case "initiative":
      return (await tx.selectFrom("initiative").select("name").where("id", "=", id).executeTakeFirst())?.name ?? null;
    case "milestone":
      return (await tx.selectFrom("milestone").select("title").where("id", "=", id).executeTakeFirst())?.title ?? null;
  }
}

/**
 * ADR-0032 §8.3: evaluates one blocker in one forum as of `cycleDate` in `tx` (the caller holds the ledger row), and
 * creates at most one open executive ask for it.
 */
export async function evaluateBlocker(
  tx: Tx,
  jobId: string,
  b: {
    readonly transformationId: string;
    readonly forumId: string;
    readonly sourceRecordType: BlockerRecordType;
    readonly sourceRecordId: string;
    readonly cycleDate: string;
  },
): Promise<BlockerEvaluation> {
  const key = `${b.transformationId}:${b.sourceRecordType}:${b.sourceRecordId}`;
  await sql`SELECT pg_advisory_xact_lock(${EXECUTIVE_ASK_BLOCKER_LOCK_CLASS}::integer, hashtext(${key}::text))`.execute(
    tx,
  );
  // 1. The rule.
  const stored = await tx
    .selectFrom("governance_escalation_rule")
    .selectAll()
    .where("transformation_id", "=", b.transformationId)
    .where("rule_kind", "=", "blocker_red")
    .executeTakeFirst();
  const defaults = ESCALATION_RULE_DEFAULTS.blocker_red;
  const enabled = stored ? stored.enabled : defaults.enabled;
  if (!enabled) return { outcome: "rule_disabled", decisionId: null };
  const n = stored?.red_cycles ?? defaults.redCycles;
  const deadline = stored?.deadline_working_days ?? defaults.deadlineWorkingDays;
  const ownerParty = stored?.owner_party_code ?? defaults.ownerPartyCode;
  // 2. The latest N cycles of the forum and the blocker's observation in each.
  const meetings = await tx
    .selectFrom("meeting")
    .select(["id", "scheduled_date"])
    .where("forum_id", "=", b.forumId)
    .where("status", "in", ["in_session", "held", "minutes_published"])
    .where("scheduled_date", "<=", b.cycleDate)
    .orderBy("scheduled_date", "desc")
    .orderBy("id", "desc")
    .limit(n)
    .execute();
  const observations =
    meetings.length === 0
      ? []
      : await tx
          .selectFrom("blocker_status")
          .select(["meeting_id", "rag", "created_by", "created_at"])
          .where(
            "meeting_id",
            "in",
            meetings.map((m) => m.id),
          )
          .where("source_record_type", "=", b.sourceRecordType)
          .where("source_record_id", "=", b.sourceRecordId)
          .execute();
  const cycles = meetings.map(
    (m) => (observations.find((o) => o.meeting_id === m.id)?.rag ?? null) as BlockerRag | null,
  );
  if (!redForCycles(cycles, n)) return { outcome: "not_red_for_cycles", decisionId: null };
  // 3. No duplicate of an open ask, whatever its origin.
  const open = await tx
    .selectFrom("decision")
    .select("id")
    .where("transformation_id", "=", b.transformationId)
    .where("blocker_record_type", "=", b.sourceRecordType)
    .where("blocker_record_id", "=", b.sourceRecordId)
    .where("status", "in", ["open", "deferred"])
    .executeTakeFirst();
  if (open) return { outcome: "ask_open", decisionId: open.id };
  const t = await tx
    .selectFrom("transformation")
    .select(["organization_id", "lead_user_id"])
    .where("id", "=", b.transformationId)
    .executeTakeFirstOrThrow();
  // The person whose observation completed the N-th red cycle (the newest cycle's observation).
  const trigger = observations.find((o) => o.meeting_id === meetings[0]!.id)!;
  const recorder = trigger.created_by;
  const actor: AuditActor = {
    actorType: "system",
    actorUserId: null,
    onBehalfOfUserId: recorder,
    requestId: `job:${jobId}`,
    source: "worker",
  };
  // 4. The deadline on the business calendar; without one, a visible gap (never a guessed date).
  const cal = await defaultCalendar(tx, t.organization_id, b.cycleDate);
  const due = addWorkingDays(b.cycleDate, deadline, cal?.calendar ?? null);
  if (due.dueDate === null) {
    await notifyOnce(tx, jobActor(jobId), {
      organizationId: t.organization_id,
      transformationId: b.transformationId,
      recipientUserId: t.lead_user_id ?? recorder,
      linkPath: `/transformations/${b.transformationId}/executive-decisions`,
      messageKey: BLOCKER_CALENDAR_NOTICE,
      messageParams: { sourceRecordType: b.sourceRecordType, sourceRecordId: b.sourceRecordId, redCycles: n },
      dedupeKey: `t16.blocker_calendar:${b.sourceRecordId}:${b.cycleDate}`,
    });
    return { outcome: "calendar_not_configured", decisionId: null };
  }
  const name = (await blockerName(tx, b.sourceRecordType, b.sourceRecordId)) ?? b.sourceRecordId;
  const title = truncateText(name, 500);
  let owner: string | null = null;
  const party = await resolveParty(tx, b.transformationId, ownerParty);
  if (party.status === "mapped" && party.kind === "user") {
    const ok = await executivesAmong(tx, [party.userId], b.transformationId);
    owner = ok.length > 0 ? party.userId : null;
  }
  const counter = await sql<{ last_value: number }>`
    INSERT INTO record_code_counter (transformation_id, prefix, last_value) VALUES (${b.transformationId}::uuid, 'DEC', 1)
    ON CONFLICT (transformation_id, prefix) DO UPDATE SET last_value = record_code_counter.last_value + 1
    RETURNING last_value`.execute(tx);
  const code = decCode(counter.rows[0]!.last_value);
  const id = await uuidv7(tx);
  await tx
    .insertInto("decision")
    .values({
      id,
      organization_id: t.organization_id,
      transformation_id: b.transformationId,
      kind: "executive",
      code,
      title,
      owner_user_id: owner,
      due_date: due.dueDate,
      context: null,
      recommendation_option_id: null,
      recommendation_text: null,
      chosen_option_id: null,
      outcome_text: null,
      decided_by: null,
      decided_at: null,
      tom_dimension_code: null,
      source_workshop_item_id: null,
      why_now: null,
      impact_of_delay: null,
      ask_origin: "blocker_escalation",
      created_source: "worker",
      source_agenda_item_id: null,
      decision_right_id: null,
      sla_due_date: due.dueDate,
      sla_unknown_reason: null,
      decided_on_behalf_of_user_id: null,
      blocker_record_type: b.sourceRecordType,
      blocker_record_id: b.sourceRecordId,
      created_by: recorder,
      updated_by: recorder,
    })
    .execute();
  await insertAuditEvent(tx, actor, {
    action: "executive_decision.create",
    recordType: "decision",
    recordId: id,
    organizationId: t.organization_id,
    transformationId: b.transformationId,
    newVersion: 1,
    reason: `Blocker red for ${n} consecutive cycles`,
    changes: {
      kind: { from: null, to: "executive" },
      code: { from: null, to: code },
      title: { from: null, to: title },
      ask_origin: { from: null, to: "blocker_escalation" },
      owner_user_id: { from: null, to: owner },
      due_date: { from: null, to: due.dueDate },
      sla_due_date: { from: null, to: due.dueDate },
      blocker_record_type: { from: null, to: b.sourceRecordType },
      blocker_record_id: { from: null, to: b.sourceRecordId },
    },
  });
  if (owner !== null)
    await createWorkItemOnce(tx, actor, {
      organizationId: t.organization_id,
      transformationId: b.transformationId,
      kind: EXECUTIVE_DECISION_DUE_KIND,
      assigneeUserId: owner,
      subjectType: "decision",
      subjectId: id,
      linkPath: decisionLink(b.transformationId, id),
      messageKey: EXECUTIVE_DECISION_DUE_MESSAGE,
      messageParams: { code, title },
      dueDate: due.dueDate,
      dedupeKey: `t16.decision:${id}:${owner}`,
    });
  return { outcome: "ask_created", decisionId: id };
}

/** The consumer of `blocker_status.recorded` (one evaluation per observation; a redelivery does nothing). */
export async function handleBlockerEscalation(db: Db, data: unknown, jobId: string): Promise<BlockerEvaluation> {
  const envelope = outboxEnvelope.parse(data);
  if (envelope.eventType !== BLOCKER_STATUS_RECORDED)
    throw new Error(`${BLOCKER_ESCALATION_CONSUMER}: unexpected event ${envelope.eventType}`);
  const p = blockerStatusRecordedV1.parse(envelope.payload);
  const r = await runOnce(db, BLOCKER_ESCALATION_CONSUMER, envelope.idempotencyKey, (tx) =>
    evaluateBlocker(tx, jobId, {
      transformationId: p.transformationId,
      forumId: p.forumId,
      sourceRecordType: p.sourceRecordType,
      sourceRecordId: p.sourceRecordId,
      cycleDate: p.cycleDate,
    }),
  );
  return r.outcome === "duplicate" ? { outcome: "duplicate", decisionId: null } : r.result;
}

export interface BlockerScanResult {
  readonly evaluated: number;
  readonly created: readonly string[];
  readonly duplicates: number;
}

/**
 * The daily scan: every (forum, blocker) whose latest observation in the forum is red and that has no open ask, as of
 * that latest cycle (it catches a missed event and an ask whose calendar was configured later). One runOnce
 * transaction per (forum, blocker) and business date.
 */
export async function handleBlockerEscalationScan(db: Db, data: unknown, jobId: string): Promise<BlockerScanResult> {
  const { organizationId } = scanData.parse(data ?? {});
  let q = db
    .selectFrom("blocker_status as s")
    .select([
      "s.transformation_id",
      "s.forum_id",
      "s.source_record_type",
      "s.source_record_id",
      sql<string>`max(s.cycle_date)::text`.as("latest"),
      sql<string>`p4_business_date(now(), 'Asia/Riyadh')::text`.as("today"),
    ])
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom("decision as d")
            .select("d.id")
            .whereRef("d.transformation_id", "=", "s.transformation_id")
            .whereRef("d.blocker_record_type", "=", "s.source_record_type")
            .whereRef("d.blocker_record_id", "=", "s.source_record_id")
            .where("d.status", "in", ["open", "deferred"]),
        ),
      ),
    )
    .groupBy(["s.transformation_id", "s.forum_id", "s.source_record_type", "s.source_record_id"]);
  if (organizationId !== undefined) q = q.where("s.organization_id", "=", organizationId);
  const candidates = await q.orderBy("s.transformation_id").limit(BATCH).execute();
  const created: string[] = [];
  let duplicates = 0;
  for (const c of candidates) {
    const key = `blocker_escalation_scan:${c.forum_id}:${c.source_record_type}:${c.source_record_id}:${c.today}`;
    const r = await runOnce(db, BLOCKER_ESCALATION_SCAN_CONSUMER, key, (tx) =>
      evaluateBlocker(tx, jobId, {
        transformationId: c.transformation_id,
        forumId: c.forum_id,
        sourceRecordType: c.source_record_type as BlockerRecordType,
        sourceRecordId: c.source_record_id,
        cycleDate: c.latest,
      }),
    );
    if (r.outcome === "duplicate") duplicates += 1;
    else if (r.result.outcome === "ask_created" && r.result.decisionId !== null) created.push(r.result.decisionId);
  }
  return { evaluated: candidates.length, created, duplicates };
}

export const ESCALATIONS_HANDLERS: readonly JobHandler[] = [
  { queue: DECISION_SLA_SCAN_QUEUE, handle: handleDecisionSlaScan },
  { queue: BLOCKER_ESCALATION_QUEUE, handle: handleBlockerEscalation },
  { queue: BLOCKER_ESCALATION_SCAN_QUEUE, handle: handleBlockerEscalationScan },
];
