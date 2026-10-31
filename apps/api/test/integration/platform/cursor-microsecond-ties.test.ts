// Cursor order is total under timestamp ties (T-DG6-BE-X7; ADR-0007 §4 cursor rules; REQ-S15-013 A20 "the API returns
// paginated results"). The A20 run at 043de1e lost one initiative of 1,000 when paging with `sort` absent: the cursor
// carried updated_at as a JS Date (milliseconds) while PostgreSQL keeps microseconds, so a row sharing the page's last
// millisecond with a smaller microsecond fell between two pages. Whether that happened depended on how fast the rows were
// written, so the QA test failed only under load. This test makes the case deterministic: every row lies in ONE
// millisecond, many rows share exactly the same instant (one transaction's now()) and the others differ by a few
// microseconds. Every page size must return every row exactly once, in the database's own order, on:
//  - listInitiatives with `sort` absent (the DG5 order updated_at desc, id desc) and with sort=updatedAt / -updatedAt;
//  - listDependencies (T08; created_at-free, ordered updated_at desc, id desc), the same cursor pattern.
// It also checks the cursor's instant: a millisecond cursor issued before the repair is still accepted, and a malformed
// instant or identifier is a 400 at /query/cursor, never a database error. Real PostgreSQL; the rows are SYNTHETIC (each
// with its create audit event, the pattern of initiatives-filters.test.ts). Nothing here approves anything (product gates
// G1-G6 are business approvals; never DG0-DG7).
import { sql } from "@mth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodeCursor, filterHash } from "../../../src/modules/platform/index.ts";
import { call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { setupP2World, type P2World } from "../../support/p2-fixtures.ts";

let api: TestApi;
let w: World;
let p: P2World;
const N = 240;
// All N instants lie in [base, base + 39 µs]: one millisecond. Rows n <= 80 share the exact same instant; the others
// repeat every 40 rows, so every instant is shared by several rows and neighbours differ by one microsecond.
const BASE = "2026-10-01 08:00:00.123000+00";

interface Page {
  items: { id: string }[];
  nextCursor: string | null;
}

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupP2World(api, w);
  const at = sql`CASE WHEN g.n <= 80 THEN ${BASE}::timestamptz ELSE ${BASE}::timestamptz + (g.n % 40) * interval '1 microsecond' END`;
  await api.db.transaction().execute(async (tx) => {
    await sql`
      WITH g AS (SELECT mth_uuid_v7() AS id, n FROM generate_series(1, ${N}::int) AS n),
      ins AS (
        INSERT INTO initiative (id, organization_id, transformation_id, code, name, created_by, updated_by, updated_at)
        SELECT g.id, ${w.orgA.id}::uuid, ${p.transformationId}::uuid, 'INI-' || lpad(g.n::text, 4, '0'),
               'Synthetic tie ' || g.n::text, ${p.lead.id}::uuid, ${p.lead.id}::uuid, ${at}
          FROM g
        RETURNING id)
      INSERT INTO audit_event (id, organization_id, transformation_id, actor_type, actor_user_id, action, record_type,
                               record_id, new_version, request_id, source)
      SELECT mth_uuid_v7(), ${w.orgA.id}::uuid, ${p.transformationId}::uuid, 'user', ${p.lead.id}::uuid,
             'initiative.create', 'initiative', ins.id, 1, 'fixture-bulk-be-x7', 'api'
        FROM ins`.execute(tx);
    await sql`
      WITH g AS (SELECT mth_uuid_v7() AS id, n FROM generate_series(1, ${N}::int) AS n),
      ins AS (
        INSERT INTO dependency (id, organization_id, transformation_id, code, description, from_kind, from_label, to_kind,
                                to_label, dependency_type, created_by, updated_by, updated_at)
        SELECT g.id, ${w.orgA.id}::uuid, ${p.transformationId}::uuid, 'DEP-' || lpad(g.n::text, 4, '0'),
               'Synthetic tie dependency ' || g.n::text, 'other', 'Synthetic source', 'other', 'Synthetic target', 'other',
               ${p.lead.id}::uuid, ${p.lead.id}::uuid, ${at}
          FROM g
        RETURNING id)
      INSERT INTO audit_event (id, organization_id, transformation_id, actor_type, actor_user_id, action, record_type,
                               record_id, new_version, request_id, source)
      SELECT mth_uuid_v7(), ${w.orgA.id}::uuid, ${p.transformationId}::uuid, 'user', ${p.lead.id}::uuid,
             'dependency.create', 'dependency', ins.id, 1, 'fixture-bulk-be-x7', 'api'
        FROM ins`.execute(tx);
  });
}, 120_000);
afterAll(() => api?.close());

const get = (path: string) => call<Page>(api.app, "GET", path, { session: p.lead.session });

