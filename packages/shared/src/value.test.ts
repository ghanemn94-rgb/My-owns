// value.ts unit tests (ADR-0019 "Required unit tests"; kpi-benefits-engineer). Worked fixtures plus seeded property
// tests whose oracle is exact BigInt arithmetic on scaled integers (never a float).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  canonicalDecimal,
  checkDecimal,
  compareDecimal,
  DecimalError,
  fitsColumn,
  formatDecimal,
  isDecimalString,
  isPartialTotal,
  MEASURE_COLUMN,
  MONEY_COLUMN,
  parseDecimal,
  sumDecimals,
  toColumnString,
  totalValuePools,
  totalValuePoolsIn,
  validationState,
  type ValuePoolForTotal,
} from "./value.ts";

// ------------------------------------------------------------------------------------------------ oracle helpers

/** Deterministic PRNG (mulberry32) so property failures reproduce. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random money-column decimal string: up to 16 integer digits and up to 4 fraction digits, maybe negative. */
function randomMoney(r: () => number): string {
  const intLen = 1 + Math.floor(r() * 16);
  let int = String(1 + Math.floor(r() * 9));
  for (let i = 1; i < intLen; i++) int += String(Math.floor(r() * 10));
  if (r() < 0.2) int = "0";
  const fracLen = Math.floor(r() * 5);
  let frac = "";
  for (let i = 0; i < fracLen; i++) frac += String(Math.floor(r() * 10));
  const sign = r() < 0.25 ? "-" : "";
  return `${sign}${int}${frac ? `.${frac}` : ""}`;
}

/** Exact scaled integer (value * 10^scale) as BigInt. */
function scaled(value: string, scale: number): bigint {
  const neg = value.startsWith("-");
  const [i, f = ""] = (neg ? value.slice(1) : value).split(".");
  const n = BigInt(`${i}${f.padEnd(scale, "0")}`);
  return neg ? -n : n;
}

/** BigInt scaled integer -> fixed-scale decimal string. */
function unscaled(n: bigint, scale: number): string {
  const neg = n < 0n;
  const s = (neg ? -n : n).toString().padStart(scale + 1, "0");
  const out = `${s.slice(0, s.length - scale)}.${s.slice(s.length - scale)}`;
  return neg && n !== 0n ? `-${out}` : out;
}

// ------------------------------------------------------------------------------------------------ parsing

