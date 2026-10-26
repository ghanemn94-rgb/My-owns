// T-DG6-FE-A (p6-plan §5.1 row FE-A; p6-work-split §E/F.12, §J/C.13): the P6 shell seams of slices E, F, J and C, in
// English LTR and Arabic RTL, against a scripted API (SYNTHETIC data).
//  - The Administration entries Audit, Security (upload policy, rate limits), Sensitive grants, Operations, Identity,
//    Storage and Notifications are nav sub-entries; every FE-B screen (and the deep-link landing /l/:token) has a route
//    with an honest "not available yet" placeholder that loads no data (F-DG4-160).
//  - The 30 request paths equal the contract's (docs/api/openapi.yaml 1.5.0-p6), method included; the P6 query keys
//    are scoped so a refresh touches only its area.
//  - A resolved deep link navigates only inside the app (`safeInternalPath`); a malformed token is never sent.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import type { RouteObject } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Permission } from "@mth/shared";
import { ORG_ID, makeMe, mockApi, renderApp, route } from "../test/fixtures.tsx";
import { catalogues, createI18n } from "../i18n/index.ts";
import {
  DEEP_LINK_TOKEN,
  P6_ADMIN_AREAS,
  P6_SLICE_EFJC_OPERATIONS,
  isP6AdminKeyOf,
  p6Keys,
  p6Paths,
  safeInternalPath,
} from "../api/p6.ts";
import { NAV_AREAS, NAV_SUBPAGES, P6_ADMIN_READ_PERMISSIONS, P6_SUBPAGES } from "./nav.ts";
import { P6_PLANNED_ROUTES, routes } from "./router.tsx";

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
const p6Text = (locale: "en" | "ar", feature: string, field: "title" | "summary") =>
  ((navCatalogue(locale)["p6"] as Tree)[feature] as Tree | undefined)?.[field];

function repoRoot(): string {
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    if (dirname(dir) === dir) throw new Error("repository root not found");
  }
}

// A synthetic, well-formed deep-link token (43 base64url characters).
const TOKEN = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123456";

