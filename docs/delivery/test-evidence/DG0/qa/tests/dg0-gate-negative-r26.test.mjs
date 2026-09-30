// qa-verifier, DG0 round 26 (T-DG0-REV-QA-R26): independent checks of D-042 (F-DG0-169) -- checkClosure anchor 1 (the
// verifying round's frozen source_commit) is UNCONDITIONAL -- plus re-confirmation of the standing strict controls, on
// the independent round-9 fixture as adapted in round 21 (harness prelude loaded from dg0-gate-negative-r21.test.mjs
// next to this file, the same method as rounds 22-25). Node built-ins only; every fixture is a disposable git repository
// under $TMPDIR, removed afterwards. Author: qa-verifier.
//
// What is new versus tools/gates/tests/validator.test.mjs: the D-042 unit test ("D-042 / F-DG0-169") takes a VALID
// fixture and only rewrites review_rounds[1].source_commit to "a"*40, so its fix is anyway in every commit. These cases
// build the round-25 attack shapes and malformed-metadata variants the unit test does not:
//
//   QA26-G0  control ACCEPTED: genuine PRESENT round-3 closure whose fix is in the frozen round candidate
//   QA26-N1  THE ROUND-25 CASE (my round-25 probe QA25-P1, now expected rejected): forged superseded round whose
//            source_commit is self-declared absent; the fix is committed after the (claimed) freeze but BEFORE the
//            verifier's run, so it IS in the run head (anchor 2 holds) and in the gate (anchor 3 holds):
//            (a) non-candidate fix; (b) CANDIDATE-SCOPE fix (changes app/main.txt) -> REJECTED by the F-DG0-169 error
//            ONLY; plus the validate.mjs CLI exits non-zero on (b)
//   QA26-N2  absent round source_commit with an otherwise perfect fix (committed before everything: in every anchor) ->
//            still REJECTED (no absence escape at all, whatever the fix)
//   QA26-N3  round source_commit that is a PRESENT 40-hex object which is NOT a commit (a tree, a blob) -> REJECTED
//   QA26-N4  scope: an absent-source_commit superseded round that verifies NO closure (its sidecar is empty) -> no
//            F-DG0-169 error (the rejection is closure-scoped; the D-035 manifest tolerance is otherwise intact)
//   QA26-N5  the round-23 forge (absent source + fix after the run) is now rejected by BOTH anchor 1 (absent) and anchor 2
//   QA26-N6  standing: genuine present-round post-freeze fix -> anchor 1; fix_revision all-zero/absent; run head
//            absent/"unknown"; a later-round sidecar downgrading severity / mandatory_violation (F-DG0-165); a shallow
//            clone is refused (F-DG0-160/248)
// Run: QA_REPO_ROOT=<complete clone of the candidate> node --test <this file>
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

Object.assign(process.env, { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "qa26", GIT_COMMITTER_NAME: "qa26",
  GIT_AUTHOR_EMAIL: "qa26@example.invalid", GIT_COMMITTER_EMAIL: "qa26@example.invalid" });
const here = dirname(fileURLToPath(import.meta.url));
if (!process.env.QA_REPO_ROOT) process.env.QA_REPO_ROOT = execFileSync("git", ["-C", here, "rev-parse", "--show-toplevel"]).toString().trim();
process.env.QA_REPO_ROOT = resolve(process.env.QA_REPO_ROOT);
const ROOT = process.env.QA_REPO_ROOT;
const git = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();

// ---- harness: the round-21 prelude (fixture adaptation), exported with addRound as well (same method as rounds 22-25)
const hdir = mkdtempSync(join(tmpdir(), "qa26-h-"));
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
const VALIDATE_CLI = join(ROOT, "tools/gates/validate.mjs");

