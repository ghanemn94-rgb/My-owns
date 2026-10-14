// T-DG5-ARCH-03 migration and guard probe (solution-architect). Run against a DISPOSABLE cluster only:
//   QA_PG_PORT=<port in 23700-23749> MTH_PORT_POOL=23701-23749 tests/qa/support/with-pg.sh \
//     node --conditions=@mth/source docs/delivery/handbacks/DG5/T-DG5-ARCH-03-evidence/probe.ts
// 1. Fresh database: all migrations 0001..last.
// 2. P4-populated database: 0001..0061 with a synthetic transformation instantiated by the DG3 function and a DG4-style
//    work item + inbox notification, then 0062..last on top; the DG4 rows keep their behaviour ('normal', 'delivered').
// 3. Guard probes on the slice D and E tables (ADR-0043, ADR-0044). "PASS" means the guard fired (or, for an
//    expectSuccess probe, that the allowed write committed). API-path writes run as mth_app. Fixtures that need deep
//    DG2-DG4 setup (an approval, a G5 condition, a meeting, an agenda item, a dependency) are inserted by the
//    superuser with session_replication_role = replica (triggers and foreign keys off for that fixture only); the
//    probes themselves then run with every trigger on. The harness helpers are copied from the T-DG5-ARCH-02 probe.
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

const STARTER_TRANSFORMATION = "01920005-0075-7000-8000-000000000101";
const STARTER_V1 = "01920005-0075-7000-8000-000000000201";

async function rule(c: any, code: string, o: Record<string, unknown> = {}): Promise<string> {
  return ins(c, "automation_rule", {
    id: uid(), code, origin: "admin", name_en: "Synthetic rule", name_ar: "قاعدة تجريبية", scope_level: "transformation",
    organization_id: ORG, transformation_id: TR, owner_user_id: U1, enabled: false, disable_allowed: true, created_by: U1, updated_by: U1, ...o,
  });
}
async function version(c: any, ruleId: string, no: number, o: Record<string, unknown> = {}): Promise<string> {
  return ins(c, "automation_rule_version", {
    id: uid(), automation_rule_id: ruleId, version_no: no, trigger_codes: ["gate.decided"], conditions: "[]",
    actions: JSON.stringify([{ type: "create_task" }]), action_types: ["create_task"], run_as: "service",
    content_sha256: H(no), authored_by: U1, created_by: U1, updated_by: U1, ...o,
  });
}
async function dryRun(c: any, versionId: string, sha: string, outcome = "pass"): Promise<string> {
  return ins(c, "automation_dry_run", {
    id: uid(), automation_rule_version_id: versionId, content_sha256: sha, sample_event: "{}", outcome,
    findings: outcome === "pass" ? "[]" : JSON.stringify([{ code: "x" }]), run_by: U1,
  }, true, null);
}

