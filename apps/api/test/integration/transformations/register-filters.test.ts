// Server-side filters and sorts on the 9 register-kit lists and listTransformations (REQ-S15-013 "Tables use
// server-side pagination and filtering through the API"; ADR-0057 §5; p6-work-split §H/G.5, T-DG6-BE-R) against a
// real PostgreSQL:
//  - every new parameter absent -> the response is byte-identical to the DG2 (register kit: `id` ascending) and DG1
//    (listTransformations: `updatedAt:desc`) response for the same data, on every page (golden comparison);
//  - each declared sort key (RegisterSpec.sortColumns; the saved-view registry's sorts), both directions, pages through
//    every row with no duplicate and no gap in the database's order, nulls last ascending and first descending;
//  - `q` is a case-insensitive substring over the spec's declared searchColumns; LIKE metacharacters are literal;
//  - a cursor from other filters or another sort -> 400 at /query/cursor; an unknown sort -> 400 at /query/sort;
//  - the registers that declare neither (dependencies, actions, TOM workshops) still refuse `q` and `sort` (400);
//  - read authorization is unchanged: AUD lists with `q` and `sort`; a caller without transformation.read -> 404.
// All data is SYNTHETIC; nothing here approves anything (product gates G1-G6 are business approvals; never DG0-DG7).
import { sql } from "@mth/db";
import { SAVED_VIEW_LISTS, type SavedViewListKey } from "@mth/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodeCursor, filterHash } from "../../../src/modules/platform/index.ts";
import { loose, type LooseRow } from "../../../src/modules/transformations/register-kit.ts";
import {
  capabilityRegister,
  diagnosticFindingRegister,
  diagnosticItemRegister,
  journeyPainPointRegister,
  journeyRegister,
  outcomeRegister,
  strategicGuardrailRegister,
  tomGapRegister,
  workstreamOutputRegister,
} from "../../../src/modules/transformations/registers.ts";
import { toTransformation } from "../../../src/modules/transformations/repository.ts";
import {
  call,
  createTransformationRow,
  createUser,
  seedWorld,
  signIn,
  startApi,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { ifm, setupP2World, type P2World } from "../../support/p2-fixtures.ts";

let api: TestApi;
let w: World;
let p: P2World;
let T: string;

interface Page {
  items: ({ id: string } & Record<string, unknown>)[];
  nextCursor: string | null;
}
// Five synthetic texts: two match "alpha" (case differs), one holds "_", one holds "%".
const WORDS = ["Alpha one", "beta_two", "GAMMA 50% three", "alpha four", "Delta five"];
const STEP = "01920099-0000-7000-8000-0000000000aa";

// The spec, its list key in the saved-view registry, and its rows' create bodies (filled in beforeAll).
interface Case {
  readonly listKey: SavedViewListKey;
  readonly spec: unknown;
  path: string;
  parent?: string;
}
const CASES: Case[] = [];
const specOf = (c: Case) =>
  c.spec as unknown as {
    table: string;
    archive?: unknown;
    parent?: { column: string };
    searchColumns: readonly string[];
    sortColumns: ReadonlyMap<string, { column: string; kind: string }>;
    toApi?: (r: LooseRow) => unknown;
    present?: (db: unknown, rows: readonly LooseRow[]) => Promise<unknown[]>;
  };

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupP2World(api, w);
  T = `/api/v1/transformations/${p.transformationId}`;
  const codes = async (table: string) =>
    (await sql<{ code: string }>`SELECT code FROM ${sql.table(table)} ORDER BY code`.execute(api.db)).rows.map(
      (r) => r.code,
    );
  const dims = await codes("diagnostic_dimension");
  const workstreams = await codes("diagnostic_workstream");
  const tomDims = await codes("tom_dimension");
  const post = async (path: string, body: Record<string, unknown>) => {
    const res = await call(api.app, "POST", path, { session: p.lead.session, body });
    expect(res.status, `${path}: ${JSON.stringify(res.body).slice(0, 400)}`).toBe(201);
    return res.body as { id: string; version: number };
  };
  const make = async (path: string, body: (i: number) => Record<string, unknown>) => {
    const ids: string[] = [];
    for (let i = 0; i < WORDS.length; i += 1) ids.push((await post(path, body(i))).id);
    // One archived row: left out unless includeArchived=true.
    const archived = await call(api.app, "POST", `${path}/${ids[4]}/archive`, {
      session: p.lead.session,
      headers: ifm(1),
      body: { reason: "Synthetic archive" },
    });
    expect(archived.status, JSON.stringify(archived.body)).toBe(200);
  };
  const categories = ["cx", "capex", "risk", "cx", "brand"];
  await make(`${T}/strategic-guardrails`, (i) => ({
    title: WORDS[i],
    category: categories[i],
    statement: `Synthetic guardrail ${i}`,
  }));
  await make(`${T}/outcomes`, (i) => ({ statement: `Synthetic ${WORDS[i]}` }));
  // Two top ranks; the other outcomes have none (nulls last ascending).
  const outcomes = await loose(api.db)
    .selectFrom("outcome")
    .select(["id", "version"])
    .where("transformation_id", "=", p.transformationId)
    .where("status", "<>", "archived")
    .orderBy("id")
    .execute();
  for (const [n, rank] of [
    [0, 2],
    [2, 1],
  ] as const) {
    const o = outcomes[n]!;
    const res = await call(api.app, "PATCH", `${T}/outcomes/${String(o["id"])}`, {
      session: p.lead.session,
      headers: ifm(Number(o["version"])),
      body: { isTopOutcome: true, topRank: rank },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }
  await make(`${T}/diagnostic-items`, (i) => ({ dimensionCode: dims[i % dims.length], currentState: WORDS[i] }));
  const kinds = ["symptom", "root_cause", "opportunity", "observation", "symptom"];
  await make(`${T}/diagnostic-findings`, (i) => ({
    workstreamCode: workstreams[i % 2],
    kind: kinds[i],
    statement: WORDS[i],
  }));
  const item = (
    await loose(api.db)
      .selectFrom("diagnostic_item")
      .select("id")
      .where("transformation_id", "=", p.transformationId)
      .orderBy("id")
      .executeTakeFirstOrThrow()
  )["id"] as string;
  await make(`${T}/workstream-outputs`, (i) => ({
    workstreamCode: workstreams[(i + 1) % 3],
    title: WORDS[i],
    recordType: "diagnostic_item",
    recordId: item,
  }));
  await make(`${T}/tom-gaps`, (i) => ({ dimensionCode: tomDims[i % tomDims.length], currentState: WORDS[i] }));
  await make(`${T}/capability-heatmap`, (i) => ({
    name: WORDS[i],
    ...(i % 2 === 0 ? { dimensionCode: tomDims[i % tomDims.length] } : {}),
  }));
  await make(`${T}/journeys`, (i) => ({
    name: WORDS[i],
    kind: i % 2 === 0 ? "journey" : "process",
    state: "current",
    steps: [{ key: STEP, ordinal: 1, name: "Synthetic step" }],
  }));
  const journey = await post(`${T}/journeys`, {
    name: "Synthetic pain-point journey",
    kind: "process",
    state: "current",
    steps: [{ key: STEP, ordinal: 1, name: "Synthetic step" }],
  });
  await make(`${T}/journeys/${journey.id}/pain-points`, (i) => ({
    description: WORDS[i],
    ...(i % 2 === 0 ? { stepKey: STEP } : {}),
  }));
  CASES.push(
    { listKey: "strategic_guardrails", spec: strategicGuardrailRegister, path: `${T}/strategic-guardrails` },
    { listKey: "outcomes", spec: outcomeRegister, path: `${T}/outcomes` },
    { listKey: "diagnostic_items", spec: diagnosticItemRegister, path: `${T}/diagnostic-items` },
    { listKey: "diagnostic_findings", spec: diagnosticFindingRegister, path: `${T}/diagnostic-findings` },
    { listKey: "workstream_outputs", spec: workstreamOutputRegister, path: `${T}/workstream-outputs` },
    { listKey: "tom_gaps", spec: tomGapRegister, path: `${T}/tom-gaps` },
    { listKey: "capability_heatmap", spec: capabilityRegister, path: `${T}/capability-heatmap` },
    { listKey: "journeys", spec: journeyRegister, path: `${T}/journeys` },
    {
      listKey: "journey_pain_points",
      spec: journeyPainPointRegister,
      path: `${T}/journeys/${journey.id}/pain-points`,
      parent: journey.id,
    },
  );
}, 120_000);
afterAll(() => api.close());

const get = (url: string, session = p.lead.session) => call<Page>(api.app, "GET", url, { session });

async function walk(c: Case, query: string, limit = 2): Promise<Page["items"]> {
  const items: Page["items"] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const res = await get(`${c.path}?limit=${limit}${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    expect(res.status, `${c.listKey}${query}: ${JSON.stringify(res.body).slice(0, 300)}`).toBe(200);
    items.push(...res.body.items);
    cursor = res.body.nextCursor;
    pages += 1;
    expect(pages).toBeLessThan(40);
  } while (cursor !== null);
  return items;
}

/** The list's rows as the DG2 kit selects them (archived left out unless asked), in `id` order. */
async function rowsOf(c: Case, includeArchived = false): Promise<LooseRow[]> {
  const spec = specOf(c);
  let q = loose(api.db).selectFrom(spec.table).selectAll().where("transformation_id", "=", p.transformationId);
  if (spec.parent && c.parent) q = q.where(spec.parent.column, "=", c.parent);
  if (spec.archive !== false && spec.archive !== undefined && !includeArchived) q = q.where("status", "<>", "archived");
  return (await q.orderBy("id").execute()) as LooseRow[];
}

const rowText = (row: LooseRow, column: string): string => {
  const value = new Map(Object.entries(row)).get(column);
  return typeof value === "string" ? value : "";
};

describe("the 9 register-kit lists declare exactly the saved-view registry's sorts (ADR-0057 §4, §5)", () => {
  it("RegisterSpec.sortColumns keys equal SAVED_VIEW_LISTS[listKey].sorts; searchColumns are text columns", async () => {
    expect(CASES).toHaveLength(9);
    for (const c of CASES) {
      const spec = specOf(c);
      expect([...spec.sortColumns.keys()].sort(), c.listKey).toEqual([...SAVED_VIEW_LISTS[c.listKey].sorts].sort());
      expect(SAVED_VIEW_LISTS[c.listKey].filters.map((f) => f.key)).toContain("q");
      const types = await sql<{ column_name: string; data_type: string }>`
        SELECT column_name, data_type FROM information_schema.columns WHERE table_name = ${spec.table}`.execute(api.db);
      const typeOf = new Map(types.rows.map((r) => [r.column_name, r.data_type]));
      for (const column of spec.searchColumns) expect(typeOf.get(column), `${c.listKey}.${column}`).toBe("text");
      for (const { column } of spec.sortColumns.values())
        expect(typeOf.has(column), `${c.listKey}.${column}`).toBe(true);
    }
  });
});

describe("register-kit lists: absent parameters return the DG2 response (ADR-0057 §5)", () => {
  it("every page of each of the 9 lists is byte-identical to the DG2 page (id ascending; the DG2 cursor and hash)", async () => {
    for (const c of CASES) {
      const spec = specOf(c);
      const rows = await rowsOf(c);
      expect(rows.length, c.listKey).toBeGreaterThanOrEqual(4);
      const hash = filterHash({ includeArchived: false, parent: c.parent ?? null });
      let cursor: string | null = null;
      for (let offset = 0; offset < rows.length; offset += 2) {
        const pageRows = rows.slice(offset, offset + 2);
        const more = offset + 2 < rows.length;
        const items = spec.present ? await spec.present(api.db, pageRows) : pageRows.map((r) => spec.toApi!(r));
        const expected = JSON.stringify({
          items,
          nextCursor: more ? encodeCursor([String(pageRows[1]!["id"])], hash) : null,
        });
        const res = await get(`${c.path}?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
        expect(res.status).toBe(200);
        expect(res.raw.body, `${c.listKey} offset ${offset}`).toBe(expected);
        cursor = res.body.nextCursor;
      }
      expect(cursor).toBeNull();
    }
  });
});

