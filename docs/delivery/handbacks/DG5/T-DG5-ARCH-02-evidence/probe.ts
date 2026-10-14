// T-DG5-ARCH-02 migration and guard probe (solution-architect). Run against a DISPOSABLE cluster only:
//   QA_PG_PORT=<port in 23700-23749> MTH_PORT_POOL=23701-23749 tests/qa/support/with-pg.sh \
//     node --conditions=@mth/source docs/delivery/handbacks/DG5/T-DG5-ARCH-02-evidence/probe.ts
// 1. Fresh database: all migrations 0001..last.
// 2. P4-populated database: 0001..0061 with a synthetic transformation instantiated by the DG3 function, then
//    0062..last on top; the existing pin is unchanged and the P5 slice B/C seeds are present.
// 3. Guard probes on the slice B and C tables (ADR-0041, ADR-0042). "PASS" means the guard fired (or, for an
//    expectSuccess probe, that the allowed write committed). The harness (helpers below main) is copied from the
//    T-DG5-ARCH-01 probe. All data is SYNTHETIC and approves nothing.
//    SYNTHETIC and approves nothing.
import { cpSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "../../../../../packages/db/src/migrate.ts";

const pg = createRequire(new URL("../../../../../packages/db/package.json", import.meta.url))("pg");
const admin = process.env.TEST_DATABASE_ADMIN_URL!;
const migrationsDir = new URL("../../../../../packages/db/migrations", import.meta.url).pathname;
const LAST_P4 = 61;
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
async function updx(c: any, table: string, id: string, set: Record<string, unknown>, o: { audit?: boolean; step?: number; tr?: string | null } = {}): Promise<void> {
  const v = (await c.query(`SELECT version FROM ${table} WHERE id = $1`, [id])).rows[0].version;
  const nv = v + (o.step ?? 1);
  const cols = Object.keys(set);
  await c.query(`UPDATE ${table} SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(", ")}${cols.length ? ", " : ""}version = ${nv} WHERE id = $1`, [id, ...Object.values(set)]);
  if (o.audit !== false) await audit(c, table, id, nv, ORG, o.tr === undefined ? null : o.tr);
}
const H = (n: number) => n.toString(16).padStart(64, "0");
const MV1 = "01920002-0000-7000-8000-000000000001"; // methodology v1 (0011)
const SD1 = "01920005-0000-7000-8000-000000000001"; // scoring defaults v1 (0062)

async function draft(c: any, kind: string, key: string, base: string, sha: string, by = U1): Promise<string> {
  const no = (await c.query(`SELECT coalesce(max(version_no), 0) + 1 AS n FROM methodology_version WHERE key = $1`, [key])).rows[0].n;
  return ins(c, "methodology_version", {
    id: uid(), key, version_no: no, status: "draft", draft_stage: "editing", title_en: "Synthetic draft", title_ar: "مسودة تجريبية",
    source_document: "synthetic", definition: "{}", content_sha256: sha, config_kind: kind, origin: "draft",
    based_on_version_id: base, created_by: by, updated_by: by,
  }, true);
}
async function run(c: any, v: string, kind: string, sha: string, result = "pass"): Promise<string> {
  return ins(c, "config_check_run", { id: uid(), methodology_version_id: v, check_kind: kind, content_sha256: sha, result, report: "{}", run_by: U1, created_by: U1 }, true, null);
}
async function el(c: any, v: string, type: string, key: string, origin: string, attrs: object = {}, removed = false): Promise<string> {
  return ins(c, "methodology_element", { id: uid(), methodology_version_id: v, element_type: type, stable_key: key, origin, removed, attributes: JSON.stringify(attrs), created_by: U1, updated_by: U1 });
}

async function auditSvc(c: any, recordType: string, id: string, version: number | null): Promise<void> {
  await audit(c, recordType, id, version);
}

// ---- Slice B/C constants (seed ids of 0068-0070)
const FORMS1 = "01920005-0200-7000-8000-000000000001";
const PROCS1 = "01920005-0300-7000-8000-000000000001";
const textOf = (e: any) => `${e.code ?? ""} ${e.constraint ?? ""} ${e.message}`;

async function main(): Promise<void> {
  const files = readdirSync(migrationsDir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  console.log(`migrations shipped: ${files.length} (${files[0]} .. ${files[files.length - 1]})`);
  const ids = files.map((f) => Number(f.slice(0, 4)));
  report("G00 slice B/C migrations 0068-0070 present; nothing in 0071-0073 from this task", [68, 69, 70].every((n) => ids.includes(n)) && !ids.some((n) => n >= 71 && n <= 73), `ids >= 62: ${ids.filter((n) => n >= 62).join(",")}`);

  await createDb("probe_fresh");
  const applied = await migrate(roleUrl("probe_fresh", "mth_owner"), { dir: migrationsDir });
  report("G01 fresh database: 0001..last apply", applied.length === files.length, `applied ${applied.length}: ${applied.slice(-4).join(", ")}`);

  await createDb("probe_p4");
  const p4Dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "p4-migrations-"));
  for (const f of files.filter((f) => Number(f.slice(0, 4)) <= LAST_P4)) cpSync(join(migrationsDir, f), join(p4Dir, f));
  const p4Applied = await migrate(roleUrl("probe_p4", "mth_owner"), { dir: p4Dir });
  let before: any;
  {
    const c = await client("probe_p4");
    await seedP1(c);
    await c.query("BEGIN");
    await c.query(`SELECT p3_instantiate_transformation($1, $2, 'probe', 'cli')`, [TR, U1]);
    await c.query("COMMIT");
    before = (await c.query(`SELECT id, kind, methodology_version_id, version FROM transformation_config_pin WHERE transformation_id = $1 ORDER BY kind`, [TR])).rows;
    report("G02 P4 database populated (0001-0061; a synthetic transformation instantiated)", p4Applied.length === LAST_P4 && before.length === 1, `applied ${p4Applied.length}; pins ${before.length}`);
    await c.end();
  }
  const onTop = await migrate(roleUrl("probe_p4", "mth_owner"), { dir: migrationsDir });
  {
    const c = await client("probe_p4");
    report("G03 P5 over the P4 database: 0062..last apply", onTop.length === files.length - LAST_P4, `applied ${onTop.length}: ${onTop.join(", ")}`);
    const after = (await c.query(`SELECT id, kind, methodology_version_id, version FROM transformation_config_pin WHERE transformation_id = $1 ORDER BY kind`, [TR])).rows;
    report("G04 the existing pin is byte-identical after 0062..last (no form_schema/procedure pin is back-filled)", JSON.stringify(after) === JSON.stringify(before), JSON.stringify(after.map((r: any) => [r.kind, r.version])));
    const n = (await c.query(`SELECT (SELECT count(*) FROM form_record_type)::int AS rt, (SELECT count(*) FROM form_source_field)::int AS sf, (SELECT count(*) FROM procedure_definition)::int AS pd, (SELECT count(*) FROM methodology_coverage_link)::int AS cl`)).rows[0];
    report("G05 slice B/C seeds present over the P4 database (33 record types, 111 source columns, 10 procedures, 114 coverage links)", n.rt === 33 && n.sf === 111 && n.pd === 10 && n.cl === 114, JSON.stringify(n));
    await c.end();
  }

  const c = await client("probe_fresh", "mth_app");
  const o = await client("probe_fresh", "mth_owner");
  await seedP1(o);
  await o.query("BEGIN");
  await o.query(`SELECT p3_instantiate_transformation($1, $2, 'probe', 'cli')`, [TR, U1]);
  await o.query("COMMIT");

  // ================= Slice B: seeds (REQ-S05-002, REQ-S05-006, REQ-S06-005)
  {
    const r = (await c.query(`SELECT kind, count(*)::int AS n, count(*) FILTER (WHERE extension_badge)::int AS badge FROM form_record_type GROUP BY 1 ORDER BY 1`)).rows;
    const m = Object.fromEntries(r.map((x: any) => [x.kind, [x.n, x.badge]]));
    report("FS01 record types: 15 templates (T10 is the dashboard), 3 source deliverables, 12 M0149 extensions all badged, 3 product records", JSON.stringify(m) === JSON.stringify({ extension: [12, 12], product: [3, 0], source_deliverable: [3, 0], template: [15, 0] }), JSON.stringify(m));
    const gap = (await c.query(`SELECT label_en, field_type, storage_ref FROM form_source_field WHERE record_type = 'T03' AND field_key = 'gap'`)).rows[0];
    report("FS02 T03 'gap' is a registered source column stored in tom_gap.gap", gap?.storage_ref === "tom_gap.gap", JSON.stringify(gap));
    const missing = (await o.query(`SELECT f.record_type, f.storage_ref FROM form_source_field f WHERE f.storage_kind = 'column' AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns ic WHERE ic.table_schema = 'public' AND ic.table_name = split_part(f.storage_ref, '.', 1) AND ic.column_name = split_part(f.storage_ref, '.', 2))`)).rows;
    const nCol = (await o.query(`SELECT count(*)::int AS n FROM form_source_field WHERE storage_kind = 'column'`)).rows[0].n;
    report("FS03 every 'column' storage reference names an existing typed column", missing.length === 0, `${nCol} column refs; missing ${JSON.stringify(missing)}`);
    const badTables = (await o.query(`SELECT f.code, f.table_name FROM form_record_type f WHERE f.table_name IS NOT NULL AND NOT (
        EXISTS (SELECT 1 FROM information_schema.columns ic WHERE ic.table_name = f.table_name AND ic.column_name = 'id')
        AND (f.table_name = 'procedure_definition' OR EXISTS (SELECT 1 FROM information_schema.columns ic WHERE ic.table_name = f.table_name AND ic.column_name = 'transformation_id')))`)).rows;
    report("FS04 every registered record table exists with id and transformation_id (procedure_definition: id only)", badTables.length === 0, JSON.stringify(badTables));
    const types = (await c.query(`SELECT array_agg(DISTINCT field_type ORDER BY field_type) AS t FROM form_source_field`)).rows[0].t;
    const v1 = (await c.query(`SELECT config_kind, status, origin, (SELECT count(*)::int FROM methodology_element e WHERE e.methodology_version_id = m.id) AS els FROM methodology_version m WHERE id = $1`, [FORMS1])).rows[0];
    report("FS05 forms v1 is a published seed of kind form_schema with no element rows (resolves to the registry)", v1.config_kind === "form_schema" && v1.status === "published" && v1.origin === "seed" && v1.els === 0, `${JSON.stringify(v1)}; source field types used: ${types}`);
  }

  // ================= Slice B: form schema draft and element guards
  const SF = H(0xf1);
  let FD = "";
  await expectSuccess(c, "FE01 a form_schema draft (forms v2, based on v1) commits", async () => (FD = await draft(c, "form_schema", "forms", FORMS1, SF)));
  for (const [key, attrs] of [
    ["T03.risk_score", { fieldType: "number", labelEn: "Risk score", labelAr: "درجة المخاطر" }],
    ["T03.coverage", { fieldType: "percentage", labelEn: "Coverage", labelAr: "التغطية" }],
    ["T03.cost", { fieldType: "currency", currencyCode: "SAR", labelEn: "Cost", labelAr: "التكلفة" }],
    ["T03.total", { fieldType: "calculated", expression: "risk_score * 2", labelEn: "Total", labelAr: "الإجمالي" }],
  ] as const)
    await expectSuccess(c, `FE02 extension field ${key} (${attrs.fieldType}) is added to T03 in the draft (REQ-S05-002)`, async () => el(c, FD, "form_field", key, "admin", attrs));
  await expectSuccess(c, "FE03 relabelling the T03 source column 'gap' and adding help commits", async () => el(c, FD, "form_field", "T03.gap", "source", { labelEn: "Gap (as in the source)", helpEn: "The gap between current and target state." }));
  await expectFailure(c, "FE04 deleting the T03 source column 'gap' is refused (REQ-S05-002)", /methodology_element_source_field_protected/, async () => {
    await el(c, FD, "form_field", "T03.gap", "source", {}, true);
  });
  await expectFailure(c, "FE05 changing the type of a source column is refused (type semantics fixed)", /methodology_element_source_field_type_fixed/, async () => {
    await el(c, FD, "form_field", "T03.owner", "source", { fieldType: "text" });
  });
  await expectFailure(c, "FE06 an extension field reusing a source column key is refused", /methodology_element_extension_field_key/, async () => {
    await el(c, FD, "form_field", "T03.target_state", "admin", { fieldType: "text" });
  });
  await expectFailure(c, "FE07 an extension field on a record type without extension fields (phase_step) is refused", /methodology_element_extension_field_key/, async () => {
    await el(c, FD, "form_field", "phase_step.extra", "admin", { fieldType: "text" });
  });
  await expectFailure(c, "FE08 an unknown field type is refused (the eleven types, REQ-S06-005)", /methodology_element_field_type/, async () => {
    await el(c, FD, "form_field", "T03.weird", "admin", { fieldType: "float" });
  });
  await expectFailure(c, "FE09 a calculated field without an expression is refused", /methodology_element_field_settings/, async () => {
    await el(c, FD, "form_field", "T03.calc2", "admin", { fieldType: "calculated" });
  });
  await expectFailure(c, "FE10 a choice field without options is refused", /methodology_element_field_settings/, async () => {
    await el(c, FD, "form_field", "T03.pick", "admin", { fieldType: "choice" });
  });
  await expectFailure(c, "FE11 a form_field element in a methodology-kind draft is refused", /methodology_element_kind_type/, async () => {
    const d = await draft(c, "methodology", "playbook", "01920002-0000-7000-8000-000000000001", H(0xf2));
    await el(c, d, "form_field", "T03.x_extra", "admin", { fieldType: "text" });
  });
  await expectFailure(c, "FE12 an admin-added form (record type) is refused", /methodology_element_form_fixed/, async () => {
    await el(c, FD, "form", "T03", "admin", {});
  });
  await expectFailure(c, "FE13 a source form_field that is not a registered source column is refused", /methodology_element_source_identity/, async () => {
    await el(c, FD, "form_field", "T03.not_a_column", "source", {});
  });
  await expectFailure(c, "FE14 an element write without its audit event fails at COMMIT", /methodology_element_audit_required/, async () => {
    await c.query(`INSERT INTO methodology_element (id, methodology_version_id, element_type, stable_key, origin, attributes, created_by, updated_by) VALUES ($1, $2, 'form_field', 'T03.noaudit', 'admin', '{"fieldType": "text"}', $3, $3)`, [uid(), FD, U1]);
  });

  // Publish forms v2 (preview + compatibility for the hash; the form_schema review switched off by its owner TO).
  await expectSuccess(c, "FE15 forms v2 publishes through the slice A pipeline (preview, compatibility, review policy off)", async () => {
    await run(c, FD, "preview", SF);
    await updx(c, "methodology_version", FD, { draft_stage: "preview" });
    const pol = (await c.query(`SELECT id FROM config_review_policy WHERE config_kind = 'form_schema'`)).rows[0].id;
    await updx(c, "config_review_policy", pol, { review_required: false });
    await updx(c, "methodology_version", FD, { draft_stage: "approved" });
    await run(c, FD, "compatibility", SF);
    await updx(c, "methodology_version", FD, { status: "published", draft_stage: null, published_at: new Date(), published_by: U1 });
    return FD;
  });
  await expectFailure(c, "FE16 an element write into the published forms v2 is refused (immutable)", /methodology_element_draft_only/, async () => {
    await el(c, FD, "form_field", "T03.late", "admin", { fieldType: "text" });
  });

  // ================= Slice B: custom values (REQ-S16-010, REQ-S06-005)
  const GAP1 = uid();
  await inTx(o, () => ins(o, "tom_gap", { id: GAP1, organization_id: ORG, transformation_id: TR, dimension_code: "technology", gap: "Synthetic gap", created_by: U1, updated_by: U1 })).catch((e) => console.log(`note: tom_gap fixture ${textOf(e)}`));
  const gapExists = (await o.query(`SELECT count(*)::int AS n FROM tom_gap WHERE id = $1`, [GAP1])).rows[0].n === 1;
  report("CV00 fixture: a synthetic T03 (tom_gap) record exists", gapExists, GAP1);
  const cv = (vals: object, version = FORMS1, rec = GAP1, rt = "T03") => ({ id: uid(), organization_id: ORG, transformation_id: TR, record_type: rt, record_id: rec, form_schema_version_id: version, field_values: JSON.stringify(vals), created_by: U1, updated_by: U1 });
  await expectFailure(c, "CV01 without a form_schema pin the transformation uses forms v1, which has no extension field: a value is refused", /form_custom_value_unknown_field/, async () => {
    await ins(c, "form_custom_value", cv({ risk_score: "1" }));
  });
  await expectSuccess(o, "CV02 the transformation is pinned to forms v2 (synthetic pin, as BE-D's initializer or a migration would)", async () =>
    ins(o, "transformation_config_pin", { id: uid(), organization_id: ORG, transformation_id: TR, kind: "form_schema", methodology_version_id: FD, pinned_by: U1, created_by: U1, updated_by: U1 }),
  );
  let CV = "";
  await expectSuccess(c, "CV03 decimal number '12.5', percentage stored as the fraction '0.12' (entered as 12%) and currency {amount '1500000.10', SAR} commit", async () =>
    (CV = await ins(c, "form_custom_value", cv({ risk_score: "12.5", coverage: "0.12", cost: { amount: "1500000.10", currencyCode: "SAR" } }, FD))),
  );
  {
    const v = (await c.query(`SELECT field_values FROM form_custom_value WHERE id = $1`, [CV])).rows[0]?.field_values;
    report("CV04 the stored values are the exact decimal strings (no float rounding)", v?.coverage === "0.12" && v?.cost?.amount === "1500000.10", JSON.stringify(v));
  }
  await expectFailure(c, "CV05 a JSON float for a number field is refused (decimal strings only)", /form_custom_value_type_shape/, async () => {
    await updx(c, "form_custom_value", CV, { field_values: JSON.stringify({ risk_score: 12.5 }) });
  });
  await expectFailure(c, "CV06 a currency value without a currency code is refused", /form_custom_value_type_shape/, async () => {
    await updx(c, "form_custom_value", CV, { field_values: JSON.stringify({ cost: { amount: "10.00" } }) });
  });
  await expectFailure(c, "CV07 a stored value for a calculated field is refused (computed at read)", /form_custom_value_type_shape/, async () => {
    await updx(c, "form_custom_value", CV, { field_values: JSON.stringify({ total: "25" }) });
  });
  await expectFailure(c, "CV08 an unknown key is refused (custom-field value violating its schema, REQ-S16-010)", /form_custom_value_unknown_field/, async () => {
    await updx(c, "form_custom_value", CV, { field_values: JSON.stringify({ not_a_field: "x" }) });
  });
  await expectFailure(c, "CV09 values validated against a version other than the pin are refused", /form_custom_value_pinned_version/, async () => {
    await updx(c, "form_custom_value", CV, { form_schema_version_id: FORMS1 });
  });
  await expectFailure(c, "CV10 a record that does not exist in the transformation is refused", /form_custom_value_record_ref/, async () => {
    await ins(c, "form_custom_value", cv({}, FD, uid()));
  });
  await expectFailure(c, "CV11 the record type and id never change", /form_custom_value_record_fixed/, async () => {
    await updx(c, "form_custom_value", CV, { record_id: uid() });
  });
  await expectFailure(c, "CV12 a second value row for the same record is refused (one row per record)", /form_custom_value_record_key/, async () => {
    await ins(c, "form_custom_value", cv({}, FD));
  });
  await expectFailure(c, "CV13 an update without its audit event fails at COMMIT", /form_custom_value_audit_required/, async () => {
    await updx(c, "form_custom_value", CV, { field_values: JSON.stringify({ risk_score: "3" }) }, { audit: false });
  });
  await expectFailure(c, "CV14 an update whose version does not step by 1 is refused", /form_custom_value_version_step/, async () => {
    await updx(c, "form_custom_value", CV, { field_values: JSON.stringify({ risk_score: "3" }) }, { step: 2 });
  });
  await expectSuccess(c, "CV15 clearing a value with JSON null commits", async () => {
    await updx(c, "form_custom_value", CV, { field_values: JSON.stringify({ risk_score: null, coverage: "0.12" }) });
    return CV;
  });

  // ================= Slice B: drafts, comments, attachments (REQ-S05-001)
  const dr = (o2: Record<string, unknown> = {}) => ({ id: uid(), organization_id: ORG, transformation_id: TR, record_type: "T03", record_id: GAP1, base_record_version: 1, owner_user_id: U1, payload: JSON.stringify({ gap: "Draft text" }), created_by: U1, updated_by: U1, ...o2 });
  let DR = "";
  await expectSuccess(c, "FD01 a draft of an existing T03 record commits (saved draft reopens: same row)", async () => (DR = await ins(c, "form_draft", dr())));
  await expectFailure(c, "FD02 a second open draft of the same record by the same user is refused", /form_draft_open_record_key/, async () => {
    await ins(c, "form_draft", dr());
  });
  await expectFailure(c, "FD03 a draft owned by someone other than its creator is refused", /form_draft_owner_is_creator/, async () => {
    await ins(c, "form_draft", dr({ owner_user_id: U2, record_id: null, base_record_version: null }));
  });
  await expectFailure(c, "FD04 a draft of a planned record type (launch_plan) is refused", /form_draft_record_type/, async () => {
    await ins(c, "form_draft", dr({ record_type: "launch_plan", record_id: null, base_record_version: null }));
  });
  await expectSuccess(c, "FD05 closing the draft as saved commits", async () => {
    await updx(c, "form_draft", DR, { status: "closed", closed_reason: "saved", closed_at: new Date() });
    return DR;
  });
  await expectFailure(c, "FD06 a closed draft never changes", /form_draft_status_transition/, async () => {
    await updx(c, "form_draft", DR, { payload: JSON.stringify({ gap: "again" }) });
  });
  await expectFailure(c, "FD07 a draft insert without its audit event fails at COMMIT", /form_draft_audit_required/, async () => {
    await ins(c, "form_draft", dr({ record_id: null, base_record_version: null }), false);
  });

  const cm = (o2: Record<string, unknown> = {}) => ({ id: uid(), organization_id: ORG, transformation_id: TR, record_type: "T03", record_id: GAP1, body: "Synthetic comment", created_by: U1, ...o2 });
  let CM = "";
  await expectSuccess(c, "FC01 a comment on the T03 record commits", async () => (CM = await ins(c, "form_record_comment", cm(), true, null)));
  await expectSuccess(c, "FC02 a reply to it commits", async () => ins(c, "form_record_comment", cm({ parent_comment_id: CM }), true, null));
  await expectFailure(c, "FC03 a reply to a reply is refused (one level)", /form_record_comment_parent_same_record/, async () => {
    const r = (await c.query(`SELECT id FROM form_record_comment WHERE parent_comment_id = $1`, [CM])).rows[0].id;
    await ins(c, "form_record_comment", cm({ parent_comment_id: r }), true, null);
  });
  await expectFailure(o, "FC04 UPDATE of a comment is refused by the append-only trigger, even for the owner (mth_app has no UPDATE grant)", /append-only/, async () => {
    await o.query(`UPDATE form_record_comment SET body = 'x' WHERE id = $1`, [CM]);
  });
  await expectFailure(c, "FC05 DELETE of a comment is refused by the append-only trigger (owner)", /append-only/, async () => {
    await o.query(`DELETE FROM form_record_comment WHERE id = $1`, [CM]);
  });
  await expectFailure(c, "FC06 a comment without its audit event fails at COMMIT", /form_record_comment_audit_required/, async () => {
    await ins(c, "form_record_comment", cm(), false);
  });
  await expectFailure(c, "FC07 a comment on a record of another transformation is refused", /form_record_comment_record_ref/, async () => {
    await ins(c, "form_record_comment", cm({ transformation_id: TR2 }), true, null);
  });

  const EV = uid();
  await inTx(o, () => ins(o, "evidence", { id: EV, organization_id: ORG, transformation_id: TR, kind: "note", title: "Synthetic evidence", note_body: "Synthetic", owner_user_id: U1, created_by: U1, updated_by: U1 })).catch((e) => console.log(`note: evidence fixture ${textOf(e)}`));
  const RAID = uid();
  await inTx(o, () => ins(o, "raid_entry", { id: RAID, organization_id: ORG, transformation_id: TR, entry_type: "risk", code: "R-01", description: "Synthetic risk", impact: "high", probability: "low", owner_user_id: U1, created_by: U1, updated_by: U1 })).catch((e) => console.log(`note: raid fixture ${textOf(e)}`));
  const at = (o2: Record<string, unknown> = {}) => ({ id: uid(), organization_id: ORG, transformation_id: TR, record_type: "T15", record_id: RAID, evidence_id: EV, created_by: U1, updated_by: U1, ...o2 });
  let AT = "";
  await expectSuccess(c, "FA01 attaching evidence to a T15 (RAID) record commits", async () => (AT = await ins(c, "form_record_attachment", at())));
  await expectFailure(c, "FA02 a second active attachment of the same evidence to the same record is refused", /form_record_attachment_active_key/, async () => {
    await ins(c, "form_record_attachment", at());
  });
  await expectFailure(c, "FA03 a T03 record keeps its attachments in the DG2 evidence_link (one canonical place)", /form_record_attachment_use_evidence_link/, async () => {
    await ins(c, "form_record_attachment", at({ record_type: "T03", record_id: GAP1 }));
  });
  await expectFailure(c, "FA04 only the removal columns change", /form_record_attachment_frozen/, async () => {
    await updx(c, "form_record_attachment", AT, { evidence_id: uid() });
  });
  await expectSuccess(c, "FA05 removing the attachment with a reason commits", async () => {
    await updx(c, "form_record_attachment", AT, { status: "removed", removed_at: new Date(), removed_by: U1, remove_reason: "Wrong file" });
    return AT;
  });
  await expectFailure(c, "FA06 a removed attachment never returns to active", /form_record_attachment_status_transition/, async () => {
    await updx(c, "form_record_attachment", AT, { status: "active", removed_at: null, removed_by: null, remove_reason: null });
  });

  // ================= Slice C: seeds (REQ-S06-003, REQ-S06-001)
  {
    const r = (await c.query(`SELECT code, trigger_kind, completion_rule, (SELECT count(*)::int FROM procedure_step_definition s WHERE s.procedure_definition_id = d.id) AS steps FROM procedure_definition d WHERE methodology_version_id = $1 ORDER BY ordinal`, [PROCS1])).rows;
    report("PS01 the ten M0153 procedures are seeded in published procedures v1, each with a trigger and a completion rule", r.map((x: any) => x.code).join(",") === "new_transformation_intake,baseline_validation,kpi_submission,tom_approval,initiative_prioritization,gate_review,scope_target_change,benefit_validation,executive_escalation,bau_handover" && r.every((x: any) => x.trigger_kind && x.completion_rule && x.steps >= 2), JSON.stringify(r.map((x: any) => [x.code, x.steps])));
    const k = (await c.query(`SELECT count(*) FILTER (WHERE condition_input_key IS NOT NULL)::int AS cond, count(*) FILTER (WHERE parallel_group IS NOT NULL)::int AS par, count(*) FILTER (WHERE step_kind = 'approval')::int AS appr FROM procedure_step_definition`)).rows[0];
    report("PS02 the seed has conditional, parallel and approval steps", k.cond >= 2 && k.par >= 4 && k.appr >= 6, JSON.stringify(k));
  }
  await expectFailure(c, "PS03 the application role cannot change a seeded (published) definition", /procedure_definition_draft_only/, async () => {
    await updx(c, "procedure_definition", "01920005-0301-7000-8000-000000000002", { name_en: "Renamed" });
  });

  // ================= Slice C: definition drafts
  const SP_ = H(0xc1);
  let PD = "";
  await expectSuccess(c, "PD01 a procedures draft (v2, based on v1) commits", async () => (PD = await draft(c, "procedure", "procedures", PROCS1, SP_)));
  const def = (o2: Record<string, unknown> = {}) => ({
    id: uid(), methodology_version_id: PD, code: "synthetic_review", origin: "admin", ordinal: 11, name_en: "Synthetic review", name_ar: "مراجعة تجريبية",
    purpose_en: "p", purpose_ar: "p", trigger_kind: "manual", trigger_en: "t", trigger_ar: "t", scope_level: "transformation", scope_en: "s", scope_ar: "s",
    input_schema: JSON.stringify([{ key: "flag", fieldType: "choice", labelEn: "Flag", labelAr: "علامة", required: true, options: ["yes", "no"] }]),
    launch_role_codes: ["TL"], responsible_role_codes: ["TL"], sla_working_days: 5, validation_rules_en: "v", validation_rules_ar: "v",
    approval_mode: "none", approval_role_codes: [], expected_outputs_en: "o", expected_outputs_ar: "o", completion_rule: "all_steps_closed",
    completion_en: "c", completion_ar: "c", effective_from: "2026-11-01", created_by: U1, updated_by: U1, ...o2,
  });
  let NEWDEF = "";
  await expectSuccess(c, "PD02 an admin-authored definition is added to the draft", async () => (NEWDEF = await ins(c, "procedure_definition", def())));
  await expectFailure(c, "PD03 a definition without a trigger is refused (REQ-S06-001)", /trigger_kind|not-null|null value/, async () => {
    await ins(c, "procedure_definition", def({ code: "no_trigger", trigger_kind: null }));
  });
  await expectFailure(c, "PD04 a definition without a completion condition is refused (REQ-S06-001)", /completion_rule|not-null|null value/, async () => {
    await ins(c, "procedure_definition", def({ code: "no_completion", completion_rule: null }));
  });
  await expectFailure(c, "PD05 an event trigger without its event is refused", /procedure_definition_trigger_event/, async () => {
    await ins(c, "procedure_definition", def({ code: "no_event", trigger_kind: "event" }));
  });
  await expectFailure(c, "PD06 ADM_METHOD (technical admin) as a responsible role is refused", /procedure_definition_roles/, async () => {
    await ins(c, "procedure_definition", def({ code: "admin_role", responsible_role_codes: ["ADM_METHOD"] }));
  });
  await expectFailure(c, "PD07 AUD as an approval role is refused", /procedure_definition_roles/, async () => {
    await ins(c, "procedure_definition", def({ code: "aud_appr", approval_mode: "any", approval_role_codes: ["AUD"] }));
  });
  await expectFailure(c, "PD08 removing a seeded definition is refused (REQ-S06-003)", /procedure_definition_source_kept/, async () => {
    await ins(c, "procedure_definition", def({ code: "gate_review", origin: "source", removed: true }));
  });
  const st = (o2: Record<string, unknown> = {}) => ({ id: uid(), procedure_definition_id: NEWDEF, step_key: "s1", ordinal: 1, step_kind: "task", name_en: "S", name_ar: "S", responsible_role_code: "TL", sla_working_days: 2, created_by: U1, updated_by: U1, ...o2 });
  await expectSuccess(c, "PD09 ordered, parallel (shared group) and conditional steps commit", async () => {
    await ins(c, "procedure_step_definition", st());
    await ins(c, "procedure_step_definition", st({ step_key: "p_a", ordinal: 2, parallel_group: "g" }));
    await ins(c, "procedure_step_definition", st({ step_key: "p_b", ordinal: 2, parallel_group: "g" }));
    return ins(c, "procedure_step_definition", st({ step_key: "cond", ordinal: 3, condition_input_key: "flag", condition_operator: "eq", condition_value: '"yes"' }));
  });
  await expectFailure(c, "PD10 two steps on one ordinal without a shared parallel group are refused", /procedure_step_definition_parallel_group/, async () => {
    await ins(c, "procedure_step_definition", st({ step_key: "clash", ordinal: 1 }));
  });
  await expectFailure(c, "PD11 a condition on an undeclared input is refused", /procedure_step_definition_inputs/, async () => {
    await ins(c, "procedure_step_definition", st({ step_key: "c2", ordinal: 4, condition_input_key: "unknown", condition_operator: "present" }));
  });
  await expectFailure(c, "PD12 an approval step without an approver role is refused", /procedure_step_definition_approval_complete/, async () => {
    await ins(c, "procedure_step_definition", st({ step_key: "ap", ordinal: 5, step_kind: "approval" }));
  });
  await expectFailure(c, "PD13 a definition write without its audit event fails at COMMIT", /procedure_definition_audit_required/, async () => {
    await ins(c, "procedure_definition", def({ code: "no_audit" }), false);
  });
  await expectFailure(c, "PD14 a definition update whose version does not step by 1 is refused", /procedure_definition_version_step/, async () => {
    await updx(c, "procedure_definition", NEWDEF, { name_en: "x" }, { step: 2 });
  });
  await expectFailure(c, "PD15 a definition's code never changes", /procedure_definition_identity_fixed/, async () => {
    await updx(c, "procedure_definition", NEWDEF, { code: "renamed_code" });
  });

  // ================= Slice C: instances (REQ-S06-002)
  const defId = async (code: string) => (await c.query(`SELECT id FROM procedure_definition WHERE methodology_version_id = $1 AND code = $2`, [PROCS1, code])).rows[0].id;
  const inst = async (code: string, o2: Record<string, unknown> = {}) => ({ id: uid(), organization_id: ORG, transformation_id: TR, procedure_definition_id: await defId(code), methodology_version_id: PROCS1, procedure_code: code, launched_by: U1, created_by: U1, updated_by: U1, ...o2 });
  async function launch(code: string, o2: Record<string, unknown> = {}): Promise<string> {
    const row = await inst(code, o2);
    await ins(c, "procedure_instance", row);
    const steps = (await c.query(`SELECT id, step_key, ordinal, responsible_role_code FROM procedure_step_definition WHERE procedure_definition_id = $1 ORDER BY ordinal, step_key`, [row.procedure_definition_id])).rows;
    for (const s of steps)
      await ins(c, "procedure_step_instance", { id: uid(), organization_id: ORG, transformation_id: row.transformation_id, procedure_instance_id: row.id, step_definition_id: s.id, step_key: s.step_key, ordinal: s.ordinal, assignee_role_code: s.responsible_role_code, created_by: U1, updated_by: U1 });
    return row.id as string;
  }
  const stepId = async (i: string, k: string) => (await c.query(`SELECT id FROM procedure_step_instance WHERE procedure_instance_id = $1 AND step_key = $2`, [i, k])).rows[0].id;
  let I1 = "";
  await expectSuccess(c, "PI01 launching baseline_validation creates a persistent instance pinned to the v1 definition with its two steps pending", async () => (I1 = await launch("baseline_validation")));
  {
    const r = (await c.query(`SELECT i.status, i.methodology_version_id, count(s.*)::int AS steps FROM procedure_instance i JOIN procedure_step_instance s ON s.procedure_instance_id = i.id WHERE i.id = $1 GROUP BY 1, 2`, [I1])).rows[0];
    report("PI02 the instance reads back active, pinned to procedures v1, with 2 step instances", r?.status === "active" && r?.methodology_version_id === PROCS1 && r?.steps === 2, JSON.stringify(r));
  }
  await expectFailure(c, "PI03 launching from a draft (unpublished) definition is refused", /procedure_instance_launch/, async () => {
    await ins(c, "procedure_instance", { ...(await inst("baseline_validation")), procedure_definition_id: NEWDEF, methodology_version_id: PD, procedure_code: "synthetic_review" });
  });
  await expectFailure(c, "PI04 an organization-scope procedure launched inside a transformation is refused", /procedure_instance_scope/, async () => {
    await ins(c, "procedure_instance", await inst("new_transformation_intake"));
  });
  await expectFailure(c, "PI05 an input the pinned definition does not declare is refused", /procedure_instance_inputs/, async () => {
    await ins(c, "procedure_instance", await inst("baseline_validation", { input_values: JSON.stringify({ unknown: "x" }) }));
  });
  await expectFailure(c, "PI06 the pinned definition never changes", /procedure_instance_pinned/, async () => {
    await updx(c, "procedure_instance", I1, { procedure_definition_id: await defId("kpi_submission") }, { tr: TR });
  });
  await expectFailure(c, "PI07 activating step 2 while step 1 is open is refused (ordered steps)", /procedure_step_instance_order/, async () => {
    await updx(c, "procedure_step_instance", await stepId(I1, "validate_baseline"), { status: "active", activated_at: new Date() }, { tr: TR });
  });
  const S1i = await stepId(I1, "record_baseline");
  await expectSuccess(c, "PI08 activating step 1 commits", async () => {
    await updx(c, "procedure_step_instance", S1i, { status: "active", activated_at: new Date(), assignee_user_id: U3 }, { tr: TR });
    return S1i;
  });
  await expectFailure(c, "PI09 completing a step with missing required inputs is refused (missing inputs)", /procedure_step_instance_inputs/, async () => {
    await updx(c, "procedure_step_instance", S1i, { status: "completed", completed_at: new Date(), completed_by: U3 }, { tr: TR });
  });
  await expectSuccess(c, "PI10 providing the inputs (decimal value as a string) commits", async () => {
    await updx(c, "procedure_instance", I1, { input_values: JSON.stringify({ metric: "NPS", value: "42.5", unit: "points", baselineDate: "2026-09-30", source: "Synthetic survey" }) }, { tr: TR });
    return I1;
  });
  await expectFailure(c, "PI11 completing an evidence-required step without linked evidence is refused", /procedure_step_instance_evidence/, async () => {
    await updx(c, "procedure_step_instance", S1i, { status: "completed", completed_at: new Date(), completed_by: U3 }, { tr: TR });
  });
  await expectSuccess(c, "PI12 with evidence linked, step 1 completes", async () => {
    await ins(c, "procedure_instance_link", { id: uid(), organization_id: ORG, transformation_id: TR, procedure_instance_id: I1, step_instance_id: S1i, link_kind: "evidence", record_type: "evidence", record_id: EV, created_by: U1 }, true, null);
    await updx(c, "procedure_step_instance", S1i, { status: "completed", completed_at: new Date(), completed_by: U3 }, { tr: TR });
    return S1i;
  });
  await expectFailure(c, "PI13 completing the instance while step 2 is pending is refused (completion condition)", /procedure_instance_completion/, async () => {
    await updx(c, "procedure_instance", I1, { status: "completed", completed_at: new Date() }, { tr: TR });
  });
  await expectFailure(c, "PI14 a closed step never changes", /procedure_step_instance_status_transition/, async () => {
    await updx(c, "procedure_step_instance", S1i, { completion_note: "edited" }, { tr: TR });
  });
  await expectFailure(c, "PI15 a link to a record of another transformation is refused", /procedure_instance_link_record_ref/, async () => {
    await ins(c, "procedure_instance_link", { id: uid(), organization_id: ORG, transformation_id: TR, procedure_instance_id: I1, step_instance_id: null, link_kind: "output", record_type: "transformation", record_id: TR2, created_by: U1 }, true, null);
  });
  const LINK = (await c.query(`SELECT id FROM procedure_instance_link WHERE procedure_instance_id = $1`, [I1])).rows[0].id;
  await expectFailure(o, "PI16 UPDATE of a link is refused by the append-only trigger, even for the owner (mth_app has no UPDATE grant)", /append-only/, async () => {
    await o.query(`UPDATE procedure_instance_link SET record_id = $2 WHERE id = $1`, [LINK, uid()]);
  });
  await expectFailure(c, "PI17 DELETE of a link is refused by the append-only trigger (owner)", /append-only/, async () => {
    await o.query(`DELETE FROM procedure_instance_link WHERE id = $1`, [LINK]);
  });
  await expectFailure(c, "PI18 a step instance update without its audit event fails at COMMIT", /procedure_step_instance_audit_required/, async () => {
    await updx(c, "procedure_step_instance", await stepId(I1, "validate_baseline"), { assignee_user_id: U2 }, { audit: false });
  });
  await expectFailure(c, "PI19 an instance update whose version does not step by 1 is refused", /procedure_instance_version_step/, async () => {
    await updx(c, "procedure_instance", I1, { due_date: "2026-12-01" }, { step: 2, tr: TR });
  });

  // Approval step, skip rule, cancel, exactly-once launch key.
  let I2 = "";
  await expectSuccess(c, "PI20 executive_escalation launches; step 1 completes with its input", async () => {
    I2 = await launch("executive_escalation", { input_values: JSON.stringify({ whyNow: "Synthetic" }) });
    const s = await stepId(I2, "raise_escalation");
    await updx(c, "procedure_step_instance", s, { status: "active", activated_at: new Date() }, { tr: TR });
    await updx(c, "procedure_step_instance", s, { status: "completed", completed_at: new Date(), completed_by: U1 }, { tr: TR });
    await updx(c, "procedure_step_instance", await stepId(I2, "executive_decision"), { status: "active", activated_at: new Date() }, { tr: TR });
    return I2;
  });
  await expectFailure(c, "PI21 an approval step cannot be completed without an approved canonical approval", /procedure_step_instance_approval/, async () => {
    await updx(c, "procedure_step_instance", await stepId(I2, "executive_decision"), { status: "completed", completed_at: new Date(), completed_by: U2 }, { tr: TR });
  });
  await expectFailure(c, "PI22 an approval step cannot be skipped", /procedure_step_instance_not_skippable/, async () => {
    await updx(c, "procedure_step_instance", await stepId(I2, "executive_decision"), { status: "skipped", skip_reason: "No time", skipped_by: U1 }, { tr: TR });
  });
  await expectSuccess(c, "PI23 cancelling the instance (reason) and its open steps commits", async () => {
    for (const k of ["executive_decision", "communicate_decision"])
      await updx(c, "procedure_step_instance", await stepId(I2, k), { status: "cancelled" }, { tr: TR });
    await updx(c, "procedure_instance", I2, { status: "cancelled", cancelled_at: new Date(), cancelled_by: U1, cancel_reason: "Synthetic cancel" }, { tr: TR });
    return I2;
  });
  await expectFailure(c, "PI24 a cancelled instance never becomes active again", /procedure_instance_status_transition/, async () => {
    await updx(c, "procedure_instance", I2, { status: "active", cancelled_at: null, cancelled_by: null, cancel_reason: null }, { tr: TR });
  });
  await expectSuccess(c, "PI25 an automation launch with a launch key commits once", async () => launch("kpi_submission", { launch_key: "probe:kpi:2026-10" }));
  await expectFailure(c, "PI26 a replay with the same launch key is refused (exactly once)", /procedure_instance_launch_key/, async () => {
    await launch("kpi_submission", { launch_key: "probe:kpi:2026-10" });
  });
  await expectFailure(c, "PI27 an instance without its audit event fails at COMMIT", /procedure_instance_audit_required/, async () => {
    await ins(c, "procedure_instance", await inst("kpi_submission"), false);
  });
  await expectFailure(c, "PI28 a step instance copied from another definition's step is refused (pinned)", /procedure_step_instance_pinned/, async () => {
    const other = (await c.query(`SELECT id, step_key, ordinal FROM procedure_step_definition WHERE procedure_definition_id = $1 LIMIT 1`, [await defId("gate_review")])).rows[0];
    await ins(c, "procedure_step_instance", { id: uid(), organization_id: ORG, transformation_id: TR, procedure_instance_id: I1, step_definition_id: other.id, step_key: other.step_key, ordinal: other.ordinal, assignee_role_code: "TL", created_by: U1, updated_by: U1 });
  });

  // ================= Coverage (REQ-S01-003) and permissions
  {
    const r = (await c.query(`SELECT count(*)::int AS n FROM source_element s WHERE NOT EXISTS (SELECT 1 FROM methodology_coverage_link l WHERE l.source_element_id = s.id)`)).rows[0];
    report("CO01 every one of the 80 source elements has at least one linked form or procedure", r.n === 0, `uncovered ${r.n}`);
  }
  await expectFailure(o, "CO02 a coverage link to an unknown form is refused", /methodology_coverage_link_target/, async () => {
    await o.query(`INSERT INTO methodology_coverage_link (id, source_element_id, target_kind, target_code) VALUES ($1, '01920005-0010-7000-8000-000000000001', 'form', 'T99')`, [uid()]);
  });
  await expectFailure(c, "CO03 the application role cannot write coverage links (read-only)", /permission denied/, async () => {
    await c.query(`INSERT INTO methodology_coverage_link (id, source_element_id, target_kind, target_code) VALUES ($1, '01920005-0010-7000-8000-000000000001', 'form', 'T01')`, [uid()]);
  });
  {
    const r = (await c.query(`SELECT p.code, p.category, array_agg(r.code ORDER BY r.code) AS roles FROM permission p LEFT JOIN role_permission rp ON rp.permission_code = p.code LEFT JOIN role r ON r.id = rp.role_id
        WHERE p.code IN ('form_record.comment', 'procedure.read', 'procedure.launch', 'procedure.act', 'procedure.manage') GROUP BY 1, 2 ORDER BY 1`)).rows;
    const noApproval = r.every((x: any) => !["business_approval", "finance_validation"].includes(x.category));
    const audOnlyRead = r.every((x: any) => x.code === "procedure.read" || !x.roles.includes("AUD"));
    const adminsOnlyRead = r.every((x: any) => x.code === "procedure.read" || !x.roles.some((y: string) => y.startsWith("ADM_")));
    report("PM01 five slice B/C codes, none a business approval; AUD and the technical admins hold procedure.read only", r.length === 5 && noApproval && audOnlyRead && adminsOnlyRead, JSON.stringify(r.map((x: any) => [x.code, x.category, x.roles.length])));
  }

  await c.end();
  await o.end();
  console.log(failures === 0 ? "ALL PROBES PASS" : `${failures} PROBE(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});
