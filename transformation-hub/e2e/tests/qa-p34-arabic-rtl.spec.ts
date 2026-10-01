import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Browser, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PERSONAS, apiSessionAs, loginAs } from './helpers';
import { checkArabic, checkDialogA11y, watchBilingual } from './qa-rtl-detector';

/**
 * Independent QA — P3 + P4 review (docs/reviews/P3-P4-qa-review.md §5): every P3 screen (7 Perimeter & Transfers, 8 NewCo &
 * Regulatory, 9 Day-1 & TSA Center) and every P4 screen (10 Finance & Value, 11 JV & Diligence, the counterparty room view)
 * of the demo sandbox, and the command / create dialogs each screen offers to its persona:
 *  - Arabic (RTL): <html lang="ar" dir="rtl">; no English UI catalogue message and no English half of a bilingual API field
 *    (shared detector qa-rtl-detector.ts); axe WCAG 2.0/2.1 A+AA with serious/critical gating on the screen AND on every
 *    open dialog (accessible name, focus inside, Escape closes);
 *  - English (LTR): <html lang="en" dir="ltr">, axe on the screen and on every open dialog;
 *  - 390 px (Arabic): no page-level horizontal overflow; full-page screenshot.
 * Read-only: every dialog is opened and closed with Escape; nothing is submitted. The language comes from the `hub_locale`
 * cookie of the browser context (no persona's saved preference changes). Requirement IDs: REQ-UX-001, REQ-UX-002,
 * REQ-UX-010..REQ-UX-014, REQ-ARC-008.
 * The run prints, per screen, the visible Latin-letter texts for manual classification and a summary of every problem; the
 * assertions are aggregated per module so one run reports all of them.
 */
const SHOTS = join(__dirname, '..', 'screenshots', 'qa-p34');
const CRAWL = join(SHOTS, 'crawl');
mkdirSync(CRAWL, { recursive: true });
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const MOBILE = { width: 390, height: 844 } as const;

const PERSONA = {
  pm: PERSONAS.pm,
  legal: 'Demo Legal Member',
  finance: PERSONAS.finance,
  sponsor: PERSONAS.sponsor,
  partner: PERSONAS.partnerAlpha,
} as const;
type Who = keyof typeof PERSONA;
type Locale = 'ar' | 'en';

interface Screen {
  id: string;
  who: Who;
  path: string;
  /** Crawl the dialogs this screen offers (default true). */
  dialogs?: boolean;
}

/** Buttons that open a command / create dialog in these screens (none of them acts on click — checked in the review). */
const OPENERS = [
  'button[data-testid^="cmd-"]',
  'button[data-testid^="create-"]',
  'button[data-testid$="-create"]',
  'button[data-testid$="-open"]',
  'button[data-command]',
  'button[data-testid="evidence-add"]',
  'button[data-testid^="incorporation-"]',
  'button[data-testid="consent-respond"]',
  'button[data-testid="version-propose"]',
  'button[data-testid="version-approve"]',
  'button[data-testid="apply-change"]',
  'button[data-testid="total-selected"]',
  'button[data-testid="requirement-assess"]',
].map((s) => `main ${s}`).join(', ');

async function items(api: APIRequestContext, path: string): Promise<Record<string, unknown>[]> {
  const r = await api.get(path);
  expect(r.ok(), `GET ${path} → ${r.status()}`).toBeTruthy();
  const b = await r.json();
  return (b.items ?? []) as Record<string, unknown>[];
}
async function idOf(api: APIRequestContext, path: string, pick?: (x: Record<string, unknown>) => boolean): Promise<string> {
  const xs = await items(api, path);
  const hit = pick ? xs.find(pick) : xs[0];
  expect(hit, `${path}: no matching item`).toBeTruthy();
  return String(hit!.id);
}

const RUN = Date.now().toString(36).toUpperCase().slice(-5);

async function post(api: APIRequestContext, path: string, data: unknown): Promise<Record<string, unknown>> {
  const csrf = (await api.storageState()).cookies.find((c) => c.name === 'hub_csrf')?.value ?? '';
  const r = await api.post(path, { data, headers: { 'x-csrf-token': csrf } });
  expect(r.ok(), `POST ${path} → ${r.status()} ${await r.text()}`).toBeTruthy();
  return r.json();
}

