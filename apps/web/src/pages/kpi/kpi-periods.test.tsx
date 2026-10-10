// KPI update periods (T-DG4-FE-R1; KBE-R2; ARCH-R1 item 9; REQ-S07-017 "open KPI, select period"), with stubbed
// responses in English (LTR) and Arabic (RTL). SYNTHETIC data only.
//  - the update form lists periods through listTransformationReportingPeriods (transformation.read), open periods of
//    the KPI's frequency only; the organization list (organization.read, 404 to a Lead or KPI owner) is never asked;
//  - a Lead or KPI owner can choose an open period that is not the KPI's current one, and the submit carries it;
//  - no open period of the frequency: the form says so (no select); a failed list is an error, never an empty choice.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../../i18n/index.ts";
import { TR_ID, makeMe, mockApi, problem, renderApp, route } from "../../test/fixtures.tsx";
import { TRP, esc, json, p4Handlers, page } from "../my-work/p4fixtures.ts";
import { KPI_ID, dictionaryEntry, kpiStatus, period, submission } from "./kpiFixtures.ts";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const KP = `${TRP}/kpi-definitions/${KPI_ID}`;
const TR_PERIODS = new RegExp(`${esc(TRP)}/reporting-periods(\\?|$)`);
const ORG_PERIODS = /\/api\/v1\/organizations\/[^/]+\/reporting-periods/;
const SEPTEMBER_ID = "01920000-0000-7000-9000-0000000009a1";
const WEEKLY_ID = "01920000-0000-7000-9000-0000000009a2";
const CLOSED_ID = "01920000-0000-7000-9000-0000000009a3";

/** The transformation's periods as the API lists them (latest first); the server filters by status and frequency. */
function listed(url: string) {
  const all = [
    period(), // 2026-10, monthly, open: the KPI's current period
    period({ id: SEPTEMBER_ID, periodLabel: "2026-09", periodStart: "2026-09-01", periodEnd: "2026-09-30" }),
    period({
      id: WEEKLY_ID,
      frequency: "weekly",
      periodLabel: "2026-W40",
      periodStart: "2026-09-28",
      periodEnd: "2026-10-04",
    }),
    period({
      id: CLOSED_ID,
      periodLabel: "2026-08",
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      status: "closed",
    }),
  ];
  const q = new URL(url, "http://x").searchParams;
  return all.filter(
    (p) =>
      (!q.get("status") || p.status === q.get("status")) && (!q.get("frequency") || p.frequency === q.get("frequency")),
  );
}

/** A KPI owner on the transformation only: no organization-level grant (no organization.read). */
const transformationScopedMe = (locale: "en" | "ar") =>
  route("GET", /\/api\/v1\/me$/, () =>
    json(
      makeMe(
        [
          {
            scope: { type: "transformation", id: TR_ID },
            inheritsDownward: false,
            permissions: ["transformation.read", "kpi_actual.submit"],
          },
        ],
        { preferredLocale: locale },
      ),
    ),
  );

