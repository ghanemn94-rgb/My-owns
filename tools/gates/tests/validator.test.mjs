// Validator self-tests (acceptance A23 independent reviews, A24 enforced advancement, A25 candidate integrity).
// Run: node --test tools/gates/tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { candidateId, manifestFromRef, manifestFromWorkingTree } from "../lib/candidate.mjs";
import { validateGate, validatePipeline, reconcile, REGISTER_COLUMNS, STAGE_ORDER } from "../lib/rules.mjs";
import { parseCsv } from "../lib/csv.mjs";
// Hermetic git: fixtures must not depend on the host's global or system git config (e.g. mandatory commit signing).
process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_NOSYSTEM = "1";
process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = "gate-test";
process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = "gate-test@example.invalid";

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
let freezeCommit = null; // the commit containing the frozen manifest; runs start from it
const RUN_CWD = "/work/repo"; // the absolute working directory recorded for fixture runs
/** Writes a realistic run directory: meta + result + gzipped stream transcript, with hashes, like run-agent.sh. */
function makeRun(repo, role, { assignment, startedAt = T_RUN, task = "T-REV", stage = "DG0" } = {}) {
  counter++;
  const session_id = `${String(counter).padStart(8, "0")}-1111-4111-8111-111111111111`;
  const run_id = `${stage}-${task}-${role}-20260928T123000Z-${session_id.slice(0, 8)}`;
  const base = `docs/delivery/runs/${stage}/${run_id}`;
  const lines = [
    { type: "system", subtype: "init", session_id, cwd: RUN_CWD, model: "claude-opus-5-5", tools: ["Read", "Bash", "Write"] },
    { type: "user", isReplay: true, message: { role: "user", content: `You are invoked as project agent '${role}' for stage ${stage}, task ${task}. Your invocation_reference is: {"kind":"claude-code-cli-session","run_id":"${run_id}","session_id":"${session_id}"}. Your complete assignment is in the file ${RUN_CWD}/${assignment} (sha256 ${sha(readFileSync(join(repo, assignment)))}). Read it first. Your working directory is ${RUN_CWD}.` }, session_id },
    { type: "result", subtype: "success", is_error: false, session_id, result: "done" },
  ];
  const transcript = gzipSync(Buffer.from(lines.map((l) => JSON.stringify(l)).join("\n") + "\n"));
  const result = Buffer.from(JSON.stringify({ result: "done" }));
  put(repo, `${base}/transcript.jsonl.gz`, transcript);
  put(repo, `${base}/result.json`, result);
  const settings = Buffer.from(JSON.stringify({ sandbox: { enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false,
    filesystem: { denyWrite: [".git", ".claude", "tools/gates", "tools/agents", "docs/source", "docs/delivery/reviews", "docs/delivery/runs"].map((x) => `${RUN_CWD}/${x}`) } } }));
  put(repo, `${base}/settings.json`, settings);
  const processSandbox = Buffer.from(JSON.stringify(processSandboxFor(role, stage)));
  put(repo, `${base}/sandbox.json`, processSandbox);
  const invocation_reference = { kind: "claude-code-cli-session", run_id, session_id };
  put(repo, `${base}/meta.json`, {
    run_id, role, stage, task, invocation_reference, model_requested: "claude-opus-5-5",
    assignment, assignment_sha256: sha(readFileSync(join(repo, assignment))),
    started_at: startedAt, exit_code: 0, is_error: false, result_session_id: session_id, head_commit_at_start: freezeCommit, cwd: RUN_CWD,
    result_sha256: sha(result), transcript_sha256: sha(transcript), settings_sha256: sha(settings),
    process_sandbox_sha256: sha(processSandbox), process_sandbox: true, process_sandbox_discarded: [],
  });
  return invocation_reference;
}

/** What tools/agents/agent_sandbox.py records for a confined review run (D-030). */
function processSandboxFor(role, stage) {
  const key = { "domain-reviewer": "domain", "code-security-reviewer": "code-security", "qa-verifier": "qa", "release-auditor": "audit" }[role];
  const esc = (x) => x.replace(/[^A-Za-z0-9_]/g, "\\$&");
  return {
    schema: "mth-process-sandbox-v1", role, root: RUN_CWD, confined: true, read_only_root: true, private_tmp: ["/tmp", "/var/tmp"],
    run_tmp: "/var/tmp/mth-run.AbCdEf", writable_areas: [`docs/delivery/test-evidence/${stage}/${key}`, ...(role === "qa-verifier" ? ["tests/qa", "e2e"] : [])],
    read_only_within_writable: [],
    staged: [{ area: `docs/delivery/reviews/${stage}`, accept: `round-[0-9]+/${esc(role)}\\.[^/]+`, replace: false, copied: null },
      ...(role === "release-auditor" ? [{ area: "docs/delivery/gates", accept: `${stage}\\.json`, replace: true, copied: null }] : [])],
    private_sessions: true, cgroup_api: null, capabilities: ["CAP_SETFCAP"], no_new_privs: true, unshare: ["pid", "ipc"],
    copied_back: [], discarded: [],
  };
}

