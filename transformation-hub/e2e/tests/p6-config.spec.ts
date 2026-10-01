import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PERSONAS, apiSessionAs, loginAs, watchConsole } from './helpers';
import { checkArabic, checkDialogA11y, watchBilingual } from './qa-rtl-detector';

/**
 * P6 project configuration — screens and acceptance through the UI, against the real API in DEMO mode:
 *  (a) AT-26 / REQ-ENT-009 (+ QA-P5-07): a project on general-transformation version 1 previews the upgrade to version 2,
 *      the project manager proposes it and nothing changes (the Arabic KPI page still shows the recorded English formula,
 *      marked as recorded); only the sponsor's approval applies it, after which the Arabic KPI page shows the template's
 *      Arabic formula, source and thresholds. Arabic detector + axe on the preview and on the applied state.
 *  (b) REQ-PLN-019 / DOM-P2-08: the project manager proposes new RAG thresholds — the thresholds in force do not change and
 *      the proposer is offered no approval; the portfolio administrator approves; the Health tab names the version in force.
 *  (c) REQ-SET-015 / REQ-SET-016 / REQ-SET-007: wizard step 7 (confidentiality, retention, AI Off, honest integration status)
 *      and step 8 (gap list; launch refused while a required approval is open — in the UI and by the API; the onboarding
 *      checklist tracks each approval given through its own command; launch with the remaining gaps acknowledged).
 *  (d) REQ-UX-020 (deployment-settings part) and the template catalogue in Administration: honest values, no secrets.
 * Fixtures that are not the subject of a test (fresh projects, role grants, committee, delegation, baseline) are prepared
 * through the API with the demo personas. All data is synthetic. Screenshots: e2e/screenshots/p6cfg.
 */
const SHOTS = join(__dirname, '..', 'screenshots', 'p6cfg');
mkdirSync(SHOTS, { recursive: true });
const RUN = Date.now().toString(36).toUpperCase();
const TEMPLATES = join(__dirname, '..', '..', 'packages', 'db', 'seed', 'templates');
type TemplateKpi = { key: string; formula: string; formulaAr: string; source: string; sourceAr: string; thresholds: Record<'green' | 'amber' | 'red', string>; thresholdsAr: Record<'green' | 'amber' | 'red', string> };
const GEN_V2 = JSON.parse(readFileSync(join(TEMPLATES, 'general-transformation.v2.json'), 'utf8')) as { kpis: TemplateKpi[] };
const P = {
  pm: PERSONAS.pm,
  admin: PERSONAS.portfolioAdmin,
  platformAdmin: PERSONAS.platformAdmin,
  sponsor: PERSONAS.sponsor,
  secretary: PERSONAS.secretary,
  legal: PERSONAS.legal,
  contributor: PERSONAS.contributor,
} as const;
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

interface Client {
  ctx: APIRequestContext;
  csrf: string;
  get: <T = Record<string, unknown>>(path: string) => Promise<T>;
  post: <T = Record<string, unknown>>(path: string, data: unknown) => Promise<T>;
  patch: <T = Record<string, unknown>>(path: string, data: unknown) => Promise<T>;
  raw: (path: string, data: unknown) => Promise<{ status: number; body: Record<string, unknown> }>;
  dispose: () => Promise<void>;
}

async function client(baseURL: string, persona: string): Promise<Client> {
  const ctx = await apiSessionAs(baseURL, persona);
  const csrf = (await ctx.storageState()).cookies.find((c) => c.name === 'hub_csrf')?.value ?? '';
  const send = async (method: 'post' | 'patch', path: string, data: unknown) => {
    const r = await ctx[method](path, { data, headers: { 'x-csrf-token': csrf } });
    expect(r.ok(), `${method.toUpperCase()} ${path} (${persona}) → ${r.status()} ${await r.text()}`).toBeTruthy();
    return r.json();
  };
  return {
    ctx,
    csrf,
    get: async (path) => {
      const r = await ctx.get(path);
      expect(r.ok(), `GET ${path} → ${r.status()} ${await r.text()}`).toBeTruthy();
      return r.json();
    },
    post: (path, data) => send('post', path, data),
    patch: (path, data) => send('patch', path, data),
    raw: async (path, data) => {
      const r = await ctx.post(path, { data, headers: { 'x-csrf-token': csrf } });
      return { status: r.status(), body: (await r.json().catch(() => ({}))) as Record<string, unknown> };
    },
    dispose: () => ctx.dispose(),
  };
}

async function withClient<T>(baseURL: string, persona: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = await client(baseURL, persona);
  try {
    return await fn(c);
  } finally {
    await c.dispose();
  }
}

