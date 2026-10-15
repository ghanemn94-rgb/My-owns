// Unit tests of the health-check calculations (ADR-0048 §5, §6, §10; T-DG5-KBE-G). Worked fixtures quote the
// acceptance texts of REQ-S14-001 ("25 answers with 17 Yes give a score of 17 and the band '16-20'"), REQ-S14-002
// ("an assessment with 24 answers ... the API returns band=null"), REQ-PB-092 ("scores 21, 16, 10 and 9 map to the four
// band texts") and REQ-S14-003 ("publishing a scheme that adds N/A without new bands is rejected"). The property tests
// use a seeded generator (deterministic under load, F-DG4-143); the agreement with the database functions on 1,000
// generated answer sets is the API integration test `test/integration/health/health-scoring-db.test.ts`.
import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  formatHealthScore,
  HEALTH_QUESTION_CODES,
  HEALTH_SCHEME_PROBLEMS,
  healthAssessmentResult,
  healthBandFor,
  healthCompletion,
  healthResponseAllowed,
  healthSchemeProblem,
  isYesNoPointsScheme,
  type HealthBandElement,
  type HealthResponseElement,
  type HealthSchemeInput,
} from "./scoring.ts";

/** Scheme v1 exactly as 0086 seeds it (the B0152 bands; Yes = 1, No = 0; points out of 25). */
const V1_BANDS: HealthBandElement[] = [
  { key: "b0152_21_25", origin: "source", minScore: "21" },
  { key: "b0152_16_20", origin: "source", minScore: "16" },
  { key: "b0152_10_15", origin: "source", minScore: "10" },
  { key: "b0152_0_9", origin: "source", minScore: "0" },
];
const V1: HealthSchemeInput = {
  definition: { scoreBasis: "points", questionCount: 25, implementationAssumption: true },
  responses: [
    { key: "yes", credit: "1" },
    { key: "no", credit: "0" },
  ],
  bands: V1_BANDS,
};
const OWN_PERCENT_BANDS: HealthBandElement[] = [
  { key: "strong", origin: "admin", minScore: "80" },
  { key: "solid", origin: "admin", minScore: "60" },
  { key: "risk", origin: "admin", minScore: "40" },
  { key: "reset", origin: "admin", minScore: "0" },
];
const NA_SCHEME: HealthSchemeInput = {
  definition: { scoreBasis: "percent_of_applicable", questionCount: 25 },
  responses: [
    { key: "yes", credit: "1" },
    { key: "no", credit: "0" },
    { key: "partial", credit: "0.5" },
    { key: "na", credit: null },
  ],
  bands: OWN_PERCENT_BANDS,
};

const answersOf = (yes: number, no: number, other: Record<string, number> = {}): string[] => [
  ...Array<string>(yes).fill("yes"),
  ...Array<string>(no).fill("no"),
  ...Object.entries(other).flatMap(([k, n]) => Array<string>(n).fill(k)),
];

describe("scheme v1 scoring (REQ-S14-001, implementation assumption M0262)", () => {
  it("25 answers with 17 Yes give a score of 17 and the band '16-20'", () => {
    const r = healthAssessmentResult(V1, answersOf(17, 8));
    expect(r).toEqual({
      completion: { answered: 25, total: 25, complete: true },
      computable: true,
      score: "17",
      scoreMax: "25",
      bandKey: "b0152_16_20",
      applicable: 25,
    });
  });

  it("is the count of Yes for every split of 25 answers", () => {
    for (let yes = 0; yes <= 25; yes += 1) {
      const r = healthAssessmentResult(V1, answersOf(yes, 25 - yes));
      expect(r.score).toBe(String(yes));
      expect(r.scoreMax).toBe("25");
    }
  });

  it("v1 is recognised as the Yes/No points scheme; a partial scheme is not", () => {
    expect(isYesNoPointsScheme(V1)).toBe(true);
    expect(isYesNoPointsScheme(NA_SCHEME)).toBe(false);
  });
});

