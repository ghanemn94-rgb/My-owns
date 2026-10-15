// Worked fixtures of the optional NPV / ROI / payback extension (REQ-S08-019; ADR-0047 §5, §9; T-DG5-KBE-F). Every
// value is synthetic. The expected numbers are worked by hand below each fixture, independently of the code under test.
import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  checkCashFlows,
  computeFinancialMetrics,
  isCashFlowAmount,
  isDiscountRate,
  netPresentValue,
  paybackPeriod,
  returnOnInvestment,
  type CashFlowInput,
} from "./metrics.ts";

const row = (periodIndex: number, outflow: string, inflow: string): CashFlowInput => ({ periodIndex, outflow, inflow });

/**
 * ADR-0047 §5 fixture (REQ-S08-019's acceptance): outflow 1000 at t = 0, inflows 300, 400, 500 at t = 1, 2, 3.
 *   beginning_of_period, r = 0.1: -1000 + 300/1.1 + 400/1.21 + 500/1.331
 *     = -1000 + 272.7272727… + 330.5785123… + 375.6574004… = -21.0368144…  -> -21.04
 *   end_of_period: the same divided by 1.1 = -19.1243767…                  -> -19.12
 *   ROI = (1200 - 1000) / 1000 = 0.2                                       -> 0.200000
 *   cumulative net: -1000, -700, -300, +200                                -> payback index 3
 */
const FIXTURE = [row(0, "1000", "0"), row(1, "0", "300"), row(2, "0", "400"), row(3, "0", "500")];

describe("the ADR-0047 §5 fixture (REQ-S08-019 acceptance: 10 % gives the expected NPV to 2 decimals)", () => {
  it("beginning_of_period at 0.100000 gives NPV -21.04 (exact -21.0368144…)", () => {
    const r = netPresentValue(FIXTURE, "0.100000", "beginning_of_period");
    expect(r.value).toBe("-21.04");
    expect(r.reason).toBeNull();
    expect(r.exact!.startsWith("-21.0368144")).toBe(true);
  });

  it("end_of_period at 0.100000 gives NPV -19.12 (exact -19.1243767…)", () => {
    const r = netPresentValue(FIXTURE, "0.100000", "end_of_period");
    expect(r.value).toBe("-19.12");
    expect(r.exact!.startsWith("-19.1243767")).toBe(true);
  });

  it("ROI 0.200000 and payback index 3", () => {
    expect(returnOnInvestment(FIXTURE)).toEqual({ value: "0.200000", reason: null });
    expect(paybackPeriod(FIXTURE)).toEqual({ periodIndex: 3, reason: null });
  });

  it("with no discount rate NPV is not shown (null, discount_rate_missing), never 0; ROI and payback still computed", () => {
    expect(computeFinancialMetrics({ rows: FIXTURE, discountRate: null, timing: "end_of_period" })).toEqual({
      npv: null,
      npvExact: null,
      npvReason: "discount_rate_missing",
      roi: "0.200000",
      roiReason: null,
      paybackPeriodIndex: 3,
      paybackReason: null,
    });
  });

  it("rows in any order give the same metrics (sorted by period index)", () => {
    const shuffled = [FIXTURE[2]!, FIXTURE[0]!, FIXTURE[3]!, FIXTURE[1]!];
    expect(computeFinancialMetrics({ rows: shuffled, discountRate: "0.1", timing: "beginning_of_period" }).npv).toBe(
      "-21.04",
    );
  });
});

