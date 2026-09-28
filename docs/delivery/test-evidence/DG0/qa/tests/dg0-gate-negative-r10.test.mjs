// Round 10 (T-DG0-REV-QA-R10): independent QA cases for the round-10 repairs, D-023 / F-DG0-134 (the guard comes from
// MTH_GUARD_ROOT and protects the repository and all of its worktrees) and F-DG0-224 (the validator decodes its own path).
// The round-9 suite (dg0-gate-negative-r9.test.mjs, 94 cases) is re-run unchanged as the A23/A24/A25 regression suite.
// None of the QA10-* cases below exists in tools/gates/tests/*.test.mjs or tools/agents/tests/*.test.mjs:
//  - the existing F-DG0-134 tests never tamper with a worktree's own copy of the guard, never point MTH_GUARD_ROOT at a
//    directory without a guard or at a linked worktree, and never use a worktree path with spaces or non-ASCII characters;
//  - the existing F-DG0-224 test only imports rules.mjs; it doesn't run the CLIs or compare candidate IDs across locations.
// Author: qa-verifier. Every case builds disposable fixtures in the OS temp dir and removes them.
// Run: QA_REPO_ROOT=<clone or worktree of the candidate> node --test <this file>
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.QA_REPO_ROOT
  ? resolve(process.env.QA_REPO_ROOT)
  : execFileSync("git", ["-C", here, "rev-parse", "--show-toplevel"]).toString().trim();
const SCOPES = JSON.parse(readFileSync(join(ROOT, "tools/agents/write-scopes.json"), "utf8"));
const ROLES = Object.keys(SCOPES.roles);
const hookCmd = (role) =>
  JSON.parse(readFileSync(join(ROOT, "tools/agents/settings", `${role}.settings.json`), "utf8")).hooks.PreToolUse[0].hooks[0].command;
// The pre-D-023 hook form (round-9 candidate), used only to show that the tampered-worktree case below is a real attack.
const OLD_HOOK = (role) =>
  `g="$(git rev-parse --show-toplevel 2>/dev/null)/tools/agents/guard-write.mjs"; if [ -f "$g" ]; then node "$g" ${role}; rc=$?; else echo "write guard missing" >&2; rc=2; fi; [ "$rc" -eq 0 ] || exit 2`;

const tmp = [];
function scratch(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmp.push(d);
  return d;
}
process.on("exit", () => tmp.forEach((d) => rmSync(d, { recursive: true, force: true })));

const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, "-c", "user.email=qa@example.invalid", "-c", "user.name=qa", "-c", "advice.detachedHead=false", ...args], { stdio: ["ignore", "pipe", "pipe"] }).toString();

