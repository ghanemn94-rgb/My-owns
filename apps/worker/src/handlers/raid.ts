// raid job handlers (T-DG4-BE-D2; p4-work-split §E.2; stub by T-DG4-BE-A): the four corrective-action consumers of
// slice E and the engine they share (ADR-0031 §5.4-§5.6; REQ-PB-085, REQ-S12-016).
//
//   queue / consumer           event (producer)                                     source scope key
//   raid.corrective_kpi        kpi.deviation_evaluated (KBE-C, ADR-0027 §8)          <kpiDefinitionId>:<scopeKind>:<scopeId>
//   raid.corrective_benefit    benefit.variance_evaluated (KBE-E, ADR-0030 §6)       <benefitId>
//   raid.corrective_adoption   adoption.check_failed (slice F, ADR-0031 §5.4)        <checkId>
//   raid.corrective_control    control_check.failed (slice G, ADR-0031 §5.4)         <checkId>
//
// Each consumer runs under the kit's runOnce(consumer, <event idempotency key>, fn), so a redelivery, a retry or a
// restart does nothing twice; inside its one transaction applySignal:
//   1. takes pg_advisory_xact_lock(730236, hashtext('<transformationId>:<sourceKind>:<sourceScopeKey>')) before it
//      reads the open case (the API's Value Review create takes the same lock), and ignores an event whose key is
//      already in corrective_signal (the second line of defence, corrective_signal_event_key);
//   2. reads the transformation's rule for the kind, or the ADR-0031 §5.2 default (CORRECTIVE_RULE_DEFAULTS); a disabled
//      rule records the signal with outcome rule_disabled and stops;
//   3. counts the consecutive off-track periods (consecutiveOffTrack: the latest signal of each period, newest period
//      first; an on-track or Unknown period ends the run; 1 for a failed check);
//   4. updates the open case of the source when the signal is off track (consecutive count, signal count, last signal;
//      version + 1; audit corrective_case.signal_applied); an on-track or Unknown signal never edits or closes a case;
//   5. otherwise creates the case when the count reaches the rule's persistence (code CA-nn, created_source 'worker',
//      created_by NULL; audit corrective_case.created), with its owner (first active of the ADR-0031 §5.4 chain, else
//      NULL = unassigned and no work item), its follow-up date (addWorkingDays on the organization's default calendar
//      from the event's business date, with the calendar id and version; NULL = Unknown calendar_not_configured) and
//      the owner's corrective_case_follow_up work item (createWorkItemOnce);
//   6. appends the signal (append-only lineage, no audit event of its own) with its outcome.
// A failed check gets one case ever (corrective_case_one_per_check_key): a closed check case is never reopened.
// The worker never writes action_item (its created_by is NOT NULL; the case is the recovery action, ADR-0031 §6). The
// audit actor is the service (jobActor); a job never decides a business approval and never touches DG0-DG7.
//
// The engine lives here, not in apps/api/src/modules/raid/corrective-engine.ts as p4-work-split §E.2 lists it: the
// worker imports no API code (ADR-0002 rule 5; kit.ts). The rule parts both sides need are in @mth/shared/schemas
// (corrective.ts).
import { insertAuditEvent, sql, type AuditActor, type Db, type Tx } from "@mth/db";
import {
  benefitVarianceEvaluatedPayload,
  checkFailedPayload,
  consecutiveOffTrack,
  correctiveRuleDefault,
  kpiOffTrack,
  outboxEnvelope,
  outboxPayloadSchema,
  truncateText,
  type CorrectiveMinRag,
  type CorrectiveRuleKind,
  type CorrectiveRuleSettings,
  type OutboxEnvelope,
} from "@mth/shared/schemas";
import { addWorkingDays } from "@mth/shared/time";
import { createWorkItemOnce, jobActor, runOnce } from "../kit.ts";
import type { JobHandler } from "./spec.ts";

/** ADR-0016 §6 / apps/api platform/advisory-locks.ts `correctiveCase` (the worker imports no API code). */
export const CORRECTIVE_CASE_LOCK_CLASS = 730236;
export const CORRECTIVE_FOLLOW_UP_KIND = "corrective_case_follow_up";
export const CORRECTIVE_FOLLOW_UP_MESSAGE = "raid.task.corrective_follow_up";

export const CORRECTIVE_CONSUMERS = {
  kpi: "raid.corrective_kpi",
  benefit: "raid.corrective_benefit",
  adoption: "raid.corrective_adoption",
  control: "raid.corrective_control",
} as const;