describe("the four B0152 bands (REQ-PB-092)", () => {
  it("scores 21, 16, 10 and 9 map to 21-25, 16-20, 10-15 and 0-9", () => {
    const keyOf = (yes: number) => healthAssessmentResult(V1, answersOf(yes, 25 - yes)).bandKey;
    expect([keyOf(21), keyOf(16), keyOf(10), keyOf(9)]).toEqual([
      "b0152_21_25",
      "b0152_16_20",
      "b0152_10_15",
      "b0152_0_9",
    ]);
  });

  it("every boundary: 25, 20, 15, 0 stay in their band", () => {
    const keyOf = (n: number) => healthBandFor(new Decimal(n), V1_BANDS)?.key;
    expect([keyOf(25), keyOf(20), keyOf(15), keyOf(0)]).toEqual([
      "b0152_21_25",
      "b0152_16_20",
      "b0152_10_15",
      "b0152_0_9",
    ]);
  });

  it("a score below every band has no band, and removed bands are ignored", () => {
    expect(healthBandFor(new Decimal("4.99"), [{ key: "x", origin: "admin", minScore: "5" }])).toBeNull();
    const removed = V1_BANDS.map((b) => (b.key === "b0152_21_25" ? { ...b, removed: true } : b));
    expect(healthBandFor(new Decimal(25), removed)?.key).toBe("b0152_16_20");
  });
});

describe("incomplete is not zero (REQ-S14-002)", () => {
  it("24 answers: completion {answered: 24, total: 25}, score and band null", () => {
    const r = healthAssessmentResult(V1, answersOf(24, 0));
    expect(r.completion).toEqual({ answered: 24, total: 25, complete: false });
    expect([r.score, r.scoreMax, r.bandKey, r.computable]).toEqual([null, null, null, false]);
  });

  it("no answer at all is incomplete, never 0", () => {
    const r = healthAssessmentResult(V1, []);
    expect([r.completion.answered, r.score, r.bandKey]).toEqual([0, null, null]);
    expect(healthCompletion(25)).toEqual({ answered: 25, total: 25, complete: true });
  });

  it("all 25 N/A is not computable (no score, no band)", () => {
    const r = healthAssessmentResult(NA_SCHEME, answersOf(0, 0, { na: 25 }));
    expect([r.completion.complete, r.computable, r.score, r.bandKey, r.applicable]).toEqual([
      true,
      false,
      null,
      null,
      0,
    ]);
  });

  it("an answer whose key the scheme no longer has counts as answered but not applicable", () => {
    const r = healthAssessmentResult(V1, answersOf(10, 14, { partial: 1 }));
    expect([r.completion.answered, r.applicable, r.score]).toEqual([25, 24, "10"]);
  });
});

describe("percent_of_applicable and partial credit (worked fixtures)", () => {
  it("15 Yes, 5 partial (0.5), 3 No, 2 N/A: 100 × 17.5 / 23 = 76.09 out of 100, band 'solid'", () => {
    const r = healthAssessmentResult(NA_SCHEME, answersOf(15, 3, { partial: 5, na: 2 }));
    expect([r.score, r.scoreMax, r.bandKey, r.applicable]).toEqual(["76.09", "100", "solid", 23]);
  });

  it("20 Yes, 5 N/A: 100 out of 100", () => {
    expect(healthAssessmentResult(NA_SCHEME, answersOf(20, 0, { na: 5 })).score).toBe("100");
  });

  it("rounds half away from zero to 2 decimals: 1 Yes of 8 applicable = 12.50; 2 of 3 = 66.67", () => {
    expect(healthAssessmentResult(NA_SCHEME, answersOf(1, 7, { na: 17 })).score).toBe("12.50");
    expect(healthAssessmentResult(NA_SCHEME, answersOf(2, 1, { na: 22 })).score).toBe("66.67");
    // 1/16 = 0.0625 -> 6.25 exactly; 1/24 = 4.1666… -> 4.17; 5/8 = 62.5 -> "62.50"
    expect(healthAssessmentResult(NA_SCHEME, answersOf(1, 15, { na: 9 })).score).toBe("6.25");
    expect(healthAssessmentResult(NA_SCHEME, answersOf(1, 23, { na: 1 })).score).toBe("4.17");
    expect(healthAssessmentResult(NA_SCHEME, answersOf(5, 3, { na: 17 })).score).toBe("62.50");
  });

  it("partial credit on points: 17 Yes and 3 × 0.25 give 17.75 out of 25", () => {
    const scheme: HealthSchemeInput = {
      definition: { scoreBasis: "points", questionCount: 25 },
      responses: [...V1.responses, { key: "partial", credit: "0.25" }],
      bands: [
        { key: "high", origin: "admin", minScore: "17.5" },
        { key: "low", origin: "admin", minScore: "0" },
      ],
    };
    const r = healthAssessmentResult(scheme, answersOf(17, 5, { partial: 3 }));
    expect([r.score, r.scoreMax, r.bandKey]).toEqual(["17.75", "25", "high"]);
  });

  it("formats whole scores without .00 and keeps two decimals otherwise", () => {
    expect([formatHealthScore(new Decimal(17)), formatHealthScore(new Decimal("62.5"))]).toEqual(["17", "62.50"]);
    expect(formatHealthScore(new Decimal("0"))).toBe("0");
  });
});

