// Round 8 (T-DG0-REV-QA-R8): carries every round-7 case forward. The only fixture change is that the synthetic replayed
// prompt now has the exact shape tools/agents/run-agent.sh line 56 produces (assignment path + sha256), which the round-8
// validator requires (F-DG0-133). New round-8 cases are QA8-* at the end; none exists in tools/gates/tests or tools/agents/tests.
// Independent QA negative tests for the DG0 gate validator, round 7 (A23 independence, A24 enforced advancement,
// A25 candidate integrity). Carries the round-5/6 cases (QA5-*, QA6-*) forward as regressions, with the synthetic run
// fixture upgraded to the D-022 transcript shape (CLI-replayed prompt, isReplay: true) and real Write tool_use events,
// because the round-7 validator replays transcripts itself (D-021/D-022). Write-once regexes accept the round-7
// "single blob, no M/D events" messages. New round-7 cases are QA7-*; none exists in tools/gates/tests/*.test.mjs,
// tools/agents/tests/*.test.mjs or tools/agents/tests/test_run_meta.py.
// Author: qa-verifier, task T-DG0-REV-QA-R7. Every case builds its own disposable fixture in the OS temp dir and removes it.
// Run: node --test <this file>   (QA_REPO_ROOT=<repo or worktree> selects the tooling under test)
// Intended for promotion into tests/qa/dg0/ as regression tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, unlinkSync, symlinkSync, existsSync, readdirSync } from "node:fs";
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
  const finish = (outputs = [], { authored = outputs, metaTweak, linesTweak } = {}) => {
    // D-022 shape: the CLI replays the prompt it received as a user event with isReplay: true.
    const prompt = `You are invoked as project agent '${role}' for stage ${stage}, task ${task}. Your invocation_reference is: ${JSON.stringify(ref)}. Your complete assignment is in the file /work/repo/${assignment} (sha256 ${shaFile(repo, assignment)}). Read it first, then read CLAUDE.md and docs/delivery/agent-protocol.md, and execute the assignment exactly. Your working directory is /work/repo.`;
    let lines = [
      { type: "system", subtype: "init", session_id, model: MODEL, tools: ["Read", "Bash", "Write"] },
      { type: "user", isReplay: true, message: { role: "user", content: prompt }, session_id },
    ];
    // Each authored path is produced by a successful Write whose content is the file's current bytes (relative path).
    authored.forEach((p, i) => {
      const id = `toolu_${session_id.slice(0, 8)}_${i}`;
      lines.push({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name: "Write", input: { file_path: p, content: readFileSync(join(repo, p), "utf8") } }] }, session_id });
      lines.push({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, is_error: false, content: "ok" }] }, session_id });
    });
    lines.push({ type: "result", subtype: "success", is_error: false, session_id, result: "done" });
    if (linesTweak) lines = linesTweak(lines, { prompt, ref, session_id, run_id });
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
  rejects(e, /write-once: docs\/delivery\/reviews\/DG0\/round-1\/qa-verifier\.json (in HEAD differs|has a M event|was committed with 2 different contents)/);
  rejects(e, /write-once: docs\/delivery\/reviews\/DG0\/round-2\/qa-verifier\.verifications\.json (was removed|has a D event)/);
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
  rejects(validateGate(f.repo, "DG0"), /write-once: docs\/delivery\/reviews\/DG0\/round-2\/domain-reviewer\.json (in HEAD differs|has a D event|was committed with 2 different contents)/);
}));

// Round-7 design change (D-021 revised): ANY delete event of a write-once path is now rejected, even if identical
// bytes are re-added later. The round-5 expectation (accepted) is therefore inverted.
test("QA5-N55/QA7 write-once: deleting a committed record and re-adding the identical bytes is rejected (no D events allowed, D-021 rev.)", () => withFixture((f) => {
  const rec = f.recs["domain-reviewer"];
  const orig = readFileSync(join(f.repo, rec));
  unlinkSync(join(f.repo, rec));
  commitAll(f.repo, "remove");
  write(f.repo, rec, orig);
  commitAll(f.repo, "re-add identical");
  rejects(validateGate(f.repo, "DG0"), /write-once: docs\/delivery\/reviews\/DG0\/round-2\/domain-reviewer\.json has a D event/);
}));

