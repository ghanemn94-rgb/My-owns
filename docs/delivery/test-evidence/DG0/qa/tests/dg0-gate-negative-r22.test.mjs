// qa-verifier, DG0 round 22 (T-DG0-REV-QA-R22): independent checks of the D-038 repairs (F-DG0-158/159/160/163/245)
// and of F-DG0-238, on the independent round-9 fixture as adapted in rounds 20/21 (the round-21 file's harness prelude is
// re-used verbatim, loaded from dg0-gate-negative-r21.test.mjs next to this file). Node built-ins + python3 only; every
// fixture is a disposable git repository under $TMPDIR, removed afterwards. Author: qa-verifier. None of these cases
// exists in tools/gates/tests/validator.test.mjs (checked: no unit test there mentions a shallow clone at all).
// Run: QA_REPO_ROOT=<complete clone of the candidate> node --test <this file>
//
//   QA22-N1  F-DG0-160: a --depth=1 clone of a VALID fixture is refused (shallow error); a complete --no-local clone of
//            the same fixture validates with zero errors (the refusal is exactly the shallow condition)
//   QA22-N2  F-DG0-158: a finding imported from a record-less sidecar and later DELETED from findings.json is "dropped"
//            (open and closed variants; listed round without a record AND an unlisted round directory)
//   QA22-N3  F-DG0-159: gate-round head_commit_at_start variants that are not exactly lowercase 40-hex -- uppercase,
//            trailing newline, 41-hex, a 12-hex ABBREVIATION of the real head (which git would resolve) -- are rejected
//   QA22-N4  F-DG0-159: a malformed head ('unknown', '') is rejected even in a round whose source_commit is absent
//            (the absent-round tolerance never covers a malformed value)
//   QA22-N5  F-DG0-245: fix_revision variants on a gate-round closure -- uppercase of the real fix, 12-hex abbreviation
//            of the real fix, all-zero -- are rejected
//   QA22-N6  tolerance control: a genuinely superseded round (source_commit AND run head both absent, own manifest --
//            the real round-18 shape in a --no-local clone) closing with a well-formed absent fix is accepted
//   QA22-N7  PROBE (new finding): a GENUINE run (present head that contains the round manifest) in a round whose
//            committed manifest + stages entry name an ABSENT source_commit closes a High finding with an all-zero
//            fix_revision -- the "round absent" condition is self-declared by orchestrator-written metadata. Asserts the
//            desired (fail-closed) behaviour, so it FAILS on the round-22 candidate.
//   QA22-N8  F-DG0-238 (= F-DG0-150): the exact round-17 collision shape on the current agent_sandbox.py finish():
//            exit 3, sandbox.json written with the discard, real record untouched, no traceback
//   QA22-N9  F-DG0-163 end to end: the REAL review.schema.json rejects a real round-21 review record carrying own
//            Object.prototype-named keys (top level, nested in checks_run[0] and in invocation_reference)
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

Object.assign(process.env, { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "qa22", GIT_COMMITTER_NAME: "qa22",
  GIT_AUTHOR_EMAIL: "qa22@example.invalid", GIT_COMMITTER_EMAIL: "qa22@example.invalid" });
const here = dirname(fileURLToPath(import.meta.url));
if (!process.env.QA_REPO_ROOT) process.env.QA_REPO_ROOT = execFileSync("git", ["-C", here, "rev-parse", "--show-toplevel"]).toString().trim();
process.env.QA_REPO_ROOT = resolve(process.env.QA_REPO_ROOT);
const ROOT = process.env.QA_REPO_ROOT;
const git = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();

// ---- harness: the round-21 prelude (fixture adaptation), exported with addRound as well
const hdir = mkdtempSync(join(tmpdir(), "qa22-h-"));
{
  const s = readFileSync(join(here, "dg0-gate-negative-r21.test.mjs"), "utf8");
  const cut = s.indexOf("// ------------------------------------------------------------------------------------------------ round-21 cases");
  assert.ok(cut > 0, "round-21 harness marker not found");
  let p = s.slice(0, cut);
  const a1 = "const here = dirname(fileURLToPath(import.meta.url));";
  const a2 = "export { fixture, validateGate, manifestRel, mutate, readJ, commitAll, write, allocRun, git as fxgit };";
  assert.ok(p.includes(a1) && p.includes(a2), "round-21 harness anchors not found");
  p = p.replace(a1, () => `const here = ${JSON.stringify(here)};`).replace(a2, () => a2.replace("allocRun,", "allocRun, addRound,"));
  writeFileSync(join(hdir, "h.mjs"), p + "\nexport { fx };\n");
}
const { fx } = await import(pathToFileURL(join(hdir, "h.mjs")).href);
const cand = await import(pathToFileURL(join(ROOT, "tools/gates/lib/candidate.mjs")).href);
const { validate: validateSchema } = await import(pathToFileURL(join(ROOT, "tools/gates/lib/schema.mjs")).href);

