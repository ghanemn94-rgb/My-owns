// The KPI freshness scan, starter 16 version 2, the catalogue triggers and the exception alerts, against a real
// PostgreSQL (T-DG6-BE-K2; ADR-0053 §2, §3, §6; REQ-S12-019; p6-work-split §J/C.4). Proves:
//  - the trigger catalogue lists connector.run_failed and data.stale (admin-selectable, M0239), each fed to the engine;
//  - starter 16 version 1 is unchanged history (superseded, same content and hash), version 2 is the effective
//    published version with {job.failed, connector.run_failed, data.stale}, each change audited; the starter guard still
//    refuses an application (API) version that adds a trigger, and accepts one that keeps version 2's set;
//  - a KPI whose last accepted actual is older than staleAfterDays -> exactly one data.stale event per stale episode
//    (a second scan writes nothing), one `data_stale` exception linked to the KPI, recorded as one execution of starter
//    16 v2; a redelivered event creates nothing; the KPI still reads Stale with its last value and date, and no KPI row
//    is written; fresh again -> `recovered`;
//  - one alert per OPEN (one notification per acknowledge holder, one `alert: true` log line), none per recurrence;
//    platform exceptions alert every organization's holders; heartbeat_missed gets no second log line;
//  - a narrowed grant fails the scan with service_identity.out_of_scope (least privilege, visibly).
// All data is SYNTHETIC. Nothing here approves anything (not a business approval, G1-G6) or touches DG0-DG7.
import { createHash, randomUUID } from "node:crypto";
import { insertAuditEvent, sql, type Db } from "@mth/db";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  DATA_STALE_EVENT,
  dataStaleEventKey,
  EXCEPTION_ALERTS_HANDLER,
  EXCEPTION_OPENED_MESSAGE,
  EXCEPTION_RAISE_HANDLER,
  FRESHNESS_SCAN_HANDLER,
  kpiFreshness,
  OPERATIONS_HANDLERS,
  setOperationsAlertLogger,
} from "../../src/handlers/operations.ts";
import { DOMAIN_HANDLERS } from "../../src/handlers/index.ts";
import { raiseOperationalExceptionTwin, jobActor } from "../../src/kit.ts";
import { AUTOMATION_EVENT_QUEUES } from "../../src/queues/automation.ts";
import { QUEUES_FOR_EVENT } from "../../src/queues/index.ts";
import { seedTransformationWithOutbox, workerEnv, type WorkerEnv } from "../support.ts";

let env: WorkerEnv;
const lines: { obj: Record<string, unknown>; msg: string }[] = [];
beforeAll(async () => {
  env = await workerEnv();
  setOperationsAlertLogger({ error: (obj, msg) => lines.push({ obj: obj as Record<string, unknown>, msg }) });
}, 60_000);
afterAll(async () => {
  setOperationsAlertLogger(null);
  await env.close();
});
afterEach(() => {
  lines.length = 0;
});

const STARTER_16 = "01920005-0075-7000-8000-000000000110";
const STARTER_16_V1 = "01920005-0075-7000-8000-000000000210";
const STARTER_16_V2 = "01920006-0117-7000-8000-000000000001";
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const userActor = (userId: string) =>
  ({ actorType: "user", actorUserId: userId, requestId: `test-${randomUUID()}`, source: "api" }) as const;

interface World {
  readonly organizationId: string;
  readonly transformationId: string;
  readonly userId: string;
  readonly kpiId: string;
  readonly versionId: string;
  readonly periodId: string;
}

/** Today's business date in Asia/Riyadh (the organizations here have no calendar: the organization zone applies). */
async function today(db: Db): Promise<string> {
  const r = await sql<{ d: string }>`SELECT p4_business_date(now(), 'Asia/Riyadh')::text AS d`.execute(db);
  return r.rows[0]!.d;
}

