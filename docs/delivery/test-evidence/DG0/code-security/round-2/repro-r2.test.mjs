// DG0 round-2 code-security reproduction (code-security-reviewer, T-DG0-REV-SEC-R2). NOT part of any candidate.
// Helpers and buildValidRepo() are copied verbatim from the candidate's tools/gates/tests/validator.test.mjs
// (commit 83860be3), with imports redirected to GATE_TOOLS (a disposable worktree of the commit under test).
// Convention: a test named "BYPASS ..." PASSES when the weakness is PRESENT (validator/guard accepts the attack).
//             a test named "FIXED ..."  PASSES when the round-1 weakness is ABSENT (the fix works).
// Run: GATE_TOOLS=/tmp/dg0-sec-r2 node --test docs/delivery/test-evidence/DG0/code-security/round-2/repro-r2.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { chmodSync } from "node:fs";
const TOOLS = process.env.GATE_TOOLS; if (!TOOLS) throw new Error("set GATE_TOOLS");
const imp = (rel) => import(pathToFileURL(join(TOOLS, rel)).href);
const { candidateId, manifestFromRef, manifestFromWorkingTree } = await imp("tools/gates/lib/candidate.mjs");
const { validateGate, validatePipeline, reconcile, REGISTER_COLUMNS, STAGE_ORDER } = await imp("tools/gates/lib/rules.mjs");
const { decide } = await imp("tools/agents/guard-write.mjs");
const { parseCsv } = await imp("tools/gates/lib/csv.mjs");

