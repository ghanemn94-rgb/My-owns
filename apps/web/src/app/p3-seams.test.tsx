// P3 frontend seams (T-DG3-FE-A0; p3-work-split §4). SYNTHETIC data.
//  - every P3 route renders its page from a fixed file and export name;
//  - each stub shows its bilingual title from its own namespace and an honest "being built in this stage" state, with
//    no data and no write control, in English LTR and Arabic RTL;
//  - the workspace tabs include the P3 tabs, labelled from their own namespaces;
//  - "Initiatives and Roadmaps" and "Benefits and Finance" are partial areas leading into the Portfolio and Business
//    cases tabs of each transformation;
//  - the P3 query keys: ["roadmap", tid] is the one shared roadmap entry, and every P3 key is refreshed per transformation.
import { cleanup, screen, within } from "@testing-library/react";
import type { RouteObject } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isP3KeyOf, p2Keys, p3Keys } from "../api/queries.ts";
import { WORKSPACE_TABS, workspaceTabLabelKey } from "../components/Workspace.tsx";
import { catalogues, createI18n } from "../i18n/index.ts";
import { BenefitFormulaPage } from "../pages/benefit-formulas/BenefitFormulaPage.tsx";
import { BenefitFormulasPage } from "../pages/benefit-formulas/BenefitFormulasPage.tsx";
import { BusinessCasePage } from "../pages/business-cases/BusinessCasePage.tsx";
import { BusinessCasesPage } from "../pages/business-cases/BusinessCasesPage.tsx";
import { CapacityPage } from "../pages/capacity/CapacityPage.tsx";
import { DependenciesPage } from "../pages/dependencies/DependenciesPage.tsx";
import { DispensationsPage } from "../pages/dispensations/DispensationsPage.tsx";
import { InitiativePage } from "../pages/portfolio/InitiativePage.tsx";
import { PortfolioPage } from "../pages/portfolio/PortfolioPage.tsx";
import { PrioritizationPage } from "../pages/prioritization/PrioritizationPage.tsx";
import { ReadinessPage } from "../pages/readiness/ReadinessPage.tsx";
import { RoadmapPage } from "../pages/roadmap/RoadmapPage.tsx";
import {
  BUSINESS_UNIT,
  OFFICE_GRANTS,
  TR_ID,
  makeMe,
  makeTransformation,
  mockApi,
  renderApp,
  route,
} from "../test/fixtures.tsx";
import { METHODOLOGY, leadGrants } from "../test/p2fixtures.ts";
import { NAV_AREAS } from "./nav.ts";
import { routes } from "./router.tsx";

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
type Tree = { [key: string]: string | Tree };
const text = (locale: Locale, key: string): string => {
  let node: string | Tree = catalogues[locale] as unknown as Tree;
  for (const part of key.split(".")) node = (node as Tree)[part]!;
  if (typeof node !== "string") throw new Error(`missing ${key}`);
  return node;
};

/** The P3 routes: path under the shell, page component, namespace, title key. */
const P3_ROUTES = [
  ["transformations/:id/portfolio", PortfolioPage, "portfolio", "portfolio.title"],
  ["transformations/:id/initiatives/:initiativeId", InitiativePage, "portfolio", "portfolio.initiativeTitle"],
  ["transformations/:id/readiness", ReadinessPage, "readiness", "readiness.title"],
  ["transformations/:id/dispensations", DispensationsPage, "dispensations", "dispensations.title"],
  ["transformations/:id/prioritization", PrioritizationPage, "prioritization", "prioritization.title"],
  ["transformations/:id/roadmap", RoadmapPage, "roadmap", "roadmap.title"],
  ["transformations/:id/dependencies", DependenciesPage, "dependencies", "dependencies.title"],
  ["transformations/:id/capacity", CapacityPage, "capacity", "capacity.title"],
  ["transformations/:id/business-cases", BusinessCasesPage, "businessCases", "businessCases.title"],
  [
    "transformations/:id/business-cases/:businessCaseId",
    BusinessCasePage,
    "businessCases",
    "businessCases.detailTitle",
  ],
  ["transformations/:id/benefit-formulas", BenefitFormulasPage, "benefitFormulas", "benefitFormulas.title"],
  [
    "transformations/:id/benefit-formulas/:formulaId",
    BenefitFormulaPage,
    "benefitFormulas",
    "benefitFormulas.detailTitle",
  ],
] as const;

