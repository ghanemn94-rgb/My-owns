// GET /me/navigation as data (ADR-0049 §9; REQ-S03-007; T-DG5-BE-R2): the table, visibility from held permissions,
// omission of hidden areas and items, the availability list and the web label keys. Pure (no database); the HTTP
// route against a real PostgreSQL is apps/api/test/integration/navigation/navigation.test.ts.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PERMISSION_CODES, ROLE_CODES, ROLES, type Permission, type RoleCode } from "@mth/shared";
import { describe, expect, it } from "vitest";
import type { Principal } from "../access/index.ts";
import {
  DELIVERED_P5_SCREENS,
  DELIVERED_P6_SCREENS,
  NAVIGATION_AREAS,
  navigationFor,
  type NavigationAreaCode,
  type P5Screen,
  type P6Screen,
} from "./navigation.ts";

const principal = (permissions: readonly Permission[]): Principal => ({
  kind: "user",
  userId: "0190a000-0000-7000-8000-000000000001",
  organizationId: "0190a000-0000-7000-8000-000000000002",
  grants:
    permissions.length === 0
      ? []
      : [
          {
            assignmentId: "0190a000-0000-7000-8000-000000000003",
            roleCode: "SYNTHETIC",
            inheritsDownward: true,
            scopeType: "organization",
            scopeId: "0190a000-0000-7000-8000-000000000002",
            organizationId: "0190a000-0000-7000-8000-000000000002",
            permissions: new Set(permissions),
          },
        ],
  tracker: { decisions: 0 },
});
const ROLE_PERMISSIONS = new Map<string, readonly Permission[]>(
  Object.entries(ROLES).map(([code, role]) => [code, role.permissions]),
);
const ofRoles = (...roles: RoleCode[]) => principal(roles.flatMap((r) => ROLE_PERMISSIONS.get(r) ?? []));

/** ADR-0049 §9, literally: the areas in order with their M0100-M0113 contents. */
const TABLE: readonly [NavigationAreaCode, string, readonly string[]][] = [
  ["my_work", "myWork", ["assignedActions", "drafts", "reviews", "approvals", "missingUpdates", "upcomingDeadlines"]],
  [
    "executive_overview",
    "executive",
    ["outcomes", "value", "criticalInitiatives", "adoption", "blockers", "decisions"],
  ],
  ["transformations", "transformations", ["portfolio", "workspaces"]],
  ["playbook_procedures", "playbook", ["source", "guidance", "procedures"]],
  ["strategy_kpis", "strategy", ["outcomeTrees", "definitions", "targets", "actuals", "performanceReviews"]],
  ["target_operating_model", "tom", ["canvas", "gaps", "capabilities", "processes", "designDecisions"]],
  [
    "initiatives_roadmaps",
    "initiatives",
    ["cases", "prioritization", "waves", "resources", "milestones", "dependencies"],
  ],
  ["governance", "governance", ["forums", "meetings", "decisionRights", "raci", "approvals", "stageGates"]],
  ["risks_actions", "risks", ["raid", "correctiveActions", "escalations"]],
  ["benefits_finance", "benefits", ["formulas", "realization", "validation", "forecasts"]],
  ["change_adoption", "change", ["stakeholders", "interventions", "adoptionIndicators"]],
  ["evidence_reports", "evidence", ["deliverables", "attachments", "snapshots", "packs"]],
  ["bau_improvement", "bau", ["handovers", "controls", "lessons", "improvementBacklog"]],
  [
    "administration",
    "admin",
    [
      "methodology",
      "forms",
      "workflows",
      "automation",
      "organization",
      "access",
      "branding",
      "environment",
      // P6 (D-198; T-DG6-BE-B2)
      "audit",
      "security",
      "sensitiveGrants",
      "operations",
      "identity",
      "storage",
      "notifications",
    ],
  ],
];

/** The P6 Administration items (D-198) with their codes; each is visible to a caller holding any ONE of them. */
const P6_ADMIN_ITEMS: readonly [string, string, readonly Permission[]][] = [
  ["audit", "/admin/audit", ["audit_event.read"]],
  ["security", "/admin/security", ["security.read", "upload_policy.configure"]],
  ["sensitiveGrants", "/admin/sensitive-grants", ["sensitive_record.read", "sensitive_record.grant"]],
  ["operations", "/admin/operations", ["operations.read", "service_identity.configure"]],
  ["identity", "/admin/identity", ["identity.read"]],
  ["storage", "/admin/storage", ["storage.configure"]],
  ["notifications", "/admin/notification-channels", ["notification_channel.configure"]],
];

