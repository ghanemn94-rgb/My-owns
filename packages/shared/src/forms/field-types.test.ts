// Settings schemas of the eleven field types (REQ-S06-005; ADR-0041 §3, §10). T-DG5-KBE-B.
import { describe, expect, it } from "vitest";
import { KPI_UNIT_KINDS } from "../schemas/kpi.ts";
import {
  defineField,
  FIELD_SETTINGS_KEYS,
  FIELD_TYPE_CODE,
  FIELD_TYPES,
  FIELD_VALUE_MESSAGES,
  FORM_SCHEMA_MESSAGES,
  parseFieldSettings,
  RESULT_UNIT_KINDS,
} from "./field-types.ts";

describe("the field-type catalogue", () => {
  it("has exactly the eleven M0154 types in order (OpenAPI FormFieldType, CHECK methodology_element_field_type)", () => {
    expect(FIELD_TYPES).toEqual([
      "text",
      "rich_text",
      "number",
      "currency",
      "percentage",
      "date",
      "reference",
      "attachment",
      "lookup",
      "choice",
      "calculated",
    ]);
    expect(Object.keys(FIELD_SETTINGS_KEYS).sort()).toEqual([...FIELD_TYPES].sort());
  });

  it("states the result unit kinds of ADR-0037 N5 (the KPI unit_kind list)", () => {
    expect(RESULT_UNIT_KINDS).toEqual(KPI_UNIT_KINDS);
  });

  it("carries the exact ADR-0041 §10 English texts", () => {
    expect(FIELD_VALUE_MESSAGES).toEqual({
      "validation.text": "Enter text within the allowed length.",
      "validation.rich_text": "Enter formatted text within the allowed length.",
      "validation.decimal": "Enter a number within the allowed range, with at most the allowed decimals.",
      "validation.currency_amount": "Enter an amount with at most two decimals.",
      "validation.currency_code": "Enter a three-letter currency code.",
      "validation.percentage": "Enter a percentage within the allowed range, for example 12%.",
      "validation.date": "Enter a valid date as YYYY-MM-DD.",
      "validation.reference": "Choose an existing record of the expected type in this transformation.",
      "validation.attachment": "Choose evidence from this transformation (at most the allowed number).",
      "validation.lookup": "Choose an active value from the list.",
      "validation.choice": "Choose one of the listed options.",
    });
    expect(FORM_SCHEMA_MESSAGES).toEqual({
      "form_schema.field_type_unknown": "Choose one of the eleven field types.",
      "form_schema.field_settings_invalid": "This field type is missing a required setting.",
      "form_schema.calculated_formula_invalid":
        "The calculated field's formula is invalid or refers to an unknown field.",
      "form_record.custom_field_unknown":
        "This field is not an extension field of this form in the version your transformation uses.",
      "form_record.custom_field_required": "Fill in the required extension fields.",
    });
    expect(FIELD_TYPE_CODE).toEqual({
      text: "validation.text",
      rich_text: "validation.rich_text",
      number: "validation.decimal",
      currency: "validation.currency_amount",
      percentage: "validation.percentage",
      date: "validation.date",
      reference: "validation.reference",
      attachment: "validation.attachment",
      lookup: "validation.lookup",
      choice: "validation.choice",
    });
  });
});

