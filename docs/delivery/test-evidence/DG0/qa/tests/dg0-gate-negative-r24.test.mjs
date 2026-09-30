// qa-verifier, DG0 round 24 (T-DG0-REV-QA-R24): independent checks of the D-040 run-head binding in checkClosure
// (F-DG0-166/249) and re-confirmation of the standing strict controls (F-DG0-164/246 absent fix/head, F-DG0-165
// immutable-field drift, F-DG0-160/248 shallow refusal), on the independent round-9 fixture as adapted in round 21 (the
// round-21 harness prelude is loaded from dg0-gate-negative-r21.test.mjs next to this file, the same method as rounds
// 22/23). Node built-ins only; every fixture is a disposable git repository under $TMPDIR, removed afterwards.
// Author: qa-verifier.
//
// None of these shapes is in tools/gates/tests/validator.test.mjs. The D-040 unit test forges the GATE round's own
// manifest/stages source_commit and uses a fix that is BOTH after the run head AND outside the gate candidate (so the gate
// check alone would reject it). The QA24 cases isolate the run-head check. The fix is committed after the verifier's run
// started yet IS in a (re-derived) gate candidate, in a separate superseded round, with and without a forged absent
// source_commit. They also cover the boundaries (fix == run head, fix only on the run's side branch), non-commit object
// ids, and other shallow shapes.
// Run: QA_REPO_ROOT=<complete clone of the candidate> node --test <this file>
//
//   QA24-G0  control: the fixture validates with zero errors; the gate-move helper keeps it valid (fix = f.commit)
//   QA24-N1  THE ROUND-23 EXPLOIT (QA23-P1 re-run, now asserted): a self-declared absent round-3 whose genuine run
//            started from a commit (present, contains the manifest) that does not contain the fix; fix is in the gate
//            candidate -> REJECTED "not in the verifying run's starting history"
//   QA24-N2  fix committed AFTER the verifier's run started, and present in the gate candidate (the gate is re-derived
//            onto a later commit with the same candidate content): (a) round-3 source_commit forged absent -> REJECTED;
//            (b) round-3 source_commit genuine and present -> REJECTED. The only error in each case is the run-head one.
//   QA24-N3  boundaries accepted: fix == the verifying run's head; fix a strict ancestor of the head (both in the gate)
//   QA24-N4  fix in the verifying run's head (a side branch) but NOT in the gate candidate -> REJECTED on the gate check
//            only (no run-head error)
//   QA24-N5  fix_revision that is not a commit id: absent field, null, 40-hex TREE id, 40-hex BLOB id, UPPER-case form of
//            the real commit -> all REJECTED
//   QA24-N6  verifying run head_commit_at_start: TREE id, UPPER-case real commit, 12-hex prefix, a present commit that
//            predates the round manifest -> all REJECTED (so D-040's vhead is always a valid, manifest-containing commit)
//   QA24-N7  F-DG0-165: a round-12 sidecar re-raising a Critical/mandatory finding as Low/non-mandatory -> both drift
//            errors, and findings.json cannot follow the downgrade
//   QA24-N8  F-DG0-160/248: a --depth=2 clone deepened by 1, a complete clone given a hand-made .git/shallow, and a
//            complete clone made shallow by `git fetch --depth=1` are refused; the last after `--unshallow` is accepted
//   QA24-P1  informational probe (asserts nothing): fix committed after the round-3 FREEZE (source_commit present) but
//            before the verifier's run started -- pre-D-040 this was rejected on the round.source_commit ancestry; report
//            the D-040 outcome
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

Object.assign(process.env, { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "qa24", GIT_COMMITTER_NAME: "qa24",
  GIT_AUTHOR_EMAIL: "qa24@example.invalid", GIT_COMMITTER_EMAIL: "qa24@example.invalid" });
const here = dirname(fileURLToPath(import.meta.url));
if (!process.env.QA_REPO_ROOT) process.env.QA_REPO_ROOT = execFileSync("git", ["-C", here, "rev-parse", "--show-toplevel"]).toString().trim();
process.env.QA_REPO_ROOT = resolve(process.env.QA_REPO_ROOT);
const ROOT = process.env.QA_REPO_ROOT;
const git = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();

// ---- harness: the round-21 prelude (fixture adaptation), exported with addRound as well (same method as rounds 22/23)
const hdir = mkdtempSync(join(tmpdir(), "qa24-h-"));
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