describe("checkDecimal / parseDecimal: transport strings only, column fit without rounding", () => {
  it("round-trips 12345678901234.5678 (money) without loss (ADR-0019 required test)", () => {
    const v = "12345678901234.5678";
    expect(checkDecimal(v, MONEY_COLUMN)).toEqual({ ok: true });
    expect(parseDecimal(v, MONEY_COLUMN).toFixed(4)).toBe(v);
    expect(toColumnString(v, MONEY_COLUMN)).toBe(v);
    expect(canonicalDecimal(v)).toBe(v);
  });

  it("refuses JSON numbers and malformed strings", () => {
    expect(checkDecimal(0.1)).toEqual({ ok: false, reason: "not_a_string" });
    expect(checkDecimal(100)).toEqual({ ok: false, reason: "not_a_string" });
    expect(checkDecimal(null)).toEqual({ ok: false, reason: "not_a_string" });
    for (const bad of ["", "1e5", ".5", "1.", "+1", "1,000", " 1", "NaN", "Infinity", "0x10", "1.1234567"]) {
      expect(checkDecimal(bad), bad).toEqual({ ok: false, reason: "format" });
    }
    expect(isDecimalString("-0.5")).toBe(true);
    expect(() => parseDecimal("1e5")).toThrow(DecimalError);
  });

  it("money numeric(20,4): at most 16 integer and 4 fraction digits", () => {
    expect(fitsColumn("9999999999999999.9999", MONEY_COLUMN)).toBe(true);
    expect(checkDecimal("99999999999999999", MONEY_COLUMN)).toEqual({ ok: false, reason: "integer_digits" });
    expect(checkDecimal("1.12345", MONEY_COLUMN)).toEqual({ ok: false, reason: "fraction_digits" });
    // Leading integer zeros and trailing fraction zeros are not significant: exact, so no rounding happens.
    expect(fitsColumn("0000000000000000001.5", MONEY_COLUMN)).toBe(false); // > 18 digits: transport pattern
    expect(fitsColumn("000001.50000", MONEY_COLUMN)).toBe(true);
    expect(fitsColumn("0", MONEY_COLUMN)).toBe(true);
    expect(fitsColumn("-0.0001", MONEY_COLUMN)).toBe(true);
  });

  it("measure numeric(24,6): at most 18 integer and 6 fraction digits", () => {
    expect(fitsColumn("-123456789012345678.123456", MEASURE_COLUMN)).toBe(true);
    expect(fitsColumn("123456789012345678.123456", MONEY_COLUMN)).toBe(false);
    expect(checkDecimal("0.1234567", MEASURE_COLUMN)).toEqual({ ok: false, reason: "format" });
  });

  it("toColumnString pads to the column scale and refuses to round", () => {
    expect(toColumnString("100", MONEY_COLUMN)).toBe("100.0000");
    expect(toColumnString("100.000000", MONEY_COLUMN)).toBe("100.0000");
    expect(toColumnString("-0.5", MEASURE_COLUMN)).toBe("-0.500000");
    expect(() => toColumnString("1.23456", MONEY_COLUMN)).toThrow(/fraction_digits/);
    expect(() => toColumnString("12345678901234567", MONEY_COLUMN)).toThrow(/integer_digits/);
  });

  it("canonical form and exact comparison", () => {
    expect(canonicalDecimal("100.5000")).toBe("100.5");
    expect(canonicalDecimal("-0.0000")).toBe("0");
    expect(canonicalDecimal("0.000100")).toBe("0.0001");
    expect(compareDecimal("0.1", "0.10")).toBe(0);
    expect(compareDecimal("-1", "0")).toBe(-1);
    expect(compareDecimal("9999999999999999.9999", "9999999999999999.9998")).toBe(1);
  });
});

// ------------------------------------------------------------------------------------------------ arithmetic

describe("sumDecimals: exact, never a float", () => {
  it("0.1 + 0.2 is exactly 0.3 (a float gives 0.30000000000000004)", () => {
    expect(sumDecimals(["0.1", "0.2"])).toBe("0.3");
    expect(0.1 + 0.2).not.toBe(0.3); // the defect the helpers exist to avoid
  });

  it("the empty sum is 0 (the caller decides Unknown; see totalValuePools)", () => {
    expect(sumDecimals([])).toBe("0");
  });

  it("property: equals the exact BigInt sum for 500 random sets of money values", () => {
    const r = rng(20261002);
    for (let run = 0; run < 500; run++) {
      const values = Array.from({ length: 1 + Math.floor(r() * 30) }, () => randomMoney(r));
      const oracle = unscaled(
        values.reduce((acc, v) => acc + scaled(v, 4), 0n),
        4,
      );
      expect(compareDecimal(sumDecimals(values), oracle), values.join(" + ")).toBe(0);
    }
  });
});

// ------------------------------------------------------------------------------------------------ display

describe("formatDecimal: locale display without a float; Unknown is null, never 0", () => {
  it("null, undefined and invalid input yield null", () => {
    expect(formatDecimal(null, { locale: "en" })).toBeNull();
    expect(formatDecimal(undefined, { locale: "ar" })).toBeNull();
    expect(formatDecimal("abc", { locale: "en" })).toBeNull();
  });

  it("formats a 14-integer-digit amount exactly (no float rounding)", () => {
    expect(formatDecimal("12345678901234.5678", { locale: "en", maxFractionDigits: 4 })).toBe(
      "12,345,678,901,234.5678",
    );
  });

  it("shows the currency code and rounds only for display (half-up)", () => {
    expect(formatDecimal("1250000", { locale: "en", currency: "SAR", minFractionDigits: 2 })).toBe("SAR 1,250,000.00");
    expect(formatDecimal("2.345", { locale: "en", maxFractionDigits: 2 })).toBe("2.35");
    expect(formatDecimal("0", { locale: "en", currency: "SAR" })).toBe("SAR 0");
  });

  it("Arabic uses Latin digits by default (as the web formatter) and Arabic-Indic digits on request", () => {
    const latn = formatDecimal("1250000.5", { locale: "ar", currency: "SAR", minFractionDigits: 2 })!;
    expect(latn).toMatch(/1.250.000.50 SAR$/u);
    const arab = formatDecimal("1250000.5", { locale: "ar", digits: "arab", minFractionDigits: 2 })!;
    expect(arab).toMatch(/[٠-٩]/u);
    expect(arab).not.toMatch(/[0-9]/);
  });
});

