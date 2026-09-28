// DG0 round-8 code-security reproduction (code-security-reviewer, T-DG0-REV-SEC-R8). NOT part of any candidate.
// Lines between the markers are copied verbatim from the candidate's tools/gates/tests/validator.test.mjs
// (commit d6626258, lines 15-238: helpers, makeRun, bindOutputs, buildValidRepo, approveAndCommit, edit, editGate, expectError),
// with imports redirected to GATE_TOOLS.
// Convention: "FIXED ..." tests PASS when the weakness is ABSENT; "BYPASS ..." tests PASS when the weakness is PRESENT;
// "PROBE ..." tests document behaviour (assertion states what was observed).
// Run: GATE_TOOLS=/tmp/dg0-sec8 node --test docs/delivery/test-evidence/DG0/code-security/round-8/repro-r8.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, unlinkSync, existsSync } from "node:fs";
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
const RUN_CWD = "/work/repo"; // the absolute working directory recorded for fixture runs
/** Writes a realistic run directory: meta + result + gzipped stream transcript, with hashes, like run-agent.sh. */
function makeRun(repo, role, { assignment, startedAt = T_RUN, task = "T-REV", stage = "DG0" } = {}) {
  counter++;
  const session_id = `${String(counter).padStart(8, "0")}-1111-4111-8111-111111111111`;
  const run_id = `${stage}-${task}-${role}-20260928T123000Z-${session_id.slice(0, 8)}`;
  const base = `docs/delivery/runs/${stage}/${run_id}`;
  const lines = [
    { type: "system", subtype: "init", session_id, model: "claude-opus-5-5", tools: ["Read", "Bash", "Write"] },
    { type: "user", isReplay: true, message: { role: "user", content: `You are invoked as project agent '${role}' for stage ${stage}, task ${task}. Your invocation_reference is: {"kind":"claude-code-cli-session","run_id":"${run_id}","session_id":"${session_id}"}. Your complete assignment is in the file ${RUN_CWD}/${assignment} (sha256 ${sha(readFileSync(join(repo, assignment)))}). Read it first.` }, session_id },
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
    started_at: startedAt, exit_code: 0, is_error: false, result_session_id: session_id, head_commit_at_start: freezeCommit, cwd: RUN_CWD,
    result_sha256: sha(result), transcript_sha256: sha(transcript),
  });
  return invocation_reference;
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
// ---- marker: verbatim copy ends ----

