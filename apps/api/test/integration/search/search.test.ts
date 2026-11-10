// searchRecords and getSearchIndexStatus (ADR-0057 §2, §3, §10; REQ-S15-010; T-DG6-BE-P2; p6-work-split §H/G.2),
// against a scratch database of the run's disposable PostgreSQL, indexed by the REAL worker jobs (T-DG6-BE-P). Proves:
//  - A12 (REQ-S15-010 acceptance): a user scoped to transformation X searching a term present in X and Y gets only X's
//    hits, for all 12 record types; the same for Y; an organization-level reader gets both; another organization none;
//  - permission is decided at query time: a sensitive-record grant revoked after indexing hides the hit on the next
//    request (and a grant given after indexing shows it); a removed assignment applies to the next request; AUD gets
//    its scoped hits but no sensitive record; a named party sees its sensitive record;
//  - English stemming, an Arabic query, a code query; recordType, transformationId and includeArchived filters;
//  - q of 1 character (after trimming) -> 400 search.query_too_short; blank, over 200, U+0000 -> 400;
//  - stale is true while a type is reindexing or failed, or the feed is > 120 s behind (or never ran: Unknown);
//    indexedThrough is the oldest; every requested type failed -> 503 search.index_unavailable;
//  - the cursor pages with no duplicate and no gap and is bound to q and the filters (a foreign cursor -> 400);
//  - 401 / 403; the rate-limit class `search` answers 429; a search writes nothing (no audit event);
//  - getSearchIndexStatus: the 12 states in order (documentsCount null = Unknown until a reindex counts), operations.read.
// All data is SYNTHETIC; searching approves nothing (G1-G6) and nothing here touches DG0-DG7.
import { sql } from "@mth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SEARCH_RECORD_TYPES } from "../../../src/modules/search/query.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import {
  auditCount,
  call,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type World,
} from "../../support/harness.ts";
import type { BenefitWorld } from "../benefits/fixtures.ts";
import {
  searchAll,
  searchUrl,
  seedTwelve,
  startSearchDb,
  updateWithAudit,
  type FixtureRecord,
  type SearchDb,
} from "./search-fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

let s: SearchDb;
let w: World;
let X: { b: BenefitWorld; records: FixtureRecord[] };
let Y: { b: BenefitWorld; records: FixtureRecord[] };
let auditor: Session;
let office: Session;
let officeB: Session;
let nobody: Session;
let admin: Session;

const keyOf = (h: { recordType: string; recordId: string }) => `${h.recordType}:${h.recordId}`;
const keysOf = (rs: readonly { type: string; id: string }[]) => rs.map((r) => `${r.type}:${r.id}`).sort();
const hitKeys = (items: Body[]) => items.map(keyOf).sort();

beforeAll(async () => {
  s = await startSearchDb("mth_be_p2_search");
  w = await seedWorld(s.db);
  X = await seedTwelve(s.api, w, "quokka");
  Y = await seedTwelve(s.api, w, "quokka");
  auditor = await signIn(s.api.app, w.auditor.subject);
  office = await signIn(s.api.app, w.office.subject);
  officeB = await signIn(s.api.app, w.officeB.subject);
  nobody = await signIn(s.api.app, w.nobody.subject);
  admin = await signIn(s.api.app, w.admin.subject);
  await s.reindex();
  await s.feed();
}, 300_000);
afterAll(async () => {
  await s?.close();
}, 60_000);

