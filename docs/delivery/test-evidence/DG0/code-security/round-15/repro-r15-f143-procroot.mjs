// F-DG0-143 re-verification (code-security-reviewer, DG0 round 15).
// Runs the round-14 construction (scratch symlink -> /proc/<pid>/root/tmp of a private-tmpfs bubblewrap child) against
// the guard of a given clone, plus further static bypass attempts on canonicalPath(). Everything happens inside this
// run's own $TMPDIR and this script's own child sandbox; no other agent's files are touched.
//   usage: MTH_RUN_TMP=<scratch> node repro-r15-f143-procroot.mjs <clone-of-commit>
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
const clone = process.argv[2];
process.env.MTH_GUARD_ROOT = clone;
const scratch = process.env.MTH_RUN_TMP || process.env.TMPDIR;
const { decide } = await import(join(clone, "tools/agents/guard-write.mjs"));
const scopes = JSON.parse(readFileSync(join(clone, "tools/agents/write-scopes.json"), "utf8"));
console.log(`guard of ${execFileSync("git", ["-C", clone, "rev-parse", "HEAD"]).toString().trim()}; scratch ${scratch}`);
const victim = spawn("bwrap", ["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--tmpfs", "/tmp", "--die-with-parent", "--",
  "bash", "-c", "mkdir -p /tmp/repo && echo ORIGINAL > /tmp/repo/check.txt && sleep 3 && echo \"victim sees: $(cat /tmp/repo/check.txt)\""], { stdio: ["ignore", "inherit", "inherit"] });
await new Promise((r) => setTimeout(r, 800));
const pids = execFileSync("sh", ["-c", `pgrep -P ${victim.pid}; for p in $(pgrep -P ${victim.pid}); do pgrep -P $p; done`]).toString().trim().split(/\s+/).filter(Boolean);
const target = pids[pids.length - 1];
const W = mkdtempSync(join(scratch, "r15-procroot-"));
const cases = [];
const link = (name, to) => { symlinkSync(to, join(W, name)); return join(W, name); };
cases.push(["A symlink -> /proc/<victim>/root/tmp (round-14 case)", join(link("l", `/proc/${target}/root/tmp`), "repo", "check.txt")]);
cases.push(["B relative symlink ../../../..(to /)proc/<victim>/root", join(link("rel", "../".repeat(12) + `proc/${target}/root/tmp`), "repo", "check.txt")]);
mkdirSync(join(W, "d"));
cases.push(["C two-hop chain: l2 -> l3 -> /proc/self/cwd", join(W, "l2", "x.txt")]);
symlinkSync(join(W, "l3"), join(W, "l2")); symlinkSync("/proc/self/cwd", join(W, "l3"));
cases.push(["D symlink -> /dev/shm", join(link("shm", "/dev/shm"), "x.txt")]);
cases.push(["E symlink loop", join(link("loop1", join(W, "loop2")), "x.txt")]); symlinkSync(join(W, "loop1"), join(W, "loop2"));
cases.push(["F dangling symlink (target missing)", link("dangle", join(W, "nope", "deeper"))]);
cases.push(["G benign: plain file in scratch", join(W, "d", "ok.txt")]);
cases.push(["H benign: symlink -> scratch dir", join(link("good", join(W, "d")), "ok2.txt")]);
cases.push(["I direct /proc/<victim>/root/tmp path", `/proc/${target}/root/tmp/repo/check.txt`]);
for (const [label, p] of cases) {
  for (const role of ["code-security-reviewer", "backend-workflow-engineer"]) {
    const v = decide(scopes, role, p);
    console.log(`${label} :: decide(${role}) -> allow=${v.allow} (${v.reason})`);
  }
}
const v = decide(scopes, "code-security-reviewer", cases[0][1]);
if (v.allow) { writeFileSync(cases[0][1], "SWAPPED-BY-ATTACKER\n"); console.log("case A allowed -> wrote through the magic link"); }
else console.log("case A blocked -> no write attempted");
await new Promise((r) => victim.on("exit", r));
rmSync(W, { recursive: true, force: true });
