// Round 11 (T-DG0-REV-QA-R11): independent QA cases for the round-10 repairs (D-024: guard fails closed, only the OS temp
// directory is scratch, HOME is never scratch, runner loads only project/local settings and detects configuration
// changes outside the candidate with exit 71). The round-9 suite (dg0-gate-negative-r9.test.mjs, 94 cases) and the
// round-10 suite (8 cases) are re-run unchanged as the A23/A24/A25 regression suites.
// None of the QA11-* cases below exists in tools/gates/tests/*.test.mjs, tools/agents/tests/*.test.mjs or
// tools/agents/tests/test_run_meta.py:
//  - the existing F-DG0-136 tests never use a symlink from the temp directory into HOME, never set TMPDIR to HOME,
//    never place the guarded repository inside HOME, and never probe sibling-prefix or '..' paths;
//  - the existing F-DG0-135 test uses a non-repository directory and a PATH without git; it never uses a
//    non-existent MTH_GUARD_ROOT or a repository whose git metadata is corrupt;
//  - no existing test executes run-agent.sh end to end: the D-024 exit 71 and the config snapshot are covered only
//    through run_meta.py and a hand-edited meta.json. QA11-R* run the real runner with a stub `claude` on PATH.
// Author: qa-verifier. Every case builds disposable fixtures in the OS temp dir and removes them.
// Run: QA_REPO_ROOT=<clone of the candidate> node --test <this file>
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.QA_REPO_ROOT
  ? resolve(process.env.QA_REPO_ROOT)
  : execFileSync("git", ["-C", here, "rev-parse", "--show-toplevel"]).toString().trim();
const hookCmd = (role) =>
  JSON.parse(readFileSync(join(ROOT, "tools/agents/settings", `${role}.settings.json`), "utf8")).hooks.PreToolUse[0].hooks[0].command;

const tmp = [];
function scratch(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmp.push(d);
  return d;
}
process.on("exit", () => tmp.forEach((d) => rmSync(d, { recursive: true, force: true })));

const git = (cwd, ...args) =>
  execFileSync("git", ["-C", cwd, "-c", "user.email=qa@example.invalid", "-c", "user.name=qa", ...args], { stdio: ["ignore", "pipe", "pipe"] }).toString();

