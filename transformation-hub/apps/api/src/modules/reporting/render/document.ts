import type { ReportCellDto, ReportColumnType } from '@hub/contracts';
import { ENUM_LABELS } from './enum-labels';
import { REPORT_LABELS, type ReportLocale } from './labels';
import type { StoredReportPayload, StoredSection } from '../report-model';

/**
 * Format-neutral render model of ONE viewer's view of a snapshot (ADR-0011): every renderer (XLSX, PDF, PPTX, DOCX) prints
 * exactly this — the same texts, the same figures — so all files of a snapshot reconcile to it and to each other.
 * Only sections the requester may see are passed in; withheld sections appear as a title with the "outside your access"
 * line and nothing else.
 */
export interface RenderCell {
  text: string;
  /** Numeric value for spreadsheets (numbers / percentages), else null. */
  number: number | null;
  type: ReportColumnType;
}
export interface RenderTable {
  key: string;
  title: string;
  headers: string[];
  types: ReportColumnType[];
  rows: RenderCell[][];
  /** "Showing n of m rows" when the snapshot kept only part of the rows. */
  truncatedNote: string | null;
}
export interface RenderFigure {
  key: string;
  label: string;
  text: string;
  value: number | null;
  previousText: string | null;
}
export interface RenderSection {
  key: string;
  title: string;
  withheld: boolean;
  classification: string | null;
  figures: RenderFigure[];
  tables: RenderTable[];
  notes: string[];
  unverified: string[];
  sources: string[];
}
export interface RenderDoc {
  locale: ReportLocale;
  dir: 'rtl' | 'ltr';
  kind: string;
  title: string;
  projectLine: string;
  meta: [string, string][];
  classification: string;
  classificationLabel: string;
  demo: boolean;
  labels: (typeof REPORT_LABELS)['en']['meta'];
  partialNote: string | null;
  sections: RenderSection[];
  filenameBase: string;
  contentHash: string;
  /** As-of instant of the snapshot (ISO). */
  asOf: string;
}

export interface RenderInput {
  payload: StoredReportPayload;
  contentHash: string;
  classification: string;
  /** Sections in snapshot order; `null` = withheld for this viewer. */
  sections: { key: string; section: StoredSection | null }[];
  locale: ReportLocale;
}

const INTL: Record<ReportLocale, string> = { en: 'en-GB-u-ca-gregory-nu-latn', ar: 'ar-SA-u-ca-gregory-nu-latn' };
export const EM_DASH = '—';

/**
 * Direction of a text by its first strong character (Unicode bidi rule P2): Arabic / Hebrew letters → right-to-left,
 * Latin and other letters → left-to-right; no strong character → `fallback`. Office renderers give each paragraph the
 * direction of its own text, so an English sentence in an Arabic document keeps its punctuation in place.
 */
export function textIsRtl(s: string, fallback: boolean): boolean {
  for (const ch of s) {
    if (/[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/.test(ch)) return true;
    if (/\p{L}/u.test(ch)) return false;
  }
  return fallback;
}

export function fill(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (params[k] !== undefined ? String(params[k]) : `{${k}}`));
}

