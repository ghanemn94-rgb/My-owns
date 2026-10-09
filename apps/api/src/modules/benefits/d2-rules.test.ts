// Unit tests of the KBE-D2 pure rules (T-DG4-KBE-D2; ADR-0029 §7, §8, §10, §11): the overlap rule and its window
// arithmetic (REQ-S08-014), the pair order, the valuation-method transitions (REQ-S08-010), the request schemas
// (strict bodies, decimal strings, never JSON numbers) and the database last-line mappings with their exact codes and
// English texts (S-11). Worked fixtures only; no database. All values are synthetic.
import {
  benefitOverlapCreate,
  benefitOverlapResolve,
  benefitScenarioCreate,
  benefitScenarioUpdate,
  benefitScenarioValueCreate,
  benefitScenarioValueUpdate,
  benefitValuationMethodCreate,
  benefitValuationMethodDecision,
  canonicalDimensions,
  orderedPair,
  overlapOf,
  periodInOrder,
  valuationDecisionAllowed,
  VALUATION_METHOD_DECISIONS,
  VALUATION_METHOD_STATUSES,
  windowIntersection,
  type OverlapKeys,
} from "@mth/shared/schemas";
import { describe, expect, it } from "vitest";
import { mapDatabaseGuardError } from "../platform/index.ts";
import { dimensionsOf } from "./overlaps.ts";

const keys = (o: Partial<OverlapKeys>): OverlapKeys => ({
  driverKey: null,
  populationKey: null,
  realizationStart: null,
  realizationEnd: null,
  ...o,
});

describe("the overlap rule (ADR-0029 §7; REQ-S08-014)", () => {
  const a = keys({ driverKey: "prepaid.churn", realizationStart: "2026-01-01", realizationEnd: "2026-12-31" });

  it("same driver and overlapping period -> {driver, period} with the intersection window", () => {
    const b = keys({ driverKey: "prepaid.churn", realizationStart: "2026-07-01", realizationEnd: "2027-06-30" });
    expect(overlapOf(a, b)).toEqual({ dimensions: ["driver", "period"], start: "2026-07-01", end: "2026-12-31" });
    expect(overlapOf(b, a)).toEqual(overlapOf(a, b));
  });

  it("the same population key adds `population`; a different or missing one does not", () => {
    const pa = { ...a, populationKey: "segment.youth" };
    expect(overlapOf(pa, { ...a, populationKey: "segment.youth" })?.dimensions).toEqual([
      "driver",
      "population",
      "period",
    ]);
    expect(overlapOf(pa, { ...a, populationKey: "segment.family" })?.dimensions).toEqual(["driver", "period"]);
    expect(overlapOf(pa, a)?.dimensions).toEqual(["driver", "period"]);
    // Both population keys missing: no population dimension (null never equals null here).
    expect(overlapOf(a, a)?.dimensions).toEqual(["driver", "period"]);
  });

  it("different or missing driver keys never overlap by rule (population alone is not the rule)", () => {
    expect(overlapOf(a, { ...a, driverKey: "postpaid.churn" })).toBeNull();
    expect(overlapOf(a, { ...a, driverKey: null })).toBeNull();
    expect(overlapOf({ ...a, driverKey: null }, { ...a, driverKey: null })).toBeNull();
    expect(
      overlapOf({ ...a, populationKey: "segment.youth" }, { ...a, driverKey: "x", populationKey: "segment.youth" }),
    ).toBeNull();
  });

  it("disjoint windows do not overlap; touching windows (same day) do", () => {
    expect(overlapOf(a, { ...a, realizationStart: "2027-01-01", realizationEnd: "2027-12-31" })).toBeNull();
    expect(overlapOf(a, { ...a, realizationStart: "2025-01-01", realizationEnd: "2025-12-31" })).toBeNull();
    expect(overlapOf(a, { ...a, realizationStart: "2026-12-31", realizationEnd: "2027-03-31" })).toEqual({
      dimensions: ["driver", "period"],
      start: "2026-12-31",
      end: "2026-12-31",
    });
  });

  it("a missing window bound is open-ended: a missing window overlaps every window", () => {
    const open = keys({ driverKey: "prepaid.churn" });
    expect(overlapOf(a, open)).toEqual({ dimensions: ["driver", "period"], start: "2026-01-01", end: "2026-12-31" });
    expect(overlapOf(open, open)).toEqual({ dimensions: ["driver", "period"], start: null, end: null });
    const fromOnly = keys({ driverKey: "prepaid.churn", realizationStart: "2026-06-01" });
    expect(overlapOf(a, fromOnly)).toEqual({
      dimensions: ["driver", "period"],
      start: "2026-06-01",
      end: "2026-12-31",
    });
    const untilOnly = keys({ driverKey: "prepaid.churn", realizationEnd: "2025-12-31" });
    expect(overlapOf(a, untilOnly)).toBeNull();
  });

  it("windowIntersection is the later start and the earlier end", () => {
    expect(
      windowIntersection(
        { realizationStart: "2026-03-01", realizationEnd: "2026-09-30" },
        { realizationStart: "2026-01-01", realizationEnd: "2026-06-30" },
      ),
    ).toEqual({ start: "2026-03-01", end: "2026-06-30" });
  });

  it("pairs are stored in id order (CHECK benefit_overlap_pair_order); dimensions in canonical order", () => {
    const lo = "01920000-0000-7000-8000-00000000000a";
    const hi = "01920000-0000-7000-8000-00000000000b";
    expect(orderedPair(hi, lo)).toEqual([lo, hi]);
    expect(orderedPair(lo, hi)).toEqual([lo, hi]);
    expect(orderedPair(hi.toUpperCase(), lo)).toEqual([lo, hi]);
    expect(canonicalDimensions(["period", "driver", "period"])).toEqual(["driver", "period"]);
    expect(dimensionsOf(["period", "population"])).toEqual(["population", "period"]);
    expect(dimensionsOf("{period,driver}")).toEqual(["driver", "period"]);
  });
});

