// T-DG6-ARCH-05 migration and guard probe (solution-architect). Run against a DISPOSABLE cluster only:
//   QA_PG_PORT=<port in 23700-23749> MTH_PORT_POOL=<rest of 23700-23749> tests/qa/support/with-pg.sh \
//     node --conditions=@mth/source docs/delivery/handbacks/DG6/T-DG6-ARCH-05-evidence/probe.ts
// 1. Fresh database: all migrations 0001..last.
// 2. P5-populated database: 0001..0097 plus synthetic fixtures (a transformation instantiated by the DG3 function,
//    initiatives, users); then 0098..last on top.
// 3. Guard probes on the slice D tables (ADR-0059) and the D-199 list bounds. "PASS" means the guard fired (or, for an
//    expectSuccess probe, that the allowed write committed). API-path writes run as mth_app with every trigger on.
//    Fixture records are inserted by the superuser with session_replication_role = replica (the T-DG6-ARCH-01..03
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
const SLICE = [111, 112];
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
const U1 = "01990000-0000-7000-8000-000000000003"; // view owner
const U2 = "01990000-0000-7000-8000-000000000004"; // another user, same organization
const TR = "01990000-0000-7000-8000-000000000005";
const ORG2 = "01990000-0000-7000-8000-000000000008";
const UX = "01990000-0000-7000-8000-000000000009"; // other organization
const TR2 = "01990000-0000-7000-8000-00000000000a"; // other organization's transformation
const BU2 = "01990000-0000-7000-8000-00000000000b";
let seq = 0x100;
const uid = () => `01990000-0000-7000-8000-${(seq++).toString(16).padStart(12, "0")}`;
async function seedP1(c: any): Promise<void> {
  await c.query(`INSERT INTO organization (id, code, name_en, name_ar) VALUES ($1, 'SYN-PROBE', 'Synthetic probe org', 'منظمة تجريبية')`, [ORG]);
  await c.query(`INSERT INTO organization (id, code, name_en, name_ar) VALUES ($1, 'SYN-OTHER', 'Synthetic other org', 'منظمة أخرى')`, [ORG2]);
  await c.query(`INSERT INTO app_user (id, organization_id, display_name) VALUES ($1, $3, 'Synthetic owner'), ($2, $3, 'Synthetic colleague')`, [U1, U2, ORG]);
  await c.query(`INSERT INTO app_user (id, organization_id, display_name) VALUES ($1, $2, 'Synthetic other-org user')`, [UX, ORG2]);
  await c.query(`INSERT INTO business_unit (id, organization_id, code, name_en, name_ar) VALUES ($1, $2, 'SYN-BU', 'Synthetic BU', 'وحدة تجريبية')`, [BU, ORG]);
  await c.query(`INSERT INTO business_unit (id, organization_id, code, name_en, name_ar) VALUES ($1, $2, 'SYN-BU2', 'Synthetic other BU', 'وحدة أخرى')`, [BU2, ORG2]);
  await c.query(
    `INSERT INTO transformation (id, organization_id, business_unit_id, code, name, mode, current_phase, timezone, currency, created_by, updated_by)
     VALUES ($1, $2, $3, 'SYN-T1', 'Synthetic transformation', 'end_to_end', 'diagnose', 'Asia/Riyadh', 'SAR', $4, $4)`,
    [TR, ORG, BU, U1],
  );
  await c.query(
    `INSERT INTO transformation (id, organization_id, business_unit_id, code, name, mode, current_phase, timezone, currency, created_by, updated_by)
     VALUES ($1, $2, $4, 'SYN-T2', 'Synthetic other transformation', 'end_to_end', 'diagnose', 'Asia/Riyadh', 'SAR', $3, $3)`,
    [TR2, ORG2, UX, BU2],
  );
}
async function audit(c: any, recordType: string, id: string, version: number | null, actor = U1, org = ORG, tr: string | null = null): Promise<void> {
  await c.query(
    `INSERT INTO audit_event (id, organization_id, transformation_id, actor_type, actor_user_id, action, record_type, record_id, new_version, source)
     VALUES ($1, $2, $3, 'user', $4, $5, $6, $7, $8, 'api')`,
    [uid(), org, tr, actor, `${recordType}.probe`, recordType, id, version],
  );
}
async function insRow(c: any, table: string, row: Record<string, unknown>): Promise<void> {
  const cols = Object.keys(row);
  await c.query(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(row));
}
async function upd(c: any, table: string, id: string, set: Record<string, unknown>, o: { audit?: boolean; step?: number; actor?: string } = {}): Promise<void> {
  const v = (await c.query(`SELECT version FROM ${table} WHERE id = $1`, [id])).rows[0].version;
  const nv = v + (o.step ?? 1);
  const cols = Object.keys(set);
  await c.query(`UPDATE ${table} SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(", ")}${cols.length ? ", " : ""}version = ${nv}, updated_at = now() WHERE id = $1`, [id, ...Object.values(set)]);
  if (o.audit) await audit(c, table, id, nv, o.actor ?? U1);
}
async function fixture(db: string, table: string, row: Record<string, unknown>): Promise<string> {
  const c = await client(db, null);
  try {
    await c.query("SET session_replication_role = replica");
    await insRow(c, table, row);
  } finally {
    await c.end();
  }
  return row.id as string;
}
const INI = (i: number) => `01990000-0000-7000-8000-0000000002${i.toString(16).padStart(2, "0")}`;

const ADM = U1; // the synthetic administrator who configures the setting
const PLAY = (b: string) => ({ source: "playbook", blockRef: b, playbookVersion: "1.0" });
const REC = (t: string, id: string, v = 1) => ({ source: "record", recordType: t, recordId: id, recordVersion: v });

