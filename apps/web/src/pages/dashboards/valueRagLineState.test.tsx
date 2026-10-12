// F-DG4-143 (D-127; ADR-0037 amendment N4 items 1 and 4; REQ-S13-003 "distinguish zero, unknown and not applicable"):
// a Value RAG line renders by its `status`, not by whether its gap ratio is null. The API sends a null ratio both for a
// `not_applicable` line (nothing planned to date) and for an `unknown` line (a line of the basis has no amount):
//  - `not_applicable` reads 'Not applicable' (data-value-state='not_applicable') with its reason, never Unknown or 0;
//  - `unknown` reads 'Unknown' (data-value-state='unknown') with its reason;
//  - a valued line shows its gap as a percentage.
// On T10 and the Executive Overview, in English (LTR) and Arabic (RTL), with mocked responses. SYNTHETIC data.
import { cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardRag } from "@mth/shared/schemas";
import { createI18n } from "../../i18n/index.ts";
import { TR_ID, mockApi, renderApp, route } from "../../test/fixtures.tsx";
import { TRP, esc, json, p4Handlers } from "../my-work/p4fixtures.ts";
import { N4_VALUE_RAG, n4ExecutiveOverview, n4TransformationDashboard } from "./dashboardFixtures.ts";
import { valueRagLineValue, type ValueRagLine } from "./ui.tsx";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const textOf = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

const NA: ValueRagLine = {
  currency: "SAR",
  headlineBasis: "non_cash",
  gapRatio: null,
  status: "not_applicable",
  reasonKey: "dashboard.value.nothing_planned",
};
const UNKNOWN: ValueRagLine = {
  currency: "USD",
  headlineBasis: "top_line",
  gapRatio: null,
  status: "unknown",
  reasonKey: "benefit.value_amount_missing",
};
const VALUED: ValueRagLine = {
  currency: "SAR",
  headlineBasis: "profit_and_cash",
  gapRatio: "1",
  status: "red",
  reasonKey: null,
};

/** The qa world of F-DG4-143: SAR profit and cash red 100 %, SAR non-cash n/a (avoided cost planned only in 2099). */
const RAG: DashboardRag = {
  ...N4_VALUE_RAG,
  status: "red",
  ruleParams: { amberRatio: "0.05", redRatio: "0.15", lines: [VALUED, NA, UNKNOWN] },
};

describe("valueRagLineValue: the line's status decides its value (F-DG4-143)", () => {
  it("not_applicable -> Not applicable with its reason, never a number", () => {
    expect(valueRagLineValue(NA)).toEqual({
      state: "not_applicable",
      value: null,
      unit: "ratio",
      currency: "SAR",
      reasonKey: "dashboard.value.nothing_planned",
      kpiUnit: null,
    });
    // Even if a ratio were sent with n/a, no number is shown.
    expect(valueRagLineValue({ ...NA, gapRatio: "0" })).toMatchObject({ state: "not_applicable", value: null });
  });
  it("unknown -> Unknown with its reason", () => {
    expect(valueRagLineValue(UNKNOWN)).toEqual({
      state: "unknown",
      value: null,
      unit: "ratio",
      currency: "USD",
      reasonKey: "benefit.value_amount_missing",
      kpiUnit: null,
    });
  });
  it("a valued line shows its ratio; green, amber or red without a ratio is Unknown, never 0", () => {
    expect(valueRagLineValue(VALUED)).toEqual({
      state: "value",
      value: "1",
      unit: "ratio",
      currency: "SAR",
      reasonKey: null,
      kpiUnit: null,
    });
    expect(valueRagLineValue({ ...VALUED, status: "green", gapRatio: null })).toMatchObject({
      state: "unknown",
      value: null,
    });
  });
  it("stale keeps the last known ratio and says Stale", () => {
    expect(valueRagLineValue({ ...VALUED, status: "stale", reasonKey: "x.y" })).toMatchObject({
      state: "stale",
      value: "1",
      reasonKey: "x.y",
    });
  });
});

