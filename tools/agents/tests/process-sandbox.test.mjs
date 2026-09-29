// The process sandbox around the whole agent CLI (tools/agents/agent_sandbox.py; D-030, F-DG0-145).
// Run: node --test tools/agents/tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// Hermetic git: fixtures must not depend on the host's global or system git config (e.g. mandatory commit signing).
process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_NOSYSTEM = "1";
process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = "gate-test";
process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = "gate-test@example.invalid";

const here = dirname(fileURLToPath(import.meta.url));
const real = join(here, "..", "..", "..");

function requireTools() {
  for (const tool of ["bwrap", "setpriv"]) {
    if (spawnSync("sh", ["-c", `command -v ${tool}`]).status !== 0) assert.fail(`${tool} is required by the process sandbox (D-030)`);
  }
}

/** A repository shaped like this one, with the real agent tooling, an earlier review round and every stage area. */
function fixture() {
  const base = mkdtempSync(join(tmpdir(), "psbx-"));
  const repo = join(base, "repo");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  cpSync(join(real, "tools", "agents"), join(repo, "tools", "agents"), { recursive: true, filter: (s) => !s.includes("__pycache__") });
  const files = {
    "CLAUDE.md": "rules\n", ".claude/agents/x.md": "agent\n", "tools/gates/tests/t.mjs": "// gate test\n", "docs/source/s.md": "source\n",
    "docs/delivery/reviews/DG0/round-1/domain-reviewer.json": "{\"verdict\":\"PASS\"}\n",
    "docs/delivery/reviews/DG0/round-1/code-security-reviewer.json": "{\"verdict\":\"FAIL\"}\n", "docs/delivery/requirements.csv": "req_id,title\nR-1,a\n",
    "docs/delivery/decisions.md": "decisions\n", "docs/analysis/a.md": "analysis\n", "apps/api/x.ts": "export {};\n",
    "docs/delivery/gates/DG1.json": "{}\n",
  };
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, rel)), { recursive: true });
    writeFileSync(join(repo, rel), content);
  }
  for (const d of ["docs/delivery/runs/DG0", "docs/delivery/handbacks", "tests/qa", "e2e", ...["domain", "code-security", "qa", "audit"].map((k) => `docs/delivery/test-evidence/DG0/${k}`)]) {
    mkdirSync(join(repo, d), { recursive: true });
  }
  execFileSync("git", ["-C", repo, "add", "-A"]);
  execFileSync("git", ["-C", repo, "commit", "-qm", "fixture"]);
  const home = join(base, "home");
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(join(home, ".claude", "settings.json"), "{}\n");
  const tmpParent = join(base, "var-tmp");
  mkdirSync(tmpParent);
  const otherRun = mkdtempSync(join(tmpParent, "mth-run.")); // another agent's private TMPDIR
  mkdirSync(join(otherRun, "clone", "tests"), { recursive: true });
  return { base, repo, home, tmpParent, otherRun };
}

/** Prepares the sandbox for a role and returns a runner for commands inside it (what run-agent.sh does around claude). */
function sandbox(fx, role, { stage = "DG0" } = {}) {
  const runTmp = mkdtempSync(join(fx.tmpParent, "mth-run."));
  const state = mkdtempSync(join(fx.tmpParent, "mth-state."));
  const env = { ...process.env, HOME: fx.home };
  const py = (...args) => execFileSync("python3", ["-I", "-B", join(fx.repo, "tools/agents/agent_sandbox.py"), ...args], { env, cwd: "/" });
  py("prepare", role, fx.repo, fx.repo, stage, runTmp, state, process.execPath);
  const args = py("args", state).toString().split("\0").filter((x, i, a) => i < a.length - 1);
  // A bounded wait: a sandbox that cannot be built must fail the test, never hang it.
  const run = (cmd, extraEnv = {}) => spawnSync("bwrap", [...args, "/bin/sh", "-c", cmd], {
    env: { ...env, TMPDIR: runTmp, MTH_RUN_TMP: runTmp, MTH_GUARD_ROOT: fx.repo, ...extraEnv }, encoding: "utf8", cwd: "/", timeout: 240000 });
  const finish = () => {
    const out = mkdtempSync(join(fx.base, "out-"));
    const r = spawnSync("python3", ["-I", "-B", join(fx.repo, "tools/agents/agent_sandbox.py"), "finish", state, out], { env, cwd: "/", encoding: "utf8" });
    return { status: r.status, summary: JSON.parse(readFileSync(join(out, "sandbox.json"), "utf8")) };
  };
  return { run, finish, runTmp, state, plan: () => JSON.parse(readFileSync(join(state, "plan.json"), "utf8")) };
}


