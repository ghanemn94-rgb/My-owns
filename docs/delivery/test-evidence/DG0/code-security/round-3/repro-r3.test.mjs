// DG0 round-3 code-security reproduction (code-security-reviewer, T-DG0-REV-SEC-R3). NOT part of any candidate.
// Lines below the marker are copied verbatim from the candidate's tools/gates/tests/validator.test.mjs (commit 540b3c69,
// lines 14-201: helpers + buildValidRepo + approveAndCommit), with imports redirected to GATE_TOOLS (a disposable worktree).
// Convention: "BYPASS ..." tests PASS when the weakness is PRESENT; "FIXED ..." tests PASS when the weakness is ABSENT.
// Run: GATE_TOOLS=/tmp/dg0-sec-r3 node --test docs/delivery/test-evidence/DG0/code-security/round-3/repro-r3.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
const TOOLS = process.env.GATE_TOOLS; if (!TOOLS) throw new Error("set GATE_TOOLS");
const imp = (rel) => import(pathToFileURL(join(TOOLS, rel)).href);
const { candidateId, manifestFromRef, manifestFromWorkingTree } = await imp("tools/gates/lib/candidate.mjs");
const { validateGate, validatePipeline, reconcile, REGISTER_COLUMNS, STAGE_ORDER } = await imp("tools/gates/lib/rules.mjs");
// ---- marker: verbatim copy begins ----

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
// ---- verbatim copy ends; round-3 reproductions below ----
const commit = (repo, msg) => { sh(repo, "add", "-A"); sh(repo, "commit", "-qm", msg); };
const SIDE1 = "docs/delivery/reviews/DG0/round-1/code-security-reviewer.findings.json";
const REC1 = "docs/delivery/reviews/DG0/round-1/code-security-reviewer.json";
const VER2 = "docs/delivery/reviews/DG0/round-2/code-security-reviewer.verifications.json";

test("SANITY: the copied fixture is valid under the tools under test", () => {
  const { repo } = buildValidRepo();
  assert.deepEqual(validateGate(repo, "DG0"), []);
});

test("FIXED F-DG0-101 (round-2 N2): deleting a whole earlier round (record+sidecar+findings.json entry) is detected", () => {
  // stages.json still lists the round
  const a = buildValidRepo();
  rmSync(join(a.repo, "docs/delivery/reviews/DG0/round-1"), { recursive: true, force: true });
  edit(a.repo, "docs/delivery/findings.json", (d) => (d.findings = []));
  assert.notDeepEqual(validateGate(a.repo, "DG0"), []);
  // committed, then deleted with stages.json rewritten
  const b = buildValidRepo();
  commit(b.repo, "reviews");
  rmSync(join(b.repo, "docs/delivery/reviews/DG0/round-1"), { recursive: true, force: true });
  edit(b.repo, "docs/delivery/stages.json", (d) => (d.stages[0].review_rounds = d.stages[0].review_rounds.filter((r) => r.round !== 1)));
  edit(b.repo, "docs/delivery/findings.json", (d) => (d.findings = []));
  commit(b.repo, "hide round 1");
  expectError(validateGate(b.repo, "DG0"), /deleted from git history/);
});

test("FIXED F-DG0-102 (round-2 N1a): a verification bound to a pre-freeze LOAD run with another assignment is rejected", () => {
  const { repo } = buildValidRepo();
  put(repo, "docs/delivery/assignments/DG0/T-DG0-LOAD.md", "load check\n");
  const loadRef = makeRun(repo, "code-security-reviewer", { assignment: "docs/delivery/assignments/DG0/T-DG0-LOAD.md", task: "T-DG0-LOAD", startedAt: "2026-09-28T11:00:00Z" });
  // A round-3 record whose run is the LOAD run, but it (honestly) cites the round-3 assignment.
  const cid = get(repo, "docs/delivery/gates/DG0.json").candidate_id;
  const head = get(repo, "docs/delivery/gates/DG0.json").source_commit;
  put(repo, "docs/delivery/assignments/DG0/round-3/code-security-reviewer.md", "round 3\n");
  const r2 = get(repo, "docs/delivery/reviews/DG0/round-2/code-security-reviewer.json");
  put(repo, "docs/delivery/reviews/DG0/round-3/code-security-reviewer.json", { ...r2, round: 3, invocation_reference: loadRef, assignment: "docs/delivery/assignments/DG0/round-3/code-security-reviewer.md" });
  put(repo, "docs/delivery/reviews/DG0/round-3/code-security-reviewer.verifications.json", { verifications: [{ finding_id: "F-DG0-101", result: "PASS", status_after: "CLOSED_VERIFIED", note: "", evidence: [] }] });
  edit(repo, "docs/delivery/stages.json", (d) => d.stages[0].review_rounds.push({ round: 3, candidate_id: cid, frozen_at: "2026-09-28T12:00:00Z", source_commit: head, records: { "code-security-reviewer": "docs/delivery/reviews/DG0/round-3/code-security-reviewer.json" } }));
  edit(repo, "docs/delivery/findings.json", (d) => (d.findings[0].verification.invocation_reference = loadRef));
  const errs = validateGate(repo, "DG0");
  expectError(errs, /ran assignment docs\/delivery\/assignments\/DG0\/T-DG0-LOAD\.md/);
  expectError(errs, /before the candidate froze/);
});

