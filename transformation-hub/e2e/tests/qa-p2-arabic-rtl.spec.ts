import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PERSONAS, apiSessionAs, loginAs, watchConsole } from './helpers';
import { checkArabic, checkDialogA11y, englishProblems, watchBilingual } from './qa-rtl-detector';

/**
 * Independent QA — P2 gate review (docs/reviews/P2-qa-review.md §5): the P2 screens and the dialogs added by the P2 web
 * follow-ups and DOM-P2-16, in Arabic (RTL). Requirement IDs: REQ-UX-001, REQ-UX-002, REQ-UX-007, REQ-UX-008, REQ-UX-015,
 * REQ-UX-016, REQ-UX-018, REQ-LCY-010, REQ-GOV-023, REQ-PLN-013, REQ-ENT-010, REQ-PLN-006.
 *
 * For each screen / open dialog, in Arabic: <html lang="ar" dir="rtl">; no English UI catalogue message and no English half
 * of a bilingual API field is visible (qa-rtl-detector.ts); the remaining Latin-letter texts are printed and attached for
 * manual classification. Dialogs: accessible name, focus inside, Escape closes. No command is submitted except where a
 * server refusal is the subject (change-request approval above the delegated limit → refused, nothing changes).
 * The language is chosen with the `hub_locale` cookie of the browser context (no persona's saved language is changed).
 * Fixtures (API, synthetic): a fresh DC project whose G0 cycle the secretary starts (so its reviewer, the PM, sees
 * "Review assessment"); a draft (non-demo) matrix version on the NewCo board; a DEMO-DC change request of 1,500,000 SAR
 * (above the DEMO committee limit) under review.
 */
const SHOTS = join(__dirname, '..', 'screenshots', 'qa-p2');
mkdirSync(SHOTS, { recursive: true });
const RUN = Date.now().toString(36).toUpperCase().slice(-5);
const P = {
  pm: PERSONAS.pm,
  secretary: 'Demo Secretary / CPMO',
  sponsor: 'Demo Sponsor',
} as const;

async function api(baseURL: string, persona: string) {
  const ctx: APIRequestContext = await apiSessionAs(baseURL, persona);
  const csrf = (await ctx.storageState()).cookies.find((c) => c.name === 'hub_csrf')?.value ?? '';
  const call = async <T = Record<string, unknown>>(method: 'get' | 'post', path: string, data?: unknown): Promise<T> => {
    const r = method === 'get' ? await ctx.get(path) : await ctx.post(path, { data, headers: { 'x-csrf-token': csrf } });
    expect(r.ok(), `${method.toUpperCase()} ${path} (${persona}) → ${r.status()} ${await r.text()}`).toBeTruthy();
    return r.json();
  };
  return { get: <T = Record<string, unknown>>(p: string) => call<T>('get', p), post: <T = Record<string, unknown>>(p: string, d: unknown) => call<T>('post', p, d), dispose: () => ctx.dispose() };
}

async function arabic(page: Page, baseURL: string, persona: string) {
  await loginAs(page, persona);
  await page.context().addCookies([{ name: 'hub_locale', value: 'ar', url: baseURL }]);
}

async function closeWithEscape(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
}

test.describe.configure({ mode: 'serial' });

