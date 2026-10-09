// T-DG4-ARCH-07 migration and guard probe (solution-architect). Run against a DISPOSABLE cluster only:
//   QA_PG_PORT=<port in 23700-23749> MTH_PORT_POOL=23701-23749 tests/qa/support/with-pg.sh \
//     node --conditions=@mth/source docs/delivery/handbacks/DG4/T-DG4-ARCH-07-evidence/probe.ts
// 1. Fresh database: all migrations 0001..last.
// 2. P3-populated database: 0001..0027 with synthetic P1-P3 data (incl. an initiative), then 0028..last on top.
// 3. Guard probes on the slice H tables (ADR-0035, ADR-0036). Every probe states the expected failure; "PASS" means
//    the guard fired (or, for an expectSuccess probe, that the allowed write committed). The harness is copied from the
//    T-DG4-ARCH-06 probe. All data is SYNTHETIC and approves nothing; no row here is a real business approval.
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

// ------------------------------------------------------------------------------------------------ slice H helpers
const BU2 = "01990000-0000-7000-8000-0000000000b2"; // business unit of ORG2
let gdSeq = 1;
let crSeq = 1;
const SHA = "a".repeat(64);
async function gateInstance(c: any, code: string): Promise<string> {
  return ins(c, "gate_instance", { id: uid(), organization_id: ORG, transformation_id: TR, gate_code: code, status: "draft", approver_role_code: "SP", created_by: U1, updated_by: U1 });
}
/** A pending submission of the instance with the given criteria rows ([key, mandatory, completeness, exceptionId]). */
async function submit(c: any, inst: string, code: string, criteria: Array<[string, boolean, string, string | null]>, submittedAt: string | null = null): Promise<string> {
  const i = (await c.query(`SELECT latest_submission_no, version, current_submission_id FROM gate_instance WHERE id = $1`, [inst])).rows[0];
  const no = i.latest_submission_no + 1;
  const sid = uid();
  // Probe submissions follow a decided one (or none), so there is no pending submission to supersede.
  await ins(c, "gate_submission", {
    id: sid, organization_id: ORG, transformation_id: TR, gate_instance_id: inst, gate_code: code, submission_no: no, submitted_by: U1,
    approver_role_code: "SP", snapshot: "{}", snapshot_sha256: SHA, created_by: U1, updated_by: U1, ...(submittedAt ? { submitted_at: submittedAt } : {}),
  });
  let ord = 1;
  for (const [key, mandatory, completeness, exc] of criteria)
    await ins(c, "gate_submission_criterion", { id: uid(), organization_id: ORG, transformation_id: TR, gate_submission_id: sid, criterion_key: key, ordinal: ord++, mandatory, completeness, ...(exc !== null ? { gate_exception_id: exc } : {}) }, false);
  await upd(c, "gate_instance", inst, { status: "submitted", current_submission_id: sid, latest_submission_no: no });
  return sid;
}
async function decideGate(c: any, sid: string, outcome: string): Promise<string> {
  const s = (await c.query(`SELECT gate_code, submission_no FROM gate_submission WHERE id = $1`, [sid])).rows[0];
  const did = await ins(c, "decision", { id: uid(), organization_id: ORG, transformation_id: TR, kind: "gate", code: `GD-${String(gdSeq++).padStart(2, "0")}`, title: `Synthetic ${s.gate_code} decision`, status: "decided", decided_by: U2, decided_at: new Date(), created_by: U2, updated_by: U2 });
  const gd = await ins(c, "gate_decision", { id: uid(), organization_id: ORG, transformation_id: TR, gate_submission_id: sid, decision_id: did, gate_code: s.gate_code, submission_no: s.submission_no, outcome, rationale: "Synthetic rationale", decided_by: U2, approver_basis: "default_role", approver_role_code: "SP" });
  await upd(c, "gate_submission", sid, { status: "decided" });
  return gd;
}
async function exception(c: any, inst: string, code: string, key: string, o: Record<string, unknown> = {}, withAudit = true): Promise<string> {
  return ins(c, "gate_exception", { id: uid(), organization_id: ORG, transformation_id: TR, gate_instance_id: inst, gate_code: code, criterion_key: key, reason: "Synthetic reason", scope: "Synthetic scope: pilot region only", compensating_action: "Synthetic compensating action", compensating_owner_user_id: U1, expires_on: "2099-12-31", requested_by: U1, created_by: U1, updated_by: U1, ...o }, withAudit);
}
async function accept(c: any, e: string, by = U2): Promise<void> {
  await upd(c, "gate_exception", e, { status: "accepted", decided_by: by, decided_at: new Date(), decision_note: "Synthetic acceptance", updated_by: by });
}
async function risk(c: any, o: Record<string, unknown> = {}): Promise<string> {
  const n = (await c.query(`SELECT count(*)::int + 1 AS n FROM raid_entry WHERE transformation_id = $1`, [TR])).rows[0].n;
  const type = (o.entry_type as string) ?? "risk";
  const prefix = type === "risk" ? "R" : type === "assumption" ? "A" : "I";
  return ins(c, "raid_entry", { id: uid(), organization_id: ORG, transformation_id: TR, entry_type: type, code: `${prefix}-${String(n).padStart(2, "0")}`, description: "Synthetic risk", impact: "high", probability: type === "risk" ? "medium" : null, owner_user_id: U1, created_by: U1, updated_by: U1, ...o });
}
async function approval(c: any, type: string, subject: string, version: number, withAudit = true): Promise<string> {
  return ins(c, "approval", { id: uid(), organization_id: ORG, transformation_id: TR, approval_type: type, subject_type: type, subject_id: subject, subject_version: version, title: "Synthetic approval", requested_by: U1, request_business_date: "2026-10-09", assignee_party_code: "SP", assignee_user_id: U2, sod_policy: "requester_excluded", due_unknown_reason: "no_sla", created_by: U1 }, withAudit);
}
async function approvalDecision(c: any, a: string, outcome: string, subjectVersion: number): Promise<void> {
  await ins(c, "approval_decision", { id: uid(), organization_id: ORG, transformation_id: TR, approval_id: a, round_no: 1, outcome, rationale: "Synthetic rationale", subject_version: subjectVersion, decided_by: U2, business_date: "2026-10-09" });
}
async function changeRequest(c: any, o: Record<string, unknown> = {}, withAudit = true): Promise<string> {
  return ins(c, "change_request", { id: uid(), organization_id: ORG, transformation_id: TR, code: `CR-${String(crSeq++).padStart(2, "0")}`, change_kind: "schedule_rebaseline", subject_type: "milestone", subject_id: uid(), subject_version: 1, proposed_change: JSON.stringify({ approvedDate: { from: "2026-12-01", to: "2027-02-01" } }), reason: "Synthetic rebaseline", raised_by: U1, created_by: U1, updated_by: U1, ...o }, withAudit);
}
async function assessment(c: any, cr: string, crVersion: number): Promise<string> {
  return ins(c, "impact_assessment", { id: uid(), organization_id: ORG, transformation_id: TR, change_request_id: cr, change_request_version: crVersion, item_count: 0, content_sha256: SHA, assessed_by: U1 }, true, null);
}
async function submitCr(c: any, cr: string): Promise<string> {
  const v = (await c.query(`SELECT version FROM change_request WHERE id = $1`, [cr])).rows[0].version;
  const ia = await assessment(c, cr, v + 1);
  await upd(c, "change_request", cr, { status: "submitted", submitted_by: U1, submitted_at: new Date(), materiality: "material", route_party_code: "SP", current_impact_assessment_id: ia });
  return ia;
}