async function main(): Promise<void> {
  const files = readdirSync(migrationsDir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  console.log(`migrations shipped: ${files.length} (${files[0]} .. ${files[files.length - 1]})`);
  const ids = files.map((f) => Number(f.slice(0, 4)));
  report("G00 slice D migrations 0111-0112 present directly above 0110 (D-196); nothing above 0112",
    SLICE.every((n) => ids.includes(n)) && ids.includes(110) && Math.max(...ids) === 112, `ids >= 98: ${ids.filter((n) => n >= 98).join(",")}`);

  await createDb("probe_fresh");
  const applied = await migrate(roleUrl("probe_fresh", "mth_owner"), { dir: migrationsDir });
  report("G01 fresh database: 0001..last apply", applied.length === files.length, `applied ${applied.length}: ${applied.slice(-4).join(", ")}`);
  {
    const c = await client("probe_fresh", "mth_app");
    const r = (await c.query(`SELECT (SELECT count(*) FROM assistant_setting)::int AS s, (SELECT count(*) FROM assistant_conversation)::int AS c`)).rows[0];
    report("G01b a fresh install has no assistant_setting row, i.e. the assistant is disabled (REQ-S17-009 'The default install has AI ... off')", r.s === 0 && r.c === 0, JSON.stringify(r));
    await c.end();
  }

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
  for (let i = 1; i <= 12; i++) {
    await fixture(db, "initiative", { id: INI(i), organization_id: ORG, transformation_id: TR, code: `INI-${String(i).padStart(2, "0")}`,
      name: i % 2 ? `Synthetic network initiative ${i}` : `مبادرة تجريبية ${i}`, executive_owner_user_id: i % 3 ? U1 : U2, created_by: U1, updated_by: U1 });
  }
  const md5 = async (c: any) => (await c.query(`SELECT md5(string_agg(to_jsonb(i)::text, '' ORDER BY id)) AS h FROM initiative i`)).rows[0].h
    + "/" + (await c.query(`SELECT md5(string_agg(to_jsonb(t)::text, '' ORDER BY id)) AS h FROM transformation t`)).rows[0].h
    + "/" + (await c.query(`SELECT md5(string_agg(to_jsonb(g)::text, '' ORDER BY id)) AS h FROM gate_instance g`)).rows[0].h
    + "/" + (await c.query(`SELECT count(*)::text AS n FROM audit_event`)).rows[0].n;
  let before = "";
  {
    const c = await client(db);
    const n = (await c.query(`SELECT (SELECT count(*) FROM initiative)::int AS i, (SELECT count(*) FROM transformation)::int AS t, (SELECT count(*) FROM app_user)::int AS u, (SELECT count(*) FROM gate_instance)::int AS g`)).rows[0];
    report("G02 P5 database populated (0001-0097; 2 transformations, one instantiated by the DG3 function with its gates; 12 initiatives; 3 users)",
      p5Applied.length === p5Files.length && n.i === 12 && n.t === 2 && n.u === 3 && n.g === 6, `applied ${p5Applied.length}; ${JSON.stringify(n)}`);
    before = await md5(c);
    await c.end();
  }
  const onTop = await migrate(roleUrl(db, "mth_owner"), { dir: migrationsDir });
  {
    const c = await client(db);
    report("G03 P6 (0098..last, including slice D 0111-0112) over the P5 database apply",
      onTop.length === files.length - p5Files.length && onTop.join(",").includes("0112"), `applied ${onTop.length}: ${onTop.join(", ")}`);
    const after = await md5(c);
    const r = (await c.query(`SELECT (SELECT count(*) FROM assistant_setting)::int AS settings, (SELECT count(*) FROM assistant_conversation)::int AS conversations,
      (SELECT count(*) FROM assistant_message)::int AS messages, (SELECT count(*) FROM assistant_suggestion)::int AS suggestions`)).rows[0];
    report("G04 the upgrade leaves existing rows as they were (initiatives, transformations and gate instances byte-identical, audit count unchanged); no assistant row (AI disabled)",
      after === before && r.settings === 0 && r.conversations === 0 && r.messages === 0 && r.suggestions === 0, `${after === before ? "identical" : `changed ${before} -> ${after}`}; ${JSON.stringify(r)}`);
    await c.end();
  }

  const app = await client(db, "mth_app");
  const own = await client(db, "mth_owner");
  // -------------------------------------------------------------------------------------------- assistant_setting
  const S = uid();
  const setting = (o: Record<string, unknown> = {}) => ({ id: S, enabled: false, provider_kind: "http_endpoint", endpoint_url: "https://ai.internal.example/v1/chat/completions",
    api_style: "openai_chat_completions", model_name: "synthetic-model-1", credential_ref: JSON.stringify({ provider: "env", name: "MTH_AI_KEY" }),
    authorization_reference: null, reason: "Synthetic probe configuration", created_by: ADM, updated_by: ADM, ...o });
  await expectFailure(app, "AS01 a setting is created disabled (enabling is its own audited step)", /assistant_setting_starts_disabled|assistant_setting_enable/, async () => {
    await insRow(app, "assistant_setting", setting({ enabled: true, enabled_at: new Date().toISOString(), enabled_by: ADM, authorization_reference: "IT-AUTH-0001" }));
    await audit(app, "assistant_setting", S, 1);
  });
  await expectFailure(app, "AS02 missing audit fails at COMMIT (assistant_setting_audit_required)", /assistant_setting_audit_required/, async () => {
    await insRow(app, "assistant_setting", setting());
  });
  await expectSuccess(app, "AS03 a disabled setting with its audit event commits", async () => {
    await insRow(app, "assistant_setting", setting()); await audit(app, "assistant_setting", S, 1); return "committed";
  });
  await expectFailure(app, "AS04 at most one setting row (assistant_setting_singleton_key)", /assistant_setting_singleton_key/, async () => {
    const id2 = uid(); await insRow(app, "assistant_setting", { ...setting(), id: id2 }); await audit(app, "assistant_setting", id2, 1);
  });
  await expectFailure(app, "AS05 a non-stepping version fails (assistant_setting_version_step)", /assistant_setting_version_step/, async () => {
    await upd(app, "assistant_setting", S, { reason: "Synthetic step 2" }, { step: 2, audit: true });
  });
  await expectFailure(app, "AS06 enabling without an authorization reference is refused (assistant_setting_enable_complete)", /assistant_setting_enable_complete/, async () => {
    await upd(app, "assistant_setting", S, { enabled: true, enabled_at: new Date().toISOString(), enabled_by: ADM, updated_by: ADM }, { audit: true });
  });
  await expectFailure(app, "AS07 enabling the HTTP adapter without a model name is refused (assistant_setting_enable_complete)", /assistant_setting_enable_complete/, async () => {
    await upd(app, "assistant_setting", S, { enabled: true, enabled_at: new Date().toISOString(), enabled_by: ADM, authorization_reference: "IT-AUTH-0001", model_name: null }, { audit: true });
  });
  await expectFailure(app, "AS08a enabling without the enabled stamp is refused (the guard's assistant_setting_enabled_by_actor fires before the CHECK)", /assistant_setting_enabled_by_actor|assistant_setting_enabled_stamp/, async () => {
    await upd(app, "assistant_setting", S, { enabled: true, authorization_reference: "IT-AUTH-0001" }, { audit: true });
  });
  await expectFailure(app, "AS08b a disabled setting carrying an enabled stamp is refused (assistant_setting_enabled_stamp)", /assistant_setting_enabled_stamp/, async () => {
    await upd(app, "assistant_setting", S, { enabled_at: new Date().toISOString(), enabled_by: ADM }, { audit: true });
  });
  await expectFailure(app, "AS09 the enabler is the actor of the enabling change (assistant_setting_enabled_by_actor)", /assistant_setting_enabled_by_actor/, async () => {
    await upd(app, "assistant_setting", S, { enabled: true, enabled_at: new Date().toISOString(), enabled_by: U2, authorization_reference: "IT-AUTH-0001", updated_by: ADM }, { audit: true });
  });
  for (const [n, url] of [["AS10a", "https://user:pw@ai.internal.example/v1"], ["AS10b", "https://ai.internal.example/v1?key=SECRET"], ["AS10c", "ftp://ai.internal.example/v1"], ["AS10d", "https://ai.internal.example/v1#x"]] as const) {
    await expectFailure(app, `${n} an endpoint URL with user information, a query, a fragment or a non-HTTP scheme is refused (${url})`, /assistant_setting_endpoint_url/, async () => {
      await upd(app, "assistant_setting", S, { endpoint_url: url }, { audit: true });
    });
  }
  await expectFailure(app, "AS11 a credential VALUE is refused; only a SecretRef {provider, name} is stored (assistant_setting_credential_ref)", /assistant_setting_credential_ref/, async () => {
    await upd(app, "assistant_setting", S, { credential_ref: JSON.stringify({ provider: "env", name: "MTH_AI_KEY", value: "sk-synthetic" }) }, { audit: true });
  });
  await expectFailure(app, "AS12 the test adapter carries no endpoint, API style or credential (assistant_setting_test_adapter_shape)", /assistant_setting_test_adapter_shape/, async () => {
    await upd(app, "assistant_setting", S, { provider_kind: "test_adapter" }, { audit: true });
  });
  await expectSuccess(app, "AS13 enabling with provider, endpoint, API style, model and authorization reference, stamped by the actor, commits", async () => {
    await upd(app, "assistant_setting", S, { enabled: true, enabled_at: new Date().toISOString(), enabled_by: ADM, authorization_reference: "IT-AUTH-0001", updated_by: ADM }, { audit: true });
    return "committed";
  });
  for (const [n, col, val] of [["AS14a", "endpoint_url", "https://other.example/v1"], ["AS14b", "model_name", "other-model"], ["AS14c", "authorization_reference", "IT-AUTH-0002"],
    ["AS14d", "credential_ref", JSON.stringify({ provider: "env", name: "OTHER" })], ["AS14e", "provider_kind", "test_adapter"]] as const) {
    await expectFailure(app, `${n} while enabled, ${col} cannot change (assistant_setting_locked_while_enabled)`, /assistant_setting_locked_while_enabled|assistant_setting_test_adapter_shape/, async () => {
      await upd(app, "assistant_setting", S, { [col]: val }, { audit: true });
    });
  }
  await expectSuccess(app, "AS15 while enabled, the timeout and the limits can change (audited)", async () => {
    await upd(app, "assistant_setting", S, { request_timeout_ms: 20000, max_context_records: 6, reason: "Synthetic limits" }, { audit: true }); return "committed";
  });
  await expectSuccess(app, "AS16 disabling clears the stamp and commits", async () => {
    await upd(app, "assistant_setting", S, { enabled: false, enabled_at: null, enabled_by: null, reason: "Synthetic off" }, { audit: true }); return "committed";
  });
  {
    const h = (await app.query(`SELECT string_agg(record_version || ':' || enabled, ',' ORDER BY record_version) AS v FROM assistant_setting_change WHERE assistant_setting_id = $1`, [S])).rows[0].v;
    report("AS17 the trigger writes one history row per version (1 created, 2 enabled, 3 limits, 4 disabled)", h === "1:false,2:true,3:true,4:false", h);
  }
  await expectFailure(app, "AS18 UPDATE on assistant_setting_change is refused (append-only)", /append-only|permission denied/, async () => { await app.query(`UPDATE assistant_setting_change SET reason = 'x'`); });
  await expectFailure(own, "AS19 DELETE on assistant_setting_change is refused even for the owner role (append-only)", /append-only/, async () => { await own.query(`DELETE FROM assistant_setting_change`); });
  await expectFailure(app, "AS20 mth_app cannot DELETE the setting (no grant)", /permission denied/, async () => { await app.query(`DELETE FROM assistant_setting`); });

  // -------------------------------------------------------------------------------------------- conversations and messages
  const C1 = uid();
  const C0 = uid();
  const conv = (id: string, o: Record<string, unknown> = {}) => ({ id, organization_id: ORG, owner_user_id: U1, transformation_id: TR, title: "Synthetic question about the roadmap", created_by: U1, updated_by: U1, ...o });
  await expectFailure(app, "CV01 missing audit fails at COMMIT (assistant_conversation_audit_required)", /assistant_conversation_audit_required/, async () => { await insRow(app, "assistant_conversation", conv(uid())); });
  await expectSuccess(app, "CV02 a conversation focused on a transformation, and one without focus, commit with their audit events", async () => {
    await insRow(app, "assistant_conversation", conv(C1)); await audit(app, "assistant_conversation", C1, 1, U1, ORG, TR);
    await insRow(app, "assistant_conversation", conv(C0, { transformation_id: null })); await audit(app, "assistant_conversation", C0, 1);
    return "committed";
  });
  await expectFailure(app, "CV03 the conversation belongs to its owner's organization (assistant_conversation_organization_matches)", /assistant_conversation_organization_matches/, async () => {
    const id = uid(); await insRow(app, "assistant_conversation", conv(id, { owner_user_id: UX, created_by: UX, updated_by: UX, transformation_id: null })); await audit(app, "assistant_conversation", id, 1);
  });
  await expectFailure(app, "CV04 the focused transformation is in the conversation's organization (p2_row_guard)", /assistant_conversation_organization_matches/, async () => {
    const id = uid(); await insRow(app, "assistant_conversation", conv(id, { transformation_id: TR2 })); await audit(app, "assistant_conversation", id, 1);
  });
  await expectFailure(app, "CV05 a conversation starts empty (assistant_conversation_starts_empty)", /assistant_conversation_starts_empty|assistant_conversation_last_message_shape/, async () => {
    const id = uid(); await insRow(app, "assistant_conversation", conv(id, { message_count: 1, last_message_at: new Date().toISOString() })); await audit(app, "assistant_conversation", id, 1);
  });
  const post = async (c: any, cid: string, msg: Record<string, unknown>, o: { audit?: boolean; flip?: boolean } = {}) => {
    const cur = (await c.query(`SELECT message_count, awaiting_reply, version FROM assistant_conversation WHERE id = $1`, [cid])).rows[0];
    const waiting = msg.author === "user";
    await c.query(`UPDATE assistant_conversation SET message_count = message_count + 1, awaiting_reply = $2, awaiting_since = CASE WHEN $2 THEN now() ELSE NULL END,
      last_message_at = now(), version = version + 1, updated_at = now() WHERE id = $1`, [cid, o.flip === false ? cur.awaiting_reply : waiting]);
    if (o.audit !== false) await audit(c, "assistant_conversation", cid, cur.version + 1);
    await insRow(c, "assistant_message", { id: uid(), conversation_id: cid, organization_id: ORG, seq: cur.message_count + 1, created_by: U1, ...msg,
      citations: JSON.stringify(msg.citations ?? []) });
  };
  const USER = (t: string) => ({ author: "user", content: t });
  const ANSWER = (cit: unknown[], o: Record<string, unknown> = {}) => ({ author: "assistant", reply_kind: "answer", content: "Synthetic answer (suggestion).", citations: cit, provider_kind: "test_adapter", setting_version: 4, latency_ms: 12, ...o });
  await expectSuccess(app, "CV06 a user message then an answer citing a record and a playbook block commit (each with the conversation update and its audit event)", async () => {
    await post(app, C1, USER("Which initiatives are behind plan?"));
    await post(app, C1, ANSWER([REC("initiative", INI(1), 3), PLAY("B0078")]));
    return "committed";
  });
  await expectFailure(app, "CV07 missing audit for the conversation update fails at COMMIT", /assistant_conversation_audit_required/, async () => { await post(app, C1, USER("Synthetic"), { audit: false }); });
  await expectFailure(app, "CV08 a message without the conversation update that counts it is refused (assistant_message_sequence)", /assistant_message_sequence/, async () => {
    await insRow(app, "assistant_message", { id: uid(), conversation_id: C1, organization_id: ORG, seq: 3, author: "user", content: "x", created_by: U1, citations: "[]" });
  });
  await expectFailure(app, "CV09 a conversation update without its message fails at COMMIT (assistant_conversation_messages_match)", /assistant_conversation_messages_match/, async () => {
    const v = (await app.query(`SELECT version FROM assistant_conversation WHERE id = $1`, [C1])).rows[0].version;
    await app.query(`UPDATE assistant_conversation SET message_count = message_count + 1, awaiting_reply = true, awaiting_since = now(), last_message_at = now(), version = version + 1, updated_at = now() WHERE id = $1`, [C1]);
    await audit(app, "assistant_conversation", C1, v + 1);
  });
  await expectFailure(app, "CV10 a reply while no user message awaits one is refused (assistant_conversation_message_step: the flag must flip)", /assistant_conversation_message_step|assistant_message_sequence/, async () => {
    await post(app, C1, ANSWER([PLAY("B0001")]), { flip: false });
  });
  await expectFailure(app, "CV11 an update that appends two messages at once is refused (assistant_conversation_message_step)", /assistant_conversation_message_step/, async () => {
    await upd(app, "assistant_conversation", C1, { message_count: 4, awaiting_reply: true, awaiting_since: new Date().toISOString() }, { audit: true });
  });
  await expectFailure(app, "CV12 only the owner adds to a conversation (assistant_conversation_owner_only)", /assistant_conversation_owner_only/, async () => {
    await upd(app, "assistant_conversation", C1, { message_count: 3, awaiting_reply: true, awaiting_since: new Date().toISOString(), updated_by: U2 }, { audit: true });
  });
  await expectFailure(app, "CV13 a non-stepping conversation version fails (assistant_conversation_version_step)", /assistant_conversation_version_step/, async () => {
    await upd(app, "assistant_conversation", C1, { message_count: 3, awaiting_reply: true, awaiting_since: new Date().toISOString() }, { step: 2, audit: true });
  });
  await expectFailure(app, "CV14 UPDATE on assistant_message is refused (mth_app has no UPDATE grant; the append-only trigger is behind it)", /append-only|permission denied/, async () => { await app.query(`UPDATE assistant_message SET content = 'changed'`); });
  await expectFailure(own, "CV14b UPDATE on assistant_message is refused even for the owner role (append-only)", /append-only/, async () => { await own.query(`UPDATE assistant_message SET content = 'changed' WHERE content IS NOT NULL`); });
  await expectFailure(own, "CV15 DELETE on assistant_message is refused even for the owner role (append-only)", /append-only/, async () => { await own.query(`DELETE FROM assistant_message`); });
  const msgCases: [string, string, Record<string, unknown>][] = [
    ["CV16a", "an answer without any citation", ANSWER([])],
    ["CV16b", "a refusal that carries content", { author: "assistant", reply_kind: "refusal", refusal_code: "assistant.refused.approval", content: "I approved G4." }],
    ["CV16c", "a refusal without a refusal code", { author: "assistant", reply_kind: "refusal" }],
    ["CV16d", "an answer that carries a refusal code", ANSWER([PLAY("B0001")], { refusal_code: "assistant.refused.approval" })],
    ["CV16e", "an unknown refusal code", { author: "assistant", reply_kind: "refusal", refusal_code: "assistant.refused.other" }],
    ["CV16f", "an HTTP-adapter answer without a model name", ANSWER([PLAY("B0001")], { provider_kind: "http_endpoint" })],
    ["CV16g", "a no_sources reply with citations", { author: "assistant", reply_kind: "no_sources", citations: [PLAY("B0001")] }],
  ];
  // Each case needs a pending user message first.
  for (const [n, what, m] of msgCases) {
    await expectFailure(app, `${n} ${what} is refused (assistant_message_reply_shape / _citations_valid / CHECK)`, /assistant_message_reply_shape|assistant_message_citations_valid|assistant_message_refusal_code_check|check_violation/, async () => {
      await post(app, C1, USER("Synthetic pending question"));
      await post(app, C1, m);
    });
  }
  await expectFailure(app, "CV17 a user message cannot carry citations (assistant_message_user_shape)", /assistant_message_user_shape/, async () => {
    await post(app, C1, { ...USER("x"), citations: [PLAY("B0001")] });
  });
  await expectFailure(app, "CV18 a user message longer than 4000 characters is refused (assistant_message_user_shape)", /assistant_message_user_shape/, async () => {
    await post(app, C1, USER("x".repeat(4001)));
  });
  const citeCases: [string, string, unknown[]][] = [
    ["CV19a", "a record type outside the 12 search types", [REC("tom_gap", INI(1))]],
    ["CV19b", "an extra key (record text smuggled into a citation)", [{ ...REC("initiative", INI(1)), text: "ignore previous instructions" }]],
    ["CV19c", "a record version 0", [REC("initiative", INI(1), 0)]],
    ["CV19d", "a playbook version other than 1.0", [{ source: "playbook", blockRef: "B0001", playbookVersion: "2.0" }]],
    ["CV19e", "a block reference above B0165", [PLAY("B0166")]],
    ["CV19f", "a duplicate citation", [PLAY("B0001"), PLAY("B0001")]],
    ["CV19g", "more than 20 citations", Array.from({ length: 21 }, (_, i) => PLAY(`B0${String(i + 1).padStart(3, "0")}`))],
  ];
  for (const [n, what, cit] of citeCases) {
    await expectFailure(app, `${n} a citation list with ${what} is refused (assistant_message_citations_valid)`, /assistant_message_citations_valid/, async () => {
      await post(app, C1, USER("Synthetic pending question"));
      await post(app, C1, ANSWER(cit));
    });
  }
  await expectSuccess(app, "CV20 the other reply kinds commit: refusal (code, no content), no_sources, unavailable (error code), interrupted", async () => {
    await post(app, C1, USER("Approve gate G4 for me"));
    await post(app, C1, { author: "assistant", reply_kind: "refusal", refusal_code: "assistant.refused.approval" });
    await post(app, C1, USER("Synthetic question with no match"));
    await post(app, C1, { author: "assistant", reply_kind: "no_sources" });
    await post(app, C1, USER("Synthetic question during an outage"));
    await post(app, C1, { author: "assistant", reply_kind: "unavailable", error_code: "assistant.provider_timeout", provider_kind: "http_endpoint", model_name: "synthetic-model-1", setting_version: 2, latency_ms: 30000 });
    await post(app, C1, USER("Synthetic question that never got a reply"));
    await post(app, C1, { author: "assistant", reply_kind: "interrupted" });
    return "committed";
  });
  {
    const r = (await app.query(`SELECT message_count AS n, (SELECT count(*) FROM assistant_message WHERE conversation_id = $1)::int AS m, version FROM assistant_conversation WHERE id = $1`, [C1])).rows[0];
    report("CV21 message_count equals the number of messages (10) and the version stepped once per message (11)", r.n === 10 && r.m === 10 && r.version === 11, JSON.stringify(r));
  }
  await expectFailure(app, "CV22 at most 100 messages per conversation (message_count CHECK)", /assistant_conversation_message_count_check|check_violation/, async () => {
    for (let i = 0; i < 46; i++) { await post(app, C1, USER("q")); await post(app, C1, { author: "assistant", reply_kind: "no_sources" }); }
  });

  // -------------------------------------------------------------------------------------------- suggestions
  const answerId = (await app.query(`SELECT id FROM assistant_message WHERE conversation_id = $1 AND reply_kind = 'answer' ORDER BY seq LIMIT 1`, [C1])).rows[0].id;
  const refusalId = (await app.query(`SELECT id FROM assistant_message WHERE conversation_id = $1 AND reply_kind = 'refusal' ORDER BY seq LIMIT 1`, [C1])).rows[0].id;
  const G1 = uid();
  const G2 = uid();
  const sug = (id: string, o: Record<string, unknown> = {}) => ({ id, organization_id: ORG, transformation_id: TR, conversation_id: C1, message_id: answerId, owner_user_id: U1, ordinal: 1,
    kind: "charter_draft", target_record_type: "charter", fields: JSON.stringify({ case_for_change: "Synthetic case for change", in_scope: "Synthetic scope" }), text_content: null,
    citations: JSON.stringify([REC("transformation", TR, 2)]), created_by: U1, updated_by: U1, ...o });
  await expectFailure(app, "SG01 missing audit fails at COMMIT (assistant_suggestion_audit_required)", /assistant_suggestion_audit_required/, async () => { await insRow(app, "assistant_suggestion", sug(uid())); });
  await expectSuccess(app, "SG02 a charter draft suggestion and a missing-evidence advice on an answer commit with their audit events", async () => {
    await insRow(app, "assistant_suggestion", sug(G1)); await audit(app, "assistant_suggestion", G1, 1, U1, ORG, TR);
    await insRow(app, "assistant_suggestion", sug(G2, { ordinal: 2, kind: "missing_evidence", target_record_type: null, fields: null, text_content: "Synthetic: the G2 business case has no baseline evidence." }));
    await audit(app, "assistant_suggestion", G2, 1, U1, ORG, TR);
    return "committed";
  });
  const sgCases: [string, string, Record<string, unknown>, RegExp][] = [
    ["SG03a", "a charter field that is not a text field (budget)", { fields: JSON.stringify({ budget_amount: "1000000" }) }, /assistant_suggestion_kind_shape/],
    ["SG03b", "a numeric draft value", { fields: JSON.stringify({ case_for_change: 12 }) }, /assistant_suggestion_kind_shape/],
    ["SG03c", "a decision brief carrying an owner or a date field", { kind: "decision_brief_draft", target_record_type: "T16", fields: JSON.stringify({ decision: "Synthetic", decision_date: "2026-11-01" }) }, /assistant_suggestion_kind_shape/],
    ["SG03d", "a decision brief targeting the charter", { kind: "decision_brief_draft", target_record_type: "charter" }, /assistant_suggestion_kind_shape/],
    ["SG03e", "advice carrying draft fields", { kind: "recovery_action", target_record_type: null, text_content: "x" }, /assistant_suggestion_kind_shape/],
    ["SG03f", "an empty draft", { fields: JSON.stringify({}) }, /assistant_suggestion_kind_shape/],
    ["SG03g", "no citation", { citations: "[]" }, /assistant_suggestion_citations_valid/],
    ["SG04", "a suggestion on a refusal", { message_id: refusalId }, /assistant_suggestion_on_answer/],
    ["SG05", "a suggestion in another transformation than the conversation's", { transformation_id: TR2, organization_id: ORG2 }, /assistant_suggestion_conversation_matches|organization_matches/],
    ["SG06", "a suggestion created as taken", { status: "taken_to_draft", taken_at: new Date().toISOString(), taken_by: U1 }, /assistant_suggestion_transition/],
    ["SG07", "a sixth suggestion on one answer", { ordinal: 6 }, /assistant_suggestion_ordinal_check|check_violation/],
    ["SG08", "a second suggestion with the same ordinal", { ordinal: 1 }, /assistant_suggestion_ordinal_key/],
  ];
  for (const [n, what, o, re] of sgCases) {
    await expectFailure(app, `${n} ${what} is refused`, re, async () => { const id = uid(); await insRow(app, "assistant_suggestion", sug(id, { ordinal: 3, ...o })); await audit(app, "assistant_suggestion", id, 1, U1, ORG, TR); });
  }
  await expectFailure(app, "SG09 a suggestion needs a conversation focused on its transformation (assistant_suggestion_conversation_matches)", /assistant_suggestion_conversation_matches/, async () => {
    await post(app, C0, USER("Draft a charter")); await post(app, C0, ANSWER([PLAY("B0021")]));
    const mid = (await app.query(`SELECT id FROM assistant_message WHERE conversation_id = $1 AND reply_kind = 'answer'`, [C0])).rows[0].id;
    const id = uid(); await insRow(app, "assistant_suggestion", sug(id, { conversation_id: C0, message_id: mid })); await audit(app, "assistant_suggestion", id, 1, U1, ORG, TR);
  });
  await expectFailure(app, "SG10 advice cannot be taken to a draft (assistant_suggestion_draftable)", /assistant_suggestion_draftable/, async () => {
    await upd(app, "assistant_suggestion", G2, { status: "taken_to_draft", taken_at: new Date().toISOString(), taken_by: U1 }, { audit: true });
  });
  await expectFailure(app, "SG11 only its owner takes a suggestion to a draft (assistant_suggestion_transition)", /assistant_suggestion_transition/, async () => {
    await upd(app, "assistant_suggestion", G1, { status: "taken_to_draft", taken_at: new Date().toISOString(), taken_by: U2, updated_by: U2 }, { audit: true, actor: U2 });
  });
  await expectFailure(app, "SG12 the content of a suggestion never changes (assistant_suggestion_immutable)", /assistant_suggestion_immutable/, async () => {
    await upd(app, "assistant_suggestion", G1, { fields: JSON.stringify({ case_for_change: "changed" }) }, { audit: true });
  });
  await expectFailure(app, "SG13 a non-stepping suggestion version fails (assistant_suggestion_version_step)", /assistant_suggestion_version_step/, async () => {
    await upd(app, "assistant_suggestion", G1, { status: "taken_to_draft", taken_at: new Date().toISOString(), taken_by: U1 }, { step: 2, audit: true });
  });
  await expectFailure(app, "SG14 taking to a draft without its audit event fails at COMMIT", /assistant_suggestion_audit_required/, async () => {
    await upd(app, "assistant_suggestion", G1, { status: "taken_to_draft", taken_at: new Date().toISOString(), taken_by: U1 });
  });
  await expectSuccess(app, "SG15 the owner takes the charter draft suggestion to a draft (proposed -> taken_to_draft, audited)", async () => {
    await upd(app, "assistant_suggestion", G1, { status: "taken_to_draft", taken_at: new Date().toISOString(), taken_by: U1 }, { audit: true }); return "committed";
  });
  await expectFailure(app, "SG16 taken_to_draft is final (assistant_suggestion_final)", /assistant_suggestion_final/, async () => {
    await upd(app, "assistant_suggestion", G1, { taken_at: new Date().toISOString() }, { audit: true });
  });
  await expectFailure(app, "SG17 mth_app cannot DELETE a suggestion, a conversation or a message (no grant)", /permission denied/, async () => {
    await app.query(`DELETE FROM assistant_suggestion`);
  });
  {
    const r = (await app.query(`SELECT (SELECT count(*) FROM form_draft)::int AS drafts, (SELECT count(*) FROM charter WHERE case_for_change IS NOT NULL)::int AS charters`)).rows[0];
    report("SG18 taking a suggestion to a draft wrote nothing outside the assistant tables (no form_draft, no charter text)", r.drafts === 0 && r.charters === 0, JSON.stringify(r));
  }
  {
    const after = await md5(own);
    report("NW01 after every assistant probe, initiatives, transformations and gate instances are byte-identical to before the upgrade (only the audit count grew by the probe's own events)",
      after.split("/").slice(0, 3).join("/") === before.split("/").slice(0, 3).join("/"), `${after.split("/").slice(0, 3).join("/") === before.split("/").slice(0, 3).join("/") ? "identical" : "changed"}`);
    const fns = (await own.query(`SELECT string_agg(DISTINCT c.relname, ',' ORDER BY c.relname) AS t FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
      WHERE NOT tg.tgisinternal AND tg.tgfoid IN (SELECT oid FROM pg_proc WHERE proname LIKE 'assistant%' OR proname LIKE 'p6_assistant%')`)).rows[0].t;
    report("NW02 the assistant's trigger functions are attached only to the four assistant tables (the history table is written by assistant_setting_history on assistant_setting)", fns === "assistant_conversation,assistant_message,assistant_setting,assistant_suggestion", fns);
    const priv = (await own.query(`SELECT string_agg(table_name || ':' || privilege_type, ',' ORDER BY table_name, privilege_type) AS p FROM information_schema.role_table_grants
      WHERE grantee = 'mth_app' AND table_name LIKE 'assistant%'`)).rows[0].p;
    report("NW03 mth_app's grants on the assistant tables: no DELETE anywhere, history and messages without UPDATE", !/DELETE/.test(priv) && !/assistant_message:UPDATE|assistant_setting_change:(UPDATE|INSERT)/.test(priv), priv);
  }

  // -------------------------------------------------------------------------------------------- permissions
  {
    const rows = (await app.query(`SELECT p.code, p.category, coalesce(string_agg(r.code, ',' ORDER BY r.code), '') AS roles FROM permission p
      LEFT JOIN role_permission rp ON rp.permission_code = p.code LEFT JOIN role r ON r.id = rp.role_id
      WHERE p.code IN ('assistant.use', 'assistant.configure') GROUP BY p.code, p.category ORDER BY p.code`)).rows;
    console.log("        0112 seed: " + rows.map((r: any) => `${r.code}(${r.category})=${r.roles}`).join("; "));
    report("PM01 0112 seeds 2 codes (assistant.configure configure, assistant.use write), none business_approval or finance_validation",
      rows.length === 2 && rows[0].category === "configure" && rows[1].category === "write", `${rows.length} codes`);
    const u = rows.find((r: any) => r.code === "assistant.use")?.roles ?? "";
    report("PM02 assistant.use is held by the 13 roles other than AUD", u.split(",").length === 13 && !u.split(",").includes("AUD"), u);
    const c = rows.find((r: any) => r.code === "assistant.configure")?.roles ?? "";
    report("PM03 assistant.configure is held by ADM_TECH only", c === "ADM_TECH", c);
  }
  await expectFailure(own, "PM04 the technical-admin trigger still refuses a business-approval code for ADM_TECH (REQ-S10-003)", /technical|approval|check_violation|P0001/i, async () => {
    const code = (await own.query(`SELECT code FROM permission WHERE category = 'business_approval' LIMIT 1`)).rows[0].code;
    await own.query(`INSERT INTO role_permission (role_id, permission_code) VALUES ('01920000-0000-7000-8000-00000000000c', $1)`, [code]);
  });

  // -------------------------------------------------------------------------------------------- D-199 list bounds
  // Catalogue tables: mth_app cannot INSERT, so their row count is fixed by migrations (a change is a new migration).
  const catalogue: [string, string][] = [
    ["listPermissions", "permission"], ["listRoles", "role"], ["listRoleAccountabilities", "role_accountability"], ["listPhases", "phase_definition"],
    ["listGuidingQuestions", "guiding_question"], ["listDecisionRightTemplates", "decision_right_template"], ["listGovernanceParties", "governance_party"],
    ["listAdoptionIndicatorTemplates", "adoption_indicator_template"], ["listBenefitFormulaExamples", "benefit_formula_example"],
    ["listFormRecordTypes", "form_record_type"], ["listReportDefinitions", "report_definition"], ["listTemplateSourceLinks", "playbook_block_link"],
    ["listConfigReviewPolicies", "config_review_policy"], ["listJobOperations", "job_schedule"], ["listHealthCheckQuestions", "source_element"],
  ];
  const counts: string[] = [];
  let allFixed = true;
  for (const [op, t] of catalogue) {
    const r = (await own.query(`SELECT has_table_privilege('mth_app', $1, 'INSERT') AS ins, (SELECT count(*) FROM ${t})::int AS n`, [t])).rows[0];
    if (r.ins) allFixed = false;
    counts.push(`${op}=${t}:${r.n}${r.ins ? "(INSERT!)" : ""}`);
  }
  report("LB01 the 15 catalogue lists read tables mth_app cannot INSERT into (rows fixed by migrations)", allFixed, counts.join(" "));
  {
    const hq = (await own.query(`SELECT count(*)::int AS n FROM source_element WHERE set_code = 'health_question'`)).rows[0].n;
    report("LB02 listHealthCheckQuestions: 25 health_question source elements", hq === 25, `${hq}`);
  }
  const keyed = (await own.query(`SELECT
      (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'gate_instance_gate_key') AS gi,
      (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'governance_matrix_kind_key') AS gm,
      (SELECT string_agg(pg_get_constraintdef(oid), ' ; ') FROM pg_constraint WHERE conrelid = 'governance_matrix'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%kind%') AS gmk,
      (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'transformation_config_pin_kind_key') AS tp,
      (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'transformation_config_pin_kind_check') AS tpk,
      (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'gate_submission_criterion_key') AS gsc,
      (SELECT count(*)::int FROM gate_definition) AS gates, (SELECT count(*)::int FROM gate_criterion_definition) AS criteria,
      (SELECT max(n)::int FROM (SELECT count(*) AS n FROM gate_criterion_definition GROUP BY gate_definition_id) x) AS max_criteria_per_gate,
      has_table_privilege('mth_app', 'gate_definition', 'INSERT') AS gd_ins, has_table_privilege('mth_app', 'gate_criterion_definition', 'INSERT') AS gcd_ins`)).rows[0];
  console.log("        keyed bounds: " + JSON.stringify(keyed));
  report("LB03 listGates: UNIQUE (transformation_id, gate_code) over 6 gate definitions mth_app cannot add -> at most 6 per transformation",
    /UNIQUE \(transformation_id, gate_code\)/.test(keyed.gi) && keyed.gates === 6 && !keyed.gd_ins, keyed.gi);
  report("LB04 listGovernanceMatrices: UNIQUE (transformation_id, kind), kind IN (decision_rights, raci) -> at most 2", /UNIQUE \(transformation_id, kind\)/.test(keyed.gm) && /decision_rights.*raci/.test(keyed.gmk ?? ""), `${keyed.gm}; ${keyed.gmk}`);
  report("LB05 listTransformationConfigPins: UNIQUE (transformation_id, kind) over a closed kind CHECK", /UNIQUE \(transformation_id, kind\)/.test(keyed.tp) && /ARRAY\[/.test(keyed.tpk ?? ""), `${keyed.tp}; ${keyed.tpk}`);
  report("LB06 listGateSubmissionCriteria: UNIQUE (gate_submission_id, criterion_key) over 32 criterion definitions mth_app cannot add (at most the gate's own, max per gate shown)",
    /UNIQUE \(gate_submission_id, criterion_key\)/.test(keyed.gsc) && keyed.criteria === 32 && !keyed.gcd_ins, `${keyed.gsc}; max per gate ${keyed.max_criteria_per_gate}`);

  await app.end();
  await own.end();
  console.log(`\n${total - failures}/${total} PASS${failures ? `, ${failures} FAIL` : ""}`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
