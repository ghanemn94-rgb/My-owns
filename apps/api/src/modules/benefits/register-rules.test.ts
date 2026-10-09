// Unit tests of the KBE-D pure rules (T-DG4-KBE-D; ADR-0029 §1, §2, §5, §11): type <-> class (REQ-S08-009), the
// lifecycle moves and step outputs (REQ-PB-074), the realization state (REQ-S08-002), the decimal allocation totals
// (REQ-S08-013), the request schemas (REQ-PB-058 single owner) and the database last-line mappings (S-11). Worked
// fixtures only; no database. All values are synthetic.
import {
  allocationTotals,
  BENEFIT_LIFECYCLE_STEPS,
  BENEFIT_TYPES,
  BENEFIT_VALUE_CLASSES,
  benefitAllocationsReplace,
  benefitCreate,
  benefitUpdate,
  isAllowedLifecycleMove,
  missingFor,
  percentText,
  planOutputsText,
  realizationStateOf,
  shareInRange,
  typeFitsClass,
  type LifecycleFacts,
} from "@mth/shared/schemas";
import { describe, expect, it } from "vitest";
import { mapDatabaseGuardError } from "../platform/index.ts";
import { valueSarOf } from "./register.ts";

describe("type <-> class (ADR-0029 §1, CHECK benefit_type_fits_class; REQ-S08-009)", () => {
  const ALLOWED = new Set([
    "revenue:revenue_uplift",
    "revenue:margin_uplift",
    "cost:cash_saving",
    "cost:avoided_cost",
    "working_capital:working_capital_release",
    "risk:avoided_cost",
    "risk:non_financial",
    "cx:non_financial",
    "strategic:non_financial",
    "other:non_financial",
  ]);
  it("matches the ADR table for all 42 combinations", () => {
    for (const t of BENEFIT_TYPES)
      for (const c of BENEFIT_VALUE_CLASSES) expect(typeFitsClass(t, c), `${t}:${c}`).toBe(ALLOWED.has(`${t}:${c}`));
  });
  it("revenue uplift is not margin, and avoided cost is not a cash saving (no class converts into another)", () => {
    expect(typeFitsClass("cost", "revenue_uplift")).toBe(false);
    expect(typeFitsClass("revenue", "cash_saving")).toBe(false);
    expect(typeFitsClass("cx", "cash_saving")).toBe(false);
  });
});

describe("lifecycle (ADR-0029 §2; REQ-PB-074)", () => {
  const MOVES = new Set([
    "identify>plan",
    "plan>enable",
    "enable>measure",
    "measure>correct",
    "correct>measure",
    "measure>sustain",
  ]);
  it("allows exactly the six one-step moves of the 36 pairs", () => {
    for (const f of BENEFIT_LIFECYCLE_STEPS)
      for (const t of BENEFIT_LIFECYCLE_STEPS)
        expect(isAllowedLifecycleMove(f, t), `${f}>${t}`).toBe(MOVES.has(`${f}>${t}`));
  });

  const empty: LifecycleFacts = {
    valueClass: "revenue_uplift",
    ownerUserId: "00000000-0000-7000-8000-000000000001",
    baselineValue: null,
    baselineId: null,
    benefitFormulaId: null,
    targetValue: null,
    recoveryPlan: null,
    bauOwnerUserId: null,
    controlCadence: null,
    activeEnablers: 0,
  };
  const planned: LifecycleFacts = { ...empty, baselineValue: "100", benefitFormulaId: "f", targetValue: "120" };

  it("Identify and Plan need only the profile; Enable and later need baseline, formula, target and owner", () => {
    expect(missingFor("identify", empty)).toEqual([]);
    expect(missingFor("plan", empty)).toEqual([]);
    expect(missingFor("enable", empty)).toEqual(["baseline", "formula", "target"]);
    expect(planOutputsText(missingFor("enable", empty))).toBe("baseline, formula, target");
    expect(missingFor("enable", planned)).toEqual([]);
    expect(missingFor("enable", { ...planned, baselineValue: null, baselineId: "b" })).toEqual([]);
  });
  it("a non-financial benefit needs no formula (its agreed KPI is the measure)", () => {
    expect(missingFor("enable", { ...planned, valueClass: "non_financial", benefitFormulaId: null })).toEqual([]);
  });
  it("Measure needs an active enabler; Correct a recovery plan; Sustain a BAU owner and a control cadence", () => {
    expect(missingFor("measure", planned)).toEqual(["enablers"]);
    expect(missingFor("measure", { ...planned, activeEnablers: 1 })).toEqual([]);
    expect(missingFor("correct", planned)).toEqual(["recovery_plan"]);
    expect(missingFor("sustain", planned)).toEqual(["bau_owner", "control_cadence"]);
    expect(missingFor("sustain", { ...planned, bauOwnerUserId: "u" })).toEqual(["control_cadence"]);
    expect(missingFor("sustain", { ...planned, bauOwnerUserId: "u", controlCadence: "quarterly" })).toEqual([]);
    expect(planOutputsText(["enablers", "bau_owner"])).toBe("");
  });
});

