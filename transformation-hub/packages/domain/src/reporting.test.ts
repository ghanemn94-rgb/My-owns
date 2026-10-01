import { describe, expect, it } from 'vitest';
import {
  diffFigures,
  isFormulaLike,
  isTsaAtRisk,
  kpiActionClosureTime,
  kpiBenefitsRealized,
  kpiContractsAwaitingConsent,
  kpiCpsVerified,
  kpiDay1Readiness,
  kpiDeliverablesAcceptedVsDue,
  kpiMilestoneDelayDays,
  kpiNextGateCriteriaMet,
  kpiOpenBlockers,
  kpiOverdueDecisions,
  kpiPerimeterOutstanding,
  kpiPerimeterTransferred,
  kpiSeparationCostVsBudget,
  kpiTsasAtRisk,
  kpiUpdateFreshness,
  KPI_CALCULATOR_KEYS,
  KPI_SOURCE_PERMISSION,
  lookAheadBucket,
  maxClassification,
  neutralizeSpreadsheetText,
  readinessBySite,
} from './reporting';
import { POLICY_MATRIX } from './policy';

describe('REQ-SEC-017 spreadsheet formula neutralisation (C-17)', () => {
  it("UT: '=HYPERLINK(...)' exported as text", () => {
    expect(neutralizeSpreadsheetText('=HYPERLINK("http://x.invalid","click")')).toBe('\'=HYPERLINK("http://x.invalid","click")');
  });
  it.each(['=1+1', '+1', '-1+2', '@SUM(A1)', '\tcmd', '\rcmd', '  =1', ' =1', '＝1', '＋1', '－1', '＠x'])('neutralises %j', (v) => {
    expect(isFormulaLike(v)).toBe(true);
    expect(neutralizeSpreadsheetText(v)).toBe(`'${v}`);
  });
  it.each(['Plain text', 'a=b', 'نص عربي', '', '2026-10-01', "'already"])('leaves %j unchanged', (v) => {
    expect(isFormulaLike(v)).toBe(false);
    expect(neutralizeSpreadsheetText(v)).toBe(v);
  });
});

describe('classification of derived artefacts', () => {
  it('takes the max of the inputs, never below the floor', () => {
    expect(maxClassification([])).toBe('internal');
    expect(maxClassification(['public', 'confidential', null, 'internal'])).toBe('confidential');
    expect(maxClassification(['restricted', 'strictly_confidential'])).toBe('strictly_confidential');
  });
});

describe('REQ-RPT-004 look-ahead windows use business dates', () => {
  it('UT: look-ahead window boundaries use business dates', () => {
    const today = '2026-10-01';
    expect(lookAheadBucket(today, '2026-09-30')).toBeNull(); // overdue, not look-ahead
    expect(lookAheadBucket(today, '2026-10-01')).toBe(2); // today is inside the first window
    expect(lookAheadBucket(today, '2026-10-14')).toBe(2); // day 14 = last day of the 2-week window
    expect(lookAheadBucket(today, '2026-10-15')).toBe(4);
    expect(lookAheadBucket(today, '2026-10-28')).toBe(4);
    expect(lookAheadBucket(today, '2026-10-29')).toBe(8);
    expect(lookAheadBucket(today, '2026-11-25')).toBe(8);
    expect(lookAheadBucket(today, '2026-11-26')).toBeNull();
    expect(lookAheadBucket(today, null)).toBeNull();
  });
});