test("QA5-N56 write-once: an edited round assignment committed on a side branch and merged is rejected (history + sha binding)", () => withFixture((f) => {
  git(f.repo, "checkout", "-q", "-b", "side");
  write(f.repo, "docs/delivery/assignments/DG0/round-2/review-domain-reviewer.md", "assignment rewritten on a branch\n");
  commitAll(f.repo, "side edit");
  git(f.repo, "checkout", "-q", "main");
  git(f.repo, "merge", "-q", "--no-ff", "-m", "merge side", "side");
  const e = validateGate(f.repo, "DG0");
  rejects(e, /write-once: docs\/delivery\/assignments\/DG0\/round-2\/review-domain-reviewer\.md (in HEAD differs|has a M event|was committed with 2 different contents)/);
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
const RUN_META = join(ROOT, "tools/agents/run_meta.py");
/** Runs the runner's metadata step on a synthetic transcript. `lines` (optional) replaces the generated event list. */
function runnerReplay(repoFiles, toolEvents, finalFiles, { lines: rawLines, keep } = {}) {
  const repo = mkdtempSync(join(tmpdir(), "qa6-replay-"));
  const out = join(repo, "out");
  mkdirSync(out);
  try {
    const hashes = (files) => Object.fromEntries(Object.entries(files).map(([p, c]) => [p, sha(Buffer.from(c, "utf8"))]));
    writeFileSync(join(out, ".pre-snapshot.json"), JSON.stringify(hashes(repoFiles)));
    writeFileSync(join(out, ".post-snapshot.json"), JSON.stringify(hashes(finalFiles)));
    const abs = (p) => (p.startsWith("/") ? p : join(repo, p));
    const lines = rawLines ? rawLines(repo) : [
      { type: "system", subtype: "init", session_id: "s" },
      ...toolEvents.flatMap((ev, i) => {
        const id = `tu${i}`;
        const input = { ...ev.input, file_path: abs(ev.input.file_path) };
        return [
          { type: "assistant", message: { content: [{ type: "tool_use", id, name: ev.name, input }] } },
          { type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, is_error: !!ev.fail, content: ev.fail ? "denied" : "ok" }] } },
        ];
      }),
      { type: "result", subtype: "success", is_error: false, session_id: "s", result: "done" },
    ];
    writeFileSync(join(out, "transcript.jsonl.gz"), gzipSync(Buffer.from(lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n") + "\n")));
    const args = [out, "RID", "qa-verifier", "DG0", "T", "s", MODEL, repo, "HEAD0", "a.md", "0", "t0", "t1", "0", "0", repo];
    let r;
    if (existsSync(RUN_META)) {
      r = spawnSync("python3", ["-B", RUN_META, ...args]);
    } else {
      const src = readFileSync(RUNNER, "utf8");
      const start = src.indexOf('python3 - "$OUT" "$RUN_ID"');
      assert.ok(start > 0, "runner meta/replay block not found");
      const bodyStart = src.indexOf("\n", start) + 1;
      const py = src.slice(bodyStart, src.indexOf("\nPY\n", bodyStart) + 1);
      r = spawnSync("python3", ["-", ...args], { input: py });
    }
    if (keep) return { status: r.status, stderr: r.stderr.toString(), files: existsSync(out) ? readdirSync(out) : [] };
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

// =====================================================================================================================
// New round-6 cases (QA6-*). None of these exists in tools/gates/tests/validator.test.mjs, tools/agents/tests/guard.test.mjs
// or tools/agents/tests/test_run_meta.py.
// =====================================================================================================================

// ---------- A25: running the shipped checks must not change the candidate ----------
test("QA6-N60 A25: on a fresh clone, running the shipped runner-metadata unit tests (CI + prefreeze step) leaves the candidate ID and the tree unchanged", () => {
  const clone = mkdtempSync(join(tmpdir(), "qa6-clone-"));
  try {
    execFileSync("git", ["clone", "-q", "--no-hardlinks", ROOT, clone], { stdio: "ignore" });
    execFileSync("git", ["-C", clone, "checkout", "-q", git(ROOT, "rev-parse", "HEAD")], { stdio: "ignore" });
    const cidOf = () => JSON.parse(execFileSync(process.execPath, [join(clone, "tools/gates/candidate.mjs"), "--stage", "DG0"], { cwd: clone }).toString()).candidate_id;
    const before = cidOf();
    const tests = join(clone, "tools/agents/tests");
    if (existsSync(join(tests, "test_run_meta.py"))) {
      const env = { ...process.env };
      delete env.PYTHONDONTWRITEBYTECODE;
      const r = spawnSync("python3", ["-m", "unittest", "discover", "-s", "tools/agents/tests", "-p", "test_*.py"], { cwd: clone, env });
      assert.equal(r.status, 0, r.stderr.toString());
    }
    const dirty = git(clone, "status", "--porcelain", "--", ".", ":(exclude)docs/delivery");
    const after = cidOf();
    console.log(`# QA6-N60 candidate before=${before} after=${after}\n# QA6-N60 dirty after tests:\n${dirty.split("\n").map((l) => `#   ${l}`).join("\n")}`);
    assert.equal(dirty, "", "running a shipped check dirtied the candidate tree");
    assert.equal(after, before, "running a shipped check changed the candidate ID");
  } finally {
    rmSync(clone, { recursive: true, force: true });
  }
});

// ---------- run binding: the orphaned round-5 shape (evidence without meta.json) ----------
test("QA6-N61 binding: a review whose run directory has a transcript and result but no meta.json (the orphaned round-5 shape) is rejected", () => withFixture((f) => {
  rmSync(join(f.repo, metaOf(f, "qa-verifier")));
  commitAll(f.repo, "runner crashed before meta.json");
  const errors = validateGate(f.repo, "DG0");
  console.log(`# QA6-N61 errors (${errors.length}):\n${errors.map((e) => `#   ${e}`).join("\n")}`);
  rejects(errors, /qa-verifier/);
}));

test("QA6-N62 binding: a run whose meta records no result line (is_error, subtype no-result-line) cannot bind a PASS review", () => withFixture((f) => {
  rewriteMetaInHistory(f, "domain-reviewer", (m) => { m.is_error = true; m.subtype = "no-result-line"; delete m.result_session_id; });
  const errors = validateGate(f.repo, "DG0");
  console.log(`# QA6-N62 errors (${errors.length}):\n${errors.map((e) => `#   ${e}`).join("\n")}`);
  rejects(errors, /domain-reviewer/);
}));

test("QA6-N63 binding: a run whose meta.json hashes do not match its committed transcript (transcript replaced after the run) is rejected", () => withFixture((f) => {
  const t = `docs/delivery/runs/DG0/${f.refs["qa-verifier"].run_id}/transcript.jsonl.gz`;
  write(f.repo, t, gzipSync(Buffer.from(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "forged" }) + "\n")));
  commitAll(f.repo, "replace transcript");
  const errors = validateGate(f.repo, "DG0");
  console.log(`# QA6-N63 errors (${errors.length}):\n${errors.map((e) => `#   ${e}`).join("\n")}`);
  rejects(errors, /transcript|qa-verifier/);
}));

// ---------- the round-6 metadata step (tools/agents/run_meta.py) ----------
test("QA6-RP7 run_meta: a session resumed after a classifier outage (two transcript segments, two result lines) binds a Write from segment 1 edited in segment 2, and meta reflects the last result", () => {
  const m = runnerReplay({}, [], { "r/a.json": '{"v":"PASS"}' }, {
    lines: (repo) => [
      { type: "system", subtype: "init", session_id: "s" },
      { type: "assistant", message: { content: [{ type: "tool_use", id: "a1", name: "Write", input: { file_path: join(repo, "r/a.json"), content: '{"v":"TBD"}' } }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "a1", is_error: false, content: "ok" }] } },
      { type: "result", subtype: "error_during_execution", is_error: true, session_id: "s", result: "no safety verdict" },
      { type: "system", subtype: "init", session_id: "s" },
      { type: "user", message: "Your previous turn in this session was interrupted" },
      { type: "assistant", message: { content: [{ type: "tool_use", id: "b1", name: "Edit", input: { file_path: join(repo, "r/a.json"), old_string: "TBD", new_string: "PASS" } }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "b1", is_error: false, content: "ok" }] } },
      { type: "result", subtype: "success", is_error: false, session_id: "s", result: "done", num_turns: 9 },
    ],
  });
  assert.equal(m.tool_authored["r/a.json"], sha(Buffer.from('{"v":"PASS"}')));
  assert.equal(m.is_error, false);
  assert.equal(m.subtype, "success");
});

test("QA6-RP8 run_meta: MultiEdit is replayed (all edits apply -> bound); one missing old_string poisons the file", () => {
  const ok = runnerReplay({}, [
    { name: "Write", input: { file_path: "r/a.json", content: "alpha beta gamma" } },
    { name: "MultiEdit", input: { file_path: "r/a.json", edits: [{ old_string: "alpha", new_string: "A" }, { old_string: "gamma", new_string: "G" }] } },
  ], { "r/a.json": "A beta G" });
  assert.equal(ok.tool_authored["r/a.json"], sha(Buffer.from("A beta G")));
  const bad = runnerReplay({}, [
    { name: "Write", input: { file_path: "r/a.json", content: "alpha beta" } },
    { name: "MultiEdit", input: { file_path: "r/a.json", edits: [{ old_string: "alpha", new_string: "A" }, { old_string: "zeta", new_string: "Z" }] } },
  ], { "r/a.json": "A beta" });
  assert.equal(bad.tool_authored["r/a.json"], undefined);
});

test("QA6-RP9 run_meta: bilingual content (Arabic RTL text, emoji, CRLF) is bound byte-exactly as UTF-8", () => {
  const body = '{"note":"تم التحقق من الإصلاح — verified ✅"}\r\n';
  const m = runnerReplay({}, [{ name: "Write", input: { file_path: "r/ar.json", content: body } }], { "r/ar.json": body });
  assert.equal(m.tool_authored["r/ar.json"], sha(Buffer.from(body, "utf8")));
  const m2 = runnerReplay({}, [{ name: "Write", input: { file_path: "r/ar.json", content: body } }], { "r/ar.json": body.replace("\r\n", "\n") });
  assert.equal(m2.tool_authored["r/ar.json"], undefined, "a CRLF->LF rewrite after the Write must not bind");
});

test("QA6-RP10 run_meta: a sibling path that merely shares the repo-root prefix (<repo>-evil/...) is not mapped into the repository", () => {
  const m = runnerReplay({}, [], {}, {
    lines: (repo) => [
      { type: "assistant", message: { content: [{ type: "tool_use", id: "x1", name: "Write", input: { file_path: `${repo}-evil/docs/delivery/reviews/x.json`, content: "x" } }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "x1", is_error: false, content: "ok" }] } },
      { type: "result", subtype: "success", is_error: false, session_id: "s", result: "done" },
    ],
  });
  assert.deepEqual(m.written_by_tools, []);
  assert.deepEqual(m.tool_authored, {});
});

test("QA6-RP11 run_meta: an unrelated failed tool_result does not unbind a successful Write; a failed Edit after a Write leaves the Write's bytes bound", () => {
  const m = runnerReplay({}, [], { "r/a.json": "keep" }, {
    lines: (repo) => [
      { type: "assistant", message: { content: [{ type: "tool_use", id: "w1", name: "Write", input: { file_path: join(repo, "r/a.json"), content: "keep" } }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "w1", is_error: false, content: "ok" }] } },
      { type: "assistant", message: { content: [{ type: "tool_use", id: "b1", name: "Bash", input: { command: "false" } }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "b1", is_error: true, content: "exit 1" }] } },
      { type: "assistant", message: { content: [{ type: "tool_use", id: "e1", name: "Edit", input: { file_path: join(repo, "r/a.json"), old_string: "keep", new_string: "gone" } }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "e1", is_error: true, content: "denied by guard" }] } },
      { type: "result", subtype: "success", is_error: false, session_id: "s", result: "done" },
    ],
  });
  assert.equal(m.tool_authored["r/a.json"], sha(Buffer.from("keep")));
});

test("QA6-RP12 run_meta: a transcript with no result line yields is_error/no-result-line, and a corrupt snapshot fails loudly without meta.json while keeping the snapshots", () => {
  const m = runnerReplay({}, [], {}, { lines: () => [{ type: "system", subtype: "init", session_id: "s" }] });
  assert.equal(m.is_error, true);
  assert.equal(m.subtype, "no-result-line");
  const repoFiles = {};
  const r = (() => {
    const repo = mkdtempSync(join(tmpdir(), "qa6-corrupt-"));
    const out = join(repo, "out");
    mkdirSync(out);
    try {
      writeFileSync(join(out, ".pre-snapshot.json"), JSON.stringify(repoFiles));
      writeFileSync(join(out, ".post-snapshot.json"), "{not json");
      writeFileSync(join(out, "transcript.jsonl.gz"), gzipSync(Buffer.from('{"type":"result","is_error":false}\n')));
      const res = spawnSync("python3", ["-B", RUN_META, out, "RID", "qa-verifier", "DG0", "T", "s", MODEL, repo, "H", "a.md", "0", "t0", "t1", "0", "0", repo]);
      return { status: res.status, files: readdirSync(out).sort() };
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  })();
  assert.notEqual(r.status, 0);
  assert.ok(!r.files.includes("meta.json"), `meta.json must not exist: ${r.files}`);
  assert.ok(r.files.includes(".pre-snapshot.json") && r.files.includes(".post-snapshot.json"));
});

// =====================================================================================================================
// New round-7 cases (QA7-*). None of these exists in tools/gates/tests/validator.test.mjs, tools/agents/tests/guard.test.mjs
// or tools/agents/tests/test_run_meta.py. They target the round-6 repair and D-022.
// =====================================================================================================================
const R3 = "docs/delivery/reviews/DG0/round-3/qa-verifier.json";
const R3V = "docs/delivery/reviews/DG0/round-3/qa-verifier.verifications.json";
const closeWith = (f, linesTweak, metaTweak) => {
  const ref = addRound(f, 3, "qa-verifier", CLOSE, { finishOpts: { linesTweak, metaTweak } });
  mirrorClosure(f, ref);
  return validateGate(f.repo, "DG0");
};
const logErrors = (name, e) => console.log(`# ${name} errors (${e.length}):\n${e.map((x) => `#   ${x}`).join("\n")}`);
const replayIdx = (lines) => lines.findIndex((l) => l.type === "user" && l.isReplay === true);

// ---------- D-022: prompt binding through CLI replay ----------
test("QA7-N70 D-022: a transcript carrying the runner prompt only as a plain (non-replayed) user message, i.e. the pre-D-022 shape, cannot close a finding", () => withFixture((f) => {
  const e = closeWith(f, (lines) => { delete lines[replayIdx(lines)].isReplay; return lines; });
  logErrors("QA7-N70", e);
  rejects(e, /CLI-replayed runner prompt for 'qa-verifier'/);
}));

test("QA7-N71 D-022: the prompt text inside a tool_result of a replayed user event (e.g. the agent reading run-agent.sh output) does not count", () => withFixture((f) => {
  const e = closeWith(f, (lines, { prompt }) => {
    lines[replayIdx(lines)].message.content = [{ type: "tool_result", tool_use_id: "x", content: prompt }];
    return lines;
  });
  logErrors("QA7-N71", e);
  rejects(e, /CLI-replayed runner prompt/);
}));

test("QA7-N72 D-022: a replayed prompt copied from another role's run (right run_id text, wrong role) is rejected", () => withFixture((f) => {
  const e = closeWith(f, (lines, { prompt }) => {
    lines[replayIdx(lines)].message.content = prompt.replace("project agent 'qa-verifier'", "project agent 'domain-reviewer'");
    return lines;
  });
  logErrors("QA7-N72", e);
  rejects(e, /CLI-replayed runner prompt for 'qa-verifier'/);
}));

test("QA7-N73 D-022: a replayed prompt whose session_id differs from the run's session is rejected", () => withFixture((f) => {
  const e = closeWith(f, (lines, { prompt, session_id }) => {
    lines[replayIdx(lines)].message.content = prompt.replace(`"session_id":"${session_id}"`, `"session_id":"99999999-5555-4555-8555-555555555555"`);
    return lines;
  });
  logErrors("QA7-N73", e);
  rejects(e, /CLI-replayed runner prompt/);
}));

test("QA7-N74 D-022: a replayed prompt for another stage (DG1) is rejected; the same prompt as an array of text blocks is accepted (control)", () => {
  withFixture((f) => {
    const e = closeWith(f, (lines, { prompt }) => {
      lines[replayIdx(lines)].message.content = prompt.replace("for stage DG0", "for stage DG1");
      return lines;
    });
    logErrors("QA7-N74a", e);
    rejects(e, /CLI-replayed runner prompt/);
  });
  withFixture((f) => {
    const e = closeWith(f, (lines, { prompt }) => {
      lines[replayIdx(lines)].message.content = [{ type: "text", text: prompt.slice(0, 40) }, { type: "text", text: prompt.slice(40) }];
      return lines;
    });
    assert.deepEqual(e, [], "array-of-text replayed prompt should bind");
  });
});

// ---------- D-021 (round-6 repair): the validator replays the transcript itself ----------
test("QA7-N75 replay: meta.tool_authored/outputs are hash-consistent with the file, but the transcript's own Write produced different bytes (forged meta) -> rejected", () => withFixture((f) => {
  const e = closeWith(f, (lines) => {
    for (const l of lines) for (const c of (Array.isArray(l.message?.content) ? l.message.content : []))
      if (c.type === "tool_use" && c.input.file_path === R3V) c.input.content = c.input.content.replace("CLOSED_VERIFIED", "OPEN");
    return lines;
  });
  logErrors("QA7-N75", e);
  rejects(e, /round-3\/qa-verifier\.verifications\.json differs from the replay of this run's transcript/);
}));

test("QA7-N76 replay: the only Write of the sidecar failed (tool_result is_error, e.g. guard-denied) although meta claims it tool-authored -> rejected", () => withFixture((f) => {
  const e = closeWith(f, (lines) => {
    const use = lines.flatMap((l) => (Array.isArray(l.message?.content) ? l.message.content : [])).find((c) => c.type === "tool_use" && c.input.file_path === R3V);
    for (const l of lines) for (const c of (Array.isArray(l.message?.content) ? l.message.content : []))
      if (c.type === "tool_result" && c.tool_use_id === use.id) c.is_error = true;
    return lines;
  });
  logErrors("QA7-N76", e);
  rejects(e, /round-3\/qa-verifier\.verifications\.json cannot be reconstructed from this run's own successful Write\/Edit calls/);
}));

test("QA7-N77 replay (control): Write of a draft, then a successful Edit producing the final bytes, plus an unrelated failed Edit, binds; an absolute path under meta.cwd binds too", () => withFixture((f) => {
  const e = closeWith(f, (lines, { session_id }) => {
    const out = [];
    for (const l of lines) {
      const c0 = Array.isArray(l.message?.content) ? l.message.content[0] : null;
      if (l.type === "assistant" && c0?.type === "tool_use" && c0.input.file_path === R3V) {
        const final = c0.input.content;
        c0.input = { file_path: `/fake/cwd/${R3V}`, content: final.replace("CLOSED_VERIFIED", "DRAFT_STATUS") };
        out.push(l);
        continue;
      }
      out.push(l);
      if (l.type === "user" && Array.isArray(l.message?.content) && l.message.content[0]?.tool_use_id?.endsWith("_1")) {
        out.push({ type: "assistant", message: { content: [{ type: "tool_use", id: "e1", name: "Edit", input: { file_path: R3V, old_string: "DRAFT_STATUS", new_string: "CLOSED_VERIFIED" } }] }, session_id });
        out.push({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "e1", is_error: false, content: "ok" }] }, session_id });
        out.push({ type: "assistant", message: { content: [{ type: "tool_use", id: "e2", name: "Edit", input: { file_path: R3V, old_string: "NOT-THERE", new_string: "x" } }] }, session_id });
        out.push({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "e2", is_error: true, content: "String not found" }] }, session_id });
      }
    }
    return out;
  }, (m) => ({ ...m, cwd: "/fake/cwd" }));
  logErrors("QA7-N77 (control, meta.cwd=/fake/cwd)", e);
  assert.deepEqual(e, [], "Write(abs path under cwd) + Edit chain should bind");
  const lines = [
    { type: "assistant", message: { content: [{ type: "tool_use", id: "w", name: "Write", input: { file_path: "/fake/cwd/a.json", content: "A-DRAFT" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "w", is_error: false }] } },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "e", name: "Edit", input: { file_path: "/fake/cwd/a.json", old_string: "DRAFT", new_string: "FINAL" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "e", is_error: false }] } },
  ];
  assert.equal(rules.replayToolContent(lines, "/fake/cwd", "a.json"), "A-FINAL");
  assert.equal(rules.replayToolContent(lines, "/fake/cw", "d/a.json"), null, "prefix-sharing cwd must not map");
}));

