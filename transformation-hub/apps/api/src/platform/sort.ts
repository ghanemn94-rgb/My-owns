import { Column, is, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { parseSort, type SortKeyOf } from '@hub/contracts';
import { invalid } from '@hub/domain';

type SortExpr = AnyColumn | SQL;

/**
 * Text sort keys use the ICU root collation, so a list sorts identically on every PostgreSQL server whatever its default
 * locale (C in development, en_US in CI, something else at Mobily) and Arabic/Latin titles interleave sensibly. The
 * database self-check (DbService) refuses to start in production when this collation is missing.
 */
export const SORT_COLLATION = 'und-x-icu';

function collated(c: SortExpr): SortExpr {
  if (is(c, Column) && /^(text|varchar|character varying)/.test(c.getSQLType())) return sql`${c} collate "und-x-icu"`;
  return c;
}

/**
 * Column(s) behind each declared sort key of a list — must cover every key of the route's contract. A key may map to
 * several columns (e.g. WBS order = sort order, then WBS code); all of them take the requested direction.
 */
export type SortColumns<S extends string> = { [K in SortKeyOf<S>]: SortExpr | readonly SortExpr[] };

/**
 * ORDER BY for an allow-listed `?sort=` value (QA-P1-13, REQ-DAT-015): the key's column(s) in the requested direction
 * with NULLs last, then the row id in the same direction as a deterministic tiebreaker (ids are time-ordered UUID v7).
 * Returns `defaultOrder` when no sort was requested, so each list keeps its documented default order.
 *
 * Only the ORDER BY changes: the caller's WHERE clause (project scope, visibility, reach) and RLS are untouched, so
 * sorting never widens what a caller can see, and totals are unaffected.
 */
export function orderBySort<S extends string>(sort: S | undefined, columns: SortColumns<S>, id: AnyColumn, defaultOrder: SQL[]): SQL[] {
  const s = parseSort(sort);
  if (!s) return defaultOrder;
  const mapped = (columns as Record<string, SortExpr | readonly SortExpr[] | undefined>)[s.key];
  // The contract's enum already rejected unknown keys with 400; this guards a contract/service mismatch.
  if (!mapped) throw invalid('sort.unknown_key', `Unknown sort key ${s.key}`, { sort });
  const cols: readonly SortExpr[] = Array.isArray(mapped) ? mapped : [mapped as SortExpr];
  const dir = s.desc ? sql.raw('desc') : sql.raw('asc');
  return [...cols.map((c) => sql`${collated(c)} ${dir} nulls last`), sql`${id} ${dir}`];
}