// ------------------------------------------------------------------------------------------------ validation state

describe("validationState: a decision on an older version is stale", () => {
  it.each([
    [{ validationStatus: "unvalidated", validatedRecordVersion: null, version: 1 }, "unvalidated"],
    [{ validationStatus: "validated", validatedRecordVersion: 3, version: 3 }, "validated"],
    [{ validationStatus: "validated", validatedRecordVersion: 3, version: 4 }, "stale"],
    [{ validationStatus: "rejected", validatedRecordVersion: 2, version: 2 }, "rejected"],
    [{ validationStatus: "rejected", validatedRecordVersion: 2, version: 5 }, "stale"],
    [{ validationStatus: "validated", validatedRecordVersion: null, version: 2 }, "unvalidated"],
  ] as const)("%j -> %s", (input, expected) => {
    expect(validationState(input)).toBe(expected);
  });
});

// ------------------------------------------------------------------------------------------------ totals

const q = (down: string, up: string, extra: Partial<ValuePoolForTotal> = {}): ValuePoolForTotal => ({
  quantificationStatus: "quantified",
  downsideAmount: down,
  upsideAmount: up,
  currency: "SAR",
  ...extra,
});
const u = (extra: Partial<ValuePoolForTotal> = {}): ValuePoolForTotal => ({
  quantificationStatus: "unquantified",
  downsideAmount: null,
  upsideAmount: null,
  currency: "SAR",
  ...extra,
});

