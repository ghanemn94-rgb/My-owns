// KPI engine screens (T-DG4-FE-B; p4-work-split §A.5) with stubbed responses, in English (LTR) and Arabic (RTL).
// SYNTHETIC data only.
//  - REQ-S07-008: the RAG panel shows the seven elements; the explanation names the threshold version used.
//  - REQ-S07-006: no actual → Unknown, grey and labelled with its reason, never 0 and never green.
//  - REQ-S07-017: the update is one form in four numbered steps; the confirmation lists the downstream views, "review
//    pending" and "Finance review pending". A second entry for the same slot is value version N+1 (If-Match).
//  - REQ-S07-012: a submitted value is labelled as pending review; the submitter is never offered accept/reject.
//  - S-6/S-11: every ADR-0027 §13 refusal code is translated in both languages.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../../i18n/index.ts";
import { TR_ID, USER_ID, mockApi, problem, renderApp, route } from "../../test/fixtures.tsx";
import { TRP, esc, json, p4Handlers, page } from "../my-work/p4fixtures.ts";
import {
  ACTUAL_ID,
  KPI_ID,
  actual,
  dictionaryEntry,
  finding,
  kpiStatus,
  kpiVersion,
  period,
  submission,
  unknownStatus,
} from "./kpiFixtures.ts";
import { buildEntry, valueShape } from "./KpiUpdatePage.tsx";
import { parsePoints } from "./KpiPage.tsx";
import { formatKpiValue, formatThreshold, times100, toStoredValue } from "./ui.tsx";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const KP = `${TRP}/kpi-definitions/${KPI_ID}`;
const entryRoute = (e = dictionaryEntry()) => route("GET", new RegExp(`${esc(KP)}/dictionary-entry$`), () => json(e));
const statusRoute = (s = kpiStatus()) => route("GET", new RegExp(`${esc(KP)}/status`), () => json(s));
const periodsRoute = route("GET", /\/reporting-periods/, () => page([period()]));

/** The ADR-0027 §13 codes (S-11), translated through problems.* (slice A block, T-DG4-FE-B). */
const ADR_0027_CODES = [
  "kpi_version.aggregation_rule_required",
  "kpi_version.aggregation_not_allowed",
  "kpi_version.custom_formula_needs_approval",
  "kpi_version.measure_mismatch",
  "kpi_version.band_required",
  "kpi_version.milestone_due_date_required",
  "kpi_version.ratio_labels_required",
  "kpi_version.reviewer_required",
  "kpi_version.change_reason_required",
  "kpi_version.not_draft",
  "kpi_version.definition_not_active",
  "kpi_version.approval_required",
  "kpi_version.draft_exists",
  "kpi_definition.measure_locked",
  "kpi_formula.circular",
  "kpi_formula.unit_mismatch",
  "kpi_formula.input_unknown_kpi",
  "kpi_threshold.order",
  "reporting_period.label_taken",
  "reporting_period.overlap",
  "reporting_period.weeks_invalid",
  "reporting_period.range_invalid",
  "reporting_period.status_step",
  "kpi.scope_invalid",
  "target_trajectory.points_required",
  "target_trajectory.not_draft",
  "target_trajectory.draft_exists",
  "target_trajectory.approver_is_author",
  "kpi_actual.no_active_version",
  "kpi_actual.period_not_open",
  "kpi_actual.period_frequency",
  "kpi_actual.scope_kind",
  "kpi_actual.currency_mismatch",
  "kpi_actual.value_shape",
  "kpi_actual.evidence_required",
  "kpi_actual.not_submitted",
  "kpi_actual.reject_reason_required",
  "kpi_actual.not_owner",
  "kpi_actual.not_reviewer",
  "kpi_actual.sod_submitter",
  "routing.role_unmapped",
  "rag_override.reason_required",
  "rag_override.evidence_required",
  "rag_override.expiry_required",
  "rag_override.expiry_invalid",
  "rag_override.already_in_force",
  "rag_override.not_active",
  "data_quality.not_open",
  "data_quality.note_required",
  // reported by KBE-B (handback §9): generic codes reused for slice A refusals
  "kpi_definition.archived",
  "validation.constraint",
  "validation.reference",
];
const FORMULA_CODES = [
  "formula.syntax",
  "formula.undefined_variable",
  "formula.kind_mismatch",
  "formula.currency_product",
  "formula.currency_mismatch",
  "formula.period_mismatch",
  "formula.invalid_variable",
  "formula.division_by_zero",
  "formula.missing_input",
  "formula.result_out_of_range",
];

