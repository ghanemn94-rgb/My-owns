import { expect, test, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PERSONAS, apiSessionAs, loginAs, setSavedLocale, watchConsole } from './helpers';

/**
 * P3 carve-out & NewCo screens (Screen 7 perimeter & transfers, Screen 8 NewCo & regulatory) against the real API in
 * DEMO mode: AT-07 (a perimeter change after baseline needs an impact assessment and an approved change request) and
 * AT-06 (incorporation recorded ≠ verified; transfers unaffected), plus the approvals register's server-side separation
 * of duties, all through the UI.
 *
 * The tests change demo data (they add a perimeter item, record/verify the demo NewCo's incorporation status and
 * register an approval). Each run uses unique names and re-records the incorporation status, so re-runs on the same
 * database work; reset the database (scripts/dev/db-reset.sh + demo seed) for a pristine demo.
 */
const SHOTS = join(__dirname, '..', 'screenshots', 'p3');
const SPONSOR = 'Demo Sponsor';
const LEGAL = 'Demo Legal Member';
const APPROVER = 'Demo Functional Approver';
const NEWCO = 'Demo NewCo (fictional entity)';

let dcId = '';

test.beforeAll(async ({ baseURL }) => {
  mkdirSync(SHOTS, { recursive: true });
  const pmApi = await apiSessionAs(baseURL!, PERSONAS.pm);
  const list = await (await pmApi.get('/api/v1/projects')).json();
  const dc = (list.items as { id: string; code: string }[]).find((p) => p.code === 'DEMO-DC');
  expect(dc, 'DEMO-DC visible to the Demo Project Manager').toBeTruthy();
  dcId = dc!.id;
  await pmApi.dispose();
});

/** Status of the record shown in the page header (first status badge of the page's own header). */
const headerStatus = (page: Page) => page.locator('main header [data-status]').first();

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

/** Legal / economic transfer status of every perimeter item the caller sees (register, first 100 rows via the UI). */
async function transferSnapshot(page: Page): Promise<string[]> {
  await page.goto(`/projects/${dcId}/perimeter?tab=register`);
  const table = page.getByTestId('perimeter-table');
  await expect(table.getByTestId('perimeter-item-link').first()).toBeVisible();
  const rows = table.locator('tbody tr');
  const out: string[] = [];
  for (let i = 0; i < (await rows.count()); i++) {
    const row = rows.nth(i);
    const code = (await row.getByTestId('perimeter-item-link').textContent())?.trim() ?? '';
    const view = row.getByTestId('transfer-view');
    out.push(`${code}:${await view.getAttribute('data-legal')}/${await view.getAttribute('data-economic')}`);
  }
  return out.sort();
}

const dimensionState = (page: Page, key: string) => page.locator(`[data-testid="dimension-cards"] [data-dimension="${key}"] [data-status]`).first();