/** Fresh DC project (synthetic) with the Finance persona as finance_restricted, one figure and one reconciliation. */
async function financeFixture(baseURL: string): Promise<{ fresh: string; snapshot: string; recon: string }> {
  const admin = await apiSessionAs(baseURL, PERSONAS.portfolioAdmin);
  const fin = await apiSessionAs(baseURL, PERSONA.finance);
  try {
    const users = await items(admin, '/api/v1/auth/demo-users');
    const uid = (n: string) => String(users.find((u) => u.displayName === n)!.id);
    const templates = await items(admin, '/api/v1/templates');
    const created = await post(admin, '/api/v1/projects', {
      templateVersionId: templates.find((t) => t.templateKey === 'dc-carveout')!.id,
      code: `QA34-FIN-${RUN}`,
      name: `QA P3/P4 Arabic probe ${RUN} (synthetic)`,
      projectManagerUserId: uid(PERSONA.pm),
    });
    const fresh = String(created.id);
    await post(admin, `/api/v1/projects/${fresh}/members`, { userId: uid(PERSONA.finance), role: 'finance_restricted', reason: 'QA P3/P4 review — Arabic probe fixture' });
    const snap = await post(fin, `/api/v1/projects/${fresh}/financial-snapshots`, {
      kind: 'forecast',
      category: 'one_off_separation',
      lineRef: `QA34-${RUN}`,
      label: 'QA synthetic separation cost (test input, not real data)',
      period: '2026-Q4',
      amount: { amount: '1000', currency: 'SAR', unitScale: 1 },
      sourceRef: 'Synthetic QA source — not real data',
    });
    const recon = await post(fin, `/api/v1/projects/${fresh}/intercompany-reconciliations`, {
      counterpartyLabel: 'Synthetic counterparty (QA test input)',
      period: '2026-Q3',
      ourBalance: { amount: '500', currency: 'SAR', unitScale: 1 },
      theirBalance: { amount: '450', currency: 'SAR', unitScale: 1 },
      sourceRef: 'Synthetic QA ledger extract — not real data',
    });
    return { fresh, snapshot: String(snap.id), recon: String(recon.id) };
  } finally {
    await admin.dispose();
    await fin.dispose();
  }
}

const SCREENS: { p3: Screen[]; p4: Screen[] } = { p3: [], p4: [] };
const sessions: Partial<Record<Who, Awaited<ReturnType<import('@playwright/test').BrowserContext['storageState']>>>> = {};

