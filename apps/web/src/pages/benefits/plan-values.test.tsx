// Plan-value editing (T-DG4-FE-R1; FE-C decision 1) with stubbed responses, in English (LTR) and Arabic (RTL).
// SYNTHETIC data only. KBE-R3 routes getBenefitPlanValue concurrently, so the read is mocked here from the contract
// (openapi.yaml `getBenefitPlanValue`, schema `BenefitPlanValue`):
//  - a planned or forecast line offers Edit to a benefit editor; measured/submitted lines and a reader get none;
//  - Edit reads the record first (the value lines carry no version) and pre-fills the form from that read;
//  - the PATCH carries the read's version as If-Match and only the changed members (minProperties 1);
//  - an unchanged form is refused before any request; a 409 is a conflict (the record is re-read, never overwritten);
//  - a failed read shows the error state, never an editable form with guessed values; focus returns to Edit.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { benefitPlanValue, type BenefitPlanValue, type BenefitValues } from "@mth/shared/schemas";
import { createI18n } from "../../i18n/index.ts";
import { TR_ID, USER_ID, mockApi, problem, renderApp, route } from "../../test/fixtures.tsx";
import { TRP, esc, json, p4Handlers, page } from "../my-work/p4fixtures.ts";
import { planPatch } from "./BenefitPage.tsx";
import { BENEFIT_ID, allocations, benefit, lifecycle, values } from "./benefitsFixtures.ts";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const PLANNED_ID = "01920000-0000-7000-9000-0000000000a1";
const FORECAST_ID = "01920000-0000-7000-9000-0000000000a2";
const MEASURED_ID = "01920000-0000-7000-9000-0000000000a3";
const BP = `${TRP}/benefits/${BENEFIT_ID}`;
const PV_PATH = (id: string) => `${TRP}/benefit-plan-values/${id}`;

function planValue(over: Partial<BenefitPlanValue> = {}): BenefitPlanValue {
  return {
    id: PLANNED_ID,
    benefitId: BENEFIT_ID,
    valueKind: "planned",
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    amount: "10000000.0000",
    kpiValue: null,
    currency: "SAR",
    note: "Synthetic plan from the approved case.",
    version: 4,
    createdAt: "2026-09-01T08:00:00.000Z",
    createdBy: USER_ID,
    updatedAt: "2026-09-02T08:00:00.000Z",
    ...over,
  };
}

/** The value series with one plan-value line in planned and forecast, and a measurement line in measured. */
function valuesWithLines(): BenefitValues {
  const v = values();
  const line = (recordType: "benefit_plan_value" | "benefit_measurement", recordId: string, amount: string) => ({
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    amount,
    kpiValue: null,
    recordType,
    recordId,
    basis: null,
  });
  return {
    ...v,
    series: v.series.map((s) =>
      s.state === "planned"
        ? { ...s, lines: [line("benefit_plan_value", PLANNED_ID, "10000000.0000")] }
        : s.state === "forecast"
          ? { ...s, lines: [line("benefit_plan_value", FORECAST_ID, "999999.0000")] }
          : s.state === "measured"
            ? { ...s, lines: [line("benefit_measurement", MEASURED_ID, "250000.0000")] }
            : s,
    ),
  };
}

const baseRoutes = () => [
  route("GET", new RegExp(`${esc(BP)}$`), () => json(benefit())),
  route("GET", new RegExp(`${esc(BP)}/lifecycle$`), () => json(lifecycle())),
  route("GET", new RegExp(`${esc(BP)}/allocations$`), () => json(allocations())),
  route("GET", new RegExp(`${esc(BP)}/values$`), () => json(valuesWithLines())),
  route("GET", /\/api\/v1\/initiatives\?/, () => page([])),
];

async function valuesTable() {
  return waitFor(() => {
    const v = document.querySelector("[data-values='B01']");
    expect(v).toBeTruthy();
    return v as HTMLElement;
  });
}

