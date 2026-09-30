// qa-verifier, DG0 round 23 (T-DG0-REV-QA-R23): independent checks of the D-039 strict validator (F-DG0-164/246 absent
// fix/head escape removed; F-DG0-165 immutable-field drift; F-DG0-248 shallow refusal; findManifest's content-preserving
// absence tolerance), on the independent round-9 fixture as adapted in rounds 20/21 (the round-21 harness prelude is loaded
// from dg0-gate-negative-r21.test.mjs next to this file, exactly as round 22 did). Node built-ins only; every fixture is a
// disposable git repository under $TMPDIR, removed afterwards. Author: qa-verifier.
// None of these shapes is in tools/gates/tests/validator.test.mjs: the D-039 unit tests forge the GATE round's own
// manifest/stages source_commit, mutate only a GATE-round run's head, downgrade a round-1 finding from round 2, and clone
// --depth=1. The cases here use a separate superseded round with its own manifest and a genuine run, a non-gate
// verifying run, numeric round ordering (round-9 vs round-10), other immutable fields, other shallow shapes, and the
// findManifest tolerance boundary.
// Run: QA_REPO_ROOT=<complete clone of the candidate> node --test <this file>
//
//   QA23-G0  control: the fixture validates with zero errors
//   QA23-N1  F-DG0-246 (QA22-N7 re-run): genuine run in a self-declared absent round closes High with an all-zero fix
//            -> REJECTED; the same with a well-formed but absent fix -> REJECTED
//   QA23-N2  the former D-038 tolerance shape (QA22-N6: round source_commit AND run head both absent, absent fix) is now
//            REJECTED on both the head and the fix (the escape is gone, not just narrowed)
//   QA23-N3  F-DG0-164: a NON-gate (round-3) verifying run's head_commit_at_start missing / null / 'unknown' / absent
//            40-hex -> REJECTED (the unit test covers only a gate-round record)
//   QA23-N4  a PRESENT fix in a self-declared absent round: off-branch (not an ancestor of the gate) -> REJECTED; control:
//            a present fix that IS in the gate candidate -> accepted (the round-ancestry check is skipped for an absent
//            round source_commit, but the gate-ancestry check is not)
//   QA23-N5  F-DG0-165: drift of requirement / title / severity UPgrade / mandatory flip in a later-round sidecar -> error;
//            ordering is NUMERIC (a finding first raised in round-9 and re-raised in round-10 names round-9 as first)
//   QA23-N6  F-DG0-165 control: an identical later re-raise (same immutable fields) produces no drift error
//   QA23-N7  F-DG0-248: --depth=3 and --shallow-exclude shallow clones are refused; a complete --no-local clone is not
//   QA23-N8  findManifest tolerance is content-preserving: an absent-source_commit round manifest whose entries do not
//            hash to its candidate_id is REJECTED
//   QA23-N9  findManifest tolerates ONLY absence: a round manifest naming a PRESENT source_commit it does not describe is
//            REJECTED
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

Object.assign(process.env, { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "qa23", GIT_COMMITTER_NAME: "qa23",
  GIT_AUTHOR_EMAIL: "qa23@example.invalid", GIT_COMMITTER_EMAIL: "qa23@example.invalid" });
const here = dirname(fileURLToPath(import.meta.url));
if (!process.env.QA_REPO_ROOT) process.env.QA_REPO_ROOT = execFileSync("git", ["-C", here, "rev-parse", "--show-toplevel"]).toString().trim();
process.env.QA_REPO_ROOT = resolve(process.env.QA_REPO_ROOT);
const ROOT = process.env.QA_REPO_ROOT;
const git = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();