async function buildScreens(baseURL: string) {
  const pm = await apiSessionAs(baseURL, PERSONA.pm);
  const fin = await apiSessionAs(baseURL, PERSONA.finance);
  try {
    const dc = await idOf(pm, '/api/v1/projects?pageSize=100', (x) => x.code === 'DEMO-DC');
    const p = `/api/v1/projects/${dc}`;
    const w = `/projects/${dc}`;
    const perimeterItem = await idOf(pm, `${p}/perimeter-items?pageSize=100`, (x) => x.type === 'contract').catch(() => idOf(pm, `${p}/perimeter-items?pageSize=100`));
    const agreement = await idOf(pm, `${p}/agreements?pageSize=100`);
    const entity = await idOf(pm, `${p}/legal-entities`, (x) => x.role === 'newco' || /NewCo/.test(String(x.name)));
    const requirement = await idOf(pm, `${p}/regulatory-requirements?pageSize=100`);
    const check = await idOf(pm, `${p}/readiness-checks?pageSize=100&status=failed`).catch(() => idOf(pm, `${p}/readiness-checks?pageSize=100`));
    const plan = await idOf(pm, `${p}/cutover-plans?pageSize=100`);
    const tsa = await idOf(pm, `${p}/tsa-services?pageSize=100`, (x) => /Legacy monitoring bridge/.test(String(x.name)));
    SCREENS.p3 = [
      ...['register', 'reconciliation', 'transfers', 'day1', 'versions', 'sites', 'agreements', 'consents'].map((t) => ({ id: `perimeter-${t}`, who: 'pm' as Who, path: `${w}/perimeter?tab=${t}` })),
      { id: 'perimeter-item', who: 'pm', path: `${w}/perimeter/items/${perimeterItem}` },
      { id: 'perimeter-item-legal', who: 'legal', path: `${w}/perimeter/items/${perimeterItem}` },
      { id: 'agreement', who: 'pm', path: `${w}/perimeter/agreements/${agreement}` },
      { id: 'newco-entities', who: 'pm', path: `${w}/newco` },
      { id: 'newco-requirements', who: 'legal', path: `${w}/newco?tab=requirements` },
      { id: 'newco-entity', who: 'pm', path: `${w}/newco/entities/${entity}` },
      { id: 'newco-entity-legal', who: 'legal', path: `${w}/newco/entities/${entity}` },
      { id: 'newco-requirement', who: 'legal', path: `${w}/newco/requirements/${requirement}` },
      { id: 'readiness-overview', who: 'pm', path: `${w}/readiness` },
      { id: 'readiness-checks', who: 'pm', path: `${w}/readiness/checks` },
      { id: 'readiness-check', who: 'pm', path: `${w}/readiness/checks/${check}` },
      { id: 'readiness-cutover', who: 'pm', path: `${w}/readiness/cutover` },
      { id: 'readiness-plan', who: 'pm', path: `${w}/readiness/cutover/${plan}` },
      { id: 'readiness-plan-sponsor', who: 'sponsor', path: `${w}/readiness/cutover/${plan}` },
      { id: 'readiness-tsa', who: 'pm', path: `${w}/readiness/tsa` },
      { id: 'readiness-tsa-detail', who: 'pm', path: `${w}/readiness/tsa/${tsa}` },
      { id: 'readiness-waivers', who: 'pm', path: `${w}/readiness/waivers` },
    ];
    // The demo sandbox has no financial figure and no intercompany reconciliation: both detail screens are checked on a
    // fresh (non-demo) DC project where the Finance persona records one synthetic figure and one reconciliation.
    const { fresh, snapshot, recon } = await financeFixture(baseURL);
    const budgetLine = await idOf(fin, `${p}/budget-lines?pageSize=100`);
    let model = '';
    let version = '';
    for (const m of await items(fin, `${p}/financial-models?pageSize=100`)) {
      const d = await (await fin.get(`${p}/financial-models/${String(m.id)}`)).json();
      const vs = (d.versions ?? []) as { id: string }[];
      if (!model) model = String(m.id);
      if (vs.length) {
        model = String(m.id);
        version = vs[0]!.id;
        break;
      }
    }
    const benefit = await idOf(fin, `${p}/benefits?pageSize=100`);
    const kpi = await idOf(fin, `${p}/kpis?pageSize=100`);
    const partner = await idOf(pm, `${p}/partners?pageSize=100`, (x) => x.code === 'DEMO-PA');
    const room = await idOf(pm, `${p}/partner-rooms?pageSize=100`, (x) => x.type === 'partner');
    const scenario = await idOf(pm, `${p}/deal-scenarios?pageSize=100`);
    const ddRequest = await idOf(pm, `${p}/diligence-requests?pageSize=100`);
    const finding = await idOf(pm, `${p}/diligence-findings?pageSize=100`);
    const closing = await idOf(pm, `${p}/closings?pageSize=100`, (x) => x.code === 'CLO-001');
    const signing = await idOf(pm, `${p}/signings?pageSize=100`, (x) => x.code === 'SIG-001');
    const cp = await idOf(pm, `${p}/closing-conditions?pageSize=100`, (x) => x.reference === 'DEMO-CP-01');
    const cpWaivable = await idOf(pm, `${p}/closing-conditions?pageSize=100`, (x) => x.reference === 'DEMO-CP-03');
    SCREENS.p4 = [
      { id: 'finance-summary', who: 'finance', path: `${w}/finance` },
      { id: 'finance-snapshots', who: 'finance', path: `${w}/finance/snapshots` },
      { id: 'finance-snapshot', who: 'finance', path: `/projects/${fresh}/finance/snapshots/${snapshot}` },
      { id: 'finance-budget', who: 'finance', path: `${w}/finance/budget` },
      { id: 'finance-budget-line', who: 'finance', path: `${w}/finance/budget/${budgetLine}` },
      { id: 'finance-reconciliations', who: 'finance', path: `${w}/finance/reconciliations` },
      { id: 'finance-reconciliation', who: 'finance', path: `/projects/${fresh}/finance/reconciliations/${recon}` },
      { id: 'finance-models', who: 'finance', path: `${w}/finance/models` },
      { id: 'finance-model', who: 'finance', path: `${w}/finance/models/${model}` },
      ...(version ? [{ id: 'finance-model-version', who: 'finance' as Who, path: `${w}/finance/models/${model}/versions/${version}` }] : []),
      { id: 'finance-benefits', who: 'finance', path: `${w}/finance/benefits` },
      { id: 'finance-benefit', who: 'finance', path: `${w}/finance/benefits/${benefit}` },
      { id: 'finance-kpi', who: 'finance', path: `${w}/finance/kpis/${kpi}` },
      { id: 'jv-overview', who: 'pm', path: `${w}/jv` },
      { id: 'jv-partners', who: 'pm', path: `${w}/jv/partners` },
      { id: 'jv-partner', who: 'pm', path: `${w}/jv/partners/${partner}` },
      { id: 'jv-proposals', who: 'pm', path: `${w}/jv/proposals?partnerId=${partner}` },
      { id: 'jv-scenarios', who: 'pm', path: `${w}/jv/scenarios` },
      { id: 'jv-scenario', who: 'pm', path: `${w}/jv/scenarios/${scenario}` },
      { id: 'jv-negotiation', who: 'pm', path: `${w}/jv/negotiation` },
      { id: 'jv-rooms', who: 'pm', path: `${w}/jv/rooms` },
      ...['index', 'disclosures', 'grants', 'history'].map((t) => ({ id: `jv-room-${t}`, who: 'pm' as Who, path: `${w}/jv/rooms/${room}?tab=${t}` })),
      { id: 'jv-diligence', who: 'pm', path: `${w}/jv/diligence` },
      { id: 'jv-diligence-findings', who: 'pm', path: `${w}/jv/diligence?tab=findings` },
      { id: 'jv-dd-request', who: 'pm', path: `${w}/jv/diligence/requests/${ddRequest}` },
      { id: 'jv-finding', who: 'pm', path: `${w}/jv/diligence/findings/${finding}` },
      { id: 'jv-closing', who: 'pm', path: `${w}/jv/closing` },
      { id: 'jv-closing-conditions', who: 'pm', path: `${w}/jv/closing?tab=conditions` },
      { id: 'jv-closing-detail', who: 'pm', path: `${w}/jv/closing/closings/${closing}` },
      { id: 'jv-signing-detail', who: 'pm', path: `${w}/jv/closing/signings/${signing}` },
      { id: 'jv-cp', who: 'legal', path: `${w}/jv/closing/conditions/${cp}` },
      { id: 'jv-cp-waivable', who: 'pm', path: `${w}/jv/closing/conditions/${cpWaivable}` },
      { id: 'jv-funds-flow', who: 'pm', path: `${w}/jv/funds-flow` },
      { id: 'jv-obligations', who: 'pm', path: `${w}/jv/obligations` },
      { id: 'partner-access', who: 'partner', path: '/partner-access' },
      { id: 'partner-access-room', who: 'partner', path: `/partner-access/${dc}/${room}` },
    ];
  } finally {
    await pm.dispose();
    await fin.dispose();
  }
}

