import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { join } from 'node:path';
import { apiSessionAs, loginAs, setSavedLocale, watchConsole } from './helpers';

/**
 * P2 business gates (spec §3; AT-04, AT-13): the gates screens against the real API and demo seed.
 * Fixture preparation (evidence links + reviews to make G1 ready) goes through the API as the real personas; every
 * behaviour under test is driven through the UI. Safe to re-run: each step checks the current state first.
 */
const SHOTS = join(__dirname, '..', 'screenshots');
const P = {
  pm: 'Demo Project Manager',
  legal: 'Demo Legal Member',
  chair: 'Demo Committee Chair',
  contributor: 'Demo Contributor',
} as const;
/** Demo persona holding each designated reviewer role in DEMO-DC (only that role may accept a criterion). */
const REVIEWER: Record<string, string> = {
  project_manager: 'Demo Project Manager',
  finance_restricted: 'Demo Finance Member',
  legal_restricted: 'Demo Legal Member',
  functional_approver: 'Demo Functional Approver',
  secretary_cpmo: 'Demo Secretary / CPMO',
  sponsor: 'Demo Sponsor',
  workstream_lead: 'Demo Technology Lead',
};

interface Criterion {
  id: string;
  key: string;
  reviewerRole: string;
  mandatory: boolean;
  assessment: { status: string; version: number };
  evidence: { active: number; conflicting: number };
}
interface Gate {
  id: string;
  key: string;
  assessment: { status: string; version: number };
  criteria: Criterion[];
}