describe("A12: a user scoped to transformation X never receives a record of Y (REQ-S15-010)", () => {
  it("X's lead gets exactly X's 12 records; Y's lead exactly Y's; both share the term", async () => {
    const xHits = await searchAll(s.api, X.b.s.tl, "quokka");
    expect(hitKeys(xHits)).toEqual(keysOf(X.records));
    expect(new Set(xHits.map((h: Body) => h.transformationId))).toEqual(new Set([X.b.transformationId]));
    expect(new Set(xHits.map((h: Body) => h.recordType))).toEqual(new Set(SEARCH_RECORD_TYPES));
    const yHits = await searchAll(s.api, Y.b.s.bo, "quokka");
    // Y's business owner: the 12 of Y (the benefit is not sensitive, so no party rule is involved).
    expect(hitKeys(yHits)).toEqual(keysOf(Y.records));
    // Asking for Y's transformation explicitly as X's lead: an empty page, not a 403 or 404 (contract).
    const forced = await call<Body>(s.api.app, "GET", searchUrl("quokka", { transformationId: Y.b.transformationId }), {
      session: X.b.s.tl,
    });
    expect([forced.status, forced.body.items]).toEqual([200, []]);
  });

  it("an organization-level reader (TO @ A) gets both; a reader of another organization gets none", async () => {
    expect(hitKeys(await searchAll(s.api, office, "quokka"))).toEqual(keysOf([...X.records, ...Y.records]));
    expect(await searchAll(s.api, officeB, "quokka")).toEqual([]);
  });

  it("a hit carries the transformation's code and name and only the indexed columns (no value)", async () => {
    const [hit] = await searchAll(s.api, X.b.s.tl, "quokka", { recordType: "benefit" });
    const t = await s.db
      .selectFrom("transformation")
      .select(["code", "name"])
      .where("id", "=", X.b.transformationId)
      .executeTakeFirstOrThrow();
    const benefit = X.records.find((r) => r.type === "benefit")!;
    expect(Object.keys(hit).sort()).toEqual(
      [
        "code",
        "isArchived",
        "recordId",
        "recordStatus",
        "recordType",
        "recordVersion",
        "summary",
        "title",
        "transformationCode",
        "transformationId",
        "transformationName",
      ].sort(),
    );
    expect(hit).toMatchObject({
      recordType: "benefit",
      recordId: benefit.id,
      title: benefit.title,
      transformationCode: t.code,
      transformationName: t.name,
      isArchived: false,
    });
  });
});