describe("planPatch (the PATCH body)", () => {
  const pv = planValue();
  const form = (over: Record<string, string> = {}) => ({
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    amount: "10000000.0000",
    kpiValue: "",
    note: "Synthetic plan from the approved case.",
    ...over,
  });
  it("sends only the changed members", () => {
    expect(planPatch(form({ amount: "12000000" }), pv)).toEqual({ amount: "12000000" });
    expect(planPatch(form({ kpiValue: "0.05" }), pv)).toEqual({ kpiValue: "0.05" });
    expect(planPatch(form({ periodEnd: "2026-06-30", note: "" }), pv)).toEqual({ periodEnd: "2026-06-30", note: null });
  });
  it("refuses an unchanged form, a cleared period, a value-less record and a bad decimal", () => {
    expect(planPatch(form(), pv)).toEqual({ fieldErrors: { periodStart: "validation.empty_patch" } });
    expect(planPatch(form({ periodStart: "" }), pv)).toEqual({ fieldErrors: { periodStart: "validation.required" } });
    expect(planPatch(form({ amount: "" }), pv)).toEqual({ fieldErrors: { amount: "benefit_value.value_required" } });
    expect(planPatch(form({ amount: "1,000" }), pv)).toEqual({ fieldErrors: { amount: "validation.decimal" } });
    expect(planPatch(form({ periodEnd: "2025-12-31" }), pv)).toEqual({
      fieldErrors: { periodEnd: "benefit_value.period_range" },
    });
  });
  it("the mocked read conforms to the contract's zod mirror", () => {
    expect(benefitPlanValue.safeParse(planValue()).success).toBe(true);
  });
});

