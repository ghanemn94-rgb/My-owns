// T09 Benefit Formulas (REQ-PB-055/056/057, REQ-S08-007; ADR-0024 §5-§6; T-DG3-FE-C) with STUBBED API responses, in
// English LTR and Arabic RTL. SYNTHETIC data. Covers: the six T09 columns with confidence H/M/L; the two B0087
// examples marked illustrative with their engine previews (100000 SAR and 500000 SAR per year); the live builder
// (undefined variable and period mismatch shown, translated, with the position, BEFORE saving; nothing sent);
// fractions entered as percent and stored as fractions; fraction_delta shown in percentage points; saving a version
// with If-Match and the 409 conflict panel; Finance validation of a version (business approval, never the author);
// and the read-only auditor.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { Permission } from "@mth/shared";
import type {
  BenefitFormula,
  BenefitFormulaExample,
  BenefitFormulaVersion,
  FormulaVariableView,
} from "@mth/shared/schemas";
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
const F_ID = "01920000-0000-7000-a000-00000000bf01";
const V_ID = "01920000-0000-7000-a000-00000000bf11";
const STAMP = "2026-10-01T08:00:00Z";

const variable = (
  over: Partial<FormulaVariableView> & Pick<FormulaVariableView, "name" | "kind">,
): FormulaVariableView => ({
  unit: null,
  currency: null,
  period: "none",
  value: null,
  description: null,
  source: null,
  ...over,
});

const REVENUE_VARS = [
  variable({ name: "baseline_attach_rate", kind: "fraction", value: "0.1" }),
  variable({ name: "target_attach_rate", kind: "fraction", value: "0.12" }),
  variable({ name: "eligible_customers", kind: "count", period: "year", value: "100000" }),
  variable({ name: "arpu", kind: "currency", currency: "SAR", period: "year", value: "50" }),
];
const COST_VARS = [
  variable({ name: "eligible_volume", kind: "count", period: "year", value: "200000" }),
  variable({ name: "baseline_unit_cost", kind: "currency", currency: "SAR", value: "12.5" }),
  variable({ name: "target_unit_cost", kind: "currency", currency: "SAR", value: "10" }),
];
const REVENUE_EXPR = "(target_attach_rate - baseline_attach_rate) * eligible_customers * arpu";

function example(code: "revenue_uplift" | "cost_reduction"): BenefitFormulaExample {
  const revenue = code === "revenue_uplift";
  return {
    code,
    ordinal: revenue ? 1 : 2,
    sourceBenefitEn: revenue ? "Revenue uplift" : "Cost reduction",
    sourceBaselineDriverEn: revenue ? "Customers × attach rate × ARPU" : "Volume × unit cost",
    sourceChangeAssumptionEn: revenue ? "Attach +X pp" : "Unit cost -X%",
    sourceFormulaEn: revenue ? "Δ attach × customers × ARPU" : "Volume × Δ unit cost",
    sourceRampEn: revenue ? "Q1-Q4" : "Q2-Q3",
    sourceConfidence: revenue ? "M" : "H",
    benefitAr: revenue ? "زيادة الإيرادات" : "خفض التكاليف",
    baselineDriverAr: "محرّك",
    changeAssumptionAr: "افتراض",
    formulaAr: "معادلة",
    expression: revenue ? REVENUE_EXPR : "eligible_volume * (baseline_unit_cost - target_unit_cost)",
    variables: revenue ? REVENUE_VARS : COST_VARS,
    resultKind: "currency",
    resultCurrency: "SAR",
    resultPeriod: "year",
    exampleResult: revenue ? "100000" : "500000",
    isIllustrative: true,
    sourceRef: "B0087",
  };
}

function makeVersion(over: Partial<BenefitFormulaVersion> = {}): BenefitFormulaVersion {
  return {
    id: V_ID,
    formulaId: F_ID,
    versionNo: 1,
    expression: REVENUE_EXPR,
    expressionSha256: "a".repeat(64),
    variables: REVENUE_VARS,
    resultKind: "currency",
    resultUnit: null,
    resultCurrency: "SAR",
    resultPeriod: "year",
    previewResult: "100000",
    engineVersion: "mth-formula/1.0.0",
    changeNote: null,
    validationStatus: "unvalidated",
    validatedBy: null,
    validatedAt: null,
    validationNote: null,
    version: 1,
    createdAt: STAMP,
    createdBy: OTHER_USER,
    ...over,
  };
}