/** A transformation with one active monthly KPI (staleAfterDays 30) and the open period that contains today. */
async function seed(db: Db): Promise<World> {
  const { transformationId, userId } = await seedTransformationWithOutbox(db);
  const { organization_id: organizationId } = await db
    .selectFrom("transformation")
    .select("organization_id")
    .where("id", "=", transformationId)
    .executeTakeFirstOrThrow();
  const kpiId = randomUUID();
  const versionId = randomUUID();
  const periodId = randomUUID();
  const d = await today(db);
  const monthStart = `${d.slice(0, 7)}-01`;
  await db.transaction().execute(async (tx) => {
    const audit = (recordType: string, recordId: string, action: string, withT = true) =>
      insertAuditEvent(tx, userActor(userId), {
        action,
        recordType,
        recordId,
        organizationId,
        ...(withT ? { transformationId } : {}),
        newVersion: 1,
      });
    await tx
      .insertInto("kpi_definition")
      .values({
        id: kpiId,
        organization_id: organizationId,
        transformation_id: transformationId,
        name: "Synthetic data-feed KPI",
        unit_kind: "percentage",
        polarity: "higher_is_better",
        status: "active",
        owner_user_id: userId,
        created_by: userId,
        updated_by: userId,
      })
      .execute();
    await audit("kpi_definition", kpiId, "kpi_definition.create");
    await tx
      .insertInto("reporting_period")
      .values({
        id: periodId,
        organization_id: organizationId,
        frequency: "monthly",
        period_label: d.slice(0, 7),
        period_start: monthStart,
        period_end: sql<string>`(date_trunc('month', ${monthStart}::date) + interval '1 month - 1 day')::date`,
        status: "open",
        opened_at: sql<Date>`now()`,
        created_by: userId,
        updated_by: userId,
      })
      .execute();
    await audit("reporting_period", periodId, "reporting_period.create", false);
  });
  // A direct-approval version (no business approval involved), created as a draft and activated, each step audited.
  await db.transaction().execute(async (tx) => {
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
        numerator_label: "Synthetic active users",
        denominator_label: "Synthetic eligible users",
        submission_route: "direct_accept",
        dq_stale_after_days: 30,
        created_by: userId,
        updated_by: userId,
      })
      .execute();
    await insertAuditEvent(tx, userActor(userId), {
      action: "kpi_version.create",
      recordType: "kpi_version",
      recordId: versionId,
      organizationId,
      transformationId,
      newVersion: 1,
    });
    await tx
      .updateTable("kpi_version")
      .set({ status: "active", activated_at: sql<Date>`now()`, activated_by: userId, version: 2 })
      .where("id", "=", versionId)
      .execute();
    await insertAuditEvent(tx, userActor(userId), {
      action: "kpi_version.activate",
      recordType: "kpi_version",
      recordId: versionId,
      organizationId,
      transformationId,
      priorVersion: 1,
      newVersion: 2,
    });
  });
  return { organizationId, transformationId, userId, kpiId, versionId, periodId };
}

/** One synthetic calculation run whose period evaluation carries `value` with data as of `dataAsOf` (KBE-C's shape). */
async function evaluate(db: Db, w: World, value: string, dataAsOf: string): Promise<string> {
  const runId = randomUUID();
  const evaluationId = randomUUID();
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto("calculation_run")
      .values({
        id: runId,
        organization_id: w.organizationId,
        transformation_id: w.transformationId,
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
        organization_id: w.organizationId,
        transformation_id: w.transformationId,
        calculation_run_id: runId,
        kpi_definition_id: w.kpiId,
        kpi_version_id: w.versionId,
        scope_kind: "transformation",
        scope_id: w.transformationId,
        reporting_period_id: w.periodId,
        period_label: "P",
        value_basis: "period",
        value,
        value_status: "ok",
        value_reason: null,
        value_source: "entered",
        trend: "unknown",
        calculated_rag: "green",
        deviation: "within",
        threshold_source: "default",
        explanation_key: "kpi.rag.synthetic",
        data_as_of: dataAsOf,
      })
      .execute();
  });
  return evaluationId;
}

/** Holds `roleCode` at the organization (an `operations.acknowledge` holder for ADM_TECH and KDS; 0103). */
async function grantAtOrganization(w: World, roleCode: string, userId: string): Promise<void> {
  const role = await env.db.selectFrom("role").select("id").where("code", "=", roleCode).executeTakeFirstOrThrow();
  await env.owner.query(
    `INSERT INTO scoped_assignment (id, organization_id, user_id, role_id, scope_type, scope_id, reason, granted_by)
     VALUES ($1, $2, $3, $4, 'organization', $2, 'synthetic fixture', $3)`,
    [randomUUID(), w.organizationId, userId, role.id],
  );
}

