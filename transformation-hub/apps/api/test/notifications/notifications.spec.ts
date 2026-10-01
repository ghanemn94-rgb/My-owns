import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, DC, getApp, loginAs, owner, projectIdByCode, type Client } from '../helpers';
import { drainWorker, login } from '../documents/doc-helpers';
import { loginUserId, reportUser, revokeMemberships } from '../reporting/report-kit';
import { IP, mapBatch, submit, uploadAndParse, xlsx } from '../imports/import-kit';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import type { ClaimedJob } from '../../src/platform/jobs/job-queue.service';

const ME = '/api/v1/me/notifications';
let dc: string;
let secretary: Client;
let committeeId: string;

beforeAll(async () => {
  dc = await projectIdByCode(DC);
  secretary = await loginAs('secretary');
  committeeId = (await owner().query(`select id from committee where project_id = $1 order by created_at limit 1`, [dc])).rows[0].id;
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

async function agendaRequest(c: Client, title: string) {
  const r = await c.post(`/api/v1/projects/${dc}/agenda-requests`, { committeeId, title, kind: 'information' });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.id as string;
}

async function screen(id: string, outcome: 'reject' | 'return', note = 'Synthetic screening reason — not for the notification') {
  const r = await secretary.post(`/api/v1/projects/${dc}/agenda-requests/${id}/screen`, { expectedVersion: 1, outcome, note });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
}

async function rowsFor(userId: string, kind: string) {
  return (await owner().query(`select * from notification where user_id = $1 and kind = $2 order by created_at`, [userId, kind])).rows;
}

describe('REQ-PLT-008 / REQ-GOV-012 in-app notifications through the outbox', () => {
  it('UT: screened-out request records reason and requester notified — through the outbox, exactly once, with no reason text', async () => {
    const reqId = await reportUser('notif-requester', 'confidential', [{ role: 'functional_approver' }]);
    const requester = await loginUserId(reqId);
    const id = await agendaRequest(requester, 'Synthetic agenda request — notification probe');
    await screen(id, 'reject');
    // Nothing is delivered inside the business transaction: the worker produces it from the outbox event.
    expect(await rowsFor(reqId, 'agenda_request.screened')).toHaveLength(0);
    await drainWorker();
    const rows = await rowsFor(reqId, 'agenda_request.screened');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ project_id: dc, channel: 'in_app', delivery_status: 'sent', source_type: 'committee', source_id: committeeId, message_code: 'notifications.agenda_request.screened', message_params: { outcome: 'reject' } });
    expect(rows[0].title).toBe('Your agenda request was screened by the secretariat: reject');
    expect(JSON.stringify(rows[0])).not.toContain('Synthetic screening reason');
    // The requester sees it in the inbox (en / ar text comes from the code on the web).
    const inbox = await requester.get(`${ME}?pageSize=50`);
    expect(inbox.status).toBe(200);
    expect(inbox.body.items.find((n: { id: string }) => n.id === rows[0].id)).toMatchObject({ kind: 'agenda_request.screened', projectCode: DC, messageCode: 'notifications.agenda_request.screened', readAt: null });
    // A retried / re-dispatched job never notifies twice (dedupe per event, kind and recipient — AT-20).
    const app = await getApp();
    const ev = (await owner().query(`select id, org_id, project_id, payload from outbox_event where type = 'agenda_request.screened' and aggregate_id = $1`, [id])).rows[0];
    const job = { id: 'retry-probe', org_id: ev.org_id, project_id: ev.project_id, kind: 'notifications.agenda_request_screened', payload: { ...ev.payload, eventId: ev.id }, attempts: 2, max_attempts: 5, idempotency_key: 'x', requested_by: null, locked_by: 'test' } as unknown as ClaimedJob;
    const again = await app.get(NotificationsService).onAgendaScreened(job);
    expect(again).toMatchObject({ delivered: 0, duplicates: 1 });
    expect(await rowsFor(reqId, 'agenda_request.screened')).toHaveLength(1);
  });

  it('IT: notification suppressed after recipient loses project access (re-checked by the worker at delivery; audited)', async () => {
    const reqId = await reportUser('notif-revoked', 'confidential', [{ role: 'functional_approver' }]);
    const requester = await loginUserId(reqId);
    const id = await agendaRequest(requester, 'Synthetic agenda request — revoked requester');
    await screen(id, 'return');
    await revokeMemberships(reqId, dc);
    await drainWorker();
    expect(await rowsFor(reqId, 'agenda_request.screened')).toHaveLength(0);
    const audit = (await owner().query(`select reason, outcome, after from audit_event where action = 'notifications.delivery.suppressed' and after->>'recipientUserId' = $1`, [reqId])).rows;
    expect(audit).toEqual([expect.objectContaining({ reason: 'recipient_inactive_or_out_of_project', outcome: 'denied' })]);
  });

  it('inbox: unread count, mark one read, mark all read — only the reader’s own notifications', async () => {
    const reqId = await reportUser('notif-inbox', 'confidential', [{ role: 'functional_approver' }]);
    const requester = await loginUserId(reqId);
    for (const t of ['one', 'two']) await screen(await agendaRequest(requester, `Synthetic inbox probe ${t}`), 'reject');
    await drainWorker();
    const count = await requester.get(`${ME}/unread-count`);
    expect(count.body.count).toBe(2);
    const list = await requester.get(`${ME}?unread=true`);
    expect(list.body.total).toBe(2);
    const first = list.body.items[0].id;
    const read = await requester.post(`${ME}/${first}/read`);
    expect(read.status).toBe(201);
    expect((await requester.get(`${ME}/unread-count`)).body.count).toBe(1);
    // Another user cannot read (or mark) it.
    const other = await loginAs('pm');
    expect((await other.post(`${ME}/${first}/read`)).status).toBe(404);
    expect((await other.get(`${ME}?pageSize=100`)).body.items.some((n: { id: string }) => n.id === first)).toBe(false);
    const all = await requester.post(`${ME}/read-all`);
    expect(all.body.updated).toBe(1);
    expect((await requester.get(`${ME}/unread-count`)).body.count).toBe(0);
  });

  it('REQ-INT-012: a notification whose source the reader can no longer see is withheld at read time (list and count agree)', async () => {
    const reqId = await reportUser('notif-reclass', 'confidential', [{ role: 'functional_approver' }]);
    const requester = await loginUserId(reqId);
    await screen(await agendaRequest(requester, 'Synthetic reclassification probe'), 'reject');
    await drainWorker();
    const before = await requester.get(`${ME}/unread-count`);
    expect(before.body.count).toBe(1);
    const cls = (await owner().query(`select classification from committee where id = $1`, [committeeId])).rows[0].classification;
    await owner().query(`update committee set classification = 'restricted' where id = $1`, [committeeId]);
    try {
      expect((await requester.get(`${ME}/unread-count`)).body.count).toBe(0);
      const list = await requester.get(ME);
      expect(list.body.total).toBe(0);
      expect(list.body.items).toEqual([]);
    } finally {
      await owner().query(`update committee set classification = $2 where id = $1`, [committeeId, cls]);
    }
    expect((await requester.get(`${ME}/unread-count`)).body.count).toBe(1);
  });

  it('channels: in-app enabled; e-mail and Teams follow their connectors (Not configured); no SMS adapter', async () => {
    const r = await secretary.get('/api/v1/me/notification-channels');
    expect(r.status).toBe(200);
    expect(r.body.items).toEqual([
      { channel: 'in_app', status: 'enabled', adapterKey: null },
      { channel: 'email', status: 'not_configured', adapterKey: 'm365_outlook_mail_send' },
      { channel: 'teams', status: 'not_configured', adapterKey: 'm365_teams_message_send' },
      { channel: 'sms', status: 'not_configured', adapterKey: null },
    ]);
  });
});

