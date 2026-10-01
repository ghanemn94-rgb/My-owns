/**
 * Excel / CSV / document import rules (spec §17, §2; REQ-INT-001..005, REQ-INT-015, REQ-SRC-009, AT-01, AT-25) — pure.
 *
 *  - Targets: what an import may produce. Imports create DRAFT / PROPOSED records or source claims only: a row that matches
 *    an existing record never updates it — the difference becomes a proposed change for review (a claim), and for a
 *    governed record (committee decision, a record of the approved baseline) a change request (REQ-INT-015, C-43).
 *  - Cells are VALUES only. A formula cell carries its cached value as untrusted text and is flagged; harmful formulas
 *    (web / DDE / external calls, hyperlinks) block the row; nothing is ever evaluated (C-16).
 *  - Links in cells are inert text; a link to an internal address (loopback, private, link-local, metadata) blocks the row
 *    (REQ-SEC-014). URLs are never fetched.
 *  - A source-reported status (e.g. "Completed", "On Track") never sets a current status: it becomes a
 *    historical-unverified claim (AT-01).
 */
import { conflict, ruleViolation } from './errors';
import type { ImportStatus } from './enums';
import { serverMessage, type ServerMessage } from './messages';
import type { AllowedFileType } from './documents';
import { hostIsInternal, urlsIn } from './integrations';
import { isFormulaLike } from './reporting';

// ---------------------------------------------------------------------------------------------------------
// Targets, file types and limits

export const IMPORT_TARGETS = ['risk', 'task', 'decision', 'source_claims', 'document_claims'] as const;
export type ImportTarget = (typeof IMPORT_TARGETS)[number];

/** Spreadsheet targets (xlsx / csv) and document targets (docx / pdf / images → claims for review). */
export const IMPORT_TARGET_FILE_TYPES: Record<ImportTarget, readonly AllowedFileType[]> = {
  risk: ['xlsx', 'csv'],
  task: ['xlsx', 'csv'],
  decision: ['xlsx', 'csv'],
  source_claims: ['xlsx', 'csv'],
  document_claims: ['docx', 'pdf', 'png', 'jpeg'],
};
export const isDocumentTarget = (t: ImportTarget) => t === 'document_claims';

/** Source-register type of the preserved file. */
export function importSourceType(fileType: AllowedFileType): 'excel' | 'csv' | 'docx' | 'pdf' | 'image' {
  if (fileType === 'xlsx') return 'excel';
  if (fileType === 'csv') return 'csv';
  if (fileType === 'docx') return 'docx';
  if (fileType === 'pdf') return 'pdf';
  return 'image';
}

/**
 * Parser limits (C-16, REQ-SEC-015). The parser runs in an isolated worker with a V8 heap cap and a wall-clock timeout; it
 * refuses a file that would exceed any of these, rather than truncating it silently.
 */
export const IMPORT_LIMITS = {
  maxSheets: 20,
  maxRows: 5000,
  maxColumns: 100,
  maxCells: 250_000,
  maxCellChars: 10_000,
  maxFormulaChars: 500,
  maxZipEntries: 2000,
  /** Sum of the uncompressed sizes of the parts actually read. */
  maxUncompressedBytes: 80 * 1024 * 1024,
  maxEntryBytes: 40 * 1024 * 1024,
  /** Uncompressed / compressed ratio of one part (zip-bomb guard). */
  maxRatio: 150,
  maxParagraphs: 500,
  timeoutMs: 20_000,
  heapMb: 192,
} as const;
export type ImportLimits = typeof IMPORT_LIMITS;

// ---------------------------------------------------------------------------------------------------------
// Batch lifecycle

export type ImportBatchStatus = ImportStatus;
export type ImportCommand = 'parsed' | 'extracted' | 'parse_failed' | 'quarantine' | 'map' | 'submit' | 'approve' | 'reject' | 'cancel' | 'rollback';

