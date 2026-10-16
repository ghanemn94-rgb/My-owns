// The evidence register and evidence versions (ADR-0045 §8; REQ-S13-010, M0255; p5-work-split §F.7; T-DG5-BE-O)
// against a real PostgreSQL. The literal tests of §F.7 for REQ-S13-010:
//  - an uploaded file appears in the register with its SHA-256 and version 1;
//  - a second upload makes version 2, and the versions list shows both with their checksums and upload times;
//  - a note shows no checksum and "Not stated" for a missing source (the API returns null, which every view shows as
//    "Not stated"; never blank, never invented);
//  - a reader without transformation.read -> 403; AUD reads.
// Also: links across evidence_link and the domain link tables (agenda materials), a removed link disappears, the
// filters (reviewStatus, evidenceType, recordType), cursor pagination, 404 for an item of another transformation, a
// caller holding transformation.read elsewhere -> 404, 400 on malformed input, the reads write nothing, and the
// catalogue check that every table referencing an evidence item is a link source or a stated exclusion.
// All data is SYNTHETIC; nothing here approves anything or touches the engineering gates DG0-DG7.
import { createHash } from "node:crypto";
import { sql } from "@mth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EVIDENCE_LINK_SOURCES } from "../../../src/modules/evidence/register.ts";
import { call, seedWorld, signIn, startApi, type Session, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { businessToday, plusDays, setupMeetingWorld, type MeetingWorld } from "../governance/meeting-fixtures.ts";
import { raiseAsk } from "../governance/t16-fixtures.ts";

let api: TestApi;
let w: World;
let x: MeetingWorld;
let today: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
const T = () => `/api/v1/transformations/${x.transformationId}`;
const REGISTER = () => `${T()}/evidence-register`;
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  x = await setupMeetingWorld(api, w);
  today = await businessToday(api);
}, 120_000);
afterAll(() => api.close());

