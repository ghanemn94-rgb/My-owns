// qa-verifier, DG0 round 28 (T-DG0-REV-QA-R28): independent verification of D-044 (F-DG0-250) -- checkClosure requires
// objectType(fix_revision) === "commit" and checkInvocation requires the same of head_commit_at_start -- on the
// independent round-9 fixture as adapted in round 21 (harness prelude loaded from dg0-gate-negative-r21.test.mjs next to
// this file, the same method as rounds 22-27). Each case runs BOTH the pre-D-044 validator (49b5ad79, extracted with
// git archive) and the candidate validator, so the reproduction and the fix are shown side by side. Node built-ins only;
// every fixture is a disposable git repository under $TMPDIR, removed afterwards. Author: qa-verifier.
//
// tools/gates/tests/validator.test.mjs covers only: a tag object as the GATE source_commit (D-037) and, new in D-044,
// a tag object as fix_revision on the unit fixture (tag of the gate head). None of the following exists there:
//
//   QA28-C0  control: a genuine round-3 closure (fix in all three anchors, all ids commit objects) -> ACCEPTED by old AND new
//   QA28-T1  REPRODUCTION of my round-27 QA27-N3 on the three-anchor fixture: fix_revision = annotated TAG object peeling
//            to the valid fix -> old ACCEPTED (bug reproduced), new REJECTED by exactly the D-044 error
//   QA28-T2  the VERIFYING run's head_commit_at_start (round-3 qa-verifier run) = annotated TAG object peeling to the
//            genuine head -> old records behaviour, new REJECTED "a tag object, not a commit"
//   QA28-T3  the GATE AUDITOR run's head_commit_at_start = annotated TAG object -> new REJECTED (checkInvocation applies
//            to every invocation, not only verifications)
//   QA28-T4  NESTED annotated tag (tag of a tag) as fix_revision -> new REJECTED "a tag object, not a commit"
//   QA28-T5  annotated tag of a TREE as fix_revision (does not peel to any commit) -> REJECTED by old and new
//   QA28-T6  NO REGRESSION: old (49b5ad79) and new rules.mjs give IDENTICAL error lists over the 8-fixture battery of
//            commit-object inputs (genuine control, post-freeze fix, forged-absent round, all-zero fix, run head
//            "unknown", F-DG0-165 severity downgrade, side-branch fix, fix == round source_commit)
// Run: QA_REPO_ROOT=<complete clone of the candidate> node --test <this file>
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

Object.assign(process.env, { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "qa28", GIT_COMMITTER_NAME: "qa28",
  GIT_AUTHOR_EMAIL: "qa28@example.invalid", GIT_COMMITTER_EMAIL: "qa28@example.invalid" });
const here = dirname(fileURLToPath(import.meta.url));
if (!process.env.QA_REPO_ROOT) process.env.QA_REPO_ROOT = execFileSync("git", ["-C", here, "rev-parse", "--show-toplevel"]).toString().trim();
process.env.QA_REPO_ROOT = resolve(process.env.QA_REPO_ROOT);
const ROOT = process.env.QA_REPO_ROOT;
const git = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
const PRE_D044 = "49b5ad790443409ec2248097727cd61fd34f42f4";

// ---- harness: the round-21 prelude (fixture adaptation), exported with addRound as well (same method as rounds 22-27)
const hdir = mkdtempSync(join(tmpdir(), "qa28-h-"));
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
execFileSync("sh", ["-c", `git -C "${ROOT}" archive ${PRE_D044} tools/gates | tar -x -C "${oldDir}"`]);
const rulesOld = await import(pathToFileURL(join(oldDir, "tools/gates/lib/rules.mjs")).href);

const FJ = "docs/delivery/findings.json";
const GATE = "docs/delivery/gates/DG0.json";
const SPEC = { include: ["**"], exclude: ["trading_agent/**"] };
const HIGH = { severity: "High", mandatory: false };
const CLOSE = { verifications: [{ finding_id: "F-DG0-201", result: "PASS", status_after: "CLOSED_VERIFIED", note: "fixed", evidence: [] }] };
const ABS_SRC = "cd".repeat(20);
const FIX_TAG_RE = /F-DG0-201.*fix [0-9a-f]{10} is a tag object, not a commit; a fix_revision must name the fix commit itself/;
const HEAD_TAG_RE = /started from [0-9a-f]{10}, a tag object, not a commit/;
const NOT_COMMIT_RE = /F-DG0-201.*(is not a commit present in this repository|CLOSED_VERIFIED needs a full fix_revision commit id)/;
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
const both = (f) => ({ old: errsWith(rulesOld, f), neu: errsWith(rulesNew, f) });

