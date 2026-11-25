// qa-verifier DG7 round 4 (T-DG7-REV-QA-RG4): independent regression tests for the DO-D14 repairs of F-DG7-1081
// (split-phase config listing) and F-DG7-1082 (owner and modes of restored evidence), written from the acceptance text
// and docs/handover/backup-restore.md §3.2/§5/§7, not from the repair's own tests.
//
// Written during the review of a frozen candidate, so it lives under docs/delivery/test-evidence/DG7/qa/tests/ and does
// not alter the candidate (agent-protocol.md). To run it, copy it into deploy/scripts/tests/ of a DISPOSABLE clone:
//   tests/qa/support/with-pg.sh node --test deploy/scripts/tests/qa-dg7-rg4-backup-split-phase-and-owner.test.mjs
// Without TEST_DATABASE_ADMIN_URL every test FAILS with "BLOCKED: …". SYNTHETIC demo data only; nothing here approves
// anything (no G1-G6, Finance or IT approval; no DG gate).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
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
const work = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "qa-rg4-split-"));
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const dbs = [];
let src;
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
function createDb(prefix) {
  const name = `${prefix}_${process.pid}_${dbs.length}`;
  psql(ADMIN, `CREATE DATABASE ${name} OWNER mth_owner ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`);
  dbs.push(name);
  return name;
}
const tableCount = (db) => Number(psql(dbUrl(db, null), "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'"));
function cli(args, env) {
  const r = spawnSync("node", ["--conditions=@mth/source", "src/cli.ts", ...args], {
    cwd: join(REPO, "packages/db"),
    env: { ...process.env, NODE_ENV: "development", ...env },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, `mth-db ${args.join(" ")}: ${r.stdout}${r.stderr}`);
}
// Each phase is a separate process with its OWN TMPDIR (as separate Compose containers), stdout and stderr apart.
function sh(file, args, env = {}) {
  const tmp = mkdtempSync(join(work, "proc-"));
  const r = spawnSync("bash", ["-c", 'umask 022; exec bash "$0" "$@"', file, ...args], {
    cwd: REPO,
    env: { PATH: process.env.PATH, HOME: process.env.HOME ?? tmpdir(), TMPDIR: tmp, LANG: "C.UTF-8", ...env },
    encoding: "utf8",
    timeout: 600_000,
  });
  rmSync(tmp, { recursive: true, force: true });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, out: `${r.stdout}${r.stderr}` };
}
const BENV = () => ({
  DATABASE_URL: dbUrl(src),
  EVIDENCE_STORAGE_DRIVER: "filesystem",
  EVIDENCE_STORAGE_PATH: evidence,
  MTH_TRANSFER_ATTACHMENTS: "none",
});
const backup = (label, extra) =>
  sh(BACKUP, ["--out", join(work, "backups"), "--label", label, "--operator", "qa rg4 synthetic", ...extra], BENV());
function copyOut(set) {
  const id = readFileSync(join(set, ".backup-state/id"), "utf8").trim();
  const urlFile = join(work, "database_url.secret");
  writeFileSync(urlFile, `${dbUrl(src)}\n`, { mode: 0o600 });
  const r = spawnSync(
    "node",
    ["--conditions=@mth/source", "apps/api/src/cli/transfer-attachments.ts", "copy-out", "--to", join(set, "evidence"), "--out", join(set, "evidence/attachments.json"), "--export-id", id],
    {
      cwd: REPO,
      env: { ...process.env, NODE_ENV: "development", DATABASE_URL: "", DATABASE_URL_FILE: urlFile, EVIDENCE_STORAGE_DRIVER: "filesystem", EVIDENCE_STORAGE_PATH: evidence },
      encoding: "utf8",
    },
  );
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
}
function assertConfigSection(set, m, where) {
  const files = readdirSync(join(set, "config")).sort();
  assert.ok(files.length >= 2, `${where}: config/ holds ${JSON.stringify(files)}`);
  assert.deepEqual(m.config.files.map((f) => f.path), files.map((f) => `config/${f}`), `${where}: ${JSON.stringify(m.config)}`);
  for (const f of m.config.files) assert.equal(f.sha256, sha256(readFileSync(join(set, f.path))), `${where}: ${f.path}`);
  assert.equal(m.config.sha256, sha256(m.config.files.map((f) => `${f.sha256}  ${f.path}\n`).join("")), `${where}: config.sha256`);
}
function tree(dir) {
  return [dir, ...readdirSync(dir, { recursive: true }).map((p) => join(dir, p))].map((p) => {
    const st = lstatSync(p);
    return { path: p, owner: `${st.uid}:${st.gid}`, mode: st.mode & 0o777, dir: st.isDirectory() };
  });
}

