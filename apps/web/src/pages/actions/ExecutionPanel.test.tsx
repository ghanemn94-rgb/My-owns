// The execution view on the initiative page (T-DG4-FE-D2; p4-work-split §E.5; ADR-0031 §7, §13; REQ-S09-007 UI half),
// with stubbed responses in English (LTR) and Arabic (RTL). SYNTHETIC data only.
//  - The working-day slip of the ADR-0031 §7 examples (+5, −5, 0) beside the calendar days; a missing forecast date is
//    Unknown with its reason, never 0 or "on time".
//  - Capacity without a row, a dependency without an impact: Unknown. Critical-path membership: a label when the
//    network is computed; null is Unknown with no critical styling.
//  - The slot: the initiative page lists the three panels in its "on this page" navigation.
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../../i18n/index.ts";
import { route } from "../../test/fixtures.tsx";
import { json } from "../my-work/p4fixtures.ts";
import { INI_2, execution, renderInitiative } from "./executionFixtures.ts";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function executionSection(): Promise<HTMLElement> {
  return waitFor(() => {
    const el = document.querySelector<HTMLElement>("#execution [data-execution]");
    expect(el).toBeTruthy();
    return el!;
  });
}

describe.each(["en", "ar"] as const)("execution panel (%s)", (locale) => {
  const t = createI18n(locale).t;

  it("milestone slip in working days (+5, −5, 0) beside calendar days; a missing date is Unknown with its reason", async () => {
    renderInitiative(locale, []);
    const section = await executionSection();
    const table = within(section).getByRole("table", { name: t("executionP4.execution.milestones.title") });
    const row = (title: string) => within(table).getByText(title).closest("tr")!;
    const late = row("Synthetic design sign-off");
    expect(late.querySelector("[data-slip='5']")!.textContent).toBe(t("executionP4.execution.slip.late", { n: 5 }));
    expect(late.querySelector("[data-calendar-days='7']")).toBeTruthy();
    expect(row("Synthetic pilot launch").querySelector("[data-slip='-5']")!.textContent).toBe(
      t("executionP4.execution.slip.early", { n: 5 }),
    );
    expect(row("Synthetic go-live").querySelector("[data-slip='0']")!.textContent).toBe(
      t("executionP4.execution.slip.onTime"),
    );
    const missing = row("Synthetic data migration");
    const slip = missing.querySelector("[data-slip='unknown']")!;
    expect(slip.getAttribute("data-slip-reason")).toBe("forecast_date_missing");
    expect(slip.querySelector("[data-health='unknown']")).toBeTruthy();
    expect(slip.textContent).toContain(t("executionP4.execution.slip.reason.forecast_date_missing"));
    expect(slip.textContent).not.toMatch(/\d/);
    expect(missing.querySelector("[data-calendar-days]")).toBeNull();
  });

  it("every slip reason is translated (approved date, forecast date, calendar, range)", () => {
    for (const r of ["approved_date_missing", "forecast_date_missing", "calendar_not_configured", "range_too_long"])
      expect(t(`executionP4.execution.slip.reason.${r}`, { defaultValue: "" }), r).not.toBe("");
  });

  it("deliverable acceptance, demand without capacity (Unknown), dependency without impact (Unknown), decisions", async () => {
    renderInitiative(locale, []);
    const section = await executionSection();
    expect(section.querySelector("[data-acceptance='submitted']")!.textContent).toBe(
      t("executionP4.execution.acceptance.submitted"),
    );
    const demand = within(section).getByRole("table", { name: t("executionP4.execution.demand.title") });
    expect(demand.querySelector("[data-fte='1.50']")).toBeTruthy();
    expect(demand.querySelector("[data-capacity='unknown'] [data-health='unknown']")).toBeTruthy();
    const deps = within(section).getByRole("table", { name: t("executionP4.execution.dependencies.title") });
    const dep = within(deps).getByText("DEP-01").closest("tr")!;
    expect(dep.querySelector("[data-health='unknown']")).toBeTruthy();
    expect(dep.textContent).toContain(t("executionP4.execution.dependencies.direction.incoming"));
    const decisions = within(section).getByRole("table", { name: t("executionP4.execution.decisions.title") });
    expect(within(decisions).getByText("Synthetic billing vendor choice")).toBeTruthy();
  });

  it("critical-path membership: a label when computed; null is Unknown with no critical styling", async () => {
    renderInitiative(locale, []);
    let section = await executionSection();
    const on = section.querySelector("[data-on-critical-path='true']")!;
    expect(on.querySelector("[data-critical='true']")!.textContent).toContain(
      t("executionP4.execution.onCriticalPath"),
    );
    cleanup();
    renderInitiative(locale, [], [], { execution: execution({ onCriticalPath: null }) });
    section = await executionSection();
    const unknown = section.querySelector("[data-on-critical-path='unknown']")!;
    expect(unknown.querySelector("[data-health='unknown']")).toBeTruthy();
    expect(unknown.querySelector("[data-critical]")).toBeNull();
    expect(unknown.textContent).not.toContain(t("executionP4.execution.onCriticalPath"));
  });

  it("the initiative page holds the slot: budget lines, execution and schedule network, in its on-this-page navigation", async () => {
    renderInitiative(locale, []);
    await executionSection();
    const nav = screen.getByRole("navigation", { name: t("common.onThisPage") });
    for (const [id, key] of [
      ["budget-lines", "executionP4.budget.title"],
      ["execution", "executionP4.execution.title"],
      ["schedule-network", "executionP4.network.title"],
    ] as const) {
      expect(
        within(nav)
          .getByRole("link", { name: t(key) })
          .getAttribute("href"),
      ).toBe(`#${id}`);
      expect(document.getElementById(id)).toBeTruthy();
    }
    expect(document.querySelector("[data-slot='execution']")).toBeTruthy();
  });
  it("an answer outside the contract is the panel's error state; the rest of the initiative page still renders", async () => {
    renderInitiative(
      locale,
      [],
      [
        route("GET", new RegExp(`/api/v1/initiatives/${INI_2}/execution$`), () =>
          json({ items: [], nextCursor: null }),
        ),
      ],
    );
    await waitFor(() => expect(document.querySelector("#execution [role='alert']")).toBeTruthy());
    expect(document.querySelector("#execution [data-execution]")).toBeNull();
    expect(document.querySelector("#execution")!.textContent).not.toMatch(/(^|\D)0(\D|$)/);
    expect(await screen.findByRole("table", { name: t("executionP4.budget.tableTitle") })).toBeTruthy();
    expect(document.querySelector("#schedule-network [data-network-status='computed']")).toBeTruthy();
  });
});