export class Formatter {
  private readonly date: Intl.DateTimeFormat;
  private readonly dateTime: Intl.DateTimeFormat;
  private readonly num: Intl.NumberFormat;
  constructor(
    readonly locale: ReportLocale,
    timezone: string,
  ) {
    this.date = new Intl.DateTimeFormat(INTL[locale], { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    this.dateTime = new Intl.DateTimeFormat(INTL[locale], { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: timezone });
    this.num = new Intl.NumberFormat(INTL[locale], { maximumFractionDigits: 1 });
  }
  /** Business date (YYYY-MM-DD) → formatted in UTC so it never shifts a day; instants in the project time zone. */
  dateOf(v: string | null | undefined): string {
    if (!v) return EM_DASH;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return this.date.format(new Date(`${v}T00:00:00Z`));
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? v : this.dateTime.format(d);
  }
  number(n: number | null | undefined): string {
    return n === null || n === undefined ? EM_DASH : this.num.format(n);
  }
  /** Decimal-string money, formatted without float rounding (integer part via BigInt), with currency and unit scale. */
  money(m: { amount: string; currency: string; unitScale: number }): string {
    const neg = m.amount.startsWith('-');
    const [int, frac = ''] = m.amount.replace('-', '').split('.');
    const grouped = new Intl.NumberFormat(INTL[this.locale]).format(BigInt(int || '0'));
    const dec = new Intl.NumberFormat(INTL[this.locale], { minimumFractionDigits: 1 }).formatToParts(1.5).find((p) => p.type === 'decimal')?.value ?? '.';
    const fraction = (frac + '00').slice(0, 2);
    const scale = m.unitScale === 1000 ? REPORT_LABELS[this.locale].meta.thousands : m.unitScale === 1_000_000 ? REPORT_LABELS[this.locale].meta.millions : '';
    return `${neg ? '-' : ''}${m.currency} ${grouped}${dec}${fraction}${scale ? ` ${scale}` : ''}`;
  }
}

function enumLabel(locale: ReportLocale, enumName: string | null, value: string): string {
  let name = enumName;
  let v = value;
  if (!name && value.includes(':')) [name, v] = value.split(':', 2) as [string, string];
  if (!name) return v;
  const own = REPORT_LABELS[locale].enums[name]?.[v];
  if (own) return own;
  return ENUM_LABELS[locale][name]?.[v] ?? v.replace(/_/g, ' ');
}

export function cellOf(f: Formatter, locale: ReportLocale, type: ReportColumnType, enumName: string | null, v: ReportCellDto): RenderCell {
  const L = REPORT_LABELS[locale].meta;
  const plain = (text: string, number: number | null = null): RenderCell => ({ text, number, type });
  if (v === null || v === undefined || v === '') return plain(type === 'person' ? L.notAssigned : EM_DASH);
  if (typeof v === 'object' && 'en' in v) return plain(locale === 'ar' ? (v.ar ?? v.en) : v.en);
  if (typeof v === 'object' && 'amount' in v) return plain(f.money(v));
  if (typeof v === 'boolean') return plain(v ? L.yes : L.no);
  switch (type) {
    case 'date':
      return plain(f.dateOf(String(v)));
    case 'number':
      return typeof v === 'number' ? plain(f.number(v), v) : plain(String(v));
    case 'percent':
      return typeof v === 'number' ? plain(`${f.number(v)}%`, v) : plain(String(v));
    case 'enum':
      return plain(enumLabel(locale, enumName, String(v)));
    case 'text':
      // Instants stored as text (e.g. computed at) are shown in the project time zone.
      return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? plain(f.dateOf(v)) : plain(String(v));
    default:
      return plain(String(v));
  }
}

function figureText(f: Formatter, unit: string, v: number | null): string {
  if (v === null) return EM_DASH;
  return unit === 'percent' ? `${f.number(v)}%` : f.number(v);
}

function noteText(locale: ReportLocale, f: Formatter, code: string, params: Record<string, string | number>): string | null {
  const tpl = REPORT_LABELS[locale].notes[code];
  if (!tpl) return null;
  const p: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(params)) p[k] = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? f.dateOf(v) : typeof v === 'number' ? f.number(v) : v;
  return fill(tpl, p);
}

export function sectionTitle(locale: ReportLocale, key: string): string {
  return REPORT_LABELS[locale].sections[key] ?? key;
}

function renderSection(locale: ReportLocale, f: Formatter, key: string, s: StoredSection | null): RenderSection {
  const L = REPORT_LABELS[locale];
  if (!s) return { key, title: sectionTitle(locale, key), withheld: true, classification: null, figures: [], tables: [], notes: [], unverified: [], sources: [] };
  const isKpi = key.startsWith('kpis.');
  return {
    key,
    title: sectionTitle(locale, key),
    withheld: false,
    classification: enumLabel(locale, 'classifications', s.access.classification),
    figures: isKpi
      ? []
      : s.figures.map((x) => ({
          key: x.key,
          label: L.figures[x.key] ?? x.key,
          text: figureText(f, x.unit, x.value),
          value: x.value,
          previousText: x.compared && x.previous !== x.value ? fill(L.meta.previous, { value: figureText(f, x.unit, x.previous) }) : null,
        })),
    tables: s.tables.map((t) => ({
      key: t.key,
      title: L.tables[t.key] ?? t.key,
      headers: t.columns.map((c) => L.columns[c.key] ?? c.key),
      types: t.columns.map((c) => c.type),
      rows: t.rows.map((r) => t.columns.map((c) => cellOf(f, locale, c.type, c.enumName, r[c.key] ?? null))),
      truncatedNote: t.truncated ? fill(L.meta.truncated, { shown: f.number(t.rows.length), total: f.number(t.totalRows) }) : null,
    })),
    notes: s.notes.map((n) => noteText(locale, f, n.code, n.params)).filter((x): x is string => !!x),
    unverified: s.unverified.map((u) => `${u.label} — ${enumLabel(locale, 'verificationStatuses', u.status)}`),
    sources: s.sourceRefs.map((r) => (r.type === 'register' ? (L.sources[r.label] ?? r.label) : r.label)),
  };
}

export function buildRenderDoc(input: RenderInput): RenderDoc {
  const { payload, locale } = input;
  const L = REPORT_LABELS[locale];
  const f = new Formatter(locale, payload.project.timezone);
  const kindLabel = enumLabel(locale, 'reportKinds', payload.kind);
  const scope = payload.scope.workstreamCode
    ? fill(L.meta.scopeWorkstream, { code: payload.scope.workstreamCode })
    : payload.scope.meetingId
      ? L.meta.scopeMeeting
      : L.meta.scopeProject;
  const sections = input.sections.map((s) => renderSection(locale, f, s.key, s.section));
  const unverified = sections.reduce((a, s) => a + s.unverified.length, 0);
  const classificationLabel = enumLabel(locale, 'classifications', input.classification);
  const meta: [string, string][] = [
    [L.meta.project, `${payload.project.code} — ${payload.project.name}`],
    [L.meta.asOf, `${f.dateOf(payload.asOfLocalDate)} (${f.dateOf(payload.asOf)})`],
    [L.meta.scope, scope],
    [L.meta.baseline, payload.baseline ? fill(L.meta.baselineVersion, { version: payload.baseline.versionNo }) : L.meta.noBaseline],
    [L.meta.classification, classificationLabel],
    [L.meta.unverifiedData, unverified ? fill(L.meta.unverifiedCount, { count: f.number(unverified) }) : L.meta.none],
    [L.meta.generatedBy, payload.generatedBy.name ?? EM_DASH],
    [L.meta.contentHash, input.contentHash],
  ];
  const safe = (x: string) => x.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return {
    locale,
    dir: locale === 'ar' ? 'rtl' : 'ltr',
    kind: payload.kind,
    title: kindLabel,
    projectLine: `${payload.project.code} — ${payload.project.name}`,
    meta,
    classification: input.classification,
    classificationLabel,
    demo: payload.project.isDemo,
    labels: L.meta,
    partialNote: sections.some((s) => s.withheld) ? L.meta.partialView : null,
    sections,
    filenameBase: safe(`${payload.project.code}-${payload.kind}-${payload.asOfLocalDate}-${locale}`),
    contentHash: input.contentHash,
    asOf: payload.asOf,
  };
}