describe("valuation-method decisions (ADR-0029 §8; REQ-S08-010)", () => {
  it("approve/reject only a proposed method; retire only an approved one (all 12 combinations)", () => {
    const allowed = new Set(["proposed:approved", "proposed:rejected", "approved:retired"]);
    for (const st of VALUATION_METHOD_STATUSES)
      for (const d of VALUATION_METHOD_DECISIONS)
        expect(valuationDecisionAllowed(st, d), `${st} -> ${d}`).toBe(allowed.has(`${st}:${d}`));
  });

  it("create body: decimal string unit value >= 0, never a JSON number; strict", () => {
    const ok = { name: "NPS point value", method: "SAR per NPS point", appliesToType: "cx", currency: "SAR" };
    expect(benefitValuationMethodCreate.safeParse({ ...ok, unitValue: "1250.5000" }).success).toBe(true);
    expect(benefitValuationMethodCreate.safeParse({ ...ok, unitValue: 1250.5 }).success).toBe(false);
    expect(benefitValuationMethodCreate.safeParse({ ...ok, unitValue: "-1" }).success).toBe(false);
    expect(benefitValuationMethodCreate.safeParse({ ...ok, unitValue: "1.12345" }).success).toBe(false);
    expect(benefitValuationMethodCreate.safeParse({ ...ok, appliesToType: "revenue" }).success).toBe(false);
    expect(benefitValuationMethodCreate.safeParse({ ...ok, status: "approved" }).success).toBe(false);
    expect(benefitValuationMethodDecision.safeParse({ decision: "approved" }).success).toBe(true);
    expect(benefitValuationMethodDecision.safeParse({ decision: "proposed" }).success).toBe(false);
  });
});

describe("scenario and overlap request schemas (REQ-S08-018, REQ-S08-014)", () => {
  it("scenario: kind is base | upside | downside; update needs one property; archive reason 3+ characters", () => {
    expect(benefitScenarioCreate.safeParse({ kind: "upside", title: "Synthetic upside" }).success).toBe(true);
    expect(benefitScenarioCreate.safeParse({ kind: "actual", title: "x" }).success).toBe(false);
    expect(benefitScenarioUpdate.safeParse({}).success).toBe(false);
    expect(benefitScenarioUpdate.safeParse({ archiveReason: "no" }).success).toBe(false);
    expect(benefitScenarioUpdate.safeParse({ archiveReason: "Superseded by the new case" }).success).toBe(true);
  });

  it("scenario value: amounts are decimal strings fitting numeric(20,4); no currency field (copied from the benefit)", () => {
    const v = { benefitId: "01920000-0000-7000-8000-00000000000a", periodStart: "2026-01-01", periodEnd: "2026-12-31" };
    expect(benefitScenarioValueCreate.safeParse({ ...v, amount: "7777777.0000" }).success).toBe(true);
    expect(benefitScenarioValueCreate.safeParse({ ...v, amount: 7777777 }).success).toBe(false);
    expect(benefitScenarioValueCreate.safeParse({ ...v, amount: "1.00001" }).success).toBe(false);
    expect(benefitScenarioValueCreate.safeParse({ ...v, amount: "1", currency: "USD" }).success).toBe(false);
    expect(benefitScenarioValueCreate.safeParse({ ...v, periodStart: "2026-02-30" }).success).toBe(false);
    expect(benefitScenarioValueUpdate.safeParse({}).success).toBe(false);
    expect(periodInOrder("2026-01-01", "2026-01-01")).toBe(true);
    expect(periodInOrder("2026-02-01", "2026-01-31")).toBe(false);
  });

  it("overlap create: two ids and 1-3 unique dimensions; resolve: the note, if present, has visible text", () => {
    const ids = {
      benefitAId: "01920000-0000-7000-8000-00000000000a",
      benefitBId: "01920000-0000-7000-8000-00000000000b",
    };
    expect(benefitOverlapCreate.safeParse({ ...ids, dimensions: ["driver", "period"] }).success).toBe(true);
    expect(benefitOverlapCreate.safeParse({ ...ids, dimensions: [] }).success).toBe(false);
    expect(benefitOverlapCreate.safeParse({ ...ids, dimensions: ["driver", "driver"] }).success).toBe(false);
    expect(benefitOverlapCreate.safeParse({ ...ids, dimensions: ["customer"] }).success).toBe(false);
    expect(benefitOverlapResolve.safeParse({ resolution: "duplicate", note: "   " }).success).toBe(false);
    expect(benefitOverlapResolve.safeParse({ resolution: "merged", note: "Synthetic" }).success).toBe(false);
    // A missing note or excluded benefit is the service's exact 422 (benefit_overlap.note_required / excluded_required).
    expect(benefitOverlapResolve.safeParse({ resolution: "duplicate" }).success).toBe(true);
  });
});

