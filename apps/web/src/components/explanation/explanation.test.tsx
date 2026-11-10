// Explanation panels (T-DG6-FE-F; ADR-0061 §8; REQ-S15-014 "the weighted score and benefit realized value show
// plain-language explanations in en and ar"). Each panel is rendered in English and Arabic from synthetic operation
// responses (the fixtures of KBE-B's view-model tests), opened through its disclosure button (found by its accessible
// name), and checked for: the formula in words of ADR-0061 §8 in the page's language, the inputs, the period and the
// version; Unknown / incomplete never rendered as 0 or as a favourable (green) status; read-only (nothing in a panel
// writes, so the AUD user sees exactly this).
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_WEIGHTS_V1,
  type BenefitValuesInput,
  type CashFlowsInput,
  type FinancialMetricsInput,
  type HealthCheckInput,
  type HealthSchemeVersionInput,
  type WeightedScoreSheetInput,
} from "@mth/shared/calc";
import { catalogues, createI18n } from "../../i18n/index.ts";
import {
  BenefitRealizedExplanation,
  FinancialMetricsExplanation,
  HealthScoreExplanation,
  WeightedScoreExplanation,
} from "./index.ts";

afterEach(cleanup);

type Locale = "en" | "ar";
const LOCALES: readonly Locale[] = ["en", "ar"];

function inLocale(locale: Locale, ui: ReactNode) {
  return render(<I18nextProvider i18n={createI18n(locale)}>{ui}</I18nextProvider>);
}
const ex = (locale: Locale) => catalogues[locale].explanations;

