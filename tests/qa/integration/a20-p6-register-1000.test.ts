// qa-verifier A20 "UX and branding", the register half of REQ-S15-013 (DG6, T-DG6-QA-D). Binding row text
// (docs/delivery/requirements.csv): "A20: on a register with 1,000 initiatives, sorting, filtering, paging and hiding a
// column all work, and the API returns paginated results". This file proves the API half against the contract
// (docs/api/openapi.yaml listInitiatives: `transformationId`, `status`, `q` "Case-insensitive substring over the list's
// declared text columns", `sort` keyset (sort value, id), `cursor`, `limit`); the UI half (sorting, filtering,
// paging and hiding a column on the screen) is NOT covered by this QA task (see its handback). The real API (inject,
// contract-validated responses) on the run's PostgreSQL; the 1,000 SYNTHETIC initiatives are written by the
// backend's P3 fixture (with their audit events; setup only). Nothing approves anything.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { insertInitiative, type BenefitWorld } from "../../../apps/api/test/integration/benefits/fixtures.ts";
import {
  call,
  createTransformationRow,
  createUser,
  grant,
  signIn,
  startApi,
  type Loose,
  type Session,
  type TestApi,
} from "../support/api.ts";
import { seedWorld, type World } from "../support/p4.ts";

const N = 1000;
let api: TestApi;
let w: World;
let tid: string;
let tl: Session;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  tid = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
  const lead = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, lead.id, "TL", { type: "transformation", id: tid }, w.orgA.id);
  tl = await signIn(api.app, lead.subject);
  const fixture = { organizationId: w.orgA.id, transformationId: tid, users: { tl: lead } } as unknown as BenefitWorld;
  // Sequential: the transformation's INI-nn codes are allocated in order (a parallel insert collides on the code).
  for (let i = 0; i < N; i++) await insertInitiative(api.db, fixture);
}, 240_000);
afterAll(() => api?.close());

/** Every page of listInitiatives for `query`; asserts each page's size and returns the items in order. */
async function allPages(query: string, limit: number): Promise<{ items: Loose[]; pages: number }> {
  const items: Loose[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const url = `/api/v1/initiatives?transformationId=${tid}&limit=${limit}${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const res = await call<Loose>(api.app, "GET", url, { session: tl });
    expect(res.status, JSON.stringify(res.body).slice(0, 500)).toBe(200);
    expect((res.body.items as Loose[]).length).toBeLessThanOrEqual(limit);
    items.push(...(res.body.items as Loose[]));
    cursor = res.body.nextCursor;
    pages += 1;
    expect(pages, "the cursor chain terminates").toBeLessThanOrEqual(N + 1);
  } while (cursor);
  return { items, pages };
}

describe("REQ-S15-013 (A20): the initiative register API over 1,000 initiatives", () => {
  it("is paginated: limit 50 gives 20 pages of at most 50, exactly 1,000 distinct initiatives, and the last page ends the chain", async () => {
    const first = await call<Loose>(api.app, "GET", `/api/v1/initiatives?transformationId=${tid}&limit=50`, {
      session: tl,
    });
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(50);
    expect(typeof first.body.nextCursor).toBe("string");
    const { items, pages } = await allPages("", 50);
    expect(pages).toBe(20);
    expect(items).toHaveLength(N);
    expect(new Set(items.map((i) => i.id)).size).toBe(N);
  });

  it("sorts across pages: sort=code is ascending and sort=-code its exact reverse; sort=name agrees with the code order's set", async () => {
    const asc = (await allPages("&sort=code", 100)).items.map((i) => String(i.code));
    expect(asc).toHaveLength(N);
    expect([...asc].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual(asc);
    const desc = (await allPages("&sort=-code", 100)).items.map((i) => String(i.code));
    expect(desc).toEqual([...asc].reverse());
    const byName = (await allPages("&sort=name", 100)).items.map((i) => String(i.name));
    expect(byName).toHaveLength(N);
    for (let i = 1; i < byName.length; i++) expect(byName[i - 1]! <= byName[i]!, `name order at ${i}`).toBe(true);
  });

  it("filters on the server: q is a case-insensitive substring over the text columns and matches exactly the expected subset", async () => {
    const all = (await allPages("", 100)).items;
    const needle = String(all.find((i) => /7$/.test(String(i.code)))!.code).slice(-2); // e.g. "07" or "77"
    const expected = all
      .filter((i) => String(i.code).toLowerCase().includes(needle) || String(i.name).toLowerCase().includes(needle))
      .map((i) => i.id)
      .sort();
    const filtered = (await allPages(`&q=${encodeURIComponent(needle)}`, 50)).items;
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.length).toBeLessThan(N);
    // Every result matches; nothing that matches is missing (the declared text columns include code and name).
    for (const i of filtered)
      expect(`${i.code} ${i.name}`.toLowerCase(), `result ${i.code} matches ${needle}`).toContain(needle);
    expect(filtered.map((i) => i.id).sort()).toEqual(expected);
    const upper = (await allPages(`&q=${encodeURIComponent("SYNTHETIC INITIATIVE")}`, 100)).items;
    expect(upper, "case-insensitive").toHaveLength(N);
    const none = await call<Loose>(
      api.app,
      "GET",
      `/api/v1/initiatives?transformationId=${tid}&q=${encodeURIComponent("no-such-synthetic-text")}`,
      { session: tl },
    );
    expect([none.status, none.body.items, none.body.nextCursor]).toEqual([200, [], null]);
  });

  it("refuses an unknown sort and an oversized limit with 400 (validation), never a silent full list", async () => {
    const badSort = await call<Loose>(api.app, "GET", `/api/v1/initiatives?transformationId=${tid}&sort=budget`, {
      session: tl,
    });
    expect(badSort.status).toBe(400);
    const badLimit = await call<Loose>(api.app, "GET", `/api/v1/initiatives?transformationId=${tid}&limit=100000`, {
      session: tl,
    });
    expect(badLimit.status).toBe(400);
  });
});
