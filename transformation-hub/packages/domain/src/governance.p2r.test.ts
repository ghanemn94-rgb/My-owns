import { describe, expect, it } from 'vitest';
import { AGENDA_SCREENING_STATUSES, DECISION_STATUSES, MEETING_STATUSES, type DecisionStatus } from './enums';
import { DomainError } from './errors';
import {
  AGENDA_SCREENING_MACHINE,
  INTERNAL_APPROVAL_LABEL_EN,
  MEETING_MACHINE,
  assertAgendaMerge,
  checkAuthority,
  internalApprovalLabel,
  proposedMeetingSeries,
  screeningReasonRequired,
  type AuthorityPolicy,
} from './governance';
import { DECISION_MACHINE, allowedCommands, transition, type DecisionCommand } from './workflows';
import { DEFAULT_CALENDAR } from './calendar';

/** Runs `fn` and returns the DomainError it throws (fails the test when nothing, or something else, is thrown). */
function domainError(fn: () => unknown): DomainError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(DomainError);
    return e as DomainError;
  }
  throw new Error('expected a DomainError');
}

// =====================================================================================================================
// REQ-GOV-019 — the decision state machine rejects every illegal transition
// =====================================================================================================================

/**
 * The legal transitions of the decision lifecycle, written out independently of DECISION_MACHINE (spec §4.2,
 * docs/governance/decision-workflow.md): every (state, command) pair NOT listed here must be refused.
 */
const LEGAL: Record<DecisionStatus, Partial<Record<DecisionCommand, DecisionStatus>>> = {
  draft: { submit: 'submitted' },
  submitted: { return_to_draft: 'draft', start_review: 'under_review', defer: 'deferred' },
  under_review: { return_to_draft: 'draft', record_recommendation: 'recommended', record_approval: 'approved', record_rejection: 'rejected', defer: 'deferred' },
  recommended: { record_approval: 'approved', record_rejection: 'rejected', defer: 'deferred', supersede: 'superseded' },
  approved: { supersede: 'superseded', start_implementation: 'implementation_pending' },
  rejected: { supersede: 'superseded' },
  deferred: { resume: 'under_review', supersede: 'superseded' },
  superseded: {},
  implementation_pending: { supersede: 'superseded', verify_implementation: 'implemented_verified' },
  implemented_verified: {},
};
const COMMANDS: DecisionCommand[] = [
  'submit',
  'return_to_draft',
  'start_review',
  'record_recommendation',
  'record_approval',
  'record_rejection',
  'defer',
  'resume',
  'supersede',
  'start_implementation',
  'verify_implementation',
];

describe('REQ-GOV-019 — decision state machine: every (state, command) pair', () => {
  it('the table covers every decision state and every command of the machine (a new state or command must be added here)', () => {
    expect(Object.keys(LEGAL).sort()).toEqual([...DECISION_STATUSES].sort());
    expect(Object.keys(DECISION_MACHINE).sort()).toEqual([...COMMANDS].sort());
  });

  it('allows exactly the legal transitions and refuses every illegal one with 422 decision.invalid_transition', () => {
    let legal = 0;
    let illegal = 0;
    for (const state of DECISION_STATUSES) {
      for (const command of COMMANDS) {
        const expected = LEGAL[state][command];
        if (expected) {
          expect(transition('decision', DECISION_MACHINE, state, command), `${state} --${command}-->`).toBe(expected);
          legal++;
          continue;
        }
        const e = domainError(() => transition('decision', DECISION_MACHINE, state, command));
        // rule_violation is answered HTTP 422 by the API (apps/api/src/platform/errors.ts); 409 is only a version conflict.
        expect(e.kind, `${state} --${command}-->`).toBe('rule_violation');
        expect(e.code, `${state} --${command}-->`).toBe('decision.invalid_transition');
        expect(e.details).toMatchObject({ current: state, command });
        illegal++;
      }
    }
    expect(legal).toBe(20);
    expect(illegal).toBe(DECISION_STATUSES.length * COMMANDS.length - 20);
    expect(illegal).toBe(90);
  });

  it('allowedCommands lists exactly the legal commands per state; superseded and implemented-verified are terminal', () => {
    for (const state of DECISION_STATUSES) {
      expect(allowedCommands(DECISION_MACHINE, state).sort(), state).toEqual((Object.keys(LEGAL[state]) as DecisionCommand[]).sort());
    }
    expect(allowedCommands(DECISION_MACHINE, 'superseded')).toEqual([]);
    expect(allowedCommands(DECISION_MACHINE, 'implemented_verified')).toEqual([]);
  });

  it('an unknown command is refused (decision.unknown_command), never applied', () => {
    const e = domainError(() => transition('decision', DECISION_MACHINE, 'draft', 'approve' as DecisionCommand));
    expect(e.kind).toBe('rule_violation');
    expect(e.code).toBe('decision.unknown_command');
  });
});

