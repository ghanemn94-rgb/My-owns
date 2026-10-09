// Property tests of the KPI library (ADR-0028; T-DG4-KBE-A). No property-testing package is installed in the
// workspace, so the generators use a seeded mulberry32 PRNG (the formula fuzz.test.ts precedent): every failure names
// its seed and case and reproduces exactly. Expected values are recomputed independently in decimal.js.
import { describe, expect, it } from "vitest";
import {
  computeChange,
  cumulativeValue,
  evaluateMeasure,
  evaluateRag,
  expectedToDate,
  KD,
  periodValue,
  rollUp,
  roundForStorage,
  type KpiResult,
  type ReportingPeriodInfo,
  type ScopeValue,
} from "./index.ts";

const CASES = 2000;

/** Deterministic PRNG (mulberry32). */
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
  /** A decimal string that fits numeric(24,6): up to `maxInt` integer digits, 0–6 fraction digits, optional sign. */
  const decimal = (opts: { negative?: boolean; maxInt?: number; nonZero?: boolean } = {}): string => {
    for (;;) {
      const intDigits = int(1, opts.maxInt ?? 9);
      let s = String(int(0, 9));
      for (let i = 1; i < intDigits; i++) s += String(int(0, 9));
      s = s.replace(/^0+(?=\d)/, "");
      const frac = int(0, 6);
      if (frac > 0) {
        let f = "";
        for (let i = 0; i < frac; i++) f += String(int(0, 9));
        s += `.${f}`;
      }
      if (opts.negative && next() < 0.5) s = `-${s}`;
      if (opts.nonZero && new KD(s).isZero()) continue;
      return s;
    }
  };
  return { next, int, decimal };
}

function forAll(seed: number, n: number, body: (r: ReturnType<typeof rng>, i: number) => void) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    try {
      body(r, i);
    } catch (e) {
      throw new Error(`property failed at seed ${seed}, case ${i}: ${(e as Error).message}`, { cause: e });
    }
  }
}

const RAG_ORDER = { green: 0, amber: 1, red: 2 } as const;

describe("measures", () => {
  it("higher- and lower-is-better shortfalls are exact negatives; deviation follows the sign", () => {
    forAll(1, CASES, (r) => {
      const a = r.decimal({ negative: true });
      const e = r.decimal({ negative: true });
      const h = evaluateMeasure({ measureType: "higher_is_better", actual: a, expected: e });
      const l = evaluateMeasure({ measureType: "lower_is_better", actual: a, expected: e });
      expect(new KD(h.shortfall!).plus(new KD(l.shortfall!)).isZero()).toBe(true);
      const s = new KD(e).minus(new KD(a));
      expect(h.deviation).toBe(s.isZero() ? "within" : s.isPositive() ? "adverse" : "favourable");
    });
  });
  it("band: within ⇔ L ≤ a ≤ U, the shortfall is never negative, and equals the distance to the band", () => {
    forAll(2, CASES, (r) => {
      const x = new KD(r.decimal({ negative: true, maxInt: 4 }));
      const y = new KD(r.decimal({ negative: true, maxInt: 4 }));
      const [lo, hi] = x.lte(y) ? [x, y] : [y, x];
      const a = new KD(r.decimal({ negative: true, maxInt: 4 }));
      const m = evaluateMeasure({
        measureType: "acceptable_band",
        actual: a.toFixed(),
        bandLower: lo.toFixed(),
        bandUpper: hi.toFixed(),
      });
      const inside = a.gte(lo) && a.lte(hi);
      expect(m.deviation).toBe(inside ? "within" : "adverse");
      const s = new KD(m.shortfall!);
      expect(s.isNegative()).toBe(false);
      const dist = inside ? new KD(0) : a.lt(lo) ? lo.minus(a) : a.minus(hi);
      expect(s.eq(dist)).toBe(true);
    });
  });
});

