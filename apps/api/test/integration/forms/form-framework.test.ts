// The common form framework, part 1: version history, comments and attachments (ADR-0041 §5, §6, §9, §10;
// REQ-S05-001; p5-work-split §B.3; T-DG5-BE-E) against a real PostgreSQL, on T01 (diagnostic item; attachments in the
// DG2 evidence_link) and T14 (benefit; attachments in form_record_attachment):
//  - after an edit, the history lists the new version with the changed fields;
//  - a comment and a reply persist and read back; a reply to a reply -> 422 form_comment.parent_invalid;
//  - an attachment on T14 (form_record_attachment) and on T01 (evidence_link) persists and lists; removal needs a
//    reason (400 without one), If-Match (428 missing, 409 form_record.conflict stale), and is final;
//  - AUD 403 on every write; outside scope 404; one audit event per write; commit-time re-authorization (a grant
//    revoked while the request waits -> 403 and nothing written); free-text rules on comment bodies;
//  - the database refuses an evidence_link record type in form_record_attachment and a reply to a reply when the API
//    checks are bypassed.
// All data is synthetic; nothing here approves anything or touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import {
  auditOf,
  auditOfRequest,
  call,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type Res,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { formsTransformation } from "../../support/forms-fixtures.ts";
import { benefitAt, seedBenefitWorld, type BenefitWorld } from "../benefits/fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";

