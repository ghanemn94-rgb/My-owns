// REQ-S13-006 (ADR-0046 §4): the formula-injection rule, property-tested with a seeded generator (deterministic: the
// same 2,000 strings on every run, F-DG4-143). Each of `=`, `+`, `-`, `@`, TAB and CR as the first character is
// neutralized; any other first character is not.
import { describe, expect, it } from "vitest";
import { FORMULA_TRIGGER_CHARACTERS, neutralizeSpreadsheetText, startsLikeFormula } from "./injection.ts";

/** Mulberry32: a small seeded PRNG (deterministic property cases). */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHABET = [..."abcXYZ019 ,;'\"()=+-@\t\r\n!#$%&*/:<>?[]^_`{|}~", "é", "ب", "ع", "🙂", " ", "‏", "＝", "－"];

function randomString(rand: () => number, first: string | null): string {
  const n = Math.floor(rand() * 20);
  let s = first ?? "";
  for (let i = 0; i < n; i++) s += ALPHABET[Math.floor(rand() * ALPHABET.length)]!;
  return s;
}

describe("neutralizeSpreadsheetText (REQ-S13-006)", () => {
  it("the six trigger characters are exactly =, +, -, @, TAB and CR", () => {
    expect([...FORMULA_TRIGGER_CHARACTERS]).toEqual(["=", "+", "-", "@", "\t", "\r"]);
  });

  it("property: a text starting with each trigger is prefixed with an apostrophe and otherwise unchanged", () => {
    const rand = prng(20261015);
    for (const trigger of FORMULA_TRIGGER_CHARACTERS)
      for (let i = 0; i < 200; i++) {
        const s = randomString(rand, trigger);
        expect(startsLikeFormula(s)).toBe(true);
        expect(neutralizeSpreadsheetText(s)).toEqual({ text: `'${s}`, prefixed: true });
      }
  });

  it("property: a text starting with any other character (or empty) is left as it is", () => {
    const rand = prng(42);
    const others = ALPHABET.filter((c) => !FORMULA_TRIGGER_CHARACTERS.includes(c));
    let checked = 0;
    for (let i = 0; i < 800; i++) {
      const first = others[Math.floor(rand() * others.length)]!;
      const s = randomString(rand, first);
      expect(neutralizeSpreadsheetText(s)).toEqual({ text: s, prefixed: false });
      checked += 1;
    }
    expect(neutralizeSpreadsheetText("")).toEqual({ text: "", prefixed: false });
    // Look-alikes are not triggers: full-width equals and minus, a leading space, LF and a right-to-left mark.
    for (const s of ["＝SUM(A1)", "－1", " =1", "\n=1", "‏=1", "'=1"])
      expect(neutralizeSpreadsheetText(s).prefixed).toBe(false);
    expect(checked).toBe(800);
  });

  it("the REQ-S13-006 example: =HYPERLINK(...) becomes '=HYPERLINK(...)", () => {
    expect(neutralizeSpreadsheetText('=HYPERLINK("http://x","y")').text).toBe(`'=HYPERLINK("http://x","y")`);
  });
});
