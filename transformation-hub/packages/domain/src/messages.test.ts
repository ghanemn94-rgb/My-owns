import { describe, expect, it } from 'vitest';
import { formatMessage, renderMessagesEn, serverMessage } from './messages';
import { computeStatusDimensions, DIMENSION_MESSAGES_EN, DIMENSION_NOT_YET_ASSESSED, type DimensionInput } from './carveout';
import { evaluateGate, gateApprovalDecisionIssue, gateDecisionIssue, GATE_MESSAGES_EN } from './gates';

/**
 * QA-P1-14 [REQ-UX-001, REQ-UX-002] — server-computed explanations are returned as codes + parameters (translated by the
 * client) and the English sentence is rendered from exactly the same messages.
 */

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('QA-P1-14 — server messages', () => {
  it('formatMessage interpolates known parameters and leaves unknown placeholders visible', () => {
    expect(formatMessage('{a} of {b}', { a: 1, b: 3 })).toBe('1 of 3');
    expect(formatMessage('{a} of {b}', { a: 1 })).toBe('1 of {b}');
    expect(() => renderMessagesEn([serverMessage('nope')], {})).toThrow(/No English template/);
  });

  const inputs: DimensionInput[] = [
    { newcoIncorporation: null, perimeter: [], readiness: [], standaloneAccepted: false, closings: [] },
    {
      newcoIncorporation: { status: 'incorporation_in_progress', evidenceVerified: false },
      perimeter: [
        { disposition: 'included', transferStatus: 'transferred_verified', economicTransferStatus: 'transferred_verified' },
        { disposition: 'shared', transferStatus: 'in_progress', economicTransferStatus: 'planned' },
        { disposition: 'pending', transferStatus: 'not_started', economicTransferStatus: 'not_started' },
      ],
      readiness: [
        { mandatory: true, blocker: false, status: 'passed' },
        { mandatory: true, blocker: false, status: 'in_progress' },
      ],
      standaloneAccepted: false,
      closings: [{ kind: 'closing', status: 'confirmed' }, { kind: 'closing', status: 'planned' }],
      tsas: [{ status: 'active', isEnduringArrangement: false }, { status: 'approved', isEnduringArrangement: true }],
      independenceDefinitionApproved: false,
    },
    {
      newcoIncorporation: { status: 'incorporated', evidenceVerified: false },
      perimeter: [{ disposition: 'included', transferStatus: 'blocked', economicTransferStatus: 'planned' }],
      readiness: [{ mandatory: false, blocker: true, status: 'failed' }],
      standaloneAccepted: false,
      closings: [{ kind: 'signing', status: 'confirmed' }],
    },
    // DOM-P2-05: a G4 approval flagged for controlled reassessment does not count as standalone acceptance.
    {
      newcoIncorporation: null,
      perimeter: [],
      readiness: [{ mandatory: true, blocker: false, status: 'passed' }],
      standaloneAccepted: true,
      standaloneUnderReassessment: true,
      closings: [],
    },
  ];

  it('every dimension carries codes + params, and the English explanation is rendered from them', () => {
    for (const input of inputs) {
      for (const d of computeStatusDimensions(input)) {
        expect(d.explanationI18n.length).toBeGreaterThan(0);
        for (const m of d.explanationI18n) {
          expect(DIMENSION_MESSAGES_EN[m.code], m.code).toBeDefined();
          // Every placeholder of the template is supplied (no "{x}" leaks into any language).
          expect(Object.keys(m.params).sort()).toEqual(placeholders(DIMENSION_MESSAGES_EN[m.code]!));
          for (const v of Object.values(m.params)) expect(['string', 'number']).toContain(typeof v);
        }
        expect(d.explanation).toBe(renderMessagesEn(d.explanationI18n, DIMENSION_MESSAGES_EN));
        expect(d.explanation).not.toMatch(/\{\w+\}/);
      }
    }
  });

  it('numbers and notes travel as parameters and separate messages (not English prose)', () => {
    const dims = computeStatusDimensions(inputs[1]!);
    const by = Object.fromEntries(dims.map((d) => [d.key, d]));
    expect(by['incorporation']!.explanationI18n).toEqual([{ code: 'dimension.incorporation.status', params: { status: 'incorporation_in_progress' } }]);
    expect(by['perimeter_transfer']!.explanationI18n).toEqual([{ code: 'dimension.perimeter.in_progress', params: { verified: 1, inScope: 2, pending: 1 } }]);
    expect(by['operational_readiness']!.explanationI18n).toEqual([
      { code: 'dimension.readiness.in_progress', params: { passed: 1, required: 2 } },
      { code: 'dimension.readiness.dependencies', params: { active: 1, enduring: 1 } },
      { code: 'dimension.readiness.definition_pending', params: {} },
    ]);
    expect(by['operational_readiness']!.explanation).toBe(
      '1 of 2 mandatory/blocking checks cleared. Dependencies: 1 transitional service(s) not yet exited, 1 approved enduring arrangement(s). The definition of operational independence is not yet approved.',
    );
    expect(by['jv_transaction']!.explanationI18n).toEqual([{ code: 'dimension.jv.partially_closed', params: { confirmed: 1, closings: 2 } }]);
    expect(DIMENSION_NOT_YET_ASSESSED).toEqual([{ code: 'dimension.not_yet_assessed', params: {} }]);
    const flagged = Object.fromEntries(computeStatusDimensions(inputs[3]!).map((d) => [d.key, d]));
    expect(flagged['operational_readiness']!.state).toBe('day1_ready');
    expect(flagged['operational_readiness']!.explanationI18n[0]).toEqual({ code: 'dimension.readiness.standalone_reassessment', params: {} });
    expect(computeStatusDimensions({ ...inputs[3]!, standaloneUnderReassessment: false }).find((d) => d.key === 'operational_readiness')!.state).toBe('standalone_accepted');
  });

  it('gate blockers carry a code + params; the message is the rendered English template', () => {
    const ev = evaluateGate({
      criteria: [
        { key: 'G1-C01', mandatory: true, blocking: false, waivable: false, evidenceRequired: true, status: 'unmet', activeEvidenceCount: 0, conflictingEvidenceCount: 0 },
        { key: 'G1-C02', mandatory: true, blocking: false, waivable: false, evidenceRequired: true, status: 'met', activeEvidenceCount: 0, conflictingEvidenceCount: 1 },
        { key: 'G1-C03', mandatory: true, blocking: false, waivable: false, evidenceRequired: true, status: 'waived', activeEvidenceCount: 0, conflictingEvidenceCount: 0 },
        { key: 'G1-C04', mandatory: true, blocking: false, waivable: false, evidenceRequired: true, status: 'not_applicable', activeEvidenceCount: 0, conflictingEvidenceCount: 0 },
      ],
      prerequisites: [{ gateKey: 'G0', status: 'in_assessment' }],
    });
    const issues = [
      ...ev.blockers,
      gateDecisionIssue(null, 'G1')!,
      gateDecisionIssue({ id: 'd', status: 'under_review', authorityOutcome: 'within_mandate', gateKey: 'G1' }, 'G1')!,
      gateDecisionIssue({ id: 'd', status: 'approved', authorityOutcome: 'within_mandate', gateKey: 'G2' }, 'G1')!,
      gateDecisionIssue({ id: 'd', status: 'recommended', authorityOutcome: 'pending_external_authority' }, 'G1')!,
      gateDecisionIssue({ id: 'd', status: 'approved', authorityOutcome: 'pending_external_authority' }, 'G1')!,
      gateDecisionIssue({ id: 'd', status: 'approved', authorityOutcome: 'not_assessed' }, 'G1')!,
      // DOM-P2R-04: the evidence of the recorded external approval
      gateDecisionIssue({ id: 'd', status: 'approved', authorityOutcome: 'pending_external_authority', externalAuthorityReference: 'R', externalEvidence: null }, 'G1')!,
      gateDecisionIssue({ id: 'd', status: 'approved', authorityOutcome: 'pending_external_authority', externalAuthorityReference: 'R', externalEvidence: { linkId: 'l', status: 'rejected', verified: true } }, 'G1')!,
      gateDecisionIssue({ id: 'd', status: 'approved', authorityOutcome: 'pending_external_authority', externalAuthorityReference: 'R', externalEvidence: { linkId: 'l', status: 'active', verified: false } }, 'G1')!,
      // DOM-P2-01
      gateApprovalDecisionIssue({ id: 'd', status: 'approved', authorityOutcome: 'within_mandate', gateKey: null }, 'G1', null)!,
      gateApprovalDecisionIssue({ id: 'd', status: 'approved', authorityOutcome: 'within_mandate', gateKey: 'G1', decisionTypeKey: 'x' }, 'G1', null)!,
      gateApprovalDecisionIssue({ id: 'd', status: 'approved', authorityOutcome: 'within_mandate', gateKey: 'G1', decisionTypeKey: null }, 'G1', { matrixVersionId: 'm', decisionType: null })!,
      gateApprovalDecisionIssue({ id: 'd', status: 'approved', authorityOutcome: 'within_mandate', gateKey: 'G1', decisionTypeKey: 'x' }, 'G1', { matrixVersionId: 'm', decisionType: null })!,
      gateApprovalDecisionIssue({ id: 'd', status: 'approved', authorityOutcome: 'within_mandate', gateKey: 'G1', decisionTypeKey: 'x' }, 'G1', { matrixVersionId: 'm', decisionType: { key: 'x', gateKeys: ['G2'], withinCommitteeAuthority: true } })!,
      gateApprovalDecisionIssue({ id: 'd', status: 'approved', authorityOutcome: 'within_mandate', gateKey: 'G1', decisionTypeKey: 'x' }, 'G1', { matrixVersionId: 'm', decisionType: { key: 'x', gateKeys: ['G1'], withinCommitteeAuthority: false } })!,
    ];
    const codes = new Set<string>();
    for (const b of issues) {
      expect(b.messageI18n).toHaveLength(1);
      const [m] = b.messageI18n;
      codes.add(m!.code);
      expect(Object.keys(m!.params).sort()).toEqual(placeholders(GATE_MESSAGES_EN[m!.code]!));
      expect(b.message).toBe(renderMessagesEn(b.messageI18n, GATE_MESSAGES_EN));
    }
    // Every blocker code has been exercised.
    expect([...codes].sort()).toEqual(Object.keys(GATE_MESSAGES_EN).sort());
    expect(issues.find((b) => b.messageI18n[0]!.code === 'gate.blocker.decision_not_approved')!.messageI18n[0]!.params).toEqual({ status: 'under_review' });
  });
});
