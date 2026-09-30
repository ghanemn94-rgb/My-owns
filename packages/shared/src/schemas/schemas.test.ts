// Unit tests of zod mirror details that differ from a naive reading of the contract.
import { describe, expect, it } from "vitest";
import { me, role, roleAssignmentCreate } from "./index.ts";

const base = {
  userId: "01920000-0000-7000-8000-000000000001",
  roleCode: "TL",
  scope: { type: "organization", id: "01920000-0000-7000-8000-000000000002" },
  reason: "Synthetic reason",
};

describe("roleAssignmentCreate effective range", () => {
  it("compares instants, not strings, across offsets", () => {
    // 10:00+03:00 is 07:00Z, i.e. BEFORE 08:00Z, although the string "2026-01-01T10..." sorts after "2026-01-01T08...".
    expect(
      roleAssignmentCreate.safeParse({
        ...base,
        effectiveFrom: "2026-01-01T10:00:00+03:00",
        effectiveTo: "2026-01-01T08:00:00Z",
      }).success,
    ).toBe(true);
    expect(
      roleAssignmentCreate.safeParse({
        ...base,
        effectiveFrom: "2026-01-01T08:00:00Z",
        effectiveTo: "2026-01-01T10:00:00+03:00",
      }).success,
    ).toBe(false);
  });
});

describe("uniqueItems mirrors", () => {
  it("rejects duplicate permissions in Role and Me.effectivePermissions", () => {
    const r = {
      id: base.userId,
      code: "TL",
      nameEn: "x",
      nameAr: "x",
      kind: "source",
      inheritsDownward: false,
      permissions: ["role.read", "role.read"],
    };
    expect(role.safeParse(r).success).toBe(false);
    expect(role.safeParse({ ...r, permissions: ["role.read"] }).success).toBe(true);
    const shape = me.shape.effectivePermissions.element;
    expect(
      shape.safeParse({ scope: base.scope, inheritsDownward: true, permissions: ["audit.read", "audit.read"] }).success,
    ).toBe(false);
  });
});
