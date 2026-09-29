// Round-17 code-security reproduction (disposable; run from a clone under $TMPDIR, never the candidate tree).
// Usage: node r17-copyback-ipc-repro.mjs <path to tools/agents dir of the commit under test>
// Checks the D-031 copy-back seed fix, --unshare-ipc (F-DG0-148), copy-back scope, and F-DG0-147 (backdated round).
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_NOSYSTEM = "1";
process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = "repro";
process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = "repro@example.invalid";
const agentsDir = process.argv[2];

function fixture() {
  const base = mkdtempSync(join(tmpdir(), "r17-"));
  const repo = join(base, "repo");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  cpSync(agentsDir, join(repo, "tools", "agents"), { recursive: true, filter: (s) => !s.includes("__pycache__") });
  const files = {
    "CLAUDE.md": "rules\n", "docs/source/s.md": "s\n", "tools/gates/t.mjs": "//\n",
    "docs/delivery/reviews/DG0/round-1/domain-reviewer.json": "{\"verdict\":\"PASS\"}\n",
    "docs/delivery/reviews/DG0/round-1/code-security-reviewer.json": "{\"verdict\":\"FAIL\"}\n",
    "docs/delivery/gates/DG1.json": "{}\n",
  };
  for (const [rel, c] of Object.entries(files)) { mkdirSync(dirname(join(repo, rel)), { recursive: true }); writeFileSync(join(repo, rel), c); }
  for (const d of ["docs/delivery/runs/DG0", "docs/delivery/handbacks", "tests/qa", "e2e", ...["domain", "code-security", "qa", "audit"].map((k) => `docs/delivery/test-evidence/DG0/${k}`)])
    mkdirSync(join(repo, d), { recursive: true });
  execFileSync("git", ["-C", repo, "add", "-A"]);
  execFileSync("git", ["-C", repo, "commit", "-qm", "fixture"]);
  const home = join(base, "home");
  mkdirSync(join(home, ".claude"), { recursive: true });
  const tmpParent = join(base, "var-tmp");
  mkdirSync(tmpParent);
  return { base, repo, home, tmpParent };
}

function sandbox(fx, role) {
  const runTmp = mkdtempSync(join(fx.tmpParent, "mth-run."));
  const state = mkdtempSync(join(fx.tmpParent, "mth-state."));
  const env = { ...process.env, HOME: fx.home };
  const py = (...a) => execFileSync("python3", ["-I", "-B", join(fx.repo, "tools/agents/agent_sandbox.py"), ...a], { env, cwd: "/" });
  py("prepare", role, fx.repo, fx.repo, "DG0", runTmp, state, process.execPath);
  const args = py("args", state).toString().split("\0").filter((x, i, a) => i < a.length - 1);
  const run = (cmd) => spawnSync("bwrap", [...args, "/bin/sh", "-c", cmd], { env: { ...env, TMPDIR: runTmp }, encoding: "utf8", cwd: "/", timeout: 120000 });
  const finish = () => {
    const out = mkdtempSync(join(fx.base, "out-"));
    const r = spawnSync("python3", ["-I", "-B", join(fx.repo, "tools/agents/agent_sandbox.py"), "finish", state, out], { env, cwd: "/", encoding: "utf8" });
    const p = join(out, "sandbox.json");
    return { status: r.status, stderr: r.stderr.trim().split("\n").slice(-2).join(" | "), summary: existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null };
  };
  const plan = JSON.parse(readFileSync(join(state, "plan.json"), "utf8"));
  const staging = plan.staged.find((s) => s.rel === "docs/delivery/reviews/DG0").staging;
  return { args, run, finish, staging };
}

const show = (label, r) => console.log(`${label}: exit=${r.status} copied_back=${JSON.stringify(r.summary?.copied_back)} discarded=${JSON.stringify(r.summary?.discarded)} unshare=${JSON.stringify(r.summary?.unshare)}${r.status && !r.summary ? " stderr=" + r.stderr : ""}`);

