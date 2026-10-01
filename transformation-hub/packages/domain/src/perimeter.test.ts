import { describe, expect, it } from 'vitest';
import {
  assertAgreementCommand,
  assertConsentResponse,
  assertExpansionConfirmation,
  assertTransferCommand,
  changeRequestImpacts,
  consentsGranted,
  day1ContractPosition,
  derivePerimeterImpacts,
  displayKindExpansion,
  perimeterChangeControl,
  perimeterVersionFindings,
  reconcilePerimeterRegister,
  sameScope,
  AGREEMENT_LABEL_SUGGESTIONS,
  REQUIRED_PERIMETER_CATEGORIES,
  type AgreementCommandInput,
  type RegisterReconItem,
  type TransferCommandInput,
  scopeEntryTransferReset,
} from './perimeter';
import { assertDay1ContractPosition, computeStatusDimensions, perimeterChangeRequiresChangeRequest, reconcilePerimeter } from './carveout';

const T0 = '2026-11-15';

const transfer = (o: Partial<TransferCommandInput>): TransferCommandInput => ({
  command: 'plan',
  aspect: 'legal',
  current: 'not_started',
  otherAspect: 'not_started',
  disposition: 'included',
  itemType: 'asset',
  mechanism: 'Asset transfer agreement (proposed)',
  effectiveDate: '2026-12-01',
  note: null,
  activeEvidence: 0,
  conflictingEvidence: 0,
  actorUserId: 'u-verifier',
  reportedBy: null,
  transferClass: 'unknown',
  transferClassAssessed: false,
  consentGranted: false,
  today: T0,
  ...o,
});

describe('N-01 — guard inputs the carve-out commands rely on fail closed when omitted', () => {
  it('status dimensions: an omitted economic status is NOT treated as the legal status', () => {
    const dims = computeStatusDimensions({
      newcoIncorporation: null,
      perimeter: [{ disposition: 'included', transferStatus: 'transferred_verified' } as never],
      readiness: [],
      standaloneAccepted: false,
      closings: [],
    });
    expect(dims.find((d) => d.key === 'perimeter_transfer')!.state).not.toBe('transferred_verified');
  });
  it('reconciliation: an omitted economic status keeps the transfer-plan finding', () => {
    const f = reconcilePerimeter([
      { id: '1', code: 'P1', disposition: 'included', transferStatus: 'not_applicable', transferMechanism: null, plannedEffectiveDate: null, consentRequired: false, consentGranted: false, evidenceCount: 0, hasInterimArrangement: false } as never,
    ]);
    expect(f.map((x) => x.issue)).toContain('no_transfer_plan');
  });
  it('Day-1 position: an omitted specialist assessment is not accepted', () => {
    const r = assertDay1ContractPosition({ transferClass: 'transferable', consentGranted: false, interimArrangement: null, serviceAccountableOwner: null, billingAccountableOwner: null, slaAccountableOwner: null, remediationPlan: null } as never);
    expect(r.ok).toBe(false);
  });
  it('change control: omitted flags require a change request', () => {
    expect(perimeterChangeRequiresChangeRequest({ toDisposition: 'excluded' } as never)).toBe(true);
    expect(perimeterChangeRequiresChangeRequest({ baselineApproved: true, itemInBaseline: false, isNewItem: false, toDisposition: 'excluded' } as never)).toBe(true);
  });
});