describe('REQ-RPT-012/014 proposed KPI calculators (reference fixture)', () => {
  const today = '2026-10-01';
  it('UT: each proposed KPI computes from reference fixture', () => {
    expect(
      kpiDeliverablesAcceptedVsDue(
        [
          { status: 'accepted', dueDate: '2026-09-01', weight: '2', weightApproved: true },
          { status: 'submitted', dueDate: '2026-09-15', weight: '2', weightApproved: true },
          { status: 'cancelled', dueDate: '2026-09-15', weight: '5', weightApproved: true },
          { status: 'planned', dueDate: '2026-12-01', weight: '1', weightApproved: true },
        ],
        today,
      ),
    ).toMatchObject({ state: 'computed', value: 50, numerator: 2, denominator: 4 });
    // Sun–Thu working week: 2026-10-01 (Thu) → 2026-10-05 (Mon) = 2 working days (Sun 4, Mon 5).
    expect(
      kpiMilestoneDelayDays([
        { status: 'at_risk', isCritical: true, plannedDate: '2026-10-01', forecastDate: '2026-10-05', actualDate: null, baselineDate: '2026-10-01' },
        { status: 'planned', isCritical: false, plannedDate: '2026-10-01', forecastDate: '2026-12-31', actualDate: null, baselineDate: null },
      ]),
    ).toMatchObject({ state: 'computed', value: 2 });
    expect(
      kpiOverdueDecisions(
        [
          { status: 'submitted', latestSafeDate: '2026-09-30' },
          { status: 'approved', latestSafeDate: '2026-09-01' },
          { status: 'draft', latestSafeDate: '2026-10-02' },
        ],
        today,
      ),
    ).toMatchObject({ state: 'computed', value: 1 });
    expect(
      kpiActionClosureTime([
        { status: 'verified_closed', createdOn: '2026-09-27', verifiedOn: '2026-10-01' }, // Sun→Thu: 4 working days
        { status: 'open', createdOn: '2026-09-01', verifiedOn: null },
      ]),
    ).toMatchObject({ state: 'computed', value: 4, denominator: 1 });
    const perimeter = [
      { disposition: 'included', transferStatus: 'transferred_verified', hasPlan: true },
      { disposition: 'included', transferStatus: 'not_started', hasPlan: false },
      { disposition: 'shared', transferStatus: 'planned', hasPlan: true },
      { disposition: 'excluded', transferStatus: 'not_applicable', hasPlan: false },
    ];
    expect(kpiPerimeterTransferred(perimeter)).toMatchObject({ state: 'computed', value: 50 });
    expect(kpiPerimeterOutstanding(perimeter)).toMatchObject({ state: 'computed', value: 1 });
    expect(
      kpiContractsAwaitingConsent([
        { status: 'requested', hasInterimArrangement: false },
        { status: 'requested', hasInterimArrangement: true },
        { status: 'granted', hasInterimArrangement: false },
        { status: 'not_required', hasInterimArrangement: false },
      ]),
    ).toMatchObject({ state: 'computed', value: 1 });
    const checks = [
      { siteKey: 'S1', mandatory: true, blocker: true, status: 'passed' },
      { siteKey: 'S1', mandatory: true, blocker: false, status: 'in_progress' },
      { siteKey: 'S2', mandatory: true, blocker: true, status: 'failed' },
    ];
    expect(kpiDay1Readiness(checks)).toMatchObject({ state: 'computed', value: 33.3, notes: ['kpi.open_blockers_red'] });
    expect(readinessBySite(checks)).toEqual([
      { siteKey: 'S1', mandatory: 2, signedOff: 1, percent: 50, openBlockers: 0, rag: 'amber' },
      { siteKey: 'S2', mandatory: 1, signedOff: 0, percent: 0, openBlockers: 1, rag: 'red' },
    ]);
    expect(kpiCpsVerified([{ status: 'verified' }, { status: 'waived' }, { status: 'open' }, { status: 'evidence_submitted' }])).toMatchObject({ value: 50 });
    expect(
      kpiTsasAtRisk(
        [
          { status: 'active', endDate: '2026-11-01', replacementAccepted: false },
          { status: 'active', endDate: '2026-11-01', replacementAccepted: true },
          { status: 'active', endDate: '2027-12-01', replacementAccepted: false },
          { status: 'expired_unresolved', endDate: '2026-09-01', replacementAccepted: false },
        ],
        today,
      ),
    ).toMatchObject({ state: 'computed', value: 2 });
    expect(kpiSeparationCostVsBudget([{ currency: 'SAR', unitScale: 1000, approved: 200, committed: 50, spent: 50 }])).toMatchObject({ state: 'computed', value: 50 });
    expect(
      kpiUpdateFreshness(
        [
          { key: 'WS01', lastAcceptedPeriodEnd: '2026-09-25' },
          { key: 'WS02', lastAcceptedPeriodEnd: '2026-08-01' },
          { key: 'WS03', lastAcceptedPeriodEnd: null },
          { key: 'WS04', lastAcceptedPeriodEnd: '2026-09-17' },
        ],
        today,
      ),
    ).toMatchObject({ state: 'computed', value: 50 });
    expect(
      kpiBenefitsRealized([
        { status: 'realized_verified', currency: 'SAR', unitScale: 1, planned: 100, realizedVerified: 40 },
        { status: 'tracking', currency: 'SAR', unitScale: 1, planned: 100, realizedVerified: null },
      ]),
    ).toMatchObject({ state: 'computed', value: 20 });
    expect(
      kpiNextGateCriteriaMet([
        { mandatory: true, status: 'met' },
        { mandatory: true, status: 'unmet' },
        { mandatory: true, status: 'not_applicable' },
        { mandatory: false, status: 'unmet' },
      ]),
    ).toMatchObject({ value: 50 });
    expect(kpiOpenBlockers({ gateCriteria: 2, readinessChecks: 1, cps: 0 })).toMatchObject({ state: 'computed', value: 3, notes: [] });
  });

  it("UT: KPI with no observations renders 'Proposed — no data' (no source records → no value, never a historical figure)", () => {
    for (const r of [
      kpiDeliverablesAcceptedVsDue([], today),
      kpiMilestoneDelayDays([]),
      kpiOverdueDecisions([], today),
      kpiActionClosureTime([]),
      kpiPerimeterTransferred([]),
      kpiPerimeterOutstanding([]),
      kpiContractsAwaitingConsent([]),
      kpiDay1Readiness([]),
      kpiCpsVerified([]),
      kpiTsasAtRisk([], today),
      kpiSeparationCostVsBudget([]),
      kpiUpdateFreshness([], today),
      kpiBenefitsRealized([]),
      kpiNextGateCriteriaMet([]),
      kpiOpenBlockers({ gateCriteria: null, readinessChecks: null, cps: null }),
    ]) {
      expect(r.state).toBe('no_data');
      expect(r.value).toBeNull();
    }
  });

  it('AT-29: money KPIs never aggregate across currencies or unit scales', () => {
    const mixed = kpiSeparationCostVsBudget([
      { currency: 'SAR', unitScale: 1, approved: 100, committed: 0, spent: 10 },
      { currency: 'USD', unitScale: 1, approved: 100, committed: 0, spent: 10 },
    ]);
    expect(mixed).toMatchObject({ state: 'no_data', value: null, notes: ['kpi.mixed_currency_no_single_value'] });
    expect(
      kpiBenefitsRealized([
        { status: 'realized_verified', currency: 'SAR', unitScale: 1, planned: 100, realizedVerified: 40 },
        { status: 'tracking', currency: 'SAR', unitScale: 1000, planned: 100, realizedVerified: null },
      ]),
    ).toMatchObject({ state: 'no_data', notes: ['kpi.mixed_currency_no_single_value'] });
  });

  it('TSA risk: breached / expired-unresolved always; active only inside the warning window without an accepted replacement', () => {
    expect(isTsaAtRisk({ status: 'breached', endDate: null, replacementAccepted: true }, today)).toBe(true);
    expect(isTsaAtRisk({ status: 'exit_accepted', endDate: '2026-10-02', replacementAccepted: false }, today)).toBe(false);
    expect(isTsaAtRisk({ status: 'active', endDate: '2026-12-30', replacementAccepted: false }, today)).toBe(true); // 90 days
    expect(isTsaAtRisk({ status: 'active', endDate: '2026-12-31', replacementAccepted: false }, today)).toBe(false);
  });

  it('every calculator names an existing read permission of its source records', () => {
    for (const k of KPI_CALCULATOR_KEYS) expect(POLICY_MATRIX.permissions[KPI_SOURCE_PERMISSION[k]], k).toBeTruthy();
  });
});

describe('REQ-RPT-006 changes since the previous snapshot', () => {
  it('UT: diff between two snapshots lists changed figures', () => {
    const before = [
      { section: 'delays', key: 'overdue_tasks', value: 3 },
      { section: 'delays', key: 'late_milestones', value: 1 },
      { section: 'raid', key: 'open_risks', value: null },
    ];
    const after = [
      { section: 'delays', key: 'overdue_tasks', value: 5 },
      { section: 'delays', key: 'late_milestones', value: 1 },
      { section: 'raid', key: 'open_risks', value: 4 },
      { section: 'raid', key: 'open_issues', value: 2 }, // new figure: not compared
    ];
    expect(diffFigures(before, after)).toEqual([
      { section: 'delays', key: 'overdue_tasks', before: 3, after: 5, delta: 2 },
      { section: 'raid', key: 'open_risks', before: null, after: 4, delta: null },
    ]);
  });
});
