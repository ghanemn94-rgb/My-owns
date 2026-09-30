import { expect, test, type Page, type Response, type TestInfo } from '@playwright/test';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PERSONAS, apiSessionAs, loginAs, setSavedLocale } from './helpers';

/**
 * Independent QA — P1 re-review (docs/reviews/P1-qa-rereview.md), Arabic/RTL check of the P1 screens:
 * portfolio home, project home (demo project and a freshly created project) and the project-creation wizard (steps 1-4).
 * Requirement / finding IDs: REQ-UX-001 (toggle locale switches dir and all visible strings), REQ-UX-002, REQ-UX-004,
 * REQ-ENT-006, QA-P1-14 (bilingual server strings).
 *
 * For each screen, in Arabic:
 *  1. <html lang="ar" dir="rtl">.
 *  2. No English half of a bilingual API field is visible: for every object in the JSON the page loaded that carries
 *     `<field>` together with `<field>Ar` or `<field>I18n`, the English `<field>` text must not be shown.
 *  3. No English UI catalogue message (apps/web/src/i18n/messages/en, where the Arabic text differs) is visible, neither
 *     as a whole text node nor as a multi-word fragment, in text or in placeholder / aria-label / title / alt attributes.
 *  4. Every remaining visible text with Latin letters is attached to the report (qa-latin-text.json) for manual
 *     classification (user data such as names and codes is expected to stay as entered).
 * Needs: API in DEMO mode + seeded demo sandbox; web at HUB_WEB_URL. Creates one project with a per-run suffix.
 */
const SHOTS = join(__dirname, '..', 'screenshots', 'qa-p1r');
mkdirSync(SHOTS, { recursive: true });
const RUN = Date.now().toString(36).toUpperCase().slice(-5);
const MESSAGES = join(__dirname, '..', '..', 'apps', 'web', 'src', 'i18n', 'messages');

function flatten(o: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (typeof o === 'string') out[prefix] = o;
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
}

/** English catalogue texts whose Arabic translation differs: whole messages and static multi-word fragments. */
function englishCatalogue(): { whole: Set<string>; fragments: string[] } {
  const whole = new Set<string>();
  const fragments = new Set<string>();
  for (const file of readdirSync(join(MESSAGES, 'en'))) {
    const en = flatten(JSON.parse(readFileSync(join(MESSAGES, 'en', file), 'utf8')), file);
    const ar = flatten(JSON.parse(readFileSync(join(MESSAGES, 'ar', file), 'utf8')), file);
    for (const [k, v] of Object.entries(en)) {
      if (ar[k] === v || !/[A-Za-z]{3}/.test(v)) continue;
      // The locale switch (components/LocaleSwitch.tsx) names the other language in that language: "English" is intended.
      if (!/[{}]/.test(v) && v.trim() !== 'English') whole.add(v.trim());
      for (const frag of v.split(/\{[^}]*\}/)) {
        const f = frag.trim().replace(/^[\s:·,.;—–-]+|[\s:·,.;—–-]+$/g, '');
        if (f.length >= 10 && /[A-Za-z]+\s+[A-Za-z]+/.test(f)) fragments.add(f);
      }
    }
  }
  return { whole, fragments: [...fragments] };
}
const CATALOGUE = englishCatalogue();

/**
 * Collects the English side of every bilingual field in the JSON the page loaded. The browser may discard response
 * bodies across navigations, so the GET URLs the page requested are recorded and re-fetched with the page's own session
 * (same cookies, same authorization) when a screen is checked.
 */
function watchBilingual(page: Page) {
  const urls = new Set<string>();
  const english = new Set<string>();
  const walk = (o: unknown) => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== 'object') return;
    const rec = o as Record<string, unknown>;
    for (const [k, v] of Object.entries(rec)) {
      if (typeof v === 'string' && /[A-Za-z]{3}/.test(v) && (`${k}Ar` in rec || `${k}I18n` in rec) && rec[`${k}Ar`] !== v) english.add(v.trim());
      walk(v);
    }
  };
  page.on('response', (r: Response) => {
    if (r.request().method() === 'GET' && r.url().includes('/api/v1/') && r.status() === 200 && (r.headers()['content-type'] ?? '').includes('json')) urls.add(r.url());
  });
  return async () => {
    for (const url of urls) {
      const r = await page.request.get(url);
      if (r.ok() && (r.headers()['content-type'] ?? '').includes('json')) walk(await r.json());
    }
    urls.clear();
    return english;
  };
}

