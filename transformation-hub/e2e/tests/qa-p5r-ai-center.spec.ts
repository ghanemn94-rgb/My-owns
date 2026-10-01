import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PERSONAS, apiSessionAs, loginAs, watchConsole } from './helpers';
import { checkArabic, checkDialogA11y, watchBilingual } from './qa-rtl-detector';

/**
 * Independent QA RE-CHECK of P5 (docs/reviews/P5-qa-recheck.md) — the fixes of the P5 QA review through the AI PM Center, in
 * English and Arabic, against the real API, the real worker process and the demo seed (Simulated mock provider only).
 *
 *  R1  QA-P5-02: each of the six subscribing roles without ai.run.read (contributor, workstream lead, committee chair,
 *      functional approver, finance, legal — three in Arabic) subscribes in the UI, every browser context is closed, the
 *      running worker produces the briefing, and the subscriber opens it in a new session with its citations.
 *  R2  QA-P5-03: a member cleared below the project's classification (holding sponsor + PM roles) gets the restricted state
 *      and no AI content on every AI PM Center screen; every AI request answers 404.
 *  R3  QA-P5-04 + new Arabic findings: the Arabic answer uses Arabic template titles; QA-P5R-01 (raw entity type in the
 *      Arabic conflict note), QA-P5R-02 (English deduplication refusal on an Arabic run), QA-P5R-03 (Arabic routing).
 *  R4  QA-P5-05 / -08: the proposal page is loaded by id (no list paging) and names the recipient and requester (en + ar).
 *  R5  QA-P5-01: the cooldown field of the AI settings (validation, review dialog, saved value) in en + ar.
 *  R6  QA-P5-06: the Arabic Committee Hub escalation register.
 *  R7  Changed e2e assertion (runs page): a contributor's runs page lists their own runs and never the PM's.
 *  R8  OBSERVED: a workstream lead holding only the workstream-scoped grant is offered the Briefings tab; the API refuses.
 *
 * QA_P5R_DB_OWNER_URL (owner URL of the e2e database; falls back to QA_P5_DB_OWNER_URL / QA_P34_DB_OWNER_URL) is needed only
 * to create the synthetic Demo users of R2 / R8 (a clearance below the project and a workstream-only role cannot be given to
 * a demo persona through the API). Screenshots go to QA_P5R_SHOTS (default e2e/test-results/qa-p5r, not committed).
 */
const SHOTS = process.env.QA_P5R_SHOTS ?? join(__dirname, '..', 'test-results', 'qa-p5r');
mkdirSync(SHOTS, { recursive: true });
const STAMP = Date.now().toString(36).toUpperCase().slice(-6);
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const MESSAGES = join(__dirname, '..', '..', 'apps', 'web', 'src', 'i18n', 'messages');
const AI = { en: JSON.parse(readFileSync(join(MESSAGES, 'en', 'ai.json'), 'utf8')), ar: JSON.parse(readFileSync(join(MESSAGES, 'ar', 'ai.json'), 'utf8')) };
const DB = process.env.QA_P5R_DB_OWNER_URL ?? process.env.QA_P5_DB_OWNER_URL ?? process.env.QA_P34_DB_OWNER_URL ?? null;
type Lang = 'en' | 'ar';

