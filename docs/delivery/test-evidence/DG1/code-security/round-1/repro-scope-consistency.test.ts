// code-security-reviewer DG1 round 1 — independent cross-scope probe (ADR-0006). NOT part of the candidate.
// Run by copying into a DISPOSABLE clone at apps/api/test/integration/ and executing
//   TEST_DATABASE_ADMIN_URL=... npx vitest run --project integration apps/api/test/integration/repro-scope-consistency.test.ts
// For a grant matrix over org A {BU a1 > a1x, BU a2} and org B {BU b1}, every user's LIST result (SQL scopeFilter)
// must equal the set of records the same user can READ one by one (decide), siblings must never cross, and
// cross-scope writes/audit reads must be refused (404 for unreadable, 403 for read-but-not-permitted).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  call,
  createBu,
  createOrg,
  createTransformationRow,
  createUser,
  grant,
  signIn,
  startApi,
  type TestApi,
} from "../support/harness.ts";

let api: TestApi;
type Scope = { type: "organization" | "business_unit" | "transformation"; id: string };
const W: Record<string, string> = {};
const tx: Record<string, string> = {};

beforeAll(async () => {
  api = await startApi();
  const db = api.db;
  const A = await createOrg(db);
  const B = await createOrg(db);
  W.A = A.id;
  W.B = B.id;
  W.a1 = await createBu(db, A.id);
  W.a1x = await createBu(db, A.id, W.a1);
  W.a2 = await createBu(db, A.id);
  W.b1 = await createBu(db, B.id);
  const grantor = await createUser(db, A.id);
  W.grantor = grantor.id;
  for (const [k, org, bu] of [
    ["tA1", A.id, W.a1],
    ["tA1x", A.id, W.a1x],
    ["tA2", A.id, W.a2],
    ["tB1", B.id, W.b1],
  ] as const)
    tx[k] = await createTransformationRow(db, org, bu, grantor.id);
});
afterAll(() => api.close());

const CASES: { name: string; role: string; scope: () => Scope; org: () => string; expect: string[] }[] = [
  { name: "TO@org A", role: "TO", scope: () => ({ type: "organization", id: W.A! }), org: () => W.A!, expect: ["tA1", "tA1x", "tA2"] },
  { name: "TO@BU a1 (inherits)", role: "TO", scope: () => ({ type: "business_unit", id: W.a1! }), org: () => W.A!, expect: ["tA1", "tA1x"] },
  { name: "TO@BU a1x (child)", role: "TO", scope: () => ({ type: "business_unit", id: W.a1x! }), org: () => W.A!, expect: ["tA1x"] },
  { name: "AUD@BU a2", role: "AUD", scope: () => ({ type: "business_unit", id: W.a2! }), org: () => W.A!, expect: ["tA2"] },
  { name: "TL@org A (no inherit)", role: "TL", scope: () => ({ type: "organization", id: W.A! }), org: () => W.A!, expect: [] },
  { name: "TL@BU a1 (no inherit)", role: "TL", scope: () => ({ type: "business_unit", id: W.a1! }), org: () => W.A!, expect: [] },
  { name: "SP@transformation tA2", role: "SP", scope: () => ({ type: "transformation", id: tx.tA2! }), org: () => W.A!, expect: ["tA2"] },
  { name: "ADM_TECH@org A (no business access)", role: "ADM_TECH", scope: () => ({ type: "organization", id: W.A! }), org: () => W.A!, expect: [] },
  { name: "ADM_ACCESS@org A (no business access)", role: "ADM_ACCESS", scope: () => ({ type: "organization", id: W.A! }), org: () => W.A!, expect: [] },
  { name: "TO@org B", role: "TO", scope: () => ({ type: "organization", id: W.B! }), org: () => W.B!, expect: ["tB1"] },
];

describe("list (SQL scopeFilter) == per-record read (decide); siblings never cross", () => {
  for (const c of CASES) {
    it(c.name, async () => {
      const u = await createUser(api.db, c.org());
      await grant(api.db, W.grantor!, u.id, c.role, c.scope(), c.org());
      const s = await signIn(api.app, u.subject);
      const list = await call<{ items: { id: string }[] }>(api.app, "GET", "/api/v1/transformations?limit=100", { session: s });
      expect(list.status).toBe(200);
      const listed = new Set(list.body.items.map((i) => i.id));
      const readable = new Set<string>();
      for (const [k, id] of Object.entries(tx)) {
        const r = await call(api.app, "GET", `/api/v1/transformations/${id}`, { session: s });
        expect([200, 404], `${c.name} GET ${k}`).toContain(r.status);
        if (r.status === 200) readable.add(id);
      }
      const want = new Set(c.expect.map((k) => tx[k]!));
      expect([...listed].sort(), `${c.name}: list vs expected`).toEqual([...want].sort());
      expect([...readable].sort(), `${c.name}: read vs expected`).toEqual([...want].sort());
      // Cross-scope write on every unreadable record must be 404 and change nothing.
      for (const [k, id] of Object.entries(tx)) {
        if (want.has(id)) continue;
        const w = await call(api.app, "PATCH", `/api/v1/transformations/${id}`, { session: s, body: { name: "x-scope" }, headers: { "if-match": '"1"' } });
        expect(w.status, `${c.name} PATCH ${k}`).toBe(404);
        const au = await call(api.app, "GET", `/api/v1/transformations/${id}/audit`, { session: s });
        expect(au.status, `${c.name} audit ${k}`).toBe(404);
      }
    });
  }

  it("TL@BU a1 may create in a1 — and can the creator read back what it created?", async () => {
    const u = await createUser(api.db, W.A!);
    await grant(api.db, W.grantor!, u.id, "TL", { type: "business_unit", id: W.a1! }, W.A!);
    const s = await signIn(api.app, u.subject);
    const created = await call<{ id: string }>(api.app, "POST", "/api/v1/transformations", { session: s, body: { businessUnitId: W.a1, name: "TL-at-BU created", mode: "end_to_end" } });
    console.log("[repro] TL@BU create status:", created.status);
    if (created.status === 201) {
      const back = await call(api.app, "GET", `/api/v1/transformations/${created.body.id}`, { session: s });
      console.log("[repro] TL@BU read-back of own created record status:", back.status);
    }
    const sib = await call(api.app, "POST", "/api/v1/transformations", { session: s, body: { businessUnitId: W.a2, name: "sibling", mode: "end_to_end" } });
    console.log("[repro] TL@BU a1 create in sibling a2 status:", sib.status);
    expect(sib.status).toBe(404);
  });
});
