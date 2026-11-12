// T-DG7-ARCH-03 guard probe (ADR-0066, ADR-0067; migrations 0143-0146): the class rules, run state machine, the
// "only past retention" archive rule, the purge path, the read-only rule for archived rows, the per-action audit rule
// and the backup-set write path, exercised on a real PostgreSQL as the runtime role (mth_app) and the owner role
// (mth_owner, which the backup script uses). Everything here is SYNTHETIC test data with test periods. Nothing here is
// a business approval (G1-G6), an IT approval, or touches DG0-DG7. Every class is put back to 'retain' at the end.
import type { Pool, PoolClient } from "pg";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appRole, ownerRole, pgError } from "../helpers.ts";

const app = appRole();
const owner = ownerRole();

const HEX = "c".repeat(64);
const REF = "TEST-ONLY synthetic reference (not an IT approval)";

async function inTx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

async function audit(c: PoolClient, recordType: string, recordId: string, version: number | null): Promise<void> {
  await c.query(
    `INSERT INTO audit_event (id, actor_type, action, record_type, record_id, new_version, source)
     VALUES ($1, 'system', 'test.retention_probe', $2, $3, $4, 'worker')`,
    [uuidv7(), recordType, recordId, version],
  );
}

async function classRow(code: string): Promise<{ id: string; version: number }> {
  const r = await app.pool.query<{ id: string; version: number }>(
    `SELECT id, version FROM retention_class WHERE code = $1`,
    [code],
  );
  return r.rows[0]!;
}

async function setClass(code: string, action: string, period: number | null, ref: string | null): Promise<void> {
  const { id, version } = await classRow(code);
  await inTx(app.pool, async (c) => {
    await c.query(
      `UPDATE retention_class SET action = $2, period_days = $3, it_approval_reference = $4, version = $5,
              updated_at = now() WHERE id = $1`,
      [id, action, period, ref, version + 1],
    );
    await audit(c, "retention_class", id, version + 1);
  });
}

let userId: string;
beforeAll(async () => {
  const orgId = uuidv7();
  userId = uuidv7();
  await owner.pool.query(`INSERT INTO organization (id, code, name_en, name_ar) VALUES ($1, $2, 'P7 E probe', 'فحص')`, [
    orgId,
    `P7EPROBE${orgId.slice(-6).toUpperCase()}`,
  ]);
  await owner.pool.query(
    `INSERT INTO app_user (id, organization_id, display_name) VALUES ($1, $2, 'P7 E probe user')`,
    [userId, orgId],
  );
});

afterAll(async () => {
  for (const code of ["processed_message_log", "worker_heartbeat_log"]) {
    const r = await app.pool.query<{ action: string }>(`SELECT action FROM retention_class WHERE code = $1`, [code]);
    if (r.rows[0]?.action !== "retain") await setClass(code, "retain", null, null);
  }
  await app.close();
  await owner.close();
});

async function newRun(mode: "dry_run" | "run", asOf: string): Promise<string> {
  const id = uuidv7();
  await inTx(app.pool, async (c) => {
    await c.query(
      `INSERT INTO retention_run (id, mode, requested_via, as_of, created_by) VALUES ($1, $2, 'api', $3, $4)`,
      [id, mode, asOf, userId],
    );
    await audit(c, "retention_run", id, 1);
  });
  return id;
}

async function stepRun(id: string, version: number, set: string, values: unknown[] = []): Promise<void> {
  await inTx(app.pool, async (c) => {
    await c.query(`UPDATE retention_run SET ${set}, version = ${version} WHERE id = $1`, [id, ...values]);
    await audit(c, "retention_run", id, version);
  });
}

describe("0143 retention_class (ADR-0067 §2, D-243 Q3)", () => {
  it("business, audit and snapshot classes can never leave 'retain'", async () => {
    for (const code of ["business_record", "audit_trail", "report_snapshot"]) {
      const e = await pgError(setClass(code, "archive", 30, REF));
      expect(e.constraint, code).toBe("retention_class_retain_only");
    }
  });

  it("a class managed by the existing expiry job stays 'retain'", async () => {
    const e = await pgError(setClass("expiring_credential", "archive", 30, REF));
    expect(e.constraint).toBe("retention_class_retain_only");
  });

  it("an enabled action needs a period and the IT reference text", async () => {
    expect((await pgError(setClass("processed_message_log", "archive", null, REF))).constraint).toBe(
      "retention_class_enabled_shape",
    );
    expect((await pgError(setClass("processed_message_log", "archive", 30, null))).constraint).toBe(
      "retention_class_enabled_shape",
    );
  });

  it("archive_then_purge is refused for a class with an append-only table (job_history)", async () => {
    expect((await pgError(setClass("job_history", "archive_then_purge", 30, REF))).constraint).toBe(
      "retention_class_action_eligible",
    );
  });

  it("the class definition is not writable by the runtime role, and no class can be deleted", async () => {
    const { id } = await classRow("processed_message_log");
    expect((await pgError(app.pool.query(`UPDATE retention_class SET label_en = 'x' WHERE id = $1`, [id]))).code).toBe(
      "42501",
    );
    expect((await pgError(owner.pool.query(`DELETE FROM retention_class WHERE id = $1`, [id]))).code).toBe("42501");
  });

  it("a change without its audit event cannot commit", async () => {
    const { id, version } = await classRow("worker_heartbeat_log");
    const e = await pgError(
      inTx(app.pool, (c) =>
        c.query(`UPDATE retention_class SET period_days = 10, version = $2 WHERE id = $1`, [id, version + 1]),
      ),
    );
    expect(e.constraint).toBe("retention_class_audit_required");
  });
});

