import { describe, expect, it } from 'vitest';
import { renderMessagesEn, type ServerMessage } from './messages';
import { PLANNING_MESSAGES_EN, effortMessages, planningEn, planText } from './planning-messages';
import { aggregateRag, calculateRag, capOverrideAtOpenBlockers, effectiveRag, weightedProgress } from './measurement';
import { deliverableProgressItem } from './planning';
import { computeSchedule, delayImpact, type ScheduleEdge, type ScheduleNode } from './schedule';
import { AUTHORITY_MESSAGES_EN, checkAuthority, type AuthorityPolicy } from './governance';

/**
 * QA-P2-04 [REQ-UX-001, REQ-UX-002] — planning and authority explanations are returned as codes + parameters next to the
 * English sentence, and the English sentence is rendered from exactly the same messages (so the translated text says the
 * same thing). Parameters are numbers, codes, dates or enum values; every placeholder is supplied.
 */
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

function wellFormed(messages: readonly ServerMessage[], templates: Readonly<Record<string, string>>) {
  expect(messages.length).toBeGreaterThan(0);
  for (const m of messages) {
    expect(templates[m.code], m.code).toBeDefined();
    expect(Object.keys(m.params).sort(), m.code).toEqual(placeholders(templates[m.code]!));
    for (const v of Object.values(m.params)) expect(['string', 'number']).toContain(typeof v);
  }
}

