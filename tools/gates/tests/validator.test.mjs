// Validator self-tests (acceptance A24 enforced advancement, A25 candidate integrity).
// Run: node --test tools/gates/tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { candidateId, manifestFromRef } from "../lib/candidate.mjs";
import { validateGate, validatePipeline, reconcile } from "../lib/rules.mjs";
import { REGISTER_COLUMNS, STAGE_ORDER } from "../lib/rules.mjs";

const T0 = "2026-09-28T12:00:00Z";
const ROLES = ["domain-reviewer", "code-security-reviewer", "qa-verifier", "release-auditor"];
const SIDS = {
  "domain-reviewer": "11111111-1111-4111-8111-111111111111",
  "code-security-reviewer": "22222222-2222-4222-8222-222222222222",
  "qa-verifier": "33333333-3333-4333-8333-333333333333",
  "release-auditor": "44444444-4444-4444-8444-444444444444",
  "verifier-2": "55555555-5555-4555-8555-555555555555",
};

function sh(repo, ...args) {
  return execFileSync("git", ["-C", repo, ...args], { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}
function put(repo, rel, content) {
  mkdirSync(dirname(join(repo, rel)), { recursive: true });
  writeFileSync(join(repo, rel), typeof content === "string" ? content : JSON.stringify(content, null, 2));
}
function get(repo, rel) {
  return JSON.parse(readFileSync(join(repo, rel), "utf8"));
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
      implementation_owners: ["delivery-orchestrator"], candidate_spec: { include: ["**"], exclude: [] },
      candidate: { candidate_id: null, source_commit: null, frozen_at: null, manifest_path: null },
      review_rounds: [], gate_record: `docs/delivery/gates/${id}.json`,
      history: [{ state: "PLANNED", at: T0 }],
    })),
  };
}

function runMeta(repo, role, key = role) {
  const run_id = `DG0-T-${key}`;
  put(repo, `docs/delivery/runs/DG0/${run_id}/meta.json`, {
    run_id, role, invocation_reference: { kind: "claude-code-cli-session", run_id, session_id: SIDS[key] },
    exit_code: 0, is_error: false,
  });
  return { kind: "claude-code-cli-session", run_id, session_id: SIDS[key] };
}

