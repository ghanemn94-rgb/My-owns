// qa-verifier, DG0 round 18: the independent 94-case round-9 A24/A25 gate suite, re-shaped for the CURRENT evidence rules
// (D-026/D-027 via the round-14 swaps, plus D-030: every fixture run carries a process-sandbox sandbox.json whose hash is
// in meta.process_sandbox_sha256). Author: qa-verifier (T-DG0-REV-QA-R18). Node built-ins only; disposable fixtures.
// Run: QA_REPO_ROOT=<clone of the candidate> node --test <this file>   (needs dg0-gate-negative-r9.test.mjs next to it)
//
//   QA18-G0   control: the D-030-shaped fixture validates cleanly (zero errors)
//   QA18-G1   the round-9 suite (every A24/A25 negative in the assignment: missing reviewer, author-reviewer, shared
//             invocation, failed/blocked check, unresolved High, incomplete requirement, bad anchor, SOURCE without block,
//             coverage gaps, change after freeze, tampered manifest, metadata invariance, ...) passes under the current
//             rules, except the 3 one-field cwd controls that must fail only on cwd binding (as in QA14-REG) and
//             QA7-N83, a static runner-text check superseded by the D-030 bwrap wrapper (re-asserted by QA18-G6)
//   QA18-G6   runner invocation properties of QA7-N83 in the D-030 form
//   QA18-G2   D-030: a fixture run whose sandbox.json records a discard is rejected
//   QA18-G3   D-030: a sandbox.json that doesn't match meta.process_sandbox_sha256 is rejected
//   QA18-G4   D-030: a qa-verifier run whose sandbox made another reviewer's evidence directory writable is rejected
//   QA18-G5   D-030/D-031: a sandbox.json without the IPC namespace ('unshare': []) or with procfs other than host-bind
//             is rejected
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

Object.assign(process.env, { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "qa18", GIT_COMMITTER_NAME: "qa18",
  GIT_AUTHOR_EMAIL: "qa18@example.invalid", GIT_COMMITTER_EMAIL: "qa18@example.invalid" });
const here = dirname(fileURLToPath(import.meta.url));
if (!process.env.QA_REPO_ROOT) process.env.QA_REPO_ROOT = execFileSync("git", ["-C", here, "rev-parse", "--show-toplevel"]).toString().trim();
process.env.QA_REPO_ROOT = resolve(process.env.QA_REPO_ROOT);
const noTestCtx = () => { const e = { ...process.env }; delete e.NODE_TEST_CONTEXT; return e; };

const PROTECTED7 = [".git", ".claude", "tools/gates", "tools/agents", "docs/source", "docs/delivery/reviews", "docs/delivery/runs"];
const QA = `role === "qa-verifier"`;
const envOr = (name, dflt) => `((process.env.${name} !== undefined && ${QA}) ? process.env.${name} : ${JSON.stringify(dflt)})`;
// The process-sandbox record the validator expects for a confined review role (tools/gates/lib/rules.mjs checkInvocation).
// QA18_PX_TWEAK (QA run only) is a JS expression applied to the object `px` before it is hashed.
const PX = `
    if (!("process_sandbox_sha256" in meta)) {
      const KEYS = { "domain-reviewer": "domain", "code-security-reviewer": "code-security", "qa-verifier": "qa", "release-auditor": "audit" };
      const pyEsc = (x) => x.replace(/[^A-Za-z0-9_]/g, "\\\\$&");
      const px = { schema: "mth-process-sandbox-v1", role, root: meta.cwd, confined: true, read_only_root: true,
        private_tmp: ["/tmp", "/var/tmp"], procfs: "host-bind", run_tmp: "/var/tmp/mth-run.qa18",
        writable_areas: ["docs/delivery/test-evidence/" + stage + "/" + KEYS[role], ...(role === "qa-verifier" ? ["tests/qa", "e2e"] : [])],
        read_only_within_writable: [],
        staged: [{ area: "docs/delivery/reviews/" + stage, accept: "round-[0-9]+/" + pyEsc(role) + "\\\\.[^/]+", replace: false, copied: null },
          ...(role === "release-auditor" ? [{ area: "docs/delivery/gates", accept: pyEsc(stage) + "\\\\.json", replace: true, copied: null }] : [])],
        private_sessions: true, cgroup_api: null, capabilities: ["CAP_SETFCAP"], no_new_privs: true, unshare: ["ipc"],
        copied_back: [], discarded: [] };
      if (process.env.QA18_PX_TWEAK && ${QA}) (0, eval)("(px) => { " + process.env.QA18_PX_TWEAK + " }")(px);
      const pxBuf = Buffer.from(JSON.stringify(px, null, 1) + "\\n");
      write(repo, \`\${base}/sandbox.json\`, pxBuf);
      meta.process_sandbox_sha256 = (process.env.QA18_PX_BADHASH && ${QA}) ? "0".repeat(64) : sha(pxBuf);
    }`;
