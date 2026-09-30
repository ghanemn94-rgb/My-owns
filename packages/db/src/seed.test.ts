// Unit test (no database): the role/permission seed migration equals packages/shared/src/permissions.ts
// (data dictionary "role" seed rule, ADR-0006). The integration test seed.test.ts checks the seeded ROWS too.
import { readFileSync } from "node:fs";
import { PERMISSIONS, ROLES } from "@mth/shared";
import { describe, expect, it } from "vitest";
import { defaultMigrationsDir, listMigrationFiles } from "./migrate.ts";

const sql = readFileSync(`${defaultMigrationsDir()}/0005_seed_roles_permissions.sql`, "utf8");

function section(header: string): string {
  const start = sql.indexOf(header);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf(";", start);
  return sql.slice(start, end);
}

describe("0005 seed equals permissions.ts", () => {
  it("permission rows", () => {
    const rows = [...section("INSERT INTO permission").matchAll(/^\s*\('([a-z_.]+)', '([a-z_]+)'/gm)].map((m) => [
      m[1],
      m[2],
    ]);
    expect(Object.fromEntries(rows)).toEqual(PERMISSIONS);
    expect(rows).toHaveLength(Object.keys(PERMISSIONS).length);
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
    const expected = Object.fromEntries(Object.entries(ROLES).map(([c, d]) => [c, [...d.permissions].sort()]));
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

describe("migration files", () => {
  it("are named NNNN_snake_case.sql with strictly increasing ids, and never use plain timestamp in public", () => {
    const files = listMigrationFiles();
    expect(files.map((f) => f.id)).toEqual(files.map((_, i) => i + 1));
    for (const f of files.filter((f) => !f.name.includes("pgboss"))) {
      const code = f.sql.replace(/--.*$/gm, "");
      expect(code, f.name).not.toMatch(/timestamp(?!tz)(?! with time zone)\b(?!\()/i);
      expect(code, f.name).not.toMatch(/\bfloat|double precision|\breal\b/i);
      expect(code, f.name).not.toMatch(/\buuidv7\(/i);
    }
  });
});
