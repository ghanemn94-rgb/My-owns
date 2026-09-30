import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AUTHORITY_MESSAGES_EN, PLANNING_MESSAGES_EN, planningEn, renderMessagesEn, type ServerMessage } from '@hub/domain';
import { closeApp, closePools, DC, loginAs, projectIdByCode, type Client } from '../helpers';
import { authorityReasonI18n } from '../../src/modules/governance/decisions.service';
import { createProject, grant, riyadhToday, task, workstreams } from './fixtures';

/**
 * QA-P2-04 [REQ-UX-001, REQ-UX-002] — the P2 read DTOs carry the Arabic of template-seeded text (`<field>Ar`) and the
 * server's explanations as codes + parameters (`<field>I18n`), rendered to exactly the English sentences they return, so
 * the Arabic UI never has to show the English half: task definition fields and effort, Health (RAG, data quality, red
 * critical items, weighted progress), schedule / what-if assumptions, My Work titles and the decision authority reason.
 * Synthetic project from the DC template; the demo decision is read only.
 */
type Messages = ServerMessage[];
type Activity = { id: string; title: { en: string; ar: string }; description: { en: string; ar: string }; output: { en: string; ar: string }; acceptanceCriteria: { en: string; ar: string }; effort: string; isMilestone: boolean };
const template = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', '..', 'packages', 'db', 'seed', 'templates', 'dc-carveout.v1.json'), 'utf8')) as { wbs: Activity[]; workstreams: { key: string; name: { en: string; ar: string } }[] };
const activity = new Map(template.wbs.map((a) => [a.id, a]));

let admin: Client;
let pm: Client;
let contributor: Client;
let secretary: Client;
let pid: string;
let ws: Map<string, { id: string; version: number }>;
const P = () => `/api/v1/projects/${pid}`;

