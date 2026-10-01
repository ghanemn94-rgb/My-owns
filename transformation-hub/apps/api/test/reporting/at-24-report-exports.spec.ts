import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, DC, loginAs, owner, projectIdByCode, type Client } from '../helpers';
import { exportFile, generate, loginUserId, reportUser, RP } from './report-kit';
import { hasArabic, norm, readPdf, type PdfInfo } from './pdf';
import { openOoxml, PRESENTATION_MAIN, WORD_MAIN, xmlText } from './ooxml';
import { REPORT_LABELS } from '../../src/modules/reporting/render/labels';
import { resolveChromium } from '../../src/modules/reporting/render/pdf.renderer';

type Snap = { id: string; sections: { key: string; included: boolean; figures: { key: string; value: number | null }[]; tables: { key: string; rows: Record<string, unknown>[] }[] }[] };

/** The test environment's Chromium (the same resolution the API uses outside production). */
const CHROMIUM = resolveChromium(process.env.HUB_CHROMIUM_PATH ?? null, false);

let dc: string;
let pm: Client;
let secretary: Client;
beforeAll(async () => {
  dc = await projectIdByCode(DC);
  pm = await loginAs('pm');
  secretary = await loginAs('secretary');
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('AT-24 / REQ-RPT-008 PDF reports with verified Arabic output (genuine PDF, bundled fonts, right-to-left, figures = snapshot)', () => {
  it('the PDF renderer never claims to work without a browser: a configured path that does not exist, or production without HUB_CHROMIUM_PATH → unavailable', () => {
    expect(resolveChromium('/nonexistent/chromium', false)).toBeNull();
    expect(resolveChromium(null, true)).toBeNull();
  });

  if (!CHROMIUM) {
    it('no Chromium in this environment: a PDF export is refused with an honest 422 (format unavailable)', async () => {
      const s = await generate(pm, dc, { kind: 'executive_summary' });
      const r = await pm.post(RP(dc, `/report-snapshots/${s.id}/exports`), { format: 'pdf', locale: 'ar' });
      expect(r.status).toBe(422);
      expect(r.body.code).toBe('report.export_format_unavailable');
    });
    return;
  }

  for (const locale of ['en', 'ar'] as const) {
    it(`${locale}: committee pack PDF — %PDF file with the bundled IBM Plex fonts embedded, ${locale === 'ar' ? 'Arabic shaped right-to-left' : 'left-to-right'}, every section title, record code and figure of the snapshot, classification and page number on every page`, async () => {
      const s = await generate(pm, dc, { kind: 'committee_pack' });
      const snap = (await pm.get(RP(dc, `/report-snapshots/${s.id}`)).expect(200)).body as Snap;
      const f = await exportFile(pm, dc, s.id, 'pdf', locale);
      expect(f.headers['content-type']).toContain('application/pdf');
      expect(f.headers['content-disposition']).toMatch(new RegExp(`committee_pack-\\d{4}-\\d{2}-\\d{2}-${locale}\\.pdf`));
      const pdf = await readPdf(f.bytes);
      const L = REPORT_LABELS[locale];
      expect(pdf.language).toBe(locale);
      expect(pdf.pages).toBeGreaterThan(1);
      expect(pdf.fonts.filter((x) => x.includes('(not embedded)'))).toEqual([]);
      if (locale === 'ar') {
        expect(pdf.fonts).toEqual(expect.arrayContaining(['IBMPlexSansArabic-Regular', 'IBMPlexSansArabic-SemiBold']));
        expect(pdf.rtlShare).toBeGreaterThan(0.5);
        expect(pdf.shapedGlyphs).toBeGreaterThan(100); // contextual (initial / medial / final) forms: shaping happened
      } else {
        expect(pdf.fonts).toEqual(expect.arrayContaining(['IBMPlexSans-Regular', 'IBMPlexSans-SemiBold']));
        expect(pdf.rtlShare).toBeLessThan(0.05);
      }
      const has = (label: string, page?: number) => (locale === 'ar' ? hasArabic(pdf, label, page) : (page === undefined ? pdf.latin : pdf.perPage[page]!.latin).includes(norm(label)));
      for (const sec of snap.sections) expect(has(L.sections[sec.key]!), `section ${sec.key}`).toBe(true);
      expect(has(L.meta.demoBanner)).toBe(true);
      for (const t of ['decisions', 'milestones'] as const) {
        const rows = snap.sections.find((x) => x.key === t)!.tables[0]!.rows;
        for (const r of rows) expect(pdf.latin, `${t} ${String(r.code)}`).toContain(norm(String(r.code)));
      }
      for (const sec of snap.sections) for (const fig of sec.figures) if (fig.value !== null) expect(pdf.latin).toContain(String(fig.value));
      for (let p = 0; p < pdf.pages; p++) {
        // "n / N" in an LTR span; pdf.js may return the two numbers of an RTL line in either order.
        const okNum = [`${p + 1}/${pdf.pages}`, `${pdf.pages}/${p + 1}`].some((x) => pdf.perPage[p]!.latin.includes(x));
        // The extracted lines go into the message: an intermittent miss on page 1 (one full-suite run of three) left no trace.
        expect(okNum, `page ${p + 1} number (of ${pdf.pages}); last lines: ${JSON.stringify(pdf.perPage[p]!.lines.slice(-4))}`).toBe(true);
        expect(has(L.meta.classification, p), `page ${p + 1} classification`).toBe(true);
      }
    });
  }

  it('UT: executive summary fits one page in ar and en', async () => {
    const s = await generate(pm, dc, { kind: 'executive_summary' });
    for (const locale of ['en', 'ar'] as const) {
      const pdf = await readPdf((await exportFile(pm, dc, s.id, 'pdf', locale)).bytes);
      expect(pdf.pages, locale).toBe(1);
    }
  });

  it('no leakage: a reader without finance access gets a PDF whose financial section is only the "outside your access" line', async () => {
    const s = await generate(pm, dc, { kind: 'committee_pack' });
    const pmView = (await pm.get(RP(dc, `/report-snapshots/${s.id}`)).expect(200)).body as Snap;
    const budgetCodes = (pmView.sections.find((x) => x.key === 'financials')!.tables.find((t) => t.key === 'budget_by_currency')!.rows).map((r) => String(r.currency));
    expect(budgetCodes.length).toBeGreaterThan(0);
    // Legal Restricted only: may export, cannot read finance records.
    const legal = await loginUserId(await reportUser('legal-only', 'confidential', [{ role: 'legal_restricted' }]));
    const f = await exportFile(legal, dc, s.id, 'pdf', 'ar');
    expect(f.status.includedSections).not.toContain('financials');
    const pdf: PdfInfo = await readPdf(f.bytes);
    expect(hasArabic(pdf, REPORT_LABELS.ar.sections.financials!)).toBe(true);
    expect(hasArabic(pdf, REPORT_LABELS.ar.meta.withheld)).toBe(true);
    // Nothing of the financial content: no amount and no budget-line / benefit code (Latin text reads exactly).
    for (const c of budgetCodes) expect(pdf.latin).not.toContain(`${c}0.00`);
    const finRefs = (pmView.sections.find((x) => x.key === 'financials') as unknown as { sourceRefs: { label: string }[] }).sourceRefs.map((r) => r.label);
    expect(finRefs.length).toBeGreaterThan(0);
    for (const code of finRefs) expect(pdf.latin).not.toContain(norm(code));
    // Control: the PM's file of the same snapshot does contain them (the check above is not vacuous).
    const control = await readPdf((await exportFile(pm, dc, s.id, 'pdf', 'ar')).bytes);
    for (const code of finRefs) expect(control.latin).toContain(norm(code));
    expect(hasArabic(control, REPORT_LABELS.ar.meta.withheld)).toBe(false);
  });
});

/** All text of the parts whose name matches, in part order (OOXML keeps logical order: Arabic reads exactly). */
function partsText(parts: Map<string, Buffer>, re: RegExp): string {
  return [...parts.keys()]
    .filter((n) => re.test(n))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)?.[1] ?? 0) - Number(b.match(/(\d+)\.xml$/)?.[1] ?? 0))
    .map((n) => xmlText(parts.get(n)!.toString('utf8')))
    .join('\n');
}

