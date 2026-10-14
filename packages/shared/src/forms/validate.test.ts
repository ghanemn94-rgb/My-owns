// Value validation of the eleven field types (REQ-S06-005, REQ-S16-010; ADR-0041 §3, §4, §7, §10). T-DG5-KBE-B.
// Every type's refusal returns its exact code and English text; the acceptance fixtures (12% → "0.12", 1500000.10 SAR
// exact) are pinned here and in property.test.ts.
import { describe, expect, it } from "vitest";
import { defineField, FIELD_VALUE_MESSAGES, type FieldDefinition } from "./field-types.ts";
import { validateFieldValue, validateRecordValues, type FieldValueResult } from "./validate.ts";

function field(key: string, type: string, attrs: Record<string, unknown> = {}, required = false): FieldDefinition {
  const r = defineField(key, type, attrs, { required });
  if (!r.ok) throw new Error(`fixture ${key}: ${r.code} ${JSON.stringify(r.params)}`);
  return r.field;
}

const UUID_A = "0192aaaa-0000-7000-8000-000000000001";
const UUID_B = "0192aaaa-0000-7000-8000-000000000002";

const F = {
  text: field("notes", "text", { maxLength: 10 }),
  rich: field("story", "rich_text", { maxLength: 20 }),
  number: field("volume", "number", { min: "0", max: "1000000", scale: 2 }),
  currency: field("savings", "currency", { currencyCode: "SAR" }),
  percentage: field("attach_rate", "percentage"),
  date: field("due", "date", { min: "2026-01-01", max: "2027-12-31" }),
  reference: field("linked_benefit", "reference", { targetRecordType: "T14" }),
  attachment: field("proof", "attachment", { maxCount: 2 }),
  lookup: field("owner_bu", "lookup", { lookupSet: "business_units" }),
  lookupCur: field("ccy", "lookup", { lookupSet: "currencies" }),
  lookupRole: field("role", "lookup", { lookupSet: "roles" }),
  choice: field("confidence", "choice", {
    options: [
      { value: "H", labelEn: "High", labelAr: "مرتفع" },
      { value: "M", labelEn: "Medium", labelAr: "متوسط" },
      { value: "L", labelEn: "Low", labelAr: "منخفض" },
    ],
  }),
  multi: field("channels", "choice", {
    multiple: true,
    options: [
      { value: "retail", labelEn: "Retail", labelAr: "التجزئة" },
      { value: "online", labelEn: "Online", labelAr: "الإنترنت" },
    ],
  }),
  calculated: field("net", "calculated", { expression: "volume * 2", resultUnitKind: "other" }),
};

function expectRefusal(r: FieldValueResult, code: keyof typeof FIELD_VALUE_MESSAGES, reason?: string): void {
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.code).toBe(code);
  expect(r.message).toBe(FIELD_VALUE_MESSAGES[code]);
  if (reason !== undefined) expect(r.params["reason"]).toBe(reason);
}
function expectValue(r: FieldValueResult, value: unknown): void {
  expect(r).toMatchObject({ ok: true });
  if (r.ok) expect(r.value).toEqual(value);
}

describe("REQ-S06-005 acceptance fixtures", () => {
  it("a percentage field entered as 12% stores 0.12", () => {
    expectValue(validateFieldValue(F.percentage, "12%"), "0.12");
    expectValue(validateFieldValue(F.percentage, "12", { percentageBareAs: "percent" }), "0.12");
    expectValue(validateFieldValue(F.percentage, "0.12"), "0.12");
  });

  it("a currency field stores decimal SAR without float error", () => {
    const r = validateFieldValue(F.currency, { amount: "1500000.10", currencyCode: "SAR" });
    expectValue(r, { amount: "1500000.10", currencyCode: "SAR" });
    // JSON round trip (what the API stores in jsonb and reads back) is exact.
    expect(JSON.parse(JSON.stringify(r.ok ? r.value : null))).toEqual({ amount: "1500000.10", currencyCode: "SAR" });
    // The classic float traps stay exact strings.
    expectValue(validateFieldValue(F.currency, { amount: "0.30" }), { amount: "0.30", currencyCode: "SAR" });
    // 17 significant digits: a binary float cannot hold it (it would read back as 1000000000000000).
    expectValue(validateFieldValue(F.currency, "999999999999999.99"), {
      amount: "999999999999999.99",
      currencyCode: "SAR",
    });
  });

  it("refuses a float on every decimal path", () => {
    expectRefusal(validateFieldValue(F.number, 1500000.1), "validation.decimal", "not_a_string");
    expectRefusal(
      validateFieldValue(F.currency, { amount: 1500000.1, currencyCode: "SAR" }),
      "validation.currency_amount",
    );
    expectRefusal(validateFieldValue(F.currency, 1500000.1), "validation.currency_amount");
    expectRefusal(validateFieldValue(F.percentage, 0.12), "validation.percentage", "not_a_string");
  });
});

