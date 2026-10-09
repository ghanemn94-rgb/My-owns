// The four corrective-action consumers against a real PostgreSQL with pg-boss (T-DG4-BE-D2; p4-work-split §E.2;
// ADR-0031 §5.4-§5.6; REQ-PB-085, REQ-S12-016). The producers (KBE-C's kpi.deviation_evaluated is merged; KBE-E's
// benefit.variance_evaluated and the slice F/G check events are not) are replaced by SYNTHETIC envelopes, as §E.2 says.
// Proves:
//  - under the default two-cycle red rule, red in periods 1 and 2 opens exactly one case at the second event and red in
//    period 3 updates it (version + 1, consecutiveOffTrack 3, still one case); a redelivered event changes nothing;
//  - an amber, Unknown or green period ends the run and never closes or edits the case;
//  - a benefit offTrack: true opens one case and a repeated evaluation updates it; offTrack null (Unknown) never does;
//  - control_check.failed through the relay-shaped queue and the production worker opens one case with its owner, a
//    follow-up date 5 working days after the business date on the default calendar, and one corrective_case_follow_up
//    work item; a redelivery and a restarted worker create none; adoption.check_failed opens one case too;
//  - an unresolved owner gives owner NULL (unassigned) and no work item; no default calendar gives a NULL follow-up date;
//  - a disabled rule records the signal (rule_disabled) and opens nothing;
//  - worker cases have created_by NULL and a service audit actor; the worker never writes action_item.
// All data is SYNTHETIC; no job decides a business approval or touches the engineering gates DG0-DG7.
import { insertAuditEvent, type Db } from "@mth/db";
import type { OutboxEnvelope } from "@mth/shared/schemas";
import type PgBoss from "pg-boss";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CORRECTIVE_CONSUMERS,
  handleAdoptionCheckFailed,
  handleBenefitVariance,
  handleControlCheckFailed,
  handleKpiDeviation,
  RAID_HANDLERS,
} from "../../src/handlers/raid.ts";
import { ensureQueues, QUEUE_FOR_EVENT } from "../../src/queues/index.ts";
import { startWorker, type RunningWorker } from "../../src/worker.ts";
import { bossFor, seedTransformationWithOutbox, waitFor, workerEnv, type WorkerEnv } from "../support.ts";

let env: WorkerEnv;
let boss: PgBoss;
beforeAll(async () => {
  env = await workerEnv();
  boss = bossFor(env.appUrl);
  boss.on("error", () => undefined);
  await boss.start();
  await ensureQueues(boss);
}, 60_000);
afterAll(async () => {
  await boss.stop({ graceful: false, wait: true, timeout: 5000 });
  await env.close();
});

const quiet = { info: () => undefined, error: () => undefined };
const actor = (userId: string) =>
  ({ actorType: "user", actorUserId: userId, requestId: `test-${randomUUID()}`, source: "api" }) as const;

interface World {
  readonly organizationId: string;
  readonly transformationId: string;
  readonly userId: string;
}

/** A transformation (org, BU, one active user); optionally the organization's default calendar (Sun-Thu, Riyadh). */
async function seedWorld(db: Db, withCalendar: boolean): Promise<World> {
  const { transformationId, userId } = await seedTransformationWithOutbox(db);
  const t = await db
    .selectFrom("transformation")
    .select("organization_id")
    .where("id", "=", transformationId)
    .executeTakeFirstOrThrow();
  if (withCalendar)
    await db.transaction().execute(async (tx) => {
      const id = randomUUID();
      await tx
        .insertInto("business_calendar")
        .values({
          id,
          organization_id: t.organization_id,
          code: "DEFAULT",
          name_en: "Synthetic default calendar",
          name_ar: "تقويم",
          timezone: "Asia/Riyadh",
          is_default: true,
          created_by: userId,
          updated_by: userId,
        })
        .execute();
      await insertAuditEvent(tx, actor(userId), {
        action: "business_calendar.create",
        recordType: "business_calendar",
        recordId: id,
        organizationId: t.organization_id,
        newVersion: 1,
      });
    });
  return { organizationId: t.organization_id, transformationId, userId };
}