describe('AT-07 — perimeter change control after baseline approval', () => {
  const base = { baselineApproved: true, planningBaselineApproved: true, itemInBaseline: false, itemInPlanningBaseline: false, isNewItem: false, fromDisposition: 'pending' as const, toDisposition: 'excluded' as const };
  it('no baseline → direct change', () => {
    expect(perimeterChangeControl({ ...base, baselineApproved: false, planningBaselineApproved: false, isNewItem: true, fromDisposition: null, toDisposition: 'shared' }).requiresChangeRequest).toBe(false);
  });
  it('a new site / shared asset after approval needs a CR that re-baselines', () => {
    const c = perimeterChangeControl({ ...base, isNewItem: true, fromDisposition: null, toDisposition: 'shared' });
    expect(c).toEqual({ requiresChangeRequest: true, entersScope: true, leavesScope: false, rebaseline: true });
  });
  it('moving an item into or out of scope needs a CR; resolving pending → excluded does not', () => {
    expect(perimeterChangeControl({ ...base, fromDisposition: 'excluded', toDisposition: 'included' }).requiresChangeRequest).toBe(true);
    expect(perimeterChangeControl({ ...base, itemInBaseline: true, itemInPlanningBaseline: true, fromDisposition: 'included', toDisposition: 'excluded' })).toMatchObject({ requiresChangeRequest: true, leavesScope: true, rebaseline: true });
    expect(perimeterChangeControl(base).requiresChangeRequest).toBe(false);
  });
  it('a site change of a baselined in-scope item needs a CR but no re-baseline', () => {
    const c = perimeterChangeControl({ ...base, itemInBaseline: true, itemInPlanningBaseline: true, fromDisposition: 'included', toDisposition: 'included' });
    expect(c).toEqual({ requiresChangeRequest: true, entersScope: false, leavesScope: false, rebaseline: false });
  });
  it('a change request is bound to the scope it was raised against', () => {
    const s = { disposition: 'pending' as const, siteId: 'a', currentEntityId: null, targetEntityId: 'n' };
    expect(sameScope(s, { ...s })).toBe(true);
    expect(sameScope(s, { ...s, siteId: 'b' })).toBe(false);
  });
});

describe('REQ-PER-007 / D-05 — transfers per aspect, verified by command', () => {
  it('planning requires mechanism and planned date; the result is the aspect status', () => {
    expect(assertTransferCommand(transfer({}))).toBe('planned');
    expect(() => assertTransferCommand(transfer({ mechanism: null }))).toThrow(/mechanism/);
    expect(() => assertTransferCommand(transfer({ aspect: 'operational' as never }))).toThrow(/legal or economic/);
  });
  it('excluded items do not transfer', () => {
    expect(() => assertTransferCommand(transfer({ disposition: 'excluded' }))).toThrow(/Only Included or Shared/);
    expect(assertTransferCommand(transfer({ disposition: 'excluded', command: 'mark_not_applicable', note: 'Retained by the parent' }))).toBe('not_applicable');
  });
  it('an actual effective date cannot be in the future', () => {
    expect(() => assertTransferCommand(transfer({ command: 'report_transferred', current: 'in_progress', effectiveDate: '2027-01-01' }))).toThrow(/future/);
  });
  it('UT: verifyTransfer without evidence rejected; the reporter cannot verify', () => {
    const v = transfer({ command: 'verify', current: 'transferred_pending_evidence', reportedBy: 'u-reporter' });
    expect(() => assertTransferCommand(v)).toThrow(/evidence/);
    expect(() => assertTransferCommand({ ...v, activeEvidence: 1, conflictingEvidence: 1 })).toThrow(/Conflicting/);
    expect(() => assertTransferCommand({ ...v, activeEvidence: 1, reportedBy: 'u-verifier' })).toThrow(/reported it/);
    expect(() => assertTransferCommand({ ...v, activeEvidence: 1, reportedBy: null })).toThrow(/reported it/);
    expect(assertTransferCommand({ ...v, activeEvidence: 1 })).toBe('transferred_verified');
  });
  it('AT-08: a contract cannot be reported legally transferred without specialist class and granted consent', () => {
    const r = transfer({ command: 'report_transferred', current: 'in_progress', effectiveDate: '2026-11-01', itemType: 'contract' });
    expect(() => assertTransferCommand(r)).toThrow(/specialist transferability/);
    expect(() => assertTransferCommand({ ...r, transferClass: 'consent_required', transferClassAssessed: true })).toThrow(/consent/);
    expect(() => assertTransferCommand({ ...r, transferClass: 'retain', transferClassAssessed: true })).toThrow(/does not transfer/);
    expect(assertTransferCommand({ ...r, transferClass: 'consent_required', transferClassAssessed: true, consentGranted: true })).toBe('transferred_pending_evidence');
    // economic transfer of the same contract is tracked separately (e.g. back-to-back economics under an interim arrangement)
    expect(assertTransferCommand({ ...r, aspect: 'economic' })).toBe('transferred_pending_evidence');
  });
});

