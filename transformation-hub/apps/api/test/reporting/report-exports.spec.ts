import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, DC, GEN, loginAs, owner, projectIdByCode, type Client } from '../helpers';
import { drain, exportFile, generate, loginUserId, reportUser, revokeMemberships, RP } from './report-kit';
import { openOoxml, SPREADSHEET_MAIN, workbookCells } from './ooxml';

type Snap = { id: string; sections: { key: string; included: boolean; figures: { key: string; value: number | null }[]; tables: { key: string; rows: Record<string, unknown>[] }[] }[] };

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

describe('REQ-RPT-007 / REQ-SEC-017 / AT-24 XLSX exports are genuine workbooks that reconcile to the snapshot', () => {
  it('IT: exported file validates as OOXML spreadsheet; every figure and record of the snapshot is in it (en)', async () => {
    const s = await generate(pm, dc, { kind: 'committee_pack' });
    const snap = (await pm.get(RP(dc, `/report-snapshots/${s.id}`)).expect(200)).body as Snap;
    const f = await exportFile(pm, dc, s.id, 'xlsx', 'en');
    expect(f.headers['content-type']).toContain('spreadsheetml');
    expect(f.headers['x-content-type-options']).toBe('nosniff');
    expect(f.headers['content-disposition']).toMatch(/attachment; filename="DEMO-DC-committee_pack-\d{4}-\d{2}-\d{2}-en\.xlsx"/);
    expect(f.bytes.subarray(0, 2).toString('latin1')).toBe('PK'); // a ZIP package, not renamed HTML
    expect(f.bytes.toString('latin1', 0, 200).toLowerCase()).not.toContain('<html');
    const parts = openOoxml(f.bytes, SPREADSHEET_MAIN);
    const cells = workbookCells(parts);
    expect(cells.formulas).toEqual([]);
    expect(cells.rtlSheets).toBe(0);
    expect(cells.strings).toEqual(expect.arrayContaining(['Decisions', 'Plan and milestones', 'Committee pack', 'Demo — synthetic sandbox data, not real Mobily information']));
    for (const sec of snap.sections) {
      for (const fig of sec.figures) if (fig.value !== null && !sec.key.startsWith('kpis.')) expect(cells.numbers, `${sec.key}.${fig.key}`).toContain(fig.value);
    }
    const decisions = snap.sections.find((x) => x.key === 'decisions')!.tables[0]!.rows;
    for (const d of decisions) expect(cells.strings).toContain(d.code);
    expect(f.status).toMatchObject({ includedSections: snap.sections.map((x) => x.key), contentClassification: 'confidential' });
  });

  it('Arabic workbook: every sheet is right-to-left and the labels are Arabic; the same figures', async () => {
    const s = await generate(pm, dc, { kind: 'tsa_exit' });
    const snap = (await pm.get(RP(dc, `/report-snapshots/${s.id}`)).expect(200)).body as Snap;
    const f = await exportFile(pm, dc, s.id, 'xlsx', 'ar');
    const cells = workbookCells(openOoxml(f.bytes, SPREADSHEET_MAIN));
    expect(cells.sheets).toBeGreaterThan(1);
    expect(cells.rtlSheets).toBe(cells.sheets);
    expect(cells.strings).toContain('الخروج من اتفاقيات الخدمات الانتقالية');
    expect(cells.strings).toContain('تجريبي — بيانات بيئة تجريبية مصطنعة، وليست معلومات حقيقية لموبايلي');
    for (const fig of snap.sections[0]!.figures) if (fig.value !== null) expect(cells.numbers).toContain(fig.value);
  });

  it("UT: '=HYPERLINK(...)' exported as text — formula-like record text is neutralised, no cell is a formula", async () => {
    const risk = (await owner().query<{ id: string; title: string }>(`select id, title from risk where project_id = $1 and status in ('open','monitoring','escalated') order by code limit 1`, [dc])).rows[0]!;
    const evil = '=HYPERLINK("http://attacker.invalid/x","Click")';
    await owner().query(`update risk set title = $2 where id = $1`, [risk.id, evil]);
    try {
      const s = await generate(pm, dc, { kind: 'committee_pack' });
      const cells = workbookCells(openOoxml((await exportFile(pm, dc, s.id, 'xlsx', 'en')).bytes, SPREADSHEET_MAIN));
      expect(cells.formulas).toEqual([]);
      expect(cells.strings).toContain(`'${evil}`);
      expect(cells.strings).not.toContain(evil);
    } finally {
      await owner().query(`update risk set title = $2 where id = $1`, [risk.id, risk.title]);
    }
  });
});

