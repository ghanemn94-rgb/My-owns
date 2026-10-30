// Administration > Storage and the evidence driver selection (ADR-0054 §2, §4, §5; REQ-S16-006 "A18;A12: contract
// tests pass for both adapters; evidence is never served from a public URL"; p6-work-split §J/C.9; T-DG6-BE-H2) against
// a real PostgreSQL. The storage setting is installation-wide, and the integration files of one run may execute
// concurrently on the shared run database, so this suite runs on its OWN scratch database (the scoring-defaults
// pattern). It proves:
//  - with no row the behaviour equals DG5: driver filesystem from the environment, ETag "0", uploads land in the
//    filesystem store with storage_driver 'filesystem';
//  - putStorageSetting without a passing test is 422 storage.test_required (nothing written); after a passing test of
//    the same values it saves; a NEW upload then lands in the fake S3 with storage_driver 's3', and the earlier
//    filesystem file is still downloadable; switching back to filesystem keeps the s3 file readable;
//  - every refusal of ADR-0054 §4 this operation can produce, 409/428, the commit-time re-check (a grant revoked while
//    the request waits is 403 and nothing is written), AUD read-only (200 on GET, 403 on PUT and test), one audit
//    event per PUT with prior and new version, the trigger-written history row;
//  - the test route never returns a URL, an endpoint, a key or a credential, leaves no probe object behind, and fails
//    (anonymous_read_refused) against a store that serves anonymous reads;
//  - A12: the download of an s3-held file is proxied (200, the bytes, attachment), never a redirect or a store URL.
// All data is SYNTHETIC (the fake S3 is in-process; no real object store is contacted); nothing approves anything or
// touches DG0-DG7.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { migrate } from "@mth/db";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { FakeS3 } from "../../support/fake-s3.ts";
import {
  auditOf,
  call,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  testEvidenceDir,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { ifm, setupP2World, type P2World } from "../../support/p2-fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
let scratchDb: string;
let api: TestApi;
let w: World;
let p: P2World;
let T: string;
let admin: Session; // ADM_TECH @ org A (storage.configure)
let auditor: Session; // AUD @ org A (operations.read)
let nobody: Session;
let fake: FakeS3;
let openStore: FakeS3; // NEGATIVE FIXTURE: serves anonymous reads
const BUCKET = "mth-evidence";
const ACCESS_VAR = "MTH_IT_STORAGE_S3_ACCESS";
const SECRET_VAR = "MTH_IT_STORAGE_S3_SECRET";
const S = "/api/v1/admin/storage";
const TEST = "/api/v1/admin/storage/test";
const PDF = (text: string) => Buffer.from(`%PDF-1.7\n% synthetic ${text}\n%%EOF\n`);

const s3Of = (store: FakeS3, over: Record<string, unknown> = {}) => ({
  endpoint: store.endpoint,
  region: store.region,
  bucket: BUCKET,
  keyPrefix: "hub",
  forcePathStyle: true,
  accessKeyRef: { provider: "env", name: ACCESS_VAR },
  secretKeyRef: { provider: "env", name: SECRET_VAR },
  ...over,
});
const putSetting = (body: unknown, ifMatch: string | null, session: Session = admin) =>
  call<Body>(api.app, "PUT", S, { session, body, headers: ifMatch === null ? {} : { "if-match": ifMatch } });
const runTest = (candidate: unknown, session: Session = admin) =>
  call<Body>(api.app, "POST", TEST, { session, body: { candidate } });
const getSetting = (session: Session = admin) => call<Body>(api.app, "GET", S, { session });
const settingRow = () => api.db.selectFrom("storage_setting").selectAll().executeTakeFirst();
const history = () => api.db.selectFrom("storage_setting_change").selectAll().orderBy("record_version").execute();

async function newItem(): Promise<{ id: string; version: number }> {
  const res = await call<Body>(api.app, "POST", `${T}/evidence`, {
    session: p.lead.session,
    body: { kind: "file", title: "Synthetic storage evidence", ownerUserId: p.lead.id },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { id: res.body.id, version: res.body.version };
}
async function upload(item: { id: string; version: number }, bytes: Buffer) {
  const res = await call<Body>(api.app, "POST", `${T}/evidence/${item.id}/content`, {
    session: p.lead.session,
    headers: { ...ifm(item.version), "content-type": "application/octet-stream", "x-file-name": "synthetic.pdf" },
    body: bytes,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const content = await api.db
    .selectFrom("evidence_content")
    .selectAll()
    .where("evidence_id", "=", item.id)
    .orderBy("revision", "desc")
    .executeTakeFirstOrThrow();
  return content;
}
const download = (id: string) => call<Body>(api.app, "GET", `${T}/evidence/${id}/content`, { session: p.lead.session });
const bytesOf = (res: { raw: { rawPayload: Buffer } }) => res.raw.rawPayload;

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratchDb = await createScratchDatabase(adminUrl, "mth_storage");
  await migrate(roleUrl(adminUrl, scratchDb, "mth_owner"));
  fake = new FakeS3({ buckets: [BUCKET] });
  await fake.start();
  openStore = new FakeS3({ buckets: [BUCKET], credentials: fake.credentials, publicRead: true });
  await openStore.start();
  process.env[ACCESS_VAR] = fake.credentials[0]!.accessKeyId;
  process.env[SECRET_VAR] = fake.credentials[0]!.secretAccessKey;
  api = await startApi({ database: scratchDb });
  w = await seedWorld(api.db);
  p = await setupP2World(api, w);
  T = `/api/v1/transformations/${p.transformationId}`;
  admin = await signIn(api.app, w.admin.subject);
  auditor = await signIn(api.app, w.auditor.subject);
  nobody = await signIn(api.app, w.nobody.subject);
}, 180_000);
afterAll(async () => {
  delete process.env[ACCESS_VAR];
  delete process.env[SECRET_VAR];
  await api?.close();
  await fake?.stop();
  await openStore?.stop();
  if (scratchDb) await dropScratchDatabase(inject("mthDb").adminUrl, scratchDb);
});

// The tests below run in order: they share the one installation-wide setting row of the scratch database.
describe("REQ-S16-006: driver selection, Administration > Storage", () => {
  let fsItem: { id: string; version: number };
  let fsBytes: Buffer;
  let s3Item: { id: string; version: number };
  let s3Bytes: Buffer;

  it('with no row the behaviour equals DG5: filesystem from the environment, ETag "0", uploads stay filesystem', async () => {
    const res = await getSetting();
    expect(res.status).toBe(200);
    expect(res.headers["etag"]).toBe('"0"');
    expect(res.body).toEqual({
      driver: "filesystem",
      source: "environment",
      s3: null,
      publicUrls: false,
      reason: null,
      version: 0,
      updatedAt: null,
    });
    fsItem = await newItem();
    fsBytes = PDF("filesystem-file");
    const content = await upload(fsItem, fsBytes);
    expect(content.storage_driver).toBe("filesystem");
    expect(existsSync(join(testEvidenceDir(), content.storage_key))).toBe(true);
    expect(fake.keys(BUCKET)).toEqual([]);
    expect(await settingRow()).toBeUndefined();
  });

  it("AUD reads through operations.read; a user with neither code gets 403; AUD gets 403 on PUT and test", async () => {
    expect((await getSetting(auditor)).status).toBe(200);
    expect((await getSetting(nobody)).status).toBe(403);
    const put = await putSetting(
      { driver: "filesystem", s3: null, reason: "Synthetic auditor attempt" },
      '"0"',
      auditor,
    );
    expect(put.status).toBe(403);
    expect((await runTest(null, auditor)).status).toBe(403);
    expect(await settingRow()).toBeUndefined();
  });

  it("storage.configure below organization scope does not admit it (installation-wide setting)", async () => {
    const user = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, user.id, "ADM_TECH", { type: "business_unit", id: w.a1 }, w.orgA.id);
    const session = await signIn(api.app, user.subject);
    expect((await getSetting(session)).status).toBe(403);
    expect((await runTest(null, session)).status).toBe(403);
  });

  it("putStorageSetting s3 without a passing test is 422 storage.test_required; nothing is written", async () => {
    const res = await putSetting({ driver: "s3", s3: s3Of(fake), reason: "Synthetic: use the object store" }, '"0"');
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      code: "storage.test_required",
      detail: "Run a successful storage test with these settings before saving them.",
    });
    expect(await settingRow()).toBeUndefined();
  });

  it("the ADR-0054 §4 refusals: s3_incomplete, secret_ref_invalid (a value, an unknown provider), reason_required", async () => {
    const incomplete = await putSetting({ driver: "s3", s3: null, reason: "Synthetic" }, '"0"');
    expect(incomplete.body).toMatchObject({
      code: "storage.s3_incomplete",
      detail: "The object store needs an endpoint, a region, a bucket and both credential references.",
    });
    const SECRET_CANARY = "synthetic-canary-s3-secret-91c4";
    for (const bad of [SECRET_CANARY, { provider: "vault_unregistered", name: "X" }, { provider: "env" }]) {
      const res = await putSetting({ driver: "s3", s3: s3Of(fake, { secretKeyRef: bad }), reason: "Synthetic" }, '"0"');
      expect([res.status, res.body.code]).toEqual([422, "storage.secret_ref_invalid"]);
      expect(res.body.detail).toBe(
        "A credential must be a reference to a secret (provider and name), never the secret itself.",
      );
      expect(JSON.stringify(res.body)).not.toContain(SECRET_CANARY);
      const tested = await runTest(s3Of(fake, { secretKeyRef: bad }));
      expect([tested.status, tested.body.code]).toEqual([422, "storage.secret_ref_invalid"]);
    }
    const reason = await putSetting({ driver: "filesystem", s3: null, reason: "  " }, '"0"');
    expect(reason.body).toMatchObject({ code: "admin.reason_required" });
    expect((await putSetting({ driver: "tape", s3: null, reason: "Synthetic" }, '"0"')).status).toBe(400);
    expect((await putSetting({ driver: "filesystem", s3: null, reason: "Synthetic" }, null)).status).toBe(428);
    expect(await settingRow()).toBeUndefined();
  });

  it("the test never returns a URL, endpoint, key or credential, leaves nothing behind, and is audited", async () => {
    const res = await runTest(s3Of(fake));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      outcome: "passed",
      driver: "s3",
      errorCode: null,
      checks: [
        { name: "write", outcome: "passed" },
        { name: "read_back", outcome: "passed" },
        { name: "checksum", outcome: "passed" },
        { name: "delete", outcome: "passed" },
        { name: "anonymous_read_refused", outcome: "passed" },
      ],
    });
    const text = JSON.stringify(res.body);
    for (const leak of [fake.endpoint, "127.0.0.1", "http", BUCKET, "storage-test/", fake.credentials[0]!.accessKeyId])
      expect(text).not.toContain(leak);
    expect(fake.keys(BUCKET)).toEqual([]);
    // The anonymous GET the test made was refused by the store (no Authorization header).
    expect(fake.requests.some((r) => r.operation === "Refused" && r.method === "GET")).toBe(true);
    const events = await api.db
      .selectFrom("audit_event")
      .selectAll()
      .where("action", "=", "storage_setting.tested")
      .where("actor_user_id", "=", w.admin.id)
      .execute();
    expect(events.length).toBeGreaterThanOrEqual(1);
    const auditText = JSON.stringify(events);
    for (const leak of [fake.endpoint, fake.credentials[0]!.accessKeyId, fake.credentials[0]!.secretAccessKey])
      expect(auditText).not.toContain(leak);
    // The filesystem store tests too (no anonymous check there).
    const local = await runTest(null);
    expect(local.body).toMatchObject({ outcome: "passed", driver: "filesystem" });
    expect(local.body.checks.find((c: { name: string }) => c.name === "anonymous_read_refused").outcome).toBe(
      "skipped",
    );
  });

  it("a store that serves anonymous reads fails the test, and those values cannot be saved", async () => {
    const res = await runTest(s3Of(openStore));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ outcome: "failed", errorCode: "storage.anonymous_read_allowed" });
    expect(openStore.keys(BUCKET)).toEqual([]);
    const put = await putSetting({ driver: "s3", s3: s3Of(openStore), reason: "Synthetic open store" }, '"0"');
    expect(put.body.code).toBe("storage.test_required");
  });

  it("wrong credentials fail the write check (failed outcome, no save admitted)", async () => {
    const res = await runTest(s3Of(fake, { secretKeyRef: { provider: "env", name: "MTH_IT_STORAGE_UNSET" } }));
    expect(res.body).toMatchObject({ outcome: "failed", errorCode: "storage.write_failed" });
    expect(res.body.checks.slice(1).every((c: { outcome: string }) => c.outcome === "skipped")).toBe(true);
  });

  it("a grant revoked while the PUT waits is 403 at commit time and nothing is written", async () => {
    await expect(runTest(s3Of(fake))).resolves.toMatchObject({ status: 200 });
    const user = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, user.id, "ADM_TECH", { type: "organization", id: w.orgA.id }, w.orgA.id);
    const session = await signIn(api.app, user.subject);
    const res = await afterIdentity(
      api,
      user.id,
      () => putSetting({ driver: "s3", s3: s3Of(fake), reason: "Synthetic revoked" }, '"0"', session),
      () => revokeAll(api, w.grantor.id, user.id),
    );
    expect(res.status).toBe(403);
    expect(await settingRow()).toBeUndefined();
  });

  it("after a passing test the s3 setting saves (audited, history); a new upload lands in the fake S3", async () => {
    await expect(runTest(s3Of(fake))).resolves.toMatchObject({ status: 200, body: { outcome: "passed" } });
    const res = await putSetting({ driver: "s3", s3: s3Of(fake), reason: "Synthetic: use the object store" }, '"0"');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.headers["etag"]).toBe('"1"');
    expect(res.body).toMatchObject({ driver: "s3", source: "setting", publicUrls: false, version: 1 });
    expect(res.body.s3).toEqual(s3Of(fake));
    const row = (await settingRow())!;
    expect(row.s3_secret_key_ref).toEqual({ provider: "env", name: SECRET_VAR });
    const events = (await auditOf(api.db, row.id)).filter((e) => e.action === "storage_setting.changed");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ prior_version: null, new_version: 1, reason: "Synthetic: use the object store" });
    expect(JSON.stringify(events[0])).not.toContain(fake.credentials[0]!.secretAccessKey);
    expect((await history()).map((h) => [h.record_version, h.driver])).toEqual([[1, "s3"]]);
    // A stale "0" is now 409.
    expect((await putSetting({ driver: "filesystem", s3: null, reason: "Synthetic" }, '"0"')).status).toBe(409);

    s3Item = await newItem();
    s3Bytes = PDF("object-store-file");
    const content = await upload(s3Item, s3Bytes);
    expect(content.storage_driver).toBe("s3");
    expect(fake.keys(BUCKET)).toEqual([`hub/${content.storage_key}`]);
    expect(fake.object(BUCKET, `hub/${content.storage_key}`)!.equals(s3Bytes)).toBe(true);
    expect(existsSync(join(testEvidenceDir(), content.storage_key))).toBe(false);
    expect(content.sha256).toBe(createHash("sha256").update(s3Bytes).digest("hex"));
  });

  it("A12: both files download through the API (proxied bytes, attachment), never a redirect or a store URL", async () => {
    for (const [item, bytes] of [
      [fsItem, fsBytes],
      [s3Item, s3Bytes],
    ] as const) {
      const res = await download(item.id);
      expect(res.status).toBe(200);
      expect(res.headers["location"]).toBeUndefined();
      expect(res.headers["content-type"]).toBe("application/octet-stream");
      expect(String(res.headers["content-disposition"])).toMatch(/^attachment/);
      expect(bytesOf(res).equals(bytes)).toBe(true);
      expect(JSON.stringify(res.headers)).not.toContain(fake.endpoint);
    }
    // The store itself refuses an anonymous read of the object (no public URL exists).
    const content = await api.db
      .selectFrom("evidence_content")
      .select("storage_key")
      .where("evidence_id", "=", s3Item.id)
      .executeTakeFirstOrThrow();
    const anonymous = await fetch(`${fake.endpoint}/${BUCKET}/hub/${content.storage_key}`, { redirect: "manual" });
    await anonymous.body?.cancel();
    expect(anonymous.status).toBe(403);
  });

  it("switching back to filesystem: new uploads are filesystem, the s3 file stays readable (no test needed)", async () => {
    const res = await putSetting(
      { driver: "filesystem", s3: s3Of(fake), reason: "Synthetic: back to the filesystem" },
      '"1"',
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ driver: "filesystem", source: "setting", version: 2 });
    const item = await newItem();
    const content = await upload(item, PDF("after-switch-back"));
    expect(content.storage_driver).toBe("filesystem");
    expect(existsSync(join(testEvidenceDir(), content.storage_key))).toBe(true);
    const s3Download = await download(s3Item.id);
    expect(s3Download.status).toBe(200);
    expect(bytesOf(s3Download).equals(s3Bytes)).toBe(true);
    const row = (await settingRow())!;
    const events = (await auditOf(api.db, row.id)).filter((e) => e.action === "storage_setting.changed");
    expect(events.map((e) => [e.prior_version, e.new_version])).toEqual([
      [null, 1],
      [1, 2],
    ]);
    expect((await history()).map((h) => [h.record_version, h.driver])).toEqual([
      [1, "s3"],
      [2, "filesystem"],
    ]);
    expect((await putSetting({ driver: "filesystem", s3: null, reason: "Synthetic" }, '"1"')).status).toBe(409);
  });
});
