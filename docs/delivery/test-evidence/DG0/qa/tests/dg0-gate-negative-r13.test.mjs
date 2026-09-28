// qa-verifier, DG0 round 13: independent negative/regression tests against the frozen candidate c3364ac2 (6c61f2e).
// Author: qa-verifier (T-DG0-REV-QA-R13). Node built-ins only. Every case builds disposable fixtures under $TMPDIR.
// Run: QA_REPO_ROOT=<clone of the candidate> node --test <this file>
//
// Not already covered by tools/gates/tests or tools/agents/tests:
//   QA13-REG  the 94-case round-9 suite (incl. every A24 negative the assignment lists), adapted to D-025/D-026 run evidence
//   QA13-V2   a deny list without docs/source (the round-12 runner shape) is rejected
//   QA13-V3   a run whose meta has no cwd cannot bind (deny list cannot be anchored)
//   QA13-V4   non-normalised deny entries (<cwd>/./tools/gates) are rejected (strict, fails closed)
//   QA13-V5   probe: meta.cwd forged to the foreign root of the deny list while the transcript says /work/repo
//   QA13-S1   sandbox-run.sh runs the committed revision: an uncommitted edit of a tracked file never reaches the command
//   QA13-S2   sandbox-run.sh drops the caller's BASH_ENV / NODE_OPTIONS / PYTHONPATH / PYTHONSTARTUP
//   QA13-S3   sandbox-run.sh: a hook planted in the source repository's .git/hooks never runs during clone/checkout
//   QA13-S4   sandbox-run.sh: an unknown revision fails before the command runs
//   QA13-S5   sandbox-run.sh: the command can write neither the source .git nor the caller's HOME
//   QA13-S6   F-DG0-229 regression: prefreeze never imports gitignored bytecode planted next to an analysis check
//   QA13-S7   prefreeze: an uncommitted edit of a tracked candidate file fails the final check (sandbox checks HEAD only)
//   QA13-R1   runner: a pre-existing untracked, non-empty CLAUDE.local.md truncated to zero during a run
//   QA13-R2   runner: a pre-existing ignored, non-empty .claude/settings.local.json deleted during a run
//   QA13-R3   runner: a zero-length untracked .gitattributes / nested .claude file is ignored (by design, D-026)
//   QA13-C1   candidate invariance: every review-metadata path leaves the candidate unchanged; a tests/qa file changes it
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

Object.assign(process.env, { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "qa13", GIT_COMMITTER_NAME: "qa13",
  GIT_AUTHOR_EMAIL: "qa13@example.invalid", GIT_COMMITTER_EMAIL: "qa13@example.invalid" });

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

// ------------------------------------------------------------------ round-9 fixture, adapted to D-025 + D-026
const PROTECTED7 = [".git", ".claude", "tools/gates", "tools/agents", "docs/source", "docs/delivery/reviews", "docs/delivery/runs"];
const R9 = join(here, "dg0-gate-negative-r9.test.mjs");
const ANCHOR = "if (metaTweak) meta = metaTweak(meta);";
function d026(src) {
  assert.ok(src.includes(ANCHOR), "round-9 fixture anchor not found");
  // Runner-shaped evidence: meta.cwd (the fixture's prompt says /work/repo) and a settings.json whose deny list is
  // anchored at meta.cwd AFTER any metaTweak, as run-agent.sh + agent_settings.py produce it.
  return src.replace(ANCHOR, `meta.cwd = (process.env.QA13_FORGE_CWD && role === "qa-verifier") ? process.env.QA13_FORGE_CWD : "/work/repo";
    ${ANCHOR}
    if (!("settings_sha256" in meta)) {
      const root = String(meta.cwd || "").replace(/\\/+$/, "");
      const settingsBuf = Buffer.from(JSON.stringify({ sandbox: { enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false, filesystem: { denyWrite: ${JSON.stringify(PROTECTED7)}.map((x) => root + "/" + x) } } }));
      write(repo, \`\${base}/settings.json\`, settingsBuf);
      meta.settings_sha256 = sha(settingsBuf);
    }`);
}
const adaptDir = scratch("qa13-adapt-");
const r9src = d026(readFileSync(R9, "utf8"));
writeFileSync(join(adaptDir, "r9-d026.test.mjs"), r9src);
const prelude = r9src.slice(0, r9src.indexOf('\ntest("'));
writeFileSync(join(adaptDir, "fx.mjs"), prelude + "\nexport { fixture, withFixture, write, readJ, mutate, sha, shaFile, commitAll, validateGate, manifestFromWorkingTree, candidateId };\n");
const fx = await import(pathToFileURL(join(adaptDir, "fx.mjs")).href);

