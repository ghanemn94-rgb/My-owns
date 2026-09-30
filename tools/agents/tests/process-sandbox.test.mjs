// The process sandbox around the whole agent CLI (tools/agents/agent_sandbox.py; D-030, F-DG0-145).
// Run: node --test tools/agents/tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
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
  return { run, finish, runTmp, state, args, env, plan: () => JSON.parse(readFileSync(join(state, "plan.json"), "utf8")) };
}

/** The sandbox args with the per-run Landlock wrapper (…setpriv -- python -I -B landlock_exec.py --) removed: the
 *  pre-D-033 (D-030-only) tail, used as the positive control that the cross-run /proc path is real without it. */
function stripLandlock(args) {
  const i = args.findIndex((x) => typeof x === "string" && x.endsWith("landlock_exec.py"));
  assert.ok(i >= 3 && args[i - 1] === "-B" && args[i - 2] === "-I" && args[i - 4] === "--" && args[args.length - 1] === "--",
    "unexpected Landlock wrapper shape in the sandbox args");
  return args.slice(0, i - 3); // now ends at setpriv's own "--"
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
test("D-030: the process sandbox binds the host procfs and creates no PID namespace (so nested bwrap works)", () => {
  requireTools();
  const fx = fixture();
  const sb = sandbox(fx, "domain-reviewer");
  // /proc shows the host PID namespace (PID 1 is not this sandbox's own init), confirming it is transparent to it.
  const r = sb.run(`readlink /proc/self/exe >/dev/null && echo PROC_OK; head -c 0 /proc/1/cmdline >/dev/null 2>&1 && echo PROC1_VISIBLE`);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /PROC_OK/);
  const { summary } = sb.finish();
  assert.equal(summary.procfs, "host-bind"); // bound host procfs, not a fresh --proc mount (nested bwrap needs it)
  assert.deepEqual(summary.unshare, ["ipc"]); // own IPC namespace (F-DG0-148); no PID namespace of its own
  // /proc/sys read-only where candidate code runs is verified by the sandbox-run suite's fresh-procfs check and, for
  // the full reviewer stack, by the real-agent probe under docs/delivery/test-evidence/DG0/orchestrator-probes.
  rmSync(fx.base, { recursive: true, force: true });
});

test("F-DG0-145 (round 16): a file another run commits to the real dir between prepare and finish is not a false discard", () => {
  requireTools();
  const fx = fixture();
  const sb = sandbox(fx, "code-security-reviewer");
  const staging = sb.plan().staged.find((s) => s.rel === "docs/delivery/reviews/DG0").staging;
  // The reviewer writes its own new record into its staging copy.
  mkdirSync(join(staging, "round-2"), { recursive: true });
  writeFileSync(join(staging, "round-2", "code-security-reviewer.json"), '{"verdict":"PASS"}\n');
  // Meanwhile a concurrently running review commits ITS record to the real reviews dir, AFTER this run's prepare.
  mkdirSync(join(fx.repo, "docs/delivery/reviews/DG0/round-2"), { recursive: true });
  writeFileSync(join(fx.repo, "docs/delivery/reviews/DG0/round-2/domain-reviewer.json"), '{"verdict":"PASS"}\n');
  const { status, summary } = sb.finish();
  // finish() compares against the staging seed, so the concurrently-committed file is neither seen nor mis-flagged.
  assert.deepEqual(summary.discarded, [], summary.discarded.join("; "));
  assert.equal(status, 0);
  assert.deepEqual(summary.copied_back, ["docs/delivery/reviews/DG0/round-2/code-security-reviewer.json"]);
  assert.equal(readFileSync(join(fx.repo, "docs/delivery/reviews/DG0/round-2/domain-reviewer.json"), "utf8"), '{"verdict":"PASS"}\n');
  rmSync(fx.base, { recursive: true, force: true });
});