/** A disposable repository carrying the candidate's guard tooling, committed so every worktree has its own copy. */
function guardedRepo(prefix = "qa10-repo-") {
  const r = join(scratch(prefix), "repo");
  mkdirSync(r, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main", r]);
  cpSync(join(ROOT, "tools/agents"), join(r, "tools/agents"), { recursive: true });
  mkdirSync(join(r, "docs/source"), { recursive: true });
  writeFileSync(join(r, "docs/source/playbook.md"), "# synthetic\n");
  git(r, "add", "-A");
  git(r, "commit", "-q", "-m", "fixture");
  return r;
}

/** Runs a role's hook command exactly as Claude Code would: sh -c <command>, payload on stdin. */
function hook(cmd, filePath, { cwd, env }) {
  const res = spawnSync("sh", ["-c", cmd], { cwd, env, input: JSON.stringify({ tool_name: "Write", tool_input: { file_path: filePath, content: "x" } }) });
  return { status: res.status, stderr: res.stderr.toString() };
}
const envWith = (root) => {
  const e = { ...process.env };
  delete e.MTH_GUARD_ROOT;
  if (root !== undefined) e.MTH_GUARD_ROOT = root;
  return e;
};

test("QA10-1 F-DG0-134 root cause: a worktree's tampered guard copy cannot weaken the hook when MTH_GUARD_ROOT names the repository", () => {
  const r = guardedRepo();
  const wt = join(scratch("qa10-wt-"), "wt");
  git(r, "worktree", "add", "-q", wt);
  // The agent (Bash is unguarded) replaces the worktree's own guard and scopes with allow-everything versions.
  writeFileSync(join(wt, "tools/agents/guard-write.mjs"), "process.exit(0);\n");
  const allowAll = JSON.parse(readFileSync(join(wt, "tools/agents/write-scopes.json"), "utf8"));
  for (const k of Object.keys(allowAll.roles)) allowAll.roles[k] = { allow: ["**"], deny: [] };
  writeFileSync(join(wt, "tools/agents/write-scopes.json"), JSON.stringify(allowAll));
  const targets = ["docs/source/QA-PROBE.txt", join(wt, "tools/gates/lib/rules.mjs"), join(r, "docs/source/playbook.md")];
  for (const role of ["qa-verifier", "backend-workflow-engineer", "transformation-analyst"]) {
    for (const t of targets) {
      const res = hook(hookCmd(role), t, { cwd: wt, env: envWith(r) });
      assert.equal(res.status, 2, `${role} must be blocked writing ${t} from a worktree with a tampered guard copy`);
      assert.match(res.stderr, /BLOCKED by write guard/);
    }
  }
  // Control: the pre-D-023 hook form picks the tampered copy and allows the same write. This proves the case is real.
  assert.equal(hook(OLD_HOOK("qa-verifier"), "docs/source/QA-PROBE.txt", { cwd: wt, env: envWith(r) }).status, 0);
});

test("QA10-2 fail closed: MTH_GUARD_ROOT unset, empty, nonexistent or without a guard blocks every role's writes", () => {
  const empty = scratch("qa10-noguard-");
  const r = guardedRepo();
  for (const role of ROLES) {
    const cmd = hookCmd(role);
    for (const [label, env] of [["unset", envWith(undefined)], ["empty", envWith("")], ["nonexistent", envWith(join(empty, "nope"))], ["no guard file", envWith(empty)]]) {
      const res = hook(cmd, join(r, "README.md"), { cwd: r, env });
      assert.equal(res.status, 2, `${role} hook must fail closed when MTH_GUARD_ROOT is ${label}`);
    }
    // Sanity: with a valid root, an in-scope write for the role is not blocked by the fail-closed branch.
    const inScope = SCOPES.roles[role].allow[0].replace("**", "qa10/x.md");
    assert.equal(hook(cmd, join(r, inScope), { cwd: r, env: envWith(r) }).status, 0, `${role} in-scope write ${inScope}`);
  }
});

test("QA10-3 runner started from a linked worktree: MTH_GUARD_ROOT = worktree still guards the main repository and sibling worktrees", () => {
  const r = guardedRepo();
  const base = scratch("qa10-sib-");
  git(r, "worktree", "add", "-q", join(base, "a"));
  git(r, "worktree", "add", "-q", join(base, "b"));
  const root = join(base, "a"); // what run-agent.sh computes as REPO_ROOT when invoked from worktree 'a'
  for (const t of [join(r, "docs/source/playbook.md"), join(base, "b", "tools/agents/write-scopes.json"), join(root, ".claude/agents/x.md")]) {
    assert.equal(hook(hookCmd("devops-engineer"), t, { cwd: join(base, "b"), env: envWith(root) }).status, 2, `must block ${t}`);
  }
  assert.equal(hook(hookCmd("devops-engineer"), join(r, "apps/web/x.ts"), { cwd: root, env: envWith(root) }).status, 0);
});

test("QA10-4 portability x worktrees: a worktree under a path with spaces and Arabic characters is guarded; in-scope writes still pass", () => {
  const r = guardedRepo("qa10 repo مستخدم ");
  const wt = join(scratch("qa10 wt "), "مساحة عمل", "wt one");
  mkdirSync(dirname(wt), { recursive: true });
  git(r, "worktree", "add", "-q", "--detach", wt); // detached: 'wt one' is not a valid branch name
  const env = envWith(r);
  assert.equal(hook(hookCmd("qa-verifier"), "docs/source/QA-PROBE.txt", { cwd: wt, env }).status, 2);
  assert.equal(hook(hookCmd("qa-verifier"), join(wt, "tools/gates/lib/rules.mjs"), { cwd: r, env }).status, 2);
  assert.equal(hook(hookCmd("qa-verifier"), "tests/qa/dg0/x.test.mjs", { cwd: wt, env }).status, 0);
  assert.equal(hook(hookCmd("qa-verifier"), join(wt, "docs/delivery/test-evidence/DG0/qa/x.log"), { cwd: r, env }).status, 0);
  // qa-verifier may not write product code in the worktree either.
  assert.equal(hook(hookCmd("qa-verifier"), join(wt, "apps/api/src/x.ts"), { cwd: wt, env }).status, 2);
});

test("QA10-5 worktree bypass attempts: symlink from scratch into a worktree, case variants, and the worktree's .git file are blocked", () => {
  const r = guardedRepo();
  const wt = join(scratch("qa10-wt5-"), "wt");
  git(r, "worktree", "add", "-q", wt);
  const env = envWith(r);
  const s = scratch("qa10-scratch-");
  symlinkSync(join(wt, "docs/source"), join(s, "src-link"));
  symlinkSync(join(r, "tools"), join(s, "tools-link"));
  const cases = [
    [join(s, "src-link", "playbook.md"), "symlink from scratch into worktree docs/source"],
    [join(s, "tools-link", "gates", "validate.mjs"), "symlink from scratch into main-repo tools"],
    [join(wt, "DOCS/Source/x.md"), "case variant in worktree"],
    [join(wt, "Tools/Agents/write-scopes.json"), "case variant of tools/agents in worktree"],
    [join(wt, ".git"), "worktree .git file"],
    [join(r, ".git/worktrees/wt/HEAD"), "main repo's worktree admin dir"],
  ];
  for (const [t, label] of cases) {
    assert.equal(hook(hookCmd("frontend-ux-engineer"), t, { cwd: s, env }).status, 2, `must block: ${label}`);
  }
  // Scratch outside every guarded root stays writable (by design, D-023).
  assert.equal(hook(hookCmd("frontend-ux-engineer"), join(s, "plain.txt"), { cwd: s, env }).status, 0);
});

test("QA10-6 deepest root wins: a worktree nested inside the repository is scoped from its own root", () => {
  const r = guardedRepo();
  const nested = join(r, ".wt", "n");
  git(r, "worktree", "add", "-q", nested);
  const env = envWith(r);
  // Scoped from the nested root, test evidence is in scope for qa-verifier; scoped from the main root it would be '.wt/n/...'.
  assert.equal(hook(hookCmd("qa-verifier"), join(nested, "docs/delivery/test-evidence/DG0/qa/x.log"), { cwd: r, env }).status, 0);
  assert.equal(hook(hookCmd("qa-verifier"), join(nested, "docs/delivery/stages.json"), { cwd: r, env }).status, 2);
  assert.equal(hook(hookCmd("transformation-analyst"), join(nested, "docs/analysis/a.md"), { cwd: nested, env }).status, 0);
  assert.equal(hook(hookCmd("transformation-analyst"), join(nested, "CLAUDE.md"), { cwd: nested, env }).status, 2);
});

test("QA10-7 F-DG0-224 end to end: the candidate ID is independent of checkout location, and review metadata leaves it unchanged there", () => {
  const plain = join(scratch("qa10-plain-"), "repo");
  const odd = join(scratch("qa10 مسار غريب "), "My Projects", "repo");
  mkdirSync(dirname(odd), { recursive: true });
  const head = git(ROOT, "rev-parse", "HEAD").trim();
  for (const d of [plain, odd]) {
    execFileSync("git", ["clone", "-q", ROOT, d]);
    git(d, "checkout", "-q", head);
  }
  const id = (d) => {
    const p = spawnSync(process.execPath, [join(d, "tools/gates/candidate.mjs"), "--stage", "DG0"], { cwd: d, encoding: "utf8" });
    assert.equal(p.status, 0, `candidate.mjs failed under ${d}: ${p.stderr}`);
    return JSON.parse(p.stdout).candidate_id;
  };
  const a = id(plain);
  const b = id(odd);
  assert.match(a, /^sha256:[0-9a-f]{64}$/);
  assert.equal(b, a, "candidate ID must not depend on the checkout path");
  // Review metadata (excluded by D-005) does not change the ID, even in the unusual path.
  mkdirSync(join(odd, "docs/delivery/reviews/DG0/round-99"), { recursive: true });
  writeFileSync(join(odd, "docs/delivery/reviews/DG0/round-99/qa-verifier.json"), "{}\n");
  writeFileSync(join(odd, "docs/delivery/progress.md"), "changed\n");
  assert.equal(id(odd), a);
  // A source change does.
  writeFileSync(join(odd, "docs/analysis/glossary.md"), readFileSync(join(odd, "docs/analysis/glossary.md"), "utf8") + "\nqa10\n");
  assert.notEqual(id(odd), a);
});

test("QA10-8 F-DG0-224 negative path: under a space/Arabic path every validator mode runs and fails closed with diagnostics, not a crash", () => {
  const odd = join(scratch("qa10 تحقق "), "repo dir");
  execFileSync("git", ["clone", "-q", ROOT, odd]);
  git(odd, "checkout", "-q", git(ROOT, "rev-parse", "HEAD").trim());
  const run = (...args) => spawnSync(process.execPath, [join(odd, "tools/gates/validate.mjs"), ...args], { cwd: odd, encoding: "utf8" });
  for (const args of [["--pipeline"], ["--reconcile"], ["--register", "DG0"]]) {
    const p = run(...args);
    assert.equal(p.status, 0, `${args.join(" ")}: ${p.stderr}`);
    assert.doesNotMatch(p.stdout + p.stderr, /ENOENT|%20|%D9/);
  }
  // Break the register (an unknown block anchor) and require a clean rejection rather than a crash.
  const csv = join(odd, "docs/delivery/requirements.csv");
  const text = readFileSync(csv, "utf8");
  const m = text.match(/B0\d{3}/);
  assert.ok(m, "register cites playbook blocks");
  writeFileSync(csv, text.replace(m[0], "B9999"));
  const bad = run("--register", "DG0");
  assert.notEqual(bad.status, 0, "a non-existent block anchor must fail the register check");
  assert.match(bad.stdout + bad.stderr, /B9999/);
  assert.doesNotMatch(bad.stdout + bad.stderr, /ENOENT|at .*\.mjs:\d+:\d+/);
  // The gate itself cannot pass here: DG0 has no approved gate record in the candidate.
  const gate = run("--stage", "DG0");
  assert.notEqual(gate.status, 0);
  assert.doesNotMatch(gate.stdout + gate.stderr, /ENOENT|%20/);
});