const FJ = "docs/delivery/findings.json";
const HIGH = { severity: "High", mandatory: false };
const CLOSE = { verifications: [{ finding_id: "F-DG0-201", result: "PASS", status_after: "CLOSED_VERIFIED", note: "fixed", evidence: [] }] };
const ABS_SRC = "ab".repeat(20);
const ABS_HEAD = "cd".repeat(20);
const log = (id, e) => console.log(`  ${id} errors (${e.length}): ${JSON.stringify(e)}`);
const errsOf = (repo) => fx.validateGate(repo, "DG0").map(String);
const withF = (opts, fn) => { const f = fx.fixture(opts); try { return fn(f); } finally { rmSync(f.repo, { recursive: true, force: true }); } };
const present = (repo, s) => { try { git(repo, "cat-file", "-e", `${s}^{commit}`); return true; } catch { return false; } };
const rewriteMeta = (f, role, fn) => {
  fx.mutate(f.repo, `docs/delivery/runs/DG0/${f.refs[role].run_id}/meta.json`, fn);
  git(f.repo, "commit", "-q", "--amend", "-a", "--no-edit");
};
/** Commits a manifest for a fabricated superseded candidate whose source_commit is `src` (absent); returns its cid. */
function supersededManifest(f, src) {
  const m = fx.readJ(f.repo, f.mrel);
  const entries = [{ path: "app/main.txt", sha256: "3".repeat(64), mode: "100644" }];
  const cid = cand.candidateId(entries);
  fx.write(f.repo, fx.manifestRel(cid), { ...m, candidate_id: cid, source_commit: src, entries });
  fx.commitAll(f.repo, "superseded-round manifest");
  return cid;
}
/** Round 3 re-verifies F-DG0-201 (qa-verifier) in a round whose source_commit is absent; mirrors the closure. */
function closeInAbsentRound(f, { head, fix }) {
  const cid = supersededManifest(f, ABS_SRC);
  const ref = fx.addRound(f, 3, "qa-verifier", CLOSE, { roundMeta: { candidate_id: cid, source_commit: ABS_SRC }, ...(head !== undefined ? { head } : {}) });
  fx.mutate(f.repo, FJ, (d) => { d.findings[0].verification.invocation_reference = ref; d.findings[0].fix_revision = fix; });
  fx.commitAll(f.repo, "findings mirror");
}

// ------------------------------------------------------------------------------------------------ F-DG0-160
test("QA22-N1 F-DG0-160: a shallow clone of a valid fixture is refused; a complete --no-local clone of it is accepted", () => withF(undefined, (f) => {
  assert.deepEqual(errsOf(f.repo), [], "control: the fixture itself is valid");
  const base = mkdtempSync(join(tmpdir(), "qa22-sh-"));
  try {
    const sh = join(base, "shallow");
    const full = join(base, "full");
    execFileSync("git", ["clone", "-q", "--depth=1", `file://${f.repo}`, sh]);
    execFileSync("git", ["clone", "-q", "--no-local", f.repo, full]);
    assert.equal(git(sh, "rev-parse", "--is-shallow-repository"), "true");
    assert.equal(git(full, "rev-parse", "--is-shallow-repository"), "false");
    const es = errsOf(sh);
    const ef = errsOf(full);
    log("QA22-N1 shallow", es);
    log("QA22-N1 full", ef);
    assert.ok(es.some((e) => /the repository is a shallow clone/.test(e) && /F-DG0-160/.test(e)), JSON.stringify(es));
    assert.deepEqual(ef, [], "a complete clone of the same valid fixture must validate cleanly");
    // Unshallowing the same clone removes the refusal (the condition, not the path, is what is refused).
    execFileSync("git", ["-C", sh, "fetch", "-q", "--unshallow"]);
    const eu = errsOf(sh);
    log("QA22-N1 unshallowed", eu);
    assert.ok(!eu.some((e) => /shallow clone/.test(e)), JSON.stringify(eu));
  } finally { rmSync(base, { recursive: true, force: true }); }
}));

