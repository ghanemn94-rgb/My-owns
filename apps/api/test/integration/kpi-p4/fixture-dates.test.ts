// The KBE-B finding fixture's reporting-period dates (T-DG4-KBE-R1 item 2; the BE-C §4.5 and BE-M handbacks; D-098,
// D-105). `insertFinding` used to draw its ad-hoc period day with Math.random(), so two calls could pick the same day
// and fail with "reporting_period: ad_hoc … overlaps another ad_hoc period". It now takes the day after the
// organization's latest ad-hoc period, read under reporting_period_guard's own advisory lock. Proven here against the
// run's disposable PostgreSQL:
//  - deterministic: a fresh organization gets 2031-01-02, 2031-01-03, 2031-01-04 in call order;
//  - unique per call, including 12 concurrent calls (each in its own transaction);
//  - a pre-existing ad-hoc period of the organization is stepped over, never overlapped.
// The 20-run loop over the affected files is logged in the T-DG4-KBE-R1 handback evidence. All data is SYNTHETIC.
import { insertAuditEvent, type Db } from "@mth/db";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { seedKpiWorld, type KpiWorld } from "../kpi/fixtures.ts";
import { createKpi, FINDING_PERIOD_FIRST_DAY, insertFinding } from "./kbe-b-fixtures.ts";

let api: TestApi;

beforeAll(async () => {
  api = await startApi();
}, 60_000);
afterAll(() => api.close());

async function freshWorld(): Promise<{ w: World; k: KpiWorld; kpiId: string }> {
  const w = await seedWorld(api.db);
  const k = await seedKpiWorld(api, w);
  const kpi = await createKpi(api, k);
  return { w, k, kpiId: kpi.id };
}

async function periodDayOf(db: Db, findingId: string): Promise<string> {
  const row = await db
    .selectFrom("data_quality_finding as f")
    .innerJoin("reporting_period as p", "p.id", "f.reporting_period_id")
    .select((eb) => [
      eb.cast<string>("p.period_start", "text").as("start"),
      eb.cast<string>("p.period_end", "text").as("end"),
    ])
    .where("f.id", "=", findingId)
    .executeTakeFirstOrThrow();
  expect(row.start).toBe(row.end); // one-day periods
  return row.start;
}

describe("insertFinding ad-hoc period dates (T-DG4-KBE-R1 item 2)", () => {
  it("is deterministic: a fresh organization's periods are 2031-01-02, -03, -04 in call order", async () => {
    const { w, k, kpiId } = await freshWorld();
    const days: string[] = [];
    for (let i = 0; i < 3; i += 1)
      days.push(await periodDayOf(api.db, await insertFinding(api.db, k, w.orgA.id, kpiId)));
    expect(FINDING_PERIOD_FIRST_DAY).toBe("2031-01-02");
    expect(days).toEqual(["2031-01-02", "2031-01-03", "2031-01-04"]);
  });

  it("is unique per call, also for 12 concurrent calls in one organization", async () => {
    const { w, k, kpiId } = await freshWorld();
    const ids = await Promise.all(Array.from({ length: 12 }, () => insertFinding(api.db, k, w.orgA.id, kpiId)));
    const days = await Promise.all(ids.map((id) => periodDayOf(api.db, id)));
    expect(new Set(days).size).toBe(12);
    expect([...days].sort()).toEqual(Array.from({ length: 12 }, (_, i) => `2031-01-${String(2 + i).padStart(2, "0")}`));
  });

  it("steps over an ad-hoc period the organization already has", async () => {
    const { w, k, kpiId } = await freshWorld();
    const existing = uuidv7();
    await api.db.transaction().execute(async (tx) => {
      await tx
        .insertInto("reporting_period")
        .values({
          id: existing,
          organization_id: w.orgA.id,
          frequency: "ad_hoc",
          period_label: `KBER1-${existing.slice(-12)}`,
          period_start: "2031-01-02",
          period_end: "2031-01-10",
          created_by: k.users.tl.id,
          updated_by: k.users.tl.id,
        })
        .execute();
      await insertAuditEvent(
        tx,
        { actorType: "user", actorUserId: k.users.tl.id, requestId: `fixture-${existing}`, source: "api" },
        {
          action: "reporting_period.create",
          recordType: "reporting_period",
          recordId: existing,
          organizationId: w.orgA.id,
          newVersion: 1,
        },
      );
    });
    expect(await periodDayOf(api.db, await insertFinding(api.db, k, w.orgA.id, kpiId))).toBe("2031-01-11");
  });
});
