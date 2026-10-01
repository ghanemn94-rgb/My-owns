import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Browser, type Locator, type Page, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PERSONAS, apiSessionAs, loginAs, watchConsole } from './helpers';
import { checkArabic, checkDialogA11y, watchBilingual } from './qa-rtl-detector';

/**
 * Independent QA review of P5 (docs/reviews/P5-qa-review.md) — the AI PM Center through the UI, against the real API,
 * the real worker process and the demo seed (Simulated mock provider only; no real endpoint exists in this build).
 *
 *  A. Every AI PM Center screen and command dialog in English (LTR) and Arabic (RTL): the shared Arabic detector
 *     (qa-rtl-detector.ts) and axe WCAG 2.0/2.1 A/AA (serious/critical gate); mock output labelled "Simulated", real model
 *     endpoints "Not configured" (never "connected"); loading / error / empty / restricted states.
 *  B. The lead's approve() fix (invalidation kept in an autonomous transaction): what the approver sees after the 409 —
 *     the refusal translated, then the proposal no longer pending and the reason shown — in English and Arabic.
 *  C. P5 exit criterion "scheduled briefing after the browser closes": the subscription is made in the UI, every browser
 *     context is closed, the running worker process produces the briefing, and it is read afterwards in a new session
 *     (en + ar). Plus QA-P5-02 in the UI: a contributor may subscribe but cannot open the briefing delivered to them.
 *
 * Fixtures are synthetic and prepared through the APIs as the real demo personas. QA_P5_DB_OWNER_URL (owner URL of the
 * e2e database) lets C observe the worker's runs without any session; without it C polls the API.
 * Requirement IDs: REQ-UX-017, REQ-UX-001, REQ-UX-002, REQ-AI-001, REQ-AI-010, REQ-AI-021, REQ-AI-030, REQ-AI-033,
 * REQ-AI-034, REQ-AI-035, REQ-DEP-021.
 */
const SHOTS = join(__dirname, '..', 'screenshots', 'qa-p5');
mkdirSync(SHOTS, { recursive: true });
const STAMP = Date.now().toString(36).toUpperCase().slice(-6);
const MOBILE = { width: 390, height: 844 } as const;
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const MESSAGES = join(__dirname, '..', '..', 'apps', 'web', 'src', 'i18n', 'messages');
const AI = { en: JSON.parse(readFileSync(join(MESSAGES, 'en', 'ai.json'), 'utf8')), ar: JSON.parse(readFileSync(join(MESSAGES, 'ar', 'ai.json'), 'utf8')) };
const DB = process.env.QA_P5_DB_OWNER_URL ?? process.env.QA_P34_DB_OWNER_URL ?? null;

type Lang = 'en' | 'ar';

async function csrfOf(ctx: APIRequestContext): Promise<string> {
  return (await ctx.storageState()).cookies.find((c) => c.name === 'hub_csrf')?.value ?? '';
}
async function call(ctx: APIRequestContext, method: 'POST' | 'PUT' | 'PATCH', path: string, data: unknown) {
  const res = await ctx.fetch(path, { method, data, headers: { 'x-csrf-token': await csrfOf(ctx) } });
  return { status: res.status(), body: await res.json().catch(() => null) };
}
async function ok(ctx: APIRequestContext, method: 'POST' | 'PUT' | 'PATCH', path: string, data: unknown) {
  const r = await call(ctx, method, path, data);
  expect(r.status < 300, `${method} ${path} → HTTP ${r.status} ${JSON.stringify(r.body)}`).toBeTruthy();
  return r.body;
}
async function get(ctx: APIRequestContext, path: string) {
  const res = await ctx.get(path);
  expect(res.ok(), `GET ${path} → HTTP ${res.status()}`).toBeTruthy();
  return res.json();
}
/** Texts a stored run shows as recorded (claim texts, citation labels, headline): produced in the run's own language. */
async function runTexts(ctx: APIRequestContext, dc: string, runId: string): Promise<{ locale: string; texts: Set<string> }> {
  const r = await get(ctx, `/api/v1/projects/${dc}/ai/runs/${runId}`);
  const texts = new Set<string>([r.output?.headline].filter(Boolean));
  for (const c of r.output?.claims ?? []) {
    texts.add(String(c.text).trim());
    for (const x of c.citations ?? []) if (x.label) texts.add(String(x.label).trim());
  }
  for (const d of r.output?.detections ?? []) {
    if (d.label) texts.add(String(d.label).trim());
    if (d.detail) texts.add(String(d.detail).trim());
  }
  return { locale: r.locale, texts };
}
/** A detector problem whose visible text is exactly a recorded text of an English run (data shown as recorded). */
function isRunText(problem: string, run: { locale: string; texts: Set<string> }): boolean {
  if (run.locale !== 'en') return false;
  const m = problem.match(/ in \S+ "(.*)"$/) ?? problem.match(/shown: "(.*)" \(\S+\)$/);
  return !!m && run.texts.has(m[1]!.trim());
}

/** There is no GET-by-id route for proposals: the list (the reader's visible proposals) is searched, as the web does. */
async function proposalOf(ctx: APIRequestContext, dc: string, id: string) {
  for (let page = 1; page <= 50; page++) {
    const r = await get(ctx, `/api/v1/projects/${dc}/ai/proposals?page=${page}&pageSize=100`);
    const hit = (r.items as { id: string }[]).find((p) => p.id === id);
    if (hit) return hit as unknown as Record<string, unknown> & { runId: string; status: string; targetType: string | null; targetId: string | null; targetVersion: number | null; invalidatedReason: string | null; approvals: unknown[] };
    if (page * r.pageSize >= r.total) break;
  }
  throw new Error(`proposal ${id} not visible`);
}
async function userId(ctx: APIRequestContext, persona: string): Promise<string> {
  const users = (await get(ctx, '/api/v1/auth/demo-users')).items as { id: string; displayName: string }[];
  return users.find((u) => u.displayName === persona)!.id;
}
function sql(q: string): string {
  return execFileSync('psql', [DB!, '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', q], { encoding: 'utf8' }).trim();
}