// ------------------------------------------------------------------------------------------------ F-DG0-158
test("QA22-N2 F-DG0-158: a finding imported from a record-less sidecar and later deleted from findings.json is 'dropped'", () => {
  const cases = [
    ["listed round-1, role without a record, OPEN finding", "docs/delivery/reviews/DG0/round-1", "domain-reviewer", "OPEN"],
    ["unlisted round-7 directory, CLOSED finding", "docs/delivery/reviews/DG0/round-7", "code-security-reviewer", "CLOSED_VERIFIED"],
  ];
  for (const [label, dir, role, status] of cases) withF(undefined, (f) => {
    const nf = { id: "F-DG0-290", stage_id: "DG0", requirement: "REQ-DLV-001", severity: "High", mandatory_violation: true,
      title: "qa22 interrupted-run finding", reproduction: "fixture", expected: "x", actual: "y", evidence: [], reported_by: role,
      reported_in: `${dir}/${role}.json`, owner: "delivery-orchestrator", status: "OPEN" };
    fx.write(f.repo, `${dir}/${role}.findings.json`, { findings: [nf] });
    // Imported (as import-findings does), possibly progressed, then silently deleted in a later commit.
    fx.mutate(f.repo, FJ, (d) => d.findings.push({ ...nf, status, history: [{ at: "2026-09-28T13:40:00Z", status }] }));
    fx.commitAll(f.repo, "import");
    fx.mutate(f.repo, FJ, (d) => { d.findings = d.findings.filter((x) => x.id !== "F-DG0-290"); });
    fx.commitAll(f.repo, "silently delete it");
    const e = errsOf(f.repo);
    log(`QA22-N2 ${label}`, e);
    assert.ok(e.some((x) => new RegExp(`finding F-DG0-290 raised in ${dir.replace(/\//g, "\\/")}/${role}\\.findings\\.json is missing from findings\\.json \\(dropped\\)`).test(x)), JSON.stringify(e));
  });
});

// ------------------------------------------------------------------------------------------------ F-DG0-159
test("QA22-N3 F-DG0-159: gate-round head_commit_at_start that is not exactly lowercase 40-hex is rejected (all four roles)", () => {
  const res = {};
  for (const [label, tweak] of [
    ["uppercase", (m) => { m.head_commit_at_start = m.head_commit_at_start.toUpperCase(); }],
    ["trailing-newline", (m) => { m.head_commit_at_start = `${m.head_commit_at_start}\n`; }],
    ["41-hex", (m) => { m.head_commit_at_start = `${m.head_commit_at_start}0`; }],
    ["abbrev-12 of the REAL head", (m) => { m.head_commit_at_start = m.head_commit_at_start.slice(0, 12); }],
  ]) {
    for (const role of ["domain-reviewer", "code-security-reviewer", "qa-verifier", "release-auditor"]) withF(undefined, (f) => {
      rewriteMeta(f, role, tweak);
      const e = errsOf(f.repo);
      const hit = e.some((x) => /head_commit_at_start .* is not a 40-hex commit id/.test(x));
      res[`${label}/${role}`] = hit ? "REJECTED" : (e.length ? `REJECTED-OTHER ${JSON.stringify(e)}` : "ACCEPTED");
    });
  }
  console.log(`  QA22-N3 result: ${JSON.stringify(res)}`);
  assert.ok(Object.values(res).every((r) => r === "REJECTED"), JSON.stringify(res));
});

test("QA22-N4 F-DG0-159: a malformed head is rejected even in a round whose source_commit is absent", () => {
  for (const head of ["unknown", ""]) withF(HIGH, (f) => {
    closeInAbsentRound(f, { head, fix: f.commit });
    const e = errsOf(f.repo);
    log(`QA22-N4 head=${JSON.stringify(head)}`, e);
    assert.ok(e.some((x) => /head_commit_at_start .* is not a 40-hex commit id/.test(x)), JSON.stringify(e));
  });
});

