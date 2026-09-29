import { describe, expect, it } from 'vitest';
import {
  APPLICABILITY_PENDING_LABEL,
  applicabilityLabel,
  assertApplicabilityAssessment,
  assertConditionsSatisfied,
  assertIncorporationRecord,
  assertIncorporationVerification,
  assertRequirementCommand,
  conditionsState,
  initialApplicability,
  validityState,
  verificationAfterRecord,
  type RequirementCommandInput,
} from './newco';
import { computeStatusDimensions, isCarveOutComplete } from './carveout';

const T0 = '2026-11-15';

describe('REQ-SET-010 — NewCo status requires evidence (default unconfirmed)', () => {
  it('UT: incorporated without evidence rejected; in progress also needs evidence; unconfirmed needs none', () => {
    expect(() => assertIncorporationRecord({ status: 'incorporated', activeEvidence: 0, conflictingEvidence: 0, note: null })).toThrow(/requires linked evidence/);
    expect(() => assertIncorporationRecord({ status: 'incorporation_in_progress', activeEvidence: 0, conflictingEvidence: 0, note: null })).toThrow(/evidence/);
    expect(() => assertIncorporationRecord({ status: 'incorporated', activeEvidence: 1, conflictingEvidence: 1, note: null })).toThrow(/conflicting/);
    expect(() => assertIncorporationRecord({ status: 'not_applicable', activeEvidence: 0, conflictingEvidence: 0, note: ' ' })).toThrow(/basis/);
    expect(() => assertIncorporationRecord({ status: 'unconfirmed', activeEvidence: 0, conflictingEvidence: 0, note: null })).not.toThrow();
    expect(verificationAfterRecord('unconfirmed')).toBe('unknown');
    expect(verificationAfterRecord('incorporated')).toBe('proposed');
  });
  it('verification: evidence-backed, by someone other than the recorder', () => {
    const v = { outcome: 'confirm' as const, status: 'incorporated' as const, verification: 'proposed' as const, activeEvidence: 1, conflictingEvidence: 0, verifierUserId: 'legal', recordedBy: 'pm', note: null };
    expect(assertIncorporationVerification(v)).toBe('confirmed');
    expect(() => assertIncorporationVerification({ ...v, recordedBy: 'legal' })).toThrow(/cannot verify/);
    expect(() => assertIncorporationVerification({ ...v, recordedBy: null })).toThrow(/recorder/);
    expect(() => assertIncorporationVerification({ ...v, activeEvidence: 0 })).toThrow(/evidence/);
    expect(() => assertIncorporationVerification({ ...v, verification: 'confirmed' })).toThrow(/already confirmed/);
    expect(() => assertIncorporationVerification({ ...v, status: 'unconfirmed' })).toThrow(/nothing to verify/);
    expect(() => assertIncorporationVerification({ ...v, outcome: 'reject' })).toThrow(/reason/);
    expect(assertIncorporationVerification({ ...v, outcome: 'reject', note: 'Record does not match' })).toBe('unknown');
  });
});

describe('AT-06 / REQ-LCY-007 — incorporation verified does not complete the carve-out', () => {
  it('incorporated_verified alongside transfer in progress and readiness pending', () => {
    const dims = computeStatusDimensions({
      newcoIncorporation: { status: 'incorporated', evidenceVerified: true },
      perimeter: [{ disposition: 'included', transferStatus: 'transferred_verified', economicTransferStatus: 'in_progress' }],
      readiness: [{ mandatory: true, blocker: true, status: 'in_progress' }],
      standaloneAccepted: false,
      closings: [],
    });
    expect(Object.fromEntries(dims.map((d) => [d.key, d.state]))).toMatchObject({ incorporation: 'incorporated_verified', perimeter_transfer: 'in_progress' });
    expect(isCarveOutComplete(dims)).toBe(false);
  });
});

