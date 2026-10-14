// T-DG5-ARCH-06 migration and guard probe (solution-architect). Run against a DISPOSABLE cluster only:
//   QA_PG_PORT=<port in 23700-23749> MTH_PORT_POOL=<rest of 23700-23749> tests/qa/support/with-pg.sh \
//     node --conditions=@mth/source docs/delivery/handbacks/DG5/T-DG5-ARCH-06-evidence/probe.ts
// 1. Fresh database: all migrations 0001..last.
// 2. P4-populated database: 0001..0061 with a synthetic transformation instantiated by the DG3 function, then
//    0062..last on top.
// 3. Guard probes on the slice I and J tables (ADR-0049, ADR-0050). "PASS" means the guard fired (or, for an
//    expectSuccess probe, that the allowed write committed). API-path writes run as mth_app; catalogue seeds, the
//    environment marker, demo records and dataset runs are written by the owner, as the migrations and the demo CLI
//    do. The one deep fixture (a methodology draft in 'editing') is inserted by the superuser with
//    session_replication_role = replica; the probes themselves run with every trigger on. A third database,
//    probe_demo, is initialized as a demo environment. The harness helpers are copied from the T-DG5-ARCH-05 probe.
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

// ---- slice I and J fixtures (SYNTHETIC; approves nothing)
const MV1 = "01920002-0000-7000-8000-000000000001"; // the seeded methodology version 1 (0011), key 'playbook'
const MDRAFT = "01990000-0000-7000-8000-0000000000f1"; // a synthetic methodology draft (editing)
const B4 = "Practical synthesis inspired by PMI Organizational Transformation, Brightline Transformation Compass and PMI Benefits Realization Management; extended with a custom Target Operating Model toolkit.";
const B124 = "| PMI BRM connection  This phase aligns with PMI Benefits Realization Management logic: identify expected benefits, deliver/measure them during execution, and sustain benefits after transition to the business. |\n|---|";
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4ab0000000049454e44ae426082", "hex");
const sha = (b: Buffer) => require_crypto().createHash("sha256").update(b).digest("hex");
function require_crypto(): typeof import("node:crypto") {
  return createRequire(import.meta.url)("node:crypto");
}
function brand(version: number, o: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: uid(), organization_id: ORG, version_no: version, product_name_en: "Mobily Transformation Hub", product_name_ar: "منصة موبايلي للتحوّل",
    primary_colour: "#0078FF", secondary_colour: "#003B73", colours_provisional: true, font_latin: "IBM Plex Sans", font_arabic: "IBM Plex Sans Arabic",
    created_by: U1, ...o };
}
async function setting(c: any, versionNo: number, headId?: string): Promise<string> {
  if (!headId) return ins(c, "branding_setting", { id: uid(), organization_id: ORG, current_version_no: versionNo, created_by: U1, updated_by: U1 });
  await updx(c, "branding_setting", headId, { current_version_no: versionNo, updated_by: U1 });
  return headId;
}
const block = (ref: string, o: Record<string, unknown> = {}) => ({ block_ref: ref, ordinal: Number(ref.slice(1)), block_kind: "text", text_en: `Synthetic block ${ref}`, text_ar: `كتلة تجريبية ${ref}`, ...o });
const mel = (key: string, attributes: Record<string, unknown>, type = "methodology_text") => ({ id: uid(), methodology_version_id: MDRAFT, element_type: type, stable_key: key,
  origin: "admin", attributes: JSON.stringify(attributes), created_by: U1, updated_by: U1 });

