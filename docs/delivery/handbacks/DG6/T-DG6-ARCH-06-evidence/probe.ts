// T-DG6-ARCH-06 migration and guard probe (solution-architect). Run against a DISPOSABLE cluster only:
//   QA_PG_PORT=<port in 23700-23749> MTH_PORT_POOL=<rest of 23700-23749> tests/qa/support/with-pg.sh \
//     node --conditions=@mth/source docs/delivery/handbacks/DG6/T-DG6-ARCH-06-evidence/probe.ts
// 1. Fresh database: all migrations 0001..last.
// 2. P5-populated database: 0001..0097 plus synthetic fixtures (a transformation instantiated by the DG3 function,
//    initiatives, users, a P5 branding version with its head row); then 0098..last on top.
// 3. Guard probes on the slice I tables (0113, ADR-0061 §1). "PASS" means the guard fired (or, for an expectSuccess
//    probe, that the allowed write committed). API-path writes run as mth_app with every trigger on. Fixture records
//    are inserted by the superuser with session_replication_role = replica (the T-DG6-ARCH-01..05 harness, copied).
// 4. The ADR-0061 §1 runtime rule computed with @mth/design-tokens (checkContrast over the token source with a
//    branding version's two colours, derived shades re-derived): the provisional seeds pass every declared pair and
//    their report commits; #FFD700 as primary fails named pairs and a failing pair cannot be stored.
// All data is SYNTHETIC and approves nothing. #0078FF is a provisional brand token, not a verified Mobily colour.
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "../../../../../packages/db/src/migrate.ts";
import {
  checkContrast,
  deriveDarkerShade,
  tokenSource,
  type TokenSource,
} from "../../../../../packages/design-tokens/src/index.ts";

const pg = createRequire(new URL("../../../../../packages/db/package.json", import.meta.url))("pg");
const admin = process.env.TEST_DATABASE_ADMIN_URL!;
const migrationsDir = new URL("../../../../../packages/db/migrations", import.meta.url).pathname;
const tokensFile = new URL("../../../../../packages/design-tokens/src/tokens.json", import.meta.url).pathname;
const LAST_P5 = 97;
const SLICE = [113];
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

// ------------------------------------------------------------------------------------------------ ADR-0061 §1 rule
/** The token source with a branding version's two colours (brand.primary, brand.deep) and the derived shades re-derived. */
function brandedSource(primary: string, deep: string): TokenSource {
  const color = { ...tokenSource.color, "brand.primary": { ...tokenSource.color["brand.primary"]!, value: primary },
    "brand.deep": { ...tokenSource.color["brand.deep"]!, value: deep } };
  const hex = (k: string) => (color as Record<string, { value: string }>)[k]!.value;
  const derived: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(tokenSource.derived)) {
    if (k.startsWith("$") || typeof v === "string") { derived[k] = v; continue; }
    derived[k] = { ...v, value: deriveDarkerShade(hex(v.derivedFrom), v.rule.against.map(hex), v.rule.darkenUntil) };
  }
  return { ...tokenSource, color, derived } as TokenSource;
}
/** Runtime evaluation: the declared pairs only. The "prohibited" list is a build-time documentation check and is not a publish rule. */
function runtimeReport(primary: string, deep: string) {
  const r = checkContrast(brandedSource(primary, deep));
  return { pairs: r.pairs, failing: r.pairs.filter((p) => !p.pass) };
}
const TOKEN_SHA = createHash("sha256").update(readFileSync(tokensFile)).digest("hex");

