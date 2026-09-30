#!/usr/bin/env node
// qa-verifier, DG0 round 20 (T-DG0-REV-QA-R20): which validator errors would remain against the REAL repository once the
// round-20 records exist? Clones <repo> (--no-local) into $TMPDIR, drafts a schema-valid APPROVED DG0 gate on the real
// frozen candidate/commit, runs validateGate (current mode) and classifies every error. Errors that only reflect "the
// round is not finished yet" (state REVIEWING, round-20 records absent) are separated from errors that no amount of
// finishing round 20 can clear (pruned history, record-less sidecars, dropped findings). Removes the clone afterwards.
// Usage: node real-repo-gate-blockers.mjs <path-to-repo>
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "qa20-block-"));
const repo = join(dir, "c");
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
const exists = (sha) => { try { git("cat-file", "-e", `${sha}^{commit}`); return true; } catch { return false; } };
try {
  execFileSync("git", ["clone", "-q", process.argv[2], repo]);
  console.log(`clone HEAD=${git("rev-parse", "HEAD")} commits=${git("rev-list", "--count", "HEAD")} root=${git("rev-list", "--max-parents=0", "HEAD")}`);
  const rules = await import(pathToFileURL(join(repo, "tools/gates/lib/rules.mjs")).href);
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
    invocation_reference: { kind: "claude-code-cli-session", run_id: "DG0-T-QA20-PROBE-release-auditor-20260930T120000Z-00000000", session_id: "00000000-0000-4000-8000-000000000000" },
  }, null, 2));
  const errs = rules.validateGate(repo, "DG0").map(String);
  const classes = [
    ["UNFINISHED-ROUND (clears when round 20 completes)", (e) => new RegExp(`round-${rnd}/|DG0 state REVIEWING`).test(e)],
    ["PRUNED fix_revision not ancestor of its verified round candidate", (e) => /: fix [0-9a-f]+ is not in the verified round-\d+ candidate/.test(e)],
    ["PRUNED fix_revision not ancestor of the gate candidate", (e) => /: fix [0-9a-f]+ is not in the gate candidate/.test(e)],
    ["PRUNED verifier run head_commit_at_start does not contain the round manifest", (e) => /verification: invocation .* started from [0-9a-f]+, which does not contain/.test(e)],
    ["RECORD-LESS sidecar (round has no record for the role)", (e) => /record for round-\d+ is not listed in stages.json review_rounds/.test(e)],
    ["DROPPED finding (raised in a sidecar, absent from findings.json)", (e) => /is missing from findings.json \(dropped\)/.test(e)],
    ["OTHER", () => true],
  ];
  const buckets = new Map(classes.map(([k]) => [k, []]));
  for (const e of errs) buckets.get(classes.find(([, f]) => f(e))[0]).push(e);
  console.log(`validateGate(current) errors: ${errs.length}`);
  for (const [k, v] of buckets) {
    console.log(`\n== ${k}: ${v.length}`);
    for (const e of v) console.log(`   ${e}`);
  }
  // Are the commits the non-UNFINISHED errors name actually absent from the repository?
  const shas = new Set();
  for (const [k, v] of buckets) if (/^PRUNED/.test(k)) for (const e of v) for (const m of e.matchAll(/(?:fix|from) ([0-9a-f]{10})/g)) shas.add(m[1]);
  console.log(`\ncommits named by PRUNED errors: ${[...shas].map((s) => `${s}=${exists(s) ? "present" : "absent"}`).join(" ")}`);
  const fj = JSON.parse(readFileSync(join(repo, "docs/delivery/findings.json"), "utf8")).findings;
  const withFix = fj.filter((f) => f.fix_revision);
  const absentFix = withFix.filter((f) => !exists(f.fix_revision));
  console.log(`findings.json: ${fj.length} findings, ${withFix.length} with fix_revision, ${absentFix.length} whose fix_revision is absent: ${absentFix.map((f) => `${f.id}(${f.status})`).join(" ")}`);
  const permanent = errs.length - buckets.get(classes[0][0]).length;
  console.log(`\nRESULT: ${permanent} error(s) that finishing round ${rnd} cannot clear`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