describe("P6 navigation entries and route placeholders (slices E, F, J, C)", () => {
  it("registers the seven Administration entries of p6-work-split §E/F.12 and §J/C.13, labelled in en and ar", () => {
    expect(P6_SUBPAGES.map((s) => s.id)).toEqual([
      "audit",
      "security",
      "sensitiveGrants",
      "operations",
      "identity",
      "storage",
      "notifications",
    ]);
    for (const s of P6_SUBPAGES) {
      expect(s.area, s.id).toBe("admin");
      expect(s.owner, s.id).toBe("FE-B");
      expect(NAV_SUBPAGES, s.id).toContain(s);
      expect(s.requiresAny?.length, s.id).toBeGreaterThan(0);
      for (const p of s.requiresAny ?? []) expect(P6_ADMIN_READ_PERMISSIONS, `${s.id} ${p}`).toContain(p);
      // Each entry opens a registered placeholder route.
      expect(
        P6_PLANNED_ROUTES.map((r) => `/${r.path}`),
        s.id,
      ).toContain(s.path);
      for (const locale of LOCALES) {
        const sub = navCatalogue(locale)["sub"] as Tree;
        const contents = (navCatalogue(locale)["contents"] as Tree)["admin"] as Tree;
        expect(sub[s.id], `${locale} nav.sub.${s.id}`).toBeTruthy();
        // The same label for the server's navigation item (`nav.contents.admin.<code>`), once the catalogue lists it.
        expect(contents[s.id], `${locale} nav.contents.admin.${s.id}`).toBe(sub[s.id]);
      }
      expect(navCatalogue("ar")["sub"] as Tree).not.toHaveProperty(s.id, (navCatalogue("en")["sub"] as Tree)[s.id]);
    }
    // The Administration area hint includes the P6 read permissions (AUD, KDS and TD read P6 screens).
    const admin = NAV_AREAS.find((a) => a.id === "admin")!;
    for (const p of P6_ADMIN_READ_PERMISSIONS) expect(admin.requiresAny, p).toContain(p);
  });

  it("registers every FE-B screen and /l/:token as a route with a placeholder text in en and ar", () => {
    expect(P6_PLANNED_ROUTES.map((r) => r.path).sort()).toEqual(
      [
        "admin/audit",
        "admin/audit/:auditEventId",
        "admin/security",
        "admin/upload-policy",
        "admin/sensitive-grants",
        "admin/sensitive-grants/:grantId",
        "l/:token",
        "admin/operations",
        "admin/operations/exceptions/:exceptionId",
        "admin/service-identities",
        "admin/service-identities/:serviceIdentityId",
        "admin/identity",
        "admin/storage",
        "admin/notification-channels",
        "admin/notification-channels/:channelKind",
        "admin/notification-deliveries",
      ].sort(),
    );
    const registered = shellChildren().map((r) => r.path);
    for (const r of P6_PLANNED_ROUTES) {
      expect(registered, r.path).toContain(r.path);
      expect(r.owner, r.path).toBe("FE-B");
      for (const field of ["title", "summary"] as const) {
        const en = p6Text("en", r.feature, field);
        const ar = p6Text("ar", r.feature, field);
        expect(en, `en ${r.feature}.${field}`).toBeTruthy();
        expect(ar, `ar ${r.feature}.${field}`).toMatch(/[؀-ۿ]/);
        expect(ar).not.toBe(en);
      }
    }
    // The placeholder routes come before the catch-all, so none of them is "page not found".
    expect(registered.indexOf("*")).toBeGreaterThan(
      Math.max(...P6_PLANNED_ROUTES.map((r) => registered.indexOf(r.path))),
    );
  });

  it("no placeholder text claims the screen works, names an engineering delivery gate or calls anything live", () => {
    for (const locale of LOCALES) {
      const p6 = navCatalogue(locale)["p6"] as Tree;
      const texts = JSON.stringify(p6);
      expect(texts).not.toMatch(/\bDG[0-7]\b/);
      expect(texts).not.toMatch(/\blive\b|integrated with Mobily|tested against production/i);
    }
    expect(p6Text("en", "identity", "summary")).toContain("never shown");
  });

  it.each(LOCALES)(
    "%s: an Administration placeholder states it is not available yet and loads no data",
    async (locale) => {
      const { requests } = mockApi(
        meRoute(
          makeMe(orgGrants(["organization.read", "organization.manage", "audit_event.read"]), {
            preferredLocale: locale,
          }),
        ),
      );
      renderApp("/admin/audit", { i18n: createI18n(locale) });
      const t = catalogues[locale].nav as unknown as { p6: { audit: { title: string }; notAvailableTitle: string } };
      expect(await screen.findByRole("heading", { level: 1, name: t.p6.audit.title })).toBeTruthy();
      expect(screen.getByText(t.p6.notAvailableTitle)).toBeTruthy();
      expect(document.documentElement.dir).toBe(locale === "ar" ? "rtl" : "ltr");
      expect(document.querySelector("[data-p6-feature='audit']")).toBeTruthy();
      expect(requests.some((r) => r.url.includes("/audit-events"))).toBe(false);
    },
  );

  it.each(LOCALES)(
    "%s: /l/:token shows the deep-link placeholder after sign-in and sends nothing to /links",
    async (locale) => {
      const { requests } = mockApi(meRoute(makeMe(orgGrants(["organization.read"]), { preferredLocale: locale })));
      renderApp(`/l/${TOKEN}`, { i18n: createI18n(locale) });
      expect(
        await screen.findByRole("heading", { level: 1, name: p6Text(locale, "deepLink", "title") as string }),
      ).toBeTruthy();
      expect(requests.some((r) => r.url.includes("/api/v1/links/"))).toBe(false);
    },
  );

  it("Administration lists the P6 entries for their holders only (a UI hint; the server decides)", async () => {
    // ADM_TECH-like synthetic grants: every P6 Administration permission plus an organization administration one.
    mockApi(
      meRoute(
        makeMe(orgGrants(["organization.read", "organization.manage", ...P6_ADMIN_READ_PERMISSIONS]), {
          preferredLocale: "en",
        }),
      ),
    );
    renderApp("/admin/operations", { i18n: createI18n("en") });
    expect(await screen.findByRole("heading", { level: 1, name: "Operations" })).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    await waitFor(() => expect(nav.dataset["navState"]).toBe("ready"));
    const admin = within(nav).getByRole("list", { name: "Administration" });
    for (const s of P6_SUBPAGES) {
      const label = (navCatalogue("en")["sub"] as Tree)[s.id] as string;
      expect(within(admin).getByRole("link", { name: label }).getAttribute("href"), s.id).toBe(s.path);
    }
    expect(within(admin).getByRole("link", { name: "Operations" }).getAttribute("aria-current")).toBe("page");
    cleanup();
    // An organization administrator without any P6 permission sees none of them.
    mockApi(meRoute(makeMe(orgGrants(["organization.read", "organization.manage"]), { preferredLocale: "en" })));
    renderApp("/my-work", { i18n: createI18n("en") });
    const nav2 = await screen.findByRole("navigation", { name: "Primary navigation" });
    await waitFor(() => expect(nav2.dataset["navState"]).toBe("ready"));
    const admin2 = within(nav2).getByRole("list", { name: "Administration" });
    for (const s of P6_SUBPAGES) {
      const label = (navCatalogue("en")["sub"] as Tree)[s.id] as string;
      expect(within(admin2).queryByRole("link", { name: label }), s.id).toBeNull();
    }
  });
});