before(() => {
  if (!ADMIN) return;
  for (const r of ["mth_owner", "mth_app"])
    if (psql(ADMIN, `SELECT count(*) FROM pg_roles WHERE rolname = '${r}'`) === "0") psql(ADMIN, `CREATE ROLE ${r} NOLOGIN`);
  src = createDb("qa_rg4_src");
  cli(["migrate"], { DATABASE_OWNER_URL: dbUrl(src) });
  cli(["seed-demo"], { DATABASE_OWNER_URL: dbUrl(src), AUTH_MODE: "dev", MTH_ENV: "demo" });
  evidence = join(work, "evidence");
  mkdirSync(evidence, { mode: 0o700 });
  mkdirSync(join(work, "backups"), { mode: 0o700 });
});
after(() => {
  if (ADMIN) for (const d of dbs) psql(ADMIN, `DROP DATABASE IF EXISTS ${d} WITH (FORCE)`);
  rmSync(work, { recursive: true, force: true });
});

let splitSet;
test("QA-RG4-a (F-DG7-1081): database / copy-out / finish in three processes with separate TMPDIRs: config.files lists config/ exactly, no stderr", () => {
  blocked();
  const label = "qa-rg4-split";
  const d = backup(label, ["--phase", "database"]);
  assert.equal(d.status, 0, d.out);
  assert.equal(d.stderr, "", `--phase database stderr: ${d.stderr}`);
  splitSet = join(work, "backups", label);
  copyOut(splitSet);
  const f = backup(label, ["--phase", "finish"]);
  assert.equal(f.status, 0, f.out);
  assert.equal(f.stderr, "", `--phase finish stderr: ${f.stderr}`);
  const m = JSON.parse(readFileSync(join(splitSet, "backup-manifest.json"), "utf8"));
  console.log(`split: manifest.config = ${JSON.stringify(m.config)}`);
  assertConfigSection(splitSet, m, "split");
  assert.equal(existsSync(join(splitSet, ".backup-state")), false, ".backup-state must be removed after success");
  assert.ok(!m.files.some((x) => String(x.path ?? x).includes(".backup-state")), "files[] must not list .backup-state");
});

test("QA-RG4-b (F-DG7-1081): a config/ file ADDED between the phases is refused (exit 1, no manifest)", () => {
  blocked();
  const label = "qa-rg4-added";
  assert.equal(backup(label, ["--phase", "database"]).status, 0);
  const set = join(work, "backups", label);
  copyOut(set);
  writeFileSync(join(set, "config", "zz-extra.txt"), "synthetic\n", { mode: 0o600 });
  const f = backup(label, ["--phase", "finish"]);
  console.log(`added: exit ${f.status}: ${f.out.trim()}`);
  assert.equal(f.status, 1, f.out);
  assert.match(f.out, /config\/ changed after the database phase/);
  assert.equal(existsSync(join(set, "backup-manifest.json")), false);
});