describe("Unknown is never 0", () => {
  it("null and undefined are Unknown (value null) for every stored type", () => {
    for (const f of Object.values(F)) {
      if (f.fieldType === "calculated") continue;
      expect(validateFieldValue(f, null)).toEqual({ ok: true, value: null, checks: [] });
      expect(validateFieldValue(f, undefined)).toEqual({ ok: true, value: null, checks: [] });
    }
  });
});

describe("text and rich_text (shared free-text rules)", () => {
  it("stores text verbatim", () => {
    expectValue(validateFieldValue(F.text, " مرحبا "), " مرحبا ");
    expectValue(validateFieldValue(F.rich, "line 1\nline 2"), "line 1\nline 2");
  });
  it.each([
    ["", "too_short"],
    ["01234567890", "too_long"],
    ["   ", "blank"],
    ["‏​", "blank"],
    ["a\u0000b", "invalid_character"],
    ["a\ud800", "invalid_character"],
    [42, "not_a_string"],
  ])("text %j → validation.text (%s)", (raw, reason) => {
    expectRefusal(validateFieldValue(F.text, raw), "validation.text", reason);
  });
  it("rich_text refuses with validation.rich_text", () => {
    expectRefusal(validateFieldValue(F.rich, "x".repeat(21)), "validation.rich_text", "too_long");
    expectRefusal(validateFieldValue(F.rich, " \n "), "validation.rich_text", "blank");
  });
  it("keeps an emoji pair and Arabic marks (visible content)", () => {
    expectValue(validateFieldValue(F.text, "\u{1F600}"), "\u{1F600}");
  });
});

describe("number", () => {
  it("accepts decimal strings verbatim within range and scale", () => {
    expectValue(validateFieldValue(F.number, "1000000"), "1000000");
    expectValue(validateFieldValue(F.number, "12.50"), "12.50");
    expectValue(validateFieldValue(F.number, "0"), "0");
  });
  it.each([
    ["١٢", "format"], // Arabic-Indic digits: the DG3 decimal rule
    ["۱۲", "format"], // Extended Arabic-Indic (Persian) digits
    ["１２", "format"], // full-width digits
    ["1e3", "format"],
    ["1,000", "format"],
    ["+5", "format"],
    [".5", "format"],
    ["5.", "format"],
    [" 5", "format"],
    ["1234567890123456", "format"], // 16 integer digits
    ["1.1234567", "format"], // 7 decimals
    ["1.234", "scale"], // field scale 2
    ["-1", "range"],
    ["1000000.01", "range"],
  ])("%j → validation.decimal (%s)", (raw, reason) => {
    expectRefusal(validateFieldValue(F.number, raw), "validation.decimal", reason);
  });
});

describe("currency", () => {
  it("takes the field currency when the code is absent, and keeps the amount verbatim", () => {
    expectValue(validateFieldValue(F.currency, "-250.5"), { amount: "-250.5", currencyCode: "SAR" });
    expectValue(validateFieldValue(F.currency, { amount: "100" }), { amount: "100", currencyCode: "SAR" });
  });
  it.each([
    [{ amount: "1.234", currencyCode: "SAR" }, "validation.currency_amount", "amount"],
    [{ amount: "١٠٠", currencyCode: "SAR" }, "validation.currency_amount", "amount"],
    [{ amount: "1e6", currencyCode: "SAR" }, "validation.currency_amount", "amount"],
    [{ currencyCode: "SAR" }, "validation.currency_amount", "shape"],
    [{ amount: "1", currencyCode: "SAR", fx: "1" }, "validation.currency_amount", "shape"],
    [["1"], "validation.currency_amount", "shape"],
    [true, "validation.currency_amount", "shape"],
    [{ amount: "1", currencyCode: "sar" }, "validation.currency_code", "format"],
    [{ amount: "1", currencyCode: "SR" }, "validation.currency_code", "format"],
    [{ amount: "1", currencyCode: null }, "validation.currency_code", "format"],
    [{ amount: "1", currencyCode: "USD" }, "validation.currency_code", "currency_mismatch"],
  ] as const)("%j → %s (%s)", (raw, code, reason) => {
    expectRefusal(validateFieldValue(F.currency, raw), code, reason);
  });
  it("respects a scale-0 field", () => {
    const whole = field("capex", "currency", { scale: 0 });
    expectValue(validateFieldValue(whole, "1500000"), { amount: "1500000", currencyCode: "SAR" });
    expectValue(validateFieldValue(whole, "1500000.00"), { amount: "1500000.00", currencyCode: "SAR" });
    expectRefusal(validateFieldValue(whole, "1500000.10"), "validation.currency_amount", "amount");
  });
});

