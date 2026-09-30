// qa-verifier, DG0 round 27 (T-DG0-REV-QA-R27): independent checks of D-043 (F-DG0-170, comment-only change to
// tools/gates/lib/rules.mjs) plus new boundary cases of the standing strict closure controls, on the independent
// round-9 fixture as adapted in round 21 (harness prelude loaded from dg0-gate-negative-r21.test.mjs next to this file,
// the same method as rounds 22-26). Node built-ins only; every fixture is a disposable git repository under $TMPDIR,
// removed afterwards. Author: qa-verifier.
//
// None of these cases exists in tools/gates/tests/validator.test.mjs (which covers: all-zero / "not-a-commit" / 7-hex
// abbreviated fix, a fix newer than the round, absent round source_commit, head "unknown"/absent/all-zero, shallow clone,
// and a tag object as the GATE source_commit only):
//
//   QA27-E1  BEHAVIOURAL EQUIVALENCE of D-043: the pre-D-043 rules.mjs (7edacdc2, extracted with git archive) and the
//            candidate rules.mjs return IDENTICAL error lists over a battery of 8 fixtures (genuine control, genuine
//            post-freeze fix, forged-absent round, fix all-zero, run head "unknown", severity downgrade, side-branch
//            fix, fix == round source_commit)
//   QA27-N1  fix_revision is the UPPER-CASE spelling of a genuine, otherwise valid fix commit -> REJECTED (format)
//   QA27-N2  fix_revision is a PRESENT 40-hex object that is not a commit (tree, blob) -> REJECTED
//   QA27-N3  fix_revision is a 40-hex ANNOTATED TAG object that peels to a valid fix commit -> behaviour recorded
//   QA27-N4  non-linear history: fix committed on a side branch forked BEFORE the round freeze but merged AFTER it
//            (older author date, not in the frozen candidate) -> REJECTED by anchor 1 only
//   QA27-N5  boundary control: fix_revision == the verifying round's frozen source_commit (reflexive ancestry) -> ACCEPTED
//   QA27-N6  the verifying run's head_commit_at_start is (a) a PRESENT tree object id, (b) the UPPER-CASE spelling of the
//            genuine head -> REJECTED
// Run: QA_REPO_ROOT=<complete clone of the candidate> node --test <this file>
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

Object.assign(process.env, { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "qa27", GIT_COMMITTER_NAME: "qa27",
  GIT_AUTHOR_EMAIL: "qa27@example.invalid", GIT_COMMITTER_EMAIL: "qa27@example.invalid" });
const here = dirname(fileURLToPath(import.meta.url));
if (!process.env.QA_REPO_ROOT) process.env.QA_REPO_ROOT = execFileSync("git", ["-C", here, "rev-parse", "--show-toplevel"]).toString().trim();
process.env.QA_REPO_ROOT = resolve(process.env.QA_REPO_ROOT);
const ROOT = process.env.QA_REPO_ROOT;
const git = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
const PRE_D043 = "7edacdc28dd745d8e155402de26416ef89f56faf";

// ---- harness: the round-21 prelude (fixture adaptation), exported with addRound as well (same method as rounds 22-26)
const hdir = mkdtempSync(join(tmpdir(), "qa27-h-"));
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
const rulesNew = await import(pathToFileURL(join(ROOT, "tools/gates/lib/rules.mjs")).href);
// The pre-D-043 validator, extracted from the round-26 candidate baseline into a scratch directory.
const oldDir = join(hdir, "old");
mkdirSync(oldDir);
execFileSync("sh", ["-c", `git -C "${ROOT}" archive ${PRE_D043} tools/gates | tar -x -C "${oldDir}"`]);
const rulesOld = await import(pathToFileURL(join(oldDir, "tools/gates/lib/rules.mjs")).href);

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
const FMT_RE = /F-DG0-201.*(CLOSED_VERIFIED needs a full fix_revision commit id|is not a commit present in this repository)/;
const HEAD_RE = /verification.*(head_commit_at_start .* is not a 40-hex commit id|a commit absent from this repository)|head_commit_at_start/;
const log = (id, e) => console.log(`  ${id} errors (${e.length}): ${JSON.stringify(e)}`);
const withF = (opts, fn) => { const f = fx.fixture(opts); try { return fn(f); } finally { rmSync(f.repo, { recursive: true, force: true }); } };
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

