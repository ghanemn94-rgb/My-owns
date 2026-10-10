// A01 / REQ-PB-010 "One source of truth" (qa-verifier, T-DG4-QA-D). Acceptance text (docs/delivery/requirements.csv):
// "A01: renaming an initiative changes it in roadmap, scorecard and benefits register views in one update; no duplicate
// initiative rows exist in the database". D-106 (d): the 'scorecard' is the T10 Portfolio area of the transformation
// dashboard (GET /api/v1/transformations/{id}/dashboard, area `portfolio`).
//
// Closes the coverage gap T-DG4-AN-P4A recorded: no test re-read the scorecard after a rename. This suite renames an
// initiative ONCE through the real API (PATCH /api/v1/initiatives/{id}, If-Match) and then re-reads, through the API,
// the T10 Portfolio area and the traceability view (full graph and rooted at the initiative), plus the roadmap and the
// benefits register; every view must show the new name, none may still show the old one, and the database must hold
// exactly one initiative row for the id and the code, whose `name` is what every view shows.
//
// Black-box through the REAL API (Fastify inject; every request and response validated against docs/api/openapi.yaml by
// the harness) on the run's disposable PostgreSQL. Disclosed fixtures: the BE-M chain world (seedTraceWorld) and one
// initiative inserted already `launched` (with its audit event) by the BE-J fixture, because the T10 Portfolio area
// lists only selected/funded/launched/completed initiatives and the selection/launch approvals are a different
// business process from the clause under test. The rename and every read are native API calls.
// All data is SYNTHETIC; nothing here approves anything real or touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launchedInitiative } from "../../../apps/api/test/integration/contract/p4-exercises-be-j.ts";
import { seedTraceWorld, type TraceWorld } from "../../../apps/api/test/integration/contract/p4-exercises-be-m.ts";
import { call, startApi, type TestApi } from "../support/api.ts";
import { seedWorld, type Body, type World } from "../support/p4.ts";

const ifm = (version: number): Record<string, string> => ({ "if-match": `"${version}"` });

let api: TestApi;
let w: World;
let t: TraceWorld;
let initiativeId: string;
let code: string;
let oldName: string;
const NEW_NAME = "Synthetic QA-D renamed scorecard initiative";

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  t = await seedTraceWorld(api, w);
  initiativeId = await launchedInitiative(api.db, t);
  const row = await api.db
    .selectFrom("initiative")
    .select(["code", "name", "status"])
    .where("id", "=", initiativeId)
    .executeTakeFirstOrThrow();
  code = row.code;
  oldName = row.name;
  expect(row.status).toBe("launched");
}, 120_000);
afterAll(() => api?.close());

const send = (method: string, url: string, opts?: Parameters<typeof call>[3]) => call<Body>(api.app, method, url, opts);

/** The T10 Portfolio area ('scorecard', D-106 (d)) items of the transformation dashboard. */
async function scorecardItems(): Promise<Body[]> {
  const d = await send("GET", `${t.base}/dashboard`, { session: t.s.auditor });
  expect(d.status, JSON.stringify(d.body)).toBe(200);
  const areas = d.body.areas as Body[];
  const portfolio = areas.filter((a) => a.code === "portfolio");
  expect(portfolio).toHaveLength(1);
  return portfolio[0].items as Body[];
}

async function traceNodes(query = ""): Promise<Body[]> {
  const g = await send("GET", `${t.base}/traceability${query}`, { session: t.s.auditor });
  expect(g.status, JSON.stringify(g.body)).toBe(200);
  return g.body.nodes as Body[];
}

