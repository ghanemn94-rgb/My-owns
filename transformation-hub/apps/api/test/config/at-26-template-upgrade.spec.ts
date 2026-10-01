import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProjectTemplateDefinition } from '@hub/domain';
import { closeApp, closePools, loginAs, owner, projectIdByCode, Client, DC } from '../helpers';
import { grant } from '../planning/fixtures';

/**
 * AT-26 / REQ-ENT-009 (spec §5 "A project keeps a stable template version; updates require preview and approval and must
 * not silently reshape existing projects"): a template already used by a project gets a newer version; the project manager
 * previews what would change, proposes the reviewed plan, and only the sponsor's approval (never the proposer's) applies it
 * — exactly as previewed, adding the new elements and changing nothing that exists.
 *
 * The structural case uses a SYNTHETIC test template (`zz-test-upgrade`, versions 1 and 2 derived from the general
 * transformation template, plus an unpublished draft 3) written directly to the test database; the shipped case uses the
 * real general-transformation versions 1 → 2 (Arabic KPI texts, QA-P5-07).
 */
const TEMPLATES = join(__dirname, '..', '..', '..', '..', 'packages', 'db', 'seed', 'templates');
const gen1 = JSON.parse(readFileSync(join(TEMPLATES, 'general-transformation.v1.json'), 'utf8')) as ProjectTemplateDefinition;

let admin: Client;
let pm: Client;
let sponsor: Client;
let contributor: Client;
const tpl = { templateId: '', v1: '', v2: '', v3: '' };

function v2Of(v1: ProjectTemplateDefinition): ProjectTemplateDefinition {
  const d = structuredClone(v1);
  d.version = 2;
  const t3 = d.gates.find((g) => g.key === 'T3')!;
  d.gates.push({
    ...structuredClone(t3),
    key: 'T4',
    order: 4,
    name: { en: 'Test gate T4 (synthetic)', ar: 'بوابة الاختبار الرابعة (تجريبية)' },
    prerequisiteGateKeys: ['T3'],
    criteria: t3.criteria.slice(0, 2).map((c, i) => ({ ...structuredClone(c), key: `T4-C0${i + 1}` })),
  });
  const t1 = d.gates.find((g) => g.key === 'T1')!;
  t1.criteria = t1.criteria.filter((c) => c.key !== 'T1-C05');
  const t2 = d.gates.find((g) => g.key === 'T2')!;
  t2.criteria.push({ ...structuredClone(t2.criteria[0]!), key: 'T2-C06' });
  d.phases.at(-1)!.gateKeys.push('T4');
  d.workstreams.push({ ...structuredClone(d.workstreams.find((w) => w.key === 'WS04')!), key: 'WS05', name: { en: 'Test workstream WS05 (synthetic)', ar: 'مسار الاختبار الخامس (تجريبي)' }, linkedGates: ['T4'] });
  const a01 = d.wbs.find((a) => a.id === 'WS01-A01')!;
  d.wbs.push({ ...structuredClone(a01), id: 'WS01-A99', title: { en: 'Added activity WS01-A99 (synthetic)', ar: 'نشاط مضاف (تجريبي)' }, prerequisites: ['WS01-A01'], gateKey: 'T4' });
  d.wbs.push({ ...structuredClone(a01), id: 'WS05-A01', workstreamKey: 'WS05', title: { en: 'Added activity WS05-A01 (synthetic)', ar: 'نشاط مضاف في المسار الخامس (تجريبي)' }, prerequisites: ['WS01-A99'], gateKey: 'T4', isDeliverable: false });
  d.wbs.find((a) => a.id === 'WS02-A01')!.title = { en: 'Renamed activity in version 2 (synthetic)', ar: 'نشاط معاد تسميته (تجريبي)' };
  d.wbs = d.wbs.filter((a) => a.id !== 'WS04-A03');
  d.wbs.find((a) => a.id === 'WS04-A04')!.prerequisites = ['WS02-A04'];
  d.kpis.push({ ...structuredClone(d.kpis[0]!), key: 'zz_test_kpi', name: { en: 'Synthetic test KPI', ar: 'مؤشر اختبار تجريبي' } });
  d.kpis = d.kpis.filter((k) => k.key !== 'benefits_realized');
  d.kpis.find((k) => k.key === 'overdue_decisions')!.formula = `${gen1.kpis.find((k) => k.key === 'overdue_decisions')!.formula} (revised in version 2)`;
  return d;
}

