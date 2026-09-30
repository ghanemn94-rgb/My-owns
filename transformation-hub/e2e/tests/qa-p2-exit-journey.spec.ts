import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { apiSessionAs, loginAs, watchConsole } from './helpers';
import { checkArabic, watchBilingual } from './qa-rtl-detector';

/**
 * Independent QA — P2 gate review (docs/reviews/P2-qa-review.md §3): the P2 exit criterion "decision request → authorized
 * approval → action → closure evidence" (REQ-PHS-004, REQ-GOV-018, REQ-GOV-020, AT-30 governance part) driven through the UI
 * past the point the existing p2-governance spec stops (approved, implementation pending):
 *   PM adds an owned, dated action and starts implementation tracking → the owner (Demo Contributor) reports it done with
 *   closure evidence → the secretariat (not the owner or reporter) verifies the closure → the sponsor (neither the person who
 *   started tracking nor an action owner) verifies the implementation with evidence → Implemented — verified.
 * Separation of duties is checked where the UI shows it (the owner is not offered "Verify closure"). The fixture decision
 * (a 100,000 SAR change budget within the DEMO committee limit, tabled, voted and recorded) is prepared through the API with
 * the demo personas; the approval step itself is covered in the UI by p2-governance.spec.ts. All data is synthetic.
 */
const SHOTS = join(__dirname, '..', 'screenshots', 'qa-p2');
mkdirSync(SHOTS, { recursive: true });
const RUN = Date.now().toString(36);
const P = {
  pm: 'Demo Project Manager',
  secretary: 'Demo Secretary / CPMO',
  chair: 'Demo Committee Chair',
  sponsor: 'Demo Sponsor',
  finance: 'Demo Finance Member',
  legal: 'Demo Legal Member',
  approver: 'Demo Functional Approver',
  contributor: 'Demo Contributor',
} as const;
const STEERING = 'DC Carve-out & JV Steering Committee (Demo)';

async function client(baseURL: string, persona: string) {
  const ctx: APIRequestContext = await apiSessionAs(baseURL, persona);
  const csrf = (await ctx.storageState()).cookies.find((c) => c.name === 'hub_csrf')?.value ?? '';
  return {
    get: async <T = Record<string, unknown>>(path: string): Promise<T> => {
      const r = await ctx.get(path);
      expect(r.ok(), `GET ${path} → ${r.status()} ${await r.text()}`).toBeTruthy();
      return r.json();
    },
    post: async <T = Record<string, unknown>>(path: string, data: unknown): Promise<T> => {
      const r = await ctx.post(path, { data, headers: { 'x-csrf-token': csrf } });
      expect(r.ok(), `POST ${path} (${persona}) → ${r.status()} ${await r.text()}`).toBeTruthy();
      return r.json();
    },
    dispose: () => ctx.dispose(),
  };
}

function riyadh(offsetDays = 0, withTime = true): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return withTime ? `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00+03:00` : `${parts.year}-${parts.month}-${parts.day}`;
}

