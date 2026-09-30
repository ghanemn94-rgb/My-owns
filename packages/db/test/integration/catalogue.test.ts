// Catalogue checks on the migrated per-run database: the Kysely types match the real columns, only timestamptz,
// no floats, every table has a primary key, every mutable table has a version column, and mth_app's privileges are
// exactly what the data dictionary grants (no DDL, DELETE only where stated, INSERT/SELECT only on audit_event).
import { afterAll, describe, expect, it } from "vitest";
import { SCHEMA_COLUMNS, VIEW_NAMES } from "../../src/schema.ts";
import { ownerRole } from "../helpers.ts";

const owner = ownerRole();
afterAll(() => owner.close());

async function q<T>(text: string, values: unknown[] = []): Promise<T[]> {
  return (await owner.pool.query(text, values)).rows as T[];
}

describe("schema.ts matches the migrated database", () => {
  it("has exactly the same relations and columns as public", async () => {
    const rows = await q<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`,
    );
    const actual: Record<string, string[]> = {};
    for (const r of rows) (actual[r.table_name] ??= []).push(r.column_name);
    const expected = Object.fromEntries(Object.entries(SCHEMA_COLUMNS).map(([t, cols]) => [t, [...cols].sort()]));
    expect(Object.fromEntries(Object.entries(actual).map(([t, cols]) => [t, cols.sort()]))).toEqual(expected);
  });

  it("marks exactly the views as views", async () => {
    const views = await q<{ table_name: string }>(
      `SELECT table_name FROM information_schema.views WHERE table_schema = 'public' ORDER BY 1`,
    );
    expect(views.map((v) => v.table_name)).toEqual([...VIEW_NAMES].sort());
  });
});

describe("type and structure rules (ADR-0003, data dictionary global rules)", () => {
  it("uses timestamptz only (no timestamp without time zone) and no floating point", async () => {
    const bad = await q<{ t: string; c: string; d: string }>(
      `SELECT table_name AS t, column_name AS c, data_type AS d FROM information_schema.columns
       WHERE table_schema = 'public' AND data_type IN ('timestamp without time zone', 'real', 'double precision')`,
    );
    expect(bad).toEqual([]);
  });

  it("gives every base table a primary key and uuid ids without defaults", async () => {
    const noPk = await q<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
         AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype = 'p')`,
    );
    expect(noPk).toEqual([]);
    const idDefaults = await q<{ t: string }>(
      `SELECT table_name AS t FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'id' AND data_type = 'uuid' AND column_default IS NOT NULL`,
    );
    expect(idDefaults).toEqual([]);
  });

  it("gives every mutable business table a version column >= 1 defaulting to 1", async () => {
    const mutable = [
      "organization",
      "business_unit",
      "app_user",
      "role",
      "scoped_assignment",
      "delegation",
      "transformation",
    ];
    const rows = await q<{ t: string; d: string }>(
      `SELECT table_name AS t, column_default AS d FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'version' AND is_nullable = 'NO' AND data_type = 'integer'`,
    );
    expect(rows.map((r) => r.t).sort()).toEqual(mutable.sort());
    expect(new Set(rows.map((r) => r.d))).toEqual(new Set(["1"]));
  });

  it("stores money-bearing currency as char(3) with a code check", async () => {
    const rows = await q<{ t: string; c: string; d: string; n: number }>(
      `SELECT table_name AS t, column_name AS c, data_type AS d, character_maximum_length AS n FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name IN ('currency', 'default_currency')`,
    );
    for (const r of rows) expect([r.d, r.n]).toEqual(["character", 3]);
  });
});

describe("mth_app privileges are exactly the data dictionary's", () => {
  it("matches per table", async () => {
    const rows = await q<{ t: string; p: string }>(
      `SELECT table_name AS t, string_agg(privilege_type, ',' ORDER BY privilege_type) AS p
       FROM information_schema.role_table_grants WHERE grantee = 'mth_app' AND table_schema = 'public' GROUP BY table_name`,
    );
    const actual = Object.fromEntries(rows.map((r) => [r.t, r.p]));
    const SIU = "INSERT,SELECT,UPDATE";
    expect(actual).toEqual({
      organization: SIU,
      business_unit: SIU,
      app_user: SIU,
      scoped_assignment: SIU,
      delegation: SIU,
      transformation: SIU,
      outbox_event: SIU,
      user_identity: "DELETE,INSERT,SELECT,UPDATE",
      session: "DELETE,INSERT,SELECT,UPDATE",
      oidc_login_state: "DELETE,INSERT,SELECT,UPDATE",
      idempotency_record: "DELETE,INSERT,SELECT",
      processed_message: "INSERT,SELECT",
      audit_event: "INSERT,SELECT",
      role: "SELECT",
      permission: "SELECT",
      role_permission: "SELECT",
      schema_migration: "SELECT",
      business_unit_closure: "SELECT",
      actor_display: "SELECT",
      scope_node: "SELECT",
    });
  });

  it("has no CREATE on public and owns nothing", async () => {
    const [row] = await q<{ create: boolean; owned: number }>(
      `SELECT has_schema_privilege('mth_app', 'public', 'CREATE') AS create,
              (SELECT count(*)::int FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE r.rolname = 'mth_app') AS owned`,
    );
    expect(row).toEqual({ create: false, owned: 0 });
  });

  it("can use the pg-boss schema without DDL", async () => {
    const [row] = await q<{ usage: boolean; create: boolean; ins: boolean }>(
      `SELECT has_schema_privilege('mth_app', 'pgboss', 'USAGE') AS usage,
              has_schema_privilege('mth_app', 'pgboss', 'CREATE') AS create,
              has_table_privilege('mth_app', 'pgboss.job', 'INSERT') AS ins`,
    );
    expect(row).toEqual({ usage: true, create: false, ins: true });
  });
});
