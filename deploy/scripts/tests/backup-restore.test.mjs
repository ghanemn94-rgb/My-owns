// T-E1…T-E9 (p7-work-split §E.4; ADR-0066 §1-§8; T-DG7-DO-F): deploy/scripts/backup.sh and restore.sh against a
// DISPOSABLE PostgreSQL cluster. REQ-S19-012, REQ-S20-019 (A19, container-free half; D-243 Q1, Q14).
//
//   tests/qa/support/with-pg.sh node --test deploy/scripts/tests/backup-restore.test.mjs
//
// Without TEST_DATABASE_ADMIN_URL every test FAILS with "BLOCKED: …" (never a silent skip, never a pass).
// All data is SYNTHETIC: the demo dataset (mth-db seed-demo), one synthetic evidence object, one synthetic retention
// archive set and one synthetic queued pg-boss job. Canary "secret" values are assembled at run time from fragments,
// so the repository never holds a whole one. Nothing here is a business, Finance or IT approval, and nothing touches
// DG0-DG7.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const BACKUP = join(REPO, "deploy/scripts/backup.sh");
const RESTORE = join(REPO, "deploy/scripts/restore.sh");
const ADMIN = process.env.TEST_DATABASE_ADMIN_URL ?? "";
const work = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "mth-backup-test-"));
const databases = [];
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const RECORD_KEYS = [
  "id",
  "label",
  "status",
  "manifestSchemaVersion",
  "startedAt",
  "finishedAt",
  "migrationLevel",
  "serverMajor",
  "dumpFormat",
  "dumpBytes",
  "dumpSha256",
  "evidenceBackend",
  "evidenceObjectCount",
  "evidenceBytes",
  "attachmentManifestSha256",
  "configBundleSha256",
  "manifestSha256",
  "failureReason",
  "operatorName",
];

