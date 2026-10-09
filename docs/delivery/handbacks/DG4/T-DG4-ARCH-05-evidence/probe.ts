// T-DG4-ARCH-05 migration and guard probe (solution-architect). Run against a DISPOSABLE cluster only:
//   QA_PG_PORT=<port in 23700-23749> MTH_PORT_POOL=23701-23749 tests/qa/support/with-pg.sh \
//     node --conditions=@mth/source docs/delivery/handbacks/DG4/T-DG4-ARCH-05-evidence/probe.ts
// 1. Fresh database: all migrations 0001..00NN.
// 2. P3-populated database: 0001..0027 with synthetic P1-P3 data (incl. a DG3-style funding executive decision), then
//    0028..00NN on top (the 0044 forum backfill and the 0045 decision columns over existing rows).
// 3. Guard probes on the slice D tables (ADR-0032). Every probe states the expected failure; "PASS" means the guard
//    fired (or, for an expectSuccess probe, that the allowed write committed). The harness and helpers are copied
//    from the T-DG4-ARCH-04 probe. All data is SYNTHETIC and approves nothing.
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

// Fixed synthetic ids (SYNTHETIC data; approves nothing).
const ORG = "01990000-0000-7000-8000-000000000001";
const BU = "01990000-0000-7000-8000-000000000002";
const U1 = "01990000-0000-7000-8000-000000000003"; // TL / secretary
const U2 = "01990000-0000-7000-8000-000000000004"; // SP
const TR = "01990000-0000-7000-8000-000000000005";
const U3 = "01990000-0000-7000-8000-000000000006"; // BO
const TR2 = "01990000-0000-7000-8000-000000000007";
const ORG2 = "01990000-0000-7000-8000-000000000008";
const UX = "01990000-0000-7000-8000-000000000009"; // user of ORG2
const U4 = "01990000-0000-7000-8000-00000000000a"; // FIN
let seq = 100;
const uid = () => `01990000-0000-7000-8000-${(seq++).toString(16).padStart(12, "0")}`;

