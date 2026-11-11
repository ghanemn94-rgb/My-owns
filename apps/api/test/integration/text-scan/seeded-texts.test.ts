// Text scan (d) (REQ-S21-001, M0007, M0412; T-DG6-BE-RG3, F-DG6-990): the text SEEDED by the migrations. The scans
// (a)-(c) read the web catalogues, the source literals and the export templates; the product also serves text that a
// migration stored (job descriptions, automation version notes, procedure definitions, service identity reasons ...),
// which they never saw. This scan migrates a fresh scratch database 0001 -> latest (production-initialized: no
// organization, no demo data) and reads EVERY text, character, array and JSON column of EVERY table of the public
// schema, so a new table or column is scanned without a change here. A value fails when it
//   - names an engineering delivery gate (the shared rule, `mentionsEngineeringGate`, with the scan's normalized copy;
//     finding and task ids such as F-DG6-990 / T-DG6-BE-RG3 match it too), or
//   - cites an internal engineering record: a decision id (D-142) or an ADR (ADR-0053).
// Excluded, because they are history that by design is never rewritten (ADR-0004 append-only):
//   - the previous value (`from`) of an audit event's changes: the trail must keep what a record said before a change;
//   - the rows of service_identity_change (trigger-written history, served by no route; checked below) that still hold
//     a reason 0130 replaced;
//   - REPORTED_AUDIT_REASONS: the exact `reason` texts that earlier migrations wrote into the append-only audit trail.
//     They ARE readable in the audit trail (apps/api/src/modules/audit), cannot be changed, and are reported in the
//     T-DG6-BE-RG3 handback for the orchestrator. Matched by exact text, so any other value fails. May only shrink.
// The last test migrates a second scratch database WITHOUT 0130 and shows that the scan finds the F-DG6-990 texts there.
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultMigrationsDir, migrate } from "@mth/db";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import { literalsUnder, scan, type ProductText } from "../../text-scan/scan.ts";

/** A decision id (D-142) or an ADR id (ADR-0053), not part of a longer word or number. */
const INTERNAL_REFERENCE = /(?<![A-Za-z0-9_])(?:D-\d{3}|ADR-\d{4})(?![0-9])/;

/** Exact audit_event.reason texts written by earlier migrations (append-only history; see the header). */
const REPORTED_AUDIT_REASONS: readonly string[] = [
  "Seeded forms configuration v1 (T-DG5-ARCH-02)",
  "Seeded procedures configuration v1 (T-DG5-ARCH-02)",
  "Seeded procedures configuration v2 (T-DG5-BE-T3, D-165)",
  "Seeded procedures configuration v2: record_baseline assigned to TL (T-DG5-BE-T3, D-165)",
  "Seeded health-check scoring scheme v1 (T-DG5-ARCH-05)",
];

/** The reasons 0130 replaced, which the append-only service_identity_change history keeps. */
const REPLACED_IDENTITY_REASONS: readonly string[] = [
  "Seeded declaration (0114; ADR-0053 §1): the narrowest set of read permissions the DG5 handler needs.",
  "Seeded declaration (0115; ADR-0053 §1). Declared exception (ADR-0057 §2, D-199): reads only the indexed columns (code, title, summary, status) of sensitive benefits, business cases and evidence; no value column; every reader is filtered at query time.",
  "Seeded declaration (0116; ADR-0053 §1, ADR-0055 §2).",
  "Seeded declaration (0117; ADR-0053 §1): the narrowest read set the operations job needs.",
  "Seeded declaration (0121; ADR-0053 §1): the narrowest read set the notification channel job needs.",
];

interface SeededHit extends ProductText {
  readonly rule: "engineering_gate" | "internal_reference";
}

/** Every string inside a JSON value; under `changes` of audit_event the `from` side of each change is skipped. */
function jsonTexts(value: unknown, skipFrom: boolean, depth = 0): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((v) => jsonTexts(v, skipFrom, depth + 1));
  if (value !== null && typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) =>
      skipFrom && depth === 1 && k === "from" ? [] : jsonTexts(v, skipFrom, depth + 1),
    );
  return [];
}

/** A quoted SQL identifier (the names come from information_schema). */
const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** Every seeded value of the database that breaks a rule (after the history exclusions of the header). */
async function seededHits(pool: pg.Pool): Promise<{ columns: number; hits: SeededHit[] }> {
  const cols = await pool.query<{ t: string; c: string; kind: string }>(
    `SELECT c.table_name AS t, c.column_name AS c,
            CASE WHEN c.data_type IN ('json', 'jsonb') THEN 'json'
                 WHEN c.data_type = 'ARRAY' THEN 'array' ELSE 'text' END AS kind
       FROM information_schema.columns c
       JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
        AND (c.data_type IN ('text', 'character varying', 'character', 'json', 'jsonb')
             OR (c.data_type = 'ARRAY' AND c.udt_name IN ('_text', '_varchar', '_bpchar')))
      ORDER BY 1, 2`,
  );
  const hits: SeededHit[] = [];
  for (const { t, c, kind } of cols.rows) {
    // A cheap, deliberately wide pre-filter in SQL (case-insensitive "dg", any "d-<digit>" or "adr-"); the rules are
    // applied in TypeScript below. Arabic-Indic digits after "DG" are covered: "dg" alone passes the filter.
    const col = `x.${ident(c)}`;
    const value = kind === "array" ? `array_to_json(${col})::text` : kind === "json" ? `${col}::text` : col;
    const rows = await pool.query<{ id: string | null; v: string }>(
      `SELECT to_jsonb(x) ->> 'id' AS id, ${value} AS v FROM ${ident(t)} x WHERE ${value} ~* '(dg|d-[0-9]|adr-)'`,
    );
    for (const r of rows.rows) {
      const where = `${t}.${c}${r.id ? `#${r.id}` : ""}`;
      const texts = kind === "text" ? [r.v] : jsonTexts(JSON.parse(r.v), t === "audit_event" && c === "changes");
      for (const text of texts) {
        if (t === "audit_event" && c === "reason" && REPORTED_AUDIT_REASONS.includes(text)) continue;
        if (t === "service_identity_change" && c === "reason" && REPLACED_IDENTITY_REASONS.includes(text)) continue;
        if (scan([{ where, text }]).some((v) => v.rule === "engineering_gate"))
          hits.push({ where, text, rule: "engineering_gate" });
        if (INTERNAL_REFERENCE.test(text)) hits.push({ where, text, rule: "internal_reference" });
      }
    }
  }
  return { columns: cols.rowCount ?? 0, hits };
}

