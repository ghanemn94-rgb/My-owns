import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { join } from 'node:path';
import { PERSONAS, apiSessionAs, loginAs, watchConsole } from './helpers';

/**
 * Web follow-ups of the P2 domain review fixes (docs/reviews/P2-domain-review.md, "Fix status" sections), driven through
 * the UI against the running API (no mocks):
 *  (a) DOM-P2-06 + DOM-P2-12 + DOM-P2-03 — a recusal recorded on behalf of a member shows its recorder, and one after the
 *      member voted is refused (translated, with the restart-the-round path); an out-of-authority budget decision is
 *      recommended, its external approval is recorded only
 *      on evidence verified by a second person (the verifier cannot record it), and a change request whose cost impact
 *      exceeds the delegated limit is refused (text-only cost, then outside authority — translated) and approved on that
 *      final decision;
 *  (b) DOM-P2-12 — a loaded (non-demo) authority matrix needs an approval document and stays pending until a second
 *      person verifies it (drafter / approver cannot);
 *  (c) DOM-P2-17 — a cross-project dependency is recorded, visible from both projects to readers of both, invisible to a
 *      reader of one project only, and closed with a reason;
 *  (d) DOM-P2-18 — a prerequisite blocks starting a task; the refusal is explained in English and Arabic; removed again.
 * Fixtures that are not the subject of the test (a recommended decision, a second project) are prepared through the API
 * with the same demo personas; every asserted behaviour goes through the UI. All data is synthetic.
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
const NEWCO_BOARD = 'NewCo Board (Demo)';
const RUN = Date.now().toString(36);

interface Client {
  get: <T = Record<string, unknown>>(path: string) => Promise<T>;
  post: <T = Record<string, unknown>>(path: string, data: unknown) => Promise<T>;
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
    dispose: () => ctx.dispose(),
  };
}

async function asPersona(browser: Browser, persona: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const problems = watchConsole(page);
  await loginAs(page, persona);
  return { page, problems, close: () => ctx.close() };
}

async function dcProjectId(baseURL: string): Promise<string> {
  const c = await client(baseURL, P.pm);
  try {
    const projects = (await c.get<{ items: { id: string; code: string }[] }>('/api/v1/projects?pageSize=100')).items;
    return projects.find((p) => p.code === 'DEMO-DC')!.id;
  } finally {
    await c.dispose();
  }
}

function riyadhNow(): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00+03:00`;
}

/**
 * Fixture (API), phase 1: a change-request budget decision of 1,500,000 SAR — above the DEMO committee limit of 1,000,000 —
 * drafted by the PM and tabled under review in a new steering meeting with attendance recorded and quorum checked.
 */
