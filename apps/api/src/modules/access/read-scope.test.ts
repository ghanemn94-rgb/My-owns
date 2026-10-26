// Unit tests of the ReadScope's pure parts (ADR-0051 §1, §2, §7; T-DG6-BE-B): the in-memory sensitivity clause, the
// two structural codes, and that the clause never widens the ADR-0006 read. The SQL form is proven equal to the
// in-memory form against a real PostgreSQL by test/integration/access/read-scope-parity.test.ts.
import type { Permission } from "@mth/shared";
import { describe, expect, it } from "vitest";
import type { Principal } from "./policy.ts";
import { recordKey, SENSITIVE_RECORD_TYPE_LIST, sensitivityClauseAdmits } from "./read-scope.ts";
import { decide, STRUCTURAL_PERMISSIONS, type Grant, type ResolvedTarget } from "./rules.ts";

const ORG = "org-A";
const BU = "bu-1";
const TR = "tr-1";
const target: ResolvedTarget = {
  level: "transformation",
  organizationId: ORG,
  businessUnitId: BU,
  transformationId: TR,
  businessUnitAncestry: [BU],
};

const grantOf = (role: string, scopeType: Grant["scopeType"], scopeId: string, perms: Permission[], down = false) => ({
  assignmentId: `${role}:${scopeType}:${scopeId}`,
  roleCode: role,
  inheritsDownward: down,
  scopeType,
  scopeId,
  organizationId: ORG,
  permissions: new Set(perms),
});

const principal = (userId: string | null, grants: readonly Grant[], kind: "user" | "service" = "user"): Principal => ({
  kind,
  userId,
  organizationId: ORG,
  grants,
  tracker: { decisions: 0 },
});

const row = (over: Partial<Parameters<typeof sensitivityClauseAdmits>[2]> = {}) => ({
  recordType: "benefit" as const,
  recordId: "rec-1",
  isSensitive: true,
  target,
  partyUserIds: ["owner-1", null, "creator-1"],
  ...over,
});

describe("the §2 sensitivity clause (in memory)", () => {
  const member = principal("member-1", [grantOf("WL", "transformation", TR, ["transformation.read"])]);

  it("admits everyone the read admits when the record is not sensitive", () => {
    expect(sensitivityClauseAdmits(member, { granted: new Set() }, row({ isSensitive: false }))).toBe(true);
  });

  it("refuses a workstream member without a grant, admits them with an active grant", () => {
    expect(sensitivityClauseAdmits(member, { granted: new Set() }, row())).toBe(false);
    expect(sensitivityClauseAdmits(member, { granted: new Set([recordKey("benefit", "rec-1")]) }, row())).toBe(true);
    // A grant for another record or another type admits nothing here.
    expect(sensitivityClauseAdmits(member, { granted: new Set([recordKey("evidence", "rec-1")]) }, row())).toBe(false);
  });

  it("admits a named party (owner, creator) and never matches a null party", () => {
    const owner = principal("owner-1", member.grants);
    const creator = principal("creator-1", member.grants);
    expect(sensitivityClauseAdmits(owner, { granted: new Set() }, row())).toBe(true);
    expect(sensitivityClauseAdmits(creator, { granted: new Set() }, row())).toBe(true);
    expect(sensitivityClauseAdmits(principal(null, member.grants), { granted: new Set() }, row())).toBe(false);
  });

  it("admits a holder of sensitive_record.grant at the record's scope (TO), not AUD by itself", () => {
    const to = principal("to-1", [
      grantOf(
        "TO",
        "organization",
        ORG,
        ["transformation.read", "sensitive_record.grant", "sensitive_record.read"],
        true,
      ),
    ]);
    const aud = principal("aud-1", [
      grantOf("AUD", "organization", ORG, ["transformation.read", "sensitive_record.read"], true),
    ]);
    expect(sensitivityClauseAdmits(to, { granted: new Set() }, row())).toBe(true);
    expect(sensitivityClauseAdmits(aud, { granted: new Set() }, row())).toBe(false);
  });

  it("a service principal is no named party even if its id matched", () => {
    const svc = principal("owner-1", member.grants, "service");
    expect(sensitivityClauseAdmits(svc, { granted: new Set() }, row())).toBe(false);
  });

  it("counts a policy decision when it consults the policy", () => {
    const p = principal("x", member.grants);
    sensitivityClauseAdmits(p, { granted: new Set() }, row());
    expect(p.tracker.decisions).toBe(1);
  });

  it("covers exactly the three D-195 Q3 types", () => {
    expect([...SENSITIVE_RECORD_TYPE_LIST]).toEqual(["benefit", "business_case", "evidence"]);
  });
});

describe("structural codes (ADR-0051 §7)", () => {
  it("sensitive_record.grant and .read are structural; transformation.read is not", () => {
    expect(STRUCTURAL_PERMISSIONS.has("sensitive_record.grant")).toBe(true);
    expect(STRUCTURAL_PERMISSIONS.has("sensitive_record.read")).toBe(true);
    expect(STRUCTURAL_PERMISSIONS.has("transformation.read")).toBe(false);
    expect(STRUCTURAL_PERMISSIONS.has("audit_event.read")).toBe(false);
  });

  it("an ADM_ACCESS organization assignment covers the organization's transformations for the two codes only", () => {
    const adm = principal("adm-1", [
      grantOf("ADM_ACCESS", "organization", ORG, ["access.assign", "sensitive_record.grant", "sensitive_record.read"]),
    ]);
    expect(decide(adm, "sensitive_record.grant", target).allowed).toBe(true);
    expect(decide(adm, "sensitive_record.read", target).allowed).toBe(true);
    expect(decide(adm, "transformation.read", target).allowed).toBe(false);
    // Another organization: never.
    expect(decide(adm, "sensitive_record.grant", { ...target, organizationId: "org-B" }).allowed).toBe(false);
  });
});
