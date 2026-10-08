// Business cases (REQ-PB-053/054/055, REQ-S05-005; ADR-0024 §1-§5, §9; T-DG3-FE-C) with STUBBED API responses, in
// English LTR and Arabic RTL. SYNTHETIC data. Covers: the register (levels, Finance states incl. Stale, drafts); the
// ten sections (If-Match, only changed fields, blank rule, 409 conflict panel); totals (gross / cost / net apart,
// Unknown never 0, partial, roll-up); lines with exactly one class and a translated 422; Finance validation as a
// business approval (never the author; translated 403); and the read-only auditor.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { Permission } from "@mth/shared";
import type { BusinessCase, BusinessCaseLine, BusinessCaseTotals } from "@mth/shared/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../../i18n/index.ts";
import {
  BUSINESS_UNIT,
  ORG_ID,
  TR_ID,
  USER_ID,
  makeMe,
  makeTransformation,
  mockApi,
  problem,
  renderApp,
  route,
  type Handler,
} from "../../test/fixtures.tsx";
import { AUDITOR_GRANTS, METHODOLOGY, OTHER_USER, leadGrants } from "../../test/p2fixtures.ts";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = "ar";
  document.documentElement.dir = "rtl";
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Locale = "ar" | "en";
const TR = `/api/v1/transformations/${TR_ID}`;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const page = (items: unknown[]) => ({ status: 200, body: { items, nextCursor: null } });
const CASE_ID = "01920000-0000-7000-a000-00000000bc01";
const INI_CASE_ID = "01920000-0000-7000-a000-00000000bc02";
const LINE_ID = "01920000-0000-7000-a000-00000000b101";
const STAMP = "2026-10-01T08:00:00Z";

const SECTIONS_EMPTY = {
  strategicRationale: null,
  baselineSummary: null,
  valuePoolsSummary: null,
  interventionsSummary: null,
  investmentSummary: null,
  benefitsSummary: null,
  benefitRamp: null,
  recurrenceSummary: null,
  implementationHorizon: null,
  keyAssumptions: null,
  downsideCase: null,
  upsideCase: null,
  benefitOwnerUserId: null,
  initiativeOwnerUserId: null,
  financeValidatorUserId: null,
  decisionAskTypes: [],
  decisionAskText: null,
};

function makeCase(over: Partial<BusinessCase> = {}): BusinessCase {
  return {
    id: CASE_ID,
    organizationId: ORG_ID,
    transformationId: TR_ID,
    code: "BC-01",
    level: "transformation",
    initiativeId: null,
    parentCaseId: null,
    title: "Synthetic transformation case",
    currency: "SAR",
    sections: { ...SECTIONS_EMPTY, strategicRationale: "Synthetic rationale", baselineSummary: "Synthetic baseline" },
    missingSections: ["value_pools", "interventions"],
    baselineValidation: "unvalidated",
    baselineValidatedBy: null,
    baselineValidatedAt: null,
    baselineValidationNote: null,
    status: "draft",
    archivedAt: null,
    archivedBy: null,
    archiveReason: null,
    version: 3,
    createdAt: STAMP,
    createdBy: OTHER_USER,
    updatedAt: STAMP,
    updatedBy: OTHER_USER,
    ...over,
  };
}

function makeLine(over: Partial<BusinessCaseLine> = {}): BusinessCaseLine {
  return {
    id: LINE_ID,
    organizationId: ORG_ID,
    transformationId: TR_ID,
    businessCaseId: CASE_ID,
    lineKind: "investment",
    class: "capex",
    valueBasis: "cash",
    title: "Synthetic platform licence",
    description: null,
    amount: "1250000.5",
    currency: "SAR",
    fte: null,
    periodStart: null,
    periodEnd: null,
    recurrence: "one_off",
    benefitFormulaId: null,
    ownerUserId: null,
    status: "active",
    archivedAt: null,
    archivedBy: null,
    archiveReason: null,
    version: 1,
    createdAt: STAMP,
    createdBy: OTHER_USER,
    updatedAt: STAMP,
    updatedBy: OTHER_USER,
    ...over,
  };
}

const money = (amount: string | null, unknownLineCount = 0, lineCount = 1) => [
  { currency: "SAR", amount, unknownLineCount, lineCount },
];

function makeTotals(over: Partial<BusinessCaseTotals> = {}): BusinessCaseTotals {
  return {
    businessCaseId: CASE_ID,
    includedCaseIds: [CASE_ID, INI_CASE_ID],
    grossBenefits: [],
    grossBenefitsByClass: {},
    grossBenefitsByValueBasis: {},
    implementationCost: money("1250000.5"),
    implementationCostCash: money("1250000.5"),
    implementationCostNonCash: [],
    netValue: money(null),
    nonFinancialBenefitCount: 0,
    warnings: [],
    ...over,
  };
}