interface Visible {
  text: string;
  where: string;
}

async function visibleTexts(page: Page): Promise<Visible[]> {
  return page.evaluate(() => {
    const out: { text: string; where: string }[] = [];
    const shown = (el: Element | null) => {
      if (!el) return false;
      const s = getComputedStyle(el);
      if (s.visibility === 'hidden' || s.display === 'none') return false;
      return (el as HTMLElement).getClientRects().length > 0;
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = (n.textContent ?? '').replace(/\s+/g, ' ').trim();
      const el = n.parentElement;
      if (!t || !el || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName) || !shown(el)) continue;
      out.push({ text: t, where: `${el.tagName.toLowerCase()}${el.getAttribute('data-testid') ? `[data-testid=${el.getAttribute('data-testid')}]` : ''}` });
    }
    for (const el of Array.from(document.querySelectorAll('[placeholder],[aria-label],[title],img[alt]'))) {
      if (!shown(el)) continue;
      for (const a of ['placeholder', 'aria-label', 'title', 'alt']) {
        const v = el.getAttribute(a)?.trim();
        if (v) out.push({ text: v, where: `${el.tagName.toLowerCase()}@${a}` });
      }
    }
    return out;
  });
}

async function englishProblems(page: Page, name: string, englishBilingual: () => Promise<Set<string>>): Promise<{ problems: string[]; texts: Visible[] }> {
  const texts = await visibleTexts(page);
  const english = await englishBilingual();
  const problems: string[] = [];
  for (const v of texts) {
    for (const e of english) if (v.text.includes(e)) problems.push(`${name}: English half of a bilingual API field shown: "${e}" in ${v.where} "${v.text}"`);
    if (CATALOGUE.whole.has(v.text)) problems.push(`${name}: English UI message shown: "${v.text}" (${v.where})`);
    for (const f of CATALOGUE.fragments) if (v.text.includes(f)) problems.push(`${name}: English UI message fragment shown: "${f}" in ${v.where} "${v.text}"`);
  }
  return { problems: [...new Set(problems)], texts };
}

async function checkArabicScreen(page: Page, testInfo: TestInfo, name: string, englishBilingual: () => Promise<Set<string>>) {
  await page.waitForLoadState('networkidle');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.screenshot({ path: join(SHOTS, `ar-${name}.png`), fullPage: true });
  const { problems, texts } = await englishProblems(page, name, englishBilingual);
  const latin = [...new Map(texts.filter((v) => /[A-Za-z]/.test(v.text)).map((v) => [`${v.where}|${v.text}`, v])).values()];
  await testInfo.attach(`qa-latin-text-${name}.json`, { body: JSON.stringify(latin, null, 2), contentType: 'application/json' });
  console.log(`[${name}] visible Latin-letter texts (${latin.length}):\n  ${latin.map((v) => `${v.where}: ${v.text}`).join('\n  ')}`);
  expect(problems, problems.join('\n')).toEqual([]);
}

test.describe.configure({ mode: 'serial' });

