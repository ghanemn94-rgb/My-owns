// tools/gates/sandbox-run.sh: the orchestrator runs candidate code only in a sandboxed fresh clone (F-DG0-140/229).
// Run: node --test tools/gates/tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// Hermetic git: fixtures must not depend on the host's global or system git config (e.g. mandatory commit signing).
process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_NOSYSTEM = "1";
process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = "gate-test";
process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = "gate-test@example.invalid";

const here = dirname(fileURLToPath(import.meta.url));
const hasBwrap = spawnSync("sh", ["-c", "command -v bwrap"]).status === 0;

function fixture() {
  const repo = mkdtempSync(join(tmpdir(), "sbxrun-"));
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  mkdirSync(join(repo, "tools", "gates"), { recursive: true });
  cpSync(join(here, "..", "sandbox-run.sh"), join(repo, "tools", "gates", "sandbox-run.sh"));
  writeFileSync(join(repo, ".gitignore"), "*.pyc\nplanted.py\n");
  writeFileSync(join(repo, "committed.txt"), "committed\n");
  execFileSync("git", ["-C", repo, "add", "-A"]);
  execFileSync("git", ["-C", repo, "commit", "-qm", "c"]);
  return repo;
}
const run = (repo, cmd) => spawnSync(join(repo, "tools", "gates", "sandbox-run.sh"), ["HEAD", "--", "bash", "-c", cmd], { encoding: "utf8" });

test("sandbox-run: requires bubblewrap (a missing sandbox is a failure, not a pass)", { skip: false }, () => {
  assert.ok(hasBwrap, "bwrap is not installed; the sandboxed checks cannot run (BLOCKED, see docs/delivery/environment.md)");
});

test("F-DG0-229: ignored or untracked files in the working tree never reach the sandboxed clone", () => {
  const repo = fixture();
  writeFileSync(join(repo, "planted.py"), "open('/tmp/pwned','w')\n");
  writeFileSync(join(repo, "untracked.txt"), "x\n");
  const r = run(repo, "ls -a; cat committed.txt");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /committed/);
  assert.doesNotMatch(r.stdout, /planted\.py|untracked\.txt/);
  rmSync(repo, { recursive: true, force: true });
});

test("F-DG0-140: inside the sandbox the source repository is read-only, there is no network, and cwd is not on sys.path", () => {
  const repo = fixture();
  const r = run(repo, `echo x > ${repo}/escape.txt; echo rc_repo=$?; echo y > inclone.txt; echo rc_clone=$?; ` +
    `python3 -c "import socket; socket.create_connection(('1.1.1.1', 53), 2)" 2>/dev/null; echo rc_net=$?; ` +
    `echo 'raise SystemExit(99)' > json.py; python3 -c "import json; print('stdlib-json')"; echo rc_py=$?`);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /rc_repo=1/);
  assert.match(r.stdout, /rc_clone=0/);
  assert.doesNotMatch(r.stdout, /rc_net=0/);
  assert.match(r.stdout, /stdlib-json/);
  assert.ok(!existsSync(join(repo, "escape.txt")));
  rmSync(repo, { recursive: true, force: true });
});

test("sandbox-run: the command's exit status is returned", () => {
  const repo = fixture();
  assert.equal(run(repo, "exit 7").status, 7);
  rmSync(repo, { recursive: true, force: true });
});

test("F-DG0-141: the clone, checkout and command run inside the sandbox, in a work area no other process can see", async () => {
  // A concurrently running agent can write $TMPDIR and /tmp (shell sandbox and file tools). If the work clone lived
  // there, it could plant a git filter or hook before the checkout, or change files while they are checked.
  const repo = fixture();
  const tag = `mth-private-${process.pid}-${Date.now()}`;
  const child = spawn(join(repo, "tools", "gates", "sandbox-run.sh"), ["HEAD", "--", "bash", "-c", `touch ${tag}; pwd; echo READY; sleep 3`],
    { stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
  const ready = new Promise((resolve) => child.stdout.on("data", (d) => { out += d; if (out.includes("READY")) resolve(); }));
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`sandbox-run did not start within 120s: ${out}`)); }, 120000); });
  await Promise.race([ready, deadline, exited.then(() => { throw new Error(`sandbox-run exited before READY: ${out}`); })]);
  clearTimeout(timer);
  const roots = [...new Set([tmpdir(), "/tmp", "/var/tmp"])];
  const found = spawnSync("find", [...roots, "-name", tag], { encoding: "utf8" }).stdout.trim();
  const code = await exited;
  assert.equal(found, "", `the sandbox's work clone is visible outside the sandbox: ${found}`);
  assert.equal(code, 0);
  rmSync(repo, { recursive: true, force: true });
});

test("D-030: sandbox-run works inside an agent's process sandbox (a reviewer running the pre-freeze)", () => {
  assert.ok(hasBwrap, "bwrap is not installed");
  // Build the process sandbox the runner gives an agent (tools/agents/agent_sandbox.py) around this fixture, then run
  // sandbox-run.sh inside it. A fresh procfs cannot be mounted there, so sandbox-run binds the enclosing one.
  const repo = fixture();
  const py = join(here, "..", "..", "agents", "agent_sandbox.py");
  const tmp = mkdtempSync(join(tmpdir(), "psb-"));
  const runTmp = mkdtempSync(join(tmp, "mth-run.")), state = mkdtempSync(join(tmp, "mth-state."));
  execFileSync("python3", ["-I", "-B", py, "prepare", "backend-workflow-engineer", repo, repo, "DG0", runTmp, state, "/bin/sh"], { cwd: "/" });
  const args = execFileSync("python3", ["-I", "-B", py, "args", state], { cwd: "/" }).toString().split("\0").slice(0, -1);
  const r = spawnSync("bwrap", [...args, join(repo, "tools/gates/sandbox-run.sh"), "HEAD", "--", "bash", "-c", "cat committed.txt; echo rc_net=$(python3 -c \"import socket; socket.create_connection(('1.1.1.1', 53), 2)\" 2>/dev/null; echo $?)"],
    { encoding: "utf8", cwd: "/", timeout: 120000, env: { ...process.env, TMPDIR: runTmp } });
  assert.equal(r.status, 0, `${r.stderr} ${r.error || ""}`);
  assert.match(r.stdout, /committed/);
  assert.doesNotMatch(r.stdout, /rc_net=0/);
  rmSync(repo, { recursive: true, force: true });
  rmSync(tmp, { recursive: true, force: true });
});
