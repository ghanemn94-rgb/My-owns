// Unit tests of the kpi module's pure rules and of the kpi zod mirrors (no database).
import {
  baselineCreate,
  businessDate,
  isCalendarDate,
  outcomeKpiCreate,
  outcomeKpiUpdate,
  valuePool,
  valuePoolCreate,
  valuePoolUpdate,
} from "@mth/shared/schemas";
import { describe, expect, it } from "vitest";
import {
  baselineDateRule,
  baselineMeasurableRule,
  kpiDefinitionUnitRule,
  leadingNotSelfRule,
  oneBaselineSourceRule,
  resolveQuantification,
  targetAfterBaselineRule,
  targetDateRule,
  todayIn,
  trajectoryRule,
  UNQUANTIFIED,
} from "./rules.ts";

const ID = "01920000-0000-7000-8000-000000000001";

describe("KPI definition unit rule (CHECK kpi_definition_currency_unit)", () => {
  it("a currency KPI needs its currency; no other kind may carry one", () => {
    expect(kpiDefinitionUnitRule("currency", "SAR")).toBeNull();
    expect(kpiDefinitionUnitRule("percentage", null)).toBeNull();
    expect(kpiDefinitionUnitRule("currency", null)?.code).toBe("kpi_definition.currency_required");
    expect(kpiDefinitionUnitRule("count", "SAR")?.code).toBe("kpi_definition.currency_not_allowed");
  });
});

describe("T02 target date (REQ-PB-034: targets are time-bound)", () => {
  it("create without a target date, or with null, is a 422 business rule with the field pointer", () => {
    expect(targetDateRule({ outcomeId: ID, kpiDefinitionId: ID }, "create")).toEqual({
      code: "outcome_kpi.target_date_required",
      detail: expect.any(String),
      pointer: "/targetDate",
    });
    expect(targetDateRule({ targetDate: null }, "create")?.code).toBe("outcome_kpi.target_date_required");
    expect(targetDateRule({ targetDate: "2027-12-31" }, "create")).toBeNull();
  });

  it("an update may omit the date (kept) but may not clear it", () => {
    expect(targetDateRule({ ordinal: 2 }, "update")).toBeNull();
    expect(targetDateRule({ targetDate: null }, "update")?.code).toBe("outcome_kpi.target_date_required");
  });

  it("leaves a non-object body to the 400 validation", () => {
    expect(targetDateRule(null, "create")).toBeNull();
    expect(targetDateRule([], "create")).toBeNull();
  });

  it("the zod mirror itself requires targetDate (contract lockstep)", () => {
    expect(outcomeKpiCreate.safeParse({ outcomeId: ID, kpiDefinitionId: ID }).success).toBe(false);
    expect(outcomeKpiCreate.safeParse({ outcomeId: ID, kpiDefinitionId: ID, targetDate: "2027-12-31" }).success).toBe(
      true,
    );
    expect(outcomeKpiUpdate.safeParse({}).success).toBe(false); // minProperties: 1
  });
});

