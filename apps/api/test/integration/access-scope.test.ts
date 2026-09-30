// Scoped authorization through the single policy function (ADR-0006; REQ-S10-001/002/004, first cases of A12).
// Positive and negative cases for reads, lists (SQL scope filter) and writes across organizations, sibling BUs,
// inheritance, technical administrators, and revocation taking effect on the very next request.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditOf,
  call,
  createTransformationRow,
  grant,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../support/harness.ts";

let api: TestApi;
let w: World;
let trA1: string; // in BU a1
let trA1x: string; // in child BU a1x
let trA2: string; // in sibling BU a2
let trB1: string; // in org B
const s: Record<string, Session> = {};

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  trA1 = await createTransformationRow(api.db, w.orgA.id, w.a1, w.grantor.id);
  trA1x = await createTransformationRow(api.db, w.orgA.id, w.a1x, w.grantor.id);
  trA2 = await createTransformationRow(api.db, w.orgA.id, w.a2, w.grantor.id);
  trB1 = await createTransformationRow(api.db, w.orgB.id, w.b1, w.grantor.id);
  for (const name of ["admin", "office", "leadA1", "auditor", "nobody", "officeB"] as const)
    s[name] = await signIn(api.app, w[name].subject);
});
afterAll(() => api.close());

const get = (who: string, id: string) => call(api.app, "GET", `/api/v1/transformations/${id}`, { session: s[who]! });
const list = async (who: string) =>
  (
    await call<{ items: { id: string }[] }>(api.app, "GET", "/api/v1/transformations?limit=100", { session: s[who]! })
  ).body.items.map((t) => t.id);

describe("cross-scope READ is denied by the policy function (404, existence not disclosed)", () => {
  it("TO of organization A reads every transformation in A (inherits downward), none in B", async () => {
    for (const id of [trA1, trA1x, trA2]) expect((await get("office", id)).status).toBe(200);
    const b = await get("office", trB1);
    expect(b.status).toBe(404);
    expect(b.body).toMatchObject({ type: "urn:mth:problem:not-found", code: "not_found" });
  });

  it("TO of organization B cannot read organization A's records", async () => {
    for (const id of [trA1, trA2]) expect((await get("officeB", id)).status).toBe(404);
    expect((await get("officeB", trB1)).status).toBe(200);
  });

  it("TL granted at BU a1 (non-inheriting) sees no transformation below a1, and none in the sibling a2", async () => {
    // A non-inheriting BU-level grant covers BU-level actions only (ADR-0006): job title/role never implies breadth.
    for (const id of [trA1, trA1x, trA2, trB1]) expect((await get("leadA1", id)).status).toBe(404);
  });

  it("a transformation-scope grant covers exactly that transformation", async () => {
    await grant(api.db, w.grantor.id, w.leadA1.id, "TL", { type: "transformation", id: trA1 }, w.orgA.id);
    expect((await get("leadA1", trA1)).status).toBe(200);
    for (const id of [trA1x, trA2]) expect((await get("leadA1", id)).status).toBe(404);
  });

  it("technical administrators cannot read business records at all", async () => {
    expect((await get("admin", trA1)).status).toBe(404);
    expect(await list("admin")).toEqual([]);
  });

  it("a user without grants sees nothing, and an unknown id is indistinguishable from a forbidden one", async () => {
    expect(await list("nobody")).toEqual([]);
    const forbidden = await get("nobody", trA1);
    const missing = await get("nobody", "01920000-0000-7000-8000-00000000dead");
    expect([forbidden.status, missing.status]).toEqual([404, 404]);
    expect(forbidden.body.code).toBe(missing.body.code);
  });
});

describe("list filtering happens in SQL through the same rules", () => {
  it("returns exactly the readable set per principal", async () => {
    const office = await list("office");
    expect(office).toEqual(expect.arrayContaining([trA1, trA1x, trA2]));
    expect(office).not.toContain(trB1);
    const officeB = await list("officeB");
    expect(officeB).toContain(trB1);
    expect(officeB).not.toEqual(expect.arrayContaining([trA1]));
    const lead = await list("leadA1");
    expect(lead).toContain(trA1);
    expect(lead).not.toContain(trA2);
  });
});

