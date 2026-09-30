#!/usr/bin/env node
// qa-verifier, DG0 round 29: forge a tag-object review_rounds[].source_commit in a disposable --no-local clone of the REAL
// repository and diff validateGate errors before/after (real data, not a fixture). Also: an absent-object source_commit on
// round 18 is already present in history and must NOT trip D-045. Usage: node real-repo-round-tag-forge.mjs <repo>
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const dir = mkdtempSync(join(tmpdir(), "qa29-forge-"));
const repo = join(dir, "c");
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
try {
  execFileSync("git", ["clone", "-q", "--no-local", process.argv[2], repo]);
  const env = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "qa29", GIT_COMMITTER_NAME: "qa29", GIT_AUTHOR_EMAIL: "q@example.invalid", GIT_COMMITTER_EMAIL: "q@example.invalid" };
  Object.assign(process.env, env);
  const rules = await import(pathToFileURL(join(repo, "tools/gates/lib/rules.mjs")).href);
  const sp = join(repo, "docs/delivery/stages.json");
  // validateGate returns early without a gate record, so draft the same probe APPROVED gate as real-repo-gate-blockers.mjs
  // (first attempt without it only reported "gate DG0: file not found" and never reached checkReviewRounds).
  const st0 = JSON.parse(readFileSync(sp, "utf8")).stages[0];
  const rnd = st0.review_rounds.find((r) => r.candidate_id === st0.candidate.candidate_id).round;
  mkdirSync(join(repo, "docs/delivery/gates"), { recursive: true });
  writeFileSync(join(repo, st0.gate_record), JSON.stringify({
    schema_version: 1, stage_id: "DG0", decision: "APPROVED", candidate_id: st0.candidate.candidate_id, source_commit: st0.candidate.source_commit,
    manifest_path: st0.candidate.manifest_path, previous_gate: null,
    reviews: Object.fromEntries(["domain-reviewer", "code-security-reviewer", "qa-verifier"].map((r) => [r, `docs/delivery/reviews/DG0/round-${rnd}/${r}.json`])),
    release_audit: `docs/delivery/reviews/DG0/round-${rnd}/release-auditor.json`, requirements: { final_gate_ids: ["REQ-DLV-001"] },
    tests: [{ name: "t", command: "c", result: "PASS", evidence: ["docs/delivery/requirements.csv"] }], blocking_conditions: [], accepted_observations: [],
    decided_at: "2026-09-30T12:00:00Z", decided_by: "release-auditor",
    invocation_reference: { kind: "claude-code-cli-session", run_id: "DG0-T-QA29-PROBE-release-auditor-20260930T120000Z-00000000", session_id: "00000000-0000-4000-8000-000000000000" },
  }, null, 2));
  const before = rules.validateGate(repo, "DG0").map(String);
  console.log(`clone HEAD=${git("rev-parse", "HEAD")} shallow=${git("rev-parse", "--is-shallow-repository")}; baseline errors=${before.length}; baseline D-045 errors=${before.filter((e) => /object, not a commit; a round's frozen/.test(e)).length}`);
  const st = JSON.parse(readFileSync(sp, "utf8"));
  const r27 = st.stages[0].review_rounds.find((r) => r.round === 27);
  const r18 = st.stages[0].review_rounds.find((r) => r.round === 18);
  let r18type; try { r18type = git("cat-file", "-t", r18.source_commit); } catch { r18type = "ABSENT"; }
  console.log(`round 18 source_commit ${r18.source_commit.slice(0, 10)} type=${r18type} (must stay tolerated)`);
  git("tag", "-a", "qa29-r27", "-m", "qa29 forge", r27.source_commit);
  const tag = git("rev-parse", "qa29-r27");
  console.log(`round 27 source_commit ${r27.source_commit.slice(0, 10)} -> annotated tag ${tag.slice(0, 10)} (type ${git("cat-file", "-t", tag)}, peels to ${git("rev-parse", tag + "^{commit}").slice(0, 10)})`);
  r27.source_commit = tag;
  writeFileSync(sp, JSON.stringify(st, null, 2) + "\n");
  const after = rules.validateGate(repo, "DG0").map(String);
  const added = after.filter((e) => !before.includes(e));
  console.log(`after forge: errors=${after.length}; NEW errors (${added.length}):`);
  for (const e of added) console.log(`  + ${e}`);
  const d045 = added.filter((e) => /round 27 source_commit .* is a tag object, not a commit/.test(e));
  const r18hit = after.some((e) => /round 18 source_commit .* object, not a commit/.test(e));
  console.log(`RESULT: forged tag ${d045.length ? "REJECTED by D-045" : "NOT rejected by D-045"}; round-18 absent source_commit tripped D-045: ${r18hit}`);
  process.exitCode = d045.length && !r18hit ? 0 : 1;
} finally { rmSync(dir, { recursive: true, force: true }); }