// ---- harness: the round-21 prelude (fixture adaptation), exported with addRound as well (same method as round 22)
const hdir = mkdtempSync(join(tmpdir(), "qa23-h-"));
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
const HIGH = { severity: "High", mandatory: false };
const CLOSE = { verifications: [{ finding_id: "F-DG0-201", result: "PASS", status_after: "CLOSED_VERIFIED", note: "fixed", evidence: [] }] };
const ABS_SRC = "ab".repeat(20);
const ABS_HEAD = "cd".repeat(20);
const log = (id, e) => console.log(`  ${id} errors (${e.length}): ${JSON.stringify(e)}`);
const errsOf = (repo) => fx.validateGate(repo, "DG0").map(String);
const withF = (opts, fn) => { const f = fx.fixture(opts); try { return fn(f); } finally { rmSync(f.repo, { recursive: true, force: true }); } };
const present = (repo, s) => { try { git(repo, "cat-file", "-e", `${s}^{commit}`); return true; } catch { return false; } };
const has = (e, re) => e.some((x) => re.test(x));

/** Commits a manifest for a fabricated superseded candidate whose source_commit is `src`; returns its cid. */
function supersededManifest(f, src, { tamper = false } = {}) {
  const m = fx.readJ(f.repo, f.mrel);
  const entries = [{ path: "app/main.txt", sha256: "3".repeat(64), mode: "100644" }];
  const cid = cand.candidateId(entries);
  const stored = tamper ? [{ ...entries[0], sha256: "4".repeat(64) }] : entries;
  fx.write(f.repo, fx.manifestRel(cid), { ...m, candidate_id: cid, source_commit: src, entries: stored });
  fx.commitAll(f.repo, "superseded-round manifest");
  return cid;
}
/** Round 3 (qa-verifier) re-verifies F-DG0-201 in a round whose manifest + stages entry name `src`; mirrors the closure. */
function closeInRound3(f, { src = ABS_SRC, head, fix, tamper = false }) {
  const cid = supersededManifest(f, src, { tamper });
  const ref = fx.addRound(f, 3, "qa-verifier", CLOSE, { roundMeta: { candidate_id: cid, source_commit: src }, ...(head !== undefined ? { head } : {}) });
  fx.mutate(f.repo, FJ, (d) => { d.findings[0].verification.invocation_reference = ref; d.findings[0].fix_revision = fix; });
  fx.commitAll(f.repo, "findings mirror");
  return ref;
}
const raisedLike = (over) => ({ id: "F-DG0-201", stage_id: "DG0", requirement: "REQ-DLV-001", severity: "High", mandatory_violation: false,
  title: "probe finding", reproduction: "fixture", expected: "rejected", actual: "accepted", evidence: [], reported_by: "qa-verifier",
  reported_in: "docs/delivery/reviews/DG0/round-1/qa-verifier.json", owner: "delivery-orchestrator", status: "OPEN", ...over });

// ------------------------------------------------------------------------------------------------ control
test("QA23-G0 control: the independent fixture validates with zero errors", () => withF(HIGH, (f) => {
  const e = errsOf(f.repo);
  log("QA23-G0", e);
  assert.deepEqual(e, []);
}));

// ------------------------------------------------------------------------------------------------ F-DG0-164/246
test("QA23-N1 F-DG0-246: a genuine run in a self-declared absent round cannot close with an all-zero or absent fix", () => {
  const res = {};
  for (const [label, fix] of [["all-zero", "0".repeat(40)], ["well-formed-absent", "ef".repeat(20)]]) withF(HIGH, (f) => {
    closeInRound3(f, { fix });
    assert.ok(!present(f.repo, ABS_SRC), "round-3 source_commit is absent");
    const e = errsOf(f.repo);
    log(`QA23-N1 ${label}`, e);
    res[label] = has(e, /F-DG0-201.*fix .* is not a commit present in this repository/) ? "REJECTED" : (e.length ? `REJECTED-OTHER` : "ACCEPTED");
  });
  console.log(`  QA23-N1 result: ${JSON.stringify(res)}`);
  assert.deepEqual(res, { "all-zero": "REJECTED", "well-formed-absent": "REJECTED" });
});