const shellChildren = (): RouteObject[] => routes.find((r) => r.path === "/")!.children!;
const concrete = (path: string) =>
  `/${path.replace(":id", TR_ID).replace(/:(initiativeId|businessCaseId|formulaId)/, "01920000-0000-7000-9000-0000000009a1")}`;

function renderStub(path: string, locale: Locale) {
  const tr = `/api/v1/transformations/${TR_ID}`;
  const api = mockApi(
    route("GET", /\/api\/v1\/me$/, () => ({
      status: 200,
      body: makeMe(leadGrants(), { preferredLocale: locale }),
    })),
    route("GET", /\/business-units/, () => ({ status: 200, body: { items: [BUSINESS_UNIT], nextCursor: null } })),
    route("GET", new RegExp(`${tr}$`), () => ({ status: 200, body: makeTransformation() })),
    route("GET", new RegExp(`${tr}/methodology$`), () => ({ status: 200, body: METHODOLOGY })),
  );
  renderApp(path, { i18n: createI18n(locale) });
  return api;
}

describe("P3 routes", () => {
  it("each P3 path renders its page component from the fixed file and export", () => {
    const children = shellChildren();
    for (const [path, Page] of P3_ROUTES) {
      const r = children.find((c) => c.path === path);
      expect(r, path).toBeTruthy();
      expect((r!.element as { type: unknown }).type, path).toBe(Page);
    }
  });

  describe.each(["en", "ar"] as const)("stubs (%s)", (locale) => {
    it.each(P3_ROUTES.map(([path, , ns, titleKey]) => [path, ns, titleKey] as const))(
      "%s: bilingual title and an honest 'being built' state, no data, no write control",
      async (path, ns, titleKey) => {
        const { requests } = renderStub(concrete(path), locale);
        expect(await screen.findByRole("heading", { level: 1, name: text(locale, titleKey) })).toBeTruthy();
        expect(document.documentElement.dir).toBe(locale === "ar" ? "rtl" : "ltr");
        const state = document.querySelector<HTMLElement>("[data-state='being-built']")!;
        expect(state).toBeTruthy();
        expect(state.getAttribute("role")).toBe("note");
        expect(state.textContent).toContain(text(locale, `${ns}.stub.title`));
        expect(state.textContent).toContain(text(locale, `${ns}.stub.body`));
        // A stub fetches only the workspace frame (session, units, transformation, catalogue) and writes nothing.
        expect(requests.filter((r) => r.method !== "GET")).toEqual([]);
        expect(
          requests.filter((r) => !/\/(me|business-units[^/]*|methodology)$|\/transformations\/[^/]+$/.test(r.url)),
        ).toEqual([]);
        expect(document.querySelector("main")!.querySelectorAll("form, input, textarea, select")).toHaveLength(0);
        expect(document.body.textContent).not.toMatch(/\bDG[0-7]\b/);
      },
    );

    it("the workspace tabs include the P3 tabs, labelled from their own namespaces", async () => {
      renderStub(`/transformations/${TR_ID}/roadmap`, locale);
      const nav = await screen.findByRole("navigation", { name: text(locale, "transformations.tabs.label") });
      const links = within(nav).getAllByRole("link");
      expect(links.map((a) => a.dataset["tab"])).toEqual(WORKSPACE_TABS.map((t) => t.id));
      for (const tab of WORKSPACE_TABS) {
        const link = links.find((a) => a.dataset["tab"] === tab.id)!;
        expect(link.textContent).toBe(text(locale, workspaceTabLabelKey(tab.id)));
        expect(link.getAttribute("href")).toBe(`/transformations/${TR_ID}${tab.path}`);
      }
      expect(links.find((a) => a.dataset["tab"] === "roadmap")!.getAttribute("aria-current")).toBe("page");
    });
  });
});

