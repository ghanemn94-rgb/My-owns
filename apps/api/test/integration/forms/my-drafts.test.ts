// listMyFormDrafts `GET /api/v1/me/form-drafts` (ADR-0057 §6, §10; REQ-S15-010 "unsaved drafts are recoverable";
// REQ-S15-011; p6-work-split §H/G.4, T-DG6-BE-Q2) against a real PostgreSQL:
//  - the caller's open drafts across two transformations, newest first (updated_at desc, id desc), with the
//    transformation's code and name and baseChanged; closed drafts and other users' drafts are not listed;
//  - a draft of a transformation whose assignment was revoked is left out (ReadScope, transformation.read, decided on
//    the next request) and is still stored unchanged (row and audit trail identical); it is listed again once read
//    access returns;
//  - keyset paging with limit 1 walks every draft once; a cursor of other filters or an altered keyset -> 400;
//  - AUD (no write code, so no drafts of its own) gets 200 and an empty list; no session -> 401; an unknown query
//    parameter -> 400. The route writes nothing (no audit event).
// All data is SYNTHETIC; a draft approves nothing (no G1-G6 business approval) and nothing touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodeCursor, filterHash } from "../../../src/modules/platform/index.ts";
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

const ME = "/api/v1/me/form-drafts";
const drafts = (t: string) => `/api/v1/transformations/${t}/form-drafts`;

interface Item {
  id: string;
  transformationId: string;
  transformationCode: string;
  transformationName: string;
  recordType: string;
  recordId: string | null;
  baseRecordVersion: number | null;
  baseChanged: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

let api: TestApi;
let w: World;
let t1: string;
let t2: string;
let writer: { id: string; subject: string };
let writerSession: Session;
let t1Assignment: string;
let other: Session;
let auditor: Session;
const ids = { t1: "", t2: "", closed: "", other: "" };

async function createDraft(session: Session, t: string, body: Record<string, unknown>) {
  const res = await call(api.app, "POST", drafts(t), { session, body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string; version: number };
}

const listMine = (session: Session | undefined, query = "") =>
  call<{ items: Item[]; nextCursor: string | null; errors?: unknown[] }>(
    api.app,
    "GET",
    `${ME}${query}`,
    session ? { session } : {},
  );

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  t1 = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
  t2 = await createTransformationRow(api.db, w.orgA.id, w.a2, w.office.id);
  // A workstream lead on each of the two transformations (WL holds initiative.edit, the T05 write code).
  writer = await createUser(api.db, w.orgA.id);
  t1Assignment = await grant(api.db, w.grantor.id, writer.id, "WL", { type: "transformation", id: t1 }, w.orgA.id);
  await grant(api.db, w.grantor.id, writer.id, "WL", { type: "transformation", id: t2 }, w.orgA.id);
  writerSession = await signIn(api.app, writer.subject);
  const otherUser = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, otherUser.id, "WL", { type: "transformation", id: t1 }, w.orgA.id);
  other = await signIn(api.app, otherUser.subject);
  auditor = await signIn(api.app, w.auditor.subject);

  // Oldest first: a T1 draft, a T2 draft, then a closed T2 draft and another user's T1 draft (neither listed).
  ids.t1 = (await createDraft(writerSession, t1, { recordType: "T05", payload: { name: "Synthetic draft one" } })).id;
  ids.t2 = (await createDraft(writerSession, t2, { recordType: "T05", payload: { name: "Synthetic draft two" } })).id;
  const closed = await createDraft(writerSession, t2, { recordType: "T05", payload: { name: "Synthetic closed" } });
  ids.closed = closed.id;
  const close = await call(api.app, "POST", `${drafts(t2)}/${closed.id}/close`, {
    session: writerSession,
    body: { reason: "discarded" },
    headers: ifm(1),
  });
  expect(close.status, JSON.stringify(close.body)).toBe(200);
  ids.other = (await createDraft(other, t1, { recordType: "T05", payload: { name: "Synthetic other" } })).id;
}, 120_000);
afterAll(() => api.close());

