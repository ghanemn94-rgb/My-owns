// qa-verifier, DG0 round 25 (T-DG0-REV-QA-R25): independent checks of the D-041 three-anchor closure in checkClosure
// (F-DG0-168) and re-confirmation of the standing strict controls, on the independent round-9 fixture as adapted in
// round 21 (harness prelude loaded from dg0-gate-negative-r21.test.mjs next to this file, same method as rounds 22-24).
// Node built-ins only; every fixture is a disposable git repository under $TMPDIR, removed afterwards. Author: qa-verifier.
//
// What is new versus tools/gates/tests/validator.test.mjs: the D-041 unit test ("F-DG0-110 / F-DG0-204") uses ONE fix that
// fails all three anchors at once, so it cannot show that each anchor is independently enforced. The QA25 cases build a
// GENUINE superseded round 3 whose frozen candidate (source_commit present, content C3, its own manifest recomputing from
// it) differs from the gate candidate, and then make EXACTLY ONE anchor fail at a time:
//
//   QA25-G0  controls ACCEPTED: (a) fix committed before the round-3 freeze; (b) fix == the round-3 freeze commit
//   QA25-N1  THE ROUND-24 CASE (anchor 1): a fix committed AFTER the round-3 freeze but BEFORE the verifier's run started
//            (the run head contains it, and the gate candidate contains it): (a) candidate-scope fix (changes app/main.txt)
//            and (b) non-candidate fix -> REJECTED with "not in the verified round-3 candidate" as the ONLY error
//   QA25-N2  THE ROUND-23 FORGE (anchor 2): superseded round with a non-existent source_commit, a genuine verifier run,
//            the fix committed AFTER the run (fix in the gate) -> REJECTED with the run-head error as the ONLY error
//   QA25-N3  anchor independence: (a) anchor 2 alone -- round present and containing the fix, run head a present
//            manifest-containing commit WITHOUT the fix; (b) anchor 3 alone -- fix in the round-3 freeze and the run
//            head (both on a side branch/merge) but not in the gate -> each rejected ONLY by its own anchor
//   QA25-N4  standing: fix_revision all-zero / absent; run head_commit_at_start absent / null / "unknown" / all-zero
//            -> REJECTED (on the genuine present-round shape, so anchor 1 cannot mask them)
//   QA25-N5  F-DG0-165 variants not in QA24-N7: a later sidecar downgrading ONLY mandatory_violation, and ONLY severity
//            (Critical -> Medium) -> each exactly its own drift error
//   QA25-N6  F-DG0-160/248: for a set of clone shapes (--depth=1; --depth=1 then --deepen=1000; --no-local), the validator
//            refuses exactly when `git rev-parse --is-shallow-repository` is true, and at least one shape is shallow
//   QA25-P1  informational probe (asserts nothing): forged-absent round source_commit + fix after the (claimed) freeze but
//            before the run -- the residual D-035 tolerance; reports the outcome
// Run: QA_REPO_ROOT=<complete clone of the candidate> node --test <this file>
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

Object.assign(process.env, { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "qa25", GIT_COMMITTER_NAME: "qa25",
  GIT_AUTHOR_EMAIL: "qa25@example.invalid", GIT_COMMITTER_EMAIL: "qa25@example.invalid" });
const here = dirname(fileURLToPath(import.meta.url));
if (!process.env.QA_REPO_ROOT) process.env.QA_REPO_ROOT = execFileSync("git", ["-C", here, "rev-parse", "--show-toplevel"]).toString().trim();
process.env.QA_REPO_ROOT = resolve(process.env.QA_REPO_ROOT);
const ROOT = process.env.QA_REPO_ROOT;
const git = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();

