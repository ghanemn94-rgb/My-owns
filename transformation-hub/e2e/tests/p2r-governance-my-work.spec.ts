import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { apiSessionAs, loginAs, setSavedLocale, watchConsole } from './helpers';

/**
 * P2 residuals in the UI (against the running API, no mocks):
 *  - REQ-UX-018 + REQ-GOV-012: an agenda request appears in the secretariat's My Work as "Agenda request to screen" (en and
 *    ar), never in the requester's; its link opens the request register where the secretariat rejects it with a reason;
 *    the item then leaves My Work.
 *  - REQ-GOV-009: from the Committee Hub the secretariat proposes a meeting series from the charter cadence; the meetings
 *    are listed as Proposed (never Planned) until confirmed.
 * All data is synthetic.
 */
const P = { pm: 'Demo Project Manager', secretary: 'Demo Secretary / CPMO', sponsor: 'Demo Sponsor' } as const;
const STEERING = 'DC Carve-out & JV Steering Committee (Demo)';
const RUN = Date.now().toString(36);

async function csrfOf(ctx: APIRequestContext): Promise<string> {
  return (await ctx.storageState()).cookies.find((c) => c.name === 'hub_csrf')?.value ?? '';
}
async function post<T>(ctx: APIRequestContext, path: string, data: unknown): Promise<T> {
  const res = await ctx.post(path, { data, headers: { 'x-csrf-token': await csrfOf(ctx) } });
  expect(res.ok(), `POST ${path} → HTTP ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T;
}
async function dcProjectId(ctx: APIRequestContext): Promise<string> {
  const list = await (await ctx.get('/api/v1/projects')).json();
  return (list.items as { id: string; code: string }[]).find((p) => p.code === 'DEMO-DC')!.id;
}
async function asPersona(browser: Browser, persona: string): Promise<{ page: Page; problems: () => string[]; close: () => Promise<void> }> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const problems = watchConsole(page);
  await loginAs(page, persona);
  return { page, problems, close: () => ctx.close() };
}

test.describe('P2 residuals — My Work agenda screening and proposed meeting series (REQ-UX-018, REQ-GOV-012, REQ-GOV-009)', () => {
  test('an agenda request is offered in the secretariat My Work (en + ar), not to the requester; screened out with a reason from its link', async ({ browser, baseURL }) => {
    test.setTimeout(180_000);
    const pmApi = await apiSessionAs(baseURL!, P.pm);
    const pid = await dcProjectId(pmApi);
    const committees = (await (await pmApi.get(`/api/v1/projects/${pid}/committees`)).json()).items as { id: string; name: string }[];
    const committeeId = committees.find((c) => c.name === STEERING)!.id;
    const title = `E2E request to screen ${RUN}`;
    const req = await post<{ id: string }>(pmApi, `/api/v1/projects/${pid}/agenda-requests`, { committeeId, title, kind: 'discussion' });
    await pmApi.dispose();

    const sec = await asPersona(browser, P.secretary);
    const pm = await asPersona(browser, P.pm);
    try {
      // The requester's My Work does not offer it (the screening command would refuse the requester).
      await pm.page.goto('/inbox');
      await expect(pm.page.getByTestId('inbox')).toBeVisible();
      await expect(pm.page.getByTestId('inbox-link').filter({ hasText: title })).toHaveCount(0);

      // The secretariat's My Work offers it under its own type.
      await sec.page.goto('/inbox');
      const chip = sec.page.getByTestId('inbox-chip-agenda_screening');
      await expect(chip).toContainText('Agenda request to screen');
      await chip.click();
      const link = sec.page.getByTestId('inbox-link').filter({ hasText: title });
      await expect(link).toHaveCount(1);

      // Arabic rendering of the same item type.
      await setSavedLocale(sec.page, 'ar');
      try {
        await sec.page.reload();
        await expect(sec.page.getByTestId('inbox-chip-agenda_screening')).toContainText('طلب إدراج للفحص');
        await expect(sec.page.locator('html')).toHaveAttribute('dir', 'rtl');
      } finally {
        await setSavedLocale(sec.page, 'en');
      }
      await sec.page.reload();

      // Its link opens the request register filtered on it; the secretariat rejects it with a reason.
      await sec.page.getByTestId('inbox-chip-agenda_screening').click();
      await sec.page.getByTestId('inbox-link').filter({ hasText: title }).click();
      await sec.page.waitForURL(/\/committee\/meetings\?aStatus=requested/);
      const row = sec.page.getByTestId('agenda-table').getByRole('row').filter({ hasText: title });
      await expect(row).toHaveCount(1);
      await row.getByRole('button', { name: `Screen request: ${title}` }).click();
      const dialog = sec.page.getByRole('dialog');
      await dialog.getByTestId('screen-outcome').selectOption('reject');
      await expect(dialog).toContainText('A reason is required to return, defer, merge or reject a request.');
      const confirm = dialog.getByRole('button', { name: 'Record screening', exact: true });
      await dialog.getByLabel(/^Reason/).fill('Outside the committee remit (e2e, synthetic)');
      await confirm.click();
      await expect(dialog).toBeHidden();

      // Rejected in the register; gone from My Work.
      await sec.page.goto(`/projects/${pid}/committee/meetings?aStatus=rejected&aq=${encodeURIComponent(title)}`);
      await expect(sec.page.getByTestId('agenda-table').getByRole('row').filter({ hasText: title })).toContainText('Rejected');
      await sec.page.goto('/inbox');
      await expect(sec.page.getByTestId('inbox')).toBeVisible();
      await expect(sec.page.getByTestId('inbox-link').filter({ hasText: title })).toHaveCount(0);
      expect(req.id).toBeTruthy();
      expect([...sec.problems(), ...pm.problems()]).toEqual([]);
    } finally {
      await sec.close();
      await pm.close();
    }
  });

  test('the secretariat proposes a meeting series from the charter cadence in the Committee Hub; the meetings are Proposed', async ({ browser, baseURL }) => {
    test.setTimeout(180_000);
    // A synthetic committee whose charter carries a weekly cadence rule (created, approved and activated through the API).
    const secApi = await apiSessionAs(baseURL!, P.secretary);
    const sponsorApi = await apiSessionAs(baseURL!, P.sponsor);
    const pid = await dcProjectId(secApi);
    const name = `E2E weekly committee ${RUN}`;
    const c = await post<{ id: string; version: number }>(secApi, `/api/v1/projects/${pid}/committees`, {
      kind: 'program_steering',
      name,
      charter: { purpose: 'E2E synthetic committee', cadence: 'Weekly follow-up (proposed, synthetic)', cadenceRule: { frequency: 'weekly' } },
    });
    const ap = await post<{ version: number }>(sponsorApi, `/api/v1/projects/${pid}/committees/${c.id}/charter/approve`, { expectedVersion: c.version, approvalReference: 'E2E (synthetic)' });
    await post(secApi, `/api/v1/projects/${pid}/committees/${c.id}/activate`, { expectedVersion: ap.version });
    await secApi.dispose();
    await sponsorApi.dispose();

    const sec = await asPersona(browser, P.secretary);
    try {
      await sec.page.goto(`/projects/${pid}/committee/committees/${c.id}`);
      await expect(sec.page.getByTestId('charter-cadence-rule-value')).toContainText('Weekly');
      await sec.page.getByTestId('propose-meetings').click();
      const dialog = sec.page.getByRole('dialog');
      await expect(dialog).toContainText('Creates Proposed meetings only');
      await dialog.getByTestId('propose-first').fill('2027-05-02T10:00');
      await dialog.getByTestId('propose-count').fill('3');
      await dialog.getByTestId('propose-title').fill(`E2E weekly follow-up ${RUN}`);
      await dialog.getByRole('button', { name: 'Propose meetings', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(sec.page.getByText('3 meeting(s) proposed; 0 date(s) already had a meeting.')).toBeVisible();

      const rows = sec.page.getByRole('table', { name: 'Meetings and circulations' }).getByRole('row').filter({ hasText: `E2E weekly follow-up ${RUN}` });
      await expect(rows).toHaveCount(3);
      for (const r of await rows.all()) await expect(r).toContainText('Proposed');

      // A proposed meeting shows the proposal note and only the confirm / cancel commands.
      await rows.first().getByRole('link').first().click();
      await expect(sec.page.getByTestId('meeting-proposed-note')).toBeVisible();
      await expect(sec.page.getByTestId('meeting-status')).toContainText('Proposed');
      await expect(sec.page.locator('[data-command="confirm"]')).toBeVisible();
      await expect(sec.page.locator('[data-command="publish"]')).toHaveCount(0);
      expect(sec.problems()).toEqual([]);
    } finally {
      await sec.close();
    }
  });
});
