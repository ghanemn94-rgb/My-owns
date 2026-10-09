// Unit and property tests of the record-fed adoption measures (ADR-0033 §6; REQ-PB-072, REQ-S11-002; T-DG4-KBE-F).
// Worked fixtures first, then seeded properties (no property-testing package is installed: the mulberry32 precedent of
// kpi/property.test.ts; every failure names its seed). All data is SYNTHETIC.
import { describe, expect, it } from "vitest";
import {
  ADOPTION_NO_PROFICIENCY_OBSERVATIONS,
  ADOPTION_NO_TRAINING_RECORDS,
  isBelowTrajectory,
  latestObservationPerSubject,
  observedProficiency,
  observedProficiencyCounts,
  ratioMeasure,
  subjectKeyOf,
  sumCounts,
  trainingCompletion,
  trainingCompletionCounts,
  type ProficiencyObservationInput,
  type TrainingRecordInput,
} from "./measures.ts";
import { KD } from "../kpi/types.ts";

const MARCH = { start: "2026-03-01", end: "2026-03-31" } as const;

const tr = (status: TrainingRecordInput["status"], createdOn: string, completedOn: string | null = null) =>
  ({ status, createdOn, completedOn }) as const;
const obs = (
  subject: { user?: string; label?: string },
  observedOn: string,
  result: ProficiencyObservationInput["result"],
  order: string,
  status: ProficiencyObservationInput["status"] = "submitted",
): ProficiencyObservationInput => ({
  status,
  subjectUserId: subject.user ?? null,
  subjectLabel: subject.label ?? null,
  observedOn,
  result,
  order,
});

describe("training completion (worked fixtures)", () => {
  it("3 of 4 eligible records completed in the period = 0.750000; withdrawn and later-created records are excluded", () => {
    const records = [
      tr("completed", "2026-02-10", "2026-03-05"),
      tr("completed", "2026-02-10", "2026-03-31"),
      tr("completed", "2026-03-02", "2026-03-20"),
      tr("enrolled", "2026-02-11"),
      tr("withdrawn", "2026-02-11"),
      tr("enrolled", "2026-04-01"), // created after the period end
    ];
    expect(trainingCompletionCounts(records, MARCH)).toEqual({ numerator: 3, denominator: 4 });
    expect(trainingCompletion([records], MARCH)).toEqual({
      valueStatus: "ok",
      value: "0.750000",
      valueReason: null,
      numerator: 3,
      denominator: 4,
    });
  });

  it("a completion outside the period counts in the denominator only; a no-show counts in the denominator", () => {
    const records = [
      tr("completed", "2026-01-01", "2026-02-28"),
      tr("no_show", "2026-01-01"),
      tr("completed", "2026-01-01", "2026-03-01"),
    ];
    expect(trainingCompletion([records], MARCH)).toMatchObject({ value: "0.333333", numerator: 1, denominator: 3 });
  });

  it("no eligible record → Unknown with its reason, value null, never 0", () => {
    for (const records of [[], [tr("withdrawn", "2026-01-01")], [tr("enrolled", "2026-04-02")]]) {
      const m = trainingCompletion([records], MARCH);
      expect(m).toEqual({
        valueStatus: "unknown",
        value: null,
        valueReason: ADOPTION_NO_TRAINING_RECORDS,
        numerator: 0,
        denominator: 0,
      });
    }
  });

  it("two groups aggregate by the weighted-ratio rule (sum of numerators ÷ sum of denominators), never the mean", () => {
    const a = [tr("completed", "2026-03-01", "2026-03-02")]; // 1/1
    const b = [tr("enrolled", "2026-03-01"), tr("enrolled", "2026-03-01"), tr("enrolled", "2026-03-01")]; // 0/3
    // Weighted: 1/4 = 0.25; the unweighted mean of 1 and 0 would be 0.5.
    expect(trainingCompletion([a, b], MARCH)).toMatchObject({ value: "0.250000", numerator: 1, denominator: 4 });
  });

  it("refuses malformed input instead of guessing", () => {
    expect(() => trainingCompletionCounts([tr("completed", "2026-03-01", null)], MARCH)).toThrow(RangeError);
    expect(() => trainingCompletionCounts([tr("enrolled", "1 March")], MARCH)).toThrow(RangeError);
    expect(() => trainingCompletionCounts([], { start: "2026-04-01", end: "2026-03-01" })).toThrow(RangeError);
  });
});

