// The two slice G scans and the failed-check chain (T-DG4-BE-I2; p4-work-split §F+G FG.5; ADR-0034 §6; REQ-S11-004,
// REQ-S03-002, REQ-PB-083, REQ-S11-008). The records are prepared through the real API (startApi, the run's disposable
// PostgreSQL) and the worker's handlers run against the same database. Proves:
//  - REQ-S11-004 A11 "after closure, the next scheduled review task is created on time" and REQ-S03-002 A11 "after a
//    transformation is closed its linked performance area still generates scheduled review tasks and accepts KPI
//    actuals": the transformation is CLOSED (SYNTHETIC direct closure-record fixture, BE-I's
//    closeTransformationSynthetic, because BE-J's closure service is not merged), then the review scan creates the
//    review due on the next review date exactly when the date enters the 7-day window (not a day earlier), for the BAU
//    owner, with its performance_review_due work item; the linked KPI accepts an actual after closure;
//  - REQ-PB-083: the first review created by the acceptance is not duplicated by the scan (it advances past it);
//  - the scans run twice create nothing twice; a worker outage is caught up once per due date;
//  - the control-check scan creates one check per control and due date (owner, else the area's BAU owner, else
//    unassigned without a work item) with its control_check_due work item, then advances next_check_date;
//  - REQ-S11-008 A11 "a failed control check creates a recovery action", end to end: recordControlCheck (failed) writes
//    one control_check.failed outbox event; delivered as the relay delivers it (twice), slice E's consumer
//    raid.corrective_control opens ONE corrective case with its owner and a follow-up date, and the check shows it;
//  - both handlers are registered for the 0050 schedules (so the worker schedules them in Asia/Riyadh).
// All data is SYNTHETIC; no job decides a business approval, accepts a handover or touches DG0-DG7.
import { insertAuditEvent } from "@mth/db";
import { outboxPayloadSchema, type OutboxEnvelope } from "@mth/shared/schemas";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, seedWorld, startApi, type TestApi, type World } from "../../../api/test/support/harness.ts";
import { ifm } from "../../../api/test/support/p2-fixtures.ts";
import { extraUser, type BenefitWorld } from "../../../api/test/integration/benefits/fixtures.ts";
import { seedKpiWorld } from "../../../api/test/integration/kpi/fixtures.ts";
import {
  DIRECT_FLOW,
  mapPartyTo,
  monthlyPeriod,
  ownedKpi,
  submitActual,
} from "../../../api/test/integration/kpi-p4/kbe-c-fixtures.ts";
import {
  areaInBau,
  closeTransformationSynthetic,
  createArea,
  type SustainmentWorld,
} from "../../../api/test/integration/contract/p4-exercises-be-i.ts";
import { DOMAIN_HANDLERS } from "../../src/handlers/index.ts";
import { CORRECTIVE_CONSUMERS, handleControlCheckFailed } from "../../src/handlers/raid.ts";
import {
  CONTROL_CHECK_SCAN_QUEUE,
  REVIEW_SCAN_QUEUE,
  runControlCheckScan,
  runReviewScan,
} from "../../src/handlers/sustainment.ts";
import { QUEUE_FOR_EVENT } from "../../src/queues/index.ts";

let api: TestApi;
let w: World;
let s: SustainmentWorld;
let kpiId: string;
let k: Awaited<ReturnType<typeof seedKpiWorld>>;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call(api.app, m, u, o);

/** YYYY-MM-DD plus `days` calendar days (UTC arithmetic on a date). */
const plusDays = (d: string, days: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
};

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  // A KPI world (KDS-owned KPI with an active direct-accept version) seen as the slice G world of BE-I's fixtures.
  k = await seedKpiWorld(api, w);
  await mapPartyTo(api, k, "BO", k.users.bo.id);
  kpiId = (await ownedKpi(api, k, DIRECT_FLOW)).id;
  const b = {
    transformationId: k.transformationId,
    organizationId: w.orgA.id,
    base: k.base,
    users: { ...k.users, bo2: k.users.sp, admin: w.admin, outsider: w.officeB },
    s: k.s,
    kpiDefinitionId: kpiId,
    benefitFormulaId: "",
  } as unknown as BenefitWorld;
  s = {
    b,
    wl: await extraUser(api, w, b, "WL"),
    to: await extraUser(api, w, b, "TO"),
    bo2: { id: k.users.sp.id, session: k.s.sp },
    areas: `${k.base}/performance-areas`,
    handovers: `${k.base}/bau-handovers`,
  };
  // The organization's default calendar (Sun-Thu, Riyadh), so the corrective case gets a follow-up date.
  await api.db.transaction().execute(async (tx) => {
    const id = randomUUID();
    await tx
      .insertInto("business_calendar")
      .values({
        id,
        organization_id: w.orgA.id,
        code: "DEFAULT",
        name_en: "Synthetic default calendar",
        name_ar: "تقويم",
        timezone: "Asia/Riyadh",
        is_default: true,
        created_by: k.users.tl.id,
        updated_by: k.users.tl.id,
      })
      .execute();
    await insertAuditEvent(
      tx,
      { actorType: "user", actorUserId: k.users.tl.id, requestId: `fixture-${id}`, source: "api" },
      {
        action: "business_calendar.create",
        recordType: "business_calendar",
        recordId: id,
        organizationId: w.orgA.id,
        newVersion: 1,
      },
    );
  });
}, 120_000);
afterAll(async () => {
  await api.close();
}, 60_000);

