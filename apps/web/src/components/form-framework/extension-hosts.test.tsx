// Extension fields on the remaining native forms and the T05/T06 template headers (T-DG5-FE-C3; D-164; F-DG5-QA-A-2;
// REQ-S06-004, REQ-PB-011; ADR-0041 §1, §4, §5), with STUBBED responses, in English (LTR) and Arabic (RTL).
// SYNTHETIC data; nothing here grants or records a G1-G6 business approval, and no DG0-DG7 label is shown.
//  - One create path per dialog family that FE-C3 hosts: a `P4FormDialog` (lesson), a custom dialog (business case);
//    each checks the value before the create (no request when out of range), then stores it after the create with
//    putFormRecordCustomFields and If-Match "0"; a refusal after the create is shown on the register by its code.
//  - A record view in a register (BAU handover) for a reader: the stored value, never 0 for a missing one.
//  - REQ-PB-011: the question-tag header on T05 (initiative card) and T06 (scorecard), which FE-C2 left untested.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Permission } from "@mth/shared";
import type { FormField, FormSchema } from "@mth/shared/schemas";
import { createI18n } from "../../i18n/index.ts";
import { TR_ID, USER_ID, mockApi, problem, renderApp, route } from "../../test/fixtures.tsx";
import { TRP, esc, json, p4Handlers, page } from "../../pages/my-work/p4fixtures.ts";
import { HANDOVER_ID, handover } from "../../pages/adoption/adoptionFixtures.ts";
import { frameHandlers, initiative } from "../../pages/portfolio/p3fixtures.ts";
import { prioritizationView, renderWorkspace, grants, V1 } from "../../pages/prioritization/fe-b.fixtures.tsx";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const FSV = "01920000-0000-7000-9000-0000000f5c03";
const NEW_ID = "01920000-0000-7000-b000-0000000000c3";
const T0 = "2026-10-15T08:00:00Z";
const NO_DG = /\bDG[0-7]\b/;
const KEY = "qa_c3_score";

const field = (over: Partial<FormField> = {}): FormField => ({
  key: KEY,
  origin: "admin",
  protected: false,
  extension: true,
  fieldType: "number",
  labelEn: "Synthetic C3 score",
  labelAr: "درجة تجريبية C3",
  helpEn: null,
  helpAr: null,
  required: false,
  bulkEditable: false,
  storageKind: null,
  sourceRef: null,
  ordinal: null,
  settings: { min: "0", max: "100" },
  ...over,
});

const schemaOf = (code: string, writePermission: string, fields: FormField[]): FormSchema => ({
  recordType: {
    code,
    ordinal: 30,
    kind: code === "business_case" ? "source_deliverable" : "extension",
    titleEn: code,
    titleAr: code,
    titleArProvisional: true,
    sourceRef: "M0149",
    writePermission,
    extensionBadge: code !== "business_case",
    customFieldsAllowed: true,
    bulkEditAllowed: false,
    featureStatus: "working",
  },
  formSchemaVersionId: FSV,
  versionNo: 2,
  labelEn: code,
  labelAr: code,
  helpEn: null,
  helpAr: null,
  fields,
});

const custom = (recordType: string, recordId: string, version: number, values: Record<string, unknown>) => ({
  recordType,
  recordId,
  formSchemaVersionId: FSV,
  values,
  calculated: {},
  version,
  updatedAt: version ? T0 : null,
  updatedBy: version ? USER_ID : null,
});

const CF = (recordType: string, id: string) => `${TRP}/form-records/${recordType}/${id}/custom-fields`;
const schemaRoute = (code: string, perm: string, fields: FormField[] = [field()]) =>
  route("GET", new RegExp(`${esc(TRP)}/form-schemas/${code}$`), () => json(schemaOf(code, perm, fields)));