/** Each probe prints "<label> WROTE" or "<label> refused"; returns {label: bool}. Only the listed directories are created. */
function probe(sb, targets, mkdirs = []) {
  const script = [...mkdirs.map((d) => `mkdir -p '${d}'`), ...Object.entries(targets).map(([label, path]) =>
    `if (echo probe > '${path}') 2>/dev/null; then echo '${label} WROTE'; else echo '${label} refused'; fi`)].join("\n");
  const r = sb.run(script);
  assert.equal(r.status, 0, r.stderr);
  return Object.fromEntries(r.stdout.trim().split("\n").map((l) => [l.replace(/ (WROTE|refused)$/, ""), l.endsWith("WROTE")]));
}

test("F-DG0-145: a confined reviewer's whole process writes only its own evidence and its own new review files", () => {
  requireTools();
  const fx = fixture();
  const sb = sandbox(fx, "code-security-reviewer");
  const r = fx.repo;
  const got = probe(sb, {
    ownEvidence: `${r}/docs/delivery/test-evidence/DG0/code-security/e.txt`,
    ownRecord: `${r}/docs/delivery/reviews/DG0/round-2/code-security-reviewer.json`,
    otherRecordStaged: `${r}/docs/delivery/reviews/DG0/round-2/domain-reviewer.json`,
    earlierRecordStaged: `${r}/docs/delivery/reviews/DG0/round-1/domain-reviewer.json`,
    ownEarlierRecordStaged: `${r}/docs/delivery/reviews/DG0/round-1/code-security-reviewer.json`,
    otherEvidence: `${r}/docs/delivery/test-evidence/DG0/qa/e.txt`,
    gateRules: `${r}/tools/gates/tests/t.mjs`,
    agentTooling: `${r}/tools/agents/guard-write.mjs`,
    gitHooks: `${r}/.git/hooks/pre-commit`,
    claudeConfig: `${r}/.claude/settings.json`,
    source: `${r}/docs/source/s.md`,
    product: `${r}/apps/api/x.ts`,
    gateRecord: `${r}/docs/delivery/gates/DG0.json`,
    homeSettings: `${fx.home}/.claude/settings.json`,
    otherRunTmp: `${fx.otherRun}/clone/tests/planted.mjs`,
    ownTmp: `${sb.runTmp}/scratch.txt`,
    repoRootThrowaway: `${r}/planted.py`,
  }, [`${r}/docs/delivery/reviews/DG0/round-2`]);
  assert.deepEqual(got, {
    ownEvidence: true, ownRecord: true, otherRecordStaged: true, earlierRecordStaged: true, ownEarlierRecordStaged: true,
    otherEvidence: false, gateRules: false,
    agentTooling: false, gitHooks: false, claudeConfig: false, source: false, product: false, gateRecord: false, homeSettings: false,
    otherRunTmp: false, ownTmp: true, repoRootThrowaway: true,
  });
  // Nothing outside the role's areas changed in the real tree: the throwaway top level vanished with the sandbox.
  assert.equal(existsSync(join(r, "planted.py")), false);
  assert.equal(readFileSync(join(r, "tools/gates/tests/t.mjs"), "utf8"), "// gate test\n");
  assert.equal(readdirSync(join(fx.otherRun, "clone", "tests")).length, 0);
  assert.equal(readFileSync(join(fx.home, ".claude/settings.json"), "utf8"), "{}\n");
  assert.equal(readFileSync(join(r, "docs/delivery/test-evidence/DG0/code-security/e.txt"), "utf8"), "probe\n");
  // Only this role's new review file is copied back; the rest of the staging copy is discarded and reported.
  const { status, summary } = sb.finish();
  assert.equal(status, 3);
  assert.deepEqual(summary.copied_back, ["docs/delivery/reviews/DG0/round-2/code-security-reviewer.json"]);
  assert.equal(summary.discarded.length, 3, summary.discarded.join("; "));
  assert.match(summary.discarded.join("\n"), /round-1\/domain-reviewer\.json: outside the role's scope/);
  assert.match(summary.discarded.join("\n"), /round-2\/domain-reviewer\.json: outside the role's scope/);
  assert.match(summary.discarded.join("\n"), /round-1\/code-security-reviewer\.json: existing file changed; review files are write-once/);
  assert.equal(readFileSync(join(r, "docs/delivery/reviews/DG0/round-1/domain-reviewer.json"), "utf8"), "{\"verdict\":\"PASS\"}\n");
  assert.equal(readFileSync(join(r, "docs/delivery/reviews/DG0/round-1/code-security-reviewer.json"), "utf8"), "{\"verdict\":\"FAIL\"}\n");
  assert.equal(existsSync(join(r, "docs/delivery/reviews/DG0/round-2/domain-reviewer.json")), false);
  assert.equal(readFileSync(join(r, "docs/delivery/reviews/DG0/round-2/code-security-reviewer.json"), "utf8"), "probe\n");
  assert.deepEqual(summary.writable_areas, ["docs/delivery/test-evidence/DG0/code-security"]);
  rmSync(fx.base, { recursive: true, force: true });
});

test("F-DG0-145: a symlink swapped between the guard's check and the write never lets a write land outside the role's scope", (t) => {
  requireTools();
  const fx = fixture();
  // Round 15 (repro-r15-guard-toctou.mjs): the hook allows while the link points at a benign directory, then the
  // agent's shell flips it to a forbidden one before the CLI writes. Inside the process sandbox the kernel refuses
  // every such write, whatever the hook decided.
  const race = `
    const { spawn, spawnSync } = require("node:child_process");
    const fs = require("node:fs");
    const [guard, role, runTmp, forbidden, n] = process.argv.slice(1);
    fs.mkdirSync(runTmp + "/benign", { recursive: true });
    const flip = runTmp + "/flip";
    const flipper = spawn("bash", ["-c", "cd '" + runTmp + "'; while :; do ln -sfn '" + runTmp + "/benign' .t1 && mv -Tf .t1 flip; ln -sfn '" + forbidden + "' .t2 && mv -Tf .t2 flip; done"], { stdio: "ignore" });
    const t0 = Date.now(); while (Date.now() - t0 < 200) {}
    let allowed = 0, refusedAfterAllow = 0;
    for (let i = 0; i < Number(n); i++) {
      const p = flip + "/probe-" + i + ".txt";
      const h = spawnSync("node", [guard, role], { input: JSON.stringify({ tool_name: "Write", tool_input: { file_path: p, content: "x" } }) });
      if (h.status !== 0) continue;
      allowed++;
      try { fs.writeFileSync(p, "race " + i + "\\n"); } catch (e) { refusedAfterAllow++; }
    }
    flipper.kill("SIGKILL");
    console.log(JSON.stringify({ allowed, refusedAfterAllow }));`;
  const scenarios = [
    ["code-security-reviewer", join(fx.otherRun, "clone", "tests")], // another run's private TMPDIR
    ["code-security-reviewer", join(fx.repo, "docs/delivery/test-evidence/DG0/qa")], // another reviewer's evidence
    ["qa-verifier", join(fx.repo, "tools/gates/tests")], // protected repository path
    ["backend-workflow-engineer", join(fx.repo, "tools/gates/tests")],
    ["backend-workflow-engineer", join(fx.repo, ".git/hooks")],
  ];
  const cmd = (role, forbidden) => `exec node -e '${race.replace(/'/g, "'\\''")}' "$MTH_GUARD_ROOT/tools/agents/guard-write.mjs" '${role}' "$MTH_RUN_TMP" '${forbidden}' 150`;
  const landedIn = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.startsWith("probe-")) : []);
  // Positive control: the same race without the process sandbox (the round-15 design) does land writes.
  const control = join(fx.repo, "tools/gates/tests");
  const ctlTmp = mkdtempSync(join(fx.tmpParent, "mth-run."));
  const ctl = spawnSync("/bin/sh", ["-c", cmd("qa-verifier", control)], { encoding: "utf8", cwd: "/",
    env: { ...process.env, HOME: fx.home, TMPDIR: ctlTmp, MTH_RUN_TMP: ctlTmp, MTH_GUARD_ROOT: fx.repo } });
  assert.equal(ctl.status, 0, ctl.stderr);
  const escaped = landedIn(control).length;
  t.diagnostic(`without the process sandbox: ${escaped} of ${JSON.parse(ctl.stdout.trim()).allowed} allowed writes landed in ${control}`);
  assert.ok(escaped > 0, "the positive control never won the race, so the sandboxed runs below would prove nothing");
  for (const f of landedIn(control)) rmSync(join(control, f));
  let raceHits = 0;
  for (const [role, forbidden] of scenarios) {
    const sb = sandbox(fx, role);
    const r = sb.run(cmd(role, forbidden));
    assert.equal(r.status, 0, r.stderr);
    const { allowed, refusedAfterAllow } = JSON.parse(r.stdout.trim());
    raceHits += refusedAfterAllow;
    t.diagnostic(`${role} -> ${forbidden}: ${allowed} allowed by the hook, ${refusedAfterAllow} of them refused by the kernel, ${landedIn(forbidden).length} landed`);
    assert.deepEqual(landedIn(forbidden), [], `${role}: a write landed in ${forbidden}`);
  }
  // The race was really exercised: the hook allowed writes that then pointed at a forbidden place, and the kernel refused them.
  assert.ok(raceHits > 0, "the flipper never won the race; the test did not exercise the check-then-use window");
  rmSync(fx.base, { recursive: true, force: true });
});