test.describe('QA P1 re-review — Arabic/RTL: portfolio, project home and creation wizard show no untranslated UI or bilingual server strings [REQ-UX-001, REQ-UX-002, REQ-UX-004, REQ-ENT-006, QA-P1-14]', () => {
  let newProjectId = '';
  let dcId = '';

  test.beforeAll(async ({ baseURL }) => {
    // A fresh DC project (all dimensions "not yet assessed", gate G0) whose PM is the demo Project Manager.
    const admin = await apiSessionAs(baseURL!, PERSONAS.portfolioAdmin);
    const csrf = (await admin.storageState()).cookies.find((c) => c.name === 'hub_csrf')?.value ?? '';
    const templates = (await (await admin.get('/api/v1/templates')).json()).items as { id: string; templateKey: string }[];
    const users = (await (await admin.get('/api/v1/auth/demo-users')).json()).items as { id: string; displayName: string }[];
    const res = await admin.post('/api/v1/projects', {
      headers: { 'x-csrf-token': csrf },
      data: {
        templateVersionId: templates.find((t) => t.templateKey === 'dc-carveout')!.id,
        code: `QA-RTL-${RUN}`,
        name: `QA RTL probe ${RUN} (synthetic)`,
        classification: 'internal',
        projectManagerUserId: users.find((u) => u.displayName === PERSONAS.pm)!.id,
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    newProjectId = (await res.json()).id;
    await admin.dispose();
    const pm = await apiSessionAs(baseURL!, PERSONAS.pm);
    const list = (await (await pm.get('/api/v1/projects?q=DEMO-DC')).json()).items as { id: string; code: string }[];
    dcId = list.find((p) => p.code === 'DEMO-DC')!.id;
    await pm.dispose();
  });

  test('portfolio home and project home (demo project and a new project) in Arabic', async ({ page }, testInfo) => {
    const bilingual = watchBilingual(page);
    await loginAs(page, PERSONAS.pm);
    await setSavedLocale(page, 'ar');
    try {
      await page.reload();
      await checkArabicScreen(page, testInfo, 'portfolio-home', bilingual);
      await page.goto(`/projects/${dcId}`);
      await checkArabicScreen(page, testInfo, 'project-home-demo-dc', bilingual);
      await page.goto(`/projects/${newProjectId}`);
      await checkArabicScreen(page, testInfo, 'project-home-new', bilingual);
    } finally {
      await setSavedLocale(page, 'en');
    }
  });

  test('detector self-check: on the same screens in English the detector reports English UI messages and English bilingual fields', async ({ page }) => {
    const bilingual = watchBilingual(page);
    await loginAs(page, PERSONAS.pm);
    await setSavedLocale(page, 'en');
    await page.reload();
    await page.goto(`/projects/${newProjectId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    const { problems } = await englishProblems(page, 'project-home-new-en', bilingual);
    // Without these the Arabic assertions above would be vacuous.
    expect(problems.some((p) => p.includes('English UI message'))).toBe(true);
    expect(problems.some((p) => p.includes('English half of a bilingual API field'))).toBe(true);
  });

  test('project creation wizard steps 1-4 in Arabic (not submitted)', async ({ page }, testInfo) => {
    const bilingual = watchBilingual(page);
    await loginAs(page, PERSONAS.portfolioAdmin);
    await setSavedLocale(page, 'ar');
    try {
      await page.reload();
      await page.getByTestId('create-project').click();
      await expect(page).toHaveURL(/\/projects\/new$/);
      await checkArabicScreen(page, testInfo, 'wizard-1-template', bilingual);
      await page.getByRole('radio', { name: /فصل أعمال مراكز البيانات/ }).check();
      await page.getByRole('button', { name: 'التالي' }).click();
      await page.getByLabel(/^رمز المشروع/).fill(`QA-RTLW-${RUN}`);
      await page.getByLabel(/^الاسم/).fill(`مشروع فحص الاتجاه ${RUN}`);
      await checkArabicScreen(page, testInfo, 'wizard-2-details', bilingual);
      await page.getByRole('button', { name: 'التالي' }).click();
      await page.getByRole('combobox').fill('Demo Project');
      await page.getByRole('option', { name: /Demo Project Manager/ }).first().click();
      await checkArabicScreen(page, testInfo, 'wizard-3-people', bilingual);
      await page.getByRole('button', { name: 'التالي' }).click();
      await expect(page.getByTestId('create-submit')).toBeVisible();
      await checkArabicScreen(page, testInfo, 'wizard-4-review', bilingual);
    } finally {
      await setSavedLocale(page, 'en');
    }
  });
});