/** A disposable repository carrying the candidate's guard tooling. */
function guardedRepo(parent = scratch("qa11-repo-")) {
  const r = join(parent, "repo");
  mkdirSync(r, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main", r]);
  cpSync(join(ROOT, "tools/agents"), join(r, "tools/agents"), { recursive: true });
  mkdirSync(join(r, "docs/source"), { recursive: true });
  writeFileSync(join(r, "docs/source/playbook.md"), "# synthetic\n");
  git(r, "add", "-A");
  git(r, "commit", "-q", "-m", "fixture");
  return r;
}

/** Runs a role's production hook command as Claude Code would: sh -c <command>, payload on stdin. */
function hook(role, filePath, env, cwd = tmpdir()) {
  const res = spawnSync("sh", ["-c", hookCmd(role)], { cwd, env, input: JSON.stringify({ tool_name: "Write", tool_input: { file_path: filePath, content: "x" } }) });
  return { status: res.status, stderr: res.stderr.toString() };
}
const baseEnv = (over) => {
  const e = { ...process.env };
  delete e.MTH_GUARD_ROOT;
  delete e.TMPDIR;
  return { ...e, ...over };
};

// ---------------------------------------------------------------- guard (D-024 / F-DG0-135 / F-DG0-136)

test("QA11-G1 F-DG0-136: a symlink inside the temp directory that points into HOME cannot be used to write HOME configuration", () => {
  const r = guardedRepo();
  const home = scratch("qa11-home-");
  mkdirSync(join(home, ".claude"), { recursive: true });
  const s = scratch("qa11-link-");
  symlinkSync(join(home, ".claude"), join(s, "cfg"));
  symlinkSync(join(home, ".gitconfig"), join(s, "gitconfig")); // dangling: the target doesn't exist yet
  const env = baseEnv({ HOME: home, MTH_GUARD_ROOT: r });
  for (const role of ["qa-verifier", "backend-workflow-engineer", "devops-engineer"]) {
    for (const t of [join(s, "cfg", "settings.json"), join(s, "cfg", "settings.local.json")]) {
      const res = hook(role, t, env);
      assert.equal(res.status, 2, `${role} must be blocked writing ${t} (resolves into HOME)`);
      assert.match(res.stderr, /inside the home directory/);
    }
  }
  // control: an ordinary file next to the links is scratch
  assert.equal(hook("qa-verifier", join(s, "notes.txt"), env).status, 0);
});

test("QA11-G2 F-DG0-136: TMPDIR pointing at HOME does not make HOME scratch (home rule wins over the temp rule)", () => {
  const r = guardedRepo();
  const home = scratch("qa11-home-");
  const env = baseEnv({ HOME: home, TMPDIR: home, MTH_GUARD_ROOT: r });
  for (const t of [join(home, ".claude", "settings.json"), join(home, ".bashrc"), join(home, "anything.txt")]) {
    const res = hook("domain-reviewer", t, env);
    assert.equal(res.status, 2, `must be blocked: ${t}`);
    assert.match(res.stderr, /inside the home directory/);
  }
  // /tmp itself remains scratch
  assert.equal(hook("domain-reviewer", join(scratch("qa11-s-"), "ok.txt"), env).status, 0);
});

test("QA11-G3 F-DG0-136: when the guarded repository lies inside HOME, in-repo scopes still apply (the home rule does not over-block) and HOME files stay blocked", () => {
  const home = scratch("qa11-home-");
  const r = guardedRepo(home); // <home>/repo
  const env = baseEnv({ HOME: home, MTH_GUARD_ROOT: r });
  // allowed by scope
  assert.equal(hook("qa-verifier", join(r, "docs/delivery/reviews/DG1/round-1/qa-verifier.json"), env).status, 0);
  assert.equal(hook("qa-verifier", join(r, "tests/qa/dg1/a.test.mjs"), env).status, 0);
  assert.equal(hook("backend-workflow-engineer", join(r, "apps/api/src/x.ts"), env).status, 0);
  // denied by scope (protected), not by the home rule
  const p = hook("backend-workflow-engineer", join(r, "docs/source/playbook.md"), env);
  assert.equal(p.status, 2);
  assert.match(p.stderr, /protected path|may not write 'docs\/source\/playbook.md'/);
  // HOME files outside the repository: blocked
  for (const t of [join(home, ".gitconfig"), join(home, ".claude", "settings.json"), join(home, "repo2", "x.txt")]) {
    assert.equal(hook("qa-verifier", t, env).status, 2, `must be blocked: ${t}`);
  }
});

test("QA11-G4 F-DG0-136: path normalisation and sibling prefixes: '..' out of the temp dir, '/tmpX' and a HOME sibling are classified correctly", () => {
  const r = guardedRepo();
  const home = join(scratch("qa11-hp-"), "h");
  mkdirSync(home);
  const env = baseEnv({ HOME: home, MTH_GUARD_ROOT: r });
  const blocked = [join(tmpdir(), "..", "etc", "gitconfig"), "/tmp/../etc/claude-code/managed-settings.json", "/tmpX/evil.txt", "/tmp-other/x", join(home, "sub", "..", ".profile")];
  for (const t of blocked) assert.equal(hook("code-security-reviewer", t, env).status, 2, `must be blocked: ${t}`);
  const allowed = [join(tmpdir(), "a", "..", "b.txt"), home + "2/x.txt" /* sibling of HOME, inside /tmp */];
  for (const t of allowed) assert.equal(hook("code-security-reviewer", t, env).status, 0, `scratch must be allowed: ${t}`);
});

test("QA11-G5 F-DG0-135: the hook fails closed for a non-existent MTH_GUARD_ROOT and for a repository whose git metadata is corrupt, even for temp scratch", () => {
  const scratchFile = join(scratch("qa11-s-"), "ok.txt");
  // (a) non-existent root: the guard file is missing, so the hook's own fallback blocks
  const a = hook("qa-verifier", scratchFile, baseEnv({ MTH_GUARD_ROOT: "/nonexistent/qa11" }));
  assert.equal(a.status, 2);
  // (b) the guard exists but `git worktree list` fails (corrupt .git): every write is blocked, scratch included
  const r = guardedRepo();
  rmSync(join(r, ".git"), { recursive: true, force: true });
  writeFileSync(join(r, ".git"), "gitdir: /nonexistent/qa11/gitdir\n");
  for (const t of [scratchFile, join(r, "apps/api/x.ts"), join(r, "docs/delivery/reviews/DG0/round-1/qa-verifier.json")]) {
    const res = hook("qa-verifier", t, baseEnv({ MTH_GUARD_ROOT: r }));
    assert.equal(res.status, 2, `must fail closed: ${t}`);
    assert.match(res.stderr, /cannot determine the guarded repository roots/);
  }
});

// ---------------------------------------------------------------- runner end to end (D-024 exit 71)

const STUB = `#!/usr/bin/env bash
# Stub claude CLI for QA11-R*: consumes the prompt, performs QA11_ACTION with the shell (as an agent's Bash could), and
# emits a minimal stream-json transcript.
sid=""; prev=""
for a in "$@"; do [ "$prev" = "--session-id" ] && sid="$a"; prev="$a"; done
cat > /dev/null
case "$QA11_ACTION" in
  none) ;;
  gitconfig) printf '[core]\\n\\thooksPath = /tmp/qa11-evil-hooks\\n' >> "$HOME/.gitconfig" ;;
  githook) printf '#!/bin/sh\\ntouch "%s"\\n' "$QA11_MARKER" > "$QA11_REPO/.git/hooks/pre-commit"; chmod +x "$QA11_REPO/.git/hooks/pre-commit" ;;
  local-plain) mkdir -p "$QA11_REPO/.claude"; echo '{"disableAllHooks": true}' > "$QA11_REPO/.claude/settings.local.json" ;;
  local-excluded) echo '.claude/settings.local.json' >> "$QA11_REPO/.git/info/exclude"; mkdir -p "$QA11_REPO/.claude"; echo '{"disableAllHooks": true}' > "$QA11_REPO/.claude/settings.local.json" ;;
  local-in-cwd) mkdir -p "$PWD/.claude"; echo '{"disableAllHooks": true}' > "$PWD/.claude/settings.local.json" ;;
esac
printf '{"type":"system","subtype":"init","session_id":"%s","model":"stub"}\\n' "$sid"
printf '{"type":"result","subtype":"success","is_error":false,"session_id":"%s","result":"stub done"}\\n' "$sid"
`;

function runnerFixture(action, { worktree = false } = {}) {
  const base = scratch("qa11-run-");
  const repo = join(base, "clone");
  execFileSync("git", ["clone", "-q", ROOT, repo]);
  git(repo, "config", "user.email", "qa@example.invalid");
  git(repo, "config", "user.name", "qa11");
  mkdirSync(join(repo, "docs/delivery/assignments/DG0"), { recursive: true });
  writeFileSync(join(repo, "docs/delivery/assignments/DG0/T-QA11.md"), "# QA11 stub assignment\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "qa11 assignment");
  const bin = join(base, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "claude"), STUB);
  chmodSync(join(bin, "claude"), 0o755);
  const home = join(base, "home");
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(join(home, ".gitconfig"), "[user]\n\tname = qa11\n");
  const marker = join(base, "hook-ran");
  const env = { ...baseEnv({}), HOME: home, PATH: `${bin}:${process.env.PATH}`, QA11_ACTION: action, QA11_REPO: repo, QA11_MARKER: marker, MTH_MAX_RESUMES: "0" };
  let cwd = repo;
  if (worktree) {
    cwd = join(base, "wt");
    git(repo, "worktree", "add", "-q", "--detach", cwd);
  }
  const head0 = git(repo, "rev-parse", "HEAD").trim();
  const res = spawnSync(join(repo, "tools/agents/run-agent.sh"), ["--role", "qa-verifier", "--stage", "DG0", "--task", "T-QA11", "--assignment", join(repo, "docs/delivery/assignments/DG0/T-QA11.md"), "--cwd", cwd], { cwd: repo, env });
  const runs = readdirSync(join(repo, "docs/delivery/runs/DG0")).filter((d) => d.startsWith("DG0-T-QA11-"));
  assert.equal(runs.length, 1, "exactly one run directory");
  const meta = JSON.parse(readFileSync(join(repo, "docs/delivery/runs/DG0", runs[0], "meta.json"), "utf8"));
  const head1 = git(repo, "rev-parse", "HEAD").trim();
  const status = git(repo, "status", "--porcelain", "--untracked-files=all");
  return { status: res.status, stderr: res.stderr.toString(), meta, committed: head0 !== head1, marker, repo, cwd, gitStatus: status };
}

test("QA11-R6 D-024: a shell-written .claude/settings.local.json in the agent's worktree working directory must leave a trace in the run evidence", () => {
  const f = runnerFixture("local-in-cwd", { worktree: true });
  assert.equal(existsSync(join(f.cwd, ".claude/settings.local.json")), true, "fixture sanity: the file was planted in the worktree");
  const traced = f.status === 71 || f.meta.external_config_changed.length > 0 || Object.keys(f.meta.outputs || {}).some((p) => p.endsWith("settings.local.json"));
  const wtStatus = git(f.cwd, "status", "--porcelain", "--untracked-files=all");
  assert.ok(traced, `no trace in the run evidence: exit=${f.status} external_config_changed=${JSON.stringify(f.meta.external_config_changed)}; main-repo git status=${JSON.stringify(f.gitStatus)}; worktree git status=${JSON.stringify(wtStatus)}`);
});

test("QA11-R1 runner control: a run that changes no external configuration exits 0, records external_config_changed [] and auto-commits", () => {
  const f = runnerFixture("none");
  assert.equal(f.status, 0, f.stderr);
  assert.deepEqual(f.meta.external_config_changed, []);
  assert.equal(f.committed, true);
});

test("QA11-R2 D-024: a run whose shell edits ~/.gitconfig exits 71, is recorded in meta and is NOT auto-committed", () => {
  const f = runnerFixture("gitconfig");
  assert.equal(f.status, 71, f.stderr);
  assert.ok(f.meta.external_config_changed.some((l) => l.includes("/.gitconfig ")), JSON.stringify(f.meta.external_config_changed));
  assert.equal(f.committed, false);
  assert.match(f.stderr, /evidence NOT auto-committed/);
});

test("QA11-R3 D-024: a planted .git/hooks/pre-commit is detected before the auto-commit, so the hook never executes", () => {
  const f = runnerFixture("githook");
  assert.equal(f.status, 71, f.stderr);
  assert.ok(f.meta.external_config_changed.some((l) => l.includes(".git/hooks/pre-commit")));
  assert.equal(f.committed, false);
  assert.equal(existsSync(f.marker), false, "the planted pre-commit hook must not have run");
});

test("QA11-R4 control: a shell-written .claude/settings.local.json (loaded under --setting-sources project,local) shows in meta.outputs and git status", () => {
  const f = runnerFixture("local-plain");
  assert.ok(Object.keys(f.meta.outputs || {}).includes(".claude/settings.local.json"), JSON.stringify(f.meta.outputs));
  assert.match(f.gitStatus, /\.claude\/settings\.local\.json/);
});

test("QA11-R5 D-024: hiding a shell-written .claude/settings.local.json with .git/info/exclude must still leave a trace in the run evidence", () => {
  const f = runnerFixture("local-excluded");
  const outputs = Object.keys(f.meta.outputs || {});
  const traced = f.status === 71 || f.meta.external_config_changed.length > 0 || outputs.includes(".claude/settings.local.json");
  assert.equal(existsSync(join(f.repo, ".claude/settings.local.json")), true, "fixture sanity: the file was planted");
  assert.ok(traced, `no trace: exit=${f.status} external_config_changed=${JSON.stringify(f.meta.external_config_changed)} outputs has it=${outputs.includes(".claude/settings.local.json")} git status=${JSON.stringify(f.gitStatus)}`);
});
