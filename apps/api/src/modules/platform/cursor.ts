// Opaque cursor pagination (ADR-0007 §4): base64url(JSON{ k: sort key values, h: filter hash }).
// The hash binds a cursor to the filters and sort it was issued for; reuse with other filters is a 400.
import { createHash } from "node:crypto";
import { PAGINATION } from "@mth/shared";
import { z } from "zod";
import { problems } from "./problem.ts";

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
