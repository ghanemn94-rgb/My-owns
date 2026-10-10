// Slice E screens (T-DG4-FE-D; p4-work-split §E.5) with stubbed responses, in English (LTR) and Arabic (RTL).
// SYNTHETIC data only.
//  - REQ-PB-079 / REQ-PB-080: the nine T15 columns; Probability n/a for Issue and Dependency; the per-type Mitigation
//    / action header.
//  - REQ-PB-078 + ADR-0031 amendment A1 (D-109): a Dependency entry links to T08, needs a 'To' initiative, has no
//    'In progress', and once closed shows no closure fields.
//  - Action register: source, follow-up date, overdue flag; the edit sends If-Match.
//  - REQ-PB-085 / REQ-S12-016: a case shows source, benefit step, owner "Unassigned", follow-up Unknown with its
//    reason, signals (Unknown never green) and recovery plan; rules show "Default".
//  - S-6/S-11: every ADR-0031 §11 code (and its amendment's) is translated in both languages. S-7: no DG0-DG7 label.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../../i18n/index.ts";
import { TR_ID, mockApi, problem, renderApp, route } from "../../test/fixtures.tsx";
import { TRP, esc, json, p4Handlers, page } from "../my-work/p4fixtures.ts";
import {
  ACTION_ID,
  CASE_ID,
  INITIATIVE_A,
  INITIATIVE_B,
  correctiveCase,
  dependencyEntry,
  issueEntry,
  raidAction,
  raidEntry,
  rules,
  signal,
} from "./raidFixtures.ts";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** ADR-0031 §11 codes and the amendment's `validation.not_applicable` (S-11). */
const SLICE_E_CODES = [
  "raid.type_invalid",
  "raid.probability_required",
  "raid.probability_not_applicable",
  "raid.status_transition",
  "raid.closed",
  "corrective_case.status_transition",
  "corrective_case.closed",
  "corrective_case.owner_required",
  "corrective_case.follow_up_past",
  "corrective_case.already_open",
  "corrective_rule.severity_kpi_only",
  "corrective_rule.persistence_series_only",
  "corrective_rule.exists",
  "budget_line.amount_invalid",
  "budget_line.period_invalid",
  "budget_line.archived",
  "budget_line.duplicate",
  "initiative_schedule.exists",
  "validation.not_applicable",
];

const initiatives = route("GET", /\/api\/v1\/initiatives\?/, () =>
  page([
    { id: INITIATIVE_A, code: "INI-0001", name: "Synthetic onboarding" },
    { id: INITIATIVE_B, code: "INI-0002", name: "Synthetic billing" },
  ]),
);
const raidList = (rows = [raidEntry(), issueEntry(), dependencyEntry()]) =>
  route("GET", new RegExp(`${esc(TRP)}/raid\\?`), () => page(rows));

