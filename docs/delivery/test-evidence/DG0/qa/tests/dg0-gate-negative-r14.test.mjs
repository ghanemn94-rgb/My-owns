// qa-verifier, DG0 round 14: independent negative/regression tests against the frozen candidate a25db736 (1e64eb0).
// Author: qa-verifier (T-DG0-REV-QA-R14). Node built-ins only. Every case builds disposable fixtures under $TMPDIR.
// Run: QA_REPO_ROOT=<clone of the candidate> node --test <this file>
//
// Not already covered by tools/gates/tests or tools/agents/tests (which tamper one field at a time):
//   QA14-REG  the 94-case round-9 suite (every A24 negative the assignment lists), with D-026 run evidence and init.cwd
//   QA14-V1   control: fixture with init.cwd = meta.cwd = prompt cwd = deny-list root validates cleanly
//   QA14-V2   F-DG0-233: init line without any cwd field is rejected
//   QA14-V3   F-DG0-233: meta.cwd AND init.cwd forged consistently to the deny-list root; only the prompt says /work/repo
//   QA14-V4   F-DG0-233: a replayed prompt with no 'Your working directory is' sentence is rejected
//   QA14-V5   F-DG0-233: meta.cwd with a trailing slash (/work/repo/) is not equal to /work/repo (strict)
//   QA14-V6   limit probe: meta, init, prompt and deny list all consistently name a foreign root (whole-evidence forgery)
//   QA14-V7   limit probe: a second (resume) init line in the same session naming a different cwd
//   QA14-V8   positive: a working directory containing spaces binds when all three agree
//   QA14-V9   positive: spaces, parentheses and Arabic characters bind when all three agree (consistent QA9-C01)
//   QA14-V10  positive: absolute Write paths under a consistent meta.cwd bind (consistent QA7-N77)
//   QA14-V12  original QA13-V5 forgery on the init-cwd fixture: rejected by the init check and the prompt check
//   QA14-V11  negative: absolute Write paths under a directory that is not the run's cwd do not author a record
//   (QA14-REG also asserts that the three one-field-only cwd controls QA7-N77/QA8-F223/QA9-C01 now fail ONLY on cwd binding)
//   QA14-R0   runner control: no configuration change -> exit 0, external_config_changed []
//   QA14-R4   runner F-DG0-234: a .git/hooks file deleted during a run is reported as removed
//   QA14-R5   runner F-DG0-234: a nested .gitignore in a second worktree deleted during a run is reported as removed
//   QA14-R6   runner: an ignored .claude/settings.local.json symlink retargeted to identical content is reported
//   QA14-R7   runner F-DG0-012 fail-closed: the before-snapshot vanishing makes the comparison fail -> reported, exit 71
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

Object.assign(process.env, { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "qa14", GIT_COMMITTER_NAME: "qa14",
  GIT_AUTHOR_EMAIL: "qa14@example.invalid", GIT_COMMITTER_EMAIL: "qa14@example.invalid" });

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.QA_REPO_ROOT
  ? resolve(process.env.QA_REPO_ROOT)
  : execFileSync("git", ["-C", here, "rev-parse", "--show-toplevel"]).toString().trim();
process.env.QA_REPO_ROOT = ROOT;
const tmp = [];
function scratch(prefix) { const d = mkdtempSync(join(tmpdir(), prefix)); tmp.push(d); return d; }
process.on("exit", () => tmp.forEach((d) => rmSync(d, { recursive: true, force: true })));
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { stdio: ["ignore", "pipe", "pipe"] }).toString();
const hasBwrap = spawnSync("sh", ["-c", "command -v bwrap"]).status === 0;
const noTestCtx = () => { const e = { ...process.env }; delete e.NODE_TEST_CONTEXT; return e; };

