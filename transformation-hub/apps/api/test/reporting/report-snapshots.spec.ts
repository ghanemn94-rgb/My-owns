import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, DC, GEN, loginAs, owner, projectIdByCode, runtimePool, type Client } from '../helpers';
import { generate, loginUserId, reportUser, revokeMemberships, RP } from './report-kit';

type Section = { key: string; included: boolean; classification: string | null; figures: { key: string; value: number | null; compared: boolean; previous: number | null }[]; tables: { key: string; rows: Record<string, unknown>[]; totalRows: number }[]; notes: unknown[]; unverified: unknown[]; sourceRefs: unknown[] };
const fig = (s: { sections: Section[] }, section: string, key: string) => s.sections.find((x) => x.key === section)?.figures.find((f) => f.key === key);
const sec = (s: { sections: Section[] }, key: string) => s.sections.find((x) => x.key === key);

let dc: string;
let gen: string;
let pm: Client;
let secretary: Client;

beforeAll(async () => {
  dc = await projectIdByCode(DC);
  gen = await projectIdByCode(GEN);
  pm = await loginAs('pm');
  secretary = await loginAs('secretary');
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('REQ-RPT-001 / REQ-RPT-015 / REQ-RPT-016 report snapshots from real records, with their metadata, immutable in content', () => {
  it('every report kind is generated from the project records and carries as-of date, scope, baseline, unverified data, classification and source references', async () => {
    const meeting = (await owner().query<{ id: string }>(`select m.id from meeting m join committee c on c.id = m.committee_id where m.project_id = $1 and c.classification in ('internal','confidential') order by m.number limit 1`, [dc])).rows[0]!;
    const kinds = ['executive_summary', 'committee_pack', 'workstream_weekly', 'look_ahead', 'day1_readiness', 'tsa_exit', 'jv_closing', 'health_data_quality'];
    for (const kind of [...kinds, 'minutes']) {
      const s = await generate(pm, dc, kind === 'minutes' ? { kind, meetingId: meeting.id } : { kind });
      expect(s).toMatchObject({ kind, includesDemoData: true, complete: true });
      expect(s.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(s.asOfLocalDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const d = (await pm.get(RP(dc, `/report-snapshots/${s.id}`)).expect(200)).body;
      expect(d.integrity).toBe('verified');
      expect(d.project).toMatchObject({ id: dc, code: DC, isDemo: true });
      expect(d.asOf).toBe(s.asOf);
      expect(['public', 'internal', 'confidential', 'restricted', 'strictly_confidential']).toContain(d.classification);
      expect(d.scope).toEqual({ workstreamId: null, workstreamCode: null, workstreamName: null, workstreamNameAr: null, meetingId: kind === 'minutes' ? meeting.id : null });
      expect(d).toHaveProperty('baseline');
      expect(d.approvalLabel).toBe('Internal electronic approval — not a legally certified signature');
      expect(d.sections.length).toBeGreaterThan(0);
      for (const x of d.sections as Section[]) {
        expect(x.included).toBe(true);
        expect(x.classification).not.toBeNull();
        expect(Array.isArray(x.unverified)).toBe(true);
        expect(x.sourceRefs.length, `${kind}/${x.key} source references`).toBeGreaterThan(0);
      }
      // The database row carries the same metadata columns (REQ-RPT-015).
      const row = (await owner().query(`select kind, as_of, as_of_local_date, scope, classification, unverified_data, source_refs, content_hash, schema_version, sections from report_snapshot where id = $1`, [s.id])).rows[0];
      expect(row).toMatchObject({ kind, schema_version: 'hub.report/1', content_hash: s.contentHash, classification: d.classification });
      expect((row.sections as unknown[]).length).toBe(d.sections.length);
    }
  });

  it('IT: report figures reconcile to source queries (overdue tasks, decisions awaiting a decision)', async () => {
    const s = await generate(pm, dc, { kind: 'executive_summary' });
    const d = (await pm.get(RP(dc, `/report-snapshots/${s.id}`)).expect(200)).body;
    const today = d.asOfLocalDate as string;
    const overdue = (
      await owner().query<{ n: number }>(
        `select count(*)::int as n from task where project_id = $1 and status not in ('draft','accepted','done','cancelled') and coalesce(forecast_finish, planned_finish) < $2::date`,
        [dc, today],
      )
    ).rows[0]!.n;
    expect(fig(d, 'delays', 'overdue_tasks')?.value).toBe(overdue);
    const pending = (
      await owner().query<{ n: number }>(`select count(*)::int as n from decision where project_id = $1 and status in ('submitted','under_review','recommended') and classification in ('public','internal','confidential')`, [dc])
    ).rows[0]!.n;
    expect(fig(d, 'decisions_needed', 'decisions_pending')?.value).toBe(pending);
    expect(sec(d, 'decisions_needed')!.tables[0]!.totalRows).toBe(pending);
  });

  it('UT: snapshot hash unchanged after source edits — a later snapshot shows the change against the previous one', async () => {
    const first = await generate(pm, dc, { kind: 'executive_summary' });
    const before = (await pm.get(RP(dc, `/report-snapshots/${first.id}`)).expect(200)).body;
    const overdueBefore = fig(before, 'delays', 'overdue_tasks')!.value!;
    // Edit a source record: one open task becomes overdue.
    const t = (await owner().query<{ id: string; planned_finish: string | null; forecast_finish: string | null }>(
      `select id, planned_finish::text, forecast_finish::text from task where project_id = $1 and status in ('not_started','in_progress') and (coalesce(forecast_finish, planned_finish) is null or coalesce(forecast_finish, planned_finish) >= $2::date) order by wbs_code limit 1`,
      [dc, before.asOfLocalDate],
    )).rows[0]!;
    await owner().query(`update task set forecast_finish = '2020-01-01' where id = $1`, [t.id]);
    try {
      const again = (await pm.get(RP(dc, `/report-snapshots/${first.id}`)).expect(200)).body;
      expect(again.contentHash).toBe(first.contentHash);
      expect(again.integrity).toBe('verified');
      expect(fig(again, 'delays', 'overdue_tasks')!.value).toBe(overdueBefore);
      expect(again.sections).toEqual(before.sections);
      const second = await generate(pm, dc, { kind: 'executive_summary' });
      expect(second.contentHash).not.toBe(first.contentHash);
      expect(second.previousSnapshotId).toBe(first.id);
      const after = (await pm.get(RP(dc, `/report-snapshots/${second.id}`)).expect(200)).body;
      expect(fig(after, 'delays', 'overdue_tasks')).toMatchObject({ value: overdueBefore + 1, compared: true, previous: overdueBefore });
      const diff = (await pm.get(RP(dc, `/report-snapshots/${second.id}/diff`)).expect(200)).body;
      expect(diff.againstSnapshotId).toBe(first.id);
      expect(diff.changes).toContainEqual({ section: 'delays', key: 'overdue_tasks', before: overdueBefore, after: overdueBefore + 1, delta: 1 });
    } finally {
      await owner().query(`update task set forecast_finish = $2::date where id = $1`, [t.id, t.forecast_finish]);
    }
  });

  it('DB trigger rejects update of snapshot content; content hash stored (UPDATE / DELETE refused for the runtime role and the owner)', async () => {
    const s = await generate(pm, dc, { kind: 'look_ahead' });
    await expect(runtimePool().query(`update report_snapshot set payload = '{}'::jsonb where id = $1`, [s.id])).rejects.toThrow(/permission denied/);
    await expect(runtimePool().query(`delete from report_snapshot where id = $1`, [s.id])).rejects.toThrow(/permission denied/);
    await expect(owner().query(`update report_snapshot set classification = 'public' where id = $1`, [s.id])).rejects.toThrow(/append_only_violation/);
    await expect(owner().query(`delete from report_snapshot where id = $1`, [s.id])).rejects.toThrow(/append_only_violation/);
    const row = (await owner().query(`select content_hash from report_snapshot where id = $1`, [s.id])).rows[0];
    expect(row.content_hash).toBe(s.contentHash);
  });

  it('committee packs and minutes are committee records: they also need reports.snapshot.create (finance member: 403; executive summary allowed)', async () => {
    const finance = await loginAs('finance');
    const r = await finance.post(RP(dc, '/report-snapshots'), { kind: 'committee_pack' });
    expect(r.status).toBe(403);
    await generate(finance, dc, { kind: 'executive_summary' });
  });

  it('validation: minutes need a meeting; only weekly / look-ahead take a workstream; another project’s workstream is unknown (404)', async () => {
    expect((await pm.post(RP(dc, '/report-snapshots'), { kind: 'minutes' })).status).toBe(400);
    const ws = (await owner().query<{ id: string }>(`select id from workstream where project_id = $1 limit 1`, [dc])).rows[0]!.id;
    expect((await pm.post(RP(dc, '/report-snapshots'), { kind: 'executive_summary', workstreamId: ws })).status).toBe(400);
    const otherWs = (await owner().query<{ id: string }>(`select id from workstream where project_id = $1 limit 1`, [gen])).rows[0]!.id;
    expect((await pm.post(RP(dc, '/report-snapshots'), { kind: 'workstream_weekly', workstreamId: otherWs })).status).toBe(404);
    const weekly = await generate(pm, dc, { kind: 'workstream_weekly', workstreamId: ws });
    expect(weekly.scope.workstreamId).toBe(ws);
    const d = (await pm.get(RP(dc, `/report-snapshots/${weekly.id}`)).expect(200)).body;
    expect(sec(d, 'look_ahead')).toBeTruthy();
  });

  it('UT: weekly report uses accepted updates only', async () => {
    const s = await generate(pm, dc, { kind: 'workstream_weekly' });
    const d = (await pm.get(RP(dc, `/report-snapshots/${s.id}`)).expect(200)).body;
    const accepted = (await owner().query<{ n: number }>(`select count(distinct workstream_id)::int as n from status_update where project_id = $1 and status = 'accepted'`, [dc])).rows[0]!.n;
    const notAccepted = (await owner().query<{ id: string }>(`select id from status_update where project_id = $1 and status <> 'accepted'`, [dc])).rows.map((r) => r.id);
    expect(fig(d, 'status_updates', 'accepted_updates')!.value).toBe(accepted);
    const refs = (sec(d, 'status_updates')!.sourceRefs as { id: string }[]).map((r) => r.id);
    for (const id of notAccepted) expect(refs).not.toContain(id);
  });
});

describe('REQ-RPT-017 / AT-03 / REQ-SEC-007 the viewer’s permissions are re-checked on every access', () => {
  it('IT: user removed from project cannot open earlier snapshot (404) and no longer lists it', async () => {
    const uid = await reportUser('removed', 'confidential', [{ role: 'project_manager' }]);
    const u = await loginUserId(uid);
    const s = await generate(u, dc, { kind: 'executive_summary' });
    await u.get(RP(dc, `/report-snapshots/${s.id}`)).expect(200);
    await revokeMemberships(uid, dc);
    await u.get(RP(dc, `/report-snapshots/${s.id}`)).expect(404);
    await u.get(RP(dc, '/report-snapshots')).expect(404);
    await u.get(RP(dc, `/report-snapshots/${s.id}/diff`)).expect(404);
  });

  it('AT-03: a Project B user gets 404 for Project A snapshots, by Project A’s path and by their own project’s path', async () => {
    const s = await generate(pm, dc, { kind: 'executive_summary' });
    const pmB = await loginAs('pm.b');
    const a = await pmB.get(RP(dc, `/report-snapshots/${s.id}`));
    expect(a.status).toBe(404);
    expect(JSON.stringify(a.body)).not.toContain(s.title);
    await pmB.get(RP(gen, `/report-snapshots/${s.id}`)).expect(404);
    await pmB.get(RP(gen, `/report-snapshots/${s.id}/diff`)).expect(404);
    const list = (await pmB.get(RP(gen, '/report-snapshots')).expect(200)).body;
    expect(list.items.map((x: { id: string }) => x.id)).not.toContain(s.id);
  });

  it('a section the viewer cannot read now is returned without any content; the rest stays readable', async () => {
    const s = await generate(pm, dc, { kind: 'committee_pack' });
    const lead = await loginAs('tech.lead'); // contributor project-wide + workstream lead WS06 — finance only through WS06
    const d = (await lead.get(RP(dc, `/report-snapshots/${s.id}`)).expect(200)).body;
    expect(d.complete).toBe(false);
    const fin = sec(d, 'financials')!;
    expect(fin).toEqual({ key: 'financials', included: false, classification: null, workstreamScope: null, figures: [], tables: [], notes: [], unverified: [], sourceRefs: [] });
    expect(sec(d, 'delays')!.included).toBe(true);
    // The list counts only what the viewer may see.
    const list = (await lead.get(RP(dc, '/report-snapshots?kind=committee_pack&pageSize=100')).expect(200)).body;
    const item = list.items.find((x: { id: string }) => x.id === s.id);
    expect(item).toMatchObject({ complete: false });
    expect(item.includedSectionCount).toBeLessThan(item.sectionCount);
  });

  it('clearance lowered after generation: nothing left to show → 404 (no title, no count)', async () => {
    const uid = await reportUser('lowered', 'confidential', [{ role: 'project_manager' }]);
    const u = await loginUserId(uid);
    const s = await generate(u, dc, { kind: 'executive_summary' });
    await owner().query(`update app_user set clearance = 'internal' where id = $1`, [uid]);
    const r = await u.get(RP(dc, `/report-snapshots/${s.id}`));
    expect(r.status).toBe(404);
    const list = (await u.get(RP(dc, '/report-snapshots?pageSize=100')).expect(200)).body;
    expect(list.items.map((x: { id: string }) => x.id)).not.toContain(s.id);
  });

  it('a record-class permission lost after generation withholds that section (project manager → contributor: financials withheld)', async () => {
    const uid = await reportUser('demoted', 'confidential', [{ role: 'project_manager' }]);
    const u = await loginUserId(uid);
    const s = await generate(u, dc, { kind: 'committee_pack' });
    expect(sec((await u.get(RP(dc, `/report-snapshots/${s.id}`)).expect(200)).body, 'financials')!.included).toBe(true);
    await revokeMemberships(uid, dc);
    await owner().query(`insert into project_membership (org_id, project_id, user_id, role, reason) select org_id, $1, $2, 'contributor', 'Reporting test: demoted' from project where id = $1`, [dc, uid]);
    const d = (await u.get(RP(dc, `/report-snapshots/${s.id}`)).expect(200)).body;
    expect(sec(d, 'financials')!.included).toBe(false);
    expect(sec(d, 'financials')!.tables).toEqual([]);
    expect(sec(d, 'delays')!.included).toBe(true);
  });

  it('REQ-GOV-026 IT: export by lower-clearance user omits restricted items — a restricted decision is in the secretary’s pack only; the PM’s own pack omits it and the secretary’s decisions are withheld from the PM', async () => {
    const committeeId = (await owner().query<{ id: string }>(`select id from committee where project_id = $1 and classification in ('internal','confidential') order by created_at limit 1`, [dc])).rows[0]!.id;
    const created = await secretary.post(RP(dc, '/decisions'), { committeeId, title: 'Restricted reporting probe paper (Demo)', classification: 'restricted', latestSafeDate: '2026-12-31', evidenceNoneReason: 'Reporting test probe' });
    expect(created.status).toBe(201);
    try {
    const code = (await owner().query<{ code: string }>(`select code from decision where id = $1`, [created.body.id])).rows[0]!.code;
    const mine = await generate(secretary, dc, { kind: 'committee_pack' });
    const sd = (await secretary.get(RP(dc, `/report-snapshots/${mine.id}`)).expect(200)).body;
    expect(sec(sd, 'decisions')!.classification).toBe('restricted');
    expect(JSON.stringify(sec(sd, 'decisions')!.tables)).toContain(code);
    // The PM (confidential) cannot read that section of the secretary's pack …
    const pv = (await pm.get(RP(dc, `/report-snapshots/${mine.id}`)).expect(200)).body;
    expect(sec(pv, 'decisions')!.included).toBe(false);
    expect(JSON.stringify(pv)).not.toContain(code);
    expect(JSON.stringify(pv)).not.toContain('Restricted reporting probe');
    // … and the PM's own pack never contains it.
    const theirs = await generate(pm, dc, { kind: 'committee_pack' });
    const td = (await pm.get(RP(dc, `/report-snapshots/${theirs.id}`)).expect(200)).body;
    expect(sec(td, 'decisions')!.included).toBe(true);
    expect(JSON.stringify(td)).not.toContain(code);
    } finally {
      // Leave the shared demo data as it was for the suites that run after this one.
      await owner().query(`delete from decision where id = $1`, [created.body.id]);
    }
  });
});
