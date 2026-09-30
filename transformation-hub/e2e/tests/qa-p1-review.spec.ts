import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PERSONAS, apiSessionAs, loginAs, setSavedLocale, watchConsole } from './helpers';

/**
 * Independent QA (P1 gate review) — web wizard journeys and UI-bypass checks against the REAL API.
 * Scenario / requirement IDs: AT-02, AT-03, REQ-ENT-005, REQ-ENT-006, REQ-SEC-016 (XSS), REQ-UX-001, REQ-UX-004,
 * REQ-UX-028, REQ-PLT-006 (honest NotImplementedYet).
 * Needs: API in DEMO mode + seeded demo sandbox; web at HUB_WEB_URL. Creates projects with a per-run suffix.
 */
const SHOTS = join(__dirname, '..', 'screenshots', 'qa-p1');
mkdirSync(SHOTS, { recursive: true });
const RUN = Date.now().toString(36).toUpperCase().slice(-5);
const XSS_NAME = `QA XSS <img src=x onerror="window.__xss=1"> <script>window.__xss=2</script> ${RUN}`;
const XSS_DESC = `"><svg onload="window.__xss=3"></svg> javascript:alert(1) {{7*7}} \${7*7}`;
const AR_NAME = `مشروع ضمان الجودة التجريبي — مراكز البيانات ${RUN}`;

function trackXss(page: Page) {
  const dialogs: string[] = [];
  page.on('dialog', async (d) => {
    dialogs.push(d.message());
    await d.dismiss();
  });
  return async () => ({
    dialogs,
    flag: await page.evaluate(() => (window as unknown as { __xss?: number }).__xss ?? null),
    injectedImg: await page.locator('img[src="x"]').count(),
    injectedSvg: await page.locator('svg[onload]').count(),
  });
}

async function pickPm(page: Page, query: string, name: string) {
  const box = page.getByRole('combobox');
  await box.fill(query);
  await page.getByRole('option', { name: new RegExp(name) }).first().click();
}

test.describe.configure({ mode: 'serial' });

