// The common form framework (T-DG5-FE-C; ADR-0041 §5-§7; REQ-S05-001, REQ-S05-006) on the T14 benefit page, with
// STUBBED responses, in English (LTR) and Arabic (RTL). The live T01/T14 paths are e2e/p5-forms.spec.ts. SYNTHETIC
// data; a draft, a comment or an attachment approves nothing (no G1-G6 business approval, never DG0-DG7).
//  - REQ-S05-001 "a saved draft reopens": Save draft posts createFormDraft (recordId, baseRecordVersion, payload) and
//    says "Draft saved — not submitted"; an open draft reopens with its values; a moved base shows the comparison.
//  - "a new version is listed in history": the history tab lists versions with the changed fields' labels.
//  - "a comment and attachment persist": a comment, a reply, an attachment, and a removal that needs a reason.
//  - "export returns the rows": the preview counts the rows; Unknown is marked, never 0; 422 too_large is translated.
//  - "a conflicting concurrent save returns a recoverable conflict": a 409 shows mine vs current, and re-applies the
//    change with the current version's If-Match.
//  - Inline help and validation: the schema's help beside a field; a 400 field code lands on its field, translated.
//  - Permissions: a reader without benefit.edit and form_record.comment gets read-only views.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Permission } from "@mth/shared";
import type { FormDraft, FormField, FormSchema } from "@mth/shared/schemas";
import { createI18n } from "../../i18n/index.ts";
import { TR_ID, USER_ID, mockApi, problem, renderApp, route } from "../../test/fixtures.tsx";
import { BENEFIT_ID, benefit, lifecycle, allocations, values } from "../../pages/benefits/benefitsFixtures.ts";
import { TRP, esc, json, p4Handlers, page } from "../../pages/my-work/p4fixtures.ts";
import { problemKey } from "../../lib/problem.ts";
import { readDraftPayload, sameValue, threadsOf, valueFromText, valueToText } from "./api.ts";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const BP = `${TRP}/benefits/${BENEFIT_ID}`;
const FR = `${TRP}/form-records/T14/${BENEFIT_ID}`;
const FSV = "01920000-0000-7000-9000-0000000f5001";
const DRAFT_ID = "01920000-0000-7000-9000-0000000d4a01";
const COMMENT_ID = "01920000-0000-7000-9000-0000000c0001";
const EVIDENCE_ID = "01920000-0000-7000-9000-0000000e0001";
const ATTACH_ID = "01920000-0000-7000-9000-0000000a0001";
const T0 = "2026-10-15T08:00:00Z";

const field = (over: Partial<FormField>): FormField => ({
  key: "benefit",
  origin: "source",
  protected: true,
  extension: false,
  fieldType: "text",
  labelEn: "benefit",
  labelAr: "المنفعة",
  helpEn: "The benefit as the register names it.",
  helpAr: "المنفعة كما يسمّيها السجل.",
  required: false,
  bulkEditable: false,
  storageKind: "column",
  sourceRef: "M0142",
  ordinal: 2,
  settings: {},
  ...over,
});
const schema = (): FormSchema => ({
  recordType: {
    code: "T14",
    ordinal: 14,
    kind: "template",
    titleEn: "Template 14 — Benefits Register",
    titleAr: "النموذج 14 — سجل المنافع",
    titleArProvisional: true,
    sourceRef: "B0122",
    writePermission: "benefit.edit",
    extensionBadge: false,
    customFieldsAllowed: true,
    bulkEditAllowed: true,
    featureStatus: "working",
  },
  formSchemaVersionId: FSV,
  versionNo: 2,
  labelEn: "Benefits Register",
  labelAr: "سجل المنافع",
  helpEn: null,
  helpAr: null,
  fields: [
    field({}),
    field({
      key: "cost_centre",
      origin: "admin",
      protected: false,
      extension: true,
      labelEn: "Cost centre",
      labelAr: "مركز التكلفة",
      helpEn: "The synthetic cost centre that books the benefit.",
      helpAr: "مركز التكلفة الاصطناعي الذي يسجّل المنفعة.",
      storageKind: null,
      sourceRef: null,
      ordinal: null,
    }),
    field({
      key: "uplift",
      origin: "admin",
      protected: false,
      extension: true,
      fieldType: "percentage",
      labelEn: "Uplift",
      labelAr: "الزيادة",
      helpEn: null,
      helpAr: null,
      storageKind: null,
      sourceRef: null,
      ordinal: null,
      settings: { min: "0", max: "1" },
    }),
  ],
});
const customValues = (version = 0, values: Record<string, unknown> = {}) => ({
  recordType: "T14",
  recordId: BENEFIT_ID,
  formSchemaVersionId: FSV,
  values,
  calculated: {},
  version,
  updatedAt: version ? T0 : null,
  updatedBy: version ? USER_ID : null,
});
const draft = (over: Partial<FormDraft> = {}): FormDraft => ({
  id: DRAFT_ID,
  recordType: "T14",
  recordId: BENEFIT_ID,
  baseRecordVersion: 3,
  baseChanged: false,
  payload: { sourceFields: { title: "Synthetic churn reduction (draft)" }, customFieldValues: { cost_centre: "CC-7" } },
  status: "open",
  closedReason: null,
  closedAt: null,
  version: 1,
  createdAt: T0,
  updatedAt: T0,
  ...over,
});

