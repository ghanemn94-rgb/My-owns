import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PERSONAS, apiSessionAs, loginAs, watchConsole } from './helpers';
import { checkArabic, checkDialogA11y, watchBilingual } from './qa-rtl-detector';

/**
 * Independent QA — P2 gate review (docs/reviews/P2-qa-review.md §6): the DOM-P2-16 gate review step driven through the UI on a
 * fresh DC project's G0 (owner: secretary / CPMO; reviewer: project manager; approver: sponsor) [REQ-LCY-010]:
 *   owner starts → reviewer returns with a note → the owner cannot submit (server refusal shown) → reviewer endorses → the
 *   reviewer (a PM, who may otherwise act as owner) cannot submit its own endorsement → owner submits → neither the reviewer nor
 *   the owner is offered the decision → the approver cannot approve without a final governance decision (refusal shown) →
 *   the approver rejects with a reason → the rejected cycle is shown in English and Arabic.
 * The criteria are met through the API (evidence linked by the PM, accepted by each criterion's designated reviewer) — that part
 * is covered in the UI by p2-gates.spec.ts (b). Synthetic project and data.
 */
const SHOTS = join(__dirname, '..', 'screenshots', 'qa-p2');
mkdirSync(SHOTS, { recursive: true });
const RUN = Date.now().toString(36).toUpperCase().slice(-5);
const P = {
  pm: PERSONAS.pm,
  secretary: 'Demo Secretary / CPMO',
  sponsor: 'Demo Sponsor',
  legal: 'Demo Legal Member',
  approver: 'Demo Functional Approver',
} as const;
const REVIEWER: Record<string, string> = { secretary_cpmo: P.secretary, legal_restricted: P.legal, sponsor: P.sponsor, functional_approver: P.approver, project_manager: P.pm };

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

interface GateView {
  id: string;
  key: string;
  assessment: { status: string; version: number };
  criteria: { id: string; key: string; mandatory: boolean; reviewerRole: string; evidence: { active: number }; assessment: { status: string; version: number } }[];
}

async function asPersona(browser: Browser, persona: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const problems = watchConsole(page);
  await loginAs(page, persona);
  return { page, problems, close: () => ctx.close() };
}

/**
 * Opens a gate command, confirms it, and expects the server's refusal in the dialog (role="alert" with the server's reason);
 * the dialog is then cancelled. Gate refusal codes have no translated explanation in apps/web/src/lib/refusals.ts, so the
 * server detail is what the user reads (QA-P2-04) — recorded, not asserted as a translation.
 */
async function expectRefused(page: Page, action: string, confirm: string, serverReason: RegExp) {
  await page.getByTestId(`gate-action-${action}`).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: confirm, exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText(serverReason);
  console.log(`${action} refused; translated explanation shown: ${(await dialog.getByTestId('refusal-explanation').count()) > 0}`);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
}

