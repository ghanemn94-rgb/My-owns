import { expect, test, type APIRequestContext, type Browser, type Locator, type Page, type Route } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PERSONAS, apiSessionAs, loginAs, watchConsole } from './helpers';
import { checkArabic, checkDialogA11y, watchBilingual } from './qa-rtl-detector';

/**
 * P2 residuals — screens and end-to-end acceptance (docs/phases/P2-P4-requirement-disposition.md, "Update at the P2 gate"),
 * against the real API in DEMO mode. Every asserted behaviour goes through the UI; fixtures that are not the subject of a
 * test (a task, a risk, a tabled decision, a fresh project) are prepared through the API with the demo personas.
 *  (a) REQ-PLN-002   Kanban: a move is the task's own status command, reflected in the WBS table and the Gantt (keyboard,
 *                    pointer drag, Arabic RTL);
 *  (b) REQ-UX-006    Program Overview & Charter: committee charter version + approval state, approved baseline (version,
 *                    approval date, approver role); none-yet and restricted states;
 *  (c) REQ-UX-024    Committee Hub, cockpit and Portfolio Home metrics open a filtered list whose row count equals the number;
 *  (d) REQ-SET-013/014 setup wizard steps 5 and 6: draft delegation pending approval; draft (proposed) baseline + gate list;
 *  (e) REQ-UX-007    AT-04 from the Committee Hub: Recommended — pending external authority, with its escalation;
 *  (f) REQ-UX-008    Gantt: critical path and baseline variance;
 *  (g) REQ-UX-009    a workstream lead submits a status update from the workspace;
 *  (h) REQ-UX-015    a change request raised from a risk stays linked to it;
 *  (i) REQ-UX-022    loading, empty, error and restricted states on each P2 screen (route interception + a real outsider);
 *  (j) REQ-UX-023    an edit shows in the record history with its actor and reason.
 * All data is synthetic. Screenshots: e2e/screenshots/p2r.
 */
const SHOTS = join(__dirname, '..', 'screenshots', 'p2r');
mkdirSync(SHOTS, { recursive: true });
const RUN = Date.now().toString(36).toUpperCase();
const P = {
  pm: PERSONAS.pm,
  pmB: PERSONAS.pmB,
  sponsor: 'Demo Sponsor',
  chair: 'Demo Committee Chair',
  secretary: 'Demo Secretary / CPMO',
  finance: 'Demo Finance Member',
  legal: 'Demo Legal Member',
  approver: 'Demo Functional Approver',
  contributor: PERSONAS.contributor,
  opsLead: 'Demo Operations Lead',
  admin: PERSONAS.portfolioAdmin,
} as const;
const STEERING = 'DC Carve-out & JV Steering Committee (Demo)';
const OPEN_RISKS = 'open,monitoring,escalated';

interface Client {
  get: <T = Record<string, unknown>>(path: string) => Promise<T>;
  post: <T = Record<string, unknown>>(path: string, data: unknown) => Promise<T>;
  patch: <T = Record<string, unknown>>(path: string, data: unknown) => Promise<T>;
  dispose: () => Promise<void>;
}

async function client(baseURL: string, persona: string): Promise<Client> {
  const ctx: APIRequestContext = await apiSessionAs(baseURL, persona);
  const csrf = (await ctx.storageState()).cookies.find((c) => c.name === 'hub_csrf')?.value ?? '';
  return {
    get: async (path) => {
      const r = await ctx.get(path);
      expect(r.ok(), `GET ${path} → ${r.status()} ${await r.text()}`).toBeTruthy();
      return r.json();
    },
    post: async (path, data) => {
      const r = await ctx.post(path, { data, headers: { 'x-csrf-token': csrf } });
      expect(r.ok(), `POST ${path} (${persona}) → ${r.status()} ${await r.text()}`).toBeTruthy();
      return r.json();
    },
    patch: async (path, data) => {
      const r = await ctx.patch(path, { data, headers: { 'x-csrf-token': csrf } });
      expect(r.ok(), `PATCH ${path} (${persona}) → ${r.status()} ${await r.text()}`).toBeTruthy();
      return r.json();
    },
    dispose: () => ctx.dispose(),
  };
}

async function withClient<T>(baseURL: string, persona: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = await client(baseURL, persona);
  try {
    return await fn(c);
  } finally {
    await c.dispose();
  }
}

async function asPersona(browser: Browser, baseURL: string, persona: string, locale: 'en' | 'ar' = 'en') {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const problems = watchConsole(page);
  await loginAs(page, persona);
  // The rendering language comes from the `hub_locale` cookie; the persona's saved preference is left untouched.
  await ctx.addCookies([{ name: 'hub_locale', value: locale, url: baseURL }]);
  return { page, problems, close: () => ctx.close() };
}

async function userId(baseURL: string, persona: string): Promise<string> {
  const ctx = await apiSessionAs(baseURL, persona);
  try {
    const users = (await (await ctx.get('/api/v1/auth/demo-users')).json()) as { items: { id: string; displayName: string }[] };
    return users.items.find((u) => u.displayName === persona)!.id;
  } finally {
    await ctx.dispose();
  }
}

function riyadh(offsetDays = 0): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + offsetDays * 86_400_000));
}

