import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';
import { loginAs, watchConsole } from './helpers';
import { checkArabic, checkDialogA11y, watchBilingual } from './qa-rtl-detector';

/**
 * P6 imports, integrations and notifications (spec §17, screen 16b imports / integrations parts) against the real API and
 * worker, driven through the UI:
 *  - the import wizard happy path (REQ-INT-001..003, REQ-INT-015): a CSV of risks is uploaded, parsed in the isolated
 *    parser, mapped (automatic suggestion), previewed and submitted by the secretary / CPMO, who cannot approve it; the
 *    project manager (a second person whose own authority covers new risks) approves it; the risks are created, linked to
 *    the batch, and the uploader is notified in-app (bell + inbox, REQ-PLT-008);
 *  - refusals: a workbook declaring XML entities is refused by the parser without disrupting the service (REQ-SEC-015), and
 *    an integration endpoint on the cloud-metadata address is refused by the egress guard (REQ-SEC-014); every connector is
 *    shown with its honest status (nothing "Verified" without a real check — REQ-INT-013/014, REQ-UX-020);
 *  - the Arabic screens and dialogs pass the untranslated-text detector and axe (WCAG 2.0/2.1 A + AA, serious / critical).
 * All data is synthetic (Demo sandbox); the uploaded files are built here.
 */
const SHOTS = join(__dirname, '..', 'screenshots', 'p6-imports');
mkdirSync(SHOTS, { recursive: true });

const PM = 'Demo Project Manager';
const SECRETARY = 'Demo Secretary / CPMO';
const PLATFORM_ADMIN = 'Demo Platform Admin';
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const UUID = /\/reports\/imports\/[0-9a-f-]{36}$/;

async function dcId(page: Page): Promise<string> {
  const res = await page.request.get('/api/v1/projects?pageSize=100&q=DEMO-DC');
  expect(res.ok()).toBeTruthy();
  const p = ((await res.json()) as { items: { id: string; code: string }[] }).items.find((x) => x.code === 'DEMO-DC');
  expect(p, 'DEMO-DC visible').toBeTruthy();
  return p!.id;
}

async function asPersona(browser: Browser, baseURL: string, persona: string, locale: 'en' | 'ar') {
  const context = await browser.newContext();
  const page = await context.newPage();
  const problems = watchConsole(page);
  await loginAs(page, persona);
  await context.addCookies([{ name: 'hub_locale', value: locale, url: baseURL }]);
  return { page, problems, close: () => context.close() };
}

async function axe(page: Page, name: string) {
  await expect(page.getByTestId('loading-state')).toHaveCount(0);
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  const gating = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  console.log(`[${name}] axe: ${results.violations.length} WCAG violation(s) (${gating.length} serious/critical), ${results.passes.length} rules passed`);
  expect(gating.map((v) => `${v.impact} ${v.id} ×${v.nodes.length}: ${v.help}`), `${name}: serious/critical WCAG violations`).toEqual([]);
}

async function shot(page: Page, file: string) {
  const toastButtons = page.getByRole('status').getByRole('button');
  while ((await toastButtons.count()) > 0) await toastButtons.first().click();
  await expect(page.getByTestId('loading-state')).toHaveCount(0);
  await page.screenshot({ path: join(SHOTS, file), fullPage: true });
}

const csv = (rows: (string | number)[][]) => Buffer.from(rows.map((r) => r.map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(',')).join('\r\n') + '\r\n', 'utf8');

