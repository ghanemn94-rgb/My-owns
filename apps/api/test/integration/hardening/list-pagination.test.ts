// T-DG6-BE-V (p6-work-split §D.5; ADR-0007 §4/§4a, D-199, D-200 item 2): the 17 list operations that had no bound are
// cursor-paginated `{ items, nextCursor }` with `cursor` and `limit` (default 25, maximum 100). For each list this
// test checks: the answer carries `nextCursor`; walking it one item per page returns exactly the whole list in the same
// stable order (which ends with the identifier), so a second page continues the first; a tampered cursor, a cursor of
// another list and a cursor of another parent answer 400 `validation.cursor`; `limit` outside 1-100 is a 400. Where a
// list's sort has a NULL, descending or microsecond-precision key, the data has rows that exercise it. All data is
// SYNTHETIC; nothing here grants a business approval or touches the engineering gates DG0-DG7.
import { insertAuditEvent, type Db } from "@mth/db";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, seedWorld, startApi, type Session, type TestApi, type World } from "../../support/harness.ts";
import {
  insertInitiative,
  insertMilestone,
  linkDecision,
  newDecision,
  seedExecutionWorld,
  type ExecWorld,
} from "../portfolio/execution-fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

let api: TestApi;
let w: World;
let x: ExecWorld;
let tl: Session;
const send = (method: string, url: string, opts: Parameters<typeof call>[3] = {}) =>
  call<Body>(api.app, method, url, opts);

/** One transformation-scoped row with its audit event (the P2 audit guard demands one), as the TL. */
async function audited(db: Db, table: string, values: Record<string, unknown>): Promise<string> {
  const id = uuidv7();
  const by = x.users.tl.id;
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto(table as never)
      .values({
        id,
        organization_id: x.organizationId,
        transformation_id: x.transformationId,
        created_by: by,
        updated_by: by,
        ...values,
      } as never)
      .execute();
    await insertAuditEvent(
      tx,
      { actorType: "user", actorUserId: by, requestId: `fixture-${id}`, source: "api" },
      {
        action: `${table}.create`,
        recordType: table,
        recordId: id,
        organizationId: x.organizationId,
        transformationId: x.transformationId,
        newVersion: 1,
      },
    );
  });
  return id;
}

const withQuery = (url: string, q: Record<string, string>) =>
  `${url}${url.includes("?") ? "&" : "?"}${new URLSearchParams(q).toString()}`;

/** Every page at `limit`, asserting each answer is 200 and carries `nextCursor`. */
async function walk(url: string, limit: number, session: Session = tl): Promise<{ items: Body[]; pages: number }> {
  const items: Body[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const res = await send("GET", withQuery(url, { limit: String(limit), ...(cursor ? { cursor } : {}) }), { session });
    expect([url, res.status], JSON.stringify(res.body)).toEqual([url, 200]);
    expect(Object.keys(res.body), url).toContain("nextCursor");
    expect(res.body.items.length, url).toBeLessThanOrEqual(limit);
    items.push(...res.body.items);
    cursor = res.body.nextCursor;
    pages += 1;
    expect(pages, `${url} does not end`).toBeLessThan(200);
  } while (cursor !== null);
  return { items, pages };
}

/** The first page's cursor at limit 1 (the list must have at least two items). */
async function firstCursor(url: string, session: Session = tl): Promise<string> {
  const res = await send("GET", withQuery(url, { limit: "1" }), { session });
  expect([url, res.status]).toEqual([url, 200]);
  expect(typeof res.body.nextCursor, `${url} has a second page`).toBe("string");
  return res.body.nextCursor as string;
}

/** A cursor with the same hash but a key value of the wrong type (a forged value must not reach SQL as a 500). */
function tampered(cursor: string): string {
  const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { k: unknown[]; h: string };
  const forged = { k: parsed.k.map(() => "x'); select 1; --"), h: parsed.h };
  return Buffer.from(JSON.stringify(forged), "utf8").toString("base64url");
}

