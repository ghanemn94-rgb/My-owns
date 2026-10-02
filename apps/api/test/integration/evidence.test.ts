// Evidence repository (ADR-0018, ADR-0010; REQ-S13-010..013, REQ-S16-006, REQ-S16-013). Against a real PostgreSQL:
// review by the creator is 403; verification needs accessible content (422); a filename reference can never be
// verified; a new content revision resets the verification; a link to another transformation's record is 422;
// download goes through the API with the parent's authorization, attachment disposition and nosniff; AUD gets 403.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditOf,
  auditOfRequest,
  call,
  seedWorld,
  signIn,
  startApi,
  type TestApi,
  type World,
} from "../support/harness.ts";
import { ifm, setupP2World, type P2World } from "../support/p2-fixtures.ts";

let api: TestApi;
let w: World;
let p: P2World;
let T: string;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupP2World(api, w);
  T = `/api/v1/transformations/${p.transformationId}`;
});
afterAll(() => api.close());

const createEvidence = (body: Record<string, unknown>, session = p.lead.session) =>
  call(api.app, "POST", `${T}/evidence`, { session, body: { ownerUserId: p.lead.id, ...body } });
const review = (id: string, version: number, body: Record<string, unknown>, session = p.office.session) =>
  call(api.app, "POST", `${T}/evidence/${id}/review`, { session, headers: ifm(version), body });
const upload = (id: string, version: number, bytes: string, session = p.lead.session) =>
  call(api.app, "POST", `${T}/evidence/${id}/content`, {
    session,
    headers: { ...ifm(version), "content-type": "application/octet-stream", "x-file-name": "extract.csv" },
    body: Buffer.from(bytes),
  });

describe("evidence items and the payload of each kind", () => {
  it("validates the payload against the kind (400 from the schema), http(s) only, and audits the create", async () => {
    expect((await createEvidence({ kind: "note", title: "No body" })).status).toBe(400);
    expect((await createEvidence({ kind: "external_link", title: "Bad", url: "javascript:alert(1)" })).status).toBe(
      400,
    );
    expect(
      (
        await createEvidence({
          kind: "note",
          title: "Range",
          noteBody: "x",
          observationStart: "2026-03-01",
          observationEnd: "2026-02-01",
        })
      ).status,
    ).toBe(400);
    expect(
      (await createEvidence({ kind: "note", title: "Bad date", noteBody: "x", observationStart: "2026-02-30" })).status,
    ).toBe(400);
    const ok = await createEvidence({ kind: "note", title: "Synthetic note", noteBody: "Synthetic" });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ reviewStatus: "unverified", accessibilityStatus: "unchecked", version: 1 });
    expect((await auditOf(api.db, ok.body.id)).map((e) => e.action)).toEqual(["evidence.create"]);
  });
});

