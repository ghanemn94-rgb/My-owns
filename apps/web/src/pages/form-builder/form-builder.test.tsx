// The form builder (T-DG5-FE-C; ADR-0041 §1-§3; REQ-S05-002, REQ-S05-006) with STUBBED responses, in English (LTR)
// and Arabic (RTL). The live T03 add → publish and "delete gap" refusal is e2e/p5-forms.spec.ts. SYNTHETIC data; a
// form schema is configuration, never a G1-G6 business approval and never DG0-DG7.
//  - REQ-S05-006: the twelve extension record types carry the "Extension" badge in en and ar; templates do not.
//  - REQ-S05-002: source columns show "protected"; adding an extension field in an open draft sends PUT form_field
//    with origin admin, its type and settings, and If-Match on the draft; deleting a source column shows the server's
//    422 form_schema.source_column_protected, translated; a published version is read only.
//  - AUD (methodology.read only) sees no edit action.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Permission } from "@mth/shared";
import type { ConfigVersion, FormField, FormRecordType, FormSchema } from "@mth/shared/schemas";
import { EXTENSION_RECORD_TYPES } from "../../components/form-framework/ExtensionBadge.tsx";
import { createI18n } from "../../i18n/index.ts";
import { problemKey } from "../../lib/problem.ts";
import { ORG_ID, makeMe, mockApi, problem, renderApp, route } from "../../test/fixtures.tsx";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const grants = (permissions: Permission[]) => [
  { scope: { type: "organization" as const, id: ORG_ID }, inheritsDownward: false, permissions },
];
const ADM: Permission[] = ["organization.read", "methodology.read", "methodology.configure", "methodology.publish"];
const AUD: Permission[] = ["organization.read", "methodology.read"];
const meRoute = (permissions: Permission[], locale: "en" | "ar") =>
  route("GET", /\/api\/v1\/me$/, () => ({
    status: 200,
    body: makeMe(grants(permissions), { preferredLocale: locale }),
  }));
const page = <T,>(items: T[]) => ({ status: 200, body: { items, nextCursor: null } });
const json = (body: unknown) => ({ status: 200, body });
const rx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const V1 = "01920000-0000-7000-b000-0000000f0001";
const V2 = "01920000-0000-7000-b000-0000000f0002";

const rt = (over: Partial<FormRecordType>): FormRecordType => ({
  code: "T03",
  ordinal: 3,
  kind: "template",
  titleEn: "Template 3 — Capability Gap Assessment",
  titleAr: "النموذج 3 — تقييم فجوات القدرات",
  titleArProvisional: true,
  sourceRef: "B0057",
  writePermission: "tom.edit",
  extensionBadge: false,
  customFieldsAllowed: true,
  bulkEditAllowed: true,
  featureStatus: "working",
  ...over,
});
const types = (): FormRecordType[] => [
  rt({}),
  ...EXTENSION_RECORD_TYPES.map((code, i) =>
    rt({
      code,
      ordinal: 20 + i,
      kind: "extension",
      titleEn: `Synthetic extension ${code}`,
      titleAr: `امتداد اصطناعي ${code}`,
      extensionBadge: true,
      sourceRef: "M0149",
    }),
  ),
];
const version = (over: Partial<ConfigVersion>): ConfigVersion => ({
  id: V2,
  configKind: "form_schema",
  key: "forms",
  versionNo: 2,
  status: "draft",
  draftStage: "editing",
  origin: "draft",
  basedOnVersionId: V1,
  rollbackOfVersionId: null,
  titleEn: "Synthetic forms v2",
  titleAr: "النماذج الاصطناعية الإصدار 2",
  changeSummary: null,
  definition: {},
  contentSha256: "a".repeat(64),
  isNewestPublished: false,
  latestChecks: { preview: null, compatibility: null, sourceCoverage: null },
  pendingReviewId: null,
  reviewRequired: true,
  publishedAt: null,
  publishedBy: null,
  discardedAt: null,
  version: 7,
  createdAt: "2026-10-15T08:00:00Z",
  createdBy: null,
  updatedAt: "2026-10-15T08:00:00Z",
  updatedBy: null,
  ...over,
});
const gap: FormField = {
  key: "gap",
  origin: "source",
  protected: true,
  extension: false,
  fieldType: "text",
  labelEn: "gap",
  labelAr: "الفجوة",
  helpEn: null,
  helpAr: null,
  required: false,
  bulkEditable: false,
  storageKind: "column",
  sourceRef: "M0131",
  ordinal: 3,
  settings: {},
};
const schema = (): FormSchema => ({
  recordType: rt({}),
  formSchemaVersionId: V2,
  versionNo: 2,
  labelEn: "Capability Gap Assessment",
  labelAr: "تقييم فجوات القدرات",
  helpEn: null,
  helpAr: null,
  fields: [gap],
});

