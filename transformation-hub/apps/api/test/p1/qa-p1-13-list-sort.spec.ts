import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROUTES, declaredSortKeys, type RouteDef } from '@hub/contracts';
import { TASK_STATUSES } from '@hub/domain';
import { closeApp, closePools, DC, loginAs, owner, projectIdByCode, type Client } from '../helpers';

/**
 * QA-P1-13 [REQ-DAT-015] — `?sort=` is an allow-list per list route, applied in SQL inside the caller's scope with a
 * deterministic id tiebreaker (NULLs last). Unknown keys are 400 problem+json (`validation_failed`). The default order
 * (no `sort`) is unchanged.
 */

let pm: Client;
let pmB: Client;
let contributor: Client;
let portfolioAdmin: Client;
let platformAdmin: Client;
let dcId: string;
let taskId: string;

beforeAll(async () => {
  pm = await loginAs('pm');
  pmB = await loginAs('pm.b');
  contributor = await loginAs('contributor');
  portfolioAdmin = await loginAs('portfolio.admin');
  platformAdmin = await loginAs('platform.admin');
  dcId = await projectIdByCode(DC);
  taskId = (await owner().query<{ id: string }>('select id from task where project_id = $1 order by wbs_code limit 1', [dcId])).rows[0]!.id;

  // Own fixtures, so the ordering checks never depend on data left by other spec files: three projects managed by the PM
  // (mixed-case names — the ICU root collation sorts case-insensitively first, unlike C) and four documents, two with the same title (id tiebreaker).
  const run = Date.now().toString(36).toUpperCase();
  const templates = (await portfolioAdmin.get('/api/v1/templates').expect(200)).body.items as { id: string; templateKey: string }[];
  const gen = templates.find((t) => t.templateKey === 'general-transformation')!;
  for (const [i, name] of ['zz QA13 sort fixture', 'AA QA13 sort fixture', 'Mm QA13 sort fixture'].entries()) {
    await portfolioAdmin.post('/api/v1/projects', { templateVersionId: gen.id, code: `QA13-${run}-${i}`, name, projectManagerUserId: pm.userId, classification: 'internal' }).expect(201);
  }
  for (const title of ['QA13 Beta', 'QA13 alpha', 'QA13 Beta', 'QA13 Zulu']) {
    await pm.post(`/api/v1/projects/${dcId}/documents`, { title, kind: 'evidence', classification: 'internal' }).expect(201);
  }
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

type Row = { id: string } & Record<string, unknown>;
type Val = string | number | null;

/**
 * Asserts the SQL order: key ascending/descending with NULLs last in both directions; equal keys ordered by id in the
 * same direction (skipped for timestamps, whose JSON form loses the database's microsecond precision).
 */
/** Text keys are sorted with the ICU root collation in SQL (platform/sort.ts); compare the same way here. */
const icuRoot = new Intl.Collator('und');
const cmp = (a: string | number, b: string | number) => (typeof a === 'string' && typeof b === 'string' ? icuRoot.compare(a, b) : a < b ? -1 : a > b ? 1 : 0);

function expectSorted(items: Row[], value: (r: Row) => Val, desc: boolean, opts: { ties?: boolean } = {}) {
  const ties = opts.ties ?? true;
  for (let i = 1; i < items.length; i++) {
    const a = items[i - 1]!;
    const b = items[i]!;
    const va = value(a);
    const vb = value(b);
    const where = `rows ${i - 1}/${i}: ${JSON.stringify(va)} (${a.id}) then ${JSON.stringify(vb)} (${b.id})`;
    if (va === null) {
      expect(vb, `NULLs sort last — ${where}`).toBeNull();
    } else if (vb !== null && va !== vb) {
      expect(desc ? cmp(va, vb) > 0 : cmp(va, vb) < 0, `order — ${where}`).toBe(true);
      continue;
    } else if (vb === null) {
      continue;
    }
    if (ties) expect(desc ? a.id > b.id : a.id < b.id, `id tiebreaker — ${where}`).toBe(true);
  }
}

async function list(c: Client, path: string, sort?: string, extra = '') {
  const sep = path.includes('?') ? '&' : '?';
  const res = await c.get(`${path}${sep}pageSize=100${sort === undefined ? '' : `&sort=${encodeURIComponent(sort)}`}${extra}`);
  expect(res.status, `${path} sort=${sort}: ${JSON.stringify(res.body).slice(0, 300)}`).toBe(200);
  return res.body as { items: Row[]; total: number; page: number; pageSize: number };
}

function expectValidation400(res: { status: number; body: { code?: string; details?: { issues?: { path: string; message: string }[] } } }, what: string) {
  expect(res.status, `${what}: ${JSON.stringify(res.body)}`).toBe(400);
  expect(res.body.code).toBe('validation_failed');
  expect(JSON.stringify(res.body.details?.issues ?? []), what).toContain('sort');
}

const ids = (r: { items: Row[] }) => r.items.map((x) => x.id);

describe('QA-P1-13 [REQ-DAT-015] — allow-listed list sorting', () => {
  it('projects: code/name ascending and descending, same visible set and total as the default order; unknown keys are 400', async () => {
    const def = await list(pm, '/api/v1/projects');
    expect(def.total).toBeGreaterThanOrEqual(4);
    expect(def.total).toBeLessThanOrEqual(100);
    // Default order unchanged: Demo sandbox first, then code.
    const firstNonDemo = def.items.findIndex((p) => !p['isDemo']);
    if (firstNonDemo > 0) expect(def.items.slice(firstNonDemo).every((p) => !p['isDemo'])).toBe(true);

    const byCode = await list(pm, '/api/v1/projects', 'code');
    const byCodeDesc = await list(pm, '/api/v1/projects', '-code');
    expectSorted(byCode.items, (r) => r['code'] as string, false);
    expect(ids(byCodeDesc)).toEqual([...ids(byCode)].reverse());
    const byName = await list(pm, '/api/v1/projects', 'name');
    expectSorted(byName.items, (r) => r['name'] as string, false);
    expectSorted((await list(pm, '/api/v1/projects', '-name')).items, (r) => r['name'] as string, true);
    for (const r of [byCode, byCodeDesc, byName]) {
      expect(r.total).toBe(def.total);
      expect([...ids(r)].sort()).toEqual([...ids(def)].sort());
    }

    // Sorting happens inside the caller's scope: PM-B still sees only PM-B's projects.
    const b = await list(pmB, '/api/v1/projects', '-code');
    const bDef = await list(pmB, '/api/v1/projects');
    expect(b.total).toBe(bDef.total);
    expect([...ids(b)].sort()).toEqual([...ids(bDef)].sort());
    expect(ids(b)).not.toContain(dcId);

    for (const bad of ['nonexistent', 'name;drop table project', '(select 1)', '', '-', 'createdAt', '+code', 'code,name']) {
      expectValidation400(await pm.get(`/api/v1/projects?sort=${encodeURIComponent(bad)}`), `projects sort=${bad}`);
    }
    expectValidation400(await pm.get('/api/v1/projects?sort=code&sort=name'), 'repeated sort');
  });

  it('documents: title asc/desc and updatedAt, within the caller’s document ACL; fixed-order search rejects sort', async () => {
    const path = `/api/v1/projects/${dcId}/documents`;
    const def = await list(pm, path);
    expect(def.total).toBeGreaterThanOrEqual(7);
    expect(def.total).toBeLessThanOrEqual(100);
    const asc = await list(pm, path, 'title');
    // Equal titles are ordered by id (ascending here, descending for -title).
    const betas = asc.items.filter((d) => d['title'] === 'QA13 Beta').map((d) => d.id);
    expect(betas).toHaveLength(2);
    expect(betas[0]! < betas[1]!).toBe(true);
    const desc = await list(pm, path, '-title');
    expectSorted(asc.items, (r) => r['title'] as string, false);
    expect(ids(desc)).toEqual([...ids(asc)].reverse()); // title is NOT NULL: descending is the exact reverse
    expectSorted((await list(pm, path, '-updatedAt')).items, (r) => r['updatedAt'] as string, true, { ties: false });
    expectSorted((await list(pm, path, 'createdAt')).items, (r) => r['createdAt'] as string, false, { ties: false });
    for (const r of [asc, desc]) {
      expect(r.total).toBe(def.total);
      expect([...ids(r)].sort()).toEqual([...ids(def)].sort());
    }

    // A lower-clearance member sees the same (smaller or equal) set whatever the order.
    const cDef = await list(contributor, path);
    const cSorted = await list(contributor, path, '-title');
    expect(cSorted.total).toBe(cDef.total);
    expect([...ids(cSorted)].sort()).toEqual([...ids(cDef)].sort());
    expect(cDef.total).toBeLessThanOrEqual(def.total);
    expectSorted(cSorted.items, (r) => r['title'] as string, true);
    // Outside the caller's projects the list stays 404 (existence not leaked), sort or not.
    expect((await pmB.get(`${path}?sort=title`)).status).toBe(404);

    expectValidation400(await pm.get(`${path}?sort=size`), 'documents sort=size');
    expectValidation400(await pm.get(`${path}/search?q=demo&sort=title`), 'search has a relevance order');
  });

  it('tasks: title, status (lifecycle order), plannedFinish (NULLs last both ways), deterministic pages', async () => {
    const path = `/api/v1/projects/${dcId}/tasks`;
    const def = await list(pm, path);
    expect(def.total).toBeGreaterThan(50);
    // Default = WBS order, identical to sort=wbs.
    expect(ids(await list(pm, path, 'wbs'))).toEqual(ids(def));

    expectSorted((await list(pm, path, 'title')).items, (r) => r['title'] as string, false);
    expectSorted((await list(pm, path, '-title')).items, (r) => r['title'] as string, true);
    const rank = (r: Row) => TASK_STATUSES.indexOf(r['status'] as (typeof TASK_STATUSES)[number]);
    const byStatus = await list(pm, path, 'status');
    expect(byStatus.items.every((r) => rank(r) >= 0)).toBe(true);
    for (let i = 1; i < byStatus.items.length; i++) expect(rank(byStatus.items[i]!)).toBeGreaterThanOrEqual(rank(byStatus.items[i - 1]!));
    const pf = (r: Row) => (r['plannedFinish'] as string | null) ?? null;
    const pfAsc = await list(pm, path, 'plannedFinish');
    const pfDesc = await list(pm, path, '-plannedFinish');
    for (const [r, d] of [
      [pfAsc, false],
      [pfDesc, true],
    ] as const) {
      const firstNull = r.items.findIndex((x) => pf(x) === null);
      if (firstNull >= 0) expect(r.items.slice(firstNull).every((x) => pf(x) === null), 'NULLs last').toBe(true);
      const dated = r.items.filter((x) => pf(x) !== null).map((x) => pf(x)!);
      expect(dated).toEqual([...dated].sort((a, b) => (d ? b.localeCompare(a) : a.localeCompare(b))));
    }
    expectSorted((await list(pm, path, '-updatedAt')).items, (r) => r['updatedAt'] as string, true, { ties: false });

    // Many tasks share a status: the id tiebreaker makes pages stable (no row repeated or skipped across pages).
    const pages: string[] = [];
    for (let page = 1; page <= 4; page++) {
      const r = await pm.get(`${path}?sort=-status&pageSize=7&page=${page}`).expect(200);
      pages.push(...(r.body.items as Row[]).map((x) => x.id));
    }
    const whole = await pm.get(`${path}?sort=-status&pageSize=28`).expect(200);
    expect(pages).toEqual((whole.body.items as Row[]).map((x) => x.id));
    expect(new Set(pages).size).toBe(28);

    expectValidation400(await pm.get(`${path}?sort=-wbsCode`), 'tasks sort=-wbsCode');
  });

  it('risks: score and dueDate asc/desc; score is rejected for other RAID kinds', async () => {
    const path = `/api/v1/projects/${dcId}/raid/risks`;
    const def = await list(pm, path);
    expect(def.total).toBeGreaterThan(1);
    const score = (r: Row) => r['score'] as number;
    const hi = await list(pm, path, '-score');
    const lo = await list(pm, path, 'score');
    for (let i = 1; i < hi.items.length; i++) expect(score(hi.items[i]!)).toBeLessThanOrEqual(score(hi.items[i - 1]!));
    for (let i = 1; i < lo.items.length; i++) expect(score(lo.items[i]!)).toBeGreaterThanOrEqual(score(lo.items[i - 1]!));
    expectSorted((await list(pm, path, 'dueDate')).items, (r) => (r['dueDate'] as string | null) ?? null, false);
    expectSorted((await list(pm, path, '-dueDate')).items, (r) => (r['dueDate'] as string | null) ?? null, true);
    expectSorted((await list(pm, path, 'code')).items, (r) => r['code'] as string, false);
    expect(ids(await list(pm, path, '-code'))).toEqual([...ids(await list(pm, path, 'code'))].reverse());
    for (const r of [hi, lo]) expect(r.total).toBe(def.total);

    const issues = await pm.get(`/api/v1/projects/${dcId}/raid/issues?sort=-score`);
    expect(issues.status).toBe(400);
    expect(issues.body.code).toBe('raid.sort_score_risks_only');
    expectValidation400(await pm.get(`${path}?sort=-probability`), 'risks sort=-probability');
  });

  it('decisions: code/title asc/desc, -createdAt equals the default order, totals within the caller’s clearance', async () => {
    const path = `/api/v1/projects/${dcId}/decisions`;
    const def = await list(pm, path);
    expect(def.total).toBeGreaterThan(3);
    expect(ids(await list(pm, path, '-createdAt'))).toEqual(ids(def));
    const byCode = await list(pm, path, 'code');
    expectSorted(byCode.items, (r) => r['code'] as string, false);
    expect(ids(await list(pm, path, '-code'))).toEqual([...ids(byCode)].reverse());
    expectSorted((await list(pm, path, 'title')).items, (r) => r['title'] as string, false);
    expectSorted((await list(pm, path, '-title')).items, (r) => r['title'] as string, true);
    expectSorted((await list(pm, path, 'updatedAt')).items, (r) => r['updatedAt'] as string, false, { ties: false });
    expect(byCode.total).toBe(def.total);

    const cDef = await list(contributor, path);
    const cSorted = await list(contributor, path, '-code');
    expect(cSorted.total).toBe(cDef.total);
    expect([...ids(cSorted)].sort()).toEqual([...ids(cDef)].sort());
    expectValidation400(await pm.get(`${path}?sort=requester`), 'decisions sort=requester');
  });

  /** Every declared key of every list route, both directions, through the real services (SQL mapping sweep). */
  it('every list route: each declared key works in both directions without changing the total; any other value is 400', async () => {
    const listRoutes = Object.values(ROUTES).filter((r: RouteDef) => {
      if (r.method !== 'GET') return false;
      const q = (r.query as unknown as { shape?: Record<string, unknown> }).shape ?? {};
      const res = (r.response as unknown as { shape?: Record<string, unknown> }).shape ?? {};
      return 'page' in q || 'items' in res;
    });
    expect(listRoutes.length).toBeGreaterThan(40);
    const fillers: Record<string, string> = {
      'documents.searchDocuments': '&q=demo',
      'documents.listEvidence': `&targetType=task&targetId=${taskId}`,
      'planning.listRaci': `&entityType=task&entityId=${taskId}`,
    };
    const somePersonas = [pm, portfolioAdmin, platformAdmin];
    let checkedKeys = 0;
    for (const r of listRoutes) {
      const path = r.path
        .replace(':projectId', dcId)
        .replace(':kind', 'risks')
        .replace(/:[A-Za-z]+Id\b/g, '01900000-0000-7000-8000-000000000000');
      const extra = fillers[r.id] ?? '';
      // Pick the first persona the route-level access check lets through (a 403 precedes validation).
      let c: Client | null = null;
      let bad: Awaited<ReturnType<Client['get']>> | null = null;
      for (const p of somePersonas) {
        bad = await p.get(`${path}?sort=zzzNotAKey${extra}`);
        if (bad.status !== 403) {
          c = p;
          break;
        }
      }
      expect(c, `${r.id}: no persona passes the access check`).not.toBeNull();
      expectValidation400(bad!, `${r.id} ?sort=zzzNotAKey`);

      const keys = declaredSortKeys(r.query) ?? [];
      if (keys.length === 0) continue;
      const base = await list(c!, path, undefined, extra);
      for (const k of keys) {
        for (const s of [k, `-${k}`]) {
          const sorted = await list(c!, path, s, extra);
          expect(sorted.total, `${r.id} sort=${s} total`).toBe(base.total);
          if (base.total <= 100) expect([...ids(sorted)].sort(), `${r.id} sort=${s} rows`).toEqual([...ids(base)].sort());
          checkedKeys++;
        }
      }
    }
    expect(checkedKeys).toBeGreaterThan(200);
  });
});
