// Server-side filters and sorts on listInitiatives (REQ-S15-013 "Tables use server-side pagination and filtering
// through the API"; A20 "on a register with 1,000 initiatives, sorting, filtering, paging ... all work, and the API
// returns paginated results"; ADR-0057 §5; p6-work-split §H/G.5, T-DG6-BE-R) against a real PostgreSQL:
//  - every new parameter absent -> the response is byte-identical to the DG5 response for the same data (golden: the
//    DG5 order `updated_at desc, id desc`, the DG5 cursor and hash, the unchanged presenter), on every page;
//  - 1,000 initiatives in one transformation: each sort key, both directions, pages through all 1,000 with no duplicate
//    and no gap, in the database's own order of the sorted expression (nulls last ascending, first descending);
//  - `q`, `executiveOwnerUserId` and `workstreamLeadUserId` return exactly the matching set, alone and combined;
//  - a cursor issued for other filters or another sort -> 400 at /query/cursor; a malformed keyset -> 400, never 500;
//    an unknown `sort` -> 400 at /query/sort;
//  - read authorization is unchanged: AUD reads with the new parameters; a caller without transformation.read -> 404;
//  - the query plan of `sort=code` uses `initiative_code_sort_idx` (0110): EXPLAIN is written to the test log; nothing
//    is asserted on timing.
// The 1,000 rows are SYNTHETIC and inserted in one statement with one `initiative.create` audit event each (the
// pattern of registers-report.test.ts). Nothing here approves anything (product gates G1-G6 are business approvals;
// never DG0-DG7).
import { sql } from "@mth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodeCursor, filterHash } from "../../../src/modules/platform/index.ts";
import { presentInitiatives } from "../../../src/modules/portfolio/repository.ts";
import { call, createUser, seedWorld, signIn, startApi, type TestApi, type World } from "../../support/harness.ts";
import { setupP2World, type P2World } from "../../support/p2-fixtures.ts";

let api: TestApi;
let w: World;
let p: P2World;
const N = 1000;

interface Item {
  id: string;
  code: string;
  name: string;
  executiveOwnerUserId: string | null;
  workstreamLeadUserId: string | null;
  plannedEnd: string | null;
}
interface Page {
  items: Item[];
  nextCursor: string | null;
}

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupP2World(api, w);
  // Deterministic, synthetic variety: repeated names (case differs), names containing LIKE metacharacters, three
  // owner patterns, nulls and repeats in planned_end, and updated_at values that repeat and differ by microseconds.
  await api.db.transaction().execute(async (tx) => {
    await sql`
      WITH g AS (SELECT mth_uuid_v7() AS id, n FROM generate_series(1, ${N}::int) AS n),
      ins AS (
        INSERT INTO initiative (id, organization_id, transformation_id, code, name, executive_owner_user_id,
                                workstream_lead_user_id, planned_start, planned_end, created_by, updated_by, updated_at)
        SELECT g.id, ${w.orgA.id}::uuid, ${p.transformationId}::uuid, 'INI-' || lpad(g.n::text, 4, '0'),
               'Synthetic ' || (ARRAY['Alpha', 'beta', 'GAMMA', 'delta_x', '50% roam'])[g.n % 5 + 1] || ' '
                 || ((g.n * 37) % 250)::text,
               CASE g.n % 3 WHEN 0 THEN ${p.sponsor.id}::uuid WHEN 1 THEN ${p.lead.id}::uuid END,
               CASE WHEN g.n % 4 = 0 THEN ${p.contributor.id}::uuid END,
               CASE WHEN g.n % 5 <> 0 THEN date '2027-01-01' END,
               CASE WHEN g.n % 5 <> 0 THEN date '2027-01-01' + ((g.n * 13) % 400) END,
               ${p.lead.id}::uuid, ${p.lead.id}::uuid,
               timestamptz '2026-10-01 00:00:00+00' + ((g.n * 7) % 300) * interval '997 microseconds'
          FROM g
        RETURNING id)
      INSERT INTO audit_event (id, organization_id, transformation_id, actor_type, actor_user_id, action, record_type,
                               record_id, new_version, request_id, source)
      SELECT mth_uuid_v7(), ${w.orgA.id}::uuid, ${p.transformationId}::uuid, 'user', ${p.lead.id}::uuid,
             'initiative.create', 'initiative', ins.id, 1, 'fixture-bulk-be-r', 'api'
        FROM ins`.execute(tx);
  });
  // ANALYZE needs the table owner (mth_app's ANALYZE is skipped with a warning), so the planner sees the 1,000 rows.
  await api.owner.query("ANALYZE initiative");
}, 120_000);
afterAll(() => api.close());