/** Records files as outputs written by a run's own file tools (what run-agent.sh derives from its snapshots). */
function bindOutputs(repo, ref, rels) {
  // Append the run's Write calls for these files to its transcript (before the final result line), as a real run would.
  const base = `docs/delivery/runs/DG0/${ref.run_id}`;
  const lines = gunzipSync(readFileSync(join(repo, `${base}/transcript.jsonl.gz`))).toString("utf8").split("\n").filter(Boolean);
  const result = lines.pop();
  for (const rel of rels) {
    counter++;
    lines.push(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: `tu-${counter}`, name: "Write", input: { file_path: `${RUN_CWD}/${rel}`, content: readFileSync(join(repo, rel), "utf8") } }] } }));
  }
  lines.push(result);
  const gz = gzipSync(Buffer.from(lines.join("\n") + "\n"));
  put(repo, `${base}/transcript.jsonl.gz`, gz);
  edit(repo, `${base}/meta.json`, (m) => {
    m.transcript_sha256 = sha(gz);
    m.outputs = { ...(m.outputs || {}) };
    m.written_by_tools = [...new Set([...(m.written_by_tools || []), ...rels])].sort();
    m.tool_authored = { ...(m.tool_authored || {}) };
    for (const rel of rels) m.outputs[rel] = m.tool_authored[rel] = sha(readFileSync(join(repo, rel)));
  });
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
  const mpath = `docs/delivery/candidates/DG0/${cid.slice(7, 23)}.manifest.json`;
  put(repo, mpath, { stage_id: "DG0", candidate_id: cid, hash_algorithm: "mth-candidate-v2", source_commit: head, frozen_at: T_FREEZE, spec, entries });
  doc.stages[0].candidate = { candidate_id: cid, source_commit: head, frozen_at: T_FREEZE, manifest_path: mpath };
  put(repo, "docs/delivery/stages.json", doc);
  sh(repo, "add", "-A");
  sh(repo, "commit", "-q", "-m", "freeze");
  freezeCommit = sh(repo, "rev-parse", "HEAD");
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
    bindOutputs(repo, rec.invocation_reference, [rel]);
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
  bindOutputs(repo, get(repo, "docs/delivery/reviews/DG0/round-1/code-security-reviewer.json").invocation_reference, ["docs/delivery/reviews/DG0/round-1/code-security-reviewer.findings.json"]);
  // Round 2: all PASS; code-security verifies the fix.
  const records = {};
  for (const role of ROLES) records[role] = record(role, 2);
  const csRec = get(repo, records["code-security-reviewer"]);
  // The reporter verifies the fix in its own round-2 sidecar (the source of truth for closure).
  put(repo, "docs/delivery/reviews/DG0/round-2/code-security-reviewer.verifications.json", {
    verifications: [{ finding_id: "F-DG0-101", result: "PASS", status_after: "CLOSED_VERIFIED", note: "fixed", evidence: [] }],
  });
  bindOutputs(repo, csRec.invocation_reference, ["docs/delivery/reviews/DG0/round-2/code-security-reviewer.verifications.json"]);
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
    manifest_path: mpath, previous_gate: null,
    reviews: { "domain-reviewer": records["domain-reviewer"], "code-security-reviewer": records["code-security-reviewer"], "qa-verifier": records["qa-verifier"] },
    release_audit: records["release-auditor"], requirements: { final_gate_ids: ["REQ-DLV-001"] },
    tests: [{ name: "validator self-test", command: "node --test", result: "PASS", evidence: ["docs/delivery/test-evidence/DG0/validator.txt"] }],
    blocking_conditions: [], accepted_observations: [], decided_at: T_RUN, decided_by: "release-auditor",
    invocation_reference: get(repo, records["release-auditor"]).invocation_reference,
  });
  bindOutputs(repo, get(repo, records["release-auditor"]).invocation_reference, ["docs/delivery/gates/DG0.json"]);
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
/** Test helper: edit the gate record and re-bind it to the auditor run (so the edit tests another rule). */
function editGate(repo, fn) {
  edit(repo, "docs/delivery/gates/DG0.json", fn);
  bindOutputs(repo, get(repo, "docs/delivery/gates/DG0.json").invocation_reference, ["docs/delivery/gates/DG0.json"]);
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
  editGate(repo, (g) => delete g.reviews["qa-verifier"]);
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
  editGate(c.repo, (g) => (g.tests[0].result = "FAIL"));
  expectError(validateGate(c.repo, "DG0"), /test 'validator self-test' is FAIL/);
  const d = buildValidRepo();
  editGate(d.repo, (g) => (g.tests = []));
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
  editGate(c.repo, (g) => (g.accepted_observations = ["F-DG0-101"]));
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
  editGate(e.repo, (g) => (g.accepted_observations = ["F-DG0-101"]));
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
  edit(a.repo, get(a.repo, "docs/delivery/gates/DG0.json").manifest_path, (m) => (m.spec = { include: ["**"], exclude: ["trading_agent/**", "src/**"] }));
  const errs = validateGate(a.repo, "DG0");
  expectError(errs, /spec differs from the stage's candidate_spec/);
  expectError(errs, /exclude must be/);
  const b = buildValidRepo();
  edit(b.repo, "docs/delivery/stages.json", (d) => (d.stages[0].candidate_spec.exclude = ["trading_agent/**", "apps/**"]));
  expectError(validateGate(b.repo, "DG0"), /candidate_spec exclude must be/);
});

