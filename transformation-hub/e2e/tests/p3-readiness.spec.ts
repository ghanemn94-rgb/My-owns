import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { apiSessionAs, loginAs, setSavedLocale, watchConsole } from './helpers';

/**
 * P3 Day-1 & TSA Center (spec §10 screen 9; AT-09, AT-10) against the real API and demo seed.
 * Fixtures (a site, a complete cutover plan, governance decisions voted through the DEMO committee, an approved TSA) are
 * prepared through the APIs as the real demo personas; every behaviour under test is driven through the UI:
 *  - AT-09: a failed connectivity test blocks GO (the server refuses it), the contingency and the decision history show.
 *  - AT-10: a TSA past its end date is not an exit; a replacement failure escalates; the extension waits for an approved
 *    decision; the exit needs accepted replacement evidence and an independent approver.
 * Re-runnable: every fixture is new (timestamped). The automatic expiry job (worker) is covered by the API AT-10 test.
 */
const SHOTS = join(__dirname, '..', 'screenshots', 'p3');
mkdirSync(SHOTS, { recursive: true });

const P = {
  pm: 'Demo Project Manager',
  sponsor: 'Demo Sponsor',
  chair: 'Demo Committee Chair',
  secretary: 'Demo Secretary / CPMO',
  approver: 'Demo Functional Approver',
} as const;
const STAMP = Date.now().toString(36);

