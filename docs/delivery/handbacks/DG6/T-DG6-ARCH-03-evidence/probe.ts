// T-DG6-ARCH-03 migration and guard probe (solution-architect). Run against a DISPOSABLE cluster only:
//   QA_PG_PORT=<port in 23700-23749> MTH_PORT_POOL=<rest of 23700-23749> tests/qa/support/with-pg.sh \
//     node --conditions=@mth/source docs/delivery/handbacks/DG6/T-DG6-ARCH-03-evidence/probe.ts
// 1. Fresh database: all migrations 0001..last.
// 2. P5-populated database: 0001..0097 plus synthetic fixtures (a transformation instantiated by the DG3 function, a KPI,
//    a deliverable, evidence items, KPI actual values); then 0098..last on top.
// 3. Guard probes on the slice B and A tables (ADR-0055, ADR-0056). "PASS" means the guard fired (or, for an
//    expectSuccess probe, that the allowed write committed). API-path writes run as mth_app with every trigger on.
//    Fixture records are inserted by the superuser with session_replication_role = replica (the T-DG6-ARCH-01/02
//    harness, copied). All data is SYNTHETIC and approves nothing.
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
const DLV = "01990000-0000-7000-8000-0000000000d5";
const DLV2 = "01990000-0000-7000-8000-0000000000d6";
const EV_OK = "01990000-0000-7000-8000-0000000000e1"; // verified note
const EV_FILENAME = "01990000-0000-7000-8000-0000000000e2"; // file_reference (filename-only link)
const EV_UNVERIFIED = "01990000-0000-7000-8000-0000000000e3";
const KACT = (i: number) => `01990000-0000-7000-8000-0000000001${i.toString(16).padStart(2, "0")}`;
const T0 = "2026-10-26T10:00:00Z";
const ref = (name: string) => JSON.stringify({ provider: "env", name });
const FORM_V1 = "01920005-0200-7000-8000-000000000001";

