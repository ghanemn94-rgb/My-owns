// qa-verifier, DG0 round 29 (T-DG0-REV-QA-R29): independent verification of D-045 (F-DG0-171 / F-DG0-251) --
// checkReviewRounds rejects a PRESENT review_rounds[].source_commit whose object type is not "commit", and still tolerates a
// genuinely ABSENT one (objectType -> null) -- plus the standing strict-validator controls, on the independent round-9
// fixture as adapted in round 21 (harness prelude loaded from dg0-gate-negative-r21.test.mjs next to this file, the same
// method as rounds 22-28). D-045 cases run BOTH the pre-D-045 validator (331407e9 = round-28 candidate, extracted with git
// archive) and the candidate validator, so reproduction and fix are shown side by side. Node built-ins only; every
// fixture is a disposable git repository under $TMPDIR, removed afterwards. Author: qa-verifier.
//
// tools/gates/tests/validator.test.mjs (D-045 test) covers only: stages.json round-2 source_commit rewritten to a tag
// object that peels to it (tag of the gate commit; the manifest still names the commit), and an absent 'b'x40. None of
// the following exists there:
//
//   QA29-C0  control: genuine round-3 closure, all ids commit objects -> ACCEPTED by old and new
//   QA29-R1  REPRODUCTION of my round-28 QA28-T7 (identical construction: round-3 manifest AND stages.json name an
//            annotated tag peeling to the freeze, closure verified in that round) -> old ACCEPTED, new REJECTED by
//            exactly the D-045 error (and nothing else)
//   QA29-N1  NESTED annotated tag (tag of a tag) as a round source_commit -> new REJECTED "is a tag object"
//   QA29-N2  closure-FREE round whose source_commit is an annotated tag of a TREE (manifest recomputes via ls-tree)
//            -> new REJECTED by D-045 (old behaviour recorded: no closure anchor exists to catch it)
//   QA29-N3  closure-free round whose source_commit is a bare TREE object id -> new REJECTED "is a tree object"
//   QA29-N4  closure-free round whose source_commit is a BLOB object id -> new REJECTED "is a blob object"
//            (old: a blob fails the ^{commit} presence probe, so findManifest's D-035 tolerance treated it as ABSENT)
//   QA29-N5  absence tolerance boundary: closure-free round with a genuinely ABSENT 40-hex source_commit and a
//            content-preserving manifest -> NO D-045 error and zero errors overall (round-18 shape); the same absent round
//            carrying a closure -> REJECTED by D-042 anchor 1 (and still no D-045 error)
//   QA29-N6  format boundary of the same field: "HEAD", a unique 12-hex abbreviation and an UPPERCASE 40-hex id (all
//            resolve to a commit through cat-file -t) -> REJECTED (by the stages schema pattern / manifest mismatch)
//   QA29-S1..S9 standing controls on the candidate validator (asserted, not just compared): fix_revision tag (F-DG0-250);
//            head_commit_at_start tag (D-044); closure in an absent-source round (D-042); genuine-round post-freeze fix
//            (anchor 1); forged-absent-round fix not in the run head (anchor 2); all-zero / absent fix_revision;
//            head_commit_at_start missing / "unknown" / absent; later-round sidecar severity + mandatory downgrade
//            (F-DG0-165); shallow clone refused, complete clone accepted (F-DG0-160/248)
// Run: QA_REPO_ROOT=<complete clone of the candidate> node --test <this file>
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

Object.assign(process.env, { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "qa29", GIT_COMMITTER_NAME: "qa29",
  GIT_AUTHOR_EMAIL: "qa29@example.invalid", GIT_COMMITTER_EMAIL: "qa29@example.invalid" });
const here = dirname(fileURLToPath(import.meta.url));
if (!process.env.QA_REPO_ROOT) process.env.QA_REPO_ROOT = execFileSync("git", ["-C", here, "rev-parse", "--show-toplevel"]).toString().trim();
process.env.QA_REPO_ROOT = resolve(process.env.QA_REPO_ROOT);
const ROOT = process.env.QA_REPO_ROOT;
const git = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
const PRE_D045 = "331407e9b6711abbc01f7ee0456e4fa92ff65cda"; // round-28 candidate baseline (no rscType check)