describe("the scheme publish rule (REQ-S14-003; ADR-0048 §6, mirroring p5_health_scheme_problem)", () => {
  it("v1 and an N/A scheme with its own bands and percent_of_applicable may be published", () => {
    expect(healthSchemeProblem(V1)).toBeNull();
    expect(healthSchemeProblem(NA_SCHEME)).toBeNull();
  });

  it("adding N/A that keeps the source bands is rejected: health_scheme_own_bands_required", () => {
    const scheme: HealthSchemeInput = {
      definition: { scoreBasis: "percent_of_applicable", questionCount: 25 },
      responses: [...V1.responses, { key: "na", credit: null }],
      bands: [...V1_BANDS, ...OWN_PERCENT_BANDS.filter((b) => b.key !== "reset")],
    };
    expect(healthSchemeProblem(scheme)).toBe("health_scheme_own_bands_required");
    // One source band left is still a reuse; removing all four makes it publishable.
    const one = { ...scheme, bands: [...OWN_PERCENT_BANDS, V1_BANDS[3]!] };
    expect(healthSchemeProblem(one)).toBe("health_scheme_bands_invalid"); // two bands at 0
    const removed = { ...scheme, bands: [...OWN_PERCENT_BANDS, ...V1_BANDS.map((b) => ({ ...b, removed: true }))] };
    expect(healthSchemeProblem(removed)).toBeNull();
  });

  it("partial credit with the source bands is rejected too", () => {
    const scheme: HealthSchemeInput = { ...V1, responses: [...V1.responses, { key: "partial", credit: "0.5" }] };
    expect(healthSchemeProblem(scheme)).toBe("health_scheme_own_bands_required");
  });

  it("N/A on points is rejected: health_scheme_na_needs_percent", () => {
    const scheme: HealthSchemeInput = { ...NA_SCHEME, definition: { scoreBasis: "points", questionCount: 25 } };
    expect(healthSchemeProblem(scheme)).toBe("health_scheme_na_needs_percent");
  });

  it("the definition needs a basis and 25 questions", () => {
    for (const definition of [
      {},
      null,
      [],
      { scoreBasis: "points" },
      { scoreBasis: "points", questionCount: 24 },
      { scoreBasis: "weighted", questionCount: 25 },
    ])
      expect(healthSchemeProblem({ ...V1, definition })).toBe("health_scheme_definition");
    // `->>` gives '25' for the number and for the string: both pass, as in the database.
    expect(healthSchemeProblem({ ...V1, definition: { scoreBasis: "points", questionCount: "25" } })).toBeNull();
  });

  it("Yes = 1 and No = 0 are required", () => {
    const without = (key: string) => ({ ...V1, responses: V1.responses.filter((r) => r.key !== key) });
    expect(healthSchemeProblem(without("yes"))).toBe("health_scheme_yes_no_required");
    expect(healthSchemeProblem(without("no"))).toBe("health_scheme_yes_no_required");
    const changed: HealthResponseElement[] = [
      { key: "yes", credit: "0.9" },
      { key: "no", credit: "0" },
    ];
    expect(healthSchemeProblem({ ...V1, responses: changed })).toBe("health_scheme_yes_no_required");
    const removedYes = V1.responses.map((r) => (r.key === "yes" ? { ...r, removed: true } : r));
    expect(healthSchemeProblem({ ...V1, responses: removedYes })).toBe("health_scheme_yes_no_required");
  });

  it("partial credit strictly between 0 and 1; N/A with an explicit null credit", () => {
    const own = { ...NA_SCHEME };
    const withPartial = (credit: unknown) => ({
      ...own,
      responses: [...V1.responses, { key: "partial", credit }],
    });
    for (const bad of ["0", "1", "0.00", "0.123", "1.5", 0.5, null, undefined])
      expect(healthSchemeProblem(withPartial(bad)), String(bad)).toBe("health_scheme_credit");
    for (const good of ["0.5", "0.01", "0.99", "0.25"]) expect(healthSchemeProblem(withPartial(good))).toBeNull();
    const naWith = (credit: unknown) => ({ ...own, responses: [...V1.responses, { key: "na", credit }] });
    expect(healthSchemeProblem(naWith("0"))).toBe("health_scheme_credit");
    expect(healthSchemeProblem(naWith(undefined))).toBe("health_scheme_credit");
    expect(healthSchemeProblem(naWith(null))).toBeNull();
  });

  it("bands: one at 0, distinct, within the maximum", () => {
    const withBands = (bands: HealthBandElement[]) => ({ ...NA_SCHEME, bands });
    expect(healthSchemeProblem(withBands([]))).toBe("health_scheme_bands_invalid");
    expect(healthSchemeProblem(withBands([{ key: "a", origin: "admin", minScore: "10" }]))).toBe(
      "health_scheme_bands_invalid",
    );
    expect(
      healthSchemeProblem(
        withBands([
          { key: "a", origin: "admin", minScore: "0" },
          { key: "b", origin: "admin", minScore: "100.01" },
        ]),
      ),
    ).toBe("health_scheme_bands_invalid");
    expect(
      healthSchemeProblem(
        withBands([
          { key: "a", origin: "admin", minScore: "0.00" },
          { key: "b", origin: "admin", minScore: "50" },
          { key: "c", origin: "admin", minScore: "50.0" },
        ]),
      ),
    ).toBe("health_scheme_bands_invalid");
    // On points the maximum is 25: a band at 26 is out of range.
    expect(healthSchemeProblem({ ...V1, bands: [...V1_BANDS, { key: "x", origin: "admin", minScore: "26" }] })).toBe(
      "health_scheme_bands_invalid",
    );
    expect(healthSchemeProblem(withBands([{ key: "a", origin: "admin", minScore: "000" }]))).toBeNull();
  });

  it("checks in the database's order (the first failing rule answers)", () => {
    const everything: HealthSchemeInput = {
      definition: { scoreBasis: "points", questionCount: 25 },
      responses: [{ key: "na", credit: "1" }],
      bands: [],
    };
    expect(healthSchemeProblem(everything)).toBe("health_scheme_yes_no_required");
    expect(healthSchemeProblem({ ...everything, responses: [...V1.responses, { key: "na", credit: "1" }] })).toBe(
      "health_scheme_credit",
    );
    expect(HEALTH_SCHEME_PROBLEMS).toHaveLength(6);
  });

  it("response keys are allowed only while the scheme has them", () => {
    expect([healthResponseAllowed(V1, "yes"), healthResponseAllowed(V1, "na")]).toEqual([true, false]);
    expect(HEALTH_QUESTION_CODES).toHaveLength(25);
    expect([HEALTH_QUESTION_CODES[0], HEALTH_QUESTION_CODES[24]]).toEqual(["q01", "q25"]);
  });
});