// A. IPC namespace (F-DG0-148): compare the sandbox's ipc namespace with the host's (read-only readlink).
{
  const fx = fixture(); const sb = sandbox(fx, "code-security-reviewer");
  const host = readlinkSync("/proc/self/ns/ipc");
  const r = sb.run("readlink /proc/self/ns/ipc");
  console.log(`A ipc: bwrap has --unshare-ipc=${sb.args.includes("--unshare-ipc")} host=${host} sandbox=${r.stdout.trim()} private=${r.stdout.trim() !== host && r.status === 0}`);
  show("A finish", sb.finish());
  rmSync(fx.base, { recursive: true, force: true });
}
// B. D-031: another review commits its record to the REAL dir between prepare and finish (round-16 false positive).
{
  const fx = fixture(); const sb = sandbox(fx, "code-security-reviewer");
  mkdirSync(join(sb.staging, "round-2"), { recursive: true });
  writeFileSync(join(sb.staging, "round-2/code-security-reviewer.json"), "{\"verdict\":\"PASS\"}\n");
  mkdirSync(join(fx.repo, "docs/delivery/reviews/DG0/round-2"), { recursive: true });
  writeFileSync(join(fx.repo, "docs/delivery/reviews/DG0/round-2/domain-reviewer.json"), "{\"verdict\":\"PASS\"}\n");
  show("B concurrent commit by another role", sb.finish());
  rmSync(fx.base, { recursive: true, force: true });
}
// C. Scope still enforced by the new seed logic: modified seeded file, deleted seeded file, other role, symlink, top-level.
{
  const fx = fixture(); const sb = sandbox(fx, "code-security-reviewer");
  writeFileSync(join(sb.staging, "round-1/code-security-reviewer.json"), "{\"verdict\":\"PASS\"}\n"); // rewrite own old record
  unlinkSync(join(sb.staging, "round-1/domain-reviewer.json")); // delete another role's record in staging
  mkdirSync(join(sb.staging, "round-2"), { recursive: true });
  writeFileSync(join(sb.staging, "round-2/domain-reviewer.json"), "{\"verdict\":\"PASS\"}\n"); // forge another role
  symlinkSync("/etc/passwd", join(sb.staging, "round-2/code-security-reviewer.link"));
  writeFileSync(join(sb.staging, "top.json"), "{}\n");
  const r = sb.finish(); show("C scope", r);
  console.log(`C real round-1/code-security-reviewer.json unchanged=${readFileSync(join(fx.repo, "docs/delivery/reviews/DG0/round-1/code-security-reviewer.json"), "utf8").includes("FAIL")} real domain-reviewer kept=${existsSync(join(fx.repo, "docs/delivery/reviews/DG0/round-1/domain-reviewer.json"))} forged absent=${!existsSync(join(fx.repo, "docs/delivery/reviews/DG0/round-2/domain-reviewer.json"))}`);
  rmSync(fx.base, { recursive: true, force: true });
}
// D. The SAME own path is created in the real dir by another run during this run (fail-closed?).
{
  const fx = fixture(); const sb = sandbox(fx, "code-security-reviewer");
  mkdirSync(join(sb.staging, "round-2"), { recursive: true });
  writeFileSync(join(sb.staging, "round-2/code-security-reviewer.json"), "{\"mine\":1}\n");
  mkdirSync(join(fx.repo, "docs/delivery/reviews/DG0/round-2"), { recursive: true });
  writeFileSync(join(fx.repo, "docs/delivery/reviews/DG0/round-2/code-security-reviewer.json"), "{\"theirs\":1}\n");
  const r = sb.finish(); show("D same-path collision", r);
  console.log(`D real file content=${readFileSync(join(fx.repo, "docs/delivery/reviews/DG0/round-2/code-security-reviewer.json"), "utf8").trim()}`);
  rmSync(fx.base, { recursive: true, force: true });
}
// E. F-DG0-147: a new own-role file in an EARLIER round directory.
{
  const fx = fixture(); const sb = sandbox(fx, "code-security-reviewer");
  writeFileSync(join(sb.staging, "round-1/code-security-reviewer.backdated.json"), "{}\n");
  show("E backdated own-role file (F-DG0-147)", sb.finish());
  rmSync(fx.base, { recursive: true, force: true });
}
