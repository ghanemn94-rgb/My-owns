// The T10 dashboards against a real PostgreSQL (T-DG4-KBE-G; ADR-0037 §1-§5, §8; p4-work-split §J+K JK.4):
//  - REQ-PB-062: all six areas render with their bilingual seed labels from persisted data, and each headline drills to
//    its contributing records;
//  - REQ-PB-063: an outcome whose linked initiative has every milestone achieved and its deliverable accepted, but whose
//    KPI is below trajectory, is red or amber; a KPI with no actual is unknown (value null, never 0);
//  - REQ-PB-064: one open T16 ask due yesterday in Asia/Riyadh makes Decisions red and lists it; after its outcome is
//    recorded it is not counted;
//  - REQ-S03-009: after an accepted KPI actual the overview's Outcomes area shows the new actual once and
//    outcomes.kpi_status lists the source actual;
//  - the workstream dashboard (Decisions and People & adoption not_applicable; archived 422);
//  - read models store nothing (no table write; a read-only transaction).
// All data is synthetic; nothing here grants a business approval or touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import type { KpiWorld } from "../kpi/fixtures.ts";
import { acceptDeliverable, insertDeliverable, type BenefitWorld } from "../benefits/fixtures.ts";
import {
  acceptedActual,
  activeOutcome,
  areaOf,
  askDue,
  completedDelivery,
  dashboardWorld,
  decideAsk,
  launchedInitiative,
  openPeriod,
  outcomeKpi,
  riyadhToday,
  trajectoryKpi,
  workstreamOf,
  type Body,
} from "../contract/p4-exercises-kbe-g.ts";

let api: TestApi;
let w: World;
let k: KpiWorld;
let today: string;
let yesterday: string;
let kpi1: { id: string; name: string };
let kpi2: { id: string; name: string };
let ok1: string;
let ok2: string;
let outcome2: string;
let initiative: string;
let april: { id: string };

const get = (url: string) => call<Body>(api.app, "GET", url, { session: k.s.auditor });

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  k = await dashboardWorld(api, w);
  ({ today, yesterday } = await riyadhToday(api));
  await openPeriod(api, w, "monthly", "2026-03", "2026-03-01", "2026-03-31");
  april = await openPeriod(api, w, "monthly", "2026-04", "2026-04-01", "2026-04-30");
  kpi1 = await trajectoryKpi(api, k);
  kpi2 = await trajectoryKpi(api, k);
  ok1 = await outcomeKpi(api.db, k, k.outcomeId, kpi1.id, w.orgA.id);
  outcome2 = await activeOutcome(
    api.db,
    w.orgA.id,
    k.transformationId,
    k.users.tl.id,
    "Synthetic outcome without data",
  );
  ok2 = await outcomeKpi(api.db, k, outcome2, kpi2.id, w.orgA.id);
  // Every delivery signal of the initiative linked to outcome 1 is complete (REQ-PB-063 probe).
  initiative = await launchedInitiative(api.db, k, w.orgA.id, "INI-01");
  await completedDelivery(api.db, k, w.orgA.id, initiative, k.outcomeId);
  const fake = {
    organizationId: w.orgA.id,
    transformationId: k.transformationId,
    users: k.users,
  } as unknown as BenefitWorld;
  await acceptDeliverable(api.db, fake, await insertDeliverable(api.db, fake, initiative));
}, 180_000);
afterAll(() => api.close());

