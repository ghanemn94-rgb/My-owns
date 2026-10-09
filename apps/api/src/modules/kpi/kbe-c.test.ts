// Unit tests of KBE-C's pure rules (T-DG4-KBE-C; ADR-0027 §3, §6, §10, §13): the reporting-period shape rules, the
// value shape and currency rules of an actual (Unknown is NULL with a reason, never 0; never converted), the override
// in-force rule, and the database last-line mappings with their exact codes. No database.
import { describe, expect, it } from "vitest";
import { HttpProblem, mapDatabaseGuardError } from "../platform/index.ts";
import { valueColumnsOf } from "./actuals.ts";
import { overrideInForce } from "./rag-overrides.ts";
import { checkPeriodShape, daysBetween } from "./reporting-periods.ts";

const codeOf = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (err) {
    return err instanceof HttpProblem ? (err.toBody("r").code ?? null) : String(err);
  }
};

describe("reporting-period shape (ADR-0027 §3)", () => {
  const base = { frequency: "monthly" as const, periodLabel: "2041-01", basis: "calendar" as const };
  it("accepts a calendar month and a 4-week period", () => {
    expect(codeOf(() => checkPeriodShape({ ...base, periodStart: "2041-01-01", periodEnd: "2041-01-31" }))).toBeNull();
    expect(
      codeOf(() =>
        checkPeriodShape({ ...base, periodStart: "2043-01-05", periodEnd: "2043-02-01", basis: "weeks", weekCount: 4 }),
      ),
    ).toBeNull();
  });
  it("refuses an inverted or too long range, wrong weeks, and a due date not after the end", () => {
    expect(codeOf(() => checkPeriodShape({ ...base, periodStart: "2041-02-01", periodEnd: "2041-01-01" }))).toBe(
      "reporting_period.range_invalid",
    );
    expect(codeOf(() => checkPeriodShape({ ...base, periodStart: "2041-01-01", periodEnd: "2042-01-03" }))).toBe(
      "reporting_period.range_invalid",
    );
    // 367 days (a leap year plus one day) is the longest allowed.
    expect(codeOf(() => checkPeriodShape({ ...base, periodStart: "2040-01-01", periodEnd: "2041-01-01" }))).toBeNull();
    expect(
      codeOf(() =>
        checkPeriodShape({ ...base, periodStart: "2043-01-05", periodEnd: "2043-02-02", basis: "weeks", weekCount: 4 }),
      ),
    ).toBe("reporting_period.weeks_invalid");
    expect(
      codeOf(() => checkPeriodShape({ ...base, periodStart: "2043-01-05", periodEnd: "2043-02-01", weekCount: 4 })),
    ).toBe("reporting_period.weeks_invalid");
    expect(
      codeOf(() =>
        checkPeriodShape({ ...base, periodStart: "2041-01-01", periodEnd: "2041-01-31", updateDueDate: "2041-01-31" }),
      ),
    ).toBe("validation.constraint");
  });
  it("counts days between calendar dates", () => {
    expect(daysBetween("2041-01-01", "2041-01-31")).toBe(30);
    expect(daysBetween("2040-02-28", "2040-03-01")).toBe(2);
  });
});