test("D-030: only CAP_SETFCAP remains, and neither the process nor a nested user namespace can unlock the read-only binds", () => {
  requireTools();
  const fx = fixture();
  const sb = sandbox(fx, "domain-reviewer");
  const gates = join(fx.repo, "tools/gates");
  const r = sb.run(`grep -E '^(CapEff|CapBnd|NoNewPrivs):' /proc/self/status
    mount -o remount,rw,bind '${gates}' 2>/dev/null && echo REMOUNTED
    unshare -Urm /bin/sh -c "mount -o remount,rw,bind '${gates}' 2>/dev/null && echo NESTED_REMOUNTED; umount -l '${gates}' 2>/dev/null && echo NESTED_UNMOUNTED; echo x > '${gates}/p' 2>/dev/null && echo NESTED_WROTE; grep '^CapEff:' /proc/self/status"`);
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split("\n").map((l) => l.replace(/\s+/g, " "));
  assert.deepEqual(lines.slice(0, 3), ["CapEff: 0000000080000000", "CapBnd: 0000000080000000", "NoNewPrivs: 1"]);
  // The nested namespace has every capability, but only over its own copies of the mounts, which are locked.
  assert.match(lines.at(-1), /^CapEff: 0+1f+$/);
  assert.deepEqual(lines.filter((l) => /REMOUNTED|UNMOUNTED|WROTE/.test(l)), []);
  assert.equal(existsSync(join(gates, "p")), false);
  rmSync(fx.base, { recursive: true, force: true });
});

