// Write-guard tests: reviewers cannot touch implementation; implementers cannot weaken gate rules.
// Run: node --test tools/agents/tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { decide as decideAt, GUARD_ROOT } from "../guard-write.mjs";
// Hermetic git: fixtures must not depend on the host's global or system git config (e.g. mandatory commit signing).
process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_NOSYSTEM = "1";
process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = "gate-test";
process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = "gate-test@example.invalid";

const here = dirname(fileURLToPath(import.meta.url));
const scopes = JSON.parse(readFileSync(join(here, "..", "write-scopes.json"), "utf8"));
const repo = mkdtempSync(join(tmpdir(), "guard-fixture-"));
execFileSync("git", ["init", "-q", repo]);
const p = (rel) => join(repo, rel);
// Tests use a fixture repository as the guarded root; production uses GUARD_ROOT (the guard's own repository).
const decide = (sc, role, file, root = repo) => decideAt(sc, role, file, root);

test("reviewers may write only review records and evidence", () => {
  for (const [role, key] of [["domain-reviewer", "domain"], ["code-security-reviewer", "code-security"]]) {
    assert.equal(decide(scopes, role, p(`docs/delivery/reviews/DG1/round-1/${role}.json`)).allow, true);
    assert.equal(decide(scopes, role, p(`docs/delivery/reviews/DG1/round-1/${role}.findings.json`)).allow, true);
    assert.equal(decide(scopes, role, p(`docs/delivery/test-evidence/DG1/${key}/round-1/log.txt`)).allow, true);
    assert.equal(decide(scopes, role, p("apps/api/src/server.ts")).allow, false);
    assert.equal(decide(scopes, role, p("docs/delivery/gates/DG1.json")).allow, false);
    assert.equal(decide(scopes, role, p("docs/delivery/findings.json")).allow, false);
  }
});

test("qa-verifier may add tests under tests/qa and e2e but not product code", () => {
  assert.equal(decide(scopes, "qa-verifier", p("tests/qa/dg1/auth.test.ts")).allow, true);
  assert.equal(decide(scopes, "qa-verifier", p("e2e/lifecycle.spec.ts")).allow, true);
  assert.equal(decide(scopes, "qa-verifier", p("apps/web/src/App.tsx")).allow, false);
});

test("implementers cannot edit gate rules, agent definitions, sources or gate records", () => {
  for (const role of ["solution-architect", "frontend-ux-engineer", "backend-workflow-engineer", "kpi-benefits-engineer", "devops-engineer"]) {
    assert.equal(decide(scopes, role, p("apps/api/src/server.ts")).allow, true);
    for (const rel of ["tools/gates/lib/rules.mjs", "tools/agents/write-scopes.json", ".claude/agents/qa-verifier.md",
      "docs/source/playbook.md", "docs/delivery/reviews/DG1/round-1/qa-verifier.json", "docs/delivery/gates/DG1.json",
      "docs/delivery/stages.json", "docs/delivery/runs/DG1/x/meta.json", "docs/delivery/findings.json", ".github/workflows/delivery-gates.yml"]) {
      assert.equal(decide(scopes, role, p(rel)).allow, false, `${role} must not write ${rel}`);
    }
  }
});

test("release-auditor writes gate decisions but not implementation", () => {
  assert.equal(decide(scopes, "release-auditor", p("docs/delivery/gates/DG1.json")).allow, true);
  assert.equal(decide(scopes, "release-auditor", p("packages/calc/src/index.ts")).allow, false);
});

test("transformation-analyst is limited to analysis outputs and the register", () => {
  assert.equal(decide(scopes, "transformation-analyst", p("docs/analysis/glossary.md")).allow, true);
  assert.equal(decide(scopes, "transformation-analyst", p("docs/delivery/requirements.csv")).allow, true);
  assert.equal(decide(scopes, "transformation-analyst", p("docs/delivery/decisions.md")).allow, false);
});

test("unknown roles are denied and scratch space outside a repo is allowed", () => {
  assert.equal(decide(scopes, "nobody", p("docs/analysis/x.md")).allow, false);
  const scratch = mkdtempSync(join(tmpdir(), "scratch-"));
  mkdirSync(join(scratch, "a"), { recursive: true });
  assert.equal(decide(scopes, "domain-reviewer", join(scratch, "a", "notes.md")).allow, true);
});

