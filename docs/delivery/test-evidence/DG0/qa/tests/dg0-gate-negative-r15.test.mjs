// qa-verifier, DG0 round 15: independent negative/regression tests against the frozen candidate b7f60ed3 (7fab49c).
// Author: qa-verifier (T-DG0-REV-QA-R15). Node built-ins only. Every case builds disposable fixtures under $TMPDIR and
// never touches the candidate tree it reads from.
// Run: QA_REPO_ROOT=<clone of the candidate> node --test <this file>
//
// Not already covered by tools/gates/tests or tools/agents/tests:
//   QA15-G1  guard, D-028 prefix confusion: qa-verifier may not write qa-lookalike evidence keys (qa-x, qa2, QA, qaa) or
//            record names that only start with its role name (qa-verifier-x.json, qa-verifierX.json)
//   QA15-G2  guard, D-028 traversal: '..' through the reviewer's own area into another reviewer's record or evidence
//   QA15-G3  guard, positive control: the reviewer's own record, sidecars and evidence at any stage/round are writable
//   QA15-C1  candidate, D-005 metadata exclusion is exact: look-alike paths (reviewsX/, findings.json.bak, stages.json~,
//            trading_agent2/, test-evidence.md) ARE part of the candidate, real metadata and trading_agent/** are not
//   QA15-C2  candidate: a zero-length untracked file (what the agent sandbox leaves at a missing deny path) changes the
//            working-tree candidate, while the committed (--ref HEAD) candidate is unaffected (characterises F-DG0-236)
//   QA15-A1  F-DG0-235 checker: independent mutations of acceptance-map.md (via --map) are each rejected; control passes
//   QA15-S1  D-028 sandbox: for every reviewer role, every tracked file of the candidate lies under a denyWrite entry,
//            the role's own evidence directory is not denied and the other three reviewers' directories are
//   QA15-S2  agent_settings.py refuses a stage outside DG0-DG7 (DG9, ../x, dg0)
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

Object.assign(process.env, { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "qa15", GIT_COMMITTER_NAME: "qa15",
  GIT_AUTHOR_EMAIL: "qa15@example.invalid", GIT_COMMITTER_EMAIL: "qa15@example.invalid" });

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.QA_REPO_ROOT
  ? resolve(process.env.QA_REPO_ROOT)
  : execFileSync("git", ["-C", here, "rev-parse", "--show-toplevel"]).toString().trim();
const scratch = (p) => mkdtempSync(join(tmpdir(), p));
const git = (cwd, ...a) => execFileSync("git", ["-C", cwd, ...a], { stdio: ["ignore", "pipe", "pipe"] }).toString();

const { decide } = await import(pathToFileURL(join(ROOT, "tools/agents/guard-write.mjs")).href);
const cand = await import(pathToFileURL(join(ROOT, "tools/gates/lib/candidate.mjs")).href);
const scopes = JSON.parse(readFileSync(join(ROOT, "tools/agents/write-scopes.json"), "utf8"));
const guardRepo = scratch("qa15-guard-");
git(guardRepo, "init", "-q");
const gp = (rel) => join(guardRepo, rel);
const ROLES = { "domain-reviewer": "domain", "code-security-reviewer": "code-security", "qa-verifier": "qa", "release-auditor": "audit" };

test("QA15-G1 guard: qa-verifier may not write look-alike evidence keys or record names that merely start with its role", () => {
  for (const rel of [
    "docs/delivery/test-evidence/DG0/qa-x/x.log",
    "docs/delivery/test-evidence/DG0/qa2/x.log",
    "docs/delivery/test-evidence/DG0/qaa/x.log",
    "docs/delivery/test-evidence/DG0/QA/x.log",
    "docs/delivery/test-evidence/DG0/x-qa/x.log",
    "docs/delivery/test-evidence/qa/x.log",
    "docs/delivery/reviews/DG0/round-15/qa-verifier-x.json",
    "docs/delivery/reviews/DG0/round-15/qa-verifierX.json",
    "docs/delivery/reviews/DG0/qa-verifier.json",
    "docs/delivery/reviews/DG0/round-15/QA-VERIFIER.json",
  ]) assert.equal(decide(scopes, "qa-verifier", gp(rel), guardRepo).allow, false, `qa-verifier must not write ${rel}`);
});