test("D-030: implementers write product paths; existing protected paths stay read-only", () => {
  requireTools();
  const fx = fixture();
  const sb = sandbox(fx, "backend-workflow-engineer");
  const r = fx.repo;
  const got = probe(sb, {
    product: `${r}/apps/api/x.ts`, newProduct: `${r}/apps/web/new.ts`, gateRules: `${r}/tools/gates/tests/t.mjs`, git: `${r}/.git/config`,
    claude: `${r}/.claude/agents/x.md`, claudeMd: `${r}/CLAUDE.md`, reviews: `${r}/docs/delivery/reviews/DG0/round-1/domain-reviewer.json`,
    evidence: `${r}/docs/delivery/test-evidence/DG0/qa/e.txt`, source: `${r}/docs/source/s.md`, otherRunTmp: `${fx.otherRun}/clone/tests/p.mjs`,
  }, [`${r}/apps/web`]);
  assert.deepEqual(got, { product: true, newProduct: true, gateRules: false, git: false, claude: false, claudeMd: false, reviews: false,
    evidence: false, source: false, otherRunTmp: false });
  assert.equal(readFileSync(join(r, "apps/web/new.ts"), "utf8"), "probe\n");
  const { status, summary } = sb.finish();
  assert.equal(status, 0);
  assert.equal(summary.confined, false);
  assert.ok(summary.read_only_within_writable.includes("tools/gates") && summary.read_only_within_writable.includes(".git"));
  rmSync(fx.base, { recursive: true, force: true });
});