/** Every placeholder of the template is supplied, and the message renders to the English text returned next to it. */
function rendersTo(messages: Messages | null | undefined, english: string) {
  expect(messages, english).toBeTruthy();
  for (const m of messages!) {
    expect(PLANNING_MESSAGES_EN[m.code], m.code).toBeDefined();
    const need = [...PLANNING_MESSAGES_EN[m.code]!.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort();
    expect(Object.keys(m.params).sort(), m.code).toEqual(need);
  }
  expect(planningEn(messages!)).toBe(english);
}

beforeAll(async () => {
  admin = await loginAs('portfolio.admin');
  pm = await loginAs('pm');
  contributor = await loginAs('contributor');
  secretary = await loginAs('secretary');
  pid = await createProject(admin, pm, 'QA-P204');
  await grant(pm, pid, contributor, 'contributor');
  await grant(admin, pid, secretary, 'secretary_cpmo');
  ws = await workstreams(pm, pid);
}, 300_000);
afterAll(async () => {
  await closeApp();
  await closePools();
});

async function allTasks(c: Client) {
  const out: Record<string, unknown>[] = [];
  for (let page = 1; ; page++) {
    const r = (await c.get(`${P()}/tasks?pageSize=100&page=${page}`).expect(200)).body as { items: Record<string, unknown>[]; total: number };
    out.push(...r.items);
    if (out.length >= r.total || r.items.length === 0) return out;
  }
}

describe('QA-P2-04 — task definition in Arabic [REQ-UX-001]', () => {
  it('every template-seeded task carries the Arabic of its description, output and acceptance criteria, and its effort estimate as codes', async () => {
    const tasks = (await allTasks(pm)).filter((t) => t['templateActivityId']);
    expect(tasks.length).toBe(template.wbs.filter((a) => !a.isMilestone).length);
    for (const t of tasks) {
      const a = activity.get(t['templateActivityId'] as string)!;
      expect(t['titleAr']).toBe(a.title.ar);
      expect(t['descriptionAr']).toBe(a.description.ar);
      expect(t['outputAr']).toBe(a.output.ar);
      expect(t['acceptanceCriteriaAr']).toBe(a.acceptanceCriteria.ar);
      expect(t['effort']).toBe(a.effort);
      rendersTo(t['effortI18n'] as Messages, a.effort);
    }
    const t = tasks.find((x) => x['wbsCode'] === 'WS01-A02')!;
    expect(t['effortI18n']).toEqual([{ code: 'plan.effort.assumed_person_days', params: { days: 6 } }]);
    // Vocabulary keys (translated by the client), not prose.
    expect(t['evidenceType']).toBe('approved_document');
    expect(t['durationBasis']).toBe('assumed');
  });

  it('changing the English text without its Arabic clears the stale Arabic; unchanged text keeps it; the Arabic can be set explicitly', async () => {
    const id = ((await pm.get(`${P()}/tasks?q=WS01-A03`).expect(200)).body.items as { id: string }[])[0]!.id;
    const before = (await pm.get(`${P()}/tasks/${id}`).expect(200)).body;
    expect(before.descriptionAr).toBeTruthy();
    // The edit dialog always sends the description: the same text keeps the Arabic.
    await pm.patch(`${P()}/tasks/${id}`, { expectedVersion: before.version, description: before.description, output: before.output }).expect(200);
    let now = (await pm.get(`${P()}/tasks/${id}`).expect(200)).body;
    expect([now.descriptionAr, now.outputAr]).toEqual([before.descriptionAr, before.outputAr]);
    await pm.patch(`${P()}/tasks/${id}`, { expectedVersion: now.version, description: 'Reworded by the planner (synthetic)' }).expect(200);
    now = (await pm.get(`${P()}/tasks/${id}`).expect(200)).body;
    expect(now.descriptionAr).toBeNull();
    expect(now.outputAr).toBe(before.outputAr);
    expect(now.acceptanceCriteriaAr).toBe(before.acceptanceCriteriaAr);
    await pm.patch(`${P()}/tasks/${id}`, { expectedVersion: now.version, descriptionAr: 'وصف أعاد المخطط صياغته (تجريبي)' }).expect(200);
    now = (await pm.get(`${P()}/tasks/${id}`).expect(200)).body;
    expect(now.descriptionAr).toBe('وصف أعاد المخطط صياغته (تجريبي)');
    expect(now.description).toBe('Reworded by the planner (synthetic)');
    // A task a planner creates: the Arabic fields exist and are null unless given; free-text effort has no codes.
    const own = await task(pm, pid, ws.get('WS02')!.id, 'Planner task (synthetic)', { description: 'Typed by the planner', effort: 'about two weeks' });
    const o = (await pm.get(`${P()}/tasks/${own}`).expect(200)).body;
    expect([o.titleAr, o.descriptionAr, o.outputAr, o.acceptanceCriteriaAr, o.effortI18n]).toEqual([null, null, null, null, null]);
  });
});

describe('QA-P2-04 — Health and schedule explanations as codes [REQ-UX-001, REQ-PLN-018, REQ-PLN-020]', () => {
  it('RAG, data quality, red critical items and weighted progress carry codes rendered to the same English; labels in Arabic', async () => {
    // A blocking issue makes WS01 red critical.
    await pm.post(`${P()}/raid/issues`, { workstreamId: ws.get('WS01')!.id, title: 'Blocking issue (synthetic)', severity: 5 }).expect(201);
    const h = (await pm.get(`${P()}/progress`).expect(200)).body;
    const nameAr = new Map(template.workstreams.map((w) => [w.key, w.name.ar]));
    for (const w of h.workstreams) {
      rendersTo(w.rag.calculated.explanationI18n, w.rag.calculated.explanation);
      rendersTo(w.rag.explanationI18n, w.rag.explanation);
      rendersTo(w.progress.explanationI18n, w.progress.explanation);
      expect(w.dataQualityI18n.length).toBe(w.dataQuality.length);
      w.dataQuality.forEach((x: string, i: number) => rendersTo([w.dataQualityI18n[i]], x));
      for (const e of w.progress.exclusions) {
        rendersTo(e.reasonI18n, e.reason);
        expect(e.labelAr, e.label).toMatch(/^D-WS\d{2}-A\d{2} \S/);
      }
    }
    expect(h.workstreams.find((w: { code: string }) => w.code === 'WS01').dataQualityI18n.map((m: ServerMessage) => m.code)).toEqual(expect.arrayContaining(['plan.dq.no_baseline', 'plan.dq.no_lead']));
    rendersTo(h.project.aggregate.explanationI18n, h.project.aggregate.explanation);
    rendersTo(h.project.rag.explanationI18n, h.project.rag.explanation);
    rendersTo(h.project.rag.calculated.explanationI18n, h.project.rag.calculated.explanation);
    expect(h.project.aggregate.explanationI18n[0].code).toBe('plan.rag.aggregate');

    const red = h.project.redCritical.find((r: { id: string }) => r.id === ws.get('WS01')!.id);
    expect(red.labelAr).toBe(`WS01 ${nameAr.get('WS01')}`);
    expect(red.reasonI18n).toEqual([{ code: 'plan.rag.open_blocker', params: {} }]);
    rendersTo(red.reasonI18n, red.reason);

    for (const i of h.project.dataQualityIssues) rendersTo(i.issueI18n, i.issue);
    const projectLevel = h.project.dataQualityIssues.filter((i: { id: string }) => i.id === pid);
    expect(projectLevel.map((i: { labelAr: string }) => i.labelAr)).toEqual(projectLevel.map(() => 'QA-P204'));
    expect(projectLevel.map((i: { issueI18n: Messages }) => i.issueI18n[0]!.code)).toEqual(['plan.dq.project_no_baseline', 'plan.dq.schedule_incomplete']);
    // The schedule gap example names the activity by its WBS code, never by its (English) title.
    const sched = projectLevel[1].issueI18n as Messages;
    expect(sched[1]!.code).toBe('plan.dq.example.missing_duration');
    expect(String(sched[1]!.params['node'])).toMatch(/^WS\d{2}-A\d{2}$/);
    const workstreamLevel = h.project.dataQualityIssues.filter((i: { id: string }) => i.id !== pid);
    expect(workstreamLevel.length).toBeGreaterThan(0);
    for (const i of workstreamLevel) expect(i.labelAr).toBe(`${i.label.split(' ')[0]} ${nameAr.get(i.label.split(' ')[0])}`);
  });

  it('schedule and what-if assumptions: one message per assumption, same order, rendered to the same English', async () => {
    const s = (await pm.get(`${P()}/schedule`).expect(200)).body;
    expect(s.status).toBe('incomplete');
    expect(s.assumptionsI18n.length).toBe(s.assumptions.length);
    s.assumptions.forEach((a: string, i: number) => rendersTo([s.assumptionsI18n[i]], a));
    expect(s.assumptionsI18n.map((m: ServerMessage) => m.code)).toEqual(expect.arrayContaining(['plan.assumption.calendar', 'plan.assumption.drafts']));
    const node = (s.nodes as { id: string; type: string }[]).find((n) => n.type === 'task')!;
    const d = (await pm.post(`${P()}/schedule/delay-impact`, { nodeId: node.id, delayWorkingDays: 2 }).expect(201)).body;
    expect(d.assumptionsI18n.length).toBe(d.assumptions.length);
    d.assumptions.forEach((a: string, i: number) => rendersTo([d.assumptionsI18n[i]], a));
    expect(d.assumptionsI18n.at(-1).code).toBe('plan.assumption.deterministic');
  });
});

describe('QA-P2-04 — My Work titles [REQ-UX-018]', () => {
  const mine = async (c: Client) => ((await c.get('/api/v1/me/work').expect(200)).body.items as Record<string, unknown>[]).filter((i) => i['projectId'] === pid);

  it('bilingual record titles carry their Arabic; server-composed titles carry codes; free text typed by a user carries neither', async () => {
    const withAr = await task(pm, pid, ws.get('WS03')!.id, 'Owned task (synthetic)', { titleAr: 'مهمة مملوكة (تجريبية)', accountableUserId: pm.userId });
    const without = await task(pm, pid, ws.get('WS03')!.id, 'Owned task without Arabic (synthetic)', { accountableUserId: pm.userId });
    const cr = await pm.post(`${P()}/change-requests`, { title: 'Change typed by the PM (synthetic)', rationale: 'Synthetic', alternatives: ['Do nothing'], impacts: { scope: 'Synthetic' } }).expect(201);
    await pm.post(`${P()}/change-requests/${cr.body.id}/submit`, { expectedVersion: 1 }).expect(201);
    const u = await contributor.post(`${P()}/status-updates`, { workstreamId: ws.get('WS01')!.id, periodEnd: riyadhToday(), summary: 'Synthetic update', ragReported: 'green' }).expect(201);
    await contributor.post(`${P()}/status-updates/${u.body.id}/submit`, { expectedVersion: 1 }).expect(201);

    const items = await mine(pm);
    const byId = (id: string, type: string) => items.find((i) => i['entityId'] === id && i['type'] === type)!;
    expect(byId(withAr, 'task_accountable')['titleAr']).toBe('مهمة مملوكة (تجريبية)');
    expect(byId(without, 'task_accountable')).toHaveProperty('titleAr', null);
    const crItem = byId(cr.body.id, 'change_request_assess');
    expect(crItem['title']).toBe('Change typed by the PM (synthetic)');
    expect(crItem).not.toHaveProperty('titleAr');
    expect(crItem).not.toHaveProperty('titleI18n');

    const review = (await mine(secretary)).find((i) => i['entityId'] === u.body.id && i['type'] === 'status_update_review')!;
    expect(review['titleI18n']).toEqual([{ code: 'plan.work.status_update_workstream', params: { workstream: 'WS01', date: riyadhToday() } }]);
    rendersTo(review['titleI18n'] as Messages, review['title'] as string);
  });
});

describe('QA-P2-04 — decision authority reason as codes [REQ-UX-001, REQ-GOV-023]', () => {
  it('the recorded outcome returns the authority reason as authority.* codes rendered to the same English', async () => {
    const dc = await projectIdByCode(DC);
    const items = (await secretary.get(`/api/v1/projects/${dc}/decisions?status=recommended&pageSize=10`).expect(200)).body.items as { id: string }[];
    expect(items.length).toBeGreaterThan(0);
    const d = (await secretary.get(`/api/v1/projects/${dc}/decisions/${items[0]!.id}`).expect(200)).body;
    expect(d.authorityReason).toBeTruthy();
    expect(d.authorityReasonI18n[0].code).toMatch(/^authority\./);
    expect(renderMessagesEn(d.authorityReasonI18n, AUTHORITY_MESSAGES_EN)).toBe(d.authorityReason);
  });

  it('codes are returned only when the snapshot recorded the same reason (older outcomes: null, English shown)', () => {
    const codes = [{ code: 'authority.above_limit', params: {} }];
    const reason = 'Amount exceeds the committee delegated limit.';
    expect(authorityReasonI18n({ authorityReason: reason, tallySnapshot: { authority: { reason, reasonI18n: codes } } })).toEqual(codes);
    expect(authorityReasonI18n({ authorityReason: 'Another reason.', tallySnapshot: { authority: { reason, reasonI18n: codes } } })).toBeNull();
    expect(authorityReasonI18n({ authorityReason: reason, tallySnapshot: { authority: { reason } } })).toBeNull();
    expect(authorityReasonI18n({ authorityReason: reason, tallySnapshot: null })).toBeNull();
    // No stored reason: the snapshot's reason is what the page shows, so its codes apply.
    expect(authorityReasonI18n({ authorityReason: null, tallySnapshot: { authority: { reason, reasonI18n: codes } } })).toEqual(codes);
  });
});
