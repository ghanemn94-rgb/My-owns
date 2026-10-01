import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PERSONAS, apiSessionAs, loginAs, watchConsole } from './helpers';
import { checkArabic, checkDialogA11y, watchBilingual } from './qa-rtl-detector';

/**
 * Independent QA — P3 + P4 review (docs/reviews/P3-P4-qa-review.md §4): critical user journeys through the UI that the
 * delivered e2e specs do not drive end to end.
 *  J1 (P3, AT-10): a TSA past its end date without an accepted replacement — the WORKER's daily expiry scan (made due now on
 *     this review's own e2e database) marks it expired-unresolved and escalates; the UI shows the escalation and that the end
 *     date is not an exit; no exit is offered and the bypass is refused.
 *  J2 (P3, AT-09): failed physical-access AND incident-response tests (not only connectivity) block GO; the sponsor's GO is
 *     refused naming both; NO-GO is recorded; the plan shows the contingency runbook, the rollback and the decision history.
 *  J3 (P4, REQ-JV-010): a DD question raised by the counterparty in its room → assigned, drafted, submitted (PM) → reviewed
 *     (Legal) → still invisible to the partner → released (Sponsor) → the answer appears in the partner's room.
 *  J4 (P4, AT-29): figures in units and in thousands (same currency) — the total is refused with the reason; an explicit
 *     normalization shows the disclosed basis (English and Arabic).
 *  J5 (P3, AT-07 / REQ-UX-010 "add perimeter item and see reconciliation update"): an item added after the baseline through
 *     the UI is held pending with a change request and appears in the reconciliation tab with its open issues.
 * Arabic screens and dialogs on the way are checked with the shared detector (qa-rtl-detector.ts) and axe.
 * Fixtures are synthetic and prepared through the APIs as the real demo personas; J1 additionally needs
 * QA_P34_DB_OWNER_URL (owner URL of the e2e database) to make the per-project expiry schedule due — skipped without it.
 * Requirement IDs: REQ-TSA-003, REQ-TSA-004, REQ-TSA-006, REQ-RDY-004, REQ-JV-010, REQ-JV-009, REQ-DAT-004, REQ-UX-012,
 * REQ-UX-013, REQ-UX-014.
 */
const SHOTS = join(__dirname, '..', 'screenshots', 'qa-p34');
mkdirSync(SHOTS, { recursive: true });
const STAMP = Date.now().toString(36).toUpperCase().slice(-6);
const P = {
  pm: PERSONAS.pm,
  sponsor: PERSONAS.sponsor,
  secretary: PERSONAS.secretary,
  legal: 'Demo Legal Member',
  finance: PERSONAS.finance,
  partner: PERSONAS.partnerAlpha,
  admin: PERSONAS.portfolioAdmin,
} as const;

async function csrfOf(ctx: APIRequestContext) {
  return (await ctx.storageState()).cookies.find((c) => c.name === 'hub_csrf')?.value ?? '';
}
async function post(ctx: APIRequestContext, path: string, data: unknown) {
  const r = await ctx.post(path, { data, headers: { 'x-csrf-token': await csrfOf(ctx) } });
  expect(r.ok(), `POST ${path} → ${r.status()} ${await r.text()}`).toBeTruthy();
  return r.json();
}
async function postRaw(ctx: APIRequestContext, path: string, data: unknown) {
  const r = await ctx.post(path, { data, headers: { 'x-csrf-token': await csrfOf(ctx) } });
  return { status: r.status(), body: await r.json().catch(() => ({})) };
}
async function get(ctx: APIRequestContext, path: string) {
  const r = await ctx.get(path);
  expect(r.ok(), `GET ${path} → ${r.status()}`).toBeTruthy();
  return r.json();
}
function isoDate(offsetDays: number) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date(Date.now() + offsetDays * 86_400_000));
}
async function asPersona(browser: Browser, baseURL: string, persona: string, locale: 'en' | 'ar' = 'en') {
  const context = await browser.newContext();
  const page = await context.newPage();
  const problems = watchConsole(page);
  await loginAs(page, persona);
  await context.addCookies([{ name: 'hub_locale', value: locale, url: baseURL }]);
  return { page, problems, close: () => context.close() };
}
const dialog = (page: Page) => page.locator('dialog[open]');
async function shot(page: Page, file: string) {
  const toastButtons = page.getByRole('status').getByRole('button');
  while ((await toastButtons.count()) > 0) await toastButtons.first().click();
  await page.screenshot({ path: join(SHOTS, file), fullPage: true });
}