test("D-030: the analyst's register is replaced atomically in staging and copied back, unless it changed concurrently", () => {
  requireTools();
  for (const concurrent of [false, true]) {
    const fx = fixture();
    const sb = sandbox(fx, "transformation-analyst");
    const reg = join(fx.repo, "docs/delivery/requirements.csv");
    // What the CLI's Edit does: write a temporary file next to the target, then rename it over the target.
    const r = sb.run(`printf 'req_id,title\\nR-1,b\\n' > '${reg}.tmp.1' && mv '${reg}.tmp.1' '${reg}' && echo OK
      echo x > '${join(fx.repo, "docs/delivery/decisions.md")}' 2>/dev/null && echo DECISIONS_WRITTEN
      echo h > '${join(fx.repo, "docs/delivery/handbacks/h.md")}' && echo HANDBACK_OK`);
    assert.equal(r.stdout.trim(), "OK\nHANDBACK_OK", r.stderr);
    if (concurrent) writeFileSync(reg, "req_id,title\nR-1,changed-elsewhere\n");
    const { status, summary } = sb.finish();
    if (concurrent) {
      assert.equal(status, 3);
      assert.match(summary.discarded.join("\n"), /requirements\.csv: changed outside the sandbox during the run/);
      assert.equal(readFileSync(reg, "utf8"), "req_id,title\nR-1,changed-elsewhere\n");
    } else {
      assert.equal(status, 0, summary.discarded.join("; "));
      assert.deepEqual(summary.copied_back, ["docs/delivery/requirements.csv"]);
      assert.equal(readFileSync(reg, "utf8"), "req_id,title\nR-1,b\n");
    }
    assert.equal(readFileSync(join(fx.repo, "docs/delivery/decisions.md"), "utf8"), "decisions\n");
    assert.equal(readFileSync(join(fx.repo, "docs/delivery/handbacks/h.md"), "utf8"), "h\n");
    rmSync(fx.base, { recursive: true, force: true });
  }
});

test("D-030: the auditor's gate record for its own stage is copied back; another stage's is not", () => {
  requireTools();
  const fx = fixture();
  const sb = sandbox(fx, "release-auditor");
  const g = join(fx.repo, "docs/delivery/gates");
  const got = probe(sb, { own: `${g}/DG0.json`, other: `${g}/DG1.json`, record: `${fx.repo}/docs/delivery/reviews/DG0/round-2/release-auditor.json` },
    [`${fx.repo}/docs/delivery/reviews/DG0/round-2`]);
  assert.deepEqual(got, { own: true, other: true, record: true }); // all land in staging copies
  const { status, summary } = sb.finish();
  assert.equal(status, 3);
  assert.deepEqual(summary.copied_back.sort(), ["docs/delivery/gates/DG0.json", "docs/delivery/reviews/DG0/round-2/release-auditor.json"]);
  assert.match(summary.discarded.join("\n"), /gates\/DG1\.json: outside the role's scope/);
  assert.equal(readFileSync(join(g, "DG1.json"), "utf8"), "{}\n");
  rmSync(fx.base, { recursive: true, force: true });
});

// Note: whether a reviewer can run its own nested bwrap (the pre-freeze, the sandbox tests) inside the full stack
// (process sandbox -> Claude Code Bash sandbox -> its bwrap) is verified by the real-agent probe under
// docs/delivery/test-evidence/DG0/orchestrator-probes, not here: a unit test cannot reproduce the CLI's Bash sandbox,
// which supplies the privileged user namespace that the innermost bwrap needs.
test("F-DG0-147: /proc/sys is read-only inside the process sandbox (kernel tunables cannot be changed)", () => {
  requireTools();
  const fx = fixture();
  const sb = sandbox(fx, "domain-reviewer");
  // Read-only check only (test -w), and a same-name self-write attempt whose failure is what we assert.
  const r = sb.run(`for f in /proc/sys/kernel/domainname /proc/sys/vm/drop_caches; do test -w "$f" && echo "WRITABLE $f" || echo "RO $f"; done`);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /WRITABLE/);
  assert.match(r.stdout, /RO \/proc\/sys\/kernel\/domainname/);
  const { summary } = sb.finish();
  assert.equal(summary.procsys_readonly, true);
  assert.equal(summary.procfs, "fresh");
  assert.deepEqual(summary.unshare, []);
  rmSync(fx.base, { recursive: true, force: true });
});