async function addUser(db: Db, w: World, status: "active" | "disabled" = "active"): Promise<string> {
  const id = randomUUID();
  await db
    .insertInto("app_user")
    .values({
      id,
      organization_id: w.organizationId,
      display_name: "Synthetic user",
      status,
      created_by: null,
      updated_by: null,
    })
    .execute();
  return id;
}

async function addKpi(db: Db, w: World, name: string, ownerUserId: string | null): Promise<string> {
  const id = randomUUID();
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto("kpi_definition")
      .values({
        id,
        organization_id: w.organizationId,
        transformation_id: w.transformationId,
        name,
        unit_kind: "count",
        unit_label: "lines",
        polarity: "higher_is_better",
        frequency: "monthly",
        status: "active",
        owner_user_id: ownerUserId,
        created_by: w.userId,
        updated_by: w.userId,
      })
      .execute();
    await insertAuditEvent(tx, actor(w.userId), {
      action: "kpi_definition.create",
      recordType: "kpi_definition",
      recordId: id,
      organizationId: w.organizationId,
      transformationId: w.transformationId,
      newVersion: 1,
    });
  });
  return id;
}

/** Monthly reporting periods 2026-01 .. 2026-0n of the organization. */
async function addPeriods(db: Db, w: World, n: number): Promise<string[]> {
  const ids: string[] = [];
  for (let m = 1; m <= n; m++) {
    const id = randomUUID();
    const mm = String(m).padStart(2, "0");
    await db.transaction().execute(async (tx) => {
      await tx
        .insertInto("reporting_period")
        .values({
          id,
          organization_id: w.organizationId,
          frequency: "monthly",
          period_label: `2026-${mm}`,
          period_start: `2026-${mm}-01`,
          period_end: `2026-${mm}-28`,
          created_by: w.userId,
          updated_by: w.userId,
        })
        .execute();
      await insertAuditEvent(tx, actor(w.userId), {
        action: "reporting_period.create",
        recordType: "reporting_period",
        recordId: id,
        organizationId: w.organizationId,
        newVersion: 1,
      });
    });
    ids.push(id);
  }
  return ids;
}

async function addBenefit(db: Db, w: World, ownerUserId: string): Promise<string> {
  const id = randomUUID();
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto("benefit")
      .values({
        id,
        organization_id: w.organizationId,
        transformation_id: w.transformationId,
        code: "B01",
        title: "Synthetic opex saving",
        description: "Synthetic benefit for the corrective consumer test",
        benefit_type: "cost",
        value_class: "cash_saving",
        owner_user_id: ownerUserId,
        financial_statement_line: "Synthetic opex",
        currency: "SAR",
        created_by: w.userId,
        updated_by: w.userId,
      })
      .execute();
    await insertAuditEvent(tx, actor(w.userId), {
      action: "benefit.create",
      recordType: "benefit",
      recordId: id,
      organizationId: w.organizationId,
      transformationId: w.transformationId,
      newVersion: 1,
    });
  });
  return id;
}

const envelope = (w: World, eventType: string, idempotencyKey: string, payload: Record<string, unknown>) =>
  ({
    outboxEventId: randomUUID(),
    eventType,
    schemaVersion: 1,
    idempotencyKey,
    organizationId: w.organizationId,
    payload,
  }) satisfies OutboxEnvelope;

const kpiEvent = (w: World, kpiId: string, periodId: string, rag: string) => {
  const evaluationId = randomUUID();
  return envelope(w, "kpi.deviation_evaluated", `kpi.deviation_evaluated:${evaluationId}`, {
    evaluationId,
    transformationId: w.transformationId,
    kpiDefinitionId: kpiId,
    scopeKind: "transformation",
    scopeId: w.transformationId,
    reportingPeriodId: periodId,
    calculatedRag: rag,
    deviation: rag === "green" ? "within" : rag === "unknown" ? "unknown" : "adverse",
    previousCalculatedRag: null,
  });
};

