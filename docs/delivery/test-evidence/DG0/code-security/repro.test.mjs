// code-security-reviewer DG0 round-1 reproduction attempts (disposable fixtures only; never touches the candidate tree).
// Run from a disposable worktree of the candidate commit:
//   GATE_TOOLS=/tmp/dg0-sec node --test <this file>
// Each test ASSERTS THE CURRENT (DEFECTIVE) BEHAVIOUR, so a passing test == the bypass reproduces.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const TOOLS = process.env.GATE_TOOLS || process.cwd();
const imp = (rel) => import(pathToFileURL(join(TOOLS, rel)).href);
const { candidateId, manifestFromRef } = await imp("tools/gates/lib/candidate.mjs");
const { validateGate, REGISTER_COLUMNS, STAGE_ORDER } = await imp("tools/gates/lib/rules.mjs");
const { parseCsv } = await imp("tools/gates/lib/csv.mjs");
const { decide } = await imp("tools/agents/guard-write.mjs");
const scopes = JSON.parse(readFileSync(join(TOOLS, "tools/agents/write-scopes.json"), "utf8"));

const T0 = "2026-09-28T12:00:00Z";
const ROLES = ["domain-reviewer", "code-security-reviewer", "qa-verifier", "release-auditor"];
const SID = (n) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;