test.describe('QA P1 review — AT-02 wizard creation (en/ar), AT-03 isolation, REQ-SEC-016 XSS, REQ-UX-001/004/028', () => {
  let xssProjectId = '';
  let arProjectId = '';
  let confidentialProjectId = '';

  test('AT-02 (en) wizard: General Transformation project with stored XSS payloads rendered inert [REQ-ENT-005, REQ-ENT-006, REQ-SEC-016]', async ({ page }) => {
    const xss = trackXss(page);
    const problems = watchConsole(page);
    await loginAs(page, PERSONAS.portfolioAdmin);
    await setSavedLocale(page, 'en');
    await page.reload();
    await page.getByTestId('create-project').click();
    await expect(page).toHaveURL(/\/projects\/new$/);

    await page.getByRole('radio', { name: /General Transformation/ }).check();
    await page.screenshot({ path: join(SHOTS, 'en-wizard-1-template.png'), fullPage: true });
    await page.getByRole('button', { name: 'Next' }).click();

    await page.getByLabel(/^Project code/).fill(`QA-XSS-${RUN}`);
    await page.getByLabel(/^Name/).fill(XSS_NAME);
    await page.getByLabel(/^Description/).fill(XSS_DESC);
    await page.getByLabel(/^Objective/).fill('Arabic in an English field: هدف تجريبي');
    await page.getByLabel(/^Classification/).selectOption('internal');
    await page.screenshot({ path: join(SHOTS, 'en-wizard-2-details.png'), fullPage: true });
    await page.getByRole('button', { name: 'Next' }).click();

    await pickPm(page, 'Demo Project', 'Demo Project Manager');
    await page.screenshot({ path: join(SHOTS, 'en-wizard-3-people.png'), fullPage: true });
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText(XSS_NAME)).toBeVisible();
    await page.screenshot({ path: join(SHOTS, 'en-wizard-4-review.png'), fullPage: true });

    const created = page.waitForResponse((r) => r.url().endsWith('/api/v1/projects') && r.request().method() === 'POST');
    await page.getByTestId('create-submit').click();
    const res = await created;
    expect(res.status()).toBe(201);
    xssProjectId = (await res.json()).id;
    await page.waitForURL(new RegExp(`/projects/${xssProjectId}$`));
    await expect(page.getByRole('heading', { level: 1 })).toContainText('<img src=x onerror=');
    await page.screenshot({ path: join(SHOTS, 'en-wizard-5-created-overview.png'), fullPage: true });

    await page.goto(`/projects/${xssProjectId}/charter`);
    await expect(page.getByText(XSS_DESC)).toBeVisible();
    await page.goto('/');
    await expect(page.locator(`[data-project-code="QA-XSS-${RUN}"]`)).toBeVisible();
    const r = await xss();
    expect(r, JSON.stringify(r)).toEqual({ dialogs: [], flag: null, injectedImg: 0, injectedSvg: 0 });
    expect(problems(), problems().join('\n')).toEqual([]);
  });

  test('AT-02 (ar, RTL) wizard: DC carve-out project with NewCo "incorporation in progress" stays unverified [REQ-ENT-001, REQ-ENT-003, REQ-UX-001]', async ({ page, baseURL }) => {
    const problems = watchConsole(page);
    await loginAs(page, PERSONAS.portfolioAdmin);
    await setSavedLocale(page, 'ar');
    try {
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await page.getByTestId('create-project').click();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      // QA-P1-14: the Arabic UI shows the template's Arabic name (from the bilingual template), not the English one.
      await expect(page.getByRole('radio', { name: /DC Carve-out/ })).toHaveCount(0);
      await page.getByRole('radio', { name: /مراكز البيانات/ }).check();
      await page.screenshot({ path: join(SHOTS, 'ar-wizard-1-template.png'), fullPage: true });
      await page.getByRole('button', { name: 'التالي' }).click();

      await page.getByLabel(/^رمز المشروع/).fill(`QA-AR-${RUN}`);
      await page.getByLabel(/^الاسم/).fill(AR_NAME);
      await page.getByLabel(/^التصنيف/).selectOption('internal');
      await page.screenshot({ path: join(SHOTS, 'ar-wizard-2-details.png'), fullPage: true });
      await page.getByRole('button', { name: 'التالي' }).click();

      await pickPm(page, 'Demo Project', 'Demo Project Manager');
      await page.locator('input[name="newcoMode"]').nth(1).check();
      await page.getByLabel(/^اسم الشركة الجديدة/).fill('شركة تجريبية جديدة (Demo)');
      await page.locator('input[name="newcoStatus"]').nth(1).check(); // incorporation_in_progress
      await page.screenshot({ path: join(SHOTS, 'ar-wizard-3-people.png'), fullPage: true });
      await page.getByRole('button', { name: 'التالي' }).click();
      await page.screenshot({ path: join(SHOTS, 'ar-wizard-4-review.png'), fullPage: true });

      const created = page.waitForResponse((r) => r.url().endsWith('/api/v1/projects') && r.request().method() === 'POST');
      await page.getByTestId('create-submit').click();
      const res = await created;
      expect(res.status()).toBe(201);
      const body = await res.json();
      arProjectId = body.id;
      expect(body.created).toMatchObject({ workstreams: 12, gates: 8, statusDimensions: 4 });
      await page.waitForURL(new RegExp(`/projects/${arProjectId}$`));
      await expect(page.getByRole('heading', { level: 1 })).toContainText(AR_NAME);
      await page.screenshot({ path: join(SHOTS, 'ar-wizard-5-created-overview.png'), fullPage: true });

      // Server truth: the PM sees the project with its own template, and the NewCo is NOT verified.
      const pm = await apiSessionAs(baseURL!, PERSONAS.pm);
      const detail = await (await pm.get(`/api/v1/projects/${arProjectId}`)).json();
      expect(detail.templateKey).toBe('dc-carveout');
      expect(detail.entities).toEqual([expect.objectContaining({ incorporationStatus: 'incorporation_in_progress' })]);
      expect(detail.entities[0].verification).not.toBe('confirmed');
      await pm.dispose();
    } finally {
      await setSavedLocale(page, 'en');
    }
    expect(problems(), problems().join('\n')).toEqual([]);
  });

  test('portfolio (PM): Demo badge only on demo records; later-phase sections render NotImplementedYet, never sample data [REQ-UX-004, REQ-UX-028, REQ-PLT-006]', async ({ page }) => {
    const xss = trackXss(page);
    await loginAs(page, PERSONAS.pm);
    await expect(page.locator('[data-project-code="DEMO-DC"]').getByTestId('demo-badge')).toBeVisible();
    const mine = page.locator(`[data-project-code="QA-AR-${RUN}"]`);
    await expect(mine).toBeVisible();
    await expect(mine.getByTestId('demo-badge')).toHaveCount(0);
    await expect(page.locator(`[data-project-code="QA-XSS-${RUN}"]`)).toBeVisible();
    await page.screenshot({ path: join(SHOTS, 'en-portfolio-pm-after-wizard.png'), fullPage: true });

    // P2: committee (Screen 4), plan, raid (Screens 5 and 12) and documents (Screen 13) are delivered, P3: perimeter (Screen 7),
    // newco (Screen 8) and readiness (Screen 9), and P4: finance (Screen 10) and jv (Screen 11) — they show this project's own
    // records, never demo data and never the placeholder.
    for (const seg of ['committee', 'plan', 'raid', 'documents', 'perimeter', 'newco', 'readiness', 'finance', 'jv']) {
      await page.goto(`/projects/${arProjectId}/${seg}`);
      await expect(page.getByTestId('not-implemented'), `section ${seg}`).toHaveCount(0);
      await expect(page.getByTestId('demo-badge'), `section ${seg} shows no demo records`).toHaveCount(0);
    }
    for (const seg of ['ai', 'reports']) {
      await page.goto(`/projects/${arProjectId}/${seg}`);
      await expect(page.getByTestId('not-implemented'), `section ${seg}`).toBeVisible();
      await expect(page.locator('table'), `section ${seg} has no data table`).toHaveCount(0);
    }
    await page.goto(`/projects/${arProjectId}/ai`);
    await page.screenshot({ path: join(SHOTS, 'en-section-ai-not-implemented.png'), fullPage: true });
    const r = await xss();
    expect(r.flag).toBeNull();
    expect(r.dialogs).toEqual([]);
  });

  test('AT-03: Project-B manager cannot reach wizard-created projects via UI or API (404, no title leak)', async ({ page, baseURL }) => {
    const pmb = await apiSessionAs(baseURL!, PERSONAS.pmB);
    for (const id of [xssProjectId, arProjectId]) {
      for (const p of [`/api/v1/projects/${id}`, `/api/v1/projects/${id}/workstreams`, `/api/v1/projects/${id}/members`, `/api/v1/projects/${id}/activity`]) {
        const r = await pmb.get(p);
        expect(r.status(), p).toBe(404);
        const text = await r.text();
        expect(text).not.toContain(RUN);
      }
    }
    const list = await (await pmb.get(`/api/v1/projects?q=${RUN}`)).json();
    expect(list.total).toBe(0);
    await pmb.dispose();

    await loginAs(page, PERSONAS.pmB);
    for (const id of [xssProjectId, arProjectId]) {
      await page.goto(`/projects/${id}`);
      await expect(page.getByTestId('restricted-state')).toBeVisible();
      await expect(page.getByText(RUN)).toHaveCount(0);
    }
  });

  test('wizard default classification: the creator is not dropped on "Not found" right after a successful create [REQ-ENT-006, AT-30]', async ({ page }) => {
    await loginAs(page, PERSONAS.portfolioAdmin);
    await page.getByTestId('create-project').click();
    await page.getByRole('radio', { name: /General Transformation/ }).check();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByLabel(/^Project code/).fill(`QA-CONF-${RUN}`);
    await page.getByLabel(/^Name/).fill(`QA default classification ${RUN}`);
    await page.getByRole('button', { name: 'Next' }).click();
    await pickPm(page, 'Demo Project', 'Demo Project Manager');
    await page.getByRole('button', { name: 'Next' }).click();
    const created = page.waitForResponse((r) => r.url().endsWith('/api/v1/projects') && r.request().method() === 'POST');
    await page.getByTestId('create-submit').click();
    const res = await created;
    expect(res.status()).toBe(201);
    confidentialProjectId = (await res.json()).id;
    await page.waitForURL(new RegExp(`/projects/${confidentialProjectId}$`));
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: join(SHOTS, 'en-wizard-default-classification-after-create.png'), fullPage: true });
    // Defect check (QA-P1-05): the Demo Portfolio Admin (clearance internal) creates a project with the wizard's
    // default classification (confidential) and is redirected to a page that says the project does not exist.
    await expect(page.getByTestId('restricted-state')).toHaveCount(0);
  });
});
