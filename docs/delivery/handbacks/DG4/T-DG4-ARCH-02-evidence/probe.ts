// T-DG4-ARCH-02 migration and guard probe (solution-architect). Run against a DISPOSABLE cluster only:
//   QA_PG_PORT=<port in 23700-23749> MTH_PORT_POOL=23701-23749 tests/qa/support/with-pg.sh \
//     node --conditions=@mth/source docs/delivery/handbacks/DG4/T-DG4-ARCH-02-evidence/probe.ts
// 1. Fresh database: all migrations 0001..00NN.
// 2. P3-populated database: 0001..0027, synthetic P1-P3 data (a transformation with its P3 starter structure and a DG3
//    fixture-style delegation row), then 0028..00NN on top (backfill check).
// 3. Guard probes on the new P4 tables (ADR-0027, ADR-0028). Every probe states the expected failure; "PASS" means the
//    guard fired (or, for an expectSuccess probe, that the allowed write committed). All data is SYNTHETIC and
//    approves nothing.
import { cpSync, mkdtempSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "../../../../../packages/db/src/migrate.ts";

const pg = createRequire(new URL("../../../../../packages/db/package.json", import.meta.url))("pg");
const admin = process.env.TEST_DATABASE_ADMIN_URL!;
const migrationsDir = new URL("../../../../../packages/db/migrations", import.meta.url).pathname;
const LAST_P3 = 27;
let failures = 0;

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
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  -- ${detail.replace(/\s+/g, " ").slice(0, 400)}`);
}
async function expectFailure(c: any, name: string, expect: RegExp, fn: () => Promise<void>): Promise<void> {
  await c.query("BEGIN");
  try {
    await fn();
    await c.query("COMMIT");
    report(name, false, "committed, but the guard should have refused it");
  } catch (e: any) {
    await c.query("ROLLBACK").catch(() => undefined);
    const text = `${e.code ?? ""} ${e.constraint ?? ""} ${e.message}`;
    report(name, expect.test(text), text);
  }
}
async function expectSuccess(c: any, name: string, fn: () => Promise<string>): Promise<void> {
  await c.query("BEGIN");
  try {
    const d = await fn();
    await c.query("COMMIT");
    report(name, true, d);
  } catch (e: any) {
    await c.query("ROLLBACK").catch(() => undefined);
    report(name, false, `${e.code ?? ""} ${e.constraint ?? ""} ${e.message}`);
  }
}

// Fixed synthetic ids (SYNTHETIC data; approves nothing).
const ORG = "01990000-0000-7000-8000-000000000001";
const BU = "01990000-0000-7000-8000-000000000002";
const U1 = "01990000-0000-7000-8000-000000000003"; // TL
const U2 = "01990000-0000-7000-8000-000000000004"; // SP
const TR = "01990000-0000-7000-8000-000000000005";
const U3 = "01990000-0000-7000-8000-000000000006"; // a third person
const TR2 = "01990000-0000-7000-8000-000000000007";
const ORG2 = "01990000-0000-7000-8000-000000000008";
const UX = "01990000-0000-7000-8000-000000000009"; // user of ORG2
let seq = 100;
const uid = () => `01990000-0000-7000-8000-${(seq++).toString(16).padStart(12, "0")}`;

async function seedP1(c: any): Promise<void> {
  await c.query(`INSERT INTO organization (id, code, name_en, name_ar) VALUES ($1, 'SYN-PROBE', 'Synthetic probe org', 'منظمة تجريبية')`, [ORG]);
  await c.query(`INSERT INTO organization (id, code, name_en, name_ar) VALUES ($1, 'SYN-OTHER', 'Synthetic other org', 'منظمة أخرى')`, [ORG2]);
  await c.query(
    `INSERT INTO app_user (id, organization_id, display_name) VALUES ($1, $4, 'Synthetic TL'), ($2, $4, 'Synthetic SP'), ($3, $4, 'Synthetic BO')`,
    [U1, U2, U3, ORG],
  );
  await c.query(`INSERT INTO app_user (id, organization_id, display_name) VALUES ($1, $2, 'Synthetic other-org user')`, [UX, ORG2]);
  await c.query(`INSERT INTO business_unit (id, organization_id, code, name_en, name_ar) VALUES ($1, $2, 'SYN-BU', 'Synthetic BU', 'وحدة تجريبية')`, [BU, ORG]);
  for (const [id, code] of [
    [TR, "SYN-T1"],
    [TR2, "SYN-T2"],
  ])
    await c.query(
      `INSERT INTO transformation (id, organization_id, business_unit_id, code, name, mode, current_phase, timezone, currency, created_by, updated_by)
       VALUES ($1, $2, $3, $4, 'Synthetic transformation', 'end_to_end', 'diagnose', 'Asia/Riyadh', 'SAR', $5, $5)`,
      [id, ORG, BU, code, U1],
    );
}
async function audit(c: any, recordType: string, id: string, version: number | null, org: string | null = ORG, tr: string | null = TR): Promise<void> {
  await c.query(
    `INSERT INTO audit_event (id, organization_id, transformation_id, actor_type, actor_user_id, action, record_type, record_id, new_version, source)
     VALUES ($1, $2, $3, 'user', $4, $5, $6, $7, $8, 'cli')`,
    [uid(), org, tr, U1, `${recordType}.probe`, recordType, id, version],
  );
}

// ------------------------------------------------------------------------------------------------ slice A helpers
async function kpiDef(c: any, name: string, unit: string, currency: string | null, polarity: string, frequency = "monthly", activate = true): Promise<string> {
  const id = uid();
  await c.query(
    `INSERT INTO kpi_definition (id, organization_id, transformation_id, name, unit_kind, currency, polarity, frequency, owner_user_id, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $9)`,
    [id, ORG, TR, name, unit, currency, polarity, frequency, U1],
  );
  await audit(c, "kpi_definition", id, 1);
  if (activate) {
    await c.query(`UPDATE kpi_definition SET status = 'active', version = 2 WHERE id = $1`, [id]);
    await audit(c, "kpi_definition", id, 2);
  }
  return id;
}
type VOpts = Record<string, unknown>;
async function kpiVersion(c: any, def: string, o: VOpts = {}): Promise<string> {
  const id = uid();
  const d = (await c.query(`SELECT unit_kind, currency, frequency, polarity FROM kpi_definition WHERE id = $1`, [def])).rows[0];
  const no = (await c.query(`SELECT coalesce(max(version_no), 0) + 1 AS n FROM kpi_version WHERE kpi_definition_id = $1`, [def])).rows[0].n;
  const measure = d.polarity === "within_band" ? "acceptable_band" : d.polarity;
  const row: Record<string, unknown> = {
    id, organization_id: ORG, transformation_id: TR, kpi_definition_id: def, version_no: no, measure_type: measure,
    value_nature: "flow", unit_kind: d.unit_kind, currency: d.currency, frequency: d.frequency, aggregation_rule: "sum",
    submission_route: "direct_accept", reviewer_party_code: null, change_reason: no > 1 ? "Synthetic change" : null,
    created_by: U1, updated_by: U1, ...o,
  };
  const cols = Object.keys(row);
  await c.query(`INSERT INTO kpi_version (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(row));
  await audit(c, "kpi_version", id, 1);
  return id;
}
async function activateVersion(c: any, vid: string): Promise<void> {
  const v = (await c.query(`SELECT version, kpi_definition_id FROM kpi_version WHERE id = $1`, [vid])).rows[0];
  const cur = (await c.query(`SELECT id, version FROM kpi_version WHERE kpi_definition_id = $1 AND status = 'active'`, [v.kpi_definition_id])).rows[0];
  if (cur) {
    await c.query(`UPDATE kpi_version SET status = 'superseded', superseded_at = now(), version = version + 1 WHERE id = $1`, [cur.id]);
    await audit(c, "kpi_version", cur.id, cur.version + 1);
  }
  await c.query(`UPDATE kpi_version SET status = 'active', activated_at = now(), activated_by = $2, version = version + 1 WHERE id = $1`, [vid, U1]);
  await audit(c, "kpi_version", vid, v.version + 1);
}
async function period(c: any, label: string, start: string, end: string, o: { frequency?: string; status?: string; basis?: string; weeks?: number | null } = {}): Promise<string> {
  const id = uid();
  await c.query(
    `INSERT INTO reporting_period (id, organization_id, frequency, period_label, period_start, period_end, basis, week_count, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
    [id, ORG, o.frequency ?? "monthly", label, start, end, o.basis ?? "calendar", o.weeks ?? null, U1],
  );
  await audit(c, "reporting_period", id, 1, ORG, null);
  if ((o.status ?? "open") !== "scheduled") {
    await c.query(`UPDATE reporting_period SET status = 'open', opened_at = now(), version = 2 WHERE id = $1`, [id]);
    await audit(c, "reporting_period", id, 2, ORG, null);
  }
  if (o.status === "closed") {
    await c.query(`UPDATE reporting_period SET status = 'closed', closed_at = now(), version = 3 WHERE id = $1`, [id]);
    await audit(c, "reporting_period", id, 3, ORG, null);
  }
  return id;
}
async function activeVersionOf(c: any, def: string): Promise<string> {
  return (await c.query(`SELECT id FROM kpi_version WHERE kpi_definition_id = $1 AND status = 'active'`, [def])).rows[0].id;
}
/** Direct-accept entry of value 1 in a new slot: slot + value + review + ONE audit event. */
async function directActual(c: any, def: string, per: string, value: string | null, o: { currency?: string | null; scopeKind?: string; scopeId?: string; missing?: string | null } = {}): Promise<string> {
  const id = uid();
  const p = (await c.query(`SELECT period_start::text AS s, period_end::text AS e, period_label AS l FROM reporting_period WHERE id = $1`, [per])).rows[0];
  const ver = await activeVersionOf(c, def);
  const cur = (await c.query(`SELECT currency FROM kpi_version WHERE id = $1`, [ver])).rows[0].currency;
  await c.query(
    `INSERT INTO kpi_actual (id, organization_id, transformation_id, kpi_definition_id, scope_kind, scope_id, reporting_period_id, period_start, period_end,
       period_label, status, route, accepted_value_no, submitted_by, submitted_at, decided_by, decided_at, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'accepted', 'direct_accept', 1, $11, now(), $11, now(), $11, $11)`,
    [id, ORG, TR, def, o.scopeKind ?? "transformation", o.scopeId ?? TR, per, p.s, p.e, p.l, U1],
  );
  await c.query(
    `INSERT INTO kpi_actual_value (id, organization_id, transformation_id, kpi_actual_id, value_no, kpi_version_id, value, currency, missing_reason, data_as_of, entered_by, business_date)
     VALUES ($1, $2, $3, $4, 1, $5, $6, $7, $8, current_date, $9, p4_business_date(now(), 'Asia/Riyadh'))`,
    [uid(), ORG, TR, id, ver, value, o.currency === undefined ? cur : o.currency, o.missing ?? null, U1],
  );
  await c.query(
    `INSERT INTO kpi_actual_review (id, organization_id, transformation_id, kpi_actual_id, value_no, outcome, decided_by, business_date)
     VALUES ($1, $2, $3, $4, 1, 'direct_accept', $5, p4_business_date(now(), 'Asia/Riyadh'))`,
    [uid(), ORG, TR, id, U1],
  );
  await audit(c, "kpi_actual", id, 1);
  return id;
}
async function run(c: any, actualId: string, slot = 1): Promise<string> {
  const id = uid();
  await c.query(
    `INSERT INTO calculation_run (id, organization_id, transformation_id, trigger_kind, trigger_record_type, trigger_record_id, trigger_slot,
       idempotency_key, status, formula_engine_version, kpi_rules_version, started_at)
     VALUES ($1, $2, $3, 'actual_accepted', 'kpi_actual', $4, $5, $6, 'completed', 'mth-formula/1.0.0', 'mth-kpi/1.0.0', now())`,
    [id, ORG, TR, actualId, slot, `kpi.actual_accepted:${actualId}:${slot}`],
  );
  return id;
}
async function evaluation(c: any, runId: string, def: string, per: string, o: Record<string, unknown>): Promise<string> {
  const id = uid();
  const ver = await activeVersionOf(c, def);
  const p = (await c.query(`SELECT period_label FROM reporting_period WHERE id = $1`, [per])).rows[0].period_label;
  const row: Record<string, unknown> = {
    id, organization_id: ORG, transformation_id: TR, calculation_run_id: runId, kpi_definition_id: def, kpi_version_id: ver,
    scope_kind: "transformation", scope_id: TR, reporting_period_id: per, period_label: p, value_basis: "period",
    value: null, value_status: "unknown", value_reason: "kpi.no_accepted_actual", value_source: "none", trend: "unknown",
    calculated_rag: "unknown", deviation: "unknown", threshold_source: "none", explanation_key: "kpi.rag.no_actual", ...o,
  };
  const cols = Object.keys(row);
  await c.query(`INSERT INTO kpi_evaluation (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(row));
  return id;
}
async function evidence(c: any): Promise<string> {
  const id = uid();
  await c.query(
    `INSERT INTO evidence (id, organization_id, transformation_id, kind, title, note_body, owner_user_id, created_by, updated_by)
     VALUES ($1, $2, $3, 'note', 'Synthetic evidence', 'Synthetic note', $4, $4, $4)`,
    [id, ORG, TR, U1],
  );
  await audit(c, "evidence", id, 1);
  return id;
}
async function override(c: any, def: string, per: string, ev: string | null, expires: string | null, o: { createdAt?: string } = {}): Promise<string> {
  const id = uid();
  await c.query(
    `INSERT INTO rag_override (id, organization_id, transformation_id, kpi_definition_id, scope_kind, scope_id, reporting_period_id, override_rag,
       calculated_rag, reason, evidence_id, expires_at, created_at, created_by, updated_by)
     VALUES ($1, $2, $3, $4, 'transformation', $3, $5, 'amber', 'red', 'Synthetic override reason', $6, $7::timestamptz, coalesce($8::timestamptz, now()), $9, $9)`,
    [id, ORG, TR, def, per, ev, expires, o.createdAt ?? null, U1],
  );
  await audit(c, "rag_override", id, 1);
  return id;
}

async function inTx<T>(c: any, fn: () => Promise<T>): Promise<T> {
  await c.query("BEGIN");
  try {
    const r = await fn();
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  }
}

async function main(): Promise<void> {
  const files = readdirSync(migrationsDir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  console.log(`migrations shipped: ${files.length} (${files[0]} .. ${files[files.length - 1]})`);

  // 1. Fresh database.
  await createDb("probe_fresh");
  const applied = await migrate(roleUrl("probe_fresh", "mth_owner"), { dir: migrationsDir });
  report("fresh database: 0001..last apply", applied.length === files.length, `applied ${applied.length}: ${applied.slice(LAST_P3).join(", ")}`);

  // 2. P3-populated database (with approved DG2 T02 trajectories), then P4 on top.
  await createDb("probe_p3");
  const p3Dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "p3-migrations-"));
  for (const f of files.filter((f) => Number(f.slice(0, 4)) <= LAST_P3)) cpSync(join(migrationsDir, f), join(p3Dir, f));
  const p3Applied = await migrate(roleUrl("probe_p3", "mth_owner"), { dir: p3Dir });
  let okOld = "";
  let okNew = "";
  {
    const c = await client("probe_p3");
    await seedP1(c);
    await c.query(`SELECT p3_instantiate_transformation($1, NULL, NULL, 'migration') AS n`, [TR]);
    await c.query("BEGIN");
    const k = await kpiDef(c, "Synthetic DG2 KPI", "count", null, "higher_is_better");
    const out = uid();
    await c.query(`INSERT INTO outcome (id, organization_id, transformation_id, statement, created_by, updated_by) VALUES ($1, $2, $3, 'Synthetic outcome', $4, $4)`, [out, ORG, TR, U1]);
    await audit(c, "outcome", out, 1);
    // Two approved T02 rows of the same KPI: the more recently approved one is copied.
    for (const [when, pts] of [
      ["2026-01-01T00:00:00Z", [{ date: "2026-03-31", value: "10" }]],
      ["2026-02-01T00:00:00Z", [{ date: "2026-03-31", value: "12.5" }, { date: "2026-06-30", value: "20" }]],
    ] as const) {
      const id = uid();
      await c.query(
        `INSERT INTO outcome_kpi (id, organization_id, transformation_id, outcome_id, kpi_definition_id, target_value, target_date, trajectory_points,
           trajectory_status, trajectory_approved_by, trajectory_approved_at, trajectory_approved_version, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, 20, '2026-06-30', $6::jsonb, 'approved', $7, $8::timestamptz, 1, $9, $9)`,
        [id, ORG, TR, out, k, JSON.stringify(pts), U2, when, U1],
      );
      await audit(c, "outcome_kpi", id, 1);
      if (when.startsWith("2026-01")) okOld = id;
      else okNew = id;
    }
    await c.query("COMMIT");
    report("P3 database populated (0001-0027, a synthetic transformation with its P3 starter structure, two approved T02 rows of one KPI)",
      p3Applied.length === LAST_P3, `applied ${p3Applied.length}`);
    await c.end();
  }
  const p4OnTop = await migrate(roleUrl("probe_p3", "mth_owner"), { dir: migrationsDir });
  {
    const c = await client("probe_p3");
    report("P4 over P3 database: 0028+ apply", p4OnTop.length === files.length - LAST_P3, `applied ${p4OnTop.join(", ")}`);
    const t = await c.query(`SELECT id, status, source, source_outcome_kpi_id, approved_by, approved_at, created_by, version, scope_kind, scope_id FROM target_trajectory`);
    const r = t.rows[0];
    report("B01 backfill: exactly one approved target_trajectory, copied from the most recently approved T02 row, approver and time preserved",
      t.rowCount === 1 && r.status === "approved" && r.source === "outcome_kpi_backfill" && r.source_outcome_kpi_id === okNew &&
        r.approved_by === U2 && r.approved_at.toISOString() === "2026-02-01T00:00:00.000Z" && r.created_by === U1 && r.version === 2 && r.scope_id === TR,
      JSON.stringify(t.rows));
    const pts = await c.query(`SELECT point_date::text AS d, expected_value::text AS v FROM target_trajectory_point WHERE target_trajectory_id = $1 ORDER BY point_date`, [r?.id]);
    report("B02 backfill: the points are copied verbatim as numeric(24,6)",
      JSON.stringify(pts.rows) === JSON.stringify([{ d: "2026-03-31", v: "12.500000" }, { d: "2026-06-30", v: "20.000000" }]), JSON.stringify(pts.rows));
    const a = await c.query(`SELECT action, actor_type, source, new_version FROM audit_event WHERE record_type = 'target_trajectory' ORDER BY seq`);
    report("B03 backfill: two audit events (create v1, approve v2), actor system, source migration",
      a.rowCount === 2 && a.rows.every((x: any) => x.actor_type === "system" && x.source === "migration") && a.rows[1].new_version === 2,
      JSON.stringify(a.rows));
    const ok = await c.query(`SELECT count(*)::int AS n FROM outcome_kpi WHERE trajectory_status = 'approved' AND version = 1 AND id IN ($1, $2)`, [okOld, okNew]);
    report("B04 backfill: the DG2 outcome_kpi rows are unchanged", ok.rows[0].n === 2, `unchanged rows ${ok.rows[0].n}`);
    await c.end();
  }

  // 3. Guard probes on the fresh database.
  const c = await client("probe_fresh");
  await seedP1(c);
  await c.query(`SELECT p4_ensure_default_calendar($1, $2, 'probe', 'cli')`, [ORG, U1]);
  await c.query(`SELECT p4_instantiate_transformation($1, $2, 'probe', 'cli')`, [TR, U1]);

  // --- Seeds and permissions.
  const perms = await c.query(`SELECT code, category FROM permission WHERE code IN ('kpi_version.edit','kpi_version.activate','kpi_threshold.configure',
      'target_trajectory.edit','reporting_period.manage','kpi_actual.submit','kpi_actual.accept','rag.override','data_quality.manage') ORDER BY code`);
  report("S01 nine slice A permissions, each 'write' or 'configure'", perms.rowCount === 9 && perms.rows.every((r: any) => ["write", "configure"].includes(r.category)),
    perms.rows.map((r: any) => `${r.code}:${r.category}`).join(", "));
  const adm = await c.query(`SELECT r.code, rp.permission_code FROM role_permission rp JOIN role r ON r.id = rp.role_id
      WHERE (r.kind = 'technical_admin' OR r.code = 'AUD') AND rp.permission_code IN (SELECT code FROM permission WHERE code LIKE 'kpi_%' OR code IN ('target_trajectory.edit','reporting_period.manage','rag.override','data_quality.manage'))`);
  report("S02 no technical admin and no AUD role holds a slice A permission", adm.rowCount === 0, JSON.stringify(adm.rows));
  const seeds = await c.query(`SELECT (SELECT count(*) FROM approval_type WHERE code = 'kpi_version_activation' AND subject_table = 'kpi_version')::int AS at,
      (SELECT count(*) FROM work_item_kind WHERE code IN ('kpi_actual_review', 'kpi_actual_rejected'))::int AS wk`);
  report("S03 approval type kpi_version_activation and two KPI work-item kinds are seeded", seeds.rows[0].at === 1 && seeds.rows[0].wk === 2, JSON.stringify(seeds.rows[0]));

  // --- Reporting periods.
  const P10 = await inTx(c, () => period(c, "2026-10", "2026-10-01", "2026-10-31"));
  await expectFailure(c, "RP01 missing audit fails at COMMIT (reporting_period)", /reporting_period_audit_required/, async () => {
    await c.query(`INSERT INTO reporting_period (id, organization_id, frequency, period_label, period_start, period_end) VALUES ($1, $2, 'monthly', '2026-11', '2026-11-01', '2026-11-30')`, [uid(), ORG]);
  });
  await expectFailure(c, "RP02 overlapping periods of one frequency are refused (lock 730230)", /reporting_period_no_overlap/, async () => {
    await period(c, "2026-10b", "2026-10-15", "2026-11-14");
  });
  await expectFailure(c, "RP03 a week-based period must be week_count x 7 days", /reporting_period_weeks/, async () => {
    await period(c, "2026-P1", "2027-01-01", "2027-01-30", { frequency: "monthly", basis: "weeks", weeks: 4 });
  });
  await expectFailure(c, "RP04 a closed period is final (closed -> open refused)", /reporting_period_status_step/, async () => {
    const id = await period(c, "2025-01", "2025-01-01", "2025-01-31", { status: "closed" });
    await c.query(`UPDATE reporting_period SET status = 'open', closed_at = NULL, version = 4 WHERE id = $1`, [id]);
  });
  await expectFailure(c, "RP05 non-stepping version (reporting_period)", /reporting_period_version_step/, async () => {
    await c.query(`UPDATE reporting_period SET update_due_date = '2026-11-10', version = version + 2 WHERE id = $1`, [P10]);
  });
  await expectSuccess(c, "RP06 4-week and 5-week periods are stored with their week counts (comparability input, REQ-S07-005)", async () => {
    await period(c, "2027-P01", "2027-01-03", "2027-01-30", { basis: "weeks", weeks: 4 });
    await period(c, "2027-P02", "2027-01-31", "2027-03-06", { basis: "weeks", weeks: 5 });
    const r = await c.query(`SELECT period_label, length_days, week_count FROM reporting_period WHERE basis = 'weeks' ORDER BY period_start`);
    return JSON.stringify(r.rows);
  });

  // --- KPI versions (dictionary v2).
  const K1 = await inTx(c, () => kpiDef(c, "Synthetic flow count", "count", null, "higher_is_better"));
  const K2 = await inTx(c, () => kpiDef(c, "Synthetic SAR revenue", "currency", "SAR", "higher_is_better"));
  const KD = await inTx(c, () => kpiDef(c, "Synthetic draft KPI", "count", null, "higher_is_better", "monthly", false));
  await expectFailure(c, "V01 missing audit fails at COMMIT (kpi_version)", /kpi_version_audit_required/, async () => {
    await c.query(`INSERT INTO kpi_version (id, organization_id, transformation_id, kpi_definition_id, version_no, measure_type, value_nature, unit_kind, frequency, submission_route, created_by, updated_by)
      VALUES ($1, $2, $3, $4, 1, 'higher_is_better', 'flow', 'count', 'monthly', 'direct_accept', $5, $5)`, [uid(), ORG, TR, K1, U1]);
  });
  await expectFailure(c, "V02 a flow KPI cannot use weighted_ratio (aggregation fits the value nature; no averaging rule exists)", /kpi_version_aggregation_fits_nature/, async () => {
    await kpiVersion(c, K1, { aggregation_rule: "weighted_ratio" });
  });
  await expectFailure(c, "V03 activation without an aggregation rule is refused (REQ-S07-001, D-089 Q1)", /kpi_version_complete_when_active/, async () => {
    const v = await kpiVersion(c, K1, { aggregation_rule: null });
    await activateVersion(c, v);
  });
  await expectFailure(c, "V04 a version cannot change the KPI's unit or currency (USD on a SAR KPI)", /kpi_version_matches_definition/, async () => {
    await kpiVersion(c, K2, { currency: "USD" });
  });
  await expectFailure(c, "V05 the measure type must fit the KPI polarity (lower_is_better on a higher_is_better KPI)", /kpi_version_measure_fits_polarity/, async () => {
    await kpiVersion(c, K1, { measure_type: "lower_is_better" });
  });
  await expectFailure(c, "V06 activation needs an active KPI definition", /kpi_version_definition_active/, async () => {
    await activateVersion(c, await kpiVersion(c, KD));
  });
  await expectFailure(c, "V07 business_approval policy: activation without an approved approval is refused", /kpi_version_approval_required/, async () => {
    await activateVersion(c, await kpiVersion(c, K1, { definition_approval: "business_approval" }));
  });
  await expectFailure(c, "V08 custom_formula aggregation needs a formula and the business_approval policy", /kpi_version_custom_formula_approved/, async () => {
    await kpiVersion(c, K1, { aggregation_rule: "custom_formula" });
  });
  await expectFailure(c, "V09 acceptable band needs both bounds", /kpi_version_band/, async () => {
    const kb = await kpiDef(c, "Synthetic band", "score", null, "within_band");
    await kpiVersion(c, kb, { measure_type: "acceptable_band", value_nature: "stock", aggregation_rule: "last_value", band_lower: "5" });
  });
  await expectFailure(c, "V10 version numbers step by one", /kpi_version_no_step/, async () => {
    await kpiVersion(c, K1, { version_no: 5 });
  });
  const K1v1 = await inTx(c, () => kpiVersion(c, K1));
  await inTx(c, () => activateVersion(c, K1v1));
  const K2v1 = await inTx(c, () => kpiVersion(c, K2));
  await inTx(c, () => activateVersion(c, K2v1));
  await expectFailure(c, "V11 an active version is immutable", /kpi_version_frozen/, async () => {
    await c.query(`UPDATE kpi_version SET aggregation_rule = 'custom_formula', version = version + 1 WHERE id = $1`, [K1v1]);
  });
  await expectFailure(c, "V12 at most one draft per KPI", /kpi_version_one_draft/, async () => {
    await kpiVersion(c, K1);
    await kpiVersion(c, K1);
  });
  await expectFailure(c, "V13 non-stepping version (kpi_version)", /kpi_version_version_step/, async () => {
    const v = await kpiVersion(c, K1);
    await c.query(`UPDATE kpi_version SET unit_label = 'x', version = 3 WHERE id = $1`, [v]);
  });
  await expectFailure(c, "V14 DG2 kpi_definition: unit change refused once the KPI has a version", /kpi_definition_measure_locked/, async () => {
    await c.query(`UPDATE kpi_definition SET unit_kind = 'score', version = version + 1 WHERE id = $1`, [K1]);
  });
  await expectSuccess(c, "V15 DG2 kpi_definition without a version: the unit can still change (DG2 behaviour unchanged)", async () => {
    await c.query(`UPDATE kpi_definition SET unit_kind = 'score', version = version + 1 WHERE id = $1`, [KD]);
    await audit(c, "kpi_definition", KD, 2);
    return "updated";
  });
  await expectSuccess(c, "V16 binary milestone fits a higher_is_better KPI with a due date and aggregation 'none'", async () => {
    const km = await kpiDef(c, "Synthetic milestone", "other", null, "higher_is_better");
    const v = await kpiVersion(c, km, { measure_type: "binary_milestone", value_nature: "milestone", aggregation_rule: "none", milestone_due_date: "2026-12-31" });
    await activateVersion(c, v);
    return v;
  });

  // --- Formula graph (REQ-S07-011).
  const KA = await inTx(c, () => kpiDef(c, "Synthetic A", "count", null, "higher_is_better"));
  const KB = await inTx(c, () => kpiDef(c, "Synthetic B", "count", null, "higher_is_better"));
  await inTx(c, async () => activateVersion(c, await kpiVersion(c, KB)));
  const formulaVersion = async (def: string, inputs: [string, string][]): Promise<string> => {
    const v = await kpiVersion(c, def, { calculation_method: "formula", formula_expression: inputs.map((i) => i[0]).join(" + ") + " + 1", formula_engine_version: "mth-formula/1.0.0" });
    for (const [name, src] of inputs)
      await c.query(`INSERT INTO kpi_formula_input (id, organization_id, transformation_id, kpi_version_id, variable_name, source_kpi_definition_id, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [uid(), ORG, TR, v, name, src, U1]);
    return v;
  };
  await expectSuccess(c, "F01 KPI A = B + 1 is accepted and activated", async () => {
    const v = await formulaVersion(KA, [["b", KB]]);
    await activateVersion(c, v);
    return v;
  });
  await expectFailure(c, "F02 KPI B = A * 2 after A = B + 1 is rejected as circular (lock 730228)", /kpi_formula_no_cycle/, async () => {
    await formulaVersion(KB, [["a", KA]]);
  });
  await expectFailure(c, "F03 a self-reference is rejected", /kpi_formula_no_cycle/, async () => {
    const KS = await kpiDef(c, "Synthetic self", "count", null, "higher_is_better");
    await formulaVersion(KS, [["s", KS]]);
  });
  await expectFailure(c, "F04 a draft-draft cycle is refused at the second activation", /kpi_formula_no_cycle/, async () => {
    const KC = await kpiDef(c, "Synthetic C", "count", null, "higher_is_better");
    const KE = await kpiDef(c, "Synthetic E", "count", null, "higher_is_better");
    const vc = await formulaVersion(KC, [["e", KE]]);
    const ve = await formulaVersion(KE, [["c", KC]]);
    await activateVersion(c, vc);
    await activateVersion(c, ve);
  });
  await expectFailure(c, "F05 inputs are added only to a draft formula version", /kpi_formula_input_draft_only/, async () => {
    const va = await activeVersionOf(c, KA);
    await c.query(`INSERT INTO kpi_formula_input (id, organization_id, transformation_id, kpi_version_id, variable_name, source_kpi_definition_id, created_by) VALUES ($1, $2, $3, $4, 'k1', $5, $6)`,
      [uid(), ORG, TR, va, K1, U1]);
  });
  await expectFailure(c, "F06 UPDATE on kpi_formula_input is refused (append-only)", /append-only/, async () => {
    await c.query(`UPDATE kpi_formula_input SET input_basis = 'cumulative'`);
  });

  // --- RAG thresholds (REQ-S07-007).
  const threshold = async (def: string, amber: string, red: string): Promise<string> => {
    const id = uid();
    const no = (await c.query(`SELECT coalesce(max(version_no), 0) + 1 AS n FROM kpi_rag_threshold WHERE kpi_definition_id = $1`, [def])).rows[0].n;
    await c.query(`INSERT INTO kpi_rag_threshold (id, organization_id, transformation_id, kpi_definition_id, version_no, tolerance_mode, amber_threshold, red_threshold, reason, created_by, updated_by)
      VALUES ($1, $2, $3, $4, $5, 'relative', $6, $7, 'Synthetic threshold', $8, $8)`, [id, ORG, TR, def, no, amber, red, U1]);
    await audit(c, "kpi_rag_threshold", id, 1);
    return id;
  };
  const T1 = await inTx(c, () => threshold(K1, "0.05", "0.10"));
  await expectFailure(c, "T01 a second active threshold version without superseding the first is refused", /kpi_rag_threshold_one_active/, async () => {
    await threshold(K1, "0.02", "0.08");
  });
  await expectFailure(c, "T02 red threshold below amber is refused", /kpi_rag_threshold_order/, async () => {
    await threshold(K2, "0.10", "0.05");
  });
  await expectFailure(c, "T03 a threshold version is immutable (only active -> superseded)", /kpi_rag_threshold_immutable/, async () => {
    await c.query(`UPDATE kpi_rag_threshold SET red_threshold = 0.2, version = 2 WHERE id = $1`, [T1]);
  });
  await expectSuccess(c, "T04 changing thresholds = supersede the active version and insert the next one", async () => {
    await c.query(`UPDATE kpi_rag_threshold SET status = 'superseded', superseded_at = now(), version = 2 WHERE id = $1`, [T1]);
    await audit(c, "kpi_rag_threshold", T1, 2);
    return await threshold(K1, "0.02", "0.08");
  });

  // --- Target trajectories.
  const trajectory = async (def: string, o: { scopeKind?: string; scopeId?: string } = {}): Promise<string> => {
    const id = uid();
    const no = (await c.query(`SELECT coalesce(max(version_no), 0) + 1 AS n FROM target_trajectory WHERE kpi_definition_id = $1 AND scope_kind = $2 AND scope_id = $3`,
      [def, o.scopeKind ?? "transformation", o.scopeId ?? TR])).rows[0].n;
    await c.query(`INSERT INTO target_trajectory (id, organization_id, transformation_id, kpi_definition_id, scope_kind, scope_id, version_no, created_by, updated_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`, [id, ORG, TR, def, o.scopeKind ?? "transformation", o.scopeId ?? TR, no, U1]);
    await audit(c, "target_trajectory", id, 1);
    return id;
  };
  const point = (t: string, d: string, v: string) =>
    c.query(`INSERT INTO target_trajectory_point (id, organization_id, transformation_id, target_trajectory_id, point_date, expected_value, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [uid(), ORG, TR, t, d, v, U1]);
  const approveTraj = async (t: string, by: string) => {
    await c.query(`UPDATE target_trajectory SET status = 'approved', approved_by = $2, approved_at = now(), approved_record_version = 1, version = 2, updated_by = $2 WHERE id = $1`, [t, by]);
    await audit(c, "target_trajectory", t, 2);
  };
  await expectFailure(c, "TJ01 an approved trajectory needs at least one point", /target_trajectory_points_required/, async () => {
    await approveTraj(await trajectory(K1), U2);
  });
  await expectFailure(c, "TJ02 the creator cannot approve the trajectory", /target_trajectory_approver_not_creator/, async () => {
    const t = await trajectory(K1);
    await point(t, "2026-10-31", "100");
    await approveTraj(t, U1);
  });
  const TJ = await inTx(c, async () => {
    const t = await trajectory(K1);
    await point(t, "2026-10-31", "100");
    await point(t, "2026-12-31", "120");
    await approveTraj(t, U2);
    return t;
  });
  await expectFailure(c, "TJ03 points of an approved trajectory cannot be added", /target_trajectory_point_draft_only/, async () => {
    await point(TJ, "2027-01-31", "130");
  });
  await expectFailure(c, "TJ04 points are never updated (append-only)", /append-only/, async () => {
    await c.query(`UPDATE target_trajectory_point SET expected_value = 1 WHERE target_trajectory_id = $1`, [TJ]);
  });
  await expectFailure(c, "TJ04b points are never deleted (append-only)", /append-only/, async () => {
    await c.query(`DELETE FROM target_trajectory_point WHERE target_trajectory_id = $1`, [TJ]);
  });
  await expectFailure(c, "TJ05 an approved trajectory is immutable", /target_trajectory_frozen/, async () => {
    await c.query(`UPDATE target_trajectory SET interpolation = 'step', version = 3 WHERE id = $1`, [TJ]);
  });
  await expectFailure(c, "TJ06 a scope outside the transformation is refused (another organization's id)", /target_trajectory_scope_valid/, async () => {
    await trajectory(K1, { scopeKind: "business_unit", scopeId: ORG2 });
  });
  await expectFailure(c, "TJ07 at most one approved trajectory per KPI and scope", /target_trajectory_one_approved/, async () => {
    const t = await trajectory(K1);
    await point(t, "2026-10-31", "90");
    await approveTraj(t, U2);
  });

  // --- KPI actuals (REQ-S07-003, -012, -013).
  let A1 = "";
  await expectSuccess(c, "A01 direct-accept entry: one slot, value 1, a direct_accept review and exactly one audit event", async () => {
    A1 = await directActual(c, K1, P10, "95");
    const n = (await c.query(`SELECT count(*)::int AS n FROM audit_event WHERE record_id IN ($1) OR record_type IN ('kpi_actual_value', 'kpi_actual_review')`, [A1])).rows[0].n;
    if (n !== 1) throw new Error(`expected 1 audit event, got ${n}`);
    return `slot ${A1}, audit events for the entry: ${n}`;
  });
  await expectFailure(c, "A02 a second actual for the same KPI, scope and period as a new row is refused (it must be a new value version)", /kpi_actual_slot_key/, async () => {
    await directActual(c, K1, P10, "96");
  });
  await expectSuccess(c, "A03 a second actual for the same slot is stored as value version 2 of the same row", async () => {
    await c.query(`UPDATE kpi_actual SET current_value_no = 2, status = 'draft', submitted_by = NULL, submitted_at = NULL, decided_by = NULL, decided_at = NULL, version = 2 WHERE id = $1`, [A1]);
    await c.query(`INSERT INTO kpi_actual_value (id, organization_id, transformation_id, kpi_actual_id, value_no, kpi_version_id, value, data_as_of, entered_by, business_date)
      VALUES ($1, $2, $3, $4, 2, $5, 97, current_date, $6, current_date)`, [uid(), ORG, TR, A1, await activeVersionOf(c, K1), U1]);
    await audit(c, "kpi_actual", A1, 2);
    const r = (await c.query(`SELECT (SELECT count(*) FROM kpi_actual WHERE kpi_definition_id = $1)::int AS slots, (SELECT count(*) FROM kpi_actual_value WHERE kpi_actual_id = $2)::int AS vals,
      (SELECT accepted_value_no FROM kpi_actual WHERE id = $2) AS acc`, [K1, A1])).rows[0];
    if (r.slots !== 1 || r.vals !== 2 || r.acc !== 1) throw new Error(JSON.stringify(r));
    return `slots ${r.slots}, values ${r.vals}, accepted value still ${r.acc} (draft not used until accepted)`;
  });
  await expectFailure(c, "A04 missing audit fails at COMMIT (kpi_actual)", /kpi_actual_audit_required/, async () => {
    await c.query(`UPDATE kpi_actual SET status = 'draft', version = 3 WHERE id = $1`, [A1]);
  });
  await expectFailure(c, "A05 the slot needs its current value row at COMMIT", /kpi_actual_value_present/, async () => {
    await c.query(`UPDATE kpi_actual SET current_value_no = 3, version = 3 WHERE id = $1`, [A1]);
    await audit(c, "kpi_actual", A1, 3);
  });
  // Review route: K2 version with review.
  const K2v2 = await inTx(c, () => kpiVersion(c, K2, { submission_route: "review", reviewer_party_code: "BO" }));
  await inTx(c, () => activateVersion(c, K2v2));
  const reviewSlot = async (submitter: string, per: string = P10): Promise<string> => {
    const id = uid();
    const pp = (await c.query(`SELECT period_start::text AS s, period_end::text AS e, period_label AS l FROM reporting_period WHERE id = $1`, [per])).rows[0];
    await c.query(`INSERT INTO kpi_actual (id, organization_id, transformation_id, kpi_definition_id, scope_kind, scope_id, reporting_period_id, period_start, period_end,
        period_label, status, route, submitted_by, submitted_at, created_by, updated_by)
      VALUES ($1, $2, $3, $4, 'transformation', $3, $5, $7, $8, $9, 'submitted', 'review', $6, now(), $6, $6)`, [id, ORG, TR, K2, per, submitter, pp.s, pp.e, pp.l]);
    await c.query(`INSERT INTO kpi_actual_value (id, organization_id, transformation_id, kpi_actual_id, value_no, kpi_version_id, value, currency, data_as_of, entered_by, business_date)
      VALUES ($1, $2, $3, $4, 1, $5, 1000000.25, 'SAR', current_date, $6, current_date)`, [uid(), ORG, TR, id, K2v2, submitter]);
    await audit(c, "kpi_actual", id, 1);
    return id;
  };
  const accept = async (id: string, by: string, withReview = true) => {
    if (withReview)
      await c.query(`INSERT INTO kpi_actual_review (id, organization_id, transformation_id, kpi_actual_id, value_no, outcome, decided_by, business_date) VALUES ($1, $2, $3, $4, 1, 'accept', $5, current_date)`,
        [uid(), ORG, TR, id, by]);
    await c.query(`UPDATE kpi_actual SET status = 'accepted', accepted_value_no = 1, decided_by = $2, decided_at = now(), version = 2 WHERE id = $1`, [id, by]);
    await audit(c, "kpi_actual", id, 2);
  };
  await expectFailure(c, "A06 review route: the submitter cannot accept their own actual", /kpi_actual_review_sod/, async () => {
    await accept(await reviewSlot(U1), U1);
  });
  await expectFailure(c, "A07 accepting needs the reviewer's review row (checked at COMMIT)", /kpi_actual_review_present/, async () => {
    await accept(await reviewSlot(U1), U2, false);
  });
  let AR = "";
  await expectSuccess(c, "A08 review route: submitted (not used) -> accepted by another person; one audit event per step", async () => {
    AR = await reviewSlot(U1);
    await accept(AR, U2);
    const n = (await c.query(`SELECT count(*)::int AS n FROM audit_event WHERE record_id = $1`, [AR])).rows[0].n;
    return `audit events on the slot after submit + accept: ${n}`;
  });
  await expectFailure(c, "A09 a value in another currency than the KPI's is refused (USD on SAR)", /kpi_actual_value_currency/, async () => {
    const p = await period(c, "2026-09", "2026-09-01", "2026-09-30");
    await directActual(c, K1, p, "5", { currency: "USD" });
  });
  await expectFailure(c, "A10 a value needs its fields or a missing_reason (flow with numerator refused)", /kpi_actual_value_shape/, async () => {
    const id = uid();
    const p = await period(c, "2026-08", "2026-08-01", "2026-08-31");
    await c.query(`INSERT INTO kpi_actual (id, organization_id, transformation_id, kpi_definition_id, scope_kind, scope_id, reporting_period_id, period_start, period_end, period_label, status, route, created_by, updated_by)
      VALUES ($1, $2, $3, $4, 'transformation', $3, $5, '2026-08-01', '2026-08-31', '2026-08', 'draft', 'direct_accept', $6, $6)`, [id, ORG, TR, K1, p, U1]);
    await c.query(`INSERT INTO kpi_actual_value (id, organization_id, transformation_id, kpi_actual_id, value_no, kpi_version_id, value, numerator, data_as_of, entered_by, business_date)
      VALUES ($1, $2, $3, $4, 1, $5, 1, 1, current_date, $6, current_date)`, [uid(), ORG, TR, id, await activeVersionOf(c, K1), U1]);
  });
  await expectSuccess(c, "A11 an explicitly unavailable value is stored as NULL with its reason (Unknown, never 0)", async () => {
    const p = await period(c, "2026-07", "2026-07-01", "2026-07-31");
    const id = await directActual(c, K1, p, null, { missing: "Source system outage (synthetic)" });
    const v = (await c.query(`SELECT value, missing_reason FROM kpi_actual_value WHERE kpi_actual_id = $1`, [id])).rows[0];
    return JSON.stringify(v);
  });
  await expectFailure(c, "A12 a closed reporting period takes no new actual", /kpi_actual_period_open/, async () => {
    const p = await period(c, "2026-06", "2026-06-01", "2026-06-30", { status: "closed" });
    await directActual(c, K1, p, "1");
  });
  await expectFailure(c, "A13 a monthly KPI is not reported for a weekly period", /kpi_actual_period_frequency/, async () => {
    const p = await period(c, "2026-W40", "2026-09-28", "2026-10-04", { frequency: "weekly" });
    await directActual(c, K1, p, "1");
  });
  await expectFailure(c, "A14 UPDATE on kpi_actual_value is refused (append-only)", /append-only/, async () => {
    await c.query(`UPDATE kpi_actual_value SET comment = 'x' WHERE kpi_actual_id = $1`, [A1]);
  });
  await expectFailure(c, "A15 DELETE on kpi_actual_review is refused (append-only)", /append-only/, async () => {
    await c.query(`DELETE FROM kpi_actual_review WHERE kpi_actual_id = $1`, [AR]);
  });
  await expectFailure(c, "A16 an accepted value cannot become rejected (status step)", /kpi_actual_status_step/, async () => {
    await c.query(`UPDATE kpi_actual SET status = 'rejected', decision_reason = 'x', version = 3 WHERE id = $1`, [AR]);
  });
  await expectFailure(c, "A17 the value number steps by one", /kpi_actual_value_step/, async () => {
    await c.query(`UPDATE kpi_actual SET current_value_no = 3, status = 'draft', submitted_by = NULL, submitted_at = NULL, decided_by = NULL, decided_at = NULL, version = 3 WHERE id = $1`, [AR]);
  });
  await expectFailure(c, "A18 a rejection needs a reason", /kpi_actual_reject_reason/, async () => {
    const id = await reviewSlot(U1, await period(c, "2026-02", "2026-02-01", "2026-02-28"));
    await c.query(`UPDATE kpi_actual SET status = 'rejected', decided_by = $2, decided_at = now(), version = 2 WHERE id = $1`, [id, U2]);
  });
  await expectFailure(c, "A19 values are entered against the KPI's active version only", /kpi_actual_value_active_version/, async () => {
    const draft = await kpiVersion(c, K1);
    const p = await period(c, "2026-05", "2026-05-01", "2026-05-31");
    const id = uid();
    await c.query(`INSERT INTO kpi_actual (id, organization_id, transformation_id, kpi_definition_id, scope_kind, scope_id, reporting_period_id, period_start, period_end, period_label, status, route, created_by, updated_by)
      VALUES ($1, $2, $3, $4, 'transformation', $3, $5, '2026-05-01', '2026-05-31', '2026-05', 'draft', 'direct_accept', $6, $6)`, [id, ORG, TR, K1, p, U1]);
    await c.query(`INSERT INTO kpi_actual_value (id, organization_id, transformation_id, kpi_actual_id, value_no, kpi_version_id, value, data_as_of, entered_by, business_date)
      VALUES ($1, $2, $3, $4, 1, $5, 1, current_date, $6, current_date)`, [uid(), ORG, TR, id, draft, U1]);
  });
  await expectFailure(c, "A20 an actual's scope must be in the transformation", /kpi_actual_scope_valid/, async () => {
    const p = await period(c, "2026-04", "2026-04-01", "2026-04-30");
    await directActual(c, K1, p, "1", { scopeKind: "business_unit", scopeId: ORG2 });
  });

  // --- Calculation runs and evaluations (REQ-S07-006, -013, REQ-S12-006).
  const R1 = await run(c, AR, 1);
  await expectFailure(c, "R01 a second calculation run for the same accepted value is refused (exactly one run)", /calculation_run_trigger_key|calculation_run_idempotency_key/, async () => {
    await run(c, AR, 1);
  });
  await expectFailure(c, "R02 UPDATE on calculation_run is refused (append-only)", /append-only/, async () => {
    await c.query(`UPDATE calculation_run SET evaluation_count = 9 WHERE id = $1`, [R1]);
  });
  await expectFailure(c, "R03 an Unknown value is never green (no value -> no green/amber/red)", /kpi_evaluation_rag_needs_data|kpi_evaluation_unknown_rag/, async () => {
    await evaluation(c, R1, K2, P10, { calculated_rag: "green", deviation: "within" });
  });
  await expectFailure(c, "R04 an Unknown value is never stored as 0", /kpi_evaluation_value_status/, async () => {
    await evaluation(c, R1, K2, P10, { value: "0" });
  });
  await expectFailure(c, "R05 a Stale value keeps its number but its RAG is 'stale', never green", /kpi_evaluation_unknown_rag|kpi_evaluation_rag_needs_data/, async () => {
    await evaluation(c, R1, K2, P10, { value: "5", value_status: "stale", value_reason: "kpi.stale", calculated_rag: "green", deviation: "within", value_source: "entered" });
  });
  let EV = "";
  await expectSuccess(c, "R06 allowed: Unknown with NULL value and RAG unknown; and a red evaluation with value, expected value and configured threshold", async () => {
    await evaluation(c, R1, K2, P10, { value_basis: "cumulative" });
    const th = (await c.query(`SELECT id FROM kpi_rag_threshold WHERE kpi_definition_id = $1 AND status = 'active'`, [K1])).rows[0].id;
    EV = await evaluation(c, R1, K1, P10, { value: "80", value_status: "ok", value_reason: null, value_source: "entered", expected_value: "100", final_target: "120",
      variance: "-20", variance_ratio: "-0.2", calculated_rag: "red", deviation: "adverse", threshold_id: th, threshold_source: "configured",
      target_trajectory_id: TJ, explanation_key: "kpi.rag.below_red_threshold", explanation_params: { thresholdVersion: 2 } });
    return EV;
  });
  await expectFailure(c, "R07 UPDATE on kpi_evaluation is refused (append-only)", /append-only/, async () => {
    await c.query(`UPDATE kpi_evaluation SET calculated_rag = 'green' WHERE id = $1`, [EV]);
  });

  // --- Data-quality findings (REQ-S16-014).
  const finding = async (rule = "stale"): Promise<string> => {
    const id = uid();
    await c.query(`INSERT INTO data_quality_finding (id, organization_id, transformation_id, kpi_definition_id, scope_kind, scope_id, reporting_period_id, rule_code, severity, detected_by_run_id)
      VALUES ($1, $2, $3, $4, 'transformation', $3, $5, $6, 'warning', $7)`, [id, ORG, TR, K1, P10, rule, R1]);
    return id;
  };
  const F1 = await finding();
  await expectFailure(c, "D01 at most one open finding per KPI, scope, period and rule", /data_quality_finding_one_open/, async () => {
    await finding();
  });
  await expectFailure(c, "D02 a person's resolve without its audit event fails at COMMIT", /data_quality_finding_audit_required/, async () => {
    await c.query(`UPDATE data_quality_finding SET status = 'resolved', resolution_note = 'Fixed upstream', resolved_by = $2, resolved_at = now(), version = 2 WHERE id = $1`, [F1, U1]);
  });
  await expectFailure(c, "D03 resolving needs a note", /data_quality_finding_resolution/, async () => {
    await c.query(`UPDATE data_quality_finding SET status = 'resolved', resolved_by = $2, resolved_at = now(), version = 2 WHERE id = $1`, [F1, U1]);
  });
  await expectSuccess(c, "D04 resolve with note and audit", async () => {
    await c.query(`UPDATE data_quality_finding SET status = 'resolved', resolution_note = 'Fixed upstream', resolved_by = $2, resolved_at = now(), version = 2 WHERE id = $1`, [F1, U1]);
    await audit(c, "data_quality_finding", F1, 2);
    return "resolved";
  });
  await expectFailure(c, "D05 a resolved finding is final", /data_quality_finding_status_step/, async () => {
    await c.query(`UPDATE data_quality_finding SET status = 'open', resolution_note = NULL, resolved_by = NULL, resolved_at = NULL, version = 3 WHERE id = $1`, [F1]);
  });
  await expectFailure(c, "D06 non-stepping version (data_quality_finding)", /data_quality_finding_version_step/, async () => {
    const f = await finding("out_of_range");
    await c.query(`UPDATE data_quality_finding SET status = 'dismissed', resolution_note = 'Known', resolved_by = $2, resolved_at = now(), version = 5 WHERE id = $1`, [f, U1]);
  });

  // --- RAG overrides (REQ-S07-009).
  const EVD = await inTx(c, () => evidence(c));
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString();
  await expectFailure(c, "O01 an override without evidence is refused", /not-null|null value in column "evidence_id"/, async () => {
    await override(c, K1, P10, null, in30);
  });
  await expectFailure(c, "O02 an override without expiry is refused", /null value in column "expires_at"/, async () => {
    await override(c, K1, P10, EVD, null);
  });
  await expectFailure(c, "O03 an expiry more than 366 days ahead is refused", /rag_override_expiry_window/, async () => {
    await override(c, K1, P10, EVD, new Date(Date.now() + 400 * 86400000).toISOString());
  });
  await expectFailure(c, "O04 missing audit fails at COMMIT (rag_override)", /rag_override_audit_required/, async () => {
    await c.query(`INSERT INTO rag_override (id, organization_id, transformation_id, kpi_definition_id, scope_kind, scope_id, reporting_period_id, override_rag, calculated_rag, reason, evidence_id, expires_at, created_by, updated_by)
      VALUES ($1, $2, $3, $4, 'transformation', $3, $5, 'green', 'red', 'Synthetic reason', $6, now() + interval '1 day', $7, $7)`, [uid(), ORG, TR, K1, P10, EVD, U1]);
  });
  let O1 = "";
  await expectSuccess(c, "O05 an override records reason, evidence, expiry and the calculated RAG it overrides", async () => {
    O1 = await override(c, K1, P10, EVD, in30);
    return JSON.stringify((await c.query(`SELECT override_rag, calculated_rag, status FROM rag_override WHERE id = $1`, [O1])).rows[0]);
  });
  await expectFailure(c, "O06 a second override in force for the same slot is refused (lock 730229)", /rag_override_one_in_force/, async () => {
    await override(c, K1, P10, EVD, in30);
  });
  await expectFailure(c, "O07 an override is immutable (only active -> revoked)", /rag_override_status_step/, async () => {
    await c.query(`UPDATE rag_override SET override_rag = 'green', version = 2 WHERE id = $1`, [O1]);
  });
  await expectSuccess(c, "O08 after expiry a new override is allowed (an expired override is not in force)", async () => {
    const p = await period(c, "2026-03", "2026-03-01", "2026-03-31");
    await override(c, K1, p, EVD, new Date(Date.now() - 86400000).toISOString(), { createdAt: new Date(Date.now() - 2 * 86400000).toISOString() });
    return await override(c, K1, p, EVD, in30);
  });

  // --- Concurrency: two halves of a formula cycle activated at the same time (lock 730228).
  const KX = await inTx(c, () => kpiDef(c, "Synthetic X", "count", null, "higher_is_better"));
  const KY = await inTx(c, () => kpiDef(c, "Synthetic Y", "count", null, "higher_is_better"));
  const vx = await inTx(c, () => formulaVersion(KX, [["y", KY]]));
  const vy = await inTx(c, () => formulaVersion(KY, [["x", KX]]));
  const c1 = await client("probe_fresh");
  const c2 = await client("probe_fresh");
  await c1.query("BEGIN");
  await activateVersion(c1, vx);
  await c2.query("BEGIN");
  const second = activateVersion(c2, vy).then(
    async () => {
      await c2.query("COMMIT");
      return "committed";
    },
    async (e: any) => {
      await c2.query("ROLLBACK");
      return `${e.constraint ?? ""} ${e.message}`;
    },
  );
  await new Promise((r) => setTimeout(r, 300));
  await c1.query("COMMIT");
  const outcome = await second;
  report("C01 concurrent activation of X = Y + 1 and Y = X + 1: the first commits, the second waits on lock 730228 and is refused", /kpi_formula_no_cycle/.test(outcome), outcome);
  await c1.end();
  await c2.end();

  await c.end();
  console.log(failures === 0 ? "PROBE RESULT: PASS (all guards fired as specified)" : `PROBE RESULT: FAIL (${failures} failing probe(s))`);
  process.exitCode = failures === 0 ? 0 : 1;
}
main().catch((e) => {
  console.error("PROBE ERROR", e);
  process.exit(2);
});
