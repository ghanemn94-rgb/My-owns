import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PERSONAS, apiSessionAs, loginAs, watchConsole } from './helpers';
import { checkArabic, watchBilingual } from './qa-rtl-detector';

/**
 * Independent QA review of P5 (docs/reviews/P5-qa-review.md) — gate conditions carried from P3 and P4:
 *  - P4 C1: independent re-verification of QA-P34-01 c (partner-raised DD questions show a translated "Counterparty" label),
 *    QA-P34-01 h (KPI definitions show definitionAr) and QA-P34-07 (a row click within the search debounce is not undone),
 *    on records and registers other than the ones the fix regressions use.
 *  - P3 C2: the Arabic Day-1 & TSA screens of AT-09 / AT-10 on the current code (the demo plan's blocked GO, the demo TSA
 *    past its end date), and the Committee Hub register where the TSA escalation also appears.
 * Fixtures are synthetic: a DD question typed by the demo partner in its room; everything else is the demo seed.
 * Requirement IDs: REQ-UX-001, REQ-UX-002, REQ-UX-012, REQ-UX-013, REQ-UX-014, REQ-JV-010, REQ-FIN-*, REQ-TSA-003, REQ-RDY-004.
 */
const SHOTS = join(__dirname, '..', 'screenshots', 'qa-p5');
mkdirSync(SHOTS, { recursive: true });
const STAMP = Date.now().toString(36).toUpperCase().slice(-6);
const MESSAGES = join(__dirname, '..', '..', 'apps', 'web', 'src', 'i18n', 'messages');
const msg = (lang: 'en' | 'ar', ns: string) => JSON.parse(readFileSync(join(MESSAGES, lang, `${ns}.json`), 'utf8'));

async function get(ctx: APIRequestContext, path: string) {
  const res = await ctx.get(path);
  expect(res.ok(), `GET ${path} → HTTP ${res.status()}`).toBeTruthy();
  return res.json();
}
async function open(browser: Browser, baseURL: string, persona: string, locale: 'en' | 'ar') {
  const context = await browser.newContext();
  const page = await context.newPage();
  const problems = watchConsole(page);
  await loginAs(page, persona);
  await context.addCookies([{ name: 'hub_locale', value: locale, url: baseURL }]);
  const bilingual = watchBilingual(page);
  return { page, problems, bilingual, close: () => context.close() };
}
async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  await expect(page.getByTestId('loading-state')).toHaveCount(0, { timeout: 20_000 });
}

test.describe.configure({ mode: 'serial' });

