// T-DG5-ARCH-04 migration and guard probe (solution-architect). Run against a DISPOSABLE cluster only:
//   QA_PG_PORT=<port in 23700-23749> MTH_PORT_POOL=23701-23749 tests/qa/support/with-pg.sh \
//     node --conditions=@mth/source docs/delivery/handbacks/DG5/T-DG5-ARCH-04-evidence/probe.ts
// 1. Fresh database: all migrations 0001..last.
// 2. P4-populated database: 0001..0061 with a synthetic transformation instantiated by the DG3 function and a DG4-style
//    work item + inbox notification, then 0062..last on top; the DG4 rows keep their behaviour ('normal', 'delivered').
// 3. Guard probes on the slice F tables (ADR-0045, ADR-0046). "PASS" means the guard fired (or, for an
//    expectSuccess probe, that the allowed write committed). API-path writes run as mth_app. Fixtures that need deep
//    DG2-DG4 setup (an approval, a G5 condition, a meeting, an agenda item, a dependency) are inserted by the
//    superuser with session_replication_role = replica (triggers and foreign keys off for that fixture only); the
//    probes themselves then run with every trigger on. The harness helpers are copied from the T-DG5-ARCH-03 probe.
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

// ---- slice F fixtures and helpers (SYNTHETIC; approves nothing)
const MV1 = "01920002-0000-7000-8000-000000000001"; // the seeded methodology version 1 (0011)
const TR2 = "01990000-0000-7000-8000-000000000007"; // a second transformation of ORG
const P_OPEN = "01990000-0000-7000-8000-0000000000a1";
const P_CLOSED = "01990000-0000-7000-8000-0000000000a2";
const P_SCHED = "01990000-0000-7000-8000-0000000000a3";
const WS1 = "01990000-0000-7000-8000-0000000000b1";
const WS2 = "01990000-0000-7000-8000-0000000000b2"; // workstream of TR2
const EV = "01990000-0000-7000-8000-0000000000c1";
const EC = "01990000-0000-7000-8000-0000000000c2";
const MT = "01990000-0000-7000-8000-0000000000d1";

function snap(o: Record<string, unknown> = {}): Record<string, unknown> {
  const id = (o.id as string | undefined) ?? uid();
  return {
    id, organization_id: ORG, transformation_id: TR, definition_code: "charter", subject_type: "transformation", subject_id: TR,
    as_of: new Date(), content_schema_version: 1, content: JSON.stringify({ sections: [] }), content_sha256: H(1),
    methodology_version_id: MV1, approval_state: "approved", provisional_value_count: 0, unknown_value_count: 0, series_id: id,
    created_by: U1, updated_by: U1, ...o,
  };
}
function upd(o: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: uid(), organization_id: ORG, transformation_id: TR, subject_type: "workstream", subject_id: WS1, reporting_period_id: P_OPEN,
    owner_user_id: U1, achievements: "Synthetic achievement", created_by: U1, updated_by: U1, ...o };
}
function job(snapshotId: string, o: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: uid(), organization_id: ORG, transformation_id: TR, snapshot_id: snapshotId, requested_by: U1, format: "pdf", language: "ar",
    idempotency_key: `probe-key-${seq}`, created_by: U1, ...o };
}