function makeFormula(over: Partial<BenefitFormula> = {}): BenefitFormula {
  return {
    id: F_ID,
    organizationId: ORG_ID,
    transformationId: TR_ID,
    code: "BF-01",
    benefitName: "Synthetic revenue uplift",
    baselineDriver: "Customers × attach rate × ARPU",
    changeAssumption: "Attach +2 pp",
    ramp: "Q1-Q4",
    confidence: "M",
    ownerUserId: null,
    currentVersionNo: 1,
    currentVersion: makeVersion(),
    isIllustrative: true,
    exampleCode: "revenue_uplift",
    status: "active",
    archivedAt: null,
    archivedBy: null,
    archiveReason: null,
    version: 2,
    createdAt: STAMP,
    createdBy: OTHER_USER,
    updatedAt: STAMP,
    updatedBy: OTHER_USER,
    ...over,
  };
}

const finGrants = () => [
  {
    scope: { type: "transformation" as const, id: TR_ID },
    inheritsDownward: false,
    permissions: ["organization.read", "business_unit.read", "transformation.read", "finance.validate"] as Permission[],
  },
];

function render(
  path: string,
  locale: Locale,
  grants: ReturnType<typeof leadGrants> | typeof AUDITOR_GRANTS,
  extra: Handler[] = [],
  formula: BenefitFormula = makeFormula(),
) {
  const handlers: Handler[] = [
    route("GET", /\/api\/v1\/me$/, () => ({ status: 200, body: makeMe(grants, { preferredLocale: locale }) })),
    route("GET", /\/business-units/, () => page([BUSINESS_UNIT])),
    route("GET", new RegExp(`${esc(TR)}$`), () => ({ status: 200, body: makeTransformation() })),
    route("GET", new RegExp(`${esc(TR)}/methodology$`), () => ({ status: 200, body: METHODOLOGY })),
    ...extra,
    route("GET", /\/benefit-formula-examples$/, () => ({
      status: 200,
      body: { items: [example("revenue_uplift"), example("cost_reduction")] },
    })),
    route("GET", /\/api\/v1\/benefit-formulas\?/, () => page([formula])),
    route("GET", new RegExp(`/benefit-formulas/${F_ID}$`), () => ({ status: 200, body: formula })),
    route("GET", /\/versions$/, () => ({
      status: 200,
      body: { items: formula.currentVersion ? [formula.currentVersion] : [] },
    })),
    (req) => (req.method === "GET" && req.url.startsWith("/api/v1/") ? page([]) : undefined),
  ];
  const api = mockApi(...handlers);
  const i18n = createI18n(locale);
  renderApp(path, { i18n });
  return { api, t: i18n.t.bind(i18n) };
}

const writes = (api: ReturnType<typeof mockApi>) => api.requests.filter((r) => r.method !== "GET");
const LIST = `/transformations/${TR_ID}/benefit-formulas`;
const DETAIL = `${LIST}/${F_ID}`;
const LEAD = () => leadGrants(["benefit_formula.edit"]);

/** The builder's formula textarea, checked to carry its visible label. */
async function builderExpression(label: string): Promise<HTMLTextAreaElement> {
  const el = await waitFor(() => {
    const x = document.querySelector<HTMLTextAreaElement>("[data-formula-builder] textarea[dir='ltr']");
    expect(x).toBeTruthy();
    return x!;
  });
  expect(document.querySelector(`label[for='${el.id}']`)!.textContent).toContain(label);
  return el;
}

async function liveCheck(): Promise<HTMLElement> {
  return waitFor(() => {
    const el = document.querySelector<HTMLElement>("[data-formula-builder] [data-live-check]");
    expect(el).toBeTruthy();
    return el!;
  });
}

