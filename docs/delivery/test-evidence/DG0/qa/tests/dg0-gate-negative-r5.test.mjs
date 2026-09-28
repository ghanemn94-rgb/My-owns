// Independent QA negative tests for the DG0 gate validator, round 5 (A23 independence, A24 enforced advancement,
// A25 candidate integrity), re-expressed on the round-5 rules (D-021 as revised after round 4: tool_authored binding,
// first-added-blob write-once, gate record bound to the auditor run, round manifests recomputed from source_commit,
// bound runs must start from a commit containing the round manifest).
// Author: qa-verifier, task T-DG0-REV-QA-R5. Written independently of tools/gates/tests/validator.test.mjs: every case
// builds its own disposable git fixture in the OS temp dir and removes it afterwards. Cases QA5-N* and QA5-RP* are NOT
// present in tools/gates/tests/ or tools/agents/tests/.
// Run: node --test <this file>   (QA_REPO_ROOT=<repo or worktree> selects the tooling under test)
// Intended for promotion into tests/qa/dg0/ as regression tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, unlinkSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.QA_REPO_ROOT
  ? resolve(process.env.QA_REPO_ROOT)
  : execFileSync("git", ["-C", here, "rev-parse", "--show-toplevel"]).toString().trim();
const rules = await import(pathToFileURL(join(ROOT, "tools/gates/lib/rules.mjs")).href);
const cand = await import(pathToFileURL(join(ROOT, "tools/gates/lib/candidate.mjs")).href);
const { validateGate, REGISTER_COLUMNS, STAGE_ORDER } = rules;
const { candidateId, manifestFromRef, manifestFromWorkingTree } = cand;
const VALIDATE_CLI = join(ROOT, "tools/gates/validate.mjs");
const RUNNER = join(ROOT, "tools/agents/run-agent.sh");

const T_FREEZE = "2026-09-28T13:00:00Z";
const T_RUN = "2026-09-28T13:30:00Z";
const T_BEFORE = "2026-09-28T11:00:00Z";
const MODEL = "claude-opus-5-5";
const ALL = ["domain-reviewer", "code-security-reviewer", "qa-verifier", "release-auditor"];
const SPEC = { include: ["**"], exclude: ["trading_agent/**"] };

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
const shaFile = (repo, rel) => sha(readFileSync(join(repo, rel)));
const q = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const commitAll = (repo, msg) => {
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", msg);
  return git(repo, "rev-parse", "HEAD");
};

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
 * Two-phase run in the shape tools/agents/run-agent.sh (round 5) produces. allocRun() fixes the run ID and session;
 * finish(outputs) writes transcript, result and meta with meta.outputs = sha256 of each output as it is now,
 * meta.written_by_tools and meta.tool_authored = the same paths/hashes unless overridden, and head_commit_at_start.
 */
function allocRun(repo, role, { assignment, task = "T-REV", startedAt = T_RUN, stage = "DG0", head } = {}) {
  seq += 1;
  const session_id = `${String(seq).padStart(8, "0")}-5555-4555-8555-555555555555`;
  const run_id = `${stage}-${task}-${role}-20260928T133000Z-${session_id.slice(0, 8)}`;
  const ref = { kind: "claude-code-cli-session", run_id, session_id };
  const base = `docs/delivery/runs/${stage}/${run_id}`;
  const finish = (outputs = [], { authored = outputs, metaTweak } = {}) => {
    const lines = [
      { type: "system", subtype: "init", session_id, model: MODEL, tools: ["Read", "Bash", "Write"] },
      { type: "user", message: { role: "user", content: `You are invoked as project agent '${role}' for stage ${stage}, task ${task}. Your invocation_reference is: {"run_id":"${run_id}"}` }, session_id },
      { type: "result", subtype: "success", is_error: false, session_id, result: "done" },
    ];
    const transcript = gzipSync(Buffer.from(lines.map((l) => JSON.stringify(l)).join("\n") + "\n"));
    const result = Buffer.from(JSON.stringify({ result: "done" }));
    write(repo, `${base}/transcript.jsonl.gz`, transcript);
    write(repo, `${base}/result.json`, result);
    const outs = Object.fromEntries(outputs.map((p) => [p, shaFile(repo, p)]));
    let meta = {
      run_id, role, stage, task, invocation_reference: ref, model_requested: MODEL,
      head_commit_at_start: head ?? git(repo, "rev-parse", "HEAD"),
      assignment, assignment_sha256: shaFile(repo, assignment), started_at: startedAt, exit_code: 0, is_error: false,
      result_session_id: session_id, result_sha256: sha(result), transcript_sha256: sha(transcript),
      outputs: outs, deleted: [], written_by_tools: [...outputs],
      tool_authored: Object.fromEntries(authored.map((p) => [p, outs[p]])),
    };
    if (metaTweak) meta = metaTweak(meta);
    write(repo, `${base}/meta.json`, meta);
    return ref;
  };
  return { ref, base, finish };
}

const manifestRel = (cid) => `docs/delivery/candidates/DG0/${cid.slice(7, 23)}.manifest.json`;

/**
 * A disposable repository whose DG0 gate validates cleanly under the round-5 rules: round 1 QA FAIL raising one
 * finding (F-DG0-201); round 2 all four roles PASS; QA closes (or QA + auditor accept) the finding in round-2 sidecars.
 * The manifest is committed before any run starts; every run's head_commit_at_start contains it.
 */