test("QA15-G2 guard: '..' through a reviewer's own area into another reviewer's record or evidence is blocked", () => {
  for (const [role, key] of Object.entries(ROLES)) {
    for (const [other, otherKey] of Object.entries(ROLES)) {
      if (other === role) continue;
      for (const rel of [
        `docs/delivery/test-evidence/DG0/${key}/../${otherKey}/x.log`,
        `docs/delivery/test-evidence/DG0/${key}/round-15/../../${otherKey}/round-15/x.log`,
        `docs/delivery/reviews/DG0/round-15/${role}.json/../${other}.json`,
        `docs/delivery/reviews/DG0/round-15/../round-15/${other}.verifications.json`,
      ]) assert.equal(decide(scopes, role, gp(rel), guardRepo).allow, false, `${role} must not write ${rel}`);
    }
  }
});

test("QA15-G3 guard positive control: own record, sidecars and evidence at any stage and round are writable", () => {
  for (const [role, key] of Object.entries(ROLES)) {
    for (const rel of [`docs/delivery/reviews/DG3/round-7/${role}.json`, `docs/delivery/reviews/DG0/round-15/${role}.findings.json`,
      `docs/delivery/reviews/DG0/round-15/${role}.verifications.json`, `docs/delivery/reviews/DG0/round-15/${role}.md`,
      `docs/delivery/test-evidence/DG5/${key}/round-2/deep/x.log`]) {
      assert.equal(decide(scopes, role, gp(rel), guardRepo).allow, true, `${role} should write ${rel}`);
    }
  }
});

function candRepo() {
  const r = scratch("qa15-cand-");
  git(r, "init", "-q", "-b", "main");
  for (const [p, c] of [["src/a.txt", "a\n"], ["docs/delivery/requirements.csv", "req_id\n"], ["README.md", "r\n"]]) {
    mkdirSync(dirname(join(r, p)), { recursive: true }); writeFileSync(join(r, p), c);
  }
  git(r, "add", "-A"); git(r, "commit", "-qm", "base");
  return r;
}
const SPEC = { include: ["**"], exclude: ["trading_agent/**"] };
const wtId = (r) => cand.candidateId(cand.manifestFromWorkingTree(r, SPEC));
const refId = (r) => cand.candidateId(cand.manifestFromRef(r, "HEAD", SPEC));
const put = (r, p, c) => { mkdirSync(dirname(join(r, p)), { recursive: true }); writeFileSync(join(r, p), c); };

test("QA15-C1 candidate: metadata exclusion is exact, look-alike paths are part of the candidate", () => {
  const r = candRepo();
  const base = wtId(r);
  for (const meta of ["docs/delivery/reviews/DG0/round-99/x.json", "docs/delivery/findings.json", "docs/delivery/stages.json",
    "docs/delivery/test-evidence/DG0/qa/x.log", "docs/delivery/runs/DG0/r/meta.json", "trading_agent/bot.py"]) put(r, meta, "meta\n");
  assert.equal(wtId(r), base, "real metadata and trading_agent/** must not change the candidate");
  for (const look of ["docs/delivery/reviewsX/a.json", "docs/delivery/findings.json.bak", "docs/delivery/stages.json~",
    "trading_agent2/x.py", "docs/delivery/test-evidence.md", "docs/delivery/gates.md", "Docs/delivery/reviews/x.json"]) {
    const before = wtId(r);
    put(r, look, "x\n");
    assert.notEqual(wtId(r), before, `${look} must be part of the candidate`);
  }
});

test("QA15-C2 candidate: a zero-length untracked file (sandbox stub shape) changes the working-tree id, not the committed id", () => {
  const r = candRepo();
  const wt0 = wtId(r), ref0 = refId(r);
  assert.equal(wt0, ref0);
  for (const stub of [".bashrc", ".mcp.json", "CLAUDE.local.md", "docs/delivery/gates"]) put(r, stub, "");
  const wt1 = wtId(r);
  const added = cand.diffManifests(cand.manifestFromRef(r, "HEAD", SPEC), cand.manifestFromWorkingTree(r, SPEC)).added;
  console.log(`  QA15-C2 working-tree ${wt1.slice(0, 19)} (was ${wt0.slice(0, 19)}); added=${JSON.stringify(added)}`);
  assert.notEqual(wt1, wt0, "current behaviour: zero-length stubs are counted in the working-tree candidate (F-DG0-236)");
  assert.deepEqual(added.sort(), [".bashrc", ".mcp.json", "CLAUDE.local.md", "docs/delivery/gates"].sort());
  assert.equal(refId(r), ref0, "the committed candidate is unaffected: confirm candidates with --ref");
});