test.describe('QA P2 — Arabic/RTL: P2 screens and the P2 follow-up / DOM-P2-16 dialogs show no untranslated UI or bilingual server strings [REQ-UX-001, REQ-UX-007, REQ-UX-015, REQ-UX-018, REQ-LCY-010]', () => {
  const ids = { dc: '', fresh: '', g0: '', board: '', crId: '', taskId: '', recommendedId: '', steering: '', dcG1: '' };

  test.beforeAll(async ({ baseURL }) => {
    test.setTimeout(180_000);
    const admin = await api(baseURL!, PERSONAS.portfolioAdmin);
    const users = (await admin.get<{ items: { id: string; displayName: string }[] }>('/api/v1/auth/demo-users')).items;
    const uid = (name: string) => users.find((u) => u.displayName === name)!.id;
    const templates = (await admin.get<{ items: { id: string; templateKey: string }[] }>('/api/v1/templates')).items;
    const created = await admin.post<{ id: string }>('/api/v1/projects', {
      templateVersionId: templates.find((t) => t.templateKey === 'dc-carveout')!.id,
      code: `QA-P2AR-${RUN}`,
      name: `QA P2 Arabic probe ${RUN} (synthetic)`,
      classification: 'internal',
      projectManagerUserId: uid(P.pm),
    });
    ids.fresh = created.id;
    await admin.post(`/api/v1/projects/${ids.fresh}/members`, { userId: uid(P.secretary), role: 'secretary_cpmo', reason: 'QA P2 Arabic probe' });
    await admin.dispose();

    const sec = await api(baseURL!, P.secretary);
    const gates = (await sec.get<{ items: { id: string; key: string; assessment: { version: number } }[] }>(`/api/v1/projects/${ids.fresh}/gates`)).items;
    const g0 = gates.find((g) => g.key === 'G0')!;
    ids.g0 = g0.id;
    await sec.post(`/api/v1/projects/${ids.fresh}/gates/${g0.id}/assessment/start`, { expectedVersion: g0.assessment.version });
    const projects = (await sec.get<{ items: { id: string; code: string }[] }>('/api/v1/projects?pageSize=100')).items;
    ids.dc = projects.find((p) => p.code === 'DEMO-DC')!.id;
    const committees = (await sec.get<{ items: { id: string; name: string }[] }>(`/api/v1/projects/${ids.dc}/committees`)).items;
    ids.board = committees.find((c) => c.name === 'NewCo Board (Demo)')!.id;
    ids.steering = committees.find((c) => c.name === 'DC Carve-out & JV Steering Committee (Demo)')!.id;
    ids.dcG1 = (await sec.get<{ items: { id: string; key: string }[] }>(`/api/v1/projects/${ids.dc}/gates`)).items.find((g) => g.key === 'G1')!.id;
    await sec.post(`/api/v1/projects/${ids.dc}/committees/${ids.board}/authority-matrix-versions`, {
      policy: {
        isDemoPolicy: false,
        quorum: { minVotingMembersPresent: 2, minFractionPresent: 0.5 },
        approvalThreshold: { type: 'simple_majority' },
        tieRule: 'escalate',
        decisionTypes: [{ key: 'qa_board_matter', name: { en: `QA synthetic board matter ${RUN}`, ar: `مسألة مجلس تجريبية ${RUN}` }, maxAmount: null, currency: 'SAR', unitScale: 1, withinCommitteeAuthority: false, escalateTo: 'Shareholders — to be confirmed' }],
        selfApprovalProhibited: true,
        recusedMembersExcludedFromQuorum: true,
      },
      effectiveFrom: '2026-01-01',
    });
    const recommended = (await sec.get<{ items: { id: string; status: string }[] }>(`/api/v1/projects/${ids.dc}/decisions?status=recommended&pageSize=10`)).items;
    ids.recommendedId = recommended[0]?.id ?? '';
    await sec.dispose();

    const pm = await api(baseURL!, P.pm);
    const cr = await pm.post<{ id: string }>(`/api/v1/projects/${ids.dc}/change-requests`, {
      title: `QA P2 Arabic probe change ${RUN} (synthetic)`,
      rationale: 'Synthetic QA probe: approval above the delegated limit is refused.',
      alternatives: ['Do nothing'],
      impacts: { scope: 'Synthetic scope' },
      costImpact: { amount: '1500000', currency: 'SAR', unitScale: 1 },
    });
    ids.crId = cr.id;
    await pm.post(`/api/v1/projects/${ids.dc}/change-requests/${cr.id}/submit`, { expectedVersion: 1 });
    await pm.post(`/api/v1/projects/${ids.dc}/change-requests/${cr.id}/start-review`, { expectedVersion: 2 });
    const tasks = (await pm.get<{ items: { id: string; allowedCommands: string[] }[] }>(`/api/v1/projects/${ids.dc}/tasks?status=not_started&pageSize=100`)).items;
    ids.taskId = tasks.find((t) => t.allowedCommands.includes('start'))!.id;
    await pm.dispose();
  });

  // QA-P2-04 (docs/reviews/P2-qa-review.md): these P2 screens show English in Arabic — the task's description and acceptance
  // criteria and its dependency titles (the template has Arabic, the API returns English only), the Health tab's workstream
  // names and server explanations, the Timeline's schedule assumptions, My Work item titles (MyWorkItemDto has no Arabic title),
  // the decision page's authority reason (server text), and English demo-seed decision titles (data; the QA-P1R-05 remainder).
  // Expected to fail at the final assertion until fixed; the problems are printed.
  test.fail('PM (known English remainders, QA-P2-04): decisions list and detail, plan Health and Timeline, task detail page, My Work', async ({ page, baseURL }, testInfo) => {
    test.setTimeout(240_000);
    const bilingual = watchBilingual(page);
    await arabic(page, baseURL!, P.pm);
    const found: string[] = [];
    for (const [name, path] of [
      ['p2-committee-decisions', `/projects/${ids.dc}/committee/decisions`],
      ['p2-plan-health', `/projects/${ids.dc}/plan?tab=health`],
      ['p2-plan-timeline', `/projects/${ids.dc}/plan?tab=timeline`],
      ['p2-task-detail', `/projects/${ids.dc}/plan/tasks/${ids.taskId}`],
      ['p2-my-work', '/inbox'],
      ...(ids.recommendedId ? ([['p2-decision-recommended', `/projects/${ids.dc}/committee/decisions/${ids.recommendedId}`]] as const) : []),
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      found.push(...(await checkArabic(page, testInfo, SHOTS, name, bilingual, { strict: false })));
    }
    expect(found, found.join('\n')).toEqual([]);
  });

  test('PM: cockpit, Committee Hub, gates, gate review dialog, plan (WBS, cross-project + dialog), prerequisites panel + dialog, RAID changes, change request, documents', async ({ page, baseURL }, testInfo) => {
    test.setTimeout(420_000);
    const problems = watchConsole(page);
    const bilingual = watchBilingual(page);
    await arabic(page, baseURL!, P.pm);
    const found: string[] = [];
    const screen = async (name: string, path: string) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      found.push(...(await checkArabic(page, testInfo, SHOTS, name, bilingual, { strict: false })));
    };
    await screen('p2-cockpit', `/projects/${ids.dc}`);
    await screen('p2-committee-hub', `/projects/${ids.dc}/committee`);
    await screen('p2-gates', `/projects/${ids.dc}/gates`);

    // DOM-P2-16: the designated reviewer (PM) of G0, started by the secretary, opens "Review assessment".
    await screen('p2-gate-g0-in-assessment', `/projects/${ids.fresh}/gates/${ids.g0}`);
    await expect(page.getByTestId('gate-review')).toBeVisible();
    await page.getByTestId('gate-action-review').click();
    let dialog = page.getByRole('dialog');
    await checkDialogA11y(page, dialog, 'gate review dialog');
    found.push(...(await checkArabic(page, testInfo, SHOTS, 'p2-gate-review-dialog', bilingual, { scope: dialog, strict: false })));
    await closeWithEscape(page);

    await screen('p2-plan-wbs', `/projects/${ids.dc}/plan`);
    await screen('p2-plan-crossproject', `/projects/${ids.dc}/plan?tab=crossproject`);
    await page.getByTestId('xproj-create').click();
    dialog = page.getByRole('dialog');
    await checkDialogA11y(page, dialog, 'cross-project dependency dialog');
    found.push(...(await checkArabic(page, testInfo, SHOTS, 'p2-crossproject-dialog', bilingual, { scope: dialog, strict: false })));
    await closeWithEscape(page);

    // The task page itself is in the known-remainders test above; here only the prerequisites panel and its dialog (P2 follow-up).
    await page.goto(`/projects/${ids.dc}/plan/tasks/${ids.taskId}`);
    await expect(page.getByTestId('prerequisites')).toBeVisible();
    found.push(...(await checkArabic(page, testInfo, SHOTS, 'p2-prerequisites-panel', bilingual, { scope: page.getByTestId('prerequisites'), strict: false })));
    await page.getByTestId('prerequisite-add').click();
    dialog = page.getByRole('dialog');
    await checkDialogA11y(page, dialog, 'prerequisite dialog');
    found.push(...(await checkArabic(page, testInfo, SHOTS, 'p2-prerequisite-dialog', bilingual, { scope: dialog, strict: false })));
    await closeWithEscape(page);

    await screen('p2-raid-changes', `/projects/${ids.dc}/raid?tab=changes`);
    await screen('p2-change-request-detail', `/projects/${ids.dc}/raid/changes/${ids.crId}`);
    await screen('p2-documents', `/projects/${ids.dc}/documents`);
    expect(problems(), problems().join('\n')).toEqual([]);
    expect(found, found.join('\n')).toEqual([]);
  });

  test('secretary: a recommended decision and its external-approval dialog (verified-evidence picker) in Arabic', async ({ page, baseURL }, testInfo) => {
    test.skip(!ids.recommendedId, 'no recommended decision in the demo sandbox');
    const problems = watchConsole(page);
    const bilingual = watchBilingual(page);
    await arabic(page, baseURL!, P.secretary);
    const found: string[] = [];
    await page.goto(`/projects/${ids.dc}/committee/decisions/${ids.recommendedId}`);
    await expect(page.getByTestId('decision-status')).toBeVisible();
    // The page's authority reason is English server text (known remainder, test above); the P2 follow-up callout is checked here.
    found.push(...(await checkArabic(page, testInfo, SHOTS, 'p2-decision-recommended-callout', bilingual, { scope: page.getByTestId('recommended-callout'), strict: false })));
    await page.locator('[data-command="external"]').click();
    const dialog = page.getByRole('dialog');
    await checkDialogA11y(page, dialog, 'external approval dialog');
    found.push(...(await checkArabic(page, testInfo, SHOTS, 'p2-external-approval-dialog', bilingual, { scope: dialog, strict: false })));
    await closeWithEscape(page);
    expect(problems(), problems().join('\n')).toEqual([]);
    expect(found, found.join('\n')).toEqual([]);
  });

  test('sponsor: change-request approval above the limit is refused with a translated explanation and a decision picker; matrix approval dialog in Arabic', async ({ page, baseURL }, testInfo) => {
    test.setTimeout(240_000);
    const problems = watchConsole(page);
    const bilingual = watchBilingual(page);
    await arabic(page, baseURL!, P.sponsor);
    const found: string[] = [];
    await page.goto(`/projects/${ids.dc}/raid/changes/${ids.crId}`);
    await expect(page.getByTestId('cr-cost-impact-value')).toBeVisible();
    await page.locator('[data-command="approve"]').click();
    let dialog = page.getByRole('dialog');
    await checkDialogA11y(page, dialog, 'change-request approval dialog');
    await dialog.getByRole('button', { name: 'اعتماد التغيير', exact: true }).click();
    const refusal = dialog.getByTestId('refusal-explanation');
    await expect(refusal).toHaveAttribute('data-code', 'change_control.outside_delegated_authority');
    await expect(dialog.getByTestId('approval-decision-select')).toBeVisible();
    found.push(...(await checkArabic(page, testInfo, SHOTS, 'p2-cr-approve-refused-dialog', bilingual, { scope: dialog, strict: false })));
    await closeWithEscape(page);
    // Nothing changed.
    const pm = await api(baseURL!, P.pm);
    expect((await pm.get<{ status: string }>(`/api/v1/projects/${ids.dc}/change-requests/${ids.crId}`)).status).toBe('under_review');
    await pm.dispose();

    await page.goto(`/projects/${ids.dc}/committee/committees/${ids.board}`);
    await expect(page.getByTestId('matrix-panel')).toBeVisible();
    found.push(...(await checkArabic(page, testInfo, SHOTS, 'p2-committee-board', bilingual, { strict: false })));
    await page.getByTestId('matrix-approve').last().click();
    dialog = page.getByRole('dialog');
    await checkDialogA11y(page, dialog, 'matrix approval dialog');
    found.push(...(await checkArabic(page, testInfo, SHOTS, 'p2-matrix-approve-dialog', bilingual, { scope: dialog, strict: false })));
    await closeWithEscape(page);
    expect(problems(), problems().join('\n')).toEqual([]);
    expect(found, found.join('\n')).toEqual([]);
  });

  test('ids of another project: a DEMO-DC gate under the fresh project’s URL, and a DEMO-DC gate for a Project B user, show the restricted state and nothing of the gate (Arabic)', async ({ page, baseURL }, testInfo) => {
    const bilingual = watchBilingual(page);
    // The PM reads both projects: the gate id is bound to its own project, so the other project's URL is "not found".
    await arabic(page, baseURL!, P.pm);
    await page.goto(`/projects/${ids.fresh}/gates/${ids.dcG1}`);
    await expect(page.getByTestId('restricted-state')).toBeVisible();
    await expect(page.getByTestId('criterion-row')).toHaveCount(0);
    await checkArabic(page, testInfo, SHOTS, 'p2-gate-foreign-id', bilingual);
    await page.context().clearCookies();
    // A Project B user: nothing of DEMO-DC or its gate is shown (no gate key, no criterion, no project name).
    await arabic(page, baseURL!, PERSONAS.pmB);
    await page.goto(`/projects/${ids.dc}/gates/${ids.dcG1}`);
    await expect(page.getByTestId('restricted-state').first()).toBeVisible();
    await expect(page.getByTestId('criterion-row')).toHaveCount(0);
    await expect(page.getByText('DEMO-DC')).toHaveCount(0);
    await page.screenshot({ path: join(SHOTS, 'ar-p2-gate-other-project-user.png'), fullPage: true });
  });

  test('detector self-check: on the gate screen in English the detector reports English UI messages (the Arabic checks are not vacuous)', async ({ page, baseURL }) => {
    const bilingual = watchBilingual(page);
    await loginAs(page, P.pm);
    await page.context().addCookies([{ name: 'hub_locale', value: 'en', url: baseURL! }]);
    await page.goto(`/projects/${ids.fresh}/gates/${ids.g0}`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    const { problems } = await englishProblems(page, 'gate-en', bilingual);
    expect(problems.some((p) => p.includes('English UI message'))).toBe(true);
  });
});