async function tabledBudgetDecision(baseURL: string, dc: string): Promise<{ id: string; code: string; title: string }> {
  const base = `/api/v1/projects/${dc}`;
  const pm = await client(baseURL, P.pm);
  const sec = await client(baseURL, P.secretary);
  try {
    const committees = (await sec.get<{ items: { id: string; name: string }[] }>(`${base}/committees`)).items;
    const committeeId = committees.find((c) => c.name === STEERING)!.id;
    const title = `E2E — Rehearsal tooling budget above the delegated limit ${RUN} (synthetic)`;
    const d = await pm.post<{ id: string; code: string; version: number }>(`${base}/decisions`, {
      committeeId,
      title,
      decisionTypeKey: 'change_request_budget',
      issue: 'Synthetic E2E issue: rehearsal tooling exceeds the delegated change budget.',
      whyNow: 'Synthetic: needed before the rehearsal window.',
      alternatives: [{ title: 'Approve the budget' }, { title: 'Descope the tooling' }],
      recommendation: 'Recommend approval by the delegating authority.',
      impacts: { financial: '1,500,000 SAR (synthetic)', operational: 'None identified', schedule: 'None identified' },
      amount: { amount: '1500000', currency: 'SAR', unitScale: 1 },
      risks: 'None identified',
      dependencies: 'None identified',
      latestSafeDate: '2026-12-15',
      requiredAuthority: 'Delegating authority (above the DEMO committee limit)',
    });
    // Agenda request by the PM, screened onto the new meeting's agenda by the secretariat (tables the decision there).
    const m = await sec.post<{ id: string; version: number }>(`${base}/committees/${committeeId}/meetings`, { title: `E2E follow-up meeting ${RUN}`, scheduledAt: riyadhNow() });
    const req = await pm.post<{ id: string; version: number }>(`${base}/agenda-requests`, { committeeId, title: `Decision ${d.code}`, kind: 'decision', decisionId: d.id, meetingId: m.id });
    await sec.post(`${base}/agenda-requests/${req.id}/screen`, { expectedVersion: req.version, outcome: 'accept', meetingId: m.id });
    const current = await sec.get<{ version: number }>(`${base}/decisions/${d.id}`);
    let v = (await pm.post<{ version: number }>(`${base}/decisions/${d.id}/submit`, { expectedVersion: current.version })).version;
    v = (await sec.post<{ version: number }>(`${base}/decisions/${d.id}/start-review`, { expectedVersion: v })).version;
    let mv = (await sec.post<{ version: number }>(`${base}/meetings/${m.id}/publish-agenda`, { expectedVersion: m.version })).version;
    mv = (await sec.post<{ version: number }>(`${base}/meetings/${m.id}/packs`, { expectedVersion: mv })).version;
    mv = (await sec.post<{ version: number }>(`${base}/meetings/${m.id}/start`, { expectedVersion: mv })).version;
    const detail = await sec.get<{ memberships: { id: string; displayName: string | null; activeToday: boolean }[] }>(`${base}/committees/${committeeId}`);
    const present = [P.chair, P.sponsor, P.finance, P.legal, P.secretary, P.approver];
    const entries = detail.memberships.filter((s) => s.activeToday && s.displayName && (present as readonly string[]).includes(s.displayName)).map((s) => ({ membershipId: s.id, status: 'present' }));
    await sec.post(`${base}/meetings/${m.id}/attendance`, { entries });
    await sec.post(`${base}/meetings/${m.id}/quorum-check`, { expectedVersion: mv });
    expect(v).toBeGreaterThan(0);
    return { id: d.id, code: d.code, title };
  } finally {
    await pm.dispose();
    await sec.dispose();
  }
}

/** Fixture (API), phase 2: `personas` vote approve (the current round). */
async function castApprovals(baseURL: string, dc: string, decisionId: string, personas: string[]) {
  const base = `/api/v1/projects/${dc}`;
  for (const persona of personas) {
    const voter = await client(baseURL, persona);
    try {
      const { version } = await voter.get<{ version: number }>(`${base}/decisions/${decisionId}`);
      await voter.post(`${base}/decisions/${decisionId}/votes`, { expectedVersion: version, choice: 'approve' });
    } finally {
      await voter.dispose();
    }
  }
}

/**
 * Fixture (API), phase 3: the chair records the outcome — above the committee limit, the server records a RECOMMENDATION
 * pending the external authority (the chair recorded it, so the chair may not record the external approval later).
 */
async function recordRecommendation(baseURL: string, dc: string, decisionId: string) {
  const base = `/api/v1/projects/${dc}`;
  const chair = await client(baseURL, P.chair);
  try {
    const { version } = await chair.get<{ version: number }>(`${base}/decisions/${decisionId}`);
    const out = await chair.post<{ status: string }>(`${base}/decisions/${decisionId}/record-outcome`, { expectedVersion: version });
    expect(out.status, 'the fixture decision is a recommendation (outside the committee limit)').toBe('recommended');
  } finally {
    await chair.dispose();
  }
}

async function confirm(page: Page, name: string) {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name, exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function linkNoteEvidence(page: Page, note: string) {
  const panel = page.locator('[data-testid="evidence-panel"][data-target-type="decision"]');
  await panel.getByTestId('evidence-add').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: 'Note' }).check();
  await dialog.getByLabel(/^Evidence note/).fill(note);
  await confirm(page, 'Link evidence');
  await expect(panel.getByTestId('evidence-link').filter({ hasText: note })).toBeVisible();
}

