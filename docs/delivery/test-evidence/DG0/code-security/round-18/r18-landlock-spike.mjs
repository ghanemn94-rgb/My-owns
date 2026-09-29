// DG0 round 18, code-security-reviewer: mitigation SPIKE for F-DG0-152 (not a fix; implementation stays with the owner).
// Same fixture and REAL agent_sandbox.py args as r18-proc-peer-root-repro.mjs, but each sandboxed process first enters
// its own Landlock domain with a scope-only ruleset (handled_access_fs = 0, scoped = SIGNAL | ABSTRACT_UNIX_SOCKET,
// ABI >= 6) before exec. Checks: (1) the /proc/<peer>/root and /proc/<peer>/cwd writes and a cross-run kill are refused;
// (2) the agent's own areas stay writable; (3) a nested bwrap with a fresh --proc (what the pre-freeze needs) still runs.
// Run: node r18-landlock-spike.mjs <path-to-candidate-clone>
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, cpSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_NOSYSTEM = "1";
process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = "repro";
process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = "repro@example.invalid";

const LL = `import ctypes, os, sys
libc = ctypes.CDLL(None, use_errno=True)
attr = (ctypes.c_uint64 * 3)(0, 0, 0x1 | 0x2)  # handled_access_fs, handled_access_net, scoped (ABSTRACT_UNIX_SOCKET|SIGNAL)
fd = libc.syscall(444, ctypes.byref(attr), ctypes.sizeof(attr), 0)
if fd < 0: sys.exit("landlock_create_ruleset: " + os.strerror(ctypes.get_errno()))
if libc.syscall(446, fd, 0) != 0: sys.exit("landlock_restrict_self: " + os.strerror(ctypes.get_errno()))
os.execv(sys.argv[1], sys.argv[1:])
`;
const clone = process.argv[2];
const base = mkdtempSync(join(process.env.TMPDIR, "r18-ll-"));
const repo = join(base, "repo");
execFileSync("git", ["init", "-q", "-b", "main", repo]);
cpSync(join(clone, "tools", "agents"), join(repo, "tools", "agents"), { recursive: true, filter: (s) => !s.includes("__pycache__") });
writeFileSync(join(repo, "tools/agents/ll.py"), LL);
for (const [rel, c] of Object.entries({ "CLAUDE.md": "rules\n", "docs/delivery/requirements.csv": "req_id\n" })) {
  mkdirSync(dirname(join(repo, rel)), { recursive: true }); writeFileSync(join(repo, rel), c);
}
for (const d of ["docs/delivery/reviews/DG0", "docs/delivery/gates", "tests/qa", "e2e", ...["domain", "code-security", "qa", "audit"].map((k) => `docs/delivery/test-evidence/DG0/${k}`)])
  mkdirSync(join(repo, d), { recursive: true });
execFileSync("git", ["-C", repo, "add", "-A"]); execFileSync("git", ["-C", repo, "commit", "-qm", "fixture", "--allow-empty"]);
const home = join(base, "home"); mkdirSync(join(home, ".claude"), { recursive: true });
const tmpParent = join(base, "var-tmp"); mkdirSync(tmpParent);
const env = { ...process.env, HOME: home };
const py = (...a) => execFileSync("python3", ["-I", "-B", join(repo, "tools/agents/agent_sandbox.py"), ...a], { env, cwd: "/" });
function prep(role) {
  const runTmp = mkdtempSync(join(tmpParent, "mth-run.")); const state = mkdtempSync(join(tmpParent, "mth-state."));
  py("prepare", role, repo, repo, "DG0", runTmp, state, process.execPath);
  return { runTmp, state, args: py("args", state).toString().split("\0").slice(0, -1) };
}
const ll = ["/usr/bin/python3", "-I", "-B", join(repo, "tools/agents/ll.py")];
const victim = prep("qa-verifier"), attacker = prep("code-security-reviewer");
const v = spawn("bwrap", [...victim.args, ...ll, "/bin/sh", "-c", `echo $$ > ${victim.runTmp}/pid; exec sleep 60`],
  { env: { ...env, TMPDIR: victim.runTmp }, cwd: "/", stdio: ["ignore", "ignore", "inherit"] });
for (let i = 0; i < 100 && !existsSync(join(victim.runTmp, "pid")); i++) spawnSync("sleep", ["0.1"]);
const vpid = readFileSync(join(victim.runTmp, "pid"), "utf8").trim();
const qaEv = `${repo}/docs/delivery/test-evidence/DG0/qa`;
const t = {
  "B via /proc/<peer>/root: other reviewer evidence": `/proc/${vpid}/root${qaEv}/via-proc-root.txt`,
  "C via /proc/<peer>/cwd: other reviewer evidence": `/proc/${vpid}/cwd/docs/delivery/test-evidence/DG0/qa/via-proc-cwd.txt`,
  "D via /proc/<peer>/root: other run private TMPDIR": `/proc/${vpid}/root${victim.runTmp}/planted.txt`,
  "own evidence (must stay writable)": `${repo}/docs/delivery/test-evidence/DG0/code-security/own.txt`,
  "own TMPDIR (must stay writable)": `${attacker.runTmp}/own.txt`,
};
const script = [
  ...Object.entries(t).map(([l, p]) => `if (echo x > '${p}') 2>/tmp/e; then echo '${l}: WROTE'; else echo "${l}: refused ($(tail -c 60 /tmp/e))"; fi`),
  `if kill -0 ${vpid} 2>/tmp/e; then echo "cross-run signal (kill -0 peer): allowed"; else echo "cross-run signal (kill -0 peer): refused ($(tail -c 40 /tmp/e))"; fi`,
  `if bwrap --unshare-user --unshare-pid --ro-bind / / --dev /dev --proc /proc -- /bin/sh -c 'test -r /proc/self/status' 2>/tmp/e; then echo "nested bwrap with fresh --proc: works"; else echo "nested bwrap with fresh --proc: FAILED ($(tail -c 80 /tmp/e))"; fi`,
].join("\n");
for (const [label, wrap] of [["WITHOUT landlock (current D-030 design)", []], ["WITH scope-only landlock domain per run", ll]]) {
  const a = spawnSync("bwrap", [...attacker.args, ...wrap, "/bin/sh", "-c", script], { env: { ...env, TMPDIR: attacker.runTmp }, encoding: "utf8", cwd: "/", timeout: 60000 });
  console.log(`--- attacker ${label} (victim is landlocked in its own domain) ---\n${a.stdout.trim()}${a.stderr.trim() ? "\nstderr: " + a.stderr.trim() : ""}`);
}
v.kill("SIGKILL");
rmSync(base, { recursive: true, force: true });
console.log("fixture removed");