test("QA15-A1 F-DG0-235: independent mutations of the acceptance map are each rejected by check_acceptance_map.py", () => {
  const checker = join(ROOT, "docs/analysis/tools/check_acceptance_map.py");
  const map = readFileSync(join(ROOT, "docs/analysis/acceptance-map.md"), "utf8");
  const dir = scratch("qa15-map-");
  const run = (text) => {
    const f = join(dir, `m${Math.random().toString(36).slice(2)}.md`);
    writeFileSync(f, text);
    return spawnSync("python3", ["-I", "-B", checker, "--map", f], { encoding: "utf8" });
  };
  const ok = run(map);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  const mutations = [
    ["REQ-DLV-039, REQ-DLV-042;", "REQ-DLV-039;", /M2 A18.*REQ-DLV-042/],
    ["REQ-DLV-040, REQ-DLV-042;", "REQ-DLV-040;", /M2 A24.*REQ-DLV-042/],
    ["REQ-DLV-042 (DG1), REQ-S02-005 (DG7)", "REQ-S02-005 (DG7)", /M3 A24.*REQ-DLV-042/],
    ["REQ-DLV-042 (DG1), REQ-S02-005 (DG7)", "REQ-DLV-042 (DG7), REQ-S02-005 (DG7)", /M3 A24.*REQ-DLV-042/],
    ["REQ-DLV-039, REQ-DLV-042;", "REQ-DLV-039, REQ-DLV-042, REQ-S03-001;", /M2 A18.*REQ-S03-001/],
    ["| A25 | ", "| A25X | ", /M4 A25/],
  ];
  for (const [from, to, expect] of mutations) {
    assert.ok(map.includes(from), `fixture anchor missing: ${from}`);
    const res = run(map.replace(from, to));
    assert.equal(res.status, 1, `mutation '${from}' -> '${to}' should fail\n${res.stdout}`);
    assert.match(res.stdout, expect);
  }
});

function settingsFor(role, repo) {
  const res = spawnSync("python3", ["-I", "-B", join(ROOT, "tools/agents/agent_settings.py"), role, repo, repo, "DG0"], { encoding: "utf8" });
  assert.equal(res.status, 0, res.stderr);
  return JSON.parse(res.stdout).sandbox.filesystem.denyWrite.map((d) => d.slice(repo.length + 1));
}

test("QA15-S1 D-028 sandbox: every tracked candidate file is shell-denied for each reviewer, and evidence areas are per-reviewer", () => {
  const tracked = git(ROOT, "ls-files").split("\n").filter(Boolean);
  for (const [role, key] of Object.entries(ROLES)) {
    const deny = settingsFor(role, ROOT);
    const under = (p) => deny.some((d) => p === d || p.startsWith(d + "/"));
    const open = tracked.filter((p) => !under(p) && !p.startsWith(`docs/delivery/test-evidence/DG0/${key}/`));
    assert.deepEqual(open, [], `${role}: tracked files writable by the shell`);
    assert.equal(under(`docs/delivery/test-evidence/DG0/${key}/x.log`), false, `${role} must be able to write its own evidence`);
    for (const [other, otherKey] of Object.entries(ROLES)) {
      if (other !== role) assert.ok(under(`docs/delivery/test-evidence/DG0/${otherKey}/x.log`), `${role} shell must not write ${otherKey} evidence`);
    }
    assert.ok(under("docs/delivery/reviews/DG0/round-15/x.json"), `${role} shell must not write review records`);
  }
});

test("QA15-S2 agent_settings.py refuses a stage outside DG0-DG7", () => {
  for (const bad of ["DG9", "../x", "dg0", "DG0/../DG1", ""]) {
    const res = spawnSync("python3", ["-I", "-B", join(ROOT, "tools/agents/agent_settings.py"), "qa-verifier", ROOT, ROOT, bad], { encoding: "utf8" });
    assert.notEqual(res.status, 0, `stage '${bad}' must be refused`);
    assert.equal(res.stdout, "", `no settings may be emitted for stage '${bad}'`);
  }
});