/** Builds a repository whose DG0 gate is fully valid. */
function buildValidRepo() {
  const repo = mkdtempSync(join(tmpdir(), "gate-fixture-"));
  sh(repo, "init", "-q", "-b", "main");
  sh(repo, "config", "user.email", "t@example.com");
  sh(repo, "config", "user.name", "t");
  put(repo, "docs/source/playbook.blocks.json", [{ id: "B0001" }, { id: "B0002" }]);
  put(repo, "docs/source/master-prompt.blocks.json", [{ id: "M0001" }]);
  const all = Array.from({ length: 28 }, (_, i) => `A${String(i + 1).padStart(2, "0")}`).join(" ");
  put(repo, "docs/delivery/requirements.csv", [
    REGISTER_COLUMNS.join(","),
    reqRow({}),
    reqRow({ req_id: "REQ-DLV-001", class: "ENGINEERING", source_ref: "M0001", acceptance: `${all} validator`, increments: "P0", final_gate: "DG0", status: "IMPLEMENTED", evidence: "docs/delivery/test-evidence/DG0/validator.txt" }),
  ].join("\n") + "\n");
  put(repo, "docs/analysis/source-coverage.csv", "block_id,disposition,req_ids,rationale\nB0001,REQUIREMENT,REQ-PB-001,\nB0002,NON-REQUIREMENT,,cover text\n");
  put(repo, "docs/analysis/master-prompt-coverage.csv", "block_id,disposition,req_ids,rationale\nM0001,REQUIREMENT,REQ-DLV-001,\n");
  put(repo, "src/app.txt", "deliverable v1\n");
  const doc = stagesDoc();
  doc.stages[0].implementation_owners = ["transformation-analyst", "delivery-orchestrator"];
  doc.stages[0].history.push({ state: "BUILDING", at: T0 }, { state: "REVIEWING", at: T0 }, { state: "VERIFYING", at: T0 });
  doc.stages[0].state = "VERIFYING";
  put(repo, "docs/delivery/stages.json", doc);
  sh(repo, "add", "-A");
  sh(repo, "commit", "-q", "-m", "candidate");
  const head = sh(repo, "rev-parse", "HEAD");
  const spec = doc.stages[0].candidate_spec;
  const entries = manifestFromRef(repo, head, spec);
  const cid = candidateId(entries);
  put(repo, "docs/delivery/candidates/DG0.manifest.json", { stage_id: "DG0", candidate_id: cid, source_commit: head, frozen_at: T0, spec, entries });
  doc.stages[0].candidate = { candidate_id: cid, source_commit: head, frozen_at: T0, manifest_path: "docs/delivery/candidates/DG0.manifest.json" };
  put(repo, "docs/delivery/stages.json", doc);
  put(repo, "docs/delivery/test-evidence/DG0/validator.txt", "PASS\n");
  put(repo, "docs/delivery/assignments/DG0/review.md", "assignment\n");
  const records = {};
  for (const role of ROLES) {
    const rel = `docs/delivery/reviews/DG0/round-1/${role}.json`;
    put(repo, rel, {
      schema_version: 1, stage_id: "DG0", round: 1, candidate_id: cid, source_commit: head, reviewer_role: role,
      invocation_reference: runMeta(repo, role), implementation_author: ["transformation-analyst", "delivery-orchestrator"],
      independence_declaration: { reviewer_authored_reviewed_scope: false, statement: "I authored nothing in scope." },
      assignment: "docs/delivery/assignments/DG0/review.md", requirements_checked: ["REQ-DLV-001"],
      checks_run: [{ id: "C1", procedure: "run validator", command: "node v", environment: "node 22", expected: "PASS", actual: "PASS", exit_status: 0, result: "PASS" }],
      findings: role === "code-security-reviewer" ? ["F-DG0-001"] : [], verdict: "PASS",
      evidence_paths: ["docs/delivery/test-evidence/DG0/validator.txt"], reviewed_at: T0,
    });
    records[role] = rel;
  }
  put(repo, "docs/delivery/findings.json", {
    schema_version: 1,
    findings: [{
      id: "F-DG0-001", stage_id: "DG0", requirement: "REQ-DLV-001", severity: "High", mandatory_violation: true,
      title: "validator accepted a missing reviewer", reproduction: "delete a review", expected: "fail", actual: "pass",
      evidence: [], reported_by: "code-security-reviewer", reported_in: records["code-security-reviewer"],
      owner: "delivery-orchestrator", status: "CLOSED_VERIFIED", fix_revision: head,
      verification: { by_role: "code-security-reviewer", invocation_reference: runMeta(repo, "code-security-reviewer", "verifier-2"), at: T0, result: "PASS", evidence: [] },
      acceptance: null, history: [{ at: T0, status: "OPEN" }, { at: T0, status: "CLOSED_VERIFIED" }],
    }],
  });
  // verifier-2 run was executed as code-security-reviewer
  const vmeta = get(repo, "docs/delivery/runs/DG0/DG0-T-verifier-2/meta.json");
  vmeta.role = "code-security-reviewer";
  put(repo, "docs/delivery/runs/DG0/DG0-T-verifier-2/meta.json", vmeta);
  put(repo, "docs/delivery/gates/DG0.json", {
    schema_version: 1, stage_id: "DG0", decision: "APPROVED", candidate_id: cid, source_commit: head,
    manifest_path: "docs/delivery/candidates/DG0.manifest.json", previous_gate: null,
    reviews: { "domain-reviewer": records["domain-reviewer"], "code-security-reviewer": records["code-security-reviewer"], "qa-verifier": records["qa-verifier"] },
    release_audit: records["release-auditor"], requirements: { final_gate_ids: ["REQ-DLV-001"] },
    tests: [{ name: "validator self-test", command: "node --test", result: "PASS", evidence: ["docs/delivery/test-evidence/DG0/validator.txt"] }],
    blocking_conditions: [], accepted_observations: [], decided_at: T0, decided_by: "release-auditor",
    invocation_reference: get(repo, records["release-auditor"]).invocation_reference,
  });
  return { repo, cid, head, records };
}

function edit(repo, rel, fn) {
  const d = get(repo, rel);
  fn(d);
  put(repo, rel, d);
}
function expectError(errors, pattern) {
  assert.ok(errors.some((e) => pattern.test(e)), `expected an error matching ${pattern}, got:\n${errors.join("\n")}`);
}

test("a fully evidenced DG0 gate passes in current and historical mode", () => {
  const { repo } = buildValidRepo();
  assert.deepEqual(validateGate(repo, "DG0"), []);
  edit(repo, "docs/delivery/stages.json", (d) => {
    d.stages[0].history.push({ state: "APPROVED", at: T0 });
    d.stages[0].state = "APPROVED";
  });
  assert.deepEqual(validateGate(repo, "DG0", { mode: "historical" }), []);
  rmSync(repo, { recursive: true, force: true });
});