const checkEvent = (w: World, type: "control_check.failed" | "adoption.check_failed", ownerUserId: string | null) => {
  const checkId = randomUUID();
  return envelope(w, type, `${type}:${checkId}`, {
    checkId,
    checkRecordType: type === "control_check.failed" ? "control_check" : "adoption_check",
    transformationId: w.transformationId,
    ownerUserId,
    subjectLabel: "Synthetic monthly reconciliation control",
    failedAt: "2026-10-08T07:00:00Z",
    businessDate: "2026-10-08",
  });
};

const casesOf = (db: Db, w: World, kind: string) =>
  db
    .selectFrom("corrective_case")
    .selectAll()
    .where("transformation_id", "=", w.transformationId)
    .where("source_kind", "=", kind)
    .orderBy("created_at")
    .execute();

const signalsOf = (db: Db, w: World, scopeKey: string) =>
  db
    .selectFrom("corrective_signal")
    .select(["outcome", "off_track", "consecutive_off_track", "corrective_case_id", "observed_rag"])
    .where("transformation_id", "=", w.transformationId)
    .where("source_scope_key", "=", scopeKey)
    .orderBy("id")
    .execute();

const tasksOf = (db: Db, caseId: string) =>
  db
    .selectFrom("work_item")
    .select(["kind", "assignee_user_id", "due_date", "dedupe_key", "status", "created_source", "created_by"])
    .where("subject_type", "=", "corrective_case")
    .where("subject_id", "=", caseId)
    .execute();

describe("the queue map (ADR-0031 §5.4)", () => {
  it("routes each producer event to its corrective consumer queue", () => {
    expect([
      QUEUE_FOR_EVENT["kpi.deviation_evaluated"],
      QUEUE_FOR_EVENT["benefit.variance_evaluated"],
      QUEUE_FOR_EVENT["adoption.check_failed"],
      QUEUE_FOR_EVENT["control_check.failed"],
    ]).toEqual([
      CORRECTIVE_CONSUMERS.kpi,
      CORRECTIVE_CONSUMERS.benefit,
      CORRECTIVE_CONSUMERS.adoption,
      CORRECTIVE_CONSUMERS.control,
    ]);
  });
});