// ------------------------------------------------------------------------------------------------ F-DG0-245
test("QA22-N5 F-DG0-245: malformed or absent fix_revision on a gate-round closure is rejected", () => {
  const res = {};
  for (const [label, val] of [["uppercase-real", (c) => c.toUpperCase()], ["abbrev-12-real", (c) => c.slice(0, 12)], ["all-zero", () => "0".repeat(40)]]) withF(HIGH, (f) => {
    fx.mutate(f.repo, FJ, (d) => (d.findings[0].fix_revision = val(f.commit)));
    fx.commitAll(f.repo, `fix_revision ${label}`);
    const e = errsOf(f.repo);
    log(`QA22-N5 ${label}`, e);
    res[label] = e.some((x) => /F-DG0-201/.test(x) && /(CLOSED_VERIFIED needs a full fix_revision commit id|is not a commit in this repository, but round-2 is retained)/.test(x)) ? "REJECTED" : "ACCEPTED";
  });
  console.log(`  QA22-N5 result: ${JSON.stringify(res)}`);
  assert.ok(Object.values(res).every((r) => r === "REJECTED"), JSON.stringify(res));
});

// ------------------------------------------------------------------------------------------------ tolerance control
test("QA22-N6 control: a genuinely superseded round (source_commit and run head both absent) with a well-formed absent fix is accepted", () => withF(HIGH, (f) => {
  closeInAbsentRound(f, { head: ABS_HEAD, fix: "ef".repeat(20) });
  assert.ok(!present(f.repo, ABS_SRC) && !present(f.repo, ABS_HEAD));
  const e = errsOf(f.repo);
  log("QA22-N6", e);
  assert.deepEqual(e, [], "the D-038 scoped tolerance must still accept the round-18 shape");
}));

// ------------------------------------------------------------------------------------------------ new finding probe
test("QA22-N7 PROBE: a genuine run (present head containing the manifest) in a self-declared 'absent' round cannot close with an all-zero fix", () => withF(HIGH, (f) => {
  closeInAbsentRound(f, { fix: "0".repeat(40) }); // head = addRound's real commit, which contains the superseded manifest
  const e = errsOf(f.repo);
  log("QA22-N7", e);
  console.log(`  QA22-N7 result: ${e.length ? "REJECTED" : "ACCEPTED"} (a present verifier head that contains the round manifest proves the round's source_commit ` +
    "was reachable at run time, so an absent source_commit here is not a pruned round; the fix-absent tolerance should not apply)");
  assert.ok(e.length > 0, "a round declared absent only by orchestrator-written metadata let an all-zero fix_revision close a High finding");
}));

