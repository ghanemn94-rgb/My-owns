// A19 "Backup and recovery" (master prompt §20, M0360; qa-verifier T-DG7-QA-A, test-first): "Restore drill recovers
// database, evidence, audit, snapshots and job state with documented checks and timings" (REQ-S20-019; REQ-S19-012).
//
// TEST-FIRST. This harness runs DO-F's container-free half of the drill (ADR-0066 §9, D-243 Q1): `backup.sh` of a
// source installation on this run's disposable PostgreSQL with a filesystem evidence store, then `restore.sh` into a
// FRESH database and an EMPTY evidence directory of the same major (D-243 Q14). Until DO-F lands
// `deploy/scripts/{backup,restore}.sh`, the drill tests fail with "A19 not built: <file> is missing (DO-F)". The
// pre-drill tests (the source is non-vacuous; the report checks reject broken reports) pass today.
//
// What the harness proves INDEPENDENTLY of the scripts' own report (an implementer's report is not evidence):
//  - database: every base table of `public` and `pgboss` has the same row count on source and target (R3), and the
//    migration level is equal (R2);
//  - audit: `audit_event` count and max(seq) equal (R4), and the `backup.recorded` audit event of the set exists in
//    the source;
//  - snapshots: a digest of every row of the six snapshot tables (ADR-0067 §3) is byte-equal (R5);
//  - job state: pgboss jobs by queue and state, every `job_schedule` row (including `enabled`) and `job_run` are
//    equal (R6); a job queued before the backup is still queued after the restore;
//  - evidence: every evidence file downloads over the API of the restored installation with the source SHA-256 (R7);
//  - the restored installation runs: `/readyz` is ready with `storage: ok`, and the worker is reported `unknown`,
//    never `alive` (no worker runs; Unknown is never shown green) (R8);
//  - documented checks and timings: `restore-report.json` holds R1–R8 with expected and actual and the seconds of
//    every step, the manifest holds the five backup timings, and docs/handover/backup-restore.md documents R1–R9,
//    the RPO/RTO placeholders and an Arabic summary;
//  - refusals (ADR-0066 §7, p7-work-split §E.5 exact lines): a changed byte, an unknown schema version, a non-empty
//    target database or evidence store -> exit 2 and nothing written.
//
// Mutation rules (CLAUDE.md): the only mutation is `backup_set_record()` (insert-only, no update path, so optimistic
// concurrency does not apply): authorization (mth_app is refused, 42501), validation (unknown key refused) and the
// audit event are asserted here on the drill's own set; listBackupSets is 403 without `backup.read`.
//
// All data is SYNTHETIC (the demo dataset plus synthetic evidence). Nothing here is a business, Finance or IT
// approval, and nothing touches the engineering gates DG0–DG7. Measured timings are drill timings, not RPO/RTO.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { migrate, seedDemo } from "../../../packages/db/src/index.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../packages/db/test/helpers.ts";
import { seedWorld } from "../../../apps/api/test/support/harness.ts";
import { ifm, setupP2World, type P2World } from "../../../apps/api/test/support/p2-fixtures.ts";
import { call, createPool, signIn, startApi, type Session, type TestApi } from "../support/api.ts";
import { qaBoss } from "../support/a13-durable.ts";
import {
  BACKUP_PASS_LINE,
  RESTORE_PASS_LINE,
  backupManifestProblems,
  restoreReportProblems,
  type Json,
} from "../support/a18-a19-reports.ts";

const REPO = resolve(import.meta.dirname, "..", "..", "..");
const BACKUP_SH = join(REPO, "deploy/scripts/backup.sh");
const RESTORE_SH = join(REPO, "deploy/scripts/restore.sh");
const GUIDE = join(REPO, "docs/handover/backup-restore.md");
/** ADR-0067 §3: the six snapshot tables, in this order (ADR-0066 §2 `snapshotDigest`). */
const SNAPSHOT_TABLES = [
  "report_snapshot",
  "report_snapshot_aggregate",
  "report_snapshot_evidence",
  "report_snapshot_source",
  "report_snapshot_version",
  "ranking_snapshot",
] as const;
const QUEUE = "qa.a19.pending";
const sha256 = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");
const PGBIN = process.env["PGBIN"] ?? "";

