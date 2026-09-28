// Independent QA negative tests for the DG0 gate validator (acceptance A24 enforced advancement, A25 candidate integrity).
// Author: qa-verifier, task T-DG0-REV-QA-R1. Built independently of tools/gates/tests/validator.test.mjs:
// every case uses its own disposable git fixture in the OS temp dir and removes it afterwards.
// Run: node --test <this file>   (optional QA_REPO_ROOT=<repo> selects the tooling under test)
// Intended for promotion into tests/qa/dg0/ as regression tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, unlinkSync } from "node:fs";
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

const NOW = "2026-09-28T13:00:00Z";
const REVIEWERS = ["domain-reviewer", "code-security-reviewer", "qa-verifier"];
const ALL = [...REVIEWERS, "release-auditor"];
let uuidSeq = 0;
const uuid = () => {
  uuidSeq += 1;
  const h = uuidSeq.toString(16).padStart(12, "0");
  return `aaaaaaaa-bbbb-4ccc-8ddd-${h}`;
};

const git = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
const write = (repo, rel, v) => {
  mkdirSync(dirname(join(repo, rel)), { recursive: true });
  writeFileSync(join(repo, rel), typeof v === "string" ? v : JSON.stringify(v, null, 2));
};
const readJ = (repo, rel) => JSON.parse(readFileSync(join(repo, rel), "utf8"));
const mutate = (repo, rel, fn) => {
  const d = readJ(repo, rel);
  fn(d);
  write(repo, rel, d);
};
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
const DLV = { req_id: "REQ-DLV-001", class: "ENGINEERING", source_ref: "M0001", acceptance: `${ACC_ALL} gates`, increments: "P0", final_gate: "DG0", status: "IMPLEMENTED", evidence: "docs/delivery/test-evidence/DG0/run.log" };

function writeRegister(repo, rows) {
  write(repo, "docs/delivery/requirements.csv", [REGISTER_COLUMNS.join(","), ...rows].join("\n") + "\n");
}

function newRun(repo, role, extra = {}) {
  const run_id = `DG0-QA-${role}-${uuidSeq + 1}`;
  const ref = { kind: "claude-code-cli-session", run_id, session_id: uuid() };
  write(repo, `docs/delivery/runs/DG0/${run_id}/meta.json`, { run_id, role, stage: "DG0", invocation_reference: ref, exit_code: 0, is_error: false, ...extra });
  return ref;
}