/** Test-only: a synthetic template with two published versions and one draft (the production path publishes template files). */
async function syntheticTemplate() {
  const org = (await owner().query(`select org_id from project where code = $1`, [DC])).rows[0].org_id as string;
  const t = await owner().query(`insert into project_template (id, org_id, key, kind, name, description) values (gen_random_uuid(), $1, 'zz-test-upgrade', 'general_transformation', 'Upgrade test template (synthetic)', 'AT-26 integration test') returning id`, [org]);
  tpl.templateId = t.rows[0].id;
  const v1 = { ...structuredClone(gen1), key: 'zz-test-upgrade' } as ProjectTemplateDefinition;
  const v2 = v2Of(v1);
  const v3 = { ...structuredClone(v2), version: 3 };
  const ins = async (n: number, def: unknown, status: string) =>
    (
      await owner().query(
        `insert into project_template_version (id, org_id, template_id, version_no, status, definition, definition_hash, change_summary, published_at)
         values (gen_random_uuid(), $1, $2, $3, $4::template_version_status, $5, $6, 'synthetic test version', $7::timestamptz) returning id`,
        [org, tpl.templateId, n, status, JSON.stringify(def), `test-hash-${n}`, status === 'published' ? new Date().toISOString() : null],
      )
    ).rows[0].id as string;
  tpl.v1 = await ins(1, v1, 'published');
  tpl.v2 = await ins(2, v2, 'published');
  tpl.v3 = await ins(3, v3, 'draft');
}

async function newProject(code: string, templateVersionId: string): Promise<string> {
  const r = await admin.post('/api/v1/projects', { templateVersionId, code, name: `${code} template upgrade test (synthetic)`, classification: 'internal', projectManagerUserId: pm.userId }).expect(201);
  await grant(admin, r.body.id, sponsor, 'sponsor');
  await grant(pm, r.body.id, contributor, 'contributor');
  return r.body.id as string;
}

const snapshot = async (pid: string) => {
  const q = async (sql: string) => (await owner().query(sql, [pid])).rows;
  return {
    version: (await q(`select template_version_id as v from project where id = $1`))[0].v,
    gates: (await q(`select key from gate_definition where project_id = $1 order by key`)).map((r) => r.key),
    criteria: (await q(`select c.key from gate_criterion c where c.project_id = $1 order by c.key`)).map((r) => r.key),
    workstreams: (await q(`select code from workstream where project_id = $1 order by code`)).map((r) => r.code),
    tasks: (await q(`select coalesce(template_activity_id, wbs_code) as k, title from task where project_id = $1 order by 1`)).map((r) => `${r.k}:${r.title}`),
    milestones: (await q(`select code from milestone where project_id = $1 order by code`)).map((r) => r.code),
    kpis: (await q(`select key, formula from kpi where project_id = $1 order by key`)).map((r) => `${r.key}:${r.formula}`),
    deps: Number((await q(`select count(*)::int n from dependency where project_id = $1`))[0].n),
  };
};