describe("observed proficiency (worked fixtures)", () => {
  it("REQ-PB-072 A11: 100% training completion with no proficiency observations → proficiency Unknown, not adopted", () => {
    const training = [tr("completed", "2026-03-01", "2026-03-02"), tr("completed", "2026-03-01", "2026-03-03")];
    expect(trainingCompletion([training], MARCH)).toMatchObject({ valueStatus: "ok", value: "1.000000" });
    const proficiency = observedProficiency([[]], MARCH);
    expect(proficiency).toEqual({
      valueStatus: "unknown",
      value: null,
      valueReason: ADOPTION_NO_PROFICIENCY_OBSERVATIONS,
      numerator: 0,
      denominator: 0,
    });
  });

  it("the LATEST observation per subject in the period decides; withdrawn and out-of-period observations are ignored", () => {
    const observations = [
      obs({ user: "u1" }, "2026-03-02", "not_yet_proficient", "a"),
      obs({ user: "u1" }, "2026-03-20", "proficient", "b"), // latest for u1
      obs({ user: "u2" }, "2026-03-10", "proficient", "c"),
      obs({ user: "u2" }, "2026-03-15", "not_yet_proficient", "d"), // latest for u2
      obs({ user: "u3" }, "2026-03-15", "proficient", "e", "withdrawn"), // withdrawn: ignored
      obs({ user: "u4" }, "2026-04-01", "proficient", "f"), // outside the period
      obs({ label: "  Synthetic Teller A " }, "2026-03-05", "proficient", "g"),
      obs({ label: "synthetic teller a" }, "2026-03-05", "not_yet_proficient", "h"), // same subject, later order
    ];
    expect(observedProficiencyCounts(observations, MARCH)).toEqual({ numerator: 1, denominator: 3 });
    expect(observedProficiency([observations], MARCH)).toMatchObject({ valueStatus: "ok", value: "0.333333" });
    const latest = latestObservationPerSubject(observations, MARCH);
    expect([...latest.keys()].sort()).toEqual(["label:synthetic teller a", "user:u1", "user:u2"]);
  });

  it("a later withdrawn observation does not hide the earlier valid one", () => {
    const observations = [
      obs({ user: "u1" }, "2026-03-02", "proficient", "a"),
      obs({ user: "u1" }, "2026-03-25", "not_yet_proficient", "b", "withdrawn"),
    ];
    expect(observedProficiency([observations], MARCH)).toMatchObject({
      value: "1.000000",
      numerator: 1,
      denominator: 1,
    });
  });

  it("the subject key is the user id, else the trimmed, case-folded label", () => {
    expect(subjectKeyOf({ subjectUserId: "x", subjectLabel: null })).toBe("user:x");
    expect(subjectKeyOf({ subjectUserId: null, subjectLabel: " Ab C " })).toBe("label:ab c");
    expect(subjectKeyOf({ subjectUserId: null, subjectLabel: "   " })).toBeNull();
    expect(subjectKeyOf({ subjectUserId: null, subjectLabel: null })).toBeNull();
  });
});

describe("ratio and aggregation guards", () => {
  it("rounds half-up to 6 fractional digits", () => {
    expect(ratioMeasure({ numerator: 2, denominator: 3 }, ADOPTION_NO_TRAINING_RECORDS).value).toBe("0.666667");
    expect(ratioMeasure({ numerator: 1, denominator: 8 }, ADOPTION_NO_TRAINING_RECORDS).value).toBe("0.125000");
    expect(ratioMeasure({ numerator: 0, denominator: 5 }, ADOPTION_NO_TRAINING_RECORDS).value).toBe("0.000000");
  });

  it("a numerator above its denominator, or a negative or fractional count, is refused", () => {
    expect(() => sumCounts([{ numerator: 2, denominator: 1 }])).toThrow(RangeError);
    expect(() => sumCounts([{ numerator: -1, denominator: 1 }])).toThrow(RangeError);
    expect(() => sumCounts([{ numerator: 0.5, denominator: 1 }])).toThrow(RangeError);
  });
});

describe("below trajectory (ADR-0033 §4 step 2)", () => {
  it.each([
    ["red", "adverse", true],
    ["amber", "adverse", true],
    ["green", "adverse", false],
    ["red", "within", false],
    ["red", "favourable", false],
    ["unknown", "unknown", false],
    ["stale", "unknown", false],
    ["not_computable", "unknown", false],
    ["amber", "unknown", false],
  ])("rag %s, deviation %s → %s", (rag, deviation, expected) => {
    expect(isBelowTrajectory(rag, deviation)).toBe(expected);
  });
});

