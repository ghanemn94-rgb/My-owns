import { fontFaceCss } from './fonts';
import { fill, type RenderDoc, type RenderSection, type RenderTable } from './document';

/**
 * Server-rendered HTML of a report (input of the PDF renderer, ADR-0011). Everything is escaped; the page carries a CSP
 * that allows no script and no network fetch, and embeds its fonts. Arabic documents are `dir="rtl"`; codes, dates and
 * user text inside table cells are isolated with <bdi> so mixed Arabic / Latin text keeps its order.
 */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const bdi = (s: string) => `<bdi>${esc(s)}</bdi>`;

const CHIP: Record<string, string> = {
  public: '#2f6f3e',
  internal: '#1f4e8c',
  confidential: '#8a5a00',
  restricted: '#a3261f',
  strictly_confidential: '#6d0f0b',
};

export interface HtmlOptions {
  /** One-page layout (executive summary): at most `maxRows` rows per table, sources on one line. */
  compact: boolean;
  maxRows: number;
}

/** One-page layout only: long free text is shortened with an ellipsis (the full text stays in the snapshot and other files). */
const clip = (text: string, type: string, o: HtmlOptions) => (o.compact && type === 'text' && text.length > 110 ? `${text.slice(0, 107).trimEnd()}…` : text);

function tableHtml(t: RenderTable, doc: RenderDoc, o: HtmlOptions): string {
  // One-page layout: the project table repeats the metadata block, and an empty table is one line.
  if (o.compact && t.key === 'project') return '';
  if (o.compact && !t.rows.length) return `<p class="small"><strong>${esc(t.title)}:</strong> ${esc(doc.labels.noRows)}</p>`;
  // The four status dimensions are always shown together (a partial set would misstate where the project is).
  const rows = o.compact && t.key !== 'status_dimensions' ? t.rows.slice(0, o.maxRows) : t.rows;
  const numeric = t.types.map((x) => x === 'number' || x === 'percent' || x === 'money');
  const head = `<thead><tr>${t.headers.map((h, i) => `<th class="${numeric[i] ? 'num' : ''}">${bdi(h)}</th>`).join('')}</tr></thead>`;
  const body = rows.length
    ? rows.map((r) => `<tr>${r.map((c, i) => `<td class="${numeric[i] ? 'num' : ''} t-${c.type}">${bdi(clip(c.text, c.type, o))}</td>`).join('')}</tr>`).join('')
    : `<tr><td class="empty" colspan="${t.headers.length}">${esc(doc.labels.noRows)}</td></tr>`;
  const more =
    o.compact && t.rows.length > rows.length
      ? fill(doc.labels.truncated, { shown: rows.length, total: t.rows.length })
      : t.truncatedNote;
  return `<div class="tbl"><h3>${esc(t.title)}</h3><table class="data">${head}<tbody>${body}</tbody></table>${more ? `<p class="small">${esc(more)}</p>` : ''}</div>`;
}

