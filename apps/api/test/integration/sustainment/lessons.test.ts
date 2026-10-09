// Lessons and the cross-transformation lesson search (T-DG4-BE-I2; ADR-0034 §8, §9, §12; REQ-S11-008). Proves, against
// the run's disposable PostgreSQL:
//  - REQ-S11-008 A11 "a lesson is searchable from another transformation": a lesson published in transformation 1 is
//    returned by searchLessons to a user granted ONLY on transformation 2 of the same business unit, and is NOT
//    returned to a user granted only on a transformation of another business unit, nor to a user of another
//    organization (no existence disclosure: absent, not 403); drafts and archived lessons are never returned; the
//    technical administrator (no lesson.search) gets 403; AUD (organization scope) finds it; q (plainto_tsquery
//    'simple'), tag and cursor paging work;
//  - create (BO, TO; LL-nn, draft, distinct tags), edit, publish (bodiless, If-Match), archive (final): 422
//    lesson.status_transition and lesson.archived with their exact texts; AUD/WL 403, ADM 404; If-Match 428/409;
//    one audit event per mutation; lessons stay editable after the transformation is closed.
// All data is SYNTHETIC; nothing here approves anything, and nothing touches DG0-DG7.
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditOf,
  call,
  createTransformationRow,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import {
  closeTransformationSynthetic,
  seedSustainmentWorld,
  type SustainmentWorld,
} from "../contract/p4-exercises-be-i.ts";

let api: TestApi;
let w: World;
let s: SustainmentWorld;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call(api.app, m, u, o);
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  s = await seedSustainmentWorld(api, w);
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

const lessons = () => `${s.b.base}/lessons`;
/** A search token no other test or run writes ('simple' configuration: lower-case letters only). */
const token = () => `synth${[...randomBytes(6)].map((b) => String.fromCharCode(97 + (b % 26))).join("")}`;

