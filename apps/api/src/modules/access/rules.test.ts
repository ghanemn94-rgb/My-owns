// Unit tests of the policy function's pure rules (ADR-0006): scope resolution, inheritance, siblings, reserved
// scopes, structural permissions and the separation-of-duties hooks.
import type { Permission, ScopeType } from "@mth/shared";
import { describe, expect, it } from "vitest";
import { decide, grantApplies, isApprovalPermission, scopeSets, type Grant, type ResolvedTarget } from "./rules.ts";

const ORG = "org-A";
const OTHER_ORG = "org-B";
// BU tree in ORG: root -> child -> grandchild; sibling is another root.
const root = "bu-root";
const child = "bu-child";
const grandchild = "bu-grandchild";
const sibling = "bu-sibling";

const g = (
  scopeType: ScopeType,
  scopeId: string,
  perms: Permission[],
  inheritsDownward = false,
  organizationId = ORG,
): Grant => ({
  assignmentId: `${scopeType}:${scopeId}:${inheritsDownward}`,
  roleCode: inheritsDownward ? "TO" : "TL",
  inheritsDownward,
  scopeType,
  scopeId,
  organizationId,
  permissions: new Set(perms),
});

const orgT = (org = ORG): ResolvedTarget => ({
  level: "organization",
  organizationId: org,
  businessUnitId: null,
  transformationId: null,
  businessUnitAncestry: [],
});
const buT = (bu: string, ancestry: string[]): ResolvedTarget => ({
  level: "business_unit",
  organizationId: ORG,
  businessUnitId: bu,
  transformationId: null,
  businessUnitAncestry: ancestry,
});
const trT = (id: string, bu: string, ancestry: string[]): ResolvedTarget => ({
  level: "transformation",
  organizationId: ORG,
  businessUnitId: bu,
  transformationId: id,
  businessUnitAncestry: ancestry,
});

const T_IN_GRANDCHILD = trT("tr-1", grandchild, [grandchild, child, root]);
const T_IN_SIBLING = trT("tr-2", sibling, [sibling]);

describe("grantApplies", () => {
  it("requires the permission to be held", () => {
    expect(
      grantApplies(g("organization", ORG, ["transformation.read"], true), "transformation.update", T_IN_GRANDCHILD),
    ).toBe(false);
  });

  it("organization grant: inheriting role reaches every record in the organization, never another organization", () => {
    const grant = g("organization", ORG, ["transformation.read"], true);
    expect(grantApplies(grant, "transformation.read", T_IN_GRANDCHILD)).toBe(true);
    expect(grantApplies(grant, "transformation.read", T_IN_SIBLING)).toBe(true);
    expect(grantApplies(grant, "transformation.read", { ...T_IN_SIBLING, organizationId: OTHER_ORG })).toBe(false);
  });

  it("organization grant of a NON-inheriting role applies to organization-level targets only (job title != global access)", () => {
    const grant = g("organization", ORG, ["transformation.read", "organization.read"]);
    expect(grantApplies(grant, "transformation.read", T_IN_GRANDCHILD)).toBe(false);
    expect(grantApplies(grant, "organization.read", orgT())).toBe(true);
  });

  it("business-unit grant: the unit itself (S = T), its subtree only when inheriting, never a sibling", () => {
    const flat = g("business_unit", child, ["transformation.read", "transformation.create"]);
    expect(grantApplies(flat, "transformation.create", buT(child, [child, root]))).toBe(true);
    expect(grantApplies(flat, "transformation.read", T_IN_GRANDCHILD)).toBe(false);
    const inheriting = g("business_unit", child, ["transformation.read"], true);
    expect(grantApplies(inheriting, "transformation.read", T_IN_GRANDCHILD)).toBe(true);
    expect(grantApplies(inheriting, "transformation.read", trT("tr-3", child, [child, root]))).toBe(true);
    expect(grantApplies(inheriting, "transformation.read", T_IN_SIBLING)).toBe(false);
    expect(grantApplies(inheriting, "transformation.read", buT(root, [root]))).toBe(false); // never upwards
    expect(grantApplies(inheriting, "transformation.read", orgT())).toBe(false);
  });

  it("transformation grant covers exactly that transformation", () => {
    const grant = g("transformation", "tr-1", ["transformation.read"], true);
    expect(grantApplies(grant, "transformation.read", T_IN_GRANDCHILD)).toBe(true);
    expect(grantApplies(grant, "transformation.read", trT("tr-9", grandchild, [grandchild, child, root]))).toBe(false);
    expect(grantApplies(grant, "transformation.read", buT(grandchild, [grandchild, child, root]))).toBe(false);
  });

  it("structural (organization administration) permissions cover the organization's structure without inheritance", () => {
    const adm = g("organization", ORG, ["business_unit.read", "business_unit.manage", "access.assign"]);
    expect(grantApplies(adm, "business_unit.manage", buT(grandchild, [grandchild, child, root]))).toBe(true);
    expect(grantApplies(adm, "access.assign", T_IN_SIBLING)).toBe(true);
    expect(grantApplies(adm, "business_unit.read", { ...buT(sibling, [sibling]), organizationId: OTHER_ORG })).toBe(
      false,
    );
  });

  it("reserved scope types grant nothing until their stage", () => {
    for (const t of ["portfolio", "workstream", "initiative", "performance_area", "forum", "record"] as const) {
      expect(grantApplies(g(t, "tr-1", ["transformation.read"], true), "transformation.read", T_IN_GRANDCHILD)).toBe(
        false,
      );
    }
  });
});

