// T-DG5-ARCH-03: quick apply of 0001..last on a DISPOSABLE database, with seed counts (development aid; the full
// evidence is probe.ts).
import { createRequire } from "node:module";
import { migrate } from "../../../../../packages/db/src/migrate.ts";
const pg = createRequire(new URL("../../../../../packages/db/package.json", import.meta.url))("pg");
const admin = process.env.TEST_DATABASE_ADMIN_URL!;
const dir = new URL("../../../../../packages/db/migrations", import.meta.url).pathname;
const a = new pg.Client({ connectionString: admin });
await a.connect();
await a.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_owner') THEN CREATE ROLE mth_owner NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_app') THEN CREATE ROLE mth_app NOLOGIN; END IF; END $$`);
await a.query(`CREATE DATABASE applycheck OWNER mth_owner TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
await a.end();
const u = new URL(admin); u.pathname = "/applycheck"; u.searchParams.set("options", "-c role=mth_owner");
const applied = await migrate(u.toString(), { dir });
console.log("applied", applied.length, applied.slice(-4).join(" "));
const c = new pg.Client({ connectionString: u.toString() });
await c.connect();
for (const q of ["SELECT count(*) FROM automation_trigger", "SELECT count(*) FROM automation_action_type",
  "SELECT count(*) FROM automation_rule WHERE origin = 'starter' AND enabled AND NOT disable_allowed",
  "SELECT count(*) FROM automation_rule_version WHERE status = 'published'", "SELECT count(*) FROM job_schedule",
  "SELECT count(*) FROM work_item_kind WHERE urgency = 'urgent'"]) {
  console.log(q, (await c.query(q)).rows[0].count);
}
await c.end();