describe("register-kit lists: each sort key both ways pages through every row (ADR-0057 §5)", () => {
  it("sort=<key> and sort=-<key> on each of the 9 lists: no duplicate, no gap, the database's order", async () => {
    let checked = 0;
    for (const c of CASES) {
      const spec = specOf(c);
      const total = (await rowsOf(c)).length;
      for (const [key, { column }] of spec.sortColumns) {
        for (const dir of ["asc", "desc"] as const) {
          const sort = dir === "asc" ? key : `-${key}`;
          const items = await walk(c, `&sort=${sort}`);
          const ids = items.map((i) => i.id);
          expect(new Set(ids).size, `${c.listKey} ${sort}`).toBe(total);
          expect(ids).toHaveLength(total);
          const nulls = dir === "asc" ? "NULLS LAST" : "NULLS FIRST";
          const expected = await sql<{ id: string }>`
            SELECT id FROM ${sql.table(spec.table)}
             WHERE transformation_id = ${p.transformationId}::uuid AND status <> 'archived'
               ${c.parent ? sql`AND journey_id = ${c.parent}::uuid` : sql``}
             ORDER BY ${sql.ref(column)} ${sql.raw(dir)} ${sql.raw(nulls)}, id ${sql.raw(dir)}`.execute(api.db);
          expect(ids, `${c.listKey} ${sort}`).toEqual(expected.rows.map((r) => r.id));
          checked += 1;
        }
      }
    }
    // 9 lists, 2 to 5 keys each (own keys + status, createdAt, updatedAt), both directions.
    expect(checked).toBe(2 * CASES.reduce((n, c) => n + specOf(c).sortColumns.size, 0));
  });

  it("nulls sort last ascending and first descending (capability dimension, pain-point step, outcome rank)", async () => {
    for (const [listKey, key, field] of [
      ["capability_heatmap", "dimensionCode", "dimensionCode"],
      ["journey_pain_points", "stepKey", "stepKey"],
      ["outcomes", "topRank", "topRank"],
    ] as const) {
      const c = CASES.find((x) => x.listKey === listKey)!;
      for (const dir of ["asc", "desc"] as const) {
        const items = await walk(c, `&sort=${dir === "asc" ? key : `-${key}`}`);
        const isNull = items.map((i) => i[field] === null);
        const firstNull = isNull.indexOf(true);
        expect(firstNull, `${listKey} ${dir}`).toBeGreaterThanOrEqual(0);
        expect(isNull.includes(false), `${listKey} ${dir}`).toBe(true);
        if (dir === "asc") expect(isNull.slice(firstNull).every(Boolean), `${listKey} asc`).toBe(true);
        else expect(isNull.slice(0, isNull.lastIndexOf(true) + 1).every(Boolean), `${listKey} desc`).toBe(true);
      }
    }
  });

  it("includeArchived=true with a sort pages through the archived rows too", async () => {
    for (const c of CASES) {
      const all = await rowsOf(c, true);
      const items = await walk(c, "&includeArchived=true&sort=-updatedAt");
      expect(items.map((i) => i.id).sort(), c.listKey).toEqual(all.map((r) => String(r["id"])).sort());
    }
  });
});