const FJ = "docs/delivery/findings.json";
const GATE = "docs/delivery/gates/DG0.json";
const SPEC = { include: ["**"], exclude: ["trading_agent/**"] };
const HIGH = { severity: "High", mandatory: false };
const CLOSE = { verifications: [{ finding_id: "F-DG0-201", result: "PASS", status_after: "CLOSED_VERIFIED", note: "fixed", evidence: [] }] };
const ABS_SRC = "cd".repeat(20);
const A0_RE = /F-DG0-201.*verified in round-3, whose frozen candidate source_commit .* is not present; a closure must be verified against a retained candidate \(F-DG0-169\)/;
const A1_RE = /F-DG0-201.*is not in the verified round-3 candidate/;
const A2_RE = /F-DG0-201.*is not in the verifying run's starting history/;
const A3_RE = /F-DG0-201.*fix .* is not in the gate candidate/;
const ANY169 = /F-DG0-169/;
const log = (id, e) => console.log(`  ${id} errors (${e.length}): ${JSON.stringify(e)}`);
const errsOf = (repo) => fx.validateGate(repo, "DG0").map(String);
const withF = (opts, fn) => { const f = fx.fixture(opts); try { return fn(f); } finally { rmSync(f.repo, { recursive: true, force: true }); } };
const present = (repo, s) => { try { git(repo, "cat-file", "-e", `${s}^{commit}`); return true; } catch { return false; } };
const isAnc = (repo, a, b) => { try { git(repo, "merge-base", "--is-ancestor", a, b); return true; } catch { return false; } };
const has = (e, re) => e.some((x) => re.test(x));
const runMeta = (ref) => `docs/delivery/runs/DG0/${ref.run_id}/meta.json`;
const anchors = (e) => ["A0", "A1", "A2", "A3"].filter((k, i) => has(e, [A0_RE, A1_RE, A2_RE, A3_RE][i]));
const verdict = (e) => `${e.length ? "REJECTED" : "ACCEPTED"} anchors=${anchors(e).join("+") || "-"} total=${e.length}`;

const mirror = (f, ref, fix) => {
  fx.mutate(f.repo, FJ, (d) => {
    if (ref) d.findings[0].verification.invocation_reference = ref;
    if (fix === undefined) delete d.findings[0].fix_revision; else d.findings[0].fix_revision = fix;
  });
  fx.commitAll(f.repo, "findings mirror");
};
const excludedCommit = (f, label) => { fx.write(f.repo, `trading_agent/${label}.txt`, `${label}\n`); return fx.commitAll(f.repo, label); };
const setMain = (f, text, label) => { fx.write(f.repo, "app/main.txt", text); return fx.commitAll(f.repo, label); };

/** Commits a GENUINE round-3 manifest for commit `frz` (recomputes from it); returns its cid. */
function round3Manifest(f, frz) {
  const m = fx.readJ(f.repo, f.mrel);
  const entries = cand.manifestFromRef(f.repo, frz, SPEC);
  const cid = cand.candidateId(entries);
  assert.notEqual(cid, f.cid, "setup: the round-3 candidate must differ from the gate candidate");
  fx.write(f.repo, fx.manifestRel(cid), { ...m, candidate_id: cid, source_commit: frz, entries });
  fx.commitAll(f.repo, "round-3 freeze metadata (manifest)");
  return cid;
}
/** Commits a FORGED superseded-round manifest with synthetic entries and the given source_commit; returns its cid. */
function forgedManifest(f, src, seed) {
  const m = fx.readJ(f.repo, f.mrel);
  const entries = [{ path: "app/main.txt", sha256: seed.repeat(64), mode: "100644" }];
  const cid = cand.candidateId(entries);
  fx.write(f.repo, fx.manifestRel(cid), { ...m, candidate_id: cid, source_commit: src, entries });
  fx.commitAll(f.repo, `forged superseded-round manifest (source_commit ${String(src).slice(0, 10)})`);
  return cid;
}