describe.each(["en", "ar"] as const)("T09 benefit formulas (%s)", (locale) => {
  it("register: the six T09 columns with confidence H/M/L; examples marked illustrative with 100000 and 500000 SAR per year", async () => {
    const { t } = render(LIST, locale, LEAD());
    const table = await screen.findByRole("table", { name: t("benefitFormulas.registerTitle") });
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((h) => h.textContent ?? "");
    for (const key of ["benefitName", "baselineDriver", "changeAssumption", "formula", "ramp", "confidence"])
      expect(
        headers.some((h) => h.startsWith(t(`benefitFormulas.field.${key}`))),
        key,
      ).toBe(true);
    expect(within(table).getByText(t("benefitFormulas.confidence.M"))).toBeTruthy();
    const revenue = await waitFor(() => {
      const el = document.querySelector<HTMLElement>("[data-example='revenue_uplift']");
      expect(el).toBeTruthy();
      return el!;
    });
    const cost = document.querySelector<HTMLElement>("[data-example='cost_reduction']")!;
    for (const card of [revenue, cost]) expect(card.textContent).toContain(t("benefitFormulas.illustrative"));
    expect(revenue.querySelector("[data-example-preview]")!.getAttribute("data-example-preview")).toBe("100000");
    expect(cost.querySelector("[data-example-preview]")!.getAttribute("data-example-preview")).toBe("500000");
    const perYear = (amount: string) =>
      t("benefitFormulas.perPeriod", {
        value: locale === "ar" ? `${amount} SAR` : `SAR ${amount}`,
        period: t("benefitFormulas.periodUnit.year"),
      });
    expect(revenue.querySelector("[data-example-preview]")!.textContent).toContain(perYear("100,000.00"));
    expect(cost.querySelector("[data-example-preview]")!.textContent).toContain(perYear("500,000.00"));
    // The attach rates are fractions shown as percent: 10% and 12%, never 0.1.
    expect(revenue.textContent).toContain(t("benefitFormulas.suffix.percent", { value: "12" }));
    expect(
      screen.getAllByRole("button", { name: new RegExp(esc(t("benefitFormulas.examples.instantiate"))) }).length,
    ).toBe(2);
  });

  it("builder: an undefined variable shows translated, with its position, before saving; nothing is sent", async () => {
    const { api, t } = render(DETAIL, locale, LEAD());
    const expression = await builderExpression(t("benefitFormulas.builder.expression"));
    fireEvent.change(expression, { target: { value: `${REVENUE_EXPR} * churn_factor` } });
    const live = await liveCheck();
    await waitFor(() => expect(live.querySelector("[data-check='invalid']")).toBeTruthy());
    expect(live.querySelector("[data-error-code]")!.getAttribute("data-error-code")).toBe("formula.undefined_variable");
    expect(live.textContent).toContain(t("benefitFormulas.engine.undefined_variable", { name: "churn_factor" }));
    expect(live.querySelector("mark")).toBeTruthy();
    expect(live.querySelector("[data-error-offset]")!.getAttribute("data-error-offset")).toBe(
      String(REVENUE_EXPR.length + 3),
    );
    if (locale === "ar") expect(live.textContent).not.toContain("Undefined variable");
    fireEvent.click(screen.getByRole("button", { name: t("benefitFormulas.builder.save") }));
    await waitFor(() => expect(expression.getAttribute("aria-invalid")).toBe("true"));
    expect(writes(api)).toEqual([]);
    // "Declare" adds the variable row.
    fireEvent.click(
      within(live).getByRole("button", { name: t("benefitFormulas.builder.declare", { name: "churn_factor" }) }),
    );
    expect(document.querySelector("[data-variable='churn_factor']")).toBeTruthy();
  });

  it("builder: monthly ARPU × annual customers is a period mismatch, translated, before saving", async () => {
    const { api, t } = render(DETAIL, locale, LEAD());
    await liveCheck();
    const arpu = document.querySelector<HTMLElement>("[data-variable='arpu']")!;
    fireEvent.change(within(arpu).getByLabelText(t("benefitFormulas.variables.period")), {
      target: { value: "month" },
    });
    const live = await liveCheck();
    await waitFor(() =>
      expect(live.querySelector("[data-error-code]")?.getAttribute("data-error-code")).toBe("formula.period_mismatch"),
    );
    expect(live.textContent).toContain(
      t("benefitFormulas.engine.periodMismatch", {
        left: "arpu",
        leftPeriod: t("benefitFormulas.periodUnit.month"),
        right: "eligible_customers",
        rightPeriod: t("benefitFormulas.periodUnit.year"),
        convertTo: "year",
      }),
    );
    expect(writes(api)).toEqual([]);
  });

  it("builder: a fraction is entered as percent and stored as a fraction; a version is saved with If-Match", async () => {
    let body: { variables: { name: string; value: string | null }[]; expression: string } | null = null;
    const { api, t } = render(DETAIL, locale, LEAD(), [
      route("POST", /\/versions$/, (req) => {
        body = req.body as typeof body;
        return { status: 201, body: makeVersion({ versionNo: 2 }) };
      }),
    ]);
    await liveCheck();
    const target = document.querySelector<HTMLElement>("[data-variable='target_attach_rate']")!;
    const value = within(target).getByLabelText(t("benefitFormulas.variables.valueIn.percent")) as HTMLInputElement;
    expect(value.value).toBe("12");
    fireEvent.change(value, { target: { value: "13" } });
    const live = await liveCheck();
    // 0.03 × 100000 × 50 = 150000 SAR per year, from the shared engine while typing.
    await waitFor(() =>
      expect(live.querySelector("[data-formula-value]")?.getAttribute("data-formula-value")).toBe("150000"),
    );
    fireEvent.click(screen.getByRole("button", { name: t("benefitFormulas.builder.save") }));
    await waitFor(() => expect(body).not.toBeNull());
    expect(body!.variables.find((v) => v.name === "target_attach_rate")!.value).toBe("0.13");
    expect(body!.variables.find((v) => v.name === "baseline_attach_rate")!.value).toBe("0.1");
    expect(writes(api)[0]!.headers["if-match"]).toBe('"2"');
    expect(await screen.findByText(t("benefitFormulas.builder.saved", { n: 2 }))).toBeTruthy();
  });

  it("builder: a fraction difference shows percentage points (translated suffix), never %", async () => {
    const { t } = render(DETAIL, locale, LEAD());
    const expression = await builderExpression(t("benefitFormulas.builder.expression"));
    fireEvent.change(expression, { target: { value: "target_attach_rate - baseline_attach_rate" } });
    const live = await liveCheck();
    await waitFor(() => expect(live.querySelector("[data-kind='fraction_delta']")).toBeTruthy());
    expect(live.querySelector("[data-kind='fraction_delta']")!.textContent).toBe(
      t("benefitFormulas.suffix.percentage_points", { value: "2" }),
    );
  });

  it("builder: a 409 shows the standard conflict panel; nothing was saved", async () => {
    const { t } = render(DETAIL, locale, LEAD(), [
      route("POST", /\/versions$/, () => problem(409, "version_conflict", { currentVersion: 3 })),
    ]);
    await liveCheck();
    fireEvent.click(screen.getByRole("button", { name: t("benefitFormulas.builder.save") }));
    const panel = await waitFor(() => {
      const el = document.querySelector<HTMLElement>("[data-state='conflict']");
      expect(el).toBeTruthy();
      return el!;
    });
    expect(panel.getAttribute("role")).toBe("alert");
    expect(panel.textContent).toContain(t("common.conflict.title"));
  });

  it("Finance validation of a version: a business approval by FIN; the author cannot; translated refusal", async () => {
    let body: unknown = null;
    const { api, t } = render(DETAIL, locale, finGrants(), [
      route("POST", /\/versions\/1\/validation$/, (req) => {
        body = req.body;
        return problem(422, "benefit_formula_version.validation_final", { detail: "final" });
      }),
    ]);
    const action = await screen.findByRole("button", { name: new RegExp(esc(t("benefitFormulas.versions.validate"))) });
    expect(t("benefitFormulas.versions.validate")).toContain(locale === "en" ? "business approval" : "موافقة عمل");
    expect(document.querySelector("[data-formula-builder]")).toBeNull();
    fireEvent.click(action);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: t("businessCases.finance.choice.rejected") }));
    fireEvent.change(within(dialog).getByLabelText(new RegExp(esc(t("businessCases.finance.note")))), {
      target: { value: "Synthetic rejection note" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("businessCases.finance.confirm") }));
    await waitFor(() => expect(body).toEqual({ result: "rejected", note: "Synthetic rejection note" }));
    expect(writes(api)[0]!.headers["if-match"]).toBe('"1"');
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain(t("benefitFormulas.problems.benefit_formula_version__validation_final"));
  });

  it("Finance validation: the version's author sees the separation-of-duties note and no action", async () => {
    const { t } = render(
      DETAIL,
      locale,
      finGrants(),
      [],
      makeFormula({ currentVersion: makeVersion({ createdBy: USER_ID }) }),
    );
    expect(await screen.findByText(t("benefitFormulas.versions.authorCannot"))).toBeTruthy();
    expect(screen.queryByRole("button", { name: new RegExp(esc(t("benefitFormulas.versions.validate"))) })).toBeNull();
  });

  it("read-only auditor: no builder, no write control, the read-only note; a validated version reads Validated", async () => {
    const { api, t } = render(
      DETAIL,
      locale,
      AUDITOR_GRANTS,
      [],
      makeFormula({
        currentVersion: makeVersion({ validationStatus: "validated", validatedBy: OTHER_USER, validatedAt: STAMP }),
      }),
    );
    await waitFor(() => expect(document.querySelector("[data-version='1']")).toBeTruthy());
    expect(document.querySelector("[data-state='read-only']")).toBeTruthy();
    expect(document.querySelector("[data-formula-builder]")).toBeNull();
    expect(document.querySelector("[data-run-calculation]")).toBeNull();
    expect(screen.getAllByText(t("businessCases.finance.state.validated")).length).toBeGreaterThan(0);
    const main = document.querySelector("main") ?? document.body;
    const enabled = [...main.querySelectorAll<HTMLElement>("form, input, textarea, select, button")].filter(
      (el) => !(el as HTMLButtonElement).disabled && !el.closest("thead, .app-header, nav"),
    );
    expect(enabled.map((e) => e.textContent ?? e.tagName)).toEqual([]);
    expect(writes(api)).toEqual([]);
  });
});