function fixture({ severity = "Medium", mandatory = true, accept = false } = {}) {
  const repo = mkdtempSync(join(tmpdir(), "qa5-dg0-"));
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
      implementation_owners: ["transformation-analyst", "delivery-orchestrator"], candidate_spec: SPEC,
      candidate: { candidate_id: null, source_commit: null, frozen_at: null, manifest_path: null },
      review_rounds: [], gate_record: `docs/delivery/gates/${id}.json`, history: [{ state: "PLANNED", at: T_BEFORE }],
    })),
  };
  const s0 = stages.stages[0];
  for (const st of ["BUILDING", "REVIEWING", "FIXING", "VERIFYING"]) s0.history.push({ state: st, at: T_FREEZE });
  s0.state = "VERIFYING";
  write(repo, "docs/delivery/stages.json", stages);
  const commit = commitAll(repo, "freeze");
  const entries = manifestFromRef(repo, commit, SPEC);
  const cid = candidateId(entries);
  const mrel = manifestRel(cid);
  write(repo, mrel, { stage_id: "DG0", candidate_id: cid, hash_algorithm: "mth-candidate-v2", source_commit: commit, frozen_at: T_FREEZE, spec: SPEC, entries });
  s0.candidate = { candidate_id: cid, source_commit: commit, frozen_at: T_FREEZE, manifest_path: mrel };
  const recsOf = (round, roles) => Object.fromEntries(roles.map((r) => [r, `docs/delivery/reviews/DG0/round-${round}/${r}.json`]));
  s0.review_rounds = [
    { round: 1, candidate_id: cid, frozen_at: T_FREEZE, source_commit: commit, records: recsOf(1, ["qa-verifier"]) },
    { round: 2, candidate_id: cid, frozen_at: T_FREEZE, source_commit: commit, records: recsOf(2, ALL) },
  ];
  write(repo, "docs/delivery/stages.json", stages);
  write(repo, "docs/delivery/test-evidence/DG0/run.log", "ok\n");
  for (const role of ALL) write(repo, `docs/delivery/assignments/DG0/round-2/review-${role}.md`, `assignment ${role} r2\n`);
  write(repo, "docs/delivery/assignments/DG0/round-1/review-qa-verifier.md", "assignment qa-verifier r1\n");
  const manifestCommit = commitAll(repo, "manifest + assignments (freeze metadata)");
  const recs = {};
  const refs = {};
  const record = (role, round, extra = {}, sidecars = {}) => {
    const assignment = `docs/delivery/assignments/DG0/round-${round}/review-${role}.md`;
    const run = allocRun(repo, role, { assignment, task: `T-DG0-REV-R${round}`, head: manifestCommit });
    const rel = `docs/delivery/reviews/DG0/round-${round}/${role}.json`;
    write(repo, rel, {
      schema_version: 1, stage_id: "DG0", round, candidate_id: cid, source_commit: commit, reviewer_role: role,
      invocation_reference: run.ref, implementation_author: ["transformation-analyst", "delivery-orchestrator"],
      independence_declaration: { reviewer_authored_reviewed_scope: false, statement: "no authorship in the reviewed scope" },
      assignment, requirements_checked: ["REQ-DLV-001"],
      checks_run: [{ id: "K1", procedure: "run it", command: "x", environment: "node", expected: "ok", actual: "ok", exit_status: 0, result: "PASS" }],
      findings: [], verdict: "PASS", evidence_paths: ["docs/delivery/test-evidence/DG0/run.log"], reviewed_at: T_RUN, ...extra,
    });
    const outs = [rel];
    for (const [suffix, body] of Object.entries(sidecars)) {
      const p = rel.replace(/\.json$/, `.${suffix}.json`);
      write(repo, p, body);
      outs.push(p);
    }
    return { rel, run, outs };
  };
  const raised = {
    id: "F-DG0-201", stage_id: "DG0", requirement: "REQ-DLV-001", severity, mandatory_violation: mandatory,
    title: "probe finding", reproduction: "fixture", expected: "rejected", actual: "accepted", evidence: [],
    reported_by: "qa-verifier", reported_in: "docs/delivery/reviews/DG0/round-1/qa-verifier.json", owner: "delivery-orchestrator", status: "OPEN",
  };
  const r1 = record("qa-verifier", 1, { verdict: "FAIL", findings: ["F-DG0-201"] }, { findings: { findings: [raised] } });
  refs.qa1 = r1.run.finish(r1.outs);
  const pending = [];
  const ACC = { verifications: { verifications: [{ finding_id: "F-DG0-201", result: "PASS", status_after: "ACCEPTED_OBSERVATION", note: "acceptable as an observation", evidence: [] }] } };
  for (const role of ALL) {
    const side = accept
      ? (role === "qa-verifier" || role === "release-auditor" ? ACC : {})
      : role === "qa-verifier"
        ? { verifications: { verifications: [{ finding_id: "F-DG0-201", result: "PASS", status_after: "CLOSED_VERIFIED", note: "fixed", evidence: [] }] } }
        : {};
    const r = record(role, 2, {}, side);
    recs[role] = r.rel;
    refs[role] = r.run.ref;
    pending.push(r);
  }
  write(repo, "docs/delivery/findings.json", {
    schema_version: 1,
    findings: [accept
      ? { ...raised, status: "ACCEPTED_OBSERVATION", acceptance: { rationale: "cosmetic wording only", owner: "delivery-orchestrator", accepted_by: ["qa-verifier", "release-auditor"] }, history: [{ at: T_BEFORE, status: "OPEN" }, { at: T_RUN, status: "ACCEPTED_OBSERVATION" }] }
      : {
        ...raised, status: "CLOSED_VERIFIED", fix_revision: commit,
        verification: { by_role: "qa-verifier", invocation_reference: refs["qa-verifier"], at: T_RUN, result: "PASS", evidence: [], note: "fixed" },
        acceptance: null, history: [{ at: T_BEFORE, status: "OPEN" }, { at: T_RUN, status: "CLOSED_VERIFIED" }],
      }],
  });
  const gateRel = "docs/delivery/gates/DG0.json";
  write(repo, gateRel, {
    schema_version: 1, stage_id: "DG0", decision: "APPROVED", candidate_id: cid, source_commit: commit,
    manifest_path: mrel, previous_gate: null,
    reviews: { "domain-reviewer": recs["domain-reviewer"], "code-security-reviewer": recs["code-security-reviewer"], "qa-verifier": recs["qa-verifier"] },
    release_audit: recs["release-auditor"], requirements: { final_gate_ids: ["REQ-DLV-001"] },
    tests: [{ name: "t", command: "c", result: "PASS", evidence: ["docs/delivery/test-evidence/DG0/run.log"] }],
    blocking_conditions: [], accepted_observations: accept ? ["F-DG0-201"] : [], decided_at: T_RUN, decided_by: "release-auditor",
    invocation_reference: refs["release-auditor"],
  });
  const runs = {};
  for (const r of pending) runs[r.rel] = r;
  for (const r of pending) r.run.finish(r.rel === recs["release-auditor"] ? [...r.outs, gateRel] : r.outs);
  commitAll(repo, "round evidence (auto-committed by the runner)");
  return { repo, cid, commit, manifestCommit, recs, refs, mrel, gateRel };
}