/** The event each consumer accepts (its queue receives only this type; queues/raid.ts). */
export const CORRECTIVE_EVENTS = {
  kpi: "kpi.deviation_evaluated",
  benefit: "benefit.variance_evaluated",
  adoption: "adoption.check_failed",
  control: "control_check.failed",
} as const;

// ------------------------------------------------------------------------------------------------ the engine

/** The source fields of a case, by kind (CHECK corrective_case_source_fields). */
export type SignalSource =
  | {
      readonly kind: "kpi_deviation";
      readonly kpiDefinitionId: string;
      readonly scopeKind: string;
      readonly scopeId: string;
    }
  | { readonly kind: "benefit_variance"; readonly benefitId: string }
  | {
      readonly kind: "adoption_check" | "control_check";
      readonly recordType: string;
      readonly recordId: string;
      readonly ownerUserId: string | null;
    };

/** One consumed event, normalised by its consumer. */
export interface SignalInput {
  readonly organizationId: string;
  readonly transformationId: string;
  readonly source: SignalSource;
  readonly sourceScopeKey: string;
  /** The producer's idempotency key (corrective_signal_event_key). */
  readonly sourceEventKey: string;
  readonly periodKey: string;
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
  /** KPI only: the evaluation's calculated RAG (the off-track reading depends on the rule's severity). */
  readonly calculatedRag?: string;
  /** Benefit: the payload's offTrack (null = Unknown). Ignored for KPI (from the RAG) and checks (always true). */
  readonly offTrack?: boolean | null;
  /** The case title: the source's own name (S-6: user data, not a system sentence). */
  readonly title: string;
  /** The event's business date (the check payload's; for KPI and benefit events, from the event's creation time). */
  readonly businessDate: string | null;
  readonly payload: Record<string, unknown>;
}

export type SignalOutcome = "recorded" | "case_created" | "case_updated" | "rule_disabled" | "duplicate_event";

export interface ApplySignalResult {
  readonly outcome: SignalOutcome;
  readonly correctiveCaseId: string | null;
  readonly consecutiveOffTrack: number | null;
}

const isSeries = (kind: CorrectiveRuleKind) => kind === "kpi_deviation" || kind === "benefit_variance";

async function ruleOf(tx: Tx, transformationId: string, kind: CorrectiveRuleKind): Promise<CorrectiveRuleSettings> {
  const row = await tx
    .selectFrom("corrective_action_rule")
    .select(["min_kpi_rag", "persistence_cycles", "follow_up_working_days", "enabled"])
    .where("transformation_id", "=", transformationId)
    .where("source_kind", "=", kind)
    .executeTakeFirst();
  if (!row) return correctiveRuleDefault(kind);
  return {
    sourceKind: kind,
    minKpiRag: row.min_kpi_rag as CorrectiveMinRag | null,
    persistenceCycles: row.persistence_cycles,
    followUpWorkingDays: row.follow_up_working_days,
    enabled: row.enabled,
  };
}

/** The first active user of the organization among `candidates`, in order (ADR-0031 §5.4 owner chain). */
async function firstActiveUser(
  tx: Tx,
  organizationId: string,
  candidates: readonly (string | null | undefined)[],
): Promise<string | null> {
  const ids = candidates.filter((c): c is string => typeof c === "string");
  if (ids.length === 0) return null;
  const active = new Set(
    (
      await tx
        .selectFrom("app_user")
        .select("id")
        .where("id", "in", ids)
        .where("organization_id", "=", organizationId)
        .where("status", "=", "active")
        .execute()
    ).map((r) => r.id),
  );
  return ids.find((id) => active.has(id)) ?? null;
}

async function resolveOwner(tx: Tx, s: SignalInput): Promise<string | null> {
  const t = await tx
    .selectFrom("transformation")
    .select("lead_user_id")
    .where("id", "=", s.transformationId)
    .executeTakeFirst();
  const lead = t?.lead_user_id ?? null;
  const src = s.source;
  if (src.kind === "kpi_deviation") {
    const k = await tx
      .selectFrom("kpi_definition")
      .select(["owner_user_id", "steward_user_id"])
      .where("id", "=", src.kpiDefinitionId)
      .executeTakeFirst();
    return firstActiveUser(tx, s.organizationId, [k?.owner_user_id, k?.steward_user_id, lead]);
  }
  if (src.kind === "benefit_variance") {
    const b = await tx.selectFrom("benefit").select("owner_user_id").where("id", "=", src.benefitId).executeTakeFirst();
    return firstActiveUser(tx, s.organizationId, [b?.owner_user_id]);
  }
  return firstActiveUser(tx, s.organizationId, [src.ownerUserId, lead]);
}