const benefitRoutes = (b = benefit()) => [
  route("GET", new RegExp(`${esc(BP)}$`), () => json(b)),
  route("GET", new RegExp(`${esc(BP)}/lifecycle$`), () => json(lifecycle())),
  route("GET", new RegExp(`${esc(BP)}/allocations$`), () => json(allocations())),
  route("GET", new RegExp(`${esc(BP)}/values$`), () => json(values())),
];
const formRoutes = (opts: { drafts?: FormDraft[]; custom?: ReturnType<typeof customValues> } = {}) => [
  route("GET", new RegExp(`${esc(TRP)}/form-schemas/T14$`), () => json(schema())),
  route("GET", new RegExp(`${esc(FR)}/custom-fields$`), () => json(opts.custom ?? customValues())),
  route("GET", new RegExp(`${esc(TRP)}/form-drafts\\?`), () => page(opts.drafts ?? [])),
  route("GET", new RegExp(`${esc(FR)}/versions`), () =>
    page([
      {
        version: 1,
        action: "benefit.create",
        actorUserId: USER_ID,
        actorDisplayName: "Synthetic Lead",
        occurredAt: T0,
        changedFields: [],
      },
      {
        version: 2,
        action: "benefit.update",
        actorUserId: USER_ID,
        actorDisplayName: "Synthetic Lead",
        occurredAt: T0,
        changedFields: ["benefit"],
      },
    ]),
  ),
  route("GET", new RegExp(`${esc(FR)}/comments`), () =>
    page([
      {
        id: COMMENT_ID,
        recordType: "T14",
        recordId: BENEFIT_ID,
        parentCommentId: null,
        body: "Synthetic question about the baseline.",
        createdAt: T0,
        createdBy: USER_ID,
        createdByDisplayName: "Synthetic Lead",
      },
    ]),
  ),
  route("GET", new RegExp(`${esc(FR)}/attachments`), () =>
    page([
      {
        id: ATTACH_ID,
        store: "form_record_attachment",
        recordType: "T14",
        recordId: BENEFIT_ID,
        evidenceId: EVIDENCE_ID,
        evidenceTitle: "Synthetic churn report",
        status: "active",
        removedAt: null,
        removeReason: null,
        version: 1,
        createdAt: T0,
        createdBy: USER_ID,
      },
    ]),
  ),
];
const WRITER: Permission[] = ["benefit.edit", "form_record.comment", "evidence.create"];

async function framework() {
  return (await waitFor(() => {
    const el = document.querySelector("[data-form-framework='T14']");
    expect(el).toBeTruthy();
    return el!;
  })) as HTMLElement;
}
const openTab = async (root: HTMLElement, name: string) => {
  fireEvent.click(within(root).getByRole("tab", { name }));
};

describe("form framework helpers", () => {
  it("keeps decimals as text and Unknown as null, never 0", () => {
    const pct = { fieldType: "percentage" as const, settings: {} };
    expect(valueFromText(pct, "12%", "SAR")).toBe("12%");
    expect(valueFromText(pct, "  ", "SAR")).toBeNull();
    const cur = { fieldType: "currency" as const, settings: {} };
    expect(valueFromText(cur, "1500000.10", "SAR")).toEqual({ amount: "1500000.10", currencyCode: "SAR" });
    expect(valueToText(cur, { amount: "1500000.10", currencyCode: "SAR" })).toBe("1500000.10");
    expect(valueToText(pct, null)).toBe("");
    expect(sameValue({ currencyCode: "SAR", amount: "1" }, { amount: "1", currencyCode: "SAR" })).toBe(true);
    expect(sameValue(null, undefined)).toBe(true);
  });
  it("reads a draft payload defensively and threads one reply level", () => {
    expect(readDraftPayload({ sourceFields: { a: "x", b: 1 }, customFieldValues: [] })).toEqual({
      sourceFields: { a: "x" },
      customFieldValues: {},
      currencyCodes: {},
    });
    const c = (id: string, parent: string | null) => ({
      id,
      recordType: "T14",
      recordId: BENEFIT_ID,
      parentCommentId: parent,
      body: id,
      createdAt: T0,
      createdBy: USER_ID,
      createdByDisplayName: null,
    });
    expect(threadsOf([c("a", null), c("b", "a"), c("d", null)]).map((x) => [x.comment.id, x.replies.length])).toEqual([
      ["a", 1],
      ["d", 0],
    ]);
  });
});