// ------------------------------------------------------------------ round-9 fixture, adapted to D-026 + D-027
const PROTECTED7 = [".git", ".claude", "tools/gates", "tools/agents", "docs/source", "docs/delivery/reviews", "docs/delivery/runs"];
const R9 = join(here, "dg0-gate-negative-r9.test.mjs");
const QA = `role === "qa-verifier"`;
const envOr = (name, dflt) => `((process.env.${name} !== undefined && ${QA}) ? process.env.${name} : ${JSON.stringify(dflt)})`;
function adapt(src) {
  const swaps = [
    // meta.cwd plus a deny list anchored at it (runner shape, D-026), overridable for the QA run only.
    ["if (metaTweak) meta = metaTweak(meta);", `meta.cwd = ${envOr("QA14_META_CWD", "/work/repo")};
    if (metaTweak) meta = metaTweak(meta);
    if (!("settings_sha256" in meta)) {
      const root = ${envOr("QA14_DENY_ROOT", "/work/repo")};
      const settingsBuf = Buffer.from(JSON.stringify({ sandbox: { enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false, filesystem: { denyWrite: ${JSON.stringify(PROTECTED7)}.map((x) => root + "/" + x) } } }));
      write(repo, \`\${base}/settings.json\`, settingsBuf);
      meta.settings_sha256 = sha(settingsBuf);
    }`],
    // The CLI init line records the working directory (real transcripts do); "__none__" drops the field.
    [`{ type: "system", subtype: "init", session_id, model: MODEL, tools: ["Read", "Bash", "Write"] },`,
      `Object.assign({ type: "system", subtype: "init", session_id, model: MODEL, tools: ["Read", "Bash", "Write"] }, ${envOr("QA14_INIT_CWD", "/work/repo")} === "__none__" ? {} : { cwd: ${envOr("QA14_INIT_CWD", "/work/repo")} }),`],
    // The replayed prompt's working-directory sentence; "__none__" drops the sentence.
    ["and execute the assignment exactly. Your working directory is /work/repo.`;",
      "and execute the assignment exactly.` + (" + envOr("QA14_PROMPT_CWD", "/work/repo") + " === \"__none__\" ? \"\" : ` Your working directory is ${" + envOr("QA14_PROMPT_CWD", "/work/repo") + "}.`);"],
    // Optional resume: a second init (same session) naming another cwd, followed by another successful result.
    ["if (linesTweak) lines = linesTweak(lines, { prompt, ref, session_id, run_id });",
      `if (process.env.QA14_RESUME_CWD && ${QA}) lines.push({ type: "system", subtype: "init", session_id, model: MODEL, cwd: process.env.QA14_RESUME_CWD, tools: ["Read", "Bash", "Write"] }, { type: "result", subtype: "success", is_error: false, session_id, result: "done" });
    if (linesTweak) lines = linesTweak(lines, { prompt, ref, session_id, run_id });`],
    // Optional: Write tool_use file paths made absolute under a given directory (QA run only).
    ["input: { file_path: p, content:", `input: { file_path: (process.env.QA14_ABS_WRITE && ${QA}) ? process.env.QA14_ABS_WRITE + "/" + p : p, content:`],
  ];
  for (const [a, b] of swaps) { assert.ok(src.includes(a), `round-9 fixture anchor not found: ${a.slice(0, 60)}`); src = src.replace(a, b); }
  return src;
}
const adaptDir = scratch("qa14-adapt-");
const r9src = adapt(readFileSync(R9, "utf8"));
writeFileSync(join(adaptDir, "r9-d027.test.mjs"), r9src);
const prelude = r9src.slice(0, r9src.indexOf('\ntest("'));
writeFileSync(join(adaptDir, "fx.mjs"), prelude + "\nexport { fixture, withFixture, write, readJ, mutate, sha, shaFile, commitAll, validateGate, manifestFromWorkingTree, candidateId };\n");
const fx = await import(pathToFileURL(join(adaptDir, "fx.mjs")).href);

