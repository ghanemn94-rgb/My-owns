// Opaque cursor pagination (ADR-0007 §4): base64url(JSON{ k: sort key values, h: filter hash }).
// The hash binds a cursor to the filters and sort it was issued for; reuse with other filters is a 400.
import { createHash } from "node:crypto";
import { sql } from "@mth/db";
import type { RawBuilder, SelectQueryBuilder } from "kysely";
import { PAGINATION } from "@mth/shared";
import { z } from "zod";
import { problems, type HttpProblem } from "./problem.ts";

export const limitSchema = z.coerce.number().int().min(1).max(PAGINATION.maxLimit).default(PAGINATION.defaultLimit);
export const cursorSchema = z.string().max(512).optional();

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      // Same order as Object.keys(...).sort() (UTF-16 code units); entries avoid a runtime-keyed read (F-DG1-124).
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonical(v)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonical(value));
}

/** Hash of the filters that define the result set (everything except cursor and limit). */
export function filterHash(filters: Record<string, unknown>): string {
  const { cursor: _c, limit: _l, ...rest } = filters;
  const defined = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
  return createHash("sha256").update(canonicalJson(defined)).digest("hex").slice(0, 16);
}

export function encodeCursor(keys: readonly (string | number | null)[], hash: string): string {
  return Buffer.from(JSON.stringify({ k: keys, h: hash }), "utf8").toString("base64url");
}

export function decodeCursor(
  cursor: string | undefined,
  hash: string,
  arity: number,
): (string | number | null)[] | null {
  if (cursor === undefined) return null;
  const invalid = () =>
    problems.badRequest("validation.cursor", "The cursor is invalid or belongs to other filters.", "/query/cursor");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw invalid();
  }
  const shape = z
    .object({ k: z.array(z.union([z.string(), z.number(), z.null()])).length(arity), h: z.string() })
    .safeParse(parsed);
  if (!shape.success || shape.data.h !== hash) throw invalid();
  return shape.data.k;
}

/** Given limit+1 fetched rows, returns the page and the next cursor. */
export function paginate<R>(
  rows: R[],
  limit: number,
  keyOf: (row: R) => (string | number | null)[],
  hash: string,
): { items: R[]; nextCursor: string | null } {
  if (rows.length <= limit) return { items: rows, nextCursor: null };
  const items = rows.slice(0, limit);
  return { items, nextCursor: encodeCursor(keyOf(items[items.length - 1]!), hash) };
}

// ------------------------------------------------------------------------------------------------ keyset pages (T-DG6-BE-V)
// ADR-0007 §4a (D-199): the 17 formerly unbounded lists page with `{ items, nextCursor }`. The page is read in SQL with
// a keyset over the list's stable sort, which always ends with the row's identifier. Every key is carried as Postgres
// text (`::text`) and cast back, so a timestamptz keeps its microseconds (a JS Date would truncate them and skip or
// repeat rows). The hash binds a cursor to the list's filters, its path parameters and its sort; a cursor from another
// list, another parent or with a value that is not of the key's type answers 400 `validation.cursor`.

/** The `cursor` and `limit` query fields of a paged list (merge into the list's strict query object). */
export const pageQueryFields = { cursor: cursorSchema, limit: limitSchema } as const;

/** One page request: an opaque cursor and the page size (1-100, default 25). */
export interface PageRequest {
  readonly cursor?: string | undefined;
  readonly limit: number;
}

/** The Postgres type a key is cast back to; each has a strict text shape checked before it reaches SQL. */
export type KeyType = "uuid" | "integer" | "text" | "timestamptz" | "date";

/** One sort key: a column reference (`"created_at"`, `"s.definition_code"`) or a raw expression, its type and order. */
export interface SortKey {
  /** Stable name of the key (bound into the cursor hash). */
  readonly name: string;
  readonly type: KeyType;
  readonly desc?: boolean;
  /** Raw SQL expression; defaults to a reference to `name`. */
  readonly expr?: RawBuilder<unknown>;
}

const KEY_SHAPES: ReadonlyMap<KeyType, RegExp> = new Map<KeyType, RegExp>(
  Object.entries({
    uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    integer: /^-?[0-9]{1,10}$/,
    text: /^[\s\S]{0,400}$/,
    // Postgres' text form of a timestamptz under TimeZone=UTC (ADR-0003; every pool connection): "2026-10-30 17:40:21.123456+00".
    timestamptz: /^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?\+00$/,
    date: /^([0-9]{4}-[0-9]{2}-[0-9]{2}|infinity)$/,
  }) as [KeyType, RegExp][],
);

/** "YYYY-MM-DD" (optionally followed by " hh:mm:ss…") names a real UTC calendar day and time of day. */
function realInstant(v: string): boolean {
  const day = v.slice(0, 10);
  const t = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== day) return false;
  if (v.length === 10) return true;
  const [h, m, s] = v.slice(11, 19).split(":").map(Number);
  return h! <= 23 && m! <= 59 && s! <= 59;
}

function cursorProblem(): HttpProblem {
  return problems.badRequest(
    "validation.cursor",
    "The cursor is invalid or belongs to other filters.",
    "/query/cursor",
  );
}

