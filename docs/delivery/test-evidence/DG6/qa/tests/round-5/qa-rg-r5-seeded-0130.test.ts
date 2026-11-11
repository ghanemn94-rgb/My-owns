// qa-verifier DG6 RG round 5 (T-DG6-REV-QA-RG-R5): independent probe of the F-DG6-990 repair (migration 0130) and of
// served product text naming an engineering delivery gate (DG0-DG7). NOT part of the candidate: copied into a disposable
// clone at apps/api/test/integration/text-scan/ and run with
//   tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration <file>
// All data is SYNTHETIC. Nothing here approves anything (no G1-G6 business approval; no DG gate).
//
// P1 row guards and history of 0130, on a database migrated to 0129 and then changed the way a user or an earlier
//    release could have changed it, before 0130 is applied:
//    - S1 a job service identity whose row a user touched (updated_by set, reason still the seeded one);
//    - S2 the kpi.freshness_scan schedule whose cron a user changed (version stepped, updated_by set);
//    - S3 a job schedule whose description no longer equals the seeded text.
//    Then: exactly 0130 is applied; S1 and S3 are left alone; S2 is reworded with a version step from the user's version;
//    every other column of every touched table equals its pre-0130 value; every pre-0130 audit_event and
//    service_identity_change row is byte-identical afterwards (append-only); the new audit rows are exactly the reword
//    events; a second migrate applies nothing.
// P2 every served string of every parameterless GET operation of docs/api/openapi.yaml (plus one detail call per list),
//    as an ADM_ACCESS+ADM_TECH administrator and as an auditor, on a database migrated to the latest version: none names
//    DG0-DG7 (the shared rule, with an NFKC copy); internal references (D-nnn, ADR-nnnn, F-/T-DGx-) are listed.
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultMigrationsDir, migrate } from "@mth/db";
import { mentionsEngineeringGate } from "@mth/shared";
import pg from "pg";
import { v7 as uuidv7 } from "uuid";
import { parse as parseYaml } from "yaml";
import { afterAll, describe, expect, inject, it } from "vitest";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import { call, seedWorld, signIn, startApi } from "../../support/harness.ts";

const INTERNAL = /(?<![A-Za-z0-9_])(?:D-\d{3}|ADR-\d{4}|[FT]-DG\d)/;
const gate = (t: string) => mentionsEngineeringGate(t) || mentionsEngineeringGate(t.normalize("NFKC"));

const cleanups: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const c of cleanups.reverse()) await c().catch(() => undefined);
}, 120_000);

async function q<T extends pg.QueryResultRow = any>(pool: pg.Pool, sql: string, params: unknown[] = []) {
  return (await pool.query<T>(sql, params)).rows;
}

/** Stable (non-text, non-version) columns of the 0130 tables, keyed by natural key. */
async function stable(pool: pg.Pool) {
  return {
    job: await q(pool, `SELECT to_jsonb(s) - 'description_en' - 'version' - 'updated_at' - 'updated_by' AS row
                          FROM job_schedule s ORDER BY s.code`),
    // every column but the note and the row bookkeeping: content, content_sha256, status, publication, authorship
    ruleVersion: await q(pool, `SELECT r.code, to_jsonb(v) - 'change_summary' - 'version' - 'updated_at' - 'updated_by' AS row
                                  FROM automation_rule_version v JOIN automation_rule r ON r.id = v.automation_rule_id
                                 ORDER BY r.code, v.version_no`),
    procedure: await q(pool, `SELECT to_jsonb(d) - 'validation_rules_en' - 'validation_rules_ar' - 'version' - 'updated_at' - 'updated_by' AS row
                                FROM procedure_definition d ORDER BY d.code, d.methodology_version_id`),
    identity: await q(pool, `SELECT to_jsonb(s) - 'reason' - 'version' - 'updated_at' - 'updated_by' AS row
                               FROM service_identity s ORDER BY s.code`),
    sourceField: await q(pool, `SELECT to_jsonb(f) - 'storage_ref' AS row FROM form_source_field f ORDER BY f.id`),
  };
}