/** A disposable repository whose DG0 gate validates cleanly. */
function fixture() {
  const repo = mkdtempSync(join(tmpdir(), "qa-dg0-"));
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "qa@example.invalid");
  git(repo, "config", "user.name", "qa");
  write(repo, "docs/source/playbook.blocks.json", [{ id: "B0001" }, { id: "B0002" }, { id: "B0003" }]);
  write(repo, "docs/source/master-prompt.blocks.json", [{ id: "M0001" }, { id: "M0002" }]);
  writeRegister(repo, [row(), row(DLV)]);
  write(repo, "docs/analysis/source-coverage.csv", "block_id,disposition,req_ids,rationale\nB0001,REQUIREMENT,REQ-PB-001,\nB0002,CONTEXT,,intro\nB0003,NON-REQUIREMENT,,toc\n");
  write(repo, "docs/analysis/master-prompt-coverage.csv", "block_id,disposition,req_ids,rationale\nM0001,REQUIREMENT,REQ-DLV-001,\nM0002,CONTEXT,,heading\n");
  write(repo, "app/main.txt", "v1\n");
  write(repo, "app/other.txt", "other\n");
  const stages = {
    schema_version: 1,
    stages: STAGE_ORDER.map((id, i) => ({
      id, stage: `P${i}`, name: `S${i}`, state: "PLANNED", depends_on: i ? [STAGE_ORDER[i - 1]] : [],
      implementation_owners: ["transformation-analyst", "delivery-orchestrator"], candidate_spec: { include: ["**"], exclude: [] },
      candidate: { candidate_id: null, source_commit: null, frozen_at: null, manifest_path: null },
      review_rounds: [], gate_record: `docs/delivery/gates/${id}.json`, history: [{ state: "PLANNED", at: NOW }],
    })),
  };
  const s0 = stages.stages[0];
  for (const st of ["BUILDING", "REVIEWING", "VERIFYING"]) s0.history.push({ state: st, at: NOW });
  s0.state = "VERIFYING";
  write(repo, "docs/delivery/stages.json", stages);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "freeze");
  const commit = git(repo, "rev-parse", "HEAD");
  const entries = manifestFromRef(repo, commit, s0.candidate_spec);
  const cid = candidateId(entries);
  write(repo, "docs/delivery/candidates/DG0.manifest.json", { stage_id: "DG0", candidate_id: cid, source_commit: commit, frozen_at: NOW, spec: s0.candidate_spec, entries });
  s0.candidate = { candidate_id: cid, source_commit: commit, frozen_at: NOW, manifest_path: "docs/delivery/candidates/DG0.manifest.json" };
  write(repo, "docs/delivery/stages.json", stages);
  write(repo, "docs/delivery/test-evidence/DG0/run.log", "ok\n");
  write(repo, "docs/delivery/assignments/DG0/a.md", "assignment\n");
  const rec = {};
  const refs = {};
  for (const role of ALL) {
    refs[role] = newRun(repo, role);
    rec[role] = `docs/delivery/reviews/DG0/round-1/${role}.json`;
    write(repo, rec[role], {
      schema_version: 1, stage_id: "DG0", round: 1, candidate_id: cid, source_commit: commit, reviewer_role: role,
      invocation_reference: refs[role], implementation_author: ["transformation-analyst", "delivery-orchestrator"],
      independence_declaration: { reviewer_authored_reviewed_scope: false, statement: "no authorship in the reviewed scope" },
      assignment: "docs/delivery/assignments/DG0/a.md", requirements_checked: ["REQ-DLV-001"],
      checks_run: [{ id: "K1", procedure: "run it", command: "x", environment: "node", expected: "ok", actual: "ok", exit_status: 0, result: "PASS" }],
      findings: [], verdict: "PASS", evidence_paths: ["docs/delivery/test-evidence/DG0/run.log"], reviewed_at: NOW,
    });
  }
  write(repo, "docs/delivery/findings.json", { schema_version: 1, findings: [] });
  write(repo, "docs/delivery/gates/DG0.json", {
    schema_version: 1, stage_id: "DG0", decision: "APPROVED", candidate_id: cid, source_commit: commit,
    manifest_path: "docs/delivery/candidates/DG0.manifest.json", previous_gate: null,
    reviews: { "domain-reviewer": rec["domain-reviewer"], "code-security-reviewer": rec["code-security-reviewer"], "qa-verifier": rec["qa-verifier"] },
    release_audit: rec["release-auditor"], requirements: { final_gate_ids: ["REQ-DLV-001"] },
    tests: [{ name: "t", command: "c", result: "PASS", evidence: ["docs/delivery/test-evidence/DG0/run.log"] }],
    blocking_conditions: [], accepted_observations: [], decided_at: NOW, decided_by: "release-auditor",
    invocation_reference: refs["release-auditor"],
  });
  return { repo, cid, commit, rec, refs };
}

