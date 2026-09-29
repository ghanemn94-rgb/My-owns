import { expect, test, type Browser, type Page } from '@playwright/test';
import { join } from 'node:path';
import { PERSONAS, apiSessionAs, loginAs, setSavedLocale, watchConsole } from './helpers';

/**
 * P2 planning screens (Screens 5, 6, 12, 15 and the cockpit delay-impact tile) against the real API in DEMO mode.
 *
 * The tests change demo data (they confirm a Draft task, report progress, raise and decide a change request and
 * approve a re-baseline). They are written for a freshly seeded database and tolerate re-runs: each run picks the
 * first remaining Draft task and creates its own uniquely titled change request. A run that stops half-way can leave
 * a baseline proposal pending; reset the database (scripts/dev/db-reset.sh + demo seed) before running again.
 */
const SHOTS = join(__dirname, '..', 'screenshots');
const SPONSOR = 'Demo Sponsor';

let dcId = '';

test.beforeAll(async ({ baseURL }) => {
  const pmApi = await apiSessionAs(baseURL!, PERSONAS.pm);
  const list = await (await pmApi.get('/api/v1/projects')).json();
  const dc = (list.items as { id: string; code: string }[]).find((p) => p.code === 'DEMO-DC');
  expect(dc, 'DEMO-DC visible to the Demo Project Manager').toBeTruthy();
  dcId = dc!.id;
  await pmApi.dispose();
});

/** Status of the record shown in the page header (first status badge of the page's own header). */
const headerStatus = (page: Page) => page.locator('main header [data-status]').first();

async function csrf(page: Page): Promise<string> {
  return (await page.context().cookies()).find((c) => c.name === 'hub_csrf')?.value ?? '';
}