const fmt = (hits: readonly SeededHit[]) => hits.map((h) => `${h.rule} ${h.where}: ${h.text}`);

let adminUrl: string;
let latestDb: string;
let latest: pg.Pool;

beforeAll(async () => {
  adminUrl = inject("mthDb").adminUrl;
  latestDb = await createScratchDatabase(adminUrl, "mth_seedtext");
  await migrate(roleUrl(adminUrl, latestDb, "mth_owner"));
  latest = new pg.Pool({ connectionString: roleUrl(adminUrl, latestDb, "mth_owner"), max: 2 });
}, 240_000);

afterAll(async () => {
  await latest?.end();
  if (latestDb) await dropScratchDatabase(adminUrl, latestDb);
}, 60_000);

describe("REQ-S21-001: text seeded by the migrations (scan d)", () => {
  it("no seeded value names an engineering delivery gate (DG0-DG7) or cites a decision or ADR id", async () => {
    const { columns, hits } = await seededHits(latest);
    expect(columns).toBeGreaterThan(1000); // every text column of every table, not a hand-picked list
    expect(fmt(hits)).toEqual([]);
  });

  it("the 0130 rewrites are versioned and audited, and the audit trail keeps the previous wording", async () => {
    const r = await latest.query<{ record_type: string; n: string; versioned: string }>(
      `SELECT record_type, count(*) AS n, count(*) FILTER (WHERE new_version = prior_version + 1) AS versioned
         FROM audit_event WHERE source = 'migration' AND action LIKE '%.reword' GROUP BY record_type ORDER BY 1`,
    );
    expect(r.rows.map((x) => [x.record_type, Number(x.n), Number(x.versioned)])).toEqual([
      ["automation_rule_version", 17, 17],
      ["form_source_field", 3, 0],
      ["job_schedule", 5, 5],
      ["procedure_definition", 12, 12],
      ["service_identity", 49, 49],
    ]);
    const kpi = await latest.query<{ d: string; v: number; from: string }>(
      `SELECT s.description_en AS d, s.version AS v, e.changes -> 'description_en' ->> 'from' AS from
         FROM job_schedule s JOIN audit_event e ON e.record_id = s.id AND e.action = 'job_schedule.reword'
        WHERE s.code = 'kpi.freshness_scan'`,
    );
    expect(kpi.rows).toEqual([
      {
        d: expect.stringContaining("(the KPI freshness rule, unchanged)"),
        v: 2,
        from: expect.stringContaining("(DG4 freshness rule, unchanged)"),
      },
    ]);
  });

  it("the excluded service_identity_change history is served by no API route (it holds no SQL name in the API)", () => {
    const named = literalsUnder(["apps/api/src"]).filter((t) => t.text.includes("service_identity_change"));
    expect(named).toEqual([]);
  });

  it("detects the F-DG6-990 texts on a database migrated WITHOUT 0130 (the scan is not vacuous)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mth-seedtext-pre0130-"));
    const db = await createScratchDatabase(adminUrl, "mth_seedtext_pre");
    const pool = new pg.Pool({ connectionString: roleUrl(adminUrl, db, "mth_owner"), max: 2 });
    try {
      // Every migration before the rewording one, found by name so a renumbering at merge needs no change here.
      const files = readdirSync(defaultMigrationsDir()).filter((f) => /^\d{4}_.*\.sql$/.test(f));
      const reword = files.find((f) => f.endsWith("_p6_seeded_text_business_terms.sql"));
      expect(reword).toBeDefined();
      for (const f of files) if (f < reword!) cpSync(join(defaultMigrationsDir(), f), join(dir, f));
      await migrate(roleUrl(adminUrl, db, "mth_owner"), { dir });
      const { hits } = await seededHits(pool);
      const count = (table: string, rule: SeededHit["rule"]) =>
        hits.filter((h) => h.where.startsWith(`${table}.`) && h.rule === rule).length;
      expect({
        job: count("job_schedule", "engineering_gate"),
        starterVersions: count("automation_rule_version", "engineering_gate"),
        procedures: count("procedure_definition", "engineering_gate"),
        identities: count("service_identity", "engineering_gate"),
        sourceFields: count("form_source_field", "engineering_gate"),
        jobRefs: count("job_schedule", "internal_reference"),
      }).toEqual({ job: 1, starterVersions: 16, procedures: 12, identities: 40, sourceFields: 3, jobRefs: 4 });
    } finally {
      await pool.end();
      await dropScratchDatabase(adminUrl, db);
      rmSync(dir, { recursive: true, force: true });
    }
  }, 240_000);
});