function gateWith(env) {
  const keys = Object.keys(env);
  Object.assign(process.env, env);
  let f;
  try { f = fx.fixture(); } finally { keys.forEach((k) => delete process.env[k]); }
  try { return fx.validateGate(f.repo, "DG0").map(String); } finally { rmSync(f.repo, { recursive: true, force: true }); }
}
const log = (id, e) => console.log(`  ${id} errors: ${JSON.stringify(e)}`);

test("QA14-REG A24/A25 regression: the round-9 suite (every assignment negative) with D-027-shaped run evidence: 91 pass, and the 3 one-field cwd controls fail only on cwd binding", () => {
  const res = spawnSync(process.execPath, ["--test", "--test-reporter=tap", join(adaptDir, "r9-d027.test.mjs")], { env: noTestCtx(), encoding: "utf8", maxBuffer: 64 << 20 });
  if (process.env.QA14_DUMP) writeFileSync(process.env.QA14_DUMP, res.stdout);
  const pass = Number((res.stdout.match(/^# pass (\d+)/m) || [])[1]);
  const fail = Number((res.stdout.match(/^# fail (\d+)/m) || [])[1]);
  const oks = res.stdout.split("\n").filter((l) => /^(not )?ok \d+ - /.test(l));
  for (const l of oks) console.log(`  [r9] ${l}`);
  // D-027 binds meta.cwd to init.cwd and the prompt. Three round-7..9 controls change only ONE of them (the prompt's
  // path, or meta.cwd), so they are now inconsistent run evidence. They must fail, and only with cwd-binding errors;
  // their consistent equivalents are QA14-V8/V9/V10.
  const EXPECTED_CWD_ONLY = ["QA7-N77", "QA8-F223", "QA9-C01"];
  const failed = oks.filter((l) => l.startsWith("not ok")).map((l) => l.replace(/^not ok \d+ - /, "").split(" ")[0]);
  assert.deepEqual(failed.sort(), EXPECTED_CWD_ONLY, oks.filter((l) => l.startsWith("not ok")).join("\n"));
  const out = res.stdout.split("\n").map((l) => l.replace(/^# (?=# )/, ""));
  for (const id of EXPECTED_CWD_ONLY) {
    // The failing assertion's diff (TAP YAML block after "not ok N - <id>") lists the validator errors as quoted strings.
    const at = out.findIndex((l) => new RegExp(`^not ok \\d+ - ${id} `).test(l));
    assert.ok(at >= 0, `no TAP failure block for ${id}`);
    const errs = [];
    for (let i = at + 1; i < out.length && !/^(# Subtest|(not )?ok \d+ )/.test(out[i]); i++) {
      const m = out[i].match(/^\s+\+?\s+'(.*)',?$/);
      if (m) errs.push(m[1]);
    }
    console.log(`  [r9] ${id} errors: ${JSON.stringify(errs)}`);
    assert.ok(errs.length > 0 && errs.every((x) => /transcript init cwd .* != meta\.cwd|the replayed prompt names working directory .*, not meta\.cwd/.test(x)), `${id}: ${errs.join("\n")}`);
  }
  assert.equal(pass, 94 - EXPECTED_CWD_ONLY.length);
});
test("QA14-V9 positive (consistent QA9-C01): a path with spaces, parentheses and Arabic characters binds when all agree", () => {
  const d = "/home/مستخدم (عمل)/My Projects (2026)/repo";
  const e = gateWith({ QA14_META_CWD: d, QA14_INIT_CWD: d, QA14_PROMPT_CWD: d, QA14_DENY_ROOT: d }); log("QA14-V9", e);
  assert.deepEqual(e, []);
});
test("QA14-V10 positive (consistent QA7-N77): Write tool paths that are absolute under a consistent meta.cwd bind", () => {
  const d = "/fake/cwd";
  const e = gateWith({ QA14_META_CWD: d, QA14_INIT_CWD: d, QA14_PROMPT_CWD: d, QA14_DENY_ROOT: d, QA14_ABS_WRITE: d }); log("QA14-V10", e);
  assert.deepEqual(e, []);
});
test("QA14-V11 negative: absolute Write paths under /fake/cwd while meta/init/prompt say /work/repo do not count as authored", () => {
  const e = gateWith({ QA14_ABS_WRITE: "/fake/cwd" }); log("QA14-V11", e);
  assert.ok(e.length > 0, "a Write outside the run's working directory authored a record");
});
test("QA14-V1 control: init.cwd = meta.cwd = prompt cwd = deny-list root validates cleanly", () => {
  const e = gateWith({}); log("QA14-V1", e);
  assert.deepEqual(e, []);
});
test("QA14-V2 F-DG0-233: an init line without a cwd field cannot bind", () => {
  const e = gateWith({ QA14_INIT_CWD: "__none__" }); log("QA14-V2", e);
  assert.ok(e.some((x) => /qa-verifier.*init cwd undefined != meta.cwd \/work\/repo/.test(x)), e.join("\n"));
});
test("QA14-V3 F-DG0-233: meta.cwd and init.cwd forged consistently to the deny-list root, prompt still /work/repo -> rejected", () => {
  const e = gateWith({ QA14_META_CWD: "/somewhere/else", QA14_INIT_CWD: "/somewhere/else", QA14_DENY_ROOT: "/somewhere/else" }); log("QA14-V3", e);
  assert.ok(e.some((x) => /replayed prompt names working directory \/work\/repo, not meta.cwd \/somewhere\/else/.test(x)), e.join("\n"));
  assert.ok(!e.some((x) => /init cwd/.test(x)), "only the prompt should disagree");
});
test("QA14-V12 F-DG0-233 original repro (QA13-V5) on the init-cwd fixture: meta.cwd + deny list forged, init and prompt say /work/repo -> rejected by both checks", () => {
  const e = gateWith({ QA14_META_CWD: "/somewhere/else", QA14_DENY_ROOT: "/somewhere/else" }); log("QA14-V12", e);
  assert.ok(e.some((x) => /qa-verifier.*transcript init cwd \/work\/repo != meta.cwd \/somewhere\/else/.test(x)), e.join("\n"));
  assert.ok(e.some((x) => /replayed prompt names working directory \/work\/repo, not meta.cwd \/somewhere\/else/.test(x)), e.join("\n"));
  assert.ok(!e.some((x) => /(domain-reviewer|code-security-reviewer|release-auditor).*cwd/.test(x)), "only the forged run may fail");
});
test("QA14-V4 F-DG0-233: a replayed prompt with no working-directory sentence cannot bind", () => {
  const e = gateWith({ QA14_PROMPT_CWD: "__none__" }); log("QA14-V4", e);
  assert.ok(e.some((x) => /replayed prompt names working directory <none>/.test(x)), e.join("\n"));
});
test("QA14-V5 F-DG0-233: meta.cwd '/work/repo/' (trailing slash) does not equal the transcript's /work/repo (strict, fails closed)", () => {
  const e = gateWith({ QA14_META_CWD: "/work/repo/" }); log("QA14-V5", e);
  assert.ok(e.some((x) => /init cwd \/work\/repo != meta.cwd \/work\/repo\//.test(x)), e.join("\n"));
});
test("QA14-V6 limit probe (disclosed residual 1): meta, init, prompt and deny list all consistently name a foreign root", () => {
  const e = gateWith({ QA14_META_CWD: "/somewhere/else", QA14_INIT_CWD: "/somewhere/else", QA14_PROMPT_CWD: "/somewhere/else", QA14_DENY_ROOT: "/somewhere/else" });
  log("QA14-V6", e);
  // Recorded, not asserted either way: consistent forgery of all self-hashed run evidence is residual 1 in threat-model.md.
  console.log(`  QA14-V6 accepted=${e.length === 0}`);
});
test("QA14-V7 limit probe: a resume init line (same session) naming a different cwd", () => {
  const e = gateWith({ QA14_RESUME_CWD: "/somewhere/else" }); log("QA14-V7", e);
  console.log(`  QA14-V7 accepted=${e.length === 0}`);
});
test("QA14-V8 positive: a working directory with spaces binds when meta, init, prompt and deny list agree", () => {
  const d = "/work/my repo";
  const e = gateWith({ QA14_META_CWD: d, QA14_INIT_CWD: d, QA14_PROMPT_CWD: d, QA14_DENY_ROOT: d }); log("QA14-V8", e);
  assert.deepEqual(e, []);
});

// ------------------------------------------------------------------ run-agent.sh config scan (stub claude)
const STUB = `#!/usr/bin/env node
const args = process.argv.slice(2);
const sid = args[args.indexOf("--session-id") + 1] || args[args.indexOf("--resume") + 1];
const model = args[args.indexOf("--model") + 1];
const fs = require("node:fs"), path = require("node:path");
const runDir = () => { const d = path.join(process.cwd(), "docs/delivery/runs/DG0"); return path.join(d, fs.readdirSync(d)[0]); };
for (const [op, p, content] of JSON.parse(process.env.QA14_OPS || "[]")) {
  if (op === "write") fs.writeFileSync(p, content); else if (op === "truncate") fs.truncateSync(p, 0); else if (op === "delete") fs.rmSync(p);
  else if (op === "mkdir") fs.mkdirSync(p, { recursive: true });
  else if (op === "relink") { fs.rmSync(p); fs.symlinkSync(content, p); }
  else if (op === "delete-pre-config") fs.rmSync(path.join(runDir(), ".pre-config.txt"));
}
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  const prompt = JSON.parse(input.split("\\n")[0]).message.content;
  const out = [
    { type: "system", subtype: "init", session_id: sid, model, cwd: process.cwd(), tools: ["Read", "Bash", "Write"] },
    { type: "user", isReplay: true, message: { role: "user", content: prompt }, session_id: sid },
    { type: "result", subtype: "success", is_error: false, session_id: sid, result: "done", num_turns: 1 },
  ];
  process.stdout.write(out.map((o) => JSON.stringify(o)).join("\\n") + "\\n");
});
`;
function runnerRepo(prep) {
  const repo = scratch("qa14-run-");
  git(repo, "init", "-q", "-b", "main");
  cpSync(join(ROOT, "tools/agents"), join(repo, "tools/agents"), { recursive: true, filter: (s) => !s.includes("__pycache__") });
  mkdirSync(join(repo, ".claude/agents"), { recursive: true });
  cpSync(join(ROOT, ".claude/agents/qa-verifier.md"), join(repo, ".claude/agents/qa-verifier.md"));
  mkdirSync(join(repo, "docs/delivery/assignments/DG0"), { recursive: true });
  writeFileSync(join(repo, "docs/delivery/assignments/DG0/T.md"), "assignment\n");
  writeFileSync(join(repo, "CLAUDE.md"), "rules\n");
  writeFileSync(join(repo, ".gitignore"), ".claude/settings.local.json\n.claude/real*.json\n");
  git(repo, "add", "-A"); git(repo, "commit", "-qm", "c");
  if (prep) prep(repo);
  return repo;
}
function runRunner(repo, ops) {
  const bin = scratch("qa14-bin-");
  writeFileSync(join(bin, "claude"), STUB); chmodSync(join(bin, "claude"), 0o755);
  const home = scratch("qa14-rhome-");
  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, QA14_OPS: JSON.stringify(ops), MTH_MAX_RESUMES: "0" };
  delete env.MTH_GUARD_ROOT;
  const res = spawnSync(join(repo, "tools/agents/run-agent.sh"), ["--role", "qa-verifier", "--stage", "DG0", "--task", "T-QA14", "--assignment", join(repo, "docs/delivery/assignments/DG0/T.md")], { cwd: repo, env, encoding: "utf8" });
  const runs = readdirSync(join(repo, "docs/delivery/runs/DG0"));
  const meta = JSON.parse(readFileSync(join(repo, "docs/delivery/runs/DG0", runs[0], "meta.json"), "utf8"));
  return { status: res.status, stderr: res.stderr, changed: meta.external_config_changed, meta };
}
const show = (id, f) => console.log(`  ${id} exit=${f.status} external_config_changed=${JSON.stringify(f.changed)}`);

test("QA14-R0 runner control: no configuration change -> exit 0 and nothing reported (and meta.cwd equals the stub's init cwd)", () => {
  assert.ok(hasBwrap, "bwrap required");
  const repo = runnerRepo((r) => writeFileSync(join(r, ".claude/settings.local.json"), '{"permissions":{}}'));
  const f = runRunner(repo, []); show("QA14-R0", f);
  assert.equal(f.status, 0, f.stderr);
  assert.deepEqual(f.changed, []);
  assert.equal(f.meta.cwd, repo);
});
test("QA14-R4 runner F-DG0-234: a .git/hooks file deleted during a run is reported as removed", () => {
  assert.ok(hasBwrap, "bwrap required");
  const repo = runnerRepo((r) => { writeFileSync(join(r, ".git/hooks/post-commit"), "#!/bin/sh\necho audit\n"); chmodSync(join(r, ".git/hooks/post-commit"), 0o755); });
  const f = runRunner(repo, [["delete", join(repo, ".git/hooks/post-commit")]]); show("QA14-R4", f);
  assert.equal(f.status, 71, f.stderr);
  assert.ok(f.changed.some((x) => x === `${join(repo, ".git/hooks/post-commit")} removed`), JSON.stringify(f.changed));
});
test("QA14-R5 runner F-DG0-234: a nested .gitignore in a second worktree deleted during a run is reported as removed", () => {
  assert.ok(hasBwrap, "bwrap required");
  let wt;
  const repo = runnerRepo((r) => {
    wt = join(scratch("qa14-wt-"), "wt");
    git(r, "worktree", "add", "-q", wt);
    mkdirSync(join(wt, "sub"), { recursive: true });
    writeFileSync(join(wt, "sub/.gitignore"), "secret.txt\n");
  });
  const f = runRunner(repo, [["delete", join(wt, "sub/.gitignore")]]); show("QA14-R5", f);
  assert.equal(f.status, 71, f.stderr);
  assert.ok(f.changed.some((x) => x === `${join(wt, "sub/.gitignore")} removed`), JSON.stringify(f.changed));
});
test("QA14-R6 runner: an ignored .claude/settings.local.json symlink retargeted to identical content is reported", () => {
  assert.ok(hasBwrap, "bwrap required");
  const body = '{"permissions":{"deny":["Bash(curl:*)"]}}';
  const repo = runnerRepo((r) => {
    writeFileSync(join(r, ".claude/real-a.json"), body); writeFileSync(join(r, ".claude/real-b.json"), body);
    symlinkSync("real-a.json", join(r, ".claude/settings.local.json"));
  });
  const f = runRunner(repo, [["relink", join(repo, ".claude/settings.local.json"), "real-b.json"]]); show("QA14-R6", f);
  assert.equal(f.status, 71, f.stderr);
  assert.ok(f.changed.some((x) => x.startsWith(join(repo, ".claude/settings.local.json")) && x.endsWith("real-b.json")), JSON.stringify(f.changed));
});
test("QA14-R7 runner F-DG0-012 fail-closed: if the before-snapshot cannot be read the comparison fails and the run is flagged", () => {
  assert.ok(hasBwrap, "bwrap required");
  const repo = runnerRepo();
  const f = runRunner(repo, [["delete-pre-config"]]); show("QA14-R7", f);
  assert.equal(f.status, 71, f.stderr);
  assert.deepEqual(f.changed, ["config-diff-failed (fail closed)"]);
});
