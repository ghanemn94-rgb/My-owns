import { describe, it, expect } from 'vitest';
import {
  sanitizeFilename,
  detectFileType,
  detectDangerousSignature,
  EICAR_SIGNATURE,
  chunkText,
  assertConflictMarkable,
  verifiedStatusAfterAccept,
  assertClaimReview,
  claimApplicability,
  assertClaimTargetField,
  assertDisposable,
  disposalAuthority,
  MAX_FILENAME_LENGTH,
  EVIDENCE_TARGET_TYPES,
  EVIDENCE_TARGET_PERMISSION,
  EVIDENCE_TARGET_READ_PERMISSION,
} from './documents';
import { POLICY_MATRIX } from './policy';

const bytes = (s: string) => new TextEncoder().encode(s);

describe('sanitizeFilename (C-14, AT-25) [REQ-SEC]', () => {
  it('strips path traversal and keeps only the last segment', () => {
    expect(sanitizeFilename('../../etc/passwd.txt')).toBe('passwd.txt');
    expect(sanitizeFilename('..\\..\\windows\\system32\\x.txt')).toBe('x.txt');
    expect(sanitizeFilename('..')).toBe('file');
    expect(sanitizeFilename('')).toBe('file');
  });
  it('strips bidi, zero-width and control characters and reserved characters', () => {
    expect(sanitizeFilename('invoice‮txt.exe')).toBe('invoicetxt.exe');
    expect(sanitizeFilename('a​b\u0000c.md')).toBe('abc.md');
    expect(sanitizeFilename('a<b>:c?.csv')).toBe('a_b__c_.csv');
  });
  it('normalises to NFC and caps the length while keeping the extension', () => {
    expect(sanitizeFilename('é.txt')).toBe('é.txt');
    const long = sanitizeFilename(`${'x'.repeat(400)}.pdf`);
    expect(long.length).toBe(MAX_FILENAME_LENGTH);
    expect(long.endsWith('.pdf')).toBe(true);
  });
});

describe('detectFileType — magic bytes + extension allowlist (AT-25)', () => {
  it('accepts known signatures with a matching extension', () => {
    expect(detectFileType(bytes('%PDF-1.7\n...'), 'a.pdf')).toMatchObject({ ok: true, type: 'pdf' });
    expect(detectFileType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]), 'a.png')).toMatchObject({ ok: true, type: 'png' });
    expect(detectFileType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]), 'a.JPG')).toMatchObject({ ok: true, type: 'jpeg' });
    expect(detectFileType(bytes('a,b\n1,2\n'), 'x.csv')).toMatchObject({ ok: true, type: 'csv', mime: 'text/csv' });
    expect(detectFileType(bytes('# Title\ntext'), 'x.md')).toMatchObject({ ok: true, type: 'md' });
  });
  it('rejects a mismatch between content and extension', () => {
    expect(detectFileType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'a.pdf')).toMatchObject({ ok: false, code: 'extension_mismatch' });
    expect(detectFileType(bytes('plain text'), 'a.docx')).toMatchObject({ ok: false, code: 'extension_mismatch' });
  });
  it('rejects types outside the allowlist, bare ZIPs and macro-enabled OOXML', () => {
    expect(detectFileType(bytes('GIF89a\u0000\u0000'), 'a.gif')).toMatchObject({ ok: false, code: 'type_not_allowed' });
    const zip = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0]);
    expect(detectFileType(zip, 'a.zip', ['readme.txt'])).toMatchObject({ ok: false, code: 'type_not_allowed' });
    expect(detectFileType(zip, 'a.docx', ['[Content_Types].xml', 'word/document.xml'])).toMatchObject({ ok: true, type: 'docx' });
    expect(detectFileType(zip, 'a.docx', ['[Content_Types].xml', 'word/document.xml', 'word/vbaProject.bin'])).toMatchObject({ ok: false, code: 'macro_enabled' });
    expect(detectFileType(new Uint8Array(0), 'a.txt')).toMatchObject({ ok: false, code: 'empty' });
  });
});

