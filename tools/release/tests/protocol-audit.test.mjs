// T-DG7-DO-I: the delivery protocol audit (tools/release/protocol-audit.mjs) on small synthetic fixtures.
// For each check: the base fixture passes it, and one seeded violation (fixtures/protocol/violations/<case>) is caught
// by that check and by no other. Fixture trees are copied under $TMPDIR and removed; nothing is written to the repository.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  ASSIGNMENT_ELEMENTS,
  CHECKS,
  HANDBACK_SECTIONS,
  PROGRESS_ELEMENTS,
  assignmentElements,
  audit,
  classifySentence,
  failedFixCount,
  handbackSections,
  maxOverlap,
  pathsOverlap,
} from "../protocol-audit.mjs";
import { FIXTURES, REPO, runNode, tmp } from "./helpers.mjs";

const TOOL = join(REPO, "tools", "release", "protocol-audit.mjs");
const BASE = join(FIXTURES, "protocol", "base");
const VIOLATIONS = join(FIXTURES, "protocol", "violations");
const STAGES = ["DG0", "DG1"];
const cleanup = [];
after(() => cleanup.forEach((d) => rmSync(d, { recursive: true, force: true })));

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** base + overlay under $TMPDIR; every meta.json "assignment_sha256": "AUTO" becomes the real SHA-256 of its file. */
function materialize(overlay) {
  const dir = tmp("protocol");
  cleanup.push(dir);
  cpSync(BASE, dir, { recursive: true });
  if (overlay) cpSync(join(VIOLATIONS, overlay), dir, { recursive: true });
  for (const f of walk(join(dir, "docs", "delivery", "runs"))) {
    if (!f.endsWith("meta.json")) continue;
    const m = JSON.parse(readFileSync(f, "utf8"));
    if (m.assignment_sha256 === "AUTO") {
      m.assignment_sha256 = createHash("sha256").update(readFileSync(join(dir, m.assignment))).digest("hex");
      writeFileSync(f, JSON.stringify(m, null, 2));
    }
  }
  return dir;
}

const byId = (report) => Object.groupBy(report.checks, (c) => c.id);
const statusOf = (report, id) => byId(report)[id].map((c) => c.status);

/** The seeded violations: overlay → the check that must catch it and the hit kind it must report. */
const SEEDED = [
  { overlay: "C1", check: "C1", kind: "overlap-above-limit" },
  { overlay: "C2", check: "C2", kind: "assignment-missing-elements" },
  { overlay: "C3", check: "C3", kind: "handback-missing-sections" },
  { overlay: "C4", check: "C4", kind: "concurrent-assignments-declare-same-file" },
  { overlay: "C5", check: "C5", kind: "historical-evidence-not-before-first-implementation" },
  { overlay: "C6-update", check: "C6", kind: "gate-update-missing-elements" },
  { overlay: "C6-gaps", check: "C6", kind: "task-with-open-gaps-reported-complete" },
  { overlay: "C7", check: "C7", kind: "three-failed-fixes-without-blocker" },
  { overlay: "C8-approval", check: "C8", kind: "agent-claims-business-approval" },
  { overlay: "C8-g6", check: "C8", kind: "g6-equated-with-dg7" },
  { overlay: "C9", check: "C9", kind: "building-before-previous-gate-approved" },
];

describe("protocol-audit: contract lists", () => {
  it("names the ten assignment contract elements of agent-protocol.md", () => {
    assert.deepEqual(
      ASSIGNMENT_ELEMENTS.map((e) => e.label),
      [
        "Stage ID",
        "Task and requirement IDs",
        "Source/reference files",
        "Candidate/base revision",
        "Permitted files",
        "Constraints",
        "Input/output contracts",
        "Acceptance checks",
        "Dependency status",
        "Handback path",
      ],
    );
  });
  it("names the five handback sections and the six gate-update elements", () => {
    assert.deepEqual(
      HANDBACK_SECTIONS.map((s) => s.id),
      ["changed_files", "behaviour", "checks_run", "known_gaps", "merge_instructions"],
    );
    assert.deepEqual(
      PROGRESS_ELEMENTS.map((e) => e.id),
      ["stage_and_candidate", "capabilities", "reviewer_verdicts", "findings_fixed", "blockers", "next_stage"],
    );
  });
  it("maps every check to a requirement and an acceptance clause", () => {
    assert.deepEqual(
      CHECKS.map((c) => c.id),
      ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9"],
    );
    for (const c of CHECKS) {
      assert.match(c.requirement, /^REQ-DLV-\d{3}/);
      assert.ok(c.clause.length > 20, c.id);
    }
  });
});

