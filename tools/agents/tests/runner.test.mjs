// run-agent.sh end to end with a stub `claude`: the runner never imports agent-planted modules (F-DG0-140).
// Run: node --test tools/agents/tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
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

// A stand-in for the Claude CLI: emits the stream-json lines a real run produces (init, replayed prompt, result).
const STUB = `#!/usr/bin/env node
const args = process.argv.slice(2);
const sid = args[args.indexOf("--session-id") + 1] || args[args.indexOf("--resume") + 1];
const model = args[args.indexOf("--model") + 1];
// Files the "agent" leaves behind (set by a test): [[path, content]], [[path, null, symlinkTarget]] or [[path, null]]
// (delete).
const fs = require("node:fs");
for (const [p, content, target] of JSON.parse(process.env.STUB_WRITE || "[]")) {
  if (target !== undefined) fs.symlinkSync(target, p);
  else if (content === null) fs.rmSync(p);
  else fs.writeFileSync(p, content);
}
if (process.env.STUB_ENV_OUT) {
  const tmp = process.env.MTH_RUN_TMP || "";
  fs.writeFileSync(process.env.STUB_ENV_OUT, JSON.stringify({ TMPDIR: process.env.TMPDIR, MTH_RUN_TMP: tmp,
    existed: tmp !== "" && fs.existsSync(tmp), mode: tmp && fs.existsSync(tmp) ? (fs.statSync(tmp).mode & 0o777) : null }));
}
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  const prompt = JSON.parse(input.split("\\n")[0]).message.content;
  const out = [
    { type: "system", subtype: "init", session_id: sid, model, tools: ["Read", "Bash", "Write"] },
    { type: "user", isReplay: true, message: { role: "user", content: prompt }, session_id: sid },
    { type: "result", subtype: "success", is_error: false, session_id: sid, result: "done", num_turns: 1 },
  ];
  process.stdout.write(out.map((o) => JSON.stringify(o)).join("\\n") + "\\n");
});
`;

test("F-DG0-140: modules planted in the repository root are never imported by the runner's helpers", (t) => {
  if (spawnSync("sh", ["-c", "command -v bwrap"]).status !== 0) assert.fail("bwrap is required by run-agent.sh (D-025)");
  const repo = mkdtempSync(join(tmpdir(), "runner-"));
  const marker = join(mkdtempSync(join(tmpdir(), "marker-")), "PWNED");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  cpSync(join(real, "tools", "agents"), join(repo, "tools", "agents"), { recursive: true, filter: (s) => !s.includes("__pycache__") });
  mkdirSync(join(repo, ".claude", "agents"), { recursive: true });
  cpSync(join(real, ".claude", "agents", "domain-reviewer.md"), join(repo, ".claude", "agents", "domain-reviewer.md"));
  mkdirSync(join(repo, "docs", "delivery", "assignments", "DG0"), { recursive: true });
  writeFileSync(join(repo, "docs", "delivery", "assignments", "DG0", "T.md"), "assignment\n");
  execFileSync("git", ["-C", repo, "add", "-A"]);
  execFileSync("git", ["-C", repo, "commit", "-qm", "c"]);
  // What a sandboxed agent could leave in the writable repository root.
  for (const mod of ["json", "uuid", "subprocess", "gzip", "hashlib", "glob", "tempfile"]) {
    writeFileSync(join(repo, `${mod}.py`), `open(${JSON.stringify(marker)}, "a").write("${mod}\\n")\nraise SystemExit(0)\n`);
  }
  const bin = mkdtempSync(join(tmpdir(), "stubbin-"));
  writeFileSync(join(bin, "claude"), STUB);
  chmodSync(join(bin, "claude"), 0o755);
  const res = spawnSync(join(repo, "tools", "agents", "run-agent.sh"),
    ["--role", "domain-reviewer", "--stage", "DG0", "--task", "T-STUB", "--assignment", join(repo, "docs/delivery/assignments/DG0/T.md")],
    { cwd: repo, env: { ...process.env, MTH_RUN_TMP_PARENT: tmpdir(), PATH: `${bin}:${process.env.PATH}` }, encoding: "utf8" });
  const imported = existsSync(marker) ? readFileSync(marker, "utf8") : "";
  assert.equal(imported, "", `runner imported planted modules: ${imported}`);
  assert.equal(res.status, 0, res.stderr);
  const runs = readdirSync(join(repo, "docs", "delivery", "runs", "DG0"));
  assert.equal(runs.length, 1);
  const meta = JSON.parse(readFileSync(join(repo, "docs", "delivery", "runs", "DG0", runs[0], "meta.json"), "utf8"));
  assert.equal(meta.exit_code, 0);
  assert.equal(meta.bash_sandbox, true);
  rmSync(repo, { recursive: true, force: true });
  rmSync(bin, { recursive: true, force: true });
});

