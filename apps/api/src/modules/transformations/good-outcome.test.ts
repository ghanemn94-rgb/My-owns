// Unit test: the good outcome test (B0051, REQ-PB-036) as a pure evaluation over the seeded catalogue (migration 0011).
import { describe, expect, it } from "vitest";
import { activityLead, evaluateGoodOutcome, type GoodOutcomeInputs } from "./good-outcome.ts";

/** The five criteria as seeded in migration 0011 (code, ordinal, evaluation). */
const CATALOGUE = [
  { code: "specific", ordinal: 1, evaluation: "user_attested" },
  { code: "measurable", ordinal: 2, evaluation: "system_kpi_linked" },
  { code: "strategically_relevant", ordinal: 3, evaluation: "user_attested" },
  { code: "owned_by_business_leader", ordinal: 4, evaluation: "system_owner_set" },
  { code: "causal_chain", ordinal: 5, evaluation: "user_attested" },
];
const GOOD: GoodOutcomeInputs = {
  statement: "Raise digital self-service share of postpaid top-ups from 40% to 65%",
  specificConfirmed: true,
  strategicallyRelevantConfirmed: true,
  causalChain: "App journey redesign -> fewer drop-offs -> higher self-service share",
  ownerUserId: "u1",
  ownerActive: true,
  linkedKpis: 1,
};
const resultOf = (i: GoodOutcomeInputs, code: string) =>
  evaluateGoodOutcome(CATALOGUE, i).goodOutcomeTest.find((r) => r.criterionCode === code)?.result;

describe("good outcome test (B0051, REQ-PB-036)", () => {
  it("passes only when every criterion passes; returns all five in catalogue order with a reason", () => {
    const e = evaluateGoodOutcome([...CATALOGUE].reverse(), GOOD);
    expect(e.goodOutcomePass).toBe(true);
    expect(e.goodOutcomeTest.map((r) => [r.criterionCode, r.ordinal, r.result])).toEqual([
      ["specific", 1, "pass"],
      ["measurable", 2, "pass"],
      ["strategically_relevant", 3, "pass"],
      ["owned_by_business_leader", 4, "pass"],
      ["causal_chain", 5, "pass"],
    ]);
    for (const r of e.goodOutcomeTest) expect(r.reason!.length).toBeGreaterThan(0);
  });

  it("acceptance A01: 'Launch new app' with no KPI fails, with reasons", () => {
    const e = evaluateGoodOutcome(CATALOGUE, {
      statement: "Launch new app",
      specificConfirmed: null,
      strategicallyRelevantConfirmed: null,
      causalChain: null,
      ownerUserId: null,
      ownerActive: null,
      linkedKpis: 0,
    });
    expect(e.goodOutcomePass).toBe(false);
    const by = new Map(e.goodOutcomeTest.map((r) => [r.criterionCode, r]));
    expect(by.get("specific")).toMatchObject({ result: "fail" });
    expect(by.get("specific")!.reason).toMatch(/not specific.*"launch"/);
    expect(by.get("measurable")).toEqual({
      criterionCode: "measurable",
      ordinal: 2,
      result: "fail",
      reason: "No KPI linked: the outcome has no active Outcome & KPI Tree row.",
    });
    expect(by.get("owned_by_business_leader")).toMatchObject({ result: "fail" });
    expect(by.get("strategically_relevant")).toMatchObject({ result: "unknown" });
    expect(by.get("causal_chain")).toMatchObject({ result: "unknown" });
  });

  it("the activity wording fails 'specific' even when a user attested it", () => {
    expect(resultOf({ ...GOOD, statement: "Implement the new CRM", specificConfirmed: true }, "specific")).toBe("fail");
  });

  it("unrecorded inputs are unknown (never a silent pass) and make the test not pass", () => {
    for (const patch of [
      { specificConfirmed: null },
      { strategicallyRelevantConfirmed: null },
      { causalChain: null },
      { causalChain: "   " },
    ] satisfies Partial<GoodOutcomeInputs>[]) {
      const e = evaluateGoodOutcome(CATALOGUE, { ...GOOD, ...patch });
      expect(
        e.goodOutcomeTest.some((r) => r.result === "unknown"),
        JSON.stringify(patch),
      ).toBe(true);
      expect(e.goodOutcomePass).toBe(false);
    }
  });

  it("explicit negatives and system checks fail", () => {
    expect(resultOf({ ...GOOD, specificConfirmed: false }, "specific")).toBe("fail");
    expect(resultOf({ ...GOOD, strategicallyRelevantConfirmed: false }, "strategically_relevant")).toBe("fail");
    expect(resultOf({ ...GOOD, linkedKpis: 0 }, "measurable")).toBe("fail");
    expect(resultOf({ ...GOOD, ownerUserId: null, ownerActive: null }, "owned_by_business_leader")).toBe("fail");
    expect(resultOf({ ...GOOD, ownerActive: false }, "owned_by_business_leader")).toBe("fail");
  });

  it("fails closed: an unknown criterion code is unknown; an empty catalogue never passes", () => {
    const e = evaluateGoodOutcome(
      [...CATALOGUE, { code: "time_bound", ordinal: 6, evaluation: "user_attested" }],
      GOOD,
    );
    expect(e.goodOutcomeTest.at(-1)).toMatchObject({ criterionCode: "time_bound", result: "unknown" });
    expect(e.goodOutcomePass).toBe(false);
    expect(evaluateGoodOutcome([], GOOD)).toEqual({ goodOutcomeTest: [], goodOutcomePass: false });
  });

  it("activity wording: the source's verbs and inflections; outcome nouns are not flagged", () => {
    for (const s of [
      "Launch new app",
      "  launching the loyalty programme",
      "To implement SAP",
      "Implementation of e-SIM",
      "Delivered the portal",
      "Deliver: the new billing platform",
      "إطلاق تطبيق جديد",
    ])
      expect(activityLead(s), s).not.toBeNull();
    for (const s of [
      "Delivery time reduced from 5 to 2 days",
      "Launchpad adoption above 60%",
      "Reduce churn to 1.2% monthly",
      "Implementers trained",
    ])
      expect(activityLead(s), s).toBeNull();
  });
});