describe("percentage", () => {
  it.each([
    ["12%", "0.12"],
    ["12 %", "0.12"],
    ["12٪", "0.12"],
    ["12.5%", "0.125"],
    ["100%", "1"],
    ["0%", "0"],
    ["0.12", "0.12"],
    ["0.120", "0.12"],
    ["1", "1"],
    ["0.0001%", "0.000001"],
    [" 12 % ", "0.12"],
  ])("API body %j → %j", (raw, stored) => {
    expectValue(validateFieldValue(F.percentage, raw), stored);
  });
  it("reads a bare value as percent in entry mode", () => {
    expectValue(validateFieldValue(F.percentage, "12", { percentageBareAs: "percent" }), "0.12");
    expectValue(validateFieldValue(F.percentage, "0.5", { percentageBareAs: "percent" }), "0.005");
  });
  it.each([
    ["١٢%", "format"],
    ["12%%", "format"],
    ["%12", "format"],
    ["1e1%", "format"],
    ["0.00001%", "out_of_range"], // 7 fraction digits: never rounded
    ["101%", "range"],
    ["-1%", "range"],
    ["1.5", "range"],
  ])("%j → validation.percentage (%s)", (raw, reason) => {
    expectRefusal(validateFieldValue(F.percentage, raw), "validation.percentage", reason);
  });
  it("honours fraction bounds", () => {
    const delta = field("uplift", "percentage", { min: "-0.5", max: "0.5" });
    expectValue(validateFieldValue(delta, "-10%"), "-0.1");
    expectRefusal(validateFieldValue(delta, "60%"), "validation.percentage", "range");
  });
});

describe("date", () => {
  it("accepts a real calendar date within bounds", () => {
    expectValue(validateFieldValue(F.date, "2026-10-14"), "2026-10-14");
    expectValue(validateFieldValue(F.date, "2027-02-28"), "2027-02-28");
  });
  it.each([
    ["2026-02-29", "format"],
    ["2026-13-01", "format"],
    ["2026-1-01", "format"],
    ["2026-10-14T00:00:00Z", "format"],
    ["١٤-١٠-٢٠٢٦", "format"],
    [20261014, "not_a_string"],
    ["2025-12-31", "range"],
    ["2028-01-01", "range"],
  ])("%j → validation.date (%s)", (raw, reason) => {
    expectRefusal(validateFieldValue(F.date, raw), "validation.date", reason);
  });
});

describe("reference and attachment", () => {
  it("returns the in-transaction checks with lower-cased uuids", () => {
    const r = validateFieldValue(F.reference, UUID_A.toUpperCase());
    expect(r).toEqual({
      ok: true,
      value: UUID_A,
      checks: [{ kind: "reference", field: "linked_benefit", targetRecordType: "T14", id: UUID_A }],
    });
    const a = validateFieldValue(F.attachment, [UUID_A, UUID_B]);
    expect(a).toEqual({
      ok: true,
      value: [UUID_A, UUID_B],
      checks: [{ kind: "attachment", field: "proof", evidenceIds: [UUID_A, UUID_B] }],
    });
  });
  it.each([["not-a-uuid"], [42], [[UUID_A]], [""]])("reference %j → validation.reference", (raw) => {
    expectRefusal(validateFieldValue(F.reference, raw), "validation.reference");
  });
  it.each([
    [UUID_A, "not_an_array"],
    [[], "empty"],
    [[UUID_A, UUID_B, "0192aaaa-0000-7000-8000-000000000003"], "too_many"],
    [[UUID_A, UUID_A.toUpperCase()], "duplicate"],
    [["x"], "format"],
  ])("attachment %j → validation.attachment (%s)", (raw, reason) => {
    expectRefusal(validateFieldValue(F.attachment, raw), "validation.attachment", reason);
  });
});

