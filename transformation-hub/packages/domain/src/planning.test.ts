import { describe, it, expect } from 'vitest';
import {
  assertDesignatedApprover,
  assertPrerequisitesSatisfied,
  prerequisiteSatisfied,
  RAID_MACHINE,
  riskScore,
  riskRating,
  isBlockingIssue,
  isOverdue,
  lookAheadWindow,
  inWindow,
  deliverableProgressItem,
  drivingNetwork,
  latestDate,
  updateFreshnessDate,
} from './planning';
import { transition } from './workflows';
import { weightedProgress, calculateRag } from './measurement';
import { delayImpact } from './schedule';
import { canonicalJson } from './canonical';

describe('RAID lifecycle [REQ-PLN-012]', () => {
  it('allows escalation, closure and reopen; rejects closing a cancelled item', () => {
    expect(transition('raid', RAID_MACHINE, 'open', 'escalate')).toBe('escalated');
    expect(transition('raid', RAID_MACHINE, 'escalated', 'close')).toBe('closed');
    expect(transition('raid', RAID_MACHINE, 'closed', 'reopen')).toBe('open');
    expect(() => transition('raid', RAID_MACHINE, 'cancelled', 'close')).toThrow(/Cannot close/);
  });

  it('scores exposure as probability × impact with bands', () => {
    expect(riskScore(4, 5)).toBe(20);
    expect(riskRating(20)).toBe('high');
    expect(riskRating(9)).toBe('medium');
    expect(riskRating(4)).toBe('low');
    expect(() => riskScore(0, 3)).toThrow(RangeError);
    expect(() => riskScore(3, 6)).toThrow(RangeError);
  });

  it('treats only open high/critical issues as blockers', () => {
    expect(isBlockingIssue({ status: 'open', severity: 4 })).toBe(true);
    expect(isBlockingIssue({ status: 'escalated', severity: 5 })).toBe(true);
    expect(isBlockingIssue({ status: 'open', severity: 3 })).toBe(false);
    expect(isBlockingIssue({ status: 'closed', severity: 5 })).toBe(false);
  });

  it('overdue needs a past due date and an open item', () => {
    expect(isOverdue('2026-10-01', '2026-10-02', true)).toBe(true);
    expect(isOverdue('2026-10-02', '2026-10-02', true)).toBe(false);
    expect(isOverdue('2026-10-01', '2026-10-02', false)).toBe(false);
    expect(isOverdue(null, '2026-10-02', true)).toBe(false);
  });
});

describe('look-ahead window', () => {
  it('covers exactly N weeks inclusive and rejects other sizes', () => {
    const w = lookAheadWindow('2026-10-04', 2);
    expect(w).toEqual({ from: '2026-10-04', to: '2026-10-17' });
    expect(inWindow('2026-10-17', w)).toBe(true);
    expect(inWindow('2026-10-18', w)).toBe(false);
    expect(() => lookAheadWindow('2026-10-04', 3)).toThrow(RangeError);
  });
});

describe('weighted progress from deliverables [REQ-PLN-016, REQ-PLN-017]', () => {
  it('counts only accepted deliverables, excludes cancelled and unapproved weights with reasons', () => {
    const items = [
      deliverableProgressItem({ id: 'a', status: 'accepted', weight: 5, weightApproved: true }),
      deliverableProgressItem({ id: 'b', status: 'submitted', weight: 3, weightApproved: true }),
      deliverableProgressItem({ id: 'c', status: 'cancelled', weight: 10, weightApproved: true }),
      deliverableProgressItem({ id: 'd', status: 'accepted', weight: 4, weightApproved: false }),
    ];
    const p = weightedProgress(items);
    expect(p.denominatorWeight).toBe(8);
    expect(p.numeratorWeight).toBe(5);
    expect(p.percent).toBe(62.5);
    expect(p.exclusions.map((e) => e.id).sort()).toEqual(['c', 'd']);
    expect(p.exclusions.find((e) => e.id === 'd')!.reason).toMatch(/not approved/);
  });
});