const sh = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
const put = (repo, rel, c) => { mkdirSync(dirname(join(repo, rel)), { recursive: true }); writeFileSync(join(repo, rel), typeof c === "string" ? c : JSON.stringify(c, null, 2)); };
const get = (repo, rel) => JSON.parse(readFileSync(join(repo, rel), "utf8"));
const edit = (repo, rel, fn) => { const d = get(repo, rel); fn(d); put(repo, rel, d); };
const csvLine = (v) => v.map((x) => (/[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x)).join(",");

/** Minimal fully valid DG0 fixture (mirrors tools/gates/tests/validator.test.mjs buildValidRepo). */
function build({ spec = { include: ["**"], exclude: [] }, beforeCommit = () => {} } = {}) {
  const repo = mkdtempSync(join(tmpdir(), "sec-fixture-"));
  sh(repo, "init", "-q", "-b", "main");
  sh(repo, "config", "user.email", "t@example.com");
  sh(repo, "config", "user.name", "t");
  put(repo, "docs/source/playbook.blocks.json", [{ id: "B0001" }]);
  put(repo, "docs/source/master-prompt.blocks.json", [{ id: "M0001" }]);
  const all = Array.from({ length: 28 }, (_, i) => `A${String(i + 1).padStart(2, "0")}`).join(" ");
  const row = { req_id: "REQ-DLV-001", class: "ENGINEERING", title: "validator", source_ref: "M0001", source_heading: "0.5",
    template_id: "", input_fields: "x", procedure: "x", output: "x", owner_roles: "x", permissions: "x", automation: "x",
    screen_api: "x", acceptance: all, increments: "P0", final_gate: "DG0", status: "IMPLEMENTED",
    evidence: "docs/delivery/test-evidence/DG0/ev.txt", notes: "" };
  put(repo, "docs/delivery/requirements.csv", [REGISTER_COLUMNS.join(","), csvLine(REGISTER_COLUMNS.map((c) => row[c]))].join("\n") + "\n");
  put(repo, "docs/analysis/source-coverage.csv", "block_id,disposition,req_ids,rationale\nB0001,NON-REQUIREMENT,,cover\n");
  put(repo, "docs/analysis/master-prompt-coverage.csv", "block_id,disposition,req_ids,rationale\nM0001,REQUIREMENT,REQ-DLV-001,\n");
  put(repo, "src/app.txt", "deliverable v1\n");
  put(repo, "docs/delivery/test-evidence/DG0/ev.txt", "PASS\n");
  beforeCommit(repo);
  const doc = { schema_version: 1, stages: STAGE_ORDER.map((id, i) => ({
    id, stage: `P${i}`, name: id, state: "PLANNED", depends_on: i ? [STAGE_ORDER[i - 1]] : [],
    implementation_owners: ["delivery-orchestrator"], candidate_spec: { include: ["**"], exclude: [] },
    candidate: { candidate_id: null, source_commit: null, frozen_at: null, manifest_path: null },
    review_rounds: [], gate_record: `docs/delivery/gates/${id}.json`, history: [{ state: "PLANNED", at: T0 }] })) };
  doc.stages[0].history.push({ state: "BUILDING", at: T0 }, { state: "REVIEWING", at: T0 }, { state: "VERIFYING", at: T0 });
  doc.stages[0].state = "VERIFYING";
  sh(repo, "add", "-A");
  sh(repo, "commit", "-q", "-m", "candidate");
  const head = sh(repo, "rev-parse", "HEAD");
  const entries = manifestFromRef(repo, head, spec);
  const cid = candidateId(entries);
  put(repo, "docs/delivery/candidates/DG0.manifest.json", { stage_id: "DG0", candidate_id: cid, source_commit: head, frozen_at: T0, spec, entries });
  doc.stages[0].candidate = { candidate_id: cid, source_commit: head, frozen_at: T0, manifest_path: "docs/delivery/candidates/DG0.manifest.json" };
  put(repo, "docs/delivery/assignments/DG0/a.md", "a\n");
  const recs = {};
  ROLES.forEach((role, i) => {
    const run_id = `DG0-T-${role}`;
    // Fabricated run record: 5 fields, no transcript.jsonl.gz, no result.json, no assignment hash.
    put(repo, `docs/delivery/runs/DG0/${run_id}/meta.json`, { role, invocation_reference: { session_id: SID(i + 1) }, exit_code: 0, is_error: false });
    const rel = `docs/delivery/reviews/DG0/round-2/${role}.json`;
    put(repo, rel, { schema_version: 1, stage_id: "DG0", round: 2, candidate_id: cid, source_commit: head, reviewer_role: role,
      invocation_reference: { kind: "claude-code-cli-session", run_id, session_id: SID(i + 1) },
      implementation_author: ["delivery-orchestrator"], independence_declaration: { reviewer_authored_reviewed_scope: false, statement: "authored nothing" },
      assignment: "docs/delivery/assignments/DG0/a.md", requirements_checked: ["REQ-DLV-001"],
      checks_run: [{ id: "C1", procedure: "run", environment: "node", expected: "PASS", actual: "PASS", exit_status: 0, result: "PASS" }],
      findings: [], verdict: "PASS", evidence_paths: ["docs/delivery/test-evidence/DG0/ev.txt"], reviewed_at: T0 });
    recs[role] = rel;
  });
  doc.stages[0].review_rounds.push({ round: 2, candidate_id: cid, records: recs });
  put(repo, "docs/delivery/stages.json", doc);
  put(repo, "docs/delivery/findings.json", { schema_version: 1, findings: [] });
  put(repo, "docs/delivery/gates/DG0.json", { schema_version: 1, stage_id: "DG0", decision: "APPROVED", candidate_id: cid, source_commit: head,
    manifest_path: "docs/delivery/candidates/DG0.manifest.json", previous_gate: null,
    reviews: { "domain-reviewer": recs["domain-reviewer"], "code-security-reviewer": recs["code-security-reviewer"], "qa-verifier": recs["qa-verifier"] },
    release_audit: recs["release-auditor"], requirements: { final_gate_ids: ["REQ-DLV-001"] },
    tests: [], blocking_conditions: [], accepted_observations: [], decided_at: T0, decided_by: "release-auditor",
    invocation_reference: get(repo, recs["release-auditor"]).invocation_reference });
  return { repo, cid, head, recs, doc };
}

function openHigh(id, stage_id) {
  return { id, stage_id, requirement: "REQ-DLV-001", severity: "High", mandatory_violation: true, title: "unfixed high finding",
    reproduction: "see round-1", expected: "fixed", actual: "not fixed", evidence: [], reported_by: "code-security-reviewer",
    reported_in: "docs/delivery/reviews/DG0/round-1/code-security-reviewer.json", owner: "delivery-orchestrator",
    status: "OPEN", history: [{ at: T0, status: "OPEN" }] };
}

test("R0 baseline: fixture with fabricated 5-field run records, no transcripts and zero gate tests passes DG0", () => {
  const { repo } = build();
  assert.deepEqual(validateGate(repo, "DG0"), []);
  assert.equal(existsSync(join(repo, "docs/delivery/runs/DG0/DG0-T-qa-verifier/transcript.jsonl.gz")), false);
});

test("R1a: an OPEN High mandatory DG0 finding relabelled stage_id DG1 escapes the terminal-state rule", () => {
  const { repo } = build();
  edit(repo, "docs/delivery/findings.json", (d) => d.findings.push(openHigh("F-DG0-101", "DG1")));
  assert.deepEqual(validateGate(repo, "DG0"), []);
  // control: with the correct stage_id it is caught
  edit(repo, "docs/delivery/findings.json", (d) => (d.findings[0].stage_id = "DG0"));
  assert.ok(validateGate(repo, "DG0").some((e) => /unresolved \(OPEN\)/.test(e)));
});

test("R1b: an OPEN High finding from an earlier FAIL round can be dropped from findings.json; round records are not cross-checked", () => {
  const { repo, cid, head } = build();
  const r1 = "docs/delivery/reviews/DG0/round-1/code-security-reviewer.json";
  const pass = get(repo, "docs/delivery/reviews/DG0/round-2/code-security-reviewer.json");
  put(repo, r1, { ...pass, round: 1, verdict: "FAIL", findings: ["F-DG0-101"] });
  put(repo, r1.replace(".json", ".findings.json"), { findings: [openHigh("F-DG0-101", "DG0")] });
  edit(repo, "docs/delivery/stages.json", (d) => d.stages[0].review_rounds.unshift({ round: 1, candidate_id: cid, records: { "code-security-reviewer": r1 } }));
  // findings.json stays empty (finding never imported / deleted)
  assert.deepEqual(validateGate(repo, "DG0"), []);
});

test("R2: symlinks are silently excluded from the candidate; a committed symlink can be repointed after approval undetected", () => {
  const { repo } = build({ beforeCommit: (r) => { mkdirSync(join(r, "src"), { recursive: true }); symlinkSync("app.txt", join(r, "src/entry.txt")); } });
  const man = get(repo, "docs/delivery/candidates/DG0.manifest.json");
  assert.equal(man.entries.some((e) => e.path === "src/entry.txt"), false, "symlink absent from manifest");
  assert.deepEqual(validateGate(repo, "DG0"), []);
  // repoint the symlink at excluded metadata whose content is uncontrolled
  put(repo, "docs/delivery/test-evidence/DG0/payload.txt", "attacker controlled\n");
  execFileSync("rm", [join(repo, "src/entry.txt")]);
  symlinkSync("../docs/delivery/test-evidence/DG0/payload.txt", join(repo, "src/entry.txt"));
  assert.deepEqual(validateGate(repo, "DG0"), [], "changed deliverable not detected");
});

test("R3: manifest.spec is not bound to stages.json candidate_spec; an exclude in the frozen manifest hides deliverables", () => {
  const { repo } = build({ spec: { include: ["**"], exclude: ["src/**"] } });
  put(repo, "src/app.txt", "deliverable v2 (changed after approval)\n");
  put(repo, "src/new-module.txt", "added after approval\n");
  assert.deepEqual(validateGate(repo, "DG0"), []);
});

test("R4: weak evidence existence checks accept '#', '.', and non-path evidence", () => {
  const { repo, recs } = build();
  edit(repo, recs["qa-verifier"], (r) => (r.evidence_paths = ["#anything", "."]));
  edit(repo, recs["domain-reviewer"], (r) => (r.assignment = "."));
  const csv = readFileSync(join(repo, "docs/delivery/requirements.csv"), "utf8").replace("docs/delivery/test-evidence/DG0/ev.txt", "done");
  writeFileSync(join(repo, "docs/delivery/requirements.csv"), csv);
  // requirements.csv is candidate content: recommit + refreeze not needed for the evidence rule itself; check the register rule in isolation
  const errs = validateGate(repo, "DG0").filter((e) => !/^candidate:/.test(e));
  assert.deepEqual(errs, []);
});

test("R5: CSV parser silently accepts characters after a closing quote", () => {
  const r = parseCsv('a,b\n"x"y,z\n');
  assert.deepEqual(r.rows, [{ a: "xy", b: "z" }]);
});

test("R6: write guard follows no symlinks, and leaves settings.local.json / .mcp.json / trading_agent writable for implementers", () => {
  const repo = mkdtempSync(join(tmpdir(), "guard-sec-"));
  sh(repo, "init", "-q");
  mkdirSync(join(repo, "docs/analysis"), { recursive: true });
  mkdirSync(join(repo, "tools/gates/lib"), { recursive: true });
  symlinkSync("../../tools/gates", join(repo, "docs/analysis/lnk"));
  // Writing through the symlinked directory lands in tools/gates/lib/rules.mjs, but the guard evaluates the lexical path.
  assert.equal(decide(scopes, "transformation-analyst", join(repo, "docs/analysis/lnk/lib/rules.mjs")).allow, true);
  assert.equal(decide(scopes, "transformation-analyst", join(repo, "tools/gates/lib/rules.mjs")).allow, false);
  for (const rel of [".claude/settings.local.json", ".mcp.json", ".claude/hooks/x.sh", "trading_agent/main.py", ".gitignore", ".gitattributes"]) {
    assert.equal(decide(scopes, "backend-workflow-engineer", join(repo, rel)).allow, true, rel);
  }
});
