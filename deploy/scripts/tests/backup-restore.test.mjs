// T-E1…T-E13 (p7-work-split §E.4; ADR-0066 §1-§8; T-DG7-DO-F): deploy/scripts/backup.sh and restore.sh against a
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
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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
// F-DG7-1012: every script runs under umask 022 (the default of root in the postgres:18 backup container and of a
// usual operator shell), so the owner-only modes the tests assert come from backup.sh itself, not from the caller.
function run(file, args, env = {}) {
  const r = spawnSync("bash", ["-c", 'umask 022; exec bash "$0" "$@"', file, ...args], {
    cwd: REPO,
    env: { PATH: process.env.PATH, HOME: process.env.HOME ?? tmpdir(), TMPDIR: work, LANG: "C.UTF-8", ...env },
    encoding: "utf8",
    timeout: 600_000,
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}`, stderr: r.stderr };
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
function restore(from, target, evidence, out = join(work, "reports", target), extra = []) {
  return run(RESTORE, [
    "--from",
    from,
    "--target-database-url",
    dbUrl(target),
    "--target-evidence-path",
    evidence,
    "--out",
    out,
    ...extra,
  ]);
}
/** The config/ listing of a set as the manifest must hold it: every file with its SHA-256, sorted by path. */
function configListing(setDir) {
  return listFiles(join(setDir, "config")).map((f) => ({
    path: `config/${f}`,
    sha256: sha256(readFileSync(join(setDir, "config", f))),
  }));
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

/** Every entry of a tree whose mode is not owner-only (directories 0700, files 0600), as "<mode> <path>". */
function notOwnerOnly(dir) {
  const bad = [];
  const top = statSync(dir);
  if ((top.mode & 0o777) !== 0o700) bad.push(`${(top.mode & 0o777).toString(8)} .`);
  for (const d of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    const p = join(d.parentPath, d.name);
    const mode = statSync(p).mode & 0o777;
    const want = d.isDirectory() ? 0o700 : 0o600;
    if (mode !== want) bad.push(`${mode.toString(8)} ${p.slice(dir.length + 1)}`);
  }
  return bad;
}

test("T-E10 (F-DG7-1012): a set taken under umask 022 is owner-only: directories 0700, files 0600", () => {
  blocked();
  assert.equal(backupOut.status, 0, backupOut.out);
  assert.deepEqual(notOwnerOnly(set), []);
  assert.ok(
    manifest.checks.some((c) => c.id === "ownerOnly" && c.result === "PASS"),
    JSON.stringify(manifest.checks),
  );
  // the database dump holds user, audit and session rows, so its mode is asserted by name as well
  assert.equal(statSync(join(set, "db/database.dump")).mode & 0o777, 0o600);
  assert.equal(statSync(join(work, "record.json")).mode & 0o777, 0o600, "--record-out is owner-only too");
});

test("T-E11 (F-DG7-1012): the Compose sequence (database, a copy-out under umask 022, finish) ends owner-only", () => {
  blocked();
  const label = "test-do-d11-phases";
  const env = { MTH_TRANSFER_ATTACHMENTS: "none" };
  const db = backup(label, ["--phase", "database"], env);
  assert.equal(db.status, 0, db.out);
  // F-DG7-1061/1071/1081: no phase writes anything to stderr (it was "cat: …/config.sha: No such file or directory")
  assert.equal(db.stderr, "", "stderr of --phase database");
  const phased = join(work, "backups", label);
  assert.deepEqual(notOwnerOnly(phased), [], "after --phase database");
  // step 2 of docs/handover/backup-restore.md §3.2: the copy-out runs in another process with its own umask (022)
  const id = readFileSync(join(phased, ".backup-state/id"), "utf8").trim();
  const urlFile = join(work, "database_url.secret");
  writeFileSync(urlFile, `${dbUrl(source)}\n`, { mode: 0o600 });
  const copy = spawnSync(
    "bash",
    [
      "-c",
      'umask 022; exec node --conditions=@mth/source apps/api/src/cli/transfer-attachments.ts "$@"',
      "transfer-attachments", // $0 of the bash -c script
      "copy-out",
      "--to",
      join(phased, "evidence"),
      "--out",
      join(phased, "evidence/attachments.json"),
      "--export-id",
      id,
    ],
    {
      cwd: REPO,
      env: {
        ...process.env,
        NODE_ENV: "development",
        // T-DG7-DO-D13: as in §3.2 step 2, the URL comes from a secret file (DATABASE_URL_FILE), not the environment
        DATABASE_URL: "",
        DATABASE_URL_FILE: urlFile,
        EVIDENCE_STORAGE_DRIVER: "filesystem",
        EVIDENCE_STORAGE_PATH: sourceEvidence,
      },
      encoding: "utf8",
    },
  );
  assert.equal(copy.status, 0, `${copy.stdout}${copy.stderr}`);
  // the copy-out's own files are not owner-only before finish (this is what --phase finish must repair)
  chmodSync(join(phased, "evidence/attachments.json"), 0o644);
  assert.notDeepEqual(notOwnerOnly(phased), []);
  const fin = backup(label, ["--phase", "finish"], env);
  assert.equal(fin.status, 0, fin.out);
  assert.match(fin.out, new RegExp(`^backup: set ${label} succeeded: `, "m"));
  assert.equal(fin.stderr, "", "stderr of --phase finish");
  assert.deepEqual(notOwnerOnly(phased), [], "after --phase finish");
  const m = JSON.parse(readFileSync(join(phased, "backup-manifest.json"), "utf8"));
  assert.ok(
    m.checks.some((c) => c.id === "ownerOnly" && c.result === "PASS"),
    JSON.stringify(m.checks),
  );
  // F-DG7-1061/1071/1081 (ADR-0066 §2): config.files lists every file of config/ with its SHA-256, as --phase all does,
  // and config.sha256 is the digest of that listing ("<sha256>  <path>" lines, sha256sum's format).
  const listing = configListing(phased);
  assert.ok(listing.length > 0, "config/ of the phased set holds files");
  assert.ok(m.config.files.length > 0, `config.files is empty: ${JSON.stringify(m.config)}`);
  assert.deepEqual(m.config.files, listing);
  assert.equal(m.config.sha256, sha256(listing.map((f) => `${f.sha256}  ${f.path}\n`).join("")));
  assert.ok(!existsSync(join(phased, ".backup-state")), ".backup-state is removed after finish");
});

test("T-E11b (F-DG7-1081): --phase finish refuses a set whose config/ listing is missing or whose config/ changed", () => {
  blocked();
  const env = { MTH_TRANSFER_ATTACHMENTS: "none" };
  for (const [label, damage, reason] of [
    [
      "test-do-d14-nolisting",
      (dir) => rmSync(join(dir, ".backup-state/config.sha")),
      /config\/ listing of the database phase is missing/,
    ],
    [
      "test-do-d14-changed",
      (dir) => writeFileSync(join(dir, "config/images.lock.json"), "{}\n", { mode: 0o600 }),
      /config\/ changed after the database phase/,
    ],
  ]) {
    const db = backup(label, ["--phase", "database"], env);
    assert.equal(db.status, 0, db.out);
    const dir = join(work, "backups", label);
    writeFileSync(join(dir, "evidence/attachments.json"), '{"items":[]}\n', { mode: 0o600 });
    damage(dir);
    const fin = backup(label, ["--phase", "finish"], env);
    assert.equal(fin.status, 1, fin.out);
    assert.match(fin.out, reason);
    assert.ok(!existsSync(join(dir, "backup-manifest.json")), "no manifest for a refused set");
  }
});

for (const [label, mode] of [
  ["world-writable like /tmp (1777)", 0o1777],
  ["group-writable (0770)", 0o770],
])
  test(`T-E12 (F-DG7-1012): a backup root that is ${label} is refused (exit 2); nothing is written`, () => {
    blocked();
    const root = join(work, `shared-root-${mode.toString(8)}`);
    mkdirSync(root);
    chmodSync(root, mode);
    const r = run(BACKUP, ["--out", root, "--label", "test-do-d11-shared", "--phase", "database"], {
      DATABASE_URL: dbUrl(source),
      EVIDENCE_STORAGE_DRIVER: "filesystem",
      EVIDENCE_STORAGE_PATH: sourceEvidence,
      MTH_TRANSFER_ATTACHMENTS: "none",
    });
    assert.equal(r.status, 2, r.out);
    assert.match(r.out, /^BLOCKED: the backup root .* is writable by group or others; use an owner-only directory/m);
    assert.deepEqual(readdirSync(root), []);
  });

// T-E13 (F-DG7-1053): a backup root given as a symbolic link is judged by its resolved target, not by the link's own
// mode (always lrwxrwxrwx on Linux). An owner-only target is accepted and the set is written inside it; a target that
// group or others can write is refused with a message naming the link and its target; a dangling link is refused.
function symlinkRoot(name, target) {
  const link = join(work, name);
  symlinkSync(target, link);
  return link;
}
const ROOT_ENV = () => ({
  DATABASE_URL: dbUrl(source),
  EVIDENCE_STORAGE_DRIVER: "filesystem",
  EVIDENCE_STORAGE_PATH: sourceEvidence,
  MTH_TRANSFER_ATTACHMENTS: "none",
});

test("T-E13a (F-DG7-1053): a symbolic link (and a chain of two) to an owner-only directory is accepted", () => {
  blocked();
  const real = join(work, "real-root-700");
  mkdirSync(real, { mode: 0o700 });
  chmodSync(real, 0o700);
  const link = symlinkRoot("link-root-700", real);
  const r = run(BACKUP, ["--out", link, "--label", "test-do-d12-link", "--phase", "database"], ROOT_ENV());
  assert.equal(r.status, 0, r.out);
  assert.doesNotMatch(r.out, /BLOCKED/);
  // the set lives in the target, owner-only, and the link itself is left as it was
  assert.ok(lstatSync(link).isSymbolicLink());
  assert.deepEqual(readdirSync(real), ["test-do-d12-link"]);
  assert.deepEqual(notOwnerOnly(join(real, "test-do-d12-link")), []);
  const chain = symlinkRoot("link-to-link-root-700", link);
  const r2 = run(BACKUP, ["--out", chain, "--label", "test-do-d12-chain", "--phase", "database"], ROOT_ENV());
  assert.equal(r2.status, 0, r2.out);
  assert.deepEqual(readdirSync(real).sort(), ["test-do-d12-chain", "test-do-d12-link"]);
});

for (const [label, mode] of [
  ["world-writable like /tmp (1777)", 0o1777],
  ["group-writable (0770)", 0o770],
])
  test(`T-E13b (F-DG7-1053): a symbolic link to a ${label} directory is refused, naming the target`, () => {
    blocked();
    const real = join(work, `real-shared-${mode.toString(8)}`);
    mkdirSync(real);
    chmodSync(real, mode);
    const link = symlinkRoot(`link-shared-${mode.toString(8)}`, real);
    const r = run(BACKUP, ["--out", link, "--label", "test-do-d12-shared", "--phase", "database"], ROOT_ENV());
    assert.equal(r.status, 2, r.out);
    assert.ok(
      r.out.includes(
        `BLOCKED: the backup root ${link} is a symbolic link to ${real}, which is writable by group or others; ` +
          "use an owner-only directory (chmod 0700)",
      ),
      r.out,
    );
    assert.deepEqual(readdirSync(real), []);
  });

test("T-E13c (F-DG7-1053): a dangling symbolic link is refused (exit 2) and nothing is created", () => {
  blocked();
  const missing = join(work, "no-such-root");
  const link = symlinkRoot("link-dangling", missing);
  const r = run(BACKUP, ["--out", link, "--label", "test-do-d12-dangling", "--phase", "database"], ROOT_ENV());
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /^BLOCKED: the backup root .* is a symbolic link whose target does not exist/m);
  assert.equal(existsSync(missing), false);
});

test("T-E13d (F-DG7-1053): a symbolic link to a regular file is refused as not a directory", () => {
  blocked();
  const file = join(work, "root-is-a-file");
  writeFileSync(file, "x", { mode: 0o600 });
  const link = symlinkRoot("link-to-file", file);
  const r = run(BACKUP, ["--out", link, "--label", "test-do-d12-file", "--phase", "database"], ROOT_ENV());
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /^BLOCKED: the backup root .* is a symbolic link to .*, which is not a directory/m);
});

/** Every path under dir (dir included) with its numeric owner and permission bits. */
function owners(dir) {
  return [dir, ...readdirSync(dir, { recursive: true }).map((p) => join(dir, p))].map((p) => {
    const st = lstatSync(p);
    return { path: p, owner: `${st.uid}:${st.gid}`, mode: st.mode & 0o777, dir: st.isDirectory() };
  });
}

test("T-E14 (F-DG7-1072/1082): restored evidence belongs to the evidence root's owner, directories 0700, files 0600", () => {
  blocked();
  const target = createDatabase("mth_dod14_t14");
  const ev = join(work, "t14-evidence");
  mkdirSync(ev, { mode: 0o755 }); // an existing, empty root, as the Compose volume (its owner is the API's account)
  const me = `${process.getuid()}:${process.getgid()}`;
  const out = join(work, "t14-report");
  const r = restore(set, target, ev, out);
  assert.equal(r.status, 0, r.out);
  const paths = owners(ev);
  const files = paths.filter((p) => !p.dir);
  assert.ok(files.length >= 2, `restored evidence files: ${files.length}`); // the object and the retention set
  for (const p of paths) {
    assert.equal(p.owner, me, p.path);
    assert.equal(p.mode, p.dir ? 0o700 : 0o600, `${p.path} mode ${p.mode.toString(8)}`);
  }
  const r7 = JSON.parse(readFileSync(join(out, "restore-report.json"), "utf8")).checks.find((c) => c.id === "R7");
  assert.equal(r7.result, "PASS");
  assert.deepEqual(r7.actual, r7.expected);
  assert.equal(r7.actual.owner, me);
  assert.equal(r7.actual.otherOwner, 0);
  assert.equal(r7.actual.groupOrOtherBits, 0);
  assert.equal(r7.actual.verified, manifest.evidence.attachmentManifest.entries);
});

test("T-E14b (F-DG7-1082): --evidence-owner must be <uid>:<gid> (exit 2, nothing written)", () => {
  blocked();
  const target = createDatabase("mth_dod14_t14b");
  const ev = join(work, "t14b-evidence");
  const r = restore(set, target, ev, join(work, "t14b-report"), ["--evidence-owner", "app"]);
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /^BLOCKED: --evidence-owner must be <uid>:<gid>/m);
  assert.equal(tableCount(target), 0);
  assert.equal(existsSync(ev), false);
});

test("T-E14c (F-DG7-1082): as root, the restore hands the evidence to the root's owner (uid 10001 as in Compose)", (t) => {
  blocked();
  const ev = join(work, "t14c-evidence");
  mkdirSync(ev, { mode: 0o700 });
  // The Compose evidence volume belongs to the image's app user (uid 10001). Changing an owner needs root with
  // CAP_CHOWN and a mapped uid 10001; a user namespace without that mapping cannot express the case.
  const probe = spawnSync("chown", ["10001:10001", ev], { encoding: "utf8" });
  if (process.getuid() !== 0 || probe.status !== 0) {
    t.skip(`not runnable here: chown to 10001:10001 failed (${(probe.stderr || "not root").trim()})`);
    return;
  }
  const target = createDatabase("mth_dod14_t14c");
  const out = join(work, "t14c-report");
  const r = restore(set, target, ev, out);
  assert.equal(r.status, 0, r.out);
  for (const p of owners(ev)) {
    assert.equal(p.owner, "10001:10001", p.path);
    assert.equal(p.mode, p.dir ? 0o700 : 0o600, p.path);
  }
  // uid 10001 without any capability reads every restored file (what the API needs).
  for (const p of owners(ev).filter((x) => !x.dir)) {
    const c = spawnSync("cat", [p.path], { uid: 10001, gid: 10001 });
    assert.equal(c.status, 0, `uid 10001 cannot read ${p.path}`);
  }
});