describe('AT-24 / REQ-RPT-009 basic PPTX committee pack (genuine presentation, right-to-left for Arabic, figures = snapshot)', () => {
  for (const locale of ['en', 'ar'] as const) {
    it(`${locale}: IT: PPTX validates as OOXML presentation; figures match snapshot`, async () => {
      const s = await generate(secretary, dc, { kind: 'committee_pack' });
      const snap = (await secretary.get(RP(dc, `/report-snapshots/${s.id}`)).expect(200)).body as Snap;
      const f = await exportFile(secretary, dc, s.id, 'pptx', locale);
      expect(f.headers['content-type']).toContain('presentationml.presentation');
      expect(f.bytes.subarray(0, 2).toString('latin1')).toBe('PK');
      expect(f.bytes.toString('latin1', 0, 400).toLowerCase()).not.toContain('<html');
      const parts = openOoxml(f.bytes, PRESENTATION_MAIN);
      const slides = [...parts.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
      expect(slides.length).toBeGreaterThan(snap.sections.length);
      const text = partsText(parts, /^ppt\/slides\/slide\d+\.xml$/);
      const L = REPORT_LABELS[locale];
      for (const sec of snap.sections) expect(text, `section ${sec.key}`).toContain(L.sections[sec.key]!);
      for (const sec of snap.sections) for (const fig of sec.figures) if (fig.value !== null) expect(text).toContain(String(fig.value));
      for (const r of snap.sections.find((x) => x.key === 'decisions')!.tables[0]!.rows) expect(text).toContain(String(r.code));
      // Classification and Demo label on every slide: every slide uses the layout that carries the footer.
      const footerLayouts = [...parts.keys()].filter((n) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(n) && xmlText(parts.get(n)!.toString('utf8')).includes(L.meta.classification));
      expect(footerLayouts.length).toBe(1);
      expect(xmlText(parts.get(footerLayouts[0]!)!.toString('utf8'))).toContain(L.meta.demoBanner);
      const layoutFile = footerLayouts[0]!.split('/').pop()!;
      for (const n of slides) {
        const rels = parts.get(n.replace('slides/', 'slides/_rels/') + '.rels')!.toString('utf8');
        expect(rels, n).toContain(layoutFile);
      }
      const pres = parts.get('ppt/presentation.xml')!.toString('utf8');
      const slideXml = slides.map((n) => parts.get(n)!.toString('utf8')).join('');
      if (locale === 'ar') {
        expect(pres).toMatch(/<p:presentation[^>]* rtl="1"/);
        expect(slideXml).toMatch(/<a:pPr[^>]*rtl="1"/);
        expect(slideXml).toContain('lang="ar-SA"');
        expect(text).toContain('حزمة اللجنة');
      } else {
        expect(pres).not.toMatch(/<p:presentation[^>]* rtl="1"/);
        expect(slideXml).not.toMatch(/rtl="1"/);
      }
    });
  }
});

describe('AT-24 / REQ-RPT-010 DOCX minutes (genuine Word document, not renamed HTML; right-to-left for Arabic)', () => {
  for (const locale of ['en', 'ar'] as const) {
    it(`${locale}: IT: DOCX validates as OOXML document (not renamed HTML); minutes content = snapshot`, async () => {
      const meeting = (await owner().query<{ id: string }>(`select m.id from meeting m join committee c on c.id = m.committee_id where m.project_id = $1 and m.minutes_text is not null and c.classification in ('internal','confidential') order by m.number limit 1`, [dc])).rows[0]!;
      const s = await generate(secretary, dc, { kind: 'minutes', meetingId: meeting.id });
      const snap = (await secretary.get(RP(dc, `/report-snapshots/${s.id}`)).expect(200)).body as Snap;
      const f = await exportFile(secretary, dc, s.id, 'docx', locale);
      expect(f.headers['content-type']).toContain('wordprocessingml.document');
      expect(f.bytes.subarray(0, 2).toString('latin1')).toBe('PK');
      expect(f.bytes.toString('latin1', 0, 400).toLowerCase()).not.toContain('<html');
      const parts = openOoxml(f.bytes, WORD_MAIN);
      const docXml = parts.get('word/document.xml')!.toString('utf8');
      const text = xmlText(docXml);
      const L = REPORT_LABELS[locale];
      const meetingSec = snap.sections.find((x) => x.key === 'meeting')!;
      const header = meetingSec.tables.find((t) => t.key === 'meeting_header')!.rows[0]!;
      expect(text).toContain(String(header.title));
      for (const a of meetingSec.tables.find((t) => t.key === 'attendance')!.rows) if (a.member) expect(text).toContain(String(a.member));
      for (const a of meetingSec.tables.find((t) => t.key === 'agenda')!.rows) expect(text).toContain(String(a.title));
      const minutes = String(meetingSec.tables.find((t) => t.key === 'minutes_text')!.rows[0]!.text ?? '');
      for (const line of minutes.split(/\r?\n/).filter(Boolean)) expect(text).toContain(line.replace(/\s+/g, ' ').trim());
      for (const r of snap.sections.find((x) => x.key === 'minutes_decisions')!.tables[0]!.rows) expect(text).toContain(String(r.code));
      for (const sec of snap.sections) for (const fig of sec.figures) if (fig.value !== null) expect(text).toContain(String(fig.value));
      expect(text).toContain(L.notes['report.internal_approval_label']!);
      const footer = partsText(parts, /^word\/footer\d*\.xml$/);
      expect(footer).toContain(L.meta.classification);
      expect([...parts.keys()].filter((n) => /^word\/footer\d*\.xml$/.test(n)).map((n) => parts.get(n)!.toString('utf8')).join('')).toMatch(/PAGE/);
      if (locale === 'ar') {
        expect(docXml).toContain('<w:bidi/>');
        expect(docXml).toContain('<w:rtl/>');
        expect(docXml).toContain('<w:bidiVisual/>');
        expect(text).toContain(L.sections.meeting!);
      } else {
        expect(docXml).not.toContain('<w:bidi/>');
        expect(docXml).not.toContain('<w:bidiVisual/>');
      }
    });
  }
});