function riyadhNow(): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00+03:00`;
}

async function confirm(page: Page, name: string) {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name, exact: true }).click();
  await expect(dialog).toBeHidden();
}

/** Total of a DataTable (server total when paginated) once it has settled. */
async function tableTotal(table: Locator): Promise<number> {
  await expect(table).toHaveAttribute('data-state', /^(ready|empty)$/, { timeout: 30_000 });
  return Number(await table.getAttribute('data-total'));
}

/** Rows of a DataTable across all its pages (walks "Next"). */
async function countRows(table: Locator): Promise<number> {
  await expect(table).toHaveAttribute('data-state', /^(ready|empty)$/, { timeout: 30_000 });
  if ((await table.getAttribute('data-state')) === 'empty') return 0;
  let n = 0;
  for (let guard = 0; guard < 50; guard++) {
    n += await table.locator('tbody tr').count();
    const next = table.getByRole('button', { name: 'Next' });
    if ((await next.count()) === 0 || (await next.isDisabled())) break;
    const before = await table.locator('tbody tr').first().textContent();
    await next.click();
    await expect.poll(() => table.locator('tbody tr').first().textContent()).not.toBe(before);
  }
  return n;
}

/** The page never scrolls sideways — at the current width and at 390 px (wide content scrolls inside its own region). */
async function noSideScroll(page: Page, ready: Locator, name: string) {
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow(), `${name}: no horizontal page scroll`).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(ready).toBeVisible({ timeout: 30_000 });
  expect(await overflow(), `${name}: no horizontal page scroll at 390 px`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: join(SHOTS, `${name}-390.png`), fullPage: true });
}

const problem = (status: number, title: string) => ({ status, contentType: 'application/problem+json', body: JSON.stringify({ type: 'about:blank', title, status, code: status === 404 ? 'not_found' : 'internal' }) });

let dc = '';
let transform = '';
let ws = new Map<string, string>();

test.beforeAll(async ({ baseURL }) => {
  await withClient(baseURL!, P.pm, async (pm) => {
    const projects = (await pm.get<{ items: { id: string; code: string }[] }>('/api/v1/projects?pageSize=100')).items;
    dc = projects.find((p) => p.code === 'DEMO-DC')!.id;
    ws = new Map((await pm.get<{ items: { id: string; code: string }[] }>(`/api/v1/projects/${dc}/workstreams`)).items.map((w) => [w.code, w.id]));
  });
  await withClient(baseURL!, P.pmB, async (pmB) => {
    transform = (await pmB.get<{ items: { id: string; code: string }[] }>('/api/v1/projects?pageSize=100')).items.find((p) => p.code === 'DEMO-TRANSFORM')!.id;
  });
});

test.describe('P2 residuals — screens and end-to-end acceptance', () => {
  test('(a) REQ-PLN-002 Kanban: a card moved with the keyboard runs the task status command and the WBS table and the Gantt show the new status; a dragged card goes through the same confirmation; Arabic RTL board', async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(240_000);
    const title = `E2E Kanban task ${RUN} (synthetic)`;
    const task = await withClient(baseURL!, P.pm, async (pm) => {
      const t = await pm.post<{ id: string }>(`/api/v1/projects/${dc}/tasks`, { workstreamId: ws.get('WS01'), title, durationDays: 3, plannedStart: '2026-11-01', plannedFinish: '2026-11-03' });
      return pm.get<{ id: string; wbsCode: string; status: string }>(`/api/v1/projects/${dc}/tasks/${t.id}`);
    });
    expect(task.status).toBe('not_started');
    const s = await asPersona(browser, baseURL!, P.pm);
    const page = s.page;
    try {
      await page.goto(`/projects/${dc}/plan?tab=kanban`);
      await expect(page.getByRole('tab', { name: 'Kanban' })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByTestId('kanban-board')).toBeVisible();
      // One column per task status, in lifecycle order.
      await expect(page.getByTestId('kanban-column')).toHaveCount(8);
      await page.getByLabel('Search by code or title').fill(RUN);
      const card = page.locator(`[data-testid="kanban-card"][data-task-id="${task.id}"]`);
      const inColumn = (status: string) => page.locator(`[data-testid="kanban-column"][data-status="${status}"] [data-testid="kanban-card"][data-task-id="${task.id}"]`);
      await expect(inColumn('not_started')).toBeVisible();
      await expect(card.getByTestId('kanban-card-link')).toContainText(task.wbsCode);

      // --- Keyboard only: Move → Tab to the first move (Start) → Enter → confirm.
      await card.getByTestId('kanban-move').focus();
      await page.keyboard.press('Enter');
      await expect(card.getByTestId('kanban-move')).toHaveAttribute('aria-expanded', 'true');
      await page.keyboard.press('Tab');
      await expect(card.locator('[data-testid="kanban-move-to"][data-command="start"]')).toBeFocused();
      await expect(card.locator('[data-testid="kanban-move-to"][data-command="start"]')).toHaveText('In progress — Start');
      await page.keyboard.press('Enter');
      let dialog = page.getByRole('dialog');
      await expect(dialog).toContainText(`${task.wbsCode} moves from “Not started” to “In progress”.`);
      await expect(dialog).toContainText('The task becomes In progress');
      await checkDialogA11y(page, dialog, 'kanban-move-dialog');
      await page.screenshot({ path: join(SHOTS, 'kanban-move-dialog-en.png') });
      await dialog.getByRole('button', { name: 'Start', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(inColumn('in_progress')).toBeVisible();
      await expect(inColumn('not_started')).toHaveCount(0);
      // Focus follows the moved card (keyboard users keep their place).
      await expect.poll(() => page.evaluate(() => document.activeElement?.closest('[data-testid="kanban-card"]')?.getAttribute('data-task-id') ?? null)).toBe(task.id);
      // The server state changed through the status command (not an edit): status and an audited "start" in the history.
      await withClient(baseURL!, P.pm, async (pm) => {
        expect((await pm.get<{ status: string }>(`/api/v1/projects/${dc}/tasks/${task.id}`)).status).toBe('in_progress');
        const activity = await pm.get<{ items: { action: string; actor: string | null }[] }>(`/api/v1/projects/${dc}/activity?entityType=task&entityId=${task.id}&pageSize=20`);
        expect(activity.items.some((e) => e.action === 'planning.task.start' && e.actor === P.pm)).toBe(true);
      });

      // --- The same persisted task in the WBS table and the timeline (Gantt).
      await page.goto(`/projects/${dc}/plan?tab=wbs`);
      await page.getByLabel('Search by code or title').fill(RUN);
      await expect(page.locator(`[data-testid="wbs-table"] tr[data-task="${task.wbsCode}"] [data-status="in_progress"]`)).toBeVisible();
      await page.goto(`/projects/${dc}/plan?tab=timeline`);
      await expect(page.locator(`[data-testid="gantt-row"][data-code="${task.wbsCode}"]`)).toHaveAttribute('data-status', 'in_progress');
      await expect(page.locator(`[data-testid="gantt"] [data-node="${task.id}"]`)).toHaveAttribute('data-status', 'in_progress');

      // --- Pointer: dragging the card onto "Blocked" opens the same command confirmation (a reason is required).
      await page.goto(`/projects/${dc}/plan?tab=kanban`);
      await page.getByLabel('Search by code or title').fill(RUN);
      await expect(inColumn('in_progress')).toBeVisible();
      // Drag-and-drop of the card onto the "Blocked" column: the HTML drag events (dragstart → dragover → drop → dragend)
      // with one DataTransfer, dispatched on the elements (native pointer drags are not deterministic in headless runs).
      const blocked = page.locator('[data-testid="kanban-column"][data-status="blocked"]');
      const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
      await card.dispatchEvent('dragstart', { dataTransfer });
      await expect(blocked).toHaveClass(/border-primary/); // the legal target is highlighted while dragging
      await blocked.dispatchEvent('dragenter', { dataTransfer });
      await blocked.dispatchEvent('dragover', { dataTransfer });
      await blocked.dispatchEvent('drop', { dataTransfer });
      await card.dispatchEvent('dragend', { dataTransfer });
      dialog = page.getByRole('dialog');
      await expect(dialog).toContainText(`${task.wbsCode} moves from “In progress” to “Blocked”.`);
      await expect(dialog.getByRole('button', { name: 'Record blocker', exact: true })).toBeVisible();
      await dialog.getByLabel(/^Reason/).fill('Synthetic E2E: waiting for a vendor slot');
      await dialog.getByRole('button', { name: 'Record blocker', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(inColumn('blocked')).toBeVisible();
      await page.screenshot({ path: join(SHOTS, 'kanban-en.png'), fullPage: true });
      expect(s.problems(), s.problems().join('\n')).toEqual([]);
    } finally {
      await s.close();
    }

    // --- Arabic (RTL): the board reads right-to-left (first column at the right) and has no untranslated UI text.
    const ar = await asPersona(browser, baseURL!, P.pm, 'ar');
    try {
      const bilingual = watchBilingual(ar.page);
      await ar.page.goto(`/projects/${dc}/plan?tab=kanban`);
      await ar.page.getByTestId('kanban-filter-ws').selectOption(ws.get('WS03')!);
      await expect(ar.page.getByTestId('kanban-board')).toBeVisible();
      const first = await ar.page.locator('[data-testid="kanban-column"][data-status="draft"]').boundingBox();
      const second = await ar.page.locator('[data-testid="kanban-column"][data-status="not_started"]').boundingBox();
      expect(first!.x, 'RTL: the first column is to the right of the second').toBeGreaterThan(second!.x);
      await checkArabic(ar.page, testInfo, SHOTS, 'p2r-kanban', bilingual);
      await noSideScroll(ar.page, ar.page.getByTestId('kanban-board'), 'ar-p2r-kanban');
      expect(ar.problems(), ar.problems().join('\n')).toEqual([]);
    } finally {
      await ar.close();
    }
  });

  test('(b) REQ-UX-006 Program Overview & Charter renders the committee charter version with its approval state and the approved baseline (version, approval date, approver role); none-yet and restricted states', async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(180_000);
    const expected = await withClient(baseURL!, P.pm, async (pm) => {
      const committees = (await pm.get<{ items: { id: string; name: string; kind: string; charterVersionNo: number; charterApprovedVersionNo: number | null }[] }>(`/api/v1/projects/${dc}/committees?pageSize=100`)).items;
      const baseline = (await pm.get<{ baseline: { versionNo: number; approvedAt: string; approvedByName: string; approverRoles: string[] } | null }>(`/api/v1/projects/${dc}/baselines/current`)).baseline;
      return { committees, baseline };
    });
    const steering = expected.committees.find((c) => c.name === STEERING)!;
    expect(expected.baseline, 'DEMO-DC has an approved baseline').not.toBeNull();
    expect(expected.baseline!.approverRoles.length).toBeGreaterThan(0);

    const s = await asPersona(browser, baseURL!, P.pm);
    try {
      await s.page.goto(`/projects/${dc}/charter`);
      const committees = s.page.getByTestId('overview-committees');
      await expect(committees).toHaveAttribute('data-state', 'ready');
      await expect(committees.locator('[data-testid="overview-committee-charter"]')).toHaveCount(expected.committees.length);
      const steeringCell = committees.getByRole('row').filter({ hasText: STEERING }).getByTestId('overview-committee-charter');
      await expect(steeringCell).toHaveAttribute('data-charter-version', String(steering.charterVersionNo));
      await expect(steeringCell).toHaveAttribute('data-charter-state', steering.charterApprovedVersionNo === steering.charterVersionNo ? 'approved' : steering.charterApprovedVersionNo === null ? 'not_approved' : 'amendment_pending');
      await expect(steeringCell).toContainText(`Version ${steering.charterVersionNo}`);
      if (steering.charterApprovedVersionNo === steering.charterVersionNo) await expect(steeringCell).toContainText('Approved');
      // A draft board (NewCo board in the seed) shows "Not approved yet".
      const draftBoard = expected.committees.find((c) => c.charterApprovedVersionNo === null);
      if (draftBoard) await expect(committees.getByRole('row').filter({ hasText: draftBoard.name }).getByTestId('overview-committee-charter')).toContainText('Not approved yet');

      const baseline = s.page.getByTestId('overview-baseline');
      await expect(baseline).toHaveAttribute('data-state', 'approved');
      await expect(baseline.getByTestId('overview-baseline-version')).toContainText(`Version ${expected.baseline!.versionNo}`);
      await expect(baseline.getByTestId('overview-baseline-approved-at')).not.toHaveText('—');
      await expect(baseline.getByTestId('overview-baseline-approver')).toHaveText(expected.baseline!.approvedByName);
      await expect(baseline.getByTestId('overview-baseline-approver-roles').locator('[data-roles]')).toHaveAttribute('data-roles', expected.baseline!.approverRoles.join(','));
      if (expected.baseline!.approverRoles.includes('sponsor')) await expect(baseline.getByTestId('overview-baseline-approver-roles')).toContainText('Sponsor');
      await s.page.screenshot({ path: join(SHOTS, 'overview-charter-baseline-en.png'), fullPage: true });
      expect(s.problems(), s.problems().join('\n')).toEqual([]);
    } finally {
      await s.close();
    }

    // Arabic (RTL).
    const ar = await asPersona(browser, baseURL!, P.pm, 'ar');
    try {
      const bilingual = watchBilingual(ar.page);
      await ar.page.goto(`/projects/${dc}/charter`);
      await expect(ar.page.getByTestId('overview-baseline')).toHaveAttribute('data-state', 'approved');
      await expect(ar.page.getByTestId('overview-committees')).toHaveAttribute('data-state', 'ready');
      await checkArabic(ar.page, testInfo, SHOTS, 'p2r-overview-charter-baseline', bilingual);
      await noSideScroll(ar.page, ar.page.locator('[data-testid="overview-baseline"][data-state="approved"]'), 'ar-p2r-overview');
    } finally {
      await ar.close();
    }

    // None yet: DEMO-TRANSFORM (Project B) has no committee and no approved baseline in the demo seed.
    const none = await withClient(baseURL!, P.pmB, async (c) => ({
      committees: (await c.get<{ total: number }>(`/api/v1/projects/${transform}/committees?pageSize=1`)).total,
      approved: (await c.get<{ items: { status: string }[] }>(`/api/v1/projects/${transform}/baselines`)).items.some((b) => b.status === 'approved'),
    }));
    const b = await asPersona(browser, baseURL!, P.pmB);
    try {
      await b.page.goto(`/projects/${transform}/charter`);
      if (none.committees === 0) await expect(b.page.getByTestId('overview-committees-none')).toContainText('No committee has been set up yet.');
      if (!none.approved) {
        await expect(b.page.getByTestId('overview-baseline')).toHaveAttribute('data-state', 'none');
        await expect(b.page.getByTestId('overview-baseline-none')).toContainText('No approved baseline yet.');
      }
      await b.page.screenshot({ path: join(SHOTS, 'overview-none-yet-en.png'), fullPage: true });
      expect(b.problems(), b.problems().join('\n')).toEqual([]);
    } finally {
      await b.close();
    }

    // Restricted: the Portfolio Admin reads the plan but not governance → the committee part is restricted, never requested,
    // and shows no committee name or count.
    const admin = await asPersona(browser, baseURL!, P.admin);
    try {
      const hits: string[] = [];
      admin.page.on('request', (r) => {
        if (/\/committees(\?|$)/.test(new URL(r.url()).pathname + new URL(r.url()).search)) hits.push(r.url());
      });
      await admin.page.goto(`/projects/${dc}/charter`);
      await expect(admin.page.getByTestId('overview-committees')).toHaveAttribute('data-state', 'restricted');
      await expect(admin.page.getByTestId('overview-committees-restricted')).toBeVisible();
      await expect(admin.page.getByTestId('overview-committees')).not.toContainText(STEERING);
      expect(hits, 'the committee list is not requested').toEqual([]);
      expect(admin.problems(), admin.problems().join('\n')).toEqual([]);
    } finally {
      await admin.close();
    }
  });

  test('(c) REQ-UX-024 Committee Hub, cockpit and Portfolio Home metric tiles open a filtered list whose row count equals the tile number, for a full and a partial reader', async ({ browser, baseURL }) => {
    test.setTimeout(300_000);
    // Fixture: an overdue committee action, and one linked to a RESTRICTED paper (not visible to the PM or the contributor).
    await withClient(baseURL!, P.secretary, async (sec) => {
      const committees = (await sec.get<{ items: { id: string; name: string }[] }>(`/api/v1/projects/${dc}/committees?pageSize=100`)).items;
      const steering = committees.find((c) => c.name === STEERING)!;
      const pmId = await userId(baseURL!, P.pm);
      await sec.post(`/api/v1/projects/${dc}/actions`, { title: `E2E overdue action ${RUN} (synthetic)`, ownerUserId: pmId, dueDate: riyadh(-2) });
      const hidden = await sec.post<{ id: string }>(`/api/v1/projects/${dc}/decisions`, { committeeId: steering.id, title: `E2E restricted paper ${RUN} (synthetic)`, classification: 'restricted' });
      await sec.post(`/api/v1/projects/${dc}/actions`, { title: `E2E overdue action of a restricted paper ${RUN} (synthetic)`, decisionId: hidden.id, ownerUserId: pmId, dueDate: riyadh(-3) });
    });

    const hubTiles: { metric: string; table: string }[] = [
      { metric: 'underReview', table: 'decisions-table' },
      { metric: 'recommended', table: 'decisions-table' },
      { metric: 'implementationPending', table: 'decisions-table' },
      { metric: 'openActions', table: 'actions-table' },
      { metric: 'overdueActions', table: 'actions-table' },
      { metric: 'escalations', table: 'escalations-table' },
    ];
    const cockpitTiles: { metric: string; table: string | null }[] = [
      { metric: 'workstreams', table: 'workstreams-table' },
      { metric: 'tasks', table: null },
      { metric: 'milestones', table: 'milestones-table' },
      { metric: 'deliverables', table: 'deliverables-table' },
      { metric: 'openRisks', table: 'raid-table-risks' },
      { metric: 'overdueActions', table: 'actions-table' },
    ];

    for (const persona of [P.pm, P.contributor]) {
      const s = await asPersona(browser, baseURL!, persona);
      const page = s.page;
      try {
        // --- Committee Hub tiles.
        for (const tile of hubTiles) {
          await page.goto(`/projects/${dc}/committee`);
          const card = page.locator(`[data-testid="metric-card"][data-metric="${tile.metric}"]`);
          await expect(card).toHaveAttribute('data-value', /^\d+$/);
          const value = Number(await card.getAttribute('data-value'));
          await card.click();
          const table = page.getByTestId(tile.table);
          expect(await tableTotal(table), `${persona} hub ${tile.metric}: list total`).toBe(value);
          expect(await countRows(table), `${persona} hub ${tile.metric}: rows`).toBe(value);
          if (tile.metric === 'escalations') await expect(page.getByTestId('filter-unresolved')).toBeChecked();
        }
        // --- Cockpit metric cards.
        for (const tile of cockpitTiles) {
          await page.goto(`/projects/${dc}`);
          const card = page.locator(`[data-testid="metric-card"][data-metric="${tile.metric}"]`);
          if ((await card.count()) === 0) continue; // not visible to this persona (no count is shown)
          await expect(card).toHaveAttribute('data-value', /^\d+$/);
          const value = Number(await card.getAttribute('data-value'));
          await card.click();
          if (tile.table === null) {
            // WBS table: every task row of the plan in the caller's scope.
            await expect(page.getByTestId('wbs-total')).toHaveAttribute('data-total', String(value));
            await expect(page.locator('[data-testid="wbs-table"] tr[data-task]')).toHaveCount(value);
          } else {
            const table = page.getByTestId(tile.table);
            expect(await tableTotal(table), `${persona} cockpit ${tile.metric}: list total`).toBe(value);
            expect(await countRows(table), `${persona} cockpit ${tile.metric}: rows`).toBe(value);
            if (tile.metric === 'openRisks') await expect(page.getByTestId('raid-filter-status-risks')).toHaveValue(OPEN_RISKS);
          }
        }
        // --- Committee asks (cockpit): submitted / under review open the filtered decision register.
        for (const kind of ['submitted', 'under_review']) {
          await page.goto(`/projects/${dc}`);
          const cell = page.locator(`[data-testid="committee-ask-count"][data-kind="${kind}"]`);
          await expect(cell).toHaveAttribute('data-value', /^\d+$/);
          const value = Number(await cell.getAttribute('data-value'));
          await cell.getByRole('link').click();
          expect(await countRows(page.getByTestId('decisions-table')), `${persona} committee ask ${kind}`).toBe(value);
        }
        // --- Portfolio Home: the project card's counts open the same filtered lists.
        for (const metric of ['openRisks', 'overdueActions']) {
          await page.goto('/');
          const link = page.locator(`[data-testid="project-card"]`).filter({ hasText: 'DEMO-DC' }).locator(`[data-testid="portfolio-count"][data-metric="${metric}"]`);
          if ((await link.count()) === 0) continue;
          const value = Number(await link.getAttribute('data-value'));
          await link.click();
          const table = page.getByTestId(metric === 'openRisks' ? 'raid-table-risks' : 'actions-table');
          expect(await countRows(table), `${persona} portfolio ${metric}`).toBe(value);
        }
        expect(s.problems(), s.problems().join('\n')).toEqual([]);
      } finally {
        await s.close();
      }
    }
  });

  test('(d) REQ-SET-013 / REQ-SET-014 setup wizard: step 5 creates the committee and loads a draft delegation that stays pending approval; step 6 proposes a draft baseline and shows the gate list; nothing is approved', async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(300_000);
    // Fixture (API): a fresh, NON-demo DC project (Portfolio Admin), its PM grants the secretariat role.
    const code = `P2RW-${RUN}`.slice(0, 31);
    const np = await withClient(baseURL!, P.admin, async (admin) => {
      const tpl = (await admin.get<{ items: { id: string; templateKey: string }[] }>('/api/v1/templates')).items.find((t) => t.templateKey === 'dc-carveout')!;
      const created = await admin.post<{ id: string }>('/api/v1/projects', { templateVersionId: tpl.id, code, name: `E2E setup wizard project ${RUN} (synthetic)`, classification: 'internal', projectManagerUserId: await userId(baseURL!, P.pm) });
      return created.id;
    });
    const secId = await userId(baseURL!, P.secretary);
    await withClient(baseURL!, P.pm, (pm) => pm.post(`/api/v1/projects/${np}/members`, { userId: secId, role: 'secretary_cpmo', reason: 'E2E setup wizard: committee secretariat (synthetic)' }));
    const committeeName = `E2E steering committee ${RUN} (synthetic)`;
    const decisionTypes = [
      { key: 'e2e_programme_budget', name: { en: 'Programme budget change (synthetic)', ar: 'تغيير ميزانية البرنامج (اصطناعي)' }, maxAmount: '500000.0000', currency: 'SAR', unitScale: 1, withinCommitteeAuthority: true, escalateTo: 'Delegating authority — to be confirmed' },
      { key: 'e2e_reserved_matter', name: { en: 'Reserved matter (synthetic)', ar: 'مسألة محجوزة (اصطناعية)' }, maxAmount: null, currency: 'SAR', unitScale: 1, withinCommitteeAuthority: false, escalateTo: 'Board of Directors — to be confirmed' },
    ];

    // --- Step 5 (secretariat).
    const sec = await asPersona(browser, baseURL!, P.secretary);
    try {
      const page = sec.page;
      await page.goto(`/projects/${np}/setup`);
      await expect(page.getByTestId('wizard-step-committee')).toBeVisible();
      await expect(page.getByTestId('setup-never-approves')).toContainText('Nothing is approved here');
      await expect(page.locator('[data-testid="setup-step"][data-step="committee"]')).toHaveAttribute('data-gaps', 'committee,authority_matrix');
      await expect(page.locator('[data-testid="setup-step"][data-step="committee"]')).toHaveAttribute('aria-current', 'step');
      await page.getByTestId('wizard-committee-name').fill(committeeName);
      await page.getByTestId('wizard-committee-create-submit').click();
      let dialog = page.getByRole('dialog');
      await expect(dialog).toContainText('The committee is created as a draft.');
      await confirm(page, 'Create');
      await expect(page.getByTestId('wizard-committee-summary')).toContainText(committeeName);
      await expect(page.getByTestId('wizard-committee-status')).toHaveAttribute('data-status', 'draft');
      await expect(page.getByTestId('wizard-matrix-in-force')).toContainText('None approved yet');

      // Invalid delegation text is refused before anything is sent.
      await page.getByTestId('wizard-delegation-json').fill('{ not json');
      await expect(page.getByText('This is not valid JSON.')).toBeVisible();
      await expect(page.getByTestId('wizard-delegation-submit')).toBeDisabled();
      // Quorum and voting, then the delegation table loaded from a JSON file.
      await page.getByTestId('wizard-quorum-members').fill('3');
      await page.getByTestId('wizard-quorum-percent').fill('50');
      await page.getByTestId('wizard-delegation-file').setInputFiles({ name: 'delegation.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(decisionTypes)) });
      await expect(page.getByTestId('wizard-delegation-json')).toHaveValue(/e2e_reserved_matter/);
      const preview = page.getByTestId('wizard-delegation-preview');
      await expect(preview.locator('tbody tr')).toHaveCount(2);
      await expect(preview).toContainText('Pending external authority');
      await page.getByTestId('wizard-delegation-submit').click();
      dialog = page.getByRole('dialog');
      await expect(dialog).toContainText(`Version 1 of the delegation of authority of ${committeeName} is saved as a Draft.`);
      await expect(dialog).toContainText('It is not in force');
      await expect(dialog).toContainText('This wizard does not approve it.');
      await checkDialogA11y(page, dialog, 'wizard-delegation-dialog');
      await page.screenshot({ path: join(SHOTS, 'wizard-step5-dialog-en.png') });
      await confirm(page, 'Save as draft for approval');
      const v1 = page.locator('[data-testid="wizard-matrix-status"][data-version="1"]');
      await expect(v1).toHaveAttribute('data-state', 'pending_approval');
      await expect(v1).toContainText('Draft — pending approval');
      await expect(page.getByTestId('wizard-matrix-in-force')).toContainText('None approved yet');
      // The wizard offers no approval anywhere.
      await expect(page.getByTestId('wizard-step-committee').getByRole('button', { name: /^Approve/ })).toHaveCount(0);
      await page.screenshot({ path: join(SHOTS, 'wizard-step5-en.png'), fullPage: true });
      expect(sec.problems(), sec.problems().join('\n')).toEqual([]);
    } finally {
      await sec.close();
    }
    // Server state: the matrix is a draft, not approved, nothing in force; the setup gaps still list it.
    await withClient(baseURL!, P.secretary, async (c) => {
      const committee = (await c.get<{ items: { id: string; name: string; status: string; activeMatrix: unknown }[] }>(`/api/v1/projects/${np}/committees`)).items.find((x) => x.name === committeeName)!;
      expect(committee.status).toBe('draft');
      expect(committee.activeMatrix).toBeNull();
      const versions = (await c.get<{ items: { versionNo: number; status: string; approvedAt: string | null; pendingVerification: boolean; isDemoPolicy: boolean; policy: { quorum: { minVotingMembersPresent: number; minFractionPresent: number } } }[] }>(`/api/v1/projects/${np}/committees/${committee.id}/authority-matrix-versions`)).items;
      expect(versions).toHaveLength(1);
      expect(versions[0]).toMatchObject({ versionNo: 1, status: 'draft', approvedAt: null, pendingVerification: false, isDemoPolicy: false });
      expect(versions[0]!.policy.quorum).toEqual({ minVotingMembersPresent: 3, minFractionPresent: 0.5 });
      const project = await c.get<{ setupState: { gaps: string[] } }>(`/api/v1/projects/${np}`);
      expect(project.setupState.gaps).toEqual(expect.arrayContaining(['committee', 'authority_matrix', 'baseline']));
    });
    // Arabic (RTL) of step 5.
    const secAr = await asPersona(browser, baseURL!, P.secretary, 'ar');
    try {
      const bilingual = watchBilingual(secAr.page);
      await secAr.page.goto(`/projects/${np}/setup?step=committee`);
      await expect(secAr.page.locator('[data-testid="wizard-matrix-status"][data-version="1"]')).toHaveAttribute('data-state', 'pending_approval');
      await checkArabic(secAr.page, testInfo, SHOTS, 'p2r-wizard-step5', bilingual);
      await noSideScroll(secAr.page, secAr.page.getByTestId('wizard-matrices-table'), 'ar-p2r-wizard-step5');
    } finally {
      await secAr.close();
    }

    // --- Step 6 (project manager).
    const counts = await withClient(baseURL!, P.pm, async (c) => ({
      milestones: (await c.get<{ total: number }>(`/api/v1/projects/${np}/milestones?status=planned,at_risk,achieved_pending_evidence,achieved_verified,missed&pageSize=1`)).total,
      gates: (await c.get<{ items: unknown[] }>(`/api/v1/projects/${np}/gates`)).items.length,
    }));
    expect(counts.milestones, 'the template creates milestones').toBeGreaterThan(0);
    const pm = await asPersona(browser, baseURL!, P.pm);
    try {
      const page = pm.page;
      await page.goto(`/projects/${np}/setup?step=baseline`);
      await expect(page.getByTestId('wizard-step-baseline')).toBeVisible();
      const status = page.getByTestId('wizard-baseline-status');
      await expect(status).toHaveAttribute('data-status', 'none');
      await expect(page.getByTestId('wizard-baseline-preview')).toHaveAttribute('data-milestones', String(counts.milestones));
      await expect(page.locator('[data-testid="wizard-gate"]')).toHaveCount(counts.gates);
      await page.getByTestId('wizard-baseline-propose').click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText('Baseline version 1 is created from the current plan');
      await expect(dialog).toContainText('It is not approved and not the reference');
      await checkDialogA11y(page, dialog, 'wizard-baseline-dialog');
      await dialog.getByLabel(/^Note/).fill(`E2E first baseline ${RUN} (synthetic)`).catch(() => undefined);
      await confirm(page, 'Propose draft baseline');
      await expect(status).toHaveAttribute('data-status', 'proposed');
      await expect(status).toHaveAttribute('data-version', '1');
      await expect(status).toContainText('Proposed — awaiting approval');
      await expect(page.getByTestId('wizard-step-baseline').getByRole('button', { name: /^Approve/ })).toHaveCount(0);
      await expect(page.locator('[data-command="approve"]')).toHaveCount(0);
      await page.screenshot({ path: join(SHOTS, 'wizard-step6-en.png'), fullPage: true });
      expect(pm.problems(), pm.problems().join('\n')).toEqual([]);
    } finally {
      await pm.close();
    }
    await withClient(baseURL!, P.pm, async (c) => {
      const baselines = (await c.get<{ items: { versionNo: number; status: string; approvedBy: string | null; counts: { milestones: number } }[] }>(`/api/v1/projects/${np}/baselines`)).items;
      expect(baselines).toHaveLength(1);
      expect(baselines[0]).toMatchObject({ versionNo: 1, status: 'proposed', approvedBy: null });
      expect(baselines[0]!.counts.milestones).toBe(counts.milestones);
      expect((await c.get<{ setupState: { gaps: string[] } }>(`/api/v1/projects/${np}`)).setupState.gaps).toContain('baseline');
    });
    const pmAr = await asPersona(browser, baseURL!, P.pm, 'ar');
    try {
      const bilingual = watchBilingual(pmAr.page);
      await pmAr.page.goto(`/projects/${np}/setup?step=baseline`);
      await expect(pmAr.page.getByTestId('wizard-baseline-status')).toHaveAttribute('data-status', 'proposed');
      await expect(pmAr.page.locator('[data-testid="wizard-gate"]')).toHaveCount(counts.gates);
      await checkArabic(pmAr.page, testInfo, SHOTS, 'p2r-wizard-step6', bilingual);
      await noSideScroll(pmAr.page, pmAr.page.getByTestId('wizard-gates-table'), 'ar-p2r-wizard-step6');
    } finally {
      await pmAr.close();
    }
  });

  test('(e) REQ-UX-007 / AT-04 from the Committee Hub: a reserved decision type passing its vote is shown Recommended — pending external authority with its escalation, never Approved', async ({ browser, baseURL }) => {
    test.setTimeout(240_000);
    const base = `/api/v1/projects/${dc}`;
    const title = `E2E AT-04 JV signing authorization ${RUN} (synthetic)`;
    // Fixture (API): a reserved decision type (outside the DEMO committee mandate) tabled under review in a new meeting with
    // quorum, and every present voting member votes approve (declaring no conflict).
    const decision = await withClient(baseURL!, P.pm, async (pm) =>
      withClient(baseURL!, P.secretary, async (sec) => {
        const committeeId = (await sec.get<{ items: { id: string; name: string }[] }>(`${base}/committees?pageSize=100`)).items.find((c) => c.name === STEERING)!.id;
        const d = await pm.post<{ id: string; code: string; version: number }>(`${base}/decisions`, {
          committeeId,
          title,
          decisionTypeKey: 'jv_signing_authorization',
          issue: 'Synthetic E2E issue: authorize the signing of the JV agreement.',
          whyNow: 'Synthetic: the signing window opens soon.',
          alternatives: [{ title: 'Authorize' }, { title: 'Defer' }],
          recommendation: 'Recommend authorization by the reserved body.',
          impacts: { financial: 'None identified (synthetic)', operational: 'None identified', schedule: 'None identified' },
          amount: null,
          risks: 'None identified',
          dependencies: 'None identified',
          latestSafeDate: riyadh(30),
          requiredAuthority: 'Board of Directors — to be confirmed',
          evidenceNoneReason: 'Synthetic E2E paper: no supporting documents exist',
        });
        const m = await sec.post<{ id: string; version: number }>(`${base}/committees/${committeeId}/meetings`, { title: `E2E AT-04 meeting ${RUN}`, scheduledAt: riyadhNow() });
        const req = await pm.post<{ id: string; version: number }>(`${base}/agenda-requests`, { committeeId, title: `Decision ${d.code}`, kind: 'decision', decisionId: d.id, meetingId: m.id });
        await sec.post(`${base}/agenda-requests/${req.id}/screen`, { expectedVersion: req.version, outcome: 'accept', meetingId: m.id });
        let v = (await pm.post<{ version: number }>(`${base}/decisions/${d.id}/submit`, { expectedVersion: (await sec.get<{ version: number }>(`${base}/decisions/${d.id}`)).version })).version;
        v = (await sec.post<{ version: number }>(`${base}/decisions/${d.id}/start-review`, { expectedVersion: v })).version;
        let mv = (await sec.post<{ version: number }>(`${base}/meetings/${m.id}/publish-agenda`, { expectedVersion: m.version })).version;
        mv = (await sec.post<{ version: number }>(`${base}/meetings/${m.id}/packs`, { expectedVersion: mv })).version;
        mv = (await sec.post<{ version: number }>(`${base}/meetings/${m.id}/start`, { expectedVersion: mv })).version;
        const detail = await sec.get<{ memberships: { id: string; displayName: string | null; activeToday: boolean }[] }>(`${base}/committees/${committeeId}`);
        const present = [P.chair, P.sponsor, P.finance, P.legal, P.secretary, P.approver] as string[];
        await sec.post(`${base}/meetings/${m.id}/attendance`, { entries: detail.memberships.filter((s) => s.activeToday && s.displayName && present.includes(s.displayName)).map((s) => ({ membershipId: s.id, status: 'present' })) });
        await sec.post(`${base}/meetings/${m.id}/quorum-check`, { expectedVersion: mv });
        return { id: d.id, code: d.code };
      }),
    );
    for (const persona of [P.chair, P.sponsor, P.finance, P.legal, P.approver]) {
      await withClient(baseURL!, persona, async (voter) => {
        const { version } = await voter.get<{ version: number }>(`${base}/decisions/${decision.id}`);
        await voter.post(`${base}/decisions/${decision.id}/votes`, { expectedVersion: version, choice: 'approve', conflictDeclaration: 'no_conflict' });
      });
    }

    const s = await asPersona(browser, baseURL!, P.secretary);
    const page = s.page;
    try {
      // From the Committee Hub: the "under review" tile → the filtered register → the decision.
      await page.goto(`/projects/${dc}/committee`);
      await page.locator('[data-testid="metric-card"][data-metric="underReview"]').click();
      await expect(page.getByTestId('decisions-table')).toContainText(title);
      await page.getByTestId('decisions-table').getByRole('link', { name: title }).click();
      await page.waitForURL(new RegExp(`/committee/decisions/${decision.id}$`));
      await expect(page.locator('[data-testid="voting-state"]')).toHaveAttribute('data-complete', 'true');
      await page.locator('[data-command="recordOutcome"]').click();
      await confirm(page, 'Record outcome');
      await expect(page.getByTestId('decision-status')).toContainText('Recommended');
      await expect(page.getByTestId('decision-status')).not.toContainText('Approved');
      const callout = page.getByTestId('recommended-callout');
      await expect(callout).toContainText('Recommended — pending external authority');
      await expect(callout).toContainText('Board of Directors — to be confirmed must decide');
      await expect(page.getByText('Pending external authority').first()).toBeVisible();
      await page.screenshot({ path: join(SHOTS, 'at04-recommended-en.png'), fullPage: true });
      // Its escalation (system-generated, decision requested from the reserved body).
      await callout.getByRole('link').click();
      const esc = page.getByTestId('escalations-table');
      expect(await tableTotal(esc)).toBe(1);
      await expect(esc).toContainText('Decision requested');
      await expect(esc).toContainText('Board of Directors — to be confirmed');
      // Back on the hub: counted under "Recommended — pending external authority" and among the escalations awaiting a decision.
      await page.goto(`/projects/${dc}/committee`);
      await page.locator('[data-testid="metric-card"][data-metric="recommended"]').click();
      await expect(page.getByTestId('decisions-table')).toContainText(title);
      expect(s.problems(), s.problems().join('\n')).toEqual([]);
    } finally {
      await s.close();
    }
    await withClient(baseURL!, P.pm, async (pm) => {
      const d = await pm.get<{ status: string; authorityOutcome: string; escalatedTo: string }>(`${base}/decisions/${decision.id}`);
      expect(d).toMatchObject({ status: 'recommended', authorityOutcome: 'pending_external_authority', escalatedTo: 'Board of Directors — to be confirmed' });
    });
  });

  test('(f) REQ-UX-008 the Gantt renders the critical path and the baseline variance', async ({ browser, baseURL }) => {
    test.setTimeout(180_000);
    type Node = { id: string; type: string; code: string; earlyFinish: string | null; plannedFinish: string | null; baselineFinish: string | null; critical: boolean | null };
    type Schedule = { status: string; criticalPath: { id: string; code: string }[] | null; nodes: Node[] };
    const days = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
    const variances = (s: Schedule) => s.nodes.filter((n) => n.earlyFinish && n.baselineFinish).map((n) => ({ code: n.code, days: days(n.earlyFinish!, n.baselineFinish!) }));
    // A target whose driving network is complete (critical path computable) and partly baselined: WS02-A08 in the seed.
    const pick = await withClient(baseURL!, P.pm, async (pm) => {
      const whole = await pm.get<Schedule>(`/api/v1/projects/${dc}/schedule`);
      const candidates = whole.nodes.filter((n) => n.type === 'milestone').sort((a, b) => (a.code === 'WS02-A08' ? -1 : b.code === 'WS02-A08' ? 1 : 0));
      for (const c of candidates) {
        const s = await pm.get<Schedule>(`/api/v1/projects/${dc}/schedule?targetNodeId=${c.id}`);
        if (s.status === 'complete' && (s.criticalPath?.length ?? 0) > 1 && variances(s).length > 0) return { target: c, schedule: s };
      }
      return null;
    });
    expect(pick, 'a complete, baselined driving network exists in the demo plan').not.toBeNull();
    let schedule = pick!.schedule;
    if (!variances(schedule).some((v) => v.days !== 0)) {
      // Fixture only when the plan matches its baseline exactly: lengthen the first critical task by 2 working days.
      await withClient(baseURL!, P.pm, async (pm) => {
        const first = schedule.criticalPath!.find((n) => schedule.nodes.find((x) => x.id === n.id)?.type === 'task')!;
        const t = await pm.get<{ version: number; durationDays: number }>(`/api/v1/projects/${dc}/tasks/${first.id}`);
        await pm.patch(`/api/v1/projects/${dc}/tasks/${first.id}`, { expectedVersion: t.version, durationDays: t.durationDays + 2 });
        schedule = await pm.get<Schedule>(`/api/v1/projects/${dc}/schedule?targetNodeId=${pick!.target.id}`);
      });
    }
    const expectedVariance = variances(schedule);
    expect(expectedVariance.some((v) => v.days !== 0), 'a baseline variance to show').toBe(true);

    const s = await asPersona(browser, baseURL!, P.pm);
    const page = s.page;
    try {
      await page.goto(`/projects/${dc}/plan?tab=timeline`);
      await page.getByTestId('timeline-target').selectOption(pick!.target.id);
      await expect(page.getByTestId('schedule-status')).toHaveAttribute('data-status', 'complete');
      // Critical path: listed in order and drawn in the Gantt.
      const path = page.getByTestId('critical-path').locator('li');
      await expect(path).toHaveCount(schedule.criticalPath!.length);
      for (const [i, n] of schedule.criticalPath!.entries()) await expect(path.nth(i)).toContainText(n.code);
      for (const n of schedule.nodes.filter((x) => x.critical && x.earlyFinish)) {
        await expect(page.locator(`[data-testid="gantt-row"][data-code="${n.code}"]`)).toHaveAttribute('data-critical', 'true');
        await expect(page.locator(`[data-testid="gantt"] [data-node="${n.id}"]`)).toHaveAttribute('data-critical', 'true');
      }
      // Baseline variance: per row, finish shown minus the baseline finish (calendar days); visible badge when not zero.
      for (const v of expectedVariance) {
        const row = page.locator(`[data-testid="gantt-row"][data-code="${v.code}"]`);
        await expect(row).toHaveAttribute('data-baseline-variance', String(v.days));
        if (v.days > 0) await expect(row.getByTestId('gantt-variance')).toContainText(`+${v.days} d`);
        if (v.days < 0) await expect(row.getByTestId('gantt-variance')).toContainText(`−${-v.days} d`);
        if (v.days === 0) await expect(row.getByTestId('gantt-variance')).toHaveCount(0);
      }
      await expect(page.getByTestId('gantt')).toContainText('Variance against the baseline finish (calendar days)');
      await page.screenshot({ path: join(SHOTS, 'gantt-critical-variance-en.png'), fullPage: true });
      expect(s.problems(), s.problems().join('\n')).toEqual([]);
    } finally {
      await s.close();
    }
  });

  test('(g) REQ-UX-009 a workstream lead submits a status update from the workstream workspace', async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    const summary = `E2E WS07 weekly update ${RUN}: cutover rehearsal preparation on track (synthetic)`;
    const s = await asPersona(browser, baseURL!, P.opsLead);
    const page = s.page;
    try {
      await page.goto(`/projects/${dc}/workstreams/${ws.get('WS07')}?tab=updates`);
      await expect(page.getByRole('tab', { name: 'Updates' })).toHaveAttribute('aria-selected', 'true');
      await page.getByTestId('update-create').click();
      const form = page.getByTestId('update-form');
      await form.getByLabel(/^Summary/).fill(summary);
      await form.getByLabel(/^Reported status/).selectOption('amber');
      await page.getByTestId('update-form-submit').click();
      await expect(form).toBeHidden();
      const row = page.getByTestId('updates-table').getByRole('row').filter({ hasText: summary });
      await expect(row).toBeVisible();
      await expect(row.locator('[data-status="draft"]')).toBeVisible();
      await row.getByRole('link').first().click();
      await page.waitForURL(/\/plan\/updates\/[0-9a-f-]{36}$/);
      const updateId = page.url().split('/').pop()!;
      await page.locator('[data-command="submit"]').click();
      await confirm(page, 'Submit for review');
      await expect(page.locator('main header [data-status]').first()).toHaveAttribute('data-status', 'submitted');
      await page.screenshot({ path: join(SHOTS, 'workspace-update-submitted-en.png'), fullPage: true });
      // The workspace lists it as submitted, by the lead.
      await page.goto(`/projects/${dc}/workstreams/${ws.get('WS07')}?tab=updates`);
      await expect(page.getByTestId('updates-table').getByRole('row').filter({ hasText: summary }).locator('[data-status="submitted"]')).toBeVisible();
      await expect(page.getByTestId('updates-table').getByRole('row').filter({ hasText: summary })).toContainText(P.opsLead);
      expect(s.problems(), s.problems().join('\n')).toEqual([]);
      await withClient(baseURL!, P.pm, async (pm) => {
        const u = await pm.get<{ status: string; submittedByName: string; workstreamCode: string }>(`/api/v1/projects/${dc}/status-updates/${updateId}`);
        expect(u).toMatchObject({ status: 'submitted', submittedByName: P.opsLead, workstreamCode: 'WS07' });
      });
    } finally {
      await s.close();
    }
  });

  test('(h) REQ-UX-015 a change request raised from a risk stays linked to it', async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    const riskTitle = `E2E vendor capacity risk ${RUN} (synthetic)`;
    const risk = await withClient(baseURL!, P.pm, async (pm) => {
      const r = await pm.post<{ id: string }>(`/api/v1/projects/${dc}/raid/risks`, { workstreamId: ws.get('WS01'), title: riskTitle, probability: 4, impact: 3 });
      return pm.get<{ id: string; code: string }>(`/api/v1/projects/${dc}/raid/risks/${r.id}`);
    });
    const s = await asPersona(browser, baseURL!, P.pm);
    const page = s.page;
    try {
      await page.goto(`/projects/${dc}/raid/risks/${risk.id}`);
      await expect(page.getByTestId('risk-change-requests')).toHaveAttribute('data-state', 'empty');
      await page.getByTestId('risk-raise-cr').click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByTestId('cr-form-source')).toContainText(`raised from risk ${risk.code}`);
      await expect(dialog.getByLabel(/^Title/)).toHaveValue(`Change for risk ${risk.code}: ${riskTitle}`);
      await checkDialogA11y(page, dialog, 'raise-cr-from-risk');
      await dialog.getByLabel(/^Rationale/).fill('Synthetic E2E rationale: add a second vendor to remove the capacity risk.');
      await page.getByTestId('cr-form-submit').click();
      await expect(dialog).toBeHidden();
      await page.waitForURL(/\/raid\/changes\/[0-9a-f-]{36}$/);
      const crId = page.url().split('/').pop()!;
      await expect(page.locator('main header [data-status]').first()).toHaveAttribute('data-status', 'draft');
      const subject = page.getByTestId('cr-subject-link');
      await expect(subject).toHaveAttribute('data-subject-type', 'risk');
      await subject.click();
      await page.waitForURL(new RegExp(`/raid/risks/${risk.id}$`));
      const crs = page.getByTestId('risk-change-requests');
      expect(await tableTotal(crs)).toBe(1);
      await crs.getByTestId('risk-change-request-link').click();
      await page.waitForURL(new RegExp(`/raid/changes/${crId}$`));
      await page.screenshot({ path: join(SHOTS, 'cr-from-risk-en.png'), fullPage: true });
      expect(s.problems(), s.problems().join('\n')).toEqual([]);
      await withClient(baseURL!, P.pm, async (pm) => {
        const cr = await pm.get<{ subjectType: string; subjectId: string; status: string }>(`/api/v1/projects/${dc}/change-requests/${crId}`);
        expect(cr).toMatchObject({ subjectType: 'risk', subjectId: risk.id, status: 'draft' });
      });
    } finally {
      await s.close();
    }
  });

  test('(i) REQ-UX-022 each P2 screen renders its loading, empty, error and restricted states (restricted reveals no title or count)', async ({ browser, baseURL }) => {
    test.setTimeout(480_000);
    interface Screen {
      name: string;
      path: string;
      /** The screen's own list request. */
      api: RegExp;
      /** Where the states render. */
      scope: (page: Page) => Locator;
      /** Shown once the data arrived. */
      ready: (page: Page) => Locator;
      empty: (page: Page) => Locator;
      error: (page: Page) => Locator;
      restricted: (page: Page) => Locator;
      /** A title the restricted state must not reveal. */
      secret?: string;
      emptyBody?: (json: Record<string, unknown>) => Record<string, unknown>;
    }
    const ws01 = ws.get('WS01')!;
    const emptyPaged = (j: Record<string, unknown>) => ({ ...j, items: [], total: 0 });
    const testId = (id: string) => (page: Page) => page.getByTestId(id);
    const inScope = (scope: string, id: string) => (page: Page) => page.getByTestId(scope).getByTestId(id);
    const screens: Screen[] = [
      {
        name: 'cockpit',
        path: `/projects/${dc}`,
        api: /\/api\/v1\/projects\/[^/]+\/decisions\?/,
        scope: testId('top-decisions-tile'),
        ready: inScope('top-decisions-tile', 'top-decisions'),
        empty: inScope('top-decisions-tile', 'top-decisions-empty'),
        error: inScope('top-decisions-tile', 'tile-error'),
        restricted: inScope('top-decisions-tile', 'tile-restricted'),
      },
      {
        name: 'overview-charter',
        path: `/projects/${dc}/charter`,
        api: /\/api\/v1\/projects\/[^/]+\/committees\?/,
        scope: testId('overview-committees'),
        ready: inScope('overview-committees', 'overview-committees-table'),
        empty: inScope('overview-committees', 'overview-committees-none'),
        error: inScope('overview-committees', 'error-state'),
        restricted: inScope('overview-committees', 'overview-committees-restricted'),
        secret: STEERING,
      },
      {
        name: 'committee-hub',
        path: `/projects/${dc}/committee`,
        api: /\/api\/v1\/projects\/[^/]+\/committees\?/,
        scope: testId('committees-table'),
        ready: (p) => p.locator('[data-testid="committees-table"][data-state="ready"]'),
        empty: inScope('committees-table', 'empty-state'),
        error: inScope('committees-table', 'error-state'),
        restricted: inScope('committees-table', 'restricted-state'),
        secret: STEERING,
      },
      {
        name: 'integrated-plan-wbs',
        path: `/projects/${dc}/plan?tab=wbs`,
        api: /\/api\/v1\/projects\/[^/]+\/tasks\?/,
        scope: testId('wbs-tab'),
        ready: testId('wbs-table'),
        empty: inScope('wbs-tab', 'empty-state'),
        error: inScope('wbs-tab', 'error-state'),
        restricted: inScope('wbs-tab', 'restricted-state'),
        secret: 'Draft program charter',
      },
      {
        name: 'integrated-plan-kanban',
        path: `/projects/${dc}/plan?tab=kanban`,
        api: /\/api\/v1\/projects\/[^/]+\/tasks\?/,
        scope: testId('kanban-tab'),
        ready: testId('kanban-board'),
        empty: inScope('kanban-tab', 'empty-state'),
        error: inScope('kanban-tab', 'error-state'),
        restricted: inScope('kanban-tab', 'restricted-state'),
        secret: 'Draft program charter',
      },
      {
        name: 'workstream-workspace',
        path: `/projects/${dc}/workstreams/${ws01}?tab=tasks`,
        api: /\/api\/v1\/projects\/[^/]+\/tasks\?/,
        scope: testId('ws-tasks-table'),
        ready: (p) => p.locator('[data-testid="ws-tasks-table"][data-state="ready"]'),
        empty: inScope('ws-tasks-table', 'empty-state'),
        error: inScope('ws-tasks-table', 'error-state'),
        restricted: inScope('ws-tasks-table', 'restricted-state'),
        secret: 'Draft program charter',
      },
      {
        name: 'raid-change-control',
        path: `/projects/${dc}/raid?tab=risks`,
        api: /\/api\/v1\/projects\/[^/]+\/raid\/risks\?/,
        scope: testId('raid-table-risks'),
        ready: (p) => p.locator('[data-testid="raid-table-risks"][data-state="ready"]'),
        empty: inScope('raid-table-risks', 'empty-state'),
        error: inScope('raid-table-risks', 'error-state'),
        restricted: inScope('raid-table-risks', 'restricted-state'),
      },
      {
        name: 'documents-evidence',
        path: `/projects/${dc}/documents`,
        api: /\/api\/v1\/projects\/[^/]+\/documents\?/,
        scope: testId('documents-table'),
        ready: (p) => p.locator('[data-testid="documents-table"][data-state="ready"]'),
        empty: inScope('documents-table', 'empty-state'),
        error: inScope('documents-table', 'error-state'),
        restricted: inScope('documents-table', 'restricted-state'),
      },
      {
        name: 'my-work-inbox',
        path: '/inbox',
        api: /\/api\/v1\/me\/work(\?|$)/,
        scope: (p) => p.locator('main'),
        ready: testId('inbox'),
        empty: inScope('inbox-table', 'empty-state'),
        error: (p) => p.locator('main').getByTestId('error-state'),
        restricted: (p) => p.locator('main').getByTestId('restricted-state'),
        emptyBody: (j) => ({ ...j, items: [], counts: Object.fromEntries(Object.keys((j.counts as Record<string, number>) ?? {}).map((k) => [k, 0])) }),
      },
      {
        name: 'setup-wizard-step5',
        path: `/projects/${dc}/setup?step=committee`,
        api: /\/api\/v1\/projects\/[^/]+\/committees\?/,
        scope: (p) => p.locator('main'),
        ready: testId('wizard-step-committee'),
        empty: (p) => p.locator('main').getByTestId('empty-state'),
        error: (p) => p.locator('main').getByTestId('error-state'),
        restricted: (p) => p.locator('main').getByTestId('restricted-state'),
        secret: STEERING,
      },
    ];

    const s = await asPersona(browser, baseURL!, P.pm);
    const page = s.page;
    try {
      for (const sc of screens) {
        // Loading: the list answer is held back until the loading state has been seen.
        let release!: () => void;
        const held = new Promise<void>((r) => (release = r));
        const hold = async (route: Route) => {
          await held;
          await route.continue();
        };
        await page.route(sc.api, hold);
        await page.goto(sc.path);
        await expect(sc.scope(page).getByTestId('loading-state').first(), `${sc.name}: loading`).toBeVisible();
        release();
        await expect(sc.ready(page), `${sc.name}: ready`).toBeVisible({ timeout: 30_000 });
        await page.unroute(sc.api, hold);

        // Empty: the same answer with no rows.
        const empty = async (route: Route) => {
          const res = await route.fetch();
          const json = (await res.json()) as Record<string, unknown>;
          await route.fulfill({ response: res, json: (sc.emptyBody ?? emptyPaged)(json) });
        };
        await page.route(sc.api, empty);
        await page.goto(sc.path);
        await expect(sc.empty(page).first(), `${sc.name}: empty`).toBeVisible({ timeout: 30_000 });
        await page.unroute(sc.api, empty);

        // Error: a failing list → an error with "Try again", never zeros; retrying recovers.
        let fail = true;
        const error = async (route: Route) => (fail ? route.fulfill(problem(500, 'Internal Server Error')) : route.continue());
        await page.route(sc.api, error);
        await page.goto(sc.path);
        await expect(sc.error(page).first(), `${sc.name}: error`).toBeVisible({ timeout: 30_000 });
        fail = false;
        await sc.error(page).first().getByRole('button', { name: 'Try again' }).click();
        await expect(sc.ready(page), `${sc.name}: recovered`).toBeVisible({ timeout: 30_000 });
        await page.unroute(sc.api, error);

        // Restricted: the API answers 404 (not visible to the caller) → the restricted state, with no title or count.
        const hidden = async (route: Route) => route.fulfill(problem(404, 'Not Found'));
        await page.route(sc.api, hidden);
        await page.goto(sc.path);
        await expect(sc.restricted(page).first(), `${sc.name}: restricted`).toBeVisible({ timeout: 30_000 });
        if (sc.secret) await expect(sc.scope(page)).not.toContainText(sc.secret);
        await expect(sc.scope(page).locator('[data-total]')).toHaveCount(0);
        await page.screenshot({ path: join(SHOTS, `states-restricted-${sc.name}.png`) });
        await page.unroute(sc.api, hidden);
      }
      expect(s.problems(), s.problems().join('\n')).toEqual([]);
    } finally {
      await s.close();
    }

    // Restricted for real: a Project-B user opening the DEMO-DC screens gets the neutral restricted state (the API answers
    // 404) and none of the project's names.
    const b = await asPersona(browser, baseURL!, P.pmB);
    try {
      for (const sc of screens.filter((x) => x.path.startsWith(`/projects/${dc}`))) {
        await b.page.goto(sc.path);
        await expect(b.page.getByTestId('restricted-state').first(), `${sc.name}: outsider`).toBeVisible({ timeout: 30_000 });
        await expect(b.page.locator('main')).not.toContainText('Demo DC Carve-out');
        if (sc.secret) await expect(b.page.locator('main')).not.toContainText(sc.secret);
      }
      expect(b.problems(), b.problems().join('\n')).toEqual([]);
    } finally {
      await b.close();
    }
  });

  test('(j) REQ-UX-023 an edit shows in the record history with its actor and reason (the reason for audit readers)', async ({ browser, baseURL }) => {
    test.setTimeout(180_000);
    const reason = `E2E reassignment reason ${RUN}: the contributor takes it over (synthetic)`;
    const task = await withClient(baseURL!, P.pm, (pm) => pm.post<{ id: string }>(`/api/v1/projects/${dc}/tasks`, { workstreamId: ws.get('WS01'), title: `E2E history task ${RUN} (synthetic)` }));
    const s = await asPersona(browser, baseURL!, P.pm);
    try {
      const page = s.page;
      // The PM sets the task's accountable owner with a reason.
      await page.goto(`/projects/${dc}/plan/tasks/${task.id}`);
      await page.getByTestId('task-owner').click();
      const form = page.getByTestId('owner-form');
      await form.getByRole('combobox').fill('Demo Contributor');
      await page.getByRole('option', { name: /^Demo Contributor/ }).first().click();
      await form.getByLabel(/^Reason/).fill(reason);
      await page.getByTestId('owner-form-submit').click();
      await expect(form).toBeHidden();
      // The editor's own view of the history: who did what. Free-text reasons are shown to audit readers only (the API
      // returns them only with audit.event.read — they may carry sensitive detail).
      const history = page.getByTestId('activity-history');
      await history.locator('summary').click();
      await expect(history.locator('li').filter({ hasText: 'Accountable owner set' })).toContainText(P.pm);
      await expect(history).not.toContainText(reason);
      expect(s.problems(), s.problems().join('\n')).toEqual([]);
    } finally {
      await s.close();
    }
    // The Auditor (the AT's user) sees the edit with its actor and its reason.
    const auditor = await asPersona(browser, baseURL!, 'Demo Auditor');
    try {
      await auditor.page.goto(`/projects/${dc}/plan/tasks/${task.id}`);
      const history = auditor.page.getByTestId('activity-history');
      await history.locator('summary').click();
      const entry = history.locator('li').filter({ hasText: reason });
      await expect(entry).toBeVisible();
      await expect(entry).toContainText(P.pm);
      await expect(entry).toContainText('Accountable owner set');
      await expect(entry).toContainText(`Reason: ${reason}`);
      await auditor.page.screenshot({ path: join(SHOTS, 'history-task-owner-auditor-en.png'), fullPage: true });
      expect(auditor.problems(), auditor.problems().join('\n')).toEqual([]);
    } finally {
      await auditor.close();
    }

    // A committee charter amendment (a descriptive edit saved as a new version) with its reason, in the committee history.
    const charterReason = `E2E charter amendment ${RUN}: clarify the board's purpose (synthetic)`;
    const sec = await asPersona(browser, baseURL!, P.secretary);
    let boardUrl = '';
    try {
      await sec.page.goto(`/projects/${dc}/committee`);
      await sec.page.getByTestId('committees-table').getByRole('link', { name: 'NewCo Board (Demo)' }).click();
      await sec.page.waitForURL(/\/committee\/committees\/[0-9a-f-]{36}$/);
      boardUrl = new URL(sec.page.url()).pathname;
      await sec.page.getByRole('button', { name: 'Amend charter' }).click();
      const dialog = sec.page.getByRole('dialog');
      await dialog.getByLabel(/^Purpose/).fill(`Synthetic purpose of the NewCo board (E2E ${RUN})`);
      await dialog.getByLabel(/^Reason/).fill(charterReason);
      await confirm(sec.page, 'Save version');
      expect(sec.problems(), sec.problems().join('\n')).toEqual([]);
    } finally {
      await sec.close();
    }
    const aud2 = await asPersona(browser, baseURL!, 'Demo Auditor');
    try {
      await aud2.page.goto(boardUrl);
      const history = aud2.page.getByTestId('gov-history');
      await history.locator('summary').click();
      const entry = history.locator('li').filter({ hasText: charterReason });
      await expect(entry).toBeVisible();
      await expect(entry).toContainText(P.secretary);
      await expect(entry).toContainText(`Reason: ${charterReason}`);
      expect(aud2.problems(), aud2.problems().join('\n')).toEqual([]);
    } finally {
      await aud2.close();
    }
  });
});
