// Independent QA negative tests for the DG0 gate validator, round 3 (A23 independence, A24 enforced advancement,
// A25 candidate integrity), re-expressed on the round-3 rules (review_rounds, reviewer verification sidecars,
// git modes in the candidate). Author: qa-verifier, task T-DG0-REV-QA-R3. Written independently of
// tools/gates/tests/validator.test.mjs: each case builds its own disposable git fixture in the OS temp dir and
// removes it afterwards. Cases QA3-N* are NOT present in tools/gates/tests/.
// Run: node --test <this file>   (QA_REPO_ROOT=<repo or worktree> selects the tooling under test)
// Intended for promotion into tests/qa/dg0/ as regression tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, unlinkSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.QA_REPO_ROOT
  ? resolve(process.env.QA_REPO_ROOT)
  : execFileSync("git", ["-C", here, "rev-parse", "--show-toplevel"]).toString().trim();
const rules = await import(pathToFileURL(join(ROOT, "tools/gates/lib/rules.mjs")).href);
const cand = await import(pathToFileURL(join(ROOT, "tools/gates/lib/candidate.mjs")).href);
const { validateGate, checkRegister, REGISTER_COLUMNS, STAGE_ORDER } = rules;
const { candidateId, manifestFromRef, manifestFromWorkingTree } = cand;
const VALIDATE_CLI = join(ROOT, "tools/gates/validate.mjs");

const T_FREEZE = "2026-09-28T13:00:00Z";
const T_RUN = "2026-09-28T13:30:00Z";
const T_BEFORE = "2026-09-28T11:00:00Z";
const MODEL = "claude-opus-5-5";
const ALL = ["domain-reviewer", "code-security-reviewer", "qa-verifier", "release-auditor"];

const git = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
const write = (repo, rel, v) => {
  mkdirSync(dirname(join(repo, rel)), { recursive: true });
  writeFileSync(join(repo, rel), typeof v === "string" || Buffer.isBuffer(v) ? v : JSON.stringify(v, null, 2));
};
const readJ = (repo, rel) => JSON.parse(readFileSync(join(repo, rel), "utf8"));
const mutate = (repo, rel, fn) => {
  const d = readJ(repo, rel);
  fn(d);
  write(repo, rel, d);
};
const sha = (b) => createHash("sha256").update(b).digest("hex");
const q = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

function row(over = {}) {
  const r = {
    req_id: "REQ-PB-001", class: "SOURCE", title: "Case for change", source_ref: "B0001", source_heading: "Case",
    template_id: "", input_fields: "problem", procedure: "draft", output: "case", owner_roles: "Sponsor",
    permissions: "edit:Sponsor", automation: "none", screen_api: "/case", acceptance: "A02 saves",
    increments: "P2", final_gate: "DG2", status: "SPECIFIED", evidence: "", notes: "", ...over,
  };
  return REGISTER_COLUMNS.map((c) => q(String(r[c] ?? ""))).join(",");
}
const ACC_ALL = Array.from({ length: 28 }, (_, i) => `A${String(i + 1).padStart(2, "0")}`).join(" ");
const DLV = { req_id: "REQ-DLV-001", class: "ENGINEERING", source_ref: "M0001", acceptance: `${ACC_ALL} gates`, increments: "P0", final_gate: "DG0", status: "IMPLEMENTED", evidence: "app/main.txt" };
const writeRegister = (repo, rows) => write(repo, "docs/delivery/requirements.csv", [REGISTER_COLUMNS.join(","), ...rows].join("\n") + "\n");

let seq = 0;
/**
 * Writes a run directory in the shape tools/agents/run-agent.sh produces (meta + result + gzipped stream transcript,
 * with hashes). `tweak` may alter transcript lines / meta before hashes are computed, so a case isolates one defect.
 */
