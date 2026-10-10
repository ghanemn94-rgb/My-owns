// listTransformationReportingPeriods against a real PostgreSQL (T-DG4-KBE-R2; ADR-0027 amendment A1 of 2026-10-09;
// REQ-S07-017 "open KPI, select period, enter or import actual and evidence, submit"; ARCH-R1 item 9):
//  - a TL (Lead) and the KDS user who owns a KPI, each granted only on the transformation, hold transformation.read but
//    not organization.read: the organization list answers them 404, the transformation list 200;
//  - the page is exactly listReportingPeriods' for the transformation's organization: same items, order (latest first),
//    filters (frequency, status) and cursor;
//  - AUD reads (200) and the read changes nothing (no audit event, no version step); an outsider (TO of org B), a user
//    without a grant and an ADM-only user get 404; nothing of another organization is returned.
// All data is synthetic; nothing here grants a business approval or touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditOf,
  call,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { seedKpiWorld, type KpiWorld } from "../kpi/fixtures.ts";
import { DIRECT_FLOW, monthlyPeriod, ownedKpi, type Body } from "./kbe-c-fixtures.ts";

let api: TestApi;
let w: World;
let k: KpiWorld;
let to: Session;
let toB: Session;
let adm: Session;
let ORG: string;
let ORG_B: string;
let TRP: string;
const created: string[] = [];

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  k = await seedKpiWorld(api, w);
  to = await signIn(api.app, w.office.subject);
  toB = await signIn(api.app, w.officeB.subject);
  adm = await signIn(api.app, w.admin.subject);
  ORG = `/api/v1/organizations/${w.orgA.id}/reporting-periods`;
  ORG_B = `/api/v1/organizations/${w.orgB.id}/reporting-periods`;
  TRP = `${k.base}/reporting-periods`;
  // Synthetic periods of organization A: two monthly (one open, one scheduled) and two quarterly.
  created.push((await monthlyPeriod(api, w)).id, (await monthlyPeriod(api, w, { scheduled: true })).id);
  for (const [label, start, end] of [
    ["2071-Q1", "2071-01-01", "2071-03-31"],
    ["2071-Q2", "2071-04-01", "2071-06-30"],
  ] as const) {
    const res = await call<Body>(api.app, "POST", ORG, {
      session: to,
      body: { frequency: "quarterly", periodLabel: label, periodStart: start, periodEnd: end },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    created.push(res.body.id);
  }
  // A period of organization B that must never appear in organization A's transformation list.
  const b = await call<Body>(api.app, "POST", ORG_B, {
    session: toB,
    body: { frequency: "quarterly", periodLabel: "2071-Q1", periodStart: "2071-01-01", periodEnd: "2071-03-31" },
  });
  expect(b.status, JSON.stringify(b.body)).toBe(201);
}, 120_000);
afterAll(() => api.close());

const get = (path: string, session: Session) => call<Body>(api.app, "GET", path, { session });

/** Every item of a list, following nextCursor with the given page size. */
async function all(path: string, session: Session, limit: number): Promise<Body[]> {
  const sep = path.includes("?") ? "&" : "?";
  const items: Body[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 500; i++) {
    const res = await get(
      `${path}${sep}limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      session,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    items.push(...res.body.items);
    cursor = res.body.nextCursor;
    if (cursor === null) return items;
  }
  throw new Error("pagination did not end");
}

describe("listTransformationReportingPeriods (ADR-0027 amendment A1; REQ-S07-017)", () => {
  it("a Lead and a KPI owner granted only on the transformation list the periods; the organization list is 404 to them", async () => {
    const kpi = await ownedKpi(api, k, DIRECT_FLOW);
    const owner = await api.db
      .selectFrom("kpi_definition")
      .select("owner_user_id")
      .where("id", "=", kpi.id)
      .executeTakeFirstOrThrow();
    expect(owner.owner_user_id).toBe(k.users.kds.id);
    for (const s of [k.s.tl, k.s.kds]) {
      expect((await get(ORG, s)).status).toBe(404);
      const res = await get(TRP, s);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const ids = res.body.items.map((p: Body) => p.id);
      for (const id of created) expect(ids).toContain(id);
      expect(res.body.items.every((p: Body) => p.organizationId === w.orgA.id)).toBe(true);
    }
  });

  it("returns exactly the organization list: the same items, order, filters and cursor pages", async () => {
    for (const filter of ["", "?frequency=quarterly", "?frequency=monthly&status=scheduled", "?status=open"]) {
      const expected = await all(`${ORG}${filter}`, to, 100);
      expect(expected.length).toBeGreaterThan(0);
      expect(await all(`${TRP}${filter}`, k.s.tl, 100)).toEqual(expected);
      // Page by page (limit 1), so the cursor format and the order are the same as well.
      expect(await all(`${TRP}${filter}`, k.s.kds, 1)).toEqual(expected);
    }
    const orgFirst = await get(`${ORG}?frequency=quarterly&limit=1`, to);
    const tFirst = await get(`${TRP}?frequency=quarterly&limit=1`, k.s.tl);
    expect(tFirst.body).toEqual(orgFirst.body);
    // Latest first.
    const starts = (await all(TRP, k.s.tl, 100)).map((p) => p.periodStart as string);
    expect([...starts].sort().reverse()).toEqual(starts);
    // A cursor is bound to its filter, as on the organization list.
    const bad = await get(`${TRP}?frequency=monthly&cursor=${encodeURIComponent(tFirst.body.nextCursor)}`, k.s.tl);
    expect(bad.status).toBe(400);
  });

  it("AUD reads (200) and the read writes nothing; outsiders, users without a grant and ADM-only users get 404", async () => {
    // Scope-local "nothing written" (F-DG1-110): the audit trail and version of each period this file created.
    const snapshot = async () =>
      Promise.all(
        created.map(async (id) => ({
          audit: (await auditOf(api.db, id)).length,
          version: (
            await api.db.selectFrom("reporting_period").select("version").where("id", "=", id).executeTakeFirstOrThrow()
          ).version,
        })),
      );
    const before = await snapshot();
    const aud = await get(TRP, k.s.auditor);
    expect(aud.status, JSON.stringify(aud.body)).toBe(200);
    expect(aud.body.items.map((p: Body) => p.id)).toEqual(expect.arrayContaining(created));
    for (const s of [k.s.outsider, k.s.nobody, adm]) {
      const res = await get(TRP, s);
      expect([res.status, res.body.code], JSON.stringify(res.body)).toEqual([404, "not_found"]);
    }
    const missing = await get(`/api/v1/transformations/00000000-0000-7000-8000-000000000000/reporting-periods`, k.s.tl);
    expect(missing.status).toBe(404);
    expect(await snapshot()).toEqual(before);
  });

  it("never returns a period of another organization", async () => {
    const orgB = await all(ORG_B, toB, 100);
    expect(orgB.length).toBeGreaterThan(0);
    const ids = new Set((await all(TRP, k.s.tl, 100)).map((p) => p.id as string));
    for (const p of orgB) expect(ids.has(p.id as string)).toBe(false);
  });

  it("refuses a malformed query or path with 400 validation", async () => {
    expect((await get(`${TRP}?frequency=hourly`, k.s.tl)).status).toBe(400);
    expect((await get(`${TRP}?status=done`, k.s.tl)).status).toBe(400);
    expect((await get(`${TRP}?limit=0`, k.s.tl)).status).toBe(400);
    expect((await get(`${TRP}?other=1`, k.s.tl)).status).toBe(400);
    expect((await get(`/api/v1/transformations/not-a-uuid/reporting-periods`, k.s.tl)).status).toBe(400);
  });
});
