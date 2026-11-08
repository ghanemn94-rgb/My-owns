// T-DG6-BE-Z12 (F-DG6-480; D-218, D-219; ADR-0051 §2; REQ-S10-002): the reference inventory is derived from the
// schema, not from the demo seed. Against the run's disposable PostgreSQL, migrated to HEAD, this test reads the catalog
// and fails when:
//   - a foreign-key column (single or composite) whose referenced column is the `id` of a sensitive table (benefit,
//     business case, evidence) or of a SENSITIVE_CHILD_SOURCES table is not in the inventory as kind "fk";
//   - a uuid column with no foreign key (a polymorphic `(record_type, record_id)` pair, a scope id, ...) is not in it
//     as kind "uuid"; a uuid[] column is not in it as "array"; a json/jsonb column is not in it as "json"; a text
//     column holding an in-app link (link_path, href) is not in it as "text" (T-DG6-BE-Z13, F-DG6-540);
//   - an inventory row names a column the catalog does not have (stale), or has another kind;
//   - an operationId it names is not in docs/api/openapi.yaml; a "redacted" row has no exercise, or its exercise file
//     does not exist or does not contain its fragment;
//   - the open rows, or the repaired rows no test seeds yet (PENDING), differ from the ones the T-DG6-BE-Z12 handback
//     lists under "What remains".
// Read only. SYNTHETIC. Nothing here is a business approval (G1-G6) or touches DG0-DG7.
import { sql } from "@mth/db";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appRole, type RoleHandles } from "../../../../../packages/db/test/helpers.ts";
import { SENSITIVE_CHILD_SOURCES } from "../../../src/modules/access/sensitive-reach.ts";
import { SENSITIVE_RECORD_TYPE_LIST } from "../../../src/modules/access/read-scope.ts";
import { operations } from "../../support/contract.ts";
import { SENSITIVE_REFERENCE_INVENTORY, type InventoryKind } from "../../support/sensitive-reference-inventory.ts";

const ROOT = resolve(import.meta.dirname, "../../../../..");
/**
 * The open rows and the repaired rows no test seeds yet (PENDING). T-DG6-BE-Z12B (D-222) closed the two open rows of
 * the T-DG6-BE-Z12 handback and seeded its six PENDING rows: both lists are pinned EMPTY, so a new reference column
 * must be repaired and exercised before this test passes.
 */
const KNOWN_OPEN: readonly string[] = [];
const KNOWN_PENDING: readonly string[] = [];

let h: RoleHandles;
beforeAll(() => {
  h = appRole();
});
afterAll(async () => {
  await h?.close();
});

/**
 * The names of text columns that hold an in-app link to a record (T-DG6-BE-Z13, F-DG6-540): a link path or an href.
 * Event and dedupe keys built from ids are outside this pattern (the T-DG6-BE-Z13 handback lists them for routing).
 */
const TEXT_REFERENCE_COLUMN = /(^|_)(link_path|href)$/;

/** The catalog's reference columns, by kind (`table.column`). */
async function catalog(): Promise<Map<string, InventoryKind>> {
  const targets = [...SENSITIVE_RECORD_TYPE_LIST, ...Object.values(SENSITIVE_CHILD_SOURCES).map((s) => s.table)];
  const out = new Map<string, InventoryKind>();
  const fk = await sql<{ t: string; col: string }>`
    SELECT DISTINCT c.conrelid::regclass::text AS t, a.attname AS col
      FROM pg_constraint c CROSS JOIN LATERAL unnest(c.conkey, c.confkey) AS k(src, dst), pg_attribute a, pg_attribute b
     WHERE c.contype = 'f' AND a.attrelid = c.conrelid AND a.attnum = k.src AND b.attrelid = c.confrelid
       AND b.attnum = k.dst AND b.attname = 'id' AND c.confrelid::regclass::text = ANY(${targets})
       AND c.connamespace = 'public'::regnamespace`.execute(h.db);
  for (const r of fk.rows) out.set(`${r.t}.${r.col}`, "fk");
  const cols = await sql<{ t: string; col: string; udt: string; has_fk: boolean }>`
    SELECT c.table_name AS t, c.column_name AS col, c.udt_name AS udt,
           EXISTS (SELECT 1 FROM pg_constraint k, pg_attribute a
                    WHERE k.contype = 'f' AND k.conrelid = (quote_ident(c.table_name))::regclass
                      AND a.attrelid = k.conrelid AND a.attnum = ANY(k.conkey) AND a.attname = c.column_name) AS has_fk
      FROM information_schema.columns c
      JOIN information_schema.tables x
        ON x.table_schema = 'public' AND x.table_name = c.table_name AND x.table_type = 'BASE TABLE'
     WHERE c.table_schema = 'public' AND c.udt_name IN ('uuid', '_uuid', 'json', 'jsonb')`.execute(h.db);
  for (const r of cols.rows) {
    const key = `${r.t}.${r.col}`;
    if (r.udt === "_uuid") out.set(key, "array");
    else if (r.udt === "json" || r.udt === "jsonb") out.set(key, "json");
    else if (r.col !== "id" && !r.has_fk && !out.has(key)) out.set(key, "uuid");
  }
  // T-DG6-BE-Z13 (F-DG6-540): text columns that hold an in-app link (a link path, an href) can name a hidden record
  // too; they are classified as kind "text".
  const text = await sql<{ t: string; col: string }>`
    SELECT c.table_name AS t, c.column_name AS col
      FROM information_schema.columns c
      JOIN information_schema.tables x
        ON x.table_schema = 'public' AND x.table_name = c.table_name AND x.table_type = 'BASE TABLE'
     WHERE c.table_schema = 'public' AND c.udt_name IN ('text', 'varchar', 'bpchar')
       AND c.column_name ~ ${TEXT_REFERENCE_COLUMN.source}`.execute(h.db);
  for (const r of text.rows) out.set(`${r.t}.${r.col}`, "text");
  return out;
}