/** Re-derives the gate onto commit `g` (same candidate content, same cid) and re-runs the auditor (as in rounds 24-25). */
function moveGate(f, g) {
  fx.mutate(f.repo, f.mrel, (m) => (m.source_commit = g));
  fx.mutate(f.repo, "docs/delivery/stages.json", (d) => {
    d.stages[0].candidate.source_commit = g;
    for (const r of d.stages[0].review_rounds) if (r.candidate_id === f.cid) r.source_commit = g;
  });
  fx.commitAll(f.repo, "re-derived gate candidate metadata");
  const assign = "docs/delivery/assignments/DG0/round-2/review-release-auditor.md";
  const run = fx.allocRun(f.repo, "release-auditor", { assignment: assign, task: "T-DG0-AUDIT-R2b" });
  const rec = f.recs["release-auditor"];
  fx.mutate(f.repo, rec, (r) => { r.invocation_reference = run.ref; });
  fx.mutate(f.repo, GATE, (gr) => { gr.source_commit = g; gr.invocation_reference = run.ref; });
  run.finish([rec, GATE]);
  fx.commitAll(f.repo, "re-run audit");
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// moveGate rewrites two write-once files (shared gate manifest, auditor round-2 record): those harness artefacts, and ONLY
// those (exact path), are excluded; every other error is asserted on.
const movedErrs = (f) => {
  const art = new RegExp(`^write-once: (${esc(f.recs["release-auditor"])}|${esc(f.mrel)}) (has a M event|was committed with 2 different contents)`);
  const all = errsOf(f.repo);
  const n = all.filter((x) => art.test(x)).length;
  console.log(`  (moveGate write-once artefacts excluded: ${n})`);
  return all.filter((x) => !art.test(x));
};

/** Genuine PRESENT round 3 (content C3), then C2 restored; fixAt as in the round-25 suite. */
function genuineRound3(f, fixAt) {
  let fix = fixAt === "before-freeze" ? excludedCommit(f, "fix-before-freeze") : null;
  const frz3 = setMain(f, "v3-frozen\n", "round-3 freeze (content C3)");
  const cid3 = round3Manifest(f, frz3);
  const restore = setMain(f, "v1\n", "candidate-scope fix: restore C2");
  if (fixAt === "after-freeze-cand") fix = restore;
  const ref = fx.addRound(f, 3, "qa-verifier", CLOSE, { roundMeta: { candidate_id: cid3, source_commit: frz3 } });
  const vhead = fx.readJ(f.repo, runMeta(ref)).head_commit_at_start;
  mirror(f, ref, fix);
  moveGate(f, git(f.repo, "rev-parse", "HEAD"));
  return { frz3, cid3, fix, ref, vhead, gsc: fx.readJ(f.repo, GATE).source_commit };
}

/**
 * Forged superseded round 3 whose source_commit is `src` (absent or a non-commit object). `fixAt`:
 *   "before-all"        excluded-path commit before the forged manifest (in the run head and the gate)
 *   "after-freeze-excl" excluded-path commit after the forged manifest, before the run (in the run head and the gate)
 *   "after-freeze-cand" candidate-scope: app/main.txt set to C3 before the manifest; the C2-restoring commit after it,
 *                       before the run, is the fix (in the run head and the gate)
 *   "after-run"         excluded-path commit after the verifier's run (in the gate only)
 */
function forgedRound3(f, src, fixAt, { sidecar = CLOSE, seed = "4" } = {}) {
  let fix = fixAt === "before-all" ? excludedCommit(f, "fix-before-all") : null;
  if (fixAt === "after-freeze-cand") setMain(f, "v3-claimed\n", "content before the claimed round-3 freeze");
  const cid = forgedManifest(f, src, seed);
  if (fixAt === "after-freeze-excl") fix = excludedCommit(f, "fix-after-claimed-freeze");
  if (fixAt === "after-freeze-cand") fix = setMain(f, "v1\n", "candidate-scope fix after the claimed freeze: restore C2");
  const ref = fx.addRound(f, 3, "qa-verifier", sidecar, { roundMeta: { candidate_id: cid, source_commit: src } });
  const vhead = fx.readJ(f.repo, runMeta(ref)).head_commit_at_start;
  if (fixAt === "after-run") fix = excludedCommit(f, "fix-after-run");
  // No closure in this round (QA26-N4): leave findings.json (the original round-2 closure and its fix) untouched.
  if (sidecar === CLOSE) mirror(f, ref, fix);
  moveGate(f, git(f.repo, "rev-parse", "HEAD"));
  return { cid, fix, ref, vhead, gsc: fx.readJ(f.repo, GATE).source_commit };
}

// ------------------------------------------------------------------------------------------------ control
test("QA26-G0 control: genuine present-round closure with the fix in the frozen round candidate is ACCEPTED", () => withF(HIGH, (f) => {
  const s = genuineRound3(f, "before-freeze");
  assert.ok(present(f.repo, s.frz3) && isAnc(f.repo, s.fix, s.frz3) && isAnc(f.repo, s.fix, s.vhead) && isAnc(f.repo, s.fix, s.gsc), "setup");
  const e = movedErrs(f);
  log("QA26-G0", e);
  console.log(`  QA26-G0 result: ${verdict(e)}`);
  assert.equal(verdict(e), "ACCEPTED anchors=- total=0");
}));

// ------------------------------------------------------------------------------------------------ D-042: the round-25 case
test("QA26-N1 round-25 case: forged-absent round, fix after the claimed freeze but before the run -> REJECTED by F-DG0-169 only", () => {
  const res = {};
  for (const at of ["after-freeze-excl", "after-freeze-cand"]) withF(HIGH, (f) => {
    const s = forgedRound3(f, ABS_SRC, at);
    assert.ok(!present(f.repo, ABS_SRC), "setup: round-3 source_commit is absent");
    assert.ok(isAnc(f.repo, s.fix, s.vhead) && s.fix !== s.vhead, "setup: the fix is in the verifier's run head (anchor 2 holds)");
    assert.ok(isAnc(f.repo, s.fix, s.gsc), "setup: the fix is in the gate candidate (anchor 3 holds)");
    const e = movedErrs(f);
    log(`QA26-N1 ${at}`, e);
    res[at] = verdict(e);
    if (at === "after-freeze-cand") {
      const r = spawnSync(process.execPath, [VALIDATE_CLI, "--stage", "DG0"], { env: { ...process.env, GATE_REPO_ROOT: f.repo } });
      const out = `${r.stdout}${r.stderr}`;
      console.log(`  QA26-N1 CLI exit=${r.status} mentions F-DG0-169=${ANY169.test(out)}`);
      res["cli-exit-nonzero"] = r.status !== 0 && ANY169.test(out);
    }
  });
  console.log(`  QA26-N1 result: ${JSON.stringify(res)}`);
  assert.deepEqual(res, { "after-freeze-excl": "REJECTED anchors=A0 total=1", "after-freeze-cand": "REJECTED anchors=A0 total=1", "cli-exit-nonzero": true });
});

test("QA26-N2 absent round source_commit with a fix that is in every other anchor -> still REJECTED (no absence escape)", () => withF(HIGH, (f) => {
  const s = forgedRound3(f, ABS_SRC, "before-all");
  assert.ok(isAnc(f.repo, s.fix, s.vhead) && isAnc(f.repo, s.fix, s.gsc), "setup");
  const e = movedErrs(f);
  log("QA26-N2", e);
  console.log(`  QA26-N2 result: ${verdict(e)}`);
  assert.equal(verdict(e), "REJECTED anchors=A0 total=1");
}));

test("QA26-N3 round source_commit is a PRESENT 40-hex object that is not a commit (tree, blob) -> REJECTED", () => {
  const res = {};
  for (const kind of ["tree", "blob"]) withF(HIGH, (f) => {
    const obj = kind === "tree" ? git(f.repo, "rev-parse", "HEAD^{tree}") : git(f.repo, "rev-parse", "HEAD:app/main.txt");
    assert.equal(git(f.repo, "cat-file", "-t", obj), kind, "setup: object type");
    assert.match(obj, /^[0-9a-f]{40}$/);
    forgedRound3(f, obj, "before-all", { seed: kind === "tree" ? "5" : "6" });
    const e = movedErrs(f);
    log(`QA26-N3 ${kind}`, e);
    res[kind] = has(e, A0_RE) ? "REJECTED-by-F-DG0-169" : e.length ? `REJECTED-other ${JSON.stringify(e)}` : "ACCEPTED";
  });
  console.log(`  QA26-N3 result: ${JSON.stringify(res)}`);
  assert.deepEqual(res, { tree: "REJECTED-by-F-DG0-169", blob: "REJECTED-by-F-DG0-169" });
});

test("QA26-N4 scope: an absent-source superseded round that verifies NO closure raises no F-DG0-169 error", () => withF(HIGH, (f) => {
  forgedRound3(f, ABS_SRC, "before-all", { sidecar: { verifications: [] } });
  const e = movedErrs(f);
  log("QA26-N4", e);
  const r = { f169: has(e, ANY169), total: e.length };
  console.log(`  QA26-N4 result: ${JSON.stringify(r)}`);
  assert.equal(r.f169, false, "the F-DG0-169 rejection must be closure-scoped");
  assert.equal(r.total, 0, "an absent-source superseded round without closures stays tolerated (D-035)");
}));

test("QA26-N5 round-23 forge (absent source, fix after the run) -> REJECTED by anchor 1 (absent) AND anchor 2", () => withF(HIGH, (f) => {
  const s = forgedRound3(f, ABS_SRC, "after-run");
  assert.ok(isAnc(f.repo, s.vhead, s.fix) && s.vhead !== s.fix && isAnc(f.repo, s.fix, s.gsc), "setup");
  const e = movedErrs(f);
  log("QA26-N5", e);
  console.log(`  QA26-N5 result: ${verdict(e)}`);
  assert.equal(verdict(e), "REJECTED anchors=A0+A2 total=2");
}));

// ------------------------------------------------------------------------------------------------ standing controls
test("QA26-N6 standing: present-round post-freeze fix; bad fix_revision; bad run head; F-DG0-165 downgrade; shallow clone", () => {
  const res = {};
  withF(HIGH, (f) => { genuineRound3(f, "after-freeze-cand"); res["post-freeze-fix"] = verdict(movedErrs(f)); });
  for (const label of ["fix-all-zero", "fix-absent"]) withF(HIGH, (f) => {
    genuineRound3(f, "before-freeze");
    mirror(f, null, label === "fix-all-zero" ? "0".repeat(40) : undefined);
    const e = movedErrs(f);
    res[label] = has(e, /F-DG0-201.*(CLOSED_VERIFIED needs a full fix_revision commit id|is not a commit present in this repository)/) ? "REJECTED" : `NOT-REJECTED ${JSON.stringify(e)}`;
  });
  for (const label of ["head-absent", "head-unknown"]) withF(HIGH, (f) => {
    const s = genuineRound3(f, "before-freeze");
    fx.mutate(f.repo, runMeta(s.ref), (m) => { if (label === "head-absent") delete m.head_commit_at_start; else m.head_commit_at_start = "unknown"; });
    fx.commitAll(f.repo, `round-3 run head ${label}`);
    const e = movedErrs(f);
    res[label] = has(e, /verification.*(head_commit_at_start .* is not a 40-hex commit id|a commit absent from this repository)/) ? "REJECTED" : `NOT-REJECTED ${JSON.stringify(e)}`;
  });
  withF({ severity: "Critical", mandatory: true }, (f) => {
    const down = { id: "F-DG0-201", stage_id: "DG0", requirement: "REQ-DLV-001", severity: "Low", mandatory_violation: false,
      title: "probe finding", reproduction: "fixture", expected: "rejected", actual: "accepted", evidence: [], reported_by: "qa-verifier",
      reported_in: "docs/delivery/reviews/DG0/round-7/qa-verifier.json", owner: "delivery-orchestrator", status: "OPEN" };
    fx.write(f.repo, "docs/delivery/reviews/DG0/round-7/qa-verifier.findings.json", { findings: [down] });
    fx.mutate(f.repo, FJ, (d) => { d.findings[0].severity = "Low"; d.findings[0].mandatory_violation = false; });
    fx.commitAll(f.repo, "round-7 downgrade of both, findings.json follows");
    const e = errsOf(f.repo);
    res["downgrade-both"] = `severity-drift=${has(e, /finding F-DG0-201 severity .* differs from its first raising sidecar/)} mandatory-drift=${has(e, /finding F-DG0-201 mandatory_violation .* differs from its first raising sidecar/)}`;
  });
  withF(HIGH, (f) => {
    for (let i = 0; i < 3; i++) git(f.repo, "commit", "-q", "--allow-empty", "-m", `pad ${i}`);
    const base = mkdtempSync(join(tmpdir(), "qa26-sh-"));
    try {
      const d = join(base, "shallow");
      execFileSync("git", ["clone", "-q", "--depth=2", `file://${f.repo}`, d], { stdio: ["ignore", "pipe", "pipe"] });
      res["shallow-refused"] = git(d, "rev-parse", "--is-shallow-repository") === "true" && has(errsOf(d), /the repository is a shallow clone/);
    } finally { rmSync(base, { recursive: true, force: true }); }
  });
  console.log(`  QA26-N6 result: ${JSON.stringify(res)}`);
  assert.deepEqual(res, { "post-freeze-fix": "REJECTED anchors=A1 total=1", "fix-all-zero": "REJECTED", "fix-absent": "REJECTED",
    "head-absent": "REJECTED", "head-unknown": "REJECTED", "downgrade-both": "severity-drift=true mandatory-drift=true", "shallow-refused": true });
});

process.on("exit", () => rmSync(hdir, { recursive: true, force: true }));
