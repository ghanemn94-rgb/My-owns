import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PERSONAS, apiSessionAs, loginAs, watchConsole } from './helpers';

/**
 * Independent QA — P3 + P4 review (docs/reviews/P3-P4-qa-review.md §6): the loading / empty / error / restricted states of
 * the P3 and P4 screens, and the Demo badge.
 *  - restricted: a Project-B user opening DEMO-DC P3/P4 URLs (lists and records) and a DEMO-DC record id under another
 *    project's URL get the neutral restricted state (the API answers 404) and no title, code or name of the record;
 *  - error: a failing list request (503 problem) shows the error state with the correlation id and a working Retry;
 *  - loading: a slow list request shows the loading state first;
 *  - empty: a fresh (non-demo) DC project shows the empty state of each register;
 *  - Demo badge: demo records carry it on their detail pages; a record of the fresh non-demo project does not.
 * English UI; texts are read from the English catalogue. Requirement IDs: REQ-UX-022, REQ-UX-028, REQ-UX-010..REQ-UX-014,
 * REQ-SEC-006 (existence not leaked).
 */
const SHOTS = join(__dirname, '..', 'screenshots', 'qa-p34');
mkdirSync(SHOTS, { recursive: true });
const RUN = Date.now().toString(36).toUpperCase().slice(-5);
const EN = (() => {
  const dir = join(__dirname, '..', '..', 'apps', 'web', 'src', 'i18n', 'messages', 'en');
  const all: Record<string, unknown> = {};
  for (const f of readdirSync(dir)) all[f.replace(/\.json$/, '')] = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  return (key: string) => key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], all) as string;
})();

async function csrfOf(ctx: APIRequestContext) {
  return (await ctx.storageState()).cookies.find((c) => c.name === 'hub_csrf')?.value ?? '';
}
async function post(ctx: APIRequestContext, path: string, data: unknown) {
  const r = await ctx.post(path, { data, headers: { 'x-csrf-token': await csrfOf(ctx) } });
  expect(r.ok(), `POST ${path} → ${r.status()} ${await r.text()}`).toBeTruthy();
  return r.json();
}
async function get(ctx: APIRequestContext, path: string) {
  const r = await ctx.get(path);
  expect(r.ok(), `GET ${path} → ${r.status()}`).toBeTruthy();
  return r.json();
}
async function as(browser: Browser, baseURL: string, persona: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const problems = watchConsole(page);
  await loginAs(page, persona);
  await context.addCookies([{ name: 'hub_locale', value: 'en', url: baseURL }]);
  return { page, problems, close: () => context.close() };
}
async function settled(page: Page) {
  await expect(page.getByTestId('loading-state')).toHaveCount(0, { timeout: 30_000 });
}