async function main(): Promise<void> {
  const files = readdirSync(migrationsDir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  console.log(`migrations shipped: ${files.length} (${files[0]} .. ${files[files.length - 1]})`);
  const ids = files.map((f) => Number(f.slice(0, 4)));
  report("G00 slice I migration 0113 present directly above 0112 (D-196); nothing above 0113",
    SLICE.every((n) => ids.includes(n)) && ids.includes(112) && Math.max(...ids) === 113, `ids >= 98: ${ids.filter((n) => n >= 98).join(",")}`);

  await createDb("probe_fresh");
  const applied = await migrate(roleUrl("probe_fresh", "mth_owner"), { dir: migrationsDir });
  report("G01 fresh database: 0001..last apply", applied.length === files.length, `applied ${applied.length}: ${applied.slice(-4).join(", ")}`);
  {
    const c = await client("probe_fresh", "mth_app");
    const r = (await c.query(`SELECT (SELECT count(*) FROM branding_contrast_report)::int AS r, (SELECT count(*) FROM branding_contrast_pair)::int AS p,
      (SELECT count(*) FROM branding_version)::int AS v`)).rows[0];
    report("G01b a fresh install has no contrast report, no pair and no branding version (0113 seeds nothing)", r.r === 0 && r.p === 0 && r.v === 0, JSON.stringify(r));
    await c.end();
  }

  const db = "probe_p5";
  await createDb(db);
  const p5Dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "p5-migrations-"));
  const p5Files = files.filter((f) => Number(f.slice(0, 4)) <= LAST_P5);
  for (const f of p5Files) cpSync(join(migrationsDir, f), join(p5Dir, f));
  const p5Applied = await migrate(roleUrl(db, "mth_owner"), { dir: p5Dir });
  const BV1 = uid();
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
  // A P5 branding version 1 and its head row, published before P6 (no contrast report exists for it).
  await fixture(db, "branding_version", { id: BV1, organization_id: ORG, version_no: 1, product_name_en: "Synthetic Hub", product_name_ar: "منصة تجريبية",
    primary_colour: "#0078FF", secondary_colour: "#003B73", colours_provisional: true, font_latin: "IBM Plex Sans", font_arabic: "IBM Plex Sans Arabic", created_by: U1 });
  await fixture(db, "branding_setting", { id: uid(), organization_id: ORG, current_version_no: 1, version: 1, created_by: U1, updated_by: U1 });
  const md5 = async (c: any) => (await c.query(`SELECT md5(string_agg(to_jsonb(i)::text, '' ORDER BY id)) AS h FROM initiative i`)).rows[0].h
    + "/" + (await c.query(`SELECT md5(string_agg(to_jsonb(t)::text, '' ORDER BY id)) AS h FROM transformation t`)).rows[0].h
    + "/" + (await c.query(`SELECT md5(string_agg(to_jsonb(g)::text, '' ORDER BY id)) AS h FROM gate_instance g`)).rows[0].h
    + "/" + (await c.query(`SELECT md5(string_agg(to_jsonb(b)::text, '' ORDER BY id)) AS h FROM branding_version b`)).rows[0].h
    + "/" + (await c.query(`SELECT md5(string_agg(to_jsonb(b)::text, '' ORDER BY id)) AS h FROM branding_setting b`)).rows[0].h
    + "/" + (await c.query(`SELECT count(*)::text AS n FROM audit_event`)).rows[0].n;
  let before = "";
  {
    const c = await client(db);
    const n = (await c.query(`SELECT (SELECT count(*) FROM initiative)::int AS i, (SELECT count(*) FROM transformation)::int AS t, (SELECT count(*) FROM app_user)::int AS u,
      (SELECT count(*) FROM gate_instance)::int AS g, (SELECT count(*) FROM branding_version)::int AS bv`)).rows[0];
    report("G02 P5 database populated (0001-0097; 2 transformations, one instantiated by the DG3 function with its gates; 12 initiatives; 3 users; 1 branding version and its head)",
      p5Applied.length === p5Files.length && n.i === 12 && n.t === 2 && n.u === 3 && n.g === 6 && n.bv === 1, `applied ${p5Applied.length}; ${JSON.stringify(n)}`);
    before = await md5(c);
    await c.end();
  }
  const onTop = await migrate(roleUrl(db, "mth_owner"), { dir: migrationsDir });
  {
    const c = await client(db);
    report("G03 P6 (0098..last, including slice I 0113) over the P5 database apply",
      onTop.length === files.length - p5Files.length && onTop.join(",").includes("0113"), `applied ${onTop.length}: ${onTop.slice(-3).join(", ")}`);
    const after = await md5(c);
    const r = (await c.query(`SELECT (SELECT count(*) FROM branding_contrast_report)::int AS reports, (SELECT count(*) FROM branding_contrast_pair)::int AS pairs`)).rows[0];
    report("G04 the upgrade leaves existing rows as they were (initiatives, transformations, gate instances, the branding version and head byte-identical, audit count unchanged); no report is backfilled for the P5 version",
      after === before && r.reports === 0 && r.pairs === 0, `${after === before ? "identical" : `changed ${before} -> ${after}`}; ${JSON.stringify(r)}`);
    await c.end();
  }

  const app = await client(db, "mth_app");
  const own = await client(db, "mth_owner");

  // -------------------------------------------------------------------------------------------- the DG5 path
  const BV2 = uid();
  await expectSuccess(app, "BV01 a new branding version without a contrast report still commits (0113 adds no requirement on branding_version; that rule ships with BE-W)", async () => {
    await insRow(app, "branding_version", { id: BV2, organization_id: ORG, version_no: 2, product_name_en: "Synthetic Hub", product_name_ar: "منصة تجريبية",
      primary_colour: "#0078FF", secondary_colour: "#003B73", colours_provisional: true, font_latin: "IBM Plex Sans", font_arabic: "IBM Plex Sans Arabic", created_by: U1 });
    await audit(app, "branding_version", BV2, null);
    return "committed";
  });

  // -------------------------------------------------------------------------------------------- the runtime rule
  const seeds = runtimeReport("#0078FF", "#003B73");
  report("RL01 the provisional seeds (#0078FF, #003B73) pass every declared pair at runtime (checkContrast over the branded source)",
    seeds.failing.length === 0 && seeds.pairs.length === tokenSource.contrastPairs.pairs.length, `${seeds.pairs.length} pairs, ${seeds.failing.length} failing`);
  const yellow = runtimeReport("#FFD700", "#003B73");
  report("RL02 #FFD700 as primary fails named pairs (brand.primary as a ui accent and as large text): the publish would be refused",
    yellow.failing.length > 0 && yellow.failing.every((p) => p.fg === "brand.primary"), yellow.failing.map((p) => `${p.fg} on ${p.bg} (${p.use}) ${p.ratio}:1 < ${p.threshold}:1`).join("; "));
  const lightDeep = runtimeReport("#0078FF", "#6FA8DC");
  report("RL03 a light secondary (#6FA8DC as brand.deep) fails the text pairs that use brand.deep (headings, selected navigation item, header start, info banner, phase stepper)",
    lightDeep.failing.length > 0 && lightDeep.failing.every((p) => [p.fg, p.bg].some((t) => ["brand.deep", "nav.selected-text", "header.gradient-start", "feedback.info.fg"].includes(t))),
    lightDeep.failing.map((p) => `${p.fg} on ${p.bg} (${p.use}) ${p.ratio}:1`).join("; "));
  const derivedOk = runtimeReport("#FFD700", "#003B73").pairs.filter((p) => p.bg === "action.primary" || p.bg === "action.primary-hover" || p.bg === "nav.background" || p.fg === "action.primary" || p.fg === "focus.ring");
  report("RL04 the derived shades re-derived from #FFD700 keep every action, link, focus and navigation pair passing (the ADR-0009 §3 derivation)",
    derivedOk.length > 0 && derivedOk.every((p) => p.pass), derivedOk.map((p) => `${p.fg}/${p.bg} ${p.ratio}`).join(", "));

  // -------------------------------------------------------------------------------------------- branding_contrast_report
  const reportRow = (id: string, o: Record<string, unknown> = {}) => ({ id, organization_id: ORG, branding_version_no: 2, rules: "wcag2x-aa-v1",
    token_source_sha256: TOKEN_SHA, pair_count: 3, created_by: U1, ...o });
  const pairRow = (reportId: string, ordinal: number, o: Record<string, unknown> = {}) => ({ id: uid(), report_id: reportId, ordinal,
    fg_token: "text.primary", bg_token: ["surface.page", "surface.card", "surface.selected", "feedback.info.bg"][ordinal - 1] ?? `surface.x${ordinal}`,
    use: "text", fg_hex: "#142438", bg_hex: "#FFFFFF", ratio: "15.89", threshold: "4.5", usage_note: "body text (synthetic probe)", ...o });
  const three = async (rid: string) => { for (let i = 1; i <= 3; i++) await insRow(app, "branding_contrast_pair", pairRow(rid, i)); };

  await expectFailure(app, "CR01 missing audit fails at COMMIT (branding_contrast_report_audit_required)", /branding_contrast_report_audit_required/, async () => {
    const r = uid(); await insRow(app, "branding_contrast_report", reportRow(r)); await three(r);
  });
  await expectFailure(app, "CR02 a report without pairs fails at COMMIT (branding_contrast_report_pairs_complete)", /branding_contrast_report_pairs_complete/, async () => {
    const r = uid(); await insRow(app, "branding_contrast_report", reportRow(r)); await audit(app, "branding_contrast_report", r, null);
  });
  await expectFailure(app, "CR03 a report with fewer pairs than pair_count fails at COMMIT", /branding_contrast_report_pairs_complete/, async () => {
    const r = uid(); await insRow(app, "branding_contrast_report", reportRow(r)); await audit(app, "branding_contrast_report", r, null);
    await insRow(app, "branding_contrast_pair", pairRow(r, 1)); await insRow(app, "branding_contrast_pair", pairRow(r, 2));
  });
  await expectFailure(app, "CR04 ordinals with a gap (1, 2, 4 for pair_count 3) fail at COMMIT", /branding_contrast_report_pairs_complete/, async () => {
    const r = uid(); await insRow(app, "branding_contrast_report", reportRow(r)); await audit(app, "branding_contrast_report", r, null);
    await insRow(app, "branding_contrast_pair", pairRow(r, 1)); await insRow(app, "branding_contrast_pair", pairRow(r, 2)); await insRow(app, "branding_contrast_pair", pairRow(r, 4));
  });
  const R1 = uid();
  await expectSuccess(app, "CR05 a report with exactly pair_count passing pairs and its audit event commits", async () => {
    await insRow(app, "branding_contrast_report", reportRow(R1)); await audit(app, "branding_contrast_report", R1, null); await three(R1); return "committed";
  });
  await expectFailure(app, "CR06 a pair added later to a committed report fails at COMMIT (branding_contrast_pair_report_complete)", /branding_contrast_report_pairs_complete/, async () => {
    await insRow(app, "branding_contrast_pair", pairRow(R1, 4));
  });
  await expectFailure(app, "CR07 a second report for the same branding version (branding_contrast_report_version_key)", /branding_contrast_report_version_key/, async () => {
    const r = uid(); await insRow(app, "branding_contrast_report", reportRow(r)); await audit(app, "branding_contrast_report", r, null); await three(r);
  });
  await expectFailure(app, "CR08 a report for a branding version that does not exist (branding_contrast_report_version_fkey)", /branding_contrast_report_version_fkey/, async () => {
    const r = uid(); await insRow(app, "branding_contrast_report", reportRow(r, { branding_version_no: 99 })); await audit(app, "branding_contrast_report", r, null); await three(r);
  });
  await expectFailure(app, "CR09 a report naming another organization's version number (no such version there; composite foreign key)", /branding_contrast_report_version_fkey/, async () => {
    const r = uid(); await insRow(app, "branding_contrast_report", reportRow(r, { organization_id: ORG2, branding_version_no: 1, created_by: UX }));
    await audit(app, "branding_contrast_report", r, null, UX, ORG2); await three(r);
  });
  await expectFailure(app, "CR10 a rule set outside the closed set", /branding_contrast_report_rules_check/, async () => {
    await insRow(app, "branding_contrast_report", reportRow(uid(), { rules: "wcag3-apca" }));
  });
  await expectFailure(app, "CR11 a token-source hash that is not 64 lower-case hex characters", /branding_contrast_report_token_source_sha256_check/, async () => {
    await insRow(app, "branding_contrast_report", reportRow(uid(), { token_source_sha256: TOKEN_SHA.toUpperCase() }));
  });

  // -------------------------------------------------------------------------------------------- branding_contrast_pair
  const pairCase = async (name: string, re: RegExp, o: Record<string, unknown>) =>
    expectFailure(app, name, re, async () => {
      const r = uid(); await insRow(app, "branding_contrast_report", reportRow(r, { branding_version_no: 1 })); await audit(app, "branding_contrast_report", r, null);
      await insRow(app, "branding_contrast_pair", pairRow(r, 1, o)); await insRow(app, "branding_contrast_pair", pairRow(r, 2)); await insRow(app, "branding_contrast_pair", pairRow(r, 3));
    });
  await pairCase("CP01 a failing pair cannot be stored (white small text on #0078FF, 4.09:1 < 4.5:1; branding_contrast_pair_passes)", /branding_contrast_pair_passes/,
    { fg_token: "text.inverse", bg_token: "brand.primary", fg_hex: "#FFFFFF", bg_hex: "#0078FF", ratio: "4.09" });
  await pairCase("CP02 a ui pair below 3:1 cannot be stored (2.99 < 3.0)", /branding_contrast_pair_passes/, { use: "ui", threshold: "3.0", ratio: "2.99" });
  await pairCase("CP03 a threshold that does not match the use (text at 3.0)", /branding_contrast_pair_threshold_for_use/, { threshold: "3.0" });
  await pairCase("CP04 large-text at 4.5 does not match the use either", /branding_contrast_pair_threshold_for_use/, { use: "large-text", threshold: "4.5" });
  await pairCase("CP05 a use outside the closed set (refused by use_check or, checked first by name, threshold_for_use: both exclude it)", /branding_contrast_pair_use_check|branding_contrast_pair_threshold_for_use/, { use: "graphic" });
  await pairCase("CP06 a lower-case colour", /branding_contrast_pair_fg_hex_check/, { fg_hex: "#ffffff" });
  await pairCase("CP07 a ratio above 21", /branding_contrast_pair_ratio_check/, { ratio: "21.01" });
  await pairCase("CP08 a token name that is not a dotted lower-case token", /branding_contrast_pair_bg_token_check/, { bg_token: "Surface.Card" });
  await pairCase("CP09 the same pair and use twice in one report (branding_contrast_pair_pair_key)", /branding_contrast_pair_pair_key/, { bg_token: "surface.card" });
  await expectFailure(app, "CP10 a ratio with more than two decimals is rounded by numeric(4,2), so 4.495 is stored as 4.50 only if it is >= 4.5; the API stores floor2 (4.49) and 4.49 is refused", /branding_contrast_pair_passes/, async () => {
    const r = uid(); await insRow(app, "branding_contrast_report", reportRow(r, { branding_version_no: 1 })); await audit(app, "branding_contrast_report", r, null);
    await insRow(app, "branding_contrast_pair", pairRow(r, 1, { ratio: "4.49" })); await insRow(app, "branding_contrast_pair", pairRow(r, 2)); await insRow(app, "branding_contrast_pair", pairRow(r, 3));
  });

  // -------------------------------------------------------------------------------------------- the real report
  const BV3 = uid();
  await expectSuccess(app, `RL05 the real runtime report of the provisional seeds (${seeds.pairs.length} pairs from checkContrast, ratios floor2) is stored with version 3 and its audit events`, async () => {
    await insRow(app, "branding_version", { id: BV3, organization_id: ORG, version_no: 3, product_name_en: "Synthetic Hub", product_name_ar: "منصة تجريبية",
      primary_colour: "#0078FF", secondary_colour: "#003B73", colours_provisional: true, font_latin: "IBM Plex Sans", font_arabic: "IBM Plex Sans Arabic", created_by: U1 });
    await audit(app, "branding_version", BV3, null);
    const r = uid();
    await insRow(app, "branding_contrast_report", reportRow(r, { branding_version_no: 3, pair_count: seeds.pairs.length }));
    await audit(app, "branding_contrast_report", r, null);
    let i = 0;
    for (const p of seeds.pairs) {
      await insRow(app, "branding_contrast_pair", { id: uid(), report_id: r, ordinal: ++i, fg_token: p.fg, bg_token: p.bg, use: p.use, fg_hex: p.fgHex, bg_hex: p.bgHex,
        ratio: p.ratio.toFixed(2), threshold: p.threshold.toFixed(1), usage_note: p.note.slice(0, 200) });
    }
    return `${i} pairs stored; lowest ${Math.min(...seeds.pairs.map((p) => p.ratio)).toFixed(2)}:1`;
  });
  await expectFailure(app, "RL06 the #FFD700 report cannot be stored: its first failing pair is refused by branding_contrast_pair_passes", /branding_contrast_pair_passes/, async () => {
    const BV4 = uid();
    await insRow(app, "branding_version", { id: BV4, organization_id: ORG, version_no: 4, product_name_en: "Synthetic Hub", product_name_ar: "منصة تجريبية",
      primary_colour: "#FFD700", secondary_colour: "#003B73", colours_provisional: true, font_latin: "IBM Plex Sans", font_arabic: "IBM Plex Sans Arabic", created_by: U1 });
    await audit(app, "branding_version", BV4, null);
    const r = uid();
    await insRow(app, "branding_contrast_report", reportRow(r, { branding_version_no: 4, pair_count: yellow.pairs.length }));
    await audit(app, "branding_contrast_report", r, null);
    let i = 0;
    for (const p of yellow.pairs) {
      await insRow(app, "branding_contrast_pair", { id: uid(), report_id: r, ordinal: ++i, fg_token: p.fg, bg_token: p.bg, use: p.use, fg_hex: p.fgHex, bg_hex: p.bgHex,
        ratio: p.ratio.toFixed(2), threshold: p.threshold.toFixed(1), usage_note: p.note.slice(0, 200) });
    }
  });

  // -------------------------------------------------------------------------------------------- append-only
  await expectFailure(app, "AO01 mth_app cannot UPDATE a report (no grant)", /permission denied/, async () => { await app.query(`UPDATE branding_contrast_report SET pair_count = 4 WHERE id = $1`, [R1]); });
  await expectFailure(app, "AO02 mth_app cannot DELETE a pair (no grant)", /permission denied/, async () => { await app.query(`DELETE FROM branding_contrast_pair WHERE report_id = $1`, [R1]); });
  await expectFailure(own, "AO03 even the owner cannot UPDATE a report (p2_append_only)", /append-only/, async () => { await own.query(`UPDATE branding_contrast_report SET pair_count = 4 WHERE id = $1`, [R1]); });
  await expectFailure(own, "AO04 even the owner cannot UPDATE a pair's ratio (p2_append_only)", /append-only/, async () => { await own.query(`UPDATE branding_contrast_pair SET ratio = 3.00 WHERE report_id = $1`, [R1]); });
  await expectFailure(own, "AO05 even the owner cannot DELETE a report (p2_append_only)", /append-only/, async () => { await own.query(`DELETE FROM branding_contrast_report WHERE id = $1`, [R1]); });
  await expectFailure(own, "AO06 even the owner cannot TRUNCATE the pairs (p2_append_only, statement level)", /append-only/, async () => { await own.query(`TRUNCATE branding_contrast_pair`); });
  {
    const r = (await app.query(`SELECT (SELECT count(*) FROM branding_contrast_report)::int AS reports, (SELECT count(*) FROM branding_contrast_pair)::int AS pairs,
      (SELECT count(*) FROM branding_contrast_pair WHERE ratio < threshold)::int AS failing`)).rows[0];
    report("INV01 after every probe: 2 reports (CR05, RL05), their pairs, and no stored pair below its threshold",
      r.reports === 2 && r.pairs === 3 + seeds.pairs.length && r.failing === 0, JSON.stringify(r));
    const g = (await app.query(`SELECT has_table_privilege('mth_app', 'branding_contrast_report', 'UPDATE') AS ru, has_table_privilege('mth_app', 'branding_contrast_report', 'DELETE') AS rd,
      has_table_privilege('mth_app', 'branding_contrast_pair', 'UPDATE') AS pu, has_table_privilege('mth_app', 'branding_contrast_pair', 'DELETE') AS pd,
      has_table_privilege('mth_app', 'branding_contrast_pair', 'INSERT') AS pi`)).rows[0];
    report("INV02 mth_app holds SELECT and INSERT only on both tables", !g.ru && !g.rd && !g.pu && !g.pd && g.pi, JSON.stringify(g));
  }
  await app.end();
  await own.end();
  console.log(`${total - failures}/${total} PASS`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 2;
});
