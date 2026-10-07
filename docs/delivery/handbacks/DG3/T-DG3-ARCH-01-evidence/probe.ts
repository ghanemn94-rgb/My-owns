// T-DG3-ARCH-01 migration and guard probe (solution-architect). Run against a DISPOSABLE cluster only:
//   QA_PG_PORT=<port<32768> tests/qa/support/with-pg.sh \
//     node --conditions=@mth/source docs/delivery/handbacks/DG3/T-DG3-ARCH-01-evidence/probe.ts
// 1. Fresh database: all migrations 0001..00NN.
// 2. P2-populated database: 0001..0019, synthetic P2 data (a transformation with its P2 starter structure and a DG2
//    dependency), then 0020..00NN on top (backfill check).
// 3. Guard probes on the new P3 tables. Every probe states the expected failure; "PASS" means the guard fired.
import { cpSync, mkdtempSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "../../../../../packages/db/src/migrate.ts";

const pg = createRequire(new URL("../../../../../packages/db/package.json", import.meta.url))("pg");
const admin = process.env.TEST_DATABASE_ADMIN_URL!;
const migrationsDir = new URL("../../../../../packages/db/migrations", import.meta.url).pathname;
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
  try { await c.query(sql); } finally { await c.end(); }
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
/** Runs fn in a transaction that must fail (at statement or COMMIT) with a message matching `expect`. */
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
const U1 = "01990000-0000-7000-8000-000000000003";
const U2 = "01990000-0000-7000-8000-000000000004";
const TR = "01990000-0000-7000-8000-000000000005";
let seq = 100;
const uid = () => `01990000-0000-7000-8000-${(seq++).toString(16).padStart(12, "0")}`;

async function seedP1(c: any): Promise<void> {
  await c.query(`INSERT INTO organization (id, code, name_en, name_ar) VALUES ($1, 'SYN-PROBE', 'Synthetic probe org', 'منظمة تجريبية')`, [ORG]);
  await c.query(`INSERT INTO app_user (id, organization_id, display_name) VALUES ($1, $3, 'Synthetic TL'), ($2, $3, 'Synthetic SP')`, [U1, U2, ORG]);
  await c.query(`INSERT INTO business_unit (id, organization_id, code, name_en, name_ar) VALUES ($1, $2, 'SYN-BU', 'Synthetic BU', 'وحدة تجريبية')`, [BU, ORG]);
  await c.query(`INSERT INTO transformation (id, organization_id, business_unit_id, code, name, mode, current_phase, timezone, currency, created_by, updated_by)
                 VALUES ($1, $2, $3, 'SYN-T1', 'Synthetic transformation', 'end_to_end', 'diagnose', 'Asia/Riyadh', 'SAR', $4, $4)`, [TR, ORG, BU, U1]);
}
async function audit(c: any, recordType: string, id: string, version: number | null): Promise<void> {
  await c.query(`INSERT INTO audit_event (id, organization_id, transformation_id, actor_type, actor_user_id, action, record_type, record_id, new_version, source)
                 VALUES ($1, $2, $3, 'user', $4, $5, $6, $7, $8, 'cli')`, [uid(), ORG, TR, U1, `${recordType}.probe`, recordType, id, version]);
}
async function newInitiative(c: any, code: string): Promise<string> {
  const id = uid();
  await c.query(`INSERT INTO initiative (id, organization_id, transformation_id, code, name, created_by, updated_by)
                 VALUES ($1, $2, $3, $4, $5, $6, $6)`, [id, ORG, TR, code, `Synthetic ${code}`, U1]);
  await audit(c, "initiative", id, 1);
  return id;
}
async function newDependency(c: any, code: string, from: string, to: string): Promise<string> {
  const id = uid();
  await c.query(`INSERT INTO dependency (id, organization_id, transformation_id, code, description, from_kind, to_kind, dependency_type,
                   from_initiative_id, to_initiative_id, created_by, updated_by)
                 VALUES ($1, $2, $3, $4, 'Synthetic dependency', 'initiative', 'initiative', 'tech', $5, $6, $7, $7)`, [id, ORG, TR, code, from, to, U1]);
  await audit(c, "dependency", id, 1);
  return id;
}

async function main(): Promise<void> {
  const files = readdirSync(migrationsDir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  console.log(`migrations shipped: ${files.length} (${files[0]} .. ${files[files.length - 1]})`);

  // 1. Fresh database.
  await createDb("probe_fresh");
  const applied = await migrate(roleUrl("probe_fresh", "mth_owner"), { dir: migrationsDir });
  report("fresh database: all migrations apply", applied.length === files.length, `applied ${applied.length}: ${applied.slice(19).join(", ")}`);

  // 2. P2-populated database, then P3 on top.
  await createDb("probe_p2");
  const p2Dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "p2-migrations-"));
  for (const f of files.filter((f) => Number(f.slice(0, 4)) <= 19)) cpSync(join(migrationsDir, f), join(p2Dir, f));
  const p2Applied = await migrate(roleUrl("probe_p2", "mth_owner"), { dir: p2Dir });
  {
    const c = await client("probe_p2");
    await seedP1(c);
    const n = await c.query(`SELECT p2_instantiate_transformation($1, NULL, NULL, 'migration') AS n`, [TR]);
    const dep = uid();
    await c.query(`BEGIN`);
    await c.query(`INSERT INTO dependency (id, organization_id, transformation_id, code, description, from_kind, from_label, to_kind, to_label, dependency_type, created_by, updated_by)
                   VALUES ($1, $2, $3, 'DEP-01', 'Synthetic DG2 dependency', 'external', 'Vendor X', 'tom_dimension', 'Technology', 'other', $4, $4)`, [dep, ORG, TR, U1]);
    await audit(c, "dependency", dep, 1);
    await c.query(`COMMIT`);
    report("P2 database populated (0001-0019 + synthetic transformation, P2 starter rows, DG2 dependency)", p2Applied.length === 19, `applied ${p2Applied.length}, p2 starter rows ${n.rows[0].n}`);
    await c.end();
  }
  const p3OnTop = await migrate(roleUrl("probe_p2", "mth_owner"), { dir: migrationsDir });
  {
    const c = await client("probe_p2");
    const waves = await c.query(`SELECT code, name_en, horizon_en, entry_criteria_en FROM roadmap_wave WHERE transformation_id = $1 ORDER BY ordinal`, [TR]);
    const ws = await c.query(`SELECT s.version_no, s.status, s.approval_basis, string_agg(w.criterion_code || '=' || w.weight_percent, ',' ORDER BY w.criterion_code) AS w
                              FROM scoring_weight_set s JOIN scoring_weight w ON w.weight_set_id = s.id WHERE s.transformation_id = $1 GROUP BY 1, 2, 3`, [TR]);
    const dep = await c.query(`SELECT code, dependency_type, from_initiative_id FROM dependency WHERE transformation_id = $1`, [TR]);
    const auditRows = await c.query(`SELECT count(*)::int AS n FROM audit_event WHERE source = 'migration' AND record_type IN ('roadmap_wave', 'scoring_weight_set')`);
    report("P3 over P2 database: 0020+ apply", p3OnTop.length === files.length - 19, `applied ${p3OnTop.join(", ")}`);
    report("backfill: four source waves verbatim", waves.rowCount === 4 && waves.rows[0].name_en === "Wave 0 — Mobilize" && waves.rows[0].horizon_en === "0-6 weeks" && waves.rows[0].entry_criteria_en === "Sponsor + charter",
      JSON.stringify(waves.rows));
    report("backfill: weight set v1 = 25/25/20/15/15, active, source_default", ws.rowCount === 1 && ws.rows[0].w === "customer_impact=20.00,feasibility=15.00,financial_value=25.00,strategic_fit=25.00,time_to_value=15.00",
      JSON.stringify(ws.rows));
    report("backfill audited as migration/system", auditRows.rows[0].n === 5, `audit rows ${auditRows.rows[0].n}`);
    report("DG2 dependency row survives (type 'other' now an FK to a system type)", dep.rowCount === 1 && dep.rows[0].dependency_type === "other", JSON.stringify(dep.rows));
    const again = await c.query(`SELECT p3_instantiate_transformation($1, NULL, NULL, 'migration') AS n`, [TR]);
    report("p3_instantiate_transformation is idempotent", again.rows[0].n === 0, `second run created ${again.rows[0].n}`);
    await c.end();
  }

  // 3. Guard probes on the fresh database.
  const c = await client("probe_fresh");
  await seedP1(c);
  await c.query(`SELECT p3_instantiate_transformation($1, $2, 'probe', 'cli')`, [TR, U1]);
  const counts = await c.query(`SELECT (SELECT count(*) FROM roadmap_wave)::int AS waves, (SELECT count(*) FROM scoring_weight)::int AS weights,
     (SELECT count(*) FROM dependency_type WHERE is_system)::int AS sys_types, (SELECT count(*) FROM benefit_formula_example)::int AS examples,
     (SELECT count(*) FROM gate_criterion_definition WHERE key LIKE 'g4.%')::int AS g4,
     (SELECT submission_enabled FROM gate_definition WHERE code = 'G4') AS g4_enabled`);
  report("fresh instantiate + seeds", counts.rows[0].waves === 4 && counts.rows[0].weights === 5 && counts.rows[0].sys_types === 5 && counts.rows[0].examples === 2 && counts.rows[0].g4 === 8 && counts.rows[0].g4_enabled === false,
    JSON.stringify(counts.rows[0]));

  await expectFailure(c, "P01 initiative insert WITHOUT its audit event fails at COMMIT", /initiative_audit_required/, async () => {
    await c.query(`INSERT INTO initiative (id, organization_id, transformation_id, code, name, created_by, updated_by) VALUES ($1, $2, $3, 'INI-90', 'No audit', $4, $4)`, [uid(), ORG, TR, U1]);
  });
  let a = "";
  await expectSuccess(c, "P02 initiative insert WITH its audit event commits", async () => { a = await newInitiative(c, "INI-01"); return a; });
  await expectFailure(c, "P03 initiative version must step by exactly 1", /initiative_version_step/, async () => {
    await c.query(`UPDATE initiative SET name = 'x', version = version + 2 WHERE id = $1`, [a]);
  });
  await expectFailure(c, "P04 initiative illegal status edge draft -> launched", /initiative_status_transition/, async () => {
    await c.query(`UPDATE initiative SET status = 'launched', launched_at = now(), launched_by = $2, version = version + 1 WHERE id = $1`, [a, U1]);
    await audit(c, "initiative", a, 2);
  });
  await expectFailure(c, "P05 milestone UPDATE without audit fails at COMMIT", /milestone_audit_required/, async () => {
    const m = uid();
    await c.query(`INSERT INTO milestone (id, organization_id, transformation_id, initiative_id, title, created_by, updated_by) VALUES ($1, $2, $3, $4, 'M1', $5, $5)`, [m, ORG, TR, a, U1]);
  });
  await expectFailure(c, "P06 weight set totalling 95% fails at COMMIT", /scoring_weight_set_total/, async () => {
    const s = uid();
    await c.query(`INSERT INTO scoring_weight_set (id, organization_id, transformation_id, version_no, created_by, updated_by) VALUES ($1, $2, $3, 2, $4, $4)`, [s, ORG, TR, U1]);
    await audit(c, "scoring_weight_set", s, 1);
    for (const [code, w] of [["strategic_fit", 20], ["financial_value", 25], ["customer_impact", 20], ["feasibility", 15], ["time_to_value", 15]] as const)
      await c.query(`INSERT INTO scoring_weight (id, organization_id, transformation_id, weight_set_id, criterion_code, weight_percent, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [uid(), ORG, TR, s, code, w, U1]);
  });
  await expectSuccess(c, "P07 weight set v2 with risk_compliance 10 and strategic_fit 15 (total 100) commits", async () => {
    const s = uid();
    await c.query(`INSERT INTO scoring_weight_set (id, organization_id, transformation_id, version_no, created_by, updated_by) VALUES ($1, $2, $3, 2, $4, $4)`, [s, ORG, TR, U1]);
    await audit(c, "scoring_weight_set", s, 1);
    for (const [code, w] of [["strategic_fit", 15], ["financial_value", 25], ["customer_impact", 20], ["feasibility", 15], ["time_to_value", 15], ["risk_compliance", 10]] as const)
      await c.query(`INSERT INTO scoring_weight (id, organization_id, transformation_id, weight_set_id, criterion_code, weight_percent, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [uid(), ORG, TR, s, code, w, U1]);
    return `weight set ${s} version 2`;
  });
  await expectFailure(c, "P08 scoring_weight is append-only (UPDATE)", /append-only/, async () => {
    await c.query(`UPDATE scoring_weight SET weight_percent = 30 WHERE criterion_code = 'strategic_fit'`);
  });
  await expectFailure(c, "P09 scoring_weight is append-only (DELETE)", /append-only/, async () => {
    await c.query(`DELETE FROM scoring_weight`);
  });
  await expectFailure(c, "P10 initiative score 6 is refused", /initiative_score_score_check/, async () => {
    await c.query(`INSERT INTO initiative_score (id, organization_id, transformation_id, initiative_id, criterion_code, score, scored_by, scored_at, created_by, updated_by)
                   VALUES ($1, $2, $3, $4, 'feasibility', 6, $5, now(), $5, $5)`, [uid(), ORG, TR, a, U1]);
  });
  const b = await (async () => { await c.query("BEGIN"); const x = await newInitiative(c, "INI-02"); await c.query("COMMIT"); return x; })();
  const ci = await (async () => { await c.query("BEGIN"); const x = await newInitiative(c, "INI-03"); await c.query("COMMIT"); return x; })();
  await expectSuccess(c, "P11 dependencies INI-01 -> INI-02 -> INI-03 commit", async () => {
    await newDependency(c, "DEP-01", a, b);
    await newDependency(c, "DEP-02", b, ci);
    return "two edges";
  });
  await expectFailure(c, "P12 cycle-closing INI-03 -> INI-01 refused by the database, naming the cycle", /dependency_acyclic.*INI-03 -> INI-01 -> INI-02 -> INI-03/, async () => {
    await newDependency(c, "DEP-03", ci, a);
  });
  await expectFailure(c, "P13 two-node cycle INI-02 -> INI-01 refused the same way", /dependency_acyclic.*INI-02 -> INI-01 -> INI-02/, async () => {
    await newDependency(c, "DEP-04", b, a);
  });
  {
    // P14 race: two connections each add one half of a two-node cycle concurrently; exactly one may commit.
    const d = await (async () => { await c.query("BEGIN"); const x = await newInitiative(c, "INI-04"); const y = await newInitiative(c, "INI-05"); await c.query("COMMIT"); return [x, y]; })();
    const c1 = await client("probe_fresh");
    const c2 = await client("probe_fresh");
    await c1.query("BEGIN");
    await c2.query("BEGIN");
    await newDependency(c1, "DEP-10", d[0]!, d[1]!);
    const p2 = newDependency(c2, "DEP-11", d[1]!, d[0]!).then(() => c2.query("COMMIT")).then(() => "committed", (e: any) => `${e.constraint ?? ""} ${e.message}`);
    await new Promise((r) => setTimeout(r, 300));
    await c1.query("COMMIT");
    const second = await p2;
    if (!/committed/.test(second)) await c2.query("ROLLBACK").catch(() => undefined);
    const n = await c.query(`SELECT count(*)::int AS n FROM dependency WHERE code IN ('DEP-10', 'DEP-11')`);
    report("P14 concurrent A->B / B->A: exactly one commits (advisory lock + guard)", n.rows[0].n === 1 && /dependency_acyclic/.test(second), `second writer: ${second}; rows committed ${n.rows[0].n}`);
    await c1.end(); await c2.end();
  }
  await expectFailure(c, "P15 system dependency type cannot be deleted", /dependency_type_system_undeletable/, async () => {
    await c.query(`DELETE FROM dependency_type WHERE code = 'vendor'`);
  });
  await expectFailure(c, "P16 system dependency type cannot be retired", /dependency_type_system/, async () => {
    await c.query(`UPDATE dependency_type SET status = 'retired', version = version + 1 WHERE code = 'decision'`);
  });
  await expectFailure(c, "P17 unknown dependency type refused", /dependency_type_active|dependency_dependency_type_fkey/, async () => {
    const id = uid();
    await c.query(`INSERT INTO dependency (id, organization_id, transformation_id, code, description, from_kind, from_label, to_kind, dependency_type, to_initiative_id, created_by, updated_by)
                   VALUES ($1, $2, $3, 'DEP-20', 'x', 'external', 'Vendor', 'initiative', 'telepathy', $4, $5, $5)`, [id, ORG, TR, a, U1]);
  });
  // Business case: a line with two classes.
  let bc = "";
  await expectSuccess(c, "P18 transformation-level business case commits", async () => {
    bc = uid();
    await c.query(`INSERT INTO business_case (id, organization_id, transformation_id, code, level, title, currency, created_by, updated_by) VALUES ($1, $2, $3, 'BC-01', 'transformation', 'Synthetic case', 'SAR', $4, $4)`, [bc, ORG, TR, U1]);
    await audit(c, "business_case", bc, 1);
    return bc;
  });
  await expectFailure(c, "P19 business case line with two classes refused", /business_case_line_one_class/, async () => {
    const l = uid();
    await c.query(`INSERT INTO business_case_line (id, organization_id, transformation_id, business_case_id, line_kind, investment_class, benefit_class, value_basis, title, amount, currency, created_by, updated_by)
                   VALUES ($1, $2, $3, $4, 'investment', 'capex', 'revenue', 'cash', 'Two classes', 1000.50, 'SAR', $5, $5)`, [l, ORG, TR, bc, U1]);
    await audit(c, "business_case_line", l, 1);
  });
  await expectFailure(c, "P20 an initiative case must link to a transformation case", /business_case_parent_is_transformation|business_case_level_shape/, async () => {
    const x = uid();
    await c.query(`INSERT INTO business_case (id, organization_id, transformation_id, code, level, initiative_id, parent_case_id, title, currency, created_by, updated_by)
                   VALUES ($1, $2, $3, 'BC-02', 'initiative', $4, NULL, 'Orphan', 'SAR', $5, $5)`, [x, ORG, TR, a, U1]);
  });
  // Formula version immutability and validation SoD.
  const f = uid(); const v = uid();
  await expectSuccess(c, "P21 benefit formula + version 1 commit", async () => {
    await c.query(`INSERT INTO benefit_formula (id, organization_id, transformation_id, code, benefit_name, confidence, created_by, updated_by) VALUES ($1, $2, $3, 'BF-01', 'Revenue uplift', 'M', $4, $4)`, [f, ORG, TR, U1]);
    await audit(c, "benefit_formula", f, 1);
    await c.query(`INSERT INTO benefit_formula_version (id, organization_id, transformation_id, formula_id, version_no, expression, expression_sha256, result_kind, result_currency, result_period, preview_result, engine_version, created_by, updated_by)
                   VALUES ($1, $2, $3, $4, 1, 'delta * customers * arpu', repeat('a', 64), 'currency', 'SAR', 'year', 100000, 'probe', $5, $5)`, [v, ORG, TR, f, U1]);
    await audit(c, "benefit_formula_version", v, 1);
    return v;
  });
  await expectFailure(c, "P22 benefit formula confidence outside H/M/L refused", /benefit_formula_confidence_check/, async () => {
    await c.query(`UPDATE benefit_formula SET confidence = 'X', version = version + 1 WHERE id = $1`, [f]);
  });
  await expectFailure(c, "P23 formula version expression is immutable", /benefit_formula_version_immutable/, async () => {
    await c.query(`UPDATE benefit_formula_version SET expression = 'delta * 2', version = version + 1 WHERE id = $1`, [v]);
  });
  await expectFailure(c, "P24 the author cannot Finance-validate their own formula version", /benefit_formula_version_validator_not_author/, async () => {
    await c.query(`UPDATE benefit_formula_version SET validation_status = 'validated', validated_by = $2, validated_at = now(), version = version + 1 WHERE id = $1`, [v, U1]);
  });
  await expectFailure(c, "P25 benefit_calculation (lineage) is append-only", /append-only/, async () => {
    await c.query(`INSERT INTO benefit_calculation (id, organization_id, transformation_id, formula_version_id, inputs, outcome, result, result_kind, result_currency, result_period, engine_version, computed_by)
                   VALUES ($1, $2, $3, $4, '{}', 'ok', 100000, 'currency', 'SAR', 'year', 'probe', $5)`, [uid(), ORG, TR, v, U1]);
    await c.query(`UPDATE benefit_calculation SET result = 1`);
  });
  await expectSuccess(c, "P26a ranking snapshot + entry and a funding decision (canonical executive decision) commit", async () => {
    const ws = (await c.query(`SELECT id FROM scoring_weight_set WHERE transformation_id = $1 AND version_no = 1`, [TR])).rows[0].id;
    const snap = uid();
    await c.query(`INSERT INTO ranking_snapshot (id, organization_id, transformation_id, snapshot_no, weight_set_id, proposed_by, created_by, updated_by) VALUES ($1, $2, $3, 1, $4, $5, $5, $5)`, [snap, ORG, TR, ws, U1]);
    await audit(c, "ranking_snapshot", snap, 1);
    await c.query(`INSERT INTO ranking_entry (id, organization_id, transformation_id, snapshot_id, initiative_id, completeness, causes, created_by) VALUES ($1, $2, $3, $4, $5, 'incomplete', ARRAY['new'], $6)`, [uid(), ORG, TR, snap, a, U1]);
    const dec = uid();
    await c.query(`INSERT INTO decision (id, organization_id, transformation_id, kind, code, title, status, decided_by, decided_at, created_by, updated_by) VALUES ($1, $2, $3, 'executive', 'DEC-01', 'Fund INI-01 (synthetic)', 'decided', $4, now(), $5, $5)`, [dec, ORG, TR, U2, U1]);
    await audit(c, "decision", dec, 1);
    const fd = uid();
    await c.query(`INSERT INTO funding_decision (id, organization_id, transformation_id, initiative_id, decision_id, outcome, amount, currency, rationale, approver_role_code, decided_by) VALUES ($1, $2, $3, $4, $5, 'approved', 250000.5000, 'SAR', 'Synthetic funding decision; approves nothing real.', 'FIN', $6)`, [fd, ORG, TR, a, dec, U2]);
    await audit(c, "funding_decision", fd, null);
    return `snapshot ${snap}, funding_decision ${fd}`;
  });
  await expectFailure(c, "P26 ranking_entry is append-only (DELETE)", /append-only/, async () => {
    await c.query(`DELETE FROM ranking_entry`);
  });
  await expectFailure(c, "P27 funding_decision is append-only (UPDATE)", /append-only/, async () => {
    await c.query(`UPDATE funding_decision SET outcome = 'rejected'`);
  });
  await expectFailure(c, "P27b funding decision without its audit event fails at COMMIT", /funding_decision_audit_required/, async () => {
    const dec = uid();
    await c.query(`INSERT INTO decision (id, organization_id, transformation_id, kind, code, title, status, decided_by, decided_at, created_by, updated_by) VALUES ($1, $2, $3, 'executive', 'DEC-02', 'x', 'decided', $4, now(), $5, $5)`, [dec, ORG, TR, U2, U1]);
    await audit(c, "decision", dec, 1);
    await c.query(`INSERT INTO funding_decision (id, organization_id, transformation_id, initiative_id, decision_id, outcome, currency, rationale, approver_role_code, decided_by) VALUES ($1, $2, $3, $4, $5, 'rejected', 'SAR', 'No audit', 'FIN', $6)`, [uid(), ORG, TR, a, dec, U2]);
  });
  await expectFailure(c, "P28 gate_decision_agreement only for an approved G1 decision", /gate_decision_agreement_g1_approved|foreign key/, async () => {
    await c.query(`INSERT INTO gate_decision_agreement (id, organization_id, transformation_id, gate_decision_id, agreement_code, confirmed_by) VALUES ($1, $2, $3, $4, 'problem', $5)`, [uid(), ORG, TR, uid(), U1]);
  });
  await expectFailure(c, "P29 seeded wave source text is immutable", /roadmap_wave_source_immutable/, async () => {
    await c.query(`UPDATE roadmap_wave SET horizon_en = '0-8 weeks', version = version + 1 WHERE code = 'wave_0'`);
  });
  await expectFailure(c, "P30 inherited approval without evidence refused", /gate_dispensation_inherited_shape/, async () => {
    await c.query(`INSERT INTO gate_dispensation (id, organization_id, transformation_id, kind, gate_code, approving_body, approved_on, recorded_by, created_by, updated_by)
                   VALUES ($1, $2, $3, 'inherited_approval', 'G1', 'Steering committee', '2026-01-01', $4, $4, $4)`, [uid(), ORG, TR, U1]);
  });
  await expectFailure(c, "P31 mth_app cannot DELETE an initiative (no DELETE grant)", /permission denied/, async () => {
    const app = await client("probe_fresh", "mth_app");
    try { await app.query(`DELETE FROM initiative`); } finally { await app.end(); }
  });
  await c.end();
  console.log(failures === 0 ? "PROBE RESULT: PASS (all guards fired as specified)" : `PROBE RESULT: FAIL (${failures} failing probe(s))`);
  process.exitCode = failures === 0 ? 0 : 1;
}
main().catch((e) => { console.error("PROBE ERROR", e); process.exitCode = 2; });
