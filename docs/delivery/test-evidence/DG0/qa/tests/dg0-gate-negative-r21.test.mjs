// qa-verifier, DG0 round 21 (T-DG0-REV-QA-R21): independent gate negatives for the D-037 repairs (F-DG0-241/242/243),
// on the same independent round-9 fixture adapted in round 20 (copied harness below; Node built-ins only; every fixture is
// a disposable git repository under $TMPDIR, removed afterwards). Author: qa-verifier. None of these cases exists in
// tools/gates/tests/validator.test.mjs.
// Run: QA_REPO_ROOT=<clone of the candidate> node --test <this file>   (needs dg0-gate-negative-r9.test.mjs next to it)
//
//   QA21-G0  control: the fixture validates cleanly (current mode), close and accept shapes
//   QA21-C1  F-DG0-242: a PRESENT fix_revision that is a later (descendant) commit is still rejected (round + gate)
//   QA21-C2  F-DG0-242: a PRESENT fix_revision that is an off-branch dangling commit is still rejected
//   QA21-C3  probe: a fix_revision that does NOT EXIST (1-hex typo of the real fix) in the GATE round, whose own
//            source_commit IS present (so the fix provably cannot be its ancestor in a full clone)
//   QA21-C4  probe: the gate-round run's head_commit_at_start is a non-existent commit (round-9 QA5-N52 shape, per role)
//   QA21-C5  probe: the gate-round run's meta has NO head_commit_at_start at all (round-9 QA5-N53 shape, per role);
//            C5b null, C5c 'HEAD' (informational), C5d 'unknown' (run-agent.sh fallback)
//   QA21-C6  F-DG0-243: a record-less verifications sidecar cannot close a finding (findings.json CLOSED_VERIFIED
//            backed only by an interrupted run's sidecar is rejected)
//   QA21-C7  F-DG0-243: a record-less findings sidecar does not hide an OPEN High finding that IS in findings.json
//   QA21-C8  F-DG0-243: a sidecar whose record FILE exists but is unlisted is still rejected (verifications + findings drop)
//   QA21-C9  F-DG0-241: gate source_commit off-branch / annotated tag / missing -> rejected in current mode (D-036 kept)
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
writeFileSync(join(adaptDir, "fx.mjs"), prelude + "\nexport { fixture, validateGate, manifestRel, mutate, readJ, commitAll, write, allocRun, git as fxgit };\n");
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

// ------------------------------------------------------------------------------------------------ round-21 cases
const ACCEPT = { severity: "Low", mandatory: false, accept: true };
const HIGH = { severity: "High", mandatory: false };
const FJ = "docs/delivery/findings.json";
const R1 = "docs/delivery/reviews/DG0/round-1";
const withF = (opts, fn) => { const f = fx.fixture(opts); try { return fn(f); } finally { rmSync(f.repo, { recursive: true, force: true }); } };
const errsOf = (f, mode) => fx.validateGate(f.repo, "DG0", ...(mode ? [{ mode }] : [])).map(String);
const rewriteMeta = (f, role, fn) => {
  fx.mutate(f.repo, `docs/delivery/runs/DG0/${f.refs[role].run_id}/meta.json`, fn);
  git(f.repo, "commit", "-q", "--amend", "-a", "--no-edit");
};
const present = (repo, s) => { try { git(repo, "cat-file", "-e", `${s}^{commit}`); return true; } catch { return false; } };
const newFinding = (id, role, severity, mandatory) => ({ id, stage_id: "DG0", requirement: "REQ-DLV-001", severity, mandatory_violation: mandatory,
  title: `qa21 probe ${id}`, reproduction: "fixture", expected: "x", actual: "y", evidence: [], reported_by: role,
  reported_in: `${R1}/${role}.json`, owner: "delivery-orchestrator", status: "OPEN" });

test("QA21-G0 control: the fixture validates cleanly in current mode (close and accept shapes)", () => {
  for (const opts of [undefined, ACCEPT, HIGH]) withF(opts, (f) => { const e = errsOf(f); log(`QA21-G0 ${JSON.stringify(opts || {})}`, e); assert.deepEqual(e, []); });
});

test("QA21-C1 F-DG0-242: a PRESENT fix_revision that is a later (descendant) commit is still rejected", () => withF(HIGH, (f) => {
  const later = git(f.repo, "rev-parse", "HEAD"); // the runner's evidence commit: present, a descendant of the freeze commit
  assert.notEqual(later, f.commit);
  fx.mutate(f.repo, FJ, (d) => (d.findings[0].fix_revision = later));
  fx.commitAll(f.repo, "fix_revision -> later commit");
  const e = errsOf(f);
  log("QA21-C1", e);
  assert.ok(e.some((x) => /F-DG0-201.*fix [0-9a-f]{10} is not in the verified round-2 candidate/.test(x)), JSON.stringify(e));
  assert.ok(e.some((x) => /F-DG0-201.*fix [0-9a-f]{10} is not in the gate candidate/.test(x)), JSON.stringify(e));
}));