describe.each(["en", "ar"] as const)("Value RAG lines by status (F-DG4-143) (%s)", (locale) => {
  const t = createI18n(locale).t;

  it.each(["t10", "overview"] as const)(
    "%s: an n/a line reads Not applicable with its reason, an unknown line Unknown, a valued line its gap",
    async (surface) => {
      const t10 = n4TransformationDashboard();
      const ov = n4ExecutiveOverview();
      const withRag = <A extends { code: string; rag: DashboardRag }>(a: A): A =>
        a.code === "value" ? { ...a, rag: RAG } : a;
      mockApi(
        ...p4Handlers(
          locale,
          [],
          [
            route("GET", new RegExp(`${esc(TRP)}/dashboard`), () => json({ ...t10, areas: t10.areas.map(withRag) })),
            route("GET", /\/api\/v1\/overview\?/, () => json({ ...ov, areas: ov.areas.map(withRag) })),
          ],
        ),
      );
      renderApp(surface === "t10" ? `/transformations/${TR_ID}/dashboard` : "/executive-overview", {
        i18n: createI18n(locale),
      });
      await waitFor(() =>
        expect(document.querySelector("section[data-area='value'] [data-value-rag-lines='3']")).not.toBeNull(),
      );
      const lines = document.querySelector<HTMLElement>("section[data-area='value'] [data-value-rag-lines]")!;
      expect(document.documentElement.getAttribute("dir")).toBe(locale === "ar" ? "rtl" : "ltr");

      // not_applicable: 'Not applicable' with its reason; never Unknown, never 0, never green.
      const na = lines.querySelector<HTMLElement>("[data-rag-line-basis='non_cash']")!;
      expect(na.getAttribute("data-rag-line-status")).toBe("not_applicable");
      expect(na.querySelector("[data-value-state='unknown']")).toBeNull();
      const naValue = na.querySelector<HTMLElement>("[data-value-state='not_applicable']")!;
      expect(naValue).not.toBeNull();
      expect(textOf(naValue)).toContain(t("dashboards.state.not_applicable"));
      expect(textOf(naValue)).toContain(t("dashboards.reason.dashboard__value__nothing_planned"));
      expect(textOf(na)).not.toContain(t("dashboards.state.unknown"));
      expect(textOf(na)).not.toMatch(/\d\s?%/);
      expect(na.querySelector("[data-rag='green']")).toBeNull();
      expect(textOf(na.querySelector("[data-rag]"))).toContain(t("dashboards.rag.not_applicable"));
      // The reason is shown once (inside the value), not repeated beside it.
      expect(textOf(na).split(t("dashboards.reason.dashboard__value__nothing_planned")).length).toBe(2);

      // unknown: 'Unknown' with its reason.
      const unk = lines.querySelector<HTMLElement>("[data-rag-line-basis='top_line']")!;
      const unkValue = unk.querySelector<HTMLElement>("[data-value-state='unknown']")!;
      expect(unkValue).not.toBeNull();
      expect(textOf(unkValue)).toContain(t("dashboards.state.unknown"));
      expect(textOf(unkValue)).toContain(t("dashboards.reason.benefit__value_amount_missing"));
      expect(unk.querySelector("[data-value-state='not_applicable']")).toBeNull();
      expect(textOf(unk.querySelector("[data-rag]"))).toContain(t("dashboards.rag.unknown"));

      // valued: the gap as a percentage, with its status.
      const pc = lines.querySelector<HTMLElement>("[data-rag-line-basis='profit_and_cash']")!;
      expect(pc.querySelector("[data-value-state='value']")?.getAttribute("data-value")).toBe("1");
      expect(textOf(pc)).toContain("100 %");
      expect(textOf(pc.querySelector("[data-rag]"))).toContain(t("dashboards.rag.red"));
      expect(pc.getAttribute("data-worst")).toBe("true");
    },
  );
});