/** The ADR-0049 §9 Administration codes (row 14). */
const ADMIN_CODES: readonly Permission[] = [
  "methodology.publish",
  "methodology.review",
  "config_review_policy.configure",
  "automation.configure",
  "job.read",
  "organization.manage",
  "business_unit.manage",
  "user.read",
  "user.manage",
  "access.read",
  "access.assign",
  "branding.configure",
  "demo.reset",
  ...P6_ADMIN_ITEMS.flatMap(([, , codes]) => codes),
];

describe("the ADR-0049 §9 table as data", () => {
  it("lists the 14 areas in order, each with its M0100-M0113 contents", () => {
    expect(NAVIGATION_AREAS.map((a) => [a.code, a.webId, a.items.map((i) => i.code)])).toEqual(TABLE);
  });

  it("uses only known permission codes, and exactly the §9 Administration codes", () => {
    const codes = NAVIGATION_AREAS.flatMap((a) => a.items.flatMap((i) => (i.access === "session" ? [] : i.access)));
    for (const c of codes) expect(PERMISSION_CODES).toContain(c);
    const admin = NAVIGATION_AREAS.find((a) => a.code === "administration")!;
    expect(new Set(admin.items.flatMap((i) => (i.access === "session" ? [] : i.access)))).toEqual(new Set(ADMIN_CODES));
  });
});

describe("visibility from held permissions (REQ-S03-007)", () => {
  it("an ADM test user holding every role default sees all 14 areas with every item", () => {
    const nav = navigationFor(ofRoles(...ROLE_CODES));
    expect(nav.areas.map((a) => [a.code, a.webId, a.items.map((i) => i.code)])).toEqual(TABLE);
    expect(nav.areas.map((a) => a.labelKey)).toEqual(TABLE.map(([, webId]) => `nav.areas.${webId}.label`));
  });

  it("a Workstream Lead does not see Administration: WL's role defaults hold none of the §9 Administration codes", () => {
    expect(ROLES.WL.permissions.filter((p) => ADMIN_CODES.includes(p))).toEqual([]);
    const nav = navigationFor(ofRoles("WL"));
    expect(nav.areas.map((a) => a.code)).not.toContain("administration");
    expect(nav.areas).toHaveLength(13);
  });

  it("TO sees Administration for the Studio review page; AUD sees it read-only through user.read/access.read", () => {
    const to = navigationFor(ofRoles("TO")).areas.find((a) => a.code === "administration");
    // P6 (D-198): TO also holds sensitive_record.grant/read and operations.read (0100, 0103).
    expect(to?.items.map((i) => i.code)).toEqual(["methodology", "sensitiveGrants", "operations"]);
    const aud = navigationFor(ofRoles("AUD")).areas.find((a) => a.code === "administration");
    // P6 (D-198): AUD also reads audit events, security, sensitive grants, operations and identity.
    expect(aud?.items.map((i) => i.code)).toEqual([
      "access",
      "audit",
      "security",
      "sensitiveGrants",
      "operations",
      "identity",
    ]);
  });

  it("P6 (D-198): a caller holding only one P6 Administration code sees Administration with exactly that item", () => {
    for (const [code, path, codes] of P6_ADMIN_ITEMS)
      for (const permission of codes) {
        const nav = navigationFor(principal([permission]));
        const admin = nav.areas.find((a) => a.code === "administration");
        expect(admin?.items, permission).toEqual([
          { code, labelKey: `nav.contents.admin.${code}`, path, availability: "planned" },
        ]);
      }
  });

  it("ADM_TECH, ADM_ACCESS and ADM_METHOD each see Administration", () => {
    for (const role of ["ADM_TECH", "ADM_ACCESS", "ADM_METHOD"] as const) {
      expect(navigationFor(ofRoles(role)).areas.map((a) => a.code)).toContain("administration");
    }
  });

  it("a user without grants gets only the session items; hidden areas and items are omitted, not flagged", () => {
    const nav = navigationFor(principal([]));
    expect(nav.areas.map((a) => [a.code, a.items.map((i) => i.code)])).toEqual([
      ["my_work", ["assignedActions", "drafts", "reviews", "approvals", "missingUpdates", "upcomingDeadlines"]],
      ["playbook_procedures", ["source", "guidance"]],
    ]);
    for (const area of nav.areas) {
      expect(Object.keys(area).sort()).toEqual(["code", "items", "labelKey", "path", "webId"]);
      for (const item of area.items)
        expect(Object.keys(item).sort()).toEqual(["availability", "code", "labelKey", "path"]);
    }
  });

  it("an item is visible when ANY of its codes is held (automation through job.read alone)", () => {
    const nav = navigationFor(principal(["job.read"]));
    expect(nav.areas.find((a) => a.code === "administration")?.items.map((i) => i.code)).toEqual(["automation"]);
    expect(nav.areas.map((a) => a.code)).not.toContain("transformations");
  });
});