function genuineRound3(f, fixAt) {
  let fix = fixAt === "before-freeze" ? excludedCommit(f, "fix-before-freeze") : null;
  let branch = null;
  if (fixAt === "side-branch") {
    const cur = git(f.repo, "rev-parse", "--abbrev-ref", "HEAD");
    git(f.repo, "checkout", "-q", "-b", "qa28-side");
    fix = excludedCommit(f, "fix-on-side-branch");
    git(f.repo, "checkout", "-q", cur);
    branch = "qa28-side";
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
const annTag = (repo, name, target) => { git(repo, "tag", "-a", name, "-m", `qa28 ${name}`, target); return git(repo, "rev-parse", name); };

// ------------------------------------------------------------------------------------------------ control
test("QA28-C0 control: genuine three-anchor closure, all ids commit objects -> ACCEPTED by old and new", () => withF(HIGH, (f) => {
  const s = genuineRound3(f, "before-freeze");
  assert.equal(git(f.repo, "cat-file", "-t", s.fix), "commit");
  assert.equal(git(f.repo, "cat-file", "-t", s.vhead), "commit");
  const { old, neu } = both(f);
  log("QA28-C0 old", old); log("QA28-C0 new", neu);
  console.log(`  QA28-C0 result: old=${old.length} new=${neu.length}`);
  assert.deepEqual([old.length, neu.length], [0, 0]);
}));

// ------------------------------------------------------------------------------------------------ fix_revision tag shapes
test("QA28-T1 reproduction of QA27-N3: tag-object fix_revision -> old ACCEPTED, new REJECTED by exactly the D-044 error", () => withF(HIGH, (f) => {
  const s = genuineRound3(f, "before-freeze");
  const tagObj = annTag(f.repo, "qa28-fix-tag", s.fix);
  assert.equal(git(f.repo, "cat-file", "-t", tagObj), "tag");
  assert.equal(git(f.repo, "rev-parse", `${tagObj}^{commit}`), s.fix, "setup: the tag peels to the valid fix");
  mirror(f, null, tagObj);
  const { old, neu } = both(f);
  log("QA28-T1 old", old); log("QA28-T1 new", neu);
  console.log(`  QA28-T1 result: old=${old.length ? "REJECTED" : "ACCEPTED"} new=${neu.length === 1 && has(neu, FIX_TAG_RE) ? "REJECTED-by-D-044-only" : JSON.stringify(neu)}`);
  assert.equal(old.length, 0, "reproduction: the pre-D-044 validator accepts the tag object");
  assert.equal(neu.length, 1);
  assert.ok(has(neu, FIX_TAG_RE), JSON.stringify(neu));
}));

test("QA28-T4 NESTED annotated tag (tag of a tag) as fix_revision -> new REJECTED", () => withF(HIGH, (f) => {
  const s = genuineRound3(f, "before-freeze");
  const inner = annTag(f.repo, "qa28-inner", s.fix);
  const outer = annTag(f.repo, "qa28-outer", inner);
  assert.equal(git(f.repo, "cat-file", "-t", outer), "tag");
  assert.equal(git(f.repo, "cat-file", "-p", outer).split("\n")[1], "type tag", "setup: outer tag points at a tag object");
  assert.equal(git(f.repo, "rev-parse", `${outer}^{commit}`), s.fix);
  mirror(f, null, outer);
  const { old, neu } = both(f);
  log("QA28-T4 old", old); log("QA28-T4 new", neu);
  console.log(`  QA28-T4 result: old=${old.length ? "REJECTED" : "ACCEPTED"} new=${has(neu, FIX_TAG_RE) ? "REJECTED-D-044" : JSON.stringify(neu)}`);
  assert.ok(has(neu, FIX_TAG_RE), JSON.stringify(neu));
}));

test("QA28-T5 annotated tag of a TREE as fix_revision (peels to no commit) -> REJECTED by old and new", () => withF(HIGH, (f) => {
  const s = genuineRound3(f, "before-freeze");
  const tt = annTag(f.repo, "qa28-tree-tag", git(f.repo, "rev-parse", `${s.fix}^{tree}`));
  assert.equal(git(f.repo, "cat-file", "-t", tt), "tag");
  mirror(f, null, tt);
  const { old, neu } = both(f);
  log("QA28-T5 old", old); log("QA28-T5 new", neu);
  const r = { old: has(old, NOT_COMMIT_RE) ? "REJECTED" : JSON.stringify(old), new: has(neu, NOT_COMMIT_RE) ? "REJECTED" : JSON.stringify(neu) };
  console.log(`  QA28-T5 result: ${JSON.stringify(r)}`);
  assert.deepEqual(r, { old: "REJECTED", new: "REJECTED" });
}));

// ------------------------------------------------------------------------------------------------ head_commit_at_start tag shapes
test("QA28-T2 VERIFYING run head_commit_at_start = annotated tag object of the genuine head -> new REJECTED", () => withF(HIGH, (f) => {
  const s = genuineRound3(f, "before-freeze");
  const tagObj = annTag(f.repo, "qa28-head-tag", s.vhead);
  assert.equal(git(f.repo, "rev-parse", `${tagObj}^{commit}`), s.vhead);
  fx.mutate(f.repo, runMeta(s.ref), (m) => { m.head_commit_at_start = tagObj; });
  fx.commitAll(f.repo, "round-3 run head -> tag object");
  const { old, neu } = both(f);
  log("QA28-T2 old", old); log("QA28-T2 new", neu);
  console.log(`  QA28-T2 result: old=${old.length ? `REJECTED(${old.length})` : "ACCEPTED"} new=${has(neu, HEAD_TAG_RE) ? "REJECTED-D-044" : JSON.stringify(neu)}`);
  assert.ok(has(neu, HEAD_TAG_RE), JSON.stringify(neu));
  assert.ok(!has(old, HEAD_TAG_RE), "the D-044 message is new");
  // Everything the new validator adds over the old one is the D-044 head error.
  assert.deepEqual(neu.filter((x) => !old.includes(x)).every((x) => HEAD_TAG_RE.test(x)), true, JSON.stringify(neu));
}));

test("QA28-T3 GATE AUDITOR run head_commit_at_start = annotated tag object -> new REJECTED", () => withF(HIGH, (f) => {
  const s = genuineRound3(f, "before-freeze");
  const gref = fx.readJ(f.repo, GATE).invocation_reference;
  const ahead = fx.readJ(f.repo, runMeta(gref)).head_commit_at_start;
  assert.match(ahead, /^[0-9a-f]{40}$/);
  const tagObj = annTag(f.repo, "qa28-audit-head-tag", ahead);
  fx.mutate(f.repo, runMeta(gref), (m) => { m.head_commit_at_start = tagObj; });
  fx.commitAll(f.repo, "auditor run head -> tag object");
  const { old, neu } = both(f);
  log("QA28-T3 old", old); log("QA28-T3 new", neu);
  console.log(`  QA28-T3 result: old=${old.length ? `REJECTED(${old.length})` : "ACCEPTED"} new=${has(neu, HEAD_TAG_RE) ? "REJECTED-D-044" : JSON.stringify(neu)}`);
  assert.ok(has(neu, HEAD_TAG_RE), JSON.stringify(neu));
  assert.ok(s.fix);
}));

// ------------------------------------------------------------------------------------------------ no regression
test("QA28-T6 no regression: old (49b5ad79) and new rules.mjs give identical errors on 8 commit-object fixtures", () => {
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
    const { old, neu } = both(f);
    console.log(`  QA28-T6 ${label}: old=${old.length} new=${neu.length} identical=${JSON.stringify(old) === JSON.stringify(neu)} new=${JSON.stringify(neu)}`);
    res[label] = JSON.stringify(old) === JSON.stringify(neu);
  });
  console.log(`  QA28-T6 result: ${JSON.stringify(res)}`);
  assert.equal(Object.keys(res).length, 8);
  assert.ok(Object.values(res).every(Boolean), JSON.stringify(res));
});

