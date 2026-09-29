/**
 * Documents, evidence and source-register rules (spec §2, §5, §12.1, §14, §15, §17). Pure functions — no I/O.
 *
 *  - File safety: filename sanitisation (C-14), magic-byte type allowlist, dangerous-signature detection (AT-25).
 *  - Indexing: text chunking for the retrieval index (spec §12.1).
 *  - Source claims: review transitions and "apply" eligibility — historical statuses are never applied (AT-01).
 *  - Evidence: conflict marking (AT-14).
 *  - Retention / legal hold / disposal (AT-27).
 */
import { ruleViolation } from './errors';
import type { VerificationStatus } from './enums';
import { matrixUsable, type MatrixState } from './governance';

// ---------------------------------------------------------------------------------------------------------
// Filenames (C-14): NFC, strip bidi / zero-width / control characters, strip any path, cap length. The result is
// display metadata only — storage keys are always server-generated UUIDs and never derived from a filename.

export const MAX_FILENAME_LENGTH = 180;

// Bidi controls (U+202A–U+202E, U+2066–U+2069, U+200E/U+200F, U+061C), zero-width (U+200B–U+200D, U+FEFF, U+2060),
// C0/C1 controls and DEL.
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩؜﻿]/g;
const RESERVED_CHARS = /[<>:"/\\|?*]/g;

export function sanitizeFilename(input: string): string {
  let s = (input ?? '').normalize('NFC').replace(UNSAFE_CHARS, '');
  // Keep only the last path segment (both separators), which removes "../" traversal sequences.
  const parts = s.split(/[\\/]/);
  s = parts[parts.length - 1] ?? '';
  s = s.replace(RESERVED_CHARS, '_').trim();
  // No leading dots (hidden files, "..") and no trailing dots/spaces (Windows).
  s = s.replace(/^\.+/, '').replace(/[. ]+$/, '');
  if (s.length > MAX_FILENAME_LENGTH) {
    const dot = s.lastIndexOf('.');
    const ext = dot > 0 && s.length - dot <= 10 ? s.slice(dot) : '';
    s = s.slice(0, MAX_FILENAME_LENGTH - ext.length) + ext;
  }
  return s.length > 0 ? s : 'file';
}

export function fileExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

// ---------------------------------------------------------------------------------------------------------
// File type allowlist (magic bytes + extension agreement). The declared (browser) MIME type is never trusted.

export const ALLOWED_FILE_TYPES = ['pdf', 'docx', 'xlsx', 'pptx', 'png', 'jpeg', 'csv', 'txt', 'md'] as const;
export type AllowedFileType = (typeof ALLOWED_FILE_TYPES)[number];

export const FILE_TYPE_INFO: Record<AllowedFileType, { mime: string; extensions: string[]; text: boolean }> = {
  pdf: { mime: 'application/pdf', extensions: ['pdf'], text: false },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', extensions: ['docx'], text: false },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extensions: ['xlsx'], text: false },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', extensions: ['pptx'], text: false },
  png: { mime: 'image/png', extensions: ['png'], text: false },
  jpeg: { mime: 'image/jpeg', extensions: ['jpg', 'jpeg'], text: false },
  csv: { mime: 'text/csv', extensions: ['csv'], text: true },
  txt: { mime: 'text/plain', extensions: ['txt'], text: true },
  md: { mime: 'text/markdown', extensions: ['md', 'markdown'], text: true },
};

/** Types whose text this build can extract for the retrieval index. PDF/images/xlsx/pptx: extraction not performed. */
export const TEXT_EXTRACTABLE_TYPES: readonly AllowedFileType[] = ['txt', 'md', 'csv', 'docx'];

export type TypeDetection =
  | { ok: true; type: AllowedFileType; mime: string }
  | { ok: false; code: 'type_not_allowed' | 'extension_mismatch' | 'macro_enabled' | 'empty'; reason: string };

const startsWith = (b: Uint8Array, sig: number[], offset = 0) => b.length >= offset + sig.length && sig.every((v, i) => b[offset + i] === v);