describe('detectDangerousSignature — built-in minimal checks (not an AV engine)', () => {
  it('flags the EICAR test signature anywhere in the file', () => {
    expect(detectDangerousSignature(bytes(EICAR_SIGNATURE))?.kind).toBe('eicar_test_signature');
    expect(detectDangerousSignature(bytes(`notes\n${EICAR_SIGNATURE}\n`))?.kind).toBe('eicar_test_signature');
  });
  it('flags executables and scripts, and passes ordinary text', () => {
    expect(detectDangerousSignature(bytes('MZ\u0090\u0000'))?.kind).toBe('executable');
    expect(detectDangerousSignature(Uint8Array.from([0x7f, 0x45, 0x4c, 0x46, 2]))?.kind).toBe('executable');
    expect(detectDangerousSignature(bytes('#!/bin/sh\nrm -rf /'))?.kind).toBe('script');
    expect(detectDangerousSignature(bytes('  <svg onload="x()"></svg>'))?.kind).toBe('script');
    expect(detectDangerousSignature(bytes('Meeting notes: nothing unusual.'))).toBeNull();
  });
});

describe('chunkText — retrieval index chunks (spec §12.1)', () => {
  it('uses markdown headings as sections and keeps ordinals sequential', () => {
    const c = chunkText('# Intro\nHello\n\n## Scope\nLine one\n\nLine two', 'md');
    expect(c.map((x) => x.section)).toEqual(['Intro', 'Scope']);
    expect(c.map((x) => x.ordinal)).toEqual([1, 2]);
    expect(c[1]!.text).toContain('Line two');
  });
  it('never exceeds the chunk size and repeats the CSV header', () => {
    const csv = ['id,name', ...Array.from({ length: 100 }, (_, i) => `${i},row ${i}`)].join('\n');
    const c = chunkText(csv, 'csv', 200);
    expect(c.length).toBeGreaterThan(3);
    for (const x of c) {
      expect(x.text.length).toBeLessThanOrEqual(200);
      expect(x.text.startsWith('id,name')).toBe(true);
    }
    const t = chunkText('x'.repeat(2500), 'txt', 1000);
    expect(t.map((x) => x.text.length)).toEqual([1000, 1000, 500]);
  });
});

describe('Evidence conflicts (AT-14) [REQ-SRC]', () => {
  const l = (id: string, over: Partial<{ targetId: string; status: 'active' | 'superseded' | 'conflicting' | 'rejected' }> = {}) => ({ id, targetType: 'task', targetId: over.targetId ?? 't1', status: over.status ?? 'active' });
  it('requires the same target and relied-upon links', () => {
    expect(() => assertConflictMarkable(l('a'), l('b'))).not.toThrow();
    expect(() => assertConflictMarkable(l('a'), l('a'))).toThrow(/itself/);
    expect(() => assertConflictMarkable(l('a'), l('b', { targetId: 't2' }))).toThrow(/same record/);
    expect(() => assertConflictMarkable(l('a'), l('b', { status: 'superseded' }))).toThrow(/no longer relied/);
  });
  it('re-verification of a conflicting link needs the counterpart resolved first', () => {
    expect(verifiedStatusAfterAccept('active', null)).toBe('active');
    expect(() => verifiedStatusAfterAccept('conflicting', 'conflicting')).toThrow(/Resolve the conflict/);
    expect(verifiedStatusAfterAccept('conflicting', 'superseded')).toBe('active');
    expect(() => verifiedStatusAfterAccept('rejected', null)).toThrow();
  });
});

