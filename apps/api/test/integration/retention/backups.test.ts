// T-E20 (ADR-0066 §6; p7-work-split §E.1, §E.4; REQ-S19-012; T-DG7-BE-G): listBackupSets on a scratch database of this
// run's disposable PostgreSQL cluster. Two SYNTHETIC sets are recorded through backup_set_record() as the owner role
// (the backup script's one write; never granted to mth_app):
//   - newest first (by finished_at), every contract field and no other (no content field, no file path);
//   - 200 for ADM_TECH and AUD; 403 for every role without backup.read (ADM_ACCESS included) and a user without grants.
// Backups run outside the API: no route starts one. Nothing here approves anything or touches DG0-DG7.
import { createDb, createPool, migrate, sql, type Db } from "@mth/db";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import { backupSetView } from "../../../src/modules/retention/backups/routes.ts";
import {
  call,
  createOrg,
  createUser,
  grant,
  signIn,
  startApi,
  type Session,
  type TestApi,
} from "../../support/harness.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

const BASE = "/api/v1/admin/backups";
const READERS = new Set(["ADM_TECH", "AUD"]);
const H = (c: string) => c.repeat(64);

let api: TestApi;
let scratch: string;
let owner: Db;
const sessions: { role: string; session: Session }[] = [];

async function recordSet(p: Record<string, unknown>) {
  await sql`SELECT backup_set_record(${JSON.stringify(p)}::jsonb)`.execute(owner);
}

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_retention_backups_api");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  owner = createDb(createPool(roleUrl(adminUrl, scratch, "mth_owner"), { max: 2 }));
  api = await startApi({ database: scratch });
  const org = await createOrg(api.db);
  const grantor = await createUser(api.db, org.id);
  for (const { code } of await api.db.selectFrom("role").select("code").orderBy("code").execute()) {
    const u = await createUser(api.db, org.id);
    await grant(api.db, grantor.id, u.id, code, { type: "organization", id: org.id }, org.id);
    sessions.push({ role: code, session: await signIn(api.app, u.subject) });
  }
  const nobody = await createUser(api.db, org.id);
  sessions.push({ role: "(no grant)", session: await signIn(api.app, nobody.subject) });
  await recordSet({
    id: "01920007-0148-7000-8000-0000000000b1",
    label: "synthetic-older",
    status: "succeeded",
    manifestSchemaVersion: "mth-backup/1",
    startedAt: "2026-11-01T00:00:00Z",
    finishedAt: "2026-11-01T00:05:00Z",
    migrationLevel: "0148_p7_retention_job",
    serverMajor: 16,
    dumpFormat: "custom",
    dumpBytes: 12345678901,
    dumpSha256: H("a"),
    evidenceBackend: "filesystem",
    evidenceObjectCount: 3,
    evidenceBytes: 2048,
    attachmentManifestSha256: H("b"),
    configBundleSha256: H("c"),
    manifestSha256: H("d"),
    operatorName: "synthetic operator",
  });
  await recordSet({
    id: "01920007-0148-7000-8000-0000000000b2",
    label: "synthetic-newer",
    status: "failed",
    manifestSchemaVersion: "mth-backup/1",
    startedAt: "2026-11-02T00:00:00Z",
    finishedAt: "2026-11-02T00:01:00Z",
    failureReason: "synthetic failure",
    operatorName: "synthetic operator",
  });
}, 240_000);

afterAll(async () => {
  await api?.close();
  await owner?.destroy();
  if (scratch) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

describe("T-E20: listBackupSets", () => {
  it("newest first, the contract's fields only (no content), bigint counts as decimal strings", async () => {
    const tech = sessions.find((s) => s.role === "ADM_TECH")!.session;
    const res = await call<Body>(api.app, "GET", BASE, { session: tech });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.items.map((s: Body) => s.label)).toEqual(["synthetic-newer", "synthetic-older"]);
    for (const item of res.body.items) expect(backupSetView.safeParse(item).success).toBe(true);
    expect(Object.keys(res.body.items[1]).sort()).toEqual(Object.keys(backupSetView.shape).sort());
    expect(res.body.items[1]).toMatchObject({ status: "succeeded", dumpBytes: "12345678901", evidenceBytes: "2048" });
    expect(res.body.items[0]).toMatchObject({ status: "failed", failureReason: "synthetic failure", dumpBytes: null });
    const page = await call<Body>(api.app, "GET", `${BASE}?limit=1`, { session: tech });
    expect(page.body.items).toHaveLength(1);
    const rest = await call<Body>(api.app, "GET", `${BASE}?limit=1&cursor=${page.body.nextCursor}`, { session: tech });
    expect(rest.body.items.map((s: Body) => s.label)).toEqual(["synthetic-older"]);
  });

  it("200 for ADM_TECH and AUD; 403 for every role without backup.read (ADM_ACCESS included) and a user without grants", async () => {
    expect(sessions.map((s) => s.role)).toEqual(expect.arrayContaining(["AUD", "ADM_ACCESS", "ADM_TECH"]));
    for (const { role, session } of sessions)
      expect((await call<Body>(api.app, "GET", BASE, { session })).status, role).toBe(READERS.has(role) ? 200 : 403);
  });
});