async function newUser(w: World): Promise<string> {
  const id = randomUUID();
  await env.db
    .insertInto("app_user")
    .values({
      id,
      organization_id: w.organizationId,
      display_name: "Synthetic admin",
      created_by: null,
      updated_by: null,
    })
    .execute();
  return id;
}

const scan = (w: World | null, tag: string) =>
  FRESHNESS_SCAN_HANDLER.handle(env.db, w === null ? {} : { organizationId: w.organizationId }, `scan-${tag}`);
const sweep = (w: World | null, tag: string) =>
  EXCEPTION_ALERTS_HANDLER.handle(env.db, w === null ? {} : { organizationId: w.organizationId }, `alerts-${tag}`);

async function staleEvents(w: World) {
  return env.db
    .selectFrom("outbox_event")
    .select(["id", "organization_id", "event_type", "schema_version", "payload", "idempotency_key"])
    .where("event_type", "=", DATA_STALE_EVENT)
    .where("organization_id", "=", w.organizationId)
    .orderBy("seq")
    .execute();
}

const envelopeOf = (e: Awaited<ReturnType<typeof staleEvents>>[number]) => ({
  outboxEventId: e.id,
  eventType: e.event_type,
  schemaVersion: e.schema_version,
  idempotencyKey: e.idempotency_key,
  organizationId: e.organization_id,
  payload: e.payload as Record<string, unknown>,
});

const exceptionsOf = (w: World) =>
  env.db
    .selectFrom("operational_exception")
    .selectAll()
    .where("organization_id", "=", w.organizationId)
    .where("source_code", "=", `kpi:${w.kpiId}`)
    .orderBy("first_occurred_at")
    .execute();