describe("P6 API seams (slices E, F, J, C)", () => {
  /** operationId -> [method, path template], read line by line from the contract. */
  function contractOperations(): Map<string, [string, string]> {
    const text = readFileSync(join(repoRoot(), "docs", "api", "openapi.yaml"), "utf8");
    const out = new Map<string, [string, string]>();
    let path = "";
    let method = "";
    for (const line of text.split("\n")) {
      const p = /^ {2}(\/api\/v1\/\S+):\s*$/.exec(line);
      if (p) path = p[1]!;
      const m = /^ {4}(get|put|post|patch|delete):\s*$/.exec(line);
      if (m) method = m[1]!.toUpperCase();
      const op = /^ {6}operationId:\s*(\S+)\s*$/.exec(line);
      if (op && path) out.set(op[1]!, [method, path]);
    }
    return out;
  }

  /** The slice E, F, J and C operation ids (the ARCH-01 and ARCH-02 blocks of the P6 operation list). */
  function sliceOperations(): string[] {
    const text = readFileSync(join(repoRoot(), "apps", "api", "test", "support", "p6-operations.ts"), "utf8");
    const from = text.indexOf("// T-DG6-ARCH-01");
    const arch02 = text.indexOf("// T-DG6-ARCH-02", from);
    const next = text.indexOf("// T-DG6-", arch02 + 1);
    const block = text.slice(from, next === -1 ? text.indexOf("]);", arch02) : next);
    return [...block.matchAll(/^\s+"([A-Za-z]+)",$/gm)].map((m) => m[1]!);
  }

  const SAMPLE: Record<string, string> = {
    transformationId: "T",
    recordType: "benefit",
    recordId: "R",
    grantId: "G",
    token: TOKEN,
    evidenceId: "E",
    auditEventId: "A",
    exceptionId: "X",
    serviceIdentityId: "S",
    channelKind: "email",
  };
  const BUILT: Record<string, string> = {
    getRecordSensitivity: p6Paths.recordSensitivity("T", "benefit", "R"),
    putRecordSensitivity: p6Paths.recordSensitivity("T", "benefit", "R"),
    listSensitiveGrants: p6Paths.sensitiveGrants,
    createSensitiveGrant: p6Paths.sensitiveGrants,
    getSensitiveGrant: p6Paths.sensitiveGrant("G"),
    revokeSensitiveGrant: p6Paths.revokeSensitiveGrant("G"),
    resolveDeepLink: p6Paths.deepLink(TOKEN),
    previewEvidenceContent: p6Paths.evidencePreview("T", "E"),
    getUploadPolicy: p6Paths.uploadPolicy,
    putUploadPolicy: p6Paths.uploadPolicy,
    getSecurityRateLimits: p6Paths.securityRateLimits,
    listAuditEvents: p6Paths.auditEvents,
    getAuditEvent: p6Paths.auditEvent("A"),
    listOperationalExceptions: p6Paths.operationalExceptions,
    getOperationalException: p6Paths.operationalException("X"),
    acknowledgeOperationalException: p6Paths.acknowledgeOperationalException("X"),
    resolveOperationalException: p6Paths.resolveOperationalException("X"),
    getWorkerHeartbeat: p6Paths.workerHeartbeat,
    listServiceIdentities: p6Paths.serviceIdentities,
    getServiceIdentity: p6Paths.serviceIdentity("S"),
    putServiceIdentity: p6Paths.serviceIdentity("S"),
    getIdentitySettings: p6Paths.identitySettings,
    getStorageSetting: p6Paths.storageSetting,
    putStorageSetting: p6Paths.storageSetting,
    testStorageSetting: p6Paths.testStorageSetting,
    listNotificationChannels: p6Paths.notificationChannels,
    getNotificationChannel: p6Paths.notificationChannel("email"),
    putNotificationChannel: p6Paths.notificationChannel("email"),
    testNotificationChannel: p6Paths.testNotificationChannel("email"),
    listNotificationDeliveries: p6Paths.notificationDeliveries,
  };

  it("lists exactly the 30 slice E, F, J and C operations, with the contract's method and path", () => {
    const ops = sliceOperations();
    expect(ops).toHaveLength(30);
    expect(P6_SLICE_EFJC_OPERATIONS.map(([op]) => op).sort()).toEqual([...ops].sort());
    expect(Object.keys(BUILT).sort()).toEqual([...ops].sort());
    const contract = contractOperations();
    for (const [op, method, template] of P6_SLICE_EFJC_OPERATIONS) {
      expect(contract.get(op), op).toEqual([method, template]);
      expect(BUILT[op], op).toBe(template.replace(/\{(\w+)\}/g, (_, name: string) => SAMPLE[name] ?? `?${name}`));
    }
  });

  it("encodes path segments", () => {
    expect(p6Paths.sensitiveGrant("a/b")).toBe("/api/v1/admin/sensitive-grants/a%2Fb");
    expect(p6Paths.notificationChannel("x y")).toBe("/api/v1/admin/notification-channels/x%20y");
    expect(p6Paths.recordSensitivity("T", "business_case", "../x")).toBe(
      "/api/v1/transformations/T/records/business_case/..%2Fx/sensitivity",
    );
  });

  it("query keys: an administration refresh touches its own area only", () => {
    expect(new Set(P6_ADMIN_AREAS).size).toBe(P6_ADMIN_AREAS.length);
    const audit = p6Keys.auditEvents({ organizationId: ORG_ID });
    expect(isP6AdminKeyOf("audit", audit)).toBe(true);
    expect(isP6AdminKeyOf("operations", audit)).toBe(false);
    expect(isP6AdminKeyOf("operations", p6Keys.workerHeartbeat)).toBe(true);
    expect(isP6AdminKeyOf("operations", p6Keys.serviceIdentities({}))).toBe(false);
    expect(isP6AdminKeyOf("service-identities", p6Keys.serviceIdentity("S"))).toBe(true);
    expect(isP6AdminKeyOf("audit", p6Keys.recordSensitivity("T", "benefit", "R"))).toBe(false);
    expect(p6Keys.recordSensitivity("T", "benefit", "R").slice(0, 3)).toEqual([...p6Keys.sensitivity("T")]);
    expect(isP6AdminKeyOf("audit", ["p5", "admin", "audit"])).toBe(false);
  });

  it("a resolved deep link navigates only inside the app; a malformed token is not a token", () => {
    expect(safeInternalPath("/transformations/T/benefits/B")).toBe("/transformations/T/benefits/B");
    for (const bad of [
      "//evil.example/x",
      "/\\evil.example",
      "https://evil.example/",
      "javascript:alert(1)",
      "transformations/T",
      "/",
      "/a\u0000b",
      "/a\nb",
      `/${"a".repeat(500)}`,
      null,
      42,
    ])
      expect(safeInternalPath(bad), String(bad)).toBeNull();
    expect(DEEP_LINK_TOKEN.test(TOKEN)).toBe(true);
    for (const bad of [TOKEN.slice(1), `${TOKEN}A`, `${TOKEN.slice(1)}=`, `${TOKEN.slice(1)}/`])
      expect(DEEP_LINK_TOKEN.test(bad), bad).toBe(false);
  });
});
