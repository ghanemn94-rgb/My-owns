// Every problem code the business-case and T09 APIs can return (ADR-0024 §6 item 10, §9; kpi module sources) and
// every engine code is translated in BOTH languages from this task's namespaces, so the English server `detail` is
// never what a user reads (DG2 web rule "Problem codes are translated in the UI").
import { FORMULA_KINDS } from "@mth/shared/calc";
import { describe, expect, it } from "vitest";
import { createI18n } from "../../i18n/index.ts";
import { ownProblemText } from "./formKit.tsx";

const CODES = [
  "business_case.line_class_mismatch",
  "business_case.value_basis_mismatch",
  "business_case.non_financial_amount",
  "business_case.formula_already_linked",
  "business_case.not_initiative_lead",
  "business_case.amount_negative",
  "business_case.fte_only_internal",
  "business_case.fte_positive",
  "business_case.period_range",
  "business_case.formula_only_benefit",
  "business_case.transformation_case_exists",
  "business_case.initiative_case_exists",
  "business_case.transformation_case_required",
  "business_case.initiative_required",
  "business_case.initiative_not_allowed",
  "business_case.has_initiative_cases",
  "business_case.baseline_missing",
  "business_case.archived",
  "business_case.already_archived",
  "business_case_line.archived",
  "business_case_line.already_archived",
  "business_case.revenue_and_margin",
  "business_case.possible_duplicate",
  "finance.validator_is_author",
  "benefit_formula.archived",
  "benefit_formula.already_archived",
  "benefit_formula.in_use",
  "benefit_formula.example_and_version",
  "benefit_formula_version.validation_final",
  "formula.syntax",
  "formula.undefined_variable",
  "formula.kind_mismatch",
  "formula.currency_product",
  "formula.currency_mismatch",
  "formula.period_mismatch",
  "formula.invalid_variable",
  "formula.division_by_zero",
  "formula.missing_input",
  "formula.result_out_of_range",
  "validation.fte",
  "validation.formula_variable_name",
];

describe.each(["en", "ar"] as const)("FE-C problem codes (%s)", (locale) => {
  const i18n = createI18n(locale);
  const t = i18n.t.bind(i18n);
  it("translates every business-case, T09 and engine code", () => {
    expect(CODES.filter((c) => ownProblemText(t, c) === "")).toEqual([]);
  });
  it("names every formula kind", () => {
    expect(FORMULA_KINDS.filter((k) => !i18n.exists(`benefitFormulas.kind.${k}`))).toEqual([]);
  });
});