const exprOf = (k: SortKey): RawBuilder<unknown> => k.expr ?? sql`${sql.ref(k.name)}`;

/** Decodes a cursor for `keys` and checks every value against its key type (else 400 `validation.cursor`). */
export function decodeKeysetCursor(
  cursor: string | undefined,
  hash: string,
  keys: readonly SortKey[],
): string[] | null {
  const after = decodeCursor(cursor, hash, keys.length);
  if (after === null) return null;
  return after.map((v, i) => {
    const key = keys.at(i)!;
    if (typeof v !== "string" || KEY_SHAPES.get(key.type)?.test(v) !== true) throw cursorProblem();
    // A value of the right shape that is not a real calendar instant (2026-02-31, 24:00:00) is refused too.
    if ((key.type === "timestamptz" || key.type === "date") && v !== "infinity" && !realInstant(v))
      throw cursorProblem();
    return v;
  });
}

/** `(k0 > a0) OR (k0 = a0 AND k1 > a1) OR …`, each comparison in its key's own direction. */
function afterPredicate(keys: readonly SortKey[], after: readonly string[]): RawBuilder<boolean> {
  const value = (k: SortKey, v: string) => sql`cast(${v} as ${sql.raw(k.type)})`;
  const branches = keys.map((k, i) => {
    const eqs = keys.slice(0, i).map((p, j) => sql`${exprOf(p)} = ${value(p, after.at(j)!)}`);
    const cmp = sql`${exprOf(k)} ${sql.raw(k.desc === true ? "<" : ">")} ${value(k, after.at(i)!)}`;
    return sql.join([...eqs, cmp], sql` AND `);
  });
  return sql<boolean>`(${sql.join(
    branches.map((b) => sql`(${b})`),
    sql` OR `,
  )})`;
}

/** The hash of a keyset list: its filters (path parameters included) and its sort. */
export function keysetHash(filters: Record<string, unknown>, keys: readonly SortKey[]): string {
  return filterHash({ ...filters, sort: keys.map((k) => `${k.name}${k.desc === true ? " desc" : ""}`) });
}

/**
 * Reads one page of `query` (which has its filters but no ORDER BY or LIMIT) in the order of `keys`. Returns the rows
 * of the page (without the key columns it adds) and the next cursor, null on the last page.
 */
export async function keysetPage<O>(
  query: SelectQueryBuilder<any, any, O>, // eslint-disable-line @typescript-eslint/no-explicit-any -- any table set
  keys: readonly SortKey[],
  page: PageRequest,
  filters: Record<string, unknown>,
): Promise<{ items: O[]; nextCursor: string | null }> {
  const hash = keysetHash(filters, keys);
  const after = decodeKeysetCursor(page.cursor, hash, keys);
  // The page keys travel as one JSON array of their text forms (one added column, read by name).
  const keyColumn = sql<string[]>`json_build_array(${sql.join(keys.map((k) => sql`(${exprOf(k)})::text`))})`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the key column is added to any row shape
  let q: SelectQueryBuilder<any, any, any> = query.select(keyColumn.as("__page_keys"));
  if (after !== null) q = q.where(afterPredicate(keys, after));
  for (const k of keys) q = q.orderBy(exprOf(k), k.desc === true ? "desc" : "asc");
  let rows: Record<string, unknown>[];
  try {
    rows = (await q.limit(page.limit + 1).execute()) as Record<string, unknown>[];
  } catch (e) {
    // Backstop: a cursor value Postgres cannot cast (class 22, data exception) is the caller's 400, never a 500.
    const code = (e as { code?: unknown }).code;
    if (after !== null && typeof code === "string" && code.startsWith("22")) throw cursorProblem();
    throw e;
  }
  const keyOf = (r: Record<string, unknown>) => r["__page_keys"] as string[];
  const paged = paginate(rows, page.limit, keyOf, hash);
  const strip = (r: Record<string, unknown>): O =>
    Object.fromEntries(Object.entries(r).filter(([name]) => name !== "__page_keys")) as O;
  return { items: paged.items.map(strip), nextCursor: paged.nextCursor };
}

/**
 * One page of a list that is assembled in memory (a resolved configuration, not a table), in the order of `compare`
 * over each item's key tuple, which ends with the item's identifier. The cursor carries the last key of the page.
 */
export function memoryPage<T>(
  items: readonly T[],
  keyOf: (item: T) => string[],
  page: PageRequest,
  filters: Record<string, unknown>,
  sortName: string,
): { items: T[]; nextCursor: string | null } {
  const hash = filterHash({ ...filters, sort: [sortName] });
  const head = items.at(0);
  const arity = head === undefined ? 1 : keyOf(head).length;
  const after = decodeCursor(page.cursor, hash, arity);
  if (after !== null && after.some((v) => typeof v !== "string")) throw cursorProblem();
  const cmp = (a: readonly string[], b: readonly (string | number | null)[]) => {
    for (const [i, x] of a.entries()) {
      const y = String(b.at(i));
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  };
  const sorted = [...items].sort((a, b) => cmp(keyOf(a), keyOf(b)));
  const rest = after === null ? sorted : sorted.filter((it) => cmp(keyOf(it), after) > 0);
  return paginate(rest, page.limit, keyOf, hash);
}
