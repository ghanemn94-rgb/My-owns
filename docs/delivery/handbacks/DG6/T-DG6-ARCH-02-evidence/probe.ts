// T-DG6-ARCH-02 migration and guard probe (solution-architect). Run against a DISPOSABLE cluster only:
//   QA_PG_PORT=<port in 23700-23749> MTH_PORT_POOL=<rest of 23700-23749> tests/qa/support/with-pg.sh \
//     node --conditions=@mth/source docs/delivery/handbacks/DG6/T-DG6-ARCH-02-evidence/probe.ts
// 1. Fresh database: all migrations 0001..last.
// 2. P5-populated database: 0001..0097, a synthetic transformation instantiated by the DG3 function, a KPI definition,
//    an evidence file with a pre-P6 content row and an inbox notification; then 0098..last on top.
// 3. Guard probes on the slice J and C tables (ADR-0053, ADR-0054). "PASS" means the guard fired (or, for an
//    expectSuccess probe, that the allowed write committed). API-path writes run as mth_app with every trigger on;
//    migration-path writes (job identities) run as mth_owner. Fixture records are inserted by the superuser with
//    session_replication_role = replica (the T-DG6-ARCH-01 harness, copied). All data is SYNTHETIC and approves nothing.
import { cpSync, mkdtempSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "../../../../../packages/db/src/migrate.ts";

const pg = createRequire(new URL("../../../../../packages/db/package.json", import.meta.url))("pg");
const admin = process.env.TEST_DATABASE_ADMIN_URL!;
const migrationsDir = new URL("../../../../../packages/db/migrations", import.meta.url).pathname;
const LAST_P5 = 97;
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
const U1 = "01990000-0000-7000-8000-000000000003"; // TO-like granter
const U2 = "01990000-0000-7000-8000-000000000004"; // grantee
const TR = "01990000-0000-7000-8000-000000000005";
const U3 = "01990000-0000-7000-8000-000000000006"; // second grantee
const ORG2 = "01990000-0000-7000-8000-000000000008";
const UX = "01990000-0000-7000-8000-000000000009";
let seq = 0x100;
const uid = () => `01990000-0000-7000-8000-${(seq++).toString(16).padStart(12, "0")}`;
async function seedP1(c: any): Promise<void> {
  await c.query(`INSERT INTO organization (id, code, name_en, name_ar) VALUES ($1, 'SYN-PROBE', 'Synthetic probe org', 'منظمة تجريبية')`, [ORG]);
  await c.query(`INSERT INTO organization (id, code, name_en, name_ar) VALUES ($1, 'SYN-OTHER', 'Synthetic other org', 'منظمة أخرى')`, [ORG2]);
  await c.query(
    `INSERT INTO app_user (id, organization_id, display_name) VALUES ($1, $4, 'Synthetic granter'), ($2, $4, 'Synthetic grantee'), ($3, $4, 'Synthetic second grantee')`,
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
    `INSERT INTO audit_event (id, organization_id, transformation_id, actor_type, actor_user_id, action, record_type, record_id, new_version, source)
     VALUES ($1, $2, $3, 'user', $4, $5, $6, $7, $8, 'api')`,
    [uid(), ORG, TR, U1, `${recordType}.probe`, recordType, id, version],
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


const KPI = "01990000-0000-7000-8000-0000000000d1";
const KPIX = "01990000-0000-7000-8000-0000000000d2"; // another organization's KPI
const TRX = "01990000-0000-7000-8000-0000000000d3";
const EVF = "01990000-0000-7000-8000-0000000000e2";
const EVC = "01990000-0000-7000-8000-0000000000e3";
const NOTE1 = "01990000-0000-7000-8000-0000000000a1";
const NOTEX = "01990000-0000-7000-8000-0000000000a3";
const CONN = "01990000-0000-7000-8000-0000000000f1";
const T0 = "2026-10-26T10:00:00Z";
const ref = (name: string) => JSON.stringify({ provider: "env", name });
const exc = (o: Record<string, unknown> = {}) => ({ id: uid(), organization_id: null, source_kind: "job", source_code: "kpi.recalculate",
  failure_class: "job_failed", dedup_key: "job:kpi.recalculate:job_failed", first_occurred_at: T0, last_occurred_at: T0,
  last_error_code: "job.handler_failed", last_error_message: "Synthetic: handler failed", ...o });
const staleExc = (o: Record<string, unknown> = {}) => exc({ organization_id: ORG, source_kind: "data_freshness", source_code: `kpi:${KPI}`,
  failure_class: "data_stale", dedup_key: `data_freshness:kpi:${KPI}:data_stale`, last_error_code: "kpi.data_stale", ...o });
const delivery = (o: Record<string, unknown> = {}) => ({ id: uid(), organization_id: ORG, inbox_notification_id: NOTE1, channel_kind: "email", ...o });
const s3 = (o: Record<string, unknown> = {}) => ({ id: uid(), driver: "s3", s3_endpoint: "https://objects.example.internal", s3_region: "me-central-1",
  s3_bucket: "mth-evidence", s3_access_key_ref: ref("S3_ACCESS_KEY_ID"), s3_secret_key_ref: ref("S3_SECRET_ACCESS_KEY"),
  reason: "Synthetic: IT configures the object store", created_by: U1, updated_by: U1, ...o });
const email = (o: Record<string, unknown> = {}) => ({ id: uid(), organization_id: ORG, channel_kind: "email", enabled: true, smtp_host: "smtp.example.internal",
  smtp_port: 587, smtp_security: "starttls", smtp_username_ref: ref("SMTP_USERNAME"), smtp_password_ref: ref("SMTP_PASSWORD"),
  from_address: "noreply@example.internal", reason: "Synthetic: IT enables email", created_by: U1, updated_by: U1, ...o });

async function main(): Promise<void> {
  const files = readdirSync(migrationsDir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  console.log(`migrations shipped: ${files.length} (${files[0]} .. ${files[files.length - 1]})`);
  const ids = files.map((f) => Number(f.slice(0, 4)));
  report("G00 slice J/C migrations 0101-0103 present directly above 0100 (D-196); nothing above 0103", [101, 102, 103].every((n) => ids.includes(n)) && Math.max(...ids) === 103, `ids >= 98: ${ids.filter((n) => n >= 98).join(",")}`);

  await createDb("probe_fresh");
  const applied = await migrate(roleUrl("probe_fresh", "mth_owner"), { dir: migrationsDir });
  report("G01 fresh database: 0001..last apply", applied.length === files.length, `applied ${applied.length}: ${applied.slice(-4).join(", ")}`);

  const db = "probe_p5";
  await createDb(db);
  const p5Dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "p5-migrations-"));
  const p5Files = files.filter((f) => Number(f.slice(0, 4)) <= LAST_P5);
  for (const f of p5Files) cpSync(join(migrationsDir, f), join(p5Dir, f));
  const p5Applied = await migrate(roleUrl(db, "mth_owner"), { dir: p5Dir });
  {
    const c = await client(db);
    await seedP1(c);
    await c.query(`INSERT INTO business_unit (id, organization_id, code, name_en, name_ar) VALUES ('01990000-0000-7000-8000-0000000000d4', $1, 'SYN-BUX', 'Synthetic other BU', 'وحدة أخرى')`, [ORG2]);
    await c.query(`INSERT INTO transformation (id, organization_id, business_unit_id, code, name, mode, current_phase, timezone, currency, created_by, updated_by)
      VALUES ($1, $2, '01990000-0000-7000-8000-0000000000d4', 'SYN-TX', 'Synthetic other transformation', 'end_to_end', 'diagnose', 'Asia/Riyadh', 'SAR', $3, $3)`, [TRX, ORG2, UX]).catch(async (e: any) => {
      throw new Error(`other-org transformation fixture: ${e.message}`);
    });
    await c.query("BEGIN");
    await c.query(`SELECT p3_instantiate_transformation($1, $2, 'probe', 'cli')`, [TR, U1]);
    await c.query("COMMIT");
    await c.end();
  }
  await fixture(db, "kpi_definition", { id: KPI, organization_id: ORG, transformation_id: TR, name: "Synthetic roaming revenue KPI", unit_kind: "count", polarity: "higher_is_better", created_by: U1, updated_by: U1 });
  await fixture(db, "kpi_definition", { id: KPIX, organization_id: ORG2, transformation_id: TRX, name: "Synthetic other-org KPI", unit_kind: "count", polarity: "higher_is_better", created_by: UX, updated_by: UX });
  await fixture(db, "evidence", { id: EVF, organization_id: ORG, transformation_id: TR, kind: "file", title: "Synthetic file", owner_user_id: U1, created_by: U1, updated_by: U1 });
  await fixture(db, "evidence_content", { id: EVC, organization_id: ORG, transformation_id: TR, evidence_id: EVF, revision: 1, storage_key: "probe/pre-p6", sha256: "0".repeat(64),
    size_bytes: 3, content_type: "application/octet-stream", file_name: "pre-p6.bin", uploaded_by: U1 });
  await fixture(db, "inbox_notification", { id: NOTE1, organization_id: ORG, transformation_id: TR, recipient_user_id: U2, link_path: `/transformations/${TR}`,
    message_key: "inbox.probe", message_params: JSON.stringify({}), dedupe_key: "probe-1" });
  await fixture(db, "inbox_notification", { id: NOTEX, organization_id: ORG2, transformation_id: TRX, recipient_user_id: UX, link_path: `/transformations/${TRX}`,
    message_key: "inbox.probe", message_params: JSON.stringify({}), dedupe_key: "probe-x" });
  {
    const c = await client(db);
    const n = (await c.query(`SELECT (SELECT count(*) FROM kpi_definition WHERE id IN ($1, $2))::int AS k, (SELECT count(*) FROM evidence_content)::int AS e, (SELECT count(*) FROM inbox_notification)::int AS i`, [KPI, KPIX])).rows[0];
    report("G02 P5 database populated (0001-0097; a synthetic transformation instantiated by the DG3 function, 2 KPI definitions in 2 organizations, a pre-P6 evidence file, 2 notifications)",
      p5Applied.length === p5Files.length && n.k === 2 && n.e === 1 && n.i === 2, `applied ${p5Applied.length}; ${JSON.stringify(n)}`);
    await c.end();
  }
  const onTop = await migrate(roleUrl(db, "mth_owner"), { dir: migrationsDir });
  {
    const c = await client(db);
    report("G03 P6 (0098..last, including slice J/C 0101-0103) over the P5 database apply", onTop.length === files.length - p5Files.length && onTop.slice(-3).join(",").includes("0103"), `applied ${onTop.length}: ${onTop.join(", ")}`);
    const r = (await c.query(`SELECT (SELECT string_agg(storage_driver, ',') FROM evidence_content) AS d,
      (SELECT count(*) FROM service_identity)::int AS si, (SELECT count(*) FROM operational_exception)::int AS oe, (SELECT count(*) FROM worker_heartbeat)::int AS wh,
      (SELECT count(*) FROM storage_setting)::int AS st, (SELECT count(*) FROM notification_channel)::int AS nc, (SELECT count(*) FROM notification_delivery)::int AS nd,
      (SELECT version FROM kpi_definition WHERE id = $1) AS kv`, [KPI])).rows[0];
    report("G04 the upgrade leaves existing rows as they were: the pre-P6 file is on 'filesystem'; no identity, exception, heartbeat, storage, channel or delivery row (= DG5 behaviour: filesystem storage, in-app only); the KPI at version 1",
      r.d === "filesystem" && r.si + r.oe + r.wh + r.st + r.nc + r.nd === 0 && r.kv === 1, JSON.stringify(r));
    await c.end();
  }

  const app = await client(db, "mth_app");
  const owner = await client(db, "mth_owner");

  // ---- SI: service identities (ADR-0053 §1)
  const SIJ = uid();
  await expectSuccess(owner, "SI01 a migration (owner) declares a platform job identity with read and write codes, audited", async () =>
    ins(owner, "service_identity", { id: SIJ, code: "job:kpi.recalculate", subject_kind: "job", queue_name: "kpi.recalculate", scope_level: "platform",
      declared_permission_codes: ["transformation.read", "organization.read"], granted_permission_codes: ["transformation.read", "organization.read"],
      sensitive_access: "aggregate_only", label_en: "KPI recalculation job", label_ar: "مهمة إعادة احتساب مؤشرات الأداء", reason: "Declared by migration (synthetic probe)" }));
  await expectFailure(app, "SI02 the application cannot declare a job identity", /service_identity_job_by_migration/, async () => {
    await ins(app, "service_identity", { id: uid(), code: "job:reports.export", subject_kind: "job", queue_name: "reports.export", scope_level: "platform",
      declared_permission_codes: ["transformation.read"], granted_permission_codes: ["transformation.read"], label_en: "x", label_ar: "x", reason: "Synthetic attempt" });
  });
  await expectFailure(owner, "SI03 a business-approval code is refused even for a migration", /service_identity_permission_category/, async () => {
    await ins(owner, "service_identity", { id: uid(), code: "job:gates.decided", subject_kind: "job", queue_name: "gates.decided", scope_level: "platform",
      declared_permission_codes: ["gate.decide"], granted_permission_codes: [], label_en: "x", label_ar: "x", reason: "Synthetic attempt" });
  });
  await expectFailure(owner, "SI04 a configure code is refused (storage.configure)", /service_identity_permission_category/, async () => {
    await ins(owner, "service_identity", { id: uid(), code: "job:branding.published", subject_kind: "job", queue_name: "branding.published", scope_level: "platform",
      declared_permission_codes: ["storage.configure"], granted_permission_codes: [], label_en: "x", label_ar: "x", reason: "Synthetic attempt" });
  });
  await expectFailure(owner, "SI05 an unknown code is refused", /service_identity_permission_category/, async () => {
    await ins(owner, "service_identity", { id: uid(), code: "job:demo.reset", subject_kind: "job", queue_name: "demo.reset", scope_level: "platform",
      declared_permission_codes: ["no.such_permission"], granted_permission_codes: [], label_en: "x", label_ar: "x", reason: "Synthetic attempt" });
  });
  const SIC = uid();
  await expectSuccess(app, "SI06 the application creates a connector identity (organization scope), audited", async () =>
    ins(app, "service_identity", { id: SIC, code: `connector:${CONN}`, subject_kind: "connector", connector_id: CONN, scope_level: "organization", organization_id: ORG,
      declared_permission_codes: ["transformation.read"], granted_permission_codes: ["transformation.read"], label_en: "Synthetic test connector", label_ar: "موصل اختبار تجريبي", reason: "Connector created (synthetic)", created_by: U1, updated_by: U1 }));
  await expectFailure(app, "SI07 missing audit fails at COMMIT (connector identity)", /service_identity_audit_required/, async () => {
    const c2 = uid();
    await ins(app, "service_identity", { id: uid(), code: `connector:${c2}`, subject_kind: "connector", connector_id: c2, scope_level: "organization", organization_id: ORG,
      declared_permission_codes: ["transformation.read"], granted_permission_codes: ["transformation.read"], label_en: "x", label_ar: "x", reason: "No audit" }, false);
  });
  await expectFailure(app, "SI08 a connector identity cannot have platform scope", /service_identity_subject_shape|service_identity_scope_shape/, async () => {
    const c2 = uid();
    await ins(app, "service_identity", { id: uid(), code: `connector:${c2}`, subject_kind: "connector", connector_id: c2, scope_level: "platform",
      declared_permission_codes: ["transformation.read"], granted_permission_codes: ["transformation.read"], label_en: "x", label_ar: "x", reason: "Synthetic attempt" });
  });
  await expectFailure(owner, "SI09 the code must name the queue", /service_identity_subject_shape/, async () => {
    await ins(owner, "service_identity", { id: uid(), code: "job:other.queue", subject_kind: "job", queue_name: "reports.export", scope_level: "platform",
      declared_permission_codes: [], granted_permission_codes: [], label_en: "x", label_ar: "x", reason: "Synthetic attempt" });
  });
  await expectSuccess(app, "SI10 the application narrows the grant (version + 1, audited); the history holds 2 rows", async () => {
    await updx(app, "service_identity", SIJ, { granted_permission_codes: ["transformation.read"], reason: "IT narrows the job (synthetic)", updated_by: U1 });
    const n = (await app.query(`SELECT count(*)::int AS n FROM service_identity_change WHERE service_identity_id = $1`, [SIJ])).rows[0].n;
    if (n !== 2) throw new Error(`history rows ${n}`);
    return `history rows ${n}`;
  });
  await expectFailure(app, "SI11 a grant beyond the declaration is refused", /service_identity_grant_within_declaration/, async () => {
    await updx(app, "service_identity", SIJ, { granted_permission_codes: ["transformation.read", "user.read"], reason: "Synthetic attempt" });
  });
  await expectFailure(app, "SI12 the application cannot change the declaration (column privilege)", /42501/, async () => {
    await updx(app, "service_identity", SIJ, { declared_permission_codes: ["transformation.read", "user.read"] });
  });
  await expectFailure(app, "SI13 a non-stepping version fails", /service_identity_version_step/, async () => {
    await updx(app, "service_identity", SIJ, { reason: "Synthetic skip" }, { step: 2 });
  });
  await expectFailure(app, "SI14 missing audit on an update fails at COMMIT", /service_identity_audit_required/, async () => {
    await updx(app, "service_identity", SIJ, { reason: "Synthetic, no audit" }, { audit: false });
  });
  await expectFailure(owner, "SI15 UPDATE on service_identity_change fails (append-only)", /append-only/, async () => {
    await owner.query(`UPDATE service_identity_change SET reason = 'tampered'`);
  });
  await expectFailure(owner, "SI16 DELETE on service_identity_change fails (append-only)", /append-only/, async () => {
    await owner.query(`DELETE FROM service_identity_change`);
  });
  await expectFailure(app, "SI17 the application cannot write the history", /42501/, async () => {
    await app.query(`INSERT INTO service_identity_change (id, service_identity_id, record_version, declared_permission_codes, granted_permission_codes, sensitive_access, reason, changed_at)
      VALUES ($1, $2, 99, '{}', '{}', 'none', 'forged', now())`, [uid(), SIJ]);
  });

  // ---- OE: operational exceptions (ADR-0053 §2)
  const OE1 = uid();
  await expectSuccess(app, "OE01 a job failure opens a platform exception (open, 1 occurrence), audited; event 'opened'", async () => {
    await ins(app, "operational_exception", exc({ id: OE1, service_identity_id: SIJ }));
    const e = (await app.query(`SELECT event_kind FROM operational_exception_event WHERE operational_exception_id = $1`, [OE1])).rows.map((r: any) => r.event_kind).join(",");
    if (e !== "opened") throw new Error(e);
    return e;
  });
  await expectFailure(app, "OE02 a second ACTIVE exception with the same key is refused, also for platform rows (NULLS NOT DISTINCT)", /23505.*operational_exception_one_active_key/, async () => {
    await ins(app, "operational_exception", exc());
  });
  await expectFailure(app, "OE03 the dedup key must equal source_kind:source_code:failure_class", /operational_exception_dedup_key/, async () => {
    await ins(app, "operational_exception", exc({ dedup_key: "job:other:job_failed" }));
  });
  await expectFailure(app, "OE04 the failure class must match the source kind", /operational_exception_class_shape/, async () => {
    await ins(app, "operational_exception", exc({ failure_class: "data_stale", dedup_key: "job:kpi.recalculate:data_stale" }));
  });
  await expectFailure(app, "OE05 an exception cannot be created acknowledged", /operational_exception_transition/, async () => {
    await ins(app, "operational_exception", staleExc({ status: "acknowledged", acknowledged_at: T0, acknowledged_by: U1 }));
  });
  await expectFailure(app, "OE06 missing audit fails at COMMIT", /operational_exception_audit_required/, async () => {
    await ins(app, "operational_exception", staleExc(), false);
  });
  await expectSuccess(app, "OE07 a recurrence counts once (2 occurrences), event 'recurred'", async () => {
    await updx(app, "operational_exception", OE1, { occurrence_count: 2, last_occurred_at: "2026-10-26T10:05:00Z" });
    return "occurrence_count 2";
  });
  await expectFailure(app, "OE08 a recurrence cannot count twice", /operational_exception_occurrence_step/, async () => {
    await updx(app, "operational_exception", OE1, { occurrence_count: 4, last_occurred_at: "2026-10-26T10:10:00Z" });
  });
  await expectFailure(app, "OE09 a non-stepping version fails", /operational_exception_version_step/, async () => {
    await updx(app, "operational_exception", OE1, { last_error_message: "x" }, { step: 0 });
  });
  await expectSuccess(app, "OE10 acknowledge (open -> acknowledged), event 'acknowledged'", async () => {
    await updx(app, "operational_exception", OE1, { status: "acknowledged", acknowledged_at: "2026-10-26T10:06:00Z", acknowledged_by: U1, acknowledge_note: "Looking into it", updated_by: U1 });
    return "acknowledged";
  });
  await expectFailure(app, "OE11 acknowledged -> open is refused", /operational_exception_transition|operational_exception_ack_complete/, async () => {
    await updx(app, "operational_exception", OE1, { status: "open", acknowledged_at: null, acknowledged_by: null, acknowledge_note: null });
  });
  await expectFailure(app, "OE12 a manual resolution needs the resolver and a note", /operational_exception_resolved_complete/, async () => {
    await updx(app, "operational_exception", OE1, { status: "resolved", resolved_at: "2026-10-26T10:07:00Z", resolution: "manual", resolved_by: U1 });
  });
  await expectFailure(app, "OE13 a 'recovered' resolution has no user", /operational_exception_resolved_complete/, async () => {
    await updx(app, "operational_exception", OE1, { status: "resolved", resolved_at: "2026-10-26T10:07:00Z", resolution: "recovered", resolved_by: U1 });
  });
  await expectSuccess(app, "OE14 resolve manually with a note; the event history is opened,recurred,acknowledged,resolved", async () => {
    await updx(app, "operational_exception", OE1, { status: "resolved", resolved_at: "2026-10-26T10:07:00Z", resolution: "manual", resolved_by: U1, resolution_note: "Fixed the source", updated_by: U1 });
    const e = (await app.query(`SELECT string_agg(event_kind, ',' ORDER BY record_version) AS e FROM operational_exception_event WHERE operational_exception_id = $1`, [OE1])).rows[0].e;
    if (e !== "opened,recurred,acknowledged,resolved") throw new Error(e);
    return e;
  });
  await expectFailure(app, "OE15 a resolved exception never changes", /operational_exception_resolved_final/, async () => {
    await updx(app, "operational_exception", OE1, { occurrence_count: 3, last_occurred_at: "2026-10-26T11:00:00Z" });
  });
  await expectSuccess(app, "OE16 after resolution a new failure of the same key opens a NEW exception", async () =>
    ins(app, "operational_exception", exc({ first_occurred_at: "2026-10-26T12:00:00Z", last_occurred_at: "2026-10-26T12:00:00Z" })));
  await expectFailure(app, "OE17 the source never changes", /operational_exception_identity_fixed|operational_exception_resolved_final/, async () => {
    const id = (await app.query(`SELECT id FROM operational_exception WHERE status = 'open' AND organization_id IS NULL`)).rows[0].id;
    await updx(app, "operational_exception", id, { source_code: "reports.export", dedup_key: "job:reports.export:job_failed" });
  });
  await expectFailure(owner, "OE18 UPDATE on operational_exception_event fails (append-only)", /append-only/, async () => {
    await owner.query(`UPDATE operational_exception_event SET note = 'tampered'`);
  });
  await expectFailure(owner, "OE19 DELETE on operational_exception_event fails (append-only)", /append-only/, async () => {
    await owner.query(`DELETE FROM operational_exception_event`);
  });
  await expectFailure(app, "OE20 a worker exception belongs to no organization", /operational_exception_class_shape/, async () => {
    await ins(app, "operational_exception", exc({ organization_id: ORG, source_kind: "worker", source_code: "worker", failure_class: "heartbeat_missed", dedup_key: "worker:worker:heartbeat_missed" }));
  });
  const OE2 = uid();
  await expectSuccess(app, "OEK01 a data-stale exception links its KPI (same organization and transformation)", async () => {
    await ins(app, "operational_exception", staleExc({ id: OE2 }));
    await app.query(`INSERT INTO operational_exception_kpi (id, operational_exception_id, organization_id, transformation_id, kpi_definition_id) VALUES ($1, $2, $3, $4, $5)`, [uid(), OE2, ORG, TR, KPI]);
    return "linked";
  });
  await expectFailure(app, "OEK02 another organization's KPI cannot be linked", /operational_exception_kpi_same_scope/, async () => {
    await app.query(`INSERT INTO operational_exception_kpi (id, operational_exception_id, organization_id, transformation_id, kpi_definition_id) VALUES ($1, $2, $3, $4, $5)`, [uid(), OE2, ORG2, TRX, KPIX]);
  });
  await expectFailure(app, "OEK03 a KPI is linked once per exception", /23505.*operational_exception_kpi_key/, async () => {
    await app.query(`INSERT INTO operational_exception_kpi (id, operational_exception_id, organization_id, transformation_id, kpi_definition_id) VALUES ($1, $2, $3, $4, $5)`, [uid(), OE2, ORG, TR, KPI]);
  });
  await expectFailure(owner, "OEK04 the links are append-only (DELETE)", /append-only/, async () => {
    await owner.query(`DELETE FROM operational_exception_kpi`);
  });

  // ---- WH: worker heartbeat (ADR-0053 §6)
  const WH = uid();
  await expectSuccess(app, "WH01 a beat is written and advanced WITHOUT an audit event (telemetry, not audited)", async () => {
    await app.query(`INSERT INTO worker_heartbeat (id, instance_key, app_version, started_at, last_beat_at, queue_count) VALUES ($1, 'worker-a1', '0.6.0', $2, $2, 35)`, [WH, T0]);
    await app.query(`UPDATE worker_heartbeat SET last_beat_at = '2026-10-26T10:00:30Z', beat_count = 2, version = 2, updated_at = now() WHERE id = $1`, [WH]);
    return "2 beats";
  });
  await expectFailure(app, "WH02 a beat cannot skip or go back", /worker_heartbeat_forward/, async () => {
    await app.query(`UPDATE worker_heartbeat SET last_beat_at = '2026-10-26T10:00:00Z', beat_count = 4, version = 3 WHERE id = $1`, [WH]);
  });
  await expectFailure(app, "WH03 a non-stepping version fails", /worker_heartbeat_version_step/, async () => {
    await app.query(`UPDATE worker_heartbeat SET last_beat_at = '2026-10-26T10:01:00Z', beat_count = 3, version = 2 WHERE id = $1`, [WH]);
  });

  // ---- ST: storage setting (ADR-0054 §2)
  await expectFailure(app, "ST01 an s3 setting without credentials is refused", /storage_setting_s3_complete/, async () => {
    await ins(app, "storage_setting", s3({ s3_secret_key_ref: null }));
  });
  await expectFailure(app, "ST02 a SecretRef carrying a value is refused", /storage_setting_secret_key_ref/, async () => {
    await ins(app, "storage_setting", s3({ s3_secret_key_ref: JSON.stringify({ provider: "env", name: "S3_SECRET_ACCESS_KEY", value: "synthetic-not-a-secret" }) }));
  });
  await expectFailure(app, "ST03 missing audit fails at COMMIT", /storage_setting_audit_required/, async () => {
    await ins(app, "storage_setting", s3(), false);
  });
  const ST = uid();
  await expectSuccess(app, "ST04 a complete s3 setting (references only) commits, audited", async () => ins(app, "storage_setting", s3({ id: ST })));
  await expectFailure(app, "ST05 at most one storage setting", /23505.*storage_setting_singleton_key/, async () => {
    await ins(app, "storage_setting", s3());
  });
  await expectFailure(app, "ST06 a non-stepping version fails", /storage_setting_version_step/, async () => {
    await updx(app, "storage_setting", ST, { driver: "filesystem" }, { step: 3 });
  });
  await expectSuccess(app, "ST07 back to filesystem (version + 1, audited); history 2 rows", async () => {
    await updx(app, "storage_setting", ST, { driver: "filesystem", reason: "Synthetic: back to the private filesystem" });
    const n = (await app.query(`SELECT count(*)::int AS n FROM storage_setting_change WHERE storage_setting_id = $1`, [ST])).rows[0].n;
    if (n !== 2) throw new Error(`history ${n}`);
    return `history ${n}`;
  });
  await expectFailure(owner, "ST08 UPDATE on storage_setting_change fails (append-only)", /append-only/, async () => {
    await owner.query(`UPDATE storage_setting_change SET reason = 'tampered'`);
  });
  await expectFailure(app, "ST09 an evidence row names a known store only", /evidence_content_storage_driver/, async () => {
    await app.query(`INSERT INTO evidence_content (id, organization_id, transformation_id, evidence_id, revision, storage_key, sha256, size_bytes, content_type, file_name, uploaded_by, storage_driver)
      VALUES ($1, $2, $3, $4, 2, 'probe/x', $5, 3, 'application/octet-stream', 'x.bin', $6, 'ftp')`, [uid(), ORG, TR, EVF, "0".repeat(64), U1]);
  });

  // ---- NC: notification channels (ADR-0054 §3)
  await expectFailure(app, "NC01 enabling email without a host is refused", /notification_channel_email_complete/, async () => {
    await ins(app, "notification_channel", email({ smtp_host: null }));
  });
  await expectFailure(app, "NC02 enterprise messaging can never be enabled (no adapter ships)", /notification_channel_no_messaging_adapter/, async () => {
    await ins(app, "notification_channel", { id: uid(), organization_id: ORG, channel_kind: "enterprise_messaging", enabled: true, reason: "Synthetic attempt", created_by: U1, updated_by: U1 });
  });
  await expectFailure(app, "NC03 a username without a password reference is refused", /notification_channel_credentials_pair/, async () => {
    await ins(app, "notification_channel", email({ smtp_password_ref: null }));
  });
  await expectFailure(app, "NC04 missing audit fails at COMMIT", /notification_channel_audit_required/, async () => {
    await ins(app, "notification_channel", email(), false);
  });
  const NC = uid();
  await expectSuccess(app, "NC05 a complete email channel commits, audited", async () => ins(app, "notification_channel", email({ id: NC })));
  await expectFailure(app, "NC06 one channel per organization and kind", /23505.*notification_channel_kind_key/, async () => {
    await ins(app, "notification_channel", email());
  });
  await expectFailure(app, "NC07 the channel kind never changes", /notification_channel_kind_fixed|notification_channel_no_messaging_adapter/, async () => {
    await updx(app, "notification_channel", NC, { channel_kind: "enterprise_messaging", enabled: false, smtp_host: null, smtp_port: null, smtp_security: null, smtp_username_ref: null, smtp_password_ref: null, from_address: null });
  });
  await expectFailure(app, "NC08 a non-stepping version fails", /notification_channel_version_step/, async () => {
    await updx(app, "notification_channel", NC, { enabled: false }, { step: 2 });
  });
  await expectFailure(owner, "NC09 DELETE on notification_channel_change fails (append-only)", /append-only/, async () => {
    await owner.query(`DELETE FROM notification_channel_change`);
  });

  // ---- ND: notification deliveries (ADR-0054 §3)
  const ND = uid();
  await expectSuccess(app, "ND01 a pending email delivery for a notification commits, audited", async () => ins(app, "notification_delivery", delivery({ id: ND })));
  await expectFailure(app, "ND02 a replay creates nothing: one delivery per (notification, channel)", /23505.*notification_delivery_once_key/, async () => {
    await ins(app, "notification_delivery", delivery());
  });
  await expectFailure(app, "ND03 the notification must belong to the delivery's organization", /notification_delivery_same_organization/, async () => {
    await ins(app, "notification_delivery", delivery({ inbox_notification_id: NOTEX }));
  });
  await expectFailure(app, "ND04 missing audit fails at COMMIT", /notification_delivery_audit_required/, async () => {
    await ins(app, "notification_delivery", delivery({ channel_kind: "enterprise_messaging" }), false);
  });
  await expectFailure(app, "ND05 a failure needs its error code", /notification_delivery_failed_complete/, async () => {
    await updx(app, "notification_delivery", ND, { status: "failed", attempts: 1, last_attempt_at: T0 });
  });
  await expectSuccess(app, "ND06 pending -> failed -> pending -> sent, one attempt counted per send", async () => {
    await updx(app, "notification_delivery", ND, { status: "failed", attempts: 1, last_attempt_at: T0, error_code: "smtp.connection_refused" });
    await updx(app, "notification_delivery", ND, { status: "pending" });
    await updx(app, "notification_delivery", ND, { status: "sent", attempts: 2, last_attempt_at: "2026-10-26T10:01:00Z", sent_at: "2026-10-26T10:01:00Z", error_code: null });
    return "sent after 2 attempts";
  });
  await expectFailure(app, "ND07 a sent delivery is final", /notification_delivery_final/, async () => {
    await updx(app, "notification_delivery", ND, { status: "pending", sent_at: null });
  });
  await expectFailure(app, "ND08 an attempt counts exactly once", /notification_delivery_attempt_step/, async () => {
    const id = uid();
    await ins(app, "notification_delivery", delivery({ id, channel_kind: "enterprise_messaging" }));
    await updx(app, "notification_delivery", id, { status: "failed", attempts: 2, last_attempt_at: T0, error_code: "x.y" });
  });
  await expectSuccess(app, "ND09 a delivery can be skipped at creation with its reason (channel disabled)", async () =>
    ins(app, "notification_delivery", delivery({ channel_kind: "enterprise_messaging", status: "skipped", skip_reason: "channel_disabled" })));
  await expectFailure(app, "ND10 a delivery cannot be created sent", /notification_delivery_transition/, async () => {
    const n = uid();
    await fixture(db, "inbox_notification", { id: n, organization_id: ORG, transformation_id: TR, recipient_user_id: U2, link_path: `/transformations/${TR}`, message_key: "inbox.probe", message_params: "{}", dedupe_key: `probe-${n}` });
    await ins(app, "notification_delivery", delivery({ inbox_notification_id: n, status: "sent", sent_at: T0, attempts: 1, last_attempt_at: T0 }));
  });

  // ---- PM: permission seeds (ADR-0053 §9, ADR-0054 §5)
  const CODES = ["operations.read", "operations.acknowledge", "service_identity.configure", "identity.read", "storage.configure", "notification_channel.configure"];
  {
    const p = (await app.query(`SELECT code || ':' || category AS c FROM permission WHERE code = ANY($1) ORDER BY code`, [CODES])).rows.map((r: any) => r.c).join(",");
    report("PM01 six P6 J/C permission codes with their categories", p === "identity.read:read,notification_channel.configure:configure,operations.acknowledge:write,operations.read:read,service_identity.configure:configure,storage.configure:configure", p);
    const l = (await app.query(`SELECT r.code || ':' || rp.permission_code AS l FROM role_permission rp JOIN role r ON r.id = rp.role_id WHERE rp.permission_code = ANY($1) ORDER BY 1`, [CODES])).rows.map((r: any) => r.l).join(",");
    report("PM02 role defaults: operations.read ADM_TECH/TO/KDS/TD/AUD; acknowledge ADM_TECH/KDS; identity.read ADM_TECH/ADM_ACCESS/AUD; configure codes ADM_TECH only", l ===
      "ADM_ACCESS:identity.read,ADM_TECH:identity.read,ADM_TECH:notification_channel.configure,ADM_TECH:operations.acknowledge,ADM_TECH:operations.read,ADM_TECH:service_identity.configure,ADM_TECH:storage.configure,AUD:identity.read,AUD:operations.read,KDS:operations.acknowledge,KDS:operations.read,TD:operations.read,TO:operations.read", l);
    const aud = (await app.query(`SELECT count(*)::int AS n FROM role_permission rp JOIN role r ON r.id = rp.role_id JOIN permission p ON p.code = rp.permission_code WHERE r.code = 'AUD' AND p.category <> 'read'`)).rows[0].n;
    report("PM03 AUD holds only read permissions after 0103", aud === 0, `non-read AUD links: ${aud}`);
  }
  await expectFailure(owner, "PM04 a technical admin can still never hold a business approval (0001 trigger)", /separation of duties/, async () => {
    await owner.query(`INSERT INTO role_permission (role_id, permission_code) VALUES ('01920000-0000-7000-8000-00000000000c', 'gate.decide')`);
  });

  await app.end();
  await owner.end();
  console.log(`\n${total - failures}/${total} PASS${failures ? `, ${failures} FAIL` : ""}`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