// =====================================================================================================================
// REQ-GOV-002 — two committees with distinct authority levels decide differently for the same decision type
// =====================================================================================================================

const base: Omit<AuthorityPolicy, 'decisionTypes'> = {
  isDemoPolicy: true,
  quorum: { minVotingMembersPresent: 3, minFractionPresent: 0.5 },
  approvalThreshold: { type: 'simple_majority' },
  tieRule: 'escalate',
  selfApprovalProhibited: true,
  recusedMembersExcludedFromQuorum: true,
};

describe('REQ-GOV-002 — delegated authority levels differ between committees', () => {
  const steering: AuthorityPolicy = { ...base, decisionTypes: [{ key: 'change_request_budget', maxAmount: '1000000.0000', currency: 'SAR', unitScale: 1, withinCommitteeAuthority: true, escalateTo: 'Delegating authority — to be confirmed' }] };
  const workstreamBoard: AuthorityPolicy = { ...base, decisionTypes: [{ key: 'change_request_budget', maxAmount: '100000.0000', currency: 'SAR', unitScale: 1, withinCommitteeAuthority: true, escalateTo: 'Steering committee (synthetic)' }] };
  const amount = { amount: '500000.0000', currency: 'SAR', unitScale: 1 };

  it('the same decision type and amount is within the mandate of one committee and escalated by the other', () => {
    const a = checkAuthority({ policy: steering, decisionTypeKey: 'change_request_budget', amount });
    const b = checkAuthority({ policy: workstreamBoard, decisionTypeKey: 'change_request_budget', amount });
    expect(a).toMatchObject({ outcome: 'within_mandate', escalateTo: null });
    expect(b).toMatchObject({ outcome: 'pending_external_authority', escalateTo: 'Steering committee (synthetic)' });
    expect(b.reasonI18n[0]?.code).toBe('authority.above_limit');
  });

  it('within the lower limit both committees may decide', () => {
    const small = { amount: '90000.0000', currency: 'SAR', unitScale: 1 };
    expect(checkAuthority({ policy: steering, decisionTypeKey: 'change_request_budget', amount: small }).outcome).toBe('within_mandate');
    expect(checkAuthority({ policy: workstreamBoard, decisionTypeKey: 'change_request_budget', amount: small }).outcome).toBe('within_mandate');
  });
});

// =====================================================================================================================
// REQ-GOV-012 — screening outcomes accept / return / defer / merge / reject
// =====================================================================================================================

