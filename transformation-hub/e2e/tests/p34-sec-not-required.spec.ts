import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { apiSessionAs, loginAs, setSavedLocale, watchConsole } from './helpers';

/**
 * SEC-P34-10 (P3/P4 security review, fix): setting a signing / closing checklist item "not required" removes its blocker,
 * so it takes two people. The project manager (checklist manager) only REQUESTS it with a reason — the item keeps its state
 * and its blocker and the request is shown on the checklist; a second person holding the verification permission (the
 * Legal member), never the requester, confirms it. Synthetic data on the DEMO-DC sandbox project.
 */
const PM = 'Demo Project Manager';
const SECOND = 'Demo Legal Member'; // holds jv.cp.verify and jv.deal.read (the functional approver cannot open the deal register)
const STAMP = Date.now().toString(36);

async function csrfOf(ctx: APIRequestContext): Promise<string> {
  return (await ctx.storageState()).cookies.find((c) => c.name === 'hub_csrf')?.value ?? '';
}
async function post(ctx: APIRequestContext, path: string, data: unknown) {
  const res = await ctx.post(path, { data, headers: { 'x-csrf-token': await csrfOf(ctx) } });
  expect(res.ok(), `${path} → HTTP ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}
async function get(ctx: APIRequestContext, path: string) {
  const res = await ctx.get(path);
  expect(res.ok(), `${path} → HTTP ${res.status()}`).toBeTruthy();
  return res.json();
}
async function asPersona(browser: Browser, persona: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const problems = watchConsole(page);
  await loginAs(page, persona);
  return { page, problems, close: () => context.close() };
}
const dialog = (page: Page) => page.getByRole('dialog');

test.describe('SEC-P34-10 — "not required" on a checklist item needs a second person', () => {
  let pid: string;
  let signingId: string;
  let itemId: string;
  let itemCode: string;

  test.beforeAll(async ({ baseURL }) => {
    const pm = await apiSessionAs(baseURL!, PM);
    try {
      const list = await get(pm, '/api/v1/projects?pageSize=100');
      pid = (list.items as { id: string; code: string }[]).find((p) => p.code === 'DEMO-DC')!.id;
      const base = `/api/v1/projects/${pid}`;
      signingId = (await post(pm, `${base}/signings`, { name: `E2E SEC-P34-10 signing ${STAMP} (synthetic)` })).id;
      const item = await post(pm, `${base}/checklist-items`, { eventId: signingId, title: `E2E side letter ${STAMP} (synthetic)` });
      itemId = item.id;
      itemCode = item.code;
    } finally {
      await pm.dispose();
    }
  });

  test('the PM requests it (the blocker stays); a Legal member confirms it (the blocker goes) — en and ar', async ({ browser, baseURL }) => {
    test.setTimeout(180_000);
    const path = `/projects/${pid}/jv/closing/signings/${signingId}`;
    const pm = await asPersona(browser, PM);
    try {
      const p = pm.page;
      await p.goto(path);
      const table = p.getByTestId('checklist-table');
      await expect(table).toContainText(`E2E side letter ${STAMP}`);
      await table.getByTestId('cmd-not-required').click();
      await expect(dialog(p)).toContainText('still blocks the event until a second person confirms');
      await dialog(p).getByRole('textbox').fill('Superseded by the executed agreement (synthetic e2e)');
      await dialog(p).getByRole('button', { name: 'Send the request', exact: true }).click();
      await expect(dialog(p)).toHaveCount(0);
      await expect(table.getByTestId('not-required-pending')).toContainText('Not-required request awaiting a second person');
      await expect(table.getByTestId('not-required-pending')).toContainText('Requested by You'); // the requester's own view
      // The requester is offered neither a second request nor the decision.
      await expect(table.getByTestId('cmd-not-required')).toHaveCount(0);
      await expect(table.getByTestId('cmd-not-required-confirm')).toHaveCount(0);
      await setSavedLocale(p, 'ar');
      await p.reload();
      await expect(p.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(p.getByTestId('checklist-table').getByTestId('not-required-pending')).toContainText('طلب «غير مطلوب» بانتظار شخص ثانٍ');
      await setSavedLocale(p, 'en');
      expect(pm.problems(), pm.problems().join('\n')).toEqual([]);
    } finally {
      await pm.close();
    }
    const api = await apiSessionAs(baseURL!, PM);
    try {
      const before = await get(api, `/api/v1/projects/${pid}/signings/${signingId}`);
      expect(before.blockers.map((b: { ref: string }) => b.ref)).toContain(itemCode);
    } finally {
      await api.dispose();
    }

    const approver = await asPersona(browser, SECOND);
    try {
      const a = approver.page;
      await a.goto(path);
      const table = a.getByTestId('checklist-table');
      await expect(table.getByTestId('not-required-pending')).toContainText(PM); // the second person sees who requested it
      await table.getByTestId('cmd-not-required-confirm').click();
      await expect(dialog(a)).toContainText('Reason given: Superseded by the executed agreement (synthetic e2e)');
      await dialog(a).getByRole('button', { name: 'Confirm not required', exact: true }).click();
      await expect(dialog(a)).toHaveCount(0);
      await expect(table.getByTestId('not-required-pending')).toHaveCount(0);
      expect(approver.problems(), approver.problems().join('\n')).toEqual([]);
    } finally {
      await approver.close();
    }
    const api2 = await apiSessionAs(baseURL!, PM);
    try {
      const after = await get(api2, `/api/v1/projects/${pid}/signings/${signingId}`);
      expect(after.checklist.find((i: { id: string }) => i.id === itemId).status).toBe('not_required');
      expect(after.blockers.map((b: { ref: string }) => b.ref)).not.toContain(itemCode);
    } finally {
      await api2.dispose();
    }
  });
});