describe('REQ-INT-012 / AT-19 recheck permissions at every send', () => {
  it('IT: recipient revoked after scheduling receives nothing — the import outcome to an uploader who lost access; the external send gate refuses (nothing sent)', async () => {
    const uploader = await login('secretary');
    const bytes = await xlsx([{ name: 'Risks', rows: [['Title', 'Probability', 'Impact'], ['Synthetic notified risk', 1, 1]] }]);
    const parsed = await uploadAndParse(uploader, dc, bytes, 'notify.xlsx', { target: 'risk' });
    let b = await mapBatch(uploader, dc, parsed);
    b = await submit(uploader, dc, b);
    await drainWorker();
    const pm = await loginAs('pm');
    const awaiting = (await owner().query(`select user_id from notification where kind = 'import.awaiting_approval' and message_params->>'batchId' = $1`, [b.id])).rows.map((r) => r.user_id);
    // The project's approvers are told; never the uploader.
    expect(awaiting).toContain(pm.userId);
    expect(awaiting).not.toContain(uploader.userId);
    expect((await pm.post(IP(dc, `/${b.id}/approve`), { expectedVersion: b.version, acceptedRows: [2] })).status).toBe(201);
    // The uploader loses project access after the event was written and before the worker runs.
    const membership = (await owner().query(`select id from project_membership where user_id = $1 and project_id = $2 and revoked_at is null`, [uploader.userId, dc])).rows.map((r) => r.id);
    await owner().query(`update project_membership set revoked_at = now() where id = any($1::uuid[])`, [membership]);
    try {
      await drainWorker();
      expect((await owner().query(`select count(*)::int n from notification where kind = 'import.decided' and message_params->>'batchId' = $1`, [b.id])).rows[0].n).toBe(0);
      expect((await owner().query(`select count(*)::int n from audit_event where action = 'notifications.delivery.suppressed' and after->>'recipientUserId' = $1 and after->>'kind' = 'import.decided'`, [uploader.userId])).rows[0].n).toBe(1);
    } finally {
      await owner().query(`update project_membership set revoked_at = null where id = any($1::uuid[])`, [membership]);
    }

    // External channels: the recipient is re-checked at SEND time, then the connector gate — nothing leaves the hub.
    const svc = (await getApp()).get(NotificationsService);
    const orgId = (await owner().query(`select org_id from project where id = $1`, [dc])).rows[0].org_id;
    const job = { id: `send-probe-${Date.now()}`, org_id: orgId, project_id: dc, kind: 'x', payload: {}, attempts: 1, max_attempts: 1, idempotency_key: 'x', requested_by: null, locked_by: 'test' } as unknown as ClaimedJob;
    const payload = { code: 'notifications.import.decided', params: { code: b.code, outcome: 'applied' } };
    expect(await svc.sendExternal(job, { channel: 'email', recipientUserId: pm.userId, projectId: dc, payload, visible: () => true })).toEqual({ status: 'disabled', code: 'integrations.not_verified' });
    const goneId = await reportUser('notif-gone', 'confidential', [{ role: 'secretary_cpmo' }]);
    await revokeMemberships(goneId, dc);
    expect(await svc.sendExternal(job, { channel: 'teams', recipientUserId: goneId, projectId: dc, payload, visible: () => true })).toEqual({ status: 'suppressed' });
    const ledger = (await owner().query(`select channel, status, detail from delivery_record where idempotency_key like $1 order by channel`, [`notify:${job.id}:%`])).rows;
    expect(ledger).toEqual([
      { channel: 'email', status: 'disabled', detail: 'email: integrations.not_verified' },
      { channel: 'teams', status: 'suppressed', detail: 'recipient inactive or outside the project at send time' },
    ]);
  });

  it('the requester of a change request is told its decision (a record they can read); the deciding sponsor is not', async () => {
    const pm = await loginAs('pm');
    const sponsor = await loginAs('sponsor');
    const cr = await secretary.post(`/api/v1/projects/${dc}/change-requests`, { title: 'Synthetic CR — notification probe', rationale: 'Synthetic rationale' });
    expect(cr.status, JSON.stringify(cr.body)).toBe(201);
    const P = `/api/v1/projects/${dc}/change-requests/${cr.body.id}`;
    const s1 = await secretary.post(`${P}/submit`, { expectedVersion: 1 });
    expect(s1.status, JSON.stringify(s1.body)).toBe(201);
    const s2 = await pm.post(`${P}/start-review`, { expectedVersion: s1.body.version });
    expect(s2.status, JSON.stringify(s2.body)).toBe(201);
    const s3 = await sponsor.post(`${P}/reject`, { expectedVersion: s2.body.version, reason: 'Synthetic rejection' });
    expect(s3.status, JSON.stringify(s3.body)).toBe(201);
    await drainWorker();
    const rows = (await owner().query(`select user_id, message_params, source_type, link from notification where kind = 'change_request.decided' and source_id = $1`, [cr.body.id])).rows;
    expect(rows).toEqual([{ user_id: secretary.userId, message_params: { code: cr.body.code, status: 'rejected' }, source_type: 'change_request', link: `/projects/${dc}/raid/changes/${cr.body.id}` }]);
  });
});
