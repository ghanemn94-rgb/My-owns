#!/usr/bin/env node
// code-security-reviewer, DG0 round 21 (T-DG0-REV-SEC-R21). Reproduction for F-DG0-158 (D-037 `recordless` drop exemption).
//
// import-findings.mjs imports a findings sidecar's findings WITH OR WITHOUT a <role>.json record (an interrupted run).
// D-037 makes checkFindings skip the "dropped" error for a finding whose latest raising sidecar is record-less, and such
// a finding is listed in no review record, so the independent `referenced` check does not see it either. Result: once
// such a finding is imported, deleting it from findings.json (whatever its status or severity) produces NO error.
//
// Real data used: F-DG0-239 (raised only in the record-less round-18 qa-verifier.findings.json, imported, now CLOSED).
//   F1  baseline (D-037 rules)                                  -> errors about F-DG0-239: expect 0
//   F2  delete F-DG0-239 from findings.json (D-037 rules)       -> secure: "dropped" error; actual: ?
//   F3  F2 with the round-20 baseline rules (a23c4d4, pre-D-037) -> "dropped" error expected
//   F4  F2 but first set F-DG0-239 to OPEN/High in the sidecar-free sense is not needed: the check ignores status, so
//       deleting an OPEN High imported from an interrupted run is the same code path (shown by F5 on a synthetic copy).
//   F5  synthetic: re-status F-DG0-239 OPEN in findings.json (an unresolved finding) -> "unresolved" error (control),
//       then delete it -> errors about it: ?
// Usage: node r21-recordless-drop.mjs <path-to-repo>
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const T = "F-DG0-239";
const base = mkdtempSync(join(tmpdir(), "sec21-drop-"));
const out = {};
try {
  const clone = (n) => { const r = join(base, n); execFileSync("git", ["clone", "-q", "--no-local", process.argv[2], r]); return r; };
  const git = (r, ...a) => execFileSync("git", ["-C", r, ...a], { stdio: ["ignore", "pipe", "pipe"] }).toString();
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
  const edit = (repo, fn) => {
    const p = join(repo, "docs/delivery/findings.json");
    const d = JSON.parse(readFileSync(p, "utf8"));
    fn(d);
    writeFileSync(p, JSON.stringify(d, null, 2) + "\n");
  };
  const run = async (label, repo, rulesFrom = null) => {
    if (rulesFrom) writeFileSync(join(repo, "tools/gates/lib/rules.mjs"), git(repo, "show", `${rulesFrom}:tools/gates/lib/rules.mjs`));
    draftGate(repo);
    const rules = await import(pathToFileURL(join(repo, "tools/gates/lib/rules.mjs")).href + `?${label}`);
    const errs = rules.validateGate(repo, "DG0").map(String);
    const about = errs.filter((e) => e.includes(T));
    out[label] = about;
    console.log(`\n== ${label}: total errors=${errs.length}; errors about ${T}: ${about.length}`);
    for (const e of about) console.log(`   ${e}`);
  };
  const del = (d) => { d.findings = d.findings.filter((f) => f.id !== T); };
  const reopen = (d) => { const f = d.findings.find((x) => x.id === T); f.status = "OPEN"; delete f.verification; };

  let r = clone("F1"); console.log(`clone HEAD=${git(r, "rev-parse", "HEAD").trim()}`);
  await run("F1-baseline", r);
  r = clone("F2"); edit(r, del); await run("F2-deleted(D-037)", r);
  r = clone("F3"); edit(r, del); await run("F3-deleted(pre-D-037 a23c4d4)", r, "a23c4d411cd4185e56a3f12cf7c1973f7964440b");
  r = clone("F5a"); edit(r, reopen); await run("F5a-reopened-OPEN(control)", r);
  r = clone("F5b"); edit(r, reopen); edit(r, del); await run("F5b-reopened-then-deleted(D-037)", r);
  const bypass = out["F2-deleted(D-037)"].length === 0 && out["F5b-reopened-then-deleted(D-037)"].length === 0 && out["F5a-reopened-OPEN(control)"].length > 0;
  console.log(`\nRESULT: silent-drop=${bypass}; pre-D-037 reported the drop=${out["F3-deleted(pre-D-037 a23c4d4)"].some((e) => /dropped/.test(e))}`);
  process.exitCode = bypass ? 1 : 0;
} finally {
  rmSync(base, { recursive: true, force: true });
}
