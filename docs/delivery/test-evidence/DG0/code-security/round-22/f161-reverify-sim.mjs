#!/usr/bin/env node
// code-security-reviewer, DG0 round 22 (T-DG0-REV-SEC-R22), F-DG0-161 check. Today F-DG0-150/151's LATEST verification is
// in round 18 (source_commit 450c756, reflog-only in the working repository, absent from a --no-local clone), so the
// validator's answer for them depends on whether that unreachable object is in the clone's object store
// (dryrun-clone-modes.log). This script simulates what this round's re-verification does: it adds a SYNTHETIC round-22
// code-security-reviewer record (a copy of the round-21 record re-labelled round 22 / the round-22 candidate) and a
// verifications sidecar closing F-DG0-150/151, in BOTH clone modes, and prints only the errors that name F-DG0-150/151
// and are about fix ancestry. The synthetic record is not bound to a run, so invocation errors are expected and ignored.
// Usage: node f161-reverify-sim.mjs <path-to-repo>
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const src = process.argv[2];
const dir = mkdtempSync(join(tmpdir(), "sec22-f161-"));
async function run(mode, simulate) {
  const repo = join(dir, `${mode}-${simulate}`);
  execFileSync("git", ["clone", "-q", ...(mode === "no-local" ? ["--no-local", `file://${src}`] : [src]), repo]);
  const rules = await import(pathToFileURL(join(repo, "tools/gates/lib/rules.mjs")).href + `?${mode}${simulate}`);
  const st = JSON.parse(readFileSync(join(repo, "docs/delivery/stages.json"), "utf8")).stages[0];
  const r22 = "docs/delivery/reviews/DG0/round-22";
  mkdirSync(join(repo, r22), { recursive: true });
  mkdirSync(join(repo, "docs/delivery/gates"), { recursive: true });
  // The same synthetic APPROVED gate draft as dryrun-clone-modes.mjs, so validateGate reaches checkFindings.
  writeFileSync(join(repo, st.gate_record), JSON.stringify({
    schema_version: 1, stage_id: "DG0", decision: "APPROVED", candidate_id: st.candidate.candidate_id, source_commit: st.candidate.source_commit,
    manifest_path: st.candidate.manifest_path, previous_gate: null,
    reviews: Object.fromEntries(["domain-reviewer", "code-security-reviewer", "qa-verifier"].map((r) => [r, `${r22}/${r}.json`])),
    release_audit: `${r22}/release-auditor.json`, requirements: { final_gate_ids: ["REQ-DLV-001"] },
    tests: [{ name: "t", command: "c", result: "PASS", evidence: ["docs/delivery/requirements.csv"] }], blocking_conditions: [], accepted_observations: [],
    decided_at: "2026-09-30T12:00:00Z", decided_by: "release-auditor",
    invocation_reference: { kind: "claude-code-cli-session", run_id: "DG0-T-SEC22-PROBE-release-auditor-20260930T120000Z-00000000", session_id: "00000000-0000-4000-8000-000000000000" },
  }, null, 2));
  if (simulate) {
    const rec = JSON.parse(readFileSync(join(repo, "docs/delivery/reviews/DG0/round-21/code-security-reviewer.json"), "utf8"));
    writeFileSync(join(repo, `${r22}/code-security-reviewer.json`), JSON.stringify({ ...rec, round: 22, candidate_id: st.candidate.candidate_id, source_commit: st.candidate.source_commit, findings: [] }, null, 2));
    writeFileSync(join(repo, `${r22}/code-security-reviewer.verifications.json`), JSON.stringify({ verifications: ["F-DG0-150", "F-DG0-151"].map((id) => ({ finding_id: id, result: "PASS", status_after: "CLOSED_VERIFIED", note: "sim", evidence: [] })) }));
  }
  const errs = rules.validateGate(repo, "DG0").map(String).filter((e) => /F-DG0-15[01]\b/.test(e) && /fix [0-9a-f]+ is not/.test(e));
  const has450 = (() => { try { execFileSync("git", ["-C", repo, "cat-file", "-e", "450c756f679a911b4c736e856fc9dd5e9b2c89a8^{commit}"], { stdio: "ignore" }); return true; } catch { return false; } })();
  console.log(`${mode} clone, has450c756=${has450}, round-22 re-verification simulated=${simulate}: ${errs.length} fix-ancestry error(s) for F-DG0-150/151`);
  for (const e of errs) console.log(`   ${e}`);
  return errs.length;
}
try {
  const out = [];
  for (const mode of ["no-local", "local"]) for (const sim of [false, true]) out.push(await run(mode, sim));
  console.log(`RESULT: without re-verification local/no-local differ: ${out[0] !== out[2]}; with round-22 re-verification: no-local=${out[1]} local=${out[3]} -> ${out[1] === 0 && out[3] === 0 ? "IDENTICAL (0)" : "STILL DIFFERENT"}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
