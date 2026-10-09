// The below-trajectory consumer and the D-102 event fan-out, against a real PostgreSQL with pg-boss (T-DG4-KBE-F;
// p4-work-split §F+G FG.3; ADR-0033 §4; REQ-PB-069, REQ-PB-071). The KPI pipeline's evaluations are SYNTHETIC rows
// written as KBE-C's run writes them (a calculation_run, its kpi_evaluation and one kpi.deviation_evaluated outbox
// event), so every RAG and deviation can be chosen; apps/api/test/integration/adoption/indicators.test.ts drives the
// real accept-and-recalculate pipeline. Proves:
//  - fan-out: one kpi.deviation_evaluated reaches raid.corrective_kpi AND adoption.indicator_evaluated exactly once
//    each, with distinct deterministic job ids; the production worker runs both consumers; a relay retry and a
//    replayed send duplicate nothing; when one send fails, no job and no mark commit (all or none); an event type with
//    no queue is still a recorded relay failure; a single-queue event keeps job id = event id;
//  - a red or amber, adverse evaluation creates exactly one corrective intervention per active metric link, scope and
//    period, with one adoption.check_failed each; a second evaluation of the same KPI, scope and period and a
//    redelivered event create none; green, unknown, stale and not_computable evaluations create none; a removed link
//    gets none; an intervention whose owner chain has no active user is unassigned with no work item.
// All data is SYNTHETIC; no job decides a business approval or touches the engineering gates DG0-DG7.
import { insertAuditEvent, sql, type Db } from "@mth/db";
import type PgBoss from "pg-boss";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ADOPTION_HANDLERS,
  ADOPTION_INDICATOR_CONSUMER,
  handleIndicatorEvaluated,
} from "../../src/handlers/adoption.ts";
import { CORRECTIVE_CONSUMERS, RAID_HANDLERS } from "../../src/handlers/raid.ts";
import { ensureQueues, QUEUE_FOR_EVENT, QUEUES_FOR_EVENT, queuesForEvents } from "../../src/queues/index.ts";
import { fanOutJobId, jobsForEvent, relayOnce } from "../../src/relay.ts";
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
  readonly kpiId: string;
  readonly versionId: string;
  readonly groupId: string;
  readonly linkId: string;
  readonly periods: string[];
}

/** A transformation with an active percentage KPI, a stakeholder group, its metric link and three monthly periods. */
async function seed(db: Db, opts: { ownerActive?: boolean } = {}): Promise<World> {
  const { transformationId, userId } = await seedTransformationWithOutbox(db);
  const { organization_id: organizationId } = await db
    .selectFrom("transformation")
    .select("organization_id")
    .where("id", "=", transformationId)
    .executeTakeFirstOrThrow();
  const kpiId = randomUUID();
  const versionId = randomUUID();
  const groupId = randomUUID();
  const linkId = randomUUID();
  const periods = [randomUUID(), randomUUID(), randomUUID()];
  await db.transaction().execute(async (tx) => {
    const audit = (recordType: string, recordId: string, action: string, newVersion: number, withT = true) =>
      insertAuditEvent(tx, actor(userId), {
        action,
        recordType,
        recordId,
        organizationId,
        ...(withT ? { transformationId } : {}),
        priorVersion: newVersion > 1 ? newVersion - 1 : null,
        newVersion,
      });
    await tx
      .insertInto("kpi_definition")
      .values({
        id: kpiId,
        organization_id: organizationId,
        transformation_id: transformationId,
        name: "Synthetic usage / activation rate",
        unit_kind: "percentage",
        polarity: "higher_is_better",
        is_leading: true,
        status: "active",
        owner_user_id: userId,
        created_by: userId,
        updated_by: userId,
      })
      .execute();
    await audit("kpi_definition", kpiId, "kpi_definition.create", 1);
    await tx
      .insertInto("kpi_version")
      .values({
        id: versionId,
        organization_id: organizationId,
        transformation_id: transformationId,
        kpi_definition_id: kpiId,
        version_no: 1,
        measure_type: "higher_is_better",
        value_nature: "ratio",
        unit_kind: "percentage",
        frequency: "monthly",
        aggregation_rule: "weighted_ratio",
        submission_route: "direct_accept",
        created_by: userId,
        updated_by: userId,
      })
      .execute();
    await audit("kpi_version", versionId, "kpi_version.create", 1);
    for (const [i, id] of periods.entries()) {
      const m = String(i + 1).padStart(2, "0");
      const end = ["31", "28", "31"][i]!;
      await tx
        .insertInto("reporting_period")
        .values({
          id,
          organization_id: organizationId,
          frequency: "monthly",
          period_label: `2026-${m}`,
          period_start: `2026-${m}-01`,
          period_end: `2026-${m}-${end}`,
          created_by: userId,
          updated_by: userId,
        })
        .execute();
      await audit("reporting_period", id, "reporting_period.create", 1, false);
    }
    await tx
      .insertInto("stakeholder_group")
      .values({
        id: groupId,
        organization_id: organizationId,
        transformation_id: transformationId,
        code: "SG-01",
        name: "Synthetic app users",
        impact: "H",
        current_stance: "neutral",
        required_behavior: "Synthetic: activate the app",
        intervention_types: ["training"],
        owner_user_id: userId,
        created_by: userId,
        updated_by: userId,
      })
      .execute();
    await audit("stakeholder_group", groupId, "stakeholder_group.create", 1);
    await tx
      .insertInto("adoption_metric_link")
      .values({
        id: linkId,
        organization_id: organizationId,
        transformation_id: transformationId,
        template_key: "usage_activation_rate",
        kpi_definition_id: kpiId,
        target_kind: "stakeholder_group",
        stakeholder_group_id: groupId,
        created_by: userId,
        updated_by: userId,
      })
      .execute();
    await audit("adoption_metric_link", linkId, "adoption_metric_link.create", 1);
  });
  if (opts.ownerActive === false)
    await env.owner.query("UPDATE app_user SET status = 'disabled' WHERE id = $1", [userId]);
  return { organizationId, transformationId, userId, kpiId, versionId, groupId, linkId, periods };
}

