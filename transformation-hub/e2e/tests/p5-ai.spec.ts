import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PERSONAS, apiSessionAs, loginAs, setSavedLocale, watchConsole } from './helpers';

/**
 * P5 — AI PM Center (spec §10 screen 14, spec §12; REQ-AI-004/009/010/017/019/020/021/023/024/029/030/031/033/034,
 * REQ-UX-017; AT-18 approval binding, AT-19 kill switch) against the real API, worker and demo seed.
 *
 * The only provider in this environment is the local MOCK: every AI output is asserted to carry the "Simulated" label, and
 * the real model endpoints are asserted to read "Not configured" (never "Connected").
 *
 * Behaviour under test is driven and observed through the UI. Fixtures that are not the behaviour under test are prepared
 * through the APIs as the real demo personas (an overdue task in Project B so questions have something to cite; the
 * pre-conditions "Project B AI Off", "DEMO-DC Advisory, no emergency stop"; a pending DEMO-DC proposal when the seeded one
 * was already consumed by an earlier run). Re-runnable against the same database.
 *
 *  1. Mode Off (Project B, no settings row): asking is unavailable with the reason; a role that cannot read the status gets
 *     the server's refusal (ai.disabled) translated.
 *  2. An administrator (Portfolio Admin) enables Advisory with the Simulated mock through the settings form → a question is
 *     answered with ACL-filtered citations that open their records, the Simulated label and the run id; the run record
 *     lists the tools used. Arabic (RTL) and 390 px.
 *  3. DEMO-DC proposal: the requester (PM) cannot approve (UI + server); Advisory mode blocks execution; the sponsor
 *     switches to Assisted; the Secretary's approval of a stale version (the PM revised it meanwhile) is refused by the
 *     server and translated; after "reload and review" the Secretary approves exactly the version shown and the worker
 *     executes it.
 *  4. Emergency stop: Project B's PM subscribes to a briefing (UI) → the worker's scheduled briefing prepares a proposal;
 *     the PM activates the stop → asking is blocked and the pending proposal is cancelled; the PM cannot release it; the
 *     Portfolio Admin releases it and asking works again. On DEMO-DC the activator (Sponsor) is shown that someone else
 *     must release it (separation of duties), and the Portfolio Admin does.
 *  5. A user without AI permissions (Clean Team) gets the restricted state; a contributor cannot open tabs outside their
 *     permissions.
 *  6. Arabic RTL screenshots of the screens and a 390 px view.
 * Screenshots: e2e/screenshots/p5/ai-*.png.
 */
const SHOTS = join(__dirname, '..', 'screenshots', 'p5');
mkdirSync(SHOTS, { recursive: true });
const STAMP = Date.now().toString(36);
const MOBILE = { width: 390, height: 844 } as const;
const shot = (page: Page, name: string) => page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });

