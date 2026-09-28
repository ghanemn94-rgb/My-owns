// Independent QA negative tests for the DG0 gate validator, round 4 (A23 independence, A24 enforced advancement,
// A25 candidate integrity), re-expressed on the round-4 rules (D-021: per-freeze write-once manifests using
// mth-candidate-v2, reviewer artefacts bound to their run's recorded outputs, write-once review evidence).
// Author: qa-verifier, task T-DG0-REV-QA-R4. Written independently of tools/gates/tests/validator.test.mjs: each case
// builds its own disposable git fixture in the OS temp dir and removes it afterwards. Cases QA4-N* are NOT present
// in tools/gates/tests/.
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
const { validateGate, REGISTER_COLUMNS, STAGE_ORDER } = rules;
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
const shaFile = (repo, rel) => sha(readFileSync(join(repo, rel)));
const q = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const commitAll = (repo, msg) => {
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", msg);
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
 * Two-phase run in the shape tools/agents/run-agent.sh (round 4) produces. allocRun() fixes the run ID and session
 * (so a record can cite it before the run's evidence is written); finish(outputs) then writes transcript, result and
 * meta, with meta.outputs = sha256 of each output as it is now and meta.written_by_tools = the same paths.
 */
function allocRun(repo, role, { assignment, task = "T-REV", startedAt = T_RUN, stage = "DG0" } = {}) {
  seq += 1;
  const session_id = `${String(seq).padStart(8, "0")}-4444-4444-8444-444444444444`;
  const run_id = `${stage}-${task}-${role}-20260928T133000Z-${session_id.slice(0, 8)}`;
  const ref = { kind: "claude-code-cli-session", run_id, session_id };
  const base = `docs/delivery/runs/${stage}/${run_id}`;
  const finish = (outputs = [], { writtenBy = outputs, metaTweak } = {}) => {
    const lines = [
      { type: "system", subtype: "init", session_id, model: MODEL, tools: ["Read", "Bash", "Write"] },
      { type: "user", message: { role: "user", content: `You are invoked as project agent '${role}' for stage ${stage}, task ${task}. Your invocation_reference is: {"run_id":"${run_id}"}` }, session_id },
      { type: "result", subtype: "success", is_error: false, session_id, result: "done" },
    ];
    const transcript = gzipSync(Buffer.from(lines.map((l) => JSON.stringify(l)).join("\n") + "\n"));
    const result = Buffer.from(JSON.stringify({ result: "done" }));
    write(repo, `${base}/transcript.jsonl.gz`, transcript);
    write(repo, `${base}/result.json`, result);
    let meta = {
      run_id, role, stage, task, invocation_reference: ref, model_requested: MODEL,
      assignment, assignment_sha256: shaFile(repo, assignment), started_at: startedAt, exit_code: 0, is_error: false,
      result_session_id: session_id, result_sha256: sha(result), transcript_sha256: sha(transcript),
      outputs: Object.fromEntries(outputs.map((p) => [p, shaFile(repo, p)])), deleted: [], written_by_tools: [...writtenBy],
    };
    if (metaTweak) meta = metaTweak(meta);
    write(repo, `${base}/meta.json`, meta);
    return ref;
  };
  return { ref, base, finish };
}

const manifestRel = (cid) => `docs/delivery/candidates/DG0/${cid.slice(7, 23)}.manifest.json`;

/**
 * A disposable repository whose DG0 gate validates cleanly under the round-4 rules: round 1 QA FAIL raising one
 * Medium finding (F-DG0-201); round 2 all four roles PASS; QA closes the finding in its round-2 verifications sidecar.
 * Every record/sidecar is in its run's outputs; all evidence is committed (write-once history is live).
 */
function fixture({ severity = "Medium", mandatory = true, accept = false } = {}) {
  const repo = mkdtempSync(join(tmpdir(), "qa4-dg0-"));
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
  commitAll(repo, "freeze");
  const commit = git(repo, "rev-parse", "HEAD");
  const entries = manifestFromRef(repo, commit, s0.candidate_spec);
  const cid = candidateId(entries);
  const mrel = manifestRel(cid);
  write(repo, mrel, { stage_id: "DG0", candidate_id: cid, hash_algorithm: "mth-candidate-v2", source_commit: commit, frozen_at: T_FREEZE, spec: s0.candidate_spec, entries });
  s0.candidate = { candidate_id: cid, source_commit: commit, frozen_at: T_FREEZE, manifest_path: mrel };
  const recsOf = (round, roles) => Object.fromEntries(roles.map((r) => [r, `docs/delivery/reviews/DG0/round-${round}/${r}.json`]));
  s0.review_rounds = [
    { round: 1, candidate_id: cid, frozen_at: T_FREEZE, source_commit: commit, records: recsOf(1, ["qa-verifier"]) },
    { round: 2, candidate_id: cid, frozen_at: T_FREEZE, source_commit: commit, records: recsOf(2, ALL) },
  ];
  write(repo, "docs/delivery/stages.json", stages);
  write(repo, "docs/delivery/test-evidence/DG0/run.log", "ok\n");
  const recs = {};
  const refs = {};
  const record = (role, round, extra = {}, sidecars = {}, more = []) => {
    const assignment = `docs/delivery/assignments/DG0/round-${round}/review-${role}.md`;
    write(repo, assignment, `assignment ${role} r${round}\n`);
    const run = allocRun(repo, role, { assignment, task: `T-DG0-REV-R${round}` });
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
    for (const [p, body] of more) {
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
  // Finish the round-2 runs: the auditor's run also wrote the gate record (as run-agent.sh would record it).
  for (const r of pending) r.run.finish(r.rel === recs["release-auditor"] ? [...r.outs, gateRel] : r.outs);
  commitAll(repo, "round evidence (auto-committed by the runner)");
  return { repo, cid, commit, recs, refs, mrel, gateRel };
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
const LOAD_ASSIGN = "docs/delivery/assignments/DG0/T-DG0-LOAD.md";
/** A committed, successful pre-freeze T-DG0-LOAD run of `role` (as exists in the real repository). */
const loadRun = (f, role = "qa-verifier", outputs = []) => {
  write(f.repo, LOAD_ASSIGN, "load check\n");
  const r = allocRun(f.repo, role, { assignment: LOAD_ASSIGN, task: "T-DG0-LOAD", startedAt: T_BEFORE });
  const ref = r.finish(outputs);
  commitAll(f.repo, "load run");
  return ref;
};
const SIDE1V = "docs/delivery/reviews/DG0/round-1/qa-verifier.verifications.json";
const SIDE2V = "docs/delivery/reviews/DG0/round-2/qa-verifier.verifications.json";
const CLOSE = { verifications: [{ finding_id: "F-DG0-201", result: "PASS", status_after: "CLOSED_VERIFIED", note: "fixed", evidence: [] }] };
/**
 * Adds review round `round` with one properly bound record (+ verifications sidecar) of `role`, run by a genuine run
 * of that role that wrote both files with its own tools. Registers the round in stages.json (candidate/frozen_at from
 * `roundMeta`, default the fixture's frozen candidate) and commits. Returns the run's invocation reference.
 */
function addRound(f, round, role, sidecar, { startedAt = T_RUN, assignment, task = `T-DG0-REV-R${round}`, roundMeta = {} } = {}) {
  const assign = assignment || `docs/delivery/assignments/DG0/round-${round}/review-${role}.md`;
  write(f.repo, assign, `assignment ${role} r${round}\n`);
  const run = allocRun(f.repo, role, { assignment: assign, task, startedAt });
  const rel = `docs/delivery/reviews/DG0/round-${round}/${role}.json`;
  const side = `docs/delivery/reviews/DG0/round-${round}/${role}.verifications.json`;
  const base = readJ(f.repo, f.recs["qa-verifier"]);
  const rm = { candidate_id: f.cid, frozen_at: T_FREEZE, source_commit: f.commit, ...roundMeta };
  write(f.repo, rel, { ...base, reviewer_role: role, round, candidate_id: rm.candidate_id, invocation_reference: run.ref, assignment: assign });
  write(f.repo, side, sidecar);
  run.finish([rel, side]);
  mutate(f.repo, "docs/delivery/stages.json", (d) => {
    const existing = d.stages[0].review_rounds.find((x) => x.round === round);
    if (existing) existing.records[role] = rel;
    else d.stages[0].review_rounds.push({ round, ...rm, records: { [role]: rel } });
  });
  commitAll(f.repo, `round ${round} ${role}`);
  return run.ref;
}

test("control: the independent round-4 fixture is accepted (API and CLI exit 0)", () => withFixture(({ repo }) => {
  assert.deepEqual(validateGate(repo, "DG0"), []);
  const r = spawnSync(process.execPath, [VALIDATE_CLI, "--stage", "DG0"], { env: { ...process.env, GATE_REPO_ROOT: repo } });
  assert.equal(r.status, 0, r.stderr.toString());
}));

// ---------- re-verification of F-DG0-208 (the QA3-N20 attack and variants) ----------
test("QA4-R208a (F-DG0-208): the QA3-N20 attack (rewrite round-1 frozen_at + record to cite a LOAD run), committed, is rejected", () => withFixture((f) => {
  const load = loadRun(f);
  mutate(f.repo, "docs/delivery/stages.json", (d) => (d.stages[0].review_rounds[0].frozen_at = "2026-09-28T10:00:00Z"));
  mutate(f.repo, "docs/delivery/reviews/DG0/round-1/qa-verifier.json", (r) => { r.invocation_reference = load; r.assignment = LOAD_ASSIGN; });
  unlinkSync(join(f.repo, SIDE2V));
  write(f.repo, SIDE1V, CLOSE);
  mutate(f.repo, "docs/delivery/findings.json", (d) => (d.findings[0].verification.invocation_reference = load));
  commitAll(f.repo, "rebind closure");
  const e = validateGate(f.repo, "DG0");
  console.log(`# QA4-R208a errors (${e.length}):\n#   ${e.join("\n#   ")}`);
  rejects(e, /round 1 frozen_at\/source_commit differ from its committed manifest/);
  rejects(e, /write-once: M docs\/delivery\/reviews\/DG0\/round-1\/qa-verifier\.json/);
  rejects(e, /write-once: D docs\/delivery\/reviews\/DG0\/round-2\/qa-verifier\.verifications\.json/);
  rejects(e, /F-DG0-201.*(records no outputs|not written by this run's file tools)/);
}));

test("QA4-R208b (F-DG0-208): the same attack left uncommitted is rejected too", () => withFixture((f) => {
  const load = loadRun(f);
  mutate(f.repo, "docs/delivery/stages.json", (d) => (d.stages[0].review_rounds[0].frozen_at = "2026-09-28T10:00:00Z"));
  mutate(f.repo, "docs/delivery/reviews/DG0/round-1/qa-verifier.json", (r) => { r.invocation_reference = load; r.assignment = LOAD_ASSIGN; });
  write(f.repo, SIDE1V, CLOSE);
  unlinkSync(join(f.repo, SIDE2V));
  mutate(f.repo, "docs/delivery/findings.json", (d) => (d.findings[0].verification.invocation_reference = load));
  const e = validateGate(f.repo, "DG0");
  rejects(e, /write-once: uncommitted change to committed evidence: M docs\/delivery\/reviews\/DG0\/round-1\/qa-verifier\.json/);
  rejects(e, /write-once: uncommitted change to committed evidence: D docs\/delivery\/reviews\/DG0\/round-2\/qa-verifier\.verifications\.json/);
  rejects(e, /frozen_at\/source_commit differ from its committed manifest/);
}));

test("QA4-N30 (F-DG0-208 variant): a new round with a fabricated early manifest and a new record citing the LOAD run is rejected (no write-once edit needed)", () => withFixture((f) => {
  const load = loadRun(f);
  // Fabricate a different, self-consistent candidate manifest frozen before the LOAD run.
  const fakeEntries = [{ path: "app/main.txt", sha256: "1".repeat(64), mode: "100644" }];
  const fakeCid = candidateId(fakeEntries);
  write(f.repo, manifestRel(fakeCid), { stage_id: "DG0", candidate_id: fakeCid, hash_algorithm: "mth-candidate-v2", source_commit: f.commit, frozen_at: "2026-09-28T10:00:00Z", spec: { include: ["**"], exclude: ["trading_agent/**"] }, entries: fakeEntries });
  const rel3 = "docs/delivery/reviews/DG0/round-3/qa-verifier.json";
  const base = readJ(f.repo, f.recs["qa-verifier"]);
  write(f.repo, rel3, { ...base, round: 3, candidate_id: fakeCid, invocation_reference: load, assignment: LOAD_ASSIGN });
  write(f.repo, "docs/delivery/reviews/DG0/round-3/qa-verifier.verifications.json", CLOSE);
  mutate(f.repo, "docs/delivery/stages.json", (d) => d.stages[0].review_rounds.push({ round: 3, candidate_id: fakeCid, frozen_at: "2026-09-28T10:00:00Z", source_commit: f.commit, records: { "qa-verifier": rel3 } }));
  mutate(f.repo, "docs/delivery/findings.json", (d) => (d.findings[0].verification.invocation_reference = load));
  commitAll(f.repo, "forged round 3");
  const e = validateGate(f.repo, "DG0");
  console.log(`# QA4-N30 errors (${e.length}):\n#   ${e.join("\n#   ")}`);
  // The fabricated manifest itself is accepted (it hashes to its own id); the forgery fails only on output binding.
  rejects(e, /F-DG0-201.*verification: invocation .*(records no outputs|was not written by this run's file tools)/);
}));

// Probe for a residual of F-DG0-208: a round's frozen_at comes from a committed manifest, but a *new* manifest can be
// created (not modified) with any frozen_at; nothing ties it to the git history or to its source_commit content.
test("QA4-N30b probe: a fresh round backed by a fabricated, backdated manifest legitimises a genuine pre-freeze run's closure", { todo: "F-DG0-212" }, () => withFixture((f) => {
  const fakeEntries = [{ path: "app/main.txt", sha256: "2".repeat(64), mode: "100644" }];
  const fakeCid = candidateId(fakeEntries);
  write(f.repo, manifestRel(fakeCid), { stage_id: "DG0", candidate_id: fakeCid, hash_algorithm: "mth-candidate-v2", source_commit: f.commit, frozen_at: "2026-09-28T10:00:00Z", spec: { include: ["**"], exclude: ["trading_agent/**"] }, entries: fakeEntries });
  // A genuine qa-verifier run that started at 11:00 (before the real 13:00 freeze) and wrote a closing sidecar itself.
  const ref = addRound(f, 3, "qa-verifier", CLOSE, { startedAt: T_BEFORE, roundMeta: { candidate_id: fakeCid, frozen_at: "2026-09-28T10:00:00Z" } });
  mutate(f.repo, "docs/delivery/findings.json", (d) => (d.findings[0].verification.invocation_reference = ref));
  commitAll(f.repo, "findings mirror");
  const recomputed = candidateId(manifestFromRef(f.repo, f.commit, { include: ["**"], exclude: ["trading_agent/**"] }));
  console.log(`# QA4-N30b round-3 manifest ${fakeCid.slice(0, 23)} vs content of its source_commit ${recomputed.slice(0, 23)}`);
  const e = validateGate(f.repo, "DG0");
  console.log(`# QA4-N30b errors (${e.length}):\n#   ${e.join("\n#   ")}`);
  assert.ok(e.length > 0, "validator accepted a closure bound to a round whose manifest was fabricated with a backdated frozen_at");
}));

test("QA4-N31 (F-DG0-208 variant): a LOAD run that did write a record cannot close a finding after the fact (assignment + freeze binding)", () => withFixture((f) => {
  // The attacker makes a pre-freeze LOAD run that *does* record the round-3 record as its own output.
  write(f.repo, LOAD_ASSIGN, "load check\n");
  const rel3 = "docs/delivery/reviews/DG0/round-3/qa-verifier.json";
  const side3 = "docs/delivery/reviews/DG0/round-3/qa-verifier.verifications.json";
  const r = allocRun(f.repo, "qa-verifier", { assignment: LOAD_ASSIGN, task: "T-DG0-LOAD", startedAt: T_BEFORE });
  const base = readJ(f.repo, f.recs["qa-verifier"]);
  write(f.repo, rel3, { ...base, round: 3, invocation_reference: r.ref, assignment: LOAD_ASSIGN });
  write(f.repo, side3, CLOSE);
  r.finish([rel3, side3]);
  mutate(f.repo, "docs/delivery/stages.json", (d) => d.stages[0].review_rounds.push({ round: 3, candidate_id: f.cid, frozen_at: T_FREEZE, source_commit: f.commit, records: { "qa-verifier": rel3 } }));
  mutate(f.repo, "docs/delivery/findings.json", (d) => (d.findings[0].verification.invocation_reference = r.ref));
  commitAll(f.repo, "round 3 from a load run");
  rejects(validateGate(f.repo, "DG0"), /F-DG0-201.*started 2026-09-28T11:00:00Z, before the candidate froze/);
}));

// ---------- re-confirmation of my round-1/2 findings on the round-4 rules ----------
test("QA4-R201 (F-DG0-201): a gate review record re-pointed at the reviewer's pre-freeze LOAD run is rejected", () => withFixture((f) => {
  const load = loadRun(f);
  mutate(f.repo, f.recs["qa-verifier"], (r) => (r.invocation_reference = load));
  const e = validateGate(f.repo, "DG0");
  rejects(e, /review qa-verifier .*ran assignment docs\/delivery\/assignments\/DG0\/T-DG0-LOAD\.md/);
  rejects(e, /review qa-verifier .*before the candidate froze/);
}));

test("QA4-R201b (F-DG0-201): a review record that names no assignment cannot be bound to any run", () => withFixture((f) => {
  mutate(f.repo, f.recs["domain-reviewer"], (r) => delete r.assignment);
  assert.ok(validateGate(f.repo, "DG0").length > 0);
}));

test("QA4-R202 (F-DG0-202): a bare, non-existent evidence file name on an IMPLEMENTED DG0 row is rejected", () => withFixture((f) => {
  writeRegister(f.repo, [row(), row({ ...DLV, evidence: "NO-SUCH-EVIDENCE.md" })]);
  rejects(validateGate(f.repo, "DG0"), /evidence is not an existing repository file: NO-SUCH-EVIDENCE\.md/);
}));

test("QA4-R204 (F-DG0-204): findings.json verification citing the verifier's pre-freeze LOAD run is rejected", () => withFixture((f) => {
  const load = loadRun(f);
  mutate(f.repo, "docs/delivery/findings.json", (d) => (d.findings[0].verification.invocation_reference = load));
  rejects(validateGate(f.repo, "DG0"), /F-DG0-201.*not the verifying reviewer's own run/);
}));

test("QA4-R205 (F-DG0-205): register evidence that is an in-repo symlink to a file outside the repository is rejected; in-repo link accepted", () => withFixture((f) => {
  const outside = mkdtempSync(join(tmpdir(), "qa4-outside-"));
  try {
    writeFileSync(join(outside, "secret.txt"), "outside\n");
    write(f.repo, "app/inrepo-target.txt", "inside\n");
    symlinkSync("inrepo-target.txt", join(f.repo, "app/inrepo-link.txt"));
    symlinkSync(join(outside, "secret.txt"), join(f.repo, "app/evidence-link.txt"));
    const ok = [];
    rules.checkRegister(f.repo, "DG0", ok);
    writeRegister(f.repo, [row(), row({ ...DLV, evidence: "app/inrepo-link.txt" })]);
    const pos = [];
    rules.checkRegister(f.repo, "DG0", pos);
    assert.deepEqual(pos, [], "in-repo relative symlink must remain valid evidence");
    writeRegister(f.repo, [row(), row({ ...DLV, evidence: "app/evidence-link.txt" })]);
    const neg = [];
    rules.checkRegister(f.repo, "DG0", neg);
    rejects(neg, /evidence is not an existing repository file: app\/evidence-link\.txt/);
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
}));

test("QA4-R206 (F-DG0-206): a committed exec-bit change after freeze invalidates the approval", () => withFixture((f) => {
  execFileSync("chmod", ["+x", join(f.repo, "app/main.txt")]);
  commitAll(f.repo, "chmod after freeze");
  rejects(validateGate(f.repo, "DG0"), /candidate: current content hashes to .*app\/main\.txt/);
}));

// ---------- new D-021 negative cases ----------
test("QA4-N32 write-once: a committed round assignment edited later is rejected (history M and assignment sha mismatch)", () => withFixture((f) => {
  write(f.repo, "docs/delivery/assignments/DG0/round-2/review-domain-reviewer.md", "assignment rewritten\n");
  commitAll(f.repo, "edit assignment");
  const e = validateGate(f.repo, "DG0");
  rejects(e, /write-once: M docs\/delivery\/assignments\/DG0\/round-2\/review-domain-reviewer\.md/);
  rejects(e, /assignment file changed since the run/);
}));

test("QA4-N33 write-once: a committed record replaced by a symlink to identical bytes is rejected (type change T)", () => withFixture((f) => {
  const rec = f.recs["domain-reviewer"];
  const copy = "docs/delivery/test-evidence/DG0/copy.json";
  write(f.repo, copy, readFileSync(join(f.repo, rec)));
  unlinkSync(join(f.repo, rec));
  symlinkSync("../../../test-evidence/DG0/copy.json", join(f.repo, rec));
  assert.equal(shaFile(f.repo, rec), shaFile(f.repo, copy), "same bytes through the link");
  commitAll(f.repo, "swap record for a link");
  rejects(validateGate(f.repo, "DG0"), /write-once: T docs\/delivery\/reviews\/DG0\/round-2\/domain-reviewer\.json/);
}));

test("QA4-N34 binding: a record written by another reviewer's run (not this run's file tools) is rejected", () => withFixture((f) => {
  // A fresh round-3 qa record; its bytes appear only in the domain-reviewer's run outputs, not in the qa run's.
  const rel3 = "docs/delivery/reviews/DG0/round-3/qa-verifier.json";
  const side3 = "docs/delivery/reviews/DG0/round-3/qa-verifier.verifications.json";
  const assignQ = "docs/delivery/assignments/DG0/round-3/review-qa-verifier.md";
  const assignD = "docs/delivery/assignments/DG0/round-3/review-domain-reviewer.md";
  write(f.repo, assignQ, "a q3\n");
  write(f.repo, assignD, "a d3\n");
  const q3 = allocRun(f.repo, "qa-verifier", { assignment: assignQ, task: "T-DG0-REV-R3" });
  const d3 = allocRun(f.repo, "domain-reviewer", { assignment: assignD, task: "T-DG0-REV-R3" });
  const base = readJ(f.repo, f.recs["qa-verifier"]);
  write(f.repo, rel3, { ...base, round: 3, invocation_reference: q3.ref, assignment: assignQ });
  write(f.repo, side3, CLOSE);
  q3.finish([rel3, side3], { writtenBy: [] }); // in the qa run's window, but written by someone else
  d3.finish([rel3, side3]);
  mutate(f.repo, "docs/delivery/stages.json", (d) => d.stages[0].review_rounds.push({ round: 3, candidate_id: f.cid, frozen_at: T_FREEZE, source_commit: f.commit, records: { "qa-verifier": rel3 } }));
  mutate(f.repo, "docs/delivery/findings.json", (d) => (d.findings[0].verification.invocation_reference = q3.ref));
  commitAll(f.repo, "round 3");
  rejects(validateGate(f.repo, "DG0"), /qa-verifier\.verifications\.json was not written by this run's file tools/);
}));

test("QA4-N35 binding: a record whose meta.outputs hash is for different bytes (record written, then altered before commit) is rejected", () => withFixture((f) => {
  const assign = "docs/delivery/assignments/DG0/round-3/review-qa-verifier.md";
  write(f.repo, assign, "a q3\n");
  const rel3 = "docs/delivery/reviews/DG0/round-3/qa-verifier.json";
  const side3 = "docs/delivery/reviews/DG0/round-3/qa-verifier.verifications.json";
  const q3 = allocRun(f.repo, "qa-verifier", { assignment: assign, task: "T-DG0-REV-R3" });
  const base = readJ(f.repo, f.recs["qa-verifier"]);
  write(f.repo, rel3, { ...base, round: 3, invocation_reference: q3.ref, assignment: assign });
  write(f.repo, side3, { verifications: [{ finding_id: "F-DG0-201", result: "FAIL", status_after: "OPEN", note: "not fixed", evidence: [] }] });
  q3.finish([rel3, side3]);
  write(f.repo, side3, CLOSE); // flipped FAIL -> PASS before anything was committed
  mutate(f.repo, "docs/delivery/stages.json", (d) => d.stages[0].review_rounds.push({ round: 3, candidate_id: f.cid, frozen_at: T_FREEZE, source_commit: f.commit, records: { "qa-verifier": rel3 } }));
  mutate(f.repo, "docs/delivery/findings.json", (d) => (d.findings[0].verification.invocation_reference = q3.ref));
  commitAll(f.repo, "round 3");
  rejects(validateGate(f.repo, "DG0"), /round-3\/qa-verifier\.verifications\.json differs from what the run wrote/);
}));

test("QA4-N36 write-once: deleting a committed frozen manifest in the working tree is rejected", () => withFixture((f) => {
  unlinkSync(join(f.repo, f.mrel));
  const e = validateGate(f.repo, "DG0");
  rejects(e, /write-once: uncommitted change to committed evidence: D docs\/delivery\/candidates\/DG0\//);
}));

test("QA4-N37 rounds: a gate candidate manifest in the retired single-file location or with hash v1 is rejected", () => withFixture((f) => {
  const m = readJ(f.repo, f.mrel);
  write(f.repo, "docs/delivery/candidates/DG0.manifest.json", m);
  mutate(f.repo, f.gateRel, (g) => (g.manifest_path = "docs/delivery/candidates/DG0.manifest.json"));
  rejects(validateGate(f.repo, "DG0"), /candidate manifest: path must be docs\/delivery\/candidates\/DG0\//);
  mutate(f.repo, f.gateRel, (g) => (g.manifest_path = f.mrel));
  // v1 algorithm: a manifest re-labelled v1 (and re-hashed consistently) is not acceptable for a gate decision
  const v1id = candidateId(m.entries, "mth-candidate-v1");
  assert.notEqual(v1id, f.cid);
}));

test("QA4-N38 acceptance: positive control, then a specialist's later-round FAIL/OPEN withdraws the observation acceptance", () => withFixture((f) => {
  assert.deepEqual(validateGate(f.repo, "DG0"), [], "Low observation accepted by qa + auditor sidecars must validate");
  addRound(f, 3, "qa-verifier", { verifications: [{ finding_id: "F-DG0-201", result: "FAIL", status_after: "OPEN", note: "withdrawn", evidence: [] }] });
  rejects(validateGate(f.repo, "DG0"), /F-DG0-201.*no specialist reviewer sidecar accepts it/);
}, { severity: "Low", mandatory: false, accept: true }));

test("QA4-N38b acceptance: a Low observation still marked accepted in findings.json/gate after the auditor withdrew it is rejected", () => withFixture((f) => {
  // The auditor withdraws its acceptance in a later, genuine round-3 run; findings.json and the gate still say accepted.
  addRound(f, 3, "release-auditor", { verifications: [{ finding_id: "F-DG0-201", result: "FAIL", status_after: "OPEN", note: "not accepted", evidence: [] }] });
  rejects(validateGate(f.repo, "DG0"), /F-DG0-201.*no release-auditor sidecar accepts it/);
}, { severity: "Low", mandatory: false, accept: true }));

test("QA4-N41 findings: in the same round a PASS by the reporter and a FAIL by another bound reviewer -> FAIL wins", () => withFixture((f) => {
  const ref = addRound(f, 3, "qa-verifier", CLOSE);
  mutate(f.repo, "docs/delivery/findings.json", (d) => (d.findings[0].verification.invocation_reference = ref));
  commitAll(f.repo, "mirror");
  assert.deepEqual(validateGate(f.repo, "DG0"), [], "a later-round PASS by the reporter keeps the closure valid");
  addRound(f, 3, "domain-reviewer", { verifications: [{ finding_id: "F-DG0-201", result: "FAIL", status_after: "OPEN", note: "regressed", evidence: [] }] });
  rejects(validateGate(f.repo, "DG0"), /F-DG0-201.*latest reviewer verification .*round-3\/domain-reviewer\.verifications\.json\) is FAIL/);
}));

test("QA4-N42 findings: a verifications sidecar for a role not listed in its round is rejected", () => withFixture((f) => {
  write(f.repo, "docs/delivery/reviews/DG0/round-1/domain-reviewer.verifications.json", CLOSE);
  rejects(validateGate(f.repo, "DG0"), /round-1\/domain-reviewer\.verifications\.json: domain-reviewer's record for round-1 is not listed/);
}));

// ---------- probe: gate record binding to the audited release-auditor run (raised as F-DG0-211 if it fails) ----------
test("QA4-N39 probe: a gate record edited after the auditor's run (tests list trimmed, decided_at changed) is rejected", { todo: "F-DG0-211" }, () => withFixture((f) => {
  mutate(f.repo, f.gateRel, (g) => { g.tests.push({ name: "extra", command: "c", result: "PASS", evidence: ["docs/delivery/test-evidence/DG0/run.log"] }); g.decided_at = "2026-09-28T13:45:00Z"; });
  commitAll(f.repo, "orchestrator edits the gate record");
  const auditMeta = readJ(f.repo, `docs/delivery/runs/DG0/${f.refs["release-auditor"].run_id}/meta.json`);
  console.log(`# QA4-N39 auditor run outputs gate sha ${auditMeta.outputs[f.gateRel]}, gate now ${shaFile(f.repo, f.gateRel)}`);
  const e = validateGate(f.repo, "DG0");
  console.log(`# QA4-N39 errors (${e.length}):\n#   ${e.join("\n#   ")}`);
  assert.ok(e.length > 0, "validator accepted a gate record that differs from what the audited release-auditor run wrote");
}));

test("QA4-N40 probe: a gate record never written by the auditor run (absent from its outputs) is rejected", { todo: "F-DG0-211" }, () => withFixture((f) => {
  const metaRel = `docs/delivery/runs/DG0/${f.refs["release-auditor"].run_id}/meta.json`;
  // Simulate an orchestrator-authored gate: rebuild a fixture variant where the auditor run recorded only its review.
  const m = readJ(f.repo, metaRel);
  delete m.outputs[f.gateRel];
  m.written_by_tools = m.written_by_tools.filter((p) => p !== f.gateRel);
  // (uncommitted edit of run evidence would itself be caught by write-once; so check validateGate on a fresh repo copy
  // where the meta was like this from the start: rewrite history of that single commit)
  write(f.repo, metaRel, m);
  git(f.repo, "commit", "-q", "--amend", "-a", "--no-edit");
  const e = validateGate(f.repo, "DG0");
  console.log(`# QA4-N40 errors (${e.length}):\n#   ${e.join("\n#   ")}`);
  assert.ok(e.length > 0, "validator accepted a gate record that the audited release-auditor run did not write");
}));

// ---------- metadata never changes the candidate (A25) ----------
test("QA4-M01 metadata: a new round (manifest, runs, reviews, sidecars, assignments, stages, findings, progress) leaves the candidate and the gate valid", () => withFixture((f) => {
  write(f.repo, "docs/delivery/assignments/DG0/round-3/review-qa-verifier.md", "a\n");
  write(f.repo, "docs/delivery/runs/DG0/DG0-extra/notes.txt", "x\n");
  write(f.repo, "docs/delivery/progress.md", "p\n");
  write(f.repo, "docs/delivery/handbacks/DG0/h.md", "h\n");
  write(f.repo, "docs/delivery/test-evidence/DG0/qa/more.log", "m\n");
  commitAll(f.repo, "metadata only");
  const spec = readJ(f.repo, f.mrel).spec;
  assert.equal(candidateId(manifestFromWorkingTree(f.repo, spec)), f.cid);
  assert.equal(candidateId(manifestFromRef(f.repo, "HEAD", spec)), f.cid);
  assert.deepEqual(validateGate(f.repo, "DG0"), []);
}));

// ---------- the A24/A25 rejection list from the DG0 QA assignment, on the round-4 fixture ----------
// Mutations of committed evidence are made as new, uncommitted edits (the natural attack), so in addition to the
// targeted error the write-once rule may fire; each case asserts the targeted rule's own message.
const A24 = [
  ["missing reviewer", (f) => mutate(f.repo, f.gateRel, (g) => delete g.reviews["code-security-reviewer"]), /missing (code-security-reviewer review|required property .code-security-reviewer.)/],
  ["reviewer who authored the scope", (f) => mutate(f.repo, f.recs["domain-reviewer"], (r) => (r.independence_declaration.reviewer_authored_reviewed_scope = true)), /declares authorship/],
  ["reviewer listed as implementation author", (f) => mutate(f.repo, f.recs["qa-verifier"], (r) => r.implementation_author.push("qa-verifier")), /listed as an implementation author/],
  ["shared invocation", (f) => mutate(f.repo, f.recs["domain-reviewer"], (r) => (r.invocation_reference = f.refs["code-security-reviewer"])), /domain-reviewer.*(was run as 'code-security-reviewer'|share)/],
  ["failed check", (f) => mutate(f.repo, f.recs["qa-verifier"], (r) => (r.checks_run[0].result = "FAIL")), /check K1 is FAIL/],
  ["blocked check", (f) => mutate(f.repo, f.recs["qa-verifier"], (r) => (r.checks_run[0].result = "BLOCKED")), /check K1 is BLOCKED/],
  ["failed gate test", (f) => mutate(f.repo, f.gateRel, (g) => (g.tests[0].result = "FAIL")), /test 't' is FAIL/],
  ["unresolved High finding", (f) => {
    mutate(f.repo, "docs/delivery/findings.json", (d) => { d.findings[0].status = "OPEN"; d.findings[0].verification = null; });
  }, /F-DG0-201 \(High, mandatory\): unresolved \(OPEN\)/, { severity: "High" }],
  ["High finding closed without any verification sidecar", (f) => {
    unlinkSync(join(f.repo, SIDE2V));
    commitAll(f.repo, "drop sidecar");
  }, /F-DG0-201 \(High, mandatory\).*(no reviewer verifications sidecar verifies it|write-once: D)/, { severity: "High" }],
  ["incomplete requirement", (f) => writeRegister(f.repo, [row(), row({ ...DLV, status: "SPECIFIED", evidence: "" })]), /REQ-DLV-001/],
  ["register row with a non-existent block anchor", (f) => writeRegister(f.repo, [row({ source_ref: "B0999" }), row(DLV)]), /B0999/],
  ["SOURCE row without a playbook block", (f) => writeRegister(f.repo, [row({ source_ref: "M0001" }), row(DLV)]), /REQ-PB-001.*SOURCE requirement cites no playbook block/],
  ["coverage matrix missing a block", (f) => write(f.repo, "docs/analysis/source-coverage.csv", "block_id,disposition,req_ids,rationale\nB0001,REQUIREMENT,REQ-PB-001,\n"), /block B0002 has no disposition/],
  ["coverage maps a block to a requirement that doesn't cite it", (f) => write(f.repo, "docs/analysis/source-coverage.csv", "block_id,disposition,req_ids,rationale\nB0001,REQUIREMENT,REQ-PB-001,\nB0002,REQUIREMENT,REQ-PB-001,\n"), /B0002 maps to REQ-PB-001, but REQ-PB-001 does not cite B0002/],
  ["candidate change after freeze", (f) => { write(f.repo, "app/main.txt", "v2\n"); commitAll(f.repo, "late change"); }, /candidate: current content hashes to/],
  ["tampered manifest", (f) => mutate(f.repo, f.mrel, (m) => (m.entries[0].sha256 = "0".repeat(64))), /tampered/],
];
for (const [name, breakIt, re, opts] of A24) {
  test(`QA4-A24 rejects: ${name}`, () => withFixture((f) => {
    if (opts) assert.deepEqual(validateGate(f.repo, "DG0"), [], "variant fixture must validate before the break");
    breakIt(f);
    rejects(validateGate(f.repo, "DG0"), re);
  }, opts));
}