describe("QA-RG-R5 P1: 0130 row guards, versions, audit and append-only history", () => {
  it("applies only to still-seeded rows, steps versions, audits, and never rewrites history", async () => {
    const { adminUrl } = inject("mthDb");
    const dir = mkdtempSync(join(tmpdir(), "qa-r5-pre0130-"));
    const db = await createScratchDatabase(adminUrl, "qa_r5_0130");
    const pool = new pg.Pool({ connectionString: roleUrl(adminUrl, db, "mth_owner"), max: 2 });
    cleanups.push(async () => {
      await pool.end();
      await dropScratchDatabase(adminUrl, db);
      rmSync(dir, { recursive: true, force: true });
    });
    const files = readdirSync(defaultMigrationsDir()).filter((f) => /^\d{4}_.*\.sql$/.test(f));
    const reword = files.find((f) => f.endsWith("_p6_seeded_text_business_terms.sql"))!;
    expect(reword).toBe("0130_p6_seeded_text_business_terms.sql");
    for (const f of files) if (f < reword) cpSync(join(defaultMigrationsDir(), f), join(dir, f));
    await migrate(roleUrl(adminUrl, db, "mth_owner"), { dir });

    // A synthetic organization and user (the actor of the pre-0130 changes).
    const org = uuidv7();
    const user = uuidv7();
    await q(pool, `INSERT INTO organization (id, code, name_en, name_ar) VALUES ($1, 'QA-R5', 'Synthetic QA R5', 'اصطناعي')`, [org]);
    await q(pool, `INSERT INTO app_user (id, organization_id, display_name, email, status) VALUES ($1, $2, 'Synthetic QA user', 'qa.r5@example.invalid', 'active')`, [user, org]);

    const audit = async (type: string, id: string, prior: number, next: number, changes: object) =>
      q(pool, `INSERT INTO audit_event (id, actor_type, actor_user_id, action, record_type, record_id, prior_version, new_version, reason, source, changes)
               VALUES ($1, 'user', $2, $3, $4, $5, $6, $7, 'QA-R5 synthetic pre-0130 change', 'api', $8)`,
        [uuidv7(), user, `${type}.update`, type, id, prior, next, JSON.stringify(changes)]);

    // S1: a job identity touched by a user, reason still the seeded 0114 text.
    const [s1] = await q(pool, `SELECT id, code, version, reason FROM service_identity
                                 WHERE subject_kind = 'job' AND reason LIKE '%the DG5 handler%' ORDER BY code LIMIT 1`);
    await pool.query("BEGIN");
    await q(pool, `UPDATE service_identity SET updated_by = $2, version = version + 1, updated_at = now() WHERE id = $1`, [s1.id, user]);
    await audit("service_identity", s1.id, s1.version, s1.version + 1, { updated_by: { from: null, to: user } });
    await pool.query("COMMIT");
    // S2: kpi.freshness_scan cron changed by a user.
    const [s2] = await q(pool, `SELECT id, version, cron FROM job_schedule WHERE code = 'kpi.freshness_scan'`);
    await pool.query("BEGIN");
    await q(pool, `UPDATE job_schedule SET cron = '7 3 * * *', updated_by = $2, version = version + 1, updated_at = now() WHERE id = $1`, [s2.id, user]);
    await audit("job_schedule", s2.id, s2.version, s2.version + 1, { cron: { from: s2.cron, to: "7 3 * * *" } });
    await pool.query("COMMIT");
    // S3: search.reindex description no longer the seeded text (as any earlier release or correction could leave it).
    const [s3] = await q(pool, `SELECT id, version, description_en FROM job_schedule WHERE code = 'search.reindex'`);
    const s3text = s3.description_en.replace("Rebuild", "QA-R5 rebuild");
    await pool.query("BEGIN");
    await q(pool, `UPDATE job_schedule SET description_en = $2, version = version + 1, updated_at = now() WHERE id = $1`, [s3.id, s3text]);
    await audit("job_schedule", s3.id, s3.version, s3.version + 1, { description_en: { from: s3.description_en, to: s3text } });
    await pool.query("COMMIT");

    const before = await stable(pool);
    const auditBefore = await q(pool, `SELECT id, md5(to_jsonb(a)::text) AS h FROM audit_event a ORDER BY id`);
    const historyBefore = await q(pool, `SELECT md5(to_jsonb(h)::text) AS h FROM service_identity_change h ORDER BY 1`);
    const s1Before = (await q(pool, `SELECT to_jsonb(s) AS r FROM service_identity s WHERE id = $1`, [s1.id]))[0].r;
    const s3Before = (await q(pool, `SELECT to_jsonb(s) AS r FROM job_schedule s WHERE id = $1`, [s3.id]))[0].r;
    console.log(`[QA-R5 P1] pre-0130: audit ${auditBefore.length}, identity history ${historyBefore.length}; S1 ${s1.code}`);

    // Apply 0130 alone (the full directory now).
    const applied = await migrate(roleUrl(adminUrl, db, "mth_owner"));
    expect(applied).toEqual([reword]);
    expect(await migrate(roleUrl(adminUrl, db, "mth_owner"))).toEqual([]);

    // S1 and S3 untouched, byte for byte.
    expect((await q(pool, `SELECT to_jsonb(s) AS r FROM service_identity s WHERE id = $1`, [s1.id]))[0].r).toEqual(s1Before);
    expect((await q(pool, `SELECT to_jsonb(s) AS r FROM job_schedule s WHERE id = $1`, [s3.id]))[0].r).toEqual(s3Before);
    // S2 reworded from the user's version; the user's cron kept.
    const [s2After] = await q(pool, `SELECT description_en, version, cron, updated_by FROM job_schedule WHERE id = $1`, [s2.id]);
    console.log(`[QA-R5 P1] S2 after 0130: ${JSON.stringify(s2After)}`);
    expect(s2After.version).toBe(s2.version + 2);
    expect(s2After.cron).toBe("7 3 * * *");
    expect(s2After.description_en).toContain("(the KPI freshness rule, unchanged)");
    const [s2Audit] = await q(pool, `SELECT prior_version, new_version, actor_type, source FROM audit_event WHERE record_id = $1 AND action = 'job_schedule.reword'`, [s2.id]);
    expect(s2Audit).toEqual({ prior_version: s2.version + 1, new_version: s2.version + 2, actor_type: "system", source: "migration" });

    // Every other column of the touched tables is unchanged.
    expect(await stable(pool)).toEqual(before);

    // Append-only: every earlier audit row and identity history row is byte-identical; new audit rows = reword events.
    const auditAfter = await q(pool, `SELECT id, md5(to_jsonb(a)::text) AS h, action FROM audit_event a ORDER BY id`);
    const afterById = new Map(auditAfter.map((r) => [r.id, r.h]));
    for (const r of auditBefore) expect(afterById.get(r.id), `audit ${r.id}`).toBe(r.h);
    const added = auditAfter.filter((r) => !auditBefore.some((b) => b.id === r.id));
    const byAction: Record<string, number> = {};
    for (const r of added) byAction[r.action] = (byAction[r.action] ?? 0) + 1;
    console.log(`[QA-R5 P1] audit rows added by 0130: ${JSON.stringify(byAction)}`);
    expect(byAction).toEqual({
      "automation_rule_version.reword": 17,
      "form_source_field.reword": 3,
      "job_schedule.reword": 4,
      "procedure_definition.reword": 12,
      "service_identity.reword": 48,
    });
    const historyAfter = await q(pool, `SELECT md5(to_jsonb(h)::text) AS h FROM service_identity_change h ORDER BY 1`);
    const hset = new Set(historyAfter.map((r) => r.h));
    for (const r of historyBefore) expect(hset.has(r.h)).toBe(true);
    expect(historyAfter.length - historyBefore.length).toBe(48);

    // The served texts of the reworded rows: no gate name, no internal reference (S1, S3 aside).
    const texts = [
      ...(await q(pool, `SELECT code AS k, description_en AS t FROM job_schedule WHERE id <> $1`, [s3.id])),
      ...(await q(pool, `SELECT v.id::text AS k, change_summary AS t FROM automation_rule_version v`)),
      ...(await q(pool, `SELECT code AS k, validation_rules_en || ' | ' || validation_rules_ar AS t FROM procedure_definition`)),
      ...(await q(pool, `SELECT code AS k, reason AS t FROM service_identity WHERE id <> $1`, [s1.id])),
    ].filter((r) => r.t !== null);
    const bad = texts.filter((r) => gate(r.t) || INTERNAL.test(r.t));
    expect(bad).toEqual([]);
  }, 600_000);
});

