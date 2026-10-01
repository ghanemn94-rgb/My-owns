import { describe, expect, it } from 'vitest';
import {
  IMPORT_MESSAGES_EN,
  IMPORT_TARGET_FIELDS,
  assertAcceptedRows,
  assertMapping,
  assertPreviewUnchanged,
  checkImportRow,
  diffFields,
  excelSerialToIsoDate,
  governedReason,
  harmfulFormula,
  importTransition,
  normalizeKey,
  parseImportDate,
  rowIsBlank,
  suggestMapping,
  textStartsLikeFormula,
} from './imports';
import { DomainError } from './errors';
import { formatMessage } from './messages';

const cell = (v: string | number | null, extra: Record<string, unknown> = {}) => ({ v, ...extra });

describe('REQ-INT-001 mapping and validation (values only)', () => {
  it('suggests a mapping from English and Arabic headers', () => {
    expect(suggestMapping('risk', ['Risk Title', 'Probability', 'Impact', 'Due Date', 'Notes'])).toEqual({ title: 'Risk Title', probability: 'Probability', impact: 'Impact', dueDate: 'Due Date' });
    expect(suggestMapping('task', ['رمز هيكل العمل', 'المهمة', 'تاريخ البدء', 'الحالة'])).toEqual({ wbsCode: 'رمز هيكل العمل', title: 'المهمة', plannedStart: 'تاريخ البدء', reportedStatus: 'الحالة' });
  });

  it('refuses a mapping that misses a required field, names an unknown column, or uses a column twice', () => {
    const headers = ['Title', 'P', 'I'];
    expect(() => assertMapping('risk', { title: 'Title', probability: 'P' }, headers)).toThrow(/impact/);
    expect(() => assertMapping('risk', { title: 'Title', probability: 'P', impact: 'X' }, headers)).toThrow(DomainError);
    expect(() => assertMapping('risk', { title: 'Title', probability: 'P', impact: 'P' }, headers)).toThrow(/one field only/);
    expect(() => assertMapping('risk', { title: 'Title', probability: 'P', impact: 'I' }, headers)).not.toThrow();
  });

  it('checks types: scale 1–5, dates (ISO, day-first, spreadsheet serial, Arabic digits), enums, lengths', () => {
    const ok = checkImportRow('risk', { title: cell('Vendor delay'), probability: cell(3), impact: cell('٤'), dueDate: cell('15/03/2027'), responseStrategy: cell('Mitigate') });
    expect(ok.errors).toEqual([]);
    expect(ok.values).toMatchObject({ title: 'Vendor delay', probability: 3, impact: 4, dueDate: '2027-03-15', responseStrategy: 'mitigate' });
    const bad = checkImportRow('risk', { title: cell(''), probability: cell(7), impact: cell(2.5), dueDate: cell('31/02/2027'), responseStrategy: cell('ignore') });
    expect(bad.errors.map((e) => e.code)).toEqual(['imports.row.required', 'imports.row.not_scale5', 'imports.row.not_scale5', 'imports.row.bad_date', 'imports.row.bad_enum']);
    const t = checkImportRow('task', { wbsCode: cell('WS1.2'), title: cell('Migrate'), plannedStart: cell(46100), plannedFinish: cell('2026-01-01') });
    expect(t.values['plannedStart']).toBe('2026-03-19');
    expect(t.errors.map((e) => e.code)).toEqual(['imports.row.date_order']);
  });

  it('dates: Excel 1900 system including the 1900 leap-year quirk, and the 1904 system', () => {
    expect(excelSerialToIsoDate(1)).toBe('1900-01-01');
    expect(excelSerialToIsoDate(59)).toBe('1900-02-28');
    expect(excelSerialToIsoDate(61)).toBe('1900-03-01');
    expect(excelSerialToIsoDate(45658)).toBe('2025-01-01');
    expect(excelSerialToIsoDate(0, true)).toBeNull();
    expect(excelSerialToIsoDate(1, true)).toBe('1904-01-02');
    expect(parseImportDate('2026-09-30T10:00:00Z')).toBe('2026-09-30');
    expect(parseImportDate('2026-02-30')).toBeNull();
    expect(parseImportDate('٠١/٠٢/٢٠٢٧')).toBe('2027-02-01');
  });

  it('blank rows are dropped', () => {
    expect(rowIsBlank({ title: cell(''), probability: cell(null) })).toBe(true);
    expect(rowIsBlank({ title: cell(' x ') })).toBe(false);
  });
});