describe('Evidence target read permissions (SEC-P1R-04) [REQ-SEC]', () => {
  it('every evidence target type has a known READ permission, distinct from the link (manage) permission', () => {
    for (const t of EVIDENCE_TARGET_TYPES) {
      const read = EVIDENCE_TARGET_READ_PERMISSION[t];
      expect(read, t).toMatch(/\.read$/);
      expect(POLICY_MATRIX.permissions[read], `${t} -> ${read}`).toBeDefined();
      expect(read).not.toBe(EVIDENCE_TARGET_PERMISSION[t]);
    }
  });
  it('JV closing records need jv.deal.read, which a contributor does not hold', () => {
    expect(EVIDENCE_TARGET_READ_PERMISSION.closing_condition).toBe('jv.deal.read');
    expect(POLICY_MATRIX.roles.contributor.permissions).not.toContain('jv.deal.read');
    expect(POLICY_MATRIX.roles.contributor.permissions).toContain('documents.document.read');
  });
});

const review = {
  verificationSourceId: null as string | null,
  claimSourceId: 'src-image',
  reviewerUserId: 'verifier',
  extractorUserId: 'extractor',
  previousReviewerUserId: null as string | null,
};

describe('Source claims (AT-01) [REQ-SRC]', () => {
  it('AT-01 invariant (DOM-P2-04): a historical claim never reaches "confirmed" by status hopping — whatever the path', () => {
    // Every intermediate status a reviewer could move a historical claim to first: confirming from there is still refused
    // without verification evidence, because the ORIGIN (historical_unverified) is kept.
    for (const current of ['historical_unverified', 'proposed', 'assumed', 'unknown', 'conflicting'] as const) {
      expect(() => assertClaimReview({ ...review, current, origin: 'historical_unverified', next: 'confirmed', confirmedValue: 'done' }), current).toThrow(
        expect.objectContaining({ code: 'claims.historical_cannot_be_confirmed' }),
      );
    }
    // Moving it to another non-confirmed status is allowed (reclassification is not a current value).
    expect(() => assertClaimReview({ ...review, current: 'historical_unverified', origin: 'historical_unverified', next: 'proposed', confirmedValue: null })).not.toThrow();
  });
  it('AT-01 (DOM-P2-04): a historical claim is confirmed only with a DIFFERENT verifying source, by a verifier who is neither the extractor nor the previous reviewer', () => {
    const h = { ...review, current: 'proposed' as const, origin: 'historical_unverified' as const, next: 'confirmed' as const, confirmedValue: 'done' };
    expect(() => assertClaimReview({ ...h, verificationSourceId: 'src-image' })).toThrow(expect.objectContaining({ code: 'claims.verification_source_same' }));
    expect(() => assertClaimReview({ ...h, verificationSourceId: 'src-minutes', reviewerUserId: 'extractor' })).toThrow(expect.objectContaining({ code: 'claims.verifier_is_extractor', kind: 'forbidden' }));
    expect(() => assertClaimReview({ ...h, verificationSourceId: 'src-minutes', previousReviewerUserId: 'verifier' })).toThrow(
      expect.objectContaining({ code: 'claims.verifier_is_previous_reviewer', kind: 'forbidden' }),
    );
    expect(() => assertClaimReview({ ...h, verificationSourceId: 'src-minutes', previousReviewerUserId: 'someone-else' })).not.toThrow();
    // Direct confirmation of a still-historical claim follows the same rule.
    expect(() => assertClaimReview({ ...h, current: 'historical_unverified', verificationSourceId: 'src-minutes' })).not.toThrow();
    // Non-historical claims keep the ordinary rule (not_self against the extractor is the policy's job).
    expect(() => assertClaimReview({ ...review, current: 'proposed', origin: 'proposed', next: 'confirmed', confirmedValue: '2027-01-31' })).not.toThrow();
  });
  it('AT-01 (DOM-P2-04): a confirmed claim of historical origin is applicable only with its verifying source recorded', () => {
    const base = { targetType: 'task', field: 'status', appliedToRecord: false, hasPendingProposal: false, verificationStatus: 'confirmed' as const, originStatus: 'historical_unverified' as const };
    expect(claimApplicability({ ...base, verificationSourceId: null })).toMatchObject({ applicable: false, code: 'claims.historical_not_applicable' });
    expect(claimApplicability({ ...base, verificationSourceId: 'src-minutes' }).applicable).toBe(true);
  });
  it('historical-unverified claims are never applicable and cannot be confirmed', () => {
    expect(claimApplicability({ verificationStatus: 'historical_unverified', originStatus: 'historical_unverified', verificationSourceId: null, targetType: 'task', field: 'status', appliedToRecord: false, hasPendingProposal: false })).toMatchObject({ applicable: false, code: 'claims.historical_not_applicable' });
    expect(() => assertClaimReview({ ...review, current: 'historical_unverified', origin: 'historical_unverified', next: 'confirmed', confirmedValue: 'Completed' })).toThrow(/historical/);
    expect(() => assertClaimReview({ ...review, current: 'historical_unverified', origin: 'historical_unverified', next: 'conflicting', confirmedValue: null })).not.toThrow();
  });
  it('only confirmed, mapped, not-yet-proposed claims are applicable', () => {
    const base = { targetType: 'task', field: 'status', appliedToRecord: false, hasPendingProposal: false, originStatus: 'proposed' as const, verificationSourceId: null };
    expect(claimApplicability({ ...base, verificationStatus: 'proposed' }).applicable).toBe(false);
    expect(claimApplicability({ ...base, verificationStatus: 'confirmed' }).applicable).toBe(true);
    expect(claimApplicability({ ...base, verificationStatus: 'confirmed', hasPendingProposal: true }).code).toBe('claims.proposal_pending');
    expect(claimApplicability({ ...base, verificationStatus: 'confirmed', targetType: null }).code).toBe('claims.no_target');
    expect(() => assertClaimReview({ ...review, current: 'proposed', origin: 'proposed', next: 'confirmed', confirmedValue: '' })).toThrow(/confirmed value/);
  });
  it('claim targets are limited to an allowlist of fields', () => {
    expect(() => assertClaimTargetField('task', 'status')).not.toThrow();
    expect(() => assertClaimTargetField(null, null)).not.toThrow();
    expect(() => assertClaimTargetField('task', 'accountableUserId')).toThrow(/cannot be compared/);
    expect(() => assertClaimTargetField('decision', 'status')).toThrow(/cannot target/);
    expect(() => assertClaimTargetField('task', null)).toThrow(/both/);
  });
});