describe("the value of an actual (ADR-0027 §6)", () => {
  const flow = { value_nature: "flow", currency: null };
  const ratio = { value_nature: "ratio", currency: null };
  const milestone = { value_nature: "milestone", currency: null };
  const sar = { value_nature: "flow", currency: "SAR" };
  const e = (b: object) => ({ action: "submit" as const, dataAsOf: "2041-01-31", ...b });
  it("takes the fields of the value nature", () => {
    expect(valueColumnsOf(flow, e({ value: "12.5" }))).toMatchObject({
      value: "12.5",
      numerator: null,
      missing_reason: null,
    });
    expect(valueColumnsOf(ratio, e({ numerator: "1", denominator: "0" }))).toMatchObject({
      numerator: "1",
      denominator: "0",
    });
    expect(valueColumnsOf(milestone, e({ milestoneAchieved: true, achievedOn: "2041-01-20" }))).toMatchObject({
      milestone_achieved: true,
      achieved_on: "2041-01-20",
    });
  });
  it("'not available' is NULL with its reason, never 0", () => {
    expect(valueColumnsOf(flow, e({ missingReason: "Source down" }))).toEqual({
      value: null,
      numerator: null,
      denominator: null,
      milestone_achieved: null,
      achieved_on: null,
      missing_reason: "Source down",
      currency: null,
    });
  });
  it("refuses a wrong shape with the expected fields named", () => {
    const detail = (fn: () => unknown) => {
      try {
        fn();
      } catch (err) {
        return (err as HttpProblem).toBody("r").detail;
      }
      return null;
    };
    expect(codeOf(() => valueColumnsOf(flow, e({})))).toBe("kpi_actual.value_shape");
    expect(detail(() => valueColumnsOf(ratio, e({ value: "1" })))).toBe(
      "Enter a numerator and a denominator for this KPI, or state why the value is not available.",
    );
    expect(codeOf(() => valueColumnsOf(flow, e({ value: "1", missingReason: "x" })))).toBe("kpi_actual.value_shape");
    expect(codeOf(() => valueColumnsOf(milestone, e({ milestoneAchieved: false, achievedOn: "2041-01-02" })))).toBe(
      "kpi_actual.value_shape",
    );
  });
  it("never converts a currency: another currency is refused, the KPI's is kept", () => {
    expect(codeOf(() => valueColumnsOf(sar, e({ value: "1", currency: "USD" })))).toBe("kpi_actual.currency_mismatch");
    expect(valueColumnsOf(sar, e({ value: "1" })).currency).toBe("SAR");
    expect(codeOf(() => valueColumnsOf(flow, e({ value: "1", currency: "SAR" })))).toBe("kpi_actual.currency_mismatch");
  });
});

describe("override in force (ADR-0027 §10)", () => {
  const now = new Date("2041-01-10T00:00:00Z");
  it("is in force while active and before its expiry, strictly", () => {
    expect(overrideInForce({ status: "active", expires_at: new Date("2041-01-10T00:00:01Z") }, now)).toBe(true);
    expect(overrideInForce({ status: "active", expires_at: now }, now)).toBe(false);
    expect(overrideInForce({ status: "revoked", expires_at: new Date("2042-01-01T00:00:00Z") }, now)).toBe(false);
  });
});

describe("database last-line mappings of KBE-C (ADR-0027 §13)", () => {
  const map = (constraint: string, message = "", detail = "", code = "23514") =>
    mapDatabaseGuardError({ code, constraint, message, detail });
  const body = (p: HttpProblem | null) => p?.toBody("r");
  it("maps each guard to its exact code and status", () => {
    expect(
      body(
        map(
          "reporting_period_label_key",
          "",
          "Key (organization_id, frequency, period_label)=(x, monthly, 2041-01) already exists.",
          "23505",
        ),
      ),
    ).toMatchObject({
      status: 409,
      code: "reporting_period.label_taken",
      detail: "A monthly reporting period 2041-01 already exists.",
    });
    expect(body(map("reporting_period_weeks"))?.code).toBe("reporting_period.weeks_invalid");
    expect(body(map("reporting_period_range"))?.code).toBe("reporting_period.range_invalid");
    expect(body(map("reporting_period_status_step"))?.code).toBe("reporting_period.status_step");
    expect(body(map("kpi_actual_period_open", "kpi_actual: reporting period 2041-01 is closed"))).toMatchObject({
      code: "kpi_actual.period_not_open",
      detail:
        "The reporting period 2041-01 is closed. Actuals are entered only for an open period; a closed period is corrected through a restatement.",
    });
    expect(
      body(map("kpi_actual_value_currency", "kpi_actual_value: currency USD does not match the KPI currency SAR"))
        ?.detail,
    ).toBe("The value is in USD, but the KPI is measured in SAR. Values are never converted.");
    expect(body(map("kpi_actual_review_sod"))).toMatchObject({ status: 403, code: "kpi_actual.sod_submitter" });
    expect(body(map("kpi_actual_slot_key", "", "", "23505"))).toMatchObject({ status: 409, code: "version_conflict" });
    expect(body(map("rag_override_one_in_force"))).toMatchObject({
      status: 409,
      code: "rag_override.already_in_force",
    });
    expect(body(map("rag_override_expiry_window"))?.code).toBe("rag_override.expiry_invalid");
    expect(body(map("rag_override_status_step"))?.code).toBe("rag_override.not_active");
    expect(body(map("kpi_actual_value_present"))?.status).toBe(500);
  });
});