describe("review (verification) rules", () => {
  it("the creator cannot review their own evidence (403); a reviewer verifies only accessible content (422 otherwise)", async () => {
    const e = await createEvidence({
      kind: "external_link",
      title: "Synthetic report",
      url: "https://intranet.example.invalid/r",
    });
    const own = await review(
      e.body.id,
      1,
      { result: "verified", accessibilityStatus: "accessible", note: "Self" },
      p.lead.session,
    );
    expect([own.status, own.body.code]).toEqual([403, "evidence.reviewer_is_creator"]);
    const inaccessible = await review(e.body.id, 1, {
      result: "verified",
      accessibilityStatus: "inaccessible",
      note: "x",
    });
    expect([inaccessible.status, inaccessible.body.code]).toEqual([422, "evidence.verification_requires_accessible"]);
    const verified = await review(e.body.id, 1, {
      result: "verified",
      accessibilityStatus: "accessible",
      note: "Opened it",
    });
    expect(verified.status).toBe(200);
    expect(verified.body).toMatchObject({ reviewStatus: "verified", reviewedBy: p.office.id, version: 2 });
    // Changing the URL after verification resets the review (the verification is bound to what was reviewed).
    const changed = await call(api.app, "PATCH", `${T}/evidence/${e.body.id}`, {
      session: p.lead.session,
      headers: ifm(2),
      body: { url: "https://intranet.example.invalid/other" },
    });
    expect(changed.body).toMatchObject({
      reviewStatus: "unverified",
      reviewedBy: null,
      accessibilityStatus: "unchecked",
    });
  });

  it("a bare filename reference can never be verified (422) and stays unverified", async () => {
    const e = await createEvidence({ kind: "file_reference", title: "Board pack", fileName: "board-pack.pptx" });
    const res = await review(e.body.id, 1, { result: "verified", accessibilityStatus: "accessible", note: "x" });
    expect([res.status, res.body.code]).toEqual([422, "evidence.filename_never_verified"]);
    const rejected = await review(e.body.id, 1, {
      result: "rejected",
      accessibilityStatus: "inaccessible",
      note: "No file",
    });
    expect(rejected.body.reviewStatus).toBe("rejected");
  });

  it("a file needs uploaded content before it can be verified; a new revision resets it to unverified", async () => {
    const e = await createEvidence({ kind: "file", title: "Synthetic extract" });
    const early = await review(e.body.id, 1, { result: "verified", accessibilityStatus: "accessible", note: "x" });
    expect([early.status, early.body.code]).toEqual([422, "evidence.no_content"]);
    const up1 = await upload(e.body.id, 1, "a,b\n1,2\n");
    expect(up1.status).toBe(200);
    expect(up1.body.currentContentId).not.toBeNull();
    const v = await review(e.body.id, 2, { result: "verified", accessibilityStatus: "accessible", note: "Checked" });
    expect(v.body).toMatchObject({ reviewStatus: "verified", reviewedContentId: up1.body.currentContentId });
    const up2 = await upload(e.body.id, 3, "a,b\n1,3\n");
    expect(up2.body).toMatchObject({ reviewStatus: "unverified", reviewedContentId: null, version: 4 });
    expect(up2.body.currentContentId).not.toBe(up1.body.currentContentId);
    const revisions = await api.db
      .selectFrom("evidence_content")
      .select(["revision", "sha256", "size_bytes"])
      .where("evidence_id", "=", e.body.id)
      .orderBy("revision")
      .execute();
    expect(revisions.map((r) => [r.revision, r.size_bytes])).toEqual([
      [1, "8"],
      [2, "8"],
    ]);
    expect(revisions[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
    // Download returns the CURRENT revision, as an attachment, never sniffed.
    const dl = await call(api.app, "GET", `${T}/evidence/${e.body.id}/content`, { session: p.auditor.session });
    expect(dl.status).toBe(200);
    expect(dl.body).toBe("a,b\n1,3\n");
    expect(dl.headers["content-disposition"]).toMatch(/^attachment;/);
    expect(dl.headers["x-content-type-options"]).toBe("nosniff");
    // Someone who cannot read the transformation cannot tell the content exists.
    const nobody = await signIn(api.app, w.nobody.subject);
    expect((await call(api.app, "GET", `${T}/evidence/${e.body.id}/content`, { session: nobody })).status).toBe(404);
    // Uploading to a non-file item is refused; a missing If-Match is 428.
    const note = await createEvidence({ kind: "note", title: "n", noteBody: "n" });
    expect((await upload(note.body.id, 1, "x")).body.code).toBe("evidence.not_a_file");
    const noIfMatch = await call(api.app, "POST", `${T}/evidence/${e.body.id}/content`, {
      session: p.lead.session,
      headers: { "content-type": "application/octet-stream", "x-file-name": "x.csv" },
      body: Buffer.from("x"),
    });
    expect(noIfMatch.status).toBe(428);
  });
});

describe("links", () => {
  it("links only to a record of the same transformation (422 otherwise); duplicate active link 409; remove keeps the row", async () => {
    const e = await createEvidence({ kind: "note", title: "Linkable", noteBody: "x" });
    const other = await setupP2World(api, w);
    const otherItems = await call(
      api.app,
      "GET",
      `/api/v1/transformations/${other.transformationId}/diagnostic-items`,
      {
        session: other.lead.session,
      },
    );
    const cross = await call(api.app, "POST", `${T}/evidence-links`, {
      session: p.lead.session,
      body: { evidenceId: e.body.id, recordType: "diagnostic_item", recordId: otherItems.body.items[0].id },
    });
    expect([cross.status, cross.body.code]).toEqual([422, "validation.reference"]);
    const items = await call(api.app, "GET", `${T}/diagnostic-items`, { session: p.lead.session });
    const body = { evidenceId: e.body.id, recordType: "diagnostic_item", recordId: items.body.items[0].id };
    const link = await call(api.app, "POST", `${T}/evidence-links`, { session: p.lead.session, body });
    expect(link.status).toBe(201);
    expect((await call(api.app, "POST", `${T}/evidence-links`, { session: p.lead.session, body })).status).toBe(409);
    // A contributor (WL) may link only to records they may edit: not someone else's T01 row (diagnostic.contribute own).
    const wl = await call(api.app, "POST", `${T}/evidence-links`, {
      session: p.contributor.session,
      body: { ...body, recordId: items.body.items[1].id },
    });
    expect(wl.status).toBe(403);
    const removed = await call(api.app, "POST", `${T}/evidence-links/${link.body.id}/remove`, {
      session: p.lead.session,
      headers: ifm(1),
      body: { reason: "Synthetic unlink" },
    });
    expect(removed.body).toMatchObject({ status: "removed", removeReason: "Synthetic unlink", version: 2 });
  });

  it("a read-only auditor gets 403 on every evidence mutation, and only the denial is audited", async () => {
    const e = await createEvidence({ kind: "note", title: "AUD target", noteBody: "x" });
    const attempts = [
      call(api.app, "POST", `${T}/evidence`, { session: p.auditor.session, body: {} }),
      call(api.app, "PATCH", `${T}/evidence/${e.body.id}`, {
        session: p.auditor.session,
        headers: ifm(1),
        body: { title: "x" },
      }),
      call(api.app, "POST", `${T}/evidence/${e.body.id}/review`, {
        session: p.auditor.session,
        headers: ifm(1),
        body: {},
      }),
      call(api.app, "POST", `${T}/evidence/${e.body.id}/archive`, {
        session: p.auditor.session,
        headers: ifm(1),
        body: { reason: "nope" },
      }),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.status).toBe(403);
      expect((await auditOfRequest(api.db, String(res.headers["x-request-id"]))).map((x) => x.action)).toEqual([
        "authorization.denied",
      ]);
    }
    expect((await auditOf(api.db, e.body.id)).map((x) => x.action)).toEqual(["evidence.create"]);
  });
});
