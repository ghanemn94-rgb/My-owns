// T-DG5-FE-G2 (D-163): the Studio's approval-route editor (F-DG5-QA-A-3; ADR-0039 §2, ADR-0044 §4) and the provenance
// badge on the Studio's element views (REQ-PB-002), with STUBBED responses in English (LTR) and Arabic (RTL). The live
// path (a two-step sequential route in a draft, seen in the preview) is e2e/p5-studio-routes.spec.ts. SYNTHETIC data; a
// Studio version is configuration, never a business approval.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Permission } from "@mth/shared";
import { createI18n, catalogues } from "../../i18n/index.ts";
import { ORG_ID, makeMe, mockApi, problem, renderApp, route } from "../../test/fixtures.tsx";
import type { ConfigVersion } from "./api.ts";
import { ROUTE_ROLES_MAX, elementPutAttributes } from "./ElementsSection.tsx";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const LANGS = ["en", "ar"] as const;
type Lang = (typeof LANGS)[number];
const S = (lang: Lang) => catalogues[lang].studio;
const ADM: Permission[] = ["organization.read", "methodology.read", "methodology.configure", "methodology.publish"];
const meRoute = (lang: Lang) =>
  route("GET", /\/api\/v1\/me$/, () => ({
    status: 200,
    body: makeMe([{ scope: { type: "organization", id: ORG_ID }, inheritsDownward: false, permissions: ADM }], {
      preferredLocale: lang,
    }),
  }));
const V1 = "01920000-0000-7000-b000-000000000001";
const V2 = "01920000-0000-7000-b000-000000000002";

const draft: ConfigVersion = {
  id: V2,
  configKind: "methodology",
  key: "playbook",
  versionNo: 2,
  status: "draft",
  draftStage: "editing",
  origin: "draft",
  basedOnVersionId: V1,
  rollbackOfVersionId: null,
  titleEn: "Synthetic methodology v2",
  titleAr: "منهجية اصطناعية الإصدار 2",
  changeSummary: null,
  definition: {},
  contentSha256: "a".repeat(64),
  isNewestPublished: false,
  latestChecks: { preview: null, compatibility: null, sourceCoverage: null },
  pendingReviewId: null,
  reviewRequired: false,
  publishedAt: null,
  publishedBy: null,
  discardedAt: null,
  version: 4,
  createdAt: "2026-10-15T08:00:00Z",
  createdBy: null,
  updatedAt: "2026-10-15T08:00:00Z",
  updatedBy: null,
};

const routeElement = (attributes: Record<string, unknown> = {}) => ({
  elementType: "approver_route" as const,
  stableKey: "approval.change_request",
  origin: "source",
  removed: false,
  ordinal: 1,
  sourceRef: null,
  catalogueAttributes: { labelEn: "Change request approval", labelAr: "اعتماد طلب التغيير", approverRoleCode: "SP" },
  attributes,
  overridden: Object.keys(attributes).length > 0,
});
const gateG3 = {
  elementType: "gate",
  stableKey: "G3",
  origin: "source",
  removed: false,
  ordinal: 3,
  sourceRef: "B0023",
  catalogueAttributes: { labelEn: "Design approval", labelAr: "اعتماد التصميم" },
  attributes: {},
  overridden: false,
};
const page = <T,>(items: T[]) => ({ status: 200, body: { items, nextCursor: null } });

function handlers(elements: unknown[]) {
  return [
    route("GET", new RegExp(`/methodology-versions/${V2}$`), () => ({ status: 200, body: draft })),
    route("GET", /\/check-runs/, () => page([])),
    route("GET", /\/methodology-versions\/[^/]+\/elements/, () => page(elements)),
    route("GET", /\/diff/, () => ({
      status: 200,
      body: { fromVersionId: V1, toVersionId: V2, titleChanged: false, definitionChanged: false, entries: [] },
    })),
    route("GET", /\/affected-records/, () => ({ status: 200, body: { versionId: V2, transformations: [] } })),
    route("GET", /\/reviews(\?|$)/, () => page([])),
  ];
}