/** Fixture (API): a change-budget decision within the DEMO limit, tabled at a new meeting in session, voted and approved. */
async function approvedDecision(baseURL: string): Promise<{ dc: string; id: string; code: string }> {
  const pm = await client(baseURL, P.pm);
  const sec = await client(baseURL, P.secretary);
  try {
    const dc = (await pm.get<{ items: { id: string; code: string }[] }>('/api/v1/projects?pageSize=100')).items.find((p) => p.code === 'DEMO-DC')!.id;
    const base = `/api/v1/projects/${dc}`;
    const committeeId = (await sec.get<{ items: { id: string; name: string }[] }>(`${base}/committees`)).items.find((c) => c.name === STEERING)!.id;
    const d = await pm.post<{ id: string; code: string }>(`${base}/decisions`, {
      committeeId,
      title: `QA exit journey — rehearsal tooling within the delegated limit ${RUN} (synthetic)`,
      decisionTypeKey: 'change_request_budget',
      issue: 'Synthetic QA issue: rehearsal tooling within the delegated change budget.',
      whyNow: 'Synthetic: needed before the rehearsal window.',
      alternatives: [{ title: 'Approve the budget' }, { title: 'Descope the tooling' }],
      recommendation: 'Approve within the committee mandate.',
      impacts: { financial: '100,000 SAR (synthetic)', operational: 'None identified', schedule: 'None identified' },
      amount: { amount: '100000', currency: 'SAR', unitScale: 1 },
      risks: 'None identified',
      dependencies: 'None identified',
      latestSafeDate: riyadh(60, false),
      requiredAuthority: 'Steering committee (DEMO matrix)',
      evidenceNoneReason: 'Synthetic QA paper: no supporting documents exist',
    });
    const m = await sec.post<{ id: string; version: number }>(`${base}/committees/${committeeId}/meetings`, { title: `QA exit journey meeting ${RUN}`, scheduledAt: riyadh() });
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
    // Every present voting member votes (DOM-P2R-01), declaring "no conflict" for the item (REQ-GOV-015).
    for (const persona of [P.chair, P.sponsor, P.finance, P.legal, P.approver]) {
      const voter = await client(baseURL, persona);
      await voter.post(`${base}/decisions/${d.id}/votes`, { expectedVersion: (await voter.get<{ version: number }>(`${base}/decisions/${d.id}`)).version, choice: 'approve', conflictDeclaration: 'no_conflict' });
      await voter.dispose();
    }
    const chair = await client(baseURL, P.chair);
    const out = await chair.post<{ status: string }>(`${base}/decisions/${d.id}/record-outcome`, { expectedVersion: (await chair.get<{ version: number }>(`${base}/decisions/${d.id}`)).version });
    await chair.dispose();
    expect(out.status, 'the fixture decision is approved within the committee mandate').toBe('approved');
    expect(v).toBeGreaterThan(0);
    return { dc, id: d.id, code: d.code };
  } finally {
    await pm.dispose();
    await sec.dispose();
  }
}

async function asPersona(browser: Browser, persona: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const problems = watchConsole(page);
  await loginAs(page, persona);
  return { page, problems, close: () => ctx.close() };
}

async function confirm(page: Page, name: string) {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name, exact: true }).click();
  await expect(dialog).toBeHidden();
}