async function main(): Promise<void> {
  const files = readdirSync(migrationsDir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  console.log(`migrations shipped: ${files.length} (${files[0]} .. ${files[files.length - 1]})`);
  const ids = files.map((f) => Number(f.slice(0, 4)));
  report("G00 slice I/J migrations 0089-0091 present; 0092-0093 left free", [89, 90, 91].every((n) => ids.includes(n)) && !ids.includes(92) && !ids.includes(93), `ids >= 85: ${ids.filter((n) => n >= 85).join(",")}`);

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
    const n = (await c.query(`SELECT count(*)::int AS n FROM transformation WHERE id = $1`, [TR])).rows[0].n;
    report("G02 P4 database populated (0001-0061; a synthetic transformation instantiated by the DG3 function)", p4Applied.length === LAST_P4 && n === 1, `applied ${p4Applied.length}`);
    await c.end();
  }
  const onTop = await migrate(roleUrl("probe_p4", "mth_owner"), { dir: migrationsDir });
  {
    const c = await client("probe_p4");
    report("G03 P5 over the P4 database: 0062..last apply", onTop.length === files.length - LAST_P4, `applied ${onTop.length}: ${onTop.slice(-4).join(", ")}`);
    const t = (await c.query(`SELECT count(*)::int AS n FROM transformation WHERE id = $1 AND version = 1`, [TR])).rows[0].n;
    const e = (await c.query(`SELECT (SELECT count(*) FROM deployment_environment)::int AS e, (SELECT count(*) FROM demo_seed_record)::int AS d, (SELECT count(*) FROM branding_version)::int AS b`)).rows[0];
    report("G04 the upgrade writes no environment row, no demo record and no branding version; the DG4 transformation stays at version 1", t === 1 && e.e === 0 && e.d === 0 && e.b === 0, JSON.stringify({ t, ...e }));
    await c.end();
  }

  const db = "probe_fresh";
  const o = await client(db);
  await seedP1(o);
  // ---- 3. seeds
  {
    const q = (await o.query(`SELECT string_agg(text_en, ' ' ORDER BY ordinal) AS q FROM guiding_question`)).rows[0].q;
    report("S01 the four B0016 questions verbatim", q === "Why change? What must become different? How will we execute? How will we prove value?", q);
    const f = (await o.query(`SELECT string_agg(source_en || ' = ' || used_for_en, ' | ' ORDER BY ordinal) AS f FROM source_foundation`)).rows[0].f;
    report("S02 the three B0156 source foundations verbatim", f === "PMI Organizational Transformation Series = Transformation concepts, building blocks, lifecycle, readiness, implementation and orchestration. | Brightline Initiative / Transformation Compass = North Star, transformation operating-system thinking, people-centered transformation and transformation leadership. | PMI Benefits Realization Management = Benefit identification, delivery/measurement and sustainment logic.", f);
    const p = (await o.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE provenance = 'custom_extension')::int AS c,
        string_agg(element_kind || '=' || n_kind, ',' ORDER BY element_kind) FILTER (WHERE rn = 1) AS kinds
        FROM (SELECT *, count(*) OVER (PARTITION BY element_kind) AS n_kind, row_number() OVER (PARTITION BY element_kind ORDER BY ordinal) AS rn FROM methodology_element_profile) x`)).rows[0];
    report("S03 56 element profiles, 50 custom extensions (B0158-B0162: 6 phases, 6 gates, 10 TOM dimensions, 16 templates, scoring model, 5 forums, 3 launch windows, health check, roaming example, traceability chain) and 6 foundation-inspired benefit lifecycle steps",
      p.n === 56 && p.c === 50 && p.kinds === "benefit_lifecycle_step=6,forum=5,gate=6,health_check=1,launch_window=3,phase=6,roaming_example=1,scoring_model=1,template=16,tom_dimension=10,traceability_chain=1", JSON.stringify(p));
    const t = (await o.query(`SELECT count(*)::int AS n, count(DISTINCT question_tag)::int AS d, string_agg(stable_key || ':' || question_tag, ',' ORDER BY ordinal) AS m FROM methodology_element_profile WHERE element_kind = 'template'`)).rows[0];
    report("S04 every template has exactly one question tag, and all four questions are used", t.n === 16 && t.d === 4, t.m);
    const l = (await o.query(`SELECT count(*)::int AS n FROM methodology_element_profile p LEFT JOIN source_element s ON s.id = p.source_element_id WHERE coalesce(s.source_label_en, p.label_en) IS NULL`)).rows[0].n;
    report("S05 every profile resolves a label (its source_element or its own)", l === 0, `unlabelled ${l}`);
    const w = (await o.query(`SELECT string_agg(title_en, ' → ' ORDER BY ordinal) AS w FROM walkthrough_step`)).rows[0].w;
    report("S06 the twelve walkthrough steps equal M0349 verbatim, in order", w === "create transformation → diagnose and agree baseline → define outcomes/KPIs → design TOM → prioritize initiatives and approve mobilization → update delivery/adoption → submit KPI actual → validate benefit → resolve executive decision → generate report → accept BAU handover → continue performance monitoring", w);
    const g = (await o.query(`SELECT string_agg(r.code || ':' || rp.permission_code, ',' ORDER BY r.code, rp.permission_code) AS g FROM role_permission rp JOIN role r ON r.id = rp.role_id
        WHERE rp.permission_code IN ('branding.configure', 'demo.reset')`)).rows[0].g;
    const cat = (await o.query(`SELECT string_agg(code || ':' || category, ',' ORDER BY code) AS c FROM permission WHERE code IN ('branding.configure', 'demo.reset')`)).rows[0].c;
    report("S07 branding.configure and demo.reset are configure codes held by ADM_TECH only", g === "ADM_TECH:branding.configure,ADM_TECH:demo.reset" && cat === "branding.configure:configure,demo.reset:configure", `${g} / ${cat}`);
    const ts = (await o.query(`SELECT string_agg(cfgname, ',' ORDER BY cfgname) AS t FROM pg_ts_config WHERE cfgname IN ('english', 'arabic')`)).rows[0].t;
    report("S08 the pinned server has the 'english' and 'arabic' text search configurations", ts === "arabic,english", `${ts} on ${(await o.query("SHOW server_version")).rows[0].server_version}`);
  }

  // ---- 4. the two text rules (ADR-0049 §7)
  {
    const claims = ["This is an official PMI standard.", "A PMI certified product", "PMI-certified methodology", "certified by PMI", "Officially PMI approved",
      "منهجية معتمدة من PMI", "معيار PMI الرسمي", "شهادة معهد إدارة المشاريع", "هذا معيار رسمي من PMI"];
    const fine = [B4, B124, "Official references", "Not an official PMI standard.", "Practical synthesis inspired by PMI, Brightline and BRM, with custom extensions. Not an official PMI standard.",
      "This product is not PMI certified.", "غير معتمد من PMI", "ليس معيار PMI الرسمي",
      // The shipped About text (apps/web/src/i18n/{en,ar}/common.json methodBody, DG1-DG4) is a true disclaimer and passes.
      "The product operationalizes the Business Transformation Playbook v1.0, a practical synthesis inspired by PMI, Brightline and BRM practice with custom extensions. It is not an official PMI standard, and this product is not certified by PMI or any other body.",
      "يطبّق المنتج دليل تحوّل الأعمال الإصدار 1.0، وهو خلاصة عملية مستوحاة من ممارسات PMI وBrightline وBRM مع إضافات مخصصة. وهو ليس معيارًا رسميًا من PMI، وهذا المنتج غير معتمد من PMI أو من أي جهة أخرى.", "PMI Benefits Realization Management", "aligns with PMI Benefits Realization Management logic", "", null];
    const r1 = (await o.query(`SELECT array_agg(p5_claims_official_pmi(t) ORDER BY i) AS a FROM unnest($1::text[]) WITH ORDINALITY u(t, i)`, [claims])).rows[0].a as boolean[];
    const r2 = (await o.query(`SELECT array_agg(p5_claims_official_pmi(t) ORDER BY i) AS a FROM unnest($1::text[]) WITH ORDINALITY u(t, i)`, [fine])).rows[0].a as boolean[];
    report("T01 p5_claims_official_pmi flags each of the nine official-PMI or certification claims (en, ar)", r1.every(Boolean), JSON.stringify(r1));
    report("T02 p5_claims_official_pmi accepts B0004, B0124, 'Official references', negated disclaimers (en, ar), the shipped About text (en, ar) and empty or null text", r2.every((x) => x === false), JSON.stringify(r2));
    const dg = ["DG7 approved", "Release DG 5", "gate DG-0", "DG٧", "(DG3)"];
    const ok = ["G6 - Sustain", "DG8", "DGX", "EDG7", "DG10", "Product gate G6", null];
    const r3 = (await o.query(`SELECT array_agg(p5_mentions_engineering_gate(t) ORDER BY i) AS a FROM unnest($1::text[]) WITH ORDINALITY u(t, i)`, [dg])).rows[0].a as boolean[];
    const r4 = (await o.query(`SELECT array_agg(p5_mentions_engineering_gate(t) ORDER BY i) AS a FROM unnest($1::text[]) WITH ORDINALITY u(t, i)`, [ok])).rows[0].a as boolean[];
    report("T03 p5_mentions_engineering_gate flags DG0-DG7 (with space, hyphen, Arabic-Indic digit, punctuation)", r3.every(Boolean), JSON.stringify(r3));
    report("T04 p5_mentions_engineering_gate accepts G1-G6, DG8, DG10, EDG7 and null", r4.every((x) => x === false), JSON.stringify(r4));
  }

  // ---- 5. playbook blocks, search, links (fixtures by the owner, as BE-Q's 0092 will)
  const c = await client(db, "mth_app");
  await expectFailure(c, "PB01 mth_app cannot insert a playbook block (read-only catalogue)", /permission denied/, async () => { await c.query(`INSERT INTO playbook_block (block_ref, ordinal, block_kind, text_en, text_ar) VALUES ('B0001', 1, 'text', 'x', 'x')`); });
  await expectSuccess(o, "PB02 the owner seeds blocks B0004, B0026, B0029 (Diagnose), B0031 and B0124 (Realize)", async () => {
    await o.query(`INSERT INTO playbook_block (block_ref, ordinal, block_kind, is_heading, text_en, text_ar) VALUES ('B0004', 4, 'text', false, $1, 'توليفة عملية (ترجمة مؤقتة)')`, [B4]);
    await o.query(`INSERT INTO playbook_block (block_ref, ordinal, block_kind, is_heading, phase_code, text_en, text_ar) VALUES ('B0026', 26, 'text', true, 'diagnose', '01  DIAGNOSE — Build the Fact Base', 'التشخيص — بناء قاعدة الحقائق')`);
    await o.query(`INSERT INTO playbook_block (block_ref, ordinal, block_kind, section_block_ref, phase_code, text_en, text_ar) VALUES ('B0029', 29, 'table', 'B0026', 'diagnose',
      '| Business & Financial | Where is value created/lost? Revenue, margin, cost, churn, productivity? | Baseline P&L bridge, value pools, trend analysis. |', '| الأعمال والمالية | أين تُخلق القيمة أو تُفقد؟ | جسر الأرباح والخسائر، مجمعات القيمة، تحليل الاتجاهات. |')`);
    await o.query(`INSERT INTO playbook_block (block_ref, ordinal, block_kind, section_block_ref, phase_code, text_en, text_ar) VALUES ('B0031', 31, 'table', 'B0026', 'diagnose', '| Area | Current-state evidence |', '| المجال | أدلة الوضع الحالي |')`);
    await o.query(`INSERT INTO playbook_block (block_ref, ordinal, block_kind, phase_code, text_en, text_ar) VALUES ('B0124', 124, 'table', 'realize', $1, 'ترجمة مؤقتة')`, [B124]);
    return "5 blocks";
  });
  {
    const en = (await c.query(`SELECT string_agg(block_ref || ':' || coalesce(phase_code, '-'), ',' ORDER BY ts_rank(search_en, q) DESC, block_ref) AS r FROM playbook_block, websearch_to_tsquery('english', 'value pools') q WHERE search_en @@ q`)).rows[0].r;
    report("PB03 searching 'value pools' (english) returns the Diagnose block B0029", en === "B0029:diagnose", String(en));
    const ar = (await c.query(`SELECT string_agg(block_ref, ',' ORDER BY block_ref) AS r FROM playbook_block, websearch_to_tsquery('arabic', 'مجمعات القيمة') q WHERE search_ar @@ q`)).rows[0].r;
    report("PB04 searching 'مجمعات القيمة' (arabic) returns B0029", ar === "B0029", String(ar));
    const r = (await c.query(`SELECT text_en FROM playbook_block WHERE phase_code = 'realize'`)).rows[0].text_en as string;
    report("PB05 the Realize block says 'aligns with PMI Benefits Realization Management logic' and passes the claim rule", r.includes("aligns with PMI Benefits Realization Management logic") && !(await c.query(`SELECT p5_claims_official_pmi($1) AS x`, [r])).rows[0].x, r.slice(0, 80));
  }
  await expectFailure(o, "PB06 the verbatim English text never changes (as the owner)", /playbook_block_immutable/, async () => { await o.query(`UPDATE playbook_block SET text_en = 'changed' WHERE block_ref = 'B0004'`); });
  await expectSuccess(o, "PB07 the Arabic translation may be corrected by a migration (owner)", async () => { await o.query(`UPDATE playbook_block SET text_ar = 'توليفة عملية مستوحاة (ترجمة مؤقتة)' WHERE block_ref = 'B0004'`); return "updated"; });
  await expectFailure(o, "PB08 a block is never deleted (as the owner)", /playbook_block_immutable/, async () => { await o.query(`DELETE FROM playbook_block WHERE block_ref = 'B0004'`); });
  await expectFailure(o, "PB09 a block is never truncated (as the owner)", /playbook_block_immutable/, async () => { await o.query(`TRUNCATE playbook_block CASCADE`); });
  await expectFailure(o, "PB10 the ordinal equals the block number", /playbook_block_ordinal_matches/, async () => { await o.query(`INSERT INTO playbook_block (block_ref, ordinal, block_kind, text_en, text_ar) VALUES ('B0005', 6, 'text', 'x', 'x')`); });
  await expectFailure(o, "PB11 block refs stop at B0165", /playbook_block_block_ref_check/, async () => { await o.query(`INSERT INTO playbook_block (block_ref, ordinal, block_kind, text_en, text_ar) VALUES ('B0166', 166, 'text', 'x', 'x')`); });
  await expectSuccess(o, "PL01 the owner seeds the link B0031 -> template T01 and REQ-S02-004", async () => {
    await o.query(`INSERT INTO playbook_block_link (block_ref, target_kind, target_key, ordinal) VALUES ('B0031', 'template', 'T01', 1), ('B0031', 'requirement', 'REQ-S02-004', 2)`);
    return "2 links";
  });
  {
    const back = (await c.query(`SELECT string_agg(block_ref, ',') AS b FROM playbook_block_link WHERE target_kind = 'template' AND target_key = 'T01'`)).rows[0].b;
    report("PL02 the T01 form finds its source block B0031 through the link (the reverse direction)", back === "B0031", String(back));
  }
  await expectFailure(o, "PL03 a link names a template T01-T16, a requirement REQ-..., or a procedure code", /playbook_block_link_target_shape/, async () => { await o.query(`INSERT INTO playbook_block_link (block_ref, target_kind, target_key, ordinal) VALUES ('B0031', 'template', 'T17', 3)`); });
  await expectFailure(o, "PL04 links are append-only (as the owner)", /append-only/, async () => { await o.query(`DELETE FROM playbook_block_link WHERE block_ref = 'B0031'`); });

  // ---- 6. element profiles
  await expectFailure(o, "MP01 a question tag only on a template", /methodology_element_profile_question_tag/, async () => {
    await o.query(`INSERT INTO methodology_element_profile (element_ref, element_kind, stable_key, ordinal, label_en, label_ar, provenance, provenance_source_ref, question_tag, source_refs)
                   VALUES ('scoring_model.x', 'scoring_model', 'x', 2, 'x', 'x', 'custom_extension', 'B0161', 'why_change', '{B0076}')`);
  });
  await expectFailure(o, "MP02 the provenance source follows the element kind (a phase is B0158)", /methodology_element_profile_kind_source/, async () => {
    await o.query(`INSERT INTO methodology_element_profile (element_ref, element_kind, stable_key, ordinal, label_en, label_ar, provenance, provenance_source_ref, source_refs)
                   VALUES ('phase.x', 'phase', 'x', 7, 'x', 'x', 'custom_extension', 'B0161', '{B0021}')`);
  });
  await expectFailure(o, "MP03 foundation_inspired exactly when the source is B0156", /methodology_element_profile_provenance/, async () => {
    await o.query(`INSERT INTO methodology_element_profile (element_ref, element_kind, stable_key, ordinal, label_en, label_ar, provenance, provenance_source_ref, source_refs)
                   VALUES ('benefit_lifecycle_step.x', 'benefit_lifecycle_step', 'x', 7, 'x', 'x', 'custom_extension', 'B0156', '{B0121}')`);
  });
  await expectFailure(o, "MP04 a profile's source_element is the same identity", /methodology_element_profile_source_element/, async () => {
    await o.query(`INSERT INTO methodology_element_profile (element_ref, element_kind, stable_key, ordinal, source_element_id, provenance, provenance_source_ref, source_refs)
                   VALUES ('phase.y', 'phase', 'y', 8, '01920005-0011-7000-8000-000000000001', 'custom_extension', 'B0158', '{B0021}')`);
  });
  await expectFailure(o, "MP05 profiles are append-only (as the owner)", /append-only/, async () => { await o.query(`UPDATE methodology_element_profile SET question_tag = 'why_change' WHERE element_ref = 'template.T02'`); });
  await expectFailure(o, "MP06 source refs are B0001-B0165", /methodology_element_profile_source_refs/, async () => {
    await o.query(`INSERT INTO methodology_element_profile (element_ref, element_kind, stable_key, ordinal, label_en, label_ar, provenance, provenance_source_ref, source_refs)
                   VALUES ('scoring_model.z', 'scoring_model', 'z', 3, 'x', 'x', 'custom_extension', 'B0161', '{B0170}')`);
  });

  // ---- 7. Studio reader namespaces on a synthetic methodology draft (written as mth_app, audited)
  await fixture(db, "methodology_version", { id: MDRAFT, key: "playbook", version_no: 2, status: "draft", title_en: "Synthetic methodology draft", title_ar: "مسودة تجريبية",
    source_document: "probe", definition: JSON.stringify({ schema: "mth.methodology/1" }), content_sha256: H(9), config_kind: "methodology", draft_stage: "editing",
    origin: "draft", based_on_version_id: MV1, created_by: U1, updated_by: U1 });
  await expectSuccess(c, "MR01 a profile override: template T01 tagged 'how_execute', provenance kept custom_extension", async () => { await ins(c, "methodology_element", mel("profile.template.T01", { questionTag: "how_execute", provenance: "custom_extension" })); return "ok"; });
  await expectFailure(c, "MR02 a question tag on a non-template profile is refused", /methodology_element_reader_profile/, async () => { await ins(c, "methodology_element", mel("profile.phase.diagnose", { questionTag: "why_change" })); });
  await expectFailure(c, "MR03 a profile key must name a seeded element", /methodology_element_reader_profile/, async () => { await ins(c, "methodology_element", mel("profile.template.T99", { provenance: "custom_extension" })); });
  await expectFailure(c, "MR04 an unknown provenance value is refused", /methodology_element_reader_profile/, async () => { await ins(c, "methodology_element", mel("profile.gate.G1", { provenance: "pmi_standard" })); });
  await expectFailure(c, "MR05 provenance outside the reader namespaces is refused (a template element)", /methodology_element_reader_namespace/, async () => { await ins(c, "methodology_element", { ...mel("T02", { provenance: "custom_extension" }, "template"), origin: "source" }); });
  await expectSuccess(c, "MR06 block guidance and added links on B0031", async () => { await ins(c, "methodology_element", mel("block.B0031", { bodyEn: "Use T01 for the diagnostic.", bodyAr: "استخدم النموذج 1 للتشخيص.", linksAdded: [{ targetKind: "procedure", targetKey: "baseline_validation" }] })); return "ok"; });
  await expectFailure(c, "MR07 a malformed block link is refused", /methodology_element_reader_block/, async () => { await ins(c, "methodology_element", mel("block.B0029", { linksAdded: [{ targetKind: "template", targetKey: "T00" }] })); });
  await expectFailure(c, "MR08 a block key must name a seeded block", /methodology_element_reader_block/, async () => { await ins(c, "methodology_element", mel("block.B0100", { bodyEn: "x" })); });
  await expectFailure(c, "MR09 a provenance note claiming PMI certification is refused", /methodology_element_reader_text/, async () => { await ins(c, "methodology_element", mel("provenance.note", { bodyEn: "This product is PMI certified." })); });
  await expectFailure(c, "MR10 reader text naming an engineering gate is refused", /methodology_element_reader_text/, async () => { await ins(c, "methodology_element", mel("block.B0124", { bodyEn: "Shipped with DG7." })); });
  await expectSuccess(c, "MR11 a negated disclaimer in the provenance note is accepted", async () => { await ins(c, "methodology_element", mel("provenance.note", { bodyEn: "This is not an official PMI standard.", bodyAr: "ليس معيار PMI الرسمي." })); return "ok"; });
  await expectSuccess(c, "MR12 methodology_text outside the reader namespaces is unaffected", async () => { await ins(c, "methodology_element", mel("help.charter", { bodyEn: "Synthetic help." })); return "ok"; });
  await expectFailure(c, "MR13 links on a profile override are refused", /methodology_element_reader_profile/, async () => { await ins(c, "methodology_element", mel("profile.template.T03", { linksAdded: [] })); });

  // ---- 8. branding (ADR-0049 §8)
  let head = "";
  await expectSuccess(c, "BR01 version 1 and the head row (version 1), each with its audit event", async () => { await ins(c, "branding_version", brand(1), true, null); head = await setting(c, 1); return head; });
  await expectSuccess(c, "BR02 version 2 (product name changed, approved colours with a reference, PNG logo, header and footer) and the head steps to version 2", async () => {
    await ins(c, "branding_version", brand(2, { product_name_en: "Transformation Hub (synthetic rename)", product_name_ar: "منصة التحول (اسم تجريبي)", primary_colour: "#005BBB",
      colours_provisional: false, colour_approval_reference: "Synthetic brand approval memo 1", logo_png: PNG, logo_sha256: sha(PNG), logo_alt_en: "Synthetic logo", logo_alt_ar: "شعار تجريبي",
      report_header_en: "Synthetic header", report_header_ar: "ترويسة تجريبية", report_footer_en: "Synthetic footer", report_footer_ar: "تذييل تجريبي" }), true, null);
    await setting(c, 2, head);
    return "v2";
  });
  await expectFailure(c, "BR03 a version that skips a number is refused", /branding_version_step/, async () => { await ins(c, "branding_version", brand(4), true, null); });
  await expectFailure(c, "BR04 a repeated version number is refused", /branding_version_step|branding_version_organization_version_key/, async () => { await ins(c, "branding_version", brand(2), true, null); });
  await expectFailure(c, "BR05 the head must name the latest version", /branding_setting_current_latest|branding_setting_version_matches/, async () => { await ins(c, "branding_version", brand(3), true, null); await updx(c, "branding_setting", head, { current_version_no: 2 }, { step: 0 }); });
  await expectFailure(c, "BR06 a non-stepping head version is refused", /branding_setting_version_step|branding_setting_version_matches/, async () => { await ins(c, "branding_version", brand(3), true, null); await updx(c, "branding_setting", head, { current_version_no: 3 }, { step: 2 }); });
  await expectFailure(c, "BR07 a branding version without its audit event fails at COMMIT", /branding_version_audit_required/, async () => { await ins(c, "branding_version", brand(3), false); await setting(c, 3, head); });
  await expectFailure(c, "BR08 a head update without its audit event fails at COMMIT", /branding_setting_audit_required/, async () => { await ins(c, "branding_version", brand(3), true, null); await updx(c, "branding_setting", head, { current_version_no: 3 }, { audit: false }); });
  await expectFailure(c, "BR09 mth_app cannot update a branding version (no UPDATE privilege)", /permission denied/, async () => { await c.query(`UPDATE branding_version SET product_name_en = 'x'`); });
  await expectFailure(o, "BR10 branding versions are append-only even for the owner (UPDATE)", /append-only/, async () => { await o.query(`UPDATE branding_version SET product_name_en = 'x'`); });
  await expectFailure(o, "BR11 branding versions are append-only even for the owner (DELETE)", /append-only/, async () => { await o.query(`DELETE FROM branding_version`); });
  await expectFailure(c, "BR12 a product name claiming PMI certification is refused", /branding_version_no_pmi_claim/, async () => { await ins(c, "branding_version", brand(3, { product_name_en: "PMI certified Transformation Hub" }), true, null); });
  await expectFailure(c, "BR13 an Arabic footer claiming PMI accreditation is refused", /branding_version_no_pmi_claim/, async () => { await ins(c, "branding_version", brand(3, { report_footer_en: "Footer", report_footer_ar: "منهجية معتمدة من PMI" }), true, null); });
  await expectFailure(c, "BR14 a report header naming an engineering gate is refused", /branding_version_no_engineering_gate/, async () => { await ins(c, "branding_version", brand(3, { report_header_en: "Release DG7", report_header_ar: "الإصدار" }), true, null); });
  await expectFailure(c, "BR15 colours are #RRGGBB upper case", /branding_version_primary_colour_check/, async () => { await ins(c, "branding_version", brand(3, { primary_colour: "#0078ff" }), true, null); });
  await expectFailure(c, "BR16 non-provisional colours need an approval reference", /branding_version_colour_approval/, async () => { await ins(c, "branding_version", brand(3, { colours_provisional: false }), true, null); });
  await expectFailure(c, "BR17 a logo must be a PNG", /branding_version_logo_png_check/, async () => { const svg = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>" + " ".repeat(40)); await ins(c, "branding_version", brand(3, { logo_png: svg, logo_sha256: sha(svg), logo_alt_en: "x", logo_alt_ar: "x" }), true, null); });
  await expectFailure(c, "BR18 the logo hash must match the logo", /branding_version_logo_complete/, async () => { await ins(c, "branding_version", brand(3, { logo_png: PNG, logo_sha256: H(1), logo_alt_en: "x", logo_alt_ar: "x" }), true, null); });
  await expectFailure(c, "BR19 report header texts come in pairs (en and ar)", /branding_version_header_pair/, async () => { await ins(c, "branding_version", brand(3, { report_header_en: "Only English" }), true, null); });
  await expectFailure(c, "BR20 only the bundled fonts", /branding_version_font_latin_check/, async () => { await ins(c, "branding_version", brand(3, { font_latin: "Roboto" }), true, null); });
  await expectSuccess(c, "BR21 another organization numbers its own versions from 1", async () => {
    await ins(c, "branding_version", brand(1, { organization_id: ORG2, created_by: UX }), true, null);
    await ins(c, "branding_setting", { id: uid(), organization_id: ORG2, current_version_no: 1, created_by: UX, updated_by: UX });
    return "ORG2 v1";
  });
  {
    const u = (await o.query(`SELECT string_agg(conname, ',' ORDER BY conname) AS u FROM pg_constraint WHERE conrelid = 'branding_setting'::regclass AND contype IN ('u', 'f')`)).rows[0].u;
    report("BR22 one head row per organization (unique backstop) whose current version is a branding version of that organization (composite foreign key)", u.includes("branding_setting_organization_key") && u.includes("branding_setting_current_fkey"), u);
  }

  // ---- 9. environment and demo (production database: probe_fresh)
  await expectFailure(c, "EN01 mth_app cannot write the environment marker", /permission denied/, async () => { await c.query(`INSERT INTO deployment_environment (environment_kind, initialized_via) VALUES ('demo', 'seed_demo')`); });
  await expectSuccess(o, "EN02 production initialization writes the production marker (owner)", async () => { await o.query(`INSERT INTO deployment_environment (environment_kind, initialized_via) VALUES ('production', 'bootstrap')`); return "production"; });
  await expectFailure(o, "EN03 the environment kind never changes (as the owner)", /append-only/, async () => { await o.query(`UPDATE deployment_environment SET environment_kind = 'demo', initialized_via = 'seed_demo', dataset_code = 'international_roaming', dataset_version = '1.0.0', synthetic_clock_at = now()`); });
  await expectFailure(o, "EN04 at most one environment row", /deployment_environment_pkey/, async () => { await o.query(`INSERT INTO deployment_environment (environment_kind, initialized_via) VALUES ('production', 'bootstrap')`); });
  await expectFailure(o, "EN05 a demo record is refused in a production database", /demo_seed_record_demo_only/, async () => { await o.query(`INSERT INTO demo_seed_record (record_type, record_id, fixture_key) VALUES ('transformation', $1, 'probe.t')`, [TR]); });
  await expectFailure(o, "EN06 a dataset run is refused in a production database", /demo_dataset_run_demo_only/, async () => {
    await o.query(`INSERT INTO demo_dataset_run (id, run_no, run_kind, requested_via, dataset_code, dataset_version, synthetic_clock_at, record_counts, checksum_sha256, coverage, coverage_complete)
                   VALUES ($1, 1, 'seed', 'cli', 'international_roaming', '1.0.0', '2026-09-01T06:00:00Z', '{}', $2, '{}', true)`, [uid(), H(5)]);
  });
  {
    const z = (await c.query(`SELECT (SELECT count(*) FROM demo_seed_record)::int AS r, (SELECT count(*) FROM app_user u JOIN demo_seed_record d ON d.record_type = 'app_user' AND d.record_id = u.id)::int AS u`)).rows[0];
    report("EN07 the production database holds zero demo records and zero demo users (REQ-S18-003 query)", z.r === 0 && z.u === 0, JSON.stringify(z));
  }
  await expectFailure(o, "EN08 a demo marker needs its dataset, version and synthetic clock", /deployment_environment_demo_dataset/, async () => {
    await o.query(`CREATE TEMP TABLE x AS SELECT 1`); await o.query(`INSERT INTO deployment_environment (singleton, environment_kind, initialized_via) VALUES (true, 'demo', 'seed_demo')`);
  });
  // demo database
  await createDb("probe_demo");
  await migrate(roleUrl("probe_demo", "mth_owner"), { dir: migrationsDir });
  const d = await client("probe_demo");
  await seedP1(d);
  await expectSuccess(d, "DM01 demo initialization writes the demo marker with dataset 1.0.0 and the synthetic clock", async () => {
    await d.query(`INSERT INTO deployment_environment (environment_kind, initialized_via, dataset_code, dataset_version, synthetic_clock_at) VALUES ('demo', 'seed_demo', 'international_roaming', '1.0.0', '2026-09-01T06:00:00Z')`);
    return "demo";
  });
  await expectSuccess(d, "DM02 a demo record for an existing row is registered", async () => { await d.query(`INSERT INTO demo_seed_record (record_type, record_id, fixture_key) VALUES ('transformation', $1, 'roaming.transformation'), ('app_user', $2, 'roaming.user.sponsor')`, [TR, U1]); return "2 records"; });
  await expectFailure(d, "DM03 a demo record must name an existing row", /demo_seed_record_ref/, async () => { await d.query(`INSERT INTO demo_seed_record (record_type, record_id, fixture_key) VALUES ('transformation', $1, 'roaming.missing')`, [uid()]); });
  await expectFailure(d, "DM04 a demo record must name a table with a uuid id", /demo_seed_record_ref/, async () => { await d.query(`INSERT INTO demo_seed_record (record_type, record_id, fixture_key) VALUES ('no_such_table', $1, 'roaming.bad')`, [uid()]); });
  await expectFailure(d, "DM05 fixture keys are unique", /demo_seed_record_fixture_key/, async () => { await d.query(`INSERT INTO demo_seed_record (record_type, record_id, fixture_key) VALUES ('app_user', $1, 'roaming.user.sponsor')`, [U2]); });
  await expectFailure(d, "DM06 demo records are append-only (as the owner)", /append-only/, async () => { await d.query(`DELETE FROM demo_seed_record`); });
  const run = (n: number, o2: Record<string, unknown> = {}) => ({ id: uid(), run_no: n, run_kind: "seed", requested_via: "cli", dataset_code: "international_roaming", dataset_version: "1.0.0",
    synthetic_clock_at: "2026-09-01T06:00:00Z", record_counts: JSON.stringify({ transformation: 1 }), checksum_sha256: H(5), coverage: JSON.stringify({ template_T01: 1 }), coverage_complete: true, ...o2 });
  const insRun = async (r: Record<string, unknown>) => { const k = Object.keys(r); await d.query(`INSERT INTO demo_dataset_run (${k.join(",")}) VALUES (${k.map((_, i) => `$${i + 1}`).join(",")})`, Object.values(r)); };
  await expectSuccess(d, "DM07 dataset run 1 (seed, cli) with counts, checksum and coverage", async () => { await insRun(run(1)); return "run 1"; });
  await expectFailure(d, "DM08 a run that skips a number is refused", /demo_dataset_run_step/, async () => { await insRun(run(3, { run_kind: "reset" })); });
  await expectFailure(d, "DM09 a run of another dataset version is refused", /demo_dataset_run_demo_only/, async () => { await insRun(run(2, { dataset_version: "1.0.1" })); });
  await expectFailure(d, "DM10 an API request is a reset with a requester", /demo_dataset_run_api_reset|demo_dataset_run_requester/, async () => { await insRun(run(2, { requested_via: "api", requested_by: U1 })); });
  await expectFailure(d, "DM11 dataset runs are append-only (as the owner)", /append-only/, async () => { await d.query(`UPDATE demo_dataset_run SET coverage_complete = false`); });
  {
    const a = await client("probe_demo", "mth_app");
    await expectFailure(a, "DM12 mth_app cannot register a demo record", /permission denied/, async () => { await a.query(`INSERT INTO demo_seed_record (record_type, record_id, fixture_key) VALUES ('app_user', $1, 'x.y')`, [U2]); });
    await expectFailure(a, "DM13 mth_app cannot write a dataset run", /permission denied/, async () => { await a.query(`DELETE FROM demo_dataset_run`); });
    await a.end();
  }
  await d.end();
  await expectFailure(c, "WK01 the walkthrough catalogue is read-only to mth_app", /permission denied/, async () => { await c.query(`UPDATE walkthrough_step SET title_en = 'x'`); });

  // ---- grants: no DELETE or TRUNCATE for mth_app on any slice I/J table
  {
    const g = (await o.query(`SELECT string_agg(table_name || ':' || privilege_type, ',' ORDER BY table_name) AS g FROM information_schema.role_table_grants WHERE grantee = 'mth_app'
        AND privilege_type IN ('DELETE', 'TRUNCATE', 'UPDATE') AND table_name IN ('guiding_question','playbook_block','playbook_block_link','source_foundation','methodology_element_profile',
        'branding_version','deployment_environment','demo_seed_record','demo_dataset_run','walkthrough_step')`)).rows[0].g;
    const s = (await o.query(`SELECT string_agg(privilege_type, ',' ORDER BY privilege_type) AS s FROM information_schema.role_table_grants WHERE grantee = 'mth_app' AND table_name = 'branding_setting'`)).rows[0].s;
    report("AO01 mth_app has no UPDATE, DELETE or TRUNCATE on the slice I/J catalogues and histories; branding_setting is INSERT, SELECT, UPDATE only", g === null && s === "INSERT,SELECT,UPDATE", `${g} / ${s}`);
  }
  await c.end();
  await o.end();

  console.log(`\n${total - failures}/${total} PASS`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