// ---- harness: the round-21 prelude (fixture adaptation), exported with addRound as well (same method as rounds 22-28)
const hdir = mkdtempSync(join(tmpdir(), "qa29-h-"));
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
const oldDir = join(hdir, "old");
mkdirSync(oldDir);
execFileSync("sh", ["-c", `git -C "${ROOT}" archive ${PRE_D045} tools/gates | tar -x -C "${oldDir}"`]);
const rulesOld = await import(pathToFileURL(join(oldDir, "tools/gates/lib/rules.mjs")).href);
assert.ok(!readFileSync(join(oldDir, "tools/gates/lib/rules.mjs"), "utf8").includes("rscType"), "baseline must predate D-045");
assert.ok(readFileSync(join(ROOT, "tools/gates/lib/rules.mjs"), "utf8").includes("rscType"), "candidate must contain D-045");

const FJ = "docs/delivery/findings.json";
const GATE = "docs/delivery/gates/DG0.json";
const SPEC = { include: ["**"], exclude: ["trading_agent/**"] };
const HIGH = { severity: "High", mandatory: false };
const CLOSE = { verifications: [{ finding_id: "F-DG0-201", result: "PASS", status_after: "CLOSED_VERIFIED", note: "fixed", evidence: [] }] };
const EMPTY = { verifications: [] };
const ABS = "ef".repeat(20);
const D045 = (type) => new RegExp(`review rounds: DG0 round 3 source_commit [0-9a-f]{10} is a ${type} object, not a commit; a round's frozen source_commit must name the freeze commit itself`);
const D045_ANY = /is a \S+ object, not a commit; a round's frozen source_commit/;
const FIX_TAG_RE = /F-DG0-201.*fix [0-9a-f]{10} is a tag object, not a commit; a fix_revision must name the fix commit itself/;
const HEAD_TAG_RE = /started from [0-9a-f]{10}, a tag object, not a commit/;
const NOT_COMMIT_RE = /F-DG0-201.*(is not a commit present in this repository|CLOSED_VERIFIED needs a full fix_revision commit id)/;
const A1_ABSENT_RE = /F-DG0-201.*verified in round-3, whose frozen candidate source_commit [0-9a-f]{10} is not present; a closure must be verified against a retained candidate/;
const A1_RE = /F-DG0-201.*fix [0-9a-f]{10} is not in the verified round-3 candidate/;
const A2_RE = /F-DG0-201.*is not in the verifying run's starting history/;
const log = (id, e) => console.log(`  ${id} errors (${e.length}): ${JSON.stringify(e)}`);
const withF = (opts, fn) => { const f = fx.fixture(opts); try { return fn(f); } finally { rmSync(f.repo, { recursive: true, force: true }); } };
const has = (e, re) => e.some((x) => re.test(x));
const runMeta = (ref) => `docs/delivery/runs/DG0/${ref.run_id}/meta.json`;