test.describe('QA P3/P4 — loading, empty, error and restricted states; Demo badge [REQ-UX-022, REQ-UX-028, REQ-SEC-006]', () => {
  const ids: Record<string, string> = {};
  test.beforeAll(async ({ baseURL }) => {
    test.setTimeout(120_000);
    const pm = await apiSessionAs(baseURL!, PERSONAS.pm);
    const fin = await apiSessionAs(baseURL!, PERSONAS.finance);
    const admin = await apiSessionAs(baseURL!, PERSONAS.portfolioAdmin);
    try {
      const dc = ((await get(pm, '/api/v1/projects?pageSize=100')).items as { id: string; code: string }[]).find((p) => p.code === 'DEMO-DC')!.id;
      const p = `/api/v1/projects/${dc}`;
      ids.dc = dc;
      ids.item = ((await get(pm, `${p}/perimeter-items?pageSize=100`)).items as { id: string; code: string }[]).find((x) => x.code === 'PI-001')!.id;
      ids.entity = ((await get(pm, `${p}/legal-entities`)).items as { id: string; role: string }[]).find((x) => x.role === 'newco')!.id;
      ids.tsa = ((await get(pm, `${p}/tsa-services?pageSize=100`)).items as { id: string; code: string }[]).find((x) => x.code === 'TSA-002')!.id;
      ids.plan = ((await get(pm, `${p}/cutover-plans?pageSize=100`)).items as { id: string }[])[0]!.id;
      ids.partner = ((await get(pm, `${p}/partners?pageSize=100`)).items as { id: string; code: string }[]).find((x) => x.code === 'DEMO-PA')!.id;
      ids.closing = ((await get(pm, `${p}/closings?pageSize=100`)).items as { id: string; code: string }[]).find((x) => x.code === 'CLO-001')!.id;
      ids.room = ((await get(pm, `${p}/partner-rooms?pageSize=100`)).items as { id: string; type: string }[]).find((x) => x.type === 'partner')!.id;
      ids.budgetLine = ((await get(fin, `${p}/budget-lines?pageSize=100`)).items as { id: string }[])[0]!.id;
      const users = (await get(admin, '/api/v1/auth/demo-users')).items as { id: string; displayName: string }[];
      const uid = (n: string) => users.find((u) => u.displayName === n)!.id;
      const templates = (await get(admin, '/api/v1/templates')).items as { id: string; templateKey: string }[];
      const fresh = await post(admin, '/api/v1/projects', { templateVersionId: templates.find((t) => t.templateKey === 'dc-carveout')!.id, code: `QA34-ST-${RUN}`, name: `QA P3/P4 states probe ${RUN} (synthetic)`, projectManagerUserId: uid(PERSONAS.pm) });
      ids.fresh = fresh.id;
      await post(admin, `/api/v1/projects/${fresh.id}/members`, { userId: uid(PERSONAS.finance), role: 'finance_restricted', reason: 'QA P3/P4 review — states probe fixture' });
      ids.freshItem = (await post(pm, `/api/v1/projects/${fresh.id}/perimeter-items`, { type: 'site', name: `QA34 non-demo site ${RUN} (synthetic)`, disposition: 'pending' })).id;
    } finally {
      await pm.dispose();
      await fin.dispose();
      await admin.dispose();
    }
  });

  test('restricted: a Project-B user sees the neutral restricted state on DEMO-DC P3/P4 screens and records — no code, name or title leaks', async ({ browser, baseURL }) => {
    test.setTimeout(240_000);
    const pmB = await as(browser, baseURL!, PERSONAS.pmB);
    const w = `/projects/${ids.dc}`;
    const leaks = ['DEMO-DC', 'PI-001', 'Demo NewCo', 'TSA-002', 'Legacy monitoring bridge', 'CO-001', 'Day-1 go-live', 'DEMO-PA', 'Partner Alpha', 'CLO-001', 'BL-001'];
    const found: string[] = [];
    try {
      for (const path of [
        `${w}/perimeter`,
        `${w}/perimeter/items/${ids.item}`,
        `${w}/newco`,
        `${w}/newco/entities/${ids.entity}`,
        `${w}/readiness`,
        `${w}/readiness/tsa/${ids.tsa}`,
        `${w}/readiness/cutover/${ids.plan}`,
        `${w}/finance`,
        `${w}/finance/budget/${ids.budgetLine}`,
        `${w}/jv`,
        `${w}/jv/partners/${ids.partner}`,
        `${w}/jv/closing/closings/${ids.closing}`,
        `${w}/jv/rooms/${ids.room}`,
      ]) {
        await pmB.page.goto(path);
        await expect(pmB.page.getByTestId('restricted-state').first(), path).toBeVisible({ timeout: 30_000 });
        await settled(pmB.page);
        const text = await pmB.page.locator('body').innerText();
        for (const l of leaks) if (text.includes(l)) found.push(`${path}: "${l}" visible`);
      }
      await pmB.page.screenshot({ path: join(SHOTS, 'states-restricted-project-b-tsa.png'), fullPage: true });
    } finally {
      await pmB.close();
    }
    // A DEMO-DC record id under another project's URL (the PM reads both projects): restricted, nothing of the record shown.
    const pm = await as(browser, baseURL!, PERSONAS.pm);
    try {
      for (const path of [`/projects/${ids.fresh}/readiness/tsa/${ids.tsa}`, `/projects/${ids.fresh}/perimeter/items/${ids.item}`, `/projects/${ids.fresh}/jv/closing/closings/${ids.closing}`]) {
        await pm.page.goto(path);
        await expect(pm.page.getByTestId('restricted-state').first(), path).toBeVisible({ timeout: 30_000 });
        const text = await pm.page.locator('body').innerText();
        for (const l of ['TSA-002', 'Legacy monitoring bridge', 'PI-001', 'CLO-001']) if (text.includes(l)) found.push(`${path}: "${l}" visible`);
      }
    } finally {
      await pm.close();
    }
    expect(found, found.join('\n')).toEqual([]);
  });

  test('error and loading: a failing list shows the error state with a correlation id and Retry recovers; a slow list shows the loading state first', async ({ browser, baseURL }) => {
    test.setTimeout(240_000);
    const pm = await as(browser, baseURL!, PERSONAS.pm);
    const fin = await as(browser, baseURL!, PERSONAS.finance);
    const found: string[] = [];
    try {
      for (const [who, path, api, ready] of [
        [pm, `/projects/${ids.dc}/perimeter`, '/perimeter-items', 'perimeter-table'],
        [pm, `/projects/${ids.dc}/readiness/tsa`, '/tsa-services', 'tsa-table'],
        [pm, `/projects/${ids.dc}/jv/partners`, '/partners', 'partners-table'],
        [fin, `/projects/${ids.dc}/finance/budget`, '/budget-lines', 'budget-table'],
      ] as const) {
        const page = who.page;
        const pattern = new RegExp(`/api/v1/projects/[^/]+${api}(\\?|$)`);
        // Error (503 problem from the API) → error state, correlation id, Retry.
        let fail = true;
        await page.route(pattern, (route) =>
          (fail
            ? route.fulfill({ status: 503, contentType: 'application/problem+json', body: JSON.stringify({ type: 'about:blank', title: 'Service Unavailable', status: 503, code: 'qa.probe_unavailable', detail: 'QA probe', correlationId: `qa-p34-${RUN}` }) })
            : route.continue()
          ).catch(() => undefined),
        );
        await page.goto(path);
        const alert = page.getByRole('alert').filter({ hasText: EN('states.error.unavailableTitle') });
        const shown = await alert.first().waitFor({ state: 'visible', timeout: 30_000 }).then(() => true, () => false);
        if (!shown) {
          found.push(`${path}: no error state for a 503 list`);
        } else {
          if (!(await alert.first().innerText()).includes(`qa-p34-${RUN}`)) found.push(`${path}: correlation id not shown`);
          await page.screenshot({ path: join(SHOTS, `states-error${api.replace(/\//g, '-')}.png`), fullPage: true });
          fail = false;
          await alert.first().getByRole('button', { name: EN('common.actions.retry') }).click();
          const recovered = await page.getByTestId(ready).first().waitFor({ state: 'visible', timeout: 30_000 }).then(() => true, () => false);
          if (!recovered) found.push(`${path}: Retry did not recover`);
        }
        await page.unrouteAll({ behavior: 'ignoreErrors' });
        // Loading: the same list answered after 3 s.
        await page.route(pattern, async (route) => {
          await new Promise((r) => setTimeout(r, 3_000));
          await route.continue().catch(() => undefined);
        });
        await page.goto(path);
        const loading = await page.getByTestId('loading-state').first().waitFor({ state: 'visible', timeout: 5_000 }).then(() => true, () => false);
        if (!loading) found.push(`${path}: no loading state while the list is pending`);
        await expect(page.getByTestId(ready).first()).toBeVisible({ timeout: 30_000 });
        await page.unrouteAll({ behavior: 'ignoreErrors' });
      }
      console.log(`states error/loading problems: ${JSON.stringify(found)}`);
      expect(found, found.join('\n')).toEqual([]);
    } finally {
      await pm.close();
      await fin.close();
    }
  });

  test('empty: a fresh DC project shows the empty state of the P3/P4 registers', async ({ browser, baseURL }) => {
    test.setTimeout(180_000);
    const pm = await as(browser, baseURL!, PERSONAS.pm);
    const fin = await as(browser, baseURL!, PERSONAS.finance);
    const w = `/projects/${ids.fresh}`;
    const found: string[] = [];
    try {
      for (const [who, path, testId, key] of [
        [pm, `${w}/readiness/tsa`, 'tsa-table', 'readiness.tsa.empty'],
        [pm, `${w}/jv/partners`, 'partners-table', 'jv.partners.empty'],
        [pm, `${w}/jv/closing`, 'closings-table', 'jv.closing.emptyClosings'],
        [pm, `${w}/newco?tab=requirements`, 'requirements-table', 'newco.req.empty'],
        [fin, `${w}/finance/budget`, 'budget-table', 'finance.budget.empty'],
      ] as const) {
        await who.page.goto(path);
        await settled(who.page);
        const box = who.page.getByTestId(testId).first();
        const ok = await box.getByText(EN(key), { exact: true }).waitFor({ state: 'visible', timeout: 20_000 }).then(() => true, () => false);
        if (!ok) found.push(`${path}: empty state "${EN(key)}" not shown`);
      }
      await pm.page.goto(`${w}/readiness/tsa`);
      await settled(pm.page);
      await pm.page.screenshot({ path: join(SHOTS, 'states-empty-tsa-register.png'), fullPage: true });
      expect(found, found.join('\n')).toEqual([]);
      expect(pm.problems(), pm.problems().join('\n')).toEqual([]);
      expect(fin.problems(), fin.problems().join('\n')).toEqual([]);
    } finally {
      await pm.close();
      await fin.close();
    }
  });

  test('Demo badge: DEMO-DC records carry it on their P3/P4 detail pages; a record of a non-demo project does not', async ({ browser, baseURL }) => {
    test.setTimeout(180_000);
    const pm = await as(browser, baseURL!, PERSONAS.pm);
    const fin = await as(browser, baseURL!, PERSONAS.finance);
    const w = `/projects/${ids.dc}`;
    const missing: string[] = [];
    try {
      for (const [who, path] of [
        [pm, `${w}/perimeter/items/${ids.item}`],
        [pm, `${w}/newco/entities/${ids.entity}`],
        [pm, `${w}/readiness/tsa/${ids.tsa}`],
        [pm, `${w}/readiness/cutover/${ids.plan}`],
        [pm, `${w}/jv/partners/${ids.partner}`],
        [pm, `${w}/jv/closing/closings/${ids.closing}`],
        [pm, `${w}/jv/rooms/${ids.room}`],
        [fin, `${w}/finance/budget/${ids.budgetLine}`],
      ] as const) {
        await who.page.goto(path);
        await settled(who.page);
        await expect(who.page.getByRole('heading', { level: 1 })).toBeVisible();
        if (!(await who.page.locator('main header').getByTestId('demo-badge').first().isVisible().catch(() => false))) missing.push(path);
      }
      await pm.page.goto(`/projects/${ids.fresh}/perimeter/items/${ids.freshItem}`);
      await settled(pm.page);
      await expect(pm.page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(pm.page.getByTestId('demo-badge')).toHaveCount(0);
      console.log(`Demo badge missing on: ${JSON.stringify(missing)}`);
      expect(missing, `no Demo badge in the page header of: ${missing.join(', ')}`).toEqual([]);
    } finally {
      await pm.close();
      await fin.close();
    }
  });
});
