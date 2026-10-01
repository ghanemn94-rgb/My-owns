import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PARTNER_REQUESTER_LABEL, PERIMETER_MESSAGES_EN, TSA_MESSAGES_EN, renderMessagesEn, type ServerMessage } from '@hub/domain';
import { closeApp, closePools, loginAs, owner, projectIdByCode, Client, DC } from '../helpers';
import { setupFinance } from '../finance/finance-kit';

/**
 * Regression tests of the P3/P4 QA review fixes (docs/reviews/P3-P4-qa-review.md, "Fix status") — the server half of
 * QA-P34-01: every carve-out / TSA sentence the API computes or stores comes with codes + parameters the web translates
 * (module guide §2), and the English sentence is exactly the rendering of those codes; bilingual template data is returned
 * with its Arabic (cutover plan checks and GO blockers, KPI definitions). Reads the demo sandbox (DEMO-DC) — written by the
 * module services, so its stored texts went through the same templates — plus one fresh synthetic project for the KPI case.
 * [REQ-UX-001, REQ-UX-002, REQ-UX-010, REQ-UX-012, REQ-UX-013, REQ-UX-014]
 */
const P = (pid: string) => `/api/v1/projects/${pid}`;
const AR = /[؀-ۿ]/;
let dc: string;
let pm: Client;