/** A governance decision of the given type voted through the DEMO steering committee (as p3-readiness.spec.ts does). */
async function governanceDecision(baseURL: string, pid: string, decisionTypeKey: string): Promise<string> {
  const base = `/api/v1/projects/${pid}`;
  const pm = await apiSessionAs(baseURL, P.pm);
  const sec = await apiSessionAs(baseURL, P.secretary);
  try {
    const committees = (await get(sec, `${base}/committees?pageSize=100`)).items as { id: string; kind: string; status: string }[];
    const committee = committees.find((c) => c.kind === 'program_steering' && c.status === 'active')!;
    const d = await post(pm, `${base}/decisions`, {
      committeeId: committee.id,
      title: `QA P34 ${decisionTypeKey} decision ${STAMP} (synthetic)`,
      decisionTypeKey,
      issue: 'Synthetic QA issue',
      whyNow: 'Needed for the synthetic QA journey',
      alternatives: [{ title: 'Proceed' }, { title: 'Do not proceed' }],
      recommendation: 'Proceed',
      impacts: { financial: 'Synthetic', operational: 'Synthetic', schedule: 'Synthetic' },
      amount: { amount: '100000.0000', currency: 'SAR', unitScale: 1 },
      risks: 'None identified (synthetic)',
      dependencies: 'None identified (synthetic)',
      latestSafeDate: isoDate(30),
      requiredAuthority: 'Per the DEMO authority matrix (synthetic)',
      evidenceNoneReason: 'Synthetic QA paper: no supporting documents exist',
    });
    const detail = await get(sec, `${base}/committees/${committee.id}`);
    const members = (detail.memberships as { id: string; userId: string | null; voting: boolean; activeToday: boolean }[]).filter((m) => m.userId && m.activeToday);
    const m = await post(sec, `${base}/committees/${committee.id}/meetings`, { title: `QA P34 meeting ${STAMP} ${decisionTypeKey} (synthetic)`, scheduledAt: new Date().toISOString() });
    const req = await post(pm, `${base}/agenda-requests`, { committeeId: committee.id, title: 'QA status (information)', kind: 'information', meetingId: m.id });
    await post(sec, `${base}/agenda-requests/${req.id}/screen`, { expectedVersion: req.version, outcome: 'accept', meetingId: m.id });
    let mv = (await post(sec, `${base}/meetings/${m.id}/publish-agenda`, { expectedVersion: m.version })).version;
    mv = (await post(sec, `${base}/meetings/${m.id}/start`, { expectedVersion: mv })).version;
    await post(sec, `${base}/meetings/${m.id}/attendance`, { entries: members.map((x) => ({ membershipId: x.id, status: 'present' })) });
    const s = await post(pm, `${base}/decisions/${d.id}/submit`, { expectedVersion: d.version });
    await post(sec, `${base}/decisions/${d.id}/start-review`, { expectedVersion: s.version, meetingId: m.id });
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
    expect(out.status).toBe('approved');
    return d.id;
  } finally {
    await pm.dispose();
    await sec.dispose();
  }
}