async function expectCursor400(url: string, cursor: string, session: Session = tl): Promise<void> {
  const res = await send("GET", withQuery(url, { cursor }), { session });
  expect([url, res.status, res.body.errors?.[0]?.code]).toEqual([url, 400, "validation.cursor"]);
}

/**
 * The paging contract of one list with at least `min` items: the walk at limit 1 equals the full answer at limit 100
 * (same items, same order, no duplicate), a tampered cursor and a cursor from `foreign` are 400.
 */
async function checkList(
  url: string,
  idOf: (item: Body) => string,
  min: number,
  foreign: string,
  session: Session = tl,
): Promise<Body[]> {
  const whole = await walk(url, 100, session);
  expect(whole.pages, url).toBe(1);
  expect(whole.items.length, url).toBeGreaterThanOrEqual(min);
  const stepped = await walk(url, 1, session);
  expect(stepped.items.map(idOf), url).toEqual(whole.items.map(idOf));
  expect(new Set(stepped.items.map(idOf)).size, url).toBe(stepped.items.length);
  expect(stepped.pages, url).toBe(whole.items.length);
  const cursor = await firstCursor(url, session);
  await expectCursor400(url, tampered(cursor), session);
  await expectCursor400(url, foreign, session);
  await expectCursor400(url, "not base64url json", session);
  for (const limit of ["0", "101", "x"]) {
    const res = await send("GET", withQuery(url, { limit }), { session });
    expect([url, limit, res.status]).toEqual([url, limit, 400]);
  }
  return whole.items;
}

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  x = await seedExecutionWorld(api, w);
  tl = x.s.tl;
}, 120_000);
afterAll(() => api.close());

