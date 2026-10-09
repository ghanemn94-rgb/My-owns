// Downstream impact (T-DG4-BE-M; ADR-0038 §6; REQ-S03-006 "changing a KPI target lists the linked benefits and
// dashboards as affected"). Proves, against the run's disposable PostgreSQL: after a KPI target change (a new P4 KPI
// version with a target, through slice A), `getRecordImpact` on the KPI definition and on its outcome KPI lists the
// linked benefits (`valueAffected`) and the Outcomes and Value areas with the transformation, executive and Finance
// dashboards; an initiative's impact names the Portfolio area and its downstream records with distances and edge kinds;
// the cursor pages the records; nothing is stored; 404 outside scope or for an unknown record.
// All data is SYNTHETIC; nothing here grants a business approval or touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { cxBody } from "../benefits/fixtures.ts";
import { seedTraceWorld, type TraceWorld } from "../contract/p4-exercises-be-m.ts";

let api: TestApi;
let w: World;
let t: TraceWorld;
let cxBenefitId: string;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  t = await seedTraceWorld(api, w);
  const L = `${t.base}/trace-links`;
  const post = (body: Record<string, unknown>) =>
    call(api.app, "POST", L, { session: t.s.bo, body: { contributionStatement: "Synthetic", ...body } });
  expect(
    (await post({ linkKind: "deliverable_capability", fromId: t.deliverableId, toId: t.capability1Id })).status,
  ).toBe(201);
  expect((await post({ linkKind: "capability_kpi", fromId: t.capability1Id, toId: t.kpi1Id })).status).toBe(201);
  expect(
    (await post({ linkKind: "kpi_benefit", fromId: t.kpi1Id, toId: t.benefitId, allocationShare: "0.5" })).status,
  ).toBe(201);
  // A non-financial benefit measured by the KPI definition of kpi1 (edge kpi_benefit_measure).
  const cx = await call(api.app, "POST", `${t.base}/benefits`, { session: t.s.bo, body: cxBody(t) });
  expect(cx.status, JSON.stringify(cx.body)).toBe(201);
  cxBenefitId = cx.body.id as string;
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

interface Impact {
  records: {
    recordType: string;
    recordId: string;
    distance: number;
    edgeKinds: string[];
    valueAffected: boolean;
    href: string;
  }[];
  dashboards: {
    dashboard: string;
    areaCode: string | null;
    transformationId: string | null;
    workstreamId: string | null;
  }[];
  hiddenCount: number;
  nextCursor: string | null;
}
const impactOf = async (type: string, id: string, query = "") => {
  const r = await call(api.app, "GET", `/api/v1/records/${type}/${id}/impact${query}`, { session: t.s.auditor });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body as Impact;
};
const dashKeys = (i: Impact) => i.dashboards.map((d) => `${d.dashboard}:${d.areaCode ?? "-"}`);