test("QA23-N2 the former D-038 tolerance shape (source_commit AND head absent, absent fix) is now rejected on head and fix", () => withF(HIGH, (f) => {
  closeInRound3(f, { head: ABS_HEAD, fix: "ef".repeat(20) });
  assert.ok(!present(f.repo, ABS_SRC) && !present(f.repo, ABS_HEAD));
  const e = errsOf(f.repo);
  log("QA23-N2", e);
  assert.ok(has(e, /started from cdcdcdcdcd, a commit absent from this repository/), `head: ${JSON.stringify(e)}`);
  assert.ok(has(e, /fix efefefefef is not a commit present in this repository/), `fix: ${JSON.stringify(e)}`);
}));

test("QA23-N3 F-DG0-164: a non-gate verifying run's head_commit_at_start missing/null/'unknown'/absent is rejected", () => {
  const res = {};
  for (const [label, tweak, re] of [
    ["missing", (m) => { delete m.head_commit_at_start; }, /head_commit_at_start .* is not a 40-hex commit id/],
    ["null", (m) => { m.head_commit_at_start = null; }, /head_commit_at_start .* is not a 40-hex commit id/],
    ["unknown", (m) => { m.head_commit_at_start = "unknown"; }, /head_commit_at_start .* is not a 40-hex commit id/],
    ["absent-40hex", (m) => { m.head_commit_at_start = ABS_HEAD; }, /absent from this repository/],
  ]) withF(HIGH, (f) => {
    const ref = fx.addRound(f, 3, "qa-verifier", CLOSE); // a RETAINED, present round (not the gate round)
    fx.mutate(f.repo, FJ, (d) => { d.findings[0].verification.invocation_reference = ref; });
    fx.commitAll(f.repo, "findings mirror");
    assert.deepEqual(errsOf(f.repo), [], "control: the genuine round-3 closure is valid");
    fx.mutate(f.repo, `docs/delivery/runs/DG0/${ref.run_id}/meta.json`, tweak);
    fx.commitAll(f.repo, `round-3 run head ${label}`);
    const e = errsOf(f.repo);
    log(`QA23-N3 ${label}`, e);
    res[label] = has(e, re) ? "REJECTED" : (e.length ? `REJECTED-OTHER ${JSON.stringify(e)}` : "ACCEPTED");
  });
  console.log(`  QA23-N3 result: ${JSON.stringify(res)}`);
  assert.ok(Object.values(res).every((r) => r === "REJECTED"), JSON.stringify(res));
});

test("QA23-N4 a PRESENT fix in a self-declared absent round must still be in the gate candidate", () => {
  withF(HIGH, (f) => {
    const off = git(f.repo, "commit-tree", `${f.commit}^{tree}`, "-m", "off-branch dangling fix");
    closeInRound3(f, { fix: off });
    assert.ok(present(f.repo, off));
    const e = errsOf(f.repo);
    log("QA23-N4 off-branch", e);
    assert.ok(has(e, /F-DG0-201.*fix .* is not in the gate candidate/), JSON.stringify(e));
  });
  withF(HIGH, (f) => {
    closeInRound3(f, { fix: f.commit });
    const e = errsOf(f.repo);
    log("QA23-N4 control (fix in the gate candidate)", e);
    console.log("  QA23-N4 note: with round-3 source_commit absent, only the gate-ancestry check applies (by design, D-039); " +
      `result=${e.length ? "REJECTED" : "ACCEPTED"}`);
    assert.deepEqual(e, [], "a real, in-gate fix verified by a genuine run is accepted");
  });
});

