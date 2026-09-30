import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page, type Response, type TestInfo } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Untranslated-text detector for Arabic (RTL) screens — the method of the P1 QA re-review (qa-p1r-arabic-rtl.spec.ts),
 * shared here for the P2 QA review (qa-p2-arabic-rtl.spec.ts). On an Arabic screen it reports:
 *  - the English half of any bilingual API field the page loaded (`<field>` next to `<field>Ar` / `<field>I18n`);
 *  - any English UI catalogue message (apps/web/src/i18n/messages/en, where the Arabic text differs), whole or as a
 *    multi-word static fragment, in text or in placeholder / aria-label / title / alt attributes.
 * Every other visible Latin-letter text is returned for manual classification (user data, codes, names stay as entered).
 */
const MESSAGES = join(__dirname, '..', '..', 'apps', 'web', 'src', 'i18n', 'messages');

function flatten(o: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (typeof o === 'string') out[prefix] = o;
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
}

function englishCatalogue(): { whole: Set<string>; fragments: string[] } {
  const whole = new Set<string>();
  const fragments = new Set<string>();
  // Texts the Arabic catalogue itself shows verbatim (e.g. the language switch's autonym "English") are intentional in the
  // Arabic UI: an English message with exactly that text is not evidence of an untranslated string.
  // The locale switch (components/LocaleSwitch.tsx) names the other language in that language — "English" in the Arabic UI.
  const arabicShown = new Set<string>(['English']);
  for (const file of readdirSync(join(MESSAGES, 'ar'))) {
    for (const v of Object.values(flatten(JSON.parse(readFileSync(join(MESSAGES, 'ar', file), 'utf8')), file))) arabicShown.add(v.trim());
  }
  for (const file of readdirSync(join(MESSAGES, 'en'))) {
    const en = flatten(JSON.parse(readFileSync(join(MESSAGES, 'en', file), 'utf8')), file);
    const ar = flatten(JSON.parse(readFileSync(join(MESSAGES, 'ar', file), 'utf8')), file);
    for (const [k, v] of Object.entries(en)) {
      if (ar[k] === v || !/[A-Za-z]{3}/.test(v)) continue;
      if (!/[{}]/.test(v) && !arabicShown.has(v.trim())) whole.add(v.trim());
      for (const frag of v.split(/\{[^}]*\}/)) {
        const f = frag.trim().replace(/^[\s:·,.;—–-]+|[\s:·,.;—–-]+$/g, '');
        if (f.length >= 10 && /[A-Za-z]+\s+[A-Za-z]+/.test(f)) fragments.add(f);
      }
    }
  }
  return { whole, fragments: [...fragments] };
}
export const CATALOGUE = englishCatalogue();

/** Records the JSON GETs of the page; re-fetched with the page's own session when a screen is checked. */
export function watchBilingual(page: Page) {
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

export interface Visible {
  text: string;
  where: string;
}

/** Visible text nodes and visible text attributes, optionally inside `scope` (e.g. an open dialog). */
export async function visibleTexts(page: Page, scope?: Locator): Promise<Visible[]> {
  const fn = (root: Element) => {
    const out: { text: string; where: string }[] = [];
    const shown = (el: Element | null) => {
      if (!el) return false;
      const s = getComputedStyle(el);
      if (s.visibility === 'hidden' || s.display === 'none') return false;
      return (el as HTMLElement).getClientRects().length > 0;
    };
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = (n.textContent ?? '').replace(/\s+/g, ' ').trim();
      const el = n.parentElement;
      if (!t || !el || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName) || !shown(el)) continue;
      out.push({ text: t, where: `${el.tagName.toLowerCase()}${el.getAttribute('data-testid') ? `[data-testid=${el.getAttribute('data-testid')}]` : ''}` });
    }
    for (const el of Array.from(root.querySelectorAll('[placeholder],[aria-label],[title],img[alt]'))) {
      if (!shown(el)) continue;
      for (const a of ['placeholder', 'aria-label', 'title', 'alt']) {
        const v = el.getAttribute(a)?.trim();
        if (v) out.push({ text: v, where: `${el.tagName.toLowerCase()}@${a}` });
      }
    }
    return out;
  };
  return (scope ?? page.locator('body')).evaluate(fn);
}

export async function englishProblems(page: Page, name: string, englishBilingual: () => Promise<Set<string>>, scope?: Locator): Promise<{ problems: string[]; texts: Visible[] }> {
  const texts = await visibleTexts(page, scope);
  const english = await englishBilingual();
  const problems: string[] = [];
  for (const v of texts) {
    for (const e of english) if (v.text.includes(e)) problems.push(`${name}: English half of a bilingual API field shown: "${e}" in ${v.where} "${v.text}"`);
    if (CATALOGUE.whole.has(v.text)) problems.push(`${name}: English UI message shown: "${v.text}" (${v.where})`);
    for (const f of CATALOGUE.fragments) if (v.text.includes(f)) problems.push(`${name}: English UI message fragment shown: "${f}" in ${v.where} "${v.text}"`);
  }
  return { problems: [...new Set(problems)], texts };
}

/**
 * Arabic screen (or open dialog) check: lang/dir, screenshot, no English UI message and no English half of a bilingual API
 * field; the remaining Latin-letter texts are attached and printed for manual classification. Returns the problems so the
 * caller decides (strict assertion by default).
 */
export async function checkArabic(page: Page, testInfo: TestInfo, shots: string, name: string, englishBilingual: () => Promise<Set<string>>, opts: { scope?: Locator; strict?: boolean } = {}) {
  // Some screens poll (My Work): wait for the network to settle, but never longer than 10 s.
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.screenshot({ path: join(shots, `ar-${name}.png`), fullPage: !opts.scope });
  const { problems, texts } = await englishProblems(page, name, englishBilingual, opts.scope);
  const latin = [...new Map(texts.filter((v) => /[A-Za-z]/.test(v.text)).map((v) => [`${v.where}|${v.text}`, v])).values()];
  await testInfo.attach(`qa-latin-text-${name}.json`, { body: JSON.stringify(latin, null, 2), contentType: 'application/json' });
  console.log(`[${name}] visible Latin-letter texts (${latin.length}):\n  ${latin.map((v) => `${v.where}: ${v.text}`).join('\n  ')}`);
  if (problems.length) console.log(`[${name}] PROBLEMS (${problems.length}):\n  ${problems.join('\n  ')}`);
  if (opts.strict !== false) expect(problems, problems.join('\n')).toEqual([]);
  return problems;
}

/**
 * Dialog accessibility: role dialog with an accessible name, focus moved inside, and an axe scan of the open dialog
 * (WCAG 2.0/2.1 A + AA; gating on serious / critical, as a11y.spec.ts). The caller checks that Escape closes it.
 */
export async function checkDialogA11y(page: Page, dialog: Locator, name: string) {
  await expect(dialog, `${name}: dialog visible`).toBeVisible();
  await expect(dialog, `${name}: accessible name`).toHaveAccessibleName(/\S/);
  await expect
    .poll(() => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"], dialog')), { message: `${name}: focus inside the dialog` })
    .toBe(true);
  const results = await new AxeBuilder({ page }).include('dialog[open]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const gating = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  console.log(`[${name}] axe: ${results.violations.length} WCAG violation(s) (${gating.length} serious/critical), ${results.passes.length} rules passed`);
  expect(gating.map((v) => `${v.impact} ${v.id} ×${v.nodes.length}: ${v.help}`), `${name}: serious/critical WCAG violations`).toEqual([]);
}