// ---- harness: the round-21 prelude (fixture adaptation), exported with addRound as well (same method as rounds 22-24)
const hdir = mkdtempSync(join(tmpdir(), "qa25-h-"));
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
const SPEC = { include: ["**"], exclude: ["trading_agent/**"] };
const HIGH = { severity: "High", mandatory: false };
const CLOSE = { verifications: [{ finding_id: "F-DG0-201", result: "PASS", status_after: "CLOSED_VERIFIED", note: "fixed", evidence: [] }] };
const ABS_SRC = "cd".repeat(20);
const A1_RE = /F-DG0-201.*is not in the verified round-3 candidate/;
const A2_RE = /F-DG0-201.*is not in the verifying run's starting history/;
const A3_RE = /F-DG0-201.*fix .* is not in the gate candidate/;
const log = (id, e) => console.log(`  ${id} errors (${e.length}): ${JSON.stringify(e)}`);
const errsOf = (repo) => fx.validateGate(repo, "DG0").map(String);
const withF = (opts, fn) => { const f = fx.fixture(opts); try { return fn(f); } finally { rmSync(f.repo, { recursive: true, force: true }); } };
const present = (repo, s) => { try { git(repo, "cat-file", "-e", `${s}^{commit}`); return true; } catch { return false; } };
const isAnc = (repo, a, b) => { try { git(repo, "merge-base", "--is-ancestor", a, b); return true; } catch { return false; } };
const has = (e, re) => e.some((x) => re.test(x));
const runMeta = (ref) => `docs/delivery/runs/DG0/${ref.run_id}/meta.json`;
const anchors = (e) => ["A1", "A2", "A3"].filter((k, i) => has(e, [A1_RE, A2_RE, A3_RE][i]));

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

/** Re-derives the gate onto commit `g` (same candidate content, same cid) and re-runs the auditor (as in round 24). */
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

/**
 * Genuine superseded round 3: frozen at `frz3` (content C3 = app/main.txt "v3-frozen"), with its own manifest; later the
 * gate content C2 ("v1") is restored and the gate is re-derived onto the final HEAD.  `fixAt` places F-DG0-201's fix:
 *   "before-freeze"      excluded-path commit before frz3            (in frz3, run head, gate)
 *   "is-freeze"          fix == frz3                                  (in frz3, run head, gate)
 *   "after-freeze-cand"  the C2-restoring commit itself, after frz3, before the run   (NOT in frz3; in run head, gate)
 *   "after-freeze-excl"  excluded-path commit after frz3, before the run             (NOT in frz3; in run head, gate)
 * `orphanHead`: the verifier's run starts from a parentless commit with the current tree (contains the manifest, not the fix).
 */
function genuineRound3(f, fixAt, { orphanHead = false } = {}) {
  let fix = fixAt === "before-freeze" ? excludedCommit(f, "fix-before-freeze") : null;
  const frz3 = setMain(f, "v3-frozen\n", "round-3 freeze (content C3)");
  if (fixAt === "is-freeze") fix = frz3;
  const cid3 = round3Manifest(f, frz3);
  const restore = setMain(f, "v1\n", "candidate-scope fix: restore C2");
  if (fixAt === "after-freeze-cand") fix = restore;
  if (fixAt === "after-freeze-excl") fix = excludedCommit(f, "fix-after-freeze");
  let head;
  if (orphanHead) {
    head = git(f.repo, "commit-tree", git(f.repo, "rev-parse", "HEAD^{tree}"), "-m", "run start without history");
    git(f.repo, "branch", "qa25-orphan-head", head);
  }
  const ref = fx.addRound(f, 3, "qa-verifier", CLOSE, { roundMeta: { candidate_id: cid3, source_commit: frz3 }, ...(head ? { head } : {}) });
  const vhead = fx.readJ(f.repo, runMeta(ref)).head_commit_at_start;
  mirror(f, ref, fix);
  moveGate(f, git(f.repo, "rev-parse", "HEAD"));
  return { frz3, cid3, fix, ref, vhead, gsc: fx.readJ(f.repo, GATE).source_commit };
}

// ------------------------------------------------------------------------------------------------ controls
test("QA25-G0 controls: genuine round-3 closures whose fix is in the frozen round candidate are ACCEPTED", () => {
  const res = {};
  for (const at of ["before-freeze", "is-freeze"]) withF(HIGH, (f) => {
    const s = genuineRound3(f, at);
    assert.ok(present(f.repo, s.frz3) && isAnc(f.repo, s.fix, s.frz3) && isAnc(f.repo, s.fix, s.vhead) && isAnc(f.repo, s.fix, s.gsc), "setup");
    const e = movedErrs(f);
    log(`QA25-G0 ${at}`, e);
    res[at] = e.length ? `REJECTED ${JSON.stringify(e)}` : "ACCEPTED";
  });
  console.log(`  QA25-G0 result: ${JSON.stringify(res)}`);
  assert.deepEqual(res, { "before-freeze": "ACCEPTED", "is-freeze": "ACCEPTED" });
});

