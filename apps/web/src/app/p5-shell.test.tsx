// T-DG5-FE-A (p5-plan §5.1 row FE-A; D-144): the P5 shell seams, in English LTR and Arabic RTL, against a scripted API
// (SYNTHETIC data).
//  - REQ-S03-007: the area landing pages list the contents master prompt §3 names for each area (M0103–M0112), each
//    with where it lives; no area is labelled "planned" while it has delivered screens (F-DG4-160, p5-plan §3 row 18).
//  - Every P5 screen of FE-B…FE-G has a navigation entry or a route up front, and each shows an honest "not available
//    yet" placeholder in en and ar until its owning task replaces it.
//  - The slice A–C request paths equal the contract's (docs/api/openapi.yaml), and the P5 query keys are scoped.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cleanup, screen, within } from "@testing-library/react";
import type { RouteObject } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Permission } from "@mth/shared";
import { ORG_ID, OFFICE_GRANTS, makeMe, makeTransformation, mockApi, renderApp, route } from "../test/fixtures.tsx";
import { catalogues, createI18n } from "../i18n/index.ts";
import { WORKSPACE_TABS } from "../components/Workspace.tsx";
import { isP5KeyOf, p5Keys, p5Paths } from "../api/p5.ts";
import { AREA_CONTENTS, NAV_AREAS, NAV_SUBPAGES, P5_SUBPAGES, type LandingAreaId } from "./nav.ts";
import { P4_PLANNED_ROUTES, P5_PLANNED_ROUTES, routes } from "./router.tsx";

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const LOCALES = ["en", "ar"] as const;
const meRoute = (me: ReturnType<typeof makeMe>) => route("GET", /\/api\/v1\/me$/, () => ({ status: 200, body: me }));
const trRoute = route("GET", /\/api\/v1\/transformations\?/, () => ({
  status: 200,
  body: { items: [makeTransformation()], nextCursor: null },
}));
const orgGrants = (permissions: Permission[]) => [
  { scope: { type: "organization" as const, id: ORG_ID }, inheritsDownward: false, permissions },
];
const landingAreas = Object.keys(AREA_CONTENTS) as LandingAreaId[];
const shellChildren = (): RouteObject[] => routes.find((r) => r.path === "/")!.children!;

function repoRoot(): string {
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    if (dirname(dir) === dir) throw new Error("repository root not found");
  }
}