const MACHINE: Record<ImportBatchStatus, Partial<Record<ImportCommand, ImportBatchStatus>>> = {
  uploaded: { parsed: 'parsed', extracted: 'validated', parse_failed: 'failed', quarantine: 'quarantined', cancel: 'cancelled' },
  parsed: { map: 'validated', cancel: 'cancelled' },
  validated: { map: 'validated', submit: 'submitted', cancel: 'cancelled' },
  submitted: { approve: 'applied', reject: 'rejected', cancel: 'cancelled' },
  applied: { rollback: 'rolled_back' },
  rolled_back: {},
  rejected: {},
  cancelled: {},
  failed: {},
  quarantined: {},
};

export function importTransition(from: ImportBatchStatus, command: ImportCommand): ImportBatchStatus {
  const to = MACHINE[from]?.[command];
  if (!to) throw ruleViolation('imports.invalid_transition', `An import batch that is ${from.replace(/_/g, ' ')} cannot be ${command.replace(/_/g, ' ')}`, { from, command });
  return to;
}

// ---------------------------------------------------------------------------------------------------------
// Cells

/** One parsed cell. `f` = formula text (never evaluated); `e` = spreadsheet error value; `d` = date-formatted number. */
export interface ImportCell {
  v: string | number | boolean | null;
  f?: string;
  e?: true;
  d?: true;
}

