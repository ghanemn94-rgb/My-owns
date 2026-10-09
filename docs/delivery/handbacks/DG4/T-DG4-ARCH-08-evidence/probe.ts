// T-DG4-ARCH-08 migration and guard probe (solution-architect). Run against a DISPOSABLE cluster only:
//   QA_PG_PORT=<port in 23700-23749> MTH_PORT_POOL=23701-23749 tests/qa/support/with-pg.sh \
//     node --conditions=@mth/source docs/delivery/handbacks/DG4/T-DG4-ARCH-08-evidence/probe.ts
// 1. Fresh database: all migrations 0001..last.
// 2. P3-populated database: 0001..0027 with synthetic P1-P3 data (an initiative with an outcome/KPI contribution), then
//    0028..last on top.
// 3. Guard probes on the slice J and K tables (ADR-0037, ADR-0038). Every probe states the expected failure; "PASS"
//    means the guard fired (or, for an expectSuccess probe, that the allowed write committed). The harness is copied
//    from the T-DG4-ARCH-07 probe. All data is SYNTHETIC and approves nothing.
import { cpSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
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
async function initiative(c: any, code: string): Promise<string> {
  const id = uid();
  await c.query(`INSERT INTO initiative (id, organization_id, transformation_id, code, name, created_by, updated_by) VALUES ($1, $2, $3, $4, 'Synthetic initiative', $5, $5)`, [id, ORG, TR, code, U1]);
  await audit(c, "initiative", id, 1);
  return id;
}
void initiative;
void evidence;
void sgSeq;

// ------------------------------------------------------------------------------------------------ slices J and K helpers
const TRM = "01990000-0000-7000-8000-0000000000c1"; // a Modular transformation (entry at Design)
async function modularTransformation(c: any): Promise<void> {
  await c.query(
    `INSERT INTO transformation (id, organization_id, business_unit_id, code, name, mode, entry_phase, current_phase, timezone, currency, created_by, updated_by)
     VALUES ($1, $2, $3, 'SYN-TM', 'Synthetic modular transformation', 'modular', 'design', 'design', 'Asia/Riyadh', 'SAR', $4, $4)`,
    [TRM, ORG, BU, U1],
  );
}
async function auditT(c: any, recordType: string, id: string, version: number | null, tr: string | null): Promise<void> {
  await audit(c, recordType, id, version, ORG, tr);
}
async function insT(c: any, table: string, row: Record<string, unknown>, withAudit = true): Promise<string> {
  const cols = Object.keys(row);
  await c.query(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(row));
  if (withAudit) await auditT(c, table, row.id as string, 1, (row.transformation_id as string | undefined) ?? null);
  return row.id as string;
}
async function updT(c: any, table: string, id: string, set: Record<string, unknown>, o: { audit?: boolean; step?: number } = {}): Promise<void> {
  const r = (await c.query(`SELECT version, ${table === "portfolio" || table === "dashboard_rag_policy" ? "NULL::uuid AS tr" : "transformation_id AS tr"} FROM ${table} WHERE id = $1`, [id])).rows[0];
  const nv = r.version + (o.step ?? 1);
  const cols = Object.keys(set);
  await c.query(`UPDATE ${table} SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(", ")}${cols.length ? ", " : ""}version = ${nv} WHERE id = $1`, [id, ...Object.values(set)]);
  if (o.audit !== false) await auditT(c, table, id, nv, r.tr);
}
async function ini(c: any, tr: string, code: string, status = "draft"): Promise<string> {
  return insT(c, "initiative", { id: uid(), organization_id: ORG, transformation_id: tr, code, name: `Synthetic initiative ${code}`, status, created_by: U1, updated_by: U1 });
}
async function finding(c: any, tr = TR): Promise<string> {
  const ws = (await c.query(`SELECT code FROM diagnostic_workstream ORDER BY ordinal LIMIT 1`)).rows[0].code;
  return insT(c, "diagnostic_finding", { id: uid(), organization_id: ORG, transformation_id: tr, workstream_code: ws, statement: "Synthetic diagnosed issue", kind: "root_cause", created_by: U1, updated_by: U1 });
}
async function gap(c: any, tr = TR): Promise<string> {
  const dim = (await c.query(`SELECT code FROM tom_dimension ORDER BY ordinal LIMIT 1`)).rows[0].code;
  return insT(c, "tom_gap", { id: uid(), organization_id: ORG, transformation_id: tr, dimension_code: dim, gap: "Synthetic target-state gap", created_by: U1, updated_by: U1 });
}
async function capability(c: any, tr = TR): Promise<string> {
  return insT(c, "capability", { id: uid(), organization_id: ORG, transformation_id: tr, name: "Synthetic capability change", created_by: U1, updated_by: U1 });
}
async function deliverable(c: any, ini: string, tr = TR): Promise<string> {
  return insT(c, "deliverable", { id: uid(), organization_id: ORG, transformation_id: tr, initiative_id: ini, title: "Synthetic deliverable", created_by: U1, updated_by: U1 });
}
async function kpiDef(c: any, tr = TR): Promise<string> {
  return insT(c, "kpi_definition", { id: uid(), organization_id: ORG, transformation_id: tr, name: "Synthetic KPI", unit_kind: "count", polarity: "higher_is_better", frequency: "monthly", owner_user_id: U1, created_by: U1, updated_by: U1 });
}
async function outcome(c: any, tr = TR): Promise<string> {
  return insT(c, "outcome", { id: uid(), organization_id: ORG, transformation_id: tr, statement: "Synthetic outcome", created_by: U1, updated_by: U1 });
}
async function outcomeKpi(c: any, out: string, kpi: string, tr = TR): Promise<string> {
  return insT(c, "outcome_kpi", { id: uid(), organization_id: ORG, transformation_id: tr, outcome_id: out, kpi_definition_id: kpi, target_value: "20", target_date: "2026-12-31", created_by: U1, updated_by: U1 });
}
let bseq = 1;
async function benefit(c: any, o: Record<string, unknown> = {}): Promise<string> {
  return insT(c, "benefit", {
    id: uid(), organization_id: ORG, transformation_id: TR, code: `B${String(bseq++).padStart(2, "0")}`, title: "Synthetic benefit",
    description: "Synthetic benefit profile", benefit_type: "cost", value_class: "cash_saving", owner_user_id: U3,
    financial_statement_line: "P&L: Operating cost", currency: "SAR", created_by: U1, updated_by: U1, ...o,
  });
}
async function contribution(c: any, ini: string, out: string, ok: string | null, share: string | null = null, tr = TR): Promise<string> {
  return insT(c, "initiative_outcome_contribution", { id: uid(), organization_id: ORG, transformation_id: tr, initiative_id: ini, outcome_id: out, outcome_kpi_id: ok, contribution_statement: "Synthetic contribution", ...(share ? { allocation_share: share } : {}), created_by: U1, updated_by: U1 });
}
async function link(c: any, kind: string, cols: Record<string, unknown>, o: Record<string, unknown> = {}, withAudit = true): Promise<string> {
  return insT(c, "trace_link", { id: uid(), organization_id: ORG, transformation_id: TR, link_kind: kind, ...cols, contribution_statement: "Synthetic contribution", created_by: U1, updated_by: U1, ...o }, withAudit);
}
async function evidenceIn(c: any, tr: string): Promise<string> {
  return insT(c, "evidence", { id: uid(), organization_id: ORG, transformation_id: tr, kind: "note", title: "Synthetic inherited evidence", note_body: "Synthetic note", owner_user_id: U1, created_by: U1, updated_by: U1 });
}
async function baselineIn(c: any, tr: string): Promise<string> {
  return insT(c, "baseline", { id: uid(), organization_id: ORG, transformation_id: tr, metric: "Synthetic inherited baseline", value: "100.5", unit: "count", scope: "operational", created_by: U1, updated_by: U1 });
}
/** Runs fn as mth_app inside the caller's transaction (SET LOCAL ROLE ends with the transaction, also on ROLLBACK). */
async function asApp<T>(c: any, fn: () => Promise<T>): Promise<T> {
  await c.query("SET LOCAL ROLE mth_app");
  return fn();
}
/** The B0095 table rows and the M0246-M0252 rows, read from the read-only sources (verbatim check of the T10 seed). */
function sourceRows(): { pb: string[][]; mp: string[][] } {
  const root = new URL("../../../../../", import.meta.url).pathname;
  const pbText = readFileSync(join(root, "docs/source/playbook.md"), "utf8");
  const start = pbText.indexOf("<!-- B0095 table -->");
  const pb = pbText.slice(start).split("\n").slice(1, 10).filter((l) => l.startsWith("| ") && !l.startsWith("| Area") && !l.startsWith("|---"))
    .map((l) => l.split("|").slice(1, -1).map((x) => x.trim()));
  const mpText = readFileSync(join(root, "docs/source/master-prompt.anchored.md"), "utf8");
  const mp = ["M0247", "M0248", "M0249", "M0250", "M0251", "M0252"].map((a) => {
    const line = mpText.split("\n").find((l) => l.startsWith(`[${a} `))!;
    return line.slice(line.indexOf("]") + 1).split("|").slice(1, -1).map((x) => x.trim());
  });
  return { pb, mp };
}

async function main(): Promise<void> {
  const files = readdirSync(migrationsDir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  console.log(`migrations shipped: ${files.length} (${files[0]} .. ${files[files.length - 1]})`);
  const ids = files.map((f) => Number(f.slice(0, 4)));
  const planned = ids.filter((n) => n < 58);
  report("G00 migration ids below the repair range are contiguous 1..n and 0055-0057 are present (0058+ is the repair range)",
    planned.every((n, i) => n === i + 1) && [55, 56, 57].every((n) => ids.includes(n)) && planned[planned.length - 1] === 57,
    `last below 0058: ${planned[planned.length - 1]}; repair: ${ids.filter((n) => n >= 58).join(",")}`);

  // 1. Fresh database.
  await createDb("probe_fresh");
  const applied = await migrate(roleUrl("probe_fresh", "mth_owner"), { dir: migrationsDir });
  report("G01 fresh database: 0001..last apply", applied.length === files.length, `applied ${applied.length}: ${applied.slice(-5).join(", ")}`);

  // 2. P3-populated database: a DG3 initiative with a T05 outcome/KPI contribution, then P4 on top.
  await createDb("probe_p3");
  const p3Dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "p3-migrations-"));
  for (const f of files.filter((f) => Number(f.slice(0, 4)) <= LAST_P3)) cpSync(join(migrationsDir, f), join(p3Dir, f));
  const p3Applied = await migrate(roleUrl("probe_p3", "mth_owner"), { dir: p3Dir });
  let OLD_CONTRIB = "";
  {
    const c = await client("probe_p3");
    await seedP1(c);
    await c.query("BEGIN");
    const i = await ini(c, TR, "INI-01");
    const out = await outcome(c);
    const ok = await outcomeKpi(c, out, await kpiDef(c));
    OLD_CONTRIB = await contribution(c, i, out, ok);
    await c.query("COMMIT");
    report("G02 P3 database populated (0001-0027, a synthetic initiative with an outcome/KPI contribution)", p3Applied.length === LAST_P3, `applied ${p3Applied.length}`);
    await c.end();
  }
  const p4OnTop = await migrate(roleUrl("probe_p3", "mth_owner"), { dir: migrationsDir });
  {
    const c = await client("probe_p3");
    report("G03 P4 over the P3 database: 0028..last apply", p4OnTop.length === files.length - LAST_P3, `applied ${p4OnTop.length}: ${p4OnTop.slice(-5).join(", ")}`);
    const r = await c.query(`SELECT allocation_share, allocation_basis, version FROM initiative_outcome_contribution WHERE id = $1`, [OLD_CONTRIB]);
    report("G04 the existing DG3 contribution keeps its values; the new allocation_share and allocation_basis are NULL",
      r.rowCount === 1 && r.rows[0].allocation_share === null && r.rows[0].allocation_basis === null && r.rows[0].version === 1, JSON.stringify(r.rows));
    const e = await c.query(`SELECT edge_kind, from_type, to_type FROM traceability_edge WHERE link_id = $1`, [OLD_CONTRIB]);
    report("G05 traceability_edge reads the DG3 contribution in place (initiative -> outcome_kpi), no copy", e.rowCount === 1 && e.rows[0].edge_kind === "initiative_kpi" && e.rows[0].to_type === "outcome_kpi", JSON.stringify(e.rows));
    await expectSuccess(c, "G06 on the upgraded database a DG3-style contribution edit without a share still commits (DG3 behaviour unchanged)", async () => {
      await updT(c, "initiative_outcome_contribution", OLD_CONTRIB, { expected_kpi_movement: "Synthetic +5 points" });
      return "edited";
    });
    await c.end();
  }

  // 3. Guard probes on the fresh database.
  const c = await client("probe_fresh");
  await seedP1(c);
  await modularTransformation(c);

  // ---- portfolio and membership (REQ-S03-001)
  let PF = "";
  await expectSuccess(c, "PF01 a portfolio with its audit event commits at version 1", async () => {
    PF = await insT(c, "portfolio", { id: uid(), organization_id: ORG, code: "SYN-PF", name: "Synthetic portfolio", created_by: U1, updated_by: U1 });
    return PF;
  });
  await expectFailure(c, "PF02 a portfolio without its audit event fails at COMMIT", /portfolio_audit_required/, async () => {
    await insT(c, "portfolio", { id: uid(), organization_id: ORG, code: "SYN-PF2", name: "Synthetic", created_by: U1, updated_by: U1 }, false);
  });
  await expectFailure(c, "PF03 a portfolio version that does not step by 1 is refused", /portfolio_version_step/, async () => {
    await updT(c, "portfolio", PF, { name: "Synthetic renamed" }, { step: 2 });
  });
  await expectFailure(c, "PF04 a portfolio code that is not upper-case is refused", /portfolio_code_check/, async () => {
    await insT(c, "portfolio", { id: uid(), organization_id: ORG, code: "syn-pf", name: "Synthetic", created_by: U1, updated_by: U1 });
  });
  await expectSuccess(c, "PF05 a transformation is placed in the portfolio", async () =>
    insT(c, "portfolio_transformation", { id: uid(), organization_id: ORG, transformation_id: TR, portfolio_id: PF, created_by: U1, updated_by: U1 }));
  await expectFailure(c, "PF06 a transformation cannot sit in two portfolios at once", /portfolio_transformation_one_active_key/, async () => {
    const pf2 = await insT(c, "portfolio", { id: uid(), organization_id: ORG, code: "SYN-PF3", name: "Synthetic 3", created_by: U1, updated_by: U1 });
    await insT(c, "portfolio_transformation", { id: uid(), organization_id: ORG, transformation_id: TR, portfolio_id: pf2, created_by: U1, updated_by: U1 });
  });
  await expectFailure(c, "PF07 a portfolio of another organization cannot hold this organization's transformation", /portfolio_transformation_portfolio_fkey/, async () => {
    const other = uid();
    await c.query(`INSERT INTO portfolio (id, organization_id, code, name, created_by, updated_by) VALUES ($1, $2, 'SYN-OTHER', 'Other org portfolio', $3, $3)`, [other, ORG2, UX]);
    await audit(c, "portfolio", other, 1, ORG2, null);
    await insT(c, "portfolio_transformation", { id: uid(), organization_id: ORG, transformation_id: TR2, portfolio_id: other, created_by: U1, updated_by: U1 });
  });
  await expectFailure(c, "PF08 a removal without its reason is refused", /portfolio_transformation_removal_complete/, async () => {
    const m = (await c.query(`SELECT id FROM portfolio_transformation WHERE transformation_id = $1 AND status = 'active'`, [TR])).rows[0].id;
    await updT(c, "portfolio_transformation", m, { status: "removed", removed_at: new Date(), removed_by: U1 });
  });

  // ---- workstreams (REQ-S03-001, REQ-S13-001 workstream dashboard)
  let WS = "";
  let I1 = "";
  await expectSuccess(c, "WS01 a workstream WS-01 with an initiative commits", async () => {
    WS = await insT(c, "workstream", { id: uid(), organization_id: ORG, transformation_id: TR, code: "WS-01", name: "Synthetic workstream", created_by: U1, updated_by: U1 });
    I1 = await ini(c, TR, "INI-01");
    await insT(c, "workstream_initiative", { id: uid(), organization_id: ORG, transformation_id: TR, workstream_id: WS, initiative_id: I1, created_by: U1, updated_by: U1 });
    return WS;
  });
  await expectFailure(c, "WS02 a workstream code outside WS-nn is refused", /workstream_code_check/, async () => {
    await insT(c, "workstream", { id: uid(), organization_id: ORG, transformation_id: TR, code: "W-1", name: "Synthetic", created_by: U1, updated_by: U1 });
  });
  await expectFailure(c, "WS03 an initiative cannot be in two workstreams at once", /workstream_initiative_one_active_key/, async () => {
    const ws2 = await insT(c, "workstream", { id: uid(), organization_id: ORG, transformation_id: TR, code: "WS-02", name: "Synthetic 2", created_by: U1, updated_by: U1 });
    await insT(c, "workstream_initiative", { id: uid(), organization_id: ORG, transformation_id: TR, workstream_id: ws2, initiative_id: I1, created_by: U1, updated_by: U1 });
  });
  await expectFailure(c, "WS04 a workstream cannot take an initiative of another transformation", /workstream_initiative_initiative_fkey/, async () => {
    const other = await ini(c, TR2, "INI-01");
    await insT(c, "workstream_initiative", { id: uid(), organization_id: ORG, transformation_id: TR, workstream_id: WS, initiative_id: other, created_by: U1, updated_by: U1 });
  });
  await expectFailure(c, "WS05 a workstream membership without its audit event fails at COMMIT", /workstream_initiative_audit_required/, async () => {
    const i2 = await ini(c, TR, "INI-02");
    await insT(c, "workstream_initiative", { id: uid(), organization_id: ORG, transformation_id: TR, workstream_id: WS, initiative_id: i2, created_by: U1, updated_by: U1 }, false);
  });
  await expectFailure(c, "WS06 a workstream version that does not step by 1 is refused", /workstream_version_step/, async () => {
    await updT(c, "workstream", WS, { name: "Synthetic renamed" }, { step: 0 });
  });

  // ---- traceability links, contribution and allocation (REQ-S03-006, REQ-PB-044)
  const F1 = await inTx(c, () => finding(c));
  const G1 = await inTx(c, () => gap(c));
  const G2 = await inTx(c, () => gap(c));
  const CAP1 = await inTx(c, () => capability(c));
  const CAP2 = await inTx(c, () => capability(c));
  const OUT = await inTx(c, () => outcome(c));
  const KPI = await inTx(c, () => kpiDef(c));
  const OK1 = await inTx(c, () => outcomeKpi(c, OUT, KPI));
  const OK2 = await inTx(c, () => outcomeKpi(c, OUT, KPI));
  const DEL = await inTx(c, () => deliverable(c, I1));
  const BEN = await inTx(c, () => benefit(c, { measurement_kpi_definition_id: KPI }));
  await expectSuccess(c, "TL01 one initiative links to two gaps and two KPIs (A01 shape): gap links and contributions commit", async () => {
    for (const g of [G1, G2])
      await insT(c, "initiative_gap_link", { id: uid(), organization_id: ORG, transformation_id: TR, initiative_id: I1, target_type: "tom_gap", tom_gap_id: g, created_by: U1, updated_by: U1 });
    await contribution(c, I1, OUT, OK1);
    await contribution(c, I1, OUT, OK2);
    return "2 gaps, 2 KPIs";
  });
  await expectSuccess(c, "TL02 an issue -> gap trace link with its contribution statement commits", async () =>
    link(c, "issue_gap", { diagnostic_finding_id: F1, tom_gap_id: G1 }));
  await expectFailure(c, "TL03 a link whose records do not match its kind is refused", /trace_link_kind_shape/, async () => {
    await link(c, "issue_gap", { diagnostic_finding_id: F1, capability_id: CAP1 });
  });
  await expectFailure(c, "TL04 a second active link between the same two records is refused", /trace_link_one_active_key/, async () => {
    await link(c, "issue_gap", { diagnostic_finding_id: F1, tom_gap_id: G1 });
  });
  await expectFailure(c, "TL05 a share on a link into a record that carries no value (issue -> gap) is refused", /trace_link_allocation_kind/, async () => {
    await link(c, "issue_gap", { diagnostic_finding_id: F1, tom_gap_id: G2 }, { allocation_share: "0.5" });
  });
  await expectFailure(c, "TL06 a share of 0 is refused (a share is > 0 and <= 1)", /trace_link_allocation_share_check/, async () => {
    await link(c, "capability_kpi", { capability_id: CAP1, outcome_kpi_id: OK1 }, { allocation_share: "0" });
  });
  let L60 = "";
  await expectSuccess(c, "TL07 an allocation set of 0.6 (capability -> KPI) + 0.4 (initiative contribution) = 100 % commits", async () => {
    L60 = await link(c, "capability_kpi", { capability_id: CAP1, outcome_kpi_id: OK1 }, { allocation_share: "0.6", allocation_basis: "Synthetic basis" });
    const ctr = (await c.query(`SELECT id FROM initiative_outcome_contribution WHERE outcome_kpi_id = $1`, [OK1])).rows[0].id;
    await updT(c, "initiative_outcome_contribution", ctr, { allocation_share: "0.4", allocation_basis: "Synthetic basis" });
    const t = (await c.query(`SELECT sum(allocation_share)::text AS t FROM traceability_edge WHERE to_id = $1`, [OK1])).rows[0].t;
    return `total ${t}`;
  });
  await expectFailure(c, "TL08 one more link of 0.1 into the same KPI (set total 110 %) is refused", /trace_allocation_total/, async () => {
    await link(c, "capability_kpi", { capability_id: CAP2, outcome_kpi_id: OK1 }, { allocation_share: "0.1" });
  });
  await expectFailure(c, "TL09 raising the contribution's share so that the set totals 110 % is refused", /trace_allocation_total/, async () => {
    const ctr = (await c.query(`SELECT id FROM initiative_outcome_contribution WHERE outcome_kpi_id = $1`, [OK1])).rows[0].id;
    await updT(c, "initiative_outcome_contribution", ctr, { allocation_share: "0.5" });
  });
  await expectSuccess(c, "TL10 removing the 0.6 link frees its share: a 0.5 link then commits (removed links are not in the set)", async () => {
    await updT(c, "trace_link", L60, { status: "removed", removed_at: new Date(), removed_by: U1, remove_reason: "Synthetic removal" });
    await link(c, "capability_kpi", { capability_id: CAP2, outcome_kpi_id: OK1 }, { allocation_share: "0.5" });
    return "0.4 + 0.5";
  });
  await expectFailure(c, "TL11 KPI -> benefit shares into one benefit above 100 % are refused", /trace_allocation_total/, async () => {
    await link(c, "kpi_benefit", { outcome_kpi_id: OK1, benefit_id: BEN }, { allocation_share: "0.7" });
    await link(c, "kpi_benefit", { outcome_kpi_id: OK2, benefit_id: BEN }, { allocation_share: "0.4" });
  });
  await expectFailure(c, "TL12 a contribution share without its T02 KPI row is refused", /initiative_outcome_contribution_allocation_needs_kpi/, async () => {
    await contribution(c, I1, OUT, null, "0.2");
  });
  await expectFailure(c, "TL13 a link to a record of another transformation is refused", /trace_link_tom_gap_fkey/, async () => {
    const otherGap = await gap(c, TR2);
    await link(c, "issue_gap", { diagnostic_finding_id: F1, tom_gap_id: otherGap });
  });
  await expectFailure(c, "TL14 a trace link without its audit event fails at COMMIT", /trace_link_audit_required/, async () => {
    await link(c, "deliverable_capability", { deliverable_id: DEL, capability_id: CAP1 }, {}, false);
  });
  await expectFailure(c, "TL15 a trace link version that does not step by 1 is refused", /trace_link_version_step/, async () => {
    await updT(c, "trace_link", L60, { contribution_statement: "Synthetic edit" }, { step: 3 });
  });
  await expectFailure(c, "TL16 the application role cannot DELETE a trace link (links are removed, never deleted)", /permission denied/, async () => {
    await asApp(c, () => c.query(`DELETE FROM trace_link WHERE id = $1`, [L60]));
  });
  await expectSuccess(c, "TL17 traceability_edge lists the whole chain in place (finding -> gap -> initiative -> deliverable -> capability -> KPI -> benefit) and no removed link", async () => {
    await link(c, "deliverable_capability", { deliverable_id: DEL, capability_id: CAP2 });
    const kinds = (await c.query(`SELECT DISTINCT edge_kind FROM traceability_edge WHERE transformation_id = $1 ORDER BY 1`, [TR])).rows.map((r: any) => r.edge_kind);
    const want = ["capability_kpi", "deliverable_capability", "gap_initiative", "initiative_deliverable", "initiative_kpi", "issue_gap", "kpi_benefit_measure", "outcome_kpi_of"];
    const removed = (await c.query(`SELECT count(*)::int AS n FROM traceability_edge WHERE link_id = $1`, [L60])).rows[0].n;
    if (JSON.stringify(kinds) !== JSON.stringify(want) || removed !== 0) throw new Error(`${JSON.stringify(kinds)} removed=${removed}`);
    return kinds.join(",");
  });

  // ---- inherited records of a Modular entry (REQ-S03-005, REQ-PB-005)
  let IR = "";
  await expectSuccess(c, "IR01 inherited evidence on a Modular transformation commits, with its provenance", async () => {
    const ev = await evidenceIn(c, TRM);
    IR = await insT(c, "inherited_record", { id: uid(), organization_id: ORG, transformation_id: TRM, kind: "evidence", evidence_id: ev, source_description: "Synthetic: programme PMO pack, 2025", original_owner: "Synthetic PMO", original_date: "2025-06-30", recorded_by: U1, created_by: U1, updated_by: U1 });
    return IR;
  });
  await expectFailure(c, "IR02 an End-to-End transformation cannot record inherited items", /inherited_record_modular_only/, async () => {
    const ev = await evidenceIn(c, TR);
    await insT(c, "inherited_record", { id: uid(), organization_id: ORG, transformation_id: TR, kind: "evidence", evidence_id: ev, source_description: "Synthetic source", recorded_by: U1, created_by: U1, updated_by: U1 });
  });
  await expectFailure(c, "IR03 an inherited baseline must reference a baseline, not evidence", /inherited_record_kind_shape/, async () => {
    const ev = await evidenceIn(c, TRM);
    await insT(c, "inherited_record", { id: uid(), organization_id: ORG, transformation_id: TRM, kind: "baseline", evidence_id: ev, source_description: "Synthetic source", recorded_by: U1, created_by: U1, updated_by: U1 });
  });
  await expectSuccess(c, "IR04 an inherited baseline commits; the baseline stays 'unvalidated' (inheriting validates nothing)", async () => {
    const b = await baselineIn(c, TRM);
    await insT(c, "inherited_record", { id: uid(), organization_id: ORG, transformation_id: TRM, kind: "baseline", baseline_id: b, source_description: "Synthetic: 2025 finance pack", recorded_by: U1, created_by: U1, updated_by: U1 });
    return (await c.query(`SELECT validation_status FROM baseline WHERE id = $1`, [b])).rows[0].validation_status;
  });
  await expectFailure(c, "IR05 the provenance of an inherited record cannot be edited", /inherited_record_immutable/, async () => {
    await updT(c, "inherited_record", IR, { source_description: "Synthetic rewritten provenance" });
  });
  await expectFailure(c, "IR06 the same evidence cannot be recorded as inherited twice while active", /inherited_record_one_active_key/, async () => {
    const ev = (await c.query(`SELECT evidence_id FROM inherited_record WHERE id = $1`, [IR])).rows[0].evidence_id;
    await insT(c, "inherited_record", { id: uid(), organization_id: ORG, transformation_id: TRM, kind: "evidence", evidence_id: ev, source_description: "Synthetic source", recorded_by: U1, created_by: U1, updated_by: U1 });
  });
  await expectFailure(c, "IR07 a withdrawal without its reason is refused", /inherited_record_withdrawal_complete/, async () => {
    await updT(c, "inherited_record", IR, { status: "withdrawn", withdrawn_at: new Date(), withdrawn_by: U1 });
  });
  await expectSuccess(c, "IR08 a withdrawal with its reason and audit event commits", async () => {
    await updT(c, "inherited_record", IR, { status: "withdrawn", withdrawn_at: new Date(), withdrawn_by: U1, withdraw_reason: "Synthetic: superseded" });
    return "withdrawn";
  });
  await expectFailure(c, "IR09 a withdrawn inherited record cannot become active again", /inherited_record_immutable/, async () => {
    await updT(c, "inherited_record", IR, { status: "active", withdrawn_at: null, withdrawn_by: null, withdraw_reason: null });
  });
  await expectFailure(c, "IR10 an inherited record without its audit event fails at COMMIT", /inherited_record_audit_required/, async () => {
    const ev = await evidenceIn(c, TRM);
    await insT(c, "inherited_record", { id: uid(), organization_id: ORG, transformation_id: TRM, kind: "evidence", evidence_id: ev, source_description: "Synthetic source", recorded_by: U1, created_by: U1, updated_by: U1 }, false);
  });
  await expectSuccess(c, "IR11 no inherited record creates a gate decision or moves a gate (gate_decision rows of the Modular transformation: 0)", async () => {
    const n = (await c.query(`SELECT count(*)::int AS n FROM gate_decision WHERE transformation_id = $1`, [TRM])).rows[0].n;
    if (n !== 0) throw new Error(`gate decisions ${n}`);
    return "0";
  });

  // ---- T10 seed (REQ-PB-062) and the RAG policy (REQ-PB-063)
  await expectSuccess(c, "T01 the six T10 areas are seeded verbatim from B0095 (area, what to show, RAG logic) and M0247-M0252 (presentation, status basis)", async () => {
    const { pb, mp } = sourceRows();
    const rows = (await c.query(`SELECT source_area_en, source_what_to_show_en, source_rag_logic_en, source_presentation_en, source_status_basis_en, ar_provisional FROM t10_area_definition ORDER BY ordinal`)).rows;
    const got = rows.map((r: any) => [r.source_area_en, r.source_what_to_show_en, r.source_rag_logic_en]);
    const gotMp = rows.map((r: any) => [r.source_presentation_en, r.source_status_basis_en]);
    const wantMp = mp.map((m) => [m[1], m[2]]);
    if (rows.length !== 6 || JSON.stringify(got) !== JSON.stringify(pb) || JSON.stringify(gotMp) !== JSON.stringify(wantMp) || !rows.every((r: any) => r.ar_provisional))
      throw new Error(`${JSON.stringify(got)} vs ${JSON.stringify(pb)} / ${JSON.stringify(gotMp)} vs ${JSON.stringify(wantMp)}`);
    return `6 areas: ${pb.map((p) => p[0]).join(", ")}`;
  });
  await expectFailure(c, "T02 the application role cannot change the T10 seed", /permission denied/, async () => {
    await asApp(c, () => c.query(`UPDATE t10_area_definition SET source_rag_logic_en = 'x' WHERE code = 'decisions'`));
  });
  let RP = "";
  await expectSuccess(c, "RP01 a RAG policy stores its ratios as exact decimals (0.05 -> 0.050000); NULL columns mean the ADR-0037 defaults", async () => {
    RP = await insT(c, "dashboard_rag_policy", { id: uid(), organization_id: ORG, value_gap_amber_ratio: "0.05", value_gap_red_ratio: "0.15", created_by: U1, updated_by: U1 });
    return (await c.query(`SELECT value_gap_amber_ratio::text AS a, milestone_slip_red_working_days AS m FROM dashboard_rag_policy WHERE id = $1`, [RP])).rows.map((r: any) => `${r.a} / ${r.m}`)[0];
  });
  await expectFailure(c, "RP02 an amber ratio above the red ratio is refused", /dashboard_rag_policy_value_gap_order/, async () => {
    await updT(c, "dashboard_rag_policy", RP, { value_gap_amber_ratio: "0.20" });
  });
  await expectFailure(c, "RP03 a ratio above 1 is refused", /dashboard_rag_policy_value_gap_red_ratio_check/, async () => {
    await updT(c, "dashboard_rag_policy", RP, { value_gap_red_ratio: "1.5" });
  });
  await expectFailure(c, "RP04 a second policy for the same organization is refused", /dashboard_rag_policy_organization_key/, async () => {
    await insT(c, "dashboard_rag_policy", { id: uid(), organization_id: ORG, created_by: U1, updated_by: U1 });
  });
  await expectFailure(c, "RP05 a policy change without its audit event fails at COMMIT", /dashboard_rag_policy_audit_required/, async () => {
    await updT(c, "dashboard_rag_policy", RP, { top_initiative_count: 5 }, { audit: false });
  });
  await expectFailure(c, "RP06 a policy version that does not step by 1 is refused", /dashboard_rag_policy_version_step/, async () => {
    await updT(c, "dashboard_rag_policy", RP, { top_initiative_count: 5 }, { step: 2 });
  });
  await expectFailure(c, "RP07 a milestone amber slip above the red slip is refused", /dashboard_rag_policy_milestone_slip_order/, async () => {
    await updT(c, "dashboard_rag_policy", RP, { milestone_slip_amber_working_days: 10, milestone_slip_red_working_days: 5 });
  });

  // ---- My Work drafts view (REQ-S03-008)
  await expectSuccess(c, "MW01 my_work_draft lists a person's draft initiative with code and label, and not a draft gate instance", async () => {
    const d = await inTx(c, () => ini(c, TR, "INI-09"));
    await inTx(c, () => insT(c, "gate_instance", { id: uid(), organization_id: ORG, transformation_id: TR, gate_code: "G1", status: "draft", approver_role_code: "SP", created_by: U1, updated_by: U1 }));
    const rows = (await c.query(`SELECT record_type, record_id, code, label FROM my_work_draft WHERE created_by = $1 AND transformation_id = $2`, [U1, TR])).rows;
    const mine = rows.find((r: any) => r.record_id === d);
    if (!mine || mine.code !== "INI-09" || rows.some((r: any) => r.record_type === "gate_instance")) throw new Error(JSON.stringify(rows));
    return `${rows.length} drafts; types ${[...new Set(rows.map((r: any) => r.record_type))].join(",")}`;
  });

  await c.end();
  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 2;
  })
  .finally(() => process.exit());
