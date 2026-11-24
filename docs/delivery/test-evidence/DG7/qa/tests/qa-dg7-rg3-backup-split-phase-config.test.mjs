// qa-verifier DG7 round 3 (T-DG7-REV-QA-RG3): independent regression test for the split-phase (Compose) backup
// sequence of docs/handover/backup-restore.md §3.2: --phase database, an evidence copy-out in another process,
// --phase finish. It checks what T-E11 does not: the manifest's `config` section (ADR-0066 §2:
// `{ "files": [{ "path", "sha256" }], "sha256" }`) and that --phase finish writes no error line.
//
// Written during the review of a frozen candidate, so it lives under docs/delivery/test-evidence/DG7/qa/tests/ and does
// not alter the candidate (agent-protocol.md). To run it, copy it into deploy/scripts/tests/ of a DISPOSABLE clone:
//   tests/qa/support/with-pg.sh node --test deploy/scripts/tests/qa-dg7-rg3-backup-split-phase-config.test.mjs
// Without TEST_DATABASE_ADMIN_URL every test FAILS with "BLOCKED: …". SYNTHETIC demo data only; nothing here approves
// anything (no G1-G6, Finance or IT approval; no DG gate).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const BACKUP = join(REPO, "deploy/scripts/backup.sh");
const ADMIN = process.env.TEST_DATABASE_ADMIN_URL ?? "";
const work = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "qa-rg3-split-"));
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
let db;
let evidence;

function blocked() {
  if (!ADMIN) throw new Error("BLOCKED: TEST_DATABASE_ADMIN_URL is not set (run under tests/qa/support/with-pg.sh)");
}
function dbUrl(name, role = "mth_owner") {
  const u = new URL(ADMIN);
  u.pathname = `/${name}`;
  if (role) u.searchParams.set("options", `-c role=${role}`);
  return u.toString().replace(/\+/g, "%20");
}
function psql(url, sql) {
  const r = spawnSync("psql", ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", url], { input: sql, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`psql: ${r.stderr}`);
  return r.stdout.trim();
}
function cli(args, env) {
  const r = spawnSync("node", ["--conditions=@mth/source", "src/cli.ts", ...args], {
    cwd: join(REPO, "packages/db"),
    env: { ...process.env, NODE_ENV: "development", ...env },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, `mth-db ${args.join(" ")}: ${r.stdout}${r.stderr}`);
}
// stdout and stderr kept apart: the finish phase must not print an error line on stderr.
function backup(label, extra, env = {}) {
  const r = spawnSync(
    "bash",
    ["-c", 'umask 022; exec bash "$0" "$@"', BACKUP, "--out", join(work, "backups"), "--label", label, "--operator", "qa rg3 synthetic", ...extra],
    {
      cwd: REPO,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME ?? tmpdir(),
        TMPDIR: work,
        LANG: "C.UTF-8",
        DATABASE_URL: dbUrl(db),
        EVIDENCE_STORAGE_DRIVER: "filesystem",
        EVIDENCE_STORAGE_PATH: evidence,
        ...env,
      },
      encoding: "utf8",
      timeout: 600_000,
    },
  );
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
// The manifest's config section must describe config/ exactly: one entry per file with its SHA-256, and `sha256` the
// digest of the `sha256sum` listing (backup.sh l.446-447) of those same entries.
function assertConfigSection(set, m, where) {
  const files = readdirSync(join(set, "config")).sort();
  assert.ok(files.length >= 2, `${where}: config/ holds ${JSON.stringify(files)}`);
  assert.deepEqual(
    m.config.files.map((f) => f.path),
    files.map((f) => `config/${f}`),
    `${where}: manifest.config.files ${JSON.stringify(m.config.files)} vs config/ ${JSON.stringify(files)}`,
  );
  for (const f of m.config.files) assert.equal(f.sha256, sha256(readFileSync(join(set, f.path))), `${where}: ${f.path}`);
  const listing = m.config.files.map((f) => `${f.sha256}  ${f.path}\n`).join("");
  assert.equal(m.config.sha256, sha256(listing), `${where}: config.sha256 is not the digest of the listed files`);
}

before(() => {
  if (!ADMIN) return;
  for (const r of ["mth_owner", "mth_app"])
    if (psql(ADMIN, `SELECT count(*) FROM pg_roles WHERE rolname = '${r}'`) === "0") psql(ADMIN, `CREATE ROLE ${r} NOLOGIN`);
  db = `qa_rg3_split_${process.pid}`;
  psql(ADMIN, `CREATE DATABASE ${db} OWNER mth_owner ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`);
  cli(["migrate"], { DATABASE_OWNER_URL: dbUrl(db) });
  cli(["seed-demo"], { DATABASE_OWNER_URL: dbUrl(db), AUTH_MODE: "dev", MTH_ENV: "demo" });
  evidence = join(work, "evidence");
  mkdirSync(evidence);
  mkdirSync(join(work, "backups"), { mode: 0o700 });
});

after(() => {
  if (ADMIN && db) psql(ADMIN, `DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
  rmSync(work, { recursive: true, force: true });
});

test("QA-RG3-a (control): --phase all writes a manifest whose config section lists config/ exactly", () => {
  blocked();
  const r = backup("qa-rg3-all", []);
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.doesNotMatch(r.stderr, /No such file or directory/, r.stderr);
  const set = join(work, "backups", "qa-rg3-all");
  assertConfigSection(set, JSON.parse(readFileSync(join(set, "backup-manifest.json"), "utf8")), "--phase all");
});

test("QA-RG3-b: the split sequence of backup-restore.md §3.2 (database, copy-out, finish) writes the same config section and no error line", () => {
  blocked();
  const label = "qa-rg3-split";
  const env = { MTH_TRANSFER_ATTACHMENTS: "none" };
  const d = backup(label, ["--phase", "database"], env);
  assert.equal(d.status, 0, `${d.stdout}${d.stderr}`);
  const set = join(work, "backups", label);
  const id = readFileSync(join(set, ".backup-state/id"), "utf8").trim();
  const urlFile = join(work, "database_url.secret");
  writeFileSync(urlFile, `${dbUrl(db)}\n`, { mode: 0o600 });
  const copy = spawnSync(
    "node",
    ["--conditions=@mth/source", "apps/api/src/cli/transfer-attachments.ts", "copy-out", "--to", join(set, "evidence"), "--out", join(set, "evidence/attachments.json"), "--export-id", id],
    {
      cwd: REPO,
      env: { ...process.env, NODE_ENV: "development", DATABASE_URL: "", DATABASE_URL_FILE: urlFile, EVIDENCE_STORAGE_DRIVER: "filesystem", EVIDENCE_STORAGE_PATH: evidence },
      encoding: "utf8",
    },
  );
  assert.equal(copy.status, 0, `${copy.stdout}${copy.stderr}`);
  const f = backup(label, ["--phase", "finish"], env);
  assert.equal(f.status, 0, `${f.stdout}${f.stderr}`);
  const m = JSON.parse(readFileSync(join(set, "backup-manifest.json"), "utf8"));
  console.log(`split sequence: manifest.config = ${JSON.stringify(m.config)}; config/ = ${JSON.stringify(readdirSync(join(set, "config")).sort())}`);
  console.log(`split sequence: --phase finish stderr = ${JSON.stringify(f.stderr)}`);
  assertConfigSection(set, m, "split sequence");
  // the rg3b Compose drill printed "cat: /tmp/mth-backup.XXXXXX/config.sha: No such file or directory" here
  assert.doesNotMatch(f.stderr, /No such file or directory/, `--phase finish stderr: ${f.stderr}`);
});