describe.each(["en", "ar"] as const)("form framework on T14 (%s)", (locale) => {
  const t = createI18n(locale).t;

  it("shows inline help and the extension fields; Save draft stores a draft labelled not submitted", async () => {
    const { requests } = mockApi(
      ...p4Handlers(locale, WRITER, [
        ...benefitRoutes(),
        ...formRoutes(),
        route("POST", new RegExp(`${esc(TRP)}/form-drafts$`), () => ({ status: 201, body: draft() })),
      ]),
    );
    renderApp(`/transformations/${TR_ID}/benefits/${BENEFIT_ID}`, { i18n: createI18n(locale) });
    const root = await framework();
    const costCentre = await within(root).findByLabelText(locale === "en" ? "Cost centre" : "مركز التكلفة");
    // Inline help from the pinned schema, in the screen's language, next to the type hint.
    expect(root.textContent).toContain(
      locale === "en"
        ? "The synthetic cost centre that books the benefit."
        : "مركز التكلفة الاصطناعي الذي يسجّل المنفعة.",
    );
    expect(root.textContent).toContain(t("forms.edit.typeHint.percentage"));
    fireEvent.change(costCentre, { target: { value: "CC-9" } });
    fireEvent.click(within(root).getByRole("button", { name: t("forms.edit.saveDraft") }));
    await within(root).findByText(t("forms.edit.draftSaved"), { exact: false });
    const post = requests.find((r) => r.method === "POST" && r.url.endsWith("/form-drafts"))!;
    expect(post.body).toMatchObject({
      recordType: "T14",
      recordId: BENEFIT_ID,
      baseRecordVersion: 3,
      payload: { customFieldValues: { cost_centre: "CC-9" } },
    });
    // Nothing was written to the record.
    expect(requests.some((r) => r.method === "PATCH" || (r.url.endsWith("/custom-fields") && r.method === "PUT"))).toBe(
      false,
    );
  });

  it("a saved draft reopens with its values; a moved base shows the comparison and Update draft sends If-Match", async () => {
    const { requests } = mockApi(
      ...p4Handlers(locale, WRITER, [
        ...benefitRoutes(benefit({ version: 5 })),
        ...formRoutes({ drafts: [draft({ baseChanged: true })] }),
        route("PUT", new RegExp(`${esc(TRP)}/form-drafts/${DRAFT_ID}$`), () => json(draft({ version: 2 }))),
      ]),
    );
    renderApp(`/transformations/${TR_ID}/benefits/${BENEFIT_ID}`, { i18n: createI18n(locale) });
    const root = await framework();
    await waitFor(() => expect(root.querySelector("[data-draft-state='open-base-changed']")).toBeTruthy());
    expect(
      (within(root).getByLabelText(locale === "en" ? "Cost centre" : "مركز التكلفة") as HTMLInputElement).value,
    ).toBe("CC-7");
    expect(root.querySelector("[data-state='draft-open']")).toBeTruthy();
    const conflict = root.querySelector("[data-state='conflict']") as HTMLElement;
    expect(conflict.textContent).toContain("Synthetic churn reduction (draft)");
    fireEvent.click(within(root).getByRole("button", { name: t("forms.edit.updateDraft") }));
    await waitFor(() => expect(requests.some((r) => r.method === "PUT" && r.url.includes("/form-drafts/"))).toBe(true));
    const put = requests.find((r) => r.method === "PUT" && r.url.includes("/form-drafts/"))!;
    expect(put.headers["if-match"]).toBe('"1"');
  });

  it("a conflicting concurrent save returns a recoverable conflict and re-applies on the current version", async () => {
    let version = 3;
    const { requests } = mockApi(
      ...p4Handlers(locale, WRITER, [
        route("GET", new RegExp(`${esc(BP)}$`), () =>
          json(benefit(version === 3 ? { version } : { version, description: "Synthetic: changed by someone else" })),
        ),
        ...benefitRoutes().slice(1),
        ...formRoutes(),
        route("PATCH", new RegExp(`${esc(BP)}$`), (req) => {
          if (req.headers["if-match"] === '"3"') {
            version = 4;
            return problem(409, "version_conflict", { currentVersion: 4 });
          }
          return json(benefit({ version: 5, title: "Synthetic churn reduction v2" }));
        }),
      ]),
    );
    renderApp(`/transformations/${TR_ID}/benefits/${BENEFIT_ID}`, { i18n: createI18n(locale) });
    const root = await framework();
    const title = (await within(root).findByLabelText(t("benefitsP4.field.title"))) as HTMLInputElement;
    fireEvent.change(title, { target: { value: "Synthetic churn reduction v2" } });
    fireEvent.click(within(root).getByRole("button", { name: t("forms.edit.save") }));
    const conflict = await waitFor(() => {
      const c = root.querySelector("[data-state='conflict']");
      expect(c).toBeTruthy();
      return c as HTMLElement;
    });
    expect(conflict.textContent).toContain("Synthetic churn reduction v2");
    // The typed value is kept while the record is re-read.
    expect(title.value).toBe("Synthetic churn reduction v2");
    await waitFor(() =>
      expect(requests.filter((r) => r.method === "GET" && /benefits\/[^/]+$/.test(r.url)).length).toBeGreaterThan(1),
    );
    fireEvent.click(within(conflict).getByRole("button", { name: t("common.conflict.reapply") }));
    await waitFor(() => expect(requests.filter((r) => r.method === "PATCH")).toHaveLength(2));
    expect(requests.filter((r) => r.method === "PATCH")[1]!.headers["if-match"]).toBe('"4"');
    // Only the user's own change is re-applied: the other user's description is never sent back (stale copy).
    expect(requests.filter((r) => r.method === "PATCH").map((r) => r.body)).toEqual([
      { title: "Synthetic churn reduction v2" },
      { title: "Synthetic churn reduction v2" },
    ]);
    await within(root).findByText(t("forms.edit.saved"), { exact: false });
  });

  it("a 400 field code lands on its extension field, translated", async () => {
    mockApi(
      ...p4Handlers(locale, WRITER, [
        ...benefitRoutes(),
        ...formRoutes(),
        route("PUT", new RegExp(`${esc(FR)}/custom-fields$`), () =>
          problem(400, "validation.failed", {
            errors: [{ pointer: "/values/uplift", code: "validation.percentage", message: "x" }],
          }),
        ),
      ]),
    );
    renderApp(`/transformations/${TR_ID}/benefits/${BENEFIT_ID}`, { i18n: createI18n(locale) });
    const root = await framework();
    fireEvent.change(await within(root).findByLabelText(locale === "en" ? "Uplift" : "الزيادة"), {
      // T-DG5-FE-C2: a value the web's own check accepts, so the server's stubbed 400 code is what lands on the field.
      target: { value: "0.5" },
    });
    fireEvent.click(within(root).getByRole("button", { name: t("forms.edit.save") }));
    await waitFor(() =>
      expect(root.querySelector("[data-extension-field='uplift']")!.textContent).toContain(
        t(problemKey("validation.percentage")),
      ),
    );
  });

  it("history lists versions with changed fields; comments post and reply; attachments need a reason to remove", async () => {
    const { requests } = mockApi(
      ...p4Handlers(locale, WRITER, [
        ...benefitRoutes(),
        ...formRoutes(),
        route("POST", new RegExp(`${esc(FR)}/comments$`), () => ({ status: 201, body: {} })),
        route("POST", new RegExp(`${esc(FR)}/attachments/${ATTACH_ID}/remove$`), () => json({})),
      ]),
    );
    renderApp(`/transformations/${TR_ID}/benefits/${BENEFIT_ID}`, { i18n: createI18n(locale) });
    const root = await framework();
    await openTab(root, t("forms.framework.tabs.history"));
    const history = await within(root).findByRole("table", { name: t("forms.history.caption") });
    expect(history.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(history.querySelector("[data-version='2']")!.textContent).toContain(locale === "en" ? "benefit" : "المنفعة");

    await openTab(root, t("forms.framework.tabs.comments"));
    await within(root).findByText("Synthetic question about the baseline.");
    fireEvent.change(within(root).getByLabelText(t("forms.comments.label")), {
      target: { value: "Synthetic follow-up" },
    });
    fireEvent.click(within(root).getByRole("button", { name: t("forms.comments.post") }));
    await waitFor(() => expect(requests.some((r) => r.method === "POST" && r.url.endsWith("/comments"))).toBe(true));
    fireEvent.click(within(root).getByRole("button", { name: t("forms.comments.reply") }));
    fireEvent.change(within(root).getByLabelText(t("forms.comments.replyLabel")), { target: { value: "Reply" } });
    fireEvent.click(within(root).getByRole("button", { name: t("forms.comments.postReply") }));
    await waitFor(() =>
      expect(requests.filter((r) => r.method === "POST" && r.url.endsWith("/comments")).map((r) => r.body)).toEqual([
        { body: "Synthetic follow-up" },
        { body: "Reply", parentCommentId: COMMENT_ID },
      ]),
    );

    await openTab(root, t("forms.framework.tabs.attachments"));
    await within(root).findByText("Synthetic churn report");
    fireEvent.click(within(root).getByRole("button", { name: new RegExp(t("forms.attachments.remove")) }));
    fireEvent.change(within(root).getByLabelText(new RegExp(t("forms.attachments.reason"))), {
      target: { value: "Synthetic: superseded" },
    });
    fireEvent.click(within(root).getByRole("button", { name: t("forms.attachments.confirmRemove") }));
    await waitFor(() => expect(requests.some((r) => r.url.endsWith("/remove"))).toBe(true));
    const remove = requests.find((r) => r.url.endsWith("/remove"))!;
    expect(remove.body).toEqual({ reason: "Synthetic: superseded" });
    expect(remove.headers["if-match"]).toBe('"1"');
  });

  it("a reader without benefit.edit and form_record.comment sees read-only views", async () => {
    mockApi(...p4Handlers(locale, [], [...benefitRoutes(), ...formRoutes()]));
    renderApp(`/transformations/${TR_ID}/benefits/${BENEFIT_ID}`, { i18n: createI18n(locale) });
    const root = await framework();
    await within(root).findByText(t("forms.framework.readOnly"));
    expect(within(root).queryByRole("button", { name: t("forms.edit.saveDraft") })).toBeNull();
    expect(within(root).queryByRole("button", { name: t("forms.edit.save") })).toBeNull();
    await openTab(root, t("forms.framework.tabs.comments"));
    await within(root).findByText(t("forms.comments.noPermission"));
    expect(within(root).queryByRole("button", { name: t("forms.comments.post") })).toBeNull();
  });

  it("export previews the rows with Unknown marked (never 0) and translates 422 form_export.too_large", async () => {
    let tooLarge = false;
    mockApi(
      ...p4Handlers(locale, WRITER, [
        ...benefitRoutes(),
        ...formRoutes(),
        route("GET", new RegExp(`${esc(TRP)}/form-records/T14/export`), () =>
          tooLarge
            ? problem(422, "form_export.too_large")
            : json({
                recordType: "T14",
                formSchemaVersionId: FSV,
                language: locale,
                columns: [
                  {
                    key: "benefit",
                    label: locale === "en" ? "benefit" : "المنفعة",
                    fieldType: "text",
                    extension: false,
                  },
                  {
                    key: "target",
                    label: locale === "en" ? "target" : "المستهدف",
                    fieldType: "number",
                    extension: false,
                  },
                ],
                rows: [
                  {
                    recordId: BENEFIT_ID,
                    version: 3,
                    values: { benefit: "Synthetic churn reduction", target: null },
                    statuses: { target: "unknown" },
                  },
                ],
              }),
        ),
      ]),
    );
    renderApp(`/transformations/${TR_ID}/benefits/${BENEFIT_ID}`, { i18n: createI18n(locale) });
    await framework();
    fireEvent.click(document.querySelector("[data-export='T14']")!);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.querySelector("[data-export-rows='1']")).toBeTruthy());
    const cell = dialog.querySelector("td[data-status='unknown']")!;
    expect(cell.textContent).toContain(t("forms.export.unknown"));
    expect(cell.textContent).not.toContain("0");
    expect(dialog.querySelector("[data-download='csv']")!.getAttribute("href")).toContain("format=csv");
    tooLarge = true;
    fireEvent.change(within(dialog).getByLabelText(t("forms.export.language")), {
      target: { value: locale === "en" ? "ar" : "en" },
    });
    await waitFor(() =>
      expect(dialog.querySelector("[data-problem='form_export.too_large']")!.textContent).toContain(
        t(problemKey("form_export.too_large")),
      ),
    );
  });
});
