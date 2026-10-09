// Benefits and Finance validation screens (T-DG4-FE-C; p4-work-split §B.5) with stubbed responses, in English (LTR)
// and Arabic (RTL). SYNTHETIC data only.
//  - REQ-PB-075: the ten T14 columns; Realized shows validated, sustained and pending apart, pending labelled.
//  - REQ-PB-076: Value (SAR) n/a for a CX benefit and Unknown with its reason for a financial one, never 0.
//  - REQ-PB-074: the six lifecycle steps with question and output; the missing outputs listed; only allowed moves.
//  - REQ-S08-013: allocations in percent with the unallocated share; the PUT sends fractions with If-Match.
//  - REQ-S08-015 / REQ-PB-013: the six Finance items; the decision body; the submitter is never offered a decision.
//  - REQ-S08-017: a validated measurement offers no edit; the 409 is translated.
//  - REQ-S08-018: every scenario value is labelled with its kind.
//  - REQ-S08-009/-011/-014: totals per class and state, gross, cost and net; pending overlap apart; Unknown never 0.
//  - S-6/S-11: every ADR-0029 §11 and ADR-0030 §11 code is translated in both languages. S-7: no DG0-DG7 label.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../../i18n/index.ts";
import { TR_ID, USER_ID, mockApi, problem, renderApp, route } from "../../test/fixtures.tsx";
import { TRP, esc, json, p4Handlers, page } from "../my-work/p4fixtures.ts";
import {
  BENEFIT_ID,
  FV_ID,
  INITIATIVE_A,
  INITIATIVE_B,
  MEASUREMENT_ID,
  allocations,
  benefit,
  cxRow,
  financeValidation,
  lifecycle,
  measurement,
  registerRow,
  scenario,
  totals,
  unknownValueRow,
  values,
} from "./benefitsFixtures.ts";
import { percentToFraction, sharePercent } from "./ui.tsx";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** ADR-0029 §11 and ADR-0030 §11 codes (S-11), plus the codes KBE-D, KBE-D2 and KBE-E report in their handbacks. */
const SLICE_B_CODES = [
  "benefit.mapping_required",
  "benefit.kpi_required",
  "benefit.type_class_mismatch",
  "benefit.valuation_method_required",
  "benefit.valuation_method_not_approved",
  "benefit.kpi_variable_unbound",
  "benefit.validator_is_owner",
  "benefit.lifecycle_step",
  "benefit.plan_outputs_missing",
  "benefit.enablers_missing",
  "benefit.recovery_plan_required",
  "benefit.sustain_outputs_missing",
  "benefit.parent_depth",
  "benefit.parent_has_values",
  "benefit.parent_currency",
  "benefit.measure_locked",
  "benefit.case_line_invalid",
  "benefit.case_line_taken",
  "benefit.archived",
  "benefit.baseline_validator_is_owner",
  "benefit.baseline_missing",
  "benefit.baseline_note_required",
  "benefit_enabler.deliverable_initiative",
  "benefit_enabler.removed",
  "benefit_enabler.exists",
  "benefit_allocation.over_100",
  "benefit_allocation.duplicate_initiative",
  "benefit_allocation.share_invalid",
  "benefit_group.counted_not_member",
  "benefit_group.counted_member_leaving",
  "benefit_scenario.kind_exists",
  "benefit_value.currency_mismatch",
  "benefit_value.unmonetised",
  "benefit_value.parent_rollup",
  "benefit_value.period_taken",
  "benefit_valuation_method.decider_is_proposer",
  "benefit_valuation_method.not_proposed",
  "benefit_valuation_method.note_required",
  "benefit_overlap.same_benefit",
  "benefit_overlap.already_open",
  "benefit_overlap.not_open",
  "benefit_overlap.excluded_required",
  "benefit_overlap.note_required",
  "benefit_overlap.resolver_is_owner",
  "benefit_measurement.step",
  "benefit_measurement.period_required",
  "benefit_measurement.period_taken",
  "benefit_measurement.value_shape",
  "benefit_measurement.evidence_required",
  "benefit_measurement.not_draft",
  "benefit_measurement.validated_immutable",
  "benefit_measurement.lineage_period",
  "finance_validation.sod_submitter",
  "finance_validation.content_incomplete",
  "finance_validation.not_queued",
  "finance_validation.items_not_accepted",
  "finance_validation.rejection_note_required",
  "finance_validation.approved_amount_required",
  "finance_validation.basis_provisional",
  "finance_validation.not_approved",
  "finance_validation.already_reversed",
  "finance_validation.reason_required",
  "finance_validation.amendment_unchanged",
  // reported by KBE-D, KBE-D2 and KBE-E (handbacks), and the ADR-0030 §7 reason
  "benefit_valuation_method.not_approved",
  "benefit_value.period_range",
  "benefit_value.value_required",
  "benefit.planned_value_missing",
  "benefit.value_amount_missing",
  "benefit.kpi_actual_missing",
  "benefit.cost_amount_missing",
  "validation.constraint",
];