describe('AT-08 / REQ-AGR-006/008 — Day-1 contract positions and consents', () => {
  const item = {
    type: 'contract' as const,
    disposition: 'included' as const,
    transferClass: 'consent_required' as const,
    transferClassAssessedBy: 'u-legal',
    interimArrangement: null,
    serviceAccountableUserId: null,
    billingAccountableUserId: null,
    slaAccountableUserId: null,
    remediationPlan: null,
  };
  it('consent outstanding → interim arrangement, owners and remediation are required', () => {
    const p = day1ContractPosition(item, ['requested']);
    expect(p).toEqual({ applicable: true, consentGranted: false, ok: false, missing: ['interimArrangement', 'serviceAccountableOwner', 'billingAccountableOwner', 'slaAccountableOwner', 'remediationPlan'] });
    const complete = day1ContractPosition({ ...item, interimArrangement: 'Back-to-back service (TBD by Legal)', serviceAccountableUserId: 'a', billingAccountableUserId: 'b', slaAccountableUserId: 'c', remediationPlan: 'Chase consent' }, ['requested']);
    expect(complete.ok).toBe(true);
  });
  it('conditional consent is not granted; granted + not_required is', () => {
    expect(consentsGranted(['conditional'])).toBe(false);
    expect(consentsGranted([])).toBe(false);
    expect(consentsGranted(['granted', 'not_required'])).toBe(true);
    expect(day1ContractPosition(item, ['granted']).ok).toBe(true);
  });
  it('consent responses need a date, evidence and (for conditional) conditions', () => {
    const r = { from: 'requested' as const, to: 'granted' as const, date: '2026-11-01', evidenceNote: 'Letter (synthetic)', hasDocument: false, conditions: null, today: T0 };
    expect(assertConsentResponse(r)).toBe('granted');
    expect(() => assertConsentResponse({ ...r, evidenceNote: null })).toThrow(/evidence/);
    expect(() => assertConsentResponse({ ...r, to: 'conditional' })).toThrow(/conditions/);
    expect(() => assertConsentResponse({ ...r, from: 'not_requested' })).toThrow(/Cannot move/);
    expect(() => assertConsentResponse({ ...r, date: '2027-01-01' })).toThrow(/future/);
    expect(assertConsentResponse({ ...r, from: 'not_requested', to: 'requested', evidenceNote: null })).toBe('requested');
  });
});

