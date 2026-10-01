import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildRenderDoc } from '../../src/modules/reporting/render/document';
import { reportHtml } from '../../src/modules/reporting/render/html';
import { REPORT_LABELS } from '../../src/modules/reporting/render/labels';
import { renderXlsx } from '../../src/modules/reporting/render/xlsx.renderer';
import { renderPptx } from '../../src/modules/reporting/render/pptx.renderer';
import { renderDocx } from '../../src/modules/reporting/render/docx.renderer';
import type { StoredReportPayload } from '../../src/modules/reporting/report-model';
import { closeApp, closePools, DC, loginAs, owner, projectIdByCode, type Client } from '../helpers';
import { openOoxml, PRESENTATION_MAIN, SPREADSHEET_MAIN, WORD_MAIN, workbookCells, xmlText } from './ooxml';
import { generate } from './report-kit';

/**
 * REQ-RPT-015: every report carries its metadata block — project, as-of date, scope, baseline version, classification,
 * unverified data, generator and content hash — in every file format and both languages. The files are rendered here with
 * the worker's renderers from snapshots generated through the API (PDF: its HTML source, which headless Chromium prints).
 */
const KINDS = ['executive_summary', 'committee_pack', 'workstream_weekly', 'look_ahead', 'day1_readiness', 'tsa_exit', 'jv_closing', 'health_data_quality', 'minutes'] as const;
const squeeze = (s: string) => s.replace(/\s+/g, '');
const unescapeHtml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

let pm: Client;
let dc: string;
beforeAll(async () => {
  dc = await projectIdByCode(DC);
  pm = await loginAs('pm');
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('REQ-RPT-015 report metadata on every report', () => {
  it('UT: every report template renders required metadata block — all kinds, en and ar, XLSX / PPTX / DOCX / PDF source', { timeout: 300_000 }, async () => {
    const meeting = (await owner().query<{ id: string }>(`select m.id from meeting m join committee c on c.id = m.committee_id where m.project_id = $1 and c.classification in ('internal','confidential') order by m.number limit 1`, [dc])).rows[0]!;
    let checked = 0;
    for (const kind of KINDS) {
      const s = await generate(pm, dc, kind === 'minutes' ? { kind, meetingId: meeting.id } : { kind });
      const row = (await owner().query<{ payload: StoredReportPayload; content_hash: string; classification: string }>(`select payload, content_hash, classification from report_snapshot where id = $1`, [s.id])).rows[0]!;
      for (const locale of ['en', 'ar'] as const) {
        const L = REPORT_LABELS[locale].meta;
        const doc = buildRenderDoc({ payload: row.payload, contentHash: row.content_hash, classification: row.classification, sections: row.payload.sections.map((x) => ({ key: x.key, section: x })), locale });
        // The block itself: the eight required items, each with a value.
        expect(doc.meta.map(([label]) => label)).toEqual([L.project, L.asOf, L.scope, L.baseline, L.classification, L.unverifiedData, L.generatedBy, L.contentHash]);
        for (const [label, value] of doc.meta) expect(value.trim(), `${kind}/${locale} ${label}`).not.toBe('');
        expect(doc.meta[7]![1]).toBe(row.content_hash);
        const pptx = openOoxml(await renderPptx(doc), PRESENTATION_MAIN);
        const docx = openOoxml(await renderDocx(doc), WORD_MAIN);
        const files: Record<string, string> = {
          xlsx: workbookCells(openOoxml(await renderXlsx(doc), SPREADSHEET_MAIN)).strings.join('\n'),
          pptx: [...pptx.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).map((n) => xmlText(pptx.get(n)!.toString('utf8'))).join('\n'),
          docx: xmlText(docx.get('word/document.xml')!.toString('utf8')),
          pdf: unescapeHtml(reportHtml(doc, { compact: kind === 'executive_summary', maxRows: 3 }).replace(/<[^>]+>/g, ' ')),
        };
        for (const [format, text] of Object.entries(files)) {
          const t = squeeze(text);
          for (const [label, value] of doc.meta) {
            expect(t, `${kind}/${locale}/${format}: label ${label}`).toContain(squeeze(label));
            expect(t, `${kind}/${locale}/${format}: ${label} = ${value}`).toContain(squeeze(value));
            checked++;
          }
        }
      }
    }
    expect(checked).toBe(KINDS.length * 2 * 4 * 8);
  });
});
