// The catalogue-driven migration plan (ADR-0064 §2.2; p7-plan R2; T-DG7-BE-C). Built at run time from the catalogue,
// never from a hand list:
//   1. the tables are every base table of schema `public` minus `transfer_table_rule` (ADR-0064 §3);
//   2. the edges are the foreign keys between two exported tables (a self-reference is not an edge);
//   3. inside a strongly connected component of more than one table, the planner defers nullable foreign-key columns
//      until the component is acyclic: first the `created_by`/`updated_by` edges, then every other nullable edge. A
//      composite MATCH SIMPLE key (`(transformation_id, x_id)` with only x_id nullable) is broken by nulling its nullable
//      columns only: PostgreSQL does not check a MATCH SIMPLE key with a null column. The deferred columns are loaded as
//      null and set in a second pass (ADR-0064 §6 step 6). Last, a DEFERRABLE key whose columns are all NOT NULL (today
//      connector.(id, config_version_no) -> connector_config_version) is not an ordering edge: the load must run with
//      `SET CONSTRAINTS ALL DEFERRED` (listed per table as `deferrableForeignKeys`);
//   4. a cycle that no nullable column breaks fails the plan with the C.5 line
//      `migration plan: foreign-key cycle without a nullable edge: <tables>`;
//   5. `loadPhase` is the 1-based position in a topological order (referenced table first), ties by table name in
//      code point order.
// Self-references load in one statement per table; the rows are ordered by self-reference depth (selfReferenceOrder).
// Nothing here writes; it reads only the catalogue and the two rule tables. It approves nothing (no G1-G6 decision)
// and never reads or writes DG0-DG7.
import { sql } from "kysely";
import type { DbOrTx } from "../pool.ts";

export type TransferTableRuleKind =
  | "exclude_credential"
  | "exclude_operational"
  | "exclude_derived"
  | "exclude_transfer"
  | "compare_only";
export type TransferColumnRuleKind = "secret_ref_unbind" | "secret_refs_unbind";

/** A table's column as the encoder needs it (attribute order). */
export interface TransferColumn {
  readonly name: string;
  /** `pg_type.typname` of the column's base type (`bool`, `jsonb`, `_text`, …). */
  readonly type: string;
  readonly nullable: boolean;
}

/** A foreign key between two exported tables, or a self-reference. */
export interface TransferForeignKey {
  readonly name: string;
  readonly table: string;
  readonly columns: readonly string[];
  readonly referencedTable: string;
  readonly referencedColumns: readonly string[];
  /** The edge can be broken by nulling `nullableColumns` (MATCH SIMPLE: one null column suffices; FULL: all). */
  readonly nullable: boolean;
  /** The referencing columns that may be null (the ones a deferral sets to null). */
  readonly nullableColumns: readonly string[];
  /** DEFERRABLE (checked at commit when the load defers constraints). */
  readonly deferrable: boolean;
}

export interface TransferPlanTable {
  readonly name: string;
  readonly loadPhase: number;
  readonly columns: readonly TransferColumn[];
  readonly primaryKey: readonly string[];
  /** Nullable foreign-key columns loaded as null and set in the second pass (code point order). */
  readonly deferredColumns: readonly string[];
  /** Foreign keys of the table onto itself (the rows load by self-reference depth). */
  readonly selfReferences: readonly TransferForeignKey[];
  /** DEFERRABLE keys of this table removed from the order to break a cycle (the load defers constraints). */
  readonly deferrableForeignKeys: readonly string[];
}

export interface TransferExcludedTable {
  readonly name: string;
  readonly rule: TransferTableRuleKind;
  readonly reason: string;
}

export interface TransferRewrittenColumn {
  readonly table: string;
  readonly column: string;
  readonly rule: TransferColumnRuleKind;
}

/** A column that names an EvidenceStore object (ADR-0064 §5: every column named `storage_key`). */
export interface TransferObjectColumn {
  readonly table: string;
  readonly column: string;
}

export interface TransferPlan {
  /** Exported tables in load order. */
  readonly tables: readonly TransferPlanTable[];
  readonly excludedTables: readonly TransferExcludedTable[];
  readonly rewrittenColumns: readonly TransferRewrittenColumn[];
  readonly objectColumns: readonly TransferObjectColumn[];
}