const FJ = "docs/delivery/findings.json";
const GATE = "docs/delivery/gates/DG0.json";
const HIGH = { severity: "High", mandatory: false };
const CLOSE = { verifications: [{ finding_id: "F-DG0-201", result: "PASS", status_after: "CLOSED_VERIFIED", note: "fixed", evidence: [] }] };
const ABS_SRC = "ab".repeat(20);
const RUNHEAD_RE = /F-DG0-201.*is not in the verifying run's starting history/;
const GATEANC_RE = /F-DG0-201.*fix .* is not in the gate candidate/;
const log = (id, e) => console.log(`  ${id} errors (${e.length}): ${JSON.stringify(e)}`);
const errsOf = (repo) => fx.validateGate(repo, "DG0").map(String);
const withF = (opts, fn) => { const f = fx.fixture(opts); try { return fn(f); } finally { rmSync(f.repo, { recursive: true, force: true }); } };
const present = (repo, s) => { try { git(repo, "cat-file", "-e", `${s}^{commit}`); return true; } catch { return false; } };
const isAnc = (repo, a, b) => { try { git(repo, "merge-base", "--is-ancestor", a, b); return true; } catch { return false; } };
const has = (e, re) => e.some((x) => re.test(x));
const runMeta = (ref) => `docs/delivery/runs/DG0/${ref.run_id}/meta.json`;

/** Commits a manifest for a superseded round-3 candidate whose source_commit is `src`; returns its cid. */
function supersededManifest(f, src) {
  const m = fx.readJ(f.repo, f.mrel);
  const entries = [{ path: "app/main.txt", sha256: "3".repeat(64), mode: "100644" }];
  const cid = cand.candidateId(entries);
  fx.write(f.repo, fx.manifestRel(cid), { ...m, candidate_id: cid, source_commit: src, entries });
  fx.commitAll(f.repo, "superseded-round manifest");
  return cid;
}
/** Round 3 (qa-verifier) verifies F-DG0-201 from run head `head` (default: the round-3 metadata commit). */
function round3(f, { src = ABS_SRC, head, genuineManifest = false } = {}) {
  let roundMeta;
  if (genuineManifest) roundMeta = {}; // round 3 reuses the real, present gate-round candidate (source_commit present)
  else roundMeta = { candidate_id: supersededManifest(f, src), source_commit: src };
  return fx.addRound(f, 3, "qa-verifier", CLOSE, { roundMeta, ...(head !== undefined ? { head } : {}) });
}
const mirror = (f, ref, fix) => {
  fx.mutate(f.repo, FJ, (d) => {
    if (ref) d.findings[0].verification.invocation_reference = ref;
    if (fix === undefined) delete d.findings[0].fix_revision; else d.findings[0].fix_revision = fix;
  });
  fx.commitAll(f.repo, "findings mirror");
};
/** A commit that only touches a candidate-excluded path (trading_agent/**), so the gate candidate content is unchanged. */
const excludedCommit = (f, label) => { fx.write(f.repo, `trading_agent/${label}.txt`, `${label}\n`); return fx.commitAll(f.repo, label); };

/**
 * Re-derives the gate onto commit `g` (same candidate content, so the same cid): gate record, gate manifest, stages
 * candidate and the rounds that share the candidate all name `g`; the release-auditor is re-run (a fresh genuine run
 * that writes its record and the gate record), so the gate stays bound to a real run of the auditor.
 */
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
// moveGate necessarily re-writes two write-once files (the shared gate manifest and the auditor's round-2 record), which
// the validator rightly reports (first run of this suite: exactly 4 "write-once:" errors on those two paths). Those
// harness artefacts -- and ONLY those, matched by exact path -- are excluded; every other error is asserted on.
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const movedErrs = (f) => {
  const art = new RegExp(`^write-once: (${esc(f.recs["release-auditor"])}|${esc(f.mrel)}) (has a M event|was committed with 2 different contents)`);
  const all = errsOf(f.repo);
  const artefacts = all.filter((x) => art.test(x));
  console.log(`  (moveGate write-once artefacts excluded: ${artefacts.length})`);
  return all.filter((x) => !art.test(x));
};

// ------------------------------------------------------------------------------------------------ control
test("QA24-G0 control: the fixture is clean, and the gate-move helper keeps it clean", () => {
  withF(HIGH, (f) => { const e = errsOf(f.repo); log("QA24-G0 fixture", e); assert.deepEqual(e, []); });
  withF(HIGH, (f) => {
    const ref = round3(f, { genuineManifest: true });
    mirror(f, ref, f.commit);
    const later = excludedCommit(f, "later-noncandidate");
    moveGate(f, later);
    const e = movedErrs(f);
    log("QA24-G0 moved gate", e);
    assert.deepEqual(e, [], "the re-derived gate (same candidate content on a later commit) must validate cleanly");
  });
});