// ------------------------------------------------------------------------------------------------ D-041 anchor 1
test("QA25-N1 round-24 case: fix committed after the round-3 freeze, before the verifier ran -> REJECTED by anchor 1 only", () => {
  const res = {};
  for (const at of ["after-freeze-cand", "after-freeze-excl"]) withF(HIGH, (f) => {
    const s = genuineRound3(f, at);
    assert.ok(present(f.repo, s.frz3) && !isAnc(f.repo, s.fix, s.frz3), "setup: fix is NOT in the frozen round-3 candidate");
    assert.ok(isAnc(f.repo, s.frz3, s.fix), "setup: fix is committed AFTER the freeze");
    assert.ok(isAnc(f.repo, s.fix, s.vhead) && s.fix !== s.vhead, "setup: fix is in the verifier's run head (committed before the run)");
    assert.ok(isAnc(f.repo, s.fix, s.gsc), "setup: fix is in the gate candidate");
    const e = movedErrs(f);
    log(`QA25-N1 ${at}`, e);
    res[at] = `${e.length ? "REJECTED" : "ACCEPTED"} anchors=${anchors(e).join("+") || "-"} total=${e.length}`;
  });
  console.log(`  QA25-N1 result: ${JSON.stringify(res)}`);
  assert.deepEqual(res, { "after-freeze-cand": "REJECTED anchors=A1 total=1", "after-freeze-excl": "REJECTED anchors=A1 total=1" });
});

// ------------------------------------------------------------------------------------------------ D-041 anchor 2
test("QA25-N2 round-23 forge: absent round source_commit, genuine run, fix committed after the run -> REJECTED by anchor 2 only", () => withF(HIGH, (f) => {
  const m = fx.readJ(f.repo, f.mrel);
  const entries = [{ path: "app/main.txt", sha256: "3".repeat(64), mode: "100644" }];
  const cid = cand.candidateId(entries);
  fx.write(f.repo, fx.manifestRel(cid), { ...m, candidate_id: cid, source_commit: ABS_SRC, entries });
  fx.commitAll(f.repo, "forged superseded-round manifest (self-declared absent source_commit)");
  const ref = fx.addRound(f, 3, "qa-verifier", CLOSE, { roundMeta: { candidate_id: cid, source_commit: ABS_SRC } });
  const vhead = fx.readJ(f.repo, runMeta(ref)).head_commit_at_start;
  const fix = excludedCommit(f, "fix-after-run");
  mirror(f, ref, fix);
  moveGate(f, git(f.repo, "rev-parse", "HEAD"));
  assert.ok(!present(f.repo, ABS_SRC) && isAnc(f.repo, vhead, fix) && vhead !== fix && isAnc(f.repo, fix, fx.readJ(f.repo, GATE).source_commit), "setup");
  const e = movedErrs(f);
  log("QA25-N2", e);
  const r = `${e.length ? "REJECTED" : "ACCEPTED"} anchors=${anchors(e).join("+") || "-"} total=${e.length}`;
  console.log(`  QA25-N2 result: ${r}`);
  assert.equal(r, "REJECTED anchors=A2 total=1");
}));