/**
 * Detect the file type from its bytes. `zipEntries` must be supplied for ZIP containers (OOXML) — the caller lists
 * the central directory. Text types (txt/md/csv) have no signature: they must be strict UTF-8 without NUL bytes and
 * the extension selects the subtype.
 */
export function detectFileType(bytes: Uint8Array, filename: string, zipEntries?: string[] | null): TypeDetection {
  if (bytes.length === 0) return { ok: false, code: 'empty', reason: 'The file is empty' };
  const ext = fileExtension(filename);
  let type: AllowedFileType | null = null;
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) type = 'pdf';
  else if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) type = 'png';
  else if (startsWith(bytes, [0xff, 0xd8, 0xff])) type = 'jpeg';
  else if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    const entries = zipEntries ?? [];
    if (entries.some((e) => /vbaProject\.bin$/i.test(e) || /vbaData\.xml$/i.test(e))) {
      return { ok: false, code: 'macro_enabled', reason: 'Macro-enabled Office files are not accepted' };
    }
    if (!entries.includes('[Content_Types].xml')) return { ok: false, code: 'type_not_allowed', reason: 'ZIP archives are not accepted (only Office Open XML documents)' };
    if (entries.includes('word/document.xml')) type = 'docx';
    else if (entries.includes('xl/workbook.xml')) type = 'xlsx';
    else if (entries.includes('ppt/presentation.xml')) type = 'pptx';
    else return { ok: false, code: 'type_not_allowed', reason: 'Unrecognised Office Open XML package' };
  } else if (looksLikeUtf8Text(bytes)) {
    type = ext === 'csv' ? 'csv' : ext === 'md' || ext === 'markdown' ? 'md' : ext === 'txt' ? 'txt' : null;
    if (!type) return { ok: false, code: 'extension_mismatch', reason: `Text content is accepted only as .txt, .md or .csv (got ".${ext || '(none)'}")` };
  } else {
    return { ok: false, code: 'type_not_allowed', reason: 'File type is not on the allowlist (pdf, docx, xlsx, pptx, png, jpeg, csv, txt, md)' };
  }
  if (!FILE_TYPE_INFO[type].extensions.includes(ext)) {
    return { ok: false, code: 'extension_mismatch', reason: `File content is ${type} but the name ends with ".${ext || '(none)'}"` };
  }
  return { ok: true, type, mime: FILE_TYPE_INFO[type].mime };
}

/** Strict UTF-8 without NUL bytes and with few control characters. */
export function looksLikeUtf8Text(bytes: Uint8Array): boolean {
  let controls = 0;
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i]!;
    if (c === 0) return false;
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d && c !== 0x0c) controls++;
  }
  if (controls > Math.max(8, bytes.length / 1000)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------------
// Built-in minimal signature check (NOT an anti-malware engine). Detects the EICAR test file and executable /
// script signatures so they are quarantined. Files that pass are "not_scanned", never "clean".

export const EICAR_SIGNATURE = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

export interface DangerousSignature {
  kind: 'eicar_test_signature' | 'executable' | 'script';
  detail: string;
}

export function detectDangerousSignature(bytes: Uint8Array): DangerousSignature | null {
  const head = latin1(bytes.subarray(0, Math.min(bytes.length, 64 * 1024)));
  if (indexOfBytes(bytes, EICAR_BYTES) >= 0) {
    return { kind: 'eicar_test_signature', detail: 'EICAR anti-malware test signature detected' };
  }
  if (startsWith(bytes, [0x4d, 0x5a])) return { kind: 'executable', detail: 'Windows executable (MZ/PE) signature' };
  if (startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46])) return { kind: 'executable', detail: 'ELF executable signature' };
  if (startsWith(bytes, [0xfe, 0xed, 0xfa, 0xce]) || startsWith(bytes, [0xfe, 0xed, 0xfa, 0xcf]) || startsWith(bytes, [0xcf, 0xfa, 0xed, 0xfe]) || startsWith(bytes, [0xce, 0xfa, 0xed, 0xfe])) {
    return { kind: 'executable', detail: 'Mach-O executable signature' };
  }
  if (startsWith(bytes, [0xca, 0xfe, 0xba, 0xbe])) return { kind: 'executable', detail: 'Java class / Mach-O universal binary signature' };
  if (startsWith(bytes, [0x00, 0x61, 0x73, 0x6d])) return { kind: 'executable', detail: 'WebAssembly module signature' };
  const lead = head.replace(/^﻿|^\xef\xbb\xbf/, '').trimStart().slice(0, 64).toLowerCase();
  if (lead.startsWith('#!')) return { kind: 'script', detail: 'Script interpreter line (#!)' };
  if (/^<\?php|^<script|^<!doctype html|^<html|^<svg|^<\?xml[^>]*>\s*<svg/.test(lead)) return { kind: 'script', detail: 'Active web content (HTML/SVG/script/PHP) presented as a document' };
  return null;
}