// ------------------------------------------------------------------------------------------------ D-040 (F-DG0-166/249)
test("QA24-N1 round-23 exploit (QA23-P1): fix not in the verifying run's head, self-declared absent round -> REJECTED", () => withF(HIGH, (f) => {
  const cid = supersededManifest(f, ABS_SRC);
  const orphanHead = git(f.repo, "commit-tree", git(f.repo, "rev-parse", "HEAD^{tree}"), "-m", "run start without the fix");
  git(f.repo, "branch", "qa24-run-start", orphanHead);
  const ref = fx.addRound(f, 3, "qa-verifier", CLOSE, { roundMeta: { candidate_id: cid, source_commit: ABS_SRC }, head: orphanHead });
  mirror(f, ref, f.commit);
  assert.ok(!present(f.repo, ABS_SRC) && !isAnc(f.repo, f.commit, orphanHead), "setup");
  const e = errsOf(f.repo);
  log("QA24-N1", e);
  console.log(`  QA24-N1 result: ${has(e, RUNHEAD_RE) ? "REJECTED (run head)" : e.length ? "REJECTED-OTHER" : "ACCEPTED"}`);
  assert.ok(has(e, RUNHEAD_RE), JSON.stringify(e));
  assert.ok(!has(e, GATEANC_RE), "the fix IS in the gate candidate; only the run-head check may reject it");
}));

test("QA24-N2 fix committed AFTER the verifier's run started, present in the gate candidate -> REJECTED (forged-absent and genuine rounds)", () => {
  const res = {};
  for (const [label, opts] of [["forged-absent-round", {}], ["genuine-present-round", { genuineManifest: true }]]) withF(HIGH, (f) => {
    const ref = round3(f, opts);
    const vhead = fx.readJ(f.repo, runMeta(ref)).head_commit_at_start;
    const fix = excludedCommit(f, "fix-after-run");
    mirror(f, ref, fix);
    moveGate(f, git(f.repo, "rev-parse", "HEAD"));
    const gsc = fx.readJ(f.repo, GATE).source_commit;
    assert.ok(isAnc(f.repo, vhead, fix) && vhead !== fix, "setup: the fix is a strict descendant of the verifier's run head");
    assert.ok(isAnc(f.repo, fix, gsc), "setup: the fix IS in the gate candidate");
    const e = movedErrs(f);
    log(`QA24-N2 ${label}`, e);
    res[label] = has(e, RUNHEAD_RE) ? (e.length === 1 ? "REJECTED (run head only)" : `REJECTED (+${e.length - 1} other)`) : e.length ? "REJECTED-OTHER" : "ACCEPTED";
  });
  console.log(`  QA24-N2 result: ${JSON.stringify(res)}`);
  assert.deepEqual(res, { "forged-absent-round": "REJECTED (run head only)", "genuine-present-round": "REJECTED (run head only)" });
});

test("QA24-N3 boundaries accepted: fix == the verifying run's head, and a strict ancestor of it (both in the gate)", () => {
  const res = {};
  for (const label of ["fix-equals-head", "fix-strict-ancestor"]) withF(HIGH, (f) => {
    const pre = label === "fix-strict-ancestor" ? excludedCommit(f, "fix-before-run") : null;
    const ref = round3(f, { genuineManifest: true });
    const vhead = fx.readJ(f.repo, runMeta(ref)).head_commit_at_start;
    const fix = pre || vhead;
    mirror(f, ref, fix);
    moveGate(f, git(f.repo, "rev-parse", "HEAD"));
    const e = movedErrs(f);
    log(`QA24-N3 ${label}`, e);
    res[label] = e.length ? `REJECTED ${JSON.stringify(e)}` : "ACCEPTED";
  });
  console.log(`  QA24-N3 result: ${JSON.stringify(res)}`);
  assert.deepEqual(res, { "fix-equals-head": "ACCEPTED", "fix-strict-ancestor": "ACCEPTED" });
});

