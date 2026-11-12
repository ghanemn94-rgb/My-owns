// T-E14…T-E19, T-E22 (ADR-0067 §4-§6; p7-work-split §E.1, §E.4; REQ-S16-024; T-DG7-BE-G): the retention.archive job on
// its own fresh database (retention runs are installation-wide), against a real PostgreSQL:
//   T-E22  the job's service identity is job:retention.archive (retention.read only) and the shipped schedule is
//          disabled; every class ships `retain` with no period, and a run then archives nothing;
//   T-E14  with TEST periods on SYNTHETIC rows a run archives only records past retention (a row one day younger than
//          the period stays unmarked and live), with one action row and one audit event per action;
//   T-E15  a dry run writes would_* rows only: no archive set object, no marker, no delete, row counts unchanged;
//   T-E16  exactly once: the job delivered twice (in sequence and concurrently) for one run archives each record once;
//          a second run never re-archives a marked record;
//   T-E17  the archive set: manifest.json (mth-retention-archive/1), NDJSON per table in the ADR-0064 encoding, the
//          manifest's SHA-256 equal to archive_set_sha256, written before any marker (a store failure leaves no marker
//          and fails the run);
//   T-E18  archive_then_purge on processed_message: archived then deleted; an inbox item referenced by a delivery:
//          skipped_referenced, kept, read-only;
//   T-E19  a class with action `retain` is never touched; business, audit and snapshot tables never appear in any action.
// Every value is SYNTHETIC; every IT reference text begins with TEST-ONLY. A run approves nothing (no G1-G6, Finance or
// IT approval) and touches no DG0-DG7 record.
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { insertAuditEvent, sql, type PackageSink } from "@mth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  RETENTION_ARCHIVE_SCHEMA_VERSION,
  RETENTION_LOCK_CLASS,
  retentionArchiveHandler,
  retentionStoreDeps,
  runRetention,
  type RetentionArchiveManifest,
} from "../../src/handlers/retention/archive.ts";
import { jobActor } from "../../src/kit.ts";
import { seedTransformationWithOutbox, workerEnv, type WorkerEnv } from "../support.ts";

let env: WorkerEnv;
let root: string;
let userId: string;
let orgId: string;
const REF = "TEST-ONLY synthetic change ticket";
const CONSUMER = "test.retention";
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