const EICAR_BYTES = Uint8Array.from(EICAR_SIGNATURE, (c) => c.charCodeAt(0));

function indexOfBytes(hay: Uint8Array, needle: Uint8Array): number {
  const first = needle[0]!;
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    if (hay[i] !== first) continue;
    for (let j = 1; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

function latin1(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return s;
}

// ---------------------------------------------------------------------------------------------------------
// Chunking for the retrieval index (spec §12.1). Markdown headings become the chunk section; CSV is chunked by
// row groups with the header repeated; plain text by paragraphs. Chunks never exceed `maxChars`.

export interface TextChunk {
  ordinal: number;
  section: string | null;
  page: number | null;
  text: string;
}

export function chunkText(text: string, kind: 'txt' | 'md' | 'csv' | 'docx', maxChars = 1200): TextChunk[] {
  const clean = text.replace(/\r\n?/g, '\n').replace(/\u0000/g, '');
  const out: TextChunk[] = [];
  const push = (section: string | null, body: string) => {
    const t = body.trim();
    if (!t) return;
    for (let i = 0; i < t.length; i += maxChars) out.push({ ordinal: out.length + 1, section, page: null, text: t.slice(i, i + maxChars) });
  };
  if (kind === 'csv') {
    const lines = clean.split('\n').filter((l) => l.trim().length > 0);
    const header = lines.shift() ?? '';
    let buf: string[] = [];
    let len = header.length;
    for (const l of lines) {
      if (buf.length > 0 && len + l.length + 1 > maxChars) {
        push('rows', [header, ...buf].join('\n'));
        buf = [];
        len = header.length;
      }
      buf.push(l);
      len += l.length + 1;
    }
    if (buf.length > 0 || lines.length === 0) push('rows', [header, ...buf].join('\n'));
    return out;
  }
  let section: string | null = null;
  let buf = '';
  const flush = () => {
    push(section, buf);
    buf = '';
  };
  for (const para of clean.split(/\n{2,}/)) {
    const heading = kind === 'md' ? /^(#{1,6})\s+(.+)$/m.exec(para.split('\n')[0] ?? '') : null;
    if (heading) {
      flush();
      section = heading[2]!.trim().slice(0, 200);
      const rest = para.split('\n').slice(1).join('\n');
      if (rest.trim()) buf = rest;
      continue;
    }
    if (buf.length > 0 && buf.length + para.length + 2 > maxChars) flush();
    buf = buf ? `${buf}\n\n${para}` : para;
  }
  flush();
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Evidence targets (module guide §2 "Cross-module contracts").

export const EVIDENCE_TARGET_TYPES = [
  'gate_criterion',
  'closing_condition',
  'perimeter_item',
  'transfer',
  'readiness_check',
  'tsa_service',
  'decision',
  'action_item',
  'task',
  'deliverable',
  'milestone',
  'legal_entity',
  'regulatory_requirement',
  'agreement',
  'benefit',
  'financial_snapshot',
  'post_close_obligation',
  'closing_deliverable',
] as const;
export type EvidenceTargetType = (typeof EVIDENCE_TARGET_TYPES)[number];

/** Linking evidence also requires the permission that lets the caller work on the target record. */
export const EVIDENCE_TARGET_PERMISSION: Record<EvidenceTargetType, string> = {
  gate_criterion: 'gates.evidence.attach',
  closing_condition: 'jv.cp.manage',
  perimeter_item: 'carveout.perimeter.manage',
  transfer: 'carveout.transfer.manage',
  readiness_check: 'readiness.check.manage',
  tsa_service: 'readiness.tsa.manage',
  decision: 'governance.decision.draft',
  action_item: 'governance.action.update',
  task: 'planning.task.update_progress',
  deliverable: 'planning.task.update_progress',
  milestone: 'planning.task.update_progress',
  legal_entity: 'newco.incorporation.manage',
  regulatory_requirement: 'newco.regulatory.manage',
  agreement: 'carveout.agreement.manage',
  benefit: 'finance.benefit.manage',
  financial_snapshot: 'finance.budget.manage',
  post_close_obligation: 'jv.closing_checklist.manage',
  closing_deliverable: 'jv.closing_checklist.manage',
};

export type EvidenceLinkStatus = 'active' | 'superseded' | 'conflicting' | 'rejected';

/**
 * AT-14: a new link that contradicts evidence previously relied upon flags BOTH links as conflicting. Neither is
 * deleted; the earlier review (reviewer/time) is preserved; derived records must be reassessed.
 */
export function assertConflictMarkable(a: { id: string; targetType: string; targetId: string; status: EvidenceLinkStatus }, b: { id: string; targetType: string; targetId: string; status: EvidenceLinkStatus }) {
  if (a.id === b.id) throw ruleViolation('evidence.conflict_with_self', 'A link cannot conflict with itself');
  if (a.targetType !== b.targetType || a.targetId !== b.targetId) {
    throw ruleViolation('evidence.conflict_different_target', 'Conflicting evidence must relate to the same record');
  }
  for (const l of [a, b]) {
    if (l.status === 'superseded' || l.status === 'rejected') {
      throw ruleViolation('evidence.conflict_inactive_link', `Evidence link ${l.id} is ${l.status} and is no longer relied upon`);
    }
  }
}

/** Accepting a conflicting link is allowed only after its counterpart was superseded or rejected. */
export function verifiedStatusAfterAccept(current: EvidenceLinkStatus, counterpartStatus: EvidenceLinkStatus | null): EvidenceLinkStatus {
  if (current === 'superseded' || current === 'rejected') throw ruleViolation('evidence.not_active', `Evidence link is ${current}`);
  if (current !== 'conflicting') return current;
  if (counterpartStatus === 'superseded' || counterpartStatus === 'rejected' || counterpartStatus === null) return 'active';
  throw ruleViolation('evidence.conflict_unresolved', 'Resolve the conflict first: supersede or reject the conflicting evidence, then re-verify');
}

// ---------------------------------------------------------------------------------------------------------
// Source claims (spec §2, AT-01).

/** Statuses a new claim may enter with — extraction never yields "confirmed". */
export const CLAIM_INITIAL_STATUSES = ['unknown', 'proposed', 'historical_unverified', 'assumed'] as const;

/** Record fields a claim can be compared against (allowlist — values are read, never written, by this module). */
export const CLAIM_TARGET_FIELDS = {
  project: ['status', 'name', 'plannedStart'],
  workstream: ['name', 'objective'],
  task: ['status', 'plannedStart', 'plannedFinish', 'actualFinish', 'reportedProgress'],
  milestone: ['status', 'plannedDate', 'actualDate'],
  deliverable: ['status', 'dueDate'],
} as const;
export type ClaimTargetType = keyof typeof CLAIM_TARGET_FIELDS;
export const CLAIM_TARGET_TYPES = Object.keys(CLAIM_TARGET_FIELDS) as ClaimTargetType[];

/** Permission the owning module requires to execute a proposed change to the target record. */
export const CLAIM_TARGET_PERMISSION: Record<ClaimTargetType, string> = {
  project: 'portfolio.project.update',
  workstream: 'planning.wbs.manage',
  task: 'planning.task.manage',
  milestone: 'planning.task.manage',
  deliverable: 'planning.task.manage',
};

export function assertClaimTargetField(targetType: string | null | undefined, field: string | null | undefined) {
  if (!targetType && !field) return;
  if (!targetType || !field) throw ruleViolation('claims.target_incomplete', 'A claim target needs both a record type and a field');
  const fields = (CLAIM_TARGET_FIELDS as Record<string, readonly string[]>)[targetType];
  if (!fields) throw ruleViolation('claims.target_type_unsupported', `Claims cannot target "${targetType}"`);
  if (!fields.includes(field)) throw ruleViolation('claims.field_unsupported', `Field "${field}" of ${targetType} cannot be compared (allowed: ${fields.join(', ')})`);
}

/**
 * Review of a claim (not_self is enforced by the policy). Historical-unverified claims describe a past report; they
 * can never become the confirmed CURRENT value — a current value needs a new source (e.g. approved minutes).
 */
export function assertClaimReview(current: VerificationStatus, next: VerificationStatus, confirmedValue: string | null | undefined) {
  if (current === 'historical_unverified' && next === 'confirmed') {
    throw ruleViolation('claims.historical_cannot_be_confirmed', 'A historical-unverified claim cannot be confirmed as the current value — record the current value from a new, authoritative source');
  }
  if (next === 'confirmed' && !(confirmedValue && confirmedValue.trim())) {
    throw ruleViolation('claims.confirmed_value_required', 'Confirming a claim requires the confirmed value');
  }
}

export interface ClaimApplyCheck {
  applicable: boolean;
  code: string;
  reason: string;
}

/** Whether a claim may be turned into a proposed change (never an automatic update — AT-01). */
export function claimApplicability(c: { verificationStatus: VerificationStatus; targetType: string | null; field: string | null; appliedToRecord: boolean; hasPendingProposal: boolean }): ClaimApplyCheck {
  if (c.verificationStatus === 'historical_unverified') {
    return { applicable: false, code: 'claims.historical_not_applicable', reason: 'Historical-unverified values are kept as source-reported values only and are never applied as current status' };
  }
  if (c.verificationStatus !== 'confirmed') {
    return { applicable: false, code: 'claims.not_confirmed', reason: `Only confirmed claims can be proposed as changes (this claim is ${c.verificationStatus})` };
  }
  if (!c.targetType || !c.field) return { applicable: false, code: 'claims.no_target', reason: 'The claim is not mapped to a record field' };
  if (c.appliedToRecord) return { applicable: false, code: 'claims.already_applied', reason: 'The claim was already applied' };
  if (c.hasPendingProposal) return { applicable: false, code: 'claims.proposal_pending', reason: 'A proposed change for this claim is already pending review' };
  return { applicable: true, code: 'ok', reason: 'Confirmed claim — can be proposed as a change for review by the record owner' };
}

// ---------------------------------------------------------------------------------------------------------
// Retention, legal hold and disposal (AT-27, C-31).

export function assertDisposable(d: { legalHold: boolean; retentionUntil: string | null; deletedAt: Date | string | null }, today: string) {
  if (d.deletedAt) throw ruleViolation('documents.already_disposed', 'The document was already disposed');
  if (d.legalHold) throw ruleViolation('documents.legal_hold_active', 'The document is under legal hold — disposal is refused until the hold is released');
  if (d.retentionUntil && d.retentionUntil > today) {
    throw ruleViolation('documents.retention_active', `The document is retained until ${d.retentionUntil} — disposal is refused before retention expiry`);
  }
}

/**
 * The `authority` condition for disposal: an approved authority matrix in force for the project, or — only in demo
 * mode on a demo project — the synthetic Demo authority policy (outcomes are badged Demo). Otherwise deny.
 */
export function disposalAuthority(input: { matrix: MatrixState | null; today: string; projectIsDemo: boolean; demoMode: boolean }): { within: boolean; basis: string } {
  const m = matrixUsable(input.matrix, input.today, input.projectIsDemo);
  if (m.usable) return { within: true, basis: input.matrix?.isDemoPolicy ? 'Demo authority matrix (synthetic)' : 'Approved authority matrix in force' };
  if (input.demoMode && input.projectIsDemo) return { within: true, basis: 'Demo authority policy (synthetic, demo mode only) — not a real delegation' };
  return { within: false, basis: m.reason };
}
