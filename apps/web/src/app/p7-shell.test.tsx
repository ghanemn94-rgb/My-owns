// T-DG7-FE-A (p7-plan §5.1 row FE-A, §5.3; p7-work-split §C.7/C.8, §D.4, §E.6, §I.1/I.2): the P7 shell seams in English
// LTR and Arabic RTL, against a scripted API (SYNTHETIC data).
//  - The Administration entries Data export, Migration status, Configuration transfer, Retention, Requirement register
//    and About this release are nav sub-entries; every FE-B and FE-C screen (and its detail paths) has a route that shows
//    the honest "not available yet" placeholder until its owner replaces it (P7_PLANNED_ROUTES; F-DG4-160). The
//    placeholder sends no request for P7 data and presents nothing as delivered.
//  - The 33 request paths equal the contract's (docs/api/openapi.yaml 1.6.0-p7), method included, and the P7 operation
//    set of the API tests (apps/api/test/support/p7-operations.ts); the closed value sets equal the contract's enums;
//    the P7 query keys are scoped so a refresh touches only its area.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import type { RouteObject } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Permission } from "@mth/shared";
import { ORG_ID, makeMe, mockApi, renderApp, route } from "../test/fixtures.tsx";
import { catalogues, createI18n } from "../i18n/index.ts";
import {
  ATTACHMENT_MISMATCH_PROBLEMS,
  BACKUP_SET_STATUSES,
  CONFIG_BUNDLE_IMPORT_STATUSES,
  CONFIG_BUNDLE_ITEM_ACTIONS,
  CONFIG_BUNDLE_KINDS,
  DEPLOYMENT_STORAGE_STATUSES,
  DEPLOYMENT_WORKER_STATUSES,
  IDENTITY_REBIND_STATES,
  P7_ADMIN_AREAS,
  P7_JOB_STATUSES,
  P7_OPERATIONS,
  REQUIREMENT_CLASSES,
  REQUIREMENT_STATUSES,
  RETENTION_ACTIONS,
  RETENTION_CATEGORIES,
  RETENTION_RUN_ACTIONS,
  RETENTION_RUN_MODES,
  TRANSFER_SOURCE_ENVIRONMENTS,
  isP7AdminKeyOf,
  p7Keys,
  p7Paths,
} from "../api/p7.ts";
import { NAV_AREAS, NAV_SUBPAGES, P6_ADMIN_READ_PERMISSIONS, P7_ADMIN_READ_PERMISSIONS, P7_SUBPAGES } from "./nav.ts";
import { P7_PLANNED_ROUTES, P7_SCREEN_ROUTES, routes } from "./router.tsx";

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const LOCALES = ["en", "ar"] as const;
const meRoute = (me: ReturnType<typeof makeMe>) => route("GET", /\/api\/v1\/me$/, () => ({ status: 200, body: me }));
const orgGrants = (permissions: Permission[]) => [
  { scope: { type: "organization" as const, id: ORG_ID }, inheritsDownward: false, permissions },
];
const shellChildren = (): RouteObject[] => routes.find((r) => r.path === "/")!.children!;
type Tree = { [k: string]: string | Tree };
const navCatalogue = (locale: "en" | "ar") => catalogues[locale].nav as unknown as Tree;
const p7Text = (locale: "en" | "ar", feature: string, field: "title" | "summary") =>
  ((navCatalogue(locale)["p7"] as Tree)[feature] as Tree | undefined)?.[field] as string | undefined;
const subLabel = (locale: "en" | "ar", id: string) => (navCatalogue(locale)["sub"] as Tree)[id] as string;

function repoRoot(): string {
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    if (dirname(dir) === dir) throw new Error("repository root not found");
  }
}