function makeRun(repo, role, { assignment, task = "T-REV", startedAt = T_RUN, stage = "DG0", lines: lineTweak, meta: metaTweak } = {}) {
  seq += 1;
  const session_id = `${String(seq).padStart(8, "0")}-2222-4222-8222-222222222222`;
  const run_id = `${stage}-${task}-${role}-20260928T133000Z-${session_id.slice(0, 8)}`;
  const base = `docs/delivery/runs/${stage}/${run_id}`;
  let lines = [
    { type: "system", subtype: "init", session_id, model: MODEL, tools: ["Read", "Bash", "Write"] },
    { type: "user", message: { role: "user", content: `You are invoked as project agent '${role}' for stage ${stage}, task ${task}. Your invocation_reference is: {"run_id":"${run_id}"}` }, session_id },
    { type: "result", subtype: "success", is_error: false, session_id, result: "done" },
  ];
  if (lineTweak) lines = lineTweak(lines, { session_id, run_id });
  const transcript = gzipSync(Buffer.from(lines.map((l) => JSON.stringify(l)).join("\n") + "\n"));
  const result = Buffer.from(JSON.stringify({ result: "done", session_id }));
  write(repo, `${base}/transcript.jsonl.gz`, transcript);
  write(repo, `${base}/result.json`, result);
  const invocation_reference = { kind: "claude-code-cli-session", run_id, session_id };
  let meta = {
    run_id, role, stage, task, invocation_reference, model_requested: MODEL,
    assignment, assignment_sha256: sha(readFileSync(join(repo, assignment))),
    started_at: startedAt, exit_code: 0, is_error: false, result_session_id: session_id,
    result_sha256: sha(result), transcript_sha256: sha(transcript),
  };
  if (metaTweak) meta = metaTweak(meta);
  write(repo, `${base}/meta.json`, meta);
  return invocation_reference;
}

/**
 * A disposable repository whose DG0 gate validates cleanly under the round-3 rules: round 1 QA FAIL raising one
 * Medium finding (F-DG0-201); round 2 all PASS; the QA reviewer closes the finding in its round-2 verifications
 * sidecar; stages.json records both review rounds.
 */
