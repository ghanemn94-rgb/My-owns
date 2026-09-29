// qa-verifier, DG0 round 18: independent negative/regression tests against the frozen candidate 21efe44b (450c756).
// Author: qa-verifier (T-DG0-REV-QA-R18). Node built-ins only (plus python3 for the sandbox helper under test). Every case
// builds disposable fixtures under $TMPDIR and never touches the candidate tree it reads from.
// Run: QA_REPO_ROOT=<clone of the candidate> node --test <this file>
//
// Not already covered by tools/gates/tests or tools/agents/tests (round-18 scope: D-029 stub rule, D-032 copy-back):
//   QA18-C1  candidate stub rule (F-DG0-236) boundaries: empty untracked files with NO write bit in any mode (0555, 0400,
//            0000, 0444 in a new nested dir) are skipped; empty untracked files with ANY write bit (0200, 0020, 0002,
//            0664) and an empty-target symlink are counted
//   QA18-C2  a skipped stub is still visible to `git status` (detectable), never enters the committed (--ref) candidate,
//            and the same empty 0444 file counts once it is tracked
//   QA18-S1  finish() (F-DG0-150): a dangling symlink planted at the run's own new record path is a write-once discard;
//            the symlink is untouched and its target is never created (no follow, no clobber); sandbox.json is written
//   QA18-S2  finish(): one colliding and one non-colliding own-role file: the collision is discarded, the other is
//            copied back, the loop continues and the status is non-zero (fail-closed -> run-agent exit 73)
//   QA18-S3  finish(): a DIRECTORY already at the own-role destination is a discard, not a crash
//   QA18-S4  finish(): the round directory exists as a regular FILE in the real tree: fail-closed (non-zero), real file
//            untouched (characterises the makedirs path outside the FileExistsError handler)
//   QA18-S5  finish(): an own-role file that is unchanged since the seed is not re-copied, and look-alike out-of-scope
//            staging files (another role's record, qa-verifier-x.json, a nested round-N/sub/qa-verifier.json) are
//            discarded and never reach the real tree
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

Object.assign(process.env, { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "qa18", GIT_COMMITTER_NAME: "qa18",
  GIT_AUTHOR_EMAIL: "qa18@example.invalid", GIT_COMMITTER_EMAIL: "qa18@example.invalid" });

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.QA_REPO_ROOT
  ? resolve(process.env.QA_REPO_ROOT)
  : execFileSync("git", ["-C", here, "rev-parse", "--show-toplevel"]).toString().trim();
const scratch = (p) => mkdtempSync(join(tmpdir(), p));
const git = (cwd, ...a) => execFileSync("git", ["-C", cwd, ...a], { stdio: ["ignore", "pipe", "pipe"] }).toString();
const cand = await import(pathToFileURL(join(ROOT, "tools/gates/lib/candidate.mjs")).href);

// ---------------------------------------------------------------- candidate stub rule
const SPEC = { include: ["**"], exclude: ["trading_agent/**"] };
const wtId = (r) => cand.candidateId(cand.manifestFromWorkingTree(r, SPEC));
const refId = (r) => cand.candidateId(cand.manifestFromRef(r, "HEAD", SPEC));
const put = (r, p, c, mode) => {
  mkdirSync(dirname(join(r, p)), { recursive: true });
  writeFileSync(join(r, p), c);
  if (mode !== undefined) chmodSync(join(r, p), mode);
};
function candRepo() {
  const r = scratch("qa18-cand-");
  git(r, "init", "-q", "-b", "main");
  put(r, "src/a.txt", "a\n");
  put(r, "README.md", "r\n");
  git(r, "add", "-A");
  git(r, "commit", "-qm", "base");
  return r;
}

test("QA18-C1 stub rule boundaries: no-write-bit empty untracked files are skipped, any write bit or a symlink counts", () => {
  const r = candRepo();
  const head = refId(r);
  assert.equal(wtId(r), head);
  for (const [p, mode] of [["stub-555", 0o555], ["stub-400", 0o400], ["stub-000", 0o000], ["new/dir/deep/.gitmodules", 0o444]]) {
    put(r, p, "", mode);
    assert.equal(wtId(r), head, `empty untracked ${p} (mode ${mode.toString(8)}) should be skipped as a sandbox stub`);
  }
  for (const [p, mode] of [["w-200", 0o200], ["w-020", 0o020], ["w-002", 0o002], ["w-664", 0o664]]) {
    put(r, p, "", mode);
    const id = wtId(r);
    assert.notEqual(id, head, `empty untracked ${p} (mode ${mode.toString(8)}) has a write bit and must count`);
    rmSync(join(r, p));
    assert.equal(wtId(r), head);
  }
  put(r, "empty-target", "", 0o444); // itself a skipped stub
  symlinkSync("empty-target", join(r, "link-to-empty"));
  assert.notEqual(wtId(r), head, "an untracked symlink (even to an empty read-only file) must count");
});