test.describe('QA P5 — P4 C1 re-verification (QA-P34-01 c/h, QA-P34-07) and P3 C2 Arabic re-check [REQ-UX-001, REQ-UX-002, REQ-UX-012, REQ-UX-013, REQ-UX-014]', () => {
  let dc = '';
  test.beforeAll(async ({ baseURL }) => {
    const pm = await apiSessionAs(baseURL!, PERSONAS.pm);
    try {
      dc = ((await get(pm, '/api/v1/projects?pageSize=100')).items as { id: string; code: string }[]).find((p) => p.code === 'DEMO-DC')!.id;
    } finally {
      await pm.dispose();
    }
  });

  test('P4 C1 / QA-P34-01c: a NEW question raised by the partner in its room — the Arabic DD request page names the requester with the Arabic counterparty label, never the English literal', async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(180_000);
    const base = `/api/v1/projects/${dc}`;
    const pmApi = await apiSessionAs(baseURL!, PERSONAS.pm);
    const room = ((await get(pmApi, `${base}/partner-rooms?pageSize=100`)).items as { id: string; name: string }[]).find((r) => r.name === 'Demo — Partner Alpha data room (fictional)')!.id;
    const question = `QA P5 ${STAMP}: which synthetic racks share the power feed? (synthetic)`;
    const partner = await open(browser, baseURL!, PERSONAS.partnerAlpha, 'en');
    try {
      await partner.page.goto(`/partner-access/${dc}/${room}`);
      await expect(partner.page.getByTestId('external-room')).toHaveAttribute('data-room-id', room);
      await partner.page.getByTestId('external-question').fill(question);
      await partner.page.getByTestId('external-ask-submit').click();
      await expect(partner.page.getByTestId('external-dd').getByRole('row').filter({ hasText: question })).toHaveCount(1);
    } finally {
      await partner.close();
    }
    const reqs = (await get(pmApi, `${base}/diligence-requests?pageSize=100&sort=-createdAt`)).items as { id: string; origin: string; question: string }[];
    const r = reqs.find((x) => x.question === question)!;
    const detail = await get(pmApi, `${base}/diligence-requests/${r.id}`);
    await pmApi.dispose();
    console.log(`QA-P34-01c re-check: new request origin ${r.origin}; stored requesterLabel ${JSON.stringify(detail.requesterLabel)}`);
    expect(r.origin).toBe('partner');
    const L = { en: msg('en', 'jv').dd.requesterCounterparty as string, ar: msg('ar', 'jv').dd.requesterCounterparty as string };
    for (const lang of ['en', 'ar'] as const) {
      const pm = await open(browser, baseURL!, PERSONAS.pm, lang);
      try {
        await pm.page.goto(`/projects/${dc}/jv/diligence/requests/${r.id}`);
        await expect(pm.page.getByTestId('dd-detail')).toBeVisible();
        await settle(pm.page);
        await expect(pm.page.getByTestId('dd-detail')).toContainText(L[lang]);
        if (lang === 'ar') {
          await expect(pm.page.getByTestId('dd-detail')).not.toContainText('Counterparty');
          const pr = await checkArabic(pm.page, testInfo, SHOTS, 'p34-01c-recheck-dd-request', pm.bilingual, { strict: false });
          // The partner typed its question in English: shown as entered (data).
          const unclassified = pr.filter((p) => !p.includes(question));
          console.log(`QA-P34-01c re-check (ar): ${pr.length} problem(s), UNCLASSIFIED ${unclassified.length}`);
          expect(unclassified, unclassified.join('\n')).toEqual([]);
        }
      } finally {
        await pm.close();
      }
    }
  });

  test('P4 C1 / QA-P34-01h: every KPI whose API carries definitionAr shows it on the Arabic KPI page (and the English definition on the English page)', async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(180_000);
    const fin = await apiSessionAs(baseURL!, PERSONAS.finance);
    const kpis = (await get(fin, `/api/v1/projects/${dc}/kpis?pageSize=100`)).items as { id: string; key: string; definition: string | null; definitionAr: string | null; formula: string | null; unit: string | null; frequency: string | null; source: string | null; thresholds: Record<string, string | null> }[];
    // Template KPI texts the template carries in English only (formula, unit, frequency, source, thresholds): QA-P5-07.
    const templateEnglish = new Set<string>(kpis.flatMap((k) => [k.formula, k.unit, k.frequency, k.source, ...Object.values(k.thresholds ?? {})].filter((x): x is string => !!x).map((x) => x.trim())));
    let classified07 = 0;
    await fin.dispose();
    const bilingual = kpis.filter((k) => k.definitionAr && k.definition && k.definitionAr !== k.definition);
    console.log(`QA-P34-01h re-check: ${kpis.length} KPI(s), ${bilingual.length} with definitionAr: ${JSON.stringify(bilingual.map((k) => k.key))}; without: ${JSON.stringify(kpis.filter((k) => !k.definitionAr).map((k) => k.key))}`);
    expect(bilingual.length).toBeGreaterThan(0);
    for (const lang of ['en', 'ar'] as const) {
      const s = await open(browser, baseURL!, PERSONAS.finance, lang);
      try {
        for (const k of bilingual) {
          await s.page.goto(`/projects/${dc}/finance/kpis/${k.id}`);
          await expect(s.page.getByTestId('kpi-detail')).toBeVisible();
          await settle(s.page);
          if (lang === 'ar') {
            await expect(s.page.getByTestId('kpi-detail')).toContainText(k.definitionAr!);
            await expect(s.page.getByTestId('kpi-detail')).not.toContainText(k.definition!);
            const pr = await checkArabic(s.page, testInfo, SHOTS, `p34-01h-recheck-kpi-${k.key}`, s.bilingual, { strict: false });
            const unclassified = pr.filter((p) => {
              const m = p.match(/ in \S+ "(.*)"$/) ?? p.match(/shown: "(.*)" \(\S+\)$/);
              return !(m && templateEnglish.has(m[1]!.trim()));
            });
            classified07 += pr.length - unclassified.length;
            expect(unclassified, unclassified.join('\n')).toEqual([]);
          } else {
            await expect(s.page.getByTestId('kpi-detail')).toContainText(k.definition!);
          }
        }
      } finally {
        await s.close();
      }
    }
    console.log(`QA-P34-01h re-check: detector problems classified QA-P5-07 (template KPI texts with no Arabic in the template): ${classified07}`);
  });

  // This regression REPLACES the former "OBSERVED QA-P5-07" test, which recorded (expected ≥ 5) English template KPI texts on
  // the Arabic KPI page. Fix (P6 configuration): template version 2 carries the Arabic formula, source and thresholds of every
  // template KPI (DEMO-DC is created on dc-carveout version 2); unit, period and frequency are translated from the web
  // vocabularies. A text a person has edited is shown as recorded and marked as such — the API then has no Arabic for it.
  test('QA-P5-07 regression: the Arabic KPI page shows no English template KPI text — formula, source and thresholds in the template’s Arabic, unit, period and frequency translated', async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(240_000);
    const ar = msg('ar', 'statuses') as Record<'kpiUnits' | 'kpiPeriods' | 'kpiFrequencies', Record<string, string>>;
    const s = await open(browser, baseURL!, PERSONAS.finance, 'ar');
    try {
      type Kpi = { id: string; key: string; formula: string | null; formulaAr: string | null; unit: string; period: string; frequency: string; source: string | null; sourceAr: string | null; thresholds: Record<'green' | 'amber' | 'red', string | null>; thresholdsAr: Record<'green' | 'amber' | 'red', string | null> | null };
      const kpis = (await get(s.page.request, `/api/v1/projects/${dc}/kpis?pageSize=100`)).items as Kpi[];
      // Every template KPI of the demo project carries the Arabic of its template texts (none has been edited by a person).
      const template = kpis.filter((k) => k.formulaAr !== null);
      console.log(`QA-P5-07 regression: ${kpis.length} KPI(s), ${template.length} with the template Arabic texts: ${JSON.stringify(template.map((k) => k.key))}`);
      expect(template.map((k) => k.key)).toContain('cps_verified');
      expect(template.length).toBeGreaterThanOrEqual(15);
      for (const k of template) {
        expect(k.sourceAr, `${k.key}: sourceAr`).not.toBeNull();
        expect(k.thresholdsAr, `${k.key}: thresholdsAr`).not.toBeNull();
        await s.page.goto(`/projects/${dc}/finance/kpis/${k.id}`);
        const detail = s.page.getByTestId('kpi-detail');
        await expect(detail).toBeVisible();
        await settle(s.page);
        const shown = await detail.innerText();
        const english = [k.formula, k.source, ...Object.values(k.thresholds)].filter((x): x is string => !!x && shown.includes(x));
        expect(english, `${k.key}: English template texts shown on the Arabic page`).toEqual([]);
        await expect(detail).toContainText(k.formulaAr!);
        await expect(detail).toContainText(k.sourceAr!);
        for (const band of ['green', 'amber', 'red'] as const) if (k.thresholdsAr![band]) await expect(detail).toContainText(k.thresholdsAr![band]!);
        await expect(detail).toContainText(ar.kpiUnits[k.unit]!);
        await expect(detail).toContainText(ar.kpiPeriods[k.period]!);
        await expect(detail).toContainText(ar.kpiFrequencies[k.frequency]!);
        // The detector without any allowance: no English UI message and no English half of a bilingual field.
        await checkArabic(s.page, testInfo, SHOTS, `qa-p5-07-regression-kpi-${k.key}`, s.bilingual);
      }
      expect(s.problems(), s.problems().join('\n')).toEqual([]);
    } finally {
      await s.close();
    }
  });

  test('P4 C1 / QA-P34-07: a row link clicked within the 300 ms search debounce reaches the detail page on the DD register (P4) and the readiness-check register (P3); Back within the debounce is not undone', async ({ browser, baseURL }) => {
    test.setTimeout(180_000);
    const s = await open(browser, baseURL!, PERSONAS.pm, 'en');
    try {
      const { page } = s;
      const results: Record<string, string> = {};
      // The detail navigation is answered 1.5 s late (as under load); the search is typed and the row clicked at once.
      const slow = async (re: RegExp) =>
        page.route(re, async (route) => {
          await new Promise((r) => setTimeout(r, 1_500));
          await route.continue().catch(() => undefined);
        });
      // (a) P4 — DD register.
      await page.goto(`/projects/${dc}/jv/diligence`);
      const ddRow = page.getByTestId('dd-table').locator('tbody tr').first();
      await expect(ddRow).toBeVisible();
      const ddText = (await ddRow.getByTestId('dd-link').innerText()).trim();
      await slow(/\/jv\/diligence\/requests\/[0-9a-f-]{36}/);
      await page.getByLabel('Search question').fill(ddText.slice(0, 12));
      await ddRow.getByTestId('dd-link').click();
      await page.waitForTimeout(4_000);
      results.dd = new URL(page.url()).pathname + new URL(page.url()).search;
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      // (b) P3 — readiness-check register.
      await page.goto(`/projects/${dc}/readiness/checks`);
      const chRow = page.getByTestId('checks-table').locator('tbody tr').first();
      await expect(chRow).toBeVisible();
      const chLink = chRow.locator(`a[href*="/readiness/checks/"]`).first();
      const chCode = (await chLink.innerText()).trim();
      await slow(/\/readiness\/checks\/[0-9a-f-]{36}/);
      await page.getByLabel('Search code or title').fill(chCode);
      await chLink.click();
      await page.waitForTimeout(4_000);
      results.checks = new URL(page.url()).pathname + new URL(page.url()).search;
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      // (c) History traversal: Back pressed within the debounce returns to the previous page and stays there.
      await page.goto(`/projects/${dc}/readiness`);
      await settle(page);
      await page.goto(`/projects/${dc}/readiness/checks`);
      await expect(page.getByTestId('checks-table').locator('tbody tr').first()).toBeVisible();
      await page.getByLabel('Search code or title').fill('QA P5 back');
      await page.goBack();
      await page.waitForTimeout(3_000);
      results.back = new URL(page.url()).pathname + new URL(page.url()).search;
      console.log(`QA-P34-07 re-check: ${JSON.stringify(results)}`);
      expect(results.dd).toMatch(/\/jv\/diligence\/requests\/[0-9a-f-]{36}$/);
      expect(results.checks).toMatch(/\/readiness\/checks\/[0-9a-f-]{36}$/);
      expect(results.back).toBe(`/projects/${dc}/readiness`);
      expect(s.problems(), s.problems().join('\n')).toEqual([]);
    } finally {
      await s.close();
    }
  });

  test('P3 C2 / AT-10 (Arabic): the demo TSA past its end date without an accepted replacement is shown expired and escalated, with the escalation in Arabic and no exit offered', async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(120_000);
    const s = await open(browser, baseURL!, PERSONAS.pm, 'ar');
    try {
      const tsas = (await get(s.page.request, `/api/v1/projects/${dc}/tsa-services?pageSize=100`)).items as { id: string; name: string; status: string; isDemo: boolean }[];
      const t = tsas.find((x) => x.isDemo && x.status === 'expired_unresolved')!;
      const d = await get(s.page.request, `/api/v1/projects/${dc}/tsa-services/${t.id}`);
      await s.page.goto(`/projects/${dc}/readiness/tsa/${t.id}`);
      await expect(s.page.getByTestId('tsa-detail')).toBeVisible();
      await settle(s.page);
      const shown = await s.page.getByTestId('tsa-detail').innerText();
      const english = [d.escalation?.requestedAction, d.escalation?.target].filter((x): x is string => !!x && shown.includes(x));
      const exitButtons = await s.page.locator('button').filter({ hasText: /خروج|exit/i }).count();
      const pr = await checkArabic(s.page, testInfo, SHOTS, 'p3-recheck-tsa-expired', s.bilingual, { strict: false });
      // Demo-seed texts (DEMO — …) and the TSA's own name are data.
      const unclassified = pr.filter((p) => !/DEMO|\(synthetic\)|Legacy monitoring bridge/.test(p));
      console.log(`P3 AT-10 (ar): TSA ${t.name} status ${d.status}, expiry ${JSON.stringify(d.expiry)}, escalation ${JSON.stringify(d.escalation && { status: d.escalation.status })}; English escalation text shown: ${english.length}; exit buttons: ${exitButtons}; detector problems ${pr.length}, unclassified ${unclassified.length}`);
      expect(d.status).toBe('expired_unresolved');
      expect(d.escalation).toBeTruthy();
      expect(english).toEqual([]);
      expect(exitButtons).toBe(0);
      expect(unclassified, unclassified.join('\n')).toEqual([]);
    } finally {
      await s.close();
    }
  });

  test('P3 C2 / AT-09 (Arabic): the demo Day-1 plan shows GO blocked by the failed connectivity test (Arabic title) with its contingency and the rollback plan', async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(120_000);
    const s = await open(browser, baseURL!, PERSONAS.pm, 'ar');
    try {
      const plans = (await get(s.page.request, `/api/v1/projects/${dc}/cutover-plans?pageSize=100`)).items as { id: string; title: string; isDemo: boolean }[];
      const p = plans.find((x) => x.isDemo && /Day-1 go-live/.test(x.title))!;
      const v = await get(s.page.request, `/api/v1/projects/${dc}/cutover-plans/${p.id}`);
      await s.page.goto(`/projects/${dc}/readiness/cutover/${p.id}`);
      await settle(s.page);
      const blockerIds = (v.goEvaluation.blockers as { id: string }[]).map((b) => b.id);
      type Chk = { id: string; code: string; titleAr: string | null; title: string; failureContingency: string | null; latestTest: { result: string } | null };
      const failed = (v.checks as Chk[]).find((c) => blockerIds.includes(c.id) && c.latestTest?.result === 'failed')!;
      const body = await s.page.locator('main').innerText();
      const pr = await checkArabic(s.page, testInfo, SHOTS, 'p3-recheck-day1-plan', s.bilingual, { strict: false });
      // "Assessment pending — specialist (DEMO)" is the demo seed's placeholder text (data, as classified by the P3/P4 QA review).
      const unclassified = pr.filter((p) => !/DEMO|\(synthetic\)/.test(p));
      console.log(
        `P3 AT-09 (ar): plan ${p.title}: GO allowed ${v.goEvaluation.allowed}, blockers ${blockerIds.length}, missing ${JSON.stringify(v.goEvaluation.missing)}; failed blocker ${failed?.code} shown by Arabic title: ${failed?.titleAr ? body.includes(failed.titleAr) : 'no titleAr'}; its contingency shown: ${failed?.failureContingency ? body.includes(failed.failureContingency) : 'none'}; rollback plan shown: ${v.rollbackPlan ? body.includes(v.rollbackPlan) : 'none'}; decision history ${JSON.stringify((v.decisionHistory as { kind: string }[]).map((h) => h.kind))}; detector problems ${pr.length}, unclassified ${unclassified.length}`,
      );
      expect(v.goEvaluation.allowed).toBe(false);
      expect(failed, 'a failed blocker (the demo connectivity test)').toBeTruthy();
      expect(body).toContain(failed.titleAr ?? failed.title);
      expect(failed.failureContingency).toBeTruthy();
      expect(body).toContain(failed.failureContingency!);
      expect(unclassified, unclassified.join('\n')).toEqual([]);
    } finally {
      await s.close();
    }
  });

  let escalation: { requestedAction: string; target: string; shownEnglish: string[]; registerRows: number } | null = null;

  test('CONTROL QA-P5-06: the Committee Hub escalation register (Arabic) lists the system escalation raised for the expired demo TSA', async ({ browser, baseURL }) => {
    const s = await open(browser, baseURL!, PERSONAS.pm, 'ar');
    try {
      const tsas = (await get(s.page.request, `/api/v1/projects/${dc}/tsa-services?pageSize=100`)).items as { id: string; isDemo: boolean; status: string }[];
      const t = tsas.find((x) => x.isDemo && x.status === 'expired_unresolved')!;
      const d = await get(s.page.request, `/api/v1/projects/${dc}/tsa-services/${t.id}`);
      await s.page.goto(`/projects/${dc}/committee/escalations`);
      await expect(s.page.getByTestId('escalations-table').locator('tbody tr').first()).toBeVisible();
      await settle(s.page);
      const shown = await s.page.getByTestId('escalations-table').innerText();
      escalation = {
        requestedAction: d.escalation.requestedAction,
        target: d.escalation.target,
        shownEnglish: [d.escalation.requestedAction, d.escalation.target].filter((x: string) => shown.includes(x)),
        registerRows: await s.page.getByTestId('escalations-table').locator('tbody tr').count(),
      };
      await s.page.getByTestId('escalations-table').screenshot({ path: join(SHOTS, 'qa-p5-06-ar-committee-escalations.png') });
      console.log(`QA-P5-06: ${JSON.stringify(escalation)}`);
      expect(escalation.registerRows).toBeGreaterThan(0);
      expect(/[؀-ۿ]/.test(msg('ar', 'governance').escalations.columns.requestedAction)).toBe(true);
    } finally {
      await s.close();
    }
  });

  test('QA-P5-06 (fixed, regression): the Arabic Committee Hub escalation register shows the TSA escalation\'s requested action and routing target in Arabic (as the Arabic TSA page does since QA-P34-01b)', async () => {
    test.skip(!escalation, 'needs the CONTROL above');
    expect(escalation!.shownEnglish).toEqual([]);
  });
});
