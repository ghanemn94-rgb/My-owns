// The security suite, clauses "disallowed upload type" and "oversized upload" (T-DG6-BE-E2; ADR-0052 §1, §11;
// REQ-S16-030; p6-work-split §E/F.8) against a real PostgreSQL, through uploadEvidenceContent:
//  - disallowed type: an `.exe` (an `MZ` header) is 422 `evidence.type_not_allowed`; the same bytes renamed `.pdf` are
//    422 `evidence.type_mismatch` (its bytes do not start `%PDF-`). Every upload is sent as application/octet-stream
//    (the operation's only media type), so the decision rests on the bytes and the extension alone;
//  - oversized: the policy limit + 1 byte is 413 `evidence.too_large` with the limit in the text, both for the default
//    policy (26214400 bytes) and for an IT-narrowed policy (1024 bytes), while exactly the limit is accepted.
// Every refusal stores nothing: no evidence_content row, the item's version unchanged, no audit event for the request.
// All data is SYNTHETIC; nothing here approves anything or touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditOfRequest,
  call,
  seedWorld,
  signIn,
  startApi,
  type Res,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { ifm, setupP2World, type P2World } from "../../support/p2-fixtures.ts";
import { EXE, FIXTURES } from "../../support/upload-fixtures.ts";

const DEFAULT_MAX_BYTES = 26214400;
let api: TestApi;
let w: World;
let p: P2World;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const T = () => `/api/v1/transformations/${p.transformationId}`;
/** The clauses whose test passed; each prints its line only when all its cases passed. */
const passed = new Set<string>();

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupP2World(api, w);
}, 120_000);
afterAll(() => api?.close());

/** A new file evidence item owned by the lead (version 1, no content yet). */
async function fileItem(): Promise<string> {
  const created = await call<Body>(api.app, "POST", `${T()}/evidence`, {
    session: p.lead.session,
    body: { ownerUserId: p.lead.id, kind: "file", title: "Synthetic upload target" },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return created.body.id as string;
}

function upload(evidenceId: string, version: number, fileName: string, bytes: Buffer) {
  return call<Body>(api.app, "POST", `${T()}/evidence/${evidenceId}/content`, {
    session: p.lead.session,
    headers: { ...ifm(version), "content-type": "application/octet-stream", "x-file-name": fileName },
    body: bytes,
  });
}

/** The refused upload stored nothing: no content row, version unchanged, no audit event for its request. */
async function expectNothingStored(evidenceId: string, refused: Res<Body>, version = 1): Promise<void> {
  const contents = await api.db
    .selectFrom("evidence_content")
    .select("id")
    .where("evidence_id", "=", evidenceId)
    .execute();
  expect(contents.length).toBe(version - 1);
  const item = await call<Body>(api.app, "GET", `${T()}/evidence/${evidenceId}`, { session: p.lead.session });
  expect(item.body.version).toBe(version);
  expect(await auditOfRequest(api.db, refused.headers["x-request-id"] as string)).toEqual([]);
}

describe("disallowed upload type (REQ-S16-030; ADR-0052 §1)", () => {
  it("an .exe is 422 evidence.type_not_allowed (also in upper case)", async () => {
    const id = await fileItem();
    for (const name of ["setup.exe", "SETUP.EXE"]) {
      const res = await upload(id, 1, name, EXE);
      expect([res.status, res.body.code], JSON.stringify(res.body)).toEqual([422, "evidence.type_not_allowed"]);
      expect(res.body.detail).toBe(
        "This file type is not allowed. Allowed types: pdf, docx, xlsx, pptx, csv, txt, png, jpeg, gif, svg.",
      );
      expect(res.headers["content-type"]).toContain("application/problem+json");
      await expectNothingStored(id, res);
    }
  });

  it("an .exe renamed .pdf is 422 evidence.type_mismatch (its bytes do not start %PDF-)", async () => {
    const id = await fileItem();
    const res = await upload(id, 1, "report.pdf", EXE);
    expect([res.status, res.body.code], JSON.stringify(res.body)).toEqual([422, "evidence.type_mismatch"]);
    expect(res.body.detail).toBe("The file's content does not match its extension .pdf.");
    await expectNothingStored(id, res);
    // The control: a real PDF under the same name is accepted.
    const ok = await upload(id, 1, "report.pdf", FIXTURES.pdf);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    passed.add("type");
  });

  it("clause summary", () => {
    expect(passed.has("type")).toBe(true);
    console.log(
      "PASS REQ-S16-030 disallowed upload type: .exe -> 422 type_not_allowed; renamed .exe -> 422 type_mismatch",
    );
  });
});

describe("oversized upload (REQ-S16-030; ADR-0052 §1)", () => {
  it("the default policy: 26214400 + 1 bytes is 413 evidence.too_large", async () => {
    const id = await fileItem();
    const bytes = Buffer.concat([FIXTURES.txt, Buffer.alloc(DEFAULT_MAX_BYTES + 1 - FIXTURES.txt.length, 0x61)]);
    expect(bytes.length).toBe(DEFAULT_MAX_BYTES + 1);
    const res = await upload(id, 1, "notes.txt", bytes);
    expect([res.status, res.body.code], JSON.stringify(res.body).slice(0, 400)).toEqual([413, "evidence.too_large"]);
    expect(res.body.detail).toBe(`Evidence content is limited to ${DEFAULT_MAX_BYTES} bytes per revision.`);
    await expectNothingStored(id, res);
  }, 60_000);

  it("an IT-narrowed policy (1024 bytes): 1025 bytes is 413, exactly 1024 bytes is accepted", async () => {
    const admin = await signIn(api.app, w.admin.subject);
    const policy = await call<Body>(api.app, "PUT", `/api/v1/admin/upload-policy?organizationId=${w.orgA.id}`, {
      session: admin,
      headers: ifm(0),
      body: { allowedTypes: ["pdf", "csv", "txt"], maxBytes: 1024, reason: "Synthetic narrowed size limit" },
    });
    expect(policy.status, JSON.stringify(policy.body)).toBe(200);
    const id = await fileItem();
    const sized = (n: number) => Buffer.concat([FIXTURES.txt, Buffer.alloc(n - FIXTURES.txt.length, 0x61)]);
    const over = await upload(id, 1, "notes.txt", sized(1025));
    expect([over.status, over.body.code], JSON.stringify(over.body)).toEqual([413, "evidence.too_large"]);
    expect(over.body.detail).toBe("Evidence content is limited to 1024 bytes per revision.");
    await expectNothingStored(id, over);
    const exact = await upload(id, 1, "notes.txt", sized(1024));
    expect(exact.status, JSON.stringify(exact.body)).toBe(200);
    passed.add("size");
  });

  it("clause summary", () => {
    expect(passed.has("size")).toBe(true);
    console.log(
      "PASS REQ-S16-030 oversized upload: policy limit + 1 byte -> 413 evidence.too_large (default and narrowed)",
    );
  });
});