const finGrants = (extra: Permission[] = []) => [
  {
    scope: { type: "transformation" as const, id: TR_ID },
    inheritsDownward: false,
    permissions: [
      "organization.read",
      "business_unit.read",
      "transformation.read",
      "finance.validate",
      ...extra,
    ] as Permission[],
  },
];

function render(
  path: string,
  locale: Locale,
  grants: ReturnType<typeof leadGrants> | typeof AUDITOR_GRANTS,
  extra: Handler[] = [],
  data: { cases?: BusinessCase[]; detail?: BusinessCase; lines?: BusinessCaseLine[]; totals?: BusinessCaseTotals } = {},
) {
  const detail = data.detail ?? makeCase();
  const handlers: Handler[] = [
    route("GET", /\/api\/v1\/me$/, () => ({ status: 200, body: makeMe(grants, { preferredLocale: locale }) })),
    route("GET", /\/business-units/, () => page([BUSINESS_UNIT])),
    route("GET", new RegExp(`${esc(TR)}$`), () => ({ status: 200, body: makeTransformation() })),
    route("GET", new RegExp(`${esc(TR)}/methodology$`), () => ({ status: 200, body: METHODOLOGY })),
    ...extra,
    route("GET", /\/api\/v1\/business-cases\?/, () => page(data.cases ?? [detail])),
    route("GET", new RegExp(`/business-cases/${detail.id}$`), () => ({ status: 200, body: detail })),
    route("GET", /\/totals$/, () => ({ status: 200, body: data.totals ?? makeTotals() })),
    route("GET", /\/lines\?/, () => ({ status: 200, body: { items: data.lines ?? [makeLine()] } })),
    (req) => (req.method === "GET" && req.url.startsWith("/api/v1/") ? page([]) : undefined),
  ];
  const api = mockApi(...handlers);
  const i18n = createI18n(locale);
  renderApp(path, { i18n });
  return { api, t: i18n.t.bind(i18n) };
}

const writes = (api: ReturnType<typeof mockApi>) => api.requests.filter((r) => r.method !== "GET");
const DETAIL = `/transformations/${TR_ID}/business-cases/${CASE_ID}`;