describe("KPI helpers", () => {
  it("percentages are fractions: 0.12 shows 12 %, 12.5 typed is stored 0.125; values never become 0", () => {
    expect(times100("0.12")).toBe("12");
    expect(times100(null)).toBeNull();
    expect(toStoredValue("12.5", "percentage")).toBe("0.125");
    expect(toStoredValue("12.5", "count")).toBe("12.5");
    expect(formatKpiValue("0.12", "percentage", null, "en")).toBe("12 %");
    expect(formatKpiValue(null, "count", null, "en")).toBeNull();
    expect(formatKpiValue("1250.5", "currency", "SAR", "en")).toContain("1,250.50");
    expect(formatThreshold("0.05", "relative", "en")).toBe("5 %");
    expect(formatThreshold("3", "absolute", "en")).toBe("3");
  });

  it("trajectory points: one 'date value' per line; bad lines and repeated dates are refused", () => {
    expect(parsePoints("2026-12-31 10\n2027-06-30 25", "percentage")).toEqual({
      points: [
        { pointDate: "2026-12-31", expectedValue: "0.1" },
        { pointDate: "2027-06-30", expectedValue: "0.25" },
      ],
    });
    expect(parsePoints("tomorrow 5", "count")).toEqual({ error: "validation.trajectory_point" });
    expect(parsePoints("2026-12-31 1\n2026-12-31 2", "count")).toEqual({
      error: "validation.trajectory_point_dates_distinct",
    });
  });

  it("value shape per version and the routine-update body", () => {
    const v = kpiVersion();
    expect(valueShape(v)).toBe("value");
    expect(valueShape(kpiVersion({ valueNature: "ratio" }))).toBe("ratio");
    expect(valueShape(kpiVersion({ measureType: "binary_milestone", valueNature: "milestone" }))).toBe("milestone");
    const base = {
      scopeId: TR_ID,
      periodId: "p",
      mode: "value" as const,
      value: "12.5",
      numerator: "",
      denominator: "",
      milestone: "" as const,
      achievedOn: "",
      missingReason: "",
      dataAsOf: "2026-10-31",
      comment: "",
      evidenceIds: [],
    };
    expect(buildEntry(base, v, "submit")).toEqual({
      body: { action: "submit", dataAsOf: "2026-10-31", value: "0.125" },
    });
    // "not available" sends the reason and no value (the KPI then shows Unknown, never 0)
    expect(
      buildEntry({ ...base, mode: "not_available", value: "", missingReason: "Source system down" }, v, "submit"),
    ).toEqual({
      body: { action: "submit", dataAsOf: "2026-10-31", missingReason: "Source system down" },
    });
    expect(buildEntry({ ...base, mode: "not_available", value: "" }, v, "submit")).toEqual({
      errors: { missingReason: "validation.required" },
    });
    expect(buildEntry({ ...base, value: "abc" }, v, "submit")).toEqual({ errors: { value: "validation.decimal" } });
    const withEvidence = kpiVersion({
      dataQuality: { staleAfterDays: 45, validMin: null, validMax: null, evidenceRequired: true },
    });
    expect(buildEntry(base, withEvidence, "submit")).toEqual({
      errors: { evidenceIds: "kpi_actual.evidence_required" },
    });
    expect("body" in buildEntry(base, withEvidence, "save_draft")).toBe(true);
  });
});