// ================= round-8 reviewer tests (independent of the candidate's own tests) =================
const runBase = (ref) => `docs/delivery/runs/DG0/${ref.run_id}`;
function readLines(repo, ref) {
  return gunzipSync(readFileSync(join(repo, `${runBase(ref)}/transcript.jsonl.gz`))).toString("utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
/** Replace a run's transcript with raw bytes (already gzipped) and re-hash it in meta, as a forger would. */
function setTranscriptGz(repo, ref, gz) {
  put(repo, `${runBase(ref)}/transcript.jsonl.gz`, gz);
  edit(repo, `${runBase(ref)}/meta.json`, (m) => (m.transcript_sha256 = sha(gz)));
}
const setTranscriptLines = (repo, ref, lines) => setTranscriptGz(repo, ref, gzipSync(Buffer.from(lines.map((o) => JSON.stringify(o)).join("\n") + "\n")));
const refOf = (repo, rel) => get(repo, rel).invocation_reference;

test("R8-00 control: the verbatim fixture is a valid DG0 gate (current + historical)", () => {
  const { repo } = buildValidRepo();
  assert.deepEqual(validateGate(repo, "DG0"), []);
  approveAndCommit(repo);
  assert.deepEqual(validateGate(repo, "DG0", { mode: "historical" }), []);
});

for (const [name, body] of [["gzip('')", ""], ["gzip('\\n\\n\\n')", "\n\n\n"], ["gzip(' \\n')", " \n"]]) {
  test(`R8-01 FIXED F-DG0-132 (r7 tests 3/4): an empty transcript ${name} on a reviewer run is rejected`, () => {
    const { repo, records } = buildValidRepo();
    setTranscriptGz(repo, refOf(repo, records["domain-reviewer"]), gzipSync(Buffer.from(body)));
    const errs = validateGate(repo, "DG0");
    assert.ok(errs.length > 0, "empty transcript accepted");
    console.log(`R8-01 ${name}: ${errs.length} errors; first: ${errs[0]}`);
  });
}

test("R8-02 FIXED: a transcript of unparsable lines only is rejected", () => {
  const { repo, records } = buildValidRepo();
  setTranscriptGz(repo, refOf(repo, records["domain-reviewer"]), gzipSync(Buffer.from("not json\nstill not\n")));
  expectError(validateGate(repo, "DG0"), /no init line/);
});

test("R8-03 FIXED F-DG0-132 (r7 test 5): a record rewritten after its run, with meta re-pointed and transcript emptied, is rejected", () => {
  const { repo, records } = buildValidRepo();
  const rel = records["qa-verifier"];
  const ref = refOf(repo, rel);
  edit(repo, rel, (r) => (r.checks_run[0].actual = "FORGED after the run"));
  edit(repo, `${runBase(ref)}/meta.json`, (m) => { m.outputs[rel] = m.tool_authored[rel] = sha(readFileSync(join(repo, rel))); });
  setTranscriptGz(repo, ref, gzipSync(Buffer.from("")));
  const errs = validateGate(repo, "DG0");
  expectError(errs, /cannot be reconstructed from this run's own successful Write\/Edit calls/);
  console.log("R8-03 errors:\n" + errs.filter((e) => e.includes(ref.run_id)).join("\n"));
});

test("R8-04 FIXED F-DG0-132 (r7 test 6): a verifying run with an empty transcript cannot close High F-DG0-101", () => {
  const { repo, records } = buildValidRepo();
  setTranscriptGz(repo, refOf(repo, records["code-security-reviewer"]), gzipSync(Buffer.from("")));
  const errs = validateGate(repo, "DG0");
  expectError(errs, /verification.*transcript is empty|transcript is empty/);
  assert.ok(errs.some((e) => /F-DG0-101/.test(e) && /transcript/.test(e)), "closure of F-DG0-101 not rejected:\n" + errs.join("\n"));
});

test("R8-05 FIXED F-DG0-132 (r7 test 7): the same forgery committed and approved fails historical validation", () => {
  const { repo, records } = buildValidRepo();
  for (const role of ROLES) setTranscriptGz(repo, refOf(repo, records[role]), gzipSync(Buffer.from("\n")));
  approveAndCommit(repo);
  const errs = validateGate(repo, "DG0", { mode: "historical" });
  assert.ok(errs.length > 0);
  expectError(errs, /transcript is empty/);
  assert.ok(validatePipeline(repo).errors.length > 0, "pipeline accepted the forged approval");
});

test("R8-06 FIXED F-DG0-102 (original r1 R0 shape): a hand-written meta with no transcript/result is rejected", () => {
  const { repo, records } = buildValidRepo();
  const ref = refOf(repo, records["qa-verifier"]);
  const m = get(repo, `${runBase(ref)}/meta.json`);
  unlinkSync(join(repo, `${runBase(ref)}/transcript.jsonl.gz`));
  unlinkSync(join(repo, `${runBase(ref)}/result.json`));
  delete m.transcript_sha256; delete m.result_sha256;
  put(repo, `${runBase(ref)}/meta.json`, m);
  const errs = validateGate(repo, "DG0");
  expectError(errs, /missing transcript\.jsonl\.gz/);
  expectError(errs, /missing result\.json/);
  expectError(errs, /transcript is empty/);
  expectError(errs, /no init line/);
});

test("R8-07 FIXED: init present but no successful final result for the session is rejected", () => {
  const { repo, records } = buildValidRepo();
  const ref = refOf(repo, records["qa-verifier"]);
  const lines = readLines(repo, ref);
  lines.push({ type: "result", subtype: "error_during_execution", is_error: true, session_id: ref.session_id });
  setTranscriptLines(repo, ref, lines);
  expectError(validateGate(repo, "DG0"), /does not end in a successful result/);
});

// ---- F-DG0-133 ----
function rewritePrompt(repo, ref, fn) {
  const lines = readLines(repo, ref);
  const p = lines.find((o) => o.isReplay);
  p.message.content = fn(p.message.content);
  setTranscriptLines(repo, ref, lines);
}
test("R8-10 FIXED F-DG0-133 (r7 test 8): a prompt naming another assignment path and sha is rejected", () => {
  const { repo, records } = buildValidRepo();
  const ref = refOf(repo, records["qa-verifier"]);
  rewritePrompt(repo, ref, (c) => c.replace(/in the file \S+ \(sha256 [0-9a-f]{64}\)/, `in the file ${RUN_CWD}/docs/delivery/assignments/DG0/round-9/some-other.md (sha256 ${"0".repeat(64)})`));
  expectError(validateGate(repo, "DG0"), /the replayed prompt names assignment/);
});
test("R8-11 FIXED F-DG0-133: right path but wrong sha in the prompt is rejected", () => {
  const { repo, records } = buildValidRepo();
  const ref = refOf(repo, records["qa-verifier"]);
  rewritePrompt(repo, ref, (c) => c.replace(/\(sha256 [0-9a-f]{64}\)/, `(sha256 ${"a".repeat(64)})`));
  expectError(validateGate(repo, "DG0"), /the replayed prompt names assignment/);
});
test("R8-12 FIXED F-DG0-133: right sha but a different assignment file name is rejected", () => {
  const { repo, records } = buildValidRepo();
  const ref = refOf(repo, records["qa-verifier"]);
  rewritePrompt(repo, ref, (c) => c.replace(/in the file (\S+)\/qa-verifier\.md/, "in the file $1/domain-reviewer.md"));
  expectError(validateGate(repo, "DG0"), /the replayed prompt names assignment/);
});
test("R8-13 FIXED F-DG0-133: a prompt that names no assignment is rejected (old-style prompt)", () => {
  const { repo, records } = buildValidRepo();
  const ref = refOf(repo, records["qa-verifier"]);
  rewritePrompt(repo, ref, (c) => c.replace(/ Your complete assignment is in the file \S+ \(sha256 [0-9a-f]{64}\)\./, ""));
  expectError(validateGate(repo, "DG0"), /names no assignment file and sha256/);
});
test("R8-14 FIXED F-DG0-133: meta re-pointed at a different assignment (record+meta consistent) no longer matches the transcript", () => {
  const { repo, records } = buildValidRepo();
  const rel = records["qa-verifier"];
  const ref = refOf(repo, rel);
  const other = "docs/delivery/assignments/DG0/round-2/other.md";
  put(repo, other, "a different assignment\n");
  edit(repo, `${runBase(ref)}/meta.json`, (m) => { m.assignment = other; m.assignment_sha256 = sha(readFileSync(join(repo, other))); });
  // Re-point the record too, and re-bind it so only the prompt/meta mismatch remains.
  edit(repo, rel, (r) => (r.assignment = other));
  bindOutputs(repo, ref, [rel]);
  const errs = validateGate(repo, "DG0");
  expectError(errs, /the replayed prompt names assignment .*qa-verifier\.md/);
});
test("R8-15 PROBE: the prompt path is compared by suffix; a different directory prefix with the same relative path and sha is accepted", () => {
  const { repo, records } = buildValidRepo();
  const ref = refOf(repo, records["qa-verifier"]);
  rewritePrompt(repo, ref, (c) => c.replace(`in the file ${RUN_CWD}/`, "in the file /some/other/checkout/"));
  const errs = validateGate(repo, "DG0");
  console.log(`R8-15 observed: ${errs.length} errors (0 = accepted; the sha still pins the content)`);
  assert.deepEqual(errs, []);
});
test("R8-16 PROBE: a second replayed prompt later in the transcript cannot override the first", () => {
  const { repo, records } = buildValidRepo();
  const ref = refOf(repo, records["qa-verifier"]);
  const lines = readLines(repo, ref);
  const p = lines.find((o) => o.isReplay);
  const forged = JSON.parse(JSON.stringify(p));
  forged.message.content = p.message.content.replace(/in the file \S+ \(sha256 [0-9a-f]{64}\)/, `in the file ${RUN_CWD}/x.md (sha256 ${"0".repeat(64)})`);
  lines.splice(0, 0, forged); // forged one FIRST: validator uses the first match
  setTranscriptLines(repo, ref, lines);
  expectError(validateGate(repo, "DG0"), /the replayed prompt names assignment/);
});
