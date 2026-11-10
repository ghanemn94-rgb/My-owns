// T-DG6-ARCH-01 migration and guard probe (solution-architect). Run against a DISPOSABLE cluster only:
//   QA_PG_PORT=<port in 23700-23749> MTH_PORT_POOL=<rest of 23700-23749> tests/qa/support/with-pg.sh \
//     node --conditions=@mth/source docs/delivery/handbacks/DG6/T-DG6-ARCH-01-evidence/probe.ts
// 1. Fresh database: all migrations 0001..last.
// 2. P5-populated database: 0001..0097, a synthetic transformation instantiated by the DG3 function, a benefit, a
//    business case, an evidence note and file, an inbox notification; then 0098..last on top.
// 3. Guard probes on the slice E and F tables (ADR-0051, ADR-0052) in the populated database. "PASS" means the guard
//    fired (or, for an expectSuccess probe, that the allowed write committed). API-path writes run as mth_app with every
//    trigger on. The fixture records (benefit, business case, evidence, notification) are inserted by the superuser
//    with session_replication_role = replica, as the T-DG5-ARCH-06 probe did; the probes themselves run with every
//    trigger on. Harness helpers are copied from the T-DG5-ARCH-06 probe. All data is SYNTHETIC and approves nothing.
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

const BEN = "01990000-0000-7000-8000-0000000000b1";
const BEN2 = "01990000-0000-7000-8000-0000000000b2";
const BC = "01990000-0000-7000-8000-0000000000c1";
const EV = "01990000-0000-7000-8000-0000000000e1";
const EVF = "01990000-0000-7000-8000-0000000000e2";
const EVC = "01990000-0000-7000-8000-0000000000e3";
const NOTE1 = "01990000-0000-7000-8000-0000000000a1";
const NOTE2 = "01990000-0000-7000-8000-0000000000a2";
const TOKEN = "A".repeat(42) + "b";
const TOKEN2 = "c".repeat(43);
const sens = (o: Record<string, unknown> = {}) => ({ id: uid(), organization_id: ORG, transformation_id: TR, record_type: "benefit", record_id: BEN,
  is_sensitive: true, reason: "Synthetic: commercially sensitive", created_by: U1, updated_by: U1, ...o });
const grant = (o: Record<string, unknown> = {}) => ({ id: uid(), organization_id: ORG, transformation_id: TR, record_type: "benefit", record_id: BEN,
  grantee_user_id: U2, reason: "Synthetic: needs to validate the value", created_by: U1, updated_by: U1, ...o });
const policy = (o: Record<string, unknown> = {}) => ({ id: uid(), organization_id: ORG, allowed_types: ["pdf", "png"], max_bytes: 10485760,
  reason: "Synthetic: IT narrows uploads", created_by: U1, updated_by: U1, ...o });
const content = (o: Record<string, unknown> = {}) => {
  const id = uid();
  return { id, organization_id: ORG, transformation_id: TR, evidence_id: EVF, revision: Number(BigInt(`0x${id.slice(-6)}`) % 100000n) + 1,
    storage_key: `probe/${id}`, sha256: "0".repeat(64), size_bytes: 68, content_type: "image/png", file_name: "probe.png", uploaded_by: U1, ...o };
};