describe("T-DG6-BE-Z12: the sensitive-reference inventory matches the schema (F-DG6-480 class)", () => {
  it("every reference column of the catalog is classified, with its kind, and no row is stale", async () => {
    const found = await catalog();
    const listed = new Map(SENSITIVE_REFERENCE_INVENTORY.map((r) => [r.column, r.kind]));
    expect(listed.size, "no column is listed twice").toBe(SENSITIVE_REFERENCE_INVENTORY.length);
    const missing = [...found].filter(([c]) => !listed.has(c)).map(([c, k]) => `${c} (${k})`);
    const stale = [...listed].filter(([c]) => !found.has(c)).map(([c]) => c);
    const wrongKind = [...listed]
      .filter(([c, k]) => found.has(c) && found.get(c) !== k)
      .map(([c, k]) => `${c}: listed ${k}, catalog ${found.get(c)}`);
    const counts = new Map<string, number>();
    for (const k of found.values()) counts.set(k, (counts.get(k) ?? 0) + 1);
    console.log(`[BE-Z12 inventory] catalog: ${[...counts].map(([k, n]) => `${k}=${n}`).join(" ")}`);
    expect(missing, "a reference column of the schema is not in the inventory").toEqual([]);
    expect(stale, "an inventory row names a column the schema does not have").toEqual([]);
    expect(wrongKind).toEqual([]);
    // Floors, so a broken catalog query cannot pass by finding nothing.
    expect(counts.get("fk") ?? 0).toBeGreaterThanOrEqual(50);
    expect(counts.get("uuid") ?? 0).toBeGreaterThanOrEqual(50);
    expect(counts.get("json") ?? 0).toBeGreaterThanOrEqual(80);
    expect(counts.get("text") ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("every operation, exercise and status is real", () => {
    const ops = new Set(operations.map((o) => o.operationId));
    const unknownOps = SENSITIVE_REFERENCE_INVENTORY.flatMap((r) =>
      r.operations.filter((o) => !ops.has(o)).map((o) => `${r.column}: ${o}`),
    );
    expect(unknownOps, "an operationId of the inventory is not in the contract").toEqual([]);
    const badExercise: string[] = [];
    const pending: string[] = [];
    for (const r of SENSITIVE_REFERENCE_INVENTORY) {
      if (r.status !== "redacted") continue;
      if (r.exercise === undefined) {
        badExercise.push(`${r.column}: redacted without an exercise`);
        continue;
      }
      if (r.exercise === "sweep") continue;
      if (r.exercise.startsWith("PENDING: ")) {
        pending.push(r.column);
        continue;
      }
      const [path, fragment = ""] = r.exercise.split("#");
      const file = resolve(ROOT, path!);
      if (!existsSync(file)) badExercise.push(`${r.column}: ${path} does not exist`);
      else if (fragment !== "" && !readFileSync(file, "utf8").includes(fragment))
        badExercise.push(`${r.column}: ${path} does not contain "${fragment}"`);
    }
    expect(badExercise).toEqual([]);
    for (const c of pending) console.log(`[BE-Z12 inventory] PENDING exercise ${c}`);
    expect(pending.sort()).toEqual([...KNOWN_PENDING].sort());
    const open = SENSITIVE_REFERENCE_INVENTORY.filter((r) => r.status === "open");
    for (const r of open) console.log(`[BE-Z12 inventory] OPEN ${r.column}: ${r.fix}`);
    expect(open.map((r) => r.column).sort()).toEqual([...KNOWN_OPEN].sort());
    const byStatus = new Map<string, number>();
    for (const r of SENSITIVE_REFERENCE_INVENTORY) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
    console.log(`[BE-Z12 inventory] ${[...byStatus].map(([s, n]) => `${s}=${n}`).join(" ")}`);
  });
});
