// Adoption interventions (T-DG4-BE-H; ADR-0033 §4, §9, §10, §12; REQ-S11-001 "an intervention with owner and due date
// appears in My Work"; REQ-S16-020 AdoptionIntervention; the REQ-PB-069 producer half). Proves, against the run's
// disposable PostgreSQL:
//  - a planned intervention with owner and due date appears in the owner's listMyWorkItems (kind
//    adoption_intervention_due, dedupe adoption.intervention:<id>:<owner>, due = the intervention's due date); an owner
//    change cancels the previous owner's item and gives the new owner one; done / cancelled closes it;
//  - the ADR-0033 §10 refusals with their exact texts (outcome_required, final, owner_required) and the archived or
//    foreign group; If-Match 428/409; one audit event per change; AUD 403; ADM-only and outsiders 404; commit-time
//    authorisation;
//  - createBelowTrajectoryIntervention, called twice for the same trigger key (a red, adverse evaluation of a real
//    accepted actual), creates one corrective intervention, one work item and one adoption.check_failed outbox event
//    with exactly the ADR-0031 §5.4 payload; its due date is 5 working days in the default calendar, Unknown
//    (calendar_not_configured) without one; its audit actor is the service, never a person.
// All data is SYNTHETIC; nothing here is a business approval or touches DG0-DG7.
import { insertAuditEvent, sql } from "@mth/db";
import { addWorkingDays } from "@mth/shared/time";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBelowTrajectoryIntervention } from "../../../src/modules/adoption/interventions.ts";
import { auditOf, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { extraUser, seedBenefitWorld, type BenefitWorld } from "../benefits/fixtures.ts";
import { seedKpiWorld, type KpiWorld } from "../kpi/fixtures.ts";
import {
  approvedTrajectory,
  DIRECT_FLOW,
  mapPartyTo,
  monthlyPeriod,
  ownedKpi,
  runRecalculation,
  submitActual,
} from "../kpi-p4/kbe-c-fixtures.ts";

type Extra = Awaited<ReturnType<typeof extraUser>>;
let api: TestApi;
let w: World;
let b: BenefitWorld;
let other: BenefitWorld;
let wl: Extra;
let wl2: Extra;
let AI: string;
let groupId: string;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
  other = await seedBenefitWorld(api, w);
  wl = await extraUser(api, w, b, "WL");
  wl2 = await extraUser(api, w, b, "WL");
  AI = `${b.base}/adoption-interventions`;
  const g = await call(api.app, "POST", `${b.base}/stakeholder-groups`, {
    session: b.s.tl,
    body: {
      name: "Synthetic branch tellers",
      impact: "M",
      currentStance: "neutral",
      requiredBehavior: "Synthetic: open accounts in the new app",
      interventionTypes: ["training", "comms"],
      ownerUserId: b.users.bo.id,
    },
  });
  expect(g.status, JSON.stringify(g.body)).toBe(201);
  groupId = g.body.id;
}, 90_000);
afterAll(async () => {
  await api.close();
}, 60_000);