// D-026: the config scan skips the sandbox's zero-length, untracked mount stubs, and nothing else.
function stubRepo() {
  const repo = mkdtempSync(join(tmpdir(), "runner-"));
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  cpSync(join(real, "tools", "agents"), join(repo, "tools", "agents"), { recursive: true, filter: (s) => !s.includes("__pycache__") });
  mkdirSync(join(repo, ".claude", "agents"), { recursive: true });
  cpSync(join(real, ".claude", "agents", "domain-reviewer.md"), join(repo, ".claude", "agents", "domain-reviewer.md"));
  mkdirSync(join(repo, "docs", "delivery", "assignments", "DG0"), { recursive: true });
  writeFileSync(join(repo, "docs", "delivery", "assignments", "DG0", "T.md"), "assignment\n");
  writeFileSync(join(repo, "CLAUDE.md"), "project rules\n");
  execFileSync("git", ["-C", repo, "add", "-A"]);
  execFileSync("git", ["-C", repo, "commit", "-qm", "c"]);
  return repo;
}
function runWith(repo, writes, extraEnv = {}) {
  const bin = mkdtempSync(join(tmpdir(), "stubbin-"));
  writeFileSync(join(bin, "claude"), STUB);
  chmodSync(join(bin, "claude"), 0o755);
  const res = spawnSync(join(repo, "tools", "agents", "run-agent.sh"),
    ["--role", "domain-reviewer", "--stage", "DG0", "--task", "T-STUB", "--assignment", join(repo, "docs/delivery/assignments/DG0/T.md")],
    { cwd: repo, env: { ...process.env, MTH_RUN_TMP_PARENT: tmpdir(), PATH: `${bin}:${process.env.PATH}`, STUB_WRITE: JSON.stringify(writes), ...extraEnv }, encoding: "utf8" });
  rmSync(bin, { recursive: true, force: true });
  const runs = readdirSync(join(repo, "docs", "delivery", "runs", "DG0"));
  assert.equal(runs.length, 1);
  const meta = JSON.parse(readFileSync(join(repo, "docs", "delivery", "runs", "DG0", runs[0], "meta.json"), "utf8"));
  return { res, changed: meta.external_config_changed.map((l) => l.split(" ")[0].slice(repo.length + 1)) };
}

test("D-026: zero-length untracked sandbox stubs are not reported as configuration changes", () => {
  if (spawnSync("sh", ["-c", "command -v bwrap"]).status !== 0) assert.fail("bwrap is required by run-agent.sh (D-025)");
  const repo = stubRepo();
  mkdirSync(join(repo, "sub"));
  const { res, changed } = runWith(repo, [[join(repo, ".mcp.json"), ""], [join(repo, "CLAUDE.local.md"), ""], [join(repo, "sub", ".gitignore"), ""]]);
  assert.deepEqual(changed, []);
  assert.equal(res.status, 0, res.stderr);
  rmSync(repo, { recursive: true, force: true });
});

test("D-026: configuration with content, a symlink, or a truncated tracked file is still reported (exit 71, no auto-commit)", () => {
  if (spawnSync("sh", ["-c", "command -v bwrap"]).status !== 0) assert.fail("bwrap is required by run-agent.sh (D-025)");
  const repo = stubRepo();
  const target = join(mkdtempSync(join(tmpdir(), "cfg-")), "empty");
  writeFileSync(target, "");
  const { res, changed } = runWith(repo, [
    [join(repo, ".mcp.json"), '{"mcpServers":{}}'], // untracked, with content
    [join(repo, "CLAUDE.local.md"), null, target], // a symlink, even to an empty file
    [join(repo, "CLAUDE.md"), ""], // a tracked file truncated to zero length
  ]);
  assert.deepEqual(changed.sort(), [".mcp.json", "CLAUDE.local.md", "CLAUDE.md"]);
  assert.equal(res.status, 71, res.stderr);
  assert.match(execFileSync("git", ["-C", repo, "log", "--oneline"]).toString().trim(), /^\w+ c$/); // nothing auto-committed
  rmSync(repo, { recursive: true, force: true });
});