test("A24: a missing specialist reviewer fails the gate", () => {
  const { repo } = buildValidRepo();
  edit(repo, "docs/delivery/gates/DG0.json", (g) => delete g.reviews["qa-verifier"]);
  expectError(validateGate(repo, "DG0"), /qa-verifier/);
});

test("A23: a reviewer who authored the scope, or who is an owner, is rejected", () => {
  const { repo, records } = buildValidRepo();
  edit(repo, records["domain-reviewer"], (r) => r.implementation_author.push("domain-reviewer"));
  expectError(validateGate(repo, "DG0"), /listed as an implementation author/);
  const b = buildValidRepo();
  edit(b.repo, "docs/delivery/stages.json", (d) => d.stages[0].implementation_owners.push("qa-verifier"));
  expectError(validateGate(b.repo, "DG0"), /implementation owner/);
  const c = buildValidRepo();
  edit(c.repo, c.records["qa-verifier"], (r) => (r.independence_declaration.reviewer_authored_reviewed_scope = true));
  expectError(validateGate(c.repo, "DG0"), /declares authorship/);
});

test("A23: reviewers sharing one invocation are not independent", () => {
  const { repo, records } = buildValidRepo();
  const shared = get(repo, records["domain-reviewer"]).invocation_reference;
  edit(repo, records["qa-verifier"], (r) => (r.invocation_reference = shared));
  const errors = validateGate(repo, "DG0");
  expectError(errors, /share invocation/);
});

test("A24: a fabricated invocation reference (no recorded run) is rejected", () => {
  const { repo, records } = buildValidRepo();
  edit(repo, records["qa-verifier"], (r) => (r.invocation_reference = { kind: "claude-code-cli-session", run_id: "DG0-made-up", session_id: "99999999-9999-4999-8999-999999999999" }));
  expectError(validateGate(repo, "DG0"), /file not found/);
  const b = buildValidRepo();
  edit(b.repo, "docs/delivery/runs/DG0/DG0-T-qa-verifier/meta.json", (m) => (m.role = "backend-workflow-engineer"));
  expectError(validateGate(b.repo, "DG0"), /was run as 'backend-workflow-engineer'/);
});

test("A24: failed or BLOCKED checks and non-PASS verdicts fail the gate", () => {
  const { repo, records } = buildValidRepo();
  edit(repo, records["qa-verifier"], (r) => (r.checks_run[0].result = "BLOCKED"));
  expectError(validateGate(repo, "DG0"), /check C1 is BLOCKED/);
  const b = buildValidRepo();
  edit(b.repo, b.records["domain-reviewer"], (r) => (r.verdict = "FAIL"));
  expectError(validateGate(b.repo, "DG0"), /verdict is FAIL/);
  const c = buildValidRepo();
  edit(c.repo, "docs/delivery/gates/DG0.json", (g) => (g.tests[0].result = "FAIL"));
  expectError(validateGate(c.repo, "DG0"), /test 'validator self-test' is FAIL/);
});

test("A24: unresolved blocking findings fail the gate; owners cannot verify their own fix", () => {
  const { repo } = buildValidRepo();
  edit(repo, "docs/delivery/findings.json", (d) => (d.findings[0].status = "FIXED_PENDING_VERIFICATION"));
  expectError(validateGate(repo, "DG0"), /unresolved/);
  const b = buildValidRepo();
  edit(b.repo, "docs/delivery/findings.json", (d) => (d.findings[0].owner = "code-security-reviewer"));
  expectError(validateGate(b.repo, "DG0"), /verified by its own owner/);
  const c = buildValidRepo();
  edit(c.repo, "docs/delivery/findings.json", (d) => {
    d.findings[0].severity = "Medium";
    d.findings[0].mandatory_violation = false;
    d.findings[0].status = "ACCEPTED_OBSERVATION";
    d.findings[0].acceptance = { rationale: "cosmetic only, tracked", owner: "delivery-orchestrator", accepted_by: ["qa-verifier", "release-auditor"] };
  });
  expectError(validateGate(c.repo, "DG0"), /only Low, non-mandatory/);
});

