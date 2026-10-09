// T-DG4-ARCH-R1 migration probe for 0060 (solution-architect). Run against a DISPOSABLE cluster only:
//   QA_PG_PORT=<port in 23700-23749> MTH_PORT_POOL=<rest of 23700-23749> tests/qa/support/with-pg.sh \
//     node --conditions=@mth/source docs/delivery/handbacks/DG4/T-DG4-ARCH-R1-evidence/probe.ts
// 1. Fresh database: 0001..0059, the state before 0060 is printed, then 0060 alone, and the state after.
// 2. P3-populated database: 0001..0027 with synthetic P1 rows, then 0028..0059, then 0060 alone; same printout.
// 3. The new CHECK is exercised with its exact definition (pg_get_constraintdef) on a scratch table.
// The harness is cut down from the T-DG4-ARCH-08 probe. All data is SYNTHETIC and approves nothing.
import { cpSync, mkdtempSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "../../../../../packages/db/src/migrate.ts";

const pg = createRequire(new URL("../../../../../packages/db/package.json", import.meta.url))("pg");
const admin = process.env.TEST_DATABASE_ADMIN_URL!;
const migrationsDir = new URL("../../../../../packages/db/migrations", import.meta.url).pathname;
let failures = 0;
const NEW_CODES = ["governance.blocker_escalation_scan", "governance.decision_sla_scan", "governance.meeting_series_generate"];

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
async function client(db: string, role = "mth_owner") {
  const c = new pg.Client({ connectionString: roleUrl(db, role) });
  await c.connect();
  return c;
}
function report(name: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  -- ${detail.replace(/\s+/g, " ").slice(0, 600)}`);
}
function dirUpTo(files: string[], last: number, label: string): string {
  const d = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), `${label}-`));
  for (const f of files.filter((f) => Number(f.slice(0, 4)) <= last)) cpSync(join(migrationsDir, f), join(d, f));
  return d;
}

const ORG = "01990000-0000-7000-8000-0000000000a1";
const BU = "01990000-0000-7000-8000-0000000000a2";
const U1 = "01990000-0000-7000-8000-0000000000a3";
const TR = "01990000-0000-7000-8000-0000000000a4";
async function seedP1(c: any): Promise<void> {
  await c.query(`INSERT INTO organization (id, code, name_en, name_ar) VALUES ($1, 'SYN-R1', 'Synthetic probe org', 'منظمة تجريبية')`, [ORG]);
  await c.query(`INSERT INTO app_user (id, organization_id, display_name) VALUES ($1, $2, 'Synthetic TL')`, [U1, ORG]);
  await c.query(`INSERT INTO business_unit (id, organization_id, code, name_en, name_ar) VALUES ($1, $2, 'SYN-BU', 'Synthetic BU', 'وحدة تجريبية')`, [BU, ORG]);
  await c.query(
    `INSERT INTO transformation (id, organization_id, business_unit_id, code, name, mode, current_phase, timezone, currency, created_by, updated_by)
     VALUES ($1, $2, $3, 'SYN-T1', 'Synthetic transformation', 'end_to_end', 'diagnose', 'Asia/Riyadh', 'SAR', $4, $4)`,
    [TR, ORG, BU, U1],
  );
}

async function state(db: string, label: string): Promise<{ codes: string[]; def: string; audits: number }> {
  const c = await client(db);
  try {
    const rows = (await c.query(`SELECT code, queue_name, cron, timezone, enabled, owner_module, version FROM job_schedule ORDER BY code`)).rows;
    const def = (
      await c.query(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conrelid = 'benefit'::regclass AND conname = 'benefit_control_cadence_check'`)
    ).rows[0]?.d as string;
    const audits = Number(
      (
        await c.query(
          `SELECT count(*) AS n FROM audit_event a JOIN job_schedule s ON s.id = a.record_id
            WHERE a.record_type = 'job_schedule' AND a.action = 'job_schedule.create' AND a.source = 'migration' AND s.code = ANY($1)`,
          [NEW_CODES],
        )
      ).rows[0].n,
    );
    console.log(`--- ${label} (${db})`);
    for (const r of rows) console.log(`    job_schedule ${r.code} queue=${r.queue_name} cron="${r.cron}" tz=${r.timezone} enabled=${r.enabled} owner=${r.owner_module} v${r.version}`);
    console.log(`    benefit_control_cadence_check: ${def}`);
    console.log(`    job_schedule.create audit events for the three governance codes: ${audits}`);
    return { codes: rows.map((r: any) => r.code), def, audits };
  } finally {
    await c.end();
  }
}

async function checkCadence(db: string, tag: string, def: string): Promise<void> {
  const c = await client(db);
  try {
    await c.query(`CREATE TEMP TABLE probe_cc (control_cadence text, CONSTRAINT probe_cc_check ${def})`);
    for (const [v, ok] of [
      ["weekly", true],
      ["monthly", true],
      ["quarterly", true],
      ["semiannual", true],
      ["annual", true],
      [null, true],
      ["semi_annual", false],
      ["fortnightly", false],
    ] as const) {
      let committed = true;
      try {
        await c.query(`INSERT INTO probe_cc VALUES ($1)`, [v]);
      } catch {
        committed = false;
      }
      report(`${tag} CHECK ${v === null ? "NULL" : `'${v}'`} ${ok ? "accepted" : "refused"}`, committed === ok, committed ? "inserted" : "check_violation");
    }
  } finally {
    await c.end();
  }
}