describe('AT-25 formulas are never evaluated; harmful formulas and internal URLs block the row', () => {
  it('detects harmful formulas (web calls, DDE, external references, hyperlinks)', () => {
    expect(harmfulFormula('WEBSERVICE("http://169.254.169.254/latest/meta-data")')).toBe('WEBSERVICE');
    expect(harmfulFormula('=HYPERLINK("http://x.invalid","Click")')).toBe('HYPERLINK');
    expect(harmfulFormula("cmd|' /C calc'!A0")).toBe('DDE');
    expect(harmfulFormula('[1]Sheet1!A1')).toBe('EXTERNAL_REFERENCE');
    expect(harmfulFormula("'\\\\server\\share\\[book.xlsx]Sheet1'!A1")).toBe('EXTERNAL_REFERENCE');
    expect(harmfulFormula('SUM(A1:A9)*2')).toBeNull();
  });

  it('a formula cell keeps its cached value as untrusted text with a warning; a harmful one is an error and its value is dropped', () => {
    const benign = checkImportRow('risk', { title: cell('Total', { f: 'CONCAT("To","tal")' }), probability: cell(2, { f: '1+1' }), impact: cell(3) });
    expect(benign.errors).toEqual([]);
    expect(benign.formulaFields).toEqual(['title', 'probability']);
    expect(benign.values).toMatchObject({ title: 'Total', probability: 2 });
    expect(benign.warnings.map((w) => w.code)).toEqual(['imports.row.formula_cached_value', 'imports.row.formula_cached_value']);
    const harmful = checkImportRow('risk', { title: cell('pwned', { f: 'WEBSERVICE("http://169.254.169.254/")' }), probability: cell(1), impact: cell(1) });
    expect(harmful.errors).toEqual([{ code: 'imports.row.harmful_formula', params: { field: 'title', function: 'WEBSERVICE' } }]);
    expect(harmful.values['title']).toBeNull();
  });

  it('formula-like TEXT is kept as text with a warning; signed numbers are not flagged', () => {
    const r = checkImportRow('risk', { title: cell('=1+1'), probability: cell('1'), impact: cell('1') });
    expect(r.values['title']).toBe('=1+1');
    expect(r.warnings.map((w) => w.code)).toContain('imports.row.formula_like_text');
    expect(textStartsLikeFormula('-5')).toBe(false);
    expect(textStartsLikeFormula('@SUM(A1)')).toBe(true);
  });

  it('IT-equivalent: a value referencing http://169.254.169.254 is rejected; an external link is inert', () => {
    const r = checkImportRow('risk', { title: cell('See http://169.254.169.254/latest/meta-data/iam'), probability: cell(1), impact: cell(1) });
    expect(r.errors).toEqual([{ code: 'imports.row.internal_url', params: { field: 'title', host: '169.254.169.254' } }]);
    const ext = checkImportRow('risk', { title: cell('Spec at https://example.com/x'), probability: cell(1), impact: cell(1) });
    expect(ext.errors).toEqual([]);
    expect(ext.warnings.map((w) => w.code)).toEqual(['imports.row.url_inert']);
  });

  it('a spreadsheet error value (#REF!) is an error, never a value', () => {
    expect(checkImportRow('risk', { title: cell('#REF!', { e: true }), probability: cell(1), impact: cell(1) }).errors[0]!.code).toBe('imports.row.cell_error');
  });
});

describe('REQ-INT-015 / REQ-SRC-009 / AT-01 never overwrite — proposals only', () => {
  it('UT: duplicate row flagged with matching record id — field differences against the current record', () => {
    expect(diffFields({ title: 'A', probability: 3, impact: 2 }, { title: 'A', probability: 4, impact: null }, ['title', 'probability', 'impact'])).toEqual([{ field: 'probability', from: 3, to: 4 }]);
    expect(normalizeKey('  Vendor   Delay! ')).toBe(normalizeKey('vendor delay'));
  });

  it('decisions are always governed; baselined tasks are governed; risks are not', () => {
    expect(governedReason('decision', { status: 'draft' })).toBe('committee_decision');
    expect(governedReason('task', { inApprovedBaseline: true })).toBe('approved_baseline');
    expect(governedReason('task', { inApprovedBaseline: false })).toBeNull();
    expect(governedReason('risk', {})).toBeNull();
  });

  it('item-by-item acceptance: only applicable rows, each once, at least one', () => {
    const applicable = new Set([2, 3, 5]);
    expect(() => assertAcceptedRows([2, 5], applicable)).not.toThrow();
    expect(() => assertAcceptedRows([2, 4], applicable)).toThrow(/cannot be accepted/);
    expect(() => assertAcceptedRows([2, 2], applicable)).toThrow(/twice/);
    expect(() => assertAcceptedRows([], applicable)).toThrow(/at least one/);
  });

  it('the approver binds to the submitted preview', () => {
    expect(() => assertPreviewUnchanged('abc', 'abc')).not.toThrow();
    expect(() => assertPreviewUnchanged('abc', 'abd')).toThrow(/validate it again/);
    expect(() => assertPreviewUnchanged(null, 'abd')).toThrow(DomainError);
  });
});

describe('import batch lifecycle', () => {
  it('legal transitions apply; others are refused', () => {
    expect(importTransition('uploaded', 'parsed')).toBe('parsed');
    expect(importTransition('uploaded', 'extracted')).toBe('validated');
    expect(importTransition('validated', 'map')).toBe('validated');
    expect(importTransition('submitted', 'approve')).toBe('applied');
    expect(importTransition('applied', 'rollback')).toBe('rolled_back');
    expect(() => importTransition('validated', 'approve')).toThrow(/cannot be approve/);
    expect(() => importTransition('applied', 'approve')).toThrow(DomainError);
    expect(() => importTransition('rolled_back', 'rollback')).toThrow(DomainError);
    expect(() => importTransition('quarantined', 'map')).toThrow(DomainError);
  });
});

describe('message templates', () => {
  it('every field referenced in templates renders; the field catalogue keys are unique per target', () => {
    for (const [code, t] of Object.entries(IMPORT_MESSAGES_EN)) expect(formatMessage(t, { field: 'f', max: 1, min: 1, host: 'h', function: 'F', key: 'k', row: 1, code: 'C', fields: 'a', reason: 'r', type: 't', value: 'v', count: 1 }), code).not.toMatch(/\{\w+\}/);
    for (const fields of Object.values(IMPORT_TARGET_FIELDS)) expect(new Set(fields.map((f) => f.key)).size).toBe(fields.length);
  });
});
