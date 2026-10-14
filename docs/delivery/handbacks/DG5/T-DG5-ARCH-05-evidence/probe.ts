// T-DG5-ARCH-05 migration and guard probe (solution-architect). Run against a DISPOSABLE cluster only:
//   QA_PG_PORT=<port in 23700-23749> MTH_PORT_POOL=<rest of 23700-23749> tests/qa/support/with-pg.sh \
//     node --conditions=@mth/source docs/delivery/handbacks/DG5/T-DG5-ARCH-05-evidence/probe.ts
// 1. Fresh database: all migrations 0001..last.
// 2. P4-populated database: 0001..0061 with a synthetic transformation instantiated by the DG3 function, then
//    0062..last on top.
// 3. Guard probes on the slice G and H tables (ADR-0047, ADR-0048). "PASS" means the guard fired (or, for an
//    expectSuccess probe, that the allowed write committed). API-path writes run as mth_app. Fixtures that need deep
//    DG2-DG4 setup (a KPI with versions, periods, a calculation run and an evaluation, report snapshots, a business
//    case, a draft scheme version) are inserted by the superuser with session_replication_role = replica (triggers and
//    foreign keys off for that fixture only; CHECK constraints stay on); the probes themselves run with every trigger
//    on. The harness helpers are copied from the T-DG5-ARCH-04 probe. All data is SYNTHETIC and approves nothing.
//    All data is SYNTHETIC and approves nothing.
import { cpSync, mkdtempSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "../../../../../packages/db/src/migrate.ts";

const pg = createRequire(new URL("../../../../../packages/db/package.json", import.meta.url))("pg");
const admin = process.env.TEST_DATABASE_ADMIN_URL!;
const migrationsDir = new URL("../../../../../packages/db/migrations", import.meta.url).pathname;
const LAST_P4 = 61;
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
const U1 = "01990000-0000-7000-8000-000000000003"; // author / requester
const U2 = "01990000-0000-7000-8000-000000000004"; // reviewer / approver 1
const TR = "01990000-0000-7000-8000-000000000005";
const U3 = "01990000-0000-7000-8000-000000000006"; // approver 2 / condition owner
const ORG2 = "01990000-0000-7000-8000-000000000008";
const UX = "01990000-0000-7000-8000-000000000009"; // user of ORG2
let seq = 100;
const uid = () => `01990000-0000-7000-8000-${(seq++).toString(16).padStart(12, "0")}`;
const H = (n: number) => n.toString(16).padStart(64, "0");

async function seedP1(c: any): Promise<void> {
  await c.query(`INSERT INTO organization (id, code, name_en, name_ar) VALUES ($1, 'SYN-PROBE', 'Synthetic probe org', 'منظمة تجريبية')`, [ORG]);
  await c.query(`INSERT INTO organization (id, code, name_en, name_ar) VALUES ($1, 'SYN-OTHER', 'Synthetic other org', 'منظمة أخرى')`, [ORG2]);
  await c.query(
    `INSERT INTO app_user (id, organization_id, display_name) VALUES ($1, $4, 'Synthetic author'), ($2, $4, 'Synthetic reviewer'), ($3, $4, 'Synthetic owner')`,
    [U1, U2, U3, ORG],
  );
  await c.query(`INSERT INTO app_user (id, organization_id, display_name) VALUES ($1, $2, 'Synthetic other-org user')`, [UX, ORG2]);
  await c.query(`INSERT INTO business_unit (id, organization_id, code, name_en, name_ar) VALUES ($1, $2, 'SYN-BU', 'Synthetic BU', 'وحدة تجريبية')`, [BU, ORG]);
  await c.query(
    `INSERT INTO transformation (id, organization_id, business_unit_id, code, name, mode, current_phase, timezone, currency, created_by, updated_by)
     VALUES ($1, $2, $3, 'SYN-T1', 'Synthetic transformation', 'end_to_end', 'diagnose', 'Asia/Riyadh', 'SAR', $4, $4)`,
    [TR, ORG, BU, U1],
  );
}
async function audit(c: any, recordType: string, id: string, version: number | null): Promise<void> {
  await c.query(
    `INSERT INTO audit_event (id, organization_id, actor_type, actor_user_id, action, record_type, record_id, new_version, source)
     VALUES ($1, $2, 'user', $3, $4, $5, $6, $7, 'cli')`,
    [uid(), ORG, U1, `${recordType}.probe`, recordType, id, version],
  );
}
async function ins(c: any, table: string, row: Record<string, unknown>, withAudit = true, version: number | null = 1): Promise<string> {
  const cols = Object.keys(row);
  await c.query(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(row));
  if (withAudit) await audit(c, table, row.id as string, version);
  return row.id as string;
}
async function updx(c: any, table: string, id: string, set: Record<string, unknown>, o: { audit?: boolean; step?: number } = {}): Promise<void> {
  const v = (await c.query(`SELECT version FROM ${table} WHERE id = $1`, [id])).rows[0].version;
  const nv = v + (o.step ?? 1);
  const cols = Object.keys(set);
  await c.query(`UPDATE ${table} SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(", ")}${cols.length ? ", " : ""}version = ${nv} WHERE id = $1`, [id, ...Object.values(set)]);
  if (o.audit !== false) await audit(c, table, id, nv);
}
/** Superuser fixture insert with triggers and foreign keys off (session_replication_role = replica). */
async function fixture(db: string, table: string, row: Record<string, unknown>): Promise<string> {
  const c = await client(db, null);
  try {
    await c.query("SET session_replication_role = replica");
    const cols = Object.keys(row);
    await c.query(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(row));
  } finally {
    await c.end();
  }
  return row.id as string;
}

// ---- slice G and H fixtures (SYNTHETIC; approves nothing)
const KD = "01990000-0000-7000-8000-0000000000e1"; // KPI definition (quarterly)
const KV1 = "01990000-0000-7000-8000-0000000000e2"; // its active version 1
const KV2 = "01990000-0000-7000-8000-0000000000e3"; // its draft version 2
const PQ1 = "01990000-0000-7000-8000-0000000000e4"; // 2026-Q1 closed
const PQ2 = "01990000-0000-7000-8000-0000000000e5"; // 2026-Q2 open
const PM1 = "01990000-0000-7000-8000-0000000000e6"; // 2026-01 monthly closed
const PQ0 = "01990000-0000-7000-8000-0000000000ec"; // 2025-Q4 closed
const CRUN = "01990000-0000-7000-8000-0000000000e7"; // a DG4 version_activated run
const EVQ1 = "01990000-0000-7000-8000-0000000000e8"; // the DG4 Q1 evaluation
const SN_ISSUED = "01990000-0000-7000-8000-0000000000e9";
const SN_GEN = "01990000-0000-7000-8000-0000000000ea";
const BC = "01990000-0000-7000-8000-0000000000eb";
const MV1 = "01920002-0000-7000-8000-000000000001"; // the seeded methodology version 1 (0011)
const HC1 = "01920005-0860-7000-8000-000000000001"; // the seeded health-check scheme v1 (0086)
const HDRAFT = "01990000-0000-7000-8000-0000000000f1"; // a draft health-check scheme (na + the source bands)
const HDRAFT2 = "01990000-0000-7000-8000-0000000000f2"; // a draft health-check scheme (na, own bands, points basis)
const TR2 = "01990000-0000-7000-8000-000000000007";

function rst(o: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: uid(), organization_id: ORG, transformation_id: TR, kpi_definition_id: KD, kpi_version_id: KV1,
    reason: "Synthetic restatement of Q1", requested_by: U1, period_count: 1, created_by: U1, updated_by: U1, ...o };
}
function rper(restatementId: string, o: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: uid(), organization_id: ORG, transformation_id: TR, restatement_id: restatementId, reporting_period_id: PQ1, period_label: "2026-Q1", ...o };
}
function rrec(restatementId: string, o: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: uid(), organization_id: ORG, transformation_id: TR, restatement_id: restatementId, reporting_period_id: PQ1,
    scope_kind: "transformation", scope_id: TR, value_basis: "period", before_evaluation_id: EVQ1, before_kpi_version_id: KV1,
    before_value: "10", before_value_status: "ok", before_rag: "green", after_value: "12", after_value_status: "ok", after_rag: "green",
    difference: "2", ...o };
}
async function makeRestatement(c: any): Promise<string> {
  const r = rst();
  await ins(c, "kpi_restatement", r);
  await ins(c, "kpi_restatement_period", rper(r.id as string), false);
  return r.id as string;
}
async function submit(c: any, id: string): Promise<void> {
  await ins(c, "kpi_restatement_reconciliation", rrec(id), false);
  await updx(c, "kpi_restatement", id, { status: "submitted", reconciliation_count: 1 });
}
function plan(o: Record<string, unknown> = {}): Record<string, unknown> {
  const tr = (o.transformation_id as string | undefined) ?? TR;
  return { id: uid(), organization_id: ORG, transformation_id: tr, start_date: "2026-10-01", generated_via: "request",
    idempotency_key: `launch_plan:${tr}`, created_by: U1, updated_by: U1, ...o };
}
function task(planId: string, o: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: uid(), organization_id: ORG, transformation_id: TR, plan_id: planId, ordinal: 900 + (seq % 90), template_item_code: null,
    window_code: "days_0_30", task_kind: "custom", title: "Synthetic custom task", start_date: "2026-10-01", due_date: "2026-10-31",
    created_by: U1, updated_by: U1, ...o };
}
function assessment(o: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: uid(), organization_id: ORG, transformation_id: TR, sequence_no: 1, scheme_version_id: HC1, assessment_date: "2026-10-14",
    owner_user_id: U1, created_by: U1, updated_by: U1, ...o };
}
function answer(assessmentId: string, q: number, response: string, o: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: uid(), organization_id: ORG, transformation_id: TR, assessment_id: assessmentId, question_code: `q${String(q).padStart(2, "0")}`,
    response, answered_by: U1, created_by: U1, updated_by: U1, ...o };
}
function action(assessmentId: string, rank: number, o: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: uid(), organization_id: ORG, transformation_id: TR, assessment_id: assessmentId, rank, action_text: `Synthetic action ${rank}`,
    created_by: U1, updated_by: U1, ...o };
}
/** Inserts n answers (yes for the first `yes`, no for the rest) and steps answered_count accordingly. */
async function answerAll(c: any, aid: string, n: number, yes: number): Promise<void> {
  for (let q = 1; q <= n; q++) await ins(c, "health_assessment_answer", answer(aid, q, q <= yes ? "yes" : "no"));
  await updx(c, "health_assessment", aid, { answered_count: n });
}

