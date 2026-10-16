// REQ-S16-021 (ADR-0048 §11; p5-work-split §H.4; T-DG5-KBE-G2): the sustainment, improvement and health entity group
// BAUHandover, Control, ControlCheck, ImprovementItem, Lesson and HealthAssessment. The acceptance: "an integration
// test creates and reads each one through the API with authorization enforced". Each entity is created through its
// API (DG4 routes; the health routes of this task) and read back through the API, and each write is refused with 403
// for a caller without the write right (FIN holds none of the six) and for AUD; an outsider gets 404.
//
// ControlCheck has no create operation by design (ADR-0034 §6): checks are created by the worker's control-check scan
// from an active control's schedule, so the scan is called in-process (ADR-0002: the test, not the API, imports the
// worker); the check is then read and recorded through the API, and the refusals are tested on its write operation
// (`recordControlCheck`). Every value is SYNTHETIC; the handover acceptance in the fixture is a synthetic in-product
// approval of test data, and nothing here touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runControlCheckScan } from "../../../../worker/src/handlers/sustainment.ts";
import { call, seedWorld, startApi, type RequestOptions, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { areaInBau, createArea, fullContent, seedSustainmentWorld } from "../contract/p4-exercises-be-i.ts";

let api: TestApi;
let w: World;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const req = (m: string, u: string, o?: RequestOptions) => call<Body>(api.app, m, u, o);

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

describe("REQ-S16-021: each entity of the group is created and read through the API, with authorization enforced", () => {
  it("BAUHandover, Control, ControlCheck, ImprovementItem, Lesson and HealthAssessment", async () => {
    const s = await seedSustainmentWorld(api, w);
    const { b } = s;
    const refused = [b.s.fin, b.s.auditor]; // FIN: none of the six write rights; AUD: read-only
    const ids: Record<string, string> = {};

    // ------------------------------------------------------------------ BAUHandover (owner receiving_owner_user_id)
    const area = await createArea(req, s, { name: "Synthetic S16-021 area" });
    const hoBody = { performanceAreaId: area.id, receivingOwnerUserId: b.users.bo.id, ...fullContent(b.users.bo.id) };
    for (const session of refused) expect((await req("POST", s.handovers, { session, body: hoBody })).status).toBe(403);
    expect((await req("POST", s.handovers, { session: b.s.outsider, body: hoBody })).status).toBe(404);
    const ho = await req("POST", s.handovers, { session: s.wl.session, body: hoBody });
    expect([ho.status, ho.body.status, ho.body.receivingOwnerUserId]).toEqual([201, "draft", b.users.bo.id]);
    const hoRead = await req("GET", `${s.handovers}/${ho.body.id}`, { session: b.s.auditor });
    expect([hoRead.status, hoRead.body.id, hoRead.body.status]).toEqual([200, ho.body.id, "draft"]);
    ids["bau_handover"] = ho.body.id;

    // ------------------------------------------------------------------ Control (owner owner_user_id)
    const { area: bauArea } = await areaInBau(api, s, req);
    const controls = `${b.base}/controls`;
    const ctlBody = {
      performanceAreaId: bauArea.id,
      name: "Synthetic S16-021 control",
      ownerUserId: b.users.bo.id,
      frequency: "monthly",
      nextCheckDate: "2026-01-05",
    };
    for (const session of refused) expect((await req("POST", controls, { session, body: ctlBody })).status).toBe(403);
    const ctl = await req("POST", controls, { session: s.to.session, body: ctlBody });
    expect([ctl.status, ctl.body.status, ctl.body.ownerUserId]).toEqual([201, "active", b.users.bo.id]);
    const ctlRead = await req("GET", `${controls}?performanceAreaId=${bauArea.id}`, { session: b.s.auditor });
    expect(ctlRead.status).toBe(200);
    expect(ctlRead.body.items.find((x: Body) => x.id === ctl.body.id)?.status).toBe("active");
    ids["control"] = ctl.body.id;

    // ------------------------------------------------------------------ ControlCheck (created by the scan; owner assignee)
    const scan = await runControlCheckScan(api.db, "s16-021-group", {
      asOf: "2026-01-05",
      organizationId: b.organizationId,
    });
    expect(scan.steps.find((x) => x.subjectId === ctl.body.id)?.outcome).toBe("created");
    const checks = await req("GET", `${b.base}/control-checks?performanceAreaId=${bauArea.id}&status=due`, {
      session: b.s.auditor,
    });
    expect(checks.status).toBe(200);
    const check = checks.body.items.find((k: Body) => k.controlId === ctl.body.id);
    expect(check.status).toBe("due");
    const K = `${b.base}/control-checks/${check.id}/record`;
    for (const session of refused)
      expect((await req("POST", K, { session, headers: ifm(1), body: { result: "passed" } })).status).toBe(403);
    const recorded = await req("POST", K, { session: s.to.session, headers: ifm(1), body: { result: "passed" } });
    expect([recorded.status, recorded.body.status]).toEqual([200, "passed"]);
    ids["control_check"] = check.id;

    // ------------------------------------------------------------------ ImprovementItem (owner owner_user_id)
    const items = `${b.base}/improvement-items`;
    const ciBody = {
      title: "Synthetic S16-021 improvement",
      sourceKind: "control_check",
      sourceId: check.id,
      priority: "M",
    };
    for (const session of refused) expect((await req("POST", items, { session, body: ciBody })).status).toBe(403);
    const ci = await req("POST", items, { session: s.to.session, body: ciBody });
    expect([ci.status, ci.body.status]).toEqual([201, "open"]);
    const ciRead = await req("GET", `${items}?status=open`, { session: b.s.auditor });
    expect(ciRead.body.items.map((x: Body) => x.id)).toContain(ci.body.id);
    ids["improvement_item"] = ci.body.id;

    // ------------------------------------------------------------------ Lesson (owner created_by)
    const lessons = `${b.base}/lessons`;
    const llBody = { title: "Synthetic S16-021 lesson", lessonText: "Synthetic: reassess the health check quarterly" };
    for (const session of refused) expect((await req("POST", lessons, { session, body: llBody })).status).toBe(403);
    const ll = await req("POST", lessons, { session: s.to.session, body: llBody });
    expect([ll.status, ll.body.status]).toEqual([201, "draft"]);
    const llRead = await req("GET", `${lessons}?status=draft`, { session: b.s.auditor });
    expect(llRead.body.items.map((x: Body) => x.id)).toContain(ll.body.id);
    ids["lesson"] = ll.body.id;

    // ------------------------------------------------------------------ HealthAssessment (owner owner_user_id; this task)
    const hc = `${b.base}/health-checks`;
    const hcBody = { assessmentDate: "2026-10-16" };
    for (const session of refused) expect((await req("POST", hc, { session, body: hcBody })).status).toBe(403);
    expect((await req("POST", hc, { session: b.s.outsider, body: hcBody })).status).toBe(404);
    const ha = await req("POST", hc, { session: b.s.tl, body: hcBody });
    expect([ha.status, ha.body.status, ha.body.ownerUserId]).toEqual([201, "draft", b.users.tl.id]);
    const haRead = await req("GET", `${hc}/${ha.body.id}`, { session: b.s.auditor });
    expect([haRead.status, haRead.body.id, haRead.body.status, haRead.body.band]).toEqual([
      200,
      ha.body.id,
      "draft",
      null,
    ]);
    const haList = await req("GET", hc, { session: b.s.auditor });
    expect(haList.body.items.map((x: Body) => x.id)).toEqual([ha.body.id]);
    for (const session of refused)
      expect(
        (await req("PUT", `${hc}/${ha.body.id}/answers/q01`, { session, headers: ifm(1), body: { response: "yes" } }))
          .status,
      ).toBe(403);
    ids["health_assessment"] = ha.body.id;

    // Every entity has a primary key, an owner column and a status (ADR-0048 §11), read from the database.
    const owner: Record<string, string> = {
      bau_handover: "receiving_owner_user_id",
      control: "owner_user_id",
      control_check: "assignee_user_id",
      improvement_item: "owner_user_id",
      lesson: "created_by",
      health_assessment: "owner_user_id",
    };
    expect(Object.keys(ids).sort()).toEqual(Object.keys(owner).sort());
    for (const [table, id] of Object.entries(ids)) {
      const cols = await api.db
        .selectFrom("information_schema.columns" as never)
        .select(["column_name" as never])
        .where("table_name" as never, "=", table as never)
        .execute();
      const names = (cols as { column_name: string }[]).map((c) => c.column_name);
      expect(names, table).toEqual(expect.arrayContaining(["id", owner[table]!, "status"]));
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
});