describe.each(["en", "ar"] as const)("plan-value editing (%s)", (locale) => {
  const t = createI18n(locale).t;

  it("Edit reads getBenefitPlanValue, pre-fills the form and PATCHes the changed member with the read's If-Match", async () => {
    const api = mockApi(
      ...p4Handlers(
        locale,
        ["benefit.edit"],
        [
          ...baseRoutes(),
          route("GET", new RegExp(`${esc(PV_PATH(PLANNED_ID))}$`), () => json(planValue())),
          route("PATCH", new RegExp(`${esc(PV_PATH(PLANNED_ID))}$`), () =>
            json(planValue({ amount: "12000000.0000", version: 5 })),
          ),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/benefits/${BENEFIT_ID}`, { i18n: createI18n(locale) });
    const table = await valuesTable();
    expect(document.documentElement.dir).toBe(locale === "ar" ? "rtl" : "ltr");
    // planned and forecast lines are editable; a measurement line is not
    expect(table.querySelectorAll("[data-action='edit-plan-value']")).toHaveLength(2);
    expect(table.querySelector("[data-series='measured'] [data-action='edit-plan-value']")).toBeNull();
    const edit = table.querySelector("[data-series='planned'] [data-action='edit-plan-value']") as HTMLButtonElement;
    expect(edit.textContent).toContain(t("benefitsP4.values.editPlan"));
    expect(edit.textContent).toContain(t("benefitsP4.state.planned")); // the accessible name names the line
    fireEvent.click(edit);
    const dialog = await screen.findByRole("dialog", { name: t("benefitsP4.values.editPlanTitle") });
    const amount = await waitFor(() => {
      const a = dialog.querySelector("[data-field='amount']") as HTMLInputElement | null;
      expect(a).toBeTruthy();
      return a!;
    });
    expect(amount.value).toBe("10000000.0000");
    expect((dialog.querySelector("[data-field='periodStart']") as HTMLInputElement).value).toBe("2026-01-01");
    expect(dialog.querySelector("[data-field='valueKind']")).toBeNull(); // the kind is fixed after create
    expect(dialog.querySelector("[data-plan-kind='planned']")!.textContent).toContain(
      t("benefitsP4.values.editVersion", { version: 4 }),
    );
    expect(api.requests.filter((r) => r.method === "GET" && r.url.endsWith(PV_PATH(PLANNED_ID)))).toHaveLength(1);
    fireEvent.change(amount, { target: { value: "12000000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.action.save") }));
    await waitFor(() => expect(api.requests.some((q) => q.method === "PATCH")).toBe(true));
    const patch = api.requests.find((q) => q.method === "PATCH")!;
    expect(patch.url).toBe(PV_PATH(PLANNED_ID));
    expect(patch.headers["if-match"]).toBe('"4"');
    expect(patch.body).toEqual({ amount: "12000000" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("an unchanged form sends nothing and says so; Cancel closes", async () => {
    const api = mockApi(
      ...p4Handlers(
        locale,
        ["benefit.edit"],
        [
          ...baseRoutes(),
          route("GET", new RegExp(`${esc(PV_PATH(FORECAST_ID))}$`), () =>
            json(planValue({ id: FORECAST_ID, valueKind: "forecast", amount: "999999.0000", note: null })),
          ),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/benefits/${BENEFIT_ID}`, { i18n: createI18n(locale) });
    const table = await valuesTable();
    fireEvent.click(table.querySelector("[data-series='forecast'] [data-action='edit-plan-value']")!);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.querySelector("[data-plan-kind='forecast']")).toBeTruthy());
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.action.save") }));
    expect(await within(dialog).findByText(t("problems.validation__empty_patch"))).toBeTruthy();
    expect(api.requests.some((q) => q.method === "PATCH")).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.action.cancel") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("a 409 (changed by someone else after the read) is a conflict: the record is re-read, If-Match never moves under the typed values", async () => {
    let reads = 0;
    const api = mockApi(
      ...p4Handlers(
        locale,
        ["benefit.edit"],
        [
          ...baseRoutes(),
          route("GET", new RegExp(`${esc(PV_PATH(PLANNED_ID))}$`), () => {
            reads += 1;
            return json(reads === 1 ? planValue() : planValue({ amount: "11000000.0000", version: 5 }));
          }),
          route("PATCH", new RegExp(`${esc(PV_PATH(PLANNED_ID))}$`), () => problem(409, "version_conflict")),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/benefits/${BENEFIT_ID}`, { i18n: createI18n(locale) });
    const table = await valuesTable();
    fireEvent.click(table.querySelector("[data-series='planned'] [data-action='edit-plan-value']")!);
    const dialog = await screen.findByRole("dialog");
    const amount = await waitFor(() => dialog.querySelector("[data-field='amount']") as HTMLInputElement);
    fireEvent.change(amount, { target: { value: "12500000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.action.save") }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.getAttribute("data-state")).toBe("conflict");
    expect(within(dialog).getAllByRole("alert")).toHaveLength(1);
    await waitFor(() => expect(reads).toBe(2)); // re-read after the conflict
    // the typed value is kept, and a second save still sends the version the user saw (no silent overwrite)
    expect((dialog.querySelector("[data-field='amount']") as HTMLInputElement).value).toBe("12500000");
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.action.save") }));
    await waitFor(() => expect(api.requests.filter((q) => q.method === "PATCH")).toHaveLength(2));
    expect(api.requests.filter((q) => q.method === "PATCH").map((q) => q.headers["if-match"])).toEqual(['"4"', '"4"']);
    // reopening shows the saved values and version of the re-read
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.action.cancel") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(table.querySelector("[data-series='planned'] [data-action='edit-plan-value']")!);
    const again = await screen.findByRole("dialog");
    await waitFor(() =>
      expect((again.querySelector("[data-field='amount']") as HTMLInputElement | null)?.value).toBe("11000000.0000"),
    );
    expect(again.querySelector("[data-plan-kind]")!.textContent).toContain(
      t("benefitsP4.values.editVersion", { version: 5 }),
    );
  });

  it.each([
    [500, "internal", "error"],
    [404, "not_found", "no-permission"],
  ] as const)(
    "a failed read (%s) shows its state in the section and no form; Cancel removes it",
    async (status, code, shown) => {
      const api = mockApi(
        ...p4Handlers(
          locale,
          ["benefit.edit"],
          [...baseRoutes(), route("GET", new RegExp(`${esc(PV_PATH(PLANNED_ID))}$`), () => problem(status, code))],
        ),
      );
      renderApp(`/transformations/${TR_ID}/benefits/${BENEFIT_ID}`, { i18n: createI18n(locale) });
      const table = await valuesTable();
      fireEvent.click(table.querySelector("[data-series='planned'] [data-action='edit-plan-value']")!);
      const state = await waitFor(() => {
        const e = document.querySelector("[data-plan-value-read='error']");
        expect(e).toBeTruthy();
        return e as HTMLElement;
      });
      expect(state.querySelector("[data-state]")!.getAttribute("data-state")).toBe(shown);
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.querySelector("[data-field='amount']")).toBeNull();
      expect(api.requests.some((q) => q.method === "PATCH")).toBe(false);
      fireEvent.click(within(state).getByRole("button", { name: t("common.action.cancel") }));
      await waitFor(() => expect(document.querySelector("[data-plan-value-read]")).toBeNull());
    },
  );

  it("a reader (no benefit.edit) is offered no edit", async () => {
    mockApi(
      ...p4Handlers(
        locale,
        [],
        [...baseRoutes(), route("GET", new RegExp(`${esc(PV_PATH(PLANNED_ID))}$`), () => json(planValue()))],
      ),
    );
    renderApp(`/transformations/${TR_ID}/benefits/${BENEFIT_ID}`, { i18n: createI18n(locale) });
    const table = await valuesTable();
    expect(table.querySelector("[data-series='planned'] li")).toBeTruthy();
    expect(table.querySelectorAll("[data-action='edit-plan-value']")).toHaveLength(0);
  });
});