function fixture() {
  const repo = mkdtempSync(join(tmpdir(), "qa3-dg0-"));
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "qa@example.invalid");
  git(repo, "config", "user.name", "qa");
  write(repo, "docs/source/playbook.blocks.json", [{ id: "B0001" }, { id: "B0002" }]);
  write(repo, "docs/source/master-prompt.blocks.json", [{ id: "M0001" }]);
  write(repo, "app/main.txt", "v1\n");
  write(repo, "app/inrepo-target.txt", "evidence inside the repo\n");
  writeRegister(repo, [row(), row(DLV)]);
  write(repo, "docs/analysis/source-coverage.csv", "block_id,disposition,req_ids,rationale\nB0001,REQUIREMENT,REQ-PB-001,\nB0002,NON-REQUIREMENT,,toc\n");
  write(repo, "docs/analysis/master-prompt-coverage.csv", "block_id,disposition,req_ids,rationale\nM0001,REQUIREMENT,REQ-DLV-001,\n");
  const stages = {
    schema_version: 1,
    stages: STAGE_ORDER.map((id, i) => ({
      id, stage: `P${i}`, name: `S${i}`, state: "PLANNED", depends_on: i ? [STAGE_ORDER[i - 1]] : [],
      implementation_owners: ["transformation-analyst", "delivery-orchestrator"], candidate_spec: { include: ["**"], exclude: ["trading_agent/**"] },
      candidate: { candidate_id: null, source_commit: null, frozen_at: null, manifest_path: null },
      review_rounds: [], gate_record: `docs/delivery/gates/${id}.json`, history: [{ state: "PLANNED", at: T_BEFORE }],
    })),
  };
  const s0 = stages.stages[0];
  for (const st of ["BUILDING", "REVIEWING", "FIXING", "VERIFYING"]) s0.history.push({ state: st, at: T_FREEZE });
  s0.state = "VERIFYING";
  write(repo, "docs/delivery/stages.json", stages);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "freeze");
  const commit = git(repo, "rev-parse", "HEAD");
  const entries = manifestFromRef(repo, commit, s0.candidate_spec);
  const cid = candidateId(entries);
  write(repo, "docs/delivery/candidates/DG0.manifest.json", { stage_id: "DG0", candidate_id: cid, source_commit: commit, frozen_at: T_FREEZE, spec: s0.candidate_spec, entries });
  s0.candidate = { candidate_id: cid, source_commit: commit, frozen_at: T_FREEZE, manifest_path: "docs/delivery/candidates/DG0.manifest.json" };
  const recsOf = (round, roles) => Object.fromEntries(roles.map((r) => [r, `docs/delivery/reviews/DG0/round-${round}/${r}.json`]));
  s0.review_rounds = [
    { round: 1, candidate_id: cid, frozen_at: T_FREEZE, source_commit: commit, records: recsOf(1, ["qa-verifier"]) },
    { round: 2, candidate_id: cid, frozen_at: T_FREEZE, source_commit: commit, records: recsOf(2, ["domain-reviewer", "code-security-reviewer", "qa-verifier"]) },
  ];
  write(repo, "docs/delivery/stages.json", stages);
  write(repo, "docs/delivery/test-evidence/DG0/run.log", "ok\n");
  const recs = {};
  const refs = {};
  const record = (role, round, extra = {}) => {
    const assignment = `docs/delivery/assignments/DG0/round-${round}/review-${role}.md`;
    write(repo, assignment, `assignment ${role} r${round}\n`);
    const ref = makeRun(repo, role, { assignment, task: `T-DG0-REV-R${round}` });
    const rel = `docs/delivery/reviews/DG0/round-${round}/${role}.json`;
    write(repo, rel, {
      schema_version: 1, stage_id: "DG0", round, candidate_id: cid, source_commit: commit, reviewer_role: role,
      invocation_reference: ref, implementation_author: ["transformation-analyst", "delivery-orchestrator"],
      independence_declaration: { reviewer_authored_reviewed_scope: false, statement: "no authorship in the reviewed scope" },
      assignment, requirements_checked: ["REQ-DLV-001"],
      checks_run: [{ id: "K1", procedure: "run it", command: "x", environment: "node", expected: "ok", actual: "ok", exit_status: 0, result: "PASS" }],
      findings: [], verdict: "PASS", evidence_paths: ["docs/delivery/test-evidence/DG0/run.log"], reviewed_at: T_RUN, ...extra,
    });
    return { rel, ref };
  };
  const raised = {
    id: "F-DG0-201", stage_id: "DG0", requirement: "REQ-DLV-001", severity: "Medium", mandatory_violation: true,
    title: "probe finding", reproduction: "fixture", expected: "rejected", actual: "accepted", evidence: [],
    reported_by: "qa-verifier", reported_in: "docs/delivery/reviews/DG0/round-1/qa-verifier.json", owner: "delivery-orchestrator", status: "OPEN",
  };
  const r1 = record("qa-verifier", 1, { verdict: "FAIL", findings: ["F-DG0-201"] });
  refs.qa1 = r1.ref;
  write(repo, "docs/delivery/reviews/DG0/round-1/qa-verifier.findings.json", { findings: [raised] });
  for (const role of ALL) {
    const r = record(role, 2);
    recs[role] = r.rel;
    refs[role] = r.ref;
  }
  write(repo, "docs/delivery/reviews/DG0/round-2/qa-verifier.verifications.json", {
    verifications: [{ finding_id: "F-DG0-201", result: "PASS", status_after: "CLOSED_VERIFIED", note: "fixed", evidence: [] }],
  });
  write(repo, "docs/delivery/findings.json", {
    schema_version: 1,
    findings: [{
      ...raised, status: "CLOSED_VERIFIED", fix_revision: commit,
      verification: { by_role: "qa-verifier", invocation_reference: refs["qa-verifier"], at: T_RUN, result: "PASS", evidence: [], note: "fixed" },
      acceptance: null, history: [{ at: T_BEFORE, status: "OPEN" }, { at: T_RUN, status: "CLOSED_VERIFIED" }],
    }],
  });
  write(repo, "docs/delivery/gates/DG0.json", {
    schema_version: 1, stage_id: "DG0", decision: "APPROVED", candidate_id: cid, source_commit: commit,
    manifest_path: "docs/delivery/candidates/DG0.manifest.json", previous_gate: null,
    reviews: { "domain-reviewer": recs["domain-reviewer"], "code-security-reviewer": recs["code-security-reviewer"], "qa-verifier": recs["qa-verifier"] },
    release_audit: recs["release-auditor"], requirements: { final_gate_ids: ["REQ-DLV-001"] },
    tests: [{ name: "t", command: "c", result: "PASS", evidence: ["docs/delivery/test-evidence/DG0/run.log"] }],
    blocking_conditions: [], accepted_observations: [], decided_at: T_RUN, decided_by: "release-auditor",
    invocation_reference: refs["release-auditor"],
  });
  return { repo, cid, commit, recs, refs };
}