async function main(): Promise<void> {
  const files = readdirSync(migrationsDir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  console.log(`migrations shipped: ${files.length} (${files[0]} .. ${files[files.length - 1]})`);
  const ids = files.map((f) => Number(f.slice(0, 4)));
  const planned = ids.filter((n) => n < 58);
  report("G00 migration ids below the repair range are contiguous 1..n and 0051-0054 are present (0058+ is the repair range, D-094)",
    planned.every((n, i) => n === i + 1) && [51, 52, 53, 54].every((n) => ids.includes(n)), `last below 0058: ${planned[planned.length - 1]}; repair: ${ids.filter((n) => n >= 58).join(",")}`);

  // 1. Fresh database.
  await createDb("probe_fresh");
  const applied = await migrate(roleUrl("probe_fresh", "mth_owner"), { dir: migrationsDir });
  report("G01 fresh database: 0001..last apply", applied.length === files.length, `applied ${applied.length}: ${applied.slice(-6).join(", ")}`);

  // 2. P3-populated database (a transformation, a G1 instance with a decided submission whose mandatory criteria are
  //    complete, and a P3 initiative), then P4 on top.
  await createDb("probe_p3");
  const p3Dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "p3-migrations-"));
  for (const f of files.filter((f) => Number(f.slice(0, 4)) <= LAST_P3)) cpSync(join(migrationsDir, f), join(p3Dir, f));
  const p3Applied = await migrate(roleUrl("probe_p3", "mth_owner"), { dir: p3Dir });
  let OLD_SUB = "";
  {
    const c = await client("probe_p3");
    await seedP1(c);
    await c.query("BEGIN");
    const g1 = await gateInstance(c, "G1");
    OLD_SUB = await submit(c, g1, "G1", [["g1.initial_charter", true, "complete", null]]);
    await c.query("COMMIT");
    report("G02 P3 database populated (0001-0027, a synthetic transformation with a G1 submission)", p3Applied.length === LAST_P3, `applied ${p3Applied.length}`);
    await c.end();
  }
  const p4OnTop = await migrate(roleUrl("probe_p3", "mth_owner"), { dir: migrationsDir });
  {
    const c = await client("probe_p3");
    report("G03 P4 over the P3 database: 0028..last apply", p4OnTop.length === files.length - LAST_P3, `applied ${p4OnTop.length}: ${p4OnTop.slice(-6).join(", ")}`);
    const r = await c.query(`SELECT mandatory, completeness, gate_exception_id FROM gate_submission_criterion WHERE gate_submission_id = $1`, [OLD_SUB]);
    report("G04 the existing DG2 submission criterion keeps its values; the new gate_exception_id is NULL",
      r.rowCount === 1 && r.rows[0].completeness === "complete" && r.rows[0].gate_exception_id === null, JSON.stringify(r.rows));
    const g = await c.query(`SELECT code, submission_enabled FROM gate_definition ORDER BY code`);
    const crit = await c.query(`SELECT count(*)::int AS n FROM gate_criterion_definition WHERE key ~ '^g[1-4]\\.'`);
    report("G05 G1-G4 keep their 24 criteria; G1-G4 stay enabled and G5/G6 stay closed after 0051 (enabling ships with the evaluators)",
      crit.rows[0].n === 24 && g.rows.map((x: any) => `${x.code}:${x.submission_enabled}`).join(",") === "G1:true,G2:true,G3:true,G4:true,G5:false,G6:false",
      JSON.stringify(g.rows));
    await expectFailure(c, "G06 on the upgraded P3 database a mandatory incomplete criterion without an exception is still refused (DG2 rule kept)", /gate_submission_criterion_mandatory_complete/, async () => {
      const existing = (await c.query(`SELECT id FROM gate_instance WHERE transformation_id = $1 AND gate_code = 'G3'`, [TR])).rows[0]?.id;
      const g3 = existing ?? (await gateInstance(c, "G3"));
      await submit(c, g3, "G3", [["g3.gap_matrix", true, "incomplete", null]]);
    });
    await c.end();
  }

  // 3. Guard probes on the fresh database.
  const c = await client("probe_fresh");
  await inTx(c, async () => {
    await seedP1(c);
    await c.query(`INSERT INTO business_unit (id, organization_id, code, name_en, name_ar) VALUES ($1, $2, 'SYN-BU2', 'Synthetic BU 2', 'وحدة تجريبية 2')`, [BU2, ORG2]);
  });

  // --- Seeds.
  {
    const p = await c.query(`SELECT code, ordinal, gate_code, source_name_en, source_purpose_en, source_key_outputs_en, source_objective_en, ar_provisional FROM phase_definition ORDER BY ordinal`);
    const exp = [
      ["DIAGNOSE", "Establish fact base", "Current state, root causes, value pools"],
      ["DEFINE", "Set direction", "North Star, outcomes, KPIs, guardrails"],
      ["DESIGN", "Create target state", "Target Operating Model, capabilities, journeys"],
      ["MOBILIZE", "Build execution portfolio", "Initiatives, business cases, roadmap, resourcing"],
      ["TRANSFORM", "Execute & govern", "Operating system, workstreams, decisions, adoption"],
      ["REALIZE", "Prove & sustain value", "Benefits, BAU handover, continuous improvement"],
    ];
    report("S01 exactly six phases in order with B0021 names, purposes and key outputs verbatim; gates G1..G6; objectives present; Arabic provisional",
      p.rowCount === 6 && p.rows.every((r: any, i: number) => r.ordinal === i + 1 && r.source_name_en === exp[i]![0] && r.source_purpose_en === exp[i]![1] && r.source_key_outputs_en === exp[i]![2] && r.gate_code === `G${i + 1}` && r.ar_provisional === true)
        && p.rows[4].source_objective_en.startsWith("create a fast, disciplined mechanism"),
      JSON.stringify(p.rows.map((r: any) => r.code)));
    const s = await c.query(`SELECT phase_code, count(*)::int AS n, string_agg(DISTINCT completion_rule, ',' ORDER BY completion_rule) AS rules FROM phase_step_definition GROUP BY 1 ORDER BY min(key)`);
    const by = Object.fromEntries(s.rows.map((r: any) => [r.phase_code, `${r.n}:${r.rules}`]));
    report("S02 25 step definitions: Diagnose 5, Define 3, Design 4, Mobilize 5, Transform 4, Realize 4; Transform/Realize use domain completion rules",
      by.diagnose === "5:evidence_linked" && by.define === "3:evidence_linked" && by.design === "4:evidence_linked" && by.mobilize === "5:evidence_linked"
        && by.transform === "4:evidence_linked,kpi_actual_accepted,meeting_held,raid_register_present"
        && by.realize === "4:benefit_validated,corrective_cases_owned,handover_accepted,improvement_backlog_present", JSON.stringify(by));
    const g = await c.query(`SELECT key, label_en, mandatory FROM gate_criterion_definition WHERE key ~ '^g[56]\\.' ORDER BY key`);
    report("S03 G5 and G6 each have four mandatory criteria labelled verbatim from B0023 (incl. 'Risk closure' and 'Ownership transfer')",
      g.rows.map((r: any) => r.label_en).join("|") === "Adoption|Decision log|Performance evidence|Risk closure|Benefits evidence|Controls|Continuous improvement backlog|Ownership transfer"
        && g.rows.every((r: any) => r.mandatory), JSON.stringify(g.rows.map((r: any) => r.key)));
    const mine = ["phase_step.manage", "phase_step.progress", "phase_step.review", "gate.review", "gate_exception.request", "gate_exception.decide", "scale.transition", "risk_disposition.propose", "change_request.raise", "change_control.configure"];
    const cat = Object.fromEntries((await c.query(`SELECT code, category FROM permission WHERE code = ANY ($1)`, [mine])).rows.map((r: any) => [r.code, r.category]));
    const holders = (await c.query(`SELECT string_agg(r.code, ',' ORDER BY r.code) AS h FROM role_permission rp JOIN role r ON r.id = rp.role_id WHERE rp.permission_code = 'gate_exception.decide'`)).rows[0].h;
    const bad = (await c.query(`SELECT count(*)::int AS n FROM role_permission rp JOIN role r ON r.id = rp.role_id WHERE rp.permission_code = ANY ($1) AND (r.kind = 'technical_admin' OR r.code = 'AUD')`, [mine])).rows[0].n;
    report("S04 ten slice H permissions; gate_exception.decide is business_approval held by BO and SP only; no technical admin and no AUD holds any",
      Object.keys(cat).length === 10 && cat["gate_exception.decide"] === "business_approval" && holders === "BO,SP" && bad === 0, JSON.stringify([holders, bad]));
    const w = await c.query(`SELECT code FROM work_item_kind WHERE code IN ('gate_decision_due', 'gate_exception_to_decide', 'gate_exception_expired', 'gate_condition_due', 'phase_step_enabled', 'phase_step_review', 'scale_scope_enabled')`);
    const at = await c.query(`SELECT code, subject_table FROM approval_type WHERE code IN ('change_request', 'risk_disposition') ORDER BY code`);
    const js = await c.query(`SELECT j.cron, j.timezone, (SELECT count(*)::int FROM audit_event a WHERE a.record_id = j.id) AS audits FROM job_schedule j WHERE code = 'gate.exception_expiry_scan'`);
    report("S05 seven work-item kinds, the change_request and risk_disposition approval types, and the audited daily expiry scan (Asia/Riyadh)",
      w.rowCount === 7 && at.rows.map((r: any) => `${r.code}:${r.subject_table}`).join(",") === "change_request:change_request,risk_disposition:risk_disposition"
        && js.rows[0]?.timezone === "Asia/Riyadh" && js.rows[0]?.audits === 1, JSON.stringify([w.rowCount, at.rows, js.rows]));
  }
  await expectFailure(c, "S06 a technical admin cannot be granted gate_exception.decide (0001 SoD trigger)", /technical|admin/i, async () => {
    await c.query(`INSERT INTO role_permission (role_id, permission_code) VALUES ('01920000-0000-7000-8000-00000000000c', 'gate_exception.decide')`);
  });
  await expectFailure(c, "S07 mth_app cannot write the phase or step catalogue (SELECT only)", /permission denied/, async () => {
    const app = await client("probe_fresh", "mth_app");
    try {
      await app.query(`UPDATE phase_step_definition SET source_procedure_en = 'x'`);
    } finally {
      await app.end();
    }
  });

  // --- Phase steps (REQ-S04-001).
  const step = (o: Record<string, unknown> = {}, withAudit = true) =>
    ins(c, "phase_step", { id: uid(), organization_id: ORG, transformation_id: TR, step_key: "transform.track_progress", phase_code: "transform", owner_user_id: U1, created_by: U1, updated_by: U1, ...o }, withAudit);
  let PS = "";
  await expectSuccess(c, "PS01 a step is created not_started with a named owner (audited)", async () => {
    PS = await step();
    return PS;
  });
  await expectFailure(c, "PS02 a step without its audit event fails at COMMIT (deferred audit-coverage constraint)", /phase_step_audit_required/, async () => {
    await step({ step_key: "transform.deliver_pilots" }, false);
  });
  await expectFailure(c, "PS03 a step cannot be created complete", /phase_step_status_step|phase_step_complete_shape/, async () => {
    await step({ step_key: "transform.workstreams_forums", status: "complete", completed_at: new Date() });
  });
  await expectFailure(c, "PS04 the step key must belong to the phase (composite FK to phase_step_definition)", /phase_step_definition_fkey/, async () => {
    await step({ step_key: "transform.workstreams_forums", phase_code: "realize" });
  });
  await expectFailure(c, "PS05 not_started -> complete is refused (state machine)", /phase_step_status_step|phase_step_complete_shape/, async () => {
    await upd(c, "phase_step", PS, { status: "complete", completed_at: new Date(), reviewed_by: U2, reviewed_at: new Date(), review_outcome: "accepted", completion_check: JSON.stringify({ met: true }) });
  });
  await expectSuccess(c, "PS06 not_started -> in_progress", async () => {
    await upd(c, "phase_step", PS, { status: "in_progress" });
    return "in_progress";
  });
  await expectFailure(c, "PS07 a step with an unmet completion rule cannot enter review (completion_check.met = false)", /phase_step_in_review_checked/, async () => {
    await upd(c, "phase_step", PS, { status: "in_review", review_requested_by: U1, review_requested_at: new Date(), completion_check: JSON.stringify({ rule: "kpi_actual_accepted", met: false }) });
  });
  await expectFailure(c, "PS08 an update that does not step the version by 1 is refused", /phase_step_version_step/, async () => {
    await upd(c, "phase_step", PS, { review_note: null }, { step: 2 });
  });
  await expectSuccess(c, "PS09 in_progress -> in_review with a met completion check", async () => {
    await upd(c, "phase_step", PS, { status: "in_review", review_requested_by: U1, review_requested_at: new Date(), completion_check: JSON.stringify({ rule: "kpi_actual_accepted", met: true, facts: { acceptedActuals: 1 } }) });
    return "in_review";
  });
  await expectFailure(c, "PS10 the owner cannot accept their own step (reviewer separate from owner and requester)", /phase_step_reviewer_separate/, async () => {
    await upd(c, "phase_step", PS, { status: "complete", completed_at: new Date(), reviewed_by: U1, reviewed_at: new Date(), review_outcome: "accepted" });
  });
  await expectFailure(c, "PS11 a return needs a note", /phase_step_returned_note/, async () => {
    await upd(c, "phase_step", PS, { status: "returned", reviewed_by: U2, reviewed_at: new Date(), review_outcome: "returned" });
  });
  await expectFailure(c, "PS12 the owner cannot change while the step is in review", /phase_step_owner_locked_in_review/, async () => {
    await upd(c, "phase_step", PS, { owner_user_id: U3 });
  });
  await expectSuccess(c, "PS13 another person accepts: in_review -> complete", async () => {
    await upd(c, "phase_step", PS, { status: "complete", completed_at: new Date(), reviewed_by: U2, reviewed_at: new Date(), review_outcome: "accepted", updated_by: U2 });
    return "complete";
  });
  await expectFailure(c, "PS14 a complete step is final", /phase_step_complete_final/, async () => {
    await upd(c, "phase_step", PS, { review_note: "late edit" });
  });
  await expectFailure(c, "PS15 evidence cannot be linked to a complete step", /phase_step_evidence_step_open/, async () => {
    const ev = await evidence(c);
    await ins(c, "phase_step_evidence", { id: uid(), organization_id: ORG, transformation_id: TR, phase_step_id: PS, evidence_id: ev, created_by: U1, updated_by: U1 });
  });
  await expectSuccess(c, "PS16 evidence links to an open step, once while active; removal is recorded, not deleted", async () => {
    const s2 = await step({ step_key: "transform.deliver_pilots", owner_user_id: U3 });
    const ev = await evidence(c);
    const l = await ins(c, "phase_step_evidence", { id: uid(), organization_id: ORG, transformation_id: TR, phase_step_id: s2, evidence_id: ev, created_by: U1, updated_by: U1 });
    await upd(c, "phase_step_evidence", l, { status: "removed", removed_by: U1, removed_at: new Date() });
    return l;
  });

  // --- Gate criterion reviews (REQ-S04-009, REQ-S04-010).
  const G5 = await inTx(c, () => gateInstance(c, "G5"));
  const SUB5 = await inTx(c, () => submit(c, G5, "G5", [["g5.performance_evidence", true, "complete", null], ["g5.adoption", true, "complete", null], ["g5.risk_closure", true, "complete", null], ["g5.decision_log", true, "complete", null]]));
  const review = (o: Record<string, unknown> = {}, withAudit = true) =>
    ins(c, "gate_criterion_review", { id: uid(), organization_id: ORG, transformation_id: TR, gate_submission_id: SUB5, criterion_key: "g5.risk_closure", review_no: 1, reviewer_user_id: U3, finding: "Synthetic finding", recommendation: "meets", rationale: "Synthetic rationale", ...o }, withAudit, null);
  await expectFailure(c, "GR01 the submitter cannot review their own submission (SoD)", /gate_criterion_review_not_submitter/, async () => {
    await review({ reviewer_user_id: U1 });
  });
  await expectFailure(c, "GR02 'meets with conditions' needs an open condition", /gate_criterion_review_condition_required/, async () => {
    await review({ recommendation: "meets_with_conditions" });
  });
  await expectFailure(c, "GR03 a review without its audit event fails at COMMIT", /gate_criterion_review_audit_required/, async () => {
    await review({}, false);
  });
  await expectFailure(c, "GR04 a criterion that is not in the submission cannot be reviewed", /gate_criterion_review_criterion_of_submission/, async () => {
    await review({ criterion_key: "g6.controls" });
  });
  let RV = "";
  await expectSuccess(c, "GR05 a reviewer records all six review fields (with the criterion, required evidence and completeness: nine per row)", async () => {
    const rk = await risk(c);
    RV = await review({ open_condition: "Close R-01 within 30 days", risk_note: "Residual pilot risk", raid_entry_id: rk, recommendation: "meets_with_conditions" });
    const r = (await c.query(`SELECT v.reviewer_user_id, v.finding, v.open_condition, v.risk_note, v.recommendation, v.rationale, d.label_en, d.description_en, s.completeness
      FROM gate_criterion_review v JOIN gate_criterion_definition d ON d.key = v.criterion_key
      JOIN gate_submission_criterion s ON s.gate_submission_id = v.gate_submission_id AND s.criterion_key = v.criterion_key WHERE v.id = $1`, [RV])).rows[0];
    return `${Object.values(r).filter((x) => x !== null).length} of 9 non-null`;
  });
  await expectFailure(c, "GR06 review numbers are sequential per criterion (a skipped number is refused)", /gate_criterion_review_no_sequence/, async () => {
    await review({ review_no: 3 });
  });
  await expectFailure(c, "GR07 reviews are append-only (UPDATE refused)", /append-only/, async () => {
    await c.query(`UPDATE gate_criterion_review SET finding = 'changed' WHERE id = $1`, [RV]);
  });
  await expectFailure(c, "GR08 reviews are append-only (DELETE refused)", /append-only/, async () => {
    await c.query(`DELETE FROM gate_criterion_review WHERE id = $1`, [RV]);
  });

  // --- Gate exceptions (REQ-S04-012, REQ-S04-013).
  await expectFailure(c, "GE01 an exception without a compensating action is refused", /not-null|null value/i, async () => {
    await exception(c, G5, "G5", "g5.adoption", { compensating_action: null });
  });
  await expectFailure(c, "GE02 an exception without an expiry is refused", /not-null|null value/i, async () => {
    await exception(c, G5, "G5", "g5.adoption", { expires_on: null });
  });
  await expectFailure(c, "GE03 an exception names a mandatory criterion of its own gate", /gate_exception_mandatory_criterion/, async () => {
    await exception(c, G5, "G5", "g4.roadmap");
  });
  await expectFailure(c, "GE04 an exception without its audit event fails at COMMIT", /gate_exception_audit_required/, async () => {
    await exception(c, G5, "G5", "g5.adoption", {}, false);
  });
  let E1 = "";
  await expectSuccess(c, "GE05 an exception records reason, scope, compensating action (with owner) and expiry; it starts pending", async () => {
    E1 = await exception(c, G5, "G5", "g5.adoption");
    return E1;
  });
  await expectFailure(c, "GE06 a second pending exception for the same criterion is refused", /gate_exception_one_pending_key/, async () => {
    await exception(c, G5, "G5", "g5.adoption");
  });
  await expectFailure(c, "GE07 the requester cannot accept their own exception (SoD)", /gate_exception_decider_not_requester/, async () => {
    await accept(c, E1, U1);
  });
  await expectFailure(c, "GE08 reason, scope, expiry and compensating action are fixed once requested", /gate_exception_content_immutable/, async () => {
    await upd(c, "gate_exception", E1, { expires_on: "2100-01-01" });
  });
  await expectSuccess(c, "GE09 another person (the approver) accepts it", async () => {
    await accept(c, E1);
    return "accepted";
  });
  await expectFailure(c, "GE10 accepted -> pending is refused (state machine)", /gate_exception_status_step|gate_exception_decided_complete/, async () => {
    await upd(c, "gate_exception", E1, { status: "pending", decided_by: null, decided_at: null });
  });
  await expectFailure(c, "GE11 a revocation needs its reason", /gate_exception_revoked_complete/, async () => {
    await upd(c, "gate_exception", E1, { status: "revoked", revoked_by: U2, revoked_at: new Date() });
  });
  await expectFailure(c, "GE12 the expiry notification is recorded once", /gate_exception_expiry_notified_once/, async () => {
    await upd(c, "gate_exception", E1, { expiry_notified_at: new Date() });
    await upd(c, "gate_exception", E1, { expiry_notified_at: new Date(Date.now() + 1000) });
  });
  await expectFailure(c, "GE13 a version that does not step by 1 is refused", /gate_exception_version_step/, async () => {
    await upd(c, "gate_exception", E1, { decision_note: "x note" }, { step: 0 });
  });

  // --- The D-089 Q2 CHECK: mandatory => complete, or covered by an accepted unexpired exception.
  const G6 = await inTx(c, () => gateInstance(c, "G6"));
  await expectFailure(c, "GC01 a mandatory incomplete criterion WITHOUT an exception is refused (the DG2 rule, unchanged)", /gate_submission_criterion_mandatory_complete/, async () => {
    await submit(c, G6, "G6", [["g6.ownership_transfer", true, "incomplete", null]]);
  });
  await expectFailure(c, "GC02 a pending (not accepted) exception does not cover the criterion", /gate_submission_criterion_exception_covers/, async () => {
    const e = await exception(c, G6, "G6", "g6.controls");
    await submit(c, G6, "G6", [["g6.controls", true, "incomplete", e]]);
  });
  await expectFailure(c, "GC03 an exception that expired before the submission date does not cover it (expiry re-opens the gap)", /gate_submission_criterion_exception_covers/, async () => {
    const e = await exception(c, G6, "G6", "g6.controls", { expires_on: "2026-01-31" });
    await accept(c, e);
    await submit(c, G6, "G6", [["g6.controls", true, "incomplete", e]], "2026-02-01T12:00:00Z");
  });
  await expectFailure(c, "GC04 an exception of another criterion does not cover this one", /gate_submission_criterion_exception_covers/, async () => {
    const e = await exception(c, G6, "G6", "g6.controls");
    await accept(c, e);
    await submit(c, G6, "G6", [["g6.ownership_transfer", true, "incomplete", e]]);
  });
  await expectFailure(c, "GC05 a complete criterion cannot carry an exception", /gate_submission_criterion_exception_only_incomplete/, async () => {
    const e = await exception(c, G6, "G6", "g6.controls");
    await accept(c, e);
    await submit(c, G6, "G6", [["g6.controls", true, "complete", e]]);
  });
  await expectSuccess(c, "GC06 an accepted, unexpired exception of the same gate and criterion lets the incomplete criterion be frozen (recorded on the row)", async () => {
    const e = await exception(c, G6, "G6", "g6.controls", { expires_on: "2026-02-01" });
    await accept(c, e);
    const s = await submit(c, G6, "G6", [["g6.controls", true, "incomplete", e]], "2026-02-01T20:59:00Z");
    return (await c.query(`SELECT gate_exception_id FROM gate_submission_criterion WHERE gate_submission_id = $1`, [s])).rows[0].gate_exception_id;
  });

  // --- G5 scale scope, conditions and scale transitions (REQ-S03-004, REQ-S04-007, REQ-S12-010).
  const INI = await inTx(c, () => initiative(c, "INI-01"));
  const INI2 = await inTx(c, () => initiative(c, "INI-02"));
  const scope = (gd: string, o: Record<string, unknown> = {}) => ins(c, "gate_decision_scale_scope", { id: uid(), organization_id: ORG, transformation_id: TR, gate_decision_id: gd, initiative_id: INI, business_unit_id: BU, created_by: U2, ...o }, true, null);
  const transition = (gd: string, o: Record<string, unknown> = {}) => ins(c, "scale_transition", { id: uid(), organization_id: ORG, transformation_id: TR, initiative_id: INI, business_unit_id: BU, gate_decision_id: gd, transitioned_by: U1, ...o }, true, null);
  const REJ = await inTx(c, () => decideGate(c, SUB5, "rejected"));
  await expectFailure(c, "SC01 a scale scope needs an APPROVED G5 decision (a rejected one is refused)", /gate_decision_scale_scope_g5_approved/, async () => {
    await scope(REJ);
  });
  await expectFailure(c, "SC02 a scale transition before G5 approval is refused, naming G5", /scale_transition_g5_approved/, async () => {
    await transition(REJ);
  });
  const SUB5b = await inTx(c, () => submit(c, G5, "G5", [["g5.performance_evidence", true, "complete", null], ["g5.adoption", true, "complete", null], ["g5.risk_closure", true, "complete", null], ["g5.decision_log", true, "complete", null]]));
  const APP = await inTx(c, () => decideGate(c, SUB5b, "approved"));
  await expectFailure(c, "SC03 a scope item's business unit must be in the transformation's organization", /gate_decision_scale_scope_business_unit_org/, async () => {
    await scope(APP, { business_unit_id: BU2 });
  });
  await expectSuccess(c, "SC04 an approved G5 records its scale scope (initiative + business unit) and a condition with owner and deadline", async () => {
    await scope(APP);
    await ins(c, "gate_decision_condition", { id: uid(), organization_id: ORG, transformation_id: TR, gate_decision_id: APP, ordinal: 1, condition_text: "Synthetic condition: weekly adoption review", owner_user_id: U3, due_date: "2026-12-31", created_by: U2 }, true, null);
    return "scope + condition";
  });
  await expectFailure(c, "SC05 a condition without an owner is refused", /not-null|null value/i, async () => {
    await ins(c, "gate_decision_condition", { id: uid(), organization_id: ORG, transformation_id: TR, gate_decision_id: APP, ordinal: 2, condition_text: "Synthetic condition", owner_user_id: null, due_date: "2026-12-31", created_by: U2 }, true, null);
  });
  await expectFailure(c, "SC06 scaling outside the approved scope is refused (another initiative)", /scale_transition_in_approved_scope/, async () => {
    await transition(APP, { initiative_id: INI2 });
  });
  await expectSuccess(c, "SC07 scaling inside the approved scope succeeds", async () => transition(APP));
  await expectFailure(c, "SC08 the same initiative and business unit are scaled once", /scale_transition_key/, async () => {
    await transition(APP);
  });
  await expectFailure(c, "SC09 the approved scope is append-only (UPDATE refused)", /append-only/, async () => {
    await c.query(`UPDATE gate_decision_scale_scope SET note = 'widened' WHERE gate_decision_id = $1`, [APP]);
  });
  await expectFailure(c, "SC10 a scale transition without its audit event fails at COMMIT", /scale_transition_audit_required/, async () => {
    await scope(APP, { initiative_id: INI2 });
    await c.query(`INSERT INTO scale_transition (id, organization_id, transformation_id, initiative_id, business_unit_id, gate_decision_id, transitioned_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [uid(), ORG, TR, INI2, BU, APP, U1]);
  });

  // --- Risk dispositions (REQ-PB-020, REQ-S04-007).
  let RD = "";
  await expectSuccess(c, "RD01 a disposition of an open risk is recorded and its canonical approval (type risk_disposition) can be requested", async () => {
    const rk = await risk(c);
    RD = await ins(c, "risk_disposition", { id: uid(), organization_id: ORG, transformation_id: TR, raid_entry_id: rk, disposition: "accept", rationale: "Synthetic acceptance rationale", residual_owner_user_id: U3, created_by: U1 });
    return approval(c, "risk_disposition", RD, 1);
  });
  await expectFailure(c, "RD02 an assumption cannot be dispositioned as a risk", /risk_disposition_open_risk/, async () => {
    const a = await risk(c, { entry_type: "assumption" });
    await ins(c, "risk_disposition", { id: uid(), organization_id: ORG, transformation_id: TR, raid_entry_id: a, disposition: "accept", rationale: "Synthetic", residual_owner_user_id: U3, created_by: U1 });
  });
  await expectFailure(c, "RD03 a closed risk cannot be dispositioned", /risk_disposition_open_risk/, async () => {
    const r = await risk(c);
    await upd(c, "raid_entry", r, { status: "closed", closed_at: new Date(), closed_by: U1, closure_note: "Synthetic closure" });
    await ins(c, "risk_disposition", { id: uid(), organization_id: ORG, transformation_id: TR, raid_entry_id: r, disposition: "accept", rationale: "Synthetic", residual_owner_user_id: U3, created_by: U1 });
  });
  await expectFailure(c, "RD04 a disposition is immutable (UPDATE refused)", /append-only/, async () => {
    await c.query(`UPDATE risk_disposition SET rationale = 'changed' WHERE id = $1`, [RD]);
  });

  // --- Change control (REQ-S04-014, REQ-S07-015, REQ-S09-010).
  await expectFailure(c, "CR01 a change request starts draft", /change_request_status_step/, async () => {
    await changeRequest(c, { status: "submitted" });
  });
  await expectFailure(c, "CR02 kind and subject must match (a rebaseline names a milestone)", /change_request_kind_subject/, async () => {
    await changeRequest(c, { subject_type: "charter" });
  });
  await expectFailure(c, "CR03 a change request without its audit event fails at COMMIT", /change_request_audit_required/, async () => {
    await changeRequest(c, {}, false);
  });
  let CR = "";
  await expectSuccess(c, "CR04 a draft change request is raised (CR-nn, reason, proposed change)", async () => {
    CR = await changeRequest(c);
    return CR;
  });
  await expectFailure(c, "CR05 a second open change request for the same subject is refused", /change_request_one_open_per_subject/, async () => {
    const s = (await c.query(`SELECT subject_id FROM change_request WHERE id = $1`, [CR])).rows[0].subject_id;
    await changeRequest(c, { subject_id: s });
  });
  await expectFailure(c, "CR06 submitting needs materiality, route and a frozen impact assessment", /change_request_submitted_complete/, async () => {
    await upd(c, "change_request", CR, { status: "submitted", submitted_by: U1, submitted_at: new Date() });
  });
  await expectFailure(c, "CR07 the impact assessment must be the one frozen for exactly the submitted version", /change_request_assessment_current/, async () => {
    const ia = await assessment(c, CR, 7);
    await upd(c, "change_request", CR, { status: "submitted", submitted_by: U1, submitted_at: new Date(), materiality: "material", route_party_code: "SP", current_impact_assessment_id: ia });
  });
  let IA = "";
  await expectSuccess(c, "CR08 submit with the assessment of the submitted version", async () => {
    IA = await submitCr(c, CR);
    return IA;
  });
  await expectFailure(c, "CR09 content is frozen while submitted", /change_request_content_frozen/, async () => {
    await upd(c, "change_request", CR, { reason: "Changed reason" });
  });
  await expectFailure(c, "CR10 the impact assessment is append-only (UPDATE refused)", /append-only/, async () => {
    await c.query(`UPDATE impact_assessment SET item_count = 9 WHERE id = $1`, [IA]);
  });
  await expectFailure(c, "CR11 a gate impact item must name the affected submission", /impact_assessment_item_gate_shape/, async () => {
    await ins(c, "impact_assessment_item", { id: uid(), organization_id: ORG, transformation_id: TR, impact_assessment_id: IA, ordinal: 1, item_type: "gate", label: "G2 approval", effect: "reapproval_required" }, false);
  });
  await expectSuccess(c, "CR12 a gate impact item names the preserved submission and decision", async () => {
    return ins(c, "impact_assessment_item", { id: uid(), organization_id: ORG, transformation_id: TR, impact_assessment_id: IA, ordinal: 1, item_type: "gate", label: "G5 approval", effect: "reapproval_required", gate_submission_id: SUB5b, gate_decision_id: APP }, false);
  });
  await expectFailure(c, "CR13 submitted -> approved without a person's approve decision is refused (no automatic approval)", /change_request_outcome_needs_decision/, async () => {
    await upd(c, "change_request", CR, { status: "approved", decided_at: new Date(), applied_at: new Date(), applied_record_type: "milestone", applied_record_id: uid(), applied_version: 2 });
  });
  await expectFailure(c, "CR14 a change_request approval for a stale request version is refused (approval_guard on the new subject table)", /approval_subject_version_current/, async () => {
    await approval(c, "change_request", CR, 1);
  });
  await expectSuccess(c, "CR15 with the approver's approve decision the request is approved and records its application", async () => {
    const v = (await c.query(`SELECT version FROM change_request WHERE id = $1`, [CR])).rows[0].version;
    const a = await approval(c, "change_request", CR, v);
    await approvalDecision(c, a, "approve", v);
    await upd(c, "approval", a, { status: "approved", decided_by: U2, decided_at: new Date(), updated_by: U2 });
    await upd(c, "change_request", CR, { status: "approved", decided_at: new Date(), applied_at: new Date(), applied_record_type: "milestone", applied_record_id: uid(), applied_version: 2, updated_by: U2 });
    return "approved";
  });
  await expectFailure(c, "CR16 an approved change request is final", /change_request_final|change_request_status_step/, async () => {
    await upd(c, "change_request", CR, { materiality: "not_material" });
  });
  await expectFailure(c, "CR17 a change request version that does not step by 1 is refused", /change_request_version_step/, async () => {
    const x = await changeRequest(c);
    await upd(c, "change_request", x, { reason: "Synthetic edit" }, { step: 3 });
  });
  await expectSuccess(c, "CR18 the materiality ratio is stored as an exact decimal (0.05 -> 0.050000), NULL = every change material", async () => {
    const p = await ins(c, "change_control_policy", { id: uid(), organization_id: ORG, transformation_id: TR, material_date_shift_working_days: 10, material_budget_change_ratio: "0.05", created_by: U1, updated_by: U1 });
    return (await c.query(`SELECT material_budget_change_ratio::text AS r FROM change_control_policy WHERE id = $1`, [p])).rows[0].r;
  });
  await expectFailure(c, "CR19 a negative materiality ratio is refused", /change_control_policy_material_budget_change_ratio_check/, async () => {
    await ins(c, "change_control_policy", { id: uid(), organization_id: ORG, transformation_id: TR2, material_budget_change_ratio: "-0.01", created_by: U1, updated_by: U1 });
  });
  await expectSuccess(c, "CR20 the original approval and snapshot stay retrievable unchanged after the change is approved", async () => {
    const r = (await c.query(`SELECT g.outcome, s.status, s.snapshot_sha256 FROM gate_decision g JOIN gate_submission s ON s.id = g.gate_submission_id WHERE g.id = $1`, [APP])).rows[0];
    if (r.outcome !== "approved" || r.snapshot_sha256 !== SHA) throw new Error(JSON.stringify(r));
    return JSON.stringify(r);
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