describe("QA-RG-R5 P2: served text of every parameterless GET operation", () => {
  it("no response names DG0-DG7 (admin and auditor)", async () => {
    const api = await startApi();
    cleanups.push(() => api.close());
    const w = await seedWorld(api.db);
    const sessions = { admin: await signIn(api.app, w.admin.subject), auditor: await signIn(api.app, w.auditor.subject) };
    const spec = parseYaml(readFileSync(join(process.cwd(), "docs/api/openapi.yaml"), "utf8")) as any;
    const gets: { path: string; orgParam: boolean }[] = [];
    for (const [path, item] of Object.entries<any>(spec.paths)) {
      if (!item.get || path.includes("{")) continue;
      const params = [...(item.parameters ?? []), ...(item.get.parameters ?? [])];
      const refs = params.map((p: any) => p.$ref ?? p.name);
      const required = params.filter((p: any) => p.required && p.in === "query" && !p.$ref);
      if (required.length > 0) continue; // needs a value this sweep cannot choose
      gets.push({ path, orgParam: refs.some((r: string) => /OrganizationId/.test(r)) });
    }
    const gateHits: string[] = [];
    const refHits: string[] = [];
    const statuses: Record<string, number> = {};
    const walk = (v: unknown, where: string) => {
      if (typeof v === "string") {
        if (gate(v)) gateHits.push(`${where}: ${v}`);
        if (INTERNAL.test(v)) refHits.push(`${where}: ${v}`);
      } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${where}[${i}]`));
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${where}.${k}`);
    };
    let calls = 0;
    for (const [who, session] of Object.entries(sessions)) {
      for (const g of gets) {
        let url = g.path;
        let r = await call<any>(api.app, "GET", url, { session });
        if (r.status === 400 && g.orgParam) {
          url = `${g.path}?organizationId=${w.orgA.id}`;
          r = await call<any>(api.app, "GET", url, { session });
        }
        calls += 1;
        statuses[r.status] = (statuses[r.status] ?? 0) + 1;
        walk(r.body, `${who} GET ${url}`);
        // One detail call per list: <path>/{id} for the first item, when the contract has that path.
        const first = Array.isArray(r.body?.items) ? r.body.items[0] : undefined;
        const detail = Object.keys(spec.paths).find((p) => p.startsWith(`${g.path}/{`) && /^\{[^}]+\}$/.test(p.slice(g.path.length + 1)));
        if (r.status === 200 && first?.id && detail && spec.paths[detail].get) {
          const d = await call<any>(api.app, "GET", `${g.path}/${first.id}`, { session });
          calls += 1;
          statuses[d.status] = (statuses[d.status] ?? 0) + 1;
          walk(d.body, `${who} GET ${g.path}/${first.id}`);
        }
      }
    }
    console.log(`[QA-R5 P2] operations swept: ${gets.length} parameterless GET paths; calls ${calls}; statuses ${JSON.stringify(statuses)}`);
    console.log(`[QA-R5 P2] gate hits: ${gateHits.length}`);
    for (const h of gateHits) console.log(`[QA-R5 P2] GATE ${h.slice(0, 400)}`);
    console.log(`[QA-R5 P2] internal-reference hits (listed, judged in the record): ${refHits.length}`);
    for (const h of refHits) console.log(`[QA-R5 P2] REF ${h.slice(0, 400)}`);
    expect(gets.length).toBeGreaterThan(50);
    expect(gateHits).toEqual([]);
  }, 900_000);
});