test.describe.serial('P3 carve-out & NewCo', () => {
  test('(a) AT-07: an addition after baseline is held Pending with an impact assessment and enters scope only once its change request is approved and applied', async ({ page, browser }) => {
    const problems = watchConsole(page);
    const name = `E2E synthetic cooling unit ${Date.now()}`;
    await loginAs(page, PERSONAS.pm);
    await setSavedLocale(page, 'en');

    await page.goto(`/projects/${dcId}/perimeter`);
    await expect(page.getByRole('tab', { name: 'Perimeter register' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('not-implemented')).toHaveCount(0);
    await expect(page.getByTestId('perimeter-table').getByTestId('demo-badge').first()).toBeVisible();
    await page.screenshot({ path: join(SHOTS, 'perimeter-register-en.png'), fullPage: true });

    // --- PM adds an item after the baseline was approved: the server holds it Pending and raises a change request.
    await page.getByTestId('perimeter-create').click();
    const form = page.getByTestId('perimeter-create-form');
    await expect(form.getByText('Once the perimeter baseline is approved the item is held as Pending')).toBeVisible();
    await form.getByLabel(/^Type/).selectOption('asset');
    await form.getByLabel(/^Requested disposition/).selectOption('included');
    await form.getByLabel(/^Name/).fill(name);
    await form.getByLabel(/^Justification/).fill('E2E: synthetic asset found during a site walk-through (demo only).');
    await page.getByTestId('perimeter-create-form-submit').click();
    await expect(form).toBeHidden();
    await page.waitForURL(/\/perimeter\/items\/[0-9a-f-]+$/);
    const itemUrl = page.url();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
    await expect(headerStatus(page)).toHaveAttribute('data-status', 'pending');
    const banner = page.getByTestId('pending-change');
    await expect(banner).toContainText('Submitted');
    // Not decided yet: nothing can be applied.
    await expect(page.getByTestId('apply-change')).toHaveCount(0);
    // The impact assessment was recorded with the change (areas without linked records stay "Assessment pending — specialist").
    await expect(page.getByTestId('impact-entries')).toBeVisible();
    await expect(page.locator('section[aria-labelledby="impacts"]')).toContainText('raised with a change request');

    // --- PM opens the change request (impacts carried over) and starts the review; the requester cannot approve.
    await page.getByTestId('open-change-request').click();
    await page.waitForURL(/\/raid\/changes\/[0-9a-f-]+$/);
    const crUrl = page.url();
    await expect(headerStatus(page)).toHaveAttribute('data-status', 'submitted');
    await expect(page.getByTestId('cr-impacts')).toBeVisible();
    await confirmCommand(page, 'start_review', 'Start review');
    await expect(headerStatus(page)).toHaveAttribute('data-status', 'under_review');
    await expect(page.locator('[data-command="approve"]')).toHaveCount(0);

    // --- DOM-P2-03: the budget effect was carried over as text only, so an approval would be refused (amount not
    //     quantified). The assessor records the cost impact as money in the impact assessment through the UI — a
    //     synthetic 0 for this demo change (not a Finance assessment).
    await expect(page.getByTestId('cr-cost-impact-fact')).toContainText('Described in text only');
    await page.getByTestId('cr-assess-open').click();
    const assess = page.getByTestId('cr-assess');
    await expect(assess.getByTestId('cr-cost-text-only')).toBeVisible();
    await assess.getByTestId('cr-cost-impact-amount').fill('0');
    await expect(assess.getByTestId('cr-cost-impact-currency')).toHaveValue('SAR');
    await assess.getByLabel(/^Note/).fill('Synthetic E2E assessment: no budget effect recorded for this demo change (not a Finance assessment).');
    await page.getByTestId('cr-assess-submit').click();
    await expect(assess).toBeHidden();
    await expect(page.getByTestId('cr-cost-impact-value')).toContainText('0 SAR');

    // --- Sponsor approves the change (within the DEMO delegated limit for change_request_budget).
    const sponsor = await newSession(browser, SPONSOR);
    await sponsor.page.goto(crUrl);
    await sponsor.page.locator('[data-command="approve"]').click();
    await expect(sponsor.page.getByRole('dialog', { name: 'Approve change' })).toContainText('Budget impact compared with the delegated limit: 0 SAR.');
    await sponsor.page.getByRole('dialog', { name: 'Approve change' }).getByRole('button', { name: 'Cancel' }).click();
    await confirmCommand(sponsor.page, 'approve', 'Approve change');
    await expect(headerStatus(sponsor.page)).toHaveAttribute('data-status', 'approved');
    await sponsor.ctx.close();

    // --- PM applies the decided outcome from the item: the item enters scope and the pending change closes.
    await page.reload();
    await page.getByTestId('cr-subject-link').click();
    await page.waitForURL(itemUrl);
    await expect(page.getByTestId('pending-change')).toContainText('Approved');
    await page.getByTestId('apply-change').click();
    const apply = page.getByRole('dialog', { name: /^Apply the outcome of/ });
    await expect(apply).toContainText('Approved: the requested disposition, site and entities are applied');
    await apply.getByRole('button', { name: 'Apply change outcome', exact: true }).click();
    await expect(apply).toBeHidden();
    await expect(headerStatus(page)).toHaveAttribute('data-status', 'included');
    await expect(page.getByTestId('pending-change')).toHaveCount(0);
    await expect(page.getByTestId('item-history')).toContainText('Applied');
    await page.screenshot({ path: join(SHOTS, 'perimeter-item-at07-applied-en.png'), fullPage: true });

    // The register shows the item in scope with both transfer aspects still Not started (the change moved no asset).
    await page.goto(`/projects/${dcId}/perimeter?tab=register&disposition=included`);
    const row = page.getByTestId('perimeter-table').locator('tbody tr').filter({ hasText: name });
    await expect(row.getByTestId('transfer-view')).toHaveAttribute('data-legal', 'not_started');
    await expect(row.getByTestId('transfer-view')).toHaveAttribute('data-economic', 'not_started');
    expect(problems(), problems().join('\n')).toEqual([]);
  });

  test('(b) AT-06: incorporation status recorded ≠ verified; recording and verifying it leaves transfers and the carve-out untouched', async ({ page, browser }) => {
    const problems = watchConsole(page);
    await loginAs(page, PERSONAS.pm);
    const transfersBefore = await transferSnapshot(page);

    await page.goto(`/projects/${dcId}/newco`);
    await expect(page.getByRole('tab', { name: 'Legal entities & incorporation' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('not-implemented')).toHaveCount(0);
    await expect(dimensionState(page, 'perimeter_transfer')).toBeVisible();
    const perimeterDimBefore = await dimensionState(page, 'perimeter_transfer').getAttribute('data-status');
    const readinessDimBefore = await dimensionState(page, 'operational_readiness').getAttribute('data-status');
    await page.getByTestId('entities-table').getByRole('link', { name: NEWCO }).click();
    await page.waitForURL(/\/newco\/entities\/[0-9a-f-]+$/);
    const entityUrl = page.url();

    // --- PM links evidence (a note) and records "incorporated": a claim, Proposed until someone else verifies it.
    const evidence = page.locator('[data-testid="evidence-panel"][data-target-type="legal_entity"]');
    await evidence.getByTestId('evidence-add').click();
    const link = page.getByRole('dialog', { name: 'Link evidence' });
    await link.getByRole('radio', { name: 'Note' }).check();
    await link.getByLabel(/^Evidence note/).fill('E2E: synthetic registration record reference (demo only, not a real registration).');
    await link.getByRole('button', { name: 'Link evidence', exact: true }).click();
    await expect(link).toBeHidden();
    await expect(page.getByTestId('entity-evidence-count')).not.toHaveText(/^0 active/);

    await page.getByTestId('incorporation-record').click();
    const record = page.getByRole('dialog', { name: `Record the incorporation status of ${NEWCO}` });
    await record.getByTestId('incorporation-status-select').selectOption('incorporated');
    await expect(record).toContainText('stays Proposed until someone else verifies it');
    await expect(record).toContainText('Transfers, operational readiness and carve-out completion are not changed.');
    await record.getByRole('button', { name: 'Record status', exact: true }).click();
    await expect(record).toBeHidden();
    await expect(page.getByTestId('incorporation-status')).toHaveAttribute('data-status', 'incorporated');
    await expect(page.getByTestId('incorporation-verification')).toHaveAttribute('data-verification', 'proposed');
    await expect(page.getByTestId('incorporation-verified-by')).toHaveCount(0);
    // The recorder holds no verify permission here, and the page never offers it.
    await expect(page.getByTestId('incorporation-verify')).toHaveCount(0);
    await expect(dimensionState(page, 'incorporation')).not.toHaveAttribute('data-status', 'incorporated_verified');
    await expect(page.getByTestId('carveout-complete')).toHaveAttribute('data-value', 'false');
    await page.screenshot({ path: join(SHOTS, 'newco-entity-recorded-en.png'), fullPage: true });

    // --- Legal (not the recorder) verifies against the evidence.
    const legal = await newSession(browser, LEGAL);
    await legal.page.goto(entityUrl);
    await expect(legal.page.getByTestId('incorporation-verification')).toHaveAttribute('data-verification', 'proposed');
    await legal.page.getByTestId('incorporation-verify').click();
    const verify = legal.page.getByRole('dialog', { name: `Verify the incorporation status of ${NEWCO}` });
    await expect(verify).toContainText('The person who recorded the status cannot verify it.');
    await verify.getByRole('button', { name: 'Verify', exact: true }).click();
    await expect(verify).toBeHidden();
    await expect(legal.page.getByTestId('incorporation-verification')).toHaveAttribute('data-verification', 'confirmed');
    await expect(legal.page.getByTestId('incorporation-status')).toHaveAttribute('data-status', 'incorporated');
    await expect(legal.page.getByTestId('incorporation-verified-by')).toContainText(LEGAL);
    await expect(dimensionState(legal.page, 'incorporation')).toHaveAttribute('data-status', 'incorporated_verified');
    // Other dimensions and the carve-out completion are untouched (AT-06).
    await expect(dimensionState(legal.page, 'perimeter_transfer')).toHaveAttribute('data-status', perimeterDimBefore!);
    await expect(dimensionState(legal.page, 'operational_readiness')).toHaveAttribute('data-status', readinessDimBefore!);
    await expect(legal.page.getByTestId('carveout-complete')).toHaveAttribute('data-value', 'false');
    await legal.page.screenshot({ path: join(SHOTS, 'newco-entity-verified-en.png'), fullPage: true });
    await legal.ctx.close();

    // --- No transfer changed.
    expect(await transferSnapshot(page)).toEqual(transfersBefore);
    expect(problems(), problems().join('\n')).toEqual([]);
  });

  test('(c) approvals register: new entries start "Assessment pending — specialist"; the registrant is refused (403 reason shown), another specialist assesses', async ({ page, browser }) => {
    const title = `E2E synthetic approval ${Date.now()}`;
    const legal = await newSession(browser, LEGAL);
    const problems = watchConsole(legal.page);
    await legal.page.goto(`/projects/${dcId}/newco?tab=requirements`);
    await expect(legal.page.getByTestId('requirements-table')).toBeVisible();
    await legal.page.getByTestId('requirement-create').click();
    const form = legal.page.getByTestId('requirement-form');
    await form.getByLabel(/^Category/).selectOption('external_party');
    await form.getByLabel(/^Authority/).fill('Demo counterparty (fictional)');
    await form.getByLabel(/^Title/).fill(title);
    await legal.page.getByTestId('requirement-form-submit').click();
    await expect(form).toBeHidden();
    const row = legal.page.getByTestId('requirements-table').locator('tbody tr').filter({ hasText: title });
    await expect(row).toContainText('Assessment pending — specialist');
    await row.getByTestId('requirement-link').click();
    await legal.page.waitForURL(/\/newco\/requirements\/[0-9a-f-]+$/);
    const reqUrl = legal.page.url();
    await expect(legal.page.getByTestId('applicability')).toHaveAttribute('data-value', 'assessment_pending');
    // Nothing can be submitted or granted before a specialist assessment.
    await expect(legal.page.locator('[data-command="submit"]')).toHaveCount(0);
    await expect(legal.page.locator('[data-command="record_grant"]')).toHaveCount(0);

    // The registrant tries to assess applicability: the API refuses it (separation of duties) and the dialog shows why.
    await legal.page.getByTestId('requirement-assess').click();
    const assess = legal.page.getByRole('dialog', { name: /^Applicability of/ });
    await assess.getByTestId('applicability-select').selectOption('applicable');
    await assess.locator('textarea').last().fill('E2E: registrant attempting its own assessment.');
    await assess.getByRole('button', { name: 'Assess applicability', exact: true }).click();
    await expect(assess.getByRole('alert')).toContainText('Separation of duties');
    await assess.getByRole('button', { name: 'Cancel' }).click();
    await expect(legal.page.getByTestId('applicability')).toHaveAttribute('data-value', 'assessment_pending');
    await legal.ctx.close();

    // Another specialist (functional approver) records the assessment with its basis.
    const approver = await newSession(browser, APPROVER);
    await approver.page.goto(reqUrl);
    await approver.page.getByTestId('requirement-assess').click();
    const assess2 = approver.page.getByRole('dialog', { name: /^Applicability of/ });
    await assess2.getByTestId('applicability-select').selectOption('applicable');
    await assess2.locator('textarea').last().fill('E2E: synthetic specialist basis (demo only, not a real determination).');
    await assess2.getByRole('button', { name: 'Assess applicability', exact: true }).click();
    await expect(assess2).toBeHidden();
    await expect(approver.page.getByTestId('applicability')).toHaveAttribute('data-value', 'applicable');
    await expect(approver.page.getByTestId('applicability')).toContainText(APPROVER);
    await approver.page.screenshot({ path: join(SHOTS, 'newco-requirement-assessed-en.png'), fullPage: true });
    await approver.page.goto(`/projects/${dcId}/newco?tab=requirements`);
    await expect(approver.page.getByTestId('requirements-table')).toContainText('Assessment pending — specialist');
    await approver.page.screenshot({ path: join(SHOTS, 'newco-requirements-en.png'), fullPage: true });
    await approver.ctx.close();
    expect(problems(), problems().join('\n')).toEqual([]);
  });

  test('(d) screens in English and Arabic (RTL), and at 390px without horizontal page scroll', async ({ page }) => {
    const problems = watchConsole(page);
    await loginAs(page, PERSONAS.pm);
    await setSavedLocale(page, 'en');
    for (const [tab, testId, shot] of [
      ['reconciliation', 'reconciliation', 'perimeter-reconciliation-en.png'],
      ['day1', 'day1-positions', 'perimeter-day1-en.png'],
      ['transfers', 'transfers-history', 'perimeter-transfers-en.png'],
      ['agreements', 'agreements', 'perimeter-agreements-en.png'],
      ['consents', 'consents', 'perimeter-consents-en.png'],
    ] as const) {
      await page.goto(`/projects/${dcId}/perimeter?tab=${tab}`);
      await expect(page.getByTestId(testId)).toBeVisible();
      await page.screenshot({ path: join(SHOTS, shot), fullPage: true });
    }

    try {
      await setSavedLocale(page, 'ar');
      await page.goto(`/projects/${dcId}/perimeter?tab=reconciliation`);
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByRole('tab', { name: 'المطابقة' })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByTestId('reconciliation')).toBeVisible();
      await page.screenshot({ path: join(SHOTS, 'perimeter-reconciliation-ar.png'), fullPage: true });
      await page.goto(`/projects/${dcId}/newco`);
      await expect(page.getByRole('tab', { name: 'الكيانات القانونية والتأسيس' })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByTestId('entities-table')).toBeVisible();
      await page.screenshot({ path: join(SHOTS, 'newco-ar.png'), fullPage: true });

      await page.setViewportSize({ width: 390, height: 844 });
      for (const [path, testId, shot] of [
        [`/projects/${dcId}/perimeter`, 'perimeter-table', 'perimeter-register-ar-390.png'],
        [`/projects/${dcId}/newco?tab=requirements`, 'requirements-table', 'newco-requirements-ar-390.png'],
      ] as const) {
        await page.goto(path);
        await expect(page.getByTestId(testId)).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `no horizontal page scroll at 390px on ${path}`).toBeLessThanOrEqual(0);
        await page.screenshot({ path: join(SHOTS, shot), fullPage: true });
      }
      await page.goto(`/projects/${dcId}/newco`);
      await page.getByTestId('entities-table').getByRole('link', { name: NEWCO }).click();
      await page.waitForURL(/\/newco\/entities\/[0-9a-f-]+$/);
      await expect(page.getByTestId('incorporation')).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, 'no horizontal page scroll at 390px on the entity page').toBeLessThanOrEqual(0);
      await page.screenshot({ path: join(SHOTS, 'newco-entity-ar-390.png'), fullPage: true });

      await setSavedLocale(page, 'en');
      await page.goto(`/projects/${dcId}/perimeter`);
      await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
      await expect(page.getByTestId('perimeter-table')).toBeVisible();
      const overflowEn = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflowEn, 'no horizontal page scroll at 390px (en)').toBeLessThanOrEqual(0);
      await page.screenshot({ path: join(SHOTS, 'perimeter-register-en-390.png'), fullPage: true });
    } finally {
      await setSavedLocale(page, 'en');
    }
    expect(problems(), problems().join('\n')).toEqual([]);
  });
});