describe("REQ-S03-007: the area landing pages and their §3 contents", () => {
  it("no area is planned; every area that is not a working screen has a landing page with its §3 contents", () => {
    expect(NAV_AREAS).toHaveLength(14);
    expect(NAV_AREAS.filter((a) => a.availability === "planned")).toEqual([]);
    const working = NAV_AREAS.filter((a) => a.availability === "available").map((a) => a.id);
    expect(working.sort()).toEqual(["admin", "executive", "myWork", "transformations"]);
    expect(landingAreas.sort()).toEqual(
      NAV_AREAS.filter((a) => a.availability !== "available")
        .map((a) => a.id)
        .sort(),
    );
    // Each landing route is registered, and each area leads into a workspace tab that exists.
    const paths = shellChildren().map((r) => r.path);
    const tabIds = WORKSPACE_TABS.map((t) => t.id as string);
    for (const id of landingAreas) {
      const area = NAV_AREAS.find((a) => a.id === id)!;
      expect(paths, id).toContain(area.path.slice(1));
      expect(tabIds, id).toContain(area.workspaceTab);
      for (const item of AREA_CONTENTS[id]) {
        for (const tab of item.tabs ?? []) expect(tabIds, `${id}.${item.id}`).toContain(tab);
        for (const p5 of item.p5 ?? []) expect(P5_SUBPAGES.map((s) => s.id)).toContain(p5);
        expect((item.tabs?.length ?? 0) + (item.links?.length ?? 0) + (item.p5?.length ?? 0)).toBeGreaterThan(0);
      }
    }
  });

  it("lists exactly the contents §3 names for each area, in its order, in en and ar", () => {
    for (const id of landingAreas) {
      // The §3 sentence (M0103–M0112), e.g. "Integrated RAID, corrective actions and escalations."
      const sentence = catalogues.en.nav.areas[id].contents.replace(/\.$/, "");
      const parts = sentence.split(/, | and /).map((p) => p.toLowerCase());
      const labels = AREA_CONTENTS[id].map((item) => catalogues.en.nav.contents[id][item.id as never] as string);
      expect(
        labels.map((l) => l.toLowerCase()),
        id,
      ).toEqual(parts);
      // Arabic: every label is the matching part of the Arabic §3 sentence, in the same order.
      const ar = catalogues.ar.nav.areas[id].contents;
      let at = 0;
      for (const item of AREA_CONTENTS[id]) {
        const label = catalogues.ar.nav.contents[id][item.id as never] as string;
        const found = ar.indexOf(label, at);
        expect(found, `${id}.${item.id}: ${label}`).toBeGreaterThanOrEqual(at);
        at = found + label.length;
      }
    }
  });

  for (const locale of LOCALES) {
    for (const id of landingAreas) {
      it(`${locale}: ${id} lands on its §3 contents with where each one lives`, async () => {
        mockApi(meRoute(makeMe(OFFICE_GRANTS, { preferredLocale: locale })), trRoute);
        const area = NAV_AREAS.find((a) => a.id === id)!;
        renderApp(area.path, { i18n: createI18n(locale) });
        const nav = catalogues[locale].nav;
        expect(await screen.findByRole("heading", { level: 1, name: nav.areas[id].label })).toBeTruthy();
        expect(document.documentElement.dir).toBe(locale === "ar" ? "rtl" : "ltr");
        const list = document.querySelector<HTMLElement>(`[data-area-contents='${id}']`)!;
        const card = list.closest("section")!;
        expect(within(card).getByRole("heading", { level: 2, name: nav.willContain })).toBeTruthy();
        const items = list.querySelectorAll<HTMLElement>(":scope > li");
        expect(items).toHaveLength(AREA_CONTENTS[id].length);
        AREA_CONTENTS[id].forEach((item, i) => {
          const li = items[i]!;
          expect(li.dataset["contentItem"]).toBe(item.id);
          expect(li.querySelector(".area-content__label")!.textContent).toBe(nav.contents[id][item.id as never]);
          const delivered = (item.tabs?.length ?? 0) > 0 || (item.links ?? []).some((l) => !l.requiresAny);
          // The first chip says, in words (never colour alone), whether the content can be used today.
          const chip = li.querySelector<HTMLElement>(".lifecycle-chip")!;
          expect(chip.dataset["availability"]).toBe(delivered ? "available" : "not-available-yet");
          expect(chip.textContent!.trim()).toBe(delivered ? nav.landing.available : nav.landing.notAvailableYet);
          // A P5 screen is named as not available yet and links to its placeholder route.
          for (const p5 of item.p5 ?? []) {
            const sub = P5_SUBPAGES.find((s) => s.id === p5)!;
            const link = within(li).getByRole("link", { name: nav.sub[p5] });
            expect(link.getAttribute("href")).toBe(sub.path);
          }
          if (item.p5?.length) {
            expect(within(li).getAllByText(nav.landing.notAvailableYet, { exact: false }).length).toBeGreaterThan(0);
          }
        });
        // The transformations open the area's workspace tab, and the cross-portfolio view is for a later release.
        const link = await screen.findByRole("link", { name: new RegExp(makeTransformation().code) });
        expect(link.getAttribute("href")).toBe(`/transformations/${makeTransformation().id}/${area.workspaceTab}`);
        expect(screen.getByText(nav.entry.portfolioPlanned)).toBeTruthy();
      });
    }
  }
});