test("A25: a tampered manifest or a stale review candidate is detected", () => {
  const a = buildValidRepo();
  edit(a.repo, get(a.repo, "docs/delivery/gates/DG0.json").manifest_path, (m) => (m.entries[0].sha256 = "0".repeat(64)));
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
  editGate(c.repo, (g) => (g.notes = "edited, uncommitted"));
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
  editGate(repo, (g) => (g.invocation_reference = get(repo, records["qa-verifier"]).invocation_reference));
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
  editGate(repo, (g) => {
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
  expectError(validateGate(c.repo, "DG0"), /write-once: docs\/delivery\/reviews\/DG0\/round-1\/.* was removed after it was committed/);
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

test("F-DG0-115: reviewer artefacts cannot be edited after the run, committed or not", () => {
  // (a) committed round-1 findings sidecar rewritten in a later commit
  const a = buildValidRepo();
  sh(a.repo, "add", "-A");
  sh(a.repo, "commit", "-qm", "round evidence");
  const side = "docs/delivery/reviews/DG0/round-1/code-security-reviewer.findings.json";
  put(a.repo, side, { findings: [] });
  edit(a.repo, "docs/delivery/reviews/DG0/round-1/code-security-reviewer.json", (r) => (r.findings = []));
  edit(a.repo, "docs/delivery/findings.json", (d) => (d.findings = []));
  sh(a.repo, "add", "-A");
  sh(a.repo, "commit", "-qm", "rewrite round 1");
  const ea = validateGate(a.repo, "DG0");
  expectError(ea, /write-once: docs\/delivery\/reviews\/DG0\/round-1\/code-security-reviewer\.findings\.json (has a M event|was committed with 2 different contents)/);
  // (b) uncommitted in-place edit of a verification sidecar no longer matches what the run wrote
  const b = buildValidRepo();
  const v = "docs/delivery/reviews/DG0/round-2/code-security-reviewer.verifications.json";
  edit(b.repo, v, (x) => (x.verifications[0].note = "edited by someone else"));
  expectError(validateGate(b.repo, "DG0"), /code-security-reviewer\.verifications\.json differs from what the run wrote/);
  // (c) a FAIL record flipped to PASS after commit
  const c = buildValidRepo();
  sh(c.repo, "add", "-A");
  sh(c.repo, "commit", "-qm", "round evidence");
  edit(c.repo, c.records["qa-verifier"], (r) => (r.summary = "quietly changed"));
  const ec = validateGate(c.repo, "DG0");
  expectError(ec, /write-once: working-tree docs\/delivery\/reviews\/DG0\/round-2\/qa-verifier\.json differs from its committed content/);
  expectError(ec, /qa-verifier\.json differs from what the run wrote/);
  // (d) a record the run's own tools did not write
  const d = buildValidRepo();
  edit(d.repo, `docs/delivery/runs/DG0/${get(d.repo, d.records["domain-reviewer"]).invocation_reference.run_id}/meta.json`, (m) => (m.tool_authored = {}));
  expectError(validateGate(d.repo, "DG0"), /was not written by this run's file tools/);
});

test("F-DG0-208: round metadata must match the committed manifest of its candidate", () => {
  const { repo } = buildValidRepo();
  edit(repo, "docs/delivery/stages.json", (d) => (d.stages[0].review_rounds[0].frozen_at = "2026-09-28T10:00:00Z"));
  expectError(validateGate(repo, "DG0"), /round 1 frozen_at\/source_commit differ from its committed manifest/);
});

test("F-DG0-102 residual: a verifying record must be the round's listed, schema-valid record", () => {
  const a = buildValidRepo();
  edit(a.repo, "docs/delivery/stages.json", (d) => delete d.stages[0].review_rounds[1].records["code-security-reviewer"]);
  expectError(validateGate(a.repo, "DG0"), /record for round-2 is not listed in stages\.json review_rounds/);
  const b = buildValidRepo();
  edit(b.repo, b.records["code-security-reviewer"], (r) => delete r.assignment);
  expectError(validateGate(b.repo, "DG0"), /not a valid review record/);
});

test("F-DG0-117: observations are accepted only through specialist and auditor sidecars", () => {
  const make = () => {
    const x = buildValidRepo();
    const side = "docs/delivery/reviews/DG0/round-1/code-security-reviewer.findings.json";
    edit(x.repo, side, (s) => Object.assign(s.findings[0], { severity: "Low", mandatory_violation: false }));
    bindOutputs(x.repo, get(x.repo, "docs/delivery/reviews/DG0/round-1/code-security-reviewer.json").invocation_reference, [side]);
    edit(x.repo, "docs/delivery/findings.json", (d) => Object.assign(d.findings[0], {
      severity: "Low", mandatory_violation: false, status: "ACCEPTED_OBSERVATION", verification: null,
      acceptance: { rationale: "cosmetic only, tracked", owner: "delivery-orchestrator", accepted_by: ["code-security-reviewer", "release-auditor"] },
    }));
    editGate(x.repo, (g) => (g.accepted_observations = ["F-DG0-101"]));
    return x;
  };
  // Only typed into findings.json: rejected.
  const a = make();
  const cs = "docs/delivery/reviews/DG0/round-2/code-security-reviewer.verifications.json";
  put(a.repo, cs, { verifications: [] });
  bindOutputs(a.repo, get(a.repo, a.records["code-security-reviewer"]).invocation_reference, [cs]);
  const ea = validateGate(a.repo, "DG0");
  expectError(ea, /no release-auditor sidecar accepts it/);
  expectError(ea, /no specialist reviewer sidecar accepts it/);
  // Accepted by the specialist and the auditor through their own bound sidecars: passes.
  const b = make();
  const entry = { finding_id: "F-DG0-101", result: "PASS", status_after: "ACCEPTED_OBSERVATION", note: "accept as cosmetic", evidence: [] };
  put(b.repo, cs, { verifications: [entry] });
  bindOutputs(b.repo, get(b.repo, b.records["code-security-reviewer"]).invocation_reference, [cs]);
  const au = "docs/delivery/reviews/DG0/round-2/release-auditor.verifications.json";
  put(b.repo, au, { verifications: [entry] });
  bindOutputs(b.repo, get(b.repo, b.records["release-auditor"]).invocation_reference, [au]);
  edit(b.repo, "docs/delivery/stages.json", (d) => (d.stages[0].review_rounds[1].records["release-auditor"] = b.records["release-auditor"]));
  assert.deepEqual(validateGate(b.repo, "DG0"), []);
});

test("F-DG0-116: with core.fileMode=false tracked modes come from the index", () => {
  const repo = mkdtempSync(join(tmpdir(), "cand-fm-"));
  fixtures.push(repo);
  sh(repo, "init", "-q", "-b", "main");
  put(repo, "run.sh", "echo hi\n");
  execFileSync("chmod", ["+x", join(repo, "run.sh")]);
  sh(repo, "-c", "user.email=t@e", "-c", "user.name=t", "add", "-A");
  sh(repo, "-c", "user.email=t@e", "-c", "user.name=t", "commit", "-qm", "c");
  const spec = { include: ["**"], exclude: ["trading_agent/**"] };
  const committed = candidateId(manifestFromRef(repo, "HEAD", spec));
  sh(repo, "config", "core.fileMode", "false");
  execFileSync("chmod", ["-x", join(repo, "run.sh")]); // e.g. a filesystem without exec bits
  assert.equal(candidateId(manifestFromWorkingTree(repo, spec)), committed);
});

test("F-DG0-115 residual: an evil merge cannot rewrite committed evidence", () => {
  const { repo } = buildValidRepo();
  sh(repo, "add", "-A");
  sh(repo, "commit", "-qm", "round evidence");
  sh(repo, "checkout", "-q", "-b", "side");
  put(repo, "side.txt", "noise\n");
  sh(repo, "add", "side.txt");
  sh(repo, "commit", "-qm", "side");
  sh(repo, "checkout", "-q", "main");
  sh(repo, "merge", "--no-ff", "--no-commit", "side");
  const v = "docs/delivery/reviews/DG0/round-2/code-security-reviewer.verifications.json";
  edit(repo, v, (x) => (x.verifications[0].note = "rewritten inside a merge"));
  sh(repo, "add", "-A");
  sh(repo, "commit", "-qm", "evil merge");
  expectError(validateGate(repo, "DG0"), /code-security-reviewer\.verifications\.json (has a M event|was committed with 2 different contents)/);
});

test("F-DG0-118: skip-worktree / assume-unchanged cannot hide edited evidence", () => {
  const { repo, records } = buildValidRepo();
  sh(repo, "add", "-A");
  sh(repo, "commit", "-qm", "round evidence");
  sh(repo, "update-index", "--skip-worktree", records["qa-verifier"]);
  edit(repo, records["qa-verifier"], (r) => (r.summary = "hidden edit"));
  assert.equal(sh(repo, "status", "--porcelain"), "", "git status is blind to the edit");
  expectError(validateGate(repo, "DG0"), /working-tree docs\/delivery\/reviews\/DG0\/round-2\/qa-verifier\.json differs .*skip-worktree/);
});

test("F-DG0-119: only content replayed from the run's own successful Write/Edit calls is bound", () => {
  const { repo, records } = buildValidRepo();
  const ref = get(repo, records["qa-verifier"]).invocation_reference;
  edit(repo, `docs/delivery/runs/DG0/${ref.run_id}/meta.json`, (m) => (m.tool_authored[records["qa-verifier"]] = "0".repeat(64)));
  expectError(validateGate(repo, "DG0"), /does not equal the content of this run's own Write\/Edit calls/);
});

test("F-DG0-121 / F-DG0-211: the gate file must be what the auditor run wrote", () => {
  const { repo } = buildValidRepo();
  edit(repo, "docs/delivery/gates/DG0.json", (g) => (g.tests[0].command = "never run"));
  expectError(validateGate(repo, "DG0"), /docs\/delivery\/gates\/DG0\.json differs from what the run wrote/);
});

test("F-DG0-212: a round manifest must describe its source commit; runs start from a commit containing it", () => {
  const { repo, cid, head } = buildValidRepo();
  // Fabricated manifest for a new round: self-consistent id, but not the content of source_commit.
  const fake = [{ path: "src/app.txt", sha256: "1".repeat(64), mode: "100644" }];
  const fakeId = candidateId(fake);
  put(repo, `docs/delivery/candidates/DG0/${fakeId.slice(7, 23)}.manifest.json`, { stage_id: "DG0", candidate_id: fakeId, hash_algorithm: "mth-candidate-v2", source_commit: head, frozen_at: "2026-09-28T10:00:00Z", spec: { include: ["**"], exclude: ["trading_agent/**"] }, entries: fake });
  edit(repo, "docs/delivery/stages.json", (d) => d.stages[0].review_rounds.push({ round: 3, candidate_id: fakeId, frozen_at: "2026-09-28T10:00:00Z", source_commit: head, records: {} }));
  expectError(validateGate(repo, "DG0"), /does not describe its source_commit/);
  // A run that started from a commit which lacks the frozen manifest cannot be bound to the review.
  const b = buildValidRepo();
  const ref = get(b.repo, b.records["domain-reviewer"]).invocation_reference;
  edit(b.repo, `docs/delivery/runs/DG0/${ref.run_id}/meta.json`, (m) => (m.head_commit_at_start = b.head));
  expectError(validateGate(b.repo, "DG0"), /which does not contain docs\/delivery\/candidates\/DG0\//);
  assert.ok(cid);
});

test("F-DG0-115 residual: a back-dated side branch merged in cannot replace committed evidence", () => {
  const { repo } = buildValidRepo();
  const v = "docs/delivery/reviews/DG0/round-2/code-security-reviewer.verifications.json";
  sh(repo, "add", "-A");
  sh(repo, "commit", "-qm", "genuine round evidence");
  const genuine = sh(repo, "rev-parse", "HEAD");
  // Side commit from before the evidence, back-dated to 2001, adding a forged version of the same file.
  sh(repo, "checkout", "-q", "-b", "forgery", freezeCommit);
  put(repo, v, { verifications: [{ finding_id: "F-DG0-101", result: "PASS", status_after: "CLOSED_VERIFIED", note: "forged", evidence: [] }] });
  sh(repo, "add", v);
  execFileSync("git", ["-C", repo, "commit", "-qm", "forged"], { env: { ...process.env, GIT_COMMITTER_DATE: "2001-01-01T00:00:00Z", GIT_AUTHOR_DATE: "2001-01-01T00:00:00Z" } });
  sh(repo, "checkout", "-q", "main");
  try {
    sh(repo, "merge", "-q", "--no-ff", "-X", "theirs", "-m", "merge forgery", "forgery");
  } catch {
    sh(repo, "checkout", "--theirs", v);
    sh(repo, "add", v);
    sh(repo, "commit", "-qm", "merge forgery");
  }
  assert.notEqual(sh(repo, "rev-parse", "HEAD"), genuine);
  const errors = validateGate(repo, "DG0");
  expectError(errors, /code-security-reviewer\.verifications\.json (was committed with 2 different contents|has a M event)/);
  expectError(errors, /is back-dated before its parent/);
});

test("F-DG0-115 defence in depth: meta.tool_authored cannot vouch for content the transcript never wrote", () => {
  const { repo, records } = buildValidRepo();
  const rel = records["qa-verifier"];
  const ref = get(repo, rel).invocation_reference;
  edit(repo, rel, (r) => (r.summary = "rewritten, with meta re-pointed"));
  edit(repo, `docs/delivery/runs/DG0/${ref.run_id}/meta.json`, (m) => (m.outputs[rel] = m.tool_authored[rel] = sha(readFileSync(join(repo, rel)))));
  expectError(validateGate(repo, "DG0"), /qa-verifier\.json differs from the replay of this run's transcript/);
});

test("D-022: only a CLI-replayed prompt binds a transcript to its run; the same text in a tool result does not", () => {
  const { repo, records } = buildValidRepo();
  const ref = get(repo, records["domain-reviewer"]).invocation_reference;
  const base = `docs/delivery/runs/DG0/${ref.run_id}`;
  const lines = gunzipSync(readFileSync(join(repo, `${base}/transcript.jsonl.gz`))).toString("utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const promptLine = lines.find((o) => o.isReplay);
  // Move the prompt text into a tool_result (as when an agent reads run-agent.sh), dropping the replayed message.
  const rewritten = lines.filter((o) => o !== promptLine);
  rewritten.splice(1, 0, { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: promptLine.message.content }] } });
  const gz = gzipSync(Buffer.from(rewritten.map((o) => JSON.stringify(o)).join("\n") + "\n"));
  put(repo, `${base}/transcript.jsonl.gz`, gz);
  edit(repo, `${base}/meta.json`, (m) => (m.transcript_sha256 = sha(gz)));
  expectError(validateGate(repo, "DG0"), /does not contain the CLI-replayed runner prompt for 'domain-reviewer'/);
});

test("F-DG0-132: an empty or newline-only transcript fails every transcript check", () => {
  for (const body of ["", "\n\n\n"]) {
    const { repo, records } = buildValidRepo();
    const ref = get(repo, records["qa-verifier"]).invocation_reference;
    const gz = gzipSync(Buffer.from(body));
    put(repo, `docs/delivery/runs/DG0/${ref.run_id}/transcript.jsonl.gz`, gz);
    edit(repo, `docs/delivery/runs/DG0/${ref.run_id}/meta.json`, (m) => (m.transcript_sha256 = sha(gz)));
    const errors = validateGate(repo, "DG0");
    expectError(errors, /transcript is empty/);
    expectError(errors, /no init line/);
    expectError(errors, /CLI-replayed runner prompt/);
    expectError(errors, /does not end in a successful result/);
    expectError(errors, /cannot be reconstructed from this run's own successful Write\/Edit calls/);
  }
});

test("F-DG0-133: the assignment named in the replayed prompt must be the one recorded in meta", () => {
  const { repo, records } = buildValidRepo();
  const ref = get(repo, records["qa-verifier"]).invocation_reference;
  const base = `docs/delivery/runs/DG0/${ref.run_id}`;
  const lines = gunzipSync(readFileSync(join(repo, `${base}/transcript.jsonl.gz`))).toString("utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const p = lines.find((o) => o.isReplay);
  p.message.content = p.message.content.replace(/in the file \S+ \(sha256 [0-9a-f]{64}\)/, `in the file ${RUN_CWD}/docs/delivery/assignments/DG0/round-9/other.md (sha256 ${"0".repeat(64)})`);
  const gz = gzipSync(Buffer.from(lines.map((o) => JSON.stringify(o)).join("\n") + "\n"));
  put(repo, `${base}/transcript.jsonl.gz`, gz);
  edit(repo, `${base}/meta.json`, (m) => (m.transcript_sha256 = sha(gz)));
  expectError(validateGate(repo, "DG0"), /the replayed prompt names assignment .*round-9\/other\.md/);
});

test("F-DG0-223: a genuine prompt binds when the checkout path contains spaces", () => {
  const { repo, records } = buildValidRepo();
  const ref = get(repo, records["qa-verifier"]).invocation_reference;
  const base = `docs/delivery/runs/DG0/${ref.run_id}`;
  const lines = gunzipSync(readFileSync(join(repo, `${base}/transcript.jsonl.gz`))).toString("utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const p = lines.find((o) => o.isReplay);
  p.message.content = p.message.content.replace(`in the file ${RUN_CWD}/`, "in the file /home/Jane Doe/My Projects/repo/");
  const gz = gzipSync(Buffer.from(lines.map((o) => JSON.stringify(o)).join("\n") + "\n"));
  put(repo, `${base}/transcript.jsonl.gz`, gz);
  edit(repo, `${base}/meta.json`, (m) => (m.transcript_sha256 = sha(gz)));
  assert.deepEqual(validateGate(repo, "DG0"), []);
});

test("F-DG0-224: the validator loads its schemas from a path with spaces and non-ASCII characters", () => {
  const dir = mkdtempSync(join(tmpdir(), "gate tools é-"));
  fixtures.push(dir);
  execFileSync("cp", ["-r", join(dirname(fileURLToPath(import.meta.url)), ".."), join(dir, "gates")]);
  const out = execFileSync("node", ["--input-type=module", "-e",
    `import(${JSON.stringify(join(dir, "gates", "lib", "rules.mjs"))}).then((m) => console.log(Object.keys(m.schema("review").properties).length > 5))`]).toString().trim();
  assert.equal(out, "true");
});

test("D-024: a run that changed configuration outside the candidate is rejected", () => {
  const { repo, records } = buildValidRepo();
  const ref = get(repo, records["qa-verifier"]).invocation_reference;
  edit(repo, `docs/delivery/runs/DG0/${ref.run_id}/meta.json`, (m) => (m.external_config_changed = ["/root/.claude/settings.json 9f86d0"]));
  expectError(validateGate(repo, "DG0"), /changed configuration outside the candidate/);
});

test("D-025: gate records must come from Bash-sandboxed runs", () => {
  const a = buildValidRepo();
  const ref = get(a.repo, a.records["qa-verifier"]).invocation_reference;
  unlinkSync(join(a.repo, `docs/delivery/runs/DG0/${ref.run_id}/settings.json`));
  expectError(validateGate(a.repo, "DG0"), /has no settings\.json/);
  const b = buildValidRepo();
  const refB = get(b.repo, b.records["domain-reviewer"]).invocation_reference;
  const rel = `docs/delivery/runs/DG0/${refB.run_id}/settings.json`;
  const weak = Buffer.from(JSON.stringify({ sandbox: { enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: true, filesystem: { denyWrite: [] } } }));
  put(b.repo, rel, weak);
  edit(b.repo, `docs/delivery/runs/DG0/${refB.run_id}/meta.json`, (m) => (m.settings_sha256 = sha(weak)));
  const errs = validateGate(b.repo, "DG0");
  expectError(errs, /Bash sandbox was not enforced/);
  expectError(errs, /does not deny writes to .*\/tools\/gates/);
});

test("F-DG0-145/D-030: gate records must come from runs whose whole agent process was confined to the role's own areas", () => {
  const missing = buildValidRepo();
  const refM = get(missing.repo, missing.records["domain-reviewer"]).invocation_reference;
  unlinkSync(join(missing.repo, `docs/delivery/runs/DG0/${refM.run_id}/sandbox.json`));
  expectError(validateGate(missing.repo, "DG0"), /has no sandbox\.json/);
  const tamper = (mutate, pattern) => {
    const { repo, records } = buildValidRepo();
    const ref = get(repo, records["qa-verifier"]).invocation_reference;
    const px = processSandboxFor("qa-verifier", "DG0");
    mutate(px);
    const buf = Buffer.from(JSON.stringify(px));
    put(repo, `docs/delivery/runs/DG0/${ref.run_id}/sandbox.json`, buf);
    edit(repo, `docs/delivery/runs/DG0/${ref.run_id}/meta.json`, (m) => (m.process_sandbox_sha256 = sha(buf)));
    expectError(validateGate(repo, "DG0"), pattern);
  };
  tamper((px) => (px.confined = false), /agent process was not confined by the process sandbox/);
  tamper((px) => (px.capabilities = ["CAP_SETFCAP", "CAP_SYS_ADMIN"]), /agent process was not confined by the process sandbox/);
  tamper((px) => (px.root = "/somewhere/else"), /agent process was not confined by the process sandbox/);
  tamper((px) => px.writable_areas.push("docs/delivery/test-evidence/DG0/domain"), /process sandbox made .* writable, not the role's/);
  tamper((px) => (px.staged[0].accept = "round-[0-9]+/[^/]+"), /staged other directories or accepted other files/);
  tamper((px) => px.discarded.push("docs/delivery/reviews/DG0/round-1/domain-reviewer.json: outside the role's scope (not copied)"), /discarded out-of-scope writes/);
  // The file must be the one the runner hashed into meta.
  const { repo, records } = buildValidRepo();
  const ref = get(repo, records["code-security-reviewer"]).invocation_reference;
  put(repo, `docs/delivery/runs/DG0/${ref.run_id}/sandbox.json`, Buffer.from(JSON.stringify(processSandboxFor("code-security-reviewer", "DG0"), null, 1)));
  expectError(validateGate(repo, "DG0"), /sandbox\.json does not match meta\.process_sandbox_sha256/);
});

test("F-DG0-230: the sandbox deny list must protect the run's own repository, not some other directory", () => {
  const { repo, records } = buildValidRepo();
  const ref = get(repo, records["qa-verifier"]).invocation_reference;
  const rel = `docs/delivery/runs/DG0/${ref.run_id}/settings.json`;
  const elsewhere = Buffer.from(JSON.stringify({ sandbox: { enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false,
    filesystem: { denyWrite: [".git", ".claude", "tools/gates", "tools/agents", "docs/source", "docs/delivery/reviews", "docs/delivery/runs"].map((x) => `/somewhere/else/${x}`) } } }));
  put(repo, rel, elsewhere);
  edit(repo, `docs/delivery/runs/DG0/${ref.run_id}/meta.json`, (m) => (m.settings_sha256 = sha(elsewhere)));
  expectError(validateGate(repo, "DG0"), /does not deny writes to \/work\/repo\/tools\/gates/);
});

test("F-DG0-233: meta.cwd is bound to the transcript (the CLI init line and the replayed prompt)", () => {
  // A run whose meta.cwd and sandbox deny list both name a foreign root must not bind a gate record.
  for (const tamper of ["meta", "init", "prompt"]) {
    const { repo, records } = buildValidRepo();
    const ref = get(repo, records["qa-verifier"]).invocation_reference;
    const base = `docs/delivery/runs/DG0/${ref.run_id}`;
    if (tamper === "meta") {
      const foreign = Buffer.from(JSON.stringify({ sandbox: { enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false,
        filesystem: { denyWrite: [".git", ".claude", "tools/gates", "tools/agents", "docs/source", "docs/delivery/reviews", "docs/delivery/runs"].map((x) => `/foreign/root/${x}`) } } }));
      put(repo, `${base}/settings.json`, foreign);
      edit(repo, `${base}/meta.json`, (m) => { m.cwd = "/foreign/root"; m.settings_sha256 = sha(foreign); });
    } else {
      const lines = gunzipSync(readFileSync(join(repo, base, "transcript.jsonl.gz"))).toString().trim().split("\n").map((l) => JSON.parse(l));
      if (tamper === "init") lines[0].cwd = "/foreign/root";
      else lines[1].message.content = lines[1].message.content.replace(`Your working directory is ${RUN_CWD}.`, "Your working directory is /foreign/root.");
      const gz = gzipSync(Buffer.from(lines.map((l) => JSON.stringify(l)).join("\n") + "\n"));
      put(repo, `${base}/transcript.jsonl.gz`, gz);
      edit(repo, `${base}/meta.json`, (m) => (m.transcript_sha256 = sha(gz)));
    }
    const errs = validateGate(repo, "DG0");
    expectError(errs, tamper === "prompt" ? /replayed prompt names working directory \/foreign\/root/ : /init cwd/);
  }
});

test("F-DG0-146/F-DG0-236: concurrent sandbox mount stubs do not perturb the working-tree candidate; anything else still does", () => {
  const repo = mkdtempSync(join(tmpdir(), "cand-stub-"));
  fixtures.push(repo);
  sh(repo, "init", "-q", "-b", "main");
  put(repo, "app.txt", "a\n");
  put(repo, "tracked-empty.txt", "");
  sh(repo, "-c", "user.email=t@e", "-c", "user.name=t", "add", "-A");
  sh(repo, "-c", "user.email=t@e", "-c", "user.name=t", "commit", "-qm", "c");
  const spec = { include: ["**"], exclude: ["trading_agent/**"] };
  const head = candidateId(manifestFromRef(repo, "HEAD", spec));
  const stub = (rel) => { mkdirSync(dirname(join(repo, rel)), { recursive: true }); writeFileSync(join(repo, rel), ""); chmodSync(join(repo, rel), 0o444); };
  // What bubblewrap leaves while another agent's sandboxed command runs: empty, read-only, untracked regular files.
  for (const rel of [".bashrc", ".mcp.json", "CLAUDE.local.md", "docs/new-area/.gitmodules"]) stub(rel);
  assert.equal(candidateId(manifestFromWorkingTree(repo, spec)), head, "sandbox stubs must not change the working-tree candidate");
  // Everything else still counts: an empty writable untracked file, a non-empty read-only one, a truncated tracked one.
  for (const [label, act] of [
    ["empty writable untracked file", () => writeFileSync(join(repo, "empty.txt"), "")],
    ["non-empty read-only untracked file", () => { writeFileSync(join(repo, "ro.txt"), "x"); chmodSync(join(repo, "ro.txt"), 0o444); }],
    ["tracked file truncated and made read-only", () => { writeFileSync(join(repo, "app.txt"), ""); chmodSync(join(repo, "app.txt"), 0o444); }],
    ["tracked empty file removed", () => rmSync(join(repo, "tracked-empty.txt"))],
  ]) {
    act();
    assert.notEqual(candidateId(manifestFromWorkingTree(repo, spec)), head, `${label} must change the working-tree candidate`);
    sh(repo, "checkout", "-q", "--", ".");
    for (const f of ["empty.txt", "ro.txt"]) rmSync(join(repo, f), { force: true });
    chmodSync(join(repo, "app.txt"), 0o644);
    sh(repo, "checkout", "-q", "--", ".");
    assert.equal(candidateId(manifestFromWorkingTree(repo, spec)), head);
  }
});