describe("realization state (ADR-0029 §2, §4; REQ-S08-002)", () => {
  const z = { sustainedCount: 0, validatedCount: 0, liveMeasurements: 0, activeEnablers: 0, deliveredEnablers: 0 };
  it("a delivered enabler is 'enabled - not yet measured', never realized value", () => {
    expect(realizationStateOf(z)).toBe("not_enabled");
    expect(realizationStateOf({ ...z, activeEnablers: 2, deliveredEnablers: 1 })).toBe("not_enabled");
    expect(realizationStateOf({ ...z, activeEnablers: 2, deliveredEnablers: 2 })).toBe("enabled_not_yet_measured");
  });
  it("a measurement is pending until validated; sustained wins over validated", () => {
    expect(realizationStateOf({ ...z, activeEnablers: 1, deliveredEnablers: 1, liveMeasurements: 1 })).toBe(
      "measured_pending_validation",
    );
    expect(realizationStateOf({ ...z, liveMeasurements: 1, validatedCount: 1 })).toBe("validated");
    expect(realizationStateOf({ ...z, validatedCount: 2, sustainedCount: 1 })).toBe("sustained");
  });
});

describe("allocations (ADR-0029 §5; REQ-S08-013), exact decimals", () => {
  it("60 % + 50 % is over 100 % (110 %); 60 % + 30 % leaves 10 % unallocated", () => {
    const over = allocationTotals(["0.6", "0.5"]);
    expect([over.overHundred, percentText(over.allocatedShare)]).toEqual([true, "110"]);
    expect(allocationTotals(["0.6", "0.3"])).toEqual({
      allocatedShare: "0.900000",
      unallocatedShare: "0.100000",
      overHundred: false,
    });
  });
  it("0.1 + 0.2 = 0.300000 (never 0.30000000000000004); thirds total exactly 1; empty leaves 1", () => {
    expect(allocationTotals(["0.1", "0.2"]).allocatedShare).toBe("0.300000");
    expect(allocationTotals(["0.333333", "0.333333", "0.333334"])).toEqual({
      allocatedShare: "1.000000",
      unallocatedShare: "0.000000",
      overHundred: false,
    });
    expect(allocationTotals([])).toEqual({
      allocatedShare: "0.000000",
      unallocatedShare: "1.000000",
      overHundred: false,
    });
    expect(allocationTotals(["0.5", "0.500001"]).overHundred).toBe(true);
  });
  it("percent text is exact; shares are above 0 and at most 1", () => {
    expect(["1.1", "1.000001", "1.5", "2", "1.123456", "0.05"].map(percentText)).toEqual([
      "110",
      "100.0001",
      "150",
      "200",
      "112.3456",
      "5",
    ]);
    expect(["0", "-0.1", "1.000001"].map(shareInRange)).toEqual([false, false, false]);
    expect(["0.000001", "0.5", "1", "1.000000"].map(shareInRange)).toEqual([true, true, true, true]);
  });
});

describe("request schemas (REQ-PB-058 single owner; S-1, S-5)", () => {
  const ok = {
    title: "t",
    description: "d",
    benefitType: "revenue",
    valueClass: "revenue_uplift",
    ownerUserId: "00000000-0000-7000-8000-000000000001",
    currency: "SAR",
  };
  it("one owner: an array, a second owner property or a missing owner fails validation", () => {
    expect(benefitCreate.safeParse(ok).success).toBe(true);
    expect(benefitCreate.safeParse({ ...ok, ownerUserId: [ok.ownerUserId, ok.ownerUserId] }).success).toBe(false);
    expect(benefitCreate.safeParse({ ...ok, coOwnerUserId: ok.ownerUserId }).success).toBe(false);
    const { ownerUserId: _owner, ...noOwner } = ok;
    expect(benefitCreate.safeParse(noOwner).success).toBe(false);
  });
  it("amounts are decimal strings that fit their column; blank text is refused; updates need a property", () => {
    expect(benefitCreate.safeParse({ ...ok, plannedValue: 100 }).success).toBe(false);
    expect(benefitCreate.safeParse({ ...ok, plannedValue: "100.12345" }).success).toBe(false);
    expect(benefitCreate.safeParse({ ...ok, plannedValue: "10000000.5" }).success).toBe(true);
    expect(benefitCreate.safeParse({ ...ok, title: "   " }).success).toBe(false);
    expect(benefitUpdate.safeParse({}).success).toBe(false);
    expect(benefitUpdate.safeParse({ statusRag: null }).success).toBe(true);
  });
  it("allocation shares: at most 6 fraction digits, strings only", () => {
    const id = "00000000-0000-7000-8000-000000000002";
    expect(
      benefitAllocationsReplace.safeParse({ allocations: [{ initiativeId: id, share: "0.123456" }] }).success,
    ).toBe(true);
    expect(
      benefitAllocationsReplace.safeParse({ allocations: [{ initiativeId: id, share: "0.1234567" }] }).success,
    ).toBe(false);
    expect(benefitAllocationsReplace.safeParse({ allocations: [{ initiativeId: id, share: 0.5 }] }).success).toBe(
      false,
    );
  });
});

