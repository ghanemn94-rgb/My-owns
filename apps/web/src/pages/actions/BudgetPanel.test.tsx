// Budget lines on the initiative page (T-DG4-FE-D2; p4-work-split §E.5; ADR-0031 §7, §11; REQ-S09-007 UI half), with
// stubbed responses in English (LTR) and Arabic (RTL). SYNTHETIC data only.
//  - Decimal amounts per currency, never converted; an empty amount and an `unknown` total are Unknown with the reason
//    (missing amounts: the known part and the count), never 0; no line at all: "No budget lines" (no_budget_lines).
//  - Writes: create, edit (If-Match = the version seen; only changed members) and archive (If-Match, reason). A stale
//    version is a 409 conflict: nothing saved, the lines re-read. Every refusal code is translated. AUD: read-only.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { budgetLine as budgetLineSchema, initiativeExecution } from "@mth/shared/schemas";
import { createI18n } from "../../i18n/index.ts";
import { problem, route } from "../../test/fixtures.tsx";
import { budgetLineBody } from "./BudgetPanel.tsx";
import { INI_2, LINE_ID, LINE_USD, NO_LINES, budgetLine, execution, renderInitiative } from "./executionFixtures.ts";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const LEAD = ["budget.edit", "roadmap.edit"] as const;
const LINES_PATH = new RegExp(`/api/v1/initiatives/${INI_2}/budget-lines$`);
const LINE_PATH = new RegExp(`/api/v1/budget-lines/${LINE_ID}$`);

const BUDGET_CODES = [
  "budget_line.amount_invalid",
  "budget_line.period_invalid",
  "budget_line.archived",
  "budget_line.duplicate",
  "initiative_schedule.exists",
];

describe("fixtures follow the contract", () => {
  it("budget line and execution fixtures parse with the shared zod mirrors", () => {
    expect(budgetLineSchema.safeParse(budgetLine()).success).toBe(true);
    expect(initiativeExecution.safeParse(execution()).success).toBe(true);
    expect(initiativeExecution.safeParse(NO_LINES).success).toBe(true);
  });

  it("builds bodies: decimal strings, empty = null (Unknown), the month as its first day, only changed members", () => {
    expect(
      budgetLineBody(
        { label: "L", periodMonth: "2026-11", budgetAmount: "0.1", actualAmount: "", forecastAmount: "" },
        null,
      ),
    ).toEqual({ label: "L", periodMonth: "2026-11-01", budgetAmount: "0.1" });
    expect(budgetLineBody({ label: "L", budgetAmount: "1,000" }, null)).toEqual({
      fieldErrors: { budgetAmount: "budget_line.amount_invalid" },
    });
    expect(budgetLineBody({ label: "L", budgetAmount: "-1" }, null)).toEqual({
      fieldErrors: { budgetAmount: "budget_line.amount_invalid" },
    });
    expect(budgetLineBody({ label: "L", periodMonth: "2026-13" }, null)).toEqual({
      fieldErrors: { periodMonth: "budget_line.period_invalid" },
    });
    const line = budgetLine();
    expect(
      budgetLineBody(
        {
          label: line.label,
          periodMonth: "",
          budgetAmount: "100000.0000",
          actualAmount: "",
          forecastAmount: "",
          ownerUserId: line.ownerUserId!,
          note: "",
        },
        line,
      ),
    ).toEqual({ actualAmount: null });
  });
});