async function csrfOf(ctx: APIRequestContext): Promise<string> {
  return (await ctx.storageState()).cookies.find((c) => c.name === 'hub_csrf')?.value ?? '';
}
async function call(ctx: APIRequestContext, method: 'POST' | 'PUT', path: string, data: unknown) {
  const res = await ctx.fetch(path, { method, data, headers: { 'x-csrf-token': await csrfOf(ctx) } });
  return { status: res.status(), body: await res.json().catch(() => null) };
}
async function get(ctx: APIRequestContext, path: string) {
  const res = await ctx.get(path);
  expect(res.ok(), `GET ${path} → HTTP ${res.status()}`).toBeTruthy();
  return res.json();
}
function sql(q: string): string {
  return execFileSync('psql', [DB!, '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', q], { encoding: 'utf8' }).trim();
}
async function setLocale(baseURL: string, persona: string, locale: Lang) {
  const api = await apiSessionAs(baseURL, persona);
  try {
    const r = await call(api, 'POST', '/api/v1/me/locale', { locale });
    expect(r.status < 300, `locale ${persona} → ${r.status}`).toBeTruthy();
  } finally {
    await api.dispose();
  }
}
async function settings(baseURL: string, dc: string, patch: Record<string, unknown>) {
  const sp = await apiSessionAs(baseURL, PERSONAS.sponsor);
  try {
    const s = await get(sp, `/api/v1/projects/${dc}/ai/settings`);
    const r = await call(sp, 'PUT', `/api/v1/projects/${dc}/ai/settings`, { expectedVersion: s.version, ...patch, reason: 'QA P5 re-check fixture (synthetic)' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body;
  } finally {
    await sp.dispose();
  }
}

interface Session {
  page: Page;
  problems: () => string[];
  bilingual: () => Promise<Set<string>>;
  close: () => Promise<void>;
}
async function open(browser: Browser, baseURL: string, persona: string, locale: Lang): Promise<Session> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const problems = watchConsole(page);
  await loginAs(page, persona);
  await context.addCookies([{ name: 'hub_locale', value: locale, url: baseURL }]);
  const bilingual = watchBilingual(page);
  return { page, problems, bilingual, close: () => context.close() };
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
const shot = (page: Page, file: string) => page.screenshot({ path: join(SHOTS, file), fullPage: true });

/**
 * Conflicting evidence through the documents API (AT-14 path): two text documents carrying `term` are uploaded and indexed,
 * linked as evidence to one task, the second recorded as contradicting the first. Returns the term to ask about.
 */
async function conflictingEvidence(baseURL: string, dc: string, term: string): Promise<void> {
  const pm = await apiSessionAs(baseURL, PERSONAS.pm);
  try {
    const csrf = await csrfOf(pm);
    const task = ((await get(pm, `/api/v1/projects/${dc}/tasks?pageSize=1`)).items as { id: string }[])[0]!.id;
    const docs: string[] = [];
    for (const [k, text] of [
      ['A', `Site survey ${term}: measured cooling capacity 480 kW for hall C; redundancy not yet confirmed (synthetic).`],
      ['B', `Site survey ${term}: measured cooling capacity 520 kW for hall C; redundancy N+1 confirmed (synthetic).`],
    ] as const) {
      const d = await call(pm, 'POST', `/api/v1/projects/${dc}/documents`, { title: `QA P5R ${term} survey ${k} (synthetic)`, kind: 'evidence', classification: 'internal' });
      expect(d.status, JSON.stringify(d.body)).toBe(201);
      const up = await pm.fetch(`/api/v1/projects/${dc}/documents/${d.body.id}/versions`, { method: 'POST', data: Buffer.from(text, 'utf8'), headers: { 'content-type': 'application/octet-stream', 'x-filename': `survey-${k}.txt`, 'x-csrf-token': csrf } });
      expect(up.status(), await up.text()).toBe(201);
      docs.push(d.body.id);
    }
    const a = await call(pm, 'POST', `/api/v1/projects/${dc}/evidence`, { targetType: 'task', targetId: task, documentId: docs[0], purpose: 'QA P5R conflict fixture (synthetic)' });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    const b = await call(pm, 'POST', `/api/v1/projects/${dc}/evidence`, { targetType: 'task', targetId: task, documentId: docs[1], conflictsWithLinkId: a.body.id, conflictNote: 'QA P5R: the capacity differs (synthetic)' });
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    // The running worker indexes both versions (documents.index_version); the AI retrieval reads the index.
    await expect
      .poll(async () => {
        const r = await call(pm, 'POST', `/api/v1/projects/${dc}/ai/ask`, { question: `${term} cooling capacity`, locale: 'en' });
        return (r.body?.output?.conflicts ?? []).length;
      }, { timeout: 120_000, intervals: [3000], message: 'conflicting evidence indexed and retrieved' })
      .toBeGreaterThan(0);
  } finally {
    await pm.dispose();
  }
}

/** A synthetic Demo user created in the e2e database (DB owner URL) with DEMO-DC memberships; deactivated by the caller. */
function demoUser(dc: string, key: string, clearance: string, memberships: { role: string; workstreamCode?: string }[]): { id: string; name: string } {
  const name = `Demo QA-P5R ${key} ${STAMP} (synthetic)`;
  const org = sql(`select org_id from project where id = '${dc}'`);
  const id = sql(`insert into app_user (org_id, email, display_name, title, clearance, is_demo, locale) values ('${org}', 'demo.qa-p5r-${key.toLowerCase()}-${STAMP.toLowerCase()}@demo.invalid', '${name}', 'QA re-check persona (synthetic)', '${clearance}', true, 'en') returning id`);
  for (const m of memberships) {
    const ws = m.workstreamCode ? `'${sql(`select id from workstream where project_id = '${dc}' and code = '${m.workstreamCode}'`)}'` : 'null';
    sql(`insert into project_membership (org_id, project_id, user_id, role, workstream_id, reason) values ('${org}', '${dc}', '${id}', '${m.role}', ${ws}, 'QA P5 re-check fixture (synthetic)')`);
  }
  return { id, name };
}

test.describe.configure({ mode: 'serial' });

test.describe('QA P5 RE-CHECK — the AI PM Center after the P5 QA fixes (en + ar) [REQ-UX-017, REQ-AI-010, REQ-AI-006, REQ-AI-028, REQ-UX-001, REQ-UX-002]', () => {
  let dc = '';
  let pmId = '';

  test.beforeAll(async ({ baseURL }) => {
    const pm = await apiSessionAs(baseURL!, PERSONAS.pm);
    try {
      dc = ((await get(pm, '/api/v1/projects?pageSize=100')).items as { id: string; code: string }[]).find((p) => p.code === 'DEMO-DC')!.id;
      pmId = ((await get(pm, '/api/v1/auth/demo-users')).items as { id: string; displayName: string }[]).find((u) => u.displayName === PERSONAS.pm)!.id;
    } finally {
      await pm.dispose();
    }
    // DEMO-DC as seeded: Advisory, Simulated mock, the product's default cooldown (24 h).
    await settings(baseURL!, dc, { mode: 'advisory', provider: 'mock', actionCooldownHours: 24 });
  });

  // ---------------------------------------------------------------------------------------------------------------
  // R1. QA-P5-02 for the six subscribing roles without ai.run.read.

  const SUBSCRIBERS: { persona: string; role: string; lang: Lang }[] = [
    { persona: PERSONAS.contributor, role: 'contributor', lang: 'en' },
    { persona: 'Demo Operations Lead', role: 'workstream lead (WS07) + contributor', lang: 'ar' },
    { persona: 'Demo Committee Chair', role: 'committee chair', lang: 'en' },
    { persona: 'Demo Functional Approver', role: 'functional approver', lang: 'ar' },
    { persona: PERSONAS.finance, role: 'finance (restricted) + functional approver', lang: 'en' },
    { persona: PERSONAS.legal, role: 'legal (restricted) + functional approver', lang: 'ar' },
  ];

  test('R1 QA-P5-02 (UI): each of the six subscribing roles subscribes in the UI, closes the browser, and opens the briefing the worker delivered, with its citations (3 in Arabic: detector + axe)', async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(900_000);
    const after = new Date(Date.now() - 2000).toISOString();
    const runs: Record<string, string> = {};
    const report: Record<string, unknown>[] = [];
    try {
      for (const s of SUBSCRIBERS) {
        if (s.lang === 'ar') await setLocale(baseURL!, s.persona, 'ar'); // the worker writes the briefing in the saved language
        const a = await open(browser, baseURL!, s.persona, s.lang);
        try {
          await a.page.goto(`/projects/${dc}/ai/briefings`);
          await expect(a.page.getByTestId('briefing-form')).toBeVisible();
          await a.page.getByTestId('briefing-kind').selectOption('daily');
          await a.page.getByTestId('briefing-cron').fill('* * * * *');
          await a.page.getByTestId('briefing-subscribe').click();
          await expect(a.page.getByTestId('briefing-toggle-daily')).toHaveText(AI[s.lang].briefings.pause);
        } finally {
          await a.close();
        }
      }
      const contexts = browser.contexts().length;
      expect(contexts, 'browser contexts open while the worker runs').toBe(0);
      // The running worker process produces the briefings; each subscriber's OWN runs list shows it (QA-P5-02).
      for (const s of SUBSCRIBERS) {
        await expect
          .poll(
            async () => {
              const api = await apiSessionAs(baseURL!, s.persona);
              try {
                const r = await api.get(`/api/v1/projects/${dc}/ai/runs?pageSize=20`);
                if (!r.ok()) return `HTTP ${r.status()}`;
                const hit = ((await r.json()).items as { id: string; trigger: string; status: string; createdAt: string }[]).find((x) => x.trigger === 'scheduled' && x.status === 'succeeded' && x.createdAt > after);
                if (hit) runs[s.persona] = hit.id;
                return hit ? 'found' : 'waiting';
              } finally {
                await api.dispose();
              }
            },
            { timeout: 240_000, intervals: [3000], message: `scheduled briefing of ${s.persona}` },
          )
          .toBe('found');
      }
    } finally {
      for (const s of SUBSCRIBERS) {
        const api = await apiSessionAs(baseURL!, s.persona);
        try {
          await call(api, 'POST', `/api/v1/projects/${dc}/ai/briefings`, { kind: 'daily', cron: '* * * * *', timezone: 'Asia/Riyadh', enabled: false });
        } finally {
          await api.dispose();
        }
      }
    }

    const problems: string[] = [];
    try {
      for (const s of SUBSCRIBERS) {
        const b = await open(browser, baseURL!, s.persona, s.lang);
        try {
          const { page } = b;
          const run = runs[s.persona]!;
          await page.goto(`/projects/${dc}/ai/runs`);
          await expect(page.getByTestId('runs-table').locator('table')).toBeVisible();
          await settle(page);
          const row = page.getByTestId('runs-table').locator('tbody tr').filter({ has: page.locator(`[data-testid="run-link"][href$="${run}"]`) });
          await expect(row).toContainText(AI[s.lang].triggers.scheduled);
          await row.getByTestId('run-link').click();
          await expect(page.getByTestId('run-detail')).toHaveAttribute('data-run-id', run);
          await settle(page);
          const claims = page.getByTestId('answer-claim');
          const n = await claims.count();
          expect(n, `${s.persona}: claims`).toBeGreaterThan(0);
          for (let k = 0; k < n; k++) expect(await claims.nth(k).locator('[data-citation-id]').count(), `${s.persona}: claim ${k} cited`).toBeGreaterThan(0);
          const refused = (await page.getByTestId('answer-refused').count()) ? await page.getByTestId('answer-refused').innerText() : '';
          await shot(page, `${s.lang}-r1-${s.role.split(' ')[0]}-briefing-run.png`);
          if (s.lang === 'ar') problems.push(...(await checkArabic(page, testInfo, SHOTS, `r1-${s.role.split(' ')[0]}-briefing-run`, b.bilingual, { strict: false })));
          problems.push(...(await axe(page, `${s.lang} r1 ${s.role} run`)));
          // Open up to three distinct citations: each opens its record (no restricted / error state) for this subscriber.
          const hrefs = [...new Set(await page.getByTestId('citation-link').evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? '')))].filter(Boolean).slice(0, 3);
          const opened: string[] = [];
          for (const h of hrefs) {
            await page.goto(h);
            await settle(page);
            if ((await page.getByTestId('restricted-state').count()) || (await page.getByTestId('error-state').count())) problems.push(`${s.persona}: citation ${h} does not open`);
            else opened.push(h);
          }
          report.push({ persona: s.persona, role: s.role, lang: s.lang, run, claims: n, citationsOpened: opened.length, refused: refused.replace(/\s+/g, ' ').slice(0, 200) });
          problems.push(...b.problems());
        } finally {
          await b.close();
        }
      }
    } finally {
      for (const s of SUBSCRIBERS.filter((x) => x.lang === 'ar')) await setLocale(baseURL!, s.persona, 'en');
    }
    console.log(`R1 QA-P5-02 (UI): ${JSON.stringify(report)}`);
    console.log(`R1 problems (${problems.length}):\n  ${problems.join('\n  ')}`);
    expect(report).toHaveLength(6);
    expect(problems, problems.join('\n')).toEqual([]);
  });

  // ---------------------------------------------------------------------------------------------------------------
  // R2. QA-P5-03 in the UI: a member cleared below the project's classification.

  test('R2 QA-P5-03 (UI): a member cleared below the project\'s classification (sponsor + PM roles) gets the restricted state on every AI PM Center screen, no AI content, and 404 from every AI request; CONTROL: the cleared PM sees them', async ({ browser, baseURL }) => {
    test.setTimeout(240_000);
    test.skip(!DB, 'QA_P5R_DB_OWNER_URL is needed to create a member cleared below the project (not offered by the API for a demo persona)');
    const u = demoUser(dc, 'LowClear', 'internal', [{ role: 'sponsor' }, { role: 'project_manager' }]);
    const overdue = sql(`select title from task where project_id = '${dc}' and accountable_user_id is not null and coalesce(forecast_finish, planned_finish) < current_date and status in ('not_started','in_progress','blocked') order by sort_order limit 1`);
    const proposal = sql(`select id from ai_proposal where project_id = '${dc}' order by created_at desc limit 1`);
    const run = sql(`select id from ai_run where project_id = '${dc}' and requested_by = '${pmId}' order by created_at desc limit 1`);
    const SEGMENTS = ['', '/ask', '/runs', '/proposals', '/briefings', '/settings', ...(proposal ? [`/proposals/${proposal}`] : []), ...(run ? [`/runs/${run}`] : [])];
    const result: { seg: string; restricted: boolean; aiCalls: string[]; leaked: boolean }[] = [];
    try {
      for (const lang of ['en', 'ar'] as const) {
        const s = await open(browser, baseURL!, u.name, lang);
        const calls: string[] = [];
        s.page.on('response', (r) => {
          if (r.url().includes(`/api/v1/projects/${dc}/ai`)) calls.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname.replace(`/api/v1/projects/${dc}`, '')}`);
        });
        try {
          for (const seg of SEGMENTS) {
            calls.length = 0;
            await s.page.goto(`/projects/${dc}/ai${seg}`);
            await settle(s.page);
            const restricted = (await s.page.getByTestId('restricted-state').count()) > 0;
            const body = await s.page.locator('body').innerText();
            result.push({ seg: `${lang}${seg || '/'}`, restricted, aiCalls: [...calls], leaked: !!overdue && body.includes(overdue) });
          }
          await shot(s.page, `${lang}-r2-under-cleared-ai.png`);
        } finally {
          await s.close();
        }
      }
      const pm = await open(browser, baseURL!, PERSONAS.pm, 'en');
      try {
        await pm.page.goto(`/projects/${dc}/ai/briefings`);
        await expect(pm.page.getByTestId('detections-table').locator('tbody tr').first()).toBeVisible({ timeout: 30_000 });
        await expect(pm.page.getByTestId('restricted-state')).toHaveCount(0);
      } finally {
        await pm.close();
      }
    } finally {
      sql(`update app_user set is_active = false where id = '${u.id}'`);
    }
    console.log(`R2 QA-P5-03 (UI): ${JSON.stringify(result)}`);
    for (const r of result) {
      expect(r.restricted, `${r.seg}: restricted state`).toBe(true);
      expect(r.leaked, `${r.seg}: task title shown`).toBe(false);
      for (const c of r.aiCalls) expect(c.startsWith('404 '), `${r.seg}: ${c}`).toBe(true);
    }
  });

  // ---------------------------------------------------------------------------------------------------------------
  // R3. Arabic AI output (QA-P5-04) and the new Arabic findings QA-P5R-01 / -02 / -03.

  const arabic: { englishTitles: string[]; conflict: string; refused: string; gatesPlural: number; gatesSingular: number; askProblems: string[] } = { englishTitles: [], conflict: '', refused: '', gatesPlural: -1, gatesSingular: -1, askProblems: [] };

  test('R3 CONTROL: Arabic answers in the UI — template tasks by their Arabic title (QA-P5-04); the conflict note, a deduplicated Arabic briefing and the Arabic gate questions recorded (QA-P5R-01 / -02 / -03)', async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(600_000);
    const term = `QAPFIVER${STAMP}`;
    await conflictingEvidence(baseURL!, dc, term);
    const s = await open(browser, baseURL!, PERSONAS.pm, 'ar');
    try {
      const { page } = s;
      const tasks: { title: string; titleAr: string | null }[] = [];
      for (let p = 1; p <= 10; p++) {
        const r = await (await page.request.get(`/api/v1/projects/${dc}/tasks?page=${p}&pageSize=100`)).json();
        tasks.push(...(r.items as { title: string; titleAr: string | null }[]));
        if (p * 100 >= r.total) break;
      }
      const bilingual = tasks.filter((t) => t.titleAr && t.titleAr !== t.title);
      const ask = async (q: string, name: string) => {
        await page.goto(`/projects/${dc}/ai/ask`);
        await page.getByTestId('ask-question').fill(q);
        await page.getByTestId('ask-submit').click();
        const result = page.getByTestId('ask-result');
        await expect(result).toBeVisible({ timeout: 60_000 });
        await settle(page);
        await shot(page, `ar-r3-${name}.png`);
        return result;
      };
      const r1 = await ask('ما المهام المتأخرة أو التي بلا مالك؟', 'overdue');
      const text1 = await r1.innerText();
      arabic.englishTitles = bilingual.filter((t) => text1.includes(t.title)).map((t) => t.title);
      arabic.askProblems = await checkArabic(page, testInfo, SHOTS, 'r3-ask-overdue', s.bilingual, { strict: false });
      const r2 = await ask(`ما نتيجة مسح ${term} لسعة التبريد cooling capacity؟`, 'conflict');
      arabic.conflict = (await r2.getByTestId('answer-conflicts').count()) ? (await r2.getByTestId('answer-conflicts').innerText()).replace(/\s+/g, ' ') : '';
      arabic.gatesPlural = await (await ask('ما عوائق البوابات؟', 'gates-plural')).getByTestId('answer-claim').count();
      arabic.gatesSingular = await (await ask('ما عوائق البوابة؟', 'gates-singular')).getByTestId('answer-claim').count();
    } finally {
      await s.close();
    }
    // QA-P5R-02: the PM's briefing in Arabic, twice within the cooldown (the second meets the first one's pending reminder).
    // An overdue task owned by the PM (typed by a person, as p5-ai.spec.ts does) guarantees a reminder to prepare.
    await setLocale(baseURL!, PERSONAS.pm, 'ar');
    const after = new Date(Date.now() - 2000).toISOString();
    const pm = await apiSessionAs(baseURL!, PERSONAS.pm);
    let refusedRun = '';
    try {
      const ws = (await get(pm, `/api/v1/projects/${dc}/workstreams`)).items as { id: string }[];
      const day = (o: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + o * 86_400_000));
      const t = await call(pm, 'POST', `/api/v1/projects/${dc}/tasks`, { workstreamId: ws[0]!.id, title: `QA P5R overdue follow-up ${STAMP} (synthetic)`, plannedStart: day(-12), plannedFinish: day(-3), accountableUserId: pmId });
      expect(t.status, JSON.stringify(t.body)).toBe(201);
      await call(pm, 'POST', `/api/v1/projects/${dc}/ai/briefings`, { kind: 'weekly', cron: '* * * * *', timezone: 'Asia/Riyadh', enabled: true });
      await expect
        .poll(
          async () => {
            const items = (await get(pm, `/api/v1/projects/${dc}/ai/runs?pageSize=20`)).items as { id: string; trigger: string; status: string; createdAt: string; locale: string }[];
            for (const r of items.filter((x) => x.trigger === 'scheduled' && x.status === 'succeeded' && x.createdAt > after && x.locale === 'ar')) {
              const full = await get(pm, `/api/v1/projects/${dc}/ai/runs/${r.id}`);
              if ((full.output?.refusedToolCalls ?? []).some((x: { reason: string }) => x.reason.includes('duplicate_within_cooldown'))) refusedRun = r.id;
            }
            return refusedRun ? 'found' : 'waiting';
          },
          { timeout: 300_000, intervals: [5000], message: 'an Arabic scheduled briefing with a deduplicated reminder' },
        )
        .toBe('found');
    } finally {
      await call(pm, 'POST', `/api/v1/projects/${dc}/ai/briefings`, { kind: 'weekly', cron: '* * * * *', timezone: 'Asia/Riyadh', enabled: false });
      await pm.dispose();
      await setLocale(baseURL!, PERSONAS.pm, 'en');
    }
    const r = await open(browser, baseURL!, PERSONAS.pm, 'ar');
    try {
      await r.page.goto(`/projects/${dc}/ai/runs/${refusedRun}`);
      await expect(r.page.getByTestId('run-detail')).toHaveAttribute('data-run-id', refusedRun);
      await settle(r.page);
      arabic.refused = (await r.page.getByTestId('answer-refused').innerText()).replace(/\s+/g, ' ');
      await shot(r.page, 'ar-r3-briefing-dedupe-refusal.png');
    } finally {
      await r.close();
    }
    console.log(`R3 Arabic UI: ${JSON.stringify(arabic)}`);
    expect(arabic.conflict.length).toBeGreaterThan(0);
    expect(arabic.refused.length).toBeGreaterThan(0);
    expect(arabic.gatesSingular).toBeGreaterThan(0);
  });

  test('R3 QA-P5-04 (fixed, re-check): the Arabic answer shows no English template title and the detector finds no English UI text on it', () => {
    expect(arabic.englishTitles).toEqual([]);
    expect(arabic.askProblems).toEqual([]);
  });

  test('DEFECT QA-P5R-01 (UI): the Arabic conflict note names the record type in Arabic (not "task")', () => {
    test.fail(true, 'QA-P5R-01: the Arabic conflict description embeds the raw entity type ("… بالنسبة إلى task")');
    expect(arabic.conflict).not.toMatch(/(^|[^A-Za-z_])(task|milestone|document|decision|closing_condition)([^A-Za-z_]|$)/);
  });

  test('DEFECT QA-P5R-02 (UI): on an Arabic briefing run the deduplication refusal under "Safeguards" is Arabic', () => {
    test.fail(true, 'QA-P5R-02: the refusal reason is a stored English sentence ("duplicate_within_cooldown: the same action …")');
    expect(arabic.refused).not.toMatch(/the same action for the same target/);
  });

  test('DEFECT QA-P5R-03 (UI): the Arabic question "ما عوائق البوابات؟" (gates, plural) is answered like its singular form', () => {
    test.fail(true, 'QA-P5R-03: the Arabic question routing matches "البوابة" but not the plural "البوابات" used by the Arabic UI');
    expect(arabic.gatesPlural).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------------------------------------------
  // R4. QA-P5-08 / QA-P5-05: the proposal page by id, the recipient's and requester's names.

  test('R4 QA-P5-08 / QA-P5-05 (UI): the Secretary opens a proposal by its URL — one GET by id, no list paging — and sees the recipient\'s and requester\'s names (en + ar: detector + axe); an unknown id shows the restricted state', async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(240_000);
    const sec = await apiSessionAs(baseURL!, PERSONAS.secretary);
    let target: { id: string; recipient: string; requester: string } | null = null;
    try {
      const items = (await get(sec, `/api/v1/projects/${dc}/ai/proposals?pageSize=100`)).items as { id: string; actionType: string; payload: { recipientUserId?: string }; requestedBy: string | null; people: { userId: string; displayName: string }[] }[];
      // A proposal prepared for SOMEONE ELSE (the page names the reader "You" on their own proposals — correct, not under test).
      const secId = ((await get(sec, '/api/v1/auth/demo-users')).items as { id: string; displayName: string }[]).find((u) => u.displayName === PERSONAS.secretary)!.id;
      const p = items.find((x) => x.actionType === 'create_internal_notification' && x.payload.recipientUserId && x.requestedBy && x.requestedBy !== secId && x.payload.recipientUserId !== secId);
      expect(p, 'a message proposal visible to the Secretary').toBeTruthy();
      const nameOf = (id: string) => p!.people.find((x) => x.userId === id)?.displayName ?? '';
      target = { id: p!.id, recipient: nameOf(p!.payload.recipientUserId!), requester: nameOf(p!.requestedBy!) };
    } finally {
      await sec.dispose();
    }
    const problems: string[] = [];
    const seen: Record<string, unknown> = {};
    for (const lang of ['en', 'ar'] as const) {
      const s = await open(browser, baseURL!, PERSONAS.secretary, lang);
      const requests: string[] = [];
      s.page.on('request', (r) => {
        // API requests only (the page's own route prefetches, ?_rsc=…, are not data requests).
        if (r.url().includes('/api/v1/') && r.url().includes('/ai/proposals')) requests.push(new URL(r.url()).pathname + new URL(r.url()).search);
      });
      try {
        await s.page.goto(`/projects/${dc}/ai/proposals/${target!.id}`);
        await expect(s.page.getByTestId('proposal-detail')).toBeVisible({ timeout: 30_000 });
        await settle(s.page);
        const recipient = (await s.page.getByTestId('payload-recipient').innerText()).replace(/\s+/g, ' ');
        const requester = (await s.page.getByTestId('proposal-requester').innerText()).replace(/\s+/g, ' ');
        seen[lang] = { recipient, requester, requests: [...new Set(requests)] };
        expect(recipient).toContain(target!.recipient);
        expect(requester).toContain(target!.requester);
        expect(requests.filter((x) => /\/ai\/proposals\?/.test(x)), `${lang}: list paging`).toEqual([]);
        expect(requests.some((x) => x.endsWith(`/ai/proposals/${target!.id}`))).toBe(true);
        await shot(s.page, `${lang}-r4-proposal-by-id.png`);
        if (lang === 'ar') problems.push(...(await checkArabic(s.page, testInfo, SHOTS, 'r4-proposal-by-id', s.bilingual, { strict: false })));
        problems.push(...(await axe(s.page, `${lang} r4 proposal`)));
        await s.page.goto(`/projects/${dc}/ai/proposals/01a0f000-0000-7000-8000-000000000000`);
        await settle(s.page);
        await expect(s.page.getByTestId('restricted-state')).toBeVisible();
        problems.push(...s.problems().filter((x) => !/404/.test(x)));
      } finally {
        await s.close();
      }
    }
    console.log(`R4: ${JSON.stringify({ target, seen })}`);
    console.log(`R4 problems: ${JSON.stringify(problems)}`);
    expect(problems).toEqual([]);
  });

  // ---------------------------------------------------------------------------------------------------------------
  // R5. QA-P5-01: the cooldown field of the AI settings.

  test('R5 QA-P5-01 (UI): the Sponsor sees the cooldown field (24 h), an out-of-range value cannot be submitted (Review disabled, hint 0–168), and a change goes through the review dialog and is saved (en + ar: detector + axe)', async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(240_000);
    const problems: string[] = [];
    const saved: Record<string, number> = {};
    try {
      for (const [lang, value] of [['en', 12], ['ar', 6]] as const) {
        const s = await open(browser, baseURL!, PERSONAS.sponsor, lang);
        try {
          const { page } = s;
          await page.goto(`/projects/${dc}/ai/settings`);
          const field = page.getByTestId('settings-cooldown');
          await expect(field).toBeVisible({ timeout: 30_000 });
          await settle(page);
          await expect(field).toHaveValue('24');
          await expect(page.getByText(AI[lang].settings.cooldownHours, { exact: false }).first()).toBeVisible();
          // Out of range: the value is not part of the change set, so "Review" stays disabled (no dialog can open); the
          // field's hint states the 0–168 range. (The form shows field errors only after a submit attempt.)
          await field.fill('169');
          await expect(page.getByTestId('settings-save')).toBeDisabled();
          await expect(page.getByTestId('settings-form')).toContainText(/168|١٦٨/);
          await expect(page.getByRole('dialog')).toHaveCount(0);
          await shot(page, `${lang}-r5-cooldown-out-of-range.png`);
          await field.fill(String(value));
          await page.getByTestId('settings-save').click();
          const d = page.getByRole('dialog');
          await expect(d).toBeVisible();
          await expect(d.getByTestId('settings-change')).toContainText(AI[lang].settings.cooldownHours);
          await checkDialogA11y(page, d, `${lang} r5 settings review`);
          if (lang === 'ar') problems.push(...(await checkArabic(page, testInfo, SHOTS, 'r5-settings-review-dialog', s.bilingual, { scope: d, strict: false })));
          await d.getByTestId('dialog-confirm').click();
          await expect(d).toBeHidden({ timeout: 20_000 });
          await settle(page);
          await expect(field).toHaveValue(String(value));
          if (lang === 'ar') problems.push(...(await checkArabic(page, testInfo, SHOTS, 'r5-settings', s.bilingual, { strict: false })));
          problems.push(...(await axe(page, `${lang} r5 settings`)));
          problems.push(...s.problems());
        } finally {
          await s.close();
        }
        const sp = await apiSessionAs(baseURL!, PERSONAS.sponsor);
        saved[lang] = (await get(sp, `/api/v1/projects/${dc}/ai/settings`)).actionCooldownHours;
        await sp.dispose();
        await settings(baseURL!, dc, { actionCooldownHours: 24 });
      }
    } finally {
      await settings(baseURL!, dc, { actionCooldownHours: 24 });
    }
    console.log(`R5: saved ${JSON.stringify(saved)}; problems ${JSON.stringify(problems)}`);
    expect(saved).toEqual({ en: 12, ar: 6 });
    expect(problems).toEqual([]);
  });

  // ---------------------------------------------------------------------------------------------------------------
  // R6. QA-P5-06: the Arabic escalation register.

  test('R6 QA-P5-06 (UI): the Arabic Committee Hub escalation register shows the TSA escalation\'s requested action and target in Arabic; the remaining English is listed (carried remainder); axe', async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(180_000);
    const s = await open(browser, baseURL!, PERSONAS.secretary, 'ar');
    try {
      const { page } = s;
      await page.goto(`/projects/${dc}/committee/escalations`);
      await expect(page.getByTestId('escalations-table').locator('tbody tr').first()).toBeVisible({ timeout: 30_000 });
      await settle(page);
      const actions = await page.getByTestId('escalation-action').allInnerTexts();
      const targets = await page.getByTestId('escalation-target').allInnerTexts();
      const problems = await checkArabic(page, testInfo, SHOTS, 'r6-committee-escalations', s.bilingual, { strict: false });
      const ax = await axe(page, 'ar r6 escalations');
      await shot(page, 'ar-r6-committee-escalations.png');
      console.log(`R6: system TSA texts ${JSON.stringify({ actions, targets })}; detector problems ${problems.length}: ${JSON.stringify(problems)}`);
      expect(actions.length).toBeGreaterThan(0);
      for (const t of [...actions, ...targets]) expect(t, t).toMatch(/[؀-ۿ]/);
      for (const t of actions) expect(t).not.toMatch(/reached its end date|This is NOT an exit/);
      expect(ax).toEqual([]);
    } finally {
      await s.close();
    }
  });

  // ---------------------------------------------------------------------------------------------------------------
  // R7. Changed e2e assertion: the contributor's runs page lists their OWN runs only.

  test('R7 (changed assertion check): the contributor\'s runs page lists the contributor\'s own question and none of the PM\'s runs', async ({ browser, baseURL }) => {
    test.setTimeout(180_000);
    const pm = await apiSessionAs(baseURL!, PERSONAS.pm);
    const co = await apiSessionAs(baseURL!, PERSONAS.contributor);
    let pmRun = '';
    let coRun = '';
    try {
      pmRun = (await call(pm, 'POST', `/api/v1/projects/${dc}/ai/ask`, { question: `QA P5R PM marker ${STAMP} overdue`, locale: 'en' })).body.id;
      coRun = (await call(co, 'POST', `/api/v1/projects/${dc}/ai/ask`, { question: `QA P5R contributor marker ${STAMP} overdue`, locale: 'en' })).body.id;
    } finally {
      await pm.dispose();
      await co.dispose();
    }
    const s = await open(browser, baseURL!, PERSONAS.contributor, 'en');
    try {
      await s.page.goto(`/projects/${dc}/ai/runs`);
      await expect(s.page.getByTestId('runs-table').locator('table')).toBeVisible();
      await settle(s.page);
      const hrefs = await s.page.getByTestId('run-link').evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''));
      console.log(`R7: contributor runs page ${hrefs.length} link(s); own ${coRun} listed ${hrefs.some((h) => h.endsWith(coRun))}; PM ${pmRun} listed ${hrefs.some((h) => h.endsWith(pmRun))}`);
      expect(hrefs.some((h) => h.endsWith(coRun))).toBe(true);
      expect(hrefs.some((h) => h.endsWith(pmRun))).toBe(false);
      await s.page.goto(`/projects/${dc}/ai/runs/${pmRun}`);
      await settle(s.page);
      await expect(s.page.getByTestId('run-detail')).toHaveCount(0);
    } finally {
      await s.close();
    }
  });

  // ---------------------------------------------------------------------------------------------------------------
  // R8. OBSERVED: a workstream lead holding only the workstream-scoped grant.

  test('R8 OBSERVED: a workstream lead holding ONLY the workstream-scoped grant is offered the Briefings tab and form; subscribing is refused by the API (403, shown as an error)', async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    test.skip(!DB, 'QA_P5R_DB_OWNER_URL is needed to create a workstream-only lead');
    const u = demoUser(dc, 'WsOnlyLead', 'confidential', [{ role: 'workstream_lead', workstreamCode: 'WS07' }]);
    try {
      const s = await open(browser, baseURL!, u.name, 'en');
      const statuses: string[] = [];
      s.page.on('response', (r) => {
        const path = new URL(r.url()).pathname;
        if (path.endsWith(`/api/v1/projects/${dc}/ai/briefings`) || path.endsWith(`/api/v1/projects/${dc}/ai/ask`)) statuses.push(`${r.request().method()} ${path.split('/').pop()} ${r.status()}`);
      });
      try {
        await s.page.goto(`/projects/${dc}/ai`);
        await settle(s.page);
        const tabs = await s.page.getByTestId('ai-tabs').locator('[data-tab]').allInnerTexts();
        await s.page.goto(`/projects/${dc}/ai/briefings`);
        await settle(s.page);
        const formShown = (await s.page.getByTestId('briefing-form').count()) > 0;
        if (formShown) {
          await s.page.getByTestId('briefing-subscribe').click();
          await expect(s.page.getByTestId('briefing-error')).toBeVisible({ timeout: 15_000 });
        }
        await shot(s.page, 'en-r8-workstream-only-lead-briefings.png');
        // The Ask tab is offered on the same workstream-scoped grant (ai.assistant.use): the question is refused too.
        await s.page.goto(`/projects/${dc}/ai/ask`);
        await settle(s.page);
        const askShown = (await s.page.getByTestId('ask-question').count()) > 0;
        if (askShown) {
          await s.page.getByTestId('ask-question').fill('Which tasks are overdue?');
          await s.page.getByTestId('ask-submit').click();
          await expect.poll(() => statuses.some((x) => x.startsWith('POST ask')), { timeout: 15_000 }).toBe(true);
          await shot(s.page, 'en-r8-workstream-only-lead-ask.png');
        }
        console.log(`R8: tabs ${JSON.stringify(tabs)}; briefing form shown ${formShown}; ask form shown ${askShown}; requests ${JSON.stringify(statuses)}`);
        expect(tabs.join('|')).toContain(AI.en.tabs.briefings);
        expect(formShown).toBe(true);
        expect(statuses).toContain('POST briefings 403');
      } finally {
        await s.close();
      }
    } finally {
      sql(`update app_user set is_active = false where id = '${u.id}'`);
    }
  });
});