// ------------------------------------------------------------------------------------------------ independence
test("QA25-N3 each anchor is enforced independently: anchor 2 alone (present round), anchor 3 alone", () => {
  const res = {};
  withF(HIGH, (f) => {
    const s = genuineRound3(f, "before-freeze", { orphanHead: true });
    assert.ok(isAnc(f.repo, s.fix, s.frz3) && !isAnc(f.repo, s.fix, s.vhead) && isAnc(f.repo, s.fix, s.gsc), "setup A2-only");
    const e = movedErrs(f);
    log("QA25-N3 anchor2-only", e);
    res["anchor2-only"] = `${e.length ? "REJECTED" : "ACCEPTED"} anchors=${anchors(e).join("+") || "-"} total=${e.length}`;
  });
  withF(HIGH, (f) => {
    // Side branch off the gate-freeze metadata: fix (excluded path) then the round-3 freeze (C3); main never gets them.
    git(f.repo, "checkout", "-q", "-b", "qa25-side");
    const fix = excludedCommit(f, "side-fix");
    const frz3 = setMain(f, "v3-frozen\n", "round-3 freeze on side branch");
    git(f.repo, "checkout", "-q", "main");
    const cid3 = round3Manifest(f, frz3);
    // The run starts from a merge of main (has the manifest) and the side branch (has the fix and the freeze).
    const head = git(f.repo, "commit-tree", git(f.repo, "rev-parse", "HEAD^{tree}"), "-p", "HEAD", "-p", frz3, "-m", "run start: merge");
    git(f.repo, "branch", "qa25-run-merge", head);
    const ref = fx.addRound(f, 3, "qa-verifier", CLOSE, { roundMeta: { candidate_id: cid3, source_commit: frz3 }, head });
    mirror(f, ref, fix);
    const gsc = fx.readJ(f.repo, GATE).source_commit;
    assert.ok(isAnc(f.repo, fix, frz3) && isAnc(f.repo, fix, head) && !isAnc(f.repo, fix, gsc), "setup A3-only");
    const e = errsOf(f.repo);
    log("QA25-N3 anchor3-only", e);
    res["anchor3-only"] = `${e.length ? "REJECTED" : "ACCEPTED"} anchors=${anchors(e).join("+") || "-"} total=${e.length}`;
  });
  console.log(`  QA25-N3 result: ${JSON.stringify(res)}`);
  assert.deepEqual(res, { "anchor2-only": "REJECTED anchors=A2 total=1", "anchor3-only": "REJECTED anchors=A3 total=1" });
});

// ------------------------------------------------------------------------------------------------ standing strict controls
test("QA25-N4 all-zero/absent fix_revision; absent/null/'unknown'/all-zero run head_commit_at_start -> REJECTED", () => {
  const res = {};
  for (const label of ["fix-all-zero", "fix-absent"]) withF(HIGH, (f) => {
    const s = genuineRound3(f, "before-freeze");
    mirror(f, null, label === "fix-all-zero" ? "0".repeat(40) : undefined);
    const e = movedErrs(f);
    log(`QA25-N4 ${label}`, e);
    res[label] = has(e, /F-DG0-201.*(CLOSED_VERIFIED needs a full fix_revision commit id|is not a commit present in this repository)/) ? "REJECTED" : `NOT-REJECTED ${JSON.stringify(e)}`;
    void s;
  });
  for (const label of ["head-absent", "head-null", "head-unknown", "head-all-zero"]) withF(HIGH, (f) => {
    const s = genuineRound3(f, "before-freeze");
    fx.mutate(f.repo, runMeta(s.ref), (m) => {
      if (label === "head-absent") delete m.head_commit_at_start;
      else m.head_commit_at_start = { "head-null": null, "head-unknown": "unknown", "head-all-zero": "0".repeat(40) }[label];
    });
    fx.commitAll(f.repo, `round-3 run head ${label}`);
    const e = movedErrs(f);
    log(`QA25-N4 ${label}`, e);
    res[label] = has(e, /verification.*(head_commit_at_start .* is not a 40-hex commit id|a commit absent from this repository)/) ? "REJECTED" : `NOT-REJECTED ${JSON.stringify(e)}`;
  });
  console.log(`  QA25-N4 result: ${JSON.stringify(res)}`);
  assert.ok(Object.values(res).every((r) => r === "REJECTED"), JSON.stringify(res));
});

test("QA25-N5 F-DG0-165: later sidecar downgrading only mandatory_violation, or only severity -> its own drift error", () => {
  const res = {};
  for (const [label, sev, mand] of [["mandatory-only", "Critical", false], ["severity-only", "Medium", true]]) withF({ severity: "Critical", mandatory: true }, (f) => {
    const down = { id: "F-DG0-201", stage_id: "DG0", requirement: "REQ-DLV-001", severity: sev, mandatory_violation: mand,
      title: "probe finding", reproduction: "fixture", expected: "rejected", actual: "accepted", evidence: [], reported_by: "qa-verifier",
      reported_in: "docs/delivery/reviews/DG0/round-7/qa-verifier.json", owner: "delivery-orchestrator", status: "OPEN" };
    fx.write(f.repo, "docs/delivery/reviews/DG0/round-7/qa-verifier.findings.json", { findings: [down] });
    fx.mutate(f.repo, FJ, (d) => { d.findings[0].severity = sev; d.findings[0].mandatory_violation = mand; });
    fx.commitAll(f.repo, `round-7 downgrade (${label}), findings.json follows`);
    const e = errsOf(f.repo);
    log(`QA25-N5 ${label}`, e);
    const sevErr = has(e, /round-7\/qa-verifier\.findings\.json: finding F-DG0-201 severity .* differs from its first raising sidecar/);
    const mandErr = has(e, /round-7\/qa-verifier\.findings\.json: finding F-DG0-201 mandatory_violation .* differs from its first raising sidecar/);
    res[label] = `severity-drift=${sevErr} mandatory-drift=${mandErr}`;
  });
  console.log(`  QA25-N5 result: ${JSON.stringify(res)}`);
  assert.deepEqual(res, { "mandatory-only": "severity-drift=false mandatory-drift=true", "severity-only": "severity-drift=true mandatory-drift=false" });
});