const plan = async (extra: Record<string, unknown> = {}, session = b.s.tl) => {
  const r = await call(api.app, "POST", AI, {
    session,
    body: {
      stakeholderGroupId: groupId,
      interventionType: "training",
      title: "Synthetic: hands-on app training",
      ownerUserId: wl.id,
      dueDate: "2026-11-26",
      ...extra,
    },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { id: string; code: string; version: number };
};
const tasksOf = (subjectId: string) =>
  api.db
    .selectFrom("work_item")
    .select(["kind", "assignee_user_id", "status", "due_date", "dedupe_key", "subject_type", "message_key"])
    .where("subject_id", "=", subjectId)
    .orderBy("created_at")
    .execute();

describe("manual interventions and My Work (REQ-S11-001 A11)", () => {
  it("an intervention with owner and due date appears in the owner's My Work; one audit event", async () => {
    const r = await call(api.app, "POST", AI, {
      session: b.s.tl,
      body: {
        stakeholderGroupId: groupId,
        interventionType: "comms",
        title: "Synthetic: launch announcement",
        description: "Synthetic details",
        ownerUserId: wl.id,
        dueDate: "2026-11-19",
      },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect([r.headers.location, r.headers.etag]).toEqual([`${AI}/${r.body.id}`, '"1"']);
    expect(r.body).toMatchObject({
      code: expect.stringMatching(/^AI-\d{2,}$/),
      stakeholderGroupId: groupId,
      interventionType: "comms",
      ownerUserId: wl.id,
      ownerStatus: "assigned",
      dueDate: "2026-11-19",
      dueUnknownReason: null,
      status: "planned",
      origin: "manual",
      createdSource: "api",
      metricLinkId: null,
      createdBy: b.users.tl.id,
      version: 1,
    });
    const mine = await call(api.app, "GET", "/api/v1/me/work-items", { session: wl.session });
    expect(mine.status).toBe(200);
    const item = mine.body.items.find((x: { subjectId: string }) => x.subjectId === r.body.id);
    expect(item).toMatchObject({
      kind: "adoption_intervention_due",
      subjectType: "adoption_intervention",
      dueDate: "2026-11-19",
      status: "open",
    });
    expect(await tasksOf(r.body.id)).toEqual([
      {
        kind: "adoption_intervention_due",
        assignee_user_id: wl.id,
        status: "open",
        due_date: "2026-11-19",
        dedupe_key: `adoption.intervention:${r.body.id}:${wl.id}`,
        subject_type: "adoption_intervention",
        message_key: "adoption.task.intervention_due",
      },
    ]);
    expect((await auditOf(api.db, r.body.id)).map((a) => [a.action, a.new_version])).toEqual([
      ["adoption_intervention.create", 1],
    ]);
    const read = await call(api.app, "GET", `${AI}/${r.body.id}`, { session: b.s.auditor });
    expect([read.status, read.body.code]).toEqual([200, r.body.code]);
    const listed = await call(api.app, "GET", `${AI}?stakeholderGroupId=${groupId}&status=planned&origin=manual`, {
      session: b.s.auditor,
    });
    expect(listed.body.items.map((x: { id: string }) => x.id)).toContain(r.body.id);
    const group = await call(api.app, "GET", `${b.base}/stakeholder-groups/${groupId}`, { session: b.s.auditor });
    expect(group.body.openInterventionCount).toBeGreaterThanOrEqual(1);
  });

  it("an owner change moves the item; done (with its outcome) closes it and is final", async () => {
    const iv = await plan();
    const I = `${AI}/${iv.id}`;
    const moved = await call(api.app, "PATCH", I, {
      session: b.s.tl,
      headers: ifm(1),
      body: { ownerUserId: wl2.id, status: "in_progress" },
    });
    expect([moved.status, moved.body.ownerUserId, moved.body.status]).toEqual([200, wl2.id, "in_progress"]);
    expect((await tasksOf(iv.id)).map((t) => [t.assignee_user_id, t.status])).toEqual([
      [wl.id, "cancelled"],
      [wl2.id, "open"],
    ]);
    const noNote = await call(api.app, "PATCH", I, { session: b.s.tl, headers: ifm(2), body: { status: "done" } });
    expect([noNote.status, noNote.body.code, noNote.body.detail, noNote.body.errors[0].pointer]).toEqual([
      422,
      "adoption_intervention.outcome_required",
      "Record the outcome before completing or cancelling the intervention.",
      "/outcomeNote",
    ]);
    const done = await call(api.app, "PATCH", I, {
      session: b.s.tl,
      headers: ifm(2),
      body: { status: "done", outcomeNote: "Synthetic: 30 tellers trained" },
    });
    expect([done.status, done.body.status, done.body.completedBy, done.body.outcomeNote]).toEqual([
      200,
      "done",
      b.users.tl.id,
      "Synthetic: 30 tellers trained",
    ]);
    expect((await tasksOf(iv.id)).map((t) => [t.assignee_user_id, t.status])).toEqual([
      [wl.id, "cancelled"],
      [wl2.id, "done"],
    ]);
    const final = await call(api.app, "PATCH", I, { session: b.s.tl, headers: ifm(3), body: { title: "Synthetic" } });
    expect([final.status, final.body.code, final.body.detail]).toEqual([
      422,
      "adoption_intervention.final",
      "This intervention is done and can no longer be changed.",
    ]);
    expect((await auditOf(api.db, iv.id)).map((a) => a.action)).toEqual([
      "adoption_intervention.create",
      "adoption_intervention.update",
      "adoption_intervention.update",
    ]);
  });

  it("T-DG4-BE-R1: the item follows the intervention: a due-date change moves it; A -> B -> A leaves one, A's", async () => {
    const iv = await plan();
    const patch = (version: number, body: Record<string, unknown>) =>
      call(api.app, "PATCH", `${AI}/${iv.id}`, { session: b.s.tl, headers: ifm(version), body });
    const moved = await patch(1, { dueDate: "2026-12-10" });
    expect([moved.status, moved.body.dueDate]).toEqual([200, "2026-12-10"]);
    expect((await tasksOf(iv.id)).map((t) => [t.assignee_user_id, t.status, t.due_date])).toEqual([
      [wl.id, "open", "2026-12-10"],
    ]);
    const [item] = await api.db.selectFrom("work_item").select("id").where("subject_id", "=", iv.id).execute();
    expect((await auditOf(api.db, item!.id)).map((a) => [a.action, a.changes])).toEqual([
      ["work_item.create", expect.anything()],
      ["work_item.reschedule", { due_date: { from: "2026-11-26", to: "2026-12-10" } }],
    ]);
    expect((await patch(2, { ownerUserId: wl2.id })).status).toBe(200);
    expect((await patch(3, { ownerUserId: wl.id })).status).toBe(200);
    const tasks = await tasksOf(iv.id);
    expect(tasks.map((t) => [t.assignee_user_id, t.status, t.due_date, t.dedupe_key])).toEqual([
      [wl.id, "cancelled", "2026-12-10", `adoption.intervention:${iv.id}:${wl.id}`],
      [wl2.id, "cancelled", "2026-12-10", `adoption.intervention:${iv.id}:${wl2.id}`],
      [wl.id, "open", "2026-12-10", `adoption.intervention:${iv.id}:${wl.id}#2`],
    ]);
    expect(tasks.filter((t) => t.status === "open").map((t) => t.assignee_user_id)).toEqual([wl.id]);
  });

  it("cancelled closes the item; If-Match 428/409", async () => {
    const iv = await plan();
    const I = `${AI}/${iv.id}`;
    expect((await call(api.app, "PATCH", I, { session: b.s.tl, body: { title: "x" } })).status).toBe(428);
    expect((await call(api.app, "PATCH", I, { session: b.s.tl, headers: ifm(9), body: { title: "x" } })).status).toBe(
      409,
    );
    const c = await call(api.app, "PATCH", I, {
      session: b.s.tl,
      headers: ifm(1),
      body: { status: "cancelled", outcomeNote: "Synthetic: replaced by e-learning" },
    });
    expect([c.status, c.body.status, c.body.completedAt]).toEqual([200, "cancelled", null]);
    expect((await tasksOf(iv.id)).map((t) => t.status)).toEqual(["cancelled"]);
    const again = await call(api.app, "PATCH", I, { session: b.s.tl, headers: ifm(2), body: { status: "done" } });
    expect([again.status, again.body.detail]).toEqual([
      422,
      "This intervention is cancelled and can no longer be changed.",
    ]);
  });

  it("refuses 'corrective' from a person (400), a group of another transformation (422) and an archived group (422)", async () => {
    const base = { interventionType: "training", title: "Synthetic", ownerUserId: wl.id, dueDate: "2026-12-01" };
    const corrective = await call(api.app, "POST", AI, {
      session: b.s.tl,
      body: { ...base, interventionType: "corrective" },
    });
    expect([corrective.status, corrective.body.errors[0].pointer]).toEqual([400, "/interventionType"]);
    const noDue = await call(api.app, "POST", AI, { session: b.s.tl, body: { ...base, dueDate: undefined } });
    expect([noDue.status, noDue.body.errors[0].pointer]).toEqual([400, "/dueDate"]);
    const og = await call(api.app, "POST", `${other.base}/stakeholder-groups`, {
      session: other.s.tl,
      body: {
        name: "Synthetic other group",
        impact: "L",
        currentStance: "support",
        requiredBehavior: "Synthetic",
        interventionTypes: ["comms"],
        ownerUserId: other.users.bo.id,
      },
    });
    const foreign = await call(api.app, "POST", AI, {
      session: b.s.tl,
      body: { ...base, stakeholderGroupId: og.body.id },
    });
    expect([foreign.status, foreign.body.code, foreign.body.errors[0].pointer]).toEqual([
      422,
      "validation.reference",
      "/stakeholderGroupId",
    ]);
    const archived = await call(api.app, "POST", `${other.base}/stakeholder-groups/${og.body.id}/archive`, {
      session: other.s.tl,
      headers: ifm(1),
      body: { reason: "Synthetic" },
    });
    expect(archived.status).toBe(200);
    const onArchived = await call(api.app, "POST", `${other.base}/adoption-interventions`, {
      session: other.s.tl,
      body: { ...base, ownerUserId: other.users.bo.id, stakeholderGroupId: og.body.id },
    });
    expect([onArchived.status, onArchived.body.code]).toEqual([422, "stakeholder_group.archived"]);
    // Without a group (a transformation-wide intervention) is allowed.
    expect((await call(api.app, "POST", AI, { session: b.s.tl, body: base })).status).toBe(201);
  });

  it("AUD 403 on writes; ADM-only and outsiders 404 everywhere; commit-time 403; nothing written", async () => {
    const iv = await plan();
    const body = { interventionType: "comms", title: "Synthetic", ownerUserId: wl.id, dueDate: "2026-12-01" };
    expect((await call(api.app, "POST", AI, { session: b.s.auditor, body })).status).toBe(403);
    expect((await call(api.app, "POST", AI, { session: b.s.fin, body })).status).toBe(403);
    expect(
      (await call(api.app, "PATCH", `${AI}/${iv.id}`, { session: b.s.auditor, headers: ifm(1), body: { title: "x" } }))
        .status,
    ).toBe(403);
    for (const session of [b.s.admin, b.s.outsider]) {
      expect((await call(api.app, "POST", AI, { session, body })).status).toBe(404);
      expect((await call(api.app, "GET", AI, { session })).status).toBe(404);
      expect((await call(api.app, "GET", `${AI}/${iv.id}`, { session })).status).toBe(404);
      expect(
        (await call(api.app, "PATCH", `${AI}/${iv.id}`, { session, headers: ifm(1), body: { title: "x" } })).status,
      ).toBe(404);
    }
    expect(
      (await call(api.app, "GET", `${other.base}/adoption-interventions/${iv.id}`, { session: other.s.tl })).status,
    ).toBe(404);
    const u = await extraUser(api, w, b, "WL");
    const res = await afterIdentity(
      api,
      u.id,
      () =>
        call(api.app, "PATCH", `${AI}/${iv.id}`, {
          session: u.session,
          headers: ifm(1),
          body: { title: "Late edit" },
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(res.status).toBe(403);
    const row = await api.db
      .selectFrom("adoption_intervention")
      .select(["title", "version"])
      .where("id", "=", iv.id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ title: "Synthetic: hands-on app training", version: 1 });
    expect((await auditOf(api.db, iv.id)).length).toBe(1);
  });
});

describe("createBelowTrajectoryIntervention (ADR-0033 §4 steps 3-6; for KBE-F's consumer)", () => {
  let k: KpiWorld;
  let kpi: { id: string; name: string };
  let kGroupId: string;
  let linkId: string;
  const evaluations: { id: string; reportingPeriodId: string; createdAt: Date; evaluatedAt: Date }[] = [];

  beforeAll(async () => {
    const kw = await seedWorld(api.db);
    k = await seedKpiWorld(api, kw);
    await mapPartyTo(api, k, "BO", k.users.bo.id);
    const p1 = await monthlyPeriod(api, kw);
    const p2 = await monthlyPeriod(api, kw);
    kpi = await ownedKpi(api, k, DIRECT_FLOW);
    await approvedTrajectory(api, k, kpi.id, [
      { pointDate: p1.end, expectedValue: "100" },
      { pointDate: p2.end, expectedValue: "200" },
    ]);
    for (const p of [p1, p2]) {
      const res = await submitActual(api, k, kpi.id, { reportingPeriodId: p.id, value: "80" });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const [run] = await runRecalculation(api, res.body.actual.id);
      expect(run).toMatchObject({ outcome: "done" });
      const e = await api.db
        .selectFrom("kpi_evaluation")
        .select(["id", "reporting_period_id", "calculated_rag", "deviation", "evaluated_at"])
        .where("kpi_definition_id", "=", kpi.id)
        .where("reporting_period_id", "=", p.id)
        .where("value_basis", "=", "period")
        .executeTakeFirstOrThrow();
      // A red, adverse evaluation: below trajectory (ADR-0033 §4 step 2 is the caller's test).
      expect([e.calculated_rag, e.deviation]).toEqual(["red", "adverse"]);
      const ev = await api.db
        .selectFrom("outbox_event")
        .select("created_at")
        .where("event_type", "=", "kpi.deviation_evaluated")
        .where("aggregate_id", "=", e.id)
        .executeTakeFirstOrThrow();
      evaluations.push({
        id: e.id,
        reportingPeriodId: e.reporting_period_id,
        createdAt: ev.created_at,
        evaluatedAt: e.evaluated_at,
      });
    }
    const g = await call(api.app, "POST", `${k.base}/stakeholder-groups`, {
      session: k.s.tl,
      body: {
        name: "Synthetic app users",
        impact: "H",
        currentStance: "neutral",
        requiredBehavior: "Synthetic: activate the app",
        interventionTypes: ["comms"],
        ownerUserId: k.users.bo.id,
      },
    });
    expect(g.status, JSON.stringify(g.body)).toBe(201);
    kGroupId = g.body.id;
    // The metric link is KBE-F's route; written directly here with its audit event (deferred audit guard).
    linkId = uuidv7();
    const organizationId = (
      await api.db
        .selectFrom("transformation")
        .select("organization_id")
        .where("id", "=", k.transformationId)
        .executeTakeFirstOrThrow()
    ).organization_id;
    await api.db.transaction().execute(async (tx) => {
      await tx
        .insertInto("adoption_metric_link")
        .values({
          id: linkId,
          organization_id: organizationId,
          transformation_id: k.transformationId,
          template_key: "usage_activation_rate",
          kpi_definition_id: kpi.id,
          target_kind: "stakeholder_group",
          stakeholder_group_id: kGroupId,
          created_by: k.users.tl.id,
          updated_by: k.users.tl.id,
        })
        .execute();
      await insertAuditEvent(
        tx,
        { actorType: "user", actorUserId: k.users.tl.id, requestId: "test-link", source: "api" },
        {
          action: "adoption_metric_link.create",
          recordType: "adoption_metric_link",
          recordId: linkId,
          organizationId,
          transformationId: k.transformationId,
          newVersion: 1,
        },
      );
    });
  }, 120_000);

  const service = {
    actorType: "service",
    actorUserId: null,
    requestId: "job:test-adoption",
    source: "worker",
  } as const;
  const trigger = (i: number) => ({
    actor: service,
    metricLinkId: linkId,
    kpiEvaluationId: evaluations[i]!.id,
    reportingPeriodId: evaluations[i]!.reportingPeriodId,
    scopeKind: "transformation" as const,
    scopeId: k.transformationId,
    eventCreatedAt: evaluations[i]!.createdAt,
    failedAt: evaluations[i]!.evaluatedAt,
  });
  const run = (i: number) => api.db.transaction().execute((tx) => createBelowTrajectoryIntervention(tx, trigger(i)));

  it("called twice for one trigger key: one intervention, one work item, one adoption.check_failed (no calendar: due Unknown)", async () => {
    const first = await run(0);
    expect(first.outcome).toBe("created");
    const second = await run(0);
    expect(second).toEqual({
      outcome: "existing",
      interventionId: (first as { interventionId: string }).interventionId,
    });
    const id = (first as { interventionId: string }).interventionId;
    const rows = await api.db
      .selectFrom("adoption_intervention")
      .selectAll()
      .where("metric_link_id", "=", linkId)
      .where("reporting_period_id", "=", evaluations[0]!.reportingPeriodId)
      .execute();
    expect(rows.map((r) => r.id)).toEqual([id]);
    expect(rows[0]).toMatchObject({
      origin: "below_trajectory",
      intervention_type: "corrective",
      created_source: "worker",
      created_by: null,
      title: kpi.name,
      stakeholder_group_id: kGroupId,
      owner_user_id: k.users.bo.id,
      due_date: null,
      status: "planned",
      trigger_key: `${linkId}:transformation:${k.transformationId}:${evaluations[0]!.reportingPeriodId}`,
    });
    expect((await tasksOf(id)).map((t) => [t.kind, t.assignee_user_id, t.due_date, t.dedupe_key])).toEqual([
      ["adoption_intervention_due", k.users.bo.id, null, `adoption.intervention:${id}:${k.users.bo.id}`],
    ]);
    const events = await api.db
      .selectFrom("outbox_event")
      .select(["event_type", "idempotency_key", "payload", "aggregate_type"])
      .where("aggregate_id", "=", id)
      .execute();
    expect(events).toHaveLength(1);
    const businessDate = (
      await sql<{ d: string }>`SELECT p4_business_date(${evaluations[0]!.createdAt.toISOString()}::timestamptz,
        (SELECT default_timezone FROM organization o JOIN transformation t ON t.organization_id = o.id
          WHERE t.id = ${k.transformationId}::uuid))::text AS d`.execute(api.db)
    ).rows[0]!.d;
    expect(events[0]).toEqual({
      event_type: "adoption.check_failed",
      aggregate_type: "adoption_intervention",
      idempotency_key: `adoption.check_failed:${id}`,
      payload: {
        checkId: id,
        checkRecordType: "adoption_intervention",
        transformationId: k.transformationId,
        ownerUserId: k.users.bo.id,
        subjectLabel: kpi.name,
        failedAt: evaluations[0]!.evaluatedAt.toISOString(),
        businessDate,
      },
    });
    const audit = await auditOf(api.db, id);
    expect(audit.map((a) => [a.action, a.actor_type, a.actor_user_id, a.source])).toEqual([
      ["adoption_intervention.create", "service", null, "worker"],
    ]);
    // Read through the API: due date Unknown with its reason, never a guessed date.
    const read = await call(api.app, "GET", `${k.base}/adoption-interventions/${id}`, { session: k.s.auditor });
    expect(read.body).toMatchObject({
      origin: "below_trajectory",
      interventionType: "corrective",
      ownerStatus: "assigned",
      dueDate: null,
      dueUnknownReason: "calendar_not_configured",
      kpiEvaluationId: evaluations[0]!.id,
      createdSource: "worker",
    });
  });

  it("with the default calendar: due 5 working days after the business date; done without an owner is 422", async () => {
    const organizationId = (
      await api.db
        .selectFrom("transformation")
        .select("organization_id")
        .where("id", "=", k.transformationId)
        .executeTakeFirstOrThrow()
    ).organization_id;
    await sql`SELECT p4_ensure_default_calendar(${organizationId}::uuid, NULL::uuid, 'test-adoption-calendar', 'api')`.execute(
      api.db,
    );
    const cal = await api.db
      .selectFrom("business_calendar")
      .select(["timezone", "workweek"])
      .where("organization_id", "=", organizationId)
      .where("is_default", "=", true)
      .executeTakeFirstOrThrow();
    const created = await run(1);
    expect(created.outcome).toBe("created");
    const id = (created as { interventionId: string }).interventionId;
    const businessDate = (
      await sql<{
        d: string;
      }>`SELECT p4_business_date(${evaluations[1]!.createdAt.toISOString()}::timestamptz, ${cal.timezone})::text AS d`.execute(
        api.db,
      )
    ).rows[0]!.d;
    const expected = addWorkingDays(businessDate, 5, { workweek: cal.workweek.map(Number), holidays: [] }).dueDate;
    expect(expected).not.toBeNull();
    const row = await api.db
      .selectFrom("adoption_intervention")
      .select(["due_date", "version"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(String(row.due_date).slice(0, 10)).toBe(expected);
    expect((await tasksOf(id))[0]!.due_date).toBe(expected);

    // An intervention without an owner (here: the owner cleared directly, with its audit event) cannot be completed.
    await api.db.transaction().execute(async (tx) => {
      await tx
        .updateTable("adoption_intervention")
        .set({ owner_user_id: null, version: row.version + 1 })
        .where("id", "=", id)
        .execute();
      await insertAuditEvent(tx, service, {
        action: "adoption_intervention.update",
        recordType: "adoption_intervention",
        recordId: id,
        organizationId,
        transformationId: k.transformationId,
        priorVersion: row.version,
        newVersion: row.version + 1,
      });
    });
    const I = `${k.base}/adoption-interventions/${id}`;
    const unassigned = await call(api.app, "GET", I, { session: k.s.auditor });
    expect([unassigned.body.ownerStatus, unassigned.body.ownerUserId]).toEqual(["unassigned", null]);
    const noOwner = await call(api.app, "PATCH", I, {
      session: k.s.tl,
      headers: ifm(row.version + 1),
      body: { status: "done", outcomeNote: "Synthetic: recovered" },
    });
    expect([noOwner.status, noOwner.body.code, noOwner.body.detail]).toEqual([
      422,
      "adoption_intervention.owner_required",
      "Assign an owner before completing this intervention.",
    ]);
    const assigned = await call(api.app, "PATCH", I, {
      session: k.s.tl,
      headers: ifm(row.version + 1),
      body: { ownerUserId: k.users.tl.id, status: "done", outcomeNote: "Synthetic: recovered" },
    });
    expect([assigned.status, assigned.body.status, assigned.body.ownerUserId]).toEqual([200, "done", k.users.tl.id]);
  });
});