describe('REQ-GOV-012 — agenda screening machine and merge guard', () => {
  const LEGAL_SCREENING: Record<string, Record<string, string>> = {
    requested: { accept: 'accepted', return: 'returned', defer: 'deferred', merge: 'merged', reject: 'rejected' },
    deferred: { accept: 'accepted', return: 'returned', merge: 'merged', reject: 'rejected' },
    accepted: {},
    returned: {},
    withdrawn: {},
    merged: {},
    rejected: {},
  };

  it('every (screening status, outcome) pair: legal ones apply, the others are refused (agenda_request.invalid_transition)', () => {
    expect(Object.keys(LEGAL_SCREENING).sort()).toEqual([...AGENDA_SCREENING_STATUSES].sort());
    for (const s of AGENDA_SCREENING_STATUSES) {
      for (const c of Object.keys(AGENDA_SCREENING_MACHINE) as (keyof typeof AGENDA_SCREENING_MACHINE)[]) {
        const to = LEGAL_SCREENING[s]![c];
        if (to) expect(transition('agenda_request', AGENDA_SCREENING_MACHINE, s, c)).toBe(to);
        else expect(domainError(() => transition('agenda_request', AGENDA_SCREENING_MACHINE, s, c)).code).toBe('agenda_request.invalid_transition');
      }
    }
  });

  it('every outcome but accept needs a reason', () => {
    expect(screeningReasonRequired('accept')).toBe(false);
    for (const o of ['return', 'defer', 'merge', 'reject'] as const) expect(screeningReasonRequired(o)).toBe(true);
  });

  const src = { id: 'a', committeeId: 'c1', decisionId: null as string | null };
  const tgt = { id: 'b', committeeId: 'c1', meetingId: 'm1', screeningStatus: 'requested' as const, decisionId: null as string | null };
  it('merges into a live request of the same committee and meeting', () => {
    expect(() => assertAgendaMerge({ source: src, target: tgt, meetingId: 'm1' })).not.toThrow();
    expect(() => assertAgendaMerge({ source: src, target: { ...tgt, screeningStatus: 'accepted' }, meetingId: 'm1' })).not.toThrow();
  });
  it('refuses itself, another committee, no / another meeting, a closed target and a different decision paper', () => {
    const code = (f: () => void) => domainError(f).code;
    expect(code(() => assertAgendaMerge({ source: src, target: { ...tgt, id: 'a' }, meetingId: 'm1' }))).toBe('governance.agenda.merge_self');
    expect(code(() => assertAgendaMerge({ source: src, target: { ...tgt, committeeId: 'c2' }, meetingId: 'm1' }))).toBe('governance.agenda.merge_other_committee');
    expect(code(() => assertAgendaMerge({ source: src, target: tgt, meetingId: null }))).toBe('governance.agenda.merge_meeting_required');
    expect(code(() => assertAgendaMerge({ source: src, target: { ...tgt, meetingId: 'm2' }, meetingId: 'm1' }))).toBe('governance.agenda.merge_other_meeting');
    for (const closed of ['returned', 'merged', 'rejected', 'deferred', 'withdrawn'] as const) {
      expect(code(() => assertAgendaMerge({ source: src, target: { ...tgt, screeningStatus: closed }, meetingId: 'm1' }))).toBe('governance.agenda.merge_target_closed');
    }
    expect(code(() => assertAgendaMerge({ source: { ...src, decisionId: 'd1' }, target: tgt, meetingId: 'm1' }))).toBe('governance.agenda.merge_decision_conflict');
    expect(() => assertAgendaMerge({ source: { ...src, decisionId: 'd1' }, target: { ...tgt, decisionId: 'd1' }, meetingId: 'm1' })).not.toThrow();
  });
});

// =====================================================================================================================
// REQ-GOV-009 — proposed meeting series from the charter cadence
// =====================================================================================================================