async function contextFor(browser: Browser, baseURL: string, who: Who, locale: Locale, viewport?: { width: number; height: number }) {
  const ctx = await browser.newContext({ storageState: sessions[who], ...(viewport ? { viewport } : {}) });
  await ctx.addCookies([{ name: 'hub_locale', value: locale, url: baseURL }]);
  return ctx;
}

async function stable(page: Page) {
  await expect(page.getByTestId('loading-state')).toHaveCount(0, { timeout: 30_000 });
  const sample = () => page.evaluate(() => `${document.body.innerHTML.length}:${document.querySelectorAll('[data-testid="loading-state"]').length}`);
  await expect
    .poll(async () => {
      const a = await sample();
      await page.waitForTimeout(400);
      return a === (await sample()) && a.endsWith(':0');
    }, { timeout: 30_000, intervals: [0] })
    .toBe(true);
}

async function settle(page: Page, locale: Locale) {
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
  await expect(page.locator('h1, [data-testid="restricted-state"]').first()).toBeVisible({ timeout: 30_000 });
  await stable(page);
}

async function axeGating(page: Page, include?: string): Promise<string[]> {
  const b = new AxeBuilder({ page }).withTags(WCAG);
  const r = await (include ? b.include(include) : b).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.impact} ${v.id} ×${v.nodes.length}: ${v.help} (e.g. ${v.nodes[0]?.target.join(' >> ')})`);
}

interface Found {
  problems: string[];
  dialogs: string[];
  noDialog: string[];
  /** Problems classified by this review (documented defect id, or verified as data) — reported, not failing. */
  classified: string[];
}

/**
 * Classification of the detector's Arabic problems after manual review at 5bf274b (docs/reviews/P3-P4-qa-review.md §5):
 * each entry is text verified to be DATA (user-entered or demo-seed values, source labels stored as found), which the
 * convention shows as entered. Anything else fails. The documented defects QA-P34-01a…h were classified here while open;
 * they are fixed ("Fix status" of the review) and their entries removed, so a recurrence fails this crawler.
 */
const CLASSIFIED: { id: string; test: RegExp }[] = [
  { id: 'DATA (demo-seed value "Assessment pending — specialist (DEMO)")', test: /"Assessment pending( — specialist)?" in (span|textarea[^ ]*) "Assessment pending — specialist \(DEMO\)"/ },
  { id: 'DATA (readiness check created by a test, no Arabic source)', test: /readiness-[a-z-]*: English [^:]*: "[^"]*" in (span|a) "[^"]*\(synthetic\)"$/ },
  { id: 'DATA (agreement type stored as the source label, REQ-AGR-002)', test: /perimeter-agreements: English UI message shown: "TSA" \(span\)/ },
  { id: 'DATA (demo-seed text)', test: /in span "DEMO — / },
  { id: 'DATA (benefit baseline / target value "TBD")', test: /finance-benefits?: English UI message shown: "TBD" \(span\)/ },
];
function classify(f: Found) {
  const rest: string[] = [];
  for (const p of f.problems) {
    const hit = CLASSIFIED.find((c) => c.test.test(p));
    if (hit) f.classified.push(`${hit.id} ← ${p}`);
    else rest.push(p);
  }
  f.problems = rest;
}

/** Opens every dialog the screen offers, checks it, closes it with Escape. */
async function crawlDialogs(page: Page, testInfo: TestInfo, s: Screen, locale: Locale, bilingual: () => Promise<Set<string>>, f: Found) {
  const n = await page.locator(OPENERS).count();
  const seen = new Set<string>();
  for (let i = 0; i < n; i++) {
    const b = page.locator(OPENERS).nth(i);
    if (!(await b.isVisible().catch(() => false)) || !(await b.isEnabled().catch(() => false))) continue;
    const key = (await b.getAttribute('data-testid')) ?? `command-${await b.getAttribute('data-command')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const name = `${s.id}--${key}`.replace(/[^a-z0-9-]+/gi, '-');
    const url = page.url();
    await b.scrollIntoViewIfNeeded().catch(() => undefined);
    await b.click();
    const dialog = page.locator('dialog[open]');
    const opened = await dialog.first().waitFor({ state: 'visible', timeout: 5_000 }).then(() => true, () => false);
    if (!opened) {
      f.noDialog.push(`${locale} ${name}`);
      if (page.url() !== url) {
        await page.goto(url);
        await settle(page, locale);
      }
      continue;
    }
    f.dialogs.push(`${locale} ${name}`);
    await page.waitForTimeout(300);
    try {
      await checkDialogA11y(page, dialog.first(), `${locale} ${name}`);
    } catch (e) {
      f.problems.push(`[${locale}] dialog ${name}: ${(e as Error).message.split('\n').slice(0, 6).join(' | ')}`);
    }
    if (locale === 'ar') {
      try {
        const ps = await checkArabic(page, testInfo, CRAWL, name, bilingual, { scope: dialog.first(), strict: false });
        f.problems.push(...ps.map((x) => `[ar] dialog ${x}`));
      } catch (e) {
        f.problems.push(`[ar] dialog ${name}: ${(e as Error).message.split('\n')[0]}`);
      }
    } else {
      await page.screenshot({ path: join(CRAWL, `en-${name}.png`) });
    }
    await page.keyboard.press('Escape');
    const closed = await dialog.first().waitFor({ state: 'hidden', timeout: 3_000 }).then(() => true, () => false);
    if (!closed) {
      f.problems.push(`[${locale}] dialog ${name}: Escape did not close the dialog`);
      await page.goto(url);
      await settle(page, locale);
    }
  }
}

