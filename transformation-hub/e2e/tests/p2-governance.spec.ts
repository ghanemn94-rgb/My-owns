import { expect, test, type Browser, type Page } from '@playwright/test';
import { join } from 'node:path';
import { apiSessionAs, loginAs, setSavedLocale, watchConsole } from './helpers';

/**
 * P2 governance — a real decision driven through the Committee Hub UI against the running API (no mocks):
 * schedule meeting → draft paper → submit → agenda request → secretariat screening → agenda, frozen pack, session,
 * attendance, quorum → review → recusal + the server's rejection of the recused member's vote shown in the UI →
 * votes → server-computed outcome (Approved within the DEMO mandate). Screenshots in English and Arabic (RTL),
 * desktop and 390 px mobile width.
 */
const SHOTS = join(__dirname, '..', 'screenshots');
const P = {
  pm: 'Demo Project Manager',
  secretary: 'Demo Secretary / CPMO',
  chair: 'Demo Committee Chair',
  sponsor: 'Demo Sponsor',
  finance: 'Demo Finance Member',
  legal: 'Demo Legal Member',
  approver: 'Demo Functional Approver',
} as const;
const STEERING = 'DC Carve-out & JV Steering Committee (Demo)';

function riyadhNow(): { date: string; dateTime: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return { date, dateTime: `${date}T${parts.hour}:${parts.minute}` };
}

async function asPersona(browser: Browser, persona: string): Promise<{ page: Page; problems: () => string[]; close: () => Promise<void> }> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const problems = watchConsole(page);
  await loginAs(page, persona);
  return { page, problems, close: () => ctx.close() };
}