describe('REQ-GOV-009 — proposed meeting series (cadence + first meeting given by the user, nothing invented)', () => {
  const cal = DEFAULT_CALENDAR; // Asia/Riyadh (UTC+3), Sunday–Thursday
  it('weekly and every-two-weeks keep the first meeting local time; dates only from the cadence', () => {
    const first = new Date('2026-10-04T07:00:00.000Z'); // Sunday 10:00 Riyadh
    const w = proposedMeetingSeries({ frequency: 'weekly', firstMeetingAt: first, count: 4, calendar: cal });
    expect(w.map((x) => x.localDate)).toEqual(['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25']);
    expect(w.map((x) => x.scheduledAt.toISOString())).toEqual(['2026-10-04T07:00:00.000Z', '2026-10-11T07:00:00.000Z', '2026-10-18T07:00:00.000Z', '2026-10-25T07:00:00.000Z']);
    expect(w.every((x) => !x.nonWorkingDay)).toBe(true);
    const b = proposedMeetingSeries({ frequency: 'every_two_weeks', firstMeetingAt: first, count: 3, calendar: cal });
    expect(b.map((x) => x.localDate)).toEqual(['2026-10-04', '2026-10-18', '2026-11-01']);
  });

  it('monthly keeps the day of the month across the year end; a start after the 28th is refused', () => {
    const m = proposedMeetingSeries({ frequency: 'monthly', firstMeetingAt: new Date('2026-11-15T06:30:00.000Z'), count: 3, calendar: cal });
    expect(m.map((x) => x.localDate)).toEqual(['2026-11-15', '2026-12-15', '2027-01-15']);
    expect(m.map((x) => x.scheduledAt.toISOString().slice(11))).toEqual(['06:30:00.000Z', '06:30:00.000Z', '06:30:00.000Z']);
    expect(domainError(() => proposedMeetingSeries({ frequency: 'monthly', firstMeetingAt: new Date('2026-10-29T07:00:00.000Z'), count: 2, calendar: cal })).code).toBe('governance.cadence.monthly_day_unsupported');
  });

  it('flags (never moves) dates on non-working days; refuses 0 or more than 12 meetings', () => {
    const fri = proposedMeetingSeries({ frequency: 'weekly', firstMeetingAt: new Date('2026-10-09T07:00:00.000Z'), count: 2, calendar: cal });
    expect(fri.map((x) => [x.localDate, x.nonWorkingDay])).toEqual([
      ['2026-10-09', true],
      ['2026-10-16', true],
    ]);
    expect(domainError(() => proposedMeetingSeries({ frequency: 'weekly', firstMeetingAt: new Date(), count: 0, calendar: cal })).code).toBe('governance.cadence.invalid_count');
    expect(domainError(() => proposedMeetingSeries({ frequency: 'weekly', firstMeetingAt: new Date(), count: 13, calendar: cal })).code).toBe('governance.cadence.invalid_count');
    // A series never starts in the past.
    const now = new Date('2026-10-01T00:00:00.000Z');
    expect(domainError(() => proposedMeetingSeries({ frequency: 'weekly', firstMeetingAt: new Date('2026-09-30T07:00:00.000Z'), count: 2, calendar: cal, now })).code).toBe('governance.cadence.start_in_past');
    expect(proposedMeetingSeries({ frequency: 'weekly', firstMeetingAt: new Date('2026-10-04T07:00:00.000Z'), count: 2, calendar: cal, now })).toHaveLength(2);
  });

  it('a proposed meeting is never published or opened: only confirm_schedule (→ planned) or cancel apply', () => {
    expect(MEETING_STATUSES[0]).toBe('proposed');
    expect(allowedCommands(MEETING_MACHINE, 'proposed').sort()).toEqual(['cancel', 'confirm_schedule']);
    expect(transition('meeting', MEETING_MACHINE, 'proposed', 'confirm_schedule')).toBe('planned');
    for (const c of ['publish_agenda', 'start_session', 'close_session', 'draft_minutes', 'approve_minutes'] as const) {
      expect(domainError(() => transition('meeting', MEETING_MACHINE, 'proposed', c)).code).toBe('meeting.invalid_transition');
    }
    expect(domainError(() => transition('meeting', MEETING_MACHINE, 'planned', 'confirm_schedule')).code).toBe('meeting.invalid_transition');
  });
});

// =====================================================================================================================
// REQ-GOV-027 — internal electronic approval label
// =====================================================================================================================

describe('REQ-GOV-027 — approvals are labelled internal electronic approvals', () => {
  it('the label says internal electronic approval and not a legally certified signature', () => {
    expect(internalApprovalLabel()).toEqual({ method: 'internal_electronic', label: INTERNAL_APPROVAL_LABEL_EN });
    expect(INTERNAL_APPROVAL_LABEL_EN).toMatch(/^Internal electronic approval/);
    expect(INTERNAL_APPROVAL_LABEL_EN).toMatch(/not a legally certified signature/);
  });
});
