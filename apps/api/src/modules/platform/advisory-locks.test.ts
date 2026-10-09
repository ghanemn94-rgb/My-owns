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
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

describe("advisory-lock class registry", () => {
  it("lists the eight classes, each a distinct int4 (730227 stays reserved for the T-DG4-ARCH-01 block)", () => {
    expect(ADVISORY_LOCK_CLASSES).toEqual({
      businessUnitHierarchy: 730219,
      outcomeTree: 730220,
      dependencyGraph: 730221,
      prioritization: 730222,
      dependencyType: 730223,
      delegationGraph: 730224,
      raciDeliverable: 730225,
      approvalSubject: 730226,
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
