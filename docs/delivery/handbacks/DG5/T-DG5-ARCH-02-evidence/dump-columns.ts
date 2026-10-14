// T-DG5-ARCH-02 discovery: migrate a DISPOSABLE database and print the columns of the register tables the form
// framework maps (used to write the form_source_field seed with exact storage references).
import { createRequire } from "node:module";
import { migrate } from "../../../../../packages/db/src/migrate.ts";
const pg = createRequire(new URL("../../../../../packages/db/package.json", import.meta.url))("pg");
const admin = process.env.TEST_DATABASE_ADMIN_URL!;
const dir = new URL("../../../../../packages/db/migrations", import.meta.url).pathname;
const tables = process.argv.slice(2);
const a = new pg.Client({ connectionString: admin });
await a.connect();
await a.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_owner') THEN CREATE ROLE mth_owner NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_app') THEN CREATE ROLE mth_app NOLOGIN; END IF; END $$`);
await a.query(`CREATE DATABASE dumpcols OWNER mth_owner TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
await a.end();
const u = new URL(admin); u.pathname = "/dumpcols"; u.searchParams.set("options", "-c role=mth_owner");
await migrate(u.toString(), { dir });
const c = new pg.Client({ connectionString: u.toString() });
await c.connect();
for (const t of tables) {
  const r = await c.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`, [t]);
  console.log(`${t}: ${r.rows.map((x: any) => x.column_name).join(", ")}`);
}
await c.end();