async function newLesson(body: Record<string, unknown> = {}) {
  const r = await send("POST", lessons(), {
    session: s.to.session,
    body: { title: "Synthetic lesson", lessonText: "Synthetic: reconcile before close", ...body },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { id: string; code: string; version: number; status: string };
}

async function published(body: Record<string, unknown> = {}) {
  const l = await newLesson(body);
  const p = await send("POST", `${lessons()}/${l.id}/publish`, { session: s.b.s.bo, headers: ifm(1) });
  expect(p.status, JSON.stringify(p.body)).toBe(200);
  return p.body as { id: string; version: number };
}

/** A user granted `role` ONLY on a new transformation of `businessUnitId` (org A). */
async function userOfOtherTransformation(businessUnitId: string, role = "TL"): Promise<Session> {
  const t = await createTransformationRow(api.db, w.orgA.id, businessUnitId, w.office.id);
  const u = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, u.id, role, { type: "transformation", id: t }, w.orgA.id);
  return signIn(api.app, u.subject);
}

const search = (session: Session, qs: string) => send("GET", `/api/v1/lessons/search?${qs}`, { session });
const ids = (r: { body: { items: { lesson: { id: string } }[] } }) => r.body.items.map((h) => h.lesson.id);

describe("REQ-S11-008 A11: a lesson is searchable from another transformation, in scope only", () => {
  it("found by a user of transformation 2 in the same business unit; not by a user of another business unit", async () => {
    const kw = token();
    const lesson = await published({ title: `Synthetic ${kw} reconciliation`, tags: ["churn"] });
    const sameBu = await userOfOtherTransformation(w.a1);
    const otherBu = await userOfOtherTransformation(w.a2);
    const hit = await search(sameBu, `q=${kw}`);
    expect(hit.status).toBe(200);
    expect(ids(hit)).toEqual([lesson.id]);
    expect(hit.body.items[0].transformationName).toBe("Synthetic fixture transformation");
    expect(hit.body.items[0].lesson.transformationId).toBe(s.b.transformationId);
    const miss = await search(otherBu, `q=${kw}`);
    expect([miss.status, miss.body.items]).toEqual([200, []]);
    // AUD (organization scope) finds it; another organization's user sees nothing; the technical admin is refused.
    expect(ids(await search(s.b.s.auditor, `q=${kw}`))).toEqual([lesson.id]);
    const outsider = await search(s.b.s.outsider, `q=${kw}`);
    expect([outsider.status, outsider.body.items]).toEqual([200, []]);
    expect((await search(s.b.s.admin, `q=${kw}`)).status).toBe(403);
  });

  it("drafts and archived lessons are never returned; tag filter; cursor paging", async () => {
    const kw = token();
    const draft = await newLesson({ title: `Synthetic ${kw} draft` });
    const p1 = await published({ title: `Synthetic ${kw} one`, tags: ["billing", "churn"] });
    const p2 = await published({ title: `Synthetic ${kw} two`, tags: ["churn"] });
    const p3 = await published({ title: `Synthetic ${kw} three` });
    const arch = await send("PATCH", `${lessons()}/${p3.id}`, {
      session: s.b.s.bo,
      headers: ifm(p3.version),
      body: { status: "archived" },
    });
    expect(arch.status).toBe(200);
    const all = await search(s.b.s.tl, `q=${kw}`);
    expect(ids(all).sort()).toEqual([p1.id, p2.id].sort());
    expect(ids(all)).not.toContain(draft.id);
    expect(ids(await search(s.b.s.tl, `q=${kw}&tag=billing`))).toEqual([p1.id]);
    const page1 = await search(s.b.s.tl, `q=${kw}&limit=1`);
    expect(page1.body.items).toHaveLength(1);
    expect(page1.body.nextCursor).not.toBeNull();
    const page2 = await search(s.b.s.tl, `q=${kw}&limit=1&cursor=${encodeURIComponent(page1.body.nextCursor)}`);
    expect([...ids(page1), ...ids(page2)].sort()).toEqual([p1.id, p2.id].sort());
    expect((await search(s.b.s.tl, "q=")).status).toBe(400);
  });
});

describe("lesson lifecycle (ADR-0034 §8, §12)", () => {
  it("create, edit, publish, archive: codes, exact refusals, If-Match, audit", async () => {
    const l = await newLesson({ tags: ["churn"] });
    expect([l.code.startsWith("LL-"), l.status, l.version]).toEqual([true, "draft", 1]);
    const L = `${lessons()}/${l.id}`;
    expect((await send("PATCH", L, { session: s.to.session, body: { title: "x" } })).status).toBe(428);
    expect((await send("PATCH", L, { session: s.to.session, headers: ifm(3), body: { title: "x" } })).status).toBe(409);
    const dupTags = await send("PATCH", L, {
      session: s.to.session,
      headers: ifm(1),
      body: { tags: ["churn", "churn"] },
    });
    expect([dupTags.status, dupTags.body.errors[0].pointer]).toEqual([400, "/tags"]);
    const e = await send("PATCH", L, {
      session: s.to.session,
      headers: ifm(1),
      body: { context: "Synthetic context" },
    });
    expect([e.status, e.body.context, e.body.version]).toEqual([200, "Synthetic context", 2]);
    expect((await send("POST", `${L}/publish`, { session: s.to.session })).status).toBe(428);
    const p = await send("POST", `${L}/publish`, { session: s.to.session, headers: ifm(2) });
    expect([p.status, p.body.status, p.body.publishedBy]).toEqual([200, "published", s.to.id]);
    const twice = await send("POST", `${L}/publish`, { session: s.to.session, headers: ifm(3) });
    expect([twice.status, twice.body.code, twice.body.detail]).toEqual([
      422,
      "lesson.status_transition",
      "This lesson cannot move from published to published.",
    ]);
    const a = await send("PATCH", L, { session: s.b.s.bo, headers: ifm(3), body: { status: "archived" } });
    expect([a.status, a.body.status, a.body.archivedBy]).toEqual([200, "archived", s.b.users.bo.id]);
    for (const r of [
      await send("PATCH", L, { session: s.b.s.bo, headers: ifm(4), body: { title: "x" } }),
      await send("POST", `${L}/publish`, { session: s.b.s.bo, headers: ifm(4) }),
    ])
      expect([r.status, r.body.code, r.body.detail]).toEqual([
        422,
        "lesson.archived",
        "This lesson is archived and can no longer be changed.",
      ]);
    expect((await auditOf(api.db, l.id)).map((x) => x.action)).toEqual([
      "lesson.create",
      "lesson.update",
      "lesson.publish",
      "lesson.archive",
    ]);
    const drafts = await send("GET", `${lessons()}?status=archived`, { session: s.b.s.auditor });
    expect(drafts.body.items.map((x: { id: string }) => x.id)).toContain(l.id);
  });

  it("AUD, WL and FIN 403 on writes; ADM-only and an outsider 404", async () => {
    const body = { title: "Synthetic", lessonText: "Synthetic text" };
    for (const session of [s.b.s.auditor, s.wl.session, s.b.s.fin])
      expect((await send("POST", lessons(), { session, body })).status).toBe(403);
    for (const session of [s.b.s.admin, s.b.s.outsider]) {
      expect((await send("POST", lessons(), { session, body })).status).toBe(404);
      expect((await send("GET", lessons(), { session })).status).toBe(404);
    }
    const l = await newLesson();
    expect(
      (await send("POST", `${lessons()}/${l.id}/publish`, { session: s.b.s.auditor, headers: ifm(1) })).status,
    ).toBe(403);
  });

  it("after the transformation is closed, its lessons are still edited, published and found", async () => {
    const x = await seedSustainmentWorld(api, w);
    const kw = token();
    const r = await send("POST", `${x.b.base}/lessons`, {
      session: x.to.session,
      body: { title: `Synthetic ${kw} after closure`, lessonText: "Synthetic: written before closure" },
    });
    expect(r.status).toBe(201);
    await closeTransformationSynthetic(api, x.b);
    const p = await send("POST", `${x.b.base}/lessons/${r.body.id}/publish`, { session: x.b.s.bo, headers: ifm(1) });
    expect([p.status, p.body.status]).toEqual([200, "published"]);
    expect(ids(await search(s.b.s.tl, `q=${kw}`))).toEqual([r.body.id]);
  });
});
