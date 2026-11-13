// T-DG7-ARCH-R1: migrates a DISPOSABLE database with every shipped migration and dumps (1) the coverage tool's own
// catalogue read (tools/release/dictionary-coverage.mjs readCatalogue) and (2) per-table detail (defaults, constraints,
// indexes, triggers, mth_app privileges) used to generate the repair sections of docs/architecture/data-dictionary.md.
//   tests/qa/support/with-pg.sh node --conditions=@mth/source \
//     docs/delivery/handbacks/DG7/T-DG7-ARCH-R1-evidence/dump-catalogue.ts <out.json>
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { migrate } from "../../../../../packages/db/src/migrate.ts";
import { readCatalogue } from "../../../../../tools/release/dictionary-coverage.mjs";

const pg = createRequire(new URL("../../../../../packages/db/package.json", import.meta.url))("pg");
const admin = process.env.TEST_DATABASE_ADMIN_URL!;
const migrationsDir = new URL("../../../../../packages/db/migrations", import.meta.url).pathname;
const out = process.argv[2]!;

async function main(): Promise<void> {
  const c0 = new pg.Client({ connectionString: admin });
  await c0.connect();
  await c0.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_owner') THEN CREATE ROLE mth_owner NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_app') THEN CREATE ROLE mth_app NOLOGIN; END IF; END $$`);
  await c0.query(`CREATE DATABASE dict_r1 OWNER mth_owner TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
  await c0.end();
  const u = new URL(admin);
  u.pathname = "/dict_r1";
  u.searchParams.set("options", "-c role=mth_owner");
  await migrate(u.toString(), { dir: migrationsDir });
  const catalogue = await readCatalogue(u.toString(), migrationsDir);
  const c = new pg.Client({ connectionString: u.toString() });
  await c.connect();
  const q = async (sql: string) => (await c.query(sql)).rows;
  const detail = {
    defaults: await q(`SELECT c.relname AS t, a.attname AS col, pg_get_expr(d.adbin, d.adrelid) AS def
      FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
      JOIN pg_class c ON c.oid = d.adrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'`),
    constraints: await q(`SELECT c.relname AS t, k.conname, k.contype, k.conkey, pg_get_constraintdef(k.oid) AS def
      FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' ORDER BY 1, 2`),
    attnums: await q(`SELECT c.relname AS t, a.attname AS col, a.attnum AS num FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND a.attnum > 0 AND NOT a.attisdropped`),
    indexes: await q(`SELECT c.relname AS t, i.relname AS name, pg_get_indexdef(x.indexrelid) AS def, x.indisprimary AS pk,
      EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = x.indexrelid) AS by_constraint
      FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid JOIN pg_class c ON c.oid = x.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' ORDER BY 1, 2`),
    triggers: await q(`SELECT c.relname AS t, g.tgname, pg_get_triggerdef(g.oid) AS def FROM pg_trigger g
      JOIN pg_class c ON c.oid = g.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND NOT g.tgisinternal ORDER BY 1, 2`),
    privileges: await q(`SELECT table_name AS t, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS p
      FROM information_schema.role_table_grants WHERE grantee = 'mth_app' AND table_schema = 'public' GROUP BY 1`),
    views: await q(`SELECT c.relname AS t, pg_get_viewdef(c.oid, true) AS def FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'v'`),
  };
  await c.end();
  writeFileSync(out, JSON.stringify({ catalogue, detail }, null, 1));
  console.log(`dumped ${catalogue.tables.length} tables, ${catalogue.columns.length} columns, migration ${catalogue.migration.highest}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});