describe("T-DG6-BE-V: the 17 formerly unbounded lists are cursor-paginated (ADR-0007 §4a, D-199)", () => {
  it("initiative children: milestones (NULL forecast last), deliverables (countWarning over the whole list), links", async () => {
    const ini = await insertInitiative(api.db, x, "INI-01");
    const other = await insertInitiative(api.db, x, "INI-02");
    // Same forecast date twice (the id breaks the tie), an earlier one, and one without a date (sorted last).
    const m = [
      await insertMilestone(api.db, x, ini, null, "2026-12-01", "Synthetic M1"),
      await insertMilestone(api.db, x, ini, null, null, "Synthetic M2 undated"),
      await insertMilestone(api.db, x, ini, null, "2026-12-01", "Synthetic M3"),
      await insertMilestone(api.db, x, ini, null, "2026-11-01", "Synthetic M4"),
    ];
    await insertMilestone(api.db, x, other, null, "2026-11-15", "Synthetic other");
    const I = `/api/v1/initiatives/${ini}`;
    const O = `/api/v1/initiatives/${other}`;
    const otherMilestoneCursor = await (async () => {
      await insertMilestone(api.db, x, other, null, "2026-11-20", "Synthetic other 2");
      return firstCursor(`${O}/milestones`);
    })();
    const milestones = await checkList(`${I}/milestones`, (r) => r.id, 4, otherMilestoneCursor);
    const sameDay = [m[0]!, m[2]!].sort();
    expect(milestones.map((r: Body) => r.id)).toEqual([m[3], ...sameDay, m[1]]);

    // Three active deliverables: inside 3-7, so no warning, even on a page of one (the count is the whole list's).
    for (const title of ["Synthetic D1", "Synthetic D2", "Synthetic D3"])
      await audited(api.db, "deliverable", { initiative_id: ini, title });
    const deliverables = await checkList(`${I}/deliverables`, (r) => r.id, 3, otherMilestoneCursor);
    expect(deliverables.map((r: Body) => r.ordinal)).toEqual([...deliverables.map((r: Body) => r.ordinal)].sort());
    const onePage = await send("GET", `${I}/deliverables?limit=1`, { session: tl });
    expect([onePage.body.items.length, onePage.body.countWarning]).toEqual([1, null]);
    await audited(api.db, "deliverable", { initiative_id: other, title: "Synthetic lone deliverable" });
    const lone = await send("GET", `${O}/deliverables?limit=1`, { session: tl });
    expect(lone.body.countWarning?.code).toBe("initiative.deliverable_count");

    // Decision links (the gap-link and outcome-contribution lists share this route code; see below for their shape).
    for (const title of ["Synthetic decision A", "Synthetic decision B", "Synthetic decision C"])
      await linkDecision(api.db, x, ini, await newDecision(send, x, title));
    const links = await checkList(`${I}/decision-links`, (r) => r.id, 3, otherMilestoneCursor);
    // created_at keeps microseconds through the cursor (a JS Date would cut them and repeat or skip rows).
    const stamps = await api.db
      .selectFrom("initiative_decision_link")
      .select(["id"])
      .where("initiative_id", "=", ini)
      .orderBy("created_at")
      .orderBy("id")
      .execute();
    expect(links.map((r: Body) => r.id)).toEqual(stamps.map((r) => r.id));
    const linkCursor = await firstCursor(`${I}/decision-links`);
    // A cursor of the same list for another initiative, and of the same initiative with other filters, are refused.
    await linkDecision(api.db, x, other, await newDecision(send, x, "Synthetic decision O1"));
    await linkDecision(api.db, x, other, await newDecision(send, x, "Synthetic decision O2"));
    await expectCursor400(`${I}/decision-links`, await firstCursor(`${O}/decision-links`));
    await expectCursor400(`${I}/decision-links?includeArchived=true`, linkCursor);
    for (const part of ["gap-links", "outcome-contributions"]) {
      const res = await send("GET", `${I}/${part}`, { session: tl });
      expect([part, res.status, res.body.items, res.body.nextCursor]).toEqual([part, 200, [], null]);
      await expectCursor400(`${I}/${part}`, linkCursor);
      await expectCursor400(`${I}/${part}`, tampered(linkCursor));
    }
  });

  it("transformation lists: waves, resource roles, weight sets (newest first), workshop participants", async () => {
    const T = `/api/v1/transformations/${x.transformationId}`;
    const wave = (code: string, ordinal: number) => ({
      code,
      ordinal,
      name_en: `Synthetic ${code}`,
      name_ar: `موجة ${code}`,
      purpose_en: "Synthetic purpose",
      purpose_ar: "غرض",
      horizon_en: "Synthetic horizon",
      horizon_ar: "أفق",
      entry_criteria_en: "Synthetic entry",
      entry_criteria_ar: "دخول",
      exit_evidence_en: "Synthetic exit",
      exit_evidence_ar: "خروج",
      horizon_from_weeks: ordinal,
      horizon_to_weeks: ordinal + 4,
    });
    for (const [code, ordinal] of [
      ["w_b", 2],
      ["w_a", 1],
      ["w_c", 3],
    ] as const)
      await audited(api.db, "roadmap_wave", wave(code, ordinal));
    for (const code of ["role_b", "role_a", "role_c"])
      await audited(api.db, "resource_role", { code, label_en: `Synthetic ${code}`, label_ar: `دور ${code}` });

    const other = await seedExecutionWorld(api, w);
    const otherWaves = `/api/v1/transformations/${other.transformationId}/waves`;
    const prior = x;
    x = other;
    await audited(api.db, "roadmap_wave", wave("w_x", 1));
    await audited(api.db, "roadmap_wave", wave("w_y", 2));
    x = prior;
    const foreign = await firstCursor(otherWaves, other.s.tl);

    const waves = await checkList(`${T}/waves`, (r) => r.id, 3, foreign);
    expect(waves.map((r: Body) => r.ordinal)).toEqual([...waves.map((r: Body) => r.ordinal)].sort((a, b) => a - b));
    const roles = await checkList(`${T}/resource-roles`, (r) => r.id, 3, foreign);
    expect(roles.map((r: Body) => r.code)).toEqual(["role_a", "role_b", "role_c"]);

    const weights = [
      { criterionCode: "strategic_fit", weightPercent: "15" },
      { criterionCode: "financial_value", weightPercent: "25" },
      { criterionCode: "customer_impact", weightPercent: "20" },
      { criterionCode: "feasibility", weightPercent: "15" },
      { criterionCode: "time_to_value", weightPercent: "15" },
      { criterionCode: "risk_compliance", weightPercent: "10" },
    ];
    for (let i = 0; i < 2; i++) {
      const res = await send("POST", `${T}/prioritization/weight-sets`, {
        session: tl,
        body: { rationale: `Synthetic proposal ${i + 1}; approves nothing real.`, weights },
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    }
    const sets = await checkList(`${T}/prioritization/weight-sets`, (r) => String(r.versionNo), 2, foreign);
    const nos = sets.map((r: Body) => r.versionNo as number);
    expect(nos).toEqual([...nos].sort((a, b) => b - a));

    const facilitator = x.users.tl.id;
    const workshop = await audited(api.db, "tom_workshop", {
      title: "Synthetic TOM workshop",
      workshop_date: "2026-11-02",
      duration_minutes: 90,
      facilitator_user_id: facilitator,
    });
    for (const u of [x.users.tl, x.users.wl, x.users.to, x.users.bo])
      await audited(api.db, "tom_workshop_participant", { workshop_id: workshop, user_id: u.id });
    const participants = await checkList(`${T}/tom-workshops/${workshop}/participants`, (r) => r.id, 4, foreign);
    const ids = participants.map((r: Body) => r.id as string);
    expect(ids).toEqual([...ids].sort());
  });

  it("benefit formula versions: newest first across pages", async () => {
    const created = await send("POST", "/api/v1/benefit-formulas", {
      session: tl,
      body: {
        transformationId: x.transformationId,
        benefitName: "Synthetic revenue uplift",
        fromExample: "revenue_uplift",
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    let f = created.body;
    for (let i = 0; i < 2; i++) {
      const variables = (f.currentVersion.variables as Body[]).map((v, j) => {
        const out = Object.fromEntries(
          Object.entries(v).filter(
            ([k, val]) =>
              ["name", "kind", "unit", "currency", "period", "value", "description", "source"].includes(k) &&
              val !== null,
          ),
        );
        return j === 0 && typeof out["value"] === "string" ? { ...out, value: String(Number(out["value"]) + 1) } : out;
      });
      const v = await send("POST", `/api/v1/benefit-formulas/${f.id}/versions`, {
        session: tl,
        headers: { "if-match": `"${f.version}"` },
        body: { expression: f.currentVersion.expression, variables, changeNote: `Synthetic change ${i + 1}` },
      });
      expect(v.status, JSON.stringify(v.body)).toBe(201);
      f = (await send("GET", `/api/v1/benefit-formulas/${f.id}`, { session: tl })).body;
    }
    const foreign = await firstCursor("/api/v1/dependency-types");
    const versions = await checkList(
      `/api/v1/benefit-formulas/${f.id}/versions`,
      (r) => String(r.versionNo),
      3,
      foreign,
    );
    expect(versions.map((r: Body) => r.versionNo)).toEqual([3, 2, 1]);

    // Business case lines (creation time, then id), through the DG3 routes.
    const kase = await send("POST", "/api/v1/business-cases", {
      session: tl,
      body: { transformationId: x.transformationId, level: "transformation", title: "Synthetic case" },
    });
    expect(kase.status, JSON.stringify(kase.body)).toBe(201);
    const L = `/api/v1/business-cases/${kase.body.id}/lines`;
    for (const title of ["Synthetic line 1", "Synthetic line 2", "Synthetic line 3"]) {
      const line = await send("POST", L, {
        session: tl,
        body: { lineKind: "investment", class: "capex", valueBasis: "cash", title, amount: "40000", currency: "SAR" },
      });
      expect(line.status, JSON.stringify(line.body)).toBe(201);
    }
    const lines = await checkList(L, (r) => r.id, 3, foreign);
    expect(lines.map((r: Body) => r.title)).toEqual(["Synthetic line 1", "Synthetic line 2", "Synthetic line 3"]);
    // The filters are bound into the cursor: a cursor issued with includeArchived=true is refused without it.
    await expectCursor400(L, await firstCursor(`${L}?includeArchived=true`));
  });

  it("catalogues: dependency types, health-check schemes, approval routes, template source links", async () => {
    // A cursor of another list (an initiative's milestones), made here so this case stands alone.
    const ini = await insertInitiative(api.db, x, "INI-11");
    await insertMilestone(api.db, x, ini, null, "2026-11-01", "Synthetic C1");
    await insertMilestone(api.db, x, ini, null, "2026-11-02", "Synthetic C2");
    const foreign = await firstCursor(`/api/v1/initiatives/${ini}/milestones`);
    const types = await checkList("/api/v1/dependency-types", (r) => r.code, 5, foreign);
    const keys = types.map((r: Body) => `${String(r.ordinal).padStart(6, "0")}|${r.code}`);
    expect(keys).toEqual([...keys].sort());

    // One published scheme at a fresh database: one page, no next cursor; foreign and forged cursors are refused.
    const schemes = await walk("/api/v1/admin/health-check-schemes", 1);
    expect(schemes.items.length).toBeGreaterThanOrEqual(1);
    await expectCursor400("/api/v1/admin/health-check-schemes", foreign);
    await expectCursor400("/api/v1/admin/health-check-schemes", "not base64url json");

    // methodology.read: whichever seeded role holds it reads the routes.
    let admin = tl;
    for (const s of [tl, x.s.admin, x.s.auditor])
      if ((await send("GET", "/api/v1/admin/approval-routes", { session: s })).status === 200) {
        admin = s;
        break;
      }
    // A fresh database's methodology has no approver_route element: the resolved list is empty, one page. Its paging
    // over a longer resolved list is the `memoryPage` unit test (platform/cursor.test.ts).
    const routes = await walk("/api/v1/admin/approval-routes", 1, admin);
    expect(routes.pages).toBe(1);
    await expectCursor400("/api/v1/admin/approval-routes", foreign, admin);
    await expectCursor400("/api/v1/admin/approval-routes", "not base64url json", admin);

    // The template with the most source blocks (the seeded playbook links several blocks to some templates).
    let best = { code: "T01", n: 0 };
    const counts = new Map<string, number>();
    for (let i = 1; i <= 16; i++) {
      const code = `T${String(i).padStart(2, "0")}`;
      const res = await send("GET", `/api/v1/methodology/templates/${code}/source-links?limit=100`, { session: tl });
      expect([code, res.status, res.body.nextCursor]).toEqual([code, 200, null]);
      counts.set(code, res.body.items.length);
      if (res.body.items.length > best.n) best = { code, n: res.body.items.length };
    }
    expect(best.n).toBeGreaterThanOrEqual(2);
    // Every template, with or without linked blocks, checks the cursor it is given.
    for (const code of counts.keys())
      await expectCursor400(`/api/v1/methodology/templates/${code}/source-links`, foreign);
    const links = await checkList(
      `/api/v1/methodology/templates/${best.code}/source-links`,
      (r) => r.blockRef,
      2,
      foreign,
    );
    const ordinals = links.map((r: Body) => r.ordinal as number);
    expect(ordinals).toEqual([...ordinals].sort((a, b) => a - b));
  });
});
