// qa-verifier, DG0 round 19: independent A24/A25 gate negatives for the round-19 candidate (D-033 Landlock record,
// D-034 write-once history repair + import-findings hardening, D-035 pruned source_commit tolerance), plus the full
// round-9 A24/A25 suite re-run under the current evidence rules. Author: qa-verifier (T-DG0-REV-QA-R19).
// Node built-ins only; every fixture is a disposable git repository under $TMPDIR, removed afterwards.
// Run: QA_REPO_ROOT=<clone of the candidate> node --test <this file>   (needs dg0-gate-negative-r9.test.mjs next to it)
//
//   QA19-G0  control: the D-030 + D-033-shaped independent fixture validates cleanly (zero errors)
//   QA19-G1  A24/A25 regression: the 94-case round-9 suite (missing reviewer, author-reviewer, shared invocation,
//            failed/blocked check, unresolved High, incomplete requirement, bad anchor, SOURCE without block, coverage
//            gaps, change after freeze, tampered manifest, metadata invariance, ...) under the current rules
//   QA19-L1  D-033 variants NOT in tools/gates/tests: handled_access_net != 0; scoped without SIGNAL; string-typed
//            per_run_domain; landlock: true (non-object); handled_access_fs as a string "0"
//   QA19-P1  D-035 at gate level: a gate whose source_commit (and manifest/rounds/records) name a commit that does
//            not exist in the repository is rejected (current mode and historical mode)
//   QA19-P2  D-035: a round manifest whose source_commit is PRESENT but is a different commit is still rejected
//   QA19-P3  D-035 probe: a round manifest whose source_commit is an existing NON-commit object (the freeze tree id)
//   QA19-W1  D-034: a delete of a committed review sidecar followed by a re-add at the SAME blob is still rejected
//            (so the repair had to rewrite history, not just re-add), and a re-add at a DIFFERENT blob is rejected
//   QA19-I1  D-034: import-findings skips a record-less (interrupted-run) verifications sidecar -- the finding stays
//            pending and the sidecar is not deleted; with the record present the same sidecar is imported
//   QA19-M1  metadata invariance: adding round-19-style review/gate/run/assignment metadata leaves the candidate ID unchanged
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
        private_tmp: ["/tmp", "/var/tmp"], procfs: "host-bind", run_tmp: "/var/tmp/mth-run.qa19",
        writable_areas: ["docs/delivery/test-evidence/" + stage + "/" + KEYS[role], ...(role === "qa-verifier" ? ["tests/qa", "e2e"] : [])],
        read_only_within_writable: [],
        staged: [{ area: "docs/delivery/reviews/" + stage, accept: "round-[0-9]+/" + pyEsc(role) + "\\\\.[^/]+", replace: false, copied: null },
          ...(role === "release-auditor" ? [{ area: "docs/delivery/gates", accept: pyEsc(stage) + "\\\\.json", replace: true, copied: null }] : [])],
        private_sessions: true, cgroup_api: null, capabilities: ["CAP_SETFCAP"], no_new_privs: true, unshare: ["ipc"],
        landlock: { scoped: ["SIGNAL", "ABSTRACT_UNIX_SOCKET"], handled_access_fs: 0, handled_access_net: 0, per_run_domain: true },
        copied_back: [], discarded: [] };
      if (process.env.QA19_PX_TWEAK && ${QA}) (0, eval)("(px) => { " + process.env.QA19_PX_TWEAK + " }")(px);
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
  const commit = process.env.QA19_FAKE_COMMIT || realCommit;`],
  ];
  for (const [a, b] of swaps) { assert.ok(src.includes(a), `round-9 fixture anchor not found: ${a.slice(0, 60)}`); src = src.replace(a, () => b); }
  return src;
}
const adaptDir = mkdtempSync(join(tmpdir(), "qa19-adapt-"));
const r9src = adapt(readFileSync(join(here, "dg0-gate-negative-r9.test.mjs"), "utf8"));
writeFileSync(join(adaptDir, "r9-d033.test.mjs"), r9src);
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
const qaOnly = (errs) => errs.length > 0 && errs.every((e) => /qa-verifier/.test(e));

test("QA19-G0 control: the D-030 + D-033-shaped independent fixture validates cleanly", () => {
  const e = gateWith({});
  log("QA19-G0", e);
  assert.deepEqual(e, []);
});

test("QA19-G1 A24/A25 regression: the 94-case round-9 suite under the current rules", () => {
  const res = spawnSync(process.execPath, ["--test", "--test-reporter=tap", join(adaptDir, "r9-d033.test.mjs")], { env: noTestCtx(), encoding: "utf8", maxBuffer: 64 << 20 });
  const oks = res.stdout.split("\n").filter((l) => /^(not )?ok \d+ - /.test(l));
  for (const l of oks) console.log(`  [r9] ${l}`);
  // Same expected set as QA18-G1: 3 one-field cwd controls fail only on cwd binding (QA14-REG), QA7-N83 is a static
  // runner-text check superseded by the D-030 bwrap wrapper.
  // QA5-N57 (a round whose manifest names a non-existent source_commit is rejected) is the behaviour D-035 deliberately
  // loosened; QA19-P1/P4 below assess what that means for the gate.
  const EXPECTED = ["QA7-N77", "QA8-F223", "QA9-C01", "QA7-N83", "QA5-N57"];
  const failed = oks.filter((l) => l.startsWith("not ok")).map((l) => l.replace(/^not ok \d+ - /, "").split(" ")[0]);
  assert.deepEqual(failed.sort(), EXPECTED.sort(), res.stdout.slice(-4000));
  assert.equal(oks.length, 94);
  const out = res.stdout.split("\n");
  const at = out.findIndex((l) => /^not ok \d+ - QA5-N57 /.test(l));
  const block = out.slice(at, at + 40).join("\n");
  console.log(`  [r9] QA5-N57 detail: ${JSON.stringify(block.slice(0, 1500))}`);
  assert.match(block, /validator accepted an invalid gate \(no errors\)/, "QA5-N57 must now fail only because the pruned-commit round is accepted");
});

test("QA19-L1 D-033: Landlock record variants not covered by tools/gates/tests are rejected", () => {
  for (const tweak of [
    "px.landlock.handled_access_net = 1;",
    "px.landlock.scoped = ['ABSTRACT_UNIX_SOCKET'];",
    "px.landlock.per_run_domain = 'true';",
    "px.landlock = true;",
    "px.landlock.handled_access_fs = '0';",
    "px.landlock.scoped = 'SIGNAL,ABSTRACT_UNIX_SOCKET';",
  ]) {
    const e = gateWith({ QA19_PX_TWEAK: tweak });
    log(`QA19-L1 ${tweak}`, e);
    assert.ok(qaOnly(e) && e.some((x) => /per-run scope-only Landlock domain/.test(x)), `${tweak}: ${JSON.stringify(e)}`);
  }
});

const FAKE = "5a1e".repeat(10); // 40 hex chars, not an object in any fixture repository
test("QA19-P1 D-035 at gate level: a gate naming a source_commit that does not exist is rejected", () => {
  const cur = gateWith({ QA19_FAKE_COMMIT: FAKE });
  log("QA19-P1 current", cur);
  const hist = gateWith({ QA19_FAKE_COMMIT: FAKE }, "historical");
  log("QA19-P1 historical", hist);
  assert.ok(hist.length > 0, "historical mode accepted a gate whose source_commit does not exist");
  assert.ok(cur.length > 0, "current mode accepted a gate whose source_commit does not exist (D-035 tolerance reached the gate round)");
});

test("QA19-P4 D-035 at gate level, no fix_revision to trip over: accepted-observation fixture whose gate source_commit does not exist", () => {
  const ctl = gateWith({}, undefined, { severity: "Low", mandatory: false, accept: true });
  log("QA19-P4 control (accept fixture, real commit)", ctl);
  assert.deepEqual(ctl, []);
  const cur = gateWith({ QA19_FAKE_COMMIT: FAKE }, undefined, { severity: "Low", mandatory: false, accept: true });
  log("QA19-P4 current", cur);
  const hist = gateWith({ QA19_FAKE_COMMIT: FAKE }, "historical", { severity: "Low", mandatory: false, accept: true });
  log("QA19-P4 historical", hist);
  assert.ok(hist.some((x) => /cannot recompute from 5a1e/.test(x)), "historical mode must reject");
  assert.ok(cur.length > 0, "current mode accepted an APPROVED gate whose source_commit (and gate-round manifest source_commit) does not exist");
});

test("QA19-P2 D-035: a present-but-different source_commit in a round manifest is still rejected", () => {
  const f = build({});
  try {
    const m = fx.readJ(f.repo, f.mrel);
    const errs = [];
    // A reachable commit whose candidate content differs (app/main.txt changed), then dropped from the branch.
    writeFileSync(join(f.repo, "app/main.txt"), "v2-divergent\n");
    const other = fx.commitAll(f.repo, "divergent content");
    git(f.repo, "reset", "-q", "--hard", "HEAD~1");
    writeFileSync(join(f.repo, f.mrel), JSON.stringify({ ...m, source_commit: other }, null, 1));
    rules.findManifest(f.repo, "DG0", f.cid, errs, "qa19-p2");
    log("QA19-P2", errs);
    assert.ok(errs.some((x) => /does not describe its source_commit/.test(x)), JSON.stringify(errs));
  } finally { rmSync(f.repo, { recursive: true, force: true }); }
});

test("QA19-P3 D-035 probe: a round manifest source_commit that is an existing non-commit object (a tree id)", () => {
  const f = build({});
  try {
    const m = fx.readJ(f.repo, f.mrel);
    const tree = git(f.repo, "rev-parse", `${f.commit}^{tree}`);
    writeFileSync(join(f.repo, f.mrel), JSON.stringify({ ...m, source_commit: tree }, null, 1));
    const errs = [];
    rules.findManifest(f.repo, "DG0", f.cid, errs, "qa19-p3");
    log("QA19-P3 (tree id as source_commit)", errs);
    // Recorded as an observation either way; the assertion documents what the candidate does.
    console.log(`  QA19-P3 result: ${errs.length ? "REJECTED" : "TOLERATED (an existing non-commit object is treated as 'missing')"}`);
  } finally { rmSync(f.repo, { recursive: true, force: true }); }
});

test("QA19-W1 D-034: delete + same-blob re-add of a committed review sidecar is still rejected; a different-blob re-add too", () => {
  for (const variant of ["same-blob", "different-blob"]) {
    const f = build({});
    try {
      const side = "docs/delivery/reviews/DG0/round-1/qa-verifier.findings.json";
      const before = readFileSync(join(f.repo, side));
      git(f.repo, "rm", "-q", side);
      git(f.repo, "commit", "-q", "-m", "outcome commit deletes a committed sidecar (round-17 mishap)");
      mkdirSync(dirname(join(f.repo, side)), { recursive: true });
      writeFileSync(join(f.repo, side), variant === "same-blob" ? before : Buffer.concat([before, Buffer.from(" ")]));
      git(f.repo, "add", side);
      git(f.repo, "commit", "-q", "-m", `re-add (${variant})`);
      const errs = [];
      rules.checkWriteOnce(f.repo, "DG0", errs);
      log(`QA19-W1 ${variant}`, errs);
      assert.ok(errs.some((x) => /qa-verifier\.findings\.json has a D event/.test(x)), `${variant}: ${JSON.stringify(errs)}`);
    } finally { rmSync(f.repo, { recursive: true, force: true }); }
  }
});

test("QA19-I1 D-034: import-findings skips a record-less verifications sidecar and never deletes it", () => {
  const dir = mkdtempSync(join(tmpdir(), "qa19-import-"));
  try {
    cpSync(join(ROOT, "tools/gates"), join(dir, "tools/gates"), { recursive: true });
    const finding = { id: "F-DG0-299", stage_id: "DG0", requirement: "REQ-DLV-001", severity: "Low", mandatory_violation: false, title: "qa19 probe finding",
      reproduction: "qa19 fixture", expected: "stays pending", actual: "stays pending", evidence: [], reported_by: "qa-verifier", reported_in: "docs/delivery/reviews/DG0/round-1/qa-verifier.json",
      owner: "delivery-orchestrator", status: "FIXED_PENDING_VERIFICATION", history: [{ at: "2026-09-30T00:00:00Z", status: "OPEN" }] };
    mkdirSync(join(dir, "docs/delivery/reviews/DG0/round-7"), { recursive: true });
    writeFileSync(join(dir, "docs/delivery/findings.json"), JSON.stringify({ schema_version: 1, findings: [finding] }, null, 1));
    const vrel = "docs/delivery/reviews/DG0/round-7/qa-verifier.verifications.json";
    writeFileSync(join(dir, vrel), JSON.stringify({ verifications: [{ finding_id: "F-DG0-299", result: "PASS", status_after: "CLOSED_VERIFIED", note: "qa19 note", evidence: [] }] }));
    const run = () => spawnSync(process.execPath, [join(dir, "tools/gates/import-findings.mjs"), "--stage", "DG0", "--round", "7"], { encoding: "utf8" });
    let r = run();
    console.log(`  QA19-I1 record-less: exit=${r.status} stdout=${JSON.stringify(r.stdout.trim())} stderr=${JSON.stringify(r.stderr.trim().slice(0, 300))}`);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /skip qa-verifier verifications/);
    assert.equal(JSON.parse(readFileSync(join(dir, "docs/delivery/findings.json"), "utf8")).findings[0].status, "FIXED_PENDING_VERIFICATION");
    assert.ok(existsSync(join(dir, vrel)), "the interrupted run's sidecar must stay");
    // Positive control: with the reviewer's record present the same sidecar IS imported.
    writeFileSync(join(dir, "docs/delivery/reviews/DG0/round-7/qa-verifier.json"), JSON.stringify({ invocation_reference: { kind: "claude-code-cli-session", run_id: "DG0-T-QA19-qa-verifier-20260930T010000Z-00000001", session_id: "00000000-0000-4000-8000-000000000001" }, reviewed_at: "2026-09-30T01:00:00Z" }));
    r = run();
    console.log(`  QA19-I1 with record: exit=${r.status} stdout=${JSON.stringify(r.stdout.trim())} stderr=${JSON.stringify(r.stderr.trim().slice(0, 400))}`);
    const after = JSON.parse(readFileSync(join(dir, "docs/delivery/findings.json"), "utf8")).findings[0];
    assert.equal(after.status, "CLOSED_VERIFIED");
    assert.equal(after.verification.by_role, "qa-verifier");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("QA19-M1 metadata invariance: round-19-style review/gate/run/assignment/test-evidence metadata doesn't change the candidate ID", () => {
  const dir = mkdtempSync(join(tmpdir(), "qa19-meta-"));
  try {
    git(ROOT, "clone", "-q", ROOT, join(dir, "c"));
    const c = join(dir, "c");
    const spec = JSON.parse(readFileSync(join(c, "docs/delivery/stages.json"), "utf8")).stages[0].candidate_spec;
    const id0 = cand.candidateId(cand.manifestFromWorkingTree(c, spec));
    for (const p of ["docs/delivery/reviews/DG0/round-99/qa-verifier.json", "docs/delivery/gates/DG0.json", "docs/delivery/runs/DG0/X/meta.json",
      "docs/delivery/assignments/DG0/round-99/review-qa-verifier.md", "docs/delivery/test-evidence/DG0/qa/round-99/x.log", "docs/delivery/findings.json",
      "docs/delivery/progress.md", "docs/delivery/candidates/DG0/x.manifest.json", "docs/delivery/handbacks/DG0/x.md"]) {
      mkdirSync(dirname(join(c, p)), { recursive: true });
      writeFileSync(join(c, p), `qa19 metadata ${p}\n`);
    }
    const id1 = cand.candidateId(cand.manifestFromWorkingTree(c, spec));
    writeFileSync(join(c, "docs/analysis/glossary.md"), readFileSync(join(c, "docs/analysis/glossary.md"), "utf8") + "\nqa19\n");
    const id2 = cand.candidateId(cand.manifestFromWorkingTree(c, spec));
    console.log(`  QA19-M1 base=${id0} after-metadata=${id1} after-content-edit=${id2}`);
    assert.equal(id1, id0);
    assert.notEqual(id2, id0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

process.on("exit", () => rmSync(adaptDir, { recursive: true, force: true }));