async function main(): Promise<void> {
  const files = readdirSync(migrationsDir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  console.log(`migrations shipped: ${files.length} (${files[0]} .. ${files[files.length - 1]})`);
  const ids = files.map((f) => Number(f.slice(0, 4)));
  report("R00 ids 0001..0060 contiguous; 0060 is the last; 0061 absent", ids.every((n, i) => n === i + 1) && ids[ids.length - 1] === 60, `last ${ids[ids.length - 1]}`);

  // 1. Fresh database.
  await createDb("probe_r1_fresh");
  const a59 = await migrate(roleUrl("probe_r1_fresh", "mth_owner"), { dir: dirUpTo(files, 59, "to59") });
  report("R01 fresh: 0001..0059 apply", a59.length === 59, `applied ${a59.length}, last ${a59[a59.length - 1]}`);
  const before = await state("probe_r1_fresh", "fresh, before 0060");
  report("R02 fresh before 0060: no governance schedule; CHECK has no weekly", NEW_CODES.every((c) => !before.codes.includes(c)) && !before.def.includes("weekly"), before.def);
  const a60 = await migrate(roleUrl("probe_r1_fresh", "mth_owner"), { dir: migrationsDir });
  report("R03 fresh: 0060 applies alone", a60.length === 1 && /^0060_/.test(a60[0]!), `applied ${a60.join(",")}`);
  const after = await state("probe_r1_fresh", "fresh, after 0060");
  report("R04 fresh after 0060: three governance rows (9 in all), three audit events, weekly admitted",
    NEW_CODES.every((c) => after.codes.includes(c)) && after.codes.length === 9 && after.audits === 3 && after.def.includes("'weekly'") && after.def.includes("'semiannual'"), after.def);
  await checkCadence("probe_r1_fresh", "R05 fresh", after.def);
  const again = await migrate(roleUrl("probe_r1_fresh", "mth_owner"), { dir: migrationsDir });
  report("R06 fresh: a second migrate run applies nothing", again.length === 0, `applied ${again.length}`);

  // 2. P3-populated database.
  await createDb("probe_r1_p3");
  const p3 = await migrate(roleUrl("probe_r1_p3", "mth_owner"), { dir: dirUpTo(files, 27, "to27") });
  {
    const c = await client("probe_r1_p3");
    await c.query("BEGIN");
    await seedP1(c);
    await c.query("COMMIT");
    await c.end();
  }
  report("R07 P3: 0001..0027 apply and synthetic P1 rows commit", p3.length === 27, `applied ${p3.length}`);
  const p4 = await migrate(roleUrl("probe_r1_p3", "mth_owner"), { dir: dirUpTo(files, 59, "to59b") });
  report("R08 P3: 0028..0059 apply on top", p4.length === 32, `applied ${p4.length}, last ${p4[p4.length - 1]}`);
  const pb = await state("probe_r1_p3", "P3-populated, before 0060");
  report("R09 P3 before 0060: no governance schedule; CHECK has no weekly", NEW_CODES.every((c) => !pb.codes.includes(c)) && !pb.def.includes("weekly"), pb.def);
  const p60 = await migrate(roleUrl("probe_r1_p3", "mth_owner"), { dir: migrationsDir });
  report("R10 P3: 0060 applies alone", p60.length === 1 && /^0060_/.test(p60[0]!), `applied ${p60.join(",")}`);
  const pa = await state("probe_r1_p3", "P3-populated, after 0060");
  report("R11 P3 after 0060: three governance rows, three audit events, weekly admitted",
    NEW_CODES.every((c) => pa.codes.includes(c)) && pa.codes.length === 9 && pa.audits === 3 && pa.def.includes("'weekly'"), pa.def);
  {
    const c = await client("probe_r1_p3");
    const n = (await c.query(`SELECT count(*) AS n FROM transformation WHERE id = $1`, [TR])).rows[0].n;
    report("R12 P3: the synthetic transformation is untouched", Number(n) === 1, `rows ${n}`);
    // mth_app may change a schedule (job.configure) but not insert one.
    await c.query("BEGIN");
    try {
      await c.query("SET LOCAL ROLE mth_app");
      await c.query(`INSERT INTO job_schedule (id, code, queue_name, cron, description_en, description_ar, owner_module) VALUES (mth_uuid_v7(), 'x.y', 'x.y', '0 0 * * *', 'x', 'x', 'x')`);
      report("R13 mth_app cannot insert a job_schedule row", false, "inserted");
    } catch (e: any) {
      report("R13 mth_app cannot insert a job_schedule row", /permission denied/.test(e.message), e.message);
    }
    await c.query("ROLLBACK");
    await c.end();
  }
  await checkCadence("probe_r1_p3", "R14 P3", pa.def);

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 2;
  })
  .finally(() => process.exit());
