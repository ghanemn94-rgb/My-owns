// T-DG6-ARCH-04 migration and guard probe (solution-architect). Run against a DISPOSABLE cluster only:
//   QA_PG_PORT=<port in 23700-23749> MTH_PORT_POOL=<rest of 23700-23749> tests/qa/support/with-pg.sh \
//     node --conditions=@mth/source docs/delivery/handbacks/DG6/T-DG6-ARCH-04-evidence/probe.ts
// 1. Fresh database: all migrations 0001..last.
// 2. P5-populated database: 0001..0097 plus synthetic fixtures (a transformation instantiated by the DG3 function,
//    initiatives, users); then 0098..last on top.
// 3. Guard probes on the slice H/G tables (ADR-0057, ADR-0058). "PASS" means the guard fired (or, for an
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
const SLICE = [108, 109, 110];
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

async function main(): Promise<void> {
  const files = readdirSync(migrationsDir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  console.log(`migrations shipped: ${files.length} (${files[0]} .. ${files[files.length - 1]})`);
  const ids = files.map((f) => Number(f.slice(0, 4)));
  report("G00 slice H/G migrations 0108-0110 present directly above 0107 (D-196); nothing above 0110",
    SLICE.every((n) => ids.includes(n)) && ids.includes(107) && Math.max(...ids) === 110, `ids >= 98: ${ids.filter((n) => n >= 98).join(",")}`);

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
    + "/" + (await c.query(`SELECT count(*)::text AS n FROM audit_event`)).rows[0].n;
  let before = "";
  {
    const c = await client(db);
    const n = (await c.query(`SELECT (SELECT count(*) FROM initiative)::int AS i, (SELECT count(*) FROM transformation)::int AS t, (SELECT count(*) FROM app_user)::int AS u`)).rows[0];
    report("G02 P5 database populated (0001-0097; 2 transformations, one instantiated by the DG3 function; 12 initiatives; 3 users)",
      p5Applied.length === p5Files.length && n.i === 12 && n.t === 2 && n.u === 3, `applied ${p5Applied.length}; ${JSON.stringify(n)}`);
    before = await md5(c);
    await c.end();
  }
  const onTop = await migrate(roleUrl(db, "mth_owner"), { dir: migrationsDir });
  {
    const c = await client(db);
    report("G03 P6 (0098..last, including slice H/G 0108-0110) over the P5 database apply",
      onTop.length === files.length - p5Files.length && onTop.join(",").includes("0110"), `applied ${onTop.length}: ${onTop.join(", ")}`);
    const after = await md5(c);
    const r = (await c.query(`SELECT (SELECT count(*) FROM search_document)::int AS docs, (SELECT count(*) FROM saved_view)::int AS views,
      (SELECT count(*) FROM search_index_state)::int AS states, (SELECT count(*) FROM search_index_state WHERE last_audit_seq = 0 AND documents_count IS NULL AND status = 'idle')::int AS fresh_states,
      (SELECT count(*) FROM help_topic)::int AS topics, (SELECT count(*) FROM load_dataset_marker)::int AS markers`)).rows[0];
    report("G04 the upgrade leaves existing rows as they were (initiatives and transformations byte-identical, audit count unchanged); no document, view or marker; 12 index states at sequence 0 with an Unknown count; 11 help topics",
      after === before && r.docs === 0 && r.views === 0 && r.states === 12 && r.fresh_states === 12 && r.topics === 11 && r.markers === 0, `${after === before ? "identical" : `changed ${before} -> ${after}`}; ${JSON.stringify(r)}`);
    const ix = (await c.query(`SELECT string_agg(indexname, ',' ORDER BY indexname) AS n FROM pg_indexes WHERE indexname IN ('initiative_owner_idx','initiative_lead_idx','initiative_code_sort_idx','initiative_name_sort_idx','initiative_planned_end_sort_idx','transformation_code_sort_idx','transformation_updated_sort_idx','audit_event_feed_idx','search_document_en_idx','search_document_ar_idx','search_document_simple_idx')`)).rows[0].n;
    report("G05 the 11 named indexes of 0108 and 0110 exist", ix.split(",").length === 11, ix);
    await c.end();
  }

  const app = await client(db, "mth_app");
  const own = await client(db, "mth_owner");
  // -------------------------------------------------------------------------------------------- text search configs
  {
    const r = (await app.query(`SELECT string_agg(cfgname, ',' ORDER BY cfgname) AS n FROM pg_ts_config WHERE cfgname IN ('english', 'arabic', 'simple')`)).rows[0].n;
    const v = (await app.query(`SHOW server_version`)).rows[0].server_version;
    report("S01 the english, arabic and simple text search configurations exist on this server", r === "arabic,english,simple", `${r}; server_version ${v}`);
  }
  // -------------------------------------------------------------------------------------------- search_document
  const doc = (recordType: string, recordId: string, o: Record<string, unknown> = {}) => ({ id: uid(), organization_id: ORG, transformation_id: TR,
    record_type: recordType, record_id: recordId, record_version: 1, code: null, title: "Synthetic", summary: null, record_status: "draft", source_audit_seq: 10, ...o });
  const D1 = uid();
  await expectSuccess(app, "SD01 the index job writes a document without an audit event (derived row, not audited)", async () => {
    await insRow(app, "search_document", { ...doc("initiative", INI(1), { code: "INI-01", title: "Synthetic network initiatives roll-out", summary: "Upgrade towers in the central region" }), id: D1 });
    await insRow(app, "search_document", doc("initiative", INI(2), { code: "INI-02", title: "مبادرات تحسين تجربة العملاء", summary: "تحسين الخدمات الرقمية" }));
    await insRow(app, "search_document", doc("transformation", TR, { code: "SYN-T1", title: "Synthetic transformation" }));
    return "committed";
  });
  {
    const en = (await app.query(`SELECT count(*)::int AS n FROM search_document WHERE search_en @@ websearch_to_tsquery('english', 'initiative tower')`)).rows[0].n;
    const ar = (await app.query(`SELECT count(*)::int AS n FROM search_document WHERE search_ar @@ websearch_to_tsquery('arabic', 'تحسين')`)).rows[0].n;
    const code = (await app.query(`SELECT count(*)::int AS n FROM search_document WHERE search_simple @@ websearch_to_tsquery('simple', 'ini-02')`)).rows[0].n;
    const arv = (await app.query(`SELECT to_tsvector('arabic', 'مبادرات تحسين')::text AS v`)).rows[0].v;
    report("S02 stemmed English ('initiative tower' finds 'initiatives ... towers'), Arabic ('تحسين') and code ('ini-02', simple) queries each find their document",
      en === 1 && ar === 1 && code === 1, `en ${en}, ar ${ar}, code ${code}; to_tsvector('arabic','مبادرات تحسين') = ${arv}`);
  }
  await expectFailure(app, "SD02 a document update that does not step the version by 1 is refused", /search_document_version_step/, async () => {
    await upd(app, "search_document", D1, { title: "x", source_audit_seq: 11 }, { step: 2 });
  });
  await expectSuccess(app, "SD03 a newer feed event updates the document (version +1, newer audit sequence and record version)", async () => {
    await upd(app, "search_document", D1, { title: "Synthetic network initiatives roll-out (phase 2)", source_audit_seq: 20, record_version: 2 }); return "committed";
  });
  await expectFailure(app, "SD04 a document never goes back to an older audit sequence (a replayed feed event)", /search_document_monotonic/, async () => {
    await upd(app, "search_document", D1, { title: "stale", source_audit_seq: 15 });
  });
  await expectFailure(app, "SD05 a document never goes back to an older record version", /search_document_monotonic/, async () => {
    await upd(app, "search_document", D1, { record_version: 1, source_audit_seq: 25 });
  });
  await expectFailure(app, "SD06 the indexed record of a document never changes", /search_document_identity_fixed/, async () => {
    await upd(app, "search_document", D1, { record_id: INI(3), source_audit_seq: 30 });
  });
  await expectFailure(app, "SD07 one document per record", /search_document_record_key/, async () => { await insRow(app, "search_document", doc("initiative", INI(1))); });
  await expectFailure(app, "SD08 only the 12 indexed record types", /search_document_record_type/, async () => { await insRow(app, "search_document", doc("tom_gap", uid())); });
  await expectFailure(app, "SD09 a transformation document is its own transformation", /search_document_transformation_self/, async () => { await insRow(app, "search_document", doc("transformation", TR2)); });
  await expectFailure(app, "SD10 the document's organization equals its transformation's (p2_row_guard)", /search_document_organization_matches/, async () => {
    await insRow(app, "search_document", doc("initiative", INI(4), { organization_id: ORG2 }));
  });
  await expectSuccess(app, "SD11 the index job removes the document of a removed record (DELETE granted)", async () => {
    await app.query(`DELETE FROM search_document WHERE record_type = 'transformation' AND record_id = $1`, [TR]); return "deleted";
  });
  await expectFailure(app, "SD12 a document title is never empty", /search_document_title_check|check_violation/, async () => { await insRow(app, "search_document", doc("initiative", INI(5), { title: "" })); });
  // -------------------------------------------------------------------------------------------- search_index_state
  const stateId = (await app.query(`SELECT id FROM search_index_state WHERE record_type = 'initiative'`)).rows[0].id;
  await expectSuccess(app, "IS01 the feed advances the consumed audit sequence (version +1, no audit event: telemetry)", async () => {
    await upd(app, "search_index_state", stateId, { last_audit_seq: 20, last_incremental_at: "2026-10-27T01:00:00Z", documents_count: 2 }); return "committed";
  });
  await expectFailure(app, "IS02 the consumed audit sequence never goes back outside a reindex", /search_index_state_monotonic/, async () => {
    await upd(app, "search_index_state", stateId, { last_audit_seq: 5 });
  });
  await expectSuccess(app, "IS03 a full reindex starts by resetting the sequence to 0 with status reindexing and a start time", async () => {
    await upd(app, "search_index_state", stateId, { last_audit_seq: 0, status: "reindexing", reindex_started_at: "2026-10-27T01:01:00Z", documents_count: null }); return "committed";
  });
  await expectFailure(app, "IS04 a failed state carries its error code and time", /search_index_state_failed_coded/, async () => {
    await upd(app, "search_index_state", stateId, { status: "failed" });
  });
  await expectFailure(app, "IS05 a non-stepping version is refused", /search_index_state_version_step/, async () => {
    await upd(app, "search_index_state", stateId, { last_audit_seq: 30 }, { step: 0 });
  });
  await expectFailure(app, "IS06 mth_app cannot add an index state (seeded set of 12; INSERT not granted)", /42501|permission denied/, async () => {
    await insRow(app, "search_index_state", { id: uid(), record_type: "initiative" });
  });
  // -------------------------------------------------------------------------------------------- saved_view
  const view = (o: Record<string, unknown> = {}) => ({ id: uid(), organization_id: ORG, owner_user_id: U1, list_key: "initiatives", transformation_id: TR,
    name: "My open initiatives", columns: JSON.stringify(["code", "name", "status", "executiveOwner"]), filters: JSON.stringify({ status: ["draft", "submitted"], executiveOwnerUserId: U1 }),
    sort: JSON.stringify([{ key: "code", direction: "asc" }]), created_by: U1, updated_by: U1, ...o });
  const V1 = uid();
  await expectSuccess(app, "SV01 create a personal view (columns, filters, sort) with its audit event", async () => {
    await insRow(app, "saved_view", view({ id: V1, is_default: true })); await audit(app, "saved_view", V1, 1); return "committed";
  });
  {
    const h = (await app.query(`SELECT count(*)::int AS n, min(record_version) AS v, min(status) AS s FROM saved_view_event WHERE saved_view_id = $1`, [V1])).rows[0];
    report("SV02 the history row is written by the trigger at version 1", h.n === 1 && h.v === 1 && h.s === "active", JSON.stringify(h));
  }
  await expectFailure(app, "SV03 a view without its audit event fails at COMMIT", /saved_view_audit_required/, async () => { await insRow(app, "saved_view", view({ name: "No audit" })); });
  await expectFailure(app, "SV04 a non-stepping version is refused", /saved_view_version_step/, async () => { await upd(app, "saved_view", V1, { name: "x" }, { step: 2, audit: true }); });
  await expectFailure(app, "SV05 columns: an empty list is refused", /saved_view_columns_valid/, async () => { const id = uid(); await insRow(app, "saved_view", view({ id, name: "c1", columns: "[]" })); await audit(app, "saved_view", id, 1); });
  await expectFailure(app, "SV06 columns: a repeated column is refused", /saved_view_columns_valid/, async () => { const id = uid(); await insRow(app, "saved_view", view({ id, name: "c2", columns: JSON.stringify(["code", "code"]) })); await audit(app, "saved_view", id, 1); });
  await expectFailure(app, "SV07 filters: a number value is refused (values are strings)", /saved_view_filters_valid/, async () => { const id = uid(); await insRow(app, "saved_view", view({ id, name: "f1", filters: JSON.stringify({ amount: 12.5 }) })); await audit(app, "saved_view", id, 1); });
  await expectFailure(app, "SV08 filters: more than 20 values in one filter are refused", /saved_view_filters_valid/, async () => { const id = uid(); await insRow(app, "saved_view", view({ id, name: "f2", filters: JSON.stringify({ status: Array.from({ length: 21 }, (_, i) => `s${i}`) }) })); await audit(app, "saved_view", id, 1); });
  await expectFailure(app, "SV09 sort: more than 3 keys are refused", /saved_view_sort_valid/, async () => { const id = uid(); await insRow(app, "saved_view", view({ id, name: "s1", sort: JSON.stringify(["a", "b", "c", "d"].map((k) => ({ key: k, direction: "asc" }))) })); await audit(app, "saved_view", id, 1); });
  await expectFailure(app, "SV10 sort: a direction other than asc/desc is refused", /saved_view_sort_valid/, async () => { const id = uid(); await insRow(app, "saved_view", view({ id, name: "s2", sort: JSON.stringify([{ key: "code", direction: "up" }]) })); await audit(app, "saved_view", id, 1); });
  await expectFailure(app, "SV11 one active view per owner, list, transformation and case-insensitive name", /saved_view_name_key/, async () => { const id = uid(); await insRow(app, "saved_view", view({ id, name: "MY OPEN INITIATIVES" })); await audit(app, "saved_view", id, 1); });
  await expectFailure(app, "SV12 one default view per owner, list and transformation", /saved_view_one_default_key/, async () => { const id = uid(); await insRow(app, "saved_view", view({ id, name: "Second default", is_default: true })); await audit(app, "saved_view", id, 1); });
  await expectFailure(app, "SV13 only the owner changes a view", /saved_view_owner_only/, async () => { await upd(app, "saved_view", V1, { name: "Hijacked", updated_by: U2 }, { audit: true, actor: U2 }); });
  await expectFailure(app, "SV14 the owner never changes", /saved_view_identity_fixed|saved_view_owner_is_creator/, async () => { await upd(app, "saved_view", V1, { owner_user_id: U2 }, { audit: true }); });
  await expectFailure(app, "SV15 sharing needs both the share time and the sharer", /saved_view_shared_shape/, async () => { await upd(app, "saved_view", V1, { visibility: "shared" }, { audit: true }); });
  await expectFailure(app, "SV16 only the owner shares a view", /saved_view_owner_only/, async () => { await upd(app, "saved_view", V1, { visibility: "shared", shared_at: "2026-10-27T01:02:00Z", shared_by: U2 }, { audit: true }); });
  await expectSuccess(app, "SV17 the owner shares the view (version +1, audited)", async () => {
    await upd(app, "saved_view", V1, { visibility: "shared", shared_at: "2026-10-27T01:02:00Z", shared_by: U1 }, { audit: true }); return "committed";
  });
  await expectFailure(app, "SV18 the transformations list is cross-transformation (no transformation id)", /saved_view_cross_transformation_lists/, async () => { const id = uid(); await insRow(app, "saved_view", view({ id, name: "t1", list_key: "transformations" })); await audit(app, "saved_view", id, 1); });
  await expectFailure(app, "SV19 a list outside the 12 is refused", /saved_view_list_key_check|check_violation/, async () => { const id = uid(); await insRow(app, "saved_view", view({ id, name: "l1", list_key: "benefits" })); await audit(app, "saved_view", id, 1); });
  await expectFailure(app, "SV20 a view of another organization's transformation is refused", /saved_view_organization_matches/, async () => { const id = uid(); await insRow(app, "saved_view", view({ id, name: "o1", transformation_id: TR2 })); await audit(app, "saved_view", id, 1); });
  await expectFailure(app, "SV21 a view in another organization than its owner's is refused", /saved_view_organization_matches/, async () => { const id = uid(); await insRow(app, "saved_view", view({ id, name: "o2", organization_id: ORG2, transformation_id: null })); await audit(app, "saved_view", id, 1, U1, ORG2); });
  await expectFailure(app, "SV22 a view starts active", /saved_view_transition|saved_view_deleted_shape/, async () => { const id = uid(); await insRow(app, "saved_view", view({ id, name: "d0", status: "deleted", deleted_at: "2026-10-27T01:00:00Z" })); await audit(app, "saved_view", id, 1); });
  await expectFailure(app, "SV23 a deleted view is never the default", /saved_view_deleted_not_default/, async () => { await upd(app, "saved_view", V1, { status: "deleted", deleted_at: "2026-10-27T01:03:00Z" }, { audit: true }); });
  await expectSuccess(app, "SV24 the owner deletes the view (not default any more, deleted time set, audited)", async () => {
    await upd(app, "saved_view", V1, { status: "deleted", deleted_at: "2026-10-27T01:03:00Z", is_default: false }, { audit: true }); return "committed";
  });
  await expectFailure(app, "SV25 a deleted view never changes", /saved_view_final/, async () => { await upd(app, "saved_view", V1, { name: "Back" }, { audit: true }); });
  await expectSuccess(app, "SV26 after deletion the name is free again for the owner", async () => { const id = uid(); await insRow(app, "saved_view", view({ id })); await audit(app, "saved_view", id, 1); return "committed"; });
  {
    const h = (await app.query(`SELECT string_agg(record_version || ':' || visibility || ':' || status, ',' ORDER BY record_version) AS h FROM saved_view_event WHERE saved_view_id = $1`, [V1])).rows[0].h;
    report("SV27 the history holds every version of the view (create, share, delete)", h === "1:personal:active,2:shared:active,3:shared:deleted", h);
  }
  await expectFailure(app, "SV28 the history is append-only (UPDATE refused, even for the owner role)", /append-only|42501/, async () => { await own.query(`UPDATE saved_view_event SET name = 'x' WHERE saved_view_id = $1`, [V1]); });
  await expectFailure(app, "SV29 the history is append-only (DELETE refused, even for the owner role)", /append-only|42501/, async () => { await own.query(`DELETE FROM saved_view_event WHERE saved_view_id = $1`, [V1]); });
  await expectFailure(app, "SV30 mth_app cannot delete a view row (soft delete only; DELETE not granted)", /42501|permission denied/, async () => { await app.query(`DELETE FROM saved_view WHERE id = $1`, [V1]); });
  // -------------------------------------------------------------------------------------------- help_topic
  {
    const r = (await app.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE arabic_provisional AND title_ar LIKE '%ترجمة مؤقتة%' AND body_ar LIKE '%ترجمة مؤقتة%')::int AS labelled,
      count(DISTINCT screen_key)::int AS screens, bool_and(body_en NOT LIKE '%PMI%' AND body_en NOT LIKE '%certified%') AS no_claim FROM help_topic`)).rows[0];
    report("HT01 11 help topics on 5 screens, every Arabic title and body labelled provisional; no PMI or certification claim", r.n === 11 && r.labelled === 11 && r.screens === 5 && r.no_claim, JSON.stringify(r));
    const draft = (await app.query(`SELECT body_en FROM help_topic WHERE topic_key = 'records.drafts'`)).rows[0].body_en;
    report("HT02 the drafts topic uses the exact label 'Draft - not submitted' (REQ-S15-011)", draft.includes("'Draft - not submitted'"), draft.slice(0, 120));
  }
  await expectFailure(app, "HT03 mth_app cannot change help topics (SELECT only)", /42501|permission denied/, async () => { await app.query(`UPDATE help_topic SET title_en = 'x'`); });
  await expectFailure(app, "HT04 a source reference outside M/B/REQ anchors is refused", /help_topic_source_refs_check|check_violation/, async () => {
    await own.query(`INSERT INTO help_topic (id, topic_key, screen_key, ordinal, title_en, title_ar, body_en, body_ar, arabic_provisional, source_refs) VALUES ($1, 'x.y', 'x', 1, 'x', 'x', 'x', 'x', true, ARRAY['PMBOK'])`, [uid()]);
  });
  // -------------------------------------------------------------------------------------------- load_dataset_marker
  const marker = `INSERT INTO load_dataset_marker (dataset_code, generator_version, random_seed, transformations, initiatives, kpi_actuals, audit_events, users)
    VALUES ('mth_load_v1', '1.0.0', 20261027, 50, 1000, 10000, 100000, 120)`;
  await expectFailure(own, "LM01 the load marker is refused in a database that already has users and transformations", /load_dataset_marker_empty_database/, async () => { await own.query(marker); });
  await expectFailure(app, "LM02 mth_app cannot write the load marker (SELECT only)", /42501|permission denied/, async () => { await app.query(marker); });
  {
    const fresh = await client("probe_fresh");
    await expectSuccess(fresh, "LM03 the generator writes the marker into an empty freshly migrated database", async () => { await fresh.query(marker); return "committed"; });
    await expectFailure(fresh, "LM04 at most one marker", /load_dataset_marker_pkey/, async () => { await fresh.query(marker); });
    await expectFailure(fresh, "LM05 the marker is append-only (UPDATE refused)", /append-only|42501/, async () => { await fresh.query(`UPDATE load_dataset_marker SET users = 1`); });
    await expectFailure(fresh, "LM06 the marker is append-only (DELETE refused)", /append-only|42501/, async () => { await fresh.query(`DELETE FROM load_dataset_marker`); });
    await fresh.end();
  }
  {
    const fresh2 = "probe_marked";
    await createDb(fresh2);
    await migrate(roleUrl(fresh2, "mth_owner"), { dir: migrationsDir });
    const c = await client(fresh2);
    await c.query(`INSERT INTO deployment_environment (environment_kind, initialized_via) VALUES ('production', 'bootstrap')`);
    await expectFailure(c, "LM07 the load marker is refused in an empty database that carries a production marker", /load_dataset_marker_empty_database/, async () => { await c.query(marker); });
    await c.end();
  }
  // -------------------------------------------------------------------------------------------- permissions
  {
    const rows = (await app.query(`SELECT p.code, p.category, coalesce(string_agg(r.code, ',' ORDER BY r.code), '') AS roles FROM permission p
      LEFT JOIN role_permission rp ON rp.permission_code = p.code LEFT JOIN role r ON r.id = rp.role_id
      WHERE p.code IN ('saved_view.manage', 'saved_view.share') GROUP BY p.code, p.category ORDER BY p.code`)).rows;
    console.log("        0109 seed: " + rows.map((r: any) => `${r.code}(${r.category})=${r.roles}`).join("; "));
    report("PM01 0109 seeds 2 write codes, none business_approval or finance_validation", rows.length === 2 && rows.every((r: any) => r.category === "write"), `${rows.length} codes`);
    const m = rows.find((r: any) => r.code === "saved_view.manage")?.roles ?? "";
    report("PM02 saved_view.manage is held by the 13 roles other than AUD", m.split(",").length === 13 && !m.split(",").includes("AUD"), m);
    const s = rows.find((r: any) => r.code === "saved_view.share")?.roles ?? "";
    report("PM03 saved_view.share is held by exactly BO, KDS, TD, TL, TO, WL", s === "BO,KDS,TD,TL,TO,WL", s);
  }
  await expectFailure(own, "PM04 the technical-admin trigger still refuses a business-approval code for ADM_TECH (REQ-S10-003)", /technical|approval|check_violation|P0001/i, async () => {
    const code = (await own.query(`SELECT code FROM permission WHERE category = 'business_approval' LIMIT 1`)).rows[0].code;
    await own.query(`INSERT INTO role_permission (role_id, permission_code) VALUES ('01920000-0000-7000-8000-00000000000c', $1)`, [code]);
  });

  await app.end();
  await own.end();
  console.log(`\n${total - failures}/${total} PASS${failures ? `, ${failures} FAIL` : ""}`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