async function runScreens(browser: Browser, baseURL: string, testInfo: TestInfo, screens: Screen[], locale: Locale): Promise<Found> {
  const f: Found = { problems: [], dialogs: [], noDialog: [], classified: [] };
  const byWho = new Map<Who, Screen[]>();
  for (const s of screens) byWho.set(s.who, [...(byWho.get(s.who) ?? []), s]);
  for (const [who, list] of byWho) {
    const ctx = await contextFor(browser, baseURL, who, locale);
    try {
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      const bilingual = watchBilingual(page);
      for (const s of list) {
        await page.goto(s.path);
        try {
          await settle(page, locale);
        } catch (e) {
          f.problems.push(`[${locale}] ${s.id}: did not settle (${(e as Error).message.split('\n')[0]})`);
          await page.screenshot({ path: join(CRAWL, `${locale}-${s.id}-unsettled.png`), fullPage: true });
          continue;
        }
        if (await page.getByTestId('restricted-state').first().isVisible()) f.problems.push(`[${locale}] ${s.id}: restricted state shown to ${who} (fixture/persona problem?)`);
        if (locale === 'ar') {
          const ps = await checkArabic(page, testInfo, CRAWL, s.id, bilingual, { strict: false });
          f.problems.push(...ps.map((x) => `[ar] ${x}`));
        } else {
          await page.screenshot({ path: join(CRAWL, `en-${s.id}.png`), fullPage: true });
        }
        for (const v of await axeGating(page)) f.problems.push(`[${locale}] ${s.id} axe: ${v}`);
        if (s.dialogs !== false) await crawlDialogs(page, testInfo, s, locale, bilingual, f);
      }
      for (const e of errors) f.problems.push(`[${locale}] ${who}: ${e}`);
    } finally {
      await ctx.close();
    }
  }
  console.log(`[${locale}] ${screens.length} screens, ${f.dialogs.length} dialogs checked:\n  ${f.dialogs.join('\n  ')}`);
  if (f.noDialog.length) console.log(`[${locale}] openers that opened no dialog (${f.noDialog.length}):\n  ${f.noDialog.join('\n  ')}`);
  classify(f);
  const byId = new Map<string, number>();
  for (const c of f.classified) byId.set(c.split(' ← ')[0]!, (byId.get(c.split(' ← ')[0]!) ?? 0) + 1);
  console.log(`[${locale}] CLASSIFIED (${f.classified.length}): ${JSON.stringify(Object.fromEntries(byId))}`);
  console.log(`[${locale}] UNCLASSIFIED PROBLEMS (${f.problems.length}):\n  ${f.problems.join('\n  ')}`);
  await testInfo.attach(`qa-p34-${locale}-summary.json`, { body: JSON.stringify(f, null, 2), contentType: 'application/json' });
  return f;
}

async function runMobile(browser: Browser, baseURL: string, screens: Screen[]): Promise<string[]> {
  const problems: string[] = [];
  const byWho = new Map<Who, Screen[]>();
  for (const s of screens) byWho.set(s.who, [...(byWho.get(s.who) ?? []), s]);
  for (const [who, list] of byWho) {
    const ctx = await contextFor(browser, baseURL, who, 'ar', MOBILE);
    try {
      const page = await ctx.newPage();
      for (const s of list) {
        await page.goto(s.path);
        try {
          await settle(page, 'ar');
        } catch (e) {
          problems.push(`[ar-390] ${s.id}: did not settle (${(e as Error).message.split('\n')[0]})`);
          continue;
        }
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (overflow > 1) problems.push(`[ar-390] ${s.id}: page-level horizontal overflow ${overflow}px`);
        await page.screenshot({ path: join(CRAWL, `ar-390-${s.id}.png`), fullPage: true });
      }
    } finally {
      await ctx.close();
    }
  }
  // QA-P34-03 (the perimeter item page overflowed at 390 px) is fixed: an overflow on any screen now fails.
  console.log(`[ar-390] ${screens.length} screens; PROBLEMS (${problems.length}):\n  ${problems.join('\n  ')}`);
  return problems;
}