describe("Value (SAR) of T14 (ADR-0029 §4; REQ-PB-076): n/a and Unknown are never 0", () => {
  const row = (over: Record<string, unknown>) =>
    ({
      currency: "SAR",
      value_class: "revenue_uplift",
      valuation_method_id: null,
      planned_value: null,
      ...over,
    }) as never;
  it("non-financial without a method is n/a; financial without a value is Unknown; a value is money(20,4)", () => {
    expect(valueSarOf(row({ value_class: "non_financial" }))).toEqual({
      status: "not_applicable",
      amount: null,
      currency: null,
      reason: null,
    });
    expect(valueSarOf(row({}))).toEqual({
      status: "unknown",
      amount: null,
      currency: "SAR",
      reason: "benefit.planned_value_missing",
    });
    expect(valueSarOf(row({ planned_value: "10000000" })).amount).toBe("10000000.0000");
  });
});

describe("database last-line mappings (ADR-0029 §11; S-11)", () => {
  const map = (constraint: string, extra: Record<string, string> = {}) =>
    mapDatabaseGuardError({ code: "23514", constraint, ...extra })!;
  it.each([
    ["benefit_mapping_required", 422, "benefit.mapping_required"],
    ["benefit_kpi_required", 422, "benefit.kpi_required"],
    ["benefit_type_fits_class", 422, "benefit.type_class_mismatch"],
    ["benefit_non_financial_unmonetised", 422, "benefit.valuation_method_required"],
    ["benefit_valuation_method_approved", 422, "benefit.valuation_method_not_approved"],
    ["benefit_valuation_only_non_financial", 422, "benefit.valuation_method_not_approved"],
    ["benefit_kpi_variable_bound", 422, "benefit.kpi_variable_unbound"],
    ["benefit_validator_not_owner", 422, "benefit.validator_is_owner"],
    ["benefit_baseline_validator_not_owner", 403, "benefit.baseline_validator_is_owner"],
    ["benefit_lifecycle_step", 422, "benefit.lifecycle_step"],
    ["benefit_plan_outputs_present", 422, "benefit.plan_outputs_missing"],
    ["benefit_enablers_required", 422, "benefit.enablers_missing"],
    ["benefit_correct_output_present", 422, "benefit.recovery_plan_required"],
    ["benefit_sustain_outputs_present", 422, "benefit.sustain_outputs_missing"],
    ["benefit_parent_depth", 422, "benefit.parent_depth"],
    ["benefit_not_own_parent", 422, "benefit.parent_depth"],
    ["benefit_parent_has_values", 422, "benefit.parent_has_values"],
    ["benefit_parent_currency", 422, "benefit.parent_currency"],
    ["benefit_measure_locked", 422, "benefit.measure_locked"],
    ["benefit_case_line_valid", 422, "benefit.case_line_invalid"],
    ["benefit_archived_frozen", 422, "benefit.archived"],
    ["benefit_enabler_deliverable_initiative", 422, "benefit_enabler.deliverable_initiative"],
    ["benefit_enabler_frozen", 422, "benefit_enabler.removed"],
    ["benefit_allocation_initiative_key", 422, "benefit_allocation.duplicate_initiative"],
    ["benefit_allocation_share_check", 422, "benefit_allocation.share_invalid"],
    ["benefit_allocation_current_set", 500, "internal"],
    ["benefit_allocation_set_step", 500, "internal"],
  ])("%s -> %i %s", (constraint, status, code) => {
    const p = map(constraint);
    expect([p.status, p.code]).toEqual([status, code]);
  });
  it("unique violations: case line taken and enabler exists are 409 duplicates; a code race is 409", () => {
    const u = (constraint: string) => mapDatabaseGuardError({ code: "23505", constraint })!;
    expect([u("benefit_one_case_line_key").status, u("benefit_one_case_line_key").code]).toEqual([
      409,
      "benefit.case_line_taken",
    ]);
    expect([u("benefit_enabler_active_key").status, u("benefit_enabler_active_key").code]).toEqual([
      409,
      "benefit_enabler.exists",
    ]);
    expect([u("benefit_code_key").status, u("benefit_code_key").code]).toEqual([409, "version_conflict"]);
    expect(u("benefit_version_step").status).toBe(409);
  });
  it("the group constraint names the side: group update vs benefit leaving", () => {
    expect(map("benefit_group_counted_member", { table: "benefit_group" }).code).toBe(
      "benefit_group.counted_not_member",
    );
    expect(map("benefit_group_counted_member", { table: "benefit" }).code).toBe("benefit_group.counted_member_leaving");
  });
  it("the allocation total is read from the message as an exact percentage", () => {
    const p = map("benefit_allocation_total", {
      message: "benefit_allocation: the allocations of a benefit total 1.100000 (above 100 %)",
    });
    expect([p.code, p.detail]).toEqual([
      "benefit_allocation.over_100",
      "The allocations total 110 %, above 100 %. Reduce them so they total 100 % or less.",
    ]);
    expect(map("benefit_allocation_total").detail).toContain("more than 100 %");
    // Not a slice B constraint: the generic P2 mapping answers.
    expect(map("unrelated_thing_check").code).toBe("validation.constraint");
  });
});