/** A minimal Office Open XML workbook whose shared strings declare XML entities (billion laughs + external entity). */
function entityWorkbook(): Buffer {
  const entries = [
    { name: '[Content_Types].xml', data: '<Types/>' },
    { name: 'xl/workbook.xml', data: '<workbook xmlns:r="r"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: 'xl/sharedStrings.xml', data: '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;"><!ENTITY xxe SYSTEM "file:///etc/passwd">]><sst><si><t>&lol2;&xxe;</t></si></sst>' },
    { name: 'xl/worksheets/sheet1.xml', data: '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>' },
  ];
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = Buffer.from(e.data, 'utf8');
    const data = deflateRawSync(raw);
    const name = Buffer.from(e.name, 'utf8');
    const crc = crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** Upload a file from the wizard's form; returns the batch id once the batch page is open. */
async function uploadFromScreen(page: Page, target: string, file: { name: string; mimeType: string; buffer: Buffer }): Promise<string> {
  await page.getByTestId(`import-target-${target}`).check();
  await page.getByTestId('import-file').setInputFiles(file);
  await page.getByTestId('import-upload').click();
  await page.waitForURL(UUID);
  return page.url().split('/').pop()!;
}

test.describe('P6 imports, integrations and notifications — wizard, refusals and honest status, in English and Arabic', () => {
  test.describe.configure({ timeout: 240_000 });

  test('Import wizard happy path (en): CSV of risks uploaded, mapped, previewed and submitted; the uploader cannot approve; a second person approves; risks created and linked; the uploader is notified in-app', async ({ browser, baseURL }) => {
    const stamp = Date.now().toString(36);
    const titles = [`E2E imported risk A ${stamp}`, `E2E imported risk B ${stamp}`];
    // The secretary / CPMO (PMO) uploads; the project manager — whose own authority covers new risks — approves.
    const up = await asPersona(browser, baseURL!, SECRETARY, 'en');
    let batchId = '';
    let code = '';
    let pid = '';
    try {
      const page = up.page;
      pid = await dcId(page);
      await page.goto(`/projects/${pid}/reports/imports`);
      await expect(page.getByRole('heading', { level: 1, name: 'Imports' })).toBeVisible();
      await expect(page.getByTestId('reports-tabs').locator('[data-tab="imports"]')).toHaveAttribute('aria-current', 'page');
      // Honest pipeline description: no OCR configured, formulas never evaluated, second-person approval.
      await expect(page.getByTestId('honesty-ocr')).toContainText('Not configured');
      await axe(page, 'imports (en)');
      await shot(page, 'en-imports.png');

      batchId = await uploadFromScreen(page, 'risk', {
        name: `risks-${stamp}.csv`,
        mimeType: 'text/csv',
        buffer: csv([
          ['Title', 'Description', 'Probability', 'Impact', 'Due date'],
          [titles[0]!, 'Synthetic e2e row', 3, 4, '2026-12-31'],
          [titles[1]!, 'Synthetic e2e row', 2, 2, ''],
        ]),
      });
      // Parsed by the worker in the isolated parser, then the mapping is offered with the automatic suggestion.
      const mapping = page.getByTestId('import-mapping');
      await expect(mapping).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('map-title')).toHaveValue('Title');
      await expect(page.getByTestId('map-probability')).toHaveValue('Probability');
      await expect(page.getByTestId('import-sha256')).toContainText(/[0-9a-f]{64}/);
      await expect(page.getByTestId('import-source-link')).toBeVisible();
      await axe(page, 'import mapping (en)');
      await page.getByTestId('import-validate').click();
      await expect(page.getByTestId('import-preview')).toBeVisible();
      await expect(page.getByTestId('import-count-create')).toHaveText('2');
      await expect(page.locator('[data-testid="import-row"][data-action="create"]')).toHaveCount(2);
      code = (await page.getByRole('heading', { level: 1 }).innerText()).split(' ')[0]!;
      expect(code).toMatch(/^IMP-/);
      await axe(page, 'import preview (en)');
      await shot(page, 'en-import-preview.png');

      // Submit; the uploader is never the approver (separation of duties).
      await page.getByTestId('import-submit').click();
      const submit = page.locator('dialog[open]');
      await checkDialogA11y(page, submit, 'submit dialog (en)');
      await submit.getByRole('button', { name: 'Submit for approval', exact: true }).click();
      await expect(submit).toHaveCount(0);
      await expect(page.getByTestId('import-approve')).toHaveCount(0);
      await expect(page.getByTestId('import-awaiting')).toHaveText('Submitted — waiting for approval by a second person.');
      expect(up.problems(), up.problems().join('\n')).toEqual([]);
    } finally {
      await up.close();
    }

    // A second person (the project manager) approves the accepted rows.
    const approver = await asPersona(browser, baseURL!, PM, 'en');
    try {
      const page = approver.page;
      await page.goto(`/projects/${pid}/reports/imports/${batchId}`);
      await expect(page.getByTestId('import-preview')).toBeVisible();
      await page.getByTestId('import-approve').click();
      const approve = page.locator('dialog[open]');
      await checkDialogA11y(page, approve, 'approve dialog (en)');
      await expect(approve).toContainText('2 rows will be applied.');
      await approve.getByRole('button', { name: 'Approve accepted rows', exact: true }).click();
      await expect(approve).toHaveCount(0);
      await expect(page.locator('[data-testid="import-output"][data-type="risk"]')).toHaveCount(2);
      await shot(page, 'en-import-applied.png');
      // The created risk opens from the batch and carries the imported title.
      await page.locator('[data-testid="import-output"][data-type="risk"]').first().getByRole('link').click();
      await expect(page).toHaveURL(/\/raid\/risks\/[0-9a-f-]{36}$/);
      await expect(page.getByRole('heading', { level: 1 })).toContainText(new RegExp(`E2E imported risk [AB] ${stamp}`));
      expect(approver.problems(), approver.problems().join('\n')).toEqual([]);
    } finally {
      await approver.close();
    }

    // The uploader is told the outcome in-app (outbox → worker → notification; recipient re-checked at delivery and read).
    const back = await asPersona(browser, baseURL!, SECRETARY, 'en');
    try {
      const page = back.page;
      await expect
        .poll(
          async () => {
            await page.goto('/notifications');
            await expect(page.getByTestId('loading-state')).toHaveCount(0);
            return page.locator('[data-testid="notification"][data-kind="import.decided"]', { hasText: code }).count();
          },
          { timeout: 60_000, intervals: [1000, 2000, 3000] },
        )
        .toBeGreaterThan(0);
      const item = page.locator('[data-testid="notification"][data-kind="import.decided"]', { hasText: code }).first();
      await expect(item).toContainText(`Your import ${code} was approved and applied`);
      await expect(page.getByTestId('notification-bell')).not.toHaveAttribute('data-unread', '0');
      await expect(page.locator('[data-testid="notification-channels"] [data-channel="email"]')).toHaveAttribute('data-status', 'not_configured');
      await axe(page, 'notifications (en)');
      await shot(page, 'en-notifications.png');
      await item.getByTestId('notification-open').click();
      await expect(page).toHaveURL(new RegExp(`/reports/imports/${batchId}$`));
      await expect(page.locator('[data-testid="import-output"]')).toHaveCount(2);
      expect(back.problems(), back.problems().join('\n')).toEqual([]);
    } finally {
      await back.close();
    }
  });

  test('REQ-SET-011 (en): setup wizard step 3 opens the import wizard; a status tracker becomes claims shown for review — after approval they are historical-unverified claims of the preserved source', async ({ browser, baseURL }) => {
    const stamp = Date.now().toString(36);
    const subjects = [`E2E tracker item A ${stamp}`, `E2E tracker item B ${stamp}`];
    const up = await asPersona(browser, baseURL!, PM, 'en');
    let pid = '';
    let batchId = '';
    try {
      const page = up.page;
      pid = await dcId(page);
      await page.goto(`/projects/${pid}/setup`);
      const step = page.locator('[data-testid="setup-step"][data-step="sources"]');
      await expect(step).toContainText('Sources and extracted claims');
      await step.getByRole('link').click();
      await expect(page).toHaveURL(new RegExp(`/projects/${pid}/reports/imports$`));
      batchId = await uploadFromScreen(page, 'source_claims', {
        name: `tracker-${stamp}.csv`,
        mimeType: 'text/csv',
        buffer: csv([
          ['Subject', 'Value', 'Location'],
          [subjects[0]!, 'Completed', 'Slide 3'],
          [subjects[1]!, 'On Track', 'Slide 4'],
        ]),
      });
      await expect(page.getByTestId('import-mapping')).toBeVisible({ timeout: 60_000 });
      await page.getByTestId('import-validate').click();
      const rows = page.locator('[data-testid="import-row"][data-action="create"]');
      await expect(rows).toHaveCount(2);
      await expect(rows.first()).toContainText('Becomes a claim in the source register for review; no record is changed');
      await page.getByTestId('import-submit').click();
      await page.locator('dialog[open]').getByRole('button', { name: 'Submit for approval', exact: true }).click();
      await expect(page.locator('dialog[open]')).toHaveCount(0);
      await shot(page, 'en-setup-claims-preview.png');
      expect(up.problems(), up.problems().join('\n')).toEqual([]);
    } finally {
      await up.close();
    }
    const approver = await asPersona(browser, baseURL!, SECRETARY, 'en');
    try {
      const page = approver.page;
      await page.goto(`/projects/${pid}/reports/imports/${batchId}`);
      await page.getByTestId('import-approve').click();
      await page.locator('dialog[open]').getByRole('button', { name: 'Approve accepted rows', exact: true }).click();
      await expect(page.locator('dialog[open]')).toHaveCount(0);
      await expect(page.locator('[data-testid="import-output"][data-type="source_claim"]')).toHaveCount(2);
      // The claims sit on the preserved source, for review — historical and unverified, no record changed.
      await page.getByTestId('import-source-link').click();
      await expect(page).toHaveURL(/\/documents\/sources\/[0-9a-f-]{36}$/);
      for (const s of subjects) await expect(page.locator(`[data-testid="claim-verification"][data-claim-subject="${s}"]`)).toContainText('Historical — unverified');
      await shot(page, 'en-setup-claims-source.png');
      expect(approver.problems(), approver.problems().join('\n')).toEqual([]);
    } finally {
      await approver.close();
    }
  });

  test('Refusals (en): a workbook declaring XML entities is refused by the isolated parser and the service keeps working; the egress guard refuses a metadata endpoint; no connector is shown Verified', async ({ browser, baseURL }) => {
    const pm = await asPersona(browser, baseURL!, PM, 'en');
    try {
      const page = pm.page;
      const pid = await dcId(page);
      await page.goto(`/projects/${pid}/reports/imports`);
      await uploadFromScreen(page, 'risk', { name: 'entities.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: entityWorkbook() });
      const failed = page.getByTestId('import-failed');
      await expect(failed).toBeVisible({ timeout: 60_000 });
      await expect(failed).toContainText('the file declares XML entities (refused)');
      await expect(page.getByTestId('import-mapping')).toHaveCount(0);
      await expect(page.getByTestId('import-actions')).toHaveCount(0);
      await shot(page, 'en-import-refused.png');
      // The service is not disrupted: the API still answers and the history lists the refused batch.
      await page.goto(`/projects/${pid}/reports/imports`);
      await expect(page.getByTestId('imports-table')).toHaveAttribute('data-state', 'ready');
      // Integrations tab of the project: honest status and the manual alternative for every unavailable connector.
      await page.goto(`/projects/${pid}/reports/integrations`);
      const items = page.getByTestId('integration');
      await expect(items).toHaveCount(11);
      await expect(page.locator('[data-testid="integration"][data-status="verified"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="integration"][data-key="m365_outlook_mail_send"]')).toContainText('Not configured');
      await expect(page.getByTestId('manual-alternative')).toHaveCount(11);
      await axe(page, 'integrations (en)');
      await shot(page, 'en-integrations.png');
      expect(pm.problems(), pm.problems().join('\n')).toEqual([]);
    } finally {
      await pm.close();
    }

    const admin = await asPersona(browser, baseURL!, PLATFORM_ADMIN, 'en');
    try {
      const page = admin.page;
      await page.goto('/admin?tab=integrations');
      await expect(page.getByTestId('integrations-admin')).toBeVisible();
      await page.getByTestId('configure-m365_outlook_mail_send').click();
      const dialog = page.locator('dialog[open]');
      await checkDialogA11y(page, dialog, 'configure dialog (en)');
      await dialog.getByTestId('int-endpoint').fill('https://169.254.169.254/latest/meta-data');
      await dialog.getByTestId('int-secret').fill('HUB_INTEGRATION_SECRET_E2E_ONLY');
      await page.getByTestId('configure-integration-submit').click();
      const refusal = dialog.getByTestId('refusal-explanation');
      await expect(refusal).toHaveAttribute('data-code', 'egress.internal_address');
      await expect(refusal).toContainText('refused by the egress guard');
      await shot(page, 'en-integration-refused.png');
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(page.locator('[data-testid="integration"][data-key="m365_outlook_mail_send"]')).toHaveAttribute('data-status', 'not_configured');
      // The refusal is in the connector's execution log.
      await page.getByTestId('logs-m365_outlook_mail_send').click();
      await expect(page.getByTestId('integration-logs')).toContainText('egress.internal_address');
      await axe(page, 'admin integrations (en)');
      expect(admin.problems(), admin.problems().join('\n')).toEqual([]);
    } finally {
      await admin.close();
    }
  });

  test('Arabic (ar): import wizard, preview, refusal, notifications and integrations pass the RTL detector and axe', async ({ browser, baseURL }, testInfo) => {
    const pm = await asPersona(browser, baseURL!, PM, 'ar');
    const bilingual = watchBilingual(pm.page);
    try {
      const page = pm.page;
      const pid = await dcId(page);
      await page.goto(`/projects/${pid}/reports/imports`);
      await expect(page.getByRole('heading', { level: 1, name: 'الاستيراد' })).toBeVisible();
      await checkArabic(page, testInfo, SHOTS, 'imports', bilingual);
      await axe(page, 'imports (ar)');

      // Arabic headers are recognised by the automatic mapping.
      const stamp = Date.now().toString(36);
      await uploadFromScreen(page, 'risk', {
        name: `مخاطر-${stamp}.csv`,
        mimeType: 'text/csv',
        buffer: csv([
          ['العنوان', 'الوصف', 'الاحتمالية', 'الأثر'],
          [`مخاطرة تجريبية ${stamp}`, 'صف تجريبي', 3, 3],
          ['', 'صف بلا عنوان', 9, 1],
        ]),
      });
      await expect(page.getByTestId('import-mapping')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('map-title')).toHaveValue('العنوان');
      await checkArabic(page, testInfo, SHOTS, 'import-mapping', bilingual);
      await page.getByTestId('import-validate').click();
      await expect(page.getByTestId('import-preview')).toBeVisible();
      await expect(page.getByTestId('import-count-error')).toHaveText('1');
      await expect(page.locator('[data-testid="import-row"][data-action="error"]')).toContainText('العنوان مطلوب');
      await checkArabic(page, testInfo, SHOTS, 'import-preview', bilingual);
      await axe(page, 'import preview (ar)');
      await page.getByTestId('import-submit').click();
      const submit = page.locator('dialog[open]');
      await checkDialogA11y(page, submit, 'submit dialog (ar)');
      await checkArabic(page, testInfo, SHOTS, 'import-submit-dialog', bilingual, { scope: submit });
      await page.keyboard.press('Escape');
      await expect(submit).toHaveCount(0);
      // Cancel the batch (nothing is applied).
      await page.getByTestId('import-cancel').click();
      await page.locator('dialog[open]').getByRole('button', { name: 'إلغاء الدفعة', exact: true }).click();
      await expect(page.locator('dialog[open]')).toHaveCount(0);
      await expect(page.getByTestId('import-actions')).toHaveCount(0);

      // Refusal by the parser, explained in Arabic.
      await page.goto(`/projects/${pid}/reports/imports`);
      await uploadFromScreen(page, 'risk', { name: 'entities.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: entityWorkbook() });
      await expect(page.getByTestId('import-failed')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('import-failed')).toContainText('يعرّف الملف كيانات XML (مرفوض)');
      await checkArabic(page, testInfo, SHOTS, 'import-refused', bilingual);
      await axe(page, 'import refused (ar)');

      await page.goto('/notifications');
      await expect(page.getByRole('heading', { level: 1, name: 'الإشعارات' })).toBeVisible();
      await checkArabic(page, testInfo, SHOTS, 'notifications', bilingual);
      await axe(page, 'notifications (ar)');

      await page.goto(`/projects/${pid}/reports/integrations`);
      await expect(page.getByTestId('integration-list')).toBeVisible();
      await expect(page.locator('[data-testid="integration"][data-key="m365_teams_message_send"]')).toContainText('غير مُهيّأ');
      await checkArabic(page, testInfo, SHOTS, 'integrations', bilingual);
      await axe(page, 'integrations (ar)');
      expect(pm.problems(), pm.problems().join('\n')).toEqual([]);
    } finally {
      await pm.close();
    }
  });
});