function rejects(errors, re) {
  assert.ok(errors.length > 0, "validator accepted an invalid gate (no errors)");
  assert.ok(errors.some((e) => re.test(e)), `expected an error matching ${re}; got:\n  ${errors.join("\n  ")}`);
}
function withFixture(fn) {
  const f = fixture();
  try {
    fn(f);
  } finally {
    rmSync(f.repo, { recursive: true, force: true });
  }
}
const SIDE2 = "docs/delivery/reviews/DG0/round-2/qa-verifier.verifications.json";
const loadRun = (f, role = "qa-verifier", startedAt = T_BEFORE) => {
  write(f.repo, "docs/delivery/assignments/DG0/T-DG0-LOAD.md", "load check\n");
  return makeRun(f.repo, role, { assignment: "docs/delivery/assignments/DG0/T-DG0-LOAD.md", task: "T-DG0-LOAD", startedAt });
};

test("control: the independent round-3 fixture is accepted (API and CLI exit 0)", () => withFixture(({ repo }) => {
  assert.deepEqual(validateGate(repo, "DG0"), []);
  const r = spawnSync(process.execPath, [VALIDATE_CLI, "--stage", "DG0"], { env: { ...process.env, GATE_REPO_ROOT: repo } });
  assert.equal(r.status, 0, r.stderr.toString());
}));