/** Fails with the name of the missing DO-F file, so the test-first failure is explicit. */
function requireBuilt(file: string): void {
  if (!existsSync(file))
    throw new Error(`A19 not built: ${file.slice(REPO.length + 1)} is missing (DO-F, p7-work-split §E.2)`);
}

interface Run {
  readonly status: number | null;
  readonly out: string;
  readonly seconds: number;
}

/**
 * Runs a DO-F script with only the operator's environment. The invocation is QA's reading of ADR-0066 §7 for the
 * container-free half (a database URL and a filesystem evidence path instead of a Compose project); if DO-F's final
 * flags differ, only `backup()` and `restore()` change (handback open question O1).
 */
function runScript(file: string, args: readonly string[], env: Record<string, string>): Run {
  const t0 = performance.now();
  const r = spawnSync("bash", [file, ...args], {
    cwd: REPO,
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: process.env["HOME"] ?? tmpdir(),
      TMPDIR: tmpdir(),
      LANG: "C.UTF-8",
      ...(PGBIN ? { PGBIN } : {}),
      ...env,
    },
    encoding: "utf8",
    timeout: 600_000,
  });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}`, seconds: (performance.now() - t0) / 1000 };
}

const ownerUrl = (db: string): string => roleUrl(inject("mthDb").adminUrl, db, "mth_owner");

function backup(root: string, label: string): Run {
  requireBuilt(BACKUP_SH);
  return runScript(BACKUP_SH, ["--out", root, "--label", label, "--operator", "QA synthetic drill"], {
    DATABASE_URL: ownerUrl(source),
    EVIDENCE_STORAGE_DRIVER: "filesystem",
    EVIDENCE_STORAGE_PATH: sourceEvidence,
  });
}

function restore(set: string, targetDb: string, targetEvidence: string, reportDir: string): Run {
  requireBuilt(RESTORE_SH);
  return runScript(
    RESTORE_SH,
    [
      "--from",
      set,
      "--target-database-url",
      ownerUrl(targetDb),
      "--target-evidence-path",
      targetEvidence,
      "--out",
      reportDir,
    ],
    { EVIDENCE_STORAGE_DRIVER: "filesystem", EVIDENCE_STORAGE_PATH: targetEvidence },
  );
}

// --------------------------------------------------------------------------- independent fingerprint of an install

interface Fingerprint {
  readonly migrationLevel: string;
  readonly tableCounts: Record<string, number>;
  readonly audit: { count: number; maxSeq: string };
  readonly snapshotDigest: string;
  readonly snapshotRows: number;
  readonly pgbossByQueueState: Record<string, number>;
  readonly jobSchedule: string;
  readonly jobRunCount: number;
  readonly evidence: Record<string, string>;
}

async function fingerprint(db: string): Promise<Fingerprint> {
  const pool = createPool(roleUrl(inject("mthDb").adminUrl, db, null), { max: 1, applicationName: "qa-a19-fp" });
  const q = async <T extends Record<string, unknown>>(sql: string): Promise<T[]> => (await pool.query<T>(sql)).rows;
  try {
    const tables = await q<{ s: string; t: string }>(
      `SELECT table_schema AS s, table_name AS t FROM information_schema.tables
        WHERE table_schema IN ('public', 'pgboss') AND table_type = 'BASE TABLE' ORDER BY 1, 2`,
    );
    const tableCounts: Record<string, number> = {};
    // QA-C (T-DG7-QA-C; DO-F Q1(b)): an EMPTY target (the refusal tests) has no tables at all, so it has no snapshot,
    // audit or job state to read; its fingerprint is the empty one, never a "relation does not exist" error.
    if (tables.length === 0)
      return {
        migrationLevel: "",
        tableCounts,
        audit: { count: 0, maxSeq: "" },
        snapshotDigest: "",
        snapshotRows: 0,
        pgbossByQueueState: {},
        jobSchedule: "",
        jobRunCount: 0,
        evidence: {},
      };
    for (const { s, t } of tables)
      tableCounts[`${s}.${t}`] = Number((await q<{ n: string }>(`SELECT count(*) AS n FROM "${s}"."${t}"`))[0]!.n);
    const digest = createHash("sha256");
    let snapshotRows = 0;
    for (const t of SNAPSHOT_TABLES) {
      // Ordered by the row text: independent of the script's primary-key order, equal iff the row sets are equal.
      const rows = await q<{ r: string }>(`SELECT t::text AS r FROM public."${t}" t ORDER BY 1`);
      snapshotRows += rows.length;
      digest.update(`${t}\n`);
      for (const { r } of rows) digest.update(`${r}\n`);
    }
    const hasPgboss = tables.some((x) => x.s === "pgboss" && x.t === "job");
    const pgbossByQueueState: Record<string, number> = {};
    if (hasPgboss)
      for (const r of await q<{ k: string; n: string }>(
        `SELECT name || ':' || state AS k, count(*) AS n FROM pgboss.job GROUP BY 1 ORDER BY 1`,
      ))
        pgbossByQueueState[r.k] = Number(r.n);
    const evidence: Record<string, string> = {};
    for (const r of await q<{ id: string; sha256: string }>(
      `SELECT evidence_id::text || ':' || revision AS id, sha256 FROM evidence_content ORDER BY 1`,
    ))
      evidence[r.id] = r.sha256;
    const audit = (
      await q<{ n: string; m: string | null }>(`SELECT count(*) AS n, max(seq)::text AS m FROM audit_event`)
    )[0]!;
    return {
      // ADR-0066 §2: `migrationLevel` is the last applied migration as `<id>_<name>` (QA-C, DO-F Q1(a): the
      // harness compared it with the integer max(id)). Recomputed here from schema_migration, independently.
      migrationLevel: await (async () => {
        const last = (
          await q<{ id: string; name: string }>(
            `SELECT m.id::text AS id, m.name FROM schema_migration m ORDER BY m.id DESC LIMIT 1`,
          )
        )[0];
        if (!last) return "";
        const base = last.name.replace(/\.sql$/, "");
        return /^\d{4}_/.test(base) ? base : `${last.id.padStart(4, "0")}_${base}`;
      })(),
      tableCounts,
      audit: { count: Number(audit.n), maxSeq: audit.m ?? "" },
      snapshotDigest: digest.digest("hex"),
      snapshotRows,
      pgbossByQueueState,
      jobSchedule: (await q<{ r: string }>(`SELECT t::text AS r FROM job_schedule t ORDER BY 1`))
        .map((x) => x.r)
        .join("\n"),
      jobRunCount: Number((await q<{ n: string }>(`SELECT count(*) AS n FROM job_run`))[0]!.n),
      evidence,
    };
  } finally {
    await pool.end();
  }
}

// --------------------------------------------------------------------------- the source installation (synthetic)

let work: string;
let source: string;
let sourceEvidence: string;
let api: TestApi;
let p: P2World;
let adminSubject: string;
let T: string;
const uploaded: { id: string; sha256: string }[] = [];
const scratch: string[] = [];
const timings: Record<string, number> = {};

async function freshDatabase(prefix: string): Promise<string> {
  const db = await createScratchDatabase(inject("mthDb").adminUrl, prefix);
  scratch.push(db);
  return db;
}

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "qa-a19-"));
  source = await freshDatabase("mth_qa_a19_src");
  await migrate(ownerUrl(source));
  await seedDemo(ownerUrl(source), { mthEnv: "demo", runKind: "seed", requestedVia: "cli", requestedBy: null });
  sourceEvidence = join(work, "source-evidence");
  mkdirSync(sourceEvidence);
  api = await startApi({ database: source, env: { MTH_ENV: "demo", EVIDENCE_STORAGE_PATH: sourceEvidence } });
  const w = await seedWorld(api.db);
  adminSubject = w.admin.subject; // ADM_ACCESS + ADM_TECH @ org A (backup.read by role default, 0146)
  p = await setupP2World(api, w);
  T = `/api/v1/transformations/${p.transformationId}`;
  // Synthetic evidence: two distinct files and a second item with the same bytes (one stored object, two rows).
  const files: [string, Buffer][] = [
    ["a19-one.txt", Buffer.from("Synthetic A19 evidence one\n")],
    ["a19-two.csv", Buffer.from("kpi,value\nsynthetic,1.50\n")],
    ["a19-one-again.txt", Buffer.from("Synthetic A19 evidence one\n")],
  ];
  for (const [name, bytes] of files) {
    const item = await call<Json>(api.app, "POST", `${T}/evidence`, {
      session: p.lead.session,
      body: { kind: "file", title: `Synthetic ${name}`, ownerUserId: p.lead.id },
    });
    expect(item.status, JSON.stringify(item.body)).toBe(201);
    const up = await call<Json>(api.app, "POST", `${T}/evidence/${item.body.id}/content`, {
      session: p.lead.session,
      headers: { ...ifm(item.body.version), "content-type": "application/octet-stream", "x-file-name": name },
      body: bytes,
    });
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    uploaded.push({ id: item.body.id, sha256: sha256(bytes) });
  }
  // Job state: a queued job that no worker consumes (it must still be queued after the restore).
  const boss = qaBoss(roleUrl(inject("mthDb").adminUrl, source, "mth_app"), "qa-a19-boss");
  await boss.start();
  await boss.createQueue(QUEUE);
  await boss.send(QUEUE, { synthetic: true });
  await boss.stop({ graceful: false, wait: true });
}, 300_000);

afterAll(async () => {
  await api?.close().catch(() => undefined);
  for (const db of scratch) await dropScratchDatabase(inject("mthDb").adminUrl, db).catch(() => undefined);
  if (work) rmSync(work, { recursive: true, force: true });
  // The measured timings of this run (drill timings, not recovery objectives), for the evidence log.
  console.log(`A19-TIMINGS ${JSON.stringify(timings)}`);
}, 120_000);

describe("A19 pre-drill: the source installation is not vacuous", () => {
  it("the source holds demo records, audit, snapshots, job state and evidence objects to recover", async () => {
    const fp = await fingerprint(source);
    expect(fp.audit.count).toBeGreaterThan(0);
    expect(fp.snapshotRows, "the demo dataset has snapshot rows").toBeGreaterThan(0);
    expect(fp.pgbossByQueueState[`${QUEUE}:created`]).toBe(1);
    expect(fp.jobSchedule.length).toBeGreaterThan(0);
    expect(Object.keys(fp.evidence)).toHaveLength(3);
    expect(readdirSync(sourceEvidence, { recursive: true }).length).toBeGreaterThan(0);
  });
});

// --------------------------------------------------------------------------- the drill (fails until DO-F lands)

describe("A19 drill: backup, then restore into a fresh database and an empty evidence store (REQ-S20-019)", () => {
  const label = `qa-a19-${Date.now().toString(36)}`;
  let root: string;
  let set: string;
  let before: Fingerprint;
  let target: string;
  let targetEvidence: string;
  let reportDir: string;
  let restoreRun: Run;

  it("backup.sh writes a set with the mth-backup/1 manifest, five timings, and records it audited", async () => {
    root = join(work, "backups");
    mkdirSync(root, { recursive: true });
    before = await fingerprint(source);
    const r = backup(root, label);
    timings["backup.total"] = r.seconds;
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(BACKUP_PASS_LINE);
    set = join(root, label);
    const manifestBytes = readFileSync(join(set, "backup-manifest.json"));
    const m = JSON.parse(manifestBytes.toString("utf8"));
    expect(backupManifestProblems(m)).toEqual([]);
    for (const [k, v] of Object.entries(m.timings ?? {})) timings[`backup.${k}`] = v as number;
    expect(m.label).toBe(label);
    expect(m.migrationLevel).toBe(before.migrationLevel);
    expect(Number(m.database.auditEvents.count)).toBeGreaterThanOrEqual(before.audit.count);
    expect(m.database.pgbossJobsByState.created).toBeGreaterThanOrEqual(1);
    expect(Number(m.evidence.attachmentManifest.count)).toBe(2); // two distinct objects for three rows
    // The printed manifest hash is the file's SHA-256 (ADR-0066 §2) and the recorded one (§6).
    expect(BACKUP_PASS_LINE.exec(r.out)?.[4]).toBe(sha256(manifestBytes));
    const pool = createPool(roleUrl(inject("mthDb").adminUrl, source, null), { max: 1 });
    try {
      const row = (await pool.query(`SELECT id, status, manifest_sha256 FROM backup_set WHERE label = $1`, [label]))
        .rows[0];
      expect(row?.status).toBe("succeeded");
      expect(row?.manifest_sha256).toBe(sha256(manifestBytes));
      const audit = await pool.query(
        `SELECT action FROM audit_event WHERE record_type = 'backup_set' AND record_id = $1`,
        [row.id],
      );
      expect(audit.rows.map((x) => x.action)).toEqual(["backup.recorded"]);
    } finally {
      await pool.end();
    }
  }, 600_000);

  it("the set's config/ holds no secret value (configuration without credentials)", () => {
    requireBuilt(BACKUP_SH);
    const cfg = join(set, "config");
    expect(existsSync(cfg)).toBe(true);
    for (const f of readdirSync(cfg, { recursive: true, withFileTypes: true }).filter((d) => d.isFile())) {
      const text = readFileSync(join(f.parentPath, f.name), "utf8");
      expect(text, f.name).not.toMatch(/BEGIN [A-Z ]*PRIVATE KEY/);
      // A password in a URL (user:password@host) is a secret value.
      expect(text, f.name).not.toMatch(/postgres(?:ql)?:\/\/[^:\s/]+:[^@\s<]+@/);
    }
  });

  it("restore.sh restores into a fresh database and an empty evidence store, passing R1–R8 with timings", async () => {
    requireBuilt(RESTORE_SH);
    target = await freshDatabase("mth_qa_a19_tgt");
    targetEvidence = join(work, "target-evidence");
    reportDir = join(work, "restore-report");
    mkdirSync(targetEvidence);
    mkdirSync(reportDir);
    restoreRun = restore(set, target, targetEvidence, reportDir);
    timings["restore.total"] = restoreRun.seconds;
    expect(restoreRun.status, restoreRun.out).toBe(0);
    expect(restoreRun.out).toMatch(RESTORE_PASS_LINE);
    expect(RESTORE_PASS_LINE.exec(restoreRun.out)?.[1]).toBe(label);
    const reportFile = [join(reportDir, "restore-report.json"), join(set, "restore-report.json")].find(existsSync);
    expect(reportFile, "restore-report.json written").toBeDefined();
    const report = JSON.parse(readFileSync(reportFile!, "utf8"));
    expect(restoreReportProblems(report)).toEqual([]);
    for (const s of report.steps ?? []) timings[`restore.${s.name ?? s.id}`] = s.seconds;
    for (const [k, v] of Object.entries(report.timings ?? {})) timings[`restore.${k}`] = v as number;
  }, 600_000);

  it("database (R2, R3), audit (R4), snapshots (R5) and job state (R6) are equal, by QA's own recount", async () => {
    requireBuilt(RESTORE_SH);
    const after = await fingerprint(target);
    expect(after.migrationLevel).toBe(before.migrationLevel);
    // The backup_set row is written after the dump, so the restored set never lists itself (ADR-0066 §6,
    // Residual 2); its audit event likewise. Every other table is equal.
    const skip = new Set(["public.backup_set", "public.audit_event"]);
    const strip = (c: Record<string, number>) => Object.fromEntries(Object.entries(c).filter(([k]) => !skip.has(k)));
    expect(strip(after.tableCounts)).toEqual(strip(before.tableCounts));
    expect(after.tableCounts["public.backup_set"]).toBe(before.tableCounts["public.backup_set"]);
    expect(after.audit).toEqual(before.audit);
    expect(after.snapshotRows).toBe(before.snapshotRows);
    expect(after.snapshotDigest).toBe(before.snapshotDigest);
    expect(after.pgbossByQueueState).toEqual(before.pgbossByQueueState);
    expect(after.pgbossByQueueState[`${QUEUE}:created`]).toBe(1);
    expect(after.jobSchedule).toBe(before.jobSchedule);
    expect(after.jobRunCount).toBe(before.jobRunCount);
    expect(after.evidence).toEqual(before.evidence);
  });

  it("evidence (R7) and readiness (R8): every file downloads from the restored installation with its SHA-256", async () => {
    requireBuilt(RESTORE_SH);
    const t0 = performance.now();
    const restored = await startApi({
      database: target,
      env: { MTH_ENV: "demo", EVIDENCE_STORAGE_PATH: targetEvidence },
    });
    try {
      const ready = await call<Json>(restored.app, "GET", "/readyz");
      timings["check.timeToReady"] = (performance.now() - t0) / 1000;
      expect(ready.status, JSON.stringify(ready.body)).toBe(200);
      expect(ready.body.checks).toMatchObject({ database: "ok", migrations: "ok", storage: "ok" });
      // No worker runs on the target: the worker is Unknown or Stale, never shown alive.
      expect(["unknown", "stale"]).toContain(ready.body.checks.worker);
      const subject = (
        await restored.db
          .selectFrom("user_identity")
          .select("subject")
          .where("user_id", "=", p.lead.id)
          .executeTakeFirst()
      )?.subject;
      expect(subject, "the lead's identity is restored").toBeDefined();
      const lead: Session = await signIn(restored.app, subject!);
      for (const u of uploaded) {
        const res = await call<Json>(restored.app, "GET", `${T}/evidence/${u.id}/content`, { session: lead });
        expect(res.status, u.id).toBe(200);
        expect(sha256(res.raw.rawPayload), u.id).toBe(u.sha256);
      }
    } finally {
      await restored.close();
    }
  }, 120_000);

  it("the set appears in listBackupSets of the source for ADM_TECH; 403 without backup.read", async () => {
    requireBuilt(BACKUP_SH);
    const admin = await signIn(api.app, adminSubject);
    const list = await call<Json>(api.app, "GET", "/api/v1/admin/backups", { session: admin });
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body.items.map((s: Json) => s.label)).toContain(label);
    const denied = await call<Json>(api.app, "GET", "/api/v1/admin/backups", { session: p.lead.session });
    expect(denied.status).toBe(403);
  });

  // ------------------------------------------------------------------------- refusals (ADR-0066 §7; §E.5 lines)

  it("a non-empty target database is refused (exit 2) and left unchanged", async () => {
    requireBuilt(RESTORE_SH);
    const fresh = join(work, "ev-nonempty-db");
    mkdirSync(fresh);
    const before2 = await fingerprint(target);
    const r = restore(set, target, fresh, join(work, "r-nonempty-db"));
    expect(r.status, r.out).toBe(2);
    expect(r.out).toContain("restore: refused: the target database is not empty");
    expect(await fingerprint(target)).toEqual(before2);
    expect(readdirSync(fresh)).toEqual([]);
  }, 300_000);

  it("a non-empty target evidence store is refused (exit 2); nothing is written to the database", async () => {
    requireBuilt(RESTORE_SH);
    const db = await freshDatabase("mth_qa_a19_ev");
    const ev = join(work, "ev-nonempty");
    mkdirSync(ev);
    writeFileSync(join(ev, "synthetic-existing-object"), "synthetic");
    const r = restore(set, db, ev, join(work, "r-nonempty-ev"));
    expect(r.status, r.out).toBe(2);
    expect(r.out).toContain("restore: refused: the target evidence store is not empty");
    expect((await fingerprint(db)).tableCounts).toEqual({});
  }, 300_000);

  it("a changed byte in a set file is refused (exit 2) naming the file; the target stays empty", async () => {
    requireBuilt(RESTORE_SH);
    const bad = join(work, "set-corrupt");
    cpSync(set, bad, { recursive: true });
    const f = join(bad, "db/table-counts.tsv");
    const b = readFileSync(f);
    b[0] = b[0]! ^ 0x01;
    writeFileSync(f, b);
    const db = await freshDatabase("mth_qa_a19_bad");
    const ev = join(work, "ev-corrupt");
    mkdirSync(ev);
    const r = restore(bad, db, ev, join(work, "r-corrupt"));
    expect(r.status, r.out).toBe(2);
    expect(r.out).toContain("restore: refused: checksum mismatch for db/table-counts.tsv");
    expect((await fingerprint(db)).tableCounts).toEqual({});
    expect(readdirSync(ev)).toEqual([]);
    rmSync(bad, { recursive: true, force: true });
  }, 300_000);

  it("an unsupported schema version is refused (exit 2) with the exact line", async () => {
    requireBuilt(RESTORE_SH);
    const bad = join(work, "set-version");
    cpSync(set, bad, { recursive: true });
    const mf = join(bad, "backup-manifest.json");
    const m = JSON.parse(readFileSync(mf, "utf8"));
    m.schemaVersion = "mth-backup/0";
    writeFileSync(mf, JSON.stringify(m));
    const db = await freshDatabase("mth_qa_a19_ver");
    const ev = join(work, "ev-version");
    mkdirSync(ev);
    const r = restore(bad, db, ev, join(work, "r-version"));
    expect(r.status, r.out).toBe(2);
    expect(r.out).toContain("restore: refused: unsupported backup schema version 'mth-backup/0'");
    expect((await fingerprint(db)).tableCounts).toEqual({});
    rmSync(bad, { recursive: true, force: true });
  }, 300_000);

  it("backup_set_record(): the runtime role is refused and an unknown key is refused (authorization, validation)", async () => {
    requireBuilt(BACKUP_SH);
    const app = createPool(roleUrl(inject("mthDb").adminUrl, source, "mth_app"), { max: 1 });
    const owner = createPool(ownerUrl(source), { max: 1 });
    try {
      const row = (await owner.query(`SELECT to_jsonb(b) AS j FROM backup_set b WHERE label = $1`, [label])).rows[0];
      expect(row, "the drill's set is recorded").toBeDefined();
      const err = await app.query(`SELECT backup_set_record('{}'::jsonb)`).then(
        () => null,
        (e: { code?: string }) => e,
      );
      expect(err?.code).toBe("42501");
      const unknown = await owner
        .query(`SELECT backup_set_record($1::jsonb)`, [JSON.stringify({ label: "qa-x", password: "synthetic" })])
        .then(
          () => null,
          (e: Error) => e,
        );
      expect(unknown?.message ?? "").toMatch(/unknown key/);
    } finally {
      await app.end();
      await owner.end();
    }
  });
});

// --------------------------------------------------------------------------- documented checks (the guide)

describe("A19 documented checks: docs/handover/backup-restore.md (DO-F)", () => {
  it("documents R1–R9, measured drill timings, RPO/RTO 'to agree with Mobily IT' and an Arabic summary", () => {
    if (!existsSync(GUIDE)) throw new Error("A19 not built: docs/handover/backup-restore.md is missing (DO-F)");
    const text = readFileSync(GUIDE, "utf8");
    for (const r of ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9"]) expect(text, r).toContain(r);
    expect(text).toMatch(/to agree with Mobily IT/i);
    expect(text).toMatch(/RPO/);
    expect(text).toMatch(/RTO/);
    expect(text).toMatch(/\p{Script=Arabic}{3,}/u);
    expect(statSync(GUIDE).size).toBeGreaterThan(0);
  });
});