describe("register-kit lists: q over the declared searchColumns (ADR-0057 §5)", () => {
  it("q returns exactly the rows with the substring in a declared column, case-insensitive; % and _ are literal", async () => {
    for (const c of CASES) {
      const spec = specOf(c);
      const rows = await rowsOf(c);
      for (const needle of ["alpha", "ALPHA ONE", "_", "%", "50% three", "zz-no-match"]) {
        const expected = rows
          .filter((r) => spec.searchColumns.some((col) => rowText(r, col).toLowerCase().includes(needle.toLowerCase())))
          .map((r) => String(r["id"]));
        const items = await walk(c, `&q=${encodeURIComponent(needle)}`);
        expect(
          items.map((i) => i.id),
          `${c.listKey} q=${needle}`,
        ).toEqual(expected);
      }
      // The synthetic texts are in a declared column of every list: "alpha" finds both rows, "_" exactly one.
      const alpha = await walk(c, "&q=alpha");
      expect(alpha.length, c.listKey).toBeGreaterThanOrEqual(2);
      // q combines with a sort.
      const sorted = await walk(c, `&q=alpha&sort=-createdAt`);
      expect(sorted.map((i) => i.id).sort()).toEqual(alpha.map((i) => i.id).sort());
    }
  });
});

describe("register-kit lists: refusals (ADR-0057 §5; ADR-0007 §4)", () => {
  const errorOf = (body: unknown) => (body as { errors: { pointer: string; code: string }[] }).errors[0]!;

  it("an unknown sort is 400 at /query/sort; q outside 1-200 characters is 400 at /query/q", async () => {
    for (const c of CASES) {
      for (const sort of ["id", "nope", "-", "--status", "Status", "title:asc"]) {
        if (specOf(c).sortColumns.has(sort)) continue;
        const res = await get(`${c.path}?sort=${encodeURIComponent(sort)}`);
        expect([res.status, errorOf(res.body).pointer], `${c.listKey} ${sort}`).toEqual([400, "/query/sort"]);
      }
      expect(errorOf((await get(`${c.path}?q=`)).body).pointer).toBe("/query/q");
      expect(errorOf((await get(`${c.path}?q=${"x".repeat(201)}`)).body).pointer).toBe("/query/q");
    }
  });

  it("a cursor issued for another filter or sort is 400 at /query/cursor; a malformed keyset is 400", async () => {
    for (const c of CASES) {
      const first = await get(`${c.path}?limit=1&sort=createdAt`);
      const cursor = encodeURIComponent(first.body.nextCursor!);
      for (const other of [
        "&sort=-createdAt",
        "&sort=updatedAt",
        "",
        "&sort=createdAt&q=alpha",
        "&includeArchived=true&sort=createdAt",
      ]) {
        const res = await get(`${c.path}?limit=1${other}&cursor=${cursor}`);
        expect([res.status, errorOf(res.body)], `${c.listKey} ${other}`).toEqual([
          400,
          expect.objectContaining({ pointer: "/query/cursor", code: "validation.cursor" }),
        ]);
      }
      expect((await get(`${c.path}?limit=1&sort=createdAt&cursor=${cursor}`)).status).toBe(200);
      // A DG2 (sort-absent) cursor is refused with a sort.
      const dg2 = await get(`${c.path}?limit=1`);
      expect(
        (await get(`${c.path}?limit=1&sort=status&cursor=${encodeURIComponent(dg2.body.nextCursor!)}`)).status,
      ).toBe(400);
      // Hand-made cursors with the right hash and a malformed keyset never reach a cast.
      const hashFor = (sort: string) => filterHash({ includeArchived: false, parent: c.parent ?? null, sort });
      const id = "01920099-0000-7000-8000-000000000001";
      for (const [sort, keys] of [
        ["createdAt", ["2026-02-31T00:00:00.000000Z", id]],
        ["updatedAt", ["yesterday", id]],
        ["status", [5, id]],
        ["status", ["active", "nope"]],
      ] as const) {
        const bad = encodeCursor(keys as unknown as (string | number | null)[], hashFor(sort));
        const res = await get(`${c.path}?sort=${sort}&cursor=${encodeURIComponent(bad)}`);
        expect([res.status, errorOf(res.body).pointer], `${c.listKey} ${sort} ${JSON.stringify(keys)}`).toEqual([
          400,
          "/query/cursor",
        ]);
      }
    }
    // An integer keyset must be an integer (the outcome's topRank).
    const outcomes = CASES.find((c) => c.listKey === "outcomes")!;
    const bad = encodeCursor(
      ["1", "01920099-0000-7000-8000-000000000001"],
      filterHash({
        includeArchived: false,
        parent: null,
        sort: "topRank",
      }),
    );
    expect((await get(`${outcomes.path}?sort=topRank&cursor=${encodeURIComponent(bad)}`)).status).toBe(400);
  });

  it("the kit registers without searchColumns/sortColumns still refuse q and sort (dependencies, actions, TOM workshops)", async () => {
    for (const path of ["dependencies", "actions", "tom-workshops"]) {
      for (const query of ["q=alpha", "sort=createdAt"]) {
        const res = await get(`${T}/${path}?${query}`);
        expect([res.status, errorOf(res.body).code], `${path}?${query}`).toEqual([400, "validation.unknown_field"]);
      }
      expect((await get(`${T}/${path}`)).status).toBe(200);
    }
  });
});