const T_FREEZE = "2026-09-28T12:00:00Z";
const T_RUN = "2026-09-28T12:30:00Z";
const ROLES = ["domain-reviewer", "code-security-reviewer", "qa-verifier", "release-auditor"];
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
  put(repo, "docs/delivery/findings.json", {
    schema_version: 1,
    findings: [{
      ...finding, status: "CLOSED_VERIFIED", fix_revision: head,
      verification: { by_role: "code-security-reviewer", invocation_reference: csRec.invocation_reference, at: T_RUN, result: "PASS", evidence: [] },
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

// ======================= round-1 findings: re-verification (single mutation on a valid gate) =======================
test("baseline: the copied fixture is a valid DG0 gate for the code under test", () => {
  const { repo } = buildValidRepo();
  assert.deepEqual(validateGate(repo, "DG0"), []);
});

test("FIXED F-DG0-101: relabelled, sidecar-relabelled or dropped findings are rejected", () => {
  const a = buildValidRepo();
  edit(a.repo, "docs/delivery/findings.json", (d) => Object.assign(d.findings[0], { stage_id: "DG1", status: "OPEN" }));
  expectError(validateGate(a.repo, "DG0"), /relabelled to DG1/);
  const b = buildValidRepo();
  edit(b.repo, "docs/delivery/findings.json", (d) => (d.findings = []));
  expectError(validateGate(b.repo, "DG0"), /dropped/);
  const c = buildValidRepo(); // OPEN finding kept but only its status changed
  edit(c.repo, "docs/delivery/findings.json", (d) => (d.findings[0].status = "OPEN"));
  expectError(validateGate(c.repo, "DG0"), /unresolved \(OPEN\)/);
});

test("FIXED F-DG0-102: a run without transcript/result, or with a forged hash, is rejected", () => {
  const a = buildValidRepo();
  const ref = get(a.repo, a.records["qa-verifier"]).invocation_reference;
  unlinkSync(join(a.repo, `docs/delivery/runs/DG0/${ref.run_id}/result.json`));
  expectError(validateGate(a.repo, "DG0"), /missing result\.json/);
  const b = buildValidRepo();
  const bref = get(b.repo, b.records["qa-verifier"]).invocation_reference;
  edit(b.repo, `docs/delivery/runs/DG0/${bref.run_id}/meta.json`, (m) => (m.stage = "DG1"));
  expectError(validateGate(b.repo, "DG0"), /belongs to stage DG1/);
});

test("FIXED F-DG0-103: a committed symlink repointed after freeze changes the candidate", () => {
  const { repo } = buildValidRepo();
  symlinkSync("app.txt", join(repo, "src/entry.txt"));
  const spec = { include: ["**"], exclude: ["trading_agent/**"] };
  const before = candidateId(manifestFromWorkingTree(repo, spec));
  unlinkSync(join(repo, "src/entry.txt"));
  symlinkSync("../docs/delivery/test-evidence/DG0/validator.txt", join(repo, "src/entry.txt"));
  assert.notEqual(candidateId(manifestFromWorkingTree(repo, spec)), before);
});

test("FIXED F-DG0-104: an extra exclude in the frozen manifest is rejected", () => {
  const { repo } = buildValidRepo();
  edit(repo, "docs/delivery/candidates/DG0.manifest.json", (m) => (m.spec.exclude = ["trading_agent/**", "src/**"]));
  expectError(validateGate(repo, "DG0"), /spec differs from the stage's candidate_spec/);
});

test("FIXED F-DG0-106: '#', '.', a directory and a bare token are not accepted as evidence; empty tests[] rejected", () => {
  for (const ev of ["#x", ".", "docs", "done"]) {
    const { repo, records } = buildValidRepo();
    edit(repo, records["qa-verifier"], (r) => (r.evidence_paths = [ev]));
    expectError(validateGate(repo, "DG0"), /evidence path is not an existing repository file/);
  }
  const { repo } = buildValidRepo();
  edit(repo, "docs/delivery/gates/DG0.json", (g) => (g.tests = []));
  expectError(validateGate(repo, "DG0"), /fewer than 1 items/);
});

test("FIXED F-DG0-107: CSV text after a closing quote and ragged rows throw", () => {
  assert.throws(() => parseCsv('a,b\n"x"y,z\n'), /after closing quote/);
  assert.throws(() => parseCsv("a,b\n1,2,3\n"), /has 3 fields/);
  assert.throws(() => parseCsv("a,b\n1\n"), /has 1 fields/);
});

test("FIXED F-DG0-105: symlink, case and config-surface bypasses of the write guard are blocked", () => {
  const scopes = JSON.parse(readFileSync(join(TOOLS, "tools/agents/write-scopes.json"), "utf8"));
  const repo = mkdtempSync(join(tmpdir(), "guard-")); fixtures.push(repo);
  sh(repo, "init", "-q");
  mkdirSync(join(repo, "tools/gates/lib"), { recursive: true });
  mkdirSync(join(repo, "docs/analysis"), { recursive: true });
  symlinkSync("../../tools/gates", join(repo, "docs/analysis/lnk"));
  assert.equal(decide(scopes, "transformation-analyst", join(repo, "docs/analysis/lnk/lib/rules.mjs")).allow, false);
  for (const rel of [".claude/settings.local.json", ".mcp.json", "trading_agent/x.py", "Tools/Gates/x.mjs", "sub/.claude/hooks/h.sh", "CLAUDE.md"]) {
    assert.equal(decide(scopes, "backend-workflow-engineer", join(repo, rel)).allow, false, rel);
  }
});

// ======================= round-2 attack attempts =======================
test("BYPASS N1a: a finding is CLOSED_VERIFIED by citing a pre-freeze, unrelated run of the reporter role (e.g. the LOAD check)", () => {
  const { repo } = buildValidRepo();
  put(repo, "docs/delivery/assignments/DG0/T-DG0-LOAD.md", "load check\n");
  const loadRef = makeRun(repo, "code-security-reviewer", { assignment: "docs/delivery/assignments/DG0/T-DG0-LOAD.md", task: "T-DG0-LOAD", startedAt: "2026-09-28T11:00:00Z" });
  edit(repo, "docs/delivery/findings.json", (d) => (d.findings[0].verification.invocation_reference = loadRef));
  assert.deepEqual(validateGate(repo, "DG0"), [], "validator accepts a verification bound to a run that pre-dates the candidate and the fix");
});

test("BYPASS N1b: the reporter's own verification sidecar says FAIL/OPEN, findings.json says CLOSED_VERIFIED; the gate passes", () => {
  const { repo } = buildValidRepo();
  put(repo, "docs/delivery/reviews/DG0/round-2/code-security-reviewer.verifications.json", {
    verifications: [{ finding_id: "F-DG0-101", result: "FAIL", status_after: "OPEN", note: "fix incomplete", evidence: [] }],
  });
  assert.deepEqual(validateGate(repo, "DG0"), [], "reviewer-authored FAIL verification is ignored; orchestrator-authored findings.json wins");
});

test("BYPASS N1c: verification evidence paths and the fix_revision are never checked", () => {
  const { repo } = buildValidRepo();
  edit(repo, "docs/delivery/findings.json", (d) => {
    d.findings[0].fix_revision = "not-a-commit";
    d.findings[0].verification.evidence = ["does/not/exist.log"];
  });
  assert.deepEqual(validateGate(repo, "DG0"), []);
});

test("BYPASS N2: deleting a whole earlier review round (record + sidecar) and its findings passes, even when stages.json lists the round", () => {
  const { repo, cid } = buildValidRepo();
  edit(repo, "docs/delivery/stages.json", (d) => (d.stages[0].review_rounds = [
    { round: 1, candidate_id: cid, records: { "code-security-reviewer": "docs/delivery/reviews/DG0/round-1/code-security-reviewer.json" } },
  ]));
  assert.deepEqual(validateGate(repo, "DG0"), [], "sanity: still valid with the round listed");
  rmSync(join(repo, "docs/delivery/reviews/DG0/round-1"), { recursive: true, force: true });
  edit(repo, "docs/delivery/findings.json", (d) => (d.findings = []));
  assert.deepEqual(validateGate(repo, "DG0"), [], "High mandatory finding from round 1 vanished without any error");
  approveAndCommit(repo);
  assert.deepEqual(validateGate(repo, "DG0", { mode: "historical" }), [], "historical mode accepts it too");
  assert.deepEqual(validatePipeline(repo).errors, []);
});

test("BYPASS N3: an implementer (allow **) plants tools/.git (or docs/.git) and then writes protected gate files", () => {
  const scopes = JSON.parse(readFileSync(join(TOOLS, "tools/agents/write-scopes.json"), "utf8"));
  const repo = mkdtempSync(join(tmpdir(), "guard-")); fixtures.push(repo);
  sh(repo, "init", "-q");
  const targets = ["tools/gates/lib/rules.mjs", "tools/agents/write-scopes.json", "docs/delivery/stages.json", "docs/source/playbook.md", ".github/workflows/delivery-gates.yml"];
  for (const t of targets) assert.equal(decide(scopes, "solution-architect", join(repo, t)).allow, false, `baseline denies ${t}`);
  for (const plant of ["tools/.git", "docs/.git", ".github/.git"]) {
    assert.equal(decide(scopes, "solution-architect", join(repo, plant)).allow, true, `may Write ${plant}`);
    put(repo, plant, "gitdir: /nonexistent\n");
  }
  for (const t of targets) assert.equal(decide(scopes, "solution-architect", join(repo, t)).allow, true, `after planting, ${t} is ALLOWED`);
  // End-to-end through the real hook entry point: exit 0 means Claude Code proceeds with the Write.
  const r = execFileSync("node", [join(TOOLS, "tools/agents/guard-write.mjs"), "solution-architect"], {
    input: JSON.stringify({ tool_name: "Write", tool_input: { file_path: join(repo, "tools/gates/lib/rules.mjs"), content: "x" } }),
    stdio: ["pipe", "pipe", "pipe"],
  });
  assert.equal(r.toString(), "");
});

test("BYPASS N4 (Low): a regular file whose content is 'symlink:<t>' has the same manifest hash as a symlink to <t>", () => {
  const spec = { include: ["**"], exclude: ["trading_agent/**"] };
  const a = mkdtempSync(join(tmpdir(), "cand-")); fixtures.push(a); sh(a, "init", "-q");
  const b = mkdtempSync(join(tmpdir(), "cand-")); fixtures.push(b); sh(b, "init", "-q");
  put(a, "app.txt", "x\n"); put(b, "app.txt", "x\n");
  symlinkSync("app.txt", join(a, "entry"));
  put(b, "entry", "symlink:app.txt");
  assert.equal(candidateId(manifestFromWorkingTree(a, spec)), candidateId(manifestFromWorkingTree(b, spec)));
});

test("BYPASS N5 (Low): the executable bit is not part of the candidate identity", () => {
  const spec = { include: ["**"], exclude: ["trading_agent/**"] };
  const a = mkdtempSync(join(tmpdir(), "cand-")); fixtures.push(a); sh(a, "init", "-q");
  put(a, "run.sh", "#!/bin/sh\necho hi\n");
  chmodSync(join(a, "run.sh"), 0o755);
  const before = candidateId(manifestFromWorkingTree(a, spec));
  chmodSync(join(a, "run.sh"), 0o644);
  assert.equal(candidateId(manifestFromWorkingTree(a, spec)), before);
});

test("N6 (Low, platform): with core.autocrlf=true the working-tree candidate differs from the committed one (fails closed)", () => {
  const spec = { include: ["**"], exclude: ["trading_agent/**"] };
  const a = mkdtempSync(join(tmpdir(), "cand-")); fixtures.push(a); sh(a, "init", "-q");
  put(a, "f.txt", "one\ntwo\n");
  sh(a, "-c", "user.email=t@e", "-c", "user.name=t", "add", "-A");
  sh(a, "-c", "user.email=t@e", "-c", "user.name=t", "commit", "-qm", "c");
  sh(a, "config", "core.autocrlf", "true");
  unlinkSync(join(a, "f.txt"));
  sh(a, "checkout", "--", "f.txt");
  assert.ok(readFileSync(join(a, "f.txt"), "utf8").includes("\r\n"), "checkout produced CRLF");
  assert.notEqual(candidateId(manifestFromWorkingTree(a, spec)), candidateId(manifestFromRef(a, "HEAD", spec)));
});