function adapt(src) {
  const swaps = [
    ["if (metaTweak) meta = metaTweak(meta);", `meta.cwd = ${envOr("QA14_META_CWD", "/work/repo")};
    if (metaTweak) meta = metaTweak(meta);
    if (!("settings_sha256" in meta)) {
      const root = ${envOr("QA14_DENY_ROOT", "/work/repo")};
      const settingsBuf = Buffer.from(JSON.stringify({ sandbox: { enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false, filesystem: { denyWrite: ${JSON.stringify(PROTECTED7)}.map((x) => root + "/" + x) } } }));
      write(repo, \`\${base}/settings.json\`, settingsBuf);
      meta.settings_sha256 = sha(settingsBuf);
    }${PX}`],
    [`{ type: "system", subtype: "init", session_id, model: MODEL, tools: ["Read", "Bash", "Write"] },`,
      `Object.assign({ type: "system", subtype: "init", session_id, model: MODEL, tools: ["Read", "Bash", "Write"] }, { cwd: ${envOr("QA14_INIT_CWD", "/work/repo")} }),`],
  ];
  for (const [a, b] of swaps) { assert.ok(src.includes(a), `round-9 fixture anchor not found: ${a.slice(0, 60)}`); src = src.replace(a, () => b); } // function form: '$&' in b is literal
  return src;
}
const adaptDir = mkdtempSync(join(tmpdir(), "qa18-adapt-"));
const r9src = adapt(readFileSync(join(here, "dg0-gate-negative-r9.test.mjs"), "utf8"));
writeFileSync(join(adaptDir, "r9-d030.test.mjs"), r9src);
const prelude = r9src.slice(0, r9src.indexOf('\ntest("'));
writeFileSync(join(adaptDir, "fx.mjs"), prelude + "\nexport { fixture, validateGate };\n");
const fx = await import(pathToFileURL(join(adaptDir, "fx.mjs")).href);

function gateWith(env) {
  Object.assign(process.env, env);
  let f;
  try { f = fx.fixture(); } finally { Object.keys(env).forEach((k) => delete process.env[k]); }
  try { return fx.validateGate(f.repo, "DG0").map(String); } finally { rmSync(f.repo, { recursive: true, force: true }); }
}
const log = (id, e) => console.log(`  ${id} errors: ${JSON.stringify(e)}`);
const qaOnly = (errs) => errs.length > 0 && errs.every((e) => /qa-verifier/.test(e));

test("QA18-G0 control: the D-030-shaped independent fixture validates cleanly", () => {
  const e = gateWith({});
  log("QA18-G0", e);
  assert.deepEqual(e, []);
});