describe("RAG", () => {
  it("higher-is-better: a lower actual never gives a better RAG (monotonic), relative and absolute", () => {
    forAll(3, CASES, (r) => {
      const e = r.decimal({ nonZero: true, maxInt: 6 });
      const a1 = new KD(r.decimal({ negative: true, maxInt: 6 }));
      const a2 = new KD(r.decimal({ negative: true, maxInt: 6 }));
      const [low, high] = a1.lte(a2) ? [a1, a2] : [a2, a1];
      const thresholds =
        r.next() < 0.5
          ? null
          : { id: "t", versionNo: 1, toleranceMode: "absolute" as const, amberThreshold: "10", redThreshold: "100" };
      const rag = (a: string) =>
        evaluateRag({
          measureType: "higher_is_better",
          actual: { status: "ok", value: a, reason: null },
          expected: { status: "ok", value: e, reason: null },
          trajectoryVersion: 1,
          thresholds,
        }).calculatedRag as keyof typeof RAG_ORDER;
      expect(RAG_ORDER[rag(low.toFixed())]).toBeGreaterThanOrEqual(RAG_ORDER[rag(high.toFixed())]);
    });
  });
  it("relative mode is scale-invariant: scaling actual and expected by k > 0 keeps the RAG", () => {
    forAll(4, CASES, (r) => {
      const a = new KD(r.decimal({ maxInt: 5 }));
      const e = new KD(r.decimal({ maxInt: 5, nonZero: true }));
      const k = new KD(r.int(1, 1000));
      const rag = (x: string, y: string) =>
        evaluateRag({
          measureType: "lower_is_better",
          actual: { status: "ok", value: x, reason: null },
          expected: { status: "ok", value: y, reason: null },
          trajectoryVersion: 1,
          thresholds: null,
        }).calculatedRag;
      expect(rag(a.times(k).toFixed(), e.times(k).toFixed())).toBe(rag(a.toFixed(), e.toFixed()));
    });
  });
  it("a non-ok value never yields green, amber or red", () => {
    const statuses: KpiResult[] = [
      { status: "unknown", value: null, reason: "kpi.no_accepted_actual" },
      { status: "not_computable", value: null, reason: "kpi.zero_denominator" },
      { status: "stale", value: "1", reason: "kpi.stale" },
    ];
    forAll(5, 300, (r) => {
      const actual = statuses[r.int(0, 2)]!;
      const res = evaluateRag({
        measureType: "higher_is_better",
        actual,
        expected: { status: "ok", value: r.decimal(), reason: null },
        trajectoryVersion: 1,
        thresholds: null,
      });
      expect(res.calculatedRag).toBe(actual.status);
    });
  });
});

describe("changes", () => {
  it("pp = (x₁ − x₀) × 100 exactly, and relative × |x₀| = x₁ − x₀ (to precision 80)", () => {
    forAll(6, CASES, (r) => {
      const x0 = r.decimal({ negative: true, maxInt: 3 });
      const x1 = r.decimal({ negative: true, maxInt: 3 });
      const c = computeChange({ from: x0, to: x1, unitKind: "percentage" });
      const diff = new KD(x1).minus(new KD(x0));
      expect(new KD(c.absolute.value).eq(diff.times(100))).toBe(true);
      if (new KD(x0).isZero()) {
        expect(c.relative.result).toEqual({ status: "not_computable", value: null, reason: "kpi.zero_base" });
      } else {
        const back = new KD(c.relative.result.value!).times(new KD(x0).abs());
        expect(back.minus(diff).abs().lt(new KD("1e-60"))).toBe(true);
        expect(c.relative.flag).toBe(new KD(x0).isNegative() ? "negative_baseline" : null);
      }
    });
  });
});

