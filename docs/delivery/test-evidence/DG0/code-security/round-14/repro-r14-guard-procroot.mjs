// Write-guard probe (code-security-reviewer, DG0 round 14): can a scratch symlink to /proc/<pid>/root/tmp reach the
// PRIVATE tmpfs of another mount namespace (e.g. sandbox-run.sh's clone), and does guard-write.mjs decide() allow it?
// Uses only this script's own child sandbox and a disposable clone of the candidate (argv[2]).
//   usage: node repro-r14-guard-procroot.mjs <clone-of-candidate>
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, symlinkSync, writeFileSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const clone = process.argv[2];
process.env.MTH_GUARD_ROOT = clone;
const { decide } = await import(join(clone, "tools/agents/guard-write.mjs"));
const scopes = JSON.parse(readFileSync(join(clone, "tools/agents/write-scopes.json"), "utf8"));
// Victim: a bwrap with a private tmpfs /tmp holding a "clone" file, like sandbox-run.sh; it prints the file after 3 s.
const victim = spawn("bwrap", ["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--tmpfs", "/tmp", "--die-with-parent", "--",
  "bash", "-c", "mkdir -p /tmp/repo && echo ORIGINAL > /tmp/repo/check.txt && sleep 3 && echo \"victim sees: $(cat /tmp/repo/check.txt)\""], { stdio: ["ignore", "inherit", "inherit"] });
await new Promise((r) => setTimeout(r, 800));
// Find the victim's innermost bash (its root is the private namespace).
const pids = execFileSync("sh", ["-c", `pgrep -P ${victim.pid}; for p in $(pgrep -P ${victim.pid}); do pgrep -P $p; done`]).toString().trim().split(/\s+/).filter(Boolean);
const target = pids[pids.length - 1];
console.log(`victim bwrap pid ${victim.pid}, sandboxed pid ${target}`);
const W = mkdtempSync(join(tmpdir(), "r14-procroot-"));
const link = join(W, "l");
symlinkSync(`/proc/${target}/root/tmp`, link);
const path = join(link, "repo", "check.txt");
let real; try { real = realpathSync(path); } catch (e) { real = `realpath error ${e.code}`; }
console.log(`attacker path ${path}\n  realpathSync -> ${real}`);
for (const role of ["domain-reviewer", "transformation-analyst", "backend-workflow-engineer"]) {
  const v = decide(scopes, role, path);
  console.log(`  guard decide(${role}) -> allow=${v.allow} (${v.reason})`);
}
try { writeFileSync(path, "SWAPPED-BY-ATTACKER\n"); console.log("  write through the magic link: succeeded"); } catch (e) { console.log(`  write through the magic link: ${e.code}`); }
await new Promise((r) => victim.on("exit", r));
rmSync(W, { recursive: true, force: true });
