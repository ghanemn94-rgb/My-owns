// T-DG6-ARCH-05B (solution-architect): inspect, on a DISPOSABLE cluster with every migration applied, the database facts
// behind the ADR-0007 §4 bounded-collection amendment for the 19 unpaginated lists that the LB probes do not cover.
//   QA_PG_PORT=23710 MTH_PORT_POOL=23711-23749 tests/qa/support/with-pg.sh \
//     node --conditions=@mth/source docs/delivery/handbacks/DG6/T-DG6-ARCH-05-evidence/list-bounds-inspect.ts
// Read-only after the migration; SYNTHETIC; approves nothing.
import { createRequire } from "node:module";
import { migrate } from "../../../../../packages/db/src/migrate.ts";

const pg = createRequire(new URL("../../../../../packages/db/package.json", import.meta.url))("pg");
const admin = process.env.TEST_DATABASE_ADMIN_URL!;
const migrationsDir = new URL("../../../../../packages/db/migrations", import.meta.url).pathname;
const TABLES = [
  "approval_route_step", "benefit_formula_version", "business_case_line", "deliverable", "dependency_type",
  "health_check_scheme", "import_template", "initiative_decision_link", "initiative_gap_link",
  "initiative_outcome_contribution", "kpi_restatement_reissue_offer", "playbook_block_link", "methodology_element",
  "milestone", "report_snapshot_version", "resource_role", "roadmap_wave", "tom_workshop_participant",
  "scoring_weight_set", "job_schedule", "config_review_policy",
];

async function main(): Promise<void> {
  const c0 = new pg.Client({ connectionString: admin });
  await c0.connect();
  await c0.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_owner') THEN CREATE ROLE mth_owner NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_app') THEN CREATE ROLE mth_app NOLOGIN; END IF; END $$`);
  await c0.query("CREATE DATABASE lb_inspect OWNER mth_owner TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'");
  await c0.end();
  const u = new URL(admin);
  u.pathname = "/lb_inspect";
  const owner = new URL(u.toString());
  owner.searchParams.set("options", "-c role=mth_owner");
  await migrate(owner.toString(), { dir: migrationsDir });
  const c = new pg.Client({ connectionString: u.toString() });
  await c.connect();
  for (const t of TABLES) {
    const ex = (await c.query("SELECT to_regclass($1) IS NOT NULL AS e", [t])).rows[0].e;
    if (!ex) { console.log(`${t}: (no such table)`); continue; }
    const r = (await c.query(
      `SELECT has_table_privilege('mth_app', $1, 'INSERT') AS ins, (SELECT count(*) FROM ${t})::int AS n,
        (SELECT string_agg(conname || ' ' || pg_get_constraintdef(oid), ' | ' ORDER BY conname) FROM pg_constraint
          WHERE conrelid = $1::regclass AND contype IN ('u','x')) AS uniq,
        (SELECT string_agg(indexrelid::regclass::text || ' ' || pg_get_indexdef(indexrelid), ' | ') FROM pg_index
          WHERE indrelid = $1::regclass AND indisunique AND NOT indisprimary
          AND indexrelid NOT IN (SELECT conindid FROM pg_constraint WHERE conrelid = $1::regclass)) AS uidx`, [t])).rows[0];
    console.log(`${t}: mth_app INSERT=${r.ins} rows_after_migrations=${r.n}\n   unique: ${r.uniq ?? "-"}\n   unique idx: ${r.uidx ?? "-"}`);
  }
  const extra = (await c.query(`SELECT
      (SELECT count(*)::int FROM methodology_element_profile) AS profiles,
      has_table_privilege('mth_app', 'methodology_element_profile', 'INSERT') AS profile_ins,
      (SELECT max(n)::int FROM (SELECT count(*) AS n FROM playbook_block_link GROUP BY block_ref) x) AS max_links_per_block,
      (SELECT max(n)::int FROM (SELECT count(*) AS n FROM playbook_block_link WHERE target_kind = 'template' GROUP BY target_key) x) AS max_seeded_links_per_template,
      (SELECT count(*)::int FROM playbook_block) AS blocks,
      (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'methodology_element_key') AS element_key`)).rows[0];
  console.log("extra: " + JSON.stringify(extra));
  const cat = ["permission", "role", "role_accountability", "phase_definition", "guiding_question", "decision_right_template",
    "governance_party", "adoption_indicator_template", "benefit_formula_example", "form_record_type", "report_definition",
    "config_review_policy", "job_schedule", "methodology_element_profile"];
  const parts: string[] = [];
  for (const t of cat) {
    const r = (await c.query(`SELECT has_table_privilege('mth_app', $1, 'INSERT') AS ins, (SELECT count(*) FROM ${t})::int AS n`, [t])).rows[0];
    parts.push(`${t}=${r.n}${r.ins ? "(mth_app INSERT)" : ""}`);
  }
  const hq = (await c.query(`SELECT count(*)::int AS n FROM source_element WHERE set_code = 'health_question'`)).rows[0].n;
  console.log("catalogue rows (mth_app has no INSERT unless marked): " + parts.join(" ") + ` source_element[health_question]=${hq}`);
  await c.end();
}
main().catch((e) => { console.error(e); process.exit(2); });