describe("REQ-S03-006: changing a KPI target lists the linked benefits and dashboards as affected", () => {
  it("after a new KPI version with a target, the KPI's impact lists both benefits and the Outcomes/Value dashboards", async () => {
    // Change the KPI target through slice A: a P4 KPI version carrying the new target (a synthetic value).
    const def = await call(api.app, "GET", `${t.base}/kpi-definitions/${t.kpiDefinitionId}`, { session: t.s.tl });
    expect(def.status).toBe(200);
    if (def.body.status !== "active")
      expect(
        (
          await call(api.app, "POST", `${t.base}/kpi-definitions/${t.kpiDefinitionId}/activate`, {
            session: t.s.tl,
            headers: ifm(def.body.version),
          })
        ).status,
      ).toBe(200);
    const version = await call(api.app, "POST", `${t.base}/kpi-definitions/${t.kpiDefinitionId}/versions`, {
      session: t.s.tl,
      body: {
        measureType: "higher_is_better",
        valueNature: "stock",
        aggregationRule: "last_value",
        submissionRoute: "direct_accept",
        targetValue: "72",
        targetDate: "2027-12-31",
      },
    });
    expect(version.status, JSON.stringify(version.body)).toBe(201);

    for (const [type, id] of [
      ["kpi_definition", t.kpiDefinitionId],
      ["outcome_kpi", t.kpi1Id],
    ] as const) {
      const impact = await impactOf(type, id);
      const benefits = impact.records.filter((r) => r.recordType === "benefit");
      expect(benefits.map((b) => b.recordId).sort(), type).toEqual([t.benefitId, cxBenefitId].sort());
      expect(benefits.every((b) => b.valueAffected)).toBe(true);
      expect(impact.records.filter((r) => r.recordType !== "benefit").every((r) => !r.valueAffected)).toBe(true);
      const keys = dashKeys(impact);
      for (const k of [
        "transformation:-",
        "executive:-",
        "transformation:outcomes",
        "executive:outcomes",
        "transformation:value",
        "executive:value",
        "finance:value",
      ])
        expect(keys, `${type} ${k}`).toContain(k);
      expect(impact.hiddenCount).toBe(0);
      const viaLink = benefits.find((b) => b.recordId === t.benefitId)!;
      expect(viaLink.edgeKinds).toEqual(type === "outcome_kpi" ? ["kpi_benefit"] : ["kpi_benefit"]);
      expect(viaLink.distance).toBe(type === "outcome_kpi" ? 1 : 2);
      expect(impact.dashboards.find((d) => d.dashboard === "transformation")!.transformationId).toBe(
        t.transformationId,
      );
    }
    // Nothing is stored: no table gained an impact row (the read model writes nothing; JK.10 item 2).
    const audit = await api.db
      .selectFrom("audit_event")
      .select("id")
      .where("action", "like", "%impact%")
      .where("transformation_id", "=", t.transformationId)
      .execute();
    expect(audit.length).toBe(0);
  });

  it("a deliverable's impact walks capability -> KPI -> benefits with distances and names the Portfolio area", async () => {
    const impact = await impactOf("deliverable", t.deliverableId);
    const byId = new Map(impact.records.map((r) => [r.recordId, r]));
    expect(byId.get(t.capability1Id)?.distance).toBe(1);
    expect(byId.get(t.kpi1Id)?.edgeKinds).toEqual(["deliverable_capability", "capability_kpi"]);
    expect(byId.get(t.benefitId)?.distance).toBe(3);
    expect(dashKeys(impact)).toEqual(
      expect.arrayContaining([
        "transformation:portfolio",
        "transformation:outcomes",
        "transformation:value",
        "finance:value",
      ]),
    );
    for (const r of impact.records)
      expect((await call(api.app, "GET", r.href, { session: t.s.auditor })).status).toBe(200);
  });

  it("the cursor pages the records; 404 outside scope and for an unknown record", async () => {
    const all = (await impactOf("deliverable", t.deliverableId)).records.map((r) => r.recordId);
    const first = await impactOf("deliverable", t.deliverableId, "?limit=2");
    expect(first.records.map((r) => r.recordId)).toEqual(all.slice(0, 2));
    const second = await impactOf(
      "deliverable",
      t.deliverableId,
      `?limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`,
    );
    expect(second.records.map((r) => r.recordId)).toEqual(all.slice(2, 4));
    expect(
      (await call(api.app, "GET", `/api/v1/records/benefit/${t.benefitId}/impact`, { session: t.s.outsider })).status,
    ).toBe(404);
    expect(
      (await call(api.app, "GET", `/api/v1/records/benefit/${t.kpi1Id}/impact`, { session: t.s.auditor })).status,
    ).toBe(404);
    expect(
      (await call(api.app, "GET", `/api/v1/records/budget/${t.kpi1Id}/impact`, { session: t.s.auditor })).status,
    ).toBe(400);
  });
});