describe("approver-route attributes (ADR-0039 §2: exactly one approver form; ADR-0044 §4: 2-6 roles)", () => {
  const e = routeElement();
  it("an ordered list with a mode replaces the single role, in the order entered", () => {
    expect(elementPutAttributes(e, { mode: "sequential", approverRoleCodes: "BO\nSP", approverRoleCode: "" })).toEqual({
      attributes: { mode: "sequential", approverRoleCodes: ["BO", "SP"] },
    });
    expect(
      elementPutAttributes(e, { mode: "parallel", approverRoleCodes: "SP\n\nFIN\n", approverRoleCode: "" }),
    ).toEqual({ attributes: { mode: "parallel", approverRoleCodes: ["SP", "FIN"] } });
  });
  it("both forms entered is refused on the single role; a bad code on the list", () => {
    expect(elementPutAttributes(e, { approverRoleCodes: "BO\nSP", approverRoleCode: "SP" })).toEqual({
      fieldErrors: { approverRoleCode: "studio_route.one_approver_form" },
    });
    expect(elementPutAttributes(e, { approverRoleCodes: "BO\nsp x", approverRoleCode: "" })).toEqual({
      fieldErrors: { approverRoleCodes: "validation.code" },
    });
  });
  it("a sequential or parallel mode needs 2 to 6 roles (otherwise it would silently be one step)", () => {
    expect(elementPutAttributes(e, { mode: "sequential", approverRoleCodes: "BO", approverRoleCode: "" })).toEqual({
      fieldErrors: { approverRoleCodes: "studio_route.size" },
    });
    const seven = Array.from({ length: ROUTE_ROLES_MAX + 1 }, (_, i) => `R${i}`).join("\n");
    expect(elementPutAttributes(e, { mode: "parallel", approverRoleCodes: seven, approverRoleCode: "" })).toEqual({
      fieldErrors: { approverRoleCodes: "studio_route.size" },
    });
    expect(elementPutAttributes(e, { mode: "sequential", approverRoleCode: "SP", approverRoleCodes: "" })).toEqual({
      fieldErrors: { approverRoleCodes: "studio_route.size" },
    });
  });
  it("the single role alone stays a single-step approval; nothing entered keeps the catalogue's form", () => {
    expect(elementPutAttributes(e, { approverRoleCode: "BO", approverRoleCodes: "", mode: "" })).toEqual({
      attributes: { approverRoleCode: "BO" },
    });
    expect(elementPutAttributes(e, { approverRoleCode: "", approverRoleCodes: "", mode: "" })).toEqual({
      attributes: { approverRoleCode: "SP" },
    });
    const listed = { ...e, catalogueAttributes: { approverRoleCodes: ["SP", "FIN"], mode: "sequential" } };
    expect(elementPutAttributes(listed, { approverRoleCode: "", approverRoleCodes: "", mode: "" })).toEqual({
      attributes: { approverRoleCodes: ["SP", "FIN"] },
    });
  });
  it("every route text and its two field codes exist in en and ar", () => {
    for (const lang of LANGS) {
      const r = S(lang).elements.route;
      for (const v of [r.addRole, r.stepRole, r.moveUp, r.moveDown, r.removeRole, r.mode.sequential, r.mode.parallel])
        expect(v.length, lang).toBeGreaterThan(0);
      const p = catalogues[lang].problems as unknown as Record<string, string>;
      expect(p["studio_route__one_approver_form"]?.length, lang).toBeGreaterThan(0);
      expect(p["studio_route__size"]?.length, lang).toBeGreaterThan(0);
    }
  });
});