beforeAll(async () => {
  admin = await loginAs('portfolio.admin');
  pm = await loginAs('pm');
  sponsor = await loginAs('sponsor');
  contributor = await loginAs('contributor');
  await syntheticTemplate();
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('AT-26 — change a template already used by projects: explicit preview and approved migration, nothing retroactive [REQ-ENT-009]', () => {
  let pid: string;
  let base: string;
  let before: Awaited<ReturnType<typeof snapshot>>;
  let planHash: string;

  it('IT: upgrade preview lists added/removed gates; nothing changes before approval', async () => {
    pid = await newProject('AT26-UPG', tpl.v1);
    base = `/api/v1/projects/${pid}`;
    before = await snapshot(pid);
    const list = (await pm.get(`${base}/template-upgrades`).expect(200)).body;
    expect(list.current).toMatchObject({ templateKey: 'zz-test-upgrade', versionNo: 1, versionId: tpl.v1 });
    expect(list.available.map((v: { versionNo: number }) => v.versionNo)).toEqual([2]); // the draft 3 is not offered
    expect(list.items).toEqual([]);

    const pv = await pm.post(`${base}/template-upgrades/preview`, { toVersionId: tpl.v2 });
    expect(pv.status, JSON.stringify(pv.body)).toBe(201);
    const plan = pv.body.plan;
    planHash = pv.body.planHash;
    expect(plan).toMatchObject({ templateKey: 'zz-test-upgrade', fromVersionNo: 1, toVersionNo: 2, versionOnly: false });
    expect(plan.diff.addedGates).toEqual(['T4']);
    expect(plan.diff.removedGates).toEqual([]);
    expect(plan.diff.changedGates).toEqual(['T1', 'T2']);
    expect(plan.add.gates).toEqual([{ key: 'T4', name: { en: 'Test gate T4 (synthetic)', ar: 'بوابة الاختبار الرابعة (تجريبية)' }, criteria: 2 }]);
    expect(plan.add.workstreams.map((w: { key: string }) => w.key)).toEqual(['WS05']);
    expect(plan.add.activities.map((a: { id: string }) => a.id)).toEqual(['WS01-A99', 'WS05-A01']);
    expect(plan.add.kpis.map((k: { key: string }) => k.key)).toEqual(['zz_test_kpi']);
    expect(plan.keep).toEqual(
      expect.arrayContaining([
        { kind: 'gate', key: 'T1', reason: 'changed_in_new_version' },
        { kind: 'criterion', key: 'T1-C05', reason: 'removed_in_new_version' },
        { kind: 'criterion', key: 'T2-C06', reason: 'added_to_existing_gate' },
        { kind: 'activity', key: 'WS04-A03', reason: 'removed_in_new_version' },
        { kind: 'activity', key: 'WS02-A01', reason: 'changed_in_new_version' },
        { kind: 'activity', key: 'WS04-A04', reason: 'changed_in_new_version' },
        { kind: 'kpi', key: 'benefits_realized', reason: 'removed_in_new_version' },
        { kind: 'kpi', key: 'overdue_decisions', reason: 'changed_in_new_version' },
      ]),
    );
    expect(plan.texts.phasesChanged).toEqual(['close']);
    // Nothing changed: same version pin, same records.
    expect(await snapshot(pid)).toEqual(before);
  });

  it('only a newer published version of the same template can be previewed; unknown versions are 404', async () => {
    expect((await pm.post(`${base}/template-upgrades/preview`, { toVersionId: tpl.v3 })).body.code).toBe('config.template_upgrade.not_published');
    expect((await pm.post(`${base}/template-upgrades/preview`, { toVersionId: tpl.v1 })).body.code).toBe('config.template_upgrade.not_newer');
    const dcV = (await owner().query(`select v.id from project_template_version v join project_template t on t.id = v.template_id where t.key = 'dc-carveout' and v.version_no = 2`)).rows[0].id;
    expect((await pm.post(`${base}/template-upgrades/preview`, { toVersionId: dcV })).body.code).toBe('config.template_upgrade.other_template');
    expect((await pm.post(`${base}/template-upgrades/preview`, { toVersionId: '00000000-0000-4000-8000-000000000000' })).status).toBe(404);
  });

  it('a proposal names the preview it was reviewed on; one open proposal per project; a reader without the permission cannot propose', async () => {
    expect((await contributor.post(`${base}/template-upgrades`, { toVersionId: tpl.v2, planHash, reason: 'probe' })).status).toBe(403);
    const wrong = await pm.post(`${base}/template-upgrades`, { toVersionId: tpl.v2, planHash: '0'.repeat(64), reason: 'Adopt version 2 (synthetic)' });
    expect(wrong.status).toBe(409);
    expect(wrong.body.code).toBe('config.template_upgrade.preview_changed');
    const ok = await pm.post(`${base}/template-upgrades`, { toVersionId: tpl.v2, planHash, reason: 'Adopt version 2 (synthetic)' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body).toMatchObject({ status: 'proposed', fromVersionNo: 1, toVersionNo: 2, planHash, proposedBy: pm.userId, current: true, result: null });
    expect((await pm.post(`${base}/template-upgrades`, { toVersionId: tpl.v2, planHash, reason: 'twice' })).body.code).toBe('config.template_upgrade.proposal_pending');
    expect(await snapshot(pid)).toEqual(before);
  });

  it('the proposer cannot approve; a plan that no longer matches the project is refused (409) and can be rejected with a reason', async () => {
    const list = (await pm.get(`${base}/template-upgrades`).expect(200)).body;
    const up = list.items[0];
    expect((await pm.post(`${base}/template-upgrades/${up.id}/approve`, { expectedVersion: up.version })).status).toBe(403);
    // The project changes after the preview: a KPI with the key the upgrade would add is created by hand.
    const k = await pm.post(`${base}/kpis`, {
      key: 'zz_test_kpi',
      name: 'Hand-made KPI (synthetic)',
      definition: 'Created after the preview (test)',
      formula: 'count(x)',
      unit: 'count',
      period: 'weekly',
      ownerRole: 'project_manager',
      source: 'test',
      thresholds: { green: 'a', amber: 'b', red: 'c' },
      direction: 'lower_is_better',
      frequency: 'weekly',
    });
    expect(k.status, JSON.stringify(k.body)).toBe(201);
    expect((await pm.get(`${base}/template-upgrades/${up.id}`).expect(200)).body.current).toBe(false);
    const stale = await sponsor.post(`${base}/template-upgrades/${up.id}/approve`, { expectedVersion: up.version });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('config.template_upgrade.preview_stale');
    expect((await owner().query(`select template_version_id from project where id = $1`, [pid])).rows[0].template_version_id).toBe(tpl.v1);
    expect((await sponsor.post(`${base}/template-upgrades/${up.id}/reject`, { expectedVersion: up.version })).status).toBe(400);
    const rj = await sponsor.post(`${base}/template-upgrades/${up.id}/reject`, { expectedVersion: up.version, reason: 'The project changed; preview again (synthetic)' });
    expect(rj.status, JSON.stringify(rj.body)).toBe(201);
    expect(rj.body).toMatchObject({ status: 'rejected', decidedBy: sponsor.userId, decisionNote: 'The project changed; preview again (synthetic)' });
  });

  it('the sponsor approves the re-previewed plan: it is applied exactly — new elements created as proposals, existing records unchanged, project re-pinned', async () => {
    before = await snapshot(pid);
    const pv = (await pm.post(`${base}/template-upgrades/preview`, { toVersionId: tpl.v2 }).expect(201)).body;
    expect(pv.plan.add.kpis).toEqual([]); // the hand-made KPI now holds that key
    const up = (await pm.post(`${base}/template-upgrades`, { toVersionId: tpl.v2, planHash: pv.planHash, reason: 'Adopt version 2, second preview (synthetic)' }).expect(201)).body;
    const ok = await sponsor.post(`${base}/template-upgrades/${up.id}/approve`, { expectedVersion: up.version, note: 'Approved as previewed (synthetic)' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body).toMatchObject({ status: 'applied', decidedBy: sponsor.userId, decisionNote: 'Approved as previewed (synthetic)', result: { workstreams: 1, gates: 1, criteria: 2, tasks: 2, milestones: 0, kpis: 0 } });
    expect(ok.body.result.dependencies).toBe(2); // WS01-A01 → WS01-A99 → WS05-A01
    expect(ok.body.appliedAt).not.toBeNull();
    const after = await snapshot(pid);
    expect(after.version).toBe(tpl.v2);
    expect(after.gates).toEqual([...before.gates, 'T4']);
    // Criteria of existing gates are not changed retroactively: T1-C05 stays, T2-C06 is not added.
    expect(after.criteria).toEqual([...before.criteria, 'T4-C01', 'T4-C02'].sort());
    expect(after.criteria).toContain('T1-C05');
    expect(after.criteria).not.toContain('T2-C06');
    expect(after.workstreams).toEqual([...before.workstreams, 'WS05']);
    // Existing activities keep their titles (WS02-A01 renamed in v2) and the removed one stays; only the two new are added.
    expect(after.tasks.filter((t) => !before.tasks.includes(t)).map((t) => t.split(':')[0])).toEqual(['WS01-A99', 'WS05-A01']);
    expect(before.tasks.every((t) => after.tasks.includes(t))).toBe(true);
    expect(after.kpis).toEqual(before.kpis); // benefits_realized kept, overdue_decisions formula unchanged
    expect(after.deps).toBe(before.deps + 2);
    // New elements are proposals: draft tasks, a not-started first gate cycle with unmet criteria.
    const t = await owner().query(`select status::text, verification_status::text from task where project_id = $1 and template_activity_id in ('WS01-A99', 'WS05-A01')`, [pid]);
    expect(t.rows.every((r) => r.status === 'draft' && r.verification_status === 'proposed')).toBe(true);
    const g = await owner().query(`select a.status::text, a.cycle, (select count(*)::int from criterion_assessment ca where ca.assessment_id = a.id and ca.status = 'unmet') as unmet from gate_assessment a join gate_definition d on d.id = a.gate_id where d.project_id = $1 and d.key = 'T4'`, [pid]);
    expect(g.rows).toEqual([{ status: 'not_started', cycle: 1, unmet: 2 }]);
    // The gates screen and the project overview read the new version (phases from the pinned version).
    const gates = (await pm.get(`${base}/gates`).expect(200)).body.items as { key: string }[];
    expect(gates.map((x) => x.key)).toContain('T4');
    const p = (await pm.get(base).expect(200)).body;
    expect(p.templateVersionNo).toBe(2);
    expect(p.phases.find((ph: { key: string }) => ph.key === 'close').gateKeys).toEqual(['T3', 'T4']);
    // Audited (propose, reject, propose, approve) and visible in the project activity of a template reader.
    const audit = await owner().query(`select action from audit_event where project_id = $1 and entity_type = 'project_template_migration' and outcome = 'success' order by seq`, [pid]);
    expect(audit.rows.map((r) => r.action)).toEqual(['config.template_upgrade.propose', 'config.template_upgrade.reject', 'config.template_upgrade.propose', 'config.template_upgrade.approve']);
    const feed = (await pm.get(`${base}/activity?entityType=project_template_migration`).expect(200)).body;
    expect(feed.total).toBe(4);
    // An applied upgrade is final.
    expect((await sponsor.post(`${base}/template-upgrades/${up.id}/approve`, { expectedVersion: ok.body.version })).body.code).toBe('config.template_upgrade.invalid_transition');
    expect((await pm.get(`${base}/template-upgrades`).expect(200)).body.available).toEqual([]);
  });

  it('separation of duties: a sponsor who is also the project manager cannot approve their own proposal (audited)', async () => {
    const other = await newProject('AT26-SOD', tpl.v1);
    await grant(admin, other, sponsor, 'project_manager');
    const ob = `/api/v1/projects/${other}`;
    const pv = (await sponsor.post(`${ob}/template-upgrades/preview`, { toVersionId: tpl.v2 }).expect(201)).body;
    const up = (await sponsor.post(`${ob}/template-upgrades`, { toVersionId: tpl.v2, planHash: pv.planHash, reason: 'Self-approval probe (synthetic)' }).expect(201)).body;
    const self = await sponsor.post(`${ob}/template-upgrades/${up.id}/approve`, { expectedVersion: up.version });
    expect(self.status).toBe(403);
    expect(self.body.detail).toMatch(/Separation of duties/);
    expect((await owner().query(`select count(*)::int n from audit_event where actor_user_id = $1 and outcome = 'denied' and action = 'config.approveTemplateUpgrade'`, [sponsor.userId])).rows[0].n).toBeGreaterThanOrEqual(1);
    expect((await owner().query(`select template_version_id from project where id = $1`, [other])).rows[0].template_version_id).toBe(tpl.v1);
  });

  it('isolation: another project’s manager gets 404 for the upgrades, the preview and an upgrade id', async () => {
    const pmB = await loginAs('pm.b');
    expect((await pmB.get(`${base}/template-upgrades`)).status).toBe(404);
    expect((await pmB.post(`${base}/template-upgrades/preview`, { toVersionId: tpl.v2 })).status).toBe(404);
    const up = (await pm.get(`${base}/template-upgrades`).expect(200)).body.items[0];
    const dc = await projectIdByCode(DC);
    expect((await pm.get(`/api/v1/projects/${dc}/template-upgrades/${up.id}`)).status).toBe(404);
  });
});

describe('AT-26 / QA-P5-07 — the shipped general-transformation version 2 (Arabic KPI texts) reaches a version-1 project only through an approved upgrade [REQ-ENT-009]', () => {
  it('a project on version 1 shows no Arabic formula; after the approved upgrade the template KPIs carry the version-2 Arabic texts and nothing else changed', async () => {
    const versions = (await admin.get('/api/v1/templates').expect(200)).body.items as { id: string; templateKey: string; versionNo: number }[];
    const g1 = versions.find((v) => v.templateKey === 'general-transformation' && v.versionNo === 1)!;
    const g2 = versions.find((v) => v.templateKey === 'general-transformation' && v.versionNo === 2)!;
    const pid = await newProject('AT26-GEN', g1.id);
    const base = `/api/v1/projects/${pid}`;
    const fin = await loginAs('finance');
    await grant(pm, pid, fin, 'finance_restricted');
    const kpis = async () => (await fin.get(`${base}/kpis?pageSize=100`).expect(200)).body.items as { key: string; formula: string; formulaAr: string | null; sourceAr: string | null; thresholdsAr: unknown; definitionAr: string | null }[];
    const v1 = await kpis();
    expect(v1.length).toBe(5);
    expect(v1.every((k) => k.formulaAr === null && k.sourceAr === null && k.thresholdsAr === null)).toBe(true);
    expect(v1.every((k) => !!k.definitionAr)).toBe(true);
    const before = await snapshot(pid);
    const pv = (await pm.post(`${base}/template-upgrades/preview`, { toVersionId: g2.id }).expect(201)).body;
    expect(pv.plan.texts.kpisArabic.sort()).toEqual(v1.map((k) => k.key).sort());
    expect(pv.plan.add).toEqual({ workstreams: [], gates: [], activities: [], kpis: [] });
    expect(pv.plan.keep).toEqual([]);
    expect(pv.plan.ragDefaults).toEqual({ from: { greenMaxSlipDays: 0, amberMaxSlipDays: 10, staleAfterDays: 14 }, to: { greenMaxSlipDays: 0, amberMaxSlipDays: 10, staleAfterDays: 14 }, changed: false, appliesToProject: true });
    // Not yet approved: still no Arabic.
    const up = (await pm.post(`${base}/template-upgrades`, { toVersionId: g2.id, planHash: pv.planHash, reason: 'Arabic KPI texts (QA-P5-07)' }).expect(201)).body;
    expect((await kpis()).every((k) => k.formulaAr === null)).toBe(true);
    await sponsor.post(`${base}/template-upgrades/${up.id}/approve`, { expectedVersion: up.version }).expect(201);
    const v2 = await kpis();
    const g2def = JSON.parse(readFileSync(join(TEMPLATES, 'general-transformation.v2.json'), 'utf8')) as ProjectTemplateDefinition;
    for (const k of v2) {
      const t = g2def.kpis.find((x) => x.key === k.key)!;
      expect(k).toMatchObject({ formula: t.formula, formulaAr: t.formulaAr, sourceAr: t.sourceAr, thresholdsAr: t.thresholdsAr });
    }
    const after = await snapshot(pid);
    expect({ ...after, version: before.version }).toEqual(before); // no record created, changed or removed
  });
});

describe('REQ-ENT-008 — a project stays on its template version when a newer version is published [AT-26]', () => {
  it('UT: publishing new version leaves existing project on old version — nothing in the project changes; the version is only offered as an upgrade', async () => {
    // A second synthetic template with only version 1 published; a project is created on it, THEN version 2 is published.
    const org = (await owner().query(`select org_id from project where code = $1`, [DC])).rows[0].org_id as string;
    const t = (await owner().query(`insert into project_template (id, org_id, key, kind, name, description) values (gen_random_uuid(), $1, 'zz-test-publish', 'general_transformation', 'Publish test template (synthetic)', 'REQ-ENT-008 integration test') returning id`, [org])).rows[0].id as string;
    const ins = async (n: number, def: unknown) =>
      (
        await owner().query(
          `insert into project_template_version (id, org_id, template_id, version_no, status, definition, definition_hash, change_summary, published_at)
           values (gen_random_uuid(), $1, $2, $3, 'published'::template_version_status, $4, $5, 'synthetic test version', now()) returning id`,
          [org, t, n, JSON.stringify(def), `test-publish-hash-${n}`],
        )
      ).rows[0].id as string;
    const v1 = { ...structuredClone(gen1), key: 'zz-test-publish' } as ProjectTemplateDefinition;
    const p1 = await ins(1, v1);
    const pid = await newProject('ENT8-PUB', p1);
    const before = await snapshot(pid);
    const p2 = await ins(2, v2Of(v1));
    const after = await snapshot(pid);
    expect(after).toEqual(before);
    expect(after.version).toBe(p1);
    const list = (await pm.get(`/api/v1/projects/${pid}/template-upgrades`).expect(200)).body;
    expect(list.current).toMatchObject({ templateKey: 'zz-test-publish', versionNo: 1, versionId: p1 });
    expect(list.available.map((v: { versionId: string }) => v.versionId)).toEqual([p2]);
    expect(list.items).toEqual([]);
    expect((await pm.get(`/api/v1/projects/${pid}`).expect(200)).body.templateVersionNo).toBe(1);
  });
});