function finding(over) {
  return {
    id: "F-DG0-201", stage_id: "DG0", requirement: "REQ-DLV-001", severity: "High", mandatory_violation: false,
    title: "probe finding", reproduction: "build fixture and run validator", expected: "gate rejected", actual: "gate accepted", evidence: [], reported_by: "qa-verifier",
    reported_in: "docs/delivery/reviews/DG0/round-1/qa-verifier.json", owner: "delivery-orchestrator",
    status: "OPEN", fix_revision: null, verification: null, acceptance: null, history: [{ at: NOW, status: "OPEN" }], ...over,
  };
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
const regErrors = (repo) => {
  const e = [];
  checkRegister(repo, "DG0", e);
  return e;
};

test("control: the independent fixture is accepted (current mode and CLI exit 0)", () => withFixture(({ repo }) => {
  assert.deepEqual(validateGate(repo, "DG0"), []);
  const r = spawnSync(process.execPath, [VALIDATE_CLI, "--stage", "DG0"], { env: { ...process.env, GATE_REPO_ROOT: repo } });
  assert.equal(r.status, 0, r.stderr.toString());
}));

// ---------- missing reviewer ----------
test("QA-N01 missing reviewer: gate points at a review file that does not exist; CLI exits non-zero", () => withFixture(({ repo, rec }) => {
  unlinkSync(join(repo, rec["qa-verifier"]));
  rejects(validateGate(repo, "DG0"), /qa-verifier.*file not found/);
  const r = spawnSync(process.execPath, [VALIDATE_CLI, "--stage", "DG0"], { env: { ...process.env, GATE_REPO_ROOT: repo } });
  assert.equal(r.status, 1);
  assert.match(r.stderr.toString(), /FAIL gate DG0/);
}));

test("QA-N02 missing reviewer: qa-verifier slot filled with the domain-reviewer's record (role substitution)", () => withFixture(({ repo, rec }) => {
  mutate(repo, "docs/delivery/gates/DG0.json", (g) => (g.reviews["qa-verifier"] = rec["domain-reviewer"]));
  const errors = validateGate(repo, "DG0");
  rejects(errors, /reviewer_role domain-reviewer != qa-verifier/);
  rejects(errors, /share invocation/);
}));

test("QA-N03 missing reviewer: the release audit is absent", () => withFixture(({ repo, rec }) => {
  unlinkSync(join(repo, rec["release-auditor"]));
  rejects(validateGate(repo, "DG0"), /release-auditor.*file not found/);
}));

// ---------- authorship ----------
test("QA-N04 authorship: the release-auditor listed as an implementation author is rejected", () => withFixture(({ repo, rec }) => {
  mutate(repo, rec["release-auditor"], (r) => r.implementation_author.push("release-auditor"));
  rejects(validateGate(repo, "DG0"), /release-auditor.*listed as an implementation author/);
}));

// ---------- shared invocation ----------
test("QA-N05 shared invocation: a reviewer and the auditor cite the same session", () => withFixture(({ repo, rec, refs }) => {
  mutate(repo, rec["release-auditor"], (r) => (r.invocation_reference = refs["code-security-reviewer"]));
  mutate(repo, "docs/delivery/gates/DG0.json", (g) => (g.invocation_reference = refs["code-security-reviewer"]));
  const errors = validateGate(repo, "DG0");
  rejects(errors, /share invocation/);
  rejects(errors, /was run as 'code-security-reviewer', not 'release-auditor'/);
}));

test("QA-N06 shared invocation: two run records with different run_ids but one session_id", () => withFixture(({ repo, rec, refs }) => {
  const clone = { ...refs["qa-verifier"], run_id: "DG0-QA-cloned-run" };
  write(repo, "docs/delivery/runs/DG0/DG0-QA-cloned-run/meta.json", { run_id: clone.run_id, role: "domain-reviewer", invocation_reference: clone, exit_code: 0, is_error: false });
  mutate(repo, rec["domain-reviewer"], (r) => (r.invocation_reference = clone));
  rejects(validateGate(repo, "DG0"), /share invocation/);
}));

test("QA-N07 invocation: a run that exited with an error cannot back a review", () => withFixture(({ repo, refs }) => {
  mutate(repo, `docs/delivery/runs/DG0/${refs["domain-reviewer"].run_id}/meta.json`, (m) => (m.exit_code = 1));
  rejects(validateGate(repo, "DG0"), /did not complete successfully/);
}));

// ---------- failed / blocked checks ----------
test("QA-N08 failed check: a FAIL check result and a BLOCKED verdict each fail the gate", () => withFixture(({ repo, rec }) => {
  mutate(repo, rec["code-security-reviewer"], (r) => r.checks_run.push({ ...r.checks_run[0], id: "K2", result: "FAIL", exit_status: 1 }));
  mutate(repo, rec["release-auditor"], (r) => (r.verdict = "BLOCKED"));
  const errors = validateGate(repo, "DG0");
  rejects(errors, /check K2 is FAIL/);
  rejects(errors, /release-auditor.*verdict is BLOCKED/);
}));

test("QA-N09 gate test evidence missing or BLOCKED fails the gate", () => withFixture(({ repo }) => {
  mutate(repo, "docs/delivery/gates/DG0.json", (g) => g.tests.push({ name: "e2e", command: "npx playwright", result: "BLOCKED", evidence: ["docs/delivery/test-evidence/DG0/nope.log"] }));
  const errors = validateGate(repo, "DG0");
  rejects(errors, /test 'e2e' is BLOCKED/);
  rejects(errors, /test evidence not found/);
}));

// ---------- unresolved High findings ----------
test("QA-N10 unresolved High finding (OPEN, not referenced by any review) still blocks the gate", () => withFixture(({ repo }) => {
  write(repo, "docs/delivery/findings.json", { schema_version: 1, findings: [finding({})] });
  rejects(validateGate(repo, "DG0"), /F-DG0-201 \(High\): unresolved \(OPEN\)/);
}));

test("QA-N11 a High finding cannot be parked as ACCEPTED_OBSERVATION", () => withFixture(({ repo }) => {
  write(repo, "docs/delivery/findings.json", { schema_version: 1, findings: [finding({ status: "ACCEPTED_OBSERVATION", acceptance: { rationale: "defer to a later stage", owner: "delivery-orchestrator", accepted_by: ["qa-verifier", "release-auditor"] } })] });
  mutate(repo, "docs/delivery/gates/DG0.json", (g) => (g.accepted_observations = ["F-DG0-201"]));
  rejects(validateGate(repo, "DG0"), /only Low, non-mandatory/);
}));

test("QA-N12 a High finding CLOSED_VERIFIED without verification, and one referenced by a review but missing from findings.json", () => withFixture(({ repo, rec }) => {
  write(repo, "docs/delivery/findings.json", { schema_version: 1, findings: [finding({ status: "CLOSED_VERIFIED", fix_revision: "a".repeat(40) })] });
  mutate(repo, rec["qa-verifier"], (r) => (r.findings = ["F-DG0-299"]));
  const errors = validateGate(repo, "DG0");
  rejects(errors, /CLOSED_VERIFIED without independent verification/);
  rejects(errors, /finding F-DG0-299 not in findings.json/);
}));

// ---------- incomplete requirement ----------
test("QA-N13 incomplete requirement: a DG0 row that is BLOCKED (with notes) fails", () => withFixture(({ repo }) => {
  writeRegister(repo, [row(), row({ ...DLV, status: "BLOCKED", notes: "waiting on tool" })]);
  rejects(validateGate(repo, "DG0"), /REQ-DLV-001: final gate DG0 requires IMPLEMENTED at DG0 \(is BLOCKED\)/);
}));

test("QA-N14 incomplete requirement: DG0 row IMPLEMENTED with no evidence, or a non-existent evidence path", () => withFixture(({ repo }) => {
  writeRegister(repo, [row(), row({ ...DLV, evidence: "" })]);
  rejects(regErrors(repo), /IMPLEMENTED for DG0 without evidence/);
  writeRegister(repo, [row(), row({ ...DLV, evidence: "tools/gates/does-not-exist.mjs" })]);
  rejects(regErrors(repo), /evidence path not found/);
}));

test("QA-N15 incomplete requirement: a DG0 row missing from the gate's final_gate_ids, and one unchecked by domain/security", () => withFixture(({ repo, rec }) => {
  writeRegister(repo, [row(), row(DLV), row({ ...DLV, req_id: "REQ-DLV-002" })]);
  write(repo, "docs/analysis/master-prompt-coverage.csv", "block_id,disposition,req_ids,rationale\nM0001,REQUIREMENT,REQ-DLV-001;REQ-DLV-002,\nM0002,CONTEXT,,heading\n");
  mutate(repo, rec["qa-verifier"], (r) => r.requirements_checked.push("REQ-DLV-002"));
  const errors = validateGate(repo, "DG0");
  rejects(errors, /final_gate_ids does not match the register/);
  rejects(errors, /REQ-DLV-002: completes at DG0 but neither domain nor code-security reviewer checked it/);
}));

test("QA-N16 incomplete requirement: a later-gate row still PLANNED fails at DG0 (must be SPECIFIED)", () => withFixture(({ repo }) => {
  writeRegister(repo, [row({ status: "PLANNED" }), row(DLV)]);
  rejects(regErrors(repo), /REQ-PB-001: must be at least SPECIFIED/);
}));

// ---------- non-existent anchors / SOURCE without playbook block ----------
test("QA-N17 register rows citing non-existent or malformed anchors are rejected", () => withFixture(({ repo }) => {
  writeRegister(repo, [row({ source_ref: "B0001;B9999" }), row({ ...DLV, source_ref: "M0001;M0424" }), row({ req_id: "REQ-PB-002", source_ref: "B12" })]);
  const errors = regErrors(repo);
  rejects(errors, /REQ-PB-001: cites unknown playbook block B9999/);
  rejects(errors, /REQ-DLV-001: cites unknown master-prompt block M0424/);
  rejects(errors, /REQ-PB-002: source_ref entry 'B12' is not a block anchor/);
}));

test("QA-N18 a SOURCE row citing only master-prompt blocks, and a REQ-PB id on a USER row, are rejected", () => withFixture(({ repo }) => {
  writeRegister(repo, [row({ source_ref: "M0001" }), row(DLV), row({ req_id: "REQ-PB-003", class: "USER", source_ref: "B0001" })]);
  const errors = regErrors(repo);
  rejects(errors, /REQ-PB-001: SOURCE requirement cites no playbook block/);
  rejects(errors, /REQ-PB-003: REQ-PB ids are reserved for SOURCE/);
}));

// ---------- coverage matrices ----------
test("QA-N19 coverage: master-prompt matrix missing a block; mapping to a requirement that does not cite the block", () => withFixture(({ repo }) => {
  write(repo, "docs/analysis/master-prompt-coverage.csv", "block_id,disposition,req_ids,rationale\nM0001,REQUIREMENT,REQ-DLV-001,\n");
  write(repo, "docs/analysis/source-coverage.csv", "block_id,disposition,req_ids,rationale\nB0001,REQUIREMENT,REQ-PB-001,\nB0002,REQUIREMENT,REQ-PB-001,\nB0003,NON-REQUIREMENT,,toc\n");
  const errors = regErrors(repo);
  rejects(errors, /master-prompt-coverage.csv: block M0002 has no disposition/);
  rejects(errors, /B0002 maps to REQ-PB-001, but REQ-PB-001 does not cite B0002/);
}));

test("QA-N20 coverage: unknown requirement, unknown block, duplicate row, CONTEXT without rationale, bad disposition", () => withFixture(({ repo }) => {
  write(repo, "docs/analysis/source-coverage.csv", "block_id,disposition,req_ids,rationale\nB0001,REQUIREMENT,REQ-PB-777,\nB0001,REQUIREMENT,REQ-PB-001,\nB0002,CONTEXT,,\nB0003,MAYBE,,x\nB0999,CONTEXT,,x\n");
  const errors = regErrors(repo);
  rejects(errors, /references unknown requirement REQ-PB-777/);
  rejects(errors, /duplicate row for B0001/);
  rejects(errors, /B0002 is CONTEXT without rationale/);
  rejects(errors, /B0003 invalid disposition 'MAYBE'/);
  rejects(errors, /unknown block B0999/);
}));

// ---------- candidate integrity ----------
test("QA-N21 change after freeze: an added untracked file and a deleted file are both detected", () => withFixture(({ repo }) => {
  write(repo, "app/new-feature.txt", "sneaked in\n");
  rejects(validateGate(repo, "DG0"), /candidate: current content hashes to .*\+app\/new-feature.txt/);
  unlinkSync(join(repo, "app/new-feature.txt"));
  unlinkSync(join(repo, "app/other.txt"));
  rejects(validateGate(repo, "DG0"), /candidate: current .*-app\/other.txt/);
}));

test("QA-N22 change after freeze: a candidate edited and committed after freeze fails --stage; CLI exits 1", () => withFixture(({ repo }) => {
  write(repo, "app/main.txt", "v2\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "post-freeze change");
  const r = spawnSync(process.execPath, [VALIDATE_CLI, "--stage", "DG0"], { env: { ...process.env, GATE_REPO_ROOT: repo } });
  assert.equal(r.status, 1);
  assert.match(r.stderr.toString(), /~app\/main.txt/);
}));

test("QA-N23 tampered manifest that is internally consistent (entries, id, gate, stages, reviews all rewritten) is still caught by recompute", () => withFixture(({ repo, rec }) => {
  const m = readJ(repo, "docs/delivery/candidates/DG0.manifest.json");
  m.entries = m.entries.filter((e) => e.path !== "app/other.txt"); // hide a file from the approval
  const forged = candidateId(m.entries);
  m.candidate_id = forged;
  write(repo, "docs/delivery/candidates/DG0.manifest.json", m);
  mutate(repo, "docs/delivery/gates/DG0.json", (g) => (g.candidate_id = forged));
  mutate(repo, "docs/delivery/stages.json", (d) => (d.stages[0].candidate.candidate_id = forged));
  for (const role of ALL) mutate(repo, rec[role], (r) => (r.candidate_id = forged));
  const errors = validateGate(repo, "DG0");
  assert.ok(!errors.some((e) => /tampered/.test(e)), "forgery is self-consistent by construction");
  rejects(errors, /candidate: current content hashes to .*approval covers sha256:/);
}));

test("QA-N24 tampered manifest: a manifest whose stage_id or source_commit disagree with the gate is rejected", () => withFixture(({ repo }) => {
  mutate(repo, "docs/delivery/candidates/DG0.manifest.json", (m) => {
    m.stage_id = "DG1";
    m.source_commit = "b".repeat(40);
  });
  const errors = validateGate(repo, "DG0");
  rejects(errors, /stage_id DG1 != DG0/);
  rejects(errors, /source_commit differs from the gate record/);
}));

// ---------- review metadata does not alter the candidate ----------
test("QA-N25 metadata writes in every excluded area leave the candidate ID unchanged (and the gate valid)", () => withFixture(({ repo, cid }) => {
  const spec = readJ(repo, "docs/delivery/candidates/DG0.manifest.json").spec;
  write(repo, "docs/delivery/reviews/DG0/round-2/qa-verifier.md", "narrative\n");
  write(repo, "docs/delivery/runs/DG0/DG0-late/meta.json", { x: 1 });
  write(repo, "docs/delivery/handbacks/DG0/h.md", "h\n");
  write(repo, "docs/delivery/assignments/DG0/round-2/x.md", "x\n");
  write(repo, "docs/delivery/candidates/DG0.notes.txt", "n\n");
  write(repo, "docs/delivery/test-evidence/DG0/qa/extra.log", "log\n");
  write(repo, "docs/delivery/progress.md", "checkpoint\n");
  mutate(repo, "docs/delivery/stages.json", (d) => (d.stages[0].name = "renamed"));
  mutate(repo, "docs/delivery/findings.json", (d) => d.findings.push(finding({ id: "F-DG0-250", stage_id: "DG1", severity: "Low" })));
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "metadata only");
  assert.equal(candidateId(manifestFromWorkingTree(repo, spec)), cid);
  assert.equal(candidateId(manifestFromRef(repo, "HEAD", spec)), cid);
  assert.deepEqual(validateGate(repo, "DG0"), []);
}));

test("QA-N26 a stage spec cannot re-include delivery metadata into the candidate", () => withFixture(({ repo }) => {
  write(repo, "docs/delivery/reviews/DG0/round-1/extra.json", "{}");
  const ids = cand.selectPaths(["docs/delivery/reviews/DG0/round-1/extra.json", "docs/delivery/stages.json", "docs/delivery/findings.json", "app/main.txt"], { include: ["docs/delivery/**", "app/**"], exclude: [] });
  assert.deepEqual(ids, ["app/main.txt"]);
}));

// ---------- provenance: the invocation must be the one that produced the review ----------
test("QA-N27 provenance: a review citing a different task's run (e.g. the load check) is rejected", () => withFixture(({ repo, rec }) => {
  // A genuine, successful qa-verifier run - but for another task/assignment, started before the candidate froze.
  const loadRef = newRun(repo, "qa-verifier", { task: "T-DG0-LOAD", assignment: "docs/delivery/assignments/DG0/T-DG0-LOAD.md", started_at: "2026-09-28T11:00:00Z" });
  write(repo, "docs/delivery/assignments/DG0/T-DG0-LOAD.md", "load check\n");
  mutate(repo, rec["qa-verifier"], (r) => (r.invocation_reference = loadRef));
  rejects(validateGate(repo, "DG0"), /qa-verifier.*(assignment|task|before the candidate|frozen)/i);
}));

test("QA-N28 incomplete requirement: a DG0 row whose evidence is a bare, non-existent file name is rejected", () => withFixture(({ repo }) => {
  writeRegister(repo, [row(), row({ ...DLV, evidence: "NO-SUCH-EVIDENCE.md" })]);
  rejects(regErrors(repo), /evidence path not found: NO-SUCH-EVIDENCE.md/);
}));
