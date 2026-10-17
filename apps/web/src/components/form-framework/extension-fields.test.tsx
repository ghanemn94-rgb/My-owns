// Extension fields on every native form and the template header (T-DG5-FE-C2; D-163; F-DG5-QA-A-2, F-DG5-QA-A-4;
// REQ-S06-004, REQ-PB-011; ADR-0041 §1, §4, §5), with STUBBED responses, in English (LTR) and Arabic (RTL).
// SYNTHETIC data; nothing here grants or records a G1-G6 business approval, and no DG0-DG7 label is shown.
//  - The web's own check uses the API's validators: a well-formed number outside min/max names the limit (en, ar),
//    and the server's range refusal (`validation.decimal` at /values/<key>) is shown the same way; a malformed number
//    keeps the decimal-format text.
//  - T13 (the A06 case): the pinned version's extension field is offered in the stakeholder-group create form; an
//    out-of-range value stops the create (no request); a valid one creates the group, then stores the value with
//    putFormRecordCustomFields and If-Match "0"; the record view shows the stored value; Form tools edits it with the
//    value's If-Match; a server refusal after the create is shown by its problem code.
//  - REQ-PB-011: the template's question-tag header (TemplateProvenance) on the T02-T16 forms.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Permission } from "@mth/shared";
import type { FormField, FormSchema } from "@mth/shared/schemas";
import { createI18n } from "../../i18n/index.ts";
import { TR_ID, USER_ID, mockApi, problem, renderApp, route, type RecordedRequest } from "../../test/fixtures.tsx";
import { TRP, esc, json, p4Handlers, page } from "../../pages/my-work/p4fixtures.ts";
import { GROUP_ID, group, plan } from "../../pages/adoption/adoptionFixtures.ts";
import { roadmapView } from "../../pages/prioritization/fe-b.fixtures.tsx";
import { checkExtensionValue, extensionErrorKey, rangeLimitsOf } from "./api.ts";
import { extensionValueText } from "./ExtensionEntry.tsx";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const FSV = "01920000-0000-7000-9000-0000000f5013";
const NEW_GROUP_ID = "01920000-0000-7000-b000-0000000000f1";
const T0 = "2026-10-15T08:00:00Z";
const NO_DG = /\bDG[0-7]\b/;
/** Waits until `selector` matches (retrying), then returns the element. */
const el = (selector: string) =>
  waitFor(() => {
    const x = document.querySelector(selector);
    expect(x, selector).toBeTruthy();
    return x as HTMLElement;
  });