/** A small seeded generator (mulberry32): the property tests are deterministic. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("properties (seeded, 2,000 generated answer sets per scheme)", () => {
  const schemes: [string, HealthSchemeInput][] = [
    ["v1", V1],
    ["percent with partial and N/A", NA_SCHEME],
  ];
  for (const [name, scheme] of schemes)
    it(`${name}: incomplete -> null; complete -> 0 <= score <= max, the reference formula, the highest band <= score`, () => {
      const next = rng(name.length * 7919);
      const keys = scheme.responses.map((r) => r.key);
      for (let i = 0; i < 2000; i += 1) {
        const count = next() < 0.2 ? Math.floor(next() * 25) : 25;
        const answers = Array.from({ length: count }, () => keys[Math.floor(next() * keys.length)]!);
        const r = healthAssessmentResult(scheme, answers);
        expect(r.completion).toEqual({ answered: count, total: 25, complete: count === 25 });
        if (count < 25) {
          expect([r.score, r.scoreMax, r.bandKey]).toEqual([null, null, null]);
          continue;
        }
        const credits = answers.map((a) => scheme.responses.find((x) => x.key === a)!.credit as string | null);
        const applicable = credits.filter((c) => c !== null);
        if (applicable.length === 0) {
          expect(r.score).toBeNull();
          continue;
        }
        // An independent re-derivation in integer hundredths (credits have at most 2 decimals).
        const hundredths = applicable.reduce((s, c) => s + Math.round(Number(c) * 100), 0);
        const points = (scheme.definition as { scoreBasis: string }).scoreBasis === "points";
        const expected = points
          ? new Decimal(hundredths).dividedBy(100)
          : new Decimal(hundredths).dividedBy(applicable.length).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        expect(new Decimal(r.score!).equals(expected)).toBe(true);
        const max = new Decimal(r.scoreMax!);
        expect(new Decimal(r.score!).gte(0) && new Decimal(r.score!).lte(max)).toBe(true);
        const eligible = scheme.bands.filter((b) => new Decimal(b.minScore as string).lte(expected));
        const top = eligible.sort((a, b) => new Decimal(b.minScore as string).comparedTo(a.minScore as string))[0];
        expect(r.bandKey).toBe(top?.key ?? null);
      }
    });

  it("one more Yes in place of a No never lowers the score (monotone)", () => {
    const next = rng(42);
    for (let i = 0; i < 500; i += 1) {
      const answers = Array.from({ length: 25 }, () => (next() < 0.5 ? "yes" : next() < 0.5 ? "no" : "partial"));
      const scheme: HealthSchemeInput = {
        definition: { scoreBasis: "points", questionCount: 25 },
        responses: [...V1.responses, { key: "partial", credit: "0.5" }],
        bands: [{ key: "all", origin: "admin", minScore: "0" }],
      };
      const at = answers.indexOf("no");
      if (at < 0) continue;
      const better = answers.map((a, j) => (j === at ? "yes" : a));
      const before = new Decimal(healthAssessmentResult(scheme, answers).score!);
      expect(new Decimal(healthAssessmentResult(scheme, better).score!).gt(before)).toBe(true);
    }
  });

  it("generated schemes: a scheme the rule accepts always scores inside its maximum and finds a band", () => {
    const next = rng(2026);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!;
    let accepted = 0;
    for (let i = 0; i < 1000; i += 1) {
      const basis = pick(["points", "percent_of_applicable", "points"]);
      const responses: HealthResponseElement[] = [
        { key: "yes", credit: "1" },
        { key: "no", credit: "0" },
      ];
      if (next() < 0.5) responses.push({ key: "partial", credit: pick(["0.5", "0.25", "0.75", "0", "1"]) });
      if (next() < 0.4) responses.push({ key: "na", credit: next() < 0.9 ? null : "0" });
      const bands: HealthBandElement[] = next() < 0.4 ? [...V1_BANDS] : [];
      const nBands = Math.floor(next() * 4);
      for (let b = 0; b < nBands; b += 1)
        bands.push({ key: `own${b}`, origin: "admin", minScore: pick(["0", "5", "12.5", "20", "50", "99.99", "101"]) });
      const scheme: HealthSchemeInput = { definition: { scoreBasis: basis, questionCount: 25 }, responses, bands };
      if (healthSchemeProblem(scheme) !== null) continue;
      accepted += 1;
      // The publish rule's promises hold for every accepted scheme.
      const keys = responses.map((r) => r.key);
      if (keys.includes("na")) expect(basis).toBe("percent_of_applicable");
      if (keys.includes("na") || keys.includes("partial")) expect(bands.some((b) => b.origin === "source")).toBe(false);
      const answers = Array.from({ length: 25 }, () => pick(keys));
      const r = healthAssessmentResult(scheme, answers);
      if (r.score === null) {
        expect(r.applicable).toBe(0);
        continue;
      }
      expect(new Decimal(r.score).lte(r.scoreMax!)).toBe(true);
      expect(r.bandKey).not.toBeNull(); // every accepted scheme has a band at 0
    }
    expect(accepted).toBeGreaterThan(50);
  });
});