test("QA25-N6 F-DG0-160/248: refusal happens exactly when the clone is shallow", () => withF(HIGH, (f) => {
  for (let i = 0; i < 4; i++) git(f.repo, "commit", "-q", "--allow-empty", "-m", `pad ${i}`);
  assert.deepEqual(errsOf(f.repo), [], "control: padded fixture valid");
  const base = mkdtempSync(join(tmpdir(), "qa25-sh-"));
  try {
    const res = {};
    const shapes = {
      "depth-1": (d) => execFileSync("git", ["clone", "-q", "--depth=1", `file://${f.repo}`, d], { stdio: ["ignore", "pipe", "pipe"] }),
      "depth-1-deepen-1000": (d) => { execFileSync("git", ["clone", "-q", "--depth=1", `file://${f.repo}`, d], { stdio: ["ignore", "pipe", "pipe"] }); git(d, "fetch", "-q", "--deepen=1000", "origin"); },
      "no-local": (d) => execFileSync("git", ["clone", "-q", "--no-local", f.repo, d], { stdio: ["ignore", "pipe", "pipe"] }),
    };
    for (const [k, mk] of Object.entries(shapes)) {
      const d = join(base, k);
      mk(d);
      const shallow = git(d, "rev-parse", "--is-shallow-repository") === "true";
      const e = errsOf(d);
      const refused = has(e, /the repository is a shallow clone/);
      res[k] = { shallow, refused, consistent: shallow === refused, otherErrors: refused ? null : e.length };
    }
    console.log(`  QA25-N6 result: ${JSON.stringify(res)}`);
    assert.ok(Object.values(res).every((r) => r.consistent), JSON.stringify(res));
    assert.ok(Object.values(res).some((r) => r.shallow), "at least one shape must be shallow");
    assert.equal(res["no-local"].shallow, false);
    assert.equal(res["no-local"].otherErrors, 0, "a complete clone of a valid fixture is accepted");
  } finally { rmSync(base, { recursive: true, force: true }); }
}));

// ------------------------------------------------------------------------------------------------ probe
test("QA25-P1 probe: forged-absent round source_commit, fix after the claimed freeze but before the run (residual D-035 case)", () => withF(HIGH, (f) => {
  const m = fx.readJ(f.repo, f.mrel);
  const entries = [{ path: "app/main.txt", sha256: "4".repeat(64), mode: "100644" }];
  const cid = cand.candidateId(entries);
  fx.write(f.repo, fx.manifestRel(cid), { ...m, candidate_id: cid, source_commit: ABS_SRC, entries });
  fx.commitAll(f.repo, "forged superseded-round manifest");
  const fix = excludedCommit(f, "fix-before-run");
  const ref = fx.addRound(f, 3, "qa-verifier", CLOSE, { roundMeta: { candidate_id: cid, source_commit: ABS_SRC } });
  mirror(f, ref, fix);
  moveGate(f, git(f.repo, "rev-parse", "HEAD"));
  const e = movedErrs(f);
  log("QA25-P1", e);
  console.log(`  QA25-P1 result: ${e.length ? "REJECTED" : "ACCEPTED"} anchors=${anchors(e).join("+") || "-"} ` +
    "(anchor 1 cannot run on an absent source_commit; the fix IS in the run head the verifier saw and in the gate candidate)");
}));

process.on("exit", () => rmSync(hdir, { recursive: true, force: true }));
