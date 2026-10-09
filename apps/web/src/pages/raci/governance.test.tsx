// Governance screens of slice C (T-DG4-FE-A; ADR-0026 §2, §5, §7, §9) with stubbed responses, in English (LTR) and
// Arabic (RTL). SYNTHETIC data only.
//  - RACI: the cell editor offers exactly A, R, C, I, A/R or empty; a row is saved as one PATCH with If-Match; the
//    accountable count is shown with text; a 422 raci.accountable_count is the row's one translated alert;
//  - role mapping: an unmapped governance role shows the visible routing error;
//  - decision rights: the seeded rows and their SLA; the due-date preview shows Unknown with its reason; the matrix is
//    submitted as a business approval with If-Match;
//  - Transform readiness lists what is missing; read-only for an auditor.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../../i18n/index.ts";
import { TR_ID, mockApi, problem, renderApp, route } from "../../test/fixtures.tsx";
import {
  PARTIES,
  TRP,
  decisionRight,
  esc,
  json,
  matrix,
  p4Handlers,
  page,
  raci,
  roleMapping,
} from "../my-work/p4fixtures.ts";
import { RACI_CELL_OPTIONS, accountableCount } from "./RaciPage.tsx";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const label = (text: string) => new RegExp(`^${esc(text)}`);
const partiesRoute = route("GET", /\/api\/v1\/governance-parties$/, () => json({ items: PARTIES }));

describe("RACI cell rules", () => {
  it("offers exactly A, R, C, I, A/R or empty, and counts A/R as one accountable", () => {
    expect(RACI_CELL_OPTIONS).toEqual(["", "A", "R", "C", "I", "A/R"]);
    expect(accountableCount([{ value: "A/R" }, { value: "R" }, { value: null }])).toBe(1);
    expect(accountableCount([{ value: "A" }, { value: "A/R" }])).toBe(2);
  });
});