/** The paths of the P7 screens, by owner (p7-plan §5.1 rows FE-B and FE-C; p7-work-split §C.7, §D.4, §E.6, §I.2). */
const P7_SCREEN_ROUTES_EXPECTED: readonly (readonly [string, string, string])[] = [
  ["admin/migration/exports", "dataExport", "FE-B"],
  ["admin/migration/exports/:migrationExportId", "migrationExport", "FE-B"],
  ["admin/migration/imports", "migrationStatus", "FE-B"],
  ["admin/migration/imports/:migrationImportId", "migrationImport", "FE-B"],
  [
    "admin/migration/imports/:migrationImportId/reconciliations/:migrationReconciliationId",
    "migrationReconciliation",
    "FE-B",
  ],
  ["admin/migration/identity-rebinds", "identityRebinds", "FE-B"],
  ["admin/config-transfer", "configTransfer", "FE-B"],
  ["admin/config-transfer/exports/:configBundleExportId", "configBundleExport", "FE-B"],
  ["admin/config-transfer/imports/:configBundleImportId", "configBundleImport", "FE-B"],
  ["admin/retention", "retention", "FE-C"],
  ["admin/retention/classes/:retentionClassCode", "retentionClass", "FE-C"],
  ["admin/retention/runs/:retentionRunId", "retentionRun", "FE-C"],
  ["admin/retention/archived", "retentionArchived", "FE-C"],
  ["admin/retention/backups", "backupSets", "FE-C"],
  ["admin/requirements", "requirements", "FE-C"],
  ["admin/requirements/:reqId", "requirement", "FE-C"],
  ["admin/about", "releaseAbout", "FE-C"],
];