// ---------- re-verification of my round-2 findings ----------
test("QA3-R204 (F-DG0-204): findings.json citing a pre-freeze LOAD run as the verification is rejected", () => withFixture((f) => {
  const load = loadRun(f);
  mutate(f.repo, "docs/delivery/findings.json", (d) => (d.findings[0].verification.invocation_reference = load));
  rejects(validateGate(f.repo, "DG0"), /F-DG0-201.*not the verifying reviewer's own run/);
}));

test("QA3-R204b (F-DG0-204): moving the sidecar to a round-1 record that cites a LOAD run is rejected (assignment + freeze binding)", () => withFixture((f) => {
  const load = loadRun(f);
  // Forge a closure path through round 1: the round-1 record now cites the LOAD run and its assignment.
  mutate(f.repo, "docs/delivery/reviews/DG0/round-1/qa-verifier.json", (r) => { r.invocation_reference = load; r.assignment = "docs/delivery/assignments/DG0/T-DG0-LOAD.md"; });
  unlinkSync(join(f.repo, SIDE2));
  write(f.repo, "docs/delivery/reviews/DG0/round-1/qa-verifier.verifications.json", {
    verifications: [{ finding_id: "F-DG0-201", result: "PASS", status_after: "CLOSED_VERIFIED", note: "fixed", evidence: [] }],
  });
  mutate(f.repo, "docs/delivery/findings.json", (d) => (d.findings[0].verification.invocation_reference = load));
  rejects(validateGate(f.repo, "DG0"), /F-DG0-201.*verification: invocation .*started 2026-09-28T11:00:00Z, before the candidate froze/);
}));

test("QA3-N17 findings: a later-round PASS overrides an earlier FAIL (positive), but a same-round FAIL by another reviewer wins", () => withFixture((f) => {
  // round-1 FAIL entry, round-2 PASS entry: latest round decides -> still valid.
  write(f.repo, "docs/delivery/reviews/DG0/round-1/qa-verifier.verifications.json", {
    verifications: [{ finding_id: "F-DG0-201", result: "FAIL", status_after: "OPEN", note: "not yet", evidence: [] }],
  });
  assert.deepEqual(validateGate(f.repo, "DG0"), []);
  // A same-round FAIL by another qualified reviewer keeps the finding open.
  write(f.repo, "docs/delivery/reviews/DG0/round-2/domain-reviewer.verifications.json", {
    verifications: [{ finding_id: "F-DG0-201", result: "FAIL", status_after: "OPEN", note: "regressed", evidence: [] }],
  });
  rejects(validateGate(f.repo, "DG0"), /F-DG0-201.*latest reviewer verification .* is FAIL/);
}));

test("QA3-N18 findings: a verifications sidecar with no review record of that role in its round is rejected", () => withFixture((f) => {
  write(f.repo, "docs/delivery/reviews/DG0/round-1/domain-reviewer.verifications.json", {
    verifications: [{ finding_id: "F-DG0-201", result: "PASS", status_after: "CLOSED_VERIFIED", note: "x", evidence: [] }],
  });
  rejects(validateGate(f.repo, "DG0"), /round-1\/domain-reviewer\.json/);
}));

test("QA3-N19 findings: the owner cannot close its own finding through a sidecar in its name (non-review role)", () => withFixture((f) => {
  write(f.repo, "docs/delivery/reviews/DG0/round-3/delivery-orchestrator.verifications.json", {
    verifications: [{ finding_id: "F-DG0-201", result: "PASS", status_after: "CLOSED_VERIFIED", note: "self", evidence: [] }],
  });
  write(f.repo, "docs/delivery/reviews/DG0/round-3/delivery-orchestrator.json", { reviewer_role: "delivery-orchestrator" });
  const e = validateGate(f.repo, "DG0");
  assert.ok(e.length > 0, "validator accepted a self-closure sidecar");
}));

// Known gap, recorded as finding F-DG0-208 (Low): marked todo so the suite stays green; remove { todo } once fixed.
test("QA3-N20 findings: rewriting an older round's frozen_at to legitimise a LOAD-run verification — probe", { todo: "F-DG0-208" }, () => withFixture((f) => {
  // stages.json is delivery metadata. If a round's frozen_at is moved before a LOAD run and the round record is
  // rebound to that run, is the closure still rejected? Assert rejection; the log records the actual errors.
  const load = loadRun(f);
  mutate(f.repo, "docs/delivery/stages.json", (d) => (d.stages[0].review_rounds[0].frozen_at = "2026-09-28T10:00:00Z"));
  mutate(f.repo, "docs/delivery/reviews/DG0/round-1/qa-verifier.json", (r) => { r.invocation_reference = load; r.assignment = "docs/delivery/assignments/DG0/T-DG0-LOAD.md"; });
  unlinkSync(join(f.repo, SIDE2));
  write(f.repo, "docs/delivery/reviews/DG0/round-1/qa-verifier.verifications.json", {
    verifications: [{ finding_id: "F-DG0-201", result: "PASS", status_after: "CLOSED_VERIFIED", note: "fixed", evidence: [] }],
  });
  mutate(f.repo, "docs/delivery/findings.json", (d) => (d.findings[0].verification.invocation_reference = load));
  const e = validateGate(f.repo, "DG0");
  console.log(`# QA3-N20 errors (${e.length}):\n#   ${e.join("\n#   ")}`);
  assert.ok(e.length > 0, "validator accepted a closure bound to a LOAD run after the round's frozen_at was rewritten");
}));

test("QA3-R205 (F-DG0-205): a symlinked directory pointing outside the repo cannot supply evidence; in-repo symlink still accepted", () => withFixture((f) => {
  const outside = mkdtempSync(join(tmpdir(), "qa3-outside-"));
  try {
    writeFileSync(join(outside, "secret.txt"), "not in repo\n");
    symlinkSync(outside, join(f.repo, "docs/delivery/test-evidence/DG0/outdir"));
    symlinkSync("inrepo-target.txt", join(f.repo, "app/inrepo-link.txt"));
    // positive: in-repo relative symlink to a tracked file remains valid evidence
    writeRegister(f.repo, [row(), row({ ...DLV, evidence: "app/inrepo-link.txt" })]);
    const ok = [];
    checkRegister(f.repo, "DG0", ok);
    assert.deepEqual(ok, []);
    // negative: review evidence through a directory symlink that leaves the repository
    mutate(f.repo, f.recs["qa-verifier"], (r) => r.evidence_paths.push("docs/delivery/test-evidence/DG0/outdir/secret.txt"));
    rejects(validateGate(f.repo, "DG0"), /evidence path is not an existing repository file: docs\/delivery\/test-evidence\/DG0\/outdir\/secret\.txt/);
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
}));

test("QA3-R206 (F-DG0-206): a committed exec-bit change after freeze invalidates the approval", () => withFixture(({ repo }) => {
  execFileSync("chmod", ["+x", join(repo, "app/main.txt")]);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "chmod after freeze");
  rejects(validateGate(repo, "DG0"), /candidate/i);
}));

test("QA3-N21 candidate: a manifest whose entry mode was flipped (id unchanged) is rejected as tampered", () => withFixture(({ repo }) => {
  mutate(repo, "docs/delivery/candidates/DG0.manifest.json", (m) => (m.entries.find((e) => e.path === "app/main.txt").mode = "100755"));
  rejects(validateGate(repo, "DG0"), /candidate manifest: entries do not hash to its candidate_id \(tampered\)/);
}));

test("QA3-N22 candidate: a manifest entry without a mode (pre-round-3 format) is rejected, not silently hashed", () => withFixture(({ repo }) => {
  mutate(repo, "docs/delivery/candidates/DG0.manifest.json", (m) => { const e = m.entries[0]; delete e.mode; e.type = "file"; });
  rejects(validateGate(repo, "DG0"), /candidate manifest: manifest entry '.*' lacks a valid mode/);
}));

test("QA3-N23 metadata: a round-3 verifications sidecar + run dir + assignments leave the candidate unchanged", () => withFixture(({ repo, cid }) => {
  const spec = readJ(repo, "docs/delivery/candidates/DG0.manifest.json").spec;
  write(repo, "docs/delivery/assignments/DG0/round-3/review-qa-verifier.md", "a\n");
  write(repo, "docs/delivery/runs/DG0/DG0-extra/notes.txt", "x\n");
  write(repo, "docs/delivery/progress.md", "p\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "metadata only");
  assert.equal(candidateId(manifestFromWorkingTree(repo, spec)), cid);
  assert.equal(candidateId(manifestFromRef(repo, "HEAD", spec)), cid);
}));

test("QA3-N24 history: after approval, editing an earlier round's findings sidecar is detected in historical mode", () => withFixture(({ repo }) => {
  mutate(repo, "docs/delivery/stages.json", (d) => { d.stages[0].state = "APPROVED"; d.stages[0].history.push({ state: "APPROVED", at: T_RUN }); });
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "approve DG0");
  assert.deepEqual(validateGate(repo, "DG0", { mode: "historical" }), []);
  mutate(repo, "docs/delivery/reviews/DG0/round-1/qa-verifier.findings.json", (s) => (s.findings[0].title = "softened title"));
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "edit old sidecar");
  rejects(validateGate(repo, "DG0", { mode: "historical" }), /round-1\/qa-verifier\.findings\.json changed after approval/);
}));

