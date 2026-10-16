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
  NAVIGATION_AREAS,
  navigationFor,
  type NavigationAreaCode,
  type P5Screen,
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
    ["methodology", "forms", "workflows", "automation", "organization", "access", "branding", "environment"],
  ],
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
    expect(to?.items.map((i) => i.code)).toEqual(["methodology"]);
    const aud = navigationFor(ofRoles("AUD")).areas.find((a) => a.code === "administration");
    expect(aud?.items.map((i) => i.code)).toEqual(["access"]);
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
  it("is planned only for items whose P5 screen is not delivered; the Studio is delivered", () => {
    const nav = navigationFor(ofRoles(...ROLE_CODES));
    const planned = nav.areas.flatMap((a) => a.items.filter((i) => i.availability === "planned").map((i) => i.code));
    expect(planned).toEqual([
      "source",
      "procedures",
      "packs",
      "forms",
      "workflows",
      "automation",
      "branding",
      "environment",
    ]);
    expect([...DELIVERED_P5_SCREENS]).toEqual(["studio"]);
  });

  it("flips an item to working when its screen joins the delivered list", () => {
    const delivered = new Set<P5Screen>([...DELIVERED_P5_SCREENS, "branding"]);
    const admin = navigationFor(ofRoles("ADM_TECH"), delivered).areas.find((a) => a.code === "administration")!;
    expect(admin.items.find((i) => i.code === "branding")?.availability).toBe("working");
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
  const AWAITING_WEB_KEYS = new Set(
    (
      [
        ["myWork", ["assignedActions", "drafts", "reviews", "approvals", "missingUpdates", "upcomingDeadlines"]],
        ["executive", ["outcomes", "value", "criticalInitiatives", "adoption", "blockers", "decisions"]],
        ["transformations", ["portfolio", "workspaces"]],
        [
          "admin",
          ["methodology", "forms", "workflows", "automation", "organization", "access", "branding", "environment"],
        ],
      ] as const
    ).flatMap(([area, items]) => items.map((i) => `nav.contents.${area}.${i}`)),
  );

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