describe("availability (F-DG4-160)", () => {
  // T-DG5-FE-G: every P5 screen a navigation item opens is delivered (FE-B to FE-G), so no item is planned (F-DG4-160).
  it("is planned only for items whose P5 screen is not delivered; every P5 screen is delivered", () => {
    const nav = navigationFor(ofRoles(...ROLE_CODES));
    const planned = nav.areas.flatMap((a) => a.items.filter((i) => i.availability === "planned").map((i) => i.code));
    // P6 (D-198): the P6 Administration screens are FE-B's placeholders until delivered, so their items are planned.
    expect(planned).toEqual(P6_ADMIN_ITEMS.map(([code]) => code));
    expect([...DELIVERED_P6_SCREENS]).toEqual([]);
    expect([...DELIVERED_P5_SCREENS].sort()).toEqual(
      [
        "automation",
        "branding",
        "demo",
        "formBuilder",
        "myProcedures",
        "procedureBuilder",
        "reader",
        "reports",
        "studio",
      ].sort(),
    );
  });

  it("flips an item to working when its screen joins the delivered list", () => {
    const without = new Set<P5Screen>([...DELIVERED_P5_SCREENS].filter((s) => s !== "branding"));
    const before = navigationFor(ofRoles("ADM_TECH"), without).areas.find((a) => a.code === "administration")!;
    expect(before.items.find((i) => i.code === "branding")?.availability).toBe("planned");
    const delivered = new Set<P5Screen>([...without, "branding"]);
    const admin = navigationFor(ofRoles("ADM_TECH"), delivered).areas.find((a) => a.code === "administration")!;
    expect(admin.items.find((i) => i.code === "branding")?.availability).toBe("working");
  });

  it("P6 (D-198): flips a P6 item to working when its screen joins the delivered P6 list", () => {
    const admin = (delivered: ReadonlySet<P6Screen>) =>
      navigationFor(principal(["audit_event.read"]), DELIVERED_P5_SCREENS, delivered).areas.find(
        (a) => a.code === "administration",
      )!;
    expect(admin(new Set()).items.map((i) => i.availability)).toEqual(["planned"]);
    expect(admin(new Set<P6Screen>(["audit"])).items.map((i) => i.availability)).toEqual(["working"]);
  });
});

describe("the web label keys (apps/web/src/i18n/{en,ar}/nav.json)", () => {
  const catalogue = (lang: "en" | "ar") =>
    JSON.parse(
      readFileSync(fileURLToPath(new URL(`../../../../web/src/i18n/${lang}/nav.json`, import.meta.url)), "utf8"),
    ) as Record<string, unknown>;
  const lookup = (cat: Record<string, unknown>, key: string): unknown =>
    key
      .replace(/^nav\./, "")
      .split(".")
      .reduce<unknown>(
        (o, k) => (o !== null && typeof o === "object" ? new Map(Object.entries(o)).get(k) : undefined),
        cat,
      );

  /**
   * Item label keys the web catalogue does not have yet (the four areas without a landing-page contents list). The
   * BE-R2 handback proposes their en and ar texts to the owner of nav.json; this list may only shrink.
   */
  // T-DG5-FE-G added the en and ar texts of the four areas (myWork, executive, transformations, admin): none awaits.
  const AWAITING_WEB_KEYS = new Set<string>();

  it("every area label resolves in en and ar", () => {
    const nav = navigationFor(ofRoles(...ROLE_CODES));
    for (const lang of ["en", "ar"] as const) {
      const cat = catalogue(lang);
      for (const area of nav.areas) {
        const label = lookup(cat, area.labelKey);
        expect(typeof label === "string" && label.trim().length > 0, `${lang} ${area.labelKey}`).toBe(true);
      }
    }
  });

  it("every item label resolves in en and ar, except the keys awaiting the web catalogue", () => {
    const nav = navigationFor(ofRoles(...ROLE_CODES));
    for (const lang of ["en", "ar"] as const) {
      const cat = catalogue(lang);
      const missing = nav.areas
        .flatMap((a) => a.items.map((i) => i.labelKey))
        .filter((key) => {
          const label = lookup(cat, key);
          return !(typeof label === "string" && label.trim().length > 0);
        });
      expect(
        missing.filter((k) => !AWAITING_WEB_KEYS.has(k)),
        lang,
      ).toEqual([]);
    }
  });
});
