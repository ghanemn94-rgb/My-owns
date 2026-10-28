// Unit test (no database): the role/permission seed migrations equal packages/shared/src/permissions.ts
// (data dictionary "role" seed rule, ADR-0006, ADR-0020): 0005 seeds the P1 part, 0018 the P2 part, 0024 the P3 part,
// 0031 the P4 part of slices I and C (ADR-0026 §8), 0036 the P4 part of slice A (ADR-0027 §11), 0040 the P4 part of slice B (ADR-0029 §9), 0043 the P4 part of slice E (ADR-0031 §9), 0046 the P4 part of slice D (ADR-0032 §9), 0049 the P4 part of slices F and G (ADR-0033 §9, ADR-0034 §10), 0053 the P4 part of slice H (ADR-0035 §8, ADR-0036 §7), 0057 the P4 part of slices J and K (ADR-0037 §8, ADR-0038 §8), 0064 the P5 part of slice A (ADR-0039 §9, ADR-0040 §6), 0070 the P5 part of slices B and C (ADR-0041 §9, ADR-0042 §9), 0076 the P5 part of slices D and E (ADR-0043 §8, ADR-0044 §7), 0082 the P5 part of slice F (ADR-0045 §8, ADR-0046 §6), 0087 the P5 part of slices G and H (ADR-0047 §6, ADR-0048 §7), 0091 the P5 part of slices I and J (ADR-0049 §10, ADR-0050 §8). The integration
// tests check the seeded ROWS too.
import { readFileSync } from "node:fs";
import {
  P1_PERMISSIONS,
  P2_PERMISSIONS,
  P2_ROLE_PERMISSIONS,
  P3_PERMISSIONS,
  P3_ROLE_PERMISSIONS,
  P4_BENEFIT_PERMISSIONS,
  P4_DASHBOARD_TRACE_PERMISSIONS,
  P4_DASHBOARD_TRACE_ROLE_PERMISSIONS,
  P4_BENEFIT_ROLE_PERMISSIONS,
  P4_GOVERNANCE_PERMISSIONS,
  P4_GOVERNANCE_ROLE_PERMISSIONS,
  P4_ADOPTION_SUSTAINMENT_PERMISSIONS,
  P4_ADOPTION_SUSTAINMENT_ROLE_PERMISSIONS,
  P4_GATES_CHANGE_PERMISSIONS,
  P4_GATES_CHANGE_ROLE_PERMISSIONS,
  P4_KPI_PERMISSIONS,
  P4_KPI_ROLE_PERMISSIONS,
  P4_PERMISSIONS,
  P4_RAID_PERMISSIONS,
  P4_RAID_ROLE_PERMISSIONS,
  P4_ROLE_PERMISSIONS,
  P5_STUDIO_PERMISSIONS,
  P5_STUDIO_ROLE_PERMISSIONS,
  P5_FORMS_PROCEDURES_PERMISSIONS,
  P5_FORMS_PROCEDURES_ROLE_PERMISSIONS,
  P5_AUTOMATION_PERMISSIONS,
  P5_AUTOMATION_ROLE_PERMISSIONS,
  P5_REPORTING_PERMISSIONS,
  P5_REPORTING_ROLE_PERMISSIONS,
  P5_KPI_LAUNCH_HEALTH_PERMISSIONS,
  P5_KPI_LAUNCH_HEALTH_ROLE_PERMISSIONS,
  P5_READER_DEMO_PERMISSIONS,
  P5_READER_DEMO_ROLE_PERMISSIONS,
  P6_ACCESS_HARDENING_PERMISSIONS,
  P6_ACCESS_HARDENING_ROLE_PERMISSIONS,
  P6_OPERATIONS_CHANNELS_PERMISSIONS,
  P6_OPERATIONS_CHANNELS_ROLE_PERMISSIONS,
  P6_INTEGRATIONS_PERMISSIONS,
  P6_INTEGRATIONS_ROLE_PERMISSIONS,
  P6_SEARCH_PERMISSIONS,
  P6_SEARCH_ROLE_PERMISSIONS,
  P6_ASSISTANT_PERMISSIONS,
  P6_ASSISTANT_ROLE_PERMISSIONS,
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
const sqlP4GatesChange = readFileSync(`${defaultMigrationsDir()}/0053_p4_gates_change_permissions.sql`, "utf8");
const sqlP4DashboardTrace = readFileSync(
  `${defaultMigrationsDir()}/0057_p4_dashboards_traceability_permissions.sql`,
  "utf8",
);
const sqlP5Studio = readFileSync(`${defaultMigrationsDir()}/0064_p5_studio_permissions_source_inventory.sql`, "utf8");
const sqlP5FormsProcedures = readFileSync(
  `${defaultMigrationsDir()}/0070_p5_forms_procedures_permissions_coverage.sql`,
  "utf8",
);
const sqlP5Automation = readFileSync(`${defaultMigrationsDir()}/0076_p5_automation_permissions.sql`, "utf8");
const sqlP5Reporting = readFileSync(`${defaultMigrationsDir()}/0082_p5_reporting_permissions.sql`, "utf8");
const sqlP5KpiLaunchHealth = readFileSync(
  `${defaultMigrationsDir()}/0087_p5_kpi_launch_health_permissions.sql`,
  "utf8",
);
const sqlP5ReaderDemo = readFileSync(`${defaultMigrationsDir()}/0091_p5_reader_branding_demo_permissions.sql`, "utf8");
const sqlP6AccessHardening = readFileSync(`${defaultMigrationsDir()}/0100_p6_access_hardening_permissions.sql`, "utf8");
const sqlP6OperationsChannels = readFileSync(
  `${defaultMigrationsDir()}/0103_p6_operations_channels_permissions.sql`,
  "utf8",
);
const sqlP6Integrations = readFileSync(`${defaultMigrationsDir()}/0107_p6_integrations_permissions.sql`, "utf8");
const sqlP6Search = readFileSync(`${defaultMigrationsDir()}/0109_p6_search_productivity_permissions.sql`, "utf8");
const sqlP6Assistant = readFileSync(`${defaultMigrationsDir()}/0112_p6_assistant_permissions.sql`, "utf8");
const LATER_PERMISSION_SET: ReadonlySet<string> = new Set([
  ...Object.keys(P2_PERMISSIONS),
  ...Object.keys(P3_PERMISSIONS),
  ...Object.keys(P4_PERMISSIONS),
  ...Object.keys(P4_KPI_PERMISSIONS),
  ...Object.keys(P4_BENEFIT_PERMISSIONS),
  ...Object.keys(P4_RAID_PERMISSIONS),
  ...Object.keys(P4_GOVERNANCE_PERMISSIONS),
  ...Object.keys(P4_ADOPTION_SUSTAINMENT_PERMISSIONS),
  ...Object.keys(P4_GATES_CHANGE_PERMISSIONS),
  ...Object.keys(P4_DASHBOARD_TRACE_PERMISSIONS),
  ...Object.keys(P5_STUDIO_PERMISSIONS),
  ...Object.keys(P5_FORMS_PROCEDURES_PERMISSIONS),
  ...Object.keys(P5_AUTOMATION_PERMISSIONS),
  ...Object.keys(P5_REPORTING_PERMISSIONS),
  ...Object.keys(P5_KPI_LAUNCH_HEALTH_PERMISSIONS),
  ...Object.keys(P5_READER_DEMO_PERMISSIONS),
  ...Object.keys(P6_ACCESS_HARDENING_PERMISSIONS),
  ...Object.keys(P6_OPERATIONS_CHANNELS_PERMISSIONS),
  ...Object.keys(P6_INTEGRATIONS_PERMISSIONS),
  ...Object.keys(P6_SEARCH_PERMISSIONS),
  ...Object.keys(P6_ASSISTANT_PERMISSIONS),
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
      ...P4_GATES_CHANGE_PERMISSIONS,
      ...P4_DASHBOARD_TRACE_PERMISSIONS,
      ...P5_STUDIO_PERMISSIONS,
      ...P5_FORMS_PROCEDURES_PERMISSIONS,
      ...P5_AUTOMATION_PERMISSIONS,
      ...P5_REPORTING_PERMISSIONS,
      ...P5_KPI_LAUNCH_HEALTH_PERMISSIONS,
      ...P5_READER_DEMO_PERMISSIONS,
      ...P6_ACCESS_HARDENING_PERMISSIONS,
      ...P6_OPERATIONS_CHANNELS_PERMISSIONS,
      ...P6_INTEGRATIONS_PERMISSIONS,
      ...P6_SEARCH_PERMISSIONS,
      ...P6_ASSISTANT_PERMISSIONS,
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

describe("0053 seed equals the P4 part of permissions.ts (slice H)", () => {
  it("permission rows", () => {
    const rows = [
      ...section("INSERT INTO permission", sqlP4GatesChange).matchAll(/^\s*\('([a-z_.]+)', '([a-z_]+)'/gm),
    ].map((m) => [m[1], m[2]]);
    expect(Object.fromEntries(rows)).toEqual(P4_GATES_CHANGE_PERMISSIONS);
    expect(rows).toHaveLength(Object.keys(P4_GATES_CHANGE_PERMISSIONS).length);
  });

  it("role_permission links", () => {
    const idToCode = new Map(
      [...section("INSERT INTO role (").matchAll(/^\s*\('([0-9a-f-]{36})', '([A-Z_]+)'/gm)].map((m) => [m[1]!, m[2]!]),
    );
    const byRole: Record<string, string[]> = {};
    for (const l of section("INSERT INTO role_permission", sqlP4GatesChange).matchAll(
      /\('([0-9a-f-]{36})', '([a-z_.]+)'\)/g,
    ))
      (byRole[idToCode.get(l[1]!)!] ??= []).push(l[2]!);
    const sorted = (o: Record<string, readonly string[]>) =>
      Object.fromEntries(Object.entries(o).map(([c, p]) => [c, [...p].sort()]));
    expect(sorted(byRole)).toEqual(sorted(P4_GATES_CHANGE_ROLE_PERMISSIONS));
    for (const [code, perms] of Object.entries(P4_GATES_CHANGE_ROLE_PERMISSIONS))
      for (const p of perms) expect(ROLES[code as keyof typeof ROLES].permissions).toContain(p);
  });

  it("gate_exception.decide is the one business_approval code, held only by SP and BO (gate.decide holders); nothing for AUD or a technical admin", () => {
    const approval = Object.entries(P4_GATES_CHANGE_PERMISSIONS).filter(([, c]) => c === "business_approval");
    expect(approval).toEqual([["gate_exception.decide", "business_approval"]]);
    const holders = Object.entries(P4_GATES_CHANGE_ROLE_PERMISSIONS)
      .filter(([, perms]) => (perms as readonly string[]).includes("gate_exception.decide"))
      .map(([r]) => r);
    expect(holders).toEqual(["SP", "BO"]);
    for (const r of holders) expect(ROLES[r as keyof typeof ROLES].permissions).toContain("gate.decide");
    expect(Object.keys(P4_GATES_CHANGE_ROLE_PERMISSIONS)).not.toContain("AUD");
    for (const code of Object.keys(P4_GATES_CHANGE_ROLE_PERMISSIONS))
      expect(ROLES[code as keyof typeof ROLES].kind).not.toBe("technical_admin");
  });
});

describe("0057 seed equals the P4 part of permissions.ts (slices J and K)", () => {
  it("permission rows", () => {
    const rows = [
      ...section("INSERT INTO permission", sqlP4DashboardTrace).matchAll(/^\s*\('([a-z_.]+)', '([a-z_]+)'/gm),
    ].map((m) => [m[1], m[2]]);
    expect(Object.fromEntries(rows)).toEqual(P4_DASHBOARD_TRACE_PERMISSIONS);
    expect(rows).toHaveLength(Object.keys(P4_DASHBOARD_TRACE_PERMISSIONS).length);
  });

  it("role_permission links", () => {
    const idToCode = new Map(
      [...section("INSERT INTO role (").matchAll(/^\s*\('([0-9a-f-]{36})', '([A-Z_]+)'/gm)].map((m) => [m[1]!, m[2]!]),
    );
    const byRole: Record<string, string[]> = {};
    for (const l of section("INSERT INTO role_permission", sqlP4DashboardTrace).matchAll(
      /\('([0-9a-f-]{36})', '([a-z_.]+)'\)/g,
    ))
      (byRole[idToCode.get(l[1]!)!] ??= []).push(l[2]!);
    const sorted = (o: Record<string, readonly string[]>) =>
      Object.fromEntries(Object.entries(o).map(([c, p]) => [c, [...p].sort()]));
    expect(sorted(byRole)).toEqual(sorted(P4_DASHBOARD_TRACE_ROLE_PERMISSIONS));
    for (const [code, perms] of Object.entries(P4_DASHBOARD_TRACE_ROLE_PERMISSIONS))
      for (const p of perms) expect(ROLES[code as keyof typeof ROLES].permissions).toContain(p);
  });

  it("has no business_approval or finance_validation code, and nothing for AUD or a technical admin", () => {
    const categories: readonly string[] = Object.values(P4_DASHBOARD_TRACE_PERMISSIONS);
    expect(categories.filter((c) => c === "business_approval" || c === "finance_validation")).toEqual([]);
    expect(Object.keys(P4_DASHBOARD_TRACE_ROLE_PERMISSIONS)).not.toContain("AUD");
    for (const code of Object.keys(P4_DASHBOARD_TRACE_ROLE_PERMISSIONS))
      expect(ROLES[code as keyof typeof ROLES].kind).not.toBe("technical_admin");
  });
});

describe("0064 seed equals the P5 part of permissions.ts (slice A)", () => {
  it("permission rows", () => {
    const rows = [...section("INSERT INTO permission", sqlP5Studio).matchAll(/^\s*\('([a-z_.]+)', '([a-z_]+)'/gm)].map(
      (m) => [m[1], m[2]],
    );
    expect(Object.fromEntries(rows)).toEqual(P5_STUDIO_PERMISSIONS);
    expect(rows).toHaveLength(Object.keys(P5_STUDIO_PERMISSIONS).length);
  });

  it("role_permission links", () => {
    const idToCode = new Map(
      [...section("INSERT INTO role (").matchAll(/^\s*\('([0-9a-f-]{36})', '([A-Z_]+)'/gm)].map((m) => [m[1]!, m[2]!]),
    );
    const byRole: Record<string, string[]> = {};
    for (const l of section("INSERT INTO role_permission", sqlP5Studio).matchAll(
      /\('([0-9a-f-]{36})', '([a-z_.]+)'\)/g,
    ))
      (byRole[idToCode.get(l[1]!)!] ??= []).push(l[2]!);
    const sorted = (o: Record<string, readonly string[]>) =>
      Object.fromEntries(Object.entries(o).map(([c, p]) => [c, [...p].sort()]));
    expect(sorted(byRole)).toEqual(sorted(P5_STUDIO_ROLE_PERMISSIONS));
    for (const [code, perms] of Object.entries(P5_STUDIO_ROLE_PERMISSIONS))
      for (const p of perms) expect(ROLES[code as keyof typeof ROLES].permissions).toContain(p);
  });

  it("has one business_approval code held by SP only (TL stays approval-free, 0008); AUD reads only; no technical admin approves", () => {
    const approval = Object.entries(P5_STUDIO_PERMISSIONS).filter(([, c]) => c === "business_approval");
    expect(approval).toEqual([["methodology_migration.approve", "business_approval"]]);
    const holders = Object.entries(P5_STUDIO_ROLE_PERMISSIONS)
      .filter(([, perms]) => (perms as readonly string[]).includes("methodology_migration.approve"))
      .map(([r]) => r);
    expect(holders.sort()).toEqual(["SP"]);
    for (const r of holders) expect(ROLES[r as keyof typeof ROLES].kind).not.toBe("technical_admin");
    expect(P5_STUDIO_ROLE_PERMISSIONS.AUD).toEqual(["methodology.read"]);
    const adm = P5_STUDIO_ROLE_PERMISSIONS.ADM_METHOD as readonly string[];
    for (const p of adm)
      expect(["business_approval", "finance_validation"]).not.toContain(
        P5_STUDIO_PERMISSIONS[p as keyof typeof P5_STUDIO_PERMISSIONS],
      );
    expect(adm).not.toContain("methodology.review");
  });
});

describe("0070 seed equals the P5 part of permissions.ts (slices B and C)", () => {
  it("permission rows", () => {
    const rows = [
      ...section("INSERT INTO permission", sqlP5FormsProcedures).matchAll(/^\s*\('([a-z_.]+)', '([a-z_]+)'/gm),
    ].map((m) => [m[1], m[2]]);
    expect(Object.fromEntries(rows)).toEqual(P5_FORMS_PROCEDURES_PERMISSIONS);
    expect(rows).toHaveLength(Object.keys(P5_FORMS_PROCEDURES_PERMISSIONS).length);
  });

  it("role_permission links", () => {
    const idToCode = new Map(
      [...section("INSERT INTO role (").matchAll(/^\s*\('([0-9a-f-]{36})', '([A-Z_]+)'/gm)].map((m) => [m[1]!, m[2]!]),
    );
    const byRole: Record<string, string[]> = {};
    for (const l of section("INSERT INTO role_permission", sqlP5FormsProcedures).matchAll(
      /\('([0-9a-f-]{36})', '([a-z_.]+)'\)/g,
    ))
      (byRole[idToCode.get(l[1]!)!] ??= []).push(l[2]!);
    const sorted = (o: Record<string, readonly string[]>) =>
      Object.fromEntries(Object.entries(o).map(([c, p]) => [c, [...p].sort()]));
    expect(sorted(byRole)).toEqual(sorted(P5_FORMS_PROCEDURES_ROLE_PERMISSIONS));
    for (const [code, perms] of Object.entries(P5_FORMS_PROCEDURES_ROLE_PERMISSIONS))
      for (const p of perms) expect(ROLES[code as keyof typeof ROLES].permissions).toContain(p);
  });

  it("has no approval code; AUD and the technical admins hold procedure.read only", () => {
    for (const c of Object.values(P5_FORMS_PROCEDURES_PERMISSIONS))
      expect(["business_approval", "finance_validation"]).not.toContain(c);
    for (const r of ["AUD", "ADM_TECH", "ADM_ACCESS", "ADM_METHOD"] as const)
      expect(P5_FORMS_PROCEDURES_ROLE_PERMISSIONS[r]).toEqual(["procedure.read"]);
  });
});

describe("0076 seed equals the P5 part of permissions.ts (slices D and E)", () => {
  it("permission rows", () => {
    const rows = [
      ...section("INSERT INTO permission", sqlP5Automation).matchAll(/^\s*\('([a-z_.]+)', '([a-z_]+)'/gm),
    ].map((m) => [m[1], m[2]]);
    expect(Object.fromEntries(rows)).toEqual(P5_AUTOMATION_PERMISSIONS);
    expect(rows).toHaveLength(Object.keys(P5_AUTOMATION_PERMISSIONS).length);
  });

  it("role_permission links", () => {
    const idToCode = new Map(
      [...section("INSERT INTO role (").matchAll(/^\s*\('([0-9a-f-]{36})', '([A-Z_]+)'/gm)].map((m) => [m[1]!, m[2]!]),
    );
    const byRole: Record<string, string[]> = {};
    for (const l of section("INSERT INTO role_permission", sqlP5Automation).matchAll(
      /\('([0-9a-f-]{36})', '([a-z_.]+)'\)/g,
    ))
      (byRole[idToCode.get(l[1]!)!] ??= []).push(l[2]!);
    const sorted = (o: Record<string, readonly string[]>) =>
      Object.fromEntries(Object.entries(o).map(([c, p]) => [c, [...p].sort()]));
    expect(sorted(byRole)).toEqual(sorted(P5_AUTOMATION_ROLE_PERMISSIONS));
    for (const [code, perms] of Object.entries(P5_AUTOMATION_ROLE_PERMISSIONS))
      for (const p of perms) expect(ROLES[code as keyof typeof ROLES].permissions).toContain(p);
  });

  it("has no approval code; AUD reads automation only; the jobs view stays with ADM_TECH", () => {
    for (const c of Object.values(P5_AUTOMATION_PERMISSIONS))
      expect(["business_approval", "finance_validation"]).not.toContain(c);
    expect(P5_AUTOMATION_ROLE_PERMISSIONS.AUD).toEqual(["automation.read"]);
    const repairers = Object.entries(P5_AUTOMATION_ROLE_PERMISSIONS)
      .filter(([, p]) => (p as readonly string[]).includes("job.repair"))
      .map(([r]) => r);
    expect(repairers).toEqual(["ADM_TECH"]);
  });
});

describe("0082 seed equals the P5 part of permissions.ts (slice F)", () => {
  it("permission rows", () => {
    const rows = [
      ...section("INSERT INTO permission", sqlP5Reporting).matchAll(/^\s*\('([a-z_.]+)', '([a-z_]+)'/gm),
    ].map((m) => [m[1], m[2]]);
    expect(Object.fromEntries(rows)).toEqual(P5_REPORTING_PERMISSIONS);
    expect(rows).toHaveLength(Object.keys(P5_REPORTING_PERMISSIONS).length);
  });

  it("role_permission links", () => {
    const idToCode = new Map(
      [...section("INSERT INTO role (").matchAll(/^\s*\('([0-9a-f-]{36})', '([A-Z_]+)'/gm)].map((m) => [m[1]!, m[2]!]),
    );
    const byRole: Record<string, string[]> = {};
    for (const l of section("INSERT INTO role_permission", sqlP5Reporting).matchAll(
      /\('([0-9a-f-]{36})', '([a-z_.]+)'\)/g,
    ))
      (byRole[idToCode.get(l[1]!)!] ??= []).push(l[2]!);
    const sorted = (o: Record<string, readonly string[]>) =>
      Object.fromEntries(
        Object.entries(o)
          .filter(([, p]) => p.length > 0)
          .map(([c, p]) => [c, [...p].sort()]),
      );
    expect(sorted(byRole)).toEqual(sorted(P5_REPORTING_ROLE_PERMISSIONS));
    for (const [code, perms] of Object.entries(P5_REPORTING_ROLE_PERMISSIONS))
      for (const p of perms) expect(ROLES[code as keyof typeof ROLES].permissions).toContain(p);
  });

  it("has no approval code; AUD and the technical admins get none; issue is TL, TO and SEC only", () => {
    for (const c of Object.values(P5_REPORTING_PERMISSIONS))
      expect(["business_approval", "finance_validation"]).not.toContain(c);
    for (const r of ["AUD", "ADM_TECH", "ADM_ACCESS", "ADM_METHOD"] as const)
      expect(P5_REPORTING_ROLE_PERMISSIONS[r]).toEqual([]);
    const issuers = Object.entries(P5_REPORTING_ROLE_PERMISSIONS)
      .filter(([, p]) => (p as readonly string[]).includes("report.issue"))
      .map(([r]) => r);
    expect(issuers).toEqual(["TL", "TO", "SEC"]);
  });
});

describe("0087 seed equals the P5 part of permissions.ts (slices G and H)", () => {
  it("permission rows", () => {
    const rows = [
      ...section("INSERT INTO permission", sqlP5KpiLaunchHealth).matchAll(/^\s*\('([a-z_.]+)', '([a-z_]+)'/gm),
    ].map((m) => [m[1], m[2]]);
    expect(Object.fromEntries(rows)).toEqual(P5_KPI_LAUNCH_HEALTH_PERMISSIONS);
    expect(rows).toHaveLength(Object.keys(P5_KPI_LAUNCH_HEALTH_PERMISSIONS).length);
  });

  it("role_permission links", () => {
    const idToCode = new Map(
      [...section("INSERT INTO role (").matchAll(/^\s*\('([0-9a-f-]{36})', '([A-Z_]+)'/gm)].map((m) => [m[1]!, m[2]!]),
    );
    const byRole: Record<string, string[]> = {};
    for (const l of section("INSERT INTO role_permission", sqlP5KpiLaunchHealth).matchAll(
      /\('([0-9a-f-]{36})', '([a-z_.]+)'\)/g,
    ))
      (byRole[idToCode.get(l[1]!)!] ??= []).push(l[2]!);
    const sorted = (o: Record<string, readonly string[]>) =>
      Object.fromEntries(
        Object.entries(o)
          .filter(([, p]) => p.length > 0)
          .map(([c, p]) => [c, [...p].sort()]),
      );
    expect(sorted(byRole)).toEqual(sorted(P5_KPI_LAUNCH_HEALTH_ROLE_PERMISSIONS));
    for (const [code, perms] of Object.entries(P5_KPI_LAUNCH_HEALTH_ROLE_PERMISSIONS))
      for (const p of perms) expect(ROLES[code as keyof typeof ROLES].permissions).toContain(p);
  });

  it("one business approval (kpi_restatement.approve: SP, BO, FIN); never TL, AUD or a technical admin", () => {
    const approvalCodes = Object.entries(P5_KPI_LAUNCH_HEALTH_PERMISSIONS as Record<string, string>)
      .filter(([, c]) => c === "business_approval" || c === "finance_validation")
      .map(([p]) => p);
    expect(approvalCodes).toEqual(["kpi_restatement.approve"]);
    const approvers = Object.entries(P5_KPI_LAUNCH_HEALTH_ROLE_PERMISSIONS)
      .filter(([, p]) => (p as readonly string[]).includes("kpi_restatement.approve"))
      .map(([r]) => r);
    expect(approvers).toEqual(["SP", "BO", "FIN"]);
    for (const r of ["AUD", "ADM_TECH", "ADM_ACCESS"] as const)
      expect(P5_KPI_LAUNCH_HEALTH_ROLE_PERMISSIONS[r]).toEqual([]);
    expect(P5_KPI_LAUNCH_HEALTH_ROLE_PERMISSIONS.ADM_METHOD).toEqual(["financial_metrics.enable"]);
  });
});

describe("0091 seed equals the P5 part of permissions.ts (slices I and J)", () => {
  it("permission rows", () => {
    const rows = [
      ...section("INSERT INTO permission", sqlP5ReaderDemo).matchAll(/^\s*\('([a-z_.]+)', '([a-z_]+)'/gm),
    ].map((m) => [m[1], m[2]]);
    expect(Object.fromEntries(rows)).toEqual(P5_READER_DEMO_PERMISSIONS);
    expect(rows).toHaveLength(Object.keys(P5_READER_DEMO_PERMISSIONS).length);
  });

  it("role_permission links", () => {
    const idToCode = new Map(
      [...section("INSERT INTO role (").matchAll(/^\s*\('([0-9a-f-]{36})', '([A-Z_]+)'/gm)].map((m) => [m[1]!, m[2]!]),
    );
    const byRole: Record<string, string[]> = {};
    for (const l of section("INSERT INTO role_permission", sqlP5ReaderDemo).matchAll(
      /\('([0-9a-f-]{36})', '([a-z_.]+)'\)/g,
    ))
      (byRole[idToCode.get(l[1]!)!] ??= []).push(l[2]!);
    const sorted = (o: Record<string, readonly string[]>) =>
      Object.fromEntries(
        Object.entries(o)
          .filter(([, p]) => p.length > 0)
          .map(([c, p]) => [c, [...p].sort()]),
      );
    expect(sorted(byRole)).toEqual(sorted(P5_READER_DEMO_ROLE_PERMISSIONS));
    for (const [code, perms] of Object.entries(P5_READER_DEMO_ROLE_PERMISSIONS))
      for (const p of perms) expect(ROLES[code as keyof typeof ROLES].permissions).toContain(p);
  });

  it("no business approval or Finance validation; ADM_TECH only; AUD gets nothing", () => {
    expect(Object.values(P5_READER_DEMO_PERMISSIONS as Record<string, string>)).toEqual(["configure", "configure"]);
    for (const [r, p] of Object.entries(P5_READER_DEMO_ROLE_PERMISSIONS))
      expect(p, r).toEqual(r === "ADM_TECH" ? ["branding.configure", "demo.reset"] : []);
  });
});

describe("0100 seed equals the P6 part of permissions.ts (slices E and F)", () => {
  it("permission rows", () => {
    const rows = [
      ...section("INSERT INTO permission", sqlP6AccessHardening).matchAll(/^\s*\('([a-z_.]+)', '([a-z_]+)'/gm),
    ].map((m) => [m[1], m[2]]);
    expect(Object.fromEntries(rows)).toEqual(P6_ACCESS_HARDENING_PERMISSIONS);
    expect(rows).toHaveLength(Object.keys(P6_ACCESS_HARDENING_PERMISSIONS).length);
  });

  it("role_permission links", () => {
    const idToCode = new Map(
      [...section("INSERT INTO role (").matchAll(/^\s*\('([0-9a-f-]{36})', '([A-Z_]+)'/gm)].map((m) => [m[1]!, m[2]!]),
    );
    const byRole: Record<string, string[]> = {};
    for (const l of section("INSERT INTO role_permission", sqlP6AccessHardening).matchAll(
      /\('([0-9a-f-]{36})', '([a-z_.]+)'\)/g,
    ))
      (byRole[idToCode.get(l[1]!)!] ??= []).push(l[2]!);
    const sorted = (o: Record<string, readonly string[]>) =>
      Object.fromEntries(
        Object.entries(o)
          .filter(([, p]) => p.length > 0)
          .map(([c, p]) => [c, [...p].sort()]),
      );
    expect(sorted(byRole)).toEqual(sorted(P6_ACCESS_HARDENING_ROLE_PERMISSIONS));
    for (const [code, perms] of Object.entries(P6_ACCESS_HARDENING_ROLE_PERMISSIONS))
      for (const p of perms) expect(ROLES[code as keyof typeof ROLES].permissions).toContain(p);
  });

  it("no business approval or Finance validation; the grant right is TO and ADM_ACCESS only; AUD gets read codes only", () => {
    for (const c of Object.values(P6_ACCESS_HARDENING_PERMISSIONS as Record<string, string>))
      expect(["read", "configure"]).toContain(c);
    const granters = Object.entries(P6_ACCESS_HARDENING_ROLE_PERMISSIONS)
      .filter(([, p]) => (p as readonly string[]).includes("sensitive_record.grant"))
      .map(([r]) => r);
    expect(granters).toEqual(["TO", "ADM_ACCESS"]);
    for (const p of P6_ACCESS_HARDENING_ROLE_PERMISSIONS.AUD) expect(P6_ACCESS_HARDENING_PERMISSIONS[p]).toBe("read");
  });
});

describe("0103 seed equals the P6 part of permissions.ts (slices J and C)", () => {
  it("permission rows", () => {
    const rows = [
      ...section("INSERT INTO permission", sqlP6OperationsChannels).matchAll(/^\s*\('([a-z_.]+)', '([a-z_]+)'/gm),
    ].map((m) => [m[1], m[2]]);
    expect(Object.fromEntries(rows)).toEqual(P6_OPERATIONS_CHANNELS_PERMISSIONS);
    expect(rows).toHaveLength(Object.keys(P6_OPERATIONS_CHANNELS_PERMISSIONS).length);
  });

  it("role_permission links", () => {
    const idToCode = new Map(
      [...section("INSERT INTO role (").matchAll(/^\s*\('([0-9a-f-]{36})', '([A-Z_]+)'/gm)].map((m) => [m[1]!, m[2]!]),
    );
    const byRole: Record<string, string[]> = {};
    for (const l of section("INSERT INTO role_permission", sqlP6OperationsChannels).matchAll(
      /\('([0-9a-f-]{36})', '([a-z_.]+)'\)/g,
    ))
      (byRole[idToCode.get(l[1]!)!] ??= []).push(l[2]!);
    const sorted = (o: Record<string, readonly string[]>) =>
      Object.fromEntries(
        Object.entries(o)
          .filter(([, p]) => p.length > 0)
          .map(([c, p]) => [c, [...p].sort()]),
      );
    expect(sorted(byRole)).toEqual(sorted(P6_OPERATIONS_CHANNELS_ROLE_PERMISSIONS));
    for (const [code, perms] of Object.entries(P6_OPERATIONS_CHANNELS_ROLE_PERMISSIONS))
      for (const p of perms) expect(ROLES[code as keyof typeof ROLES].permissions).toContain(p);
  });

  it("no business approval or Finance validation; configure codes are ADM_TECH only; AUD gets read codes only", () => {
    for (const c of Object.values(P6_OPERATIONS_CHANNELS_PERMISSIONS as Record<string, string>))
      expect(["read", "write", "configure"]).toContain(c);
    for (const [role, perms] of Object.entries(P6_OPERATIONS_CHANNELS_ROLE_PERMISSIONS))
      for (const p of perms as readonly (keyof typeof P6_OPERATIONS_CHANNELS_PERMISSIONS)[])
        if (P6_OPERATIONS_CHANNELS_PERMISSIONS[p] === "configure") expect(role).toBe("ADM_TECH");
    for (const p of P6_OPERATIONS_CHANNELS_ROLE_PERMISSIONS.AUD)
      expect(P6_OPERATIONS_CHANNELS_PERMISSIONS[p]).toBe("read");
  });
});

describe("0107 seed equals the P6 part of permissions.ts (slices B and A)", () => {
  it("permission rows", () => {
    const rows = [
      ...section("INSERT INTO permission", sqlP6Integrations).matchAll(/^\s*\('([a-z_.]+)', '([a-z_]+)'/gm),
    ].map((m) => [m[1], m[2]]);
    expect(Object.fromEntries(rows)).toEqual(P6_INTEGRATIONS_PERMISSIONS);
    expect(rows).toHaveLength(Object.keys(P6_INTEGRATIONS_PERMISSIONS).length);
  });

  it("role_permission links", () => {
    const idToCode = new Map(
      [...section("INSERT INTO role (").matchAll(/^\s*\('([0-9a-f-]{36})', '([A-Z_]+)'/gm)].map((m) => [m[1]!, m[2]!]),
    );
    const byRole: Record<string, string[]> = {};
    for (const l of section("INSERT INTO role_permission", sqlP6Integrations).matchAll(
      /\('([0-9a-f-]{36})', '([a-z_.]+)'\)/g,
    ))
      (byRole[idToCode.get(l[1]!)!] ??= []).push(l[2]!);
    const sorted = (o: Record<string, readonly string[]>) =>
      Object.fromEntries(
        Object.entries(o)
          .filter(([, p]) => p.length > 0)
          .map(([c, p]) => [c, [...p].sort()]),
      );
    expect(sorted(byRole)).toEqual(sorted(P6_INTEGRATIONS_ROLE_PERMISSIONS));
    for (const [code, perms] of Object.entries(P6_INTEGRATIONS_ROLE_PERMISSIONS))
      for (const p of perms) expect(ROLES[code as keyof typeof ROLES].permissions).toContain(p);
  });

  it("no business approval or Finance validation; configure codes are ADM_TECH only; AUD reads only; ADM_TECH holds no import, outbound-write or external-change right; outbound_write.execute is TD only", () => {
    for (const c of Object.values(P6_INTEGRATIONS_PERMISSIONS as Record<string, string>))
      expect(["read", "write", "configure"]).toContain(c);
    for (const [role, perms] of Object.entries(P6_INTEGRATIONS_ROLE_PERMISSIONS))
      for (const p of perms as readonly (keyof typeof P6_INTEGRATIONS_PERMISSIONS)[])
        if (P6_INTEGRATIONS_PERMISSIONS[p] === "configure") expect(role).toBe("ADM_TECH");
    for (const p of P6_INTEGRATIONS_ROLE_PERMISSIONS.AUD) expect(P6_INTEGRATIONS_PERMISSIONS[p]).toBe("read");
    expect(
      P6_INTEGRATIONS_ROLE_PERMISSIONS.ADM_TECH.filter((p) => /^(import|outbound_write|external_change)\./.test(p)),
    ).toEqual([]);
    const executors = Object.entries(P6_INTEGRATIONS_ROLE_PERMISSIONS)
      .filter(([, p]) => (p as readonly string[]).includes("outbound_write.execute"))
      .map(([r]) => r);
    expect(executors).toEqual(["TD"]);
  });
});

describe("0109 seed equals the P6 part of permissions.ts (slices H and G)", () => {
  it("permission rows", () => {
    const rows = [...section("INSERT INTO permission", sqlP6Search).matchAll(/^\s*\('([a-z_.]+)', '([a-z_]+)'/gm)].map(
      (m) => [m[1], m[2]],
    );
    expect(Object.fromEntries(rows)).toEqual(P6_SEARCH_PERMISSIONS);
    expect(rows).toHaveLength(Object.keys(P6_SEARCH_PERMISSIONS).length);
  });

  it("role_permission links", () => {
    const idToCode = new Map(
      [...section("INSERT INTO role (").matchAll(/^\s*\('([0-9a-f-]{36})', '([A-Z_]+)'/gm)].map((m) => [m[1]!, m[2]!]),
    );
    const byRole: Record<string, string[]> = {};
    for (const l of section("INSERT INTO role_permission", sqlP6Search).matchAll(
      /\('([0-9a-f-]{36})', '([a-z_.]+)'\)/g,
    ))
      (byRole[idToCode.get(l[1]!)!] ??= []).push(l[2]!);
    const sorted = (o: Record<string, readonly string[]>) =>
      Object.fromEntries(
        Object.entries(o)
          .filter(([, p]) => p.length > 0)
          .map(([c, p]) => [c, [...p].sort()]),
      );
    expect(sorted(byRole)).toEqual(sorted(P6_SEARCH_ROLE_PERMISSIONS));
    for (const [code, perms] of Object.entries(P6_SEARCH_ROLE_PERMISSIONS))
      for (const p of perms) expect(ROLES[code as keyof typeof ROLES].permissions).toContain(p);
  });

  it("write codes only, never business approval or Finance validation; AUD holds neither; every other role manages its own views; sharing is TL, BO, WL, TO, KDS, TD", () => {
    expect(Object.values(P6_SEARCH_PERMISSIONS as Record<string, string>)).toEqual(["write", "write"]);
    expect(P6_SEARCH_ROLE_PERMISSIONS.AUD).toEqual([]);
    const managers = Object.entries(P6_SEARCH_ROLE_PERMISSIONS)
      .filter(([, p]) => (p as readonly string[]).includes("saved_view.manage"))
      .map(([r]) => r);
    expect(managers).toHaveLength(13);
    const sharers = Object.entries(P6_SEARCH_ROLE_PERMISSIONS)
      .filter(([, p]) => (p as readonly string[]).includes("saved_view.share"))
      .map(([r]) => r)
      .sort();
    expect(sharers).toEqual(["BO", "KDS", "TD", "TL", "TO", "WL"]);
  });
});

describe("0112 seed equals the P6 part of permissions.ts (slice D, the assistant)", () => {
  it("permission rows", () => {
    const rows = [
      ...section("INSERT INTO permission", sqlP6Assistant).matchAll(/^\s*\('([a-z_.]+)', '([a-z_]+)'/gm),
    ].map((m) => [m[1], m[2]]);
    expect(Object.fromEntries(rows)).toEqual(P6_ASSISTANT_PERMISSIONS);
    expect(rows).toHaveLength(Object.keys(P6_ASSISTANT_PERMISSIONS).length);
  });

  it("role_permission links", () => {
    const idToCode = new Map(
      [...section("INSERT INTO role (").matchAll(/^\s*\('([0-9a-f-]{36})', '([A-Z_]+)'/gm)].map((m) => [m[1]!, m[2]!]),
    );
    const byRole: Record<string, string[]> = {};
    for (const l of section("INSERT INTO role_permission", sqlP6Assistant).matchAll(
      /\('([0-9a-f-]{36})', '([a-z_.]+)'\)/g,
    ))
      (byRole[idToCode.get(l[1]!)!] ??= []).push(l[2]!);
    const sorted = (o: Record<string, readonly string[]>) =>
      Object.fromEntries(
        Object.entries(o)
          .filter(([, p]) => p.length > 0)
          .map(([c, p]) => [c, [...p].sort()]),
      );
    expect(sorted(byRole)).toEqual(sorted(P6_ASSISTANT_ROLE_PERMISSIONS));
    for (const [code, perms] of Object.entries(P6_ASSISTANT_ROLE_PERMISSIONS))
      for (const p of perms) expect(ROLES[code as keyof typeof ROLES].permissions).toContain(p);
  });

  it("no business approval or Finance validation; AUD holds neither code; every other role uses the assistant; ADM_TECH alone configures it", () => {
    expect(P6_ASSISTANT_PERMISSIONS).toEqual({ "assistant.use": "write", "assistant.configure": "configure" });
    expect(P6_ASSISTANT_ROLE_PERMISSIONS.AUD).toEqual([]);
    const users = Object.entries(P6_ASSISTANT_ROLE_PERMISSIONS)
      .filter(([, p]) => (p as readonly string[]).includes("assistant.use"))
      .map(([r]) => r);
    expect(users).toHaveLength(13);
    const configurers = Object.entries(P6_ASSISTANT_ROLE_PERMISSIONS)
      .filter(([, p]) => (p as readonly string[]).includes("assistant.configure"))
      .map(([r]) => r);
    expect(configurers).toEqual(["ADM_TECH"]);
  });
});

/**
 * F-DG5-100: the P5 ids its stage left unused (planned gaps of the p5-plan §4 ranges, D-142). They are permanently
 * unused: a file in a gap would run at its lexical position on a fresh database but last on an upgraded one (the
 * runner refuses that case too: migrate.ts `outOfOrderPending`). Never fill them; a new migration takes an id above
 * the highest shipped id.
 */
const P5_RETIRED_MIGRATION_IDS = [66, 67, 73, 77, 78, 79, 83, 84] as const;

/** The numbering rule of the shipped migration files (returns the violations; empty when the numbering is valid). */
function numberingViolations(files: readonly { id: number; name: string }[]): string[] {
  const out: string[] = [];
  // D-089: 0058-0061 were the DG4 repair ids. P5 (p5-plan §4, D-142) used ids 0062-0097 with planned gaps, and
  // 0094-0099 were held by the orchestrator for P5 repairs. P6 (p6-plan §4, D-195) gives the six architecture tasks
  // the ranges 0098-0127 and holds 0128-0133 for repairs, so ids from 0058 may have gaps but stay at most 0133
  // (T-DG6-ARCH-01). Ids below 0058 stay contiguous from 0001; all ids strictly increase (listMigrationFiles refuses
  // anything else).
  const REPAIR_FIRST = 58;
  const REPAIR_LAST = 133;
  const planned = files.filter((f) => f.id < REPAIR_FIRST).map((f) => f.id);
  if (planned.some((id, i) => id !== i + 1)) out.push(`ids below ${REPAIR_FIRST} are not contiguous from 0001`);
  for (const f of files.filter((f) => f.id > REPAIR_LAST)) out.push(`${f.name}: above 0133`);
  // F-DG5-100: the eight P5 gaps are never filled, by any later stage or repair.
  for (const f of files.filter((f) => (P5_RETIRED_MIGRATION_IDS as readonly number[]).includes(f.id)))
    out.push(`${f.name}: id ${String(f.id).padStart(4, "0")} is a retired P5 gap (F-DG5-100)`);
  return out;
}

describe("migration files", () => {
  it("are named NNNN_snake_case.sql with strictly increasing ids, and never use plain timestamp in public", () => {
    const files = listMigrationFiles();
    expect(numberingViolations(files)).toEqual([]);
    for (const f of files.filter((f) => !f.name.includes("pgboss"))) {
      const code = f.sql.replace(/--.*$/gm, "");
      expect(code, f.name).not.toMatch(/timestamp(?!tz)(?! with time zone)\b(?!\()/i);
      expect(code, f.name).not.toMatch(/\bfloat|double precision|\breal\b/i);
      expect(code, f.name).not.toMatch(/\buuidv7\(/i);
    }
  });

  it("pin the eight P5 gaps 0066, 0067, 0073, 0077, 0078, 0079, 0083 and 0084 as permanently unused (F-DG5-100)", () => {
    const files = listMigrationFiles();
    const p5 = files.filter((f) => f.id >= 62 && f.id <= 97).map((f) => f.id);
    const gaps = Array.from({ length: 97 - 62 + 1 }, (_, i) => 62 + i).filter((id) => !p5.includes(id));
    expect(gaps).toEqual([...P5_RETIRED_MIGRATION_IDS]);
    // A later file in any gap is a numbering violation; a file above the highest id is not.
    for (const id of P5_RETIRED_MIGRATION_IDS) {
      const name = `${String(id).padStart(4, "0")}_p6_example.sql`;
      expect(numberingViolations([...files, { id, name }].sort((a, b) => a.id - b.id)), name).toEqual([
        `${name}: id ${String(id).padStart(4, "0")} is a retired P5 gap (F-DG5-100)`,
      ]);
    }
    // T-DG6-ARCH-01: a free id of a P6 range is accepted; an id above the P6 repair block (0133) is not.
    // T-DG6-ARCH-02: 0101 is now shipped, so the free-id example was 0104; T-DG6-ARCH-03 shipped 0104-0107, so it was
    // 0108; T-DG6-ARCH-04 shipped 0108-0110, so it was 0111; T-DG6-ARCH-05 shipped 0111-0112, so it was 0113;
    // T-DG6-ARCH-06 shipped 0113, so it was 0114; T-DG6-BE-J shipped 0114 (renumbered at the W6 merge), so it is 0115.
    expect(numberingViolations([...files, { id: 115, name: "0115_p6_example.sql" }])).toEqual([]);
    expect(numberingViolations([...files, { id: 134, name: "0134_p7_example.sql" }])).toEqual([
      "0134_p7_example.sql: above 0133",
    ]);
  });
});