test("QA13-REG A24/A25 regression: the 94-case round-9 suite (every assignment negative) passes against the candidate with D-026-shaped run evidence", () => {
  const res = spawnSync(process.execPath, ["--test", "--test-reporter=tap", join(adaptDir, "r9-d026.test.mjs")], { env: noTestCtx(), encoding: "utf8", maxBuffer: 64 << 20 });
  const pass = Number((res.stdout.match(/^# pass (\d+)/m) || [])[1]);
  const fail = Number((res.stdout.match(/^# fail (\d+)/m) || [])[1]);
  const oks = res.stdout.split("\n").filter((l) => /^(not )?ok \d+ - /.test(l));
  for (const l of oks) console.log(`  [r9] ${l}`);
  assert.equal(fail, 0, oks.filter((l) => l.startsWith("not ok")).join("\n"));
  assert.equal(pass, 94);
  assert.equal(res.status, 0);
});

// A fixture with its QA run's settings/meta replaced consistently (as the runner would have written them).
function withRunSettings(mutateMeta, denyRoot, paths = PROTECTED7) {
  const f = fx.fixture();
  try {
    const repo = f.repo;
    const ref = fx.readJ(repo, f.recs["qa-verifier"]).invocation_reference;
    const base = `docs/delivery/runs/DG0/${ref.run_id}`;
    const buf = Buffer.from(JSON.stringify({ sandbox: { enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false, filesystem: { denyWrite: paths.map((x) => `${denyRoot}/${x}`) } } }));
    fx.write(repo, `${base}/settings.json`, buf);
    const meta = fx.readJ(repo, `${base}/meta.json`);
    meta.settings_sha256 = fx.sha(buf);
    mutateMeta(meta);
    fx.write(repo, `${base}/meta.json`, meta);
    if (git(repo, "status", "--porcelain")) fx.commitAll(repo, "qa13 settings");
    return fx.validateGate(repo, "DG0").map(String);
  } finally { rmSync(f.repo, { recursive: true, force: true }); }
}

test("QA13-V1 control: the D-026-adapted fixture validates cleanly", () => {
  assert.deepEqual(withRunSettings(() => {}, "/work/repo"), []);
});
test("QA13-V2 F-DG0-230/D-026: a deny list without docs/source (the round-12 runner shape) is rejected", () => {
  const e = withRunSettings(() => {}, "/work/repo", PROTECTED7.filter((p) => p !== "docs/source"));
  assert.ok(e.some((x) => /does not deny writes to \/work\/repo\/docs\/source/.test(x)), e.join("\n"));
});
test("QA13-V3 F-DG0-230: a run whose meta has no cwd cannot bind a record (the deny list cannot be anchored)", () => {
  const e = withRunSettings((m) => delete m.cwd, "/work/repo");
  assert.ok(e.some((x) => /<unknown cwd>/.test(x)), e.join("\n"));
});
test("QA13-V4 F-DG0-230: non-normalised deny entries (<cwd>/./x) are rejected; the check fails closed", () => {
  const e = withRunSettings(() => {}, "/work/repo/.");
  assert.ok(e.some((x) => /does not deny writes to \/work\/repo\/tools\/gates/.test(x)), e.join("\n"));
});
test("QA13-V5 F-DG0-230 residual: a run whose meta.cwd is forged to the foreign root its deny list protects (transcript init/prompt say /work/repo) should not bind", () => {
  // The forgery is part of the run evidence as first committed (no later M event), so write-once history cannot catch it.
  process.env.QA13_FORGE_CWD = "/somewhere/else";
  let f;
  try { f = fx.fixture(); } finally { delete process.env.QA13_FORGE_CWD; }
  try {
    const ref = fx.readJ(f.repo, f.recs["qa-verifier"]).invocation_reference;
    const meta = fx.readJ(f.repo, `docs/delivery/runs/DG0/${ref.run_id}/meta.json`);
    const deny = JSON.parse(readFileSync(join(f.repo, `docs/delivery/runs/DG0/${ref.run_id}/settings.json`), "utf8")).sandbox.filesystem.denyWrite;
    assert.equal(meta.cwd, "/somewhere/else", "fixture sanity");
    assert.ok(deny.every((d) => d.startsWith("/somewhere/else/")), "fixture sanity");
    const e = fx.validateGate(f.repo, "DG0").map(String);
    console.log(`  QA13-V5 errors: ${JSON.stringify(e)}`);
    assert.ok(e.length > 0, "ACCEPTED: meta.cwd is not bound to the transcript's init cwd or to the replayed prompt's 'Your working directory is /work/repo'");
  } finally { rmSync(f.repo, { recursive: true, force: true }); }
});

// ------------------------------------------------------------------ tools/gates/sandbox-run.sh (candidate copy)
function sbxRepo() {
  const repo = scratch("qa13-sbx-");
  git(repo, "init", "-q", "-b", "main");
  mkdirSync(join(repo, "tools", "gates"), { recursive: true });
  cpSync(join(ROOT, "tools/gates/sandbox-run.sh"), join(repo, "tools/gates/sandbox-run.sh"));
  writeFileSync(join(repo, "committed.txt"), "COMMITTED\n");
  git(repo, "add", "-A"); git(repo, "commit", "-qm", "c");
  return repo;
}
const sbx = (repo, cmd, env = process.env, rev = "HEAD") =>
  spawnSync(join(repo, "tools/gates/sandbox-run.sh"), [rev, "--", "bash", "-c", cmd], { encoding: "utf8", env });

test("QA13-S1 sandbox-run: an uncommitted edit of a tracked file never reaches the command (it checks the committed revision)", () => {
  assert.ok(hasBwrap, "bwrap required");
  const repo = sbxRepo();
  writeFileSync(join(repo, "committed.txt"), "TAMPERED-IN-WORKTREE\n");
  const r = sbx(repo, "cat committed.txt; git status --porcelain | wc -l");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^COMMITTED\n0\n$/);
});
test("QA13-S2 sandbox-run: BASH_ENV, NODE_OPTIONS, PYTHONPATH and PYTHONSTARTUP from the caller do not reach the sandboxed command", () => {
  assert.ok(hasBwrap, "bwrap required");
  const repo = sbxRepo();
  const d = scratch("qa13-env-");
  // BASH_ENV legitimately runs once for sandbox-run.sh itself (a non-interactive bash script started in the CALLER's own
  // environment, i.e. the orchestrator's trust domain). It must not run a second time for the sandboxed `bash -c`.
  writeFileSync(join(d, "bashenv.sh"), "echo BASH_ENV-RAN-$$ >&2\n");
  writeFileSync(join(d, "pre.cjs"), "console.log('NODE_OPTIONS-RAN')\n");
  writeFileSync(join(d, "json.py"), "print('PYTHONPATH-RAN')\n");
  const env = { ...process.env, BASH_ENV: join(d, "bashenv.sh"), NODE_OPTIONS: `--require ${join(d, "pre.cjs")}`, PYTHONPATH: d, PYTHONSTARTUP: join(d, "json.py") };
  const r = sbx(repo, "node -e 'console.log(1)'; python3 -c 'import json; print(2)'; env | grep -cE '^(BASH_ENV|NODE_OPTIONS|PYTHONPATH|PYTHONSTARTUP)=' || true", env);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^1\n2\n0\n$/);
  assert.equal((r.stderr.match(/BASH_ENV-RAN/g) || []).length, 1, r.stderr);
});
test("QA13-S3 sandbox-run: a hook planted in the source repository's .git/hooks never runs during clone/checkout", () => {
  assert.ok(hasBwrap, "bwrap required");
  const repo = sbxRepo();
  const marker = join(scratch("qa13-hook-"), "hook-ran");
  for (const h of ["post-checkout", "reference-transaction", "post-merge", "pre-auto-gc"]) {
    writeFileSync(join(repo, ".git/hooks", h), `#!/bin/sh\necho ${h} >> "${marker}"\n`);
    chmodSync(join(repo, ".git/hooks", h), 0o755);
  }
  const r = sbx(repo, "true");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(marker), false, existsSync(marker) ? readFileSync(marker, "utf8") : "");
});
test("QA13-S4 sandbox-run: an unknown revision fails before the command runs", () => {
  assert.ok(hasBwrap, "bwrap required");
  const repo = sbxRepo();
  const r = sbx(repo, "echo COMMAND-RAN", process.env, "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
  assert.notEqual(r.status, 0);
  assert.doesNotMatch(r.stdout, /COMMAND-RAN/);
});
test("QA13-S5 sandbox-run: the command can write neither the source repository's .git nor the caller's HOME", () => {
  assert.ok(hasBwrap, "bwrap required");
  const repo = sbxRepo();
  const home = scratch("qa13-home-");
  const r = sbx(repo, `echo x > ${repo}/.git/hooks/post-commit; echo rc_git=$?; echo x > ${home}/.gitconfig; echo rc_home=$?; echo x > "$HOME/probe"; echo rc_sbxhome=$?`,
    { ...process.env, HOME: home });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /rc_git=1/);
  assert.match(r.stdout, /rc_home=1/);
  assert.equal(existsSync(join(repo, ".git/hooks/post-commit")), false);
  assert.equal(existsSync(join(home, ".gitconfig")), false);
});

// ------------------------------------------------------------------ prefreeze.sh on a fresh clone of the candidate
function prefreezeClone() {
  const base = scratch("qa13-pf-");
  const repo = join(base, "clone");
  execFileSync("git", ["clone", "-q", ROOT, repo]);
  return { base, repo };
}
const prefreeze = (repo) => spawnSync("bash", [join(repo, "tools/gates/prefreeze.sh"), "DG0"], { cwd: repo, env: noTestCtx(), encoding: "utf8", maxBuffer: 64 << 20 });

test("QA13-S6 F-DG0-229 regression: prefreeze never imports gitignored bytecode planted next to an analysis check", () => {
  assert.ok(hasBwrap, "bwrap required");
  const { base, repo } = prefreezeClone();
  const src = join(base, "csv.py");
  writeFileSync(src, `import os\ntry:\n    open(${JSON.stringify(join(repo, ".git/hooks/post-commit"))}, "w").write("#!/bin/sh\\n")\nexcept Exception:\n    pass\nraise SystemExit(42)\n`);
  for (const dst of ["docs/analysis/tools/csv.pyc", "docs/analysis/tools/__pycache__/csv.cpython-311.pyc"]) {
    mkdirSync(dirname(join(repo, dst)), { recursive: true });
    execFileSync("python3", ["-c", "import py_compile,sys; py_compile.compile(sys.argv[1], cfile=sys.argv[2])", src, join(repo, dst)]);
  }
  assert.equal(git(repo, "status", "--porcelain", "--untracked-files=all"), "", "plant is invisible to git status");
  const r = prefreeze(repo);
  assert.equal(existsSync(join(repo, ".git/hooks/post-commit")), false, "planted bytecode executed with orchestrator rights");
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /PASS {2}analysis check check_counts\.py \(sandboxed\)/);
});
test("QA13-S7 prefreeze: an uncommitted edit of a tracked candidate file fails (the sandboxed checks see HEAD only; the final check catches the drift)", () => {
  assert.ok(hasBwrap, "bwrap required");
  const { repo } = prefreezeClone();
  writeFileSync(join(repo, "docs/analysis/glossary.md"), readFileSync(join(repo, "docs/analysis/glossary.md"), "utf8") + "\nuncommitted\n");
  const r = prefreeze(repo);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /FAIL {2}working-tree candidate .* differs from HEAD/);
});

// ------------------------------------------------------------------ run-agent.sh config scan (stub claude)
const STUB = `#!/usr/bin/env node
const args = process.argv.slice(2);
const sid = args[args.indexOf("--session-id") + 1] || args[args.indexOf("--resume") + 1];
const model = args[args.indexOf("--model") + 1];
const fs = require("node:fs");
for (const [op, p, content] of JSON.parse(process.env.QA13_OPS || "[]")) {
  if (op === "write") fs.writeFileSync(p, content); else if (op === "truncate") fs.truncateSync(p, 0); else if (op === "delete") fs.rmSync(p);
  else if (op === "mkdir") fs.mkdirSync(p, { recursive: true });
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
function runnerRepo(prep) {
  const repo = scratch("qa13-run-");
  git(repo, "init", "-q", "-b", "main");
  cpSync(join(ROOT, "tools/agents"), join(repo, "tools/agents"), { recursive: true, filter: (s) => !s.includes("__pycache__") });
  mkdirSync(join(repo, ".claude/agents"), { recursive: true });
  cpSync(join(ROOT, ".claude/agents/qa-verifier.md"), join(repo, ".claude/agents/qa-verifier.md"));
  mkdirSync(join(repo, "docs/delivery/assignments/DG0"), { recursive: true });
  writeFileSync(join(repo, "docs/delivery/assignments/DG0/T.md"), "assignment\n");
  writeFileSync(join(repo, "CLAUDE.md"), "rules\n");
  writeFileSync(join(repo, ".gitignore"), ".claude/settings.local.json\n");
  git(repo, "add", "-A"); git(repo, "commit", "-qm", "c");
  if (prep) prep(repo);
  return repo;
}
function runRunner(repo, ops) {
  const bin = scratch("qa13-bin-");
  writeFileSync(join(bin, "claude"), STUB); chmodSync(join(bin, "claude"), 0o755);
  const home = scratch("qa13-rhome-");
  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, QA13_OPS: JSON.stringify(ops), MTH_MAX_RESUMES: "0" };
  delete env.MTH_GUARD_ROOT;
  const res = spawnSync(join(repo, "tools/agents/run-agent.sh"), ["--role", "qa-verifier", "--stage", "DG0", "--task", "T-QA13", "--assignment", join(repo, "docs/delivery/assignments/DG0/T.md")], { cwd: repo, env, encoding: "utf8" });
  const runs = readdirSync(join(repo, "docs/delivery/runs/DG0"));
  const meta = JSON.parse(readFileSync(join(repo, "docs/delivery/runs/DG0", runs[0], "meta.json"), "utf8"));
  return { status: res.status, stderr: res.stderr, changed: meta.external_config_changed, outputs: Object.keys(meta.outputs || {}), deleted: meta.deleted || [] };
}

test("QA13-R1 probe D-026 stub rule: a pre-existing untracked, non-empty CLAUDE.local.md truncated to zero during a run", () => {
  assert.ok(hasBwrap, "bwrap required");
  const repo = runnerRepo((r) => writeFileSync(join(r, "CLAUDE.local.md"), "Operator instruction: never edit docs/source.\n"));
  const f = runRunner(repo, [["truncate", join(repo, "CLAUDE.local.md")]]);
  console.log(`  QA13-R1 exit=${f.status} external_config_changed=${JSON.stringify(f.changed)} outputs=${JSON.stringify(f.outputs)}`);
  assert.ok(f.status === 71 || f.changed.length > 0 || f.outputs.includes("CLAUDE.local.md"), "truncation of untracked configuration left no trace");
});
test("QA13-R1b probe D-026 stub rule: a pre-existing ignored, non-empty .claude/settings.local.json truncated to zero during a run (reported before D-026)", () => {
  assert.ok(hasBwrap, "bwrap required");
  const repo = runnerRepo((r) => writeFileSync(join(r, ".claude/settings.local.json"), '{"permissions":{"deny":["Bash(curl:*)"]}}'));
  const f = runRunner(repo, [["truncate", join(repo, ".claude/settings.local.json")]]);
  console.log(`  QA13-R1b exit=${f.status} external_config_changed=${JSON.stringify(f.changed)} outputs=${JSON.stringify(f.outputs)}`);
  assert.ok(f.status === 71 || f.changed.length > 0, "truncation of ignored configuration left no trace");
});
test("QA13-R2 probe D-024: a pre-existing ignored, non-empty .claude/settings.local.json deleted during a run", () => {
  assert.ok(hasBwrap, "bwrap required");
  const repo = runnerRepo((r) => writeFileSync(join(r, ".claude/settings.local.json"), '{"permissions":{"deny":["Bash(curl:*)"]}}'));
  const f = runRunner(repo, [["delete", join(repo, ".claude/settings.local.json")]]);
  console.log(`  QA13-R2 exit=${f.status} external_config_changed=${JSON.stringify(f.changed)} deleted=${JSON.stringify(f.deleted)}`);
  assert.ok(f.status === 71 || f.changed.length > 0, "deletion of ignored configuration left no trace");
});
test("QA13-R3 D-026 by design: zero-length untracked .gitattributes and nested .claude files are ignored; the same files with content are reported", () => {
  assert.ok(hasBwrap, "bwrap required");
  const repo = runnerRepo();
  const ev = join(repo, "docs/delivery/test-evidence/x");
  const empty = runRunner(repo, [["mkdir", join(ev, ".claude/hooks")], ["write", join(ev, ".gitattributes"), ""], ["write", join(ev, ".claude/hooks/h.sh"), ""]]);
  assert.deepEqual(empty.changed, []);
  assert.equal(empty.status, 0, empty.stderr);
  const repo2 = runnerRepo();
  const ev2 = join(repo2, "docs/delivery/test-evidence/x");
  const full = runRunner(repo2, [["mkdir", join(ev2, ".claude/hooks")], ["write", join(ev2, ".gitattributes"), "* filter=x\n"], ["write", join(ev2, ".claude/hooks/h.sh"), "#!/bin/sh\n"]]);
  assert.equal(full.status, 71, full.stderr);
  assert.equal(full.changed.length, 2, JSON.stringify(full.changed));
});

// ------------------------------------------------------------------ candidate invariance (A25)
test("QA13-C1 A25: review metadata leaves the candidate unchanged; a new tests/qa file (or a mode change) changes it", () => {
  const base = scratch("qa13-cand-");
  const repo = join(base, "clone");
  execFileSync("git", ["clone", "-q", ROOT, repo]);
  const cid = () => JSON.parse(execFileSync(process.execPath, [join(repo, "tools/gates/candidate.mjs"), "--stage", "DG0"], { cwd: repo }).toString()).candidate_id;
  const c0 = cid();
  for (const p of ["docs/delivery/reviews/DG0/round-99/qa-verifier.json", "docs/delivery/gates/DG0.json", "docs/delivery/test-evidence/DG0/qa/x.log",
    "docs/delivery/runs/DG0/X/meta.json", "docs/delivery/candidates/DG0/x.manifest.json", "docs/delivery/handbacks/DG0/x.md", "docs/delivery/assignments/DG0/round-99/x.md"]) {
    mkdirSync(dirname(join(repo, p)), { recursive: true });
    writeFileSync(join(repo, p), "{}\n");
  }
  for (const p of ["docs/delivery/findings.json", "docs/delivery/progress.md", "docs/delivery/stages.json"]) writeFileSync(join(repo, p), readFileSync(join(repo, p), "utf8") + "\n");
  assert.equal(cid(), c0, "review metadata changed the candidate");
  mkdirSync(join(repo, "tests/qa/dg0"), { recursive: true });
  writeFileSync(join(repo, "tests/qa/dg0/new.test.mjs"), "// new\n");
  const c1 = cid();
  assert.notEqual(c1, c0, "a new tests/qa file must change the candidate");
  rmSync(join(repo, "tests"), { recursive: true });
  assert.equal(cid(), c0);
  chmodSync(join(repo, "docs/analysis/glossary.md"), 0o755);
  assert.notEqual(cid(), c0, "a mode change must change the candidate");
});