describe("REQ-PB-010 (A01): one rename shows in the T10 scorecard and the traceability view from the one row", () => {
  it("before the rename, the scorecard and the traceability view show the original name (the baseline)", async () => {
    const items = (await scorecardItems()).filter((i) => i.recordId === initiativeId);
    expect(items.map((i) => [i.recordType, i.code, i.label])).toEqual([["initiative", code, oldName]]);
    const nodes = (await traceNodes()).filter((n) => n.recordId === initiativeId);
    expect(nodes.map((n) => [n.recordType, n.code, n.label])).toEqual([["initiative", code, oldName]]);
  });

  it("after ONE PATCH, the scorecard, the traceability view, the roadmap and the benefits register all show the new name; no stale copy; one DB row", async () => {
    // The benefit is allocated to the initiative so the register row names it (ADR-0038 §8 initiatives[]).
    const benefit = await send("GET", `${t.base}/benefits/${t.benefitId}`, { session: t.s.bo });
    const alloc = await send("PUT", `${t.base}/benefits/${t.benefitId}/allocations`, {
      session: t.s.bo,
      headers: ifm(benefit.body.version),
      body: { allocations: [{ initiativeId, share: "1" }] },
    });
    expect(alloc.status, JSON.stringify(alloc.body)).toBe(200);

    const auditBefore = await api.db
      .selectFrom("audit_event")
      .select("id")
      .where("record_id", "=", initiativeId)
      .where("action", "=", "initiative.update")
      .execute();
    const ini = await send("GET", `/api/v1/initiatives/${initiativeId}`, { session: t.s.tl });
    expect(ini.status, JSON.stringify(ini.body)).toBe(200);
    const renamed = await send("PATCH", `/api/v1/initiatives/${initiativeId}`, {
      session: t.s.tl,
      headers: ifm(ini.body.version),
      body: { name: NEW_NAME },
    });
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
    expect(renamed.body.name).toBe(NEW_NAME);
    expect(renamed.body.version).toBe(ini.body.version + 1);

    // The one canonical row (and its one audit event for this single update).
    const rows = await api.db
      .selectFrom("initiative")
      .select(["id", "code", "name"])
      .where("transformation_id", "=", t.transformationId)
      .where((eb) => eb.or([eb("id", "=", initiativeId), eb("code", "=", code)]))
      .execute();
    expect(rows).toEqual([{ id: initiativeId, code, name: NEW_NAME }]);
    // Scoped to this transformation: other suites in the same test database use the same fixture names elsewhere.
    const staleRows = await api.db
      .selectFrom("initiative")
      .select("id")
      .where("transformation_id", "=", t.transformationId)
      .where("name", "=", oldName)
      .execute();
    expect(staleRows).toEqual([]);
    const auditAfter = await api.db
      .selectFrom("audit_event")
      .select("id")
      .where("record_id", "=", initiativeId)
      .where("action", "=", "initiative.update")
      .execute();
    expect(auditAfter.length).toBe(auditBefore.length + 1);

    // Scorecard = T10 Portfolio area: exactly one item for the initiative, carrying the DB row's name.
    const items = await scorecardItems();
    const mine = items.filter((i) => i.recordId === initiativeId);
    expect(mine.map((i) => [i.recordType, i.code, i.label, i.href])).toEqual([
      ["initiative", code, rows[0]!.name, `/api/v1/initiatives/${initiativeId}`],
    ]);
    expect(items.filter((i) => i.label === oldName)).toEqual([]);

    // Traceability view: the full graph and the graph rooted at the initiative.
    for (const query of ["", `?rootType=initiative&rootId=${initiativeId}`]) {
      const nodes = await traceNodes(query);
      const n = nodes.filter((x) => x.recordId === initiativeId);
      expect(
        n.map((x) => [x.recordType, x.code, x.label]),
        `traceability${query}`,
      ).toEqual([["initiative", code, NEW_NAME]]);
      expect(
        nodes.filter((x) => x.label === oldName),
        `traceability${query}`,
      ).toEqual([]);
    }

    // Roadmap and benefits register (the rest of A01) read the same row.
    const roadmap = await send("GET", `${t.base}/roadmap`, { session: t.s.auditor });
    expect(roadmap.status, JSON.stringify(roadmap.body)).toBe(200);
    const onRoadmap = (roadmap.body.initiatives as Body[]).filter((i) => i.id === initiativeId);
    expect(onRoadmap.map((i) => i.name)).toEqual([NEW_NAME]);
    const register = await send("GET", `${t.base}/benefits`, { session: t.s.auditor });
    expect(register.status, JSON.stringify(register.body)).toBe(200);
    const row = (register.body.items as Body[]).find((r) => r.id === t.benefitId);
    expect(row?.initiatives).toEqual([{ id: initiativeId, code, name: NEW_NAME }]);
  });
});