// ---------- round-6 repair: single-blob write-once, back-dating ----------
test("QA7-N78 history: a commit back-dated before its parent (GIT_COMMITTER_DATE) anywhere in history is rejected", () => withFixture((f) => {
  write(f.repo, "docs/delivery/progress.md", "p\n");
  git(f.repo, "add", "-A");
  execFileSync("git", ["-C", f.repo, "commit", "-q", "-m", "back-dated"], { env: { ...process.env, GIT_COMMITTER_DATE: "2001-01-01T00:00:00Z", GIT_AUTHOR_DATE: "2001-01-01T00:00:00Z" } });
  const e = validateGate(f.repo, "DG0");
  logErrors("QA7-N78", e);
  rejects(e, /history: commit [0-9a-f]{10} is back-dated before its parent/);
}));

test("QA7-N79 write-once: the same review path added on two branches with different bytes, merged keeping ours, is rejected (two blobs)", () => withFixture((f) => {
  const p = "docs/delivery/reviews/DG0/round-9/notes.json";
  git(f.repo, "checkout", "-q", "-b", "side");
  write(f.repo, p, { v: "side" });
  commitAll(f.repo, "side add");
  git(f.repo, "checkout", "-q", "main");
  write(f.repo, p, { v: "main" });
  commitAll(f.repo, "main add");
  git(f.repo, "merge", "-q", "--no-ff", "-s", "ours", "-m", "merge side (ours)", "side");
  const e = validateGate(f.repo, "DG0");
  logErrors("QA7-N79", e);
  rejects(e, /write-once: docs\/delivery\/reviews\/DG0\/round-9\/notes\.json (was committed with 2 different contents|has a M event)/);
}));

