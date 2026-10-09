// T-DG4-ARCH-04 migration and guard probe (solution-architect). Run against a DISPOSABLE cluster only:
//   QA_PG_PORT=<port in 23700-23749> MTH_PORT_POOL=23701-23749 tests/qa/support/with-pg.sh \
//     node --conditions=@mth/source docs/delivery/handbacks/DG4/T-DG4-ARCH-04-evidence/probe.ts
// 1. Fresh database: all migrations 0001..00NN.
// 2. P3-populated database: 0001..0027 with synthetic P1-P3 data (incl. a DG2 action and a T08 dependency), then
//    0028..00NN on top.
// 3. Guard probes on the slice E tables (ADR-0031). Every probe states the expected failure; "PASS" means the guard
//    fired (or, for an expectSuccess probe, that the allowed write committed). The harness and helpers are copied
//    from the T-DG4-ARCH-03 probe. All data is SYNTHETIC and approves nothing.
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

// ------------------------------------------------------------------------------------------------ slice E helpers
const SVC = null; // a worker (service) write has no app_user author
async function auditSvc(c: any, recordType: string, id: string, version: number): Promise<void> {
  await c.query(
    `INSERT INTO audit_event (id, organization_id, transformation_id, actor_type, actor_user_id, action, record_type, record_id, new_version, source)
     VALUES ($1, $2, $3, 'service', NULL, $4, $5, $6, $7, 'worker')`,
    [uid(), ORG, TR, `${recordType}.probe`, recordType, id, version],
  );
}
async function insertRow(c: any, table: string, row: Record<string, unknown>): Promise<void> {
  const cols = Object.keys(row);
  await c.query(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(row));
}
async function setRow(c: any, table: string, id: string, set: Record<string, unknown>, o: { audit?: boolean; svc?: boolean; step?: number } = {}): Promise<void> {
  const v = (await c.query(`SELECT version FROM ${table} WHERE id = $1`, [id])).rows[0].version;
  const nv = v + (o.step ?? 1);
  const cols = Object.keys(set);
  await c.query(`UPDATE ${table} SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(", ")}, version = ${nv}, updated_at = now() WHERE id = $1`, [id, ...Object.values(set)]);
  if (o.audit !== false) await (o.svc ? auditSvc(c, table, id, nv) : audit(c, table, id, nv));
}
let rseq = 1;
async function raid(c: any, o: Record<string, unknown> = {}, withAudit = true): Promise<string> {
  const id = uid();
  const type = (o.entry_type as string) ?? "risk";
  const prefix = type === "risk" ? "R" : type === "assumption" ? "A" : "I";
  const row: Record<string, unknown> = {
    id, organization_id: ORG, transformation_id: TR, entry_type: type, code: `${prefix}-${String(rseq++).padStart(2, "0")}`,
    description: "Synthetic RAID entry", impact: "high", probability: type === "risk" ? "medium" : null, owner_user_id: U3,
    due_date: "2026-11-30", mitigation: "Synthetic mitigation", created_by: U1, updated_by: U1, ...o,
  };
  await insertRow(c, "raid_entry", row);
  if (withAudit) await audit(c, "raid_entry", id, 1);
  return id;
}
let dseq = 1;
async function dependency(c: any, o: Record<string, unknown> = {}): Promise<string> {
  const id = uid();
  await insertRow(c, "dependency", {
    id, organization_id: ORG, transformation_id: TR, code: `DEP-${String(dseq++).padStart(2, "0")}`, description: "Synthetic dependency",
    from_kind: "external", from_label: "Vendor", to_kind: "other", to_label: "Go-live", dependency_type: "vendor", needed_by: "2026-12-15",
    owner_user_id: U1, created_by: U1, updated_by: U1, ...o,
  });
  await audit(c, "dependency", id, 1);
  return id;
}
let cseq = 1;
async function kase(c: any, o: Record<string, unknown> = {}, how: "worker" | "api" | "none" = "worker"): Promise<string> {
  const id = uid();
  const row: Record<string, unknown> = {
    id, organization_id: ORG, transformation_id: TR, code: `CA-${String(cseq++).padStart(2, "0")}`, source_kind: "control_check",
    source_scope_key: uid(), source_record_type: "control_check", source_record_id: uid(), title: "Synthetic recovery",
    owner_user_id: U3, follow_up_date: "2026-10-15", created_source: "worker", created_by: null, updated_by: null, ...o,
  };
  if (row.source_kind === "control_check" && o.source_scope_key === undefined) row.source_scope_key = row.source_record_id;
  await insertRow(c, "corrective_case", row);
  if (how === "worker") await auditSvc(c, "corrective_case", id, 1);
  if (how === "api") await audit(c, "corrective_case", id, 1);
  return id;
}
async function signal(c: any, o: Record<string, unknown> = {}): Promise<string> {
  const id = uid();
  await insertRow(c, "corrective_signal", {
    id, organization_id: ORG, transformation_id: TR, source_kind: "benefit_variance", source_scope_key: "b", source_event_key: `benefit.variance_evaluated:${id}`,
    period_key: "2026-09-01..2026-09-30", period_start: "2026-09-01", period_end: "2026-09-30", off_track: true, rule_persistence: 1,
    consecutive_off_track: 1, outcome: "recorded", payload: JSON.stringify({ synthetic: true }), ...o,
  });
  return id;
}
async function budget(c: any, ini: string, o: Record<string, unknown> = {}, withAudit = true): Promise<string> {
  const id = uid();
  await insertRow(c, "budget_line", {
    id, organization_id: ORG, transformation_id: TR, initiative_id: ini, label: "Synthetic opex", currency: "SAR",
    budget_amount: "0.1", actual_amount: "0.2", forecast_amount: null, created_by: U1, updated_by: U1, ...o,
  });
  if (withAudit) await audit(c, "budget_line", id, 1);
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
  report("G01 fresh database: 0001..last apply", applied.length === files.length, `applied ${applied.length}: ${applied.slice(38).join(", ")}`);

  // 2. P3-populated database (with a DG2 action and a T08 dependency), then P4 on top.
  await createDb("probe_p3");
  const p3Dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "p3-migrations-"));
  for (const f of files.filter((f) => Number(f.slice(0, 4)) <= LAST_P3)) cpSync(join(migrationsDir, f), join(p3Dir, f));
  const p3Applied = await migrate(roleUrl("probe_p3", "mth_owner"), { dir: p3Dir });
  const OLD_ACT = uid();
  const OLD_DEP = uid();
  {
    const c = await client("probe_p3");
    await seedP1(c);
    await c.query(`SELECT p3_instantiate_transformation($1, NULL, NULL, 'migration') AS n`, [TR]);
    await c.query("BEGIN");
    await c.query(`INSERT INTO action_item (id, organization_id, transformation_id, title, owner_user_id, created_by, updated_by) VALUES ($1, $2, $3, 'Synthetic DG2 action', $4, $4, $4)`, [OLD_ACT, ORG, TR, U1]);
    await audit(c, "action_item", OLD_ACT, 1);
    await c.query(`INSERT INTO dependency (id, organization_id, transformation_id, code, description, from_kind, to_kind, dependency_type, owner_user_id, created_by, updated_by)
      VALUES ($1, $2, $3, 'DEP-07', 'Synthetic DG3 dependency', 'external', 'other', 'vendor', $4, $4, $4)`, [OLD_DEP, ORG, TR, U1]);
    await audit(c, "dependency", OLD_DEP, 1);
    await c.query("COMMIT");
    report("G02 P3 database populated (0001-0027, a synthetic transformation, a DG2 action and a T08 dependency)", p3Applied.length === LAST_P3, `applied ${p3Applied.length}`);
    await c.end();
  }
  const p4OnTop = await migrate(roleUrl("probe_p3", "mth_owner"), { dir: migrationsDir });
  {
    const c = await client("probe_p3");
    report("G03 P4 over the P3 database: 0028+ apply", p4OnTop.length === files.length - LAST_P3, `applied ${p4OnTop.join(", ")}`);
    const a = await c.query(`SELECT version, status, raid_entry_id, dependency_id, corrective_case_id, follow_up_date FROM action_item WHERE id = $1`, [OLD_ACT]);
    const d = await c.query(`SELECT version, impact FROM dependency WHERE id = $1`, [OLD_DEP]);
    const r = await c.query(`SELECT entry_type, code, probability, impact, raid_status, record_table FROM raid_register WHERE id = $1`, [OLD_DEP]);
    report("G04 existing rows are unchanged by 0041-0043 (action version 1, new columns NULL; dependency version 1, impact NULL = Unknown)",
      a.rows[0].version === 1 && a.rows[0].raid_entry_id === null && a.rows[0].follow_up_date === null && d.rows[0].version === 1 && d.rows[0].impact === null, JSON.stringify([a.rows, d.rows]));
    report("G05 the pre-P4 T08 dependency is a RAID Dependency entry (DEP code kept, probability n/a, status open), with no copy",
      r.rowCount === 1 && r.rows[0].entry_type === "dependency" && r.rows[0].code === "DEP-07" && r.rows[0].probability === null && r.rows[0].raid_status === "open" && r.rows[0].record_table === "dependency", JSON.stringify(r.rows));
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
    const codes = ["raid.edit", "corrective_action.manage", "corrective_rule.configure", "budget.edit"];
    const p = await c.query(`SELECT code, category FROM permission WHERE code = ANY ($1) ORDER BY code`, [codes]);
    const adm = await c.query(`SELECT count(*)::int AS n FROM role_permission rp JOIN role r ON r.id = rp.role_id WHERE rp.permission_code = ANY ($1) AND (r.kind = 'technical_admin' OR r.code = 'AUD')`, [codes]);
    const grants = await c.query(`SELECT rp.permission_code AS p, string_agg(r.code, ',' ORDER BY r.code) AS roles FROM role_permission rp JOIN role r ON r.id = rp.role_id WHERE rp.permission_code = ANY ($1) GROUP BY 1 ORDER BY 1`, [codes]);
    report("S01 four slice E permissions (write/configure); none held by AUD or a technical admin; no approval category",
      p.rowCount === 4 && p.rows.every((r: any) => r.category === "write" || r.category === "configure") && adm.rows[0].n === 0, JSON.stringify([p.rows, grants.rows]));
    const g = Object.fromEntries(grants.rows.map((r: any) => [r.p, r.roles]));
    report("S02 role defaults: raid.edit TL,TO,WL (REQ-PB-079); corrective_action.manage BO,FIN,TL (REQ-PB-085); budget.edit FIN,TL (REQ-S09-007)",
      g["raid.edit"] === "TL,TO,WL" && g["corrective_action.manage"] === "BO,FIN,TL" && g["budget.edit"] === "FIN,TL" && g["corrective_rule.configure"] === "TL,TO", JSON.stringify(g));
    const w = await c.query(`SELECT code FROM work_item_kind WHERE owner_module = 'raid' ORDER BY code`);
    report("S03 the two slice E work-item kinds are seeded", w.rows.map((r: any) => r.code).join(",") === "corrective_case_follow_up,raid_action_due", JSON.stringify(w.rows));
  }
  await expectSuccess(c, "S04 record_code_counter accepts the R, A, I and CA prefixes", async () => {
    for (const p of ["R", "A", "I", "CA"]) await c.query(`INSERT INTO record_code_counter (transformation_id, prefix, last_value) VALUES ($1, $2, 0)`, [TR2, p]);
    return "4 counters";
  });
  await expectFailure(c, "S05 an unknown prefix is still refused", /record_code_counter_prefix_check/, async () => {
    await c.query(`INSERT INTO record_code_counter (transformation_id, prefix, last_value) VALUES ($1, 'X', 0)`, [TR2]);
  });

  const INI1 = await inTx(c, () => initiative(c, "INI-01"));
  const INI2 = await inTx(c, () => initiative(c, "INI-02"));

  // --- RAID entries (REQ-PB-079, REQ-PB-080).
  await expectFailure(c, "R01 a RAID entry without its audit event fails at COMMIT", /raid_entry_audit_required/, async () => {
    await raid(c, {}, false);
  });
  let RISK = "";
  await expectSuccess(c, "R02 a Risk with all nine T15 columns (ID, Type, Description, Impact, Probability, Owner, Due, Mitigation, Status) is created Open", async () => {
    RISK = await raid(c, { code: "R-01" });
    return JSON.stringify((await c.query(`SELECT code, entry_type, description, impact, probability, owner_user_id IS NOT NULL AS owner, due_date, mitigation, status FROM raid_entry WHERE id = $1`, [RISK])).rows[0]);
  });
  await expectFailure(c, "R03 a Risk without Probability is refused (REQ-PB-080)", /raid_entry_probability_applicable/, async () => {
    await raid(c, { probability: null });
  });
  await expectFailure(c, "R04 an Issue with Probability H is refused (REQ-PB-080)", /raid_entry_probability_applicable/, async () => {
    await raid(c, { entry_type: "issue", probability: "high" });
  });
  await expectFailure(c, "R05 an Assumption with Probability is refused (n/a, B0128)", /raid_entry_probability_applicable/, async () => {
    await raid(c, { entry_type: "assumption", probability: "low" });
  });
  let ASSUMPTION = "";
  await expectSuccess(c, "R06 an Assumption and an Issue without Probability are created", async () => {
    ASSUMPTION = await raid(c, { entry_type: "assumption" });
    await raid(c, { entry_type: "issue" });
    return JSON.stringify((await c.query(`SELECT code, entry_type, probability FROM raid_entry WHERE entry_type <> 'risk' ORDER BY code`)).rows);
  });
  await expectFailure(c, "R07 a Type outside Risk/Assumption/Issue is refused by the closed-set CHECKs (type list and type-code format; Dependency entries are canonical dependency rows)", /raid_entry_entry_type_check|raid_entry_code_format/, async () => {
    await raid(c, { entry_type: "opportunity", code: "R-90" });
  });
  await expectFailure(c, "R08 a code that does not match its type is refused", /raid_entry_code_format/, async () => {
    await raid(c, { entry_type: "issue", code: "R-91" });
  });
  await expectFailure(c, "R09 impact outside H/M/L is refused", /raid_entry_impact_check/, async () => {
    await raid(c, { impact: "critical" });
  });
  await expectFailure(c, "R10 a duplicate code in one transformation is refused", /raid_entry_code_key/, async () => {
    await raid(c, { code: "R-01" });
  });
  await expectFailure(c, "R11 a new entry must start Open (B0128 Status: Open)", /raid_entry_starts_open/, async () => {
    await raid(c, { status: "in_progress" });
  });
  await expectFailure(c, "R12 organization_id must equal the transformation's", /raid_entry_organization_matches/, async () => {
    await raid(c, { organization_id: ORG2, owner_user_id: UX, created_by: UX, updated_by: UX });
  });
  await expectFailure(c, "R13 a version that does not step by 1 is refused", /raid_entry_version_step/, async () => {
    await setRow(c, "raid_entry", RISK, { impact: "low" }, { step: 2 });
  });
  await expectFailure(c, "R14 an update without its audit event fails at COMMIT", /raid_entry_audit_required/, async () => {
    await setRow(c, "raid_entry", RISK, { impact: "low" }, { audit: false });
  });
  await expectFailure(c, "R15 the type is immutable", /raid_entry_type_immutable/, async () => {
    await setRow(c, "raid_entry", RISK, { entry_type: "issue", code: "I-77", probability: null });
  });
  await expectFailure(c, "R16 closing without a closure note is refused", /raid_entry_closed_complete/, async () => {
    await setRow(c, "raid_entry", RISK, { status: "closed", closed_at: new Date().toISOString(), closed_by: U1 });
  });
  await expectSuccess(c, "R17 open -> in_progress -> closed with a note is allowed", async () => {
    await setRow(c, "raid_entry", RISK, { status: "in_progress" });
    await setRow(c, "raid_entry", RISK, { status: "closed", closed_at: new Date().toISOString(), closed_by: U1, closure_note: "Synthetic: mitigated" });
    return JSON.stringify((await c.query(`SELECT status, version FROM raid_entry WHERE id = $1`, [RISK])).rows[0]);
  });
  await expectFailure(c, "R18 a closed entry is final (no edit, no reopening)", /raid_entry_closed_final/, async () => {
    await setRow(c, "raid_entry", RISK, { status: "open", closed_at: null, closed_by: null, closure_note: null });
  });

  // --- RAID Dependency entries = the canonical dependency (REQ-PB-078).
  let DEP = "";
  await expectSuccess(c, "D01 a T08 dependency with impact H is a RAID Dependency entry in raid_register", async () => {
    DEP = await dependency(c, { impact: "high", from_kind: "initiative", from_initiative_id: INI1, to_kind: "initiative", to_initiative_id: INI2 });
    return JSON.stringify((await c.query(`SELECT entry_type, code, impact, probability, due_date, raid_status FROM raid_register WHERE id = $1`, [DEP])).rows[0]);
  });
  await expectFailure(c, "D02 a dependency impact outside H/M/L is refused", /dependency_impact_check/, async () => {
    await dependency(c, { impact: "x" });
  });
  await expectSuccess(c, "D03 editing the dependency's owner (as T08 does) changes the same RAID entry; there is no second copy (A01)", async () => {
    await setRow(c, "dependency", DEP, { owner_user_id: U3 });
    const r = await c.query(`SELECT owner_user_id, version, record_table FROM raid_register WHERE id = $1`, [DEP]);
    if (r.rowCount !== 1 || r.rows[0].owner_user_id !== U3 || r.rows[0].version !== 2) throw new Error(`register row ${JSON.stringify(r.rows)}`);
    return JSON.stringify(r.rows);
  });
  await expectSuccess(c, "D04 a resolved dependency shows RAID status closed; an archived one is not listed", async () => {
    await setRow(c, "dependency", DEP, { status: "resolved" });
    const d2 = await dependency(c);
    await setRow(c, "dependency", d2, { status: "archived", archived_at: new Date().toISOString(), archived_by: U1, archive_reason: "Synthetic" });
    const r = await c.query(`SELECT id, raid_status, record_status FROM raid_register WHERE id = ANY ($1)`, [[DEP, d2]]);
    if (r.rowCount !== 1 || r.rows[0].raid_status !== "closed") throw new Error(JSON.stringify(r.rows));
    return JSON.stringify(r.rows);
  });
  {
    const r = await c.query(`SELECT count(*)::int AS n FROM raid_register WHERE entry_type = 'dependency' AND probability IS NOT NULL`);
    const types = await c.query(`SELECT DISTINCT entry_type FROM raid_register ORDER BY 1`);
    report("D05 no RAID Dependency entry has a Probability; the register has exactly the four T15 types",
      r.rows[0].n === 0 && types.rows.map((t: any) => t.entry_type).join(",") === "assumption,dependency,issue,risk", JSON.stringify(types.rows));
  }

  // --- Actions (extended).
  let ACT = "";
  await expectSuccess(c, "AC01 an action linked to a RAID entry with a follow-up date is created (person-authored)", async () => {
    ACT = uid();
    await insertRow(c, "action_item", { id: ACT, organization_id: ORG, transformation_id: TR, title: "Synthetic mitigation step", owner_user_id: U3, due_date: "2026-11-01", follow_up_date: "2026-10-20", raid_entry_id: ASSUMPTION, created_by: U1, updated_by: U1 });
    await audit(c, "action_item", ACT, 1);
    return "ok";
  });
  await expectFailure(c, "AC02 an action with two sources is refused", /action_item_one_source/, async () => {
    const id = uid();
    await insertRow(c, "action_item", { id, organization_id: ORG, transformation_id: TR, title: "x", owner_user_id: U3, raid_entry_id: ASSUMPTION, dependency_id: DEP, created_by: U1, updated_by: U1 });
    await audit(c, "action_item", id, 1);
  });
  await expectFailure(c, "AC03 the source link is immutable", /action_item_source_immutable/, async () => {
    await setRow(c, "action_item", ACT, { raid_entry_id: null, dependency_id: DEP });
  });
  await expectFailure(c, "AC04 an action cannot link a RAID entry of another transformation", /action_item_raid_entry_id_fkey/, async () => {
    const id = uid();
    await insertRow(c, "action_item", { id, organization_id: ORG, transformation_id: TR2, title: "x", owner_user_id: U3, raid_entry_id: ASSUMPTION, created_by: U1, updated_by: U1 });
  });
  await expectFailure(c, "AC05 a worker cannot create an action without a human author (created_by stays NOT NULL)", /created_by/, async () => {
    const id = uid();
    await insertRow(c, "action_item", { id, organization_id: ORG, transformation_id: TR, title: "x", owner_user_id: U3, created_by: null, updated_by: null });
  });

  // --- Corrective-action rules.
  const rule = (o: Record<string, unknown>) => ({ id: uid(), organization_id: ORG, transformation_id: TR, source_kind: "kpi_deviation", min_kpi_rag: "red", persistence_cycles: 2, follow_up_working_days: 5, created_by: U1, updated_by: U1, ...o });
  let RULE = "";
  await expectSuccess(c, "RU01 a two-cycle red KPI rule is stored", async () => {
    const r = rule({});
    RULE = r.id as string;
    await insertRow(c, "corrective_action_rule", r);
    await audit(c, "corrective_action_rule", RULE, 1);
    return "kpi_deviation red x2";
  });
  await expectFailure(c, "RU02 a KPI rule without a severity is refused", /corrective_action_rule_severity_kpi_only/, async () => {
    await insertRow(c, "corrective_action_rule", rule({ transformation_id: TR2, min_kpi_rag: null }));
  });
  await expectFailure(c, "RU03 a benefit rule with a KPI severity is refused", /corrective_action_rule_severity_kpi_only/, async () => {
    await insertRow(c, "corrective_action_rule", rule({ source_kind: "benefit_variance" }));
  });
  await expectFailure(c, "RU04 a check rule with persistence > 1 is refused (a failed check is one event)", /corrective_action_rule_persistence_series_only/, async () => {
    await insertRow(c, "corrective_action_rule", rule({ source_kind: "control_check", min_kpi_rag: null }));
  });
  await expectFailure(c, "RU05 a second rule for the same source is refused", /corrective_action_rule_source_key/, async () => {
    await insertRow(c, "corrective_action_rule", rule({}));
  });
  await expectFailure(c, "RU06 the source kind is immutable", /corrective_action_rule_source_immutable/, async () => {
    await setRow(c, "corrective_action_rule", RULE, { source_kind: "benefit_variance", min_kpi_rag: null });
  });
  await expectFailure(c, "RU07 a rule change without its audit event fails at COMMIT", /corrective_action_rule_audit_required/, async () => {
    await setRow(c, "corrective_action_rule", RULE, { persistence_cycles: 3 }, { audit: false });
  });

  // --- Corrective-action cases (REQ-PB-085, REQ-S12-016).
  const KPI = await inTx(c, () => kpiDef(c, "Synthetic churn score", "score", null, "lower_is_better"));
  const kpiCase = (o: Record<string, unknown> = {}) => ({ source_kind: "kpi_deviation", source_scope_key: `${KPI}:transformation:${TR}`, kpi_definition_id: KPI, kpi_scope_kind: "transformation", kpi_scope_id: TR, source_record_type: null, source_record_id: null, consecutive_off_track: 2, ...o });
  await expectFailure(c, "C01 a worker case without its (service) audit event fails at COMMIT", /corrective_case_audit_required/, async () => {
    await kase(c, kpiCase(), "none");
  });
  let KC = "";
  await expectSuccess(c, "C02 a KPI deviation persisting two cycles opens one case (worker: no human author, service audit actor)", async () => {
    KC = await kase(c, kpiCase());
    await signal(c, { source_kind: "kpi_deviation", source_scope_key: `${KPI}:transformation:${TR}`, observed_rag: "red", rule_persistence: 2, consecutive_off_track: 2, outcome: "case_created", corrective_case_id: KC });
    return JSON.stringify((await c.query(`SELECT code, status, created_source, created_by, consecutive_off_track FROM corrective_case WHERE id = $1`, [KC])).rows[0]);
  });
  await expectFailure(c, "C03 a second open case for the same KPI and scope is refused (never duplicated)", /corrective_case_one_open_key/, async () => {
    await kase(c, kpiCase());
  });
  await expectSuccess(c, "C04 the third off-track cycle UPDATES the open case (service update: version +1, updated_by NULL)", async () => {
    await setRow(c, "corrective_case", KC, { consecutive_off_track: 3, signal_count: 2, last_signal_at: new Date().toISOString() }, { svc: true });
    const n = await c.query(`SELECT count(*)::int AS n, max(version) AS v, max(consecutive_off_track) AS k FROM corrective_case WHERE source_scope_key = $1`, [`${KPI}:transformation:${TR}`]);
    if (n.rows[0].n !== 1 || n.rows[0].v !== 2 || n.rows[0].k !== 3) throw new Error(JSON.stringify(n.rows));
    return JSON.stringify(n.rows);
  });
  await expectFailure(c, "C05 a new case cannot start in progress", /corrective_case_starts_open/, async () => {
    await kase(c, { status: "in_progress" });
  });
  await expectFailure(c, "C06 the source of a case is immutable", /corrective_case_source_immutable/, async () => {
    await setRow(c, "corrective_case", KC, { source_scope_key: "other" }, { svc: true });
  });
  await expectFailure(c, "C07 a KPI case without its KPI is refused (source fields per kind)", /corrective_case_source_fields/, async () => {
    await kase(c, kpiCase({ kpi_definition_id: null, kpi_scope_kind: null, kpi_scope_id: null, source_scope_key: "x" }));
  });
  await expectFailure(c, "C08 a benefit case carrying KPI fields is refused", /corrective_case_source_fields/, async () => {
    const B = await benefit(c);
    await kase(c, { source_kind: "benefit_variance", source_scope_key: B, benefit_id: B, kpi_definition_id: KPI, kpi_scope_kind: "transformation", kpi_scope_id: TR, source_record_type: null, source_record_id: null });
  });
  await expectFailure(c, "C09 a worker cannot create a Value Review case (person-only)", /corrective_case_created_source/, async () => {
    await kase(c, { source_kind: "value_review", source_scope_key: "vr-1", source_record_type: null, source_record_id: null });
  });
  await expectFailure(c, "C10 a person's Value Review case needs an owner", /corrective_case_created_source/, async () => {
    await kase(c, { source_kind: "value_review", source_scope_key: "vr-2", source_record_type: null, source_record_id: null, created_source: "api", created_by: U1, updated_by: U1, owner_user_id: null }, "api");
  });
  await expectFailure(c, "C11 a person's Value Review case needs a follow-up date", /corrective_case_created_source/, async () => {
    await kase(c, { source_kind: "value_review", source_scope_key: "vr-3", source_record_type: null, source_record_id: null, created_source: "api", created_by: U1, updated_by: U1, follow_up_date: null }, "api");
  });
  await expectSuccess(c, "C12 a person's Value Review case with owner and follow-up date is created", async () => {
    const id = await kase(c, { source_kind: "value_review", source_scope_key: "vr-4", source_record_type: null, source_record_id: null, created_source: "api", created_by: U4, updated_by: U4 }, "api");
    return id;
  });
  let CHK = "";
  const CHECK_ID = uid();
  await expectSuccess(c, "C13 a failed control check opens one owned case with a follow-up date (REQ-S12-016)", async () => {
    CHK = await kase(c, { source_record_id: CHECK_ID, source_scope_key: CHECK_ID });
    return JSON.stringify((await c.query(`SELECT code, owner_user_id IS NOT NULL AS owned, follow_up_date FROM corrective_case WHERE id = $1`, [CHK])).rows[0]);
  });
  await expectFailure(c, "C14 closing without a closure note is refused", /corrective_case_closed_complete/, async () => {
    await setRow(c, "corrective_case", CHK, { status: "closed", closed_at: new Date().toISOString(), closed_by: U3, updated_by: U3 });
  });
  await expectSuccess(c, "C15 the owner closes the case with a note", async () => {
    await setRow(c, "corrective_case", CHK, { status: "closed", closed_at: new Date().toISOString(), closed_by: U3, closure_note: "Synthetic: control re-tested", updated_by: U3 });
    return "closed";
  });
  await expectFailure(c, "C16 a closed case is final", /corrective_case_closed_final/, async () => {
    await setRow(c, "corrective_case", CHK, { title: "edited" });
  });
  await expectFailure(c, "C17 the same failed check never gets a second case, even after closure (one per failed check)", /corrective_case_one_per_check_key/, async () => {
    await kase(c, { source_record_id: CHECK_ID, source_scope_key: CHECK_ID });
  });
  let NOOWNER = "";
  await expectSuccess(c, "C18 a worker case whose owner does not resolve is stored unassigned (visible), never silently skipped", async () => {
    NOOWNER = await kase(c, { owner_user_id: null, follow_up_date: null });
    return NOOWNER;
  });
  await expectFailure(c, "C19 a case without an owner cannot be closed", /corrective_case_owner_required/, async () => {
    await setRow(c, "corrective_case", NOOWNER, { status: "closed", closed_at: new Date().toISOString(), closed_by: U1, closure_note: "x closes", updated_by: U1 });
  });
  await expectSuccess(c, "C20 after a KPI case is closed, a NEW off-track run opens a new case (no reopening)", async () => {
    await setRow(c, "corrective_case", KC, { status: "closed", closed_at: new Date().toISOString(), closed_by: U1, closure_note: "Synthetic: back on track", updated_by: U1 });
    const k2 = await kase(c, kpiCase());
    return k2;
  });
  await expectFailure(c, "C21 a version that does not step by 1 is refused", /corrective_case_version_step/, async () => {
    await setRow(c, "corrective_case", NOOWNER, { title: "x" }, { step: 3, svc: true });
  });
  await expectFailure(c, "C22 an API case without a human author is refused", /corrective_case_created_source/, async () => {
    await kase(c, { source_kind: "value_review", source_scope_key: "vr-5", source_record_type: null, source_record_id: null, created_source: "api", created_by: null, updated_by: null }, "worker");
  });

  // --- Signal log (append-only).
  let SG = "";
  await expectSuccess(c, "SG01 a signal is lineage: inserted without an audit event of its own", async () => {
    SG = await signal(c);
    return SG;
  });
  await expectFailure(c, "SG02 a redelivered source event is refused by its unique key", /corrective_signal_event_key/, async () => {
    const key = (await c.query(`SELECT source_event_key FROM corrective_signal WHERE id = $1`, [SG])).rows[0].source_event_key;
    await signal(c, { source_event_key: key });
  });
  await expectFailure(c, "SG03 UPDATE on the signal log is refused", /append-only/, async () => {
    await c.query(`UPDATE corrective_signal SET off_track = false WHERE id = $1`, [SG]);
  });
  await expectFailure(c, "SG04 DELETE on the signal log is refused", /append-only/, async () => {
    await c.query(`DELETE FROM corrective_signal WHERE id = $1`, [SG]);
  });
  await expectFailure(c, "SG05 TRUNCATE on the signal log is refused", /append-only/, async () => {
    await c.query(`TRUNCATE corrective_signal`);
  });
  await expectFailure(c, "SG06 a 'case_created' signal must name its case", /corrective_signal_outcome_case/, async () => {
    await signal(c, { outcome: "case_created" });
  });
  await expectFailure(c, "SG07 a benefit signal cannot carry a KPI RAG", /corrective_signal_rag_kpi_only/, async () => {
    await signal(c, { observed_rag: "red" });
  });
  await expectSuccess(c, "SG08 an Unknown signal (off_track NULL) is recorded as Unknown, not as on-track", async () => {
    const id = await signal(c, { off_track: null, consecutive_off_track: 0 });
    return JSON.stringify((await c.query(`SELECT off_track FROM corrective_signal WHERE id = $1`, [id])).rows[0]);
  });

  // --- Budget lines (REQ-S09-007).
  await expectFailure(c, "BU01 a budget line without its audit event fails at COMMIT", /budget_line_audit_required/, async () => {
    await budget(c, INI1, {}, false);
  });
  let BL = "";
  await expectSuccess(c, "BU02 decimal SAR: budget 0.1 + actual 0.2 = 0.3000 exactly (numeric, never float); forecast NULL stays Unknown", async () => {
    BL = await budget(c, INI1);
    const r = await c.query(`SELECT (budget_amount + actual_amount)::text AS s, forecast_amount, currency FROM budget_line WHERE id = $1`, [BL]);
    if (r.rows[0].s !== "0.3000" || r.rows[0].forecast_amount !== null) throw new Error(JSON.stringify(r.rows));
    return JSON.stringify(r.rows[0]);
  });
  await expectSuccess(c, "BU03 100000 x 0.02 x 50 = 100000.0000 on a stored amount", async () => {
    const id = await budget(c, INI1, { label: "Synthetic capex", budget_amount: "100000" });
    const r = await c.query(`SELECT (budget_amount * 0.02 * 50)::numeric(20,4)::text AS v FROM budget_line WHERE id = $1`, [id]);
    if (r.rows[0].v !== "100000.0000") throw new Error(r.rows[0].v);
    return r.rows[0].v;
  });
  await expectFailure(c, "BU04 a negative amount is refused", /budget_line_forecast_amount_check/, async () => {
    await budget(c, INI1, { label: "neg", forecast_amount: "-1" });
  });
  await expectFailure(c, "BU05 a period that is not the first day of a month is refused", /budget_line_period_month_check/, async () => {
    await budget(c, INI1, { label: "mid", period_month: "2026-10-15" });
  });
  await expectFailure(c, "BU06 a lower-case currency code is refused", /budget_line_currency_check/, async () => {
    await budget(c, INI1, { label: "cur", currency: "sar" });
  });
  await expectFailure(c, "BU07 the currency is immutable (amounts are never converted)", /budget_line_currency_locked/, async () => {
    await setRow(c, "budget_line", BL, { currency: "USD" });
  });
  await expectFailure(c, "BU08 a second active line with the same label (any case) and month is refused", /budget_line_active_key/, async () => {
    await budget(c, INI1, { label: "SYNTHETIC OPEX" });
  });
  await expectFailure(c, "BU09 archiving without a reason is refused", /budget_line_archive_complete/, async () => {
    await setRow(c, "budget_line", BL, { status: "archived", archived_at: new Date().toISOString(), archived_by: U1 });
  });
  await expectSuccess(c, "BU10 archive with a reason; the same label can then be used again", async () => {
    await setRow(c, "budget_line", BL, { status: "archived", archived_at: new Date().toISOString(), archived_by: U1, archive_reason: "Synthetic re-plan" });
    await budget(c, INI1);
    return "archived and replaced";
  });
  await expectFailure(c, "BU11 an archived line is frozen", /budget_line_archived_frozen/, async () => {
    await setRow(c, "budget_line", BL, { note: "late edit" });
  });
  await expectFailure(c, "BU12 a version that does not step by 1 is refused", /budget_line_version_step/, async () => {
    const id = (await c.query(`SELECT id FROM budget_line WHERE status = 'active' LIMIT 1`)).rows[0].id;
    await setRow(c, "budget_line", id, { note: "x" }, { step: 0 });
  });

  // --- Initiative durations (REQ-S09-009 input).
  const sched = (ini: string, o: Record<string, unknown> = {}) => ({ id: uid(), organization_id: ORG, transformation_id: TR, initiative_id: ini, duration_working_days: 10, created_by: U1, updated_by: U1, ...o });
  await expectFailure(c, "SC01 a duration row without its audit event fails at COMMIT", /initiative_schedule_audit_required/, async () => {
    await insertRow(c, "initiative_schedule", sched(INI1));
  });
  let SCH = "";
  await expectSuccess(c, "SC02 an initiative gets one duration row (10 working days); NULL means missing input", async () => {
    const r = sched(INI1);
    SCH = r.id as string;
    await insertRow(c, "initiative_schedule", r);
    await audit(c, "initiative_schedule", SCH, 1);
    const r2 = sched(INI2, { duration_working_days: null });
    await insertRow(c, "initiative_schedule", r2);
    await audit(c, "initiative_schedule", r2.id as string, 1);
    return "INI-01 10 wd, INI-02 missing";
  });
  await expectFailure(c, "SC03 a second duration row for one initiative is refused", /initiative_schedule_initiative_key/, async () => {
    await insertRow(c, "initiative_schedule", sched(INI1));
  });
  await expectFailure(c, "SC04 a negative duration is refused", /initiative_schedule_duration_working_days_check/, async () => {
    await insertRow(c, "initiative_schedule", sched(uid(), { duration_working_days: -1 }));
  });
  await expectFailure(c, "SC05 the initiative of a duration row is immutable", /initiative_schedule_initiative_immutable/, async () => {
    await setRow(c, "initiative_schedule", SCH, { initiative_id: INI2 });
  });

  // --- Privileges of the application role.
  const app = await client("probe_fresh", "mth_app");
  await expectFailure(app, "P01 mth_app cannot DELETE a RAID entry (no DELETE grant)", /permission denied/, async () => {
    await app.query(`DELETE FROM raid_entry WHERE id = $1`, [ASSUMPTION]);
  });
  await expectFailure(app, "P02 mth_app cannot UPDATE the signal log (INSERT, SELECT only)", /permission denied/, async () => {
    await app.query(`UPDATE corrective_signal SET outcome = 'recorded' WHERE id = $1`, [SG]);
  });
  await expectFailure(app, "P03 mth_app cannot write the raid_register view (SELECT grant only; a UNION view is not updatable)", /permission denied|cannot (insert|update)/, async () => {
    await app.query(`UPDATE raid_register SET description = 'x' WHERE id = $1`, [ASSUMPTION]);
  });
  await app.end();

  await c.end();
  console.log(failures === 0 ? "PROBE RESULT: PASS (all guards fired as specified)" : `PROBE RESULT: FAIL (${failures} failing probe(s))`);
  process.exitCode = failures === 0 ? 0 : 1;
}
main().catch((e) => {
  console.error("PROBE ERROR", e);
  process.exit(2);
});
