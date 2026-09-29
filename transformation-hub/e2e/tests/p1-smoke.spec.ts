import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { PERSONAS, apiSessionAs, loginAs, setSavedLocale, watchConsole } from './helpers';

const SHOTS = join(__dirname, '..', 'screenshots');

test.describe('P1 web foundation smoke', () => {
  test('(a) Demo Project Manager sees DEMO-DC with a Demo badge and not DEMO-TRANSFORM', async ({ page }) => {
    const problems = watchConsole(page);
    await loginAs(page, PERSONAS.pm);
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');

    await expect(page.getByTestId('demo-banner')).toBeVisible();
    const card = page.locator('[data-testid="project-card"][data-project-code="DEMO-DC"]');
    await expect(card).toBeVisible();
    await expect(card.getByTestId('demo-badge')).toBeVisible();
    // The four status dimensions are shown separately, each with its own state.
    await expect(card.locator('[data-dimension]')).toHaveCount(4);
    await expect(page.locator('[data-project-code="DEMO-TRANSFORM"]')).toHaveCount(0);
    await expect(page.getByText('DEMO-TRANSFORM')).toHaveCount(0);
    await page.screenshot({ path: join(SHOTS, 'en-portfolio-home.png'), fullPage: true });

    // Project overview (DC Executive Cockpit) renders from the real API.
    await card.getByRole('link', { name: /Demo DC Carve-out/ }).click();
    await expect(page.getByText('DC Executive Cockpit')).toBeVisible();
    await expect(page.getByTestId('dimension-cards').locator('[data-dimension]')).toHaveCount(4);
    await expect(page.getByTestId('next-gate')).toContainText('G1');
    await page.screenshot({ path: join(SHOTS, 'en-project-overview.png'), fullPage: true });

    expect(problems(), problems().join('\n')).toEqual([]);
  });

  test('(b) switching to Arabic sets html[dir=rtl] and translates navigation', async ({ page }) => {
    const problems = watchConsole(page);
    await loginAs(page, PERSONAS.pm);
    // Start from English regardless of what an earlier run left behind.
    await setSavedLocale(page, 'en');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Portfolio' })).toBeVisible();

    try {
      await page.getByTestId('locale-switch').click();
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
      const mainNav = page.getByRole('navigation', { name: 'التنقل الرئيسي' });
      await expect(mainNav.getByRole('link', { name: 'المحفظة' })).toBeVisible();
      await expect(mainNav.getByRole('link', { name: 'أعمالي / صندوق الوارد' })).toBeVisible();
      await expect(page.getByRole('heading', { level: 1, name: 'المحفظة' })).toBeVisible();

      // Server-rendered from the cookie: survives a full reload.
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.locator('[data-testid="project-card"][data-project-code="DEMO-DC"]')).toBeVisible();
      await page.screenshot({ path: join(SHOTS, 'ar-portfolio-home.png'), fullPage: true });

      await page.locator('[data-project-code="DEMO-DC"] h2 a').click();
      const projectNav = page.getByTestId('project-nav');
      await expect(projectNav.getByRole('link', { name: 'مسارات العمل' })).toBeVisible();
      await expect(projectNav.getByRole('link', { name: 'نظرة عامة', exact: true })).toBeVisible();
      await expect(page.getByText('لوحة القيادة التنفيذية لمراكز البيانات')).toBeVisible();
      await page.screenshot({ path: join(SHOTS, 'ar-project-overview.png'), fullPage: true });
    } finally {
      // Restore the persona's saved language so other runs start in English.
      await setSavedLocale(page, 'en');
    }
    expect(problems(), problems().join('\n')).toEqual([]);
  });

  test('(c) Demo PM — Project B opening the DC project URL sees the restricted state', async ({ page, baseURL }) => {
    const problems = watchConsole(page);
    // Look up the DC project id through an API session of a persona who can see it.
    const pmApi = await apiSessionAs(baseURL!, PERSONAS.pm);
    const list = await (await pmApi.get('/api/v1/projects')).json();
    const dc = (list.items as { id: string; code: string; name: string }[]).find((p) => p.code === 'DEMO-DC');
    expect(dc, 'DEMO-DC visible to the Demo Project Manager').toBeTruthy();
    await pmApi.dispose();

    await loginAs(page, PERSONAS.pmB);
    await expect(page.locator('[data-testid="project-card"][data-project-code="DEMO-TRANSFORM"]')).toBeVisible();
    await expect(page.locator('[data-project-code="DEMO-DC"]')).toHaveCount(0);

    for (const path of [`/projects/${dc!.id}`, `/projects/${dc!.id}/workstreams`, `/projects/${dc!.id}/members`]) {
      await page.goto(path);
      await expect(page.getByTestId('restricted-state')).toBeVisible();
      await expect(page.getByRole('heading', { name: "Not found or you don't have access" })).toBeVisible();
      // Nothing about the hidden project leaks into the page.
      await expect(page.getByText(dc!.name)).toHaveCount(0);
      await expect(page.getByText('DEMO-DC')).toHaveCount(0);
      await expect(page.getByTestId('project-nav')).toHaveCount(0);
    }
    expect(problems(), problems().join('\n')).toEqual([]);
  });

  test('(d) Demo Portfolio Admin sees "Create project"; Demo Contributor does not', async ({ browser }) => {
    const adminCtx = await browser.newContext();
    const admin = await adminCtx.newPage();
    await loginAs(admin, PERSONAS.portfolioAdmin);
    await expect(admin.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(admin.getByTestId('create-project')).toBeVisible();
    await admin.getByTestId('create-project').click();
    await expect(admin).toHaveURL(/\/projects\/new$/);
    await expect(admin.getByRole('heading', { level: 1, name: 'Create project' })).toBeVisible();
    await adminCtx.close();

    const contribCtx = await browser.newContext();
    const contrib = await contribCtx.newPage();
    await loginAs(contrib, PERSONAS.contributor);
    await expect(contrib.getByRole('heading', { level: 1, name: 'Portfolio' })).toBeVisible();
    await expect(contrib.getByTestId('create-project')).toHaveCount(0);
    // Direct navigation to the wizard is refused too (the API would also reject the command).
    await contrib.goto('/projects/new');
    await expect(contrib.getByTestId('restricted-state')).toBeVisible();
    await contribCtx.close();
  });

  test('(e) charter edit with a stale version gets the real 409 "reload and review" state (no data changed)', async ({ page }) => {
    await loginAs(page, PERSONAS.pm);
    await page.locator('[data-project-code="DEMO-DC"] h2 a').click();
    await page.getByTestId('project-nav').getByRole('link', { name: 'Program Overview & Charter' }).click();
    const versionBefore = await page.getByText('Record version', { exact: true }).locator('xpath=..').locator('dd').innerText();

    // Force a stale expectedVersion so the real API refuses the command with 409 and nothing is written.
    let sent: Record<string, unknown> | null = null;
    let csrfHeader: string | undefined;
    await page.route('**/api/v1/projects/*', async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      sent = { ...(route.request().postDataJSON() as Record<string, unknown>), expectedVersion: 999999 };
      csrfHeader = route.request().headers()['x-csrf-token'];
      await route.continue({ postData: JSON.stringify(sent) });
    });
    await page.getByTestId('edit-charter').click();
    await page.getByLabel(/^Name/).fill('Stale edit — must be refused');
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(page.getByRole('alert').filter({ hasText: 'This record was changed by someone else' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reload and review' })).toBeVisible();
    expect(sent).toMatchObject({ name: 'Stale edit — must be refused', expectedVersion: 999999 });
    expect(csrfHeader, 'CSRF header sent on mutation').toBeTruthy();

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Record version', { exact: true }).locator('xpath=..').locator('dd')).toHaveText(versionBefore);
    await expect(page.getByRole('heading', { level: 1 })).not.toContainText('Stale edit');
  });

  test('(f) without a session, a project URL redirects to the login page and keeps the destination', async ({ page }) => {
    await page.goto('/projects/00000000-0000-7000-8000-000000000000/workstreams');
    await page.waitForURL(/\/login\?next=/);
    expect(new URL(page.url()).searchParams.get('next')).toBe('/projects/00000000-0000-7000-8000-000000000000/workstreams');
    await expect(page.getByTestId('oidc-status')).toContainText('Not configured');
    await expect(page.getByTestId('demo-notice')).toBeVisible();
  });
});