test.describe('QA P2 — DOM-P2-16 gate review step in the UI (owner starts and submits, designated reviewer returns / endorses, approver decides) [REQ-LCY-010]', () => {
  test('G0 of a fresh project: start → return → submit refused → endorse → reviewer cannot submit → owner submits → approver rejects with a reason', async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(300_000);
    // --- Fixture (API): a fresh DC project with the G0 roles held by the demo personas.
    const admin = await client(baseURL!, PERSONAS.portfolioAdmin);
    const users = (await admin.get<{ items: { id: string; displayName: string }[] }>('/api/v1/auth/demo-users')).items;
    const uid = (name: string) => users.find((u) => u.displayName === name)!.id;
    const templates = (await admin.get<{ items: { id: string; templateKey: string }[] }>('/api/v1/templates')).items;
    const project = await admin.post<{ id: string }>('/api/v1/projects', {
      templateVersionId: templates.find((t) => t.templateKey === 'dc-carveout')!.id,
      code: `QA-P2GR-${RUN}`,
      name: `QA P2 gate review journey ${RUN} (synthetic)`,
      classification: 'internal',
      projectManagerUserId: uid(P.pm),
    });
    for (const [persona, role] of [[P.secretary, 'secretary_cpmo'], [P.sponsor, 'sponsor'], [P.legal, 'legal_restricted'], [P.approver, 'functional_approver']] as const) {
      await admin.post(`/api/v1/projects/${project.id}/members`, { userId: uid(persona), role, reason: 'QA P2 gate review journey' });
    }
    await admin.dispose();
    const pid = project.id;
    const pmApi = await client(baseURL!, P.pm);
    const g0Id = (await pmApi.get<{ items: { id: string; key: string }[] }>(`/api/v1/projects/${pid}/gates`)).items.find((g) => g.key === 'G0')!.id;
    const gateUrl = `/projects/${pid}/gates/${g0Id}`;
    const gate = () => pmApi.get<GateView>(`/api/v1/projects/${pid}/gates/${g0Id}`);

    const sec = await asPersona(browser, P.secretary);
    const pm = await asPersona(browser, P.pm);
    const sponsor = await asPersona(browser, P.sponsor);
    try {
      // --- The owner (secretary) starts the cycle; the owner is not offered the review.
      await sec.page.goto(gateUrl);
      await sec.page.getByTestId('gate-action-start').click();
      await checkDialogA11y(sec.page, sec.page.getByRole('dialog'), 'gate start dialog');
      await sec.page.getByRole('dialog').getByRole('button', { name: 'Start assessment', exact: true }).click();
      await expect(sec.page.getByRole('dialog')).toBeHidden();
      await expect(sec.page.getByTestId('gate-review')).toHaveAttribute('data-review-state', 'not_reviewed');
      await expect(sec.page.getByTestId('gate-action-review')).toHaveCount(0);
      expect((await gate()).assessment.status).toBe('in_assessment');

      // --- The designated reviewer (PM) returns the assessment with a note.
      await pm.page.goto(gateUrl);
      await pm.page.getByTestId('gate-action-review').click();
      let dialog = pm.page.getByRole('dialog');
      await checkDialogA11y(pm.page, dialog, 'gate review dialog');
      await dialog.getByTestId('review-outcome').selectOption('return');
      await dialog.getByRole('textbox', { name: /Review note/ }).fill('QA: evidence for the mandate criteria is still missing (synthetic)');
      await dialog.getByRole('button', { name: 'Record review', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(pm.page.getByTestId('gate-review')).toHaveAttribute('data-review-state', 'returned');
      await expect(pm.page.getByTestId('gate-review-note')).toContainText('evidence for the mandate criteria is still missing');

      // --- Fixture (API): the mandatory criteria are evidenced by the PM and accepted by their designated reviewers.
      let g = await gate();
      for (const c of g.criteria.filter((x) => x.mandatory && x.assessment.status !== 'met')) {
        const reviewer = REVIEWER[c.reviewerRole];
        expect(reviewer, `a demo persona holds reviewer role ${c.reviewerRole}`).toBeTruthy();
        if (c.evidence.active === 0) await pmApi.post(`/api/v1/projects/${pid}/evidence`, { targetType: 'gate_criterion', targetId: c.id, note: `QA synthetic evidence for ${c.key}` });
        const r = await client(baseURL!, reviewer!);
        await r.post(`/api/v1/projects/${pid}/gates/${g0Id}/criteria/${c.id}/review`, { expectedVersion: c.assessment.version, outcome: 'met', note: 'QA review (synthetic)' });
        await r.dispose();
      }

      // --- The owner cannot submit a returned assessment (server refusal shown in the dialog).
      await sec.page.reload();
      await expectRefused(sec.page, 'markReady', 'Submit for decision', /returned for rework by the gate reviewer/);
      expect((await gate()).assessment.status).toBe('in_assessment');

      // --- The reviewer endorses; as a PM it could act as owner, but not submit what it endorsed (403 shown).
      await pm.page.reload();
      await pm.page.getByTestId('gate-action-review').click();
      dialog = pm.page.getByRole('dialog');
      await dialog.getByTestId('review-outcome').selectOption('endorse');
      await dialog.getByRole('textbox', { name: /Review note/ }).fill('QA: all mandatory G0 criteria evidenced and accepted (synthetic)');
      await dialog.getByRole('button', { name: 'Record review', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(pm.page.getByTestId('gate-review')).toHaveAttribute('data-review-state', 'endorsed');
      await expectRefused(pm.page, 'markReady', 'Submit for decision', /gate reviewer who endorsed the assessment cannot also submit it/);
      expect((await gate()).assessment.status).toBe('in_assessment');

      // --- The owner submits; neither the owner nor the reviewer is offered the decision.
      await sec.page.reload();
      await sec.page.getByTestId('gate-action-markReady').click();
      await sec.page.getByRole('dialog').getByRole('button', { name: 'Submit for decision', exact: true }).click();
      await expect(sec.page.getByRole('dialog')).toBeHidden();
      g = await gate();
      expect(g.assessment.status).toBe('ready_for_decision');
      await expect(sec.page.getByTestId('gate-action-decide')).toHaveCount(0);
      await pm.page.reload();
      await expect(pm.page.getByTestId('gate-action-decide')).toHaveCount(0);

      // --- The approver (sponsor): approval without a final governance decision is refused; a rejection with a reason is recorded.
      await sponsor.page.goto(gateUrl);
      await sponsor.page.getByTestId('gate-action-decide').click();
      dialog = sponsor.page.getByRole('dialog');
      await checkDialogA11y(sponsor.page, dialog, 'gate decision dialog');
      await dialog.getByTestId('decide-outcome').selectOption('approve');
      await dialog.getByRole('textbox', { name: /Decision note/ }).fill('QA: attempt to approve G0 without a governance decision (synthetic)');
      await dialog.getByRole('button', { name: 'Record decision', exact: true }).click();
      await expect(dialog.getByRole('alert')).toBeVisible();
      console.log(`approve without a decision refused: ${(await dialog.getByRole('alert').innerText()).replace(/\s+/g, ' ')}`);
      expect((await gate()).assessment.status).toBe('ready_for_decision');
      await dialog.getByTestId('decide-outcome').selectOption('reject');
      await dialog.getByRole('textbox', { name: /Decision note/ }).fill('QA: G0 rejected — mandate evidence to be reworked (synthetic)');
      await dialog.getByRole('button', { name: 'Record decision', exact: true }).click();
      await expect(dialog).toBeHidden();
      expect((await gate()).assessment.status).toBe('rejected');
      await expect(sponsor.page.locator('[data-status="rejected"]').first()).toBeVisible();
      await sponsor.page.screenshot({ path: join(SHOTS, 'en-p2-gate-review-journey-rejected.png'), fullPage: true });

      // --- The decided cycle in Arabic (RTL): no untranslated UI or bilingual server strings.
      const bilingual = watchBilingual(sponsor.page);
      await sponsor.page.context().addCookies([{ name: 'hub_locale', value: 'ar', url: baseURL! }]);
      await sponsor.page.goto(gateUrl);
      await expect(sponsor.page.getByTestId('gate-review')).toBeVisible();
      await checkArabic(sponsor.page, testInfo, SHOTS, 'p2-gate-review-journey-rejected', bilingual);

      for (const who of [sec, pm, sponsor]) expect(who.problems(), who.problems().join('\n')).toEqual([]);
    } finally {
      await pmApi.dispose();
      await sec.close();
      await pm.close();
      await sponsor.close();
    }
  });
});
