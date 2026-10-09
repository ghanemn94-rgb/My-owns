// The benefit profile form (T-DG4-FE-C; ADR-0029 §1): the fields of createBenefit and updateBenefit, built for FE-A's
// P4FormDialog. Rules mirrored here only to help the user (the API decides and answers with the exact ADR codes):
//  - type ↔ class: the class options follow the chosen type (VALUE_CLASSES_BY_TYPE; REQ-S08-009);
//  - a financial class needs a financial-statement line, a non-financial one an agreed KPI (REQ-S08-003);
//  - a non-financial benefit has no SAR value unless an approved valuation method is chosen (REQ-S08-010);
//  - ONE owner (a single select; REQ-PB-058);
//  - decimals are typed as text and sent as decimal strings, never numbers (S-5).
import type { TFunction } from "i18next";
import {
  BENEFIT_CONFIDENCES,
  BENEFIT_RAG,
  BENEFIT_RECURRENCES,
  BENEFIT_TYPES,
  CONTROL_CADENCES,
  VALUE_CLASSES_BY_TYPE,
  type BenefitType,
} from "@mth/shared/schemas";
import { textOf, type P4FieldSpec, type P4Values } from "../my-work/p4ui.tsx";
import type { Benefit, BenefitValuationMethod } from "./api.ts";
import { MEASURE_INPUT, MONEY_INPUT, vocabOptions } from "./ui.tsx";

export interface ProfileOptions {
  readonly people: readonly { id: string; label: string }[];
  readonly kpis: readonly { id: string; label: string }[];
  readonly formulas: readonly { id: string; label: string }[];
  readonly methods: readonly BenefitValuationMethod[];
  readonly groups: readonly { id: string; label: string }[];
}

const isFinancial = (v: P4Values) => typeof v["valueClass"] === "string" && v["valueClass"] !== "non_financial";
const isNonFinancial = (v: P4Values) => v["valueClass"] === "non_financial";

export function profileFields(
  t: TFunction,
  values: P4Values,
  o: ProfileOptions,
  mode: "create" | "edit",
): P4FieldSpec[] {
  const type = (values["benefitType"] as BenefitType | undefined) || undefined;
  const classes = type ? VALUE_CLASSES_BY_TYPE[type] : [];
  const f = (name: string) => t(`benefitsP4.field.${name}`);
  const people = o.people.map((p) => ({ value: p.id, label: p.label }));
  const approvedMethods = o.methods
    .filter((m) => m.status === "approved")
    .map((m) => ({ value: m.id, label: `${m.code} · ${m.name}` }));
  const fields: P4FieldSpec[] = [
    { name: "title", label: f("title"), kind: "text", required: true, max: 300 },
    { name: "description", label: f("description"), kind: "textarea", required: true, max: 8000 },
    {
      name: "benefitType",
      label: f("benefitType"),
      kind: "select",
      required: true,
      options: vocabOptions(t, "type", BENEFIT_TYPES),
    },
    {
      name: "valueClass",
      label: f("valueClass"),
      kind: "select",
      required: true,
      hint: t("benefitsP4.form.classHint"),
      options: vocabOptions(t, "valueClass", classes),
    },
    {
      name: "ownerUserId",
      label: f("owner"),
      kind: "select",
      required: true,
      options: people,
      hint: t("benefitsP4.form.ownerHint"),
    },
    {
      name: "currency",
      label: f("currency"),
      kind: "text",
      required: true,
      max: 3,
      ltr: true,
      hint: t("benefitsP4.form.currencyHint"),
    },
    {
      name: "financialStatementLine",
      label: f("financialStatementLine"),
      kind: "text",
      required: true,
      max: 200,
      when: isFinancial,
    },
    {
      name: "measurementKpiDefinitionId",
      label: f("measurementKpi"),
      kind: "select",
      options: o.kpis.map((k) => ({ value: k.id, label: k.label })),
      when: (v) => isNonFinancial(v) || v["measurementKpiDefinitionId"] !== "",
      hint: t("benefitsP4.form.kpiHint"),
    },
    {
      name: "valuationMethodId",
      label: f("valuationMethod"),
      kind: "select",
      options: approvedMethods,
      when: isNonFinancial,
      hint: t("benefitsP4.form.methodHint"),
    },
    { name: "plannedValue", label: f("plannedValue"), kind: "text", ltr: true, hint: t("benefitsP4.form.moneyHint") },
    {
      name: "baselineValue",
      label: f("baselineValue"),
      kind: "text",
      ltr: true,
      hint: t("benefitsP4.form.decimalHint"),
    },
    { name: "baselineUnit", label: f("baselineUnit"), kind: "text", max: 50 },
    { name: "baselineDate", label: f("baselineDate"), kind: "date" },
    { name: "counterfactual", label: f("counterfactual"), kind: "textarea", max: 4000 },
    {
      name: "benefitFormulaId",
      label: f("formula"),
      kind: "select",
      options: o.formulas.map((x) => ({ value: x.id, label: x.label })),
      when: isFinancial,
      hint: t("benefitsP4.form.formulaHint"),
    },
    { name: "targetValue", label: f("targetValue"), kind: "text", ltr: true, hint: t("benefitsP4.form.decimalHint") },
    { name: "targetDate", label: f("targetDate"), kind: "date" },
    { name: "realizationStart", label: f("realizationStart"), kind: "date" },
    { name: "realizationEnd", label: f("realizationEnd"), kind: "date" },
    {
      name: "recurrence",
      label: f("recurrence"),
      kind: "select",
      options: vocabOptions(t, "recurrence", BENEFIT_RECURRENCES),
    },
    { name: "driverKey", label: f("driverKey"), kind: "text", max: 100, ltr: true, hint: t("benefitsP4.form.keyHint") },
    { name: "populationKey", label: f("populationKey"), kind: "text", max: 100, ltr: true },
    { name: "measurementSource", label: f("measurementSource"), kind: "text", max: 500 },
    {
      name: "confidence",
      label: f("confidence"),
      kind: "select",
      options: vocabOptions(t, "confidence", BENEFIT_CONFIDENCES),
    },
    { name: "assumptions", label: f("assumptions"), kind: "textarea", max: 8000 },
    {
      name: "financeValidatorUserId",
      label: f("financeValidator"),
      kind: "select",
      options: people,
      hint: t("benefitsP4.form.validatorHint"),
    },
    {
      name: "benefitGroupId",
      label: f("group"),
      kind: "select",
      options: o.groups.map((g) => ({ value: g.id, label: g.label })),
    },
  ];
  if (mode === "edit")
    fields.push(
      {
        name: "recoveryPlan",
        label: f("recoveryPlan"),
        kind: "textarea",
        max: 8000,
        hint: t("benefitsP4.form.recoveryHint"),
      },
      { name: "bauOwnerUserId", label: f("bauOwner"), kind: "select", options: people },
      {
        name: "controlCadence",
        label: f("controlCadence"),
        kind: "select",
        options: vocabOptions(t, "cadence", CONTROL_CADENCES),
      },
      {
        name: "statusRag",
        label: f("statusRag"),
        kind: "select",
        options: vocabOptions(t, "rag", BENEFIT_RAG),
        hint: t("benefitsP4.form.ragHint"),
      },
      { name: "statusRagNote", label: f("statusRagNote"), kind: "textarea", max: 2000 },
    );
  return fields;
}

