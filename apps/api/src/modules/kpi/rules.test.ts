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
  kpiDefinitionActivationRule,
  kpiDefinitionUnitRule,
  leadingNotSelfRule,
  oneBaselineSourceRule,
  resolveQuantification,
  targetAfterBaselineRule,
  targetDateRule,
  todayIn,
  TRAJECTORY_CONTENT_FIELDS,
  trajectoryAuthors,
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

describe("trajectory authorship (F-DG2-141: who may not approve a T02 trajectory)", () => {
  const TL = "tl";
  const BO = "bo";
  const KDS = "kds";
  const ev = (actor: string, changes: unknown, onBehalfOf: string | null = null) => ({
    actorUserId: actor,
    onBehalfOfUserId: onBehalfOf,
    changes,
  });
  const ch = (...fields: string[]) => Object.fromEntries(fields.map((f) => [f, { from: null, to: "x" }]));

  it("the trajectory content is KPI, baseline, target value, target date and trajectory points", () => {
    expect([...TRAJECTORY_CONTENT_FIELDS]).toEqual([
      "kpi_definition_id",
      "baseline_id",
      "baseline_value",
      "target_value",
      "target_date",
      "trajectory_points",
    ]);
  });

  it("a row nobody edited is authored by its creator only", () => {
    expect([...trajectoryAuthors([], TL)]).toEqual([TL]);
    expect([...trajectoryAuthors([ev(TL, ch("kpi_definition_id", "target_date", "target_value"))], TL)]).toEqual([TL]);
  });

  it("the finding's scenario: TL created, BO changed the target value -> BO is an author", () => {
    const events = [ev(BO, ch("target_value")), ev(TL, ch("kpi_definition_id", "target_value", "target_date"))];
    expect(trajectoryAuthors(events, TL).has(BO)).toBe(true);
  });

  it("the newest change per field decides; a later change of ANOTHER field does not clear an author", () => {
    // newest first: KDS changed the value after BO changed the date -> both are authors.
    const events = [ev(KDS, ch("target_value")), ev(BO, ch("target_date")), ev(TL, ch("target_value", "target_date"))];
    const authors = trajectoryAuthors(events, TL);
    expect(authors.has(BO)).toBe(true);
    expect(authors.has(KDS)).toBe(true);
  });

  it("an author whose every change was overwritten by someone else is no longer an author", () => {
    const events = [ev(KDS, ch("target_value")), ev(BO, ch("target_value")), ev(TL, ch("target_date"))];
    expect(trajectoryAuthors(events, TL).has(BO)).toBe(false);
  });

  it("non-trajectory changes (owner, ordinal, approval fields) and empty diffs never make an author", () => {
    const events = [
      ev(BO, ch("owner_user_id", "ordinal", "leading_indicator_text")),
      ev("sp", ch("trajectory_status", "trajectory_approved_by", "trajectory_approved_version")),
      ev("x", null),
      ev("y", []),
      ev("z", "target_value"),
    ];
    expect([...trajectoryAuthors(events, TL)]).toEqual([TL]);
  });

  it("acting on behalf of someone makes both the actor and the represented person authors", () => {
    const authors = trajectoryAuthors([ev("delegate", ch("trajectory_points"), BO)], TL);
    expect(authors.has("delegate")).toBe(true);
    expect(authors.has(BO)).toBe(true);
  });
});

describe("KPI definition activation (F-DG2-201)", () => {
  const draft = {
    status: "draft",
    unitKind: "percentage",
    unitLabel: "%",
    currency: null,
    polarity: "lower_is_better",
  };

  it("a measurable draft can be activated", () => {
    expect(kpiDefinitionActivationRule(draft)).toBeNull();
    expect(kpiDefinitionActivationRule({ ...draft, unitKind: "count", unitLabel: null })).toBeNull();
    expect(
      kpiDefinitionActivationRule({ ...draft, unitKind: "currency", unitLabel: null, currency: "SAR" }),
    ).toBeNull();
    expect(kpiDefinitionActivationRule({ ...draft, unitKind: "other", unitLabel: "calls" })).toBeNull();
  });

  it("already active or not a draft is refused before any field check", () => {
    expect(kpiDefinitionActivationRule({ ...draft, status: "active" })?.code).toBe("kpi_definition.already_active");
    expect(kpiDefinitionActivationRule({ ...draft, status: "archived", unitKind: null })?.code).toBe(
      "kpi_definition.not_draft",
    );
  });

  it.each([
    [{ unitKind: null }, "/unitKind"],
    [{ polarity: null }, "/polarity"],
    [{ unitKind: "currency", currency: null }, "/currency"],
    [{ unitKind: "other", unitLabel: null }, "/unitLabel"],
  ])("a missing measurable field %j is 422 not_measurable at %s", (patch, pointer) => {
    const violation = kpiDefinitionActivationRule({ ...draft, ...patch });
    expect(violation).toMatchObject({ code: "kpi_definition.not_measurable", pointer });
  });
});