test("QA18-G1 A24/A25 regression: the 94-case round-9 suite under the current rules (91 pass; 3 cwd controls fail only on cwd binding)", () => {
  const res = spawnSync(process.execPath, ["--test", "--test-reporter=tap", join(adaptDir, "r9-d030.test.mjs")], { env: noTestCtx(), encoding: "utf8", maxBuffer: 64 << 20 });
  const pass = Number((res.stdout.match(/^# pass (\d+)/m) || [])[1]);
  const oks = res.stdout.split("\n").filter((l) => /^(not )?ok \d+ - /.test(l));
  for (const l of oks) console.log(`  [r9] ${l}`);
  const EXPECTED_CWD_ONLY = ["QA7-N77", "QA8-F223", "QA9-C01"];
  // QA7-N83 is a static text check for the literal 'claude -p --agent'; since D-030 the runner runs
  // 'bwrap "${SANDBOX[@]}" "$CLAUDE_BIN" -p --agent'. Its properties are re-asserted in the D-030 form by QA18-G6.
  const SUPERSEDED = ["QA7-N83"];
  const failed = oks.filter((l) => l.startsWith("not ok")).map((l) => l.replace(/^not ok \d+ - /, "").split(" ")[0]);
  assert.deepEqual(failed.sort(), [...EXPECTED_CWD_ONLY, ...SUPERSEDED].sort(), res.stdout.slice(-4000));
  const out = res.stdout.split("\n").map((l) => l.replace(/^# (?=# )/, ""));
  for (const id of EXPECTED_CWD_ONLY) {
    const at = out.findIndex((l) => new RegExp(`^not ok \\d+ - ${id} `).test(l));
    const errs = [];
    for (let i = at + 1; i < out.length && !/^(# Subtest|(not )?ok \d+ )/.test(out[i]); i++) {
      const m = out[i].match(/^\s+\+?\s+'(.*)',?$/);
      if (m) errs.push(m[1]);
    }
    console.log(`  [r9] ${id} errors: ${JSON.stringify(errs)}`);
    assert.ok(errs.length > 0 && errs.every((x) => /transcript init cwd .* != meta\.cwd|the replayed prompt names working directory .*, not meta\.cwd/.test(x)), `${id}: ${errs.join("\n")}`);
  }
  assert.equal(pass, 94 - EXPECTED_CWD_ONLY.length - SUPERSEDED.length);
});

test("QA18-G6 runner (QA7-N83 in the D-030 form): both invocations pipe a stream-json user message into the sandboxed CLI with replay, and the prompt prefix is what the validator requires", () => {
  const sh = readFileSync(join(process.env.QA_REPO_ROOT, "tools/agents/run-agent.sh"), "utf8");
  const calls = sh.split("\n").filter((l) => !/^\s*#/.test(l) && /-p --agent "\$ROLE"/.test(l));
  assert.equal(calls.length, 2, "expected the first-run and resume invocations");
  for (const c of calls) assert.match(c, /user_message "\$(RESUME_)?PROMPT" \| bwrap "\$\{SANDBOX\[@\]\}" "\$CLAUDE_BIN" -p --agent "\$ROLE"/);
  assert.equal((sh.match(/--input-format stream-json --replay-user-messages/g) || []).length, 2);
  assert.ok(!/--verbose "\$(RESUME_)?PROMPT"/.test(sh), "the prompt must not be passed as an argument");
  assert.match(sh, /PROMPT="You are invoked as project agent '\$\{ROLE\}' for stage \$\{STAGE\}, /);
  const rulesSrc = readFileSync(join(process.env.QA_REPO_ROOT, "tools/gates/lib/rules.mjs"), "utf8");
  assert.ok(rulesSrc.includes("startsWith(`You are invoked as project agent '${role}' for stage ${stageId}`)"));
});

test("QA18-G2 D-030: a run whose sandbox.json records a discard is rejected", () => {
  const e = gateWith({ QA18_PX_TWEAK: "px.discarded = ['docs/delivery/reviews/DG0/round-2/domain-reviewer.json: outside the role\\'s scope (not copied)'];" });
  log("QA18-G2", e);
  assert.ok(qaOnly(e) && e.some((x) => /discarded out-of-scope writes/.test(x)), JSON.stringify(e));
});

test("QA18-G3 D-030: a sandbox.json that doesn't match meta.process_sandbox_sha256 is rejected", () => {
  const e = gateWith({ QA18_PX_BADHASH: "1" });
  log("QA18-G3", e);
  assert.ok(qaOnly(e) && e.some((x) => /sandbox\.json does not match meta\.process_sandbox_sha256/.test(x)), JSON.stringify(e));
});

test("QA18-G4 D-030: a qa-verifier sandbox that made another reviewer's evidence directory writable is rejected", () => {
  const e = gateWith({ QA18_PX_TWEAK: "px.writable_areas.push('docs/delivery/test-evidence/DG0/domain');" });
  log("QA18-G4", e);
  assert.ok(qaOnly(e) && e.some((x) => /made .* writable, not the role's/.test(x)), JSON.stringify(e));
});

test("QA18-G5 D-030/D-031: no IPC namespace, or a procfs other than host-bind, is rejected", () => {
  for (const tweak of ["px.unshare = [];", "px.procfs = 'fresh';", "px.capabilities = ['CAP_SETFCAP', 'CAP_SYS_ADMIN'];", "px.no_new_privs = false;", "px.root = '/elsewhere';"]) {
    const e = gateWith({ QA18_PX_TWEAK: tweak });
    log(`QA18-G5 ${tweak}`, e);
    assert.ok(qaOnly(e) && e.some((x) => /not confined by the process sandbox/.test(x)), `${tweak}: ${JSON.stringify(e)}`);
  }
});