test("BYPASS F-DG0-115a: EDITING (not deleting) a committed round-1 sidecar and record drops a High finding", () => {
  const { repo } = buildValidRepo();
  // Round 1 raised F-DG0-101 and the finding was never fixed: make it OPEN and remove round-2 verification.
  unlinkSync(join(repo, VER2));
  edit(repo, "docs/delivery/findings.json", (d) => { d.findings[0].status = "OPEN"; delete d.findings[0].verification; delete d.findings[0].fix_revision; });
  // Realistic sequencing: the gate record is not committed until the auditor approves at the very end.
  const gate = readFileSync(join(repo, "docs/delivery/gates/DG0.json"));
  unlinkSync(join(repo, "docs/delivery/gates/DG0.json"));
  commit(repo, "round 1 and 2 recorded; F-DG0-101 OPEN");
  put(repo, "docs/delivery/gates/DG0.json", gate);
  assert.notDeepEqual(validateGate(repo, "DG0"), [], "precondition: the OPEN High finding blocks the gate");
  // Attack: rewrite the reviewer-authored files in place (no deletion), drop the finding from findings.json.
  put(repo, SIDE1, { findings: [] });
  edit(repo, REC1, (r) => { r.findings = []; });
  edit(repo, "docs/delivery/findings.json", (d) => (d.findings = []));
  commit(repo, "tidy round 1");
  assert.deepEqual(validateGate(repo, "DG0"), [], "gate passes although a reviewer raised an unfixed High finding");
  approveAndCommit(repo);
  assert.deepEqual(validateGate(repo, "DG0", { mode: "historical" }), []);
  assert.deepEqual(validatePipeline(repo).errors, []);
});

test("BYPASS F-DG0-115b: flipping a reviewer's committed FAIL verification to PASS closes the finding", () => {
  const { repo } = buildValidRepo();
  // The reviewer really wrote FAIL in round 2; findings.json mirrors it; everything is committed.
  put(repo, VER2, { verifications: [{ finding_id: "F-DG0-101", result: "FAIL", status_after: "OPEN", note: "not fixed", evidence: [] }] });
  edit(repo, "docs/delivery/findings.json", (d) => { d.findings[0].status = "OPEN"; d.findings[0].verification.result = "FAIL"; });
  commit(repo, "round 2 recorded (FAIL verification)");
  assert.notDeepEqual(validateGate(repo, "DG0"), []);
  // Attack: edit the reviewer-authored sidecar after the run; mirror in findings.json.
  put(repo, VER2, { verifications: [{ finding_id: "F-DG0-101", result: "PASS", status_after: "CLOSED_VERIFIED", note: "fixed", evidence: [] }] });
  edit(repo, "docs/delivery/findings.json", (d) => { d.findings[0].status = "CLOSED_VERIFIED"; d.findings[0].verification.result = "PASS"; });
  commit(repo, "sync");
  assert.deepEqual(validateGate(repo, "DG0"), []);
});

test("BYPASS F-DG0-115c: flipping a committed FAIL review verdict (and its failing check) to PASS is accepted", () => {
  const { repo, records } = buildValidRepo();
  edit(repo, records["qa-verifier"], (r) => { r.verdict = "FAIL"; r.checks_run[0].result = "FAIL"; });
  commit(repo, "qa FAIL recorded");
  assert.notDeepEqual(validateGate(repo, "DG0"), []);
  edit(repo, records["qa-verifier"], (r) => { r.verdict = "PASS"; r.checks_run[0].result = "PASS"; });
  commit(repo, "qa record edited after the run");
  assert.deepEqual(validateGate(repo, "DG0"), []);
});