describe('QA-P2-04 — planning server messages', () => {
  it('every code starts with "plan." (the web routes plan.* codes to planning.messages) and its template is non-empty', () => {
    for (const [code, template] of Object.entries(PLANNING_MESSAGES_EN)) {
      expect(code).toMatch(/^plan\.[a-z_]+(\.[a-z_]+)*$/);
      expect(template.trim().length).toBeGreaterThan(0);
    }
    // No code is also a prefix of another (the web catalogue nests codes as objects).
    const codes = Object.keys(PLANNING_MESSAGES_EN);
    for (const c of codes) expect(codes.some((o) => o.startsWith(`${c}.`)), c).toBe(false);
  });

  it('calculated RAG: every outcome carries codes and the English explanation is rendered from them', () => {
    const base = { today: '2026-09-29', hasOpenBlocker: false };
    const cases = [
      { ...base, baselineFinish: '2026-10-01', forecastFinish: '2026-10-01', lastUpdatedOn: '2026-08-01', hasOpenBlocker: true },
      { ...base, baselineFinish: null, forecastFinish: null, lastUpdatedOn: null },
      { ...base, baselineFinish: '2026-10-01', forecastFinish: '2026-10-01', lastUpdatedOn: '2026-08-01' },
      { ...base, baselineFinish: null, forecastFinish: '2026-10-01', lastUpdatedOn: '2026-09-28' },
      { ...base, baselineFinish: '2026-10-01', forecastFinish: '2026-10-01', lastUpdatedOn: '2026-09-28' },
      { ...base, baselineFinish: '2026-10-01', forecastFinish: '2026-10-08', lastUpdatedOn: '2026-09-28' },
      { ...base, baselineFinish: '2026-10-01', forecastFinish: '2026-12-31', lastUpdatedOn: '2026-09-28' },
    ];
    const seen = new Set<string>();
    for (const c of cases) {
      const r = calculateRag(c);
      wellFormed(r.explanationI18n, PLANNING_MESSAGES_EN);
      expect(r.explanation).toBe(planningEn(r.explanationI18n));
      expect(r.explanation).not.toMatch(/\{\w+\}/);
      seen.add(r.status);
    }
    expect([...seen].sort()).toEqual(['amber', 'green', 'not_updated', 'red', 'stale', 'unknown']);
    // The previous English sentences are unchanged.
    expect(calculateRag(cases[2]!).explanation).toBe('Last accepted update is 59 days old (stale after 14).');
    expect(calculateRag(cases[5]!).explanationI18n).toEqual([{ code: 'plan.rag.amber', params: { slip: 5, limit: 10 } }]);
  });

  it('aggregation, overrides and the DOM-P2-10 cap carry codes; enum values travel as parameters', () => {
    const agg = aggregateRag([
      { id: 'a', status: 'green' },
      { id: 'b', status: 'stale' },
      { id: 'c', status: 'red', critical: true },
    ]);
    expect(agg.explanationI18n).toEqual([{ code: 'plan.rag.aggregate', params: { count: 3, status: 'red', red: 1, gaps: 1 } }]);
    expect(agg.explanation).toBe('Worst-of 3 item(s): red. 1 critical red, 1 with data-quality gaps.');
    wellFormed(aggregateRag([]).explanationI18n, PLANNING_MESSAGES_EN);

    const calc = calculateRag({ baselineFinish: '2026-10-01', forecastFinish: '2026-12-31', lastUpdatedOn: '2026-09-28', today: '2026-09-29', hasOpenBlocker: false });
    const ov = { overrideStatus: 'green' as const, reason: 'Sponsor judgement', expiresOn: '2026-10-15', reviewerUserId: 'rev', approved: true };
    const eff = effectiveRag(calc, ov, '2026-09-29');
    expect(eff.explanationI18n).toEqual([{ code: 'plan.rag.override', params: { reason: 'Sponsor judgement', until: '2026-10-15', calculated: 'red' } }]);
    expect(eff.explanation).toBe(planningEn(eff.explanationI18n));
    // Not overridden: the calculated explanation and its codes.
    const plain = effectiveRag(calc, null, '2026-09-29');
    expect(plain.explanationI18n).toEqual(calc.explanationI18n);
    expect(plain.explanation).toBe(calc.explanation);
    const capped = capOverrideAtOpenBlockers(eff, 2);
    expect(capped.explanationI18n).toEqual([{ code: 'plan.rag.override_capped', params: { status: 'green', count: 2, calculated: 'red' } }]);
    expect(capped.explanation).toBe(planningEn(capped.explanationI18n));
  });

  it('weighted progress: explanation and exclusion reasons carry codes; the Arabic label follows the deliverable title', () => {
    const r = weightedProgress([
      deliverableProgressItem({ id: 'd1', code: 'D-1', title: 'Charter', titleAr: 'الميثاق', status: 'accepted', weight: 3, weightApproved: true }),
      deliverableProgressItem({ id: 'd2', code: 'D-2', title: 'Plan', titleAr: null, status: 'cancelled', weight: 2, weightApproved: true }),
      deliverableProgressItem({ id: 'd3', code: 'D-3', title: 'Model', titleAr: 'النموذج', status: 'in_progress', weight: 2, weightApproved: false }),
      { id: 'x', weight: 0, state: 'in_progress' },
    ]);
    wellFormed(r.explanationI18n, PLANNING_MESSAGES_EN);
    expect(r.explanation).toBe('3 of 3 weight points accepted across 1 deliverable(s); 3 excluded.');
    expect(r.exclusions).toEqual([
      { id: 'd2', label: 'D-2 Plan', labelAr: null, reason: 'Cancelled — excluded from the denominator, not counted as complete', reasonI18n: [{ code: 'plan.progress.deliverable_cancelled', params: {} }] },
      { id: 'd3', label: 'D-3 Model', labelAr: 'D-3 النموذج', reason: 'Weight not approved', reasonI18n: [{ code: 'plan.progress.weight_not_approved', params: {} }] },
      { id: 'x', label: undefined, reason: 'No approved weight', reasonI18n: [{ code: 'plan.progress.no_approved_weight', params: {} }] },
    ]);
    for (const e of r.exclusions) expect(e.reason).toBe(planningEn(e.reasonI18n!));
    // A custom English reason without codes is kept as given (the client shows it as entered).
    expect(weightedProgress([{ id: 'y', weight: 1, state: 'excluded', exclusionReason: 'Out of scope per CR-7' }]).exclusions[0]).toMatchObject({ reason: 'Out of scope per CR-7', reasonI18n: null });
    wellFormed(weightedProgress([]).explanationI18n, PLANNING_MESSAGES_EN);
  });

  it('schedule assumptions: one message per assumption, rendered to the same English; the delay names the activity by code', () => {
    const nodes: ScheduleNode[] = [
      { id: 'A', label: 'WS01-A01 Perimeter definition', code: 'WS01-A01', durationDays: 5 },
      { id: 'M', label: 'WS01-M1 G1 milestone', code: 'WS01-M1', durationDays: 0 },
    ];
    const edges: ScheduleEdge[] = [{ predecessorId: 'A', successorId: 'M', type: 'FS', lagDays: 0 }];
    for (const r of [computeSchedule(nodes, edges, '2026-10-04'), computeSchedule([...nodes, { id: 'Z', durationDays: null }], edges, '2026-10-04'), computeSchedule(nodes, edges, 'bad')]) {
      expect(r.assumptionsI18n.length).toBe(r.assumptions.length);
      wellFormed(r.assumptionsI18n, PLANNING_MESSAGES_EN);
      r.assumptionsI18n.forEach((m, i) => expect(r.assumptions[i]).toBe(planningEn([m])));
    }
    const d = delayImpact(nodes, edges, '2026-10-04', 'A', 3);
    expect(d.assumptionsI18n.length).toBe(d.assumptions.length);
    expect(d.assumptionsI18n.at(-1)).toEqual({ code: 'plan.assumption.delay_applied', params: { days: 3, node: 'WS01-A01' } });
    expect(d.assumptions.at(-1)).toBe('Delay applied as +3 working day(s) to the duration (and any owner forecast finish) of WS01-A01.');
  });

  it('template effort estimates are recognised as codes; anything else is shown as entered', () => {
    expect(effortMessages('Assumed: 6 person-days')).toEqual([{ code: 'plan.effort.assumed_person_days', params: { days: 6 } }]);
    expect(effortMessages('TBD')).toEqual([{ code: 'plan.effort.tbd', params: {} }]);
    expect(planningEn(effortMessages('Assumed: 12 person-days')!)).toBe('Assumed: 12 person-days');
    expect(effortMessages('about two weeks')).toBeNull();
    expect(effortMessages(null)).toBeNull();
    expect(() => planText('plan.nope')).toThrow(/No English template/);
  });
});

