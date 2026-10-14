// The `business_cases` assembler (ADR-0045 §1, §3, §5, §12; B0083 Business Case; REQ-S13-004, REQ-S13-008;
// T-DG5-KBE-C2).
//
// Reads through the DG3 business-case services of the kpi module (its public index):
//  - the cases are the rows of GET /business-cases?transformationId=… (not archived, newest first: created_at desc,
//    id desc), presented by `presentCases` (missing sections, the baseline validation state);
//  - each case's active lines through `activeLinesOf` and `toBusinessCaseLine` (the line list route's order);
//  - each case's totals through `loadCaseTotals` (GET /business-cases/{id}/totals: the DG3 totals engine, by reference
//    over the case and, for the transformation case, its active initiative cases). The report computes no total of its
//    own: it shows the engine's gross benefits (also per business-case value basis), implementation cost (cash and
//    non-cash) and net value, each per currency, as separate rows, never added together (D-117, D-119, D-122).
//
// Values (ADR-0045 §5):
//  - rule 2: a financial benefit line's amount is provisional unless the CURRENT version of its benefit formula is
//    validated (the DG3 G4 rule, kpi/p3-gate-facts.ts `formulaValidationOf`); a line without a formula, or whose formula
//    has no current version or is archived, is not validated either. A total of benefit lines (gross, per value basis,
//    net) is provisional when any line in it is; it is validated only when every line is;
//  - rule 3: the baseline section is provisional unless its Finance validation is current (`baselineValidation`
//    `validated`; a later baseline edit makes it `stale`, which never counts);
//  - an investment line has no validation state (rule 6: not_applicable); a strategic non-financial benefit is never
//    monetised, so its money value is n/a, never 0; a missing amount is Unknown (rule 5); a section a case's level does
//    not require (an initiative case's lighter set) is n/a.
// Versions: one `formula_version` row per formula version used (referenceKey = the formula's code) and, when any
// formula is used, the `calculation_engine` row (ENGINE_VERSION of the formula engine, read, never changed).
// Approval state (ADR-0045 §3): business cases carry no business approval of their own in DG2-DG4 (their Finance
// validation is a validation, not an approval), so every source row has none and the output is not_applicable.
import type { BusinessCaseLineRow, BusinessCaseRow } from "@mth/db";
import { ENGINE_VERSION } from "@mth/shared/calc";
import {
  BUSINESS_CASE_SECTION_CODES,
  emptyReportParameters,
  INITIATIVE_CASE_SECTION_CODES,
  type BusinessCase,
  type BusinessCaseSectionCode,
  type MoneyTotal,
  type ReportColumn,
  type ReportRow,
  type ReportSection,
  type ReportValue,
} from "@mth/shared/schemas";
import { activeLinesOf, loadCaseTotals, presentCases, toBusinessCaseLine } from "../../../kpi/index.ts";
import {
  codeValue,
  countValue,
  dateValue,
  decimalValue,
  textValue,
  userNames,
  type Assembler,
  type AssemblyContext,
  type AssembledOutput,
  type SourceRecord,
  type VersionRef,
} from "../assembler.ts";
import { reportRefusals } from "../definitions.ts";
import { formulaVersionState, NOT_APPLICABLE, PROVISIONAL, VALIDATED, type ValueState } from "../provisional.ts";

const S = { cases: "cases", sections: "case_sections", lines: "lines", totals: "totals" } as const;
const L = (k: string) => `report.business_cases.${k}`;
const column = (
  key: string,
  valueKind: ReportColumn["valueKind"],
  unitKind: ReportColumn["unitKind"] = null,
): ReportColumn => ({ key, labelKey: L(key), valueKind, unitKind });

/** The validation fact of a line's benefit logic (as kpi/p3-gate-facts.ts `formulaValidationOf` decides it). */
export type LineFormulaFact =
  | "validated"
  | "unvalidated"
  | "rejected"
  | "no_formula"
  | "no_current_version"
  | "formula_archived";

interface FormulaInfo {
  readonly id: string;
  readonly code: string;
  readonly status: string;
  readonly current: { readonly id: string; readonly versionNo: number; readonly validationStatus: string } | null;
}