// ------------------------------------------------------------------------------------------------ F-DG0-165
test("QA23-N5 F-DG0-165: other immutable fields and numeric round order", () => {
  const res = {};
  for (const [label, over, field] of [
    ["requirement", { requirement: "REQ-DLV-002" }, "requirement"],
    ["title", { title: "a softer title" }, "title"],
    ["severity-upgrade", { severity: "Critical" }, "severity"],
    ["mandatory-flip", { mandatory_violation: true }, "mandatory_violation"],
  ]) withF(HIGH, (f) => {
    fx.write(f.repo, "docs/delivery/reviews/DG0/round-10/qa-verifier.findings.json",
      { findings: [raisedLike({ ...over, reported_in: "docs/delivery/reviews/DG0/round-10/qa-verifier.json" })] });
    fx.commitAll(f.repo, `round-10 re-raise ${label}`);
    const e = errsOf(f.repo);
    log(`QA23-N5 ${label}`, e);
    res[label] = has(e, new RegExp(`round-10/qa-verifier\\.findings\\.json: finding F-DG0-201 ${field} .* differs from its first raising sidecar docs/delivery/reviews/DG0/round-1/`)) ? "REJECTED" : "ACCEPTED";
  });
  // Numeric ordering: F-DG0-290 first raised High in round-9, re-raised Low in round-10 ("round-10" < "round-9" as text).
  withF(HIGH, (f) => {
    const nf = (round, severity) => raisedLike({ id: "F-DG0-290", severity, reported_in: `docs/delivery/reviews/DG0/round-${round}/qa-verifier.json` });
    fx.write(f.repo, "docs/delivery/reviews/DG0/round-9/qa-verifier.findings.json", { findings: [nf(9, "High")] });
    fx.write(f.repo, "docs/delivery/reviews/DG0/round-10/qa-verifier.findings.json", { findings: [nf(10, "Low")] });
    fx.mutate(f.repo, FJ, (d) => d.findings.push({ ...nf(10, "Low"), history: [] }));
    fx.commitAll(f.repo, "round-9 raise, round-10 downgrade");
    const e = errsOf(f.repo);
    log("QA23-N5 numeric-order", e);
    res["numeric-order"] = has(e, /round-10\/qa-verifier\.findings\.json: finding F-DG0-290 severity \("Low"\) differs from its first raising sidecar docs\/delivery\/reviews\/DG0\/round-9\/qa-verifier\.findings\.json \("High"\)/)
      ? "REJECTED (round-9 is first)" : (has(e, /F-DG0-290 severity/) ? `REJECTED-WRONG-ORDER ${JSON.stringify(e)}` : "ACCEPTED");
  });
  console.log(`  QA23-N5 result: ${JSON.stringify(res)}`);
  assert.deepEqual(res, { requirement: "REJECTED", title: "REJECTED", "severity-upgrade": "REJECTED", "mandatory-flip": "REJECTED", "numeric-order": "REJECTED (round-9 is first)" });
});

test("QA23-N6 F-DG0-165 control: an identical later re-raise produces no drift error", () => withF(HIGH, (f) => {
  fx.write(f.repo, "docs/delivery/reviews/DG0/round-10/qa-verifier.findings.json",
    { findings: [raisedLike({ reported_in: "docs/delivery/reviews/DG0/round-10/qa-verifier.json", actual: "still accepted (mutable text)" })] });
  fx.commitAll(f.repo, "identical re-raise");
  const e = errsOf(f.repo);
  log("QA23-N6", e);
  assert.ok(!has(e, /differs from its first raising sidecar/), JSON.stringify(e));
}));

// ------------------------------------------------------------------------------------------------ F-DG0-248
test("QA23-N7 F-DG0-248: --depth=3 and --shallow-exclude clones are refused; a complete --no-local clone is not", () => withF(HIGH, (f) => {
  for (let i = 0; i < 4; i++) { git(f.repo, "commit", "-q", "--allow-empty", "-m", `pad ${i}`); }
  git(f.repo, "tag", "qa23-cut", "HEAD~2"); // --shallow-exclude needs a ref name (first attempt with HEAD~2 was refused by git)
  assert.deepEqual(errsOf(f.repo), [], "control: padded fixture valid");
  const base = mkdtempSync(join(tmpdir(), "qa23-sh-"));
  try {
    const res = {};
    for (const [label, args] of [["depth-3", ["--depth=3"]], ["shallow-exclude", ["--shallow-exclude=qa23-cut"]], ["complete-no-local", ["--no-local"]]]) {
      const d = join(base, label);
      const src = label === "complete-no-local" ? f.repo : `file://${f.repo}`;
      try { execFileSync("git", ["clone", "-q", ...args, src, d], { stdio: ["ignore", "pipe", "pipe"] }); } catch (err) { res[label] = `CLONE-FAILED ${String(err.stderr).trim()}`; continue; }
      const shallow = git(d, "rev-parse", "--is-shallow-repository");
      const e = errsOf(d);
      log(`QA23-N7 ${label} (shallow=${shallow})`, e);
      res[label] = `${shallow === "true" ? "shallow" : "complete"}:${has(e, /the repository is a shallow clone/) ? "REFUSED" : (e.length ? "OTHER-ERRORS" : "ACCEPTED")}`;
    }
    console.log(`  QA23-N7 result: ${JSON.stringify(res)}`);
    assert.equal(res["depth-3"], "shallow:REFUSED");
    assert.equal(res["shallow-exclude"], "shallow:REFUSED");
    assert.equal(res["complete-no-local"], "complete:ACCEPTED");
  } finally { rmSync(base, { recursive: true, force: true }); }
}));