describe("0144 retention_run (ADR-0067 §4)", () => {
  it("one active run at a time; queued -> running -> succeeded, then immutable", async () => {
    const id = await newRun("dry_run", new Date().toISOString());
    expect((await pgError(newRun("run", new Date().toISOString()))).constraint).toBe("retention_run_one_active");
    await stepRun(id, 2, `status = 'running', started_at = now()`);
    // The runtime role has no grant on the request columns; even the owner cannot change them.
    expect((await pgError(stepRun(id, 3, `mode = 'run'`))).code).toBe("42501");
    const asOf = await pgError(
      inTx(owner.pool, async (c) => {
        await c.query(`UPDATE retention_run SET as_of = now() - interval '1 day', version = 3 WHERE id = $1`, [id]);
        await audit(c, "retention_run", id, 3);
      }),
    );
    expect(asOf.constraint).toBe("retention_run_request_immutable");
    await stepRun(
      id,
      3,
      `status = 'succeeded', candidate_count = 0, archived_count = 0, purged_count = 0, skipped_count = 0, finished_at = now()`,
    );
    expect((await pgError(stepRun(id, 4, `status = 'failed', failure_reason = 'x'`))).constraint).toBe(
      "retention_run_terminal_immutable",
    );
  });

  it("a dry run never carries an archive set", async () => {
    const id = await newRun("dry_run", new Date().toISOString());
    const e = await pgError(
      stepRun(
        id,
        2,
        `status = 'running', started_at = now(), archive_set_key = $2, archive_set_sha256 = $3,
        archive_set_bytes = 1`,
        [`retention/${id}/manifest.json`, HEX],
      ),
    );
    expect(e.constraint).toBe("retention_run_dry_run_writes_nothing");
    await stepRun(id, 2, `status = 'failed', failure_reason = 'probe', finished_at = now()`);
  });
});