describe("raid.corrective_kpi: the severity and persistence rule (REQ-PB-085)", () => {
  it("two-cycle red rule: one case at the second red period, the third red period updates it; replay is a no-op", async () => {
    const w = await seedWorld(env.db, true);
    const kpi = await addKpi(env.db, w, "Synthetic first-contact resolution", w.userId);
    const [p1, p2, p3] = await addPeriods(env.db, w, 3);
    const scope = `${kpi}:transformation:${w.transformationId}`;

    const r1 = await handleKpiDeviation(env.db, kpiEvent(w, kpi, p1!, "red"), "job-1");
    expect(r1.signal).toMatchObject({ outcome: "recorded", consecutiveOffTrack: 1 });
    expect(await casesOf(env.db, w, "kpi_deviation")).toEqual([]);

    const r2 = await handleKpiDeviation(env.db, kpiEvent(w, kpi, p2!, "red"), "job-2");
    expect(r2.signal).toMatchObject({ outcome: "case_created", consecutiveOffTrack: 2 });
    let cases = await casesOf(env.db, w, "kpi_deviation");
    expect(cases.map((c) => [c.code, c.status, c.version, c.consecutive_off_track, c.signal_count])).toEqual([
      ["CA-01", "open", 1, 2, 1],
    ]);
    expect(cases[0]).toMatchObject({
      title: "Synthetic first-contact resolution",
      source_scope_key: scope,
      kpi_definition_id: kpi,
      kpi_scope_kind: "transformation",
      kpi_scope_id: w.transformationId,
      owner_user_id: w.userId,
      created_source: "worker",
      created_by: null,
      updated_by: null,
    });

    const e3 = kpiEvent(w, kpi, p3!, "red");
    const r3 = await handleKpiDeviation(env.db, e3, "job-3");
    expect(r3.signal).toMatchObject({ outcome: "case_updated", consecutiveOffTrack: 3 });
    cases = await casesOf(env.db, w, "kpi_deviation");
    expect(cases.map((c) => [c.id, c.version, c.consecutive_off_track, c.signal_count])).toEqual([
      [cases[0]!.id, 2, 3, 2],
    ]);

    // A redelivered event (same idempotency key): the ledger makes it a no-op; nothing changes.
    expect(await handleKpiDeviation(env.db, e3, "job-3-redelivered")).toEqual({ outcome: "duplicate" });
    expect((await casesOf(env.db, w, "kpi_deviation")).map((c) => [c.version, c.signal_count])).toEqual([[2, 2]]);
    expect((await signalsOf(env.db, w, scope)).map((s) => s.outcome)).toEqual([
      "recorded",
      "case_created",
      "case_updated",
    ]);

    // Audit: created then signal_applied, both by the service actor from the worker (no human author).
    const audit = await env.db
      .selectFrom("audit_event")
      .select(["action", "actor_type", "actor_user_id", "new_version"])
      .where("record_id", "=", cases[0]!.id)
      .orderBy("occurred_at")
      .execute();
    expect(audit.map((a) => [a.action, a.actor_type, a.actor_user_id, a.new_version])).toEqual([
      ["corrective_case.created", "service", null, 1],
      ["corrective_case.signal_applied", "service", null, 2],
    ]);
    // The worker never writes action_item (ADR-0031 §6).
    expect(
      await env.db.selectFrom("action_item").select("id").where("transformation_id", "=", w.transformationId).execute(),
    ).toEqual([]);
  });

  it("an amber, Unknown or green period ends the run and never closes or edits the open case", async () => {
    const w = await seedWorld(env.db, true);
    const kpi = await addKpi(env.db, w, "Synthetic churn", w.userId);
    const periods = await addPeriods(env.db, w, 5);
    await handleKpiDeviation(env.db, kpiEvent(w, kpi, periods[0]!, "red"), "a1");
    await handleKpiDeviation(env.db, kpiEvent(w, kpi, periods[1]!, "red"), "a2");
    const before = (await casesOf(env.db, w, "kpi_deviation"))[0]!;
    for (const [i, rag] of [
      [2, "amber"],
      [3, "unknown"],
      [4, "green"],
    ] as const) {
      const r = await handleKpiDeviation(env.db, kpiEvent(w, kpi, periods[i]!, rag), `a${i + 1}`);
      expect([rag, r.signal?.outcome, r.signal?.consecutiveOffTrack]).toEqual([rag, "recorded", 0]);
    }
    const after = await casesOf(env.db, w, "kpi_deviation");
    expect(after.map((c) => [c.id, c.status, c.version, c.consecutive_off_track])).toEqual([[before.id, "open", 1, 2]]);
    const scope = `${kpi}:transformation:${w.transformationId}`;
    expect((await signalsOf(env.db, w, scope)).map((s) => [s.observed_rag, s.off_track])).toEqual([
      ["red", true],
      ["red", true],
      ["amber", false],
      ["unknown", null],
      ["green", false],
    ]);
  });

  it("an Unknown period between two red periods is not persistence: no case", async () => {
    const w = await seedWorld(env.db, true);
    const kpi = await addKpi(env.db, w, "Synthetic NPS", w.userId);
    const [p1, p2, p3] = await addPeriods(env.db, w, 3);
    await handleKpiDeviation(env.db, kpiEvent(w, kpi, p1!, "red"), "u1");
    await handleKpiDeviation(env.db, kpiEvent(w, kpi, p2!, "stale"), "u2");
    const r = await handleKpiDeviation(env.db, kpiEvent(w, kpi, p3!, "red"), "u3");
    expect(r.signal).toMatchObject({ outcome: "recorded", consecutiveOffTrack: 1 });
    expect(await casesOf(env.db, w, "kpi_deviation")).toEqual([]);
  });

  it("an owner chain without an active user gives an unassigned case and no work item; no calendar gives no date", async () => {
    const w = await seedWorld(env.db, false);
    const inactive = await addUser(env.db, w, "disabled");
    const kpi = await addKpi(env.db, w, "Synthetic billing accuracy", inactive);
    const [p1, p2] = await addPeriods(env.db, w, 2);
    await handleKpiDeviation(env.db, kpiEvent(w, kpi, p1!, "red"), "o1");
    await handleKpiDeviation(env.db, kpiEvent(w, kpi, p2!, "red"), "o2");
    const [c] = await casesOf(env.db, w, "kpi_deviation");
    expect([c!.owner_user_id, c!.follow_up_date, c!.follow_up_calendar_id]).toEqual([null, null, null]);
    expect(await tasksOf(env.db, c!.id)).toEqual([]);
  });

  it("a disabled rule records the signal (rule_disabled) and opens nothing", async () => {
    const w = await seedWorld(env.db, true);
    const ruleId = randomUUID();
    await env.db.transaction().execute(async (tx) => {
      await tx
        .insertInto("corrective_action_rule")
        .values({
          id: ruleId,
          organization_id: w.organizationId,
          transformation_id: w.transformationId,
          source_kind: "control_check",
          persistence_cycles: 1,
          follow_up_working_days: 5,
          enabled: false,
          created_by: w.userId,
          updated_by: w.userId,
        })
        .execute();
      await insertAuditEvent(tx, actor(w.userId), {
        action: "corrective_action_rule.create",
        recordType: "corrective_action_rule",
        recordId: ruleId,
        organizationId: w.organizationId,
        transformationId: w.transformationId,
        newVersion: 1,
      });
    });
    const r = await handleControlCheckFailed(env.db, checkEvent(w, "control_check.failed", w.userId), "d1");
    expect(r.signal).toMatchObject({ outcome: "rule_disabled", correctiveCaseId: null });
    expect(await casesOf(env.db, w, "control_check")).toEqual([]);
  });
});

