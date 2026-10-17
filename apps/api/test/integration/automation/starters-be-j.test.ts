// Slice E, T-DG5-BE-J (ADR-0044 §1, §2, §7; p5-work-split §E.1) through the API against the run's disposable
// PostgreSQL, with the worker's own handlers driven by the outbox events the API wrote (as the relay delivers them):
//  - REQ-S12-001, request starters: a committed G1 submission records ONE execution of starter 5
//    (`gate.submission_requested`, key = the submission id) in the request's transaction; a REFUSED submission
//    (mandatory evidence missing, 422) records none; starters 6 and 7 on the real gate events record one execution
//    each, and replay x3 adds nothing (REQ-S12-021) while the DG4 outputs stay those of the DG4 handlers;
//  - REQ-S12-004, API part: `launchPlan` is accepted on create and travels in the v2 event (null without it); an
//    impossible start date is 400;
//  - REQ-S12-012: a 5-day slip of a critical-path dependency records one slip and, through starter 9, notifies each
//    affected owner ONCE (replay x3 adds nothing); the dependent forecasts stored with the slip move per D-166 Rule B
//    (the finish-to-start forward pass over planned starts: B, with no slack, moves by the 5 days; C, with enough
//    slack after B, does not move; T-DG5-BE-T4 replaced BE-J's before = after expectation); a move earlier, a non-critical dependency (critical path not
//    computable, no needed-by) and a needed-by breach are each handled per ADR-0044 §7; listDependencySlips reads them
//    (TL, AUD), 404 outside scope, 400 on a bad limit.
// Every value is SYNTHETIC; the gate decision is a demo decision by a test person that approves nothing real. No job
// decides anything, and nothing touches the engineering gates DG0-DG7.
import { sql } from "@mth/db";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DOMAIN_HANDLERS } from "../../../../worker/src/handlers/index.ts";
import { ruleAuthor } from "../../support/automation-failures.ts";
import { DEPENDENCY_SLIP_KIND } from "../../../../worker/src/handlers/portfolio.ts";
import { recordRequestExecution, REQUEST_STARTERS } from "../../../src/modules/platform/index.ts";
import {
  call,
  createTransformationRow,
  seedWorld,
  signIn,
  startApi,
  type Res,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { G1_AGREEMENTS, gateVersion, ifm, makeG1Ready, setupP2World, type P2World } from "../../support/p2-fixtures.ts";
import {
  insertAudited,
  insertMilestone,
  newDependency,
  seedExecutionWorld,
  setDuration,
  type ExecWorld,
} from "../portfolio/execution-fixtures.ts";

let api: TestApi;
let w: World;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const send = (m: string, u: string, o?: Parameters<typeof call>[3]): Promise<Res<any>> => call(api.app, m, u, o);
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 60_000);
afterAll(() => api.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

async function envelopeOf(idempotencyKey: string) {
  const r = await api.db
    .selectFrom("outbox_event")
    .select(["id", "organization_id", "event_type", "schema_version", "payload", "idempotency_key"])
    .where("idempotency_key", "=", idempotencyKey)
    .executeTakeFirstOrThrow();
  return {
    outboxEventId: r.id,
    eventType: r.event_type,
    schemaVersion: r.schema_version,
    idempotencyKey: r.idempotency_key,
    organizationId: r.organization_id,
    payload: r.payload as Record<string, unknown>,
  };
}
const handler = (queue: string) => DOMAIN_HANDLERS.find((h) => h.queue === queue)!;
const executions = (ruleCode: string, triggerKey: string) =>
  api.db
    .selectFrom("automation_execution as e")
    .innerJoin("automation_rule as r", "r.id", "e.automation_rule_id")
    .innerJoin("automation_rule_version as v", "v.id", "e.automation_rule_version_id")
    .select(["e.id", "e.trigger_code", "e.trigger_key", "e.status", "e.run_as", "e.transformation_id", "v.version_no"])
    .where("r.code", "=", ruleCode)
    .where("e.trigger_key", "=", triggerKey)
    .execute();
const resultCount = async (executionId: string) =>
  (
    await api.db
      .selectFrom("automation_action_result")
      .select("id")
      .where("automation_execution_id", "=", executionId)
      .execute()
  ).length;

describe("REQ-S12-001: the gate starters (5 request, 6 and 7 events)", () => {
  let p: P2World;
  beforeAll(async () => {
    p = await setupP2World(api, w);
  });

  it("a REFUSED submission (mandatory evidence missing) records no execution of starter 5", async () => {
    const r = await send("POST", `/api/v1/transformations/${p.transformationId}/gates/G1/submissions`, {
      session: p.lead.session,
      headers: ifm(await gateVersion(api, p, "G1")),
      body: { submissionNote: "Synthetic" },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    const rows = await api.db
      .selectFrom("automation_execution as e")
      .innerJoin("automation_rule as r", "r.id", "e.automation_rule_id")
      .select("e.id")
      .where("r.code", "=", "starter.gate_evidence_missing")
      .where("e.transformation_id", "=", p.transformationId)
      .execute();
    expect(rows).toEqual([]);
  });

  it("a committed submission records one execution of starter 5; starters 6 and 7 record one each, replay x3 none", async () => {
    await makeG1Ready(api, p);
    const sub = await send("POST", `/api/v1/transformations/${p.transformationId}/gates/G1/submissions`, {
      session: p.lead.session,
      headers: ifm(await gateVersion(api, p, "G1")),
      body: { submissionNote: "Synthetic" },
    });
    expect(sub.status, JSON.stringify(sub.body)).toBe(201);
    const s5 = await executions("starter.gate_evidence_missing", sub.body.id);
    expect(s5).toHaveLength(1);
    expect(s5[0]).toMatchObject({
      trigger_code: "gate.submission_requested",
      status: "succeeded",
      run_as: "service",
      transformation_id: p.transformationId,
      version_no: 1,
    });
    expect(await resultCount(s5[0]!.id)).toBe(1);

    // Starter 6 on gates.submitted: the DG4 output (one task for the Sponsor), once; replays are the DG4 duplicates.
    const submitted = await envelopeOf(`gate.submitted:${sub.body.id}`);
    const first = (await handler("gates.submitted").handle(api.db, submitted, "be-j-g1-s", {
      retryCount: 0,
      retryLimit: 5,
    })) as Body;
    expect([first.outcome, first.approverUserIds, first.created]).toEqual(["done", [p.sponsor.id], 1]);
    for (let i = 0; i < 3; i += 1)
      expect(((await handler("gates.submitted").handle(api.db, submitted, `be-j-g1-s-${i}`)) as Body).outcome).toBe(
        "duplicate",
      );
    const s6 = await executions("starter.gate_submission_routing", submitted.idempotencyKey);
    expect(s6.map((e) => [e.trigger_code, e.status])).toEqual([["gate.submitted", "succeeded"]]);
    expect(await resultCount(s6[0]!.id)).toBe(1);

    // A demo Sponsor decision (synthetic; approves nothing real), then starter 7 on gates.decided.
    const d = await send("POST", `/api/v1/transformations/${p.transformationId}/gates/G1/decision`, {
      session: p.sponsor.session,
      body: {
        submissionNo: sub.body.submissionNo,
        outcome: "approved",
        rationale: "Synthetic demo",
        agreements: G1_AGREEMENTS,
      },
    });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    const decided = await envelopeOf(`gate.decided:${d.body.id}`);
    const out = (await handler("gates.decided").handle(api.db, decided, "be-j-g1-d", {
      retryCount: 0,
      retryLimit: 5,
    })) as Body;
    expect([out.outcome, out.closedDone, out.stepsInserted]).toEqual(["done", 1, 3]);
    for (let i = 0; i < 3; i += 1) await handler("gates.decided").handle(api.db, decided, `be-j-g1-d-${i}`);
    const s7 = await executions("starter.gate_approved", decided.idempotencyKey);
    expect(s7.map((e) => [e.trigger_code, e.status])).toEqual([["gate.decided", "succeeded"]]);
    expect(await resultCount(s7[0]!.id)).toBe(1);
  });
});

describe("REQ-S12-004: launchPlan on create (API part)", () => {
  it("accepted and carried by the v2 event; absent -> null; an impossible start date -> 400", async () => {
    const office = await signIn(api.app, w.office.subject);
    const base = { businessUnitId: w.a1, name: `Synthetic launch ${randomUUID().slice(0, 6)}`, mode: "end_to_end" };
    const withPlan = await send("POST", "/api/v1/transformations", {
      session: office,
      body: { ...base, launchPlan: { startDate: "2026-10-01" } },
    });
    expect(withPlan.status, JSON.stringify(withPlan.body)).toBe(201);
    const e1 = await envelopeOf(`transformation.created:${withPlan.body.id}`);
    expect([e1.schemaVersion, e1.payload["launchPlan"]]).toEqual([2, { startDate: "2026-10-01" }]);
    const without = await send("POST", "/api/v1/transformations", { session: office, body: base });
    expect(without.status).toBe(201);
    expect((await envelopeOf(`transformation.created:${without.body.id}`)).payload["launchPlan"]).toBeNull();
    const bad = await send("POST", "/api/v1/transformations", {
      session: office,
      body: { ...base, launchPlan: { startDate: "2026-02-30" } },
    });
    expect(bad.status).toBe(400);
    const extra = await send("POST", "/api/v1/transformations", {
      session: office,
      body: { ...base, launchPlan: { startDate: "2026-10-01", days: 90 } },
    });
    expect(extra.status).toBe(400);
  });
});

describe("REQ-S12-012: critical dependency slips", () => {
  let x: ExecWorld;
  const ini = { A: "", B: "", C: "", D: "" };
  let milestoneA: string;
  beforeAll(async () => {
    x = await seedExecutionWorld(api, w);
    const owned = (code: string, owner: string | null, plannedStart: string | null = null) =>
      insertAudited(api.db, x, "initiative", {
        code,
        name: `Synthetic initiative ${code}`,
        executive_owner_user_id: owner,
        planned_start: plannedStart,
      });
    // A -> B -> C (critical chain), A -> D (owner WL), B and C both owned by BO (one notification for BO).
    // Planned starts (D-166 Rule B): B starts on A's finish (2026-11-01, no slack); C starts 2026-12-10, nine days
    // after B's finish (2026-12-01), so a 5-day slip of B leaves C unmoved.
    ini.A = await owned("INI-01", x.users.tl.id);
    ini.B = await owned("INI-02", x.users.bo.id, "2026-11-01");
    ini.C = await owned("INI-03", x.users.bo.id, "2026-12-10");
    ini.D = await owned("INI-04", x.users.wl.id);
    await newDependency(send, x, ini.A, ini.B);
    await newDependency(send, x, ini.B, ini.C);
    await newDependency(send, x, ini.A, ini.D);
    for (const [k, d] of [
      ["A", 5],
      ["B", 10],
      ["C", 3],
      ["D", 2],
    ] as const)
      await setDuration(send, x, ini[k], d);
    milestoneA = await insertMilestone(api.db, x, ini.A, null, "2026-11-01");
    await insertMilestone(api.db, x, ini.B, null, "2026-12-01");
    await insertMilestone(api.db, x, ini.C, null, "2027-01-10");
    await insertMilestone(api.db, x, ini.D, null, "2026-11-20");
  });

  const moveA = async (forecastDate: string) => {
    const cur = await send("GET", `/api/v1/milestones/${milestoneA}`, { session: x.s.tl });
    const r = await send("PATCH", `/api/v1/milestones/${milestoneA}`, {
      session: x.s.tl,
      headers: ifm(cur.body.version),
      body: { forecastDate },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body;
  };
  const slips = async () =>
    api.db
      .selectFrom("dependency_slip")
      .selectAll()
      .where("transformation_id", "=", x.transformationId)
      .orderBy("created_at")
      .execute();

  it("a 5-day slip on the critical path: one slip; each affected owner notified once; replay x3 adds nothing", async () => {
    await moveA("2026-11-06");
    const rows = await slips();
    const critical = rows.filter((r) => r.critical_reason === "critical_path");
    // A -> B is on the critical path (A, B, C: 18 working days); A -> D is not, and has no needed-by.
    expect(critical).toHaveLength(1);
    const slip = critical[0]!;
    expect(rows).toHaveLength(1);
    expect([slip.slip_days, String(slip.predecessor_finish_before).slice(0, 10)]).toEqual([5, "2026-11-01"]);
    // Affected: every initiative reachable from B (B, C), with owners and the D-166 Rule B forecasts. B: own finish
    // 2026-12-01, required start = A's finish (11-01 before, 11-06 after), planned start 11-01 -> shift 0, then 5 ->
    // 2026-12-01 before, 2026-12-06 after (no slack: moves by the slip). C: own finish 2027-01-10, required start =
    // B's forward finish (12-01, then 12-06), planned start 12-10 -> shift 0 both times (enough slack: does not move).
    expect(slip.affected).toEqual([
      {
        initiativeId: ini.B,
        initiativeCode: "INI-02",
        ownerUserId: x.users.bo.id,
        forecastFinishBefore: "2026-12-01",
        forecastFinishAfter: "2026-12-06",
      },
      {
        initiativeId: ini.C,
        initiativeCode: "INI-03",
        ownerUserId: x.users.bo.id,
        forecastFinishBefore: "2027-01-10",
        forecastFinishAfter: "2027-01-10",
      },
    ]);
    // Nothing else is stored or overwritten (ADR-0044 §7): the dependents' milestones keep their forecasts.
    const kept = await api.db
      .selectFrom("milestone")
      .select(["initiative_id", sql<string | null>`forecast_date::text`.as("f")])
      .where("initiative_id", "in", [ini.B, ini.C])
      .orderBy("forecast_date")
      .execute();
    expect(kept.map((m) => m.f)).toEqual(["2026-12-01", "2027-01-10"]);
    // Starter 9 on the event, three times: BO (owner of B and C) gets ONE item and one notification.
    const event = await envelopeOf(`dependency.slipped:${slip.id}`);
    expect(event.payload).toEqual({
      slipId: slip.id,
      dependencyId: slip.dependency_id,
      transformationId: x.transformationId,
      slipDays: 5,
    });
    const r1 = (await handler("portfolio.dependency_slip").handle(api.db, event, "be-j-slip", {
      retryCount: 0,
      retryLimit: 5,
    })) as Body;
    expect([r1.outcome, r1.notified]).toEqual(["done", [x.users.bo.id]]);
    for (let i = 0; i < 3; i += 1)
      expect(
        ((await handler("portfolio.dependency_slip").handle(api.db, event, `be-j-slip-${i}`)) as Body).outcome,
      ).toBe("duplicate");
    const items = await api.db
      .selectFrom("work_item")
      .select(["assignee_user_id", "message_params"])
      .where("kind", "=", DEPENDENCY_SLIP_KIND)
      .where("subject_id", "=", slip.id)
      .execute();
    expect(items).toHaveLength(1);
    const depCode = (
      await api.db
        .selectFrom("dependency")
        .select("code")
        .where("id", "=", slip.dependency_id)
        .executeTakeFirstOrThrow()
    ).code;
    expect(items[0]!.message_params).toEqual({
      dependencyCode: depCode,
      slipDays: 5,
      initiativeCodes: "INI-02, INI-03",
    });
    const notices = await api.db
      .selectFrom("inbox_notification")
      .select("id")
      .where("recipient_user_id", "=", x.users.bo.id)
      .where("dedupe_key", "=", `dependency_slip:${slip.id}:${x.users.bo.id}`)
      .execute();
    expect(notices).toHaveLength(1);
    const execs = await executions("starter.dependency_slip", event.idempotencyKey);
    expect(execs.map((e) => [e.trigger_code, e.status])).toEqual([["dependency.slipped", "succeeded"]]);
  });

  it("a move earlier, and an unchanged finish, raise nothing", async () => {
    const before = (await slips()).length;
    await moveA("2026-11-03");
    await moveA("2026-11-03");
    expect(await slips()).toHaveLength(before);
  });

  it("not computable critical path and no needed-by: a slip raises nothing; with a needed-by breached it does", async () => {
    const before = (await slips()).length;
    await send("PATCH", `/api/v1/initiatives/${ini.D}/schedule`, {
      session: x.s.tl,
      headers: ifm(1),
      body: { durationWorkingDays: null },
    });
    await moveA("2026-11-10"); // the critical path is not computable now: no edge is critical, A -> B has no needed-by
    expect(await slips()).toHaveLength(before);
    const dep = await api.db
      .selectFrom("dependency")
      .select(["id", "version"])
      .where("from_initiative_id", "=", ini.A)
      .where("to_initiative_id", "=", ini.D)
      .executeTakeFirstOrThrow();
    const nb = await send("PATCH", `/api/v1/dependencies/${dep.id}`, {
      session: x.s.tl,
      headers: ifm(dep.version),
      body: { neededBy: "2026-11-12" },
    });
    expect(nb.status, JSON.stringify(nb.body)).toBe(200);
    await moveA("2026-11-15");
    const after = await slips();
    expect(after).toHaveLength(before + 1);
    expect(after.at(-1)).toMatchObject({ dependency_id: dep.id, critical_reason: "needed_by_breached", slip_days: 5 });
  });

  it("listDependencySlips: newest first for TL and AUD; 404 outside scope; 400 on a bad limit", async () => {
    const url = `/api/v1/transformations/${x.transformationId}/dependency-slips`;
    const tl = await send("GET", `${url}?limit=1`, { session: x.s.tl });
    expect(tl.status, JSON.stringify(tl.body)).toBe(200);
    expect(tl.body.items).toHaveLength(1);
    expect(tl.body.items[0]).toMatchObject({ criticalReason: "needed_by_breached", slipDays: 5 });
    const next = await send("GET", `${url}?limit=1&cursor=${encodeURIComponent(tl.body.nextCursor)}`, {
      session: x.s.auditor,
    });
    expect(next.status).toBe(200);
    expect(next.body.items[0]).toMatchObject({ criticalReason: "critical_path", dependencyCode: expect.any(String) });
    expect((await send("GET", url, { session: x.s.outsider })).status).toBe(404);
    expect((await send("GET", `${url}?limit=0`, { session: x.s.tl })).status).toBe(400);
    expect((await send("GET", url)).status).toBe(401);
  });
});

// Last in this file: it publishes a new effective version of starter 9 for this test database.
describe("REQ-S12-012: a slip below the configured minimumSlipDays raises nothing (starter 9 version 2)", () => {
  it("v2 with minimumSlipDays 7 (reviewed and published): a 5-day slip raises nothing, an 8-day slip raises one", async () => {
    const R = "/api/v1/admin/automation-rules";
    const author = await ruleAuthor(api, w);
    const office = await signIn(api.app, w.office.subject);
    const list = await send("GET", `${R}?origin=starter&limit=50`, { session: author.session });
    const rule = list.body.items.find((r: Body) => r.code === "starter.dependency_slip");
    const v = await send("POST", `${R}/${rule.id}/versions`, {
      session: author.session,
      headers: ifm(rule.version),
      body: { changeSummary: "Synthetic: raise only slips of a week or more." },
    });
    expect(v.status, JSON.stringify(v.body)).toBe(201);
    const url = `${R}/${rule.id}/versions/${v.body.versionNo}`;
    const set = await send("PATCH", url, {
      session: author.session,
      headers: ifm(v.body.version),
      body: { content: { ...v.body.content, parameters: { minimumSlipDays: 7 } } },
    });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    const run = await send("POST", `${url}/dry-runs`, {
      session: author.session,
      body: {
        triggerCode: "dependency.slipped",
        payload: { dependencyId: randomUUID(), transformationId: randomUUID(), slipDays: 7 },
      },
    });
    expect([run.status, run.body.outcome], JSON.stringify(run.body)).toEqual([201, "pass"]);
    const submitted = await send("POST", `${url}/submit`, { session: author.session, headers: ifm(set.body.version) });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    // A configuration review by another person (synthetic); it is not a business approval.
    const reviewed = await send("POST", `${url}/review`, {
      session: office,
      headers: ifm(submitted.body.version),
      body: { outcome: "approve", note: "Synthetic configuration review." },
    });
    expect(reviewed.status, JSON.stringify(reviewed.body)).toBe(200);
    const fresh = (await send("GET", `${R}/${rule.id}`, { session: author.session })).body;
    const pub = await send("POST", `${url}/publish`, { session: author.session, headers: ifm(fresh.version) });
    expect(pub.status, JSON.stringify(pub.body)).toBe(200);

    // A fresh critical chain A -> B; A's finish moves 5 days (below 7): nothing; then 8 more days: one slip.
    const x = await seedExecutionWorld(api, w);
    const a = await insertAudited(api.db, x, "initiative", {
      code: "INI-01",
      name: "Synthetic A",
      executive_owner_user_id: x.users.tl.id,
    });
    const b = await insertAudited(api.db, x, "initiative", {
      code: "INI-02",
      name: "Synthetic B",
      executive_owner_user_id: x.users.bo.id,
    });
    await newDependency(send, x, a, b);
    await setDuration(send, x, a, 5);
    await setDuration(send, x, b, 10);
    const m = await insertMilestone(api.db, x, a, null, "2026-11-01");
    const move = async (forecastDate: string, version: number) => {
      const r = await send("PATCH", `/api/v1/milestones/${m}`, {
        session: x.s.tl,
        headers: ifm(version),
        body: { forecastDate },
      });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    };
    const count = async () =>
      (
        await api.db
          .selectFrom("dependency_slip")
          .select("id")
          .where("transformation_id", "=", x.transformationId)
          .execute()
      ).length;
    await move("2026-11-06", 1);
    expect(await count()).toBe(0);
    await move("2026-11-14", 2);
    const rows = await api.db
      .selectFrom("dependency_slip")
      .select(["slip_days", "critical_reason"])
      .where("transformation_id", "=", x.transformationId)
      .execute();
    expect(rows).toEqual([{ slip_days: 8, critical_reason: "critical_path" }]);
  });
});

describe("REQ-S12-001: the request-starter recorder (starters 14 and 15; platform/request-executions.ts)", () => {
  it("records one execution per committed request key; a second call is `existing`; a rolled-back request leaves none", async () => {
    const t = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
    const audit = { actorUserId: w.office.id, requestId: `test-${randomUUID()}` };
    const scope = { organizationId: w.orgA.id, transformationId: t, audit };
    for (const starter of [REQUEST_STARTERS.bauHandoverAccepted, REQUEST_STARTERS.revisionProposed]) {
      const key = randomUUID();
      const first = await api.db.transaction().execute((tx) => recordRequestExecution(tx, starter, key, scope));
      const again = await api.db.transaction().execute((tx) => recordRequestExecution(tx, starter, key, scope));
      expect([first, again]).toEqual(["recorded", "existing"]);
      const rows = await executions(starter.ruleCode, key);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        trigger_code: starter.triggerCode,
        status: "succeeded",
        run_as: "service",
        transformation_id: t,
      });
      expect(await resultCount(rows[0]!.id)).toBe(1);
      // Three audit events (start, result, succeed) in the request's transaction, as the service for the user.
      const events = await api.db
        .selectFrom("audit_event")
        .select(["action", "actor_type", "on_behalf_of_user_id", "request_id"])
        .where("request_id", "=", audit.requestId)
        .where("record_type", "in", ["automation_execution", "automation_action_result"])
        .execute();
      expect(events.filter((e) => e.actor_type === "service" && e.on_behalf_of_user_id === w.office.id).length).toBe(
        events.length,
      );
      // A refused request rolls back: its execution is never recorded.
      const refusedKey = randomUUID();
      await expect(
        api.db.transaction().execute(async (tx) => {
          await recordRequestExecution(tx, starter, refusedKey, scope);
          throw new Error("synthetic refusal");
        }),
      ).rejects.toThrow("synthetic refusal");
      expect(await executions(starter.ruleCode, refusedKey)).toEqual([]);
    }
  });
});