test.describe('QA P3/P4 — critical journeys through the UI [AT-09, AT-10, AT-29, REQ-TSA-003, REQ-TSA-006, REQ-RDY-004, REQ-JV-010, REQ-DAT-004]', () => {
  let dc = '';
  let users: Record<string, string> = {};
  test.beforeAll(async ({ baseURL }) => {
    const pm = await apiSessionAs(baseURL!, P.pm);
    dc = ((await get(pm, '/api/v1/projects?pageSize=100')).items as { id: string; code: string }[]).find((p) => p.code === 'DEMO-DC')!.id;
    users = Object.fromEntries(((await get(pm, '/api/v1/auth/demo-users')).items as { id: string; displayName: string }[]).map((u) => [u.displayName, u.id]));
    await pm.dispose();
  });

  test('J1 (AT-10): a TSA past its end date without an accepted replacement — the worker escalates, never an exit; the UI offers no exit and the bypass is refused', async ({ browser, baseURL }, testInfo) => {
    test.skip(!process.env.QA_P34_DB_OWNER_URL, 'QA_P34_DB_OWNER_URL (owner URL of the e2e database) is needed to make the expiry schedule due');
    test.setTimeout(300_000);
    const base = `/api/v1/projects/${dc}`;
    const decision = await governanceDecision(baseURL!, dc, 'tsa_approval_or_extension');
    const api = await apiSessionAs(baseURL!, P.pm);
    const name = `QA P34 billing bridge ${STAMP} (synthetic)`;
    const created = await post(api, `${base}/tsa-services`, {
      name,
      scope: 'Synthetic billing runs (QA)',
      startDate: isoDate(-90),
      endDate: isoDate(-3),
      ownerUserId: users['Demo Functional Approver'],
      replacementService: 'NewCo billing (synthetic)',
      exitMilestones: [{ title: 'Replacement billing accepted with evidence (synthetic)' }],
    });
    let v = (await post(api, `${base}/tsa-services/${created.id}/transition`, { expectedVersion: created.version, command: 'start_negotiation' })).version;
    v = (await post(api, `${base}/tsa-services/${created.id}/approve`, { expectedVersion: v, decisionId: decision })).version;
    await post(api, `${base}/tsa-services/${created.id}/transition`, { expectedVersion: v, command: 'activate' });
    expect((await get(api, `${base}/tsa-services/${created.id}`)).status).toBe('active');

    // The daily per-project expiry scan (created with the project's first TSA) is made due now; the running worker picks it up.
    const sql = `update scheduled_job set next_run_at = now() where project_id = '${dc}' and kind = 'readiness.tsa_expiry_scan' returning id`;
    const out = execFileSync('psql', [process.env.QA_P34_DB_OWNER_URL!, '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' });
    expect(out.trim(), 'the DEMO-DC expiry schedule exists').toMatch(/[0-9a-f-]{36}/);
    await expect.poll(async () => (await get(api, `${base}/tsa-services/${created.id}`)).status, { timeout: 90_000, intervals: [2_000] }).toBe('expired_unresolved');
    const after = await get(api, `${base}/tsa-services/${created.id}`);
    console.log(`J1 worker result: status ${after.status}, escalation ${JSON.stringify(after.escalation && { status: after.escalation.status, target: after.escalation.target })}, exitApprovedBy ${after.exitApprovedBy}, endDate ${after.endDate}`);
    expect(after).toMatchObject({ status: 'expired_unresolved', exitApprovedBy: null, replacementAccepted: false, endDate: isoDate(-3) });
    expect(after.escalation).toMatchObject({ status: 'decision_requested' });

    const pm = await asPersona(browser, baseURL!, P.pm);
    const sponsor = await asPersona(browser, baseURL!, P.sponsor);
    try {
      const { page } = pm;
      await page.goto(`/projects/${dc}/readiness/tsa`);
      await page.getByLabel('Search code or name').fill(name);
      // QA-P34-07: the search reaches the URL through a 300 ms debounced router.replace; a row-link click before it lands is
      // undone by that replace. Wait for the filter to be applied (URL and a one-row table) before clicking.
      await page.waitForURL((u) => u.searchParams.get('q') === name);
      await expect(page.getByTestId('tsa-table').getByRole('row')).toHaveCount(2);
      const row = page.getByTestId('tsa-table').getByRole('row').filter({ hasText: name });
      await expect(row).toHaveCount(1);
      await row.getByRole('link').first().click();
      await expect(page.getByTestId('tsa-detail')).toHaveAttribute('data-status', 'expired_unresolved');
      await expect(page.getByTestId('end-not-exit')).toContainText('Reaching the end date is not an exit');
      const esc = page.getByTestId('tsa-escalation');
      await expect(esc.locator('[data-status="decision_requested"]')).toHaveCount(1);
      await expect(esc).toContainText('Extend the TSA');
      await expect(page.getByTestId('tsa-exit')).toContainText('No exit approval requested');
      // No exit is offered: neither the request (no accepted replacement) nor an approval.
      await expect(page.getByTestId('cmd-requestExit')).toHaveCount(0);
      await expect(page.getByTestId('cmd-approveExit')).toHaveCount(0);
      await shot(page, 'j1-en-tsa-expired-escalated.png');
      await sponsor.page.goto(page.url());
      await expect(sponsor.page.getByTestId('tsa-detail')).toHaveAttribute('data-status', 'expired_unresolved');
      await expect(sponsor.page.getByTestId('cmd-approveExit')).toHaveCount(0);

      // Bypassing the UI: an exit request and an exit approval are refused; nothing changes.
      const cur = await get(api, `${base}/tsa-services/${created.id}`);
      const reqExit = await postRaw(api, `${base}/tsa-services/${created.id}/request-exit-approval`, { expectedVersion: cur.version });
      const sp = await apiSessionAs(baseURL!, P.sponsor);
      const apprExit = await postRaw(sp, `${base}/tsa-services/${created.id}/approve-exit`, { expectedVersion: cur.version });
      await sp.dispose();
      console.log(`J1 bypass: request-exit-approval ${reqExit.status} ${reqExit.body.code}; approve-exit ${apprExit.status} ${apprExit.body.code}`);
      expect(reqExit).toMatchObject({ status: 422, body: { code: 'tsa.exit_not_evidenced' } });
      expect(apprExit.status).toBe(422);
      expect((await get(api, `${base}/tsa-services/${created.id}`))).toMatchObject({ status: 'expired_unresolved', version: cur.version, exitApprovedBy: null });

      // Arabic (RTL): the same state, translated.
      const bilingual = watchBilingual(page);
      await page.context().addCookies([{ name: 'hub_locale', value: 'ar', url: baseURL! }]);
      await page.reload();
      await expect(page.getByTestId('tsa-detail')).toHaveAttribute('data-status', 'expired_unresolved');
      await expect(page.getByTestId('end-not-exit')).toContainText('بلوغ تاريخ الانتهاء ليس خروجاً');
      const found = await checkArabic(page, testInfo, SHOTS, 'j1-tsa-expired-escalated', bilingual, { strict: false });
      expect(found, found.join('\n')).toEqual([]);
      expect(pm.problems(), pm.problems().join('\n')).toEqual([]);
      expect(sponsor.problems(), sponsor.problems().join('\n')).toEqual([]);
    } finally {
      await api.dispose();
      await pm.close();
      await sponsor.close();
    }
  });

  test('J2 (AT-09): failed physical-access and incident-response tests block GO; NO-GO recorded with the contingency runbook, rollback and decision history', async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(300_000);
    const base = `/api/v1/projects/${dc}`;
    const goDecision = await governanceDecision(baseURL!, dc, 'day1_go_no_go');
    const api = await apiSessionAs(baseURL!, P.pm);
    const site = await post(api, `${base}/sites`, { name: `QA P34 site ${STAMP} (synthetic)` });
    const plan = await post(api, `${base}/cutover-plans`, {
      title: `QA P34 site transition ${STAMP} (synthetic)`,
      siteId: site.id,
      accountableUserId: users[P.pm],
      runbookSummary: 'QA runbook v1 (synthetic)',
      windowStart: `${isoDate(20)}T20:00:00Z`,
      windowEnd: `${isoDate(21)}T02:00:00Z`,
      serviceImpact: 'No customer impact expected (synthetic assessment)',
      contingencyPlan: `QA contingency runbook ${STAMP}: escorted access and the current operator's incident desk stay in service (synthetic)`,
      rollbackPlan: `QA rollback ${STAMP}: revert badge provisioning and incident routing within 30 minutes (synthetic)`,
    });
    let v = (await post(api, `${base}/cutover-plans/${plan.id}/rehearsal`, { expectedVersion: plan.version, testingSummary: 'Rehearsal executed (synthetic)' })).version;
    v = (await post(api, `${base}/cutover-plans/${plan.id}/communications-approval`, { expectedVersion: v, approvalReference: 'COMMS-QA (synthetic)' })).version;
    await post(api, `${base}/cutover-plans/${plan.id}/go-decision`, { expectedVersion: v, decisionId: goDecision });
    const titles = { access: `QA physical access rights tested ${STAMP} (synthetic)`, incident: `QA incident-response process tested ${STAMP} (synthetic)`, info: `QA optional support note ${STAMP} (synthetic)` };
    const access = await post(api, `${base}/readiness-checks`, { area: 'physical_access', title: titles.access, mandatory: true, blocker: true, signoffRole: 'functional_approver', cutoverPlanId: plan.id, siteId: site.id, failureContingency: 'Contingency: escorted access by the current operator (synthetic)' });
    const incident = await post(api, `${base}/readiness-checks`, { area: 'incident_management', title: titles.incident, mandatory: true, blocker: true, signoffRole: 'functional_approver', cutoverPlanId: plan.id, siteId: site.id, failureContingency: 'Contingency: the current operator desk handles P1 incidents (synthetic)' });
    await api.dispose();

    const pm = await asPersona(browser, baseURL!, P.pm);
    const sponsor = await asPersona(browser, baseURL!, P.sponsor);
    try {
      const { page } = pm;
      // The failed tests are recorded through the UI.
      for (const [id, note] of [[access.id, 'Badge readers rejected NewCo staff cards (synthetic)'], [incident.id, 'P1 test incident not routed to the NewCo desk (synthetic)']] as const) {
        await page.goto(`/projects/${dc}/readiness/checks/${id}`);
        await page.getByTestId('cmd-test').click();
        await dialog(page).getByTestId('test-result').selectOption('failed');
        await dialog(page).getByRole('textbox').fill(note);
        await dialog(page).getByRole('button', { name: 'Record test', exact: true }).click();
        await expect(page.getByTestId('check-detail')).toHaveAttribute('data-status', 'failed');
        await expect(page.getByTestId('check-contingency')).toContainText('Contingency:');
      }
      await page.goto(`/projects/${dc}/readiness/cutover/${plan.id}`);
      await expect(page.getByTestId('go-evaluation')).toHaveAttribute('data-allowed', 'false');
      await page.getByTestId('cmd-submit').click();
      await dialog(page).getByRole('button', { name: 'Submit', exact: true }).click();
      await expect(page.getByTestId('plan-detail')).toHaveAttribute('data-status', 'ready_for_decision');

      const sp = sponsor.page;
      await sp.goto(`/projects/${dc}/readiness/cutover/${plan.id}`);
      const blockers = sp.getByTestId('go-blockers');
      await expect(blockers).toContainText(titles.access);
      await expect(blockers).toContainText(titles.incident);
      await expect(blockers.locator('[data-status="failed"]')).toHaveCount(2);
      await sp.getByTestId('cmd-decide').click();
      await checkDialogA11y(sp, dialog(sp), 'go/no-go dialog (en)');
      await dialog(sp).getByTestId('decide-outcome').selectOption('go');
      await dialog(sp).getByLabel('Rationale').fill('QA: attempted GO with failed access and incident-response tests (synthetic)');
      await dialog(sp).getByRole('button', { name: 'Record decision', exact: true }).click();
      await expect(dialog(sp).getByRole('alert')).toContainText('A GO decision is blocked by open readiness blockers');
      await dialog(sp).getByRole('button', { name: 'Cancel' }).click();
      await expect(sp.getByTestId('plan-detail')).toHaveAttribute('data-status', 'ready_for_decision');
      const refused = sp.locator('[data-testid="history-entry"][data-kind="go_blocked"]');
      await expect(refused).toHaveCount(1);
      await expect(refused).toContainText(titles.access);
      await expect(refused).toContainText(titles.incident);
      // NO-GO with its rationale.
      await sp.getByTestId('cmd-decide').click();
      await dialog(sp).getByTestId('decide-outcome').selectOption('no_go');
      await dialog(sp).getByLabel('Rationale').fill('QA: access and incident-response blockers failed; re-test after remediation (synthetic)');
      await dialog(sp).getByRole('button', { name: 'Record decision', exact: true }).click();
      await expect(sp.getByTestId('plan-detail')).toHaveAttribute('data-status', 'no_go');
      await expect(sp.locator('[data-testid="history-entry"][data-kind="no_go"]')).toContainText('access and incident-response blockers failed');
      // The contingency runbook and the rollback of the plan, and each failed check's contingency, are shown.
      await expect(sp.getByTestId('plan-contingency')).toContainText(`QA contingency runbook ${STAMP}`);
      await expect(sp.getByTestId('plan-detail')).toContainText(`QA rollback ${STAMP}`);
      await expect(sp.getByTestId('plan-checks')).toContainText('escorted access by the current operator');
      await expect(sp.getByTestId('plan-checks')).toContainText('the current operator desk handles P1 incidents');
      await shot(sp, 'j2-en-no-go-contingency-history.png');

      // Arabic (RTL): the plan with its blockers, contingency and history; the go/no-go dialog.
      const bilingual = watchBilingual(sp);
      await sp.context().addCookies([{ name: 'hub_locale', value: 'ar', url: baseURL! }]);
      await sp.reload();
      await expect(sp.getByTestId('plan-detail')).toHaveAttribute('data-status', 'no_go');
      await expect(sp.locator('[data-testid="history-entry"][data-kind="go_blocked"]')).toContainText('رفض الخادم قرار المضي');
      const found = await checkArabic(sp, testInfo, SHOTS, 'j2-plan-no-go', bilingual, { strict: false });
      expect(found, found.join('\n')).toEqual([]);
      expect(pm.problems(), pm.problems().join('\n')).toEqual([]);
      expect(sponsor.problems(), sponsor.problems().join('\n')).toEqual([]);
    } finally {
      await pm.close();
      await sponsor.close();
    }
  });

  test('J3 (REQ-JV-010): a DD question raised in the partner room is answered through review and release, and only then appears in the room', async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(300_000);
    const base = `/api/v1/projects/${dc}`;
    const pmApi = await apiSessionAs(baseURL!, P.pm);
    const room = ((await get(pmApi, `${base}/partner-rooms?pageSize=100`)).items as { id: string; name: string }[]).find((r) => r.name === 'Demo — Partner Alpha data room (fictional)')!.id;
    await pmApi.dispose();
    const question = `QA P34 ${STAMP}: which synthetic halls share the cooling loop? (synthetic)`;
    const answer = `QA P34 ${STAMP}: halls A and B share one loop (synthetic answer, not real data).`;

    const partner = await asPersona(browser, baseURL!, P.partner);
    const pm = await asPersona(browser, baseURL!, P.pm);
    const legal = await asPersona(browser, baseURL!, P.legal);
    const sponsor = await asPersona(browser, baseURL!, P.sponsor);
    try {
      // 1. The counterparty asks in its own room.
      const pp = partner.page;
      await pp.goto(`/partner-access/${dc}/${room}`);
      await expect(pp.getByTestId('external-room')).toHaveAttribute('data-room-id', room);
      await pp.getByTestId('external-question').fill(question);
      await pp.getByTestId('external-ask-submit').click();
      const myRow = pp.getByTestId('external-dd').getByRole('row').filter({ hasText: question });
      await expect(myRow).toHaveCount(1);
      await expect(myRow).toContainText('No released answer yet');

      // 2. The deal team (PM) finds it, assigns an answer owner and a reviewer, drafts and submits.
      const p = pm.page;
      await p.goto(`/projects/${dc}/jv/diligence`);
      await p.getByLabel('Search question').fill(STAMP);
      const ddRow = p.getByTestId('dd-table').getByRole('row').filter({ hasText: question });
      await expect(ddRow).toHaveCount(1);
      await ddRow.getByTestId('dd-link').click();
      await expect(p.getByTestId('dd-detail')).toHaveAttribute('data-status', 'draft');
      const requestUrl = p.url();
      await p.getByTestId('cmd-assign').click();
      await checkDialogA11y(p, dialog(p), 'DD assign dialog (en)');
      // A picked person replaces its combobox with a chip, so the next empty picker is always the first combobox.
      await dialog(p).getByRole('combobox').first().fill('Demo Project');
      await p.getByRole('option', { name: /Demo Project Manager/ }).first().click();
      await expect(dialog(p).getByRole('combobox')).toHaveCount(1);
      await dialog(p).getByRole('combobox').first().fill('Demo Legal');
      await p.getByRole('option', { name: /Demo Legal Member/ }).first().click();
      await expect(dialog(p).getByRole('combobox')).toHaveCount(0);
      await dialog(p).getByRole('button', { name: 'Assign', exact: true }).click();
      await expect(dialog(p)).toHaveCount(0);
      await p.getByTestId('cmd-draft').click();
      await dialog(p).getByTestId('dd-answer').fill(answer);
      await dialog(p).getByRole('button', { name: 'Save draft', exact: true }).click();
      await expect(dialog(p)).toHaveCount(0);
      await p.getByTestId('cmd-submit').click();
      await dialog(p).getByRole('button', { name: 'Submit', exact: true }).click();
      await expect(p.getByTestId('dd-detail')).toHaveAttribute('data-status', 'in_review');
      // The drafter is offered neither the review nor the release.
      await expect(p.getByTestId('cmd-review')).toHaveCount(0);
      await expect(p.getByTestId('cmd-release')).toHaveCount(0);

      // 3. Legal (the assigned reviewer) approves the answer for release.
      const l = legal.page;
      await l.goto(requestUrl);
      await l.getByTestId('cmd-review').click();
      await dialog(l).getByTestId('review-outcome').selectOption('approve');
      await dialog(l).getByRole('button', { name: 'Approve for release', exact: true }).click();
      await expect(l.getByTestId('dd-detail')).toHaveAttribute('data-status', 'approved_for_release');

      // 4. Approved is not released: the partner still sees no answer.
      await pp.reload();
      await expect(pp.getByTestId('external-dd').getByRole('row').filter({ hasText: question })).toContainText('No released answer yet');
      await expect(pp.locator('body')).not.toContainText(answer);

      // 5. The sponsor releases it; the answer appears in the partner's room.
      const s = sponsor.page;
      await s.goto(requestUrl);
      await s.getByTestId('cmd-release').click();
      await checkDialogA11y(s, dialog(s), 'DD release dialog (en)');
      await dialog(s).getByRole('button', { name: 'Release', exact: true }).click();
      await expect(s.getByTestId('dd-detail')).toHaveAttribute('data-status', 'released');
      await expect(s.getByTestId('dd-released')).toContainText(answer);
      await shot(s, 'j3-en-dd-released.png');
      await pp.reload();
      await expect(pp.getByTestId('external-dd').getByRole('row').filter({ hasText: question })).toContainText(answer);
      await shot(pp, 'j3-en-partner-room-answer.png');

      // Arabic (RTL): the partner's room with the released answer, and the internal request page.
      const found: string[] = [];
      const bp = watchBilingual(pp);
      await pp.context().addCookies([{ name: 'hub_locale', value: 'ar', url: baseURL! }]);
      await pp.reload();
      await expect(pp.getByTestId('external-dd')).toContainText(answer);
      found.push(...(await checkArabic(pp, testInfo, SHOTS, 'j3-partner-room-answer', bp, { strict: false })));
      const bs = watchBilingual(s);
      await s.context().addCookies([{ name: 'hub_locale', value: 'ar', url: baseURL! }]);
      await s.reload();
      await expect(s.getByTestId('dd-detail')).toHaveAttribute('data-status', 'released');
      found.push(...(await checkArabic(s, testInfo, SHOTS, 'j3-dd-request-released', bs, { strict: false })));
      // QA-P34-01c (the partner requester label shown as the English literal "Counterparty") is fixed: nothing is set aside.
      console.log(`J3 Arabic: ${found.length} problem(s)`);
      expect(found, found.join('\n')).toEqual([]);
      for (const x of [partner, pm, legal, sponsor]) expect(x.problems(), x.problems().join('\n')).toEqual([]);
    } finally {
      await partner.close();
      await pm.close();
      await legal.close();
      await sponsor.close();
    }
  });

  test('QA-P34-07: a row link clicked within the 300 ms search debounce reaches the detail page even when the navigation outlasts the debounce (fixed, regression)', async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    const pm = await asPersona(browser, baseURL!, P.pm);
    try {
      const { page } = pm;
      await page.goto(`/projects/${dc}/readiness/tsa`);
      const row = page.getByTestId('tsa-table').getByRole('row').filter({ hasText: 'Legacy monitoring bridge' });
      await expect(row).toHaveCount(1); // visible before any search
      // The detail route's payload is answered 1.5 s late (as under load); the search is typed and the row clicked at once.
      await page.route(/\/readiness\/tsa\/[0-9a-f-]{36}/, async (route) => {
        await new Promise((r) => setTimeout(r, 1_500));
        await route.continue().catch(() => undefined);
      });
      // Control: the same slow navigation WITHOUT typing reaches the detail page.
      await row.getByRole('link').first().click();
      await expect(page.getByTestId('tsa-detail')).toBeVisible({ timeout: 20_000 });
      console.log('QA-P34-07 control: slow navigation without a pending search → TSA detail shown');
      await page.goto(`/projects/${dc}/readiness/tsa`);
      await expect(row).toHaveCount(1);
      await page.getByLabel('Search code or name').fill('Legacy monitoring bridge');
      await row.getByRole('link').first().click();
      await page.waitForTimeout(4_000);
      const url = new URL(page.url());
      console.log(`QA-P34-07: after the click the page is ${url.pathname}${url.search}; TSA detail shown: ${await page.getByTestId('tsa-detail').count()}`);
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      // Fixed (SearchInput cancels the pending debounced update when a link to another page is followed): the navigation
      // started by the click is kept — the detail page, not the filtered register. (Before the fix: /readiness/tsa?q=….)
      expect(url.pathname).toMatch(/\/readiness\/tsa\/[0-9a-f-]{36}$/);
      await expect(page.getByTestId('tsa-detail')).toBeVisible();
    } finally {
      await pm.close();
    }
  });

  test('J5 (AT-07, REQ-UX-010): an item added after the baseline appears in the reconciliation (pending, change request awaiting decision) and the item count moves', async ({ browser, baseURL }) => {
    test.setTimeout(180_000);
    const base = `/api/v1/projects/${dc}`;
    const api = await apiSessionAs(baseURL!, P.pm);
    const before = await get(api, `${base}/perimeter/reconciliation`);
    const pm = await asPersona(browser, baseURL!, P.pm);
    const name = `QA P34 shared cooling unit ${STAMP} (synthetic)`;
    try {
      const { page } = pm;
      await page.goto(`/projects/${dc}/perimeter`);
      await page.getByTestId('perimeter-create').click();
      const form = page.getByTestId('perimeter-create-form');
      await form.getByLabel(/^Type/).selectOption('asset');
      await form.getByLabel(/^Requested disposition/).selectOption('shared');
      await form.getByLabel(/^Name/).fill(name);
      await form.getByLabel(/^Justification/).fill('QA: synthetic shared asset found after the baseline (demo only).');
      await page.getByTestId('perimeter-create-form-submit').click();
      await page.waitForURL(/\/perimeter\/items\/[0-9a-f-]+$/);
      await expect(page.getByTestId('pending-change')).toBeVisible();
      const itemId = page.url().split('/').pop()!;
      const code = (await get(api, `${base}/perimeter-items/${itemId}`)).code as string;
      // The reconciliation tab (UI) lists the new item with its open issues; the item count moved by one.
      await page.goto(`/projects/${dc}/perimeter?tab=reconciliation`);
      const rows = page.getByTestId('recon-findings').locator('tbody tr').filter({ hasText: code });
      await expect(rows.first()).toBeVisible();
      const issues = await rows.locator('[data-issue]').evaluateAll((els) => els.map((e) => e.getAttribute('data-issue')));
      console.log(`J5: reconciliation rows for ${code}: ${JSON.stringify(issues)}; items ${before.summary.items} → ${(await get(api, `${base}/perimeter/reconciliation`)).summary.items}`);
      expect(issues).toEqual(expect.arrayContaining(['pending_disposition', 'change_request_pending']));
      await expect(page.getByTestId('reconciliation')).toContainText(String(before.summary.items + 1));
      await shot(page, 'j5-en-reconciliation-after-add.png');
      expect(pm.problems(), pm.problems().join('\n')).toEqual([]);
    } finally {
      await api.dispose();
      await pm.close();
    }
  });

  test('J4 (AT-29): units and thousands of one currency are not added without an explicit normalization; the refusal and the disclosed basis are shown (en, ar)', async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(240_000);
    // Fixture: a fresh (non-demo) DC project; the Finance persona records two synthetic SAR figures, one in units and one in thousands.
    const admin = await apiSessionAs(baseURL!, P.admin);
    const templates = (await get(admin, '/api/v1/templates')).items as { id: string; templateKey: string }[];
    const created = await post(admin, '/api/v1/projects', {
      templateVersionId: templates.find((t) => t.templateKey === 'dc-carveout')!.id,
      code: `QA34-AT29-${STAMP}`,
      name: `QA P34 AT-29 units ${STAMP} (synthetic)`,
      projectManagerUserId: users[P.pm],
    });
    const pid = created.id as string;
    await post(admin, `/api/v1/projects/${pid}/members`, { userId: users[P.finance], role: 'finance_restricted', reason: 'QA P3/P4 review — AT-29 journey fixture' });
    await admin.dispose();
    const fin = await apiSessionAs(baseURL!, P.finance);
    for (const [ref, amount, unitScale] of [[`U1-${STAMP}`, '1000', 1], [`U1000-${STAMP}`, '2', 1000]] as const) {
      await post(fin, `/api/v1/projects/${pid}/financial-snapshots`, { kind: 'forecast', category: 'one_off_separation', lineRef: ref, label: `QA synthetic cost ${ref}`, period: '2026-Q4', amount: { amount, currency: 'SAR', unitScale }, sourceRef: 'Synthetic QA source — not real data' });
    }
    await fin.dispose();

    const { page, problems, close } = await asPersona(browser, baseURL!, P.finance);
    try {
      await page.goto(`/projects/${pid}/finance/snapshots?q=${STAMP}`);
      const boxes = page.getByTestId('snapshot-select');
      await expect(boxes).toHaveCount(2);
      for (const i of [0, 1]) await boxes.nth(i).check();
      await page.getByTestId('total-selected').click();
      const dlg = dialog(page);
      await checkDialogA11y(page, dlg, 'aggregate dialog (en)');
      await dlg.getByTestId('aggregate-target-currency').fill('SAR');
      const refused = page.waitForResponse((r) => r.url().endsWith('/finance/aggregate') && r.request().method() === 'POST');
      await dlg.getByTestId('aggregate-run').click();
      const res = await refused;
      const body = await res.json();
      console.log(`J4 units refusal: ${res.status()} ${body.code} — ${body.detail}`);
      expect(res.status()).toBe(422);
      expect(body.code).toBe('money.mixed_unit_scale');
      await expect(dlg.getByTestId('aggregate-units-differ')).toBeVisible();
      await expect(dlg.getByTestId('aggregate-result')).toHaveCount(0);
      const reason = (await dlg.getByTestId('aggregate-units-differ').innerText()).replace(/\s+/g, ' ');
      console.log(`J4 reason shown (en): ${reason}`);
      await shot(page, 'j4-en-units-refused.png');
      // Explicit normalization to units: the total is computed by the server and the basis is disclosed.
      await dlg.getByTestId('aggregate-normalize').check();
      await dlg.getByTestId('aggregate-target-unit').selectOption('1');
      await dlg.getByTestId('aggregate-run').click();
      await expect(dlg.getByTestId('aggregate-result')).toBeVisible();
      await expect(dlg.getByTestId('aggregate-total')).toHaveAttribute('data-amount', '3000.0000');
      await expect(dlg.getByTestId('aggregate-total')).toHaveAttribute('data-currency', 'SAR');
      await expect(dlg.getByTestId('aggregate-basis')).toBeVisible();
      console.log(`J4 basis shown (en): ${(await dlg.getByTestId('aggregate-basis').innerText()).replace(/\s+/g, ' ')}`);
      await shot(page, 'j4-en-units-normalized.png');
      await page.keyboard.press('Escape');

      // Arabic: the refusal with its reason, translated.
      const bilingual = watchBilingual(page);
      await page.context().addCookies([{ name: 'hub_locale', value: 'ar', url: baseURL! }]);
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByTestId('snapshot-select')).toHaveCount(2);
      for (const i of [0, 1]) await page.getByTestId('snapshot-select').nth(i).check();
      await page.getByTestId('total-selected').click();
      await checkDialogA11y(page, dialog(page), 'aggregate dialog (ar)');
      await dialog(page).getByTestId('aggregate-target-currency').fill('SAR');
      await dialog(page).getByTestId('aggregate-run').click();
      await expect(dialog(page).getByTestId('aggregate-units-differ')).toBeVisible();
      // Observation (not asserted): the Run button is disabled while the request runs, so focus falls back to <body>; the
      // refusal itself is in an aria-live region.
      const focusAfter = await page.evaluate(() => document.activeElement?.closest('dialog') ? 'inside the dialog' : (document.activeElement?.tagName ?? 'none'));
      console.log(`J4 focus after the refused run (ar): ${focusAfter}; refusal in aria-live: ${await dialog(page).locator('[aria-live] [data-testid="aggregate-units-differ"]').count()}`);
      const found = await checkArabic(page, testInfo, SHOTS, 'j4-units-refused-dialog', bilingual, { scope: dialog(page), strict: false });
      expect(found, found.join('\n')).toEqual([]);
      expect(problems(), problems().join('\n')).toEqual([]);
    } finally {
      await close();
    }
  });
});