async function confirmCommand(page: Page, command: string, label: string, note?: string) {
  await page.locator(`[data-command="${command}"]`).click();
  const dialog = page.getByRole('dialog', { name: label });
  await expect(dialog).toBeVisible();
  if (note) await dialog.locator('textarea').last().fill(note);
  await dialog.getByRole('button', { name: label, exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function newSession(browser: Browser, persona: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginAs(page, persona);
  return { ctx, page };
}

test.describe.serial('P2 planning', () => {
  test('(a) PM confirms a Draft task into the plan, reports progress, and a stale version gets 409 "reload and review"', async ({ page }) => {
    const problems = watchConsole(page);
    await loginAs(page, PERSONAS.pm);
    await setSavedLocale(page, 'en');
    await page.goto(`/projects/${dcId}/plan?tab=wbs`);
    await expect(page.getByRole('tab', { name: 'WBS' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('wbs-table')).toBeVisible();

    // Filter the WBS to Draft activities and open the first one.
    await page.getByTestId('wbs-filter-status').selectOption('draft');
    const firstDraft = page.locator('[data-testid="wbs-table"] tr[data-task]').first();
    await expect(firstDraft.locator('[data-status="draft"]')).toBeVisible();
    const wbsCode = (await firstDraft.getAttribute('data-task'))!;
    await firstDraft.getByRole('link', { name: wbsCode }).click();
    await page.waitForURL(/\/plan\/tasks\/[0-9a-f-]+$/);
    const taskId = page.url().split('/').pop()!;
    await expect(headerStatus(page)).toHaveAttribute('data-status', 'draft');
    await expect(page.getByTestId('demo-badge').first()).toBeVisible();
    // A Draft task cannot take progress yet.
    await expect(page.getByTestId('task-progress')).toHaveCount(0);

    // Command: confirm into plan (state machine + permission decide which commands are offered).
    await confirmCommand(page, 'activate', 'Confirm into plan');
    await expect(headerStatus(page)).toHaveAttribute('data-status', 'not_started');
    await expect(page.locator('[data-command="activate"]')).toHaveCount(0);

    // Report progress (reported, not verified).
    await page.getByTestId('task-progress').click();
    const form = page.getByTestId('progress-form');
    await form.getByLabel(/^Reported progress/).fill('40');
    await page.getByTestId('progress-form-submit').click();
    await expect(form).toBeHidden();
    await expect(page.getByRole('progressbar', { name: 'Reported progress' })).toHaveAttribute('aria-valuenow', '40');
    await expect(page.getByRole('progressbar', { name: 'Evidence-verified progress' })).toHaveAttribute('aria-valuenow', '0');

    // Stale version: open the dialog, let "someone else" change the task, then save → real 409, nothing written.
    await page.getByTestId('task-progress').click();
    const task = await (await page.request.get(`/api/v1/projects/${dcId}/tasks/${taskId}`)).json();
    const other = await page.request.post(`/api/v1/projects/${dcId}/tasks/${taskId}/progress`, {
      data: { expectedVersion: task.version, reportedProgress: 45 },
      headers: { 'x-csrf-token': await csrf(page) },
    });
    expect(other.ok(), `concurrent progress update → HTTP ${other.status()}`).toBeTruthy();
    await form.getByLabel(/^Reported progress/).fill('60');
    await page.getByTestId('progress-form-submit').click();
    await expect(form.getByRole('alert')).toContainText('This record was changed by someone else');
    await form.getByRole('button', { name: 'Reload and review' }).click();
    await expect(form).toBeHidden();
    // The other change is shown; our stale 60 was not written.
    await expect(page.getByRole('progressbar', { name: 'Reported progress' })).toHaveAttribute('aria-valuenow', '45');

    // After reviewing, the change is applied on the latest version.
    await page.getByTestId('task-progress').click();
    await form.getByLabel(/^Reported progress/).fill('60');
    await page.getByTestId('progress-form-submit').click();
    await expect(form).toBeHidden();
    await expect(page.getByRole('progressbar', { name: 'Reported progress' })).toHaveAttribute('aria-valuenow', '60');

    // The WBS reflects the confirmed task and its reported / verified progress.
    await page.goto(`/projects/${dcId}/plan?tab=wbs`);
    await page.getByTestId('wbs-filter-status').selectOption('not_started');
    const row = page.locator(`[data-testid="wbs-table"] tr[data-task="${wbsCode}"]`).filter({ has: page.locator('[data-status="not_started"]') });
    await expect(row.first()).toContainText('60%');
    expect(problems(), problems().join('\n')).toEqual([]);
  });

  test('(b) change request lifecycle and re-baseline: PM raises and assesses, Sponsor approves; PM proposes baseline, Sponsor approves', async ({ page, browser }) => {
    const problems = watchConsole(page);
    const title = `E2E re-baseline request ${Date.now()}`;
    await loginAs(page, PERSONAS.pm);

    // --- PM: create (Draft) → submit → start review → record impact assessment.
    await page.goto(`/projects/${dcId}/raid?tab=changes`);
    await expect(page.getByRole('tab', { name: 'Change requests' })).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('cr-create').click();
    const crForm = page.getByTestId('cr-form');
    await crForm.getByLabel(/^Title/).fill(title);
    await crForm.getByLabel(/^Rationale/).fill('Demo: the perimeter scope changed; the schedule must be re-baselined.');
    await crForm.getByLabel(/Requires re-baselining/).check();
    await page.getByTestId('cr-form-submit').click();
    await expect(crForm).toBeHidden();
    await page.getByTestId('cr-table').getByRole('link', { name: new RegExp(title) }).click();
    await page.waitForURL(/\/raid\/changes\/[0-9a-f-]+$/);
    const crId = page.url().split('/').pop()!;
    await expect(headerStatus(page)).toHaveAttribute('data-status', 'draft');

    await confirmCommand(page, 'submit', 'Submit');
    await expect(headerStatus(page)).toHaveAttribute('data-status', 'submitted');
    await confirmCommand(page, 'start_review', 'Start review');
    await expect(headerStatus(page)).toHaveAttribute('data-status', 'under_review');
    // The requester never sees approve/reject (no permission, and separation of duties).
    await expect(page.locator('[data-command="approve"]')).toHaveCount(0);
    await expect(page.locator('[data-command="reject"]')).toHaveCount(0);

    await page.getByTestId('cr-assess-open').click();
    const assess = page.getByTestId('cr-assess');
    await assess.getByLabel(/^Time/).fill('About 10 working days on the Day-1 readiness path.');
    await page.getByTestId('cr-assess-submit').click();
    await expect(assess).toBeHidden();
    await expect(page.getByTestId('cr-impacts')).toContainText('About 10 working days');

    // --- Sponsor: finds it in My Work and approves.
    const sponsor = await newSession(browser, SPONSOR);
    await sponsor.page.goto('/inbox');
    await sponsor.page.getByTestId('inbox-chip-change_request_approve').click();
    await sponsor.page.getByTestId('inbox-link').filter({ hasText: title }).click();
    await sponsor.page.waitForURL(new RegExp(`/raid/changes/${crId}$`));
    await confirmCommand(sponsor.page, 'approve', 'Approve change');
    await expect(headerStatus(sponsor.page)).toHaveAttribute('data-status', 'approved');

    // --- PM: re-baselining needs a new baseline linked to the approved request.
    await page.reload();
    await expect(headerStatus(page)).toHaveAttribute('data-status', 'approved');
    await page.getByRole('link', { name: 'Go to baselines' }).click();
    await expect(page.getByTestId('baselines-tab')).toBeVisible();
    await page.getByTestId('baseline-propose').click();
    const blForm = page.getByTestId('baseline-form');
    await blForm.getByLabel(/^Change request/).selectOption(crId);
    await page.getByTestId('baseline-form-submit').click();
    await expect(blForm).toBeHidden();
    const proposedRow = page.getByTestId('baselines-table').locator('tr').filter({ has: page.locator('[data-status="proposed"]') });
    await expect(proposedRow).toHaveCount(1);
    await proposedRow.getByRole('link').first().click();
    await page.waitForURL(/\/plan\/baselines\/[0-9a-f-]+$/);
    const baselineId = page.url().split('/').pop()!;
    // The proposer cannot approve their own baseline (hidden in the UI; the API refuses it as well).
    await expect(page.getByText('You proposed this baseline, so someone else must approve or reject it.')).toBeVisible();
    await expect(page.locator('[data-command="approve"]')).toHaveCount(0);

    // --- Sponsor: approves the baseline from My Work.
    await sponsor.page.goto('/inbox');
    await sponsor.page.getByTestId('inbox-chip-baseline_approval').click();
    await sponsor.page.getByTestId('inbox-link').first().click();
    await sponsor.page.waitForURL(new RegExp(`/plan/baselines/${baselineId}$`));
    await confirmCommand(sponsor.page, 'approve', 'Approve baseline');
    await expect(headerStatus(sponsor.page)).toHaveAttribute('data-status', 'approved');
    await sponsor.ctx.close();

    // --- PM: the previous approved baseline is superseded; the change request can now be marked implemented.
    await page.goto(`/projects/${dcId}/plan?tab=baselines`);
    await expect(page.getByTestId('baselines-table').locator('[data-status="approved"]')).toHaveCount(1);
    await expect(page.getByTestId('baselines-table').locator('[data-status="superseded"]').first()).toBeVisible();
    await page.goto(`/projects/${dcId}/raid/changes/${crId}`);
    await confirmCommand(page, 'mark_implemented', 'Mark implemented');
    await expect(headerStatus(page)).toHaveAttribute('data-status', 'implemented');
    expect(problems(), problems().join('\n')).toEqual([]);
  });

  test('(c) cockpit tile, workstream workspace and timeline render; screenshots in English, Arabic (RTL) and 390px mobile', async ({ page }) => {
    const problems = watchConsole(page);
    await loginAs(page, PERSONAS.pm);
    await setSavedLocale(page, 'en');

    // Cockpit (Screen 2): delay-impact tile with the schedule-based forecast label.
    await page.goto(`/projects/${dcId}`);
    const tile = page.getByTestId('delay-impact-tile');
    await expect(tile).toBeVisible();
    await expect(tile.getByTestId('forecast-label')).toBeVisible();
    await expect(tile.getByTestId('delay-tile-schedule')).toBeVisible();

    // Workstream workspace (Screen 6): metric cards click through to the matching tab.
    await page.goto(`/projects/${dcId}/workstreams`);
    await page.getByRole('link', { name: /WS01/ }).first().click();
    await expect(page.getByTestId('ws-tabs')).toBeVisible();
    await page.getByRole('tab', { name: 'Tasks' }).click();
    await expect(page).toHaveURL(/tab=tasks/);
    await expect(page.getByTestId('ws-tasks-table')).toBeVisible();

    // Integrated plan timeline (Screen 5) in English.
    await page.goto(`/projects/${dcId}/plan?tab=timeline`);
    const gantt = page.getByTestId('gantt');
    await expect(gantt).toBeVisible();
    await expect(gantt).toHaveAttribute('data-dir', 'ltr');
    await expect(gantt.locator('[data-node]').first()).toBeVisible();
    await page.screenshot({ path: join(SHOTS, 'planning-en.png'), fullPage: true });

    try {
      await setSavedLocale(page, 'ar');
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByRole('tab', { name: 'الجدول الزمني' })).toHaveAttribute('aria-selected', 'true');
      await expect(gantt).toHaveAttribute('data-dir', 'rtl');
      await expect(gantt.locator('[data-node]').first()).toBeVisible();
      await page.screenshot({ path: join(SHOTS, 'planning-ar.png'), fullPage: true });

      // Mobile (390px): the Gantt scrolls inside its own container; the page itself never scrolls sideways.
      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload();
      await expect(gantt.locator('[data-node]').first()).toBeAttached();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, 'no horizontal page scroll at 390px').toBeLessThanOrEqual(0);
      await gantt.scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(SHOTS, 'planning-ar-390.png'), fullPage: true });
    } finally {
      await setSavedLocale(page, 'en');
    }
    expect(problems(), problems().join('\n')).toEqual([]);
  });
});