/** The C.5 failure of a plan (exit 1 of the CLI). */
export class TransferPlanError extends Error {
  readonly tables: readonly string[];
  constructor(tables: readonly string[]) {
    super(`migration plan: foreign-key cycle without a nullable edge: ${tables.join(", ")}`);
    this.name = "TransferPlanError";
    this.tables = tables;
  }
}

export const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Columns preferred for deferral (ADR-0064 §2.2 step 3). */
const AUDIT_STAMP_COLUMNS = new Set(["created_by", "updated_by"]);

/** Tarjan's strongly connected components over `nodes` with `edges` (from -> to). Deterministic in input order. */
export function stronglyConnected(
  nodes: readonly string[],
  edges: readonly { readonly from: string; readonly to: string }[],
): string[][] {
  const out = new Map<string, string[]>();
  for (const n of nodes) out.set(n, []);
  for (const e of edges) out.get(e.from)?.push(e.to);
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result: string[][] = [];
  // Iterative to stay clear of the call-stack limit on a long chain.
  for (const root of nodes) {
    if (idx.has(root)) continue;
    const work: { node: string; next: number }[] = [{ node: root, next: 0 }];
    idx.set(root, index);
    low.set(root, index);
    index += 1;
    stack.push(root);
    onStack.add(root);
    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      const succ = out.get(frame.node)!;
      if (frame.next < succ.length) {
        const w = succ[frame.next]!;
        frame.next += 1;
        if (!idx.has(w)) {
          idx.set(w, index);
          low.set(w, index);
          index += 1;
          stack.push(w);
          onStack.add(w);
          work.push({ node: w, next: 0 });
        } else if (onStack.has(w)) {
          low.set(frame.node, Math.min(low.get(frame.node)!, idx.get(w)!));
        }
        continue;
      }
      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1]!.node;
        low.set(parent, Math.min(low.get(parent)!, low.get(frame.node)!));
      }
      if (low.get(frame.node) === idx.get(frame.node)) {
        const component: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          component.push(w);
        } while (w !== frame.node);
        result.push(component.sort(byCodePoint));
      }
    }
  }
  return result;
}

export interface OrderedTables {
  /** Table names in load order. */
  readonly order: readonly string[];
  /** Deferred columns per table (only tables with at least one). */
  readonly deferred: ReadonlyMap<string, readonly string[]>;
  /** DEFERRABLE keys removed from the order, by table (constraint names). */
  readonly deferrable: ReadonlyMap<string, readonly string[]>;
}

/**
 * The pure part of the plan (ADR-0064 §2.2 steps 2-5): breaks every multi-table cycle with nullable edges and orders
 * the tables topologically (a referenced table first; ties by name). Throws TransferPlanError on a cycle that no
 * nullable edge breaks. `foreignKeys` may include self-references and edges to tables outside `tables`; both are
 * ignored here.
 */