function blocked() {
  if (!ADMIN) throw new Error("BLOCKED: TEST_DATABASE_ADMIN_URL is not set (run under tests/qa/support/with-pg.sh)");
}
function dbUrl(db, role = "mth_owner") {
  const u = new URL(ADMIN);
  u.pathname = `/${db}`;
  if (role) u.searchParams.set("options", `-c role=${role}`);
  return u.toString().replace(/\+/g, "%20");
}
function psql(url, sql) {
  const r = spawnSync("psql", ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", url], { input: sql, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`psql: ${r.stderr}`);
  return r.stdout.trim();
}
function createDatabase(prefix) {
  const name = `${prefix}_${process.pid}_${databases.length}`;
  psql(ADMIN, `CREATE DATABASE ${name} OWNER mth_owner ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`);
  databases.push(name);
  return name;
}
function run(file, args, env = {}) {
  const r = spawnSync("bash", [file, ...args], {
    cwd: REPO,
    env: { PATH: process.env.PATH, HOME: process.env.HOME ?? tmpdir(), TMPDIR: work, LANG: "C.UTF-8", ...env },
    encoding: "utf8",
    timeout: 600_000,
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}
function cli(args, env) {
  const r = spawnSync("node", ["--conditions=@mth/source", "src/cli.ts", ...args], {
    cwd: join(REPO, "packages/db"),
    env: { ...process.env, NODE_ENV: "development", ...env },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, `mth-db ${args.join(" ")}: ${r.stdout}${r.stderr}`);
}
const tableCount = (db) => Number(psql(dbUrl(db, null), "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'"));
const listFiles = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => join(d.parentPath, d.name).slice(dir.length + 1))
    .sort();

let source;
let sourceEvidence;
let set;
let manifest;
let backupOut;
const LABEL = "test-do-f-set";
// Canary values (assembled from fragments; never a real secret).
const CANARY_SECRET = ["can", "ary-", "sess", "ion-", "9f3a"].join("");
const CANARY_PASSWORD = ["can", "ary", "Pw", "7781"].join("");

function backup(label, extra = [], env = {}) {
  return run(
    BACKUP,
    ["--out", join(work, "backups"), "--label", label, "--operator", "DO-F synthetic test", ...extra],
    {
      DATABASE_URL: dbUrl(source),
      EVIDENCE_STORAGE_DRIVER: "filesystem",
      EVIDENCE_STORAGE_PATH: sourceEvidence,
      ...env,
    },
  );
}
function restore(from, target, evidence, out = join(work, "reports", target)) {
  return run(RESTORE, [
    "--from",
    from,
    "--target-database-url",
    dbUrl(target),
    "--target-evidence-path",
    evidence,
    "--out",
    out,
  ]);
}

before(() => {
  if (!ADMIN) return;
  for (const r of ["mth_owner", "mth_app"])
    if (psql(ADMIN, `SELECT count(*) FROM pg_roles WHERE rolname = '${r}'`) === "0")
      psql(ADMIN, `CREATE ROLE ${r} NOLOGIN`);
  source = createDatabase("mth_dof_src");
  cli(["migrate"], { DATABASE_OWNER_URL: dbUrl(source) });
  cli(["seed-demo"], { DATABASE_OWNER_URL: dbUrl(source), AUTH_MODE: "dev", MTH_ENV: "demo" });
  sourceEvidence = join(work, "source-evidence");
  mkdirSync(sourceEvidence);
  // Job state: one synthetic queued pg-boss job (it must be counted by state, R6).
  psql(
    dbUrl(source),
    `SELECT pgboss.create_queue('test.do-f.synthetic', '{"policy": "standard"}'::jsonb);
     INSERT INTO pgboss.job (name, data) VALUES ('test.do-f.synthetic', '{"synthetic": true}');`,
  );
  // A synthetic retention archive set (ADR-0066 §1: copied from retention_run.archive_set_key).
  const runId = psql(dbUrl(source), "SELECT mth_uuid_v7()");
  const dir = join(sourceEvidence, "retention", runId);
  mkdirSync(join(dir, "tables"), { recursive: true });
  const archiveManifest = Buffer.from('{"schemaVersion":"mth-retention-archive/1","synthetic":true}\n');
  writeFileSync(join(dir, "manifest.json"), archiveManifest);
  writeFileSync(join(dir, "tables", "processed_message.ndjson"), '{"synthetic":1}\n');
  psql(
    dbUrl(source),
    `BEGIN;
     INSERT INTO retention_run (id, mode, requested_via, as_of) VALUES ('${runId}', 'run', 'schedule', now());
     INSERT INTO audit_event (id, actor_type, action, record_type, record_id, source, changes, new_version)
     SELECT mth_uuid_v7(), 'system', 'retention_run.' || a, 'retention_run', '${runId}', 'cli', '{"synthetic": true}', v
       FROM (VALUES ('requested', 1), ('started', 2), ('succeeded', 3)) AS x(a, v);
     UPDATE retention_run SET status = 'running', started_at = now(), version = 2 WHERE id = '${runId}';
     UPDATE retention_run SET status = 'succeeded', candidate_count = 0, archived_count = 0, purged_count = 0,
       skipped_count = 0, archive_set_key = 'retention/${runId}/manifest.json',
       archive_set_sha256 = '${sha256(archiveManifest)}', archive_set_bytes = ${archiveManifest.length},
       finished_at = now(), version = 3 WHERE id = '${runId}';
     COMMIT;`,
  );
  // An environment file with canary secret values and ordinary values (T-E3).
  writeFileSync(
    join(work, "test.env"),
    [
      "MTH_DEFAULT_TIMEZONE=Asia/Riyadh",
      `MTH_SESSION_SECRET=${CANARY_SECRET}`,
      `MTH_DATABASE_URL=postgresql://mth_app:${CANARY_PASSWORD}@db:5432/mth`,
      "OIDC_CLIENT_SECRET_FILE=/run/secrets/oidc_client_secret",
      "",
    ].join("\n"),
  );
  // T-E2: a probe table and a pg_dump wrapper that commits a row into it AFTER the snapshot is exported.
  psql(dbUrl(source), "CREATE TABLE public.zz_test_probe (id int PRIMARY KEY); INSERT INTO zz_test_probe VALUES (1);");
  const bin = join(work, "pgbin");
  mkdirSync(bin);
  const realBin = dirname(spawnSync("bash", ["-c", "command -v pg_dump"], { encoding: "utf8" }).stdout.trim());
  for (const t of ["psql", "pg_restore"])
    writeFileSync(join(bin, t), `#!/usr/bin/env bash\nexec "${realBin}/${t}" "$@"\n`, { mode: 0o755 });
  writeFileSync(
    join(bin, "pg_dump"),
    `#!/usr/bin/env bash\nif [ "$1" != "--version" ]; then "${realBin}/psql" -X -q "${dbUrl(source)}" ` +
      `-c "INSERT INTO zz_test_probe VALUES (2)" >/dev/null; fi\nexec "${realBin}/pg_dump" "$@"\n`,
    { mode: 0o755 },
  );
  mkdirSync(join(work, "backups"));
  backupOut = backup(LABEL, ["--env-file", join(work, "test.env"), "--record-out", join(work, "record.json")], {
    PGBIN: bin,
  });
  set = join(work, "backups", LABEL);
  if (existsSync(join(set, "backup-manifest.json")))
    manifest = JSON.parse(readFileSync(join(set, "backup-manifest.json"), "utf8"));
});

after(() => {
  if (ADMIN) for (const db of databases) psql(ADMIN, `DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
  rmSync(work, { recursive: true, force: true });
});

test("T-E1: the set has exactly the ADR-0066 §1 layout, schemaVersion mth-backup/1, every listed SHA-256 matches", () => {
  blocked();
  assert.equal(backupOut.status, 0, backupOut.out);
  assert.match(
    backupOut.out,
    new RegExp(
      `^backup: set ${LABEL} succeeded: \\d+ database bytes, 0 evidence objects; manifest sha256 ` +
        `${sha256(readFileSync(join(set, "backup-manifest.json")))}$`,
      "m",
    ),
  );
  assert.deepEqual(readdirSync(set).sort(), ["backup-manifest.json", "config", "db", "evidence"]);
  assert.deepEqual(readdirSync(join(set, "db")).sort(), ["database.dump", "table-counts.tsv"]);
  assert.deepEqual(readdirSync(join(set, "evidence")).sort(), ["attachments.json", "retention"]);
  assert.equal(manifest.schemaVersion, "mth-backup/1");
  assert.match(manifest.migrationLevel, /^\d{4}_[a-z0-9_]+$/);
  assert.equal(manifest.database.format, "custom");
  const files = listFiles(set).filter((f) => f !== "backup-manifest.json");
  assert.deepEqual(manifest.files.map((f) => f.path).sort(), files);
  for (const f of manifest.files) assert.equal(sha256(readFileSync(join(set, f.path))), f.sha256, f.path);
  assert.equal(manifest.database.sha256, sha256(readFileSync(join(set, "db/database.dump"))));
  assert.equal(manifest.evidence.retentionSets.length, 1);
  assert.equal(manifest.evidence.retentionSets[0].files, 2);
  for (const t of ["snapshot", "dump", "evidence", "config", "verify"])
    assert.ok(Number.isFinite(manifest.timings[t]) && manifest.timings[t] >= 0, t);
  assert.ok(manifest.database.pgbossJobsByState.created >= 1, "the synthetic queued job is counted by state");
  assert.doesNotMatch(JSON.stringify(manifest), /password|BEGIN [A-Z ]*PRIVATE KEY/i);
});

test("T-E2: table-counts.tsv equals the dump's snapshot: a row committed during the dump is in neither", () => {
  blocked();
  const counts = readFileSync(join(set, "db/table-counts.tsv"), "utf8");
  assert.match(counts, /^public\.zz_test_probe\t1$/m, "the counts were taken before the row was committed");
  assert.equal(psql(dbUrl(source), "SELECT count(*) FROM zz_test_probe"), "2", "the row was committed in the source");
  assert.match(counts, /^pgboss\.job\t1$/m);
  for (const line of counts.trim().split("\n")) assert.match(line, /^[a-z0-9_]+\.[a-z0-9_]+\t\d+$/);
});

test("T-E3: config/ holds no secret value; the keys and the *_FILE pointers are kept", () => {
  blocked();
  const all = listFiles(join(set, "config"))
    .map((f) => readFileSync(join(set, "config", f), "utf8"))
    .join("\n");
  assert.ok(!all.includes(CANARY_SECRET), "the session secret canary is absent");
  assert.ok(!all.includes(CANARY_PASSWORD), "the URL password canary is absent");
  const env = readFileSync(join(set, "config/environment.env"), "utf8");
  assert.match(env, /^MTH_SESSION_SECRET=<removed>$/m);
  assert.match(env, /^MTH_DATABASE_URL=postgresql:\/\/mth_app:<removed>@db:5432\/mth$/m);
  assert.match(env, /^OIDC_CLIENT_SECRET_FILE=\/run\/secrets\/oidc_client_secret$/m);
  assert.match(env, /^MTH_DEFAULT_TIMEZONE=Asia\/Riyadh$/m);
  assert.ok(existsSync(join(set, "config/compose.yaml")) && existsSync(join(set, "config/images.lock.json")));
});

test("T-E4: a changed byte in any set file -> restore exit 2 naming the file; the target stays empty", () => {
  blocked();
  const target = createDatabase("mth_dof_t4");
  for (const f of manifest.files.map((x) => x.path)) {
    const bad = join(work, "t4-set");
    rmSync(bad, { recursive: true, force: true });
    cpSync(set, bad, { recursive: true });
    const b = readFileSync(join(bad, f));
    b[0] = b[0] ^ 0x01;
    writeFileSync(join(bad, f), b);
    const ev = join(work, "t4-evidence");
    rmSync(ev, { recursive: true, force: true });
    mkdirSync(ev);
    const r = restore(bad, target, ev);
    assert.equal(r.status, 2, `${f}: ${r.out}`);
    assert.ok(r.out.includes(`restore: refused: checksum mismatch for ${f}`), `${f}: ${r.out}`);
    assert.equal(tableCount(target), 0, f);
    assert.deepEqual(readdirSync(ev), [], f);
  }
  rmSync(join(work, "t4-set"), { recursive: true, force: true });
});

test("T-E5: a manifest from another PostgreSQL major -> exit 2 with the §E.5 line", () => {
  blocked();
  const bad = join(work, "t5-set");
  cpSync(set, bad, { recursive: true });
  const m = JSON.parse(readFileSync(join(bad, "backup-manifest.json"), "utf8"));
  const target = createDatabase("mth_dof_t5");
  const major = Number(psql(dbUrl(target), "SELECT current_setting('server_version_num')::int / 10000"));
  m.server.major = major + 1;
  writeFileSync(join(bad, "backup-manifest.json"), JSON.stringify(m, null, 2));
  const ev = join(work, "t5-evidence");
  mkdirSync(ev);
  const r = restore(bad, target, ev);
  assert.equal(r.status, 2, r.out);
  assert.ok(
    r.out.includes(
      `restore: refused: backup is from PostgreSQL ${major + 1}, target is ${major}; a cross-major restore is an ` +
        "upgrade (dump with the newer client), see upgrades.md",
    ),
    r.out,
  );
  assert.equal(tableCount(target), 0);
  rmSync(bad, { recursive: true, force: true });
});

test("T-E6: a non-empty target database or evidence store -> exit 2; nothing written", () => {
  blocked();
  const full = createDatabase("mth_dof_t6a");
  psql(dbUrl(full), "CREATE TABLE public.existing (id int)");
  const ev1 = join(work, "t6-ev1");
  mkdirSync(ev1);
  let r = restore(set, full, ev1);
  assert.equal(r.status, 2, r.out);
  assert.ok(r.out.includes("restore: refused: the target database is not empty"), r.out);
  assert.equal(tableCount(full), 1);
  assert.deepEqual(readdirSync(ev1), []);
  const empty = createDatabase("mth_dof_t6b");
  const ev2 = join(work, "t6-ev2");
  mkdirSync(ev2);
  writeFileSync(join(ev2, "existing-object"), "synthetic");
  r = restore(set, empty, ev2);
  assert.equal(r.status, 2, r.out);
  assert.ok(r.out.includes("restore: refused: the target evidence store is not empty"), r.out);
  assert.equal(tableCount(empty), 0);
  assert.deepEqual(readdirSync(ev2), ["existing-object"]);
});

test("T-E7: a restore into a fresh database passes R1–R8 and writes restore-report.json with every step's seconds", () => {
  blocked();
  const target = createDatabase("mth_dof_t7");
  const ev = join(work, "t7-evidence");
  const out = join(work, "t7-report");
  const r = restore(set, target, ev, out);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, new RegExp(`^restore: ${LABEL} restored and ready in \\d+(\\.\\d+)? s; all checks passed$`, "m"));
  const report = JSON.parse(readFileSync(join(out, "restore-report.json"), "utf8"));
  assert.deepEqual(
    report.checks.map((c) => [c.id, c.result]),
    ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8"].map((id) => [id, "PASS"]),
  );
  for (const c of report.checks) assert.deepEqual(c.expected, c.actual, c.id);
  assert.deepEqual(
    report.steps.map((s) => s.name),
    ["packageChecks", "targetChecks", "database", "evidence", "checks", "total"],
  );
  for (const s of report.steps) assert.ok(Number.isFinite(s.seconds) && s.seconds >= 0, s.name);
  // Independent recount: the probe table holds the snapshot's single row, the queued job is still queued, and the
  // retention archive set is back under the same name with the same bytes.
  assert.equal(psql(dbUrl(target), "SELECT count(*) FROM zz_test_probe"), "1");
  assert.equal(psql(dbUrl(target), "SELECT count(*) FROM pgboss.job WHERE state = 'created'"), "1");
  const runId = manifest.evidence.retentionSets[0].runId;
  assert.equal(
    sha256(readFileSync(join(ev, "retention", runId, "manifest.json"))),
    manifest.evidence.retentionSets[0].manifestSha256,
  );
  // mth_app keeps exactly the dumped privileges (GRANTs restored, owner mth_owner).
  const grants = `SELECT count(*) FROM information_schema.role_table_grants WHERE grantee = 'mth_app'`;
  assert.equal(psql(dbUrl(target, null), grants), psql(dbUrl(source, null), grants));
});

test("T-E8: a failing step records a `failed` set with its reason through backup_set_record()", () => {
  blocked();
  const r = backup("test-do-f-failed", ["--record-out", join(work, "record-failed.json")], {
    MTH_TRANSFER_ATTACHMENTS: "false",
  });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /^backup: set test-do-f-failed failed: transfer-attachments copy-out failed/m);
  const row = psql(
    dbUrl(source, null),
    "SELECT status || '|' || failure_reason FROM backup_set WHERE label = 'test-do-f-failed'",
  );
  assert.match(row, /^failed\|transfer-attachments copy-out failed/);
  const audit = psql(
    dbUrl(source, null),
    `SELECT count(*) FROM audit_event a JOIN backup_set b ON a.record_id = b.id
      WHERE b.label = 'test-do-f-failed' AND a.action = 'backup.recorded'`,
  );
  assert.equal(audit, "1");
  // The succeeded set is recorded too, with the manifest's SHA-256.
  assert.equal(
    psql(dbUrl(source, null), `SELECT status || '|' || manifest_sha256 FROM backup_set WHERE label = '${LABEL}'`),
    `succeeded|${sha256(readFileSync(join(set, "backup-manifest.json")))}`,
  );
});

test("T-E9: the backup_set_record() argument has exactly the 19 keys of ADR-0066 §6", () => {
  blocked();
  for (const f of ["record.json", "record-failed.json"]) {
    const arg = JSON.parse(readFileSync(join(work, f), "utf8"));
    assert.deepEqual(Object.keys(arg).sort(), [...RECORD_KEYS].sort(), f);
  }
  const ok = JSON.parse(readFileSync(join(work, "record.json"), "utf8"));
  assert.equal(ok.status, "succeeded");
  assert.equal(ok.failureReason, null);
  assert.equal(ok.evidenceObjectCount, 0);
  assert.equal(ok.manifestSha256, sha256(readFileSync(join(set, "backup-manifest.json"))));
});
