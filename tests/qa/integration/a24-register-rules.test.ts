// T-I12 (ADR-0071 §6.2, p7-work-split §I.4; qa-verifier T-DG7-QA-D): the A24 clause of REQ-S02-005, "the validator
// rejects a BLOCKED row with empty notes and an IMPLEMENTED row without evidence", proved OUTSIDE the protected tree.
//
// `checkRegister` is imported READ-ONLY from tools/gates/lib/rules.mjs (nothing under tools/gates/** is edited). It
// runs against a disposable fixture repository under the OS temp directory holding a small register built from real
// rows of docs/delivery/requirements.csv plus the block indexes and coverage files the function reads. Each defect is
// planted in its own row and must produce its own message, on that row only; the same rows without the defect
// (notes present, evidence an existing file) must not produce it. Other register problems of the small fixture
// (scenarios not cited, coverage gaps) are irrelevant to the clause and are not asserted.
//
// No database, network or delivery record is written. The integration project's global setup still needs
// TEST_DATABASE_ADMIN_URL, so run it through tests/qa/support/with-pg.sh.
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type Row = Record<string, string>;
interface RulesModule {
  REGISTER_COLUMNS: string[];
  checkRegister: (repo: string, stageId: string, errors: string[]) => unknown;
}
interface CsvModule {
  parseCsv: (text: string) => { header: string[]; rows: Row[] };
}

const ROOT = resolve(import.meta.dirname, "../../..");
const COPIED = [
  "docs/source/playbook.blocks.json",
  "docs/source/master-prompt.blocks.json",
  "docs/analysis/source-coverage.csv",
  "docs/analysis/master-prompt-coverage.csv",
];
const EVIDENCE_FILE = "docs/fixture-evidence.md";

let rules: RulesModule;
let header: string[];
let realRows: Row[];
const fixtures: string[] = [];

const csvField = (v: string) => `"${v.replace(/"/g, '""')}"`;

/** Writes a disposable fixture repository with the given register rows and returns its root. */
function fixtureRepo(rows: Row[]): string {
  const dir = mkdtempSync(join(tmpdir(), "qa-t-i12-"));
  fixtures.push(dir);
  for (const rel of COPIED) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    copyFileSync(join(ROOT, rel), join(dir, rel));
  }
  writeFileSync(join(dir, EVIDENCE_FILE), "synthetic fixture evidence\n");
  const lines = [header.join(","), ...rows.map((r) => header.map((c) => csvField(r[c] ?? "")).join(","))];
  mkdirSync(join(dir, "docs/delivery"), { recursive: true });
  writeFileSync(join(dir, "docs/delivery/requirements.csv"), lines.join("\n") + "\n");
  return dir;
}

function run(rows: Row[], stage: string): string[] {
  const errors: string[] = [];
  rules.checkRegister(fixtureRepo(rows), stage, errors);
  return errors;
}

/** A real register row with a DG0 final gate (so the IMPLEMENTED-without-evidence rule applies at DG0). */
function dg0Row(): Row {
  const r = realRows.find((x) => x.final_gate === "DG0");
  if (!r) throw new Error("the register has no DG0 row to base the fixture on");
  return { ...r, status: "IMPLEMENTED", evidence: EVIDENCE_FILE };
}
/** A real register row with a DG7 final gate (still open at DG0, so BLOCKED is permitted there with notes). */
function dg7Row(): Row {
  const r = realRows.find((x) => x.final_gate === "DG7");
  if (!r) throw new Error("the register has no DG7 row to base the fixture on");
  return { ...r, status: "BLOCKED", notes: "waits for the synthetic dependency X (fixture)", evidence: "" };
}

beforeAll(async () => {
  rules = (await import(pathToFileURL(join(ROOT, "tools/gates/lib/rules.mjs")).href)) as RulesModule;
  const csv = (await import(pathToFileURL(join(ROOT, "tools/gates/lib/csv.mjs")).href)) as CsvModule;
  const parsed = csv.parseCsv(readFileSync(join(ROOT, "docs/delivery/requirements.csv"), "utf8"));
  header = parsed.header;
  realRows = parsed.rows;
});

afterAll(() => {
  for (const d of fixtures) rmSync(d, { recursive: true, force: true });
});

describe("T-I12: the validator's register rules (A24 clause of REQ-S02-005)", () => {
  it("reads the real register header, which is exactly the validator's column list", () => {
    expect(header).toEqual(rules.REGISTER_COLUMNS);
  });

  it("refuses a BLOCKED row with empty notes, naming that row", () => {
    const blocked: Row = { ...dg7Row(), notes: "" };
    const control = dg0Row();
    const errors = run([control, blocked], "DG0");
    expect(errors).toContain(`requirements.csv ${blocked.req_id}: BLOCKED without the missing dependency in notes`);
    expect(errors.filter((e) => e.includes("BLOCKED without the missing dependency"))).toHaveLength(1);
  });

  it("treats whitespace-only notes as empty", () => {
    const blocked: Row = { ...dg7Row(), notes: "   " };
    const errors = run([blocked], "DG0");
    expect(errors).toContain(`requirements.csv ${blocked.req_id}: BLOCKED without the missing dependency in notes`);
  });

  it("accepts a BLOCKED row whose notes name the missing dependency", () => {
    const errors = run([dg7Row()], "DG0");
    expect(errors.filter((e) => e.includes("BLOCKED without the missing dependency"))).toEqual([]);
  });

  it("refuses an IMPLEMENTED row without evidence at its final gate, with its own message", () => {
    const row: Row = { ...dg0Row(), evidence: "" };
    const errors = run([row, dg7Row()], "DG0");
    expect(errors).toContain(`requirements.csv ${row.req_id}: IMPLEMENTED for DG0 without evidence`);
    expect(errors.filter((e) => e.includes("without evidence"))).toHaveLength(1);
    // The two rules report different messages: this one is not the BLOCKED message.
    expect(errors.filter((e) => e.startsWith(`requirements.csv ${row.req_id}:`) && e.includes("BLOCKED"))).toEqual([]);
  });

  it("accepts the same IMPLEMENTED row when its evidence is an existing repository file", () => {
    const errors = run([dg0Row()], "DG0");
    expect(errors.filter((e) => e.includes("without evidence"))).toEqual([]);
    expect(errors.filter((e) => e.includes("evidence is not an existing repository file"))).toEqual([]);
  });

  it("refuses evidence that names a missing file", () => {
    const row: Row = { ...dg0Row(), evidence: "docs/no-such-evidence.md" };
    const errors = run([row], "DG0");
    expect(errors).toContain(
      `requirements.csv ${row.req_id}: evidence is not an existing repository file: docs/no-such-evidence.md`,
    );
  });

  it("does not require evidence for a row whose final gate is later than the stage", () => {
    const row: Row = { ...dg7Row(), status: "SPECIFIED", evidence: "" };
    const errors = run([row], "DG0");
    expect(errors.filter((e) => e.startsWith(`requirements.csv ${row.req_id}:`) && e.includes("evidence"))).toEqual([]);
  });
});