test("QA24-N4 fix only on the verifying run's side branch (in its head, not in the gate) -> REJECTED on the gate check only", () => withF(HIGH, (f) => {
  const cid = supersededManifest(f, ABS_SRC);
  const base = git(f.repo, "rev-parse", "HEAD");
  const sideFix = git(f.repo, "commit-tree", `${base}^{tree}`, "-p", base, "-m", "side-branch fix");
  git(f.repo, "branch", "qa24-side", sideFix); // reachable, so present in every clone
  const ref = fx.addRound(f, 3, "qa-verifier", CLOSE, { roundMeta: { candidate_id: cid, source_commit: ABS_SRC }, head: sideFix });
  mirror(f, ref, sideFix);
  const e = errsOf(f.repo);
  log("QA24-N4", e);
  assert.ok(has(e, GATEANC_RE), JSON.stringify(e));
  assert.ok(!has(e, RUNHEAD_RE), "the fix IS in the run head; the run-head check must not fire");
}));

// ------------------------------------------------------------------------------------------------ standing strict controls
test("QA24-N5 fix_revision that is not a commit id (absent, null, tree id, blob id, upper-case) -> REJECTED", () => {
  const res = {};
  for (const label of ["absent-field", "null", "tree-id", "blob-id", "upper-case"]) withF(HIGH, (f) => {
    const ref = round3(f, { genuineManifest: true });
    const fix = { "absent-field": undefined, null: null, "tree-id": git(f.repo, "rev-parse", `${f.commit}^{tree}`),
      "blob-id": git(f.repo, "rev-parse", `${f.commit}:app/main.txt`), "upper-case": f.commit.toUpperCase() }[label];
    mirror(f, ref, fix);
    const e = errsOf(f.repo);
    log(`QA24-N5 ${label}`, e);
    res[label] = has(e, /F-DG0-201.*(CLOSED_VERIFIED needs a full fix_revision commit id|is not a commit present in this repository)/) ? "REJECTED" : e.length ? `REJECTED-OTHER ${JSON.stringify(e)}` : "ACCEPTED";
  });
  console.log(`  QA24-N5 result: ${JSON.stringify(res)}`);
  assert.ok(Object.values(res).every((r) => r === "REJECTED"), JSON.stringify(res));
});

test("QA24-N6 run head_commit_at_start: tree id, upper-case, 12-hex prefix, pre-manifest commit -> REJECTED", () => {
  const res = {};
  for (const label of ["tree-id", "upper-case", "prefix-12", "pre-manifest-commit"]) withF(HIGH, (f) => {
    const ref = round3(f, { genuineManifest: true });
    mirror(f, ref, f.commit);
    assert.deepEqual(errsOf(f.repo), [], "control: the genuine round-3 closure is valid");
    const h = { "tree-id": git(f.repo, "rev-parse", `${f.manifestCommit}^{tree}`), "upper-case": f.manifestCommit.toUpperCase(),
      "prefix-12": f.manifestCommit.slice(0, 12), "pre-manifest-commit": f.commit }[label];
    fx.mutate(f.repo, runMeta(ref), (m) => (m.head_commit_at_start = h));
    fx.commitAll(f.repo, `round-3 run head ${label}`);
    const e = errsOf(f.repo);
    log(`QA24-N6 ${label}`, e);
    const re = label === "pre-manifest-commit" ? /which does not contain docs\/delivery\/candidates/ : /(is not a 40-hex commit id|a commit absent from this repository)/;
    res[label] = has(e, re) ? "REJECTED" : e.length ? `REJECTED-OTHER ${JSON.stringify(e)}` : "ACCEPTED";
  });
  console.log(`  QA24-N6 result: ${JSON.stringify(res)}`);
  assert.ok(Object.values(res).every((r) => r === "REJECTED"), JSON.stringify(res));
});