describe("REQ-PB-062: the six T10 areas from persisted data, with drill-down", () => {
  it("renders all six areas in Template 10 order with the seeded en and ar labels and every member", async () => {
    const res = await get(`${k.base}/dashboard`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const seed = await api.db.selectFrom("t10_area_definition").selectAll().orderBy("ordinal").execute();
    expect(res.body.areas).toHaveLength(6);
    res.body.areas.forEach((a: Body, i: number) => {
      const s = seed[i]!;
      expect([
        a.code,
        a.ordinal,
        a.sourceAreaEn,
        a.areaAr,
        a.sourceWhatToShowEn,
        a.whatToShowAr,
        a.sourceRagLogicEn,
        a.ragLogicAr,
        a.arProvisional,
      ]).toEqual([
        s.code,
        s.ordinal,
        s.source_area_en,
        s.area_ar,
        s.source_what_to_show_en,
        s.what_to_show_ar,
        s.source_rag_logic_en,
        s.rag_logic_ar,
        true,
      ]);
      expect(a.rag.policySource).toBe("default");
      expect(a.rag.ruleKey).toMatch(/^dashboard\.rag\./);
      expect(Array.isArray(a.headlines) && Array.isArray(a.items)).toBe(true);
    });
    expect(areaOf(res.body, "outcomes").sourceRagLogicEn).toBe(
      "RAG based on target trajectory, not activity completion",
    );
    expect(res.body.timezone).toBe("Asia/Riyadh");
    expect(res.body.businessDate).toBe(today);
  });

  it("each headline's drilldownHref answers 200 with the same metric and its contributing records", async () => {
    await acceptedActual(api, k, kpi1.id, april.id, "50", today);
    const res = await get(`${k.base}/dashboard`);
    const hrefs = (res.body.areas as Body[]).flatMap((a) => a.headlines.map((h: Body) => [h.metric, h.drilldownHref]));
    expect(hrefs.length).toBeGreaterThanOrEqual(5);
    for (const [metric, href] of hrefs) {
      const d = await get(href);
      expect([d.status, d.body.metric], `${metric}: ${JSON.stringify(d.body)}`).toEqual([200, metric]);
    }
    const outcomes = await get(hrefs.find(([m]) => m === "outcomes.area")![1]);
    expect(outcomes.body.items.map((i: Body) => i.recordId).sort()).toEqual([ok1, ok2].sort());
  });
});

describe("REQ-PB-063: area-specific RAG (trajectory, not activity completion); Unknown for missing data", () => {
  it("the outcome with all milestones achieved and deliverables accepted is red/amber when its KPI is below trajectory", async () => {
    // April's expected value on the 100 -> 200 trajectory is about 125; the accepted actual is 50.
    const res = await get(`${k.base}/dashboard`);
    const area = areaOf(res.body, "outcomes");
    const o1 = area.items.find((i: Body) => i.recordId === k.outcomeId);
    expect(["red", "amber"]).toContain(o1.rag);
    const k1 = area.items.find((i: Body) => i.recordId === ok1);
    expect([k1.rag, k1.value.state, k1.value.value]).toEqual([o1.rag, "value", "50"]);
    expect(["red", "amber"]).toContain(area.rag.status);
    expect(area.rag.ruleKey).toBe("dashboard.rag.outcomes.trajectory");
    // The completed delivery is visible in the Portfolio area (milestone component green), yet never feeds Outcomes.
    const ini = areaOf(res.body, "portfolio").items.find((i: Body) => i.recordId === initiative);
    expect(ini.flags).toContain("milestone_green");
    expect(ini.flags).toContain(`outcome_${o1.rag}`);
  });

  it("a KPI with no actual is unknown (value null, never 0), and so is its outcome", async () => {
    const res = await get(`${k.base}/dashboard`);
    const area = areaOf(res.body, "outcomes");
    const k2 = area.items.find((i: Body) => i.recordId === ok2);
    expect([k2.rag, k2.value.state, k2.value.value, k2.value.reasonKey]).toEqual([
      "unknown",
      "unknown",
      null,
      "kpi.no_accepted_actual",
    ]);
    expect(area.items.find((i: Body) => i.recordId === outcome2).rag).toBe("unknown");
    // No benefit: Value is not_applicable, never green or 0; no indicator: adoption unknown.
    expect(areaOf(res.body, "value").rag.status).toBe("not_applicable");
    expect(areaOf(res.body, "value").headlines[0].value).toMatchObject({ state: "not_applicable", value: null });
    expect(areaOf(res.body, "people_adoption").rag).toMatchObject({
      status: "unknown",
      ruleKey: "dashboard.rag.adoption.no_indicators",
    });
  });
});

describe("REQ-PB-064: Decisions red when an executive decision is overdue", () => {
  it("one open ask due yesterday (Asia/Riyadh) is red and listed; after its outcome is recorded it no longer counts", async () => {
    const ask = await askDue(api, k, yesterday);
    let res = await get(`${k.base}/dashboard`);
    let area = areaOf(res.body, "decisions");
    expect([area.rag.status, area.rag.ruleKey]).toEqual(["red", "dashboard.rag.decisions.overdue"]);
    expect(area.items[0]).toMatchObject({ recordId: ask.id, rag: "red", dueDate: yesterday, flags: ["overdue"] });
    expect(area.headlines.find((h: Body) => h.metric === "decisions.overdue").value).toMatchObject({ value: "1" });
    const overview = await get(`/api/v1/overview?organizationId=${w.orgA.id}&transformationId=${k.transformationId}`);
    expect(areaOf(overview.body, "decisions").rag.status).toBe("red");
    await decideAsk(api, k, ask);
    res = await get(`${k.base}/dashboard`);
    area = areaOf(res.body, "decisions");
    expect(area.items.map((i: Body) => i.recordId)).not.toContain(ask.id);
    expect(area.rag).toMatchObject({ status: "green", ruleKey: "dashboard.rag.decisions.none_open" });
    expect(area.headlines.find((h: Body) => h.metric === "decisions.overdue").value).toMatchObject({ state: "zero" });
  });
});

describe("REQ-S03-009: the Executive Overview after an accepted KPI actual", () => {
  it("shows the new actual once in the Outcomes area, and outcomes.kpi_status lists the source actual", async () => {
    const before = await get(`/api/v1/overview?organizationId=${w.orgA.id}`);
    expect(before.status, JSON.stringify(before.body)).toBe(200);
    const actualId = await acceptedActual(api, k, kpi2.id, april.id, "123.5", today);
    const res = await get(`/api/v1/overview?organizationId=${w.orgA.id}`);
    expect(res.body.transformationCount).toBe(1);
    const area = areaOf(res.body, "outcomes");
    const shown = area.items.filter((i: Body) => i.value?.value === "123.5");
    expect(shown).toHaveLength(1);
    expect(shown[0].recordId).toBe(ok2);
    const drill = await get(
      `/api/v1/dashboard-drilldown?metric=outcomes.kpi_status&organizationId=${w.orgA.id}&subjectId=${ok2}`,
    );
    expect(drill.status, JSON.stringify(drill.body)).toBe(200);
    expect(drill.body.value).toMatchObject({ state: "value", value: "123.5" });
    expect(drill.body.items.filter((i: Body) => i.recordType === "kpi_actual").map((i: Body) => i.recordId)).toEqual([
      actualId,
    ]);
    expect(drill.body.calculation.inputs[0]).toMatchObject({
      name: "actual",
      recordType: "kpi_actual",
      recordId: actualId,
    });
    // The per-transformation row carries the six area statuses.
    expect(res.body.transformations[0].areaStatuses.map((s: Body) => s.code)).toEqual([
      "outcomes",
      "value",
      "portfolio",
      "dependencies",
      "decisions",
      "people_adoption",
    ]);
  });
});

describe("the workstream dashboard (REQ-S13-001 workstream; ADR-0037 §2)", () => {
  it("covers its initiatives; Decisions and People & adoption are not_applicable; archived is 422; foreign 404", async () => {
    const ws = await workstreamOf(api.db, k, w.orgA.id, [initiative], { code: "WS-01" });
    const res = await get(`${k.base}/workstreams/${ws}/dashboard`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect([res.body.code, res.body.areas.length]).toEqual(["WS-01", 6]);
    expect(areaOf(res.body, "portfolio").items.map((i: Body) => i.recordId)).toEqual([initiative]);
    expect(areaOf(res.body, "outcomes").items.map((i: Body) => i.recordId)).toContain(k.outcomeId);
    expect(areaOf(res.body, "outcomes").items.map((i: Body) => i.recordId)).not.toContain(outcome2);
    for (const code of ["decisions", "people_adoption"])
      expect(areaOf(res.body, code).rag).toMatchObject({
        status: "not_applicable",
        ruleKey: "dashboard.rag.workstream_not_applicable",
      });
    const archived = await workstreamOf(api.db, k, w.orgA.id, [], { code: "WS-02", archived: true });
    const a = await get(`${k.base}/workstreams/${archived}/dashboard`);
    expect([a.status, a.body.code, a.body.detail]).toEqual([
      422,
      "dashboard.workstream_archived",
      "This workstream is archived; open its transformation's dashboard instead.",
    ]);
    const other = await dashboardWorld(api, w);
    const foreign = await get(`${other.base}/workstreams/${ws}/dashboard`);
    expect(foreign.status).toBe(404);
  });
});

describe("read models store nothing (ADR-0037 §1)", () => {
  it("a dashboard read writes no row and no audit event, and runs in a READ ONLY transaction", async () => {
    const count = async () =>
      (
        await api.db
          .selectFrom("audit_event")
          .select((eb) => eb.fn.countAll<string>().as("n"))
          .where("transformation_id", "=", k.transformationId)
          .executeTakeFirstOrThrow()
      ).n;
    const policies = async () =>
      (await api.db.selectFrom("dashboard_rag_policy").select("id").where("organization_id", "=", w.orgA.id).execute())
        .length;
    const [a0, p0] = [await count(), await policies()];
    expect((await get(`${k.base}/dashboard`)).status).toBe(200);
    expect((await get(`/api/v1/overview?organizationId=${w.orgA.id}`)).status).toBe(200);
    expect([await count(), await policies()]).toEqual([a0, p0]);
    const { readOnly } = await import("../../../src/modules/reporting/dashboards/engine.ts");
    await expect(
      readOnly(api.db, (tx) =>
        tx.updateTable("organization").set({ name_en: "x" }).where("id", "=", w.orgA.id).execute(),
      ),
    ).rejects.toThrow(/read-only transaction/);
  });
});