/**
 * One synthetic calculation run with one period evaluation (`rag`, `deviation`) and its kpi.deviation_evaluated event,
 * as KBE-C's run writes them. Returns the evaluation id and the event's envelope.
 */
async function evaluate(db: Db, s: World, periodIndex: number, rag: string, deviation: string) {
  const runId = randomUUID();
  const evaluationId = randomUUID();
  const outboxId = randomUUID();
  const periodId = s.periods[periodIndex]!;
  const valueStatus = ["unknown", "stale", "not_computable"].includes(rag) ? rag : "ok";
  const value = valueStatus === "ok" || valueStatus === "stale" ? "0.400000" : null;
  const payload = {
    evaluationId,
    transformationId: s.transformationId,
    kpiDefinitionId: s.kpiId,
    scopeKind: "transformation",
    scopeId: s.transformationId,
    reportingPeriodId: periodId,
    calculatedRag: rag,
    deviation,
    previousCalculatedRag: null,
  };
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto("calculation_run")
      .values({
        id: runId,
        organization_id: s.organizationId,
        transformation_id: s.transformationId,
        trigger_kind: "actual_accepted",
        trigger_record_type: "kpi_actual",
        trigger_record_id: randomUUID(),
        trigger_slot: 1,
        idempotency_key: `test-run:${runId}`,
        status: "completed",
        evaluation_count: 1,
        formula_engine_version: "synthetic",
        kpi_rules_version: "mth-kpi/1.0.0",
        started_at: sql<Date>`now()`,
      })
      .execute();
    await tx
      .insertInto("kpi_evaluation")
      .values({
        id: evaluationId,
        organization_id: s.organizationId,
        transformation_id: s.transformationId,
        calculation_run_id: runId,
        kpi_definition_id: s.kpiId,
        kpi_version_id: s.versionId,
        scope_kind: "transformation",
        scope_id: s.transformationId,
        reporting_period_id: periodId,
        period_label: `P${periodIndex + 1}`,
        value_basis: "period",
        value,
        value_status: valueStatus,
        value_reason:
          valueStatus === "ok" ? null : `kpi.${valueStatus === "unknown" ? "no_accepted_actual" : valueStatus}`,
        value_source: value === null ? "none" : "entered",
        trend: "unknown",
        calculated_rag: rag,
        deviation,
        threshold_source: "default",
        explanation_key: "kpi.rag.synthetic",
      })
      .execute();
    await tx
      .insertInto("outbox_event")
      .values({
        id: outboxId,
        organization_id: s.organizationId,
        aggregate_type: "kpi_evaluation",
        aggregate_id: evaluationId,
        event_type: "kpi.deviation_evaluated",
        schema_version: 1,
        idempotency_key: `kpi.deviation_evaluated:${evaluationId}`,
        payload: JSON.stringify(payload),
      })
      .execute();
  });
  const envelope = {
    outboxEventId: outboxId,
    eventType: "kpi.deviation_evaluated",
    schemaVersion: 1,
    idempotencyKey: `kpi.deviation_evaluated:${evaluationId}`,
    organizationId: s.organizationId,
    payload,
  };
  return { evaluationId, outboxId, envelope };
}

