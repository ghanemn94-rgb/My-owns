// Independent QA negative tests for the DG0 gate validator, round 2 (A23 independence, A24 enforced advancement,
// A25 candidate integrity). Author: qa-verifier, task T-DG0-REV-QA-R2. Written independently of
// tools/gates/tests/validator.test.mjs: each case builds its own disposable git fixture in the OS temp dir and
// removes it afterwards. Cases QA2-N* are NOT present in tools/gates/tests/.
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

/** A disposable repository whose DG0 gate validates cleanly: round 1 QA FAIL raising one Medium finding, round 2 all PASS. */
function fixture() {
  const repo = mkdtempSync(join(tmpdir(), "qa2-dg0-"));
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "qa@example.invalid");
  git(repo, "config", "user.name", "qa");
  write(repo, "docs/source/playbook.blocks.json", [{ id: "B0001" }, { id: "B0002" }]);
  write(repo, "docs/source/master-prompt.blocks.json", [{ id: "M0001" }]);
  write(repo, "app/main.txt", "v1\n");
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
  record("qa-verifier", 1, { verdict: "FAIL", findings: ["F-DG0-201"] });
  write(repo, "docs/delivery/reviews/DG0/round-1/qa-verifier.findings.json", { findings: [raised] });
  for (const role of ALL) {
    const r = record(role, 2);
    recs[role] = r.rel;
    refs[role] = r.ref;
  }
  write(repo, "docs/delivery/findings.json", {
    schema_version: 1,
    findings: [{
      ...raised, status: "CLOSED_VERIFIED", fix_revision: commit,
      verification: { by_role: "qa-verifier", invocation_reference: refs["qa-verifier"], at: T_RUN, result: "PASS", evidence: [] },
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
/** Replace a review's invocation with a fresh run of the same role/assignment, built with a single defect. */
function rebindReview(f, role, opts) {
  const rec = readJ(f.repo, f.recs[role]);
  const ref = makeRun(f.repo, role, { assignment: rec.assignment, task: "T-DG0-REV-R2", ...opts });
  mutate(f.repo, f.recs[role], (r) => (r.invocation_reference = ref));
  if (role === "release-auditor") mutate(f.repo, "docs/delivery/gates/DG0.json", (g) => (g.invocation_reference = ref));
  if (role === "qa-verifier") mutate(f.repo, "docs/delivery/findings.json", (d) => (d.findings[0].verification.invocation_reference = ref));
  return ref;
}

test("control: the independent round-2 fixture is accepted (API and CLI exit 0)", () => withFixture(({ repo }) => {
  assert.deepEqual(validateGate(repo, "DG0"), []);
  const r = spawnSync(process.execPath, [VALIDATE_CLI, "--stage", "DG0"], { env: { ...process.env, GATE_REPO_ROOT: repo } });
  assert.equal(r.status, 0, r.stderr.toString());
}));

// ---------- regression for my round-1 findings (re-expressed on the round-2 run format) ----------
test("QA2-R201 (F-DG0-201): the QA review citing its own pre-freeze LOAD run of the same role is rejected", () => withFixture((f) => {
  write(f.repo, "docs/delivery/assignments/DG0/T-DG0-LOAD.md", "load check\n");
  const load = makeRun(f.repo, "qa-verifier", { assignment: "docs/delivery/assignments/DG0/T-DG0-LOAD.md", task: "T-DG0-LOAD", startedAt: T_BEFORE });
  mutate(f.repo, f.recs["qa-verifier"], (r) => (r.invocation_reference = load));
  const e = validateGate(f.repo, "DG0");
  rejects(e, /qa-verifier.*ran assignment docs\/delivery\/assignments\/DG0\/T-DG0-LOAD\.md/);
  rejects(e, /qa-verifier.*before the candidate froze/);
}));

test("QA2-R201b (F-DG0-201): the right assignment but a run started before the freeze is rejected", () => withFixture((f) => {
  rebindReview(f, "domain-reviewer", { startedAt: T_BEFORE });
  rejects(validateGate(f.repo, "DG0"), /domain-reviewer.*before the candidate froze/);
}));

test("QA2-R202 (F-DG0-202): a bare non-existent evidence file name on an IMPLEMENTED DG0 row is rejected", () => withFixture(({ repo }) => {
  writeRegister(repo, [row(), row({ ...DLV, evidence: "NO-SUCH-EVIDENCE.md" })]);
  const e = [];
  checkRegister(repo, "DG0", e);
  rejects(e, /REQ-DLV-001: evidence is not an existing repository file: NO-SUCH-EVIDENCE\.md/);
}));

// ---------- new negative cases not present in tools/gates/tests ----------
test("QA2-N01 provenance: a run recorded under another stage cannot back a DG0 review", () => withFixture((f) => {
  rebindReview(f, "code-security-reviewer", { meta: (m) => ({ ...m, stage: "DG1" }) });
  rejects(validateGate(f.repo, "DG0"), /code-security-reviewer.*belongs to stage DG1, not DG0/);
}));

test("QA2-N02 provenance: transcript model differs from the orchestrator's requested model", () => withFixture((f) => {
  rebindReview(f, "domain-reviewer", { lines: (ls) => ls.map((l) => (l.subtype === "init" ? { ...l, model: "claude-haiku-cheap" } : l)) });
  rejects(validateGate(f.repo, "DG0"), /transcript model claude-haiku-cheap != requested claude-opus-5-5/);
}));

test("QA2-N03 provenance: transcript whose final result is an error, even though meta claims success", () => withFixture((f) => {
  rebindReview(f, "qa-verifier", { lines: (ls) => ls.map((l) => (l.type === "result" ? { ...l, is_error: true, subtype: "error_during_execution" } : l)) });
  rejects(validateGate(f.repo, "DG0"), /qa-verifier.*does not end in a successful result/);
}));

test("QA2-N04 provenance: a transcript from a different role's prompt cannot back the auditor", () => withFixture((f) => {
  rebindReview(f, "release-auditor", {
    lines: (ls) => ls.map((l) => (l.type === "user" ? { ...l, message: { role: "user", content: String(l.message.content).replace("'release-auditor'", "'backend-workflow-engineer'") } } : l)),
  });
  rejects(validateGate(f.repo, "DG0"), /release-auditor.*does not contain the runner prompt for 'release-auditor'/);
}));

test("QA2-N05 provenance: result_session_id drift (the CLI resumed a different session) is rejected", () => withFixture((f) => {
  rebindReview(f, "domain-reviewer", { meta: (m) => ({ ...m, result_session_id: "ffffffff-2222-4222-8222-222222222222" }) });
  rejects(validateGate(f.repo, "DG0"), /domain-reviewer.*result_session_id does not match/);
}));

test("QA2-N06 provenance: result.json swapped after the run no longer matches meta.result_sha256", () => withFixture((f) => {
  const ref = f.refs["code-security-reviewer"];
  write(f.repo, `docs/delivery/runs/DG0/${ref.run_id}/result.json`, JSON.stringify({ result: "PASS everything" }));
  rejects(validateGate(f.repo, "DG0"), /code-security-reviewer.*result\.json does not match meta\.result_sha256/);
}));

test("QA2-N07 findings: a review record may not list a finding that no reviewer sidecar raised (orchestrator-invented)", () => withFixture((f) => {
  mutate(f.repo, "docs/delivery/findings.json", (d) => d.findings.push({ ...d.findings[0], id: "F-DG0-299", status: "OPEN", verification: null, fix_revision: null }));
  mutate(f.repo, f.recs["domain-reviewer"], (r) => (r.findings = ["F-DG0-299"]));
  const e = validateGate(f.repo, "DG0");
  rejects(e, /lists finding F-DG0-299, which no reviewer sidecar raised/);
  rejects(e, /F-DG0-299.*unresolved \(OPEN\)/);
}));

test("QA2-N08 findings: a sidecar may not raise a finding in another reviewer's name", () => withFixture((f) => {
  mutate(f.repo, "docs/delivery/reviews/DG0/round-1/qa-verifier.findings.json", (s) => (s.findings[0].reported_by = "domain-reviewer"));
  rejects(validateGate(f.repo, "DG0"), /reported_by domain-reviewer but the sidecar belongs to qa-verifier/);
}));

test("QA2-N09 findings: reviewer-set mandatory_violation cannot be flipped off in findings.json", () => withFixture((f) => {
  mutate(f.repo, "docs/delivery/findings.json", (d) => (d.findings[0].mandatory_violation = false));
  rejects(validateGate(f.repo, "DG0"), /F-DG0-201: mandatory_violation in findings\.json \(false\) differs from the reviewer's \(true\)/);
}));

test("QA2-N10 findings: verification cited from a run of a different role than by_role is rejected", () => withFixture((f) => {
  mutate(f.repo, "docs/delivery/findings.json", (d) => (d.findings[0].verification.invocation_reference = f.refs["domain-reviewer"]));
  rejects(validateGate(f.repo, "DG0"), /F-DG0-201.*verification.*was run as 'domain-reviewer', not 'qa-verifier'/);
}));

test("QA2-N11 findings: a CLOSED_VERIFIED finding verified by a pre-freeze LOAD run of the reporter is rejected", () => withFixture((f) => {
  // The review-level binding (F-DG0-201) must also hold for finding verifications: a load-check run that
  // started before the candidate froze and executed a different assignment cannot have verified the fix.
  write(f.repo, "docs/delivery/assignments/DG0/T-DG0-LOAD.md", "load check\n");
  const load = makeRun(f.repo, "qa-verifier", { assignment: "docs/delivery/assignments/DG0/T-DG0-LOAD.md", task: "T-DG0-LOAD", startedAt: T_BEFORE });
  mutate(f.repo, "docs/delivery/findings.json", (d) => (d.findings[0].verification.invocation_reference = load));
  rejects(validateGate(f.repo, "DG0"), /F-DG0-201.*verification.*(assignment|before the candidate froze)/);
}));

test("QA2-N12 register: evidence that is a symlink pointing outside the repository is rejected", () => withFixture(({ repo }) => {
  const outside = mkdtempSync(join(tmpdir(), "qa2-outside-"));
  try {
    writeFileSync(join(outside, "secret.txt"), "not in repo\n");
    symlinkSync(join(outside, "secret.txt"), join(repo, "app/evidence-link.txt"));
    writeRegister(repo, [row(), row({ ...DLV, evidence: "app/evidence-link.txt" })]);
    const e = [];
    checkRegister(repo, "DG0", e);
    rejects(e, /evidence is not an existing repository file: app\/evidence-link\.txt/);
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
}));

test("QA2-N13 register: an evidence entry padded with whitespace or duplicated ';' still must resolve", () => withFixture(({ repo }) => {
  writeRegister(repo, [row(), row({ ...DLV, evidence: "app/main.txt; ;docs/nope.md" })]);
  const e = [];
  checkRegister(repo, "DG0", e);
  rejects(e, /evidence is not an existing repository file: docs\/nope\.md/);
}));

test("QA2-N14 candidate: a committed post-freeze change to a tracked file's mode (exec bit) — reported, not asserted", () => withFixture(({ repo }) => {
  // Informational probe: records whether the candidate identity covers the executable bit.
  execFileSync("chmod", ["+x", join(repo, "app/main.txt")]);
  const errs = validateGate(repo, "DG0");
  console.log(`# QA2-N14 exec-bit change detected by candidate: ${errs.some((x) => /candidate:/.test(x))}`);
}));

test("QA2-N15 metadata: a new review round, verifications sidecar and run dirs leave the candidate and gate unchanged", () => withFixture(({ repo, cid }) => {
  const spec = readJ(repo, "docs/delivery/candidates/DG0.manifest.json").spec;
  write(repo, "docs/delivery/reviews/DG0/round-3/qa-verifier.verifications.json", { verifications: [] });
  write(repo, "docs/delivery/reviews/DG0/round-3/qa-verifier.md", "narrative\n");
  write(repo, "docs/delivery/runs/DG0/DG0-extra/notes.txt", "x\n");
  write(repo, "docs/delivery/handbacks/DG0/extra.md", "h\n");
  write(repo, "trading_agent/x.py", "print(1)\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "metadata only");
  assert.equal(candidateId(manifestFromWorkingTree(repo, spec)), cid);
  assert.equal(candidateId(manifestFromRef(repo, "HEAD", spec)), cid);
  assert.deepEqual(validateGate(repo, "DG0"), []);
}));

test("QA2-N16 candidate: deleting a review-round findings sidecar that raised a finding is caught (dropped finding source)", () => withFixture(({ repo }) => {
  unlinkSync(join(repo, "docs/delivery/reviews/DG0/round-1/qa-verifier.findings.json"));
  const e = validateGate(repo, "DG0");
  rejects(e, /F-DG0-201: no reviewer sidecar raised it|which no reviewer sidecar raised/);
}));
