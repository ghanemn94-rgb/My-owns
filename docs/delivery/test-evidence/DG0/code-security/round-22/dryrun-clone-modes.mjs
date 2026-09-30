#!/usr/bin/env node
// code-security-reviewer, DG0 round 22 (T-DG0-REV-SEC-R22). Does validateGate give the same answer regardless of which
// UNREACHABLE objects a complete (non-shallow) clone happens to hold? Clones <repo> into $TMPDIR twice -- `--no-local`
// (what CI / a network fetch gets: reachable objects only) and a plain local clone (hardlinks every object, including the
// reflog-only round-18 commit 450c756) -- drafts the same synthetic APPROVED DG0 gate on the real frozen candidate in
// each, runs validateGate(current) and prints the errors that differ between the two. Removes both clones afterwards.
// Usage: node dryrun-clone-modes.mjs <path-to-repo>
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const src = process.argv[2];
const dir = mkdtempSync(join(tmpdir(), "sec22-modes-"));
async function run(mode) {
  const repo = join(dir, mode);
  execFileSync("git", ["clone", "-q", ...(mode === "no-local" ? ["--no-local", `file://${src}`] : [src]), repo]);
  const has450 = (() => { try { execFileSync("git", ["-C", repo, "cat-file", "-e", "450c756f679a911b4c736e856fc9dd5e9b2c89a8^{commit}"], { stdio: "ignore" }); return true; } catch { return false; } })();
  const rules = await import(pathToFileURL(join(repo, "tools/gates/lib/rules.mjs")).href + `?${mode}`);
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
    invocation_reference: { kind: "claude-code-cli-session", run_id: "DG0-T-SEC22-PROBE-release-auditor-20260930T120000Z-00000000", session_id: "00000000-0000-4000-8000-000000000000" },
  }, null, 2));
  const errs = rules.validateGate(repo, "DG0").map(String);
  console.log(`${mode}: HEAD=${execFileSync("git", ["-C", repo, "rev-parse", "HEAD"]).toString().trim()} shallow=${execFileSync("git", ["-C", repo, "rev-parse", "--is-shallow-repository"]).toString().trim()} has450c756=${has450} errors=${errs.length}`);
  return new Set(errs);
}
try {
  const a = await run("no-local");
  const b = await run("local");
  const onlyA = [...a].filter((e) => !b.has(e));
  const onlyB = [...b].filter((e) => !a.has(e));
  console.log(`errors only in no-local clone: ${onlyA.length}`);
  for (const e of onlyA) console.log(`   ${e}`);
  console.log(`errors only in local clone (with unreachable 450c756): ${onlyB.length}`);
  for (const e of onlyB) console.log(`   ${e}`);
  console.log(`RESULT: ${onlyA.length + onlyB.length === 0 ? "IDENTICAL" : "DIFFERENT"} validator output across clone modes`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