async function asPersona(browser: Browser, baseURL: string, persona: string, locale: 'en' | 'ar' = 'en') {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const problems = watchConsole(page);
  await loginAs(page, persona);
  // The rendering language comes from the `hub_locale` cookie; the persona's saved preference is left untouched.
  await ctx.addCookies([{ name: 'hub_locale', value: locale, url: baseURL }]);
  const bilingual = watchBilingual(page);
  return { page, problems, bilingual, close: () => ctx.close() };
}

const userIds = new Map<string, string>();
async function userId(baseURL: string, persona: string): Promise<string> {
  if (!userIds.has(persona)) {
    const ctx = await apiSessionAs(baseURL, PERSONAS.pm);
    try {
      const users = (await (await ctx.get('/api/v1/auth/demo-users')).json()) as { items: { id: string; displayName: string }[] };
      for (const u of users.items) userIds.set(u.displayName, u.id);
    } finally {
      await ctx.dispose();
    }
  }
  return userIds.get(persona)!;
}

async function templateVersion(baseURL: string, key: string, versionNo: number): Promise<string> {
  return withClient(baseURL, P.admin, async (a) => {
    const items = (await a.get<{ items: { id: string; templateKey: string; versionNo: number }[] }>('/api/v1/templates')).items;
    const v = items.find((t) => t.templateKey === key && t.versionNo === versionNo);
    expect(v, `${key} version ${versionNo} is published`).toBeTruthy();
    return v!.id;
  });
}

/** A fresh, NON-demo project created by the portfolio administrator, managed by the demo project manager. */
async function newProject(baseURL: string, code: string, templateVersionId: string, name: string): Promise<string> {
  const pmId = await userId(baseURL, P.pm);
  return withClient(baseURL, P.admin, async (a) => (await a.post<{ id: string }>('/api/v1/projects', { templateVersionId, code: code.slice(0, 31), name, classification: 'internal', projectManagerUserId: pmId })).id);
}

async function grantRole(baseURL: string, granter: string, projectId: string, persona: string, role: string) {
  const uid = await userId(baseURL, persona);
  await withClient(baseURL, granter, (c) => c.post(`/api/v1/projects/${projectId}/members`, { userId: uid, role, reason: `E2E P6 configuration: ${role} (synthetic)` }));
}

async function confirm(page: Page, name: string) {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name, exact: true }).click();
  await expect(dialog).toBeHidden();
}

/** axe-core on the whole page (WCAG 2.0/2.1 A + AA), gating on serious / critical as a11y.spec.ts does. */
async function axeGate(page: Page, name: string) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  const gating = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  console.log(`[${name}] axe: ${results.violations.length} WCAG violation(s) (${gating.length} serious/critical), ${results.passes.length} rules passed`);
  expect(gating.map((v) => `${v.impact} ${v.id} ×${v.nodes.length}: ${v.help} — ${v.nodes[0]?.target.join(' ')}`), `${name}: serious/critical WCAG violations`).toEqual([]);
}

async function settled(page: Page) {
  await expect(page.getByTestId('loading-state')).toHaveCount(0, { timeout: 20_000 });
}

test.describe.configure({ mode: 'serial' });

