// Code-security reviewer, DG6 clean re-gate round 5 (T-DG6-REV-CS-RG-R5): migration 0130 adversarial upgrade probe,
// NOT product code. Copy to packages/db/test/integration/ in a DISPOSABLE clone and run with
//   npx vitest run --project integration packages/db/test/integration/zz-sec-r5-upgrade-0130.test.ts
//
// Questions (F-DG6-990 repair, T-DG6-BE-RG3):
//  U1 ids: forward-only and contiguous (P6 range 0098-0130).
//  U2 0130 as an UPGRADE over a DEMO-initialized database at 0129 (not only fresh), with three adversarial pre-states
//     made as the owner role (simulating administrator writes): (a) job search.reindex whose description an
//     administrator changed -> must be left alone, no version step, no audit event; (b) job search.index_feed changed
//     by an administrator elsewhere (version 1 -> 2, updated_by set) but description still seeded -> reworded, version
//     2 -> 3, audit prior 2 / new 3 with the exact {from, to}; (c) one job service identity with updated_by set and
//     the seeded reason -> left alone (row guard updated_by IS NULL).
//  U3 every changed row: one audit event, prior = new - 1 where versioned; service_identity_change keeps the previous
//     reason (append-only) and gains the new one at the new record_version.
//  U4 0130 re-applied as raw SQL on the upgraded database changes nothing (the exact-match guards make it idempotent).
//  U5 the gate-rule scan of the shipped seeded-texts test, over the demo-initialized upgraded database and over a fresh
//     0001-0130 database seeded with the demo dataset: list every hit (the demo data is outside the shipped scan).
// All data is SYNTHETIC. Nothing here approves anything (G1-G6) or touches DG0-DG7.
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { mentionsEngineeringGate } from "@mth/shared";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { seedDemo } from "../../src/demo/seed.ts";
import { defaultMigrationsDir, listMigrationFiles, migrate } from "../../src/migrate.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl, testDatabase } from "../helpers.ts";

const { adminUrl } = testDatabase();
const scratch: string[] = [];
const dirs: string[] = [];
const INTERNAL_REFERENCE = /(?<![A-Za-z0-9_])(?:D-\d{3}|ADR-\d{4})(?![0-9])/;

afterAll(async () => {
  for (const name of scratch) await dropScratchDatabase(adminUrl, name);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}, 120_000);

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** Every text/json/array value of the public schema that the gate rule (or the ref rule) matches. No exclusions. */
async function allHits(c: pg.Client) {
  const cols = await c.query<{ t: string; c: string; kind: string }>(
    `SELECT c.table_name AS t, c.column_name AS c,
            CASE WHEN c.data_type IN ('json','jsonb') THEN 'json' WHEN c.data_type = 'ARRAY' THEN 'array' ELSE 'text' END AS kind
       FROM information_schema.columns c
       JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
        AND (c.data_type IN ('text','character varying','character','json','jsonb')
             OR (c.data_type = 'ARRAY' AND c.udt_name IN ('_text','_varchar','_bpchar')))`,
  );
  const gate: string[] = [];
  const refs: string[] = [];
  for (const { t, c: col, kind } of cols.rows) {
    const x = `x.${ident(col)}`;
    const v = kind === "array" ? `array_to_json(${x})::text` : kind === "json" ? `${x}::text` : x;
    const rows = await c.query<{ v: string }>(`SELECT ${v} AS v FROM ${ident(t)} x WHERE ${v} ~* '(dg|d-[0-9]|adr-)'`);
    for (const r of rows.rows) {
      const texts: string[] = [];
      const collect = (val: unknown): void => {
        if (typeof val === "string") texts.push(val);
        else if (Array.isArray(val)) val.forEach(collect);
        else if (val && typeof val === "object") Object.values(val).forEach(collect);
      };
      if (kind === "text") texts.push(r.v);
      else collect(JSON.parse(r.v));
      for (const s of texts) {
        const norm = s.replace(/\p{White_Space}/gu, " ").normalize("NFKC");
        if (mentionsEngineeringGate(s) || mentionsEngineeringGate(norm)) gate.push(`${t}.${col}: ${s.slice(0, 220)}`);
        else if (INTERNAL_REFERENCE.test(s)) refs.push(`${t}.${col}: ${s.slice(0, 160)}`);
      }
    }
  }
  const tally = (xs: string[]) => {
    const m = new Map<string, number>();
    for (const s of xs) m.set(s, (m.get(s) ?? 0) + 1);
    return [...m.entries()].map(([s, n]) => `${n}x ${s}`).sort();
  };
  return { gate: tally(gate), refs: tally(refs), gateRows: gate.length, refRows: refs.length };
}

async function client(url: string) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  return c;
}