const list = (query: string, session = p.lead.session) =>
  call<Page>(api.app, "GET", `/api/v1/initiatives?transformationId=${p.transformationId}${query}`, { session });

/** Walks every page of `query` (limit 100) and returns the items in order plus the number of pages. */
async function walk(query: string): Promise<{ items: Item[]; pages: number }> {
  const items: Item[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const res = await list(`${query}&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(200);
    items.push(...res.body.items);
    cursor = res.body.nextCursor;
    pages += 1;
    expect(pages).toBeLessThanOrEqual(20);
  } while (cursor !== null);
  return { items, pages };
}

/** The database's own order of the sorted expression (nulls last ascending, first descending), ties by id. */
async function expectedOrder(expr: string, dir: "asc" | "desc"): Promise<string[]> {
  const nulls = dir === "asc" ? "NULLS LAST" : "NULLS FIRST";
  const rows = await sql<{ id: string }>`
    SELECT id FROM initiative WHERE transformation_id = ${p.transformationId}
     ORDER BY ${sql.raw(expr)} ${sql.raw(dir)} ${sql.raw(nulls)}, id ${sql.raw(dir)}`.execute(api.db);
  return rows.rows.map((r) => r.id);
}

describe("listInitiatives: absent parameters return the DG5 response (ADR-0057 §5; p6-work-split §H/G.14 item 7)", () => {
  it("every page is byte-identical to the DG5 page: order updated_at desc, id desc; the DG5 cursor and hash", async () => {
    // The golden: the DG5 route body (portfolio/initiatives.ts at DG5) re-stated here - its query, keyset predicate,
    // presenter and cursor (ADR-0007 §4) - and compared byte for byte with the route's response on every page.
    const hash = filterHash({ transformationId: p.transformationId });
    for (const limit of [25, 100]) {
      let cursor: string | null = null;
      let after: [string, string] | null = null;
      let pages = 0;
      do {
        let q = api.db.selectFrom("initiative").selectAll().where("transformation_id", "=", p.transformationId);
        if (after) {
          const [at, id] = after;
          q = q.where((eb) =>
            eb.or([
              eb("updated_at", "<", new Date(at)),
              eb.and([eb("updated_at", "=", new Date(at)), eb("id", "<", id)]),
            ]),
          );
        }
        const rows = await q
          .orderBy("updated_at", "desc")
          .orderBy("id", "desc")
          .limit(limit + 1)
          .execute();
        const items = rows.slice(0, limit);
        const last = items[items.length - 1];
        const expectedCursor =
          rows.length > limit && last ? encodeCursor([last.updated_at.toISOString(), last.id], hash) : null;
        const expected = JSON.stringify({ items: await presentInitiatives(api.db, items), nextCursor: expectedCursor });
        const res = await list(`&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
        expect(res.status).toBe(200);
        expect(res.raw.body, `limit ${limit}, page ${pages + 1}`).toBe(expected);
        cursor = res.body.nextCursor;
        after = last ? [last.updated_at.toISOString(), last.id] : null;
        pages += 1;
      } while (cursor !== null && pages < 50);
      expect(cursor).toBeNull();
    }
  });

  // RAISED (T-DG6-BE-R handback): the DG5 sort-absent cursor keeps updated_at to the MILLISECOND (a JS Date), while the
  // column holds microseconds, so the rows that tie with a page's last row (same updated_at, e.g. one bulk transaction)
  // or share its millisecond are skipped on the next page. The byte-identical rule (ADR-0057 §5) keeps that behaviour in
  // this task; the fix (the microsecond keyset that `sort=-updatedAt` already uses) is for the orchestrator to decide.
  // `it.fails` documents the defect; remove the mark with the fix.
  it.fails("DG5 defect, raised: with `sort` absent, paging returns every one of the 1,000 rows once", async () => {
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const res = await list(`&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      ids.push(...res.body.items.map((i) => i.id));
      cursor = res.body.nextCursor;
    } while (cursor !== null);
    expect(new Set(ids).size).toBe(N);
  });

  it("the default limit (25) and the DG5 status filter are unchanged too", async () => {
    const all = await api.db
      .selectFrom("initiative")
      .selectAll()
      .where("transformation_id", "=", p.transformationId)
      .where("status", "=", "draft")
      .orderBy("updated_at", "desc")
      .orderBy("id", "desc")
      .limit(26)
      .execute();
    const rows = all.slice(0, 25);
    const hash = filterHash({ transformationId: p.transformationId, status: "draft" });
    const expected = JSON.stringify({
      items: await presentInitiatives(api.db, rows),
      nextCursor: encodeCursor([rows[24]!.updated_at.toISOString(), rows[24]!.id], hash),
    });
    const res = await list("&status=draft");
    expect(res.raw.body).toBe(expected);
  });
});

describe("listInitiatives on 1,000 initiatives: every sort key both ways pages through all rows (A20; ADR-0057 §5)", () => {
  const SORTS: ReadonlyArray<readonly [string, string]> = [
    ["updatedAt", "updated_at"],
    ["code", "code"],
    ["name", "lower(name)"],
    ["plannedEnd", "planned_end"],
  ];
  for (const [key, expr] of SORTS) {
    for (const dir of ["asc", "desc"] as const) {
      const sort = dir === "asc" ? key : `-${key}`;
      it(`sort=${sort}: 1,000 rows, no duplicate, no gap, the database's order`, async () => {
        const { items, pages } = await walk(`&sort=${sort}`);
        expect(pages).toBe(10);
        const ids = items.map((i) => i.id);
        expect(ids).toHaveLength(N);
        expect(new Set(ids).size).toBe(N);
        expect(ids).toEqual(await expectedOrder(expr, dir));
        if (key === "plannedEnd") {
          // 200 rows have no planned end: last when ascending, first when descending.
          const nullsAt = items.flatMap((i, n) => (i.plannedEnd === null ? [n] : []));
          expect(nullsAt).toEqual(Array.from({ length: 200 }, (_, n) => (dir === "asc" ? N - 200 + n : n)));
        }
      });
    }
  }

  it("the ADR-0057 §5 default spelling -updatedAt pages all rows in today's order (to the microsecond)", async () => {
    const { items } = await walk("&sort=-updatedAt");
    expect(items.map((i) => i.id)).toEqual(await expectedOrder("updated_at", "desc"));
  });
});

