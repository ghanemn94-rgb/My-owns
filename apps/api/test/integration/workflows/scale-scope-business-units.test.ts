// listScaleScopeBusinessUnits (T-DG4-BE-R4; ADR-0035 amendment R1) against a real PostgreSQL:
//  - a Sponsor holding only a transformation-scoped grant reads every ACTIVE business unit of the transformation's
//    organization (the set a G5 scope may name), identity and names only, ordered by code then id; never a unit of
//    another organization;
//  - a unit set to inactive after an approved G5 scope named it is still listed, with selectable false; an inactive unit
//    that no scope or transition names is not listed;
//  - cursor paging walks the same set; a cursor of another transformation is refused (400);
//  - outside scope (another organization's officer, ADM-only) 404; unauthenticated 401. The read writes nothing.
// The G5 decision here is a synthetic in-product business approval by a test Sponsor; it approves nothing real and
// touches no engineering delivery gate DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, seedWorld, signIn, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { g5Approval, pendingGate, seedGateWorld, stageGates, type GateWorld } from "../contract/p4-exercises-be-k.ts";

let api: TestApi;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call(api.app, m, u, o);
beforeAll(async () => {
  api = await startApi();
}, 60_000);
afterAll(() => api.close());

const BUS = (g: GateWorld) => `${g.b.base}/scale-scope/business-units`;
type Unit = { id: string; code: string; nameEn: string; nameAr: string; status: string; selectable: boolean };

/** The organization's units as the read must present them (code, then id), filtered by `keep`. */
async function expectedUnits(w: World, keep: (u: Unit) => boolean): Promise<Unit[]> {
  const rows = await api.db
    .selectFrom("business_unit")
    .select(["id", "code", "name_en", "name_ar", "status"])
    .where("organization_id", "=", w.orgA.id)
    .orderBy("code")
    .orderBy("id")
    .execute();
  return rows
    .map((r) => ({
      id: r.id,
      code: r.code,
      nameEn: r.name_en,
      nameAr: r.name_ar,
      status: r.status,
      selectable: r.status === "active",
    }))
    .filter(keep);
}

/** Sets a unit's status through the DG1 route (the organization administrator; If-Match). */
async function setStatus(w: World, unitId: string, status: "active" | "inactive") {
  const admin = await signIn(api.app, w.admin.subject);
  const cur = await send("GET", `/api/v1/business-units/${unitId}`, { session: admin });
  expect(cur.status, JSON.stringify(cur.body)).toBe(200);
  const r = await send("PATCH", `/api/v1/business-units/${unitId}`, {
    session: admin,
    headers: ifm(cur.body.version),
    body: { status },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
}

/** G1-G4 staged, then a G5 approval by the Sponsor whose scope names the world's initiative in `unitId`. */
async function approveG5Naming(g: GateWorld, unitId: string) {
  await stageGates(api, g, ["G1", "G2", "G3", "G4"], "transform");
  const no = await pendingGate(api, g, "G5");
  const body = g5Approval(g, no, {
    scaleScope: {
      items: [{ initiativeId: g.initiativeId, businessUnitId: unitId, note: "Synthetic pilot BU" }],
      conditions: [],
    },
  });
  const d = await send("POST", `${g.gates}/G5/decision`, { session: g.sp.session, body });
  expect(d.status, JSON.stringify(d.body)).toBe(201);
}

describe("listScaleScopeBusinessUnits (ADR-0035 amendment R1)", () => {
  it("a Sponsor with only a transformation grant reads every active unit of the organization, never another's", async () => {
    const w = await seedWorld(api.db);
    const g = await seedGateWorld(api, w);
    const grants = await api.db
      .selectFrom("scoped_assignment")
      .select(["scope_type"])
      .where("user_id", "=", g.sp.id)
      .execute();
    expect(grants.map((r) => r.scope_type)).toEqual(["transformation"]);
    const r = await send("GET", BUS(g), { session: g.sp.session });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toEqual({ items: await expectedUnits(w, (u) => u.status === "active"), nextCursor: null });
    const ids = (r.body.items as Unit[]).map((u) => u.id);
    expect(ids).toEqual(expect.arrayContaining([w.a1, w.a1x, w.a2]));
    expect(ids).not.toContain(w.b1);
    for (const u of r.body.items as Unit[]) expect(Object.keys(u)).toEqual(Object.keys(r.body.items[0]));
    expect(Object.keys(r.body.items[0])).toEqual(["id", "code", "nameEn", "nameAr", "status", "selectable"]);
  });

  it("a unit set inactive after an approved scope named it is listed with selectable false; an unnamed inactive unit is not", async () => {
    const w = await seedWorld(api.db);
    const g = await seedGateWorld(api, w);
    await approveG5Naming(g, w.a2);
    await setStatus(w, w.a2, "inactive");
    await setStatus(w, w.a1x, "inactive");
    const r = await send("GET", BUS(g), { session: g.sp.session });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const items = r.body.items as Unit[];
    expect(items.find((u) => u.id === w.a2)).toMatchObject({ status: "inactive", selectable: false });
    expect(items.map((u) => u.id)).not.toContain(w.a1x);
    expect(items).toEqual(await expectedUnits(w, (u) => u.status === "active" || u.id === w.a2));
    // Another transformation of the same organization names nothing: it sees only the active units.
    const g2 = await seedGateWorld(api, w);
    const other = await send("GET", BUS(g2), { session: g2.sp.session });
    expect(other.body.items).toEqual(await expectedUnits(w, (u) => u.status === "active"));
  });

  it("cursor paging by code then id walks the same set; another transformation's cursor is 400", async () => {
    const w = await seedWorld(api.db);
    const g = await seedGateWorld(api, w);
    const all = (await send("GET", BUS(g), { session: g.b.s.auditor })).body.items as Unit[];
    expect(all.length).toBeGreaterThanOrEqual(3);
    const walked: Unit[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const q: string = cursor === null ? "?limit=1" : `?limit=1&cursor=${encodeURIComponent(cursor)}`;
      const p = await send("GET", `${BUS(g)}${q}`, { session: g.b.s.auditor });
      expect([p.status, p.body.items.length]).toEqual([200, 1]);
      walked.push(...(p.body.items as Unit[]));
      cursor = p.body.nextCursor as string | null;
      pages += 1;
    } while (cursor !== null && pages < 50);
    expect(walked).toEqual(all);
    const first = await send("GET", `${BUS(g)}?limit=1`, { session: g.b.s.auditor });
    const g2 = await seedGateWorld(api, w);
    const foreign = await send("GET", `${BUS(g2)}?limit=1&cursor=${encodeURIComponent(first.body.nextCursor)}`, {
      session: g2.b.s.auditor,
    });
    expect(foreign.status).toBe(400);
  });

  it("outside scope 404 (another organization's officer, ADM-only); unauthenticated 401", async () => {
    const w = await seedWorld(api.db);
    const g = await seedGateWorld(api, w);
    const officeB = await signIn(api.app, w.officeB.subject);
    expect((await send("GET", BUS(g), { session: officeB })).status).toBe(404);
    expect((await send("GET", BUS(g), { session: g.b.s.admin })).status).toBe(404);
    expect((await send("GET", BUS(g))).status).toBe(401);
  });
});