function round3Manifest(f, frz) {
  const m = fx.readJ(f.repo, f.mrel);
  const entries = cand.manifestFromRef(f.repo, frz, SPEC);
  const cid = cand.candidateId(entries);
  assert.notEqual(cid, f.cid, "setup: the round-3 candidate must differ from the gate candidate");
  fx.write(f.repo, fx.manifestRel(cid), { ...m, candidate_id: cid, source_commit: frz, entries });
  fx.commitAll(f.repo, "round-3 freeze metadata (manifest)");
  return cid;
}
function forgedManifest(f, src, seed) {
  const m = fx.readJ(f.repo, f.mrel);
  const entries = [{ path: "app/main.txt", sha256: seed.repeat(64), mode: "100644" }];
  const cid = cand.candidateId(entries);
  fx.write(f.repo, fx.manifestRel(cid), { ...m, candidate_id: cid, source_commit: src, entries });
  fx.commitAll(f.repo, `forged superseded-round manifest (source_commit ${String(src).slice(0, 10)})`);
  return cid;
}
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
// moveGate rewrites two write-once harness files (shared gate manifest, auditor round-2 record): those exact-path
// write-once artefacts, and only those, are excluded; every other error is asserted on.
const filt = (f, all) => {
  const art = new RegExp(`^write-once: (${esc(f.recs["release-auditor"])}|${esc(f.mrel)}) (has a M event|was committed with 2 different contents)`);
  return all.map(String).filter((x) => !art.test(x));
};
const errsWith = (rules, f) => filt(f, rules.validateGate(f.repo, "DG0"));
const movedErrs = (f) => errsWith(rulesNew, f);

/**
 * Genuine PRESENT round 3. fixAt:
 *   "before-freeze"      excluded-path commit before the freeze (in every anchor)
 *   "after-freeze-cand"  the candidate-scope commit restoring C2 after the freeze (anchor 1 must reject)
 *   "at-freeze"          the fix IS the round-3 frozen source_commit (reflexive boundary)
 *   "side-branch"        excluded-path commit on a branch forked before the freeze, merged after it
 */
function genuineRound3(f, fixAt) {
  let fix = fixAt === "before-freeze" ? excludedCommit(f, "fix-before-freeze") : null;
  let branch = null;
  if (fixAt === "side-branch") {
    const cur = git(f.repo, "rev-parse", "--abbrev-ref", "HEAD");
    git(f.repo, "checkout", "-q", "-b", "qa27-side");
    fix = excludedCommit(f, "fix-on-side-branch");
    git(f.repo, "checkout", "-q", cur);
    branch = "qa27-side";
  }
  const frz3 = setMain(f, "v3-frozen\n", "round-3 freeze (content C3)");
  if (fixAt === "at-freeze") fix = frz3;
  const cid3 = round3Manifest(f, frz3);
  if (branch) git(f.repo, "merge", "-q", "--no-ff", "--no-edit", branch);
  const restore = setMain(f, "v1\n", "candidate-scope fix: restore C2");
  if (fixAt === "after-freeze-cand") fix = restore;
  const ref = fx.addRound(f, 3, "qa-verifier", CLOSE, { roundMeta: { candidate_id: cid3, source_commit: frz3 } });
  const vhead = fx.readJ(f.repo, runMeta(ref)).head_commit_at_start;
  mirror(f, ref, fix);
  moveGate(f, git(f.repo, "rev-parse", "HEAD"));
  return { frz3, cid3, fix, ref, vhead, gsc: fx.readJ(f.repo, GATE).source_commit };
}
function forgedRound3(f, src) {
  const fix = excludedCommit(f, "fix-before-all");
  const cid = forgedManifest(f, src, "4");
  const ref = fx.addRound(f, 3, "qa-verifier", CLOSE, { roundMeta: { candidate_id: cid, source_commit: src } });
  mirror(f, ref, fix);
  moveGate(f, git(f.repo, "rev-parse", "HEAD"));
  return { cid, fix, ref };
}