/** The follow-up date on the organization's active default calendar, with that calendar; Unknown when none. */
async function followUpOf(
  tx: Tx,
  organizationId: string,
  businessDate: string | null,
  workingDays: number,
): Promise<{ date: string | null; calendarId: string | null; calendarVersion: number | null }> {
  const unknown = { date: null, calendarId: null, calendarVersion: null };
  const cal = await tx
    .selectFrom("business_calendar")
    .select(["id", "version", "workweek"])
    .where("organization_id", "=", organizationId)
    .where("is_default", "=", true)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (!cal || businessDate === null) return unknown;
  const holidays = await tx
    .selectFrom("business_calendar_holiday")
    .select([sql<string>`date_from::text`.as("dateFrom"), sql<string>`date_to::text`.as("dateTo")])
    .where("calendar_id", "=", cal.id)
    .where("status", "=", "active")
    .execute();
  const r = addWorkingDays(businessDate, workingDays, { workweek: cal.workweek.map(Number), holidays });
  if (r.dueDate === null) return unknown;
  return { date: r.dueDate, calendarId: cal.id, calendarVersion: cal.version };
}

async function nextCaseCode(tx: Tx, transformationId: string): Promise<string> {
  const row = await sql<{ last_value: number }>`
    INSERT INTO record_code_counter (transformation_id, prefix, last_value) VALUES (${transformationId}::uuid, 'CA', 1)
    ON CONFLICT (transformation_id, prefix) DO UPDATE SET last_value = record_code_counter.last_value + 1
    RETURNING last_value`.execute(tx);
  return `CA-${String(row.rows[0]!.last_value).padStart(2, "0")}`;
}

async function newId(tx: Tx): Promise<string> {
  const r = await sql<{ id: string }>`SELECT mth_uuid_v7() AS id`.execute(tx);
  return r.rows[0]!.id;
}

/**
 * Applies one source signal (ADR-0031 §5.4 steps 1-6) inside `tx`, the caller's runOnce transaction. Returns the
 * signal's outcome; `duplicate_event` when the event key is already recorded (nothing written).
 */