async function main(): Promise<void> {
  const files = readdirSync(migrationsDir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  console.log(`migrations shipped: ${files.length} (${files[0]} .. ${files[files.length - 1]})`);
  const ids = files.map((f) => Number(f.slice(0, 4)));
  report("G00 slice F migrations 0080-0082 present; 0083-0084 left free", [80, 81, 82].every((n) => ids.includes(n)) && !ids.some((n) => n >= 83 && n <= 84), `ids >= 74: ${ids.filter((n) => n >= 74).join(",")}`);

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
    const ev = (await c.query(`SELECT count(*)::int AS n FROM transformation WHERE id = $1`, [TR])).rows[0].n;
    report("G02 P4 database populated (0001-0061; a synthetic transformation instantiated by the DG3 function)", p4Applied.length === LAST_P4 && ev === 1, `applied ${p4Applied.length}`);
    await c.end();
  }
  const onTop = await migrate(roleUrl("probe_p4", "mth_owner"), { dir: migrationsDir });
  {
    const c = await client("probe_p4");
    report("G03 P5 over the P4 database: 0062..last apply", onTop.length === files.length - LAST_P4, `applied ${onTop.length}: ${onTop.slice(-4).join(", ")}`);
    const t = (await c.query(`SELECT count(*)::int AS n FROM transformation WHERE id = $1 AND version = 1`, [TR])).rows[0].n;
    const e = (await c.query(`SELECT count(*)::int AS n FROM report_snapshot`)).rows[0].n;
    report("G04 the DG4 transformation is unchanged and no snapshot or export exists after the upgrade (additive)", t === 1 && e === 0, `transformation v1 rows ${t}, snapshots ${e}`);
    await c.end();
  }

  // ---- 3. seeds (fresh database)
  const db = "probe_fresh";
  {
    const c = await client(db);
    const d = (await c.query(`SELECT string_agg(code, ',' ORDER BY ordinal) AS c, count(*) FILTER (WHERE output_kind = 'generated_output')::int AS ten,
                                     count(*) FILTER (WHERE 'pdf' = ANY (formats))::int AS pdf FROM report_definition`)).rows[0];
    report("S01 twelve report definitions: the ten M0253 outputs, the executive pack and the meeting pack", d.c === "charter,diagnostic,tom,business_cases,roadmap,registers,meeting_minutes,gate_pack,executive_dashboard,handover,executive_pack,meeting_pack" && d.ten === 10, JSON.stringify(d));
    const f = (await c.query(`SELECT array_agg(DISTINCT x ORDER BY x) AS f FROM report_definition, unnest(formats) x`)).rows[0].f;
    report("S02 the five formats PDF, DOCX, XLSX, PPTX and CSV are each offered by at least one output", JSON.stringify(f) === JSON.stringify(["csv", "docx", "pdf", "pptx", "xlsx"]), JSON.stringify(f));
    const k = (await c.query(`SELECT count(*)::int AS n FROM work_item_kind WHERE code = 'owner_update_due' AND urgency = 'normal'`)).rows[0].n;
    const j = (await c.query(`SELECT count(*)::int AS n FROM job_schedule s JOIN audit_event a ON a.record_id = s.id AND a.action = 'job_schedule.create' WHERE s.code = 'reports.owner_update_tasks' AND s.timezone = 'Asia/Riyadh'`)).rows[0].n;
    report("S03 the owner_update_due work-item kind and the audited reports.owner_update_tasks schedule", k === 1 && j === 1, `kind ${k}, schedule ${j}`);
    const perms = (await c.query(`SELECT string_agg(code || ':' || category, ',' ORDER BY code) AS p FROM permission WHERE code IN ('report.generate','report.issue','export.create','owner_update.submit')`)).rows[0].p;
    const none = (await c.query(`SELECT count(*)::int AS n FROM role_permission rp JOIN role r ON r.id = rp.role_id
                                 WHERE rp.permission_code IN ('report.generate','report.issue','export.create','owner_update.submit') AND (r.code = 'AUD' OR r.kind = 'technical_admin')`)).rows[0].n;
    const issuers = (await c.query(`SELECT string_agg(r.code, ',' ORDER BY r.code) AS c FROM role_permission rp JOIN role r ON r.id = rp.role_id WHERE rp.permission_code = 'report.issue'`)).rows[0].c;
    report("S04 four write permissions, none an approval right; AUD and technical admins hold none; issue = SEC, TL, TO", perms === "export.create:write,owner_update.submit:write,report.generate:write,report.issue:write" && none === 0 && issuers === "SEC,TL,TO", `${perms}; aud/tech ${none}; issuers ${issuers}`);
    await seedP1(c);
    await c.query(
      `INSERT INTO transformation (id, organization_id, business_unit_id, code, name, mode, current_phase, timezone, currency, created_by, updated_by)
       VALUES ($1, $2, $3, 'SYN-T2', 'Synthetic transformation 2', 'end_to_end', 'diagnose', 'Asia/Riyadh', 'SAR', $4, $4)`,
      [TR2, ORG, BU, U1],
    );
    await c.end();
  }
  for (const [id, label, status, start, end] of [
    [P_OPEN, "2026-10", "open", "2026-10-01", "2026-10-31"],
    [P_CLOSED, "2026-09", "closed", "2026-09-01", "2026-09-30"],
    [P_SCHED, "2026-11", "scheduled", "2026-11-01", "2026-11-30"],
  ] as const) {
    await fixture(db, "reporting_period", { id, organization_id: ORG, frequency: "monthly", period_label: label, period_start: start, period_end: end, status,
      opened_at: status === "scheduled" ? null : new Date(), closed_at: status === "closed" ? new Date() : null });
  }
  await fixture(db, "workstream", { id: WS1, organization_id: ORG, transformation_id: TR, code: "WS-01", name: "Synthetic workstream", lead_user_id: U1, created_by: U1, updated_by: U1 });
  await fixture(db, "workstream", { id: WS2, organization_id: ORG, transformation_id: TR2, code: "WS-01", name: "Synthetic workstream of T2", created_by: U1, updated_by: U1 });
  await fixture(db, "evidence", { id: EV, organization_id: ORG, transformation_id: TR, kind: "file", title: "Synthetic evidence", owner_user_id: U1, current_content_id: EC, created_by: U1, updated_by: U1 });
  await fixture(db, "evidence_content", { id: EC, organization_id: ORG, transformation_id: TR, evidence_id: EV, revision: 1, storage_key: "evidence/probe/1", sha256: H(77), size_bytes: 10, content_type: "application/pdf", file_name: "probe.pdf", uploaded_by: U1 });

  const app = await client(db, "mth_app");
  const own = await client(db, "mth_owner");

  // ---- report_snapshot (ADR-0045 §3-§4)
  const S1 = snap();
  await expectSuccess(app, "RS01 a generated snapshot with its audit event commits (mth_app)", async () => ins(app, "report_snapshot", S1));
  await expectFailure(app, "RS02 a snapshot without its audit event fails at COMMIT", /report_snapshot_audit_required/, async () => { await ins(app, "report_snapshot", snap(), false); });
  await expectFailure(app, "RS03 a non-stepping version update fails", /report_snapshot_version_step/, async () => updx(app, "report_snapshot", S1.id as string, { issue_note: null }, { step: 2 }));
  await expectFailure(app, "RS04 a snapshot is created as generated", /report_snapshot_created_generated/, async () => { await ins(app, "report_snapshot", snap({ status: "issued", issue_version: 1, issued_at: new Date(), issued_by: U1 })); });
  await expectFailure(app, "RS05 the subject type must be the definition's (meeting_minutes reports on a meeting)", /report_snapshot_subject_type/, async () => { await ins(app, "report_snapshot", snap({ definition_code: "meeting_minutes" })); });
  await expectFailure(app, "RS06 a missing subject record is refused", /report_snapshot_subject_ref/, async () => { await ins(app, "report_snapshot", snap({ definition_code: "meeting_minutes", subject_type: "meeting", subject_id: uid() })); });
  await expectFailure(app, "RS07 the executive dashboard needs a reporting period", /report_snapshot_period_required/, async () => { await ins(app, "report_snapshot", snap({ definition_code: "executive_dashboard" })); });
  await expectFailure(app, "RS08 the period copy must equal the reporting period", /report_snapshot_period_matches/, async () => { await ins(app, "report_snapshot", snap({ definition_code: "executive_dashboard", reporting_period_id: P_OPEN, period_label: "2026-10", period_start: "2026-10-01", period_end: "2026-10-30" })); });
  await expectFailure(app, "RS09 a period id without its copies is refused", /report_snapshot_period_copy/, async () => { await ins(app, "report_snapshot", snap({ definition_code: "executive_dashboard", reporting_period_id: P_OPEN })); });
  await expectFailure(app, "RS10 a transformation subject is the snapshot's own transformation", /report_snapshot_subject_transformation/, async () => { await ins(app, "report_snapshot", snap({ subject_id: TR2 })); });
  await expectFailure(app, "RS11 the content never changes (REQ-S13-007)", /report_snapshot_content_immutable/, async () => updx(app, "report_snapshot", S1.id as string, { content: JSON.stringify({ sections: [1] }) }));
  await expectFailure(app, "RS12 the as-of time never changes", /report_snapshot_content_immutable/, async () => updx(app, "report_snapshot", S1.id as string, { as_of: new Date(0) }));
  await expectFailure(app, "RS13 the approval state never changes", /report_snapshot_content_immutable/, async () => updx(app, "report_snapshot", S1.id as string, { approval_state: "pending" }));
  await expectFailure(app, "RS14 the first issue of a series is issue version 1", /report_snapshot_issue_next/, async () => updx(app, "report_snapshot", S1.id as string, { status: "issued", issue_version: 2, issued_at: new Date(), issued_by: U1 }));
  await expectFailure(app, "RS15 issued without its stamps is refused", /report_snapshot_issue_complete/, async () => updx(app, "report_snapshot", S1.id as string, { status: "issued", issue_version: 1 }));
  await expectSuccess(app, "RS16 generated -> issued (issue version 1) commits", async () => { await updx(app, "report_snapshot", S1.id as string, { status: "issued", issue_version: 1, issued_at: new Date(), issued_by: U2 }); return "issued v1"; });
  await expectFailure(app, "RS17 issued -> generated is refused", /report_snapshot_transition|report_snapshot_issue_complete/, async () => updx(app, "report_snapshot", S1.id as string, { status: "generated", issue_version: null, issued_at: null, issued_by: null }));
  await expectFailure(app, "RS18 issue stamps change only with their transition", /report_snapshot_stamps_frozen/, async () => updx(app, "report_snapshot", S1.id as string, { issued_by: U3 }));
  await expectFailure(app, "RS19 issued -> superseded without a later issued snapshot fails at COMMIT", /report_snapshot_superseded_by_issued/, async () => updx(app, "report_snapshot", S1.id as string, { status: "superseded", superseded_at: new Date(), superseded_by_id: S1.id }));
  const G1 = snap();
  await expectSuccess(app, "RS20 a second generated snapshot commits (not a reissue)", async () => ins(app, "report_snapshot", G1));
  await expectFailure(app, "RS21 a reissue must continue the series of the current issued snapshot", /report_snapshot_reissue_of_issued/, async () => { await ins(app, "report_snapshot", snap({ series_id: G1.id, reissue_of_id: G1.id, reissue_reason: "Probe reissue of a generated one" })); });
  await expectFailure(app, "RS22 a reissue names its reason and its series", /report_snapshot_reissue_shape/, async () => { await ins(app, "report_snapshot", snap({ series_id: S1.id, reissue_of_id: S1.id })); });
  const R2 = snap({ series_id: S1.id, reissue_of_id: S1.id, reissue_reason: "Synthetic KPI restatement" });
  await expectSuccess(app, "RS23 a reissue of the issued snapshot is generated in the same series", async () => ins(app, "report_snapshot", R2));
  await expectFailure(app, "RS24 two issued snapshots in one series are refused", /report_snapshot_one_issued_key/, async () => updx(app, "report_snapshot", R2.id as string, { status: "issued", issue_version: 2, issued_at: new Date(), issued_by: U2 }));
  await expectSuccess(app, "RS25 the reissue supersedes v1 and is issued as v2 in one transaction", async () => {
    await updx(app, "report_snapshot", S1.id as string, { status: "superseded", superseded_at: new Date(), superseded_by_id: R2.id });
    await updx(app, "report_snapshot", R2.id as string, { status: "issued", issue_version: 2, issued_at: new Date(), issued_by: U2 });
    return "v1 superseded, v2 issued";
  });
  {
    const r = (await own.query(`SELECT content::text AS c, content_sha256, approval_state, status FROM report_snapshot WHERE id = $1`, [S1.id])).rows[0];
    report("RS26 the superseded v1 still holds its original content, hash and approval state", r.c === '{"sections": []}' && r.content_sha256 === H(1) && r.approval_state === "approved" && r.status === "superseded", JSON.stringify(r));
  }
  await expectFailure(app, "RS27 a superseded snapshot is terminal", /report_snapshot_transition/, async () => updx(app, "report_snapshot", S1.id as string, { status: "issued", superseded_at: null, superseded_by_id: null }));
  await expectFailure(app, "RS28 generated -> discarded needs a reason", /report_snapshot_discard_complete/, async () => updx(app, "report_snapshot", G1.id as string, { status: "discarded", discarded_at: new Date(), discarded_by: U1 }));
  await expectSuccess(app, "RS29 generated -> discarded with its reason commits", async () => { await updx(app, "report_snapshot", G1.id as string, { status: "discarded", discarded_at: new Date(), discarded_by: U1, discard_reason: "Synthetic: not needed" }); return "discarded"; });
  await expectFailure(app, "RS30 mth_app cannot DELETE a snapshot", /permission denied/, async () => { await app.query(`DELETE FROM report_snapshot WHERE id = $1`, [G1.id]); });

  // ---- children: creation-transaction only, append-only, evidence matches (ADR-0045 §3, §9)
  const S3 = snap();
  await expectSuccess(app, "RC01 a snapshot with its sources, versions and evidence in one transaction commits", async () => {
    await ins(app, "report_snapshot", S3);
    await ins(app, "report_snapshot_source", { id: uid(), organization_id: ORG, transformation_id: TR, snapshot_id: S3.id, section_key: "charter", record_type: "charter", record_id: uid(), record_version: 3, approval_state: "approved", validation_state: "validated" }, false);
    await ins(app, "report_snapshot_version", { id: uid(), organization_id: ORG, transformation_id: TR, snapshot_id: S3.id, version_kind: "methodology_version", reference_id: MV1, reference_key: "playbook", version_label: "v1" }, false);
    await ins(app, "report_snapshot_evidence", { id: uid(), organization_id: ORG, transformation_id: TR, snapshot_id: S3.id, section_key: "charter", evidence_id: EV, content_id: EC, content_revision: 1, content_sha256: H(77), review_status: "unverified" }, false);
    return "1 source, 1 version, 1 evidence";
  });
  await expectFailure(app, "RC02 a source added in a later transaction is refused", /report_snapshot_source_creation_only/, async () => { await ins(app, "report_snapshot_source", { id: uid(), organization_id: ORG, transformation_id: TR, snapshot_id: S3.id, section_key: "charter", record_type: "outcome", record_id: uid(), record_version: 1, validation_state: "provisional" }, false); });
  await expectFailure(app, "RC03 a version added in a later transaction is refused", /report_snapshot_version_creation_only/, async () => { await ins(app, "report_snapshot_version", { id: uid(), organization_id: ORG, transformation_id: TR, snapshot_id: S3.id, version_kind: "calculation_engine", reference_key: "calc", version_label: "1" }, false); });
  await expectFailure(app, "RC04 sources are append-only (UPDATE)", /append-only/, async () => { await own.query(`UPDATE report_snapshot_source SET record_version = 4 WHERE snapshot_id = $1`, [S3.id]); });
  await expectFailure(app, "RC05 versions are append-only (DELETE)", /append-only/, async () => { await own.query(`DELETE FROM report_snapshot_version WHERE snapshot_id = $1`, [S3.id]); });
  await expectFailure(app, "RC06 cited evidence must carry the checksum of the cited content", /report_snapshot_evidence_content_matches/, async () => {
    const s = snap(); await ins(app, "report_snapshot", s);
    await ins(app, "report_snapshot_evidence", { id: uid(), organization_id: ORG, transformation_id: TR, snapshot_id: s.id, section_key: "charter", evidence_id: EV, content_id: EC, content_revision: 1, content_sha256: H(78), review_status: "unverified" }, false);
  });
  await expectFailure(app, "RC07 an unknown validation state is refused", /report_snapshot_source_validation_state_check/, async () => {
    const s = snap(); await ins(app, "report_snapshot", s);
    await ins(app, "report_snapshot_source", { id: uid(), organization_id: ORG, transformation_id: TR, snapshot_id: s.id, section_key: "x", record_type: "outcome", record_id: uid(), record_version: 1, validation_state: "green" }, false);
  });
  await expectFailure(app, "RC08 a child of another transformation is refused", /report_snapshot_source_same_transformation|report_snapshot_source_snapshot_fkey/, async () => {
    const s = snap(); await ins(app, "report_snapshot", s);
    await ins(app, "report_snapshot_source", { id: uid(), organization_id: ORG, transformation_id: TR2, snapshot_id: s.id, section_key: "x", record_type: "outcome", record_id: uid(), record_version: 1, validation_state: "validated" }, false);
  });

  // ---- owner_update (ADR-0045 §6)
  const U = upd();
  await expectSuccess(app, "OU01 a draft update for an open period commits", async () => ins(app, "owner_update", U));
  await expectFailure(app, "OU02 an update without its audit event fails at COMMIT", /owner_update_audit_required/, async () => { await ins(app, "owner_update", upd({ subject_type: "transformation", subject_id: TR }), false); });
  await expectFailure(app, "OU03 a non-stepping version update fails", /owner_update_version_step/, async () => updx(app, "owner_update", U.id as string, { next_steps: "x" }, { step: 2 }));
  await expectFailure(app, "OU04 a closed period takes no update", /owner_update_period_open/, async () => { await ins(app, "owner_update", upd({ reporting_period_id: P_CLOSED })); });
  await expectFailure(app, "OU05 a scheduled period takes no update", /owner_update_period_open/, async () => { await ins(app, "owner_update", upd({ reporting_period_id: P_SCHED })); });
  await expectFailure(app, "OU06 one update per subject and period", /owner_update_subject_period_key/, async () => { await ins(app, "owner_update", upd()); });
  await expectFailure(app, "OU07 a workstream of another transformation is refused", /owner_update_subject_ref/, async () => { await ins(app, "owner_update", upd({ subject_id: WS2 })); });
  await expectFailure(app, "OU08 a submission without its revision row fails at COMMIT", /owner_update_revision_present/, async () => updx(app, "owner_update", U.id as string, { status: "submitted", revision_no: 1, submitted_at: new Date(), submitted_by: U1 }));
  await expectFailure(app, "OU09 a submission must be the next revision", /owner_update_revision_step/, async () => updx(app, "owner_update", U.id as string, { status: "submitted", revision_no: 2, submitted_at: new Date(), submitted_by: U1 }));
  await expectSuccess(app, "OU10 submit with its revision row commits", async () => {
    await updx(app, "owner_update", U.id as string, { status: "submitted", revision_no: 1, submitted_at: new Date(), submitted_by: U1 });
    await ins(app, "owner_update_revision", { id: uid(), organization_id: ORG, transformation_id: TR, owner_update_id: U.id, revision_no: 1, achievements: "Synthetic achievement", submitted_at: new Date(), submitted_by: U1 }, false);
    return "revision 1";
  });
  await expectFailure(app, "OU11 a submitted update changes only by reopening", /owner_update_submitted_frozen/, async () => updx(app, "owner_update", U.id as string, { achievements: "Edited after submission" }));
  await expectFailure(app, "OU12 reopening needs a reason", /owner_update_reopen_reason/, async () => updx(app, "owner_update", U.id as string, { status: "draft", submitted_at: null, submitted_by: null }));
  await expectSuccess(app, "OU13 reopening with a reason commits", async () => { await updx(app, "owner_update", U.id as string, { status: "draft", submitted_at: null, submitted_by: null, reopen_reason: "Synthetic correction" }); return "draft"; });
  await expectFailure(app, "OU14 an empty submission is refused", /owner_update_submitted_has_content|owner_update_revision_has_content/, async () => {
    await updx(app, "owner_update", U.id as string, { achievements: null });
    await updx(app, "owner_update", U.id as string, { status: "submitted", revision_no: 2, submitted_at: new Date(), submitted_by: U1 });
  });
  await expectFailure(app, "OU15 revisions are append-only", /append-only/, async () => { await own.query(`UPDATE owner_update_revision SET achievements = 'x' WHERE owner_update_id = $1`, [U.id]); });
  await expectFailure(app, "OU16 the subject and period never change", /owner_update_identity_immutable/, async () => updx(app, "owner_update", U.id as string, { subject_type: "transformation", subject_id: TR }));
  await expectFailure(app, "OU17 a transformation subject is the update's own transformation", /owner_update_subject_transformation/, async () => { await ins(app, "owner_update", upd({ subject_type: "transformation", subject_id: TR2 })); });

  // ---- export_job and progress (ADR-0046 §5)
  const J = job(R2.id as string);
  await expectSuccess(app, "EJ01 a queued export job with its progress row and audit event commits", async () => {
    await ins(app, "export_job", J);
    await ins(app, "export_job_progress", { export_job_id: J.id, organization_id: ORG }, false);
    return "queued";
  });
  await expectFailure(app, "EJ02 a job without its audit event fails at COMMIT", /export_job_audit_required/, async () => { await ins(app, "export_job", job(R2.id as string), false); });
  await expectFailure(app, "EJ03 the same requester and idempotency key create one job", /export_job_idempotency_key/, async () => { await ins(app, "export_job", job(R2.id as string, { idempotency_key: J.idempotency_key })); });
  await expectFailure(app, "EJ04 a format the output does not offer is refused (charter has no CSV)", /export_job_format_offered/, async () => { await ins(app, "export_job", job(R2.id as string, { format: "csv" })); });
  await expectFailure(app, "EJ05 a discarded snapshot is not exported", /export_job_snapshot_exportable/, async () => { await ins(app, "export_job", job(G1.id as string)); });
  await expectFailure(app, "EJ06 a job is created queued", /export_job_created_queued/, async () => { await ins(app, "export_job", job(R2.id as string, { status: "running", started_at: new Date() })); });
  await expectFailure(app, "EJ07 queued -> succeeded is not a transition", /export_job_transition|export_job_file_complete/, async () => updx(app, "export_job", J.id as string, { status: "succeeded", finished_at: new Date() }));
  await expectFailure(app, "EJ08 a start is the next attempt", /export_job_attempt_step/, async () => updx(app, "export_job", J.id as string, { status: "running", started_at: new Date(), attempt_count: 2 }));
  await expectFailure(app, "EJ09 a non-stepping version update fails", /export_job_version_step/, async () => updx(app, "export_job", J.id as string, { status: "running", started_at: new Date(), attempt_count: 1 }, { step: 2 }));
  await expectSuccess(app, "EJ10 queued -> running (attempt 1) commits", async () => { await updx(app, "export_job", J.id as string, { status: "running", started_at: new Date(), attempt_count: 1, updated_by: null }); return "running"; });
  await expectFailure(app, "EJ11 succeeded needs the stored file", /export_job_file_complete/, async () => updx(app, "export_job", J.id as string, { status: "succeeded", finished_at: new Date() }));
  await expectFailure(app, "EJ12 the content type matches the format", /export_job_content_type_matches/, async () => updx(app, "export_job", J.id as string, { status: "succeeded", finished_at: new Date(), storage_key: "exports/probe/1.pdf", file_name: "probe.pdf", content_type: "text/csv; charset=utf-8", file_sha256: H(9), file_size_bytes: 100 }));
  await expectFailure(app, "EJ13 progress never moves back", /export_job_progress_forward/, async () => {
    await app.query(`UPDATE export_job_progress SET stage = 'rendering', percent = 40, version = version + 1 WHERE export_job_id = $1`, [J.id]);
    await app.query(`UPDATE export_job_progress SET stage = 'loading', percent = 20, version = version + 1 WHERE export_job_id = $1`, [J.id]);
  });
  await expectFailure(app, "EJ14 progress 'done' only for a succeeded job", /export_job_progress_done_succeeded/, async () => { await app.query(`UPDATE export_job_progress SET stage = 'done', percent = 100, version = version + 1 WHERE export_job_id = $1`, [J.id]); });
  await expectFailure(app, "EJ15 the progress row steps its version", /export_job_progress_version_step/, async () => { await app.query(`UPDATE export_job_progress SET percent = 50, version = version + 3 WHERE export_job_id = $1`, [J.id]); });
  await expectSuccess(app, "EJ16 running -> succeeded with the stored file, and progress done, commits", async () => {
    await updx(app, "export_job", J.id as string, { status: "succeeded", finished_at: new Date(), storage_key: "exports/probe/1.pdf", file_name: "probe-ar.pdf", content_type: "application/pdf", file_sha256: H(9), file_size_bytes: 1000 });
    await app.query(`UPDATE export_job_progress SET stage = 'done', percent = 100, version = version + 1 WHERE export_job_id = $1`, [J.id]);
    return "succeeded";
  });
  await expectFailure(app, "EJ17 a finished job never changes", /export_job_finished_frozen|export_job_transition/, async () => updx(app, "export_job", J.id as string, { file_name: "renamed.pdf" }));
  await expectFailure(app, "EJ18 the request (format, language, snapshot) never changes", /export_job_request_immutable/, async () => {
    const j2 = job(R2.id as string); await ins(app, "export_job", j2);
    await updx(app, "export_job", j2.id as string, { language: "en" });
  });
  await expectFailure(app, "EJ19 a failed job names its error code", /export_job_error_complete/, async () => {
    const j3 = job(R2.id as string); await ins(app, "export_job", j3);
    await updx(app, "export_job", j3.id as string, { status: "failed", finished_at: new Date() });
  });
  await expectFailure(app, "EJ20 mth_app cannot DELETE an export job", /permission denied/, async () => { await app.query(`DELETE FROM export_job WHERE id = $1`, [J.id]); });

  for (const t of ["report_definition", "report_snapshot_source", "report_snapshot_version", "report_snapshot_evidence", "owner_update_revision"]) {
    const g = (await own.query(`SELECT has_table_privilege('mth_app', $1, 'UPDATE') AS u, has_table_privilege('mth_app', $1, 'DELETE') AS d`, [t])).rows[0];
    report(`AO ${t}: mth_app has no UPDATE or DELETE grant`, !g.u && !g.d, JSON.stringify(g));
  }
  for (const t of ["report_snapshot", "owner_update", "export_job", "export_job_progress"]) {
    const g = (await own.query(`SELECT has_table_privilege('mth_app', $1, 'DELETE') AS d`, [t])).rows[0];
    report(`AD ${t}: mth_app has no DELETE grant`, !g.d, JSON.stringify(g));
  }
  void MT;
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