describe("trajectory and baseline rules", () => {
  const p = (date: string, value = "1") => ({ date, value });
  it("points must have strictly increasing dates and end on or before the target date", () => {
    expect(trajectoryRule([], "2027-12-31")).toBeNull();
    expect(trajectoryRule([p("2026-12-31"), p("2027-06-30"), p("2027-12-31")], "2027-12-31")).toBeNull();
    expect(trajectoryRule([p("2027-06-30"), p("2027-06-30")], "2027-12-31")).toMatchObject({
      code: "outcome_kpi.trajectory_order",
      pointer: "/trajectoryPoints/1/date",
    });
    expect(trajectoryRule([p("2027-06-30"), p("2026-06-30")], "2027-12-31")?.code).toBe("outcome_kpi.trajectory_order");
    expect(trajectoryRule([p("2026-06-30"), p("2028-01-01")], "2027-12-31")).toMatchObject({
      code: "outcome_kpi.trajectory_after_target",
      pointer: "/trajectoryPoints/1/date",
    });
  });

  it("one baseline source, no self-leading KPI, target after the baseline date", () => {
    expect(oneBaselineSourceRule(ID, null)).toBeNull();
    expect(oneBaselineSourceRule(null, "12.5")).toBeNull();
    expect(oneBaselineSourceRule(ID, "12.5")?.code).toBe("outcome_kpi.one_baseline_source");
    expect(leadingNotSelfRule(ID, ID)?.code).toBe("outcome_kpi.leading_is_self");
    expect(leadingNotSelfRule(ID, null)).toBeNull();
    expect(targetAfterBaselineRule("2026-01-31", "2026-01-31")?.code).toBe("outcome_kpi.target_not_after_baseline");
    expect(targetAfterBaselineRule("2026-01-31", "2026-02-01")).toBeNull();
    expect(targetAfterBaselineRule(null, "2020-01-01")).toBeNull();
  });

  it("a baseline date cannot be in the future; Finance validates only a measurable baseline", () => {
    expect(baselineDateRule("2026-10-03", "2026-10-02")?.code).toBe("baseline.date_in_future");
    expect(baselineDateRule("2026-10-02", "2026-10-02")).toBeNull();
    expect(baselineDateRule(null, "2026-10-02")).toBeNull();
    expect(baselineMeasurableRule({ value: "0", source: "Billing", baselineDate: "2026-01-31" })).toBeNull();
    expect(baselineMeasurableRule({ value: null, source: "Billing", baselineDate: "2026-01-31" })).toMatchObject({
      code: "baseline.not_measurable",
      pointer: "/value",
    });
    expect(baselineMeasurableRule({ value: "1", source: null, baselineDate: null })?.detail).toMatch(
      /source, baselineDate/,
    );
  });

  it("todayIn uses the transformation's zone (Asia/Riyadh is UTC+3)", () => {
    expect(todayIn("Asia/Riyadh", new Date("2026-10-01T21:30:00Z"))).toBe("2026-10-02");
    expect(todayIn("UTC", new Date("2026-10-01T21:30:00Z"))).toBe("2026-10-01");
  });
});

describe("value-pool quantification (ADR-0019 §1): unquantified is NULL, never 0", () => {
  it("create defaults to unquantified with NULL amounts", () => {
    expect(resolveQuantification(UNQUANTIFIED, {})).toEqual({ state: UNQUANTIFIED, violation: null });
  });

  it("quantified needs both amounts, downside <= upside, and no unquantified reason", () => {
    expect(
      resolveQuantification(UNQUANTIFIED, {
        quantificationStatus: "quantified",
        downsideAmount: "100",
        upsideAmount: "200",
      }),
    ).toEqual({
      state: {
        quantificationStatus: "quantified",
        downsideAmount: "100",
        upsideAmount: "200",
        unquantifiedReason: null,
      },
      violation: null,
    });
    expect(
      resolveQuantification(UNQUANTIFIED, { quantificationStatus: "quantified", upsideAmount: "200" }).violation,
    ).toMatchObject({ code: "value_pool.amounts_required", pointer: "/downsideAmount" });
    expect(
      resolveQuantification(UNQUANTIFIED, {
        quantificationStatus: "quantified",
        downsideAmount: "200.0001",
        upsideAmount: "200",
      }).violation?.code,
    ).toBe("value_pool.downside_above_upside");
    expect(
      resolveQuantification(UNQUANTIFIED, {
        quantificationStatus: "quantified",
        downsideAmount: "1",
        upsideAmount: "2",
        unquantifiedReason: "why",
      }).violation?.code,
    ).toBe("value_pool.reason_with_amounts");
    // A real zero is a legal quantified assessment.
    expect(
      resolveQuantification(UNQUANTIFIED, {
        quantificationStatus: "quantified",
        downsideAmount: "0",
        upsideAmount: "0",
      }).violation,
    ).toBeNull();
  });

  it("amounts on an unquantified pool are refused, never silently dropped or stored as 0", () => {
    expect(resolveQuantification(UNQUANTIFIED, { upsideAmount: "5" }).violation).toMatchObject({
      code: "value_pool.unquantified_has_amount",
      pointer: "/upsideAmount",
    });
  });

  it("switching state clears the fields that no longer apply", () => {
    const quantified = {
      quantificationStatus: "quantified" as const,
      upsideAmount: "200.0000",
      downsideAmount: "100.0000",
      unquantifiedReason: null,
    };
    expect(
      resolveQuantification(quantified, { quantificationStatus: "unquantified", unquantifiedReason: "Data gap" }),
    ).toEqual({
      state: {
        quantificationStatus: "unquantified",
        upsideAmount: null,
        downsideAmount: null,
        unquantifiedReason: "Data gap",
      },
      violation: null,
    });
    const back = resolveQuantification(
      { ...UNQUANTIFIED, unquantifiedReason: "Data gap" },
      { quantificationStatus: "quantified", downsideAmount: "1", upsideAmount: "3" },
    );
    expect(back.state.unquantifiedReason).toBeNull();
    // An update of one amount keeps the other and re-checks the order with exact decimals.
    expect(resolveQuantification(quantified, { upsideAmount: "99.9999" }).violation?.code).toBe(
      "value_pool.downside_above_upside",
    );
    expect(resolveQuantification(quantified, { upsideAmount: "100" }).state.upsideAmount).toBe("100");
  });
});