async function csrfOf(ctx: APIRequestContext): Promise<string> {
  return (await ctx.storageState()).cookies.find((c) => c.name === 'hub_csrf')?.value ?? '';
}
async function post(ctx: APIRequestContext, path: string, data: unknown) {
  const res = await ctx.post(path, { data, headers: { 'x-csrf-token': await csrfOf(ctx) } });
  expect(res.ok(), `POST ${path} → HTTP ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}
async function dcProjectId(ctx: APIRequestContext): Promise<string> {
  const list = await (await ctx.get('/api/v1/projects')).json();
  return (list.items as { id: string; code: string }[]).find((p) => p.code === 'DEMO-DC')!.id;
}
async function gateByKey(ctx: APIRequestContext, pid: string, key: string): Promise<Gate> {
  const list = await (await ctx.get(`/api/v1/projects/${pid}/gates`)).json();
  const g = (list.items as { id: string; key: string }[]).find((x) => x.key === key)!;
  return (await ctx.get(`/api/v1/projects/${pid}/gates/${g.id}`)).json();
}
function row(page: Page, key: string) {
  return page.locator(`[data-testid="criterion-row"][data-criterion-key="${key}"]`);
}
async function openRow(page: Page, key: string) {
  const r = row(page, key);
  await r.scrollIntoViewIfNeeded();
  const toggle = r.getByTestId('criterion-toggle');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  return r;
}

test.describe('P2 business gates', () => {
  let pid: string;

  test.beforeAll(async ({ baseURL }) => {
    const pm = await apiSessionAs(baseURL!, P.pm);
    pid = await dcProjectId(pm);
    await pm.dispose();
  });

  test('(a) gates list shows G0–G7 with status, RAG, prerequisites and blockers; G5 needs only G1', async ({ page }) => {
    const problems = watchConsole(page);
    await loginAs(page, P.pm);
    await page.goto(`/projects/${pid}`);
    // Cockpit: the next gate tile comes from the live gate evaluation and opens the gate.
    await expect(page.getByTestId('next-gate')).toHaveAttribute('data-gate-key', 'G1');
    await expect(page.getByTestId('dimension-cards').locator('[data-dimension]')).toHaveCount(4);
    await page.getByTestId('project-nav').getByRole('link', { name: 'Business Gates' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Business Gates' })).toBeVisible();
    await expect(page.getByTestId('gate-card')).toHaveCount(8);
    const g0 = page.locator('[data-testid="gate-card"][data-gate-key="G0"]');
    await expect(g0.locator('[data-status="approved"]').first()).toBeVisible();
    const g5 = page.locator('[data-testid="gate-card"][data-gate-key="G5"]');
    await expect(g5.getByTestId('gate-prerequisites').locator('li')).toHaveCount(1);
    await expect(g5.getByTestId('gate-prerequisites')).toContainText('G1');
    await expect(page.getByText('Task completion never unlocks a gate')).toBeVisible();
    expect(problems(), problems().join('\n')).toEqual([]);
  });

  test('(b) a criterion moves to Met only with evidence, accepted by a different reviewer', async ({ page, baseURL }) => {
    const problems = watchConsole(page);
    const pm = await apiSessionAs(baseURL!, P.pm);
    const g2 = await gateByKey(pm, pid, 'G2');
    await pm.dispose();
    const target = g2.criteria.find((c) => c.mandatory && c.assessment.status === 'unmet' && c.evidence.active === 0);
    test.skip(!target, 'no untouched G2 criterion left in this database (re-seed to re-run)');
    const key = target!.key;

    await loginAs(page, P.pm);
    await page.goto(`/projects/${pid}/gates/${g2.id}`);
    await expect(page.getByTestId('gate-title')).toContainText('G2');
    let r = await openRow(page, key);
    // No evidence yet → the reviewer's "met" is not offered to the PM, and the PM has no "Submit" without evidence.
    await r.getByTestId('criterion-action-evidence').click();
    const dlg = page.getByRole('dialog');
    await dlg.getByTestId('evidence-note').fill(`E2E synthetic evidence note for ${key}`);
    await dlg.getByRole('button', { name: 'Link evidence' }).click();
    await expect(dlg).toBeHidden();
    await expect(r.getByTestId('criterion-evidence').locator('[data-evidence-status="active"]')).toHaveCount(1);
    await r.getByTestId('criterion-action-submit').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Submit evidence' }).click();
    await expect(row(page, key)).toHaveAttribute('data-criterion-status', 'evidence_submitted');
    // the PM holds gates.assessment.review, but is not this criterion's designated reviewer (functional approver)
    await expect(row(page, key).getByTestId('criterion-action-met')).toHaveCount(0);

    await loginAs(page, P.legal);
    await page.goto(`/projects/${pid}/gates/${g2.id}`);
    r = await openRow(page, key);
    await r.getByTestId('criterion-action-met').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Accept as met' }).click();
    await expect(row(page, key)).toHaveAttribute('data-criterion-status', 'met');
    await expect(row(page, key).getByTestId('criterion-evidence-counts')).toContainText('1 active');
    expect(problems(), problems().join('\n')).toEqual([]);
  });

  test('(c) a non-waivable criterion refuses a waiver in the UI and stays unmet (AT-13)', async ({ page, baseURL }) => {
    const problems = watchConsole(page);
    const pm = await apiSessionAs(baseURL!, P.pm);
    const g3 = await gateByKey(pm, pid, 'G3');
    const before = g3.criteria.find((c) => c.key === 'G3-C01')!;
    await loginAs(page, P.pm);
    await page.goto(`/projects/${pid}/gates/${g3.id}`);
    const r = await openRow(page, 'G3-C01');
    await expect(r).toContainText('Non-waivable');
    await r.getByTestId('criterion-action-waiver').click();
    const dlg = page.getByRole('dialog');
    await expect(dlg.getByTestId('non-waivable-warning')).toBeVisible();
    await dlg.getByTestId('waiver-basis').fill('E2E: attempt to waive a non-waivable condition (synthetic)');
    await dlg.getByTestId('waiver-impact').fill('E2E: would bypass the perimeter reconciliation (synthetic)');
    await dlg.getByRole('button', { name: 'Request waiver' }).click();
    const alert = dlg.getByRole('alert');
    await expect(alert).toContainText('The request breaks a business rule');
    await expect(alert).toContainText('not waivable');
    await page.screenshot({ path: join(SHOTS, 'gates-en-non-waivable.png'), fullPage: false });
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    await expect(row(page, 'G3-C01')).toHaveAttribute('data-criterion-status', 'unmet');
    const after = (await gateByKey(pm, pid, 'G3')).criteria.find((c) => c.key === 'G3-C01')!;
    expect(after.assessment).toMatchObject({ status: 'unmet', version: before.assessment.version });
    const waivers = await (await pm.get(`/api/v1/projects/${pid}/gate-waivers`)).json();
    expect((waivers.items as { targetKey: string }[]).filter((w) => w.targetKey === 'G3-C01')).toHaveLength(0);
    await pm.dispose();
    expect(problems(), problems().join('\n')).toEqual([]);
  });

  test('(d) a gate cannot be approved with a recommendation pending external authority (AT-04)', async ({ page, baseURL }) => {
    const problems = watchConsole(page);
    // Fixture: make G1 ready for decision through the API. Evidence is linked by the PM (by the contributor on
    // PM-designated criteria), each criterion is accepted by its designated reviewer, and the PM submits.
    const pm = await apiSessionAs(baseURL!, P.pm);
    const sessions = new Map<string, APIRequestContext>([[P.pm, pm]]);
    const as = async (persona: string) => {
      if (!sessions.has(persona)) sessions.set(persona, await apiSessionAs(baseURL!, persona));
      return sessions.get(persona)!;
    };
    let g1 = await gateByKey(pm, pid, 'G1');
    if (g1.assessment.status === 'in_assessment') {
      for (const c of g1.criteria.filter((x) => x.mandatory && x.assessment.status !== 'met')) {
        const reviewer = REVIEWER[c.reviewerRole];
        expect(reviewer, `a demo persona holds reviewer role ${c.reviewerRole}`).toBeTruthy();
        const adder = c.reviewerRole === 'project_manager' ? P.contributor : P.pm;
        if (c.evidence.active === 0) await post(await as(adder), `/api/v1/projects/${pid}/evidence`, { targetType: 'gate_criterion', targetId: c.id, note: `E2E synthetic evidence for ${c.key}` });
        await post(await as(reviewer!), `/api/v1/projects/${pid}/gates/${g1.id}/criteria/${c.id}/review`, { expectedVersion: c.assessment.version, outcome: 'met' });
      }
      g1 = await gateByKey(pm, pid, 'G1');
      await post(pm, `/api/v1/projects/${pid}/gates/${g1.id}/assessment/mark-ready`, { expectedVersion: g1.assessment.version });
    }
    const decisions = await (await pm.get(`/api/v1/projects/${pid}/decisions?status=recommended`)).json();
    const recommended = (decisions.items as { id: string; code: string }[])[0]!;
    expect(recommended, 'demo seed has a recommendation pending external authority').toBeTruthy();
    for (const s of sessions.values()) await s.dispose();

    // The PM links the committee recommendation to G1.
    await loginAs(page, P.pm);
    await page.goto(`/projects/${pid}/gates/${g1.id}`);
    await expect(page.getByTestId('gate-title')).toContainText('G1');
    await page.getByTestId('gate-action-link').click();
    let dlg = page.getByRole('dialog');
    await dlg.getByTestId('decision-select').selectOption(recommended.id);
    await expect(dlg.getByTestId('chosen-decision')).toContainText('Recommended');
    await dlg.getByRole('button', { name: 'Link decision' }).click();
    await expect(dlg).toBeHidden();
    await expect(page.getByTestId('linked-decision')).toContainText('Not a final authorized decision');
    await expect(page.locator('[data-blocker-kind="decision"]')).toBeVisible();

    // The chair (G1 approver) tries to approve: the server refuses, the gate stays ready for decision.
    await loginAs(page, P.chair);
    await page.goto(`/projects/${pid}/gates/${g1.id}`);
    await page.getByTestId('gate-action-decide').click();
    dlg = page.getByRole('dialog');
    await dlg.getByTestId('decide-outcome').selectOption('approve');
    await dlg.getByRole('textbox', { name: /Decision note/ }).fill('E2E: attempt to approve on a recommendation');
    await dlg.getByRole('button', { name: 'Record decision' }).click();
    await expect(dlg.getByRole('alert')).toContainText('pending the external authority');
    await page.screenshot({ path: join(SHOTS, 'gates-en-decision-blocked.png'), fullPage: false });
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('[data-status="ready_for_decision"]').first()).toBeVisible();
    expect(problems(), problems().join('\n')).toEqual([]);
  });

  test('(e) screenshots: gate detail in English and Arabic, desktop and mobile', async ({ page, baseURL }) => {
    const problems = watchConsole(page);
    const pm = await apiSessionAs(baseURL!, P.pm);
    const g1 = await gateByKey(pm, pid, 'G1');
    await pm.dispose();
    await loginAs(page, P.pm);
    await setSavedLocale(page, 'en');
    await page.goto(`/projects/${pid}/gates`);
    await expect(page.getByTestId('gate-card')).toHaveCount(8);
    await page.screenshot({ path: join(SHOTS, 'gates-en-list.png'), fullPage: true });
    await page.goto(`/projects/${pid}/gates/${g1.id}`);
    await openRow(page, 'G1-C01');
    await page.screenshot({ path: join(SHOTS, 'gates-en.png'), fullPage: true });
    try {
      await setSavedLocale(page, 'ar');
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByRole('heading', { name: 'المعايير' })).toBeVisible();
      await openRow(page, 'G1-C01');
      await page.screenshot({ path: join(SHOTS, 'gates-ar.png'), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload();
      await expect(page.getByTestId('criterion-list')).toBeVisible();
      await page.screenshot({ path: join(SHOTS, 'gates-ar-mobile.png'), fullPage: true });
      // No horizontal overflow at mobile width.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      await page.goto(`/projects/${pid}`);
      await page.getByTestId('dimension-cards').locator('[data-dimension="incorporation"]').getByTestId('dimension-link').click();
      await expect(page.getByTestId('dimension-detail')).toBeVisible();
      await page.screenshot({ path: join(SHOTS, 'gates-ar-dimension-mobile.png'), fullPage: true });
    } finally {
      await setSavedLocale(page, 'en');
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.goto(`/projects/${pid}/gates/${g1.id}`);
    await expect(page.getByTestId('criterion-list')).toBeVisible();
    await page.screenshot({ path: join(SHOTS, 'gates-en-mobile.png'), fullPage: true });
    expect(problems(), problems().join('\n')).toEqual([]);
  });
});