async function csrfOf(ctx: APIRequestContext): Promise<string> {
  return (await ctx.storageState()).cookies.find((c) => c.name === 'hub_csrf')?.value ?? '';
}
async function call(ctx: APIRequestContext, method: 'POST' | 'PUT', path: string, data: unknown) {
  const res = await ctx.fetch(path, { method, data, headers: { 'x-csrf-token': await csrfOf(ctx) } });
  return { status: res.status(), body: await res.json().catch(() => null) };
}
async function ok(ctx: APIRequestContext, method: 'POST' | 'PUT', path: string, data: unknown) {
  const r = await call(ctx, method, path, data);
  expect(r.status < 300, `${method} ${path} → HTTP ${r.status} ${JSON.stringify(r.body)}`).toBeTruthy();
  return r.body;
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
async function projectId(ctx: APIRequestContext, code: string): Promise<string> {
  const list = await get(ctx, `/api/v1/projects?pageSize=100&q=${encodeURIComponent(code)}`);
  const p = (list.items as { id: string; code: string }[]).find((x) => x.code === code);
  expect(p, `project ${code}`).toBeTruthy();
  return p!.id;
}
async function userId(ctx: APIRequestContext, persona: string): Promise<string> {
  const users = (await get(ctx, '/api/v1/auth/demo-users')).items as { id: string; displayName: string }[];
  return users.find((u) => u.displayName === persona)!.id;
}

/** Fixture: an overdue task owned by `ownerId` (created by the project's PM) so questions and briefings have a record to cite. */
async function createOverdueTask(pm: APIRequestContext, pid: string, ownerId: string, title: string): Promise<string> {
  const ws = (await get(pm, `/api/v1/projects/${pid}/workstreams`)).items as { id: string }[];
  const t = await ok(pm, 'POST', `/api/v1/projects/${pid}/tasks`, { workstreamId: ws[0]!.id, title, plannedStart: isoDate(-12), plannedFinish: isoDate(-3), accountableUserId: ownerId });
  return t.id as string;
}

/** Polls the API until a pending proposal created after `since` exists (prepared by the worker's scheduled briefing). */
async function waitForNewProposal(ctx: APIRequestContext, pid: string, since: string, timeoutMs = 150_000): Promise<{ id: string; version: number }> {
  let found: { id: string; version: number; createdAt: string } | undefined;
  await expect
    .poll(
      async () => {
        const r = await get(ctx, `/api/v1/projects/${pid}/ai/proposals?status=proposed&pageSize=100`);
        found = (r.items as { id: string; version: number; createdAt: string }[]).find((p) => p.createdAt > since);
        return !!found;
      },
      { timeout: timeoutMs, intervals: [3000] },
    )
    .toBe(true);
  return found!;
}

/** Fixture: settings to a known state (the behaviour under test starts from here). */
async function aiSettings(ctx: APIRequestContext, pid: string) {
  return get(ctx, `/api/v1/projects/${pid}/ai/settings`) as Promise<{ mode: string; provider: string; version: number; monthlyTokenBudget: number; killSwitch: boolean; killSwitchBy: string | null }>;
}
async function releaseIfActive(pid: string, baseURL: string, releasers: string[]) {
  for (const persona of releasers) {
    const ctx = await apiSessionAs(baseURL, persona);
    try {
      const r = await call(ctx, 'POST', `/api/v1/projects/${pid}/ai/killswitch/release`, { reason: 'e2e fixture reset (synthetic)' });
      if (r.status < 300 || r.body?.code === 'ai.kill_switch_not_active') return;
    } finally {
      await ctx.dispose();
    }
  }
}

async function openAs(browser: Browser, persona: string, viewport?: { width: number; height: number }) {
  const ctx = await browser.newContext(viewport ? { viewport } : {});
  const page = await ctx.newPage();
  await loginAs(page, persona);
  return { ctx, page };
}

test.describe.configure({ mode: 'serial' });

test.describe('P5 AI PM Center — modes, cited answers, bound approvals, emergency stop, restricted access', () => {
  let dc = '';
  let pb = '';
  let pbTaskId = '';
  const pbTaskTitle = `E2E overdue follow-up ${STAMP} (synthetic)`;

  test.beforeAll(async ({ baseURL }) => {
    const pm = await apiSessionAs(baseURL!, PERSONAS.pm);
    const pmB = await apiSessionAs(baseURL!, PERSONAS.pmB);
    const admin = await apiSessionAs(baseURL!, PERSONAS.portfolioAdmin);
    const sponsor = await apiSessionAs(baseURL!, PERSONAS.sponsor);
    try {
      dc = await projectId(pm, 'DEMO-DC');
      pb = await projectId(pmB, 'DEMO-TRANSFORM');
      // Project B: as seeded (AI Off, no provider, no budget), no emergency stop, no every-minute briefing left from an
      // earlier run.
      await releaseIfActive(pb, baseURL!, [PERSONAS.portfolioAdmin]);
      const sb = await aiSettings(admin, pb);
      if (sb.mode !== 'off' || sb.provider !== 'off' || sb.monthlyTokenBudget !== 0) {
        await ok(admin, 'PUT', `/api/v1/projects/${pb}/ai/settings`, { expectedVersion: sb.version, mode: 'off', provider: 'off', model: null, monthlyTokenBudget: 0, reason: 'e2e fixture reset (synthetic)' });
      }
      const briefings = (await get(pmB, `/api/v1/projects/${pb}/ai/briefings`)).items as { kind: 'daily' | 'weekly'; cron: string; timezone: string; enabled: boolean }[];
      for (const b of briefings.filter((x) => x.enabled)) await ok(pmB, 'POST', `/api/v1/projects/${pb}/ai/briefings`, { kind: b.kind, cron: b.cron, timezone: b.timezone, enabled: false });
      // DEMO-DC: Advisory (the seeded state), no emergency stop.
      await releaseIfActive(dc, baseURL!, [PERSONAS.sponsor, PERSONAS.portfolioAdmin]);
      const sd = await aiSettings(sponsor, dc);
      if (sd.mode !== 'advisory') await ok(sponsor, 'PUT', `/api/v1/projects/${dc}/ai/settings`, { expectedVersion: sd.version, mode: 'advisory', provider: 'mock', reason: 'e2e fixture reset (synthetic)' });
      // Project B: an overdue task owned by the Project-B contributor (something for questions and briefings to cite).
      pbTaskId = await createOverdueTask(pmB, pb, await userId(pmB, PERSONAS.contributorB), pbTaskTitle);
    } finally {
      await Promise.all([pm.dispose(), pmB.dispose(), admin.dispose(), sponsor.dispose()]);
    }
  });

  test.afterAll(async ({ baseURL }) => {
    // Leave DEMO-DC in its seeded mode (Advisory) for anything that runs later.
    const sponsor = await apiSessionAs(baseURL!, PERSONAS.sponsor);
    try {
      const sd = await aiSettings(sponsor, dc);
      if (sd.mode !== 'advisory') await call(sponsor, 'PUT', `/api/v1/projects/${dc}/ai/settings`, { expectedVersion: sd.version, mode: 'advisory', reason: 'e2e cleanup (synthetic)' });
    } finally {
      await sponsor.dispose();
    }
  });

  test('1. mode Off: asking is unavailable and the reason is stated; the server refusal is translated [REQ-AI-019, REQ-AI-023]', async ({ page, browser }) => {
    const problems = watchConsole(page);
    await loginAs(page, PERSONAS.pmB);
    await page.goto(`/projects/${pb}/ai`);
    await expect(page.getByTestId('ai-tabs')).toBeVisible();
    await expect(page.getByTestId('mode-badge')).toHaveAttribute('data-mode', 'off');
    await expect(page.getByTestId('provider-status')).toHaveAttribute('data-provider-status', 'off');
    // Honest endpoint states: real model endpoints are "Not configured"; nothing is ever "Connected".
    for (const p of ['openai_compatible', 'anthropic']) {
      await expect(page.getByTestId(`endpoint-${p}`).locator('[data-provider-status]')).toHaveAttribute('data-provider-status', 'not_configured');
      await expect(page.getByTestId(`endpoint-${p}`)).toContainText('Not configured');
    }
    await expect(page.locator('#main-content')).not.toContainText(/connected/i);
    await expect(page.getByTestId('health')).toHaveAttribute('data-health', 'off');
    await expect(page.getByTestId('manual-fallback')).toBeVisible();
    await shot(page, 'ai-en-1-overview-mode-off');

    await page.getByTestId('ai-tabs').getByRole('link', { name: 'Ask' }).click();
    const reason = page.getByTestId('ask-unavailable');
    await expect(reason).toBeVisible();
    await expect(reason.locator('[data-reason]')).toHaveAttribute('data-reason', 'off');
    await expect(reason).toContainText('AI is Off for this project');
    await expect(page.getByTestId('ask-question')).toBeDisabled();
    await expect(page.getByTestId('ask-submit')).toBeDisabled();
    await shot(page, 'ai-en-1-ask-unavailable-mode-off');

    // A contributor may ask but cannot read the operational status: the server's refusal is shown, translated.
    const { ctx, page: cp } = await openAs(browser, PERSONAS.contributorB);
    try {
      await cp.goto(`/projects/${pb}/ai/ask`);
      await expect(cp.getByTestId('ask-unavailable')).toHaveCount(0);
      await cp.getByTestId('ask-question').fill('What is overdue?');
      await cp.getByTestId('ask-submit').click();
      const err = cp.getByTestId('ask-error');
      await expect(err).toHaveAttribute('data-code', 'ai.disabled');
      await expect(err).toContainText('AI is Off for this project, so asking is unavailable');
      await expect(cp.getByTestId('ask-result')).toHaveCount(0);
      await shot(cp, 'ai-en-1-ask-refused-by-server');
    } finally {
      await ctx.close();
    }
    expect(problems(), problems().join('\n')).toEqual([]);
  });

  test('2. an administrator enables Advisory (Simulated mock); a question is answered with citations, the Simulated label and the run id [REQ-AI-004, REQ-AI-017, REQ-AI-020, REQ-AI-029]', async ({ page, browser, baseURL }) => {
    const problems = watchConsole(page);
    await loginAs(page, PERSONAS.portfolioAdmin);
    await page.goto(`/projects/${pb}/ai/settings`);
    await expect(page.getByTestId('current-mode')).toHaveAttribute('data-mode', 'off');
    await page.getByTestId('settings-provider').selectOption('mock');
    await page.getByTestId('settings-mode').selectOption('advisory');
    await page.getByTestId('settings-model').fill('mock-benign');
    await page.getByTestId('settings-budget').fill('100000');
    await page.getByTestId('settings-save').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('settings-change')).toHaveCount(4);
    await expect(dialog).toContainText('Authority mode: Off → Advisory');
    await dialog.getByTestId('dialog-reason').fill(`E2E ${STAMP}: enable Advisory with the Simulated mock (synthetic)`);
    await shot(page, 'ai-en-2-settings-enable-review');
    await dialog.getByTestId('dialog-confirm').click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('current-mode')).toHaveAttribute('data-mode', 'advisory');
    await expect(page.getByTestId('current-provider-status')).toHaveAttribute('data-provider-status', 'simulated');

    // The PM of Project B asks.
    const { ctx, page: pm } = await openAs(browser, PERSONAS.pmB);
    const pmProblems = watchConsole(pm);
    const api = await apiSessionAs(baseURL!, PERSONAS.pmB);
    try {
      await pm.goto(`/projects/${pb}/ai/ask`);
      await expect(pm.getByTestId('mode-badge')).toHaveAttribute('data-mode', 'advisory');
      await expect(pm.getByTestId('ask-unavailable')).toHaveCount(0);
      await pm.getByTestId('ask-question').fill('What is overdue and who owns it?');
      await pm.getByTestId('ask-submit').click();
      const result = pm.getByTestId('ask-result');
      await expect(result).toBeVisible({ timeout: 30_000 });
      await expect(result.getByTestId('simulated-badge').first()).toBeVisible();
      await expect(result.getByTestId('simulated-notice')).toContainText('Mock provider — simulated output, not an AI model');
      const runId = (await result.getByTestId('answer-run-id').textContent())!.trim();
      expect(runId).toMatch(/^[0-9a-f-]{36}$/);
      await expect(result.getByTestId('answer-claim').first()).toBeVisible();

      // Citations shown are exactly the ones the API returned for this run (retrieval is ACL-filtered on the server).
      const run = await get(api, `/api/v1/projects/${pb}/ai/runs/${runId}`);
      expect(run.simulated).toBe(true);
      const apiKeys = new Set<string>((run.output.claims as { citations: { type: string; id: string }[] }[]).flatMap((c) => c.citations.map((x) => `${x.type}:${x.id}`)));
      const shown = await result.getByTestId('answer-claims').locator('[data-citation-id]').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-citation-type')}:${e.getAttribute('data-citation-id')}`));
      expect(shown.length).toBeGreaterThan(0);
      for (const k of shown) expect(apiKeys.has(k), `citation ${k} was returned by the API`).toBe(true);
      expect(new Set(shown).size).toBe(apiKeys.size);
      expect(shown).toContain(`task:${pbTaskId}`);
      const ourCitation = result.locator(`[data-citation-id="${pbTaskId}"]`).first();
      await expect(ourCitation).toContainText(pbTaskTitle);
      await expect(ourCitation.getByTestId('demo-badge')).toBeVisible(); // Project B is a demo project
      await expect(result.getByTestId('answer-disclaimer')).toContainText('SIMULATED');
      await shot(pm, 'ai-en-2-answer-with-citations');

      // The citation opens its record.
      await ourCitation.getByTestId('citation-link').click();
      await pm.waitForURL(new RegExp(`/projects/${pb}/plan/tasks/${pbTaskId}$`));
      await expect(pm.getByRole('heading', { level: 1 })).toContainText(pbTaskTitle);

      // The run record: inputs, tools used, outputs, cost, status (append-only).
      await pm.goto(`/projects/${pb}/ai/runs/${runId}`);
      await expect(pm.getByTestId('run-detail')).toHaveAttribute('data-run-id', runId);
      await expect(pm.getByTestId('run-question')).toContainText('What is overdue and who owns it?');
      await expect(pm.getByTestId('run-tools')).toContainText('list_overdue_work');
      await expect(pm.getByTestId('run-tools')).toContainText('search_documents');
      await expect(pm.getByTestId('run-append-only')).toBeVisible();
      await shot(pm, 'ai-en-2-run-detail');
      await pm.goto(`/projects/${pb}/ai/runs`);
      await expect(pm.locator('[data-testid="run-link"]').first()).toBeVisible();

      // Arabic (RTL): the answer is in Arabic, the labels too; citations still open their records.
      await setSavedLocale(pm, 'ar');
      try {
        await pm.goto(`/projects/${pb}/ai/ask`);
        await expect(pm.locator('html')).toHaveAttribute('dir', 'rtl');
        await pm.getByTestId('ask-question').fill('ما المتأخر ومن المالك المسؤول عنه؟');
        await pm.getByTestId('ask-submit').click();
        const ar = pm.getByTestId('ask-result');
        await expect(ar).toBeVisible({ timeout: 30_000 });
        await expect(ar.getByTestId('simulated-badge').first()).toContainText('محاكاة');
        await expect(ar.getByTestId('answer-headline')).toContainText('نتيجة موثقة');
        await expect(ar.locator(`[data-citation-id="${pbTaskId}"]`).first()).toBeVisible();
        await shot(pm, 'ai-ar-2-answer-with-citations');
        await pm.setViewportSize(MOBILE);
        await pm.reload();
        await expect(pm.getByTestId('ai-ask')).toBeVisible();
        await shot(pm, 'ai-ar-390-2-ask');
      } finally {
        await setSavedLocale(pm, 'en');
      }
      expect(pmProblems(), pmProblems().join('\n')).toEqual([]);
    } finally {
      await api.dispose();
      await ctx.close();
    }
    expect(problems(), problems().join('\n')).toEqual([]);
  });

  test('3. proposal: the requester cannot approve; approval binds the version shown; a stale version is refused; an allowed approver approves [REQ-AI-021, REQ-AI-030, AT-18]', async ({ browser, baseURL }) => {
    test.setTimeout(300_000);
    const sec = await apiSessionAs(baseURL!, PERSONAS.secretary);
    const pmApi = await apiSessionAs(baseURL!, PERSONAS.pm);
    let proposalId = '';
    try {
      const pmId = await userId(pmApi, PERSONAS.pm);
      const pending = ((await get(sec, `/api/v1/projects/${dc}/ai/proposals?status=proposed&pageSize=100`)).items as { id: string; requestedBy: string | null; actionType: string }[]).find(
        (p) => p.requestedBy === pmId && p.actionType === 'create_internal_notification',
      );
      if (pending) proposalId = pending.id;
      else {
        // The seeded proposal was consumed by an earlier run: let the worker's scheduled briefing prepare a fresh one.
        const since = new Date().toISOString();
        await createOverdueTask(pmApi, dc, pmId, `E2E overdue follow-up ${STAMP} (synthetic)`);
        await ok(pmApi, 'POST', `/api/v1/projects/${dc}/ai/briefings`, { kind: 'weekly', cron: '* * * * *', timezone: 'Asia/Riyadh', enabled: true });
        try {
          proposalId = (await waitForNewProposal(pmApi, dc, since)).id;
        } finally {
          await ok(pmApi, 'POST', `/api/v1/projects/${dc}/ai/briefings`, { kind: 'weekly', cron: '* * * * *', timezone: 'Asia/Riyadh', enabled: false });
        }
      }
    } finally {
      await sec.dispose();
    }
    const url = `/projects/${dc}/ai/proposals/${proposalId}`;

    // a) The requester (PM): no Approve; the reason is separation of duties. Revise is offered to the requester only.
    const pm = await openAs(browser, PERSONAS.pm);
    const pmProblems = watchConsole(pm.page);
    await pm.page.goto(url);
    await expect(pm.page.getByTestId('proposal-status')).toHaveAttribute('data-status', 'proposed');
    await expect(pm.page.getByTestId('cmd-approve')).toHaveCount(0);
    await expect(pm.page.getByTestId('approve-unavailable')).toHaveAttribute('data-reason', 'selfApproval');
    await expect(pm.page.getByTestId('approve-unavailable')).toContainText('A different authorized person must approve it');
    await expect(pm.page.getByTestId('cmd-revise')).toBeVisible();
    await expect(pm.page.getByTestId('proposal-simulated')).toBeVisible();
    await expect(pm.page.getByTestId('binding-explainer')).toContainText('Approving applies exactly version');
    await shot(pm.page, 'ai-en-3-requester-cannot-approve');
    // …and the server refuses it when the UI is bypassed.
    const v0 = Number(await pm.page.getByTestId('proposal-detail').getAttribute('data-version'));
    const selfApprove = await call(pmApi, 'POST', `/api/v1/projects/${dc}/ai/proposals/${proposalId}/approve`, { expectedVersion: v0 });
    expect(selfApprove.status).toBe(403);
    expect(selfApprove.body.code).toBe('ai.self_approval');

    // b) An allowed approver (Secretary: ai.proposal.approve + notifications.message.send) — Advisory mode blocks execution.
    const secr = await openAs(browser, PERSONAS.secretary);
    const secProblems = watchConsole(secr.page);
    await secr.page.goto(url);
    await expect(secr.page.getByTestId('approve-unavailable')).toHaveAttribute('data-reason', 'mode');
    await expect(secr.page.getByTestId('cmd-approve')).toHaveCount(0);

    // c) The Sponsor (settings administrator) switches DEMO-DC to Assisted.
    const sp = await openAs(browser, PERSONAS.sponsor);
    await sp.page.goto(`/projects/${dc}/ai/settings`);
    await expect(sp.page.getByTestId('current-mode')).toHaveAttribute('data-mode', 'advisory');
    await sp.page.getByTestId('settings-mode').selectOption('assisted');
    await sp.page.getByTestId('settings-save').click();
    const sd = sp.page.getByRole('dialog');
    await expect(sd).toContainText('Authority mode: Advisory → Assisted');
    await sd.getByTestId('dialog-reason').fill(`E2E ${STAMP}: assisted execution for the review (synthetic)`);
    await sd.getByTestId('dialog-confirm').click();
    await expect(sd).toBeHidden();
    await expect(sp.page.getByTestId('current-mode')).toHaveAttribute('data-mode', 'assisted');
    await sp.ctx.close();

    // d) The Secretary reloads: Approve is offered, bound to the version shown.
    await secr.page.reload();
    await expect(secr.page.getByTestId('cmd-approve')).toBeVisible();
    const shownVersion = Number(await secr.page.getByTestId('proposal-detail').getAttribute('data-version'));
    await expect(secr.page.getByTestId('binding-version')).toHaveText(`v${shownVersion}`);

    // e) Meanwhile the requester revises the payload (new hash, new version).
    await pm.page.reload();
    await pm.page.getByTestId('cmd-revise').click();
    const rd = pm.page.getByRole('dialog');
    await rd.getByTestId('revise-body').fill(`Please confirm the plan, owner and forecast — revised by the requester (${STAMP}, synthetic).`);
    await rd.getByTestId('dialog-reason').fill('Clarified the request (synthetic)');
    await rd.getByTestId('dialog-confirm').click();
    await expect(rd).toBeHidden();
    await expect(pm.page.getByTestId('proposal-detail')).toHaveAttribute('data-version', String(shownVersion + 1));
    await expect(pm.page.getByTestId('payload-body')).toContainText('revised by the requester');

    // f) The Secretary approves the page still showing the OLD version → refused by the server as stale, translated.
    await secr.page.getByTestId('cmd-approve').click();
    const ad = secr.page.getByRole('dialog');
    await expect(ad.getByTestId('dialog-based-on')).toContainText(`Bound to proposal version ${shownVersion}`);
    await ad.getByTestId('dialog-confirm').click();
    const err = ad.getByTestId('dialog-error');
    await expect(err).toHaveAttribute('data-code', 'concurrency.version_mismatch');
    await expect(err).toContainText('Stale version');
    await expect(err).toContainText(`it is now version ${shownVersion + 1}`);
    await shot(secr.page, 'ai-en-3-stale-version-refused');
    await err.getByTestId('reload-and-review').click();
    await expect(ad).toBeHidden();
    await expect(secr.page.getByTestId('proposal-detail')).toHaveAttribute('data-version', String(shownVersion + 1));
    await expect(secr.page.getByTestId('payload-body')).toContainText('revised by the requester');

    // g) Approve exactly the version now shown → approved → executed by the worker (in-app notification only).
    await secr.page.getByTestId('cmd-approve').click();
    await expect(ad.getByTestId('dialog-based-on')).toContainText(`Bound to proposal version ${shownVersion + 1}`);
    await ad.getByTestId('dialog-reason').fill(`Reviewed version ${shownVersion + 1} (synthetic)`);
    await ad.getByTestId('dialog-confirm').click();
    await expect(ad).toBeHidden();
    await expect(secr.page.getByTestId('proposal-status')).toHaveAttribute('data-status', 'executed', { timeout: 60_000 });
    await expect(secr.page.getByTestId('approval-row').first()).toHaveAttribute('data-status', 'consumed');
    await expect(secr.page.getByTestId('execution-facts')).toContainText('In-app notification created');
    await shot(secr.page, 'ai-en-3-approved-executed');
    // The requester sees the result; still no Approve.
    await pm.page.reload();
    await expect(pm.page.getByTestId('proposal-status')).toHaveAttribute('data-status', 'executed');
    await expect(pm.page.getByTestId('cmd-approve')).toHaveCount(0);
    expect(pmProblems(), pmProblems().join('\n')).toEqual([]);
    expect(secProblems(), secProblems().join('\n')).toEqual([]);
    await pm.ctx.close();
    await secr.ctx.close();
    await pmApi.dispose();
  });

  test('4. emergency stop: blocks asking and cancels the pending proposal; the activator cannot release; another person releases [REQ-AI-010, REQ-AI-031, AT-19]', async ({ browser, baseURL }) => {
    test.setTimeout(300_000);
    const pmB = await openAs(browser, PERSONAS.pmB);
    const problems = watchConsole(pmB.page);
    const api = await apiSessionAs(baseURL!, PERSONAS.pmB);
    try {
      // A durable briefing subscription (UI) → the worker's scheduled briefing prepares a proposal (fixture wait via API).
      const since = new Date().toISOString();
      await pmB.page.goto(`/projects/${pb}/ai/briefings`);
      await pmB.page.getByTestId('briefing-kind').selectOption('weekly');
      await pmB.page.getByTestId('briefing-cron').fill('* * * * *');
      await pmB.page.getByTestId('briefing-subscribe').click();
      await expect(pmB.page.getByTestId('briefing-toggle-weekly')).toHaveText('Pause');
      // Rules-only detections (no AI involved) include the overdue task and open its record.
      await pmB.page.getByTestId('detections-code').selectOption('task_overdue');
      await expect(pmB.page.getByTestId('detections-table').getByRole('link', { name: pbTaskTitle })).toHaveAttribute('href', `/projects/${pb}/plan/tasks/${pbTaskId}`);
      const proposal = await waitForNewProposal(api, pb, since);
      await pmB.page.reload();
      await pmB.page.getByTestId('briefing-toggle-weekly').click();
      await expect(pmB.page.getByTestId('briefing-toggle-weekly')).toHaveText('Resume');
      await shot(pmB.page, 'ai-en-4-briefings-and-detections');

      // The PM activates the emergency stop (reason + confirmation).
      await pmB.page.goto(`/projects/${pb}/ai/settings`);
      await expect(pmB.page.getByTestId('settings-not-manager')).toBeVisible();
      await pmB.page.getByTestId('kill-switch-activate').click();
      const kd = pmB.page.getByRole('dialog');
      await expect(kd).toContainText('pending proposals are cancelled');
      await kd.getByTestId('dialog-confirm').click(); // a reason is required: nothing is sent without one
      await expect(kd.getByTestId('dialog-reason')).toHaveAttribute('aria-invalid', 'true');
      await expect(pmB.page.getByTestId('kill-switch-state')).toHaveAttribute('data-active', 'false');
      await kd.getByTestId('dialog-reason').fill(`E2E ${STAMP}: emergency stop drill (synthetic)`);
      await kd.getByTestId('dialog-confirm').click();
      await expect(kd).toBeHidden();
      await expect(pmB.page.getByTestId('kill-switch-state')).toHaveAttribute('data-active', 'true');
      // The PM holds no release permission; the release is someone else's.
      await expect(pmB.page.getByTestId('kill-switch-release')).toHaveCount(0);
      await expect(pmB.page.getByTestId('release-unavailable')).toBeVisible();
      await shot(pmB.page, 'ai-en-4-emergency-stop-active');

      // Asking is blocked, with the reason; the server refuses as well.
      await pmB.page.goto(`/projects/${pb}/ai/ask`);
      await expect(pmB.page.getByTestId('ask-unavailable').locator('[data-reason]')).toHaveAttribute('data-reason', 'kill_switch');
      await expect(pmB.page.getByTestId('ask-submit')).toBeDisabled();
      const refused = await call(api, 'POST', `/api/v1/projects/${pb}/ai/ask`, { question: 'What is overdue?' });
      expect(refused.status).toBe(422);
      expect(refused.body.code).toBe('ai.kill_switch');
      await shot(pmB.page, 'ai-en-4-ask-blocked');

      // Proposals: the pending proposal was cancelled by the stop (history kept); nothing can be approved.
      await pmB.page.goto(`/projects/${pb}/ai/proposals`);
      await expect(pmB.page.getByTestId('proposals-kill-switch')).toBeVisible();
      await pmB.page.goto(`/projects/${pb}/ai/proposals/${proposal.id}`);
      await expect(pmB.page.getByTestId('proposal-status')).toHaveAttribute('data-status', 'cancelled');
      await expect(pmB.page.getByTestId('proposal-reason')).toContainText('cancelled by the emergency stop');
      await expect(pmB.page.getByTestId('proposal-kill-switch')).toBeVisible();
      await expect(pmB.page.getByTestId('cmd-approve')).toHaveCount(0);
      await shot(pmB.page, 'ai-en-4-proposal-cancelled');

      // Another authorized person (Portfolio Admin) releases it.
      const admin = await openAs(browser, PERSONAS.portfolioAdmin);
      await admin.page.goto(`/projects/${pb}/ai/settings`);
      await expect(admin.page.getByTestId('kill-switch-state')).toHaveAttribute('data-active', 'true');
      await admin.page.getByTestId('kill-switch-release').click();
      const rd = admin.page.getByRole('dialog');
      await rd.getByTestId('dialog-reason').fill(`E2E ${STAMP}: drill finished (synthetic)`);
      await rd.getByTestId('dialog-confirm').click();
      await expect(rd).toBeHidden();
      await expect(admin.page.getByTestId('kill-switch-state')).toHaveAttribute('data-active', 'false');
      await admin.ctx.close();

      // Asking works again.
      await pmB.page.goto(`/projects/${pb}/ai/ask`);
      await expect(pmB.page.getByTestId('ask-unavailable')).toHaveCount(0);
      await pmB.page.getByTestId('ask-question').fill('What is overdue?');
      await pmB.page.getByTestId('ask-submit').click();
      await expect(pmB.page.getByTestId('ask-result')).toBeVisible({ timeout: 30_000 });
      expect(problems(), problems().join('\n')).toEqual([]);
    } finally {
      await api.dispose();
      await pmB.ctx.close();
    }

    // DEMO-DC: the activator (Sponsor, who also holds the release permission) is told someone else must release it.
    const sp = await openAs(browser, PERSONAS.sponsor);
    try {
      await sp.page.goto(`/projects/${dc}/ai/settings`);
      await sp.page.getByTestId('kill-switch-activate').click();
      const kd = sp.page.getByRole('dialog');
      await kd.getByTestId('dialog-reason').fill(`E2E ${STAMP}: separation-of-duties check (synthetic)`);
      await kd.getByTestId('dialog-confirm').click();
      await expect(kd).toBeHidden();
      await expect(sp.page.getByTestId('kill-switch-state')).toHaveAttribute('data-active', 'true');
      await expect(sp.page.getByTestId('kill-switch-release')).toHaveCount(0);
      await expect(sp.page.getByTestId('release-unavailable')).toHaveAttribute('data-reason', 'self');
      await shot(sp.page, 'ai-en-4-activator-cannot-release');
      const spApi = await apiSessionAs(baseURL!, PERSONAS.sponsor);
      const self = await call(spApi, 'POST', `/api/v1/projects/${dc}/ai/killswitch/release`, { reason: 'self release attempt (synthetic)' });
      expect(self.status).toBe(403);
      await spApi.dispose();
    } finally {
      await sp.ctx.close();
    }
    const admin = await openAs(browser, PERSONAS.portfolioAdmin);
    try {
      await admin.page.goto(`/projects/${dc}/ai/settings`);
      await admin.page.getByTestId('kill-switch-release').click();
      const rd = admin.page.getByRole('dialog');
      await rd.getByTestId('dialog-reason').fill(`E2E ${STAMP}: released by a different person (synthetic)`);
      await rd.getByTestId('dialog-confirm').click();
      await expect(rd).toBeHidden();
      await expect(admin.page.getByTestId('kill-switch-state')).toHaveAttribute('data-active', 'false');
    } finally {
      await admin.ctx.close();
    }
  });

  test('5. a user without AI permissions gets the restricted state; tabs follow the read permissions [REQ-AI-024]', async ({ page }) => {
    await loginAs(page, PERSONAS.cleanTeam);
    for (const seg of ['', '/ask', '/proposals', '/runs', '/settings']) {
      await page.goto(`/projects/${dc}/ai${seg}`);
      await expect(page.getByTestId('restricted-state'), `ai${seg}`).toBeVisible();
      await expect(page.getByTestId('ai-tabs')).toHaveCount(0);
    }
    await expect(page.locator('nav').getByRole('link', { name: 'AI PM Center' })).toHaveCount(0);
    await shot(page, 'ai-en-5-restricted-clean-team');

    await loginAs(page, PERSONAS.contributor);
    await page.goto(`/projects/${dc}/ai`);
    const tabs = page.getByTestId('ai-tabs');
    // QA-P5-02: a contributor holds no ai.run.read but reads their OWN runs (questions, delivered briefings).
    await expect(tabs.locator('[data-tab]')).toHaveText(['Overview', 'Ask', 'Runs', 'Briefings & detections']);
    await expect(page.getByTestId('ai-status-unavailable')).toBeVisible();
    for (const seg of ['/proposals', '/settings']) {
      await page.goto(`/projects/${dc}/ai${seg}`);
      await expect(page.getByTestId('restricted-state'), `contributor ai${seg}`).toBeVisible();
    }
    await page.goto(`/projects/${dc}/ai/runs`);
    await expect(page.getByTestId('runs-table')).toBeVisible();
    await expect(page.getByTestId('restricted-state')).toHaveCount(0);
    await shot(page, 'ai-en-5-contributor-own-runs');
  });

  test('6. Arabic (RTL) screens and a 390 px view [REQ-UX-001, REQ-UX-017]', async ({ browser }) => {
    const { ctx, page } = await openAs(browser, PERSONAS.pm);
    const problems = watchConsole(page);
    await setSavedLocale(page, 'ar');
    try {
      await page.goto(`/projects/${dc}/ai`);
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByTestId('ai-tabs')).toContainText('نظرة عامة');
      await expect(page.getByTestId('fact-provider')).toContainText('محاكاة');
      await expect(page.getByTestId('endpoint-anthropic')).toContainText('غير مُهيَّأ');
      await shot(page, 'ai-ar-6-overview');
      await page.goto(`/projects/${dc}/ai/proposals`);
      await expect(page.getByTestId('proposals-table').locator('table')).toBeVisible();
      await shot(page, 'ai-ar-6-proposals');
      await page.getByTestId('proposal-link').first().click();
      await expect(page.getByTestId('proposal-binding')).toBeVisible();
      await shot(page, 'ai-ar-6-proposal-detail');
      await page.goto(`/projects/${dc}/ai/runs`);
      await page.getByTestId('run-link').last().click();
      await expect(page.getByTestId('run-output')).toBeVisible();
      await shot(page, 'ai-ar-6-run-detail');
      await page.goto(`/projects/${dc}/ai/briefings`);
      await expect(page.getByTestId('detections-table').locator('table')).toBeVisible();
      await shot(page, 'ai-ar-6-briefings-detections');
      await page.goto(`/projects/${dc}/ai/settings`);
      await expect(page.getByTestId('emergency-stop')).toBeVisible();
      await shot(page, 'ai-ar-6-settings-emergency-stop');

      await page.setViewportSize(MOBILE);
      await page.goto(`/projects/${dc}/ai`);
      await expect(page.getByTestId('ai-status')).toBeVisible();
      // No horizontal page overflow at 390 px (tables scroll inside their own region).
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      await shot(page, 'ai-ar-390-6-overview');
    } finally {
      await setSavedLocale(page, 'en');
    }
    await page.goto(`/projects/${dc}/ai`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await shot(page, 'ai-en-390-6-overview');
    expect(problems(), problems().join('\n')).toEqual([]);
    await ctx.close();
  });
});