export function orderTables(tables: readonly string[], foreignKeys: readonly TransferForeignKey[]): OrderedTables {
  const names = [...tables].sort(byCodePoint);
  const known = new Set(names);
  // An edge child -> parent means "parent loads first"; for the SCC search the direction does not matter.
  let edges = foreignKeys.filter(
    (fk) => fk.table !== fk.referencedTable && known.has(fk.table) && known.has(fk.referencedTable),
  );
  const deferred = new Map<string, Set<string>>();
  const deferrable = new Map<string, Set<string>>();
  const defer = (fk: TransferForeignKey, byConstraint: boolean): void => {
    if (byConstraint) {
      const set = deferrable.get(fk.table) ?? new Set<string>();
      set.add(fk.name);
      deferrable.set(fk.table, set);
      return;
    }
    const set = deferred.get(fk.table) ?? new Set<string>();
    for (const c of fk.nullableColumns) set.add(c);
    deferred.set(fk.table, set);
  };
  const componentOf = (list: readonly TransferForeignKey[]): Map<string, number> => {
    const comps = stronglyConnected(
      names,
      list.map((fk) => ({ from: fk.table, to: fk.referencedTable })),
    );
    const at = new Map<string, number>();
    comps.forEach((c, i) => {
      if (c.length > 1) for (const t of c) at.set(t, i);
    });
    return at;
  };
  const passes: { eligible: (fk: TransferForeignKey) => boolean; byConstraint: boolean }[] = [
    {
      eligible: (fk) => fk.nullable && fk.nullableColumns.every((c) => AUDIT_STAMP_COLUMNS.has(c)),
      byConstraint: false,
    },
    { eligible: (fk) => fk.nullable, byConstraint: false },
    { eligible: (fk) => fk.deferrable, byConstraint: true },
  ];
  for (const pass of passes) {
    const at = componentOf(edges);
    if (at.size === 0) break;
    const keep: TransferForeignKey[] = [];
    for (const fk of edges) {
      const c = at.get(fk.table);
      if (c !== undefined && c === at.get(fk.referencedTable) && pass.eligible(fk)) defer(fk, pass.byConstraint);
      else keep.push(fk);
    }
    edges = keep;
  }
  const left = componentOf(edges);
  if (left.size > 0) throw new TransferPlanError([...left.keys()].sort(byCodePoint));

  // Kahn's algorithm, ready set ordered by name.
  const parents = new Map<string, Set<string>>();
  const children = new Map<string, Set<string>>();
  for (const n of names) {
    parents.set(n, new Set());
    children.set(n, new Set());
  }
  for (const fk of edges) {
    parents.get(fk.table)!.add(fk.referencedTable);
    children.get(fk.referencedTable)!.add(fk.table);
  }
  const ready = names.filter((n) => parents.get(n)!.size === 0);
  const order: string[] = [];
  while (ready.length > 0) {
    ready.sort(byCodePoint);
    const n = ready.shift()!;
    order.push(n);
    for (const child of children.get(n)!) {
      const p = parents.get(child)!;
      p.delete(n);
      if (p.size === 0) ready.push(child);
    }
  }
  const frozen = new Map<string, readonly string[]>();
  for (const [t, cols] of deferred) frozen.set(t, [...cols].sort(byCodePoint));
  const frozenDeferrable = new Map<string, readonly string[]>();
  for (const [t, names] of deferrable) frozenDeferrable.set(t, [...names].sort(byCodePoint));
  return { order, deferred: frozen, deferrable: frozenDeferrable };
}

/**
 * The load order of a self-referencing table's rows (ADR-0064 §2.2): depth first (a row whose self-reference is null,
 * or points outside the given rows, has depth 0), then the given order. A cycle of rows (only possible with a
 * deferrable constraint) keeps its members at the depth where the cycle was found.
 */
export function selfReferenceOrder<R>(
  rows: readonly R[],
  keyOf: (row: R) => string,
  parentsOf: (row: R) => readonly (string | null)[],
): R[] {
  const byKey = new Map<string, R>();
  for (const r of rows) byKey.set(keyOf(r), r);
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (key: string): number => {
    const known = depth.get(key);
    if (known !== undefined) return known;
    if (visiting.has(key)) return 0;
    visiting.add(key);
    let d = 0;
    for (const p of parentsOf(byKey.get(key)!)) {
      if (p === null || p === key || !byKey.has(p)) continue;
      d = Math.max(d, depthOf(p) + 1);
    }
    visiting.delete(key);
    depth.set(key, d);
    return d;
  };
  const positioned = rows.map((r, i) => ({ r, i, d: depthOf(keyOf(r)) }));
  positioned.sort((a, b) => a.d - b.d || a.i - b.i);
  return positioned.map((p) => p.r);
}

// ------------------------------------------------------------------------------------------------ catalogue reads

interface FkRow {
  readonly name: string;
  readonly table: string;
  readonly referenced: string;
  readonly columns: string[];
  readonly referenced_columns: string[];
  readonly nullable_columns: string[];
  readonly match_full: boolean;
  readonly deferrable: boolean;
}

/** Every public base table, by name (information_schema: the ADR-0050 checksum's rule). */
export async function publicBaseTables(db: DbOrTx): Promise<string[]> {
  const r = await sql<{ table_name: string }>`
    SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name COLLATE "C"`.execute(db);
  return r.rows.map((x) => x.table_name);
}

