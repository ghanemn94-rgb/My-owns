import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { PERSONAS, apiSessionAs, loginAs, watchConsole } from './helpers';

const SHOTS = join(__dirname, '..', 'screenshots');

/**
 * P1 closure (docs/phases/P1-must-disposition.md): the Demo badge on the demo project's DETAIL view as well as on the
 * portfolio list (REQ-UX-028). A non-demo project created in this test through the API is the negative control, so the
 * test does not depend on other specs' data.
 */
test.describe('P1 closure — UX-028: Demo badge on list and detail [REQ-UX-028, REQ-SET-005]', () => {
  test('UX-028: the demo project shows the Demo badge on the portfolio list, its detail view and a demo record detail; a non-demo project shows none', async ({ page, baseURL }) => {
    const problems = watchConsole(page);

    // Fixture ids (API only): a demo task of DEMO-DC, and a NON-demo project whose PM is the Demo Project Manager.
    const admin = await apiSessionAs(baseURL!, PERSONAS.portfolioAdmin);
    const csrf = (await admin.storageState()).cookies.find((c) => c.name === 'hub_csrf')?.value ?? '';
    const users = (await (await admin.get('/api/v1/auth/demo-users')).json()).items as { id: string; displayName: string }[];
    const pmId = users.find((u) => u.displayName === PERSONAS.pm)!.id;
    const templates = (await (await admin.get('/api/v1/templates')).json()).items as { id: string; templateKey: string }[];
    const code = `P1C-UX028-${Date.now().toString(36).toUpperCase()}`;
    const created = await admin.post('/api/v1/projects', {
      headers: { 'x-csrf-token': csrf },
      data: { templateVersionId: templates.find((t) => t.templateKey === 'general-transformation')!.id, code, name: `${code} non-demo control (test)`, projectManagerUserId: pmId },
    });
    expect(created.status(), await created.text()).toBe(201);
    const plainId = (await created.json()).id as string;
    await admin.dispose();

    const pmApi = await apiSessionAs(baseURL!, PERSONAS.pm);
    const projects = (await (await pmApi.get('/api/v1/projects?pageSize=100')).json()).items as { id: string; code: string; isDemo: boolean }[];
    const dc = projects.find((p) => p.code === 'DEMO-DC')!;
    expect(dc.isDemo).toBe(true);
    expect(projects.find((p) => p.id === plainId)?.isDemo).toBe(false);
    const tasks = (await (await pmApi.get(`/api/v1/projects/${dc.id}/tasks?pageSize=5`)).json()).items as { id: string; isDemo: boolean }[];
    const demoTask = tasks.find((t) => t.isDemo)!;
    expect(demoTask, 'a demo task exists in DEMO-DC').toBeTruthy();
    await pmApi.dispose();

    await loginAs(page, PERSONAS.pm);

    // 1. List: badge on the demo card only.
    const dcCard = page.locator('[data-testid="project-card"][data-project-code="DEMO-DC"]');
    await expect(dcCard.getByTestId('demo-badge')).toBeVisible();
    await expect(page.locator(`[data-testid="project-card"][data-project-code="${code}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="project-card"][data-project-code="${code}"]`).getByTestId('demo-badge')).toHaveCount(0);

    // 2. Detail: the demo project's own view (opened from the list) carries the badge, with its visible label.
    await dcCard.getByRole('link', { name: /Demo DC Carve-out/ }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${dc.id}$`));
    await expect(page.getByText('DC Executive Cockpit')).toBeVisible();
    const navBadge = page.getByTestId('project-nav').getByTestId('demo-badge');
    await expect(navBadge).toBeVisible();
    await expect(navBadge).toHaveText(/Demo/);
    await page.screenshot({ path: join(SHOTS, 'en-p1c-demo-badge-detail.png'), fullPage: true });

    // 3. A demo record's detail page inside the project: badge on the record and on the project header.
    await page.goto(`/projects/${dc.id}/plan/tasks/${demoTask.id}`);
    await expect(page.getByTestId('project-nav').getByTestId('demo-badge')).toBeVisible();
    await expect(page.locator('main#main-content').getByTestId('demo-badge').first()).toBeVisible();

    // 4. Negative control: the non-demo project's detail view (project header/navigation and content) has no Demo badge.
    //    Scoped to the project area: the header's user menu badges the signed-in DEMO persona, not the project.
    await page.goto(`/projects/${plainId}`);
    await expect(page.getByTestId('project-nav')).toContainText(code);
    await expect(page.locator('main#main-content')).toBeVisible();
    await expect(page.getByTestId('project-nav').getByTestId('demo-badge')).toHaveCount(0);
    await expect(page.locator('main#main-content').getByTestId('demo-badge')).toHaveCount(0);

    expect(problems(), problems().join('\n')).toEqual([]);
  });
});