let api: TestApi;
let w: World;
let office: Session;
let auditor: Session;
let officeB: Session;
let t: string;
let t01: string;
let b: BenefitWorld;
let t14: string;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  office = await signIn(api.app, w.office.subject);
  auditor = await signIn(api.app, w.auditor.subject);
  officeB = await signIn(api.app, w.officeB.subject);
  ({ transformationId: t, t01 } = await formsTransformation(api, w, w.office.id));
  b = await seedBenefitWorld(api, w);
  t14 = (await benefitAt(api, b, "identify")).id;
}, 60_000);
afterAll(() => api?.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const ifm = (v: number) => ({ "if-match": `"${v}"` });
const codeOf = (r: Res<Body>) => [r.status, r.body?.code];
const R = (tid: string, rt: string, id: string) => `/api/v1/transformations/${tid}/form-records/${rt}/${id}`;
const T01 = () => R(t, "T01", t01);
const T14 = () => R(b.transformationId, "T14", t14);
const reqId = (r: Res) => r.headers["x-request-id"] as string;

async function evidence(tid: string, session: Session, ownerUserId: string): Promise<string> {
  const r = await call<Body>(api.app, "POST", `/api/v1/transformations/${tid}/evidence`, {
    session,
    body: { kind: "note", title: "Synthetic evidence", noteBody: "Synthetic", ownerUserId },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.id as string;
}

describe("version history (REQ-S05-001)", () => {
  it("T01: after an edit, the history lists the new version with the changed fields", async () => {
    const item = await call<Body>(api.app, "GET", `/api/v1/transformations/${t}/diagnostic-items/${t01}`, {
      session: office,
    });
    expect(item.status).toBe(200);
    const edit = await call<Body>(api.app, "PATCH", `/api/v1/transformations/${t}/diagnostic-items/${t01}`, {
      session: office,
      headers: ifm(item.body.version),
      body: { rootCause: "Synthetic root cause" },
    });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    const h = await call<Body>(api.app, "GET", `${T01()}/versions`, { session: auditor });
    expect(h.status).toBe(200);
    const last = h.body.items.at(-1);
    expect(last.version).toBe(edit.body.version);
    expect(last.actorUserId).toBe(w.office.id);
    expect(last.changedFields.some((f: string) => /root_?cause/i.test(f))).toBe(true);
    // Field names only, never the values.
    expect(JSON.stringify(h.body)).not.toContain("Synthetic root cause");
    const versions = h.body.items.map((i: Body) => i.version).filter((v: number | null) => v !== null);
    expect(versions).toEqual([...versions].sort((x: number, y: number) => x - y));
  });

  it("T14: after an edit, the history lists the new version with the changed fields; pages oldest first", async () => {
    const cur = await call<Body>(api.app, "GET", `${b.base}/benefits/${t14}`, { session: b.s.bo });
    const edit = await call<Body>(api.app, "PATCH", `${b.base}/benefits/${t14}`, {
      session: b.s.bo,
      headers: ifm(cur.body.version),
      body: { title: "Synthetic churn reduction (renamed)" },
    });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    const first = await call<Body>(api.app, "GET", `${T14()}/versions?limit=1`, { session: b.s.auditor });
    expect([first.status, first.body.items[0].version]).toEqual([200, 1]);
    const all: Body[] = [...first.body.items];
    let cursor = first.body.nextCursor as string | null;
    while (cursor !== null) {
      const p = await call<Body>(api.app, "GET", `${T14()}/versions?limit=1&cursor=${cursor}`, {
        session: b.s.auditor,
      });
      all.push(...p.body.items);
      cursor = p.body.nextCursor;
    }
    const last = all.at(-1);
    expect([last.version, last.changedFields]).toEqual([edit.body.version, expect.arrayContaining(["title"])]);
  });

  it("reads need the transformation in scope (404 outside it, for an unknown record and for a planned type)", async () => {
    expect((await call(api.app, "GET", `${T01()}/versions`, { session: officeB })).status).toBe(404);
    expect((await call(api.app, "GET", `${R(t, "T14", t01)}/versions`, { session: auditor })).status).toBe(404);
    expect((await call(api.app, "GET", `${R(t, "launch_plan", t01)}/versions`, { session: auditor })).status).toBe(404);
    // A T14 record read through another transformation's path does not exist there.
    expect((await call(api.app, "GET", `${R(t, "T14", t14)}/versions`, { session: auditor })).status).toBe(404);
  });
});

describe("comments (REQ-S05-001)", () => {
  for (const [label, url, who] of [
    ["T01", () => T01(), () => office],
    ["T14", () => T14(), () => b.s.bo],
  ] as const) {
    it(`${label}: a comment and a reply persist and read back; a reply to a reply is refused`, async () => {
      const C = `${url()}/comments`;
      const top = await call<Body>(api.app, "POST", C, { session: who(), body: { body: "تعليق تجريبي ‏(synthetic)" } });
      expect(top.status, JSON.stringify(top.body)).toBe(201);
      expect(top.headers.location).toBe(`${C}/${top.body.id}`);
      const reply = await call<Body>(api.app, "POST", C, {
        session: who(),
        body: { body: "Synthetic reply", parentCommentId: top.body.id },
      });
      expect(reply.status).toBe(201);
      const nested = await call<Body>(api.app, "POST", C, {
        session: who(),
        body: { body: "Synthetic nested", parentCommentId: reply.body.id },
      });
      expect(codeOf(nested)).toEqual([422, "form_comment.parent_invalid"]);
      expect(nested.body.detail).toBe("A reply must answer a top-level comment on the same record.");
      const list = await call<Body>(api.app, "GET", C, { session: label === "T01" ? auditor : b.s.auditor });
      expect(list.status).toBe(200);
      const mine = list.body.items.filter((c: Body) => [top.body.id, reply.body.id].includes(c.id));
      expect(mine.map((c: Body) => [c.body, c.parentCommentId])).toEqual([
        ["تعليق تجريبي ‏(synthetic)", null],
        ["Synthetic reply", top.body.id],
      ]);
      expect(mine[0].createdByDisplayName).toEqual(expect.any(String));
      // One audit event per write, in the same request.
      const audits = await auditOfRequest(api.db, reqId(reply));
      expect(audits.map((a) => [a.action, a.record_id])).toEqual([["form_record_comment.create", reply.body.id]]);
      expect(await auditOfRequest(api.db, reqId(nested))).toEqual([]);
    });
  }

  it("a reply must stay on the same record: a parent of another record or a missing parent is refused", async () => {
    const other = await call<Body>(api.app, "POST", `${T14()}/comments`, { session: b.s.bo, body: { body: "Other" } });
    for (const parentCommentId of [other.body.id, uuidv7()]) {
      const r = await call<Body>(api.app, "POST", `${T01()}/comments`, {
        session: office,
        body: { body: "x", parentCommentId },
      });
      expect(codeOf(r)).toEqual([422, "form_comment.parent_invalid"]);
    }
  });

  it("pages oldest first without repeating a row; an altered cursor key is 400 validation.cursor", async () => {
    const rec = await formsTransformation(api, w, w.office.id);
    const C = `${R(rec.transformationId, "T01", rec.t01)}/comments`;
    const ids: string[] = [];
    for (const n of [1, 2, 3]) {
      const r = await call<Body>(api.app, "POST", C, { session: office, body: { body: `Synthetic ${n}` } });
      ids.push(r.body.id as string);
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const q: string = cursor === null ? "?limit=1" : `?limit=1&cursor=${cursor}`;
      const p = await call<Body>(api.app, "GET", `${C}${q}`, { session: auditor });
      expect(p.status).toBe(200);
      seen.push(...p.body.items.map((i: Body) => i.id as string));
      cursor = p.body.nextCursor;
    } while (cursor !== null);
    expect(seen).toEqual(ids);
    const first = await call<Body>(api.app, "GET", `${C}?limit=1`, { session: auditor });
    const decoded = JSON.parse(Buffer.from(first.body.nextCursor as string, "base64url").toString("utf8"));
    for (const [url, key] of [
      [C, "not-a-uuid"],
      [`${R(rec.transformationId, "T01", rec.t01)}/attachments`, "1; drop"],
    ] as const) {
      const forged = Buffer.from(JSON.stringify({ ...decoded, k: [key] }), "utf8").toString("base64url");
      const r = await call<Body>(api.app, "GET", `${url}?limit=1&cursor=${forged}`, { session: auditor });
      expect(r.status).toBe(400);
    }
    const v = await call<Body>(
      api.app,
      "GET",
      `${R(rec.transformationId, "T01", rec.t01)}/versions?limit=1&cursor=${first.body.nextCursor}`,
      {
        session: auditor,
      },
    );
    // A cursor of another list (comments) is not a version-history cursor.
    expect([v.status, v.body.errors[0].code]).toEqual([400, "validation.cursor"]);
  });

  it("free-text rules on comment bodies: blank, NUL, lone surrogate and over-long bodies are refused", async () => {
    const C = `${T01()}/comments`;
    const cases: [string, string][] = [
      ["", "validation.too_small"],
      [" ​⁠ ", "validation.blank"],
      ["a\u0000b", "validation.invalid_character"],
      ["a\ud800b", "validation.invalid_character"],
      ["x".repeat(4001), "validation.too_big"],
    ];
    for (const [body, code] of cases) {
      const r = await call<Body>(api.app, "POST", C, { session: office, body: { body } });
      expect(r.status, JSON.stringify(r.body)).toBe(400);
      expect(r.body.errors.map((e: Body) => e.code)).toContain(code);
    }
    const ok = await call<Body>(api.app, "POST", C, { session: office, body: { body: "x".repeat(4000) } });
    expect(ok.status).toBe(201);
  });

  it("AUD gets 403, a caller outside scope 404, a planned type 422; nothing is written", async () => {
    const before = await api.db.selectFrom("form_record_comment").select("id").where("record_id", "=", t01).execute();
    const aud = await call<Body>(api.app, "POST", `${T01()}/comments`, { session: auditor, body: { body: "x" } });
    expect(aud.status).toBe(403);
    expect((await call(api.app, "POST", `${T01()}/comments`, { session: officeB, body: { body: "x" } })).status).toBe(
      404,
    );
    expect(
      codeOf(
        await call<Body>(api.app, "POST", `${R(t, "launch_plan", t01)}/comments`, {
          session: office,
          body: { body: "x" },
        }),
      ),
    ).toEqual([422, "form_record.type_planned"]);
    const after = await api.db.selectFrom("form_record_comment").select("id").where("record_id", "=", t01).execute();
    expect(after.length).toBe(before.length);
  });

  it("commit-time re-authorization: a grant revoked while the request waits gives 403 and nothing is written", async () => {
    const u = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, u.id, "TO", { type: "organization", id: w.orgA.id }, w.orgA.id);
    const s = await signIn(api.app, u.subject);
    const res = await afterIdentity(
      api,
      u.id,
      () => call(api.app, "POST", `${T01()}/comments`, { session: s, body: { body: "Synthetic late" } }),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(res.status).toBe(403);
    const rows = await api.db.selectFrom("form_record_comment").select("id").where("created_by", "=", u.id).execute();
    expect(rows).toEqual([]);
  });

  it("the database refuses a reply to a reply when the API check is bypassed (append-only too)", async () => {
    const top = await call<Body>(api.app, "POST", `${T01()}/comments`, { session: office, body: { body: "Top" } });
    const reply = await call<Body>(api.app, "POST", `${T01()}/comments`, {
      session: office,
      body: { body: "Reply", parentCommentId: top.body.id },
    });
    await expect(
      api.owner.query(
        `insert into form_record_comment (id, organization_id, transformation_id, record_type, record_id, parent_comment_id, body, created_by)
         values ($1, $2, $3, 'T01', $4, $5, 'forced', $6)`,
        [uuidv7(), w.orgA.id, t, t01, reply.body.id, w.office.id],
      ),
    ).rejects.toMatchObject({ constraint: "form_record_comment_parent_same_record" });
    await expect(
      api.owner.query(`update form_record_comment set body = 'edited' where id = $1`, [top.body.id]),
    ).rejects.toThrow();
  });
});

describe("attachments (REQ-S05-001)", () => {
  it("T14: an attachment persists in form_record_attachment and lists; removal needs a reason and If-Match", async () => {
    const ev = await evidence(b.transformationId, b.s.bo, b.users.bo.id);
    const A = `${T14()}/attachments`;
    const created = await call<Body>(api.app, "POST", A, { session: b.s.bo, body: { evidenceId: ev } });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect([created.body.store, created.body.recordType, created.body.status, created.body.version]).toEqual([
      "form_record_attachment",
      "T14",
      "active",
      1,
    ]);
    expect(created.headers.etag).toBe('"1"');
    const row = await api.db
      .selectFrom("form_record_attachment")
      .selectAll()
      .where("id", "=", created.body.id)
      .executeTakeFirst();
    expect([row?.record_type, row?.record_id, row?.evidence_id]).toEqual(["T14", t14, ev]);
    expect((await auditOfRequest(api.db, reqId(created))).map((a) => a.action)).toEqual([
      "form_record_attachment.create",
    ]);
    const list = await call<Body>(api.app, "GET", A, { session: b.s.auditor });
    expect(list.body.items.map((i: Body) => [i.id, i.evidenceTitle])).toEqual([
      [created.body.id, "Synthetic evidence"],
    ]);
    // Already attached -> 409.
    expect((await call(api.app, "POST", A, { session: b.s.bo, body: { evidenceId: ev } })).status).toBe(409);

    const X = `${A}/${created.body.id}/remove`;
    expect((await call(api.app, "POST", X, { session: b.s.bo, headers: ifm(1), body: {} })).status).toBe(400);
    expect((await call(api.app, "POST", X, { session: b.s.bo, headers: ifm(1), body: { reason: "  " } })).status).toBe(
      400,
    );
    expect((await call(api.app, "POST", X, { session: b.s.bo, body: { reason: "Synthetic reason" } })).status).toBe(
      428,
    );
    const stale = await call<Body>(api.app, "POST", X, {
      session: b.s.bo,
      headers: ifm(7),
      body: { reason: "Synthetic reason" },
    });
    expect([...codeOf(stale), stale.body.currentVersion]).toEqual([409, "form_record.conflict", 1]);
    expect(
      (await call(api.app, "POST", X, { session: b.s.auditor, headers: ifm(1), body: { reason: "Synthetic reason" } }))
        .status,
    ).toBe(403);
    const removed = await call<Body>(api.app, "POST", X, {
      session: b.s.bo,
      headers: ifm(1),
      body: { reason: "Synthetic reason" },
    });
    expect([removed.status, removed.body.status, removed.body.removeReason, removed.body.version]).toEqual([
      200,
      "removed",
      "Synthetic reason",
      2,
    ]);
    expect(removed.headers.etag).toBe('"2"');
    expect((await auditOfRequest(api.db, reqId(removed))).map((a) => [a.action, a.reason])).toEqual([
      ["form_record_attachment.remove", "Synthetic reason"],
    ]);
    expect(
      codeOf(await call<Body>(api.app, "POST", X, { session: b.s.bo, headers: ifm(2), body: { reason: "Again" } })),
    ).toEqual([422, "form_attachment.already_removed"]);
    expect((await call<Body>(api.app, "GET", A, { session: b.s.auditor })).body.items).toEqual([]);
    expect(
      (await call<Body>(api.app, "GET", `${A}?includeRemoved=true`, { session: b.s.auditor })).body.items.length,
    ).toBe(1);
    // The evidence item itself is unchanged; it can be attached again after removal.
    expect((await call(api.app, "POST", A, { session: b.s.bo, body: { evidenceId: ev } })).status).toBe(201);
  });

  it("T01: an attachment persists in the DG2 evidence_link, lists there and through the DG2 route, and is removed", async () => {
    const ev = await evidence(t, office, w.office.id);
    const A = `${T01()}/attachments`;
    const created = await call<Body>(api.app, "POST", A, { session: office, body: { evidenceId: ev } });
    expect([created.status, created.body.store, created.body.recordType]).toEqual([201, "evidence_link", "T01"]);
    const link = await api.db
      .selectFrom("evidence_link")
      .selectAll()
      .where("id", "=", created.body.id)
      .executeTakeFirst();
    expect([link?.record_type, link?.record_id]).toEqual(["diagnostic_item", t01]);
    expect(
      await api.db.selectFrom("form_record_attachment").select("id").where("record_id", "=", t01).execute(),
    ).toEqual([]);
    expect((await auditOf(api.db, created.body.id)).map((a) => a.action)).toEqual(["evidence_link.create"]);
    const dg2 = await call<Body>(
      api.app,
      "GET",
      `/api/v1/transformations/${t}/evidence-links?recordType=diagnostic_item&recordId=${t01}`,
      {
        session: auditor,
      },
    );
    expect(dg2.body.items.map((i: Body) => i.id)).toContain(created.body.id);
    const list = await call<Body>(api.app, "GET", A, { session: auditor });
    expect(list.body.items.map((i: Body) => i.id)).toContain(created.body.id);
    // The same evidence linked through the DG2 route is already attached here (one attachment place).
    const twice = await call<Body>(api.app, "POST", `/api/v1/transformations/${t}/evidence-links`, {
      session: office,
      body: { evidenceId: ev, recordType: "diagnostic_item", recordId: t01 },
    });
    expect(twice.status).toBe(409);
    const removed = await call<Body>(api.app, "POST", `${A}/${created.body.id}/remove`, {
      session: office,
      headers: ifm(1),
      body: { reason: "Synthetic reason" },
    });
    expect([removed.status, removed.body.status]).toEqual([200, "removed"]);
    expect((await auditOf(api.db, created.body.id)).map((a) => a.action)).toEqual([
      "evidence_link.create",
      "evidence_link.remove",
    ]);
  });

  it("refusals: evidence of another transformation, AUD 403, outside scope 404, unknown attachment 404", async () => {
    const foreign = await evidence(b.transformationId, b.s.bo, b.users.bo.id);
    const A = `${T01()}/attachments`;
    const r = await call<Body>(api.app, "POST", A, { session: office, body: { evidenceId: foreign } });
    expect([...codeOf(r), r.body.detail]).toEqual([
      422,
      "form_attachment.evidence_unknown",
      "Choose evidence from this transformation.",
    ]);
    const ev = await evidence(t, office, w.office.id);
    expect((await call(api.app, "POST", A, { session: auditor, body: { evidenceId: ev } })).status).toBe(403);
    expect((await call(api.app, "POST", A, { session: officeB, body: { evidenceId: ev } })).status).toBe(404);
    expect((await call(api.app, "GET", A, { session: officeB })).status).toBe(404);
    expect(
      (
        await call(api.app, "POST", `${A}/${uuidv7()}/remove`, {
          session: office,
          headers: ifm(1),
          body: { reason: "Synthetic" },
        })
      ).status,
    ).toBe(404);
    // TO holds no benefit.edit: the record type's write permission decides (403).
    const ev14 = await evidence(b.transformationId, b.s.bo, b.users.bo.id);
    expect(
      (await call(api.app, "POST", `${T14()}/attachments`, { session: office, body: { evidenceId: ev14 } })).status,
    ).toBe(403);
    expect(await api.db.selectFrom("evidence_link").select("id").where("evidence_id", "=", ev).execute()).toEqual([]);
  });

  it("commit-time re-authorization on attach: a grant revoked while the request waits gives 403, nothing written", async () => {
    const u = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, u.id, "TO", { type: "organization", id: w.orgA.id }, w.orgA.id);
    const s = await signIn(api.app, u.subject);
    const ev = await evidence(t, office, w.office.id);
    const res = await afterIdentity(
      api,
      u.id,
      () => call(api.app, "POST", `${T01()}/attachments`, { session: s, body: { evidenceId: ev } }),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(res.status).toBe(403);
    expect(await api.db.selectFrom("evidence_link").select("id").where("evidence_id", "=", ev).execute()).toEqual([]);
  });

  it("the database keeps one attachment place: form_record_attachment refuses the evidence_link record types", async () => {
    const ev = await evidence(t, office, w.office.id);
    await expect(
      api.owner.query(
        `insert into form_record_attachment (id, organization_id, transformation_id, record_type, record_id, evidence_id, created_by, updated_by)
         values ($1, $2, $3, 'T01', $4, $5, $6, $6)`,
        [uuidv7(), w.orgA.id, t, t01, ev, w.office.id],
      ),
    ).rejects.toMatchObject({ constraint: "form_record_attachment_use_evidence_link" });
  });
});