const org = () => ({ organizationId: w.orgA.id });
const reviewsOf = (areaId: string) =>
  api.db
    .selectFrom("sustainment_review")
    .selectAll()
    .where("performance_area_id", "=", areaId)
    .orderBy("due_date")
    .execute();
const areaRow = (id: string) =>
  api.db.selectFrom("performance_area").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
const dueOf = (d: unknown) => String(d).slice(0, 10);

describe("sustainment.review_scan after closure (REQ-S11-004, REQ-S03-002, REQ-PB-083)", () => {
  it("the closed transformation's BAU area gets its next review on time, once; its linked KPI accepts an actual", async () => {
    const { area } = await areaInBau(api, s);
    const link = await send("POST", `${s.areas}/${area.id}/links`, {
      session: k.s.bo,
      body: { linkKind: "kpi", kpiDefinitionId: kpiId },
    });
    expect(link.status, JSON.stringify(link.body)).toBe(201);
    await closeTransformationSynthetic(api, s.b);
    const t = await api.db
      .selectFrom("transformation")
      .select(["status", "archived_at"])
      .where("id", "=", k.transformationId)
      .executeTakeFirstOrThrow();
    expect([t.status, t.archived_at]).toEqual(["closed", null]);

    // The acceptance scheduled the first review on next_review_date (D1).
    const d1 = dueOf((await areaRow(area.id)).next_review_date);
    expect((await reviewsOf(area.id)).map((r) => dueOf(r.due_date))).toEqual([d1]);

    // 8 days before D1: outside the window, nothing happens. 7 days before: the scan finds the acceptance's review
    // (not duplicated) and advances the area to D2 = D1 + one month.
    expect(
      (await runReviewScan(api.db, "j1", { ...org(), asOf: plusDays(d1, -8) })).steps.filter(
        (x) => x.subjectId === area.id,
      ),
    ).toEqual([]);
    const s1 = await runReviewScan(api.db, "j2", { ...org(), asOf: plusDays(d1, -7) });
    expect(s1.steps.filter((x) => x.subjectId === area.id).map((x) => [x.dueDate, x.outcome])).toEqual([
      [d1, "existing"],
    ]);
    const after1 = await areaRow(area.id);
    const d2 = dueOf(after1.next_review_date);
    expect(d2 > d1).toBe(true);
    expect((await reviewsOf(area.id)).length).toBe(1);

    // Not early: 8 days before D2 nothing; on time: 7 days before D2 the review for D2 is created for the BAU owner.
    expect(
      (await runReviewScan(api.db, "j3", { ...org(), asOf: plusDays(d2, -8) })).steps.filter(
        (x) => x.subjectId === area.id,
      ),
    ).toEqual([]);
    const s2 = await runReviewScan(api.db, "j4", { ...org(), asOf: plusDays(d2, -7) });
    const step = s2.steps.find((x) => x.subjectId === area.id)!;
    expect([step.dueDate, step.outcome]).toEqual([d2, "created"]);
    const reviews = await reviewsOf(area.id);
    expect(
      reviews.map((r) => [dueOf(r.due_date), r.assignee_user_id, r.status, r.created_source, r.created_by]),
    ).toEqual([
      [d1, k.users.bo.id, "due", "api", k.users.bo.id],
      [d2, k.users.bo.id, "due", "worker", null],
    ]);
    const items = await api.db.selectFrom("work_item").selectAll().where("subject_id", "=", step.recordId!).execute();
    expect(items.map((i) => [i.kind, i.assignee_user_id, dueOf(i.due_date), i.dedupe_key, i.created_source])).toEqual([
      ["performance_review_due", k.users.bo.id, d2, `sustainment.review:${area.id}:${d2}`, "worker"],
    ]);
    const mine = await send("GET", "/api/v1/me/work-items", { session: k.s.bo });
    expect(mine.body.items.some((i: { subjectId: string }) => i.subjectId === step.recordId)).toBe(true);
    const audit = await api.db
      .selectFrom("audit_event")
      .selectAll()
      .where("record_id", "=", area.id)
      .orderBy("seq")
      .execute();
    expect(
      audit.filter((a) => a.action === "performance_area.review_scheduled").map((a) => [a.actor_type, a.source]),
    ).toEqual([
      ["service", "worker"],
      ["service", "worker"],
    ]);

    // The scan run twice creates nothing twice.
    const rerun = await runReviewScan(api.db, "j4", { ...org(), asOf: plusDays(d2, -7) });
    expect(rerun.steps.filter((x) => x.subjectId === area.id)).toEqual([]);
    expect((await reviewsOf(area.id)).length).toBe(2);

    // The linked KPI still accepts an actual after closure (direct-accept route).
    const period = await monthlyPeriod(api, w);
    const actual = await submitActual(api, k, kpiId, {
      reportingPeriodId: period.id,
      value: "42",
      dataAsOf: period.end,
    });
    expect(actual.status, JSON.stringify(actual.body)).toBe(201);
    expect(actual.body.actual.status).toBe("accepted");
  });

  it("after a worker outage one run catches up every missed due date, once each; a rerun creates nothing", async () => {
    const { area } = await areaInBau(api, s);
    const d1 = dueOf((await areaRow(area.id)).next_review_date);
    const asOf = plusDays(d1, 95); // about three monthly periods late
    const first = await runReviewScan(api.db, "outage-1", { ...org(), asOf });
    const mine = first.steps.filter((x) => x.subjectId === area.id);
    expect(mine.length).toBeGreaterThanOrEqual(4);
    expect(mine[0]!.outcome).toBe("existing");
    expect(mine.slice(1).every((x) => x.outcome === "created")).toBe(true);
    const dues = (await reviewsOf(area.id)).map((r) => dueOf(r.due_date));
    expect(new Set(dues).size).toBe(dues.length);
    expect(dues.length).toBe(mine.length);
    expect(dueOf((await areaRow(area.id)).next_review_date) > plusDays(asOf, 7)).toBe(true);
    const again = await runReviewScan(api.db, "outage-2", { ...org(), asOf });
    expect(again.steps.filter((x) => x.subjectId === area.id)).toEqual([]);
    expect((await reviewsOf(area.id)).length).toBe(dues.length);
  });
});

