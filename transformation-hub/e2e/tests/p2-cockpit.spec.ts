import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { join } from 'node:path';
import { PERSONAS, apiSessionAs, loginAs, watchConsole } from './helpers';

/**
 * DC Executive Cockpit (Screen 2) — REQ-UX-005, acceptance tests AT-06 and
 * "E2E: cockpit shows four status dimensions and top decisions", against the REAL API and the demo seed (no mocks, except
 * one injected 500 to show the error state).
 *
 * Expected values are computed independently from the API as the same persona (decision register, gate list, progress,
 * agenda requests), so the spec holds whatever other specs added to DEMO-DC before it ran. Screenshots: English, Arabic
 * (RTL) and Arabic at 390 px.
 */
const SHOTS = join(__dirname, '..', 'screenshots');
const P = { ...PERSONAS, sponsor: 'Demo Sponsor' } as const;
const OPEN = ['draft', 'submitted', 'under_review', 'recommended', 'deferred'];

interface Decision {
  id: string;
  code: string;
  title: string;
  status: string;
  latestSafeDate: string | null;
  isDemo: boolean;
}
interface Gate {
  id: string;
  key: string;
  sortOrder: number;
  assessment: { status: string };
  blockers: { kind: string; ref: string }[];
}

async function getJson<T>(api: APIRequestContext, path: string): Promise<T> {
  const res = await api.get(path);
  expect(res.ok(), `GET ${path} → HTTP ${res.status()}`).toBeTruthy();
  return (await res.json()) as T;
}

async function projectId(api: APIRequestContext, code: string): Promise<string> {
  const list = await getJson<{ items: { id: string; code: string }[] }>(api, '/api/v1/projects');
  const p = list.items.find((x) => x.code === code);
  expect(p, `${code} visible`).toBeTruthy();
  return p!.id;
}

/** Every decision the persona can read (all pages), then the cockpit's ranking: open, latest safe date asc, undated last, ties by id. */
async function expectedTopDecisions(api: APIRequestContext, pid: string): Promise<{ open: Decision[]; top: Decision[] }> {
  const all: Decision[] = [];
  for (let page = 1; ; page++) {
    const r = await getJson<{ items: Decision[]; total: number }>(api, `/api/v1/projects/${pid}/decisions?pageSize=100&page=${page}`);
    all.push(...r.items);
    if (all.length >= r.total || r.items.length === 0) break;
  }
  const open = all
    .filter((d) => OPEN.includes(d.status))
    .sort((a, b) => {
      if (a.latestSafeDate !== b.latestSafeDate) {
        if (a.latestSafeDate === null) return 1;
        if (b.latestSafeDate === null) return -1;
        return a.latestSafeDate < b.latestSafeDate ? -1 : 1;
      }
      return a.id < b.id ? -1 : 1;
    });
  return { open, top: open.slice(0, 3) };
}

function nextGateOf(gates: Gate[]): Gate | null {
  return [...gates].sort((a, b) => a.sortOrder - b.sortOrder).find((g) => g.assessment.status !== 'approved' && g.assessment.status !== 'approved_with_exceptions') ?? null;
}

