import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { loginAs, watchConsole } from './helpers';
import { checkArabic, checkDialogA11y, watchBilingual } from './qa-rtl-detector';

/**
 * P6 Reports screen (spec §10 screen 16b, reports part; §11) against the real API and worker, driven through the UI:
 *  - AT-24 in English and in Arabic: the committee pack and the minutes are generated from the Reports screen; every figure
 *    on the screen equals the frozen snapshot; the files are requested from the screen, rendered by the worker, downloaded
 *    from the screen and are genuine files (PDF signature; OOXML packages whose main part is present, with right-to-left
 *    markup in Arabic and the snapshot's figures / labels inside);
 *  - the Arabic screens and dialogs pass the untranslated-text detector (qa-rtl-detector.ts) and axe (WCAG 2.0/2.1 A + AA,
 *    gating on serious / critical), and so do the English ones;
 *  - a contributor (snapshot reader without export) sees the list and a snapshot but is offered no export.
 * The demo project's records are synthetic (badged Demo); the reports are computed from them — nothing is typed in.
 */
const SHOTS = join(__dirname, '..', 'screenshots', 'p6');
mkdirSync(SHOTS, { recursive: true });
const DOWNLOADS = join(__dirname, '..', 'test-results', 'p6-downloads');
mkdirSync(DOWNLOADS, { recursive: true });

const MESSAGES = join(__dirname, '..', '..', 'apps', 'web', 'src', 'i18n', 'messages');
const CONTENT = {
  en: JSON.parse(readFileSync(join(MESSAGES, 'en', 'reports.json'), 'utf8')).content as { sections: Record<string, unknown> },
  ar: JSON.parse(readFileSync(join(MESSAGES, 'ar', 'reports.json'), 'utf8')).content as { sections: Record<string, unknown> },
};
/** Section title as printed in the files (= the screen catalogue; keys may be dotted, e.g. kpis.planning). */
const sectionTitle = (locale: 'en' | 'ar', key: string) => key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], CONTENT[locale].sections) as string;
/** Text of OOXML runs (<a:t> in slides, <w:t> in Word), joined. */
const runText = (xml: string) => [...xml.matchAll(/<(?:a|w):t(?:\s[^>]*)?>([^<]*)<\/(?:a|w):t>/g)].map((m) => m[1]).join('').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");

const PM = 'Demo Project Manager';
const CONTRIBUTOR = 'Demo Contributor';
const SPONSOR = 'Demo Sponsor';
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

type Figure = { key: string; value: number | null };
type Section = { key: string; included: boolean; figures: Figure[]; tables: { key: string; rows: Record<string, unknown>[] }[] };
type Snapshot = { id: string; kind: string; contentHash: string; sections: Section[]; canExport: boolean };

async function get<T>(ctx: APIRequestContext, path: string): Promise<T> {
  const res = await ctx.get(path);
  expect(res.ok(), `GET ${path} → HTTP ${res.status()}`).toBeTruthy();
  return (await res.json()) as T;
}

async function dcId(page: Page): Promise<string> {
  const list = await get<{ items: { id: string; code: string }[] }>(page.request, '/api/v1/projects?pageSize=100&q=DEMO-DC');
  const p = list.items.find((x) => x.code === 'DEMO-DC');
  expect(p, 'DEMO-DC visible').toBeTruthy();
  return p!.id;
}