describe.each(["en", "ar"] as const)("Governance (%s)", (locale) => {
  const t = createI18n(locale).t;

  it("RACI: edits a row with the cell selects and saves it as one PATCH with If-Match", async () => {
    const m = matrix("raci");
    const r = raci(m);
    const d = r.deliverables[0]!;
    const api = mockApi(
      ...p4Handlers(
        locale,
        ["raci.edit"],
        [
          partiesRoute,
          route("GET", new RegExp(`${esc(TRP)}/raci$`), () => json(r)),
          route("GET", /governance-matrices$/, () => json({ items: [m] })),
          route("PATCH", /\/raci\/deliverables\//, () => problem(422, "raci.accountable_count")),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/raci`, { i18n: createI18n(locale) });
    const row = (await screen.findByText(locale === "ar" ? d.labelAr : d.labelEn)).closest("tr")!;
    expect(row.querySelector("[data-accountable-count='1']")?.textContent).toContain(t("raci.accountableOne"));
    const selects = within(row).getAllByRole("combobox") as HTMLSelectElement[];
    expect(selects).toHaveLength(4);
    expect([...selects[0]!.options].map((o) => o.value)).toEqual(["", "A", "R", "C", "I", "A/R"]);
    fireEvent.change(selects[2]!, { target: { value: "A/R" } });
    expect(row.querySelector("[data-accountable-count='2']")?.textContent).toContain(
      t("raci.accountableCount", { count: 2 }),
    );
    fireEvent.click(within(row).getByRole("button", { name: new RegExp(t("raci.saveRow")) }));
    await waitFor(() => expect(api.requests.some((q) => q.method === "PATCH")).toBe(true));
    const patch = api.requests.find((q) => q.method === "PATCH")!;
    expect(patch.headers["if-match"]).toBe('"4"');
    expect(patch.body).toEqual({
      cells: [
        { partyCode: "SP", value: "A" },
        { partyCode: "TL", value: "R" },
        { partyCode: "BO", value: "A/R" },
        { partyCode: "FIN", value: "C" },
      ],
    });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(t("problems.raci__accountable_count"));
  });

  it("RACI: an auditor sees the matrix read-only (no cell editor, no save)", async () => {
    const m = matrix("raci", { status: "approved", approvedVersion: 2, approvedAt: "2026-10-02T09:00:00Z" });
    mockApi(
      ...p4Handlers(
        locale,
        ["audit.read"],
        [
          partiesRoute,
          route("GET", new RegExp(`${esc(TRP)}/raci$`), () => json(raci(m))),
          route("GET", /governance-matrices$/, () => json({ items: [m] })),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/raci`, { i18n: createI18n(locale) });
    await screen.findByText(t("raci.listTitle"));
    await screen.findByText(locale === "ar" ? "ميثاق التحوّل" : "Transformation charter");
    expect(screen.queryAllByRole("combobox").filter((c) => c.closest("[data-table='raci']"))).toHaveLength(0);
    expect(screen.queryByRole("button", { name: new RegExp(t("raci.saveRow")) })).toBeNull();
    expect(document.querySelector("[data-matrix-status='approved']")).toBeTruthy();
  });

  it("role mapping: an unmapped governance role shows the visible routing error", async () => {
    mockApi(
      ...p4Handlers(
        locale,
        ["role_mapping.assign"],
        [partiesRoute, route("GET", /role-mappings\?.*status=active/, () => page([roleMapping({ partyCode: "SP" })]))],
      ),
    );
    renderApp(`/transformations/${TR_ID}/role-mappings`, { i18n: createI18n(locale) });
    const sp = (await screen.findByText("Synthetic Sponsor")).closest("tr")!;
    expect(sp.querySelector("[data-mapped='true']")).toBeTruthy();
    const bo = document.querySelector("[data-party='BO']")!.closest("tr")!;
    const error = bo.querySelector("[data-routing-error='party_unmapped']")!;
    expect(error.textContent).toContain(t("groups.roleMappings.unmapped"));
    expect(screen.getByRole("status").textContent).toContain(t("groups.roleMappings.unmappedCount", { count: 3 }));
  });

  it("decision rights: seeded rows; the due-date preview shows Unknown with its reason", async () => {
    const row = decisionRight({ slaType: "next_steerco_or_urgent", slaWorkingDays: null });
    mockApi(
      ...p4Handlers(
        locale,
        ["decision_right.configure", "raci.edit"],
        [
          partiesRoute,
          route("GET", new RegExp(`${esc(TRP)}/decision-rights\\?`), () => page([row])),
          route("GET", /governance-matrices$/, () => json({ items: [matrix("decision_rights")] })),
          route("GET", /\/due-date\?/, () =>
            json({
              decisionRightId: row.id,
              slaType: "next_steerco_or_urgent",
              raisedOn: "2026-10-01",
              dueDate: null,
              unknownReason: "no_steerco_scheduled",
              calendarId: null,
              calendarVersion: null,
            }),
          ),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/decision-rights`, { i18n: createI18n(locale) });
    const tr = (await screen.findByText(locale === "ar" ? row.decisionAr : row.decisionEn)).closest("tr")!;
    expect(tr.textContent).toContain(t("decisionRights.slaType.next_steerco_or_urgent"));
    fireEvent.click(within(tr).getByRole("button", { name: new RegExp(t("decisionRights.preview.action")) }));
    const card = await screen.findByText(
      t("decisionRights.preview.title", { decision: locale === "ar" ? row.decisionAr : row.decisionEn }),
    );
    const section = card.closest("section")!;
    fireEvent.change(within(section).getByLabelText(t("decisionRights.preview.raisedOn")), {
      target: { value: "2026-10-01" },
    });
    await waitFor(() => expect(section.querySelector("p[data-due='unknown']")).toBeTruthy());
    const status = section.querySelector("p[data-due='unknown']")!;
    expect(status.textContent).toContain(t("myWork.ui.unknownReason.no_steerco_scheduled"));
  });

  it("decision rights: submits the matrix for business approval with If-Match", async () => {
    const m = matrix("decision_rights", { version: 7 });
    const api = mockApi(
      ...p4Handlers(
        locale,
        ["decision_right.configure", "raci.edit"],
        [
          partiesRoute,
          route("GET", /governance-matrices$/, () => json({ items: [m] })),
          route("POST", /governance-matrices\/decision_rights\/submit$/, () => ({ status: 201, body: {} })),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/decision-rights`, { i18n: createI18n(locale) });
    fireEvent.click(await screen.findByRole("button", { name: t("decisionRights.matrix.submit") }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.querySelector("[data-state='business-approval']")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: t("decisionRights.matrix.submit") }));
    await waitFor(() => expect(api.requests.some((q) => q.method === "POST")).toBe(true));
    const post = api.requests.find((q) => q.method === "POST")!;
    expect(post.headers["if-match"]).toBe('"7"');
    expect((post.body as { title: string }).title).toContain("TR-");
  });

  it("decision rights: a field with an unknown party code is refused before sending", async () => {
    const row = decisionRight();
    const api = mockApi(
      ...p4Handlers(
        locale,
        ["decision_right.configure"],
        [
          partiesRoute,
          route("GET", new RegExp(`${esc(TRP)}/decision-rights\\?`), () => page([row])),
          route("GET", /governance-matrices$/, () => json({ items: [matrix("decision_rights")] })),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/decision-rights`, { i18n: createI18n(locale) });
    const tr = (await screen.findByText(locale === "ar" ? row.decisionAr : row.decisionEn)).closest("tr")!;
    fireEvent.click(within(tr).getByRole("button", { name: new RegExp(t("common.action.edit")) }));
    const dialog = await screen.findByRole("dialog");
    const consult = within(dialog).getByLabelText(label(t("decisionRights.edit.consultParties")));
    fireEvent.change(consult, { target: { value: "BO, fin-x" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.action.save") }));
    await waitFor(() => expect(consult.getAttribute("aria-invalid")).toBe("true"));
    expect(api.requests.some((q) => q.method === "PATCH")).toBe(false);
  });

  it("Transform readiness lists what is missing and links to the fix", async () => {
    mockApi(
      ...p4Handlers(
        locale,
        [],
        [
          route("GET", /readiness\/transform$/, () =>
            json({
              transformationId: TR_ID,
              phase: "transform",
              status: "not_ready",
              checks: [
                { code: "charter_decision_rights", passed: true, missing: [] },
                { code: "t11_seeded_decisions", passed: true, missing: [] },
                { code: "t11_approvers_mapped", passed: false, missing: ["SP"] },
                { code: "t12_accountable", passed: true, missing: [] },
              ],
            }),
          ),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/transform-readiness`, { i18n: createI18n(locale) });
    const status = await screen.findByText(t("decisionRights.readiness.status.not_ready"));
    expect(status.closest("[data-readiness]")?.getAttribute("data-readiness")).toBe("not_ready");
    const failing = document.querySelector("[data-check='t11_approvers_mapped']")!;
    expect(failing.getAttribute("data-passed")).toBe("false");
    expect(failing.textContent).toContain("SP");
    expect(
      within(failing as HTMLElement)
        .getByRole("link")
        .getAttribute("href"),
    ).toBe(`/transformations/${TR_ID}/role-mappings`);
  });
});