/** Every page of `path` at `limit`; returns the ids in order (asserting 200, the page size and termination). */
async function walk(path: string, limit: number): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const res = await get(`${path}&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(200);
    expect(res.body.items.length).toBeLessThanOrEqual(limit);
    ids.push(...res.body.items.map((i) => i.id));
    cursor = res.body.nextCursor;
    pages += 1;
    expect(pages, "the cursor chain terminates").toBeLessThanOrEqual(N + 1);
  } while (cursor !== null);
  return ids;
}

/** The database's own order of `table` in the transformation. */
async function dbOrder(table: "initiative" | "dependency", dir: "asc" | "desc"): Promise<string[]> {
  const rows = await sql<{ id: string }>`
    SELECT id FROM ${sql.table(table)} WHERE transformation_id = ${p.transformationId}
     ORDER BY updated_at ${sql.raw(dir)}, id ${sql.raw(dir)}`.execute(api.db);
  return rows.rows.map((r) => r.id);
}

describe("cursor order is total when many rows share a timestamp or its millisecond (T-DG6-BE-X7)", () => {
  it("the fixture is the hard case: one millisecond, exact ties and one-microsecond neighbours", async () => {
    const r = await sql<{ ms: string; distinct_us: string; biggest_tie: string }>`
      SELECT count(DISTINCT date_trunc('milliseconds', updated_at))::text AS ms,
             count(DISTINCT updated_at)::text AS distinct_us,
             (SELECT max(c) FROM (SELECT count(*) AS c FROM initiative WHERE transformation_id = ${p.transformationId}
                                   GROUP BY updated_at) t)::text AS biggest_tie
        FROM initiative WHERE transformation_id = ${p.transformationId}`.execute(api.db);
    expect(r.rows[0]).toEqual({ ms: "1", distinct_us: "40", biggest_tie: String(80 + 4) });
  });

  for (const limit of [1, 7, 25, 100]) {
    it(`listInitiatives with sort absent, limit ${limit}: all ${N} rows once, in updated_at desc, id desc`, async () => {
      const ids = await walk(`/api/v1/initiatives?transformationId=${p.transformationId}`, limit);
      expect(ids).toHaveLength(N);
      expect(ids).toEqual(await dbOrder("initiative", "desc"));
    });
  }

  for (const [sort, dir] of [
    ["updatedAt", "asc"],
    ["-updatedAt", "desc"],
  ] as const) {
    it(`listInitiatives sort=${sort}, limit 7: all ${N} rows once, in the database's order`, async () => {
      const ids = await walk(`/api/v1/initiatives?transformationId=${p.transformationId}&sort=${sort}`, 7);
      expect(ids).toEqual(await dbOrder("initiative", dir));
    });
  }

  for (const limit of [1, 7, 50]) {
    it(`listDependencies, limit ${limit}: all ${N} rows once, in updated_at desc, id desc`, async () => {
      const ids = await walk(`/api/v1/dependencies?transformationId=${p.transformationId}`, limit);
      expect(ids).toHaveLength(N);
      expect(ids).toEqual(await dbOrder("dependency", "desc"));
    });
  }

  it("the cursor carries the microsecond; a millisecond cursor from before the repair is still accepted", async () => {
    const first = await get(`/api/v1/initiatives?transformationId=${p.transformationId}&limit=90`);
    const decoded = JSON.parse(Buffer.from(first.body.nextCursor!, "base64url").toString("utf8")) as { k: string[] };
    expect(decoded.k[0]).toMatch(/^2026-10-01T08:00:00\.123\d{3}Z$/);
    const hash = filterHash({ transformationId: p.transformationId });
    const legacy = encodeCursor(["2026-10-01T08:00:00.124Z", "ffffffff-ffff-7fff-bfff-ffffffffffff"], hash);
    const res = await get(
      `/api/v1/initiatives?transformationId=${p.transformationId}&limit=100&cursor=${encodeURIComponent(legacy)}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(100); // every row is before 08:00:00.124
  });

  it("a malformed instant or row identifier in a well-hashed cursor is 400 at /query/cursor, never a 500", async () => {
    const hash = filterHash({ transformationId: p.transformationId });
    const id = "01920099-0000-7000-8000-000000000001";
    for (const keys of [
      ["2026-02-31T00:00:00.000000Z", id],
      ["2026-10-01T24:00:00.000000Z", id],
      ["2026-10-01 08:00:00.123+00", id],
      ["not a time", id],
      [1234, id],
      ["2026-10-01T08:00:00.123456Z", "not-a-uuid"],
    ] as const) {
      const cursor = encodeCursor(keys as unknown as (string | number | null)[], hash);
      const res = await get(
        `/api/v1/initiatives?transformationId=${p.transformationId}&cursor=${encodeURIComponent(cursor)}`,
      );
      const problem = (res.body as unknown as { errors?: { pointer: string; code: string }[] }).errors?.[0];
      expect([res.status, problem], JSON.stringify(keys)).toEqual([
        400,
        expect.objectContaining({ pointer: "/query/cursor", code: "validation.cursor" }),
      ]);
    }
  });
});