describe("cumulative and roll-ups", () => {
  const months: ReportingPeriodInfo[] = Array.from({ length: 12 }, (_, i) => {
    const m = String(i + 1).padStart(2, "0");
    const last = new Date(Date.UTC(2026, i + 1, 0)).getUTCDate();
    return {
      id: `m${m}`,
      frequency: "monthly",
      periodStart: `2026-${m}-01`,
      periodEnd: `2026-${m}-${last}`,
      basis: "calendar",
      weekCount: null,
    };
  });
  it("cumulative YTD of a flow equals the exact sum of its period values; removing any period makes it Unknown", () => {
    forAll(7, 500, (r) => {
      const n = r.int(1, 12);
      const values: Record<string, { kind: "value"; value: string }> = {};
      let sum = new KD(0);
      for (let i = 0; i < n; i++) {
        const v = r.decimal({ negative: true, maxInt: 9 });
        values[months[i]!.id] = { kind: "value", value: v };
        sum = sum.plus(new KD(periodValue("flow", { kind: "value", value: v }).value!));
      }
      const c = cumulativeValue({
        valueNature: "flow",
        current: months[n - 1]!,
        periods: months,
        values,
        ytdStartMonth: 1,
      })!;
      expect(new KD(c.result.value!).eq(sum)).toBe(true);
      const drop = months[r.int(0, n - 1)]!.id;
      const partial = { ...values };
      delete partial[drop];
      const u = cumulativeValue({
        valueNature: "flow",
        current: months[n - 1]!,
        periods: months,
        values: partial,
        ytdStartMonth: 1,
      })!;
      expect(u.result).toEqual({ status: "unknown", value: null, reason: "kpi.cumulative_incomplete" });
      expect(u.missing).toEqual([drop]);
    });
  });
  it("weighted ratio roll-up = Σn / Σd; with equal denominators it equals the mean of the ratios", () => {
    forAll(8, 500, (r) => {
      const k = r.int(1, 8);
      const equal = r.next() < 0.3;
      const commonDen = String(r.int(1, 1000));
      let sn = new KD(0);
      let sd = new KD(0);
      let meanSum = new KD(0);
      const inputs: ScopeValue[] = [];
      for (let i = 0; i < k; i++) {
        const den = equal ? commonDen : String(r.int(1, 1000));
        const num = String(r.int(0, Number(den)));
        sn = sn.plus(num);
        sd = sd.plus(den);
        meanSum = meanSum.plus(new KD(num).div(den));
        inputs.push({
          scopeId: `s${i}`,
          periodId: "p",
          basis: "period",
          unitKind: "percentage",
          unitLabel: null,
          currency: null,
          entry: { kind: "ratio", numerator: num, denominator: den },
        });
      }
      const out = rollUp({
        rule: "weighted_ratio",
        valueNature: "ratio",
        stockAdditiveAcrossScopes: false,
        unitKind: "percentage",
        unitLabel: null,
        currency: null,
        periodId: "p",
        basis: "period",
        previouslyReportingScopes: [],
        inputs,
      });
      expect(out.ok && out.kind === "value").toBe(true);
      const v = new KD((out as { result: KpiResult }).result.value!);
      expect(v.eq(sn.div(sd))).toBe(true);
      if (equal) expect(v.minus(meanSum.div(k)).abs().lt(new KD("1e-60"))).toBe(true);
    });
  });
  it("a sum roll-up never shrinks silently: dropping any expected scope's value gives Unknown, not a smaller total", () => {
    forAll(9, 500, (r) => {
      const k = r.int(1, 10);
      const inputs: ScopeValue[] = Array.from({ length: k }, (_, i) => ({
        scopeId: `s${i}`,
        periodId: "p",
        basis: "period" as const,
        unitKind: "currency" as const,
        unitLabel: null,
        currency: "SAR",
        entry: { kind: "value" as const, value: r.decimal({ maxInt: 8 }) },
      }));
      const base = {
        rule: "sum" as const,
        valueNature: "flow" as const,
        stockAdditiveAcrossScopes: false,
        unitKind: "currency" as const,
        unitLabel: null,
        currency: "SAR",
        periodId: "p",
        basis: "period" as const,
      };
      const all = inputs.map((x) => x.scopeId);
      const dropped = r.int(0, k - 1);
      const out = rollUp({ ...base, previouslyReportingScopes: all, inputs: inputs.filter((_, i) => i !== dropped) });
      expect(out.ok && out.kind === "value" && out.result).toEqual({
        status: "unknown",
        value: null,
        reason: "kpi.scope_missing",
      });
      expect(out.ok && out.kind === "value" && out.missingScopes).toEqual([`s${dropped}`]);
    });
  });
});

describe("trajectory", () => {
  it("linear expected values lie between the neighbouring points; step values are point values", () => {
    forAll(10, CASES, (r) => {
      const n = r.int(1, 6);
      const days = new Set<number>();
      while (days.size < n) days.add(r.int(0, 3000));
      const sorted = [...days].sort((a, b) => a - b);
      const iso = (d: number) => new Date(Date.UTC(2025, 0, 1) + d * 86_400_000).toISOString().slice(0, 10);
      const points = sorted.map((d) => ({ date: iso(d), value: r.decimal({ negative: true, maxInt: 6 }) }));
      const at = r.int(-50, 3050);
      const lin = expectedToDate({ trajectory: { basis: "period", interpolation: "linear", points }, at: iso(at) });
      const stp = expectedToDate({ trajectory: { basis: "period", interpolation: "step", points }, at: iso(at) });
      if (at < sorted[0]!) {
        expect(lin.result.reason).toBe("kpi.before_trajectory");
        expect(stp.result.reason).toBe("kpi.before_trajectory");
        return;
      }
      const vals = lin.from.map((p) => new KD(p.value));
      const v = new KD(lin.result.value!);
      expect(v.gte(KD.min(...vals)) && v.lte(KD.max(...vals))).toBe(true);
      expect(points.map((p) => new KD(p.value).toFixed())).toContain(new KD(stp.result.value!).toFixed());
    });
  });
});

describe("storage rounding", () => {
  it("rounds once half-up: |stored − exact| ≤ 0.0000005 and the record is honest", () => {
    forAll(11, CASES, (r) => {
      const num = new KD(r.decimal({ negative: true, maxInt: 9 }));
      const den = new KD(r.decimal({ maxInt: 4, nonZero: true }));
      const exact = num.div(den);
      const s = roundForStorage(exact.isZero() ? "0" : exact.toFixed());
      expect(s.ok).toBe(true);
      if (!s.ok) return;
      expect(new KD(s.stored).minus(exact).abs().lte(new KD("0.0000005"))).toBe(true);
      expect(s.rounding.rounded).toBe(!new KD(s.stored).eq(exact));
      expect(s.rounding.stored).toMatch(/^-?[0-9]+\.[0-9]{6}$/);
    });
  });
});
