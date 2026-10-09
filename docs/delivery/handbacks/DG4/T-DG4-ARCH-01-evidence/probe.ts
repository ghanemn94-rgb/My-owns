// T-DG4-ARCH-01 migration and guard probe (solution-architect). Run against a DISPOSABLE cluster only:
//   QA_PG_PORT=<port in 23700-23749> MTH_PORT_POOL=23701-23749 tests/qa/support/with-pg.sh \
//     node --conditions=@mth/source docs/delivery/handbacks/DG4/T-DG4-ARCH-01-evidence/probe.ts
// 1. Fresh database: all migrations 0001..00NN.
// 2. P3-populated database: 0001..0027, synthetic P1-P3 data (a transformation with its P3 starter structure and a DG3
//    fixture-style delegation row), then 0028..00NN on top (backfill check).
// 3. Guard probes on the new P4 tables (ADR-0025, ADR-0026). Every probe states the expected failure; "PASS" means the
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
async function delegate(c: any, from: string, to: string, opts: { status?: string; days?: number } = {}): Promise<string> {
  const id = uid();
  await c.query(
    `INSERT INTO delegation (id, organization_id, delegator_user_id, delegate_user_id, reason_code, effective_from, effective_to, status)
     VALUES ($1, $2, $3, $4, 'absence', now() - interval '1 day', now() + make_interval(days => $5), $6)`,
    [id, ORG, from, to, opts.days ?? 7, opts.status ?? "active"],
  );
  return id;
}
async function matrix(c: any, tr: string, kind: string): Promise<{ id: string; version: number }> {
  const r = await c.query(`SELECT id, version FROM governance_matrix WHERE transformation_id = $1 AND kind = $2`, [tr, kind]);
  return r.rows[0];
}
async function newApproval(c: any, subjectId: string, subjectVersion: number, opts: { due?: string; calendar?: string | null } = {}): Promise<string> {
  const id = uid();
  const cal = opts.calendar === undefined ? (await c.query(`SELECT id FROM business_calendar WHERE organization_id = $1 AND is_default`, [ORG])).rows[0].id : opts.calendar;
  await c.query(
    `INSERT INTO approval (id, organization_id, transformation_id, approval_type, subject_type, subject_id, subject_version, title,
       requested_by, request_business_date, assignee_party_code, assignee_user_id, sla_type, due_date, due_unknown_reason,
       calendar_id, calendar_version, sod_policy, created_by, updated_by)
     VALUES ($1, $2, $3, 'governance_matrix_change', 'governance_matrix', $4, $5, 'Synthetic RACI change', $6,
       p4_business_date(now(), 'Asia/Riyadh'), 'SP', $7, 'working_days', $8::date, NULL, $9, 1, 'requester_excluded', $6, $6)`,
    [id, ORG, TR, subjectId, subjectVersion, U1, U2, opts.due ?? "2099-01-01", cal],
  );
  await audit(c, "approval", id, 1);
  return id;
}
async function decide(c: any, approvalId: string, outcome: string, by: string, opts: { version?: number; round?: number; rationale?: string; defer?: string | null; behalf?: string | null } = {}): Promise<string> {
  const a = (await c.query(`SELECT subject_version, round_no FROM approval WHERE id = $1`, [approvalId])).rows[0];
  const id = uid();
  await c.query(
    `INSERT INTO approval_decision (id, organization_id, transformation_id, approval_id, round_no, outcome, rationale, subject_version,
       decided_by, on_behalf_of_user_id, business_date, defer_until)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, p4_business_date(now(), 'Asia/Riyadh'), $11)`,
    [id, ORG, TR, approvalId, opts.round ?? a.round_no, outcome, opts.rationale ?? "Synthetic rationale", opts.version ?? a.subject_version, by, opts.behalf ?? null, opts.defer ?? null],
  );
  await audit(c, "approval_decision", id, null);
  return id;
}