describe("the catalogue triggers and starter 16 version 2 (ADR-0053 §3; 0117)", () => {
  it("lists connector.run_failed and data.stale, admin-selectable events of M0239, each fed to the engine", async () => {
    const rows = await env.db
      .selectFrom("automation_trigger")
      .selectAll()
      .where("code", "in", ["connector.run_failed", "data.stale"])
      .orderBy("code")
      .execute();
    expect(
      rows.map((r) => [r.code, r.trigger_kind, r.owner_module, r.condition_fields, r.admin_selectable, r.source_ref]),
    ).toEqual([
      ["connector.run_failed", "event", "integrations", ["connectorId", "failureClass"], true, "M0239"],
      ["data.stale", "event", "kpi", ["kpiId"], true, "M0239"],
    ]);
    expect(AUTOMATION_EVENT_QUEUES["connector.run_failed"]).toBe("automation.evaluate");
    expect(AUTOMATION_EVENT_QUEUES["data.stale"]).toBe("automation.evaluate");
    expect([...(QUEUES_FOR_EVENT["data.stale"] ?? [])].sort()).toEqual([
      "automation.evaluate",
      "operations.exception_raise",
    ]);
    // T-DG6-BE-K2S: connector.run_failed also keeps its domain consumer (BE-L2's connector exception; D-102).
    expect(QUEUES_FOR_EVENT["connector.run_failed"]).toEqual([
      "integrations.connector_exception",
      "automation.evaluate",
    ]);
    expect(DOMAIN_HANDLERS.map((h) => h.queue)).toEqual(
      expect.arrayContaining(OPERATIONS_HANDLERS.map((h) => h.queue)),
    );
  });

  it("version 1 is unchanged published history (superseded); version 2 is effective with the three triggers", async () => {
    const versions = await env.db
      .selectFrom("automation_rule_version")
      .selectAll()
      .where("automation_rule_id", "=", STARTER_16)
      .orderBy("version_no")
      .execute();
    expect(versions).toHaveLength(2);
    const [v1, v2] = versions;
    expect([v1!.id, v1!.status, v1!.trigger_codes, v1!.action_types, v1!.content_sha256]).toEqual([
      STARTER_16_V1,
      "superseded",
      ["job.failed"],
      ["starter_handler"],
      sha("starter:starter.job_failed:v1"),
    ]);
    expect(v1!.actions).toEqual([{ type: "starter_handler", handlers: ["jobs.failure_capture"] }]);
    expect(v1!.published_at).not.toBeNull();
    expect([v2!.id, v2!.status, v2!.trigger_codes, v2!.conditions, v2!.run_as]).toEqual([
      STARTER_16_V2,
      "published",
      ["job.failed", "connector.run_failed", "data.stale"],
      [],
      "service",
    ]);
    expect(v2!.actions).toEqual([
      { type: "starter_handler", handlers: ["jobs.failure_capture", "operations.exception_raise"] },
    ]);
    const rule = await env.db
      .selectFrom("automation_rule")
      .selectAll()
      .where("id", "=", STARTER_16)
      .executeTakeFirstOrThrow();
    expect([rule.code, rule.effective_version_id, rule.enabled, rule.disable_allowed, rule.version]).toEqual([
      "starter.job_failed",
      STARTER_16_V2,
      true,
      false,
      2,
    ]);
    const audits = await env.db
      .selectFrom("audit_event")
      .select(["action", "record_id", "prior_version", "new_version", "source"])
      .where("record_id", "in", [STARTER_16, STARTER_16_V1, STARTER_16_V2])
      .where("source", "=", "migration")
      .orderBy("seq")
      .execute();
    expect(audits.map((a) => [a.action, a.record_id, a.prior_version, a.new_version])).toEqual(
      expect.arrayContaining([
        ["automation_rule_version.create", STARTER_16_V2, null, 1],
        ["automation_rule.effective_version", STARTER_16, 1, 2],
        ["automation_rule_version.supersede", STARTER_16_V1, 1, 2],
      ]),
    );
  });

  it("the guard refuses an application version that adds a trigger and accepts one that keeps version 2's set", async () => {
    const draft = (id: string, triggers: string[]) =>
      env.db.transaction().execute(async (tx) => {
        await tx
          .insertInto("automation_rule_version")
          .values({
            id,
            automation_rule_id: STARTER_16,
            version_no: 3,
            trigger_codes: triggers,
            conditions: JSON.stringify([]),
            actions: JSON.stringify([
              { type: "starter_handler", handlers: ["jobs.failure_capture", "operations.exception_raise"] },
            ]),
            action_types: ["starter_handler"],
            run_as: "service",
            content_sha256: sha(`synthetic:${id}`),
          })
          .execute();
        await insertAuditEvent(tx, jobActor("guard-test"), {
          action: "automation_rule_version.create",
          recordType: "automation_rule_version",
          recordId: id,
          organizationId: null,
          newVersion: 1,
        });
      });
    await expect(
      draft(randomUUID(), ["job.failed", "connector.run_failed", "data.stale", "kpi.actual_accepted"]),
    ).rejects.toMatchObject({ constraint: "automation_rule_version_starter_fixed" });
    await expect(draft(randomUUID(), ["job.failed"])).rejects.toMatchObject({
      constraint: "automation_rule_version_starter_fixed",
    });
    const kept = randomUUID();
    await draft(kept, ["job.failed", "connector.run_failed", "data.stale"]);
    const row = await env.db
      .selectFrom("automation_rule_version")
      .select("status")
      .where("id", "=", kept)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe("draft");
    // Discarded again so the rest of the file sees the seeded state (a draft never runs).
    await env.db.transaction().execute(async (tx) => {
      await tx
        .updateTable("automation_rule_version")
        .set({ status: "discarded", discarded_at: sql<Date>`now()`, version: 2 })
        .where("id", "=", kept)
        .execute();
      await insertAuditEvent(tx, jobActor("guard-test"), {
        action: "automation_rule_version.discard",
        recordType: "automation_rule_version",
        recordId: kept,
        organizationId: null,
        priorVersion: 1,
        newVersion: 2,
      });
    });
  });
});