test.describe('QA P3/P4 — Arabic (RTL) / English (LTR) / 390 px on every P3 and P4 screen and dialog [REQ-UX-001, REQ-UX-002, REQ-UX-010, REQ-UX-011, REQ-UX-012, REQ-UX-013, REQ-UX-014, REQ-ARC-008]', () => {
  test.beforeAll(async ({ browser, baseURL }) => {
    test.setTimeout(180_000);
    await buildScreens(baseURL!);
    for (const who of Object.keys(PERSONA) as Who[]) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await loginAs(page, PERSONA[who]);
      sessions[who] = await ctx.storageState();
      await ctx.close();
    }
  });

  test('P3 screens and dialogs in Arabic (RTL): no English UI / bilingual English, axe serious/critical = 0', async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(1_800_000);
    const f = await runScreens(browser, baseURL!, testInfo, SCREENS.p3, 'ar');
    expect(f.dialogs.length).toBeGreaterThan(10);
    expect(f.problems, f.problems.join('\n')).toEqual([]);
  });

  test('P3 screens and dialogs in English (LTR): lang/dir, axe serious/critical = 0', async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(1_800_000);
    const f = await runScreens(browser, baseURL!, testInfo, SCREENS.p3, 'en');
    expect(f.problems, f.problems.join('\n')).toEqual([]);
  });

  test('P4 screens and dialogs in Arabic (RTL): no English UI / bilingual English, axe serious/critical = 0', async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(2_400_000);
    const f = await runScreens(browser, baseURL!, testInfo, SCREENS.p4, 'ar');
    expect(f.dialogs.length).toBeGreaterThan(20);
    expect(f.problems, f.problems.join('\n')).toEqual([]);
  });

  test('P4 screens and dialogs in English (LTR): lang/dir, axe serious/critical = 0', async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(2_400_000);
    const f = await runScreens(browser, baseURL!, testInfo, SCREENS.p4, 'en');
    expect(f.problems, f.problems.join('\n')).toEqual([]);
  });

  test('P3 and P4 screens at 390 px in Arabic: no page-level horizontal overflow', async ({ browser, baseURL }) => {
    test.setTimeout(1_200_000);
    const problems = await runMobile(browser, baseURL!, [...SCREENS.p3, ...SCREENS.p4]);
    expect(problems, problems.join('\n')).toEqual([]);
  });
});

/**
 * QA-P34-01 (docs/reviews/P3-P4-qa-review.md): English is shown on Arabic P3/P4 screens where Arabic exists or should exist —
 * server-composed sentences without translation codes (a, b, c, f: the shared detector cannot see them, the DTO fields have no
 * `<field>Ar` / `<field>I18n` sibling) and template texts whose Arabic exists but is not returned or not used (d, e, g, h).
 * Each is asserted against the API's own text. QA-P34-03: the perimeter item page at 390 px. Recorded with `test.fail()` while the defect was open;
 * fixed (docs/reviews/P3-P4-qa-review.md "Fix status"): each test is now a plain regression "(fixed, regression)" with its
 * assertion unchanged; its screenshot is written as `fixed-qa-p34-*.png` (the committed `defect-qa-p34-*.png` are the
 * review's evidence of the defect).
 */
async function arabicAs(page: Page, baseURL: string, persona: string): Promise<string> {
  await loginAs(page, persona);
  await page.context().addCookies([{ name: 'hub_locale', value: 'ar', url: baseURL }]);
  return ((await (await page.request.get('/api/v1/projects?pageSize=100')).json()).items as { id: string; code: string }[]).find((p) => p.code === 'DEMO-DC')!.id;
}