// ------------------------------------------------------------------------------------------------ QA27-E1 (D-043)
test("QA27-E1 D-043 is behaviour-preserving: pre-D-043 and candidate rules.mjs give identical errors on 8 fixtures", () => {
  assert.notEqual(readFileSync(join(oldDir, "tools/gates/lib/rules.mjs"), "utf8"), readFileSync(join(ROOT, "tools/gates/lib/rules.mjs"), "utf8"),
    "setup: the two rules.mjs files must differ textually (the D-043 comment)");
  const battery = [
    ["genuine-control", HIGH, (f) => genuineRound3(f, "before-freeze")],
    ["genuine-post-freeze-fix", HIGH, (f) => genuineRound3(f, "after-freeze-cand")],
    ["forged-absent-round", HIGH, (f) => forgedRound3(f, ABS_SRC)],
    ["fix-all-zero", HIGH, (f) => { genuineRound3(f, "before-freeze"); mirror(f, null, "0".repeat(40)); }],
    ["head-unknown", HIGH, (f) => { const s = genuineRound3(f, "before-freeze"); fx.mutate(f.repo, runMeta(s.ref), (m) => { m.head_commit_at_start = "unknown"; }); fx.commitAll(f.repo, "head unknown"); }],
    ["severity-downgrade", { severity: "Critical", mandatory: true }, (f) => { fx.mutate(f.repo, FJ, (d) => { d.findings[0].severity = "Low"; d.findings[0].mandatory_violation = false; }); fx.commitAll(f.repo, "downgrade"); }],
    ["side-branch-fix", HIGH, (f) => genuineRound3(f, "side-branch")],
    ["fix-equals-round-source", HIGH, (f) => genuineRound3(f, "at-freeze")],
  ];
  const res = {};
  for (const [label, opts, build] of battery) withF(opts, (f) => {
    build(f);
    const a = errsWith(rulesOld, f), b = errsWith(rulesNew, f);
    console.log(`  QA27-E1 ${label}: old=${a.length} new=${b.length} identical=${JSON.stringify(a) === JSON.stringify(b)} new=${JSON.stringify(b)}`);
    res[label] = JSON.stringify(a) === JSON.stringify(b);
  });
  console.log(`  QA27-E1 result: ${JSON.stringify(res)}`);
  assert.ok(Object.values(res).every(Boolean), JSON.stringify(res));
  assert.equal(Object.keys(res).length, 8);
});

// ------------------------------------------------------------------------------------------------ fix_revision shapes
test("QA27-N1 fix_revision spelled in UPPER CASE (a genuine valid fix otherwise) -> REJECTED", () => withF(HIGH, (f) => {
  const s = genuineRound3(f, "before-freeze");
  assert.equal(movedErrs(f).length, 0, "setup: the lower-case spelling is accepted");
  mirror(f, null, s.fix.toUpperCase());
  const e = movedErrs(f);
  log("QA27-N1", e);
  const r = has(e, FMT_RE) ? "REJECTED-format" : e.length ? `REJECTED-other` : "ACCEPTED";
  console.log(`  QA27-N1 result: ${r}`);
  assert.equal(r, "REJECTED-format");
}));

test("QA27-N2 fix_revision is a PRESENT 40-hex tree / blob object -> REJECTED", () => {
  const res = {};
  for (const kind of ["tree", "blob"]) withF(HIGH, (f) => {
    const s = genuineRound3(f, "before-freeze");
    const obj = kind === "tree" ? git(f.repo, "rev-parse", `${s.fix}^{tree}`) : git(f.repo, "rev-parse", `${s.fix}:app/main.txt`);
    assert.equal(git(f.repo, "cat-file", "-t", obj), kind, "setup: object type");
    mirror(f, null, obj);
    const e = movedErrs(f);
    log(`QA27-N2 ${kind}`, e);
    res[kind] = has(e, FMT_RE) ? "REJECTED" : `NOT-REJECTED ${JSON.stringify(e)}`;
  });
  console.log(`  QA27-N2 result: ${JSON.stringify(res)}`);
  assert.deepEqual(res, { tree: "REJECTED", blob: "REJECTED" });
});