describe("worked edge cases", () => {
  it("a zero rate gives the undiscounted net: 1200 - 1000 = 200.00 under either timing", () => {
    expect(netPresentValue(FIXTURE, "0", "beginning_of_period").value).toBe("200.00");
    expect(netPresentValue(FIXTURE, "0.000000", "end_of_period").value).toBe("200.00");
  });

  it("a 100 % rate (the upper bound): -1000 + 300/2 + 400/4 + 500/8 = -687.50; end of period -343.75", () => {
    expect(netPresentValue(FIXTURE, "1", "beginning_of_period").value).toBe("-687.50");
    expect(netPresentValue(FIXTURE, "1.000000", "end_of_period").value).toBe("-343.75");
  });

  it("rounds once, half up (away from zero), and never shows -0.00", () => {
    // Net -0.005 at t = 0, r = 0: exactly half a cent -> -0.01 (ROUND_HALF_UP is away from zero in decimal.js).
    expect(netPresentValue([row(0, "0.005", "0")], "0", "beginning_of_period").value).toBe("-0.01");
    expect(netPresentValue([row(0, "0", "0.005")], "0", "beginning_of_period").value).toBe("0.01");
    // Net -0.0049 rounds to zero: "0.00", not "-0.00".
    expect(netPresentValue([row(0, "0.0049", "0")], "0", "beginning_of_period").value).toBe("0.00");
    // 1/3 of a unit: outflow 3 at t = 0, inflow 1 at t = 0: ROI = (1 - 3) / 3 = -0.6666… -> -0.666667.
    expect(returnOnInvestment([row(0, "3", "1")]).value).toBe("-0.666667");
    // A ROI that rounds to zero is "0.000000".
    expect(returnOnInvestment([row(0, "3000000", "3000000.0001")]).value).toBe("0.000000");
  });

  it("no outflow: ROI and payback are not computable (null with a reason), never 0", () => {
    const rows = [row(0, "0", "100"), row(1, "0", "50")];
    expect(returnOnInvestment(rows)).toEqual({ value: null, reason: "not_computable" });
    expect(paybackPeriod(rows)).toEqual({ periodIndex: null, reason: "not_computable" });
    // NPV is still defined: 100 + 50 / 1.25 = 140.00 (r = 0.25, beginning of period).
    expect(netPresentValue(rows, "0.25", "beginning_of_period").value).toBe("140.00");
  });

  it("payback not reached: cumulative -1000, -900, -800 never turns non-negative", () => {
    const rows = [row(0, "1000", "0"), row(1, "0", "100"), row(2, "0", "100")];
    expect(paybackPeriod(rows)).toEqual({ periodIndex: null, reason: "not_reached" });
    expect(returnOnInvestment(rows).value).toBe("-0.800000");
  });

  it("payback: an outflow that never puts the cumulative net below zero has nothing to pay back (not computable)", () => {
    expect(paybackPeriod([row(0, "100", "500"), row(1, "50", "0")])).toEqual({
      periodIndex: null,
      reason: "not_computable",
    });
  });

  it("payback is the FIRST crossing: -100, +50 (index 1), -10 again, +40", () => {
    const rows = [row(0, "100", "0"), row(1, "0", "150"), row(2, "60", "0"), row(3, "0", "50")];
    expect(paybackPeriod(rows)).toEqual({ periodIndex: 1, reason: null });
  });

  it("payback at exactly zero cumulative net counts (>= 0)", () => {
    expect(paybackPeriod([row(0, "100", "0"), row(1, "0", "100")])).toEqual({ periodIndex: 1, reason: null });
  });

  it("a metric beyond the contract's 18 integer digits is null with a reason, never truncated", () => {
    const rows = Array.from({ length: 121 }, (_, t) => row(t, t === 0 ? "0.0001" : "0", "9999999999999999.9999"));
    const m = computeFinancialMetrics({ rows, discountRate: "0", timing: "beginning_of_period" });
    expect([m.npv, m.npvReason]).toEqual([null, "out_of_range"]);
    expect([m.roi, m.roiReason]).toEqual([null, "not_computable"]);
    // The cumulative net is positive from t = 0: nothing to pay back.
    expect([m.paybackPeriodIndex, m.paybackReason]).toEqual([null, "not_computable"]);
    // The same set at 100 % is representable again (discounting only shrinks it):
    // 9999999999999999.9998 + 9999999999999999.9999 * (1 - 2^-120) = 19999999999999999.9997 - (tiny) -> 20000000000000000.00
    const discounted = netPresentValue(rows, "1", "beginning_of_period");
    expect(discounted.reason).toBeNull();
    expect(discounted.value).toBe("20000000000000000.00");
  });
});