// ------------------------------------------------------------------------------------------------ findManifest (D-035)
test("QA23-N8 findManifest: an absent-source_commit round manifest whose entries do not hash to its candidate_id is rejected", () => withF(HIGH, (f) => {
  closeInRound3(f, { fix: f.commit, tamper: true });
  const e = errsOf(f.repo);
  log("QA23-N8", e);
  assert.ok(has(e, /manifest docs\/delivery\/candidates\/DG0\/[0-9a-f]+\.manifest\.json does not hash to sha256:/), JSON.stringify(e));
}));

test("QA23-N9 findManifest: a round manifest naming a PRESENT source_commit it does not describe is rejected", () => withF(HIGH, (f) => {
  closeInRound3(f, { src: f.commit, fix: f.commit });
  const e = errsOf(f.repo);
  log("QA23-N9", e);
  assert.ok(has(e, /does not describe its source_commit/), JSON.stringify(e));
}));

// ------------------------------------------------------------------------------------------------ residual probe
// QA23-P1 (informational probe): checkClosure skips the verified-ROUND ancestry check when the round's source_commit is
// absent (rules.mjs "if (commitPresent(repo, round.source_commit) && !isAncestor(...))"), a corollary of findManifest's
// D-035 tolerance. The verifying run's head_commit_at_start is now REQUIRED present (D-039), so it could serve as the
// fallback bound. Shape: a self-declared absent round-3 (orchestrator metadata) whose genuine run started from a commit
// (present, contains the round manifest) that does NOT contain the fix; fix = a real commit in the gate candidate.
// Reports ACCEPTED/REJECTED; asserts nothing about the outcome (the finding, if any, is recorded in the review).
test("QA23-P1 probe: fix not contained in the verifying run's head, in a self-declared absent round", () => withF(HIGH, (f) => {
  const cid = supersededManifest(f, ABS_SRC);
  const tree = git(f.repo, "rev-parse", "HEAD^{tree}");
  const orphanHead = git(f.repo, "commit-tree", tree, "-m", "run start commit without the fix in its history");
  git(f.repo, "branch", "qa23-run-start", orphanHead); // keep it reachable (present in every clone)
  const ref = fx.addRound(f, 3, "qa-verifier", CLOSE, { roundMeta: { candidate_id: cid, source_commit: ABS_SRC }, head: orphanHead });
  fx.mutate(f.repo, FJ, (d) => { d.findings[0].verification.invocation_reference = ref; d.findings[0].fix_revision = f.commit; });
  fx.commitAll(f.repo, "findings mirror");
  let isAnc = true;
  try { git(f.repo, "merge-base", "--is-ancestor", f.commit, orphanHead); } catch { isAnc = false; }
  assert.equal(isAnc, false, "setup: the fix is not in the run's starting history");
  const e = errsOf(f.repo);
  log("QA23-P1", e);
  console.log(`  QA23-P1 result: ${e.length ? "REJECTED" : "ACCEPTED"} (fix ${f.commit.slice(0, 10)} is in the gate candidate but not in the verifying run's head ${orphanHead.slice(0, 10)}; round-3 source_commit self-declared absent)`);
}));

process.on("exit", () => rmSync(hdir, { recursive: true, force: true }));