test("QA-RG4-c (F-DG7-1081): a tampered .backup-state listing (digest mismatch) is refused (exit 1, no manifest)", () => {
  blocked();
  const label = "qa-rg4-tampered";
  assert.equal(backup(label, ["--phase", "database"]).status, 0);
  const set = join(work, "backups", label);
  copyOut(set);
  appendFileSync(join(set, ".backup-state", "config.sha"), `${"0".repeat(64)}  config/forged\n`);
  const f = backup(label, ["--phase", "finish"]);
  console.log(`tampered: exit ${f.status}: ${f.out.trim()}`);
  assert.equal(f.status, 1, f.out);
  assert.match(f.out, /does not match its recorded SHA-256/);
  assert.equal(existsSync(join(set, "backup-manifest.json")), false);
});

test("QA-RG4-d (F-DG7-1082): restore of the split set into an existing 0755 root: every path owner-only 0700/0600, R7 PASS with owner fields", () => {
  blocked();
  const target = createDb("qa_rg4_dst");
  const ev = join(work, "dst-evidence");
  mkdirSync(ev);
  chmodSync(ev, 0o755);
  const out = join(work, "rep-d");
  const r = sh(RESTORE, ["--from", splitSet, "--target-database-url", dbUrl(target), "--target-evidence-path", ev, "--out", out]);
  assert.equal(r.status, 0, r.out);
  const me = `${process.getuid()}:${process.getgid()}`;
  for (const p of tree(ev)) {
    assert.equal(p.owner, me, p.path);
    assert.equal(p.mode, p.dir ? 0o700 : 0o600, `${p.path} ${p.mode.toString(8)}`);
  }
  const r7 = JSON.parse(readFileSync(join(out, "restore-report.json"), "utf8")).checks.find((c) => c.id === "R7");
  console.log(`R7 ${JSON.stringify(r7)}`);
  assert.equal(r7.result, "PASS");
  assert.deepEqual(r7.actual, r7.expected);
  assert.equal(r7.actual.otherOwner, 0);
  assert.equal(r7.actual.groupOrOtherBits, 0);
});

test("QA-RG4-e (F-DG7-1082): an owner that cannot be set fails as R7 (exit 1) and says so; observed: the database is already restored", (t) => {
  blocked();
  const probe = join(work, "chown-probe");
  writeFileSync(probe, "x");
  const can = spawnSync("chown", ["10001:10001", probe], { encoding: "utf8" }).status === 0;
  if (can) {
    t.skip("this host CAN chown to 10001 (the negative case needs an owner that cannot be set)");
    return;
  }
  const target = createDb("qa_rg4_neg");
  const ev = join(work, "neg-evidence");
  const r = sh(RESTORE, ["--from", splitSet, "--target-database-url", dbUrl(target), "--target-evidence-path", ev, "--out", join(work, "rep-e"), "--evidence-owner", "10001:10001"]);
  console.log(`unsettable owner: exit ${r.status}: ${r.out.trim().split("\n").slice(-2).join(" | ")}; target public tables ${tableCount(target)}`);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /restore: check R7 failed: expected the evidence owned by 10001:10001/);
});

test("QA-RG4-f (F-DG7-1082): --evidence-owner forms that are not <uid>:<gid> numbers are BLOCKED before anything is written", () => {
  blocked();
  for (const bad of ["10001", "app:app", "10001:", ":10001", "-1:0", "1 0"]) {
    const target = createDb("qa_rg4_bad");
    const ev = join(work, `bad-ev-${dbs.length}`);
    const r = sh(RESTORE, ["--from", splitSet, "--target-database-url", dbUrl(target), "--target-evidence-path", ev, "--out", join(work, "rep-f"), "--evidence-owner", bad]);
    assert.equal(r.status, 2, `${bad}: ${r.out}`);
    assert.match(r.out, /^BLOCKED: --evidence-owner must be <uid>:<gid>/m, bad);
    assert.equal(tableCount(target), 0, bad);
    assert.equal(existsSync(ev), false, bad);
  }
});