const interventionsOf = (db: Db, s: World) =>
  db.selectFrom("adoption_intervention").selectAll().where("transformation_id", "=", s.transformationId).execute();
const checksOf = (db: Db, ids: string[]) =>
  ids.length === 0
    ? Promise.resolve([])
    : db
        .selectFrom("outbox_event")
        .select(["aggregate_id", "event_type", "idempotency_key"])
        .where("event_type", "=", "adoption.check_failed")
        .where("aggregate_id", "in", ids)
        .execute();
const jobsOf = async (outboxId: string) =>
  (
    await env.owner.query(
      "SELECT id::text AS id, name FROM pgboss.job WHERE data->>'outboxEventId' = $1 ORDER BY name",
      [outboxId],
    )
  ).rows as { id: string; name: string }[];

// ------------------------------------------------------------------------------------------------ the registry

describe("the event-to-queue registry (D-102)", () => {
  it("kpi.deviation_evaluated fans out to RAID's and the adoption consumer; every other event keeps its one queue", () => {
    expect(QUEUES_FOR_EVENT["kpi.deviation_evaluated"]).toEqual([
      CORRECTIVE_CONSUMERS.kpi,
      ADOPTION_INDICATOR_CONSUMER,
    ]);
    for (const [eventType, queues] of Object.entries(QUEUES_FOR_EVENT)) {
      if (eventType === "kpi.deviation_evaluated") continue;
      expect(queues, eventType).toHaveLength(1);
      expect(QUEUE_FOR_EVENT[eventType]).toBe(queues[0]);
    }
    expect(QUEUE_FOR_EVENT["kpi.deviation_evaluated"]).toBe(CORRECTIVE_CONSUMERS.kpi);
    expect(queuesForEvents([{ a: "q1" }, { a: "q2", b: "q3" }, { a: "q1" }])).toEqual({ a: ["q1", "q2"], b: ["q3"] });
  });

  it("job ids: the event id for one queue; distinct, deterministic UUIDs per (event, queue) for several", () => {
    const e = randomUUID();
    expect(jobsForEvent(e, ["only"])).toEqual([{ queue: "only", id: e }]);
    const two = jobsForEvent(e, ["q1", "q2"]);
    expect(two.map((j) => j.queue)).toEqual(["q1", "q2"]);
    expect(new Set([e, ...two.map((j) => j.id)]).size).toBe(3);
    expect(two[0]!.id).toBe(fanOutJobId(e, "q1"));
    expect(fanOutJobId(e, "q1")).toBe(fanOutJobId(e, "q1"));
    expect(two[0]!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

// ------------------------------------------------------------------------------------------------ the relay

describe("the outbox relay fans kpi.deviation_evaluated out (D-102)", () => {
  it("one event reaches both consumers exactly once; a relay retry and a replayed send duplicate nothing", async () => {
    const s = await seed(env.db);
    const { outboxId, evaluationId } = await evaluate(env.db, s, 0, "red", "adverse");
    // Simulate a previous relay that enqueued the adoption job but died before marking the row (its transaction
    // rolled back in reality; a replayed send must still be a no-op).
    const env0 = await env.db
      .selectFrom("outbox_event")
      .select(["id", "organization_id", "payload", "idempotency_key"])
      .where("id", "=", outboxId)
      .executeTakeFirstOrThrow();
    const relayed = await relayOnce(env.db, boss, 50);
    expect(relayed.failed).toBe(0);
    const jobs = await jobsOf(outboxId);
    expect(jobs.map((j) => j.name)).toEqual([ADOPTION_INDICATOR_CONSUMER, CORRECTIVE_CONSUMERS.kpi]);
    expect(Object.fromEntries(jobs.map((j) => [j.name, j.id]))).toEqual({
      [ADOPTION_INDICATOR_CONSUMER]: fanOutJobId(outboxId, ADOPTION_INDICATOR_CONSUMER),
      [CORRECTIVE_CONSUMERS.kpi]: fanOutJobId(outboxId, CORRECTIVE_CONSUMERS.kpi),
    });
    // Relay again (nothing pending for this event), then replay both sends with the same ids: still one job each.
    await relayOnce(env.db, boss, 50);
    for (const j of jobsForEvent(outboxId, QUEUES_FOR_EVENT["kpi.deviation_evaluated"]!))
      await boss.send(
        j.queue,
        {
          outboxEventId: outboxId,
          eventType: "kpi.deviation_evaluated",
          schemaVersion: 1,
          idempotencyKey: env0.idempotency_key,
          organizationId: env0.organization_id,
          payload: env0.payload,
        },
        { id: j.id },
      );
    expect((await jobsOf(outboxId)).length).toBe(2);

    // The production worker runs both consumers once each.
    const worker: RunningWorker = await startWorker({
      db: env.db,
      boss,
      timeZone: "Asia/Riyadh",
      log: quiet,
      pollIntervalMs: 200,
      jobPollingIntervalSeconds: 0.5,
      handlers: [...RAID_HANDLERS, ...ADOPTION_HANDLERS],
    });
    try {
      const rows = await waitFor(async () => {
        const r = await interventionsOf(env.db, s);
        return r.length > 0 ? r : null;
      });
      await waitFor(async () => {
        const sig = await env.db
          .selectFrom("corrective_signal")
          .select("id")
          .where("source_event_key", "=", `kpi.deviation_evaluated:${evaluationId}`)
          .execute();
        return sig.length > 0 ? sig : null;
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        metric_link_id: s.linkId,
        kpi_evaluation_id: evaluationId,
        origin: "below_trajectory",
      });
      const ledger = await env.db
        .selectFrom("processed_message")
        .select(["consumer"])
        .where("idempotency_key", "=", `kpi.deviation_evaluated:${evaluationId}`)
        .orderBy("consumer")
        .execute();
      expect(ledger.map((l) => l.consumer)).toEqual([ADOPTION_INDICATOR_CONSUMER, CORRECTIVE_CONSUMERS.kpi]);
    } finally {
      await worker.stop();
    }
    expect(await interventionsOf(env.db, s)).toHaveLength(1);
  }, 60_000);

  it("all or none: when one queue's send fails, no job and no mark commit, and the failure is recorded", async () => {
    const s = await seed(env.db);
    await relayOnce(env.db, boss, 50); // the seed's transformation.created
    const { outboxId } = await evaluate(env.db, s, 0, "red", "adverse");
    const failing = new Proxy(boss, {
      get(target, prop, receiver) {
        if (prop === "send")
          return async (queue: string, data: object, options: object) => {
            if (queue === ADOPTION_INDICATOR_CONSUMER) throw new Error("synthetic send failure");
            return target.send(queue, data, options as never);
          };
        return Reflect.get(target, prop, receiver);
      },
    }) as PgBoss;
    const r = await relayOnce(env.db, failing, 50);
    expect(r).toEqual({ published: 0, failed: 1 });
    expect(await jobsOf(outboxId)).toEqual([]);
    const row = await env.db
      .selectFrom("outbox_event")
      .select(["published_at", "publish_attempts", "last_error"])
      .where("id", "=", outboxId)
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({ published_at: null, publish_attempts: 1, last_error: "synthetic send failure" });
    // The retry with a healthy boss publishes both jobs.
    expect((await relayOnce(env.db, boss, 50)).failed).toBe(0);
    expect((await jobsOf(outboxId)).length).toBe(2);
  });

  it("an event type with no queue is a recorded relay failure; a single-queue event keeps job id = event id", async () => {
    const s = await seed(env.db);
    const t = await env.db
      .selectFrom("outbox_event")
      .select("id")
      .where("aggregate_id", "=", s.transformationId)
      .where("event_type", "=", "transformation.created")
      .executeTakeFirstOrThrow();
    await relayOnce(env.db, boss, 50);
    expect(await jobsOf(t.id)).toEqual([{ id: t.id, name: QUEUE_FOR_EVENT["transformation.created"] }]);
    const orphan = randomUUID();
    await env.db
      .insertInto("outbox_event")
      .values({
        id: orphan,
        organization_id: s.organizationId,
        aggregate_type: "synthetic",
        aggregate_id: randomUUID(),
        event_type: "synthetic.unrouted",
        schema_version: 1,
        idempotency_key: `synthetic.unrouted:${orphan}`,
        payload: JSON.stringify({}),
      })
      .execute();
    const r = await relayOnce(env.db, boss, 50);
    expect(r.failed).toBe(1);
    const row = await env.db
      .selectFrom("outbox_event")
      .select(["published_at", "last_error"])
      .where("id", "=", orphan)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ published_at: null, last_error: "no queue for event type synthetic.unrouted" });
    expect(await jobsOf(orphan)).toEqual([]);
    // Park it so later relays in this file do not stop on it.
    await env.owner.query("UPDATE outbox_event SET publish_attempts = 1000 WHERE id = $1", [orphan]);
  });
});

// ------------------------------------------------------------------------------------------------ the consumer

describe("adoption.indicator_evaluated (ADR-0033 §4)", () => {
  it("red or amber and adverse: one intervention per link, scope and period, one adoption.check_failed each", async () => {
    const s = await seed(env.db);
    const red = await evaluate(env.db, s, 0, "red", "adverse");
    const r1 = await handleIndicatorEvaluated(env.db, red.envelope, "job-red");
    expect(r1.interventions.map((i) => [i.outcome, i.metricLinkId])).toEqual([["created", s.linkId]]);
    // Redelivery: nothing.
    expect(await handleIndicatorEvaluated(env.db, red.envelope, "job-red-2")).toEqual({
      outcome: "duplicate",
      interventions: [],
    });
    // A second evaluation of the same KPI, scope and period (a later run): the existing intervention, no new one.
    const again = await evaluate(env.db, s, 0, "amber", "adverse");
    const r2 = await handleIndicatorEvaluated(env.db, again.envelope, "job-red-3");
    expect(r2.interventions.map((i) => i.outcome)).toEqual(["existing"]);
    // Amber and adverse in another period: a new intervention for that period.
    const amber = await evaluate(env.db, s, 1, "amber", "adverse");
    const r3 = await handleIndicatorEvaluated(env.db, amber.envelope, "job-amber");
    expect(r3.interventions.map((i) => i.outcome)).toEqual(["created"]);
    const rows = await interventionsOf(env.db, s);
    expect(rows.map((r) => r.reporting_period_id).sort()).toEqual([s.periods[0], s.periods[1]].sort());
    for (const r of rows)
      expect(r).toMatchObject({
        origin: "below_trajectory",
        intervention_type: "corrective",
        created_source: "worker",
        created_by: null,
        stakeholder_group_id: s.groupId,
        owner_user_id: s.userId,
        scope_kind: "transformation",
        scope_id: s.transformationId,
        trigger_key: `${s.linkId}:transformation:${s.transformationId}:${r.reporting_period_id}`,
      });
    const checks = await checksOf(
      env.db,
      rows.map((r) => r.id),
    );
    expect(checks.map((c) => c.idempotency_key).sort()).toEqual(
      rows.map((r) => `adoption.check_failed:${r.id}`).sort(),
    );
    const audit = await env.db
      .selectFrom("audit_event")
      .select(["action", "actor_type", "source"])
      .where(
        "record_id",
        "in",
        rows.map((r) => r.id),
      )
      .execute();
    expect(audit).toEqual(
      rows.map(() => ({ action: "adoption_intervention.create", actor_type: "service", source: "worker" })),
    );
  });

  it.each([
    ["green", "favourable"],
    ["green", "within"],
    ["unknown", "unknown"],
    ["stale", "unknown"],
    ["not_computable", "unknown"],
  ])("%s / %s creates none", async (rag, deviation) => {
    const s = await seed(env.db);
    const e = await evaluate(env.db, s, 2, rag, deviation);
    expect(await handleIndicatorEvaluated(env.db, e.envelope, `job-${rag}`)).toEqual({
      outcome: "not_below_trajectory",
      interventions: [],
    });
    expect(await interventionsOf(env.db, s)).toEqual([]);
    const events = await env.db
      .selectFrom("outbox_event")
      .select("id")
      .where("event_type", "=", "adoption.check_failed")
      .where(sql<string>`payload->>'transformationId'`, "=", s.transformationId)
      .execute();
    expect(events).toEqual([]);
  });

  it("a removed link gets no intervention; two active links get one each", async () => {
    const s = await seed(env.db);
    await env.db.transaction().execute(async (tx) => {
      await tx
        .updateTable("adoption_metric_link")
        .set({ status: "removed", removed_at: sql<Date>`now()`, removed_by: s.userId, version: 2 })
        .where("id", "=", s.linkId)
        .execute();
      await insertAuditEvent(tx, actor(s.userId), {
        action: "adoption_metric_link.remove",
        recordType: "adoption_metric_link",
        recordId: s.linkId,
        organizationId: s.organizationId,
        transformationId: s.transformationId,
        priorVersion: 1,
        newVersion: 2,
      });
      for (const kind of ["transformation", "stakeholder_group"] as const) {
        const id = randomUUID();
        await tx
          .insertInto("adoption_metric_link")
          .values({
            id,
            organization_id: s.organizationId,
            transformation_id: s.transformationId,
            template_key: kind === "transformation" ? "process_compliance_rate" : "new_journey_share",
            kpi_definition_id: s.kpiId,
            target_kind: kind,
            stakeholder_group_id: kind === "stakeholder_group" ? s.groupId : null,
            created_by: s.userId,
            updated_by: s.userId,
          })
          .execute();
        await insertAuditEvent(tx, actor(s.userId), {
          action: "adoption_metric_link.create",
          recordType: "adoption_metric_link",
          recordId: id,
          organizationId: s.organizationId,
          transformationId: s.transformationId,
          newVersion: 1,
        });
      }
    });
    const e = await evaluate(env.db, s, 0, "red", "adverse");
    const r = await handleIndicatorEvaluated(env.db, e.envelope, "job-two-links");
    expect(r.interventions.map((i) => i.outcome)).toEqual(["created", "created"]);
    expect(r.interventions.some((i) => i.metricLinkId === s.linkId)).toBe(false);
    const rows = await interventionsOf(env.db, s);
    expect(rows).toHaveLength(2);
    expect(
      (
        await checksOf(
          env.db,
          rows.map((x) => x.id),
        )
      ).length,
    ).toBe(2);
  });

  it("no active user in the owner chain: owner NULL (unassigned) and no work item; no calendar: due date NULL", async () => {
    const s = await seed(env.db, { ownerActive: false });
    const e = await evaluate(env.db, s, 0, "red", "adverse");
    await handleIndicatorEvaluated(env.db, e.envelope, "job-unassigned");
    const [row] = await interventionsOf(env.db, s);
    expect(row).toMatchObject({ owner_user_id: null, due_date: null });
    const items = await env.db
      .selectFrom("work_item")
      .select("id")
      .where("subject_type", "=", "adoption_intervention")
      .where("subject_id", "=", row!.id)
      .execute();
    expect(items).toEqual([]);
    const [check] = await env.db
      .selectFrom("outbox_event")
      .select("payload")
      .where("aggregate_id", "=", row!.id)
      .execute();
    expect(check!.payload).toMatchObject({ ownerUserId: null, checkRecordType: "adoption_intervention" });
  });

  it("refuses an event that does not match its evaluation (programming error, nothing written)", async () => {
    const s = await seed(env.db);
    const e = await evaluate(env.db, s, 0, "red", "adverse");
    const bad = {
      ...e.envelope,
      idempotencyKey: `${e.envelope.idempotencyKey}:bad`,
      payload: { ...e.envelope.payload, reportingPeriodId: s.periods[1] },
    };
    await expect(handleIndicatorEvaluated(env.db, bad, "job-bad")).rejects.toThrow(/does not match evaluation/);
    expect(await interventionsOf(env.db, s)).toEqual([]);
    const ledger = await env.db
      .selectFrom("processed_message")
      .select("consumer")
      .where("idempotency_key", "=", bad.idempotencyKey)
      .execute();
    expect(ledger).toEqual([]);
  });
});