describe.each(["en", "ar"] as const)("RAID and actions screens (%s)", (locale) => {
  const t = createI18n(locale).t;

  it("translates every ADR-0031 §11 code and the amendment's code", () => {
    const key = (c: string) => `problems.${c.replace(/\./g, "__")}`;
    expect(SLICE_E_CODES.filter((c) => !t(key(c), { defaultValue: "" }))).toEqual([]);
    if (locale === "ar") for (const c of SLICE_E_CODES) expect(t(key(c)), c).toMatch(/[؀-ۿ]/);
  });

  it("T15 register: nine columns, Probability n/a outside Risk, per-type mitigation header, Dependency links to T08", async () => {
    mockApi(...p4Handlers(locale, ["raid.edit"], [raidList(), initiatives]));
    renderApp(`/transformations/${TR_ID}/raid`, { i18n: createI18n(locale) });
    const table = (await screen.findByRole("table", { name: t("raidP4.register.tableTitle") })) as HTMLTableElement;
    const headers = [...table.querySelectorAll("thead th")].map((th) => th.textContent ?? "");
    for (const col of ["id", "type", "description", "impact", "probability", "owner", "due", "mitigation", "status"])
      expect(
        headers.some((h) => h.includes(t(`raidP4.col.${col}`))),
        col,
      ).toBe(true);
    const risk = screen.getByText("Synthetic vendor delay risk").closest("tr")!;
    expect(risk.querySelector("[data-level='medium']")!.textContent).toBe(t("raidP4.level.medium"));
    expect(risk.querySelector("[data-mitigation-header='action']")!.textContent).toContain(
      t("raidP4.mitigationHeader.action"),
    );
    const issue = screen.getByText("Synthetic data feed outage").closest("tr")!;
    expect(issue.querySelector("[data-level='n/a']")!.textContent).toContain(t("raidP4.na"));
    expect(issue.querySelector("[data-mitigation-header='resolve']")).toBeTruthy();
    const dep = screen.getByText("Synthetic billing API needed by onboarding").closest("tr")!;
    expect(dep.querySelector("[data-level='n/a']")).toBeTruthy();
    expect(dep.querySelector("[data-mitigation-header='mitigate']")).toBeTruthy();
    expect(dep.querySelector("[data-t08-link]")!.getAttribute("href")).toBe(`/transformations/${TR_ID}/dependencies`);
    expect(document.body.textContent).not.toMatch(/\bDG[0-7]\b/);
  });

  it("Dependency form: 'To' initiative required, no probability; nothing is sent without it", async () => {
    const api = mockApi(
      ...p4Handlers(
        locale,
        ["raid.edit"],
        [
          raidList([]),
          initiatives,
          route("POST", new RegExp(`${esc(TRP)}/raid$`), () => ({ status: 201, body: dependencyEntry() })),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/raid`, { i18n: createI18n(locale) });
    fireEvent.click(await screen.findByRole("button", { name: t("raidP4.register.create") }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(dialog.querySelector("[data-field='type']")!, { target: { value: "dependency" } });
    expect(dialog.querySelector("[data-field='probability']")).toBeNull();
    expect(dialog.querySelector("[data-field='initiativeId']")).toBeNull();
    const to = dialog.querySelector("[data-field='toInitiativeId']") as HTMLSelectElement;
    expect(to).toBeTruthy();
    expect(to.getAttribute("aria-required") ?? to.required.toString()).toMatch(/true/);
    fireEvent.change(dialog.querySelector("[data-field='description']")!, {
      target: { value: "Synthetic billing API needed" },
    });
    fireEvent.change(dialog.querySelector("[data-field='impact']")!, { target: { value: "high" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("raidP4.register.createSubmit") }));
    await waitFor(() => expect(to.getAttribute("aria-invalid")).toBe("true"));
    expect(api.requests.some((r) => r.method === "POST")).toBe(false);
    await waitFor(() => expect(dialog.querySelector("[data-field='toInitiativeId']")).toBeTruthy());
    await waitFor(() => expect(to.querySelectorAll("option").length).toBeGreaterThan(1));
    fireEvent.change(to, { target: { value: INITIATIVE_B } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("raidP4.register.createSubmit") }));
    await waitFor(() => expect(api.requests.some((r) => r.method === "POST")).toBe(true));
    const post = api.requests.find((r) => r.method === "POST")!;
    expect(post.body).toMatchObject({ type: "dependency", impact: "high", toInitiativeId: INITIATIVE_B });
    expect(post.body).not.toHaveProperty("probability");
  });

  it("Dependency edit has no 'In progress'; a Risk edit offers it; a closed Dependency shows no closure fields", async () => {
    mockApi(
      ...p4Handlers(
        locale,
        ["raid.edit", "dependency.edit"],
        [
          raidList([
            raidEntry(),
            dependencyEntry(),
            dependencyEntry({
              id: "01920000-0000-7000-a000-00000000ffff",
              code: "DEP-02",
              description: "Synthetic closed dependency",
              status: "closed",
              recordStatus: "resolved",
            }),
          ]),
          initiatives,
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/raid`, { i18n: createI18n(locale) });
    const depRow = (await screen.findByText("Synthetic billing API needed by onboarding")).closest("tr")!;
    fireEvent.click(depRow.querySelector("[data-edit='DEP-01']")!);
    let dialog = await screen.findByRole("dialog");
    expect(dialog.querySelector("[data-field='status']")).toBeNull();
    expect(dialog.querySelector("[data-field='probability']")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.action.cancel") }));
    const riskRow = screen.getByText("Synthetic vendor delay risk").closest("tr")!;
    fireEvent.click(riskRow.querySelector("[data-edit='R-01']")!);
    dialog = await screen.findByRole("dialog");
    const status = dialog.querySelector("[data-field='status']") as HTMLSelectElement;
    expect([...status.options].map((o) => o.value)).toEqual(["", "open", "in_progress"]);
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.action.cancel") }));
    const closed = screen.getByText("Synthetic closed dependency").closest("tr")!;
    expect(closed.querySelector("[data-closure='record-history']")!.textContent).toBe(
      t("raidP4.register.dependencyClosed"),
    );
    expect(closed.querySelector("[data-closure='note']")).toBeNull();
    expect(closed.textContent).not.toContain(t("common.value.unknown"));
    expect(closed.querySelector("[data-edit]")).toBeNull();
  });

  it("an Issue with a probability is refused by the server; the 422 is translated in one alert", async () => {
    mockApi(
      ...p4Handlers(
        locale,
        ["raid.edit"],
        [
          raidList([]),
          initiatives,
          route("POST", new RegExp(`${esc(TRP)}/raid$`), () => problem(422, "raid.probability_not_applicable")),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/raid`, { i18n: createI18n(locale) });
    fireEvent.click(await screen.findByRole("button", { name: t("raidP4.register.create") }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(dialog.querySelector("[data-field='type']")!, { target: { value: "risk" } });
    fireEvent.change(dialog.querySelector("[data-field='description']")!, { target: { value: "Synthetic risk" } });
    fireEvent.change(dialog.querySelector("[data-field='impact']")!, { target: { value: "low" } });
    fireEvent.change(dialog.querySelector("[data-field='probability']")!, { target: { value: "high" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("raidP4.register.createSubmit") }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.getAttribute("data-problem")).toBe("raid.probability_not_applicable");
    expect(alert.textContent).toContain(t("problems.raid__probability_not_applicable"));
    expect(within(dialog).getAllByRole("alert")).toHaveLength(1);
  });

  it("action register: source, follow-up date and overdue flag; edit sends If-Match", async () => {
    const api = mockApi(
      ...p4Handlers(
        locale,
        ["action.edit"],
        [
          route("GET", new RegExp(`${esc(TRP)}/action-register\\?`), () =>
            page([
              raidAction(),
              raidAction({
                id: "01920000-0000-7000-a000-00000000fffe",
                title: "Synthetic follow up",
                overdue: false,
                followUpDate: null,
                sourceKind: "corrective_case",
                raidEntryId: null,
                correctiveCaseId: CASE_ID,
              }),
            ]),
          ),
          route("PATCH", new RegExp(`${esc(TRP)}/action-register/${ACTION_ID}$`), () =>
            json(raidAction({ status: "done" })),
          ),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/actions`, { i18n: createI18n(locale) });
    const row = (await screen.findByRole("link", { name: "Synthetic call the vendor" })).closest("tr")!;
    expect(row.querySelector("[data-overdue='true']")!.textContent).toContain(t("raidP4.overdue"));
    expect(row.querySelector("[data-source='raid_entry']")!.textContent).toBe(t("raidP4.actions.source.raid_entry"));
    expect(row.querySelector("[data-due='2026-10-08']")).toBeTruthy();
    const other = screen.getByRole("link", { name: "Synthetic follow up" }).closest("tr")!;
    expect(other.querySelector("[data-overdue]")).toBeNull();
    expect(other.textContent).toContain(t("raidP4.noFollowUp"));
    expect(other.querySelector("[data-source='corrective_case'] a")!.getAttribute("href")).toBe(
      `/transformations/${TR_ID}/corrective-actions/${CASE_ID}`,
    );
    fireEvent.click(row.querySelector(`[data-edit-action='${ACTION_ID}']`)!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(dialog.querySelector("[data-field='status']")!, { target: { value: "done" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("raidP4.form.save") }));
    await waitFor(() => expect(api.requests.some((r) => r.method === "PATCH")).toBe(true));
    const patch = api.requests.find((r) => r.method === "PATCH")!;
    expect(patch.headers["if-match"]).toBe('"2"');
    expect(patch.body).toEqual({ status: "done" });
  });

  it("corrective case: source and benefit step, owner Unassigned, follow-up Unknown with reason, signals never green", async () => {
    mockApi(
      ...p4Handlers(
        locale,
        ["corrective_action.manage"],
        [
          route("GET", new RegExp(`${esc(TRP)}/corrective-actions/${CASE_ID}$`), () => json(correctiveCase())),
          route("GET", new RegExp(`${esc(TRP)}/corrective-actions/${CASE_ID}/signals`), () =>
            page([
              signal(),
              signal({
                periodKey: "2026-08",
                observedRag: "red",
                offTrack: true,
                consecutiveOffTrack: 1,
                outcome: "case_created",
              }),
            ]),
          ),
          route("GET", new RegExp(`${esc(TRP)}/corrective-actions/${CASE_ID}/actions`), () => page([])),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/corrective-actions/${CASE_ID}`, { i18n: createI18n(locale) });
    const detail = await waitFor(() => {
      const d = document.querySelector("[data-case-detail='CA-01']");
      expect(d).toBeTruthy();
      return d!;
    });
    expect(detail.querySelector("[data-source-kind='benefit_variance']")!.textContent).toContain(
      t("raidP4.corrective.source.benefit_variance"),
    );
    expect(detail.querySelector("[data-benefit-step='correct']")).toBeTruthy();
    expect(detail.querySelector("[data-owner='unassigned']")!.textContent).toContain(t("raidP4.corrective.unassigned"));
    const due = detail.querySelector("[data-due='unknown']")!;
    expect(due.textContent).toContain(t("common.value.unknown"));
    expect(due.textContent).toContain(t("myWork.ui.unknownReason.calendar_not_configured"));
    const signals = (await screen.findByRole("table", {
      name: t("raidP4.corrective.signalsTitle"),
    })) as HTMLTableElement;
    const unknown = signals.querySelector("[data-rag='unknown']")!;
    expect(unknown.className).toContain("status-chip--unknown");
    expect(unknown.className).not.toContain("on-track");
    expect(signals.querySelector("[data-rag='red']")!.textContent).toContain(t("raidP4.rag.red"));
  });

  it("rules: a rule without a stored row is labelled Default; saving it creates the row (POST, no If-Match)", async () => {
    const api = mockApi(
      ...p4Handlers(
        locale,
        ["corrective_rule.configure"],
        [
          route("GET", new RegExp(`${esc(TRP)}/corrective-action-rules`), () => page(rules())),
          route("POST", new RegExp(`${esc(TRP)}/corrective-action-rules$`), () => ({ status: 201, body: rules()[0] })),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/corrective-action-rules`, { i18n: createI18n(locale) });
    const kpi = await waitFor(() => {
      const r = document.querySelector("[data-rule='kpi_deviation']");
      expect(r).toBeTruthy();
      return r!;
    });
    expect(kpi.querySelector("[data-default='true']")!.textContent).toBe(t("raidP4.rules.default"));
    expect(document.querySelector("[data-rule='control_check'] [data-default]")).toBeNull();
    fireEvent.click(document.querySelector("[data-edit-rule='kpi_deviation']")!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: t("raidP4.form.save") }));
    await waitFor(() => expect(api.requests.some((r) => r.method === "POST")).toBe(true));
    const post = api.requests.find((r) => r.method === "POST")!;
    expect(post.body).toEqual({
      sourceKind: "kpi_deviation",
      minKpiRag: "red",
      persistenceCycles: 2,
      followUpWorkingDays: 5,
      enabled: true,
    });
    expect(post.headers["if-match"]).toBeUndefined();
  });

  it("the read-only auditor sees the register without any write control", async () => {
    mockApi(...p4Handlers(locale, [], [raidList(), initiatives]));
    renderApp(`/transformations/${TR_ID}/raid`, { i18n: createI18n(locale) });
    await screen.findByRole("table", { name: t("raidP4.register.tableTitle") });
    expect(document.querySelector("[data-state='read-only']")).toBeTruthy();
    expect(screen.queryByRole("button", { name: t("raidP4.register.create") })).toBeNull();
    expect(document.querySelector("[data-edit]")).toBeNull();
    expect(document.querySelector("[data-close]")).toBeNull();
  });
});