test("QA27-N3 fix_revision is an ANNOTATED TAG object id peeling to a valid fix commit -> behaviour recorded", () => withF(HIGH, (f) => {
  const s = genuineRound3(f, "before-freeze");
  git(f.repo, "tag", "-a", "qa27-fix-tag", "-m", "qa27 tag on the fix", s.fix);
  const tagObj = git(f.repo, "rev-parse", "qa27-fix-tag");
  assert.equal(git(f.repo, "cat-file", "-t", tagObj), "tag", "setup: annotated tag object");
  assert.notEqual(tagObj, s.fix);
  mirror(f, null, tagObj);
  const e = movedErrs(f);
  log("QA27-N3", e);
  const r = e.length ? `REJECTED ${JSON.stringify(e)}` : "ACCEPTED (tag peels to the same fix commit, which passes all three anchors)";
  console.log(`  QA27-N3 result: ${r}`);
  // Informational: the contract says "full 40-hex commit id"; record the actual behaviour, whichever it is.
  assert.ok(typeof r === "string");
}));

// ------------------------------------------------------------------------------------------------ anchor-1 boundaries
test("QA27-N4 side-branch fix forked before the freeze, merged after it -> REJECTED by anchor 1 only", () => withF(HIGH, (f) => {
  const s = genuineRound3(f, "side-branch");
  assert.ok(!isAnc(f.repo, s.fix, s.frz3), "setup: the fix is NOT in the frozen round-3 candidate");
  assert.ok(isAnc(f.repo, s.fix, s.vhead) && isAnc(f.repo, s.fix, s.gsc), "setup: the fix is in the run head and the gate");
  const e = movedErrs(f);
  log("QA27-N4", e);
  console.log(`  QA27-N4 result: ${verdict(e)}`);
  assert.equal(verdict(e), "REJECTED anchors=A1 total=1");
}));

test("QA27-N5 boundary control: fix_revision == the round's frozen source_commit -> ACCEPTED (no false positive)", () => withF(HIGH, (f) => {
  const s = genuineRound3(f, "at-freeze");
  assert.equal(s.fix, s.frz3, "setup");
  const e = movedErrs(f);
  log("QA27-N5", e);
  console.log(`  QA27-N5 result: ${verdict(e)}`);
  assert.equal(verdict(e), "ACCEPTED anchors=- total=0");
}));

// ------------------------------------------------------------------------------------------------ run-head shapes
test("QA27-N6 the verifying run's head_commit_at_start is a PRESENT tree id / the UPPER-CASE genuine head -> REJECTED", () => {
  const res = {};
  for (const label of ["tree-id", "upper-case"]) withF(HIGH, (f) => {
    const s = genuineRound3(f, "before-freeze");
    const bad = label === "tree-id" ? git(f.repo, "rev-parse", `${s.vhead}^{tree}`) : s.vhead.toUpperCase();
    fx.mutate(f.repo, runMeta(s.ref), (m) => { m.head_commit_at_start = bad; });
    fx.commitAll(f.repo, `round-3 run head ${label}`);
    const e = movedErrs(f);
    log(`QA27-N6 ${label}`, e);
    res[label] = has(e, HEAD_RE) ? "REJECTED" : e.length ? `REJECTED-other ${JSON.stringify(e)}` : "ACCEPTED";
  });
  console.log(`  QA27-N6 result: ${JSON.stringify(res)}`);
  assert.deepEqual(res, { "tree-id": "REJECTED", "upper-case": "REJECTED" });
});

process.on("exit", () => rmSync(hdir, { recursive: true, force: true }));