describe("listInitiatives filters return exactly the matching set (A20; ADR-0057 §5)", () => {
  let everything: Item[];
  beforeAll(async () => {
    everything = (await walk("&sort=code")).items;
    expect(everything).toHaveLength(N);
  });
  const ids = (items: readonly Item[]) => items.map((i) => i.id).sort();
  const matches = (needle: string) => (i: Item) =>
    i.code.toLowerCase().includes(needle.toLowerCase()) || i.name.toLowerCase().includes(needle.toLowerCase());

  it("q is a case-insensitive substring of code or name; LIKE metacharacters are literal", async () => {
    for (const q of ["alpha", "GAMMA 1", "ini-09", "_x", "50%", "%", "_", "\\"]) {
      const expected = everything.filter(matches(q));
      const got = (await walk(`&sort=code&q=${encodeURIComponent(q)}`)).items;
      expect(ids(got), `q=${q}`).toEqual(ids(expected));
    }
    // A selective q really filters (not everything, not nothing).
    expect(everything.filter(matches("delta_x")).length).toBe(200);
    expect(everything.filter(matches("%")).length).toBe(200);
    expect(everything.filter(matches("_")).length).toBe(200);
  });

  it("executiveOwnerUserId and workstreamLeadUserId, alone and combined with q and a sort", async () => {
    const owner = await walk(`&executiveOwnerUserId=${p.sponsor.id}&sort=updatedAt`);
    expect(ids(owner.items)).toEqual(ids(everything.filter((i) => i.executiveOwnerUserId === p.sponsor.id)));
    expect(owner.items).toHaveLength(333);
    const lead = await walk(`&workstreamLeadUserId=${p.contributor.id}&sort=-name`);
    expect(ids(lead.items)).toEqual(ids(everything.filter((i) => i.workstreamLeadUserId === p.contributor.id)));
    expect(lead.items).toHaveLength(250);
    const both = await walk(
      `&executiveOwnerUserId=${p.lead.id}&workstreamLeadUserId=${p.contributor.id}&q=beta&sort=plannedEnd`,
    );
    const expected = everything.filter(
      (i) => i.executiveOwnerUserId === p.lead.id && i.workstreamLeadUserId === p.contributor.id && matches("beta")(i),
    );
    expect(expected.length).toBeGreaterThan(0);
    expect(ids(both.items)).toEqual(ids(expected));
    // A user who owns nothing here: an empty page, not an error.
    const nobody = await list(`&executiveOwnerUserId=${w.office.id}`);
    expect([nobody.status, nobody.body.items, nobody.body.nextCursor]).toEqual([200, [], null]);
  });

  it("with `sort` absent, a filter returns its matching rows in today's order (one page, see the raised defect)", async () => {
    const res = await list(`&q=${encodeURIComponent("alpha 1")}&limit=100`);
    const expected = everything
      .filter(matches("alpha 1"))
      .map((i) => i.id)
      .sort();
    expect(res.body.items.length).toBe(expected.length);
    expect(expected.length).toBeLessThan(100);
    expect(ids(res.body.items)).toEqual(expected);
    const order = await api.db
      .selectFrom("initiative")
      .select("id")
      .where("id", "in", expected)
      .orderBy("updated_at", "desc")
      .orderBy("id", "desc")
      .execute();
    expect(res.body.items.map((i) => i.id)).toEqual(order.map((r) => r.id));
  });

  it("q absent from every row: an empty page", async () => {
    const res = await list("&q=zzz-no-such-initiative");
    expect([res.status, res.body.items.length, res.body.nextCursor]).toEqual([200, 0, null]);
  });
});

