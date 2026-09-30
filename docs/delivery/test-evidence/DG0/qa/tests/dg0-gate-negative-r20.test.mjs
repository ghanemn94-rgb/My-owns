// qa-verifier, DG0 round 20: independent A24/A25 gate negatives for the round-20 candidate (D-036: the gate's
// source_commit must be a real commit in every mode), plus the full round-9 A24/A25 suite re-run under the current rules.
// Author: qa-verifier (T-DG0-REV-QA-R20). Node built-ins only; every fixture is a disposable git repository under
// $TMPDIR, removed afterwards. No eval: the gate-commit variants are a fixed, named list (pickCommit below).
// Run: QA_REPO_ROOT=<clone of the candidate> node --test <this file>   (needs dg0-gate-negative-r9.test.mjs next to it)
//
//   QA20-G0  control: the D-030 + D-033-shaped independent fixture validates cleanly (zero errors), both modes
//   QA20-G1  A24/A25 regression: the 94-case round-9 suite (missing reviewer, author-reviewer, shared invocation,
//            failed/blocked check, unresolved High, incomplete requirement, bad anchor, SOURCE without block, coverage
//            gaps, change after freeze, tampered manifest, metadata invariance, ...). QA5-N57 (a NON-gate round whose
//            manifest names a missing commit) must still be ACCEPTED: the D-035 tolerance for pruned non-gate rounds holds.
//   QA20-S1  F-DG0-240 re-run (= QA19-P1/P4): gate source_commit that does not exist -> rejected in CURRENT mode now
//   QA20-S2  gate source_commit = an existing TREE object id (not a commit)            -> rejected (current mode)
//   QA20-S3  gate source_commit = an existing BLOB object id                            -> rejected (current mode)
//   QA20-S4  gate source_commit = abbreviated (12 hex) real commit                      -> rejected (current mode)
//   QA20-S5  gate source_commit = UPPER-case hex of the real commit                     -> rejected (current mode)
//   QA20-S6  gate source_commit = an existing commit with DIFFERENT content (off-branch) -> rejected (current mode)
//   QA20-S7  probe: gate source_commit = an off-branch (dangling) commit with IDENTICAL content, not an ancestor of HEAD
//   QA20-S8  probe: gate source_commit = an annotated TAG object id that peels to the real commit
//   QA20-N1  D-035 still holds for a pruned NON-gate round (missing commit) while the gate commit is real -> accepted;
//            a non-gate round naming a present-but-different commit -> still rejected
//   QA20-M1  metadata invariance: review/gate/run/assignment/test-evidence metadata doesn't change the candidate ID
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

Object.assign(process.env, { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "qa19", GIT_COMMITTER_NAME: "qa19",
  GIT_AUTHOR_EMAIL: "qa19@example.invalid", GIT_COMMITTER_EMAIL: "qa19@example.invalid" });
const here = dirname(fileURLToPath(import.meta.url));
if (!process.env.QA_REPO_ROOT) process.env.QA_REPO_ROOT = execFileSync("git", ["-C", here, "rev-parse", "--show-toplevel"]).toString().trim();
process.env.QA_REPO_ROOT = resolve(process.env.QA_REPO_ROOT);
const ROOT = process.env.QA_REPO_ROOT;
const noTestCtx = () => { const e = { ...process.env }; delete e.NODE_TEST_CONTEXT; return e; };
const rules = await import(pathToFileURL(join(ROOT, "tools/gates/lib/rules.mjs")).href);
const cand = await import(pathToFileURL(join(ROOT, "tools/gates/lib/candidate.mjs")).href);
const git = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();

