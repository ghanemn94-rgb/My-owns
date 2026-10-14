// T-DG5-ARCH-01 migration and guard probe (solution-architect). Run against a DISPOSABLE cluster only:
//   QA_PG_PORT=<port in 23700-23749> MTH_PORT_POOL=23701-23749 tests/qa/support/with-pg.sh \
//     node --conditions=@mth/source docs/delivery/handbacks/DG5/T-DG5-ARCH-01-evidence/probe.ts
// 1. Fresh database: all migrations 0001..last.
// 2. P4-populated database: 0001..0061 with a synthetic transformation instantiated by the DG3 function (methodology
//    pin, weight set), then 0062..last on top; the existing pin and weight set are unchanged.
// 3. Guard probes on the slice A tables (ADR-0039, ADR-0040). "PASS" means the guard fired (or, for an expectSuccess
//    probe, that the allowed write committed). The harness is copied from the T-DG4-ARCH-08 probe. All data is
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

async function main(): Promise<void> {
  const files = readdirSync(migrationsDir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  console.log(`migrations shipped: ${files.length} (${files[0]} .. ${files[files.length - 1]})`);
  const ids = files.map((f) => Number(f.slice(0, 4)));
  report("G00 slice A migrations 0062-0064 present; nothing above 0067 from this task", [62, 63, 64].every((n) => ids.includes(n)) && ids.every((n) => n <= 67), `ids >= 62: ${ids.filter((n) => n >= 62).join(",")}`);

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
    before = (await c.query(`SELECT p.id, p.kind, p.methodology_version_id, p.version, (SELECT row_to_json(s) FROM scoring_weight_set s WHERE s.transformation_id = $1) AS ws FROM transformation_config_pin p WHERE p.transformation_id = $1`, [TR])).rows;
    report("G02 P4 database populated (0001-0061; a synthetic transformation instantiated: methodology pin and source-default weight set)", p4Applied.length === LAST_P4 && before.length === 1, `applied ${p4Applied.length}; pins ${JSON.stringify(before.map((r: any) => [r.kind, r.version]))}`);
    await c.end();
  }
  const onTop = await migrate(roleUrl("probe_p4", "mth_owner"), { dir: migrationsDir });
  {
    const c = await client("probe_p4");
    report("G03 P5 slice A over the P4 database: 0062..last apply", onTop.length === files.length - LAST_P4, `applied ${onTop.length}: ${onTop.join(", ")}`);
    const after = (await c.query(`SELECT p.id, p.kind, p.methodology_version_id, p.version, (SELECT row_to_json(s) FROM scoring_weight_set s WHERE s.transformation_id = $1) AS ws FROM transformation_config_pin p WHERE p.transformation_id = $1`, [TR])).rows;
    report("G04 the existing methodology pin and the DG3 weight set are byte-identical after 0062..last", JSON.stringify(after) === JSON.stringify(before), JSON.stringify(after.map((r: any) => [r.kind, r.version, r.ws.approval_basis])));
    const mv = (await c.query(`SELECT config_kind, origin, draft_stage, status FROM methodology_version WHERE id = $1`, [MV1])).rows[0];
    report("G05 methodology v1 reads as kind methodology, origin seed, published, no draft stage", mv.config_kind === "methodology" && mv.origin === "seed" && mv.status === "published" && mv.draft_stage === null, JSON.stringify(mv));
    await c.end();
  }

  const c = await client("probe_fresh", "mth_app");
  const o = await client("probe_fresh", "mth_owner");
  await seedP1(o);
  await o.query("BEGIN");
  await o.query(`SELECT p3_instantiate_transformation($1, $2, 'probe', 'cli')`, [TR, U1]);
  await o.query("COMMIT");

  // ---- Seeds (REQ-S02-001, REQ-PB-093, REQ-S06-010)
  {
    const r = (await c.query(`SELECT set_code, count(*)::int AS n FROM source_element GROUP BY 1 ORDER BY 1`)).rows;
    const m = Object.fromEntries(r.map((x: any) => [x.set_code, x.n]));
    const want = { mode: 2, phase: 6, gate: 6, template: 16, tom_dimension: 10, forum: 5, benefit_lifecycle_step: 6, launch_window: 3, roaming_example: 1, health_question: 25 };
    report("SE01 the source inventory holds 2/6/6/16/10/5/6/3/1/25 elements (80)", JSON.stringify(m) === JSON.stringify(Object.fromEntries(Object.entries(want).sort())), JSON.stringify(m));
    const w = (await c.query(`SELECT stable_key, attributes->>'weightPercent' AS w FROM methodology_element WHERE methodology_version_id = $1 AND element_type = 'scoring_weight' ORDER BY ordinal`, [SD1])).rows;
    report("SE02 scoring defaults v1 = 25/25/20/15/15 (B0076), published", w.map((x: any) => x.w).join("/") === "25.00/25.00/20.00/15.00/15.00", JSON.stringify(w));
    const p = (await c.query(`SELECT r.code, rp.permission_code FROM role_permission rp JOIN role r ON r.id = rp.role_id WHERE rp.permission_code = 'methodology_migration.approve' ORDER BY 1`)).rows;
    report("SE03 methodology_migration.approve is held by SP only (TL stays approval-free, 0008)", p.map((x: any) => x.code).join(",") === "SP", JSON.stringify(p));
  }
  await expectFailure(o, "SE04 a technical admin role cannot be granted methodology_migration.approve (REQ-S06-010, S10-003)", /technical|approval|role_permission/i, async () => {
    await o.query(`INSERT INTO role_permission (role_id, permission_code) VALUES ('01920000-0000-7000-8000-00000000000e', 'methodology_migration.approve')`);
  });

  // ---- methodology_version Studio lifecycle (REQ-S06-007, REQ-S06-009)
  const S1 = H(1);
  let D1 = "";
  await expectSuccess(c, "MV01 a Studio draft of methodology (next version_no, editing, based on v1) commits with its audit event", async () => {
    D1 = await draft(c, "methodology", "playbook", MV1, S1);
    return D1;
  });
  await expectFailure(c, "MV02 a draft insert without its audit event fails at COMMIT", /methodology_version_audit_required/, async () => {
    await c.query(`INSERT INTO methodology_version (id, key, version_no, status, draft_stage, title_en, title_ar, source_document, definition, content_sha256, config_kind, origin, based_on_version_id, created_by, updated_by)
      VALUES ($1, 'scoring-defaults', 2, 'draft', 'editing', 'x', 'x', 'x', '{}', $2, 'scoring_defaults', 'draft', $3, $4, $4)`, [uid(), S1, SD1, U1]);
  });
  await expectFailure(c, "MV03 a second open draft of the same key is refused", /methodology_version_one_open_draft_key|methodology_version_next_number/, async () => {
    await draft(c, "methodology", "playbook", MV1, S1);
  });
  await expectFailure(c, "MV04 the application role cannot insert a seeded version", /methodology_version_seed_only/, async () => {
    await ins(c, "methodology_version", { id: uid(), key: "zz", version_no: 1, status: "published", title_en: "x", title_ar: "x", source_document: "x", definition: "{}", content_sha256: S1, published_at: new Date(), origin: "seed" });
  });
  await expectFailure(c, "MV05 a draft update whose version does not step by 1 is refused", /methodology_version_version_step/, async () => {
    await updx(c, "methodology_version", D1, { title_en: "Renamed" }, { step: 2 });
  });
  await expectFailure(c, "MV06 editing a published version's definition is refused (DG2 trigger kept)", /methodology_version_published_immutable|methodology_version_content_frozen/, async () => {
    await updx(c, "methodology_version", MV1, { definition: '{"x": 1}' });
  });
  await expectFailure(c, "MV07 editing -> approved directly is refused (preview first)", /methodology_version_stage_transition/, async () => {
    await updx(c, "methodology_version", D1, { draft_stage: "approved" });
  });
  await expectFailure(c, "MV08 editing -> preview without a passing preview run for the content is refused", /methodology_version_preview_required/, async () => {
    await updx(c, "methodology_version", D1, { draft_stage: "preview" });
  });
  await expectFailure(c, "MV09 editing -> preview with a passing run for another content hash is refused", /methodology_version_preview_required/, async () => {
    await run(c, D1, "preview", H(2));
    await updx(c, "methodology_version", D1, { draft_stage: "preview" });
  });
  await expectSuccess(c, "MV10 editing -> preview with a passing preview run for exactly the content commits", async () => {
    await run(c, D1, "preview", S1);
    await updx(c, "methodology_version", D1, { draft_stage: "preview" });
    return "preview";
  });
  await expectFailure(c, "MV11 preview -> approved without the configured review (methodology: review required, TO) is refused", /methodology_version_review_required/, async () => {
    await updx(c, "methodology_version", D1, { draft_stage: "approved" });
  });
  await expectSuccess(c, "MV12 preview -> review commits; a pending review request for the content is recorded", async () => {
    await updx(c, "methodology_version", D1, { draft_stage: "review" });
    await ins(c, "config_review_request", { id: uid(), methodology_version_id: D1, content_sha256: S1, reviewer_role_code: "TO", requested_by: U1, created_by: U1, updated_by: U1 });
    return "review";
  });
  await expectFailure(c, "MV13 a content change while in review is refused", /methodology_version_content_frozen/, async () => {
    await updx(c, "methodology_version", D1, { definition: '{"y": 1}', content_sha256: H(3) });
  });
  const RR = (await c.query(`SELECT id FROM config_review_request WHERE methodology_version_id = $1`, [D1])).rows[0].id;
  await expectFailure(c, "RR01 the draft's author cannot approve its review (SoD)", /config_review_request_reviewer_not_requester|config_review_request_reviewer_not_author/, async () => {
    await updx(c, "config_review_request", RR, { status: "approved", decided_by: U1, decided_at: new Date() });
  });
  await expectFailure(c, "RR02 a review request's content hash never changes", /config_review_request_frozen/, async () => {
    await updx(c, "config_review_request", RR, { content_sha256: H(9) });
  });
  await expectFailure(c, "RR03 changes requested without a note is refused", /config_review_request_changes_noted/, async () => {
    await updx(c, "config_review_request", RR, { status: "changes_requested", decided_by: U2, decided_at: new Date() });
  });
  await expectSuccess(c, "MV14 another person approves the review; review -> approved commits", async () => {
    await updx(c, "config_review_request", RR, { status: "approved", decided_by: U2, decided_at: new Date() });
    await updx(c, "methodology_version", D1, { draft_stage: "approved" });
    return "approved";
  });
  await expectFailure(c, "MV15 publishing without passing compatibility and source-coverage runs is refused", /methodology_version_checks_required/, async () => {
    await updx(c, "methodology_version", D1, { status: "published", draft_stage: null, published_at: new Date(), published_by: U1 });
  });
  await expectFailure(c, "MV16 publishing with a FAILED source-coverage run (e.g. a template deleted) is refused", /methodology_version_checks_required/, async () => {
    await run(c, D1, "compatibility", S1);
    await run(c, D1, "source_coverage", S1, "fail");
    await updx(c, "methodology_version", D1, { status: "published", draft_stage: null, published_at: new Date(), published_by: U1 });
  });
  await expectFailure(c, "MV17 publishing without a named publisher is refused", /methodology_version_publish_ready|methodology_version_publisher/, async () => {
    await run(c, D1, "compatibility", S1);
    await run(c, D1, "source_coverage", S1);
    await updx(c, "methodology_version", D1, { status: "published", draft_stage: null, published_at: new Date() });
  });
  await expectSuccess(c, "MV18 publish with passing preview, compatibility and source-coverage runs and an approved review commits", async () => {
    await run(c, D1, "compatibility", S1);
    await run(c, D1, "source_coverage", S1);
    await updx(c, "methodology_version", D1, { status: "published", draft_stage: null, published_at: new Date(), published_by: U1 });
    return "published v2";
  });
  await expectFailure(c, "MV19 editing the published v2 is refused (immutable published version)", /methodology_version_published_immutable|methodology_version_content_frozen/, async () => {
    await updx(c, "methodology_version", D1, { title_en: "Edited after publish" });
  });
  await expectFailure(c, "MV20 a published version never returns to draft", /methodology_version_status_transition|draft_stage/, async () => {
    await updx(c, "methodology_version", D1, { status: "draft", draft_stage: "editing", published_at: null });
  });
  await expectFailure(c, "MV21 a rollback draft without a reason is refused", /methodology_version_rollback_complete/, async () => {
    const no = (await c.query(`SELECT max(version_no) + 1 AS n FROM methodology_version WHERE key = 'playbook'`)).rows[0].n;
    await ins(c, "methodology_version", { id: uid(), key: "playbook", version_no: no, status: "draft", draft_stage: "editing", title_en: "x", title_ar: "x", source_document: "x", definition: "{}", content_sha256: S1, origin: "rollback", based_on_version_id: D1, rollback_of_version_id: MV1, created_by: U1, updated_by: U1 });
  });
  await expectSuccess(c, "MV22 a rollback draft restoring v1 (new version_no, reason given) commits; v1 and v2 stay unchanged", async () => {
    const no = (await c.query(`SELECT max(version_no) + 1 AS n FROM methodology_version WHERE key = 'playbook'`)).rows[0].n;
    const id = await ins(c, "methodology_version", { id: uid(), key: "playbook", version_no: no, status: "draft", draft_stage: "editing", title_en: "Rollback to v1", title_ar: "x", source_document: "x", definition: "{}", content_sha256: S1, origin: "rollback", based_on_version_id: D1, rollback_of_version_id: MV1, change_summary: "Synthetic rollback reason", created_by: U1, updated_by: U1 });
    await updx(c, "methodology_version", id, { draft_stage: "discarded", discarded_at: new Date() });
    return `rollback draft v${no} (then discarded)`;
  });
  await expectFailure(c, "MV23a the application role has no UPDATE on check runs", /permission denied/, async () => {
    await c.query(`UPDATE config_check_run SET result = 'fail' WHERE methodology_version_id = $1`, [D1]);
  });
  await expectFailure(o, "MV23 a check run is append-only even for the owner (UPDATE refused by the trigger)", /append-only/, async () => {
    await o.query(`UPDATE config_check_run SET result = 'fail' WHERE methodology_version_id = $1`, [D1]);
  });

  // ---- methodology_element invariants (REQ-S06-006, REQ-S02-001, D-142 Q4)
  const S4 = H(4);
  let D2 = "";
  await inTx(c, async () => { D2 = await draft(c, "methodology", "playbook", D1, S4); });
  await expectSuccess(c, "ME01 renaming the label of G3 in a draft commits", async () => el(c, D2, "gate", "G3", "source", { labelEn: "G3 - Target State (renamed)", labelAr: "x" }));
  const G3 = (await c.query(`SELECT id FROM methodology_element WHERE methodology_version_id = $1 AND stable_key = 'G3'`, [D2])).rows[0].id;
  await expectFailure(c, "ME02 changing the stable key of G3 is refused", /methodology_element_identity_fixed/, async () => {
    await updx(c, "methodology_element", G3, { stable_key: "G7" });
  });
  await expectFailure(c, "ME03 deleting a TOM dimension is refused", /methodology_element_fixed_sets/, async () => {
    await el(c, D2, "tom_dimension", "technology", "source", {}, true);
  });
  await expectFailure(c, "ME04 adding a seventh gate is refused", /methodology_element_fixed_sets|methodology_element_source_identity/, async () => {
    await el(c, D2, "gate", "G7", "admin");
  });
  await expectFailure(c, "ME05 configuring ADM_METHOD as an automatic approver is refused", /methodology_element_no_admin_approver/, async () => {
    await el(c, D2, "approver_route", "t13.submission", "admin", { approverRoleCode: "ADM_METHOD" });
  });
  await expectFailure(c, "ME06 an AUD approver is refused too", /methodology_element_no_admin_approver/, async () => {
    await el(c, D2, "approver_route", "t13.submission", "admin", { approverRoleCodes: ["BO", "AUD"] });
  });
  await expectSuccess(c, "ME07 changing an approver route to BO commits", async () => el(c, D2, "approver_route", "t13.submission", "admin", { approverRoleCode: "BO" }));
  await expectSuccess(c, "ME08 deleting template T13 in a draft is recorded (removed = true); the coverage gate blocks its publish (MV16)", async () => el(c, D2, "template", "T13", "source", {}, true));
  await expectFailure(c, "ME09 an element of an unknown source identity is refused", /methodology_element_source_identity/, async () => {
    await el(c, D2, "template", "T17", "source");
  });
  await expectFailure(c, "ME10 a scoring element in a methodology draft is refused (kind/type)", /methodology_element_kind_type/, async () => {
    await el(c, D2, "scoring_weight", "feasibility", "source", { weightPercent: "30.00" });
  });
  await expectFailure(c, "ME11 an element change without its audit event fails at COMMIT", /methodology_element_audit_required/, async () => {
    await updx(c, "methodology_element", G3, { attributes: '{"labelEn": "x"}' }, { audit: false });
  });
  await expectFailure(c, "ME12 an element of the published v2 cannot be written", /methodology_element_draft_only/, async () => {
    await el(c, D1, "gate", "G2", "source", { labelEn: "x" });
  });

  // ---- scoring defaults: the 100 % rule at publish (REQ-PB-093)
  const S5 = H(5);
  let SD2 = "";
  await inTx(c, async () => {
    SD2 = await draft(c, "scoring_defaults", "scoring-defaults", SD1, S5);
    const w: Record<string, string> = { strategic_fit: "30.00", financial_value: "20.00", customer_impact: "20.00", feasibility: "15.00", time_to_value: "10.00" };
    for (const [k, v] of Object.entries(w)) await el(c, SD2, "scoring_weight", k, "source", { weightPercent: v });
    await run(c, SD2, "preview", S5);
    await updx(c, "methodology_version", SD2, { draft_stage: "preview" });
    await updx(c, "methodology_version", SD2, { draft_stage: "review" });
    const r = await ins(c, "config_review_request", { id: uid(), methodology_version_id: SD2, content_sha256: S5, reviewer_role_code: "TO", requested_by: U1, created_by: U1, updated_by: U1 });
    await updx(c, "config_review_request", r, { status: "approved", decided_by: U2, decided_at: new Date() });
    await updx(c, "methodology_version", SD2, { draft_stage: "approved" });
    await run(c, SD2, "compatibility", S5);
  });
  await expectFailure(c, "SD01 a weight that is not a decimal string is refused", /methodology_element_weight_decimal/, async () => {
    await c.query(`UPDATE methodology_version SET draft_stage = 'editing', version = version + 1 WHERE id = $1`, [SD2]);
    await el(c, SD2, "scoring_weight", "risk_compliance", "source", { weightPercent: 5 });
  });
  await expectFailure(c, "SD02 publishing default weights that total 95 % is refused (30/20/20/15/10)", /methodology_version_weights_total/, async () => {
    await updx(c, "methodology_version", SD2, { status: "published", draft_stage: null, published_at: new Date(), published_by: U1 });
  });

  // ---- S12-018 revision proposals: exactly once per subject and content
  await expectSuccess(c, "RV01 a revision proposal for the draft is recorded once; a replay (same dedupe key, ON CONFLICT DO NOTHING) inserts nothing", async () => {
    const key = `methodology_version:${D2}:${S4}`;
    const row = { organization_id: ORG, subject_type: "methodology_version", subject_id: D2, subject_version: 1, content_sha256: S4, validation_result: "pass", validation_report: "{}", impact: '{"affectedBenefits": []}', reviewer_role_code: "TO", review_task_count: 1, dedupe_key: key };
    let inserted = 0;
    for (let i = 0; i < 3; i++) {
      const id = uid();
      const cols = ["id", ...Object.keys(row)];
      const r = await c.query(`INSERT INTO revision_proposal (${cols.join(", ")}) VALUES (${cols.map((_, j) => `$${j + 1}`).join(", ")}) ON CONFLICT ON CONSTRAINT revision_proposal_dedupe_key DO NOTHING`, [id, ...Object.values(row)]);
      if (r.rowCount === 1) { inserted++; await audit(c, "revision_proposal", id, null, ORG, null); }
    }
    const n = (await c.query(`SELECT count(*)::int AS n FROM revision_proposal WHERE dedupe_key = $1`, [key])).rows[0].n;
    if (inserted !== 1 || n !== 1) throw new Error(`inserted ${inserted}, rows ${n}`);
    return "1 row after 3 attempts";
  });
  await expectFailure(c, "RV02 a dedupe key that does not match subject and content is refused", /revision_proposal_dedupe_shape/, async () => {
    await ins(c, "revision_proposal", { id: uid(), organization_id: ORG, subject_type: "methodology_version", subject_id: D2, subject_version: 1, content_sha256: S4, validation_result: "pass", validation_report: "{}", impact: "{}", reviewer_role_code: "TO", review_task_count: 0, dedupe_key: "free text" }, true, null);
  });
  await expectFailure(c, "RV03 a revision proposal without its audit event fails at COMMIT", /revision_proposal_audit_required/, async () => {
    await c.query(`INSERT INTO revision_proposal (id, organization_id, subject_type, subject_id, subject_version, content_sha256, validation_result, validation_report, impact, reviewer_role_code, review_task_count, dedupe_key)
      VALUES ($1, $2, 'methodology_version', $3, 1, $4, 'pass', '{}', '{}', 'TO', 0, $5)`, [uid(), ORG, D1, S1, `methodology_version:${D1}:${S1}`]);
  });
  await expectFailure(o, "RV04 a revision proposal is append-only (owner UPDATE refused)", /append-only/, async () => {
    await o.query(`UPDATE revision_proposal SET review_task_count = 2`);
  });

  // ---- review policy (REQ-S06-007)
  const POL = "01920005-0001-7000-8000-000000000001";
  await expectFailure(c, "RP01 a technical admin role as reviewer is refused", /config_review_policy_reviewer_not_admin/, async () => {
    await updx(c, "config_review_policy", POL, { reviewer_role_code: "ADM_METHOD" });
  });
  await expectFailure(c, "RP02 AUD as reviewer is refused", /config_review_policy_reviewer_not_auditor/, async () => {
    await updx(c, "config_review_policy", POL, { reviewer_role_code: "AUD" });
  });
  await expectFailure(c, "RP03 a policy change without its audit event fails at COMMIT", /config_review_policy_audit_required/, async () => {
    await updx(c, "config_review_policy", POL, { review_required: false }, { audit: false });
  });

  // ---- pins and methodology migration (REQ-S06-008, D-142 Q9)
  const PIN = (await c.query(`SELECT id FROM transformation_config_pin WHERE transformation_id = $1 AND kind = 'methodology'`, [TR])).rows[0].id;
  await expectFailure(c, "PN01 moving a pin without an approved migration is refused", /transformation_config_pin_moves_by_migration/, async () => {
    await updx(c, "transformation_config_pin", PIN, { methodology_version_id: D1 }, { tr: TR });
  });
  await expectFailure(c, "PN02 a scoring_defaults pin naming a methodology version is refused", /transformation_config_pin_kind_matches/, async () => {
    await ins(c, "transformation_config_pin", { id: uid(), organization_id: ORG, transformation_id: TR, kind: "scoring_defaults", methodology_version_id: MV1, pinned_by: U1, created_by: U1, updated_by: U1 });
  });
  await expectSuccess(c, "PN03 a scoring_defaults pin naming scoring defaults v1 commits", async () => ins(c, "transformation_config_pin", { id: uid(), organization_id: ORG, transformation_id: TR, kind: "scoring_defaults", methodology_version_id: SD1, pinned_by: U1, created_by: U1, updated_by: U1 }));
  await expectFailure(c, "MM01 a migration whose target is not published is refused", /methodology_migration_target_published/, async () => {
    await ins(c, "methodology_migration", { id: uid(), organization_id: ORG, transformation_id: TR, config_kind: "methodology", from_version_id: MV1, to_version_id: D2, reason: "Synthetic", requested_by: U1, created_by: U1, updated_by: U1 });
  });
  let MM = "";
  await expectSuccess(c, "MM02 a migration draft v1 -> v2 of the pinned transformation commits", async () => {
    MM = await ins(c, "methodology_migration", { id: uid(), organization_id: ORG, transformation_id: TR, config_kind: "methodology", from_version_id: MV1, to_version_id: D1, reason: "Synthetic migration to v2", requested_by: U1, created_by: U1, updated_by: U1 });
    return MM;
  });
  await expectFailure(c, "MM03 submitting without a ready plan is refused", /methodology_migration_ready_to_submit/, async () => {
    await updx(c, "methodology_migration", MM, { status: "submitted", submitted_by: U1, submitted_at: new Date() }, { tr: TR });
  });
  await expectSuccess(c, "MM04 plan items (new required field, G2 re-approval) are appended and the migration is submitted", async () => {
    await ins(c, "methodology_migration_item", { id: uid(), organization_id: ORG, transformation_id: TR, migration_id: MM, plan_revision: 1, ordinal: 1, item_kind: "new_required_field", element_type: "field", stable_key: "t13.adoption_kpi_owner", resolution: "needs_input", detail: "{}", created_by: U1 }, false);
    await ins(c, "methodology_migration_item", { id: uid(), organization_id: ORG, transformation_id: TR, migration_id: MM, plan_revision: 1, ordinal: 2, item_kind: "reapproval", gate_code: "G2", resolution: "automatic", detail: "{}", created_by: U1 }, false);
    await updx(c, "methodology_migration", MM, { plan_ready: true, plan_sha256: H(7) }, { tr: TR });
    await updx(c, "methodology_migration", MM, { status: "submitted", submitted_by: U1, submitted_at: new Date() }, { tr: TR });
    return "submitted";
  });
  await expectFailure(o, "MM05 a plan item is append-only (owner; the application role has no UPDATE)", /append-only/, async () => {
    await o.query(`UPDATE methodology_migration_item SET resolution = 'provided' WHERE migration_id = $1`, [MM]);
  });
  await expectFailure(c, "MM06 the plan is frozen once submitted", /methodology_migration_plan_frozen/, async () => {
    await updx(c, "methodology_migration", MM, { reason: "Changed reason" }, { tr: TR });
  });
  await expectFailure(c, "MM07 approved without a person's approval decision is refused", /methodology_migration_outcome_needs_decision/, async () => {
    await updx(c, "methodology_migration", MM, { status: "approved", decided_by: U2, decided_at: new Date() }, { tr: TR });
  });
  await expectFailure(c, "MM08 the requester cannot be the decider (the decision guard fires before the CHECK backstop)", /methodology_migration_decider_not_requester|methodology_migration_outcome_needs_decision/, async () => {
    await updx(c, "methodology_migration", MM, { status: "approved", decided_by: U1, decided_at: new Date() }, { tr: TR });
  });
  let AP = "";
  await expectSuccess(c, "MM09 the canonical approval (type methodology_migration) is requested and decided 'approve' by another person; the migration is approved", async () => {
    const v = (await c.query(`SELECT version FROM methodology_migration WHERE id = $1`, [MM])).rows[0].version;
    AP = await ins(c, "approval", { id: uid(), organization_id: ORG, transformation_id: TR, approval_type: "methodology_migration", subject_type: "methodology_migration", subject_id: MM, subject_version: v, title: "Synthetic migration approval", requested_by: U1, request_business_date: "2026-10-13", assignee_party_code: "TL", assignee_user_id: U2, due_unknown_reason: "no_sla", sod_policy: "requester_excluded", created_by: U1, updated_by: U1 }, true);
    await ins(c, "approval_decision", { id: uid(), organization_id: ORG, transformation_id: TR, approval_id: AP, round_no: 1, outcome: "approve", rationale: "Synthetic approval (approves nothing real)", subject_version: v, decided_by: U2, business_date: "2026-10-13" }, true, null);
    await updx(c, "methodology_migration", MM, { approval_id: AP, status: "approved", decided_by: U2, decided_at: new Date() }, { tr: TR });
    return "approved";
  });
  await expectFailure(c, "MM10 marking the migration executed without moving the pin fails at COMMIT", /methodology_migration_executed_moved_pin/, async () => {
    await updx(c, "methodology_migration", MM, { status: "executed", executed_by: U1, executed_at: new Date() }, { tr: TR });
  });
  await expectFailure(c, "MM11 moving the pin without its history row fails at COMMIT", /transformation_config_pin_history_required/, async () => {
    await updx(c, "transformation_config_pin", PIN, { methodology_version_id: D1, last_migration_id: MM }, { tr: TR });
    await updx(c, "methodology_migration", MM, { status: "executed", executed_by: U1, executed_at: new Date() }, { tr: TR });
  });
  await expectSuccess(c, "MM12 execution: pin moved v1 -> v2 by the approved migration, history appended, migration executed", async () => {
    const pv = (await c.query(`SELECT version FROM transformation_config_pin WHERE id = $1`, [PIN])).rows[0].version;
    await updx(c, "transformation_config_pin", PIN, { methodology_version_id: D1, last_migration_id: MM }, { tr: TR });
    await ins(c, "transformation_config_pin_history", { id: uid(), organization_id: ORG, transformation_id: TR, pin_id: PIN, pin_version: pv + 1, kind: "methodology", from_version_id: MV1, to_version_id: D1, migration_id: MM, created_by: U1 }, false);
    await updx(c, "methodology_migration", MM, { status: "executed", executed_by: U1, executed_at: new Date() }, { tr: TR });
    return "executed";
  });
  await expectFailure(o, "MM13 pin history is append-only (owner DELETE refused by the trigger; the application role has no DELETE)", /append-only/, async () => {
    await o.query(`DELETE FROM transformation_config_pin_history WHERE migration_id = $1`, [MM]);
  });
  await expectFailure(c, "MM14 an executed migration is final", /methodology_migration_status_transition/, async () => {
    await updx(c, "methodology_migration", MM, { status: "withdrawn", withdrawn_at: new Date() }, { tr: TR });
  });
  await expectFailure(c, "GR01 a re-approval marker must name an approved decision of the same gate", /gate_reapproval_names_approved_decision/, async () => {
    const gi = (await c.query(`SELECT id FROM gate_instance WHERE transformation_id = $1 LIMIT 1`, [TR])).rows[0]?.id ?? uid();
    await ins(c, "gate_reapproval", { id: uid(), organization_id: ORG, transformation_id: TR, migration_id: MM, gate_instance_id: gi, gate_code: "G2", approved_decision_id: uid(), created_by: U1, updated_by: U1 });
  });

  await c.end();
  await o.end();
  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 2;
  })
  .finally(() => process.exit());