async function verifyEvidence(page: Page, note: string) {
  const link = page.locator('[data-testid="evidence-panel"][data-target-type="decision"]').getByTestId('evidence-link').filter({ hasText: note });
  await link.getByTestId('evidence-verify').click();
  await confirm(page, 'Verify');
  await expect(link.getByTestId('evidence-verify')).toHaveCount(0);
}

test.describe('P2 web follow-ups of the domain review (DOM-P2-03, -12, -17, -18)', () => {
  test('(a) recusals on behalf; external approval rests on evidence verified by a second person; a change above the delegated limit is approved on that final decision', async ({ browser, baseURL }) => {
    test.setTimeout(480_000);
    const dc = await dcProjectId(baseURL!);
    const decision = await tabledBudgetDecision(baseURL!, dc);
    const decisionUrl = `/projects/${dc}/committee/decisions/${decision.id}`;
    const noteA = `E2E synthetic record A of the delegating authority's decision ${RUN}`;
    const noteB = `E2E synthetic record B of the delegating authority's decision ${RUN}`;

    const sec = await asPersona(browser, P.secretary);
    const pm = await asPersona(browser, P.pm);
    const legal = await asPersona(browser, P.legal);
    const sponsor = await asPersona(browser, P.sponsor);
    try {
      // --- DOM-P2-06: the secretariat records a recusal on behalf of Legal before any vote; the recorder is shown.
      await sec.page.goto(decisionUrl);
      await expect(sec.page.getByTestId('decision-status')).toContainText('Under review');
      await sec.page.locator('[data-command="recuseOnBehalf"]').click();
      let dialog = sec.page.getByRole('dialog');
      await dialog.getByTestId('recuse-member').selectOption({ label: P.legal });
      await dialog.getByLabel(/^Reason/).fill('Synthetic E2E: declared interest in the tooling vendor');
      await confirm(sec.page, 'Record recusal on behalf');
      const recusal = sec.page.getByTestId('recusal').filter({ hasText: P.legal });
      await expect(recusal).toHaveAttribute('data-on-behalf', 'true');
      await expect(recusal).toContainText('Recorded on behalf');
      await expect(recusal.getByTestId('recusal-recorder')).toContainText('Recorded by you');
      await pm.page.goto(decisionUrl);
      await expect(pm.page.getByTestId('recusal').filter({ hasText: P.legal }).getByTestId('recusal-recorder')).toContainText(`Recorded by ${P.secretary}`);

      // --- Votes are cast (fixture); a recusal on behalf of a member who already voted is refused and explained.
      await castApprovals(baseURL!, dc, decision.id, [P.chair, P.sponsor, P.finance]);
      await sec.page.reload();
      await sec.page.locator('[data-command="recuseOnBehalf"]').click();
      dialog = sec.page.getByRole('dialog');
      await dialog.getByTestId('recuse-member').selectOption({ label: P.finance });
      await dialog.getByLabel(/^Reason/).fill('Synthetic E2E: late declaration');
      await dialog.getByRole('button', { name: 'Record recusal on behalf', exact: true }).click();
      await expect(dialog.getByTestId('refusal-explanation')).toHaveAttribute('data-code', 'governance.recusal.after_vote');
      await expect(dialog.getByTestId('refusal-explanation')).toContainText('already voted in round 1');
      await expect(dialog.getByTestId('refusal-explanation')).toContainText('Defer the decision, resume it to open a new voting round');
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(sec.page.getByTestId('recusal').filter({ hasText: P.finance })).toHaveCount(0);
      await recordRecommendation(baseURL!, dc, decision.id);

      // --- The recommendation cannot be recorded without verified evidence: the dialog explains the path.
      await sec.page.goto(decisionUrl);
      await expect(sec.page.getByTestId('decision-status')).toContainText('Recommended');
      await expect(sec.page.getByTestId('recommended-callout')).toContainText('verified by a second person');
      await sec.page.locator('[data-command="external"]').click();
      dialog = sec.page.getByRole('dialog');
      await dialog.getByLabel(/^Reference/).fill(`E2E-SYNTHETIC-DELEGATING-AUTHORITY-${RUN}`);
      await expect(dialog.getByTestId('external-evidence-none')).toContainText('No verified evidence on this decision yet.');
      await expect(dialog.getByTestId('external-evidence-none')).toContainText('Ask another person');
      await expect(dialog.getByRole('button', { name: 'Record external decision', exact: true })).toBeDisabled();
      await dialog.getByRole('button', { name: 'Cancel' }).click();

      // --- The PM links two synthetic evidence notes on the decision (unverified).
      await pm.page.reload();
      await linkNoteEvidence(pm.page, noteA);
      await linkNoteEvidence(pm.page, noteB);
      await sec.page.reload();
      await sec.page.locator('[data-command="external"]').click();
      await expect(sec.page.getByRole('dialog').getByTestId('external-evidence-awaiting')).toContainText('Evidence awaiting verification by a second person: 2.');
      await sec.page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

      // --- A is verified by the secretary (who will record), B by Legal.
      await verifyEvidence(sec.page, noteA);
      await legal.page.goto(decisionUrl);
      await verifyEvidence(legal.page, noteB);
      // Legal cannot record external decisions: the command is not offered.
      await expect(legal.page.locator('[data-command="external"]')).toHaveCount(0);

      // --- The secretary records the external decision: A (verified by them) cannot be chosen, B can.
      await sec.page.reload();
      await sec.page.locator('[data-command="external"]').click();
      dialog = sec.page.getByRole('dialog');
      const optionA = dialog.getByTestId('external-evidence-option').filter({ hasText: noteA });
      const optionB = dialog.getByTestId('external-evidence-option').filter({ hasText: noteB });
      await expect(optionA.getByRole('radio')).toBeDisabled();
      await expect(optionA.getByTestId('external-evidence-mine')).toContainText('You verified this evidence');
      await expect(optionB.getByRole('radio')).toBeEnabled();
      await dialog.getByLabel(/^Reference/).fill(`E2E-SYNTHETIC-DELEGATING-AUTHORITY-${RUN}`);
      await expect(dialog.getByRole('button', { name: 'Record external decision', exact: true })).toBeDisabled();
      await optionB.getByRole('radio').check();
      await sec.page.screenshot({ path: join(SHOTS, 'p2w-external-approval-evidence-en.png') });
      await confirm(sec.page, 'Record external decision');
      await expect(sec.page.getByTestId('decision-status')).toContainText('Approved');
      await expect(sec.page.getByTestId('external-reference')).toContainText(`E2E-SYNTHETIC-DELEGATING-AUTHORITY-${RUN}`);
      await expect(sec.page.getByTestId('external-evidence-fact')).toBeVisible();
      await expect(sec.page.getByTestId('gov-history')).toContainText('Recorded the external');

      // --- Change control: the PM raises a change whose cost impact is stated in text only.
      await pm.page.goto(`/projects/${dc}/raid?tab=changes`);
      await pm.page.getByTestId('cr-create').click();
      const form = pm.page.getByTestId('cr-form');
      const crTitle = `E2E rehearsal tooling change ${RUN} (synthetic)`;
      await form.getByLabel(/^Title/).fill(crTitle);
      await form.getByLabel(/^Rationale/).fill('Synthetic E2E rationale: rehearsal tooling is required.');
      await form.getByRole('textbox', { name: /^Cost/ }).fill('Synthetic: tooling licences (stated in text only)');
      await pm.page.getByTestId('cr-form-submit').click();
      await expect(pm.page.getByRole('dialog')).toBeHidden();
      await pm.page.getByTestId('cr-table').getByRole('link', { name: crTitle }).click();
      await pm.page.waitForURL(/\/raid\/changes\/[0-9a-f-]{36}$/);
      const crUrl = new URL(pm.page.url()).pathname;
      await expect(pm.page.getByTestId('cr-cost-impact-fact')).toContainText('Described in text only');
      await pm.page.locator('[data-command="submit"]').click();
      await confirm(pm.page, 'Submit');
      await pm.page.locator('[data-command="start_review"]').click();
      await confirm(pm.page, 'Start review');

      // --- The sponsor cannot approve a text-only cost impact (translated refusal).
      await sponsor.page.goto(crUrl);
      await sponsor.page.locator('[data-command="approve"]').click();
      dialog = sponsor.page.getByRole('dialog');
      await expect(dialog).toContainText('The cost impact is stated in text only');
      await dialog.getByRole('button', { name: 'Approve change', exact: true }).click();
      await expect(dialog.getByTestId('refusal-explanation')).toHaveAttribute('data-code', 'change_control.amount_unquantified');
      await expect(dialog.getByTestId('refusal-explanation')).toContainText('Record it as an amount with currency and unit');
      await dialog.getByRole('button', { name: 'Cancel' }).click();

      // --- The PM records the cost impact as money in the impact assessment.
      await pm.page.getByTestId('cr-assess-open').click();
      const assess = pm.page.getByTestId('cr-assess');
      await expect(assess.getByTestId('cr-cost-text-only')).toBeVisible();
      await assess.getByTestId('cr-cost-impact-amount').fill('1500000');
      await expect(assess.getByTestId('cr-cost-impact-currency')).toHaveValue('SAR');
      await expect(assess.getByTestId('cr-cost-text-only')).toHaveCount(0);
      await pm.page.getByTestId('cr-assess-submit').click();
      await expect(pm.page.getByRole('dialog')).toBeHidden();
      await expect(pm.page.getByTestId('cr-cost-impact-value')).toContainText('1,500,000 SAR');

      // --- Above the DEMO limit without a decision: refused, the translated explanation names the body to escalate to.
      await sponsor.page.reload();
      await sponsor.page.locator('[data-command="approve"]').click();
      dialog = sponsor.page.getByRole('dialog');
      await expect(dialog).toContainText('Budget impact compared with the delegated limit: 1,500,000 SAR.');
      await dialog.getByRole('button', { name: 'Approve change', exact: true }).click();
      const refusal = dialog.getByTestId('refusal-explanation');
      await expect(refusal).toHaveAttribute('data-code', 'change_control.outside_delegated_authority');
      await expect(refusal).toContainText('outside your delegated authority');
      await expect(refusal).toContainText('Delegating authority — to be confirmed');
      // --- Approved on the final decision recorded above (in the same dialog).
      await dialog.getByTestId('approval-decision-select').selectOption(decision.id);
      await expect(dialog.getByTestId('approval-decision-selected')).toContainText('1,500,000 SAR');
      await sponsor.page.screenshot({ path: join(SHOTS, 'p2w-change-approval-decision-en.png') });
      await dialog.getByRole('button', { name: 'Approve change', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(sponsor.page.getByTestId('cr-decision-link')).toHaveAttribute('href', decisionUrl);
      await expect(sponsor.page.getByTestId('cr-cost-impact-value')).toContainText('1,500,000 SAR');

      for (const who of [sec, pm, legal, sponsor]) expect(who.problems(), who.problems().join('\n')).toEqual([]);
    } finally {
      await sec.close();
      await pm.close();
      await legal.close();
      await sponsor.close();
    }
  });

  test('(b) a loaded authority matrix needs an approval document and stays pending until a second person verifies it', async ({ browser, baseURL }) => {
    test.setTimeout(240_000);
    const dc = await dcProjectId(baseURL!);
    const policy = {
      isDemoPolicy: false,
      quorum: { minVotingMembersPresent: 2, minFractionPresent: 0.5 },
      approvalThreshold: { type: 'simple_majority' },
      tieRule: 'escalate',
      decisionTypes: [
        {
          key: 'e2e_board_matter',
          name: { en: `E2E synthetic board matter ${RUN}`, ar: `مسألة مجلس تجريبية ${RUN}` },
          maxAmount: null,
          currency: 'SAR',
          unitScale: 1,
          withinCommitteeAuthority: false,
          escalateTo: 'Shareholders — to be confirmed',
        },
      ],
      selfApprovalProhibited: true,
      recusedMembersExcludedFromQuorum: true,
    };
    const sec = await asPersona(browser, P.secretary);
    const sponsor = await asPersona(browser, P.sponsor);
    const legal = await asPersona(browser, P.legal);
    try {
      // --- The secretariat drafts a loaded (non-demo) matrix version for the NewCo board.
      await sec.page.goto(`/projects/${dc}/committee`);
      await sec.page.getByTestId('committees-table').getByRole('link', { name: NEWCO_BOARD }).click();
      await sec.page.waitForURL(/\/committee\/committees\/[0-9a-f-]{36}$/);
      const boardUrl = new URL(sec.page.url()).pathname;
      await sec.page.getByRole('button', { name: 'Draft new version' }).click();
      await sec.page.getByRole('dialog').getByLabel(/^Policy \(JSON\)/).fill(JSON.stringify(policy));
      await confirm(sec.page, 'Save draft');
      const statuses = sec.page.getByTestId('matrix-status');
      const versionNo = Math.max(...(await statuses.evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-version'))))));

      // --- The sponsor approves: an approval document is required, and the approval is only pending.
      await sponsor.page.goto(boardUrl);
      await sponsor.page.getByRole('button', { name: `Approve matrix version ${versionNo}` }).click();
      const dialog = sponsor.page.getByRole('dialog');
      await expect(dialog).toContainText('does NOT come into force yet');
      await dialog.getByLabel(/^Approval reference/).fill(`E2E-SYNTHETIC-DELEGATION-${RUN}`);
      await expect(dialog.getByRole('button', { name: 'Record approval', exact: true })).toBeDisabled();
      await dialog.getByTestId('approval-document-picker').getByRole('searchbox').fill('charter excerpt');
      await dialog.getByTestId('approval-document-option').filter({ hasText: 'Demo — charter excerpt' }).click();
      await expect(dialog.getByTestId('approval-document-selected')).toContainText('Demo — charter excerpt');
      await confirm(sponsor.page, 'Record approval');
      const row = sponsor.page.locator(`[data-testid="matrix-status"][data-version="${versionNo}"]`);
      await expect(row).toContainText('Approved — awaiting verification');
      await expect(sponsor.page.getByTestId('matrix-pending-verification')).toContainText(`Version ${versionNo} has a recorded approval awaiting verification`);
      await expect(sponsor.page.getByRole('button', { name: `Approve matrix version ${versionNo}` })).toHaveCount(0);

      // --- The drafter cannot verify it (shown, and the server would refuse).
      await sec.page.reload();
      await expect(sec.page.getByTestId('matrix-verify-blocked')).toContainText('You drafted this version');
      await expect(sec.page.getByRole('button', { name: `Verify the approval of matrix version ${versionNo}` })).toHaveCount(0);

      // --- Legal (not drafter, approver or uploader) verifies: the version comes into force.
      await legal.page.goto(boardUrl);
      await legal.page.getByRole('button', { name: `Verify the approval of matrix version ${versionNo}` }).click();
      const verify = legal.page.getByRole('dialog');
      await expect(verify.getByTestId('matrix-approval-document')).toBeVisible();
      await verify.getByRole('radio', { name: /^Accept/ }).check();
      await legal.page.screenshot({ path: join(SHOTS, 'p2w-matrix-verify-en.png') });
      await confirm(legal.page, 'Accept and bring into force');
      const lrow = legal.page.locator(`[data-testid="matrix-status"][data-version="${versionNo}"]`);
      await expect(lrow).toContainText('Approved');
      await expect(lrow).toContainText('Approval verified');
      await expect(legal.page.getByTestId('matrix-panel')).toContainText(`Version ${versionNo}`);
      await expect(legal.page.getByTestId('matrix-pending-verification')).toHaveCount(0);
      for (const who of [sec, sponsor, legal]) expect(who.problems(), who.problems().join('\n')).toEqual([]);
    } finally {
      await sec.close();
      await sponsor.close();
      await legal.close();
    }
  });

  test('(c) cross-project dependency: both ends visible to readers of both projects, nothing to others, closed with a reason', async ({ browser, baseURL }) => {
    test.setTimeout(240_000);
    const dc = await dcProjectId(baseURL!);
    // Fixture (API): a NON-demo project whose PM is the Demo Project Manager (so the PM can read both projects).
    const admin = await client(baseURL!, PERSONAS.portfolioAdmin);
    let otherId: string;
    const code = `XP-${RUN.toUpperCase()}`;
    try {
      const users = (await admin.get<{ items: { id: string; displayName: string }[] }>('/api/v1/auth/demo-users')).items;
      const templates = (await admin.get<{ items: { id: string; templateKey: string }[] }>('/api/v1/templates')).items;
      const created = await admin.post<{ id: string }>('/api/v1/projects', {
        templateVersionId: templates.find((t) => t.templateKey === 'general-transformation')!.id,
        code,
        name: `${code} cross-project control (test)`,
        projectManagerUserId: users.find((u) => u.displayName === P.pm)!.id,
      });
      otherId = created.id;
    } finally {
      await admin.dispose();
    }
    const pmApi = await client(baseURL!, P.pm);
    const milestones = (await pmApi.get<{ items: { id: string; code: string }[] }>(`/api/v1/projects/${otherId}/milestones?pageSize=5`)).items;
    await pmApi.dispose();
    expect(milestones.length, 'the template gives the new project milestones').toBeGreaterThan(0);
    const target = milestones[0]!;
    const description = `E2E: DEMO-DC needs ${target.code} of ${code} (synthetic)`;

    const pm = await asPersona(browser, P.pm);
    const sponsor = await asPersona(browser, P.sponsor);
    try {
      await pm.page.goto(`/projects/${dc}/plan?tab=crossproject`);
      await expect(pm.page.getByTestId('xproj-tab')).toBeVisible();
      await pm.page.getByTestId('xproj-create').click();
      const form = pm.page.getByTestId('xproj-form');
      await form.getByTestId('xproj-other-project').selectOption({ label: `${code} — ${code} cross-project control (test)` });
      await form.getByTestId('xproj-other-type').selectOption('milestone');
      await form.getByTestId('xproj-other-item').selectOption(target.id);
      await form.getByLabel(/^Description/).fill(description);
      await form.getByLabel(/^Needed by/).fill('2026-09-01');
      await pm.page.getByTestId('xproj-form-submit').click();
      await expect(pm.page.getByRole('dialog')).toBeHidden();
      const outgoing = pm.page.getByTestId('xproj-outgoing').getByRole('row').filter({ hasText: description });
      await expect(outgoing).toContainText(code);
      await expect(outgoing).toContainText(target.code);
      await expect(outgoing).toContainText('At risk (schedule-based)');
      await pm.page.screenshot({ path: join(SHOTS, 'p2w-cross-project-en.png'), fullPage: true });

      // --- The other project sees it as incoming (the PM reads both).
      await pm.page.goto(`/projects/${otherId}/plan?tab=crossproject`);
      const incoming = pm.page.getByTestId('xproj-incoming').getByRole('row').filter({ hasText: description });
      await expect(incoming).toContainText('DEMO-DC');
      await expect(incoming).toContainText(target.code);

      // --- The sponsor reads DEMO-DC only: nothing about the other project is shown.
      await sponsor.page.goto(`/projects/${dc}/plan?tab=crossproject`);
      await expect(sponsor.page.getByTestId('xproj-tab')).toBeVisible();
      await expect(sponsor.page.getByTestId('xproj-outgoing')).toContainText('No dependencies on other projects that you can see.');
      await expect(sponsor.page.getByText(code)).toHaveCount(0);
      await expect(sponsor.page.getByTestId('xproj-create')).toHaveCount(0);

      // --- Closed from the dependent project, with a reason.
      await pm.page.goto(`/projects/${dc}/plan?tab=crossproject`);
      const row = pm.page.getByTestId('xproj-outgoing').getByRole('row').filter({ hasText: description });
      await row.getByTestId('xproj-close').click();
      await pm.page.getByRole('dialog').getByLabel(/^Reason/).fill('Synthetic E2E: dependency no longer needed');
      await confirm(pm.page, 'Close dependency');
      await expect(row).toContainText('Closed');
      await expect(row).toContainText('Synthetic E2E: dependency no longer needed');
      for (const who of [pm, sponsor]) expect(who.problems(), who.problems().join('\n')).toEqual([]);
    } finally {
      await pm.close();
      await sponsor.close();
    }
  });

  test('(d) a prerequisite blocks starting a task; the refusal is explained in English and Arabic; the prerequisite is removed', async ({ browser, baseURL }) => {
    test.setTimeout(180_000);
    const dc = await dcProjectId(baseURL!);
    const api = await client(baseURL!, P.pm);
    const tasks = (await api.get<{ items: { id: string; wbsCode: string; allowedCommands: string[] }[] }>(`/api/v1/projects/${dc}/tasks?status=not_started&pageSize=100&sort=-updatedAt`)).items;
    const g7 = (await api.get<{ items: { id: string; key: string }[] }>(`/api/v1/projects/${dc}/gates`)).items.find((g) => g.key === 'G7')!;
    await api.dispose();
    const task = tasks.find((x) => x.allowedCommands.includes('start'));
    expect(task, 'a not-started task that may be started').toBeTruthy();

    const pm = await asPersona(browser, P.pm);
    try {
      await pm.page.goto(`/projects/${dc}/plan/tasks/${task!.id}`);
      const panel = pm.page.getByTestId('prerequisites');
      await expect(panel).toBeVisible();
      await pm.page.getByTestId('prerequisite-add').click();
      const form = pm.page.getByTestId('prerequisite-form');
      await form.getByTestId('prerequisite-type').selectOption('gate');
      await form.getByTestId('prerequisite-record').selectOption(g7.id);
      await pm.page.getByTestId('prerequisite-form-submit').click();
      await expect(pm.page.getByRole('dialog')).toBeHidden();
      const item = panel.getByTestId('prerequisite').filter({ hasText: 'G7' });
      await expect(item).toHaveAttribute('data-satisfied', 'false');
      await expect(item).toContainText('Not yet satisfied');
      await expect(pm.page.getByTestId('prerequisites-pending')).toContainText('The task cannot be started until they are satisfied.');

      // --- Start is refused by the server; the explanation is translated.
      await pm.page.locator('[data-command="start"]').click();
      let dialog = pm.page.getByRole('dialog');
      await dialog.getByRole('button', { name: 'Start', exact: true }).click();
      await expect(dialog.getByTestId('refusal-explanation')).toHaveAttribute('data-code', 'planning.prerequisite_pending');
      await expect(dialog.getByTestId('refusal-explanation')).toContainText('Blocked by prerequisites not yet satisfied: 1');
      await dialog.getByRole('button', { name: 'Cancel' }).click();

      // --- Arabic (RTL): the same refusal in Arabic.
      await pm.page.context().addCookies([{ name: 'hub_locale', value: 'ar', url: baseURL! }]);
      await pm.page.reload();
      await expect(pm.page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(pm.page.getByTestId('prerequisite').filter({ hasText: 'G7' })).toContainText('غير مستوفى بعد');
      await pm.page.locator('[data-command="start"]').click();
      dialog = pm.page.getByRole('dialog');
      await dialog.getByRole('button', { name: 'بدء', exact: true }).click();
      await expect(dialog.getByTestId('refusal-explanation')).toContainText('محجوب بمتطلبات مسبقة لم تُستوفَ بعد: 1');
      await pm.page.screenshot({ path: join(SHOTS, 'p2w-prerequisite-refusal-ar.png') });
      await dialog.locator('button[data-dialog-close]').click();
      await pm.page.context().addCookies([{ name: 'hub_locale', value: 'en', url: baseURL! }]);
      await pm.page.reload();

      // --- Removed again (rerun-safe); the list is empty.
      await pm.page.getByTestId('prerequisite').filter({ hasText: 'G7' }).getByTestId('prerequisite-remove').click();
      await confirm(pm.page, 'Remove prerequisite');
      await expect(pm.page.getByTestId('prerequisite').filter({ hasText: 'G7' })).toHaveCount(0);
      expect(pm.problems(), pm.problems().join('\n')).toEqual([]);
    } finally {
      await pm.close();
    }
  });
});