test("F-DG0-150/238: an own-role file already present in the real tree is a write-once discard, not an unhandled crash", () => {
  requireTools();
  const fx = fixture();
  const sb = sandbox(fx, "code-security-reviewer");
  const staging = sb.plan().staged.find((s) => s.rel === "docs/delivery/reviews/DG0").staging;
  // This run writes its own new record into staging (not in the seed).
  mkdirSync(join(staging, "round-2"), { recursive: true });
  writeFileSync(join(staging, "round-2", "code-security-reviewer.json"), '{"verdict":"PASS"}\n');
  // But another run of the same role committed the SAME path to the real tree after prepare, so the O_EXCL open would
  // hit FileExistsError. finish() must report a write-once discard and keep going, never raise.
  mkdirSync(join(fx.repo, "docs/delivery/reviews/DG0/round-2"), { recursive: true });
  writeFileSync(join(fx.repo, "docs/delivery/reviews/DG0/round-2/code-security-reviewer.json"), '{"verdict":"EARLIER"}\n');
  const { status, summary } = sb.finish();
  assert.equal(status, 3); // discards → non-zero, fail-closed (run-agent turns this into exit 73, no auto-commit)
  assert.deepEqual(summary.copied_back, []);
  assert.match(summary.discarded.join("\n"), /round-2\/code-security-reviewer\.json: already present in the real tree; write-once/);
  assert.equal(readFileSync(join(fx.repo, "docs/delivery/reviews/DG0/round-2/code-security-reviewer.json"), "utf8"), '{"verdict":"EARLIER"}\n'); // untouched
  rmSync(fx.base, { recursive: true, force: true });
});