describe('REQ-AGR-007 / REQ-AGR-004 / REQ-AGR-005 — regulatory, external-party and internal approvals', () => {
  it("UT: image-sourced requirement defaults to applicability pending, shown as 'Assessment pending — specialist'", () => {
    expect(initialApplicability('source_extraction')).toBe('assessment_pending');
    expect(initialApplicability('manual')).toBe('assessment_pending');
    expect(applicabilityLabel('assessment_pending')).toBe(APPLICABILITY_PENDING_LABEL);
    expect(APPLICABILITY_PENDING_LABEL).toBe('Assessment pending — specialist');
  });
  it('applicability assessment needs a basis and a different person than the registrant', () => {
    expect(() => assertApplicabilityAssessment({ applicability: 'applicable', basis: '', assessorUserId: 'l', createdBy: 'p' })).toThrow(/basis/);
    expect(() => assertApplicabilityAssessment({ applicability: 'applicable', basis: 'x', assessorUserId: 'l', createdBy: 'l' })).toThrow(/cannot also determine/);
  });
  const c = (o: Partial<RequirementCommandInput>): RequirementCommandInput => ({
    command: 'record_grant',
    status: 'submitted',
    applicability: 'applicable',
    date: '2026-11-01',
    conditions: null,
    validFrom: '2026-11-01',
    validTo: '2027-10-31',
    note: null,
    activeEvidence: 1,
    conflictingEvidence: 0,
    today: T0,
    ...o,
  });
  it('an outcome needs specialist applicability and evidence — never assumed obtained', () => {
    expect(assertRequirementCommand(c({}))).toBe('granted');
    expect(() => assertRequirementCommand(c({ applicability: 'assessment_pending' }))).toThrow(/Assessment pending — specialist/);
    expect(() => assertRequirementCommand(c({ activeEvidence: 0 }))).toThrow(/evidence/);
    expect(() => assertRequirementCommand(c({ command: 'record_grant_with_conditions' }))).toThrow(/conditions/);
    expect(() => assertRequirementCommand(c({ validTo: '2026-01-01' }))).toThrow(/Valid-to precedes/);
    expect(() => assertRequirementCommand(c({ command: 'submit', status: 'in_preparation', applicability: 'not_applicable' }))).toThrow(/not applicable/);
    expect(assertRequirementCommand(c({ command: 'start_preparation', status: 'not_started', applicability: 'assessment_pending', date: null }))).toBe('in_preparation');
    expect(() => assertRequirementCommand(c({ command: 'mark_expired', status: 'granted' }))).toThrow(/validity has ended/);
    expect(assertRequirementCommand(c({ command: 'mark_expired', status: 'granted', validTo: '2026-11-14' }))).toBe('expired');
  });
  it('UT: expired validity flagged', () => {
    expect(validityState({ status: 'granted', validFrom: '2025-01-01', validTo: '2026-11-14', today: T0, warnDays: 30 })).toBe('expired');
    expect(validityState({ status: 'granted', validFrom: '2025-01-01', validTo: '2026-12-01', today: T0, warnDays: 30 })).toBe('expiring');
    expect(validityState({ status: 'granted', validFrom: '2025-01-01', validTo: '2027-12-01', today: T0, warnDays: 30 })).toBe('valid');
    expect(validityState({ status: 'granted', validFrom: null, validTo: null, today: T0, warnDays: 30 })).toBe('no_expiry_recorded');
    expect(validityState({ status: 'submitted', validFrom: null, validTo: null, today: T0, warnDays: 30 })).toBe('not_granted');
  });
  it('UT: approval with condition shows condition until evidenced', () => {
    expect(conditionsState({ status: 'granted_with_conditions', conditions: 'Report quarterly', conditionsSatisfiedAt: null })).toBe('open');
    expect(conditionsState({ status: 'granted_with_conditions', conditions: 'Report quarterly', conditionsSatisfiedAt: '2026-11-10T00:00:00Z' })).toBe('satisfied');
    expect(conditionsState({ status: 'granted', conditions: null, conditionsSatisfiedAt: null })).toBe('none');
    const s = { state: 'open' as const, activeEvidence: 0, conflictingEvidence: 0, note: 'Done', actorUserId: 'a', outcomeRecordedBy: 'b' };
    expect(() => assertConditionsSatisfied(s)).toThrow(/evidence/);
    expect(() => assertConditionsSatisfied({ ...s, activeEvidence: 1, outcomeRecordedBy: 'a' })).toThrow(/cannot also confirm/);
    expect(() => assertConditionsSatisfied({ ...s, activeEvidence: 1 })).not.toThrow();
  });
});
