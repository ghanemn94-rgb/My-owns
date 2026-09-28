// Write-guard tests: reviewers cannot touch implementation; implementers cannot weaken gate rules.
// Run: node --test tools/agents/tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { decide } from "../guard-write.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const scopes = JSON.parse(readFileSync(join(here, "..", "write-scopes.json"), "utf8"));
const repo = mkdtempSync(join(tmpdir(), "guard-fixture-"));
execFileSync("git", ["init", "-q", repo]);
const p = (rel) => join(repo, rel);

test("reviewers may write only review records and evidence", () => {
  for (const role of ["domain-reviewer", "code-security-reviewer"]) {
    assert.equal(decide(scopes, role, p("docs/delivery/reviews/DG1/round-1/x.json")).allow, true);
    assert.equal(decide(scopes, role, p("docs/delivery/test-evidence/DG1/log.txt")).allow, true);
    assert.equal(decide(scopes, role, p("apps/api/src/server.ts")).allow, false);
    assert.equal(decide(scopes, role, p("docs/delivery/gates/DG1.json")).allow, false);
    assert.equal(decide(scopes, role, p("docs/delivery/findings.json")).allow, false);
  }
});

test("qa-verifier may add tests under tests/qa and e2e but not product code", () => {
  assert.equal(decide(scopes, "qa-verifier", p("tests/qa/dg1/auth.test.ts")).allow, true);
  assert.equal(decide(scopes, "qa-verifier", p("e2e/lifecycle.spec.ts")).allow, true);
  assert.equal(decide(scopes, "qa-verifier", p("apps/web/src/App.tsx")).allow, false);
});

test("implementers cannot edit gate rules, agent definitions, sources or gate records", () => {
  for (const role of ["solution-architect", "frontend-ux-engineer", "backend-workflow-engineer", "kpi-benefits-engineer", "devops-engineer"]) {
    assert.equal(decide(scopes, role, p("apps/api/src/server.ts")).allow, true);
    for (const rel of ["tools/gates/lib/rules.mjs", "tools/agents/write-scopes.json", ".claude/agents/qa-verifier.md",
      "docs/source/playbook.md", "docs/delivery/reviews/DG1/round-1/qa-verifier.json", "docs/delivery/gates/DG1.json",
      "docs/delivery/stages.json", "docs/delivery/runs/DG1/x/meta.json", "docs/delivery/findings.json", ".github/workflows/delivery-gates.yml"]) {
      assert.equal(decide(scopes, role, p(rel)).allow, false, `${role} must not write ${rel}`);
    }
  }
});

test("release-auditor writes gate decisions but not implementation", () => {
  assert.equal(decide(scopes, "release-auditor", p("docs/delivery/gates/DG1.json")).allow, true);
  assert.equal(decide(scopes, "release-auditor", p("packages/calc/src/index.ts")).allow, false);
});

test("transformation-analyst is limited to analysis outputs and the register", () => {
  assert.equal(decide(scopes, "transformation-analyst", p("docs/analysis/glossary.md")).allow, true);
  assert.equal(decide(scopes, "transformation-analyst", p("docs/delivery/requirements.csv")).allow, true);
  assert.equal(decide(scopes, "transformation-analyst", p("docs/delivery/decisions.md")).allow, false);
});

test("unknown roles are denied and scratch space outside a repo is allowed", () => {
  assert.equal(decide(scopes, "nobody", p("docs/analysis/x.md")).allow, false);
  const scratch = mkdtempSync(join(tmpdir(), "scratch-"));
  mkdirSync(join(scratch, "a"), { recursive: true });
  assert.equal(decide(scopes, "domain-reviewer", join(scratch, "a", "notes.md")).allow, true);
});

test("the hook entry point blocks with exit code 2 and allows with 0", () => {
  const script = join(here, "..", "guard-write.mjs");
  const block = spawnSync("node", [script, "domain-reviewer"], { input: JSON.stringify({ tool_input: { file_path: p("apps/api/x.ts") } }) });
  assert.equal(block.status, 2);
  assert.match(block.stderr.toString(), /BLOCKED by write guard/);
  const allow = spawnSync("node", [script, "domain-reviewer"], { input: JSON.stringify({ tool_input: { file_path: p("docs/delivery/reviews/DG1/a.json") } }) });
  assert.equal(allow.status, 0);
  const garbage = spawnSync("node", [script, "domain-reviewer"], { input: "{not json" });
  assert.equal(garbage.status, 2, "unreadable payload must fail closed");
});

test("implementers cannot write reviewer test evidence", () => {
  assert.equal(decide(scopes, "backend-workflow-engineer", p("docs/delivery/test-evidence/DG1/qa.log")).allow, false);
  assert.equal(decide(scopes, "backend-workflow-engineer", p("docs/delivery/handbacks/DG1/T-1.md")).allow, true);
});