describe('driving network', () => {
  it('returns the target and all transitive predecessors only', () => {
    const edges = [
      { predecessorId: 'A', successorId: 'B' },
      { predecessorId: 'B', successorId: 'C' },
      { predecessorId: 'X', successorId: 'C' },
      { predecessorId: 'C', successorId: 'D' },
    ];
    expect([...drivingNetwork('C', edges)].sort()).toEqual(['A', 'B', 'C', 'X']);
    expect([...drivingNetwork('A', edges)]).toEqual(['A']);
  });
});

describe('RAG inputs [REQ-PLN-020]', () => {
  it('latestDate requires all dates by default (missing → unknown)', () => {
    expect(latestDate(['2026-10-01', '2026-11-01'])).toBe('2026-11-01');
    expect(latestDate(['2026-10-01', null])).toBeNull();
    expect(latestDate(['2026-10-01', null], false)).toBe('2026-10-01');
    expect(latestDate([])).toBeNull();
  });

  it('freshness cannot be pre-dated into the future and stale is never green', () => {
    expect(updateFreshnessDate('2026-12-01', '2026-10-05')).toBe('2026-10-05');
    const r = calculateRag({ baselineFinish: '2026-11-01', forecastFinish: '2026-11-01', lastUpdatedOn: updateFreshnessDate('2026-09-01', '2026-09-02'), today: '2026-10-05', hasOpenBlocker: false });
    expect(r.status).toBe('stale');
  });
});