describe("cross-scope WRITE is denied (404 when unreadable, 403 when readable but not permitted)", () => {
  it("TO of B cannot update or archive A's transformation, and nothing is written", async () => {
    const before = await api.db
      .selectFrom("transformation")
      .select("version")
      .where("id", "=", trA2)
      .executeTakeFirstOrThrow();
    const upd = await call(api.app, "PATCH", `/api/v1/transformations/${trA2}`, {
      session: s["officeB"]!,
      headers: { "if-match": '"1"' },
      body: { name: "hijack" },
    });
    expect(upd.status).toBe(404);
    const arc = await call(api.app, "POST", `/api/v1/transformations/${trA2}/archive`, {
      session: s["officeB"]!,
      headers: { "if-match": '"1"' },
      body: { reason: "hijack attempt" },
    });
    expect(arc.status).toBe(404);
    const after = await api.db
      .selectFrom("transformation")
      .select(["version", "name"])
      .where("id", "=", trA2)
      .executeTakeFirstOrThrow();
    expect(after.version).toBe(before.version);
    expect(after.name).not.toBe("hijack");
  });

  it("an auditor can read but not update (403) and the denial itself is audited", async () => {
    expect((await get("auditor", trA2)).status).toBe(200);
    const res = await call(api.app, "PATCH", `/api/v1/transformations/${trA2}`, {
      session: s["auditor"]!,
      headers: { "if-match": '"1"' },
      body: { name: "auditor edit" },
    });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ type: "urn:mth:problem:forbidden", code: "forbidden" });
    const allDenied = (await auditOf(api.db, trA2)).filter((e) => e.action === "authorization.denied");
    // The cross-organization update/archive attempts of the previous test were audited as well (ADR-0004).
    expect(allDenied.filter((e) => e.actor_user_id === w.officeB.id).map((e) => e.reason)).toEqual([
      expect.stringMatching(/PATCH .* requires transformation\.read/),
      expect.stringMatching(/POST .*archive requires transformation\.read/),
    ]);
    const denied = allDenied.filter((e) => e.actor_user_id === w.auditor.id);
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({
      actor_user_id: w.auditor.id,
      record_type: "transformation",
      transformation_id: trA2,
      source: "api",
    });
    expect(denied[0]!.reason).toMatch(/requires transformation\.update/);
  });

  it("TL at BU a1 may create in a1 but not in the sibling a2 (BU unreadable -> 404) nor in org B", async () => {
    const ok = await call(api.app, "POST", "/api/v1/transformations", {
      session: s["leadA1"]!,
      body: { businessUnitId: w.a1, name: "In scope", mode: "end_to_end" },
    });
    expect(ok.status).toBe(201);
    for (const bu of [w.a2, w.b1]) {
      const denied = await call(api.app, "POST", "/api/v1/transformations", {
        session: s["leadA1"]!,
        body: { businessUnitId: bu, name: "Out of scope", mode: "end_to_end" },
      });
      expect(denied.status).toBe(404);
    }
  });

  it("an auditor can read the BU but may not create in it (403)", async () => {
    const res = await call(api.app, "POST", "/api/v1/transformations", {
      session: s["auditor"]!,
      body: { businessUnitId: w.a1, name: "Nope", mode: "end_to_end" },
    });
    expect(res.status).toBe(403);
  });
});

describe("revocation applies to the next request (grants are loaded per request)", () => {
  it("revoking the TO grant removes access immediately", async () => {
    const user = await signIn(api.app, w.officeB.subject);
    expect((await call(api.app, "GET", `/api/v1/transformations/${trB1}`, { session: user })).status).toBe(200);
    await api.db
      .updateTable("scoped_assignment")
      .set({ revoked_at: new Date(), revoked_by: w.grantor.id, revoke_reason: "test revoke" })
      .where("user_id", "=", w.officeB.id)
      .execute();
    expect((await call(api.app, "GET", `/api/v1/transformations/${trB1}`, { session: user })).status).toBe(404);
  });

  it("future-dated and expired grants do not apply", async () => {
    const trX = await createTransformationRow(api.db, w.orgA.id, w.a2, w.grantor.id);
    const id = await grant(api.db, w.grantor.id, w.nobody.id, "WL", { type: "transformation", id: trX }, w.orgA.id);
    await api.db
      .updateTable("scoped_assignment")
      .set({ effective_from: new Date(Date.now() + 86_400_000) })
      .where("id", "=", id)
      .execute();
    expect((await get("nobody", trX)).status).toBe(404);
    await api.db
      .updateTable("scoped_assignment")
      .set({ effective_from: new Date(Date.now() - 2 * 86_400_000), effective_to: new Date(Date.now() - 86_400_000) })
      .where("id", "=", id)
      .execute();
    expect((await get("nobody", trX)).status).toBe(404);
    await api.db.updateTable("scoped_assignment").set({ effective_to: null }).where("id", "=", id).execute();
    expect((await get("nobody", trX)).status).toBe(200);
  });
});