// ------------------------------------------------------------------------------------------------ properties

const CASES = 1500;

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
  const pick = <T>(xs: readonly T[]): T => xs[int(0, xs.length - 1)]!;
  const date = () => `2026-${String(int(2, 4)).padStart(2, "0")}-${String(int(1, 28)).padStart(2, "0")}`;
  return { int, pick, date };
}

function genTraining(r: ReturnType<typeof rng>): TrainingRecordInput[] {
  const n = r.int(0, 12);
  return Array.from({ length: n }, () => {
    const status = r.pick(["enrolled", "completed", "no_show", "withdrawn"] as const);
    return { status, createdOn: r.date(), completedOn: status === "completed" ? r.date() : null };
  });
}

function genObservations(r: ReturnType<typeof rng>): ProficiencyObservationInput[] {
  const n = r.int(0, 12);
  return Array.from({ length: n }, (_, i) =>
    obs(
      r.int(0, 1) === 0 ? { user: `u${r.int(1, 4)}` } : { label: r.pick(["Ann", " ann ", "Bob", "BOB"]) },
      r.date(),
      r.pick(["proficient", "not_yet_proficient"] as const),
      String(i).padStart(3, "0"),
      r.pick(["submitted", "reviewed", "withdrawn"] as const),
    ),
  );
}

describe("properties (seeded)", () => {
  it("never 0 for an empty denominator: Unknown with value null exactly when the denominator is 0", () => {
    for (let seed = 1; seed <= CASES; seed++) {
      const r = rng(seed);
      const groups = Array.from({ length: r.int(1, 3) }, () => genTraining(r));
      const ogroups = Array.from({ length: r.int(1, 3) }, () => genObservations(r));
      for (const m of [trainingCompletion(groups, MARCH), observedProficiency(ogroups, MARCH)]) {
        if (m.denominator === 0) expect(m, `seed ${seed}`).toMatchObject({ valueStatus: "unknown", value: null });
        else {
          expect(m.valueStatus, `seed ${seed}`).toBe("ok");
          const v = new KD(m.value!);
          expect(v.gte(0) && v.lte(1), `seed ${seed}: ${m.value}`).toBe(true);
          expect(m.value, `seed ${seed}`).toBe(
            new KD(m.numerator).div(m.denominator).toDecimalPlaces(6, KD.ROUND_HALF_UP).toFixed(6),
          );
        }
      }
    }
  });

  it("completion never changes proficiency: any training records leave the proficiency measure identical", () => {
    for (let seed = 1; seed <= CASES; seed++) {
      const r = rng(seed);
      const observations = genObservations(r);
      const before = observedProficiency([observations], MARCH);
      // Drive training to 100 % completion in the period: proficiency is computed from observations only, so it is
      // unchanged (and stays Unknown when there is no observation).
      const allCompleted = genTraining(r).map((t) => ({
        ...t,
        status: "completed" as const,
        createdOn: "2026-02-01",
        completedOn: "2026-03-10",
      }));
      const completion = trainingCompletion([allCompleted], MARCH);
      if (allCompleted.length > 0) expect(completion.value, `seed ${seed}`).toBe("1.000000");
      expect(observedProficiency([observations], MARCH), `seed ${seed}`).toEqual(before);
      if (before.denominator === 0) expect(before.value, `seed ${seed}`).toBeNull();
    }
  });

  it("aggregation is the weighted ratio: equal to the measure over the concatenated groups for training", () => {
    for (let seed = 1; seed <= CASES; seed++) {
      const r = rng(seed);
      const groups = Array.from({ length: r.int(1, 4) }, () => genTraining(r));
      expect(trainingCompletion(groups, MARCH), `seed ${seed}`).toEqual(trainingCompletion([groups.flat()], MARCH));
    }
  });

  it("the numerator never exceeds the denominator, and the result does not depend on record order", () => {
    for (let seed = 1; seed <= CASES; seed++) {
      const r = rng(seed);
      const t = genTraining(r);
      const o = genObservations(r);
      const tc = trainingCompletionCounts(t, MARCH);
      const pc = observedProficiencyCounts(o, MARCH);
      expect(tc.numerator <= tc.denominator && pc.numerator <= pc.denominator, `seed ${seed}`).toBe(true);
      expect(trainingCompletionCounts([...t].reverse(), MARCH)).toEqual(tc);
      expect(observedProficiencyCounts([...o].reverse(), MARCH)).toEqual(pc);
    }
  });
});