async function asPersona(browser: Browser, baseURL: string, persona: string, locale: 'en' | 'ar') {
  const context = await browser.newContext({ acceptDownloads: true });
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

/** Minimal ZIP reader (central directory + raw inflate) — independent of the renderers that wrote the file. */
function unzip(buf: Buffer): Map<string, Buffer> {
  expect(buf.readUInt32LE(0), 'ZIP local file header').toBe(0x04034b50);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  expect(eocd, 'ZIP end of central directory').toBeGreaterThan(0);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    out.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Visible figures of the snapshot (included sections, not KPI sections) as rendered on the screen. */
async function expectFiguresMatch(page: Page, snap: Snapshot) {
  let checked = 0;
  for (const s of snap.sections) {
    const sec = page.locator(`[data-testid="report-section"][data-section="${s.key}"]`);
    await expect(sec, `section ${s.key}`).toHaveAttribute('data-included', String(s.included));
    if (!s.included || s.key.startsWith('kpis.')) continue;
    for (const f of s.figures) {
      await expect(sec.locator(`[data-testid="report-figure"][data-key="${f.key}"]`), `${s.key}.${f.key}`).toHaveAttribute('data-value', f.value === null ? '' : String(f.value));
      checked++;
    }
    for (const t of s.tables) await expect(sec.locator(`[data-testid="report-table"][data-table="${t.key}"]`), `${s.key} table ${t.key}`).toHaveAttribute('data-rows', String(t.rows.length));
  }
  return checked;
}

/** Request a file from the screen, wait for the worker, download it from the screen; returns its bytes. */
async function exportFromScreen(page: Page, format: 'pdf' | 'pptx' | 'docx' | 'xlsx', locale: 'en' | 'ar', opts: { a11y?: boolean; arabicCheck?: () => Promise<unknown> } = {}): Promise<Buffer> {
  await page.getByTestId('export-report-open').click();
  const dialog = page.locator('dialog[open]');
  if (opts.a11y) await checkDialogA11y(page, dialog, `export dialog (${locale})`);
  if (opts.arabicCheck) await opts.arabicCheck();
  await page.getByTestId(`export-format-${format}`).check();
  await page.getByTestId(`export-locale-${locale}`).check();
  await page.getByTestId('export-report-submit').click();
  await expect(dialog).toHaveCount(0);
  const row = page.locator(`[data-testid="export-status"][data-format="${format}"][data-locale="${locale}"]`).first();
  await expect(row, `${format}/${locale} rendered by the worker`).toHaveAttribute('data-status', 'ready', { timeout: 90_000 });
  const link = page.getByTestId('exports-table').locator('tr', { has: row }).getByTestId('export-download');
  const href = await link.getAttribute('href');
  // The same URL through the API: attachment, no-sniff, the declared content type of the format.
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()['x-content-type-options']).toBe('nosniff');
  expect(res.headers()['content-disposition']).toMatch(new RegExp(`attachment;.*-${locale}\\.${format}`));
  const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
  const file = join(DOWNLOADS, `${Date.now()}-${download.suggestedFilename()}`);
  await download.saveAs(file);
  expect(download.suggestedFilename()).toMatch(new RegExp(`-${locale}\\.${format}$`));
  const bytes = readFileSync(file);
  expect(bytes.equals(await res.body()), 'the downloaded file is the stored file').toBe(true);
  return bytes;
}

test.describe('P6 Reports screen — AT-24 committee pack and minutes from the screen, in English and Arabic', () => {
  test.describe.configure({ timeout: 240_000 });

  test('AT-24 (en): committee pack generated from the Reports screen; screen figures equal the snapshot; PPTX and PDF exported and downloaded as genuine files', async ({ browser, baseURL }) => {
    const { page, problems, close } = await asPersona(browser, baseURL!, PM, 'en');
    try {
      const pid = await dcId(page);
      await page.goto(`/projects/${pid}/reports`);
      await expect(page.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible();
      await expect(page.getByTestId('reports-table')).toHaveAttribute('data-state', /ready|empty/);
      await axe(page, 'reports list (en)');
      await shot(page, 'en-reports-list.png');

      await page.getByTestId('generate-report-open').click();
      await checkDialogA11y(page, page.locator('dialog[open]'), 'generate dialog (en)');
      await page.getByTestId('report-kind').selectOption('committee_pack');
      await shot(page, 'en-generate-dialog.png');
      await page.getByTestId('generate-report-submit').click();
      await page.waitForURL(/\/reports\/[0-9a-f-]{36}$/);
      const detail = page.getByTestId('report-detail');
      await expect(detail).toHaveAttribute('data-kind', 'committee_pack');
      const id = page.url().split('/').pop()!;
      const snap = await get<Snapshot>(page.request, `/api/v1/projects/${pid}/report-snapshots/${id}`);
      await expect(detail).toHaveAttribute('data-hash', snap.contentHash);
      await expect(page.getByTestId('meta-hash')).toHaveText(snap.contentHash);
      await expect(page.getByTestId('integrity')).toHaveAttribute('data-integrity', 'verified');
      await expect(page.getByTestId('demo-badge').first()).toBeVisible();
      const figures = await expectFiguresMatch(page, snap);
      expect(figures, 'figures compared on the screen').toBeGreaterThan(5);
      await axe(page, 'report snapshot (en)');
      await shot(page, 'en-report-committee-pack.png');

      const pptx = unzip(await exportFromScreen(page, 'pptx', 'en', { a11y: true }));
      expect(pptx.has('ppt/presentation.xml')).toBe(true);
      const slides = [...pptx.keys()].filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k));
      expect(slides.length).toBeGreaterThan(3);
      const deck = slides.map((k) => pptx.get(k)!.toString('utf8')).join('\n');
      const deckText = runText(deck);
      for (const sec of snap.sections) expect(deckText, `section ${sec.key}`).toContain(sectionTitle('en', sec.key));
      for (const r of snap.sections.find((x) => x.key === 'decisions')?.tables[0]?.rows ?? []) expect(deckText, `decision ${String(r.code)}`).toContain(String(r.code));
      expect(deck).not.toMatch(/rtl="1"/);
      const pdf = await exportFromScreen(page, 'pdf', 'en');
      expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      await shot(page, 'en-report-exports.png');
      expect(problems(), problems().join('\n')).toEqual([]);
    } finally {
      await close();
    }
  });

  test('AT-24 (ar): Arabic Reports screens and dialogs pass the RTL detector and axe; committee pack PPTX and minutes DOCX exported in Arabic, right to left', async ({ browser, baseURL }, testInfo) => {
    const { page, problems, close } = await asPersona(browser, baseURL!, PM, 'ar');
    const bilingual = watchBilingual(page);
    try {
      const pid = await dcId(page);
      await page.goto(`/projects/${pid}/reports`);
      await expect(page.getByRole('heading', { level: 1, name: 'التقارير' })).toBeVisible();
      await checkArabic(page, testInfo, SHOTS, 'reports-list', bilingual);
      await axe(page, 'reports list (ar)');

      // Committee pack (PPTX, Arabic)
      await page.getByTestId('generate-report-open').click();
      const gen = page.locator('dialog[open]');
      await checkDialogA11y(page, gen, 'generate dialog (ar)');
      await page.getByTestId('report-kind').selectOption('committee_pack');
      await checkArabic(page, testInfo, SHOTS, 'generate-dialog', bilingual, { scope: gen });
      await page.getByTestId('generate-report-submit').click();
      await page.waitForURL(/\/reports\/[0-9a-f-]{36}$/);
      await expect(page.getByTestId('report-detail')).toHaveAttribute('data-kind', 'committee_pack');
      const packId = page.url().split('/').pop()!;
      const pack = await get<Snapshot>(page.request, `/api/v1/projects/${pid}/report-snapshots/${packId}`);
      expect(await expectFiguresMatch(page, pack)).toBeGreaterThan(5);
      await checkArabic(page, testInfo, SHOTS, 'report-committee-pack', bilingual);
      await axe(page, 'report snapshot (ar)');
      const exportDialogArabic = () => checkArabic(page, testInfo, SHOTS, 'export-dialog', bilingual, { scope: page.locator('dialog[open]') });
      const pptx = unzip(await exportFromScreen(page, 'pptx', 'ar', { a11y: true, arabicCheck: exportDialogArabic }));
      const slides = [...pptx.keys()].filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k)).map((k) => pptx.get(k)!.toString('utf8'));
      expect(slides.length).toBeGreaterThan(3);
      expect(pptx.get('ppt/presentation.xml')!.toString('utf8')).toMatch(/<p:presentation[^>]* rtl="1"/);
      expect(slides.join('\n')).toMatch(/<a:pPr[^>]*rtl="1"/);
      const deckText = runText(slides.join('\n'));
      expect(deckText).toContain('حزمة اللجنة');
      for (const sec of pack.sections) expect(deckText, `section ${sec.key}`).toContain(sectionTitle('ar', sec.key));
      await checkArabic(page, testInfo, SHOTS, 'report-exports', bilingual);

      // Minutes (DOCX, Arabic) of a demo meeting
      await page.goto(`/projects/${pid}/reports`);
      await page.getByTestId('generate-report-open').click();
      await page.getByTestId('report-kind').selectOption('minutes');
      const meeting = page.getByTestId('report-meeting');
      await expect(meeting.locator('option')).not.toHaveCount(1);
      await meeting.selectOption({ index: 1 });
      await page.getByTestId('generate-report-submit').click();
      await page.waitForURL(/\/reports\/[0-9a-f-]{36}$/);
      await expect(page.getByTestId('report-detail')).toHaveAttribute('data-kind', 'minutes');
      const minutesId = page.url().split('/').pop()!;
      const minutes = await get<Snapshot>(page.request, `/api/v1/projects/${pid}/report-snapshots/${minutesId}`);
      await expectFiguresMatch(page, minutes);
      await checkArabic(page, testInfo, SHOTS, 'report-minutes', bilingual);
      const docx = unzip(await exportFromScreen(page, 'docx', 'ar'));
      expect(docx.has('[Content_Types].xml')).toBe(true);
      const body = docx.get('word/document.xml')!.toString('utf8');
      expect(body).toContain('<w:bidi/>');
      expect(body).toContain('<w:rtl/>');
      const bodyText = runText(body);
      for (const sec of minutes.sections) expect(bodyText, `section ${sec.key}`).toContain(sectionTitle('ar', sec.key));
      // Every decision code of the minutes is printed in the file.
      const decisions = minutes.sections.find((x) => x.key === 'minutes_decisions');
      for (const r of decisions?.tables[0]?.rows ?? []) expect(bodyText, `decision ${String(r.code)}`).toContain(String(r.code));
      await shot(page, 'ar-report-minutes-exports.png');

      // KPI catalogue (Arabic)
      await page.goto(`/projects/${pid}/reports/kpis`);
      await expect(page.getByTestId('kpi-catalogue')).toHaveAttribute('data-state', 'ready');
      await checkArabic(page, testInfo, SHOTS, 'kpi-catalogue', bilingual);
      await axe(page, 'KPI catalogue (ar)');
      expect(problems(), problems().join('\n')).toEqual([]);
    } finally {
      await close();
    }
  });

  test('a contributor reads the snapshots but is offered no export; the KPI catalogue tab is not offered', async ({ browser, baseURL }) => {
    const { page, problems, close } = await asPersona(browser, baseURL!, CONTRIBUTOR, 'en');
    try {
      const pid = await dcId(page);
      await page.goto(`/projects/${pid}/reports`);
      await expect(page.getByTestId('generate-report-open')).toHaveCount(0);
      await expect(page.getByTestId('reports-tabs')).toHaveCount(0);
      const first = page.getByTestId('snapshot-link').first();
      await expect(first).toBeVisible();
      await first.click();
      await expect(page.getByTestId('report-detail')).toBeVisible();
      await expect(page.getByTestId('export-report-open')).toHaveCount(0);
      await expect(page.getByTestId('export-not-allowed')).toBeVisible();
      await axe(page, 'report snapshot, contributor (en)');
      await shot(page, 'en-report-contributor.png');
      expect(problems(), problems().join('\n')).toEqual([]);
    } finally {
      await close();
    }
  });
  test('REQ-RPT-011 (ar): the sponsor manages the BI exposure — connection shown as not verified, demo project never readable; grant and withdrawal recorded', async ({ browser, baseURL }, testInfo) => {
    const { page, problems, close } = await asPersona(browser, baseURL!, SPONSOR, 'ar');
    const bilingual = watchBilingual(page);
    try {
      const pid = await dcId(page);
      await page.goto(`/projects/${pid}/reports/bi`);
      await expect(page.getByTestId('bi-connection')).toHaveAttribute('data-connection', 'not_verified');
      await expect(page.getByTestId('bi-grants')).toHaveAttribute('data-state', /ready|empty/);
      await checkArabic(page, testInfo, SHOTS, 'bi-access', bilingual);
      await axe(page, 'BI access (ar)');
      // Withdraw a grant left by an earlier run, so the grant dialog is offered.
      while ((await page.getByTestId('bi-revoke').count()) > 0) {
        await page.getByTestId('bi-revoke').first().click();
        await page.locator('dialog[open] textarea').fill('سحب سابق في الاختبار');
        await page.locator('dialog[open]').getByRole('button', { name: 'سحب', exact: true }).click();
        await expect(page.locator('dialog[open]')).toHaveCount(0);
      }
      await page.getByTestId('bi-grant-open').click();
      const dialog = page.locator('dialog[open]');
      await checkDialogA11y(page, dialog, 'BI grant dialog (ar)');
      await checkArabic(page, testInfo, SHOTS, 'bi-grant-dialog', bilingual, { scope: dialog });
      await page.getByTestId('bi-classification').selectOption('internal');
      await page.getByTestId('bi-reason').fill('تجربة لوحة مكتب إدارة المشاريع (اختبار)');
      await page.getByTestId('bi-grant-submit').click();
      await expect(dialog).toHaveCount(0);
      await expect(page.locator('[data-testid="bi-grant-state"][data-active="true"]')).toHaveCount(1);
      // A demo project stays unreadable through the BI views whatever the grant.
      await expect(page.getByTestId('bi-exposure')).toContainText('مشروع تجريبي');
      await shot(page, 'ar-bi-access-granted.png');
      await page.getByTestId('bi-revoke').click();
      await page.locator('dialog[open] textarea').fill('انتهاء التجربة (اختبار)');
      await page.locator('dialog[open]').getByRole('button', { name: 'سحب', exact: true }).click();
      await expect(page.locator('dialog[open]')).toHaveCount(0);
      await expect(page.locator('[data-testid="bi-grant-state"][data-active="true"]')).toHaveCount(0);
      await expect(page.getByTestId('bi-grant-open')).toBeVisible();
      expect(problems(), problems().join('\n')).toEqual([]);
    } finally {
      await close();
    }
  });
});