const TEXT_FIELDS = [
  "title",
  "description",
  "financialStatementLine",
  "baselineUnit",
  "counterfactual",
  "driverKey",
  "populationKey",
  "measurementSource",
  "assumptions",
  "recoveryPlan",
  "statusRagNote",
] as const;
const ID_FIELDS = [
  "benefitType",
  "valueClass",
  "ownerUserId",
  "measurementKpiDefinitionId",
  "valuationMethodId",
  "benefitFormulaId",
  "recurrence",
  "confidence",
  "financeValidatorUserId",
  "benefitGroupId",
  "bauOwnerUserId",
  "controlCadence",
  "statusRag",
] as const;
const DATE_FIELDS = ["baselineDate", "targetDate", "realizationStart", "realizationEnd"] as const;
const DECIMAL_FIELDS = { plannedValue: MONEY_INPUT, baselineValue: MEASURE_INPUT, targetValue: MEASURE_INPUT } as const;

/** The form values of a stored benefit (edit). */
export function profileInitial(b: Benefit): P4Values {
  const v: P4Values = {};
  for (const k of [
    ...TEXT_FIELDS,
    ...ID_FIELDS,
    ...DATE_FIELDS,
    "plannedValue",
    "baselineValue",
    "targetValue",
    "currency",
  ])
    v[k] = ((b as unknown as Record<string, unknown>)[k] as string | null | undefined) ?? "";
  return v;
}

/**
 * The request body. Create omits empty optional fields; edit sends only what changed (an emptied field becomes null).
 * A decimal that is not a decimal stops the request with a field error.
 */
export function profileBody(
  values: P4Values,
  visible: readonly string[],
  before?: P4Values,
): Record<string, unknown> | { fieldErrors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const out: Record<string, unknown> = {};
  const shown = new Set(visible);
  const put = (k: string, v: string | null) => {
    if (before) {
      const old = (before[k] as string | undefined) ?? "";
      if ((v ?? "") === old) return;
      out[k] = v;
    } else if (v !== null) out[k] = v;
  };
  for (const k of TEXT_FIELDS) if (shown.has(k)) put(k, textOf(values[k]) ?? null);
  for (const k of [...ID_FIELDS, ...DATE_FIELDS]) if (shown.has(k)) put(k, (values[k] as string) || null);
  for (const [k, re] of Object.entries(DECIMAL_FIELDS)) {
    if (!shown.has(k)) continue;
    const s = ((values[k] as string | undefined) ?? "").trim();
    if (s !== "" && !re.test(s)) errors[k] = "validation.decimal";
    else put(k, s === "" ? null : s);
  }
  if (shown.has("currency")) {
    const c = ((values["currency"] as string | undefined) ?? "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(c)) errors["currency"] = "validation.currency";
    else put("currency", c);
  }
  if (Object.keys(errors).length > 0) return { fieldErrors: errors };
  if (before && Object.keys(out).length === 0) return { fieldErrors: { title: "validation.empty_patch" } };
  return out;
}