test.describe('P6 project configuration — template upgrade, RAG thresholds, setup wizard steps 7–8, Administration [REQ-ENT-009, REQ-PLN-019, REQ-SET-007, REQ-SET-015, REQ-SET-016, REQ-UX-020]', () => {
  test('(a) AT-26 / REQ-ENT-009: the project manager previews and proposes the template upgrade and nothing changes; only the sponsor’s approval applies it — then the Arabic KPI page shows the template’s Arabic formula, source and thresholds (QA-P5-07)', async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(300_000);
    const v1 = await templateVersion(baseURL!, 'general-transformation', 1);
    const np = await newProject(baseURL!, `P6U-${RUN}`, v1, `E2E template upgrade project ${RUN} (synthetic)`);
    await grantRole(baseURL!, P.admin, np, P.sponsor, 'sponsor');
    const kpiOf = () => withClient(baseURL!, P.pm, async (c) => (await c.get<{ items: (TemplateKpi & { id: string; formulaAr: string | null })[] }>(`/api/v1/projects/${np}/kpis?pageSize=100`)).items.find((k) => k.key === 'overdue_decisions')!);
    const tpl = GEN_V2.kpis.find((k) => k.key === 'overdue_decisions')!;
    const k = await kpiOf();
    expect(k.formula).toBe(tpl.formula);
    expect(k.formulaAr, 'version 1 carries no Arabic formula').toBeNull();

    // Arabic KPI page on version 1: the English formula is shown as recorded (marked), the version-2 Arabic is not there.
    const arabicKpi = async (expectArabic: boolean, shot: string) => {
      const s = await asPersona(browser, baseURL!, P.pm, 'ar');
      try {
        await s.page.goto(`/projects/${np}/finance/kpis/${k.id}`);
        const detail = s.page.getByTestId('kpi-detail');
        await expect(detail).toBeVisible();
        await settled(s.page);
        if (expectArabic) {
          await expect(detail).toContainText(tpl.formulaAr);
          await expect(detail).toContainText(tpl.sourceAr);
          await expect(detail).toContainText(tpl.thresholdsAr.green);
          for (const en of [tpl.formula, tpl.source, tpl.thresholds.green, tpl.thresholds.amber, tpl.thresholds.red]) await expect(detail).not.toContainText(en);
        } else {
          await expect(detail.locator('[data-user-text]').filter({ hasText: tpl.formula }).first()).toBeVisible();
          await expect(detail).not.toContainText(tpl.formulaAr);
        }
        await checkArabic(s.page, testInfo, SHOTS, shot, s.bilingual);
        expect(s.problems(), s.problems().join('\n')).toEqual([]);
      } finally {
        await s.close();
      }
    };
    await arabicKpi(false, 'p6u-kpi-v1');

    // Arabic preview (read-only: opened, checked, closed — nothing is proposed).
    const pmAr = await asPersona(browser, baseURL!, P.pm, 'ar');
    try {
      await pmAr.page.goto(`/projects/${np}/settings?tab=template`);
      await expect(pmAr.page.getByTestId('template-current')).toHaveAttribute('data-version', '1');
      await pmAr.page.locator('[data-testid="upgrade-available"][data-version="2"]').getByTestId('upgrade-preview-open').click();
      await expect(pmAr.page.getByTestId('upgrade-plan')).toBeVisible();
      await checkArabic(pmAr.page, testInfo, SHOTS, 'p6u-preview', pmAr.bilingual);
      await axeGate(pmAr.page, 'p6u-preview-ar');
      expect(pmAr.problems(), pmAr.problems().join('\n')).toEqual([]);
    } finally {
      await pmAr.close();
    }

    // Preview and proposal (project manager, English).
    const pm = await asPersona(browser, baseURL!, P.pm);
    try {
      const page = pm.page;
      await page.goto(`/projects/${np}/settings?tab=template`);
      await expect(page.getByTestId('template-current')).toHaveAttribute('data-version', '1');
      await page.locator('[data-testid="upgrade-available"][data-version="2"]').getByTestId('upgrade-preview-open').click();
      const plan = page.getByTestId('upgrade-plan');
      await expect(plan).toHaveAttribute('data-version-only', 'false');
      await expect(plan).toContainText('From template version 1 to version 2.');
      await expect(plan).toContainText('Nothing is created.');
      await expect(plan).toContainText('No existing record differs from the new version.');
      await expect(page.getByTestId('plan-kpi-arabic')).toContainText('Arabic texts of the formula, source and thresholds of template KPIs: 5');
      await page.screenshot({ path: join(SHOTS, 'p6u-preview-en.png'), fullPage: true });
      await page.getByTestId('upgrade-propose').click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText('The upgrade to version 2 is proposed exactly as previewed; the project stays on its version.');
      await checkDialogA11y(page, dialog, 'p6u-propose-dialog');
      await dialog.getByLabel(/^Reason/).fill(`Arabic KPI texts of template version 2 (E2E ${RUN}, synthetic)`);
      await confirm(page, 'Propose this upgrade');
      const open = page.getByTestId('upgrade-open');
      await expect(open).toHaveAttribute('data-current', 'true');
      await expect(open).toContainText('Proposed');
      // The proposer is offered no decision, and the project is still on version 1.
      await expect(page.getByTestId('upgrade-approve')).toHaveCount(0);
      await expect(page.getByTestId('template-current')).toHaveAttribute('data-version', '1');
      expect(pm.problems(), pm.problems().join('\n')).toEqual([]);
    } finally {
      await pm.close();
    }
    // Server: nothing changed before the approval.
    expect((await kpiOf()).formulaAr).toBeNull();
    const pending = await withClient(baseURL!, P.pm, (c) => c.get<{ current: { versionNo: number }; items: { status: string; proposedBy: string }[] }>(`/api/v1/projects/${np}/template-upgrades`));
    expect(pending.current.versionNo).toBe(1);
    expect(pending.items.map((u) => u.status)).toEqual(['proposed']);
    await arabicKpi(false, 'p6u-kpi-proposed');

    // The sponsor approves; the project moves to version 2 exactly as previewed.
    const sp = await asPersona(browser, baseURL!, P.sponsor);
    try {
      const page = sp.page;
      await page.goto(`/projects/${np}/settings?tab=template`);
      await expect(page.getByTestId('upgrade-open')).toBeVisible();
      await page.getByTestId('upgrade-approve').click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText('The project moves to version 2 now, exactly as previewed.');
      await expect(dialog).toContainText('Created as proposals: gates 0, workstreams 0, activities 0, KPIs 0.');
      await checkDialogA11y(page, dialog, 'p6u-approve-dialog');
      await confirm(page, 'Approve and apply');
      await expect(page.getByTestId('template-current')).toHaveAttribute('data-version', '2');
      await expect(page.getByTestId('upgrade-none')).toBeVisible();
      await expect(page.getByTestId('upgrade-history').locator('tbody tr')).toHaveCount(1);
      await expect(page.getByTestId('upgrade-history')).toContainText('Applied');
      await page.screenshot({ path: join(SHOTS, 'p6u-applied-en.png'), fullPage: true });
      expect(sp.problems(), sp.problems().join('\n')).toEqual([]);
    } finally {
      await sp.close();
    }
    expect((await kpiOf()).formulaAr).toBe(tpl.formulaAr);
    await arabicKpi(true, 'p6u-kpi-v2');

    // Arabic applied state of the template tab.
    const after = await asPersona(browser, baseURL!, P.pm, 'ar');
    try {
      await after.page.goto(`/projects/${np}/settings?tab=template`);
      await expect(after.page.getByTestId('template-current')).toHaveAttribute('data-version', '2');
      await expect(after.page.getByTestId('upgrade-history').locator('tbody tr')).toHaveCount(1);
      await checkArabic(after.page, testInfo, SHOTS, 'p6u-applied', after.bilingual);
      await axeGate(after.page, 'p6u-applied-ar');
    } finally {
      await after.close();
    }
  });

  test('(b) REQ-PLN-019 / DOM-P2-08: a RAG threshold change proposed by the project manager is not in force until the portfolio administrator approves it; the Health tab names the threshold version in force', async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(240_000);
    const v2 = await templateVersion(baseURL!, 'general-transformation', 2);
    const np = await newProject(baseURL!, `P6R-${RUN}`, v2, `E2E RAG thresholds project ${RUN} (synthetic)`);
    const health = async (page: Page) => {
      await page.goto(`/projects/${np}/plan?tab=health`);
      await expect(page.getByTestId('health-tab')).toBeVisible();
      return page.getByTestId('rag-thresholds-ref');
    };

    const pm = await asPersona(browser, baseURL!, P.pm);
    try {
      const page = pm.page;
      await page.goto(`/projects/${np}/settings`);
      const inForce = page.getByTestId('rag-in-force');
      await expect(inForce).toHaveAttribute('data-source', 'template_default');
      await expect(inForce).toContainText('Proposed default of template version 2');
      await expect(page.getByTestId('rag-value-amber')).toHaveText('10');
      await expect(page.getByTestId('rag-rules').locator('li')).toHaveCount(6);
      await page.getByTestId('rag-propose').click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText('A new threshold version is recorded as a proposal; the thresholds in force do not change.');
      await checkDialogA11y(page, dialog, 'p6r-propose-dialog');
      // Amber below green is refused before anything is sent.
      await dialog.getByTestId('rag-green').fill('13');
      await expect(dialog).toContainText('The amber limit cannot be below the green limit.');
      await expect(dialog.getByRole('button', { name: 'Propose new thresholds', exact: true })).toBeDisabled();
      await dialog.getByTestId('rag-green').fill('0');
      await dialog.getByTestId('rag-amber').fill('12');
      await dialog.getByLabel(/^Reason for the change/).fill(`Wider amber band for a long programme (E2E ${RUN}, synthetic)`);
      await confirm(page, 'Propose new thresholds');
      await expect(page.getByTestId('rag-pending')).toHaveAttribute('data-version', '1');
      // Not in force, and the proposer is offered no approval (only a withdrawal).
      await expect(inForce).toHaveAttribute('data-source', 'template_default');
      await expect(page.getByTestId('rag-value-amber')).toHaveText('10');
      await expect(page.getByTestId('rag-approve')).toHaveCount(0);
      await expect(page.getByTestId('rag-withdraw')).toBeVisible();
      const ref = await health(page);
      await expect(ref).toHaveAttribute('data-source', 'template_default');
      await expect(ref).toContainText('Thresholds: proposed default of template version 2 (no project version approved).');
      expect(pm.problems(), pm.problems().join('\n')).toEqual([]);
    } finally {
      await pm.close();
    }

    const admin = await asPersona(browser, baseURL!, P.admin);
    try {
      const page = admin.page;
      await page.goto(`/projects/${np}/settings`);
      await expect(page.getByTestId('rag-pending')).toContainText('Demo Project Manager');
      await page.getByTestId('rag-approve').click();
      const dialog = page.getByRole('dialog');
      await checkDialogA11y(page, dialog, 'p6r-approve-dialog');
      await confirm(page, 'Approve thresholds');
      const inForce = page.getByTestId('rag-in-force');
      await expect(inForce).toHaveAttribute('data-source', 'approved');
      await expect(inForce).toHaveAttribute('data-version', '1');
      await expect(inForce).toContainText('Project version 1 — approved');
      await expect(page.getByTestId('rag-value-amber')).toHaveText('12');
      await expect(page.getByTestId('rag-pending')).toHaveCount(0);
      await expect(page.getByTestId('rag-history').locator('tbody tr')).toHaveCount(1);
      await expect(page.getByTestId('rag-history')).toContainText('Approved');
      await page.screenshot({ path: join(SHOTS, 'p6r-approved-en.png'), fullPage: true });
      expect(admin.problems(), admin.problems().join('\n')).toEqual([]);
    } finally {
      await admin.close();
    }

    const after = await asPersona(browser, baseURL!, P.pm);
    try {
      const ref = await health(after.page);
      await expect(ref).toHaveAttribute('data-source', 'approved');
      await expect(ref).toHaveAttribute('data-version', '1');
      await expect(ref).toContainText('Thresholds: project version 1 (approved).');
      await expect(after.page.getByTestId('project-rag')).toContainText('amber up to 12');
    } finally {
      await after.close();
    }
    // Arabic: the configuration screen and the Health tab.
    const ar = await asPersona(browser, baseURL!, P.pm, 'ar');
    try {
      await ar.page.goto(`/projects/${np}/settings`);
      await expect(ar.page.getByTestId('rag-in-force')).toHaveAttribute('data-source', 'approved');
      await expect(ar.page.getByTestId('rag-history').locator('tbody tr')).toHaveCount(1);
      await checkArabic(ar.page, testInfo, SHOTS, 'p6r-settings', ar.bilingual);
      await axeGate(ar.page, 'p6r-settings-ar');
      const ref = await health(ar.page);
      await expect(ref).toContainText('الحدود: إصدار المشروع');
      await checkArabic(ar.page, testInfo, SHOTS, 'p6r-health', ar.bilingual);
    } finally {
      await ar.close();
    }
  });

  test('(c) REQ-SET-015 / REQ-SET-016 / REQ-SET-007: wizard step 7 records confidentiality and retention with AI Off and the real integration status; step 8 refuses the launch while a required approval is open, the onboarding checklist tracks each approval given through its own command, and monitoring launches with the remaining gaps acknowledged', async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(420_000);
    const v2 = await templateVersion(baseURL!, 'general-transformation', 2);
    const np = await newProject(baseURL!, `P6W-${RUN}`, v2, `E2E launch project ${RUN} (synthetic)`);
    const base = `/api/v1/projects/${np}`;
    const setupState = () => withClient(baseURL!, P.pm, (c) => c.get<{ status: string; version: number; integrations: { status: string }[]; checklist: { blockingGaps: string[]; warnings: string[] }; launch: { acknowledgedGaps: string[] } | null }>(`${base}/setup`));
    const integrations = (await setupState()).integrations;

    // --- Step 7 (project manager).
    const pm = await asPersona(browser, baseURL!, P.pm);
    try {
      const page = pm.page;
      await page.goto(`/projects/${np}/setup?step=settings`);
      await expect(page.getByTestId('wizard-step-settings')).toBeVisible();
      await expect(page.getByTestId('wizard-policies-state')).toHaveAttribute('data-reviewed', 'false');
      const ai = page.getByTestId('wizard-ai-mode');
      await expect(ai).toHaveAttribute('data-mode', 'off');
      await expect(ai).toContainText('Off');
      await expect(ai).toContainText('default — no AI processing');
      // Integrations: exactly the organization's connections with their recorded status (none → Not configured).
      if (integrations.length === 0) await expect(page.getByTestId('wizard-integrations-none')).toContainText('Not configured');
      else await expect(page.getByTestId('wizard-integrations-list').locator('li')).toHaveCount(integrations.length);
      for (const [i, x] of integrations.entries()) await expect(page.getByTestId('wizard-integrations-list').locator('li').nth(i)).toHaveAttribute('data-status', x.status);
      // Lowering the classification needs a reason before it can be saved.
      await page.getByTestId('wizard-classification').selectOption('public');
      await expect(page.getByTestId('wizard-classification-reason')).toBeVisible();
      await expect(page.getByTestId('wizard-policies-save')).toBeDisabled();
      await page.getByTestId('wizard-classification').selectOption('confidential');
      await expect(page.getByTestId('wizard-classification-reason')).toHaveCount(0);
      await expect(page.getByTestId('wizard-retention-tbd')).toBeChecked();
      await page.getByTestId('wizard-policies-save').click();
      await expect(page.getByTestId('wizard-policies-state')).toHaveAttribute('data-reviewed', 'true');
      await expect(page.getByTestId('wizard-policies-state')).toContainText('Reviewed by Demo Project Manager');
      await page.screenshot({ path: join(SHOTS, 'p6w-step7-en.png'), fullPage: true });

      // --- Step 8: the gap list, the refused launch and the checklist.
      await page.getByTestId('setup-step-launch').click();
      const gaps = page.getByTestId('wizard-gap-list');
      await expect(gaps).toHaveAttribute('data-blocking', 'objective,owners,permissions,committee,authority_matrix,baseline');
      await expect(gaps).toHaveAttribute('data-warnings', 'no_sources,retention_tbd');
      await expect(page.getByTestId('wizard-launch')).toBeDisabled();
      await expect(gaps).toContainText('Required items still open (launch refused): 6');
      const item = (key: string) => page.locator(`[data-testid="wizard-checklist-item"][data-key="${key}"]`);
      await expect(item('perimeter')).toHaveAttribute('data-state', 'not_applicable');
      await expect(item('newco')).toHaveAttribute('data-state', 'not_applicable');
      await expect(item('policies')).toHaveAttribute('data-state', 'done');
      await expect(item('permissions')).toHaveAttribute('data-state', 'open');
      // The roles that approve an item are named (never a person): the committee charter is approved by the sponsor.
      await expect(page.getByTestId('wizard-checklist').locator('tbody tr').filter({ has: item('committee') })).toContainText('Sponsor');
      await page.screenshot({ path: join(SHOTS, 'p6w-step8-blocked-en.png'), fullPage: true });
      expect(pm.problems(), pm.problems().join('\n')).toEqual([]);
    } finally {
      await pm.close();
    }
    // The API refuses the launch the UI does not offer, with the same gap list.
    await withClient(baseURL!, P.pm, async (c) => {
      const s = await setupState();
      const r = await c.raw(`${base}/setup/launch`, { expectedVersion: s.version, acknowledgedGaps: ['no_sources', 'retention_tbd'] });
      expect(r.status).toBe(422);
      expect(r.body.code).toBe('setup.launch_blocked');
      expect((r.body.details as { gaps: string[] }).gaps).toEqual(['objective', 'owners', 'permissions', 'committee', 'authority_matrix', 'baseline']);
    });
    expect((await setupState()).status).toBe('setup');

    // Arabic (RTL) of steps 7 and 8 in the blocked state.
    const pmAr = await asPersona(browser, baseURL!, P.pm, 'ar');
    try {
      await pmAr.page.goto(`/projects/${np}/setup?step=settings`);
      await expect(pmAr.page.getByTestId('wizard-policies-state')).toHaveAttribute('data-reviewed', 'true');
      await checkArabic(pmAr.page, testInfo, SHOTS, 'p6w-step7', pmAr.bilingual);
      await axeGate(pmAr.page, 'p6w-step7-ar');
      await pmAr.page.goto(`/projects/${np}/setup?step=launch`);
      await expect(pmAr.page.getByTestId('wizard-checklist')).toHaveAttribute('data-state', 'ready');
      await checkArabic(pmAr.page, testInfo, SHOTS, 'p6w-step8-blocked', pmAr.bilingual);
      await axeGate(pmAr.page, 'p6w-step8-blocked-ar');
    } finally {
      await pmAr.close();
    }

    // Each approval is given through its own module command; the checklist follows the records.
    await grantRole(baseURL!, P.admin, np, P.sponsor, 'sponsor');
    const tracked = await asPersona(browser, baseURL!, P.pm);
    try {
      await tracked.page.goto(`/projects/${np}/setup?step=launch`);
      await expect(tracked.page.locator('[data-testid="wizard-checklist-item"][data-key="permissions"]')).toHaveAttribute('data-state', 'done');
      await expect(tracked.page.getByTestId('wizard-gap-list')).toHaveAttribute('data-blocking', 'objective,owners,committee,authority_matrix,baseline');
    } finally {
      await tracked.close();
    }
    await grantRole(baseURL!, P.admin, np, P.legal, 'legal_restricted');
    await grantRole(baseURL!, P.pm, np, P.secretary, 'secretary_cpmo');
    await grantRole(baseURL!, P.pm, np, P.contributor, 'contributor');
    const contributorId = await userId(baseURL!, P.contributor);
    await withClient(baseURL!, P.pm, async (c) => {
      const p = await c.get<{ version: number }>(base);
      await c.patch(base, { expectedVersion: p.version, objective: `Deliver the synthetic E2E programme ${RUN}` });
      for (const w of (await c.get<{ items: { id: string; version: number }[] }>(`${base}/workstreams`)).items) await c.post(`${base}/workstreams/${w.id}/lead`, { userId: contributorId, expectedVersion: w.version });
    });
    // Committee with an approved charter, and a delegation approved with a stored approval record and verified by legal.
    const committeeId = await withClient(baseURL!, P.secretary, async (sec) => {
      const c = await sec.post<{ id: string; version: number }>(`${base}/committees`, { kind: 'program_steering', name: `E2E steering committee ${RUN} (synthetic)`, charter: { purpose: 'E2E onboarding test committee (synthetic)' } });
      const charter = await withClient(baseURL!, P.sponsor, (sp) => sp.post<{ version: number }>(`${base}/committees/${c.id}/charter/approve`, { expectedVersion: c.version, approvalReference: `E2E-CHARTER-${RUN} (synthetic)` }));
      await sec.post(`${base}/committees/${c.id}/activate`, { expectedVersion: charter.version });
      return c.id;
    });
    const matrixId = await withClient(baseURL!, P.secretary, async (sec) =>
      (
        await sec.post<{ id: string }>(`${base}/committees/${committeeId}/authority-matrix-versions`, {
          policy: {
            isDemoPolicy: false,
            quorum: { minVotingMembersPresent: 3, minFractionPresent: 0.5 },
            approvalThreshold: { type: 'simple_majority' },
            tieRule: 'escalate',
            decisionTypes: [{ key: 'baseline_approval', name: { en: 'Approve baseline and rebaseline (synthetic)', ar: 'اعتماد خط الأساس وإعادة خط الأساس (اصطناعي)' }, maxAmount: null, currency: 'SAR', unitScale: 1, withinCommitteeAuthority: true, escalateTo: 'Not applicable — within committee authority (synthetic)' }],
            selfApprovalProhibited: true,
            recusedMembersExcludedFromQuorum: true,
          },
          effectiveFrom: '2026-01-01',
        })
      ).id,
    );
    const documentId = await withClient(baseURL!, P.pm, async (c) => {
      const d = await c.post<{ id: string }>(`${base}/documents`, { title: `E2E delegation approval record ${RUN} (synthetic)`, kind: 'evidence', classification: 'internal' });
      const up = await c.ctx.post(`${base}/documents/${d.id}/versions`, {
        data: Buffer.from('Synthetic delegation approval record for an e2e test - not a real approval.\n', 'utf8'),
        headers: { 'content-type': 'application/octet-stream', 'x-filename': encodeURIComponent('e2e-delegation.txt'), 'x-file-type': 'text/plain', 'x-csrf-token': c.csrf },
      });
      expect(up.ok(), `upload → ${up.status()} ${await up.text()}`).toBeTruthy();
      return d.id;
    });
    await withClient(baseURL!, P.sponsor, (sp) => sp.post(`${base}/committees/${committeeId}/authority-matrix-versions/${matrixId}/approve`, { approvalReference: `E2E-DELEGATION-${RUN} (synthetic)`, approvalDocumentId: documentId }));
    await withClient(baseURL!, P.legal, (lg) => lg.post(`${base}/committees/${committeeId}/authority-matrix-versions/${matrixId}/verify-approval`, { decision: 'accept', note: 'Approval record checked against the loaded values (e2e, synthetic)' }));
    // Baseline proposed by the project manager and approved by the sponsor within the delegation.
    const baselineId = await withClient(baseURL!, P.pm, async (c) => (await c.post<{ id: string }>(`${base}/baselines`, {})).id);
    await withClient(baseURL!, P.sponsor, (sp) => sp.post(`${base}/baselines/${baselineId}/approve`, { expectedVersion: 1 }));
    const ready = await setupState();
    expect(ready.checklist.blockingGaps).toEqual([]);
    expect(ready.checklist.warnings).toEqual(['no_sources', 'retention_tbd']);

    // --- Launch (project manager): every remaining gap must be acknowledged.
    const launch = await asPersona(browser, baseURL!, P.pm);
    try {
      const page = launch.page;
      await page.goto(`/projects/${np}/setup?step=launch`);
      const gaps = page.getByTestId('wizard-gap-list');
      await expect(gaps).toHaveAttribute('data-blocking', '');
      const item = (key: string) => page.locator(`[data-testid="wizard-checklist-item"][data-key="${key}"]`);
      for (const key of ['objective', 'owners', 'permissions', 'committee', 'authority_matrix', 'baseline', 'policies']) await expect(item(key)).toHaveAttribute('data-state', 'done');
      // Evidence of the approvals: who approved, from the records (the sponsor approved the charter and the baseline).
      await expect(page.getByTestId('wizard-checklist').locator('tbody tr').filter({ has: item('baseline') })).toContainText('Demo Sponsor');
      const launchButton = page.getByTestId('wizard-launch');
      await expect(launchButton).toBeDisabled();
      await page.locator('[data-testid="wizard-ack"][data-warning="no_sources"]').check();
      await expect(launchButton).toBeDisabled();
      await page.locator('[data-testid="wizard-ack"][data-warning="retention_tbd"]').check();
      await expect(launchButton).toBeEnabled();
      await page.screenshot({ path: join(SHOTS, 'p6w-step8-ready-en.png'), fullPage: true });
      await launchButton.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText('The project leaves setup and becomes Active.');
      await expect(dialog).toContainText('Recorded with the launch as acknowledged gaps: No source registered and Retention to be confirmed.');
      await checkDialogA11y(page, dialog, 'p6w-launch-dialog');
      await dialog.getByLabel(/^Note/).fill(`Sources and retention to be completed after launch (E2E ${RUN}, synthetic)`);
      await confirm(page, 'Launch monitoring');
      const launched = page.getByTestId('wizard-launched');
      await expect(launched).toContainText('Monitoring launched');
      await expect(launched).toContainText('Launched by Demo Project Manager');
      await expect(launched).toContainText('Acknowledged gaps at launch: No source registered and Retention to be confirmed');
      await expect(page.getByTestId('wizard-launch')).toHaveCount(0);
      await page.screenshot({ path: join(SHOTS, 'p6w-launched-en.png'), fullPage: true });
      expect(launch.problems(), launch.problems().join('\n')).toEqual([]);
    } finally {
      await launch.close();
    }
    const done = await setupState();
    expect(done.status).toBe('active');
    expect(done.launch?.acknowledgedGaps).toEqual(['no_sources', 'retention_tbd']);
    const launchedAr = await asPersona(browser, baseURL!, P.pm, 'ar');
    try {
      await launchedAr.page.goto(`/projects/${np}/setup?step=launch`);
      await expect(launchedAr.page.getByTestId('wizard-launched')).toBeVisible();
      await checkArabic(launchedAr.page, testInfo, SHOTS, 'p6w-launched', launchedAr.bilingual);
      await axeGate(launchedAr.page, 'p6w-launched-ar');
    } finally {
      await launchedAr.close();
    }
  });

  test('(d) REQ-UX-020: Administration shows the template catalogue with the version differences and the deployment settings with honest values and no secret', async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(180_000);
    for (const locale of ['en', 'ar'] as const) {
      const pa = await asPersona(browser, baseURL!, P.admin, locale);
      try {
        const page = pa.page;
        await page.goto('/admin');
        await page.locator('#tab-templates').click();
        const gen = page.locator('[data-testid="admin-template"][data-key="general-transformation"]');
        await expect(gen.getByTestId('admin-template-version')).toHaveCount(2);
        const v2 = gen.locator('[data-testid="admin-template-version"][data-version="2"]');
        await v2.getByTestId('admin-template-diff').click();
        const diff = v2.getByTestId('template-diff');
        await expect(diff).toHaveAttribute('data-from', '1');
        await expect(diff).toHaveAttribute('data-to', '2');
        await expect(diff.locator('[data-testid="template-diff-row"][data-key="kpiTextsArabicOnly"]')).toBeVisible();
        await settled(page);
        if (locale === 'ar') {
          await checkArabic(page, testInfo, SHOTS, 'p6a-templates', pa.bilingual);
          await axeGate(page, 'p6a-templates-ar');
        } else {
          await page.screenshot({ path: join(SHOTS, 'p6a-templates-en.png'), fullPage: true });
        }
        expect(pa.problems(), pa.problems().join('\n')).toEqual([]);
      } finally {
        await pa.close();
      }
      const plat = await asPersona(browser, baseURL!, P.platformAdmin, locale);
      try {
        const page = plat.page;
        await page.goto('/admin');
        await page.locator('#tab-deployment').click();
        const dep = page.getByTestId('admin-deployment');
        await expect(dep).toBeVisible();
        await settled(page);
        await expect(page.getByTestId('deployment-mode')).toContainText(locale === 'en' ? 'Demo' : 'تجريبي');
        // No secret reaches the browser: no connection string, credential or key, in the page or in the API answer.
        const html = await page.content();
        for (const secret of ['postgres://', 'hub_dev_only', 'BEGIN PRIVATE KEY', 'secret=']) expect(html, `page contains ${secret}`).not.toContain(secret);
        const api = await page.request.get('/api/v1/admin/deployment-settings');
        expect(api.ok()).toBeTruthy();
        const body = await api.text();
        for (const secret of ['postgres://', 'hub_dev_only', 'password', 'secretKey', 'apiKey']) expect(body, `API answer contains ${secret}`).not.toContain(secret);
        if (locale === 'ar') {
          await checkArabic(page, testInfo, SHOTS, 'p6a-deployment', plat.bilingual);
          await axeGate(page, 'p6a-deployment-ar');
        } else {
          await page.screenshot({ path: join(SHOTS, 'p6a-deployment-en.png'), fullPage: true });
        }
        expect(plat.problems(), plat.problems().join('\n')).toEqual([]);
      } finally {
        await plat.close();
      }
    }
    // A portfolio administrator (no deployment permission) sees the restricted state, not the values.
    const pa = await asPersona(browser, baseURL!, P.admin);
    try {
      await pa.page.goto('/admin');
      await pa.page.locator('#tab-deployment').click();
      await expect(pa.page.getByTestId('restricted-state')).toBeVisible();
      await expect(pa.page.getByTestId('admin-deployment')).toHaveCount(0);
    } finally {
      await pa.close();
    }
  });
});