test.describe('QA P3/P4 — English on Arabic screens where Arabic exists or should exist; 390 px [REQ-UX-001, REQ-UX-002, REQ-UX-010, REQ-UX-012, REQ-UX-013, REQ-UX-014]', () => {
  test('QA-P34-01a: the Arabic reconciliation screen shows no English server finding sentence in its Details column (fixed, regression)', async ({ page, baseURL }, testInfo) => {
    await loginAs(page, PERSONA.pm);
    await page.context().addCookies([{ name: 'hub_locale', value: 'ar', url: baseURL! }]);
    const dc = ((await (await page.request.get('/api/v1/projects?pageSize=100')).json()).items as { id: string; code: string }[]).find((p) => p.code === 'DEMO-DC')!.id;
    const recon = await (await page.request.get(`/api/v1/projects/${dc}/perimeter/reconciliation`)).json();
    const english = [...new Set((recon.findings as { message: string }[]).map((f) => f.message))];
    expect(english.length).toBeGreaterThan(0);
    await page.goto(`/projects/${dc}/perimeter?tab=reconciliation`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('recon-findings').locator('tbody tr').first()).toBeVisible();
    await page.getByTestId('recon-findings').screenshot({ path: join(SHOTS, 'fixed-qa-p34-01a-ar-reconciliation-findings.png') });
    const shown = await page.getByTestId('recon-findings').innerText();
    const leaked = english.filter((m) => shown.includes(m));
    console.log(`QA-P34-01a: English finding sentences visible on the Arabic reconciliation screen (${leaked.length}/${english.length}): ${JSON.stringify(leaked)}`);
    await testInfo.attach('qa-p34-01a.json', { body: JSON.stringify({ english, leaked }, null, 2), contentType: 'application/json' });
    expect(leaked).toEqual([]);
  });

  test('QA-P34-01c: the Arabic DD request page does not show the requester of a partner-raised question as the English literal "Counterparty" (fixed, regression)', async ({ page, baseURL }) => {
    await loginAs(page, PERSONA.pm);
    await page.context().addCookies([{ name: 'hub_locale', value: 'ar', url: baseURL! }]);
    const dc = ((await (await page.request.get('/api/v1/projects?pageSize=100')).json()).items as { id: string; code: string }[]).find((p) => p.code === 'DEMO-DC')!.id;
    const reqs = (await (await page.request.get(`/api/v1/projects/${dc}/diligence-requests?pageSize=100`)).json()).items as { id: string; origin: string }[];
    const partnerRaised = reqs.find((r) => r.origin === 'partner')!;
    const detail = await (await page.request.get(`/api/v1/projects/${dc}/diligence-requests/${partnerRaised.id}`)).json();
    console.log(`QA-P34-01c: requesterLabel stored by the server for a partner-raised question: ${JSON.stringify(detail.requesterLabel)}`);
    await page.goto(`/projects/${dc}/jv/diligence/requests/${partnerRaised.id}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('dd-detail')).toBeVisible();
    await page.screenshot({ path: join(SHOTS, 'fixed-qa-p34-01c-ar-dd-request.png'), fullPage: true });
    await expect(page.getByTestId('dd-detail')).not.toContainText('Counterparty');
  });

  test('QA-P34-01d: the Arabic readiness-check register shows no template check title in English when the API returns its Arabic title (fixed, regression)', async ({ page, baseURL }) => {
    const dc = await arabicAs(page, baseURL!, PERSONA.pm);
    const checks = (await (await page.request.get(`/api/v1/projects/${dc}/readiness-checks?pageSize=100`)).json()).items as { title: string; titleAr: string | null }[];
    const bilingual = checks.filter((c) => c.titleAr);
    expect(bilingual.length).toBeGreaterThan(10);
    await page.goto(`/projects/${dc}/readiness/checks`);
    await expect(page.getByTestId('checks-table').locator('tbody tr').first()).toBeVisible();
    const shown = await page.getByTestId('checks-table').innerText();
    const english = bilingual.filter((c) => shown.includes(c.title)).map((c) => c.title);
    const arabic = bilingual.filter((c) => shown.includes(c.titleAr!)).length;
    console.log(`QA-P34-01d: template checks with an Arabic title: ${bilingual.length}; shown in English on the Arabic register: ${english.length}; shown in Arabic: ${arabic}`);
    expect(english).toEqual([]);
  });

  test('QA-P34-01e: the Arabic cutover plan lists no template gating check in English — the plan DTO carries the Arabic title (fixed, regression)', async ({ page, baseURL }) => {
    const dc = await arabicAs(page, baseURL!, PERSONA.pm);
    const plans = (await (await page.request.get(`/api/v1/projects/${dc}/cutover-plans?pageSize=100`)).json()).items as { id: string; title: string }[];
    const plan = plans.find((x) => /Day-1 go-live — DEMO/.test(x.title))!;
    const detail = await (await page.request.get(`/api/v1/projects/${dc}/cutover-plans/${plan.id}`)).json();
    const fields = Object.keys(detail.checks[0] ?? {});
    console.log(`QA-P34-01e: plan check fields: ${JSON.stringify(fields)} (titleAr present: ${fields.includes('titleAr')})`);
    await page.goto(`/projects/${dc}/readiness/cutover/${plan.id}`);
    await expect(page.getByTestId('plan-checks')).toBeVisible();
    const shown = await page.getByTestId('plan-checks').innerText();
    const english = (detail.checks as { title: string }[]).filter((c) => !/\(synthetic\)$/.test(c.title) && shown.includes(c.title)).length;
    console.log(`QA-P34-01e: template check titles shown in English on the Arabic plan: ${english} of ${detail.checks.length}`);
    expect(english).toBe(0);
  });

  test('QA-P34-01f: the Arabic perimeter item shows its impact assessment and history without English server sentences (fixed, regression)', async ({ page, baseURL }) => {
    const dc = await arabicAs(page, baseURL!, PERSONA.pm);
    const items = (await (await page.request.get(`/api/v1/projects/${dc}/perimeter-items?pageSize=100`)).json()).items as { id: string; code: string }[];
    const it = items.find((x) => x.code === 'PI-003')!;
    const impacts = (await (await page.request.get(`/api/v1/projects/${dc}/perimeter-items/${it.id}/impact-assessments`)).json()).items as { entries: { summary: string }[] }[];
    const detail = await (await page.request.get(`/api/v1/projects/${dc}/perimeter-items/${it.id}`)).json();
    const english = [...impacts.flatMap((a) => a.entries.map((e) => e.summary)), ...(detail.history as { reason: string }[]).map((h) => h.reason)].filter(Boolean);
    await page.goto(`/projects/${dc}/perimeter/items/${it.id}`);
    await expect(page.getByTestId('impact-entries')).toBeVisible();
    const shown = await page.locator('main').innerText();
    const leaked = english.filter((s) => shown.includes(s));
    console.log(`QA-P34-01f: English impact summaries / history reasons visible on the Arabic item page (${leaked.length}/${english.length}): ${JSON.stringify(leaked.slice(0, 4))}`);
    expect(leaked).toEqual([]);
  });

  test('QA-P34-01g: the Arabic TSA page does not show the workstream name in English when the workstream has an Arabic name (fixed, regression)', async ({ page, baseURL }) => {
    const dc = await arabicAs(page, baseURL!, PERSONA.pm);
    const ws = (await (await page.request.get(`/api/v1/projects/${dc}/workstreams`)).json()).items as { code: string; name: string; nameAr: string | null }[];
    const ws07 = ws.find((w) => w.code === 'WS07')!;
    expect(ws07.nameAr).toBeTruthy();
    const tsas = (await (await page.request.get(`/api/v1/projects/${dc}/tsa-services?pageSize=100`)).json()).items as { id: string; name: string }[];
    await page.goto(`/projects/${dc}/readiness/tsa/${tsas.find((t) => /Legacy monitoring bridge/.test(t.name))!.id}`);
    await expect(page.getByTestId('tsa-detail')).toBeVisible();
    const shown = await page.getByTestId('tsa-detail').innerText();
    console.log(`QA-P34-01g: "${ws07.name}" shown: ${shown.includes(ws07.name)}; "${ws07.nameAr}" shown: ${shown.includes(ws07.nameAr!)}`);
    expect(shown).not.toContain(ws07.name);
  });

  test('QA-P34-01h: the Arabic KPI page does not show the template KPI definition in English — the KPI DTO carries the template Arabic definition (fixed, regression)', async ({ page, baseURL }) => {
    await loginAs(page, PERSONA.finance);
    await page.context().addCookies([{ name: 'hub_locale', value: 'ar', url: baseURL! }]);
    const dc = ((await (await page.request.get('/api/v1/projects?pageSize=100')).json()).items as { id: string; code: string }[]).find((p) => p.code === 'DEMO-DC')!.id;
    const kpis = (await (await page.request.get(`/api/v1/projects/${dc}/kpis?pageSize=100`)).json()).items as Record<string, unknown>[];
    const kpi = kpis.find((k) => k.key === 'action_closure_time')!;
    console.log(`QA-P34-01h: KPI fields include definitionAr: ${'definitionAr' in kpi}; nameAr: ${JSON.stringify(kpi.nameAr)}`);
    await page.goto(`/projects/${dc}/finance/kpis/${String(kpi.id)}`);
    await expect(page.getByTestId('kpi-detail')).toBeVisible();
    await expect(page.getByTestId('kpi-detail')).not.toContainText(String(kpi.definition));
  });

  test('QA-P34-03: at 390 px the perimeter item page does not scroll horizontally (fixed, regression)', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ viewport: MOBILE });
    try {
      const page = await ctx.newPage();
      await loginAs(page, PERSONA.pm);
      for (const locale of ['ar', 'en'] as const) {
        await ctx.addCookies([{ name: 'hub_locale', value: locale, url: baseURL! }]);
        const dc = ((await (await page.request.get('/api/v1/projects?pageSize=100')).json()).items as { id: string; code: string }[]).find((p) => p.code === 'DEMO-DC')!.id;
        const it = ((await (await page.request.get(`/api/v1/projects/${dc}/perimeter-items?pageSize=100`)).json()).items as { id: string; code: string }[]).find((x) => x.code === 'PI-003')!;
        await page.goto(`/projects/${dc}/perimeter/items/${it.id}`);
        await settle(page, locale);
        const r = await page.evaluate(() => {
          const vw = document.documentElement.clientWidth;
          let widest = { tag: '', testid: '', width: 0 };
          for (const el of Array.from(document.querySelectorAll('main *'))) {
            const w = (el as HTMLElement).getBoundingClientRect().width;
            if (w > widest.width && w > vw) widest = { tag: el.tagName.toLowerCase(), testid: el.closest('[data-testid]')?.getAttribute('data-testid') ?? '', width: Math.round(w) };
          }
          return { overflow: document.documentElement.scrollWidth - vw, widest };
        });
        console.log(`QA-P34-03 [${locale}] overflow ${r.overflow}px; widest element ${JSON.stringify(r.widest)}`);
        await page.screenshot({ path: join(SHOTS, `fixed-qa-p34-03-${locale}-390-perimeter-item.png`) });
        expect(r.overflow, locale).toBeLessThanOrEqual(1);
      }
    } finally {
      await ctx.close();
    }
  });

  test('QA-P34-01b: the Arabic TSA page shows the escalation\'s requested action and routing target without their English text (fixed, regression)', async ({ page, baseURL }, testInfo) => {
    await loginAs(page, PERSONA.pm);
    await page.context().addCookies([{ name: 'hub_locale', value: 'ar', url: baseURL! }]);
    const dc = ((await (await page.request.get('/api/v1/projects?pageSize=100')).json()).items as { id: string; code: string }[]).find((p) => p.code === 'DEMO-DC')!.id;
    const tsas = (await (await page.request.get(`/api/v1/projects/${dc}/tsa-services?pageSize=100`)).json()).items as { id: string; name: string }[];
    const id = tsas.find((t) => /Legacy monitoring bridge/.test(t.name))!.id;
    const t = await (await page.request.get(`/api/v1/projects/${dc}/tsa-services/${id}`)).json();
    expect(t.escalation, 'the demo TSA issue is escalated').toBeTruthy();
    await page.goto(`/projects/${dc}/readiness/tsa/${id}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const esc = page.getByTestId('tsa-escalation');
    await expect(esc).toBeVisible();
    await esc.screenshot({ path: join(SHOTS, 'fixed-qa-p34-01b-ar-tsa-escalation.png') });
    const shown = await esc.innerText();
    const leaked = [t.escalation.requestedAction as string, t.escalation.target as string].filter((s) => /[A-Za-z]{3}.*\s[A-Za-z]{3}/.test(s) && shown.includes(s));
    console.log(`QA-P34-01b: English escalation texts visible on the Arabic TSA page: ${JSON.stringify(leaked)}`);
    await testInfo.attach('qa-p34-01b.json', { body: JSON.stringify({ requestedAction: t.escalation.requestedAction, target: t.escalation.target, leaked }, null, 2), contentType: 'application/json' });
    expect(leaked).toEqual([]);
  });
});