test("QA18-C2 a skipped stub stays detectable by git status, never enters the committed candidate, and counts once tracked", () => {
  const r = candRepo();
  const head = refId(r);
  put(r, "tools/gates/new-empty.mjs", "", 0o444);
  assert.equal(wtId(r), head, "skipped in the working-tree id");
  assert.match(git(r, "status", "--porcelain", "--untracked-files=all"), /\?\? tools\/gates\/new-empty\.mjs/, "git status still reports it");
  assert.equal(refId(r), head, "the committed candidate is unaffected");
  git(r, "add", "tools/gates/new-empty.mjs");
  git(r, "commit", "-qm", "track the empty file");
  const tracked = refId(r);
  assert.notEqual(tracked, head, "a committed empty file is part of the candidate");
  assert.equal(wtId(r), tracked, "once tracked, the same empty 0444 file counts in the working tree too");
});

// ---------------------------------------------------------------- process-sandbox copy-back (finish)
function sbFixture() {
  const base = scratch("qa18-sbx-");
  const repo = join(base, "repo");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  cpSync(join(ROOT, "tools", "agents"), join(repo, "tools", "agents"), { recursive: true, filter: (s) => !s.includes("__pycache__") });
  const files = {
    "CLAUDE.md": "rules\n", ".claude/agents/x.md": "agent\n", "docs/source/s.md": "source\n", "docs/delivery/requirements.csv": "req_id\n",
    "docs/delivery/reviews/DG0/round-1/qa-verifier.json": "{\"verdict\":\"R1\"}\n", "docs/delivery/gates/DG1.json": "{}\n",
  };
  for (const [rel, c] of Object.entries(files)) put(repo, rel, c);
  for (const d of ["docs/delivery/runs/DG0", "docs/delivery/handbacks", "tests/qa", "e2e",
    ...["domain", "code-security", "qa", "audit"].map((k) => `docs/delivery/test-evidence/DG0/${k}`)]) mkdirSync(join(repo, d), { recursive: true });
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "fixture");
  const home = join(base, "home");
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(join(home, ".claude", "settings.json"), "{}\n");
  const runTmp = mkdtempSync(join(base, "mth-run."));
  const state = mkdtempSync(join(base, "mth-state."));
  const env = { ...process.env, HOME: home };
  const pyArgs = ["-I", "-B", join(repo, "tools/agents/agent_sandbox.py")];
  execFileSync("python3", [...pyArgs, "prepare", "qa-verifier", repo, repo, "DG0", runTmp, state, process.execPath], { env, cwd: "/" });
  const plan = JSON.parse(readFileSync(join(state, "plan.json"), "utf8"));
  const staging = plan.staged.find((s) => s.rel === "docs/delivery/reviews/DG0").staging;
  const finish = () => {
    const out = mkdtempSync(join(base, "out-"));
    const res = spawnSync("python3", [...pyArgs, "finish", state, out], { env, cwd: "/", encoding: "utf8" });
    const sj = join(out, "sandbox.json");
    return { status: res.status, stderr: res.stderr, summary: existsSync(sj) ? JSON.parse(readFileSync(sj, "utf8")) : null };
  };
  const realRev = (rel) => join(repo, "docs/delivery/reviews/DG0", rel);
  return { base, repo, staging, finish, realRev };
}

test("QA18-S1 finish(): a dangling symlink planted at the own-role destination is a discard; never followed, never clobbered", () => {
  const fx = sbFixture();
  put(fx.staging, "round-18/qa-verifier.json", "{\"verdict\":\"PASS\"}\n");
  const target = join(fx.base, "outside", "planted-target.json"); // does not exist
  mkdirSync(fx.realRev("round-18"), { recursive: true });
  symlinkSync(target, fx.realRev("round-18/qa-verifier.json"));
  const { status, summary, stderr } = fx.finish();
  assert.ok(summary, `sandbox.json must be written (stderr: ${stderr})`);
  assert.notEqual(status, 0, "a discard must be fail-closed");
  assert.deepEqual(summary.copied_back, []);
  assert.match(summary.discarded.join("\n"), /round-18\/qa-verifier\.json: already present in the real tree; write-once/);
  assert.ok(lstatSync(fx.realRev("round-18/qa-verifier.json")).isSymbolicLink(), "the planted symlink is left as is");
  assert.equal(readlinkSync(fx.realRev("round-18/qa-verifier.json")), target);
  assert.equal(existsSync(target), false, "the symlink target must never be created");
  rmSync(fx.base, { recursive: true, force: true });
});