describe("listInitiatives refusals (ADR-0057 §5; ADR-0007 §4 cursor binding)", () => {
  const pointerOf = (body: unknown) => (body as { errors: { pointer: string; code: string }[] }).errors[0];

  it("a cursor issued for another filter or another sort is 400 at /query/cursor", async () => {
    const first = await list("&sort=code&limit=10");
    const cursor = encodeURIComponent(first.body.nextCursor!);
    for (const other of [
      "&sort=-code",
      "&sort=name",
      "",
      "&sort=code&q=alpha",
      `&sort=code&executiveOwnerUserId=${p.sponsor.id}`,
      `&sort=code&workstreamLeadUserId=${p.contributor.id}`,
      "&sort=code&status=draft",
    ]) {
      const res = await list(`${other}&limit=10&cursor=${cursor}`);
      expect([res.status, pointerOf(res.body)], other).toEqual([
        400,
        expect.objectContaining({ pointer: "/query/cursor", code: "validation.cursor" }),
      ]);
    }
    // The same filters and sort accept it.
    expect((await list(`&sort=code&limit=10&cursor=${cursor}`)).status).toBe(200);
    // A DG5 (sort-absent) cursor is refused with a sort, and a sorted cursor without one.
    const dg5 = await list("&limit=10");
    const res = await list(`&sort=-updatedAt&limit=10&cursor=${encodeURIComponent(dg5.body.nextCursor!)}`);
    expect(res.status).toBe(400);
  });

  it("a hand-made cursor with the right hash but a malformed keyset is 400, never a database error", async () => {
    const hashOf = (sort: string) => filterHash({ transformationId: p.transformationId, sort });
    const id = "01920099-0000-7000-8000-000000000001";
    for (const [sort, keys] of [
      ["plannedEnd", ["2027-02-31", id]],
      ["plannedEnd", ["not a date", id]],
      ["updatedAt", ["2026-10-01T00:00:00Z", id]],
      ["-updatedAt", ["2026-13-01T00:00:00.000000Z", id]],
      ["code", [42, id]],
      ["code", ["INI-0001", "not-a-uuid"]],
      ["name", ["x", 7]],
    ] as const) {
      const cursor = encodeCursor(keys as unknown as (string | number | null)[], hashOf(sort));
      const res = await list(`&sort=${sort}&cursor=${encodeURIComponent(cursor)}`);
      expect([res.status, pointerOf(res.body)?.pointer], `${sort} ${JSON.stringify(keys)}`).toEqual([
        400,
        "/query/cursor",
      ]);
    }
    // A null keyset value is valid for the nullable planned end (the null block).
    const ok = encodeCursor([null, id], hashOf("plannedEnd"));
    expect((await list(`&sort=plannedEnd&cursor=${encodeURIComponent(ok)}`)).status).toBe(200);
  });

  it("an unknown sort is 400 at /query/sort; q outside 1-200 characters and a malformed owner id are 400", async () => {
    for (const sort of ["status", "updatedAt:desc", "-", "CODE", "plannedStart"]) {
      const res = await list(`&sort=${encodeURIComponent(sort)}`);
      expect([res.status, pointerOf(res.body)?.pointer], sort).toEqual([400, "/query/sort"]);
    }
    expect(pointerOf((await list(`&q=${"x".repeat(201)}`)).body)?.pointer).toBe("/query/q");
    expect(pointerOf((await list("&q=")).body)?.pointer).toBe("/query/q");
    expect(pointerOf((await list("&executiveOwnerUserId=nobody")).body)?.pointer).toBe("/query/executiveOwnerUserId");
    expect(pointerOf((await list("&workstreamLeadUserId=nobody")).body)?.pointer).toBe("/query/workstreamLeadUserId");
  });
});