test("BYPASS F-DG0-115d: a verifying record without an 'assignment' field skips the assignment binding", () => {
  const { repo } = buildValidRepo();
  // A post-freeze code-security run for an unrelated task (e.g. another assignment), reused to close a finding.
  put(repo, "docs/delivery/assignments/DG0/T-OTHER.md", "unrelated task\n");
  const other = makeRun(repo, "code-security-reviewer", { assignment: "docs/delivery/assignments/DG0/T-OTHER.md", task: "T-OTHER" });
  const cid = get(repo, "docs/delivery/gates/DG0.json").candidate_id;
  const head = get(repo, "docs/delivery/gates/DG0.json").source_commit;
  put(repo, "docs/delivery/reviews/DG0/round-3/code-security-reviewer.json", { reviewer_role: "code-security-reviewer", candidate_id: cid, invocation_reference: other });
  put(repo, "docs/delivery/reviews/DG0/round-3/code-security-reviewer.verifications.json", { verifications: [{ finding_id: "F-DG0-101", result: "PASS", status_after: "CLOSED_VERIFIED", note: "", evidence: [] }] });
  edit(repo, "docs/delivery/stages.json", (d) => d.stages[0].review_rounds.push({ round: 3, candidate_id: cid, frozen_at: "2026-09-28T12:00:00Z", source_commit: head, records: {} }));
  edit(repo, "docs/delivery/findings.json", (d) => (d.findings[0].verification.invocation_reference = other));
  assert.deepEqual(validateGate(repo, "DG0"), [], "unrelated run + schema-less record + empty round records are accepted");
});

test("FIXED F-DG0-112: exec-bit and type are part of identity in committed trees too", () => {
  const repo = mkdtempSync(join(tmpdir(), "cand-mode-ref-"));
  fixtures.push(repo);
  sh(repo, "init", "-q", "-b", "main"); sh(repo, "config", "user.email", "t@e"); sh(repo, "config", "user.name", "t");
  const spec = { include: ["**"], exclude: ["trading_agent/**"] };
  put(repo, "run.sh", "echo hi\n"); commit(repo, "a");
  const a = candidateId(manifestFromRef(repo, "HEAD", spec));
  sh(repo, "update-index", "--chmod=+x", "run.sh"); sh(repo, "commit", "-qm", "b");
  assert.notEqual(candidateId(manifestFromRef(repo, "HEAD", spec)), a);
  put(repo, "entry.txt", "symlink:run.sh"); commit(repo, "c");
  const asFile = candidateId(manifestFromRef(repo, "HEAD", spec));
  unlinkSync(join(repo, "entry.txt")); symlinkSync("run.sh", join(repo, "entry.txt")); commit(repo, "d");
  assert.notEqual(candidateId(manifestFromRef(repo, "HEAD", spec)), asFile);
  // A manifest entry without a mode is refused rather than silently hashed.
  assert.throws(() => candidateId([{ path: "x", sha256: "0".repeat(64) }]));
});

test("OBSERVATION F-DG0-116: with core.fileMode=false (Windows default) the working-tree mode disagrees with git", () => {
  const repo = mkdtempSync(join(tmpdir(), "cand-filemode-"));
  fixtures.push(repo);
  sh(repo, "init", "-q", "-b", "main"); sh(repo, "config", "user.email", "t@e"); sh(repo, "config", "user.name", "t");
  const spec = { include: ["**"], exclude: ["trading_agent/**"] };
  put(repo, "run.sh", "echo hi\n"); sh(repo, "add", "run.sh"); sh(repo, "update-index", "--chmod=+x", "run.sh"); sh(repo, "commit", "-qm", "a");
  execFileSync("chmod", ["-x", join(repo, "run.sh")]); // what a filesystem without exec bits (NTFS/FAT) presents
  sh(repo, "config", "core.fileMode", "false");
  assert.equal(sh(repo, "status", "--porcelain"), "", "git sees no change");
  assert.notEqual(candidateId(manifestFromWorkingTree(repo, spec)), candidateId(manifestFromRef(repo, "HEAD", spec)), "but the working-tree candidate differs (fail-closed)");
});

test("BYPASS F-DG0-117 (Low): ACCEPTED_OBSERVATION trusts role names in findings.json; no reviewer/auditor artefact is required", () => {
  const { repo } = buildValidRepo();
  const low = { id: "F-DG0-150", stage_id: "DG0", requirement: "REQ-DLV-001", severity: "Low", mandatory_violation: false, title: "cosmetic",
    reproduction: "open the page", expected: "e", actual: "a", evidence: [], reported_by: "code-security-reviewer",
    reported_in: "docs/delivery/reviews/DG0/round-1/code-security-reviewer.json", owner: "delivery-orchestrator", status: "OPEN", history: [] };
  edit(repo, SIDE1, (s) => s.findings.push(low));
  edit(repo, REC1, (r) => r.findings.push("F-DG0-150"));
  // The orchestrator alone writes the acceptance; no reviewer or auditor file mentions F-DG0-150's acceptance.
  edit(repo, "docs/delivery/findings.json", (d) => d.findings.push({ ...low, status: "ACCEPTED_OBSERVATION", verification: null,
    acceptance: { rationale: "cosmetic wording only", owner: "delivery-orchestrator", accepted_by: ["code-security-reviewer", "release-auditor"] } }));
  edit(repo, "docs/delivery/gates/DG0.json", (g) => (g.accepted_observations = ["F-DG0-150"]));
  assert.deepEqual(validateGate(repo, "DG0"), []);
});