describe("kpi zod mirrors: decimal strings at the column scale, calendar dates", () => {
  it("amounts are strings; a JSON number is refused", () => {
    expect(valuePoolCreate.safeParse({ name: "Churn", upsideAmount: 100 }).success).toBe(false);
    expect(valuePoolCreate.safeParse({ name: "Churn", upsideAmount: "100" }).success).toBe(true);
  });

  it("value-pool amounts must fit numeric(20,4); baselines numeric(24,6) - no silent rounding", () => {
    const money = valuePoolUpdate.safeParse({ upsideAmount: "1.12345" });
    expect(money.success).toBe(false);
    expect(money.error?.issues[0]?.message).toBe("validation.decimal_money_scale");
    expect(valuePoolUpdate.safeParse({ upsideAmount: "12345678901234567" }).success).toBe(false);
    expect(valuePoolUpdate.safeParse({ upsideAmount: "1234567890123456.1234" }).success).toBe(true);
    expect(baselineCreate.safeParse({ metric: "m", unit: "%", scope: "customer", value: "0.123456" }).success).toBe(
      true,
    );
    expect(baselineCreate.safeParse({ metric: "m", unit: "%", scope: "customer", value: "1e3" }).success).toBe(false);
  });

  it("an impossible date is refused (2026-02-30), leap days accepted", () => {
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(isCalendarDate("2028-02-29")).toBe(true);
    expect(isCalendarDate("2100-02-29")).toBe(false);
    expect(isCalendarDate("2026-13-01")).toBe(false);
    expect(businessDate.safeParse("2026-1-1").success).toBe(false);
  });

  it("the response mirror accepts null amounts for an unquantified pool and rejects a numeric amount", () => {
    const base = {
      id: ID,
      organizationId: ID,
      transformationId: ID,
      name: "Churn",
      driver: null,
      workstreamCode: null,
      quantificationStatus: "unquantified",
      upsideAmount: null,
      downsideAmount: null,
      currency: "SAR",
      unquantifiedReason: null,
      materiality: "not_assessed",
      confidence: null,
      ownerUserId: null,
      validationStatus: "unvalidated",
      validatedBy: null,
      validatedAt: null,
      validationNote: null,
      validatedRecordVersion: null,
      status: "active",
      archivedAt: null,
      archivedBy: null,
      archiveReason: null,
      version: 1,
      createdAt: "2026-10-02T00:00:00.000Z",
      createdBy: ID,
      updatedAt: "2026-10-02T00:00:00.000Z",
      updatedBy: ID,
    };
    expect(valuePool.safeParse(base).success).toBe(true);
    expect(valuePool.safeParse({ ...base, upsideAmount: 0 }).success).toBe(false);
  });
});