interface Session {
  page: Page;
  problems: () => string[];
  bilingual: () => Promise<Set<string>>;
  /** Hosts other than the web origin that the browser requested (AT-22: assets, fonts and functions are served internally). */
  external: Set<string>;
  close: () => Promise<void>;
}
async function open(browser: Browser, baseURL: string, persona: string, locale: Lang, viewport?: { width: number; height: number }): Promise<Session> {
  const context = await browser.newContext(viewport ? { viewport } : {});
  const page = await context.newPage();
  const problems = watchConsole(page);
  const origin = new URL(baseURL).host;
  const external = new Set<string>();
  context.on('request', (r) => {
    const u = new URL(r.url());
    if (/^https?:$/.test(u.protocol) && u.host !== origin) external.add(u.host);
  });
  await loginAs(page, persona);
  await context.addCookies([{ name: 'hub_locale', value: locale, url: baseURL }]);
  const bilingual = watchBilingual(page);
  return { page, problems, bilingual, external, close: () => context.close() };
}
async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  await expect(page.getByTestId('loading-state')).toHaveCount(0, { timeout: 20_000 });
}
async function axe(page: Page, name: string, include?: string): Promise<string[]> {
  let b = new AxeBuilder({ page }).withTags(WCAG);
  if (include) b = b.include(include);
  const r = await b.analyze();
  const gating = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  console.log(`[${name}] axe: ${r.violations.length} WCAG violation(s) (${gating.length} serious/critical), ${r.passes.length} rules passed`);
  return gating.map((v) => `${name}: ${v.impact} ${v.id} ×${v.nodes.length}: ${v.help}`);
}
async function shot(page: Page, file: string, scope?: Locator) {
  const toastButtons = page.getByRole('status').getByRole('button');
  while ((await toastButtons.count()) > 0) await toastButtons.first().click().catch(() => undefined);
  if (scope) await scope.screenshot({ path: join(SHOTS, file) });
  else await page.screenshot({ path: join(SHOTS, file), fullPage: true });
}

/** Release a leftover emergency stop and put DEMO-DC back in Advisory (the seeded state) — fixture reset only. */
/**
 * Fix set-up (QA-P5-01): `cooldownHours` is the project's deduplication / cooldown window of AI actions. The fixture that
 * needs two pending proposals for the same reminder (one per scheduled briefing) turns it off (0); every other reset
 * restores the product default (24 h).
 */
async function resetDc(baseURL: string, dc: string, mode: 'advisory' | 'assisted' = 'advisory', cooldownHours = 24) {
  for (const persona of [PERSONAS.portfolioAdmin, PERSONAS.sponsor]) {
    const ctx = await apiSessionAs(baseURL, persona);
    try {
      const r = await call(ctx, 'POST', `/api/v1/projects/${dc}/ai/killswitch/release`, { reason: 'QA P5 fixture reset (synthetic)' });
      if (r.status < 300 || r.body?.code === 'ai.kill_switch_not_active') break;
    } finally {
      await ctx.dispose();
    }
  }
  const sp = await apiSessionAs(baseURL, PERSONAS.sponsor);
  try {
    const s = await get(sp, `/api/v1/projects/${dc}/ai/settings`);
    if (s.mode !== mode || s.provider !== 'mock' || s.actionCooldownHours !== cooldownHours) {
      await ok(sp, 'PUT', `/api/v1/projects/${dc}/ai/settings`, { expectedVersion: s.version, mode, provider: 'mock', actionCooldownHours: cooldownHours, reason: `QA P5 fixture: ${mode}, cooldown ${cooldownHours} h (synthetic)` });
    }
  } finally {
    await sp.dispose();
  }
}

test.describe.configure({ mode: 'serial' });

