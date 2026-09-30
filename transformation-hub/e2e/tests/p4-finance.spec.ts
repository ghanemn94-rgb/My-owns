import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { apiSessionAs, loginAs, watchConsole } from './helpers';

/**
 * P4 Finance & Value (spec §10 screen 10) against the real API, driven through the UI:
 *  - AT-29 / REQ-DAT-004: a total of figures in different currencies is REFUSED without a conversion basis; with an explicit
 *    basis the total shows the rate, its source and its date (the client never adds amounts — the server does).
 *  - REQ-FIN-010: human financial validation by a second person, approval by a third; the preparer is offered neither
 *    command (and the server refuses the bypass); the validator is not offered the approval.
 *  - REQ-UX-013: a user without finance access sees the restricted-access state; a finance reader below a record's
 *    classification gets the same state for that record.
 *  - REQ-FIN-005..008: frozen model versions with explicit value bases (EV / equity / unit mixes flagged, approved values
 *    empty until approved, v2 diff), and model outputs imported as figures with their source document, sheet and cell.
 *  - SEC-P1R-03 (P3 follow-up): a legal entity linked from its owning project is read-only in the NewCo screens.
 * Fixtures (a fresh DC project, finance roles for three personas, one USD figure, an entity link) are prepared through the
 * APIs as the real demo personas; every behaviour under test is exercised through the UI. Re-runnable (timestamped).
 * Figures, rates and amounts are synthetic test inputs of a non-demo e2e project — never presented as real data.
 */
const SHOTS = join(__dirname, '..', 'screenshots', 'p4');
mkdirSync(SHOTS, { recursive: true });

const P = {
  admin: 'Demo Portfolio Admin',
  pm: 'Demo Project Manager',
  finance: 'Demo Finance Member',
  approver: 'Demo Functional Approver',
  legal: 'Demo Legal Member',
  contributor: 'Demo Contributor',
} as const;
const STAMP = Date.now().toString(36).toUpperCase().slice(-6);
const MOBILE = { width: 390, height: 844 };