/** Changes a class as the owner, with its audit event (p2_audit_required). */
async function setClass(code: string, action: string, period: number | null, ref: string | null) {
  const c = await env.owner.connect();
  try {
    await c.query("BEGIN");
    const r = await c.query<{ id: string; version: number }>(
      `UPDATE retention_class SET action = $2, period_days = $3, it_approval_reference = $4, version = version + 1,
              updated_at = now() WHERE code = $1 RETURNING id, version`,
      [code, action, period, ref],
    );
    await c.query(
      `INSERT INTO audit_event (id, actor_type, action, record_type, record_id, prior_version, new_version, source)
       VALUES (mth_uuid_v7(), 'system', 'retention_class.updated', 'retention_class', $1, $2, $3, 'cli')`,
      [r.rows[0]!.id, r.rows[0]!.version - 1, r.rows[0]!.version],
    );
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

/** A queued run requested through the API's shape (requested_via api, created_by a user), with its audit event. */
async function requestRun(mode: "run" | "dry_run"): Promise<string> {
  return env.db.transaction().execute(async (tx) => {
    const id = (await sql<{ id: string }>`SELECT mth_uuid_v7() AS id`.execute(tx)).rows[0]!.id;
    await tx
      .insertInto("retention_run")
      .values({ id, mode, requested_via: "api", as_of: sql<Date>`now()`, created_by: userId, updated_by: userId })
      .execute();
    await insertAuditEvent(
      tx,
      { actorType: "user", actorUserId: userId, source: "api" },
      {
        action: "retention_run.requested",
        recordType: "retention_run",
        recordId: id,
        organizationId: orgId,
        newVersion: 1,
      },
    );
    return id;
  });
}

async function processed(key: string, daysAgo: number) {
  await env.owner.query(
    `INSERT INTO processed_message (consumer, idempotency_key, processed_at, outcome)
     VALUES ($1, $2, now() - make_interval(days => $3) - interval '0.123456 seconds', 'done')`,
    [CONSUMER, key, daysAgo],
  );
}

const liveKeys = async () =>
  (
    await env.owner.query<{ k: string }>(
      `SELECT idempotency_key AS k FROM processed_message WHERE consumer = $1 ORDER BY 1`,
      [CONSUMER],
    )
  ).rows.map((r) => r.k);

const run = async (id: string) =>
  env.db.selectFrom("retention_run").selectAll().where("id", "=", id).executeTakeFirstOrThrow();

const actions = async (id: string) =>
  env.db
    .selectFrom("retention_run_action")
    .selectAll()
    .where("retention_run_id", "=", id)
    .orderBy("occurred_at")
    .orderBy("id")
    .execute();

const markers = async (table: string) =>
  env.db.selectFrom("retention_archived_record").selectAll().where("table_name", "=", table).execute();

async function auditsOf(recordIds: readonly string[]) {
  if (recordIds.length === 0) return [];
  return env.db
    .selectFrom("audit_event")
    .select(["record_id", "action"])
    .where("record_id", "in", [...recordIds])
    .execute();
}

/** An inbox item read `daysAgo` days ago (with its audit event), optionally referenced by a delivery record. */
async function inboxItem(daysAgo: number, withDelivery: boolean): Promise<string> {
  const c = await env.owner.connect();
  try {
    await c.query("BEGIN");
    const id = (await c.query<{ id: string }>(`SELECT mth_uuid_v7() AS id`)).rows[0]!.id;
    await c.query(
      `INSERT INTO inbox_notification (id, organization_id, recipient_user_id, link_path, message_key, dedupe_key, read_at)
       VALUES ($1, $2, $3, '/inbox', 'test.retention', $5, now() - make_interval(days => $4))`,
      [id, orgId, userId, daysAgo, `test-retention-${id}`],
    );
    await c.query(
      `INSERT INTO audit_event (id, actor_type, action, record_type, record_id, new_version, source)
       VALUES (mth_uuid_v7(), 'system', 'inbox_notification.create', 'inbox_notification', $1, 1, 'worker')`,
      [id],
    );
    if (withDelivery) {
      const d = (await c.query<{ id: string }>(`SELECT mth_uuid_v7() AS id`)).rows[0]!.id;
      await c.query(
        `INSERT INTO notification_delivery (id, organization_id, inbox_notification_id, channel_kind)
         VALUES ($1, $2, $3, 'email')`,
        [d, orgId, id],
      );
      await c.query(
        `INSERT INTO audit_event (id, actor_type, action, record_type, record_id, new_version, source)
         VALUES (mth_uuid_v7(), 'system', 'notification_delivery.create', 'notification_delivery', $1, 1, 'worker')`,
        [d],
      );
    }
    await c.query("COMMIT");
    return id;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

beforeAll(async () => {
  env = await workerEnv();
  root = mkdtempSync(join(process.env["TMPDIR"] ?? tmpdir(), "mth-retention-"));
  const seed = await seedTransformationWithOutbox(env.db);
  userId = seed.userId;
  orgId = (
    await env.db.selectFrom("app_user").select("organization_id").where("id", "=", userId).executeTakeFirstOrThrow()
  ).organization_id;
}, 240_000);

afterAll(async () => {
  await env?.close();
  if (root) rmSync(root, { recursive: true, force: true });
}, 60_000);

describe("retention.archive (ADR-0067 §4-§6)", () => {
  const deps = () => retentionStoreDeps(() => root);
  let archiveRun: string;

  it("T-E22: the job runs as job:retention.archive (retention.read only); the shipped schedule is disabled", async () => {
    const identity = await env.db
      .selectFrom("service_identity")
      .selectAll()
      .where("code", "=", "job:retention.archive")
      .executeTakeFirstOrThrow();
    expect(identity).toMatchObject({
      subject_kind: "job",
      queue_name: "retention.archive",
      scope_level: "platform",
      organization_id: null,
      sensitive_access: "none",
    });
    expect(identity.declared_permission_codes).toEqual(["retention.read"]);
    expect(identity.granted_permission_codes).toEqual(["retention.read"]);
    const schedule = await env.db
      .selectFrom("job_schedule")
      .selectAll()
      .where("code", "=", "retention.archive")
      .executeTakeFirstOrThrow();
    expect(schedule).toMatchObject({
      queue_name: "retention.archive",
      cron: "0 2 * * 1",
      timezone: "Asia/Riyadh",
      enabled: false,
      owner_module: "retention",
    });
    expect(RETENTION_LOCK_CLASS).toBe(730410);
  });

  it("T-E22: every class ships `retain` with no period, so a run on a fresh installation archives nothing", async () => {
    const classes = await env.db.selectFrom("retention_class").select(["action", "period_days"]).execute();
    expect(classes).toHaveLength(12);
    for (const c of classes) expect(c).toEqual({ action: "retain", period_days: null });
    await processed("fresh-old", 400);
    // A scheduled delivery (no envelope) requests its own run (requested_via schedule) and runs it.
    const out = (await retentionArchiveHandler(deps()).handle(env.db, {}, "job-schedule-1")) as { runId: string };
    const r = await run(out.runId);
    expect(r).toMatchObject({
      status: "succeeded",
      requested_via: "schedule",
      created_by: null,
      archive_set_key: null,
    });
    expect([r.candidate_count, r.archived_count, r.purged_count, r.skipped_count]).toEqual([0, 0, 0, 0]);
    expect(await actions(out.runId)).toEqual([]);
    expect(existsSync(join(root, "retention", out.runId))).toBe(false);
    expect(await liveKeys()).toEqual(["fresh-old"]);
  });

  it("T-E14/T-E17: a run archives ONLY records past retention, one action and one audit event each; the set is written", async () => {
    await processed("old-40", 40);
    await processed("old-31", 31);
    await processed("young-29", 29); // one day younger than the period: stays unmarked and live
    await setClass("processed_message_log", "archive", 30, REF);
    archiveRun = await requestRun("run");
    const envelope = {
      outboxEventId: archiveRun,
      eventType: "retention_run.requested",
      schemaVersion: 1,
      idempotencyKey: archiveRun,
      organizationId: orgId,
      payload: { retentionRunId: archiveRun },
    };
    const out = await retentionArchiveHandler(deps()).handle(env.db, envelope, "job-1");
    expect(out).toMatchObject({ outcome: "succeeded", candidates: 3, archived: 3, purged: 0, skipped: 0 });
    const r = await run(archiveRun);
    expect(r).toMatchObject({ status: "succeeded", candidate_count: 3, archived_count: 3, purged_count: 0 });
    const m = (await markers("processed_message")).map(
      (x) => (x.record_key as { idempotency_key: string }).idempotency_key,
    );
    expect(m.sort()).toEqual(["fresh-old", "old-31", "old-40"]);
    expect(await liveKeys()).toEqual(["fresh-old", "old-31", "old-40", "young-29"]); // archive keeps the live rows
    const acts = await actions(archiveRun);
    expect(acts.map((a) => a.action)).toEqual(["archived", "archived", "archived"]);
    for (const a of acts) {
      expect(a.period_days).toBe(30);
      expect(Object.keys(a.record_key as object).sort()).toEqual(["consumer", "idempotency_key"]);
    }
    const audits = await auditsOf(acts.map((a) => a.id));
    expect(audits.map((a) => a.action)).toEqual(["retention.archived", "retention.archived", "retention.archived"]);
    expect(new Set(audits.map((a) => a.record_id)).size).toBe(3);
    const runAudits = await env.db
      .selectFrom("audit_event")
      .select("action")
      .where("record_id", "=", archiveRun)
      .orderBy("seq")
      .execute();
    expect(runAudits.map((a) => a.action)).toEqual([
      "retention_run.requested",
      "retention_run.started",
      "retention_run.succeeded",
    ]);

    // T-E17: the set
    const dir = join(root, "retention", archiveRun);
    const manifestBytes = readFileSync(join(dir, "manifest.json"));
    expect(sha(manifestBytes)).toBe(r.archive_set_sha256);
    expect(r.archive_set_key).toBe(`retention/${archiveRun}/manifest.json`);
    const manifest = JSON.parse(manifestBytes.toString("utf8")) as RetentionArchiveManifest;
    expect(manifest.schemaVersion).toBe(RETENTION_ARCHIVE_SCHEMA_VERSION);
    expect(manifest.runId).toBe(archiveRun);
    expect(manifest.tables).toHaveLength(1);
    const t = manifest.tables[0]!;
    expect(t).toMatchObject({
      name: "processed_message",
      file: "tables/processed_message.ndjson",
      retentionClassCode: "processed_message_log",
      periodDays: 30,
      rowCount: "3",
      columns: ["consumer", "idempotency_key", "processed_at", "outcome"],
    });
    const ndjson = readFileSync(join(dir, t.file));
    expect(sha(ndjson)).toBe(t.fileSha256);
    expect(t.contentDigest).toBe(t.fileSha256);
    expect(Number(r.archive_set_bytes)).toBe(manifestBytes.byteLength + ndjson.byteLength);
    const lines = ndjson
      .toString("utf8")
      .trimEnd()
      .split("\n")
      .map((l) => JSON.parse(l) as Record<string, string>);
    expect(lines.map((l) => l["idempotency_key"])).toEqual(["fresh-old", "old-31", "old-40"]); // primary key order
    for (const l of lines) {
      expect(Object.keys(l)).toEqual(["consumer", "idempotency_key", "processed_at", "outcome"]);
      // ADR-0064 §2.3: PostgreSQL's text output under TimeZone UTC, microseconds kept
      expect(l["processed_at"]).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{6}\+00$/);
    }
    // The marker's age equals the row's age exactly (microseconds included).
    const exact = await env.owner.query<{ same: boolean }>(
      `SELECT bool_and(m.record_age_at = p.processed_at) AS same FROM retention_archived_record m
         JOIN processed_message p ON p.consumer = m.record_key->>'consumer' AND p.idempotency_key = m.record_key->>'idempotency_key'
        WHERE m.retention_run_id = $1`,
      [archiveRun],
    );
    expect(exact.rows[0]!.same).toBe(true);
  });

  it("T-E16: delivered twice for one run, the job archives each record once; a second run never re-archives", async () => {
    // A redelivery of the finished run changes nothing.
    expect(await runRetention(env.db, archiveRun, "job-1-again", deps())).toEqual({
      outcome: "skipped",
      status: "succeeded",
    });
    // Two concurrent deliveries of a new run: exactly one claims it (lock 730410), the other skips.
    await processed("old-35", 35);
    const second = await requestRun("run");
    const outs = await Promise.all([
      runRetention(env.db, second, "job-2a", deps()),
      runRetention(env.db, second, "job-2b", deps()),
    ]);
    expect(outs.map((o) => o.outcome).sort()).toEqual(["skipped", "succeeded"]);
    const r = await run(second);
    // only the new record: the three marked by the first run are never selected again
    expect(r).toMatchObject({ status: "succeeded", candidate_count: 1, archived_count: 1 });
    const acts = await actions(second);
    expect(acts.map((a) => (a.record_key as { idempotency_key: string }).idempotency_key)).toEqual(["old-35"]);
    const all = await env.db
      .selectFrom("retention_run_action")
      .select(["table_name", "record_key"])
      .where("action", "=", "archived")
      .execute();
    expect(new Set(all.map((a) => JSON.stringify(a.record_key))).size).toBe(all.length);
  });

  it("T-E15: a dry run writes would_* rows only: no set, no marker, no delete, counts unchanged", async () => {
    await processed("dry-50", 50);
    await setClass("processed_message_log", "archive_then_purge", 30, REF);
    const before = await liveKeys();
    const markersBefore = (await markers("processed_message")).length;
    const dry = await requestRun("dry_run");
    const out = await runRetention(env.db, dry, "job-dry", deps());
    expect(out).toMatchObject({ outcome: "succeeded", candidates: 1, archived: 0, purged: 0 });
    const r = await run(dry);
    expect(r).toMatchObject({ status: "succeeded", mode: "dry_run", archive_set_key: null, archived_count: 0 });
    const acts = await actions(dry);
    expect(acts.map((a) => a.action).sort()).toEqual(["would_archive", "would_purge"]);
    expect(await auditsOf(acts.map((a) => a.id))).toEqual([]); // audited once, on the run
    expect(existsSync(join(root, "retention", dry))).toBe(false);
    expect((await markers("processed_message")).length).toBe(markersBefore);
    expect(await liveKeys()).toEqual(before);
  });

  it("T-E17: a store failure leaves no marker and fails the run with its reason", async () => {
    const failing: PackageSink = {
      write: async () => {
        throw new Error("synthetic store failure");
      },
    };
    const markersBefore = (await env.db.selectFrom("retention_archived_record").select("record_key").execute()).length;
    const id = await requestRun("run");
    const out = await runRetention(env.db, id, "job-fail", { sink: () => failing });
    expect(out).toEqual({ outcome: "failed", runId: id, reason: "synthetic store failure" });
    const r = await run(id);
    expect(r).toMatchObject({ status: "failed", failure_reason: "synthetic store failure", archive_set_key: null });
    expect(await actions(id)).toEqual([]);
    expect((await env.db.selectFrom("retention_archived_record").select("record_key").execute()).length).toBe(
      markersBefore,
    );
    expect(await liveKeys()).toContain("dry-50");
    const audits = await env.db
      .selectFrom("audit_event")
      .select("action")
      .where("record_id", "=", id)
      .orderBy("seq")
      .execute();
    expect(audits.map((a) => a.action)).toEqual([
      "retention_run.requested",
      "retention_run.started",
      "retention_run.failed",
    ]);
  });

  it("T-E18: archive_then_purge deletes processed markers after archiving; a referenced inbox item is skipped, kept, read-only", async () => {
    const free = await inboxItem(40, false);
    const referenced = await inboxItem(40, true);
    const recent = await inboxItem(10, false);
    await setClass("inbox_read_item", "archive_then_purge", 30, REF);
    const id = await requestRun("run");
    const out = await runRetention(env.db, id, "job-purge", deps());
    // dry-50 (processed_message) + the two old inbox items
    expect(out).toMatchObject({ outcome: "succeeded", candidates: 3, archived: 3, purged: 2, skipped: 1 });
    expect(await liveKeys()).not.toContain("dry-50");
    const acts = await actions(id);
    const byKey = (k: string) => acts.filter((a) => JSON.stringify(a.record_key).includes(k)).map((a) => a.action);
    expect(byKey("dry-50")).toEqual(["archived", "purged"]);
    expect(byKey(free)).toEqual(["archived", "purged"]);
    expect(byKey(referenced)).toEqual(["archived", "skipped_referenced"]);
    expect(byKey(recent)).toEqual([]);
    const audits = await auditsOf(acts.map((a) => a.id));
    expect(audits).toHaveLength(acts.length);
    expect(audits.map((a) => a.action).sort()).toEqual([
      "retention.archived",
      "retention.archived",
      "retention.archived",
      "retention.purged",
      "retention.purged",
      "retention.skipped",
    ]);
    const inbox = await env.db
      .selectFrom("inbox_notification")
      .select("id")
      .where("id", "in", [free, referenced, recent])
      .execute();
    expect(inbox.map((i) => i.id).sort()).toEqual([referenced, recent].sort());
    const kept = (await markers("inbox_notification")).find((m) => (m.record_key as { id: string }).id === referenced)!;
    expect(kept.purged_at).toBeNull();
    const purgedMarker = (await markers("inbox_notification")).find(
      (m) => (m.record_key as { id: string }).id === free,
    )!;
    expect(purgedMarker.purge_run_id).toBe(id);
    // The kept item is read-only.
    await expect(
      env.owner.query(`UPDATE inbox_notification SET version = version + 1 WHERE id = $1`, [referenced]),
    ).rejects.toThrow(/archived record is read-only/);
  });

  it("T-E19: a `retain` class is never touched; business, audit and snapshot tables never appear in any action", async () => {
    const tables = await env.db.selectFrom("retention_run_action").select("table_name").distinct().execute();
    expect(tables.map((t) => t.table_name).sort()).toEqual(["inbox_notification", "processed_message"]);
    const touched = await env.owner.query<{ category: string; action: string }>(
      `SELECT DISTINCT c.category, c.action FROM retention_run_action a
         JOIN retention_class c ON c.id = a.retention_class_id`,
    );
    for (const row of touched.rows) {
      expect(row.category).toBe("operational");
      expect(row.action).not.toBe("retain");
    }
    const marked = await env.owner.query<{ category: string }>(
      `SELECT DISTINCT c.category FROM retention_archived_record m JOIN retention_class c ON c.id = m.retention_class_id`,
    );
    expect(marked.rows.map((r) => r.category)).toEqual(["operational"]);
    // The retain classes of the job's own history and the heartbeats were never selected.
    for (const t of ["job_run", "webhook_receipt", "worker_heartbeat", "audit_event", "report_snapshot"])
      expect(tables.map((x) => x.table_name)).not.toContain(t);
    expect(jobActor("x").source).toBe("worker");
  });
});