describe("sustainment.control_check_scan (REQ-S11-008)", () => {
  async function control(areaId: string, ownerUserId: string | null, nextCheckDate: string) {
    const r = await send("POST", `${k.base}/controls`, {
      session: s.to.session,
      body: {
        performanceAreaId: areaId,
        name: "Synthetic churn reconciliation",
        ownerUserId,
        frequency: "monthly",
        nextCheckDate,
      },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body as { id: string; code: string };
  }
  const checksOf = (controlId: string) =>
    api.db.selectFrom("control_check").selectAll().where("control_id", "=", controlId).orderBy("due_date").execute();

  it("one check per control and due date, on time, with its work item; twice creates nothing twice", async () => {
    const area = await createArea(send, s);
    const owned = await control(area.id, k.users.bo.id, "2030-04-14");
    const unowned = await control(area.id, null, "2030-04-14");
    const early = await runControlCheckScan(api.db, "c1", { ...org(), asOf: "2030-04-06" });
    expect(early.steps.filter((x) => x.subjectId === owned.id || x.subjectId === unowned.id)).toEqual([]);
    const onTime = await runControlCheckScan(api.db, "c2", { ...org(), asOf: "2030-04-07" });
    expect(
      onTime.steps
        .filter((x) => [owned.id, unowned.id].includes(x.subjectId))
        .map((x) => [x.subjectId, x.dueDate, x.outcome]),
    ).toEqual([owned.id, unowned.id].sort().map((id) => [id, "2030-04-14", "created"]));
    const [c1] = await checksOf(owned.id);
    expect([c1!.assignee_user_id, c1!.status, c1!.created_source, c1!.created_by]).toEqual([
      k.users.bo.id,
      "due",
      "worker",
      null,
    ]);
    const items = await api.db.selectFrom("work_item").selectAll().where("subject_id", "=", c1!.id).execute();
    expect(items.map((i) => [i.kind, i.assignee_user_id, dueOf(i.due_date), i.dedupe_key])).toEqual([
      ["control_check_due", k.users.bo.id, "2030-04-14", `sustainment.control_check:${c1!.id}`],
    ]);
    // An unowned control of an establishing area (no BAU owner): unassigned, no work item (never a guessed person).
    const [c2] = await checksOf(unowned.id);
    expect(c2!.assignee_user_id).toBeNull();
    expect(await api.db.selectFrom("work_item").select("id").where("subject_id", "=", c2!.id).execute()).toEqual([]);
    const ctl = await api.db.selectFrom("control").selectAll().where("id", "=", owned.id).executeTakeFirstOrThrow();
    expect([dueOf(ctl.next_check_date), ctl.version, ctl.updated_by]).toEqual(["2030-05-14", 2, null]);
    const again = await runControlCheckScan(api.db, "c2", { ...org(), asOf: "2030-04-07" });
    expect(again.steps.filter((x) => [owned.id, unowned.id].includes(x.subjectId))).toEqual([]);
    expect((await checksOf(owned.id)).length).toBe(1);
  });

  it("end to end: a failed check emits one control_check.failed and slice E opens ONE recovery case (owner, follow-up)", async () => {
    const { area } = await areaInBau(api, s);
    const ctl = await control(area.id, k.users.bo.id, "2030-06-10");
    await runControlCheckScan(api.db, "e2e", { ...org(), asOf: "2030-06-03" });
    const [check] = await checksOf(ctl.id);
    const failed = await send("POST", `${k.base}/control-checks/${check!.id}/record`, {
      session: s.to.session,
      headers: ifm(1),
      body: { result: "failed", resultNote: "Synthetic: reconciliation off by 2%" },
    });
    expect(failed.status, JSON.stringify(failed.body)).toBe(200);
    const events = await api.db.selectFrom("outbox_event").selectAll().where("aggregate_id", "=", check!.id).execute();
    expect(events.map((e) => [e.event_type, e.idempotency_key])).toEqual([
      ["control_check.failed", `control_check.failed:${check!.id}`],
    ]);
    // The relay's routing and validation for this event, then its envelope delivered twice (a redelivery).
    expect(QUEUE_FOR_EVENT["control_check.failed"]).toBe(CORRECTIVE_CONSUMERS.control);
    const e = events[0]!;
    outboxPayloadSchema(e.event_type, e.schema_version)!.parse(e.payload);
    const envelope: OutboxEnvelope = {
      outboxEventId: e.id,
      eventType: e.event_type,
      schemaVersion: e.schema_version,
      idempotencyKey: e.idempotency_key,
      organizationId: e.organization_id,
      payload: e.payload as Record<string, unknown>,
    };
    await handleControlCheckFailed(api.db, envelope, `job-${e.id}`);
    await handleControlCheckFailed(api.db, envelope, `job-${e.id}-redelivered`);
    const cases = await api.db
      .selectFrom("corrective_case")
      .selectAll()
      .where("source_record_type", "=", "control_check")
      .where("source_record_id", "=", check!.id)
      .execute();
    expect(cases).toHaveLength(1);
    const c = cases[0]!;
    expect([c.source_kind, c.owner_user_id, c.title, c.status, c.created_source]).toEqual([
      "control_check",
      k.users.bo.id,
      "Synthetic churn reconciliation",
      "open",
      "worker",
    ]);
    expect(c.follow_up_date).not.toBeNull();
    const followUps = await api.db.selectFrom("work_item").selectAll().where("subject_id", "=", c.id).execute();
    expect(followUps.map((i) => [i.kind, i.assignee_user_id])).toEqual([["corrective_case_follow_up", k.users.bo.id]]);
    const listed = await send("GET", `${k.base}/control-checks?status=failed&performanceAreaId=${area.id}`, {
      session: k.s.auditor,
    });
    expect(listed.body.items.map((x: { id: string; correctiveCaseId: string }) => [x.id, x.correctiveCaseId])).toEqual([
      [check!.id, c.id],
    ]);
  });
});

describe("registration", () => {
  it("both scans have handlers and enabled 0050 schedules in Asia/Riyadh", async () => {
    const queues = new Set(DOMAIN_HANDLERS.map((h) => h.queue));
    expect([queues.has(REVIEW_SCAN_QUEUE), queues.has(CONTROL_CHECK_SCAN_QUEUE)]).toEqual([true, true]);
    const rows = await api.db
      .selectFrom("job_schedule")
      .select(["code", "queue_name", "cron", "timezone", "enabled", "owner_module"])
      .where("owner_module", "=", "sustainment")
      .orderBy("code")
      .execute();
    expect(rows).toEqual([
      {
        code: CONTROL_CHECK_SCAN_QUEUE,
        queue_name: CONTROL_CHECK_SCAN_QUEUE,
        cron: "25 0 * * *",
        timezone: "Asia/Riyadh",
        enabled: true,
        owner_module: "sustainment",
      },
      {
        code: REVIEW_SCAN_QUEUE,
        queue_name: REVIEW_SCAN_QUEUE,
        cron: "20 0 * * *",
        timezone: "Asia/Riyadh",
        enabled: true,
        owner_module: "sustainment",
      },
    ]);
  });
});