describe("lookup", () => {
  it("defers membership to the caller, or checks the members it is given", () => {
    expect(validateFieldValue(F.lookup, UUID_A)).toEqual({
      ok: true,
      value: UUID_A,
      checks: [{ kind: "lookup", field: "owner_bu", lookupSet: "business_units", value: UUID_A }],
    });
    const members = { roles: new Set(["SP", "TL"]) };
    expect(validateFieldValue(F.lookupRole, "TL", { lookupMembers: members })).toEqual({
      ok: true,
      value: "TL",
      checks: [],
    });
    expectRefusal(
      validateFieldValue(F.lookupRole, "ADM", { lookupMembers: members }),
      "validation.lookup",
      "not_a_member",
    );
    expectValue(validateFieldValue(F.lookupCur, "SAR"), "SAR");
  });
  it.each([
    [F.lookup, "TL"],
    [F.lookupCur, "sar"],
    [F.lookupRole, ""],
    [F.lookupRole, " "],
    [F.lookupRole, "x".repeat(101)],
    [F.lookupRole, 7],
  ])("%#: refuses with validation.lookup", (f, raw) => {
    expectRefusal(validateFieldValue(f, raw), "validation.lookup");
  });
});

describe("choice", () => {
  it("accepts one listed value, or several when multiple", () => {
    expectValue(validateFieldValue(F.choice, "H"), "H");
    expectValue(validateFieldValue(F.multi, ["online", "retail"]), ["online", "retail"]);
  });
  it.each([
    [F.choice, "h", "not_an_option"],
    [F.choice, "High", "not_an_option"],
    [F.choice, ["H"], "not_a_string"],
    [F.multi, "retail", "not_an_array"],
    [F.multi, [], "empty"],
    [F.multi, ["retail", "retail"], "duplicate"],
    [F.multi, ["retail", "phone"], "not_an_option"],
  ])("%#: refuses with validation.choice (%s)", (f, raw, reason) => {
    expectRefusal(validateFieldValue(f, raw), "validation.choice", reason);
  });
});

describe("calculated", () => {
  it("is never stored", () => {
    expect(validateFieldValue(F.calculated, "5")).toMatchObject({
      ok: false,
      code: "form_record.custom_field_unknown",
      params: { field: "net", reason: "calculated" },
    });
  });
});

describe("validateRecordValues", () => {
  const fields = [F.text, F.percentage, F.currency, F.calculated, field("budget_owner", "text", {}, true)] as const;

  it("normalizes every given value and collects the deferred checks", () => {
    const r = validateRecordValues([...fields, F.reference], {
      notes: "ok",
      attach_rate: "12%",
      savings: { amount: "1500000.10", currencyCode: "SAR" },
      budget_owner: "Finance",
      linked_benefit: UUID_A,
    });
    expect(r).toEqual({
      ok: true,
      values: {
        notes: "ok",
        attach_rate: "0.12",
        savings: { amount: "1500000.10", currencyCode: "SAR" },
        budget_owner: "Finance",
        linked_benefit: UUID_A,
      },
      checks: [{ kind: "reference", field: "linked_benefit", targetRecordType: "T14", id: UUID_A }],
    });
  });

  it("refuses unknown and calculated keys with 422 form_record.custom_field_unknown", () => {
    const r = validateRecordValues(fields, { budget_owner: "x", gap: "y", net: "1" });
    expect(r).toMatchObject({
      ok: false,
      status: 422,
      code: "form_record.custom_field_unknown",
      message: "This field is not an extension field of this form in the version your transformation uses.",
      problems: [
        { field: "gap", params: { reason: "unknown" } },
        { field: "net", params: { reason: "calculated" } },
      ],
    });
  });

  it("refuses invalid values with 400 and every field code", () => {
    const r = validateRecordValues(fields, { budget_owner: "x", attach_rate: "150%", notes: " " });
    expect(r).toMatchObject({
      ok: false,
      status: 400,
      code: "validation",
      problems: [
        { field: "attach_rate", code: "validation.percentage" },
        { field: "notes", code: "validation.text" },
      ],
    });
  });

  it("refuses a missing or cleared required field with 422 form_record.custom_field_required", () => {
    for (const values of [{}, { budget_owner: null }]) {
      expect(validateRecordValues(fields, values)).toMatchObject({
        ok: false,
        status: 422,
        code: "form_record.custom_field_required",
        message: "Fill in the required extension fields.",
        problems: [{ field: "budget_owner" }],
      });
    }
  });

  it("refuses a values payload that is not an object", () => {
    for (const v of [null, [], "x", 1]) {
      expect(validateRecordValues(fields, v)).toMatchObject({ ok: false, status: 400, code: "validation" });
    }
  });
});