/** Builds the plan from the catalogue of `db` (ADR-0064 §2.2). Read-only. */
export async function buildPlan(db: DbOrTx): Promise<TransferPlan> {
  const all = await publicBaseTables(db);
  const excluded = (
    await sql<{ table_name: string; rule: TransferTableRuleKind; reason: string }>`
      SELECT table_name, rule, reason FROM transfer_table_rule ORDER BY table_name COLLATE "C"`.execute(db)
  ).rows.map((r) => ({ name: r.table_name, rule: r.rule, reason: r.reason }));
  const excludedNames = new Set(excluded.map((e) => e.name));
  const exported = all.filter((t) => !excludedNames.has(t));
  const exportedSet = new Set(exported);
  const rewritten = (
    await sql<{ table_name: string; column_name: string; rule: TransferColumnRuleKind }>`
      SELECT table_name, column_name, rule FROM transfer_column_rule
       ORDER BY table_name COLLATE "C", column_name COLLATE "C"`.execute(db)
  ).rows.map((r) => ({ table: r.table_name, column: r.column_name, rule: r.rule }));

  const cols = await sql<{ table_name: string; column_name: string; type: string; nullable: boolean }>`
    SELECT c.relname AS table_name, a.attname AS column_name,
           (SELECT bt.typname FROM pg_type bt
             WHERE bt.oid = CASE WHEN t.typtype = 'd' THEN t.typbasetype ELSE t.oid END) AS type,
           NOT a.attnotnull AS nullable
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      JOIN pg_type t ON t.oid = a.atttypid
     WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relkind IN ('r', 'p')
     ORDER BY c.relname, a.attnum`.execute(db);
  const columnsOf = new Map<string, TransferColumn[]>();
  for (const r of cols.rows) {
    if (!exportedSet.has(r.table_name)) continue;
    const list = columnsOf.get(r.table_name) ?? [];
    list.push({ name: r.column_name, type: r.type, nullable: r.nullable });
    columnsOf.set(r.table_name, list);
  }

  const pks = await sql<{ table_name: string; columns: string[] }>`
    SELECT c.relname AS table_name,
           array_agg(a.attname::text ORDER BY k.ord) AS columns
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
     WHERE con.contype = 'p'
     GROUP BY c.relname`.execute(db);
  const pkOf = new Map(pks.rows.map((r) => [r.table_name, r.columns]));

  const fkRows = await sql<FkRow>`
    SELECT con.conname AS name, c.relname AS table, rc.relname AS referenced,
           array_agg(a.attname::text ORDER BY k.ord) AS columns,
           array_agg(ra.attname::text ORDER BY k.ord) AS referenced_columns,
           coalesce(array_agg(a.attname::text ORDER BY k.ord) FILTER (WHERE NOT a.attnotnull), '{}') AS nullable_columns,
           con.confmatchtype = 'f' AS match_full, con.condeferrable AS deferrable
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      JOIN pg_class rc ON rc.oid = con.confrelid
      JOIN pg_namespace rn ON rn.oid = rc.relnamespace AND rn.nspname = 'public'
      CROSS JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY AS k(attnum, fattnum, ord)
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
      JOIN pg_attribute ra ON ra.attrelid = rc.oid AND ra.attnum = k.fattnum
     WHERE con.contype = 'f'
     GROUP BY con.oid, con.conname, c.relname, rc.relname, con.confmatchtype, con.condeferrable
     ORDER BY c.relname, con.conname`.execute(db);
  const foreignKeys: TransferForeignKey[] = fkRows.rows
    .filter((r) => exportedSet.has(r.table) && exportedSet.has(r.referenced))
    .map((r) => ({
      name: r.name,
      table: r.table,
      columns: r.columns,
      referencedTable: r.referenced,
      referencedColumns: r.referenced_columns,
      nullable: r.match_full ? r.nullable_columns.length === r.columns.length : r.nullable_columns.length > 0,
      nullableColumns: r.nullable_columns,
      deferrable: r.deferrable,
    }));

  const { order, deferred, deferrable } = orderTables(exported, foreignKeys);
  const tables: TransferPlanTable[] = order.map((name, i) => {
    const primaryKey = pkOf.get(name);
    if (primaryKey === undefined || primaryKey.length === 0)
      throw new Error(`migration plan: table ${name} has no primary key`);
    return {
      name,
      loadPhase: i + 1,
      columns: columnsOf.get(name) ?? [],
      primaryKey,
      deferredColumns: deferred.get(name) ?? [],
      selfReferences: foreignKeys.filter((fk) => fk.table === name && fk.referencedTable === name),
      deferrableForeignKeys: deferrable.get(name) ?? [],
    };
  });
  const objectColumns: TransferObjectColumn[] = tables
    .flatMap((t) =>
      t.columns.filter((c) => c.name === "storage_key").map(() => ({ table: t.name, column: "storage_key" })),
    )
    .sort((a, b) => byCodePoint(a.table, b.table));
  return { tables, excludedTables: excluded, rewrittenColumns: rewritten, objectColumns };
}
