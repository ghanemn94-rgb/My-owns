// The upload allow-list and the safe preview against a real PostgreSQL (T-DG6-BE-D; ADR-0052 §1, §2; REQ-S13-011
// "Uploads are type- and size-checked; previews are rendered safely (no active content)"; A12 "an .exe or an oversized
// file is rejected; an SVG with script is not executed in preview"; p6-work-split §E/F.6):
//  - an .exe → 422 evidence.type_not_allowed; an .exe renamed .pdf → 422 evidence.type_mismatch; oversized → 413
//    evidence.too_large (each with its params; nothing stored, the version unchanged, no audit event);
//  - every accepted upload stores detected_type and the canonical content_type, and is audited once with prior/new
//    version; a narrowed policy refuses a type the default allows and lowers the size limit;
//  - an SVG with <script> and onload uploads, its preview is 422 evidence.preview_unavailable, and its download stays
//    application/octet-stream + attachment + nosniff;
//  - a PNG, JPEG and GIF preview answers 200 with exactly the ADR-0052 §2 headers and the stored bytes; every other
//    type, a note, an item without content and a pre-P6 file (detected_type NULL) is 422; bytes that lost their magic
//    on disk are 422 (re-checked on read);
//  - authorization is the download's (ADR-0051 §4): an outsider gets 404, an in-scope reader not admitted to a
//    sensitive item 403 evidence.parent_forbidden, AUD 200 (read-only);
//  - 0118: a new evidence_content row without detected_type is refused by the database.
// All data is SYNTHETIC; nothing here touches DG0-DG7.
import { createHash } from "node:crypto";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createDb, insertAuditEvent, sql } from "@mth/db";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FilesystemEvidenceStore } from "../../../src/modules/evidence/store.ts";
import {
  call,
  createUser,
  seedWorld,
  signIn,
  startApi,
  testEvidenceDir,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { ifm, setupP2World, type P2World } from "../../support/p2-fixtures.ts";
import { CT, EXE, FIXTURES, SVG_WITH_SCRIPT, zipOf } from "../../support/upload-fixtures.ts";

let api: TestApi;
let w: World;
let p: P2World;
let T: string;
let admin: Session; // ADM_TECH @ org A: upload_policy.configure
let outsider: Session; // org A user without any assignment on this transformation
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const MAX = 26214400;
const SYSTEM = { actorType: "system" as const, actorUserId: null, source: "migration" as const };
const ALL = "pdf, docx, xlsx, pptx, csv, txt, png, jpeg, gif, svg";
const POLICY = () => `/api/v1/admin/upload-policy?organizationId=${w.orgA.id}`;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupP2World(api, w);
  T = `/api/v1/transformations/${p.transformationId}`;
  admin = await signIn(api.app, w.admin.subject);
  outsider = await signIn(api.app, (await createUser(api.db, w.orgA.id)).subject);
}, 120_000);
afterAll(() => api.close());