describe("listMyFormDrafts (ADR-0057 §6)", () => {
  it("lists the caller's open drafts across two transformations, newest first, without the payload", async () => {
    const res = await listMine(writerSession);
    expect(res.status).toBe(200);
    expect(res.body.items.map((i) => i.id)).toEqual([ids.t2, ids.t1]);
    expect(res.body.nextCursor).toBeNull();
    const [second, first] = res.body.items;
    expect(second!.transformationId).toBe(t2);
    expect(first!.transformationId).toBe(t1);
    const codes = await api.db.selectFrom("transformation").select(["id", "code", "name"]).execute();
    const byId = new Map(codes.map((c) => [c.id, c]));
    for (const i of res.body.items) {
      expect(i.transformationCode).toBe(byId.get(i.transformationId)!.code);
      expect(i.transformationName).toBe(byId.get(i.transformationId)!.name);
      expect(i).toMatchObject({ recordType: "T05", recordId: null, baseRecordVersion: null, baseChanged: false });
      expect(Object.keys(i)).not.toContain("payload");
    }
    expect(res.body.items.map((i) => i.id)).not.toContain(ids.closed);
    expect(res.body.items.map((i) => i.id)).not.toContain(ids.other);
  });

  it("an update moves a draft to the top (newest change first)", async () => {
    const put = await call(api.app, "PUT", `${drafts(t1)}/${ids.t1}`, {
      session: writerSession,
      body: { payload: { name: "Synthetic draft one, edited" } },
      headers: ifm(1),
    });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    const res = await listMine(writerSession);
    expect(res.body.items.map((i) => [i.id, i.version])).toEqual([
      [ids.t1, 2],
      [ids.t2, 1],
    ]);
  });

  it("pages with limit 1 through every draft once; a foreign or altered cursor is 400", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 5; i++) {
      const res = await listMine(writerSession, `?limit=1${cursor ? `&cursor=${cursor}` : ""}`);
      expect(res.status).toBe(200);
      seen.push(...res.body.items.map((x) => x.id));
      cursor = res.body.nextCursor;
      if (cursor === null) break;
    }
    expect(seen).toEqual([ids.t1, ids.t2]);
    const foreign = encodeCursor(["2026-01-01T00:00:00.000Z", ids.t1], filterHash({ table: "form_draft", list: "x" }));
    const f = await listMine(writerSession, `?cursor=${foreign}`);
    expect(f.status).toBe(400);
    expect(f.body.errors).toEqual([expect.objectContaining({ pointer: "/query/cursor", code: "validation.cursor" })]);
    const altered = encodeCursor(
      ["not-a-time", "not-a-uuid"],
      filterHash({ table: "form_draft", list: "me", status: "open" }),
    );
    const a = await listMine(writerSession, `?cursor=${altered}`);
    expect(a.status).toBe(400);
    expect(a.body.errors).toEqual([expect.objectContaining({ pointer: "/query/cursor", code: "validation.cursor" })]);
  });

  it("a revoked assignment hides that transformation's draft on the next request; the draft stays stored unchanged", async () => {
    const before = await api.db.selectFrom("form_draft").selectAll().where("id", "=", ids.t1).executeTakeFirstOrThrow();
    const auditBefore = await auditOf(api.db, ids.t1);
    await api.owner.query(
      `update scoped_assignment set revoked_at = now(), revoked_by = $1, revoke_reason = 'synthetic BE-Q2 test' where id = $2`,
      [w.grantor.id, t1Assignment],
    );
    const res = await listMine(writerSession);
    expect(res.status).toBe(200);
    expect(res.body.items.map((i) => i.id)).toEqual([ids.t2]);
    const after = await api.db.selectFrom("form_draft").selectAll().where("id", "=", ids.t1).executeTakeFirstOrThrow();
    expect(after).toEqual(before);
    expect(await auditOf(api.db, ids.t1)).toEqual(auditBefore);
    // Read access returns: the stored draft is listed again, as it was.
    await grant(api.db, w.grantor.id, writer.id, "WL", { type: "transformation", id: t1 }, w.orgA.id);
    const back = await listMine(writerSession);
    expect(back.body.items.map((i) => [i.id, i.version])).toEqual([
      [ids.t1, 2],
      [ids.t2, 1],
    ]);
  });

  it("reports baseChanged for a draft of a record that moved past the draft's base version", async () => {
    const ini = await call(api.app, "POST", "/api/v1/initiatives", {
      session: writerSession,
      body: { transformationId: t2, name: "Synthetic base-changed initiative" },
    });
    expect(ini.status, JSON.stringify(ini.body)).toBe(201);
    const d = await createDraft(writerSession, t2, {
      recordType: "T05",
      recordId: ini.body.id,
      baseRecordVersion: 1,
      payload: { objective: "Synthetic objective" },
    });
    let res = await listMine(writerSession);
    expect(res.body.items[0]).toMatchObject({ id: d.id, recordId: ini.body.id, baseChanged: false });
    const patch = await call(api.app, "PATCH", `/api/v1/initiatives/${ini.body.id}`, {
      session: writerSession,
      body: { objective: "Synthetic objective, saved by someone" },
      headers: ifm(1),
    });
    expect(patch.status, JSON.stringify(patch.body)).toBe(200);
    res = await listMine(writerSession);
    expect(res.body.items.find((i) => i.id === d.id)).toMatchObject({ baseRecordVersion: 1, baseChanged: true });
  });

  it("AUD: 200 with no drafts of its own; another user sees only its own; no session 401; unknown parameter 400", async () => {
    const aud = await listMine(auditor);
    expect([aud.status, aud.body.items]).toEqual([200, []]);
    const o = await listMine(other);
    expect(o.body.items.map((i) => i.id)).toEqual([ids.other]);
    expect((await listMine(undefined)).status).toBe(401);
    expect((await listMine(writerSession, "?status=open")).status).toBe(400);
  });

  it("writes nothing: the list leaves the audit trail of every listed draft as it was", async () => {
    const before = await auditOf(api.db, ids.t2);
    await listMine(writerSession);
    expect(await auditOf(api.db, ids.t2)).toEqual(before);
  });
});