describe("register-kit lists: read authorization is unchanged (REQ-S15-013 view:scoped)", () => {
  it("AUD lists with q and a sort (200); a user without transformation.read gets 404 with them", async () => {
    const outsider = await createUser(api.db, w.orgA.id);
    const session = await signIn(api.app, outsider.subject);
    for (const c of CASES) {
      const aud = await get(`${c.path}?q=alpha&sort=-updatedAt`, p.auditor.session);
      expect(aud.status, c.listKey).toBe(200);
      expect(aud.body.items.length).toBeGreaterThanOrEqual(2);
      expect((await get(`${c.path}?q=alpha&sort=-updatedAt`, session)).status, c.listKey).toBe(404);
    }
  });
});

describe("listTransformations sort (ADR-0057 §5: -updatedAt, updatedAt, code, -code; the DG1 values kept)", () => {
  // officeB is TO of org B only: the org's transformations are exactly the ones created here.
  let officeB: Awaited<ReturnType<typeof signIn>>;
  let ids: string[];
  beforeAll(async () => {
    officeB = await signIn(api.app, w.officeB.subject);
    ids = [];
    for (let i = 0; i < 9; i += 1) ids.push(await createTransformationRow(api.db, w.orgB.id, w.b1, w.officeB.id));
  });
  const list = (query: string) => get(`/api/v1/transformations?${query}`, officeB);

  async function walkT(query: string): Promise<string[]> {
    const out: string[] = [];
    let cursor: string | null = null;
    do {
      const res = await list(`limit=2${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
      out.push(...res.body.items.map((i) => i.id));
      cursor = res.body.nextCursor;
    } while (cursor !== null);
    return out;
  }
  const dbOrder = async (column: "code" | "updated_at", dir: "asc" | "desc") =>
    (
      await sql<{ id: string }>`SELECT id FROM transformation WHERE organization_id = ${w.orgB.id}::uuid
        ORDER BY ${sql.ref(column)} ${sql.raw(dir)}, id ${sql.raw(dir)}`.execute(api.db)
    ).rows.map((r) => r.id);

  it("sort absent: every page is byte-identical to the DG1 page (updatedAt:desc; the DG1 cursor and hash)", async () => {
    const rows = await sql<LooseRow & { sort_key: string }>`
      SELECT t.*, to_char(t.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS sort_key
        FROM transformation t WHERE t.organization_id = ${w.orgB.id}::uuid AND t.archived_at IS NULL
       ORDER BY t.updated_at desc, t.id desc`.execute(api.db);
    expect(rows.rows).toHaveLength(9);
    const hash = filterHash({ includeArchived: false, sort: "updatedAt:desc" });
    let cursor: string | null = null;
    for (let offset = 0; offset < 9; offset += 2) {
      const page = rows.rows.slice(offset, offset + 2);
      const last = page[page.length - 1]!;
      const expected = JSON.stringify({
        items: page.map(({ sort_key: _k, ...r }) => toTransformation(r as never)),
        nextCursor: offset + 2 < 9 ? encodeCursor([last.sort_key, String(last["id"])], hash) : null,
      });
      const res = await list(`limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      expect(res.raw.body, `offset ${offset}`).toBe(expected);
      cursor = res.body.nextCursor;
    }
  });

  it("each ADR-0057 sort pages all rows in the database's order; it orders as its DG1 twin", async () => {
    for (const [sort, twin, column, dir] of [
      ["-updatedAt", "updatedAt:desc", "updated_at", "desc"],
      ["updatedAt", "updatedAt:asc", "updated_at", "asc"],
      ["code", "code:asc", "code", "asc"],
      ["-code", "code:desc", "code", "desc"],
    ] as const) {
      const got = await walkT(`&sort=${encodeURIComponent(sort)}`);
      expect(got, sort).toEqual(await dbOrder(column, dir));
      expect(new Set(got).size).toBe(9);
      expect(await walkT(`&sort=${encodeURIComponent(twin)}`), twin).toEqual(got);
    }
  });

  it("the cursor is bound to the spelling sent; unknown sorts are 400 at /query/sort; malformed keysets 400", async () => {
    const first = await list("limit=2&sort=code");
    const res = await list(`limit=2&sort=code:asc&cursor=${encodeURIComponent(first.body.nextCursor!)}`);
    expect([res.status, (res.body as unknown as { errors: { pointer: string }[] }).errors[0]!.pointer]).toEqual([
      400,
      "/query/cursor",
    ]);
    for (const sort of ["name", "-name", "status", "code:sideways", "-updatedAt:desc"]) {
      const bad = await list(`sort=${encodeURIComponent(sort)}`);
      expect([bad.status, (bad.body as unknown as { errors: { pointer: string }[] }).errors[0]!.pointer], sort).toEqual(
        [400, "/query/sort"],
      );
    }
    // DG1 name sorts stay.
    expect((await list("sort=name:asc")).status).toBe(200);
    const hash = (sort: string) => filterHash({ includeArchived: false, sort });
    for (const [sort, keys] of [
      ["-updatedAt", ["2026-02-31T00:00:00.000000Z", ids[0]!]],
      ["updatedAt:desc", ["not a time", ids[0]!]],
      ["code", ["TX1", "not-a-uuid"]],
      ["code", [3, ids[0]!]],
    ] as const) {
      const cursor = encodeCursor(keys as unknown as (string | number | null)[], hash(sort));
      const bad = await list(`sort=${encodeURIComponent(sort)}&cursor=${encodeURIComponent(cursor)}`);
      expect(bad.status, `${sort} ${JSON.stringify(keys)}`).toBe(400);
    }
  });
});