async function postJson<T>(api: APIRequestContext, path: string, data: unknown): Promise<T> {
  const csrf = (await api.storageState()).cookies.find((c) => c.name === 'hub_csrf')?.value ?? '';
  const res = await api.post(path, { data, headers: { 'x-csrf-token': csrf } });
  expect(res.ok(), `POST ${path} → HTTP ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T;
}

/** The day before `isoDate` (YYYY-MM-DD, calendar arithmetic in UTC). */
function dayBefore(isoDate: string): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

async function total(api: APIRequestContext, path: string): Promise<number> {
  return (await getJson<{ total: number }>(api, path)).total;
}

async function openAs(browser: Browser, persona: string, locale?: 'ar', baseURL?: string): Promise<{ page: Page; problems: () => string[]; close: () => Promise<void> }> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const problems = watchConsole(page);
  await loginAs(page, persona);
  // The rendering language comes from the `hub_locale` cookie; the persona's saved preference is left untouched.
  if (locale) await ctx.addCookies([{ name: 'hub_locale', value: locale, url: baseURL! }]);
  return { page, problems, close: () => ctx.close() };
}

/** Network calls the page made to a governance list (to prove a restricted part is never requested). */
function trackRequests(page: Page, pattern: RegExp): string[] {
  const hits: string[] = [];
  page.on('request', (r) => {
    if (pattern.test(new URL(r.url()).pathname)) hits.push(r.url());
  });
  return hits;
}

test.describe('P2 DC Executive Cockpit — REQ-UX-005 / AT-06', () => {
  let dc = '';
  let transform = '';

  test.beforeAll(async ({ baseURL }) => {
    const pm = await apiSessionAs(baseURL!, P.pm);
    const pmB = await apiSessionAs(baseURL!, P.pmB);
    try {
      dc = await projectId(pm, 'DEMO-DC');
      transform = await projectId(pmB, 'DEMO-TRANSFORM');
    } finally {
      await pm.dispose();
      await pmB.dispose();
    }
  });

  test('(a) E2E: cockpit shows four status dimensions and top decisions; overall health, next gate, delay impact, gate blockers and committee asks come from the API and open their records', async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    // Fixture (synthetic, through the real API as the Demo PM): a draft decision paper whose latest safe date was
    // yesterday in the project's time zone, so the "overdue first" rule is exercised, and an agenda request for it that
    // the secretariat has not screened yet (a committee ask). Both are clearly labelled E2E records.
    const stamp = Date.now().toString(36).toUpperCase();
    const pmApi = await apiSessionAs(baseURL!, P.pm);
    const today = (await getJson<{ today: string }>(pmApi, `/api/v1/projects/${dc}/progress`)).today;
    const committees = (await getJson<{ items: { id: string; name: string }[] }>(pmApi, `/api/v1/projects/${dc}/committees`)).items;
    const steering = committees.find((c) => c.name === 'DC Carve-out & JV Steering Committee (Demo)');
    expect(steering, 'the demo steering committee').toBeTruthy();
    const overdueTitle = `E2E cockpit — overdue decision paper ${stamp} (synthetic)`;
    const overdue = await postJson<{ id: string }>(pmApi, `/api/v1/projects/${dc}/decisions`, {
      committeeId: steering!.id,
      title: overdueTitle,
      issue: 'Synthetic E2E paper: its latest safe decision date has passed.',
      latestSafeDate: dayBefore(today),
    });
    const agendaTitle = `E2E cockpit — agenda request ${stamp} (synthetic)`;
    await postJson(pmApi, `/api/v1/projects/${dc}/agenda-requests`, { committeeId: steering!.id, title: agendaTitle, kind: 'decision', decisionId: overdue.id });
    await pmApi.dispose();

    const api = await apiSessionAs(baseURL!, P.sponsor);
    const { open, top } = await expectedTopDecisions(api, dc);
    const progress = await getJson<{ today: string; project: { rag: { effective: string } } }>(api, `/api/v1/projects/${dc}/progress`);
    // The overdue paper outranks every decision whose latest safe date is today or later: it is in the top three unless
    // three open decisions are at least as overdue (earlier runs of this spec on the same database leave such papers).
    const overdueDate = dayBefore(today);
    expect(
      top.some((d) => d.id === overdue.id) || top.every((d) => d.latestSafeDate !== null && d.latestSafeDate <= overdueDate),
      'the overdue paper is ranked before every decision that is not overdue',
    ).toBe(true);
    expect(top[0]!.latestSafeDate! < today, 'the most urgent open decision is overdue').toBe(true);
    const gates = (await getJson<{ items: Gate[] }>(api, `/api/v1/projects/${dc}/gates`)).items;
    const next = nextGateOf(gates);
    const submitted = await total(api, `/api/v1/projects/${dc}/decisions?status=submitted&pageSize=1`);
    const underReview = await total(api, `/api/v1/projects/${dc}/decisions?status=under_review&pageSize=1`);
    const pendingAgenda = await total(api, `/api/v1/projects/${dc}/agenda-requests?screeningStatus=requested&pageSize=1`);
    await api.dispose();
    // Besides the fixture, the demo seed has open decisions (DEC-003 submitted, DEC-002 recommended, DEC-005 draft) and
    // G1 as the next gate.
    expect(top.length, 'open decisions exist').toBeGreaterThan(1);
    expect(next, 'a next gate exists').not.toBeNull();

    const s = await openAs(browser, P.sponsor);
    const page = s.page;
    try {
      await page.goto(`/projects/${dc}`);
      await expect(page.getByText('DC Executive Cockpit')).toBeVisible();

      // Four separate status dimensions, each with its own state (never merged).
      const dims = page.getByTestId('dimension-cards').locator('[data-dimension]');
      await expect(dims).toHaveCount(4);
      for (const key of ['incorporation', 'perimeter_transfer', 'operational_readiness', 'jv_transaction']) {
        await expect(page.locator(`[data-testid="dimension-cards"] [data-dimension="${key}"] [data-status]`)).toBeVisible();
      }

      // Overall health = the server's worst-of delivery status, not an average of the dimensions.
      await expect(page.getByTestId('overall-health')).toHaveAttribute('data-rag', progress.project.rag.effective);
      // Next gate from the live gate evaluation; delay impact with the schedule-based forecast label.
      await expect(page.getByTestId('next-gate')).toHaveAttribute('data-gate-key', next!.key);
      await expect(page.getByTestId('next-gate-blocker-count')).toContainText(String(next!.blockers.length));
      await expect(page.getByTestId('delay-impact-tile').getByTestId('forecast-label')).toBeVisible();

      // Top three decisions: exactly the API's most urgent open decisions, in order, overdue flagged, Demo badged.
      const rows = page.getByTestId('top-decision');
      await expect(rows).toHaveCount(top.length);
      for (const [i, d] of top.entries()) {
        const row = rows.nth(i);
        await expect(row).toHaveAttribute('data-decision-code', d.code);
        await expect(row).toHaveAttribute('data-decision-status', d.status);
        await expect(row).toHaveAttribute('data-overdue', d.latestSafeDate !== null && d.latestSafeDate < progress.today ? 'true' : 'false');
        if (d.isDemo) await expect(row.getByTestId('demo-badge')).toBeVisible();
      }
      // Nothing that is not open (approved, in implementation …) is ranked.
      for (const code of await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-decision-code')))) {
        expect(open.map((d) => d.code)).toContain(code);
      }

      // Blockers of the next gate (first three, in the API's order).
      const blockers = page.getByTestId('top-blocker');
      const expectedBlockers = next!.blockers.slice(0, 3);
      await expect(page.getByTestId('top-blockers')).toHaveAttribute('data-gate-key', next!.key);
      await expect(blockers).toHaveCount(expectedBlockers.length);
      for (const [i, b] of expectedBlockers.entries()) await expect(blockers.nth(i)).toHaveAttribute('data-blocker-ref', b.ref);

      // Committee asks: counts equal the API totals within the caller's scope.
      const count = (kind: string) => page.locator(`[data-testid="committee-ask-count"][data-kind="${kind}"]`);
      await expect(count('submitted')).toHaveAttribute('data-value', String(submitted));
      await expect(count('under_review')).toHaveAttribute('data-value', String(underReview));
      await expect(count('agenda_requested')).toHaveAttribute('data-value', String(pendingAgenda));
      expect(pendingAgenda, 'the fixture agenda request is pending').toBeGreaterThan(0);
      await expect(page.getByTestId('pending-agenda-item')).toHaveCount(Math.min(3, pendingAgenda));
      if (pendingAgenda <= 3) await expect(page.getByTestId('pending-agenda').getByText(agendaTitle)).toBeVisible();
      // The overdue paper is flagged in text and icon, not colour alone.
      await expect(rows.first()).toHaveAttribute('data-overdue', 'true');
      await expect(rows.first().getByTestId('overdue-badge')).toHaveText('Overdue');

      await page.screenshot({ path: join(SHOTS, 'cockpit-en.png'), fullPage: true });

      // Links open the contributing records.
      await rows.first().getByTestId('top-decision-link').click();
      await expect(page).toHaveURL(new RegExp(`/projects/${dc}/committee/decisions/${top[0]!.id}$`));
      await expect(page.getByRole('heading', { level: 1 })).toContainText(top[0]!.title);
      await page.goBack();

      await blockers.first().getByTestId('top-blocker-link').click();
      await expect(page).toHaveURL(new RegExp(`/projects/${dc}/gates/[0-9a-f-]+$`));
      await expect(page.getByTestId('gate-title')).toContainText(expectedBlockers[0]!.kind === 'prerequisite' ? expectedBlockers[0]!.ref : next!.key);
      await page.goBack();

      await page.getByTestId('pending-agenda-link').first().click();
      await expect(page).toHaveURL(new RegExp(`/projects/${dc}/committee/(decisions/[0-9a-f-]+|meetings)`));
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.goBack();

      await count('agenda_requested').getByRole('link').click();
      await expect(page).toHaveURL(new RegExp(`/projects/${dc}/committee/meetings\\?aStatus=requested#agenda-requests$`));
      await expect(page.locator('section[aria-labelledby="agenda-requests"]')).toContainText(agendaTitle);
      await page.goBack();

      await count('submitted').getByRole('link').click();
      await expect(page).toHaveURL(new RegExp(`/projects/${dc}/committee/decisions\\?status=submitted$`));
      await expect(page.getByTestId('filter-status')).toHaveValue('submitted');
      await page.goBack();

      await page.getByTestId('overall-health-link').click();
      await expect(page).toHaveURL(new RegExp(`/projects/${dc}/plan\\?tab=health$`));
      await expect(page.getByTestId('health-tab')).toBeVisible();
    } finally {
      await s.close();
    }
    expect(s.problems(), s.problems().join('\n')).toEqual([]);
  });

  test('(b) Arabic (RTL) and 390 px: the same tiles render right-to-left with mixed-language records and no sideways scrolling', async ({ browser, baseURL }) => {
    const api = await apiSessionAs(baseURL!, P.sponsor);
    const { top } = await expectedTopDecisions(api, dc);
    await api.dispose();
    const s = await openAs(browser, P.sponsor, 'ar', baseURL);
    const page = s.page;
    try {
      await page.goto(`/projects/${dc}`);
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByText('لوحة القيادة التنفيذية لمراكز البيانات')).toBeVisible();
      await expect(page.getByRole('heading', { level: 3, name: 'أهم ثلاثة قرارات وعوائق' })).toBeVisible();
      await expect(page.getByRole('heading', { level: 3, name: 'طلبات اللجنة' })).toBeVisible();
      await expect(page.getByRole('heading', { level: 3, name: 'الصحة العامة' })).toBeVisible();
      await expect(page.getByTestId('dimension-cards').locator('[data-dimension]')).toHaveCount(4);
      await expect(page.getByTestId('top-decision')).toHaveCount(top.length);
      // English record titles keep their own direction inside the Arabic UI.
      const firstTitle = page.getByTestId('top-decision').first().getByTestId('top-decision-title');
      await expect(firstTitle).toHaveText(top[0]!.title);
      await expect(firstTitle).toHaveAttribute('dir', 'auto');
      await page.screenshot({ path: join(SHOTS, 'cockpit-ar.png'), fullPage: true });

      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload();
      await expect(page.getByTestId('top-decision')).toHaveCount(top.length);
      await expect(page.getByTestId('committee-asks-tile')).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, 'no horizontal page scroll at 390 px').toBeLessThanOrEqual(0);
      await page.screenshot({ path: join(SHOTS, 'cockpit-ar-390.png'), fullPage: true });
    } finally {
      await s.close();
    }
    expect(s.problems(), s.problems().join('\n')).toEqual([]);
  });

  test('(c) restricted: without governance read the decisions part is restricted, committee asks are hidden and neither list is requested; a partial reader sees only what they may read', async ({ browser, baseURL }) => {
    // Demo Portfolio Admin: gates and plan, no governance permissions.
    const admin = await openAs(browser, P.portfolioAdmin);
    try {
      const hits = trackRequests(admin.page, /\/(decisions|agenda-requests)$/);
      await admin.page.goto(`/projects/${dc}`);
      const tile = admin.page.getByTestId('top-decisions-tile');
      await expect(tile.getByTestId('tile-restricted')).toHaveCount(1);
      await expect(tile.getByTestId('top-blockers')).toBeVisible();
      await expect(admin.page.getByTestId('overall-health')).toBeVisible();
      await expect(admin.page.getByTestId('committee-asks-tile')).toHaveCount(0);
      await expect(admin.page.getByTestId('top-decision')).toHaveCount(0);
      await admin.page.screenshot({ path: join(SHOTS, 'cockpit-en-restricted.png'), fullPage: true });
      expect(hits, 'no governance list requested').toEqual([]);
    } finally {
      await admin.close();
    }
    expect(admin.problems(), admin.problems().join('\n')).toEqual([]);

    // Demo Contributor: may read decisions but not meetings/agenda requests.
    const api = await apiSessionAs(baseURL!, P.contributor);
    const submitted = await total(api, `/api/v1/projects/${dc}/decisions?status=submitted&pageSize=1`);
    const { top } = await expectedTopDecisions(api, dc);
    await api.dispose();
    const c = await openAs(browser, P.contributor);
    try {
      const hits = trackRequests(c.page, /\/agenda-requests$/);
      await c.page.goto(`/projects/${dc}`);
      const asks = c.page.getByTestId('committee-asks-tile');
      await expect(asks).toBeVisible();
      await expect(asks.locator('[data-testid="committee-ask-count"][data-kind="submitted"]')).toHaveAttribute('data-value', String(submitted));
      await expect(asks.locator('[data-testid="committee-ask-count"][data-kind="agenda_requested"]').getByTestId('tile-restricted')).toBeVisible();
      await expect(asks.getByTestId('pending-agenda-item')).toHaveCount(0);
      await expect(c.page.getByTestId('top-decision')).toHaveCount(top.length);
      expect(hits, 'agenda requests not requested without governance.meeting.read').toEqual([]);
    } finally {
      await c.close();
    }
    expect(c.problems(), c.problems().join('\n')).toEqual([]);
  });

  test('(d) empty and error states: a project without decisions shows the empty states; a failing list shows a retryable error', async ({ browser, baseURL }) => {
    // Empty: DEMO-TRANSFORM (Demo PM — Project B) has no decisions and no agenda requests in the demo seed.
    const api = await apiSessionAs(baseURL!, P.pmB);
    const { top } = await expectedTopDecisions(api, transform);
    const pendingAgenda = await total(api, `/api/v1/projects/${transform}/agenda-requests?screeningStatus=requested&pageSize=1`);
    await api.dispose();
    const b = await openAs(browser, P.pmB);
    try {
      await b.page.goto(`/projects/${transform}`);
      await expect(b.page.getByTestId('top-decisions-tile')).toBeVisible();
      if (top.length === 0) {
        await expect(b.page.getByTestId('top-decisions-empty')).toBeVisible();
        await expect(b.page.getByTestId('awaiting-committee-empty')).toBeVisible();
      } else {
        await expect(b.page.getByTestId('top-decision')).toHaveCount(top.length);
      }
      if (pendingAgenda === 0) await expect(b.page.getByTestId('pending-agenda-empty')).toBeVisible();
      await expect(b.page.getByTestId('committee-ask-count').first()).toHaveAttribute('data-value', /^\d+$/);
    } finally {
      await b.close();
    }
    expect(b.problems(), b.problems().join('\n')).toEqual([]);

    // Error: the decision register answers 500 (injected) → a retryable error in the tile, never an empty list or zeros.
    const s = await openAs(browser, P.pm);
    try {
      let fail = true;
      await s.page.route(/\/api\/v1\/projects\/[^/]+\/decisions\?/, (route) =>
        fail
          ? route.fulfill({ status: 500, contentType: 'application/problem+json', body: JSON.stringify({ type: 'about:blank', title: 'Internal Server Error', status: 500, code: 'internal' }) })
          : route.continue(),
      );
      await s.page.goto(`/projects/${dc}`);
      const tile = s.page.getByTestId('top-decisions-tile');
      await expect(tile.getByTestId('tile-error')).toBeVisible({ timeout: 20_000 });
      await expect(tile.getByTestId('top-decision')).toHaveCount(0);
      const submittedCount = s.page.locator('[data-testid="committee-ask-count"][data-kind="submitted"]');
      await expect(submittedCount).not.toHaveAttribute('data-value', /.*/);
      await expect(submittedCount.getByTestId('count-unavailable')).toBeVisible();
      fail = false;
      await tile.getByTestId('tile-error').getByRole('button', { name: 'Try again' }).click();
      await expect(tile.getByTestId('top-decision').first()).toBeVisible();
      await expect(submittedCount).toHaveAttribute('data-value', /^\d+$/);
    } finally {
      await s.close();
    }
  });
});
