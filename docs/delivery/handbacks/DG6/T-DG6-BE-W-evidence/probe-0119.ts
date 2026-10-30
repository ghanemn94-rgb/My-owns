// T-DG6-BE-W probe of migration 0119 branding_version_contrast_required (backend-workflow-engineer; ADR-0061 §2).
// Run against a DISPOSABLE cluster only:
//   QA_PG_PORT=<port in 25850-25899> MTH_PORT_POOL=<rest> tests/qa/support/with-pg.sh \
//     node --conditions=@mth/source docs/delivery/handbacks/DG6/T-DG6-BE-W-evidence/probe-0119.ts
// 1. A database at 0001..0118 with a branding version 1 and its head, published before the rule (no report).
// 2. 0119 applied on top: only 0119 applies; the earlier version and head are byte-identical; no report is backfilled.
// 3. As mth_app with every trigger on: a new version (audited) without its report fails at COMMIT with
//    branding_version_contrast_required; with its report, its pairs and their audit event it commits.
// The fixture helpers are copied from the T-DG6-ARCH-06 probe. All data is SYNTHETIC and approves nothing.
// #0078FF is a provisional brand token, not a verified Mobily colour.
import { cpSync, mkdtempSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "../../../../../packages/db/src/migrate.ts";

const pg = createRequire(new URL("../../../../../packages/db/package.json", import.meta.url))("pg");
const admin = process.env.TEST_DATABASE_ADMIN_URL!;
const migrationsDir = new URL("../../../../../packages/db/migrations", import.meta.url).pathname;
const BEFORE = 118;
let failures = 0;
let total = 0;

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
async function client(db: string, role: string | null = "mth_owner") {
  const c = new pg.Client({ connectionString: roleUrl(db, role) });
  await c.connect();
  return c;
}
function report(name: string, ok: boolean, detail: string): void {
  total++;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  -- ${detail.replace(/\s+/g, " ").slice(0, 300)}`);
}
async function insRow(c: any, table: string, row: Record<string, unknown>): Promise<void> {
  const cols = Object.keys(row);
  await c.query(
    `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
    Object.values(row),
  );
}
async function fixture(db: string, table: string, row: Record<string, unknown>): Promise<void> {
  const c = await client(db, null);
  try {
    await c.query("SET session_replication_role = replica");
    await insRow(c, table, row);
  } finally {
    await c.end();
  }
}

const ORG = "01990000-0000-7000-8000-000000000001";
const U1 = "01990000-0000-7000-8000-000000000003";
let seq = 0x100;
const uid = () => `01990000-0000-7000-8000-${(seq++).toString(16).padStart(12, "0")}`;
const version = (id: string, no: number) => ({
  id,
  organization_id: ORG,
  version_no: no,
  product_name_en: "Synthetic Hub",
  product_name_ar: "منصة تجريبية",
  primary_colour: "#0078FF",
  secondary_colour: "#003B73",
  colours_provisional: true,
  font_latin: "IBM Plex Sans",
  font_arabic: "IBM Plex Sans Arabic",
  created_by: U1,
});
async function audit(c: any, recordType: string, recordId: string): Promise<void> {
  await insRow(c, "audit_event", {
    id: uid(),
    organization_id: ORG,
    actor_type: "user",
    actor_user_id: U1,
    request_id: `probe-${recordId}`,
    source: "api",
    action: `${recordType}.create`,
    record_type: recordType,
    record_id: recordId,
  });
}