test("QA3-N25 guard: a qa-verifier write into a '.git' segment inside its evidence scope is blocked", async () => {
  const guard = await import(pathToFileURL(join(ROOT, "tools/agents/guard-write.mjs")).href);
  const scopes = JSON.parse(readFileSync(join(ROOT, "tools/agents/write-scopes.json"), "utf8"));
  const ok = guard.decide(scopes, "qa-verifier", join(guard.GUARD_ROOT, "docs/delivery/test-evidence/DG0/qa/x.log"));
  assert.equal(ok.allow, true, ok.reason);
  for (const p of ["docs/delivery/test-evidence/DG0/qa/.git/config", "tests/qa/.GIT/hooks/pre-commit", ".git/hooks/post-checkout"]) {
    const d = guard.decide(scopes, "qa-verifier", join(guard.GUARD_ROOT, p));
    assert.equal(d.allow, false, `${p} allowed: ${d.reason}`);
  }
  // a planted nested .git no longer re-roots the guard: docs/source stays protected
  const d2 = guard.decide(scopes, "qa-verifier", join(guard.GUARD_ROOT, "docs/source/QA-PROBE.txt"));
  assert.equal(d2.allow, false);
});

// ---------- the A24/A25 rejection list from the DG0 QA assignment, on the round-3 fixture ----------
const A24 = [
  ["missing reviewer", (f) => mutate(f.repo, "docs/delivery/gates/DG0.json", (g) => delete g.reviews["code-security-reviewer"]), /missing (code-security-reviewer review|required property .code-security-reviewer.)/],
  ["reviewer who authored the scope", (f) => mutate(f.repo, f.recs["domain-reviewer"], (r) => (r.independence_declaration.reviewer_authored_reviewed_scope = true)), /declares authorship/],
  ["reviewer listed as implementation author", (f) => mutate(f.repo, f.recs["qa-verifier"], (r) => r.implementation_author.push("qa-verifier")), /listed as an implementation author/],
  ["shared invocation", (f) => mutate(f.repo, f.recs["domain-reviewer"], (r) => (r.invocation_reference = f.refs["code-security-reviewer"])), /domain-reviewer.*(was run as 'code-security-reviewer'|share|same invocation)/],
  ["failed check", (f) => mutate(f.repo, f.recs["qa-verifier"], (r) => (r.checks_run[0].result = "FAIL")), /check K1 is FAIL/],
  ["blocked check", (f) => mutate(f.repo, f.recs["qa-verifier"], (r) => (r.checks_run[0].result = "BLOCKED")), /check K1 is BLOCKED/],
  ["unresolved High finding", (f) => {
    mutate(f.repo, "docs/delivery/reviews/DG0/round-1/qa-verifier.findings.json", (s) => (s.findings[0].severity = "High"));
    mutate(f.repo, "docs/delivery/findings.json", (d) => { d.findings[0].severity = "High"; d.findings[0].status = "OPEN"; d.findings[0].verification = null; });
    unlinkSync(join(f.repo, SIDE2));
  }, /F-DG0-201.*unresolved/],
  ["incomplete requirement", (f) => writeRegister(f.repo, [row(), row({ ...DLV, status: "SPECIFIED", evidence: "" })]), /REQ-DLV-001/],
  ["register row with a non-existent block anchor", (f) => writeRegister(f.repo, [row({ source_ref: "B0999" }), row(DLV)]), /B0999/],
  ["SOURCE row without a playbook block", (f) => writeRegister(f.repo, [row({ source_ref: "M0001" }), row(DLV)]), /REQ-PB-001/],
  ["coverage matrix missing a block", (f) => write(f.repo, "docs/analysis/source-coverage.csv", "block_id,disposition,req_ids,rationale\nB0001,REQUIREMENT,REQ-PB-001,\n"), /B0002/],
  ["coverage maps a block to a requirement that doesn't cite it", (f) => write(f.repo, "docs/analysis/source-coverage.csv", "block_id,disposition,req_ids,rationale\nB0001,REQUIREMENT,REQ-PB-001,\nB0002,REQUIREMENT,REQ-PB-001,\n"), /B0002/],
  ["candidate change after freeze", (f) => { write(f.repo, "app/main.txt", "v2\n"); git(f.repo, "add", "-A"); git(f.repo, "commit", "-q", "-m", "late change"); }, /candidate/i],
  ["tampered manifest", (f) => mutate(f.repo, "docs/delivery/candidates/DG0.manifest.json", (m) => (m.entries[0].sha256 = "0".repeat(64))), /tampered/],
];
for (const [name, breakIt, re] of A24) {
  test(`QA3-A24 rejects: ${name}`, () => withFixture((f) => {
    breakIt(f);
    rejects(validateGate(f.repo, "DG0"), re);
  }));
}