describe.each(["en", "ar"] as const)("KPI update periods (%s)", (locale) => {
  const t = createI18n(locale).t;

  it("a Lead or KPI owner chooses an open period that is not the current one, from the transformation's list", async () => {
    const api = mockApi(
      ...p4Handlers(
        locale,
        ["kpi_actual.submit"],
        [
          route("GET", new RegExp(`${esc(KP)}/dictionary-entry$`), () => json(dictionaryEntry())),
          route("GET", new RegExp(`${esc(KP)}/status`), () => json(kpiStatus())),
          route("GET", TR_PERIODS, (req) => page(listed(req.url))),
          route("GET", ORG_PERIODS, () => problem(404, "not_found")),
          route("POST", new RegExp(`${esc(KP)}/actuals$`), () => ({ status: 201, body: submission() })),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/kpis/${KPI_ID}/actuals`, { i18n: createI18n(locale) });
    const form = (await screen.findByText(t("kpiP4.update.step1"))).closest("form")!;
    const select = (await within(form).findByRole("combobox", {
      name: new RegExp(esc(t("kpiP4.field.period"))),
    })) as HTMLSelectElement;
    // open monthly periods only (the KPI is monthly): 2026-10 and 2026-09; not the weekly or the closed one
    const options = [...select.options].filter((o) => o.value !== "").map((o) => o.value);
    expect(options).toEqual([period().id, SEPTEMBER_ID]);
    const asked = api.requests.filter((r) => r.method === "GET" && /reporting-periods/.test(r.url));
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((r) => TR_PERIODS.test(r.url))).toBe(true); // never the organization list
    const q = new URL(asked[0]!.url, "http://x").searchParams;
    expect([q.get("status"), q.get("frequency")]).toEqual(["open", "monthly"]);
    expect(document.querySelector("[data-state='periods-org-only']")).toBeNull();

    fireEvent.change(select, { target: { value: SEPTEMBER_ID } });
    fireEvent.change(within(form).getByRole("textbox", { name: new RegExp(`^${esc(t("kpiP4.field.actual"))}`) }), {
      target: { value: "12.5" },
    });
    fireEvent.click(within(form).getByRole("button", { name: t("kpiP4.update.submit") }));
    await waitFor(() => expect(api.requests.some((r) => r.method === "POST")).toBe(true));
    const post = api.requests.find((r) => r.method === "POST")!;
    expect(post.body).toMatchObject({ reportingPeriodId: SEPTEMBER_ID, dataAsOf: "2026-09-30", action: "submit" });
  });

  it("a transformation-scoped KPI owner (no organization.read) gets the same choice", async () => {
    const handlers = p4Handlers(
      locale,
      [],
      [
        route("GET", new RegExp(`${esc(KP)}/dictionary-entry$`), () => json(dictionaryEntry())),
        route("GET", new RegExp(`${esc(KP)}/status`), () => json(kpiStatus())),
        route("GET", TR_PERIODS, (req) => page(listed(req.url))),
        route("GET", ORG_PERIODS, () => problem(404, "not_found")),
      ],
    );
    mockApi(transformationScopedMe(locale), ...handlers);
    renderApp(`/transformations/${TR_ID}/kpis/${KPI_ID}/actuals`, { i18n: createI18n(locale) });
    const select = (await screen.findByRole("combobox", {
      name: new RegExp(esc(t("kpiP4.field.period"))),
    })) as HTMLSelectElement;
    expect([...select.options].filter((o) => o.value !== "").map((o) => o.value)).toEqual([period().id, SEPTEMBER_ID]);
  });

  it("no open period of the KPI's frequency: the form says so; a failed list is an error, never an empty choice", async () => {
    mockApi(
      ...p4Handlers(
        locale,
        ["kpi_actual.submit"],
        [
          route("GET", new RegExp(`${esc(KP)}/dictionary-entry$`), () => json(dictionaryEntry())),
          route("GET", new RegExp(`${esc(KP)}/status`), () => json(kpiStatus())),
          route("GET", TR_PERIODS, () => page([])),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/kpis/${KPI_ID}/actuals`, { i18n: createI18n(locale) });
    await waitFor(() => expect(document.querySelector("[data-state='no-open-period']")).toBeTruthy());
    expect(document.querySelector("fieldset[data-step='2'] select")).toBeNull();
    cleanup();
    vi.unstubAllGlobals();
    mockApi(
      ...p4Handlers(
        locale,
        ["kpi_actual.submit"],
        [
          route("GET", new RegExp(`${esc(KP)}/dictionary-entry$`), () => json(dictionaryEntry())),
          route("GET", new RegExp(`${esc(KP)}/status`), () => json(kpiStatus())),
          route("GET", TR_PERIODS, () => problem(500, "internal")),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/kpis/${KPI_ID}/actuals`, { i18n: createI18n(locale) });
    const step2 = await waitFor(() => {
      const s = document.querySelector("fieldset[data-step='2']");
      expect(s?.querySelector("[data-state='error']")).toBeTruthy();
      return s!;
    });
    expect(step2.querySelector("select")).toBeNull();
    expect(step2.querySelector("[data-state='no-open-period']")).toBeNull();
  });
});