describe("database last-line mappings of KBE-D2 (ADR-0029 §11; S-11)", () => {
  const map = (constraint: string, extra: Record<string, string> = {}) => {
    const p = mapDatabaseGuardError({ code: "23514", constraint, ...extra });
    return p === null ? null : [p.status, p.code, p.detail];
  };
  it("valuation methods", () => {
    expect(map("benefit_valuation_method_decider_not_proposer")).toEqual([
      403,
      "benefit_valuation_method.decider_is_proposer",
      "The person who proposed this valuation method cannot decide it.",
    ]);
    for (const c of ["benefit_valuation_method_status_step", "benefit_valuation_method_frozen"])
      expect(map(c)).toEqual([
        422,
        "benefit_valuation_method.not_proposed",
        "Only a proposed valuation method can be decided.",
      ]);
    expect(map("benefit_valuation_method_decision_complete")).toEqual([
      422,
      "benefit_valuation_method.note_required",
      "A rejection needs a note.",
    ]);
    expect(map("benefit_valuation_method_code_key")?.[0]).toBe(409);
  });
  it("scenarios and scenario values", () => {
    expect(
      map("benefit_scenario_one_kind_key", {
        code: "23505",
        detail: "Key (transformation_id, kind)=(01920000-0000-7000-8000-00000000000a, upside) already exists.",
      }),
    ).toEqual([409, "benefit_scenario.kind_exists", "This transformation already has an active upside scenario."]);
    expect(map("benefit_scenario_value_unmonetised")).toEqual([
      422,
      "benefit_value.unmonetised",
      "A non-financial benefit has no SAR value without an approved valuation method. Record its KPI value instead.",
    ]);
    expect(map("benefit_scenario_value_currency")?.slice(0, 2)).toEqual([422, "benefit_value.currency_mismatch"]);
    expect(map("benefit_scenario_value_leaf_only")?.slice(0, 2)).toEqual([422, "benefit_value.parent_rollup"]);
    expect(map("benefit_scenario_value_period_key", { code: "23505" })?.slice(0, 2)).toEqual([
      409,
      "benefit_value.period_taken",
    ]);
    expect(map("benefit_scenario_value_benefit_active")?.slice(0, 2)).toEqual([422, "benefit.archived"]);
    expect(map("benefit_scenario_value_frozen")?.[0]).toBe(500);
  });
  it("overlap warnings", () => {
    expect(map("benefit_overlap_one_open_key", { code: "23505" })).toEqual([
      409,
      "benefit_overlap.already_open",
      "An open overlap warning already exists for these two benefits.",
    ]);
    expect(map("benefit_overlap_status_step")).toEqual([
      422,
      "benefit_overlap.not_open",
      "Only an open overlap warning can be resolved.",
    ]);
    expect(map("benefit_overlap_resolution_complete")).toEqual([
      422,
      "benefit_overlap.excluded_required",
      "A duplicate resolution names which of the two benefits is not counted.",
    ]);
    expect(map("benefit_overlap_resolver_not_owner")).toEqual([
      403,
      "benefit_overlap.resolver_is_owner",
      "You own one of the overlapping benefits, so you cannot resolve this overlap.",
    ]);
    expect(map("benefit_overlap_pair_order")?.[0]).toBe(500);
    expect(map("benefit_overlap_version_step")?.[0]).toBe(409);
  });
});
