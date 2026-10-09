// Unit test (no database): the role/permission seed migrations equal packages/shared/src/permissions.ts
// (data dictionary "role" seed rule, ADR-0006, ADR-0020): 0005 seeds the P1 part, 0018 the P2 part, 0024 the P3 part,
// 0031 the P4 part of slices I and C (ADR-0026 §8), 0036 the P4 part of slice A (ADR-0027 §11), 0040 the P4 part of slice B (ADR-0029 §9), 0043 the P4 part of slice E (ADR-0031 §9), 0046 the P4 part of slice D (ADR-0032 §9), 0049 the P4 part of slices F and G (ADR-0033 §9, ADR-0034 §10). The integration
// tests check the seeded ROWS too.
import { readFileSync } from "node:fs";
import {
  P1_PERMISSIONS,
  P2_PERMISSIONS,
  P2_ROLE_PERMISSIONS,
  P3_PERMISSIONS,
  P3_ROLE_PERMISSIONS,
  P4_BENEFIT_PERMISSIONS,
  P4_BENEFIT_ROLE_PERMISSIONS,
  P4_GOVERNANCE_PERMISSIONS,
  P4_GOVERNANCE_ROLE_PERMISSIONS,
  P4_ADOPTION_SUSTAINMENT_PERMISSIONS,
  P4_ADOPTION_SUSTAINMENT_ROLE_PERMISSIONS,
  P4_KPI_PERMISSIONS,
  P4_KPI_ROLE_PERMISSIONS,
  P4_PERMISSIONS,
  P4_RAID_PERMISSIONS,
  P4_RAID_ROLE_PERMISSIONS,
  P4_ROLE_PERMISSIONS,
  PERMISSIONS,
  ROLES,
} from "@mth/shared";
import { describe, expect, it } from "vitest";
import { defaultMigrationsDir, listMigrationFiles } from "./migrate.ts";

const sql = readFileSync(`${defaultMigrationsDir()}/0005_seed_roles_permissions.sql`, "utf8");
const sqlP2 = readFileSync(`${defaultMigrationsDir()}/0018_p2_access_instantiation.sql`, "utf8");
const sqlP3 = readFileSync(`${defaultMigrationsDir()}/0024_p3_gates_access_instantiation.sql`, "utf8");
const sqlP4 = readFileSync(`${defaultMigrationsDir()}/0031_p4_approvals_permissions.sql`, "utf8");
const sqlP4Kpi = readFileSync(`${defaultMigrationsDir()}/0036_p4_kpi_permissions_backfill.sql`, "utf8");
const sqlP4Benefit = readFileSync(`${defaultMigrationsDir()}/0040_p4_benefit_permissions.sql`, "utf8");
const sqlP4Raid = readFileSync(`${defaultMigrationsDir()}/0043_p4_raid_permissions.sql`, "utf8");
const sqlP4Governance = readFileSync(`${defaultMigrationsDir()}/0046_p4_governance_permissions.sql`, "utf8");
const sqlP4AdoptionSustainment = readFileSync(
  `${defaultMigrationsDir()}/0049_p4_adoption_sustainment_permissions.sql`,
  "utf8",
);
const LATER_PERMISSION_SET: ReadonlySet<string> = new Set([
  ...Object.keys(P2_PERMISSIONS),
  ...Object.keys(P3_PERMISSIONS),
  ...Object.keys(P4_PERMISSIONS),
  ...Object.keys(P4_KPI_PERMISSIONS),
  ...Object.keys(P4_BENEFIT_PERMISSIONS),
  ...Object.keys(P4_RAID_PERMISSIONS),
  ...Object.keys(P4_GOVERNANCE_PERMISSIONS),
  ...Object.keys(P4_ADOPTION_SUSTAINMENT_PERMISSIONS),
]);

function section(header: string, text: string = sql): string {
  const start = text.indexOf(header);
  expect(start).toBeGreaterThanOrEqual(0);
  // A statement ends at ");" + an optional trailing comment + newline (seed descriptions may contain ";").
  const end = /\);( --[^\n]*)?\n/g;
  end.lastIndex = start;
  const m = end.exec(text);
  expect(m).not.toBeNull();
  return text.slice(start, m!.index + 1);
}