describe("parseFieldSettings", () => {
  it("refuses an unknown type with form_schema.field_type_unknown", () => {
    for (const t of ["", "Text", "money", "formula", 3, null, undefined]) {
      const r = parseFieldSettings(t, {});
      expect(r).toMatchObject({ ok: false, code: "form_schema.field_type_unknown" });
      if (!r.ok) expect(r.message).toBe("Choose one of the eleven field types.");
    }
  });

  it("applies the ADR-0041 §3 defaults", () => {
    expect(parseFieldSettings("text", {})).toEqual({ ok: true, fieldType: "text", settings: { maxLength: 2000 } });
    expect(parseFieldSettings("rich_text", {})).toMatchObject({ settings: { maxLength: 20000 } });
    expect(parseFieldSettings("number", {})).toMatchObject({ settings: { scale: 6 } });
    expect(parseFieldSettings("currency", {})).toMatchObject({ settings: { currencyCode: "SAR", scale: 2 } });
    expect(parseFieldSettings("currency", {}, { defaultCurrency: "USD" })).toMatchObject({
      settings: { currencyCode: "USD", scale: 2 },
    });
    expect(parseFieldSettings("percentage", {})).toMatchObject({ settings: { min: "0", max: "1" } });
    expect(parseFieldSettings("date", {})).toEqual({ ok: true, fieldType: "date", settings: {} });
    expect(parseFieldSettings("attachment", {})).toMatchObject({ settings: { maxCount: 20 } });
  });

  it("reads only the keys of its type from the element attributes", () => {
    const r = parseFieldSettings("text", { fieldType: "text", labelEn: "Notes", maxLength: 300, required: true });
    expect(r).toEqual({ ok: true, fieldType: "text", settings: { maxLength: 300 } });
  });

  const invalid: [string, Record<string, unknown>, string][] = [
    ["text", { maxLength: 0 }, "maxLength"],
    ["text", { maxLength: 2001 }, "maxLength"],
    ["text", { maxLength: 10.5 }, "maxLength"],
    ["rich_text", { maxLength: 20001 }, "maxLength"],
    ["number", { min: 1 }, "min"], // a JSON number is not a decimal string
    ["number", { min: "5", max: "1" }, "max"],
    ["number", { scale: 7 }, "scale"],
    ["number", { max: "1e3" }, "max"],
    ["currency", { currencyCode: "sar" }, "currencyCode"],
    ["currency", { scale: 3 }, "scale"],
    ["percentage", { min: "0.5", max: "0.1" }, "max"],
    ["percentage", { max: "12%" }, "max"],
    ["date", { min: "2026-02-30" }, "min"],
    ["date", { min: "2026-12-01", max: "2026-01-01" }, "max"],
    ["reference", {}, "targetRecordType"],
    ["reference", { targetRecordType: "Benefit" }, "targetRecordType"],
    ["attachment", { maxCount: 21 }, "maxCount"],
    ["attachment", { maxCount: 0 }, "maxCount"],
    ["lookup", {}, "lookupSet"],
    ["lookup", { lookupSet: "customers" }, "lookupSet"],
    ["choice", {}, "options"],
    ["choice", { options: [] }, "options"],
    [
      "choice",
      {
        options: [
          { value: "a", labelEn: "A", labelAr: "أ" },
          { value: "a", labelEn: "A2", labelAr: "أ٢" },
        ],
      },
      "options",
    ],
    ["choice", { options: [{ value: "a", labelEn: "A", labelAr: " " }] }, "options.0.labelAr"],
    ["choice", { options: [{ value: "a", labelEn: "A", labelAr: "أ", extra: 1 }] }, "options.0"],
    ["choice", { options: [{ value: "a", labelEn: "A", labelAr: "أ" }], multiple: "yes" }, "multiple"],
    ["calculated", { resultUnitKind: "count" }, "expression"],
    ["calculated", { expression: "a + b" }, "resultUnitKind"],
    ["calculated", { expression: "", resultUnitKind: "count" }, "expression"],
    ["calculated", { expression: "x".repeat(2001), resultUnitKind: "count" }, "expression"],
    ["calculated", { expression: "a", resultUnitKind: "money" }, "resultUnitKind"],
  ];
  it.each(invalid)("%s %j → form_schema.field_settings_invalid at %s", (type, attrs, path) => {
    const r = parseFieldSettings(type, attrs);
    expect(r).toMatchObject({ ok: false, code: "form_schema.field_settings_invalid", params: { path } });
    if (!r.ok) expect(r.message).toBe("This field type is missing a required setting.");
  });

  it("accepts complete settings of every type", () => {
    const ok: [string, Record<string, unknown>][] = [
      ["text", { maxLength: 1 }],
      ["rich_text", { maxLength: 20000 }],
      ["number", { min: "-10.5", max: "1000000", scale: 0 }],
      ["currency", { currencyCode: "SAR", scale: 0 }],
      ["percentage", { min: "-1", max: "2" }],
      ["date", { min: "2026-01-01", max: "2026-12-31" }],
      ["reference", { targetRecordType: "T14" }],
      ["reference", { targetRecordType: "change_request" }],
      ["attachment", { maxCount: 1 }],
      ["lookup", { lookupSet: "business_units" }],
      ["choice", { options: [{ value: "high", labelEn: "High", labelAr: "مرتفع" }], multiple: true }],
      ["calculated", { expression: "volume * unit_cost_delta", resultUnitKind: "currency" }],
    ];
    for (const [t, a] of ok) expect(parseFieldSettings(t, a).ok, `${t} ${JSON.stringify(a)}`).toBe(true);
  });

  it("defineField builds a field definition with its required flag", () => {
    const r = defineField("savings", "currency", { currencyCode: "SAR" }, { required: true });
    expect(r).toEqual({
      ok: true,
      field: { key: "savings", fieldType: "currency", settings: { currencyCode: "SAR", scale: 2 }, required: true },
    });
  });
});