test("QA7-N80 write-once: a committed review record turned into a symlink to an identical copy (type change) is rejected", () => withFixture((f) => {
  const rec = f.recs["domain-reviewer"];
  write(f.repo, "docs/delivery/test-evidence/DG0/copy.json", readFileSync(join(f.repo, rec)));
  unlinkSync(join(f.repo, rec));
  symlinkSync("../../../test-evidence/DG0/copy.json", join(f.repo, rec));
  commitAll(f.repo, "type change");
  const e = validateGate(f.repo, "DG0");
  logErrors("QA7-N80", e);
  rejects(e, /write-once: docs\/delivery\/reviews\/DG0\/round-2\/domain-reviewer\.json has a T event/);
}));

test("QA7-N81 write-once: modify a record on a side branch then revert it there (HEAD bytes unchanged) and merge -> the M events are still rejected", () => withFixture((f) => {
  const rec = f.recs["qa-verifier"];
  const orig = readFileSync(join(f.repo, rec));
  git(f.repo, "checkout", "-q", "-b", "side");
  mutate(f.repo, rec, (r) => (r.verdict = "FAIL"));
  commitAll(f.repo, "tamper");
  write(f.repo, rec, orig);
  commitAll(f.repo, "untamper");
  git(f.repo, "checkout", "-q", "main");
  git(f.repo, "merge", "-q", "--no-ff", "-m", "merge", "side");
  assert.ok(readFileSync(join(f.repo, rec)).equals(orig));
  const e = validateGate(f.repo, "DG0");
  logErrors("QA7-N81", e);
  rejects(e, /write-once: docs\/delivery\/reviews\/DG0\/round-2\/qa-verifier\.json has a M event/);
}));