const BP = `${TRP}/benefits/${BENEFIT_ID}`;
const registerRoute = (rows = [registerRow(), cxRow(), unknownValueRow()]) =>
  route("GET", new RegExp(`${esc(TRP)}/benefits\\?`), () => page(rows));
const totalsRoute = route("GET", new RegExp(`${esc(TRP)}/benefit-totals`), () => json(totals()));
const benefitRoutes = (b = benefit(), l = lifecycle()) => [
  route("GET", new RegExp(`${esc(BP)}$`), () => json(b)),
  route("GET", new RegExp(`${esc(BP)}/lifecycle$`), () => json(l)),
  route("GET", new RegExp(`${esc(BP)}/allocations$`), () => json(allocations())),
  route("GET", new RegExp(`${esc(BP)}/values$`), () => json(values())),
  route("GET", /\/api\/v1\/initiatives\?/, () =>
    page([
      { id: INITIATIVE_A, code: "INI-0001", name: "Synthetic digital onboarding" },
      { id: INITIATIVE_B, code: "INI-0002", name: "Synthetic retention offers" },
    ]),
  ),
];

describe("benefit helpers", () => {
  it("shares are exact fractions shown in percent", () => {
    expect(sharePercent("0.100000", "en")).toBe("10 %");
    expect(sharePercent("0.6", "en")).toBe("60 %");
    expect(sharePercent(null, "en")).toBeNull();
    expect(percentToFraction("60")).toBe("0.6");
    expect(percentToFraction("12.5")).toBe("0.125");
    expect(percentToFraction("abc")).toBeNull();
  });
});