describe("decide (with separation-of-duties hooks)", () => {
  const user = {
    kind: "user" as const,
    userId: "u-1",
    grants: [g("organization", ORG, ["transformation.read", "gate.decide"], true)],
  };

  it("allows with the applying assignment ids, denies without", () => {
    const yes = decide(user, "transformation.read", T_IN_GRANDCHILD);
    expect(yes).toEqual({ allowed: true, reason: "granted", viaAssignmentIds: ["organization:org-A:true"] });
    expect(decide(user, "transformation.update", T_IN_GRANDCHILD).allowed).toBe(false);
    expect(decide({ ...user, grants: [] }, "transformation.read", T_IN_GRANDCHILD).reason).toBe("no_applicable_grant");
  });

  it("never lets a service principal approve (automation never approves)", () => {
    const d = decide({ ...user, kind: "service" }, "gate.decide", T_IN_GRANDCHILD);
    expect(d).toMatchObject({ allowed: false, reason: "sod.service_cannot_approve" });
  });

  it("rejects the requester as approver", () => {
    expect(decide(user, "gate.decide", T_IN_GRANDCHILD, { requesterId: "u-1" }).reason).toBe(
      "sod.requester_is_approver",
    );
    expect(decide(user, "gate.decide", T_IN_GRANDCHILD, { requesterId: "u-2" }).allowed).toBe(true);
  });

  it("classifies approval permissions by category", () => {
    expect(isApprovalPermission("gate.decide")).toBe(true);
    expect(isApprovalPermission("finance.validate")).toBe(true);
    expect(isApprovalPermission("transformation.update")).toBe(false);
  });
});

describe("scopeSets (inputs of the SQL scope filter)", () => {
  it("splits grants by level and by whether they apply downward for this permission", () => {
    const sets = scopeSets(
      [
        g("organization", ORG, ["transformation.read"], true),
        g("organization", OTHER_ORG, ["transformation.read"]),
        g("business_unit", child, ["transformation.read"]),
        g("business_unit", sibling, ["transformation.read"], true),
        g("transformation", "tr-1", ["transformation.read"]),
        g("organization", "org-C", ["audit.read"], true),
      ],
      "transformation.read",
    );
    expect(sets).toEqual({
      orgExact: [OTHER_ORG],
      orgDown: [ORG],
      buExact: [child],
      buDown: [sibling],
      trExact: ["tr-1"],
    });
  });
});