describe.each(["en", "ar"] as const)("budget panel (%s)", (locale) => {
  const t = createI18n(locale).t;

  it("translates every budget and schedule refusal code (ADR-0031 §11)", () => {
    const key = (c: string) => `problems.${c.replace(/\./g, "__")}`;
    expect(BUDGET_CODES.filter((c) => !t(key(c), { defaultValue: "" }))).toEqual([]);
    if (locale === "ar") for (const c of BUDGET_CODES) expect(t(key(c)), c).toMatch(/[؀-ۿ]/);
  });

  it("lines in their own currency with Unknown for an empty amount; totals per currency, Unknown with reason", async () => {
    renderInitiative(locale, [...LEAD], [], {
      lines: [
        budgetLine(),
        budgetLine({
          id: LINE_USD,
          label: "Synthetic cloud credits",
          currency: "USD",
          budgetAmount: "500.0000",
          actualAmount: null,
          forecastAmount: "450.0000",
        }),
      ],
    });
    const table = await screen.findByRole("table", { name: t("executionP4.budget.tableTitle") });
    const sar = table.querySelector("[data-budget-line='Synthetic vendor licences']")!.closest("tr")!;
    expect(sar.querySelector("[data-amount-of='budget'] [data-amount='100000.0000']")!.textContent).toContain("SAR");
    expect(sar.querySelector("[data-amount-of='forecast'] [data-health='unknown']")).toBeTruthy();
    expect(sar.querySelector("[data-amount-of='forecast']")!.textContent).not.toMatch(/(^|\D)0(\D|$)/);
    const usd = table.querySelector("[data-budget-line='Synthetic cloud credits']")!.closest("tr")!;
    expect(usd.querySelector("[data-amount-of='budget']")!.textContent).toContain("USD");
    expect(usd.querySelector("[data-amount-of='actual'] [data-health='unknown']")).toBeTruthy();
    // Totals: one table per currency, never converted or summed across currencies.
    const sarTotals = await screen.findByRole("table", {
      name: t("executionP4.budget.totals.caption", { currency: "SAR" }),
    });
    const usdTotals = screen.getByRole("table", { name: t("executionP4.budget.totals.caption", { currency: "USD" }) });
    expect(sarTotals.querySelector("[data-total='budget'] [data-amount='100000.3000']")).toBeTruthy();
    expect(sarTotals.querySelector("[data-total='actual'] [data-amount='0.3000']")).toBeTruthy();
    const forecast = sarTotals.querySelector("[data-total='forecast']")!;
    expect(forecast.getAttribute("data-status")).toBe("unknown");
    expect(forecast.querySelector("[data-unknown-reason='missing_amounts'] [data-health='unknown']")).toBeTruthy();
    expect(forecast.textContent).toContain(t("executionP4.budget.totals.missing", { n: 1 }));
    expect(forecast.querySelector("[data-known-part='2500.0000'] [data-amount='2500.0000']")).toBeTruthy();
    expect(sarTotals.querySelector("[data-total='forecastVariance']")!.textContent).toContain(
      t("executionP4.budget.totals.noneKnown"),
    );
    expect(usdTotals.querySelector("[data-total='forecast'] [data-amount='450.0000']")!.textContent).toContain("USD");
    expect(usdTotals.textContent).not.toContain("SAR");
  });

  it("no active line: the budget is Unknown 'No budget lines' (no_budget_lines), never a total of 0", async () => {
    renderInitiative(locale, [...LEAD], [], { execution: NO_LINES, lines: [] });
    const none = await waitFor(() => {
      const el = document.querySelector("[data-budget-totals='none']");
      expect(el).toBeTruthy();
      return el!;
    });
    expect(none.getAttribute("data-reason")).toBe("no_budget_lines");
    expect(none.querySelector("[data-health='unknown']")).toBeTruthy();
    expect(none.textContent).toContain(t("executionP4.budget.totals.noLinesBody"));
    expect(none.textContent).not.toMatch(/\d/);
    expect(await screen.findByText(t("executionP4.budget.emptyBody"))).toBeTruthy();
  });

  it("create: decimal strings, empty amounts omitted (Unknown), an invalid amount is refused inline with the §11 text", async () => {
    const api = renderInitiative(
      locale,
      [...LEAD],
      [route("POST", LINES_PATH, () => ({ status: 201, body: budgetLine({ version: 1 }) }))],
    );
    fireEvent.click(await screen.findByRole("button", { name: t("executionP4.budget.add") }));
    const dialog = await screen.findByRole("dialog");
    const set = (name: string, value: string) =>
      fireEvent.change(dialog.querySelector(`[data-field='${name}']`)!, { target: { value } });
    set("label", "Synthetic integration partner");
    set("periodMonth", "2026-11");
    set("budgetAmount", "1,000");
    fireEvent.click(within(dialog).getByRole("button", { name: t("executionP4.budget.add") }));
    expect(await within(dialog).findByText(t("problems.budget_line__amount_invalid"))).toBeTruthy();
    expect(api.requests.some((r) => r.method === "POST")).toBe(false);
    set("budgetAmount", "0.1");
    set("forecastAmount", "0.2");
    fireEvent.click(within(dialog).getByRole("button", { name: t("executionP4.budget.add") }));
    await waitFor(() => expect(api.requests.some((r) => r.method === "POST")).toBe(true));
    const post = api.requests.find((r) => r.method === "POST")!;
    expect(post.body).toMatchObject({
      label: "Synthetic integration partner",
      periodMonth: "2026-11-01",
      budgetAmount: "0.1",
      forecastAmount: "0.2",
    });
    expect(post.body).not.toHaveProperty("actualAmount");
    expect(post.headers["if-match"]).toBeUndefined();
  });

  it("a refusal is translated: 409 budget_line.duplicate on create keeps the dialog with the §11 text", async () => {
    renderInitiative(
      locale,
      [...LEAD],
      [
        route("POST", LINES_PATH, () =>
          problem(409, "budget_line.duplicate", {
            type: "urn:mth:problem:duplicate",
            detail: "An active budget line…",
          }),
        ),
      ],
    );
    fireEvent.click(await screen.findByRole("button", { name: t("executionP4.budget.add") }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(dialog.querySelector("[data-field='label']")!, { target: { value: "Synthetic vendor licences" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("executionP4.budget.add") }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.getAttribute("data-problem")).toBe("budget_line.duplicate");
    expect(alert.textContent).toContain(t("problems.budget_line__duplicate"));
  });

  it("edit sends only the changed member with If-Match of the version seen; a stale version is a 409 (nothing saved, lines re-read)", async () => {
    let patches = 0;
    const api = renderInitiative(
      locale,
      [...LEAD],
      [
        route("PATCH", LINE_PATH, () => {
          patches += 1;
          return problem(409, "version_conflict", { currentVersion: 4 });
        }),
      ],
    );
    const table = await screen.findByRole("table", { name: t("executionP4.budget.tableTitle") });
    fireEvent.click(within(table).getByRole("button", { name: new RegExp(t("executionP4.budget.edit")) }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.querySelector("[data-edit-version='3']")).toBeTruthy();
    fireEvent.change(dialog.querySelector("[data-field='actualAmount']")!, { target: { value: "" } });
    const listReads = () => api.requests.filter((r) => r.method === "GET" && /budget-lines\?/.test(r.url)).length;
    const before = listReads();
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.action.save") }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.getAttribute("data-state")).toBe("conflict");
    expect(alert.textContent).toContain(t("myWork.ui.conflictReloaded"));
    const patch = api.requests.find((r) => r.method === "PATCH")!;
    expect(patch.headers["if-match"]).toBe('"3"');
    expect(patch.body).toEqual({ actualAmount: null });
    expect(patches).toBe(1);
    await waitFor(() => expect(listReads()).toBeGreaterThan(before));
  });

  it("archive sends the reason with If-Match; 422 budget_line.archived is translated in the dialog", async () => {
    const api = renderInitiative(
      locale,
      [...LEAD],
      [
        route("POST", new RegExp(`/api/v1/budget-lines/${LINE_ID}/archive$`), () =>
          problem(422, "budget_line.archived", { type: "urn:mth:problem:business-rule" }),
        ),
      ],
    );
    const table = await screen.findByRole("table", { name: t("executionP4.budget.tableTitle") });
    fireEvent.click(within(table).getByRole("button", { name: new RegExp(t("executionP4.budget.archive")) }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Synthetic duplicate line" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("executionP4.budget.archiveConfirm") }));
    expect(await within(dialog).findByText(t("problems.budget_line__archived"))).toBeTruthy();
    const post = api.requests.find((r) => r.method === "POST")!;
    expect(post.headers["if-match"]).toBe('"3"');
    expect(post.body).toEqual({ reason: "Synthetic duplicate line" });
  });

  it("the auditor (no budget.edit) sees the panel read-only: no add, edit or archive control", async () => {
    renderInitiative(locale, []);
    const table = await screen.findByRole("table", { name: t("executionP4.budget.tableTitle") });
    const section = document.getElementById("budget-lines")!;
    expect(section.querySelector("[data-state='panel-read-only']")!.textContent).toContain(t("executionP4.readOnly"));
    expect(within(section).queryByRole("button", { name: t("executionP4.budget.add") })).toBeNull();
    expect(table.querySelector("[data-action='edit-budget-line']")).toBeNull();
    expect(table.querySelector("[data-action='archive-budget-line']")).toBeNull();
    expect(document.body.textContent).not.toMatch(/\bDG[0-7]\b/);
  });
});