async function newItem(
  kind: "file" | "note" = "file",
  title = "Synthetic evidence",
): Promise<{ id: string; version: number }> {
  const res = await call(api.app, "POST", `${T}/evidence`, {
    session: p.lead.session,
    body:
      kind === "file"
        ? { kind, title, ownerUserId: p.lead.id }
        : { kind, title, ownerUserId: p.lead.id, noteBody: "Synthetic note" },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { id: res.body.id, version: res.body.version };
}
const upload = (item: { id: string; version: number }, fileName: string, bytes: Buffer) =>
  call<Body>(api.app, "POST", `${T}/evidence/${item.id}/content`, {
    session: p.lead.session,
    headers: { ...ifm(item.version), "content-type": "application/octet-stream", "x-file-name": fileName },
    body: bytes,
  });
const preview = (id: string, session: Session = p.lead.session) =>
  call<Body>(api.app, "GET", `${T}/evidence/${id}/preview`, { session });
const download = (id: string, session: Session = p.lead.session) =>
  call<Body>(api.app, "GET", `${T}/evidence/${id}/content`, { session });
const contentRows = (evidenceId: string) =>
  api.db.selectFrom("evidence_content").selectAll().where("evidence_id", "=", evidenceId).orderBy("revision").execute();
const auditCount = async (recordId: string) =>
  Number(
    (
      await api.db
        .selectFrom("audit_event")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("record_id", "=", recordId)
        .executeTakeFirstOrThrow()
    ).n,
  );
const storedFilesOf = (evidenceId: string): string[] =>
  readdirSync(testEvidenceDir(), { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && d.parentPath.includes(evidenceId))
    .map((d) => join(d.parentPath, d.name));

async function expectNothingStored(item: { id: string; version: number }, auditBefore: number) {
  expect(await contentRows(item.id)).toEqual([]);
  expect(storedFilesOf(item.id)).toEqual([]);
  expect(await auditCount(item.id)).toBe(auditBefore);
  const now = await call(api.app, "GET", `${T}/evidence/${item.id}`, { session: p.lead.session });
  expect(now.body.version).toBe(item.version);
}

describe("REQ-S13-011 A12: an .exe or an oversized file is rejected", () => {
  it("an .exe is 422 evidence.type_not_allowed with the allowed types; nothing is stored", async () => {
    const item = await newItem();
    const before = await auditCount(item.id);
    const res = await upload(item, "setup.exe", EXE);
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body).toMatchObject({
      code: "evidence.type_not_allowed",
      detail: `This file type is not allowed. Allowed types: ${ALL}.`,
      params: { allowedTypes: ALL },
    });
    await expectNothingStored(item, before);
  });

  it("an .exe renamed .pdf is 422 evidence.type_mismatch with the extension; nothing is stored", async () => {
    const item = await newItem();
    const before = await auditCount(item.id);
    const res = await upload(item, "invoice.pdf", EXE);
    expect([res.status, res.body.code, res.body.params]).toEqual([
      422,
      "evidence.type_mismatch",
      { extension: ".pdf" },
    ]);
    expect(res.body.detail).toBe("The file's content does not match its extension .pdf.");
    await expectNothingStored(item, before);
  });

  it("a file one byte over the limit is 413 evidence.too_large with maxBytes; nothing is stored", async () => {
    const item = await newItem();
    const before = await auditCount(item.id);
    const res = await upload(item, "big.txt", Buffer.alloc(MAX + 1, 0x41));
    expect([res.status, res.body.code, res.body.params]).toEqual([
      413,
      "evidence.too_large",
      { maxBytes: String(MAX) },
    ]);
    expect(res.body.detail).toBe(`Evidence content is limited to ${MAX} bytes per revision.`);
    await expectNothingStored(item, before);
    // Exactly the limit is accepted.
    const ok = await upload(item, "exact.txt", Buffer.alloc(MAX, 0x41));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it("HTML, a ZIP that is not OOXML and a macro-enabled workbook are refused", async () => {
    const html = Buffer.from("<html><script>alert(1)</script></html>");
    const zip = zipOf([["readme.txt", "synthetic"]]);
    const xlsm = zipOf([CT, ["xl/workbook.xml", "<w/>"], ["xl/vbaProject.bin", "synthetic"]]);
    for (const [name, bytes, code] of [
      ["page.html", html, "evidence.type_not_allowed"],
      ["page.txt.svg", html, "evidence.type_mismatch"],
      ["bundle.zip", zip, "evidence.type_not_allowed"],
      ["bundle.docx", zip, "evidence.type_mismatch"],
      ["model.xlsx", xlsm, "evidence.type_not_allowed"],
    ] as const) {
      const item = await newItem();
      const res = await upload(item, name, bytes);
      expect([res.status, res.body.code], name).toEqual([422, code]);
      expect(await contentRows(item.id), name).toEqual([]);
    }
  });
});

describe("accepted uploads store the detected type and the canonical media type", () => {
  it.each([
    ["report.pdf", "pdf", "application/pdf"],
    ["charter.docx", "docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["model.xlsx", "xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["deck.pptx", "pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    ["extract.csv", "csv", "text/csv"],
    ["notes.txt", "txt", "text/plain"],
    ["chart.png", "png", "image/png"],
    ["photo.jpeg", "jpeg", "image/jpeg"],
    ["anim.gif", "gif", "image/gif"],
    ["diagram.svg", "svg", "image/svg+xml"],
  ] as const)("%s → %s, %s; one audit event with prior and new version", async (name, type, media) => {
    const item = await newItem();
    const before = await auditCount(item.id);
    const bytes = new Map<string, Buffer>(Object.entries(FIXTURES)).get(type)!;
    const res = await upload(item, name, bytes);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = await contentRows(item.id);
    expect(rows.map((r) => [r.detected_type, r.content_type, r.sha256])).toEqual([
      [type, media, createHash("sha256").update(bytes).digest("hex")],
    ]);
    expect(await auditCount(item.id)).toBe(before + 1);
    const event = await api.db
      .selectFrom("audit_event")
      .selectAll()
      .where("record_id", "=", item.id)
      .where("action", "=", "evidence.upload_content")
      .executeTakeFirstOrThrow();
    expect([event.prior_version, event.new_version]).toEqual([item.version, item.version + 1]);
    expect(event.changes).toMatchObject({
      contentType: { from: null, to: type },
      contentSize: { from: null, to: bytes.length },
    });
  });
});

describe("REQ-S13-011 A12: an SVG with script is not executed in preview", () => {
  it("the SVG uploads; preview is 422 evidence.preview_unavailable; download is octet-stream + attachment", async () => {
    const item = await newItem();
    const up = await upload(item, "diagram.svg", SVG_WITH_SCRIPT);
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    const pv = await preview(item.id);
    expect([pv.status, pv.body.code, pv.body.detail]).toEqual([
      422,
      "evidence.preview_unavailable",
      "No preview is available for this file. Download it instead.",
    ]);
    expect(String(pv.headers["content-type"])).toContain("application/problem+json");
    const dl = await download(item.id);
    expect(dl.status).toBe(200);
    expect(dl.headers["content-type"]).toBe("application/octet-stream");
    expect(String(dl.headers["content-disposition"])).toMatch(/^attachment; /);
    expect(dl.headers["x-content-type-options"]).toBe("nosniff");
    expect(dl.raw.rawPayload.equals(SVG_WITH_SCRIPT)).toBe(true);
  });
});

describe("previewEvidenceContent (ADR-0052 §2)", () => {
  it.each([
    ["chart.png", "png", "image/png"],
    ["photo.jpg", "jpeg", "image/jpeg"],
    ["anim.gif", "gif", "image/gif"],
  ] as const)("%s: 200 with exactly the §2 headers and the stored bytes", async (name, type, media) => {
    const item = await newItem();
    const bytes = new Map<string, Buffer>(Object.entries(FIXTURES)).get(type)!;
    expect((await upload(item, name, bytes)).status).toBe(200);
    const res = await preview(item.id);
    expect(res.status).toBe(200);
    expect({
      "content-type": res.headers["content-type"],
      "content-disposition": res.headers["content-disposition"],
      "x-content-type-options": res.headers["x-content-type-options"],
      "content-security-policy": res.headers["content-security-policy"],
      "cross-origin-resource-policy": res.headers["cross-origin-resource-policy"],
      "cache-control": res.headers["cache-control"],
    }).toEqual({
      "content-type": media,
      "content-disposition": `inline; filename="${name}"`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      "cross-origin-resource-policy": "same-origin",
      "cache-control": "private, no-store",
    });
    expect(res.raw.rawPayload.equals(bytes)).toBe(true);
    // The download of the same file is unchanged: octet-stream + attachment.
    const dl = await download(item.id);
    expect([dl.headers["content-type"], String(dl.headers["content-disposition"]).split(";")[0]]).toEqual([
      "application/octet-stream",
      "attachment",
    ]);
  });

  it("a non-ASCII or quoted file name is sanitised in the inline disposition (no header injection)", async () => {
    const item = await newItem();
    expect((await upload(item, encodeURIComponent('رسم "بياني".png'), FIXTURES.png)).status).toBe(200);
    const res = await preview(item.id);
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toBe('inline; filename="___ _______.png"');
  });

  it.each([
    ["report.pdf", "pdf"],
    ["charter.docx", "docx"],
    ["model.xlsx", "xlsx"],
    ["deck.pptx", "pptx"],
    ["extract.csv", "csv"],
    ["notes.txt", "txt"],
    ["diagram.svg", "svg"],
  ] as const)("%s: 422 evidence.preview_unavailable", async (name, type) => {
    const item = await newItem();
    expect((await upload(item, name, new Map<string, Buffer>(Object.entries(FIXTURES)).get(type)!)).status).toBe(200);
    const res = await preview(item.id);
    expect([res.status, res.body.code]).toEqual([422, "evidence.preview_unavailable"]);
  });

  it("a note item and a file item without content: 422 evidence.preview_unavailable", async () => {
    for (const item of [await newItem("note"), await newItem("file")]) {
      const res = await preview(item.id);
      expect([res.status, res.body.code]).toEqual([422, "evidence.preview_unavailable"]);
    }
  });

  it("a file stored before P6 (detected_type NULL, octet-stream) is never previewed, even with PNG bytes; it still downloads", async () => {
    const item = await newItem();
    const contentId = uuidv7();
    const key = `${w.orgA.id}/${p.transformationId}/${item.id}/${contentId}`;
    await new FilesystemEvidenceStore(testEvidenceDir()).put(key, FIXTURES.png, MAX);
    // A DG2-shaped row, written as the owner with 0118's trigger disabled inside ONE transaction (the ALTER's lock keeps
    // every other session from inserting while it is off; nothing else ever sees it disabled), with the item's audit
    // event as every mutation needs (ADR-0004). Test-only manipulation of SYNTHETIC data.
    await createDb(api.owner)
      .transaction()
      .execute(async (tx) => {
        await sql`ALTER TABLE evidence_content DISABLE TRIGGER evidence_content_detected_type_required`.execute(tx);
        await tx
          .insertInto("evidence_content")
          .values({
            id: contentId,
            organization_id: w.orgA.id,
            transformation_id: p.transformationId,
            evidence_id: item.id,
            revision: 1,
            storage_key: key,
            sha256: createHash("sha256").update(FIXTURES.png).digest("hex"),
            size_bytes: String(FIXTURES.png.length),
            content_type: "application/octet-stream",
            detected_type: null,
            file_name: "legacy.png",
            uploaded_by: p.lead.id,
          })
          .execute();
        await sql`ALTER TABLE evidence_content ENABLE TRIGGER evidence_content_detected_type_required`.execute(tx);
        await tx
          .updateTable("evidence")
          .set({
            current_content_id: contentId,
            file_name: "legacy.png",
            version: sql<number>`version + 1`,
            updated_at: sql<Date>`now()`,
          })
          .where("id", "=", item.id)
          .execute();
        await insertAuditEvent(tx, SYSTEM, {
          action: "test.seed",
          recordType: "evidence",
          recordId: item.id,
          organizationId: w.orgA.id,
          transformationId: p.transformationId,
          priorVersion: item.version,
          newVersion: item.version + 1,
        });
      });
    const res = await preview(item.id);
    expect([res.status, res.body.code]).toEqual([422, "evidence.preview_unavailable"]);
    const dl = await download(item.id);
    expect([dl.status, dl.headers["content-type"]]).toEqual([200, "application/octet-stream"]);
    expect(dl.raw.rawPayload.equals(FIXTURES.png)).toBe(true);
  });

  it("bytes that no longer carry the stored type's magic are refused (re-checked on read)", async () => {
    const item = await newItem();
    expect((await upload(item, "chart.png", FIXTURES.png)).status).toBe(200);
    expect((await preview(item.id)).status).toBe(200);
    const [file] = storedFilesOf(item.id);
    writeFileSync(file!, Buffer.from("<svg onload=alert(1)>"));
    const res = await preview(item.id);
    expect([res.status, res.body.code]).toEqual([422, "evidence.preview_unavailable"]);
  });

  it("authorization is the download's: outsider 404, AUD 200, in-scope reader not admitted to a sensitive item 403", async () => {
    const item = await newItem();
    expect((await upload(item, "chart.png", FIXTURES.png)).status).toBe(200);
    expect((await preview(item.id, outsider)).status).toBe(404);
    expect((await download(item.id, outsider)).status).toBe(404);
    // Another organization's user.
    const otherOrg = await signIn(api.app, w.officeB.subject);
    expect((await preview(item.id, otherOrg)).status).toBe(404);
    expect((await preview(item.id, p.auditor.session)).status).toBe(200);
    expect((await preview(item.id, p.contributor.session)).status).toBe(200);
    const unknown = await preview(uuidv7());
    expect(unknown.status).toBe(404);
    const marked = await call(api.app, "PUT", `${T}/records/evidence/${item.id}/sensitivity`, {
      session: p.office.session,
      headers: { "if-match": '"0"' },
      body: { isSensitive: true, reason: "Synthetic commercial terms" },
    });
    expect(marked.status, JSON.stringify(marked.body)).toBe(200);
    const refused = await preview(item.id, p.contributor.session);
    expect([refused.status, refused.body.code]).toEqual([403, "evidence.parent_forbidden"]);
    // The uploader is a named party of the item and still previews it.
    expect((await preview(item.id)).status).toBe(200);
  });

  it("the route is a read: no audit event, no version change", async () => {
    const item = await newItem();
    const up = await upload(item, "chart.png", FIXTURES.png);
    const before = await auditCount(item.id);
    expect((await preview(item.id)).status).toBe(200);
    expect(await auditCount(item.id)).toBe(before);
    const now = await call(api.app, "GET", `${T}/evidence/${item.id}`, { session: p.lead.session });
    expect(now.body.version).toBe(up.body.version);
  });
});

describe("0118: a new evidence_content row needs detected_type", () => {
  it("an INSERT without detected_type fails with evidence_content_detected_type_required (check_violation)", async () => {
    const item = await newItem();
    const err = await api.owner
      .query(
        `INSERT INTO evidence_content (id, organization_id, transformation_id, evidence_id, revision, storage_key, sha256,
           size_bytes, content_type, file_name, uploaded_by)
         VALUES ($1, $2, $3, $4, 1, $5, $6, 1, 'application/octet-stream', 'x.bin', $7)`,
        [uuidv7(), w.orgA.id, p.transformationId, item.id, `k/${uuidv7()}`, "0".repeat(64), p.lead.id],
      )
      .then(
        () => null,
        (e: { code?: string; constraint?: string }) => e,
      );
    expect([err?.code, err?.constraint]).toEqual(["23514", "evidence_content_detected_type_required"]);
    expect(await contentRows(item.id)).toEqual([]);
  });
});

describe("the policy applies to uploads (ADR-0052 §1: a narrowed policy refuses a type the default allows)", () => {
  it("narrowed to pdf and csv with 100 bytes: png 422 naming only the policy's types, 101 bytes 413; restored after", async () => {
    const before = await call(api.app, "GET", POLICY(), { session: admin });
    expect(before.status).toBe(200);
    const narrowed = await call(api.app, "PUT", POLICY(), {
      session: admin,
      headers: { "if-match": String(before.headers["etag"]) },
      body: { allowedTypes: ["csv", "pdf"], maxBytes: 100, reason: "Synthetic narrowing for the BE-D test" },
    });
    expect(narrowed.status, JSON.stringify(narrowed.body)).toBe(200);
    try {
      const png = await newItem();
      const refused = await upload(png, "chart.png", FIXTURES.png);
      expect([refused.status, refused.body.code, refused.body.params]).toEqual([
        422,
        "evidence.type_not_allowed",
        { allowedTypes: "pdf, csv" },
      ]);
      expect(await contentRows(png.id)).toEqual([]);
      const big = await newItem();
      const tooBig = await upload(big, "a.csv", Buffer.alloc(101, 0x41));
      expect([tooBig.status, tooBig.body.code, tooBig.body.params]).toEqual([
        413,
        "evidence.too_large",
        { maxBytes: "100" },
      ]);
      expect((await upload(big, "a.csv", Buffer.alloc(100, 0x41))).status).toBe(200);
    } finally {
      const restored = await call(api.app, "PUT", POLICY(), {
        session: admin,
        headers: { "if-match": String(narrowed.headers["etag"]) },
        body: {
          allowedTypes: ["pdf", "docx", "xlsx", "pptx", "csv", "txt", "png", "jpeg", "gif", "svg"],
          maxBytes: MAX,
          reason: "Synthetic restore",
        },
      });
      expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    }
    const png = await newItem();
    expect((await upload(png, "chart.png", FIXTURES.png)).status).toBe(200);
  });
});