async function main(): Promise<void> {
  const files = readdirSync(migrationsDir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  console.log(`migrations shipped: ${files.length} (${files[0]} .. ${files[files.length - 1]})`);
  const ids = files.map((f) => Number(f.slice(0, 4)));
  report("G00 slice G/H migrations 0085-0087 present; 0088 left free", [85, 86, 87].every((n) => ids.includes(n)) && !ids.includes(88), `ids >= 80: ${ids.filter((n) => n >= 80).join(",")}`);

  // ---- 1. fresh database
  await createDb("probe_fresh");
  const applied = await migrate(roleUrl("probe_fresh", "mth_owner"), { dir: migrationsDir });
  report("G01 fresh database: 0001..last apply", applied.length === files.length, `applied ${applied.length}: ${applied.slice(-4).join(", ")}`);

  // ---- 2. P4-populated database, then P5 on top
  await createDb("probe_p4");
  const p4Dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "p4-migrations-"));
  for (const f of files.filter((f) => Number(f.slice(0, 4)) <= LAST_P4)) cpSync(join(migrationsDir, f), join(p4Dir, f));
  const p4Applied = await migrate(roleUrl("probe_p4", "mth_owner"), { dir: p4Dir });
  {
    const c = await client("probe_p4");
    await seedP1(c);
    await c.query("BEGIN");
    await c.query(`SELECT p3_instantiate_transformation($1, $2, 'probe', 'cli')`, [TR, U1]);
    await c.query("COMMIT");
    const n = (await c.query(`SELECT count(*)::int AS n FROM transformation WHERE id = $1`, [TR])).rows[0].n;
    report("G02 P4 database populated (0001-0061; a synthetic transformation instantiated by the DG3 function)", p4Applied.length === LAST_P4 && n === 1, `applied ${p4Applied.length}`);
    await c.end();
  }
  await fixture("probe_p4", "kpi_definition", { id: KD, organization_id: ORG, transformation_id: TR, name: "Synthetic P4 KPI", unit_kind: "count", polarity: "higher_is_better", frequency: "quarterly", created_by: U1, updated_by: U1 });
  await fixture("probe_p4", "kpi_version", { id: KV1, organization_id: ORG, transformation_id: TR, kpi_definition_id: KD, version_no: 1, status: "active",
    measure_type: "higher_is_better", value_nature: "flow", unit_kind: "count", frequency: "quarterly", aggregation_rule: "sum", submission_route: "direct_accept",
    activated_at: new Date(), activated_by: U1, created_by: U1, updated_by: U1 });
  await fixture("probe_p4", "calculation_run", { id: CRUN, organization_id: ORG, transformation_id: TR, trigger_kind: "version_activated", trigger_record_type: "kpi_version",
    trigger_record_id: KV1, trigger_slot: 1, idempotency_key: "probe:p4:1", status: "completed", formula_engine_version: "1", kpi_rules_version: "1", started_at: "2020-01-01T00:00:00Z" });
  const onTop = await migrate(roleUrl("probe_p4", "mth_owner"), { dir: migrationsDir });
  {
    const c = await client("probe_p4");
    report("G03 P5 over the P4 database: 0062..last apply", onTop.length === files.length - LAST_P4, `applied ${onTop.length}: ${onTop.slice(-4).join(", ")}`);
    const r = (await c.query(`SELECT count(*)::int AS n FROM calculation_run WHERE id = $1 AND trigger_kind = 'version_activated'`, [CRUN])).rows[0].n;
    const t = (await c.query(`SELECT count(*)::int AS n FROM transformation WHERE id = $1 AND version = 1`, [TR])).rows[0].n;
    report("G04 the DG4 rows are unchanged after the upgrade (a version_activated run, the transformation at version 1)", r === 1 && t === 1, `run ${r}, transformation v1 ${t}`);
    await c.query("BEGIN");
    let ok = true;
    try {
      await c.query(`SET LOCAL ROLE mth_app`);
      await c.query(`INSERT INTO calculation_run (id, organization_id, transformation_id, trigger_kind, trigger_record_type, trigger_record_id, trigger_slot, idempotency_key, status, formula_engine_version, kpi_rules_version, started_at)
                     VALUES ($1, $2, $3, 'version_activated', 'kpi_version', $4, 2, 'probe:p4:2', 'completed', '1', '1', now())`, [uid(), ORG, TR, KV1]);
    } catch (e: any) { ok = false; console.log(e.message); }
    await c.query("ROLLBACK");
    report("G05 a DG4-kind calculation run is still accepted after 0085 widened the closed sets", ok, ok ? "inserted (rolled back)" : "refused");
    await c.end();
  }

  // ---- 3. seeds (fresh database)
  const db = "probe_fresh";
  {
    const c = await client(db);
    const w = (await c.query(`SELECT string_agg(code || ':' || start_day || '-' || end_day || ':' || objective_en, '|' ORDER BY ordinal) AS w FROM launch_window`)).rows[0].w;
    report("S01 three B0134 windows with their objectives verbatim and day ranges 0-30, 31-60, 61-90", w === "days_0_30:0-30:Diagnose & align|days_31_60:31-60:Define & design|days_61_90:61-90:Mobilize & prove", w);
    const t = (await c.query(`SELECT count(*) FILTER (WHERE item_kind = 'action')::int AS a, count(*) FILTER (WHERE item_kind = 'output')::int AS o,
                                     count(*) FILTER (WHERE item_kind = 'day_ninety_test' AND due_day = 90)::int AS d,
                                     string_agg(text_en, '; ' ORDER BY ordinal) FILTER (WHERE window_code = 'days_31_60' AND item_kind = 'action') AS w2 FROM launch_template_item`)).rows[0];
    const src = (await c.query(`SELECT actions_source_en FROM launch_window WHERE code = 'days_31_60'`)).rows[0].actions_source_en;
    report("S02 the template: 17 actions, 15 outputs and the Day-90 test on day 90; the Days 31-60 actions rejoin to the B0134 cell verbatim", t.a === 17 && t.o === 15 && t.d === 1 && `${t.w2}.` === src, `${t.a}/${t.o}/${t.d}: ${t.w2}`);
    const q = (await c.query(`SELECT string_agg(text_en, ' | ' ORDER BY ordinal) AS q, count(*)::int AS n FROM day_ninety_question`)).rows[0];
    report("S03 the six Day-90 questions verbatim (B0136-B0141)", q.n === 6 && q.q.startsWith("Can leaders explain the same case for change and North Star?") && q.q.endsWith("Can the transformation team show what it needs from executives this month?"), q.q.slice(0, 120));
    const s = (await c.query(`SELECT m.status, m.config_kind, m.definition->>'scoreBasis' AS b, (SELECT string_agg(e.stable_key || '=' || coalesce(e.attributes->>'credit', e.attributes->>'minScore'), ',' ORDER BY e.element_type, e.ordinal)
                                FROM methodology_element e WHERE e.methodology_version_id = m.id) AS el, p5_health_scheme_problem(m.id) AS problem
                              FROM methodology_version m WHERE m.id = $1`, [HC1])).rows[0];
    report("S04 health-check scheme v1: published, points basis, four B0152 bands (21,16,10,0), yes=1, no=0; its publish rule holds", s.status === "published" && s.b === "points" && s.el === "b0152_21_25=21,b0152_16_20=16,b0152_10_15=10,b0152_0_9=0,yes=1,no=0" && s.problem === null, JSON.stringify(s));
    const band = (await c.query(`SELECT attributes->>'textEn' AS t FROM methodology_element WHERE methodology_version_id = $1 AND stable_key = 'b0152_0_9'`, [HC1])).rows[0].t;
    report("S05 the 0-9 band text is B0152 verbatim", band === "Transformation is likely being managed as disconnected projects; reset around outcomes and operating model.", band);
    const p = (await c.query(`SELECT string_agg(code || ':' || category, ',' ORDER BY code) AS p FROM permission WHERE code IN
        ('kpi_restatement.request','kpi_restatement.approve','financial_metrics.enable','financial_metrics.define','launch_plan.edit','day_ninety_test.respond','health_check.assess')`)).rows[0].p;
    const appr = (await c.query(`SELECT string_agg(r.code, ',' ORDER BY r.code) AS c FROM role_permission rp JOIN role r ON r.id = rp.role_id WHERE rp.permission_code = 'kpi_restatement.approve'`)).rows[0].c;
    const none = (await c.query(`SELECT count(*)::int AS n FROM role_permission rp JOIN role r ON r.id = rp.role_id JOIN permission p ON p.code = rp.permission_code
        WHERE p.code IN ('kpi_restatement.request','kpi_restatement.approve','financial_metrics.define','launch_plan.edit','day_ninety_test.respond','health_check.assess') AND (r.code = 'AUD' OR r.kind = 'technical_admin')`)).rows[0].n;
    report("S06 seven permissions; kpi_restatement.approve is the only business approval (SP, BO, FIN); AUD and technical admins hold none but the extension switch", p === "day_ninety_test.respond:write,financial_metrics.define:write,financial_metrics.enable:configure,health_check.assess:write,kpi_restatement.approve:business_approval,kpi_restatement.request:write,launch_plan.edit:write" && appr === "BO,FIN,SP" && none === 0, `${p}; approvers ${appr}; aud/tech ${none}`);
    const k = (await c.query(`SELECT string_agg(code, ',' ORDER BY code) AS k FROM work_item_kind WHERE code IN ('kpi_restatement_to_decide','report_reissue_offer','day_ninety_test_due')`)).rows[0].k;
    const j = (await c.query(`SELECT count(*)::int AS n FROM job_schedule s JOIN audit_event a ON a.record_id = s.id AND a.action = 'job_schedule.create' WHERE s.code = 'launch.day_ninety_tests' AND s.timezone = 'Asia/Riyadh'`)).rows[0].n;
    report("S07 three work-item kinds and the audited launch.day_ninety_tests schedule", k === "day_ninety_test_due,kpi_restatement_to_decide,report_reissue_offer" && j === 1, `${k}; schedule ${j}`);
    await seedP1(c);
    await c.query(
      `INSERT INTO transformation (id, organization_id, business_unit_id, code, name, mode, current_phase, timezone, currency, created_by, updated_by)
       VALUES ($1, $2, $3, 'SYN-T2', 'Synthetic transformation 2', 'end_to_end', 'diagnose', 'Asia/Riyadh', 'SAR', $4, $4)`,
      [TR2, ORG, BU, U1],
    );
    await c.end();
  }
  // KPI fixtures (deep DG4 setup; replica).
  await fixture(db, "kpi_definition", { id: KD, organization_id: ORG, transformation_id: TR, name: "Synthetic KPI", unit_kind: "count", polarity: "higher_is_better", frequency: "quarterly", created_by: U1, updated_by: U1 });
  await fixture(db, "kpi_version", { id: KV1, organization_id: ORG, transformation_id: TR, kpi_definition_id: KD, version_no: 1, status: "active",
    measure_type: "higher_is_better", value_nature: "flow", unit_kind: "count", frequency: "quarterly", aggregation_rule: "sum", submission_route: "direct_accept",
    target_value: "12", activated_at: new Date(), activated_by: U1, created_by: U1, updated_by: U1 });
  await fixture(db, "kpi_version", { id: KV2, organization_id: ORG, transformation_id: TR, kpi_definition_id: KD, version_no: 2, status: "draft",
    measure_type: "higher_is_better", value_nature: "flow", unit_kind: "count", frequency: "quarterly", aggregation_rule: "sum", submission_route: "direct_accept",
    change_reason: "Synthetic target change", target_value: "15", created_by: U1, updated_by: U1 });
  for (const [id, freq, label, status, start, end] of [
    [PQ0, "quarterly", "2025-Q4", "closed", "2025-10-01", "2025-12-31"],
    [PQ1, "quarterly", "2026-Q1", "closed", "2026-01-01", "2026-03-31"],
    [PQ2, "quarterly", "2026-Q2", "open", "2026-04-01", "2026-06-30"],
    [PM1, "monthly", "2026-01", "closed", "2026-01-01", "2026-01-31"],
  ] as const) {
    await fixture(db, "reporting_period", { id, organization_id: ORG, frequency: freq, period_label: label, period_start: start, period_end: end, status,
      opened_at: new Date(), closed_at: status === "closed" ? new Date() : null });
  }
  await fixture(db, "calculation_run", { id: CRUN, organization_id: ORG, transformation_id: TR, trigger_kind: "version_activated", trigger_record_type: "kpi_version",
    trigger_record_id: KV1, trigger_slot: 1, idempotency_key: "probe:1", status: "completed", formula_engine_version: "1", kpi_rules_version: "1", started_at: "2020-01-01T00:00:00Z" });
  await fixture(db, "kpi_evaluation", { id: EVQ1, organization_id: ORG, transformation_id: TR, calculation_run_id: CRUN, kpi_definition_id: KD, kpi_version_id: KV1,
    scope_kind: "transformation", scope_id: TR, reporting_period_id: PQ1, period_label: "2026-Q1", value_basis: "period", value: "10", value_status: "ok",
    value_source: "entered", trend: "flat", calculated_rag: "green", deviation: "within", threshold_source: "default", explanation_key: "kpi.rag.probe" });
  const snapRow = (id: string, status: string) => ({ id, organization_id: ORG, transformation_id: TR, definition_code: "registers", subject_type: "transformation", subject_id: TR,
    as_of: new Date(), content_schema_version: 1, content: JSON.stringify({ sections: [] }), content_sha256: H(1), methodology_version_id: MV1, approval_state: "not_applicable",
    provisional_value_count: 0, unknown_value_count: 0, series_id: id, status, issue_version: status === "issued" ? 1 : null, issued_at: status === "issued" ? new Date() : null,
    issued_by: status === "issued" ? U1 : null, created_by: U1, updated_by: U1 });
  await fixture(db, "report_snapshot", snapRow(SN_ISSUED, "issued"));
  await fixture(db, "report_snapshot", snapRow(SN_GEN, "generated"));
  await fixture(db, "business_case", { id: BC, organization_id: ORG, transformation_id: TR, code: "BC-01", level: "transformation", title: "Synthetic business case", currency: "SAR", created_by: U1, updated_by: U1 });

  const c = await client(db, "mth_app");

  // ---- KPI restatement (ADR-0047 §2-§3)
  let R1 = "";
  await expectFailure(c, "KR01 a restatement without its audit event fails at COMMIT", /kpi_restatement_audit_required/, async () => {
    const r = rst();
    await ins(c, "kpi_restatement", r, false);
    await ins(c, "kpi_restatement_period", rper(r.id as string), false);
  });
  await expectSuccess(c, "KR02 a draft restatement with one closed period (audited) commits", async () => { R1 = await makeRestatement(c); return R1; });
  await expectFailure(c, "KR03 a restatement of a draft (not approved) version is refused", /kpi_restatement_version_approved/, async () => {
    const r = rst({ kpi_version_id: KV2 });
    await ins(c, "kpi_restatement", r);
  });
  await expectFailure(c, "KR04 a second restatement in progress for the same KPI is refused", /kpi_restatement_one_open_key/, async () => { await makeRestatement(c); });
  await expectFailure(c, "KR05 period_count different from the selected periods fails at COMMIT", /kpi_restatement_counts/, async () => {
    await updx(c, "kpi_restatement", R1, { reason: "Synthetic restatement, reworded" });
    await ins(c, "kpi_restatement_period", rper(R1, { reporting_period_id: PQ0, period_label: "2025-Q4" }), false);
  });
  await expectFailure(c, "KR06 submitting without a reconciliation fails at COMMIT", /kpi_restatement_reconciled/, async () => {
    await updx(c, "kpi_restatement", R1, { status: "submitted" });
  });
  await expectFailure(c, "KR07 a non-stepping version is refused", /kpi_restatement_version_step/, async () => {
    await updx(c, "kpi_restatement", R1, { reason: "Synthetic" }, { step: 2 });
  });
  await expectFailure(c, "KR08 the restated version never changes", /kpi_restatement_identity_fixed/, async () => {
    await updx(c, "kpi_restatement", R1, { kpi_version_id: KV2 });
  });
  await expectFailure(c, "KR09 draft -> approved is not an allowed transition", /kpi_restatement_status_step/, async () => {
    await updx(c, "kpi_restatement", R1, { status: "approved", decided_by: U2, decided_at: new Date(), authority_permission: "kpi_restatement.approve", authority_role_code: "BO" });
  });
  await expectFailure(c, "KP01 an open period cannot be restated", /kpi_restatement_period_closed/, async () => {
    await updx(c, "kpi_restatement", R1, { period_count: 2 });
    await ins(c, "kpi_restatement_period", rper(R1, { reporting_period_id: PQ2, period_label: "2026-Q2" }), false);
  });
  await expectFailure(c, "KP02 a closed period of another frequency cannot be restated", /kpi_restatement_period_closed/, async () => {
    await updx(c, "kpi_restatement", R1, { period_count: 2 });
    await ins(c, "kpi_restatement_period", rper(R1, { reporting_period_id: PM1, period_label: "2026-01" }), false);
  });
  await expectFailure(c, "KC01 a reconciliation difference that is not after - before is refused", /kpi_restatement_reconciliation_difference/, async () => {
    await ins(c, "kpi_restatement_reconciliation", rrec(R1, { difference: "3" }), false);
  });
  await expectFailure(c, "KC02 an unknown before-value with a number is refused (Unknown is never a number)", /kpi_restatement_reconciliation_before/, async () => {
    await ins(c, "kpi_restatement_reconciliation", rrec(R1, { before_value_status: "unknown", before_rag: "unknown", difference: null }), false);
  });
  await expectFailure(c, "KC03 a reconciliation row written without the submission fails at COMMIT", /kpi_restatement_counts/, async () => {
    await ins(c, "kpi_restatement_reconciliation", rrec(R1), false);
  });
  await expectSuccess(c, "KC04 the submission writes the reconciliation in the same transaction (submitted_at = its time)", async () => {
    await submit(c, R1);
    const r = (await c.query(`SELECT r.status, r.submitted_at = c.created_at AS same FROM kpi_restatement r JOIN kpi_restatement_reconciliation c ON c.restatement_id = r.id WHERE r.id = $1`, [R1])).rows[0];
    return JSON.stringify(r);
  });
  await expectFailure(c, "KC05 no reconciliation row can be added after the submission", /kpi_restatement_reconciliation_at_submit/, async () => {
    await ins(c, "kpi_restatement_reconciliation", rrec(R1, { scope_id: TR2 }), false);
  });
  await expectFailure(c, "KP03 no period can be added after the submission", /kpi_restatement_period_draft_only/, async () => {
    await ins(c, "kpi_restatement_period", rper(R1, { reporting_period_id: PQ0, period_label: "2025-Q4" }), false);
  });
  await expectFailure(c, "KP04 mth_app cannot UPDATE a selected period (no grant)", /permission denied/, async () => {
    await c.query(`UPDATE kpi_restatement_period SET period_label = 'x' WHERE restatement_id = $1`, [R1]);
  });
  await expectFailure(c, "KC06 DELETE of a reconciliation row is refused", /permission denied|append-only/, async () => {
    await c.query(`DELETE FROM kpi_restatement_reconciliation WHERE restatement_id = $1`, [R1]);
  });
  await expectFailure(c, "KR10 the requester cannot decide their own restatement (SoD)", /kpi_restatement_sod/, async () => {
    await updx(c, "kpi_restatement", R1, { status: "approved", decided_by: U1, decided_at: new Date(), authority_permission: "kpi_restatement.approve", authority_role_code: "BO" });
  });
  await expectFailure(c, "KR11 an approval without its recorded authority is refused", /kpi_restatement_decision_complete/, async () => {
    await updx(c, "kpi_restatement", R1, { status: "approved", decided_by: U2, decided_at: new Date() });
  });
  await expectFailure(c, "KR12 a rejection without a note is refused", /kpi_restatement_reject_note/, async () => {
    await updx(c, "kpi_restatement", R1, { status: "rejected", decided_by: U2, decided_at: new Date(), authority_permission: "kpi_restatement.approve", authority_role_code: "BO" });
  });
  await expectFailure(c, "CR01 a restatement run for a restatement that is not approved is refused", /calculation_run_restatement_approved/, async () => {
    await ins(c, "calculation_run", { id: uid(), organization_id: ORG, transformation_id: TR, trigger_kind: "restatement_approved", trigger_record_type: "kpi_restatement",
      trigger_record_id: R1, trigger_slot: 1, idempotency_key: `kpi_restatement:${R1}`, status: "completed", formula_engine_version: "1", kpi_rules_version: "1", started_at: "2020-01-01T00:00:00Z" }, false, null);
  });
  await expectSuccess(c, "KR13 approval by another person with the recorded authority commits", async () => {
    await updx(c, "kpi_restatement", R1, { status: "approved", decided_by: U2, decided_at: new Date(), authority_permission: "kpi_restatement.approve", authority_role_code: "BO" });
    return "approved";
  });
  await expectFailure(c, "KR14 the decision cannot be rewritten after it is recorded", /kpi_restatement_decision_frozen/, async () => {
    await updx(c, "kpi_restatement", R1, { decided_by: U3 });
  });
  await expectFailure(c, "KR15 applied needs the completed restatement run", /kpi_restatement_applied_run/, async () => {
    await updx(c, "kpi_restatement", R1, { status: "applied", applied_at: new Date(), calculation_run_id: CRUN });
  });
  await expectFailure(c, "CR02 a restatement run with another idempotency key is refused", /calculation_run_restatement_approved/, async () => {
    await ins(c, "calculation_run", { id: uid(), organization_id: ORG, transformation_id: TR, trigger_kind: "restatement_approved", trigger_record_type: "kpi_restatement",
      trigger_record_id: R1, trigger_slot: 1, idempotency_key: "something-else", status: "completed", formula_engine_version: "1", kpi_rules_version: "1", started_at: "2020-01-01T00:00:00Z" }, false, null);
  });
  await expectFailure(c, "CR03 a restatement kind with another record type is refused by the widened pair CHECK", /calculation_run_trigger_pair/, async () => {
    await ins(c, "calculation_run", { id: uid(), organization_id: ORG, transformation_id: TR, trigger_kind: "restatement_approved", trigger_record_type: "kpi_version",
      trigger_record_id: R1, trigger_slot: 1, idempotency_key: `kpi_restatement:${R1}`, status: "completed", formula_engine_version: "1", kpi_rules_version: "1", started_at: "2020-01-01T00:00:00Z" }, false, null);
  });
  const RUN = uid();
  const evalRow = (o: Record<string, unknown> = {}) => ({ id: uid(), organization_id: ORG, transformation_id: TR, calculation_run_id: RUN, kpi_definition_id: KD, kpi_version_id: KV1,
    scope_kind: "transformation", scope_id: TR, reporting_period_id: PQ1, period_label: "2026-Q1", value_basis: "period", value: "12", value_status: "ok",
    value_source: "entered", trend: "flat", calculated_rag: "green", deviation: "within", threshold_source: "default", explanation_key: "kpi.rag.probe", ...o });
  const runRow = () => ({ id: RUN, organization_id: ORG, transformation_id: TR, trigger_kind: "restatement_approved", trigger_record_type: "kpi_restatement",
    trigger_record_id: R1, trigger_slot: 1, idempotency_key: `kpi_restatement:${R1}`, status: "completed", formula_engine_version: "1", kpi_rules_version: "1", started_at: "2020-01-01T00:00:00Z" });
  await expectFailure(c, "EV01 a restatement run cannot evaluate an unselected period", /kpi_evaluation_restatement_scope/, async () => {
    await ins(c, "calculation_run", runRow(), false, null);
    await ins(c, "kpi_evaluation", evalRow({ reporting_period_id: PQ0, period_label: "2025-Q4" }), false, null);
  });
  await expectFailure(c, "EV02 a restatement run evaluates the restated KPI only with the restated version", /kpi_evaluation_restatement_scope/, async () => {
    await ins(c, "calculation_run", runRow(), false, null);
    await ins(c, "kpi_evaluation", evalRow({ kpi_version_id: KV2 }), false, null);
  });
  await expectSuccess(c, "CR04 + EV03 + KR16 one run for the approved restatement, its Q1 evaluation, then applied", async () => {
    await ins(c, "calculation_run", runRow(), false, null);
    await ins(c, "kpi_evaluation", evalRow(), false, null);
    await updx(c, "kpi_restatement", R1, { status: "applied", applied_at: new Date(), calculation_run_id: RUN });
    const n = (await c.query(`SELECT count(*)::int AS n FROM kpi_evaluation WHERE kpi_definition_id = $1 AND reporting_period_id = $2`, [KD, PQ1])).rows[0].n;
    return `Q1 evaluations ${n} (the DG4 one is kept beside the restated one)`;
  });
  await expectFailure(c, "CR05 a second run for the same restatement is refused (exactly once)", /calculation_run_restatement_approved|calculation_run_trigger_key|calculation_run_idempotency_key/, async () => {
    await ins(c, "calculation_run", { ...runRow(), id: uid() }, false, null);
  });
  await expectFailure(c, "EV04 mth_app cannot UPDATE the DG4 Q1 evaluation (no grant)", /permission denied/, async () => {
    await c.query(`UPDATE kpi_evaluation SET value = 99 WHERE id = $1`, [EVQ1]);
  });
  await expectSuccess(c, "EV05 a DG4-kind run still evaluates without the restatement guard", async () => {
    const run = uid();
    await ins(c, "calculation_run", { id: run, organization_id: ORG, transformation_id: TR, trigger_kind: "actual_accepted", trigger_record_type: "kpi_actual",
      trigger_record_id: uid(), trigger_slot: 1, idempotency_key: `probe:${run}`, status: "completed", formula_engine_version: "1", kpi_rules_version: "1", started_at: "2020-01-01T00:00:00Z" }, false, null);
    await ins(c, "kpi_evaluation", evalRow({ calculation_run_id: run, reporting_period_id: PQ2, period_label: "2026-Q2" }), false, null);
    return "ok";
  });
  await expectFailure(c, "KR17 an applied restatement is final", /kpi_restatement_status_step/, async () => {
    await updx(c, "kpi_restatement", R1, { status: "withdrawn", withdrawn_at: new Date(), withdrawn_by: U1 });
  });
  await expectSuccess(c, "KO01 a reissue offer for the issued snapshot of an applied restatement commits", async () => {
    await ins(c, "kpi_restatement_reissue_offer", { id: uid(), organization_id: ORG, transformation_id: TR, restatement_id: R1, snapshot_id: SN_ISSUED, series_id: SN_ISSUED }, false, null);
    const s = (await c.query(`SELECT status, issue_version FROM report_snapshot WHERE id = $1`, [SN_ISSUED])).rows[0];
    return `snapshot unchanged: ${JSON.stringify(s)}`;
  });
  await expectFailure(c, "KO02 an offer for a generated (not issued) snapshot is refused", /kpi_restatement_reissue_offer_valid/, async () => {
    await ins(c, "kpi_restatement_reissue_offer", { id: uid(), organization_id: ORG, transformation_id: TR, restatement_id: R1, snapshot_id: SN_GEN, series_id: SN_GEN }, false, null);
  });
  await expectFailure(c, "KO03 a second offer of the same snapshot for the same restatement is refused (exactly once)", /kpi_restatement_reissue_offer_key/, async () => {
    await ins(c, "kpi_restatement_reissue_offer", { id: uid(), organization_id: ORG, transformation_id: TR, restatement_id: R1, snapshot_id: SN_ISSUED, series_id: SN_ISSUED }, false, null);
  });
  await expectFailure(c, "KO04 mth_app cannot UPDATE an offer (no grant)", /permission denied/, async () => {
    await c.query(`UPDATE kpi_restatement_reissue_offer SET series_id = series_id WHERE restatement_id = $1`, [R1]);
  });
  let R2 = "";
  await expectSuccess(c, "KR18 after the first is applied, a new restatement of the KPI can start; it is submitted", async () => {
    R2 = await makeRestatement(c);
    return R2;
  });
  await expectSuccess(c, "KR19 submit, then withdraw a submitted restatement", async () => {
    await submit(c, R2);
    await updx(c, "kpi_restatement", R2, { status: "withdrawn", withdrawn_at: new Date(), withdrawn_by: U1 });
    return "withdrawn";
  });

  // ---- financial metrics (ADR-0047 §5)
  const FS = uid();
  const setting = (o: Record<string, unknown> = {}) => ({ id: uid(), organization_id: ORG, created_by: U1, updated_by: U1, ...o });
  await expectFailure(c, "FS01 a setting without its audit event fails at COMMIT", /financial_metric_setting_audit_required/, async () => { await ins(c, "financial_metric_setting", setting(), false); });
  await expectSuccess(c, "FS02 the organization's setting is created disabled by default", async () => {
    await ins(c, "financial_metric_setting", setting({ id: FS }));
    return JSON.stringify((await c.query(`SELECT enabled, discount_rate FROM financial_metric_setting WHERE id = $1`, [FS])).rows[0]);
  });
  await expectFailure(c, "FS03 one setting per organization", /financial_metric_setting_org_key/, async () => { await ins(c, "financial_metric_setting", setting()); });
  await expectFailure(c, "FS04 incomplete assumptions (a timing without the methodology note and period basis) are refused", /financial_metric_setting_assumptions_complete/, async () => {
    await updx(c, "financial_metric_setting", FS, { timing: "end_of_period" });
  });
  await expectFailure(c, "FS05 a discount rate without the assumptions is refused", /financial_metric_setting_assumptions_complete/, async () => {
    await updx(c, "financial_metric_setting", FS, { discount_rate: "0.100000" });
  });
  await expectFailure(c, "FS06 a discount rate above 1 is refused", /financial_metric_setting_discount_rate_check/, async () => {
    await updx(c, "financial_metric_setting", FS, { methodology_note: "Discounted net cash flow", timing: "beginning_of_period", period_basis: "annual", discount_rate: "1.500000", assumptions_set_by: U1, assumptions_set_at: new Date() });
  });
  await expectSuccess(c, "FS07 enabled with the assumptions and a 10% discount rate (decimal 0.100000)", async () => {
    await updx(c, "financial_metric_setting", FS, { enabled: true, enabled_changed_by: U1, enabled_changed_at: new Date(), methodology_note: "Discounted net cash flow", timing: "beginning_of_period", period_basis: "annual", discount_rate: "0.100000", assumptions_set_by: U1, assumptions_set_at: new Date() });
    return JSON.stringify((await c.query(`SELECT discount_rate::text AS r FROM financial_metric_setting WHERE id = $1`, [FS])).rows[0]);
  });
  await expectFailure(c, "FS08 a non-stepping version is refused", /financial_metric_setting_version_step/, async () => { await updx(c, "financial_metric_setting", FS, { enabled: false }, { step: 0 }); });
  const SET = uid();
  const cfRow = (rev: number, t: number, o: Record<string, unknown> = {}) => ({ id: uid(), organization_id: ORG, transformation_id: TR, set_id: SET, revision: rev, period_index: t,
    outflow: t === 0 ? "1000.0000" : "0", inflow: ["0", "300", "400", "500"][t] ?? "0", ...o });
  await expectFailure(c, "CF01 cash flows in another currency than the business case are refused", /financial_cash_flow_set_currency/, async () => {
    await ins(c, "financial_cash_flow_set", { id: uid(), organization_id: ORG, transformation_id: TR, business_case_id: BC, currency: "USD", line_count: 1, created_by: U1, updated_by: U1 });
  });
  await expectFailure(c, "CF02 a set whose rows do not match line_count fails at COMMIT", /financial_cash_flow_set_rows/, async () => {
    await ins(c, "financial_cash_flow_set", { id: SET, organization_id: ORG, transformation_id: TR, business_case_id: BC, currency: "SAR", line_count: 4, created_by: U1, updated_by: U1 });
    for (const t of [0, 1, 2]) await ins(c, "financial_cash_flow", cfRow(1, t), false);
  });
  await expectSuccess(c, "CF03 the fixture set (outflow 1000 at t=0, inflows 300/400/500) commits", async () => {
    await ins(c, "financial_cash_flow_set", { id: SET, organization_id: ORG, transformation_id: TR, business_case_id: BC, currency: "SAR", line_count: 4, created_by: U1, updated_by: U1 });
    for (const t of [0, 1, 2, 3]) await ins(c, "financial_cash_flow", cfRow(1, t), false);
    const npv = (await c.query(`SELECT round(sum((inflow - outflow) / power(1.1::numeric, period_index)), 2)::text AS npv FROM financial_cash_flow WHERE set_id = $1 AND revision = 1`, [SET])).rows[0].npv;
    return `NPV at 10% beginning-of-period (SQL cross-check) = ${npv}`;
  });
  await expectFailure(c, "CF04 a row for an old or future revision is refused", /financial_cash_flow_current_revision/, async () => { await ins(c, "financial_cash_flow", cfRow(2, 0), false); });
  await expectFailure(c, "CF05 an extra row written without its set fails at COMMIT", /financial_cash_flow_set_rows/, async () => { await ins(c, "financial_cash_flow", cfRow(1, 4), false); });
  await expectFailure(c, "CF06 the revision steps by exactly 1", /financial_cash_flow_set_revision_step/, async () => { await updx(c, "financial_cash_flow_set", SET, { revision: 3, line_count: 1 }); });
  await expectSuccess(c, "CF07 a replacement (revision 2) keeps the revision-1 rows as history", async () => {
    await updx(c, "financial_cash_flow_set", SET, { revision: 2, line_count: 2 });
    for (const t of [0, 1]) await ins(c, "financial_cash_flow", cfRow(2, t), false);
    return JSON.stringify((await c.query(`SELECT revision, count(*)::int AS n FROM financial_cash_flow WHERE set_id = $1 GROUP BY 1 ORDER BY 1`, [SET])).rows);
  });
  await expectFailure(c, "CF08 mth_app cannot UPDATE a cash-flow row (no grant)", /permission denied/, async () => { await c.query(`UPDATE financial_cash_flow SET inflow = 1 WHERE set_id = $1`, [SET]); });
  await expectFailure(c, "CF09 a set without its audit event fails at COMMIT", /financial_cash_flow_set_audit_required/, async () => { await updx(c, "financial_cash_flow_set", SET, { basis_note: "Synthetic" }, { audit: false }); });

  // ---- launch plan and tasks (ADR-0048 §1-§3)
  const LP = uid();
  const taskIds: Record<string, string> = {};
  await expectFailure(c, "LP01 a plan without its audit event fails at COMMIT", /launch_plan_audit_required/, async () => { await ins(c, "launch_plan", plan(), false); });
  await expectFailure(c, "LP02 the idempotency key is 'launch_plan:<transformationId>'", /launch_plan_idempotency_shape/, async () => { await ins(c, "launch_plan", plan({ idempotency_key: "launch_plan:other" })); });
  await expectSuccess(c, "LP03 generate: the plan, 33 template tasks dated from 2026-10-01 and the Day-90 test", async () => {
    await ins(c, "launch_plan", plan({ id: LP }));
    const items = (await c.query(`SELECT code, window_code, item_kind, text_en, output_record_type, start_day, due_day, ordinal FROM launch_template_item ORDER BY ordinal`)).rows;
    for (const it of items) {
      const id = uid();
      taskIds[it.code] = id;
      await ins(c, "launch_task", { id, organization_id: ORG, transformation_id: TR, plan_id: LP, ordinal: it.ordinal, template_item_code: it.code, window_code: it.window_code,
        task_kind: it.item_kind, title: it.text_en, output_record_type: it.output_record_type,
        start_date: (await c.query(`SELECT (date '2026-10-01' + $1::int)::text AS d`, [it.start_day])).rows[0].d,
        due_date: (await c.query(`SELECT (date '2026-10-01' + $1::int)::text AS d`, [it.due_day])).rows[0].d, created_by: U1, updated_by: U1 });
    }
    await ins(c, "day_ninety_test", { id: uid(), organization_id: ORG, transformation_id: TR, plan_id: LP, scheduled_date: "2026-12-30", created_by: U1, updated_by: U1 });
    const w = (await c.query(`SELECT min(start_date)::text AS s, max(due_date)::text AS d, count(*)::int AS n FROM launch_task WHERE plan_id = $1 AND window_code = 'days_31_60'`, [LP])).rows[0];
    return `Days 31-60: ${w.n} tasks from ${w.s} to ${w.d}`;
  });
  await expectFailure(c, "LP04 one plan per transformation", /launch_plan_transformation_key|launch_plan_idempotency_key/, async () => { await ins(c, "launch_plan", plan()); });
  await expectFailure(c, "LP05 a start-date shift must record last_shift_days", /launch_plan_shift_recorded/, async () => { await updx(c, "launch_plan", LP, { start_date: "2026-10-08" }); });
  await expectFailure(c, "LP06 the template reference never changes", /launch_plan_identity_fixed|launch_plan_template_ref_check/, async () => { await updx(c, "launch_plan", LP, { generated_via: "automation" }); });
  await expectFailure(c, "LP07 a non-stepping version is refused", /launch_plan_version_step/, async () => { await updx(c, "launch_plan", LP, { start_date: "2026-10-08", last_shift_days: 7 }, { step: 2 }); });
  await expectSuccess(c, "LT01 a task completes (w1_a1); another starts (w1_a2)", async () => {
    await updx(c, "launch_task", taskIds.w1_a1!, { status: "completed", completed_at: new Date(), completed_by: U1 });
    await updx(c, "launch_task", taskIds.w1_a2!, { status: "in_progress" });
    return "ok";
  });
  await expectSuccess(c, "LT02 +7 days: every not_started task moves by 7, the completed and in-progress ones keep their dates", async () => {
    await updx(c, "launch_plan", LP, { start_date: "2026-10-08", last_shift_days: 7 });
    const moved = (await c.query(`SELECT id FROM launch_task WHERE plan_id = $1 AND status = 'not_started'`, [LP])).rows;
    for (const r of moved) {
      const t = (await c.query(`SELECT (start_date + 7)::text AS s, (due_date + 7)::text AS d FROM launch_task WHERE id = $1`, [r.id])).rows[0];
      await updx(c, "launch_task", r.id, { start_date: t.s, due_date: t.d });
    }
    const x = (await c.query(`SELECT string_agg(template_item_code || '=' || start_date || '..' || due_date, ' ') FILTER (WHERE template_item_code IN ('w1_a1','w1_a2','w2_a1')) AS x FROM launch_task WHERE plan_id = $1`, [LP])).rows[0].x;
    return `moved ${moved.length}; ${x}`;
  });
  await expectFailure(c, "LT03 a completed task keeps its dates", /launch_task_completed_dates_fixed/, async () => { await updx(c, "launch_task", taskIds.w1_a1!, { due_date: "2026-11-30" }); });
  await expectFailure(c, "LT04 completed -> not_started is not allowed", /launch_task_status_step/, async () => { await updx(c, "launch_task", taskIds.w1_a1!, { status: "not_started", completed_at: null, completed_by: null }); });
  await expectFailure(c, "LT05 a task is created not started", /launch_task_created_not_started/, async () => { await ins(c, "launch_task", task(LP, { status: "in_progress" })); });
  await expectFailure(c, "LT06 a template task keeps its template item's kind", /launch_task_template_match/, async () => { await ins(c, "launch_task", task(LP2(), { template_item_code: "w1_a1", task_kind: "output" })); });
  await expectFailure(c, "LT07 the window, ordinal and template item of a task never change", /launch_task_identity_fixed/, async () => { await updx(c, "launch_task", taskIds.w2_a1!, { ordinal: 500 }); });
  await expectFailure(c, "LT08 an output link must name a record of the transformation", /launch_task_output_record/, async () => { await updx(c, "launch_task", taskIds.w1_o1!, { output_record_id: uid() }); });
  await expectFailure(c, "LT09 a due date before the start date is refused", /launch_task_dates/, async () => { await updx(c, "launch_task", taskIds.w2_a2!, { due_date: "2026-01-01" }); });
  await expectSuccess(c, "LT10 cancel a task (w3_o3)", async () => { await updx(c, "launch_task", taskIds.w3_o3!, { status: "cancelled" }); return "cancelled"; });
  await expectFailure(c, "LT11 a cancelled task is final", /launch_task_status_step/, async () => { await updx(c, "launch_task", taskIds.w3_o3!, { title: "Renamed" }); });
  await expectFailure(c, "LT12 a task without its audit event fails at COMMIT", /launch_task_audit_required/, async () => { await updx(c, "launch_task", taskIds.w2_a3!, { title: "Renamed" }, { audit: false }); });
  const link = (taskId: string, predId: string) => ({ id: uid(), organization_id: ORG, transformation_id: TR, task_id: taskId, predecessor_task_id: predId, created_by: U1, updated_by: U1 });
  let L1 = "";
  await expectSuccess(c, "LD01 w2_a2 needs w2_a1 first (audited link)", async () => { const l = link(taskIds.w2_a2!, taskIds.w2_a1!); L1 = l.id; await ins(c, "launch_task_predecessor", l); return "linked"; });
  await expectSuccess(c, "LD02 w2_a3 needs w2_a2", async () => { await ins(c, "launch_task_predecessor", link(taskIds.w2_a3!, taskIds.w2_a2!)); return "linked"; });
  await expectFailure(c, "LD03 a chain that would loop (w2_a1 needs w2_a3) is refused", /launch_task_predecessor_no_cycle/, async () => { await ins(c, "launch_task_predecessor", link(taskIds.w2_a1!, taskIds.w2_a3!)); });
  await expectFailure(c, "LD04 a task cannot precede itself (the cycle guard fires before the CHECK launch_task_predecessor_not_self)", /launch_task_predecessor_no_cycle|launch_task_predecessor_not_self/, async () => { await ins(c, "launch_task_predecessor", link(taskIds.w2_a1!, taskIds.w2_a1!)); });
  await expectFailure(c, "LD05 one active link per pair", /launch_task_predecessor_active_key/, async () => { await ins(c, "launch_task_predecessor", link(taskIds.w2_a2!, taskIds.w2_a1!)); });
  await expectFailure(c, "LD06 a link is never deleted (no DELETE grant)", /permission denied/, async () => { await c.query(`DELETE FROM launch_task_predecessor WHERE id = $1`, [L1]); });
  const blocked = (await c.query(`SELECT t.template_item_code AS t, string_agg(p.template_item_code, ',') AS by FROM launch_task t JOIN launch_task_predecessor l ON l.task_id = t.id AND l.removed_at IS NULL
                                  JOIN launch_task p ON p.id = l.predecessor_task_id AND p.status <> 'completed' WHERE t.plan_id = $1 GROUP BY 1 ORDER BY 1`, [LP])).rows;
  report("LD07 'blocked by' derives from the active predecessors that are not completed", JSON.stringify(blocked) === JSON.stringify([{ t: "w2_a2", by: "w2_a1" }, { t: "w2_a3", by: "w2_a2" }]), JSON.stringify(blocked));
  await expectSuccess(c, "LD08 removing a link stamps removed_at (its only change)", async () => { await updx(c, "launch_task_predecessor", L1, { removed_at: new Date(), removed_by: U1 }); return "removed"; });
  await expectFailure(c, "LD09 a removed link cannot be changed again", /launch_task_predecessor_immutable/, async () => { await updx(c, "launch_task_predecessor", L1, { removed_at: null, removed_by: null }); });
  await expectSuccess(c, "LD10 re-adding a removed link makes a new row", async () => { await ins(c, "launch_task_predecessor", link(taskIds.w2_a2!, taskIds.w2_a1!)); return "re-linked"; });

  // ---- Day-90 test (ADR-0048 §4)
  const T90 = (await c.query(`SELECT id FROM day_ninety_test WHERE plan_id = $1`, [LP])).rows[0].id as string;
  const resp = (q: number, o: Record<string, unknown> = {}) => ({ id: uid(), organization_id: ORG, transformation_id: TR, test_id: T90, question_code: `q${q}`, answer: "yes", responded_by: U1, created_by: U1, updated_by: U1, ...o });
  await expectFailure(c, "DT01 a test is created open with no response", /day_ninety_test_created_open/, async () => {
    await ins(c, "day_ninety_test", { id: uid(), organization_id: ORG, transformation_id: TR, plan_id: LP, scheduled_date: "2026-12-30", status: "completed", created_by: U1, updated_by: U1 });
  });
  await expectSuccess(c, "DT02 five responses: the test stays open (incomplete, 5/6)", async () => {
    for (const q of [1, 2, 3, 4, 5]) await ins(c, "day_ninety_response", resp(q));
    await updx(c, "day_ninety_test", T90, { answered_count: 5 });
    return JSON.stringify((await c.query(`SELECT status, answered_count FROM day_ninety_test WHERE id = $1`, [T90])).rows[0]);
  });
  await expectFailure(c, "DT03 completing with 5 of 6 answers is refused", /day_ninety_test_completed_complete/, async () => { await updx(c, "day_ninety_test", T90, { status: "completed", completed_at: new Date(), completed_by: U1 }); });
  await expectFailure(c, "DT04 answered_count different from the responses fails at COMMIT", /day_ninety_test_answered_count/, async () => { await updx(c, "day_ninety_test", T90, { answered_count: 6 }); });
  await expectFailure(c, "DR01 an answer outside yes/no is refused", /day_ninety_response_answer_check/, async () => { await ins(c, "day_ninety_response", resp(6, { answer: "partly" })); });
  await expectFailure(c, "DR02 one response per question", /day_ninety_response_key/, async () => { await ins(c, "day_ninety_response", resp(1)); });
  await expectSuccess(c, "DT05 the sixth response, then complete", async () => {
    await ins(c, "day_ninety_response", resp(6, { answer: "no", comment: "Synthetic: asks not yet visible" }));
    await updx(c, "day_ninety_test", T90, { answered_count: 6, status: "completed", completed_at: new Date(), completed_by: U1 });
    return "completed";
  });
  await expectFailure(c, "DR03 no response changes after completion", /day_ninety_response_test_open/, async () => {
    const id = (await c.query(`SELECT id FROM day_ninety_response WHERE test_id = $1 AND question_code = 'q6'`, [T90])).rows[0].id;
    await updx(c, "day_ninety_response", id, { answer: "yes" });
  });
  await expectFailure(c, "DT06 a completed test is final", /day_ninety_test_completed_final/, async () => { await updx(c, "day_ninety_test", T90, { scheduled_date: "2027-01-06" }); });

  // ---- health-check schemes (ADR-0048 §6)
  const draftScheme = (id: string, def: Record<string, unknown>) => ({ id, key: id === HDRAFT ? "health-check" : "health-check-alt", version_no: id === HDRAFT ? 2 : 1, status: "draft", title_en: "Synthetic draft scheme",
    title_ar: "مسودة تجريبية", source_document: "probe", definition: JSON.stringify(def), content_sha256: H(id === HDRAFT ? 7 : 8), config_kind: "health_check_scheme",
    draft_stage: "editing", origin: "draft", based_on_version_id: HC1, created_by: U1, updated_by: U1 });
  await fixture(db, "methodology_version", draftScheme(HDRAFT, { scoreBasis: "percent_of_applicable", questionCount: 25 }));
  const el = (vid: string, type: string, key: string, origin: string, ordinal: number, attributes: Record<string, unknown>) => ({ id: uid(), methodology_version_id: vid, element_type: type,
    stable_key: key, origin, ordinal, attributes: JSON.stringify(attributes), created_by: U1, updated_by: U1 });
  const band = (key: string, min: string, origin = "admin") => ({ minScore: min, rangeLabel: key, textEn: `Synthetic band ${key}`, textAr: `نطاق تجريبي ${key}`, ...(origin === "source" ? { sourceRef: "B0152" } : {}) });
  for (const e of [
    el(HDRAFT, "health_response", "yes", "source", 1, { credit: "1" }), el(HDRAFT, "health_response", "no", "source", 2, { credit: "0" }),
    el(HDRAFT, "health_response", "na", "admin", 3, { credit: null }),
    el(HDRAFT, "health_band", "b0152_21_25", "source", 1, band("21-25", "21", "source")), el(HDRAFT, "health_band", "b0152_0_9", "source", 2, band("0-9", "0", "source")),
  ]) await fixture(db, "methodology_element", e);
  {
    const a = await client(db, null);
    const p = (await a.query(`SELECT p5_health_scheme_problem($1) AS p`, [HDRAFT])).rows[0].p;
    report("HS01 a draft that adds N/A but keeps the source bands breaks the publish rule", p === "health_scheme_own_bands_required", String(p));
    await a.end();
  }
  {
    const a = await client(db, null);
    await expectFailure(a, "HS02 publishing that draft is refused by the database (REQ-S14-003)", /health_scheme_own_bands_required/, async () => {
      await a.query(`UPDATE methodology_version SET status = 'published', draft_stage = NULL, published_at = now(), published_by = $2, version = version + 1 WHERE id = $1`, [HDRAFT, U1]);
    });
    await a.end();
  }
  await fixture(db, "methodology_version", draftScheme(HDRAFT2, { scoreBasis: "points", questionCount: 25 }));
  for (const e of [
    el(HDRAFT2, "health_response", "yes", "source", 1, { credit: "1" }), el(HDRAFT2, "health_response", "no", "source", 2, { credit: "0" }),
    el(HDRAFT2, "health_response", "na", "admin", 3, { credit: null }), el(HDRAFT2, "health_band", "own_low", "admin", 1, band("0-49", "0")),
  ]) await fixture(db, "methodology_element", e);
  {
    const a = await client(db, null);
    const p = (await a.query(`SELECT p5_health_scheme_problem($1) AS p`, [HDRAFT2])).rows[0].p;
    report("HS03 N/A with own bands but a points basis breaks the rule (N/A scores as a percentage of the applicable questions)", p === "health_scheme_na_needs_percent", String(p));
    await a.query(`SET session_replication_role = replica`);
    await a.query(`UPDATE methodology_version SET definition = '{"scoreBasis": "percent_of_applicable", "questionCount": 25}' WHERE id = $1`, [HDRAFT2]);
    await a.query(`SET session_replication_role = origin`);
    const p2 = (await a.query(`SELECT p5_health_scheme_problem($1) AS p`, [HDRAFT2])).rows[0].p;
    report("HS04 N/A with its own bands and the percent basis satisfies the rule", p2 === null, String(p2));
    await a.end();
  }
  await expectFailure(c, "HS05 a float-like or out-of-range credit is refused", /methodology_element_health_credit/, async () => {
    await ins(c, "methodology_element", el(HDRAFT, "health_response", "partial", "admin", 4, { credit: "1.5" }));
  });
  await expectFailure(c, "HS06 a band without its Arabic text is refused", /methodology_element_health_band/, async () => {
    await ins(c, "methodology_element", el(HDRAFT, "health_band", "own_mid", "admin", 3, { minScore: "50", rangeLabel: "50-100", textEn: "Synthetic" }));
  });
  await expectFailure(c, "HS07 a response key outside yes/no/partial/na is refused", /methodology_element_source_identity/, async () => {
    await ins(c, "methodology_element", el(HDRAFT, "health_response", "maybe", "admin", 5, { credit: "0.5" }));
  });
  await expectFailure(c, "HS08 a source band must be one of the four B0152 bands", /methodology_element_source_identity/, async () => {
    await ins(c, "methodology_element", el(HDRAFT, "health_band", "b0152_99", "source", 4, band("x", "5", "source")));
  });
  await expectFailure(c, "HS09 a health element in a methodology version is refused", /methodology_element_kind_type|methodology_element_draft_only/, async () => {
    await ins(c, "methodology_element", el(MV1, "health_band", "own_x", "admin", 9, band("x", "1")));
  });
  await expectSuccess(c, "HS10 a valid partial-credit response is accepted in a draft being edited", async () => {
    await ins(c, "methodology_element", el(HDRAFT, "health_response", "partial", "admin", 4, { credit: "0.5" }));
    return "ok";
  });
  await expectFailure(c, "HS11 the published v1 cannot gain an element", /methodology_element_draft_only/, async () => {
    await ins(c, "methodology_element", el(HC1, "health_response", "partial", "admin", 9, { credit: "0.5" }));
  });

  // ---- health assessments (ADR-0048 §5)
  let A1 = "";
  await expectFailure(c, "HA01 an assessment without its audit event fails at COMMIT", /health_assessment_audit_required/, async () => { await ins(c, "health_assessment", assessment(), false); });
  await expectFailure(c, "HA02 an assessment needs a published scheme version", /health_assessment_scheme_published/, async () => { await ins(c, "health_assessment", assessment({ scheme_version_id: HDRAFT })); });
  await expectFailure(c, "HA03 an assessment is created as a draft", /health_assessment_created_draft/, async () => { await ins(c, "health_assessment", assessment({ status: "submitted" })); });
  await expectSuccess(c, "HA04 a draft assessment under scheme v1", async () => { const a = assessment(); A1 = a.id as string; await ins(c, "health_assessment", a); return A1; });
  await expectFailure(c, "HA05 at most one draft per transformation", /health_assessment_one_draft_key/, async () => { await ins(c, "health_assessment", assessment({ sequence_no: 2 })); });
  await expectFailure(c, "HN01 N/A is not a response of scheme v1", /health_assessment_answer_response_allowed/, async () => { await ins(c, "health_assessment_answer", answer(A1, 1, "na")); });
  await expectFailure(c, "HN02 question q26 does not exist", /health_assessment_answer_question_code_check/, async () => { await ins(c, "health_assessment_answer", answer(A1, 26, "yes")); });
  await expectSuccess(c, "HN03 24 answers (16 yes): incomplete, no score and no band", async () => {
    await answerAll(c, A1, 24, 16);
    const r = (await c.query(`SELECT * FROM p5_health_assessment_result($1)`, [A1])).rows[0];
    return `24/25: ${JSON.stringify(r)}`;
  });
  await expectFailure(c, "HA06 answered_count different from the answers fails at COMMIT", /health_assessment_answered_count/, async () => { await updx(c, "health_assessment", A1, { answered_count: 25 }); });
  for (const r of [1, 2, 3]) await expectSuccess(c, `HX0${r} top action ${r}`, async () => { await ins(c, "health_assessment_action", action(A1, r)); return "ok"; });
  await expectFailure(c, "HX04 a fourth action (rank 4) is refused", /health_assessment_action_rank_check/, async () => { await ins(c, "health_assessment_action", action(A1, 4)); });
  await expectFailure(c, "HX05 one action per rank", /health_assessment_action_rank_key/, async () => { await ins(c, "health_assessment_action", action(A1, 1)); });
  await expectFailure(c, "HA07 an incomplete assessment (24/25) cannot be submitted", /health_assessment_incomplete/, async () => {
    await updx(c, "health_assessment", A1, { status: "submitted", submitted_at: new Date(), submitted_by: U1, score: "16", score_max: "25", band_key: "b0152_16_20", answered_count: 24 });
  });
  await expectSuccess(c, "HN04 the 25th answer (yes): 17 of 25 -> score 17, band 16-20", async () => {
    await ins(c, "health_assessment_answer", answer(A1, 25, "yes"));
    await updx(c, "health_assessment", A1, { answered_count: 25 });
    return JSON.stringify((await c.query(`SELECT * FROM p5_health_assessment_result($1)`, [A1])).rows[0]);
  });
  await expectFailure(c, "HA08 a submitted score that differs from the scheme result is refused", /health_assessment_score_matches/, async () => {
    await updx(c, "health_assessment", A1, { status: "submitted", submitted_at: new Date(), submitted_by: U1, score: "18", score_max: "25", band_key: "b0152_16_20" });
  });
  await expectFailure(c, "HA09 a submitted band that differs from the scheme result is refused", /health_assessment_score_matches/, async () => {
    await updx(c, "health_assessment", A1, { status: "submitted", submitted_at: new Date(), submitted_by: U1, score: "17", score_max: "25", band_key: "b0152_21_25" });
  });
  await expectSuccess(c, "HA10 submission with 25 answers, 3 actions, score 17 and band 16-20", async () => {
    await updx(c, "health_assessment", A1, { status: "submitted", submitted_at: new Date(), submitted_by: U1, score: "17", score_max: "25", band_key: "b0152_16_20" });
    return "submitted";
  });
  await expectFailure(c, "HA11 a submitted assessment is final", /health_assessment_submitted_final/, async () => { await updx(c, "health_assessment", A1, { assessment_date: "2026-10-15" }); });
  await expectFailure(c, "HN05 no answer changes after submission", /health_assessment_answer_draft_only/, async () => {
    const id = (await c.query(`SELECT id FROM health_assessment_answer WHERE assessment_id = $1 AND question_code = 'q01'`, [A1])).rows[0].id;
    await updx(c, "health_assessment_answer", id, { response: "no" });
  });
  await expectFailure(c, "HX06 no action changes after submission", /health_assessment_action_draft_only/, async () => {
    const id = (await c.query(`SELECT id FROM health_assessment_action WHERE assessment_id = $1 AND rank = 1`, [A1])).rows[0].id;
    await updx(c, "health_assessment_action", id, { action_text: "Changed" });
  });
  let A2 = "";
  await expectSuccess(c, "HA12 a reassessment names the previous submitted assessment", async () => { const a = assessment({ sequence_no: 2, previous_assessment_id: A1 }); A2 = a.id as string; await ins(c, "health_assessment", a); return A2; });
  await expectFailure(c, "HA13 submission without the top 3 actions is refused", /health_assessment_three_actions/, async () => {
    await answerAll(c, A2, 25, 21);
    await ins(c, "health_assessment_action", action(A2, 1));
    await updx(c, "health_assessment", A2, { status: "submitted", submitted_at: new Date(), submitted_by: U1, score: "21", score_max: "25", band_key: "b0152_21_25" });
  });
  await expectFailure(c, "HA14 the scheme version of an assessment never changes", /health_assessment_scheme_fixed/, async () => { await updx(c, "health_assessment", A2, { scheme_version_id: HDRAFT2 }); });
  await expectFailure(c, "HA15 a non-stepping version is refused", /health_assessment_version_step/, async () => { await updx(c, "health_assessment", A2, { assessment_date: "2026-10-15" }, { step: 2 }); });
  {
    // REQ-PB-092: scores 21, 16, 10 and 9 map to the four band texts verbatim (computed by the database function).
    const out: string[] = [];
    await c.query("BEGIN");
    try {
      await answerAll(c, A2, 25, 0);
      for (const yes of [21, 16, 10, 9]) {
        await c.query(`UPDATE health_assessment_answer SET response = CASE WHEN substr(question_code, 2)::int <= $2 THEN 'yes' ELSE 'no' END, version = version + 1 WHERE assessment_id = $1`, [A2, yes]);
        const r = (await c.query(`SELECT r.score::text AS s, e.attributes->>'rangeLabel' AS l, e.attributes->>'textEn' AS t FROM p5_health_assessment_result($1) r
                                  JOIN methodology_element e ON e.methodology_version_id = $2 AND e.stable_key = r.band_key`, [A2, HC1])).rows[0];
        out.push(`${r.s}->${r.l}: ${r.t}`);
      }
    } finally {
      await c.query("ROLLBACK");
    }
    report("HA16 scores 21, 16, 10, 9 map to the four B0152 bands (computed in the database; rolled back)", out.length === 4 && out[0]!.startsWith("21.00->21-25: Strong transformation discipline") && out[1]!.startsWith("16.00->16-20: Solid foundation")
      && out[2]!.startsWith("10.00->10-15: Execution risk is material") && out[3]!.startsWith("9.00->0-9: Transformation is likely being managed as disconnected projects"), out.join(" | "));
  }

  // ---- grants: no DELETE anywhere new; append-only tables have no UPDATE privilege needed
  {
    const g = (await c.query(`SELECT string_agg(table_name || ':' || privilege_type, ',' ORDER BY table_name) AS g FROM information_schema.role_table_grants WHERE grantee = 'mth_app'
        AND privilege_type IN ('DELETE', 'TRUNCATE') AND table_name IN ('kpi_restatement','kpi_restatement_period','kpi_restatement_reconciliation','kpi_restatement_reissue_offer','financial_metric_setting',
        'financial_cash_flow_set','financial_cash_flow','launch_window','launch_template_item','day_ninety_question','launch_plan','launch_task','launch_task_predecessor','day_ninety_test','day_ninety_response',
        'health_assessment','health_assessment_answer','health_assessment_action')`)).rows[0].g;
    report("AO01 mth_app has no DELETE or TRUNCATE on any slice G/H table", g === null, String(g));
  }
  {
    // The append-only triggers fire even for the owner (UPDATE and DELETE), on every append-only slice G table.
    const o = await client(db);
    for (const [i, t] of ["kpi_restatement_period", "kpi_restatement_reconciliation", "kpi_restatement_reissue_offer", "financial_cash_flow"].entries()) {
      await expectFailure(o, `AO0${3 + 2 * i} UPDATE on ${t} is refused by its append-only trigger (as the owner)`, /append-only/, async () => { await o.query(`UPDATE ${t} SET created_at = created_at`); });
      await expectFailure(o, `AO0${4 + 2 * i} DELETE on ${t} is refused by its append-only trigger (as the owner)`, /append-only/, async () => { await o.query(`DELETE FROM ${t}`); });
    }
    await o.end();
  }
  await expectFailure(c, "AO02 the launch catalogues are read-only to mth_app", /permission denied/, async () => { await c.query(`UPDATE launch_window SET label_en = 'x'`); });
  await c.end();

  console.log(`\n${total - failures}/${total} PASS`);
  if (failures > 0) process.exitCode = 1;
}

/** A second plan id is only used to show that a mismatched template task is refused (the plan row need not exist: the guard fires first). */
function LP2(): string {
  return uid();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
