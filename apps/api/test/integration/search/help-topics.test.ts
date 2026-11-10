// listHelpTopics and getHelpTopic (ADR-0057 §9, §10; REQ-S15-010 "contextual help"; p6-work-split §H/G.4, T-DG6-BE-Q2)
// against a real PostgreSQL with the 0108 seed:
//  - the 11 seeded topics in English and Arabic, every one `arabicProvisional: true` with the Arabic ending
//    "(ترجمة مؤقتة)", ordered by screen and ordinal, equal to the stored rows;
//  - `screenKey` filters to one screen; an unknown screen is an empty list; a malformed key -> 400;
//  - keyset paging with limit 2 walks all 11 once; a cursor of another filter -> 400;
//  - getHelpTopic returns one topic; an unknown topic -> 404; a malformed key -> 400;
//  - any signed-in user reads (AUD, a user without any grant, another organization); no session -> 401.
// Read-only catalogue: no claim of PMI or any certification is made by the texts (probe HT01 of ARCH-04). Nothing here
// approves anything (G1-G6) or touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, seedWorld, signIn, startApi, type Session, type TestApi, type World } from "../../support/harness.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- response bodies are asserted structurally
type Body = any;

const H = "/api/v1/help-topics";
let api: TestApi;
let w: World;
let office: Session;

const get = (path: string, session?: Session) => call<Body>(api.app, "GET", path, session ? { session } : {});

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  office = await signIn(api.app, w.office.subject);
});
afterAll(() => api.close());

describe("help topics (ADR-0057 §9)", () => {
  it("lists the 11 seeded topics, en and ar, Arabic provisional, by screen and ordinal, equal to the stored rows", async () => {
    const res = await get(`${H}?limit=100`, office);
    expect(res.status).toBe(200);
    expect(res.body.nextCursor).toBeNull();
    const stored = await api.db.selectFrom("help_topic").selectAll().orderBy("screen_key").orderBy("ordinal").execute();
    expect(stored).toHaveLength(11);
    expect(res.body.items).toEqual(
      stored.map((r) => ({
        topicKey: r.topic_key,
        screenKey: r.screen_key,
        ordinal: r.ordinal,
        titleEn: r.title_en,
        titleAr: r.title_ar,
        bodyEn: r.body_en,
        bodyAr: r.body_ar,
        arabicProvisional: r.arabic_provisional,
        sourceRefs: r.source_refs,
      })),
    );
    for (const t of res.body.items) {
      expect(t.arabicProvisional).toBe(true);
      expect(t.titleAr.endsWith("(ترجمة مؤقتة)")).toBe(true);
      expect(t.bodyAr.endsWith("(ترجمة مؤقتة)")).toBe(true);
      expect(t.bodyEn).not.toMatch(/PMI|certif/i);
      expect(t.sourceRefs.length).toBeGreaterThan(0);
    }
    expect(new Set(res.body.items.map((t: Body) => t.screenKey)).size).toBe(5);
    expect(res.body.items.map((t: Body) => t.topicKey)).toContain("records.drafts");
  });

  it("filters by screenKey; an unknown screen is empty; a malformed key or an unknown parameter is 400", async () => {
    const res = await get(`${H}?screenKey=lists`, office);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items.every((t: Body) => t.screenKey === "lists")).toBe(true);
    expect(res.body.items.map((t: Body) => t.ordinal)).toEqual(
      [...res.body.items.map((t: Body) => t.ordinal)].sort((a: number, b: number) => a - b),
    );
    expect((await get(`${H}?screenKey=no_such_screen`, office)).body.items).toEqual([]);
    expect((await get(`${H}?screenKey=Bad-Key`, office)).status).toBe(400);
    expect((await get(`${H}?topic=x`, office)).status).toBe(400);
  });

  it("pages with limit 2 through all 11 once; a cursor of another filter is 400", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let first: string | null = null;
    for (let i = 0; i < 10; i++) {
      const res: Body = await get(`${H}?limit=2${cursor ? `&cursor=${cursor}` : ""}`, office);
      expect(res.status).toBe(200);
      seen.push(...res.body.items.map((t: Body) => t.topicKey));
      cursor = res.body.nextCursor;
      first ??= cursor;
      if (cursor === null) break;
    }
    expect(seen).toHaveLength(11);
    expect(new Set(seen).size).toBe(11);
    const foreign = await get(`${H}?screenKey=lists&cursor=${first}`, office);
    expect(foreign.status).toBe(400);
    expect(foreign.body.errors).toEqual([
      expect.objectContaining({ pointer: "/query/cursor", code: "validation.cursor" }),
    ]);
  });

  it("gets one topic; unknown 404; malformed 400", async () => {
    const res = await get(`${H}/records.drafts`, office);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ topicKey: "records.drafts", arabicProvisional: true });
    expect(typeof res.body.titleEn).toBe("string");
    expect(typeof res.body.titleAr).toBe("string");
    expect((await get(`${H}/no.such.topic`, office)).status).toBe(404);
    expect((await get(`${H}/Bad-Key`, office)).status).toBe(400);
  });

  it("any signed-in user reads (AUD, no grant, another organization); no session is 401", async () => {
    for (const subject of [w.auditor.subject, w.nobody.subject, w.officeB.subject]) {
      const s = await signIn(api.app, subject);
      expect((await get(`${H}?screenKey=search`, s)).status).toBe(200);
      expect((await get(`${H}/search.global`, s)).status).toBe(200);
    }
    expect((await get(H)).status).toBe(401);
    expect((await get(`${H}/search.global`)).status).toBe(401);
  });
});