test("QA21-C2 F-DG0-242: a PRESENT fix_revision that is an off-branch dangling commit is still rejected", () => withF(HIGH, (f) => {
  const dangling = git(f.repo, "commit-tree", `${f.commit}^{tree}`, "-p", f.commit, "-m", "off-branch fix");
  assert.ok(present(f.repo, dangling));
  fx.mutate(f.repo, FJ, (d) => (d.findings[0].fix_revision = dangling));
  fx.commitAll(f.repo, "fix_revision -> dangling commit");
  const e = errsOf(f);
  log("QA21-C2", e);
  assert.ok(e.some((x) => /F-DG0-201.*is not in the verified round-2 candidate/.test(x)), JSON.stringify(e));
}));

test("QA21-C3 probe: a NON-EXISTENT fix_revision (1-hex typo) on a closure verified in the GATE round (source_commit present)", () => withF(HIGH, (f) => {
  const real = f.commit;
  const typo = real.slice(0, 39) + (real[39] === "0" ? "1" : "0");
  assert.ok(!present(f.repo, typo) && present(f.repo, real));
  fx.mutate(f.repo, FJ, (d) => (d.findings[0].fix_revision = typo));
  fx.commitAll(f.repo, "fix_revision typo");
  const e = errsOf(f);
  log("QA21-C3 typo", e);
  const z = "0".repeat(40);
  fx.mutate(f.repo, FJ, (d) => (d.findings[0].fix_revision = z));
  fx.commitAll(f.repo, "fix_revision all-zero");
  const e0 = errsOf(f);
  log("QA21-C3 all-zero", e0);
  console.log(`  QA21-C3 result: typo=${e.length ? "REJECTED" : "ACCEPTED"} all-zero=${e0.length ? "REJECTED" : "ACCEPTED"} ` +
    `(the verifying round-2 source_commit ${real.slice(0, 10)} is present, so a missing fix cannot be its ancestor in a full clone)`);
  // Desired behaviour (QA): a missing fix_revision whose verifying round's source_commit IS present is not a pruned commit.
  assert.ok(e.length > 0, "a typo'd, non-existent fix_revision on a gate-round closure was ACCEPTED");
  assert.ok(e0.length > 0, "an all-zero fix_revision on a gate-round closure was ACCEPTED");
}));

for (const [id, what, tweak] of [
  ["QA21-C4", "a non-existent head_commit_at_start (QA5-N52 shape)", (m) => { m.head_commit_at_start = "f".repeat(40); }],
  ["QA21-C5", "NO head_commit_at_start at all (QA5-N53 shape)", (m) => { delete m.head_commit_at_start; }],
  ["QA21-C5b", "head_commit_at_start = null", (m) => { m.head_commit_at_start = null; }],
  ["QA21-C5c", "head_commit_at_start = a symbolic ref word 'HEAD' (resolves at validation time; pre-D-037 behaviour, informational)", (m) => { m.head_commit_at_start = "HEAD"; }],
  ["QA21-C5d", "head_commit_at_start = 'unknown' (the runner's own fallback when git rev-parse fails, run-agent.sh:64)", (m) => { m.head_commit_at_start = "unknown"; }],
]) {
  test(`${id} probe: a GATE-round review/audit run whose meta has ${what}`, () => {
    const res = {};
    for (const role of ["domain-reviewer", "code-security-reviewer", "qa-verifier", "release-auditor"]) withF(undefined, (f) => {
      rewriteMeta(f, role, tweak);
      const e = errsOf(f);
      log(`${id} ${role}`, e);
      res[role] = e.length ? "REJECTED" : "ACCEPTED";
    });
    console.log(`  ${id} result: ${JSON.stringify(res)}`);
    // Desired behaviour (round-9 QA5-N52/N53, F-DG0-212): the gate-round run must be shown to start after the freeze.
    assert.ok(Object.values(res).every((r) => r === "REJECTED"), `accepted: ${JSON.stringify(res)}`);
  });
}