describe("kpi.freshness_scan and operations.exception_raise (ADR-0053 §2; REQ-S12-019)", () => {
  it("a KPI older than staleAfterDays -> one data_stale exception linked to it; the KPI still reads Stale with its last value and date", async () => {
    const w = await seed(env.db);
    const evaluationId = await evaluate(env.db, w, "0.4125", "2026-01-15");
    const before = await env.db
      .selectFrom("kpi_evaluation")
      .selectAll()
      .where("id", "=", evaluationId)
      .executeTakeFirstOrThrow();

    const first = (await scan(w, "1")) as { stale: number; emitted: number };
    expect([first.stale, first.emitted]).toEqual([1, 1]);
    // The same stale episode on the next scan writes nothing.
    const second = (await scan(w, "2")) as { stale: number; emitted: number };
    expect([second.stale, second.emitted]).toEqual([1, 0]);
    const events = await staleEvents(w);
    expect(events).toHaveLength(1);
    expect(events[0]!.idempotency_key).toBe(dataStaleEventKey(w.kpiId, "2026-01-15"));
    expect(events[0]!.payload).toEqual({
      kpiId: w.kpiId,
      transformationId: w.transformationId,
      dataAsOf: "2026-01-15",
      staleAfterDays: 30,
    });

    const raised = await EXCEPTION_RAISE_HANDLER.handle(env.db, envelopeOf(events[0]!), "raise-1");
    expect(raised).toMatchObject({ outcome: "done", raised: "opened" });
    // A redelivered event (relay retry, pg-boss retry) creates nothing.
    expect(await EXCEPTION_RAISE_HANDLER.handle(env.db, envelopeOf(events[0]!), "raise-1b")).toEqual({
      outcome: "duplicate",
    });

    const rows = await exceptionsOf(w);
    expect(rows).toHaveLength(1);
    const e = rows[0]!;
    expect([e.source_kind, e.failure_class, e.status, e.occurrence_count, e.last_error_code, e.dedup_key]).toEqual([
      "data_freshness",
      "data_stale",
      "open",
      1,
      "kpi.stale",
      `data_freshness:kpi:${w.kpiId}:data_stale`,
    ]);
    const identity = await env.db
      .selectFrom("service_identity")
      .select("id")
      .where("code", "=", "job:operations.exception_raise")
      .executeTakeFirstOrThrow();
    expect(e.service_identity_id).toBe(identity.id);
    const links = await env.db
      .selectFrom("operational_exception_kpi")
      .select(["kpi_definition_id", "transformation_id", "organization_id"])
      .where("operational_exception_id", "=", e.id)
      .execute();
    expect(links).toEqual([
      { kpi_definition_id: w.kpiId, transformation_id: w.transformationId, organization_id: w.organizationId },
    ]);
    // Recorded as ONE execution of starter 16 version 2, trigger data.stale.
    const execs = await env.db
      .selectFrom("automation_execution")
      .select(["automation_rule_version_id", "trigger_code", "status"])
      .where("automation_rule_id", "=", STARTER_16)
      .where("trigger_key", "=", events[0]!.idempotency_key)
      .execute();
    expect(execs).toEqual([
      { automation_rule_version_id: STARTER_16_V2, trigger_code: "data.stale", status: "succeeded" },
    ]);

    // Last known value retained with its freshness label: DG4's read is unchanged and no KPI row was written.
    const read = await kpiFreshness(
      env.db,
      { id: w.kpiId, organization_id: w.organizationId, transformation_id: w.transformationId, frequency: "monthly" },
      await today(env.db),
    );
    expect([read.freshness, read.lastValue, read.dataAsOf]).toEqual(["stale", "0.4125", "2026-01-15"]);
    const after = await env.db
      .selectFrom("kpi_evaluation")
      .selectAll()
      .where("id", "=", evaluationId)
      .executeTakeFirstOrThrow();
    expect(after).toEqual(before);
    expect(
      await env.db.selectFrom("kpi_evaluation").select("id").where("kpi_definition_id", "=", w.kpiId).execute(),
    ).toHaveLength(1);
  });

  it("one alert per open, none per recurrence; fresh again -> recovered", async () => {
    const w = await seed(env.db);
    const admin = await newUser(w);
    await grantAtOrganization(w, "ADM_TECH", admin);
    const reader = await newUser(w);
    await grantAtOrganization(w, "AUD", reader); // operations.read only: never alerted
    await evaluate(env.db, w, "0.40", "2026-01-15");
    await scan(w, "a1");
    await EXCEPTION_RAISE_HANDLER.handle(env.db, envelopeOf((await staleEvents(w))[0]!), "raise-a1");
    const [e] = await exceptionsOf(w);

    const s1 = (await sweep(w, "1")) as { alerted: number; notifications: number };
    expect([s1.alerted, s1.notifications]).toEqual([1, 1]);
    const inbox = await env.db
      .selectFrom("inbox_notification")
      .select(["recipient_user_id", "message_key", "message_params", "dedupe_key", "link_path"])
      .where("organization_id", "=", w.organizationId)
      .where("message_key", "=", EXCEPTION_OPENED_MESSAGE)
      .execute();
    expect(inbox).toEqual([
      {
        recipient_user_id: admin,
        message_key: "operations.exception_opened",
        message_params: { failureClass: "data_stale", sourceKind: "data_freshness", sourceCode: `kpi:${w.kpiId}` },
        dedupe_key: `operational_exception:${e!.id}:opened:${admin}`,
        link_path: `/admin/operations/exceptions/${e!.id}`,
      },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.obj).toMatchObject({ alert: true, alertCode: "data_stale", exceptionId: e!.id });
    expect(lines[0]!.msg).toBe("operational exception opened");
    // A second sweep alerts nothing more.
    expect(await sweep(w, "2")).toMatchObject({ alerted: 0, notifications: 0 });

    // A new stale episode (newer data, still older than 30 days) recurs the SAME exception: no alert.
    await evaluate(env.db, w, "0.41", "2026-02-01");
    expect(await scan(w, "a2")).toMatchObject({ emitted: 1 });
    const events = await staleEvents(w);
    expect(await EXCEPTION_RAISE_HANDLER.handle(env.db, envelopeOf(events[1]!), "raise-a2")).toMatchObject({
      outcome: "done",
      raised: "recurred",
    });
    const recurred = await exceptionsOf(w);
    expect(recurred.map((r) => [r.id, r.status, r.occurrence_count])).toEqual([[e!.id, "open", 2]]);
    lines.length = 0;
    expect(await sweep(w, "3")).toMatchObject({ alerted: 0, notifications: 0 });
    expect(lines).toHaveLength(0);

    // Fresh data -> the exception is resolved `recovered` (no user); a later scan changes nothing.
    await evaluate(env.db, w, "0.42", await today(env.db));
    expect(await scan(w, "a3")).toMatchObject({ stale: 0, recovered: 1 });
    const resolved = await exceptionsOf(w);
    expect(resolved.map((r) => [r.status, r.resolution, r.resolved_by])).toEqual([["resolved", "recovered", null]]);
    expect(await scan(w, "a4")).toMatchObject({ recovered: 0, emitted: 0 });
  });

  it("platform exceptions alert every organization's holders; heartbeat_missed gets no second log line", async () => {
    const w = await seed(env.db);
    const admin = await newUser(w);
    await grantAtOrganization(w, "ADM_TECH", admin);
    const opened = await env.db.transaction().execute((tx) =>
      raiseOperationalExceptionTwin(tx, jobActor("hb"), {
        organizationId: null,
        sourceKind: "worker",
        sourceCode: "worker",
        failureClass: "heartbeat_missed",
        errorCode: "worker.heartbeat_missed",
        errorMessage: "Synthetic: no beat for 90 s.",
      }),
    );
    expect(opened.outcome).toBe("opened");
    await sweep(null, "platform");
    const inbox = await env.db
      .selectFrom("inbox_notification")
      .select(["recipient_user_id", "organization_id"])
      .where("dedupe_key", "=", `operational_exception:${opened.exceptionId}:opened:${admin}`)
      .execute();
    expect(inbox).toEqual([{ recipient_user_id: admin, organization_id: w.organizationId }]);
    expect(lines.filter((l) => l.obj["exceptionId"] === opened.exceptionId)).toHaveLength(0);
  });

  it("a narrowed grant fails the scan with service_identity.out_of_scope; restoring it lets it run", async () => {
    // The grant and its audit event in ONE statement (one transaction: the audit requirement is checked at COMMIT).
    const set = (codes: string[]) =>
      env.owner.query(
        `WITH u AS (
           UPDATE service_identity SET granted_permission_codes = $1, version = version + 1,
                  reason = 'Synthetic narrowing test'
            WHERE code = 'job:kpi.freshness_scan' RETURNING id, version)
         INSERT INTO audit_event (id, actor_type, action, record_type, record_id, prior_version, new_version, source)
         SELECT mth_uuid_v7(), 'system', 'service_identity.grant_changed', 'service_identity', u.id, u.version - 1,
                u.version, 'migration' FROM u`,
        [codes],
      );
    await set(["operations.read"]);
    try {
      await expect(scan(null, "narrow")).rejects.toMatchObject({ code: "service_identity.out_of_scope" });
    } finally {
      await set(["transformation.read", "operations.read"]);
    }
    await expect(scan(null, "restored")).resolves.toMatchObject({ emitted: expect.any(Number) });
  });
});
