// T-C6 (ADR-0064 §7, §9, §10; p7-work-split §C.1, §C.5, §C.6; T-DG7-BE-C): the five migration-export routes and the
// transfer.export job, on a scratch database of this run's disposable PostgreSQL cluster (the export reads the whole
// installation, and "one export at a time" is installation-wide, so no other suite shares it).
//   - every role but ADM_TECH (AUD included) and a user without grants get 403 on all five operations;
//   - 422 migration.export_in_progress while one is queued or running; 409 not ready; 422 failed;
//   - one audit event per transition (requested, started, succeeded | failed); a duplicate delivery writes nothing;
//   - the job takes the migrationExport lock 730402 (it waits while another holder has it) and runs exactly once;
//   - no response contains a row value (the synthetic names written below never appear in any body).
// Every value is SYNTHETIC. An export approves nothing (no G1-G6, Finance or IT approval) and touches no DG0-DG7 record.
import {
  createDb,
  createPool,
  MIGRATION_EXPORT_LOCK_CLASS,
  MIGRATION_EXPORT_LOCK_KEY,
  migrate,
  migrationExportKey,
  parseAttachmentManifest,
  parseManifest,
  sql,
  transferSha256,
  type Db,
  type PackageSink,
} from "@mth/db";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import {
  runMigrationExport,
  storeDeps,
  transferExportHandler,
} from "../../../../worker/src/handlers/transfer/export.ts";
import { ADVISORY_LOCK_CLASSES } from "../../../src/modules/platform/index.ts";
import { MIGRATION_EXPORT_TEXTS } from "../../../src/modules/transfer/export/service.ts";
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

const BASE = "/api/v1/admin/migration-exports";
const MISSING = "01900000-0000-7000-8000-00000000beef";
const SECRET_NAME = "Synthetic Organisation Zeta-7781";

let api: TestApi;
let scratch: string;
let owner: Db;
let admin: Session;
const others: { role: string; session: Session }[] = [];
const bodies: string[] = [];

const send = async (m: string, u: string, o?: Parameters<typeof call>[3]) => {
  const res = await call<Body>(api.app, m, u, o);
  bodies.push(typeof res.body === "string" ? res.body : JSON.stringify(res.body ?? null));
  return res;
};

async function auditActions(recordId: string): Promise<string[]> {
  const rows = await owner
    .selectFrom("audit_event")
    .select(["action", "seq"])
    .where("record_id", "=", recordId)
    .orderBy("seq")
    .execute();
  return rows.map((r) => r.action);
}

async function envelopeOf(exportId: string) {
  const row = await owner
    .selectFrom("outbox_event")
    .selectAll()
    .where("aggregate_id", "=", exportId)
    .executeTakeFirstOrThrow();
  // The relay's envelope (apps/worker relay.ts): the outbox row's identity plus its payload.
  return {
    outboxEventId: row.id,
    eventType: row.event_type,
    schemaVersion: row.schema_version,
    idempotencyKey: row.idempotency_key,
    organizationId: row.organization_id,
    payload: typeof row.payload === "string" ? (JSON.parse(row.payload) as Record<string, unknown>) : row.payload,
  };
}

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_transfer_export_api");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  owner = createDb(createPool(roleUrl(adminUrl, scratch, "mth_owner"), { max: 3 }));
  api = await startApi({ database: scratch });
  const org = await createOrg(api.db);
  await api.db.updateTable("organization").set({ name_en: SECRET_NAME }).where("id", "=", org.id).execute();
  const grantor = await createUser(api.db, org.id);
  const tech = await createUser(api.db, org.id);
  await grant(api.db, grantor.id, tech.id, "ADM_TECH", { type: "organization", id: org.id }, org.id);
  admin = await signIn(api.app, tech.subject);
  const roles = await api.db.selectFrom("role").select("code").orderBy("code").execute();
  for (const { code } of roles) {
    if (code === "ADM_TECH") continue;
    const u = await createUser(api.db, org.id);
    await grant(api.db, grantor.id, u.id, code, { type: "organization", id: org.id }, org.id);
    others.push({ role: code, session: await signIn(api.app, u.subject) });
  }
  const nobody = await createUser(api.db, org.id);
  others.push({ role: "(no grant)", session: await signIn(api.app, nobody.subject) });
}, 240_000);

