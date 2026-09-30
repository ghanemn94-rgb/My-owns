#!/usr/bin/env node
// qa-verifier, DG0 round 20 (T-DG0-REV-QA-R20): D-036 against a copy of the REAL repository, not a fixture.
// Usage: node real-repo-d036.mjs <path-to-repo-to-clone>   (clones with --no-local into $TMPDIR, as CI would; removes it)
//   R1  D-035 on the real history: which recorded DG0 review rounds name a source_commit absent from a fresh clone,
//       and checkReviewRounds still reports no error for them (pruned NON-gate rounds stay tolerated).
//   R2  A drafted APPROVED DG0 gate record in the copy (schema-valid, decision APPROVED): the D-036 error
//       ("gate source_commit ... is not a commit") must be ABSENT with the real frozen commit and PRESENT when the
//       gate, its manifest copy and the stages.json candidate/round-20 copies point at a non-existent SHA.
//       `validate.mjs --stage DG0` (current mode, the CLI) is used; other errors are expected (DG0 is REVIEWING and has
//       no round-20 records yet), so only the D-036 line is judged.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";

const src = process.argv[2];
const dir = mkdtempSync(join(tmpdir(), "qa20-real-"));
const repo = join(dir, "c");
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
const has = (sha) => { try { git("cat-file", "-e", `${sha}^{commit}`); return true; } catch { return false; } };
let ok = true;
try {
  execFileSync("git", ["clone", "-q", "--no-local", src, repo]);
  console.log(`clone HEAD=${git("rev-parse", "HEAD")} commits=${git("rev-list", "--count", "HEAD")}`);
  const rules = await import(pathToFileURL(join(repo, "tools/gates/lib/rules.mjs")).href);
  const stagesRel = "docs/delivery/stages.json";
  const doc = JSON.parse(readFileSync(join(repo, stagesRel), "utf8"));
  const st = doc.stages[0];
  // R1
  const absent = st.review_rounds.filter((r) => !has(r.source_commit)).map((r) => r.round);
  console.log(`R1 rounds whose source_commit is absent from the fresh clone: [${absent.join(",")}]`);
  const errs = [];
  rules.checkReviewRounds(repo, st, errs);
  console.log(`R1 checkReviewRounds errors (${errs.length}): ${JSON.stringify(errs)}`);
  const pruneErr = errs.filter((e) => /cannot recompute from its source_commit/.test(e));
  // The active round's own records do not exist until its reviewers finish; those "file not found" lines are expected.
  const active = st.review_rounds.find((r) => r.candidate_id === st.candidate.candidate_id).round;
  const other = errs.filter((e) => !new RegExp(`round ${active} [a-z-]+: file not found`).test(e));
  const r1 = pruneErr.length === 0 && other.length === 0;
  console.log(`R1 ${r1 ? "PASS" : "FAIL"} (pruned non-gate rounds tolerated, no manifest errors; ignoring ${errs.length - other.length} not-yet-written round-${active} record(s))`);
  ok &&= r1;
  // R2
  const real = st.candidate.source_commit;
  const mrel = st.candidate.manifest_path;
  const gateRel = st.gate_record;
  const r20 = st.review_rounds.find((r) => r.candidate_id === st.candidate.candidate_id);
  const gate = (commit) => ({
    schema_version: 1, stage_id: "DG0", decision: "APPROVED", candidate_id: st.candidate.candidate_id, source_commit: commit,
    manifest_path: mrel, previous_gate: null,
    reviews: Object.fromEntries(["domain-reviewer", "code-security-reviewer", "qa-verifier"].map((r) => [r, `docs/delivery/reviews/DG0/round-${r20.round}/${r}.json`])),
    release_audit: `docs/delivery/reviews/DG0/round-${r20.round}/release-auditor.json`, requirements: { final_gate_ids: ["REQ-DLV-001"] },
    tests: [{ name: "t", command: "c", result: "PASS", evidence: ["docs/delivery/requirements.csv"] }], blocking_conditions: [], accepted_observations: [],
    decided_at: "2026-09-30T12:00:00Z", decided_by: "release-auditor",
    invocation_reference: { kind: "claude-code-cli-session", run_id: "DG0-T-QA20-PROBE-release-auditor-20260930T120000Z-00000000", session_id: "00000000-0000-4000-8000-000000000000" },
  });
  const origManifest = readFileSync(join(repo, mrel), "utf8");
  const origStages = readFileSync(join(repo, stagesRel), "utf8");
  const cli = () => spawnSync(process.execPath, [join(repo, "tools/gates/validate.mjs"), "--stage", "DG0"], { cwd: repo, encoding: "utf8" });
  const FAKE = "5a1e".repeat(10);
  for (const [label, commit, rewriteCopies] of [["control (real frozen commit)", real, false], ["gate only -> non-existent SHA", FAKE, false], ["gate + manifest + stages copies -> non-existent SHA", FAKE, true]]) {
    writeFileSync(join(repo, mrel), origManifest);
    writeFileSync(join(repo, stagesRel), origStages);
    if (rewriteCopies) {
      writeFileSync(join(repo, mrel), JSON.stringify({ ...JSON.parse(origManifest), source_commit: commit }, null, 1));
      const d = JSON.parse(origStages);
      d.stages[0].candidate.source_commit = commit;
      for (const r of d.stages[0].review_rounds) if (r.candidate_id === st.candidate.candidate_id) r.source_commit = commit;
      writeFileSync(join(repo, stagesRel), JSON.stringify(d, null, 2));
    }
    mkdirSync(dirname(join(repo, gateRel)), { recursive: true });
    writeFileSync(join(repo, gateRel), JSON.stringify(gate(commit), null, 2));
    const r = cli();
    const lines = (r.stdout + r.stderr).split("\n").filter(Boolean);
    const d036 = lines.filter((l) => /gate source_commit .* is not a commit in this repository/.test(l));
    console.log(`R2 ${label}: exit=${r.status} lines=${lines.length} D-036 lines=${JSON.stringify(d036)}`);
    for (const l of lines.slice(0, 40)) console.log(`     | ${l}`);
    const want = commit !== real;
    const pass = r.status !== 0 && (want ? d036.length === 1 : d036.length === 0);
    console.log(`R2 ${label}: ${pass ? "PASS" : "FAIL"} (expected D-036 error ${want ? "present" : "absent"})`);
    ok &&= pass;
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(`RESULT: ${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