describe('REQ-PER-003 / REQ-PER-006 — reconciliation', () => {
  const it0: RegisterReconItem = {
    id: '1',
    code: 'PI-1',
    type: 'contract',
    disposition: 'included',
    transferStatus: 'not_started',
    economicTransferStatus: 'not_started',
    transferMechanism: null,
    plannedEffectiveDate: null,
    consentRequired: false,
    consentGranted: false,
    evidenceCount: 0,
    hasInterimArrangement: false,
    ownerUserId: null,
    resolutionPath: null,
    targetGateKey: null,
    pendingChangeRequest: false,
    day1: { ok: false, missing: ['specialistClassification'] },
  };
  it('UT: lists an item with no transfer record/plan; flags unassessed categories (physical assets are not the perimeter)', () => {
    const r = reconcilePerimeterRegister({ items: [it0, { ...it0, id: '2', code: 'PI-2', type: 'asset', disposition: 'pending', day1: null }], reviewedCategories: ['financing'] });
    expect(r.findings.map((f) => `${f.code}:${f.issue}`).sort()).toEqual(['PI-1:day1_position_incomplete', 'PI-1:no_transfer_plan', 'PI-2:pending_disposition', 'PI-2:pending_without_resolution']);
    const cat = Object.fromEntries(r.categories.map((c) => [c.category, c.status]));
    expect(cat['contract']).toBe('items_registered');
    expect(cat['financing']).toBe('reviewed_none_in_perimeter');
    expect(cat['guarantee']).toBe('unassessed');
    expect(r.categories).toHaveLength(REQUIRED_PERIMETER_CATEGORIES.length);
    expect(r.summary).toMatchObject({ items: 2, inScope: 1, pending: 1, categoriesUnassessed: REQUIRED_PERIMETER_CATEGORIES.length - 3 });
  });
  it('legal verified but economic pending is not fully verified (D-05)', () => {
    const r = reconcilePerimeterRegister({ items: [{ ...it0, day1: null, transferStatus: 'transferred_verified', economicTransferStatus: 'in_progress', transferMechanism: 'x', plannedEffectiveDate: '2026-12-01', evidenceCount: 1 }], reviewedCategories: [] });
    expect(r.summary.legalVerified).toBe(1);
    expect(r.summary.fullyVerified).toBe(0);
  });
});

describe('REQ-PER-004 — cross-module impact of a perimeter change', () => {
  const input = {
    change: { kind: 'add' as const, itemCode: 'PI-9', itemType: 'site' as const, fromDisposition: null, toDisposition: 'shared' as const, scopeAttributesChanged: false },
    agreements: [],
    consents: [],
    tsaServices: [],
    readinessChecks: [{ type: 'readiness_check', id: 'r1', code: 'RC-001' }],
    milestones: [{ type: 'milestone', id: 'm1', code: 'M-001' }],
    budgetLines: null,
    hasSite: true,
    hasWorkstream: true,
  };
  it('adding a shared site produces entries across every module, figures left to specialists', () => {
    const e = derivePerimeterImpacts(input);
    const by = Object.fromEntries(e.map((x) => [x.area, x.status]));
    expect(by).toEqual({
      financial_statements: 'assessment_pending',
      valuation: 'assessment_pending',
      agreements: 'assessment_pending',
      tsa: 'assessment_pending',
      readiness: 'identified',
      schedule: 'identified',
      budget: 'not_visible',
      transaction: 'assessment_pending',
    });
    expect(e.find((x) => x.area === 'readiness')!.references.map((r) => r.code)).toEqual(['RC-001']);
    expect(JSON.stringify(e)).not.toMatch(/\d+(\.\d+)?\s*(SAR|USD|%)/); // no invented figures
    const cr = changeRequestImpacts(e, 'Add shared site PI-9');
    expect(Object.keys(cr).sort()).toEqual(['cost', 'financial', 'readiness', 'scope', 'time', 'transaction', 'tsa']);
    expect(cr.tsa).toMatch(/TSA or approved enduring arrangement/);
    expect(cr.cost).toMatch(/not visible/);
  });
});

describe('REQ-SET-012 — perimeter version approval readiness', () => {
  it('pending dispositions and in-scope items without workstream/owner block; missing lead warns', () => {
    const f = perimeterVersionFindings(
      [
        { id: '1', code: 'A', disposition: 'pending', workstreamId: null, ownerUserId: null, workstreamLeadUserId: null },
        { id: '2', code: 'B', disposition: 'included', workstreamId: 'w', ownerUserId: null, workstreamLeadUserId: null },
      ],
      ['guarantee'],
    );
    expect(f.blockers.map((b) => b.code)).toEqual(['A', 'B']);
    expect(f.warnings.map((w) => w.code)).toEqual(['B', 'guarantee']);
    expect(perimeterVersionFindings([], []).blockers).toHaveLength(1);
  });
});