test("A24: incomplete requirements and coverage gaps fail the gate", () => {
  const { repo } = buildValidRepo();
  const csv = readFileSync(join(repo, "docs/delivery/requirements.csv"), "utf8").replace(",IMPLEMENTED,", ",SPECIFIED,");
  writeFileSync(join(repo, "docs/delivery/requirements.csv"), csv);
  sh(repo, "commit", "-qam", "x");
  expectError(validateGate(repo, "DG0"), /requires IMPLEMENTED/);
  const v = buildValidRepo();
  const bad = readFileSync(join(v.repo, "docs/delivery/requirements.csv"), "utf8").replace(",IMPLEMENTED,", ",VERIFIED,");
  writeFileSync(join(v.repo, "docs/delivery/requirements.csv"), bad);
  expectError(validateGate(v.repo, "DG0"), /invalid status 'VERIFIED'/);
  const q = buildValidRepo();
  edit(q.repo, q.records["qa-verifier"], (r) => (r.requirements_checked = []));
  expectError(validateGate(q.repo, "DG0"), /qa-verifier did not check it/);
  const b = buildValidRepo();
  put(b.repo, "docs/analysis/source-coverage.csv", "block_id,disposition,req_ids,rationale\nB0001,REQUIREMENT,REQ-PB-001,\n");
  expectError(validateGate(b.repo, "DG0"), /B0002 has no disposition/);
});

test("A25: a source change invalidates the approval; review metadata does not", () => {
  const { repo } = buildValidRepo();
  // Adding review/gate/evidence metadata keeps the candidate identical.
  put(repo, "docs/delivery/reviews/DG0/round-2/notes.md", "late note\n");
  put(repo, "docs/delivery/test-evidence/DG0/extra.log", "log\n");
  put(repo, "docs/delivery/progress.md", "checkpoint\n");
  assert.deepEqual(validateGate(repo, "DG0"), []);
  // Changing a deliverable breaks the match in current mode.
  put(repo, "src/app.txt", "deliverable v2\n");
  expectError(validateGate(repo, "DG0"), /hashes to .* approval covers/);
  // Historical verification against the recorded commit still holds.
  edit(repo, "docs/delivery/stages.json", (d) => {
    d.stages[0].history.push({ state: "APPROVED", at: T0 });
    d.stages[0].state = "APPROVED";
  });
  assert.deepEqual(validateGate(repo, "DG0", { mode: "historical" }), []);
  const rec = reconcile(repo);
  assert.ok(rec.report.join("\n").includes("all stages APPROVED") || rec.report.length > 0);
});

test("A25: a tampered manifest or a stale review candidate is detected", () => {
  const { repo, records } = buildValidRepo();
  edit(repo, "docs/delivery/candidates/DG0.manifest.json", (m) => (m.entries[0].sha256 = "0".repeat(64)));
  expectError(validateGate(repo, "DG0"), /tampered/);
  const b = buildValidRepo();
  edit(b.repo, b.records["qa-verifier"], (r) => (r.candidate_id = "sha256:" + "a".repeat(64)));
  expectError(validateGate(b.repo, "DG0"), /reviewed candidate/);
});

test("the gate record must be written by the audited release-auditor invocation", () => {
  const { repo, records } = buildValidRepo();
  edit(repo, "docs/delivery/gates/DG0.json", (g) => (g.invocation_reference = get(repo, records["qa-verifier"]).invocation_reference));
  expectError(validateGate(repo, "DG0"), /not written by the audited release-auditor/);
});

test("missing evidence files fail the gate", () => {
  const { repo, records } = buildValidRepo();
  edit(repo, records["domain-reviewer"], (r) => r.evidence_paths.push("docs/delivery/test-evidence/DG0/missing.png"));
  expectError(validateGate(repo, "DG0"), /evidence path not found/);
});

test("A24: the pipeline cannot advance past a gate that is not APPROVED", () => {
  const { repo } = buildValidRepo();
  edit(repo, "docs/delivery/stages.json", (d) => {
    d.stages[1].history.push({ state: "BUILDING", at: T0 });
    d.stages[1].state = "BUILDING";
  });
  expectError(validatePipeline(repo).errors, /DG1 is BUILDING while earlier gate DG0 is not APPROVED/);
  edit(repo, "docs/delivery/stages.json", (d) => {
    d.stages[0].history.push({ state: "APPROVED", at: T0 });
    d.stages[0].state = "APPROVED";
  });
  assert.deepEqual(validatePipeline(repo).errors, []);
  edit(repo, "docs/delivery/stages.json", (d) => {
    d.stages[2].history.push({ state: "BUILDING", at: T0 });
    d.stages[2].state = "BUILDING";
  });
  expectError(validatePipeline(repo).errors, /DG2 is BUILDING while earlier gate DG1/);
});

test("illegal stage transitions are rejected", () => {
  const { repo } = buildValidRepo();
  edit(repo, "docs/delivery/stages.json", (d) => {
    d.stages[1].history.push({ state: "APPROVED", at: T0 });
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