/** Pure: the formula fact of one line (the DG3 rule: only the current version's `validated` counts). */
export function lineFormulaFact(formulaId: string | null, formulas: ReadonlyMap<string, FormulaInfo>): LineFormulaFact {
  if (formulaId === null) return "no_formula";
  const f = formulas.get(formulaId);
  if (f === undefined) return "no_formula";
  if (f.status === "archived") return "formula_archived";
  if (f.current === null) return "no_current_version";
  const s = f.current.validationStatus;
  return s === "validated" ? "validated" : s === "rejected" ? "rejected" : "unvalidated";
}

/**
 * Pure: the label of a line's amount (ADR-0045 §5). Investment lines have no validation state (n/a); a strategic
 * non-financial benefit is never monetised (n/a); a financial benefit line is validated only when its formula's current
 * version is (rule 2), else provisional.
 */
export function lineAmountState(lineKind: string, valueBasis: string, fact: LineFormulaFact): ValueState {
  if (lineKind !== "benefit") return NOT_APPLICABLE;
  if (valueBasis === "non_financial") return NOT_APPLICABLE;
  return fact === "validated" ? VALIDATED : PROVISIONAL;
}

/** Pure: the label of a total over lines with these states: provisional if any line is, validated if all are. */
export function totalState(states: readonly ValueState[]): ValueState {
  if (states.length === 0) return NOT_APPLICABLE;
  if (states.some((s) => s.validation === "provisional")) return PROVISIONAL;
  if (states.every((s) => s.validation === "validated")) return VALIDATED;
  return NOT_APPLICABLE;
}

/**
 * Pure: the label of an amount that may be missing. A present amount takes its rule's label; a missing one is Unknown
 * (missing) whatever its rule (rule 5): an investment line or a cost total without an amount is Unknown, never n/a or 0.
 */
export function presentState(amount: string | null, state: ValueState): { readonly state?: ValueState } {
  return amount === null ? {} : { state };
}

/** The ten B0085 sections as text fields of the case, with the section each belongs to. */
type Sections = BusinessCase["sections"];
const SECTION_FIELDS: readonly (readonly [(s: Sections) => string | null, BusinessCaseSectionCode, string])[] = [
  [(s) => s.strategicRationale, "strategic_rationale", "strategic_rationale"],
  [(s) => s.baselineSummary, "baseline", "baseline_summary"],
  [(s) => s.valuePoolsSummary, "value_pools", "value_pools_summary"],
  [(s) => s.interventionsSummary, "interventions", "interventions_summary"],
  [(s) => s.investmentSummary, "investment", "investment_summary"],
  [(s) => s.benefitsSummary, "benefits", "benefits_summary"],
  [(s) => s.benefitRamp, "timing", "benefit_ramp"],
  [(s) => s.recurrenceSummary, "timing", "recurrence_summary"],
  [(s) => s.implementationHorizon, "timing", "implementation_horizon"],
  [(s) => s.keyAssumptions, "risks", "key_assumptions"],
  [(s) => s.downsideCase, "risks", "downside_case"],
  [(s) => s.upsideCase, "risks", "upside_case"],
  [(s) => s.decisionAskText, "decision_ask", "decision_ask_text"],
];

/** Rule 3 for the case baseline (ADR-0024 §5): only a current `validated` counts; unvalidated, rejected, stale do not. */
function caseBaselineState(c: BusinessCase): ValueState {
  return c.baselineValidation === "validated" ? VALIDATED : PROVISIONAL;
}