describe("0144 archive and purge (ADR-0067 §5-§7; REQ-S16-024)", () => {
  const consumer = `p7-retention-probe-${uuidv7().slice(-8)}`;
  let runId: string;

  beforeAll(async () => {
    // Synthetic markers: one 40 days old, one 5 days old. Test period: 30 days. Whole seconds, because the marker's
    // record_age_at must equal the row's age exactly (a JavaScript Date drops PostgreSQL's microseconds).
    await owner.pool.query(
      `INSERT INTO processed_message (consumer, idempotency_key, processed_at, outcome) VALUES
         ($1, 'old', date_trunc('second', now()) - interval '40 days', 'done'),
         ($1, 'new', date_trunc('second', now()) - interval '5 days', 'done')`,
      [consumer],
    );
    await setClass("processed_message_log", "archive_then_purge", 30, REF);
    runId = await newRun("run", new Date().toISOString());
    await stepRun(runId, 2, `status = 'running', started_at = now()`);
  });

  async function age(key: string): Promise<string> {
    const r = await app.pool.query<{ a: Date }>(
      `SELECT processed_at AS a FROM processed_message WHERE consumer = $1 AND idempotency_key = $2`,
      [consumer, key],
    );
    return r.rows[0]!.a.toISOString();
  }
  async function mark(c: PoolClient, key: string, ageAt: string): Promise<void> {
    const cls = await classRow("processed_message_log");
    await c.query(
      `INSERT INTO retention_archived_record (table_name, record_key, retention_class_id, retention_run_id,
         archive_set_key, record_age_at) VALUES ('processed_message', $1, $2, $3, $4, $5)`,
      [JSON.stringify({ consumer, idempotency_key: key }), cls.id, runId, `retention/${runId}/manifest.json`, ageAt],
    );
  }

  it("a record that is not past retention can never be marked archived", async () => {
    const e = await pgError(inTx(app.pool, async (c) => mark(c, "new", await age("new"))));
    expect(e.constraint).toBe("retention_archived_record_past_retention");
  });

  it("the runtime role cannot delete an operational row directly", async () => {
    const e = await pgError(app.pool.query(`DELETE FROM processed_message WHERE consumer = $1`, [consumer]));
    expect(e.code).toBe("42501");
  });

  it("purge refuses a record that was not archived first, and any business table", async () => {
    const key = JSON.stringify({ consumer, idempotency_key: "old" });
    expect(
      (await pgError(app.pool.query(`SELECT retention_purge_record($1, 'processed_message', $2)`, [runId, key])))
        .constraint,
    ).toBe("retention_purge_archived_first");
    expect(
      (
        await pgError(
          app.pool.query(`SELECT retention_purge_record($1, 'organization', $2)`, [
            runId,
            JSON.stringify({ id: userId }),
          ]),
        )
      ).constraint,
    ).toBe("retention_purge_eligible");
    expect(
      (
        await pgError(
          app.pool.query(`SELECT retention_purge_record($1, 'audit_event', $2)`, [
            runId,
            JSON.stringify({ id: userId }),
          ]),
        )
      ).constraint,
    ).toBe("retention_purge_eligible");
  });

  it("archive then purge a record past retention, one audited action each; an unaudited action cannot commit", async () => {
    const cls = await classRow("processed_message_log");
    const key = { consumer, idempotency_key: "old" };
    const ageAt = await age("old");
    const unaudited = await pgError(
      inTx(app.pool, async (c) => {
        await mark(c, "old", ageAt);
        await c.query(
          `INSERT INTO retention_run_action (id, retention_run_id, retention_class_id, table_name, record_key, action,
             period_days, record_age_at) VALUES ($1, $2, $3, 'processed_message', $4, 'archived', 30, $5)`,
          [uuidv7(), runId, cls.id, JSON.stringify(key), ageAt],
        );
      }),
    );
    expect(unaudited.constraint).toBe("retention_run_action_audit_required");
    await inTx(app.pool, async (c) => {
      await mark(c, "old", ageAt);
      const a1 = uuidv7();
      await c.query(
        `INSERT INTO retention_run_action (id, retention_run_id, retention_class_id, table_name, record_key, action,
           period_days, record_age_at) VALUES ($1, $2, $3, 'processed_message', $4, 'archived', 30, $5)`,
        [a1, runId, cls.id, JSON.stringify(key), ageAt],
      );
      await audit(c, "retention_run_action", a1, null);
      const purged = await c.query<{ ok: boolean }>(
        `SELECT retention_purge_record($1, 'processed_message', $2) AS ok`,
        [runId, JSON.stringify(key)],
      );
      expect(purged.rows[0]!.ok).toBe(true);
      const a2 = uuidv7();
      await c.query(
        `INSERT INTO retention_run_action (id, retention_run_id, retention_class_id, table_name, record_key, action,
           period_days, record_age_at) VALUES ($1, $2, $3, 'processed_message', $4, 'purged', 30, $5)`,
        [a2, runId, cls.id, JSON.stringify(key), ageAt],
      );
      await audit(c, "retention_run_action", a2, null);
    });
    const left = await app.pool.query<{ k: string }>(
      `SELECT idempotency_key AS k FROM processed_message WHERE consumer = $1 ORDER BY 1`,
      [consumer],
    );
    expect(left.rows.map((r) => r.k)).toEqual(["new"]);
    const marker = await app.pool.query<{ purged: boolean }>(
      `SELECT purged_at IS NOT NULL AS purged FROM retention_archived_record WHERE table_name = 'processed_message' AND record_key = $1`,
      [JSON.stringify(key)],
    );
    expect(marker.rows).toEqual([{ purged: true }]);
    // Exactly once per run: the same action twice is refused.
    const again = await pgError(
      inTx(app.pool, async (c) => {
        const a3 = uuidv7();
        await c.query(
          `INSERT INTO retention_run_action (id, retention_run_id, retention_class_id, table_name, record_key, action,
             period_days, record_age_at) VALUES ($1, $2, $3, 'processed_message', $4, 'purged', 30, $5)`,
          [a3, runId, cls.id, JSON.stringify(key), ageAt],
        );
        await audit(c, "retention_run_action", a3, null);
      }),
    );
    expect(again.constraint).toBe("retention_run_action_once");
    // The marker is immutable except for the purge marker, and never deleted.
    expect(
      (await pgError(app.pool.query(`DELETE FROM retention_archived_record WHERE retention_run_id = $1`, [runId])))
        .code,
    ).toBe("42501");
    await stepRun(
      runId,
      3,
      `status = 'succeeded', candidate_count = 1, archived_count = 1, purged_count = 1, skipped_count = 0,
       archive_set_key = $2, archive_set_sha256 = $3, archive_set_bytes = 10, finished_at = now()`,
      [`retention/${runId}/manifest.json`, HEX],
    );
  });

  it("an archived row that is not purged is read-only (worker_heartbeat, class 'archive')", async () => {
    const hb = uuidv7();
    await owner.pool.query(
      `INSERT INTO worker_heartbeat (id, instance_key, app_version, started_at, last_beat_at, queue_count)
       VALUES ($1, $2, 'probe', date_trunc('second', now()) - interval '50 days',
         date_trunc('second', now()) - interval '45 days', 1)`,
      [hb, `probe-${hb.slice(-8)}`],
    );
    await setClass("worker_heartbeat_log", "archive", 30, REF);
    const run = await newRun("run", new Date().toISOString());
    await stepRun(run, 2, `status = 'running', started_at = now()`);
    const cls = await classRow("worker_heartbeat_log");
    const ageAt = (
      await app.pool.query<{ a: Date }>(`SELECT last_beat_at AS a FROM worker_heartbeat WHERE id = $1`, [hb])
    ).rows[0]!.a.toISOString();
    await inTx(app.pool, async (c) => {
      await c.query(
        `INSERT INTO retention_archived_record (table_name, record_key, retention_class_id, retention_run_id,
           archive_set_key, record_age_at) VALUES ('worker_heartbeat', $1, $2, $3, $4, $5)`,
        [JSON.stringify({ id: hb }), cls.id, run, `retention/${run}/manifest.json`, ageAt],
      );
    });
    const e = await pgError(
      app.pool.query(`UPDATE worker_heartbeat SET beat_count = beat_count + 1, version = version + 1 WHERE id = $1`, [
        hb,
      ]),
    );
    expect(e.constraint).toBe("worker_heartbeat_archived_read_only");
    // The class is 'archive', not 'archive_then_purge': the purge path refuses.
    expect(
      (
        await pgError(
          app.pool.query(`SELECT retention_purge_record($1, 'worker_heartbeat', $2)`, [
            run,
            JSON.stringify({ id: hb }),
          ]),
        )
      ).constraint,
    ).toBe("retention_purge_eligible");
    await stepRun(run, 3, `status = 'failed', failure_reason = 'probe end', finished_at = now()`);
  });
});

