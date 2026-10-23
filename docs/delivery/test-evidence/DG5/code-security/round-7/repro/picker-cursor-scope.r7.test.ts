// code-security-reviewer DG5 round 7 probe (NOT product code; run only in a disposable clone, copied to
// apps/api/test/integration/zz-sec-r7-picker-cursor-scope.test.ts). Synthetic data only.
//
// D-181's useAllTransformations follows nextCursor of GET /api/v1/transformations with limit=100 until it is null.
// This probe drives the same server operation the same way (limit 100, follow nextCursor) and checks what that complete
// list may contain:
//   S1  a BU-scoped office (TO @ BU a1, inherits downward) gets every a1 and a1x transformation over >= 3 pages, in strict order, no duplicates, and
//       nothing of sibling BU a2 or of organization B; the loop terminates (nextCursor null) for both sorts the pickers use;
//   S2  an organization-wide office (TO @ org A) gets all of org A over the pages and nothing of org B;
//   S3  a cursor taken from org A's listing and replayed by org B's office returns only org B rows (a cursor carries a
//       position only, never a grant);
//   S4  a cursor replayed with different filters is refused (400), never silently re-scoped;
//   S5  an ADM-only caller (ADM_ACCESS + ADM_TECH, no transformation.read) and a non-inheriting TL @ BU get 200 with an
//       EMPTY list over every page (lists are filtered by scopeFilter, ADR-0006; FALSE without a grant): nothing listed;
//   S6  an archived transformation is not listed unless includeArchived is asked for.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  call,
  createBu,
  createUser,
  grant,
  createTransformationRow,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../support/harness.ts";

let api: TestApi;
let w: World;
const inA1: string[] = [];
const inA1x: string[] = [];
const inA2: string[] = [];
const inB: string[] = [];
let archivedA1 = "";
let lead: Session;
let buOffice: Session;
let office: Session;
let officeB: Session;
let adm: Session;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  for (let i = 0; i < 230; i++) inA1.push(await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id));
  for (let i = 0; i < 20; i++) inA1x.push(await createTransformationRow(api.db, w.orgA.id, w.a1x, w.office.id));
  for (let i = 0; i < 40; i++) inA2.push(await createTransformationRow(api.db, w.orgA.id, w.a2, w.office.id));
  const b2 = await createBu(api.db, w.orgB.id);
  for (let i = 0; i < 30; i++) inB.push(await createTransformationRow(api.db, w.orgB.id, i % 2 ? w.b1 : b2, w.officeB.id));
  archivedA1 = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
  await api.db.updateTable("transformation").set({ archived_at: new Date(), archive_reason: "probe fixture", archived_by: w.office.id }).where("id", "=", archivedA1).execute();
  lead = await signIn(api.app, w.leadA1.subject);
  const bo = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, bo.id, "TO", { type: "business_unit", id: w.a1 }, w.orgA.id);
  buOffice = await signIn(api.app, bo.subject);
  office = await signIn(api.app, w.office.subject);
  officeB = await signIn(api.app, w.officeB.subject);
  adm = await signIn(api.app, w.admin.subject);
}, 240_000);
afterAll(() => api.close());