describe("SEC-R5: migration 0130 (F-DG6-990 repair)", () => {
  it("U1: ids are forward-only; the P6 range 0098-0130 is contiguous", () => {
    const ids = listMigrationFiles().map((f) => Number(f.name.slice(0, 4)));
    console.log("[SEC-R5-UPG] migrations:", ids.length, "last", listMigrationFiles().at(-1)?.name);
    expect(ids.every((id, i) => i === 0 || id > ids[i - 1]!)).toBe(true);
    expect(ids.filter((id) => id >= 98)).toEqual(Array.from({ length: 33 }, (_, i) => 98 + i));
  });

  it("U2-U5: upgrade over a demo-initialized 0129 database with administrator pre-states", async () => {
    const dir = mkdtempSync(join(process.env["TMPDIR"] ?? "/tmp", "mig-r5-"));
    dirs.push(dir);
    for (const f of readdirSync(defaultMigrationsDir()))
      if (!f.startsWith("0130_")) cpSync(join(defaultMigrationsDir(), f), join(dir, f));
    const up = await createScratchDatabase(adminUrl, "mth_r5up");
    scratch.push(up);
    const url = roleUrl(adminUrl, up, "mth_owner");
    await migrate(url, { dir });
    await seedDemo(url, { mthEnv: "demo", runKind: "seed", requestedVia: "cli", requestedBy: null });
    const c = await client(url);
    try {
      const user = (await c.query<{ id: string }>(`SELECT id FROM app_user ORDER BY id LIMIT 1`)).rows[0]!.id;
      // An administrator write = the row update and its audit event in one transaction (the deferred
      // *_audit_required triggers demand the event at COMMIT, as for every product write).
      const adminWrite = async (table: string, where: string, set: string, params: unknown[] = []) => {
        await c.query("BEGIN");
        const r = await c.query<{ id: string; version: number }>(
          `UPDATE ${table} SET ${set}, version = version + 1, updated_by = '${user}', updated_at = now() WHERE ${where} RETURNING id, version`,
          params,
        );
        expect(r.rowCount).toBe(1);
        await c.query(
          `INSERT INTO audit_event (id, actor_type, actor_user_id, action, record_type, record_id, prior_version, new_version, reason, source)
           VALUES (mth_uuid_v7(), 'user', $1, '${table}.update', '${table}', $2, $3, $4, 'Synthetic administrator write (SEC-R5 probe).', 'api')`,
          [user, r.rows[0]!.id, r.rows[0]!.version - 1, r.rows[0]!.version],
        );
        await c.query("COMMIT");
      };
      // (a) administrator-changed description (keeps "ADR-0057" so it stays recognisable; it is the admin's text)
      await adminWrite("job_schedule", "code = 'search.reindex'", "description_en = 'Admin wording kept as is (ADR-0057 note by the admin).'");
      // (b) administrator changed something else; description still seeded
      await adminWrite("job_schedule", "code = 'search.index_feed'", "enabled = enabled");
      // (c) a job identity changed by a person (updated_by set) but still holding a seeded reason
      const si = (
        await c.query<{ id: string; version: number; reason: string }>(
          `SELECT id, version, reason FROM service_identity WHERE subject_kind = 'job' AND reason LIKE 'Seeded declaration (0117;%' ORDER BY id LIMIT 1`,
        )
      ).rows[0]!;
      await adminWrite("service_identity", `id = '${si.id}'`, "granted_permission_codes = granted_permission_codes");
      const before = await c.query<{ code: string; version: number; d: string }>(
        `SELECT code, version, description_en AS d FROM job_schedule WHERE code IN ('search.reindex','search.index_feed','kpi.freshness_scan') ORDER BY code`,
      );
      console.log("[SEC-R5-UPG] before 0130:", JSON.stringify(before.rows));
      const auditBefore = Number((await c.query(`SELECT count(*) AS n FROM audit_event`)).rows[0].n);
      const preHits = await allHits(c);
      console.log("[SEC-R5-UPG] demo DB at 0129, gate-rule rows:", preHits.gateRows);

      const applied = await migrate(url);
      console.log("[SEC-R5-UPG] upgrade applied:", JSON.stringify(applied));

      const after = await c.query<{ code: string; version: number; d: string; updated_by: string | null }>(
        `SELECT code, version, description_en AS d, updated_by FROM job_schedule WHERE code IN ('search.reindex','search.index_feed','kpi.freshness_scan') ORDER BY code`,
      );
      console.log("[SEC-R5-UPG] after 0130:", JSON.stringify(after.rows));
      const byCode = Object.fromEntries(after.rows.map((r) => [r.code, r]));
      expect(byCode["search.reindex"]!.d).toBe("Admin wording kept as is (ADR-0057 note by the admin).");
      expect(byCode["search.reindex"]!.version).toBe(2);
      expect(byCode["search.index_feed"]!.version).toBe(3);
      expect(byCode["search.index_feed"]!.d).not.toContain("ADR-");
      expect(byCode["kpi.freshness_scan"]!.d).toContain("(the KPI freshness rule, unchanged)");

      const ev = await c.query<{ action: string; record_type: string; prior_version: number | null; new_version: number | null; actor_type: string; source: string; reason: string; changes: unknown; record_id: string }>(
        `SELECT action, record_type, prior_version, new_version, actor_type, source, reason, changes, record_id::text FROM audit_event WHERE action LIKE '%.reword' ORDER BY record_type, record_id`,
      );
      const count = (rt: string) => ev.rows.filter((e) => e.record_type === rt).length;
      console.log(
        "[SEC-R5-UPG] reword audit events by type:",
        JSON.stringify(["automation_rule_version", "form_source_field", "job_schedule", "procedure_definition", "service_identity"].map((t) => [t, count(t)])),
      );
      expect(Number((await c.query(`SELECT count(*) AS n FROM audit_event`)).rows[0].n) - auditBefore).toBe(ev.rows.length);
      expect(ev.rows.every((e) => e.actor_type === "system" && e.source === "migration")).toBe(true);
      expect(ev.rows.filter((e) => e.record_type !== "form_source_field").every((e) => e.new_version === (e.prior_version ?? -9) + 1)).toBe(true);
      const feed = ev.rows.filter((e) => e.record_type === "job_schedule");
      const reindexId = (await c.query(`SELECT id::text FROM job_schedule WHERE code='search.reindex'`)).rows[0].id;
      const feedId = (await c.query(`SELECT id::text FROM job_schedule WHERE code='search.index_feed'`)).rows[0].id;
      expect(feed.filter((e) => e.record_id === reindexId)).toEqual([]);
      const fe = feed.find((e) => e.record_id === feedId)!;
      expect([fe.prior_version, fe.new_version]).toEqual([2, 3]);
      console.log("[SEC-R5-UPG] search.index_feed audit changes:", JSON.stringify(fe.changes));
      expect(count("job_schedule")).toBe(4);

      // (c) the person-changed identity: untouched, still holds the seeded reason
      const siAfter = (await c.query(`SELECT version, reason FROM service_identity WHERE id = $1`, [si.id])).rows[0];
      console.log("[SEC-R5-UPG] person-changed identity after 0130:", JSON.stringify(siAfter));
      expect(siAfter).toEqual({ version: si.version + 1, reason: si.reason });
      expect(ev.rows.filter((e) => e.record_id === si.id)).toEqual([]);
      // U3 history: an identity 0130 changed keeps its previous reason and gains the new one
      const changed = ev.rows.find((e) => e.record_type === "service_identity")!;
      const hist = await c.query(
        `SELECT record_version, reason FROM service_identity_change WHERE service_identity_id = $1 ORDER BY record_version`,
        [changed.record_id],
      );
      console.log("[SEC-R5-UPG] history of one reworded identity:", JSON.stringify(hist.rows));
      expect(hist.rows.length).toBeGreaterThanOrEqual(2);
      expect(INTERNAL_REFERENCE.test(hist.rows.at(-2).reason) || mentionsEngineeringGate(hist.rows.at(-2).reason)).toBe(true);
      expect(hist.rows.at(-1).record_version).toBe(changed.new_version);

      // U4 idempotent re-application of the raw SQL
      const sql = readFileSync(join(defaultMigrationsDir(), readdirSync(defaultMigrationsDir()).find((f) => f.startsWith("0130_"))!), "utf8");
      const n0 = Number((await c.query(`SELECT count(*) AS n FROM audit_event`)).rows[0].n);
      await c.query("BEGIN");
      await c.query(sql);
      await c.query("COMMIT");
      const n1 = Number((await c.query(`SELECT count(*) AS n FROM audit_event`)).rows[0].n);
      console.log("[SEC-R5-UPG] audit events added by a second raw application:", n1 - n0);
      expect(n1 - n0).toBe(0);

      // U5 what the gate rule still finds on the demo-initialized upgraded database (no exclusions)
      const postHits = await allHits(c);
      console.log("[SEC-R5-UPG] demo DB after 0130, gate-rule rows:", postHits.gateRows, "distinct:");
      for (const h of postHits.gate) console.log("[SEC-R5-UPG]   GATE", h);
      console.log("[SEC-R5-UPG] demo DB after 0130, internal-reference rows (observation):", postHits.refRows);
      for (const h of postHits.refs) console.log("[SEC-R5-UPG]   REF", h);
    } finally {
      await c.end();
    }

    // U5 fresh 0001-0130 + demo dataset
    const fr = await createScratchDatabase(adminUrl, "mth_r5fr");
    scratch.push(fr);
    const furl = roleUrl(adminUrl, fr, "mth_owner");
    await migrate(furl);
    await seedDemo(furl, { mthEnv: "demo", runKind: "seed", requestedVia: "cli", requestedBy: null });
    const f = await client(furl);
    try {
      const h = await allHits(f);
      console.log("[SEC-R5-UPG] fresh 0001-0130 + demo dataset, gate-rule rows:", h.gateRows, "distinct:");
      for (const x of h.gate) console.log("[SEC-R5-UPG]   GATE", x);
      console.log("[SEC-R5-UPG] fresh + demo, internal-reference rows (observation):", h.refRows);
      for (const x of h.refs) console.log("[SEC-R5-UPG]   REF", x);
    } finally {
      await f.end();
    }
  }, 600_000);
});