test("QA21-C6 F-DG0-243: a record-less verifications sidecar cannot close a finding", () => {
  for (const [label, dir, role] of [["round-1 (listed round, role without record)", R1, "domain-reviewer"], ["round-3 (unlisted round)", "docs/delivery/reviews/DG0/round-3", "qa-verifier"]]) withF(ACCEPT, (f) => {
    fx.write(f.repo, `${dir}/${role}.verifications.json`, { verifications: [{ finding_id: "F-DG0-201", result: "PASS", status_after: "CLOSED_VERIFIED", note: "record-less close", evidence: [] }] });
    fx.mutate(f.repo, FJ, (d) => {
      const x = d.findings[0];
      x.status = "CLOSED_VERIFIED"; x.fix_revision = f.commit; x.acceptance = null;
      x.verification = { by_role: role, invocation_reference: f.refs["qa-verifier"], at: "2026-09-28T13:30:00Z", result: "PASS", evidence: [], note: "record-less close" };
      x.history.push({ at: "2026-09-28T13:40:00Z", status: "CLOSED_VERIFIED" });
    });
    fx.mutate(f.repo, f.gateRel, (g) => (g.accepted_observations = []));
    fx.commitAll(f.repo, "close via record-less sidecar");
    const e = errsOf(f);
    log(`QA21-C6 ${label}`, e);
    assert.ok(e.some((x) => /F-DG0-201/.test(x)), `closure backed only by a record-less sidecar was accepted: ${JSON.stringify(e)}`);
  });
});

test("QA21-C7 F-DG0-243: a record-less findings sidecar does not hide an OPEN High finding that IS in findings.json", () => withF(undefined, (f) => {
  const nf = newFinding("F-DG0-277", "domain-reviewer", "High", true);
  fx.write(f.repo, `${R1}/domain-reviewer.findings.json`, { findings: [nf] });
  fx.mutate(f.repo, FJ, (d) => d.findings.push({ ...nf, history: [{ at: "2026-09-28T13:40:00Z", status: "OPEN" }] }));
  fx.commitAll(f.repo, "record-less findings sidecar + imported OPEN High");
  const e = errsOf(f);
  log("QA21-C7 open", e);
  assert.ok(e.some((x) => /F-DG0-277 \(High, mandatory\): unresolved \(OPEN\)/.test(x)), JSON.stringify(e));
  // ...and marking it CLOSED_VERIFIED without any bound verifying sidecar is rejected too.
  fx.mutate(f.repo, FJ, (d) => { const x = d.findings.find((y) => y.id === "F-DG0-277"); x.status = "CLOSED_VERIFIED"; x.fix_revision = f.commit; });
  fx.commitAll(f.repo, "fake close");
  const e2 = errsOf(f);
  log("QA21-C7 fake-close", e2);
  assert.ok(e2.some((x) => /F-DG0-277/.test(x)), JSON.stringify(e2));
}));

test("QA21-C8 F-DG0-243: a sidecar whose record FILE exists but is unlisted is still rejected (drop + unlisted)", () => withF(undefined, (f) => {
  const nf = newFinding("F-DG0-278", "domain-reviewer", "High", true);
  fx.write(f.repo, `${R1}/domain-reviewer.findings.json`, { findings: [nf] });
  fx.write(f.repo, `${R1}/domain-reviewer.json`, fx.readJ(f.repo, f.recs["domain-reviewer"]));
  fx.write(f.repo, `${R1}/domain-reviewer.verifications.json`, { verifications: [] });
  fx.commitAll(f.repo, "unlisted record file + sidecars; finding not imported");
  const e = errsOf(f);
  log("QA21-C8", e);
  assert.ok(e.some((x) => /finding F-DG0-278 raised in .*round-1\/domain-reviewer\.findings\.json is missing from findings\.json \(dropped\)/.test(x)), JSON.stringify(e));
  assert.ok(e.some((x) => /domain-reviewer's record for round-1 is not listed in stages\.json review_rounds/.test(x)), JSON.stringify(e));
}));

for (const [id, variant, re] of [
  ["QA21-C9a", "dangling-same", /gate source_commit .* is not a commit reachable on this branch/],
  ["QA21-C9b", "tag", /gate source_commit .* is not a commit object in this repository \(tag\)/],
  ["QA21-C9c", "missing", /gate source_commit .* is not a commit object in this repository \(absent\)/],
  ["QA21-C9d", "tree", /gate source_commit .* is not a commit object in this repository \(tree\)/],
]) {
  test(`${id} F-DG0-241: gate source_commit variant '${variant}' is rejected in current mode`, () => {
    const e = gateWith({ QA20_VARIANT: variant }, undefined, ACCEPT);
    log(`${id} ${variant}`, e);
    assert.ok(e.some((x) => re.test(x)), JSON.stringify(e));
  });
}

process.on("exit", () => rmSync(adaptDir, { recursive: true, force: true }));