describe("P3 navigation areas", () => {
  it("Initiatives and Roadmaps and Benefits and Finance are partial, leading into workspace tabs", () => {
    const area = (id: string) => NAV_AREAS.find((a) => a.id === id)!;
    expect(area("initiatives")).toMatchObject({ availability: "partial", workspaceTab: "portfolio" });
    expect(area("benefits")).toMatchObject({ availability: "partial", workspaceTab: "business-cases" });
    const tabIds = WORKSPACE_TABS.map((t) => t.id as string);
    for (const a of NAV_AREAS.filter((x) => x.workspaceTab)) expect(tabIds).toContain(a.workspaceTab);
  });

  it.each([
    ["en", "/initiatives-roadmaps", "Initiatives and Roadmaps", "portfolio", "portfolio.tab"],
    ["ar", "/initiatives-roadmaps", "المبادرات وخرائط الطريق", "portfolio", "portfolio.tab"],
    ["en", "/benefits-finance", "Benefits and Finance", "business-cases", "businessCases.tab"],
    ["ar", "/benefits-finance", "المنافع والمالية", "business-cases", "businessCases.tab"],
  ] as const)("%s %s leads into the %s tab of each transformation", async (locale, path, label, tab, tabKey) => {
    mockApi(
      route("GET", /\/api\/v1\/me$/, () => ({
        status: 200,
        body: makeMe(OFFICE_GRANTS, { preferredLocale: locale }),
      })),
      route("GET", /\/api\/v1\/transformations\?/, () => ({
        status: 200,
        body: { items: [makeTransformation()], nextCursor: null },
      })),
    );
    renderApp(path, { i18n: createI18n(locale) });
    expect(await screen.findByRole("heading", { level: 1, name: label })).toBeTruthy();
    const link = await screen.findByRole("link", { name: /TR-0001/ });
    expect(link.getAttribute("href")).toBe(`/transformations/${makeTransformation().id}/${tab}`);
    expect(screen.getByRole("heading", { level: 2, name: new RegExp(text(locale, tabKey)) })).toBeTruthy();
    // The cross-portfolio view of the area is still planned, and says so.
    expect(screen.getAllByText(text(locale, "nav.planned")).length).toBeGreaterThan(0);
  });
});

describe("P3 query keys", () => {
  it("the roadmap timeline, table and board share the single ['roadmap', tid] entry", () => {
    expect(p3Keys.roadmap(TR_ID)).toEqual(["roadmap", TR_ID]);
  });

  it("every P3 key of a transformation is recognised for its refresh, and nothing of another one or of P2", () => {
    const keys = [
      p3Keys.portfolio(TR_ID),
      p3Keys.initiatives(TR_ID, { status: "draft" }),
      p3Keys.initiative(TR_ID, "i"),
      p3Keys.initiativePart(TR_ID, "i", "deliverables"),
      p3Keys.readiness(TR_ID),
      p3Keys.outcomeHierarchy(TR_ID),
      p3Keys.dispensations(TR_ID),
      p3Keys.prioritization(TR_ID),
      p3Keys.prioritizationPart(TR_ID, "rankings", 2),
      p3Keys.roadmap(TR_ID),
      p3Keys.dependencies(TR_ID),
      p3Keys.capacity(TR_ID),
      p3Keys.businessCases(TR_ID),
      p3Keys.businessCase(TR_ID, "b"),
      p3Keys.businessCasePart(TR_ID, "b", "totals"),
      p3Keys.benefitFormulas(TR_ID),
      p3Keys.benefitFormula(TR_ID, "f"),
      p3Keys.benefitFormulaPart(TR_ID, "f", "versions", 1, "calculations"),
    ];
    for (const k of keys) expect(isP3KeyOf(TR_ID, k), JSON.stringify(k)).toBe(true);
    for (const k of keys) expect(isP3KeyOf("another", k)).toBe(false);
    expect(isP3KeyOf(TR_ID, p2Keys.gates(TR_ID))).toBe(false);
    expect(isP3KeyOf(TR_ID, p3Keys.dependencyTypes)).toBe(false);
  });
});