describe("input checks", () => {
  it("amounts: non-negative numeric(20,4), never rounded", () => {
    for (const ok of ["0", "0.0", "1000", "1000.1234", "9999999999999999.9999", "0012.5000", "1.10000"])
      expect(isCashFlowAmount(ok), ok).toBe(true);
    for (const bad of ["-1", "1.12345", "10000000000000000", "", "1e3", " 1", "1.", ".5", 1, null])
      expect(isCashFlowAmount(bad), String(bad)).toBe(false);
  });

  it("discount rate: a decimal fraction in [0, 1], numeric(9,6)", () => {
    for (const ok of ["0", "0.1", "0.100000", "1", "1.000000", "0.000001"]) expect(isDiscountRate(ok), ok).toBe(true);
    for (const bad of ["-0.1", "1.000001", "0.1234567", "10", "", "0.1%", 0.1, null])
      expect(isDiscountRate(bad), String(bad)).toBe(false);
    expect(() => netPresentValue(FIXTURE, "1.5", "end_of_period")).toThrow(RangeError);
  });

  it("periods: 1..121 rows, indexes 0..n-1 with no gap or duplicate", () => {
    expect(checkCashFlows([]).ok).toBe(false);
    expect(checkCashFlows([row(1, "1", "0")])).toEqual({ ok: false, reason: "periods_invalid", index: 0 });
    expect(checkCashFlows([row(0, "1", "0"), row(2, "0", "1")]).ok).toBe(false);
    expect(checkCashFlows([row(0, "1", "0"), row(0, "0", "1")]).ok).toBe(false);
    expect(checkCashFlows([row(0, "1", "0"), row(1.5, "0", "1")]).ok).toBe(false);
    expect(checkCashFlows([row(0, "-1", "0")])).toEqual({ ok: false, reason: "amount_invalid", index: 0 });
    expect(checkCashFlows(Array.from({ length: 121 }, (_, t) => row(t, "1", "1"))).ok).toBe(true);
    expect(checkCashFlows(Array.from({ length: 122 }, (_, t) => row(t, "1", "1"))).ok).toBe(false);
    expect(() => computeFinancialMetrics({ rows: [], discountRate: null, timing: "end_of_period" })).toThrow(
      RangeError,
    );
  });
});

// ------------------------------------------------------------------------------------------------ properties
// No property-testing package is installed (no new dependency, D-142 Q8): a seeded mulberry32 PRNG (the formula
// fuzz.test.ts and forms property.test.ts precedent), so every failure names its seed and case and reproduces.

const CASES = 1500;
const SEED = 0x0f1a2c;

function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const digits = (n: number) => Array.from({ length: n }, () => String(int(0, 9))).join("");
  /** A non-negative numeric(20,4) amount, often 0. */
  const amount = (): string => {
    if (int(0, 3) === 0) return "0";
    const i = digits(int(1, int(0, 5) === 0 ? 16 : 7)).replace(/^0+(?=[0-9])/, "");
    const f = int(0, 4);
    return f > 0 ? `${i}.${digits(f)}` : i;
  };
  /** A numeric(9,6) rate in [0, 1]. */
  const rate = (): string => (int(0, 9) === 0 ? "1" : `0.${digits(6)}`);
  const set = (): CashFlowInput[] =>
    Array.from({ length: int(1, int(0, 4) === 0 ? 121 : 12) }, (_, t) => row(t, amount(), amount()));
  return { int, amount, rate, set };
}

/** An independent oracle: the same definitions at precision 200 (a different clone; no shared rounding). */
const ORACLE = Decimal.clone({ precision: 200, rounding: Decimal.ROUND_HALF_UP });
const near = (x: InstanceType<typeof ORACLE>, scale: number) => {
  // Distance from the oracle value to the nearest rounding tie at `scale` decimals.
  const shifted = x.abs().times(new ORACLE(10).pow(scale));
  const frac = shifted.minus(shifted.floor());
  return frac.minus("0.5").abs().lt("1e-25");
};