async function main(): Promise<void> {
  const files = readdirSync(migrationsDir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  const top = files.at(-1)!;
  report("G00 0119 is the highest shipped file on this branch", top.startsWith("0119_"), `last: ${top}`);
  const db = "probe_0119";
  await createDb(db);
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "pre-0119-"));
  const pre = files.filter((f) => Number(f.slice(0, 4)) <= BEFORE);
  for (const f of pre) cpSync(join(migrationsDir, f), join(dir, f));
  const applied = await migrate(roleUrl(db, "mth_owner"), { dir });
  report("G01 0001..0118 apply", applied.length === pre.length, `applied ${applied.length}`);

  const BV1 = uid();
  await fixture(db, "organization", { id: ORG, code: "SYN-PROBE", name_en: "Synthetic probe org", name_ar: "منظمة تجريبية" });
  await fixture(db, "app_user", { id: U1, organization_id: ORG, display_name: "Synthetic admin" });
  await fixture(db, "branding_version", version(BV1, 1));
  await fixture(db, "branding_setting", {
    id: uid(),
    organization_id: ORG,
    current_version_no: 1,
    version: 1,
    created_by: U1,
    updated_by: U1,
  });
  const digest = async (c: any) =>
    (await c.query(`SELECT md5(string_agg(to_jsonb(b)::text, '' ORDER BY id)) AS h FROM branding_version b`)).rows[0].h +
    "/" +
    (await c.query(`SELECT md5(string_agg(to_jsonb(b)::text, '' ORDER BY id)) AS h FROM branding_setting b`)).rows[0].h;
  const own = await client(db);
  const before = await digest(own);

  const onTop = await migrate(roleUrl(db, "mth_owner"), { dir: migrationsDir });
  report("G02 only 0119 applies over 0118", onTop.length === 1 && onTop[0]!.startsWith("0119_"), onTop.join(", "));
  const after = await digest(own);
  const r = (
    await own.query(`SELECT (SELECT count(*) FROM branding_contrast_report)::int AS reports,
      (SELECT count(*) FROM branding_contrast_pair)::int AS pairs`)
  ).rows[0];
  report(
    "G03 the version published before 0119 and its head are byte-identical; no report is backfilled",
    after === before && r.reports === 0 && r.pairs === 0,
    `${after === before ? "identical" : `changed ${before} -> ${after}`}; ${JSON.stringify(r)}`,
  );
  const trig = (
    await own.query(`SELECT t.tgdeferrable, t.tginitdeferred, c.relname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      WHERE t.tgname = 'branding_version_contrast_required'`)
  ).rows;
  report(
    "G04 the constraint trigger is on branding_version, DEFERRABLE INITIALLY DEFERRED",
    trig.length === 1 && trig[0].tgdeferrable && trig[0].tginitdeferred && trig[0].relname === "branding_version",
    JSON.stringify(trig),
  );

  const app = await client(db, "mth_app");
  // RQ01: version 2 with its own audit event, no report -> COMMIT fails.
  await app.query("BEGIN");
  try {
    const id = uid();
    await insRow(app, "branding_version", version(id, 2));
    await audit(app, "branding_version", id);
    await app.query("COMMIT");
    report("RQ01 a version without its report fails at COMMIT", false, "committed");
  } catch (e: any) {
    await app.query("ROLLBACK").catch(() => undefined);
    report(
      "RQ01 a version without its report fails at COMMIT",
      e.code === "23000" && e.constraint === "branding_version_contrast_required",
      `${e.code} ${e.constraint} ${e.message}`,
    );
  }
  // RQ02: version 2 with its report (one passing pair), all audited -> commits.
  await app.query("BEGIN");
  try {
    const id = uid();
    const rid = uid();
    await insRow(app, "branding_version", version(id, 2));
    await audit(app, "branding_version", id);
    await insRow(app, "branding_contrast_report", {
      id: rid,
      organization_id: ORG,
      branding_version_no: 2,
      rules: "wcag2x-aa-v1",
      token_source_sha256: "0".repeat(64),
      pair_count: 1,
      created_by: U1,
    });
    await insRow(app, "branding_contrast_pair", {
      id: uid(),
      report_id: rid,
      ordinal: 1,
      fg_token: "text.primary",
      bg_token: "surface.page",
      use: "text",
      fg_hex: "#142438",
      bg_hex: "#F5F8FC",
      ratio: "14.79",
      threshold: "4.5",
      usage_note: "Synthetic probe pair",
    });
    await audit(app, "branding_contrast_report", rid);
    await app.query("COMMIT");
    report("RQ02 a version with its report commits", true, "committed");
  } catch (e: any) {
    await app.query("ROLLBACK").catch(() => undefined);
    report("RQ02 a version with its report commits", false, `${e.code} ${e.constraint} ${e.message}`);
  }
  const v = (await own.query(`SELECT version_no FROM branding_version ORDER BY version_no`)).rows.map((x: any) => x.version_no);
  const v1 = (await own.query(`SELECT count(*)::int AS n FROM branding_contrast_report WHERE branding_version_no = 1`)).rows[0].n;
  report("RQ03 version 1 (before the rule) is still there without a report; version 2 has one", JSON.stringify(v) === "[1,2]" && v1 === 0, `versions ${JSON.stringify(v)}; reports for v1: ${v1}`);
  await app.end();
  await own.end();
  console.log(`\n${total - failures}/${total} PASS`);
  process.exitCode = failures === 0 ? 0 : 1;
}
await main();