export async function applySignal(tx: Tx, actor: AuditActor, s: SignalInput): Promise<ApplySignalResult> {
  const kind = s.source.kind;
  await sql`SELECT pg_advisory_xact_lock(${CORRECTIVE_CASE_LOCK_CLASS}::int4,
    hashtext(${`${s.transformationId}:${kind}:${s.sourceScopeKey}`}))`.execute(tx);
  const seen = await tx
    .selectFrom("corrective_signal")
    .select("id")
    .where("source_event_key", "=", s.sourceEventKey)
    .executeTakeFirst();
  if (seen) return { outcome: "duplicate_event", correctiveCaseId: null, consecutiveOffTrack: null };

  const rule = await ruleOf(tx, s.transformationId, kind);
  const offTrack: boolean | null =
    kind === "kpi_deviation"
      ? kpiOffTrack(s.calculatedRag ?? "unknown", rule.minKpiRag ?? "red")
      : kind === "benefit_variance"
        ? (s.offTrack ?? null)
        : true;

  const insertSignal = async (
    outcome: Exclude<SignalOutcome, "duplicate_event">,
    caseId: string | null,
    count: number | null,
  ) => {
    await tx
      .insertInto("corrective_signal")
      .values({
        id: await newId(tx),
        organization_id: s.organizationId,
        transformation_id: s.transformationId,
        source_kind: kind,
        source_scope_key: s.sourceScopeKey,
        source_event_key: s.sourceEventKey,
        period_key: s.periodKey,
        period_start: s.periodStart,
        period_end: s.periodEnd,
        observed_rag: kind === "kpi_deviation" ? (s.calculatedRag ?? null) : null,
        off_track: offTrack,
        rule_persistence: rule.persistenceCycles,
        consecutive_off_track: count,
        outcome,
        corrective_case_id: caseId,
        payload: JSON.stringify(s.payload),
      })
      .execute();
    return { outcome, correctiveCaseId: caseId, consecutiveOffTrack: count };
  };

  if (!rule.enabled) return insertSignal("rule_disabled", null, null);

  let count = offTrack === true ? 1 : 0;
  if (isSeries(kind)) {
    const prior = await tx
      .selectFrom("corrective_signal")
      .select([
        "period_key",
        sql<string | null>`period_start::text`.as("period_start"),
        sql<number>`(extract(epoch from received_at) * 1000000)::float8`.as("received_us"),
        "off_track",
      ])
      .where("transformation_id", "=", s.transformationId)
      .where("source_kind", "=", kind)
      .where("source_scope_key", "=", s.sourceScopeKey)
      .execute();
    count = consecutiveOffTrack([
      ...prior.map((p) => ({
        periodKey: p.period_key,
        periodStart: p.period_start,
        receivedOrder: Number(p.received_us),
        offTrack: p.off_track,
      })),
      { periodKey: s.periodKey, periodStart: s.periodStart, receivedOrder: Number.MAX_SAFE_INTEGER, offTrack },
    ]);
  }

  const open = await tx
    .selectFrom("corrective_case")
    .selectAll()
    .where("transformation_id", "=", s.transformationId)
    .where("source_kind", "=", kind)
    .where("source_scope_key", "=", s.sourceScopeKey)
    .where("status", "<>", "closed")
    .forUpdate()
    .executeTakeFirst();

  if (open) {
    // Step 4: an off-track signal updates the open case; anything else never edits or closes it.
    if (offTrack !== true) return insertSignal("recorded", null, count);
    const updated = await tx
      .updateTable("corrective_case")
      .set({
        consecutive_off_track: count,
        signal_count: sql<number>`signal_count + 1`,
        last_signal_at: sql<Date>`now()`,
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`,
        updated_by: null,
      })
      .where("id", "=", open.id)
      .where("version", "=", open.version)
      .returningAll()
      .executeTakeFirstOrThrow();
    await insertAuditEvent(tx, actor, {
      action: "corrective_case.signal_applied",
      recordType: "corrective_case",
      recordId: open.id,
      organizationId: s.organizationId,
      transformationId: s.transformationId,
      priorVersion: open.version,
      newVersion: updated.version,
      changes: {
        consecutive_off_track: { from: open.consecutive_off_track, to: updated.consecutive_off_track },
        signal_count: { from: open.signal_count, to: updated.signal_count },
        source_event_key: { from: null, to: s.sourceEventKey },
      },
    });
    return insertSignal("case_updated", open.id, count);
  }

  if (offTrack !== true || count < rule.persistenceCycles) return insertSignal("recorded", null, count);
  if (!isSeries(kind)) {
    // A failed check gets one case ever: a closed case for this check is never reopened or duplicated.
    const any = await tx
      .selectFrom("corrective_case")
      .select("id")
      .where("transformation_id", "=", s.transformationId)
      .where("source_kind", "=", kind)
      .where("source_scope_key", "=", s.sourceScopeKey)
      .executeTakeFirst();
    if (any) return insertSignal("recorded", null, count);
  }

  // Step 5: create the case, its owner's follow-up item, and the signal.
  const owner = await resolveOwner(tx, s);
  const followUp = await followUpOf(tx, s.organizationId, s.businessDate, rule.followUpWorkingDays);
  const id = await newId(tx);
  const src = s.source;
  const row = await tx
    .insertInto("corrective_case")
    .values({
      id,
      organization_id: s.organizationId,
      transformation_id: s.transformationId,
      code: await nextCaseCode(tx, s.transformationId),
      source_kind: kind,
      source_scope_key: s.sourceScopeKey,
      kpi_definition_id: src.kind === "kpi_deviation" ? src.kpiDefinitionId : null,
      kpi_scope_kind: src.kind === "kpi_deviation" ? src.scopeKind : null,
      kpi_scope_id: src.kind === "kpi_deviation" ? src.scopeId : null,
      benefit_id: src.kind === "benefit_variance" ? src.benefitId : null,
      source_record_type: src.kind === "adoption_check" || src.kind === "control_check" ? src.recordType : null,
      source_record_id: src.kind === "adoption_check" || src.kind === "control_check" ? src.recordId : null,
      title: truncateText(s.title, 500),
      owner_user_id: owner,
      follow_up_date: followUp.date,
      follow_up_calendar_id: followUp.calendarId,
      follow_up_calendar_version: followUp.calendarVersion,
      consecutive_off_track: count,
      signal_count: 1,
      last_signal_at: sql<Date>`now()`,
      created_source: "worker",
      created_by: null,
      updated_by: null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await insertAuditEvent(tx, actor, {
    action: "corrective_case.created",
    recordType: "corrective_case",
    recordId: id,
    organizationId: s.organizationId,
    transformationId: s.transformationId,
    newVersion: row.version,
    changes: {
      code: { from: null, to: row.code },
      source_kind: { from: null, to: kind },
      source_scope_key: { from: null, to: s.sourceScopeKey },
      owner_user_id: { from: null, to: owner },
      follow_up_date: { from: null, to: followUp.date },
      consecutive_off_track: { from: null, to: count },
      source_event_key: { from: null, to: s.sourceEventKey },
    },
  });
  if (owner !== null)
    await createWorkItemOnce(tx, actor, {
      organizationId: s.organizationId,
      transformationId: s.transformationId,
      kind: CORRECTIVE_FOLLOW_UP_KIND,
      assigneeUserId: owner,
      subjectType: "corrective_case",
      subjectId: id,
      linkPath: `/transformations/${s.transformationId}/corrective-actions/${id}`,
      messageKey: CORRECTIVE_FOLLOW_UP_MESSAGE,
      messageParams: { caseCode: row.code },
      dueDate: followUp.date,
      dedupeKey: `corrective.follow_up:${id}:${owner}`,
    });
  return insertSignal("case_created", id, count);
}

// ------------------------------------------------------------------------------------------------ the consumers

/** The business date of an event's creation in the organization's default calendar timezone (else its default). */
async function eventBusinessDate(tx: Tx, envelope: OutboxEnvelope): Promise<string> {
  const r = await sql<{ d: string }>`
    SELECT p4_business_date(
      coalesce((SELECT e.created_at FROM outbox_event e WHERE e.id = ${envelope.outboxEventId}::uuid), now()),
      coalesce(
        (SELECT c.timezone FROM business_calendar c
          WHERE c.organization_id = ${envelope.organizationId}::uuid AND c.is_default AND c.status = 'active' LIMIT 1),
        (SELECT o.default_timezone FROM organization o WHERE o.id = ${envelope.organizationId}::uuid)))::text AS d`.execute(
    tx,
  );
  return r.rows[0]!.d;
}

function envelopeFor(data: unknown, expected: string): OutboxEnvelope {
  const envelope = outboxEnvelope.parse(data);
  if (envelope.eventType !== expected)
    throw new Error(`raid consumer for ${expected} received ${envelope.eventType} (queue mapping error)`);
  return envelope;
}

export interface ConsumerResult {
  readonly outcome: "done" | "duplicate";
  readonly signal?: ApplySignalResult;
}

const done = (r: Awaited<ReturnType<typeof runOnce<ApplySignalResult>>>): ConsumerResult =>
  r.outcome === "duplicate" ? { outcome: "duplicate" } : { outcome: "done", signal: r.result };

/** raid.corrective_kpi: kpi.deviation_evaluated v1 (KBE-C's registered payload schema). */
export async function handleKpiDeviation(db: Db, data: unknown, jobId: string): Promise<ConsumerResult> {
  const envelope = envelopeFor(data, CORRECTIVE_EVENTS.kpi);
  const schema = outboxPayloadSchema(envelope.eventType, envelope.schemaVersion);
  if (!schema) throw new Error(`no schema for ${envelope.eventType} v${envelope.schemaVersion}`);
  const p = schema.parse(envelope.payload) as {
    evaluationId: string;
    transformationId: string;
    kpiDefinitionId: string;
    scopeKind: string;
    scopeId: string;
    reportingPeriodId: string;
    calculatedRag: string;
  };
  return done(
    await runOnce(db, CORRECTIVE_CONSUMERS.kpi, envelope.idempotencyKey, async (tx) => {
      const kpi = await tx
        .selectFrom("kpi_definition")
        .select(["name"])
        .where("id", "=", p.kpiDefinitionId)
        .where("transformation_id", "=", p.transformationId)
        .executeTakeFirstOrThrow();
      const period = await tx
        .selectFrom("reporting_period")
        .select([sql<string>`period_start::text`.as("start"), sql<string>`period_end::text`.as("end")])
        .where("id", "=", p.reportingPeriodId)
        .executeTakeFirstOrThrow();
      return applySignal(tx, jobActor(jobId), {
        organizationId: envelope.organizationId,
        transformationId: p.transformationId,
        source: {
          kind: "kpi_deviation",
          kpiDefinitionId: p.kpiDefinitionId,
          scopeKind: p.scopeKind,
          scopeId: p.scopeId,
        },
        sourceScopeKey: `${p.kpiDefinitionId}:${p.scopeKind}:${p.scopeId}`,
        sourceEventKey: envelope.idempotencyKey,
        periodKey: p.reportingPeriodId,
        periodStart: period.start,
        periodEnd: period.end,
        calculatedRag: p.calculatedRag,
        title: kpi.name,
        businessDate: await eventBusinessDate(tx, envelope),
        payload: envelope.payload,
      });
    }),
  );
}

/** raid.corrective_benefit: benefit.variance_evaluated (ADR-0030 §6; loose until KBE-E registers its schema). */
export async function handleBenefitVariance(db: Db, data: unknown, jobId: string): Promise<ConsumerResult> {
  const envelope = envelopeFor(data, CORRECTIVE_EVENTS.benefit);
  const registered = outboxPayloadSchema(envelope.eventType, envelope.schemaVersion);
  if (registered) registered.parse(envelope.payload);
  const p = benefitVarianceEvaluatedPayload.parse(envelope.payload);
  return done(
    await runOnce(db, CORRECTIVE_CONSUMERS.benefit, envelope.idempotencyKey, async (tx) => {
      const benefit = await tx
        .selectFrom("benefit")
        .select(["transformation_id", "organization_id", "title"])
        .where("id", "=", p.benefitId)
        .executeTakeFirstOrThrow();
      if (benefit.organization_id !== envelope.organizationId)
        throw new Error(`benefit ${p.benefitId} is not in organization ${envelope.organizationId}`);
      return applySignal(tx, jobActor(jobId), {
        organizationId: envelope.organizationId,
        transformationId: benefit.transformation_id,
        source: { kind: "benefit_variance", benefitId: p.benefitId },
        sourceScopeKey: p.benefitId,
        sourceEventKey: envelope.idempotencyKey,
        periodKey: `${p.periodStart}..${p.periodEnd}`,
        periodStart: p.periodStart,
        periodEnd: p.periodEnd,
        offTrack: p.offTrack,
        title: benefit.title,
        businessDate: await eventBusinessDate(tx, envelope),
        payload: envelope.payload,
      });
    }),
  );
}

function checkHandler(which: "adoption" | "control") {
  const kind = which === "adoption" ? ("adoption_check" as const) : ("control_check" as const);
  return async (db: Db, data: unknown, jobId: string): Promise<ConsumerResult> => {
    const envelope = envelopeFor(data, CORRECTIVE_EVENTS[which]);
    const registered = outboxPayloadSchema(envelope.eventType, envelope.schemaVersion);
    if (registered) registered.parse(envelope.payload);
    const p = checkFailedPayload.parse(envelope.payload);
    return done(
      await runOnce(db, CORRECTIVE_CONSUMERS[which], envelope.idempotencyKey, async (tx) => {
        const t = await tx
          .selectFrom("transformation")
          .select("organization_id")
          .where("id", "=", p.transformationId)
          .executeTakeFirstOrThrow();
        if (t.organization_id !== envelope.organizationId)
          throw new Error(`transformation ${p.transformationId} is not in organization ${envelope.organizationId}`);
        return applySignal(tx, jobActor(jobId), {
          organizationId: envelope.organizationId,
          transformationId: p.transformationId,
          source: { kind, recordType: p.checkRecordType, recordId: p.checkId, ownerUserId: p.ownerUserId },
          sourceScopeKey: p.checkId,
          sourceEventKey: envelope.idempotencyKey,
          periodKey: p.checkId,
          periodStart: null,
          periodEnd: null,
          title: p.subjectLabel,
          businessDate: p.businessDate,
          payload: envelope.payload,
        });
      }),
    );
  };
}

export const handleAdoptionCheckFailed = checkHandler("adoption");
export const handleControlCheckFailed = checkHandler("control");

export const RAID_HANDLERS: readonly JobHandler[] = [
  { queue: CORRECTIVE_CONSUMERS.kpi, handle: handleKpiDeviation },
  { queue: CORRECTIVE_CONSUMERS.benefit, handle: handleBenefitVariance },
  { queue: CORRECTIVE_CONSUMERS.adoption, handle: handleAdoptionCheckFailed },
  { queue: CORRECTIVE_CONSUMERS.control, handle: handleControlCheckFailed },
];
