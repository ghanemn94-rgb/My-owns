// The advisory-lock class registry (ADR-0016 "Advisory-lock registry"; T-DG3-ARCH-03): every class is distinct, the
// database triggers that share a lock declare the same number, and no module source hard-codes a class number.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ADVISORY_LOCK_CLASSES } from "./index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULES = join(HERE, "..");
const MIGRATIONS = join(HERE, "../../../../../packages/db/migrations");

/** The migration CONSTANT name -> the registry value it must equal (a trigger that shares the API's lock). */
const MIGRATION_CONSTANTS: ReadonlyMap<string, number> = new Map([
  ["hierarchy_lock_class", ADVISORY_LOCK_CLASSES.businessUnitHierarchy],
  ["outcome_lock_class", ADVISORY_LOCK_CLASSES.outcomeTree],
  ["graph_lock_class", ADVISORY_LOCK_CLASSES.dependencyGraph],
  ["delegation_graph_lock_class", ADVISORY_LOCK_CLASSES.delegationGraph],
  ["raci_deliverable_lock_class", ADVISORY_LOCK_CLASSES.raciDeliverable],
  ["approval_subject_lock_class", ADVISORY_LOCK_CLASSES.approvalSubject],
  ["kpi_formula_graph_lock_class", ADVISORY_LOCK_CLASSES.kpiFormulaGraph],
  ["kpi_actual_slot_lock_class", ADVISORY_LOCK_CLASSES.kpiActualSlot],
  ["reporting_period_lock_class", ADVISORY_LOCK_CLASSES.reportingPeriod],
  ["benefit_allocation_lock_class", ADVISORY_LOCK_CLASSES.benefitAllocationSet],
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

describe("advisory-lock class registry", () => {
  it("lists the twenty-three classes, each a distinct int4 (730227, 730231, 730235, 730237, 730241, 730245 and 730248 stay reserved for their P4 blocks)", () => {
    expect(ADVISORY_LOCK_CLASSES).toEqual({
      businessUnitHierarchy: 730219,
      outcomeTree: 730220,
      dependencyGraph: 730221,
      prioritization: 730222,
      dependencyType: 730223,
      delegationGraph: 730224,
      raciDeliverable: 730225,
      approvalSubject: 730226,
      kpiFormulaGraph: 730228,
      kpiActualSlot: 730229,
      reportingPeriod: 730230,
      benefitAllocationSet: 730232,
      financeValidationQueue: 730233,
      benefitOverlap: 730234,
      correctiveCase: 730236,
      meetingSeriesGeneration: 730238,
      executiveAskBlocker: 730239,
      decisionEscalation: 730240,
      adoptionIntervention: 730242,
      bauHandover: 730243,
      closure: 730244,
      changeRequestSubject: 730246,
      gateException: 730247,
    });
    const values = Object.values(ADVISORY_LOCK_CLASSES);
    expect(new Set(values).size).toBe(values.length);
    for (const v of values) expect(Number.isInteger(v) && v > 0 && v <= 2_147_483_647).toBe(true);
  });

  it("every *_lock_class CONSTANT in a migration equals its registry entry", () => {
    const found: string[] = [];
    for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"))) {
      const text = readFileSync(join(MIGRATIONS, file), "utf8");
      for (const m of text.matchAll(/\b([a-z_]+_lock_class)\s+CONSTANT\s+integer\s*:=\s*([0-9]+)\s*;/g)) {
        const expected = MIGRATION_CONSTANTS.get(m[1]!);
        expect(expected, `${file}: ${m[1]} is not in the registry`).toBeDefined();
        expect(Number(m[2]), `${file}: ${m[1]}`).toBe(expected);
        found.push(m[1]!);
      }
    }
    expect(new Set(found)).toEqual(new Set(MIGRATION_CONSTANTS.keys()));
  });

  it("no module source outside the registry spells a class number (they import ADVISORY_LOCK_CLASSES)", () => {
    const offenders = walk(MODULES)
      .filter((f) => /\.[cm]?[jt]sx?$/.test(f) && !f.endsWith("advisory-locks.ts") && !f.endsWith(".test.ts"))
      // 730219-730249: the P1-P3 classes and every P4 block (p4-plan §4).
      .filter((f) => /\b7302(19|[2-4][0-9])\b/.test(readFileSync(f, "utf8")))
      .map((f) => relative(MODULES, f));
    expect(offenders).toEqual([]);
  });
});