describe('REQ-AGR-001/002/003 — agreements', () => {
  it('UT: agreement types include ATA, TSA, MSA, SHA/JV (as source labels)', () => {
    for (const l of ['ATA', 'TSA', 'MSA', 'SHA', 'JVA']) expect(AGREEMENT_LABEL_SUGGESTIONS).toContain(l);
  });
  it("UT: agreement type expansion defaults to 'Unconfirmed'", () => {
    expect(displayKindExpansion({ kindExpansion: 'Asset Transfer Agreement', kindExpansionConfirmed: false })).toBe('Unconfirmed');
    expect(displayKindExpansion({ kindExpansion: 'Asset Transfer Agreement', kindExpansionConfirmed: true })).toBe('Asset Transfer Agreement');
    expect(() => assertExpansionConfirmation({ actorUserId: 'x', ownerUserId: 'o', legalReviewerUserId: 'l', expansion: 'E', basis: 'B' })).toThrow(/owner or legal reviewer/);
    expect(() => assertExpansionConfirmation({ actorUserId: 'l', ownerUserId: 'o', legalReviewerUserId: 'l', expansion: 'E', basis: ' ' })).toThrow(/basis/);
  });
  const a = (o: Partial<AgreementCommandInput>): AgreementCommandInput => ({
    command: 'record_signing',
    stage: 'agreed_in_principle',
    legalReviewerUserId: 'l',
    signingDate: '2026-11-01',
    effectiveDate: null,
    expiryDate: null,
    executedDocumentId: 'd',
    activeEvidence: 0,
    conflictingEvidence: 0,
    reason: null,
    today: T0,
    ...o,
  });
  it('UT: agreement without legal reviewer cannot advance to Signing', () => {
    expect(() => assertAgreementCommand(a({ legalReviewerUserId: null }))).toThrow(/legal reviewer/);
    expect(() => assertAgreementCommand(a({ command: 'agree_in_principle', stage: 'negotiating', legalReviewerUserId: null }))).toThrow(/legal reviewer/);
    expect(assertAgreementCommand(a({}))).toBe('signed');
  });
  it('signing needs the executed copy and a past date; effective date not before signing', () => {
    expect(() => assertAgreementCommand(a({ executedDocumentId: null }))).toThrow(/executed copy/);
    expect(assertAgreementCommand(a({ executedDocumentId: null, activeEvidence: 1 }))).toBe('signed');
    expect(() => assertAgreementCommand(a({ signingDate: '2027-01-01' }))).toThrow(/future/);
    expect(() => assertAgreementCommand(a({ command: 'record_effective', stage: 'signed', effectiveDate: '2026-10-01' }))).toThrow(/precede/);
    expect(() => assertAgreementCommand(a({ command: 'record_signing', stage: 'drafting' }))).toThrow(/Cannot record_signing/);
  });
});

describe('DOM-P34R-05 — "not applicable" set out of scope does not enter the transferring scope', () => {
  it('entering the scope resets every not-applicable aspect; staying in / out of scope resets nothing', () => {
    expect(scopeEntryTransferReset({ fromDisposition: 'excluded', toDisposition: 'included', legal: 'not_applicable', economic: 'not_applicable' })).toEqual(['legal', 'economic']);
    expect(scopeEntryTransferReset({ fromDisposition: 'pending', toDisposition: 'shared', legal: 'not_started', economic: 'not_applicable' })).toEqual(['economic']);
    expect(scopeEntryTransferReset({ fromDisposition: 'shared', toDisposition: 'included', legal: 'not_applicable', economic: 'not_started' })).toEqual([]);
    expect(scopeEntryTransferReset({ fromDisposition: 'excluded', toDisposition: 'pending', legal: 'not_applicable', economic: 'not_applicable' })).toEqual([]);
  });
});