test.describe('QA P2 — exit journey in the UI: approved decision → action → verified closure → implementation verified [REQ-PHS-004, REQ-GOV-018, REQ-GOV-020]', () => {
  test('owned, dated action; the owner reports done with evidence; the secretariat verifies closure; the sponsor verifies implementation', async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(300_000);
    const d = await approvedDecision(baseURL!);
    const decisionUrl = `/projects/${d.dc}/committee/decisions/${d.id}`;
    const actionsUrl = `/projects/${d.dc}/committee/actions?decisionId=${d.id}`;
    const actionTitle = `QA exit journey action ${RUN} (synthetic)`;
    const pm = await asPersona(browser, P.pm);
    const contributor = await asPersona(browser, P.contributor);
    const sec = await asPersona(browser, P.secretary);
    const sponsor = await asPersona(browser, P.sponsor);
    try {
      // --- Approved is not implemented (REQ-GOV-020).
      await pm.page.goto(decisionUrl);
      await expect(pm.page.getByTestId('decision-status')).toContainText('Approved');
      await expect(pm.page.getByTestId('decision-lifecycle')).toContainText('Implementation pending');
      // Tracking needs an owned, dated action: if the command is offered before any action exists, the server refuses it.
      const startCmd = pm.page.locator('[data-command="startImplementation"]');
      if (await startCmd.count()) {
        await startCmd.click();
        const dialog = pm.page.getByRole('dialog');
        await dialog.getByRole('button', { name: 'Start implementation', exact: true }).click();
        await expect(dialog.getByRole('alert').or(dialog.getByTestId('refusal-explanation')).first()).toBeVisible();
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        await expect(pm.page.getByTestId('decision-status')).toContainText('Approved');
      }

      // --- The PM adds an action with one accountable owner and a due date.
      await pm.page.getByTestId('add-action').click();
      let dialog = pm.page.getByRole('dialog');
      await dialog.getByLabel(/^Action/).fill(actionTitle);
      await dialog.getByRole('combobox', { name: /^Owner/ }).fill('Demo Contributor');
      await pm.page.getByRole('option', { name: /Demo Contributor/ }).first().click();
      await dialog.getByLabel(/^Due date/).fill(riyadh(14, false));
      await confirm(pm.page, 'Create action');
      const actionRow = pm.page.getByRole('row').filter({ hasText: actionTitle });
      await expect(actionRow).toContainText('Demo Contributor');
      await expect(actionRow).toContainText('Open');

      // --- The PM starts implementation tracking.
      await pm.page.locator('[data-command="startImplementation"]').click();
      await confirm(pm.page, 'Start implementation');
      await expect(pm.page.getByTestId('decision-status')).toContainText('Implementation pending');

      // --- The owner reports the action done with closure evidence; the owner is not offered "Verify closure".
      await contributor.page.goto(actionsUrl);
      const cRow = contributor.page.getByRole('row').filter({ hasText: actionTitle });
      await cRow.locator('[data-command="reportDone"]').click();
      dialog = contributor.page.getByRole('dialog');
      await dialog.getByLabel(/^Closure evidence/).fill('Synthetic QA evidence: tooling licences issued (test record).');
      await confirm(contributor.page, 'Report done');
      await expect(cRow).toContainText('Done — pending verification');
      await expect(cRow.locator('[data-command="verify"]')).toHaveCount(0);

      // --- The secretariat (not the owner or reporter) verifies the closure.
      await sec.page.goto(actionsUrl);
      const sRow = sec.page.getByRole('row').filter({ hasText: actionTitle });
      await sRow.locator('[data-command="verify"]').click();
      await confirm(sec.page, 'Verify closure');
      await expect(sRow).toContainText('Verified and closed');

      // --- The sponsor verifies the implementation with evidence → Implemented — verified.
      await sponsor.page.goto(decisionUrl);
      await sponsor.page.locator('[data-command="verifyImplementation"]').click();
      dialog = sponsor.page.getByRole('dialog');
      await dialog.getByLabel(/^Evidence of implementation/).fill('Synthetic QA evidence: the tooling is in use for the rehearsal (test record).');
      await confirm(sponsor.page, 'Verify implementation');
      await expect(sponsor.page.getByTestId('decision-status')).toContainText('Implemented — verified');
      await expect(sponsor.page.getByTestId('gov-history')).toBeVisible();
      await sponsor.page.screenshot({ path: join(SHOTS, 'en-p2-exit-journey-implemented-verified.png'), fullPage: true });

      // --- The same decision and its actions in Arabic (RTL), no untranslated UI or bilingual server strings.
      const bilingual = watchBilingual(sec.page);
      await sec.page.context().addCookies([{ name: 'hub_locale', value: 'ar', url: baseURL! }]);
      await sec.page.goto(decisionUrl);
      await expect(sec.page.getByTestId('decision-status')).toContainText('منفَّذ — تم التحقق');
      await checkArabic(sec.page, testInfo, SHOTS, 'p2-exit-journey-decision', bilingual);
      await sec.page.goto(actionsUrl);
      await expect(sec.page.getByRole('row').filter({ hasText: actionTitle })).toBeVisible();
      await checkArabic(sec.page, testInfo, SHOTS, 'p2-exit-journey-actions', bilingual);

      for (const who of [pm, contributor, sec, sponsor]) expect(who.problems(), who.problems().join('\n')).toEqual([]);
    } finally {
      await pm.close();
      await contributor.close();
      await sec.close();
      await sponsor.close();
    }
  });
});