function rejects(errors, re) {
  assert.ok(errors.length > 0, "validator accepted an invalid gate (no errors)");
  assert.ok(errors.some((e) => re.test(e)), `expected an error matching ${re}; got:\n  ${errors.join("\n  ")}`);
}
function withFixture(fn, opts) {
  const f = fixture(opts);
  try {
    return fn(f);
  } finally {
    rmSync(f.repo, { recursive: true, force: true });
  }
}
const metaOf = (f, role) => `docs/delivery/runs/DG0/${f.refs[role].run_id}/meta.json`;
/** Rewrite a run's meta as if the run had produced it that way from the start (amend the evidence commit). */
const rewriteMetaInHistory = (f, role, fn) => {
  mutate(f.repo, metaOf(f, role), fn);
  git(f.repo, "commit", "-q", "--amend", "-a", "--no-edit");
};
const LOAD_ASSIGN = "docs/delivery/assignments/DG0/T-DG0-LOAD.md";
const loadRun = (f, role = "qa-verifier", outputs = []) => {
  write(f.repo, LOAD_ASSIGN, "load check\n");
  const r = allocRun(f.repo, role, { assignment: LOAD_ASSIGN, task: "T-DG0-LOAD", startedAt: T_BEFORE, head: f.commit });
  const ref = r.finish(outputs);
  commitAll(f.repo, "load run");
  return ref;
};
const SIDE1V = "docs/delivery/reviews/DG0/round-1/qa-verifier.verifications.json";
const SIDE2V = "docs/delivery/reviews/DG0/round-2/qa-verifier.verifications.json";
const CLOSE = { verifications: [{ finding_id: "F-DG0-201", result: "PASS", status_after: "CLOSED_VERIFIED", note: "fixed", evidence: [] }] };

/** Adds review round `round` with one bound record + verifications sidecar of `role`; registers and commits it. */
function addRound(f, round, role, sidecar, { startedAt = T_RUN, head, roundMeta = {}, finishOpts } = {}) {
  const assign = `docs/delivery/assignments/DG0/round-${round}/review-${role}.md`;
  write(f.repo, assign, `assignment ${role} r${round}\n`);
  const rel = `docs/delivery/reviews/DG0/round-${round}/${role}.json`;
  const side = `docs/delivery/reviews/DG0/round-${round}/${role}.verifications.json`;
  const rm = { candidate_id: f.cid, frozen_at: T_FREEZE, source_commit: f.commit, ...roundMeta };
  mutate(f.repo, "docs/delivery/stages.json", (d) => {
    const existing = d.stages[0].review_rounds.find((x) => x.round === round);
    if (existing) existing.records[role] = rel;
    else d.stages[0].review_rounds.push({ round, ...rm, records: { [role]: rel } });
  });
  const startHead = head ?? commitAll(f.repo, `round ${round} assignment/metadata`);
  const run = allocRun(f.repo, role, { assignment: assign, task: `T-DG0-REV-R${round}`, startedAt, head: startHead });
  const base = readJ(f.repo, f.recs["qa-verifier"]);
  write(f.repo, rel, { ...base, reviewer_role: role, round, candidate_id: rm.candidate_id, invocation_reference: run.ref, assignment: assign });
  write(f.repo, side, sidecar);
  run.finish([rel, side], finishOpts);
  commitAll(f.repo, `round ${round} ${role}`);
  return run.ref;
}
const mirrorClosure = (f, ref) => {
  mutate(f.repo, "docs/delivery/findings.json", (d) => (d.findings[0].verification.invocation_reference = ref));
  commitAll(f.repo, "findings mirror");
};

