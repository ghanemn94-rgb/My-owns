// qa-verifier, DG0 round 18: independent register / coverage negative tests (A24 items) against the CURRENT rules.
// Author: qa-verifier (T-DG0-REV-QA-R18). Node built-ins only. Each case clones the candidate into $TMPDIR, applies ONE
// mutation to the real register or coverage matrix, and runs the real CLI `node tools/gates/validate.mjs --register DG0`
// in the clone. The control (no mutation) must exit 0; every mutation must exit non-zero and name the defect.
// Run: QA_REPO_ROOT=<clone of the candidate> node --test <this file>
//
//   QA18-R0  control: the unmutated clone passes; the CLI reads the working tree (a mutation is seen without a commit)
//   QA18-R1  a register row citing a non-existent block anchor (B0999 / M0999) is rejected
//   QA18-R2  a SOURCE row that cites no playbook block (only M-anchors) is rejected
//   QA18-R3  source-coverage.csv missing a playbook block (B0100 row deleted) is rejected
//   QA18-R4  a coverage row mapping a block to a requirement that does not cite that block is rejected
//   QA18-R5  an incomplete DG0 requirement (IMPLEMENTED -> SPECIFIED, and IMPLEMENTED with empty evidence) is rejected
//   QA18-R6  a row that declares status VERIFIED (derived, never declared) is rejected
//   QA18-R7  a duplicated req_id and a row with a missing column are rejected
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const here = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.QA_REPO_ROOT
  ? resolve(process.env.QA_REPO_ROOT)
  : execFileSync("git", ["-C", here, "rev-parse", "--show-toplevel"]).toString().trim();

// Own RFC 4180 parser/serialiser (not the validator's).
function parse(t) {
  const R = []; let r = [], f = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"' && t[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true; else if (c === ",") { r.push(f); f = ""; } else if (c === "\n") { r.push(f); R.push(r); r = []; f = ""; } else if (c !== "\r") f += c;
  }
  if (f || r.length) { r.push(f); R.push(r); }
  return R;
}
const cell = (v) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const serialise = (rows) => rows.map((r) => r.map(cell).join(",")).join("\n") + "\n";

function clone() {
  const base = mkdtempSync(join(tmpdir(), "qa18-reg-"));
  const repo = join(base, "repo");
  execFileSync("git", ["clone", "-q", ROOT, repo], { env, stdio: "ignore" });
  const edit = (rel, fn) => {
    const rows = parse(readFileSync(join(repo, rel), "utf8"));
    const H = rows[0];
    fn(rows, (name) => H.indexOf(name));
    writeFileSync(join(repo, rel), serialise(rows));
  };
  const validate = () => spawnSync("node", [join(repo, "tools/gates/validate.mjs"), "--register", "DG0"], { cwd: repo, env, encoding: "utf8" });
  return { base, repo, edit, validate };
}
const REG = "docs/delivery/requirements.csv";
const SRC = "docs/analysis/source-coverage.csv";

function expectReject(mutate, pattern, label) {
  const c = clone();
  mutate(c);
  const r = c.validate();
  const out = `${r.stdout}\n${r.stderr}`;
  console.log(`  ${label}: exit=${r.status} :: ${out.split("\n").filter((l) => /^\s+-|FAIL/.test(l)).slice(0, 3).join(" | ").slice(0, 300)}`);
  assert.notEqual(r.status, 0, `${label}: must be rejected\n${out}`);
  if (pattern) assert.match(out, pattern, `${label}: the error must name the defect`);
  rmSync(c.base, { recursive: true, force: true });
}

test("QA18-R0 control: the unmutated clone passes --register DG0", () => {
  const c = clone();
  const r = c.validate();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  rmSync(c.base, { recursive: true, force: true });
});

test("QA18-R1 a row citing a non-existent block anchor is rejected (B0999, M0999)", () => {
  for (const bad of ["B0999", "M0999"]) {
    expectReject((c) => c.edit(REG, (rows, col) => {
      const row = rows.find((r) => r[0] === "REQ-PB-001");
      row[col("source_ref")] = `${row[col("source_ref")]};${bad}`;
    }), new RegExp(bad), `R1 ${bad}`);
  }
});

test("QA18-R2 a SOURCE row that cites no playbook block is rejected", () => {
  expectReject((c) => c.edit(REG, (rows, col) => {
    const row = rows.find((r) => r[0] === "REQ-PB-001");
    row[col("source_ref")] = "M0089";
  }), /REQ-PB-001/, "R2");
});

test("QA18-R3 source-coverage.csv missing a playbook block is rejected", () => {
  expectReject((c) => c.edit(SRC, (rows) => {
    const i = rows.findIndex((r) => r[0] === "B0100");
    assert.ok(i > 0, "fixture: B0100 row present");
    rows.splice(i, 1);
  }), /B0100/, "R3");
});

test("QA18-R4 a coverage row mapping a block to a requirement that does not cite it is rejected", () => {
  expectReject((c) => c.edit(SRC, (rows, col) => {
    const row = rows.find((r) => r[col("disposition")] === "REQUIREMENT" && r[col("req_ids")] && !r[col("req_ids")].includes("REQ-DLV-001"));
    row[col("req_ids")] = `${row[col("req_ids")]};REQ-DLV-001`;
  }), /REQ-DLV-001/, "R4");
});

test("QA18-R5 an incomplete DG0 requirement is rejected (SPECIFIED at its final gate; IMPLEMENTED without evidence)", () => {
  expectReject((c) => c.edit(REG, (rows, col) => {
    rows.find((r) => r[0] === "REQ-DLV-022")[col("status")] = "SPECIFIED";
  }), /REQ-DLV-022/, "R5a SPECIFIED");
  expectReject((c) => c.edit(REG, (rows, col) => {
    rows.find((r) => r[0] === "REQ-DLV-022")[col("evidence")] = "";
  }), /REQ-DLV-022/, "R5b empty evidence");
  expectReject((c) => c.edit(REG, (rows, col) => {
    rows.find((r) => r[0] === "REQ-DLV-022")[col("evidence")] = "tools/gates/does-not-exist.mjs";
  }), /REQ-DLV-022/, "R5c missing evidence file");
});

test("QA18-R6 a row declaring VERIFIED is rejected", () => {
  expectReject((c) => c.edit(REG, (rows, col) => {
    rows.find((r) => r[0] === "REQ-DLV-022")[col("status")] = "VERIFIED";
  }), /REQ-DLV-022|VERIFIED/, "R6");
});

test("QA18-R7 a duplicated req_id and a row with a missing column are rejected", () => {
  expectReject((c) => c.edit(REG, (rows) => {
    rows.splice(2, 0, [...rows.find((r) => r[0] === "REQ-PB-001")]);
  }), /REQ-PB-001/, "R7a duplicate");
  expectReject((c) => {
    const p = join(c.repo, REG);
    const lines = readFileSync(p, "utf8").split("\n");
    const i = lines.findIndex((l) => l.startsWith("REQ-S21-"));
    lines[i] = lines[i].replace(/,[^,]*$/, ""); // drop the last column of one simple row
    writeFileSync(p, lines.join("\n"));
  }, null, "R7b ragged row");
});