async function csrfOf(ctx: APIRequestContext): Promise<string> {
  return (await ctx.storageState()).cookies.find((c) => c.name === 'hub_csrf')?.value ?? '';
}
async function post(ctx: APIRequestContext, path: string, data: unknown) {
  const res = await ctx.post(path, { data, headers: { 'x-csrf-token': await csrfOf(ctx) } });
  expect(res.ok(), `POST ${path} → HTTP ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}
async function get(ctx: APIRequestContext, path: string) {
  const res = await ctx.get(path);
  expect(res.ok(), `GET ${path} → HTTP ${res.status()}`).toBeTruthy();
  return res.json();
}

async function asPersona(browser: Browser, baseURL: string, persona: string, opts: { locale?: 'en' | 'ar'; viewport?: { width: number; height: number } } = {}) {
  const context = await browser.newContext(opts.viewport ? { viewport: opts.viewport } : {});
  const page = await context.newPage();
  const problems = watchConsole(page);
  await loginAs(page, persona);
  // Rendering language from the `hub_locale` cookie (the persona's saved preference is left untouched).
  await context.addCookies([{ name: 'hub_locale', value: opts.locale ?? 'en', url: baseURL }]);
  return { page, problems, close: () => context.close() };
}

/** Full-page screenshot without transient toasts covering the content. */
async function shot(page: Page, file: string) {
  const toastButtons = page.getByRole('status').getByRole('button');
  while ((await toastButtons.count()) > 0) await toastButtons.first().click();
  await expect(page.getByTestId('loading-state')).toHaveCount(0);
  await page.screenshot({ path: join(SHOTS, file), fullPage: true });
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'no page-level horizontal overflow at 390 px').toBeLessThanOrEqual(1);
}

/** Record a figure through the UI (Figures tab → "Record a figure"); returns its id from the detail URL. */
async function recordFigure(page: Page, pid: string, f: { kind: string; lineRef: string; period: string; label: string; amount: string; currency: string; source: string }) {
  await page.goto(`/projects/${pid}/finance/snapshots`);
  await page.getByTestId('create-snapshot').click();
  const form = page.getByTestId('snapshot-form');
  await expect(form).toBeVisible();
  await page.getByTestId('snapshot-kind').selectOption(f.kind);
  await page.getByTestId('snapshot-lineref').fill(f.lineRef);
  await page.getByTestId('snapshot-period').fill(f.period);
  await page.getByTestId('snapshot-label').fill(f.label);
  await page.getByTestId('snapshot-money-amount').fill(f.amount);
  await page.getByTestId('snapshot-money-currency').fill(f.currency);
  await page.getByTestId('snapshot-source').fill(f.source);
  await page.getByTestId('snapshot-form-submit').click();
  await page.waitForURL(/\/finance\/snapshots\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('snapshot-detail')).toBeVisible();
  return page.url().split('/').pop()!;
}

test.describe.configure({ mode: 'serial' });

test.describe('P4 Finance & Value — AT-29, REQ-FIN-010, REQ-UX-013', () => {
  let pid = ''; // fresh e2e project (DC template) with finance roles for three personas
  let dcId = ''; // demo sandbox project
  let userIds: Record<string, string> = {};

  test.beforeAll(async ({ baseURL }) => {
    const admin = await apiSessionAs(baseURL!, P.admin);
    try {
      const users = (await get(admin, '/api/v1/auth/demo-users')).items as { id: string; displayName: string }[];
      userIds = Object.fromEntries(users.map((u) => [u.displayName, u.id]));
      const templates = (await get(admin, '/api/v1/templates')).items as { id: string; templateKey: string }[];
      const dc = templates.find((t) => t.templateKey === 'dc-carveout');
      if (!dc) throw new Error('dc-carveout template not loaded');
      const created = await post(admin, '/api/v1/projects', {
        templateVersionId: dc.id,
        code: `E2E-FIN-${STAMP}`,
        name: `E2E finance project ${STAMP} (synthetic)`,
        projectManagerUserId: userIds[P.pm],
      });
      pid = created.id;
      // Three Finance members for separation of duties: preparer, validator, approver (fixture grants, reason recorded).
      for (const persona of [P.finance, P.approver, P.legal]) {
        await post(admin, `/api/v1/projects/${pid}/members`, { userId: userIds[persona], role: 'finance_restricted', reason: 'E2E P4 finance — separation of duties fixture' });
      }
      const projects = (await get(admin, '/api/v1/projects?pageSize=100')).items as { id: string; code: string }[];
      dcId = projects.find((p) => p.code === 'DEMO-DC')?.id ?? '';
    } finally {
      await admin.dispose();
    }
    if (!dcId) {
      const pm = await apiSessionAs(baseURL!, P.pm);
      dcId = ((await get(pm, '/api/v1/projects?pageSize=100')).items as { id: string; code: string }[]).find((p) => p.code === 'DEMO-DC')!.id;
      await pm.dispose();
    }
  });

  test('AT-29 / REQ-DAT-004: a mixed-currency total is refused without a conversion basis; with one the total shows rate, source and date', async ({ browser, baseURL }) => {
    // Fixture: a USD forecast figure through the API; the SAR one is recorded through the UI below.
    const fin = await apiSessionAs(baseURL!, P.finance);
    await post(fin, `/api/v1/projects/${pid}/financial-snapshots`, {
      kind: 'forecast',
      category: 'one_off_separation',
      lineRef: `AT29-USD-${STAMP}`,
      label: 'E2E synthetic advisory fee (USD)',
      period: '2026-Q4',
      amount: { amount: '200', currency: 'USD', unitScale: 1 },
      sourceRef: 'Synthetic e2e source — not real data',
    });
    await fin.dispose();

    const { page, problems, close } = await asPersona(browser, baseURL!, P.finance);
    try {
      await recordFigure(page, pid, { kind: 'forecast', lineRef: `AT29-SAR-${STAMP}`, period: '2026-Q4', label: 'E2E synthetic advisory fee (SAR)', amount: '1000', currency: 'SAR', source: 'Synthetic e2e source — not real data' });
      await expect(page.getByTestId('figure-amount')).toHaveAttribute('data-currency', 'SAR');

      // Select both figures and ask the SERVER for their total.
      await page.goto(`/projects/${pid}/finance/snapshots?q=AT29-`);
      const boxes = page.getByTestId('snapshot-select');
      await expect(boxes).toHaveCount(2);
      for (const i of [0, 1]) await boxes.nth(i).check();
      await page.getByTestId('total-selected').click();
      const dlg = page.getByRole('dialog');
      await expect(dlg.getByTestId('aggregate-selected')).toBeVisible();
      await dlg.getByTestId('aggregate-target-currency').fill('SAR');
      const refused = page.waitForResponse((r) => r.url().endsWith('/finance/aggregate') && r.request().method() === 'POST');
      await dlg.getByTestId('aggregate-run').click();
      const refusedRes = await refused;
      expect(refusedRes.status(), 'server refuses the mixed-currency total').toBe(422);
      expect((await refusedRes.json()).code).toBe('money.mixed_currency');
      const noBasis = dlg.getByTestId('aggregate-no-basis');
      await expect(noBasis).toBeVisible();
      await expect(noBasis).toHaveAttribute('data-from', 'USD');
      await expect(noBasis).toHaveAttribute('data-to', 'SAR');
      await expect(dlg.getByTestId('aggregate-result')).toHaveCount(0);
      await shot(page, 'at29-en-total-refused-no-basis.png');

      // Supply an explicit basis (rate, source, date) — the platform never invents one.
      await dlg.getByTestId('aggregate-add-basis').click();
      await expect(dlg.getByTestId('conversion-from')).toHaveValue('USD');
      await expect(dlg.getByTestId('conversion-to')).toHaveValue('SAR');
      await dlg.getByTestId('conversion-rate').fill('3.75');
      await dlg.getByTestId('conversion-source').fill(`E2E synthetic rate table ${STAMP} (not a real rate)`);
      await dlg.getByTestId('conversion-asof').fill('2026-09-01');
      await dlg.getByTestId('aggregate-run').click();
      await expect(dlg.getByTestId('aggregate-result')).toBeVisible();
      const total = dlg.getByTestId('aggregate-total');
      await expect(total).toHaveAttribute('data-currency', 'SAR');
      await expect(total).toHaveAttribute('data-amount', '1750.0000');
      await expect(dlg.getByTestId('conversion-used-rate')).toHaveText('3.75');
      await expect(dlg.getByTestId('conversion-used-source')).toContainText(`E2E synthetic rate table ${STAMP}`);
      await expect(dlg.getByTestId('conversion-used-asof')).toHaveAttribute('data-value', '2026-09-01');
      await expect(dlg.getByTestId('aggregate-basis')).toContainText('3.75');
      await expect(dlg.getByTestId('aggregate-basis')).toContainText(`E2E synthetic rate table ${STAMP}`);
      await dlg.getByTestId('aggregate-result').scrollIntoViewIfNeeded();
      await shot(page, 'at29-en-total-with-basis.png');

      // The same refusal in Arabic (RTL): the state and the server's basis are translated from their codes.
      await page.context().addCookies([{ name: 'hub_locale', value: 'ar', url: baseURL! }]);
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByTestId('snapshot-select')).toHaveCount(2);
      for (const i of [0, 1]) await page.getByTestId('snapshot-select').nth(i).check();
      await page.getByTestId('total-selected').click();
      await page.getByRole('dialog').getByTestId('aggregate-run').click();
      await expect(page.getByRole('dialog').getByTestId('aggregate-no-basis')).toContainText('USD');
      await page.getByRole('dialog').getByTestId('aggregate-no-basis').scrollIntoViewIfNeeded();
      await shot(page, 'at29-ar-total-refused-no-basis.png');
      expect(problems(), problems().join('\n')).toEqual([]);
    } finally {
      await close();
    }
  });

  test('REQ-FIN-010: validated by a second person, approved by a third; the preparer is offered neither command', async ({ browser, baseURL }) => {
    const lineRef = `FIN010-${STAMP}`;
    let figureId = '';

    // 1. The preparer (a Finance member who HOLDS the approval permission) records the figure through the UI.
    {
      const { page, problems, close } = await asPersona(browser, baseURL!, P.finance);
      try {
        figureId = await recordFigure(page, pid, { kind: 'actual', lineRef, period: '2026-09', label: 'E2E synthetic separation advisory cost', amount: '4200.50', currency: 'SAR', source: 'Synthetic e2e ledger extract — not real data' });
        const panel = page.getByTestId('approval-panel');
        await expect(panel).toHaveAttribute('data-state', 'proposed');
        await expect(page.getByTestId('who-may-act')).toBeVisible();
        await expect(page.getByTestId('cmd-validate')).toHaveCount(0);
        await expect(page.getByTestId('cmd-approve')).toHaveCount(0);
        await expect(page.locator('[data-testid="sod-reason"][data-command="validate"]')).toBeVisible();
        await expect(page.getByTestId('prepared-by')).toContainText(/You/);
        // A readable figure never shows a "not found" block: evidence / activity the platform does not list for this user are
        // explained instead (the evidence list and the activity feed apply the general clearance — reported follow-up).
        await page.getByTestId('finance-history').locator('summary').click();
        await expect(page.getByTestId('finance-history').getByTestId('loading-state')).toHaveCount(0);
        await expect(page.getByTestId('restricted-state')).toHaveCount(0);
        await shot(page, 'fin010-en-1-preparer-not-offered.png');
        expect(problems(), problems().join('\n')).toEqual([]);
      } finally {
        await close();
      }
      // The server refuses the bypass (the UI hint is not the control).
      const fin = await apiSessionAs(baseURL!, P.finance);
      const res = await fin.post(`/api/v1/projects/${pid}/financial-snapshots/${figureId}/validate`, { data: { expectedVersion: 1, note: 'Self-validation attempt (e2e bypass check)' }, headers: { 'x-csrf-token': await csrfOf(fin) } });
      expect(res.status(), 'preparer self-validation is refused').toBe(403);
      await fin.dispose();
    }

    // 2. A second Finance member validates.
    {
      const { page, problems, close } = await asPersona(browser, baseURL!, P.approver);
      try {
        await page.goto(`/projects/${pid}/finance/snapshots/${figureId}`);
        await expect(page.getByTestId('approval-panel')).toHaveAttribute('data-state', 'proposed');
        await page.getByTestId('cmd-validate').click();
        const dlg = page.getByRole('dialog');
        await dlg.getByRole('textbox').fill('Checked against the synthetic ledger extract (e2e)');
        await dlg.getByRole('button', { name: 'Validate' }).click();
        await expect(dlg).toBeHidden();
        await expect(page.getByTestId('approval-panel')).toHaveAttribute('data-state', 'under_review');
        await expect(page.getByTestId('validated-by')).toContainText(/You/);
        // The validator is not offered the approval (third person rule) — the reason is shown.
        await expect(page.getByTestId('cmd-approve')).toHaveCount(0);
        await expect(page.locator('[data-testid="sod-reason"][data-command="approve"]')).toBeVisible();
        await shot(page, 'fin010-en-2-validated-validator-not-offered-approval.png');
        expect(problems(), problems().join('\n')).toEqual([]);
      } finally {
        await close();
      }
    }

    // 3. A third Finance member approves.
    {
      const { page, problems, close } = await asPersona(browser, baseURL!, P.legal);
      try {
        await page.goto(`/projects/${pid}/finance/snapshots/${figureId}`);
        await expect(page.getByTestId('approval-panel')).toHaveAttribute('data-state', 'under_review');
        await expect(page.getByTestId('cmd-validate')).toHaveCount(0);
        await page.getByTestId('cmd-approve').click();
        const dlg = page.getByRole('dialog');
        await dlg.getByRole('button', { name: 'Approve' }).click();
        await expect(dlg).toBeHidden();
        await expect(page.getByTestId('approval-panel')).toHaveAttribute('data-state', 'approved');
        await expect(page.getByTestId('approved-by')).toContainText(/You/);
        await expect(page.getByTestId('validated-by')).toContainText(P.approver);
        await expect(page.getByTestId('prepared-by')).toContainText(P.finance);
        await shot(page, 'fin010-en-3-approved-by-third-person.png');
        expect(problems(), problems().join('\n')).toEqual([]);
      } finally {
        await close();
      }
    }

    // 4. The preparer sees the full trail (en, ar, 390 px) and is still offered no approval command.
    for (const [locale, viewport, file] of [
      ['en', undefined, 'fin010-en-4-preparer-view-approved.png'],
      ['ar', undefined, 'fin010-ar-4-preparer-view-approved.png'],
      ['en', MOBILE, 'fin010-en-390-approved.png'],
      ['ar', MOBILE, 'fin010-ar-390-approved.png'],
    ] as const) {
      const { page, problems, close } = await asPersona(browser, baseURL!, P.finance, { locale, viewport });
      try {
        await page.goto(`/projects/${pid}/finance/snapshots/${figureId}`);
        await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
        await expect(page.getByTestId('approval-panel')).toHaveAttribute('data-state', 'approved');
        await expect(page.getByTestId('approved-by')).toContainText(P.legal);
        await expect(page.getByTestId('validated-by')).toContainText(P.approver);
        await expect(page.getByTestId('cmd-approve')).toHaveCount(0);
        await expect(page.getByTestId('cmd-validate')).toHaveCount(0);
        if (viewport) await noHorizontalOverflow(page);
        await shot(page, file);
        expect(problems(), problems().join('\n')).toEqual([]);
      } finally {
        await close();
      }
    }
  });

  test('REQ-UX-013: a user without finance access sees the restricted-access state; a record above a reader\'s clearance is restricted too', async ({ browser, baseURL }) => {
    // A contributor (no finance permission) in the demo project: no Finance link, restricted state on the screen, 403 from the API.
    for (const locale of ['en', 'ar'] as const) {
      const { page, problems, close } = await asPersona(browser, baseURL!, P.contributor, { locale });
      try {
        await page.goto(`/projects/${dcId}`);
        await expect(page.getByTestId('project-nav')).toBeVisible();
        await expect(page.getByTestId('project-nav').locator(`a[href="/projects/${dcId}/finance"]`)).toHaveCount(0);
        await page.goto(`/projects/${dcId}/finance`);
        await expect(page.getByTestId('restricted-state')).toBeVisible();
        await expect(page.getByTestId('finance-tabs')).toHaveCount(0);
        await expect(page.getByTestId('finance-summary')).toHaveCount(0);
        await page.goto(`/projects/${dcId}/finance/budget`);
        await expect(page.getByTestId('restricted-state')).toBeVisible();
        await expect(page.getByTestId('budget-table')).toHaveCount(0);
        await shot(page, `restricted-${locale}-contributor.png`);
        const api = await page.request.get(`/api/v1/projects/${dcId}/finance/summary`);
        expect(api.status(), 'finance summary for a user without finance.record.read').toBe(403);
        expect(problems(), problems().join('\n')).toEqual([]);
      } finally {
        await close();
      }
    }

    // The project manager reads finance (clearance confidential) — below the valuation's classification: the model is neither
    // listed nor reachable (404 → the same restricted state; existence is not revealed).
    const fin = await apiSessionAs(baseURL!, P.finance);
    const models = (await get(fin, `/api/v1/projects/${dcId}/financial-models?pageSize=100`)).items as { id: string; code: string; kind: string; classification: string }[];
    await fin.dispose();
    const valuation = models.find((m) => m.kind === 'valuation' && m.classification === 'strictly_confidential');
    expect(valuation, 'the demo seed registers a strictly confidential valuation model').toBeTruthy();
    const { page, problems, close } = await asPersona(browser, baseURL!, P.pm);
    try {
      await page.goto(`/projects/${dcId}/finance/models`);
      await expect(page.getByTestId('clearance-note')).toBeVisible();
      await expect(page.getByTestId('loading-state')).toHaveCount(0);
      await expect(page.getByText(valuation!.code, { exact: true })).toHaveCount(0);
      await page.goto(`/projects/${dcId}/finance/models/${valuation!.id}`);
      await expect(page.getByTestId('restricted-state')).toBeVisible();
      await expect(page.getByTestId('model-detail')).toHaveCount(0);
      await shot(page, 'restricted-en-pm-record-above-clearance.png');
      expect(problems(), problems().join('\n')).toEqual([]);
    } finally {
      await close();
    }
  });

  test('Finance & Value screens in en / ar / 390 px with the Demo badge on seeded records (REQ-UX-013, REQ-UX-028)', async ({ browser, baseURL }) => {
    for (const [locale, viewport, suffix] of [
      ['en', undefined, 'en'],
      ['ar', undefined, 'ar'],
      ['en', MOBILE, 'en-390'],
      ['ar', MOBILE, 'ar-390'],
    ] as const) {
      const { page, problems, close } = await asPersona(browser, baseURL!, P.finance, { locale, viewport });
      try {
        await page.goto(`/projects/${dcId}/finance`);
        await expect(page.getByTestId('finance-summary')).toBeVisible();
        await expect(page.getByTestId('finance-tabs')).toBeVisible();
        await expect(page.getByTestId('not-implemented')).toHaveCount(0);
        if (viewport) await noHorizontalOverflow(page);
        await shot(page, `finance-${suffix}-summary.png`);
        if (!viewport) {
          // Seeded records carry the Demo badge (budget line, models, benefit, KPIs); detail pages too.
          await page.goto(`/projects/${dcId}/finance/budget`);
          await expect(page.getByTestId('budget-table').getByTestId('demo-badge').first()).toBeVisible();
          await expect(page.getByTestId('separation-costs')).toBeVisible();
          await shot(page, `finance-${suffix}-budget.png`);
          await page.goto(`/projects/${dcId}/finance/models`);
          await expect(page.getByTestId('models-table').getByTestId('demo-badge').first()).toBeVisible();
          await page.getByTestId('model-link').first().click();
          await expect(page.getByTestId('model-detail')).toBeVisible();
          await expect(page.getByTestId('demo-badge').first()).toBeVisible();
          await shot(page, `finance-${suffix}-model.png`);
          await page.goto(`/projects/${dcId}/finance/benefits`);
          await expect(page.getByTestId('benefits-table').getByTestId('demo-badge').first()).toBeVisible();
          await expect(page.getByTestId('kpis-table')).toBeVisible();
          await shot(page, `finance-${suffix}-benefits-kpis.png`);
        }
        expect(problems(), problems().join('\n')).toEqual([]);
      } finally {
        await close();
      }
    }
    // The business plan's approval is not configured in the authority matrix: shown as such, never as approvable.
    const { page, close } = await asPersona(browser, baseURL!, P.finance);
    try {
      await page.goto(`/projects/${dcId}/finance/models`);
      const bp = page.locator('tr', { has: page.getByText('DEMO NewCo business plan', { exact: false }) }).getByTestId('model-link');
      await bp.click();
      await expect(page.getByTestId('model-detail')).toHaveAttribute('data-kind', 'business_plan');
      await expect(page.getByTestId('approval-not-configured')).toBeVisible();
      await shot(page, 'finance-en-business-plan-approval-not-configured.png');
    } finally {
      await close();
    }
  });

  test('REQ-FIN-005..007: each valuation output states its basis; EV / equity and unit mixes are flagged; approved values stay empty; a new version is frozen with its diff', async ({ browser, baseURL }) => {
    const { page, problems, close } = await asPersona(browser, baseURL!, P.finance);
    try {
      await page.goto(`/projects/${pid}/finance/models`);
      await page.getByTestId('create-model').click();
      await page.getByTestId('model-kind').selectOption('valuation');
      await page.getByTestId('model-name').fill(`E2E valuation model ${STAMP} (synthetic)`);
      await page.getByTestId('model-form-submit').click();
      await page.waitForURL(/\/finance\/models\/[0-9a-f-]{36}$/);
      const modelUrl = page.url();
      await expect(page.getByTestId('model-detail')).toHaveAttribute('data-kind', 'valuation');
      await expect(page.getByTestId('no-versions')).toBeVisible();

      // v1: two outputs on DIFFERENT bases and units — the platform never guesses, it flags.
      await page.getByTestId('version-create').click();
      const form = page.getByTestId('version-form');
      await expect(form).toBeVisible();
      await page.getByTestId('version-label').fill('E2E v1');
      await page.getByTestId('version-headline-basis').selectOption('enterprise_value');
      await page.getByTestId('assumption-add').click();
      await page.getByTestId('assumption-key').fill('wacc');
      await page.getByTestId('assumption-value').fill('9.5 (synthetic)');
      const rows = page.getByTestId('output-row');
      await rows.nth(0).getByTestId('output-key').fill('ev');
      await rows.nth(0).getByTestId('output-label').fill('Enterprise value (synthetic)');
      await rows.nth(0).getByTestId('output-amount').fill('1200');
      await rows.nth(0).getByTestId('output-currency').fill('SAR');
      await rows.nth(0).getByTestId('output-unit').selectOption('1000000');
      await rows.nth(0).getByTestId('output-basis').selectOption('enterprise_value');
      await page.getByTestId('output-add').click();
      await rows.nth(1).getByTestId('output-key').fill('eq');
      await rows.nth(1).getByTestId('output-label').fill('Equity value (synthetic)');
      await rows.nth(1).getByTestId('output-amount').fill('950');
      await rows.nth(1).getByTestId('output-currency').fill('SAR');
      await rows.nth(1).getByTestId('output-basis').selectOption('equity_value');
      await page.getByTestId('version-source').fill('Synthetic e2e model export — not real data');
      await page.getByTestId('version-form-submit').click();
      await page.waitForURL(/\/versions\/[0-9a-f-]{36}$/);
      const v1Url = page.url();
      const detail = page.getByTestId('version-detail');
      await expect(detail).toHaveAttribute('data-state', 'proposed');
      await expect(page.getByTestId('frozen-badge')).toBeVisible();
      await expect(page.locator('[data-testid="version-findings"] [data-code="finance.value.ev_equity_mix"]')).toBeVisible();
      await expect(page.locator('[data-testid="version-findings"] [data-code="finance.value.unit_mix"]')).toBeVisible();
      await expect(page.getByTestId('approved-values-empty')).toBeVisible();
      await expect(page.getByTestId('outputs-table').locator('tr[data-basis="equity_value"]')).toHaveCount(1);
      await expect(page.locator('[data-testid="sod-reason"][data-command="validate"]')).toBeVisible();
      await shot(page, 'models-en-version-findings-proposed-vs-approved.png');
      await page.context().addCookies([{ name: 'hub_locale', value: 'ar', url: baseURL! }]);
      await page.reload();
      await expect(page.locator('[data-testid="version-findings"] [data-code="finance.value.ev_equity_mix"]')).toContainText('قيمة المنشأة');
      await shot(page, 'models-ar-version-findings.png');
      await page.context().addCookies([{ name: 'hub_locale', value: 'en', url: baseURL! }]);

      // v2 of the same case: starts from v1's assumptions + an explicit change; v1 stays frozen and is superseded.
      await page.goto(modelUrl);
      await page.getByTestId('version-create').click();
      await expect(page.getByTestId('version-form')).toBeVisible();
      await page.getByTestId('version-label').fill('E2E v2');
      await expect(page.getByTestId('output-row')).toHaveCount(2); // outputs start from the prior version
      await page.getByTestId('assumption-add').click();
      await page.getByTestId('assumption-key').fill('growth');
      await page.getByTestId('assumption-value').fill('3 (synthetic)');
      await page.getByTestId('version-source').fill('Synthetic e2e model export v2 — not real data');
      await page.getByTestId('version-form-submit').click();
      await page.waitForURL((u) => /\/versions\/[0-9a-f-]{36}$/.test(u.pathname) && u.toString() !== v1Url);
      await expect(page.getByTestId('version-diff')).toContainText('growth');
      await shot(page, 'models-en-version-2-diff.png');
      await page.goto(v1Url);
      await expect(page.getByTestId('superseded')).toBeVisible();
      await expect(page.getByTestId('version-detail')).toHaveAttribute('data-state', 'superseded');
      expect(problems(), problems().join('\n')).toEqual([]);
    } finally {
      await close();
    }
  });

  test('REQ-FIN-008: model outputs imported as figures keep their source document, sheet and cell', async ({ browser, baseURL }) => {
    // Fixture: the "original model" as a document with one uploaded version (documents API).
    const title = `E2E synthetic model workbook ${STAMP}`;
    const fin = await apiSessionAs(baseURL!, P.finance);
    const doc = await post(fin, `/api/v1/projects/${pid}/documents`, { kind: 'financial_model', title, classification: 'confidential' });
    const up = await fin.post(`/api/v1/projects/${pid}/documents/${doc.id}/versions`, {
      data: Buffer.from('line,amount\nIMP,321.5\n', 'utf8'),
      headers: { 'content-type': 'application/octet-stream', 'x-filename': encodeURIComponent('model-outputs.csv'), 'x-csrf-token': await csrfOf(fin) },
    });
    expect(up.ok(), `upload → HTTP ${up.status()} ${await up.text()}`).toBeTruthy();
    await fin.dispose();

    const { page, problems, close } = await asPersona(browser, baseURL!, P.finance);
    try {
      await page.goto(`/projects/${pid}/finance/snapshots`);
      await page.getByTestId('import-snapshots').click();
      await expect(page.getByTestId('import-form')).toBeVisible();
      await page.getByTestId('document-select-doc').selectOption({ label: title });
      const row = page.getByTestId('import-row').first();
      await row.getByTestId('import-kind').selectOption('forecast');
      await row.getByTestId('import-period').fill('2027');
      await row.getByTestId('import-lineref').fill(`IMP-${STAMP}`);
      await row.getByTestId('import-label').fill('E2E imported synthetic output');
      await row.getByTestId('import-money-amount').fill('321.5');
      await row.getByTestId('import-money-currency').fill('SAR');
      await row.getByTestId('import-sheet').fill('Outputs');
      await row.getByTestId('import-cell').fill('C12');
      await page.getByTestId('import-form-submit').click();
      await expect(page.getByTestId('import-form')).toBeHidden();
      await page.goto(`/projects/${pid}/finance/snapshots?q=IMP-${STAMP}`);
      const link = page.getByTestId('snapshot-link');
      await expect(link).toHaveCount(1);
      await expect(page.getByTestId('snapshots-table').getByTestId('source-text')).toContainText('Outputs!C12');
      await link.click();
      await expect(page.getByTestId('snapshot-detail')).toBeVisible();
      const source = page.getByTestId('figure-facts').getByTestId('source-text');
      await expect(source).toContainText('Outputs!C12');
      await expect(source.getByRole('link')).toHaveAttribute('href', `/projects/${pid}/documents/${doc.id}`);
      await shot(page, 'import-en-figure-with-source-cell.png');
      expect(problems(), problems().join('\n')).toEqual([]);
    } finally {
      await close();
    }
  });

  test('SEC-P1R-03 (P3 follow-up): a legal entity linked from its owning project is read-only in the NewCo screens', async ({ browser, baseURL }) => {
    // Fixture: link the demo project's NewCo entity (owned by DEMO-DC) into the e2e project, as the manager of both.
    const pm = await apiSessionAs(baseURL!, P.pm);
    const entities = (await get(pm, `/api/v1/projects/${dcId}/legal-entities`)).items as { id: string; role: string; ownedByThisProject: boolean }[];
    const owned = entities.find((e) => e.role === 'newco' && e.ownedByThisProject);
    expect(owned, 'DEMO-DC owns its NewCo entity').toBeTruthy();
    await post(pm, `/api/v1/projects/${pid}/legal-entities/link`, { legalEntityId: owned!.id, role: 'other' });
    await pm.dispose();

    const { page, problems, close } = await asPersona(browser, baseURL!, P.pm);
    try {
      // In the owning project the commands are offered …
      await page.goto(`/projects/${dcId}/newco/entities/${owned!.id}`);
      await expect(page.getByTestId('incorporation')).toBeVisible();
      await expect(page.getByTestId('entity-not-owned')).toHaveCount(0);
      await expect(page.getByTestId('entity-edit')).toBeVisible();
      // … in the linked project the entity is read-only, with the reason shown.
      await page.goto(`/projects/${pid}/newco/entities/${owned!.id}`);
      await expect(page.getByTestId('incorporation')).toBeVisible();
      await expect(page.getByTestId('entity-not-owned')).toBeVisible();
      await expect(page.getByTestId('entity-edit')).toHaveCount(0);
      await expect(page.getByTestId('incorporation-record')).toHaveCount(0);
      await expect(page.getByTestId('incorporation-verify')).toHaveCount(0);
      await shot(page, 'newco-en-linked-entity-read-only.png');
      await page.goto(`/projects/${pid}/newco?tab=entities`);
      await expect(page.getByTestId('entity-not-owned-hint').first()).toBeVisible();
      expect(problems(), problems().join('\n')).toEqual([]);
    } finally {
      await close();
    }
  });
});