describe('REQ-RPT-017 / AT-19 / AT-03 / REQ-INT-011 exports: worker re-authorisation, requester-only download, no outbound channel', () => {
  it('a file is downloadable only by its requester (every download audited with the actor and the checksum); another member gets 404 for the export and its download', async () => {
    const s = await generate(pm, dc, { kind: 'look_ahead' });
    const f = await exportFile(pm, dc, s.id, 'xlsx', 'en');
    const pmId = (await owner().query<{ id: string }>(`select id from app_user where email = 'demo.pm@demo.invalid'`)).rows[0]!.id;
    const downloads = (await owner().query<{ actor_user_id: string; after: { step: string; sha256: string } }>(`select actor_user_id, after from audit_event where entity_id = $1 and action = 'reports.snapshot.export' and after->>'step' = 'downloaded'`, [f.exportId])).rows;
    expect(downloads.length).toBe(1);
    expect(downloads[0]).toMatchObject({ actor_user_id: pmId, after: { step: 'downloaded', sha256: f.status.sha256 } });
    const sponsor = await loginAs('sponsor');
    await sponsor.get(RP(dc, `/report-exports/${f.exportId}`)).expect(404);
    await sponsor.get(RP(dc, `/report-exports/${f.exportId}/download`)).expect(404);
    const mine = (await sponsor.get(RP(dc, `/report-snapshots/${s.id}/exports`)).expect(200)).body;
    expect(mine.items.map((x: { id: string }) => x.id)).not.toContain(f.exportId);
    const pmB = await loginAs('pm.b');
    await pmB.get(RP(dc, `/report-exports/${f.exportId}/download`)).expect(404);
    await pmB.get(RP(await projectIdByCode(GEN), `/report-exports/${f.exportId}/download`)).expect(404);
  });

  it('AT-19: requester removed before the worker runs → export cancelled, nothing rendered or stored', async () => {
    const uid = await reportUser('export-revoked', 'confidential', [{ role: 'project_manager' }]);
    const u = await loginUserId(uid);
    const s = await generate(u, dc, { kind: 'executive_summary' });
    const req = (await u.post(RP(dc, `/report-snapshots/${s.id}/exports`), { format: 'xlsx', locale: 'en' }).expect(201)).body;
    await revokeMemberships(uid, dc);
    await drain();
    const row = (await owner().query(`select status, error_code, storage_key, sha256 from report_export where id = $1`, [req.id])).rows[0];
    expect(row).toEqual({ status: 'cancelled', error_code: 'requester_access_revoked', storage_key: null, sha256: null });
    await u.get(RP(dc, `/report-exports/${req.id}/download`)).expect(404);
  });

  it('a ready file whose section the requester can no longer read is never handed out again (404, audited denial)', async () => {
    const uid = await reportUser('export-demoted', 'confidential', [{ role: 'project_manager' }]);
    const u = await loginUserId(uid);
    const s = await generate(u, dc, { kind: 'committee_pack' });
    const f = await exportFile(u, dc, s.id, 'xlsx', 'en');
    expect(f.status.includedSections).toContain('financials');
    await revokeMemberships(uid, dc);
    // Legal keeps reports.snapshot.export but has no finance read: the financials in the file are now outside its access.
    await owner().query(`insert into project_membership (org_id, project_id, user_id, role, reason) select org_id, $1, $2, 'legal_restricted', 'Reporting test: moved to legal' from project where id = $1`, [dc, uid]);
    await u.get(RP(dc, `/report-exports/${f.exportId}/download`)).expect(404);
    const denied = (await owner().query<{ n: number }>(`select count(*)::int as n from audit_event where entity_id = $1 and outcome = 'denied'`, [f.exportId])).rows[0]!.n;
    expect(denied).toBeGreaterThan(0);
  });

  it('AT-03 worker path: a render job carrying a Project B identity for a Project A export renders nothing', async () => {
    const s = await generate(pm, dc, { kind: 'look_ahead' });
    const req = (await pm.post(RP(dc, `/report-snapshots/${s.id}/exports`), { format: 'xlsx', locale: 'en' }).expect(201)).body;
    const pmB = (await owner().query<{ id: string }>(`select id from app_user where email = 'demo.pm.b@demo.invalid'`)).rows[0]!.id;
    // Forge the queued job: same export, but the requester is a Project B user.
    await owner().query(`update job set requested_by = $2 where idempotency_key = $1`, [`report-export:${req.id}`, pmB]);
    await drain();
    const row = (await owner().query(`select status, error_code, storage_key from report_export where id = $1`, [req.id])).rows[0];
    expect(row).toEqual({ status: 'cancelled', error_code: 'requester_access_revoked', storage_key: null });
  });

  it('UT: export job has no outbound channel — exports create no delivery or notification and the pipeline imports no network client', async () => {
    const before = (await owner().query(`select (select count(*) from delivery_record)::int as d, (select count(*) from notification)::int as n`)).rows[0];
    const s = await generate(pm, dc, { kind: 'executive_summary' });
    await exportFile(pm, dc, s.id, 'xlsx', 'ar');
    const after = (await owner().query(`select (select count(*) from delivery_record)::int as d, (select count(*) from notification)::int as n`)).rows[0];
    expect(after).toEqual(before);
    const dir = resolve(__dirname, '../../src/modules/reporting');
    const files = [join(dir, 'exports.service.ts'), join(dir, 'reporting.jobs.ts'), ...readdirSync(join(dir, 'render')).map((x) => join(dir, 'render', x))];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      expect(src, file).not.toMatch(/DeliveryService|NotificationsService|from 'node:(https?|net|tls|dgram)'|from '(https?|net|tls|undici|axios|node-fetch|nodemailer)'|\bfetch\(/);
    }
  });

  it('a ready export is frozen: its file reference and checksum cannot change and the row cannot be deleted', async () => {
    const s = await generate(pm, dc, { kind: 'look_ahead' });
    const f = await exportFile(pm, dc, s.id, 'xlsx', 'en');
    await expect(owner().query(`update report_export set sha256 = repeat('0', 64) where id = $1`, [f.exportId])).rejects.toThrow(/report_export_final/);
    await expect(owner().query(`delete from report_export where id = $1`, [f.exportId])).rejects.toThrow(/append_only_violation/);
  });

  it('a stored file that no longer matches its checksum is refused (409) and the refusal is audited', async () => {
    const s = await generate(pm, dc, { kind: 'look_ahead' });
    const f = await exportFile(pm, dc, s.id, 'xlsx', 'en');
    const key = (await owner().query<{ storage_key: string }>(`select storage_key from report_export where id = $1`, [f.exportId])).rows[0]!.storage_key;
    const path = resolve(__dirname, '../..', process.env.HUB_STORAGE_LOCAL_DIR ?? '.data/test-objects', key);
    writeFileSync(path, Buffer.concat([readFileSync(path), Buffer.from('tampered')]));
    const r = await pm.get(RP(dc, `/report-exports/${f.exportId}/download`));
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('report.export_integrity');
  });
});