describe("totalValuePools (ADR-0019 §5)", () => {
  it("{quantified 100-200, unquantified} -> {100, 200}, unquantifiedCount 1, labelled partial (required test)", () => {
    const [t] = totalValuePools([q("100", "200"), u()]);
    expect(t).toEqual({
      currency: "SAR",
      quantifiedTotal: { downside: "100.0000", upside: "200.0000" },
      unquantifiedCount: 1,
      quantifiedCount: 1,
      basis: "all",
      notValidatedCount: 0,
    });
    expect(isPartialTotal(t!)).toBe(true);
  });

  it("an empty set is Unknown (null), not 0 (required test)", () => {
    expect(totalValuePools([])).toEqual([]);
    const t = totalValuePoolsIn([], "SAR");
    expect(t.quantifiedTotal).toBeNull();
    expect(t.unquantifiedCount).toBe(0);
    expect(isPartialTotal(t)).toBe(false);
  });

  it("only unquantified pools: the total stays null and every pool is counted; unquantified never becomes 0", () => {
    const [t] = totalValuePools([u(), u(), u()]);
    expect(t!.quantifiedTotal).toBeNull();
    expect(t!.unquantifiedCount).toBe(3);
    expect(JSON.stringify(t)).not.toMatch(/"0(\.0+)?"/);
  });

  it("zero is a legal quantified assessment and is not Unknown", () => {
    const [t] = totalValuePools([q("0", "0")]);
    expect(t!.quantifiedTotal).toEqual({ downside: "0.0000", upside: "0.0000" });
    expect(isPartialTotal(t!)).toBe(false);
  });

  it("splits mixed currencies and never converts between them", () => {
    const totals = totalValuePools([
      q("10", "20"),
      q("1.5", "2.25", { currency: "USD" }),
      u({ currency: "USD" }),
      q("0.0001", "0.0002"),
    ]);
    expect(totals).toEqual([
      {
        currency: "SAR",
        quantifiedTotal: { downside: "10.0001", upside: "20.0002" },
        unquantifiedCount: 0,
        quantifiedCount: 2,
        basis: "all",
        notValidatedCount: 0,
      },
      {
        currency: "USD",
        quantifiedTotal: { downside: "1.5000", upside: "2.2500" },
        unquantifiedCount: 1,
        quantifiedCount: 1,
        basis: "all",
        notValidatedCount: 0,
      },
    ]);
    expect(totalValuePoolsIn(totals.length > 0 ? [q("1", "2")] : [], "EUR").quantifiedTotal).toBeNull();
  });

  it("excludes archived pools", () => {
    const [t] = totalValuePools([q("1", "2"), q("100", "200", { status: "archived" }), u({ status: "archived" })]);
    expect(t!.quantifiedTotal).toEqual({ downside: "1.0000", upside: "2.0000" });
    expect(t!.unquantifiedCount).toBe(0);
  });

  it("a malformed quantified row without amounts is counted as Unknown, never summed as 0", () => {
    const [t] = totalValuePools([{ ...q("1", "2"), upsideAmount: null }]);
    expect(t!.quantifiedTotal).toBeNull();
    expect(t!.unquantifiedCount).toBe(1);
  });

  it("basis 'validated': only the CURRENT version Finance validated counts; submissions and stale ones do not", () => {
    const pools = [
      q("100", "200", { validationStatus: "validated", validatedRecordVersion: 2, version: 2 }),
      q("1000", "2000", { validationStatus: "validated", validatedRecordVersion: 2, version: 3 }), // stale
      q("5", "6", { validationStatus: "rejected", validatedRecordVersion: 2, version: 2 }),
      q("7", "8", { validationStatus: "unvalidated", validatedRecordVersion: null, version: 1 }), // measure-only
      q("9", "9"), // no validation data at all
      u(),
    ];
    const [validated] = totalValuePools(pools, { basis: "validated" });
    expect(validated).toEqual({
      currency: "SAR",
      quantifiedTotal: { downside: "100.0000", upside: "200.0000" },
      unquantifiedCount: 1,
      quantifiedCount: 1,
      basis: "validated",
      notValidatedCount: 4,
    });
    const [all] = totalValuePools(pools);
    expect(all!.quantifiedTotal).toEqual({ downside: "1121.0000", upside: "2223.0000" });
    // Nothing validated yet -> Unknown, not 0.
    expect(totalValuePools([q("7", "8")], { basis: "validated" })[0]!.quantifiedTotal).toBeNull();
  });

  it("property: per-currency totals equal the exact BigInt sums and do not depend on order", () => {
    const r = rng(73);
    const currencies = ["SAR", "USD", "EUR"];
    for (let run = 0; run < 200; run++) {
      const pools: ValuePoolForTotal[] = Array.from({ length: Math.floor(r() * 25) }, () => {
        const currency = currencies[Math.floor(r() * currencies.length)]!;
        if (r() < 0.3) return u({ currency });
        const a = randomMoney(r);
        const b = randomMoney(r);
        const [down, up] = compareDecimal(a, b) <= 0 ? [a, b] : [b, a];
        return q(down, up, { currency });
      });
      const totals = totalValuePools(pools);
      const shuffled = [...pools].sort(() => r() - 0.5);
      expect(totalValuePools(shuffled)).toEqual(totals);
      for (const t of totals) {
        const mine = pools.filter((p) => p.currency === t.currency);
        const quantified = mine.filter((p) => p.quantificationStatus === "quantified");
        expect(t.unquantifiedCount).toBe(mine.length - quantified.length);
        if (quantified.length === 0) {
          expect(t.quantifiedTotal).toBeNull();
          continue;
        }
        const down = quantified.reduce((acc, p) => acc + scaled(p.downsideAmount!, 4), 0n);
        const up = quantified.reduce((acc, p) => acc + scaled(p.upsideAmount!, 4), 0n);
        expect(t.quantifiedTotal).toEqual({ downside: unscaled(down, 4), upside: unscaled(up, 4) });
      }
    }
  });
});

describe("no float conversion of amounts in value.ts (ADR-0019 §4 lint check)", () => {
  it("the source uses no parseFloat, Number(...) or unary plus on values", () => {
    const src = readFileSync(fileURLToPath(new URL("./value.ts", import.meta.url)), "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
      .join("\n");
    expect(src).not.toMatch(/parseFloat|Number\(|parseInt|toNumber\(|valueOf\(|=\s*\+[a-zA-Z(]/);
  });
});
