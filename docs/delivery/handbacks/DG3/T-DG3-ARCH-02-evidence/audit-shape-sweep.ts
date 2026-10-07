// T-DG3-ARCH-02 audit-shape sweep (solution-architect). Run against a DISPOSABLE cluster only:
//   QA_PG_PORT=<23700-23749> tests/qa/support/with-pg.sh \
//     node --conditions=@mth/source docs/delivery/handbacks/DG3/T-DG3-ARCH-02-evidence/audit-shape-sweep.ts
// Proves that every audit_event row written by migrations 0020-0025 (seeds, waves, weight set, examples, backfill) and
// by p3_instantiate_transformation() carries the contract AuditEvent `changes` shape. Two databases:
//   1. fresh: 0001..0025, then the API path (p3_instantiate_transformation as a user) for a synthetic transformation;
//   2. P2-populated: 0001..0019, synthetic P2 data (two transformations with their P2 starter structure), then
//      0020..0025 on top, so the 0024 backfill path writes its rows.
// Every audit_event.changes in each database is validated with Ajv (draft 2020-12) against
// docs/api/openapi.yaml components.schemas.AuditEvent.properties.changes. SYNTHETIC data; it approves nothing.
import { cpSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "../../../../../packages/db/src/migrate.ts";

const repo = new URL("../../../../../", import.meta.url).pathname;
const pg = createRequire(join(repo, "packages/db/package.json"))("pg");
const apiRequire = createRequire(join(repo, "apps/api/package.json"));
const Ajv2020 = apiRequire("ajv/dist/2020").default;
const YAML = apiRequire("yaml");
const admin = process.env.TEST_DATABASE_ADMIN_URL!;
// SWEEP_MIGRATIONS_DIR (control runs only): sweep another migration set, e.g. the pre-fix 0024 without 0025.
const migrationsDir = process.env.SWEEP_MIGRATIONS_DIR ?? join(repo, "packages/db/migrations");
let failures = 0;

const contract = YAML.parse(readFileSync(join(repo, "docs/api/openapi.yaml"), "utf8"));
const changesSchema = contract.components.schemas.AuditEvent.properties.changes;
const validateChanges = new Ajv2020({ strict: false, allErrors: true }).compile(changesSchema);

function roleUrl(db: string, role: string | null): string {
  const u = new URL(admin);
  u.pathname = `/${db}`;
  if (role) u.searchParams.set("options", `-c role=${role}`);
  return u.toString();
}
async function adminQuery(sql: string): Promise<void> {
  const c = new pg.Client({ connectionString: admin });
  await c.connect();
  try {
    await c.query(sql);
  } finally {
    await c.end();
  }
}
async function createDb(name: string): Promise<void> {
  await adminQuery(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_owner') THEN CREATE ROLE mth_owner NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_app') THEN CREATE ROLE mth_app NOLOGIN; END IF; END $$`);
  await adminQuery(`CREATE DATABASE ${name} OWNER mth_owner TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
}
async function client(db: string) {
  const c = new pg.Client({ connectionString: roleUrl(db, "mth_owner") });
  await c.connect();
  return c;
}
function report(name: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  -- ${detail.replace(/\s+/g, " ").slice(0, 600)}`);
}

const ORG = "01990000-0000-7000-8000-0000000000a1";
const BU = "01990000-0000-7000-8000-0000000000a2";
const U1 = "01990000-0000-7000-8000-0000000000a3";
const TRS = ["01990000-0000-7000-8000-0000000000a5", "01990000-0000-7000-8000-0000000000a6"];

async function seedP1(c: any, transformations: readonly string[]): Promise<void> {
  await c.query(`INSERT INTO organization (id, code, name_en, name_ar) VALUES ($1, 'SYN-SWEEP', 'Synthetic sweep org', 'منظمة تجريبية')`, [ORG]);
  await c.query(`INSERT INTO app_user (id, organization_id, display_name) VALUES ($1, $2, 'Synthetic TL')`, [U1, ORG]);
  await c.query(`INSERT INTO business_unit (id, organization_id, code, name_en, name_ar) VALUES ($1, $2, 'SYN-BU', 'Synthetic BU', 'وحدة تجريبية')`, [BU, ORG]);
  for (const [i, tr] of transformations.entries())
    await c.query(
      `INSERT INTO transformation (id, organization_id, business_unit_id, code, name, mode, current_phase, timezone, currency, created_by, updated_by)
       VALUES ($1, $2, $3, $4, 'Synthetic transformation', 'end_to_end', 'diagnose', 'Asia/Riyadh', 'SAR', $5, $5)`,
      [tr, ORG, BU, `SYN-T${i + 1}`, U1],
    );
}

/** Validates every audit_event.changes in `db`; reports per database and per migration-written action. */
async function sweep(db: string, label: string): Promise<void> {
  const c = await client(db);
  try {
    const rows = await c.query(`SELECT id, action, source, actor_type, changes FROM audit_event ORDER BY seq`);
    const bad = rows.rows.filter((r: any) => !validateChanges(r.changes));
    const byAction = new Map<string, { n: number; withChanges: number }>();
    for (const r of rows.rows) {
      const k = `${r.action} [${r.source ?? "null"}/${r.actor_type}]`;
      const e = byAction.get(k) ?? { n: 0, withChanges: 0 };
      e.n++;
      if (r.changes !== null) e.withChanges++;
      byAction.set(k, e);
    }
    console.log(`  ${label}: ${rows.rowCount} audit_event rows; by action [source/actor]:`);
    for (const [k, v] of [...byAction].sort()) console.log(`    ${k}: ${v.n} (changes non-null: ${v.withChanges})`);
    const ws = rows.rows.filter((r: any) => r.action === "scoring_weight_set.create");
    for (const r of ws) console.log(`    scoring_weight_set.create changes = ${JSON.stringify(r.changes)}`);
    report(
      `${label}: every audit_event.changes matches the contract AuditEvent.changes schema`,
      bad.length === 0 && rows.rowCount > 0,
      bad.length === 0
        ? `${rows.rowCount} rows valid`
        : `${bad.length} invalid: ${JSON.stringify(bad.slice(0, 3).map((r: any) => ({ action: r.action, changes: r.changes })))}`,
    );
    report(
      `${label}: scoring_weight_set.create is {"weights": {"from": null, "to": {...}}}`,
      ws.length > 0 && ws.every((r: any) => r.changes?.weights?.from === null && r.changes?.weights?.to?.strategic_fit === "25.00"),
      `${ws.length} rows`,
    );
  } finally {
    await c.end();
  }
}

async function main(): Promise<void> {
  console.log(`contract AuditEvent.changes schema: ${JSON.stringify(changesSchema)}`);
  // Negative control: the malformed pre-fix shape must be rejected by the validator, so a PASS means something.
  const malformed = { weights: { strategic_fit: "25.00", financial_value: "25.00" } };
  report("negative control: the pre-fix {\"weights\": {...}} shape is rejected", !validateChanges(malformed), JSON.stringify(malformed));
  report("positive control: {\"weights\": {\"from\": null, \"to\": {...}}} is accepted", validateChanges({ weights: { from: null, to: { a: "1" } } }) === true, "ok");

  const files = readdirSync(migrationsDir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  console.log(`migrations shipped: ${files.length} (${files[0]} .. ${files[files.length - 1]})`);

  // 1. Fresh database, then the API path.
  await createDb("sweep_fresh");
  const applied = await migrate(roleUrl("sweep_fresh", "mth_owner"), { dir: migrationsDir });
  report(`fresh database: ${files[0]}..${files[files.length - 1]} apply`, applied.length === files.length && files.length === Number(process.env.SWEEP_EXPECT_FILES ?? 25), `applied ${applied.length}`);
  {
    const c = await client("sweep_fresh");
    await c.query("BEGIN");
    await seedP1(c, [TRS[0]!]);
    const n = await c.query(`SELECT p3_instantiate_transformation($1, $2, 'sweep-req', 'api') AS n`, [TRS[0], U1]);
    await c.query("COMMIT");
    report("fresh database: p3_instantiate_transformation as a user (API path)", Number(n.rows[0].n) > 0, `created ${n.rows[0].n} rows`);
    await c.end();
  }
  await sweep("sweep_fresh", "fresh database");

  // 2. P2-populated database, then 0020..0025 on top (the 0024 backfill path).
  await createDb("sweep_p2");
  const p2Dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "p2-migrations-"));
  for (const f of files.filter((f) => Number(f.slice(0, 4)) <= 19)) cpSync(join(migrationsDir, f), join(p2Dir, f));
  const p2Applied = await migrate(roleUrl("sweep_p2", "mth_owner"), { dir: p2Dir });
  {
    const c = await client("sweep_p2");
    await c.query("BEGIN");
    await seedP1(c, TRS);
    let total = 0;
    for (const tr of TRS) total += Number((await c.query(`SELECT p2_instantiate_transformation($1, $2, 'p2-req', 'api') AS n`, [tr, U1])).rows[0].n);
    await c.query("COMMIT");
    report("P2 database populated (0001..0019 + two synthetic transformations with their P2 starter rows)", p2Applied.length === 19 && total > 0, `applied ${p2Applied.length}, P2 starter rows ${total}`);
    await c.end();
  }
  const onTop = await migrate(roleUrl("sweep_p2", "mth_owner"), { dir: migrationsDir });
  report(`P2-populated database: 0020..${files[files.length - 1]} apply on top`, onTop.length === files.length - 19, `applied ${onTop.join(", ")}`);
  {
    const c = await client("sweep_p2");
    const b = await c.query(`SELECT count(*)::int AS n FROM audit_event WHERE source = 'migration' AND record_type IN ('roadmap_wave', 'scoring_weight_set')`);
    report("P2-populated database: the 0024 backfill audited 5 rows per transformation", b.rows[0].n === 5 * TRS.length, `backfill audit rows ${b.rows[0].n}`);
    await c.end();
  }
  await sweep("sweep_p2", "P2-populated database");

  await adminQuery(`DROP DATABASE sweep_fresh`);
  await adminQuery(`DROP DATABASE sweep_p2`);
  console.log(failures === 0 ? "SWEEP PASS" : `SWEEP FAIL (${failures})`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