describe("raid.corrective_benefit (REQ-PB-085: a benefit below plan)", () => {
  it("offTrack: true opens one case; a repeated evaluation updates it; offTrack null (Unknown) never does", async () => {
    const w = await seedWorld(env.db, true);
    const owner = await addUser(env.db, w);
    const benefitId = await addBenefit(env.db, w, owner);
    const ev = (key: string, offTrack: boolean | null, month = "10") =>
      envelope(w, "benefit.variance_evaluated", `benefit.variance_evaluated:${key}`, {
        benefitId,
        measurementId: randomUUID(),
        periodStart: `2026-${month}-01`,
        periodEnd: `2026-${month}-28`,
        plannedAmount: "100000.0000",
        measuredAmount: offTrack === null ? null : "80000.0000",
        variance: offTrack === null ? null : "-20000.0000",
        offTrack,
      });
    const first = await handleBenefitVariance(env.db, ev("m1", true), "b1");
    expect(first.signal).toMatchObject({ outcome: "case_created", consecutiveOffTrack: 1 });
    const again = await handleBenefitVariance(env.db, ev("m2", true), "b2");
    expect(again.signal).toMatchObject({ outcome: "case_updated" });
    const unknown = await handleBenefitVariance(env.db, ev("m3", null, "11"), "b3");
    expect(unknown.signal).toMatchObject({ outcome: "recorded", consecutiveOffTrack: 0 });
    const cases = await casesOf(env.db, w, "benefit_variance");
    expect(cases.map((c) => [c.benefit_id, c.owner_user_id, c.title, c.version, c.signal_count, c.status])).toEqual([
      [benefitId, owner, "Synthetic opex saving", 2, 2, "open"],
    ]);
    expect((await tasksOf(env.db, cases[0]!.id)).map((t) => [t.kind, t.assignee_user_id])).toEqual([
      ["corrective_case_follow_up", owner],
    ]);
  });
});