async function main(): Promise<void> {
  const files = readdirSync(migrationsDir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  console.log(`migrations shipped: ${files.length} (${files[0]} .. ${files[files.length - 1]})`);
  const ids = files.map((f) => Number(f.slice(0, 4)));
  report("G00 slice D/E migrations 0074-0076 present; 0077-0079 left free", [74, 75, 76].every((n) => ids.includes(n)) && !ids.some((n) => n >= 77 && n <= 79), `ids >= 62: ${ids.filter((n) => n >= 62).join(",")}`);

  // ---- 1. fresh database
  await createDb("probe_fresh");
  const applied = await migrate(roleUrl("probe_fresh", "mth_owner"), { dir: migrationsDir });
  report("G01 fresh database: 0001..last apply", applied.length === files.length, `applied ${applied.length}: ${applied.slice(-4).join(", ")}`);

  // ---- 2. P4-populated database, then P5 on top
  await createDb("probe_p4");
  const p4Dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "p4-migrations-"));
  for (const f of files.filter((f) => Number(f.slice(0, 4)) <= LAST_P4)) cpSync(join(migrationsDir, f), join(p4Dir, f));
  const p4Applied = await migrate(roleUrl("probe_p4", "mth_owner"), { dir: p4Dir });
  const WI = uid();
  const NOTE = uid();
  {
    const c = await client("probe_p4");
    await seedP1(c);
    await c.query("BEGIN");
    await c.query(`SELECT p3_instantiate_transformation($1, $2, 'probe', 'cli')`, [TR, U1]);
    await ins(c, "work_item", { id: WI, organization_id: ORG, transformation_id: TR, kind: "approval_escalated", assignee_user_id: U2,
      subject_type: "approval", subject_id: uid(), link_path: "/approvals/x", message_key: "probe.message", dedupe_key: "probe:wi", created_source: "api", created_by: U1, updated_by: U1 });
    await ins(c, "inbox_notification", { id: NOTE, organization_id: ORG, transformation_id: TR, recipient_user_id: U2, work_item_id: WI,
      link_path: "/approvals/x", message_key: "probe.message", dedupe_key: "probe:wi", created_by: U1, updated_by: U1 });
    await c.query("COMMIT");
    report("G02 P4 database populated (0001-0061; a synthetic transformation, work item and notification)", p4Applied.length === LAST_P4, `applied ${p4Applied.length}`);
    await c.end();
  }
  const onTop = await migrate(roleUrl("probe_p4", "mth_owner"), { dir: migrationsDir });
  {
    const c = await client("probe_p4");
    report("G03 P5 over the P4 database: 0062..last apply", onTop.length === files.length - LAST_P4, `applied ${onTop.length}: ${onTop.slice(-4).join(", ")}`);
    const n = (await c.query(`SELECT urgency, delivery_state, deliver_after, digest_id, is_digest, version FROM inbox_notification WHERE id = $1`, [NOTE])).rows[0];
    report("G04 the DG4 notification keeps its behaviour: normal, delivered, no digest, version unchanged", n.urgency === "normal" && n.delivery_state === "delivered" && n.deliver_after === null && n.digest_id === null && n.is_digest === false && n.version === 1, JSON.stringify(n));
    const k = (await c.query(`SELECT count(*)::int AS n FROM work_item_kind WHERE urgency = 'normal'`)).rows[0].n;
    const all = (await c.query(`SELECT count(*)::int AS n FROM work_item_kind`)).rows[0].n;
    report("G05 every DG4 work-item kind except the three escalation kinds stays 'normal'", all - k === 4, `${all} kinds, ${all - k} urgent (approval_escalated, executive_decision_escalated, approval_overdue, gate_condition_overdue)`);
    await c.end();
  }

  // ---- 3. seeds (fresh database)
  const db = "probe_fresh";
  {
    const c = await client(db);
    const s = (await c.query(`SELECT count(*)::int AS rules, count(*) FILTER (WHERE enabled AND NOT disable_allowed AND scope_level = 'platform' AND owner_role_code = 'ADM_METHOD')::int AS guarded,
                                     count(DISTINCT source_ref)::int AS refs, min(source_ref) AS lo, max(source_ref) AS hi FROM automation_rule WHERE origin = 'starter'`)).rows[0];
    report("S01 sixteen starters M0224-M0239, each enabled, never disableable, platform scope, owned by ADM_METHOD", s.rules === 16 && s.guarded === 16 && s.refs === 16 && s.lo === "M0224" && s.hi === "M0239", JSON.stringify(s));
    const v = (await c.query(`SELECT count(*)::int AS n FROM automation_rule_version v JOIN automation_rule r ON r.id = v.automation_rule_id
                              WHERE r.origin = 'starter' AND v.version_no = 1 AND v.status = 'published' AND r.effective_version_id = v.id
                                AND v.conditions = '[]'::jsonb AND v.action_types = ARRAY['starter_handler'] AND v.run_as = 'service'`)).rows[0].n;
    report("S02 each starter has a published version 1 as its effective version, no conditions, one starter_handler action, service identity", v === 16, `${v}`);
    const h = (await c.query(`SELECT string_agg(code, ',' ORDER BY code) AS c FROM automation_action_type WHERE action_class = 'human_only'`)).rows[0].c;
    report("S03 six human-only action types catalogued, none admin-selectable", h === "approve_gate,approve_methodology_migration,attest_finance_value,decide_approval,decide_executive_ask,decide_investment", h);
    const sch = (await c.query(`SELECT count(*)::int AS n FROM job_schedule WHERE code IN ('automation.tick_hourly','automation.tick_daily','governance.meeting_cutoff_scan','gate.condition_escalation_scan','notification.digest')`)).rows[0].n;
    const aud = (await c.query(`SELECT count(*)::int AS n FROM audit_event WHERE action IN ('automation_rule.create','automation_rule_version.create') AND source = 'migration'`)).rows[0].n;
    report("S04 five new job schedules; 32 migration audit events for the starters and their versions", sch === 5 && aud === 32, `schedules ${sch}, audit ${aud}`);
    const perms = (await c.query(`SELECT count(*)::int AS n FROM permission WHERE code IN ('automation.read','automation.configure','automation.review','automation.repair','job.repair','notification_policy.configure','notification.preferences','gate_condition.close')`)).rows[0].n;
    const techApproval = (await c.query(`SELECT count(*)::int AS n FROM role_permission rp JOIN role r ON r.id = rp.role_id JOIN permission p ON p.code = rp.permission_code
                                         WHERE r.kind = 'technical_admin' AND p.category IN ('business_approval','finance_validation')`)).rows[0].n;
    const audW = (await c.query(`SELECT string_agg(rp.permission_code, ',') AS p FROM role_permission rp JOIN role r ON r.id = rp.role_id
                                 WHERE r.code = 'AUD' AND rp.permission_code IN (SELECT code FROM permission WHERE code LIKE 'automation.%' OR code LIKE 'notification%' OR code IN ('job.repair','gate_condition.close'))`)).rows[0].p;
    report("S05 eight permissions; no technical admin holds an approval right; AUD holds automation.read only of them", perms === 8 && techApproval === 0 && audW === "automation.read", `perms ${perms}, tech-approval ${techApproval}, AUD ${audW}`);
    const kinds = (await c.query(`SELECT count(*)::int AS n FROM work_item_kind WHERE code IN ('automation_task','automation_rule_review','role_assignment','dependency_slip','gate_condition_overdue','meeting_pack_review')`)).rows[0].n;
    report("S06 six new work-item kinds", kinds === 6, `${kinds}`);
    await seedP1(c);
    await c.end();
  }

  const app = await client(db, "mth_app");
  const own = await client(db, "mth_owner");

  // ---- automation_rule
  let R1 = "";
  await expectSuccess(app, "AR01 an admin rule with its audit event commits (mth_app)", async () => { R1 = await rule(app, "probe.rule_one"); return R1; });
  await expectFailure(app, "AR02 a rule without its audit event fails at COMMIT", /automation_rule_audit_required/, async () => { await ins(app, "automation_rule", { id: uid(), code: "probe.no_audit", origin: "admin", name_en: "Synthetic rule", name_ar: "قاعدة تجريبية", scope_level: "transformation", organization_id: ORG, transformation_id: TR, owner_user_id: U1, enabled: false, disable_allowed: true }, false); });
  await expectFailure(app, "AR03 a non-stepping version update fails", /automation_rule_version_step/, async () => updx(app, "automation_rule", R1, { name_en: "x" }, { step: 2 }));
  await expectFailure(app, "AR04 mth_app cannot create a starter", /automation_rule_starter_seed/, async () => { await rule(app, "probe.fake_starter", { origin: "starter", source_ref: "M0224", scope_level: "platform", organization_id: null, transformation_id: null, owner_user_id: null, owner_role_code: "ADM_METHOD", disable_allowed: false, enabled: false }); });
  await expectFailure(app, "AR05 a guarantee starter cannot be disabled (D-142 Q3)", /automation_rule_guarantee_kept/, async () => updx(app, "automation_rule", STARTER_TRANSFORMATION, { enabled: false, disabled_reason: "probe" }));
  await expectFailure(app, "AR06 an admin rule cannot have platform scope", /automation_rule_origin_shape|automation_rule_scope_complete/, async () => { await rule(app, "probe.platform", { scope_level: "platform", organization_id: null, transformation_id: null }); });
  await expectFailure(app, "AR07 a rule's code never changes", /automation_rule_identity_fixed/, async () => updx(app, "automation_rule", R1, { code: "probe.renamed" }));
  await expectFailure(app, "AR08 a rule without an effective version cannot be enabled", /automation_rule_enabled_needs_version/, async () => updx(app, "automation_rule", R1, { enabled: true }));
  await expectFailure(app, "AR09 an organization/transformation mismatch is refused", /organization_matches/, async () => { await rule(app, "probe.mismatch", { organization_id: ORG2 }); });
  await expectFailure(app, "AR10 the auditor role never owns a rule", /automation_rule_owner_not_auditor/, async () => updx(app, "automation_rule", STARTER_TRANSFORMATION, { owner_role_code: "AUD" }));

  // ---- automation_rule_version
  await expectFailure(app, "AV01 a human-only action (approve_gate) is refused (REQ-S12-026)", /automation_rule_version_human_only/, async () => { await version(app, R1, 1, { actions: JSON.stringify([{ type: "approve_gate" }]), action_types: ["approve_gate"] }); });
  await expectFailure(app, "AV02 an admin rule cannot use the starter handler", /automation_rule_version_admin_catalogue/, async () => { await version(app, R1, 1, { actions: JSON.stringify([{ type: "starter_handler" }]), action_types: ["starter_handler"] }); });
  await expectFailure(app, "AV03 run_as initiating_user on a trigger without an initiating user is refused", /automation_rule_version_initiating_user/, async () => { await version(app, R1, 1, { run_as: "initiating_user" }); });
  await expectFailure(app, "AV04 a service identity never holds approval.decide", /automation_rule_version_service_permission/, async () => { await version(app, R1, 1, { service_permission_codes: ["approval.decide"] }); });
  await expectFailure(app, "AV05 an unknown trigger is refused", /automation_rule_version_trigger_known/, async () => { await version(app, R1, 1, { trigger_codes: ["nope.never"] }); });
  await expectFailure(app, "AV06 version numbers do not skip", /automation_rule_version_next_number/, async () => { await version(app, R1, 2); });
  await expectFailure(app, "AV07 actions and action_types have the same length", /automation_rule_version_actions_match/, async () => { await version(app, R1, 1, { action_types: ["create_task", "notify"] }); });
  await expectFailure(app, "AV08 a new version starts as a draft", /automation_rule_version_transition/, async () => { await version(app, R1, 1, { status: "published", published_at: new Date(), published_by: U1 }); });
  let V1 = "";
  await expectSuccess(app, "AV09 a draft version with an allowed trigger and action commits", async () => { V1 = await version(app, R1, 1); return V1; });
  await expectFailure(app, "AV10 draft -> in_review without a pass dry run for the current content is refused", /automation_rule_version_dry_run_required/, async () => updx(app, "automation_rule_version", V1, { status: "in_review", submitted_at: new Date() }));
  await expectFailure(app, "DR01 a dry run of stale content is refused", /automation_dry_run_current_draft/, async () => { await dryRun(app, V1, H(999)); });
  await expectFailure(app, "DR02 a failing dry run names a finding", /automation_dry_run_fail_has_finding/, async () => { await ins(app, "automation_dry_run", { id: uid(), automation_rule_version_id: V1, content_sha256: H(1), sample_event: "{}", outcome: "fail", run_by: U1 }, true, null); });
  let D1 = "";
  await expectSuccess(app, "DR03 a pass dry run of the current content commits", async () => { D1 = await dryRun(app, V1, H(1)); return D1; });
  await expectFailure(app, "DR04 a dry run is append-only (UPDATE, as the owner: the trigger, not only the missing grant)", /append-only/, async () => { await own.query(`UPDATE automation_dry_run SET outcome = 'fail' WHERE id = $1`, [D1]); });
  await expectFailure(app, "AV11 draft -> published straight is refused while the policy requires review", /automation_rule_version_review_required/, async () => updx(app, "automation_rule_version", V1, { status: "published", published_at: new Date(), published_by: U1 }));
  await expectSuccess(app, "AV12 draft -> in_review with the pass dry run commits", async () => { await updx(app, "automation_rule_version", V1, { status: "in_review", submitted_at: new Date() }); return "in_review"; });
  await expectFailure(app, "AV13 the author cannot review their own version", /automation_rule_version_review_sod/, async () => updx(app, "automation_rule_version", V1, { status: "approved", reviewed_by: U1, reviewed_at: new Date() }));
  await expectFailure(app, "AV14 content is frozen outside a draft", /automation_rule_version_content_frozen/, async () => updx(app, "automation_rule_version", V1, { conditions: JSON.stringify([{ field: "gateCode", op: "eq", value: "G2" }]) }));
  await expectSuccess(app, "AV15 another person approves; publish; the rule names it and is enabled", async () => {
    await updx(app, "automation_rule_version", V1, { status: "approved", reviewed_by: U2, reviewed_at: new Date() });
    await updx(app, "automation_rule_version", V1, { status: "published", published_at: new Date(), published_by: U1 });
    await updx(app, "automation_rule", R1, { effective_version_id: V1, enabled: true });
    return "published + enabled";
  });
  await expectFailure(app, "AV16 a published version's content never changes", /automation_rule_version_content_frozen/, async () => updx(app, "automation_rule_version", V1, { parameters: JSON.stringify({ a: 1 }) }));
  let V2 = "";
  await expectSuccess(app, "AV17 v2: draft, dry run, review, publish, supersede v1, move the effective version (one transaction)", async () => {
    V2 = await version(app, R1, 2, { content_sha256: H(2) });
    await dryRun(app, V2, H(2));
    await updx(app, "automation_rule_version", V2, { status: "in_review", submitted_at: new Date() });
    await updx(app, "automation_rule_version", V2, { status: "approved", reviewed_by: U2, reviewed_at: new Date() });
    await updx(app, "automation_rule_version", V2, { status: "published", published_at: new Date(), published_by: U1 });
    await updx(app, "automation_rule", R1, { effective_version_id: V2 });
    await updx(app, "automation_rule_version", V1, { status: "superseded", superseded_at: new Date() });
    return V2;
  });
  await expectFailure(app, "AV18 two published versions of one rule fail at COMMIT", /automation_rule_version_one_published/, async () => {
    const v3 = await version(app, R1, 3, { content_sha256: H(3) });
    await dryRun(app, v3, H(3));
    await updx(app, "automation_rule_version", v3, { status: "in_review", submitted_at: new Date() });
    await updx(app, "automation_rule_version", v3, { status: "approved", reviewed_by: U2, reviewed_at: new Date() });
    await updx(app, "automation_rule_version", v3, { status: "published", published_at: new Date(), published_by: U1 });
  });
  await expectFailure(app, "AV19 a superseded version never returns to published", /automation_rule_version_transition/, async () => updx(app, "automation_rule_version", V1, { status: "published", superseded_at: null }));
  await expectFailure(app, "AV20 the effective version must be the published one (checked at COMMIT)", /automation_rule_effective_published/, async () => updx(app, "automation_rule", R1, { effective_version_id: V1 }));
  await expectFailure(app, "AV21 a starter version takes no conditions (D-142 Q3)", /automation_rule_version_starter_fixed/, async () => { await version(app, STARTER_TRANSFORMATION, 2, { trigger_codes: ["transformation.created"], conditions: JSON.stringify([{ field: "mode", op: "eq", value: "x" }]), actions: JSON.stringify([{ type: "starter_handler" }]), action_types: ["starter_handler"] }); });
  await expectFailure(app, "AV22 a starter keeps its trigger", /automation_rule_version_starter_fixed/, async () => { await version(app, STARTER_TRANSFORMATION, 2, { trigger_codes: ["gate.decided"], actions: JSON.stringify([{ type: "starter_handler" }]), action_types: ["starter_handler"] }); });
  await expectSuccess(app, "AV23 a starter v2 draft that changes only parameters commits", async () => version(app, STARTER_TRANSFORMATION, 2, { trigger_codes: ["transformation.created"], actions: JSON.stringify([{ type: "starter_handler", handlers: ["transformation.created"] }]), action_types: ["starter_handler"], parameters: JSON.stringify({ roleTaskDueWorkingDays: 3 }) }));
  await expectFailure(app, "AV24 the version row without its audit event fails at COMMIT", /automation_rule_version_audit_required/, async () => { await app.query(`UPDATE automation_rule_version SET change_summary = 'probe change', version = version + 1 WHERE id = $1`, [V2]); });

  // ---- automation_execution and action results
  await expectFailure(app, "EX01 an execution of a draft version is refused", /automation_execution_published_version/, async () => { await ins(app, "automation_execution", { id: uid(), automation_rule_id: STARTER_TRANSFORMATION, automation_rule_version_id: (await app.query(`SELECT id FROM automation_rule_version WHERE automation_rule_id = $1 AND version_no = 2`, [STARTER_TRANSFORMATION])).rows[0].id, trigger_code: "transformation.created", trigger_key: "k0", run_as: "service" }); });
  await expectFailure(app, "EX02 an execution on a trigger the version does not name is refused", /automation_execution_published_version/, async () => { await ins(app, "automation_execution", { id: uid(), automation_rule_id: STARTER_TRANSFORMATION, automation_rule_version_id: STARTER_V1, trigger_code: "gate.decided", trigger_key: "k0", run_as: "service" }); });
  const EX = uid();
  await expectSuccess(app, "EX03 a running execution of the published starter version commits", async () => ins(app, "automation_execution", { id: EX, automation_rule_id: STARTER_TRANSFORMATION, automation_rule_version_id: STARTER_V1, trigger_code: "transformation.created", trigger_key: "evt-1", organization_id: ORG, transformation_id: TR, run_as: "service" }));
  await expectFailure(app, "EX04 the same (version, trigger key) twice is refused (exactly once, REQ-S12-021)", /automation_execution_once_key/, async () => { await ins(app, "automation_execution", { id: uid(), automation_rule_id: STARTER_TRANSFORMATION, automation_rule_version_id: STARTER_V1, trigger_code: "transformation.created", trigger_key: "evt-1", run_as: "service" }); });
  const AX = uid();
  await expectSuccess(app, "AX01 a 'done' action result for the running attempt commits", async () => ins(app, "automation_action_result", { id: AX, automation_execution_id: EX, attempt_no: 1, ordinal: 1, action_type: "starter_handler", idempotency_key: "starter.transformation_created:evt-1:1", outcome: "done" }, true, null));
  await expectFailure(app, "AX02 a second 'done' for the same idempotency key is refused (REQ-S12-021)", /automation_action_result_effect_once_key/, async () => { await ins(app, "automation_action_result", { id: uid(), automation_execution_id: EX, attempt_no: 1, ordinal: 2, action_type: "starter_handler", idempotency_key: "starter.transformation_created:evt-1:1", outcome: "done" }, true, null); });
  await expectFailure(app, "AX03 action results are append-only", /append-only/, async () => { await own.query(`UPDATE automation_action_result SET outcome = 'failed' WHERE id = $1`, [AX]); });
  await expectFailure(app, "AX04 a failed result names its error", /automation_action_result_error_complete/, async () => { await ins(app, "automation_action_result", { id: uid(), automation_execution_id: EX, attempt_no: 1, ordinal: 3, action_type: "notify", idempotency_key: "k:3", outcome: "forbidden" }, true, null); });
  await expectFailure(app, "AX05 a human-only action never has a result", /automation_action_result_human_only/, async () => { await ins(app, "automation_action_result", { id: uid(), automation_execution_id: EX, attempt_no: 1, ordinal: 4, action_type: "approve_gate", idempotency_key: "k:4", outcome: "done" }, true, null); });
  await expectFailure(app, "EX05 a failed execution names its error", /automation_execution_failed_complete/, async () => updx(app, "automation_execution", EX, { status: "failed", finished_at: new Date() }));
  await expectSuccess(app, "EX06 running -> failed with an error code commits", async () => { await updx(app, "automation_execution", EX, { status: "failed", finished_at: new Date(), error_code: "automation.action_forbidden" }); return "failed"; });
  await expectFailure(app, "AX06 no result is recorded for a finished attempt", /automation_action_result_running_attempt/, async () => { await ins(app, "automation_action_result", { id: uid(), automation_execution_id: EX, attempt_no: 1, ordinal: 5, action_type: "notify", idempotency_key: "k:5", outcome: "done" }, true, null); });
  await expectFailure(app, "EX07 a retry steps the attempt by exactly 1", /automation_execution_transition/, async () => updx(app, "automation_execution", EX, { status: "running", finished_at: null, error_code: null, attempt_no: 3 }));
  await expectSuccess(app, "EX08 failed -> running at attempt 2 commits (retry from the queue)", async () => { await updx(app, "automation_execution", EX, { status: "running", finished_at: null, error_code: null, attempt_no: 2 }); return "running #2"; });
  await expectFailure(app, "EX09 the trigger key and scope never change", /automation_execution_identity_fixed/, async () => updx(app, "automation_execution", EX, { trigger_key: "evt-2" }));
  await expectFailure(app, "EX10 a skipped execution recorded conditions_met = false", /automation_execution_skipped_complete/, async () => updx(app, "automation_execution", EX, { status: "skipped", finished_at: new Date() }));

  // ---- job_run and operational_failure
  const JR = uid();
  await expectSuccess(app, "JR01 a job run is recorded without an audit event (operational log)", async () => ins(app, "job_run", { id: JR, job_schedule_code: "kpi.reporting_period_open", job_id: "job-1", attempt_no: 1, outcome: "succeeded", started_at: new Date(Date.now() - 1000), finished_at: new Date() }, false));
  await expectFailure(app, "JR02 job runs are append-only", /append-only/, async () => { await own.query(`UPDATE job_run SET outcome = 'failed' WHERE id = $1`, [JR]); });
  await expectFailure(app, "JR03 one row per (job id, attempt)", /job_run_job_attempt_key/, async () => { await ins(app, "job_run", { id: uid(), job_schedule_code: "kpi.reporting_period_open", job_id: "job-1", attempt_no: 1, outcome: "succeeded", started_at: new Date(), finished_at: new Date() }, false); });
  await expectFailure(app, "JR04 a failed run names its error", /job_run_error_complete/, async () => { await ins(app, "job_run", { id: uid(), job_schedule_code: "kpi.reporting_period_open", job_id: "job-2", attempt_no: 1, outcome: "failed", started_at: new Date(), finished_at: new Date() }, false); });
  const OF = uid();
  const failure = (id: string, key: string, o: Record<string, unknown> = {}) => ({ id, source: "job", queue_name: "kpi.recalculate", idempotency_key: key, job_data: JSON.stringify({ k: key }), error_code: "Error", error_message: "synthetic failure", attempts: 6, first_failed_at: new Date(), last_failed_at: new Date(), ...o });
  await expectSuccess(app, "OF01 a job failure enters the queue open", async () => ins(app, "operational_failure", failure(OF, "evt-9")));
  await expectFailure(app, "OF02 a second open failure for the same (source, queue, key) is refused", /operational_failure_one_open_key/, async () => { await ins(app, "operational_failure", failure(uid(), "evt-9")); });
  await expectFailure(app, "OF03 open -> resolved directly is refused", /operational_failure_transition/, async () => updx(app, "operational_failure", OF, { status: "resolved", resolved_at: new Date() }));
  await expectFailure(app, "OF04 a retry counts exactly once", /operational_failure_retry_count/, async () => updx(app, "operational_failure", OF, { status: "retrying", retry_count: 2, last_retry_at: new Date(), last_retry_by: U1 }));
  await expectSuccess(app, "OF05 open -> retrying -> open (failed again) commits", async () => {
    await updx(app, "operational_failure", OF, { status: "retrying", retry_count: 1, last_retry_at: new Date(), last_retry_by: U1 });
    await updx(app, "operational_failure", OF, { status: "open" });
    return "open, 1 retry";
  });
  await expectFailure(app, "OF06 the failed work and its key never change", /operational_failure_identity_fixed/, async () => updx(app, "operational_failure", OF, { idempotency_key: "evt-10" }));
  await expectFailure(app, "OF07 a dismissal names who, when and why", /operational_failure_dismissed_complete/, async () => updx(app, "operational_failure", OF, { status: "dismissed", dismissed_at: new Date(), dismissed_by: U1 }));
  await expectFailure(app, "OF08 a rule-execution failure names its execution and organization", /operational_failure_source_shape/, async () => { await ins(app, "operational_failure", failure(uid(), "evt-11", { source: "rule_execution" })); });
  await expectFailure(app, "OF09 a failure row without its audit event fails at COMMIT", /operational_failure_audit_required/, async () => { await app.query(`UPDATE operational_failure SET error_message = 'x', version = version + 1 WHERE id = $1`, [OF]); });

  // ---- approval_route_step (fixture approval via replica)
  const AP = uid();
  await fixture(db, "approval", { id: AP, organization_id: ORG, transformation_id: TR, approval_type: "governance_matrix_change", subject_type: "governance_matrix", subject_id: uid(), subject_version: 1, title: "Synthetic approval", requested_by: U1, request_business_date: "2026-10-14", assignee_party_code: "SP", assignee_user_id: U2, due_unknown_reason: "no_sla", sod_policy: "requester_excluded", created_by: U1 });
  const step = (n: number, o: Record<string, unknown> = {}) => ({ id: uid(), organization_id: ORG, transformation_id: TR, approval_id: AP, round_no: 1, route_key: "approval.governance_matrix_change", route_mode: "sequential", step_no: n, approver_role_code: n === 1 ? "SP" : "BO", status: n === 1 ? "active" : "waiting", activated_at: n === 1 ? new Date() : null, created_by: U1, updated_by: U1, ...o });
  await expectFailure(app, "RS01 a technical administrator is never a route approver", /approval_route_step_business_role/, async () => { await ins(app, "approval_route_step", step(1, { approver_role_code: "ADM_TECH" })); });
  await expectFailure(app, "RS02 sequential step 2 cannot start active", /approval_route_step_transition/, async () => { await ins(app, "approval_route_step", step(2, { status: "active", activated_at: new Date() })); });
  const S1 = step(1);
  const S2 = step(2);
  await expectSuccess(app, "RS03 a sequential route: step 1 active, step 2 waiting", async () => { await ins(app, "approval_route_step", S1); await ins(app, "approval_route_step", S2); return "2 steps"; });
  await expectFailure(app, "RS04 all steps share one route and mode", /approval_route_step_one_route/, async () => { await ins(app, "approval_route_step", step(3, { route_mode: "parallel", status: "active", activated_at: new Date() })); });
  await expectFailure(app, "RS05 step 2 is not activated before step 1 is approved (REQ-S10-015)", /approval_route_step_sequence/, async () => updx(app, "approval_route_step", S2.id, { status: "active", activated_at: new Date() }));
  await expectFailure(app, "RS06 the requester cannot decide a step", /approval_route_step_sod/, async () => updx(app, "approval_route_step", S1.id, { status: "approved", decided_by: U1, decided_at: new Date() }));
  await expectSuccess(app, "RS07 step 1 approved by U2, then step 2 activates", async () => {
    await updx(app, "approval_route_step", S1.id, { status: "approved", decided_by: U2, decided_at: new Date() });
    await updx(app, "approval_route_step", S2.id, { status: "active", activated_at: new Date() });
    return "step 2 active";
  });
  await expectFailure(app, "RS08 one person decides at most one step of an approval", /approval_route_step_distinct_deciders/, async () => updx(app, "approval_route_step", S2.id, { status: "approved", decided_by: U2, decided_at: new Date() }));
  await expectFailure(app, "RS09 a decided step never changes status again", /approval_route_step_transition/, async () => updx(app, "approval_route_step", S1.id, { status: "rejected" }));
  await expectFailure(app, "RS11 steps are created for the approval's current round only", /approval_route_step_current_round/, async () => { await ins(app, "approval_route_step", step(1, { round_no: 2 })); });
  await expectFailure(app, "RS10 the step's role never changes", /approval_route_step_identity_fixed/, async () => updx(app, "approval_route_step", S2.id, { approver_role_code: "FIN" }));

  // ---- gate conditions (fixture condition via replica)
  const C1 = uid();
  const C2 = uid();
  for (const id of [C1, C2])
    await fixture(db, "gate_decision_condition", { id, organization_id: ORG, transformation_id: TR, gate_decision_id: uid(), ordinal: id === C1 ? 1 : 2, condition_text: "Synthetic condition", owner_user_id: U3, due_date: "2026-10-01", created_by: U2 });
  await expectFailure(app, "GC01 only the condition owner closes it", /gate_condition_closure_owner/, async () => { await ins(app, "gate_condition_closure", { id: uid(), organization_id: ORG, transformation_id: TR, gate_decision_condition_id: C1, closure_note: "Done synthetic", closed_by: U2 }, true, null); });
  const GC = uid();
  await expectSuccess(app, "GC02 the owner closes the condition", async () => ins(app, "gate_condition_closure", { id: GC, organization_id: ORG, transformation_id: TR, gate_decision_condition_id: C1, closure_note: "Done synthetic", closed_by: U3 }, true, null));
  await expectFailure(app, "GC03 a condition closes once", /gate_condition_closure_once_key/, async () => { await ins(app, "gate_condition_closure", { id: uid(), organization_id: ORG, transformation_id: TR, gate_decision_condition_id: C1, closure_note: "Again synthetic", closed_by: U3 }, true, null); });
  await expectFailure(app, "GC04 a closure is append-only", /append-only/, async () => { await own.query(`UPDATE gate_condition_closure SET closure_note = 'changed' WHERE id = $1`, [GC]); });
  await expectFailure(app, "GC05 a closed condition is not escalated", /gate_condition_escalation_open/, async () => { await ins(app, "gate_condition_escalation", { id: uid(), organization_id: ORG, transformation_id: TR, gate_decision_condition_id: C1, overdue_since: "2026-10-02", escalated_to_user_id: U2 }, true, null); });
  await expectFailure(app, "GC06 overdue_since is the day after the due date", /gate_condition_escalation_overdue/, async () => { await ins(app, "gate_condition_escalation", { id: uid(), organization_id: ORG, transformation_id: TR, gate_decision_condition_id: C2, overdue_since: "2026-10-05", escalated_to_user_id: U2 }, true, null); });
  await expectSuccess(app, "GC07 an open overdue condition escalates once", async () => ins(app, "gate_condition_escalation", { id: uid(), organization_id: ORG, transformation_id: TR, gate_decision_condition_id: C2, overdue_since: "2026-10-02", escalated_to_user_id: U2 }, true, null));
  await expectFailure(app, "GC08 a second escalation is refused (exactly once)", /gate_condition_escalation_once_key/, async () => { await ins(app, "gate_condition_escalation", { id: uid(), organization_id: ORG, transformation_id: TR, gate_decision_condition_id: C2, overdue_since: "2026-10-02", escalated_to_user_id: U2 }, true, null); });
  await expectFailure(app, "GC09 a closure without its audit event fails at COMMIT", /gate_condition_closure_audit_required/, async () => { await app.query(`INSERT INTO gate_condition_closure (id, organization_id, transformation_id, gate_decision_condition_id, closure_note, closed_by) VALUES ($1, $2, $3, $4, 'Closed synthetic', $5)`, [uid(), ORG, TR, C2, U3]); });

  // ---- notifications
  const WK = uid();
  await own.query("BEGIN");
  await ins(own, "work_item", { id: WK, organization_id: ORG, transformation_id: TR, kind: "dependency_slip", assignee_user_id: U2, subject_type: "dependency", subject_id: uid(), link_path: "/x", message_key: "probe.message", dedupe_key: "probe:wk", created_source: "worker" });
  await own.query("COMMIT");
  const note = (o: Record<string, unknown> = {}) => ({ id: uid(), organization_id: ORG, transformation_id: TR, recipient_user_id: U2, link_path: "/x", message_key: "probe.message", dedupe_key: `probe:${seq}`, ...o });
  await expectFailure(app, "NP01 an urgent notification is never held (REQ-S12-025)", /inbox_notification_urgent_immediate/, async () => { await ins(app, "inbox_notification", note({ urgency: "urgent", delivery_state: "held", deliver_after: new Date() })); });
  await expectFailure(app, "NP02 a held notification names when it may be delivered", /inbox_notification_held_complete/, async () => { await ins(app, "inbox_notification", note({ delivery_state: "held" })); });
  const N1 = note({ delivery_state: "held", deliver_after: new Date() });
  const N0 = note();
  await expectSuccess(app, "NP03 a held non-urgent and a delivered notification commit", async () => { await ins(app, "inbox_notification", N1); await ins(app, "inbox_notification", N0); return "2 rows"; });
  await expectFailure(app, "NP04 delivered -> held is refused", /inbox_notification_delivery_transition/, async () => updx(app, "inbox_notification", N0.id, { delivery_state: "held", deliver_after: new Date() }));
  await expectFailure(app, "NP05 urgency never changes", /inbox_notification_delivery_fixed/, async () => updx(app, "inbox_notification", N0.id, { urgency: "urgent" }));
  const DG = uid();
  const DGN = note({ is_digest: true });
  await expectSuccess(app, "NP06 one digest per user and window takes the held notification (held -> digested)", async () => {
    await ins(app, "inbox_notification", DGN);
    await ins(app, "notification_digest", { id: DG, organization_id: ORG, recipient_user_id: U2, window_start: "2026-10-14T05:00:00Z", window_end: "2026-10-14T05:15:00Z", notification_count: 1, inbox_notification_id: DGN.id }, true, null);
    await updx(app, "inbox_notification", N1.id, { delivery_state: "digested", digest_id: DG });
    return DG;
  });
  await expectFailure(app, "NP07 a second digest for the same user and window is refused (lock 730261 backstop)", /notification_digest_window_key/, async () => { await ins(app, "notification_digest", { id: uid(), organization_id: ORG, recipient_user_id: U2, window_start: "2026-10-14T05:00:00Z", window_end: "2026-10-14T05:15:00Z", notification_count: 1, inbox_notification_id: DGN.id }, true, null); });
  await expectFailure(app, "NP08 digests are append-only", /append-only/, async () => { await own.query(`UPDATE notification_digest SET notification_count = 2 WHERE id = $1`, [DG]); });
  await expectFailure(app, "NP09 quiet hours need a start and a different end", /notification_preference_quiet_complete/, async () => { await ins(app, "notification_preference", { id: uid(), organization_id: ORG, user_id: U2, quiet_hours_start: "22:00", quiet_hours_end: "22:00" }); });
  await expectFailure(app, "NP10 a preference belongs to the user's organization", /notification_preference_organization_matches/, async () => { await ins(app, "notification_preference", { id: uid(), organization_id: ORG2, user_id: U2 }); });
  await expectFailure(app, "NP11 an unknown time zone is refused", /timezone/i, async () => { await ins(app, "notification_preference", { id: uid(), organization_id: ORG, user_id: U2, timezone: "Mars/Olympus" }); });
  const NPF = uid();
  await expectSuccess(app, "NP12 quiet hours 22:00-07:00 with a daily digest commit", async () => ins(app, "notification_preference", { id: NPF, organization_id: ORG, user_id: U2, quiet_hours_start: "22:00", quiet_hours_end: "07:00", digest_mode: "daily", digest_time: "08:00" }));
  await expectFailure(app, "NP13 a preference without its audit event fails at COMMIT", /notification_preference_audit_required/, async () => { await app.query(`UPDATE notification_preference SET digest_mode = 'off', version = version + 1 WHERE id = $1`, [NPF]); });
  await expectFailure(app, "NP14 one policy per organization", /notification_policy_organization_key/, async () => { await ins(app, "notification_policy", { id: uid(), organization_id: ORG }); await ins(app, "notification_policy", { id: uid(), organization_id: ORG }); });

  // ---- meeting cut-off pack (fixture forum, meeting and agenda item via replica)
  const FM = uid();
  const MT = uid();
  const AI = uid();
  await fixture(db, "meeting", { id: MT, organization_id: ORG, transformation_id: TR, forum_id: FM, scheduled_date: "2026-10-20", starts_at: "2026-10-20T07:00:00Z", ends_at: "2026-10-20T08:00:00Z", chair_user_id: U2, cutoff_date: "2026-10-15", created_source: "api", created_by: U1 });
  await fixture(db, "agenda_item", { id: AI, organization_id: ORG, transformation_id: TR, meeting_id: MT, ordinal: 1, item_kind: "information", title: "Synthetic item", created_by: U1, updated_by: U1 });
  const pack = (o: Record<string, unknown> = {}) => ({ id: uid(), organization_id: ORG, transformation_id: TR, meeting_id: MT, cutoff_date: "2026-10-15", as_of: new Date(), open_asks: "[]", agenda_item_ids: [AI], ...o });
  await expectFailure(app, "MP01 a pack is for the meeting's own cut-off date", /meeting_cutoff_pack_transition/, async () => { await ins(app, "meeting_cutoff_pack", pack({ cutoff_date: "2026-10-16" })); });
  const P1 = pack();
  await expectSuccess(app, "MP02 one draft pack for the meeting commits", async () => ins(app, "meeting_cutoff_pack", P1));
  await expectFailure(app, "MP03 one pack per meeting (exactly once)", /meeting_cutoff_pack_once_key/, async () => { await ins(app, "meeting_cutoff_pack", pack()); });
  await expectFailure(app, "MP04 an item of an unreviewed pack cannot be published (REQ-S12-015)", /agenda_item_cutoff_pack_unreviewed/, async () => { await own.query(`UPDATE agenda_item SET status = 'published', published_at = now(), published_by = $2, version = version + 1 WHERE id = $1`, [AI, U2]); });
  await expectFailure(app, "MP05 the generated content never changes", /meeting_cutoff_pack_content_fixed/, async () => updx(app, "meeting_cutoff_pack", P1.id, { open_asks: JSON.stringify([{ x: 1 }]) }));
  await expectFailure(app, "MP06 only the chair or secretary reviews the pack", /meeting_cutoff_pack_reviewer/, async () => updx(app, "meeting_cutoff_pack", P1.id, { status: "reviewed", reviewed_by: U3, reviewed_at: new Date() }));
  await expectSuccess(app, "MP07 the chair reviews the pack", async () => { await updx(app, "meeting_cutoff_pack", P1.id, { status: "reviewed", reviewed_by: U2, reviewed_at: new Date() }); return "reviewed"; });
  await expectFailure(app, "MP08 reviewed -> draft is refused", /meeting_cutoff_pack_transition/, async () => updx(app, "meeting_cutoff_pack", P1.id, { status: "draft", reviewed_by: null, reviewed_at: null }));

  // ---- dependency slip (fixture dependency via replica)
  const DEP = uid();
  await fixture(db, "dependency", { id: DEP, organization_id: ORG, transformation_id: TR, code: "DEP-01", description: "Synthetic dependency", from_kind: "initiative", to_kind: "initiative", dependency_type: "tech", created_by: U1, updated_by: U1 });
  const slip = (o: Record<string, unknown> = {}) => ({ id: uid(), organization_id: ORG, transformation_id: TR, dependency_id: DEP, slip_key: "ini:1", predecessor_finish_before: "2026-11-01", predecessor_finish_after: "2026-11-06", slip_days: 5, critical_reason: "critical_path", affected: "[]", ...o });
  await expectFailure(app, "DS01 slip_days equals the finish move in calendar days", /dependency_slip_days/, async () => { await ins(app, "dependency_slip", slip({ slip_days: 4 }), true, null); });
  await expectFailure(app, "DS02 'needed_by_breached' needs a breached needed-by date", /dependency_slip_needed_by/, async () => { await ins(app, "dependency_slip", slip({ critical_reason: "needed_by_breached", needed_by: "2026-11-10" }), true, null); });
  const SL = slip();
  await expectSuccess(app, "DS03 a 5-day slip commits", async () => ins(app, "dependency_slip", SL, true, null));
  await expectFailure(app, "DS04 one slip per (dependency, slip key) (exactly once)", /dependency_slip_once_key/, async () => { await ins(app, "dependency_slip", slip(), true, null); });
  await expectFailure(app, "DS05 slips are append-only", /append-only/, async () => { await own.query(`UPDATE dependency_slip SET slip_days = 6 WHERE id = $1`, [SL.id]); });

  for (const t of ["automation_dry_run", "automation_action_result", "job_run", "gate_condition_closure", "gate_condition_escalation", "notification_digest", "dependency_slip"]) {
    const g = (await own.query(`SELECT has_table_privilege('mth_app', $1, 'UPDATE') AS u, has_table_privilege('mth_app', $1, 'DELETE') AS d`, [t])).rows[0];
    report(`AO ${t}: mth_app has no UPDATE or DELETE grant`, !g.u && !g.d, JSON.stringify(g));
  }
  await app.end();
  await own.end();
  console.log(`\n${total - failures}/${total} PASS, ${failures} FAIL`);
  if (failures > 0) process.exitCode = 1;
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (e) => {
    console.error(e);
    process.exit(2);
  },
);