afterAll(async () => {
  await api?.close();
  await owner?.destroy();
  if (scratch) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

describe("T-C6: the migration-export routes and the transfer.export job", () => {
  let first: string;

  it("the lock constants equal the registry's migrationExport (730402)", () => {
    expect(MIGRATION_EXPORT_LOCK_CLASS).toBe(ADVISORY_LOCK_CLASSES.migrationExport);
    expect(MIGRATION_EXPORT_LOCK_CLASS).toBe(730402);
    expect(MIGRATION_EXPORT_LOCK_KEY).toBe("migration-export");
  });

  it("validates the request: 400 without a reason, with a short one, or with an unknown field", async () => {
    for (const body of [{}, { reason: "x" }, { reason: "Synthetic transfer drill", extra: true }]) {
      const res = await send("POST", BASE, { session: admin, body });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
    }
    expect(await owner.selectFrom("migration_export").select("id").execute()).toEqual([]);
  });

  it("ADM_TECH requests an export: 202 queued, Location, ETag, audit migration_export.requested, the outbox event", async () => {
    const res = await send("POST", BASE, { session: admin, body: { reason: "Synthetic transfer drill" } });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body).toMatchObject({
      status: "queued",
      requestedVia: "api",
      schemaVersion: "mth-migration/1",
      version: 1,
    });
    expect(res.body.manifestSha256).toBeNull();
    expect(res.headers["location"]).toBe(`${BASE}/${res.body.id}`);
    expect(res.headers["etag"]).toBe('"1"');
    first = res.body.id;
    expect(await auditActions(first)).toEqual(["migration_export.requested"]);
    const audit = await owner
      .selectFrom("audit_event")
      .select(["reason", "actor_user_id"])
      .where("record_id", "=", first)
      .executeTakeFirstOrThrow();
    expect(audit.reason).toBe("Synthetic transfer drill");
    expect((await envelopeOf(first)).eventType).toBe("migration_export.requested");
  });

  it("refuses a second request while one is queued (422 migration.export_in_progress) and the manifests before it ran (409)", async () => {
    const again = await send("POST", BASE, { session: admin, body: { reason: "Second synthetic request" } });
    expect(again.status).toBe(422);
    expect(again.body).toMatchObject({
      code: "migration.export_in_progress",
      detail: MIGRATION_EXPORT_TEXTS.inProgress,
    });
    for (const part of ["manifest", "attachment-manifest"]) {
      const early = await send("GET", `${BASE}/${first}/${part}`, { session: admin });
      expect(early.status).toBe(409);
      expect(early.body).toMatchObject({ code: "migration.export_not_ready", detail: MIGRATION_EXPORT_TEXTS.notReady });
    }
    expect(await owner.selectFrom("migration_export").select("id").execute()).toHaveLength(1);
  });

  it("every role but ADM_TECH (AUD included) and a user without grants gets 403 on all five operations", async () => {
    expect(others.map((o) => o.role)).toContain("AUD");
    expect(others.length).toBeGreaterThanOrEqual(10);
    for (const { role, session } of others) {
      const calls: [string, string, object?][] = [
        ["GET", BASE],
        ["POST", BASE, { reason: "Synthetic forbidden request" }],
        ["GET", `${BASE}/${first}`],
        ["GET", `${BASE}/${first}/manifest`],
        ["GET", `${BASE}/${first}/attachment-manifest`],
      ];
      for (const [m, u, body] of calls) {
        const res = await send(m, u, { session, ...(body ? { body } : {}) });
        expect(res.status, `${role} ${m} ${u}`).toBe(403);
      }
    }
    expect(await owner.selectFrom("migration_export").select("id").execute()).toHaveLength(1);
    expect(await auditActions(first)).toEqual(["migration_export.requested"]);
  });

  it("the job waits on lock 730402, then runs once: running -> succeeded, one audit event per transition", async () => {
    const handler = transferExportHandler(storeDeps(() => api.config.evidenceStorage.path));
    const envelope = await envelopeOf(first);
    let running: Promise<unknown> | null = null;
    await owner.transaction().execute(async (tx) => {
      await sql`SELECT pg_advisory_xact_lock(${MIGRATION_EXPORT_LOCK_CLASS}::int, hashtext(${MIGRATION_EXPORT_LOCK_KEY}))`.execute(
        tx,
      );
      running = handler.handle(api.db, envelope, "job-tc6-1");
      await new Promise((r) => setTimeout(r, 400));
      const row = await api.db
        .selectFrom("migration_export")
        .select("status")
        .where("id", "=", first)
        .executeTakeFirst();
      expect(row?.status).toBe("queued"); // blocked on the lock: nothing claimed while another holder has it
    });
    // The holder's transaction ended: the job claims, writes the package and finishes.
    const outcome = (await running!) as Body;
    expect(outcome.outcome).toBe("succeeded");
    expect(await auditActions(first)).toEqual([
      "migration_export.requested",
      "migration_export.started",
      "migration_export.succeeded",
    ]);
    // A duplicate delivery changes nothing.
    const dup = (await handler.handle(api.db, envelope, "job-tc6-2")) as Body;
    expect(dup).toEqual({ outcome: "skipped", status: "succeeded" });
    expect(await auditActions(first)).toHaveLength(3);
  });

  it("getMigrationExport and listMigrationExports show the counts and checksums, never a row value", async () => {
    const one = await send("GET", `${BASE}/${first}`, { session: admin });
    expect(one.status).toBe(200);
    expect(one.body).toMatchObject({
      status: "succeeded",
      sourceEnvironment: "unmarked",
      demoChecksum: null,
      attachmentCount: 0,
      attachmentBytes: "0",
      version: 3,
    });
    expect(one.body.rowCount).toMatch(/^[1-9][0-9]*$/);
    expect(one.headers["etag"]).toBe('"3"');
    const list = await send("GET", BASE, { session: admin });
    expect(list.status).toBe(200);
    expect(list.body.items.map((i: Body) => i.id)).toEqual([first]);
    expect((await send("GET", `${BASE}/${MISSING}`, { session: admin })).status).toBe(404);
  });

  it("the two manifest downloads: attachment, ETag = SHA-256, the stored bytes, no row data", async () => {
    const row = await owner
      .selectFrom("migration_export")
      .selectAll()
      .where("id", "=", first)
      .executeTakeFirstOrThrow();
    const m = await send("GET", `${BASE}/${first}/manifest`, { session: admin });
    expect(m.status).toBe(200);
    expect(m.headers["content-disposition"]).toBe(`attachment; filename="migration-manifest-${first}.json"`);
    expect(m.headers["etag"]).toBe(`"${row.manifest_sha256}"`);
    const stored = readFileSync(join(api.config.evidenceStorage.path, migrationExportKey(first, "manifest.json")));
    expect(transferSha256(stored)).toBe(row.manifest_sha256);
    const manifest = parseManifest(stored.toString("utf8"));
    expect(manifest.exportId).toBe(first);
    expect(m.body).toEqual(JSON.parse(stored.toString("utf8")));
    const a = await send("GET", `${BASE}/${first}/attachment-manifest`, { session: admin });
    expect(a.status).toBe(200);
    expect(a.headers["etag"]).toBe(`"${row.attachment_manifest_sha256}"`);
    expect(parseAttachmentManifest(`${JSON.stringify(a.body)}\n`).items).toEqual([]);
    // The package itself holds the row values; no API response does.
    const orgFile = readFileSync(
      join(api.config.evidenceStorage.path, migrationExportKey(first, "tables/organization.ndjson")),
      "utf8",
    );
    expect(orgFile).toContain(SECRET_NAME);
  });

  it("the same Idempotency-Key returns the existing request with 200; a failed export is 422 on both manifests", async () => {
    const key = "synthetic-idem-key-0001";
    const created = await send("POST", BASE, {
      session: admin,
      body: { reason: "Synthetic failing export" },
      headers: { "idempotency-key": key },
    });
    expect(created.status).toBe(202);
    const replay = await send("POST", BASE, {
      session: admin,
      body: { reason: "Synthetic failing export" },
      headers: { "idempotency-key": key },
    });
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(created.body.id);
    const failing: PackageSink = {
      write: async () => {
        throw new Error("synthetic store outage");
      },
    };
    const outcome = await runMigrationExport(api.db, created.body.id, "job-tc6-3", {
      sink: () => failing,
      objects: storeDeps(() => api.config.evidenceStorage.path).objects,
    });
    expect(outcome).toEqual({ outcome: "failed", reason: "unexpected error: synthetic store outage" });
    expect(await auditActions(created.body.id)).toEqual([
      "migration_export.requested",
      "migration_export.started",
      "migration_export.failed",
    ]);
    for (const part of ["manifest", "attachment-manifest"]) {
      const res = await send("GET", `${BASE}/${created.body.id}/${part}`, { session: admin });
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ code: "migration.export_failed", detail: MIGRATION_EXPORT_TEXTS.failed });
    }
    const got = await send("GET", `${BASE}/${created.body.id}`, { session: admin });
    expect(got.body).toMatchObject({ status: "failed", failureReason: "unexpected error: synthetic store outage" });
    // The replay after the run shows the current state.
    const late = await send("POST", BASE, {
      session: admin,
      body: { reason: "Synthetic failing export" },
      headers: { "idempotency-key": key },
    });
    expect([late.status, late.body.status]).toEqual([200, "failed"]);
  });

  it("no response of this suite contains a row value", () => {
    expect(bodies.length).toBeGreaterThan(50);
    for (const b of bodies) expect(b).not.toContain(SECRET_NAME);
  });
});
