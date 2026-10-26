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
  ["trace_allocation_lock_class", ADVISORY_LOCK_CLASSES.traceAllocationSet],
  ["kpi_restatement_lock_class", ADVISORY_LOCK_CLASSES.kpiRestatement],
  ["launch_plan_lock_class", ADVISORY_LOCK_CLASSES.launchPlan],
  ["health_assessment_lock_class", ADVISORY_LOCK_CLASSES.healthAssessmentSubmit],
  ["branding_publish_lock_class", ADVISORY_LOCK_CLASSES.brandingPublish],
  ["sensitive_grant_lock_class", ADVISORY_LOCK_CLASSES.sensitiveRecordGrant],
  ["deep_link_issue_lock_class", ADVISORY_LOCK_CLASSES.deepLinkIssue],
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

describe("advisory-lock class registry", () => {
  it("lists the forty-four classes (twenty-eight before P5), each a distinct int4 (730227, 730231, 730235, 730237, 730241, 730245 and 730248 stay reserved for their P4 blocks; 730253 for the T-DG5-ARCH-01 block; 730255-730257 for the T-DG5-ARCH-02 block; 730302-730304 for the T-DG6-ARCH-01 block; 730308-730309 for the T-DG6-ARCH-02 block)", () => {
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
      traceAllocationSet: 730249,
      configDraft: 730250,
      configPublish: 730251,
      methodologyMigration: 730252,
      procedureInstanceStep: 730254,
      automationRuleExecution: 730258,
      failureRepair: 730259,
      approvalRouteStep: 730260,
      digestWindow: 730261,
      reportSnapshotIssue: 730263,
      exportJob: 730264,
      kpiRestatement: 730266,
      launchPlan: 730267,
      healthAssessmentSubmit: 730268,
      brandingPublish: 730270,
      demoReset: 730271,
      sensitiveRecordGrant: 730300,
      deepLinkIssue: 730301,
      operationalExceptionUpsert: 730305,
      channelDelivery: 730306,
      storageSetting: 730307,
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
      // 730219-730299: the P1-P3 classes, every P4 block (p4-plan §4) and the P5 blocks (p5-plan §4, from 730250);
      // 730300-730339: the P6 blocks (p6-plan §4; T-DG6-ARCH-01).
      .filter((f) => /\b7302(19|[2-9][0-9])\b|\b7303[0-3][0-9]\b/.test(readFileSync(f, "utf8")))
      .map((f) => relative(MODULES, f));
    expect(offenders).toEqual([]);
  });
});