// ------------------------------------------------------------------------------------------------ F-DG0-238
test("QA22-N8 F-DG0-238 (= F-DG0-150): the round-17 same-role collision is a clean discard in finish()", () => {
  const base = mkdtempSync(join(tmpdir(), "qa22-sbx-"));
  try {
    const repo = join(base, "repo");
    execFileSync("git", ["init", "-q", "-b", "main", repo]);
    cpSync(join(ROOT, "tools", "agents"), join(repo, "tools", "agents"), { recursive: true, filter: (s) => !s.includes("__pycache__") });
    const put = (root, rel, c) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), c); };
    for (const [rel, c] of Object.entries({ "CLAUDE.md": "rules\n", ".claude/agents/x.md": "agent\n", "docs/source/s.md": "source\n",
      "docs/delivery/requirements.csv": "req_id\n", "docs/delivery/reviews/DG0/round-1/qa-verifier.json": "{\"verdict\":\"R1\"}\n", "docs/delivery/gates/DG1.json": "{}\n" })) put(repo, rel, c);
    for (const d of ["docs/delivery/runs/DG0", "docs/delivery/handbacks", "tests/qa", "e2e", ...["domain", "code-security", "qa", "audit"].map((k) => `docs/delivery/test-evidence/DG0/${k}`)])
      mkdirSync(join(repo, d), { recursive: true });
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "fixture");
    const home = join(base, "home");
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(join(home, ".claude", "settings.json"), "{}\n");
    const runTmp = mkdtempSync(join(base, "mth-run."));
    const state = mkdtempSync(join(base, "mth-state."));
    const env = { ...process.env, HOME: home };
    const py = ["-I", "-B", join(repo, "tools/agents/agent_sandbox.py")];
    execFileSync("python3", [...py, "prepare", "qa-verifier", repo, repo, "DG0", runTmp, state, process.execPath], { env, cwd: "/" });
    const staging = JSON.parse(readFileSync(join(state, "plan.json"), "utf8")).staged.find((s) => s.rel === "docs/delivery/reviews/DG0").staging;
    // Round-17 reproduction: this run writes its record + findings sidecar; another same-role run commits the record first.
    put(staging, "round-2/qa-verifier.findings.json", "{\"findings\":[]}\n");
    put(staging, "round-2/qa-verifier.json", "{\"verdict\":\"THIS-RUN\"}\n");
    const real = join(repo, "docs/delivery/reviews/DG0");
    put(real, "round-2/qa-verifier.json", "{\"verdict\":\"OTHER-RUN\"}\n");
    const out = mkdtempSync(join(base, "out-"));
    const r = spawnSync("python3", [...py, "finish", state, out], { env, cwd: "/", encoding: "utf8" });
    const sj = join(out, "sandbox.json");
    const summary = existsSync(sj) ? JSON.parse(readFileSync(sj, "utf8")) : null;
    console.log(`  QA22-N8 status=${r.status} sandbox.json=${summary ? "written" : "MISSING"} traceback=${/Traceback|FileExistsError/.test(r.stderr)} ` +
      `copied_back=${JSON.stringify(summary && summary.copied_back)} discarded=${JSON.stringify(summary && summary.discarded)}`);
    assert.doesNotMatch(r.stderr, /Traceback|FileExistsError/, "no uncaught exception");
    assert.equal(r.status, 3, "a discard is fail-closed with exit 3");
    assert.ok(summary, "sandbox.json must always be written");
    assert.match(summary.discarded.join("\n"), /round-2\/qa-verifier\.json: already present in the real tree; write-once/);
    assert.equal(readFileSync(join(real, "round-2/qa-verifier.json"), "utf8"), "{\"verdict\":\"OTHER-RUN\"}\n", "the other run's record is untouched");
  } finally { rmSync(base, { recursive: true, force: true }); }
});

// ------------------------------------------------------------------------------------------------ F-DG0-163
test("QA22-N9 F-DG0-163: the real review schema rejects Object.prototype-named extra keys in a real review record", () => {
  const schema = JSON.parse(readFileSync(join(ROOT, "tools/gates/schemas/review.schema.json"), "utf8"));
  const text = readFileSync(join(ROOT, "docs/delivery/reviews/DG0/round-21/qa-verifier.json"), "utf8");
  assert.deepEqual(validateSchema(schema, JSON.parse(text), schema), [], "control: the committed record is schema-valid");
  const res = {};
  for (const key of ["constructor", "toString", "hasOwnProperty", "__proto__", "valueOf", "isPrototypeOf"]) {
    for (const where of ["top", "checks_run[0]", "invocation_reference"]) {
      const rec = JSON.parse(text);
      const target = where === "top" ? rec : where === "checks_run[0]" ? rec.checks_run[0] : rec.invocation_reference;
      Object.defineProperty(target, key, { value: "x", enumerable: true, writable: true, configurable: true }); // an OWN key, as JSON.parse creates
      assert.ok(Object.hasOwn(target, key));
      const e = validateSchema(schema, rec, schema);
      res[`${where}.${key}`] = e.some((x) => x.includes(`unexpected property '${key}'`)) ? "REJECTED" : `ACCEPTED ${JSON.stringify(e)}`;
    }
  }
  console.log(`  QA22-N9 result: ${JSON.stringify(res)}`);
  // Only locations the schema closes with additionalProperties:false can reject; report which are closed.
  const closed = { top: schema.additionalProperties === false };
  console.log(`  QA22-N9 schema closed at top level: ${closed.top}`);
  assert.ok(Object.entries(res).filter(([k]) => k.startsWith("top.")).every(([, v]) => v === "REJECTED"), JSON.stringify(res));
  assert.ok(Object.entries(res).filter(([k]) => k.startsWith("checks_run[0].")).every(([, v]) => v === "REJECTED"), JSON.stringify(res));
});

process.on("exit", () => rmSync(hdir, { recursive: true, force: true }));