/** Opens the panel by its disclosure button (accessible name "Explain the …" / "اشرح …") and returns the region. */
function open(locale: Locale, valueName: string): HTMLElement {
  const button = screen.getByRole("button", { name: ex(locale).panel.show.replace("{{value}}", valueName) });
  expect(button.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(button);
  expect(button.getAttribute("aria-expanded")).toBe("true");
  const region = document.getElementById(button.getAttribute("aria-controls")!)!;
  expect(region.getAttribute("role")).toBe("region");
  expect(region.hidden).toBe(false);
  return region;
}

/** A panel is read-only: its only control is the disclosure button (nothing writes; the AUD user sees the same). */
function expectReadOnly(container: HTMLElement) {
  expect(container.querySelectorAll("input, select, textarea, form").length).toBe(0);
  expect(container.querySelectorAll("button").length).toBe(1);
}

/** Unknown / incomplete is never a favourable status chip and never a bare 0. */
function expectNoGreenNoZero(region: HTMLElement) {
  expect(region.querySelector(".status-chip--on-track, [data-health='on_track']")).toBeNull();
  for (const chip of region.querySelectorAll(".status-chip")) {
    expect(chip.querySelector(".icon"), chip.textContent ?? "").not.toBeNull();
    expect((chip.textContent ?? "").trim()).not.toBe("");
  }
}

// ------------------------------------------------------------------------------------------------ fixtures (SYNTHETIC)
const T = "2026-10-01T09:00:00.000Z";
const sheet = (
  scores: Record<string, number | null>,
  result: Partial<WeightedScoreSheetInput["result"]>,
): WeightedScoreSheetInput => ({
  scores: Object.entries(scores).map(([criterionCode, score]) => ({ criterionCode, score })),
  result: {
    weightSetVersionNo: 1,
    completeness: "complete",
    weightedScore: null,
    weightedScoreDisplay: null,
    display100: null,
    missingCriteria: [],
    computedAt: T,
    ...result,
  },
});
const WEIGHTS = { versionNo: 1, weights: DEFAULT_WEIGHTS_V1 };
const COMPLETE = sheet(
  { strategic_fit: 4, financial_value: 3, customer_impact: 5, feasibility: 2, time_to_value: 3 },
  { weightedScore: "3.5000", weightedScoreDisplay: "3.50", display100: "62.5" },
);
const INCOMPLETE = sheet(
  { strategic_fit: 4, financial_value: null, customer_impact: 5, feasibility: 2, time_to_value: 3 },
  { completeness: "incomplete", missingCriteria: ["financial_value"] },
);

type Series = BenefitValuesInput["series"][number];
const known = (amount: string) => ({ status: "known" as const, amount, currency: "SAR", reason: null });
const line = (id: string, start: string, end: string, amount: string | null): Series["lines"][number] => ({
  periodStart: start,
  periodEnd: end,
  amount,
  kpiValue: null,
  recordType: "benefit_measurement",
  recordId: id,
  basis: "validated",
});
const series = (state: string, lines: Series["lines"], total: Series["total"]): Series => ({
  state,
  total,
  count: lines.length,
  lines,
});
const R = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
function values(over: Partial<Record<string, Series>> = {}): BenefitValuesInput {
  const base: Record<string, Series> = {
    planned: series("planned", [line(R(5), "2026-01-01", "2026-12-31", "900000.0000")], known("900000.0000")),
    validated: series(
      "validated",
      [line(R(1), "2026-01-01", "2026-03-31", "100000.0000"), line(R(2), "2026-04-01", "2026-06-30", "250000.5000")],
      known("350000.5000"),
    ),
    sustained: series("sustained", [line(R(3), "2025-10-01", "2025-12-31", "50000.0000")], known("50000.0000")),
    submitted: series("submitted", [line(R(4), "2026-07-01", "2026-09-30", "75000.0000")], known("75000.0000")),
    ...over,
  };
  return { benefitId: R(9), currency: "SAR", series: Object.values(base) };
}

const BC = "00000000-0000-4000-8000-0000000000c1";
const FLOWS: CashFlowsInput = {
  businessCaseId: BC,
  currency: "SAR",
  revision: 2,
  rows: [
    { periodIndex: 0, outflow: "1000.0000", inflow: "0.0000" },
    { periodIndex: 1, outflow: "0.0000", inflow: "600.0000" },
    { periodIndex: 2, outflow: "0.0000", inflow: "600.0000" },
  ],
};
const METRICS: FinancialMetricsInput = {
  businessCaseId: BC,
  status: "shown",
  currency: "SAR",
  npv: "37.57",
  npvReason: null,
  roi: "0.200000",
  roiReason: null,
  paybackPeriodIndex: 2,
  paybackReason: null,
  assumptions: { timing: "end_of_period", periodBasis: "annual", discountRate: "0.1", methodologyNote: "Synthetic" },
  cashFlowRevision: 2,
};

const SV1 = "00000000-0000-4000-8000-0000000000e1";
const SCHEME: HealthSchemeVersionInput = {
  versionId: SV1,
  versionNo: 1,
  scoreBasis: "points",
  questionCount: 25,
  responses: [
    { key: "yes", credit: "1" },
    { key: "no", credit: "0" },
  ],
  bands: [
    { key: "b0152_21_25", minScore: "21", origin: "source" },
    { key: "b0152_16_20", minScore: "16", origin: "source" },
    { key: "b0152_10_15", minScore: "10", origin: "source" },
    { key: "b0152_0_9", minScore: "0", origin: "source" },
  ],
};
const CODES = Array.from({ length: 25 }, (_, i) => `q${String(i + 1).padStart(2, "0")}`);
const repeat = (key: string, n: number) => Array.from({ length: n }, () => key);
const check = (responses: readonly string[], over: Partial<HealthCheckInput> = {}): HealthCheckInput => ({
  id: "00000000-0000-4000-8000-0000000000d1",
  schemeVersionId: SV1,
  schemeVersionNo: 1,
  assessmentDate: "2026-10-15",
  completion: { answered: responses.length, total: 25, complete: responses.length === 25 },
  score: null,
  scoreMax: null,
  band: null,
  scoringAssumption: true,
  answers: responses.map((response, i) => ({ questionCode: CODES[i]!, response })),
  ...over,
});

// ------------------------------------------------------------------------------------------------ E1
describe("E1 weighted score panel (acceptance: plain-language explanation in en and ar)", () => {
  for (const locale of LOCALES)
    it(`complete (${locale}): the formula in words, one row per criterion, the sum, version and period`, () => {
      const { container } = inLocale(locale, <WeightedScoreExplanation sheet={COMPLETE} weightSet={WEIGHTS} />);
      expect(container.querySelector("[data-explanation-state]")!.getAttribute("data-explanation-state")).toBe(
        "complete",
      );
      // Closed by default: only the button.
      expect(screen.queryByText(ex(locale).weightedScore.formula)).toBeNull();
      const region = open(locale, ex(locale).weightedScore.value);
      const r = within(region);
      expect(r.getByText(ex(locale).weightedScore.formula)).toBeTruthy();
      expect(r.getByText(ex(locale).panel.formula)).toBeTruthy();
      expect(r.getByText(ex(locale).panel.period)).toBeTruthy();
      expect(r.getByText(ex(locale).panel.version)).toBeTruthy();
      expect(region.querySelector("[data-explanation-version]")!.textContent).toBe(
        ex(locale).weightedScore.version.replace("{{n}}", "1"),
      );
      expect(region.querySelectorAll("tbody tr").length).toBe(5);
      // Contributions are the view model's decimals (score × weight ÷ 100), displayed in LTR isolates.
      const contributions = [...region.querySelectorAll("tbody tr td:last-child bdi")].map((b) => b.textContent);
      expect(contributions).toEqual(["1.00", "0.75", "1.00", "0.30", "0.45"]);
      expect(region.querySelector("tfoot")!.textContent).toContain("3.50");
      expect(region.querySelector("tfoot")!.textContent).toContain(ex(locale).weightedScore.sum);
      expect(region.textContent).toContain("62.5");
      expect(region.querySelector("bdi")!.getAttribute("dir")).toBe("ltr");
      expectReadOnly(container);
    });

  for (const locale of LOCALES)
    it(`incomplete (${locale}): names the missing criterion, no sum, never 0 or green`, () => {
      const { container } = inLocale(locale, <WeightedScoreExplanation sheet={INCOMPLETE} weightSet={WEIGHTS} />);
      const region = open(locale, ex(locale).weightedScore.value);
      const criterion = catalogues[locale].prioritization.criterion.financial_value;
      expect(region.querySelector("[data-explanation-state-text]")!.textContent).toContain(criterion);
      expect(region.querySelector("tfoot")).toBeNull();
      expect(region.querySelector("[data-explanation-state='incomplete']")!.textContent).toContain(
        ex(locale).panel.state.incomplete,
      );
      const missingRow = region.querySelector("tr[data-row='financial_value']")!;
      expect(missingRow.textContent).toContain(ex(locale).weightedScore.noScore);
      for (const td of region.querySelectorAll("tbody td")) expect(td.textContent?.trim()).not.toMatch(/^0(\.0+)?$/);
      expectNoGreenNoZero(region);
      expectReadOnly(container);
    });

  it("unknown when the weight set is another version: the reason, no rows", () => {
    inLocale("en", <WeightedScoreExplanation sheet={COMPLETE} weightSet={{ ...WEIGHTS, versionNo: 2 }} />);
    const region = open("en", ex("en").weightedScore.value);
    expect(region.textContent).toContain(ex("en").reason.explain__weight_set_version_mismatch);
    expect(region.querySelectorAll("tbody tr").length).toBe(0);
    expectNoGreenNoZero(region);
  });
});

// ------------------------------------------------------------------------------------------------ E2
describe("E2 benefit realized value panel (acceptance: plain-language explanation in en and ar)", () => {
  for (const locale of LOCALES)
    it(`(${locale}) the formula in words; validated, sustained and pending kept apart, each with its lines`, () => {
      const { container } = inLocale(locale, <BenefitRealizedExplanation values={values()} kpiActual={null} />);
      const region = open(locale, ex(locale).benefitRealized.value);
      expect(within(region).getByText(ex(locale).benefitRealized.formula)).toBeTruthy();
      const captions = [...region.querySelectorAll("caption")].map((c) => c.textContent);
      expect(captions).toEqual([
        ex(locale).benefitRealized.group.validated,
        ex(locale).benefitRealized.group.sustained,
        ex(locale).benefitRealized.group.pending,
      ]);
      const totals = [...region.querySelectorAll("[data-total]")].map((t) => [
        t.getAttribute("data-total"),
        t.textContent,
      ]);
      expect(totals.map(([k]) => k)).toEqual(["validated", "sustained", "pending"]);
      // The three totals are the server's, each in its own group; never added together.
      expect(totals[0]![1]).toMatch(/350,000\.50/);
      expect(totals[1]![1]).toMatch(/50,000\.00/);
      expect(totals[2]![1]).toMatch(/75,000\.00/);
      expect(region.textContent).not.toMatch(/475,000|400,000|425,000/);
      // Planned is never realized value.
      expect(region.textContent).not.toMatch(/900,000/);
      // Period: the earliest and latest line periods.
      expect(region.querySelector("[data-explanation-period]")!.textContent).toMatch(/2025/);
      expectReadOnly(container);
    });

  for (const locale of LOCALES)
    it(`(${locale}) a group without lines is "no value yet", never 0; a line without an amount is Unknown`, () => {
      const v = values({
        validated: series("validated", [], known("0.0000")),
        sustained: series("sustained", [line(R(3), "2025-10-01", "2025-12-31", null)], {
          status: "unknown",
          amount: null,
          currency: "SAR",
          reason: "amount_missing",
        }),
      });
      inLocale(locale, <BenefitRealizedExplanation values={v} kpiActual={null} />);
      const region = open(locale, ex(locale).benefitRealized.value);
      const validated = region.querySelector("[data-total='validated']")!;
      expect(validated.textContent).toContain(ex(locale).benefitRealized.noLines);
      expect(validated.textContent).not.toMatch(/\b0[.,]00\b/);
      const sustained = region.querySelector("[data-total='sustained']")!;
      expect(sustained.textContent).toContain(catalogues[locale].common.value.unknown);
      expect(region.closest("[data-explanation]")!.getAttribute("data-explanation-state")).toBe("incomplete");
      expectNoGreenNoZero(region);
    });

  it("a non-financial benefit: the KPI-actual words and its value; Unknown when it is stale", () => {
    const na = { status: "not_applicable" as const, amount: null, currency: null, reason: null };
    const v = values({
      validated: series("validated", [], na),
      sustained: series("sustained", [], na),
      submitted: series("submitted", [], na),
    });
    inLocale(
      "en",
      <BenefitRealizedExplanation values={v} kpiActual={{ status: "known", value: "12.5", reason: null }} />,
    );
    let region = open("en", ex("en").benefitRealized.value);
    expect(region.textContent).toContain(ex("en").benefitRealized.formulaNonFinancial);
    expect(region.querySelector("[data-fact='kpiActual']")!.textContent).toContain("12.5");
    cleanup();
    inLocale("ar", <BenefitRealizedExplanation values={v} kpiActual={{ status: "stale", value: null, reason: "x" }} />);
    region = open("ar", ex("ar").benefitRealized.value);
    expect(region.querySelector("[data-fact='kpiActual']")!.textContent).toContain(catalogues.ar.common.status.stale);
    expectNoGreenNoZero(region);
  });
});

// ------------------------------------------------------------------------------------------------ E4
describe("E4 NPV, ROI and payback panel", () => {
  for (const locale of LOCALES)
    it(`(${locale}) the three formulas in words, the per-period rows and the payback row`, () => {
      const { container } = inLocale(locale, <FinancialMetricsExplanation cashFlows={FLOWS} metrics={METRICS} />);
      const region = open(locale, ex(locale).financialMetrics.value);
      for (const k of ["formulaNpv", "formulaRoi", "formulaPayback"] as const)
        expect(within(region).getByText(ex(locale).financialMetrics[k])).toBeTruthy();
      expect(region.querySelectorAll("tbody tr").length).toBe(3);
      expect(region.querySelector("tr[data-row='2'] [data-payback]")).not.toBeNull();
      expect(region.querySelector("tr[data-row='0']")!.textContent).toContain("0.909091");
      expect(region.querySelector("[data-fact='npv']")!.textContent).toMatch(/37\.57/);
      expect(region.querySelector("[data-explanation-version]")!.textContent).toBe(
        ex(locale).financialMetrics.revision.replace("{{n}}", "2"),
      );
      expectReadOnly(container);
    });

  it("incomplete and revision-mismatch states: no rows, a reason, never 0", () => {
    inLocale(
      "en",
      <FinancialMetricsExplanation cashFlows={FLOWS} metrics={{ ...METRICS, status: "cash_flows_missing" }} />,
    );
    let region = open("en", ex("en").financialMetrics.value);
    expect(region.textContent).toContain(ex("en").financialMetrics.incomplete.cash_flows_missing);
    expect(region.querySelectorAll("tbody tr").length).toBe(0);
    expectNoGreenNoZero(region);
    cleanup();
    inLocale("ar", <FinancialMetricsExplanation cashFlows={FLOWS} metrics={{ ...METRICS, cashFlowRevision: 1 }} />);
    region = open("ar", ex("ar").financialMetrics.value);
    expect(region.textContent).toContain(ex("ar").reason.explain__revision_mismatch);
    expectNoGreenNoZero(region);
  });

  it("without a discount rate: no factor and no NPV, labelled, never 0", () => {
    const m = {
      ...METRICS,
      npv: null,
      npvReason: "discount_rate_missing" as const,
      assumptions: { ...METRICS.assumptions!, discountRate: null },
    };
    inLocale("en", <FinancialMetricsExplanation cashFlows={FLOWS} metrics={m} />);
    const region = open("en", ex("en").financialMetrics.value);
    expect(region.querySelector("tr[data-row='0']")!.textContent).toContain(ex("en").financialMetrics.noRate);
    expect(region.querySelector("[data-fact='npv']")!.textContent).toContain(
      catalogues.en.launchHealthP5.finance.reason.discount_rate_missing,
    );
    expectNoGreenNoZero(region);
  });
});

// ------------------------------------------------------------------------------------------------ E5
describe("E5 health check score panel", () => {
  const label = (k: string) => k;
  for (const locale of LOCALES)
    it(`(${locale}) scored: the formula in words, counts, points, score, band, scheme version and date`, () => {
      const band = { key: "b0152_16_20", minScore: "16", rangeLabel: "16–20" };
      const c = check([...repeat("yes", 17), ...repeat("no", 8)], { score: "17", scoreMax: "25", band });
      const { container } = inLocale(
        locale,
        <HealthScoreExplanation check={c} scheme={SCHEME} responseLabel={label} />,
      );
      const region = open(locale, ex(locale).healthScore.value);
      expect(within(region).getByText(ex(locale).healthScore.formula)).toBeTruthy();
      expect(region.querySelector("tr[data-row='yes']")!.textContent).toContain("17");
      expect(region.querySelector("[data-fact='score']")!.textContent).toContain("17");
      expect(region.querySelector("[data-fact='band']")!.textContent).toContain("16–20");
      expect(region.querySelector("[data-explanation-version]")!.textContent).toBe(
        ex(locale).healthScore.scheme.replace("{{n}}", "1"),
      );
      expect(region.querySelector("[data-fact='assumption']")).not.toBeNull();
      expectReadOnly(container);
    });

  it("incomplete: no score and no band while a question is unanswered (never 0)", () => {
    inLocale("ar", <HealthScoreExplanation check={check(repeat("yes", 24))} scheme={SCHEME} responseLabel={label} />);
    const region = open("ar", ex("ar").healthScore.value);
    expect(region.querySelector("[data-fact='score']")).toBeNull();
    expect(region.querySelector("[data-explanation-state-text]")!.textContent).toBe(
      ex("ar").healthScore.incomplete.replace("{{count}}", "1"),
    );
    expectNoGreenNoZero(region);
  });
});

describe("explanations catalogue", () => {
  it("has the same keys in en and ar, Arabic text in Arabic, and the ADR-0061 §8 English words verbatim", () => {
    const flat = (o: unknown, p = ""): Record<string, string> =>
      Object.entries(o as Record<string, unknown>).reduce<Record<string, string>>(
        (acc, [k, v]) => Object.assign(acc, typeof v === "string" ? { [p + k]: v } : flat(v, `${p}${k}.`)),
        {},
      );
    const en = flat(catalogues.en.explanations);
    const ar = flat(catalogues.ar.explanations);
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
    for (const [k, v] of Object.entries(ar)) {
      expect(/[؀-ۿ]/.test(v), k).toBe(true);
      expect(v, k).not.toBe(en[k]);
    }
    expect(en["weightedScore.formula"]).toBe(
      "Weighted score = the sum of each criterion's score (1 to 5) multiplied by its weight, divided by 100. The 0–100 view = (weighted score − 1) ÷ 4 × 100. A missing score makes it incomplete; it is never counted as 0.",
    );
    expect(en["benefitRealized.formula"]).toBe(
      "Validated = the sum of the amounts of this benefit's validated measurements. Sustained and pending (awaiting Finance validation) are summed separately and never added to it. A forecast or a scenario is never realized value.",
    );
  });
});
