import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, DC, GEN, getApp, loginAs, owner, projectIdByCode, runtimePool, type Client } from '../helpers';
import { drainWorker, login, type DocClient } from '../documents/doc-helpers';
import { ImportsService } from '../../src/modules/imports/imports.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import type { ClaimedJob } from '../../src/platform/jobs/job-queue.service';
import { IP, mapBatch, uploadAndParse, xlsx } from './import-kit';

let dc: string;
let gen: string;
let secretary: DocClient;
let pmB: Client;
let batchA: { id: string; version: number; sourceId: string };

beforeAll(async () => {
  dc = await projectIdByCode(DC);
  gen = await projectIdByCode(GEN);
  secretary = await login('secretary');
  pmB = await loginAs('pm.b');
  const parsed = await uploadAndParse(secretary, dc, await xlsx([{ name: 'Risks', rows: [['Title', 'Probability', 'Impact'], ['Synthetic project-A risk title', 1, 1]] }]), 'project-a.xlsx', { target: 'risk' });
  batchA = await mapBatch(secretary, dc, parsed);
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

const job = (o: Partial<ClaimedJob> & { org_id: string }): ClaimedJob => ({ id: `probe-${Date.now()}`, locked_by: 'test', kind: 'x', project_id: null, payload: {}, attempts: 1, max_attempts: 1, idempotency_key: 'x', requested_by: null, ...o }) as ClaimedJob;

describe('AT-03 / REQ-SEC-007 isolation of imports, notifications and jobs (Project B user, worker paths)', () => {
  it('a Project B user gets 404 for Project A batches — by Project A’s path and by their own project’s path; nothing is listed or counted', async () => {
    for (const path of [IP(dc, `/${batchA.id}`), IP(dc, `/${batchA.id}/rows`), IP(dc), IP(gen, `/${batchA.id}`), IP(gen, `/${batchA.id}/rows`)]) {
      const r = await pmB.get(path);
      expect(r.status, path).toBe(404);
      expect(JSON.stringify(r.body)).not.toContain('Synthetic project-A');
    }
    const cmd = await pmB.post(IP(gen, `/${batchA.id}/submit`), { expectedVersion: batchA.version });
    expect(cmd.status).toBe(404);
    const own = await pmB.get(IP(gen, '?pageSize=100'));
    expect(own.status).toBe(200);
    expect(own.body.items.some((b: { id: string }) => b.id === batchA.id)).toBe(false);
    expect(own.body.total).toBe((await owner().query(`select count(*)::int n from import_batch where project_id = $1`, [gen])).rows[0].n);
    // RLS: the runtime role scoped to Project B reads no Project A import row, sheet or output.
    const c = await runtimePool().connect();
    try {
      await c.query('begin');
      const org = (await owner().query(`select org_id from project where id = $1`, [gen])).rows[0].org_id;
      await c.query(`select set_config('app.org_id', $1, true), set_config('app.user_id', $2, true), set_config('app.project_ids', $3, true), set_config('app.full_project_ids', $3, true)`, [org, pmB.userId, gen]);
      for (const t of ['import_batch', 'import_row', 'import_sheet', 'import_output']) {
        expect((await c.query(`select count(*)::int n from ${t} where project_id = $1`, [dc])).rows[0].n, t).toBe(0);
      }
    } finally {
      await c.query('rollback');
      c.release();
    }
  });

  it('worker path: a parse job carrying Project B for a Project A batch touches nothing', async () => {
    const svc = (await getApp()).get(ImportsService);
    const org = (await owner().query(`select org_id from project where id = $1`, [gen])).rows[0].org_id;
    const pending = (await owner().query(`select status, version from import_batch where id = $1`, [batchA.id])).rows[0];
    const r = await svc.parseJob(job({ org_id: org, project_id: gen, payload: { batchId: batchA.id } }));
    expect(r).toEqual({ skipped: 'not_pending' });
    expect((await owner().query(`select status, version from import_batch where id = $1`, [batchA.id])).rows[0]).toEqual(pending);
  });

  it('IT: Project B user cannot obtain Project A data via notification — a forged event naming them is suppressed; their inbox shows only their own rows', async () => {
    const svc = (await getApp()).get(NotificationsService);
    const org = (await owner().query(`select org_id from project where id = $1`, [dc])).rows[0].org_id;
    const committeeId = (await owner().query(`select id from committee where project_id = $1 limit 1`, [dc])).rows[0].id;
    const ev = `forged-${Date.now()}`;
    const res = await svc.onAgendaScreened(job({ org_id: org, project_id: dc, payload: { eventId: ev, committeeId, requesterUserId: pmB.userId, outcome: 'accept' } }));
    expect(res).toMatchObject({ delivered: 0, suppressed: 1 });
    expect((await owner().query(`select count(*)::int n from notification where user_id = $1 and project_id = $2`, [pmB.userId, dc])).rows[0].n).toBe(0);
    // A notification row of Project A addressed to the B user (planted by the DB owner) is still never shown to them.
    await owner().query(
      `insert into notification (id, org_id, project_id, user_id, kind, title, channel, delivery_status, source_type, source_id, message_code, message_params)
       values (gen_random_uuid(), $1, $2, $3, 'agenda_request.screened', 'planted', 'in_app', 'sent', 'committee', $4, 'notifications.agenda_request.screened', '{"outcome":"accept"}')`,
      [org, dc, pmB.userId, committeeId],
    );
    const inbox = await pmB.get('/api/v1/me/notifications?pageSize=100');
    expect(inbox.status).toBe(200);
    expect(inbox.body.items.some((n: { projectId: string }) => n.projectId === dc)).toBe(false);
    expect((await pmB.get('/api/v1/me/notifications/unread-count')).body.count).toBe(inbox.body.items.filter((n: { readAt: string | null }) => !n.readAt).length);
    // And another user's notification id is a 404, whatever the path.
    const other = (await owner().query(`select id from notification where user_id <> $1 limit 1`, [pmB.userId])).rows[0].id;
    expect((await pmB.post(`/api/v1/me/notifications/${other}/read`)).status).toBe(404);
  });

  it('notification jobs re-resolve the recipient at execution: an import outcome for Project A is never delivered to a non-member', async () => {
    const svc = (await getApp()).get(NotificationsService);
    const org = (await owner().query(`select org_id from project where id = $1`, [dc])).rows[0].org_id;
    // A job claiming the Project A batch in Project B finds nothing to deliver (the batch is not a Project B record).
    const r = await svc.onImportDecided(job({ org_id: org, project_id: gen, payload: { importBatchId: batchA.id, outcome: 'applied' } }));
    expect(r).toEqual({ skipped: 'source_missing' });
    await drainWorker();
    expect((await owner().query(`select count(*)::int n from notification where user_id = $1 and message_params->>'batchId' = $2`, [pmB.userId, batchA.id])).rows[0].n).toBe(0);
  });
});