describe('QA-P2-04 — authority assessment reasons', () => {
  const policy: AuthorityPolicy = {
    isDemoPolicy: true,
    quorum: { minVotingMembersPresent: 3, minFractionPresent: 0.5 },
    approvalThreshold: { type: 'simple_majority' },
    tieRule: 'chair_casting_vote',
    decisionTypes: [
      { key: 'budget_reallocation', maxAmount: '5000000', currency: 'SAR', unitScale: 1, withinCommitteeAuthority: true, escalateTo: 'Board — to be confirmed' },
      { key: 'jv_signing', maxAmount: null, currency: 'SAR', unitScale: 1, withinCommitteeAuthority: false, escalateTo: 'Board of Directors — to be confirmed' },
    ],
    selfApprovalProhibited: true,
    recusedMembersExcludedFromQuorum: true,
  };

  it('every outcome carries an authority.* code and the English reason is rendered from it', () => {
    const results = [
      checkAuthority({ policy, decisionTypeKey: 'unknown', amount: null }),
      checkAuthority({ policy, decisionTypeKey: 'jv_signing', amount: null }),
      checkAuthority({ policy, decisionTypeKey: 'budget_reallocation', amount: null }),
      checkAuthority({ policy, decisionTypeKey: 'budget_reallocation', amount: { amount: '1', currency: 'USD', unitScale: 1 } }),
      checkAuthority({ policy, decisionTypeKey: 'budget_reallocation', amount: { amount: '6', currency: 'SAR', unitScale: 1_000_000 } }),
      checkAuthority({ policy, decisionTypeKey: 'budget_reallocation', amount: { amount: '4000', currency: 'SAR', unitScale: 1000 } }),
    ];
    expect(results.map((r) => r.reasonI18n[0]!.code)).toEqual([
      'authority.type_not_in_matrix',
      'authority.reserved',
      'authority.amount_required',
      'authority.currency_mismatch',
      'authority.above_limit',
      'authority.within_mandate',
    ]);
    for (const r of results) {
      wellFormed(r.reasonI18n, AUTHORITY_MESSAGES_EN);
      expect(r.reason).toBe(renderMessagesEn(r.reasonI18n, AUTHORITY_MESSAGES_EN));
    }
    expect(results[1]!.reason).toBe('Decision type "jv_signing" is reserved for Board of Directors — to be confirmed.');
    expect(results[1]!.reasonI18n).toEqual([{ code: 'authority.reserved', params: { decisionType: 'jv_signing', body: 'Board of Directors — to be confirmed' } }]);
  });
});