// ------------------------------------------------------------------------------------------------ D-044 scope boundary
// D-044 says "every commit-id field the gate depends on ... is now required to be a commit object". The verifying ROUND's
// frozen source_commit (stages.json review_rounds[].source_commit + the round manifest) is anchor 1 of every closure and
// is resolved with commitPresent/isAncestor, which peel a tag. Built from scratch (no post-commit mutation) so the
// result is not confounded by write-once artefacts. Behaviour is RECORDED, not asserted either way.
test("QA28-T7 (probe) the verifying round's frozen source_commit is an annotated TAG object peeling to the freeze -> behaviour recorded", () => withF(HIGH, (f) => {
  const fix = excludedCommit(f, "fix-before-freeze");
  const frz3 = setMain(f, "v3-frozen\n", "round-3 freeze (content C3)");
  const tagObj = annTag(f.repo, "qa28-round3-freeze", frz3);
  assert.equal(git(f.repo, "cat-file", "-t", tagObj), "tag");
  // Round-3 manifest written ONCE, already naming the tag object (entries computed from the peeled commit).
  const m0 = fx.readJ(f.repo, f.mrel);
  const entries = cand.manifestFromRef(f.repo, frz3, SPEC);
  const cid3 = cand.candidateId(entries);
  assert.notEqual(cid3, f.cid);
  fx.write(f.repo, fx.manifestRel(cid3), { ...m0, candidate_id: cid3, source_commit: tagObj, entries });
  fx.commitAll(f.repo, "round-3 freeze metadata (manifest names the tag object)");
  setMain(f, "v1\n", "candidate-scope fix: restore C2");
  const ref = fx.addRound(f, 3, "qa-verifier", CLOSE, { roundMeta: { candidate_id: cid3, source_commit: tagObj } });
  mirror(f, ref, fix);
  moveGate(f, git(f.repo, "rev-parse", "HEAD"));
  const { old, neu } = both(f);
  log("QA28-T7 old", old); log("QA28-T7 new", neu);
  const tagMention = neu.some((x) => /tag object|not a commit/.test(x) && x.includes(tagObj.slice(0, 10)));
  console.log(`  QA28-T7 result: old=${old.length ? `REJECTED(${old.length})` : "ACCEPTED"} new=${neu.length ? `REJECTED(${neu.length})` : "ACCEPTED"} new-names-the-tag=${tagMention}`);
  assert.ok(true);
}));

process.on("exit", () => rmSync(hdir, { recursive: true, force: true }));