describe("0005 seed equals permissions.ts", () => {
  it("permission rows", () => {
    const rows = [...section("INSERT INTO permission").matchAll(/^\s*\('([a-z_.]+)', '([a-z_]+)'/gm)].map((m) => [
      m[1],
      m[2],
    ]);
    expect(Object.fromEntries(rows)).toEqual(P1_PERMISSIONS);
    expect(rows).toHaveLength(Object.keys(P1_PERMISSIONS).length);
  });

  it("role rows (kind, inheritance) and role_permission links", () => {
    const roles = [
      ...section("INSERT INTO role (").matchAll(
        /^\s*\('([0-9a-f-]{36})', '([A-Z_]+)', '[^']*', '[^']*', '([a-z_]+)', (true|false), true\)/gm,
      ),
    ];
    const idToCode = new Map(roles.map((m) => [m[1]!, m[2]!]));
    expect(roles.map((m) => m[2])).toEqual(Object.keys(ROLES));
    for (const m of roles) {
      const def = ROLES[m[2] as keyof typeof ROLES];
      expect({ code: m[2], kind: m[3], inherits: m[4] === "true" }).toEqual({
        code: m[2],
        kind: def.kind,
        inherits: def.inheritsDownward,
      });
    }
    const links = [...section("INSERT INTO role_permission").matchAll(/^\s*\('([0-9a-f-]{36})', '([a-z_.]+)'\)/gm)];
    const byRole: Record<string, string[]> = {};
    for (const l of links) (byRole[idToCode.get(l[1]!)!] ??= []).push(l[2]!);
    const expected = Object.fromEntries(
      Object.entries(ROLES).map(([c, d]) => [c, d.permissions.filter((p) => !LATER_PERMISSION_SET.has(p)).sort()]),
    );
    expect(Object.fromEntries(Object.entries(byRole).map(([c, p]) => [c, p.sort()]))).toEqual(
      Object.fromEntries(Object.entries(expected).filter(([, p]) => p.length > 0)),
    );
  });

  it("no technical_admin role holds an approval permission in the seed", () => {
    for (const [code, def] of Object.entries(ROLES)) {
      if (def.kind !== "technical_admin") continue;
      for (const p of def.permissions)
        expect([code, PERMISSIONS[p]]).not.toEqual([
          code,
          expect.stringMatching(/business_approval|finance_validation/),
        ]);
    }
  });
});

describe("0018 seed equals the P2 part of permissions.ts", () => {
  it("permission rows", () => {
    const rows = [...section("INSERT INTO permission", sqlP2).matchAll(/^\s*\('([a-z_.]+)', '([a-z_]+)'/gm)].map(
      (m) => [m[1], m[2]],
    );
    expect(Object.fromEntries(rows)).toEqual(P2_PERMISSIONS);
    expect(rows).toHaveLength(Object.keys(P2_PERMISSIONS).length);
    expect({
      ...P1_PERMISSIONS,
      ...P2_PERMISSIONS,
      ...P3_PERMISSIONS,
      ...P4_PERMISSIONS,
      ...P4_KPI_PERMISSIONS,
      ...P4_BENEFIT_PERMISSIONS,
      ...P4_RAID_PERMISSIONS,
      ...P4_GOVERNANCE_PERMISSIONS,
      ...P4_ADOPTION_SUSTAINMENT_PERMISSIONS,
    }).toEqual(PERMISSIONS);
  });

  it("role_permission links", () => {
    const idToCode = new Map(
      [...section("INSERT INTO role (").matchAll(/^\s*\('([0-9a-f-]{36})', '([A-Z_]+)'/gm)].map((m) => [m[1]!, m[2]!]),
    );
    const byRole: Record<string, string[]> = {};
    for (const l of section("INSERT INTO role_permission", sqlP2).matchAll(/\('([0-9a-f-]{36})', '([a-z_.]+)'\)/g))
      (byRole[idToCode.get(l[1]!)!] ??= []).push(l[2]!);
    const sorted = (o: Record<string, readonly string[]>) =>
      Object.fromEntries(Object.entries(o).map(([c, p]) => [c, [...p].sort()]));
    expect(sorted(byRole)).toEqual(sorted(P2_ROLE_PERMISSIONS));
    for (const [code, perms] of Object.entries(P2_ROLE_PERMISSIONS))
      for (const p of perms) expect(ROLES[code as keyof typeof ROLES].permissions).toContain(p);
  });

  it("gives the read-only auditor no write, configure or approval permission (ADR-0020)", () => {
    for (const p of ROLES.AUD.permissions) expect([p, PERMISSIONS[p]]).toEqual([p, "read"]);
  });
});

describe("0024 seed equals the P3 part of permissions.ts", () => {
  it("permission rows", () => {
    const rows = [...section("INSERT INTO permission", sqlP3).matchAll(/^\s*\('([a-z_.]+)', '([a-z_]+)'/gm)].map(
      (m) => [m[1], m[2]],
    );
    expect(Object.fromEntries(rows)).toEqual(P3_PERMISSIONS);
    expect(rows).toHaveLength(Object.keys(P3_PERMISSIONS).length);
  });

  it("role_permission links", () => {
    const idToCode = new Map(
      [...section("INSERT INTO role (").matchAll(/^\s*\('([0-9a-f-]{36})', '([A-Z_]+)'/gm)].map((m) => [m[1]!, m[2]!]),
    );
    const byRole: Record<string, string[]> = {};
    for (const l of section("INSERT INTO role_permission", sqlP3).matchAll(/\('([0-9a-f-]{36})', '([a-z_.]+)'\)/g))
      (byRole[idToCode.get(l[1]!)!] ??= []).push(l[2]!);
    const sorted = (o: Record<string, readonly string[]>) =>
      Object.fromEntries(Object.entries(o).map(([c, p]) => [c, [...p].sort()]));
    expect(sorted(byRole)).toEqual(sorted(P3_ROLE_PERMISSIONS));
    for (const [code, perms] of Object.entries(P3_ROLE_PERMISSIONS))
      for (const p of perms) expect(ROLES[code as keyof typeof ROLES].permissions).toContain(p);
  });

  it("gives no business_approval or finance_validation permission to a technical admin, and none to AUD", () => {
    for (const [code, perms] of Object.entries(P3_ROLE_PERMISSIONS)) {
      if (ROLES[code as keyof typeof ROLES].kind !== "technical_admin") continue;
      for (const p of perms)
        expect([p, P3_PERMISSIONS[p]]).not.toEqual([p, expect.stringMatching(/business_approval|finance_validation/)]);
    }
    expect(Object.keys(P3_ROLE_PERMISSIONS)).not.toContain("AUD");
  });
});

describe("0031 seed equals the P4 part of permissions.ts (slices I and C)", () => {
  it("permission rows", () => {
    const rows = [...section("INSERT INTO permission", sqlP4).matchAll(/^\s*\('([a-z_.]+)', '([a-z_]+)'/gm)].map(
      (m) => [m[1], m[2]],
    );
    expect(Object.fromEntries(rows)).toEqual(P4_PERMISSIONS);
    expect(rows).toHaveLength(Object.keys(P4_PERMISSIONS).length);
  });

  it("role_permission links", () => {
    const idToCode = new Map(
      [...section("INSERT INTO role (").matchAll(/^\s*\('([0-9a-f-]{36})', '([A-Z_]+)'/gm)].map((m) => [m[1]!, m[2]!]),
    );
    const byRole: Record<string, string[]> = {};
    for (const l of section("INSERT INTO role_permission", sqlP4).matchAll(/\('([0-9a-f-]{36})', '([a-z_.]+)'\)/g))
      (byRole[idToCode.get(l[1]!)!] ??= []).push(l[2]!);
    const sorted = (o: Record<string, readonly string[]>) =>
      Object.fromEntries(Object.entries(o).map(([c, p]) => [c, [...p].sort()]));
    expect(sorted(byRole)).toEqual(sorted(P4_ROLE_PERMISSIONS));
    for (const [code, perms] of Object.entries(P4_ROLE_PERMISSIONS))
      for (const p of perms) expect(ROLES[code as keyof typeof ROLES].permissions).toContain(p);
  });

  it("gives no business_approval or finance_validation permission to a technical admin, and nothing to AUD (REQ-S10-003)", () => {
    for (const [code, perms] of Object.entries(P4_ROLE_PERMISSIONS)) {
      if (ROLES[code as keyof typeof ROLES].kind !== "technical_admin") continue;
      for (const p of perms)
        expect([p, P4_PERMISSIONS[p]]).not.toEqual([p, expect.stringMatching(/business_approval|finance_validation/)]);
    }
    expect(Object.keys(P4_ROLE_PERMISSIONS)).not.toContain("AUD");
    expect(P4_PERMISSIONS["approval.decide"]).toBe("business_approval");
  });
});

describe("0036 seed equals the P4 part of permissions.ts (slice A)", () => {
  it("permission rows", () => {
    const rows = [...section("INSERT INTO permission", sqlP4Kpi).matchAll(/^\s*\('([a-z_.]+)', '([a-z_]+)'/gm)].map(
      (m) => [m[1], m[2]],
    );
    expect(Object.fromEntries(rows)).toEqual(P4_KPI_PERMISSIONS);
    expect(rows).toHaveLength(Object.keys(P4_KPI_PERMISSIONS).length);
  });

  it("role_permission links", () => {
    const idToCode = new Map(
      [...section("INSERT INTO role (").matchAll(/^\s*\('([0-9a-f-]{36})', '([A-Z_]+)'/gm)].map((m) => [m[1]!, m[2]!]),
    );
    const byRole: Record<string, string[]> = {};
    for (const l of section("INSERT INTO role_permission", sqlP4Kpi).matchAll(/\('([0-9a-f-]{36})', '([a-z_.]+)'\)/g))
      (byRole[idToCode.get(l[1]!)!] ??= []).push(l[2]!);
    const sorted = (o: Record<string, readonly string[]>) =>
      Object.fromEntries(Object.entries(o).map(([c, p]) => [c, [...p].sort()]));
    expect(sorted(byRole)).toEqual(sorted(P4_KPI_ROLE_PERMISSIONS));
    for (const [code, perms] of Object.entries(P4_KPI_ROLE_PERMISSIONS))
      for (const p of perms) expect(ROLES[code as keyof typeof ROLES].permissions).toContain(p);
  });

  it("has no business_approval or finance_validation code, and nothing for AUD or a technical admin", () => {
    for (const [p, c] of Object.entries(P4_KPI_PERMISSIONS))
      expect([p, c]).toEqual([p, expect.stringMatching(/^(write|configure)$/)]);
    for (const code of Object.keys(P4_KPI_ROLE_PERMISSIONS)) {
      expect(code).not.toBe("AUD");
      expect(ROLES[code as keyof typeof ROLES].kind).not.toBe("technical_admin");
    }
  });
});

describe("0040 seed equals the P4 part of permissions.ts (slice B)", () => {
  it("permission rows", () => {
    const rows = [...section("INSERT INTO permission", sqlP4Benefit).matchAll(/^\s*\('([a-z_.]+)', '([a-z_]+)'/gm)].map(
      (m) => [m[1], m[2]],
    );
    expect(Object.fromEntries(rows)).toEqual(P4_BENEFIT_PERMISSIONS);
    expect(rows).toHaveLength(Object.keys(P4_BENEFIT_PERMISSIONS).length);
  });

  it("role_permission links", () => {
    const idToCode = new Map(
      [...section("INSERT INTO role (").matchAll(/^\s*\('([0-9a-f-]{36})', '([A-Z_]+)'/gm)].map((m) => [m[1]!, m[2]!]),
    );
    const byRole: Record<string, string[]> = {};
    for (const l of section("INSERT INTO role_permission", sqlP4Benefit).matchAll(
      /\('([0-9a-f-]{36})', '([a-z_.]+)'\)/g,
    ))
      (byRole[idToCode.get(l[1]!)!] ??= []).push(l[2]!);
    const sorted = (o: Record<string, readonly string[]>) =>
      Object.fromEntries(Object.entries(o).map(([c, p]) => [c, [...p].sort()]));
    expect(sorted(byRole)).toEqual(sorted(P4_BENEFIT_ROLE_PERMISSIONS));
    for (const [code, perms] of Object.entries(P4_BENEFIT_ROLE_PERMISSIONS))
      for (const p of perms) expect(ROLES[code as keyof typeof ROLES].permissions).toContain(p);
  });

  it("has no business_approval or finance_validation code, and nothing for AUD or a technical admin", () => {
    for (const [p, c] of Object.entries(P4_BENEFIT_PERMISSIONS)) expect([p, c]).toEqual([p, "write"]);
    for (const code of Object.keys(P4_BENEFIT_ROLE_PERMISSIONS)) {
      expect(code).not.toBe("AUD");
      expect(ROLES[code as keyof typeof ROLES].kind).not.toBe("technical_admin");
    }
  });
});

describe("0043 seed equals the P4 part of permissions.ts (slice E)", () => {
  it("permission rows", () => {
    const rows = [...section("INSERT INTO permission", sqlP4Raid).matchAll(/^\s*\('([a-z_.]+)', '([a-z_]+)'/gm)].map(
      (m) => [m[1], m[2]],
    );
    expect(Object.fromEntries(rows)).toEqual(P4_RAID_PERMISSIONS);
    expect(rows).toHaveLength(Object.keys(P4_RAID_PERMISSIONS).length);
  });

  it("role_permission links", () => {
    const idToCode = new Map(
      [...section("INSERT INTO role (").matchAll(/^\s*\('([0-9a-f-]{36})', '([A-Z_]+)'/gm)].map((m) => [m[1]!, m[2]!]),
    );
    const byRole: Record<string, string[]> = {};
    for (const l of section("INSERT INTO role_permission", sqlP4Raid).matchAll(/\('([0-9a-f-]{36})', '([a-z_.]+)'\)/g))
      (byRole[idToCode.get(l[1]!)!] ??= []).push(l[2]!);
    const sorted = (o: Record<string, readonly string[]>) =>
      Object.fromEntries(Object.entries(o).map(([c, p]) => [c, [...p].sort()]));
    expect(sorted(byRole)).toEqual(sorted(P4_RAID_ROLE_PERMISSIONS));
    for (const [code, perms] of Object.entries(P4_RAID_ROLE_PERMISSIONS))
      for (const p of perms) expect(ROLES[code as keyof typeof ROLES].permissions).toContain(p);
  });

  it("has no business_approval or finance_validation code, and nothing for AUD or a technical admin", () => {
    for (const [p, c] of Object.entries(P4_RAID_PERMISSIONS))
      expect([p, c]).toEqual([p, expect.stringMatching(/^(write|configure)$/)]);
    for (const code of Object.keys(P4_RAID_ROLE_PERMISSIONS)) {
      expect(code).not.toBe("AUD");
      expect(ROLES[code as keyof typeof ROLES].kind).not.toBe("technical_admin");
    }
  });
});

describe("0046 seed equals the P4 part of permissions.ts (slice D)", () => {
  it("permission rows", () => {
    const rows = [
      ...section("INSERT INTO permission", sqlP4Governance).matchAll(/^\s*\('([a-z_.]+)', '([a-z_]+)'/gm),
    ].map((m) => [m[1], m[2]]);
    expect(Object.fromEntries(rows)).toEqual(P4_GOVERNANCE_PERMISSIONS);
    expect(rows).toHaveLength(Object.keys(P4_GOVERNANCE_PERMISSIONS).length);
  });

  it("role_permission links", () => {
    const idToCode = new Map(
      [...section("INSERT INTO role (").matchAll(/^\s*\('([0-9a-f-]{36})', '([A-Z_]+)'/gm)].map((m) => [m[1]!, m[2]!]),
    );
    const byRole: Record<string, string[]> = {};
    for (const l of section("INSERT INTO role_permission", sqlP4Governance).matchAll(
      /\('([0-9a-f-]{36})', '([a-z_.]+)'\)/g,
    ))
      (byRole[idToCode.get(l[1]!)!] ??= []).push(l[2]!);
    const sorted = (o: Record<string, readonly string[]>) =>
      Object.fromEntries(Object.entries(o).map(([c, p]) => [c, [...p].sort()]));
    expect(sorted(byRole)).toEqual(sorted(P4_GOVERNANCE_ROLE_PERMISSIONS));
    for (const [code, perms] of Object.entries(P4_GOVERNANCE_ROLE_PERMISSIONS))
      for (const p of perms) expect(ROLES[code as keyof typeof ROLES].permissions).toContain(p);
  });

  it("the one business_approval code is held only by SP, BO and FIN; nothing for AUD or a technical admin", () => {
    const approval = Object.entries(P4_GOVERNANCE_PERMISSIONS).filter(([, c]) => c === "business_approval");
    expect(approval.map(([p]) => p)).toEqual(["executive_decision.decide"]);
    const holders = Object.entries(P4_GOVERNANCE_ROLE_PERMISSIONS)
      .filter(([, perms]) => (perms as readonly string[]).includes("executive_decision.decide"))
      .map(([r]) => r)
      .sort();
    expect(holders).toEqual(["BO", "FIN", "SP"]);
    for (const code of Object.keys(P4_GOVERNANCE_ROLE_PERMISSIONS)) {
      expect(code).not.toBe("AUD");
      expect(ROLES[code as keyof typeof ROLES].kind).not.toBe("technical_admin");
    }
  });
});

describe("0049 seed equals the P4 part of permissions.ts (slices F and G)", () => {
  it("permission rows", () => {
    const rows = [
      ...section("INSERT INTO permission", sqlP4AdoptionSustainment).matchAll(/^\s*\('([a-z_.]+)', '([a-z_]+)'/gm),
    ].map((m) => [m[1], m[2]]);
    expect(Object.fromEntries(rows)).toEqual(P4_ADOPTION_SUSTAINMENT_PERMISSIONS);
    expect(rows).toHaveLength(Object.keys(P4_ADOPTION_SUSTAINMENT_PERMISSIONS).length);
  });

  it("role_permission links", () => {
    const idToCode = new Map(
      [...section("INSERT INTO role (").matchAll(/^\s*\('([0-9a-f-]{36})', '([A-Z_]+)'/gm)].map((m) => [m[1]!, m[2]!]),
    );
    const byRole: Record<string, string[]> = {};
    for (const l of section("INSERT INTO role_permission", sqlP4AdoptionSustainment).matchAll(
      /\('([0-9a-f-]{36})', '([a-z_.]+)'\)/g,
    ))
      (byRole[idToCode.get(l[1]!)!] ??= []).push(l[2]!);
    const sorted = (o: Record<string, readonly string[]>) =>
      Object.fromEntries(Object.entries(o).map(([c, p]) => [c, [...p].sort()]));
    expect(sorted(byRole)).toEqual(sorted(P4_ADOPTION_SUSTAINMENT_ROLE_PERMISSIONS));
    for (const [code, perms] of Object.entries(P4_ADOPTION_SUSTAINMENT_ROLE_PERMISSIONS))
      for (const p of perms) expect(ROLES[code as keyof typeof ROLES].permissions).toContain(p);
  });

  it("bau_handover.accept is the one business_approval code, held only by BO; AUD holds only lesson.search; no technical admin", () => {
    const approval = Object.entries(P4_ADOPTION_SUSTAINMENT_PERMISSIONS).filter(
      ([, c]) => c !== "write" && c !== "read",
    );
    expect(approval).toEqual([["bau_handover.accept", "business_approval"]]);
    const holders = Object.entries(P4_ADOPTION_SUSTAINMENT_ROLE_PERMISSIONS)
      .filter(([, perms]) => (perms as readonly string[]).includes("bau_handover.accept"))
      .map(([r]) => r);
    expect(holders).toEqual(["BO"]);
    expect(P4_ADOPTION_SUSTAINMENT_ROLE_PERMISSIONS.AUD).toEqual(["lesson.search"]);
    expect(P4_ADOPTION_SUSTAINMENT_PERMISSIONS["lesson.search"]).toBe("read");
    for (const code of Object.keys(P4_ADOPTION_SUSTAINMENT_ROLE_PERMISSIONS))
      expect(ROLES[code as keyof typeof ROLES].kind).not.toBe("technical_admin");
  });
});

describe("migration files", () => {
  it("are named NNNN_snake_case.sql with strictly increasing ids, and never use plain timestamp in public", () => {
    const files = listMigrationFiles();
    // D-089: 0058-0069 are held for repairs and assigned one by one (0058: D-094, T-DG4-BE-B2), so a repair id may
    // land before the planned 0047-0057 do. Planned ids stay contiguous from 0001; repair ids stay inside their range;
    // all ids strictly increase (listMigrationFiles refuses anything else).
    const REPAIR_FIRST = 58;
    const REPAIR_LAST = 69;
    const planned = files.filter((f) => f.id < REPAIR_FIRST).map((f) => f.id);
    expect(planned).toEqual(planned.map((_, i) => i + 1));
    for (const f of files.filter((f) => f.id >= REPAIR_FIRST)) expect(f.id, f.name).toBeLessThanOrEqual(REPAIR_LAST);
    for (const f of files.filter((f) => !f.name.includes("pgboss"))) {
      const code = f.sql.replace(/--.*$/gm, "");
      expect(code, f.name).not.toMatch(/timestamp(?!tz)(?! with time zone)\b(?!\()/i);
      expect(code, f.name).not.toMatch(/\bfloat|double precision|\breal\b/i);
      expect(code, f.name).not.toMatch(/\buuidv7\(/i);
    }
  });
});
