// DG2 round-1 repairs of the kpi module (T-DG2-KBE2), against a real PostgreSQL. All data is synthetic.
//  - F-DG2-141 (REQ-S10-001): T02 trajectory approval is a business approval (kpi_target.approve). Nobody approves a
//    trajectory whose current target or trajectory they set or last changed - not only the row's creator. A BO holds
//    both outcome.edit and kpi_target.approve, which is exactly the bypass the finding reproduced.
//  - F-DG2-201 (REQ-PB-017): POST /kpi-definitions/{id}/activate (draft -> active), so the G2 criterion
//    g2.kpi_definitions, which needs an ACTIVE definition, can be satisfied through the product.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadKpiGateFacts } from "../../../src/modules/kpi/index.ts";
import {
  auditOf,
  auditOfRequest,
  call,
  seedWorld,
  startApi,
  type Session,
  type TestApi,
} from "../../support/harness.ts";
import { ifMatch, seedKpiWorld, type KpiWorld } from "./fixtures.ts";

let api: TestApi;
let k: KpiWorld;

beforeAll(async () => {
  api = await startApi();
  const w = await seedWorld(api.db);
  k = await seedKpiWorld(api, w);
  // The kpi fixture inserts the transformation row directly; give it the P2 starter structure (gate instances G1-G6)
  // the way the platform does for every transformation (migration 0018), so the live G2 view can be read.
  await api.owner.query("SELECT p2_instantiate_transformation($1, NULL, NULL, 'migration')", [k.transformationId]);
});
afterAll(() => api.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const post = (url: string, session: Session, body: unknown, headers: Record<string, string> = {}) =>
  call<Body>(api.app, "POST", url, { session, body, headers });
const patch = (url: string, session: Session, body: unknown, version: number) =>
  call<Body>(api.app, "PATCH", url, { session, body, headers: ifMatch(version) });
const errorCode = (res: { body: Body }) => res.body?.errors?.[0]?.code ?? res.body?.code;

async function newKpi(session: Session, body: Record<string, unknown> = {}) {
  const res = await post(`${k.base}/kpi-definitions`, session, {
    name: `Repair KPI ${Math.random().toString(36).slice(2, 10)}`,
    unitKind: "percentage",
    unitLabel: "%",
    polarity: "lower_is_better",
    ...body,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string; version: number; status: string };
}

async function newRow(session: Session, body: Record<string, unknown> = {}) {
  const d = await newKpi(k.s.kds);
  const res = await post(`${k.base}/outcome-kpis`, session, {
    outcomeId: k.outcomeId,
    kpiDefinitionId: d.id,
    targetDate: "2027-12-31",
    ...body,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string; version: number };
}

const versionOf = async (table: "outcome_kpi" | "kpi_definition", id: string) =>
  (await api.owner.query<{ version: number }>(`SELECT version FROM ${table} WHERE id = $1`, [id])).rows[0]!.version;

// ------------------------------------------------------------------------------------------------ F-DG2-141

describe("F-DG2-141: trajectory approval is refused to whoever set or last changed the target/trajectory", () => {
  it("repro: TL creates a row with target 100, BO changes it to 5, BO approves -> 403 (audited); SP approves", async () => {
    const row = await newRow(k.s.tl, { targetValue: "100" });
    const changed = await patch(`${k.base}/outcome-kpis/${row.id}`, k.s.bo, { targetValue: "5" }, 1);
    expect([changed.status, changed.body.targetValue, changed.body.version]).toEqual([200, "5.000000", 2]);
    const url = `${k.base}/outcome-kpis/${row.id}/trajectory-approval`;

    const own = await post(url, k.s.bo, { note: "approving my own target" }, ifMatch(2));
    expect([own.status, own.body.code]).toEqual([403, "kpi.target_author_cannot_approve"]);
    // Nothing changed, and the request's only audit row is the denial, by BO, naming the business approval right.
    expect(await versionOf("outcome_kpi", row.id)).toBe(2);
    const denial = await auditOfRequest(api.db, String(own.headers["x-request-id"]));
    expect(denial.map((e) => [e.action, e.actor_user_id, e.record_id])).toEqual([
      ["authorization.denied", k.users.bo.id, row.id],
    ]);
    const after = await call<Body>(api.app, "GET", `${k.base}/outcome-kpis/${row.id}`, { session: k.s.bo });
    expect(after.body).toMatchObject({ trajectoryStatus: "draft", trajectoryApprovedBy: null, version: 2 });
    const facts = await loadKpiGateFacts(api.db, k.transformationId);
    expect(facts.outcomeKpis.find((f) => f.id === row.id)!.trajectoryStatus).toBe("draft");

    // A legitimate approver - who did not set the current target - still approves.
    const sp = await post(url, k.s.sp, { note: "Agreed (synthetic)." }, ifMatch(2));
    expect(sp.status, JSON.stringify(sp.body)).toBe(200);
    expect(sp.body).toMatchObject({ trajectoryStatus: "approved", trajectoryApprovedBy: k.users.sp.id, version: 3 });
  });

  it("covers every trajectory part: a BO who last changed the trajectory points or the target date is refused", async () => {
    for (const change of [
      { trajectoryPoints: [{ date: "2027-06-30", value: "50" }] },
      { targetDate: "2027-11-30" },
      { baselineValue: "120" },
    ]) {
      const row = await newRow(k.s.tl, { targetValue: "100" });
      expect((await patch(`${k.base}/outcome-kpis/${row.id}`, k.s.bo, change, 1)).status).toBe(200);
      // TL then changes the target VALUE: BO is still the author of the part they changed.
      expect((await patch(`${k.base}/outcome-kpis/${row.id}`, k.s.tl, { targetValue: "90" }, 2)).status).toBe(200);
      const res = await post(`${k.base}/outcome-kpis/${row.id}/trajectory-approval`, k.s.bo, {}, ifMatch(3));
      expect([res.status, res.body.code], JSON.stringify(change)).toEqual([403, "kpi.target_author_cannot_approve"]);
      expect(await versionOf("outcome_kpi", row.id)).toBe(3);
    }
  });

  it("refuses a BO who set the target value even when somebody else edited other columns later", async () => {
    const d = await newKpi(k.s.kds);
    const created = await post(`${k.base}/outcome-kpis`, k.s.kds, {
      outcomeId: k.outcomeId,
      kpiDefinitionId: d.id,
      targetDate: "2027-12-31",
    });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    // BO sets the target value; KDS then edits only the ordinal (not trajectory content).
    expect((await patch(`${k.base}/outcome-kpis/${id}`, k.s.bo, { targetValue: "7" }, 1)).status).toBe(200);
    expect((await patch(`${k.base}/outcome-kpis/${id}`, k.s.kds, { ordinal: 3 }, 2)).status).toBe(200);
    const res = await post(`${k.base}/outcome-kpis/${id}/trajectory-approval`, k.s.bo, {}, ifMatch(3));
    expect([res.status, res.body.code]).toEqual([403, "kpi.target_author_cannot_approve"]);
  });

  it("lets a BO approve once another person has replaced every trajectory part the BO had set", async () => {
    const row = await newRow(k.s.tl, { targetValue: "100" });
    expect((await patch(`${k.base}/outcome-kpis/${row.id}`, k.s.bo, { targetValue: "5" }, 1)).status).toBe(200);
    expect((await patch(`${k.base}/outcome-kpis/${row.id}`, k.s.kds, { targetValue: "6" }, 2)).status).toBe(200);
    const res = await post(`${k.base}/outcome-kpis/${row.id}/trajectory-approval`, k.s.bo, { note: "ok" }, ifMatch(3));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ trajectoryStatus: "approved", trajectoryApprovedBy: k.users.bo.id, version: 4 });
  });

  it("a BO who edited only non-trajectory columns (owner, leading indicator text) may still approve", async () => {
    const row = await newRow(k.s.tl, { targetValue: "100" });
    const edit = await patch(
      `${k.base}/outcome-kpis/${row.id}`,
      k.s.bo,
      { ownerUserId: k.users.bo.id, leadingIndicatorText: "Weekly churn calls (synthetic)" },
      1,
    );
    expect(edit.status).toBe(200);
    const res = await post(`${k.base}/outcome-kpis/${row.id}/trajectory-approval`, k.s.bo, {}, ifMatch(2));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it("the creator rule still holds (kpi.creator_cannot_approve), and re-editing after approval resets authorship", async () => {
    const row = await newRow(k.s.bo, { targetValue: "100" });
    const url = `${k.base}/outcome-kpis/${row.id}/trajectory-approval`;
    const byCreator = await post(url, k.s.bo, {}, ifMatch(1));
    expect([byCreator.status, byCreator.body.code]).toEqual([403, "kpi.creator_cannot_approve"]);
    expect((await post(url, k.s.sp, {}, ifMatch(1))).status).toBe(200);
    // SP holds no outcome.edit, so the approval itself is no trajectory edit; a TL edit returns it to draft.
    const edited = await patch(`${k.base}/outcome-kpis/${row.id}`, k.s.tl, { targetValue: "95" }, 2);
    expect(edited.body).toMatchObject({ trajectoryStatus: "draft", version: 3 });
    expect((await post(url, k.s.sp, {}, ifMatch(3))).status).toBe(200);
    const actions = (await auditOf(api.db, row.id)).map((e) => e.action);
    expect(actions).toEqual([
      "outcome_kpi.create",
      "authorization.denied",
      "outcome_kpi.trajectory_approve",
      "outcome_kpi.update",
      "outcome_kpi.trajectory_approve",
    ]);
  });
});

// ------------------------------------------------------------------------------------------------ F-DG2-201

describe("F-DG2-201: activateKpiDefinition (draft -> active)", () => {
  const activate = (id: string, session: Session, version?: number) =>
    call<Body>(api.app, "POST", `${k.base}/kpi-definitions/${id}/activate`, {
      session,
      headers: version === undefined ? {} : ifMatch(version),
    });

  it("activates with If-Match: 428 without it, 409 when stale, then 200 active, version + 1, one audit event", async () => {
    const d = await newKpi(k.s.kds);
    expect(d.status).toBe("draft");
    const missing = await activate(d.id, k.s.kds);
    expect(missing.status).toBe(428);
    const stale = await activate(d.id, k.s.kds, 7);
    expect(stale.status).toBe(409);
    expect(await versionOf("kpi_definition", d.id)).toBe(1);

    const ok = await activate(d.id, k.s.kds, 1);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ id: d.id, status: "active", version: 2 });
    expect(ok.headers.etag).toBe('"2"');
    const events = await auditOfRequest(api.db, String(ok.headers["x-request-id"]));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: "kpi_definition.activate",
      actor_user_id: k.users.kds.id,
      prior_version: 1,
      new_version: 2,
    });
    expect(events[0]!.changes).toEqual({ status: { from: "draft", to: "active" } });

    // loadKpiGateFacts reports the activated definition as active (BE's g2.kpi_definitions reads this).
    const facts = await loadKpiGateFacts(api.db, k.transformationId);
    expect(facts.kpiDefinitions.find((f) => f.id === d.id)).toMatchObject({
      status: "active",
      hasUnit: true,
      polarity: "lower_is_better",
    });

    const again = await activate(d.id, k.s.kds, 2);
    expect([again.status, errorCode(again)]).toEqual([422, "kpi_definition.already_active"]);
    expect(await versionOf("kpi_definition", d.id)).toBe(2);
  });

  it("TL may activate; FIN, SP, BO and the auditor get 403 (audited), unknown ids 404", async () => {
    const d = await newKpi(k.s.tl);
    for (const who of ["fin", "sp", "bo", "auditor"] as const) {
      const res = await activate(d.id, k.s[who], 1);
      expect([res.status, res.body.code], who).toEqual([403, "forbidden"]);
      const audit = await auditOfRequest(api.db, String(res.headers["x-request-id"]));
      expect(audit.map((e) => [e.action, e.actor_user_id])).toEqual([["authorization.denied", k.users[who].id]]);
    }
    expect(await versionOf("kpi_definition", d.id)).toBe(1);
    expect((await activate("01920000-0000-7000-8000-00000000dead", k.s.tl, 1)).status).toBe(404);
    expect((await activate(d.id, k.s.outsider, 1)).status).toBe(404);
    expect((await activate(d.id, k.s.tl, 1)).body.status).toBe("active");
  });

  it("requires the measurable fields: unit kind 'other' without a unit label is 422 until it has one", async () => {
    const d = await newKpi(k.s.kds, { unitKind: "other", unitLabel: null });
    const refused = await activate(d.id, k.s.kds, 1);
    expect([refused.status, errorCode(refused)]).toEqual([422, "kpi_definition.not_measurable"]);
    expect(refused.body.errors?.[0]?.pointer).toBe("/unitLabel");
    expect(await versionOf("kpi_definition", d.id)).toBe(1);
    expect(
      (await loadKpiGateFacts(api.db, k.transformationId)).kpiDefinitions.find((f) => f.id === d.id),
    ).toMatchObject({ status: "draft", hasUnit: false });
    expect((await patch(`${k.base}/kpi-definitions/${d.id}`, k.s.kds, { unitLabel: "calls" }, 1)).status).toBe(200);
    const ok = await activate(d.id, k.s.kds, 2);
    expect(ok.body).toMatchObject({ status: "active", version: 3 });
  });

  it("an archived definition cannot be activated (422); an active one stays editable and active", async () => {
    const d = await newKpi(k.s.kds);
    const archived = await post(
      `${k.base}/kpi-definitions/${d.id}/archive`,
      k.s.kds,
      { reason: "Not needed" },
      ifMatch(1),
    );
    expect(archived.status).toBe(200);
    const res = await activate(d.id, k.s.kds, 2);
    expect([res.status, errorCode(res)]).toEqual([422, "kpi_definition.archived"]);
    expect(await versionOf("kpi_definition", d.id)).toBe(2);

    const live = await newKpi(k.s.kds);
    expect((await activate(live.id, k.s.kds, 1)).status).toBe(200);
    const edited = await patch(
      `${k.base}/kpi-definitions/${live.id}`,
      k.s.kds,
      { description: "Edited (synthetic)" },
      2,
    );
    expect(edited.body).toMatchObject({ status: "active", version: 3 });
  });

  it("an activated definition clears g2.kpi_definitions.not_active for that KPI in the live G2 evaluation", async () => {
    const d = await newKpi(k.s.kds, { ownerUserId: k.users.kds.id });
    const row = await post(`${k.base}/outcome-kpis`, k.s.kds, {
      outcomeId: k.outcomeId,
      kpiDefinitionId: d.id,
      targetDate: "2027-12-31",
      targetValue: "3",
    });
    expect(row.status).toBe(201);
    const missingFor = async () => {
      const g2 = await call<Body>(api.app, "GET", `${k.base}/gates/G2`, { session: k.s.tl });
      expect(g2.status, JSON.stringify(g2.body).slice(0, 300)).toBe(200);
      const criterion = (g2.body.criteria as Body[]).find((c) => c.key === "g2.kpi_definitions");
      expect(criterion).toBeDefined();
      return (criterion.missing as { code: string; pointer?: string }[])
        .filter((m) => m.pointer === `/kpiDefinitions/${d.id}`)
        .map((m) => m.code);
    };
    expect(await missingFor()).toEqual(["g2.kpi_definitions.not_active"]);
    expect((await activate(d.id, k.s.kds, 1)).status).toBe(200);
    expect(await missingFor()).toEqual([]);
  });
});
