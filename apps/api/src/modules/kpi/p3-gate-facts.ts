// The kpi half of the G4 GateFactsProvider (ADR-0021 §7 `g4.business_cases` and `g4.finance_validation`; ADR-0024 §5;
// REQ-PB-055; T-DG3-KBE-C). workflows/g4.ts defines the provider interface and server.ts wires `kpi:
// loadKpiP3GateFacts` (BE-E), so workflows never imports kpi (no module cycle).
//
// The loader reports FACTS only; the G4 evaluators (BE-E) decide completeness and the in-scope initiatives:
//  - the active transformation-level business case and every active initiative case, each with its missing sections
//    (ADR-0024 §1, the lighter set for initiative cases) and its baseline validation state as everyone must read it:
//    `validated` only while the validated hash matches the current baseline, otherwise `stale`; `unvalidated` and
//    `rejected` as recorded. Stale is never validated and never counts;
//  - for every active FINANCIAL benefit line of those cases (line kind benefit, class other than
//    strategic_non_financial), its formula's CURRENT version and that version's Finance validation state. A line with
//    no formula, a formula without a version, or an archived formula reads as such - never as validated.
// Product gate G4 is a business approval inside the product, decided by a person; nothing here approves anything, and
// nothing touches the engineering gates DG0-DG7.
import type { BusinessCaseRow, DbOrTx } from "@mth/db";
import type { BusinessCase, BusinessCaseSectionCode, BusinessCaseValidationState } from "@mth/shared/schemas";
import { presentCases } from "./business-cases.ts";

/** One business case as G4 reads it. */
export interface KpiCaseFact {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly level: "transformation" | "initiative";
  readonly initiativeId: string | null;
  readonly version: number;
  /** Section codes still missing for the case's level ([] = all filled). */
  readonly missingSections: readonly BusinessCaseSectionCode[];
  /** `validated` only while current; a changed baseline is `stale` (never counts). */
  readonly baselineValidation: BusinessCaseValidationState;
  /** API pointer for a G4 missing item. */
  readonly pointer: string;
}

/**
 * The Finance validation state of the benefit logic behind a line: the current version's state, or why there is none.
 * Only `validated` counts for G4.
 */
export type FormulaValidationFact =
  | "validated"
  | "unvalidated"
  | "rejected"
  | "no_formula"
  | "no_current_version"
  | "formula_archived";

/** One active financial benefit line and the validation of its formula's current version. */
export interface KpiBenefitLineFact {
  readonly lineId: string;
  readonly businessCaseId: string;
  readonly initiativeId: string | null;
  readonly title: string;
  readonly benefitClass: string;
  readonly valueBasis: string;
  readonly benefitFormulaId: string | null;
  readonly formulaCode: string | null;
  readonly currentVersionNo: number | null;
  readonly currentVersionId: string | null;
  readonly formulaValidation: FormulaValidationFact;
  /** API pointer for a G4 missing item: the current version, else the formula, else the line. */
  readonly pointer: string;
}

/** The kpi facts for G4 (satisfies workflows/g4.ts `KpiP3GateFacts`). */
export interface KpiP3GateFactsData {
  readonly transformationId: string;
  /** The active transformation-level case, or null when there is none. */
  readonly transformationCase: KpiCaseFact | null;
  /** Every active initiative case of the transformation (G4 filters them to its in-scope initiatives). */
  readonly initiativeCases: readonly KpiCaseFact[];
  /** Every active financial benefit line of those cases. */
  readonly benefitLines: readonly KpiBenefitLineFact[];
  readonly [fact: string]: unknown;
}

// ------------------------------------------------------------------------------------------------ pure builder

export interface FactLine {
  readonly id: string;
  readonly businessCaseId: string;
  readonly lineKind: string;
  readonly benefitClass: string | null;
  readonly valueBasis: string;
  readonly title: string;
  readonly benefitFormulaId: string | null;
}

export interface FactFormula {
  readonly id: string;
  readonly code: string;
  readonly status: string;
  readonly currentVersionNo: number | null;
}

export interface FactVersion {
  readonly id: string;
  readonly formulaId: string;
  readonly versionNo: number;
  readonly validationStatus: string;
}

const caseFact = (c: BusinessCase): KpiCaseFact => ({
  id: c.id,
  code: c.code,
  title: c.title,
  level: c.level,
  initiativeId: c.initiativeId,
  version: c.version,
  missingSections: c.missingSections as BusinessCaseSectionCode[],
  baselineValidation: c.baselineValidation,
  pointer: `/business-cases/${c.id}`,
});

/** The validation fact of one line's formula (pure; exported for the unit test). */
export function formulaValidationOf(
  formulaId: string | null,
  formulas: ReadonlyMap<string, FactFormula>,
  versions: readonly FactVersion[],
): { fact: FormulaValidationFact; formula: FactFormula | null; version: FactVersion | null } {
  if (formulaId === null) return { fact: "no_formula", formula: null, version: null };
  const formula = formulas.get(formulaId) ?? null;
  if (formula === null) return { fact: "no_formula", formula: null, version: null };
  if (formula.status === "archived") return { fact: "formula_archived", formula, version: null };
  const version =
    formula.currentVersionNo === null
      ? null
      : (versions.find((v) => v.formulaId === formula.id && v.versionNo === formula.currentVersionNo) ?? null);
  if (version === null) return { fact: "no_current_version", formula, version: null };
  const s = version.validationStatus;
  return { fact: s === "validated" ? "validated" : s === "rejected" ? "rejected" : "unvalidated", formula, version };
}