async function createEvidence(body: Record<string, unknown>): Promise<{ id: string; version: number }> {
  const res = await send("POST", `${T()}/evidence`, {
    session: x.lead.session,
    body: { ownerUserId: x.lead.id, ...body },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

async function upload(e: { id: string; version: number }, bytes: Buffer, fileName: string) {
  const res = await send("POST", `${T()}/evidence/${e.id}/content`, {
    session: x.lead.session,
    headers: { ...ifm(e.version), "content-type": "application/octet-stream", "x-file-name": fileName },
    body: bytes,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as { id: string; version: number };
}

/** Every register row of the transformation (all pages). */
async function registerRows(session: Session = x.lead.session, query = ""): Promise<Body[]> {
  const rows: Body[] = [];
  let cursor: string | null = null;
  do {
    const sep = query === "" ? "?" : `?${query}&`;
    const url: string = `${REGISTER()}${sep}limit=100${cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`}`;
    const res = await send("GET", url, { session });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    rows.push(...res.body.items);
    cursor = res.body.nextCursor;
  } while (cursor !== null);
  return rows;
}

const rowOf = async (id: string, query = "") =>
  (await registerRows(x.lead.session, query)).find((r) => r.evidenceId === id);

const auditCount = async () =>
  Number(
    (
      await api.db
        .selectFrom("audit_event")
        .select((eb) => eb.fn.countAll().as("n"))
        .where("transformation_id", "=", x.transformationId)
        .executeTakeFirstOrThrow()
    ).n,
  );

describe("REQ-S13-010: the evidence register and versions", () => {
  it("an uploaded file appears with its SHA-256 and version 1; a second upload is version 2, both listed", async () => {
    const e = await createEvidence({
      kind: "file",
      title: "Synthetic baseline extract",
      evidenceType: "data_extract",
      source: "Synthetic billing system export",
      observationStart: "2026-01-01",
      observationEnd: "2026-03-31",
    });
    const v1 = Buffer.from("period,value\n2026-Q1,100\n");
    const afterV1 = await upload(e, v1, "baseline-q1.csv");
    const r1 = await rowOf(e.id);
    expect(r1).toMatchObject({
      evidenceId: e.id,
      title: "Synthetic baseline extract",
      kind: "file",
      evidenceType: "data_extract",
      source: "Synthetic billing system export",
      ownerUserId: x.lead.id,
      observationStart: "2026-01-01",
      observationEnd: "2026-03-31",
      currentRevision: 1,
      recordVersion: afterV1.version,
      sha256: sha(v1),
      reviewStatus: "unverified",
      status: "active",
      links: [],
    });

    const v2 = Buffer.from("period,value\n2026-Q1,100\n2026-Q2,120\n");
    const afterV2 = await upload(afterV1, v2, "baseline-q2.csv");
    const r2 = await rowOf(e.id);
    expect(r2).toMatchObject({ currentRevision: 2, sha256: sha(v2), recordVersion: afterV2.version });

    const before = await auditCount();
    const versions = await send("GET", `${T()}/evidence/${e.id}/versions`, { session: x.lead.session });
    expect(versions.status).toBe(200);
    expect(versions.body.nextCursor).toBeNull();
    const items = versions.body.items as Body[];
    expect(items.map((v) => [v.revision, v.sha256, v.sizeBytes, v.fileName])).toEqual([
      [2, sha(v2), v2.length, "baseline-q2.csv"],
      [1, sha(v1), v1.length, "baseline-q1.csv"],
    ]);
    for (const v of items) {
      expect(v.uploadedBy).toBe(x.lead.id);
      expect(Number.isNaN(Date.parse(v.uploadedAt))).toBe(false);
    }
    expect(Date.parse(items[0].uploadedAt)).toBeGreaterThanOrEqual(Date.parse(items[1].uploadedAt));
    // The register's upload date is the current revision's.
    expect(r2!.uploadedAt).toBe(items[0].uploadedAt);
    // The rows equal the DG2 content revisions (append-only), and reading wrote nothing.
    const stored = await api.db
      .selectFrom("evidence_content")
      .select(["id", "revision", "sha256"])
      .where("evidence_id", "=", e.id)
      .orderBy("revision", "desc")
      .execute();
    expect(items.map((v) => [v.contentId, v.revision, v.sha256])).toEqual(
      stored.map((s) => [s.id, s.revision, s.sha256.trim()]),
    );
    expect(await auditCount()).toBe(before);

    // Pagination of the versions: one per page, newest first.
    const p1 = await send("GET", `${T()}/evidence/${e.id}/versions?limit=1`, { session: x.lead.session });
    expect(p1.body.items.map((v: Body) => v.revision)).toEqual([2]);
    const p2 = await send(
      "GET",
      `${T()}/evidence/${e.id}/versions?limit=1&cursor=${encodeURIComponent(p1.body.nextCursor)}`,
      { session: x.lead.session },
    );
    expect(p2.body.items.map((v: Body) => v.revision)).toEqual([1]);
    expect(p2.body.nextCursor).toBeNull();
  });

  it("a note shows no checksum, no revision, and a null (Not stated) source and observation period", async () => {
    const n = await createEvidence({ kind: "note", title: "Synthetic interview note", noteBody: "Synthetic notes" });
    const r = await rowOf(n.id);
    const created = await api.db
      .selectFrom("evidence")
      .select("created_at")
      .where("id", "=", n.id)
      .executeTakeFirstOrThrow();
    expect(r).toMatchObject({
      kind: "note",
      source: null,
      observationStart: null,
      observationEnd: null,
      sha256: null,
      currentRevision: null,
      recordVersion: n.version,
      uploadedAt: created.created_at.toISOString(),
    });
    const versions = await send("GET", `${T()}/evidence/${n.id}/versions`, { session: x.lead.session });
    expect(versions.status).toBe(200);
    expect(versions.body).toEqual({ items: [], nextCursor: null });
  });

  it("lists every active link across evidence_link and the domain link tables; a removed link disappears", async () => {
    const e = await createEvidence({ kind: "note", title: "Synthetic decision memo", noteBody: "Synthetic memo" });
    const ask = await raiseAsk(send, x, x.sponsor.id, plusDays(today, 20));
    const link = await send("POST", `${T()}/evidence-links`, {
      session: x.lead.session,
      body: { evidenceId: e.id, recordType: "decision", recordId: ask.id },
    });
    expect(link.status, JSON.stringify(link.body)).toBe(201);
    // A DG4 agenda item citing the evidence as material (the agenda_item domain link).
    const m = await send("POST", `${T()}/meetings`, {
      session: x.lead.session,
      body: {
        forumId: x.forums.transformation_review,
        scheduledDate: plusDays(today, 10),
        startTime: "09:00",
        durationMinutes: 60,
      },
    });
    expect(m.status, JSON.stringify(m.body)).toBe(201);
    const item = await send("POST", `${T()}/meetings/${m.body.id}/agenda-items`, {
      session: x.lead.session,
      body: { itemKind: "discussion", title: "Synthetic: review the memo", materialsEvidenceIds: [e.id] },
    });
    expect(item.status, JSON.stringify(item.body)).toBe(201);

    const r = await rowOf(e.id);
    expect(r.links).toEqual(
      [
        { recordType: "agenda_item", recordId: item.body.id, via: "agenda_item" },
        { recordType: "decision", recordId: ask.id, via: "evidence_link" },
      ].sort((a, b) => a.via.localeCompare(b.via)),
    );
    // The recordType filter keeps items with an active link of that type, only.
    expect((await registerRows(x.lead.session, "recordType=decision")).map((i) => i.evidenceId)).toContain(e.id);
    expect((await registerRows(x.lead.session, "recordType=agenda_item")).map((i) => i.evidenceId)).toContain(e.id);
    expect(await rowOf(e.id, "recordType=benefit")).toBeUndefined();

    const removed = await send("POST", `${T()}/evidence-links/${link.body.id}/remove`, {
      session: x.lead.session,
      headers: ifm(link.body.version),
      body: { reason: "Synthetic: linked to the wrong record" },
    });
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);
    expect((await rowOf(e.id)).links).toEqual([
      { recordType: "agenda_item", recordId: item.body.id, via: "agenda_item" },
    ]);
    expect(await rowOf(e.id, "recordType=decision")).toBeUndefined();
  });

  it("filters by review status and evidence type, and pages with a cursor", async () => {
    const a = await createEvidence({
      kind: "note",
      title: "Synthetic analysis A",
      noteBody: "A",
      evidenceType: "analysis",
    });
    const b = await createEvidence({
      kind: "note",
      title: "Synthetic analysis B",
      noteBody: "B",
      evidenceType: "analysis",
    });
    const analysis = await registerRows(x.lead.session, "evidenceType=analysis");
    expect(analysis.map((r) => r.evidenceId)).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(analysis.every((r) => r.evidenceType === "analysis")).toBe(true);
    expect((await registerRows(x.lead.session, "reviewStatus=verified")).map((r) => r.evidenceId)).not.toContain(a.id);
    expect(
      (await registerRows(x.lead.session, "reviewStatus=unverified")).every((r) => r.reviewStatus === "unverified"),
    ).toBe(true);
    // Pages of one, newest first, cover every item exactly once.
    const all = await registerRows();
    const paged: string[] = [];
    let cursor: string | null = null;
    do {
      const url: string = `${REGISTER()}?limit=1${cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`}`;
      const res = await send("GET", url, { session: x.lead.session });
      expect(res.body.items.length).toBeLessThanOrEqual(1);
      paged.push(...res.body.items.map((r: Body) => r.evidenceId));
      cursor = res.body.nextCursor;
    } while (cursor !== null);
    expect(paged).toEqual(all.map((r) => r.evidenceId));
    expect([...paged].sort().reverse()).toEqual(paged);
    // A cursor of other filters is refused.
    const first = await send("GET", `${REGISTER()}?limit=1`, { session: x.lead.session });
    expect(
      (
        await send(
          "GET",
          `${REGISTER()}?limit=1&evidenceType=analysis&cursor=${encodeURIComponent(first.body.nextCursor)}`,
          {
            session: x.lead.session,
          },
        )
      ).status,
    ).toBe(400);
  });

  it("every table that references an evidence item is a link source or a stated exclusion (catalogue)", async () => {
    const rows = await sql<{ relname: string }>`
      SELECT DISTINCT cl.relname FROM pg_constraint c JOIN pg_class cl ON cl.oid = c.conrelid
       WHERE c.contype = 'f' AND c.confrelid = 'evidence'::regclass ORDER BY cl.relname`.execute(api.db);
    // evidence_content: the item's own revisions (the versions list); report_snapshot_evidence: what a snapshot cites
    // (listReportSnapshotEvidence), not a link of the item to a record.
    const excluded = new Set(["evidence_content", "report_snapshot_evidence"]);
    const sources = new Set(EVIDENCE_LINK_SOURCES.map((s) => s.via));
    expect(rows.rows.map((r) => r.relname).filter((t) => !excluded.has(t) && !sources.has(t))).toEqual([]);
  });
});

describe("evidence register authorization (transformation.read; AUD reads)", () => {
  let evidenceId: string;
  let nobody: Session;
  let officeB: Session;
  beforeAll(async () => {
    evidenceId = (await createEvidence({ kind: "note", title: "Synthetic auth note", noteBody: "Synthetic" })).id;
    nobody = await signIn(api.app, w.nobody.subject);
    officeB = await signIn(api.app, w.officeB.subject);
  });

  it("AUD reads the register and the versions", async () => {
    expect((await registerRows(x.auditor.session)).map((r) => r.evidenceId)).toContain(evidenceId);
    expect((await send("GET", `${T()}/evidence/${evidenceId}/versions`, { session: x.auditor.session })).status).toBe(
      200,
    );
  });

  it("a reader without transformation.read is 403; one holding it elsewhere is 404; anonymous 401", async () => {
    for (const url of [REGISTER(), `${T()}/evidence/${evidenceId}/versions`]) {
      expect((await send("GET", url, { session: nobody })).status, url).toBe(403);
      expect((await send("GET", url, { session: officeB })).status, url).toBe(404);
      expect((await send("GET", url)).status, url).toBe(401);
    }
  });

  it("an item of another transformation, or an unknown item, is 404 on the versions list", async () => {
    const other = await send("POST", "/api/v1/transformations", {
      session: x.lead.session,
      body: { businessUnitId: w.a1, name: "Synthetic second transformation", mode: "end_to_end" },
    });
    expect(other.status).toBe(201);
    const foreign = await send("POST", `/api/v1/transformations/${other.body.id}/evidence`, {
      session: x.lead.session,
      body: { kind: "note", title: "Synthetic foreign note", noteBody: "Synthetic", ownerUserId: x.lead.id },
    });
    expect(foreign.status).toBe(201);
    expect((await send("GET", `${T()}/evidence/${foreign.body.id}/versions`, { session: x.lead.session })).status).toBe(
      404,
    );
    expect(
      (await send("GET", `${T()}/evidence/${crypto.randomUUID()}/versions`, { session: x.lead.session })).status,
    ).toBe(404);
    // The other transformation's item is not in this register.
    expect((await registerRows()).map((r) => r.evidenceId)).not.toContain(foreign.body.id);
  });

  it("malformed input is 400", async () => {
    for (const q of ["reviewStatus=nope", "evidenceType=nope", "recordType=Bad-Type", "limit=0", "x=1", "cursor=nope"])
      expect((await send("GET", `${REGISTER()}?${q}`, { session: x.lead.session })).status, q).toBe(400);
    expect((await send("GET", `${T()}/evidence/nope/versions`, { session: x.lead.session })).status).toBe(400);
    expect((await send("GET", `${T()}/evidence/${evidenceId}/versions?x=1`, { session: x.lead.session })).status).toBe(
      400,
    );
  });
});