const PROTECTED7 = [".git", ".claude", "tools/gates", "tools/agents", "docs/source", "docs/delivery/reviews", "docs/delivery/runs"];
const QA = `role === "qa-verifier"`;
const envOr = (name, dflt) => `((process.env.${name} !== undefined && ${QA}) ? process.env.${name} : ${JSON.stringify(dflt)})`;
// Process-sandbox record (D-030/D-031) + the D-033 landlock block. QA19_PX_TWEAK (qa-verifier run only) edits `px`.
const PX = `
    if (!("process_sandbox_sha256" in meta)) {
      const KEYS = { "domain-reviewer": "domain", "code-security-reviewer": "code-security", "qa-verifier": "qa", "release-auditor": "audit" };
      const pyEsc = (x) => x.replace(/[^A-Za-z0-9_]/g, "\\\\$&");
      const px = { schema: "mth-process-sandbox-v1", role, root: meta.cwd, confined: true, read_only_root: true,
        private_tmp: ["/tmp", "/var/tmp"], procfs: "host-bind", run_tmp: "/var/tmp/mth-run.qa20",
        writable_areas: ["docs/delivery/test-evidence/" + stage + "/" + KEYS[role], ...(role === "qa-verifier" ? ["tests/qa", "e2e"] : [])],
        read_only_within_writable: [],
        staged: [{ area: "docs/delivery/reviews/" + stage, accept: "round-[0-9]+/" + pyEsc(role) + "\\\\.[^/]+", replace: false, copied: null },
          ...(role === "release-auditor" ? [{ area: "docs/delivery/gates", accept: pyEsc(stage) + "\\\\.json", replace: true, copied: null }] : [])],
        private_sessions: true, cgroup_api: null, capabilities: ["CAP_SETFCAP"], no_new_privs: true, unshare: ["ipc"],
        landlock: { scoped: ["SIGNAL", "ABSTRACT_UNIX_SOCKET"], handled_access_fs: 0, handled_access_net: 0, per_run_domain: true },
        copied_back: [], discarded: [] };
      const pxBuf = Buffer.from(JSON.stringify(px, null, 1) + "\\n");
      write(repo, \`\${base}/sandbox.json\`, pxBuf);
      meta.process_sandbox_sha256 = sha(pxBuf);
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
    // QA19_FAKE_COMMIT: every source_commit pointer (manifest, stages, records, gate, fix_revision) names a commit that
    // does not exist; the committed content is unchanged, so the working-tree candidate still matches.
    [`const commit = commitAll(repo, "freeze");
  const entries = manifestFromRef(repo, commit, SPEC);`,
      `const realCommit = commitAll(repo, "freeze");
  const entries = manifestFromRef(repo, realCommit, SPEC);
  const commit = pickCommit(process.env.QA20_VARIANT, realCommit, repo, git, write, commitAll);`],
  ];
  for (const [a, b] of swaps) { assert.ok(src.includes(a), `round-9 fixture anchor not found: ${a.slice(0, 60)}`); src = src.replace(a, () => b); }
  return src;
}
// The fixture's commit pointer for every source_commit field (manifest, stages candidate + rounds, records, gate).
// A fixed, named list of variants (no code from the environment); unset -> the real freeze commit.
const PICK_SRC = `export function pickCommit(variant, c, repo, git, write, commitAll) {
  switch (variant) {
    case undefined: case "": return c;
    case "missing": return "5a1e".repeat(10);
    case "tree": return git(repo, "rev-parse", c + "^{tree}");
    case "blob": return git(repo, "rev-parse", c + ":app/main.txt");
    case "abbrev": return c.slice(0, 12);
    case "upper": return c.toUpperCase();
    case "divergent": {
      write(repo, "app/main.txt", "v2-divergent\\n");
      const d = commitAll(repo, "divergent (off-branch)");
      git(repo, "reset", "-q", "--hard", c);
      return d;
    }
    case "dangling-same": return git(repo, "commit-tree", c + "^{tree}", "-m", "same tree, off-branch");
    case "tag": { git(repo, "tag", "-a", "qa20-tag", "-m", "qa20", c); return git(repo, "rev-parse", "refs/tags/qa20-tag"); }
    default: throw new Error("unknown QA20_VARIANT " + variant);
  }
}
`;
const adaptDir = mkdtempSync(join(tmpdir(), "qa20-adapt-"));
const r9src = 'import { pickCommit } from "./pick.mjs";\n' + adapt(readFileSync(join(here, "dg0-gate-negative-r9.test.mjs"), "utf8"));
writeFileSync(join(adaptDir, "r9-d036.test.mjs"), r9src);
writeFileSync(join(adaptDir, "pick.mjs"), PICK_SRC);
const prelude = r9src.slice(0, r9src.indexOf('\ntest("'));
writeFileSync(join(adaptDir, "fx.mjs"), prelude + "\nexport { fixture, validateGate, manifestRel, mutate, readJ, commitAll };\n");
const fx = await import(pathToFileURL(join(adaptDir, "fx.mjs")).href);

function build(env, opts) {
  Object.assign(process.env, env);
  try { return fx.fixture(opts); } finally { Object.keys(env).forEach((k) => delete process.env[k]); }
}
function gateWith(env, mode, opts) {
  const f = build(env, opts);
  try { return fx.validateGate(f.repo, "DG0", ...(mode ? [{ mode }] : [])).map(String); } finally { rmSync(f.repo, { recursive: true, force: true }); }
}
const log = (id, e) => console.log(`  ${id} errors (${e.length}): ${JSON.stringify(e)}`);

const ACCEPT = { severity: "Low", mandatory: false, accept: true }; // no fix_revision in the fixture, so only the commit pointer matters
const NOT_A_COMMIT = /gate source_commit .* is not a commit in this repository/;
// Historical mode requires the stage to be APPROVED; the shared fixture leaves DG0 in VERIFYING (it is built for current-mode
// gate validation), so that single line is a fixture artifact and is ignored when judging historical-mode results.
const ARTIFACT = /^stages\.json: DG0 state VERIFYING not in APPROVED$/;
const hGate = (env, opts) => gateWith(env, "historical", opts).filter((e) => !ARTIFACT.test(e));

test("QA20-G0 control: the independent fixture validates cleanly (current + historical, both fixture shapes)", () => {
  for (const opts of [undefined, ACCEPT]) {
    const cur = gateWith({}, undefined, opts);
    const hist = hGate({}, opts);
    log(`QA20-G0 ${opts ? "accept" : "close"} current`, cur);
    log(`QA20-G0 ${opts ? "accept" : "close"} historical`, hist);
    assert.deepEqual(cur, []);
    assert.deepEqual(hist, []);
  }
});

test("QA20-G1 A24/A25 regression: the 94-case round-9 suite; QA5-N57 (pruned NON-gate round) still tolerated", () => {
  const res = spawnSync(process.execPath, ["--test", "--test-reporter=tap", join(adaptDir, "r9-d036.test.mjs")], { env: noTestCtx(), encoding: "utf8", maxBuffer: 64 << 20 });
  const oks = res.stdout.split("\n").filter((l) => /^(not )?ok \d+ - /.test(l));
  for (const l of oks) console.log(`  [r9] ${l}`);
  // Same expected set as QA19-G1: 3 one-field cwd controls fail only on cwd binding (QA14-REG), QA7-N83 is a static
  // runner-text check superseded by the D-030 bwrap wrapper, and QA5-N57 is the D-035 non-gate tolerance (by design).
  const EXPECTED = ["QA7-N77", "QA8-F223", "QA9-C01", "QA7-N83", "QA5-N57"];
  const failed = oks.filter((l) => l.startsWith("not ok")).map((l) => l.replace(/^not ok \d+ - /, "").split(" ")[0]);
  assert.deepEqual(failed.sort(), EXPECTED.sort(), res.stdout.slice(-4000));
  assert.equal(oks.length, 94);
});

for (const [id, variant, what] of [
  ["QA20-S1", "missing", "a commit id that does not exist (F-DG0-240 re-run)"],
  ["QA20-S2", "tree", "an existing tree object id"],
  ["QA20-S3", "blob", "an existing blob object id"],
  ["QA20-S4", "abbrev", "an abbreviated (12-hex) real commit id"],
  ["QA20-S5", "upper", "the real commit id in upper-case hex"],
  ["QA20-S6", "divergent", "an existing off-branch commit whose content differs"],
]) {
  test(`${id} D-036: an APPROVED gate whose source_commit is ${what} is rejected in current mode`, () => {
    const cur = gateWith({ QA20_VARIANT: variant }, undefined, ACCEPT);
    log(`${id} ${variant} current`, cur);
    const hist = hGate({ QA20_VARIANT: variant }, ACCEPT);
    log(`${id} ${variant} historical`, hist);
    assert.ok(cur.length > 0, `current mode accepted a gate whose source_commit is ${what}`);
    assert.ok(hist.length > 0, `historical mode accepted a gate whose source_commit is ${what}`);
    if (["missing", "tree", "blob"].includes(variant)) assert.ok(cur.some((e) => NOT_A_COMMIT.test(e)), `expected the D-036 error: ${JSON.stringify(cur)}`);
  });
}

for (const [id, variant, what] of [
  ["QA20-S7", "dangling-same", "an off-branch (unreachable) commit with IDENTICAL content"],
  ["QA20-S8", "tag", "an annotated tag object id that peels to the real commit"],
]) {
  test(`${id} probe: gate source_commit is ${what}`, () => {
    const cur = gateWith({ QA20_VARIANT: variant }, undefined, ACCEPT);
    log(`${id} ${variant} current`, cur);
    const hist = hGate({ QA20_VARIANT: variant }, ACCEPT);
    log(`${id} ${variant} historical`, hist);
    console.log(`  ${id} result: current=${cur.length ? "REJECTED" : "ACCEPTED"} historical=${hist.length ? "REJECTED" : "ACCEPTED"}`);
    // The same approved fixture as it looks in a FRESH CLONE (CI, a reviewer's clone): only reachable objects are copied.
    Object.assign(process.env, { QA20_VARIANT: variant });
    let f;
    try { f = fx.fixture(ACCEPT); } finally { delete process.env.QA20_VARIANT; }
    const dir = mkdtempSync(join(tmpdir(), "qa20-fresh-"));
    try {
      const g = fx.readJ(f.repo, "docs/delivery/gates/DG0.json");
      git(dir, "clone", "-q", "--no-local", f.repo, join(dir, "c")); // --no-local: transfer reachable objects only, as a remote clone does
      const c = join(dir, "c");
      const typeIn = (repo) => { try { return git(repo, "cat-file", "-t", g.source_commit); } catch { return "absent"; } };
      const anc = (repo) => { try { git(repo, "merge-base", "--is-ancestor", g.source_commit, "HEAD"); return true; } catch { return false; } };
      console.log(`  ${id} gate.source_commit=${g.source_commit} object type: fixture=${typeIn(f.repo)} fresh-clone=${typeIn(c)}; ancestor of HEAD: fixture=${anc(f.repo)} fresh-clone=${anc(c)}`);
      const fc = fx.validateGate(c, "DG0").map(String);
      log(`${id} ${variant} FRESH-CLONE current`, fc);
      const fh = fx.validateGate(c, "DG0", { mode: "historical" }).map(String).filter((e) => !ARTIFACT.test(e));
      log(`${id} ${variant} FRESH-CLONE historical`, fh);
      console.log(`  ${id} fresh-clone result: current=${fc.length ? "REJECTED" : "ACCEPTED"} historical=${fh.length ? "REJECTED" : "ACCEPTED"}`);
    } finally { rmSync(dir, { recursive: true, force: true }); rmSync(f.repo, { recursive: true, force: true }); }
  });
}

test("QA20-N1 D-035 still holds for NON-gate rounds: a pruned round is tolerated, a present-but-different one is not", () => {
  for (const kind of ["pruned", "present-different"]) {
    const f = build({}, ACCEPT);
    try {
      let src = "e".repeat(40);
      if (kind === "present-different") {
        writeFileSync(join(f.repo, "app/main.txt"), "v2-divergent\n");
        src = fx.commitAll(f.repo, "divergent content");
        git(f.repo, "reset", "-q", "--hard", "HEAD~1");
      }
      const entries = [{ path: "app/main.txt", sha256: "3".repeat(64), mode: "100644" }];
      const id = cand.candidateId(entries);
      const rel = fx.manifestRel(id);
      mkdirSync(dirname(join(f.repo, rel)), { recursive: true });
      writeFileSync(join(f.repo, rel), JSON.stringify({ stage_id: "DG0", candidate_id: id, hash_algorithm: "mth-candidate-v2", source_commit: src, frozen_at: "2026-09-28T13:00:00Z", spec: { include: ["**"], exclude: ["trading_agent/**"] }, entries }, null, 1));
      fx.mutate(f.repo, "docs/delivery/stages.json", (d) => d.stages[0].review_rounds.push({ round: 3, candidate_id: id, frozen_at: "2026-09-28T13:00:00Z", source_commit: src, records: {} }));
      fx.commitAll(f.repo, `non-gate round 3 (${kind})`);
      const e = fx.validateGate(f.repo, "DG0").map(String);
      log(`QA20-N1 ${kind}`, e);
      if (kind === "pruned") assert.deepEqual(e, [], "D-035: a pruned non-gate round must stay tolerated");
      else assert.ok(e.some((x) => /round 3 manifest .*does not describe its source_commit/.test(x)), JSON.stringify(e));
    } finally { rmSync(f.repo, { recursive: true, force: true }); }
  }
});

test("QA20-M1 metadata invariance: review/gate/run/assignment/test-evidence metadata doesn't change the candidate ID", () => {
  const dir = mkdtempSync(join(tmpdir(), "qa20-meta-"));
  try {
    git(ROOT, "clone", "-q", ROOT, join(dir, "c"));
    const c = join(dir, "c");
    const spec = JSON.parse(readFileSync(join(c, "docs/delivery/stages.json"), "utf8")).stages[0].candidate_spec;
    const id0 = cand.candidateId(cand.manifestFromWorkingTree(c, spec));
    for (const p of ["docs/delivery/reviews/DG0/round-99/qa-verifier.json", "docs/delivery/gates/DG0.json", "docs/delivery/runs/DG0/X/meta.json",
      "docs/delivery/assignments/DG0/round-99/review-qa-verifier.md", "docs/delivery/test-evidence/DG0/qa/round-99/x.log", "docs/delivery/findings.json",
      "docs/delivery/progress.md", "docs/delivery/candidates/DG0/x.manifest.json", "docs/delivery/handbacks/DG0/x.md", "docs/delivery/stages.json"]) {
      mkdirSync(dirname(join(c, p)), { recursive: true });
      writeFileSync(join(c, p), `qa20 metadata ${p}\n`);
    }
    const id1 = cand.candidateId(cand.manifestFromWorkingTree(c, spec));
    writeFileSync(join(c, "tools/gates/lib/rules.mjs"), readFileSync(join(c, "tools/gates/lib/rules.mjs"), "utf8") + "\n// qa20\n");
    const id2 = cand.candidateId(cand.manifestFromWorkingTree(c, spec));
    console.log(`  QA20-M1 base=${id0} after-metadata=${id1} after-validator-edit=${id2}`);
    assert.equal(id1, id0);
    assert.notEqual(id2, id0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

process.on("exit", () => rmSync(adaptDir, { recursive: true, force: true }));