const extInput = (root: ParentNode, recordType: string) =>
  waitFor(() => {
    const el = root.querySelector(`[data-extension-create='${recordType}'] [data-extension-field='${KEY}'] input`);
    expect(el, `${recordType} create input`).toBeTruthy();
    return el as HTMLInputElement;
  });

describe.each(["en", "ar"] as const)("extension fields on the remaining forms (%s)", (locale) => {
  const t = createI18n(locale).t;

  it("lesson (P4 dialog): out of range sends nothing; a valid value is stored after the create with If-Match 0", async () => {
    const { requests } = mockApi(
      ...p4Handlers(locale, ["lesson.edit", "form_record.comment"] as Permission[], [
        schemaRoute("lesson", "lesson.edit"),
        route("POST", new RegExp(`${esc(TRP)}/lessons$`), () => ({ status: 201, body: { id: NEW_ID, version: 1 } })),
        route("PUT", new RegExp(`${esc(CF("lesson", NEW_ID))}$`), () =>
          json(custom("lesson", NEW_ID, 1, { [KEY]: "70" })),
        ),
      ]),
    );
    renderApp(`/transformations/${TR_ID}/lessons`, { i18n: createI18n(locale) });
    fireEvent.click(await screen.findByRole("button", { name: t("sustainP4.lessons.create") }));
    const dialog = await screen.findByRole("dialog");
    const input = await extInput(dialog, "lesson");
    expect(within(dialog).getByLabelText(locale === "en" ? "Synthetic C3 score" : "درجة تجريبية C3")).toBe(input);
    fireEvent.change(dialog.querySelector("[data-field='title']")!, { target: { value: "Synthetic lesson" } });
    fireEvent.change(dialog.querySelector("[data-field='lessonText']")!, { target: { value: "Synthetic text" } });
    fireEvent.change(input, { target: { value: "150" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("sustainP4.lessons.createSubmit") }));
    await waitFor(() => expect(input.getAttribute("aria-invalid")).toBe("true"));
    expect(dialog.textContent).toContain(t("forms.extensions.range.between", { min: "0", max: "100" }));
    expect(requests.filter((r) => r.method !== "GET")).toHaveLength(0);

    fireEvent.change(input, { target: { value: "70" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("sustainP4.lessons.createSubmit") }));
    await waitFor(() => expect(requests.filter((r) => r.method === "PUT")).toHaveLength(1));
    const post = requests.find((r) => r.method === "POST")!;
    const put = requests.find((r) => r.method === "PUT")!;
    expect(requests.indexOf(post)).toBeLessThan(requests.indexOf(put));
    expect(post.body).not.toHaveProperty(KEY);
    expect(put.headers["if-match"]).toBe('"0"');
    expect(put.body).toEqual({ values: { [KEY]: "70" } });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.querySelector("[data-state='extension-save-failed']")).toBeNull();
    expect(document.body.textContent).not.toMatch(NO_DG);
  });

  it("business case (custom dialog): a valid value is stored after the create; a later refusal stays on the register", async () => {
    const { requests } = mockApi(
      ...p4Handlers(locale, ["business_case.edit", "form_record.comment"] as Permission[], [
        schemaRoute("business_case", "business_case.edit"),
        route("POST", /\/api\/v1\/business-cases$/, () => ({
          status: 201,
          body: { id: NEW_ID, code: "BC-01", version: 1 },
        })),
        route("PUT", new RegExp(`${esc(CF("business_case", NEW_ID))}$`), () =>
          problem(422, "form_record.custom_field_unknown"),
        ),
      ]),
    );
    renderApp(`/transformations/${TR_ID}/business-cases`, { i18n: createI18n(locale) });
    fireEvent.click(await screen.findByRole("button", { name: t("businessCases.create.action") }));
    const dialog = await screen.findByRole("dialog");
    const input = await extInput(dialog, "business_case");
    fireEvent.change(within(dialog).getByLabelText(new RegExp(t("businessCases.field.title"))), {
      target: { value: "Synthetic case" },
    });
    fireEvent.change(input, { target: { value: "150" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.action.create") }));
    await waitFor(() => expect(input.getAttribute("aria-invalid")).toBe("true"));
    expect(requests.filter((r) => r.method === "POST")).toHaveLength(0);

    fireEvent.change(input, { target: { value: "55" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.action.create") }));
    await waitFor(() => expect(requests.filter((r) => r.method === "PUT")).toHaveLength(1));
    const put = requests.find((r) => r.method === "PUT")!;
    expect(put.headers["if-match"]).toBe('"0"');
    expect(put.body).toEqual({ values: { [KEY]: "55" } });
    // The case exists, its values were refused: the register says so by the problem code, and does not navigate away.
    const outcome = await waitFor(() => {
      const el = document.querySelector("[data-state='extension-save-failed']");
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    expect(outcome.textContent).toContain(t("forms.extensions.createdWithoutValues"));
    expect(outcome.textContent).toContain(t("problems.form_record__custom_field_unknown"));
    expect(document.querySelector("#business-cases")).toBeTruthy();
  });

  it("BAU handover register: a reader sees the stored value and Unknown for a missing one, never 0", async () => {
    const OTHER = "01920000-0000-7000-b000-0000000000c4";
    mockApi(
      ...p4Handlers(locale, ["transformation.read"] as Permission[], [
        schemaRoute("bau_handover", "bau_handover.prepare"),
        route("GET", new RegExp(`${esc(TRP)}/bau-handovers\\?`), () =>
          page([handover(), handover({ id: OTHER, code: "HO-09" })]),
        ),
        route("GET", new RegExp(`${esc(CF("bau_handover", HANDOVER_ID))}$`), () =>
          json(custom("bau_handover", HANDOVER_ID, 1, { [KEY]: "42" })),
        ),
        route("GET", new RegExp(`${esc(CF("bau_handover", OTHER))}$`), () =>
          json(custom("bau_handover", OTHER, 0, {})),
        ),
      ]),
    );
    renderApp(`/transformations/${TR_ID}/bau-handovers`, { i18n: createI18n(locale) });
    const known = await waitFor(() => {
      const el = document.querySelector(`[data-extension-values='bau_handover'][data-record-id='${HANDOVER_ID}']`);
      expect(el?.textContent).toContain("42");
      return el as HTMLElement;
    });
    expect(known.textContent).toContain(locale === "en" ? "Synthetic C3 score" : "درجة تجريبية C3");
    const missing = await waitFor(() => {
      const el = document.querySelector(`[data-extension-values='bau_handover'][data-record-id='${OTHER}'] dd`);
      expect(el?.textContent).toContain(t("common.value.unknown"));
      return el as HTMLElement;
    });
    expect(missing.textContent).not.toMatch(/(^|\s)0(\s|$)/);
    // A reader without the write permission is offered no create button and no create inputs.
    expect(screen.queryByRole("button", { name: t("sustainP4.handover.create") })).toBeNull();
    expect(document.querySelector("[data-extension-create]")).toBeNull();
  });

  it("T01 fill dialog (a dimension without an item): the value is checked, then stored after the create", async () => {
    const { requests } = mockApi(
      ...p4Handlers(locale, ["diagnostic.edit", "form_record.comment"] as Permission[], [
        schemaRoute("T01", "diagnostic.edit"),
        route("POST", new RegExp(`${esc(TRP)}/diagnostic-items$`), () => ({
          status: 201,
          body: { id: NEW_ID, version: 1 },
        })),
        route("PUT", new RegExp(`${esc(CF("T01", NEW_ID))}$`), () => json(custom("T01", NEW_ID, 1, { [KEY]: "30" }))),
      ]),
    );
    renderApp(`/transformations/${TR_ID}/diagnose`, { i18n: createI18n(locale) });
    const fill = await waitFor(() => {
      const b = screen.getAllByRole("button", { name: new RegExp(`^\\s*${t("diagnose.t01.fill")}`) });
      expect(b.length).toBeGreaterThan(0);
      return b[0]!;
    });
    fireEvent.click(fill);
    const dialog = await screen.findByRole("dialog");
    const input = await extInput(dialog, "T01");
    fireEvent.change(within(dialog).getByLabelText(new RegExp(`^${t("diagnose.t01.currentState")}`)), {
      target: { value: "Synthetic current state" },
    });
    fireEvent.change(input, { target: { value: "150" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.action.saveDraft") }));
    await waitFor(() => expect(input.getAttribute("aria-invalid")).toBe("true"));
    expect(requests.filter((r) => r.method !== "GET")).toHaveLength(0);
    fireEvent.change(input, { target: { value: "30" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.action.saveDraft") }));
    await waitFor(() => expect(requests.filter((r) => r.method === "PUT")).toHaveLength(1));
    const put = requests.find((r) => r.method === "PUT")!;
    expect(requests.indexOf(requests.find((r) => r.method === "POST")!)).toBeLessThan(requests.indexOf(put));
    expect(put.url).toContain(`/form-records/T01/${NEW_ID}/custom-fields`);
    expect(put.headers["if-match"]).toBe('"0"');
    expect(put.body).toEqual({ values: { [KEY]: "30" } });
  });
});

// ------------------------------------------------------------------------------------------------ REQ-PB-011 T05/T06

const sourceLinks = (code: string, block: string) =>
  route("GET", new RegExp(`/api/v1/methodology/templates/${code}/source-links`), () =>
    json({
      templateCode: code,
      methodologyVersion: { versionId: "01995000-0000-7000-8000-0000000000aa", key: "playbook", versionNo: 1 },
      items: [{ blockRef: block, ordinal: 71, phaseCode: "prioritize", excerptEn: "Template", excerptAr: "النموذج" }],
    }),
  );

describe.each(["en", "ar"] as const)("REQ-PB-011 template header on T05 and T06 (%s)", (locale) => {
  it("T05: the initiative card's header carries the template's provenance strip", async () => {
    const ini = initiative({ code: "INI-01", name: "Synthetic initiative" });
    mockApi(
      ...frameHandlers(locale, "auditor", [
        sourceLinks("T05", "B0071"),
        route("GET", new RegExp(`/api/v1/initiatives/${ini.id}$`), () => json(ini)),
        route("GET", new RegExp(`/api/v1/initiatives/${ini.id}/deliverables`), () =>
          json({ items: [], countWarning: null }),
        ),
      ]),
    );
    renderApp(`/transformations/${TR_ID}/initiatives/${ini.id}`, { i18n: createI18n(locale) });
    const strip = await waitFor(
      () => {
        const el = document.querySelector("[data-template-provenance='T05']");
        expect(el).toBeTruthy();
        return el as HTMLElement;
      },
      { timeout: 5000 },
    );
    expect(strip.querySelector("[data-source-link='B0071']")).toBeTruthy();
    expect(strip.closest("section")?.querySelector(".t05-fields")).toBeTruthy();
  });

  it("T06: the scorecard's header carries the template's provenance strip", async () => {
    const P = `${TRP}/prioritization`;
    renderWorkspace("prioritization", locale, grants([]), [
      sourceLinks("T06", "B0075"),
      route("GET", new RegExp(`${esc(P)}(\\?.*)?$`), () => json(prioritizationView())),
      route("GET", new RegExp(`${esc(P)}/weight-sets$`), () => json({ items: [V1] })),
    ]);
    const strip = await waitFor(
      () => {
        const el = document.querySelector("#scorecard [data-template-provenance='T06']");
        expect(el).toBeTruthy();
        return el as HTMLElement;
      },
      { timeout: 5000 },
    );
    expect(strip.querySelector("[data-source-link='B0075']")).toBeTruthy();
  });
});