describe("properties (seeded)", () => {
  it("NPV equals the precision-200 oracle rounded once half-up to 2 decimals (both timings)", () => {
    const g = rng(SEED);
    for (let c = 0; c < CASES; c += 1) {
      const rows = g.set();
      const r = g.rate();
      const timing = g.int(0, 1) === 0 ? "end_of_period" : "beginning_of_period";
      const factor = new ORACLE(1).plus(r);
      let exact = new ORACLE(0);
      for (const x of rows)
        exact = exact.plus(
          new ORACLE(x.inflow).minus(x.outflow).div(factor.pow(x.periodIndex + (timing === "end_of_period" ? 1 : 0))),
        );
      const got = netPresentValue(rows, r, timing);
      if (near(exact, 2)) continue; // within 1e-25 of a tie: precision 40 may legitimately differ
      const want = exact.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      expect(got.value, `seed ${SEED} case ${c} rate ${r} ${timing}`).toBe(want.isZero() ? "0.00" : want.toFixed(2));
    }
  }, 60_000);

  it("end_of_period NPV = beginning_of_period NPV / (1 + r), before rounding", () => {
    const g = rng(SEED + 1);
    for (let c = 0; c < CASES; c += 1) {
      const rows = g.set();
      const r = g.rate();
      const begin = new ORACLE(netPresentValue(rows, r, "beginning_of_period").exact!);
      const end = new ORACLE(netPresentValue(rows, r, "end_of_period").exact!);
      const diff = begin.div(new ORACLE(1).plus(r)).minus(end).abs();
      expect(diff.lte(begin.abs().plus(1).times("1e-35")), `seed ${SEED + 1} case ${c}`).toBe(true);
    }
  }, 60_000);

  it("a conventional set (outflows only at t = 0, beginning of period) has an NPV that never rises with the rate", () => {
    const g = rng(SEED + 2);
    for (let c = 0; c < CASES; c += 1) {
      const rows = g.set().map((x, t) => (t === 0 ? x : { ...x, outflow: "0" }));
      const [a, b] = [g.rate(), g.rate()].sort((x, y) => new ORACLE(x).cmp(y));
      // t = 0 is undiscounted at the beginning of the period; every later net is >= 0, so each term falls with r.
      const low = new ORACLE(netPresentValue(rows, a!, "beginning_of_period").value!);
      const high = new ORACLE(netPresentValue(rows, b!, "beginning_of_period").value!);
      expect(high.lte(low), `seed ${SEED + 2} case ${c} ${a} <= ${b}`).toBe(true);
    }
  }, 60_000);

  it("ROI equals the precision-200 oracle rounded half-up to 6 decimals; payback equals an integer (BigInt) oracle", () => {
    const g = rng(SEED + 3);
    const scaled = (v: string) => {
      const [i, f = ""] = v.split(".");
      return BigInt(i! + f.padEnd(4, "0"));
    };
    for (let c = 0; c < CASES; c += 1) {
      const rows = g.set();
      const inSum = rows.reduce((s, x) => s.plus(x.inflow), new ORACLE(0));
      const outSum = rows.reduce((s, x) => s.plus(x.outflow), new ORACLE(0));
      const roi = returnOnInvestment(rows);
      if (outSum.isZero()) expect(roi).toEqual({ value: null, reason: "not_computable" });
      else {
        const exact = inSum.minus(outSum).div(outSum);
        if (!near(exact, 6) && exact.abs().lt("1e18")) {
          const want = exact.toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
          expect(roi.value, `seed ${SEED + 3} case ${c}`).toBe(want.isZero() ? "0.000000" : want.toFixed(6));
        }
      }
      // Payback oracle in exact integers of 1/10000.
      let cum = 0n;
      let under = false;
      let want: number | null = null;
      for (const x of rows) {
        cum += scaled(x.inflow) - scaled(x.outflow);
        if (cum < 0n) under = true;
        else if (under) {
          want = x.periodIndex;
          break;
        }
      }
      const got = paybackPeriod(rows);
      expect(got.periodIndex, `seed ${SEED + 3} case ${c}`).toBe(want);
      if (want === null) expect(got.reason).toBe(outSum.isZero() || !under ? "not_computable" : "not_reached");
    }
  }, 60_000);
});
