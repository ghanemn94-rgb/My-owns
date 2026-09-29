import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { PERSONAS, apiSessionAs, loginAs, setSavedLocale, watchConsole } from './helpers';

/**
 * P2 — Document & Evidence Center (spec §10 screen 13). Runs against a stack with the demo seed:
 *   upload → new version → link as evidence → verification by a different person (separation of duties),
 *   project isolation (project B sees nothing of project A), AT-01 display of historical claims,
 *   and bilingual/mobile screenshots.
 */
const SHOTS = join(__dirname, '..', 'screenshots');
const FINANCE = 'Demo Finance Member';
const RUN = Date.now().toString(36);

async function dcProjectId(baseURL: string): Promise<string> {
  const pmApi = await apiSessionAs(baseURL, PERSONAS.pm);
  const list = await (await pmApi.get('/api/v1/projects')).json();
  await pmApi.dispose();
  const dc = (list.items as { id: string; code: string }[]).find((p) => p.code === 'DEMO-DC');
  expect(dc, 'DEMO-DC visible to the Demo Project Manager').toBeTruthy();
  return dc!.id;
}

async function uploadFile(page: Page, name: string, mimeType: string, content: string) {
  await page.getByTestId('upload-input').setInputFiles({ name, mimeType, buffer: Buffer.from(content, 'utf8') });
  await expect(page.getByTestId('upload-precheck-error')).toHaveCount(0);
  await page.getByTestId('upload-start').click();
}