async function confirmDialog(page: Page, button: string) {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: button, exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function runCommand(page: Page, command: string, confirm: string, fill?: (dialog: ReturnType<Page['getByRole']>) => Promise<void>) {
  await page.locator(`[data-command="${command}"]`).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  if (fill) await fill(dialog);
  await confirmDialog(page, confirm);
}

test.describe('P2 governance — Committee Hub (REQ-GOV-012..020, AT-05 in the UI)', () => {
  test('a decision goes from draft to a server-computed outcome through the UI; a recused vote is refused and shown', async ({ browser, baseURL }) => {
    test.setTimeout(300_000);
    const api = await apiSessionAs(baseURL!, P.pm);
    const projects = (await (await api.get('/api/v1/projects')).json()).items as { id: string; code: string }[];
    const dc = projects.find((p) => p.code === 'DEMO-DC')!;
    expect(dc, 'DEMO-DC visible to the PM').toBeTruthy();
    await api.dispose();
    const hub = `/projects/${dc.id}/committee`;
    const stamp = Date.now().toString(36);
    const meetingTitle = `E2E steering meeting ${stamp}`;
    const now = riyadhNow();

    const sec = await asPersona(browser, P.secretary);
    const pm = await asPersona(browser, P.pm);
    try {
      // --- Hub overview: metrics link to their records; committees list shows the Demo steering committee.
      await sec.page.goto(hub);
      await expect(sec.page.getByRole('heading', { level: 1, name: 'Committee Hub' })).toBeVisible();
      await expect(sec.page.getByTestId('committees-table').getByRole('link', { name: STEERING })).toBeVisible();
      await expect(sec.page.getByTestId('gov-metrics').getByRole('link', { name: /Recommended — pending external authority: 1/ })).toBeVisible();

      // --- Secretariat schedules a meeting.
      await sec.page.goto(`${hub}/meetings`);
      await sec.page.getByTestId('schedule-meeting').click();
      const sched = sec.page.getByRole('dialog');
      await sched.getByLabel(/^Committee/).selectOption({ label: STEERING });
      await sched.getByLabel(/^Title/).fill(meetingTitle);
      await sched.getByLabel(/^Date and time/).fill(now.dateTime);
      await confirmDialog(sec.page, 'Schedule');
      const meetingRow = sec.page.getByTestId('meetings-table').getByRole('row').filter({ hasText: meetingTitle });
      await expect(meetingRow).toBeVisible();
      const meetingLabel = (await meetingRow.getByTestId('meeting-link').innerText()).trim();

      // --- The PM drafts a complete decision paper and submits it.
      await pm.page.goto(`${hub}/decisions`);
      await pm.page.getByTestId('new-decision').click();
      const form = pm.page.getByRole('dialog');
      await form.getByLabel(/^Committee/).selectOption({ label: `${STEERING} — Program steering committee` });
      await form.getByLabel(/^Title/).fill(`E2E — Approve rehearsal tooling budget ${stamp}`);
      await form.getByTestId('paper-type').selectOption({ label: 'Approve a change request with budget impact' });
      await form.getByLabel(/^Issue/).fill('Synthetic E2E issue: rehearsal tooling is not budgeted.');
      await form.getByLabel(/^Why a decision is needed now/).fill('Needed before the synthetic rehearsal window.');
      await form.getByLabel(/^Alternative 1/).fill('Approve the budget');
      await form.getByLabel(/^Recommendation/).fill('Approve.');
      await form.getByLabel(/^Financial impact/).fill('250,000 DEMO-SAR (synthetic)');
      await form.getByLabel(/^Operational impact/).fill('None identified');
      await form.getByLabel(/^Schedule impact/).fill('None identified');
      await form.getByLabel(/^Amount \(decimal\)/).fill('250000');
      await form.getByLabel(/^Risks/).fill('None identified');
      await form.getByLabel(/^Dependencies/).fill('None identified');
      await form.getByLabel(/^Latest safe decision date/).fill('2026-12-15');
      await form.getByLabel(/^Required approving authority/).fill('Steering committee (DEMO matrix)');
      // DOM-P2-14: supporting evidence on the paper — or "none" with a reason.
      await form.getByLabel(/^No supporting evidence or attachment — reason/).fill('Synthetic E2E paper: no supporting documents exist');
      await form.getByTestId('paper-save').click();
      await pm.page.waitForURL(/\/committee\/decisions\/[0-9a-f-]{36}$/);
      const decisionUrl = new URL(pm.page.url()).pathname;
      await expect(pm.page.getByTestId('decision-status')).toContainText('Draft');
      await expect(pm.page.getByText('The paper is complete and can be submitted.')).toBeVisible();
      // Commands the PM lacks are not offered (the server would refuse them anyway).
      await expect(pm.page.locator('[data-command="recordOutcome"]')).toHaveCount(0);
      await expect(pm.page.locator('[data-command="vote"]')).toHaveCount(0);
      await runCommand(pm.page, 'submit', 'Submit');
      await expect(pm.page.getByTestId('decision-status')).toContainText('Submitted');

      // --- The PM asks for committee time at the new meeting.
      await pm.page.getByTestId('request-agenda').click();
      const req = pm.page.getByRole('dialog');
      await req.getByLabel(/^Item title/).fill(`Decision paper ${stamp}`);
      await req.getByLabel(/^Preferred meeting/).selectOption({ label: `${meetingLabel} — ${meetingTitle}` });
      await confirmDialog(pm.page, 'Send request');

      // --- Secretariat: screening onto the numbered agenda, publish, freeze the pack, open the session.
      await sec.page.getByTestId('meetings-table').getByRole('row').filter({ hasText: meetingTitle }).getByTestId('meeting-link').click();
      await expect(sec.page.getByTestId('meeting-status')).toContainText('Planned');
      await sec.page.getByTestId('screen-request').click();
      await confirmDialog(sec.page, 'Record screening');
      await expect(sec.page.getByTestId('agenda-list')).toContainText(`Decision paper ${stamp}`);
      await runCommand(sec.page, 'publish', 'Publish agenda');
      await runCommand(sec.page, 'freeze', 'Freeze pack');
      await expect(sec.page.getByTestId('packs-table').getByRole('row')).toHaveCount(2);
      await runCommand(sec.page, 'start', 'Open session');
      await expect(sec.page.getByTestId('meeting-status')).toContainText('In session');
      await sec.page.getByTestId('record-attendance').click();
      const att = sec.page.getByRole('dialog');
      for (const who of [P.chair, P.sponsor, P.finance, P.legal, P.secretary, P.approver]) {
        await att.locator(`select[data-person="${who}"]`).selectOption('present');
      }
      await confirmDialog(sec.page, 'Save attendance');
      await expect(sec.page.getByTestId('attendance-table').getByRole('row')).toHaveCount(7);
      await runCommand(sec.page, 'quorum', 'Check quorum');
      await expect(sec.page.getByTestId('quorum-panel')).toContainText('Quorum met');

      // --- Secretariat accepts the paper for deliberation (tabled at the meeting by the screening).
      await sec.page.goto(decisionUrl);
      await runCommand(sec.page, 'startReview', 'Start review');
      await expect(sec.page.getByTestId('decision-status')).toContainText('Under review');

      // --- AT-05 in the UI: a recused member's vote is refused by the server and the reason is shown.
      const legal = await asPersona(browser, P.legal);
      try {
        await legal.page.goto(decisionUrl);
        await runCommand(legal.page, 'recuse', 'Declare recusal', async (d) => {
          await d.getByLabel(/^Reason/).fill('Declared interest in the synthetic tooling vendor');
        });
        await expect(legal.page.getByTestId('recusals')).toContainText('Demo Legal Member');
        await legal.page.locator('[data-command="vote"]').click();
        const voteDialog = legal.page.getByRole('dialog');
        await expect(voteDialog.getByText('You are recused from this decision: the server refuses your vote.')).toBeVisible();
        await voteDialog.getByRole('button', { name: 'Vote', exact: true }).click();
        await expect(voteDialog.getByRole('alert')).toContainText('The request breaks a business rule');
        await expect(voteDialog.getByRole('alert')).toContainText('A recused member cannot vote on this decision');
        await expect(voteDialog.getByRole('alert')).toContainText('Reference:');
        await voteDialog.getByRole('button', { name: 'Cancel' }).click();
        await expect(legal.page.getByTestId('votes-table')).toContainText('No votes recorded.');
        expect(legal.problems(), legal.problems().join('\n')).toEqual([]);
      } finally {
        await legal.close();
      }

      // --- Every present eligible member votes (DOM-P2R-01), each first declaring "no conflict" for the item (REQ-GOV-015).
      for (const persona of [P.chair, P.sponsor, P.finance, P.approver]) {
        const voter = await asPersona(browser, persona);
        try {
          await voter.page.goto(decisionUrl);
          await runCommand(voter.page, 'vote', 'Vote', async (d) => {
            await expect(d.getByRole('button', { name: 'Vote', exact: true })).toBeDisabled();
            await d.getByTestId('vote-conflict').getByRole('radio', { name: 'I have no conflict of interest with this item' }).check();
          });
          await expect(voter.page.getByTestId('votes-table')).toContainText(persona);
          expect(voter.problems(), voter.problems().join('\n')).toEqual([]);
        } finally {
          await voter.close();
        }
      }

      // --- The server computes quorum, tally and authority: Approved within the DEMO mandate.
      await sec.page.reload();
      await expect(sec.page.getByTestId('votes-table').getByRole('row')).toHaveCount(5);
      await runCommand(sec.page, 'recordOutcome', 'Record outcome');
      await expect(sec.page.getByTestId('decision-status')).toContainText('Approved');
      await expect(sec.page.getByTestId('decision-outcome')).toContainText('4 approve · 0 reject · 0 abstain');
      await expect(sec.page.getByTestId('decision-outcome')).toContainText('Quorum met:');
      await expect(sec.page.getByTestId('decision-lifecycle')).toContainText('Implementation pending');
      await expect(sec.page.getByText('Approval is not implementation', { exact: false })).toBeVisible();
      const history = sec.page.getByTestId('gov-history');
      for (const entry of ['Drafted the decision paper', 'Submitted the paper', 'Accepted the paper for review', 'Recorded a recusal', 'Cast a vote', 'Recorded the outcome']) {
        await expect(history).toContainText(entry);
      }
      await sec.page.getByRole('status').getByRole('button', { name: 'Dismiss' }).first().click();
      await expect(sec.page.getByText('Outcome recorded: Approved.')).toHaveCount(0);
      await sec.page.screenshot({ path: join(SHOTS, 'governance-en.png'), fullPage: true });
      await sec.page.setViewportSize({ width: 390, height: 844 });
      await sec.page.screenshot({ path: join(SHOTS, 'governance-en-mobile.png'), fullPage: true });
      expect(sec.problems(), sec.problems().join('\n')).toEqual([]);
      expect(pm.problems(), pm.problems().join('\n')).toEqual([]);

      // --- Arabic (RTL): the same decision, then the recommended-pending-authority Demo decision, at desktop and 390 px.
      const ar = await asPersona(browser, P.chair);
      try {
        await setSavedLocale(ar.page, 'ar');
        await ar.page.goto(decisionUrl);
        await expect(ar.page.locator('html')).toHaveAttribute('dir', 'rtl');
        await expect(ar.page.getByTestId('committee-tabs').getByRole('link', { name: 'القرارات' })).toBeVisible();
        await expect(ar.page.getByTestId('decision-status')).toContainText('معتمد');
        await expect(ar.page.getByTestId('decision-outcome')).toContainText('4 موافقة · 0 رفض · 0 امتناع');
        await expect(ar.page.getByTestId('decision-outcome')).toContainText('النصاب مكتمل:');
        await expect(ar.page.getByTestId('votes-table').getByRole('row')).toHaveCount(5);
        await expect(ar.page.getByTestId('gov-history').locator('li[data-action]').first()).toBeVisible();
        await expect(ar.page.getByRole('link', { name: STEERING })).toBeVisible();
        await ar.page.screenshot({ path: join(SHOTS, 'governance-ar.png'), fullPage: true });
        await ar.page.goto(`${hub}/decisions?status=recommended`);
        await ar.page.getByTestId('decisions-table').getByTestId('decision-link').first().click();
        await expect(ar.page.getByTestId('recommended-callout')).toContainText('موصى به — بانتظار الجهة المختصة');
        await ar.page.setViewportSize({ width: 390, height: 844 });
        // Wait for every section of the page (votes, history, the paper's committee) before the screenshot.
        await expect(ar.page.getByTestId('votes-table').getByRole('row').nth(1)).toBeVisible();
        await expect(ar.page.getByTestId('gov-history').locator('li[data-action]').first()).toBeVisible();
        await expect(ar.page.getByRole('link', { name: STEERING })).toBeVisible();
        await expect(ar.page.getByText('جارٍ التحميل')).toHaveCount(0);
        await ar.page.screenshot({ path: join(SHOTS, 'governance-ar-mobile.png'), fullPage: true });
        // No horizontal overflow of the page at 390 px (tables scroll inside their own container).
        const overflow = await ar.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(1);
        expect(ar.problems(), ar.problems().join('\n')).toEqual([]);
      } finally {
        await setSavedLocale(ar.page, 'en');
        await ar.close();
      }
    } finally {
      await sec.close();
      await pm.close();
    }
  });
});
