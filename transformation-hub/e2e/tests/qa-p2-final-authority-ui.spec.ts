import { expect, test, type APIRequestContext, type Browser, type Locator, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { apiSessionAs, loginAs, watchConsole } from './helpers';
import { checkArabic, checkDialogA11y, watchBilingual } from './qa-rtl-detector';

/**
 * Independent QA — P2 FINAL re-review (docs/reviews/P2-qa-final-review.md): the P2 exit criterion "block decisions outside
 * authority" end to end in the UI, with the rules added after the P2 reviews, in English and Arabic (RTL), axe on every
 * dialog involved. Requirement IDs: REQ-GOV-014, REQ-GOV-015, REQ-GOV-016, REQ-GOV-022, REQ-GOV-023, REQ-PLN-013,
 * REQ-PHS-004, REQ-UX-001, REQ-UX-007, REQ-UX-015; AT-04, AT-05.
 *
 * Journey (DEMO-DC; every asserted behaviour goes through the UI, each rule is also tried through the API to show the server
 * enforces it without the UI):
 *  1. the PM raises a change request of 1,500,000 SAR (above the DEMO committee limit of 1,000,000); the amount is shown as
 *     stated by the requester, not confirmed;
 *  2. DECISION SUBJECT — the PM raises the committee paper FROM the change request: the subject is pre-selected;
 *  3. PAPER EVIDENCE — saved without evidence and without a "none" reason, the paper lists the missing item and Submit is
 *     refused (translated); with an evidence link on the paper it is complete and is submitted;
 *  4. (fixture, API) agenda, meeting in session, attendance, quorum, review;
 *  5. CONFLICT DECLARATION — the Vote button stays disabled until the member declares; the chair declares "no conflict" and
 *     votes (English), the sponsor does the same in Arabic, Finance declares a conflict and is recused instead of voting;
 *  6. CHAIR CLOSES THE VOTE — the outcome cannot be recorded while two present members have not voted (UI disabled; API 422);
 *     the chair closes voting with a reason (Arabic dialog inspected, English used); a late vote is refused (API);
 *     the outcome is a recommendation (above the committee limit);
 *  7. (fixture, API) the external body's approval recorded on evidence verified by a second person;
 *  8. the decision picker of ANOTHER change request does not offer the decision (API: 422); on the change request it was
 *     raised for, the approval is refused while the cost is requester-stated only (translated);
 *  9. COST CONFIRMED BY THE ASSESSOR — Legal (assessor, not the requester) confirms the amount; the sponsor approves on the
 *     decision.
 * All data is synthetic. Screenshots: e2e/screenshots/qa-p2-final/.
 */
const SHOTS = join(__dirname, '..', 'screenshots', 'qa-p2-final');
mkdirSync(SHOTS, { recursive: true });
const RUN = Date.now().toString(36).toUpperCase().slice(-6);
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

interface Api {
  get: <T = Record<string, unknown>>(path: string) => Promise<T>;
  post: <T = Record<string, unknown>>(path: string, data: unknown) => Promise<T>;
  raw: (path: string, data: unknown) => Promise<{ status: number; body: Record<string, unknown> }>;
  dispose: () => Promise<void>;
}

async function apiAs(baseURL: string, persona: string): Promise<Api> {
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
    raw: async (path, data) => {
      const r = await ctx.post(path, { data, headers: { 'x-csrf-token': csrf } });
      return { status: r.status(), body: (await r.json().catch(() => ({}))) as Record<string, unknown> };
    },
    dispose: () => ctx.dispose(),
  };
}

interface Persona {
  page: Page;
  problems: () => string[];
  bilingual: () => Promise<Set<string>>;
  close: () => Promise<void>;
}

async function asPersona(browser: Browser, baseURL: string, persona: string): Promise<Persona> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const problems = watchConsole(page);
  const bilingual = watchBilingual(page);
  await loginAs(page, persona);
  await ctx.addCookies([{ name: 'hub_locale', value: 'en', url: baseURL }]);
  return { page, problems, bilingual, close: () => ctx.close() };
}

