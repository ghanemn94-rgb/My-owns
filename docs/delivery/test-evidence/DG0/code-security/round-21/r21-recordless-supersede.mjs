#!/usr/bin/env node
// code-security-reviewer, DG0 round 21 (T-DG0-REV-SEC-R21). Reproduction for the D-037 `recordless` flag in
// collectRaisedFindings/checkFindings (tools/gates/lib/rules.mjs).
//
// Claim under test: "a finding raised ONLY by a record-less findings sidecar and absent from findings.json is not a
// dropped finding". The code takes `recordless` from the LATEST raising sidecar only (raised.set supersedes), so a
// record-less sidecar in a LATER round that re-lists an existing, properly raised finding exempts it from the drop check.
// The findings sidecar of a record-less round is bound to no run (there is no record whose invocation could bind it),
// so a single hand-written JSON file is enough; no transcript, no run directory.
//
// Scenario (in a disposable clone of <repo>, HEAD = the round-21 freeze):
//   target = F-DG0-242 (High, raised by qa-verifier in round 20 with a record, currently unresolved)
//   A  baseline                                   -> "unresolved (FIXED_PENDING_VERIFICATION)" error
//   B  delete it from findings.json               -> "dropped" error (control: the drop IS caught)
//   C  B + round-22 entry (records {}) in stages.json + reviews/DG0/round-22/qa-verifier.findings.json re-listing it
//                                                 -> expected secure: still an error; actual D-037: NO error for it
//   D  C but with rules.mjs from the round-20 baseline (a23c4d4, pre-D-037)  -> shows it is a D-037 regression
//   E  C plus a qa-verifier.json file in round-22 (record present)           -> drop is caught again (control)
// A drafted APPROVED gate (as in qa's real-repo-gate-blockers.mjs) makes validateGate run checkFindings with a gate.
// Usage: node r21-recordless-supersede.mjs <path-to-repo>
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const TARGET = "F-DG0-242";
const base = mkdtempSync(join(tmpdir(), "sec21-rl-"));
const results = {};
try {
  const clone = (name) => {
    const repo = join(base, name);
    execFileSync("git", ["clone", "-q", "--no-local", process.argv[2], repo]);
    return repo;
  };
  const git = (repo, ...a) => execFileSync("git", ["-C", repo, "-c", "user.name=sec21", "-c", "user.email=sec21@example.invalid", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...a], { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
  const draftGate = (repo) => {
    const st = JSON.parse(readFileSync(join(repo, "docs/delivery/stages.json"), "utf8")).stages[0];
    const rnd = st.review_rounds.find((r) => r.candidate_id === st.candidate.candidate_id).round;
    mkdirSync(dirname(join(repo, st.gate_record)), { recursive: true });
    writeFileSync(join(repo, st.gate_record), JSON.stringify({
      schema_version: 1, stage_id: "DG0", decision: "APPROVED", candidate_id: st.candidate.candidate_id, source_commit: st.candidate.source_commit,
      manifest_path: st.candidate.manifest_path, previous_gate: null,
      reviews: Object.fromEntries(["domain-reviewer", "code-security-reviewer", "qa-verifier"].map((r) => [r, `docs/delivery/reviews/DG0/round-${rnd}/${r}.json`])),
      release_audit: `docs/delivery/reviews/DG0/round-${rnd}/release-auditor.json`, requirements: { final_gate_ids: ["REQ-DLV-001"] },
      tests: [{ name: "t", command: "c", result: "PASS", evidence: ["docs/delivery/requirements.csv"] }], blocking_conditions: [], accepted_observations: [],
      decided_at: "2026-09-30T12:00:00Z", decided_by: "release-auditor",
      invocation_reference: { kind: "claude-code-cli-session", run_id: "DG0-T-SEC21-PROBE-release-auditor-20260930T120000Z-00000000", session_id: "00000000-0000-4000-8000-000000000000" },
    }, null, 2));
  };
  const dropTarget = (repo) => {
    const p = join(repo, "docs/delivery/findings.json");
    const doc = JSON.parse(readFileSync(p, "utf8"));
    const f = doc.findings.find((x) => x.id === TARGET);
    doc.findings = doc.findings.filter((x) => x.id !== TARGET);
    writeFileSync(p, JSON.stringify(doc, null, 2) + "\n");
    return f;
  };
  const forgeRound22 = (repo, withRecord) => {
    const sp = join(repo, "docs/delivery/stages.json");
    const sd = JSON.parse(readFileSync(sp, "utf8"));
    const st = sd.stages[0];
    const last = st.review_rounds[st.review_rounds.length - 1];
    st.review_rounds.push({ round: 22, candidate_id: last.candidate_id, records: {}, frozen_at: last.frozen_at, source_commit: last.source_commit });
    writeFileSync(sp, JSON.stringify(sd, null, 2) + "\n");
    // re-list the finding exactly as the reviewer raised it (so the immutable-field check stays quiet)
    const orig = JSON.parse(readFileSync(join(repo, "docs/delivery/reviews/DG0/round-20/qa-verifier.findings.json"), "utf8")).findings.find((x) => x.id === TARGET);
    const dir = join(repo, "docs/delivery/reviews/DG0/round-22");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "qa-verifier.findings.json"), JSON.stringify({ findings: [orig] }, null, 2) + "\n");
    if (withRecord) copyFileSync(join(repo, "docs/delivery/reviews/DG0/round-20/qa-verifier.json"), join(dir, "qa-verifier.json"));
    // commit it as an append-only addition (write-once allows adds)
    git(repo, "add", "-A", "docs/delivery/reviews/DG0/round-22", "docs/delivery/stages.json", "docs/delivery/findings.json");
    git(repo, "commit", "-q", "--no-verify", "-m", "sec21 probe: forged record-less round-22 findings sidecar");
  };
  const run = async (label, repo, rulesFrom = null) => {
    if (rulesFrom) writeFileSync(join(repo, "tools/gates/lib/rules.mjs"), git(repo, "show", `${rulesFrom}:tools/gates/lib/rules.mjs`) + "\n");
    draftGate(repo);
    const rules = await import(pathToFileURL(join(repo, "tools/gates/lib/rules.mjs")).href + `?${label}`);
    const errs = rules.validateGate(repo, "DG0").map(String);
    const about = errs.filter((e) => e.includes(TARGET));
    const r22 = errs.filter((e) => e.includes("round-22") || e.includes("round 22"));
    results[label] = { total: errs.length, about_target: about, mentioning_round22: r22 };
    console.log(`\n== ${label}: validateGate errors=${errs.length}; errors about ${TARGET}: ${about.length}; errors mentioning round 22: ${r22.length}`);
    for (const e of [...about, ...r22]) console.log(`   ${e}`);
  };

  let r = clone("A"); console.log(`clone HEAD=${git(r, "rev-parse", "HEAD")}`);
  await run("A-baseline", r);
  r = clone("B"); dropTarget(r); await run("B-dropped-only", r);
  r = clone("C"); dropTarget(r); forgeRound22(r, false); await run("C-dropped+recordless-forged-sidecar(D-037 rules)", r);
  r = clone("D"); dropTarget(r); forgeRound22(r, false); await run("D-same-with-pre-D-037-rules(a23c4d4)", r, "a23c4d411cd4185e56a3f12cf7c1973f7964440b");
  r = clone("E"); dropTarget(r); forgeRound22(r, true); await run("E-control-record-present", r);

  const bypass = results["C-dropped+recordless-forged-sidecar(D-037 rules)"].about_target.length === 0 &&
    results["B-dropped-only"].about_target.some((e) => /dropped/.test(e));
  const regression = results["D-same-with-pre-D-037-rules(a23c4d4)"].about_target.some((e) => /dropped/.test(e));
  console.log(`\nRESULT: bypass=${bypass} (High finding ${TARGET} deleted from findings.json with zero validator errors about it); pre-D-037 caught it=${regression}`);
  process.exitCode = bypass ? 1 : 0;
} finally {
  rmSync(base, { recursive: true, force: true });
}