test("the hook entry point blocks with exit code 2 and allows with 0", () => {
  const script = join(here, "..", "guard-write.mjs");
  const block = spawnSync("node", [script, "domain-reviewer"], { input: JSON.stringify({ tool_input: { file_path: join(GUARD_ROOT, "apps/api/x.ts") } }) });
  assert.equal(block.status, 2);
  assert.match(block.stderr.toString(), /BLOCKED by write guard/);
  const allow = spawnSync("node", [script, "domain-reviewer"], { input: JSON.stringify({ tool_input: { file_path: join(GUARD_ROOT, "docs/delivery/reviews/DG1/round-1/domain-reviewer.json") } }) });
  assert.equal(allow.status, 0);
  const garbage = spawnSync("node", [script, "domain-reviewer"], { input: "{not json" });
  assert.equal(garbage.status, 2, "unreadable payload must fail closed");
});

test("implementers cannot write reviewer test evidence", () => {
  assert.equal(decide(scopes, "backend-workflow-engineer", p("docs/delivery/test-evidence/DG1/qa.log")).allow, false);
  assert.equal(decide(scopes, "backend-workflow-engineer", p("docs/delivery/handbacks/DG1/T-1.md")).allow, true);
});

test("F-DG0-105: Claude configuration surfaces and the unrelated project are protected from implementers", () => {
  for (const role of ["backend-workflow-engineer", "devops-engineer"]) {
    for (const rel of [".claude/settings.local.json", ".claude/hooks/x.sh", ".claude/commands/y.md", ".mcp.json",
      "CLAUDE.md", "apps/api/CLAUDE.md", "apps/web/.claude/settings.json", "trading_agent/agent.py", "CLAUDE.local.md"]) {
      assert.equal(decide(scopes, role, p(rel)).allow, false, `${role} must not write ${rel}`);
    }
  }
  for (const role of ["domain-reviewer", "qa-verifier", "release-auditor", "transformation-analyst"]) {
    assert.equal(decide(scopes, role, p(".claude/settings.local.json")).allow, false);
  }
});

test("F-DG0-105: writes through a symlink into a protected path are blocked", () => {
  const r = mkdtempSync(join(tmpdir(), "guard-link-"));
  execFileSync("git", ["init", "-q", r]);
  mkdirSync(join(r, "tools", "gates", "lib"), { recursive: true });
  mkdirSync(join(r, "docs", "analysis"), { recursive: true });
  symlinkSync(join(r, "tools", "gates"), join(r, "docs", "analysis", "lnk"));
  const verdict = decide(scopes, "transformation-analyst", join(r, "docs", "analysis", "lnk", "lib", "rules.mjs"), r);
  assert.equal(verdict.allow, false);
  assert.match(verdict.reason, /symlink/);
  assert.equal(decide(scopes, "transformation-analyst", join(r, "docs", "analysis", "real.md"), r).allow, true);
});

test("F-DG0-105: protected-path matching is case-insensitive", () => {
  assert.equal(decide(scopes, "backend-workflow-engineer", p("Tools/Gates/lib/rules.mjs")).allow, false);
  assert.equal(decide(scopes, "backend-workflow-engineer", p("DOCS/SOURCE/playbook.md")).allow, false);
});

test("F-DG0-111: a planted nested .git cannot move the guarded root; .git paths are never writable", () => {
  const r = mkdtempSync(join(tmpdir(), "guard-nested-"));
  execFileSync("git", ["init", "-q", r]);
  mkdirSync(join(r, "tools", "gates", "lib"), { recursive: true });
  for (const planted of ["tools/.git", "docs/.git", ".github/.git", ".git/config", "apps/.GIT/x"]) {
    assert.equal(decide(scopes, "backend-workflow-engineer", join(r, planted), r).allow, false, `must not write ${planted}`);
  }
  // Even if a nested .git exists, paths are scoped from the fixed root.
  execFileSync("git", ["init", "-q", join(r, "tools")]);
  const v = decide(scopes, "backend-workflow-engineer", join(r, "tools", "gates", "lib", "rules.mjs"), r);
  assert.equal(v.allow, false);
  assert.match(v.reason, /tools\/gates\/lib\/rules\.mjs/);
});

