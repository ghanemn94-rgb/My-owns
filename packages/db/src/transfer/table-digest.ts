// The table digest and the row encoder of the recheck (ADR-0064 Amendment 2 §A2.2, §A2.3; p7-work-split §C.13;
// T-DG7-BE-R2). `encodedRows` is `encodeTable`'s encoder (export.ts: the same column kinds, column expressions, line
// format and primary-key text order under the pinned §2.3 settings) returning each row's line, its primary-key tuple
// and its column texts, so the load's E5 comparison, the reconstructed carried trail (reconcile.ts), the row-by-row
// recheck (recheck.ts) and `mth-db table-digest` all encode exactly as the export did. `tableDigest` gives
// `{name, rows, digest, lines?}` where `digest` equals what the manifest's `contentDigest` would be for that table.
//
// `mth-db table-digest --table T [--table T …] [--rows]` runs as mth_app (DATABASE_URL), read-only, on exported tables
// only, and prints ONE canonical JSON line `mth-table-digest/1` (the drill's D9 compares it). It writes nothing.
// Nothing here approves anything (no G1-G6, Finance or IT approval) and nothing reads or writes DG0-DG7.
import { createHash } from "node:crypto";
import { sql } from "kysely";
import type { Db, DbOrTx, Tx } from "../pool.ts";
import { columnExpression, columnKinds, encodeLine, type ColumnKind } from "./export.ts";
import { buildPlan, type TransferPlan, type TransferPlanTable } from "./plan.ts";
import { pinEncoderSettings } from "./reconcile.ts";

const ident = (name: string): string => `"${name.replace(/"/g, '""')}"`;

export interface EncodedRow {
  /** The JSON text of the primary-key tuple (each key column's encoded text output, in key order). */
  readonly key: string;
  /** The column texts in attribute order (null for SQL NULL); json kinds are their JSON text. */
  readonly values: readonly (string | null)[];
  /** The encoded line without its "\n". */
  readonly line: string;
}

export interface EncodedRows {
  readonly kinds: readonly { readonly name: string; readonly kind: ColumnKind }[];
  readonly rows: readonly EncodedRow[];
}

/** The rows of `table` matching `where` (all when absent), encoded as encodeTable does, in primary-key text order. */
export async function encodedRows(
  db: DbOrTx,
  table: TransferPlanTable,
  rewritten: TransferPlan["rewrittenColumns"],
  opts: { readonly where?: string } = {},
): Promise<EncodedRows> {
  const kinds = columnKinds(table, rewritten);
  const select = kinds.map((k, i) => `${columnExpression(k.name, k.kind)} AS c${i}`).join(", ");
  const keyAt = table.primaryKey.map((c) => kinds.findIndex((k) => k.name === c));
  const order = table.primaryKey.map((c) => `${ident(c)}::text COLLATE "C"`).join(", ");
  const r = await sql<Record<string, string | null>>`${sql.raw(
    `SELECT ${select} FROM ${ident(table.name)}${opts.where !== undefined ? ` WHERE ${opts.where}` : ""} ` +
      `ORDER BY ${order}`,
  )}`.execute(db);
  return {
    kinds,
    rows: r.rows.map((row) => {
      const values = kinds.map((_, i) => row[`c${i}`] ?? null);
      return {
        // The key columns' encoded text (boolout's "t"/"f" for a boolean key, as in the package line).
        key: JSON.stringify(keyAt.map((i) => values[i] ?? null)),
        values,
        line: encodeLine(kinds, values),
      };
    }),
  };
}

/** SHA-256 over the lines, each ending "\n" (the manifest's `contentDigest` rule). */
export function digestOfLines(lines: readonly string[]): string {
  const hash = createHash("sha256");
  for (const l of lines) hash.update(`${l}\n`, "utf8");
  return hash.digest("hex");
}

export interface TableDigest {
  readonly name: string;
  /** Decimal string. */
  readonly rows: string;
  readonly digest: string;
  readonly lines?: readonly { readonly key: string; readonly sha256: string }[];
}

export const TABLE_DIGEST_SCHEMA_VERSION = "mth-table-digest/1";

/** A table that is not in the export plan. */
export class TableDigestRefused extends Error {
  constructor(table: string) {
    super(`table-digest: refused: ${table} is not an exported table`);
    this.name = "TableDigestRefused";
  }
}

/** The digest of one exported table, in the caller's transaction (whose encoder settings must be pinned). */
export async function tableDigest(
  tx: DbOrTx,
  table: string,
  opts: { readonly rows?: boolean; readonly plan?: TransferPlan } = {},
): Promise<TableDigest> {
  const plan = opts.plan ?? (await buildPlan(tx));
  const t = plan.tables.find((x) => x.name === table);
  if (t === undefined) throw new TableDigestRefused(table);
  const enc = await encodedRows(tx, t, plan.rewrittenColumns);
  const out = {
    name: t.name,
    rows: String(enc.rows.length),
    digest: digestOfLines(enc.rows.map((r) => r.line)),
  };
  if (opts.rows !== true) return out;
  return {
    ...out,
    lines: enc.rows.map((r) => ({
      key: r.key,
      sha256: createHash("sha256").update(`${r.line}\n`, "utf8").digest("hex"),
    })),
  };
}

export interface TableDigestCliIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

/** `mth-db table-digest --table T [--table T …] [--rows]`; returns the exit code (0, or 2 refused / usage). */
export async function runTableDigestCommand(
  db: Db,
  opts: { readonly tables: readonly string[]; readonly rows: boolean },
  io: TableDigestCliIo,
): Promise<number> {
  if (opts.tables.length === 0 || opts.tables.some((t) => !/^[a-z][a-z0-9_]{0,62}$/.test(t))) {
    io.err("BLOCKED: usage: mth-db table-digest --table <name> [--table <name> …] [--rows]");
    return 2;
  }
  try {
    const result = await db
      .transaction()
      .setIsolationLevel("repeatable read")
      .setAccessMode("read only")
      .execute(async (tx: Tx) => {
        await pinEncoderSettings(tx);
        const plan = await buildPlan(tx);
        const tables: TableDigest[] = [];
        for (const t of opts.tables) tables.push(await tableDigest(tx, t, { rows: opts.rows, plan }));
        return tables;
      });
    // Canonical: fixed key order, no insignificant whitespace, one line.
    io.out(JSON.stringify({ schemaVersion: TABLE_DIGEST_SCHEMA_VERSION, tables: result }));
    return 0;
  } catch (err) {
    if (err instanceof TableDigestRefused) {
      io.err(err.message);
      return 2;
    }
    throw err;
  }
}