async function main(): Promise<void> {
  const files = readdirSync(migrationsDir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  console.log(`migrations shipped: ${files.length} (${files[0]} .. ${files[files.length - 1]})`);
  const ids = files.map((f) => Number(f.slice(0, 4)));
  report("G00 slice B/A migrations 0104-0107 present directly above 0103 (D-196); nothing above 0107",
    [104, 105, 106, 107].every((n) => ids.includes(n)) && Math.max(...ids) === 107, `ids >= 98: ${ids.filter((n) => n >= 98).join(",")}`);

  await createDb("probe_fresh");
  const applied = await migrate(roleUrl("probe_fresh", "mth_owner"), { dir: migrationsDir });
  report("G01 fresh database: 0001..last apply", applied.length === files.length, `applied ${applied.length}: ${applied.slice(-5).join(", ")}`);

  const db = "probe_p5";
  await createDb(db);
  const p5Dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "p5-migrations-"));
  const p5Files = files.filter((f) => Number(f.slice(0, 4)) <= LAST_P5);
  for (const f of p5Files) cpSync(join(migrationsDir, f), join(p5Dir, f));
  const p5Applied = await migrate(roleUrl(db, "mth_owner"), { dir: p5Dir });
  {
    const c = await client(db);
    await seedP1(c);
    await c.query("BEGIN");
    await c.query(`SELECT p3_instantiate_transformation($1, $2, 'probe', 'cli')`, [TR, U1]);
    await c.query("COMMIT");
    await c.end();
  }
  await fixture(db, "kpi_definition", { id: KPI, organization_id: ORG, transformation_id: TR, name: "Synthetic KPI", unit_kind: "count", polarity: "higher_is_better", created_by: U1, updated_by: U1 });
  for (const [id, title] of [[DLV, "Synthetic CRM cut-over"], [DLV2, "Synthetic tower upgrade"]]) {
    await fixture(db, "deliverable", { id, organization_id: ORG, transformation_id: TR, initiative_id: uid(), title, created_by: U1, updated_by: U1 });
  }
  await fixture(db, "evidence", { id: EV_OK, organization_id: ORG, transformation_id: TR, kind: "note", title: "Synthetic go-live record", note_body: "Synthetic",
    owner_user_id: U1, review_status: "verified", accessibility_status: "accessible", reviewed_by: U2, reviewed_at: T0, created_by: U1, updated_by: U1 });
  await fixture(db, "evidence", { id: EV_FILENAME, organization_id: ORG, transformation_id: TR, kind: "file_reference", title: "Synthetic filename only", file_name: "golive.pdf",
    owner_user_id: U1, created_by: U1, updated_by: U1 });
  await fixture(db, "evidence", { id: EV_UNVERIFIED, organization_id: ORG, transformation_id: TR, kind: "note", title: "Synthetic unreviewed note", note_body: "Synthetic",
    owner_user_id: U1, created_by: U1, updated_by: U1 });
  for (let i = 1; i <= 9; i++) {
    const period = uid();
    await fixture(db, "kpi_actual", { id: KACT(i), organization_id: ORG, transformation_id: TR, kpi_definition_id: KPI, scope_kind: "transformation", scope_id: TR,
      reporting_period_id: period, period_start: `2026-0${i}-01`, period_end: `2026-0${i}-28`, period_label: `2026-0${i}`, status: "submitted", route: "review",
      submitted_by: U2, submitted_at: T0, created_by: U2, updated_by: U2 });
    await fixture(db, "kpi_actual_value", { id: uid(), organization_id: ORG, transformation_id: TR, kpi_actual_id: KACT(i), value_no: 1, kpi_version_id: uid(),
      value: `${i}00.5`, data_as_of: `2026-0${i}-28`, entered_by: U2, business_date: `2026-0${i}-28` });
  }
  {
    const c = await client(db);
    const n = (await c.query(`SELECT (SELECT count(*) FROM deliverable)::int AS d, (SELECT count(*) FROM evidence)::int AS e, (SELECT count(*) FROM kpi_actual_value)::int AS v`)).rows[0];
    report("G02 P5 database populated (0001-0097; a synthetic transformation instantiated by the DG3 function, a KPI, 2 deliverables, 3 evidence items, 9 KPI actual values)",
      p5Applied.length === p5Files.length && n.d === 2 && n.e === 3 && n.v === 9, `applied ${p5Applied.length}; ${JSON.stringify(n)}`);
    await c.end();
  }
  const before = await (async () => { const c = await client(db); const r = (await c.query(`SELECT md5(string_agg(to_jsonb(d)::text, '' ORDER BY id)) AS d FROM deliverable d`)).rows[0].d; await c.end(); return r; })();
  const onTop = await migrate(roleUrl(db, "mth_owner"), { dir: migrationsDir });
  {
    const c = await client(db);
    report("G03 P6 (0098..last, including slice B/A 0104-0107) over the P5 database apply", onTop.length === files.length - p5Files.length && onTop.join(",").includes("0107"), `applied ${onTop.length}: ${onTop.join(", ")}`);
    const r = (await c.query(`SELECT md5(string_agg(to_jsonb(d)::text, '' ORDER BY id)) AS d,
      (SELECT count(*) FROM connector)::int + (SELECT count(*) FROM integration_run)::int + (SELECT count(*) FROM import_batch)::int
      + (SELECT count(*) FROM webhook_endpoint)::int + (SELECT count(*) FROM outbound_write)::int + (SELECT count(*) FROM deliverable_external_change)::int AS n
      FROM deliverable d`)).rows[0];
    report("G04 the upgrade leaves existing rows as they were: the deliverables byte-identical (no external-change flag = not flagged); no connector, run, import, webhook, outbound write or confirmation row",
      r.d === before && r.n === 0, JSON.stringify(r));
    const fk = (await c.query(`SELECT count(*)::int AS n FROM pg_constraint WHERE conname IN ('service_identity_connector_fkey', 'integration_run_import_batch_fkey', 'connector_current_config_fkey')`)).rows[0].n;
    report("G05 the announced foreign keys exist (service_identity.connector_id -> connector, integration_run.import_batch_id -> import_batch, connector current config, deferred)", fk === 3, `found ${fk}`);
    await c.end();
  }

  const app = await client(db, "mth_app");
  const own = await client(db, "mth_owner");
  // ---------------------------------------------------------------------------------------------------- connectors
  const connector = (id: string, code: string, adapter = "test_adapter", target = "kpi_actual", o: Record<string, unknown> = {}) =>
    ({ id, organization_id: ORG, code, name_en: `Synthetic ${code}`, name_ar: `موصل ${code}`, adapter_kind: adapter, target_kind: target, config_version_no: 1, created_by: U1, updated_by: U1, ...o });
  const cfg = (connectorId: string, versionNo: number, o: Record<string, unknown> = {}) =>
    ({ id: uid(), organization_id: ORG, connector_id: connectorId, version_no: versionNo, source_system_id: "synthetic-kpi-feed", cadence: "daily",
      credential_refs: JSON.stringify({ api: JSON.parse(ref("TEST_FEED_TOKEN")) }), field_mappings: JSON.stringify([{ source: "KPI Code", target: "kpiCode" }, { source: "Value", target: "value" }]),
      target_transformation_id: TR, adapter_settings: JSON.stringify({ mode: "healthy" }), reason: "Synthetic: probe configuration", created_by: U1, ...o });
  const C1 = uid(), C2 = uid(), CW = uid(), CA = uid();
  await expectSuccess(app, "CN01 create a connector disabled at configuration version 1, with its configuration, audit and connector service identity, in one transaction", async () => {
    await ins(app, "connector", connector(C1, "test-feed"));
    await app.query(`INSERT INTO connector_config_version (${Object.keys(cfg(C1, 1)).join(", ")}) VALUES (${Object.keys(cfg(C1, 1)).map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(cfg(C1, 1)));
    await ins(app, "service_identity", { id: uid(), code: `connector:${C1}`, subject_kind: "connector", connector_id: C1, scope_level: "organization", organization_id: ORG,
      declared_permission_codes: ["transformation.read"], granted_permission_codes: ["transformation.read"], label_en: "Synthetic connector identity", label_ar: "هوية موصل", reason: "Synthetic: created with the connector", created_by: U1, updated_by: U1 });
    return "committed";
  });
  const insCfg = async (c: any, row: Record<string, unknown>) => c.query(`INSERT INTO connector_config_version (${Object.keys(row).join(", ")}) VALUES (${Object.keys(row).map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(row));
  await expectFailure(app, "CN02 a connector without its audit event fails at COMMIT", /connector_audit_required/, async () => {
    await app.query(`INSERT INTO connector (id, organization_id, code, name_en, name_ar, adapter_kind, target_kind, config_version_no, created_by, updated_by) VALUES ($1, $2, 'no-audit', 'x', 'x', 'test_adapter', 'kpi_actual', 1, $3, $3)`, [uid(), ORG, U1]);
    await insCfg(app, cfg((await app.query(`SELECT id FROM connector WHERE code = 'no-audit'`)).rows[0].id, 1));
  });
  await expectFailure(app, "CN03 a connector without configuration version 1 fails at COMMIT (deferred foreign key to its current configuration)", /connector_current_config_fkey/, async () => {
    await ins(app, "connector", connector(uid(), "no-config"));
  });
  await expectFailure(app, "CN04 a connector created enabled is refused", /connector_transition/, async () => {
    const id = uid(); await ins(app, "connector", connector(id, "born-enabled", "test_adapter", "kpi_actual", { status: "enabled" })); await insCfg(app, cfg(id, 1));
  });
  await expectFailure(app, "CN05 configuration versions are numbered without gaps (3 after 1 refused)", /connector_config_version_sequence/, async () => { await insCfg(app, cfg(C1, 3)); });
  await expectFailure(app, "CN06 a credential reference carrying a value is refused (references only)", /connector_config_version_credential_refs/, async () => {
    await insCfg(app, cfg(C1, 2, { credential_refs: JSON.stringify({ api: { provider: "env", name: "X", value: "s3cr3t" } }) }));
  });
  await expectFailure(app, "CN07 adapter settings with a secret-like key are refused", /connector_config_version_no_secret_settings/, async () => {
    await insCfg(app, cfg(C1, 2, { adapter_settings: JSON.stringify({ mode: "healthy", password: "x" }) }));
  });
  await expectFailure(app, "CN08 a test adapter needs mode healthy, failing or stopped", /connector_config_version_adapter_shape/, async () => {
    await insCfg(app, cfg(C1, 2, { adapter_settings: JSON.stringify({ mode: "flaky" }) }));
  });
  await expectFailure(app, "CN09 field mappings naming one target twice are refused", /connector_config_version_field_mappings/, async () => {
    await insCfg(app, cfg(C1, 2, { field_mappings: JSON.stringify([{ source: "A", target: "value" }, { source: "B", target: "value" }]) }));
  });
  await expectFailure(app, "CN10 a configuration version is append-only (UPDATE refused)", /append-only|42501/, async () => {
    await app.query(`UPDATE connector_config_version SET reason = 'changed' WHERE connector_id = $1`, [C1]);
  });
  await expectSuccess(app, "CN11 configuration version 2 (failing mode) and the connector moved to it and enabled, version 2, audited", async () => {
    await insCfg(app, cfg(C1, 2, { adapter_settings: JSON.stringify({ mode: "failing" }), outbound_actions: ["deliverable_status_push"] }));
    await updx(app, "connector", C1, { config_version_no: 2, status: "enabled", updated_by: U1 });
    return "committed";
  });
  await expectFailure(app, "CN12 a connector update that does not step the version by 1 is refused", /connector_version_step/, async () => {
    await updx(app, "connector", C1, { status: "disabled", status_reason: "Synthetic pause" }, { step: 2 });
  });
  await expectFailure(app, "CN13 the code and adapter kind never change", /connector_identity_fixed/, async () => { await updx(app, "connector", C1, { adapter_kind: "webhook" }); });
  await expectFailure(app, "CN14 connector_change is append-only (UPDATE and DELETE refused)", /append-only|42501/, async () => { await own.query(`DELETE FROM connector_change WHERE connector_id = $1`, [C1]); });
  await expectFailure(app, "CN15 the application cannot write connector_change directly", /permission denied/, async () => {
    await app.query(`INSERT INTO connector_change (id, connector_id, record_version, status, config_version_no, name_en, name_ar, changed_by, changed_at) VALUES ($1, $2, 9, 'enabled', 1, 'x', 'x', $3, now())`, [uid(), C1, U1]);
  });
  await expectFailure(app, "CN16 a service identity naming no existing connector is refused (foreign key from 0101, added here)", /service_identity_connector_fkey/, async () => {
    const x = uid();
    await ins(app, "service_identity", { id: uid(), code: `connector:${x}`, subject_kind: "connector", connector_id: x, scope_level: "organization", organization_id: ORG,
      declared_permission_codes: [], granted_permission_codes: [], label_en: "x", label_ar: "x", reason: "Synthetic", created_by: U1, updated_by: U1 });
  });
  const SI1 = (await app.query(`SELECT id FROM service_identity WHERE connector_id = $1`, [C1])).rows[0].id;

  // ---------------------------------------------------------------------------------------------------- runs
  const run = (o: Record<string, unknown> = {}) => ({ id: uid(), organization_id: ORG, connector_id: C1, config_version_no: 2, trigger_kind: "manual", idempotency_key: `manual:${uid()}`,
    requested_by: U1, service_identity_id: SI1, queued_at: T0, ...o });
  const R1 = uid();
  await expectSuccess(app, "IR01 a manual run is queued as the connector's own service identity", async () => { await ins(app, "integration_run", run({ id: R1, idempotency_key: "manual:probe-0001" })); return "committed"; });
  await expectFailure(app, "IR02 a second active run of the same connector is refused (one active run per connector)", /integration_run_one_active/, async () => { await ins(app, "integration_run", run()); });
  await expectFailure(app, "IR03 a replayed idempotency key is refused (exactly once)", /integration_run_idempotency_key/, async () => {
    await own.query("SELECT 1"); await ins(app, "integration_run", run({ idempotency_key: "manual:probe-0001", connector_id: C1 }));
  });
  await expectFailure(app, "IR04 queued -> succeeded is refused (it must run first)", /integration_run_transition|integration_run_status_shape/, async () => {
    await updx(app, "integration_run", R1, { status: "succeeded", finished_at: T0 });
  });
  await expectFailure(app, "IR05 a run without its audit event fails at COMMIT", /integration_run_audit_required/, async () => {
    await updx(app, "integration_run", R1, { status: "running", started_at: T0 }, { audit: false });
  });
  await expectSuccess(app, "IR06 queued -> running -> failed with an actionable error code and Unknown (NULL) counts", async () => {
    await updx(app, "integration_run", R1, { status: "running", started_at: T0 });
    await updx(app, "integration_run", R1, { status: "failed", finished_at: "2026-10-26T10:01:00Z", error_code: "connector.source_unavailable", error_message: "Synthetic: the test adapter is in failing mode" });
    return "committed";
  });
  await expectFailure(app, "IR07 a finished run never changes", /integration_run_final/, async () => { await updx(app, "integration_run", R1, { error_message: "edited" }); });
  await expectFailure(app, "IR08 a retry with the wrong attempt number is refused", /integration_run_retry_chain/, async () => {
    await ins(app, "integration_run", run({ trigger_kind: "retry", retry_of_run_id: R1, attempt_no: 3, requested_by: null }));
  });
  const R2 = uid();
  await expectSuccess(app, "IR09 a retry of the failed run as attempt 2 (retry history is the chain)", async () => {
    await ins(app, "integration_run", run({ id: R2, trigger_kind: "retry", retry_of_run_id: R1, attempt_no: 2, requested_by: null }));
    return "committed";
  });
  await expectFailure(app, "IR10 a failed run is retried at most once (UNIQUE retry_of_run_id)", /integration_run_one_retry_key/, async () => {
    await own.query("SELECT 1");
    await updx(app, "integration_run", R2, { status: "cancelled" });
    await ins(app, "integration_run", run({ trigger_kind: "retry", retry_of_run_id: R1, attempt_no: 2, requested_by: null }));
  });
  await expectFailure(app, "IR11 a succeeded run needs every count (read, staged, rejected, duplicates, errors)", /integration_run_success_counts/, async () => {
    await updx(app, "integration_run", R2, { status: "running", started_at: T0 });
    await updx(app, "integration_run", R2, { status: "succeeded", finished_at: T0, rows_read: 10, rows_staged: 10 });
  });
  await expectFailure(app, "IR12 committed + rejected + duplicates never exceed staged", /integration_run_count_order/, async () => {
    await updx(app, "integration_run", R2, { status: "running", started_at: T0 });
    await updx(app, "integration_run", R2, { status: "succeeded", finished_at: T0, rows_read: 10, rows_staged: 10, rows_committed: 8, rows_rejected: 2, rows_duplicate: 1, error_count: 2 });
  });
  await expectFailure(app, "IR13 a matched reconciliation needs the source row count", /integration_run_reconciliation_shape/, async () => {
    await updx(app, "integration_run", R2, { status: "running", started_at: T0 });
    await updx(app, "integration_run", R2, { status: "succeeded", finished_at: T0, rows_read: 10, rows_staged: 10, rows_committed: 8, rows_rejected: 1, rows_duplicate: 1, error_count: 1, reconciliation_status: "matched" });
  });
  await expectSuccess(app, "IR14 the retry succeeds with counts 10 read / 10 staged / 8 committed / 1 rejected / 1 duplicate / 1 error and a matched reconciliation (last success)", async () => {
    await updx(app, "integration_run", R2, { status: "running", started_at: T0 });
    await updx(app, "integration_run", R2, { status: "succeeded", finished_at: "2026-10-26T10:05:00Z", rows_read: 10, rows_staged: 10, rows_committed: 8, rows_rejected: 1, rows_duplicate: 1, error_count: 1,
      reconciliation_status: "matched", source_row_count: 10, source_control_total: "1000.500000", staged_control_total: "1000.500000" });
    return "committed";
  });
  await expectFailure(app, "IR15 integration_run_event is append-only", /append-only|42501/, async () => { await own.query(`UPDATE integration_run_event SET status = 'x' WHERE integration_run_id = $1`, [R1]); });
  {
    const h = (await app.query(`SELECT string_agg(status, '>' ORDER BY record_version) AS s FROM integration_run_event WHERE integration_run_id = $1`, [R1])).rows[0].s;
    report("IR16 the run's history is trigger-written (queued>running>failed)", h === "queued>running>failed", h);
  }
  // A second connector to show the service-identity binding.
  await expectSuccess(app, "IR17 a second connector (webhook, KPI target) with its identity", async () => {
    await ins(app, "connector", connector(CW, "webhook-feed", "webhook")); await insCfg(app, cfg(CW, 1, { adapter_settings: JSON.stringify({}), credential_refs: JSON.stringify({}) }));
    await ins(app, "service_identity", { id: uid(), code: `connector:${CW}`, subject_kind: "connector", connector_id: CW, scope_level: "organization", organization_id: ORG,
      declared_permission_codes: ["transformation.read"], granted_permission_codes: ["transformation.read"], label_en: "x", label_ar: "x", reason: "Synthetic: webhook connector", created_by: U1, updated_by: U1 });
    return "committed";
  });
  await expectFailure(app, "IR18 a run cannot act as another connector's service identity", /integration_run_service_identity/, async () => {
    await ins(app, "integration_run", run({ connector_id: CW, config_version_no: 1, service_identity_id: SI1 }));
  });

  // ---------------------------------------------------------------------------------------------------- outbound writes
  const ow = (o: Record<string, unknown> = {}) => ({ id: uid(), organization_id: ORG, transformation_id: TR, connector_id: C1, config_version_no: 2, action_code: "deliverable_status_push",
    deliverable_id: DLV, idempotency_key: "push:probe-0001", payload: JSON.stringify({ status: "live" }), payload_sha256: "a".repeat(64), requested_by: U1, service_identity_id: SI1, created_by: U1, updated_by: U1, ...o });
  await expectFailure(app, "OW01 a write on a connector whose configuration does not allow the action is refused", /outbound_write_action_allowed/, async () => {
    await ins(app, "outbound_write", ow({ connector_id: CW, config_version_no: 1, service_identity_id: (await app.query(`SELECT id FROM service_identity WHERE connector_id = $1`, [CW])).rows[0].id }));
  });
  const W1 = uid();
  await expectSuccess(app, "OW02 an allowed write is created 'requested' with no attempt", async () => { await ins(app, "outbound_write", ow({ id: W1 })); return "committed"; });
  await expectFailure(app, "OW03 the same idempotency key on the same connector is refused (one downstream effect)", /outbound_write_idempotency_key/, async () => { await ins(app, "outbound_write", ow()); });
  await expectFailure(app, "OW04 'confirmed' without the downstream reference of a confirmed response is refused", /outbound_write_confirmed_shape/, async () => {
    await updx(app, "outbound_write", W1, { status: "confirmed", confirmed_at: T0, attempt_count: 1, last_attempt_at: T0 });
  });
  await expectSuccess(app, "OW05 dispatched with no confirmed response: requested -> pending_confirmation (attempt 1)", async () => {
    await updx(app, "outbound_write", W1, { status: "pending_confirmation", attempt_count: 1, last_attempt_at: T0 }); return "committed";
  });
  await expectFailure(app, "OW06 pending_confirmation -> requested is refused", /outbound_write_transition/, async () => { await updx(app, "outbound_write", W1, { status: "requested" }); });
  await expectFailure(app, "OW07 the payload never changes", /outbound_write_identity_fixed/, async () => { await updx(app, "outbound_write", W1, { payload: JSON.stringify({ status: "other" }) }); });
  await expectFailure(app, "OW08 an attempt count jumping by 2 is refused", /outbound_write_attempt_step/, async () => { await updx(app, "outbound_write", W1, { attempt_count: 3 }); });
  await expectSuccess(app, "OW09 a confirmed response with its reference: pending_confirmation -> confirmed", async () => {
    await updx(app, "outbound_write", W1, { status: "confirmed", confirmed_at: "2026-10-26T10:10:00Z", external_reference: "EXT-TRACKER-42" }); return "committed";
  });
  await expectFailure(app, "OW10 a confirmed write never changes", /outbound_write_final/, async () => { await updx(app, "outbound_write", W1, { status: "failed", failure_code: "x.y" }); });
  await expectFailure(app, "OW11 a write without its audit event fails at COMMIT", /outbound_write_audit_required/, async () => {
    await ins(app, "outbound_write", ow({ idempotency_key: "push:probe-0002" }), false);
  });

  // ---------------------------------------------------------------------------------------------------- external change (REQ-S01-005)
  const X1 = uid(), X2 = uid();
  const xc = (id: string, d: string) => ({ id, organization_id: ORG, transformation_id: TR, deliverable_id: d, change_type: "customer_system", description: "Synthetic CRM cut-over", created_by: U1, updated_by: U1 });
  await expectFailure(app, "DX01 a flag created already confirmed is refused", /deliverable_external_change_transition|deliverable_external_change_source_shape/, async () => {
    await ins(app, "deliverable_external_change", { ...xc(uid(), DLV), confirmation_status: "confirmed" });
  });
  await expectSuccess(app, "DX02 flag both deliverables as external changes: Unconfirmed", async () => { await ins(app, "deliverable_external_change", xc(X1, DLV)); await ins(app, "deliverable_external_change", xc(X2, DLV2)); return "committed"; });
  await expectFailure(app, "DX03 one flag per deliverable", /deliverable_external_change_deliverable_key/, async () => { await ins(app, "deliverable_external_change", xc(uid(), DLV)); });
  {
    const c = await client(db, null);
    await c.query("SET session_replication_role = replica");
    await c.query(`UPDATE deliverable SET acceptance_status = 'submitted', submitted_by = $2, submitted_at = now(), version = version + 1 WHERE id = $1`, [DLV, U2]);
    await c.end();
    const s = (await app.query(`SELECT confirmation_status FROM deliverable_external_change WHERE id = $1`, [X1])).rows[0].confirmation_status;
    report("DX04 a change of the deliverable itself (acceptance submitted, superuser fixture) leaves the confirmation Unconfirmed (no DG3 path writes it)", s === "unconfirmed", s);
  }
  const confirmEv = (ev: string) => ({ confirmation_status: "confirmed", confirmation_source: "reviewed_evidence", evidence_id: ev, confirmed_at: T0, confirmed_by: U3 });
  await expectFailure(app, "DX05 a filename-only link (file_reference) never confirms", /deliverable_external_change_evidence_verified/, async () => { await updx(app, "deliverable_external_change", X1, confirmEv(EV_FILENAME)); });
  await expectFailure(app, "DX06 unreviewed evidence never confirms", /deliverable_external_change_evidence_verified/, async () => { await updx(app, "deliverable_external_change", X1, confirmEv(EV_UNVERIFIED)); });
  await expectFailure(app, "DX07 a confirmation without its audit event fails at COMMIT", /deliverable_external_change_audit_required/, async () => {
    await updx(app, "deliverable_external_change", X1, confirmEv(EV_OK), { audit: false });
  });
  await expectSuccess(app, "DX08 reviewed (verified) evidence confirms and records its source", async () => { await updx(app, "deliverable_external_change", X1, confirmEv(EV_OK)); return "committed"; });
  await expectFailure(app, "DX09 a confirmed external change never changes", /deliverable_external_change_final/, async () => { await updx(app, "deliverable_external_change", X1, { confirmation_note: "edited" }); });
  const W2 = uid();
  await expectSuccess(app, "DX10 a second write for deliverable 2, left pending confirmation", async () => {
    await ins(app, "outbound_write", ow({ id: W2, deliverable_id: DLV2, idempotency_key: "push:probe-0003" }));
    await updx(app, "outbound_write", W2, { status: "pending_confirmation", attempt_count: 1, last_attempt_at: T0 }); return "committed";
  });
  const conn = (w: string, refx: string, at: string) => ({ confirmation_status: "confirmed", confirmation_source: "connector_result", outbound_write_id: w, connector_id: C1,
    source_system_id: "synthetic-kpi-feed", source_reference: refx, source_confirmed_at: at, service_identity_id: SI1, confirmed_at: at, updated_by: null });
  await expectFailure(app, "DX11 a write still pending confirmation never confirms", /deliverable_external_change_connector_confirmed/, async () => { await updx(app, "deliverable_external_change", X2, conn(W2, "EXT-X", T0)); });
  await expectFailure(app, "DX12 a confirmed write of ANOTHER deliverable never confirms", /deliverable_external_change_connector_confirmed/, async () => {
    await updx(app, "deliverable_external_change", X2, conn(W1, "EXT-TRACKER-42", "2026-10-26T10:10:00Z"));
  });
  await expectSuccess(app, "DX13 a confirmed test-adapter result for this deliverable confirms, with connector, source system id, reference and time", async () => {
    await updx(app, "outbound_write", W2, { status: "confirmed", confirmed_at: "2026-10-26T10:20:00Z", external_reference: "EXT-TRACKER-43" });
    await updx(app, "deliverable_external_change", X2, conn(W2, "EXT-TRACKER-43", "2026-10-26T10:20:00Z"));
    return "committed";
  });
  await expectFailure(app, "DX14 the confirmation history is append-only", /append-only|42501/, async () => { await own.query(`DELETE FROM deliverable_external_change_event WHERE deliverable_external_change_id = $1`, [X1]); });

  // ---------------------------------------------------------------------------------------------------- webhooks
  const wh = (o: Record<string, unknown> = {}) => ({ id: uid(), organization_id: ORG, connector_id: CW, endpoint_key: "k".repeat(40), label: "Synthetic KPI webhook",
    signing_secret_ref: ref("WEBHOOK_SECRET_V1"), created_by: U1, updated_by: U1, ...o });
  await expectFailure(app, "WH01 an endpoint on a non-webhook connector is refused", /webhook_endpoint_connector_kind/, async () => { await ins(app, "webhook_endpoint", wh({ connector_id: C1, endpoint_key: "a".repeat(40) })); });
  await expectFailure(app, "WH02 an endpoint whose secret is not a SecretRef is refused", /webhook_endpoint_secret_ref/, async () => {
    await ins(app, "webhook_endpoint", wh({ endpoint_key: "b".repeat(40), signing_secret_ref: JSON.stringify({ provider: "env", name: "X", value: "plain" }) }));
  });
  const WH1 = uid();
  await expectSuccess(app, "WH03 an active endpoint with one secret reference", async () => { await ins(app, "webhook_endpoint", wh({ id: WH1 })); return "committed"; });
  await expectFailure(app, "WH04 a rotation keeping the old reference for more than 7 days is refused", /webhook_endpoint_rotation/, async () => {
    await updx(app, "webhook_endpoint", WH1, { signing_secret_ref: ref("WEBHOOK_SECRET_V2"), previous_secret_ref: ref("WEBHOOK_SECRET_V1"), secret_rotated_at: T0, previous_valid_until: "2026-11-10T10:00:00Z" });
  });
  await expectSuccess(app, "WH05 a rotation to a new reference, the old one valid for 24 h", async () => {
    await updx(app, "webhook_endpoint", WH1, { signing_secret_ref: ref("WEBHOOK_SECRET_V2"), previous_secret_ref: ref("WEBHOOK_SECRET_V1"), secret_rotated_at: T0, previous_valid_until: "2026-10-27T10:00:00Z" });
    return "committed";
  });
  const rc = (o: Record<string, unknown> = {}) => ({ id: uid(), organization_id: ORG, webhook_endpoint_id: WH1, delivery_id: "dlv-0000001", signed_at: T0, received_at: "2026-10-26T10:01:00Z",
    secret_slot: "current", body_sha256: "b".repeat(64), body_bytes: 512, item_count: 10, ...o });
  const RC1 = uid();
  const insRc = async (row: Record<string, unknown>) => app.query(`INSERT INTO webhook_receipt (${Object.keys(row).join(", ")}) VALUES (${Object.keys(row).map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(row));
  await expectSuccess(app, "WH06 an accepted delivery inside the window is recorded", async () => { await insRc(rc({ id: RC1 })); return "committed"; });
  await expectFailure(app, "WH07 a replayed delivery id is refused (replay and idempotency backstop)", /webhook_receipt_delivery_key/, async () => { await insRc(rc()); });
  await expectFailure(app, "WH08 a delivery signed outside the endpoint's window (6 min) is refused", /webhook_receipt_accepted_only|webhook_receipt_window/, async () => {
    await insRc(rc({ delivery_id: "dlv-0000002", received_at: "2026-10-26T10:06:00Z" }));
  });
  await expectFailure(app, "WH09 the previous secret after its validity is refused", /webhook_receipt_accepted_only/, async () => {
    await insRc(rc({ delivery_id: "dlv-0000003", signed_at: "2026-10-27T11:00:00Z", received_at: "2026-10-27T11:00:30Z", secret_slot: "previous" }));
  });
  await expectFailure(app, "WH10 a receipt is append-only", /append-only|42501/, async () => { await app.query(`UPDATE webhook_receipt SET item_count = 1 WHERE id = $1`, [RC1]); });
  // ---------------------------------------------------------------------------------------------------- imports (the 8 / 1 / 1 case)
  const batch = (o: Record<string, unknown> = {}) => ({ id: uid(), organization_id: ORG, transformation_id: TR, target_kind: "kpi_actual", template_version: "kpi_actual.v1",
    form_schema_version_id: FORM_V1, source_kind: "csv_upload", file_name: "kpi-actuals.csv", media_type: "text/csv", byte_size: 900, content_sha256: "c".repeat(64), created_by: U2, updated_by: U2, ...o });
  await expectFailure(app, "IM01 a batch that does not pin the transformation's form schema version is refused", /import_batch_form_schema_pinned|foreign key/, async () => {
    const other = (await app.query(`SELECT id FROM methodology_version WHERE id <> $1 LIMIT 1`, [FORM_V1])).rows[0]?.id ?? uid();
    await ins(app, "import_batch", batch({ form_schema_version_id: other }));
  });
  await expectFailure(app, "IM02 a CSV upload with the XLSX media type is refused", /import_batch_source_shape/, async () => {
    await ins(app, "import_batch", batch({ media_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  });
  await expectFailure(app, "IM03 a file over 10 MiB is refused", /import_batch_byte_size_check|byte_size/, async () => { await ins(app, "import_batch", batch({ byte_size: 10485761 })); });
  const B1 = uid();
  await expectSuccess(app, "IM04 a CSV batch is created staging, pinned to the form schema version", async () => { await ins(app, "import_batch", batch({ id: B1 })); return "committed"; });
  const row = (n: number, o: Record<string, unknown> = {}) => ({ id: uid(), organization_id: ORG, transformation_id: TR, import_batch_id: B1, row_number: n, source_record_id: `SRC-${n}`,
    raw: JSON.stringify({ "KPI Code": "KPI-001", Period: `2026-0${n - 1}`, Value: `${n - 1}00.5` }), normalized: JSON.stringify({ value: `${n - 1}00.500000` }), duplicate_key: `kpi:${KPI}:transformation:${TR}:p${n}`,
    validation_status: "valid", ...o });
  const insRow = async (r: Record<string, unknown>) => app.query(`INSERT INTO import_row (${Object.keys(r).join(", ")}) VALUES (${Object.keys(r).map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(r));
  const rowIds: string[] = [];
  await expectSuccess(app, "IM05 stage 10 rows: 8 valid, 1 invalid (row-level reason), 1 in-batch duplicate pointing at its first row", async () => {
    for (let n = 2; n <= 9; n++) { const r = row(n); rowIds.push(r.id); await insRow(r); }
    await insRow(row(10, { normalized: null, duplicate_key: null, validation_status: "invalid", raw: JSON.stringify({ "KPI Code": "KPI-001", Period: "2026-09", Value: "12,5" }),
      reasons: JSON.stringify([{ code: "import.row.value_not_decimal", field: "Value", params: { value: "12,5" } }]) }));
    await insRow(row(11, { normalized: null, duplicate_key: `kpi:${KPI}:transformation:${TR}:p2`, validation_status: "duplicate_in_batch", duplicate_of_row_id: rowIds[0],
      reasons: JSON.stringify([{ code: "import.row.duplicate_in_batch", field: null, params: { firstRow: 2 } }]) }));
    return "committed";
  });
  await expectFailure(app, "IM06 a second VALID row with the same duplicate key is refused (in-batch duplicate invariant)", /import_row_one_valid_per_key/, async () => {
    await insRow(row(12, { duplicate_key: `kpi:${KPI}:transformation:${TR}:p2` }));
  });
  await expectFailure(app, "IM07 a raw cell stored as a number (a spreadsheet double) is refused", /import_row_raw/, async () => { await insRow(row(13, { raw: JSON.stringify({ Value: 12.5 }) })); });
  await expectFailure(app, "IM08 a valid row with a reason, or an invalid row without one, is refused", /import_row_valid_shape/, async () => {
    await insRow(row(14, { reasons: JSON.stringify([{ code: "import.row.value_not_decimal" }]) }));
  });
  await expectFailure(app, "IM09 a reason code outside import.row.* is refused", /import_row_reasons/, async () => {
    await insRow(row(15, { normalized: null, duplicate_key: null, validation_status: "invalid", reasons: JSON.stringify([{ code: "something.else" }]) }));
  });
  await expectFailure(app, "IM10 staged counts that do not add up to the rows are refused", /import_batch_counts|import_batch_counts_match_rows/, async () => {
    await updx(app, "import_batch", B1, { status: "staged", rows_total: 9, rows_valid: 7, rows_invalid: 1, rows_duplicate: 1 });
  });
  await expectSuccess(app, "IM11 the batch is staged: total 10 = 8 valid + 1 invalid + 1 duplicate", async () => {
    await updx(app, "import_batch", B1, { status: "staged", rows_total: 10, rows_valid: 8, rows_invalid: 1, rows_duplicate: 1, updated_by: U2 }); return "committed";
  });
  await expectFailure(app, "IM12 no row is added after staging", /import_row_batch_staging/, async () => { await insRow(row(16)); });
  await expectFailure(app, "IM13 a row is committed only with its lineage record", /import_row_lineage_required/, async () => {
    await app.query(`UPDATE import_row SET commit_status = 'committed' WHERE id = $1`, [rowIds[0]]);
  });
  await expectFailure(app, "IM14 a staged row's values never change (column grant)", /permission denied/, async () => {
    await app.query(`UPDATE import_row SET raw = '{}'::jsonb WHERE id = $1`, [rowIds[0]]);
  });
  const lin = (rowId: string, i: number, o: Record<string, unknown> = {}) => ({ id: uid(), organization_id: ORG, transformation_id: TR, import_batch_id: B1, import_row_id: rowId,
    target_record_type: "kpi_actual", target_record_id: KACT(i), target_value_no: 1, committed_at: "2026-10-26T11:00:00Z", ...o });
  const insLin = async (r: Record<string, unknown>) => app.query(`INSERT INTO import_row_commit (${Object.keys(r).join(", ")}) VALUES (${Object.keys(r).map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(r));
  await expectFailure(app, "IM15 lineage for the invalid row is refused (only valid rows commit)", /import_row_commit_valid_only/, async () => {
    const inv = (await app.query(`SELECT id FROM import_row WHERE import_batch_id = $1 AND validation_status = 'invalid'`, [B1])).rows[0].id;
    await insLin(lin(inv, 9));
  });
  await expectFailure(app, "IM16 lineage naming a KPI actual value that does not exist is refused", /import_row_commit_target_exists/, async () => { await insLin(lin(rowIds[0], 1, { target_value_no: 7 })); });
  await expectFailure(app, "IM17 a commit whose count differs from the committed rows is refused", /import_batch_counts_match_rows/, async () => {
    await insLin(lin(rowIds[0], 1)); await app.query(`UPDATE import_row SET commit_status = 'committed' WHERE id = $1`, [rowIds[0]]);
    await updx(app, "import_batch", B1, { status: "committed", rows_committed: 8, committed_at: "2026-10-26T11:00:00Z", committed_by: U2 });
  });
  await expectSuccess(app, "IM18 commit: 8 lineage records, 8 rows committed, 2 not committed, the batch committed with 8 (lineage to batch and source row)", async () => {
    for (let k = 0; k < 8; k++) { await insLin(lin(rowIds[k], k + 1)); await app.query(`UPDATE import_row SET commit_status = 'committed', updated_at = now() WHERE id = $1`, [rowIds[k]]); }
    await app.query(`UPDATE import_row SET commit_status = 'not_committed', updated_at = now() WHERE import_batch_id = $1 AND commit_status = 'pending'`, [B1]);
    await updx(app, "import_batch", B1, { status: "committed", rows_committed: 8, committed_at: "2026-10-26T11:00:00Z", committed_by: U2 });
    return "committed";
  });
  {
    const r = (await app.query(`SELECT count(*)::int AS n, count(DISTINCT l.target_record_id)::int AS t, min(r.source_record_id) AS s FROM import_row_commit l JOIN import_row r ON r.id = l.import_row_id WHERE l.import_batch_id = $1`, [B1])).rows[0];
    report("IM19 lineage: 8 committed rows, each to its own KPI actual, each with its source row id", r.n === 8 && r.t === 8 && r.s === "SRC-2", JSON.stringify(r));
  }
  await expectFailure(app, "IM20 a committed batch never changes", /import_batch_final/, async () => { await updx(app, "import_batch", B1, { status: "cancelled", cancelled_at: T0, cancel_reason: "late" }); });
  await expectFailure(app, "IM21 staged rows are never deleted", /never deleted|42501/, async () => { await own.query(`DELETE FROM import_row WHERE import_batch_id = $1`, [B1]); });
  await expectFailure(app, "IM22 lineage is append-only", /append-only|42501/, async () => { await own.query(`UPDATE import_row_commit SET target_value_no = 2 WHERE import_batch_id = $1`, [B1]); });
  await expectFailure(app, "IM23 a batch without its audit event fails at COMMIT", /import_batch_audit_required/, async () => { await ins(app, "import_batch", batch(), false); });
  await expectFailure(app, "IM24 a webhook batch needs its receipt, its connector and the JSON media type", /import_batch_source_shape/, async () => {
    await ins(app, "import_batch", batch({ source_kind: "webhook", file_name: null, byte_size: null, content_sha256: null, media_type: "application/json", created_by: null, connector_id: CW }));
  });
  await expectSuccess(app, "IM25 a webhook batch from the accepted receipt, auto-committed on behalf of a named user", async () => {
    await ins(app, "import_batch", batch({ source_kind: "webhook", file_name: null, byte_size: null, content_sha256: null, media_type: "application/json", created_by: null, updated_by: null,
      connector_id: CW, webhook_receipt_id: RC1, commit_mode: "auto", on_behalf_of_user_id: U2 }));
    return "committed";
  });
  await expectFailure(app, "IM26 one batch per webhook receipt", /import_batch_webhook_receipt_key/, async () => {
    await ins(app, "import_batch", batch({ source_kind: "webhook", file_name: null, byte_size: null, content_sha256: null, media_type: "application/json", created_by: null, updated_by: null,
      connector_id: CW, webhook_receipt_id: RC1 }));
  });
  await expectFailure(app, "IM27 history of a batch is append-only", /append-only|42501/, async () => { await own.query(`DELETE FROM import_batch_event WHERE import_batch_id = $1`, [B1]); });
  await expectSuccess(app, "WH11 an endpoint is disabled with a reason", async () => {
    await updx(app, "webhook_endpoint", WH1, { status: "disabled", disabled_at: T0, disabled_by: U1, disable_reason: "Synthetic: source retired" }); return "committed";
  });
  await expectFailure(app, "WH12 a disabled endpoint accepts no delivery", /webhook_receipt_accepted_only/, async () => { await insRc(rc({ delivery_id: "dlv-0000009" })); });
  await expectFailure(app, "WH13 a disabled endpoint never changes", /webhook_endpoint_final/, async () => { await updx(app, "webhook_endpoint", WH1, { label: "x" }); });

  // ---------------------------------------------------------------------------------------------------- permissions
  {
    const rows = (await app.query(`SELECT p.code, p.category, coalesce(string_agg(r.code, ',' ORDER BY r.code), '') AS roles FROM permission p
      LEFT JOIN role_permission rp ON rp.permission_code = p.code LEFT JOIN role r ON r.id = rp.role_id
      WHERE p.code IN ('connector.read','connector.configure','connector.run','webhook.configure','import.read','import.create','import.commit','outbound_write.read','outbound_write.execute','external_change.flag','external_change.confirm')
      GROUP BY p.code, p.category ORDER BY p.code`)).rows;
    console.log("        0107 seed: " + rows.map((r: any) => `${r.code}(${r.category})=${r.roles}`).join("; "));
    report("PM01 0107 seeds 11 codes, none business_approval or finance_validation", rows.length === 11 && rows.every((r: any) => ["read", "write", "configure"].includes(r.category)), `${rows.length} codes`);
    const aud = rows.filter((r: any) => r.roles.split(",").includes("AUD"));
    report("PM02 AUD gets read codes only (connector.read, import.read, outbound_write.read)", aud.map((r: any) => r.code).join(",") === "connector.read,import.read,outbound_write.read" && aud.every((r: any) => r.category === "read"), aud.map((r: any) => r.code).join(","));
    const tech = rows.filter((r: any) => r.roles.split(",").includes("ADM_TECH")).map((r: any) => r.code).join(",");
    report("PM03 ADM_TECH gets connector and webhook rights only (no import, outbound-write or external-change right)", tech === "connector.configure,connector.read,connector.run,webhook.configure", tech);
    const exec = rows.find((r: any) => r.code === "outbound_write.execute")?.roles;
    report("PM04 outbound_write.execute is held by exactly one role by default (TD)", exec === "TD", exec);
  }
  await expectFailure(own, "PM05 the technical-admin trigger still refuses a business-approval code for ADM_TECH (REQ-S10-003)", /technical|approval|check_violation|P0001/i, async () => {
    const code = (await own.query(`SELECT code FROM permission WHERE category = 'business_approval' LIMIT 1`)).rows[0].code;
    await own.query(`INSERT INTO role_permission (role_id, permission_code) VALUES ('01920000-0000-7000-8000-00000000000c', $1)`, [code]);
  });

  await app.end();
  await own.end();
  console.log(`\n${total - failures}/${total} PASS${failures ? `, ${failures} FAIL` : ""}`);
  process.exitCode = failures ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 2;
});