describe.each(["en", "ar"] as const)("form builder (%s)", (locale) => {
  const t = createI18n(locale).t;

  it("lists the native forms; the twelve extension record types carry the Extension badge", async () => {
    mockApi(
      meRoute(AUD, locale),
      route("GET", /\/admin\/form-schemas(\?|$)/, () => json({ items: types() })),
    );
    renderApp("/admin/forms", { i18n: createI18n(locale) });
    await screen.findByRole("table", { name: t("forms.builder.caption") });
    await waitFor(() => expect(document.querySelectorAll("[data-extension-badge]")).toHaveLength(12));
    for (const code of EXTENSION_RECORD_TYPES)
      expect(document.querySelector(`[data-extension-badge='${code}']`)!.textContent).toContain(
        t("forms.badge.extension"),
      );
    expect(t("forms.badge.extension")).toBe(locale === "en" ? "Extension" : "امتداد");
    expect(document.querySelector("[data-extension-badge='T03']")).toBeNull();
  });

  it("adds an extension field in an open draft with PUT, origin admin, its type and If-Match on the draft", async () => {
    const { requests } = mockApi(
      meRoute(ADM, locale),
      route("GET", /\/admin\/configuration-versions|\/admin\/methodology-versions/, () =>
        page([
          version({}),
          version({ id: V1, versionNo: 1, status: "published", draftStage: null, isNewestPublished: true }),
        ]),
      ),
      route("GET", /\/admin\/form-schemas\/T03/, () => json(schema())),
      route("PUT", /\/elements\/form_field\/T03\.risk_owner$/, () => json(version({ version: 8 }))),
    );
    renderApp("/admin/forms/T03", { i18n: createI18n(locale) });
    const add = await screen.findByRole("button", { name: t("forms.schema.addField") });
    expect(document.querySelector("[data-field='gap'] [data-protected='true']")!.textContent).toContain(
      t("forms.badge.protected"),
    );
    fireEvent.click(add);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(new RegExp(rx(t("forms.schema.fieldKey")))), {
      target: { value: "risk_owner" },
    });
    fireEvent.change(within(dialog).getByLabelText(new RegExp(rx(t("forms.schema.labelEn")))), {
      target: { value: "Risk owner" },
    });
    fireEvent.change(within(dialog).getByLabelText(new RegExp(rx(t("forms.schema.labelAr")))), {
      target: { value: "مالك المخاطرة" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("studio.elements.save") }));
    await waitFor(() => expect(requests.some((r) => r.method === "PUT")).toBe(true));
    const put = requests.find((r) => r.method === "PUT")!;
    expect(put.url).toContain(`/${V2}/elements/form_field/T03.risk_owner`);
    expect(put.headers["if-match"]).toBe('"7"');
    expect(put.body).toEqual({
      origin: "admin",
      attributes: { labelEn: "Risk owner", labelAr: "مالك المخاطرة", required: false, fieldType: "text" },
    });
  });

  it("deleting a protected source column shows the server's refusal, translated", async () => {
    const { requests } = mockApi(
      meRoute(ADM, locale),
      route("GET", /\/admin\/configuration-versions|\/admin\/methodology-versions/, () => page([version({})])),
      route("GET", /\/admin\/form-schemas\/T03/, () => json(schema())),
      route("POST", /\/elements\/form_field\/T03\.gap\/remove$/, () =>
        problem(422, "form_schema.source_column_protected"),
      ),
    );
    renderApp("/admin/forms/T03", { i18n: createI18n(locale) });
    await screen.findByRole("button", { name: t("forms.schema.addField") });
    fireEvent.click(
      within(document.querySelector("[data-field='gap']") as HTMLElement).getByRole("button", {
        name: new RegExp(t("forms.schema.removeField")),
      }),
    );
    expect(screen.getByText(t("forms.schema.removeSourceBody"))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: t("forms.schema.confirmRemove") }));
    const alert = await waitFor(() => {
      const a = document.querySelector("[data-problem='form_schema.source_column_protected']");
      expect(a).toBeTruthy();
      return a!;
    });
    expect(alert.textContent).toContain(t(problemKey("form_schema.source_column_protected")));
    expect(requests.find((r) => r.url.endsWith("/remove"))!.headers["if-match"]).toBe('"7"');
  });

  it("an auditor and a published version get a read-only view", async () => {
    mockApi(
      meRoute(AUD, locale),
      route("GET", /\/admin\/configuration-versions|\/admin\/methodology-versions/, () =>
        page([version({ id: V1, versionNo: 1, status: "published", draftStage: null, isNewestPublished: true })]),
      ),
      route("GET", /\/admin\/form-schemas\/T03/, () => json(schema())),
    );
    renderApp("/admin/forms/T03", { i18n: createI18n(locale) });
    await screen.findByRole("table", { name: t("forms.schema.caption") });
    expect(document.querySelector("[data-state='read-only-version']")).toBeTruthy();
    expect(screen.queryByRole("button", { name: t("forms.schema.addField") })).toBeNull();
    expect(screen.queryByRole("button", { name: new RegExp(t("forms.schema.removeField")) })).toBeNull();
  });
});