/** Switches the browser context's language with the `hub_locale` cookie (the persona's saved language is not changed). */
async function locale(page: Page, baseURL: string, value: 'ar' | 'en', url: string) {
  await page.context().addCookies([{ name: 'hub_locale', value, url: baseURL }]);
  await page.goto(url);
  await expect(page.locator('html')).toHaveAttribute('lang', value);
}

async function closeWithEscape(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
}

/** Arabic dialog check (lang/dir, detector, screenshot) + accessibility; the English remainders are soft failures. */
async function arabicDialog(who: Persona, testInfo: TestInfo, name: string) {
  const dialog = who.page.getByRole('dialog');
  await checkDialogA11y(who.page, dialog, `${name} (ar)`);
  const problems = await checkArabic(who.page, testInfo, SHOTS, name, who.bilingual, { scope: dialog, strict: false });
  expect.soft(problems, `${name}: English in the Arabic dialog`).toEqual([]);
  await closeWithEscape(who.page);
}

async function openCommand(page: Page, command: string): Promise<Locator> {
  await page.locator(`[data-command="${command}"]`).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe.configure({ mode: 'serial' });

/** Set by the journey test (serial): the decision the chair closed voting on. */
const shared = { dc: '', decisionUrl: '' };

test.describe('QA P2 final — "block decisions outside authority" in the UI with the new rules, English and Arabic [REQ-GOV-014, REQ-GOV-015, REQ-GOV-022, REQ-PLN-013, REQ-PHS-004, REQ-UX-001, AT-04, AT-05]', () => {
  test('subject, paper evidence, conflict declaration, chair closing the vote, assessor-confirmed cost — refused paths and the authorized approval', async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(600_000);
    const b = baseURL!;
    const setup = await apiAs(b, P.pm);
    const dc = (await setup.get<{ items: { id: string; code: string }[] }>('/api/v1/projects?pageSize=100')).items.find((x) => x.code === 'DEMO-DC')!.id;
    await setup.dispose();
    const base = `/api/v1/projects/${dc}`;

    const pm = await asPersona(browser, b, P.pm);
    const chair = await asPersona(browser, b, P.chair);
    const sponsor = await asPersona(browser, b, P.sponsor);
    const finance = await asPersona(browser, b, P.finance);
    const legal = await asPersona(browser, b, P.legal);
    const sec = await asPersona(browser, b, P.secretary);
    const everyone = [pm, chair, sponsor, finance, legal, sec];
    try {
      // --- 1. The PM raises a change request of 1,500,000 SAR (UI) and starts its review.
      await pm.page.goto(`/projects/${dc}/raid?tab=changes`);
      await pm.page.getByTestId('cr-create').click();
      const crForm = pm.page.getByTestId('cr-form');
      const crTitle = `QA final change ${RUN} (synthetic)`;
      await crForm.getByLabel(/^Title/).fill(crTitle);
      await crForm.getByLabel(/^Rationale/).fill('Synthetic QA rationale: tooling above the delegated change budget.');
      await crForm.getByRole('textbox', { name: /^Cost/ }).fill('Synthetic tooling licences');
      await crForm.getByTestId('cr-form-cost-impact-amount').fill('1500000');
      await pm.page.getByTestId('cr-form-submit').click();
      await expect(pm.page.getByRole('dialog')).toBeHidden();
      await pm.page.getByTestId('cr-table').getByRole('link', { name: crTitle }).click();
      await pm.page.waitForURL(/\/raid\/changes\/[0-9a-f-]{36}$/);
      const crUrl = new URL(pm.page.url()).pathname;
      const crId = crUrl.split('/').pop()!;
      await pm.page.locator('[data-command="submit"]').click();
      await pm.page.getByRole('dialog').getByRole('button', { name: 'Submit', exact: true }).click();
      await expect(pm.page.getByRole('dialog')).toBeHidden();
      await pm.page.locator('[data-command="start_review"]').click();
      await pm.page.getByRole('dialog').getByRole('button', { name: 'Start review', exact: true }).click();
      await expect(pm.page.getByRole('dialog')).toBeHidden();
      await expect(pm.page.getByTestId('cr-cost-impact-value')).toContainText('1,500,000');
      await expect(pm.page.getByTestId('cr-cost-impact-confirmation')).toHaveAttribute('data-confirmed', 'false');

      // --- 2. DECISION SUBJECT: the paper raised from the change request carries it as its subject (Arabic dialog inspected first).
      await locale(pm.page, b, 'ar', crUrl);
      await pm.page.getByTestId('cr-raise-paper').click();
      await expect(pm.page.getByRole('dialog').getByTestId('paper-subject-type')).toHaveValue('change_request');
      await expect(pm.page.getByRole('dialog').getByTestId('paper-subject-record')).toHaveValue(crId);
      await arabicDialog(pm, testInfo, 'final-paper-dialog-from-change');
      await locale(pm.page, b, 'en', crUrl);
      await pm.page.getByTestId('cr-raise-paper').click();
      const paper = pm.page.getByRole('dialog');
      await expect(paper.getByTestId('paper-subject-type')).toHaveValue('change_request');
      await expect(paper.getByTestId('paper-subject-record')).toHaveValue(crId);
      await checkDialogA11y(pm.page, paper, 'paper dialog (en)');
      await paper.getByLabel(/^Committee/).selectOption({ label: `${STEERING} — Program steering committee` });
      const decisionTitle = `QA final — authorize change ${RUN} above the delegated limit (synthetic)`;
      await paper.getByLabel(/^Title/).fill(decisionTitle);
      await paper.getByTestId('paper-type').selectOption('change_request_budget');
      await paper.getByLabel(/^Issue/).fill('Synthetic QA issue: tooling above the delegated change budget.');
      await paper.getByLabel(/^Why a decision is needed now/).fill('Synthetic: before the rehearsal window.');
      await paper.getByLabel(/^Alternative 1/).fill('Approve the budget');
      await paper.getByLabel(/^Recommendation/).fill('Recommend approval by the delegating authority.');
      await paper.getByLabel(/^Financial impact/).fill('1,500,000 SAR (synthetic)');
      await paper.getByLabel(/^Operational impact/).fill('None identified');
      await paper.getByLabel(/^Schedule impact/).fill('None identified');
      await paper.getByLabel(/^Amount \(decimal\)/).fill('1500000');
      await paper.getByLabel(/^Risks/).fill('None identified');
      await paper.getByLabel(/^Dependencies/).fill('None identified');
      await paper.getByLabel(/^Latest safe decision date/).fill('2026-12-15');
      await paper.getByLabel(/^Required approving authority/).fill('Delegating authority (above the DEMO committee limit)');
      // Neither supporting evidence nor a "none" reason.
      await paper.getByTestId('paper-save').click();
      await pm.page.waitForURL(/\/committee\/decisions\/[0-9a-f-]{36}$/);
      const decisionUrl = new URL(pm.page.url()).pathname;
      const decisionId = decisionUrl.split('/').pop()!;
      shared.dc = dc;
      shared.decisionUrl = decisionUrl;
      await expect(pm.page.getByTestId('decision-subject')).toContainText('Change request');
      await expect(pm.page.getByTestId('decision-subject')).toContainText(crTitle);

      // --- 3. PAPER EVIDENCE: incomplete without evidence or a reason; Submit refused (translated) and the API refuses too.
      await expect(pm.page.getByTestId('missing-fields')).toContainText('Supporting evidence or attachment — or "none" with a reason');
      let dialog = await openCommand(pm.page, 'submit');
      await dialog.getByRole('button', { name: 'Submit', exact: true }).click();
      await expect(dialog.getByTestId('refusal-explanation')).toHaveAttribute('data-code', 'governance.decision.incomplete_paper');
      await expect(dialog.getByTestId('refusal-explanation')).toContainText('The paper is incomplete.');
      await pm.page.screenshot({ path: join(SHOTS, 'en-final-paper-submit-refused.png') });
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      const pmApi = await apiAs(b, P.pm);
      const dv = async () => (await pmApi.get<{ version: number }>(`${base}/decisions/${decisionId}`)).version;
      const directSubmit = await pmApi.raw(`${base}/decisions/${decisionId}/submit`, { expectedVersion: await dv() });
      expect(directSubmit.status).toBe(422);
      expect(directSubmit.body.code).toBe('governance.decision.incomplete_paper');
      await expect(pm.page.getByTestId('decision-status')).toContainText('Draft');
      // Arabic view of the incomplete paper (the missing item is translated).
      await locale(pm.page, b, 'ar', decisionUrl);
      await expect(pm.page.getByTestId('missing-fields')).toBeVisible();
      const arPaper = await checkArabic(pm.page, testInfo, SHOTS, 'final-decision-incomplete-paper', pm.bilingual, { scope: pm.page.getByTestId('missing-fields'), strict: false });
      expect.soft(arPaper, 'incomplete paper panel in Arabic').toEqual([]);
      await locale(pm.page, b, 'en', decisionUrl);
      // An evidence link on the paper completes it.
      const panel = pm.page.locator('[data-testid="evidence-panel"][data-target-type="decision"]');
      await panel.getByTestId('evidence-add').click();
      dialog = pm.page.getByRole('dialog');
      await dialog.getByRole('radio', { name: 'Note' }).check();
      await dialog.getByLabel(/^Evidence note/).fill(`QA final supporting note ${RUN} (synthetic)`);
      await dialog.getByRole('button', { name: 'Link evidence', exact: true }).click();
      await expect(dialog).toBeHidden();
      await pm.page.reload();
      await expect(pm.page.getByTestId('missing-fields')).toHaveCount(0);
      await expect(pm.page.getByText('The paper is complete and can be submitted.')).toBeVisible();
      dialog = await openCommand(pm.page, 'submit');
      await dialog.getByRole('button', { name: 'Submit', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(pm.page.getByTestId('decision-status')).toContainText('Submitted');

      // --- 4. Fixture (API): agenda request screened onto a new meeting, review, agenda, pack, session, attendance, quorum.
      const secApi = await apiAs(b, P.secretary);
      const committeeId = (await secApi.get<{ items: { id: string; name: string }[] }>(`${base}/committees`)).items.find((c) => c.name === STEERING)!.id;
      const m = await secApi.post<{ id: string; version: number }>(`${base}/committees/${committeeId}/meetings`, { title: `QA final meeting ${RUN}`, scheduledAt: new Date().toISOString() });
      const req = await pmApi.post<{ id: string; version: number }>(`${base}/agenda-requests`, { committeeId, title: `QA final decision ${RUN}`, kind: 'decision', decisionId, meetingId: m.id });
      await secApi.post(`${base}/agenda-requests/${req.id}/screen`, { expectedVersion: req.version, outcome: 'accept', meetingId: m.id });
      await secApi.post(`${base}/decisions/${decisionId}/start-review`, { expectedVersion: await dv() });
      let mv = (await secApi.post<{ version: number }>(`${base}/meetings/${m.id}/publish-agenda`, { expectedVersion: m.version })).version;
      mv = (await secApi.post<{ version: number }>(`${base}/meetings/${m.id}/packs`, { expectedVersion: mv })).version;
      mv = (await secApi.post<{ version: number }>(`${base}/meetings/${m.id}/start`, { expectedVersion: mv })).version;
      const seats = (await secApi.get<{ memberships: { id: string; displayName: string | null; activeToday: boolean }[] }>(`${base}/committees/${committeeId}`)).memberships;
      const present: string[] = [P.chair, P.sponsor, P.finance, P.legal, P.secretary, P.approver];
      await secApi.post(`${base}/meetings/${m.id}/attendance`, { entries: seats.filter((s) => s.activeToday && s.displayName && present.includes(s.displayName)).map((s) => ({ membershipId: s.id, status: 'present' })) });
      await secApi.post(`${base}/meetings/${m.id}/quorum-check`, { expectedVersion: mv });

      // --- 5. CONFLICT DECLARATION before voting.
      // Chair (English): Vote disabled until the declaration; declares "no conflict" and votes approve.
      await chair.page.goto(decisionUrl);
      await expect(chair.page.getByTestId('decision-status')).toContainText('Under review');
      dialog = await openCommand(chair.page, 'vote');
      await expect(dialog.getByTestId('vote-conflict')).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Vote', exact: true })).toBeDisabled();
      await checkDialogA11y(chair.page, dialog, 'vote dialog with the conflict step (en)');
      await dialog.getByTestId('vote-conflict').getByRole('radio', { name: 'I have no conflict of interest with this item' }).check();
      await expect(dialog.getByRole('button', { name: 'Vote', exact: true })).toBeEnabled();
      await chair.page.screenshot({ path: join(SHOTS, 'en-final-vote-conflict-declared.png') });
      await dialog.getByRole('button', { name: 'Vote', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(chair.page.getByTestId('votes-table')).toContainText(P.chair);
      // Bypass attempt: Legal votes through the API without its own declaration → refused.
      const legalApi = await apiAs(b, P.legal);
      const legalApiUser = (await legalApi.get<{ user: { id: string } }>('/api/v1/me')).user.id;
      const undeclared = await legalApi.raw(`${base}/decisions/${decisionId}/votes`, { expectedVersion: await dv(), choice: 'approve' });
      expect(undeclared.status).toBe(422);
      expect(undeclared.body.code).toBe('governance.vote.declaration_required');
      // Sponsor (Arabic): the same dialog in Arabic, declared and voted.
      await locale(sponsor.page, b, 'ar', decisionUrl);
      dialog = await openCommand(sponsor.page, 'vote');
      await expect(dialog.getByRole('button', { name: 'تصويت', exact: true })).toBeDisabled();
      await checkDialogA11y(sponsor.page, dialog, 'vote dialog with the conflict step (ar)');
      const arVote = await checkArabic(sponsor.page, testInfo, SHOTS, 'final-vote-dialog-conflict-step', sponsor.bilingual, { scope: dialog, strict: false });
      expect.soft(arVote, 'vote dialog in Arabic').toEqual([]);
      await dialog.getByRole('radio', { name: 'ليس لدي أي تعارض مصالح في هذا البند' }).check();
      await dialog.getByRole('button', { name: 'تصويت', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(sponsor.page.getByTestId('votes-table')).toContainText(P.sponsor);
      await locale(sponsor.page, b, 'en', decisionUrl);
      // Finance (English): declares a conflict → recused instead of voting (a reason is required).
      await finance.page.goto(decisionUrl);
      dialog = await openCommand(finance.page, 'vote');
      await dialog.getByTestId('vote-conflict').getByRole('radio', { name: 'I have a conflict of interest — record my recusal instead of voting' }).check();
      await expect(dialog.getByLabel(/^Reason for the recusal/)).toBeVisible();
      await dialog.getByLabel(/^Reason for the recusal/).fill('Synthetic QA: declared interest in the tooling vendor');
      await dialog.getByRole('button', { name: 'Vote', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(finance.page.getByTestId('recusals')).toContainText(P.finance);
      await expect(finance.page.getByTestId('votes-table')).not.toContainText(P.finance);

      // --- 6. CHAIR CLOSES THE VOTE. Two present members (Legal, Functional Approver) have not voted.
      await sec.page.goto(decisionUrl);
      await expect(sec.page.getByTestId('voting-outstanding')).toContainText(P.legal);
      await expect(sec.page.getByTestId('voting-outstanding')).toContainText(P.approver);
      await expect(sec.page.locator('[data-command="closeVoting"]')).toHaveCount(0); // only the chair closes voting
      dialog = await openCommand(sec.page, 'recordOutcome');
      await expect(dialog.getByRole('button', { name: 'Record outcome', exact: true })).toBeDisabled();
      await expect(dialog).toContainText('Not yet: 2 eligible member(s) have not voted.');
      await checkDialogA11y(sec.page, dialog, 'record outcome dialog while votes are outstanding (en)');
      await closeWithEscape(sec.page);
      const earlyOutcome = await secApi.raw(`${base}/decisions/${decisionId}/record-outcome`, { expectedVersion: await dv() });
      expect(earlyOutcome.status).toBe(422);
      console.log(`record-outcome while votes are outstanding (API): ${earlyOutcome.status} ${String(earlyOutcome.body.code)}`);
      // The secretary cannot close voting through the API either.
      const secClose = await secApi.raw(`${base}/decisions/${decisionId}/close-voting`, { expectedVersion: await dv(), reason: 'probe' });
      expect([403, 422]).toContain(secClose.status);
      console.log(`close-voting by the secretary (API): ${secClose.status} ${String(secClose.body.code)}`);
      // Chair: the dialog in Arabic (inspected, not used), then closed in English with a reason.
      await locale(chair.page, b, 'ar', decisionUrl);
      await openCommand(chair.page, 'closeVoting');
      await arabicDialog(chair, testInfo, 'final-close-voting-dialog');
      await locale(chair.page, b, 'en', decisionUrl);
      dialog = await openCommand(chair.page, 'closeVoting');
      await expect(dialog).toContainText('Members who have not voted yet: 2');
      await checkDialogA11y(chair.page, dialog, 'close voting dialog (en)');
      // The reason is required: an empty reason is flagged in the dialog (and refused by the API, 400).
      await dialog.getByRole('button', { name: 'Close voting', exact: true }).click();
      await expect(dialog.getByText('This field is required.')).toBeVisible();
      await expect(dialog).toBeVisible();
      const chairApi = await apiAs(b, P.chair);
      const noReason = await chairApi.raw(`${base}/decisions/${decisionId}/close-voting`, { expectedVersion: await dv() });
      expect(noReason.status).toBe(400);
      await chairApi.dispose();
      await dialog.getByLabel(/^Reason/).fill('Synthetic QA: the two remaining members left the session');
      await dialog.getByRole('button', { name: 'Close voting', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(chair.page.getByTestId('voting-closed')).toContainText('Synthetic QA: the two remaining members left the session');
      // A late vote is refused (API); the UI no longer offers Vote to Legal.
      const late = await legalApi.raw(`${base}/decisions/${decisionId}/votes`, { expectedVersion: await dv(), choice: 'approve', conflictDeclaration: 'no_conflict' });
      expect(late.status).toBe(422);
      expect(late.body.code).toBe('governance.vote.voting_closed');
      await legal.page.goto(decisionUrl);
      await expect(legal.page.getByTestId('decision-status')).toContainText('Under review');
      await expect(legal.page.locator('[data-command="vote"]')).toHaveCount(0);
      // The chair records the outcome: a recommendation (1,500,000 SAR is above the committee limit).
      await chair.page.reload();
      dialog = await openCommand(chair.page, 'recordOutcome');
      await expect(dialog.getByRole('button', { name: 'Record outcome', exact: true })).toBeEnabled();
      await dialog.getByRole('button', { name: 'Record outcome', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(chair.page.getByTestId('decision-status')).toContainText('Recommended');
      await expect(chair.page.getByTestId('decision-outcome')).toContainText('2 approve · 0 reject · 0 abstain');
      const tally = (await secApi.get<{ tallySnapshot: Record<string, unknown> | null }>(`${base}/decisions/${decisionId}`)).tallySnapshot;
      console.log(`tally snapshot after the chair closed voting: ${JSON.stringify(tally)}`);
      expect(JSON.stringify(tally)).toContain(legalApiUser);
      await locale(chair.page, b, 'ar', decisionUrl);
      await expect(chair.page.getByTestId('decision-status')).toContainText('موصى به');
      const arDecision = await checkArabic(chair.page, testInfo, SHOTS, 'final-decision-recommended', chair.bilingual, { strict: false });
      console.log(`Arabic decision page after the outcome: ${arDecision.length} detector problem(s)`);
      await locale(chair.page, b, 'en', decisionUrl);

      // --- 7. Fixture (API): the external body's approval, recorded on evidence verified by a second person.
      const link = await pmApi.post<{ id: string }>(`${base}/evidence`, { targetType: 'decision', targetId: decisionId, note: `QA final record of the delegating authority's approval ${RUN} (synthetic)` });
      await legalApi.post(`${base}/evidence/${link.id}/verify`, { expectedVersion: 1, decision: 'accept', note: 'Checked against the synthetic reference (QA)' });
      await secApi.post(`${base}/decisions/${decisionId}/record-external-approval`, { expectedVersion: await dv(), outcome: 'approved', externalReference: `QA-FINAL-DELEGATING-AUTHORITY-${RUN}`, evidenceLinkId: link.id });

      // --- 8. The decision backs only its subject; on its subject, a requester-stated cost is not enough.
      const crY = await pmApi.post<{ id: string }>(`${base}/change-requests`, { title: `QA final other change ${RUN} (synthetic)`, rationale: 'Synthetic QA: another change', alternatives: ['Do nothing'], impacts: { cost: 'Synthetic' }, costImpact: { amount: '1200000', currency: 'SAR', unitScale: 1 } });
      await pmApi.post(`${base}/change-requests/${crY.id}/submit`, { expectedVersion: 1 });
      await pmApi.post(`${base}/change-requests/${crY.id}/start-review`, { expectedVersion: 2 });
      const yv = async () => (await pmApi.get<{ version: number }>(`${base}/change-requests/${crY.id}`)).version;
      await legalApi.post(`${base}/change-requests/${crY.id}/assess`, { expectedVersion: await yv(), impacts: {}, costImpact: { amount: '1200000', currency: 'SAR', unitScale: 1 }, note: 'Assessed (synthetic QA)' });
      await sponsor.page.goto(`/projects/${dc}/raid/changes/${crY.id}`);
      dialog = await openCommand(sponsor.page, 'approve');
      await expect(dialog.getByTestId('approval-decision-select').locator('option')).toHaveCount(1);
      await expect(dialog.getByTestId('approval-decision-empty')).toBeVisible();
      await closeWithEscape(sponsor.page);
      const sponsorApi = await apiAs(b, P.sponsor);
      const onY = await sponsorApi.raw(`${base}/change-requests/${crY.id}/approve`, { expectedVersion: await yv(), decisionId, note: 'QA bypass probe' });
      expect(onY.status).toBe(422);
      expect(onY.body.code).toBe('change_control.decision_other_subject');
      // On X, in Arabic first (inspected), then in English: refused while the cost is stated by the requester only.
      await locale(sponsor.page, b, 'ar', crUrl);
      dialog = await openCommand(sponsor.page, 'approve');
      await dialog.getByTestId('approval-decision-select').selectOption(decisionId);
      await expect(dialog.getByTestId('approval-decision-selected')).toBeVisible();
      await arabicDialog(sponsor, testInfo, 'final-change-approval-dialog-decision');
      await locale(sponsor.page, b, 'en', crUrl);
      dialog = await openCommand(sponsor.page, 'approve');
      await expect(dialog.getByTestId('approval-decision-select').locator(`option[value="${decisionId}"]`)).toHaveCount(1);
      await dialog.getByTestId('approval-decision-select').selectOption(decisionId);
      await expect(dialog.getByTestId('approval-decision-selected')).toContainText('1,500,000 SAR');
      await checkDialogA11y(sponsor.page, dialog, 'change approval dialog with the decision picker (en)');
      await dialog.getByRole('button', { name: 'Approve change', exact: true }).click();
      await expect(dialog.getByTestId('refusal-explanation')).toHaveAttribute('data-code', 'change_control.amount_unconfirmed');
      await expect(dialog.getByTestId('refusal-explanation')).toContainText('stated by the requester only');
      await sponsor.page.screenshot({ path: join(SHOTS, 'en-final-change-approval-amount-unconfirmed.png') });
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      // The requester (who also holds the assessor role) re-recording the amount does not confirm it (API).
      const xv = async () => (await pmApi.get<{ version: number }>(`${base}/change-requests/${crId}`)).version;
      await pmApi.post(`${base}/change-requests/${crId}/assess`, { expectedVersion: await xv(), impacts: {}, costImpact: { amount: '1500000', currency: 'SAR', unitScale: 1 } });
      expect((await pmApi.get<{ costImpactConfirmed: boolean }>(`${base}/change-requests/${crId}`)).costImpactConfirmed).toBe(false);

      // --- 9. COST CONFIRMED BY THE ASSESSOR: Legal's assessment dialog (Arabic inspected, English used), then the approval.
      await locale(legal.page, b, 'ar', crUrl);
      await legal.page.getByTestId('cr-assess-open').click();
      await arabicDialog(legal, testInfo, 'final-change-assess-dialog');
      await locale(legal.page, b, 'en', crUrl);
      await legal.page.getByTestId('cr-assess-open').click();
      const assess = legal.page.getByTestId('cr-assess');
      await expect(assess.getByTestId('cr-cost-impact-amount')).toHaveValue(/1500000/);
      await checkDialogA11y(legal.page, legal.page.getByRole('dialog'), 'change assessment dialog (en)');
      await legal.page.getByTestId('cr-assess-submit').click();
      await expect(legal.page.getByRole('dialog')).toBeHidden();
      await expect(legal.page.getByTestId('cr-cost-impact-confirmation')).toHaveAttribute('data-confirmed', 'true');
      await sponsor.page.reload();
      dialog = await openCommand(sponsor.page, 'approve');
      await dialog.getByTestId('approval-decision-select').selectOption(decisionId);
      await expect(dialog.getByTestId('approval-decision-selected')).toContainText('1,500,000 SAR');
      await dialog.getByRole('button', { name: 'Approve change', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(sponsor.page.getByTestId('cr-decision-link')).toHaveAttribute('href', decisionUrl);
      await sponsor.page.screenshot({ path: join(SHOTS, 'en-final-change-approved-on-decision.png'), fullPage: true });
      const cr = await pmApi.get<{ status: string; decisionId: string | null }>(`${base}/change-requests/${crId}`);
      expect(cr).toMatchObject({ status: 'approved', decisionId });
      // The decision is used: approving the other change on it is still refused.
      const again = await sponsorApi.raw(`${base}/change-requests/${crY.id}/approve`, { expectedVersion: await yv(), decisionId, note: 'QA bypass probe after use' });
      expect(again.status).toBe(422);
      console.log(`approval of the other change on the used decision: ${again.status} ${String(again.body.code)}`);
      // Arabic view of the approved change (English remainders are reported, QA-P2-04).
      await locale(sponsor.page, b, 'ar', crUrl);
      const arCr = await checkArabic(sponsor.page, testInfo, SHOTS, 'final-change-approved', sponsor.bilingual, { strict: false });
      console.log(`Arabic change request page after the approval: ${arCr.length} detector problem(s)`);
      await locale(sponsor.page, b, 'en', crUrl);

      for (const a of [pmApi, secApi, legalApi, sponsorApi]) await a.dispose();
      for (const who of everyone) expect(who.problems(), who.problems().join('\n')).toEqual([]);
    } finally {
      for (const who of everyone) await who.close();
    }
  });
  // QA-P2F-03 (docs/reviews/P2-qa-final-review.md, Low): the audit action of DOM-P2R-01 `governance.decision.close_voting`
  // has no `governance.audit.decision_close_voting` label in en or ar, so the governance history shows the raw code
  // (gov.tsx GovHistory falls back to <code>). Fixed: the label exists in en and ar, and the i18n check (check-i18n.mjs §8)
  // now requires a history label for every literal governance / finance audit action.
  test('QA-P2F-03 (fixed, regression): the history entry of the chair closing the vote is a translated label, not a raw audit code (en and ar)', async ({ page, baseURL }) => {
    expect(shared.decisionUrl, 'the journey test ran first').not.toBe('');
    await loginAs(page, P.chair);
    for (const lang of ['en', 'ar'] as const) {
      await page.context().addCookies([{ name: 'hub_locale', value: lang, url: baseURL! }]);
      await page.goto(shared.decisionUrl);
      const entry = page.getByTestId('gov-history').locator('li[data-action="governance.decision.close_voting"]');
      await expect(entry).toHaveCount(1);
      console.log(`[QA-P2F-03 ${lang}] close-voting history entry: ${(await entry.innerText()).replace(/\s+/g, ' ')}`);
      await expect(entry.locator('code')).toHaveCount(0);
    }
  });
});