async function main(): Promise<void> {
  const files = readdirSync(migrationsDir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  console.log(`migrations shipped: ${files.length} (${files[0]} .. ${files[files.length - 1]})`);

  // 1. Fresh database.
  await createDb("probe_fresh");
  const applied = await migrate(roleUrl("probe_fresh", "mth_owner"), { dir: migrationsDir });
  report("fresh database: all migrations apply", applied.length === files.length, `applied ${applied.length}: ${applied.slice(LAST_P3).join(", ")}`);

  // 2. P3-populated database, then P4 on top.
  await createDb("probe_p3");
  const p3Dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "p3-migrations-"));
  for (const f of files.filter((f) => Number(f.slice(0, 4)) <= LAST_P3)) cpSync(join(migrationsDir, f), join(p3Dir, f));
  const p3Applied = await migrate(roleUrl("probe_p3", "mth_owner"), { dir: p3Dir });
  {
    const c = await client("probe_p3");
    await seedP1(c);
    const n1 = await c.query(`SELECT p3_instantiate_transformation($1, NULL, NULL, 'migration') AS n`, [TR]);
    const n2 = await c.query(`SELECT p3_instantiate_transformation($1, NULL, NULL, 'migration') AS n`, [TR2]);
    await delegate(c, U2, U3); // the DG3 fixture shape: no audit event, no new columns
    report(
      "P3 database populated (0001-0027 + 2 synthetic transformations with the P3 starter structure + a DG3-style delegation)",
      p3Applied.length === LAST_P3,
      `applied ${p3Applied.length}, p3 starter rows ${n1.rows[0].n} + ${n2.rows[0].n}`,
    );
    await c.end();
  }
  const p4OnTop = await migrate(roleUrl("probe_p3", "mth_owner"), { dir: migrationsDir });
  {
    const c = await client("probe_p3");
    report("P4 over P3 database: 0028+ apply", p4OnTop.length === files.length - LAST_P3, `applied ${p4OnTop.join(", ")}`);
    const cal = await c.query(`SELECT organization_id, code, timezone, workweek::text AS ww, is_default FROM business_calendar ORDER BY organization_id`);
    report(
      "backfill: one default calendar per organization (Asia/Riyadh, Sun-Thu), no holiday",
      cal.rowCount === 2 && cal.rows.every((r: any) => r.code === "DEFAULT" && r.timezone === "Asia/Riyadh" && r.ww === "{7,1,2,3,4}" && r.is_default) &&
        (await c.query(`SELECT count(*)::int AS n FROM business_calendar_holiday`)).rows[0].n === 0,
      JSON.stringify(cal.rows),
    );
    const counts = await c.query(`SELECT
        (SELECT count(*) FROM governance_matrix)::int AS matrices,
        (SELECT count(*) FROM transformation_decision_right)::int AS t11,
        (SELECT count(*) FROM transformation_raci_deliverable)::int AS t12,
        (SELECT count(*) FROM transformation_raci_assignment)::int AS cells,
        (SELECT count(*) FROM audit_event WHERE source = 'migration' AND actor_type = 'system'
           AND record_type IN ('business_calendar', 'governance_matrix', 'transformation_decision_right', 'transformation_raci_deliverable', 'transformation_raci_assignment'))::int AS audited`);
    const k = counts.rows[0];
    report("backfill: per transformation 2 matrices, 4 T11 rows, 6 T12 deliverables, 36 cells; every row audited as system/migration",
      k.matrices === 4 && k.t11 === 8 && k.t12 === 12 && k.cells === 72 && k.audited === 2 + 4 + 8 + 12 + 72, JSON.stringify(k));
    const d = await c.query(`SELECT version, absence_note, revoked_at FROM delegation`);
    report("the DG3-style delegation row survives unchanged (new columns NULL)", d.rowCount === 1 && d.rows[0].version === 1 && d.rows[0].absence_note === null, JSON.stringify(d.rows));
    const again = await c.query(`SELECT p4_instantiate_transformation($1, NULL, NULL, 'migration') AS n`, [TR]);
    report("p4_instantiate_transformation is idempotent", again.rows[0].n === 0, `second run created ${again.rows[0].n}`);
    const cal2 = await c.query(`SELECT p4_ensure_default_calendar($1, NULL, NULL, 'migration') AS n`, [ORG]);
    report("p4_ensure_default_calendar is idempotent", cal2.rows[0].n === 0, `second run created ${cal2.rows[0].n}`);
    await c.end();
  }

  // 3. Guard probes on the fresh database.
  const c = await client("probe_fresh");
  await seedP1(c);
  await c.query(`SELECT p4_ensure_default_calendar($1, $2, 'probe', 'cli')`, [ORG, U1]);
  const created = await c.query(`SELECT p4_instantiate_transformation($1, $2, 'probe', 'cli') AS n`, [TR, U1]);
  await c.query(`SELECT p4_instantiate_transformation($1, $2, 'probe', 'cli')`, [TR2, U1]);
  report("fresh: p4_instantiate_transformation creates the P2+P3+P4 starter structure", created.rows[0].n > 48, `created ${created.rows[0].n}`);

  // --- Seeds verbatim.
  const t11 = await c.query(`SELECT key, source_decision_en, source_recommend_en, source_approve_en, source_consult_en, source_inform_en, source_sla_en, sla_type, sla_working_days, approve_party_code FROM decision_right_template ORDER BY ordinal`);
  const expectT11 = [
    ["Business scope change", "Transformation Lead", "Sponsor", "Business owners / Finance", "Workstreams", "5 working days"],
    ["Funding reallocation", "Transformation Lead + Finance", "SteerCo", "Initiative owners", "PMO", "Next SteerCo / urgent route"],
    ["Target-state design", "Design owner", "Business owner", "Tech / Ops / CX / Finance", "Transformation Office", "10 working days"],
    ["Go-live / scale", "Initiative owner", "Business owner", "Risk / Tech / CX", "SteerCo", "Per release plan"],
  ];
  report("S01 T11 template = the four B0099 rows verbatim",
    JSON.stringify(t11.rows.map((r: any) => [r.source_decision_en, r.source_recommend_en, r.source_approve_en, r.source_consult_en, r.source_inform_en, r.source_sla_en])) === JSON.stringify(expectT11),
    t11.rows.map((r: any) => `${r.key}:${r.sla_type}/${r.sla_working_days}/${r.approve_party_code}`).join(", "));
  const t11copy = await c.query(`SELECT decision_en, approve_label, sla_label, approve_party_code FROM transformation_decision_right WHERE transformation_id = $1 ORDER BY ordinal`, [TR]);
  report("S02 transformation T11 copy is verbatim; Business scope change approves by SP", t11copy.rowCount === 4 && t11copy.rows[0].decision_en === "Business scope change" && t11copy.rows[0].approve_party_code === "SP",
    JSON.stringify(t11copy.rows[0]));
  const t12 = await c.query(`SELECT d.source_deliverable_en AS d, string_agg(c.value, ' ' ORDER BY g.ordinal) AS v FROM raci_template_deliverable d
     JOIN raci_template_cell c ON c.deliverable_key = d.key JOIN governance_party g ON g.code = c.party_code GROUP BY d.source_deliverable_en, d.ordinal ORDER BY d.ordinal`);
  const expectT12 = [
    ["Charter", "A R C I C I"],
    ["Target Operating Model", "C R A C C C"],
    ["Business Case", "A R C C R C"],
    ["Initiative Delivery", "I C A R C C"],
    ["Benefits Validation", "I C A C R I"],
    ["BAU Handover", "I C A/R R C C"],
  ];
  report("S03 T12 template = B0101 exactly (SP TL BO WL FIN TD)", JSON.stringify(t12.rows.map((r: any) => [r.d, r.v])) === JSON.stringify(expectT12), JSON.stringify(t12.rows));

  // --- Calendar (ADR-0025 §1).
  const calId = uid();
  await expectFailure(c, "G01 business_calendar insert WITHOUT its audit event fails at COMMIT", /business_calendar_audit_required/, async () => {
    await c.query(`INSERT INTO business_calendar (id, organization_id, code, name_en, name_ar, created_by, updated_by) VALUES ($1, $2, 'NOAUDIT', 'x', 'x', $3, $3)`, [uid(), ORG, U1]);
  });
  await expectSuccess(c, "G02 business_calendar insert WITH its audit event commits", async () => {
    await c.query(`INSERT INTO business_calendar (id, organization_id, code, name_en, name_ar, created_by, updated_by) VALUES ($1, $2, 'SECOND', 'Second', 'ثاني', $3, $3)`, [calId, ORG, U1]);
    await audit(c, "business_calendar", calId, 1, ORG, null);
    return calId;
  });
  await expectFailure(c, "G03 business_calendar version must step by exactly 1", /business_calendar_version_step/, async () => {
    await c.query(`UPDATE business_calendar SET name_en = 'x', version = version + 2 WHERE id = $1`, [calId]);
  });
  await expectFailure(c, "G04 workweek with weekday 8 is refused", /business_calendar_workweek_valid/, async () => {
    await c.query(`UPDATE business_calendar SET workweek = '{1,8}', version = version + 1 WHERE id = $1`, [calId]);
  });
  await expectFailure(c, "G05 workweek with a duplicate day is refused", /business_calendar_workweek_valid/, async () => {
    await c.query(`UPDATE business_calendar SET workweek = '{1,1,2}', version = version + 1 WHERE id = $1`, [calId]);
  });
  await expectFailure(c, "G06 an unknown time zone is refused", /business_calendar_timezone_known/, async () => {
    await c.query(`UPDATE business_calendar SET timezone = 'Mars/Olympus', version = version + 1 WHERE id = $1`, [calId]);
  });
  await expectFailure(c, "G07 a second default calendar in one organization is refused", /business_calendar_one_default/, async () => {
    await c.query(`UPDATE business_calendar SET is_default = true, version = version + 1 WHERE id = $1`, [calId]);
  });
  await expectFailure(c, "G08 a holiday range longer than 31 days is refused", /business_calendar_holiday_range/, async () => {
    await c.query(`INSERT INTO business_calendar_holiday (id, organization_id, calendar_id, date_from, date_to, name_en, name_ar, created_by, updated_by)
                   VALUES ($1, $2, $3, '2026-01-01', '2026-03-01', 'x', 'x', $4, $4)`, [uid(), ORG, calId, U1]);
  });
  const bd = await c.query(`SELECT p4_business_date('2026-11-02T20:30:00Z', 'Asia/Riyadh')::text AS a, p4_business_date('2026-11-01T21:30:00Z', 'Asia/Riyadh')::text AS b`);
  report("G09 p4_business_date: 2026-11-02 23:30 Riyadh -> 2026-11-02; 2026-11-02 00:30 Riyadh (2026-11-01T21:30Z) -> 2026-11-02",
    bd.rows[0].a === "2026-11-02" && bd.rows[0].b === "2026-11-02", JSON.stringify(bd.rows[0]));

  // --- Work items and inbox (ADR-0025 §4).
  const wi = uid();
  const insertWorkItem = (id: string, key: string) =>
    c.query(`INSERT INTO work_item (id, organization_id, transformation_id, kind, assignee_user_id, subject_type, subject_id, link_path, message_key, dedupe_key, created_source)
             VALUES ($1, $2, $3, 'kpi_update_due', $4, 'kpi_definition', $5, '/transformations/x/kpis/y', 'workItem.kpiUpdateDue', $6, 'worker')`, [id, ORG, TR, U3, uid(), key]);
  await expectFailure(c, "G10 work_item insert WITHOUT its audit event fails at COMMIT", /work_item_audit_required/, async () => {
    await insertWorkItem(uid(), "probe:noaudit");
  });
  await expectSuccess(c, "G11 work_item insert WITH its audit event commits", async () => {
    await insertWorkItem(wi, "kpi.period_open:K1:2026-10:U3");
    await audit(c, "work_item", wi, 1);
    return wi;
  });
  await expectFailure(c, "G12 a second work_item with the same dedupe key is refused (restart cannot duplicate)", /work_item_dedupe_key/, async () => {
    const id = uid();
    await insertWorkItem(id, "kpi.period_open:K1:2026-10:U3");
    await audit(c, "work_item", id, 1);
  });
  await expectFailure(c, "G13 work_item link_path must be relative (no //host)", /work_item_link_path_relative/, async () => {
    await c.query(`INSERT INTO work_item (id, organization_id, kind, assignee_user_id, subject_type, subject_id, link_path, message_key, dedupe_key, created_source)
                   VALUES ($1, $2, 'kpi_update_due', $3, 'kpi_definition', $4, '//evil.example', 'x', 'k2', 'worker')`, [uid(), ORG, U3, uid()]);
  });
  await expectSuccess(c, "G14 work_item open -> done commits", async () => {
    await c.query(`UPDATE work_item SET status = 'done', completed_at = now(), completed_by = $2, version = 2 WHERE id = $1`, [wi, U3]);
    await audit(c, "work_item", wi, 2);
    return "done";
  });
  await expectFailure(c, "G15 a closed work_item never reopens", /work_item_closed/, async () => {
    await c.query(`UPDATE work_item SET status = 'open', completed_at = NULL, completed_by = NULL, version = 3 WHERE id = $1`, [wi]);
  });
  const nt = uid();
  await expectSuccess(c, "G16 inbox_notification insert and first read commit", async () => {
    await c.query(`INSERT INTO inbox_notification (id, organization_id, transformation_id, recipient_user_id, work_item_id, link_path, message_key, dedupe_key)
                   VALUES ($1, $2, $3, $4, $5, '/my-work', 'inbox.kpiUpdateDue', 'kpi.period_open:K1:2026-10:U3')`, [nt, ORG, TR, U3, wi]);
    await audit(c, "inbox_notification", nt, 1);
    await c.query(`UPDATE inbox_notification SET read_at = now(), version = 2 WHERE id = $1`, [nt]);
    await audit(c, "inbox_notification", nt, 2);
    return nt;
  });
  await expectFailure(c, "G17 inbox_notification read_at is set once", /inbox_notification_read_once/, async () => {
    await c.query(`UPDATE inbox_notification SET read_at = now() + interval '1 hour', version = 3 WHERE id = $1`, [nt]);
  });

  // --- Groups and role mapping (ADR-0026 §1-§2).
  const grp = uid();
  await expectSuccess(c, "G18 access_group and a member commit (audited)", async () => {
    await c.query(`INSERT INTO access_group (id, organization_id, code, name_en, name_ar, owner_user_id, created_by, updated_by) VALUES ($1, $2, 'STEERCO', 'SteerCo', 'اللجنة التوجيهية', $3, $3, $3)`, [grp, ORG, U1]);
    await audit(c, "access_group", grp, 1, ORG, null);
    const m = uid();
    await c.query(`INSERT INTO access_group_member (id, organization_id, group_id, user_id, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $5)`, [m, ORG, grp, U2, U1]);
    await audit(c, "access_group_member", m, 1, ORG, null);
    return grp;
  });
  await expectFailure(c, "G19 a user of another organization cannot join the group", /access_group_member_same_org/, async () => {
    await c.query(`INSERT INTO access_group_member (id, organization_id, group_id, user_id, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $5)`, [uid(), ORG, grp, UX, U1]);
  });
  const rm = uid();
  await expectSuccess(c, "G20 role_mapping BO -> named person commits", async () => {
    await c.query(`INSERT INTO role_mapping (id, organization_id, transformation_id, party_code, target_kind, user_id, created_by, updated_by) VALUES ($1, $2, $3, 'BO', 'user', $4, $5, $5)`, [rm, ORG, TR, U3, U1]);
    await audit(c, "role_mapping", rm, 1);
    return rm;
  });
  await expectFailure(c, "G21 a second active mapping for the same party is refused", /role_mapping_active_key/, async () => {
    await c.query(`INSERT INTO role_mapping (id, organization_id, transformation_id, party_code, target_kind, group_id, created_by, updated_by) VALUES ($1, $2, $3, 'BO', 'group', $4, $5, $5)`, [uid(), ORG, TR, grp, U1]);
  });
  await expectFailure(c, "G22 a mapping names exactly one target", /role_mapping_one_target/, async () => {
    await c.query(`INSERT INTO role_mapping (id, organization_id, transformation_id, party_code, target_kind, user_id, group_id, created_by, updated_by) VALUES ($1, $2, $3, 'STEERCO', 'user', $4, $5, $4, $4)`, [uid(), ORG, TR, U1, grp]);
  });
  await expectFailure(c, "G23 a mapping's target is immutable (end it and map again)", /role_mapping_target_immutable/, async () => {
    await c.query(`UPDATE role_mapping SET user_id = $2, version = 2 WHERE id = $1`, [rm, U2]);
  });

  // --- Delegation (ADR-0026 §3).
  await expectSuccess(c, "G24 delegation A(SP) -> B(BO) commits", async () => (await delegate(c, U2, U3)));
  await expectFailure(c, "G25 delegation B -> A (a loop) is refused", /delegation_no_loop/, async () => {
    await delegate(c, U3, U2);
  });
  await expectSuccess(c, "G26 delegation B(BO) -> C(TL) commits (a chain, not a loop)", async () => (await delegate(c, U3, U1)));
  await expectFailure(c, "G27 delegation C -> A closing A->B->C->A is refused", /delegation_no_loop/, async () => {
    await delegate(c, U1, U2);
  });
  await expectSuccess(c, "G28 a REVOKED delegation C -> A is not part of the graph (inserted revoked)", async () => {
    const id = uid();
    await c.query(`INSERT INTO delegation (id, organization_id, delegator_user_id, delegate_user_id, reason_code, effective_from, effective_to, status, revoked_at, revoked_by, revoke_reason)
                   VALUES ($1, $2, $3, $4, 'other', now() - interval '2 day', now() + interval '2 day', 'revoked', now(), $3, 'Synthetic revoke')`, [id, ORG, U1, U2]);
    return id;
  });
  await expectFailure(c, "G29 delegation version must step by exactly 1 (row guard attached)", /delegation_version_step/, async () => {
    await c.query(`UPDATE delegation SET reason_text = 'x', version = version + 2 WHERE delegator_user_id = $1 AND status = 'active'`, [U2]);
  });
  await expectFailure(c, "G30 revocation fields come together with status revoked", /delegation_revocation_complete/, async () => {
    await c.query(`UPDATE delegation SET revoked_at = now(), version = version + 1 WHERE delegator_user_id = $1 AND status = 'active'`, [U2]);
  });

  // --- RACI (ADR-0026 §7).
  const cell = async (tr: string, deliverable: string, party: string) =>
    (await c.query(`SELECT a.id, a.value, a.version FROM transformation_raci_assignment a JOIN transformation_raci_deliverable d ON d.id = a.deliverable_id
                    WHERE a.transformation_id = $1 AND d.template_key = $2 AND a.party_code = $3`, [tr, deliverable, party])).rows[0];
  const bau = await cell(TR, "bau_handover", "BO");
  report("R01 BAU Handover: BO is 'A/R' and that single cell satisfies the one-accountable guard (the seed committed)", bau.value === "A/R", JSON.stringify(bau));
  await expectFailure(c, "R02 a RACI cell value 'X' is refused", /transformation_raci_assignment_value/, async () => {
    await c.query(`UPDATE transformation_raci_assignment SET value = 'X', version = version + 1 WHERE id = $1`, [bau.id]);
  });
  const charterTl = await cell(TR, "charter", "TL");
  await expectFailure(c, "R03 a deliverable with two A entries is refused at COMMIT", /transformation_raci_one_accountable/, async () => {
    await c.query(`UPDATE transformation_raci_assignment SET value = 'A', version = version + 1 WHERE id = $1`, [charterTl.id]);
    await audit(c, "transformation_raci_assignment", charterTl.id, charterTl.version + 1);
  });
  const charterSp = await cell(TR, "charter", "SP");
  await expectFailure(c, "R04 a deliverable with zero A entries is refused at COMMIT", /transformation_raci_one_accountable/, async () => {
    await c.query(`UPDATE transformation_raci_assignment SET value = 'C', version = version + 1 WHERE id = $1`, [charterSp.id]);
    await audit(c, "transformation_raci_assignment", charterSp.id, charterSp.version + 1);
  });
  await expectSuccess(c, "R05 moving the A from SP to TL in one transaction commits; the template and transformation 2 are unchanged", async () => {
    await c.query(`UPDATE transformation_raci_assignment SET value = 'C', version = version + 1 WHERE id = $1`, [charterSp.id]);
    await audit(c, "transformation_raci_assignment", charterSp.id, charterSp.version + 1);
    await c.query(`UPDATE transformation_raci_assignment SET value = 'A', version = version + 1 WHERE id = $1`, [charterTl.id]);
    await audit(c, "transformation_raci_assignment", charterTl.id, charterTl.version + 1);
    return "moved";
  });
  const tpl = await c.query(`SELECT value FROM raci_template_cell WHERE deliverable_key = 'charter' AND party_code IN ('SP', 'TL') ORDER BY party_code`);
  const other = await cell(TR2, "charter", "SP");
  report("R06 REQ-S10-007: the seeded template (SP=A, TL=R) and transformation 2 (SP=A) are unchanged",
    tpl.rows.map((r: any) => r.value).join(",") === "A,R" && other.value === "A", `template SP,TL = ${tpl.rows.map((r: any) => r.value)}; T2 SP = ${other.value}`);
  await expectSuccess(c, "R07 two A entries commit when the deliverable documents an accountability exception", async () => {
    const d = (await c.query(`SELECT id, version FROM transformation_raci_deliverable WHERE transformation_id = $1 AND template_key = 'business_case'`, [TR])).rows[0];
    await c.query(`UPDATE transformation_raci_deliverable SET accountability_exception = 'Synthetic governance rule GR-01 permits joint accountability', version = version + 1 WHERE id = $1`, [d.id]);
    await audit(c, "transformation_raci_deliverable", d.id, d.version + 1);
    const bo = await cell(TR, "business_case", "BO");
    await c.query(`UPDATE transformation_raci_assignment SET value = 'A', version = version + 1 WHERE id = $1`, [bo.id]);
    await audit(c, "transformation_raci_assignment", bo.id, bo.version + 1);
    return "exception";
  });

  // --- Approvals (ADR-0026 §4, §6).
  let raci = await matrix(c, TR, "raci");
  await expectFailure(c, "A01 an approval requested on a version the subject is not at is refused", /approval_subject_version_current/, async () => {
    await newApproval(c, raci.id, raci.version + 1);
  });
  let ap = "";
  await expectSuccess(c, "A02 approval of the current RACI version commits (pending, round 1)", async () => {
    await c.query(`UPDATE governance_matrix SET status = 'in_approval', version = version + 1 WHERE id = $1`, [raci.id]);
    await audit(c, "governance_matrix", raci.id, raci.version + 1);
    ap = await newApproval(c, raci.id, raci.version + 1);
    return ap;
  });
  raci = await matrix(c, TR, "raci");
  await expectFailure(c, "A03 matrix rows are frozen while the matrix is in approval", /transformation_raci_assignment_matrix_in_approval/, async () => {
    const x = await cell(TR, "charter", "WL");
    await c.query(`UPDATE transformation_raci_assignment SET value = 'C', version = version + 1 WHERE id = $1`, [x.id]);
  });
  await expectFailure(c, "A04 a second open approval for the same subject is refused", /approval_one_open_per_subject/, async () => {
    await newApproval(c, raci.id, raci.version);
  });
  await expectFailure(c, "A05 SoD: the requester cannot decide their own request", /approval_decision_sod/, async () => {
    await decide(c, ap, "approve", U1);
  });
  await expectFailure(c, "A06 SoD: nobody decides on the requester's behalf", /approval_decision_sod/, async () => {
    await decide(c, ap, "approve", U3, { behalf: U1 });
  });
  await expectFailure(c, "A07 a decision without rationale (blank) is refused", /approval_decision_rationale_required/, async () => {
    await decide(c, ap, "approve", U2, { rationale: "   " });
  });
  await expectFailure(c, "A08 a decision on version N-1 is refused (stale)", /approval_decision_stale/, async () => {
    await decide(c, ap, "approve", U2, { version: raci.version - 1 });
  });
  await expectFailure(c, "A09 'defer' without a new date is refused", /approval_decision_defer_date/, async () => {
    await decide(c, ap, "defer", U2);
  });
  await expectFailure(c, "A10 'approved' without a matching decision row is refused (no timer/system approval)", /approval_outcome_needs_decision/, async () => {
    await c.query(`UPDATE approval SET status = 'approved', decided_by = $2, decided_at = now(), version = version + 1 WHERE id = $1`, [ap, U2]);
  });
  await expectSuccess(c, "A11 'request changes' keeps the request open (status changes_requested)", async () => {
    await decide(c, ap, "request_changes", U2);
    await c.query(`UPDATE approval SET status = 'changes_requested', version = version + 1 WHERE id = $1`, [ap]);
    await audit(c, "approval", ap, 2);
    const s = (await c.query(`SELECT status FROM approval WHERE id = $1`, [ap])).rows[0].status;
    return s;
  });
  await expectFailure(c, "A12 a changes_requested approval cannot be decided until resubmitted", /approval_decision_open/, async () => {
    await decide(c, ap, "approve", U2);
  });
  await expectFailure(c, "A13 resubmission must be on a newer subject version", /approval_resubmission/, async () => {
    await c.query(`UPDATE approval SET status = 'pending', round_no = 2, version = version + 1 WHERE id = $1`, [ap]);
  });
  await expectSuccess(c, "A14 resubmission on the new subject version starts round 2", async () => {
    await c.query(`UPDATE governance_matrix SET status = 'draft', version = version + 1 WHERE id = $1`, [raci.id]);
    await audit(c, "governance_matrix", raci.id, raci.version + 1);
    await c.query(`UPDATE governance_matrix SET status = 'in_approval', version = version + 1 WHERE id = $1`, [raci.id]);
    await audit(c, "governance_matrix", raci.id, raci.version + 2);
    await c.query(`UPDATE approval SET status = 'pending', round_no = 2, subject_version = $2, version = version + 1 WHERE id = $1`, [ap, raci.version + 2]);
    await audit(c, "approval", ap, 3);
    return `subject v${raci.version + 2}`;
  });
  raci = await matrix(c, TR, "raci");
  await expectFailure(c, "A15 approving the request after the subject moved to a newer version is refused (stale -> 409 in the API)", /approval_decision_stale/, async () => {
    await c.query(`UPDATE governance_matrix SET status = 'draft', version = version + 1 WHERE id = $1`, [raci.id]);
    await audit(c, "governance_matrix", raci.id, raci.version + 1);
    await decide(c, ap, "approve", U2);
  });
  await expectFailure(c, "A16 escalation of an approval that is not yet overdue is refused", /approval_escalation_overdue/, async () => {
    await c.query(`INSERT INTO approval_escalation (id, organization_id, transformation_id, approval_id, round_no, due_date, level, from_party_code, routing_error)
                   VALUES ($1, $2, $3, $4, 2, '2099-01-01', 1, 'SP', 'no_next_authority')`, [uid(), ORG, TR, ap]);
  });
  await expectSuccess(c, "A17 the approval becomes overdue (its due date is set to yesterday's business date)", async () => {
    await c.query(`UPDATE approval SET due_date = p4_business_date(now(), 'Asia/Riyadh') - 1, version = version + 1 WHERE id = $1`, [ap]);
    await audit(c, "approval", ap, 4);
    return "overdue";
  });
  const esc = async () => {
    const id = uid();
    await c.query(`INSERT INTO approval_escalation (id, organization_id, transformation_id, approval_id, round_no, due_date, level, from_party_code, to_party_code, to_group_id)
                   VALUES ($1, $2, $3, $4, 2, p4_business_date(now(), 'Asia/Riyadh') - 1, 1, 'SP', 'STEERCO', $5)`, [id, ORG, TR, ap, grp]);
    await audit(c, "approval_escalation", id, null);
  };
  await expectSuccess(c, "A18 the overdue approval escalates once; the status stays pending", async () => {
    await esc();
    await c.query(`UPDATE approval SET escalation_level = 1, escalated_to_party_code = 'STEERCO', escalated_to_group_id = $2, version = version + 1 WHERE id = $1`, [ap, grp]);
    await audit(c, "approval", ap, 5);
    return (await c.query(`SELECT status FROM approval WHERE id = $1`, [ap])).rows[0].status;
  });
  await expectFailure(c, "A19 a retried escalation for the same round and due date is refused (exactly once)", /approval_escalation_once/, async () => {
    await esc();
  });
  await expectFailure(c, "A20 an escalation update cannot change the status", /approval_escalation_no_outcome|approval_outcome_needs_decision/, async () => {
    await c.query(`UPDATE approval SET escalation_level = 2, status = 'approved', decided_by = $2, decided_at = now(), version = version + 1 WHERE id = $1`, [ap, U2]);
  });
  await expectFailure(c, "A21 approval_escalation is append-only (UPDATE)", /append-only/, async () => {
    await c.query(`UPDATE approval_escalation SET level = 2 WHERE approval_id = $1`, [ap]);
  });
  // A fresh approval on the RACI's current version, decided by the SP.
  raci = await matrix(c, TR, "raci");
  let ap2 = "";
  await expectSuccess(c, "A22 withdraw the stale request, re-request on the current version, SP approves with rationale", async () => {
    await c.query(`UPDATE approval SET status = 'withdrawn', version = version + 1 WHERE id = $1`, [ap]);
    await audit(c, "approval", ap, 6);
    await c.query(`UPDATE governance_matrix SET status = 'in_approval', version = version + 1 WHERE id = $1`, [raci.id]);
    await audit(c, "governance_matrix", raci.id, raci.version + 1);
    ap2 = await newApproval(c, raci.id, raci.version + 1);
    await decide(c, ap2, "approve", U2);
    await c.query(`UPDATE approval SET status = 'approved', decided_by = $2, decided_at = now(), version = version + 1 WHERE id = $1`, [ap2, U2]);
    await audit(c, "approval", ap2, 2);
    return ap2;
  });
  await expectFailure(c, "A23 an approved approval is final and immutable", /approval_final_immutable/, async () => {
    await c.query(`UPDATE approval SET title = 'changed', version = version + 1 WHERE id = $1`, [ap2]);
  });
  await expectFailure(c, "A24 approval_decision is append-only (UPDATE)", /append-only/, async () => {
    await c.query(`UPDATE approval_decision SET rationale = 'changed' WHERE approval_id = $1`, [ap2]);
  });
  await expectFailure(c, "A25 approval_decision is append-only (DELETE)", /append-only/, async () => {
    await c.query(`DELETE FROM approval_decision WHERE approval_id = $1`, [ap2]);
  });
  await expectFailure(c, "A26 approval insert WITHOUT its audit event fails at COMMIT", /approval_audit_required/, async () => {
    const m2 = await matrix(c, TR, "decision_rights");
    await c.query(`INSERT INTO approval (id, organization_id, transformation_id, approval_type, subject_type, subject_id, subject_version, title, requested_by,
                     request_business_date, assignee_party_code, assignee_user_id, due_unknown_reason, sod_policy, created_by)
                   VALUES ($1, $2, $3, 'governance_matrix_change', 'governance_matrix', $4, $5, 'x', $6, current_date, 'SP', $7, 'no_sla', 'requester_excluded', $6)`, [uid(), ORG, TR, m2.id, m2.version, U1, U2]);
  });
  const rec = await c.query(`SELECT source, outcome, subject_version FROM approval_decision_record WHERE source = 'approval' ORDER BY decided_at`);
  report("A27 approval_decision_record lists the P4 decisions (request changes, then approve) with the request version",
    rec.rowCount === 2 && rec.rows[0].outcome === "changes_requested" && rec.rows[1].outcome === "approved", JSON.stringify(rec.rows));

  // --- Separation of duties of technical administrators (REQ-S10-003).
  await expectFailure(c, "A28 ADM_TECH can never hold approval.decide (0001 SoD trigger)", /role_permission_no_admin_approver/, async () => {
    await c.query(`INSERT INTO role_permission (role_id, permission_code) VALUES ('01920000-0000-7000-8000-00000000000c', 'approval.decide')`);
  });
  const adm = await c.query(`SELECT r.code FROM role_permission rp JOIN role r ON r.id = rp.role_id JOIN permission p ON p.code = rp.permission_code
                             WHERE r.kind = 'technical_admin' AND p.category IN ('business_approval', 'finance_validation')`);
  report("A29 no technical_admin role holds a business_approval or finance_validation permission after 0031", adm.rowCount === 0, `rows ${adm.rowCount}`);

  // --- job_schedule.
  const js = await c.query(`SELECT code, cron, timezone FROM job_schedule ORDER BY code`);
  report("J01 job_schedule seeds (3 rows, Asia/Riyadh, audited)", js.rowCount === 3 && js.rows.every((r: any) => r.timezone === "Asia/Riyadh")
    && (await c.query(`SELECT count(*)::int AS n FROM audit_event WHERE record_type = 'job_schedule'`)).rows[0].n === 3, JSON.stringify(js.rows));
  await expectFailure(c, "J02 job_schedule version must step by exactly 1", /job_schedule_version_step/, async () => {
    await c.query(`UPDATE job_schedule SET enabled = false, version = version + 2 WHERE code = 'approval.escalation_scan'`);
  });

  // --- Concurrency: two connections each insert one half of a loop X -> Y / Y -> X; lock 730224 lets exactly one commit.
  const X = U3;
  const Y = (await c.query(`INSERT INTO app_user (id, organization_id, display_name) VALUES ($1, $2, 'Synthetic WL') RETURNING id`, [uid(), ORG])).rows[0].id;
  await c.query(`UPDATE delegation SET status = 'revoked', revoked_at = now(), revoked_by = $1, revoke_reason = 'probe reset', version = version + 1
                 WHERE status = 'active' AND organization_id = $2`, [U1, ORG]);
  const c1 = await client("probe_fresh");
  const c2 = await client("probe_fresh");
  await c1.query("BEGIN");
  await c2.query("BEGIN");
  await delegate(c1, X, Y);
  const second = delegate(c2, Y, X).then(
    async () => { await c2.query("COMMIT"); return "committed"; },
    async (e: any) => { await c2.query("ROLLBACK"); return `refused: ${e.constraint ?? ""} ${e.message}`; },
  );
  await new Promise((r) => setTimeout(r, 300)); // c2 is now waiting on the advisory lock
  await c1.query("COMMIT");
  const outcome = await second;
  report("C01 concurrent halves of a loop: the first commits, the second waits on lock 730224 and is refused", /delegation_no_loop/.test(outcome), outcome);
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