beforeAll(async () => {
  dc = await projectIdByCode(DC);
  pm = await loginAs('pm');
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

const rendered = (m: ServerMessage[], table: Readonly<Record<string, string>>) => renderMessagesEn(m, table);

describe('QA-P34-01a/f — perimeter reconciliation, impact summaries and history reasons carry codes', () => {
  it('a: every reconciliation finding has codes whose English rendering is the finding sentence', async () => {
    const r = (await pm.get(`${P(dc)}/perimeter/reconciliation`).expect(200)).body as { findings: { code: string; issue: string; message: string; messageI18n: ServerMessage[] }[] };
    expect(r.findings.length).toBeGreaterThan(0);
    for (const f of r.findings) {
      expect(f.messageI18n.length, `${f.code} ${f.issue}`).toBe(1);
      expect(f.messageI18n[0]!.code).toMatch(/^perimeter\.recon\./);
      expect(rendered(f.messageI18n, PERIMETER_MESSAGES_EN)).toBe(f.message);
    }
    console.log(`QA-P34-01a fixed: ${r.findings.length} findings, codes ${JSON.stringify([...new Set(r.findings.map((f) => f.messageI18n[0]!.code))])}`);
  });

  it('f: impact summaries and the record-history reasons of every demo item carry codes (English = their rendering)', async () => {
    const items = (await pm.get(`${P(dc)}/perimeter-items?pageSize=100`).expect(200)).body.items as { id: string; code: string }[];
    let summaries = 0;
    let reasons = 0;
    for (const it of items) {
      const impacts = (await pm.get(`${P(dc)}/perimeter-items/${it.id}/impact-assessments`).expect(200)).body.items as { entries: { summary: string; summaryI18n: ServerMessage[] }[] }[];
      for (const e of impacts.flatMap((a) => a.entries)) {
        expect(e.summaryI18n.length, `${it.code}: ${e.summary}`).toBeGreaterThan(0);
        expect(rendered(e.summaryI18n, PERIMETER_MESSAGES_EN)).toBe(e.summary);
        summaries++;
      }
      const detail = (await pm.get(`${P(dc)}/perimeter-items/${it.id}`).expect(200)).body as { history: { reason: string | null; reasonI18n: ServerMessage[] }[] };
      for (const h of detail.history.filter((x) => x.reason)) {
        expect(h.reasonI18n.length, `${it.code}: history reason "${h.reason}" has no code`).toBe(1);
        expect(rendered(h.reasonI18n, PERIMETER_MESSAGES_EN)).toBe(h.reason);
        reasons++;
      }
    }
    expect(summaries).toBeGreaterThan(8);
    expect(reasons).toBeGreaterThan(3);
    const pi3 = items.find((x) => x.code === 'PI-003')!;
    const h3 = ((await pm.get(`${P(dc)}/perimeter-items/${pi3.id}`).expect(200)).body.history as { reasonI18n: ServerMessage[] }[]).map((h) => h.reasonI18n[0]?.code);
    console.log(`QA-P34-01f fixed: ${summaries} impact summaries and ${reasons} history reasons with codes; PI-003 history ${JSON.stringify(h3)}`);
    expect(h3).toEqual(expect.arrayContaining(['perimeter.history.created_pending', 'perimeter.history.change_request_raised']));
  });
});

describe('QA-P34-01b — the TSA escalation requested action and routing target carry codes', () => {
  it('the demo TSA issue: expiry escalation text and routing target are recovered as codes + parameters', async () => {
    const tsas = (await pm.get(`${P(dc)}/tsa-services?pageSize=100`).expect(200)).body.items as { id: string; code: string; name: string; endDate: string }[];
    const t = tsas.find((x) => /Legacy monitoring bridge/.test(x.name))!;
    const d = (await pm.get(`${P(dc)}/tsa-services/${t.id}`).expect(200)).body as { escalation: { requestedAction: string; requestedActionI18n: ServerMessage[]; target: string; targetI18n: ServerMessage[] } };
    const e = d.escalation;
    expect(e.requestedActionI18n).toEqual([{ code: 'tsa.escalation.expired_unresolved', params: { code: t.code, name: t.name, endDate: t.endDate } }]);
    expect(rendered(e.requestedActionI18n, TSA_MESSAGES_EN)).toBe(e.requestedAction);
    expect(e.targetI18n).toHaveLength(1);
    expect(e.targetI18n[0]!.code).toMatch(/^tsa\.routing\./);
    expect(rendered(e.targetI18n, TSA_MESSAGES_EN)).toBe(e.target);
    console.log(`QA-P34-01b fixed: target ${JSON.stringify(e.targetI18n)}`);
  });
});

describe('QA-P34-01c — the requester of a partner-raised DD question is the declared label the web translates', () => {
  it('origin partner ⇒ requesterLabel = PARTNER_REQUESTER_LABEL', async () => {
    const reqs = (await pm.get(`${P(dc)}/diligence-requests?pageSize=100`).expect(200)).body.items as { id: string; origin: string }[];
    const partner = reqs.filter((r) => r.origin === 'partner');
    expect(partner.length).toBeGreaterThan(0);
    for (const r of partner) expect((await pm.get(`${P(dc)}/diligence-requests/${r.id}`).expect(200)).body.requesterLabel).toBe(PARTNER_REQUESTER_LABEL);
  });
});

describe('QA-P34-01d/e — template readiness checks keep their Arabic title on the register, the plan and the GO blockers', () => {
  it('the cutover plan returns titleAr for its checks and its GO blockers ("<code> — <Arabic title>")', async () => {
    const checks = (await pm.get(`${P(dc)}/readiness-checks?pageSize=100`).expect(200)).body.items as { id: string; code: string; title: string; titleAr: string | null }[];
    const byId = new Map(checks.map((c) => [c.id, c]));
    const plans = (await pm.get(`${P(dc)}/cutover-plans?pageSize=100`).expect(200)).body.items as { id: string; title: string }[];
    const plan = plans.find((x) => /Day-1 go-live — DEMO/.test(x.title))!;
    const d = (await pm.get(`${P(dc)}/cutover-plans/${plan.id}`).expect(200)).body as {
      checks: { id: string; titleAr: string | null }[];
      goEvaluation: { blockers: { id: string; title: string; titleAr?: string | null }[] };
      decisionHistory: { evaluation: { blockers: { id: string; titleAr?: string | null }[] } | null }[];
    };
    const withAr = d.checks.filter((c) => c.titleAr);
    expect(withAr.length).toBeGreaterThan(10);
    for (const c of d.checks) expect(c.titleAr).toBe(byId.get(c.id)?.titleAr ?? null);
    expect(d.goEvaluation.blockers.length).toBeGreaterThan(0);
    for (const b of d.goEvaluation.blockers) {
      const c = byId.get(b.id)!;
      expect(b.titleAr).toBe(c.titleAr ? `${c.code} — ${c.titleAr}` : null);
    }
    expect(withAr.every((c) => AR.test(c.titleAr!))).toBe(true);
    // The register's search finds a template check by its Arabic title too.
    const one = checks.find((c) => c.titleAr)!;
    const found = (await pm.get(`${P(dc)}/readiness-checks?pageSize=100&q=${encodeURIComponent(one.titleAr!)}`).expect(200)).body.items as { id: string }[];
    expect(found.map((x) => x.id)).toContain(one.id);
    // Stored history evaluations get the Arabic title while the check's title is still the recorded one.
    for (const b of d.decisionHistory.flatMap((h) => h.evaluation?.blockers ?? [])) expect(b.titleAr === null || AR.test(b.titleAr ?? '')).toBe(true);
    console.log(`QA-P34-01e fixed: ${withAr.length}/${d.checks.length} plan checks with titleAr; ${d.goEvaluation.blockers.length} GO blockers with titleAr`);
  });
});

describe('QA-P34-01h — a template KPI returns the template Arabic definition while its definition is the template one', () => {
  it('definitionAr = template Arabic; null for a KPI defined by the team or whose definition differs from the template', async () => {
    const template = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', '..', 'packages', 'db', 'seed', 'templates', 'dc-carveout.v1.json'), 'utf8')) as { kpis: { key: string; definition: { en: string; ar: string } }[] };
    const tpl = template.kpis.find((k) => k.key === 'action_closure_time')!;
    const { projectId } = await setupFinance(`QA34-KPI-${Date.now().toString(36).slice(-5).toUpperCase()}`);
    const fin = await loginAs('finance');
    const list = (await fin.get(`${P(projectId)}/kpis?pageSize=100`).expect(200)).body.items as { id: string; key: string; definition: string; definitionAr: string | null }[];
    const k = list.find((x) => x.key === 'action_closure_time')!;
    expect(k).toMatchObject({ definition: tpl.definition.en, definitionAr: tpl.definition.ar });
    expect((await fin.get(`${P(projectId)}/kpis/${k.id}`).expect(200)).body.definitionAr).toBe(tpl.definition.ar);
    const own = await fin
      .post(`${P(projectId)}/kpis`, {
        key: 'qa-p34-team-kpi',
        name: 'QA team KPI (synthetic)',
        definition: 'A KPI defined by the team (synthetic test input).',
        formula: 'count(x)',
        unit: 'items',
        period: 'monthly',
        source: 'Synthetic test source',
        thresholds: { green: 'TBD', amber: 'TBD', red: 'TBD' },
        direction: 'higher_is_better',
        frequency: 'monthly',
      })
      .expect(201);
    expect((await fin.get(`${P(projectId)}/kpis/${own.body.id}`).expect(200)).body.definitionAr).toBeNull();
    // A stored definition that is no longer the template's (no API edits KPI definitions: set by the owner pool to stand for a
    // later change) loses the template Arabic — the Arabic UI then shows the definition as recorded.
    await owner().query(`update kpi set definition = definition || ' (amended)' where id = $1`, [k.id]);
    expect((await fin.get(`${P(projectId)}/kpis/${k.id}`).expect(200)).body.definitionAr).toBeNull();
  });
});