describe('Retention / legal hold / disposal (AT-27)', () => {
  it('refuses disposal under legal hold or before retention expiry', () => {
    expect(() => assertDisposable({ legalHold: true, retentionUntil: null, deletedAt: null }, '2026-09-29')).toThrow(/legal hold/);
    expect(() => assertDisposable({ legalHold: false, retentionUntil: '2026-12-31', deletedAt: null }, '2026-09-29')).toThrow(/retained until/);
    expect(() => assertDisposable({ legalHold: false, retentionUntil: '2026-09-29', deletedAt: null }, '2026-09-29')).not.toThrow();
    expect(() => assertDisposable({ legalHold: false, retentionUntil: null, deletedAt: new Date() }, '2026-09-29')).toThrow(/already/);
  });
  it('authority: approved matrix, or demo policy only in demo mode on demo projects', () => {
    expect(disposalAuthority({ matrix: null, today: '2026-09-29', projectIsDemo: false, demoMode: true }).within).toBe(false);
    expect(disposalAuthority({ matrix: null, today: '2026-09-29', projectIsDemo: true, demoMode: false }).within).toBe(false);
    expect(disposalAuthority({ matrix: null, today: '2026-09-29', projectIsDemo: true, demoMode: true })).toMatchObject({ within: true });
    const approved = { status: 'approved' as const, isDemoPolicy: false, effectiveFrom: '2026-01-01', effectiveTo: null };
    expect(disposalAuthority({ matrix: approved, today: '2026-09-29', projectIsDemo: false, demoMode: false }).within).toBe(true);
    expect(disposalAuthority({ matrix: { ...approved, status: 'draft' }, today: '2026-09-29', projectIsDemo: false, demoMode: false }).within).toBe(false);
  });
});