const field = (over: Partial<FormField> = {}): FormField => ({
  key: "qa_stakeholder_score",
  origin: "admin",
  protected: false,
  extension: true,
  fieldType: "number",
  labelEn: "Synthetic stakeholder score",
  labelAr: "درجة صاحب مصلحة تجريبية",
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

const schemaOf = (code: string, fields: FormField[]): FormSchema => ({
  recordType: {
    code,
    ordinal: 13,
    kind: "template",
    titleEn: "Template 13 — Stakeholder & Adoption Plan",
    titleAr: "النموذج 13 — خطة أصحاب المصلحة والتبنّي",
    titleArProvisional: true,
    sourceRef: "B0106",
    writePermission: "adoption.edit",
    extensionBadge: false,
    customFieldsAllowed: true,
    bulkEditAllowed: true,
    featureStatus: "working",
  },
  formSchemaVersionId: FSV,
  versionNo: 2,
  labelEn: "Stakeholder & Adoption Plan",
  labelAr: "خطة أصحاب المصلحة والتبنّي",
  helpEn: null,
  helpAr: null,
  fields,
});

const custom = (recordId: string, version: number, values: Record<string, unknown>) => ({
  recordType: "T13",
  recordId,
  formSchemaVersionId: FSV,
  values,
  calculated: {},
  version,
  updatedAt: version ? T0 : null,
  updatedBy: version ? USER_ID : null,
});

describe("extension value checks (F-DG5-QA-A-4)", () => {
  it("a well-formed number outside min/max is a range refusal naming the limit; a malformed one is not", () => {
    const f = field();
    expect(checkExtensionValue(f, "80", "SAR")).toEqual({ ok: true });
    expect(checkExtensionValue(f, "150", "SAR")).toEqual({
      ok: false,
      code: "validation.decimal",
      range: { min: "0", max: "100" },
    });
    expect(checkExtensionValue(f, "1,5", "SAR")).toEqual({ ok: false, code: "validation.decimal" });
    expect(checkExtensionValue(f, "", "SAR")).toEqual({ ok: true });
    expect(checkExtensionValue(field({ required: true }), " ", "SAR")).toEqual({
      ok: false,
      code: "validation.required",
    });
    // Percentage limits are fractions; the user reads them as percents (decimal.js, never a float).
    const pct = field({ fieldType: "percentage", settings: { min: "0", max: "0.5" } });
    expect(rangeLimitsOf(pct)).toEqual({ min: "0%", max: "50%" });
    expect(checkExtensionValue(pct, "0.8", "SAR")).toMatchObject({ code: "validation.percentage" });
  });

  it("the server's range refusal is shown with the limit; other codes stay themselves", () => {
    const f = field({ settings: { max: "50" } });
    expect(extensionErrorKey("validation.decimal", f, "80", "SAR")).toEqual({
      key: "forms.extensions.range.max",
      params: { max: "50" },
    });
    expect(extensionErrorKey("validation.decimal", field(), "150", "SAR")).toEqual({
      key: "forms.extensions.range.between",
      params: { min: "0", max: "100" },
    });
    expect(extensionErrorKey("validation.decimal", f, "abc", "SAR")).toEqual({ code: "validation.decimal" });
    expect(extensionErrorKey("form_record.custom_field_unknown", f, "80", "SAR")).toEqual({
      code: "form_record.custom_field_unknown",
    });
  });

  it("shows stored values in the screen's language: percents, currency, choice labels", () => {
    expect(extensionValueText(field({ fieldType: "percentage" }), "0.12", "en")).toBe("12%");
    expect(
      extensionValueText(field({ fieldType: "currency" }), { amount: "1500000.10", currencyCode: "SAR" }, "ar"),
    ).toBe("1500000.10 SAR");
    const choice = field({
      fieldType: "choice",
      settings: { options: [{ value: "h", labelEn: "High", labelAr: "مرتفع" }] },
    });
    expect(extensionValueText(choice, "h", "ar")).toBe("مرتفع");
    expect(extensionValueText(field(), null, "en")).toBeNull();
  });
});

describe.each(["en", "ar"] as const)("T13 extension fields (%s)", (locale) => {
  const t = createI18n(locale).t;
  const WRITER: Permission[] = ["adoption.edit", "form_record.comment"];
  const CF = (id: string) => `${TRP}/form-records/T13/${id}/custom-fields`;
  const t13Routes = (extra: ReturnType<typeof route>[] = []) => [
    route("GET", new RegExp(`${esc(TRP)}/adoption-plan$`), () => json(plan())),
    route("GET", new RegExp(`${esc(TRP)}/stakeholder-groups\\?`), () => page([group()])),
    route("GET", new RegExp(`${esc(TRP)}/form-schemas/T13$`), () => json(schemaOf("T13", [field()]))),
    route("GET", new RegExp(`${esc(CF(GROUP_ID))}$`), () => json(custom(GROUP_ID, 1, { qa_stakeholder_score: "42" }))),
    route("GET", new RegExp(`${esc(TRP)}/form-drafts\\?`), () => page([])),
    ...extra,
  ];
  const fillGroup = (dialog: HTMLElement) => {
    const set = (name: string, value: string) =>
      fireEvent.change(dialog.querySelector(`[data-field='${name}']`)!, { target: { value } });
    set("name", "Synthetic agents");
    set("impact", "M");
    set("currentStance", "neutral");
    set("requiredBehavior", "Synthetic behaviour");
    fireEvent.click(within(dialog).getByLabelText(new RegExp(t("adoptionP4.intervention.comms"))));
  };
  const extInput = (root: HTMLElement) =>
    root.querySelector("[data-extension-field='qa_stakeholder_score'] input") as HTMLInputElement;

  it("the record view shows the stored value; Form tools offers the field with its value", async () => {
    mockApi(...p4Handlers(locale, WRITER, t13Routes()));
    renderApp(`/transformations/${TR_ID}/adoption`, { i18n: createI18n(locale) });
    const cell = await waitFor(() => {
      const el = document.querySelector("[data-extension-values='T13'] [data-extension-value='qa_stakeholder_score']");
      expect(el?.textContent).toContain("42");
      return el as HTMLElement;
    });
    expect(cell.textContent).toContain(locale === "en" ? "Synthetic stakeholder score" : "درجة صاحب مصلحة تجريبية");
    fireEvent.click(document.querySelector(`[data-form-tools='${GROUP_ID}']`)!);
    const ff = await waitFor(() => {
      const el = document.querySelector("[data-form-framework='T13']");
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    await waitFor(() => expect(extInput(ff)?.value).toBe("42"));
    // The register's own edit dialog edits the source fields; the framework shows only the extension fields.
    expect(ff.querySelector("fieldset[hidden]")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(NO_DG);
  });

  it("Form tools: an out-of-range value names the limit and sends nothing; a valid one is saved with If-Match", async () => {
    const { requests } = mockApi(
      ...p4Handlers(
        locale,
        WRITER,
        t13Routes([
          route("PUT", new RegExp(`${esc(CF(GROUP_ID))}$`), () =>
            json(custom(GROUP_ID, 2, { qa_stakeholder_score: "60" })),
          ),
        ]),
      ),
    );
    renderApp(`/transformations/${TR_ID}/adoption`, { i18n: createI18n(locale) });
    fireEvent.click(await el(`[data-form-tools='${GROUP_ID}']`));
    const ff = await el("[data-form-framework='T13']");
    await waitFor(() => expect(extInput(ff)?.value).toBe("42"));
    fireEvent.change(extInput(ff), { target: { value: "150" } });
    fireEvent.click(within(ff).getByRole("button", { name: t("forms.edit.save") }));
    await waitFor(() => expect(extInput(ff).getAttribute("aria-invalid")).toBe("true"));
    expect(ff.textContent).toContain(t("forms.extensions.range.between", { min: "0", max: "100" }));
    expect(ff.textContent).not.toContain(t("problems.validation__decimal"));
    expect(requests.filter((r) => r.method === "PUT")).toHaveLength(0);
    fireEvent.change(extInput(ff), { target: { value: "60" } });
    fireEvent.click(within(ff).getByRole("button", { name: t("forms.edit.save") }));
    await waitFor(() => expect(requests.filter((r) => r.method === "PUT")).toHaveLength(1));
    const put = requests.find((r) => r.method === "PUT")!;
    expect(put.headers["if-match"]).toBe('"1"');
    expect(put.body).toEqual({ values: { qa_stakeholder_score: "60" } });
  });

  it("a server range refusal in Form tools names the limit (the server's validation.decimal)", async () => {
    mockApi(
      ...p4Handlers(locale, WRITER, [
        // The served settings carry no max (the web's check passes); the server refuses with its range code.
        route("GET", new RegExp(`${esc(TRP)}/form-schemas/T13$`), () =>
          json(schemaOf("T13", [field({ settings: {} })])),
        ),
        route("PUT", new RegExp(`${esc(CF(GROUP_ID))}$`), () =>
          problem(400, "validation", {
            errors: [{ pointer: "/values/qa_stakeholder_score", code: "validation.decimal", message: "x" }],
          }),
        ),
        ...t13Routes(),
      ]),
    );
    renderApp(`/transformations/${TR_ID}/adoption`, { i18n: createI18n(locale) });
    fireEvent.click(await el(`[data-form-tools='${GROUP_ID}']`));
    const ff = await el("[data-form-framework='T13']");
    await waitFor(() => expect(extInput(ff)?.value).toBe("42"));
    fireEvent.change(extInput(ff), { target: { value: "1.2345678" } });
    fireEvent.click(within(ff).getByRole("button", { name: t("forms.edit.save") }));
    await waitFor(() => expect(extInput(ff).getAttribute("aria-invalid")).toBe("true"));
    // Not a range case (no limit served): the server's code is shown as itself, translated.
    expect(ff.textContent).toContain(t("problems.validation__decimal"));
  });

  it("create: the field is offered; out of range stops the create; a valid value is stored with If-Match 0", async () => {
    const { requests } = mockApi(
      ...p4Handlers(
        locale,
        WRITER,
        t13Routes([
          route("POST", new RegExp(`${esc(TRP)}/stakeholder-groups$`), () => ({
            status: 201,
            body: group({ id: NEW_GROUP_ID, code: "SG-02", name: "Synthetic agents" }),
          })),
          route("PUT", new RegExp(`${esc(CF(NEW_GROUP_ID))}$`), () =>
            json(custom(NEW_GROUP_ID, 1, { qa_stakeholder_score: "80" })),
          ),
        ]),
      ),
    );
    renderApp(`/transformations/${TR_ID}/adoption`, { i18n: createI18n(locale) });
    await waitFor(() => expect(document.querySelector("[data-extension-values='T13']")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: t("adoptionP4.groups.create") }));
    const dialog = await screen.findByRole("dialog");
    const input = await waitFor(() => {
      const el = dialog.querySelector(
        "[data-extension-create='T13'] [data-extension-field='qa_stakeholder_score'] input",
      );
      expect(el).toBeTruthy();
      return el as HTMLInputElement;
    });
    expect(
      within(dialog).getByLabelText(locale === "en" ? "Synthetic stakeholder score" : "درجة صاحب مصلحة تجريبية"),
    ).toBe(input);
    fillGroup(dialog);
    fireEvent.change(input, { target: { value: "150" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("adoptionP4.groups.createSubmit") }));
    await waitFor(() => expect(input.getAttribute("aria-invalid")).toBe("true"));
    expect(dialog.textContent).toContain(t("forms.extensions.range.between", { min: "0", max: "100" }));
    expect(requests.filter((r) => r.method === "POST")).toHaveLength(0);

    fireEvent.change(input, { target: { value: "80" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("adoptionP4.groups.createSubmit") }));
    await waitFor(() => expect(requests.filter((r: RecordedRequest) => r.method === "PUT")).toHaveLength(1));
    const post = requests.find((r) => r.method === "POST")!;
    const put = requests.find((r) => r.method === "PUT")!;
    expect(requests.indexOf(post)).toBeLessThan(requests.indexOf(put));
    expect(put.url).toContain(`/form-records/T13/${NEW_GROUP_ID}/custom-fields`);
    expect(put.headers["if-match"]).toBe('"0"');
    expect(put.body).toEqual({ values: { qa_stakeholder_score: "80" } });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.querySelector("[data-state='extension-save-failed']")).toBeNull();
  });

  it("create: a server refusal of the values after the create is shown by its problem code", async () => {
    mockApi(
      ...p4Handlers(
        locale,
        WRITER,
        t13Routes([
          route("POST", new RegExp(`${esc(TRP)}/stakeholder-groups$`), () => ({
            status: 201,
            body: group({ id: NEW_GROUP_ID, code: "SG-02", name: "Synthetic agents" }),
          })),
          route("PUT", new RegExp(`${esc(CF(NEW_GROUP_ID))}$`), () => problem(422, "form_record.custom_field_unknown")),
        ]),
      ),
    );
    renderApp(`/transformations/${TR_ID}/adoption`, { i18n: createI18n(locale) });
    await waitFor(() => expect(document.querySelector("[data-extension-values='T13']")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: t("adoptionP4.groups.create") }));
    const dialog = await screen.findByRole("dialog");
    const input = await waitFor(
      () => dialog.querySelector("[data-extension-field='qa_stakeholder_score'] input") as HTMLInputElement,
    );
    fillGroup(dialog);
    fireEvent.change(input, { target: { value: "80" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("adoptionP4.groups.createSubmit") }));
    const outcome = await waitFor(() => {
      const el = document.querySelector("[data-state='extension-save-failed']");
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    expect(outcome.textContent).toContain(t("forms.extensions.createdWithoutValues"));
    expect(outcome.textContent).toContain(t("problems.form_record__custom_field_unknown"));
  });

  it("an AUD-like reader sees the value and a read-only Form tools; the create form has no inputs to offer", async () => {
    mockApi(...p4Handlers(locale, ["transformation.read"], t13Routes()));
    renderApp(`/transformations/${TR_ID}/adoption`, { i18n: createI18n(locale) });
    await waitFor(() =>
      expect(document.querySelector("[data-extension-value='qa_stakeholder_score']")?.textContent).toContain("42"),
    );
    expect(screen.queryByRole("button", { name: t("adoptionP4.groups.create") })).toBeNull();
    fireEvent.click(document.querySelector(`[data-form-tools='${GROUP_ID}']`)!);
    const ff = await el("[data-form-framework='T13']");
    await waitFor(() => expect(ff.textContent).toContain(t("forms.framework.readOnly")));
    expect(within(ff).queryByRole("button", { name: t("forms.edit.save") })).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------ REQ-PB-011 headers

const sourceLinks = (code: string) =>
  route("GET", new RegExp(`/api/v1/methodology/templates/${code}/source-links`), () =>
    json({
      templateCode: code,
      methodologyVersion: { versionId: "01995000-0000-7000-8000-0000000000aa", key: "playbook", versionNo: 1 },
      items: [{ blockRef: "B0106", ordinal: 106, phaseCode: "mobilize", excerptEn: "Template", excerptAr: "النموذج" }],
    }),
  );

/** The T02-T16 forms (T10 is the dashboard read model, not a form) and the screen that carries each one's header. */
const HEADER_PAGES: readonly (readonly [string, string])[] = [
  ["T02", "define"],
  ["T03", "design"],
  ["T04", "decisions"],
  ["T07", "roadmap"],
  ["T08", "dependencies"],
  ["T09", "benefit-formulas"],
  ["T11", "decision-rights"],
  ["T12", "raci"],
  ["T13", "adoption"],
  ["T14", "benefits"],
  ["T15", "raid"],
  ["T16", "executive-decisions"],
];

describe.each(["en", "ar"] as const)("REQ-PB-011 template header on the native forms (%s)", (locale) => {
  it.each(HEADER_PAGES)("%s: the form header carries the template's provenance strip (/%s)", async (code, path) => {
    mockApi(
      ...p4Handlers(
        locale,
        ["transformation.read"],
        [
          sourceLinks(code),
          route("GET", new RegExp(`${esc(TRP)}/adoption-plan$`), () => json(plan())),
          route("GET", new RegExp(`${esc(TRP)}/tom-canvas$`), () => json({ cells: [] })),
          route("GET", new RegExp(`${esc(TRP)}/roadmap$`), () => json(roadmapView())),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/${path}`, { i18n: createI18n(locale) });
    const strip = await waitFor(
      () => {
        const el = document.querySelector(`[data-template-provenance='${code}']`);
        expect(el).toBeTruthy();
        return el as HTMLElement;
      },
      { timeout: 5000 },
    );
    expect(strip.querySelector("[data-source-link='B0106']")).toBeTruthy();
  });
});