/** Builds the facts from presented cases, their lines, formulas and versions (pure). */
export function buildKpiP3GateFacts(input: {
  readonly transformationId: string;
  readonly cases: readonly BusinessCase[];
  readonly lines: readonly FactLine[];
  readonly formulas: readonly FactFormula[];
  readonly versions: readonly FactVersion[];
}): KpiP3GateFactsData {
  const active = input.cases.filter((c) => c.status !== "archived");
  const top = active.find((c) => c.level === "transformation") ?? null;
  const initiativeCases = active.filter((c) => c.level === "initiative").sort((a, b) => a.code.localeCompare(b.code));
  const caseById = new Map(active.map((c) => [c.id, c]));
  const formulas = new Map(input.formulas.map((f) => [f.id, f]));
  const benefitLines: KpiBenefitLineFact[] = input.lines
    .filter(
      (l) =>
        caseById.has(l.businessCaseId) &&
        l.lineKind === "benefit" &&
        l.benefitClass !== null &&
        l.benefitClass !== "strategic_non_financial",
    )
    .map((l) => {
      const { fact, formula, version } = formulaValidationOf(l.benefitFormulaId, formulas, input.versions);
      const kase = caseById.get(l.businessCaseId)!;
      return {
        lineId: l.id,
        businessCaseId: l.businessCaseId,
        initiativeId: kase.initiativeId,
        title: l.title,
        benefitClass: l.benefitClass!,
        valueBasis: l.valueBasis,
        benefitFormulaId: formula?.id ?? null,
        formulaCode: formula?.code ?? null,
        currentVersionNo: version?.versionNo ?? null,
        currentVersionId: version?.id ?? null,
        formulaValidation: fact,
        pointer:
          version !== null
            ? `/benefit-formulas/${formula!.id}/versions/${version.versionNo}`
            : formula !== null
              ? `/benefit-formulas/${formula.id}`
              : `/business-cases/${l.businessCaseId}/lines/${l.id}`,
      };
    });
  return {
    transformationId: input.transformationId,
    transformationCase: top === null ? null : caseFact(top),
    initiativeCases: initiativeCases.map(caseFact),
    benefitLines,
  };
}

// ------------------------------------------------------------------------------------------------ loader

/**
 * Loads the kpi G4 facts of one transformation (read-only; runs on the caller's connection or transaction, so the G4
 * submission can read them inside its own transaction).
 */
export async function loadKpiP3GateFacts(db: DbOrTx, transformationId: string): Promise<KpiP3GateFactsData> {
  const caseRows: BusinessCaseRow[] = await db
    .selectFrom("business_case")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .where("status", "<>", "archived")
    .orderBy("code")
    .execute();
  const cases = await presentCases(db, caseRows);
  const lineRows =
    caseRows.length === 0
      ? []
      : await db
          .selectFrom("business_case_line")
          .select([
            "id",
            "business_case_id",
            "line_kind",
            "benefit_class",
            "value_basis",
            "title",
            "benefit_formula_id",
          ])
          .where(
            "business_case_id",
            "in",
            caseRows.map((c) => c.id),
          )
          .where("status", "=", "active")
          .orderBy("id")
          .execute();
  const formulaIds = [...new Set(lineRows.map((l) => l.benefit_formula_id).filter((id): id is string => id !== null))];
  const formulaRows =
    formulaIds.length === 0
      ? []
      : await db
          .selectFrom("benefit_formula")
          .select(["id", "code", "status", "current_version_no"])
          .where("id", "in", formulaIds)
          .execute();
  const versionRows =
    formulaIds.length === 0
      ? []
      : await db
          .selectFrom("benefit_formula_version as v")
          .innerJoin("benefit_formula as f", (j) =>
            j.onRef("f.id", "=", "v.formula_id").onRef("f.current_version_no", "=", "v.version_no"),
          )
          .select(["v.id", "v.formula_id", "v.version_no", "v.validation_status"])
          .where("v.formula_id", "in", formulaIds)
          .execute();
  return buildKpiP3GateFacts({
    transformationId,
    cases,
    lines: lineRows.map((l) => ({
      id: l.id,
      businessCaseId: l.business_case_id,
      lineKind: l.line_kind,
      benefitClass: l.benefit_class,
      valueBasis: l.value_basis,
      title: l.title,
      benefitFormulaId: l.benefit_formula_id,
    })),
    formulas: formulaRows.map((f) => ({
      id: f.id,
      code: f.code,
      status: f.status,
      currentVersionNo: f.current_version_no,
    })),
    versions: versionRows.map((v) => ({
      id: v.id,
      formulaId: v.formula_id,
      versionNo: v.version_no,
      validationStatus: v.validation_status,
    })),
  });
}