test("QA18-S2 finish(): a collision on one own-role file does not stop the loop; the other file is copied back; non-zero", () => {
  const fx = sbFixture();
  put(fx.staging, "round-18/qa-verifier.json", "{\"verdict\":\"MINE\"}\n");
  put(fx.staging, "round-18/qa-verifier.findings.json", "{\"findings\":[]}\n");
  put(fx.realRev("."), "round-18/qa-verifier.json", "{\"verdict\":\"EARLIER\"}\n"); // committed by another same-role run
  const { status, summary, stderr } = fx.finish();
  assert.ok(summary, `sandbox.json must be written (stderr: ${stderr})`);
  assert.equal(status, 3);
  assert.deepEqual(summary.copied_back, ["docs/delivery/reviews/DG0/round-18/qa-verifier.findings.json"]);
  assert.equal(summary.discarded.length, 1);
  assert.equal(readFileSync(fx.realRev("round-18/qa-verifier.json"), "utf8"), "{\"verdict\":\"EARLIER\"}\n", "write-once: untouched");
  assert.equal(readFileSync(fx.realRev("round-18/qa-verifier.findings.json"), "utf8"), "{\"findings\":[]}\n");
  rmSync(fx.base, { recursive: true, force: true });
});

test("QA18-S3 finish(): a directory already at the own-role destination is a discard, not a crash", () => {
  const fx = sbFixture();
  put(fx.staging, "round-18/qa-verifier.md", "narrative\n");
  mkdirSync(fx.realRev("round-18/qa-verifier.md"), { recursive: true });
  const { status, summary, stderr } = fx.finish();
  assert.ok(summary, `sandbox.json must be written (stderr: ${stderr})`);
  assert.equal(status, 3);
  assert.deepEqual(summary.copied_back, []);
  assert.match(summary.discarded.join("\n"), /round-18\/qa-verifier\.md: already present in the real tree/);
  assert.ok(lstatSync(fx.realRev("round-18/qa-verifier.md")).isDirectory());
  rmSync(fx.base, { recursive: true, force: true });
});

test("QA18-S4 finish(): the round directory is a regular file in the real tree: fail-closed and the real file is untouched", () => {
  const fx = sbFixture();
  put(fx.staging, "round-18/qa-verifier.json", "{\"verdict\":\"PASS\"}\n");
  put(fx.realRev("."), "round-18", "not a directory\n");
  const { status, summary, stderr } = fx.finish();
  console.log(`  QA18-S4 status=${status} sandbox.json=${summary ? "written" : "MISSING"} stderr-tail=${JSON.stringify((stderr || "").trim().split("\n").slice(-1)[0] || "")}`);
  assert.notEqual(status, 0, "must never report success");
  assert.equal(readFileSync(fx.realRev("round-18"), "utf8"), "not a directory\n");
  if (summary) assert.deepEqual(summary.copied_back, []);
  rmSync(fx.base, { recursive: true, force: true });
});

test("QA18-S5 finish(): an out-of-scope staging file is discarded and an unchanged seed file is not re-copied", () => {
  const fx = sbFixture();
  // Note: round-N/qa-verifier.<anything> IS in scope by design (D-021 "<role>.*"); these three are not.
  const out = ["round-18/domain-reviewer.json", "round-18/qa-verifier-x.json", "round-18/sub/qa-verifier.json"];
  for (const p of out) put(fx.staging, p, "{\"verdict\":\"FORGED\"}\n");
  const { status, summary } = fx.finish();
  assert.equal(status, 3);
  assert.deepEqual(summary.copied_back, [], "round-1 seed file unchanged -> not copied; nothing out-of-scope copied");
  assert.equal(summary.discarded.filter((d) => /outside the role's scope/.test(d)).length, 3);
  for (const p of out) assert.equal(existsSync(fx.realRev(p)), false, `${p} must not reach the real tree`);
  assert.equal(readFileSync(fx.realRev("round-1/qa-verifier.json"), "utf8"), "{\"verdict\":\"R1\"}\n");
  rmSync(fx.base, { recursive: true, force: true });
});