async function assemble(ctx: AssemblyContext): Promise<AssembledOutput> {
  const { db } = ctx;
  const tId = ctx.transformation.id;

  // GET /business-cases?transformationId=… : not archived, created_at desc, id desc (all pages).
  const caseRows: BusinessCaseRow[] = await db
    .selectFrom("business_case")
    .selectAll()
    .where("transformation_id", "=", tId)
    .where("status", "<>", "archived")
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .execute();
  const cases = await presentCases(db, caseRows);
  const linesByCase = new Map<string, BusinessCaseLineRow[]>();
  for (const c of caseRows) linesByCase.set(c.id, await activeLinesOf(db, c.id));
  const allLines = [...linesByCase.values()].flat();

  // The benefit formulas behind the lines and their CURRENT versions (the DG3 rule).
  const formulaIds = [...new Set(allLines.map((l) => l.benefit_formula_id).filter((i): i is string => i !== null))];
  const formulaRows =
    formulaIds.length === 0
      ? []
      : await db
          .selectFrom("benefit_formula")
          .select(["id", "code", "status", "current_version_no"])
          .where("id", "in", formulaIds)
          .where("transformation_id", "=", tId)
          .execute();
  const versionRows =
    formulaIds.length === 0
      ? []
      : await db
          .selectFrom("benefit_formula_version as v")
          .innerJoin("benefit_formula as f", (j) =>
            j.onRef("f.id", "=", "v.formula_id").onRef("f.current_version_no", "=", "v.version_no"),
          )
          .select(["v.id", "v.formula_id", "v.version_no", "v.validation_status", "v.version", "v.updated_at"])
          .where("v.formula_id", "in", formulaIds)
          .execute();
  const formulas = new Map<string, FormulaInfo>(
    formulaRows.map((f) => {
      const v = versionRows.find((r) => r.formula_id === f.id) ?? null;
      return [
        f.id,
        {
          id: f.id,
          code: f.code,
          status: f.status,
          current: v === null ? null : { id: v.id, versionNo: v.version_no, validationStatus: v.validation_status },
        },
      ] as const;
    }),
  );
  const lineState = (l: BusinessCaseLineRow) =>
    lineAmountState(l.line_kind, l.value_basis, lineFormulaFact(l.benefit_formula_id, formulas));

  const names = await userNames(db, [
    ...cases.flatMap((c) => [
      c.sections.benefitOwnerUserId,
      c.sections.initiativeOwnerUserId,
      c.sections.financeValidatorUserId,
    ]),
    ...allLines.map((l) => l.owner_user_id),
  ]);
  const person = (id: string | null, applies = true): ReportValue =>
    !applies
      ? textValue(null, "system", NOT_APPLICABLE)
      : id === null
        ? textValue(null)
        : textValue(names.get(id) ?? null, "system");
  const caseRef = (c: { id: string; version: number }) => ({
    recordType: "business_case",
    recordId: c.id,
    recordVersion: c.version,
  });
  const codeOf = new Map(cases.map((c) => [c.id, c.code] as const));

  const sources: SourceRecord[] = [];
  const sections: ReportSection[] = [];

  // ---------------------------------------------------------------------------------------------- cases
  sections.push({
    key: S.cases,
    titleKey: L("cases"),
    kind: "table",
    sources: cases.map(caseRef),
    columns: [
      column("code", "text"),
      column("level", "code"),
      column("title", "text"),
      column("currency", "text"),
      column("baseline_validation", "code"),
      column("missing_sections", "count"),
      column("benefit_owner", "text"),
      column("initiative_owner", "text"),
      column("finance_validator", "text"),
      column("status", "code"),
    ],
    rows: cases.map((c) => ({
      ...caseRef(c),
      cells: [
        textValue(c.code, "system"),
        codeValue(c.level, "report.business_case_level"),
        textValue(c.title),
        textValue(c.currency.trim(), "system"),
        codeValue(c.baselineValidation, "report.business_case_validation", caseBaselineState(c)),
        countValue(c.missingSections.length),
        // An initiative case has no benefit owner of its own (ADR-0024 §1): n/a.
        person(c.sections.benefitOwnerUserId, c.level === "transformation"),
        person(c.sections.initiativeOwnerUserId),
        person(c.sections.financeValidatorUserId),
        codeValue(c.status, "report.business_case_status"),
      ],
    })),
    totals: [],
    emptyKey: "report.empty.no_records",
  });
  for (const c of caseRows) {
    const view = cases.find((v) => v.id === c.id)!;
    sources.push({
      sectionKey: S.cases,
      recordType: "business_case",
      recordId: c.id,
      recordVersion: c.version,
      recordUpdatedAt: c.updated_at,
      approvalState: null,
      validationState: caseBaselineState(view).validation,
    });
  }

  // ---------------------------------------------------------------------------------------------- sections
  const sectionRows: ReportRow[] = [];
  for (const c of cases) {
    const required: readonly BusinessCaseSectionCode[] =
      c.level === "initiative" ? INITIATIVE_CASE_SECTION_CODES : BUSINESS_CASE_SECTION_CODES;
    for (const [read, section, key] of SECTION_FIELDS) {
      const value = read(c.sections);
      const state = !required.includes(section)
        ? NOT_APPLICABLE
        : section === "baseline"
          ? caseBaselineState(c)
          : undefined;
      sectionRows.push({
        ...caseRef(c),
        cells: [
          textValue(c.code, "system"),
          codeValue(key, "report.business_case_section"),
          // A section the case's level does not require is n/a; a required one not written is Unknown.
          textValue(state === NOT_APPLICABLE ? null : value, "user", state),
        ],
      });
    }
  }
  sections.push({
    key: S.sections,
    titleKey: L("case_sections"),
    kind: "table",
    sources: cases.map(caseRef),
    columns: [column("case", "text"), column("section", "code"), column("content", "text")],
    rows: sectionRows,
    totals: [],
    emptyKey: "report.empty.no_records",
  });

  // ---------------------------------------------------------------------------------------------- lines
  const lineRows: ReportRow[] = [];
  for (const c of cases) {
    for (const row of linesByCase.get(c.id) ?? []) {
      const l = toBusinessCaseLine(row);
      const fact = lineFormulaFact(l.benefitFormulaId, formulas);
      const formula = l.benefitFormulaId === null ? undefined : formulas.get(l.benefitFormulaId);
      const isBenefit = l.lineKind === "benefit";
      const nonFinancial = l.valueBasis === "non_financial";
      const amountState = lineState(row);
      lineRows.push({
        recordType: "business_case_line",
        recordId: l.id,
        recordVersion: l.version,
        cells: [
          textValue(c.code, "system"),
          codeValue(l.lineKind, "report.business_case_line_kind"),
          codeValue(l.class, "report.business_case_line_class"),
          codeValue(l.valueBasis, "report.business_case_value_basis"),
          textValue(l.title),
          // Non-financial benefits are never monetised: n/a with no number, never 0.
          nonFinancial
            ? decimalValue(null, { unitKind: "currency", currency: null, valueBasis: "planned", state: NOT_APPLICABLE })
            : decimalValue(l.amount, {
                unitKind: "currency",
                currency: l.currency,
                valueBasis: "planned",
                ...presentState(l.amount, amountState),
              }),
          textValue(l.currency.trim(), "system"),
          // FTE applies to internal FTE investment lines only.
          l.class === "internal_fte"
            ? decimalValue(l.fte, { unitKind: "other" })
            : decimalValue(l.fte, { unitKind: "other", state: NOT_APPLICABLE }),
          dateValue(l.periodStart),
          dateValue(l.periodEnd),
          codeValue(l.recurrence, "report.recurrence", isBenefit ? undefined : NOT_APPLICABLE),
          textValue(formula?.code ?? null, "system", isBenefit && !nonFinancial ? undefined : NOT_APPLICABLE),
          textValue(
            formula?.current === null || formula === undefined ? null : `v${formula.current.versionNo}`,
            "system",
            isBenefit && !nonFinancial ? undefined : NOT_APPLICABLE,
          ),
          codeValue(fact, "report.formula_validation", isBenefit && !nonFinancial ? undefined : NOT_APPLICABLE),
          person(l.ownerUserId),
        ],
      });
      sources.push({
        sectionKey: S.lines,
        recordType: "business_case_line",
        recordId: l.id,
        recordVersion: l.version,
        recordUpdatedAt: row.updated_at,
        approvalState: null,
        validationState: l.amount === null && !nonFinancial ? "unknown" : amountState.validation,
      });
    }
  }
  sections.push({
    key: S.lines,
    titleKey: L("lines"),
    kind: "table",
    sources: lineRows.map((r) => ({
      recordType: r.recordType,
      recordId: r.recordId,
      recordVersion: r.recordVersion,
    })),
    columns: [
      column("case", "text"),
      column("line_kind", "code"),
      column("class", "code"),
      column("value_basis", "code"),
      column("title", "text"),
      column("amount", "decimal", "currency"),
      column("currency", "text"),
      column("fte", "decimal", "other"),
      column("period_start", "date"),
      column("period_end", "date"),
      column("recurrence", "code"),
      column("formula", "text"),
      column("formula_version", "text"),
      column("formula_validation", "code"),
      column("owner", "text"),
    ],
    rows: lineRows,
    totals: [],
    emptyKey: "report.empty.no_records",
  });

  // ---------------------------------------------------------------------------------------------- totals (DG3 engine)
  const totalRows: ReportRow[] = [];
  const lineById = new Map(allLines.map((l) => [l.id, l] as const));
  for (const c of caseRows) {
    const totals = await loadCaseTotals(db, c);
    // The lines the engine read (the case and, for the transformation case, its active initiative cases).
    const included = allLines.filter((l) => totals.includedCaseIds.includes(l.business_case_id));
    const benefitStates = (currency: string, basis: string | null) =>
      included
        .filter(
          (l) =>
            l.line_kind === "benefit" &&
            l.value_basis !== "non_financial" &&
            l.currency.trim() === currency &&
            (basis === null || l.value_basis === basis),
        )
        .map((l) => lineState(lineById.get(l.id)!));
    const push = (measure: string, basis: string | null, t: MoneyTotal, state: ValueState) => {
      totalRows.push({
        ...caseRef(c),
        cells: [
          textValue(codeOf.get(c.id) ?? c.code, "system"),
          codeValue(measure, "report.business_case_measure"),
          basis === null ? codeValue(null, null, NOT_APPLICABLE) : codeValue(basis, "report.business_case_value_basis"),
          textValue(t.currency.trim(), "system"),
          // The engine's amount as computed (null when its lines are all Unknown: Unknown, never 0).
          decimalValue(t.amount, {
            unitKind: "currency",
            currency: t.currency,
            valueBasis: "planned",
            ...presentState(t.amount, state),
          }),
          countValue(t.lineCount),
          countValue(t.unknownLineCount),
        ],
      });
    };
    for (const t of totals.grossBenefits) push("gross_benefits", null, t, totalState(benefitStates(t.currency, null)));
    for (const [basis, list] of Object.entries(totals.grossBenefitsByValueBasis).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    ))
      for (const t of list)
        push("gross_benefits_by_value_basis", basis, t, totalState(benefitStates(t.currency, basis)));
    for (const t of totals.implementationCost) push("implementation_cost", null, t, NOT_APPLICABLE);
    for (const t of totals.implementationCostCash) push("implementation_cost_cash", null, t, NOT_APPLICABLE);
    for (const t of totals.implementationCostNonCash) push("implementation_cost_non_cash", null, t, NOT_APPLICABLE);
    // Net value = gross - cost (the engine's figure): as provisional as the gross benefits it is computed from.
    for (const t of totals.netValue) push("net_value", null, t, totalState(benefitStates(t.currency, null)));
  }
  sections.push({
    key: S.totals,
    titleKey: L("totals"),
    kind: "table",
    sources: cases.map(caseRef),
    columns: [
      column("case", "text"),
      column("measure", "code"),
      column("value_basis", "code"),
      column("currency", "text"),
      column("amount", "decimal", "currency"),
      column("line_count", "count"),
      column("unknown_line_count", "count"),
    ],
    rows: totalRows,
    totals: [],
    emptyKey: "report.empty.no_records",
  });

  // ---------------------------------------------------------------------------------------------- versions
  const versions: VersionRef[] = [];
  const usedVersions = new Set<string>();
  for (const l of allLines) {
    const f = l.benefit_formula_id === null ? undefined : formulas.get(l.benefit_formula_id);
    if (f === undefined || f.current === null || usedVersions.has(f.current.id)) continue;
    usedVersions.add(f.current.id);
    versions.push({
      versionKind: "formula_version",
      referenceId: f.current.id,
      referenceKey: f.code,
      versionLabel: `v${f.current.versionNo}`,
    });
    const v = versionRows.find((r) => r.id === f.current!.id)!;
    sources.push({
      sectionKey: S.lines,
      recordType: "benefit_formula_version",
      recordId: v.id,
      recordVersion: v.version,
      recordUpdatedAt: v.updated_at,
      approvalState: null,
      validationState: formulaVersionState(v.validation_status).validation,
    });
  }
  versions.sort((a, b) => (a.referenceKey < b.referenceKey ? -1 : a.referenceKey > b.referenceKey ? 1 : 0));
  if (versions.length > 0)
    versions.push({
      versionKind: "calculation_engine",
      referenceId: null,
      referenceKey: "formula_engine",
      versionLabel: ENGINE_VERSION,
    });

  return {
    subject: { code: ctx.transformation.code, label: ctx.transformation.name },
    approvalState: "not_applicable",
    sections,
    sources,
    versions,
    evidence: [],
  };
}

export const businessCasesAssembler: Assembler = {
  code: "business_cases",
  parseParameters(raw) {
    const r = emptyReportParameters.safeParse(raw ?? {});
    if (!r.success) throw reportRefusals.parametersInvalid();
    return r.data;
  },
  assemble,
};
