// DG0 round-6 code-security reproduction (code-security-reviewer, T-DG0-REV-SEC-R6), re-run of the round-5 suite; helpers verbatim from validator.test.mjs (unchanged d141d303..a059b55). NOT part of any candidate.
// Lines between the markers are copied verbatim from the candidate's tools/gates/tests/validator.test.mjs (commit d141d303,
// lines 15-225: helpers, makeRun, bindOutputs, buildValidRepo, approveAndCommit, editGate), with imports redirected to GATE_TOOLS.
// Convention: "FIXED ..." tests PASS when the weakness is ABSENT; "BYPASS ..." tests PASS when the weakness is PRESENT.
// Run: GATE_TOOLS=/tmp/dg0-sec-r5 node --test docs/delivery/test-evidence/DG0/code-security/round-5/repro-r5.test.mjs
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
const { parseCsv } = await imp("tools/gates/lib/csv.mjs");
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
let freezeCommit = null; // the commit containing the frozen manifest; runs start from it
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
    started_at: startedAt, exit_code: 0, is_error: false, result_session_id: session_id, head_commit_at_start: freezeCommit,
    result_sha256: sha(result), transcript_sha256: sha(transcript),
  });
  return invocation_reference;
}

/** Records files as outputs written by a run's own file tools (what run-agent.sh derives from its snapshots). */
function bindOutputs(repo, ref, rels) {
  edit(repo, `docs/delivery/runs/DG0/${ref.run_id}/meta.json`, (m) => {
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
// ---- verbatim copy ends; round-5 reproductions below ----
const commit = (repo, msg) => { sh(repo, "add", "-A"); sh(repo, "commit", "-qm", msg); };
const SIDE1 = "docs/delivery/reviews/DG0/round-1/code-security-reviewer.findings.json";
const REC1 = "docs/delivery/reviews/DG0/round-1/code-security-reviewer.json";
const VER2 = "docs/delivery/reviews/DG0/round-2/code-security-reviewer.verifications.json";
const GATE = "docs/delivery/gates/DG0.json";
const metaOf = (repo, rec) => `docs/delivery/runs/DG0/${get(repo, rec).invocation_reference.run_id}/meta.json`;

/** A valid repo whose reviewer (round 2) genuinely says FAIL/OPEN for F-DG0-101, committed as run-agent.sh would. */
function buildFailingCommitted() {
  const x = buildValidRepo();
  const cs = x.records["code-security-reviewer"];
  put(x.repo, VER2, { verifications: [{ finding_id: "F-DG0-101", result: "FAIL", status_after: "OPEN", note: "not fixed", evidence: [] }] });
  bindOutputs(x.repo, get(x.repo, cs).invocation_reference, [VER2]);
  edit(x.repo, "docs/delivery/findings.json", (d) => Object.assign(d.findings[0], { status: "OPEN", verification: null, fix_revision: null }));
  commit(x.repo, "round evidence (auto-committed by the runner)");
  x.roundCommit = sh(x.repo, "rev-parse", "HEAD");
  return x;
}
/** The forgery: the genuine FAIL sidecar becomes PASS/CLOSED_VERIFIED; meta.outputs/tool_authored re-pointed. */
function forgeClosure(x) {
  const cs = x.records["code-security-reviewer"];
  put(x.repo, VER2, { verifications: [{ finding_id: "F-DG0-101", result: "PASS", status_after: "CLOSED_VERIFIED", note: "fixed", evidence: [] }] });
  bindOutputs(x.repo, get(x.repo, cs).invocation_reference, [VER2]);
  edit(x.repo, "docs/delivery/findings.json", (d) => Object.assign(d.findings[0], {
    status: "CLOSED_VERIFIED", fix_revision: x.head,
    verification: { by_role: "code-security-reviewer", invocation_reference: get(x.repo, cs).invocation_reference, at: T_RUN, result: "PASS", evidence: [], note: "fixed" },
  }));
}
/**
 * N4: commit the current (forged, uncommitted) working tree twice with plumbing only:
 *   S = a side commit whose parent is the FREEZE commit (before the round evidence existed), with a back-dated date,
 *   M = a merge of HEAD and S with the same tree. The write-once paths are then "first added" by S (the forgery).
 */
function backdatedSideMerge(x, { date = "2001-01-01T00:00:00Z", omitFromSide = [] } = {}) {
  sh(x.repo, "add", "-A");
  for (const p of omitFromSide) sh(x.repo, "rm", "-q", "--cached", p);
  const sideTree = sh(x.repo, "write-tree");
  sh(x.repo, "add", "-A");
  const tree = sh(x.repo, "write-tree");
  const env = { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
  const s = execFileSync("git", ["-C", x.repo, "commit-tree", sideTree, "-p", freezeCommit, "-m", "side work"], { env }).toString().trim();
  const m = execFileSync("git", ["-C", x.repo, "commit-tree", tree, "-p", "HEAD", "-p", s, "-m", "Merge branch 'side'"]).toString().trim();
  sh(x.repo, "reset", "-q", "--hard", m);
  return { s, m };
}

test("SANITY: the copied fixture is valid under the tools under test", () => {
  const { repo } = buildValidRepo();
  assert.deepEqual(validateGate(repo, "DG0"), []);
});

test("SANITY: the genuine FAIL verification keeps the gate closed", () => {
  const x = buildFailingCommitted();
  expectError(validateGate(x.repo, "DG0"), /latest reviewer verification .* is FAIL|unresolved \(OPEN\)/);
});

// ---------------- F-DG0-115 / F-DG0-118 / N1 (round 4) re-verification ----------------
test("FIXED F-DG0-115b: forging the closure in an ordinary commit is detected", () => {
  const x = buildFailingCommitted();
  forgeClosure(x);
  commit(x.repo, "forge");
  const e = validateGate(x.repo, "DG0");
  expectError(e, /write-once: docs\/delivery\/reviews\/DG0\/round-2\/code-security-reviewer\.verifications\.json in HEAD differs/);
  expectError(e, /write-once: docs\/delivery\/runs\/DG0\/.*\/meta\.json in HEAD differs/);
});

test("FIXED F-DG0-115b (uncommitted): forging the closure in the working tree is detected", () => {
  const x = buildFailingCommitted();
  forgeClosure(x);
  expectError(validateGate(x.repo, "DG0"), /write-once: working-tree .*code-security-reviewer\.verifications\.json differs/);
});

test("FIXED F-DG0-115a: editing a committed round-1 sidecar + record to drop a High finding is detected", () => {
  const x = buildValidRepo();
  commit(x.repo, "round evidence");
  put(x.repo, SIDE1, { findings: [] });
  edit(x.repo, REC1, (r) => { r.findings = []; r.verdict = "PASS"; });
  edit(x.repo, "docs/delivery/findings.json", (d) => (d.findings = []));
  commit(x.repo, "rewrite");
  expectError(validateGate(x.repo, "DG0"), /write-once: docs\/delivery\/reviews\/DG0\/round-1\/.* in HEAD differs/);
});

test("FIXED F-DG0-115c: flipping a committed FAIL review verdict to PASS is detected", () => {
  const x = buildValidRepo();
  const qa = x.records["qa-verifier"];
  edit(x.repo, qa, (r) => { r.verdict = "FAIL"; r.checks_run[0].result = "FAIL"; });
  bindOutputs(x.repo, get(x.repo, qa).invocation_reference, [qa]);
  commit(x.repo, "round evidence");
  edit(x.repo, qa, (r) => { r.verdict = "PASS"; r.checks_run[0].result = "PASS"; });
  bindOutputs(x.repo, get(x.repo, qa).invocation_reference, [qa]);
  commit(x.repo, "flip");
  expectError(validateGate(x.repo, "DG0"), /write-once: docs\/delivery\/reviews\/DG0\/round-2\/qa-verifier\.json in HEAD differs/);
});

test("FIXED N1 (round-4 evil merge, ordinary --no-commit merge): forged closure is now detected", () => {
  const x = buildFailingCommitted();
  sh(x.repo, "checkout", "-q", "-b", "side");
  sh(x.repo, "commit", "-q", "--allow-empty", "-m", "unrelated side work");
  sh(x.repo, "checkout", "-q", "main");
  sh(x.repo, "merge", "-q", "--no-ff", "--no-commit", "side");
  forgeClosure(x);
  sh(x.repo, "add", "-A");
  sh(x.repo, "commit", "-q", "-m", "Merge branch 'side'");
  expectError(validateGate(x.repo, "DG0"), /code-security-reviewer\.verifications\.json in HEAD differs from the version first committed/);
});

test("FIXED F-DG0-118: skip-worktree hides nothing any more", () => {
  const x = buildFailingCommitted();
  const meta = metaOf(x.repo, x.records["code-security-reviewer"]);
  sh(x.repo, "update-index", "--skip-worktree", VER2, meta, "docs/delivery/findings.json");
  forgeClosure(x);
  assert.equal(sh(x.repo, "status", "--porcelain"), "");
  expectError(validateGate(x.repo, "DG0"), /working-tree .*code-security-reviewer\.verifications\.json differs .*skip-worktree/);
  const y = buildFailingCommitted();
  sh(y.repo, "update-index", "--assume-unchanged", VER2, metaOf(y.repo, y.records["code-security-reviewer"]), "docs/delivery/findings.json");
  forgeClosure(y);
  assert.equal(sh(y.repo, "status", "--porcelain"), "");
  expectError(validateGate(y.repo, "DG0"), /working-tree .*code-security-reviewer\.verifications\.json differs/);
});

// ---------------- NEW in round 5 ----------------
test("DIAG N4: a side commit with a CURRENT date that re-adds forged evidence is detected (log order puts the genuine add first)", () => {
  const x = buildFailingCommitted();
  forgeClosure(x);
  backdatedSideMerge(x, { date: "2099-01-01T00:00:00Z" });
  expectError(validateGate(x.repo, "DG0"), /code-security-reviewer\.verifications\.json in HEAD differs from the version first committed/);
});

test("BYPASS N4 (back-dated side branch + merge): the genuine committed FAIL verification is replaced by a forged PASS closure", () => {
  // Realistic order: round evidence is committed by the runner first; the gate record is written later by the auditor.
  const x = buildValidRepo();
  const gateDoc = get(x.repo, GATE);
  rmSync(join(x.repo, GATE));
  const cs = x.records["code-security-reviewer"];
  put(x.repo, VER2, { verifications: [{ finding_id: "F-DG0-101", result: "FAIL", status_after: "OPEN", note: "not fixed", evidence: [] }] });
  bindOutputs(x.repo, get(x.repo, cs).invocation_reference, [VER2]);
  edit(x.repo, "docs/delivery/findings.json", (d) => Object.assign(d.findings[0], { status: "OPEN", verification: null, fix_revision: null }));
  commit(x.repo, "round evidence (auto-committed by the runner)");
  const roundCommit = sh(x.repo, "rev-parse", "HEAD");
  forgeClosure(x);
  put(x.repo, GATE, gateDoc);
  backdatedSideMerge(x, { omitFromSide: [GATE] }); // the gate record appears only in the merge
  assert.equal(sh(x.repo, "status", "--porcelain"), "");
  // The genuine FAIL is still in history (round commit), HEAD holds the forgery; git diff shows the rewrite.
  assert.match(sh(x.repo, "show", `${roundCommit}:${VER2}`), /"FAIL"/);
  assert.match(sh(x.repo, "show", `HEAD:${VER2}`), /CLOSED_VERIFIED/);
  assert.match(sh(x.repo, "diff", "--name-status", roundCommit, "HEAD"), /^M\tdocs\/delivery\/reviews\/DG0\/round-2\/code-security-reviewer\.verifications\.json/m);
  const e = validateGate(x.repo, "DG0");
  assert.deepEqual(e, [], "expected the gate to (wrongly) pass:\n" + e.join("\n"));
  approveAndCommit(x.repo);
  const h = validateGate(x.repo, "DG0", { mode: "historical" });
  assert.deepEqual(h, [], "historical:\n" + h.join("\n"));
  assert.deepEqual(validatePipeline(x.repo).errors, []);
});

test("BYPASS N4b (back-dated side branch + merge): a committed round-1 High finding and FAIL verdict are dropped", () => {
  const x = buildValidRepo();
  put(x.repo, VER2, { verifications: [] });
  bindOutputs(x.repo, get(x.repo, x.records["code-security-reviewer"]).invocation_reference, [VER2]);
  edit(x.repo, "docs/delivery/findings.json", (d) => Object.assign(d.findings[0], { status: "OPEN", verification: null }));
  commit(x.repo, "round evidence");
  expectError(validateGate(x.repo, "DG0"), /unresolved \(OPEN\)/);
  put(x.repo, SIDE1, { findings: [] });
  bindOutputs(x.repo, get(x.repo, REC1).invocation_reference, [SIDE1]);
  edit(x.repo, REC1, (r) => { r.findings = []; r.verdict = "PASS"; });
  bindOutputs(x.repo, get(x.repo, REC1).invocation_reference, [REC1]);
  edit(x.repo, "docs/delivery/findings.json", (d) => (d.findings = []));
  backdatedSideMerge(x);
  const e = validateGate(x.repo, "DG0");
  assert.deepEqual(e, [], "expected the gate to (wrongly) pass:\n" + e.join("\n"));
});

// ---------------- F-DG0-119 / F-DG0-121 (validator side) ----------------
test("FIXED F-DG0-119 (validator side): outputs without a matching tool_authored digest are rejected", () => {
  const x = buildValidRepo();
  const ref = get(x.repo, x.records["qa-verifier"]).invocation_reference;
  edit(x.repo, `docs/delivery/runs/DG0/${ref.run_id}/meta.json`, (m) => { delete m.tool_authored[x.records["qa-verifier"]]; });
  expectError(validateGate(x.repo, "DG0"), /qa-verifier\.json was not written by this run's file tools/);
  const y = buildValidRepo();
  const r2 = get(y.repo, y.records["qa-verifier"]).invocation_reference;
  edit(y.repo, `docs/delivery/runs/DG0/${r2.run_id}/meta.json`, (m) => { m.tool_authored[y.records["qa-verifier"]] = "a".repeat(64); });
  expectError(validateGate(y.repo, "DG0"), /does not equal the content of this run's own Write\/Edit calls/);
});

test("FIXED F-DG0-121: editing the gate record's tests[] after the auditor wrote it is rejected", () => {
  const x = buildValidRepo();
  edit(x.repo, GATE, (g) => {
    g.tests = [{ name: "forged: full regression suite", command: "never run", result: "PASS", evidence: ["docs/delivery/test-evidence/DG0/validator.txt"] }];
    g.decided_at = "2026-09-28T23:59:59Z";
  });
  expectError(validateGate(x.repo, "DG0"), /gates\/DG0\.json differs from what the run wrote/);
  // and a gate file the auditor run never wrote is rejected
  const y = buildValidRepo();
  const au = get(y.repo, y.records["release-auditor"]).invocation_reference;
  edit(y.repo, `docs/delivery/runs/DG0/${au.run_id}/meta.json`, (m) => { delete m.tool_authored[GATE]; delete m.outputs[GATE]; });
  const e = validateGate(y.repo, "DG0");
  expectError(e, /gates\/DG0\.json/);
});

// ---------------- re-confirmation of earlier findings ----------------
test("FIXED F-DG0-102: a 4-field meta without transcript/result, or a mismatched transcript, is rejected", () => {
  const x = buildValidRepo();
  const ref = get(x.repo, x.records["domain-reviewer"]).invocation_reference;
  const dir = `docs/delivery/runs/DG0/${ref.run_id}`;
  put(x.repo, `${dir}/meta.json`, { run_id: ref.run_id, role: "domain-reviewer", stage: "DG0", invocation_reference: ref });
  rmSync(join(x.repo, `${dir}/transcript.jsonl.gz`));
  const e = validateGate(x.repo, "DG0");
  expectError(e, /missing transcript|did not complete|result_session_id/);
  const y = buildValidRepo();
  const r2 = get(y.repo, y.records["domain-reviewer"]).invocation_reference;
  put(y.repo, `docs/delivery/runs/DG0/${r2.run_id}/transcript.jsonl.gz`, gzipSync(Buffer.from("{}\n")));
  expectError(validateGate(y.repo, "DG0"), /transcript\.jsonl\.gz does not match meta/);
});

test("FIXED F-DG0-102 residual: a verifying record without assignment cannot close a finding; unlisted records rejected", () => {
  const x = buildValidRepo();
  edit(x.repo, x.records["code-security-reviewer"], (r) => delete r.assignment);
  expectError(validateGate(x.repo, "DG0"), /not a valid review record|names no assignment|assignment/);
  const y = buildValidRepo();
  edit(y.repo, "docs/delivery/stages.json", (d) => delete d.stages[0].review_rounds[1].records["code-security-reviewer"]);
  expectError(validateGate(y.repo, "DG0"), /not listed in stages\.json review_rounds/);
});

test("FIXED F-DG0-101: relabel to DG1, drop, or deleting round 1 is rejected", () => {
  const a = buildValidRepo();
  edit(a.repo, "docs/delivery/findings.json", (d) => Object.assign(d.findings[0], { stage_id: "DG1", status: "OPEN" }));
  expectError(validateGate(a.repo, "DG0"), /relabelled to DG1/);
  const b = buildValidRepo();
  edit(b.repo, "docs/delivery/findings.json", (d) => (d.findings = []));
  expectError(validateGate(b.repo, "DG0"), /dropped/);
  const c = buildValidRepo();
  commit(c.repo, "evidence");
  sh(c.repo, "rm", "-rq", "docs/delivery/reviews/DG0/round-1");
  edit(c.repo, "docs/delivery/findings.json", (d) => (d.findings = []));
  edit(c.repo, "docs/delivery/stages.json", (d) => d.stages[0].review_rounds.shift());
  commit(c.repo, "hide round 1");
  expectError(validateGate(c.repo, "DG0"), /write-once: docs\/delivery\/reviews\/DG0\/round-1\/.* was removed/);
});

test("FIXED F-DG0-110: CLOSED_VERIFIED vs latest FAIL sidecar, foreign fix_revision, '#' evidence all rejected", () => {
  const a = buildValidRepo();
  put(a.repo, VER2, { verifications: [{ finding_id: "F-DG0-101", result: "FAIL", status_after: "OPEN", note: "no", evidence: [] }] });
  bindOutputs(a.repo, get(a.repo, a.records["code-security-reviewer"]).invocation_reference, [VER2]);
  expectError(validateGate(a.repo, "DG0"), /latest reviewer verification .* is FAIL/);
  const b = buildValidRepo();
  edit(b.repo, "docs/delivery/findings.json", (d) => (d.findings[0].fix_revision = "f".repeat(40)));
  expectError(validateGate(b.repo, "DG0"), /is not in the verified round-2 candidate/);
  const c = buildValidRepo();
  put(c.repo, VER2, { verifications: [{ finding_id: "F-DG0-101", result: "PASS", status_after: "CLOSED_VERIFIED", note: "fixed", evidence: ["#"] }] });
  bindOutputs(c.repo, get(c.repo, c.records["code-security-reviewer"]).invocation_reference, [VER2]);
  edit(c.repo, "docs/delivery/findings.json", (d) => (d.findings[0].verification.evidence = ["#"]));
  expectError(validateGate(c.repo, "DG0"), /verification evidence is not an existing repository file/);
});

test("FIXED F-DG0-117: ACCEPTED_OBSERVATION typed only into findings.json is rejected", () => {
  const x = buildValidRepo();
  edit(x.repo, SIDE1, (s) => Object.assign(s.findings[0], { severity: "Low", mandatory_violation: false }));
  bindOutputs(x.repo, get(x.repo, REC1).invocation_reference, [SIDE1]);
  edit(x.repo, "docs/delivery/findings.json", (d) => Object.assign(d.findings[0], {
    severity: "Low", mandatory_violation: false, status: "ACCEPTED_OBSERVATION", verification: null,
    acceptance: { rationale: "cosmetic only, tracked", owner: "delivery-orchestrator", accepted_by: ["code-security-reviewer", "release-auditor"] },
  }));
  editGate(x.repo, (g) => (g.accepted_observations = ["F-DG0-101"]));
  put(x.repo, VER2, { verifications: [] });
  bindOutputs(x.repo, get(x.repo, x.records["code-security-reviewer"]).invocation_reference, [VER2]);
  const e = validateGate(x.repo, "DG0");
  expectError(e, /no release-auditor sidecar accepts it/);
  expectError(e, /no specialist reviewer sidecar accepts it/);
});

test("FIXED F-DG0-103/F-DG0-112: symlink repoint, exec bit and file/symlink swap change the committed candidate; gitlinks refused", () => {
  const repo = mkdtempSync(join(tmpdir(), "cand5-"));
  fixtures.push(repo);
  sh(repo, "init", "-q", "-b", "main");
  put(repo, "a.txt", "a\n"); put(repo, "b.txt", "b\n");
  symlinkSync("a.txt", join(repo, "l"));
  const spec = { include: ["**"], exclude: ["trading_agent/**"] };
  const c = (m) => { sh(repo, "-c", "user.email=t@e", "-c", "user.name=t", "add", "-A"); sh(repo, "-c", "user.email=t@e", "-c", "user.name=t", "commit", "-qm", m); return candidateId(manifestFromRef(repo, "HEAD", spec)); };
  const id0 = c("0");
  unlinkSync(join(repo, "l")); symlinkSync("b.txt", join(repo, "l"));
  const id1 = c("1"); assert.notEqual(id1, id0);
  sh(repo, "update-index", "--chmod=+x", "a.txt"); sh(repo, "-c", "user.email=t@e", "-c", "user.name=t", "commit", "-qm", "x");
  const id2 = candidateId(manifestFromRef(repo, "HEAD", spec)); assert.notEqual(id2, id1);
  unlinkSync(join(repo, "l")); put(repo, "l", "b.txt");
  const id3 = c("swap"); assert.notEqual(id3, id2);
  sh(repo, "update-index", "--add", "--cacheinfo", "160000", "a".repeat(40), "vendor/sub");
  assert.throws(() => manifestFromWorkingTree(repo, spec), /gitlink/);
  assert.throws(() => manifestFromRef(repo, sh(repo, "write-tree"), spec), /gitlink|submodule|160000/);
});

test("FIXED F-DG0-104: an extra exclude in the frozen manifest spec, or in stages.json, is rejected", () => {
  const a = buildValidRepo();
  edit(a.repo, get(a.repo, GATE).manifest_path, (m) => (m.spec = { include: ["**"], exclude: ["trading_agent/**", "src/**"] }));
  expectError(validateGate(a.repo, "DG0"), /spec differs from the stage's candidate_spec|exclude must be|does not/);
  const b = buildValidRepo();
  edit(b.repo, "docs/delivery/stages.json", (d) => (d.stages[0].candidate_spec = { include: ["**"], exclude: ["trading_agent/**", "src/**"] }));
  expectError(validateGate(b.repo, "DG0"), /candidate_spec/);
});

test("FIXED F-DG0-106: '#', '.', a directory and a bare token are not evidence; empty gate tests[] rejected", () => {
  for (const ev of ["#", ".", "docs", "validator", "docs/delivery/test-evidence/DG0/validator.txt/.."]) {
    const a = buildValidRepo();
    editGate(a.repo, (g) => (g.tests[0].evidence = [ev]));
    expectError(validateGate(a.repo, "DG0"), /not an existing repository file/);
  }
  const b = buildValidRepo();
  editGate(b.repo, (g) => (g.tests = []));
  expectError(validateGate(b.repo, "DG0"), /tests: fewer than 1 items/);
});

test("FIXED F-DG0-107: malformed CSV throws (text after quote, ragged rows, stray quote, unterminated)", () => {
  assert.throws(() => parseCsv('a,b\n"x"y,z\n'));
  assert.throws(() => parseCsv("a,b\n1,2,3\n"));
  assert.throws(() => parseCsv("a,b\n1\n"));
  assert.throws(() => parseCsv('a,b\nx"y,z\n'));
  assert.throws(() => parseCsv('a,b\n"x,z\n'));
});

test("FIXED F-DG0-116: core.fileMode=false takes tracked modes from the index", () => {
  const repo = mkdtempSync(join(tmpdir(), "cand-fm5-"));
  fixtures.push(repo);
  sh(repo, "init", "-q", "-b", "main");
  put(repo, "run.sh", "echo hi\n");
  execFileSync("chmod", ["+x", join(repo, "run.sh")]);
  put(repo, "plain.txt", "x\n");
  sh(repo, "-c", "user.email=t@e", "-c", "user.name=t", "add", "-A");
  sh(repo, "-c", "user.email=t@e", "-c", "user.name=t", "commit", "-qm", "c");
  const spec = { include: ["**"], exclude: ["trading_agent/**"] };
  const committed = candidateId(manifestFromRef(repo, "HEAD", spec));
  sh(repo, "config", "core.fileMode", "false");
  execFileSync("chmod", ["-x", join(repo, "run.sh")]);
  execFileSync("chmod", ["+x", join(repo, "plain.txt")]);
  assert.equal(candidateId(manifestFromWorkingTree(repo, spec)), committed);
  sh(repo, "config", "core.fileMode", "true");
  assert.notEqual(candidateId(manifestFromWorkingTree(repo, spec)), committed);
});

test("FIXED F-DG0-212-adjacent: a fabricated round manifest that does not describe its source_commit is rejected", () => {
  const { repo, head } = buildValidRepo();
  const fake = [{ path: "src/app.txt", sha256: "1".repeat(64), mode: "100644" }];
  const fakeId = candidateId(fake);
  put(repo, `docs/delivery/candidates/DG0/${fakeId.slice(7, 23)}.manifest.json`, { stage_id: "DG0", candidate_id: fakeId, hash_algorithm: "mth-candidate-v2", source_commit: head, frozen_at: "2026-09-28T10:00:00Z", spec: { include: ["**"], exclude: ["trading_agent/**"] }, entries: fake });
  edit(repo, "docs/delivery/stages.json", (d) => d.stages[0].review_rounds.push({ round: 3, candidate_id: fakeId, frozen_at: "2026-09-28T10:00:00Z", source_commit: head, records: {} }));
  expectError(validateGate(repo, "DG0"), /does not describe its source_commit/);
});