test("control: the independent round-5 fixture is accepted (API and CLI exit 0)", () => withFixture(({ repo }) => {
  assert.deepEqual(validateGate(repo, "DG0"), []);
  const r = spawnSync(process.execPath, [VALIDATE_CLI, "--stage", "DG0"], { env: { ...process.env, GATE_REPO_ROOT: repo } });
  assert.equal(r.status, 0, r.stderr.toString() + r.stdout.toString());
}));

test("control: a genuine later-round closure (post-manifest run) is accepted", () => withFixture((f) => {
  const ref = addRound(f, 3, "qa-verifier", CLOSE);
  mirrorClosure(f, ref);
  assert.deepEqual(validateGate(f.repo, "DG0"), []);
}));

// ---------- re-verification of F-DG0-211 (gate record bound to the audited release-auditor run) ----------
test("QA5-R211a (F-DG0-211 = QA4-N39): a gate record edited and committed after the auditor's run is rejected", () => withFixture((f) => {
  mutate(f.repo, f.gateRel, (g) => { g.tests.push({ name: "extra", command: "c", result: "PASS", evidence: ["docs/delivery/test-evidence/DG0/run.log"] }); g.decided_at = "2026-09-28T13:45:00Z"; });
  commitAll(f.repo, "orchestrator edits the gate record");
  rejects(validateGate(f.repo, "DG0"), /release-auditor.*docs\/delivery\/gates\/DG0\.json differs from what the run wrote/);
}));

