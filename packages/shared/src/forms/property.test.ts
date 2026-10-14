// Property tests of the field-type validators (REQ-S06-005; ADR-0041 §3, §7). T-DG5-KBE-B. No property-testing
// package is installed (no new dependency, D-142 Q8), so the generators use a seeded mulberry32 PRNG, the
// formula fuzz.test.ts and kpi property.test.ts precedent: every failure names its seed and case and reproduces
// exactly. Expected values are computed by STRING manipulation (moving the decimal point), independently of the
// decimal.js code under test, and never through a JavaScript number.
import { describe, expect, it } from "vitest";
import { defineField, type FieldDefinition } from "./field-types.ts";
import { fractionToPercent, normalizePercentage } from "./normalize.ts";
import { validateFieldValue } from "./validate.ts";

/** Cases per property; each test has a 60 s timeout so a loaded host cannot make it flaky (F-DG4-143). */
const CASES = 3000;
const SEED = 0x5f0b1;

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
  /** A decimal string: 1-`maxInt` integer digits (no superfluous leading zero), 0-`maxFrac` fraction digits. */
  const decimal = (maxInt: number, maxFrac: number, negative = true): string => {
    const intPart = digits(int(1, maxInt)).replace(/^0+(?=[0-9])/, "");
    const frac = int(0, maxFrac);
    const sign = negative && int(0, 3) === 0 ? "-" : "";
    return `${sign}${intPart}${frac > 0 ? `.${digits(frac)}` : ""}`;
  };
  return { int, decimal };
}

function field(key: string, type: string, attrs: Record<string, unknown> = {}): FieldDefinition {
  const r = defineField(key, type, attrs);
  if (!r.ok) throw new Error(`fixture ${key}`);
  return r.field;
}

/** Canonical form by string rules only: strip leading zeros of the integer part and trailing fraction zeros, "-0" → "0". */
function canonicalString(s: string): string {
  const neg = s.startsWith("-");
  const body = neg ? s.slice(1) : s;
  const [i = "0", f = ""] = body.split(".");
  const intPart = i.replace(/^0+(?=[0-9])/, "") || "0";
  const frac = f.replace(/0+$/, "");
  const out = frac.length > 0 ? `${intPart}.${frac}` : intPart;
  return neg && out !== "0" ? `-${out}` : out;
}

/** p (percent) → p / 100 by moving the point two places left, as a string. */
function percentToFractionString(p: string): string {
  const neg = p.startsWith("-");
  const body = neg ? p.slice(1) : p;
  const [i = "0", f = ""] = body.split(".");
  const padded = i.padStart(3, "0");
  const out = `${padded.slice(0, -2)}.${padded.slice(-2)}${f}`;
  return canonicalString(`${neg ? "-" : ""}${out}`);
}

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";

describe("property: no float on any path", () => {
  const num = field("n", "number", {});
  const money = field("m", "currency", { currencyCode: "SAR" });

  it(
    `number values round-trip exactly through validation and JSON (${CASES} cases, seed ${SEED})`,
    { timeout: 60_000 },
    () => {
      const r = rng(SEED);
      for (let c = 0; c < CASES; c++) {
        const v = r.decimal(15, 6);
        const out = validateFieldValue(num, v);
        expect(out, `seed ${SEED} case ${c}: ${v}`).toEqual({ ok: true, value: v, checks: [] });
        expect(JSON.parse(JSON.stringify(out.ok ? out.value : null))).toBe(v);
      }
    },
  );

  it(`currency amounts round-trip exactly, e.g. 1500000.10 SAR (${CASES} cases)`, { timeout: 60_000 }, () => {
    const r = rng(SEED + 1);
    const samples = ["1500000.10", "0.10", "999999999999999.99", "-0.01"];
    for (let c = 0; c < CASES; c++) samples.push(r.decimal(15, 2));
    for (const [c, amount] of samples.entries()) {
      const out = validateFieldValue(money, { amount, currencyCode: "SAR" });
      expect(out, `seed ${SEED + 1} case ${c}: ${amount}`).toEqual({
        ok: true,
        value: { amount, currencyCode: "SAR" },
        checks: [],
      });
      expect(JSON.parse(JSON.stringify(out.ok ? out.value : null))).toEqual({ amount, currencyCode: "SAR" });
    }
  });

  it(
    `a currency amount with more than two significant decimals is refused, never rounded (${CASES} cases)`,
    { timeout: 60_000 },
    () => {
      const r = rng(SEED + 2);
      for (let c = 0; c < CASES; c++) {
        const amount = `${r.decimal(12, 0, false)}.${String(r.int(0, 99)).padStart(2, "0")}${r.int(1, 9)}`;
        const out = validateFieldValue(money, { amount, currencyCode: "SAR" });
        expect(out, `seed ${SEED + 2} case ${c}: ${amount}`).toMatchObject({
          ok: false,
          code: "validation.currency_amount",
        });
      }
    },
  );
});