describe('canonical JSON', () => {
  it('is key-order independent', () => {
    expect(canonicalJson({ b: 1, a: [{ y: 2, x: null }] })).toBe(canonicalJson({ a: [{ x: null, y: 2 }], b: 1 }));
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
});

describe('delay impact on top of an existing forecast slip [REQ-PLN-024]', () => {
  it('applies the what-if delay to the current forecast finish, not only to the duration', () => {
    const fs = (p: string, s: string) => ({ predecessorId: p, successorId: s, type: 'FS' as const, lagDays: 0 });
    // A: 5 days from Sun 2026-10-04 (planned finish Thu 10-08) but forecast Thu 10-15 (+5 working days).
    const nodes = [
      { id: 'A', durationDays: 5, forecastFinish: '2026-10-15' },
      { id: 'M', durationDays: 0 },
    ];
    const r = delayImpact(nodes, [fs('A', 'M')], '2026-10-04', 'A', 3);
    expect(r.status).toBe('computed');
    expect(r.baselineFinish).toBe('2026-10-15');
    expect(r.forecastFinish).toBe('2026-10-20');
    expect(r.projectSlipWorkingDays).toBe(3);
  });

  it('does not move an activity that already finished', () => {
    const nodes = [
      { id: 'A', durationDays: 5, actualStart: '2026-10-04', actualFinish: '2026-10-08' },
      { id: 'M', durationDays: 0 },
    ];
    const r = delayImpact(nodes, [{ predecessorId: 'A', successorId: 'M', type: 'FS' as const, lagDays: 0 }], '2026-10-04', 'A', 3);
    expect(r.projectSlipWorkingDays).toBe(0);
  });
});

describe('DOM-P2-07 — the designated approver role accepts a task or its deliverable [REQ-PLN-011]', () => {
  it('only a holder of the designated approver role; no designated role = the acceptance permission decides', () => {
    expect(() => assertDesignatedApprover({ subject: 'task WS01-A01', approverRole: 'sponsor', actorRoles: ['functional_approver', 'workstream_lead'] })).toThrow(
      expect.objectContaining({ kind: 'forbidden', code: 'planning.acceptance.not_approver_role' }),
    );
    expect(() => assertDesignatedApprover({ subject: 'task WS01-A01', approverRole: 'functional_approver', actorRoles: ['functional_approver'] })).not.toThrow();
    expect(() => assertDesignatedApprover({ subject: 'task WS01-A01', approverRole: null, actorRoles: [] })).not.toThrow();
  });
});

describe('DOM-P2-18 — non-schedule prerequisites: decisions, gates, agreements, approvals, evidence [REQ-PLN-006]', () => {
  it('a task is blocked by a pending agreement dependency until the agreement is signed or effective', () => {
    const pending = { type: 'agreement' as const, stage: 'negotiating' as const };
    expect(prerequisiteSatisfied(pending)).toBe(false);
    expect(() => assertPrerequisitesSatisfied('Task WS03-A01', [pending])).toThrow(expect.objectContaining({ code: 'planning.prerequisite_pending', details: { pending: 1, types: ['agreement'] } }));
    for (const stage of ['signed', 'effective'] as const) expect(prerequisiteSatisfied({ type: 'agreement', stage })).toBe(true);
    for (const stage of ['identified', 'drafting', 'agreed_in_principle', 'terminated', 'expired'] as const) expect(prerequisiteSatisfied({ type: 'agreement', stage })).toBe(false);
    expect(() => assertPrerequisitesSatisfied('Task WS03-A01', [{ type: 'agreement', stage: 'signed' }])).not.toThrow();
  });
  it('a decision counts only when final — a recommendation pending the external authority does not', () => {
    const d = { type: 'decision' as const, externalAuthorityReference: null };
    expect(prerequisiteSatisfied({ ...d, status: 'approved', authorityOutcome: 'within_mandate' })).toBe(true);
    expect(prerequisiteSatisfied({ ...d, status: 'recommended', authorityOutcome: 'pending_external_authority' })).toBe(false);
    expect(prerequisiteSatisfied({ ...d, status: 'approved', authorityOutcome: 'pending_external_authority' })).toBe(false);
    // DOM-P2R-04: an external approval satisfies the prerequisite only while its evidence is active and verified.
    const ext = { ...d, status: 'approved' as const, authorityOutcome: 'pending_external_authority' as const, externalAuthorityReference: 'DEMO-REF' };
    expect(prerequisiteSatisfied({ ...ext, externalEvidence: { linkId: 'l1', status: 'active', verified: true } })).toBe(true);
    expect(prerequisiteSatisfied(ext)).toBe(false);
    expect(prerequisiteSatisfied({ ...ext, externalEvidence: { linkId: 'l1', status: 'rejected', verified: true } })).toBe(false);
    expect(prerequisiteSatisfied({ ...ext, externalEvidence: { linkId: 'l1', status: 'active', verified: false } })).toBe(false);
    expect(prerequisiteSatisfied({ ...d, status: 'under_review', authorityOutcome: 'not_assessed' })).toBe(false);
  });
  it('gates, approval requests and evidence', () => {
    expect(prerequisiteSatisfied({ type: 'gate', status: 'approved', needsReassessment: false })).toBe(true);
    expect(prerequisiteSatisfied({ type: 'gate', status: 'approved_with_exceptions', needsReassessment: false })).toBe(true);
    expect(prerequisiteSatisfied({ type: 'gate', status: 'approved', needsReassessment: true })).toBe(false);
    expect(prerequisiteSatisfied({ type: 'gate', status: 'ready_for_decision', needsReassessment: false })).toBe(false);
    expect(prerequisiteSatisfied({ type: 'approval_request', status: 'approved' })).toBe(true);
    expect(prerequisiteSatisfied({ type: 'approval_request', status: 'pending' })).toBe(false);
    expect(prerequisiteSatisfied({ type: 'evidence_link', status: 'active', verified: true })).toBe(true);
    expect(prerequisiteSatisfied({ type: 'evidence_link', status: 'active', verified: false })).toBe(false);
    expect(prerequisiteSatisfied({ type: 'evidence_link', status: 'rejected', verified: true })).toBe(false);
  });
});