test("the production guard root is this repository", () => {
  assert.ok(readFileSync(join(GUARD_ROOT, "tools", "agents", "write-scopes.json")));
  assert.equal(decideAt(scopes, "domain-reviewer", join(GUARD_ROOT, "tools", "gates", "validate.mjs")).allow, false);
  assert.equal(decideAt(scopes, "domain-reviewer", join(GUARD_ROOT, "docs", "delivery", "reviews", "DG1", "round-1", "domain-reviewer.json")).allow, true);
});

test("F-DG0-134: the repository's worktrees are guarded too, from any working directory", () => {
  const r = mkdtempSync(join(tmpdir(), "guard-wt-"));
  execFileSync("git", ["init", "-q", "-b", "main", r]);
  execFileSync("git", ["-C", r, "-c", "user.email=t@e", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "c"]);
  const w = mkdtempSync(join(tmpdir(), "guard-wt-sibling-"));
  execFileSync("git", ["-C", r, "worktree", "add", "-q", join(w, "wt")]);
  execFileSync("git", ["-C", r, "worktree", "add", "-q", join(r, ".wt", "nested")]);
  for (const target of [join(r, "tools/gates/x.mjs"), join(w, "wt", "tools/gates/x.mjs"), join(r, ".wt", "nested", "docs/source/p.md")]) {
    assert.equal(decide(scopes, "backend-workflow-engineer", target, r).allow, false, `must block ${target}`);
  }
  assert.equal(decide(scopes, "transformation-analyst", join(w, "wt", "docs/analysis/a.md"), r).allow, true);
  // The hook entry point: root from MTH_GUARD_ROOT, agent working in the worktree, relative and absolute paths.
  const script = join(here, "..", "guard-write.mjs");
  const env = { ...process.env, MTH_GUARD_ROOT: r };
  for (const fp of ["tools/gates/lib/rules.mjs", join(r, "docs/source/playbook.md")]) {
    const res = spawnSync("node", [script, "backend-workflow-engineer"], { cwd: join(w, "wt"), env, input: JSON.stringify({ tool_input: { file_path: fp } }) });
    assert.equal(res.status, 2, `hook must block ${fp}`);
  }
  const ok = spawnSync("node", [script, "backend-workflow-engineer"], { cwd: join(w, "wt"), env, input: JSON.stringify({ tool_input: { file_path: "apps/api/x.ts" } }) });
  assert.equal(ok.status, 0);
});

test("F-DG0-134: every role's hook command takes the guard from MTH_GUARD_ROOT and fails closed without it", () => {
  for (const role of Object.keys(scopes.roles)) {
    const cfg = JSON.parse(readFileSync(join(here, "..", "settings", `${role}.settings.json`), "utf8"));
    const cmd = cfg.hooks.PreToolUse[0].hooks[0].command;
    assert.match(cmd, /\$MTH_GUARD_ROOT\/tools\/agents\/guard-write\.mjs/);
    assert.doesNotMatch(cmd, /rev-parse/);
    const res = spawnSync("sh", ["-c", cmd], { env: { ...process.env, MTH_GUARD_ROOT: "" }, input: "{}" });
    assert.equal(res.status, 2, `${role} hook must fail closed without MTH_GUARD_ROOT`);
  }
});

test("F-DG0-135: the guard fails closed when the guarded roots cannot be determined", () => {
  const notRepo = mkdtempSync(join(tmpdir(), "guard-norepo-"));
  const v = decide(scopes, "backend-workflow-engineer", join(notRepo, "apps", "x.ts"), notRepo);
  assert.equal(v.allow, false);
  assert.match(v.reason, /cannot determine the guarded repository roots/);
  // git unavailable to the hook process: every write is blocked, even ordinary implementation files.
  const script = join(here, "..", "guard-write.mjs");
  const res = spawnSync(process.execPath, [script, "backend-workflow-engineer"], {
    env: { PATH: "/nonexistent", MTH_GUARD_ROOT: GUARD_ROOT }, input: JSON.stringify({ tool_input: { file_path: join(GUARD_ROOT, "apps/api/x.ts") } }),
  });
  assert.equal(res.status, 2);
  assert.match(res.stderr.toString(), /cannot determine the guarded repository roots/);
});