describe("P7 navigation entries and route placeholders (slices C, D, E, I)", () => {
  it("registers the six Administration entries of the work split, labelled in en and ar", () => {
    expect(P7_SUBPAGES.map((s) => [s.id, s.path, s.owner])).toEqual([
      ["dataExport", "/admin/migration/exports", "FE-B"],
      ["migrationStatus", "/admin/migration/imports", "FE-B"],
      ["configTransfer", "/admin/config-transfer", "FE-B"],
      ["retention", "/admin/retention", "FE-C"],
      // p7-work-split §I.1 "Requests to FE-A": the register and About, visible with operations.read.
      ["requirements", "/admin/requirements", "FE-C"],
      ["releaseAbout", "/admin/about", "FE-C"],
    ]);
    expect(P7_SUBPAGES.find((s) => s.id === "requirements")?.requiresAny).toEqual(["operations.read"]);
    expect(P7_SUBPAGES.find((s) => s.id === "releaseAbout")?.requiresAny).toEqual(["operations.read"]);
    expect(P7_SUBPAGES.find((s) => s.id === "dataExport")?.requiresAny).toEqual(["migration.export"]);
    expect(P7_SUBPAGES.find((s) => s.id === "migrationStatus")?.requiresAny).toEqual(["migration_import.read"]);
    const enLabels = new Set<string>();
    for (const s of P7_SUBPAGES) {
      expect(s.area, s.id).toBe("admin");
      expect(s.p7Feature, s.id).toBe(s.id);
      expect(NAV_SUBPAGES, s.id).toContain(s);
      expect(s.requiresAny?.length, s.id).toBeGreaterThan(0);
      for (const p of s.requiresAny ?? []) expect(P7_ADMIN_READ_PERMISSIONS, `${s.id} ${p}`).toContain(p);
      // Each entry opens a registered route.
      expect(
        shellChildren().map((r) => `/${r.path}`),
        s.id,
      ).toContain(s.path);
      for (const locale of LOCALES) {
        const contents = (navCatalogue(locale)["contents"] as Tree)["admin"] as Tree;
        expect(subLabel(locale, s.id), `${locale} nav.sub.${s.id}`).toBeTruthy();
        // The same label for the server's navigation item (`nav.contents.admin.<code>`), once the catalogue lists it.
        expect(contents[s.id], `${locale} nav.contents.admin.${s.id}`).toBe(subLabel(locale, s.id));
      }
      expect(subLabel("ar", s.id)).toMatch(/[؀-ۿ]/);
      expect(subLabel("ar", s.id)).not.toBe(subLabel("en", s.id));
      enLabels.add(subLabel("en", s.id));
    }
    // No P7 label repeats another Administration label or the shell's "About this product" link (unique link names).
    expect(enLabels.size).toBe(P7_SUBPAGES.length);
    const otherAdmin = NAV_SUBPAGES.filter((s) => s.area === "admin" && !P7_SUBPAGES.includes(s as never));
    for (const s of otherAdmin) expect(enLabels.has(subLabel("en", s.id)), s.id).toBe(false);
    expect(enLabels.has(navCatalogue("en")["about"] as string)).toBe(false);
    // The Administration area hint includes every P7 read permission.
    const admin = NAV_AREAS.find((a) => a.id === "admin")!;
    for (const p of P7_ADMIN_READ_PERMISSIONS) expect(admin.requiresAny, p).toContain(p);
    expect(new Set(admin.requiresAny).size, "no duplicate permission in the hint").toBe(admin.requiresAny!.length);
    expect(P6_ADMIN_READ_PERMISSIONS).toContain("operations.read");
  });

  it("registers every FE-B and FE-C screen up front with the placeholder, titled and summarised in en and ar", () => {
    expect(P7_SCREEN_ROUTES.map((r) => [r.path, r.feature, r.owner])).toEqual(
      P7_SCREEN_ROUTES_EXPECTED.map(([p, f, o]) => [p, f, o]),
    );
    // At T-DG7-FE-A every P7 screen still shows the placeholder; FE-B and FE-C shrink P7_PLANNED_ROUTES as they build.
    expect(P7_PLANNED_ROUTES).toEqual(P7_SCREEN_ROUTES);
    const registered = shellChildren().map((r) => r.path);
    for (const [path, feature] of P7_SCREEN_ROUTES_EXPECTED) {
      expect(
        registered.filter((p) => p === path),
        path,
      ).toHaveLength(1);
      for (const field of ["title", "summary"] as const) {
        const en = p7Text("en", feature, field);
        const ar = p7Text("ar", feature, field);
        expect(en, `en ${feature}.${field}`).toBeTruthy();
        expect(ar, `ar ${feature}.${field}`).toMatch(/[؀-ۿ]/);
        expect(ar).not.toBe(en);
      }
    }
    // Each sub-entry's own placeholder title is its nav label.
    for (const s of P7_SUBPAGES)
      for (const locale of LOCALES) expect(p7Text(locale, s.id, "title"), s.id).toBe(subLabel(locale, s.id));
    // The routes come before the catch-all, so none of them is "page not found".
    expect(registered.indexOf("*")).toBeGreaterThan(
      Math.max(...P7_SCREEN_ROUTES_EXPECTED.map(([p]) => registered.indexOf(p))),
    );
  });

  it("no placeholder text claims the screen works, names a gate, calls a state an approval, or offers an import", () => {
    for (const locale of LOCALES) {
      const texts = JSON.stringify(navCatalogue(locale)["p7"]);
      expect(texts).not.toMatch(/\bDG[0-7]\b|\bG[1-6]\b/);
      expect(texts).not.toMatch(/\blive\b|certif|complian|conform|is approved/i);
    }
    // The read-only screens say so; the register and About say they are not business approvals.
    for (const f of ["migrationStatus", "migrationImport", "migrationReconciliation", "backupSets", "requirements"])
      expect(p7Text("en", f, "summary"), f).toMatch(/read-only/i);
    expect(p7Text("en", "releaseAbout", "summary")).toContain("not business approvals");
    expect(p7Text("en", "configTransfer", "summary")).toContain("never publishes anything");
  });

  it.each(LOCALES)(
    "%s: each P7 screen path shows its placeholder, in the locale's direction, and loads no P7 data",
    async (locale) => {
      const { requests } = mockApi(
        meRoute(
          makeMe(orgGrants(["organization.read", "organization.manage", ...P7_ADMIN_READ_PERMISSIONS]), {
            preferredLocale: locale,
          }),
        ),
      );
      const sample: Record<string, string> = {
        migrationExportId: "01920000-0000-7000-9000-00000000e001",
        migrationImportId: "01920000-0000-7000-9000-00000000e002",
        migrationReconciliationId: "01920000-0000-7000-9000-00000000e003",
        configBundleExportId: "01920000-0000-7000-9000-00000000e004",
        configBundleImportId: "01920000-0000-7000-9000-00000000e005",
        retentionClassCode: "inbox_read",
        retentionRunId: "01920000-0000-7000-9000-00000000e006",
        reqId: "REQ-S02-003",
      };
      const nav = catalogues[locale].nav as unknown as { p7: { notAvailableTitle: string; notAvailableBody: string } };
      for (const [path, feature] of [0, 4, 9, 16].map((i) => P7_SCREEN_ROUTES_EXPECTED[i]!)) {
        const url = `/${path.replace(/:(\w+)/g, (_, n: string) => sample[n]!)}`;
        renderApp(url, { i18n: createI18n(locale) });
        expect(
          await screen.findByRole("heading", { level: 1, name: p7Text(locale, feature, "title")! }),
          url,
        ).toBeTruthy();
        expect(document.documentElement.dir).toBe(locale === "ar" ? "rtl" : "ltr");
        expect(document.documentElement.lang).toBe(locale);
        expect(document.querySelector(`[data-p7-feature='${feature}']`), url).not.toBeNull();
        expect(screen.getByText(nav.p7.notAvailableTitle)).toBeTruthy();
        expect(screen.getByText(nav.p7.notAvailableBody)).toBeTruthy();
        // Nothing to use: no form control inside the placeholder.
        const page = document.querySelector(`[data-p7-feature='${feature}']`)!;
        expect(page.querySelectorAll("form, input, select, textarea, button").length, url).toBe(0);
        cleanup();
      }
      const p7Requests = requests.filter((r) =>
        /\/api\/v1\/admin\/(migration-|identity-rebinds|config-bundles|retention|backups|deployment|requirements|about)/.test(
          r.url,
        ),
      );
      expect(p7Requests.map((r) => r.url)).toEqual([]);
    },
  );

  it("Administration lists the P7 entries for their holders only (a UI hint; the server decides)", async () => {
    // ADM_TECH-like synthetic grants: every P7 Administration permission plus an organization administration one.
    mockApi(
      meRoute(
        makeMe(orgGrants(["organization.read", "organization.manage", ...P7_ADMIN_READ_PERMISSIONS]), {
          preferredLocale: "en",
        }),
      ),
    );
    renderApp("/admin/retention", { i18n: createI18n("en") });
    expect(await screen.findByRole("heading", { level: 1, name: "Retention" })).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    await waitFor(() => expect(nav.dataset["navState"]).toBe("ready"));
    const admin = within(nav).getByRole("list", { name: "Administration" });
    for (const s of P7_SUBPAGES)
      expect(
        within(admin)
          .getByRole("link", { name: subLabel("en", s.id) })
          .getAttribute("href"),
        s.id,
      ).toBe(s.path);
    expect(within(admin).getByRole("link", { name: "Retention" }).getAttribute("aria-current")).toBe("page");
    cleanup();
    // operations.read alone (TO-, KDS-, TD-like) shows the register and About, and none of the transfer or retention entries.
    mockApi(
      meRoute(
        makeMe(orgGrants(["organization.read", "organization.manage", "operations.read"]), { preferredLocale: "ar" }),
      ),
    );
    renderApp("/my-work", { i18n: createI18n("ar") });
    const nav2 = await screen.findByRole("navigation", { name: navCatalogue("ar")["primary"] as string });
    await waitFor(() => expect(nav2.dataset["navState"]).toBe("ready"));
    const adminLabel = ((navCatalogue("ar")["areas"] as Tree)["admin"] as Tree)["label"] as string;
    const admin2 = within(nav2).getByRole("list", { name: adminLabel });
    for (const s of P7_SUBPAGES) {
      const link = within(admin2).queryByRole("link", { name: subLabel("ar", s.id) });
      if (s.id === "requirements" || s.id === "releaseAbout") expect(link, s.id).not.toBeNull();
      else expect(link, s.id).toBeNull();
    }
    cleanup();
    // An organization administrator without any P7 permission sees none of them.
    mockApi(meRoute(makeMe(orgGrants(["organization.read", "organization.manage"]), { preferredLocale: "en" })));
    renderApp("/my-work", { i18n: createI18n("en") });
    const nav3 = await screen.findByRole("navigation", { name: "Primary navigation" });
    await waitFor(() => expect(nav3.dataset["navState"]).toBe("ready"));
    const admin3 = within(nav3).getByRole("list", { name: "Administration" });
    for (const s of P7_SUBPAGES)
      expect(within(admin3).queryByRole("link", { name: subLabel("en", s.id) }), s.id).toBeNull();
  });
});

