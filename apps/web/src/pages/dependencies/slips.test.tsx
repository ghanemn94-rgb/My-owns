// Critical dependency slips on the Dependencies page (T-DG5-FE-RG1, F-DG5-120; REQ-S12-012; ADR-0044 §7), stubbed API
// (listDependencySlips), English LTR and Arabic RTL. The domain reviewer's reproduction (DEP-01 slipped 5 days; INI-01
// forecast finish 2027-02-25 -> 2027-03-02) as a screen test: the notified owner sees which dependency slipped, by how
// many days, why it is critical and how each dependent initiative's forecast finish moved (before -> after); a
// forecast that could not be computed is Unknown, never blank or 0. SYNTHETIC data.
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DependencySlip } from "@mth/shared/schemas";
import { createI18n } from "../../i18n/index.ts";
import { formatBusinessDate } from "../../lib/format.ts";
import { problem, route } from "../../test/fixtures.tsx";
import { INI, TR, esc, grants, page, renderWorkspace, roadmapView } from "../prioritization/fe-b.fixtures.tsx";
import { forecastChangeDays, slipRows } from "./slips.tsx";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const SLIP: DependencySlip = {
  id: "01a1674a-6771-7116-b437-3f8bacf2bbd8",
  dependencyId: "01995000-1042-7000-8000-000000000001",
  dependencyCode: "DEP-01",
  predecessorFinishBefore: "2026-09-28",
  predecessorFinishAfter: "2026-10-03",
  slipDays: 5,
  neededBy: "2026-10-01",
  criticalReason: "needed_by_breached",
  affected: [
    {
      initiativeId: INI(1),
      initiativeCode: "INI-01",
      ownerUserId: null,
      forecastFinishBefore: "2027-02-25",
      forecastFinishAfter: "2027-03-02",
    },
    {
      initiativeId: INI(2),
      initiativeCode: "INI-02",
      ownerUserId: null,
      forecastFinishBefore: null,
      forecastFinishAfter: null,
    },
  ],
  createdAt: "2026-10-23T05:44:51.734Z",
};

const handlers = (slips: DependencySlip[] | "forbidden") => [
  route("GET", /\/api\/v1\/dependencies\?/, () => page([])),
  route("GET", /\/api\/v1\/dependency-types$/, () => ({ status: 200, body: { items: [] } })),
  route("GET", new RegExp(`${esc(TR)}/roadmap$`), () => ({ status: 200, body: roadmapView({ initiatives: [] }) })),
  route("GET", new RegExp(`${esc(TR)}/dependency-slips(\\?|$)`), () =>
    slips === "forbidden" ? problem(403, "forbidden") : page(slips),
  ),
];

describe("slip rows and the forecast change", () => {
  it("one row per affected initiative; a slip with none keeps one row on the transformation list only", () => {
    expect(slipRows([SLIP]).map((r) => r.affected?.initiativeCode)).toEqual(["INI-01", "INI-02"]);
    expect(slipRows([SLIP], INI(2)).map((r) => r.affected?.initiativeCode)).toEqual(["INI-02"]);
    const none = { ...SLIP, affected: [] };
    expect(slipRows([none]).map((r) => r.affected)).toEqual([null]);
    expect(slipRows([none], INI(1))).toEqual([]);
  });

  it("the change is calendar days when both dates are known, otherwise null (Unknown), never 0", () => {
    expect(forecastChangeDays("2027-02-25", "2027-03-02")).toBe(5);
    expect(forecastChangeDays("2027-02-25", "2027-02-25")).toBe(0);
    expect(forecastChangeDays(null, "2027-03-02")).toBeNull();
    expect(forecastChangeDays("2027-02-25", null)).toBeNull();
  });
});

describe.each(["en", "ar"] as const)("critical dependency slips on the Dependencies page (%s)", (locale) => {
  const { t } = createI18n(locale);

  it("names the dependency, the slip in days, the reason and each dependent's forecast finish before -> after", async () => {
    renderWorkspace("dependencies", locale, grants([]), handlers([SLIP]));
    const section = await waitFor(() => {
      const s = document.querySelector<HTMLElement>("[data-dependency-slips='transformation']");
      expect(s).toBeTruthy();
      return s!;
    });
    expect(screen.getByRole("heading", { level: 2, name: t("dependencies.slips.title") })).toBeTruthy();
    expect(section.textContent).toContain("DEP-01");
    expect(section.querySelector("[data-slip-days='5']")?.textContent).toBe("5");
    expect(section.textContent).toContain(t("dependencies.slips.reason.needed_by_breached"));
    // INI-01 moved 2027-02-25 -> 2027-03-02 (+5), in the reader's locale.
    const ini01 = section.querySelector<HTMLElement>("[data-before-after='forecast-INI-01']")!;
    expect(ini01.textContent).toContain(formatBusinessDate("2027-02-25", locale)!);
    expect(ini01.textContent).toContain(formatBusinessDate("2027-03-02", locale)!);
    expect(ini01.textContent).toContain(t("dependencies.slips.changedTo"));
    expect(section.querySelector("[data-change-days='5']")?.textContent).toBe("+5");
    // INI-02's forecast could not be computed: Unknown on both sides and for the change, never blank or 0.
    const ini02 = section.querySelector<HTMLElement>("[data-before-after='forecast-INI-02']")!;
    expect(within(ini02).getAllByText(t("common.value.unknown"))).toHaveLength(2);
    const row02 = ini02.closest("tr")!;
    expect(row02.querySelectorAll("[data-health='unknown']").length).toBe(3);
    expect(row02.querySelector("[data-change-days]")).toBeNull();
    // The predecessor's finish moved 2026-09-28 -> 2026-10-03; the needed-by date is shown.
    const pred = section.querySelector<HTMLElement>("[data-before-after='predecessor-DEP-01']")!;
    expect(pred.textContent).toContain(formatBusinessDate("2026-10-03", locale)!);
    expect(section.textContent).toContain(formatBusinessDate("2026-10-01", locale)!);
    // The initiative links to its page.
    const link = within(section).getAllByRole("link", { name: "INI-01" })[0]!;
    expect(link.getAttribute("href")).toMatch(new RegExp(`/initiatives/${INI(1)}$`));
  });

  it("no slip: the empty state, not an empty table", async () => {
    renderWorkspace("dependencies", locale, grants([]), handlers([]));
    expect(await screen.findByText(t("dependencies.slips.empty"))).toBeTruthy();
  });

  it("a refused read: the no-permission state inside the section, the rest of the page still renders", async () => {
    renderWorkspace("dependencies", locale, grants([]), handlers("forbidden"));
    const section = await waitFor(() => {
      const s = document.getElementById("dependency-slips");
      expect(s?.querySelector("[data-state='no-permission']")).toBeTruthy();
      return s!;
    });
    expect(section.querySelector("table")).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: t("dependencies.map.title") })).toBeTruthy();
  });
});