describe("the route editor in the element dialog", () => {
  for (const lang of LANGS) {
    it(`${lang}: configures a two-step sequential route with the keyboard-operable list and sends it with If-Match`, async () => {
      const s = S(lang);
      const { requests } = mockApi(
        meRoute(lang),
        route("PUT", /\/elements\/approver_route\/approval\.change_request$/, (req) => {
          const codes = (req.body as { attributes: { approverRoleCodes?: string[] } }).attributes.approverRoleCodes;
          return codes?.includes("ADM_METHOD")
            ? problem(422, "config_version.admin_approver_forbidden")
            : { status: 200, body: { ...draft, version: 5 } };
        }),
        ...handlers([routeElement()]),
      );
      renderApp(`/admin/studio/versions/${V2}`, { i18n: createI18n(lang) });
      const label = lang === "ar" ? "اعتماد طلب التغيير" : "Change request approval";
      fireEvent.click(await screen.findByRole("button", { name: new RegExp(`^${s.elements.edit}\\s+${label}$`) }));
      let dialog = await screen.findByRole("dialog");
      fireEvent.change(within(dialog).getByLabelText(new RegExp(`^${s.elements.attr.mode}`)), {
        target: { value: "sequential" },
      });
      const list = within(dialog).getByRole("group", { name: s.elements.attr.approverRoleCodes });
      fireEvent.click(within(list).getByRole("button", { name: s.elements.route.addRole }));
      const step1 = within(list).getByRole("textbox", { name: s.elements.route.stepRole.replace("{{n}}", "1") });
      expect(document.activeElement).toBe(step1); // focus moves to the new row
      fireEvent.change(step1, { target: { value: "sp" } });
      fireEvent.click(within(list).getByRole("button", { name: s.elements.route.addRole }));
      fireEvent.change(within(list).getByRole("textbox", { name: s.elements.route.stepRole.replace("{{n}}", "2") }), {
        target: { value: "BO" },
      });
      // Reorder: BO becomes step 1.
      fireEvent.click(within(list).getByRole("button", { name: s.elements.route.moveUp.replace("{{n}}", "2") }));
      expect(
        within(list)
          .getAllByRole("textbox")
          .map((x) => (x as HTMLInputElement).value),
      ).toEqual(["BO", "SP"]);
      expect(
        within(list)
          .getByRole("button", { name: s.elements.route.moveUp.replace("{{n}}", "1") })
          .hasAttribute("disabled"),
      ).toBe(true);
      // Both forms entered is refused, translated, on the single role.
      fireEvent.click(within(dialog).getByRole("button", { name: s.elements.save }));
      expect(await within(dialog).findByText(catalogues[lang].problems.studio_route__one_approver_form)).toBeTruthy();
      fireEvent.change(within(dialog).getByLabelText(new RegExp(`^${s.elements.attr.approverRoleCode}\\s*$`)), {
        target: { value: "" },
      });
      fireEvent.click(within(dialog).getByRole("button", { name: s.elements.save }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      const put = requests.find((r) => r.method === "PUT")!;
      expect(put.headers["if-match"]).toBe('"4"');
      expect(put.body).toEqual({
        attributes: {
          labelEn: "Change request approval",
          labelAr: "اعتماد طلب التغيير",
          mode: "sequential",
          approverRoleCodes: ["BO", "SP"],
        },
      });

      // A server refusal (an administrator role as approver) is shown by its code's translated text.
      fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${s.elements.edit}\\s+${label}$`) }));
      dialog = await screen.findByRole("dialog");
      const list2 = within(dialog).getByRole("group", { name: s.elements.attr.approverRoleCodes });
      fireEvent.change(within(dialog).getByLabelText(new RegExp(`^${s.elements.attr.mode}`)), {
        target: { value: "parallel" },
      });
      fireEvent.click(within(list2).getByRole("button", { name: s.elements.route.addRole }));
      fireEvent.change(within(list2).getByRole("textbox", { name: s.elements.route.stepRole.replace("{{n}}", "1") }), {
        target: { value: "ADM_METHOD" },
      });
      fireEvent.click(within(list2).getByRole("button", { name: s.elements.route.addRole }));
      fireEvent.change(within(list2).getByRole("textbox", { name: s.elements.route.stepRole.replace("{{n}}", "2") }), {
        target: { value: "BO" },
      });
      fireEvent.change(within(dialog).getByLabelText(new RegExp(`^${s.elements.attr.approverRoleCode}\\s*$`)), {
        target: { value: "" },
      });
      fireEvent.click(within(dialog).getByRole("button", { name: s.elements.save }));
      expect((await within(dialog).findByRole("alert")).textContent).toContain(
        catalogues[lang].problems.config_version__admin_approver_forbidden,
      );
    });
  }
});

describe("the element views: route summary and provenance badge (REQ-PB-002)", () => {
  for (const lang of LANGS) {
    it(`${lang}: a route lists its mode and ordered steps; a seeded gate carries the custom-extension badge`, async () => {
      mockApi(
        meRoute(lang),
        route("GET", /\/api\/v1\/methodology\/elements/, () => ({
          status: 200,
          body: {
            methodologyVersion: { id: V1, versionNo: 1, source: "latest_published" },
            items: [
              {
                elementRef: "gate.G3",
                kind: "gate",
                stableKey: "G3",
                ordinal: 3,
                labelEn: "Design approval",
                labelAr: "اعتماد التصميم",
                provenance: "custom_extension",
                provenanceSourceRef: "B0160",
                questionTag: null,
                sourceRefs: ["B0023"],
                overridden: false,
              },
            ],
          },
        })),
        ...handlers([gateG3, routeElement({ mode: "sequential", approverRoleCodes: ["BO", "SP"] })]),
      );
      renderApp(`/admin/studio/versions/${V2}`, { i18n: createI18n(lang) });
      const badgeCell = await waitFor(() => {
        const el = document.querySelector("[data-element-provenance='gate.G3']");
        expect(el).toBeTruthy();
        return el as HTMLElement;
      });
      const badgeText = catalogues[lang].playbookP5.provenance.custom_extension;
      expect(badgeCell.textContent).toContain(badgeText);
      expect(
        badgeCell.querySelector("[data-provenance='custom_extension'] svg, [data-provenance] [aria-hidden]"),
      ).toBeTruthy();
      // Nothing in the element view calls an element a PMI standard, official or certified.
      const table = document.querySelector("[data-table='elements']")!;
      expect(table.textContent ?? "").not.toMatch(/PMI standard|official PMI|certified|معيار PMI الرسمي|معتمد من PMI/i);
      // The route row: its mode and its steps in order (LTR codes); the gate row has no route summary.
      const row = document.querySelector("[data-element='approver_route:approval.change_request']")!;
      const summary = row.querySelector("[data-route-summary='sequential']")!;
      expect(summary.textContent).toContain(S(lang).elements.route.modeShort.sequential);
      expect([...summary.querySelectorAll("[data-route-step]")].map((x) => x.textContent)).toEqual(["BO", "SP"]);
      expect(row.querySelector("[data-element-provenance]")).toBeNull();
    });
  }

  it("a failed provenance read shows no badge, never a wrong one", async () => {
    mockApi(
      meRoute("en"),
      route("GET", /\/api\/v1\/methodology\/elements/, () => problem(500, "internal")),
      ...handlers([gateG3]),
    );
    renderApp(`/admin/studio/versions/${V2}`, { i18n: createI18n("en") });
    await screen.findByText("Design approval");
    expect(document.querySelector("[data-element-provenance]")).toBeNull();
  });
});