// ---------- A25: pre-freeze dirty check compares candidate IDs (round-6 repair of F-DG0-131/220) ----------
test("QA7-N82 A25 prefreeze: on a fresh clone an ignored __pycache__ file does not fail prefreeze, but an untracked non-ignored candidate file does", { timeout: 900000 }, () => {
  const clone = mkdtempSync(join(tmpdir(), "qa7-pf-"));
  try {
    execFileSync("git", ["clone", "-q", "--no-hardlinks", ROOT, clone], { stdio: "ignore" });
    execFileSync("git", ["-C", clone, "checkout", "-q", git(ROOT, "rev-parse", "HEAD")], { stdio: "ignore" });
    write(clone, "tools/gates/__pycache__/x.cpython-311.pyc", "bytecode");
    const ok = spawnSync("bash", ["tools/gates/prefreeze.sh", "DG0"], { cwd: clone, encoding: "utf8" });
    console.log(`# QA7-N82 ignored-pyc prefreeze exit=${ok.status}\n${ok.stdout.split("\n").map((l) => `#   ${l}`).join("\n")}`);
    assert.equal(ok.status, 0);
    write(clone, "tools/gates/lib/late-addition.mjs", "export const x = 1;\n");
    const bad = spawnSync("bash", ["tools/gates/prefreeze.sh", "DG0"], { cwd: clone, encoding: "utf8" });
    console.log(`# QA7-N82 untracked-file prefreeze exit=${bad.status}\n${bad.stdout.split("\n").filter((l) => /candidate/.test(l)).map((l) => `#   ${l}`).join("\n")}`);
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /FAIL  working-tree candidate \(sha256:[0-9a-f]{64}\) differs from HEAD/);
  } finally {
    rmSync(clone, { recursive: true, force: true });
  }
});

// ---------- D-022 in the runner itself (static; the live behaviour is checked against this run's own transcript) ----------
test("QA7-N83 runner: both the first run and every resume pipe a stream-json user message with --input-format stream-json --replay-user-messages, and the prompt prefix equals what the validator requires", () => {
  const sh = readFileSync(RUNNER, "utf8");
  const calls = sh.split("\n").filter((l) => !/^\s*#/.test(l) && /claude -p --agent/.test(l));
  assert.equal(calls.length, 2, "expected the first-run and resume invocations");
  for (const c of calls) assert.match(c, /user_message "\$(RESUME_)?PROMPT" \| claude -p/);
  assert.equal((sh.match(/--input-format stream-json --replay-user-messages/g) || []).length, 2);
  assert.ok(!/--verbose "\$(RESUME_)?PROMPT"/.test(sh), "prompt must not be passed as an argument any more");
  assert.match(sh, /PROMPT="You are invoked as project agent '\$\{ROLE\}' for stage \$\{STAGE\}, /);
  const rulesSrc = readFileSync(join(ROOT, "tools/gates/lib/rules.mjs"), "utf8");
  assert.ok(rulesSrc.includes("startsWith(`You are invoked as project agent '${role}' for stage ${stageId}`)"));
});

// Informational probe: a Write tool_use with no tool_result at all (interrupted) is treated as successful by the replay.
test("QA7-P02 probe (informational): replay of a Write that has no tool_result line", () => {
  const lines = [{ type: "assistant", message: { content: [{ type: "tool_use", id: "w", name: "Write", input: { file_path: "a.json", content: "X" } }] } }];
  console.log(`# QA7-P02 replay without tool_result -> ${JSON.stringify(rules.replayToolContent(lines, "/r", "a.json"))}`);
});

// ======================= Round 8 (T-DG0-REV-QA-R8): F-DG0-132 / F-DG0-133 / F-DG0-011 / F-DG0-222 =======================
// None of these cases exists in tools/gates/tests/validator.test.mjs (which covers only "" / "\n\n\n" transcripts and a
// prompt naming round-9/other.md with an all-zero sha256).
const R3A = "docs/delivery/assignments/DG0/round-3/review-qa-verifier.md";
/** Close F-DG0-201 in round 3 with a run whose transcript bytes are replaced by `raw` (meta hash kept consistent). */
const closeWithRawTranscript = (f, raw) => closeWith(f, undefined, (m) => {
  const rel = `docs/delivery/runs/DG0/${m.run_id}/transcript.jsonl.gz`;
  if (raw === null) {
    unlinkSync(join(f.repo, rel));
    delete m.transcript_sha256;
  } else {
    write(f.repo, rel, raw);
    m.transcript_sha256 = sha(raw);
  }
  return m;
});
const setPrompt = (fn) => (lines, ctx) => {
  lines[replayIdx(lines)].message.content = fn(ctx.prompt, ctx);
  return lines;
};

test("QA8-C00 control: the round-8 fixture (runner-shaped prompt with assignment + sha256) closes the finding cleanly", () => withFixture((f) => {
  const e = closeWith(f);
  logErrors("QA8-C00", e);
  assert.deepEqual(e, []);
}));

test("QA8-N84 F-DG0-132: a 0-byte transcript that is not even gzip fails the gzip check AND every transcript check", () => withFixture((f) => {
  const e = closeWithRawTranscript(f, Buffer.alloc(0));
  logErrors("QA8-N84", e);
  rejects(e, /transcript is not valid gzip/);
  rejects(e, /transcript is empty/);
  rejects(e, /no init line/);
  rejects(e, /CLI-replayed runner prompt/);
  rejects(e, /does not end in a successful result/);
  rejects(e, /cannot be reconstructed from this run's own successful Write\/Edit calls/);
}));

test("QA8-N85 F-DG0-132: a gzip transcript of non-JSON garbage lines (non-empty, all unparsable) fails every transcript check", () => withFixture((f) => {
  const e = closeWithRawTranscript(f, gzipSync(Buffer.from("not json\n{broken\n]]]\n")));
  logErrors("QA8-N85", e);
  rejects(e, /no init line/);
  rejects(e, /CLI-replayed runner prompt/);
  rejects(e, /does not end in a successful result/);
  rejects(e, /cannot be reconstructed/);
}));

test("QA8-N86 F-DG0-132: a missing transcript file (meta hash removed as well) fails every transcript check", () => withFixture((f) => {
  const e = closeWithRawTranscript(f, null);
  logErrors("QA8-N86", e);
  rejects(e, /missing transcript\.jsonl\.gz/);
  rejects(e, /transcript is empty/);
  rejects(e, /no init line/);
}));

test("QA8-N87 F-DG0-133: the right assignment path but the sha256 of other content (e.g. a pre-edit version) is rejected", () => withFixture((f) => {
  const e = closeWith(f, setPrompt((p) => p.replace(/\(sha256 [0-9a-f]{64}\)/, `(sha256 ${sha("assignment qa-verifier r3 (older draft)\n")})`)));
  logErrors("QA8-N87", e);
  rejects(e, /the replayed prompt names assignment .*round-3\/review-qa-verifier\.md/);
}));

test("QA8-N88 F-DG0-133: another real assignment of the same role with ITS correct sha256 (round-2) is rejected", () => withFixture((f) => {
  const r2 = "docs/delivery/assignments/DG0/round-2/review-qa-verifier.md";
  const e = closeWith(f, setPrompt((p) => p.replace(/in the file \S+ \(sha256 [0-9a-f]{64}\)/, `in the file /work/repo/${r2} (sha256 ${shaFile(f.repo, r2)})`)));
  logErrors("QA8-N88", e);
  rejects(e, /the replayed prompt names assignment .*round-2\/review-qa-verifier\.md/);
}));

test("QA8-N89 F-DG0-133: a suffix-sibling path (/work/repo/xdocs/...) whose tail equals meta.assignment minus its first char is rejected", () => withFixture((f) => {
  const e = closeWith(f, setPrompt((p) => p.replace(`/work/repo/${R3A}`, `/work/repo/x${R3A}`)));
  logErrors("QA8-N89", e);
  rejects(e, /the replayed prompt names assignment/);
}));

test("QA8-N90 F-DG0-133: a replayed prompt with no 'assignment ... (sha256 ...)' clause at all is rejected", () => withFixture((f) => {
  const e = closeWith(f, setPrompt((p) => p.replace(/ Your complete assignment is in the file \S+ \(sha256 [0-9a-f]{64}\)\./, "")));
  logErrors("QA8-N90", e);
  rejects(e, /names no assignment file and sha256/);
}));

test("QA8-N91 F-DG0-133: an upper-case hex sha256 in the prompt (not what the runner emits) is rejected, never silently accepted", () => withFixture((f) => {
  const e = closeWith(f, setPrompt((p) => p.replace(/\(sha256 ([0-9a-f]{64})\)/, (_, h) => `(sha256 ${h.toUpperCase()})`)));
  logErrors("QA8-N91", e);
  rejects(e, /names no assignment file and sha256|replayed prompt names assignment/);
}));

test("QA8-N92 transcript: an init line whose model differs from meta.model_requested is rejected", () => withFixture((f) => {
  const e = closeWith(f, (lines) => { lines[0].model = "claude-haiku-x"; return lines; });
  logErrors("QA8-N92", e);
  rejects(e, /transcript model claude-haiku-x != requested/);
}));

test("QA8-P03 probe (informational): the prompt names the right relative assignment under a different absolute root", () => withFixture((f) => {
  const e = closeWith(f, setPrompt((p) => p.replace(`/work/repo/${R3A}`, `/somewhere/else/${R3A}`)));
  logErrors("QA8-P03 (informational; sha256 still binds the content)", e);
}));

test("QA8-S01 F-DG0-011 static: all ten agent definitions state the no-real-approval rule and that G6 never implies DG7", () => {
  const dir = join(ROOT, ".claude/agents");
  const files = readdirSync(dir).filter((n) => n.endsWith(".md"));
  assert.equal(files.length, 10, `expected 10 agent definitions, found ${files.length}`);
  for (const n of files) {
    const t = readFileSync(join(dir, n), "utf8");
    assert.match(t, /never grant a real business, Finance or IT approval/, `${n}: no-real-approval rule missing`);
    assert.match(t, /G6 never implies engineering gate DG7/, `${n}: G6/DG7 rule missing`);
  }
});

test("QA8-S02 F-DG0-222 static: agents.md documents the runner's actual stream-json/replay invocation and the D-022/F-DG0-132/133 binding conditions", () => {
  const doc = readFileSync(join(ROOT, "docs/delivery/agents.md"), "utf8");
  const sh = readFileSync(RUNNER, "utf8");
  for (const flag of ["--input-format stream-json", "--replay-user-messages", "--output-format stream-json", "--verbose", "--permission-mode auto", "--session-id", "--settings"]) {
    assert.ok(sh.includes(flag), `runner lacks ${flag}`);
    assert.ok(doc.includes(flag), `agents.md lacks ${flag}`);
  }
  assert.ok(!/--verbose "<pointer/.test(doc), "agents.md still passes the prompt as a positional argument");
  assert.match(doc, /isReplay: true/);
  assert.match(doc, /F-DG0-133/);
  assert.match(doc, /empty transcript fails/);
  assert.match(doc, /The runner snapshots the tree/);
  assert.match(doc, /the runner auto-commits/);
});

// F-DG0-223 (new, Low): the runner accepts a repository/--cwd path containing a space (no validation in run-agent.sh),
// and its prompt then names "/path with space/docs/..."; the F-DG0-133 regex `in the file (\S+) \(sha256 ...\)` cannot
// match that, so every genuine run from such a checkout is refused. Expected: a genuine runner-shaped prompt binds.
// This case FAILS on candidate 90ad5271 (it documents the defect) and should pass once fixed.
test("QA8-F223 portability: a genuine runner-shaped prompt from a checkout whose absolute path contains a space binds", () => withFixture((f) => {
  const e = closeWith(f, setPrompt((p) => p.replaceAll("/work/repo", "/home/Jane Doe/My Projects/repo")));
  logErrors("QA8-F223", e);
  assert.deepEqual(e, [], "a genuine run from a path with a space is refused");
}));