describe("P5 navigation entries and route placeholders (D-144 item 1)", () => {
  it("registers every P5 screen named in p5-plan §1.1 and §5.1 as a nav entry or route, each labelled in en and ar", () => {
    const features = new Set(P5_PLANNED_ROUTES.map((r) => r.feature));
    // The P5 areas and screens of D-144 item 1.
    for (const f of [
      // "studio", "methodologyMigrations", "sourceCoverage": built by T-DG5-FE-B (checked below).
      // "formBuilder": built by T-DG5-FE-C (checked below).
      // "procedureBuilder", "myProcedures", "automation", "approvalRoutes", "notificationPreferences": built by
      // T-DG5-FE-D (checked below).
      // "reports", "exports", "presentation": built by T-DG5-FE-E (checked below).
      "launchPlan",
      "healthCheck",
      "reader",
      "branding",
      "demo",
    ])
      expect(features, f).toContain(f);
    const paths = shellChildren().map((r) => r.path);
    for (const r of P5_PLANNED_ROUTES) expect(paths, r.path).toContain(r.path);
    expect(new Set(P5_PLANNED_ROUTES.map((r) => r.path)).size).toBe(P5_PLANNED_ROUTES.length);
    for (const s of P5_SUBPAGES) expect(NAV_SUBPAGES).toContain(s);
    for (const r of P5_PLANNED_ROUTES) expect(["FE-B", "FE-C", "FE-D", "FE-E", "FE-F", "FE-G"]).toContain(r.owner);
    for (const lang of LOCALES) {
      const t = createI18n(lang).t;
      for (const r of P5_PLANNED_ROUTES) {
        expect(t(`nav.p5.${r.feature}.title`, { defaultValue: "" }), r.feature).not.toBe("");
        expect(t(`nav.p5.${r.feature}.summary`, { defaultValue: "" }), r.feature).not.toBe("");
      }
      for (const s of P5_SUBPAGES) expect(t(`nav.sub.${s.id}`, { defaultValue: "" }), s.id).not.toBe("");
    }
    // The P4 seam stays empty (D-114).
    expect(P4_PLANNED_ROUTES).toEqual([]);
    // T-DG5-FE-B: the slice A screens are built; their nav entries and routes are no longer placeholders.
    expect(P5_PLANNED_ROUTES.filter((r) => r.owner === "FE-B")).toEqual([]);
    for (const path of ["admin/studio", "admin/methodology-migrations", "admin/source-coverage"])
      expect(paths, path).toContain(path);
    // T-DG5-FE-C: the form builder is built; its nav entry and the form route are no longer placeholders.
    expect(P5_PLANNED_ROUTES.filter((r) => r.owner === "FE-C")).toEqual([]);
    for (const path of ["admin/forms", "admin/forms/:recordType"]) expect(paths, path).toContain(path);
    // T-DG5-FE-D: the slice C, D and E screens are built; their nav entries and routes are no longer placeholders.
    expect(P5_PLANNED_ROUTES.filter((r) => r.owner === "FE-D")).toEqual([]);
    for (const path of [
      "admin/procedures",
      "admin/procedures/:procedureCode",
      "admin/coverage",
      "playbook/procedures",
      "playbook/procedures/:instanceId",
      "admin/automation",
      "admin/automation/rules/:ruleId",
      "admin/automation/failures",
      "admin/approval-routes",
      "my-work/notification-preferences",
    ])
      expect(paths, path).toContain(path);
    // T-DG5-FE-E: the slice F screens are built; their nav entries and routes are no longer placeholders.
    expect(P5_PLANNED_ROUTES.filter((r) => r.owner === "FE-E")).toEqual([]);
    for (const path of [
      "evidence-reports/reports",
      "evidence-reports/exports",
      "evidence-reports/presentation",
      "evidence-reports/evidence-register",
      "initiatives-roadmaps/updates",
      "transformations/:id/reports",
      "transformations/:id/reports/:snapshotId",
      "transformations/:id/exports",
      "transformations/:id/presentation",
      "transformations/:id/meetings/:meetingId/presentation",
      "transformations/:id/owner-updates",
      "transformations/:id/evidence-register",
    ])
      expect(paths, path).toContain(path);
  });

  for (const locale of LOCALES) {
    it(`${locale}: every P5 placeholder says the screen is not available yet, with no data and no form`, async () => {
      const nav = catalogues[locale].nav;
      expect(nav.p5.notAvailableTitle).toBe(locale === "en" ? "Not available yet" : "غير متاح بعد");
      for (const r of P5_PLANNED_ROUTES) {
        const { requests } = mockApi(meRoute(makeMe(OFFICE_GRANTS, { preferredLocale: locale })));
        const path = "/" + r.path.replace(/:([A-Za-z]+)/g, (_, name: string) => `sample-${name}`);
        renderApp(path, { i18n: createI18n(locale) });
        const title = (nav.p5 as unknown as Record<string, { title: string; summary: string }>)[r.feature]!;
        expect(await screen.findByRole("heading", { level: 1, name: title.title }), path).toBeTruthy();
        expect(screen.getByText(title.summary)).toBeTruthy();
        const note = screen.getByRole("note");
        expect(note.dataset["state"]).toBe("being-built");
        expect(within(note).getByText(nav.p5.notAvailableTitle)).toBeTruthy();
        expect(within(note).getByText(nav.p5.notAvailableBody)).toBeTruthy();
        expect(document.querySelector(`main [data-p5-feature='${r.feature}']`)).toBeTruthy();
        expect(document.querySelector("main form, main table, main input")).toBeNull();
        expect(document.documentElement.dir).toBe(locale === "ar" ? "rtl" : "ltr");
        // The placeholder reads nothing beyond the session.
        expect(requests.filter((q) => !/\/api\/v1\/me$/.test(q.url) && !/\/branding\//.test(q.url))).toEqual([]);
        cleanup();
      }
    });
  }

  it("Administration shows the Studio entries only with methodology.read, and is shown to the methodology admin", async () => {
    // ADM_METHOD (methodology.configure, methodology.publish, methodology.read): Administration and its Studio entries.
    mockApi(
      meRoute(
        makeMe(orgGrants(["organization.read", "methodology.configure", "methodology.publish", "methodology.read"]), {
          preferredLocale: "en",
        }),
      ),
    );
    renderApp("/admin/studio", { i18n: createI18n("en") });
    expect(await screen.findByRole("heading", { level: 1, name: "Playbook Studio" })).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    const admin = within(nav).getByRole("list", { name: "Administration" });
    for (const name of ["Playbook Studio", "Methodology migrations", "Source coverage", "Form builder", "Branding"])
      expect(within(admin).getByRole("link", { name }), name).toBeTruthy();
    expect(within(admin).getByRole("link", { name: "Playbook Studio" }).getAttribute("aria-current")).toBe("page");
    cleanup();
    // An organization administrator without methodology.read sees Administration but not the Studio entries.
    mockApi(meRoute(makeMe(orgGrants(["organization.read", "organization.manage"]), { preferredLocale: "en" })));
    renderApp("/my-work", { i18n: createI18n("en") });
    const nav2 = await screen.findByRole("navigation", { name: "Primary navigation" });
    const admin2 = within(nav2).getByRole("list", { name: "Administration" });
    expect(within(admin2).queryByRole("link", { name: "Playbook Studio" })).toBeNull();
    expect(within(admin2).getByRole("link", { name: "Branding" })).toBeTruthy();
  });

  it("the Transformation Office still sees 13 areas, with the P5 entries of its areas", async () => {
    mockApi(meRoute(makeMe(OFFICE_GRANTS, { preferredLocale: "ar" })));
    renderApp("/my-work", { i18n: createI18n("ar") });
    const nav = await screen.findByRole("navigation", { name: catalogues.ar.nav.primary });
    expect(
      within(nav)
        .getAllByRole("link")
        .filter((a) => a.hasAttribute("data-area")),
    ).toHaveLength(13);
    const playbook = within(nav).getByRole("list", { name: catalogues.ar.nav.areas.playbook.label });
    for (const id of ["reader", "myProcedures", "launchPlan", "healthCheck"] as const)
      expect(within(playbook).getByRole("link", { name: catalogues.ar.nav.sub[id] }).getAttribute("href")).toBe(
        P5_SUBPAGES.find((s) => s.id === id)!.path,
      );
  });
});

describe("P5 API seams (D-144 item 2)", () => {
  /** Sample values of the contract's path parameters. */
  const SAMPLE = {
    versionId: "V",
    elementType: "gate",
    stableKey: "G3",
    reviewId: "R",
    configKind: "methodology",
    transformationId: "T",
    migrationId: "M",
    recordType: "T01",
    recordId: "RI",
    attachmentId: "A",
    draftId: "D",
    procedureCode: "gate_review",
    instanceId: "I",
    stepKey: "S1",
  } as const;
  const S = SAMPLE;
  const sample = (name: string): string => (SAMPLE as Record<string, string>)[name] ?? `?${name}`;
  const CASES: readonly (readonly [string, string])[] = [
    ["listConfigVersions", p5Paths.configVersions],
    ["createConfigDraft", p5Paths.configVersions],
    ["getConfigVersion", p5Paths.configVersion(S.versionId)],
    ["updateConfigDraft", p5Paths.configVersion(S.versionId)],
    ["discardConfigDraft", p5Paths.discardConfigDraft(S.versionId)],
    ["listConfigElements", p5Paths.configElements(S.versionId)],
    ["putConfigElement", p5Paths.configElement(S.versionId, S.elementType, S.stableKey)],
    ["removeConfigElement", p5Paths.removeConfigElement(S.versionId, S.elementType, S.stableKey)],
    ["getConfigVersionDiff", p5Paths.configDiff(S.versionId)],
    ["getConfigAffectedRecords", p5Paths.configAffectedRecords(S.versionId)],
    ["listConfigCheckRuns", p5Paths.configCheckRuns(S.versionId)],
    ["runConfigCompatibilityCheck", p5Paths.compatibilityCheck(S.versionId)],
    ["runConfigPreview", p5Paths.configPreview(S.versionId)],
    ["submitConfigReview", p5Paths.submitConfigReview(S.versionId)],
    ["listConfigReviews", p5Paths.configReviews(S.versionId)],
    ["decideConfigReview", p5Paths.decideConfigReview(S.versionId, S.reviewId)],
    ["withdrawConfigReview", p5Paths.withdrawConfigReview(S.versionId, S.reviewId)],
    ["publishConfigVersion", p5Paths.publishConfigVersion(S.versionId)],
    ["rollbackConfigVersion", p5Paths.rollbackConfigVersion(S.versionId)],
    ["listConfigReviewPolicies", p5Paths.reviewPolicies],
    ["updateConfigReviewPolicy", p5Paths.reviewPolicy(S.configKind)],
    ["listRevisionProposals", p5Paths.revisionProposals],
    ["getSourceCoverage", p5Paths.sourceCoverage],
    ["runSourceCoverageCheck", p5Paths.sourceCoverageRuns],
    ["putScoringDefaultsDraft", p5Paths.scoringDefaultsDraft(S.versionId)],
    ["getScoringDefaults", p5Paths.scoringDefaults],
    ["getTransformationScoringDefaults", p5Paths.transformationScoringDefaults(S.transformationId)],
    ["listTransformationConfigPins", p5Paths.configPins(S.transformationId)],
    ["listConfigPinHistory", p5Paths.configPinHistory(S.transformationId)],
    ["listMethodologyMigrations", p5Paths.methodologyMigrations(S.transformationId)],
    ["createMethodologyMigration", p5Paths.methodologyMigrations(S.transformationId)],
    ["getMethodologyMigration", p5Paths.methodologyMigration(S.transformationId, S.migrationId)],
    ["previewMethodologyMigration", p5Paths.previewMethodologyMigration(S.transformationId, S.migrationId)],
    ["submitMethodologyMigration", p5Paths.submitMethodologyMigration(S.transformationId, S.migrationId)],
    ["decideMethodologyMigration", p5Paths.decideMethodologyMigration(S.transformationId, S.migrationId)],
    ["executeMethodologyMigration", p5Paths.executeMethodologyMigration(S.transformationId, S.migrationId)],
    ["withdrawMethodologyMigration", p5Paths.withdrawMethodologyMigration(S.transformationId, S.migrationId)],
    ["listGateReapprovals", p5Paths.gateReapprovals(S.transformationId)],
    ["listFormRecordTypes", p5Paths.formRecordTypes],
    ["getFormSchemaAdmin", p5Paths.formSchemaAdmin(S.recordType)],
    ["getTransformationFormSchema", p5Paths.transformationFormSchema(S.transformationId, S.recordType)],
    ["getFormRecordCustomFields", p5Paths.formCustomFields(S.transformationId, S.recordType, S.recordId)],
    ["putFormRecordCustomFields", p5Paths.formCustomFields(S.transformationId, S.recordType, S.recordId)],
    ["listFormRecordVersions", p5Paths.formRecordVersions(S.transformationId, S.recordType, S.recordId)],
    ["listFormRecordComments", p5Paths.formRecordComments(S.transformationId, S.recordType, S.recordId)],
    ["createFormRecordComment", p5Paths.formRecordComments(S.transformationId, S.recordType, S.recordId)],
    ["listFormRecordAttachments", p5Paths.formRecordAttachments(S.transformationId, S.recordType, S.recordId)],
    ["attachFormRecordEvidence", p5Paths.formRecordAttachments(S.transformationId, S.recordType, S.recordId)],
    [
      "removeFormRecordAttachment",
      p5Paths.removeFormRecordAttachment(S.transformationId, S.recordType, S.recordId, S.attachmentId),
    ],
    ["exportFormRecords", p5Paths.exportFormRecords(S.transformationId, S.recordType)],
    ["bulkUpdateFormRecords", p5Paths.bulkUpdateFormRecords(S.transformationId, S.recordType)],
    ["listFormDrafts", p5Paths.formDrafts(S.transformationId)],
    ["createFormDraft", p5Paths.formDrafts(S.transformationId)],
    ["getFormDraft", p5Paths.formDraft(S.transformationId, S.draftId)],
    ["updateFormDraft", p5Paths.formDraft(S.transformationId, S.draftId)],
    ["closeFormDraft", p5Paths.closeFormDraft(S.transformationId, S.draftId)],
    ["listProcedureDefinitions", p5Paths.procedureDefinitions],
    ["validateProcedureDefinition", p5Paths.validateProcedureDefinition],
    ["getProcedureDefinition", p5Paths.procedureDefinition(S.procedureCode)],
    ["putProcedureDefinition", p5Paths.adminProcedureDefinition(S.versionId, S.procedureCode)],
    ["removeProcedureDefinition", p5Paths.removeProcedureDefinition(S.versionId, S.procedureCode)],
    ["listProcedureInstances", p5Paths.procedureInstances],
    ["launchProcedureInstance", p5Paths.procedureInstances],
    ["getProcedureInstance", p5Paths.procedureInstance(S.instanceId)],
    ["updateProcedureInstanceInputs", p5Paths.procedureInstanceInputs(S.instanceId)],
    ["completeProcedureStep", p5Paths.completeProcedureStep(S.instanceId, S.stepKey)],
    ["skipProcedureStep", p5Paths.skipProcedureStep(S.instanceId, S.stepKey)],
    ["assignProcedureStep", p5Paths.assignProcedureStep(S.instanceId, S.stepKey)],
    ["linkProcedureStepEvidence", p5Paths.linkProcedureStepEvidence(S.instanceId, S.stepKey)],
    ["cancelProcedureInstance", p5Paths.cancelProcedureInstance(S.instanceId)],
    ["listMyProcedureSteps", p5Paths.myProcedureSteps],
    ["getMethodologyCoverage", p5Paths.methodologyCoverage],
  ];

  /** operationId -> path template, read line by line from the contract (paths are 2-space keys, ops 4-space keys). */
  function contractPaths(): Map<string, string> {
    const text = readFileSync(join(repoRoot(), "docs", "api", "openapi.yaml"), "utf8");
    const out = new Map<string, string>();
    let path = "";
    for (const line of text.split("\n")) {
      const p = /^ {2}(\/api\/v1\/\S+):\s*$/.exec(line);
      if (p) path = p[1]!;
      const op = /^ {6}operationId:\s*(\S+)\s*$/.exec(line);
      if (op && path) out.set(op[1]!, path);
    }
    return out;
  }

  /** The slice A–C operation ids (ARCH-01 and ARCH-02 blocks of the P5 operation list). */
  function sliceAtoCOperations(): string[] {
    const text = readFileSync(join(repoRoot(), "apps", "api", "test", "support", "p5-operations.ts"), "utf8");
    const from = text.indexOf("// T-DG5-ARCH-01");
    const arch02 = text.indexOf("// T-DG5-ARCH-02", from);
    // The block ends at the next architecture task's marker (ARCH-03 onward appends its own block) or at the set's end.
    const next = text.indexOf("// T-DG5-", arch02 + 1);
    const block = text.slice(from, next === -1 ? text.indexOf("]);", arch02) : next);
    return [...block.matchAll(/^\s+"([A-Za-z]+)",$/gm)].map((m) => m[1]!);
  }

  it("has the request path of each of the 72 slice A–C operations, equal to the contract's", () => {
    const ops = sliceAtoCOperations();
    expect(ops).toHaveLength(72);
    expect(CASES.map(([op]) => op).sort()).toEqual([...ops].sort());
    const contract = contractPaths();
    for (const [op, actual] of CASES) {
      const template = contract.get(op);
      expect(template, op).toBeTruthy();
      expect(actual, op).toBe(template!.replace(/\{(\w+)\}/g, (_, name: string) => sample(name)));
    }
  });

  it("encodes path segments that are codes or keys", () => {
    expect(p5Paths.configElement("V", "gate", "a/b")).toBe("/api/v1/admin/methodology-versions/V/elements/gate/a%2Fb");
    expect(p5Paths.procedureDefinition("x y")).toBe("/api/v1/procedure-definitions/x%20y");
  });

  it("query keys: a transformation's P5 keys are refreshed for that transformation only", () => {
    const tid = makeTransformation().id;
    for (const k of [
      p5Keys.area("config-pins", tid),
      p5Keys.area("methodology-migrations", tid, "m"),
      p5Keys.area("form-records", tid, "T01", "r", "comments"),
      p5Keys.area("form-drafts", tid),
    ])
      expect(isP5KeyOf(tid, k), JSON.stringify(k)).toBe(true);
    expect(isP5KeyOf("other", p5Keys.area("config-pins", tid))).toBe(false);
    expect(isP5KeyOf(tid, p5Keys.configVersion("v"))).toBe(false);
    expect(isP5KeyOf(tid, p5Keys.myProcedureSteps())).toBe(false);
    // Studio keys share one prefix (refreshed together after a Studio write); they never collide with P4 keys.
    expect(p5Keys.configElements("v").slice(0, 2)).toEqual(p5Keys.studio);
    expect(p5Keys.sourceCoverage(null).slice(0, 2)).toEqual(p5Keys.studio);
    expect(p5Keys.all[0]).toBe("p5");
  });
});