type Row = { id: string; organizationId: string; businessUnitId: string; code: string };
async function followAll(s: Session, query: string) {
  const ids: string[] = [];
  const rows: Row[] = [];
  let cursor: string | null = null;
  let pages = 0;
  const cursors = new Set<string>();
  for (;;) {
    const url = `/api/v1/transformations?limit=100&${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const r = await call<{ items: Row[]; nextCursor: string | null }>(api.app, "GET", url, { session: s });
    expect(r.status, url).toBe(200);
    pages++;
    expect(r.body.items.length).toBeLessThanOrEqual(100);
    for (const it of r.body.items) {
      ids.push(it.id);
      rows.push(it);
    }
    if (!r.body.nextCursor) break;
    expect(cursors.has(r.body.nextCursor), "a repeated cursor").toBe(false);
    cursors.add(r.body.nextCursor);
    cursor = r.body.nextCursor;
    expect(pages, "termination").toBeLessThan(50);
  }
  return { ids, rows, pages };
}

describe("D-181 complete picker list: server-side scope over every page (code-security r7)", () => {
  for (const sort of ["code:asc", "updatedAt:desc"]) {
    it(`S1 BU-scoped office, sort ${sort}: all of a1 and a1x over >= 3 pages, nothing of a2 or org B, no duplicates`, async () => {
      const { ids, rows, pages } = await followAll(buOffice, `sort=${encodeURIComponent(sort)}`);
      console.log(`S1 ${sort}: pages=${pages} items=${ids.length}`);
      expect(pages).toBeGreaterThanOrEqual(3);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of [...inA1, ...inA1x]) expect(ids).toContain(id);
      expect(ids.length).toBe(inA1.length + inA1x.length);
      for (const id of [...inA2, ...inB, archivedA1]) expect(ids).not.toContain(id);
      for (const r of rows) expect(r.organizationId).toBe(w.orgA.id);
      if (sort === "code:asc") {
        const codes = rows.map((r) => r.code);
        expect(codes).toEqual([...codes].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
      }
    });
  }

  it("S2 organization-wide office: all of org A over the pages, nothing of org B", async () => {
    const { ids, pages } = await followAll(office, "sort=code%3Aasc");
    console.log(`S2: pages=${pages} items=${ids.length}`);
    expect(pages).toBeGreaterThanOrEqual(3);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of [...inA1, ...inA1x, ...inA2]) expect(ids).toContain(id);
    for (const id of [...inB, archivedA1]) expect(ids).not.toContain(id);
  });

  it("S3 a cursor from org A's listing replayed by org B's office returns only org B rows", async () => {
    const first = await call<{ items: Row[]; nextCursor: string | null }>(
      api.app,
      "GET",
      "/api/v1/transformations?limit=100&sort=code%3Aasc",
      { session: office },
    );
    expect(first.status).toBe(200);
    expect(first.body.nextCursor).toBeTruthy();
    const r = await call<{ items: Row[]; nextCursor: string | null }>(
      api.app,
      "GET",
      `/api/v1/transformations?limit=100&sort=code%3Aasc&cursor=${encodeURIComponent(first.body.nextCursor!)}`,
      { session: officeB },
    );
    console.log(`S3: status=${r.status} items=${Array.isArray(r.body?.items) ? r.body.items.length : "-"}`);
    if (r.status === 200) {
      for (const it of r.body.items) expect(it.organizationId).toBe(w.orgB.id);
      for (const it of r.body.items) expect([...inA1, ...inA2]).not.toContain(it.id);
    } else {
      expect([400, 403, 404]).toContain(r.status);
    }
  });

  it("S4 a cursor replayed with different filters is refused (400)", async () => {
    const first = await call<{ items: Row[]; nextCursor: string | null }>(
      api.app,
      "GET",
      "/api/v1/transformations?limit=100&sort=code%3Aasc",
      { session: office },
    );
    expect(first.body.nextCursor).toBeTruthy();
    const c = encodeURIComponent(first.body.nextCursor!);
    const r1 = await call(api.app, "GET", `/api/v1/transformations?limit=100&sort=code%3Aasc&businessUnitId=${w.a2}&cursor=${c}`, {
      session: office,
    });
    const r2 = await call(api.app, "GET", `/api/v1/transformations?limit=100&sort=updatedAt%3Adesc&cursor=${c}`, {
      session: office,
    });
    const r3 = await call(api.app, "GET", `/api/v1/transformations?limit=100&sort=code%3Aasc&cursor=${c}x`, {
      session: office,
    });
    console.log(`S4: other filter=${r1.status} other sort=${r2.status} mangled=${r3.status}`);
    expect(r1.status).toBe(400);
    expect(r2.status).toBe(400);
    expect(r3.status).toBe(400);
  });

  it("S5 ADM-only and non-inheriting TL @ BU: 200 with an empty list, one page, for both sorts", async () => {
    for (const [who, sess] of [["adm", adm], ["tlBu", lead]] as const)
      for (const sort of ["code%3Aasc", "updatedAt%3Adesc"]) {
        const { ids, pages } = await followAll(sess, `sort=${sort}&includeArchived=true`);
        console.log(`S5: ${who} ${sort} pages=${pages} items=${ids.length}`);
        expect(pages).toBe(1);
        expect(ids).toEqual([]);
      }
  });

  it("S6 an archived transformation is listed only with includeArchived", async () => {
    const { ids } = await followAll(buOffice, "sort=code%3Aasc&includeArchived=true");
    expect(ids).toContain(archivedA1);
  });
});