test("F-DG0-012/F-DG0-234: an untracked or ignored configuration file that is deleted or truncated to zero length is reported as removed", () => {
  if (spawnSync("sh", ["-c", "command -v bwrap"]).status !== 0) assert.fail("bwrap is required by run-agent.sh (D-025)");
  const repo = stubRepo();
  mkdirSync(join(repo, "sub"));
  writeFileSync(join(repo, ".git", "info", "exclude"), "settings.local.json\n"); // ignored (the exclude file is unchanged by the run)
  // Before the run: untracked or ignored configuration with content.
  writeFileSync(join(repo, ".mcp.json"), '{"mcpServers":{}}');
  writeFileSync(join(repo, "sub", "CLAUDE.local.md"), "local rules\n");
  writeFileSync(join(repo, ".claude", "settings.local.json"), '{"permissions":{"deny":["Bash"]}}');
  writeFileSync(join(repo, "sub", ".gitignore"), "*.tmp\n");
  const { res, changed } = runWith(repo, [
    [join(repo, ".mcp.json"), null], // deleted
    [join(repo, "sub", "CLAUDE.local.md"), ""], // truncated
    [join(repo, ".claude", "settings.local.json"), ""], // ignored, truncated
    [join(repo, "sub", ".gitignore"), null], // deleted
  ]);
  assert.deepEqual(changed.sort(), [".claude/settings.local.json", ".mcp.json", "sub/.gitignore", "sub/CLAUDE.local.md"]);
  const meta = JSON.parse(readFileSync(join(repo, "docs", "delivery", "runs", "DG0",
    readdirSync(join(repo, "docs", "delivery", "runs", "DG0"))[0], "meta.json"), "utf8"));
  assert.ok(meta.external_config_changed.every((l) => l.endsWith(" removed")), meta.external_config_changed.join("; "));
  assert.equal(res.status, 71, res.stderr);
  rmSync(repo, { recursive: true, force: true });
});

test("F-DG0-144: every run gets its own private TMPDIR, exported to the agent and removed when the run ends", () => {
  if (spawnSync("sh", ["-c", "command -v bwrap"]).status !== 0) assert.fail("bwrap is required by run-agent.sh (D-025)");
  const seen = [];
  for (let i = 0; i < 2; i++) {
    const repo = stubRepo();
    const envOut = join(mkdtempSync(join(tmpdir(), "stubenv-")), "env.json");
    const { res } = runWith(repo, [], { STUB_ENV_OUT: envOut });
    assert.equal(res.status, 0, res.stderr);
    const env = JSON.parse(readFileSync(envOut, "utf8"));
    assert.equal(env.TMPDIR, env.MTH_RUN_TMP);
    assert.match(env.MTH_RUN_TMP, /\/mth-run\.[A-Za-z0-9]{6}$/);
    assert.ok(env.MTH_RUN_TMP.startsWith(tmpdir() + "/"), env.MTH_RUN_TMP);
    assert.equal(env.existed, true);
    assert.equal(env.mode, 0o700);
    assert.equal(existsSync(env.MTH_RUN_TMP), false, "the private TMPDIR must be removed after the run");
    seen.push(env.MTH_RUN_TMP);
    rmSync(repo, { recursive: true, force: true });
  }
  assert.notEqual(seen[0], seen[1]);
});

test("F-DG0-236: the runner pre-creates the stage's evidence directories and the gate-record directory", () => {
  if (spawnSync("sh", ["-c", "command -v bwrap"]).status !== 0) assert.fail("bwrap is required by run-agent.sh (D-025)");
  const repo = stubRepo();
  const { res } = runWith(repo, []);
  assert.equal(res.status, 0, res.stderr);
  for (const rel of ["docs/delivery/gates", ...["domain", "code-security", "qa", "audit"].map((k) => `docs/delivery/test-evidence/DG0/${k}`)]) {
    assert.ok(statSync(join(repo, rel)).isDirectory(), `${rel} must exist as a directory`);
  }
  rmSync(repo, { recursive: true, force: true });
});