test("QA5-R211b (F-DG0-211 = QA4-N40): a gate record the auditor run never wrote (absent from its outputs) is rejected", () => withFixture((f) => {
  rewriteMetaInHistory(f, "release-auditor", (m) => { delete m.outputs[f.gateRel]; delete m.tool_authored[f.gateRel]; m.written_by_tools = m.written_by_tools.filter((p) => p !== f.gateRel); });
  rejects(validateGate(f.repo, "DG0"), /release-auditor.*gates\/DG0\.json (differs from what the run wrote|was not written by this run's file tools)/);
}));

test("QA5-R211c (F-DG0-211 variant): a gate record present in the auditor run's window but not tool-authored (shell/other writer) is rejected", () => withFixture((f) => {
  rewriteMetaInHistory(f, "release-auditor", (m) => { delete m.tool_authored[f.gateRel]; });
  rejects(validateGate(f.repo, "DG0"), /gates\/DG0\.json was not written by this run's file tools/);
}));

// ---------- re-verification of F-DG0-212 ----------
test("QA5-R212a (F-DG0-212 = QA4-N30b): a round backed by a fabricated, backdated manifest is rejected", () => withFixture((f) => {
  const fakeEntries = [{ path: "app/main.txt", sha256: "2".repeat(64), mode: "100644" }];
  const fakeCid = candidateId(fakeEntries);
  write(f.repo, manifestRel(fakeCid), { stage_id: "DG0", candidate_id: fakeCid, hash_algorithm: "mth-candidate-v2", source_commit: f.commit, frozen_at: "2026-09-28T10:00:00Z", spec: SPEC, entries: fakeEntries });
  // A genuine qa-verifier run that started at 11:00, from the freeze commit (before any manifest existed).
  const ref = addRound(f, 3, "qa-verifier", CLOSE, { startedAt: T_BEFORE, head: f.commit, roundMeta: { candidate_id: fakeCid, frozen_at: "2026-09-28T10:00:00Z" } });
  mirrorClosure(f, ref);
  const e = validateGate(f.repo, "DG0");
  console.log(`# QA5-R212a errors (${e.length}):\n#   ${e.join("\n#   ")}`);
  rejects(e, /round 3 manifest .* does not describe its source_commit/);
  rejects(e, /F-DG0-201.*which does not contain docs\/delivery\/candidates\/DG0\//);
}));

test("QA5-R212b (F-DG0-212 variant, new): an honest-content but backdated manifest (narrowed spec, so a new id/path) cannot legitimise a run that started before it was committed", () => withFixture((f) => {
  const narrow = { include: ["app/**"], exclude: ["trading_agent/**"] };
  const entries = manifestFromRef(f.repo, f.commit, narrow);
  const nid = candidateId(entries);
  assert.notEqual(nid, f.cid);
  write(f.repo, manifestRel(nid), { stage_id: "DG0", candidate_id: nid, hash_algorithm: "mth-candidate-v2", source_commit: f.commit, frozen_at: "2026-09-28T10:00:00Z", spec: narrow, entries });
  const ref = addRound(f, 3, "qa-verifier", CLOSE, { startedAt: T_BEFORE, head: f.manifestCommit, roundMeta: { candidate_id: nid, frozen_at: "2026-09-28T10:00:00Z" } });
  mirrorClosure(f, ref);
  const e = validateGate(f.repo, "DG0");
  console.log(`# QA5-R212b errors (${e.length}):\n#   ${e.join("\n#   ")}`);
  rejects(e, /F-DG0-201.*which does not contain docs\/delivery\/candidates\/DG0\//);
}));

// Informational probe (no assertion on the outcome): round manifests are not required to use the stage's candidate_spec.
test("QA5-P01 probe (informational): a later round whose manifest uses a narrower spec than the stage candidate_spec", () => withFixture((f) => {
  const narrow = { include: ["app/**"], exclude: ["trading_agent/**"] };
  const entries = manifestFromRef(f.repo, f.commit, narrow);
  const nid = candidateId(entries);
  write(f.repo, manifestRel(nid), { stage_id: "DG0", candidate_id: nid, hash_algorithm: "mth-candidate-v2", source_commit: f.commit, frozen_at: T_FREEZE, spec: narrow, entries });
  commitAll(f.repo, "narrow manifest");
  const ref = addRound(f, 3, "qa-verifier", CLOSE, { roundMeta: { candidate_id: nid } });
  mirrorClosure(f, ref);
  const e = validateGate(f.repo, "DG0");
  console.log(`# QA5-P01 narrow-spec round accepted: ${e.length === 0} (errors: ${e.join(" | ") || "none"})`);
}));

// ---------- re-confirmation of earlier findings on the round-5 rules ----------
test("QA5-R201 (F-DG0-201): a gate review record re-pointed at the reviewer's pre-freeze LOAD run is rejected", () => withFixture((f) => {
  const load = loadRun(f);
  mutate(f.repo, f.recs["qa-verifier"], (r) => (r.invocation_reference = load));
  const e = validateGate(f.repo, "DG0");
  rejects(e, /review qa-verifier .*ran assignment docs\/delivery\/assignments\/DG0\/T-DG0-LOAD\.md/);
  rejects(e, /review qa-verifier .*before the candidate froze/);
}));

test("QA5-R202 (F-DG0-202): a bare, non-existent evidence file name on an IMPLEMENTED DG0 row is rejected", () => withFixture((f) => {
  writeRegister(f.repo, [row(), row({ ...DLV, evidence: "NO-SUCH-EVIDENCE.md" })]);
  rejects(validateGate(f.repo, "DG0"), /evidence is not an existing repository file: NO-SUCH-EVIDENCE\.md/);
}));

test("QA5-R204 (F-DG0-204): findings.json verification citing the verifier's pre-freeze LOAD run is rejected", () => withFixture((f) => {
  const load = loadRun(f);
  mutate(f.repo, "docs/delivery/findings.json", (d) => (d.findings[0].verification.invocation_reference = load));
  rejects(validateGate(f.repo, "DG0"), /F-DG0-201.*not the verifying reviewer's own run/);
}));

test("QA5-R205 (F-DG0-205): evidence that is an in-repo symlink to a file outside the repository is rejected; in-repo link accepted", () => withFixture((f) => {
  const outside = mkdtempSync(join(tmpdir(), "qa5-outside-"));
  try {
    writeFileSync(join(outside, "secret.txt"), "outside\n");
    write(f.repo, "app/inrepo-target.txt", "inside\n");
    symlinkSync("inrepo-target.txt", join(f.repo, "app/inrepo-link.txt"));
    symlinkSync(join(outside, "secret.txt"), join(f.repo, "app/evidence-link.txt"));
    writeRegister(f.repo, [row(), row({ ...DLV, evidence: "app/inrepo-link.txt" })]);
    const pos = [];
    rules.checkRegister(f.repo, "DG0", pos);
    assert.deepEqual(pos, []);
    writeRegister(f.repo, [row(), row({ ...DLV, evidence: "app/evidence-link.txt" })]);
    const neg = [];
    rules.checkRegister(f.repo, "DG0", neg);
    rejects(neg, /evidence is not an existing repository file: app\/evidence-link\.txt/);
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
}));

test("QA5-R206 (F-DG0-206): a committed exec-bit change after freeze invalidates the approval", () => withFixture((f) => {
  execFileSync("chmod", ["+x", join(f.repo, "app/main.txt")]);
  commitAll(f.repo, "chmod after freeze");
  rejects(validateGate(f.repo, "DG0"), /candidate: current content hashes to .*app\/main\.txt/);
}));

test("QA5-R208a (F-DG0-208 = QA3-N20): rewrite round-1 frozen_at + record to cite a LOAD run, committed, is rejected", () => withFixture((f) => {
  const load = loadRun(f);
  mutate(f.repo, "docs/delivery/stages.json", (d) => (d.stages[0].review_rounds[0].frozen_at = "2026-09-28T10:00:00Z"));
  mutate(f.repo, "docs/delivery/reviews/DG0/round-1/qa-verifier.json", (r) => { r.invocation_reference = load; r.assignment = LOAD_ASSIGN; });
  unlinkSync(join(f.repo, SIDE2V));
  write(f.repo, SIDE1V, CLOSE);
  mutate(f.repo, "docs/delivery/findings.json", (d) => (d.findings[0].verification.invocation_reference = load));
  commitAll(f.repo, "rebind closure");
  const e = validateGate(f.repo, "DG0");
  rejects(e, /round 1 frozen_at\/source_commit differ from its committed manifest/);
  rejects(e, /write-once: docs\/delivery\/reviews\/DG0\/round-1\/qa-verifier\.json in HEAD differs/);
  rejects(e, /write-once: docs\/delivery\/reviews\/DG0\/round-2\/qa-verifier\.verifications\.json was removed/);
}));

test("QA5-R208b (F-DG0-208): the same attack left uncommitted is rejected too", () => withFixture((f) => {
  const load = loadRun(f);
  mutate(f.repo, "docs/delivery/stages.json", (d) => (d.stages[0].review_rounds[0].frozen_at = "2026-09-28T10:00:00Z"));
  mutate(f.repo, "docs/delivery/reviews/DG0/round-1/qa-verifier.json", (r) => { r.invocation_reference = load; r.assignment = LOAD_ASSIGN; });
  write(f.repo, SIDE1V, CLOSE);
  unlinkSync(join(f.repo, SIDE2V));
  const e = validateGate(f.repo, "DG0");
  rejects(e, /write-once: working-tree docs\/delivery\/reviews\/DG0\/round-1\/qa-verifier\.json differs/);
  rejects(e, /write-once: docs\/delivery\/reviews\/DG0\/round-2\/qa-verifier\.verifications\.json is missing from the working tree/);
}));

// ---------- new round-5 negative cases (not in tools/gates/tests) ----------
test("QA5-N50 binding: a run whose meta has written_by_tools but no tool_authored (round-4 runner shape) cannot bind a record", () => withFixture((f) => {
  rewriteMetaInHistory(f, "domain-reviewer", (m) => { delete m.tool_authored; });
  rejects(validateGate(f.repo, "DG0"), /review domain-reviewer .*round-2\/domain-reviewer\.json was not written by this run's file tools/);
}));

test("QA5-N51 binding: a closing sidecar that the run touched with file tools but whose final bytes are not the replay (e.g. shell edit after Write) cannot close a finding", () => withFixture((f) => {
  const ref = addRound(f, 3, "qa-verifier", CLOSE, { finishOpts: { authored: ["docs/delivery/reviews/DG0/round-3/qa-verifier.json"] } });
  mirrorClosure(f, ref);
  rejects(validateGate(f.repo, "DG0"), /F-DG0-201.*round-3\/qa-verifier\.verifications\.json was not written by this run's file tools/);
}));

test("QA5-N52 binding: head_commit_at_start that is not a commit in this repository is rejected", () => withFixture((f) => {
  rewriteMetaInHistory(f, "code-security-reviewer", (m) => { m.head_commit_at_start = "f".repeat(40); });
  rejects(validateGate(f.repo, "DG0"), /review code-security-reviewer .*started from ffffffffff, which does not contain docs\/delivery\/candidates\/DG0\//);
}));

test("QA5-N53 binding: a run with no head_commit_at_start at all is rejected", () => withFixture((f) => {
  rewriteMetaInHistory(f, "qa-verifier", (m) => { delete m.head_commit_at_start; });
  rejects(validateGate(f.repo, "DG0"), /review qa-verifier .*which does not contain docs\/delivery\/candidates\/DG0\//);
}));

test("QA5-N54 write-once: delete a committed record, then re-add it with different bytes in a later commit, is rejected", () => withFixture((f) => {
  const rec = f.recs["domain-reviewer"];
  const orig = readFileSync(join(f.repo, rec));
  unlinkSync(join(f.repo, rec));
  commitAll(f.repo, "remove");
  const r = JSON.parse(orig);
  r.checks_run[0].actual = "re-added with other content";
  write(f.repo, rec, r);
  commitAll(f.repo, "re-add");
  rejects(validateGate(f.repo, "DG0"), /write-once: docs\/delivery\/reviews\/DG0\/round-2\/domain-reviewer\.json in HEAD differs from the version first committed/);
}));

test("QA5-N55 write-once: re-adding the identical bytes after a delete is accepted (content, not history shape, is what matters)", () => withFixture((f) => {
  const rec = f.recs["domain-reviewer"];
  const orig = readFileSync(join(f.repo, rec));
  unlinkSync(join(f.repo, rec));
  commitAll(f.repo, "remove");
  write(f.repo, rec, orig);
  commitAll(f.repo, "re-add identical");
  assert.deepEqual(validateGate(f.repo, "DG0"), []);
}));

test("QA5-N56 write-once: an edited round assignment committed on a side branch and merged is rejected (history + sha binding)", () => withFixture((f) => {
  git(f.repo, "checkout", "-q", "-b", "side");
  write(f.repo, "docs/delivery/assignments/DG0/round-2/review-domain-reviewer.md", "assignment rewritten on a branch\n");
  commitAll(f.repo, "side edit");
  git(f.repo, "checkout", "-q", "main");
  git(f.repo, "merge", "-q", "--no-ff", "-m", "merge side", "side");
  const e = validateGate(f.repo, "DG0");
  rejects(e, /write-once: docs\/delivery\/assignments\/DG0\/round-2\/review-domain-reviewer\.md in HEAD differs/);
  rejects(e, /assignment file changed since the run/);
}));

test("QA5-N57 manifests: a round whose manifest names a source_commit that does not exist is rejected", () => withFixture((f) => {
  const entries = [{ path: "app/main.txt", sha256: "3".repeat(64), mode: "100644" }];
  const id = candidateId(entries);
  write(f.repo, manifestRel(id), { stage_id: "DG0", candidate_id: id, hash_algorithm: "mth-candidate-v2", source_commit: "e".repeat(40), frozen_at: T_FREEZE, spec: SPEC, entries });
  mutate(f.repo, "docs/delivery/stages.json", (d) => d.stages[0].review_rounds.push({ round: 3, candidate_id: id, frozen_at: T_FREEZE, source_commit: "e".repeat(40), records: {} }));
  commitAll(f.repo, "bogus round");
  rejects(validateGate(f.repo, "DG0"), /round 3 manifest .*cannot recompute from its source_commit/);
}));

test("QA5-N58 manifests: a committed frozen manifest edited in the working tree (hidden with assume-unchanged) is rejected", () => withFixture((f) => {
  git(f.repo, "update-index", "--assume-unchanged", f.mrel);
  mutate(f.repo, f.mrel, (m) => (m.frozen_at = "2026-09-28T09:00:00Z"));
  assert.equal(git(f.repo, "status", "--porcelain"), "");
  const e = validateGate(f.repo, "DG0");
  rejects(e, /write-once: working-tree docs\/delivery\/candidates\/DG0\/.* differs/);
}));

test("QA5-N59 gate: the gate record authored by a domain-reviewer run (not the auditor) is rejected even if the auditor's outputs list is edited in history to match", () => withFixture((f) => {
  // The gate cites the auditor run, but the bytes of the gate record were produced by another role's run.
  mutate(f.repo, f.gateRel, (g) => (g.decided_at = "2026-09-28T13:50:00Z"));
  rewriteMetaInHistory(f, "domain-reviewer", (m) => { m.outputs[f.gateRel] = shaFile(f.repo, f.gateRel); m.tool_authored[f.gateRel] = m.outputs[f.gateRel]; });
  rejects(validateGate(f.repo, "DG0"), /release-auditor.*gates\/DG0\.json differs from what the run wrote/);
}));

// ---------- the runner's tool_authored replay (tools/agents/run-agent.sh), exercised on synthetic transcripts ----------
function runnerReplay(repoFiles, toolEvents, finalFiles) {
  const src = readFileSync(RUNNER, "utf8");
  const start = src.indexOf('python3 - "$OUT" "$RUN_ID"');
  assert.ok(start > 0, "runner meta/replay block not found");
  const bodyStart = src.indexOf("\n", start) + 1;
  const bodyEnd = src.indexOf("\nPY\n", bodyStart);
  const py = src.slice(bodyStart, bodyEnd + 1);
  const repo = mkdtempSync(join(tmpdir(), "qa5-replay-"));
  const out = join(repo, "out");
  mkdirSync(out);
  try {
    const hashes = (files) => Object.fromEntries(Object.entries(files).map(([p, c]) => [p, sha(Buffer.from(c, "utf8"))]));
    writeFileSync(join(out, ".pre-snapshot.json"), JSON.stringify(hashes(repoFiles)));
    writeFileSync(join(out, ".post-snapshot.json"), JSON.stringify(hashes(finalFiles)));
    const lines = [
      { type: "system", subtype: "init", session_id: "s" },
      ...toolEvents.flatMap((ev, i) => {
        const id = `tu${i}`;
        const input = { ...ev.input, file_path: ev.input.file_path.startsWith("/") ? ev.input.file_path : join(repo, ev.input.file_path) };
        return [
          { type: "assistant", message: { content: [{ type: "tool_use", id, name: ev.name, input }] } },
          { type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, is_error: !!ev.fail, content: ev.fail ? "denied" : "ok" }] } },
        ];
      }),
      { type: "result", subtype: "success", is_error: false, session_id: "s", result: "done" },
    ];
    writeFileSync(join(out, "transcript.jsonl.gz"), gzipSync(Buffer.from(lines.map((l) => JSON.stringify(l)).join("\n") + "\n")));
    const r = spawnSync("python3", ["-", out, "RID", "qa-verifier", "DG0", "T", "s", MODEL, repo, "HEAD0", "a.md", "0", "t0", "t1", "0", "0", repo], { input: py });
    assert.equal(r.status, 0, r.stderr.toString());
    return JSON.parse(readFileSync(join(out, "meta.json"), "utf8"));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

test("QA5-RP1 runner replay: Write then Edit (chained) is tool_authored; outputs record the change", () => {
  const m = runnerReplay({}, [
    { name: "Write", input: { file_path: "r/a.json", content: '{"v":"FAIL"}' } },
    { name: "Edit", input: { file_path: "r/a.json", old_string: "FAIL", new_string: "PASS" } },
  ], { "r/a.json": '{"v":"PASS"}' });
  assert.equal(m.tool_authored["r/a.json"], sha(Buffer.from('{"v":"PASS"}')));
  assert.equal(m.outputs["r/a.json"], m.tool_authored["r/a.json"]);
});

test("QA5-RP2 runner replay: Write followed by a shell rewrite (final bytes differ) is NOT tool_authored", () => {
  const m = runnerReplay({}, [{ name: "Write", input: { file_path: "r/a.json", content: '{"v":"FAIL"}' } }], { "r/a.json": '{"v":"PASS"}' });
  assert.equal(m.tool_authored["r/a.json"], undefined);
  assert.ok(m.written_by_tools.includes("r/a.json"));
  assert.ok(m.outputs["r/a.json"]);
});

test("QA5-RP3 runner replay: a failed (guard-denied) Write whose content appears via the shell is NOT tool_authored", () => {
  const m = runnerReplay({}, [{ name: "Write", input: { file_path: "r/a.json", content: "X" }, fail: true }], { "r/a.json": "X" });
  assert.equal(m.tool_authored["r/a.json"], undefined);
});

test("QA5-RP4 runner replay: an Edit on a pre-existing file (not written by this run) is NOT tool_authored", () => {
  const m = runnerReplay({ "r/a.json": "old A" }, [{ name: "Edit", input: { file_path: "r/a.json", old_string: "A", new_string: "B" } }], { "r/a.json": "old B" });
  assert.equal(m.tool_authored["r/a.json"], undefined);
});

test("QA5-RP5 runner replay: an Edit whose old_string does not occur poisons the replay; writes outside the repo are ignored", () => {
  const m = runnerReplay({}, [
    { name: "Write", input: { file_path: "r/a.json", content: "hello" } },
    { name: "Edit", input: { file_path: "r/a.json", old_string: "absent", new_string: "x" } },
    { name: "Write", input: { file_path: "/nonexistent-qa5-dir/x.json", content: "y" } },
  ], { "r/a.json": "hello" });
  assert.equal(m.tool_authored["r/a.json"], undefined);
  assert.ok(!m.written_by_tools.some((p) => p.includes("nonexistent-qa5-dir")));
});

test("QA5-RP6 runner replay: a later successful Write supersedes an earlier failed one and binds the final bytes", () => {
  const m = runnerReplay({}, [
    { name: "Write", input: { file_path: "r/a.json", content: "first" }, fail: true },
    { name: "Write", input: { file_path: "r/a.json", content: "second" } },
  ], { "r/a.json": "second" });
  assert.equal(m.tool_authored["r/a.json"], sha(Buffer.from("second")));
});

// ---------- metadata never changes the candidate (A25) ----------
test("QA5-M01 metadata: a new round (manifest, runs, reviews, sidecars, assignments, stages, findings, progress) leaves the candidate and the gate valid", () => withFixture((f) => {
  write(f.repo, "docs/delivery/assignments/DG0/round-3/review-qa-verifier.md", "a\n");
  write(f.repo, "docs/delivery/runs/DG0/DG0-extra/notes.txt", "x\n");
  write(f.repo, "docs/delivery/progress.md", "p\n");
  write(f.repo, "docs/delivery/handbacks/DG0/h.md", "h\n");
  write(f.repo, "docs/delivery/test-evidence/DG0/qa/more.log", "m\n");
  mutate(f.repo, "docs/delivery/findings.json", (d) => d.findings[0].history.push({ at: "2026-09-28T13:40:00Z", status: "CLOSED_VERIFIED" }));
  commitAll(f.repo, "metadata only");
  assert.equal(candidateId(manifestFromWorkingTree(f.repo, SPEC)), f.cid);
  assert.equal(candidateId(manifestFromRef(f.repo, "HEAD", SPEC)), f.cid);
  assert.deepEqual(validateGate(f.repo, "DG0"), []);
}));

// ---------- the A24/A25 rejection list from the DG0 QA assignment, on the round-5 fixture ----------
const A24 = [
  ["missing reviewer", (f) => mutate(f.repo, f.gateRel, (g) => delete g.reviews["code-security-reviewer"]), /missing (code-security-reviewer review|required property .code-security-reviewer.)/],
  ["reviewer who authored the scope", (f) => mutate(f.repo, f.recs["domain-reviewer"], (r) => (r.independence_declaration.reviewer_authored_reviewed_scope = true)), /declares authorship/],
  ["reviewer listed as implementation author", (f) => mutate(f.repo, f.recs["qa-verifier"], (r) => r.implementation_author.push("qa-verifier")), /listed as an implementation author/],
  ["shared invocation", (f) => mutate(f.repo, f.recs["domain-reviewer"], (r) => (r.invocation_reference = f.refs["code-security-reviewer"])), /domain-reviewer.*(was run as 'code-security-reviewer'|share)/],
  ["failed check", (f) => mutate(f.repo, f.recs["qa-verifier"], (r) => (r.checks_run[0].result = "FAIL")), /check K1 is FAIL/],
  ["blocked check", (f) => mutate(f.repo, f.recs["qa-verifier"], (r) => (r.checks_run[0].result = "BLOCKED")), /check K1 is BLOCKED/],
  ["failed gate test", (f) => mutate(f.repo, f.gateRel, (g) => (g.tests[0].result = "FAIL")), /test 't' is FAIL/],
  ["unresolved High finding", (f) => mutate(f.repo, "docs/delivery/findings.json", (d) => { d.findings[0].status = "OPEN"; d.findings[0].verification = null; }), /F-DG0-201 \(High, mandatory\): unresolved \(OPEN\)/, { severity: "High" }],
  ["incomplete requirement", (f) => writeRegister(f.repo, [row(), row({ ...DLV, status: "SPECIFIED", evidence: "" })]), /REQ-DLV-001/],
  ["register row with a non-existent block anchor", (f) => writeRegister(f.repo, [row({ source_ref: "B0999" }), row(DLV)]), /B0999/],
  ["SOURCE row without a playbook block", (f) => writeRegister(f.repo, [row({ source_ref: "M0001" }), row(DLV)]), /REQ-PB-001.*SOURCE requirement cites no playbook block/],
  ["coverage matrix missing a block", (f) => write(f.repo, "docs/analysis/source-coverage.csv", "block_id,disposition,req_ids,rationale\nB0001,REQUIREMENT,REQ-PB-001,\n"), /block B0002 has no disposition/],
  ["coverage maps a block to a requirement that doesn't cite it", (f) => write(f.repo, "docs/analysis/source-coverage.csv", "block_id,disposition,req_ids,rationale\nB0001,REQUIREMENT,REQ-PB-001,\nB0002,REQUIREMENT,REQ-PB-001,\n"), /B0002 maps to REQ-PB-001, but REQ-PB-001 does not cite B0002/],
  ["candidate change after freeze", (f) => { write(f.repo, "app/main.txt", "v2\n"); commitAll(f.repo, "late change"); }, /candidate: current content hashes to/],
  ["tampered manifest", (f) => mutate(f.repo, f.mrel, (m) => (m.entries[0].sha256 = "0".repeat(64))), /tampered/],
];
for (const [name, breakIt, re, opts] of A24) {
  test(`QA5-A24 rejects: ${name}`, () => withFixture((f) => {
    if (opts) assert.deepEqual(validateGate(f.repo, "DG0"), [], "variant fixture must validate before the break");
    breakIt(f);
    rejects(validateGate(f.repo, "DG0"), re);
  }, opts));
}