describe("protocol-audit: unit rules", () => {
  it("counts the maximum overlap, an end freeing its slot before a start at the same instant", () => {
    const r = (s, e) => ({ run_id: `${s}-${e}`, start: s, end: e });
    assert.equal(maxOverlap([r(0, 10), r(1, 9), r(2, 8), r(3, 7), r(4, 6)]).max, 5);
    assert.equal(maxOverlap([r(0, 5), r(5, 10), r(10, 15)]).max, 1);
  });
  it("finds a missing element and the full set", () => {
    const all = readFileSync(join(BASE, "docs/delivery/assignments/DG1/T-DG1-BE-A.md"), "utf8");
    assert.deepEqual(assignmentElements(all).missing, []);
    const noHandback = all
      .split("\n")
      .filter((l) => !/Handback/.test(l))
      .join("\n");
    assert.deepEqual(assignmentElements(noHandback).missing, ["handback_path"]);
  });
  it("reads handback sections from headings", () => {
    const hb = readFileSync(join(BASE, "docs/delivery/handbacks/DG1/T-DG1-FE-A-frontend-ux-engineer.md"), "utf8");
    assert.deepEqual(handbackSections(hb).missing, []);
    assert.deepEqual(handbackSections(hb.split("## 5.")[0]).missing, ["merge_instructions"]);
  });
  it("counts failed fix verifications as FIXED_PENDING_VERIFICATION followed by OPEN", () => {
    const h = (...s) => ({ history: s.map((status) => ({ status })) });
    assert.equal(failedFixCount(h("OPEN", "FIXED_PENDING_VERIFICATION", "OPEN", "FIXED_PENDING_VERIFICATION", "CLOSED_VERIFIED")), 1);
    assert.equal(failedFixCount(h("OPEN", "FIXED_PENDING_VERIFICATION", "CLOSED_VERIFIED", "CLOSED_VERIFIED")), 0);
  });
  it("overlaps exact paths and globs, not siblings", () => {
    assert.ok(pathsOverlap("a/b.ts", "a/b.ts"));
    assert.ok(pathsOverlap("tests/qa/**", "tests/qa/x.test.ts"));
    assert.ok(!pathsOverlap("a/b.ts", "a/c.ts"));
  });
  it("classifies approval claims and G6/DG7 equivalence, and allows negated disclaimers", () => {
    const j = (...p) => p.join(" ");
    assert.deepEqual(classifySentence(j("The orchestrator", "granted the business approval", "for go-live.")), ["agent-claims-business-approval"]);
    assert.deepEqual(classifySentence(j("Product gate G6", "implies", "DG7 has passed.")), ["g6-equated-with-dg7"]);
    assert.deepEqual(classifySentence(j("Here G6", "=", "DG7.")), ["g6-equated-with-dg7"]);
    assert.deepEqual(classifySentence("Nothing here grants a business, Finance or IT approval, and nothing implies DG7."), []);
    assert.deepEqual(classifySentence("Product gate G6 never implies DG7."), []);
    assert.deepEqual(classifySentence("The DG3 totals stay as DG3 approved them; the domain reviewer recorded an observation."), []);
  });
});

describe("protocol-audit: base fixture passes every check", () => {
  it("module: all checks PASS on DG0 and DG1", () => {
    const report = audit({ root: materialize(null), stages: STAGES, git: false });
    const bad = report.checks.filter((c) => c.status !== "PASS").map((c) => `${c.id}/${c.stage}: ${c.status} ${JSON.stringify(c.hits ?? c.reason)}`);
    assert.deepEqual(bad, []);
    assert.equal(report.verdict, "PASS");
    assert.equal(report.exit_code, 0);
  });
  it("CLI: exit 0 and the PASS summary", () => {
    const root = materialize(null);
    const r = runNode([TOOL, "--root", root, "--all", "--no-git"]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^PASS \(exit 0\)/m);
  });
});

describe("protocol-audit: each seeded violation is caught by its check", () => {
  for (const s of SEEDED) {
    it(`${s.overlay}: ${s.check} reports ${s.kind}; every other check passes`, () => {
      assert.ok(existsSync(join(VIOLATIONS, s.overlay)), s.overlay);
      const report = audit({ root: materialize(s.overlay), stages: STAGES, git: false });
      const hits = report.checks.filter((c) => c.id === s.check).flatMap((c) => c.hits);
      assert.ok(
        hits.some((h) => h.kind === s.kind),
        `${s.check} hits: ${JSON.stringify(hits)}`,
      );
      const others = report.checks.filter((c) => c.id !== s.check && c.status !== "PASS").map((c) => `${c.id}/${c.stage}: ${JSON.stringify(c.hits)}`);
      assert.deepEqual(others, []);
      assert.equal(report.exit_code, 1);
    });
  }
  it("CLI: a seeded violation exits 1 with the FAIL summary", () => {
    const r = runNode([TOOL, "--root", materialize("C1"), "--all", "--no-git"]);
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /C1 concurrency\s+DG1\s+HIT/);
    assert.match(r.stdout, /^FAIL \(exit 1\)/m);
  });
});

describe("protocol-audit: accepted observations and BLOCKED", () => {
  it("out-of-order history covered by an ACCEPTED_OBSERVATION finding is reported as that observation, not a hit", () => {
    const report = audit({ root: materialize("C9-accepted"), stages: STAGES, git: false });
    const c9 = byId(report).C9.find((c) => c.stage === "DG0");
    assert.equal(c9.status, "PASS");
    const note = c9.notes.find((n) => n.kind === "accepted-observation");
    assert.deepEqual(note.items[0].accepted_observation, ["F-DG1-952"]);
    assert.deepEqual(statusOf(report, "C9"), ["PASS", "PASS"]);
  });
  it("exits 2 (BLOCKED) without docs/delivery, and on a usage error", () => {
    const empty = tmp("protocol-empty");
    cleanup.push(empty);
    const a = runNode([TOOL, "--root", empty, "--stage", "DG0", "--no-git"]);
    assert.equal(a.code, 2);
    assert.match(a.stderr, /BLOCKED \(exit 2\)/);
    const b = runNode([TOOL, "--stage", "DG9"]);
    assert.equal(b.code, 2);
    const c = runNode([TOOL]);
    assert.equal(c.code, 2);
  });
});
