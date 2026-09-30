import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { ROUTES, type RouteDef } from './index';
import { NoSort, SortParam, declaredSortKeys, parseSort } from './common';

/**
 * QA-P1-13 / REQ-DAT-015 — list sorting is allow-listed per route. A "list route" is any GET route that pages
 * (`page` query parameter) or returns an `items` array. Each one must either declare its sortable keys (ascending `key`,
 * descending `-key`, everything else rejected) or reject `sort` altogether — never accept and ignore it.
 */

type Shape = Record<string, z.ZodType>;
const shapeOf = (s: z.ZodTypeAny): Shape | undefined => (s as unknown as { shape?: Shape }).shape;

function isListRoute(r: RouteDef): boolean {
  if (r.method !== 'GET') return false;
  const q = shapeOf(r.query) ?? {};
  const res = shapeOf(r.response) ?? {};
  return 'page' in q || 'items' in res;
}
const isPaged = (r: RouteDef) => {
  const res = shapeOf(r.response) ?? {};
  return 'items' in res && 'page' in res && 'pageSize' in res && 'total' in res;
};

/** Issues of `query.safeParse` that concern the `sort` parameter (bad value, or unknown key on a strict query). */
function sortIssues(r: RouteDef, sort: unknown) {
  const res = r.query.safeParse({ sort });
  if (res.success) return [];
  return res.error.issues.filter(
    (i) => i.path[0] === 'sort' || (i.code === 'unrecognized_keys' && (i as unknown as { keys: string[] }).keys.includes('sort')),
  );
}

const listRoutes = Object.values(ROUTES).filter(isListRoute);

describe('QA-P1-13 [REQ-DAT-015] — every list route declares its sort keys or rejects sort', () => {
  it('finds the list routes in the registry', () => {
    // Guard against the filter silently matching nothing.
    expect(listRoutes.filter(isPaged).length).toBeGreaterThanOrEqual(28);
    expect(listRoutes.length).toBeGreaterThan(listRoutes.filter(isPaged).length);
  });

  it('every paged list declares its sort keys (possibly none) in its contract', () => {
    const undeclared = listRoutes.filter(isPaged).filter((r) => declaredSortKeys(r.query) === undefined).map((r) => r.id);
    expect(undeclared).toEqual([]);
  });

  it.each(listRoutes.map((r) => [r.id, r] as const))('%s: declared keys (asc/desc) are accepted, anything else is rejected', (_id, r) => {
    const keys = declaredSortKeys(r.query);
    if (keys === undefined) {
      // No `sort` parameter at all: the query must be strict so `?sort=` is a 400, not silently ignored.
      expect(sortIssues(r, 'code').length, `${r.id} accepts and ignores ?sort=`).toBeGreaterThan(0);
      return;
    }
    for (const k of keys) {
      expect(sortIssues(r, k), `${r.id} rejects declared key ${k}`).toEqual([]);
      expect(sortIssues(r, `-${k}`), `${r.id} rejects declared key -${k}`).toEqual([]);
      expect(sortIssues(r, `${k}X`).length).toBeGreaterThan(0);
      expect(sortIssues(r, `+${k}`).length).toBeGreaterThan(0);
      expect(sortIssues(r, `--${k}`).length).toBeGreaterThan(0);
    }
    for (const bad of ['', ' ', '-', 'id; drop table project', '(select 1)', 'nonexistent', ['code', 'title']]) {
      expect(sortIssues(r, bad).length, `${r.id} accepts sort=${JSON.stringify(bad)}`).toBeGreaterThan(0);
    }
    if (keys.length === 0) expect(sortIssues(r, 'code').length).toBeGreaterThan(0);
  });

  it('the lists covered by the integration tests declare the documented keys', () => {
    const k = (id: string) => declaredSortKeys(ROUTES[id]!.query);
    expect(k('portfolio.listProjects')).toEqual(['code', 'name', 'status']);
    expect(k('documents.listDocuments')).toEqual(expect.arrayContaining(['title', 'updatedAt']));
    expect(k('planning.listTasks')).toEqual(expect.arrayContaining(['wbs', 'title', 'plannedFinish', 'updatedAt']));
    expect(k('planning.listRaid')).toEqual(expect.arrayContaining(['code', 'title', 'dueDate', 'score', 'updatedAt']));
    expect(k('governance.listDecisions')).toEqual(expect.arrayContaining(['code', 'title', 'createdAt', 'updatedAt']));
    // Fixed-order lists (relevance ranking, audit sequence) declare no keys.
    expect(k('documents.searchDocuments')).toEqual([]);
    expect(k('portfolio.auditTrail')).toEqual([]);
  });
});

describe('sort helpers', () => {
  it('SortParam accepts key and -key only; parseSort splits key and direction', () => {
    const s = SortParam(['code', 'dueDate']);
    expect(s.safeParse('code').success).toBe(true);
    expect(s.safeParse('-dueDate').success).toBe(true);
    expect(s.safeParse(undefined).success).toBe(true);
    expect(s.safeParse('title').success).toBe(false);
    expect(parseSort('-dueDate')).toEqual({ key: 'dueDate', desc: true });
    expect(parseSort('code')).toEqual({ key: 'code', desc: false });
    expect(parseSort(undefined)).toBeUndefined();
  });

  it('an empty key list is NoSort (rejects every value); malformed or duplicate keys are a programming error', () => {
    expect(SortParam([])).toBe(NoSort);
    expect(NoSort.safeParse(undefined).success).toBe(true);
    expect(NoSort.safeParse('code').success).toBe(false);
    expect(() => SortParam(['code', 'code'])).toThrow();
    expect(() => SortParam(['-code'])).toThrow();
    expect(() => SortParam(['due date'])).toThrow();
  });
});
