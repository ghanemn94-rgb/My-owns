// Validator self-tests (acceptance A23 independent reviews, A24 enforced advancement, A25 candidate integrity).
// Run: node --test tools/gates/tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { candidateId, manifestFromRef, manifestFromWorkingTree } from "../lib/candidate.mjs";
import { validateGate, validatePipeline, reconcile, REGISTER_COLUMNS, STAGE_ORDER } from "../lib/rules.mjs";
import { parseCsv } from "../lib/csv.mjs";

const T_FREEZE = "2026-09-28T12:00:00Z";
const T_RUN = "2026-09-28T12:30:00Z";
const ROLES = ["domain-reviewer", "code-security-reviewer", "qa-verifier", "release-auditor"];
const REQUIRED = ["domain-reviewer", "code-security-reviewer", "qa-verifier"];
const fixtures = [];

function sh(repo, ...args) {
  return execFileSync("git", ["-C", repo, ...args], { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}
function put(repo, rel, content) {
  mkdirSync(dirname(join(repo, rel)), { recursive: true });
  writeFileSync(join(repo, rel), typeof content === "string" || Buffer.isBuffer(content) ? content : JSON.stringify(content, null, 2));
}
function get(repo, rel) {
  return JSON.parse(readFileSync(join(repo, rel), "utf8"));
}
function sha(buf) {
  return createHash("sha256").update(buf).digest("hex");
}
function csvLine(values) {
  return values.map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(",");
}
function reqRow(over) {
  const base = {
    req_id: "REQ-PB-001", class: "SOURCE", title: "Diagnostic form", source_ref: "B0001", source_heading: "T01",
    template_id: "T01", input_fields: "Dimension", procedure: "fill", output: "record", owner_roles: "TL",
    permissions: "edit:TL", automation: "none", screen_api: "/diagnostic", acceptance: "A01 persists",
    increments: "P2", final_gate: "DG2", status: "SPECIFIED", evidence: "", notes: "",
  };
  const r = { ...base, ...over };
  return csvLine(REGISTER_COLUMNS.map((c) => r[c]));
}

function stagesDoc() {
  return {
    schema_version: 1,
    stages: STAGE_ORDER.map((id, i) => ({
      id, stage: `P${i}`, name: `Stage ${i}`, state: "PLANNED", depends_on: i ? [STAGE_ORDER[i - 1]] : [],
      implementation_owners: ["delivery-orchestrator"], candidate_spec: { include: ["**"], exclude: ["trading_agent/**"] },
      candidate: { candidate_id: null, source_commit: null, frozen_at: null, manifest_path: null },
      review_rounds: [], gate_record: `docs/delivery/gates/${id}.json`,
      history: [{ state: "PLANNED", at: T_FREEZE }],
    })),
  };
}

let counter = 0;
/** Writes a realistic run directory: meta + result + gzipped stream transcript, with hashes, like run-agent.sh. */
function makeRun(repo, role, { assignment, startedAt = T_RUN, task = "T-REV", stage = "DG0" } = {}) {
  counter++;
  const session_id = `${String(counter).padStart(8, "0")}-1111-4111-8111-111111111111`;
  const run_id = `${stage}-${task}-${role}-20260928T123000Z-${session_id.slice(0, 8)}`;
  const base = `docs/delivery/runs/${stage}/${run_id}`;
  const lines = [
    { type: "system", subtype: "init", session_id, model: "claude-opus-5-5", tools: ["Read", "Bash", "Write"] },
    { type: "user", message: { role: "user", content: `You are invoked as project agent '${role}' for stage ${stage}, task ${task}. Your invocation_reference is: {"run_id":"${run_id}"}` }, session_id },
    { type: "result", subtype: "success", is_error: false, session_id, result: "done" },
  ];
  const transcript = gzipSync(Buffer.from(lines.map((l) => JSON.stringify(l)).join("\n") + "\n"));
  const result = Buffer.from(JSON.stringify({ result: "done" }));
  put(repo, `${base}/transcript.jsonl.gz`, transcript);
  put(repo, `${base}/result.json`, result);
  const invocation_reference = { kind: "claude-code-cli-session", run_id, session_id };
  put(repo, `${base}/meta.json`, {
    run_id, role, stage, task, invocation_reference, model_requested: "claude-opus-5-5",
    assignment, assignment_sha256: sha(readFileSync(join(repo, assignment))),
    started_at: startedAt, exit_code: 0, is_error: false, result_session_id: session_id,
    result_sha256: sha(result), transcript_sha256: sha(transcript),
  });
  return invocation_reference;
}

/** Builds a repository whose DG0 gate is fully valid (a round-1 FAIL with one fixed finding, round-2 PASS). */
function buildValidRepo() {
  const repo = mkdtempSync(join(tmpdir(), "gate-fixture-"));
  fixtures.push(repo);
  sh(repo, "init", "-q", "-b", "main");
  sh(repo, "config", "user.email", "t@example.com");
  sh(repo, "config", "user.name", "t");
  put(repo, "docs/source/playbook.blocks.json", [{ id: "B0001" }, { id: "B0002" }]);
  put(repo, "docs/source/master-prompt.blocks.json", [{ id: "M0001" }]);
  const all = Array.from({ length: 28 }, (_, i) => `A${String(i + 1).padStart(2, "0")}`).join(" ");
  put(repo, "tools/gates/validate.mjs", "// the implementation under review\n");
  put(repo, "docs/delivery/requirements.csv", [
    REGISTER_COLUMNS.join(","),
    reqRow({}),
    reqRow({ req_id: "REQ-DLV-001", class: "ENGINEERING", source_ref: "M0001", acceptance: `${all} validator`, increments: "P0", final_gate: "DG0", status: "IMPLEMENTED", evidence: "tools/gates/validate.mjs" }),
  ].join("\n") + "\n");
  put(repo, "docs/analysis/source-coverage.csv", "block_id,disposition,req_ids,rationale\nB0001,REQUIREMENT,REQ-PB-001,\nB0002,NON-REQUIREMENT,,cover text\n");
  put(repo, "docs/analysis/master-prompt-coverage.csv", "block_id,disposition,req_ids,rationale\nM0001,REQUIREMENT,REQ-DLV-001,\n");
  put(repo, "src/app.txt", "deliverable v1\n");
  put(repo, "trading_agent/unrelated.py", "print('not part of any candidate')\n");
  const doc = stagesDoc();
  doc.stages[0].implementation_owners = ["transformation-analyst", "delivery-orchestrator"];
  doc.stages[0].history.push({ state: "BUILDING", at: T_FREEZE }, { state: "REVIEWING", at: T_FREEZE }, { state: "FIXING", at: T_FREEZE }, { state: "VERIFYING", at: T_FREEZE });
  doc.stages[0].state = "VERIFYING";
  put(repo, "docs/delivery/stages.json", doc);
  sh(repo, "add", "-A");
  sh(repo, "commit", "-q", "-m", "candidate");
  const head = sh(repo, "rev-parse", "HEAD");
  const spec = doc.stages[0].candidate_spec;
  const entries = manifestFromRef(repo, head, spec);
  const cid = candidateId(entries);
  put(repo, "docs/delivery/candidates/DG0.manifest.json", { stage_id: "DG0", candidate_id: cid, source_commit: head, frozen_at: T_FREEZE, spec, entries });
  doc.stages[0].candidate = { candidate_id: cid, source_commit: head, frozen_at: T_FREEZE, manifest_path: "docs/delivery/candidates/DG0.manifest.json" };
  put(repo, "docs/delivery/stages.json", doc);
  put(repo, "docs/delivery/test-evidence/DG0/validator.txt", "PASS\n");
  const record = (role, round, extra = {}) => {
    const assignment = `docs/delivery/assignments/DG0/round-${round}/${role}.md`;
    put(repo, assignment, `assignment for ${role} round ${round}\n`);
    const rel = `docs/delivery/reviews/DG0/round-${round}/${role}.json`;
    const rec = {
      schema_version: 1, stage_id: "DG0", round, candidate_id: cid, source_commit: head, reviewer_role: role,
      invocation_reference: makeRun(repo, role, { assignment, task: `T-REV-R${round}` }),
      implementation_author: ["transformation-analyst", "delivery-orchestrator"],
      independence_declaration: { reviewer_authored_reviewed_scope: false, statement: "I authored nothing in scope." },
      assignment, requirements_checked: ["REQ-DLV-001"],
      checks_run: [{ id: "C1", procedure: "run validator", command: "node v", environment: "node 22", expected: "PASS", actual: "PASS", exit_status: 0, result: "PASS" }],
      findings: [], verdict: "PASS", evidence_paths: ["docs/delivery/test-evidence/DG0/validator.txt"], reviewed_at: T_RUN, ...extra,
    };
    put(repo, rel, rec);
    return rel;
  };
  // Round 1: code-security raises a High finding (FAIL).
  const finding = {
    id: "F-DG0-101", stage_id: "DG0", requirement: "REQ-DLV-001", severity: "High", mandatory_violation: true,
    title: "validator accepted a missing reviewer", reproduction: "delete a review", expected: "fail", actual: "pass",
    evidence: [], reported_by: "code-security-reviewer", reported_in: "docs/delivery/reviews/DG0/round-1/code-security-reviewer.json",
    owner: "delivery-orchestrator", status: "OPEN", history: [],
  };
  record("code-security-reviewer", 1, { verdict: "FAIL", findings: ["F-DG0-101"] });
  put(repo, "docs/delivery/reviews/DG0/round-1/code-security-reviewer.findings.json", { findings: [finding] });
  // Round 2: all PASS; code-security verifies the fix.
  const records = {};
  for (const role of ROLES) records[role] = record(role, 2);
  const csRec = get(repo, records["code-security-reviewer"]);
  // The reporter verifies the fix in its own round-2 sidecar (the source of truth for closure).
  put(repo, "docs/delivery/reviews/DG0/round-2/code-security-reviewer.verifications.json", {
    verifications: [{ finding_id: "F-DG0-101", result: "PASS", status_after: "CLOSED_VERIFIED", note: "fixed", evidence: [] }],
  });
  edit(repo, "docs/delivery/stages.json", (d) => {
    const recs = (round) => Object.fromEntries(REQUIRED.map((r) => [r, `docs/delivery/reviews/DG0/round-${round}/${r}.json`]));
    d.stages[0].review_rounds = [
      { round: 1, candidate_id: cid, frozen_at: T_FREEZE, source_commit: head, records: { "code-security-reviewer": "docs/delivery/reviews/DG0/round-1/code-security-reviewer.json" } },
      { round: 2, candidate_id: cid, frozen_at: T_FREEZE, source_commit: head, records: recs(2) },
    ];
  });
  put(repo, "docs/delivery/findings.json", {
    schema_version: 1,
    findings: [{
      ...finding, status: "CLOSED_VERIFIED", fix_revision: head,
      verification: { by_role: "code-security-reviewer", invocation_reference: csRec.invocation_reference, at: T_RUN, result: "PASS", evidence: [], note: "fixed" },
      acceptance: null, history: [{ at: T_FREEZE, status: "OPEN" }, { at: T_RUN, status: "CLOSED_VERIFIED" }],
    }],
  });
  put(repo, "docs/delivery/gates/DG0.json", {
    schema_version: 1, stage_id: "DG0", decision: "APPROVED", candidate_id: cid, source_commit: head,
    manifest_path: "docs/delivery/candidates/DG0.manifest.json", previous_gate: null,
    reviews: { "domain-reviewer": records["domain-reviewer"], "code-security-reviewer": records["code-security-reviewer"], "qa-verifier": records["qa-verifier"] },
    release_audit: records["release-auditor"], requirements: { final_gate_ids: ["REQ-DLV-001"] },
    tests: [{ name: "validator self-test", command: "node --test", result: "PASS", evidence: ["docs/delivery/test-evidence/DG0/validator.txt"] }],
    blocking_conditions: [], accepted_observations: [], decided_at: T_RUN, decided_by: "release-auditor",
    invocation_reference: get(repo, records["release-auditor"]).invocation_reference,
  });
  return { repo, cid, head, records };
}

/** Marks DG0 APPROVED and commits everything (the state historical validation expects). */
function approveAndCommit(repo) {
  edit(repo, "docs/delivery/stages.json", (d) => {
    d.stages[0].history.push({ state: "APPROVED", at: T_RUN });
    d.stages[0].state = "APPROVED";
  });
  sh(repo, "add", "-A");
  sh(repo, "commit", "-q", "-m", "DG0 approved");
}

function edit(repo, rel, fn) {
  const d = get(repo, rel);
  fn(d);
  put(repo, rel, d);
}
function expectError(errors, pattern) {
  assert.ok(errors.some((e) => pattern.test(e)), `expected an error matching ${pattern}, got:\n${errors.join("\n")}`);
}

test.after(() => fixtures.forEach((d) => rmSync(d, { recursive: true, force: true })));

test("a fully evidenced DG0 gate passes in current and historical mode", () => {
  const { repo } = buildValidRepo();
  assert.deepEqual(validateGate(repo, "DG0"), []);
  approveAndCommit(repo);
  assert.deepEqual(validateGate(repo, "DG0", { mode: "historical" }), []);
  assert.deepEqual(validatePipeline(repo).errors, []);
});

test("A24: a missing specialist reviewer fails the gate", () => {
  const { repo } = buildValidRepo();
  edit(repo, "docs/delivery/gates/DG0.json", (g) => delete g.reviews["qa-verifier"]);
  expectError(validateGate(repo, "DG0"), /qa-verifier/);
});

test("A23: a reviewer who authored the scope, or who is an owner, is rejected", () => {
  const a = buildValidRepo();
  edit(a.repo, a.records["domain-reviewer"], (r) => r.implementation_author.push("domain-reviewer"));
  expectError(validateGate(a.repo, "DG0"), /listed as an implementation author/);
  const b = buildValidRepo();
  edit(b.repo, "docs/delivery/stages.json", (d) => d.stages[0].implementation_owners.push("qa-verifier"));
  expectError(validateGate(b.repo, "DG0"), /implementation owner/);
  const c = buildValidRepo();
  edit(c.repo, c.records["qa-verifier"], (r) => (r.independence_declaration.reviewer_authored_reviewed_scope = true));
  expectError(validateGate(c.repo, "DG0"), /declares authorship/);
});

test("A23: reviewers sharing one invocation are not independent", () => {
  const { repo, records } = buildValidRepo();
  const dom = get(repo, records["domain-reviewer"]);
  edit(repo, records["qa-verifier"], (r) => (r.invocation_reference = dom.invocation_reference));
  expectError(validateGate(repo, "DG0"), /share invocation|was run as 'domain-reviewer'/);
});

test("A24 / F-DG0-102: fabricated or incomplete provenance is rejected", () => {
  // No run directory at all.
  const a = buildValidRepo();
  edit(a.repo, a.records["qa-verifier"], (r) => (r.invocation_reference = { kind: "claude-code-cli-session", run_id: "DG0-made-up", session_id: "99999999-9999-4999-8999-999999999999" }));
  expectError(validateGate(a.repo, "DG0"), /file not found/);
  // A hand-written 4-field meta.json without transcript/result.
  const b = buildValidRepo();
  const ref = get(b.repo, b.records["qa-verifier"]).invocation_reference;
  const base = `docs/delivery/runs/DG0/${ref.run_id}`;
  put(b.repo, `${base}/meta.json`, { run_id: ref.run_id, role: "qa-verifier", invocation_reference: ref, exit_code: 0, is_error: false });
  unlinkSync(join(b.repo, `${base}/transcript.jsonl.gz`));
  const errs = validateGate(b.repo, "DG0");
  expectError(errs, /missing transcript\.jsonl\.gz/);
  expectError(errs, /result_session_id does not match/);
  // A tampered transcript no longer matches its recorded hash.
  const c = buildValidRepo();
  const cref = get(c.repo, c.records["domain-reviewer"]).invocation_reference;
  put(c.repo, `docs/delivery/runs/DG0/${cref.run_id}/transcript.jsonl.gz`, gzipSync(Buffer.from("{}\n")));
  expectError(validateGate(c.repo, "DG0"), /transcript\.jsonl\.gz does not match meta\.transcript_sha256/);
  // A run recorded under a different role.
  const d = buildValidRepo();
  const dref = get(d.repo, d.records["qa-verifier"]).invocation_reference;
  edit(d.repo, `docs/delivery/runs/DG0/${dref.run_id}/meta.json`, (m) => (m.role = "backend-workflow-engineer"));
  expectError(validateGate(d.repo, "DG0"), /was run as 'backend-workflow-engineer'/);
});

test("F-DG0-201: a review bound to an unrelated run of the same role is rejected", () => {
  // Point the QA record at a successful LOAD-check run of qa-verifier that started before the freeze.
  const { repo, records } = buildValidRepo();
  put(repo, "docs/delivery/assignments/DG0/T-DG0-LOAD.md", "load check\n");
  const loadRef = makeRun(repo, "qa-verifier", { assignment: "docs/delivery/assignments/DG0/T-DG0-LOAD.md", task: "T-DG0-LOAD", startedAt: "2026-09-28T11:00:00Z" });
  edit(repo, records["qa-verifier"], (r) => (r.invocation_reference = loadRef));
  const errs = validateGate(repo, "DG0");
  expectError(errs, /ran assignment docs\/delivery\/assignments\/DG0\/T-DG0-LOAD\.md/);
  expectError(errs, /before the candidate froze/);
  // Editing the assignment after the run breaks the binding too.
  const b = buildValidRepo();
  const rec = get(b.repo, b.records["domain-reviewer"]);
  put(b.repo, rec.assignment, "rewritten after the review ran\n");
  expectError(validateGate(b.repo, "DG0"), /assignment file changed since the run/);
});

test("A24: failed or BLOCKED checks and non-PASS verdicts fail the gate", () => {
  const a = buildValidRepo();
  edit(a.repo, a.records["qa-verifier"], (r) => (r.checks_run[0].result = "BLOCKED"));
  expectError(validateGate(a.repo, "DG0"), /check C1 is BLOCKED/);
  const b = buildValidRepo();
  edit(b.repo, b.records["domain-reviewer"], (r) => (r.verdict = "FAIL"));
  expectError(validateGate(b.repo, "DG0"), /verdict is FAIL/);
  const c = buildValidRepo();
  edit(c.repo, "docs/delivery/gates/DG0.json", (g) => (g.tests[0].result = "FAIL"));
  expectError(validateGate(c.repo, "DG0"), /test 'validator self-test' is FAIL/);
  const d = buildValidRepo();
  edit(d.repo, "docs/delivery/gates/DG0.json", (g) => (g.tests = []));
  expectError(validateGate(d.repo, "DG0"), /tests: fewer than 1 items/);
});

test("A24: unresolved blocking findings fail the gate; owners cannot verify their own fix", () => {
  const a = buildValidRepo();
  edit(a.repo, "docs/delivery/findings.json", (d) => (d.findings[0].status = "FIXED_PENDING_VERIFICATION"));
  expectError(validateGate(a.repo, "DG0"), /unresolved/);
  const b = buildValidRepo();
  edit(b.repo, "docs/delivery/findings.json", (d) => (d.findings[0].owner = "code-security-reviewer"));
  expectError(validateGate(b.repo, "DG0"), /verified by its own owner/);
});

test("F-DG0-101: findings cannot escape by relabelling, dropping or downgrading", () => {
  // Relabelled to another stage.
  const a = buildValidRepo();
  edit(a.repo, "docs/delivery/findings.json", (d) => {
    d.findings[0].stage_id = "DG1";
    d.findings[0].status = "OPEN";
  });
  const ea = validateGate(a.repo, "DG0");
  expectError(ea, /relabelled to DG1/);
  expectError(ea, /unresolved \(OPEN\)/);
  // Dropped from findings.json.
  const b = buildValidRepo();
  edit(b.repo, "docs/delivery/findings.json", (d) => (d.findings = []));
  expectError(validateGate(b.repo, "DG0"), /missing from findings\.json \(dropped\)/);
  // Severity downgraded to Low and accepted as an observation.
  const c = buildValidRepo();
  edit(c.repo, "docs/delivery/findings.json", (d) => {
    Object.assign(d.findings[0], { severity: "Low", mandatory_violation: false, status: "ACCEPTED_OBSERVATION", verification: null,
      acceptance: { rationale: "cosmetic only, tracked", owner: "delivery-orchestrator", accepted_by: ["qa-verifier", "release-auditor"] } });
  });
  edit(c.repo, "docs/delivery/gates/DG0.json", (g) => (g.accepted_observations = ["F-DG0-101"]));
  expectError(validateGate(c.repo, "DG0"), /severity in findings\.json \("Low"\) differs from the reviewer's \("High"\)/);
  // A sidecar may not smuggle a finding into another stage.
  const d = buildValidRepo();
  edit(d.repo, "docs/delivery/reviews/DG0/round-1/code-security-reviewer.findings.json", (s) => (s.findings[0].stage_id = "DG1"));
  expectError(validateGate(d.repo, "DG0"), /labelled DG1 but was raised in DG0/);
  // Only Low non-mandatory findings may be accepted.
  const e = buildValidRepo();
  const side = "docs/delivery/reviews/DG0/round-1/code-security-reviewer.findings.json";
  edit(e.repo, side, (s) => Object.assign(s.findings[0], { severity: "Medium", mandatory_violation: false }));
  edit(e.repo, "docs/delivery/findings.json", (d) => {
    Object.assign(d.findings[0], { severity: "Medium", mandatory_violation: false, status: "ACCEPTED_OBSERVATION", verification: null,
      acceptance: { rationale: "cosmetic only, tracked", owner: "delivery-orchestrator", accepted_by: ["qa-verifier", "release-auditor"] } });
  });
  edit(e.repo, "docs/delivery/gates/DG0.json", (g) => (g.accepted_observations = ["F-DG0-101"]));
  expectError(validateGate(e.repo, "DG0"), /only Low, non-mandatory/);
});

test("A24 / F-DG0-106 / F-DG0-202: incomplete requirements, placeholder evidence and coverage gaps fail", () => {
  const a = buildValidRepo();
  const csv = readFileSync(join(a.repo, "docs/delivery/requirements.csv"), "utf8").replace(",IMPLEMENTED,", ",SPECIFIED,");
  writeFileSync(join(a.repo, "docs/delivery/requirements.csv"), csv);
  expectError(validateGate(a.repo, "DG0"), /requires IMPLEMENTED/);
  const v = buildValidRepo();
  writeFileSync(join(v.repo, "docs/delivery/requirements.csv"), readFileSync(join(v.repo, "docs/delivery/requirements.csv"), "utf8").replace(",IMPLEMENTED,", ",VERIFIED,"));
  expectError(validateGate(v.repo, "DG0"), /invalid status 'VERIFIED'/);
  const q = buildValidRepo();
  edit(q.repo, q.records["qa-verifier"], (r) => (r.requirements_checked = []));
  expectError(validateGate(q.repo, "DG0"), /qa-verifier did not check it/);
  const b = buildValidRepo();
  put(b.repo, "docs/analysis/source-coverage.csv", "block_id,disposition,req_ids,rationale\nB0001,REQUIREMENT,REQ-PB-001,\n");
  expectError(validateGate(b.repo, "DG0"), /B0002 has no disposition/);
  for (const bogus of ["NO-SUCH-EVIDENCE.md", "#x", ".", "docs", "../outside.txt"]) {
    const c = buildValidRepo();
    const text = readFileSync(join(c.repo, "docs/delivery/requirements.csv"), "utf8").replace("tools/gates/validate.mjs", bogus);
    writeFileSync(join(c.repo, "docs/delivery/requirements.csv"), text);
    expectError(validateGate(c.repo, "DG0"), /evidence is not an existing repository file/);
  }
  const d = buildValidRepo();
  edit(d.repo, d.records["domain-reviewer"], (r) => r.evidence_paths.push("docs"));
  expectError(validateGate(d.repo, "DG0"), /evidence path is not an existing repository file: docs/);
});

test("A25: a source change invalidates the approval; review metadata does not", () => {
  const { repo } = buildValidRepo();
  put(repo, "docs/delivery/reviews/DG0/round-2/notes.md", "late note\n");
  put(repo, "docs/delivery/test-evidence/DG0/extra.log", "log\n");
  put(repo, "docs/delivery/progress.md", "checkpoint\n");
  put(repo, "trading_agent/unrelated.py", "print('edited unrelated project')\n");
  assert.deepEqual(validateGate(repo, "DG0"), []);
  put(repo, "src/app.txt", "deliverable v2\n");
  expectError(validateGate(repo, "DG0"), /hashes to .* approval covers/);
  put(repo, "src/app.txt", "deliverable v1\n");
  approveAndCommit(repo);
  put(repo, "src/app.txt", "deliverable v3 (later stage)\n");
  sh(repo, "commit", "-qam", "later stage work");
  assert.deepEqual(validateGate(repo, "DG0", { mode: "historical" }), []);
  assert.ok(reconcile(repo).report.length > 0);
});

test("A25 / F-DG0-103: symlinks are part of the candidate identity; submodules are refused", () => {
  const repo = mkdtempSync(join(tmpdir(), "cand-"));
  fixtures.push(repo);
  sh(repo, "init", "-q", "-b", "main");
  put(repo, "app.txt", "a\n");
  put(repo, "other.txt", "b\n");
  symlinkSync("app.txt", join(repo, "entry.txt"));
  const spec = { include: ["**"], exclude: ["trading_agent/**"] };
  const before = candidateId(manifestFromWorkingTree(repo, spec));
  assert.ok(manifestFromWorkingTree(repo, spec).some((e) => e.path === "entry.txt" && e.mode === "120000"));
  unlinkSync(join(repo, "entry.txt"));
  symlinkSync("other.txt", join(repo, "entry.txt"));
  assert.notEqual(candidateId(manifestFromWorkingTree(repo, spec)), before, "repointing a symlink must change the candidate");
  sh(repo, "-c", "user.email=t@e", "-c", "user.name=t", "add", "-A");
  sh(repo, "-c", "user.email=t@e", "-c", "user.name=t", "commit", "-qm", "c");
  assert.equal(candidateId(manifestFromRef(repo, "HEAD", spec)), candidateId(manifestFromWorkingTree(repo, spec)));
  sh(repo, "update-index", "--add", "--cacheinfo", "160000", "a".repeat(40), "vendor/sub");
  assert.throws(() => manifestFromWorkingTree(repo, spec), /gitlink/);
});

test("F-DG0-104: the manifest spec must equal the stage spec and the approved policy", () => {
  const a = buildValidRepo();
  edit(a.repo, "docs/delivery/candidates/DG0.manifest.json", (m) => (m.spec = { include: ["**"], exclude: ["trading_agent/**", "src/**"] }));
  const errs = validateGate(a.repo, "DG0");
  expectError(errs, /spec differs from the stage's candidate_spec/);
  expectError(errs, /exclude must be/);
  const b = buildValidRepo();
  edit(b.repo, "docs/delivery/stages.json", (d) => (d.stages[0].candidate_spec.exclude = ["trading_agent/**", "apps/**"]));
  expectError(validateGate(b.repo, "DG0"), /candidate_spec exclude must be/);
});

test("A25: a tampered manifest or a stale review candidate is detected", () => {
  const a = buildValidRepo();
  edit(a.repo, "docs/delivery/candidates/DG0.manifest.json", (m) => (m.entries[0].sha256 = "0".repeat(64)));
  expectError(validateGate(a.repo, "DG0"), /tampered/);
  const b = buildValidRepo();
  edit(b.repo, b.records["qa-verifier"], (r) => (r.candidate_id = "sha256:" + "a".repeat(64)));
  expectError(validateGate(b.repo, "DG0"), /reviewed candidate/);
});

test("F-DG0-102: approval records are immutable after approval (historical mode)", () => {
  const a = buildValidRepo();
  approveAndCommit(a.repo);
  edit(a.repo, a.records["domain-reviewer"], (r) => (r.summary = "rewritten after approval"));
  sh(a.repo, "commit", "-qam", "rewrite review");
  expectError(validateGate(a.repo, "DG0", { mode: "historical" }), /changed after approval/);
  const b = buildValidRepo();
  approveAndCommit(b.repo);
  edit(b.repo, "docs/delivery/findings.json", (d) => (d.findings[0].fix_summary = "edited later"));
  expectError(validateGate(b.repo, "DG0", { mode: "historical" }), /DG0 findings changed after approval/);
  const c = buildValidRepo();
  approveAndCommit(c.repo);
  edit(c.repo, "docs/delivery/gates/DG0.json", (g) => (g.notes = "edited, uncommitted"));
  expectError(validateGate(c.repo, "DG0", { mode: "historical" }), /working-tree docs\/delivery\/gates\/DG0\.json differs/);
  const d = buildValidRepo(); // never committed as APPROVED
  edit(d.repo, "docs/delivery/stages.json", (s) => {
    s.stages[0].history.push({ state: "APPROVED", at: T_RUN });
    s.stages[0].state = "APPROVED";
  });
  expectError(validateGate(d.repo, "DG0", { mode: "historical" }), /never been committed with decision APPROVED/);
});

test("the gate record must be written by the audited release-auditor invocation", () => {
  const { repo, records } = buildValidRepo();
  edit(repo, "docs/delivery/gates/DG0.json", (g) => (g.invocation_reference = get(repo, records["qa-verifier"]).invocation_reference));
  expectError(validateGate(repo, "DG0"), /not written by the audited release-auditor/);
});

test("A24: the pipeline cannot advance past a gate that is not APPROVED", () => {
  const { repo } = buildValidRepo();
  edit(repo, "docs/delivery/stages.json", (d) => {
    d.stages[1].history.push({ state: "BUILDING", at: T_RUN });
    d.stages[1].state = "BUILDING";
  });
  expectError(validatePipeline(repo).errors, /DG1 is BUILDING while earlier gate DG0 is not APPROVED/);
  approveAndCommit(repo);
  assert.deepEqual(validatePipeline(repo).errors, []);
  edit(repo, "docs/delivery/stages.json", (d) => {
    d.stages[2].history.push({ state: "BUILDING", at: T_RUN });
    d.stages[2].state = "BUILDING";
  });
  expectError(validatePipeline(repo).errors, /DG2 is BUILDING while earlier gate DG1/);
});

test("illegal stage transitions are rejected", () => {
  const { repo } = buildValidRepo();
  edit(repo, "docs/delivery/stages.json", (d) => {
    d.stages[1].history.push({ state: "APPROVED", at: T_RUN });
    d.stages[1].state = "APPROVED";
  });
  expectError(validatePipeline(repo).errors, /illegal transition PLANNED -> APPROVED/);
});

test("an APPROVED gate with a BLOCKED decision or blocking conditions fails", () => {
  const { repo } = buildValidRepo();
  edit(repo, "docs/delivery/gates/DG0.json", (g) => {
    g.decision = "BLOCKED";
    g.blocking_conditions = ["source docx missing"];
  });
  const errors = validateGate(repo, "DG0");
  expectError(errors, /decision is BLOCKED/);
  expectError(errors, /blocking conditions recorded/);
});

test("F-DG0-107: the CSV parser rejects text after a closing quote and ragged rows", () => {
  assert.throws(() => parseCsv('a,b\n"x"y,z\n'), /after closing quote/);
  assert.throws(() => parseCsv("a,b\n1,2,3\n"), /has 3 fields, header has 2/);
  assert.deepEqual(parseCsv('a,b\n"x,1","y ""q"""\n').rows, [{ a: "x,1", b: 'y "q"' }]);
});

test("F-DG0-110 / F-DG0-204: closure comes from the reviewer's own verification sidecar and bound run", () => {
  // A later FAIL verification keeps the finding open even if findings.json says closed.
  const a = buildValidRepo();
  put(a.repo, "docs/delivery/reviews/DG0/round-2/code-security-reviewer.verifications.json", {
    verifications: [{ finding_id: "F-DG0-101", result: "FAIL", status_after: "OPEN", note: "still broken", evidence: [] }],
  });
  const ea = validateGate(a.repo, "DG0");
  expectError(ea, /latest reviewer verification .* is FAIL/);
  expectError(ea, /differs from the reviewer's status_after OPEN/);
  // No sidecar at all.
  const b = buildValidRepo();
  unlinkSync(join(b.repo, "docs/delivery/reviews/DG0/round-2/code-security-reviewer.verifications.json"));
  expectError(validateGate(b.repo, "DG0"), /no reviewer verifications sidecar verifies it/);
  // findings.json cites a pre-freeze LOAD run instead of the verifier's own round run.
  const c = buildValidRepo();
  put(c.repo, "docs/delivery/assignments/DG0/T-DG0-LOAD.md", "load check\n");
  const loadRef = makeRun(c.repo, "code-security-reviewer", { assignment: "docs/delivery/assignments/DG0/T-DG0-LOAD.md", task: "T-DG0-LOAD", startedAt: "2026-09-28T11:00:00Z" });
  edit(c.repo, "docs/delivery/findings.json", (d) => (d.findings[0].verification.invocation_reference = loadRef));
  expectError(validateGate(c.repo, "DG0"), /not the verifying reviewer's own run/);
  // Verification evidence must exist; fix_revision must be a commit contained in the verified candidate.
  const e = buildValidRepo();
  put(e.repo, "docs/delivery/reviews/DG0/round-2/code-security-reviewer.verifications.json", {
    verifications: [{ finding_id: "F-DG0-101", result: "PASS", status_after: "CLOSED_VERIFIED", note: "fixed", evidence: ["does/not/exist.log"] }],
  });
  edit(e.repo, "docs/delivery/findings.json", (d) => (d.findings[0].verification.evidence = ["does/not/exist.log"]));
  expectError(validateGate(e.repo, "DG0"), /verification evidence is not an existing repository file/);
  const f = buildValidRepo();
  edit(f.repo, "docs/delivery/findings.json", (d) => (d.findings[0].fix_revision = "not-a-commit"));
  expectError(validateGate(f.repo, "DG0"), /needs a full fix_revision commit id/);
  const g = buildValidRepo();
  put(g.repo, "later.txt", "a fix committed after the candidate froze\n");
  sh(g.repo, "add", "later.txt");
  sh(g.repo, "commit", "-qm", "later fix");
  const later = sh(g.repo, "rev-parse", "HEAD");
  edit(g.repo, "docs/delivery/findings.json", (d) => (d.findings[0].fix_revision = later));
  expectError(validateGate(g.repo, "DG0"), /is not in the verified round-2 candidate/);
});

test("F-DG0-101 residual: deleting an earlier review round is detected", () => {
  // Round directory on disk but not recorded, and recorded but missing.
  const a = buildValidRepo();
  put(a.repo, "docs/delivery/reviews/DG0/round-9/qa-verifier.json", { stray: true });
  expectError(validateGate(a.repo, "DG0"), /round-9 exists but is not recorded/);
  const b = buildValidRepo();
  rmSync(join(b.repo, "docs/delivery/reviews/DG0/round-1"), { recursive: true, force: true });
  edit(b.repo, "docs/delivery/findings.json", (d) => (d.findings = []));
  expectError(validateGate(b.repo, "DG0"), /round 1 code-security-reviewer: file not found/);
  // Deleting committed review evidence is visible in git history even if stages.json is rewritten too.
  const c = buildValidRepo();
  sh(c.repo, "add", "-A");
  sh(c.repo, "commit", "-qm", "reviews recorded");
  rmSync(join(c.repo, "docs/delivery/reviews/DG0/round-1"), { recursive: true, force: true });
  edit(c.repo, "docs/delivery/stages.json", (d) => (d.stages[0].review_rounds = d.stages[0].review_rounds.filter((r) => r.round !== 1)));
  edit(c.repo, "docs/delivery/findings.json", (d) => (d.findings = []));
  sh(c.repo, "add", "-A");
  sh(c.repo, "commit", "-qm", "hide round 1");
  expectError(validateGate(c.repo, "DG0"), /was deleted from git history/);
});

test("F-DG0-205: evidence that is a symlink to a file outside the repository is rejected", () => {
  const { repo, records } = buildValidRepo();
  const outside = mkdtempSync(join(tmpdir(), "outside-"));
  fixtures.push(outside);
  writeFileSync(join(outside, "secret.txt"), "not under version control\n");
  symlinkSync(join(outside, "secret.txt"), join(repo, "docs/delivery/test-evidence/DG0/link.txt"));
  edit(repo, records["domain-reviewer"], (r) => r.evidence_paths.push("docs/delivery/test-evidence/DG0/link.txt"));
  expectError(validateGate(repo, "DG0"), /evidence path is not an existing repository file: docs\/delivery\/test-evidence\/DG0\/link\.txt/);
});

test("F-DG0-112 / F-DG0-206: file mode and entry type are part of the candidate identity", () => {
  const repo = mkdtempSync(join(tmpdir(), "cand-mode-"));
  fixtures.push(repo);
  sh(repo, "init", "-q", "-b", "main");
  const spec = { include: ["**"], exclude: ["trading_agent/**"] };
  put(repo, "run.sh", "echo hi\n");
  const before = candidateId(manifestFromWorkingTree(repo, spec));
  execFileSync("chmod", ["+x", join(repo, "run.sh")]);
  assert.notEqual(candidateId(manifestFromWorkingTree(repo, spec)), before, "exec-bit change must change the candidate");
  // A regular file whose bytes equal a symlink's canonical form no longer collides with the symlink.
  const r2 = mkdtempSync(join(tmpdir(), "cand-type-"));
  fixtures.push(r2);
  sh(r2, "init", "-q", "-b", "main");
  put(r2, "app.txt", "a\n");
  symlinkSync("app.txt", join(r2, "entry.txt"));
  const asLink = candidateId(manifestFromWorkingTree(r2, spec));
  unlinkSync(join(r2, "entry.txt"));
  put(r2, "entry.txt", "symlink:app.txt");
  assert.notEqual(candidateId(manifestFromWorkingTree(r2, spec)), asLink);
});