/** Arabic-Indic and Eastern Arabic-Indic digits → ASCII digits (Arabic spreadsheets). */
export function normalizeDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/** Header / title comparison key: NFKC, lower case, Arabic tatweel and punctuation removed, white space collapsed. */
export function normalizeKey(s: string): string {
  return normalizeDigits(String(s ?? ''))
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ـ/g, '')
    .replace(/[*:()[\]{}"'`.,;!?#_\-–—/\\|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Imported text that a spreadsheet would treat as a formula (C-17 triggers), excluding plain signed numbers. */
export function textStartsLikeFormula(text: string): boolean {
  return isFormulaLike(text) && !/^\s*[+-]?\d+([.,]\d+)?\s*$/.test(text);
}

/**
 * Harmful formula functions and patterns (AT-25): web / data calls, external workbook references, DDE, macro calls and
 * hyperlinks. Returns the matched function or pattern, or null for an ordinary calculation.
 */
export function harmfulFormula(formula: string): string | null {
  const f = String(formula ?? '');
  const fn = /\b(WEBSERVICE|FILTERXML|IMPORTXML|IMPORTDATA|IMPORTHTML|IMPORTFEED|IMPORTRANGE|HYPERLINK|CALL|REGISTER(?:\.ID)?|EXEC|RTD|DDE|DDEAUTO|INFO|CELL|GETPIVOTDATA)\s*\(/i.exec(f);
  if (fn) return fn[1]!.toUpperCase();
  if (/^[=+\-@\s]*[A-Za-z0-9_.]+\|/.test(f) || /\|\s*'/.test(f)) return 'DDE';
  if (/\[[^\]]*\]/.test(f)) return 'EXTERNAL_REFERENCE';
  if (/(?:https?|ftp|file|smb):\/\//i.test(f) || /\\\\[A-Za-z0-9._-]+\\/.test(f)) return 'EXTERNAL_REFERENCE';
  return null;
}

/** Excel serial day number → ISO date (1900 system incl. the Lotus 29-Feb-1900 quirk, or the 1904 system). */
export function excelSerialToIsoDate(serial: number, date1904 = false): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  const days = Math.floor(serial);
  const base = date1904 ? Date.UTC(1904, 0, 1) : days >= 61 ? Date.UTC(1899, 11, 30) : Date.UTC(1899, 11, 31);
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}

function validIso(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** A date value: ISO (YYYY-MM-DD[T…]), day-first DD/MM/YYYY (also - and .), or an Excel serial number. */
export function parseImportDate(v: string | number | boolean | null): string | null {
  if (v === null || typeof v === 'boolean') return null;
  if (typeof v === 'number') return excelSerialToIsoDate(v);
  const s = normalizeDigits(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  if (m) return validIso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return validIso(Number(m[3]), Number(m[2]), Number(m[1]));
  if (/^\d{1,7}(\.\d+)?$/.test(s)) return excelSerialToIsoDate(Number(s));
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// Fields per target

export type ImportFieldType = 'text' | 'code' | 'scale5' | 'int' | 'date' | 'enum' | 'reported_status' | 'confidence';

export interface ImportFieldDef {
  key: string;
  type: ImportFieldType;
  required: boolean;
  max?: number;
  min?: number;
  values?: readonly string[];
  /** Header names recognised for automatic mapping (compared with normalizeKey), English and Arabic. */
  headers: readonly string[];
  /** The key that matches an existing record (always required on a row); other required fields are required to CREATE. */
  matchKey?: true;
}

/** Targets whose rows may match an existing record: their required fields (except the match key) are needed only to create. */
const MATCHING_TARGETS: ReadonlySet<ImportTarget> = new Set(['risk', 'task', 'decision']);

/** Required fields missing from a row that would create a new record. */
export function missingForCreate(target: ImportTarget, values: Record<string, ImportValue>): string[] {
  return IMPORT_TARGET_FIELDS[target].filter((f) => f.required && (values[f.key] === null || values[f.key] === undefined || values[f.key] === '')).map((f) => f.key);
}

const CODE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,31}$/;
export const CLAIM_IMPORT_TARGET_TYPES = ['project', 'workstream', 'task', 'milestone', 'deliverable'] as const;
export const CLAIM_IMPORT_VERIFICATION = ['historical_unverified', 'proposed', 'unknown', 'assumed'] as const;

export const IMPORT_TARGET_FIELDS: Record<ImportTarget, readonly ImportFieldDef[]> = {
  risk: [
    { key: 'code', type: 'code', required: false, headers: ['code', 'risk code', 'risk id', 'id', 'ref', 'reference', 'الرمز', 'رمز المخاطرة'] },
    { key: 'title', type: 'text', required: true, max: 300, headers: ['title', 'risk', 'risk title', 'name', 'العنوان', 'المخاطرة', 'عنوان المخاطرة'] },
    { key: 'description', type: 'text', required: false, max: 4000, headers: ['description', 'details', 'الوصف', 'التفاصيل'] },
    { key: 'probability', type: 'scale5', required: true, headers: ['probability', 'likelihood', 'p', 'الاحتمالية', 'الاحتمال'] },
    { key: 'impact', type: 'scale5', required: true, headers: ['impact', 'severity', 'i', 'الأثر', 'التأثير'] },
    { key: 'dueDate', type: 'date', required: false, headers: ['due date', 'due', 'target date', 'تاريخ الاستحقاق'] },
    { key: 'workstream', type: 'code', required: false, headers: ['workstream', 'workstream code', 'ws', 'مسار العمل'] },
    { key: 'responseStrategy', type: 'enum', required: false, values: ['avoid', 'mitigate', 'transfer', 'accept'], headers: ['response strategy', 'strategy', 'response', 'استراتيجية الاستجابة'] },
  ],
  task: [
    { key: 'wbsCode', type: 'code', required: true, matchKey: true, headers: ['wbs', 'wbs code', 'code', 'task code', 'id', 'رمز هيكل العمل', 'الرمز'] },
    { key: 'title', type: 'text', required: true, max: 300, headers: ['title', 'task', 'activity', 'name', 'العنوان', 'المهمة', 'النشاط'] },
    { key: 'workstream', type: 'code', required: false, headers: ['workstream', 'workstream code', 'ws', 'مسار العمل'] },
    { key: 'plannedStart', type: 'date', required: false, headers: ['planned start', 'start', 'start date', 'تاريخ البدء', 'البداية'] },
    { key: 'plannedFinish', type: 'date', required: false, headers: ['planned finish', 'finish', 'end', 'end date', 'due', 'تاريخ الانتهاء', 'النهاية'] },
    { key: 'durationDays', type: 'int', required: false, min: 0, max: 3650, headers: ['duration', 'duration days', 'days', 'المدة'] },
    { key: 'description', type: 'text', required: false, max: 4000, headers: ['description', 'details', 'الوصف'] },
    { key: 'reportedStatus', type: 'reported_status', required: false, max: 64, headers: ['status', 'reported status', 'state', 'الحالة'] },
  ],
  decision: [
    { key: 'code', type: 'code', required: true, matchKey: true, headers: ['code', 'decision code', 'decision', 'id', 'ref', 'الرمز', 'رمز القرار'] },
    { key: 'title', type: 'text', required: false, max: 300, headers: ['title', 'subject', 'name', 'العنوان', 'الموضوع'] },
    { key: 'reportedStatus', type: 'reported_status', required: false, max: 64, headers: ['status', 'outcome', 'reported status', 'الحالة', 'النتيجة'] },
  ],
  source_claims: [
    { key: 'subject', type: 'text', required: true, max: 500, headers: ['subject', 'item', 'claim', 'topic', 'البند', 'الموضوع'] },
    { key: 'value', type: 'text', required: true, max: 2000, headers: ['value', 'status', 'reported value', 'القيمة', 'الحالة'] },
    { key: 'location', type: 'text', required: false, max: 200, headers: ['location', 'page', 'cell', 'الموقع'] },
    { key: 'targetType', type: 'enum', required: false, values: CLAIM_IMPORT_TARGET_TYPES, headers: ['record type', 'target type', 'نوع السجل'] },
    { key: 'targetCode', type: 'code', required: false, headers: ['record code', 'target code', 'رمز السجل'] },
    { key: 'field', type: 'enum', required: false, values: ['status', 'name', 'plannedStart', 'objective', 'plannedFinish', 'actualFinish', 'reportedProgress', 'plannedDate', 'actualDate', 'dueDate'], headers: ['field', 'الحقل'] },
    { key: 'verification', type: 'enum', required: false, values: CLAIM_IMPORT_VERIFICATION, headers: ['verification', 'verification status', 'حالة التحقق'] },
    { key: 'confidence', type: 'confidence', required: false, headers: ['confidence', 'الثقة'] },
  ],
  document_claims: [{ key: 'text', type: 'text', required: true, max: 2000, headers: ['text', 'النص'] }],
};

export function importFieldDef(target: ImportTarget, key: string): ImportFieldDef | undefined {
  return IMPORT_TARGET_FIELDS[target].find((f) => f.key === key);
}

/** Automatic column mapping from the header row (exact normalised match with a field's recognised names, then its key). */
export function suggestMapping(target: ImportTarget, headers: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set<string>();
  const norm = headers.map((h) => ({ h, n: normalizeKey(h) })).filter((x) => x.n);
  for (const f of IMPORT_TARGET_FIELDS[target]) {
    const names = new Set([...f.headers.map(normalizeKey), normalizeKey(f.key.replace(/([A-Z])/g, ' $1'))]);
    const hit = norm.find((x) => !used.has(x.h) && names.has(x.n));
    if (hit) {
      out[f.key] = hit.h;
      used.add(hit.h);
    }
  }
  return out;
}

/** A mapping must name only known fields, each header at most once, and every required field. */
export function assertMapping(target: ImportTarget, mapping: Record<string, string>, headers: readonly string[]) {
  const fields = IMPORT_TARGET_FIELDS[target];
  for (const k of Object.keys(mapping)) {
    if (!fields.some((f) => f.key === k)) throw ruleViolation('imports.mapping.unknown_field', `Unknown field "${k}" for this import`, { field: k });
    if (!headers.includes(mapping[k]!)) throw ruleViolation('imports.mapping.unknown_column', `Column "${mapping[k]}" is not in the header row`, { field: k });
  }
  const cols = Object.values(mapping);
  if (new Set(cols).size !== cols.length) throw ruleViolation('imports.mapping.column_twice', 'A column can be mapped to one field only');
  const missing = fields.filter((f) => f.required && !mapping[f.key]).map((f) => f.key);
  if (missing.length) throw ruleViolation('imports.mapping.required_missing', `Required field(s) not mapped: ${missing.join(', ')}`, { fields: missing });
}

// ---------------------------------------------------------------------------------------------------------
// Row check (values only)

export type ImportValue = string | number | null;

export interface RowCheck {
  values: Record<string, ImportValue>;
  errors: ServerMessage[];
  warnings: ServerMessage[];
  /** Mapped fields whose cell was a formula (cached value used as untrusted text). */
  formulaFields: string[];
}

function cellText(c: ImportCell | undefined): string {
  if (!c || c.v === null || c.v === undefined) return '';
  if (typeof c.v === 'boolean') return c.v ? 'TRUE' : 'FALSE';
  return String(c.v).trim();
}

/** Check one row's mapped cells against the target's field definitions. Pure: matching against records is the service's. */
export function checkImportRow(target: ImportTarget, cells: Record<string, ImportCell | undefined>): RowCheck {
  const values: Record<string, ImportValue> = {};
  const errors: ServerMessage[] = [];
  const warnings: ServerMessage[] = [];
  const formulaFields: string[] = [];
  for (const f of IMPORT_TARGET_FIELDS[target]) {
    const c = cells[f.key];
    if (c?.f !== undefined) {
      formulaFields.push(f.key);
      const bad = harmfulFormula(c.f);
      if (bad) {
        errors.push(serverMessage('imports.row.harmful_formula', { field: f.key, function: bad }));
        values[f.key] = null;
        continue;
      }
      warnings.push(serverMessage('imports.row.formula_cached_value', { field: f.key }));
    }
    if (c?.e) {
      errors.push(serverMessage('imports.row.cell_error', { field: f.key }));
      values[f.key] = null;
      continue;
    }
    const text = cellText(c);
    if (!text) {
      if (f.required && (!MATCHING_TARGETS.has(target) || f.matchKey)) errors.push(serverMessage('imports.row.required', { field: f.key }));
      values[f.key] = null;
      continue;
    }
    // Links are inert text; an internal address blocks the row (never fetched either way).
    const links = urlsIn(text);
    const internal = links.find((l) => hostIsInternal(l.host));
    if (internal) {
      errors.push(serverMessage('imports.row.internal_url', { field: f.key, host: internal.host.slice(0, 80) }));
      values[f.key] = null;
      continue;
    }
    if (links.length) warnings.push(serverMessage('imports.row.url_inert', { field: f.key }));
    if (c?.f === undefined && typeof c?.v === 'string' && textStartsLikeFormula(c.v)) warnings.push(serverMessage('imports.row.formula_like_text', { field: f.key }));
    switch (f.type) {
      case 'text':
      case 'reported_status': {
        if (text.length > (f.max ?? 2000)) errors.push(serverMessage('imports.row.too_long', { field: f.key, max: f.max ?? 2000 }));
        values[f.key] = text;
        break;
      }
      case 'code': {
        const v = normalizeDigits(text);
        if (!CODE.test(v)) errors.push(serverMessage('imports.row.bad_code', { field: f.key }));
        values[f.key] = v;
        break;
      }
      case 'scale5':
      case 'int': {
        const n = typeof c?.v === 'number' ? c.v : Number(normalizeDigits(text));
        const min = f.type === 'scale5' ? 1 : (f.min ?? 0);
        const max = f.type === 'scale5' ? 5 : (f.max ?? 1_000_000);
        if (!Number.isInteger(n) || n < min || n > max) {
          errors.push(serverMessage(f.type === 'scale5' ? 'imports.row.not_scale5' : 'imports.row.not_integer', { field: f.key, min, max }));
          values[f.key] = null;
        } else values[f.key] = n;
        break;
      }
      case 'date': {
        const d = parseImportDate(typeof c?.v === 'number' ? c.v : text);
        if (!d) errors.push(serverMessage('imports.row.bad_date', { field: f.key }));
        values[f.key] = d;
        break;
      }
      case 'enum': {
        const v = text.trim();
        const hit = (f.values ?? []).find((x) => normalizeKey(x) === normalizeKey(v) || x === v);
        if (!hit) errors.push(serverMessage('imports.row.bad_enum', { field: f.key }));
        values[f.key] = hit ?? null;
        break;
      }
      case 'confidence': {
        const n = typeof c?.v === 'number' ? c.v : Number(normalizeDigits(text).replace('%', ''));
        const v = text.includes('%') ? n / 100 : n;
        if (!Number.isFinite(v) || v < 0 || v > 1) {
          errors.push(serverMessage('imports.row.bad_confidence', { field: f.key }));
          values[f.key] = null;
        } else values[f.key] = Math.round(v * 1000) / 1000;
        break;
      }
    }
  }
  if (target === 'task' && typeof values['plannedStart'] === 'string' && typeof values['plannedFinish'] === 'string' && values['plannedFinish'] < values['plannedStart']) {
    errors.push(serverMessage('imports.row.date_order', {}));
  }
  if (target === 'source_claims') {
    const hasType = values['targetType'] !== null && values['targetType'] !== undefined;
    const hasCode = values['targetCode'] !== null && values['targetCode'] !== undefined;
    const hasField = values['field'] !== null && values['field'] !== undefined;
    if ((hasType || hasCode || hasField) && !(hasType && (hasCode || values['targetType'] === 'project') && hasField)) errors.push(serverMessage('imports.row.target_incomplete', {}));
  }
  return { values, errors, warnings, formulaFields };
}

/** Whether every mapped cell of a row is empty (blank rows are dropped, not reported). */
export function rowIsBlank(cells: Record<string, ImportCell | undefined>): boolean {
  return Object.values(cells).every((c) => !c || (c.f === undefined && !c.e && cellText(c) === ''));
}

/** Field-by-field differences between a current record and an incoming row (only fields present in the row). */
export function diffFields(current: Record<string, ImportValue>, incoming: Record<string, ImportValue>, fields: readonly string[]): { field: string; from: ImportValue; to: ImportValue }[] {
  const out: { field: string; from: ImportValue; to: ImportValue }[] = [];
  for (const f of fields) {
    const to = incoming[f];
    if (to === null || to === undefined) continue;
    const from = current[f] ?? null;
    const a = from === null ? '' : String(from).trim();
    const b = String(to).trim();
    if (a !== b) out.push({ field: f, from, to });
  }
  return out;
}

/** Fields of a target compared with an existing record (the "update" columns of a matching row). */
export const IMPORT_COMPARED_FIELDS: Record<'risk' | 'task' | 'decision', readonly string[]> = {
  risk: ['title', 'description', 'probability', 'impact', 'dueDate', 'responseStrategy'],
  task: ['title', 'plannedStart', 'plannedFinish', 'durationDays', 'description'],
  decision: ['title'],
};

/**
 * Why a matching record is governed (REQ-INT-015, C-43) — an import never changes it; the difference becomes a change
 * request. Null when the record is not governed (the difference becomes a proposed claim only).
 */
export function governedReason(target: 'risk' | 'task' | 'decision', r: { status?: string | null; inApprovedBaseline?: boolean }): string | null {
  if (target === 'decision') return 'committee_decision';
  if (target === 'task' && r.inApprovedBaseline) return 'approved_baseline';
  return null;
}

/** Item-by-item acceptance (REQ-SRC-009): accepted rows must be applicable rows of the batch; every number at most once. */
export function assertAcceptedRows(accepted: readonly number[], applicable: ReadonlySet<number>) {
  if (new Set(accepted).size !== accepted.length) throw ruleViolation('imports.accept.duplicate_row', 'A row is listed twice');
  const bad = accepted.filter((n) => !applicable.has(n));
  if (bad.length) throw ruleViolation('imports.accept.not_applicable', `Row(s) ${bad.slice(0, 10).join(', ')} cannot be accepted (errors, skipped or unknown rows)`, { rows: bad.slice(0, 50) });
  if (accepted.length === 0) throw ruleViolation('imports.accept.none', 'Accept at least one row, or reject the batch');
}

/** The approver binds to the exact preview the uploader submitted (a re-validation that differs → 409). */
export function assertPreviewUnchanged(submittedHash: string | null, currentHash: string) {
  if (!submittedHash || submittedHash !== currentHash) {
    throw conflict('imports.preview_stale', 'The records changed since this batch was submitted — the uploader must validate it again before approval');
  }
}

// ---------------------------------------------------------------------------------------------------------
// English templates of the row / file messages (the web translates `imports.messages.<code>`)

export const IMPORT_MESSAGES_EN: Readonly<Record<string, string>> = {
  'imports.row.required': '{field} is required',
  'imports.row.too_long': '{field} is longer than {max} characters',
  'imports.row.bad_code': '{field} is not a valid code',
  'imports.row.not_scale5': '{field} must be a whole number from {min} to {max}',
  'imports.row.not_integer': '{field} must be a whole number from {min} to {max}',
  'imports.row.bad_date': '{field} is not a date (YYYY-MM-DD, DD/MM/YYYY or a spreadsheet date)',
  'imports.row.bad_enum': '{field} has an unsupported value',
  'imports.row.bad_confidence': '{field} must be between 0 and 1 (or 0–100%)',
  'imports.row.date_order': 'Planned finish is before planned start',
  'imports.row.target_incomplete': 'A claim about a record needs the record type, its code and the field',
  'imports.row.harmful_formula': '{field} holds a blocked formula ({function}); formulas are never evaluated',
  'imports.row.formula_cached_value': '{field} is a formula cell: its cached value is kept as untrusted text; the formula is never evaluated',
  'imports.row.formula_like_text': '{field} starts like a formula; it is kept as text and never evaluated',
  'imports.row.cell_error': '{field} holds a spreadsheet error value',
  'imports.row.internal_url': '{field} refers to an internal address ({host}); refused, and links are never opened',
  'imports.row.url_inert': '{field} contains a link; it is stored as inert text and never opened',
  'imports.row.duplicate_in_batch': 'Same {key} as row {row} of this file',
  'imports.row.unchanged': 'Already recorded as {code}; nothing to change',
  'imports.row.possible_duplicate': 'Possible duplicate of {code} (same title); not imported',
  'imports.row.create_risk': 'New risk; created in the RAID register when the import is approved',
  'imports.row.create_task': 'New task; created as a Draft, proposed task when the import is approved',
  'imports.row.update_proposed': '{code} differs ({fields}); becomes a proposed change for review, never an update',
  'imports.row.governed_change_request': '{code} is governed ({reason}); a change request is proposed and the record is not changed',
  'imports.row.decision_unknown': 'No decision {code} in this project; decisions are raised through the committee workflow, not by import',
  'imports.row.workstream_unknown': 'Workstream {code} was not found',
  'imports.row.workstream_required': 'A new task needs a workstream',
  'imports.row.target_unknown': '{type} {code} was not found',
  'imports.row.reported_status_claim': 'Reported status "{value}" is kept as a historical, unverified claim; it never changes the current status',
  'imports.row.claim': 'Becomes a claim in the source register for review; no record is changed',
  'imports.row.document_claim': 'Extracted text becomes an unverified claim for review; it never fills an official field',
  'imports.file.formula_cells': '{count} formula cell(s): cached values only, never evaluated',
  'imports.file.harmful_formulas': '{count} cell(s) hold blocked formulas',
  'imports.file.external_links': '{count} external workbook link(s) kept inert and never followed',
  'imports.file.data_connections': 'Data connections are ignored and never refreshed',
  'imports.file.hyperlinks': '{count} hyperlink(s) kept inert and never opened',
  'imports.file.extraction_not_configured': 'No OCR or PDF text extractor is configured; nothing was extracted. Review the file and record claims by hand.',
  'imports.file.paragraphs': '{count} paragraph(s) extracted from the document',
  'imports.file.truncated_paragraphs': 'Only the first {count} paragraphs were extracted',
};
