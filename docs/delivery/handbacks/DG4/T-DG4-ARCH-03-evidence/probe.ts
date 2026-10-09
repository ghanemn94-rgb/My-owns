// T-DG4-ARCH-03 migration and guard probe (solution-architect). Run against a DISPOSABLE cluster only:
//   QA_PG_PORT=<port in 23700-23749> MTH_PORT_POOL=23701-23749 tests/qa/support/with-pg.sh \
//     node --conditions=@mth/source docs/delivery/handbacks/DG4/T-DG4-ARCH-03-evidence/probe.ts
// 1. Fresh database: all migrations 0001..00NN.
// 2. P3-populated database: 0001..0027 with synthetic P1-P3 data, then 0028..00NN on top.
// 3. Guard probes on the slice B tables (ADR-0029, ADR-0030). Every probe states the expected failure; "PASS" means the
//    guard fired (or, for an expectSuccess probe, that the allowed write committed). The harness and the KPI helpers
//    are copied from the T-DG4-ARCH-02 probe. All data is SYNTHETIC and validates or approves nothing.
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
const CONTENT = JSON.stringify({ baseline: {}, attribution: {}, calculation: {}, evidence: [], measurementPeriod: {}, assumptions: "" });
async function queueItem(c: any, b: string, m: string, o: Record<string, unknown> = {}, withAudit = true): Promise<string> {
  const id = uid();
  const p = (await c.query(`SELECT period_start::text AS s, period_end::text AS e FROM benefit_measurement WHERE id = $1`, [m])).rows[0];
  const row: Record<string, unknown> = {
    id, organization_id: ORG, transformation_id: TR, benefit_id: b, benefit_measurement_id: m, idempotency_key: `benefit.evidence_submitted:${m}`,
    status: "queued", content: CONTENT, measurement_period_start: p.s, measurement_period_end: p.e, created_by: U3, updated_by: U3, ...o,
  };
  const cols = Object.keys(row);
  await c.query(`INSERT INTO finance_validation (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(row));
  if (withAudit) await audit(c, "finance_validation", id, 1);
  return id;
}
const ALL_ACCEPTED = `baseline_decision = 'accepted', attribution_decision = 'accepted', calculation_decision = 'accepted',
  evidence_decision = 'accepted', period_decision = 'accepted', assumptions_decision = 'accepted'`;
/** Finance approval: the queue item and the measurement, two audit events, one transaction (caller's). */
async function approve(c: any, fv: string, m: string, amount: string | null, by = U4): Promise<void> {
  await c.query(`UPDATE finance_validation SET status = 'approved', ${ALL_ACCEPTED}, approved_amount = $2, decided_by = $3, decided_at = now(), version = 2 WHERE id = $1`, [fv, amount, by]);
  await audit(c, "finance_validation", fv, 2);
  await c.query(`UPDATE benefit_measurement SET status = 'validated', validated_amount = $2, decided_by = $3, decided_at = now(), version = 2 WHERE id = $1`, [m, amount, by]);
  await audit(c, "benefit_measurement", m, 2);
}
async function validatedTotal(c: any, b: string): Promise<string> {
  return (await c.query(`SELECT coalesce(sum(amount), 0)::text AS t FROM benefit_value_line WHERE benefit_id = $1 AND value_state = 'validated'`, [b])).rows[0].t;
}
async function method(c: any, approved: boolean): Promise<string> {
  const id = uid();
  const n = (await c.query(`SELECT count(*)::int AS n FROM benefit_valuation_method`)).rows[0].n + 1;
  await c.query(`INSERT INTO benefit_valuation_method (id, organization_id, transformation_id, code, name, method, applies_to_type, currency, created_by, updated_by)
    VALUES ($1, $2, $3, $4, 'Synthetic CX valuation', 'Synthetic: value per retained customer', 'cx', 'SAR', $5, $5)`, [id, ORG, TR, `VM-${String(n).padStart(2, "0")}`, U1]);
  await audit(c, "benefit_valuation_method", id, 1);
  if (approved) {
    await c.query(`UPDATE benefit_valuation_method SET status = 'approved', decided_by = $2, decided_at = now(), version = 2 WHERE id = $1`, [id, U4]);
    await audit(c, "benefit_valuation_method", id, 2);
  }
  return id;
}

async function main(): Promise<void> {
  const files = readdirSync(migrationsDir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  console.log(`migrations shipped: ${files.length} (${files[0]} .. ${files[files.length - 1]})`);
  const ids = files.map((f) => Number(f.slice(0, 4)));
  report("G00 migration ids are contiguous 1..n", ids.every((n, i) => n === i + 1), `last ${ids[ids.length - 1]}`);

  // 1. Fresh database.
  await createDb("probe_fresh");
  const applied = await migrate(roleUrl("probe_fresh", "mth_owner"), { dir: migrationsDir });
  report("G01 fresh database: 0001..last apply", applied.length === files.length, `applied ${applied.length}: ${applied.slice(35).join(", ")}`);

  // 2. P3-populated database, then P4 on top.
  await createDb("probe_p3");
  const p3Dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "p3-migrations-"));
  for (const f of files.filter((f) => Number(f.slice(0, 4)) <= LAST_P3)) cpSync(join(migrationsDir, f), join(p3Dir, f));
  const p3Applied = await migrate(roleUrl("probe_p3", "mth_owner"), { dir: p3Dir });
  {
    const c = await client("probe_p3");
    await seedP1(c);
    await c.query(`SELECT p3_instantiate_transformation($1, NULL, NULL, 'migration') AS n`, [TR]);
    await c.query("BEGIN");
    await c.query(`INSERT INTO record_code_counter (transformation_id, prefix, last_value) VALUES ($1, 'BF', 3) ON CONFLICT DO NOTHING`, [TR]);
    const ini = uid();
    await c.query(`INSERT INTO initiative (id, organization_id, transformation_id, code, name, created_by, updated_by) VALUES ($1, $2, $3, 'INI-77', 'Synthetic P3 initiative', $4, $4)`, [ini, ORG, TR, U1]);
    await audit(c, "initiative", ini, 1);
    await c.query("COMMIT");
    report("G02 P3 database populated (0001-0027, a synthetic transformation with its P3 starter structure and an initiative)", p3Applied.length === LAST_P3, `applied ${p3Applied.length}`);
    await c.end();
  }
  const p4OnTop = await migrate(roleUrl("probe_p3", "mth_owner"), { dir: migrationsDir });
  {
    const c = await client("probe_p3");
    report("G03 P4 over the P3 database: 0028+ apply", p4OnTop.length === files.length - LAST_P3, `applied ${p4OnTop.join(", ")}`);
    const k = await c.query(`SELECT prefix, last_value FROM record_code_counter WHERE transformation_id = $1 AND prefix = 'BF'`, [TR]);
    const ini = await c.query(`SELECT count(*)::int AS n FROM initiative WHERE code = 'INI-77' AND version = 1`);
    report("G04 existing P3 rows are unchanged by 0037-0040 (BF counter, initiative)", k.rows[0]?.last_value === 3 && ini.rows[0].n === 1, JSON.stringify([k.rows, ini.rows]));
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
    const s = await c.query(`SELECT code, step_en, question_en, output_en FROM benefit_lifecycle_step_definition ORDER BY ordinal`);
    report("S01 the six B0121 steps are seeded verbatim, in order",
      s.rows.map((r: any) => r.step_en).join("|") === "Identify|Plan|Enable|Measure|Correct|Sustain" &&
        s.rows[1].output_en === "Baseline, formula, target, owner" && s.rows[5].output_en === "BAU owner + control cadence" &&
        s.rows[3].question_en === "Is the benefit appearing in actual performance?", JSON.stringify(s.rows.map((r: any) => r.output_en)));
    const p = await c.query(`SELECT code, category FROM permission WHERE code IN ('benefit.edit', 'benefit.advance', 'benefit.allocate', 'benefit.measure', 'benefit_scenario.edit', 'benefit_group.manage') ORDER BY code`);
    const adm = await c.query(`SELECT count(*)::int AS n FROM role_permission rp JOIN role r ON r.id = rp.role_id WHERE rp.permission_code IN ('benefit.edit', 'benefit.advance', 'benefit.allocate', 'benefit.measure', 'benefit_scenario.edit', 'benefit_group.manage') AND (r.kind = 'technical_admin' OR r.code = 'AUD')`);
    report("S02 six slice B permissions, all 'write'; none held by AUD or a technical admin",
      p.rowCount === 6 && p.rows.every((r: any) => r.category === "write") && adm.rows[0].n === 0, JSON.stringify(p.rows));
    const w = await c.query(`SELECT code FROM work_item_kind WHERE owner_module = 'benefits' ORDER BY code`);
    report("S03 the Finance queue and overlap work-item kinds are seeded", w.rows.map((r: any) => r.code).join(",") === "benefit_overlap_review,finance_validation_review", JSON.stringify(w.rows));
    const fin = await c.query(`SELECT r.code FROM role_permission rp JOIN role r ON r.id = rp.role_id WHERE rp.permission_code = 'finance.validate'`);
    report("S04 finance.validate stays FIN-only (REQ-PB-013)", fin.rows.map((r: any) => r.code).join(",") === "FIN", JSON.stringify(fin.rows));
  }

  const INI1 = await inTx(c, () => initiative(c, "INI-01"));
  const INI2 = await inTx(c, () => initiative(c, "INI-02"));
  const FV_OK = await inTx(c, () => formula(c, true));
  const FV_RAW = await inTx(c, () => formula(c, false));
  const KPI_CX = await inTx(c, () => kpiDef(c, "Synthetic NPS", "score", null, "higher_is_better"));

  // --- Benefit register (REQ-PB-058, REQ-PB-075, REQ-PB-076, REQ-S08-003, REQ-S08-009, REQ-S08-010).
  await expectFailure(c, "B01 a benefit without its audit event fails at COMMIT", /benefit_audit_required/, async () => {
    await c.query(`INSERT INTO benefit (id, organization_id, transformation_id, code, title, description, benefit_type, value_class, owner_user_id, financial_statement_line, currency, created_by, updated_by)
      VALUES ($1, $2, $3, 'B90', 'x', 'x', 'cost', 'cash_saving', $4, 'P&L', 'SAR', $5, $5)`, [uid(), ORG, TR, U3, U1]);
  });
  let B1 = "";
  await expectSuccess(c, "B02 a financial benefit with one owner, class and statement line is created at Identify", async () => {
    B1 = await benefit(c);
    return JSON.stringify((await c.query(`SELECT code, lifecycle_step, value_class FROM benefit WHERE id = $1`, [B1])).rows[0]);
  });
  await expectFailure(c, "B03 a financial benefit without a financial-statement mapping is refused (REQ-S08-003)", /benefit_mapping_required/, async () => {
    await benefit(c, { financial_statement_line: null });
  });
  await expectFailure(c, "B04 a non-financial benefit without an agreed KPI is refused (REQ-S08-003)", /benefit_kpi_required/, async () => {
    await benefit(c, { benefit_type: "cx", value_class: "non_financial", financial_statement_line: null });
  });
  await expectFailure(c, "B05 a revenue benefit cannot be classed as a cash saving (REQ-S08-009)", /benefit_type_fits_class/, async () => {
    await benefit(c, { benefit_type: "revenue", value_class: "cash_saving" });
  });
  await expectFailure(c, "B06 a CX benefit with a SAR value and no valuation method is refused (REQ-S08-010)", /benefit_non_financial_unmonetised/, async () => {
    await benefit(c, { benefit_type: "cx", value_class: "non_financial", financial_statement_line: null, measurement_kpi_definition_id: KPI_CX, planned_value: "5000" });
  });
  const VM_PROPOSED = await inTx(c, () => method(c, false));
  const VM_OK = await inTx(c, () => method(c, true));
  await expectFailure(c, "B07 ... and with a method that Finance has not approved", /benefit_valuation_method_approved/, async () => {
    await benefit(c, { benefit_type: "cx", value_class: "non_financial", financial_statement_line: null, measurement_kpi_definition_id: KPI_CX, planned_value: "5000", valuation_method_id: VM_PROPOSED });
  });
  await expectSuccess(c, "B08 a CX benefit with a SAR value and an approved valuation method is accepted", async () => {
    const b = await benefit(c, { benefit_type: "cx", value_class: "non_financial", financial_statement_line: null, measurement_kpi_definition_id: KPI_CX, planned_value: "5000", valuation_method_id: VM_OK });
    return b;
  });
  await expectFailure(c, "B09 non-stepping version (benefit)", /benefit_version_step/, async () => {
    await c.query(`UPDATE benefit SET title = 'x', version = 5 WHERE id = $1`, [B1]);
  });
  await expectFailure(c, "B10 a new benefit starts at Identify", /benefit_lifecycle_step/, async () => {
    await benefit(c, { lifecycle_step: "plan" });
  });
  await expectFailure(c, "B11 Identify -> Enable skips a step and is refused", /benefit_lifecycle_step/, async () => {
    await bset(c, B1, { lifecycle_step: "enable" });
  });
  await inTx(c, () => bset(c, B1, { lifecycle_step: "plan" }));
  await expectFailure(c, "B12 Plan -> Enable without the Plan outputs (baseline, formula, target) is refused (REQ-PB-074)", /benefit_plan_outputs_present/, async () => {
    await bset(c, B1, { lifecycle_step: "enable" });
  });
  await inTx(c, () => bset(c, B1, { baseline_value: "1000000", target_value: "750000", benefit_formula_id: FV_OK.f, lifecycle_step: "enable" }));
  await expectFailure(c, "B13 Enable -> Measure without an enabler link (the Enable output) is refused", /benefit_enablers_required/, async () => {
    await bset(c, B1, { lifecycle_step: "measure" });
  });
  await expectSuccess(c, "B14 Enable -> Measure with an enabler; the trigger writes one history row per step", async () => {
    await enabler(c, B1, INI1);
    await bset(c, B1, { lifecycle_step: "measure" });
    const h = await c.query(`SELECT from_step, to_step FROM benefit_lifecycle_event WHERE benefit_id = $1 ORDER BY benefit_version`, [B1]);
    if (h.rows.map((r: any) => `${r.from_step}>${r.to_step}`).join(",") !== "null>identify,identify>plan,plan>enable,enable>measure") throw new Error(JSON.stringify(h.rows));
    return JSON.stringify(h.rows);
  });
  await expectFailure(c, "B15 Measure -> Sustain without a BAU owner and control cadence is refused", /benefit_sustain_outputs_present/, async () => {
    await bset(c, B1, { lifecycle_step: "sustain" });
  });
  await expectFailure(c, "B16 Measure -> Correct without a recovery plan is refused", /benefit_correct_output_present/, async () => {
    await bset(c, B1, { lifecycle_step: "correct" });
  });
  await expectFailure(c, "B17 UPDATE on benefit_lifecycle_event is refused (append-only)", /append-only/, async () => {
    await c.query(`UPDATE benefit_lifecycle_event SET to_step = 'sustain' WHERE benefit_id = $1`, [B1]);
  });
  await expectFailure(c, "B18 two benefits with the same code are refused", /benefit_code_key/, async () => {
    await benefit(c, { code: "B01" });
  });
  await expectFailure(c, "B19 the Finance validator cannot be the owner", /benefit_validator_not_owner/, async () => {
    await benefit(c, { finance_validator_user_id: U3 });
  });
  await expectFailure(c, "B20 the baseline validator cannot be the owner", /benefit_baseline_validator_not_owner/, async () => {
    await bset(c, B1, { baseline_validation_status: "validated", baseline_validated_by: U3, baseline_validated_at: new Date().toISOString() });
  });
  await inTx(c, () => bset(c, B1, { baseline_validation_status: "validated", baseline_validated_by: U4, baseline_validated_at: new Date().toISOString() }));
  await expectFailure(c, "B21 a validated baseline cannot change without resetting its validation", /benefit_baseline_validated_frozen/, async () => {
    await bset(c, B1, { baseline_value: "900000" });
  });
  await expectFailure(c, "B22 a missing benefit update audit fails at COMMIT", /benefit_audit_required/, async () => {
    await bset(c, B1, { title: "Changed" }, false);
  });

  // --- Valuation methods (REQ-S08-010).
  await expectFailure(c, "VM01 the proposer cannot approve their own valuation method", /benefit_valuation_method_decider_not_proposer/, async () => {
    await c.query(`UPDATE benefit_valuation_method SET status = 'approved', decided_by = $2, decided_at = now(), version = 2 WHERE id = $1`, [VM_PROPOSED, U1]);
  });
  await expectFailure(c, "VM02 a proposed method's content is fixed", /benefit_valuation_method_frozen/, async () => {
    await c.query(`UPDATE benefit_valuation_method SET method = 'Changed', version = 2 WHERE id = $1`, [VM_PROPOSED]);
  });
  await expectFailure(c, "VM03 a decision without its audit event fails at COMMIT", /benefit_valuation_method_audit_required/, async () => {
    await c.query(`UPDATE benefit_valuation_method SET status = 'rejected', decision_note = 'No', decided_by = $2, decided_at = now(), version = 2 WHERE id = $1`, [VM_PROPOSED, U4]);
  });

  // --- Allocations (REQ-S08-013, REQ-PB-058).
  const BA = await inTx(c, () => benefit(c));
  await expectFailure(c, "A01 allocations 60 % + 50 % are refused (above 100 %)", /benefit_allocation_total/, async () => {
    await bset(c, BA, { allocation_set_no: 1 });
    for (const [ini, s] of [[INI1, "0.6"], [INI2, "0.5"]]) await c.query(`INSERT INTO benefit_allocation (id, organization_id, transformation_id, benefit_id, set_no, initiative_id, share, created_by) VALUES ($1, $2, $3, $4, 1, $5, $6, $7)`, [uid(), ORG, TR, BA, ini, s, U1]);
  });
  await expectSuccess(c, "A02 allocations 60 % + 30 % save and leave 10 % unallocated", async () => {
    await bset(c, BA, { allocation_set_no: 1 });
    for (const [ini, s] of [[INI1, "0.6"], [INI2, "0.3"]]) await c.query(`INSERT INTO benefit_allocation (id, organization_id, transformation_id, benefit_id, set_no, initiative_id, share, created_by) VALUES ($1, $2, $3, $4, 1, $5, $6, $7)`, [uid(), ORG, TR, BA, ini, s, U1]);
    const u = (await c.query(`SELECT (1 - sum(share))::text AS u FROM benefit_allocation WHERE benefit_id = $1 AND set_no = 1`, [BA])).rows[0].u;
    if (u !== "0.100000") throw new Error(u);
    return `unallocated ${u}`;
  });
  await expectFailure(c, "A03 a row for a set that is not the current one is refused", /benefit_allocation_current_set/, async () => {
    await c.query(`INSERT INTO benefit_allocation (id, organization_id, transformation_id, benefit_id, set_no, initiative_id, share, created_by) VALUES ($1, $2, $3, $4, 2, $5, '0.1', $6)`, [uid(), ORG, TR, BA, INI1, U1]);
  });
  await expectFailure(c, "A04 UPDATE on benefit_allocation is refused (append-only)", /append-only/, async () => {
    await c.query(`UPDATE benefit_allocation SET share = 0.1 WHERE benefit_id = $1`, [BA]);
  });
  await expectFailure(c, "A05 a zero share is refused", /benefit_allocation_share_check/, async () => {
    await bset(c, BA, { allocation_set_no: 2 });
    await c.query(`INSERT INTO benefit_allocation (id, organization_id, transformation_id, benefit_id, set_no, initiative_id, share, created_by) VALUES ($1, $2, $3, $4, 2, $5, 0, $6)`, [uid(), ORG, TR, BA, INI1, U1]);
  });
  await expectFailure(c, "A06 the allocation set number steps by one", /benefit_allocation_set_step/, async () => {
    await bset(c, BA, { allocation_set_no: 5 });
  });
  {
    // Concurrency: two sessions add 0.6 to the same current set; the second waits on lock 730232 and is refused.
    const BC = await inTx(c, async () => {
      const b = await benefit(c);
      await bset(c, b, { allocation_set_no: 1 });
      return b;
    });
    const c1 = await client("probe_fresh");
    const c2 = await client("probe_fresh");
    await c1.query("BEGIN");
    await c1.query(`INSERT INTO benefit_allocation (id, organization_id, transformation_id, benefit_id, set_no, initiative_id, share, created_by) VALUES ($1, $2, $3, $4, 1, $5, '0.6', $6)`, [uid(), ORG, TR, BC, INI1, U1]);
    await c2.query("BEGIN");
    const second = c2.query(`INSERT INTO benefit_allocation (id, organization_id, transformation_id, benefit_id, set_no, initiative_id, share, created_by) VALUES ($1, $2, $3, $4, 1, $5, '0.6', $6)`, [uid(), ORG, TR, BC, INI2, U1]).then(
      async () => { await c2.query("COMMIT"); return "committed"; },
      async (e: any) => { await c2.query("ROLLBACK"); return `${e.constraint ?? ""} ${e.message}`; },
    );
    await new Promise((r) => setTimeout(r, 300));
    await c1.query("COMMIT");
    const outcome = await second;
    report("A07 concurrent 60 % + 60 % on one set: the second waits on lock 730232 and is refused", /benefit_allocation_total/.test(outcome), outcome);
    await c1.end();
    await c2.end();
  }

  // --- Shared-benefit groups (REQ-PB-058).
  const G1 = uid();
  await inTx(c, async () => {
    await c.query(`INSERT INTO benefit_group (id, organization_id, transformation_id, code, title, created_by, updated_by) VALUES ($1, $2, $3, 'BG-01', 'Synthetic pool', $4, $4)`, [G1, ORG, TR, U1]);
    await audit(c, "benefit_group", G1, 1);
  });
  const GM1 = await inTx(c, () => benefit(c, { benefit_group_id: G1 }));
  const GM2 = await inTx(c, () => benefit(c, { benefit_group_id: G1 }));
  await expectFailure(c, "GR01 the counted benefit of a group must be a member", /benefit_group_counted_member/, async () => {
    await c.query(`UPDATE benefit_group SET counted_benefit_id = $2, version = 2 WHERE id = $1`, [G1, B1]);
  });
  await inTx(c, async () => {
    await c.query(`UPDATE benefit_group SET counted_benefit_id = $2, version = 2 WHERE id = $1`, [G1, GM1]);
    await audit(c, "benefit_group", G1, 2);
  });
  await expectFailure(c, "GR02 the counted member cannot leave its group", /benefit_group_counted_member/, async () => {
    await bset(c, GM1, { benefit_group_id: null });
  });

  // --- Parent/child (counted once).
  const BP = await inTx(c, () => benefit(c));
  const BCH = await inTx(c, () => benefit(c, { parent_benefit_id: BP }));
  await expectFailure(c, "PC01 parent/child is one level deep", /benefit_parent_depth/, async () => {
    await benefit(c, { parent_benefit_id: BCH });
  });
  await expectFailure(c, "PC02 a parent benefit carries no values of its own", /benefit_plan_value_leaf_only/, async () => {
    await c.query(`INSERT INTO benefit_plan_value (id, organization_id, transformation_id, benefit_id, value_kind, period_start, period_end, amount, currency, created_by, updated_by) VALUES ($1, $2, $3, $4, 'planned', '2026-01-01', '2026-12-31', 10, 'SAR', $5, $5)`, [uid(), ORG, TR, BP, U1]);
  });
  await expectFailure(c, "PC03 a child uses its parent's currency", /benefit_parent_currency/, async () => {
    await benefit(c, { parent_benefit_id: BP, currency: "USD" });
  });

  // --- Plan and forecast values; scenarios (REQ-S08-001, REQ-S08-018).
  const plan = async (b: string, kind: string, amount: string | null, start = "2026-01-01", o: Record<string, unknown> = {}): Promise<string> => {
    const id = uid();
    await c.query(`INSERT INTO benefit_plan_value (id, organization_id, transformation_id, benefit_id, value_kind, period_start, period_end, amount, kpi_value, currency, created_by, updated_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`, [id, ORG, TR, b, kind, start, `${start.slice(0, 4)}-12-31`, amount, o.kpi_value ?? null, o.currency ?? "SAR", U1]);
    await audit(c, "benefit_plan_value", id, 1);
    return id;
  };
  const BCX = await inTx(c, () => benefit(c, { benefit_type: "cx", value_class: "non_financial", financial_statement_line: null, measurement_kpi_definition_id: KPI_CX }));
  await expectFailure(c, "P01 a CX plan value in SAR without an approved method is refused (REQ-S08-010)", /benefit_plan_value_unmonetised/, async () => {
    await plan(BCX, "planned", "5000");
  });
  await expectFailure(c, "P02 a plan value in another currency than the benefit's is refused", /benefit_plan_value_currency/, async () => {
    await plan(B1, "planned", "5000", "2026-01-01", { currency: "USD" });
  });
  await expectFailure(c, "P03 a plan value without its audit event fails at COMMIT", /benefit_plan_value_audit_required/, async () => {
    await c.query(`INSERT INTO benefit_plan_value (id, organization_id, transformation_id, benefit_id, value_kind, period_start, period_end, amount, currency, created_by, updated_by) VALUES ($1, $2, $3, $4, 'forecast', '2026-01-01', '2026-12-31', 10, 'SAR', $5, $5)`, [uid(), ORG, TR, B1, U1]);
  });
  await inTx(c, async () => {
    await plan(B1, "planned", "0.1");
    await plan(B1, "planned", "0.2", "2027-01-01");
    await plan(B1, "forecast", "999999");
    await plan(BCX, "planned", null, "2026-01-01", { kpi_value: "45" });
  });
  {
    const s = (await c.query(`SELECT sum(amount)::text AS t FROM benefit_value_line WHERE benefit_id = $1 AND value_state = 'planned'`, [B1])).rows[0].t;
    report("D01 decimal: planned 0.1 + 0.2 SAR = exactly 0.3000 (REQ-S16-025)", s === "0.3000", s);
    const p = (await c.query(`SELECT (100000::numeric(20,4) * 0.02::numeric * 50)::numeric(20,2)::text AS v`)).rows[0].v;
    report("D02 decimal: 100000 x 0.02 x 50 SAR = exactly 100000.00 in numeric", p === "100000.00", p);
  }
  const SC_BASE = uid();
  await inTx(c, async () => {
    await c.query(`INSERT INTO benefit_scenario (id, organization_id, transformation_id, kind, title, created_by, updated_by) VALUES ($1, $2, $3, 'upside', 'Synthetic upside', $4, $4)`, [SC_BASE, ORG, TR, U1]);
    await audit(c, "benefit_scenario", SC_BASE, 1);
  });
  await expectFailure(c, "SC01 one active scenario per kind and transformation", /benefit_scenario_one_kind_key/, async () => {
    const id = uid();
    await c.query(`INSERT INTO benefit_scenario (id, organization_id, transformation_id, kind, title, created_by, updated_by) VALUES ($1, $2, $3, 'upside', 'Second upside', $4, $4)`, [id, ORG, TR, U1]);
  });
  await expectFailure(c, "SC02 a scenario value in another currency is refused", /benefit_scenario_value_currency/, async () => {
    await c.query(`INSERT INTO benefit_scenario_value (id, organization_id, transformation_id, scenario_id, benefit_id, period_start, period_end, amount, currency, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, '2026-01-01', '2026-12-31', 1, 'USD', $6, $6)`, [uid(), ORG, TR, SC_BASE, B1, U1]);
  });
  await expectSuccess(c, "SC03 an upside scenario value is stored apart and appears in no value line (REQ-S08-018)", async () => {
    const id = uid();
    await c.query(`INSERT INTO benefit_scenario_value (id, organization_id, transformation_id, scenario_id, benefit_id, period_start, period_end, amount, currency, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, '2026-01-01', '2026-12-31', 7777777, 'SAR', $6, $6)`, [id, ORG, TR, SC_BASE, B1, U1]);
    await audit(c, "benefit_scenario_value", id, 1);
    const n = (await c.query(`SELECT count(*)::int AS n FROM benefit_value_line WHERE amount = 7777777`)).rows[0].n;
    if (n !== 0) throw new Error(`${n} lines`);
    return "0 lines with the scenario amount";
  });

  // --- Measurements and Finance validation (REQ-S07-014, REQ-S08-015..-017, REQ-S12-014).
  await expectFailure(c, "M01 a measurement of a benefit before Measure is refused (an enabler is not realized value)", /benefit_measurement_step/, async () => {
    await measurement(c, BA);
  });
  await expectFailure(c, "M02 the measurement number steps by one", /benefit_measurement_no_step/, async () => {
    await measurement(c, B1, { measurement_no: 3 });
  });
  await expectFailure(c, "M03 a submitted measurement needs its measurement period", /benefit_measurement_period_required/, async () => {
    await measurement(c, B1, { period_start: null, period_end: null });
  });
  await expectFailure(c, "M04 a measurement without its audit event fails at COMMIT", /benefit_measurement_audit_required/, async () => {
    await measurement(c, B1, {}, false);
  });
  await expectFailure(c, "M05 a measurement in another currency is refused", /benefit_measurement_currency/, async () => {
    await measurement(c, B1, { currency: "USD" });
  });
  let M1 = "";
  let Q1 = "";
  await expectSuccess(c, "M06 submitting a measurement + one queue item leaves the validated total unchanged (REQ-S08-016)", async () => {
    M1 = await measurement(c, B1);
    Q1 = await queueItem(c, B1, M1);
    const t = await validatedTotal(c, B1);
    if (t !== "0") throw new Error(t);
    const sub = (await c.query(`SELECT sum(amount)::text AS t FROM benefit_value_line WHERE benefit_id = $1 AND value_state = 'submitted'`, [B1])).rows[0].t;
    return `validated ${t}; submitted (pending) ${sub}`;
  });
  await expectFailure(c, "M07 a second live measurement of the same benefit and period is refused (counted once)", /benefit_measurement_period_key/, async () => {
    await measurement(c, B1);
  });
  await expectFailure(c, "FV01 a replayed submission cannot create a second queue item (REQ-S12-014)", /finance_validation_one_per_measurement|finance_validation_idempotency_key/, async () => {
    await queueItem(c, B1, M1, { idempotency_key: `replay:${M1}` });
  });
  await expectFailure(c, "FV02 the same idempotency key is refused", /finance_validation_idempotency_key/, async () => {
    const m = await measurement(c, B1, { period_start: "2026-04-01", period_end: "2026-06-30" });
    await queueItem(c, B1, m, { idempotency_key: `benefit.evidence_submitted:${M1}` });
  });
  await expectFailure(c, "FV03 a validation without a measurement period is refused (REQ-S08-015)", /finance_validation_period_required/, async () => {
    const m = await measurement(c, B1, { period_start: "2026-04-01", period_end: "2026-06-30" });
    await queueItem(c, B1, m, { measurement_period_start: null, measurement_period_end: null });
  });
  await expectFailure(c, "FV04 a validation snapshot lacking one of the six items is refused", /finance_validation_content_complete/, async () => {
    const m = await measurement(c, B1, { period_start: "2026-04-01", period_end: "2026-06-30" });
    await queueItem(c, B1, m, { content: JSON.stringify({ baseline: {}, attribution: {}, calculation: {}, evidence: [], assumptions: "" }) });
  });
  await expectFailure(c, "FV05 approving with an item not accepted is refused", /finance_validation_all_items_accepted/, async () => {
    await c.query(`UPDATE finance_validation SET status = 'approved', ${ALL_ACCEPTED.replace("period_decision = 'accepted'", "period_decision = 'rejected'")}, approved_amount = 250000, decided_by = $2, decided_at = now(), version = 2 WHERE id = $1`, [Q1, U4]);
  });
  await expectFailure(c, "FV06 rejecting without a note is refused", /finance_validation_rejection_reason/, async () => {
    await c.query(`UPDATE finance_validation SET status = 'rejected', ${ALL_ACCEPTED.replace("baseline_decision = 'accepted'", "baseline_decision = 'rejected'")}, decided_by = $2, decided_at = now(), version = 2 WHERE id = $1`, [Q1, U4]);
  });
  await expectFailure(c, "FV07 the submitter cannot validate their own submission", /finance_validation_sod/, async () => {
    await approve(c, Q1, M1, "250000", U3);
  });
  await expectFailure(c, "FV08 an approved financial value states its approved amount", /finance_validation_amount_shape/, async () => {
    await approve(c, Q1, M1, null);
  });
  await expectFailure(c, "FV09 a decision without its audit event fails at COMMIT", /finance_validation_audit_required/, async () => {
    await c.query(`UPDATE finance_validation SET status = 'approved', ${ALL_ACCEPTED}, approved_amount = 250000, decided_by = $2, decided_at = now(), version = 2 WHERE id = $1`, [Q1, U4]);
    await c.query(`UPDATE benefit_measurement SET status = 'validated', validated_amount = 250000, decided_by = $2, decided_at = now(), version = 2 WHERE id = $1`, [M1, U4]);
    await audit(c, "benefit_measurement", M1, 2);
  });
  await expectFailure(c, "M08 a measurement marked validated without the Finance decision fails at COMMIT", /benefit_measurement_decision_present/, async () => {
    await c.query(`UPDATE benefit_measurement SET status = 'validated', validated_amount = 250000, decided_by = $2, decided_at = now(), version = 2 WHERE id = $1`, [M1, U4]);
    await audit(c, "benefit_measurement", M1, 2);
  });
  await expectFailure(c, "M09 a submitted measurement's value is frozen", /benefit_measurement_submitted_frozen/, async () => {
    await c.query(`UPDATE benefit_measurement SET amount = 1, version = 2 WHERE id = $1`, [M1]);
  });
  await expectFailure(c, "M10 a non-stepping version (benefit_measurement)", /benefit_measurement_version_step/, async () => {
    await c.query(`UPDATE benefit_measurement SET reason = 'xyz', version = 9 WHERE id = $1`, [M1]);
  });
  // S08-008: a measurement computed with an unvalidated formula version stays provisional.
  const BR = await inTx(c, () => measuredBenefit(c, INI1, {}, FV_RAW));
  await inTx(c, () => bset(c, BR, { baseline_validation_status: "validated", baseline_validated_by: U4, baseline_validated_at: new Date().toISOString() }));
  await expectFailure(c, "M11 validating against an unvalidated comparison basis (formula version) is refused: provisional (REQ-S08-008)", /benefit_measurement_basis_validated/, async () => {
    const m = await measurement(c, BR, { formula_version_id: FV_RAW.v });
    const q = await queueItem(c, BR, m);
    await approve(c, q, m, "250000");
  });
  const BU2 = await inTx(c, () => measuredBenefit(c, INI1, {}, FV_OK));
  await expectFailure(c, "M12 validating while the benefit's baseline is unvalidated is refused: provisional (REQ-S08-008)", /benefit_measurement_basis_validated/, async () => {
    const m = await measurement(c, BU2, { formula_version_id: FV_OK.v });
    const q = await queueItem(c, BU2, m);
    await approve(c, q, m, "250000");
  });
  await expectSuccess(c, "M13 Finance approval with all six items accepted raises the validated total by exactly the approved amount", async () => {
    const before = await validatedTotal(c, B1);
    await approve(c, Q1, M1, "240000.5000");
    const after = await validatedTotal(c, B1);
    if (before !== "0" || after !== "240000.5000") throw new Error(`${before} -> ${after}`);
    return `${before} -> ${after}`;
  });
  await expectFailure(c, "M14 an in-place edit of a validated value is refused (REQ-S08-017; API 409)", /benefit_measurement_validated_immutable/, async () => {
    await c.query(`UPDATE benefit_measurement SET validated_amount = 1, version = 3 WHERE id = $1`, [M1]);
  });
  await expectFailure(c, "FV10 a decided validation is final", /finance_validation_status_step/, async () => {
    await c.query(`UPDATE finance_validation SET status = 'queued', version = 3 WHERE id = $1`, [Q1]);
  });
  const correction = async (kind: string, amount: string, o: Record<string, unknown> = {}): Promise<string> => {
    const m = await measurement(c, B1, { kind, corrects_measurement_id: M1, source: "correction", amount, validated_amount: amount, status: "validated",
      reason: "Synthetic correction", submitted_by: U4, decided_by: U4, decided_at: new Date().toISOString(), created_by: U4, updated_by: U4, ...o });
    await queueItem(c, B1, m, { kind, corrects_validation_id: Q1, status: "approved", reason: "Synthetic correction", decided_by: U4,
      decided_at: new Date().toISOString(), approved_amount: amount, idempotency_key: `correction:${m}`, created_by: U4, updated_by: U4 });
    return m;
  };
  await expectFailure(c, "M15 a reversal that does not net the original to zero is refused", /benefit_measurement_reversal_amount/, async () => {
    await correction("reversal", "-1000");
  });
  await expectFailure(c, "M16 a correction without its Finance correction record fails at COMMIT", /benefit_measurement_decision_present/, async () => {
    const m = await measurement(c, B1, { kind: "amendment", corrects_measurement_id: M1, source: "correction", amount: "-500.5000", validated_amount: "-500.5000", status: "validated",
      reason: "Synthetic", submitted_by: U4, decided_by: U4, decided_at: new Date().toISOString(), created_by: U4, updated_by: U4 });
    return void m;
  });
  await expectSuccess(c, "M17 an amendment (-500.5) then a reversal net the validated total to 0; all three rows stay visible", async () => {
    await correction("amendment", "-500.5000");
    const t1 = await validatedTotal(c, B1);
    await correction("reversal", "-239500.0000");
    const t2 = await validatedTotal(c, B1);
    const n = (await c.query(`SELECT count(*)::int AS n FROM benefit_measurement WHERE benefit_id = $1 AND status = 'validated'`, [B1])).rows[0].n;
    if (t1 !== "239500.0000" || t2 !== "0.0000" || n !== 3) throw new Error(`${t1} ${t2} ${n}`);
    return `after amendment ${t1}; after reversal ${t2}; validated rows ${n}`;
  });
  await expectFailure(c, "M18 a second reversal of the same original is refused", /benefit_measurement_already_reversed|benefit_measurement_one_reversal_key/, async () => {
    await correction("reversal", "0");
  });
  await expectSuccess(c, "M19 a rejected measurement is retained and shown as rejected (REQ-S08-001)", async () => {
    const m = await measurement(c, B1, { period_start: "2026-07-01", period_end: "2026-09-30" });
    const q = await queueItem(c, B1, m);
    await c.query(`UPDATE finance_validation SET status = 'rejected', ${ALL_ACCEPTED.replace("evidence_decision = 'accepted'", "evidence_decision = 'rejected'")}, decision_note = 'Evidence does not support the value', decided_by = $2, decided_at = now(), version = 2 WHERE id = $1`, [q, U4]);
    await audit(c, "finance_validation", q, 2);
    await c.query(`UPDATE benefit_measurement SET status = 'rejected', decided_by = $2, decided_at = now(), version = 2 WHERE id = $1`, [m, U4]);
    await audit(c, "benefit_measurement", m, 2);
    const r = (await c.query(`SELECT value_state, amount::text FROM benefit_value_line WHERE record_id = $1`, [m])).rows;
    if (r.length !== 1 || r[0].value_state !== "rejected") throw new Error(JSON.stringify(r));
    return JSON.stringify(r);
  });
  await expectFailure(c, "M20 an Unknown value (missing reason) is never validated", /benefit_measurement_missing_shape/, async () => {
    const m = await measurement(c, B1, { period_start: "2026-10-01", period_end: "2026-12-31", amount: null, missing_reason: "Source system outage" });
    const q = await queueItem(c, B1, m);
    await approve(c, q, m, null);
  });
  await expectFailure(c, "M21 a forecast never reaches the validated total; changing the class of a benefit with values is refused", /benefit_measure_locked/, async () => {
    const t = await validatedTotal(c, B1);
    if (t !== "0.0000") throw new Error(`validated ${t} includes the 999999 forecast`);
    await bset(c, B1, { value_class: "avoided_cost" });
  });

  // --- KPI-driven pending value (REQ-S07-014, REQ-S12-006) and lineage inputs (REQ-S08-006, REQ-S08-008).
  const KV = await inTx(c, () => kpiDef(c, "Synthetic volume", "count", null, "higher_is_better"));
  await inTx(c, async () => activateVersion(c, await kpiVersion(c, KV)));
  const PQ1 = await inTx(c, () => period(c, "2026-Q1", "2026-01-01", "2026-03-31", { frequency: "monthly" }));
  const PQ2 = await inTx(c, () => period(c, "2026-Q2", "2026-04-01", "2026-06-30", { frequency: "monthly" }));
  const ACT1 = await inTx(c, () => directActual(c, KV, PQ1, "200000"));
  const ACT2 = await inTx(c, () => directActual(c, KV, PQ2, "210000"));
  const RUN = await inTx(c, () => run(c, ACT1));
  const BK = await inTx(c, () => measuredBenefit(c, INI2, {}, FV_OK));
  let MK = "";
  await expectSuccess(c, "K01 a recalculated value enters 'submitted' (pending) with no submitter; the validated total is unchanged (REQ-S07-014)", async () => {
    MK = await measurement(c, BK, { source: "kpi_recalculation", calculation_run_id: RUN, submitted_by: null, formula_version_id: FV_OK.v, created_by: U1, updated_by: U1 });
    await queueItem(c, BK, MK, { idempotency_key: `benefit.value_recalculated:${MK}` });
    const t = await validatedTotal(c, BK);
    const pending = (await c.query(`SELECT amount::text FROM benefit_value_line WHERE record_id = $1 AND value_state = 'submitted'`, [MK])).rows[0].amount;
    if (t !== "0") throw new Error(t);
    return `pending ${pending}; validated ${t}`;
  });
  await expectFailure(c, "K02 a second pending value for the same benefit and run is refused (one flag per benefit and run)", /benefit_measurement_run_key/, async () => {
    await measurement(c, BK, { source: "kpi_recalculation", calculation_run_id: RUN, submitted_by: null, period_start: "2026-04-01", period_end: "2026-06-30" });
  });
  await expectFailure(c, "I01 a lineage input from another period than the measurement is refused (same period, REQ-S08-008)", /benefit_measurement_input_same_period/, async () => {
    await c.query(`INSERT INTO benefit_measurement_input (id, organization_id, transformation_id, measurement_id, variable_name, kpi_actual_id, kpi_value_no, value, period_start, period_end, created_by)
      VALUES ($1, $2, $3, $4, 'eligible_volume', $5, 1, 210000, '2026-01-01', '2026-03-31', $6)`, [uid(), ORG, TR, MK, ACT2, U1]);
  });
  await expectSuccess(c, "I02 a same-period input names the KPI actual value version (lineage, REQ-S08-006)", async () => {
    await c.query(`INSERT INTO benefit_measurement_input (id, organization_id, transformation_id, measurement_id, variable_name, kpi_actual_id, kpi_value_no, value, period_start, period_end, created_by)
      VALUES ($1, $2, $3, $4, 'eligible_volume', $5, 1, 200000, '2026-01-01', '2026-03-31', $6)`, [uid(), ORG, TR, MK, ACT1, U1]);
    return "input recorded";
  });
  await expectFailure(c, "I03 UPDATE on benefit_measurement_input is refused (append-only)", /append-only/, async () => {
    await c.query(`UPDATE benefit_measurement_input SET value = 1 WHERE measurement_id = $1`, [MK]);
  });
  const EV = await inTx(c, () => evidence(c));
  await expectFailure(c, "E01 evidence cannot be linked to a validated measurement", /benefit_evidence_measurement_open/, async () => {
    await c.query(`INSERT INTO benefit_evidence (id, organization_id, transformation_id, benefit_id, measurement_id, evidence_id, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [uid(), ORG, TR, B1, M1, EV, U1]);
  });
  await expectFailure(c, "E02 DELETE on benefit_evidence is refused (append-only)", /append-only/, async () => {
    await c.query(`INSERT INTO benefit_evidence (id, organization_id, transformation_id, benefit_id, measurement_id, evidence_id, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [uid(), ORG, TR, BK, MK, EV, U1]);
    await c.query(`DELETE FROM benefit_evidence WHERE measurement_id = $1`, [MK]);
  });
  await expectFailure(c, "EN01 an enabler deliverable must belong to the enabling initiative", /benefit_enabler_deliverable_initiative/, async () => {
    const d = await deliverable(c, INI2);
    await enabler(c, BA, INI1, d);
  });

  // --- Overlaps (REQ-S08-014).
  const [OA, OB] = [B1, BK].sort();
  await expectFailure(c, "O01 the pair is stored in id order", /benefit_overlap_pair_order/, async () => {
    await c.query(`INSERT INTO benefit_overlap (id, organization_id, transformation_id, benefit_a_id, benefit_b_id, dimensions, detected_by, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, '{driver,period}', 'rule', $6, $6)`, [uid(), ORG, TR, OB, OA, U1]);
  });
  const OV = uid();
  await inTx(c, async () => {
    await c.query(`INSERT INTO benefit_overlap (id, organization_id, transformation_id, benefit_a_id, benefit_b_id, dimensions, driver_key, detected_by, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, '{driver,period}', 'unit_cost:contact_centre', 'rule', $6, $6)`, [OV, ORG, TR, OA, OB, U1]);
    await audit(c, "benefit_overlap", OV, 1);
  });
  {
    const r = (await c.query(`SELECT count(*)::int AS n FROM benefit_counting WHERE benefit_id IN ($1, $2) AND overlap_open`, [OA, OB])).rows[0].n;
    report("O02 while the warning is open both benefits are flagged overlap_open (excluded from validated totals)", r === 2, `flagged ${r}`);
  }
  await expectFailure(c, "O03 a second open warning for the same pair is refused", /benefit_overlap_one_open_key/, async () => {
    await c.query(`INSERT INTO benefit_overlap (id, organization_id, transformation_id, benefit_a_id, benefit_b_id, dimensions, detected_by, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, '{population}', 'user', $6, $6)`, [uid(), ORG, TR, OA, OB, U1]);
  });
  await expectFailure(c, "O04 the owner of an overlapping benefit cannot resolve it", /benefit_overlap_resolver_not_owner/, async () => {
    await c.query(`UPDATE benefit_overlap SET status = 'resolved', resolution = 'no_economic_overlap', resolution_note = 'Different', resolved_by = $2, resolved_at = now(), version = 2 WHERE id = $1`, [OV, U3]);
  });
  await expectFailure(c, "O05 a 'duplicate' resolution names the excluded benefit", /benefit_overlap_resolution_complete/, async () => {
    await c.query(`UPDATE benefit_overlap SET status = 'resolved', resolution = 'duplicate', resolution_note = 'Same', resolved_by = $2, resolved_at = now(), version = 2 WHERE id = $1`, [OV, U4]);
  });
  await expectSuccess(c, "O06 Finance resolves 'duplicate': the excluded benefit is no longer counted", async () => {
    await c.query(`UPDATE benefit_overlap SET status = 'resolved', resolution = 'duplicate', excluded_benefit_id = $3, resolution_note = 'Same driver and period', resolved_by = $2, resolved_at = now(), version = 2 WHERE id = $1`, [OV, U4, BK]);
    await audit(c, "benefit_overlap", OV, 2);
    const r = (await c.query(`SELECT counted, exclusion_reason, overlap_open FROM benefit_counting WHERE benefit_id = $1`, [BK])).rows[0];
    if (r.counted || r.exclusion_reason !== "overlap_duplicate" || r.overlap_open) throw new Error(JSON.stringify(r));
    return JSON.stringify(r);
  });
  await expectFailure(c, "O07 a resolved warning is final", /benefit_overlap_status_step/, async () => {
    await c.query(`UPDATE benefit_overlap SET resolution_note = 'Changed', version = 3 WHERE id = $1`, [OV]);
  });

  // --- Counted once (REQ-PB-058, REQ-PB-076).
  {
    const T2 = await inTx(c, async () => {
      const b = await benefit(c, { title: "Synthetic shared 10 M SAR benefit" });
      await bset(c, b, { allocation_set_no: 1 });
      for (const [ini, s] of [[INI1, "0.5"], [INI2, "0.5"]]) await c.query(`INSERT INTO benefit_allocation (id, organization_id, transformation_id, benefit_id, set_no, initiative_id, share, created_by) VALUES ($1, $2, $3, $4, 1, $5, $6, $7)`, [uid(), ORG, TR, b, ini, s, U1]);
      await plan(b, "planned", "10000000");
      return b;
    });
    const tot = (await c.query(`SELECT sum(l.amount)::text AS t FROM benefit_value_line l JOIN benefit_counting k ON k.benefit_id = l.benefit_id
      WHERE l.benefit_id = $1 AND k.counted AND l.value_state = 'planned'`, [T2])).rows[0].t;
    report("T01 a 10 000 000 SAR benefit allocated to two initiatives is one line: the total is 10000000.0000, not 20 M", tot === "10000000.0000", tot);
    const k = await c.query(`SELECT benefit_id, counted, exclusion_reason FROM benefit_counting WHERE benefit_id IN ($1, $2, $3, $4)`, [BP, BCH, GM1, GM2]);
    const by = Object.fromEntries(k.rows.map((r: any) => [r.benefit_id, r.exclusion_reason ?? "counted"]));
    report("T02 a parent is a roll-up (not counted), its child is counted; only the group's counted member is counted",
      by[BP] === "parent_rollup" && by[BCH] === "counted" && by[GM1] === "counted" && by[GM2] === "group_member_not_counted", JSON.stringify(by));
    const cx = await c.query(`SELECT amount, kpi_value::text FROM benefit_value_line WHERE benefit_id = $1`, [BCX]);
    report("T03 a CX benefit's value line has Value n/a (amount NULL) and its KPI value; NULL is not summed as 0",
      cx.rowCount === 1 && cx.rows[0].amount === null && cx.rows[0].kpi_value === "45.000000", JSON.stringify(cx.rows));
  }

  await expectFailure(c, "L01 a benefit with values cannot become a parent", /benefit_parent_has_values/, async () => {
    await benefit(c, { parent_benefit_id: B1 });
  });

  await c.end();
  console.log(failures === 0 ? "PROBE RESULT: PASS (all guards fired as specified)" : `PROBE RESULT: FAIL (${failures} failing probe(s))`);
  process.exitCode = failures === 0 ? 0 : 1;
}
main().catch((e) => {
  console.error("PROBE ERROR", e);
  process.exit(2);
});