describe("listInitiatives read authorization is unchanged by the new parameters (REQ-S15-013 view:scoped)", () => {
  it("AUD reads with filters and a sort; a user without transformation.read gets 404 with them", async () => {
    const aud = await list(`&sort=-plannedEnd&q=alpha&executiveOwnerUserId=${p.sponsor.id}&limit=5`, p.auditor.session);
    expect(aud.status).toBe(200);
    expect(aud.body.items).toHaveLength(5);
    const outsider = await createUser(api.db, w.orgA.id);
    const session = await signIn(api.app, outsider.subject);
    for (const query of ["", "&sort=code", "&q=alpha", `&executiveOwnerUserId=${p.sponsor.id}`]) {
      expect((await list(query, session)).status, query).toBe(404);
    }
  });
});

describe("the query plan of sort=code (0110 initiative_code_sort_idx; logged, not timed)", () => {
  it("EXPLAIN of the route's sort=code page query uses initiative_code_sort_idx", async () => {
    // The statement the route issues for `sort=code&limit=100` (first page): selectAll, the sort key, the keyset order.
    const plan = await sql<{ "QUERY PLAN": string }>`
      EXPLAIN SELECT *, code AS sort_key FROM initiative WHERE transformation_id = ${p.transformationId}::uuid
       ORDER BY code asc NULLS LAST, id asc LIMIT 101`.execute(api.db);
    const text = plan.rows.map((r) => r["QUERY PLAN"]).join("\n");
    console.log(`EXPLAIN listInitiatives sort=code (1,000 initiatives in the transformation):\n${text}`);
    expect(text).toContain("initiative_code_sort_idx");
  });
});