async function csrfOf(ctx: APIRequestContext): Promise<string> {
  return (await ctx.storageState()).cookies.find((c) => c.name === 'hub_csrf')?.value ?? '';
}
async function post(ctx: APIRequestContext, path: string, data: unknown, method: 'post' | 'patch' = 'post') {
  const res = await ctx[method](path, { data, headers: { 'x-csrf-token': await csrfOf(ctx) } });
  expect(res.ok(), `${method.toUpperCase()} ${path} → HTTP ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}
async function get(ctx: APIRequestContext, path: string) {
  const res = await ctx.get(path);
  expect(res.ok(), `GET ${path} → HTTP ${res.status()}`).toBeTruthy();
  return res.json();
}
function isoDate(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/**
 * A governance decision of the given type, tabled at a fresh DEMO committee meeting and voted through the governance
 * API (DEMO authority matrix). `vote: false` leaves it drafted (linkable, never a final approval).
 */
async function governanceDecision(baseURL: string, pid: string, decisionTypeKey: string, vote = true): Promise<string> {
  const base = `/api/v1/projects/${pid}`;
  const pm = await apiSessionAs(baseURL, P.pm);
  const sec = await apiSessionAs(baseURL, P.secretary);
  try {
    const committees = (await get(sec, `${base}/committees?pageSize=100`)).items as { id: string; kind: string; status: string }[];
    const committee = committees.find((c) => c.kind === 'program_steering' && c.status === 'active');
    if (!committee) throw new Error('No active DEMO steering committee in the demo seed');
    const paper = {
      committeeId: committee.id,
      title: `E2E ${decisionTypeKey} decision ${STAMP} (synthetic)`,
      decisionTypeKey,
      issue: 'Synthetic e2e issue',
      whyNow: 'Needed for the synthetic e2e scenario',
      alternatives: [{ title: 'Proceed' }, { title: 'Do not proceed' }],
      recommendation: 'Proceed',
      impacts: { financial: 'Synthetic', operational: 'Synthetic', schedule: 'Synthetic' },
      amount: { amount: '100000.0000', currency: 'SAR', unitScale: 1 },
      risks: 'None identified (synthetic)',
      dependencies: 'None identified (synthetic)',
      latestSafeDate: isoDate(30),
      requiredAuthority: 'Per the DEMO authority matrix (synthetic)',
      evidenceNoneReason: 'Synthetic e2e paper: no supporting documents exist',
    };
    const d = await post(pm, `${base}/decisions`, paper);
    if (!vote) return d.id;
    const detail = await get(sec, `${base}/committees/${committee.id}`);
    const members = (detail.memberships as { id: string; userId: string | null; voting: boolean; activeToday: boolean }[]).filter((m) => m.userId && m.activeToday);
    const m = await post(sec, `${base}/committees/${committee.id}/meetings`, { title: `E2E readiness meeting ${STAMP} (synthetic)`, scheduledAt: new Date().toISOString() });
    const req = await post(pm, `${base}/agenda-requests`, { committeeId: committee.id, title: 'Readiness status (information)', kind: 'information', meetingId: m.id });
    await post(sec, `${base}/agenda-requests/${req.id}/screen`, { expectedVersion: req.version, outcome: 'accept', meetingId: m.id });
    let mv = (await post(sec, `${base}/meetings/${m.id}/publish-agenda`, { expectedVersion: m.version })).version;
    mv = (await post(sec, `${base}/meetings/${m.id}/start`, { expectedVersion: mv })).version;
    await post(sec, `${base}/meetings/${m.id}/attendance`, { entries: members.map((x) => ({ membershipId: x.id, status: 'present' })) });
    const s = await post(pm, `${base}/decisions/${d.id}/submit`, { expectedVersion: d.version });
    const r = await post(sec, `${base}/decisions/${d.id}/start-review`, { expectedVersion: s.version, meetingId: m.id });
    const users = (await get(sec, '/api/v1/auth/demo-users')).items as { id: string; displayName: string }[];
    for (const member of members.filter((x) => x.voting)) {
      const persona = users.find((u) => u.id === member.userId)?.displayName;
      if (!persona) continue;
      const voter = await apiSessionAs(baseURL, persona);
      const v = (await get(voter, `${base}/decisions/${d.id}`)).version;
      await post(voter, `${base}/decisions/${d.id}/votes`, { expectedVersion: v, choice: 'approve', conflictDeclaration: 'no_conflict' });
      await voter.dispose();
    }
    const out = await post(sec, `${base}/decisions/${d.id}/record-outcome`, { expectedVersion: (await get(sec, `${base}/decisions/${d.id}`)).version });
    expect(out.status, `decision ${decisionTypeKey} outcome`).toBe('approved');
    void r;
    return d.id;
  } finally {
    await pm.dispose();
    await sec.dispose();
  }
}

async function asPersona(browser: Browser, persona: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const problems = watchConsole(page);
  await loginAs(page, persona);
  return { page, problems, close: () => context.close() };
}

function dialog(page: Page) {
  return page.getByRole('dialog');
}

/** Full-page screenshot without transient toasts covering the content. */
async function shot(page: Page, file: string) {
  const toastButtons = page.getByRole('status').getByRole('button');
  while ((await toastButtons.count()) > 0) await toastButtons.first().click();
  await page.screenshot({ path: join(SHOTS, file), fullPage: true });
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe('P3 Day-1 & TSA Center', () => {
  let pid: string;
  let userIds: Record<string, string>;

  test.beforeAll(async ({ baseURL }) => {
    const pm = await apiSessionAs(baseURL!, P.pm);
    const list = await get(pm, '/api/v1/projects');
    pid = (list.items as { id: string; code: string }[]).find((p) => p.code === 'DEMO-DC')!.id;
    const users = (await get(pm, '/api/v1/auth/demo-users')).items as { id: string; displayName: string }[];
    userIds = Object.fromEntries(users.map((u) => [u.displayName, u.id]));
    await pm.dispose();
  });

  test('AT-09: a failed connectivity test blocks GO; contingency and decision history are shown', async ({ browser, baseURL }) => {
    test.setTimeout(240_000);
    const base = `/api/v1/projects/${pid}`;
    const goDecision = await governanceDecision(baseURL!, pid, 'day1_go_no_go');
    // Fixture: a site transition plan with every §7.4 element documented and the approved go/no-go decision linked.
    const api = await apiSessionAs(baseURL!, P.pm);
    const site = await post(api, `${base}/sites`, { name: `E2E site ${STAMP} (synthetic)` });
    const plan = await post(api, `${base}/cutover-plans`, {
      title: `E2E site transition ${STAMP} (synthetic)`,
      siteId: site.id,
      accountableUserId: userIds[P.pm],
      runbookSummary: 'Runbook v1 (synthetic)',
      windowStart: `${isoDate(20)}T20:00:00Z`,
      windowEnd: `${isoDate(21)}T02:00:00Z`,
      serviceImpact: 'No customer impact expected (synthetic assessment)',
      contingencyPlan: 'Contingency runbook: keep the current NOC in service (synthetic)',
      rollbackPlan: 'Rollback: revert routing within 30 minutes (synthetic)',
    });
    let v = (await post(api, `${base}/cutover-plans/${plan.id}/rehearsal`, { expectedVersion: plan.version, testingSummary: 'Rehearsal executed (synthetic)' })).version;
    v = (await post(api, `${base}/cutover-plans/${plan.id}/communications-approval`, { expectedVersion: v, approvalReference: 'COMMS-E2E (synthetic)' })).version;
    await post(api, `${base}/cutover-plans/${plan.id}/go-decision`, { expectedVersion: v, decisionId: goDecision });
    for (const [area, title] of [
      ['physical_access', `Physical access rights tested ${STAMP} (synthetic)`],
      ['incident_management', `Incident-response process tested ${STAMP} (synthetic)`],
    ]) {
      await post(api, `${base}/readiness-checks`, { area, title, mandatory: true, blocker: true, signoffRole: 'functional_approver', cutoverPlanId: plan.id, siteId: site.id, failureContingency: 'Contingency: current operator covers (synthetic)' });
    }
    await api.dispose();

    const pm = await asPersona(browser, P.pm);
    const sponsor = await asPersona(browser, P.sponsor);
    try {
      const { page } = pm;
      // Navigate like a user: project → Day-1 & TSA Center → Cutover tab → plan.
      await page.goto(`/projects/${pid}`);
      await page.getByTestId('project-nav').getByRole('link', { name: 'Day-1 & TSA Center' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Day-1 & TSA Center' })).toBeVisible();
      await expect(page.getByTestId('no-device-control')).toContainText('never controls devices');
      await expect(page.getByTestId('readiness-summary')).toBeVisible();
      await shot(page, 'readiness-en-overview.png');

      // The connectivity check is created through the UI, bound to the plan, with its contingency.
      await page.getByTestId('readiness-tabs').getByRole('link', { name: 'Readiness checks' }).click();
      await page.getByTestId('create-check').click();
      const dlg = dialog(page);
      await dlg.getByTestId('check-area').selectOption('connectivity');
      await dlg.getByTestId('check-title').fill(`Connectivity to customers and NOC tested ${STAMP} (synthetic)`);
      await dlg.getByTestId('check-blocker').check();
      await dlg.getByTestId('check-plan').selectOption(plan.id);
      await dlg.getByTestId('check-contingency').fill('Contingency: keep traffic on the current carrier path; rollback step 3 (synthetic)');
      await dlg.getByRole('button', { name: 'Create check', exact: true }).click();
      await expect(dlg).toBeHidden();
      await page.getByLabel('Search code or title').fill(`Connectivity to customers and NOC tested ${STAMP}`);
      const checkRows = page.getByTestId('checks-table').getByRole('row');
      await expect(checkRows).toHaveCount(2);
      await checkRows.filter({ hasText: `Connectivity to customers and NOC tested ${STAMP}` }).getByRole('link').first().click();
      await expect(page.getByTestId('check-detail')).toHaveAttribute('data-status', 'not_started');

      // A failed test sets the check failed and stays in the append-only history.
      await page.getByTestId('cmd-test').click();
      await dialog(page).getByTestId('test-result').selectOption('failed');
      await dialog(page).getByRole('textbox').fill('Carrier path B down during the end-to-end test (synthetic)');
      await dialog(page).getByRole('button', { name: 'Record test', exact: true }).click();
      await expect(page.getByTestId('check-detail')).toHaveAttribute('data-status', 'failed');
      await expect(page.getByTestId('test-runs').getByRole('row')).toHaveCount(2);
      await expect(page.getByTestId('check-contingency')).toContainText('keep traffic on the current carrier path');

      // Submit the plan for go/no-go (the PM will not be offered the decision).
      await page.goto(`/projects/${pid}/readiness/cutover/${plan.id}`);
      await expect(page.getByTestId('prerequisites').locator('[data-ok="false"]')).toHaveCount(0);
      await expect(page.getByTestId('go-evaluation')).toHaveAttribute('data-allowed', 'false');
      await page.getByTestId('cmd-submit').click();
      await dialog(page).getByRole('button', { name: 'Submit', exact: true }).click();
      await expect(page.getByTestId('plan-detail')).toHaveAttribute('data-status', 'ready_for_decision');
      await expect(page.getByTestId('cmd-decide')).toHaveCount(0);

      // The sponsor attempts GO: the server refuses it; the refusal lands in the decision history.
      const sp = sponsor.page;
      await sp.goto(`/projects/${pid}/readiness/cutover/${plan.id}`);
      const blockers = sp.getByTestId('go-blockers');
      await expect(blockers).toContainText(`Connectivity to customers and NOC tested ${STAMP}`);
      await expect(blockers.locator('[data-status="failed"]')).toHaveCount(1);
      await sp.getByTestId('cmd-decide').click();
      await dialog(sp).getByTestId('decide-outcome').selectOption('go');
      await dialog(sp).getByLabel('Rationale').fill('Attempted GO for the synthetic site (e2e)');
      await dialog(sp).getByRole('button', { name: 'Record decision', exact: true }).click();
      await expect(dialog(sp).getByRole('alert')).toContainText('A GO decision is blocked by open readiness blockers');
      await dialog(sp).getByRole('button', { name: 'Cancel' }).click();
      await expect(sp.getByTestId('plan-detail')).toHaveAttribute('data-status', 'ready_for_decision');
      const refused = sp.locator('[data-testid="history-entry"][data-kind="go_blocked"]');
      await expect(refused).toHaveCount(1);
      await expect(refused).toContainText('GO refused by the server');
      await expect(refused).toContainText(`Connectivity to customers and NOC tested ${STAMP}`);
      await expect(sp.getByTestId('plan-checks')).toContainText('keep traffic on the current carrier path');
      await expect(sp.getByTestId('go-decision')).toContainText('Final approval');
      await sp.getByTestId('go-evaluation').scrollIntoViewIfNeeded();
      await shot(sp, 'readiness-en-go-blocked.png');

      // NO-GO is recorded with its rationale.
      await sp.getByTestId('cmd-decide').click();
      await dialog(sp).getByTestId('decide-outcome').selectOption('no_go');
      await dialog(sp).getByLabel('Rationale').fill('Connectivity blocker failed; re-test after carrier remediation (e2e)');
      await dialog(sp).getByRole('button', { name: 'Record decision', exact: true }).click();
      await expect(sp.getByTestId('plan-detail')).toHaveAttribute('data-status', 'no_go');
      await expect(sp.locator('[data-testid="history-entry"][data-kind="no_go"]')).toContainText('Connectivity blocker failed');

      // Arabic (RTL), desktop and 390 px.
      try {
        await setSavedLocale(sp, 'ar');
        await sp.reload();
        await expect(sp.locator('html')).toHaveAttribute('dir', 'rtl');
        await expect(sp.getByTestId('readiness-tabs').getByRole('link', { name: 'الانتقال وقرار المضي' })).toBeVisible();
        await expect(sp.locator('[data-testid="history-entry"][data-kind="go_blocked"]')).toContainText('رفض الخادم قرار المضي');
        await shot(sp, 'readiness-ar-go-blocked.png');
        await sp.setViewportSize({ width: 390, height: 844 });
        await sp.reload();
        await expect(sp.getByTestId('decision-history')).toBeVisible();
        await shot(sp, 'readiness-ar-390-go-blocked.png');
        await noHorizontalOverflow(sp);
      } finally {
        await setSavedLocale(sp, 'en');
      }
      expect(pm.problems(), pm.problems().join('\n')).toEqual([]);
      expect(sponsor.problems(), sponsor.problems().join('\n')).toEqual([]);
    } finally {
      await pm.close();
      await sponsor.close();
    }
  });

  test('AT-10: end date is not an exit; failure escalates; extension waits for an approved decision; exit needs evidence and an independent approver', async ({ browser, baseURL }) => {
    test.setTimeout(240_000);
    const base = `/api/v1/projects/${pid}`;
    const tsaDecision = await governanceDecision(baseURL!, pid, 'tsa_approval_or_extension');
    const draftDecision = await governanceDecision(baseURL!, pid, 'tsa_approval_or_extension', false);
    // Fixture: an approved, active TSA whose end date passed 5 days ago; the functional approver is its owner.
    const api = await apiSessionAs(baseURL!, P.pm);
    const name = `E2E NOC monitoring service ${STAMP} (synthetic)`;
    const created = await post(api, `${base}/tsa-services`, {
      name,
      scope: 'Out-of-hours NOC monitoring (synthetic)',
      startDate: isoDate(-60),
      endDate: isoDate(-5),
      ownerUserId: userIds[P.approver],
      replacementService: 'NewCo NOC monitoring (synthetic)',
      exitMilestones: [{ title: 'Replacement monitoring accepted with evidence (synthetic)' }],
    });
    let v = (await post(api, `${base}/tsa-services/${created.id}/transition`, { expectedVersion: created.version, command: 'start_negotiation' })).version;
    v = (await post(api, `${base}/tsa-services/${created.id}/approve`, { expectedVersion: v, decisionId: tsaDecision })).version;
    await post(api, `${base}/tsa-services/${created.id}/transition`, { expectedVersion: v, command: 'activate' });
    await api.dispose();

    const pm = await asPersona(browser, P.pm);
    const approver = await asPersona(browser, P.approver);
    const sponsor = await asPersona(browser, P.sponsor);
    try {
      const { page } = pm;
      await page.goto(`/projects/${pid}/readiness/tsa`);
      await page.getByLabel('Search code or name').fill(name);
      await expect(page.getByTestId('tsa-table').getByRole('row')).toHaveCount(2);
      const row = page.getByTestId('tsa-table').getByRole('row').filter({ hasText: name });
      await expect(row).toContainText('Ended 5 day(s) ago — unresolved');
      await row.getByRole('link').first().click();
      const detail = page.getByTestId('tsa-detail');
      await expect(detail).toHaveAttribute('data-status', 'active');
      await expect(page.getByTestId('end-not-exit')).toContainText('Reaching the end date is not an exit');
      await expect(page.getByTestId('tsa-exit')).toContainText('No exit approval requested');

      // Replacement failure → escalation (decision requested) with continuity / extension options; nothing extended.
      await page.getByTestId('cmd-failure').click();
      await dialog(page).getByTestId('failure-summary').fill('NewCo NOC tooling failed acceptance (synthetic)');
      await dialog(page).getByTestId('failure-continuity').fill('Keep the current operator NOC; weekly review (synthetic)');
      await dialog(page).getByTestId('failure-deadline').fill(isoDate(7));
      await dialog(page).getByRole('button', { name: 'Report failure', exact: true }).click();
      await expect(dialog(page)).toBeHidden();
      const esc = page.getByTestId('tsa-escalation');
      await expect(esc.locator('[data-status="decision_requested"]')).toHaveCount(1);
      await expect(esc).toContainText('Extend the TSA');
      await expect(esc).toContainText('within its delegated authority');
      await expect(detail).toHaveAttribute('data-status', 'active');
      await shot(page, 'readiness-en-tsa-escalated.png');

      // The extension is linked to a decision that is only drafted → recording it is refused (never automatic).
      await page.getByTestId('cmd-requestExtension').click();
      await dialog(page).getByTestId('decision-select').selectOption(draftDecision);
      await dialog(page).getByTestId('extension-end').fill(isoDate(90));
      await dialog(page).getByRole('button', { name: 'Link decision', exact: true }).click();
      await expect(page.getByTestId('extension-decision')).toContainText('only an approved decision counts');
      await page.getByTestId('cmd-recordExtension').click();
      await dialog(page).getByRole('button', { name: 'Record extension', exact: true }).click();
      await expect(dialog(page).getByRole('alert')).toContainText('requires an approved decision');
      await dialog(page).getByRole('button', { name: 'Cancel' }).click();
      await expect(detail).toHaveAttribute('data-status', 'active');

      // With the approved decision the extension is recorded.
      await page.getByTestId('cmd-requestExtension').click();
      await dialog(page).getByTestId('decision-select').selectOption(tsaDecision);
      await dialog(page).getByTestId('extension-end').fill(isoDate(90));
      await dialog(page).getByRole('button', { name: 'Link decision', exact: true }).click();
      await expect(page.getByTestId('extension-decision')).toContainText('Final approval');
      await page.getByTestId('cmd-recordExtension').click();
      await dialog(page).getByRole('button', { name: 'Record extension', exact: true }).click();
      await expect(detail).toHaveAttribute('data-status', 'extended');

      // Exit: acceptance evidence → replacement accepted → exit started → exit approval requested.
      await page.getByTestId('evidence-add').click();
      await dialog(page).getByRole('radio', { name: 'Note' }).check();
      await dialog(page).getByLabel('Evidence note').fill('Replacement acceptance test report (synthetic)');
      await dialog(page).getByRole('button', { name: 'Link evidence', exact: true }).click();
      await expect(dialog(page)).toBeHidden();
      await page.getByTestId('cmd-acceptReplacement').click();
      await dialog(page).getByLabel('Reason').fill('Replacement NOC accepted after parallel run (synthetic)');
      await dialog(page).getByRole('button', { name: 'Accept replacement', exact: true }).click();
      await expect(page.getByTestId('replacement-state')).toContainText('Accepted');
      await page.getByTestId('cmd-transition').click();
      await dialog(page).getByTestId('tsa-command').selectOption('start_exit');
      await dialog(page).getByRole('button', { name: 'Apply', exact: true }).click();
      await expect(detail).toHaveAttribute('data-status', 'exit_in_progress');
      await page.getByTestId('cmd-requestExit').click();
      await dialog(page).getByRole('button', { name: 'Request approval', exact: true }).click();
      await expect(page.getByTestId('tsa-exit').locator('[data-status="pending"]')).toHaveCount(1);

      // The TSA owner (a functional approver) is not offered the exit approval; the sponsor approves it.
      await approver.page.goto(`/projects/${pid}/readiness/tsa/${created.id}`);
      await expect(approver.page.getByTestId('tsa-detail')).toHaveAttribute('data-status', 'exit_in_progress');
      await expect(approver.page.getByTestId('cmd-approveExit')).toHaveCount(0);
      const sp = sponsor.page;
      await sp.goto(`/projects/${pid}/readiness/tsa/${created.id}`);
      await sp.getByTestId('cmd-approveExit').click();
      await dialog(sp).getByRole('button', { name: 'Approve exit', exact: true }).click();
      await expect(sp.getByTestId('tsa-detail')).toHaveAttribute('data-status', 'exit_accepted');
      await expect(sp.getByTestId('exit-approved')).toBeVisible();
      await shot(sp, 'readiness-en-tsa-exit.png');

      // Arabic (RTL), desktop and 390 px.
      try {
        await setSavedLocale(sp, 'ar');
        await sp.goto(`/projects/${pid}/readiness/tsa`);
        await expect(sp.locator('html')).toHaveAttribute('dir', 'rtl');
        await expect(sp.getByRole('heading', { level: 1, name: 'سجل الخدمات الانتقالية' })).toBeVisible();
        await shot(sp, 'readiness-ar-tsa-register.png');
        await sp.goto(`/projects/${pid}/readiness/tsa/${created.id}`);
        await expect(sp.getByTestId('end-not-exit')).toContainText('بلوغ تاريخ الانتهاء ليس خروجاً');
        await shot(sp, 'readiness-ar-tsa.png');
        await sp.setViewportSize({ width: 390, height: 844 });
        await sp.reload();
        await expect(sp.getByTestId('tsa-escalation')).toBeVisible();
        await shot(sp, 'readiness-ar-390-tsa.png');
        await noHorizontalOverflow(sp);
      } finally {
        await setSavedLocale(sp, 'en');
      }
      await sp.goto(`/projects/${pid}/readiness/checks`);
      await expect(sp.getByTestId('checks-table')).toBeVisible();
      await shot(sp, 'readiness-en-390-checks.png');
      await noHorizontalOverflow(sp);
      expect(pm.problems(), pm.problems().join('\n')).toEqual([]);
      expect(approver.problems(), approver.problems().join('\n')).toEqual([]);
      expect(sponsor.problems(), sponsor.problems().join('\n')).toEqual([]);
    } finally {
      await pm.close();
      await approver.close();
      await sponsor.close();
    }
  });
});