test.describe('QA P5 — AI PM Center in English and Arabic, approval invalidation as the user sees it, briefing after the browser closes [REQ-UX-017, REQ-UX-001, REQ-UX-002, REQ-AI-001, REQ-AI-010, REQ-AI-021, REQ-AI-030, REQ-AI-033, REQ-AI-034]', () => {
  let dc = '';
  let pmId = '';
  const proposals: string[] = [];
  let runId = '';
  const crawlProblems: Record<Lang, string[]> = { en: [], ar: [] };
  let briefing: { secretaryRun: string | null; closedAt: string; contexts: number; contributorRun: string | null; observedBy: string } = { secretaryRun: null, closedAt: '', contexts: -1, contributorRun: null, observedBy: DB ? 'database (no session)' : 'API' };

  test.beforeAll(async ({ baseURL }) => {
    test.setTimeout(420_000);
    const pm = await apiSessionAs(baseURL!, PERSONAS.pm);
    try {
      dc = ((await get(pm, '/api/v1/projects?pageSize=100')).items as { id: string; code: string }[]).find((p) => p.code === 'DEMO-DC')!.id;
      pmId = await userId(pm, PERSONAS.pm);
      // Two pending proposals for the same reminder are needed below: deduplication off for the fixture (QA-P5-01).
      await resetDc(baseURL!, dc, 'advisory', 0);
      // An overdue task owned by the PM (as p5-ai.spec.ts does) so the Simulated briefing has a reminder to prepare.
      const ws = (await get(pm, `/api/v1/projects/${dc}/workstreams`)).items as { id: string }[];
      const day = (o: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + o * 86_400_000));
      await ok(pm, 'POST', `/api/v1/projects/${dc}/tasks`, { workstreamId: ws[0]!.id, title: `QA P5 overdue follow-up ${STAMP} (synthetic)`, plannedStart: day(-12), plannedFinish: day(-3), accountableUserId: pmId });
      // Two fresh proposals prepared by the WORKER from the PM's scheduled briefing (one per minute), then the schedule is paused.
      const since = new Date().toISOString();
      await ok(pm, 'POST', `/api/v1/projects/${dc}/ai/briefings`, { kind: 'weekly', cron: '* * * * *', timezone: 'Asia/Riyadh', enabled: true });
      try {
        await expect
          .poll(
            async () => {
              const r = (await get(pm, `/api/v1/projects/${dc}/ai/proposals?status=proposed&pageSize=100`)).items as { id: string; createdAt: string; requestedBy: string; actionType: string; targetType: string | null }[];
              const mine = r.filter((p) => p.createdAt > since && p.requestedBy === pmId && p.actionType === 'create_internal_notification' && p.targetType);
              proposals.splice(0, proposals.length, ...mine.map((p) => p.id).reverse());
              return proposals.length;
            },
            { timeout: 300_000, intervals: [3000] },
          )
          .toBeGreaterThanOrEqual(2);
      } finally {
        await ok(pm, 'POST', `/api/v1/projects/${dc}/ai/briefings`, { kind: 'weekly', cron: '* * * * *', timezone: 'Asia/Riyadh', enabled: false });
      }
      runId = (await proposalOf(pm, dc, proposals[0]!)).runId;
      console.log(`QA P5 fixtures: DEMO-DC ${dc}; worker-prepared proposals ${JSON.stringify(proposals)}; run ${runId}`);
    } finally {
      await pm.dispose();
    }
  });

  test.afterAll(async ({ baseURL }) => {
    await resetDc(baseURL!, dc);
  });

  // ---------------------------------------------------------------------------------------------------------------
  // A. Every screen and dialog in both languages.

  for (const lang of ['en', 'ar'] as const) {
    test(`A-${lang}: every AI PM Center screen and command dialog — ${lang === 'ar' ? 'Arabic detector + ' : ''}axe serious/critical = 0; Simulated / Not configured labels; restricted state`, async ({ browser, baseURL }, testInfo) => {
      test.setTimeout(400_000);
      const problems: string[] = [];
      const L = AI[lang];
      const check = async (s: Session, name: string, scope?: Locator) => {
        await settle(s.page);
        await expect(s.page.locator('html')).toHaveAttribute('lang', lang);
        await expect(s.page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
        if (lang === 'ar') problems.push(...(await checkArabic(s.page, testInfo, SHOTS, `p5-${name}`, s.bilingual, { scope, strict: false })));
        else await (scope ? scope.screenshot({ path: join(SHOTS, `en-p5-${name}.png`) }) : s.page.screenshot({ path: join(SHOTS, `en-p5-${name}.png`), fullPage: true }));
        problems.push(...(await axe(s.page, `${lang} ${name}`, scope ? 'dialog[open]' : undefined)));
        // AT-22 (web side): every asset, font and API call of the screen is served by the platform's own origin.
        problems.push(...[...s.external].map((h) => `${lang}: request to an external host ${h}`));
      };
      const dialogCheck = async (s: Session, name: string, opener: Locator) => {
        await opener.click();
        const d = s.page.getByRole('dialog');
        await checkDialogA11y(s.page, d, `${lang} ${name}`);
        await check(s, name, d);
        await s.page.keyboard.press('Escape');
        await expect(d).toBeHidden();
      };

      // PM: overview, ask (a real Simulated answer), proposals, a worker-prepared proposal (+ revise / reject dialogs), runs, run, briefings.
      const pm = await open(browser, baseURL!, PERSONAS.pm, lang);
      try {
        const { page } = pm;
        await page.goto(`/projects/${dc}/ai`);
        await expect(page.getByTestId('ai-status')).toBeVisible();
        await check(pm, 'overview');
        await expect(page.getByTestId('fact-provider')).toContainText(L.common.simulated);
        for (const p of ['openai_compatible', 'anthropic']) {
          await expect(page.getByTestId(`endpoint-${p}`).locator('[data-provider-status]')).toHaveAttribute('data-provider-status', 'not_configured');
          await expect(page.getByTestId(`endpoint-${p}`)).toContainText(L.providerStatus.not_configured);
        }
        await expect(page.locator('#main-content')).not.toContainText(lang === 'en' ? /\bconnected\b/i : /متصل/);

        await page.goto(`/projects/${dc}/ai/ask`);
        await expect(page.getByTestId('ask-form-panel')).toBeVisible();
        await page.getByTestId('ask-question').fill(lang === 'en' ? 'What is overdue and who owns it?' : 'ما المتأخر ومن المالك المسؤول عنه؟');
        await page.getByTestId('ask-submit').click();
        const result = page.getByTestId('ask-result');
        await expect(result).toBeVisible({ timeout: 30_000 });
        await expect(result.getByTestId('simulated-badge').first()).toContainText(L.common.simulated);
        await expect(result.getByTestId('simulated-notice')).toContainText(L.common.simulatedLong);
        await expect(result.getByTestId('answer-disclaimer')).toContainText(lang === 'en' ? 'SIMULATED' : 'محاكاة');
        await check(pm, 'ask-answer');

        await page.goto(`/projects/${dc}/ai/proposals`);
        await expect(page.getByTestId('proposals-table').locator('table')).toBeVisible();
        await check(pm, 'proposals');

        await page.goto(`/projects/${dc}/ai/proposals/${proposals[0]}`);
        await expect(page.getByTestId('proposal-binding')).toBeVisible();
        await expect(page.getByTestId('proposal-simulated')).toBeVisible();
        await expect(page.getByTestId('approve-unavailable')).toHaveAttribute('data-reason', 'selfApproval');
        await check(pm, 'proposal-detail-requester');
        await dialogCheck(pm, 'dialog-revise', page.getByTestId('cmd-revise'));
        if ((await page.getByTestId('cmd-reject').count()) > 0) await dialogCheck(pm, 'dialog-reject', page.getByTestId('cmd-reject'));

        await page.goto(`/projects/${dc}/ai/runs`);
        await expect(page.getByTestId('runs-table').locator('table')).toBeVisible();
        await check(pm, 'runs');
        await page.goto(`/projects/${dc}/ai/runs/${runId}`);
        await expect(page.getByTestId('run-detail')).toBeVisible();
        await expect(page.getByTestId('run-output')).toBeVisible();
        await expect(page.getByTestId('simulated-badge').first()).toContainText(L.common.simulated);
        await check(pm, 'run-detail');

        await page.goto(`/projects/${dc}/ai/briefings`);
        await expect(page.getByTestId('detections-table').locator('table')).toBeVisible();
        await check(pm, 'briefings-detections');

        // 390 px: no page-level horizontal overflow on the overview and the run.
        for (const path of ['', `/runs/${runId}`]) {
          await page.setViewportSize(MOBILE);
          await page.goto(`/projects/${dc}/ai${path}`);
          await settle(page);
          const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          if (over > 1) problems.push(`${lang} 390px ai${path}: page ${over}px wider than the viewport`);
          await page.screenshot({ path: join(SHOTS, `${lang}-390-p5-${path ? 'run' : 'overview'}.png`), fullPage: true });
        }
        expect(pm.problems(), pm.problems().join('\n')).toEqual([]);
      } finally {
        await pm.close();
      }

      // Sponsor: settings, the save-review dialog (a pending change, nothing saved) and the emergency-stop dialog.
      const sp = await open(browser, baseURL!, PERSONAS.sponsor, lang);
      try {
        const { page } = sp;
        await page.goto(`/projects/${dc}/ai/settings`);
        await expect(page.getByTestId('settings-form')).toBeVisible();
        await check(sp, 'settings');
        const budget = page.getByTestId('settings-budget');
        const cur = await budget.inputValue();
        await budget.fill(String(Number(cur || '0') + 1000));
        await dialogCheck(sp, 'dialog-settings-review', page.getByTestId('settings-save'));
        await budget.fill(cur);
        await dialogCheck(sp, 'dialog-emergency-stop', page.getByTestId('kill-switch-activate'));
        const after = await sp.page.request.get(`/api/v1/projects/${dc}/ai/settings`);
        expect((await after.json()).killSwitch, 'nothing was submitted').toBe(false);
      } finally {
        await sp.close();
      }

      // Secretary (an approver) in Advisory mode: approval is not offered, with the reason; the reject dialog.
      const sec = await open(browser, baseURL!, PERSONAS.secretary, lang);
      try {
        const { page } = sec;
        await page.goto(`/projects/${dc}/ai/proposals/${proposals[0]}`);
        await expect(page.getByTestId('approve-unavailable')).toHaveAttribute('data-reason', 'mode');
        await check(sec, 'proposal-detail-approver-advisory');
        await expect(page.getByTestId('cmd-reject')).toBeVisible();
        await dialogCheck(sec, 'dialog-reject-approver', page.getByTestId('cmd-reject'));
      } finally {
        await sec.close();
      }

      // Contributor (no status / proposals permissions; own runs only — QA-P5-02) and Clean Team (no AI permission at all).
      // Fix status (QA-P5-02): the runs page was asserted restricted for the contributor here; it now lists their own runs.
      const co = await open(browser, baseURL!, PERSONAS.contributor, lang);
      try {
        await co.page.goto(`/projects/${dc}/ai`);
        await expect(co.page.getByTestId('ai-status-unavailable')).toBeVisible();
        await check(co, 'overview-contributor');
        await co.page.goto(`/projects/${dc}/ai/runs`);
        await expect(co.page.getByTestId('runs-table')).toBeVisible();
        await expect(co.page.getByTestId('restricted-state')).toHaveCount(0);
      } finally {
        await co.close();
      }
      const ct = await open(browser, baseURL!, PERSONAS.cleanTeam, lang);
      try {
        await ct.page.goto(`/projects/${dc}/ai`);
        await expect(ct.page.getByTestId('restricted-state')).toBeVisible();
        await expect(ct.page.getByTestId('ai-tabs')).toHaveCount(0);
        await check(ct, 'restricted-clean-team');
      } finally {
        await ct.close();
      }

      crawlProblems[lang] = [...new Set(problems)];
      // Classified after checking the API (each class printed with its id; anything else fails the test):
      //  DATA-question: a question a user typed in English (the A-en pass) shown as entered in "my runs";
      //  DATA-run-en:   the output of a run produced in English (the PM's saved language), shown as recorded;
      //  QA-P5-04:      an Arabic run / the Arabic detections show English template task titles (titleAr exists) — own DEFECT test.
      const pmApi = await apiSessionAs(baseURL!, PERSONAS.pm);
      const pmRun = await runTexts(pmApi, dc, runId).finally(() => pmApi.dispose());
      const CLASSIFIED: { id: string; test: (p: string) => boolean }[] = [
        { id: 'DATA-question', test: (p) => /"What is overdue and who owns it\?"/.test(p) },
        { id: 'DATA-run-en', test: (p) => p.startsWith('p5-run-detail: ') && isRunText(p, pmRun) },
        { id: 'QA-P5-04', test: (p) => /^p5-(ask-answer|briefings-detections): English UI message fragment shown: "Assess applicability" in span "WS03-A04 /.test(p) },
      ];
      const unclassified = crawlProblems[lang].filter((p) => !CLASSIFIED.some((c) => c.test(p)));
      for (const c of CLASSIFIED) {
        const n = crawlProblems[lang].filter((p) => c.test(p)).length;
        if (n) console.log(`A-${lang}: CLASSIFIED ${c.id}: ${n}`);
      }
      console.log(`A-${lang}: ${crawlProblems[lang].length} problem(s), UNCLASSIFIED ${unclassified.length}\n  ${crawlProblems[lang].join('\n  ')}`);
      await testInfo.attach(`qa-p5-crawl-${lang}.json`, { body: JSON.stringify(crawlProblems[lang], null, 2), contentType: 'application/json' });
      expect(unclassified, unclassified.join('\n')).toEqual([]);
    });
  }

  test('A-states: loading, error (with correlation id and Retry) and empty states of the AI PM Center lists', async ({ browser, baseURL }) => {
    test.setTimeout(180_000);
    const pm = await open(browser, baseURL!, PERSONAS.pm, 'en');
    try {
      const { page } = pm;
      // Loading: the runs list answers 3 s late.
      await page.route(/\/api\/v1\/projects\/[^/]+\/ai\/runs\?/, async (route) => {
        await new Promise((r) => setTimeout(r, 3_000));
        await route.continue().catch(() => undefined);
      });
      await page.goto(`/projects/${dc}/ai/runs`);
      await expect(page.getByTestId('runs-table').getByTestId('loading-state')).toBeVisible();
      await expect(page.getByTestId('runs-table').locator('table')).toBeVisible({ timeout: 20_000 });
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      // Error: the runs list fails (500 problem+json); the error state shows the correlation id; Retry recovers.
      await page.route(/\/api\/v1\/projects\/[^/]+\/ai\/runs\?/, (route) =>
        route.fulfill({ status: 500, contentType: 'application/problem+json', body: JSON.stringify({ type: 'about:blank', title: 'Internal Server Error', status: 500, code: 'internal', correlationId: 'qa-p5-injected-500' }) }),
      );
      await page.reload();
      const err = page.getByTestId('runs-table').getByRole('alert');
      await expect(err).toBeVisible({ timeout: 20_000 });
      await expect(err).toContainText('qa-p5-injected-500');
      await shot(page, 'en-p5-state-error-runs.png');
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await err.getByRole('button').click();
      await expect(page.getByTestId('runs-table').locator('table')).toBeVisible({ timeout: 20_000 });
      // Empty: a proposal status with no rows (filtered empty state).
      let empty: string | null = null;
      for (const s of ['failed', 'expired', 'executing', 'rejected', 'cancelled']) {
        const r = await (await page.request.get(`/api/v1/projects/${dc}/ai/proposals?status=${s}&pageSize=1`)).json();
        if (r.total === 0) {
          empty = s;
          break;
        }
      }
      test.skip(empty === null, 'every proposal status has rows in this database (no empty filter available)');
      await page.goto(`/projects/${dc}/ai/proposals?status=${empty}`);
      await expect(page.getByTestId('proposals-table')).toContainText(AI.en.proposals.emptyFiltered);
      await shot(page, 'en-p5-state-empty-proposals.png');
      expect(pm.problems().filter((p) => !/500|Internal Server Error/.test(p)), pm.problems().join('\n')).toEqual([]);
    } finally {
      await pm.close();
    }
  });

  let arabicRun: { bilingualTasks: number; askEnglish: string[]; askRawStatus: string[]; detectionsEnglish: string[]; detectionsArabic: number } | null = null;

  test('CONTROL QA-P5-04: an Arabic question is answered (Simulated) and the Arabic rules-only detections list the template tasks; the plan API carries an Arabic title for them', async ({ browser, baseURL }) => {
    test.setTimeout(150_000);
    const pm = await open(browser, baseURL!, PERSONAS.pm, 'ar');
    try {
      const { page } = pm;
      const tasks: { title: string; titleAr: string | null }[] = [];
      for (let p = 1; p <= 10; p++) {
        const r = await (await page.request.get(`/api/v1/projects/${dc}/tasks?page=${p}&pageSize=100`)).json();
        tasks.push(...(r.items as { title: string; titleAr: string | null }[]));
        if (p * 100 >= r.total) break;
      }
      const bilingual = tasks.filter((t) => t.titleAr && t.titleAr !== t.title);
      await page.goto(`/projects/${dc}/ai/ask`);
      await page.getByTestId('ask-question').fill('ما المهام المتأخرة أو التي بلا مالك؟');
      await page.getByTestId('ask-submit').click();
      const result = page.getByTestId('ask-result');
      await expect(result).toBeVisible({ timeout: 30_000 });
      await expect(result.getByTestId('simulated-badge').first()).toContainText(AI.ar.common.simulated);
      const askText = await result.innerText();
      await shot(page, 'qa-p5-04-ar-answer-titles.png');
      await page.goto(`/projects/${dc}/ai/briefings`);
      await expect(page.getByTestId('detections-table').locator('tbody tr').first()).toBeVisible();
      await settle(page);
      const detText = await page.getByTestId('detections-table').innerText();
      await shot(page, 'qa-p5-04-ar-detections-titles.png');
      arabicRun = {
        bilingualTasks: bilingual.length,
        askEnglish: bilingual.filter((t) => askText.includes(t.title)).map((t) => t.title),
        askRawStatus: [...new Set(askText.match(/(الحالة|status) (draft|not_started|in_progress|blocked|submitted_for_acceptance)/g) ?? [])],
        detectionsEnglish: bilingual.filter((t) => detText.includes(t.title)).map((t) => t.title),
        detectionsArabic: bilingual.filter((t) => detText.includes(t.titleAr!)).length,
      };
      console.log(`QA-P5-04: ${JSON.stringify({ ...arabicRun, askEnglish: arabicRun.askEnglish.slice(0, 5), detectionsEnglish: arabicRun.detectionsEnglish.slice(0, 5), askEnglishCount: arabicRun.askEnglish.length, detectionsEnglishCount: arabicRun.detectionsEnglish.length })}`);
      expect(arabicRun.bilingualTasks).toBeGreaterThan(10);
      expect(arabicRun.askEnglish.length + arabicRun.detectionsEnglish.length + arabicRun.detectionsArabic).toBeGreaterThan(0);
    } finally {
      await pm.close();
    }
  });

  test('QA-P5-04 (fixed, regression): in Arabic, the AI answer and the rules-only detections show template tasks by their Arabic title with a translated status (not the English title or the raw status enum)', async () => {
    test.skip(!arabicRun, 'needs the CONTROL above');
    expect(arabicRun!.askEnglish).toEqual([]);
    expect(arabicRun!.askRawStatus).toEqual([]);
    expect(arabicRun!.detectionsEnglish).toEqual([]);
  });

  let recipientView: { recipientId: string; recipientName: string; taskOwnerNameInPlan: boolean; shownRecipient: string; shownRequester: string } | null = null;

  test('CONTROL QA-P5-05: the approver (Secretary) sees the PM\'s name as the owner on the plan, while the proposal they must review names the PM as recipient and requester', async ({ browser, baseURL }) => {
    const pm = await apiSessionAs(baseURL!, PERSONAS.pm);
    const p = await proposalOf(pm, dc, proposals[0]!).finally(() => pm.dispose());
    const sec = await open(browser, baseURL!, PERSONAS.secretary, 'en');
    try {
      const recipientId = String((p.payload as { recipientUserId: string }).recipientUserId);
      const task = await (await sec.page.request.get(`/api/v1/projects/${dc}/tasks/${p.targetId}`)).json();
      await sec.page.goto(`/projects/${dc}/ai/proposals/${proposals[0]}`);
      await expect(sec.page.getByTestId('proposal-binding')).toBeVisible();
      await settle(sec.page);
      recipientView = {
        recipientId,
        recipientName: PERSONAS.pm,
        taskOwnerNameInPlan: JSON.stringify(task).includes(PERSONAS.pm),
        shownRecipient: (await sec.page.getByTestId('payload-recipient').innerText()).replace(/\s+/g, ' '),
        shownRequester: (await sec.page.getByTestId('proposal-requester').innerText()).replace(/\s+/g, ' '),
      };
      await shot(sec.page, 'qa-p5-05-approver-sees-recipient.png', sec.page.getByTestId('proposal-change'));
      console.log(`QA-P5-05: ${JSON.stringify(recipientView)}`);
      expect(recipientId).toBe(pmId);
      expect(recipientView.taskOwnerNameInPlan).toBe(true);
    } finally {
      await sec.close();
    }
  });

  test('QA-P5-05 (fixed, regression): the approver can tell who will receive the AI message (the recipient\'s name is shown on the proposal under review)', async () => {
    test.skip(!recipientView, 'needs the CONTROL above');
    expect(recipientView!.shownRecipient).toContain(recipientView!.recipientName);
  });

  // ---------------------------------------------------------------------------------------------------------------
  // B. approve() refused because the target changed: the invalidation is kept and shown (en, ar).

  const changeTarget = async (baseURL: string, proposalId: string) => {
    const pm = await apiSessionAs(baseURL, PERSONAS.pm);
    try {
      const p = await proposalOf(pm, dc, proposalId);
      const base = `/api/v1/projects/${dc}`;
      if (p.targetType === 'task') {
        const t = await get(pm, `${base}/tasks/${p.targetId}`);
        await ok(pm, 'PATCH', `${base}/tasks/${p.targetId}`, { expectedVersion: t.version, effort: `QA P5 ${STAMP} (synthetic)` });
      } else if (p.targetType === 'milestone') {
        const m = await get(pm, `${base}/milestones/${p.targetId}`);
        await ok(pm, 'PATCH', `${base}/milestones/${p.targetId}`, { expectedVersion: m.version, titleAr: m.titleAr ?? null });
      } else throw new Error(`unexpected proposal target ${p.targetType}`);
      return p as { targetType: string; targetId: string; targetVersion: number };
    } finally {
      await pm.dispose();
    }
  };

  for (const [i, lang] of [[0, 'en'], [1, 'ar']] as const) {
    test(`B-${lang}: the approver's approval is refused because the target changed (409) — the refusal is translated, and after "Reload and review" the proposal is no longer pending and shows the reason [AT-18, REQ-AI-030]`, async ({ browser, baseURL }, testInfo) => {
      test.setTimeout(240_000);
      await resetDc(baseURL!, dc, 'assisted');
      const L = AI[lang];
      const proposalId = proposals[i]!;
      const sec = await open(browser, baseURL!, PERSONAS.secretary, lang);
      const api = await apiSessionAs(baseURL!, PERSONAS.secretary);
      try {
        const { page } = sec;
        const pendingBefore = (await get(api, `/api/v1/projects/${dc}/ai/proposals?status=proposed&pageSize=1`)).total as number;
        await page.goto(`/projects/${dc}/ai/proposals/${proposalId}`);
        await expect(page.getByTestId('proposal-status')).toHaveAttribute('data-status', 'proposed');
        await expect(page.getByTestId('cmd-approve')).toBeVisible();
        // Meanwhile the target record changes (the PM edits it): the version the proposal was prepared against is stale.
        const before = await changeTarget(baseURL!, proposalId);
        await page.getByTestId('cmd-approve').click();
        const d = page.getByRole('dialog');
        await expect(d).toBeVisible();
        await d.getByTestId('dialog-confirm').click();
        const err = d.getByTestId('dialog-error');
        await expect(err).toHaveAttribute('data-code', 'ai.approval_invalidated');
        await expect(err).toContainText(L.errors.ai.approval_invalidated);
        await expect(err.getByTestId('reload-and-review')).toBeVisible();
        await shot(page, `${lang}-p5-B-approval-refused-dialog.png`, d);
        if (lang === 'ar') {
          const pr = await checkArabic(page, testInfo, SHOTS, 'p5-B-refusal-dialog', sec.bilingual, { scope: d, strict: false });
          expect(pr, pr.join('\n')).toEqual([]);
        }
        const ax = await axe(page, `${lang} B refusal dialog`, 'dialog[open]');
        expect(ax, ax.join('\n')).toEqual([]);
        await err.getByTestId('reload-and-review').click();
        await expect(d).toBeHidden();
        // After reload: no longer pending, the reason shown, approval not offered (and the server agrees).
        await expect(page.getByTestId('proposal-status')).toHaveAttribute('data-status', 'invalidated');
        await expect(page.getByTestId('proposal-reason')).toContainText(L.reasons.target_version_changed);
        await expect(page.getByTestId('cmd-approve')).toHaveCount(0);
        await expect(page.getByTestId('approve-unavailable')).toHaveAttribute('data-reason', 'notPending');
        await shot(page, `${lang}-p5-B-proposal-invalidated.png`);
        if (lang === 'ar') {
          const pr = await checkArabic(page, testInfo, SHOTS, 'p5-B-proposal-invalidated', sec.bilingual, { strict: false });
          expect(pr, pr.join('\n')).toEqual([]);
        }
        const p = await proposalOf(api, dc, proposalId);
        expect(p).toMatchObject({ status: 'invalidated', invalidatedReason: 'target_version_changed', approvals: [] });
        const pendingAfter = (await get(api, `/api/v1/projects/${dc}/ai/proposals?status=proposed&pageSize=100`)) as { total: number; items: { id: string }[] };
        expect(pendingAfter.items.map((x) => x.id)).not.toContain(proposalId);
        expect(pendingAfter.total).toBe(pendingBefore - 1);
        // The pending list and the overview count in the UI follow.
        await page.goto(`/projects/${dc}/ai/proposals?status=proposed`);
        await expect(page.getByTestId('proposals-table')).toBeVisible();
        await settle(page);
        await expect(page.locator(`[data-testid="proposal-link"][href$="${proposalId}"]`)).toHaveCount(0);
        console.log(`B-${lang}: target ${before.targetType} v${before.targetVersion} changed before approval → 409 ai.approval_invalidated shown as "${(await page.title()) && L.errors.ai.approval_invalidated}"; proposal ${p.status} (${p.invalidatedReason}); pending ${pendingBefore} → ${pendingAfter.total}`);
        expect(sec.problems().filter((x) => !/409/.test(x)), sec.problems().join('\n')).toEqual([]);
      } finally {
        await api.dispose();
        await sec.close();
      }
      // The requester (PM) sees the same: invalidated with the reason, and may revise it for a fresh review.
      const pm = await open(browser, baseURL!, PERSONAS.pm, lang);
      try {
        await pm.page.goto(`/projects/${dc}/ai/proposals/${proposalId}`);
        await expect(pm.page.getByTestId('proposal-status')).toHaveAttribute('data-status', 'invalidated');
        await expect(pm.page.getByTestId('proposal-reason')).toContainText(L.reasons.target_version_changed);
        await expect(pm.page.getByTestId('cmd-revise')).toBeVisible();
      } finally {
        await pm.close();
        await resetDc(baseURL!, dc);
      }
    });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // C. Scheduled briefing after the browser closes (worker process), read afterwards in a new session.

  const waitForScheduledRun = async (baseURL: string, persona: string, after: string): Promise<string> => {
    const ctx = await apiSessionAs(baseURL, PERSONAS.pm);
    let uid = '';
    try {
      uid = await userId(ctx, persona);
    } finally {
      await ctx.dispose();
    }
    let found: string | null = null;
    await expect
      .poll(
        async () => {
          if (DB) {
            found = sql(`select id from ai_run where project_id = '${dc}' and requested_by = '${uid}' and trigger = 'scheduled' and created_at > '${after}' and status = 'succeeded' order by created_at limit 1`) || null;
          } else {
            const api = await apiSessionAs(baseURL, persona);
            try {
              const r = await api.get(`/api/v1/projects/${dc}/ai/runs?pageSize=20`);
              const items = r.ok() ? ((await r.json()).items as { id: string; trigger: string; status: string; createdAt: string }[]) : [];
              found = items.find((x) => x.trigger === 'scheduled' && x.status === 'succeeded' && x.createdAt > after)?.id ?? null;
            } finally {
              await api.dispose();
            }
          }
          return found;
        },
        { timeout: 180_000, intervals: [3000] },
      )
      .not.toBeNull();
    return found!;
  };
  const pauseBriefing = async (baseURL: string, persona: string) => {
    const api = await apiSessionAs(baseURL, persona);
    try {
      await ok(api, 'POST', `/api/v1/projects/${dc}/ai/briefings`, { kind: 'daily', cron: '* * * * *', timezone: 'Asia/Riyadh', enabled: false });
    } finally {
      await api.dispose();
    }
  };

  test('C: a briefing subscribed in the UI is produced by the worker after every browser context is closed, and is read in a new session with its citations (en, ar) [REQ-AI-001, REQ-AI-010]', async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(360_000);
    const a = await open(browser, baseURL!, PERSONAS.secretary, 'en');
    await a.page.goto(`/projects/${dc}/ai/briefings`);
    await a.page.getByTestId('briefing-kind').selectOption('daily');
    await a.page.getByTestId('briefing-cron').fill('* * * * *');
    await a.page.getByTestId('briefing-subscribe').click();
    await expect(a.page.getByTestId('briefing-toggle-daily')).toHaveText(AI.en.briefings.pause);
    await a.close();
    briefing.closedAt = new Date().toISOString();
    briefing.contexts = browser.contexts().length;
    let run = '';
    try {
      run = await waitForScheduledRun(baseURL!, PERSONAS.secretary, briefing.closedAt);
    } finally {
      await pauseBriefing(baseURL!, PERSONAS.secretary);
    }
    briefing.secretaryRun = run;
    console.log(`C: browser contexts open while waiting: ${briefing.contexts}; scheduled run ${run} found after ${briefing.closedAt} (observed via ${briefing.observedBy})`);
    expect(briefing.contexts).toBe(0);

    for (const lang of ['en', 'ar'] as const) {
      const L = AI[lang];
      const b = await open(browser, baseURL!, PERSONAS.secretary, lang);
      try {
        const { page } = b;
        await page.goto(`/projects/${dc}/ai/runs`);
        await expect(page.getByTestId('runs-table').locator('table')).toBeVisible();
        await settle(page);
        const row = page.getByTestId('runs-table').locator('tbody tr').filter({ has: page.locator(`[data-testid="run-link"][href$="${run}"]`) });
        await expect(row).toContainText(L.triggers.scheduled);
        await expect(row.getByTestId('simulated-badge')).toBeVisible();
        await row.getByTestId('run-link').click();
        await expect(page.getByTestId('run-detail')).toHaveAttribute('data-run-id', run);
        await expect(page.getByTestId('run-detail')).toContainText(L.triggers.scheduled);
        await expect(page.getByTestId('answer-claim').first()).toBeVisible();
        await shot(page, `${lang}-p5-C-scheduled-briefing-run.png`);
        if (lang === 'ar') {
          // The Secretary's saved language is English, so the worker wrote this briefing in English: its recorded texts are
          // data (classified by exact match with the run's API texts); the Arabic page chrome must have no problem.
          const api = await apiSessionAs(baseURL!, PERSONAS.secretary);
          const rec = await runTexts(api, dc, run).finally(() => api.dispose());
          const pr = await checkArabic(page, testInfo, SHOTS, 'p5-C-scheduled-briefing-run', b.bilingual, { strict: false });
          const unclassified = pr.filter((p) => !isRunText(p, rec));
          console.log(`C-ar: run locale ${rec.locale}; ${pr.length} problem(s), ${pr.length - unclassified.length} classified DATA-run-en, UNCLASSIFIED ${unclassified.length}`);
          expect(unclassified, unclassified.join('\n')).toEqual([]);
        } else {
          // Every claim carries a citation; the first linked citation opens its record for this user.
          const claims = page.getByTestId('answer-claim');
          const n = await claims.count();
          for (let k = 0; k < n; k++) expect(await claims.nth(k).locator('[data-citation-id]').count(), `claim ${k}`).toBeGreaterThan(0);
          const link = page.getByTestId('citation-link').first();
          const href = await link.getAttribute('href');
          await link.click();
          await page.waitForURL((u) => u.pathname === href);
          await settle(page);
          await expect(page.getByTestId('restricted-state')).toHaveCount(0);
          console.log(`C: ${n} claim(s), each cited; first citation opened ${href}`);
        }
        expect(b.problems(), b.problems().join('\n')).toEqual([]);
      } finally {
        await b.close();
      }
    }
  });

  test('C-contributor CONTROL: a contributor subscribes in the UI (the Briefings tab is offered), closes the browser, and the worker delivers their briefing', async ({ browser, baseURL }) => {
    test.setTimeout(300_000);
    test.skip(!DB, 'QA_P5_DB_OWNER_URL is needed to observe a contributor\'s run (a contributor cannot list runs)');
    const a = await open(browser, baseURL!, PERSONAS.contributor, 'en');
    await a.page.goto(`/projects/${dc}/ai/briefings`);
    await a.page.getByTestId('briefing-kind').selectOption('daily');
    await a.page.getByTestId('briefing-cron').fill('* * * * *');
    await a.page.getByTestId('briefing-subscribe').click();
    await expect(a.page.getByTestId('briefing-toggle-daily')).toHaveText(AI.en.briefings.pause);
    await a.close();
    const after = new Date().toISOString();
    try {
      briefing.contributorRun = await waitForScheduledRun(baseURL!, PERSONAS.contributor, after);
    } finally {
      await pauseBriefing(baseURL!, PERSONAS.contributor);
    }
    const note = sql(`select link from notification where ai_proposal_id is null and kind = 'ai_briefing' and link like '%${briefing.contributorRun}'`);
    console.log(`C-contributor: run ${briefing.contributorRun}; in-app notification link ${note}`);
    expect(note).toBe(`/projects/${dc}/ai/runs/${briefing.contributorRun}`);
  });

  test('QA-P5-02 (fixed, regression) (UI): the contributor opens the briefing delivered to them', async ({ browser, baseURL }) => {
    test.skip(!briefing.contributorRun, 'needs the contributor run of the CONTROL above');
    const b = await open(browser, baseURL!, PERSONAS.contributor, 'en');
    try {
      await b.page.goto(`/projects/${dc}/ai/runs/${briefing.contributorRun}`);
      await settle(b.page);
      await shot(b.page, 'qa-p5-02-contributor-opens-own-briefing.png');
      await expect(b.page.getByTestId('run-detail')).toBeVisible({ timeout: 5_000 });
    } finally {
      await b.close();
    }
  });
});