describe("permission at query time (ADR-0057 §3; ADR-0051 §2)", () => {
  it("a sensitive benefit: hidden from a member without a grant, shown after a grant, hidden again on the request after revocation", async () => {
    const T = X.b.transformationId;
    const benefit = X.records.find((r) => r.type === "benefit")!;
    const td = await createUser(s.db, w.orgA.id);
    await grant(s.db, w.grantor.id, td.id, "TD", { type: "transformation", id: T }, w.orgA.id);
    const tdS = await signIn(s.api.app, td.subject);
    const sees = async (session: Session) =>
      (await searchAll(s.api, session, benefit.title, { recordType: "benefit" })).some(
        (h: Body) => h.recordId === benefit.id,
      );
    expect(await sees(tdS)).toBe(true); // not sensitive yet
    const marked = await call<Body>(s.api.app, "PUT", `${X.b.base}/records/benefit/${benefit.id}/sensitivity`, {
      session: office,
      headers: ifm(0),
      body: { isSensitive: true, reason: "Synthetic search fixture" },
    });
    expect(marked.status, JSON.stringify(marked.body)).toBe(200);
    // No reindex in between: nothing about permissions is in the document.
    expect(await sees(tdS)).toBe(false);
    expect(await sees(auditor)).toBe(false); // AUD alone admits nothing
    expect(await sees(X.b.s.bo)).toBe(true); // the owner is a named party
    expect(await sees(office)).toBe(true); // sensitive_record.grant at scope
    const g = await call<Body>(s.api.app, "POST", "/api/v1/admin/sensitive-grants", {
      session: office,
      body: {
        transformationId: T,
        recordType: "benefit",
        recordId: benefit.id,
        granteeUserId: td.id,
        reason: "Synthetic search grant",
      },
    });
    expect(g.status, JSON.stringify(g.body)).toBe(201);
    expect(await sees(tdS)).toBe(true);
    const r = await call<Body>(s.api.app, "POST", `/api/v1/admin/sensitive-grants/${g.body.id}/revoke`, {
      session: office,
      headers: ifm(1),
      body: { reason: "Synthetic search revocation" },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await sees(tdS)).toBe(false);
    // The record GET agrees at each step's end state (the parity rule; the full matrix is search-parity.test.ts).
    expect((await call(s.api.app, "GET", benefit.viewUrl, { session: tdS })).status).toBe(404);
    // Restore: unmark (the remaining tests read the benefit as non-sensitive).
    const cur = await s.db
      .selectFrom("record_sensitivity")
      .select("version")
      .where("record_id", "=", benefit.id)
      .executeTakeFirstOrThrow();
    const un = await call<Body>(s.api.app, "PUT", `${X.b.base}/records/benefit/${benefit.id}/sensitivity`, {
      session: office,
      headers: ifm(cur.version),
      body: { isSensitive: false, reason: "Synthetic search fixture restored" },
    });
    expect(un.status, JSON.stringify(un.body)).toBe(200);
    expect(await sees(tdS)).toBe(true);
  });

  it("a removed assignment applies to the next request (no scope is cached)", async () => {
    const u = await createUser(s.db, w.orgA.id);
    await grant(s.db, w.grantor.id, u.id, "TD", { type: "transformation", id: X.b.transformationId }, w.orgA.id);
    await grant(s.db, w.grantor.id, u.id, "TD", { type: "transformation", id: Y.b.transformationId }, w.orgA.id);
    const us = await signIn(s.api.app, u.subject);
    expect(hitKeys(await searchAll(s.api, us, "quokka"))).toEqual(keysOf([...X.records, ...Y.records]));
    await s.api.owner.query(
      `update scoped_assignment set revoked_at = now(), revoked_by = $1, revoke_reason = 'synthetic search fixture'
        where user_id = $2 and scope_type = 'transformation' and scope_id = $3`,
      [w.grantor.id, u.id, X.b.transformationId],
    );
    expect(hitKeys(await searchAll(s.api, us, "quokka"))).toEqual(keysOf(Y.records));
  });

  it("AUD gets its scoped hits (organization A: X and Y), read-only", async () => {
    expect(hitKeys(await searchAll(s.api, auditor, "quokka"))).toEqual(keysOf([...X.records, ...Y.records]));
  });

  it("401 without a session; 403 without transformation.read anywhere; a search writes nothing", async () => {
    const before = await auditCount(s.db);
    expect((await call(s.api.app, "GET", searchUrl("quokka"))).status).toBe(401);
    const denied = await call<Body>(s.api.app, "GET", searchUrl("quokka"), { session: nobody });
    expect([denied.status, denied.body.code]).toEqual([403, "forbidden"]);
    await searchAll(s.api, office, "quokka");
    expect(await auditCount(s.db)).toBe(before);
  });
});

describe("matching (ADR-0057 §1, §3)", () => {
  it("English stemming: 'initiatives' finds the initiative titled 'initiative'", async () => {
    const ini = X.records.find((r) => r.type === "initiative")!;
    const hits = await searchAll(s.api, X.b.s.tl, "quokka initiatives");
    expect(hits.map(keyOf)).toContain(`initiative:${ini.id}`);
  });

  it("an Arabic query finds an Arabic title; a code query finds the code", async () => {
    const dec = X.records.find((r) => r.type === "decision")!;
    await updateWithAudit(s.db, "decision", dec.id, { title: "مبادرات تحسين تجربة العملاء" }, X.b.users.tl.id, X.b);
    await s.feed();
    const ar = await searchAll(s.api, X.b.s.tl, "تحسين");
    expect(ar.map(keyOf)).toEqual([`decision:${dec.id}`]);
    expect(ar[0].title).toBe("مبادرات تحسين تجربة العملاء");
    const ini = X.records.find((r) => r.type === "initiative")!;
    const { code } = await s.db
      .selectFrom("initiative")
      .select("code")
      .where("id", "=", ini.id)
      .executeTakeFirstOrThrow();
    const byCode = await searchAll(s.api, X.b.s.tl, code.toLowerCase());
    expect(byCode.map(keyOf)).toContain(`initiative:${ini.id}`);
    expect(byCode.find((h: Body) => h.recordId === ini.id).code).toBe(code);
  });

  it("recordType (repeatable) and transformationId filter; includeArchived shows archived records only when asked", async () => {
    const two = await searchAll(s.api, office, "quokka", { recordType: ["lesson", "raid_entry"] });
    expect(hitKeys(two)).toEqual(
      keysOf([...X.records, ...Y.records].filter((r) => r.type === "lesson" || r.type === "raid_entry")),
    );
    const onlyY = await searchAll(s.api, office, "quokka", { transformationId: Y.b.transformationId });
    expect(hitKeys(onlyY)).toEqual(keysOf(Y.records));
    // Withdraw X's change request (ADR-0057 §1: a change request is archived at `withdrawn`).
    const cr = X.records.find((r) => r.type === "change_request")!;
    await updateWithAudit(
      s.db,
      "change_request",
      cr.id,
      { status: "withdrawn", withdrawn_at: new Date().toISOString() },
      X.b.users.tl.id,
      X.b,
    );
    await s.feed();
    const shown = (items: Body[]) => items.some((h: Body) => h.recordId === cr.id);
    expect(shown(await searchAll(s.api, X.b.s.tl, "quokka"))).toBe(false);
    const withArchived = await searchAll(s.api, X.b.s.tl, "quokka", { includeArchived: "true" });
    expect(shown(withArchived)).toBe(true);
    expect(withArchived.find((h: Body) => h.recordId === cr.id)).toMatchObject({
      isArchived: true,
      recordStatus: "withdrawn",
    });
  });
});

describe("the query parameter (ADR-0057 §3, §10; ADR-0052 §2)", () => {
  it("1 character after trimming -> 400 search.query_too_short with the exact text", async () => {
    for (const q of ["a", "  a  ", "ب", "😀"]) {
      const res = await call<Body>(s.api.app, "GET", searchUrl(q), { session: office });
      expect([res.status, res.body.code], q).toEqual([400, "search.query_too_short"]);
      expect(res.body.detail).toBe("Enter at least 2 characters to search.");
      expect(res.body.errors).toEqual([
        { pointer: "/query/q", code: "search.query_too_short", message: "Enter at least 2 characters to search." },
      ]);
    }
    expect((await call(s.api.app, "GET", searchUrl("ab"), { session: office })).status).toBe(200);
  });

  it("blank, missing, over 200 characters, U+0000, an unknown type or parameter -> 400 (before authorization)", async () => {
    const bad = [
      searchUrl("   "),
      "/api/v1/search",
      searchUrl("x".repeat(201)),
      searchUrl("ab\u0000cd"),
      searchUrl("quokka", { recordType: "budget" }),
      searchUrl("quokka", { transformationId: "x" }),
      `${searchUrl("quokka")}&sort=title`,
    ];
    for (const url of bad) {
      expect((await call(s.api.app, "GET", url, { session: office })).status, url).toBe(400);
      expect((await call(s.api.app, "GET", url, { session: nobody })).status, url).toBe(400);
    }
    expect((await call(s.api.app, "GET", searchUrl("x".repeat(200)), { session: office })).status).toBe(200);
  });
});

describe("the cursor (ADR-0007; ADR-0057 §3)", () => {
  it("pages through every hit with no duplicate and no gap, in the same order as one page", async () => {
    const all = await searchAll(s.api, office, "quokka");
    const paged: Body[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 100; i += 1) {
      const res = await call<Body>(s.api.app, "GET", searchUrl("quokka", { limit: "5", cursor }), { session: office });
      expect(res.status).toBe(200);
      paged.push(...res.body.items);
      if (res.body.nextCursor === null) break;
      cursor = res.body.nextCursor;
    }
    expect(paged.map(keyOf)).toEqual(all.map(keyOf));
    expect(new Set(paged.map(keyOf)).size).toBe(paged.length);
  });

  it("a cursor of another query or other filters, or a forged one, is 400 validation.cursor", async () => {
    const first = await call<Body>(s.api.app, "GET", searchUrl("quokka", { limit: "1" }), { session: office });
    const c = first.body.nextCursor as string;
    expect(typeof c).toBe("string");
    const foreign = [
      searchUrl("quokka risk", { limit: "1", cursor: c }),
      searchUrl("quokka", { limit: "1", cursor: c, recordType: "lesson" }),
      searchUrl("quokka", { limit: "1", cursor: c, includeArchived: "true" }),
      searchUrl("quokka", { limit: "1", cursor: c, transformationId: X.b.transformationId }),
      searchUrl("quokka", { limit: "1", cursor: "not-a-cursor" }),
    ];
    for (const url of foreign) {
      const res = await call<Body>(s.api.app, "GET", url, { session: office });
      expect([res.status, res.body.errors?.[0]?.code], url).toEqual([400, "validation.cursor"]);
    }
    // The same cursor with another limit is fine (the limit is not a filter).
    expect(
      (await call(s.api.app, "GET", searchUrl("quokka", { limit: "3", cursor: c }), { session: office })).status,
    ).toBe(200);
    // A forged cursor with the right binding but keys that are not a keyset: 400, never a 500.
    const decoded = JSON.parse(Buffer.from(c, "base64url").toString("utf8")) as { k: unknown[]; h: string };
    for (const k of [
      ["1.5", "lesson", decoded.k[2]],
      [decoded.k[0], "budget", decoded.k[2]],
      [decoded.k[0], "lesson", "x"],
      [7, "lesson", decoded.k[2]],
    ]) {
      const forged = Buffer.from(JSON.stringify({ k, h: decoded.h }), "utf8").toString("base64url");
      const res = await call<Body>(s.api.app, "GET", searchUrl("quokka", { limit: "1", cursor: forged }), {
        session: office,
      });
      expect([res.status, res.body.errors?.[0]?.code], JSON.stringify(k)).toEqual([400, "validation.cursor"]);
    }
  });
});

describe("freshness: indexedThrough, stale, 503 (ADR-0057 §2)", () => {
  const setState = (recordType: string, set: string) =>
    s.api.owner.query(`update search_index_state set ${set}, version = version + 1 where record_type = $1`, [
      recordType,
    ]);

  it("fresh after a feed run; > 120 s behind or never run is stale; indexedThrough is the oldest requested type's", async () => {
    await s.feed();
    const fresh = await call<Body>(s.api.app, "GET", searchUrl("quokka"), { session: office });
    expect(fresh.body.stale).toBe(false);
    expect(typeof fresh.body.indexedThrough).toBe("string");
    await setState("lesson", "last_incremental_at = now() - interval '121 seconds'");
    const behind = await call<Body>(s.api.app, "GET", searchUrl("quokka"), { session: office });
    const lesson = await s.db
      .selectFrom("search_index_state")
      .select("last_incremental_at")
      .where("record_type", "=", "lesson")
      .executeTakeFirstOrThrow();
    expect([behind.body.stale, behind.body.indexedThrough]).toEqual([true, lesson.last_incremental_at!.toISOString()]);
    // Results are still returned while stale (never hidden or shown as empty).
    expect(behind.body.items.length).toBeGreaterThan(0);
    // Asking only for a fresh type: not stale.
    const other = await call<Body>(s.api.app, "GET", searchUrl("quokka", { recordType: "raid_entry" }), {
      session: office,
    });
    expect(other.body.stale).toBe(false);
    await setState("lesson", "last_incremental_at = null");
    const unknown = await call<Body>(s.api.app, "GET", searchUrl("quokka"), { session: office });
    expect([unknown.body.stale, unknown.body.indexedThrough]).toEqual([true, null]);
    await s.feed();
    expect((await call<Body>(s.api.app, "GET", searchUrl("quokka"), { session: office })).body.stale).toBe(false);
  });

  it("a type reindexing or failed makes the page stale; every requested type failed -> 503 search.index_unavailable", async () => {
    await s.feed();
    await setState("lesson", "status = 'failed', last_error_code = 'search.index_failed', last_error_at = now()");
    const one = await call<Body>(s.api.app, "GET", searchUrl("quokka", { recordType: ["lesson", "decision"] }), {
      session: office,
    });
    expect([one.status, one.body.stale]).toEqual([200, true]);
    const all = await call<Body>(s.api.app, "GET", searchUrl("quokka", { recordType: "lesson" }), {
      session: office,
    });
    expect([all.status, all.body.code, all.body.detail]).toEqual([
      503,
      "search.index_unavailable",
      "Search is not available right now. Try again later.",
    ]);
    // The next feed run recovers the failed type (T-DG6-BE-P), and search is available again.
    await s.feed();
    expect(
      (await call(s.api.app, "GET", searchUrl("quokka", { recordType: "lesson" }), { session: office })).status,
    ).toBe(200);
    // A reindex in progress (the only backward move the 0108 guard allows): stale, results still served.
    await setState(
      "decision",
      "status = 'reindexing', last_audit_seq = 0, reindex_started_at = now(), reindex_finished_at = null",
    );
    const re = await call<Body>(s.api.app, "GET", searchUrl("quokka", { recordType: "decision" }), {
      session: office,
    });
    expect([re.status, re.body.stale]).toEqual([200, true]);
    expect(re.body.items.length).toBeGreaterThan(0);
    await s.reindex(["decision"]);
    await s.feed();
    const back = await call<Body>(s.api.app, "GET", searchUrl("quokka", { recordType: "decision" }), {
      session: office,
    });
    expect(back.body.stale).toBe(false);
  });
});

describe("getSearchIndexStatus (ADR-0057 §2; operations.read)", () => {
  it("the 12 states in the ADR order with their counters; AUD reads; 403 without operations.read; 401", async () => {
    await s.reindex();
    const res = await call<Body>(s.api.app, "GET", "/api/v1/admin/search/index", { session: admin });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.types.map((t: Body) => t.recordType)).toEqual([...SEARCH_RECORD_TYPES]);
    const docs = await s.db
      .selectFrom("search_document")
      .select(["record_type", sql<number>`count(*)::int`.as("n")])
      .groupBy("record_type")
      .execute();
    for (const t of res.body.types) {
      expect(t.status).toBe("idle");
      expect(t.documentsCount, t.recordType).toBe(docs.find((d) => d.record_type === t.recordType)?.n ?? 0);
      expect(t.lastAuditSeq).toMatch(/^[0-9]+$/);
    }
    const aud = await call<Body>(s.api.app, "GET", "/api/v1/admin/search/index", { session: auditor });
    expect(aud.status).toBe(200);
    expect((await call(s.api.app, "GET", "/api/v1/admin/search/index", { session: X.b.s.tl })).status).toBe(403);
    expect((await call(s.api.app, "GET", "/api/v1/admin/search/index", { session: nobody })).status).toBe(403);
    expect((await call(s.api.app, "GET", "/api/v1/admin/search/index")).status).toBe(401);
    expect((await call(s.api.app, "GET", "/api/v1/admin/search/index?x=1", { session: admin })).status).toBe(400);
  });

  it("documentsCount is null (Unknown) until a reindex counts it, never 0", async () => {
    await s.api.owner.query(
      `update search_index_state set documents_count = null, version = version + 1 where record_type = 'lesson'`,
    );
    const res = await call<Body>(s.api.app, "GET", "/api/v1/admin/search/index", { session: admin });
    expect(res.body.types.find((t: Body) => t.recordType === "lesson").documentsCount).toBeNull();
  });
});

describe("the rate-limit class search (ADR-0052 §4)", () => {
  it("over the class budget the next search is 429 rate_limited with Retry-After; other operations still pass", async () => {
    const limited = await startApi({ database: s.database, env: { SEARCH_RATE_LIMIT_PER_MINUTE: "2" } });
    try {
      const me = await signIn(limited.app, w.office.subject);
      expect((await call(limited.app, "GET", searchUrl("quokka"), { session: me })).status).toBe(200);
      expect((await call(limited.app, "GET", searchUrl("quokka"), { session: me })).status).toBe(200);
      const third = await call<Body>(limited.app, "GET", searchUrl("quokka"), { session: me });
      expect([third.status, third.body.code]).toEqual([429, "rate_limited"]);
      expect(Number(third.headers["retry-after"])).toBeGreaterThan(0);
      expect((await call(limited.app, "GET", "/api/v1/me", { session: me })).status).toBe(200);
      // Keyed per user: another user is not counted against the first.
      const other = await signIn(limited.app, w.auditor.subject);
      expect((await call(limited.app, "GET", searchUrl("quokka"), { session: other })).status).toBe(200);
    } finally {
      await limited.close();
    }
  });
});
