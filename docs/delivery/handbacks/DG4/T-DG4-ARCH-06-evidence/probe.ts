// T-DG4-ARCH-06 migration and guard probe (solution-architect). Run against a DISPOSABLE cluster only:
//   QA_PG_PORT=<port in 23700-23749> MTH_PORT_POOL=23701-23749 tests/qa/support/with-pg.sh \
//     node --conditions=@mth/source docs/delivery/handbacks/DG4/T-DG4-ARCH-06-evidence/probe.ts
// 1. Fresh database: all migrations 0001..last.
// 2. P3-populated database: 0001..0027 with synthetic P1-P3 data (incl. an initiative), then 0028..last on top.
// 3. Guard probes on the slice F and G tables (ADR-0033, ADR-0034). Every probe states the expected failure; "PASS"
//    means the guard fired (or, for an expectSuccess probe, that the allowed write committed). The harness and the
//    KPI/benefit helpers are copied from the T-DG4-ARCH-03 probe. All data is SYNTHETIC and approves nothing.
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

// ------------------------------------------------------------------------------------------------ slice B helpers
const U4 = "01990000-0000-7000-8000-00000000000a"; // FIN
const U5 = "01990000-0000-7000-8000-00000000000b"; // a second FIN / another person
async function users(c: any): Promise<void> {
  await c.query(`INSERT INTO app_user (id, organization_id, display_name) VALUES ($1, $3, 'Synthetic FIN'), ($2, $3, 'Synthetic FIN 2')`, [U4, U5, ORG]);
}
async function initiative(c: any, code: string): Promise<string> {
  const id = uid();
  await c.query(`INSERT INTO initiative (id, organization_id, transformation_id, code, name, created_by, updated_by) VALUES ($1, $2, $3, $4, 'Synthetic initiative', $5, $5)`, [id, ORG, TR, code, U1]);
  await audit(c, "initiative", id, 1);
  return id;
}
async function deliverable(c: any, ini: string): Promise<string> {
  const id = uid();
  await c.query(`INSERT INTO deliverable (id, organization_id, transformation_id, initiative_id, title, created_by, updated_by) VALUES ($1, $2, $3, $4, 'Synthetic deliverable', $5, $5)`, [id, ORG, TR, ini, U1]);
  await audit(c, "deliverable", id, 1);
  return id;
}
async function formula(c: any, validated: boolean): Promise<{ f: string; v: string }> {
  const f = uid();
  const v = uid();
  const n = (await c.query(`SELECT count(*)::int AS n FROM benefit_formula`)).rows[0].n + 1;
  await c.query(`INSERT INTO benefit_formula (id, organization_id, transformation_id, code, benefit_name, created_by, updated_by) VALUES ($1, $2, $3, $4, 'Synthetic cost reduction', $5, $5)`,
    [f, ORG, TR, `BF-${String(n).padStart(2, "0")}`, U1]);
  await audit(c, "benefit_formula", f, 1);
  await c.query(`INSERT INTO benefit_formula_version (id, organization_id, transformation_id, formula_id, version_no, expression, expression_sha256, result_kind, result_currency, result_period, engine_version,
      validation_status, validated_by, validated_at, created_by, updated_by)
    VALUES ($1, $2, $3, $4, 1, 'eligible_volume * (baseline_unit_cost - target_unit_cost)', repeat('a', 64), 'currency', 'SAR', 'year', 'mth-formula/1.0.0', $5, $6, $7, $8, $8)`,
    [v, ORG, TR, f, validated ? "validated" : "unvalidated", validated ? U4 : null, validated ? new Date().toISOString() : null, U1]);
  await audit(c, "benefit_formula_version", v, 1);
  await c.query(`UPDATE benefit_formula SET current_version_no = 1, version = 2 WHERE id = $1`, [f]);
  await audit(c, "benefit_formula", f, 2);
  return { f, v };
}
let bseq = 1;
type BOpts = Record<string, unknown>;
async function benefit(c: any, o: BOpts = {}): Promise<string> {
  const id = uid();
  const row: Record<string, unknown> = {
    id, organization_id: ORG, transformation_id: TR, code: `B${String(bseq++).padStart(2, "0")}`, title: "Synthetic benefit",
    description: "Synthetic benefit profile", benefit_type: "cost", value_class: "cash_saving", owner_user_id: U3,
    financial_statement_line: "P&L: Operating cost", currency: "SAR", created_by: U1, updated_by: U1, ...o,
  };
  const cols = Object.keys(row);
  await c.query(`INSERT INTO benefit (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(row));
  await audit(c, "benefit", id, 1);
  return id;
}
/** UPDATE benefit SET <set> with a version step and its audit event. */
async function bset(c: any, id: string, set: Record<string, unknown>, withAudit = true): Promise<void> {
  const v = (await c.query(`SELECT version FROM benefit WHERE id = $1`, [id])).rows[0].version;
  const cols = Object.keys(set);
  await c.query(`UPDATE benefit SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(", ")}, version = ${v + 1} WHERE id = $1`, [id, ...Object.values(set)]);
  if (withAudit) await audit(c, "benefit", id, v + 1);
}
async function enabler(c: any, b: string, ini: string, del: string | null = null): Promise<string> {
  const id = uid();
  await c.query(`INSERT INTO benefit_enabler (id, organization_id, transformation_id, benefit_id, initiative_id, deliverable_id, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
    [id, ORG, TR, b, ini, del, U1]);
  await audit(c, "benefit_enabler", id, 1);
  return id;
}
/** A benefit taken to the Measure step: plan outputs, one enabler, three step changes. */
async function measuredBenefit(c: any, ini: string, o: BOpts = {}, fv: { f: string } | null = null): Promise<string> {
  const isNonFin = o.value_class === "non_financial";
  const b = await benefit(c, o);
  await bset(c, b, { lifecycle_step: "plan" });
  await bset(c, b, { baseline_value: "100", target_value: "200", ...(isNonFin ? {} : { benefit_formula_id: fv?.f }), lifecycle_step: "enable" });
  await enabler(c, b, ini);
  await bset(c, b, { lifecycle_step: "measure" });
  return b;
}
async function measurement(c: any, b: string, o: Record<string, unknown> = {}, withAudit = true): Promise<string> {
  const id = uid();
  const no = (await c.query(`SELECT coalesce(max(measurement_no), 0) + 1 AS n FROM benefit_measurement WHERE benefit_id = $1`, [b])).rows[0].n;
  const row: Record<string, unknown> = {
    id, organization_id: ORG, transformation_id: TR, benefit_id: b, measurement_no: no, source: "manual", period_start: "2026-01-01",
    period_end: "2026-03-31", amount: "250000.0000", currency: "SAR", status: "submitted", submitted_by: U3,
    submitted_at: new Date().toISOString(), created_by: U3, updated_by: U3, ...o,
  };
  const cols = Object.keys(row);
  await c.query(`INSERT INTO benefit_measurement (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(row));
  if (withAudit) await audit(c, "benefit_measurement", id, 1);
  return id;
}

// ------------------------------------------------------------------------------------------------ slice F/G helpers
async function ins(c: any, table: string, row: Record<string, unknown>, withAudit: boolean | "svc" = true, version: number | null = 1): Promise<string> {
  const cols = Object.keys(row);
  await c.query(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(row));
  if (withAudit === "svc") await auditSvc(c, table, row.id as string, version);
  else if (withAudit) await audit(c, table, row.id as string, version);
  return row.id as string;
}
async function auditSvc(c: any, recordType: string, id: string, version: number | null): Promise<void> {
  await c.query(
    `INSERT INTO audit_event (id, organization_id, transformation_id, actor_type, actor_user_id, action, record_type, record_id, new_version, source)
     VALUES ($1, $2, $3, 'service', NULL, $4, $5, $6, $7, 'worker')`,
    [uid(), ORG, TR, `${recordType}.probe`, recordType, id, version],
  );
}
/** UPDATE <table> SET <set> with a version step (default +1) and its audit event (unless audit = false). */
async function upd(c: any, table: string, id: string, set: Record<string, unknown>, o: { audit?: boolean; step?: number } = {}): Promise<void> {
  const v = (await c.query(`SELECT version FROM ${table} WHERE id = $1`, [id])).rows[0].version;
  const nv = v + (o.step ?? 1);
  const cols = Object.keys(set);
  await c.query(`UPDATE ${table} SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(", ")}${cols.length ? ", " : ""}version = ${nv} WHERE id = $1`, [id, ...Object.values(set)]);
  if (o.audit !== false) await audit(c, table, id, nv);
}
let sgSeq = 1;
async function group(c: any, o: Record<string, unknown> = {}, withAudit = true): Promise<string> {
  return ins(c, "stakeholder_group", {
    id: uid(), organization_id: ORG, transformation_id: TR, code: `SG-${String(sgSeq++).padStart(2, "0")}`, name: `Synthetic group ${seq}`,
    influence: "H", impact: "M", current_stance: "neutral", required_behavior: "Use the new journey for every case",
    intervention_types: ["comms", "training"], owner_user_id: U3, created_by: U1, updated_by: U1, ...o,
  }, withAudit);
}
async function champion(c: any, g: string, user: string): Promise<string> {
  return ins(c, "stakeholder_champion", { id: uid(), organization_id: ORG, transformation_id: TR, stakeholder_group_id: g, user_id: user, created_by: U1, updated_by: U1 });
}
async function designDecision(c: any): Promise<string> {
  const id = uid();
  await ins(c, "decision", { id, organization_id: ORG, transformation_id: TR, kind: "design", code: `D-${String(seq).padStart(2, "0")}`, title: "Synthetic T04 design decision", created_by: U1, updated_by: U1 });
  return id;
}
let aiSeq = 1;
async function intervention(c: any, o: Record<string, unknown> = {}, withAudit: boolean | "svc" = true): Promise<string> {
  return ins(c, "adoption_intervention", {
    id: uid(), organization_id: ORG, transformation_id: TR, code: `AI-${String(aiSeq++).padStart(2, "0")}`, intervention_type: "training",
    title: "Synthetic training intervention", owner_user_id: U3, due_date: "2026-11-15", origin: "manual", created_source: "api",
    created_by: U1, updated_by: U1, ...o,
  }, withAudit);
}
const PROF_SCHEMA = { questions: [
  { key: "uses_new_journey", type: "yes_no", label_en: "Handles the case end to end in the new journey", label_ar: "ينجز الحالة بالكامل عبر الرحلة الجديدة", required: true, proficiency: true },
  { key: "comment", type: "text", label_en: "Observation notes", label_ar: "ملاحظات المراقبة", required: false },
] };
const FEEDBACK_SCHEMA = { questions: [
  { key: "clarity", type: "scale", label_en: "How clear is the new process?", label_ar: "ما مدى وضوح العملية الجديدة؟", required: true, min: 1, max: 5 },
  { key: "channel", type: "single_choice", label_en: "Preferred support channel", label_ar: "قناة الدعم المفضلة", required: false,
    options: [{ value: "coach", label_en: "Coach", label_ar: "مدرب" }, { value: "guide", label_en: "Guide", label_ar: "دليل" }] },
] };
async function form(c: any, kind: string, schema: unknown, publish = true): Promise<{ f: string; v: string }> {
  const f = await ins(c, "assessment_form", { id: uid(), organization_id: ORG, transformation_id: TR, kind, name: `Synthetic ${kind} form ${seq}`, created_by: U3, updated_by: U3 });
  const v = await ins(c, "assessment_form_version", { id: uid(), organization_id: ORG, transformation_id: TR, form_id: f, version_no: 1, schema: JSON.stringify(schema), created_by: U3 }, true, null);
  await upd(c, "assessment_form", f, { current_version_no: 1 });
  if (publish) await upd(c, "assessment_form", f, { status: "published", published_version_no: 1, published_at: new Date().toISOString(), published_by: U3 });
  return { f, v };
}
async function area(c: any, o: Record<string, unknown> = {}, withCycle = true, tr = TR): Promise<string> {
  const id = uid();
  await ins(c, "performance_area", { id, organization_id: ORG, transformation_id: tr, code: `PA-${String(seq).padStart(2, "0")}`, name: `Synthetic area ${seq}`, created_by: U1, updated_by: U1, ...o });
  if (withCycle) await ins(c, "performance_area_cycle", { id: uid(), organization_id: ORG, transformation_id: tr, performance_area_id: id, cycle_no: 1, opened_by: U1, created_by: U1 }, true, null);
  return id;
}
async function control(c: any, a: string, o: Record<string, unknown> = {}): Promise<string> {
  return ins(c, "control", { id: uid(), organization_id: ORG, transformation_id: TR, performance_area_id: a, code: `CTL-${String(seq).padStart(2, "0")}`, name: "Synthetic reconciliation control", owner_user_id: U3, frequency: "monthly", created_by: U1, updated_by: U1, ...o });
}
const HANDOVER_CONTENT = {
  kpi_owner_user_id: null as string | null, operating_procedures: "Synthetic SOP v1", capability_readiness: "Team trained; synthetic readiness note",
  unresolved_accepted_risks: "R-01 accepted by the BO (synthetic)", benefit_monitoring_cadence: "monthly", data_access: "Read access to the synthetic data mart",
  improvement_backlog_summary: "CI-01 and CI-02 (synthetic)",
};
async function handover(c: any, a: string, cycle = 1, o: Record<string, unknown> = {}): Promise<string> {
  return ins(c, "bau_handover", { id: uid(), organization_id: ORG, transformation_id: TR, performance_area_id: a, cycle_no: cycle, code: `HO-${String(seq).padStart(2, "0")}`, receiving_owner_user_id: U3, created_by: U1, updated_by: U1, ...o });
}
async function fill(c: any, h: string): Promise<void> {
  await upd(c, "bau_handover", h, { ...HANDOVER_CONTENT, kpi_owner_user_id: U3 });
}
async function linkEvidence(c: any, h: string): Promise<void> {
  await ins(c, "bau_handover_evidence", { id: uid(), organization_id: ORG, transformation_id: TR, handover_id: h, evidence_id: await evidence(c), created_by: U1 }, true, null);
}
async function submit(c: any, h: string): Promise<void> {
  await upd(c, "bau_handover", h, { status: "submitted", submitted_at: new Date().toISOString(), submitted_by: U1 });
}
async function accept(c: any, h: string, by = U3): Promise<void> {
  await upd(c, "bau_handover", h, { status: "accepted", accepted_at: new Date().toISOString(), accepted_by: by });
}
/** An area taken to BAU: control, handover filled, evidence, submitted, accepted, area -> bau. */
async function bauArea(c: any): Promise<{ a: string; h: string }> {
  const a = await area(c);
  await control(c, a);
  const h = await handover(c, a);
  await fill(c, h);
  await linkEvidence(c, h);
  await submit(c, h);
  await accept(c, h);
  await upd(c, "performance_area", a, { status: "bau", current_handover_id: h, bau_owner_user_id: U3, kpi_owner_user_id: U3, next_review_date: "2026-11-30" });
  return { a, h };
}
async function launchedInitiative(c: any, code: string): Promise<string> {
  const id = uid();
  await ins(c, "initiative", { id, organization_id: ORG, transformation_id: TR, code, name: "Synthetic initiative", status: "launched", launched_at: new Date().toISOString(), launched_by: U1, created_by: U1, updated_by: U1 });
  return id;
}
async function approval(c: any, subjectId: string, subjectVersion: number): Promise<string> {
  return ins(c, "approval", {
    id: uid(), organization_id: ORG, transformation_id: TR, approval_type: "benefit_transition_decision", subject_type: "transition_decision",
    subject_id: subjectId, subject_version: subjectVersion, title: "Synthetic transition decision", requested_by: U3,
    request_business_date: "2026-10-09", due_date: "2026-10-16", assignee_party_code: "SP", assignee_user_id: U2, sod_policy: "requester_excluded", created_by: U3, updated_by: U3,
  });
}
async function adminClient(db: string) {
  const cl = new pg.Client({ connectionString: roleUrl(db, null) });
  await cl.connect();
  return cl;
}

async function main(): Promise<void> {
  const files = readdirSync(migrationsDir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  console.log(`migrations shipped: ${files.length} (${files[0]} .. ${files[files.length - 1]})`);
  const ids = files.map((f) => Number(f.slice(0, 4)));
  const main = ids.filter((n) => n < 58);
  report("G00 migration ids below the repair range are contiguous 1..n and 0047-0049 are present (0058+ is the repair range, D-094)",
    main.every((n, i) => n === i + 1) && [47, 48, 49].every((n) => ids.includes(n)), `last below 0058: ${main[main.length - 1]}; repair: ${ids.filter((n) => n >= 58).join(",")}`);

  // 1. Fresh database.
  await createDb("probe_fresh");
  const applied = await migrate(roleUrl("probe_fresh", "mth_owner"), { dir: migrationsDir });
  report("G01 fresh database: 0001..last apply", applied.length === files.length, `applied ${applied.length}: ${applied.slice(44).join(", ")}`);

  // 2. P3-populated database (a transformation and a P3 initiative), then P4 on top.
  await createDb("probe_p3");
  const p3Dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "p3-migrations-"));
  for (const f of files.filter((f) => Number(f.slice(0, 4)) <= LAST_P3)) cpSync(join(migrationsDir, f), join(p3Dir, f));
  const p3Applied = await migrate(roleUrl("probe_p3", "mth_owner"), { dir: p3Dir });
  let OLD_INI = "";
  {
    const c = await client("probe_p3");
    await seedP1(c);
    await c.query("BEGIN");
    OLD_INI = await initiative(c, "INI-01");
    await c.query("COMMIT");
    report("G02 P3 database populated (0001-0027, a synthetic transformation and a P3 initiative)", p3Applied.length === LAST_P3, `applied ${p3Applied.length}`);
    await c.end();
  }
  const p4OnTop = await migrate(roleUrl("probe_p3", "mth_owner"), { dir: migrationsDir });
  {
    const c = await client("probe_p3");
    report("G03 P4 over the P3 database: 0028..last apply", p4OnTop.length === files.length - LAST_P3, `applied ${p4OnTop.length}: ${p4OnTop.slice(-4).join(", ")}`);
    const r = await c.query(`SELECT version, status, adoption_status, delivery_completed_at, adoption_status_set_at FROM initiative WHERE id = $1`, [OLD_INI]);
    report("G04 the existing P3 initiative keeps its values (version 1, draft); new columns are not_assessed / NULL",
      r.rows[0].version === 1 && r.rows[0].status === "draft" && r.rows[0].adoption_status === "not_assessed" && r.rows[0].delivery_completed_at === null, JSON.stringify(r.rows[0]));
    await expectSuccess(c, "G05 an existing transformation still takes a DG1 status edit (draft -> active) after 0048", async () => {
      await c.query(`UPDATE transformation SET status = 'active', version = version + 1 WHERE id = $1`, [TR]);
      return "updated";
    });
    await c.end();
  }

  // 3. Guard probes on the fresh database.
  const c = await client("probe_fresh");
  await inTx(c, async () => {
    await seedP1(c);
    await users(c);
  });

  // --- Seeds.
  {
    const t = await c.query(`SELECT key, indicator_ordinal, measure_ordinal, source_indicator_en, measure_en, value_source, ar_provisional FROM adoption_indicator_template ORDER BY indicator_ordinal, measure_ordinal`);
    const names = [...new Set(t.rows.map((r: any) => r.source_indicator_en))];
    const expected = ["Usage / activation rate", "Compliance with new process", "Cycle-time shift", "Training completion + observed proficiency",
      "Decision turnaround time", "Percentage of transactions handled through the new journey", "Exception / workaround rate"];
    report("S01 the seven B0109-B0115 indicators are seeded verbatim (8 measure rows; the fourth has two measures), Arabic provisional",
      JSON.stringify(names) === JSON.stringify(expected) && t.rowCount === 8 && t.rows.every((r: any) => r.ar_provisional === true)
        && t.rows.filter((r: any) => r.indicator_ordinal === 4).map((r: any) => `${r.measure_en}:${r.value_source}`).join("|") === "Training completion:training_records|Observed proficiency:assessment_records",
      JSON.stringify(names));
    const codes = (await c.query(`SELECT code, category FROM permission WHERE code IN (SELECT permission_code FROM role_permission) OR true`)).rows;
    const mine = ["adoption.edit", "assessment_form.manage", "assessment.respond", "assessment.review", "proficiency.record", "champion_constraint.raise",
      "adoption_status.set", "initiative.complete_delivery", "initiative.close", "transformation.close", "performance_area.manage", "performance_area.reopen",
      "bau_handover.prepare", "bau_handover.accept", "control.manage", "control_check.record", "sustainment_review.complete", "improvement.edit",
      "lesson.edit", "lesson.search", "transition_decision.propose"];
    const cat = Object.fromEntries(codes.filter((r: any) => mine.includes(r.code)).map((r: any) => [r.code, r.category]));
    const grants = await c.query(`SELECT rp.permission_code AS p, string_agg(r.code, ',' ORDER BY r.code) AS roles FROM role_permission rp JOIN role r ON r.id = rp.role_id WHERE rp.permission_code = ANY ($1) GROUP BY 1`, [mine]);
    const g = Object.fromEntries(grants.rows.map((r: any) => [r.p, r.roles]));
    const adm = await c.query(`SELECT count(*)::int AS n FROM role_permission rp JOIN role r ON r.id = rp.role_id WHERE rp.permission_code = ANY ($1) AND r.kind = 'technical_admin'`, [mine]);
    const aud = await c.query(`SELECT string_agg(rp.permission_code, ',') AS p FROM role_permission rp JOIN role r ON r.id = rp.role_id WHERE rp.permission_code = ANY ($1) AND r.code = 'AUD'`, [mine]);
    report("S02 21 slice F/G permissions; bau_handover.accept is business_approval held by BO only; AUD holds only the read code lesson.search; no technical admin holds any",
      Object.keys(cat).length === 21 && cat["bau_handover.accept"] === "business_approval" && g["bau_handover.accept"] === "BO" && cat["lesson.search"] === "read"
        && Object.entries(cat).filter(([k]) => k !== "bau_handover.accept" && k !== "lesson.search").every(([, v]) => v === "write")
        && aud.rows[0].p === "lesson.search" && adm.rows[0].n === 0 && g["transformation.close"] === "TL" && g["initiative.complete_delivery"] === "TL,WL",
      JSON.stringify([adm.rows[0].n, aud.rows[0].p, g["bau_handover.accept"], g["adoption.edit"]]));
    const w = await c.query(`SELECT code FROM work_item_kind WHERE owner_module IN ('adoption', 'sustainment') ORDER BY code`);
    const at = await c.query(`SELECT subject_table, default_sod_policy FROM approval_type WHERE code = 'benefit_transition_decision'`);
    report("S03 the seven slice F/G work-item kinds and the benefit_transition_decision approval type are seeded",
      w.rowCount === 7 && at.rows[0]?.subject_table === "transition_decision" && at.rows[0]?.default_sod_policy === "requester_excluded", JSON.stringify(w.rows.map((r: any) => r.code)));
  }
  await expectFailure(c, "S04 a technical admin cannot be granted bau_handover.accept (0001 trigger)", /technical|admin/i, async () => {
    await c.query(`INSERT INTO role_permission (role_id, permission_code) VALUES ('01920000-0000-7000-8000-00000000000c', 'bau_handover.accept')`);
  });
  await expectFailure(c, "S05 mth_app cannot write the indicator template (SELECT only)", /permission denied/, async () => {
    const app = await client("probe_fresh", "mth_app");
    try {
      await app.query(`UPDATE adoption_indicator_template SET measure_en = 'x'`);
    } finally {
      await app.end();
    }
  });

  // --- Stakeholder groups (T13).
  let G1 = "";
  await expectSuccess(c, "SG01 a T13 row persists all seven columns (stakeholder, impact, stance, behaviour, intervention, owner, adoption KPI)", async () => {
    const k = await kpiDef(c, "Synthetic usage rate", "percentage", null, "higher_is_better");
    G1 = await group(c, { adoption_kpi_definition_id: k, intervention_types: ["comms", "training", "involvement", "incentive"] });
    const r = (await c.query(`SELECT name, impact, current_stance, required_behavior, intervention_types, owner_user_id, adoption_kpi_definition_id FROM stakeholder_group WHERE id = $1`, [G1])).rows[0];
    return JSON.stringify(r);
  });
  await expectFailure(c, "SG02 a new group without its audit event fails at COMMIT (deferred audit-coverage constraint)", /stakeholder_group_audit_required/, async () => {
    await group(c, {}, false);
  });
  await expectFailure(c, "SG03 stance 'hostile' is rejected (closed set Support / Neutral / Resist)", /stakeholder_group_current_stance_check/, async () => {
    await group(c, { current_stance: "hostile" });
  });
  await expectFailure(c, "SG04 an intervention type outside Comms / training / involvement / incentive is rejected", /stakeholder_group_intervention_types_valid/, async () => {
    await group(c, { intervention_types: ["webinar"] });
  });
  await expectFailure(c, "SG05 a repeated intervention type is rejected", /stakeholder_group_intervention_types_distinct/, async () => {
    await group(c, { intervention_types: ["comms", "comms"] });
  });
  await expectFailure(c, "SG06 impact outside H/M/L is rejected", /stakeholder_group_impact_check/, async () => {
    await group(c, { impact: "X" });
  });
  await expectSuccess(c, "SG07 influence and impact are separate columns (influence may be Unknown while impact is H)", async () => {
    const id = await group(c, { influence: null, impact: "H" });
    const r = (await c.query(`SELECT influence, impact FROM stakeholder_group WHERE id = $1`, [id])).rows[0];
    return JSON.stringify(r);
  });
  await expectFailure(c, "SG08 an update that does not step the version by 1 is refused", /stakeholder_group_version_step/, async () => {
    await upd(c, "stakeholder_group", G1, { required_behavior: "x" }, { step: 2 });
  });
  await expectFailure(c, "SG09 the adoption KPI must belong to the same transformation", /stakeholder_group_kpi_fkey/, async () => {
    const k = uid();
    await c.query(`INSERT INTO kpi_definition (id, organization_id, transformation_id, name, unit_kind, polarity, created_by, updated_by) VALUES ($1, $2, $3, 'Other KPI', 'count', 'higher_is_better', $4, $4)`, [k, ORG, TR2, U1]);
    await audit(c, "kpi_definition", k, 1, ORG, TR2);
    await group(c, { adoption_kpi_definition_id: k });
  });

  // --- Champions and constraints (REQ-PB-073).
  let CH = "";
  let DD = "";
  await inTx(c, async () => {
    CH = await champion(c, G1, U3);
    DD = await designDecision(c);
  });
  await expectSuccess(c, "CC01 an active champion raises a constraint linked to a T04 design decision; it is listed on that decision", async () => {
    const id = await ins(c, "champion_constraint", { id: uid(), organization_id: ORG, transformation_id: TR, champion_id: CH, stakeholder_group_id: G1, decision_id: DD, constraint_text: "Shift pattern blocks the training slot", created_by: U3, updated_by: U3 });
    const r = await c.query(`SELECT id FROM champion_constraint WHERE decision_id = $1 AND status = 'open'`, [DD]);
    return `${id} on decision: ${r.rowCount}`;
  });
  await expectFailure(c, "CC02 a constraint raised by someone who is not that champion is refused", /champion_constraint_raised_by_champion/, async () => {
    await ins(c, "champion_constraint", { id: uid(), organization_id: ORG, transformation_id: TR, champion_id: CH, stakeholder_group_id: G1, decision_id: DD, constraint_text: "Not mine", created_by: U1, updated_by: U1 });
  });
  await expectFailure(c, "CC03 a constraint on a non-design (executive) decision is refused", /champion_constraint_design_decision/, async () => {
    const d = uid();
    await ins(c, "decision", { id: d, organization_id: ORG, transformation_id: TR, kind: "executive", code: "DEC-90", title: "Synthetic exec", created_by: U1, updated_by: U1 });
    await ins(c, "champion_constraint", { id: uid(), organization_id: ORG, transformation_id: TR, champion_id: CH, stakeholder_group_id: G1, decision_id: d, constraint_text: "Wrong kind", created_by: U3, updated_by: U3 });
  });
  await expectFailure(c, "CC04 the decision link of a constraint never moves", /champion_constraint_identity/, async () => {
    const cc = (await c.query(`SELECT id FROM champion_constraint WHERE decision_id = $1`, [DD])).rows[0].id;
    const d2 = await designDecision(c);
    await upd(c, "champion_constraint", cc, { decision_id: d2 });
  });
  await expectFailure(c, "CC05 a removed champion is final", /stakeholder_champion_removed_final/, async () => {
    const ch = await champion(c, G1, U1);
    await upd(c, "stakeholder_champion", ch, { status: "removed", removed_at: new Date().toISOString(), removed_by: U1 });
    await upd(c, "stakeholder_champion", ch, { note: "again" });
  });
  await expectFailure(c, "IV01 involvement history is append-only (UPDATE refused)", /append-only/, async () => {
    const id = await ins(c, "stakeholder_involvement", { id: uid(), organization_id: ORG, transformation_id: TR, stakeholder_group_id: G1, involvement_kind: "decision", decision_id: DD, created_by: U1 }, true, null);
    await c.query(`UPDATE stakeholder_involvement SET note = 'x' WHERE id = $1`, [id]);
  });
  await expectFailure(c, "IV02 involvement history is append-only (DELETE refused)", /append-only/, async () => {
    const id = await ins(c, "stakeholder_involvement", { id: uid(), organization_id: ORG, transformation_id: TR, stakeholder_group_id: G1, involvement_kind: "decision", decision_id: DD, created_by: U1 }, true, null);
    await c.query(`DELETE FROM stakeholder_involvement WHERE id = $1`, [id]);
  });

  // --- Metric links and interventions (REQ-PB-069, REQ-PB-071).
  await expectFailure(c, "ML01 a KPI-fed measure without its KPI is refused", /adoption_metric_link_kpi_matches_source/, async () => {
    await ins(c, "adoption_metric_link", { id: uid(), organization_id: ORG, transformation_id: TR, template_key: "usage_activation_rate", target_kind: "stakeholder_group", stakeholder_group_id: G1, created_by: U1, updated_by: U1 });
  });
  await expectFailure(c, "ML02 a record-fed measure (observed proficiency) naming a KPI is refused", /adoption_metric_link_kpi_matches_source/, async () => {
    const k = await kpiDef(c, "Synthetic proficiency KPI", "percentage", null, "higher_is_better");
    await ins(c, "adoption_metric_link", { id: uid(), organization_id: ORG, transformation_id: TR, template_key: "observed_proficiency", kpi_definition_id: k, target_kind: "stakeholder_group", stakeholder_group_id: G1, created_by: U1, updated_by: U1 });
  });
  await expectFailure(c, "ML03 a link whose target does not match target_kind is refused", /adoption_metric_link_target/, async () => {
    await ins(c, "adoption_metric_link", { id: uid(), organization_id: ORG, transformation_id: TR, template_key: "observed_proficiency", target_kind: "initiative", stakeholder_group_id: G1, created_by: U1, updated_by: U1 });
  });
  await expectFailure(c, "AI01 a manual intervention without an owner and a due date is refused", /adoption_intervention_origin_shape/, async () => {
    await intervention(c, { owner_user_id: null, due_date: null });
  });
  await expectFailure(c, "AI02 a new intervention starts planned", /adoption_intervention_starts_planned/, async () => {
    await intervention(c, { status: "done", completed_at: new Date().toISOString(), completed_by: U1, outcome_note: "done" });
  });
  // Below-trajectory: a KPI with an active version, a period, an accepted actual, a run and a red evaluation.
  let KA = "";
  let LINK = "";
  let EV = "";
  let PER = "";
  await inTx(c, async () => {
    KA = await kpiDef(c, "Synthetic activation rate", "percentage", null, "higher_is_better");
    await activateVersion(c, await kpiVersion(c, KA, { value_nature: "stock", aggregation_rule: "last_value" }));
    PER = await period(c, "2026-09", "2026-09-01", "2026-09-30");
    const act = await directActual(c, KA, PER, "0.42");
    const r = await run(c, act);
    EV = await evaluation(c, r, KA, PER, { value: "0.42", value_status: "ok", value_reason: null, value_source: "entered", expected_value: "0.60", calculated_rag: "red", deviation: "adverse", threshold_source: "default", explanation_key: "kpi.rag.below_trajectory" });
    LINK = await ins(c, "adoption_metric_link", { id: uid(), organization_id: ORG, transformation_id: TR, template_key: "usage_activation_rate", kpi_definition_id: KA, target_kind: "stakeholder_group", stakeholder_group_id: G1, created_by: U1, updated_by: U1 });
  }).catch((e) => report("AI03-setup KPI evaluation chain", false, e.message));
  const below = (o: Record<string, unknown> = {}) => ({
    origin: "below_trajectory", created_source: "worker", created_by: null, updated_by: null, intervention_type: "corrective", owner_user_id: U3, due_date: null,
    stakeholder_group_id: G1, metric_link_id: LINK, kpi_evaluation_id: EV, reporting_period_id: PER, scope_kind: "transformation", scope_id: TR,
    trigger_key: `${LINK}:transformation:${TR}:${PER}`, title: "Synthetic activation rate", ...o,
  });
  await expectSuccess(c, "AI03 an evaluation below trajectory creates one worker intervention (origin below_trajectory, audited as the service)", async () => {
    const id = await intervention(c, below(), "svc");
    return id;
  });
  await expectFailure(c, "AI04 a second intervention for the same indicator, scope and period is refused (exactly one)", /adoption_intervention_trigger_key/, async () => {
    await intervention(c, below(), "svc");
  });
  await expectFailure(c, "AI05 a worker intervention whose evaluation is of another KPI/scope/period is refused", /adoption_intervention_evaluation_matches/, async () => {
    await intervention(c, below({ scope_id: TR2, trigger_key: `${LINK}:transformation:${TR2}:${PER}` }), "svc");
  });
  await expectFailure(c, "AI06 a done intervention is final", /adoption_intervention_final/, async () => {
    const id = await intervention(c);
    await upd(c, "adoption_intervention", id, { status: "done", completed_at: new Date().toISOString(), completed_by: U3, outcome_note: "Delivered", updated_by: U3 });
    await upd(c, "adoption_intervention", id, { title: "changed" });
  });
  await expectFailure(c, "AI07 the trigger fields of an intervention are immutable", /adoption_intervention_origin_immutable/, async () => {
    const id = (await c.query(`SELECT id FROM adoption_intervention WHERE origin = 'below_trajectory'`)).rows[0].id;
    await upd(c, "adoption_intervention", id, { trigger_key: "other" });
  });

  // --- Forms and records (REQ-S11-002, REQ-PB-072).
  let PF = { f: "", v: "" };
  await expectSuccess(c, "FM01 a valid proficiency form (one required yes/no proficiency question) and a valid feedback form are accepted and published", async () => {
    PF = await form(c, "proficiency_assessment", PROF_SCHEMA);
    await form(c, "feedback", FEEDBACK_SCHEMA);
    return PF.f;
  });
  await expectFailure(c, "FM02 a proficiency form without a proficiency question is refused (validated form JSON)", /assessment_form_version_schema_valid/, async () => {
    await form(c, "proficiency_assessment", FEEDBACK_SCHEMA, false);
  });
  await expectFailure(c, "FM03 a schema with an unknown member is refused", /assessment_form_version_schema_valid/, async () => {
    await form(c, "feedback", { questions: [{ ...FEEDBACK_SCHEMA.questions[0], script: "x" }] }, false);
  });
  await expectFailure(c, "FM04 duplicate question keys are refused", /assessment_form_version_schema_valid/, async () => {
    await form(c, "feedback", { questions: [FEEDBACK_SCHEMA.questions[0], FEEDBACK_SCHEMA.questions[0]] }, false);
  });
  await expectFailure(c, "FM05 a form version that skips a number is refused", /assessment_form_version_step/, async () => {
    await ins(c, "assessment_form_version", { id: uid(), organization_id: ORG, transformation_id: TR, form_id: PF.f, version_no: 5, schema: JSON.stringify(PROF_SCHEMA), created_by: U3 }, true, null);
  });
  await expectFailure(c, "FM06 a form version is append-only (UPDATE refused)", /append-only/, async () => {
    await c.query(`UPDATE assessment_form_version SET schema = '{}' WHERE id = $1`, [PF.v]);
  });
  const obs = (o: Record<string, unknown> = {}) => ({
    id: uid(), organization_id: ORG, transformation_id: TR, form_id: PF.f, form_version_id: PF.v, stakeholder_group_id: G1, kind: "proficiency_observation",
    respondent_user_id: U3, subject_label: "Agent A (synthetic)", observed_on: "2026-10-05", answers: JSON.stringify({ uses_new_journey: true }),
    proficiency_result: "proficient", created_by: U3, updated_by: U3, ...o,
  });
  let OB = "";
  await expectSuccess(c, "AR01 a proficiency observation submitted via the form links to the stakeholder group", async () => {
    OB = await ins(c, "assessment_record", obs());
    const r = (await c.query(`SELECT count(*)::int AS n FROM assessment_record WHERE stakeholder_group_id = $1 AND kind = 'proficiency_observation' AND status <> 'withdrawn'`, [G1])).rows[0].n;
    return `counted observations for the group: ${r}`;
  });
  await expectFailure(c, "AR02 a proficiency observation without a result is refused", /assessment_record_proficiency_shape/, async () => {
    await ins(c, "assessment_record", obs({ proficiency_result: null }));
  });
  await expectFailure(c, "AR03 a respondent other than the author is refused", /assessment_record_respondent_is_creator/, async () => {
    await ins(c, "assessment_record", obs({ respondent_user_id: U1 }));
  });
  await expectFailure(c, "AR04 the answers of a submitted record are immutable", /assessment_record_immutable/, async () => {
    await upd(c, "assessment_record", OB, { answers: JSON.stringify({ uses_new_journey: false }) });
  });
  await expectFailure(c, "AR05 a response to an unpublished form is refused", /assessment_record_form_published/, async () => {
    const d = await form(c, "proficiency_assessment", PROF_SCHEMA, false);
    await ins(c, "assessment_record", obs({ form_id: d.f, form_version_id: d.v }));
  });
  await expectSuccess(c, "TR01 training completion is a separate record: 100% completion with no observation leaves the observation count 0 (Unknown)", async () => {
    const g2 = await group(c);
    const t = await ins(c, "training_record", { id: uid(), organization_id: ORG, transformation_id: TR, stakeholder_group_id: g2, participant_label: "Agent B (synthetic)", training_title: "New journey basics", created_by: U1, updated_by: U1 });
    await upd(c, "training_record", t, { status: "completed", completed_on: "2026-10-01", recorded_by: U1 });
    const n = (await c.query(`SELECT count(*)::int AS n FROM assessment_record WHERE stakeholder_group_id = $1 AND kind = 'proficiency_observation' AND status <> 'withdrawn'`, [g2])).rows[0].n;
    const done = (await c.query(`SELECT count(*) FILTER (WHERE status = 'completed')::int AS c, count(*)::int AS t FROM training_record WHERE stakeholder_group_id = $1`, [g2])).rows[0];
    if (n !== 0) throw new Error("observations counted");
    return `completed ${done.c}/${done.t}; observations ${n}`;
  });
  await expectFailure(c, "TR02 a completed training record without its completion date is refused", /training_record_completed_complete/, async () => {
    await ins(c, "training_record", { id: uid(), organization_id: ORG, transformation_id: TR, stakeholder_group_id: G1, participant_label: "X", training_title: "T", status: "completed", recorded_by: U1, created_by: U1, updated_by: U1 });
  });

  // --- Performance areas, handovers, controls (REQ-PB-083, REQ-S11-005, REQ-S03-002, REQ-S11-009).
  await expectFailure(c, "PA01 a new area without its cycle-1 row fails at COMMIT", /performance_area_cycle_present/, async () => {
    await area(c, {}, false);
  });
  await expectFailure(c, "PA02 a new area must start establishing in cycle 1", /performance_area_starts_establishing/, async () => {
    await area(c, { status: "bau" });
  });
  await expectFailure(c, "PA03 an area cannot enter BAU without the accepted handover of its current cycle", /performance_area_bau_handover_accepted|performance_area_bau_complete/, async () => {
    const a = await area(c);
    const h = await handover(c, a);
    await upd(c, "performance_area", a, { status: "bau", current_handover_id: h, bau_owner_user_id: U3, next_review_date: "2026-11-30" });
  });
  await expectFailure(c, "HO01 a handover missing data access cannot be submitted", /bau_handover_content_complete/, async () => {
    const a = await area(c);
    await control(c, a);
    const h = await handover(c, a);
    await upd(c, "bau_handover", h, { ...HANDOVER_CONTENT, kpi_owner_user_id: U3, data_access: null });
    await linkEvidence(c, h);
    await submit(c, h);
  });
  await expectFailure(c, "HO02 a handover without an active control cannot be submitted", /bau_handover_controls_required/, async () => {
    const a = await area(c);
    const h = await handover(c, a);
    await fill(c, h);
    await linkEvidence(c, h);
    await submit(c, h);
  });
  await expectFailure(c, "HO03 a handover without evidence cannot be submitted", /bau_handover_evidence_required/, async () => {
    const a = await area(c);
    await control(c, a);
    const h = await handover(c, a);
    await fill(c, h);
    await submit(c, h);
  });
  await expectFailure(c, "HO04 acceptance by anyone other than the receiving owner is refused", /bau_handover_accepted_complete/, async () => {
    const a = await area(c);
    await control(c, a);
    const h = await handover(c, a);
    await fill(c, h);
    await linkEvidence(c, h);
    await submit(c, h);
    await accept(c, h, U1);
  });
  let BA = { a: "", h: "" };
  await expectSuccess(c, "HO05 the receiving owner accepts a complete handover and the area enters BAU", async () => {
    BA = await bauArea(c);
    return JSON.stringify(BA);
  });
  await expectFailure(c, "HO06 an accepted handover is final and immutable", /bau_handover_accepted_final/, async () => {
    await upd(c, "bau_handover", BA.h, { acceptance_note: "edited later" });
  });
  await expectFailure(c, "HO07 a second accepted handover for the same area and cycle is refused", /bau_handover_area_open|bau_handover_accepted_key|bau_handover_open_key/, async () => {
    await handover(c, BA.a);
  });
  await expectFailure(c, "HO08 a submitted handover's content is frozen until it is returned", /bau_handover_content_frozen/, async () => {
    const a = await area(c);
    await control(c, a);
    const h = await handover(c, a);
    await fill(c, h);
    await linkEvidence(c, h);
    await submit(c, h);
    await upd(c, "bau_handover", h, { data_access: "changed" });
  });
  await expectFailure(c, "HO09 handover evidence is append-only (DELETE refused)", /append-only/, async () => {
    await c.query(`DELETE FROM bau_handover_evidence WHERE handover_id = $1`, [BA.h]);
  });
  await expectFailure(c, "HO10 a handover update without its audit event fails at COMMIT", /bau_handover_audit_required/, async () => {
    const a = await area(c);
    const h = await handover(c, a);
    await upd(c, "bau_handover", h, { data_access: "x" }, { audit: false });
  });

  // Reopening (REQ-S11-009).
  const priorAccepted = (await c.query(`SELECT accepted_at, accepted_by FROM bau_handover WHERE id = $1`, [BA.h])).rows[0];
  await expectFailure(c, "RO01 a reopening without its new cycle row fails at COMMIT", /performance_area_cycle_present/, async () => {
    await upd(c, "performance_area", BA.a, { status: "reopened", cycle_no: 2 });
  });
  await expectFailure(c, "RO02 a reopening cannot skip a cycle", /performance_area_cycle_step/, async () => {
    await upd(c, "performance_area", BA.a, { status: "reopened", cycle_no: 3 });
  });
  await expectSuccess(c, "RO03 a reopening writes cycle 2 with the reason and the prior accepted handover, which stays unchanged", async () => {
    await ins(c, "performance_area_cycle", { id: uid(), organization_id: ORG, transformation_id: TR, performance_area_id: BA.a, cycle_no: 2, opened_by: U3,
      reopen_reason: "Synthetic: KPI red for two periods", prior_handover_id: BA.h, prior_handover_accepted_at: priorAccepted.accepted_at, prior_handover_accepted_by: priorAccepted.accepted_by, created_by: U3 }, true, null);
    await upd(c, "performance_area", BA.a, { status: "reopened", cycle_no: 2 });
    const h = (await c.query(`SELECT status, accepted_at, accepted_by, version FROM bau_handover WHERE id = $1`, [BA.h])).rows[0];
    if (h.status !== "accepted" || h.accepted_at.getTime() !== priorAccepted.accepted_at.getTime()) throw new Error("handover changed");
    return JSON.stringify(h);
  });
  await expectFailure(c, "RO04 the cycle history is append-only (UPDATE refused)", /append-only/, async () => {
    await c.query(`UPDATE performance_area_cycle SET reopen_reason = 'rewritten' WHERE performance_area_id = $1`, [BA.a]);
  });
  await expectFailure(c, "RO05 the cycle history is append-only (DELETE refused)", /append-only/, async () => {
    await c.query(`DELETE FROM performance_area_cycle WHERE performance_area_id = $1`, [BA.a]);
  });
  await expectFailure(c, "RO06 an accepted handover of the prior cycle cannot be re-accepted for the new cycle (accepted is final)", /bau_handover_accepted_final/, async () => {
    await upd(c, "bau_handover", BA.h, { cycle_no: 2 });
  });
  await expectSuccess(c, "RO07 a handover for cycle 2 can be prepared; the area returns to BAU only with it accepted", async () => {
    const h2 = await handover(c, BA.a, 2);
    await fill(c, h2);
    await linkEvidence(c, h2);
    await submit(c, h2);
    await accept(c, h2);
    await upd(c, "performance_area", BA.a, { status: "bau", current_handover_id: h2 });
    const cyc = (await c.query(`SELECT cycle_no, prior_handover_id FROM performance_area_cycle WHERE performance_area_id = $1 ORDER BY cycle_no`, [BA.a])).rows;
    return JSON.stringify(cyc);
  });

  // Controls and checks (REQ-S11-008).
  let CT = "";
  await inTx(c, async () => {
    CT = (await c.query(`SELECT id FROM control WHERE performance_area_id = $1`, [BA.a])).rows[0].id;
  });
  const check = (o: Record<string, unknown> = {}) => ({ id: uid(), organization_id: ORG, transformation_id: TR, control_id: CT, performance_area_id: BA.a, due_date: "2026-11-30", assignee_user_id: U3, created_source: "worker", ...o });
  let CK = "";
  await expectSuccess(c, "CK01 the worker creates a due control check (audited as the service)", async () => {
    CK = await ins(c, "control_check", check(), "svc");
    return CK;
  });
  await expectFailure(c, "CK02 a second check of the same control for the same due date is refused (no duplicate on restart)", /control_check_due_key/, async () => {
    await ins(c, "control_check", check(), "svc");
  });
  await expectFailure(c, "CK03 a failed check without a result note is refused", /control_check_performed_complete/, async () => {
    await upd(c, "control_check", CK, { status: "failed", performed_at: new Date().toISOString(), performed_by: U3, updated_by: U3 });
  });
  await expectSuccess(c, "CK04 a failed check with its note is recorded", async () => {
    await upd(c, "control_check", CK, { status: "failed", performed_at: new Date().toISOString(), performed_by: U3, result_note: "Reconciliation gap found (synthetic)", updated_by: U3 });
    return "failed";
  });
  await expectFailure(c, "CK05 a performed check is final", /control_check_final/, async () => {
    await upd(c, "control_check", CK, { status: "passed" });
  });
  await expectFailure(c, "CK06 a check of a retired control is refused", /control_check_control_active/, async () => {
    const ct2 = await control(c, BA.a);
    await upd(c, "control", ct2, { status: "retired", retired_at: new Date().toISOString(), retired_by: U3, retire_reason: "Replaced" });
    await ins(c, "control_check", check({ control_id: ct2 }), "svc");
  });

  // Reviews (REQ-S11-004, REQ-PB-083).
  const review = (o: Record<string, unknown> = {}) => ({ id: uid(), organization_id: ORG, transformation_id: TR, subject_kind: "performance_area", performance_area_id: BA.a, cycle_no: 2, due_date: "2026-11-30", assignee_user_id: U3, created_source: "worker", ...o });
  await expectSuccess(c, "RV01 a recurring review is created for the BAU area's current cycle", async () => ins(c, "sustainment_review", review(), "svc"));
  await expectFailure(c, "RV02 a second review for the same area and due date is refused (exactly once)", /sustainment_review_due_key/, async () => {
    await ins(c, "sustainment_review", review({ cycle_no: 2 }), "svc");
  });
  await expectFailure(c, "RV03 a review for an area that is not in BAU is refused", /sustainment_review_area_bau/, async () => {
    const a = await area(c);
    await ins(c, "sustainment_review", review({ performance_area_id: a, cycle_no: 1 }), "svc");
  });
  await expectFailure(c, "RV04 completing a review needs the outcome note and the performance signal", /sustainment_review_done_complete/, async () => {
    const id = (await c.query(`SELECT id FROM sustainment_review WHERE performance_area_id = $1`, [BA.a])).rows[0].id;
    await upd(c, "sustainment_review", id, { status: "done", completed_at: new Date().toISOString(), completed_by: U3, updated_by: U3 });
  });

  // Transition decisions (REQ-S11-007).
  let B1 = "";
  let TD = "";
  await inTx(c, async () => {
    B1 = await benefit(c);
  });
  const td = (o: Record<string, unknown> = {}) => ({ id: uid(), organization_id: ORG, transformation_id: TR, code: `TD-${String(seq).padStart(2, "0")}`, benefit_id: B1, residual_owner_user_id: U4,
    rationale: "Synthetic: realization continues for 18 months after closure", expected_realization_end: "2028-03-31", monitoring_frequency: "quarterly",
    first_monitoring_date: "2027-01-15", created_by: U3, updated_by: U3, ...o });
  await expectSuccess(c, "TD01 a transition decision is drafted, submitted through the canonical approval and approved; the benefit's values are not touched", async () => {
    const before = (await c.query(`SELECT count(*)::int AS n FROM benefit_measurement WHERE benefit_id = $1`, [B1])).rows[0].n;
    const bv = (await c.query(`SELECT version FROM benefit WHERE id = $1`, [B1])).rows[0].version;
    TD = await ins(c, "transition_decision", td());
    const ap = await approval(c, TD, 1);
    await upd(c, "transition_decision", TD, { status: "submitted", approval_id: ap });
    await upd(c, "transition_decision", TD, { status: "approved", decided_at: new Date().toISOString(), decided_by: U2, next_monitoring_date: "2027-01-15", updated_by: U2 });
    const after = (await c.query(`SELECT count(*)::int AS n FROM benefit_measurement WHERE benefit_id = $1`, [B1])).rows[0].n;
    const bv2 = (await c.query(`SELECT version FROM benefit WHERE id = $1`, [B1])).rows[0].version;
    if (before !== after || bv !== bv2) throw new Error("benefit changed");
    return `measurements ${before}->${after}; benefit version ${bv}->${bv2}`;
  });
  await expectFailure(c, "TD02 a second live transition decision for the same benefit is refused", /transition_decision_live_key/, async () => {
    await ins(c, "transition_decision", td());
  });
  await expectFailure(c, "TD03 an approved decision's content is final", /transition_decision_final/, async () => {
    await upd(c, "transition_decision", TD, { rationale: "rewritten" });
  });
  await expectSuccess(c, "TD04 monitoring reviews are scheduled for the residual owner of an approved decision", async () =>
    ins(c, "sustainment_review", { id: uid(), organization_id: ORG, transformation_id: TR, subject_kind: "transition_decision", transition_decision_id: TD, due_date: "2027-01-15", assignee_user_id: U4, created_source: "worker" }, "svc"));
  await expectFailure(c, "TD05 monitoring assigned to someone other than the residual owner is refused", /sustainment_review_decision_approved/, async () => {
    await ins(c, "sustainment_review", { id: uid(), organization_id: ORG, transformation_id: TR, subject_kind: "transition_decision", transition_decision_id: TD, due_date: "2027-04-15", assignee_user_id: U3, created_source: "worker" }, "svc");
  });
  await expectFailure(c, "TD06 a submitted decision without its approval is refused", /transition_decision_decided_complete/, async () => {
    const b = await benefit(c);
    const id = await ins(c, "transition_decision", td({ benefit_id: b }));
    await upd(c, "transition_decision", id, { status: "submitted" });
  });

  // Improvement items and lessons (REQ-PB-084, REQ-S11-008).
  await expectFailure(c, "CI01 an improvement item's source fields must match its source kind", /improvement_item_source_fields/, async () => {
    await ins(c, "improvement_item", { id: uid(), organization_id: ORG, transformation_id: TR, code: "CI-01", title: "Synthetic", source_kind: "control_check", created_by: U3, updated_by: U3 });
  });
  await expectSuccess(c, "CI02 a failed control check can seed an improvement item", async () =>
    ins(c, "improvement_item", { id: uid(), organization_id: ORG, transformation_id: TR, code: "CI-02", performance_area_id: BA.a, title: "Automate the reconciliation", source_kind: "control_check", control_check_id: CK, created_by: U3, updated_by: U3 }));
  await expectFailure(c, "CI03 a done item needs its resolution note", /improvement_item_resolved_complete/, async () => {
    const id = (await c.query(`SELECT id FROM improvement_item WHERE code = 'CI-02'`)).rows[0].id;
    await upd(c, "improvement_item", id, { status: "done", resolved_at: new Date().toISOString(), resolved_by: U3 });
  });
  await expectSuccess(c, "LL01 a published lesson of transformation 1 is found by a full-text search scoped to the organization (as from transformation 2)", async () => {
    const l = await ins(c, "lesson", { id: uid(), organization_id: ORG, transformation_id: TR, code: "LL-01", title: "Train supervisors first", lesson_text: "Supervisors who were trained first coached their teams through the new journey", tags: ["training", "journey"], created_by: U3, updated_by: U3 });
    await upd(c, "lesson", l, { status: "published", published_at: new Date().toISOString(), published_by: U3 });
    const r = await c.query(`SELECT code, transformation_id FROM lesson WHERE organization_id = $1 AND status = 'published' AND search_document @@ plainto_tsquery('simple', 'supervisors journey')`, [ORG]);
    if (r.rowCount !== 1) throw new Error(`found ${r.rowCount}`);
    return JSON.stringify(r.rows);
  });
  await expectFailure(c, "LL02 a repeated lesson tag is refused", /lesson_tags_valid/, async () => {
    await ins(c, "lesson", { id: uid(), organization_id: ORG, transformation_id: TR, code: "LL-02", title: "T", lesson_text: "Synthetic lesson", tags: ["a", "a"], created_by: U3, updated_by: U3 });
  });

  // Delivery, adoption and closure statuses (REQ-S03-003, REQ-PB-009, REQ-S11-006).
  let INI = "";
  await inTx(c, async () => {
    INI = await launchedInitiative(c, "INI-10");
  });
  await expectFailure(c, "ST01 moving an initiative to completed without recording who completed delivery is refused", /initiative_delivery_completed_recorded/, async () => {
    await upd(c, "initiative", INI, { status: "completed" });
  });
  await expectSuccess(c, "ST02 delivery complete leaves adoption status untouched (not_assessed) and writes no closure", async () => {
    await upd(c, "initiative", INI, { status: "completed", delivery_completed_at: new Date().toISOString(), delivery_completed_by: U1 });
    const r = (await c.query(`SELECT status, adoption_status FROM initiative WHERE id = $1`, [INI])).rows[0];
    const cl = (await c.query(`SELECT count(*)::int AS n FROM closure_record WHERE initiative_id = $1`, [INI])).rows[0].n;
    if (r.adoption_status !== "not_assessed" || cl !== 0) throw new Error("derived");
    return JSON.stringify({ ...r, closures: cl });
  });
  await expectFailure(c, "ST03 an adoption status without who set it is refused", /initiative_adoption_status_stamps/, async () => {
    await upd(c, "initiative", INI, { adoption_status: "at_risk" });
  });
  await expectFailure(c, "ST04 a closure record for an initiative that is not delivery-complete is refused", /closure_record_initiative_completed/, async () => {
    const i2 = await launchedInitiative(c, "INI-11");
    await ins(c, "closure_record", { id: uid(), organization_id: ORG, transformation_id: TR, subject_kind: "initiative", initiative_id: i2, basis: "validated_value", snapshot: "{}", closed_by: U1, created_by: U1 }, true, null);
  });
  await expectSuccess(c, "ST05 a delivery-complete initiative gets one closure record (the service checks the value basis)", async () =>
    ins(c, "closure_record", { id: uid(), organization_id: ORG, transformation_id: TR, subject_kind: "initiative", initiative_id: INI, basis: "transition_decision", snapshot: JSON.stringify({ benefits: [{ benefitId: B1, transitionDecisionId: TD }] }), closed_by: U1, created_by: U1 }, true, null));
  await expectFailure(c, "ST06 a second closure of the same initiative is refused", /closure_record_initiative_key/, async () => {
    await ins(c, "closure_record", { id: uid(), organization_id: ORG, transformation_id: TR, subject_kind: "initiative", initiative_id: INI, basis: "validated_value", snapshot: "{}", closed_by: U1, created_by: U1 }, true, null);
  });
  await expectFailure(c, "ST07 a closure record is append-only (UPDATE refused)", /append-only/, async () => {
    await c.query(`UPDATE closure_record SET closure_note = 'rewritten' WHERE initiative_id = $1`, [INI]);
  });
  await expectFailure(c, "ST08 a transformation closure record is refused without an approved G6", /closure_record_g6_approved/, async () => {
    await ins(c, "closure_record", { id: uid(), organization_id: ORG, transformation_id: TR, subject_kind: "transformation", basis: "validated_value", snapshot: "{}", closed_by: U1, created_by: U1 }, true, null);
  });
  await expectFailure(c, "ST09 setting a transformation to closed without its closure record is refused", /transformation_closure_recorded/, async () => {
    await c.query(`UPDATE transformation SET status = 'active', version = version + 1 WHERE id = $1`, [TR]);
    await c.query(`UPDATE transformation SET status = 'closed', version = version + 1 WHERE id = $1`, [TR]);
  });
  // Synthetic approved G6 instance (probe setup only, as superuser with replication role so the submission FK is not
  // needed; SYNTHETIC, approves nothing). Then: closure record + closed status; areas and backlog continue.
  {
    const a = await adminClient("probe_fresh");
    await a.query(`SET session_replication_role = replica`);
    await a.query(`INSERT INTO gate_instance (id, organization_id, transformation_id, gate_code, status, approver_role_code, current_submission_id, latest_submission_no, approved_at, created_by, updated_by)
      VALUES ($1, $2, $3, 'G6', 'approved', 'SP', $4, 1, now(), $5, $5)`, [uid(), ORG, TR, uid(), U1]);
    await a.end();
  }
  await expectSuccess(c, "ST10 with an approved G6, the transformation closes through its closure record", async () => {
    const cr = await ins(c, "closure_record", { id: uid(), organization_id: ORG, transformation_id: TR, subject_kind: "transformation", basis: "validated_value_and_transition_decision", snapshot: JSON.stringify({ g6: "synthetic" }), closed_by: U1, created_by: U1 }, true, null);
    await c.query(`UPDATE transformation SET status = 'active', version = version + 1 WHERE id = $1 AND status = 'draft'`, [TR]);
    await c.query(`UPDATE transformation SET status = 'closed', version = version + 1 WHERE id = $1`, [TR]);
    return cr;
  });
  await expectSuccess(c, "ST11 after closure the performance area still takes a scheduled review and a control check, and the CI backlog stays editable", async () => {
    const r = await ins(c, "sustainment_review", review({ due_date: "2026-12-31" }), "svc");
    const k = await ins(c, "control_check", check({ due_date: "2026-12-31" }), "svc");
    const ci = (await c.query(`SELECT id FROM improvement_item WHERE code = 'CI-02'`)).rows[0].id;
    await upd(c, "improvement_item", ci, { status: "in_progress" });
    const t = (await c.query(`SELECT status FROM transformation WHERE id = $1`, [TR])).rows[0].status;
    return `transformation ${t}; review ${r}; check ${k}`;
  });
  await expectSuccess(c, "ST12 after closure a KPI actual is still accepted for the closed transformation (no P4 guard reads the closed status)", async () => {
    const per = await period(c, "2026-10", "2026-10-01", "2026-10-31");
    return directActual(c, KA, per, "0.55");
  });

  // Grants.
  {
    const g = await c.query(`SELECT table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) AS p FROM information_schema.role_table_grants
      WHERE grantee = 'mth_app' AND table_name IN ('stakeholder_involvement', 'assessment_form_version', 'performance_area_cycle', 'bau_handover_evidence', 'closure_record', 'adoption_indicator_template') GROUP BY 1 ORDER BY 1`);
    report("P01 mth_app has INSERT/SELECT only on the append-only tables and SELECT only on the template",
      g.rows.every((r: any) => (r.table_name === "adoption_indicator_template" ? r.p === "SELECT" : r.p === "INSERT,SELECT")) && g.rowCount === 6, JSON.stringify(g.rows));
  }

  await c.end();
  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAIL`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 2;
});