test("F-DG0-152: a per-run Landlock domain stops a run reaching or signalling another run via /proc/<peer>/root|cwd (D-033)", (t) => {
  requireTools();
  const fx = fixture();
  const victim = sandbox(fx, "qa-verifier");
  const attacker = sandbox(fx, "code-security-reviewer");
  // The victim is a long-lived sandboxed process; it publishes its PID as seen in the shared host PID namespace.
  const vEnv = { ...process.env, HOME: fx.home, TMPDIR: victim.runTmp, MTH_RUN_TMP: victim.runTmp, MTH_GUARD_ROOT: fx.repo };
  const v = spawn("bwrap", [...victim.args, "/bin/sh", "-c", `echo $$ > ${victim.runTmp}/pid; exec sleep 120`],
    { env: vEnv, cwd: "/", stdio: ["ignore", "ignore", "ignore"] });
  try {
    for (let i = 0; i < 200 && !existsSync(join(victim.runTmp, "pid")); i++) spawnSync("sleep", ["0.05"]);
    const vpid = readFileSync(join(victim.runTmp, "pid"), "utf8").trim();
    assert.match(vpid, /^[0-9]+$/, "the victim run never published its pid");
    const qaEv = `${fx.repo}/docs/delivery/test-evidence/DG0/qa`;
    const targets = {
      viaProcRoot: `/proc/${vpid}/root${qaEv}/via-proc-root.txt`, // the peer's own writable evidence dir
      viaProcCwd: `/proc/${vpid}/cwd/docs/delivery/test-evidence/DG0/qa/via-proc-cwd.txt`,
      viaProcRootTmp: `/proc/${vpid}/root${victim.runTmp}/planted.txt`, // the peer's private TMPDIR
      ownEvidence: `${fx.repo}/docs/delivery/test-evidence/DG0/code-security/own.txt`, // must stay writable
      ownTmp: `${attacker.runTmp}/own.txt`, // must stay writable
    };
    const script = [
      ...Object.entries(targets).map(([l, p]) => `if (echo x > '${p}') 2>/dev/null; then echo '${l}:WROTE'; else echo '${l}:refused'; fi`),
      `if kill -0 ${vpid} 2>/dev/null; then echo 'signal:allowed'; else echo 'signal:refused'; fi`,
      // The pre-freeze needs a nested bwrap with a fresh --proc; the scope-only domain must not break it.
      `if bwrap --unshare-user --unshare-pid --ro-bind / / --dev /dev --proc /proc -- /bin/sh -c 'test -r /proc/self/status' 2>/dev/null; then echo 'nested:works'; else echo 'nested:FAILED'; fi`,
    ].join("\n");
    const parse = (out) => Object.fromEntries(out.trim().split("\n").map((l) => { const i = l.indexOf(":"); return [l.slice(0, i), l.slice(i + 1)]; }));
    const cleanup = () => { for (const p of [`${qaEv}/via-proc-root.txt`, `${qaEv}/via-proc-cwd.txt`, `${victim.runTmp}/planted.txt`]) rmSync(p, { force: true }); };

    // Positive control: without the per-run Landlock domain (the D-030-only design) the cross-run path is real.
    const ctl = spawnSync("bwrap", [...stripLandlock(attacker.args), "/bin/sh", "-c", script],
      { env: { ...attacker.env, TMPDIR: attacker.runTmp, MTH_RUN_TMP: attacker.runTmp, MTH_GUARD_ROOT: fx.repo }, encoding: "utf8", cwd: "/", timeout: 240000 });
    assert.equal(ctl.status, 0, ctl.stderr);
    const before = parse(ctl.stdout);
    t.diagnostic(`without Landlock: ${JSON.stringify(before)}`);
    if (before.viaProcRoot !== "WROTE" || before.signal !== "allowed") {
      // The cross-run vector needs the shared host PID namespace and a reachable host /proc. When this suite itself is
      // run nested inside another PID-namespaced sandbox (e.g. the pre-freeze's tools/gates/sandbox-run.sh, which does
      // --unshare-pid with a fresh --proc), a peer run is not reachable through /proc/<pid>/root even WITHOUT Landlock,
      // so the vector cannot be set up and the case cannot prove anything. Skip rather than fail: run-agent.sh applies
      // the process sandbox directly on the host, where the vector is real and this case exercises it when run directly
      // or in CI. This never masks a broken fix -- a fix that failed to enter the domain would keep the vector
      // reproducible here (viaProcRoot WROTE) and be caught by the assertions below.
      t.diagnostic("skipping: cross-run /proc vector not reproducible in this environment (nested PID namespace)");
      t.skip("cross-run /proc vector not reproducible here (nested PID namespace)");
      cleanup();
      return;
    }
    assert.equal(existsSync(`${qaEv}/via-proc-root.txt`), true);
    cleanup();

    // With the per-run Landlock domain (the shipped design): every cross-run write and the signal are refused, the
    // attacker's own areas stay writable, and a nested bwrap with a fresh --proc still works.
    const r = attacker.run(script);
    assert.equal(r.status, 0, r.stderr);
    const after = parse(r.stdout);
    t.diagnostic(`with Landlock: ${JSON.stringify(after)}`);
    assert.equal(after.viaProcRoot, "refused");
    assert.equal(after.viaProcCwd, "refused");
    assert.equal(after.viaProcRootTmp, "refused");
    assert.equal(after.ownEvidence, "WROTE");
    assert.equal(after.ownTmp, "WROTE");
    assert.equal(after.signal, "refused");
    // The nested-bwrap sub-check (a fresh --proc mount) needs the procfs to be "fully visible"; that fails purely from
    // mount depth when this suite is itself run inside another bwrap with an unshared PID namespace (the pre-freeze), and
    // the control shows the same (before.nested !== "works"). Assert Landlock did not break it only when the environment
    // can do it at all without Landlock -- so a real regression (Landlock breaking the nested mount) is still caught.
    if (before.nested === "works") assert.equal(after.nested, "works", "Landlock must not break a nested bwrap with a fresh --proc");
    else t.diagnostic("nested-bwrap sub-check skipped: not supported at this mount depth even without Landlock");
    assert.equal(existsSync(`${qaEv}/via-proc-root.txt`), false);
    assert.equal(existsSync(`${qaEv}/via-proc-cwd.txt`), false);
    assert.equal(existsSync(`${victim.runTmp}/planted.txt`), false);
    // The finish summary records the per-run domain for the validator (rules.mjs).
    const { summary } = attacker.finish();
    assert.equal(summary.landlock.per_run_domain, true);
    assert.deepEqual(summary.landlock.scoped.sort(), ["ABSTRACT_UNIX_SOCKET", "SIGNAL"]);
    assert.equal(summary.landlock.handled_access_fs, 0);
    assert.equal(summary.landlock.handled_access_net, 0);
  } finally {
    v.kill("SIGKILL");
    rmSync(fx.base, { recursive: true, force: true });
  }
});