async function main(): Promise<void> {
  const files = readdirSync(migrationsDir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  console.log(`migrations shipped: ${files.length} (${files[0]} .. ${files[files.length - 1]})`);
  const ids = files.map((f) => Number(f.slice(0, 4)));
  report("G00 slice E/F migrations 0098-0100 present; 0101-0103 left free for the slice's implementers", [98, 99, 100].every((n) => ids.includes(n)) && ![101, 102, 103].some((n) => ids.includes(n)), `ids >= 95: ${ids.filter((n) => n >= 95).join(",")}`);

  // ---- 1. fresh database
  await createDb("probe_fresh");
  const applied = await migrate(roleUrl("probe_fresh", "mth_owner"), { dir: migrationsDir });
  report("G01 fresh database: 0001..last apply", applied.length === files.length, `applied ${applied.length}: ${applied.slice(-4).join(", ")}`);

  // ---- 2. P5-populated database, then P6 on top
  const db = "probe_p5";
  await createDb(db);
  const p5Dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "p5-migrations-"));
  for (const f of files.filter((f) => Number(f.slice(0, 4)) <= LAST_P5)) cpSync(join(migrationsDir, f), join(p5Dir, f));
  const p5Applied = await migrate(roleUrl(db, "mth_owner"), { dir: p5Dir });
  {
    const c = await client(db);
    await seedP1(c);
    await c.query("BEGIN");
    await c.query(`SELECT p3_instantiate_transformation($1, $2, 'probe', 'cli')`, [TR, U1]);
    await c.query("COMMIT");
    await c.end();
  }
  await fixture(db, "benefit", { id: BEN, organization_id: ORG, transformation_id: TR, code: "B01", title: "Synthetic sensitive benefit", description: "Synthetic", benefit_type: "cost",
    value_class: "cash_saving", financial_statement_line: "Synthetic opex line", owner_user_id: U1, currency: "SAR", planned_value: "1250000.5000", created_by: U1, updated_by: U1 });
  await fixture(db, "benefit", { id: BEN2, organization_id: ORG, transformation_id: TR, code: "B02", title: "Synthetic open benefit", description: "Synthetic", benefit_type: "cost",
    value_class: "cash_saving", financial_statement_line: "Synthetic opex line", owner_user_id: U1, currency: "SAR", created_by: U1, updated_by: U1 });
  await fixture(db, "business_case", { id: BC, organization_id: ORG, transformation_id: TR, code: "BC-01", level: "transformation", title: "Synthetic case", currency: "SAR", created_by: U1, updated_by: U1 });
  await fixture(db, "evidence", { id: EV, organization_id: ORG, transformation_id: TR, kind: "note", title: "Synthetic note", owner_user_id: U1, note_body: "Synthetic", created_by: U1, updated_by: U1 });
  await fixture(db, "evidence", { id: EVF, organization_id: ORG, transformation_id: TR, kind: "file", title: "Synthetic file", owner_user_id: U1, created_by: U1, updated_by: U1 });
  await fixture(db, "evidence_content", { id: EVC, organization_id: ORG, transformation_id: TR, evidence_id: EVF, revision: 1, storage_key: "probe/pre-p6", sha256: "0".repeat(64),
    size_bytes: 3, content_type: "application/octet-stream", file_name: "pre-p6.exe", uploaded_by: U1 });
  for (const [id, key] of [[NOTE1, "probe-1"], [NOTE2, "probe-2"]] as const)
    await fixture(db, "inbox_notification", { id, organization_id: ORG, transformation_id: TR, recipient_user_id: U2, link_path: `/transformations/${TR}/benefits/${BEN}`,
      message_key: "inbox.probe", message_params: JSON.stringify({ title: "Synthetic sensitive benefit" }), dedupe_key: key });
  {
    const c = await client(db);
    const n = (await c.query(`SELECT (SELECT count(*) FROM transformation WHERE id = $1)::int AS t, (SELECT count(*) FROM benefit)::int AS b, (SELECT count(*) FROM inbox_notification)::int AS i`, [TR])).rows[0];
    report("G02 P5 database populated (0001-0097; a synthetic transformation instantiated by the DG3 function, 2 benefits, a business case, 2 evidence items, a pre-P6 octet-stream file, 2 notifications)",
      p5Applied.length === files.filter((f) => Number(f.slice(0, 4)) <= LAST_P5).length && n.t === 1 && n.b === 2 && n.i === 2, `applied ${p5Applied.length}; ${JSON.stringify(n)}`);
    await c.end();
  }
  const onTop = await migrate(roleUrl(db, "mth_owner"), { dir: migrationsDir });
  {
    const c = await client(db);
    report("G03 P6 slice E/F over the P5 database: 0098..last apply", onTop.length === files.length - files.filter((f) => Number(f.slice(0, 4)) <= LAST_P5).length, `applied ${onTop.length}: ${onTop.join(", ")}`);
    const r = (await c.query(`SELECT (SELECT count(*) FROM inbox_notification WHERE link_token IS NULL AND target_record_type IS NULL)::int AS i,
      (SELECT count(*) FROM evidence_content WHERE detected_type IS NULL AND content_type = 'application/octet-stream')::int AS e,
      (SELECT count(*) FROM record_sensitivity)::int AS s, (SELECT count(*) FROM sensitive_record_grant)::int AS g, (SELECT count(*) FROM upload_policy)::int AS u,
      (SELECT version FROM benefit WHERE id = $1) AS bv`, [BEN])).rows[0];
    report("G04 the upgrade leaves every existing row as it was: notifications without token, the pre-P6 file unchecked (detected_type NULL), no sensitivity, grant or policy row, the benefit at version 1",
      r.i === 2 && r.e === 1 && r.s === 0 && r.g === 0 && r.u === 0 && r.bv === 1, JSON.stringify(r));
    await c.end();
  }

  const app = await client(db, "mth_app");
  const owner = await client(db, "mth_owner");

  // ---- RS: record_sensitivity
  let rs = "";
  await expectSuccess(app, "RS01 mark a benefit sensitive with its audit event (mth_app)", async () => {
    rs = await ins(app, "record_sensitivity", sens());
    return rs;
  });
  {
    const h = (await app.query(`SELECT record_version AS version, is_sensitive FROM record_sensitivity_change WHERE record_sensitivity_id = $1`, [rs])).rows;
    report("RS02 the insert wrote history version 1 (trigger)", h.length === 1 && h[0].version === 1 && h[0].is_sensitive === true, JSON.stringify(h));
  }
  await expectFailure(app, "RS03 a sensitivity row without its audit event fails at COMMIT", /record_sensitivity_audit_required/, async () => {
    await ins(app, "record_sensitivity", sens({ record_id: BEN2 }), false);
  });
  await expectFailure(app, "RS04 a new row must start at version 1", /record_sensitivity_version_step/, async () => {
    await ins(app, "record_sensitivity", sens({ record_id: BEN2, version: 2 }), true, 2);
  });
  await expectFailure(app, "RS05 an update must step the version by exactly 1", /record_sensitivity_version_step/, async () => {
    await updx(app, "record_sensitivity", rs, { is_sensitive: false, reason: "Synthetic: no longer sensitive" }, { step: 2 });
  });
  await expectFailure(app, "RS06 an update without its audit event fails at COMMIT", /record_sensitivity_audit_required/, async () => {
    await updx(app, "record_sensitivity", rs, { is_sensitive: false, reason: "Synthetic: no longer sensitive" }, { audit: false });
  });
  await expectSuccess(app, "RS07 unmark (version 2, audited)", async () => {
    await updx(app, "record_sensitivity", rs, { is_sensitive: false, reason: "Synthetic: no longer sensitive" });
    return "version 2";
  });
  {
    const h = (await app.query(`SELECT record_version AS version, is_sensitive FROM record_sensitivity_change WHERE record_sensitivity_id = $1 ORDER BY record_version`, [rs])).rows;
    report("RS08 history holds both versions (true, false)", h.length === 2 && h[1].version === 2 && h[1].is_sensitive === false, JSON.stringify(h));
  }
  await expectFailure(app, "RS09 a record type outside benefit, business_case, evidence is refused", /record_sensitivity_record_type/, async () => {
    await ins(app, "record_sensitivity", sens({ record_type: "charter" }));
  });
  await expectFailure(app, "RS10 a record that does not exist in the transformation is refused", /record_sensitivity_record_ref/, async () => {
    await ins(app, "record_sensitivity", sens({ record_type: "business_case", record_id: BEN }));
  });
  await expectFailure(app, "RS11 one sensitivity row per record (duplicate -> unique violation)", /23505 record_sensitivity_record_key/, async () => {
    await ins(app, "record_sensitivity", sens());
  });
  await expectFailure(app, "RS12 the record a sensitivity row marks is immutable", /record_sensitivity_record_immutable/, async () => {
    await updx(app, "record_sensitivity", rs, { record_id: BEN2 });
  });
  await expectSuccess(app, "RS13 a business case and an evidence item can be marked too", async () => {
    await ins(app, "record_sensitivity", sens({ record_type: "business_case", record_id: BC }));
    await ins(app, "record_sensitivity", sens({ record_type: "evidence", record_id: EV }));
    return "business_case, evidence";
  });
  await expectFailure(app, "RS14 mth_app cannot delete a sensitivity row", /42501/, async () => {
    await app.query(`DELETE FROM record_sensitivity WHERE id = $1`, [rs]);
  });
  await expectFailure(app, "RS15 mth_app cannot write the history directly", /42501/, async () => {
    await app.query(`INSERT INTO record_sensitivity_change (id, record_sensitivity_id, organization_id, transformation_id, record_type, record_id, record_version, is_sensitive, reason, changed_by, changed_at)
      VALUES ($1, $2, $3, $4, 'benefit', $5, 9, true, 'forged', $6, now())`, [uid(), rs, ORG, TR, BEN, U1]);
  });
  await expectFailure(app, "RS16 mth_app cannot update the history", /42501/, async () => {
    await app.query(`UPDATE record_sensitivity_change SET reason = 'changed' WHERE record_sensitivity_id = $1`, [rs]);
  });
  await expectFailure(owner, "RS17 the history is append-only even for the owner (UPDATE)", /42501 .*append-only/, async () => {
    await owner.query(`UPDATE record_sensitivity_change SET reason = 'changed' WHERE record_sensitivity_id = $1`, [rs]);
  });
  await expectFailure(owner, "RS18 the history is append-only even for the owner (DELETE)", /42501 .*append-only/, async () => {
    await owner.query(`DELETE FROM record_sensitivity_change WHERE record_sensitivity_id = $1`, [rs]);
  });

  // ---- GR: sensitive_record_grant
  let g1 = "";
  await expectSuccess(app, "GR01 grant a user explicit access to a benefit (active, audited)", async () => {
    g1 = await ins(app, "sensitive_record_grant", grant());
    return g1;
  });
  await expectFailure(app, "GR02 at most one active grant per record and grantee", /23505 sensitive_record_grant_one_active_key/, async () => {
    await ins(app, "sensitive_record_grant", grant());
  });
  await expectFailure(app, "GR03 a grant starts active", /sensitive_record_grant_transition/, async () => {
    await ins(app, "sensitive_record_grant", grant({ grantee_user_id: U3, status: "revoked", revoked_at: new Date(), revoked_by: U1, revoke_reason: "x".repeat(5) }));
  });
  await expectFailure(app, "GR04 nobody grants to themselves", /sensitive_record_grant_not_self/, async () => {
    await ins(app, "sensitive_record_grant", grant({ grantee_user_id: U1 }));
  });
  await expectFailure(app, "GR05 a grant without its audit event fails at COMMIT", /sensitive_record_grant_audit_required/, async () => {
    await ins(app, "sensitive_record_grant", grant({ grantee_user_id: U3 }), false);
  });
  await expectFailure(app, "GR06 a grant on a missing record is refused", /sensitive_record_grant_record_ref/, async () => {
    await ins(app, "sensitive_record_grant", grant({ grantee_user_id: U3, record_id: uid() }));
  });
  await expectFailure(app, "GR07 revoking needs revoked_at, revoked_by and a reason together", /sensitive_record_grant_revoke_complete/, async () => {
    await updx(app, "sensitive_record_grant", g1, { status: "revoked" });
  });
  await expectFailure(app, "GR08 the grantee of a grant is immutable", /sensitive_record_grant_immutable/, async () => {
    await updx(app, "sensitive_record_grant", g1, { grantee_user_id: U3 });
  });
  await expectFailure(app, "GR09 a grant update must step the version", /sensitive_record_grant_version_step/, async () => {
    await updx(app, "sensitive_record_grant", g1, { status: "revoked", revoked_at: new Date(), revoked_by: U1, revoke_reason: "Synthetic: left the team" }, { step: 0 });
  });
  await expectSuccess(app, "GR10 revoke (active -> revoked, version 2, audited)", async () => {
    await updx(app, "sensitive_record_grant", g1, { status: "revoked", revoked_at: new Date(), revoked_by: U1, revoke_reason: "Synthetic: left the team" });
    return "revoked";
  });
  await expectFailure(app, "GR11 revoked is terminal (revoked -> active refused)", /sensitive_record_grant_(transition|revoke_complete)/, async () => {
    await updx(app, "sensitive_record_grant", g1, { status: "active", revoked_at: null, revoked_by: null, revoke_reason: null });
  });
  await expectSuccess(app, "GR12 after a revocation the same user can be granted again (a new row)", async () => ins(app, "sensitive_record_grant", grant()));
  await expectFailure(app, "GR13 mth_app cannot delete a grant", /42501/, async () => {
    await app.query(`DELETE FROM sensitive_record_grant WHERE id = $1`, [g1]);
  });
  await expectFailure(app, "GR14 a grant on a record type outside the three is refused", /sensitive_record_grant_record_type/, async () => {
    await ins(app, "sensitive_record_grant", grant({ record_type: "kpi_definition" }));
  });

  // ---- DL: deep-link token on inbox_notification
  await expectSuccess(app, "DL01 issue a token for a pre-P6 notification (set once, version step, audited)", async () => {
    await updx(app, "inbox_notification", NOTE1, { link_token: TOKEN, target_record_type: "benefit", target_record_id: BEN });
    return TOKEN;
  });
  await expectFailure(app, "DL02 the token is never changed once set", /inbox_notification_deep_link_once/, async () => {
    await updx(app, "inbox_notification", NOTE1, { link_token: TOKEN2 });
  });
  await expectFailure(app, "DL03 the target is never changed once set", /inbox_notification_deep_link_once/, async () => {
    await updx(app, "inbox_notification", NOTE1, { target_record_id: BEN2 });
  });
  await expectFailure(app, "DL04 a token is 43 base64url characters", /inbox_notification_link_token_format/, async () => {
    await updx(app, "inbox_notification", NOTE2, { link_token: "short" });
  });
  await expectFailure(app, "DL05 tokens are unique", /23505 inbox_notification_link_token_key/, async () => {
    await updx(app, "inbox_notification", NOTE2, { link_token: TOKEN });
  });
  await expectFailure(app, "DL06 target type and id come together", /inbox_notification_target_pair/, async () => {
    await updx(app, "inbox_notification", NOTE2, { target_record_type: "benefit" });
  });
  await expectFailure(app, "DL07 the token update still needs its audit event (existing guard)", /inbox_notification_audit_required/, async () => {
    await updx(app, "inbox_notification", NOTE2, { link_token: TOKEN2 }, { audit: false });
  });

  // ---- UP: upload_policy
  let up = "";
  await expectSuccess(app, "UP01 an organization upload policy (narrower list, 10 MiB, audited)", async () => {
    up = await ins(app, "upload_policy", policy());
    return up;
  });
  {
    const h = (await app.query(`SELECT record_version AS version, allowed_types, max_bytes::text AS m FROM upload_policy_change WHERE upload_policy_id = $1`, [up])).rows;
    report("UP02 the insert wrote history version 1", h.length === 1 && h[0].m === "10485760", JSON.stringify(h));
  }
  await expectFailure(app, "UP03 a type outside the closed set (exe) is refused", /upload_policy_allowed_types/, async () => {
    await updx(app, "upload_policy", up, { allowed_types: ["pdf", "exe"] });
  });
  await expectFailure(app, "UP04 an empty allow-list is refused", /upload_policy_allowed_types/, async () => {
    await updx(app, "upload_policy", up, { allowed_types: [] });
  });
  await expectFailure(app, "UP05 a NULL inside the allow-list is refused", /upload_policy_allowed_types/, async () => {
    await updx(app, "upload_policy", up, { allowed_types: ["pdf", null] });
  });
  await expectFailure(app, "UP06 max_bytes above 25 MiB (26214401) is refused", /upload_policy_max_bytes/, async () => {
    await updx(app, "upload_policy", up, { max_bytes: 26214401 });
  });
  await expectFailure(app, "UP07 one policy per organization", /23505 upload_policy_organization_key/, async () => {
    await ins(app, "upload_policy", policy());
  });
  await expectFailure(app, "UP08 a policy update without its audit event fails at COMMIT", /upload_policy_audit_required/, async () => {
    await updx(app, "upload_policy", up, { max_bytes: 1048576 }, { audit: false });
  });
  await expectSuccess(app, "UP09 widen to all ten types at the 25 MiB ceiling (version 2)", async () => {
    await updx(app, "upload_policy", up, { allowed_types: ["pdf", "docx", "xlsx", "pptx", "csv", "txt", "png", "jpeg", "gif", "svg"], max_bytes: 26214400 });
    return "version 2";
  });
  await expectFailure(owner, "UP10 the policy history is append-only (owner UPDATE)", /42501 .*append-only/, async () => {
    await owner.query(`UPDATE upload_policy_change SET max_bytes = 1 WHERE upload_policy_id = $1`, [up]);
  });
  await expectFailure(app, "UP11 mth_app cannot delete the policy", /42501/, async () => {
    await app.query(`DELETE FROM upload_policy WHERE id = $1`, [up]);
  });

  // ---- EC: evidence_content detected type
  await expectSuccess(app, "EC01 a checked PNG: detected_type png with content_type image/png", async () => ins(app, "evidence_content", content({ detected_type: "png" }), false));
  await expectFailure(app, "EC02 a detected type with a different content type is refused", /evidence_content_detected_media_type/, async () => {
    await ins(app, "evidence_content", content({ detected_type: "png", content_type: "application/octet-stream" }), false);
  });
  await expectFailure(app, "EC03 a detected type outside the closed set (exe) is refused", /evidence_content_detected_type/, async () => {
    await ins(app, "evidence_content", content({ detected_type: "exe", content_type: "application/octet-stream" }), false);
  });
  await expectSuccess(app, "EC04 until BE-D's 0101, the DG2 upload row (octet-stream, no detected type) still inserts", async () =>
    ins(app, "evidence_content", content({ content_type: "application/octet-stream" }), false));
  {
    const r = (await app.query(`SELECT string_agg(t || '=' || p6_upload_media_type(t), ',' ORDER BY t) AS m, p6_upload_media_type('exe') AS x
      FROM unnest(ARRAY['pdf','docx','xlsx','pptx','csv','txt','png','jpeg','gif','svg']) AS t`)).rows[0];
    report("EC05 p6_upload_media_type maps the ten types and nothing else", r.x === null && r.m.split(",").length === 10 && r.m.includes("svg=image/svg+xml"), r.m);
  }
  await expectFailure(app, "EC06 evidence_content stays append-only (mth_app UPDATE of the pre-P6 row)", /42501/, async () => {
    await app.query(`UPDATE evidence_content SET detected_type = 'png' WHERE id = $1`, [EVC]);
  });
  await expectSuccess(app, "EC07 a checked SVG is stored as image/svg+xml (download-only is the API's rule)", async () =>
    ins(app, "evidence_content", content({ detected_type: "svg", content_type: "image/svg+xml", file_name: "chart.svg" }), false));

  // ---- AU: audit_event protection (REQ-S16-032 acceptance, re-proved on the P6 schema)
  await expectFailure(app, "AU01 an UPDATE on audit_event by the application role fails", /42501/, async () => {
    await app.query(`UPDATE audit_event SET reason = 'tampered' WHERE record_type = 'record_sensitivity'`);
  });
  await expectFailure(app, "AU02 a DELETE on audit_event by the application role fails", /42501/, async () => {
    await app.query(`DELETE FROM audit_event WHERE record_type = 'record_sensitivity'`);
  });
  await expectFailure(owner, "AU03 audit_event is append-only for the owner too", /42501 .*append-only/, async () => {
    await owner.query(`UPDATE audit_event SET reason = 'tampered' WHERE record_type = 'record_sensitivity'`);
  });

  // ---- PM: permission seeds
  {
    const p = (await app.query(`SELECT code, category FROM permission WHERE code IN ('sensitive_record.grant','sensitive_record.read','audit_event.read','upload_policy.configure','security.read') ORDER BY code`)).rows;
    report("PM01 five P6 E/F permission codes with their categories", p.length === 5 && p.map((r: any) => `${r.code}:${r.category}`).join(",") ===
      "audit_event.read:read,security.read:read,sensitive_record.grant:configure,sensitive_record.read:read,upload_policy.configure:configure", p.map((r: any) => `${r.code}:${r.category}`).join(","));
    const l = (await app.query(`SELECT r.code || ':' || rp.permission_code AS l FROM role_permission rp JOIN role r ON r.id = rp.role_id
      WHERE rp.permission_code IN ('sensitive_record.grant','sensitive_record.read','audit_event.read','upload_policy.configure','security.read') ORDER BY 1`)).rows.map((r: any) => r.l);
    report("PM02 role defaults: TO and ADM_ACCESS grant; TO, AUD, ADM_ACCESS read flags; AUD, ADM_TECH, ADM_ACCESS read audit; ADM_TECH configures uploads; ADM_TECH and AUD read security",
      l.join(",") === "ADM_ACCESS:audit_event.read,ADM_ACCESS:sensitive_record.grant,ADM_ACCESS:sensitive_record.read,ADM_TECH:audit_event.read,ADM_TECH:security.read,ADM_TECH:upload_policy.configure,AUD:audit_event.read,AUD:security.read,AUD:sensitive_record.read,TO:sensitive_record.grant,TO:sensitive_record.read", l.join(","));
    const aud = (await app.query(`SELECT count(*)::int AS n FROM role_permission rp JOIN role r ON r.id = rp.role_id JOIN permission p ON p.code = rp.permission_code
      WHERE r.code = 'AUD' AND p.category <> 'read'`)).rows[0].n;
    report("PM03 AUD holds only read permissions after 0100", aud === 0, `non-read AUD links: ${aud}`);
  }
  await expectFailure(owner, "PM04 a technical admin can still never hold a business approval (0001 trigger)", /separation of duties/, async () => {
    await owner.query(`INSERT INTO role_permission (role_id, permission_code) VALUES ('01920000-0000-7000-8000-00000000000d', 'gate.decide')`);
  });

  // ---- LK: lock classes in the trigger functions
  {
    const r = (await app.query(`SELECT proname, pg_get_functiondef(oid) AS d FROM pg_proc WHERE proname IN ('record_sensitivity_guard','sensitive_record_grant_guard','inbox_notification_deep_link_guard') ORDER BY proname`)).rows;
    const has = (n: string, k: string) => r.find((x: any) => x.proname === n)?.d.includes(k) ?? false;
    report("LK01 the guards declare 730300 (sensitive grant, both tables) and 730301 (deep-link issue)",
      has("record_sensitivity_guard", "730300") && has("sensitive_record_grant_guard", "730300") && has("inbox_notification_deep_link_guard", "730301"), r.map((x: any) => x.proname).join(","));
  }

  await app.end();
  await owner.end();
  console.log(`\n${total - failures}/${total} PASS${failures ? `, ${failures} FAIL` : ""}`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