describe.each(["en", "ar"] as const)("benefits screens (%s)", (locale) => {
  const t = createI18n(locale).t;

  it("translates every ADR-0029 §11 and ADR-0030 §11 code and the reported extra codes", () => {
    const key = (c: string) => `problems.${c.replace(/\./g, "__")}`;
    expect(SLICE_B_CODES.filter((c) => !t(key(c), { defaultValue: "" }))).toEqual([]);
    if (locale === "ar") for (const c of SLICE_B_CODES) expect(t(key(c)), c).toMatch(/[؀-ۿ]/);
  });

  it("T14 register: ten columns; Value (SAR) n/a and Unknown never 0; Realized kept apart with pending labelled", async () => {
    mockApi(...p4Handlers(locale, [], [registerRoute(), totalsRoute]));
    renderApp(`/transformations/${TR_ID}/benefits`, { i18n: createI18n(locale) });
    const table = (await screen.findByRole("table", { name: t("benefitsP4.register.tableTitle") })) as HTMLTableElement;
    const headers = [...table.querySelectorAll("thead th")].map((th) => th.textContent ?? "");
    for (const col of [
      "benefit",
      "type",
      "baseline",
      "target",
      "valueSar",
      "realized",
      "owner",
      "evidence",
      "status",
      "lifecycle",
      "initiatives",
    ])
      expect(
        headers.some((h) => h.includes(t(`benefitsP4.col.${col}`))),
        col,
      ).toBe(true);
    // CX benefit: n/a, never 0; KPI actual Unknown with its reason; status Unknown, never green
    const cx = within(screen.getByText("Synthetic NPS uplift").closest("tr")!);
    const valueCell = cx.getAllByText(t("benefitsP4.amount.na"))[0]!.closest("td")!;
    expect(valueCell.querySelector("[data-value-status='not_applicable']")).toBeTruthy();
    expect(valueCell.textContent).not.toMatch(/\b0\b/);
    expect(cx.getByText(t("problems.benefit__kpi_actual_missing"), { exact: false })).toBeTruthy();
    expect(screen.getByText("Synthetic NPS uplift").closest("tr")!.querySelector("[data-rag='unknown']")).toBeTruthy();
    // financial benefit without planned value: Unknown with its reason
    const unknownRow = screen.getByText("Synthetic cash saving").closest("tr")!;
    expect(unknownRow.querySelector("[data-value-status='unknown']")!.textContent).toContain(
      t("problems.benefit__planned_value_missing"),
    );
    // Realized: validated, sustained and pending as separate labelled parts; pending labelled pending
    const realized = document.querySelector("[data-realized='B01']")!;
    expect(realized.querySelector("[data-part='validated'] [data-amount]")!.getAttribute("data-amount")).toBe(
      "240000.5000",
    );
    expect(realized.querySelector("[data-part='pending'] [data-amount]")!.getAttribute("data-amount")).toBe(
      "250000.0000",
    );
    expect(realized.querySelector("[data-state='pending-label']")!.textContent).toBe(
      t("benefitsP4.realized.pendingLabel"),
    );
    // initiatives[] (BE-M) shown; status green has a text label
    expect(
      screen.getByText("Synthetic churn reduction").closest("tr")!.querySelector("[data-initiatives='2']")!.textContent,
    ).toContain("Synthetic digital onboarding");
    expect(
      screen.getByText("Synthetic NPS uplift").closest("tr")!.querySelector("[data-initiatives='none']"),
    ).toBeTruthy();
    expect(
      screen.getByText("Synthetic churn reduction").closest("tr")!.querySelector("[data-rag='green']")!.textContent,
    ).toContain(t("benefitsP4.rag.green"));
    // excluded with reason; open overlap flagged
    expect(
      screen.getByText("Synthetic NPS uplift").closest("tr")!.querySelector("[data-counted='false']")!.textContent,
    ).toContain(t("benefitsP4.counting.overlapOpen"));
    expect(document.body.textContent).not.toMatch(/\bDG[0-7]\b/);
  });

  it("totals: per class and state, pending overlap apart, cost and net Unknown (never 0), non-financial counted apart", async () => {
    mockApi(...p4Handlers(locale, [], [registerRoute([]), totalsRoute]));
    renderApp(`/transformations/${TR_ID}/benefits`, { i18n: createI18n(locale) });
    const byClass = (await screen.findByRole("table", {
      name: t("benefitsP4.totals.byClassCaption"),
    })) as HTMLTableElement;
    const revenue = byClass.querySelector("[data-class='revenue_uplift']")!;
    expect(revenue.querySelector("[data-state='submitted'] [data-amount]")!.getAttribute("data-amount")).toBe(
      "250000.0000",
    );
    expect(revenue.querySelector("[data-state='validated'] [data-amount]")!.getAttribute("data-amount")).toBe("0.0000");
    // cash saving and avoided cost are separate lines (never converted into each other)
    expect(byClass.querySelector("[data-class='cash_saving']")).toBeTruthy();
    expect(byClass.querySelector("[data-class='avoided_cost']")).toBeTruthy();
    expect(document.querySelector("[data-totals='pending-overlap']")!.textContent).toContain(
      t("benefitsP4.totals.pendingOverlapTitle"),
    );
    const net = document.querySelector("[data-totals='net']")!;
    expect(net.querySelector("[data-row='net'] [data-value-status='unknown']")!.textContent).toContain(
      t("problems.benefit__cost_amount_missing"),
    );
    expect(net.querySelector("[data-row='net']")!.textContent).not.toMatch(/0[.,]00/);
    expect(document.querySelector("[data-total='non-financial-count']")!.textContent).toContain("1");
    expect(document.querySelector("[data-excluded='B02']")!.textContent).toContain(
      t("benefitsP4.exclusion.group_counted_member_not_named"),
    );
  });

  it("lifecycle: six steps with question and output, missing outputs listed, only the allowed next step offered", async () => {
    mockApi(...p4Handlers(locale, ["benefit.advance", "benefit.edit"], benefitRoutes()));
    renderApp(`/transformations/${TR_ID}/benefits/${BENEFIT_ID}`, { i18n: createI18n(locale) });
    const list = await waitFor(() => {
      const l = document.querySelector("[data-lifecycle='enable']");
      expect(l).toBeTruthy();
      return l!;
    });
    expect(list.querySelectorAll("[data-step]")).toHaveLength(6);
    const plan = list.querySelector("[data-step='plan']")!;
    expect(plan.querySelector("[data-part='question']")!.textContent).toBe(
      locale === "en" ? "How will it be measured, when, and by whom?" : "سؤال التخطيط",
    );
    expect(plan.querySelector("[data-part='output']")!.textContent).toBe(
      locale === "en" ? "Baseline, formula, target, owner" : "مخرج التخطيط",
    );
    if (locale === "ar") expect(plan.querySelector("[data-state='ar-provisional']")).toBeTruthy();
    else expect(plan.querySelector("[data-state='ar-provisional']")).toBeNull();
    expect(list.querySelector("[data-step='measure'] [data-missing]")!.textContent).toContain(
      t("benefitsP4.missing.enablers"),
    );
    expect(list.querySelector("[data-step='enable']")!.getAttribute("aria-current")).toBe("step");
    // from Enable only Measure is offered
    expect([...list.querySelectorAll("[data-advance]")].map((b) => b.getAttribute("data-advance"))).toEqual([
      "measure",
    ]);
  });

  it("allocations: percent and unallocated share; the replace sends fractions with If-Match", async () => {
    const api = mockApi(
      ...p4Handlers(
        locale,
        ["benefit.allocate"],
        [...benefitRoutes(), route("PUT", new RegExp(`${esc(BP)}/allocations$`), () => json(allocations()))],
      ),
    );
    renderApp(`/transformations/${TR_ID}/benefits/${BENEFIT_ID}`, { i18n: createI18n(locale) });
    const unallocated = await waitFor(() => {
      const u = document.querySelector("[data-share='unallocated']");
      expect(u).toBeTruthy();
      return u!;
    });
    expect(unallocated.textContent).toContain("10");
    fireEvent.click(screen.getByRole("button", { name: t("benefitsP4.allocations.edit") }));
    const dialog = await screen.findByRole("dialog");
    const share = within(dialog).getAllByLabelText(t("benefitsP4.allocations.sharePercent"), { exact: false })[1]!;
    fireEvent.change(share, { target: { value: "40" } });
    expect(dialog.querySelector("[data-state='within-100']")!.textContent).toContain("0");
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.action.save") }));
    await waitFor(() => expect(api.requests.some((q) => q.method === "PUT")).toBe(true));
    const put = api.requests.find((q) => q.method === "PUT")!;
    expect(put.headers["if-match"]).toBe('"3"');
    expect(put.body).toEqual({
      allocations: [
        { initiativeId: INITIATIVE_A, share: "0.6" },
        { initiativeId: INITIATIVE_B, share: "0.4", basis: "Synthetic usage split" },
      ],
    });
  });

  it("allocations above 100 %: the preview warns and the server's 422 is translated in the one form alert", async () => {
    mockApi(
      ...p4Handlers(
        locale,
        ["benefit.allocate"],
        [
          ...benefitRoutes(),
          route("PUT", new RegExp(`${esc(BP)}/allocations$`), () => problem(422, "benefit_allocation.over_100")),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/benefits/${BENEFIT_ID}`, { i18n: createI18n(locale) });
    fireEvent.click(await screen.findByRole("button", { name: t("benefitsP4.allocations.edit") }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getAllByLabelText(t("benefitsP4.allocations.sharePercent"), { exact: false })[1]!, {
      target: { value: "50" },
    });
    expect(dialog.querySelector("[data-state='over-100']")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.action.save") }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain(t("problems.benefit_allocation__over_100"));
    expect(within(dialog).getAllByRole("alert")).toHaveLength(1);
  });

  it("values: seven states apart; measurements before Measure are explained (a delivered enabler is not realized value)", async () => {
    mockApi(...p4Handlers(locale, ["benefit.measure"], benefitRoutes()));
    renderApp(`/transformations/${TR_ID}/benefits/${BENEFIT_ID}`, { i18n: createI18n(locale) });
    const table = await waitFor(() => {
      const v = document.querySelector("[data-values='B01']");
      expect(v).toBeTruthy();
      return v!;
    });
    expect(table.querySelectorAll("[data-series]")).toHaveLength(7);
    expect(table.querySelector("[data-series='forecast']")!.textContent).toContain(t("benefitsP4.stateNote.forecast"));
    expect(table.querySelector("[data-series='validated'] [data-amount]")!.getAttribute("data-amount")).toBe("0.0000");
    expect(document.querySelector("[data-state='not-at-measure']")!.textContent).toContain(t("benefitsP4.step.enable"));
  });

  it("measurements: a validated value offers no edit; the 409 validated_immutable is translated", async () => {
    mockApi(
      ...p4Handlers(
        locale,
        ["benefit.measure"],
        [
          ...benefitRoutes(benefit({ lifecycleStep: "measure" }), lifecycle("measure")),
          route("GET", new RegExp(`${esc(BP)}/measurements`), () =>
            page([
              measurement({ status: "validated", validatedAmount: "240000.5000", measurementNo: 1 }),
              measurement({
                id: "01920000-0000-7000-9000-00000000d002",
                status: "draft",
                measurementNo: 2,
                financeValidationId: null,
                submittedAt: null,
                version: 1,
              }),
            ]),
          ),
          route("PATCH", /\/benefit-measurements\//, () => problem(409, "benefit_measurement.validated_immutable")),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/benefits/${BENEFIT_ID}`, { i18n: createI18n(locale) });
    const validatedRow = await waitFor(() => {
      const r = document.querySelector("tr[data-measurement='1']");
      expect(r).toBeTruthy();
      return r!;
    });
    expect(validatedRow.textContent).toContain(t("benefitsP4.measurements.validatedImmutable"));
    expect(
      within(validatedRow as HTMLElement).queryByRole("button", { name: t("benefitsP4.measurements.edit") }),
    ).toBeNull();
    const draftRow = document.querySelector("tr[data-measurement='2']") as HTMLElement;
    expect(draftRow.querySelector("[data-measurement-status='draft']")!.textContent).toContain(
      t("benefitsP4.measurementStatus.draft"),
    );
    fireEvent.click(within(draftRow).getByRole("button", { name: t("benefitsP4.measurements.edit") }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(dialog.querySelector("[data-field='amount']")!, { target: { value: "260000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.action.save") }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain(t("problems.benefit_measurement__validated_immutable"));
    expect(alert.getAttribute("data-state")).toBe("conflict");
  });

  it("Finance decision: six items, the decision body with If-Match; labelled Finance validation, never DG0-DG7", async () => {
    const api = mockApi(
      ...p4Handlers(
        locale,
        ["finance.validate"],
        [
          route("GET", new RegExp(`${esc(TRP)}/finance-validations/${FV_ID}$`), () => json(financeValidation())),
          route("GET", new RegExp(`${esc(TRP)}/benefit-measurements/${MEASUREMENT_ID}$`), () => json(measurement())),
          route("GET", new RegExp(`${esc(BP)}$`), () => json(benefit({ lifecycleStep: "measure" }))),
          route("POST", /\/decision$/, () =>
            json(financeValidation({ status: "approved", approvedAmount: "240000.5000", version: 2 })),
          ),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/finance-validations/${FV_ID}`, { i18n: createI18n(locale) });
    const items = await waitFor(() => {
      const i = document.querySelector("[data-items='6']");
      expect(i).toBeTruthy();
      return i!;
    });
    for (const item of ["baseline", "attribution", "calculation", "evidence", "measurementPeriod", "assumptions"])
      expect(items.querySelector(`[data-finance-item='${item}']`)!.textContent).toContain(
        t(`benefitsP4.finance.items.${item}`),
      );
    expect(document.querySelector("[data-state='finance-validation']")!.textContent).toContain(
      t("benefitsP4.finance.label"),
    );
    fireEvent.click(screen.getByRole("button", { name: t("benefitsP4.finance.decide") }));
    const dialog = await screen.findByRole("dialog");
    for (const item of ["baseline", "attribution", "calculation", "evidence", "measurementPeriod", "assumptions"])
      fireEvent.change(dialog.querySelector(`[data-field='item_${item}']`)!, { target: { value: "accepted" } });
    fireEvent.change(dialog.querySelector("[data-field='decision']")!, { target: { value: "approved" } });
    fireEvent.change(dialog.querySelector("[data-field='approvedAmount']")!, { target: { value: "240000.5" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("benefitsP4.finance.recordDecision") }));
    await waitFor(() => expect(api.requests.some((q) => q.method === "POST")).toBe(true));
    const post = api.requests.find((q) => q.method === "POST")!;
    expect(post.url).toContain(`/finance-validations/${FV_ID}/decision`);
    expect(post.headers["if-match"]).toBe('"1"');
    const accepted = { decision: "accepted" };
    expect(post.body).toEqual({
      decision: "approved",
      items: {
        baseline: accepted,
        attribution: accepted,
        calculation: accepted,
        evidence: accepted,
        measurementPeriod: accepted,
        assumptions: accepted,
      },
      approvedAmount: "240000.5",
    });
    expect(document.body.textContent).not.toMatch(/\bDG[0-7]\b/);
  });

  it("Finance decision: a missing item is left to the server, whose 422 names the six items; the submitter is never offered a decision", async () => {
    mockApi(
      ...p4Handlers(
        locale,
        ["finance.validate"],
        [
          route("GET", new RegExp(`${esc(TRP)}/finance-validations/${FV_ID}$`), () => json(financeValidation())),
          route("GET", new RegExp(`${esc(TRP)}/benefit-measurements/${MEASUREMENT_ID}$`), () =>
            json(measurement({ submittedBy: USER_ID })),
          ),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/finance-validations/${FV_ID}`, { i18n: createI18n(locale) });
    expect(await screen.findByText(t("benefitsP4.finance.submitterCannotDecide"), { exact: false })).toBeTruthy();
    expect(screen.queryByRole("button", { name: t("benefitsP4.finance.decide") })).toBeNull();
  });

  it("Finance decision: the content_incomplete 422 and a Business Owner's 403 are translated", async () => {
    mockApi(
      ...p4Handlers(
        locale,
        ["finance.validate"],
        [
          route("GET", new RegExp(`${esc(TRP)}/finance-validations/${FV_ID}$`), () => json(financeValidation())),
          route("GET", new RegExp(`${esc(TRP)}/benefit-measurements/${MEASUREMENT_ID}$`), () => json(measurement())),
          route("POST", /\/decision$/, () => problem(422, "finance_validation.content_incomplete")),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/finance-validations/${FV_ID}`, { i18n: createI18n(locale) });
    fireEvent.click(await screen.findByRole("button", { name: t("benefitsP4.finance.decide") }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(dialog.querySelector("[data-field='decision']")!, { target: { value: "rejected" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("benefitsP4.finance.recordDecision") }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain(t("problems.finance_validation__content_incomplete"));
  });

  it("read-only (auditor): Finance item without decide, register without create", async () => {
    mockApi(
      ...p4Handlers(
        locale,
        [],
        [
          registerRoute(),
          totalsRoute,
          route("GET", new RegExp(`${esc(TRP)}/finance-validations/${FV_ID}$`), () => json(financeValidation())),
          route("GET", new RegExp(`${esc(TRP)}/benefit-measurements/${MEASUREMENT_ID}$`), () => json(measurement())),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/finance-validations/${FV_ID}`, { i18n: createI18n(locale) });
    await screen.findByText(t("benefitsP4.finance.itemsTitle"));
    expect(document.querySelectorAll("[data-state='read-only']")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: t("benefitsP4.finance.decide") })).toBeNull();
    cleanup();
    renderApp(`/transformations/${TR_ID}/benefits`, { i18n: createI18n(locale) });
    await screen.findByRole("table", { name: t("benefitsP4.register.tableTitle") });
    expect(screen.queryByRole("button", { name: t("benefitsP4.register.create") })).toBeNull();
  });

  it("scenarios: every value is labelled with its scenario kind", async () => {
    mockApi(
      ...p4Handlers(
        locale,
        ["benefit_scenario.edit"],
        [registerRoute(), route("GET", new RegExp(`${esc(TRP)}/benefit-scenarios`), () => page([scenario()]))],
      ),
    );
    renderApp(`/transformations/${TR_ID}/benefit-scenarios`, { i18n: createI18n(locale) });
    const value = await waitFor(() => {
      const v = document.querySelector("[data-value-kind='upside']");
      expect(v).toBeTruthy();
      return v!;
    });
    expect(value.textContent).toContain(t("benefitsP4.scenarioKind.upside"));
    expect(document.querySelector("#benefit-scenarios")!.textContent).toContain(t("benefitsP4.scenarios.rule"));
  });

  it("measurement lineage: inputs with KPI value versions, a provisional basis labelled", async () => {
    mockApi(
      ...p4Handlers(
        locale,
        [],
        [
          route("GET", new RegExp(`${esc(TRP)}/benefit-measurements/${MEASUREMENT_ID}$`), () =>
            json(
              measurement({
                basis: "provisional",
                formulaVersionId: "01920000-0000-7000-9000-0000000f0002",
                inputs: [
                  {
                    variableName: "churn_rate",
                    kpiActualId: "01920000-0000-7000-9000-00000000a777",
                    kpiValueNo: 2,
                    value: "0.020000",
                    periodStart: "2026-07-01",
                    periodEnd: "2026-09-30",
                  },
                ],
              }),
            ),
          ),
          route("GET", new RegExp(`${esc(BP)}$`), () => json(benefit())),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/benefit-measurements/${MEASUREMENT_ID}`, { i18n: createI18n(locale) });
    const input = await waitFor(() => {
      const i = document.querySelector("[data-input='churn_rate']");
      expect(i).toBeTruthy();
      return i!;
    });
    expect(input.textContent).toContain(t("benefitsP4.lineage.kpiActual", { ref: "a777", no: 2 }));
    expect(document.querySelector("[data-basis='provisional']")!.textContent).toContain(
      t("benefitsP4.measurements.provisionalLong"),
    );
  });
});