async function seedP1(c: any): Promise<void> {
  await c.query(`INSERT INTO organization (id, code, name_en, name_ar) VALUES ($1, 'SYN-PROBE', 'Synthetic probe org', 'منظمة تجريبية')`, [ORG]);
  await c.query(`INSERT INTO organization (id, code, name_en, name_ar) VALUES ($1, 'SYN-OTHER', 'Synthetic other org', 'منظمة أخرى')`, [ORG2]);
  await c.query(
    `INSERT INTO app_user (id, organization_id, display_name) VALUES ($1, $5, 'Synthetic TL'), ($2, $5, 'Synthetic SP'), ($3, $5, 'Synthetic BO'), ($4, $5, 'Synthetic FIN')`,
    [U1, U2, U3, U4, ORG],
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
async function audit(c: any, recordType: string, id: string, version: number | null, tr: string | null = TR): Promise<void> {
  await c.query(
    `INSERT INTO audit_event (id, organization_id, transformation_id, actor_type, actor_user_id, action, record_type, record_id, new_version, source)
     VALUES ($1, $2, $3, 'user', $4, $5, $6, $7, $8, 'cli')`,
    [uid(), ORG, tr, U1, `${recordType}.probe`, recordType, id, version],
  );
}
async function auditSvc(c: any, recordType: string, id: string, version: number | null): Promise<void> {
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
let bseq = 1;
async function benefit(c: any): Promise<string> {
  const id = uid();
  await insertRow(c, "benefit", {
    id, organization_id: ORG, transformation_id: TR, code: `B${String(bseq++).padStart(2, "0")}`, title: "Synthetic benefit",
    description: "Synthetic benefit profile", benefit_type: "cost", value_class: "cash_saving", owner_user_id: U3,
    financial_statement_line: "P&L: Operating cost", currency: "SAR", created_by: U1, updated_by: U1,
  });
  await audit(c, "benefit", id, 1);
  return id;
}

// ------------------------------------------------------------------------------------------------ slice D helpers
async function forumOf(c: any, key: string, tr = TR): Promise<string> {
  return (await c.query(`SELECT id FROM forum WHERE transformation_id = $1 AND template_key = $2`, [tr, key])).rows[0].id;
}
async function series(c: any, forum: string, o: Record<string, unknown> = {}, withAudit = true): Promise<string> {
  const id = uid();
  await insertRow(c, "meeting_series", {
    id, organization_id: ORG, transformation_id: TR, forum_id: forum, frequency: "weekly", interval_count: 1, weekdays: [1],
    start_date: "2026-10-01", start_time: "10:00", duration_minutes: 60, created_by: U1, updated_by: U1, ...o,
  });
  if (withAudit) await audit(c, "meeting_series", id, 1);
  return id;
}
async function meeting(c: any, forum: string, o: Record<string, unknown> = {}, withAudit = true): Promise<string> {
  const id = uid();
  const date = (o.scheduled_date as string) ?? "2026-10-20";
  const worker = o.created_source === "worker";
  await insertRow(c, "meeting", {
    id, organization_id: ORG, transformation_id: TR, forum_id: forum, scheduled_date: date,
    starts_at: `${date}T07:00:00Z`, ends_at: `${date}T08:00:00Z`, cutoff_date: "2026-10-18", created_source: "api",
    created_by: worker ? null : U1, updated_by: worker ? null : U1, ...o,
  });
  if (withAudit) await (worker ? auditSvc(c, "meeting", id, 1) : audit(c, "meeting", id, 1));
  return id;
}
async function agenda(c: any, mtg: string, o: Record<string, unknown> = {}, withAudit = true): Promise<string> {
  const id = uid();
  await insertRow(c, "agenda_item", {
    id, organization_id: ORG, transformation_id: TR, meeting_id: mtg, ordinal: seq, item_kind: "discussion",
    title: "Synthetic agenda item", created_by: U1, updated_by: U1, ...o,
  });
  if (withAudit) await audit(c, "agenda_item", id, 1);
  return id;
}
let dseq = 1;
async function ask(c: any, o: Record<string, unknown> = {}, options = 2, withAudit = true): Promise<string> {
  const id = uid();
  await insertRow(c, "decision", {
    id, organization_id: ORG, transformation_id: TR, kind: "executive", code: `DEC-${String(50 + dseq++).padStart(2, "0")}`,
    title: "Synthetic executive ask", owner_user_id: U2, due_date: "2026-10-30", why_now: "Synthetic trigger",
    impact_of_delay: "Synthetic delay impact", recommendation_text: "Option A", ask_origin: "api", created_source: "api",
    sla_due_date: "2026-10-30", created_by: U1, updated_by: U1, ...o,
  });
  if (withAudit) await audit(c, "decision", id, 1);
  for (let i = 0; i < options; i++) {
    const oid = uid();
    await insertRow(c, "decision_option", {
      id: oid, organization_id: ORG, transformation_id: TR, decision_id: id, label: String.fromCharCode(65 + i),
      title: `Synthetic option ${i + 1}`, ordinal: i + 1, created_by: U1, updated_by: U1,
    });
    await audit(c, "decision_option", oid, 1);
  }
  return id;
}
async function escalation(c: any, decision: string, o: Record<string, unknown> = {}, withAudit = true): Promise<string> {
  const id = uid();
  await insertRow(c, "decision_escalation", {
    id, organization_id: ORG, transformation_id: TR, decision_id: decision, sla_due_date: "2026-10-30",
    business_date: "2026-11-01", level: 1, party_code: "SP", target_user_id: U2, delay_impact: "Synthetic delay impact", ...o,
  });
  if (withAudit) await auditSvc(c, "decision_escalation", id, null);
  return id;
}
async function raid(c: any): Promise<string> {
  const id = uid();
  await insertRow(c, "raid_entry", {
    id, organization_id: ORG, transformation_id: TR, entry_type: "issue", code: `I-${String(seq).padStart(2, "0")}`,
    description: "Synthetic blocker", impact: "high", owner_user_id: U3, created_by: U1, updated_by: U1,
  });
  await audit(c, "raid_entry", id, 1);
  return id;
}
async function blocker(c: any, mtg: string, forum: string, date: string, src: string, o: Record<string, unknown> = {}, withAudit = true): Promise<string> {
  const id = uid();
  await insertRow(c, "blocker_status", {
    id, organization_id: ORG, transformation_id: TR, meeting_id: mtg, forum_id: forum, cycle_date: date,
    source_record_type: "raid_entry", source_record_id: src, rag: "red", created_by: U1, ...o,
  });
  if (withAudit) await audit(c, "blocker_status", id, null);
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
  report("G01 fresh database: 0001..last apply", applied.length === files.length, `applied ${applied.length}: ${applied.slice(41).join(", ")}`);

  // 2. P3-populated database (with a DG3-style funding executive decision), then P4 on top.
  await createDb("probe_p3");
  const p3Dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "p3-migrations-"));
  for (const f of files.filter((f) => Number(f.slice(0, 4)) <= LAST_P3)) cpSync(join(migrationsDir, f), join(p3Dir, f));
  const p3Applied = await migrate(roleUrl("probe_p3", "mth_owner"), { dir: p3Dir });
  const OLD_DEC = uid();
  {
    const c = await client("probe_p3");
    await seedP1(c);
    await c.query(`SELECT p3_instantiate_transformation($1, NULL, NULL, 'migration') AS n`, [TR]);
    await c.query("BEGIN");
    await c.query(
      `INSERT INTO decision (id, organization_id, transformation_id, kind, code, title, owner_user_id, status, outcome_text, decided_by, decided_at, created_by, updated_by)
       VALUES ($1, $2, $3, 'executive', 'DEC-01', 'Funding decision: INI-01 Synthetic', $4, 'decided', 'approved: synthetic', $4, now(), $4, $4)`,
      [OLD_DEC, ORG, TR, U2],
    );
    await audit(c, "decision", OLD_DEC, 1);
    await c.query("COMMIT");
    report("G02 P3 database populated (0001-0027, a synthetic transformation, a DG3-style funding executive decision)", p3Applied.length === LAST_P3, `applied ${p3Applied.length}`);
    await c.end();
  }
  const p4OnTop = await migrate(roleUrl("probe_p3", "mth_owner"), { dir: migrationsDir });
  {
    const c = await client("probe_p3");
    report("G03 P4 over the P3 database: 0028+ apply", p4OnTop.length === files.length - LAST_P3, `applied ${p4OnTop.join(", ")}`);
    const f = await c.query(`SELECT template_key, name_en, cadence_label, version FROM forum WHERE transformation_id = $1 ORDER BY ordinal`, [TR]);
    const a = await c.query(`SELECT count(*)::int AS n FROM audit_event WHERE record_type = 'forum' AND transformation_id = $2 AND actor_type = 'system' AND on_behalf_of_user_id = $1 AND source = 'migration'`, [U1, TR]);
    report("G04 backfill: the existing transformation has the five forums (audited 'system' on behalf of its creator)",
      f.rowCount === 5 && f.rows.map((r: any) => r.template_key).join(",") === "executive_steerco,transformation_review,workstream_review,rapid_response,value_review" && a.rows[0].n === 5,
      JSON.stringify([a.rows[0].n, f.rows.map((r: any) => [r.template_key, r.cadence_label])]));
    const d = await c.query(`SELECT version, ask_origin, why_now, impact_of_delay, sla_due_date FROM decision WHERE id = $1`, [OLD_DEC]);
    const l = await c.query(`SELECT t16_id, decision, outcome, ask_origin FROM executive_decision_log WHERE id = $1`, [OLD_DEC]);
    report("G05 the pre-P4 executive (funding) decision is unchanged by 0045 (version 1, T16 columns NULL) and is listed in the T16 view",
      d.rows[0].version === 1 && d.rows[0].ask_origin === null && d.rows[0].why_now === null && l.rowCount === 1 && l.rows[0].t16_id === "DEC-01", JSON.stringify([d.rows, l.rows]));
    const again = await c.query(`SELECT p4_instantiate_forums($1, $2, 'probe', 'cli') AS n`, [TR, U1]);
    report("G06 p4_instantiate_forums is idempotent (a second run creates nothing)", again.rows[0].n === 0, `created ${again.rows[0].n}`);
    await c.end();
  }

  // 3. Guard probes on the fresh database.
  const c = await client("probe_fresh");
  await inTx(c, async () => {
    await seedP1(c);
    const n = await c.query(`SELECT p4_instantiate_forums($1, $2, 'probe', 'cli') AS n`, [TR, U1]);
    if (n.rows[0].n !== 5) throw new Error(`expected 5 forums, got ${n.rows[0].n}`);
  });

  // --- Seeds.
  {
    const t = await c.query(`SELECT key, source_layer_en, source_cadence_en, source_purpose_en, source_participants_en, source_outputs_en, ar_provisional FROM forum_template ORDER BY ordinal`);
    const expected = [
      ["executive_steerco", "Executive SteerCo", "Monthly", "Outcomes, major trade-offs, funding, escalation", "Sponsor + CxOs + Transformation Lead", "Decisions, unblockers, benefit view"],
      ["transformation_review", "Transformation Review", "Bi-weekly", "Portfolio health, dependencies, risks, decisions", "Transformation Lead + workstream leads", "Integrated status, decision log"],
      ["workstream_review", "Workstream Review", "Weekly", "Delivery, issues, actions", "Workstream lead + team", "Milestones, actions, RAID"],
      ["rapid_response", "Rapid Response / Sprint", "Daily / 2-3x week", "Solve high-priority cross-functional issue", "Small empowered team", "Test, evidence, recommendation"],
      ["value_review", "Value Review", "Monthly", "Validate realized benefits vs plan", "Finance + benefit owners", "Benefit evidence, forecast, corrective action"],
    ];
    const got = t.rows.map((r: any) => [r.key, r.source_layer_en, r.source_cadence_en, r.source_purpose_en, r.source_participants_en, r.source_outputs_en]);
    report("S01 the five B0093 layers are seeded verbatim (Layer, Cadence, Purpose, Participants, Outputs), Arabic marked provisional",
      JSON.stringify(got) === JSON.stringify(expected) && t.rows.every((r: any) => r.ar_provisional === true), JSON.stringify(got.map((r: string[]) => r[2])));
    const codes = ["forum.configure", "meeting.prepare", "meeting.chair", "executive_decision.create", "executive_decision.decide", "escalation_rule.configure"];
    const p = await c.query(`SELECT code, category FROM permission WHERE code = ANY ($1) ORDER BY code`, [codes]);
    const adm = await c.query(`SELECT count(*)::int AS n FROM role_permission rp JOIN role r ON r.id = rp.role_id WHERE rp.permission_code = ANY ($1) AND (r.kind = 'technical_admin' OR r.code = 'AUD')`, [codes]);
    const grants = await c.query(`SELECT rp.permission_code AS p, string_agg(r.code, ',' ORDER BY r.code) AS roles FROM role_permission rp JOIN role r ON r.id = rp.role_id WHERE rp.permission_code = ANY ($1) GROUP BY 1 ORDER BY 1`, [codes]);
    const g = Object.fromEntries(grants.rows.map((r: any) => [r.p, r.roles]));
    const cat = Object.fromEntries(p.rows.map((r: any) => [r.code, r.category]));
    report("S02 six slice D permissions; executive_decision.decide is business_approval held by BO,FIN,SP only; none held by AUD or a technical admin",
      p.rowCount === 6 && adm.rows[0].n === 0 && cat["executive_decision.decide"] === "business_approval" && g["executive_decision.decide"] === "BO,FIN,SP"
        && g["forum.configure"] === "TO" && g["meeting.prepare"] === "SEC,TL,TO" && g["executive_decision.create"] === "SEC,TL,TO"
        && g["meeting.chair"] === "BO,FIN,SP,TL,TO,WL" && g["escalation_rule.configure"] === "TL,TO",
      JSON.stringify([cat, g]));
    const w = await c.query(`SELECT code FROM work_item_kind WHERE owner_module = 'governance' ORDER BY code`);
    report("S03 the four slice D work-item kinds are seeded", w.rows.map((r: any) => r.code).join(",") === "executive_decision_due,executive_decision_escalated,meeting_action_due,minutes_to_approve", JSON.stringify(w.rows));
  }
  await expectFailure(c, "S04 a technical admin cannot be granted executive_decision.decide (0001 trigger)", /role_permission_no_admin_approver|technical/i, async () => {
    await c.query(`INSERT INTO role_permission (role_id, permission_code) VALUES ('01920000-0000-7000-8000-00000000000c', 'executive_decision.decide')`);
  });
  await expectFailure(c, "S05 mth_app cannot write the forum template (SELECT only)", /permission denied/, async () => {
    const app = await client("probe_fresh", "mth_app");
    try {
      await app.query(`UPDATE forum_template SET source_cadence_en = 'x'`);
    } finally {
      await app.end();
    }
  });

  await expectSuccess(c, "G07 p4_instantiate_transformation (redefined by 0044) also creates the five forums, and a second call creates nothing", async () => {
    const first = await c.query(`SELECT p4_instantiate_transformation($1, $2, 'probe', 'cli') AS n`, [TR2, U1]);
    const second = await c.query(`SELECT p4_instantiate_transformation($1, $2, 'probe', 'cli') AS n`, [TR2, U1]);
    const f = await c.query(`SELECT count(*)::int AS n FROM forum WHERE transformation_id = $1`, [TR2]);
    if (f.rows[0].n !== 5 || second.rows[0].n !== 0) throw new Error(`forums ${f.rows[0].n}, second call ${second.rows[0].n}`);
    return `first call created ${first.rows[0].n} rows (incl. 5 forums); second 0`;
  });
  const STEERCO = await forumOf(c, "executive_steerco");
  const TREVIEW = await forumOf(c, "transformation_review");
  const WREVIEW = await forumOf(c, "workstream_review");
  const VALUE = await forumOf(c, "value_review");

  // --- Forums (REQ-PB-060, REQ-S10-005).
  await expectFailure(c, "F01 a forum without its audit event fails at COMMIT", /forum_audit_required/, async () => {
    await insertRow(c, "forum", { id: uid(), organization_id: ORG, transformation_id: TR, ordinal: 9, name_en: "X", name_ar: "س", cadence_label: "Ad hoc", purpose: "p", participants_label: "p", outputs_label: "o", output_kinds: ["decision"], created_by: U1, updated_by: U1 });
  });
  await expectFailure(c, "F02 a forum update that does not step the version by 1 is refused", /forum_version_step/, async () => {
    await setRow(c, "forum", WREVIEW, { quorum_min: 3 }, { step: 2 });
  });
  await expectSuccess(c, "F03 a forum's quorum, cut-off and agenda rules are configurable (versioned, audited)", async () => {
    await setRow(c, "forum", WREVIEW, { quorum_min: 2, cutoff_working_days: 3, late_items_rule: "refuse" });
    return "workstream review: quorum 2, cut-off 3 working days";
  });
  await expectFailure(c, "F04 an unknown governance party is refused", /forum_participant_parties_known/, async () => {
    await setRow(c, "forum", WREVIEW, { participant_parties: ["WL", "NOPE"] });
  });
  await expectFailure(c, "F05 an output kind outside the B0093 set is refused", /forum_output_kinds_valid/, async () => {
    await setRow(c, "forum", WREVIEW, { output_kinds: ["milestone", "status_report"] });
  });
  await expectFailure(c, "F06 a publication requirement must be one of the forum's outputs", /forum_publish_outputs_subset/, async () => {
    await setRow(c, "forum", WREVIEW, { publish_requires_any_output: ["forecast"] });
  });
  await expectFailure(c, "F07 the template key of a forum is immutable", /forum_template_immutable/, async () => {
    await setRow(c, "forum", WREVIEW, { template_key: "value_review" });
  });
  await expectFailure(c, "F08 a second copy of a template layer in one transformation is refused", /forum_template_key/, async () => {
    const id = uid();
    await insertRow(c, "forum", { id, organization_id: ORG, transformation_id: TR, template_key: "value_review", ordinal: 9, name_en: "X", name_ar: "س", cadence_label: "Monthly", purpose: "p", participants_label: "p", outputs_label: "o", output_kinds: ["forecast"], created_by: U1, updated_by: U1 });
    await audit(c, "forum", id, 1);
  });
  await expectFailure(c, "FP01 a forum participant names exactly one person or group", /forum_participant_one_target/, async () => {
    await insertRow(c, "forum_participant", { id: uid(), organization_id: ORG, transformation_id: TR, forum_id: WREVIEW, created_by: U1, updated_by: U1 });
  });
  await expectFailure(c, "FP02 one active participation per person and forum", /forum_participant_active_user_key/, async () => {
    for (let i = 0; i < 2; i++) {
      const id = uid();
      await insertRow(c, "forum_participant", { id, organization_id: ORG, transformation_id: TR, forum_id: WREVIEW, user_id: U3, created_by: U1, updated_by: U1 });
      await audit(c, "forum_participant", id, 1);
    }
  });

  // --- Meeting series (REQ-PB-060, REQ-S10-005).
  await expectFailure(c, "MS01 a weekly series needs its weekdays", /meeting_series_rule_shape/, async () => {
    await series(c, WREVIEW, { weekdays: null });
  });
  await expectFailure(c, "MS02 a series without its audit event fails at COMMIT", /meeting_series_audit_required/, async () => {
    await series(c, WREVIEW, {}, false);
  });
  const SER = await inTx(c, () => series(c, WREVIEW));
  await expectFailure(c, "MS03 one active series per forum", /meeting_series_one_active_key/, async () => {
    await series(c, WREVIEW);
  });
  await expectFailure(c, "MS04 a recurrence change that does not step rule_version is refused", /meeting_series_rule_version_step/, async () => {
    await setRow(c, "meeting_series", SER, { interval_count: 2 });
  });
  await expectSuccess(c, "MS05 weekly -> fortnightly with rule_version + 1 is accepted (REQ-S10-005 A06)", async () => {
    await setRow(c, "meeting_series", SER, { interval_count: 2, rule_version: 2 });
    return "rule_version 2";
  });
  await expectFailure(c, "MS06 the job may not change the recurrence (a person changes it)", /meeting_series_author_required/, async () => {
    await setRow(c, "meeting_series", SER, { interval_count: 1, rule_version: 3, updated_by: null }, { svc: true });
  });
  await expectSuccess(c, "MS07 the job may advance generated_through (actor service)", async () => {
    await setRow(c, "meeting_series", SER, { generated_through: "2026-12-31", updated_by: null }, { svc: true });
    return "generated_through set";
  });

  // --- Meetings (REQ-S10-011, REQ-S10-005).
  await expectFailure(c, "M01 a worker meeting must come from a series", /meeting_created_source|meeting_series_fields/, async () => {
    await meeting(c, WREVIEW, { created_source: "worker" });
  });
  await expectFailure(c, "M02 a meeting without its audit event fails at COMMIT", /meeting_audit_required/, async () => {
    await meeting(c, WREVIEW, {}, false);
  });
  const FUT = await inTx(c, () => meeting(c, WREVIEW, { created_source: "worker", series_id: SER, series_rule_version: 2, occurrence_date: "2099-01-07", scheduled_date: "2099-01-07", cutoff_date: "2099-01-05" }));
  await expectFailure(c, "M03 a second meeting for the same series occurrence is refused (idempotent generation)", /meeting_series_occurrence_key/, async () => {
    await meeting(c, WREVIEW, { created_source: "worker", series_id: SER, series_rule_version: 2, occurrence_date: "2099-01-07", scheduled_date: "2099-01-07" });
  });
  await expectFailure(c, "M04 a new meeting starts scheduled", /meeting_starts_scheduled/, async () => {
    await meeting(c, WREVIEW, { status: "in_session" });
  });
  const PAST = await inTx(c, () => meeting(c, WREVIEW, { created_source: "worker", series_id: SER, series_rule_version: 2, occurrence_date: "2020-01-01", scheduled_date: "2020-01-01", cutoff_date: "2019-12-30" }));
  await expectFailure(c, "M05 regeneration never cancels a past meeting (future only, REQ-S10-005)", /meeting_regenerate_future_only/, async () => {
    await setRow(c, "meeting", PAST, { status: "cancelled", cancel_reason: "series_regenerated", cancelled_at: new Date(), updated_by: null }, { svc: true });
  });
  await expectSuccess(c, "M06 regeneration cancels a future scheduled series meeting and a new one takes the date under the new rule", async () => {
    await setRow(c, "meeting", FUT, { status: "cancelled", cancel_reason: "series_regenerated", cancelled_at: new Date(), updated_by: null }, { svc: true });
    await meeting(c, WREVIEW, { created_source: "worker", series_id: SER, series_rule_version: 2, occurrence_date: "2099-01-07", scheduled_date: "2099-01-07", cutoff_date: "2099-01-05" });
    return "cancelled + regenerated";
  });
  await expectFailure(c, "M07 a cancelled meeting is final", /meeting_final/, async () => {
    await setRow(c, "meeting", FUT, { location: "x", updated_by: U1 });
  });
  const MW = await inTx(c, () => meeting(c, WREVIEW, { quorum_min: 2 }));
  await expectFailure(c, "M08 scheduled -> held skips the session and is refused", /meeting_status_transition/, async () => {
    await setRow(c, "meeting", MW, { status: "held" });
  });
  await expectFailure(c, "M09 a manual cancellation needs who and a note", /meeting_cancelled_complete/, async () => {
    await setRow(c, "meeting", MW, { status: "cancelled", cancel_reason: "manual", cancelled_at: new Date() });
  });
  await expectFailure(c, "M10 minutes_published needs published minutes", /meeting_minutes_required|meeting_status_transition/, async () => {
    await setRow(c, "meeting", MW, { status: "in_session", started_at: new Date() });
    await setRow(c, "meeting", MW, { status: "held", held_at: new Date() });
    await setRow(c, "meeting", MW, { status: "minutes_published" });
  });

  // --- Agenda items, executive asks, quorum (REQ-PB-068, REQ-S10-011, REQ-S10-012).
  const MS = await inTx(c, () => meeting(c, STEERCO));
  await expectFailure(c, "A01 an executive forum takes executive asks only ('Escalate decisions, not status', B0102)", /agenda_item_executive_asks_only/, async () => {
    await agenda(c, MS, { item_kind: "information" });
  });
  await expectFailure(c, "A02 an agenda item without its audit event fails at COMMIT", /agenda_item_audit_required/, async () => {
    await agenda(c, MS, { item_kind: "executive_ask" }, false);
  });
  const DEC1 = await inTx(c, () => ask(c));
  await expectFailure(c, "A03 an ask links a T16 decision or carries a brief, never both (one copy of an ask)", /agenda_item_ask_shape/, async () => {
    await agenda(c, MS, { item_kind: "executive_ask", decision_id: DEC1, ask_why_now: "copy" });
  });
  const BRIEF = await inTx(c, () => agenda(c, MS, { item_kind: "executive_ask", ask_decision_required: "Synthetic decision", ask_why_now: "Synthetic trigger", ask_options: ["A", "B"], ask_recommendation: "A", ask_owner_user_id: U2, ask_required_date: "2026-10-30" }));
  await expectFailure(c, "A04 REQ-PB-068: an executive ask cannot be published while its elements are still an unlinked brief (e.g. no Impact of delay)", /agenda_item_published_ask_linked/, async () => {
    await setRow(c, "agenda_item", BRIEF, { status: "published", published_at: new Date(), published_by: U2 });
  });
  const LINKED = await inTx(c, () => agenda(c, MS, { item_kind: "executive_ask", decision_id: DEC1 }));
  await expectSuccess(c, "A05 a linked executive ask is published", async () => {
    await setRow(c, "agenda_item", LINKED, { status: "published", published_at: new Date(), published_by: U2 });
    return "published";
  });
  await expectFailure(c, "A06 a published agenda item is frozen", /agenda_item_published_frozen/, async () => {
    await setRow(c, "agenda_item", LINKED, { title: "changed" });
  });
  await expectFailure(c, "A07 a decision is recorded only while the meeting is in session or held", /agenda_item_meeting_not_in_session/, async () => {
    await setRow(c, "agenda_item", LINKED, { status: "closed", outcome: "decided", outcome_recorded_at: new Date(), outcome_recorded_by: U2 });
  });
  // Quorum on the steerco meeting: quorum 2, one person present.
  await inTx(c, async () => {
    await setRow(c, "meeting", MS, { quorum_min: 2, status: "in_session", started_at: new Date() });
    for (const [u, a] of [[U2, "present"], [U3, "absent"]]) {
      const id = uid();
      await insertRow(c, "meeting_attendance", { id, organization_id: ORG, transformation_id: TR, meeting_id: MS, user_id: u, attendance: a, created_by: U1, updated_by: U1 });
      await audit(c, "meeting_attendance", id, 1);
    }
  });
  await expectFailure(c, "A08 REQ-S10-011: with quorum 2 configured and 1 counted present, a decision cannot be recorded", /agenda_item_quorum_met/, async () => {
    await setRow(c, "agenda_item", LINKED, { status: "closed", outcome: "decided", outcome_quorum_present: 1, outcome_recorded_at: new Date(), outcome_recorded_by: U2 });
  });
  await expectSuccess(c, "A09 with a second person present the quorum is met and the decision is recorded", async () => {
    const id = uid();
    await insertRow(c, "meeting_attendance", { id, organization_id: ORG, transformation_id: TR, meeting_id: MS, user_id: U4, attendance: "present", created_by: U1, updated_by: U1 });
    await audit(c, "meeting_attendance", id, 1);
    await setRow(c, "agenda_item", LINKED, { status: "closed", outcome: "decided", outcome_quorum_present: 2, outcome_recorded_at: new Date(), outcome_recorded_by: U2 });
    return "quorum 2/2";
  });
  await expectFailure(c, "A10 a closed agenda item is final", /agenda_item_final/, async () => {
    await setRow(c, "agenda_item", LINKED, { status: "withdrawn" });
  });
  await expectFailure(c, "AT01 one attendance row per person and meeting", /meeting_attendance_person_key/, async () => {
    const id = uid();
    await insertRow(c, "meeting_attendance", { id, organization_id: ORG, transformation_id: TR, meeting_id: MS, user_id: U2, attendance: "present", created_by: U1, updated_by: U1 });
  });
  await expectFailure(c, "AT02 an absent person represents nobody", /meeting_attendance_proxy_present/, async () => {
    await insertRow(c, "meeting_attendance", { id: uid(), organization_id: ORG, transformation_id: TR, meeting_id: MS, user_id: U1, attendance: "absent", on_behalf_of_user_id: U3, created_by: U1, updated_by: U1 });
  });

  // --- Outputs, minutes (REQ-PB-061, REQ-S10-011).
  const MV = await inTx(c, async () => {
    const m = await meeting(c, VALUE);
    await setRow(c, "meeting", m, { status: "in_session", started_at: new Date() });
    await setRow(c, "meeting", m, { status: "held", held_at: new Date() });
    return m;
  });
  await expectFailure(c, "O01 an output must be one of the forum's outputs (Value Review has no 'milestone')", /meeting_output_kind_of_forum/, async () => {
    await insertRow(c, "meeting_output", { id: uid(), organization_id: ORG, transformation_id: TR, meeting_id: MV, output_kind: "milestone", note: "x", created_by: U1 });
  });
  await expectFailure(c, "O02 a forecast entry links a canonical benefit or measurement", /meeting_output_record_type/, async () => {
    await insertRow(c, "meeting_output", { id: uid(), organization_id: ORG, transformation_id: TR, meeting_id: MV, output_kind: "forecast", note: "a number in a note", created_by: U1 });
  });
  await expectFailure(c, "O03 a linked record must exist in the same transformation", /meeting_output_record_ref/, async () => {
    await insertRow(c, "meeting_output", { id: uid(), organization_id: ORG, transformation_id: TR, meeting_id: MV, output_kind: "forecast", record_type: "benefit", record_id: uid(), created_by: U1 });
  });
  const MIN = await inTx(c, async () => {
    const id = uid();
    await insertRow(c, "meeting_minutes", { id, organization_id: ORG, transformation_id: TR, meeting_id: MV, body: "Synthetic minutes", created_by: U1, updated_by: U1 });
    await audit(c, "meeting_minutes", id, 1);
    await setRow(c, "meeting_minutes", id, { status: "approved", approved_at: new Date(), approved_by: U4 });
    return id;
  });
  await expectFailure(c, "MN01 approved minutes are not edited in place", /meeting_minutes_approved_frozen/, async () => {
    await setRow(c, "meeting_minutes", MIN, { body: "changed" });
  });
  await expectFailure(c, "MN02 REQ-PB-061: a Value Review meeting cannot be published without a benefit evidence or forecast entry", /meeting_minutes_required_output/, async () => {
    await setRow(c, "meeting_minutes", MIN, { status: "published", published_at: new Date(), published_by: U4 });
  });
  const BEN = await inTx(c, () => benefit(c));
  let OUT = "";
  await expectSuccess(c, "MN03 with a forecast entry linked to a benefit the minutes are published, and the meeting moves to minutes_published", async () => {
    OUT = uid();
    await insertRow(c, "meeting_output", { id: OUT, organization_id: ORG, transformation_id: TR, meeting_id: MV, output_kind: "forecast", record_type: "benefit", record_id: BEN, created_by: U1 });
    await audit(c, "meeting_output", OUT, null);
    await setRow(c, "meeting_minutes", MIN, { status: "published", published_at: new Date(), published_by: U4 });
    await setRow(c, "meeting", MV, { status: "minutes_published" });
    return "published";
  });
  await expectFailure(c, "MN04 published minutes are immutable", /meeting_minutes_published_immutable/, async () => {
    await setRow(c, "meeting_minutes", MIN, { body: "rewritten" });
  });
  await expectFailure(c, "MN05 after publication the meeting's records are frozen (a new attendance row is refused)", /meeting_attendance_meeting_frozen/, async () => {
    await insertRow(c, "meeting_attendance", { id: uid(), organization_id: ORG, transformation_id: TR, meeting_id: MV, user_id: U3, attendance: "present", created_by: U1, updated_by: U1 });
  });
  await expectFailure(c, "MN06 a meeting with published minutes is final", /meeting_final/, async () => {
    await setRow(c, "meeting", MV, { location: "x" });
  });
  await expectFailure(c, "MN07 minutes need a held meeting to be published (the SteerCo meeting is still in session)", /meeting_minutes_meeting_held/, async () => {
    const id = uid();
    await insertRow(c, "meeting_minutes", { id, organization_id: ORG, transformation_id: TR, meeting_id: MS, body: "x", created_by: U1, updated_by: U1 });
    await audit(c, "meeting_minutes", id, 1);
    await setRow(c, "meeting_minutes", id, { status: "approved", approved_at: new Date(), approved_by: U2 });
    await setRow(c, "meeting_minutes", id, { status: "published", published_at: new Date(), published_by: U2 });
  });
  await expectFailure(c, "O04 meeting outputs are append-only (UPDATE refused)", /append-only/, async () => {
    await c.query(`UPDATE meeting_output SET note = 'x' WHERE id = $1`, [OUT]);
  });
  await expectFailure(c, "O05 meeting outputs are append-only (DELETE refused)", /append-only/, async () => {
    await c.query(`DELETE FROM meeting_output WHERE id = $1`, [OUT]);
  });
  await expectFailure(c, "O06 a meeting output without its audit event fails at COMMIT", /meeting_output_audit_required/, async () => {
    await insertRow(c, "meeting_output", { id: uid(), organization_id: ORG, transformation_id: TR, meeting_id: MS, output_kind: "decision", record_type: "decision", record_id: DEC1, created_by: U1 });
  });

  // --- Meeting action links (REQ-S16-019 MeetingActionLink).
  const ACT = await inTx(c, async () => {
    const id = uid();
    await insertRow(c, "action_item", { id, organization_id: ORG, transformation_id: TR, title: "Synthetic meeting action", owner_user_id: U3, created_by: U1, updated_by: U1 });
    await audit(c, "action_item", id, 1);
    const l = uid();
    await insertRow(c, "meeting_action_link", { id: l, organization_id: ORG, transformation_id: TR, meeting_id: MS, action_item_id: id, link_kind: "assigned", created_by: U1 });
    await audit(c, "meeting_action_link", l, null);
    return id;
  });
  await expectFailure(c, "L01 one link per meeting and action", /meeting_action_link_key/, async () => {
    await insertRow(c, "meeting_action_link", { id: uid(), organization_id: ORG, transformation_id: TR, meeting_id: MS, action_item_id: ACT, link_kind: "reviewed", created_by: U1 });
  });
  await expectFailure(c, "L02 meeting action links are append-only", /append-only/, async () => {
    await c.query(`UPDATE meeting_action_link SET link_kind = 'reviewed' WHERE action_item_id = $1`, [ACT]);
  });

  // --- T16 executive asks (REQ-PB-081, REQ-S10-012).
  await expectFailure(c, "D01 REQ-S10-012: an ask without 'why now' is refused", /decision_ask_complete/, async () => {
    await ask(c, { why_now: null });
  });
  await expectFailure(c, "D02 an ask without 'impact of delay' is refused", /decision_ask_complete/, async () => {
    await ask(c, { impact_of_delay: null });
  });
  await expectFailure(c, "D03 an ask with one option fails at COMMIT (Options A/B/C)", /decision_ask_options/, async () => {
    await ask(c, {}, 1);
  });
  await expectFailure(c, "D04 an executive ask without its audit event fails at COMMIT", /decision_audit_required/, async () => {
    await ask(c, {}, 2, false);
  });
  await expectFailure(c, "D05 only an executive decision carries the ask columns", /decision_ask_executive_only|decision_code_format/, async () => {
    await ask(c, { kind: "design", code: "D-77" });
  });
  await expectFailure(c, "D06 a decided ask has its Outcome recorded", /decision_ask_outcome_recorded/, async () => {
    await setRow(c, "decision", DEC1, { status: "decided", decided_at: new Date(), decided_by: U2 });
  });
  await expectFailure(c, "D07 the ask origin is immutable", /decision_ask_origin_immutable/, async () => {
    await setRow(c, "decision", DEC1, { ask_origin: "agenda" });
  });
  await expectFailure(c, "D08 the SLA due date is known or carries its Unknown reason", /decision_ask_sla_known_or_reason/, async () => {
    await ask(c, { sla_due_date: null });
  });
  const RAID = await inTx(c, () => raid(c));
  const BLOCKER_ASK = { ask_origin: "blocker_escalation", created_source: "worker", why_now: null, impact_of_delay: null, recommendation_text: null, blocker_record_type: "raid_entry", blocker_record_id: RAID, sla_due_date: "2026-11-12", due_date: "2026-11-12" };
  const B1 = await inTx(c, () => ask(c, BLOCKER_ASK, 0));
  await expectFailure(c, "D09 REQ-PB-082: a second open ask for the same blocker is refused", /decision_one_open_blocker_ask/, async () => {
    await ask(c, BLOCKER_ASK, 0);
  });
  await expectFailure(c, "D10 only the worker raises a blocker escalation", /decision_ask_source/, async () => {
    await ask(c, { ...BLOCKER_ASK, created_source: "api" }, 0);
  });
  await expectFailure(c, "D11 a blocker escalation names an existing blocker", /decision_blocker_ref/, async () => {
    await ask(c, { ...BLOCKER_ASK, blocker_record_id: uid() }, 0);
  });

  // --- Decision-SLA escalation (REQ-S12-011).
  await expectFailure(c, "E01 an ask whose SLA has not expired is not escalated", /decision_escalation_expired/, async () => {
    await escalation(c, DEC1, { business_date: "2026-10-30" });
  });
  await expectFailure(c, "E02 an escalation names the ask's current SLA due date", /decision_escalation_open_ask/, async () => {
    await escalation(c, DEC1, { sla_due_date: "2026-10-29" });
  });
  await expectFailure(c, "E03 an escalation without its audit event fails at COMMIT", /decision_escalation_audit_required/, async () => {
    await escalation(c, DEC1, {}, false);
  });
  const E1 = await inTx(c, () => escalation(c, DEC1));
  await expectFailure(c, "E04 a second escalation for the same SLA due date is refused (escalates once)", /decision_escalation_once/, async () => {
    await escalation(c, DEC1, { level: 2 });
  });
  await expectFailure(c, "E05 escalations are append-only (UPDATE refused)", /append-only/, async () => {
    await c.query(`UPDATE decision_escalation SET level = 3 WHERE id = $1`, [E1]);
  });
  await expectFailure(c, "E06 a routing error carries no target", /decision_escalation_target/, async () => {
    await escalation(c, B1, { sla_due_date: "2026-11-12", business_date: "2026-11-13", routing_error: "party_unmapped" });
  });
  await expectFailure(c, "E07 levels step by exactly 1", /decision_escalation_level_step/, async () => {
    await escalation(c, B1, { sla_due_date: "2026-11-12", business_date: "2026-11-13", level: 2 });
  });
  await expectSuccess(c, "E08 recording the Outcome closes the ask (status decided with outcome)", async () => {
    await setRow(c, "decision", DEC1, { status: "decided", decided_at: new Date(), decided_by: U2, outcome_text: "Option A chosen" });
    return "decided";
  });
  await expectFailure(c, "E09 a decided ask is never escalated", /decision_escalation_open_ask/, async () => {
    await setRow(c, "decision", DEC1, { sla_due_date: "2026-10-31" });
    await escalation(c, DEC1, { sla_due_date: "2026-10-31", level: 2 });
  });
  await expectSuccess(c, "E10 after the blocker ask is decided, a new open ask for the same blocker is allowed", async () => {
    await setRow(c, "decision", B1, { status: "decided", decided_at: new Date(), decided_by: U2, outcome_text: "Unblocked" });
    await ask(c, BLOCKER_ASK, 0);
    return "second ask after the first closed";
  });

  // --- Blocker RAG per cycle (REQ-PB-082).
  const MT = await inTx(c, () => meeting(c, TREVIEW, { scheduled_date: "2026-10-22" }));
  await expectFailure(c, "B01 a blocker RAG is recorded in a meeting in session or held", /blocker_status_meeting_in_session/, async () => {
    await blocker(c, MT, TREVIEW, "2026-10-22", RAID);
  });
  await inTx(c, () => setRow(c, "meeting", MT, { status: "in_session", started_at: new Date() }));
  await expectFailure(c, "B02 the cycle date and forum are the meeting's own", /blocker_status_cycle_of_meeting/, async () => {
    await blocker(c, MT, TREVIEW, "2026-10-21", RAID);
  });
  await expectFailure(c, "B03 a blocker RAG without its audit event fails at COMMIT", /blocker_status_audit_required/, async () => {
    await blocker(c, MT, TREVIEW, "2026-10-22", RAID, {}, false);
  });
  const BS = await inTx(c, () => blocker(c, MT, TREVIEW, "2026-10-22", RAID));
  await expectFailure(c, "B04 one RAG per blocker and meeting", /blocker_status_once_per_cycle/, async () => {
    await blocker(c, MT, TREVIEW, "2026-10-22", RAID, { rag: "amber" });
  });
  await expectFailure(c, "B05 blocker observations are append-only", /append-only/, async () => {
    await c.query(`UPDATE blocker_status SET rag = 'green' WHERE id = $1`, [BS]);
  });

  // --- Escalation rules.
  const rule = (o: Record<string, unknown>) => ({ id: uid(), organization_id: ORG, transformation_id: TR, created_by: U1, updated_by: U1, ...o });
  await expectFailure(c, "R01 a blocker rule needs cycles, deadline and owner party; no chain", /governance_escalation_rule_shape/, async () => {
    await insertRow(c, "governance_escalation_rule", rule({ rule_kind: "blocker_red", red_cycles: 2 }));
  });
  await expectFailure(c, "R02 'multiple cycles': fewer than 2 red cycles is refused", /governance_escalation_rule_red_cycles_check/, async () => {
    await insertRow(c, "governance_escalation_rule", rule({ rule_kind: "blocker_red", red_cycles: 1, deadline_working_days: 10, owner_party_code: "SP" }));
  });
  const RULE = await inTx(c, async () => {
    const r = rule({ rule_kind: "decision_sla", escalation_chain: ["SP"] });
    await insertRow(c, "governance_escalation_rule", r);
    await audit(c, "governance_escalation_rule", r.id as string, 1);
    return r.id as string;
  });
  await expectFailure(c, "R03 one rule per kind and transformation", /governance_escalation_rule_kind_key/, async () => {
    await insertRow(c, "governance_escalation_rule", rule({ rule_kind: "decision_sla", escalation_chain: ["SP"] }));
  });
  await expectFailure(c, "R04 the rule kind is immutable", /governance_escalation_rule_kind_immutable/, async () => {
    await setRow(c, "governance_escalation_rule", RULE, { rule_kind: "blocker_red" });
  });

  // --- The T16 read model.
  {
    const v = await c.query(`SELECT t16_id, decision, why_now, options, recommendation, owner_user_id, decision_date, impact_of_delay, outcome, status FROM executive_decision_log WHERE id = $1`, [DEC1]);
    const r = v.rows[0];
    report("V01 REQ-PB-081: the T16 view shows all nine columns of a decided ask (ID, Decision, Why now, Options, Rec., Owner, Decision date, Impact if delayed, Outcome)",
      r.t16_id.startsWith("DEC-") && r.decision && r.why_now && r.options === "A/B" && r.recommendation === "Option A" && r.owner_user_id === U2 && r.decision_date && r.impact_of_delay && r.outcome === "Option A chosen" && r.status === "decided",
      JSON.stringify(r));
  }

  // --- Privileges of the application role.
  const app = await client("probe_fresh", "mth_app");
  await expectFailure(app, "P01 mth_app cannot DELETE minutes (no DELETE grant)", /permission denied/, async () => {
    await app.query(`DELETE FROM meeting_minutes WHERE id = $1`, [MIN]);
  });
  await expectFailure(app, "P02 mth_app cannot UPDATE an escalation (INSERT, SELECT only)", /permission denied/, async () => {
    await app.query(`UPDATE decision_escalation SET level = 2 WHERE id = $1`, [E1]);
  });
  await expectFailure(app, "P03 mth_app cannot write the T16 view (SELECT only)", /permission denied|cannot (insert|update)/, async () => {
    await app.query(`UPDATE executive_decision_log SET decision = 'x' WHERE id = $1`, [DEC1]);
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