describe("property: percentages are stored as fractions", () => {
  const pct = field("p", "percentage", { min: "-1000", max: "1000" });

  it(`"p%" and typed "p" store p / 100; the API fraction stores itself (${CASES} cases)`, { timeout: 60_000 }, () => {
    const r = rng(SEED + 3);
    for (let c = 0; c < CASES; c++) {
      const p = r.decimal(5, 4);
      const expected = percentToFractionString(p);
      const label = `seed ${SEED + 3} case ${c}: ${p}`;
      expect(validateFieldValue(pct, `${p}%`), label).toMatchObject({ ok: true, value: expected });
      expect(validateFieldValue(pct, p, { percentageBareAs: "percent" }), label).toMatchObject({
        ok: true,
        value: expected,
      });
      expect(validateFieldValue(pct, expected), label).toMatchObject({ ok: true, value: expected });
      expect(fractionToPercent(expected), label).toBe(canonicalString(p));
    }
  });

  it(
    `a percentage whose fraction needs more than 6 decimals is refused, never rounded (${CASES} cases)`,
    { timeout: 60_000 },
    () => {
      const r = rng(SEED + 4);
      for (let c = 0; c < CASES; c++) {
        const p = `${r.decimal(3, 0, false)}.${String(r.int(0, 9999)).padStart(4, "0")}${r.int(1, 9)}`;
        expect(normalizePercentage(`${p}%`), `seed ${SEED + 4} case ${c}: ${p}`).toEqual({
          ok: false,
          reason: "out_of_range",
        });
      }
    },
  );
});

describe("property: Arabic-Indic digits are refused (the DG3 decimal rule)", () => {
  const num = field("n", "number", {});
  const pct = field("p", "percentage", {});
  const money = field("m", "currency", { currencyCode: "SAR" });

  it(
    `any Arabic-Indic digit makes a number refused with validation.decimal (${CASES} cases)`,
    { timeout: 60_000 },
    () => {
      const r = rng(SEED + 5);
      for (let c = 0; c < CASES; c++) {
        const v = r.decimal(10, 4);
        const positions = [...v].flatMap((ch, i) => (/[0-9]/.test(ch) ? [i] : []));
        const at = positions[r.int(0, positions.length - 1)]!;
        const bad = `${v.slice(0, at)}${ARABIC_INDIC[Number.parseInt(v[at]!, 10)]}${v.slice(at + 1)}`;
        const label = `seed ${SEED + 5} case ${c}: ${bad}`;
        expect(validateFieldValue(num, bad), label).toMatchObject({ ok: false, code: "validation.decimal" });
        expect(validateFieldValue(pct, `${bad}%`), label).toMatchObject({ ok: false, code: "validation.percentage" });
        expect(validateFieldValue(money, { amount: bad }), label).toMatchObject({
          ok: false,
          code: "validation.currency_amount",
        });
      }
    },
  );
});