test.describe('P2 Document & Evidence Center', () => {
  test('(a) upload → new version → evidence link → verification by another person', async ({ page, baseURL }) => {
    const problems = watchConsole(page);
    const dcId = await dcProjectId(baseURL!);
    await loginAs(page, PERSONAS.pm);
    await setSavedLocale(page, 'en');
    await page.goto(`/projects/${dcId}/documents`);
    await expect(page.getByRole('heading', { level: 1, name: 'Document & Evidence Center' })).toBeVisible();
    const table = page.getByTestId('documents-table');
    await expect(table.getByRole('link', { name: 'Demo — charter excerpt' })).toBeVisible();
    // The restricted finance note exists but is above the PM's clearance: never listed.
    await expect(table.getByText('Demo — restricted finance note')).toHaveCount(0);
    await expect(page.getByTestId('scan-notice')).toContainText('not certified clean');

    // Create a document, then upload two versions with progress.
    const title = `E2E evidence memo ${RUN} (synthetic)`;
    await page.getByTestId('document-create').click();
    await page.getByTestId('create-title').fill(title);
    await page.getByRole('button', { name: 'Create document' }).click();
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();

    // Client-side pre-check: a file type outside the allowlist cannot be sent.
    await page.getByTestId('upload-input').setInputFiles({ name: 'tool.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') });
    await expect(page.getByTestId('upload-precheck-error')).toContainText('not accepted');
    await expect(page.getByTestId('upload-start')).toBeDisabled();

    await uploadFile(page, 'memo-v1.txt', 'text/plain', 'Synthetic E2E memo, version 1. DEMO content only.');
    const versions = page.getByTestId('versions-table');
    await expect(versions.getByRole('rowheader', { name: /v1/ })).toBeVisible();
    await expect(versions).toContainText('Not scanned');
    await uploadFile(page, 'memo-v2.md', 'text/markdown', '# Memo\n\nSynthetic E2E memo, version 2.');
    await expect(versions.getByRole('rowheader', { name: /v2.*Current/ })).toBeVisible();
    await expect(versions.getByTestId('version-download')).toHaveCount(2);

    // Link the current version as evidence to a task chosen with the record picker.
    await page.getByTestId('doc-link-evidence').click();
    const picker = page.getByTestId('evidence-target-picker');
    const option = picker.getByTestId('evidence-target-option').first();
    await expect(option).toBeVisible();
    const taskCode = (await option.locator('span').first().innerText()).trim();
    await option.click();
    await page.getByRole('button', { name: 'Link evidence' }).click();
    await expect(page.getByTestId('doc-evidence-counts')).toHaveText('1 active · 0 conflicting');
    await page.screenshot({ path: join(SHOTS, 'documents-detail-en.png'), fullPage: true });

    // The linker cannot verify (no permission, and never for their own link).
    await page.goto(`/projects/${dcId}/documents?tab=evidence`);
    await page.getByTestId('evidence-target-picker').getByRole('searchbox').fill(taskCode);
    await page.getByTestId('evidence-target-option').filter({ hasText: taskCode }).first().click();
    const link = page.getByTestId('evidence-link').filter({ hasText: title });
    await expect(link).toHaveAttribute('data-status', 'active');
    await expect(link.getByTestId('evidence-verify')).toHaveCount(0);
    const evidenceUrl = page.url();

    // A different person with verification rights verifies it.
    await page.context().clearCookies();
    await loginAs(page, FINANCE);
    await page.goto(evidenceUrl);
    const flink = page.getByTestId('evidence-link').filter({ hasText: title });
    await expect(flink).toContainText('Not yet verified');
    await flink.getByTestId('evidence-verify').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Verify' }).click();
    await expect(flink).toContainText('Reviewed');
    await expect(flink).toHaveAttribute('data-status', 'active');
    await expect(flink.getByTestId('evidence-verify')).toHaveCount(0);
    await page.screenshot({ path: join(SHOTS, 'documents-evidence-en.png'), fullPage: true });
    expect(problems(), problems().join('\n')).toEqual([]);
  });

  test('(b) project B sees nothing of project A documents, evidence or sources', async ({ page, baseURL }) => {
    const problems = watchConsole(page);
    const dcId = await dcProjectId(baseURL!);
    const pmApi = await apiSessionAs(baseURL!, PERSONAS.pm);
    const docs = await (await pmApi.get(`/api/v1/projects/${dcId}/documents?q=charter`)).json();
    const sources = await (await pmApi.get(`/api/v1/projects/${dcId}/sources`)).json();
    await pmApi.dispose();
    const charter = (docs.items as { id: string; title: string }[]).find((d) => d.title === 'Demo — charter excerpt')!;
    const source = (sources.items as { id: string }[])[0]!;

    await loginAs(page, PERSONAS.pmB);
    for (const path of [`/projects/${dcId}/documents`, `/projects/${dcId}/documents/${charter.id}`, `/projects/${dcId}/documents/sources/${source.id}`, `/projects/${dcId}/documents?tab=evidence`]) {
      await page.goto(path);
      await expect(page.getByTestId('restricted-state')).toBeVisible();
      await expect(page.getByText('Demo — charter excerpt')).toHaveCount(0);
      await expect(page.getByText(/IMG_B65D893D/)).toHaveCount(0);
    }
    // Project B's own center searches only its own documents.
    const list = await (await apiSessionAs(baseURL!, PERSONAS.pmB)).get('/api/v1/projects').then((r) => r.json());
    const genId = (list.items as { id: string; code: string }[]).find((p) => p.code === 'DEMO-TRANSFORM')!.id;
    await page.goto(`/projects/${genId}/documents`);
    await expect(page.getByRole('heading', { level: 1, name: 'Document & Evidence Center' })).toBeVisible();
    await page.getByRole('searchbox').first().fill('charter');
    await expect(page.getByText('No visible document matches.')).toBeVisible();
    await expect(page.getByText('Demo — charter excerpt')).toHaveCount(0);
    expect(problems(), problems().join('\n')).toEqual([]);
  });

  test('(c) AT-01: historical claims are shown as historical-unverified and cannot be confirmed', async ({ page, baseURL }) => {
    const problems = watchConsole(page);
    const dcId = await dcProjectId(baseURL!);
    await loginAs(page, FINANCE);
    await page.goto(`/projects/${dcId}/documents?tab=sources`);
    await page.getByTestId('sources-table').getByTestId('source-link').first().click();
    await expect(page.getByTestId('source-extraction-note')).toContainText('not available');
    await expect(page.getByTestId('historical-notice')).toBeVisible();
    const clm9 = page.locator('[data-testid="claim-verification"][data-claim-subject^="CLM-009"]');
    await expect(clm9).toContainText('Historical');
    await expect(clm9).toContainText('never applied');
    // Reviewing a historical claim never offers "Confirmed".
    const row = page.getByTestId('claims-table').getByRole('row').filter({ has: clm9 });
    await row.getByTestId('claim-review').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('combobox').first().locator('option[value="confirmed"]')).toHaveCount(0);
    await expect(dialog).toContainText('cannot be confirmed as current');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('compare-table')).toContainText('Not applied');
    await page.screenshot({ path: join(SHOTS, 'documents-source-register-en.png'), fullPage: true });
    expect(problems(), problems().join('\n')).toEqual([]);
  });

  test('(d) bilingual and mobile screenshots of the center', async ({ page, baseURL }) => {
    const problems = watchConsole(page);
    const dcId = await dcProjectId(baseURL!);
    await loginAs(page, PERSONAS.pm);
    try {
      await setSavedLocale(page, 'en');
      await page.goto(`/projects/${dcId}/documents`);
      await expect(page.getByTestId('documents-table').getByRole('link', { name: 'Demo — charter excerpt' })).toBeVisible();
      await page.screenshot({ path: join(SHOTS, 'documents-en.png'), fullPage: true });

      await setSavedLocale(page, 'ar');
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByRole('heading', { level: 1, name: 'مركز المستندات والأدلة' })).toBeVisible();
      await expect(page.getByTestId('documents-table').getByTestId('demo-badge').first()).toBeVisible();
      await page.screenshot({ path: join(SHOTS, 'documents-ar.png'), fullPage: true });

      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload();
      await expect(page.getByRole('heading', { level: 1, name: 'مركز المستندات والأدلة' })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, 'no horizontal page scroll at 390px').toBeLessThanOrEqual(1);
      await page.screenshot({ path: join(SHOTS, 'documents-ar-mobile.png'), fullPage: true });

      await setSavedLocale(page, 'en');
      await page.reload();
      await page.getByTestId('documents-table').getByRole('link', { name: 'Demo — charter excerpt' }).click();
      await expect(page.getByTestId('versions-table')).toBeVisible();
      const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow2, 'no horizontal page scroll at 390px (detail)').toBeLessThanOrEqual(1);
      await page.screenshot({ path: join(SHOTS, 'documents-en-mobile.png'), fullPage: true });
    } finally {
      await setSavedLocale(page, 'en');
    }
    expect(problems(), problems().join('\n')).toEqual([]);
  });
});