describe("0145 backup_set (ADR-0066 §6)", () => {
  const summary = (id: string, label: string): Record<string, unknown> => ({
    id,
    label,
    status: "succeeded",
    manifestSchemaVersion: "mth-backup/1",
    startedAt: "2026-11-12T10:00:00Z",
    finishedAt: "2026-11-12T10:05:00Z",
    migrationLevel: "0146_p7_retention_backup_permissions",
    serverMajor: 18,
    dumpFormat: "custom",
    dumpBytes: 1024,
    dumpSha256: HEX,
    evidenceBackend: "filesystem",
    evidenceObjectCount: 3,
    evidenceBytes: 300,
    attachmentManifestSha256: HEX,
    configBundleSha256: HEX,
    manifestSha256: HEX,
    operatorName: "probe operator",
  });

  it("the owner records a set through backup_set_record(), audited; the runtime role can only read", async () => {
    const id = uuidv7();
    await owner.pool.query(`SELECT backup_set_record($1::jsonb)`, [
      JSON.stringify(summary(id, `probe-${id.slice(-8)}`)),
    ]);
    const a = await app.pool.query<{ action: string }>(
      `SELECT action FROM audit_event WHERE record_type = 'backup_set' AND record_id = $1`,
      [id],
    );
    expect(a.rows).toEqual([{ action: "backup.recorded" }]);
    const other = uuidv7();
    expect(
      (await pgError(app.pool.query(`SELECT backup_set_record($1::jsonb)`, [JSON.stringify(summary(other, "x"))])))
        .code,
    ).toBe("42501");
    expect((await pgError(app.pool.query(`INSERT INTO backup_set (id) VALUES ($1)`, [other]))).code).toBe("42501");
    expect((await pgError(owner.pool.query(`UPDATE backup_set SET label = 'y' WHERE id = $1`, [id]))).code).toBe(
      "42501",
    );
  });

  it("an unknown key or an incomplete succeeded set is refused", async () => {
    const id = uuidv7();
    expect(
      (
        await pgError(
          owner.pool.query(`SELECT backup_set_record($1::jsonb)`, [
            JSON.stringify({ ...summary(id, `probe-${id.slice(-8)}`), password: "x" }),
          ]),
        )
      ).message,
    ).toContain("unknown key password");
    const s = summary(id, `probe-${id.slice(-8)}`);
    delete s["dumpSha256"];
    expect(
      (await pgError(owner.pool.query(`SELECT backup_set_record($1::jsonb)`, [JSON.stringify(s)]))).constraint,
    ).toBe("backup_set_succeeded_shape");
  });
});