describe.each(["en", "ar"] as const)("KPI screens (%s)", (locale) => {
  const t = createI18n(locale).t;

  it("translates every ADR-0027 §13 code, the reported generic codes and the formula codes", () => {
    const key = (c: string) => `problems.${c.replace(/\./g, "__")}`;
    expect(ADR_0027_CODES.filter((c) => !t(key(c), { defaultValue: "" }))).toEqual([]);
    expect(FORMULA_CODES.filter((c) => !t(`kpiP4.problem.${c.replace(/\./g, "__")}`, { defaultValue: "" }))).toEqual(
      [],
    );
  });

  it("RAG panel: the seven elements, the threshold version named, and the override beside the calculated RAG", async () => {
    mockApi(
      ...p4Handlers(
        locale,
        [],
        [
          entryRoute(),
          statusRoute(
            kpiStatus({
              displayedRag: "amber",
              override: {
                id: "01920000-0000-7000-9000-00000000a0a1",
                rag: "amber",
                reason: "Synthetic data feed under repair",
                evidenceId: "01920000-0000-7000-9000-00000000a0a2",
                expiresAt: "2026-11-30T21:00:00Z",
                createdBy: USER_ID,
              },
            }),
          ),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/kpis/${KPI_ID}`, { i18n: createI18n(locale) });
    const panel = await screen.findByText(t("kpiP4.field.explanation"));
    const root = panel.closest("[data-rag-panel]")!;
    for (const el of ["actual", "expected", "target", "variance", "trend", "freshness", "explanation"])
      expect(root.querySelector(`[data-element='${el}']`), el).toBeTruthy();
    expect(root.querySelector("[data-element='actual']")!.textContent).toContain("12 %");
    expect(root.querySelector("[data-element='expected']")!.textContent).toContain("10 %");
    expect(root.querySelector("[data-element='variance']")!.textContent).toContain(`+2 ${t("kpiP4.panel.pp")}`);
    expect(root.querySelector("[data-element='trend']")!.textContent).toContain(t("kpiP4.trend.improving"));
    expect(root.querySelector("[data-element='freshness']")!.textContent).toContain(t("kpiP4.freshness.fresh"));
    const explanation = root.querySelector("[data-element='explanation']")!.textContent!;
    expect(explanation).toContain(t("kpiP4.explanation.on_or_better_than_trajectory"));
    expect(explanation).toContain(
      t("kpiP4.explanation.thresholdConfigured", {
        version: 3,
        amber: "5 %",
        red: "10 %",
        mode: t("kpiP4.threshold.modes.relative"),
      }),
    );
    expect(explanation).toContain(t("kpiP4.explanation.trajectory", { version: 2 }));
    // displayed amber by override, calculated green kept and named
    expect(root.querySelector("[data-rag='amber']")!.textContent).toContain(t("kpiP4.rag.amber"));
    const note = root.querySelector("[data-state='override-in-force']")!.textContent!;
    expect(note).toContain(t("kpiP4.rag.green"));
    expect(note).toContain("Synthetic data feed under repair");
  });

  it("no actual for the current period: Unknown, grey and labelled, with its reason; never 0 and never green", async () => {
    mockApi(...p4Handlers(locale, [], [entryRoute(), statusRoute(unknownStatus())]));
    renderApp(`/transformations/${TR_ID}/kpis/${KPI_ID}`, { i18n: createI18n(locale) });
    const panel = (await screen.findByText(t("kpiP4.field.explanation"))).closest("[data-rag-panel]")!;
    const actualCell = panel.querySelector("[data-element='actual']")!;
    expect(actualCell.querySelector("[data-value-status='unknown']")!.className).toContain("status-chip--unknown");
    expect(actualCell.textContent).toContain(t("kpiP4.valueStatus.unknown"));
    expect(actualCell.textContent).toContain(t("kpiP4.reason.no_accepted_actual"));
    expect(actualCell.textContent).not.toMatch(/\b0\b/);
    expect(panel.querySelector("[data-rag='green']")).toBeNull();
    expect(panel.querySelector("[data-rag='unknown']")!.className).toContain("status-chip--unknown");
    expect(panel.querySelector("[data-element='explanation']")!.textContent).toContain(
      t("kpiP4.explanation.thresholdDefault", { amber: "5 %", red: "10 %", mode: t("kpiP4.threshold.modes.relative") }),
    );
  });

  it("the status overview shows Unknown KPIs grey and labelled (no zero in the list)", async () => {
    mockApi(
      ...p4Handlers(
        locale,
        [],
        [
          route("GET", new RegExp(`${esc(TRP)}/kpi-status`), () => page([unknownStatus()])),
          route("GET", new RegExp(`${esc(TRP)}/kpi-dictionary`), () => page([dictionaryEntry()])),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/kpis`, { i18n: createI18n(locale) });
    const table = (await screen.findByText(t("kpiP4.list.statusTitle"), { selector: "h2" })).closest("section")!;
    await waitFor(() => expect(table.querySelector("[data-rag='unknown']")).toBeTruthy());
    expect(table.querySelector("[data-rag='green']")).toBeNull();
    expect(table.querySelectorAll("[data-value-status='unknown']").length).toBeGreaterThanOrEqual(2);
  });

  it("four-step update: submits once, then lists downstream views, 'review pending' and 'Finance review pending'", async () => {
    const api = mockApi(
      ...p4Handlers(
        locale,
        ["kpi_actual.submit"],
        [
          entryRoute(),
          periodsRoute,
          route("POST", new RegExp(`${esc(KP)}/actuals$`), () => ({ status: 201, body: submission() })),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/kpis/${KPI_ID}/actuals`, { i18n: createI18n(locale) });
    const form = (await screen.findByText(t("kpiP4.update.step1"))).closest("form")!;
    const legends = [...form.querySelectorAll("fieldset[data-step] > legend")].map((l) => l.textContent);
    expect(legends).toEqual([1, 2, 3, 4].map((n) => t(`kpiP4.update.step${n}`)));
    const periodSelect = await within(form).findByRole("combobox", { name: new RegExp(esc(t("kpiP4.field.period"))) });
    fireEvent.change(periodSelect, { target: { value: period().id } });
    fireEvent.change(within(form).getByRole("textbox", { name: new RegExp(`^${esc(t("kpiP4.field.actual"))}`) }), {
      target: { value: "12.5" },
    });
    fireEvent.click(within(form).getByRole("button", { name: t("kpiP4.update.submit") }));
    const box = await waitFor(() => {
      const el = document.querySelector("[data-state='kpi-update-confirmation']");
      if (!el) throw new Error("no confirmation yet");
      return el;
    });
    const post = api.requests.find((q) => q.method === "POST")!;
    expect(post.body).toEqual({
      scopeKind: "transformation",
      scopeId: TR_ID,
      reportingPeriodId: period().id,
      action: "submit",
      dataAsOf: "2026-10-31",
      value: "0.125",
    });
    expect(box.textContent).toContain(t("kpiP4.confirm.reviewPending"));
    expect(box.textContent).toContain(t("kpiP4.confirm.finance.pending"));
    expect(box.querySelectorAll("[data-downstream-kind]")).toHaveLength(3);
    expect(box.textContent).toContain(t("kpiP4.downstream.executive_overview_outcomes"));
    expect(box.textContent).toContain(t("kpiP4.actualStatus.submitted"));
  });

  it("a second entry for the same KPI and period is value version 2 of the same slot (If-Match)", async () => {
    const slot = actual({ status: "rejected", submittedBy: USER_ID, version: 4 });
    const api = mockApi(
      ...p4Handlers(
        locale,
        ["kpi_actual.submit"],
        [
          entryRoute(),
          periodsRoute,
          route("GET", new RegExp(`${esc(KP)}/actuals`), () => page([slot])),
          route("POST", new RegExp(`kpi-actuals/${ACTUAL_ID}/values$`), () =>
            json(submission({ actual: actual({ currentValueNo: 2, submittedBy: USER_ID }) })),
          ),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/kpis/${KPI_ID}/actuals`, { i18n: createI18n(locale) });
    const form = (await screen.findByText(t("kpiP4.update.step1"))).closest("form")!;
    fireEvent.change(await within(form).findByRole("combobox", { name: new RegExp(esc(t("kpiP4.field.period"))) }), {
      target: { value: period().id },
    });
    expect(
      await within(form).findByText(t("kpiP4.update.existingSlot", { n: 1, next: 2 }), { exact: false }),
    ).toBeTruthy();
    fireEvent.click(within(form).getByLabelText(t("kpiP4.update.notAvailable")));
    fireEvent.change(within(form).getByRole("textbox", { name: new RegExp(esc(t("kpiP4.update.missingReason"))) }), {
      target: { value: "Synthetic source extract delayed" },
    });
    fireEvent.click(within(form).getByRole("button", { name: t("kpiP4.update.submit") }));
    await waitFor(() => expect(api.requests.some((q) => q.method === "POST")).toBe(true));
    const post = api.requests.find((q) => q.method === "POST")!;
    expect(post.url).toContain(`/kpi-actuals/${ACTUAL_ID}/values`);
    expect(post.headers["if-match"]).toBe('"4"');
    expect(post.body).toEqual({
      action: "submit",
      dataAsOf: "2026-10-31",
      missingReason: "Synthetic source extract delayed",
    });
  });

  it("a 409 on submit is the form's one alert: nothing was saved, the latest data is loaded", async () => {
    mockApi(
      ...p4Handlers(
        locale,
        ["kpi_actual.submit"],
        [
          entryRoute(),
          periodsRoute,
          route("POST", new RegExp(`${esc(KP)}/actuals$`), () => problem(409, "version_conflict")),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/kpis/${KPI_ID}/actuals`, { i18n: createI18n(locale) });
    const form = (await screen.findByText(t("kpiP4.update.step1"))).closest("form")!;
    fireEvent.change(await within(form).findByRole("combobox", { name: new RegExp(esc(t("kpiP4.field.period"))) }), {
      target: { value: period().id },
    });
    fireEvent.change(within(form).getByRole("textbox", { name: new RegExp(`^${esc(t("kpiP4.field.actual"))}`) }), {
      target: { value: "10" },
    });
    fireEvent.click(within(form).getByRole("button", { name: t("kpiP4.update.submit") }));
    const alerts = await screen.findAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.getAttribute("data-state")).toBe("conflict");
    expect(alerts[0]!.textContent).toContain(t("myWork.ui.conflictReloaded"));
  });

  it("no active version: the update explains it and links to the versions (no form)", async () => {
    mockApi(
      ...p4Handlers(
        locale,
        ["kpi_actual.submit"],
        [entryRoute(dictionaryEntry({ activeVersion: null, missingForUse: ["active_version", "aggregation_rule"] }))],
      ),
    );
    renderApp(`/transformations/${TR_ID}/kpis/${KPI_ID}/actuals`, { i18n: createI18n(locale) });
    expect(await screen.findByText(t("problems.kpi_actual__no_active_version"), { exact: false })).toBeTruthy();
    expect(document.querySelector("form")).toBeNull();
  });

  it("review queue: the reviewer accepts with If-Match; the submitter of a value is not offered a decision", async () => {
    const mine = actual({ id: "01920000-0000-7000-9000-00000000a0b1", submittedBy: USER_ID, version: 5 });
    const theirs = actual({ version: 3 });
    const api = mockApi(
      ...p4Handlers(
        locale,
        ["kpi_actual.accept"],
        [
          route("GET", /kpi-actual-reviews/, () => page([theirs, mine])),
          route("GET", /kpi-dictionary/, () => page([dictionaryEntry()])),
          route("POST", new RegExp(`kpi-actuals/${ACTUAL_ID}/accept$`), () => json(actual({ status: "accepted" }))),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/kpi-review`, { i18n: createI18n(locale) });
    await waitFor(() => expect(document.querySelectorAll("[data-action='accept-actual']")).toHaveLength(1));
    expect(document.querySelector("[data-state='sod']")!.textContent).toBe(t("kpiP4.review.ownValue"));
    fireEvent.click(document.querySelector("[data-action='accept-actual']")!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: t("kpiP4.review.accept") }));
    await waitFor(() => expect(api.requests.some((q) => q.method === "POST")).toBe(true));
    const post = api.requests.find((q) => q.method === "POST")!;
    expect(post.headers["if-match"]).toBe('"3"');
    expect(post.body).toEqual({ comment: null });
  });

  it("an actual: a submitted value says it is not used until accepted; a draft is labelled not submitted", async () => {
    mockApi(
      ...p4Handlers(
        locale,
        [],
        [
          route("GET", new RegExp(`kpi-actuals/${ACTUAL_ID}$`), () => json(actual({ status: "draft" }))),
          route("GET", /kpi-dictionary/, () => page([dictionaryEntry()])),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/kpis/${KPI_ID}/actuals/${ACTUAL_ID}`, { i18n: createI18n(locale) });
    expect(await screen.findByText(t("kpiP4.actual.draftNotUsed"), { exact: false })).toBeTruthy();
    expect(document.querySelector("[data-actual-status='draft']")!.textContent).toContain(
      t("kpiP4.actualStatus.draft"),
    );
    expect(document.querySelector("[data-action='accept-actual']")).toBeNull();
  });

  it("read-only viewer (auditor): no write action on the KPI page, labels say business approval", async () => {
    mockApi(
      ...p4Handlers(
        locale,
        ["audit.read"],
        [
          entryRoute(),
          statusRoute(),
          route("GET", new RegExp(`${esc(KP)}/versions`), () =>
            page([kpiVersion({ status: "draft", id: "v2", versionNo: 2 })]),
          ),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/kpis/${KPI_ID}`, { i18n: createI18n(locale) });
    await screen.findByText(t("kpiP4.version.label", { n: 2 }));
    expect(document.querySelector("[data-state='read-only']")).toBeTruthy();
    for (const a of ["new-version", "activate-version", "new-threshold", "new-trajectory", "new-override"])
      expect(document.querySelector(`[data-action='${a}']`), a).toBeNull();
    expect(document.body.textContent).not.toMatch(/\bDG[0-7]\b/);
  });

  it("data quality: an open finding is resolved with a note and If-Match", async () => {
    const api = mockApi(
      ...p4Handlers(
        locale,
        ["data_quality.manage"],
        [
          route("GET", /data-quality-findings/, () => page([finding()])),
          route("GET", /kpi-dictionary/, () => page([dictionaryEntry()])),
          route("POST", /data-quality-findings\/.+\/resolve$/, () => json(finding({ status: "resolved", version: 2 }))),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/data-quality`, { i18n: createI18n(locale) });
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(`^${esc(t("kpiP4.dq.resolve"))}`) }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: new RegExp(esc(t("kpiP4.dq.note"))) }), {
      target: { value: "Synthetic: actual entered late" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("kpiP4.dq.resolve") }));
    await waitFor(() => expect(api.requests.some((q) => q.method === "POST")).toBe(true));
    const post = api.requests.find((q) => q.method === "POST")!;
    expect(post.headers["if-match"]).toBe('"1"');
    expect(post.body).toEqual({ outcome: "resolved", note: "Synthetic: actual entered late" });
  });
});