describe("P7 API seams (slices B, C, D, E, I)", () => {
  const ROOT = repoRoot();
  /** The contract, parsed with the workspace's own YAML parser (resolved from apps/api, as the release tools do). */
  const contract = (() => {
    const YAML = createRequire(join(ROOT, "apps", "api", "package.json"))("yaml") as { parse(s: string): unknown };
    return YAML.parse(readFileSync(join(ROOT, "docs", "api", "openapi.yaml"), "utf8")) as {
      info: { version: string };
      paths: Record<string, Record<string, { operationId?: string }>>;
      components: { schemas: Record<string, { enum?: unknown[]; properties?: Record<string, unknown> }> };
    };
  })();

  function contractOperations(): Map<string, [string, string]> {
    const out = new Map<string, [string, string]>();
    for (const [path, item] of Object.entries(contract.paths))
      for (const [method, op] of Object.entries(item))
        if (op && typeof op === "object" && op.operationId) out.set(op.operationId, [method.toUpperCase(), path]);
    return out;
  }

  /** The P7 operation ids of the API tests (apps/api/test/support/p7-operations.ts), read as text. */
  function p7OperationIds(): string[] {
    const text = readFileSync(join(ROOT, "apps", "api", "test", "support", "p7-operations.ts"), "utf8");
    return [...text.matchAll(/^\s+"([A-Za-z]+)",$/gm)].map((m) => m[1]!);
  }

  const SAMPLE: Record<string, string> = {
    migrationExportId: "E",
    migrationImportId: "I",
    migrationReconciliationId: "R",
    configBundleExportId: "BE",
    configBundleImportId: "BI",
    retentionClassCode: "C",
    retentionRunId: "RR",
    reqId: "REQ-S02-003",
  };
  const BUILT: Record<string, string> = {
    listMigrationExports: p7Paths.migrationExports,
    createMigrationExport: p7Paths.migrationExports,
    getMigrationExport: p7Paths.migrationExport("E"),
    downloadMigrationExportManifest: p7Paths.migrationExportManifest("E"),
    downloadMigrationExportAttachmentManifest: p7Paths.migrationExportAttachmentManifest("E"),
    listMigrationImports: p7Paths.migrationImports,
    getMigrationImport: p7Paths.migrationImport("I"),
    listMigrationReconciliations: p7Paths.migrationReconciliations("I"),
    getMigrationReconciliation: p7Paths.migrationReconciliation("I", "R"),
    listIdentityRebinds: p7Paths.identityRebinds,
    listConfigBundleExports: p7Paths.configBundleExports,
    createConfigBundleExport: p7Paths.configBundleExports,
    getConfigBundleExport: p7Paths.configBundleExport("BE"),
    downloadConfigBundleExport: p7Paths.configBundleExportDownload("BE"),
    listConfigBundleImports: p7Paths.configBundleImports,
    uploadConfigBundleImport: p7Paths.configBundleImports,
    getConfigBundleImport: p7Paths.configBundleImport("BI"),
    validateConfigBundleImport: p7Paths.validateConfigBundleImport("BI"),
    commitConfigBundleImport: p7Paths.commitConfigBundleImport("BI"),
    listRetentionClasses: p7Paths.retentionClasses,
    getRetentionClass: p7Paths.retentionClass("C"),
    updateRetentionClass: p7Paths.retentionClass("C"),
    listRetentionRuns: p7Paths.retentionRuns,
    createRetentionRun: p7Paths.retentionRuns,
    createRetentionDryRun: p7Paths.retentionDryRuns,
    getRetentionRun: p7Paths.retentionRun("RR"),
    listRetentionRunActions: p7Paths.retentionRunActions("RR"),
    listRetentionArchivedRecords: p7Paths.retentionArchived,
    listBackupSets: p7Paths.backupSets,
    getDeploymentStatus: p7Paths.deploymentStatus,
    listRequirements: p7Paths.requirements,
    getRequirement: p7Paths.requirement("REQ-S02-003"),
    getReleaseAbout: p7Paths.about,
  };

  it("lists exactly the 33 P7 operations, with the contract's method and path", () => {
    expect(contract.info.version).toBe("1.6.0-p7");
    const ops = p7OperationIds();
    expect(ops).toHaveLength(33);
    expect(P7_OPERATIONS.map(([op]) => op).sort()).toEqual([...ops].sort());
    expect(Object.keys(BUILT).sort()).toEqual([...ops].sort());
    const all = contractOperations();
    for (const [op, method, template] of P7_OPERATIONS) {
      expect(all.get(op), op).toEqual([method, template]);
      expect(BUILT[op], op).toBe(template.replace(/\{(\w+)\}/g, (_, name: string) => SAMPLE[name] ?? `?${name}`));
    }
  });

  it("no P7 path starts a migration import or an identity rebind (CLI only, p7-work-split §C.11)", () => {
    const writes = P7_OPERATIONS.filter(([, method]) => method !== "GET").map(([op]) => op);
    expect(writes.sort()).toEqual(
      [
        "createMigrationExport",
        "createConfigBundleExport",
        "uploadConfigBundleImport",
        "validateConfigBundleImport",
        "commitConfigBundleImport",
        "updateRetentionClass",
        "createRetentionRun",
        "createRetentionDryRun",
      ].sort(),
    );
    for (const op of writes) expect(op, op).not.toMatch(/MigrationImport|Rebind/);
  });

  it("encodes path segments", () => {
    expect(p7Paths.migrationExport("a/b")).toBe("/api/v1/admin/migration-exports/a%2Fb");
    expect(p7Paths.retentionClass("x y")).toBe("/api/v1/admin/retention/classes/x%20y");
    expect(p7Paths.migrationReconciliation("../i", "r?x")).toBe(
      "/api/v1/admin/migration-imports/..%2Fi/reconciliations/r%3Fx",
    );
    expect(p7Paths.requirement("REQ-S02-003")).toBe("/api/v1/admin/requirements/REQ-S02-003");
  });

  it("the closed value sets equal the contract's enums", () => {
    const S = contract.components.schemas;
    const prop = (schema: string, ...path: string[]): unknown[] | undefined => {
      let node: unknown = S[schema];
      for (const p of path) {
        const n = node as { properties?: Record<string, unknown>; items?: unknown };
        node = p === "[]" ? n.items : n.properties?.[p];
      }
      return (node as { enum?: unknown[] } | undefined)?.enum;
    };
    expect(prop("MigrationExport", "status")).toEqual([...P7_JOB_STATUSES]);
    expect(prop("RetentionRun", "status")).toEqual([...P7_JOB_STATUSES]);
    expect(S["TransferSourceEnvironment"]?.enum).toEqual([...TRANSFER_SOURCE_ENVIRONMENTS]);
    expect(prop("IdentityRebind", "state")).toEqual([...IDENTITY_REBIND_STATES]);
    expect(prop("MigrationReconciliation", "attachmentMismatches", "[]", "problem")).toEqual([
      ...ATTACHMENT_MISMATCH_PROBLEMS,
    ]);
    expect(S["ConfigBundleKind"]?.enum).toEqual([...CONFIG_BUNDLE_KINDS]);
    expect(prop("ConfigBundleImport", "status")).toEqual([...CONFIG_BUNDLE_IMPORT_STATUSES]);
    expect(prop("ConfigBundleImportItem", "action")).toEqual([...CONFIG_BUNDLE_ITEM_ACTIONS]);
    expect(S["RetentionAction"]?.enum).toEqual([...RETENTION_ACTIONS]);
    expect(S["RetentionCategory"]?.enum).toEqual([...RETENTION_CATEGORIES]);
    expect(prop("RetentionRun", "mode")).toEqual([...RETENTION_RUN_MODES]);
    expect(prop("RetentionRunAction", "action")).toEqual([...RETENTION_RUN_ACTIONS]);
    expect(prop("BackupSet", "status")).toEqual([...BACKUP_SET_STATUSES]);
    expect(prop("DeploymentStatus", "storage", "status")).toEqual([...DEPLOYMENT_STORAGE_STATUSES]);
    expect(prop("DeploymentStatus", "worker", "status")).toEqual([...DEPLOYMENT_WORKER_STATUSES]);
    expect(S["RequirementClass"]?.enum).toEqual([...REQUIREMENT_CLASSES]);
    expect(S["RequirementStatus"]?.enum).toEqual([...REQUIREMENT_STATUSES]);
  });

  it("query keys: an administration refresh touches its own area only", () => {
    expect(new Set(P7_ADMIN_AREAS).size).toBe(P7_ADMIN_AREAS.length);
    const keys: [string, readonly unknown[]][] = [
      ["migration-exports", p7Keys.migrationExport("E")],
      ["migration-exports", p7Keys.migrationExportManifest("E")],
      ["migration-imports", p7Keys.migrationReconciliation("I", "R")],
      ["identity-rebinds", p7Keys.identityRebinds({ state: "unbound" })],
      ["config-bundles", p7Keys.configBundleImports(ORG_ID)],
      ["retention", p7Keys.retentionArchived({})],
      ["backups", p7Keys.backupSets],
      ["deployment", p7Keys.deploymentStatus],
      ["requirements", p7Keys.requirements({ status: "BLOCKED" })],
      ["about", p7Keys.about],
    ];
    for (const [area, key] of keys)
      for (const other of P7_ADMIN_AREAS)
        expect(isP7AdminKeyOf(other, key), `${area} key vs ${other}`).toBe(other === area);
    // A P6 key is never a P7 key.
    expect(isP7AdminKeyOf("retention", ["p6", "admin", "retention"])).toBe(false);
  });
});
