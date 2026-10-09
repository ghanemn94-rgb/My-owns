// T-DG4-ARCH-06: print the catalogue pins for the slice F/G tables (triggers, versioned tables, mth_app grants) from a
// freshly migrated DISPOSABLE database, for packages/db/test/integration/catalogue.test.ts.
import { createRequire } from "node:module";
import { migrate } from "../../../../../packages/db/src/migrate.ts";
const pg = createRequire(new URL("../../../../../packages/db/package.json", import.meta.url))("pg");
const admin = process.env.TEST_DATABASE_ADMIN_URL!;
const dir = new URL("../../../../../packages/db/migrations", import.meta.url).pathname;
const T = ["adoption_indicator_template", "stakeholder_group", "stakeholder_champion", "adoption_metric_link", "adoption_intervention", "assessment_form",
  "assessment_form_version", "assessment_invitation", "training_record", "assessment_record", "stakeholder_involvement", "champion_constraint",
  "performance_area", "performance_area_cycle", "performance_area_link", "control", "control_check", "bau_handover", "bau_handover_evidence",
  "transition_decision", "sustainment_review", "lesson", "improvement_item", "closure_record"];
async function main() {
  const a = new pg.Client({ connectionString: admin });
  await a.connect();
  await a.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_owner') THEN CREATE ROLE mth_owner NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_app') THEN CREATE ROLE mth_app NOLOGIN; END IF; END $$`);
  await a.query(`CREATE DATABASE gen_cat OWNER mth_owner TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
  await a.end();
  const u = new URL(admin); u.pathname = "/gen_cat"; u.searchParams.set("options", "-c role=mth_owner");
  await migrate(u.toString(), { dir });
  const c = new pg.Client({ connectionString: u.toString() });
  await c.connect();
  const tr = await c.query(`SELECT c.relname AS rel, t.tgname, t.tgdeferrable AS d, t.tginitdeferred AS i FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    WHERE NOT t.tgisinternal AND (c.relname = ANY ($1) OR t.tgname IN ('initiative_delivery_complete_guard', 'transformation_closure_guard')) ORDER BY 1, 2`, [T]);
  console.log("TRIGGERS");
  for (const r of tr.rows) console.log(`      ["${r.rel}", "${r.tgname}", ${r.d}, ${r.i}],`);
  const v = await c.query(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'version' AND is_nullable = 'NO' AND data_type = 'integer' AND table_name = ANY ($1) ORDER BY 1`, [T]);
  console.log("VERSIONED"); for (const r of v.rows) console.log(`      "${r.t}",`);
  const g = await c.query(`SELECT table_name AS t, string_agg(privilege_type, ',' ORDER BY privilege_type) AS p FROM information_schema.role_table_grants WHERE grantee = 'mth_app' AND table_name = ANY ($1) GROUP BY 1`, [T]);
  const order = new Map(T.map((t, i) => [t, i]));
  console.log("GRANTS");
  for (const r of g.rows.sort((x: any, y: any) => order.get(x.t)! - order.get(y.t)!)) console.log(`      ${r.t}: ${r.p === "INSERT,SELECT,UPDATE" ? "SIU" : `"${r.p}"`},`);
  await c.end();
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