const mirror = (f, ref, fix) => {
  fx.mutate(f.repo, FJ, (d) => {
    if (ref) d.findings[0].verification.invocation_reference = ref;
    if (fix === undefined) delete d.findings[0].fix_revision; else d.findings[0].fix_revision = fix;
  });
  fx.commitAll(f.repo, "findings mirror");
};
const excludedCommit = (f, label) => { fx.write(f.repo, `trading_agent/${label}.txt`, `${label}\n`); return fx.commitAll(f.repo, label); };
const setMain = (f, text, label) => { fx.write(f.repo, "app/main.txt", text); return fx.commitAll(f.repo, label); };
/** Commits a round-3 manifest whose entries are computed from `entriesRef` and whose source_commit field is `src`. */
function round3Manifest(f, src, entriesRef) {
  const m = fx.readJ(f.repo, f.mrel);
  const entries = entriesRef ? cand.manifestFromRef(f.repo, entriesRef, SPEC) : [{ path: "app/main.txt", sha256: "7".repeat(64), mode: "100644" }];
  const cid = cand.candidateId(entries);
  assert.notEqual(cid, f.cid, "setup: the round-3 candidate must differ from the gate candidate");
  fx.write(f.repo, fx.manifestRel(cid), { ...m, candidate_id: cid, source_commit: src, entries });
  fx.commitAll(f.repo, `round-3 freeze metadata (manifest source_commit ${String(src).slice(0, 10)})`);
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
// write-once artefacts, and only those, are excluded; every other error is asserted on (same filter as rounds 25-28).
const filt = (f, all) => {
  const art = new RegExp(`^write-once: (${esc(f.recs["release-auditor"])}|${esc(f.mrel)}) (has a M event|was committed with 2 different contents)`);
  return all.map(String).filter((x) => !art.test(x));
};
const errsWith = (rules, f) => filt(f, rules.validateGate(f.repo, "DG0"));
const both = (f) => ({ old: errsWith(rulesOld, f), neu: errsWith(rulesNew, f) });
const annTag = (repo, name, target) => { git(repo, "tag", "-a", name, "-m", `qa29 ${name}`, target); return git(repo, "rev-parse", name); };

/** Genuine round 3 with a closure: fix before the freeze, freeze C3, restore C2, verify in round 3 (fix position configurable). */
function genuineRound3(f, fixAt = "before-freeze") {
  let fix = fixAt === "before-freeze" ? excludedCommit(f, "fix-before-freeze") : null;
  const frz3 = setMain(f, "v3-frozen\n", "round-3 freeze (content C3)");
  const cid3 = round3Manifest(f, frz3, frz3);
  const restore = setMain(f, "v1\n", "candidate-scope fix: restore C2");
  if (fixAt === "after-freeze-cand") fix = restore;
  const ref = fx.addRound(f, 3, "qa-verifier", CLOSE, { roundMeta: { candidate_id: cid3, source_commit: frz3 } });
  const vhead = fx.readJ(f.repo, runMeta(ref)).head_commit_at_start;
  mirror(f, ref, fix);
  moveGate(f, git(f.repo, "rev-parse", "HEAD"));
  return { frz3, cid3, fix, ref, vhead };
}
/** Round 3 whose manifest AND stages.json entry name `src` (built once, no post-commit mutation). Closure optional. */
function round3Named(f, src, entriesRef, { closure = false, fixAfterRun = false, fix: preFix } = {}) {
  let fix = preFix ?? (closure && !fixAfterRun ? excludedCommit(f, "fix-before-round-meta") : null);
  const cid3 = round3Manifest(f, src, entriesRef);
  const ref = fx.addRound(f, 3, "qa-verifier", closure ? CLOSE : EMPTY, { roundMeta: { candidate_id: cid3, source_commit: src } });
  if (closure) {
    if (fixAfterRun) fix = excludedCommit(f, "fix-after-run");
    mirror(f, ref, fix);
  }
  moveGate(f, git(f.repo, "rev-parse", "HEAD"));
  return { cid3, ref, fix };
}
const outcome = (e) => (e.length ? `REJECTED(${e.length})` : "ACCEPTED");

// ------------------------------------------------------------------------------------------------ control
test("QA29-C0 control: genuine three-anchor closure, all ids commit objects -> ACCEPTED by old and new", () => withF(HIGH, (f) => {
  const s = genuineRound3(f);
  for (const id of [s.fix, s.vhead, s.frz3]) assert.equal(git(f.repo, "cat-file", "-t", id), "commit");
  const { old, neu } = both(f);
  log("QA29-C0 old", old); log("QA29-C0 new", neu);
  console.log(`  QA29-C0 result: old=${outcome(old)} new=${outcome(neu)}`);
  assert.deepEqual([old.length, neu.length], [0, 0]);
}));

// ------------------------------------------------------------------------------------------------ D-045 reproduction
test("QA29-R1 reproduction of QA28-T7: round source_commit = annotated TAG of the freeze (closure in that round) -> old ACCEPTED, new REJECTED by exactly D-045", () => withF(HIGH, (f) => {
  // Identical construction to round-28 QA28-T7.
  const fix = excludedCommit(f, "fix-before-freeze");
  const frz3 = setMain(f, "v3-frozen\n", "round-3 freeze (content C3)");
  const tagObj = annTag(f.repo, "qa29-round3-freeze", frz3);
  assert.equal(git(f.repo, "cat-file", "-t", tagObj), "tag");
  assert.equal(git(f.repo, "rev-parse", `${tagObj}^{commit}`), frz3);
  const cid3 = round3Manifest(f, tagObj, frz3);
  setMain(f, "v1\n", "candidate-scope fix: restore C2");
  const ref = fx.addRound(f, 3, "qa-verifier", CLOSE, { roundMeta: { candidate_id: cid3, source_commit: tagObj } });
  mirror(f, ref, fix);
  moveGate(f, git(f.repo, "rev-parse", "HEAD"));
  const { old, neu } = both(f);
  log("QA29-R1 old", old); log("QA29-R1 new", neu);
  console.log(`  QA29-R1 result: old=${outcome(old)} new=${outcome(neu)} new-is-exactly-D-045=${neu.length === 1 && has(neu, D045("tag"))}`);
  assert.equal(old.length, 0, "reproduction: the pre-D-045 validator accepts the tag object (round-28 QA28-T7)");
  assert.equal(neu.length, 1, JSON.stringify(neu));
  assert.ok(has(neu, D045("tag")) && neu[0].includes(tagObj.slice(0, 10)), JSON.stringify(neu));
}));

test("QA29-N1 NESTED annotated tag (tag of a tag) of the freeze as round source_commit -> old ACCEPTED, new REJECTED by exactly D-045", () => withF(HIGH, (f) => {
  const fix = excludedCommit(f, "fix-before-freeze"); // in the frozen candidate, so all three anchors hold via peeling
  const frz3 = setMain(f, "v3-frozen\n", "round-3 freeze (content C3)");
  const outer = annTag(f.repo, "qa29-outer", annTag(f.repo, "qa29-inner", frz3));
  assert.equal(git(f.repo, "cat-file", "-p", outer).split("\n")[1], "type tag", "setup: outer tag points at a tag");
  assert.equal(git(f.repo, "rev-parse", `${outer}^{commit}`), frz3);
  setMain(f, "v1\n", "restore C2");
  round3Named(f, outer, frz3, { closure: true, fix });
  const { old, neu } = both(f);
  log("QA29-N1 old", old); log("QA29-N1 new", neu);
  console.log(`  QA29-N1 result: old=${outcome(old)} new=${neu.length === 1 && has(neu, D045("tag")) ? "REJECTED-by-D-045-only" : JSON.stringify(neu)}`);
  assert.equal(old.length, 0, "the pre-D-045 validator peels the nested tag and accepts");
  assert.equal(neu.length, 1, JSON.stringify(neu));
  assert.ok(has(neu, D045("tag")), JSON.stringify(neu));
}));

// ------------------------------------------------------------------------------------------------ closure-free rounds
// Without a closure there is no checkClosure anchor to catch a non-commit round source_commit; only D-045 and findManifest
// look at it. These show what D-045 adds beyond the closure anchors.
test("QA29-N2 closure-free round, source_commit = annotated tag of a TREE (manifest recomputes via ls-tree) -> new REJECTED by D-045", () => withF(HIGH, (f) => {
  const frz3 = setMain(f, "v3-frozen\n", "round-3 content C3");
  const treeTag = annTag(f.repo, "qa29-tree-tag", git(f.repo, "rev-parse", `${frz3}^{tree}`));
  setMain(f, "v1\n", "restore C2");
  round3Named(f, treeTag, treeTag);
  const { old, neu } = both(f);
  log("QA29-N2 old", old); log("QA29-N2 new", neu);
  console.log(`  QA29-N2 result: old=${outcome(old)} new=${has(neu, D045("tag")) ? `REJECTED-D-045(${neu.length})` : JSON.stringify(neu)}`);
  assert.equal(old.length, 0, "pre-D-045: a tree-tag as a closure-free round's source_commit was accepted");
  assert.deepEqual(neu.length === 1 && has(neu, D045("tag")), true, JSON.stringify(neu));
}));

test("QA29-N3 closure-free round, source_commit = bare TREE object id -> new REJECTED 'is a tree object'", () => withF(HIGH, (f) => {
  const frz3 = setMain(f, "v3-frozen\n", "round-3 content C3");
  const tree = git(f.repo, "rev-parse", `${frz3}^{tree}`);
  assert.equal(git(f.repo, "cat-file", "-t", tree), "tree");
  setMain(f, "v1\n", "restore C2");
  round3Named(f, tree, tree);
  const { old, neu } = both(f);
  log("QA29-N3 old", old); log("QA29-N3 new", neu);
  console.log(`  QA29-N3 result: old=${outcome(old)} new=${has(neu, D045("tree")) ? `REJECTED-D-045(${neu.length})` : JSON.stringify(neu)}`);
  assert.equal(old.length, 0, "pre-D-045: a bare tree id as a closure-free round's source_commit was accepted");
  assert.deepEqual(neu.length === 1 && has(neu, D045("tree")), true, JSON.stringify(neu));
}));

test("QA29-N4 closure-free round, source_commit = BLOB object id -> new REJECTED 'is a blob object' (old treated it as absent)", () => withF(HIGH, (f) => {
  const blob = git(f.repo, "rev-parse", "HEAD:app/main.txt");
  assert.equal(git(f.repo, "cat-file", "-t", blob), "blob");
  round3Named(f, blob, null); // forged entries: a blob cannot be recomputed, so only the tolerance path could accept it
  const { old, neu } = both(f);
  log("QA29-N4 old", old); log("QA29-N4 new", neu);
  console.log(`  QA29-N4 result: old=${outcome(old)} new=${has(neu, D045("blob")) ? `REJECTED-D-045(${neu.length})` : JSON.stringify(neu)}`);
  assert.equal(old.length, 0, "pre-D-045: a blob id (probed with ^{commit}) was treated as ABSENT and tolerated");
  assert.deepEqual(neu.length === 1 && has(neu, D045("blob")), true, JSON.stringify(neu));
}));

test("QA29-N5 absence boundary: ABSENT round source_commit -> no D-045 error (tolerated, round-18 shape); with a closure -> D-042 anchor 1 rejects", () => {
  const res = {};
  withF(HIGH, (f) => {
    const frz3 = setMain(f, "v3-frozen\n", "round-3 content C3"); // content-preserving: entries really hash to the cid
    setMain(f, "v1\n", "restore C2");
    round3Named(f, ABS, frz3);
    assert.throws(() => git(f.repo, "cat-file", "-t", ABS), "setup: ABS must be absent");
    const { old, neu } = both(f);
    log("QA29-N5 closure-free old", old); log("QA29-N5 closure-free new", neu);
    res.closureFree = { old: old.length, new: neu.length, d045: has(neu, D045_ANY) };
  });
  withF(HIGH, (f) => {
    round3Named(f, ABS, null, { closure: true });
    const { old, neu } = both(f);
    log("QA29-N5 with-closure old", old); log("QA29-N5 with-closure new", neu);
    res.withClosure = { a1Absent: has(neu, A1_ABSENT_RE), d045: has(neu, D045_ANY), oldA1Absent: has(old, A1_ABSENT_RE) };
  });
  console.log(`  QA29-N5 result: ${JSON.stringify(res)}`);
  assert.deepEqual(res, { closureFree: { old: 0, new: 0, d045: false }, withClosure: { a1Absent: true, d045: false, oldA1Absent: true } });
});

test("QA29-N6 format boundary: round source_commit 'HEAD' / 12-hex abbreviation / UPPERCASE 40-hex (all resolve to a commit) -> REJECTED", () => {
  const res = {};
  for (const [label, form] of [["HEAD", () => "HEAD"], ["abbrev12", (c) => c.slice(0, 12)], ["uppercase", (c) => c.toUpperCase()]]) withF(HIGH, (f) => {
    const frz3 = setMain(f, "v3-frozen\n", "round-3 content C3");
    const id = form(frz3);
    assert.equal(git(f.repo, "cat-file", "-t", id), "commit", `setup: ${label} must resolve to a commit through cat-file -t`);
    setMain(f, "v1\n", "restore C2");
    round3Named(f, id, frz3, { closure: true });
    const neu = errsWith(rulesNew, f);
    log(`QA29-N6 ${label}`, neu);
    res[label] = neu.length ? "REJECTED" : "ACCEPTED";
  });
  console.log(`  QA29-N6 result: ${JSON.stringify(res)}`);
  assert.deepEqual(res, { HEAD: "REJECTED", abbrev12: "REJECTED", uppercase: "REJECTED" });
});

// ------------------------------------------------------------------------------------------------ standing controls
test("QA29-S1..S9 standing strict-validator controls on the candidate validator", () => {
  const res = {};
  const run = (label, opts, build, check) => withF(opts, (f) => {
    const ctx = build(f);
    const e = errsWith(rulesNew, f);
    log(`QA29-${label}`, e);
    res[label] = check(e, ctx, f) ? "REJECTED-as-expected" : `UNEXPECTED ${JSON.stringify(e)}`;
  });
  run("S1 fix_revision tag (F-DG0-250)", HIGH, (f) => { const s = genuineRound3(f); mirror(f, null, annTag(f.repo, "fixtag", s.fix)); }, (e) => has(e, FIX_TAG_RE));
  run("S2 head_commit_at_start tag (D-044)", HIGH, (f) => {
    const s = genuineRound3(f);
    const t = annTag(f.repo, "headtag", s.vhead);
    fx.mutate(f.repo, runMeta(s.ref), (m) => { m.head_commit_at_start = t; }); fx.commitAll(f.repo, "head -> tag");
  }, (e) => has(e, HEAD_TAG_RE));
  run("S3 closure in absent-source round (D-042)", HIGH, (f) => round3Named(f, ABS, null, { closure: true }), (e) => has(e, A1_ABSENT_RE));
  run("S4 genuine-round post-freeze fix (anchor 1)", HIGH, (f) => genuineRound3(f, "after-freeze-cand"), (e) => has(e, A1_RE));
  run("S5 forged-absent-round fix after the run started (anchor 2)", HIGH, (f) => round3Named(f, ABS, null, { closure: true, fixAfterRun: true }), (e) => has(e, A2_RE));
  run("S6a all-zero fix_revision", HIGH, (f) => { genuineRound3(f); mirror(f, null, "0".repeat(40)); }, (e) => has(e, NOT_COMMIT_RE));
  run("S6b absent 40-hex fix_revision", HIGH, (f) => { genuineRound3(f); mirror(f, null, "a1".repeat(20)); }, (e) => has(e, NOT_COMMIT_RE));
  run("S6c missing fix_revision", HIGH, (f) => { genuineRound3(f); mirror(f, null, undefined); }, (e) => has(e, NOT_COMMIT_RE));
  for (const [lab, val] of [["S7a head missing", undefined], ["S7b head 'unknown'", "unknown"], ["S7c head absent 40-hex", "c3".repeat(20)]]) {
    run(lab, HIGH, (f) => {
      const s = genuineRound3(f);
      fx.mutate(f.repo, runMeta(s.ref), (m) => { if (val === undefined) delete m.head_commit_at_start; else m.head_commit_at_start = val; });
      fx.commitAll(f.repo, `head ${lab}`);
    }, (e) => has(e, /head_commit_at_start (undefined|"unknown") is not a 40-hex commit id|started from c3c3c3c3c3, a commit absent from this repository/));
  }
  const downgrade = (over) => (f) => {
    const first = fx.readJ(f.repo, "docs/delivery/reviews/DG0/round-1/qa-verifier.findings.json").findings.find((x) => x.id === "F-DG0-201");
    assert.ok(first, "setup: F-DG0-201 is first raised in round-1");
    fx.write(f.repo, "docs/delivery/reviews/DG0/round-10/qa-verifier.findings.json",
      { findings: [{ ...first, ...over, reported_in: "docs/delivery/reviews/DG0/round-10/qa-verifier.json" }] });
    fx.commitAll(f.repo, "round-10 downgrade");
    return first;
  };
  run("S8a later-round severity downgrade (F-DG0-165)", { severity: "Critical", mandatory: true }, downgrade({ severity: "Low" }),
    (e, first) => first.severity === "Critical" && has(e, /round-10\/qa-verifier\.findings\.json: finding F-DG0-201 severity \("Low"\) differs from its first raising sidecar .*round-1\//));
  run("S8b later-round mandatory_violation downgrade (F-DG0-165)", { severity: "Critical", mandatory: true }, downgrade({ mandatory_violation: false }),
    (e, first) => first.mandatory_violation === true && has(e, /round-10\/qa-verifier\.findings\.json: finding F-DG0-201 mandatory_violation \(false\) differs from its first raising sidecar/));
  // S9: shallow refusal on a valid fixture; complete clone of the same fixture accepted.
  withF(HIGH, (f) => {
    const base = mkdtempSync(join(tmpdir(), "qa29-sh-"));
    try {
      const sh = join(base, "shallow"), full = join(base, "full");
      execFileSync("git", ["clone", "-q", "--depth=1", `file://${f.repo}`, sh]);
      execFileSync("git", ["clone", "-q", "--no-local", f.repo, full]);
      const es = rulesNew.validateGate(sh, "DG0").map(String), ef = rulesNew.validateGate(full, "DG0").map(String);
      log("QA29-S9 shallow", es); log("QA29-S9 full", ef);
      res["S9 shallow refused / complete accepted"] = git(sh, "rev-parse", "--is-shallow-repository") === "true" && has(es, /the repository is a shallow clone/) && ef.length === 0
        ? "REJECTED-as-expected" : `UNEXPECTED shallow=${JSON.stringify(es)} full=${JSON.stringify(ef)}`;
    } finally { rmSync(base, { recursive: true, force: true }); }
  });
  console.log(`  QA29-S result: ${JSON.stringify(res, null, 1)}`);
  assert.equal(Object.keys(res).length, 14);
  assert.ok(Object.values(res).every((x) => x === "REJECTED-as-expected"), JSON.stringify(res, null, 1));
});

process.on("exit", () => rmSync(hdir, { recursive: true, force: true }));