test("F-DG0-136: only the temporary directory is scratch; home and system configuration are never writable", () => {
  for (const target of [join(homedir(), ".claude", "settings.json"), join(homedir(), ".gitconfig"), "/etc/claude-code/managed-settings.json", "/etc/gitconfig", join(homedir(), ".bashrc")]) {
    for (const role of Object.keys(scopes.roles)) {
      assert.equal(decide(scopes, role, target, repo).allow, false, `${role} must not write ${target}`);
    }
  }
  assert.equal(decide(scopes, "domain-reviewer", join(tmpdir(), "scratch-notes.md"), repo).allow, true);
});

test("F-DG0-136: the home directory is never scratch, even when HOME lies inside the temp directory", () => {
  const fakeHome = mkdtempSync(join(tmpdir(), "guard-home-"));
  const script = join(here, "..", "guard-write.mjs");
  const env = { ...process.env, HOME: fakeHome, MTH_GUARD_ROOT: GUARD_ROOT };
  const probe = (fp) => spawnSync("node", [script, "domain-reviewer"], { env, input: JSON.stringify({ tool_input: { file_path: fp } }) }).status;
  assert.equal(probe(join(fakeHome, ".claude", "settings.json")), 2);
  assert.equal(probe(join(fakeHome, ".gitconfig")), 2);
  assert.equal(probe(join(tmpdir(), "not-home-scratch.txt")), 0);
});

test("F-DG0-144: a reviewer may not write another reviewer's record, sidecars or evidence", () => {
  const roles = { "domain-reviewer": "domain", "code-security-reviewer": "code-security", "qa-verifier": "qa", "release-auditor": "audit" };
  for (const [role, key] of Object.entries(roles)) {
    assert.equal(decide(scopes, role, p(`docs/delivery/reviews/DG1/round-2/${role}.verifications.json`)).allow, true);
    assert.equal(decide(scopes, role, p(`docs/delivery/test-evidence/DG1/${key}/x.log`)).allow, true);
    for (const [other, otherKey] of Object.entries(roles)) {
      if (other === role) continue;
      for (const rel of [`docs/delivery/reviews/DG1/round-2/${other}.json`, `docs/delivery/reviews/DG1/round-2/${other}.findings.json`,
        `docs/delivery/test-evidence/DG1/${otherKey}/x.log`, `docs/delivery/test-evidence/DG1/x.log`]) {
        assert.equal(decide(scopes, role, p(rel)).allow, false, `${role} must not write ${rel}`);
      }
    }
  }
});

test("F-DG0-144: only the run's own private temporary directory is scratch, never the shared /tmp", () => {
  const own = mkdtempSync(join(tmpdir(), "guard-runtmp-"));
  const other = mkdtempSync(join(tmpdir(), "guard-othertmp-"));
  const saved = process.env.MTH_RUN_TMP;
  process.env.MTH_RUN_TMP = own;
  try {
    assert.equal(decide(scopes, "qa-verifier", join(own, "clone", "notes.md")).allow, true);
    assert.equal(decide(scopes, "qa-verifier", join(other, "clone", "notes.md")).allow, false);
    assert.equal(decide(scopes, "qa-verifier", "/tmp/shared-scratch.md").allow, false);
  } finally {
    if (saved === undefined) delete process.env.MTH_RUN_TMP;
    else process.env.MTH_RUN_TMP = saved;
  }
});

test("F-DG0-143: writes that resolve through /proc, /sys or /dev, or whose real path cannot be determined, are blocked", () => {
  const own = mkdtempSync(join(tmpdir(), "guard-proc-"));
  const saved = process.env.MTH_RUN_TMP;
  process.env.MTH_RUN_TMP = own;
  try {
    symlinkSync(`/proc/${process.pid}/root/tmp`, join(own, "into-other-namespace"));
    symlinkSync("/proc/self/cwd", join(own, "self-cwd"));
    symlinkSync(join(own, "loop-b"), join(own, "loop-a"));
    symlinkSync(join(own, "loop-a"), join(own, "loop-b"));
    for (const target of [join(own, "into-other-namespace", "x.txt"), join(own, "self-cwd", "x.txt"), "/proc/self/root/tmp/x.txt",
      "/dev/shm/x.txt", join(own, "loop-a", "x.txt")]) {
      assert.equal(decide(scopes, "qa-verifier", target).allow, false, `must block ${target}`);
    }
    assert.equal(decide(scopes, "qa-verifier", join(own, "plain.txt")).allow, true);
  } finally {
    if (saved === undefined) delete process.env.MTH_RUN_TMP;
    else process.env.MTH_RUN_TMP = saved;
  }
});