test("QA24-N7 F-DG0-165: a round-12 sidecar downgrading a Critical/mandatory finding to Low/non-mandatory -> drift errors", () => withF({ severity: "Critical", mandatory: true }, (f) => {
  const down = { id: "F-DG0-201", stage_id: "DG0", requirement: "REQ-DLV-001", severity: "Low", mandatory_violation: false,
    title: "probe finding", reproduction: "fixture", expected: "rejected", actual: "accepted", evidence: [], reported_by: "qa-verifier",
    reported_in: "docs/delivery/reviews/DG0/round-12/qa-verifier.json", owner: "delivery-orchestrator", status: "OPEN" };
  fx.write(f.repo, "docs/delivery/reviews/DG0/round-12/qa-verifier.findings.json", { findings: [down] });
  fx.mutate(f.repo, FJ, (d) => { d.findings[0].severity = "Low"; d.findings[0].mandatory_violation = false; });
  fx.commitAll(f.repo, "round-12 downgrade, findings.json follows");
  const e = errsOf(f.repo);
  log("QA24-N7", e);
  assert.ok(has(e, /round-12\/qa-verifier\.findings\.json: finding F-DG0-201 severity .* differs from its first raising sidecar .*round-1\//), JSON.stringify(e));
  assert.ok(has(e, /round-12\/qa-verifier\.findings\.json: finding F-DG0-201 mandatory_violation .* differs from its first raising sidecar/), JSON.stringify(e));
}));

test("QA24-N8 F-DG0-160/248: depth+deepen, hand-grafted .git/shallow and fetch --depth=1 repos are refused; after --unshallow accepted", () => withF(HIGH, (f) => {
  // (First attempt used --shallow-since=2100-01-01; git produced a NON-shallow clone, so that shape was replaced.)
  for (let i = 0; i < 3; i++) git(f.repo, "commit", "-q", "--allow-empty", "-m", `pad ${i}`);
  assert.deepEqual(errsOf(f.repo), [], "control: padded fixture valid");
  const base = mkdtempSync(join(tmpdir(), "qa24-sh-"));
  const verdict = (d) => `${git(d, "rev-parse", "--is-shallow-repository")}:${has(errsOf(d), /the repository is a shallow clone/) ? "REFUSED" : "NOT-REFUSED"}`;
  try {
    const res = {};
    const deep = join(base, "deepen");
    execFileSync("git", ["clone", "-q", "--depth=2", `file://${f.repo}`, deep], { stdio: ["ignore", "pipe", "pipe"] });
    git(deep, "fetch", "-q", "--deepen=1", "origin");
    res["depth2-deepen1"] = verdict(deep);
    const graft = join(base, "graft");
    execFileSync("git", ["clone", "-q", "--no-local", f.repo, graft], { stdio: ["ignore", "pipe", "pipe"] });
    writeFileSync(join(graft, ".git", "shallow"), git(graft, "rev-parse", "HEAD~1") + "\n"); // hand-made shallow boundary
    res["hand-grafted-shallow"] = verdict(graft);
    const later = join(base, "later");
    execFileSync("git", ["clone", "-q", "--no-local", f.repo, later], { stdio: ["ignore", "pipe", "pipe"] });
    git(later, "fetch", "-q", "--depth=1", "origin", "main");
    res["fetch-depth-1"] = `${git(later, "rev-parse", "--is-shallow-repository")}:${has(errsOf(later), /the repository is a shallow clone/) ? "REFUSED" : "NOT-REFUSED"}`;
    git(later, "fetch", "-q", "--unshallow", "origin");
    const e = errsOf(later);
    log("QA24-N8 after --unshallow", e);
    res["after-unshallow"] = `${git(later, "rev-parse", "--is-shallow-repository")}:${e.length ? "ERRORS" : "ACCEPTED"}`;
    console.log(`  QA24-N8 result: ${JSON.stringify(res)}`);
    assert.deepEqual(res, { "depth2-deepen1": "true:REFUSED", "hand-grafted-shallow": "true:REFUSED", "fetch-depth-1": "true:REFUSED", "after-unshallow": "false:ACCEPTED" });
  } finally { rmSync(base, { recursive: true, force: true }); }
}));

// ------------------------------------------------------------------------------------------------ probe
test("QA24-P1 probe: fix committed after the round-3 freeze but before the verifier's run started (round present)", () => withF(HIGH, (f) => {
  // Round 3 freezes at `frz` (a present, genuine source_commit). The fix `fix` lands after the freeze; the verifier's run
  // then starts from a head that contains it. Pre-D-040: rejected ("not in the verified round-3 candidate"). Report D-040.
  const frz = excludedCommit(f, "round3-freeze");
  const m = fx.readJ(f.repo, f.mrel);
  const cid = cand.candidateId(cand.manifestFromRef ? cand.manifestFromRef(f.repo, frz, m.spec) : m.entries);
  const fix = excludedCommit(f, "fix-after-freeze");
  const ref = fx.addRound(f, 3, "qa-verifier", CLOSE, { roundMeta: { candidate_id: cid, source_commit: cid === f.cid ? f.commit : frz } });
  mirror(f, ref, fix);
  moveGate(f, git(f.repo, "rev-parse", "HEAD"));
  const e = movedErrs(f);
  log("QA24-P1", e);
  console.log(`  QA24-P1 result: ${e.length ? "REJECTED" : "ACCEPTED"} (fix after the round's freeze, before the run start; ` +
    `the round-3 candidate content is unchanged by the fix because it touches a candidate-excluded path)`);
}));

process.on("exit", () => rmSync(hdir, { recursive: true, force: true }));