function sectionHtml(s: RenderSection, doc: RenderDoc, o: HtmlOptions): string {
  const chip = s.classification ? `<span class="chip sec">${esc(fill(doc.labels.sectionClassification, { classification: s.classification }))}</span>` : '';
  if (s.withheld) return `<section class="withheld"><h2>${esc(s.title)}</h2><p class="muted">${esc(doc.labels.withheld)}</p></section>`;
  const figures = s.figures.length
    ? `<div class="figures">${s.figures
        .map((f) => `<div class="fig"><div class="fv">${bdi(f.text)}</div><div class="fl">${esc(f.label)}</div>${f.previousText ? `<div class="fp">${bdi(f.previousText)}</div>` : ''}</div>`)
        .join('')}</div>`
    : '';
  const notes = s.notes.length ? `<ul class="notes">${s.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '';
  const tables = s.tables.map((t) => tableHtml(t, doc, o)).join('');
  const unverified = s.unverified.length
    ? `<p class="small"><strong>${esc(doc.labels.unverifiedData)}:</strong> ${s.unverified
        .slice(0, o.compact ? 5 : 40)
        .map(bdi)
        .join(' · ')}${s.unverified.length > (o.compact ? 5 : 40) ? ' …' : ''}</p>`
    : '';
  const sources = s.sources.length
    ? `<p class="small src"><strong>${esc(doc.labels.sources)}:</strong> ${s.sources
        .slice(0, o.compact ? 6 : 40)
        .map(bdi)
        .join(' · ')}${s.sources.length > (o.compact ? 6 : 40) ? ' …' : ''}</p>`
    : '';
  return `<section><h2>${esc(s.title)} ${chip}</h2>${figures}${notes}${tables}${unverified}${sources}</section>`;
}

/** Metadata block: one pair per row, or two pairs per row on the one-page layout. */
function metaRows(doc: RenderDoc, o: HtmlOptions): string {
  const cell = ([k, v]: [string, string]) => `<th>${esc(k)}</th><td>${k === doc.labels.contentHash ? `<bdi dir="ltr" class="mono">${esc(v)}</bdi>` : bdi(v)}</td>`;
  if (!o.compact) return doc.meta.map((m) => `<tr>${cell(m)}</tr>`).join('');
  const rows: string[] = [];
  const pairs = doc.meta.filter(([k]) => k !== doc.labels.contentHash);
  for (let i = 0; i < pairs.length; i += 2) rows.push(`<tr>${cell(pairs[i]!)}${pairs[i + 1] ? cell(pairs[i + 1]!) : '<th></th><td></td>'}</tr>`);
  const hash = doc.meta.find(([k]) => k === doc.labels.contentHash);
  if (hash) rows.push(`<tr>${cell(hash)}<th></th><td></td></tr>`);
  return rows.join('');
}

export function reportHtml(doc: RenderDoc, o: HtmlOptions): string {
  const color = CHIP[doc.classification] ?? '#1f4e8c';
  const base = o.compact ? 7 : 9;
  return `<!doctype html>
<html lang="${doc.locale}" dir="${doc.dir}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:">
<title>${esc(doc.title)} — ${esc(doc.projectLine)}</title>
<style>
${fontFaceCss()}
@page { size: A4; margin: ${o.compact ? '10mm 10mm 14mm 10mm' : '14mm 12mm 16mm 12mm'}; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; color: #1b2430; font-size: ${base}pt; line-height: ${o.compact ? 1.3 : 1.45}; font-family: 'Hub Sans', 'Hub Sans Arabic', sans-serif; }
html[dir='rtl'] body { font-family: 'Hub Sans Arabic', 'Hub Sans', sans-serif; line-height: ${o.compact ? 1.32 : 1.6}; }
.banner { display: flex; gap: 6px; align-items: center; margin-block-end: 6px; }
.chip { display: inline-block; padding: 1px 7px; border-radius: 9px; font-size: ${base - 1}pt; font-weight: 600; color: #fff; background: ${color}; }
.chip.demo { background: #9c5700; }
.chip.sec { background: #e8eef6; color: #1f4e8c; font-weight: 400; }
h1 { font-size: ${o.compact ? 15 : 18}pt; margin: 0; color: #0f2f57; }
.project { font-size: ${base + 1}pt; color: #3b4a5c; margin-block-end: 6px; }
h2 { font-size: ${o.compact ? 9.5 : 12}pt; color: #0f2f57; margin: ${o.compact ? 4 : 12}px 0 3px; padding-block-end: 2px; border-block-end: 1.5px solid #c8d3e0; break-after: avoid; }
h3 { font-size: ${base}pt; margin: 6px 0 2px; color: #26405f; break-after: avoid; }
table { border-collapse: collapse; width: 100%; }
table.meta { width: auto; margin-block-end: 4px; }
table.meta th { text-align: start; font-weight: 600; padding: 0; padding-inline-end: 10px; color: #3b4a5c; vertical-align: top; white-space: nowrap; }
table.meta td { padding-inline-end: 18px; }
table.meta td { padding: 1px 0; overflow-wrap: anywhere; }
table.data { table-layout: auto; font-size: ${base - 1.5}pt; }
table.data th { background: #e8eef6; font-weight: 600; text-align: start; }
table.data th, table.data td { border: 0.6px solid #c8d3e0; padding: 2px 4px; vertical-align: top; overflow-wrap: break-word; word-break: normal; }
table.data td.num, table.data th.num { text-align: end; font-variant-numeric: tabular-nums; }
table.data td.t-code, table.data td.t-date, table.data td.t-number, table.data td.t-percent, table.data td.t-boolean { white-space: nowrap; }
table.data td.t-text { overflow-wrap: anywhere; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
td.empty { color: #6b7685; font-style: italic; }
.figures { display: flex; flex-wrap: wrap; gap: 4px; margin: 2px 0 4px; }
.fig { border: 0.6px solid #c8d3e0; border-radius: 4px; padding: ${o.compact ? '1px 5px' : '2px 6px'}; min-width: ${o.compact ? 70 : 96}px; max-width: 32%; break-inside: avoid; }
.fv { font-size: ${o.compact ? 9.5 : 12}pt; font-weight: 600; color: #0f2f57; line-height: 1.25; }
.fl { font-size: ${base - 1.5}pt; color: #3b4a5c; }
.fp { font-size: ${base - 2}pt; color: #6b7685; }
.notes { margin: 2px 0; padding-inline-start: 14px; font-size: ${base - 1}pt; color: #3b4a5c; }
.small { font-size: ${base - 2}pt; color: #4e5b6b; margin: ${o.compact ? 1 : 2}px 0; overflow-wrap: anywhere; }
.muted { color: #6b7685; font-style: italic; }
.mono { font-variant-numeric: tabular-nums; letter-spacing: 0.02em; font-size: ${base - 2}pt; }
.lead { font-size: ${base - 1}pt; color: #3b4a5c; margin: 2px 0; }
section { break-inside: auto; }
.tbl { break-inside: auto; }
</style>
</head>
<body>
<div class="banner"><span class="chip">${esc(doc.labels.classification)}: ${esc(doc.classificationLabel)}</span>${doc.demo ? `<span class="chip demo">${esc(doc.labels.demoBanner)}</span>` : ''}</div>
<h1>${esc(doc.title)}</h1>
<div class="project">${bdi(doc.projectLine)}</div>
<table class="meta">${metaRows(doc, o)}</table>
<p class="lead">${esc(doc.labels.snapshotNote)}</p>
${doc.partialNote ? `<p class="lead"><strong>${esc(doc.partialNote)}</strong></p>` : ''}
${doc.sections.map((s) => sectionHtml(s, doc, o)).join('\n')}
</body>
</html>`;
}

/** Footer of every PDF page: classification and page n / N (fonts embedded again — templates are isolated documents). */
export function footerHtml(doc: RenderDoc): string {
  return `<div dir="${doc.dir}" style="width:100%;font-size:7pt;padding:0 12mm;display:flex;justify-content:space-between;color:#3b4a5c;font-family:'Hub Sans','Hub Sans Arabic',sans-serif;"><style>${fontFaceCss()}</style><span>${esc(doc.labels.classification)}: ${esc(doc.classificationLabel)}${doc.demo ? ` · ${esc(doc.labels.demoBanner)}` : ''}</span><span dir="ltr"><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;
}
