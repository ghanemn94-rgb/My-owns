import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DIMENSION_MESSAGES_EN, GATE_MESSAGES_EN, renderMessagesEn, type ProjectTemplateDefinition, type ServerMessage } from '@hub/domain';
import { closeApp, closePools, DC, loginAs, owner, projectIdByCode, type Client } from '../helpers';
import { base, carveoutProject, createItem, ok } from '../carveout/carveout-kit';

/**
 * QA-P1-14 [REQ-UX-001, REQ-UX-002] — server strings in both languages. Bilingual data is returned as `<field>` (English)
 * + `<field>Ar` (Arabic or null) whatever the caller's locale; server-computed explanations carry codes + parameters
 * (`<field>I18n`) next to the English sentence, which is rendered from exactly those messages.
 */

const TEMPLATES = join(__dirname, '..', '..', '..', '..', 'packages', 'db', 'seed', 'templates');
const dcTemplate = JSON.parse(readFileSync(join(TEMPLATES, 'dc-carveout.v1.json'), 'utf8')) as ProjectTemplateDefinition;
const ARABIC = /[؀-ۿ]/;

let pm: Client;
let admin: Client;
let dcId: string;

beforeAll(async () => {
  pm = await loginAs('pm');
  admin = await loginAs('portfolio.admin');
  dcId = await projectIdByCode(DC);
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

function expectRendered(messages: ServerMessage[], english: string | null, templates: Readonly<Record<string, string>>) {
  expect(messages.length).toBeGreaterThan(0);
  for (const m of messages) {
    expect(templates[m.code], `unknown code ${m.code}`).toBeDefined();
    for (const v of Object.values(m.params)) expect(['string', 'number']).toContain(typeof v);
  }
  expect(english).toBe(renderMessagesEn(messages, templates));
}

describe('QA-P1-14 [REQ-UX-001, REQ-UX-002] — bilingual server strings', () => {
  it('templates: English name plus the Arabic name from the bilingual template definition', async () => {
    const items = (await admin.get('/api/v1/templates').expect(200)).body.items as { templateKey: string; name: string; nameAr: string | null }[];
    const dc = items.find((t) => t.templateKey === 'dc-carveout')!;
    expect(dc.name).toBe(dcTemplate.name.en);
    expect(dc.nameAr).toBe(dcTemplate.name.ar);
    expect(dc.nameAr).toMatch(ARABIC);
    expect(items.every((t) => t.nameAr === null || ARABIC.test(t.nameAr))).toBe(true);
  });

  it('project detail: phases and next gate carry both languages regardless of the caller’s locale', async () => {
    const me = (await pm.get('/api/v1/me').expect(200)).body as { locale?: string };
    try {
      for (const locale of ['ar', 'en'] as const) {
        await pm.post('/api/v1/me/locale', { locale }).expect((r) => expect([200, 201]).toContain(r.status));
        const p = (await pm.get(`/api/v1/projects/${dcId}`).expect(200)).body;
        const first = dcTemplate.phases[0]!;
        const ph = (p.phases as { key: string; name: string; nameAr: string | null }[]).find((x) => x.key === first.key)!;
        expect(ph).toMatchObject({ name: first.name.en, nameAr: first.name.ar });
        if (p.nextGate) {
          const g = dcTemplate.gates.find((x) => x.key === p.nextGate.key)!;
          expect(p.nextGate).toMatchObject({ name: g.name.en, nameAr: g.name.ar });
        }
      }
    } finally {
      if (me.locale === 'en' || me.locale === 'ar') await pm.post('/api/v1/me/locale', { locale: me.locale });
    }
  });

  it('portfolio + dimensions: explanations are codes + params; the English text is rendered from the same messages', async () => {
    const list = (await pm.get('/api/v1/projects?pageSize=100').expect(200)).body.items as {
      id: string;
      dimensions: { key: string; explanation: string | null; explanationI18n: ServerMessage[] }[];
      nextGate: { key: string; name: string; nameAr: string | null } | null;
    }[];
    const dc = list.find((p) => p.id === dcId)!;
    expect(dc.dimensions.length).toBe(4);
    for (const d of dc.dimensions) expectRendered(d.explanationI18n, d.explanation, DIMENSION_MESSAGES_EN);
    if (dc.nextGate) expect(dc.nextGate.nameAr).toMatch(ARABIC);

    // Explicit recompute stores the codes with the state (versioned + audited as before).
    const re = (await pm.post(`/api/v1/projects/${dcId}/status-dimensions/recompute`, {}).expect(201)).body;
    for (const d of re.items as { explanation: string | null; explanationI18n: ServerMessage[] }[]) expectRendered(d.explanationI18n, d.explanation, DIMENSION_MESSAGES_EN);
    const got = (await pm.get(`/api/v1/projects/${dcId}/status-dimensions`).expect(200)).body;
    expect(got.items.map((d: { explanationI18n: unknown }) => d.explanationI18n)).toEqual(re.items.map((d: { explanationI18n: unknown }) => d.explanationI18n));
  });

  it('a recompute that changes nothing does not re-version or re-audit a dimension (stored codes compare key-order-independently)', async () => {
    // Own project: one in-scope item with legal and economic transfers started → perimeter "in progress", whose parameters
    // ({verified, inScope, pending}) come back from jsonb in a different key order than computed.
    const { projectId: pid, p } = await carveoutProject('QA14-DIMS');
    const item = await createItem(p.pm, pid, { type: 'site', name: 'QA-P1-14 site (synthetic)', disposition: 'included' });
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
    let v = item.version;
    for (const aspect of ['legal', 'economic'] as const) {
      for (const command of ['plan', 'start'] as const) {
        v = (await ok<{ itemVersion: number }>(p.pm.post(`${base(pid)}/transfers`, { perimeterItemId: item.id, aspect, command, expectedVersion: v, ...(command === 'plan' ? { mechanism: 'Transfer instrument (test)', effectiveDate: today } : {}) }))).itemVersion;
      }
    }
    const first = (await p.pm.post(`${base(pid)}/status-dimensions/recompute`, {}).expect(201)).body.items as { key: string; version: number; explanationI18n: ServerMessage[] }[];
    const per = first.find((d) => d.key === 'perimeter_transfer')!;
    expect(per.explanationI18n).toEqual([{ code: 'dimension.perimeter.in_progress', params: { verified: 0, inScope: 1, pending: 0 } }]);
    const audits = async () => Number((await owner().query("select count(*)::int n from audit_event where project_id = $1 and action = 'gates.status_dimension.recompute'", [pid])).rows[0].n);
    const auditsBefore = await audits();
    const second = (await p.pm.post(`${base(pid)}/status-dimensions/recompute`, {}).expect(201)).body.items as { key: string; version: number }[];
    expect(second.map((d) => [d.key, d.version])).toEqual(first.map((d) => [d.key, d.version]));
    expect(await audits()).toBe(auditsBefore);
  });

  it('a new project starts with the "not yet assessed" code (not an English-only sentence)', async () => {
    const templates = (await admin.get('/api/v1/templates').expect(200)).body.items as { id: string; templateKey: string }[];
    const tpl = templates.find((t) => t.templateKey === 'dc-carveout')!;
    const created = await admin
      .post('/api/v1/projects', { templateVersionId: tpl.id, code: `QA14-${Date.now().toString(36).toUpperCase()}`.slice(0, 30), name: 'QA-P1-14 bilingual check', projectManagerUserId: pm.userId })
      .expect(201);
    const p = (await pm.get(`/api/v1/projects/${created.body.id}`).expect(200)).body;
    for (const d of p.dimensions as { state: string; explanation: string; explanationI18n: ServerMessage[] }[]) {
      expect(d.state).toBe('not_assessed');
      expect(d.explanationI18n).toEqual([{ code: 'dimension.not_yet_assessed', params: {} }]);
      expect(d.explanation).toBe('Not yet assessed');
    }
  });

  it('gates: name/purpose in both languages; blockers carry codes + params rendered to the English message', async () => {
    const gates = (await pm.get(`/api/v1/projects/${dcId}/gates`).expect(200)).body.items as {
      key: string;
      name: string;
      nameAr: string | null;
      purpose: string | null;
      purposeAr: string | null;
      blockers: { message: string; messageI18n: ServerMessage[] }[];
      evaluation: { blockers: { message: string; messageI18n: ServerMessage[] }[] };
      decision: { blocker: string | null; blockerI18n: ServerMessage[] } | null;
    }[];
    expect(gates.length).toBe(dcTemplate.gates.length);
    let blockers = 0;
    for (const g of gates) {
      const t = dcTemplate.gates.find((x) => x.key === g.key)!;
      expect(g).toMatchObject({ name: t.name.en, nameAr: t.name.ar, purpose: t.purpose.en, purposeAr: t.purpose.ar });
      for (const b of [...g.blockers, ...g.evaluation.blockers]) {
        expect(b.messageI18n).toHaveLength(1);
        expectRendered(b.messageI18n, b.message, GATE_MESSAGES_EN);
        blockers++;
      }
      if (g.decision) {
        if (g.decision.blocker === null) expect(g.decision.blockerI18n).toEqual([]);
        else expectRendered(g.decision.blockerI18n, g.decision.blocker, GATE_MESSAGES_EN);
      }
    }
    expect(blockers).toBeGreaterThan(0);
    // Criteria keep their template Arabic description.
    const g0 = gates.find((g) => g.key === dcTemplate.gates[0]!.key)!;
    const detail = (await pm.get(`/api/v1/projects/${dcId}/gates/${(g0 as unknown as { id: string }).id}`).expect(200)).body;
    const c0 = dcTemplate.gates[0]!.criteria[0]!;
    expect(detail.criteria.find((c: { key: string }) => c.key === c0.key)).toMatchObject({ description: c0.description.en, descriptionAr: c0.description.ar });
  });

  it('plan: schedule, look-ahead, dependencies and workstream health carry the Arabic title/name from the template', async () => {
    const s = (await pm.get(`/api/v1/projects/${dcId}/schedule`).expect(200)).body;
    const withAr = (s.nodes as { code: string; title: string; titleAr: string | null }[]).filter((n) => n.titleAr);
    expect(withAr.length).toBeGreaterThan(50);
    const act = dcTemplate.wbs.find((a) => a.id === withAr[0]!.code);
    if (act) expect(withAr[0]!.titleAr).toBe(act.title.ar);
    const deps = (await pm.get(`/api/v1/projects/${dcId}/dependencies`).expect(200)).body.items as { predecessorTitleAr: string | null; successorTitleAr: string | null }[];
    expect(deps.some((d) => d.predecessorTitleAr && ARABIC.test(d.predecessorTitleAr))).toBe(true);
    const la = (await pm.get(`/api/v1/projects/${dcId}/look-ahead`).expect(200)).body;
    for (const i of [...la.starting, ...la.due, ...la.overdue]) expect(i).toHaveProperty('titleAr');
    const prog = (await pm.get(`/api/v1/projects/${dcId}/progress`).expect(200)).body;
    const ws = prog.workstreams as { code: string; name: string; nameAr: string | null }[];
    expect(ws.length).toBeGreaterThan(0);
    for (const w of ws) {
      const t = dcTemplate.workstreams.find((x) => x.key === w.code);
      if (t) expect(w).toMatchObject({ name: t.name.en, nameAr: t.name.ar });
    }
  });
});