describe.each(["en", "ar"] as const)("business cases (%s)", (locale) => {
  it("register: levels, Finance baseline states with text (Stale is never green) and drafts", async () => {
    const cases = [
      makeCase({ baselineValidation: "stale" }),
      makeCase({
        id: INI_CASE_ID,
        code: "BC-02",
        level: "initiative",
        parentCaseId: CASE_ID,
        initiativeId: "01920000-0000-7000-a000-0000000000a1",
        title: "Synthetic initiative case",
        baselineValidation: "validated",
        missingSections: [],
      }),
    ];
    const { t } = render(`/transformations/${TR_ID}/business-cases`, locale, leadGrants(["business_case.edit"]), [], {
      cases,
    });
    expect(await screen.findByRole("heading", { level: 1, name: t("businessCases.title") })).toBeTruthy();
    const table = await screen.findByRole("table", { name: t("businessCases.registerTitle") });
    const stale = within(table).getByText(t("businessCases.finance.state.stale"));
    expect(stale.closest("[data-finance-validation]")!.className).toContain("status-chip--stale");
    expect(stale.closest("[data-finance-validation]")!.className).not.toContain("on-track");
    expect(within(table).getByText(t("businessCases.finance.state.validated"))).toBeTruthy();
    expect(within(table).getAllByText(t("common.recordStatus.draft")).length).toBe(2);
    expect(within(table).getByText(t("businessCases.level.initiative"))).toBeTruthy();
    expect(within(table).getByText(t("businessCases.sections.missingCount", { count: 2 }))).toBeTruthy();
    expect(screen.getByRole("button", { name: t("businessCases.create.action") })).toBeTruthy();
    expect(document.documentElement.dir).toBe(locale === "ar" ? "rtl" : "ltr");
  });

  it("detail: all ten sections, totals with gross / cost / net apart, net Unknown (never 0), roll-up by reference", async () => {
    const { t } = render(DETAIL, locale, leadGrants(["business_case.edit"]));
    const form = await screen.findByRole("button", { name: t("businessCases.sections.save") });
    const sections = form.closest("form")!.querySelectorAll("fieldset[data-section]");
    expect(sections.length).toBe(10);
    const totals = await waitFor(() => {
      const el = document.querySelector<HTMLElement>("[data-totals]");
      expect(el).toBeTruthy();
      return el!;
    });
    expect(within(totals).getByText(t("businessCases.totals.gross"))).toBeTruthy();
    expect(within(totals).getByText(t("businessCases.totals.cost"))).toBeTruthy();
    expect(within(totals).getByText(t("businessCases.totals.net"))).toBeTruthy();
    const net = totals.querySelector("[data-total='net']")!;
    expect(net.querySelector("[data-health='unknown']")).toBeTruthy();
    expect(net.textContent).not.toMatch(/\b0(\.00)?\b/);
    const gross = totals.querySelector("[data-total='gross']")!;
    expect(gross.querySelector("[data-health='unknown']")).toBeTruthy();
    const cost = totals.querySelector("[data-total='cost'] [data-amount]")!;
    expect(cost.getAttribute("data-amount")).toBe("1250000.5");
    expect(cost.textContent).toContain("1,250,000.50");
    expect(totals.querySelector("[data-roll-up='2']")!.textContent).toContain(
      t("businessCases.totals.rollUp", { count: 1 }),
    );
  });

  it("totals: a partial total says how many Unknown lines it leaves out", async () => {
    const { t } = render(DETAIL, locale, leadGrants(["business_case.edit"]), [], {
      totals: makeTotals({ grossBenefits: money("100000", 1, 2), netValue: money("-1150000.5") }),
    });
    const partial = await screen.findByText(t("businessCases.totals.partial", { count: 1 }), { exact: false });
    expect(partial.closest("[data-partial='1']")).toBeTruthy();
  });

  it("sections: saves only the changed section with If-Match; blank text is refused inline and nothing is sent", async () => {
    let body: unknown = null;
    const { api, t } = render(DETAIL, locale, leadGrants(["business_case.edit"]), [
      route("PATCH", new RegExp(`/business-cases/${CASE_ID}$`), (req) => {
        body = req.body;
        return { status: 200, body: makeCase({ version: 4 }) };
      }),
    ]);
    const field = await screen.findByLabelText(t("businessCases.sectionField.valuePoolsSummary"));
    fireEvent.change(field, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: t("businessCases.sections.save") }));
    await waitFor(() => expect(field.getAttribute("aria-invalid")).toBe("true"));
    expect(document.activeElement).toBe(field);
    expect(writes(api)).toEqual([]);
    fireEvent.change(field, { target: { value: "Synthetic value pools" } });
    fireEvent.click(screen.getByRole("button", { name: t("businessCases.sections.save") }));
    await waitFor(() => expect(body).not.toBeNull());
    expect(body).toEqual({ sections: { valuePoolsSummary: "Synthetic value pools" } });
    expect(writes(api)[0]!.headers["if-match"]).toBe('"3"');
    expect(await screen.findByText(t("businessCases.sections.saved"))).toBeTruthy();
  });

  it("sections: a 409 shows the standard conflict panel (nothing saved) with the current values", async () => {
    const { t } = render(DETAIL, locale, leadGrants(["business_case.edit"]), [
      route("PATCH", new RegExp(`/business-cases/${CASE_ID}$`), () =>
        problem(409, "version_conflict", { currentVersion: 5 }),
      ),
    ]);
    const field = await screen.findByLabelText(t("businessCases.sectionField.interventionsSummary"));
    fireEvent.change(field, { target: { value: "Synthetic interventions" } });
    fireEvent.click(screen.getByRole("button", { name: t("businessCases.sections.save") }));
    const panel = await waitFor(() => {
      const el = document.querySelector<HTMLElement>("[data-state='conflict']");
      expect(el).toBeTruthy();
      return el!;
    });
    expect(panel.getAttribute("role")).toBe("alert");
    expect(within(panel).getByText(t("common.conflict.title"))).toBeTruthy();
    expect(within(panel).getByRole("button", { name: t("common.conflict.discard") })).toBeTruthy();
  });

  it("lines: exactly one class from one select; the value basis follows the class; a 422 is translated", async () => {
    let body: Record<string, unknown> | null = null;
    const { api, t } = render(DETAIL, locale, leadGrants(["business_case.edit"]), [
      route("POST", /\/lines$/, (req) => {
        body = req.body as Record<string, unknown>;
        return problem(422, "business_case.line_class_mismatch", {
          detail: "The class capex is not a benefit class.",
          errors: [{ pointer: "/class", code: "business_case.line_class_mismatch", message: "x" }],
        });
      }),
    ]);
    fireEvent.click(await screen.findByRole("button", { name: t("businessCases.line.add.benefit") }));
    const dialog = await screen.findByRole("dialog");
    const cls = within(dialog).getByLabelText(new RegExp(esc(t("businessCases.line.class")))) as HTMLSelectElement;
    expect(cls.multiple).toBe(false);
    expect([...cls.options].map((o) => o.value)).toEqual([
      "revenue",
      "cost_reduction",
      "cost_avoidance",
      "working_capital",
      "strategic_non_financial",
    ]);
    const basis = within(dialog).getByLabelText(
      new RegExp(esc(t("businessCases.line.valueBasis"))),
    ) as HTMLSelectElement;
    expect([...basis.options].map((o) => o.value)).toEqual(["revenue_uplift", "margin_uplift"]);
    fireEvent.change(cls, { target: { value: "cost_avoidance" } });
    expect([...basis.options].map((o) => o.value)).toEqual(["avoided_cost"]);
    fireEvent.change(cls, { target: { value: "strategic_non_financial" } });
    const amount = within(dialog).getByLabelText(
      new RegExp(esc(t("businessCases.line.amountIn", { currency: "SAR" }))),
    ) as HTMLInputElement;
    expect(amount.disabled).toBe(true);
    fireEvent.change(cls, { target: { value: "revenue" } });
    fireEvent.change(within(dialog).getByLabelText(new RegExp(`^${esc(t("businessCases.line.title"))}`)), {
      target: { value: "Synthetic uplift" },
    });
    fireEvent.change(amount, { target: { value: "100000.25" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.action.create") }));
    await waitFor(() => expect(body).not.toBeNull());
    expect(body).toMatchObject({
      lineKind: "benefit",
      class: "revenue",
      valueBasis: "revenue_uplift",
      amount: "100000.25",
    });
    expect(Object.keys(body!).filter((k) => /class/i.test(k))).toEqual(["class"]);
    expect(typeof body!["class"]).toBe("string");
    expect(writes(api)[0]!.headers["idempotency-key"]).toBeTruthy();
    const message = await within(dialog).findByText(t("businessCases.problems.business_case__line_class_mismatch"));
    expect(message).toBeTruthy();
    expect(dialog.textContent).not.toContain("The class capex is not a benefit class.");
  });

  it("Finance validation: a business approval for FIN who did not author the case; If-Match; translated 403", async () => {
    let body: unknown = null;
    const { api, t } = render(DETAIL, locale, finGrants(), [
      route("POST", /\/baseline-validation$/, (req) => {
        body = req.body;
        return problem(403, "finance.validator_is_author", { detail: "Finance validation is done by someone else." });
      }),
    ]);
    fireEvent.click(await screen.findByRole("button", { name: t("businessCases.finance.action") }));
    expect(t("businessCases.finance.action")).toContain(locale === "en" ? "business approval" : "موافقة عمل");
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: t("businessCases.finance.confirm") }));
    await waitFor(() => expect(dialog.querySelector("[aria-invalid='true']")).toBeTruthy());
    expect(writes(api)).toEqual([]);
    fireEvent.click(within(dialog).getByRole("radio", { name: t("businessCases.finance.choice.validated") }));
    fireEvent.change(within(dialog).getByLabelText(new RegExp(esc(t("businessCases.finance.note")))), {
      target: { value: "Synthetic Finance note" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("businessCases.finance.confirm") }));
    await waitFor(() => expect(body).toEqual({ result: "validated", note: "Synthetic Finance note" }));
    expect(writes(api)[0]!.headers["if-match"]).toBe('"3"');
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain(t("businessCases.problems.finance__validator_is_author"));
    expect(alert.textContent).not.toContain("someone else");
    // The sections are read-only for FIN (no business_case.edit).
    expect(screen.queryByRole("button", { name: t("businessCases.sections.save") })).toBeNull();
  });

  it("Finance validation: the case author sees no validate action, only the separation-of-duties note", async () => {
    const { t } = render(DETAIL, locale, finGrants(), [], { detail: makeCase({ createdBy: USER_ID }) });
    expect(await screen.findByText(t("businessCases.finance.authorCannot"))).toBeTruthy();
    expect(screen.queryByRole("button", { name: t("businessCases.finance.action") })).toBeNull();
  });

  it("read-only auditor: the ten sections as text, no enabled write control, the read-only note", async () => {
    const { api, t } = render(DETAIL, locale, AUDITOR_GRANTS, [], {
      detail: makeCase({ baselineValidation: "stale" }),
    });
    await waitFor(() => expect(document.querySelector("[data-state='sections-read-only']")).toBeTruthy());
    expect(document.querySelectorAll("[data-state='sections-read-only'] [data-section]").length).toBe(10);
    expect(document.querySelector("[data-state='read-only']")).toBeTruthy();
    expect(await screen.findByText(t("businessCases.finance.staleBody"))).toBeTruthy();
    const main = document.querySelector("main") ?? document.body;
    const enabled = [...main.querySelectorAll<HTMLElement>("form, input, textarea, select, button")].filter(
      (el) =>
        !(el as HTMLButtonElement).disabled &&
        !el.closest("thead, .register__toolbar, .pager, .column-picker, .app-header, nav"),
    );
    expect(enabled.map((e) => e.textContent ?? e.tagName)).toEqual([]);
    expect(writes(api)).toEqual([]);
  });
});