describe("raid.corrective_control and raid.corrective_adoption through the production worker (REQ-S12-016)", () => {
  it("a failed control check opens one owned case with a 5-working-day follow-up and one work item; replay and restart create none", async () => {
    const w = await seedWorld(env.db, true);
    const owner = await addUser(env.db, w);
    const e = checkEvent(w, "control_check.failed", owner);
    await boss.send(CORRECTIVE_CONSUMERS.control, e);
    const options = {
      db: env.db,
      boss,
      timeZone: "Asia/Riyadh",
      log: quiet,
      pollIntervalMs: 200,
      jobPollingIntervalSeconds: 0.5,
      handlers: RAID_HANDLERS,
    };
    let worker: RunningWorker = await startWorker(options);
    try {
      const [c] = await waitFor(async () => {
        const r = await casesOf(env.db, w, "control_check");
        return r.length > 0 ? r : null;
      });
      expect(c).toMatchObject({
        source_scope_key: (e.payload as { checkId: string }).checkId,
        source_record_type: "control_check",
        source_record_id: (e.payload as { checkId: string }).checkId,
        title: "Synthetic monthly reconciliation control",
        owner_user_id: owner,
        // 2026-10-08 is a Thursday; Sun-Thu working week: 11, 12, 13, 14, 15 October.
        follow_up_date: "2026-10-15",
        consecutive_off_track: 1,
        status: "open",
        created_source: "worker",
        created_by: null,
      });
      expect(c!.follow_up_calendar_id).not.toBeNull();
      expect(await tasksOf(env.db, c!.id)).toEqual([
        {
          kind: "corrective_case_follow_up",
          assignee_user_id: owner,
          due_date: "2026-10-15",
          dedupe_key: `corrective.follow_up:${c!.id}:${owner}`,
          status: "open",
          created_source: "worker",
          created_by: null,
        },
      ]);
      // Redelivery (a new pg-boss job, same envelope), then a restarted worker receiving it once more.
      await boss.send(CORRECTIVE_CONSUMERS.control, e);
      await worker.stop();
      worker = await startWorker(options);
      await boss.send(CORRECTIVE_CONSUMERS.control, e);
      await waitFor(async () => {
        const r = await env.owner.query(
          "SELECT count(*)::int AS n FROM pgboss.job WHERE name = $1 AND state = 'completed' AND data->>'outboxEventId' = $2",
          [CORRECTIVE_CONSUMERS.control, e.outboxEventId],
        );
        return r.rows[0].n >= 3 ? true : null;
      });
      expect((await casesOf(env.db, w, "control_check")).length).toBe(1);
      expect((await tasksOf(env.db, c!.id)).length).toBe(1);
      expect((await signalsOf(env.db, w, c!.source_scope_key)).map((s) => s.outcome)).toEqual(["case_created"]);
      expect(await handleControlCheckFailed(env.db, e, "direct")).toEqual({ outcome: "duplicate" });
    } finally {
      await worker.stop();
    }
  });

  it("an unresolved owner (none in the payload, no transformation lead) gives an unassigned case and no work item", async () => {
    const w = await seedWorld(env.db, true);
    const r = await handleControlCheckFailed(env.db, checkEvent(w, "control_check.failed", null), "n1");
    expect(r.signal?.outcome).toBe("case_created");
    const [c] = await casesOf(env.db, w, "control_check");
    expect([c!.owner_user_id, c!.follow_up_date]).toEqual([null, "2026-10-15"]);
    expect(await tasksOf(env.db, c!.id)).toEqual([]);
  });

  it("the payload owner falls back to the transformation lead", async () => {
    const w = await seedWorld(env.db, true);
    const lead = await addUser(env.db, w);
    await env.db.transaction().execute(async (tx) => {
      await tx
        .updateTable("transformation")
        .set({ lead_user_id: lead, version: 2 })
        .where("id", "=", w.transformationId)
        .execute();
      await insertAuditEvent(tx, actor(w.userId), {
        action: "transformation.update",
        recordType: "transformation",
        recordId: w.transformationId,
        organizationId: w.organizationId,
        transformationId: w.transformationId,
        priorVersion: 1,
        newVersion: 2,
      });
    });
    const inactive = await addUser(env.db, w, "disabled");
    await handleAdoptionCheckFailed(env.db, checkEvent(w, "adoption.check_failed", inactive), "l1");
    const [c] = await casesOf(env.db, w, "adoption_check");
    expect([c!.owner_user_id, c!.source_record_type]).toEqual([lead, "adoption_check"]);
    expect((await tasksOf(env.db, c!.id)).map((t) => t.assignee_user_id)).toEqual([lead]);
  });
});
