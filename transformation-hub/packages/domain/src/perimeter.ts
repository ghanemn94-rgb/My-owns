import { ruleViolation } from './errors';
import { CONSENT_STATUSES } from './enums';
import type { AgreementStage, ContractTransferClass, PerimeterDisposition, PerimeterItemType, TransferStatus } from './enums';
import { TRANSFER_MACHINE, transition, type Machine, type TransferCommand } from './workflows';
import { assertDay1ContractPosition, combinedTransferStatus, perimeterChangeRequiresChangeRequest, reconcilePerimeter, type PerimeterReconItem, type ReconFinding } from './carveout';

/**
 * Carve-out perimeter rules used by the carve-out module (spec §7.1–7.2; AT-07, AT-08; REQ-PER-*, REQ-AGR-*).
 * Pure functions: every guard input the commands rely on is REQUIRED (P0 review N-01) — nothing fails open.
 */

// ---------------------------------------------------------------------------------------------------------
// Scope

export const TRANSFER_ASPECTS = ['legal', 'economic'] as const;
export type TransferAspect = (typeof TRANSFER_ASPECTS)[number];

/** The transferring scope: items that are Included or Shared. */
export function isInScope(d: PerimeterDisposition | null | undefined): boolean {
  return d === 'included' || d === 'shared';
}

/**
 * DOM-P34R-05 (A-P3-05; business-gates.md §1 rule 8): "not applicable" on an aspect of an Included / Shared item is a
 * specialist determination (one aspect, a basis) — a "not applicable" recorded while the item was OUT of the transferring
 * scope (Excluded / Pending) is not that determination. When the item ENTERS the scope (classification or an applied change
 * request), every such aspect is reset to `not_started` (recorded in the transfer history), to be planned or determined by
 * the specialist. Returns the aspects to reset (none when the item was already in scope or stays out of it).
 */
export function scopeEntryTransferReset(i: { fromDisposition: PerimeterDisposition; toDisposition: PerimeterDisposition; legal: TransferStatus; economic: TransferStatus }): ('legal' | 'economic')[] {
  if (isInScope(i.fromDisposition) || !isInScope(i.toDisposition)) return [];
  return (['legal', 'economic'] as const).filter((a) => (a === 'legal' ? i.legal : i.economic) === 'not_applicable');
}

/**
 * Categories every perimeter must assess (spec §7.1: assets, liabilities, receivables/payables, contracts, employees,
 * data, IP, licences, financing, guarantees and shared services — physical assets alone are not the perimeter).
 */
export const REQUIRED_PERIMETER_CATEGORIES: readonly PerimeterItemType[] = [
  'asset',
  'liability',
  'receivable',
  'payable',
  'contract',
  'employee_group',
  'data',
  'ip',
  'license',
  'financing',
  'guarantee',
  'shared_service',
];

/** Item types whose legal transfer depends on a counterparty (consent / novation / assignment — AT-08). */
export const CONTRACT_LIKE_TYPES: readonly PerimeterItemType[] = ['contract', 'license'];

export const isContractLike = (t: PerimeterItemType) => CONTRACT_LIKE_TYPES.includes(t);

// ---------------------------------------------------------------------------------------------------------
// Change control after baseline approval (AT-07)

export interface PerimeterChangeControlInput {
  /** A planning baseline or a perimeter version is approved. */
  baselineApproved: boolean;
  /** A planning baseline is approved (its snapshot lists the in-scope perimeter item ids). */
  planningBaselineApproved: boolean;
  /** The item is frozen into the approved planning baseline or the approved perimeter version. */
  itemInBaseline: boolean;
  /** The item is listed in the approved planning baseline snapshot. */
  itemInPlanningBaseline: boolean;
  isNewItem: boolean;
  fromDisposition: PerimeterDisposition | null;
  toDisposition: PerimeterDisposition;
}

export interface PerimeterChangeControl {
  requiresChangeRequest: boolean;
  entersScope: boolean;
  leavesScope: boolean;
  /** The approved planning baseline's perimeter scope would change → the change request needs a re-baseline. */
  rebaseline: boolean;
}

export function perimeterChangeControl(i: PerimeterChangeControlInput): PerimeterChangeControl {
  const requiresChangeRequest = perimeterChangeRequiresChangeRequest({
    baselineApproved: i.baselineApproved,
    itemInBaseline: i.itemInBaseline,
    isNewItem: i.isNewItem,
    fromDisposition: i.fromDisposition,
    toDisposition: i.toDisposition,
  });
  const before = i.isNewItem ? false : isInScope(i.fromDisposition);
  const after = isInScope(i.toDisposition);
  return {
    requiresChangeRequest,
    entersScope: !before && after,
    leavesScope: before && !after,
    rebaseline: requiresChangeRequest && i.planningBaselineApproved && after !== i.itemInPlanningBaseline,
  };
}

/** Scope attributes bound to a change request: the change is applied only if they are unchanged since it was raised. */
export interface PerimeterScope {
  disposition: PerimeterDisposition;
  siteId: string | null;
  currentEntityId: string | null;
  targetEntityId: string | null;
}

export function sameScope(a: PerimeterScope, b: PerimeterScope): boolean {
  return a.disposition === b.disposition && (a.siteId ?? null) === (b.siteId ?? null) && (a.currentEntityId ?? null) === (b.currentEntityId ?? null) && (a.targetEntityId ?? null) === (b.targetEntityId ?? null);
}

// ---------------------------------------------------------------------------------------------------------
// Transfers (REQ-PER-007, D-05)

export interface TransferCommandInput {
  command: TransferCommand;
  aspect: TransferAspect;
  /** Current status of THIS aspect. */
  current: TransferStatus;
  /** Current status of the OTHER aspect (DOM-P3-05: an in-scope item never has both aspects "not applicable"). */
  otherAspect: TransferStatus;
  disposition: PerimeterDisposition;
  itemType: PerimeterItemType;
  /** Mechanism that will apply after the command (from the command or the item). */
  mechanism: string | null;
  /** Date supplied with the command (planned for `plan`, actual for `report_transferred`). */
  effectiveDate: string | null;
  note: string | null;
  activeEvidence: number;
  conflictingEvidence: number;
  actorUserId: string;
  /** For verify / reject_evidence: who recorded the reported transfer (separation of duties). */
  reportedBy: string | null;
  transferClass: ContractTransferClass;
  /** Transferability class assessed by a specialist (D-17). */
  transferClassAssessed: boolean;
  /** Every consent request of the item granted (at least one). */
  consentGranted: boolean;
  today: string;
}

const blank = (s: string | null | undefined) => !s || !s.trim();

/** Applies the transfer state machine to one aspect with its data guards; returns the new status of that aspect. */
export function assertTransferCommand(i: TransferCommandInput): TransferStatus {
  if (!(TRANSFER_ASPECTS as readonly string[]).includes(i.aspect)) throw ruleViolation('transfer.invalid_aspect', 'A transfer record is either legal or economic');
  const to = transition('transfer', TRANSFER_MACHINE, i.current, i.command);
  const scopeFree: TransferCommand[] = ['mark_not_applicable', 'block', 'unblock'];
  if (!isInScope(i.disposition) && !scopeFree.includes(i.command)) {
    throw ruleViolation('transfer.not_in_scope', `Only Included or Shared items transfer (disposition is ${i.disposition})`);
  }
  switch (i.command) {
    case 'plan':
      if (blank(i.mechanism) || blank(i.effectiveDate)) {
        throw ruleViolation('transfer.plan_incomplete', `Planning the ${i.aspect} transfer requires a proposed mechanism and a planned effective date`);
      }
      break;
    case 'report_transferred':
      if (blank(i.mechanism) || blank(i.effectiveDate)) {
        throw ruleViolation('transfer.report_incomplete', `Reporting the ${i.aspect} transfer requires the mechanism and the actual effective date`);
      }
      if (i.effectiveDate! > i.today) throw ruleViolation('transfer.effective_date_in_future', 'An actual effective date cannot be in the future');
      if (i.aspect === 'legal' && isContractLike(i.itemType)) {
        if (!i.transferClassAssessed || i.transferClass === 'unknown') {
          throw ruleViolation('transfer.class_not_assessed', 'The legal transfer of a contract needs a specialist transferability assessment first');
        }
        if ((i.transferClass === 'consent_required' || i.transferClass === 'novation_required') && !i.consentGranted) {
          throw ruleViolation('transfer.consent_outstanding', 'The counterparty consent / novation has not been granted — record the Day-1 interim arrangement instead');
        }
        if (i.transferClass === 'retain' || i.transferClass === 'interim_arrangement') {
          throw ruleViolation('transfer.contract_not_transferring', `A contract classified "${i.transferClass}" does not transfer legally on Day 1`);
        }
      }
      break;
    case 'verify':
      if (i.activeEvidence < 1) throw ruleViolation('transfer.evidence_required', 'Verification requires active acceptance evidence linked to the transfer');
      if (i.conflictingEvidence > 0) throw ruleViolation('transfer.evidence_conflicting', 'Conflicting transfer evidence must be resolved before verification');
      if (!i.reportedBy || i.reportedBy === i.actorUserId) {
        throw ruleViolation('transfer.self_verification', 'A transfer cannot be verified by the person who reported it');
      }
      break;
    case 'reject_evidence':
      if (blank(i.note)) throw ruleViolation('transfer.reason_required', 'Rejecting transfer evidence requires a reason');
      if (!i.reportedBy || i.reportedBy === i.actorUserId) {
        throw ruleViolation('transfer.self_verification', 'Transfer evidence cannot be reviewed by the person who reported it');
      }
      break;
    case 'block':
    case 'mark_not_applicable':
      if (blank(i.note)) throw ruleViolation('transfer.reason_required', `${i.command === 'block' ? 'Blocking' : 'Marking not applicable'} requires a reason`);
      // DOM-P3-05: an Included / Shared item always transfers on at least one aspect. An item with neither a legal nor an
      // economic transfer is not in the transferring scope: it is reclassified (Excluded) through `classify` — under change
      // control once a baseline is approved (AT-07) — never taken out of the transfer by two "not applicable" marks.
      if (i.command === 'mark_not_applicable' && isInScope(i.disposition) && i.otherAspect === 'not_applicable') {
        throw ruleViolation(
          'transfer.not_applicable_in_scope',
          `The ${i.aspect === 'legal' ? 'economic' : 'legal'} transfer of this ${i.disposition} item is already "not applicable": an item that does not transfer at all is reclassified (Excluded) through the scope change, not marked not applicable`,
          { disposition: i.disposition, aspect: i.aspect },
        );
      }
      break;
    default:
      break;
  }
  return to;
}

/** Combined legal/economic view of an item (least advanced wins — D-05). */
export function transferView(legal: TransferStatus, economic: TransferStatus) {
  return { legal, economic, combined: combinedTransferStatus(legal, economic) };
}

// ---------------------------------------------------------------------------------------------------------
// Day-1 contract positions (AT-08, REQ-AGR-006/008)

export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

export interface Day1PositionItem {
  type: PerimeterItemType;
  disposition: PerimeterDisposition;
  transferClass: ContractTransferClass;
  /** User id of the specialist who assessed the class, or null. */
  transferClassAssessedBy: string | null;
  interimArrangement: string | null;
  serviceAccountableUserId: string | null;
  billingAccountableUserId: string | null;
  slaAccountableUserId: string | null;
  remediationPlan: string | null;
}

/** Consent is granted only when at least one request is granted and none is outstanding (conditional ≠ granted). */
export function consentsGranted(statuses: ConsentStatus[]): boolean {
  return statuses.some((s) => s === 'granted') && statuses.every((s) => s === 'granted' || s === 'not_required');
}

export function day1ContractPosition(item: Day1PositionItem, consentStatuses: ConsentStatus[]) {
  const applicable = isContractLike(item.type) && isInScope(item.disposition);
  const consentGranted = consentsGranted(consentStatuses);
  const result = assertDay1ContractPosition({
    transferClass: item.transferClass,
    classAssessedBy: item.transferClassAssessedBy,
    consentGranted,
    interimArrangement: item.interimArrangement,
    serviceAccountableOwner: item.serviceAccountableUserId,
    billingAccountableOwner: item.billingAccountableUserId,
    slaAccountableOwner: item.slaAccountableUserId,
    remediationPlan: item.remediationPlan,
  });
  return { applicable, consentGranted, ok: result.ok, missing: result.ok ? [] : result.missing };
}

// ---------------------------------------------------------------------------------------------------------
// Reconciliation (REQ-PER-003, REQ-PER-006)

export interface RegisterReconItem extends PerimeterReconItem {
  type: PerimeterItemType;
  ownerUserId: string | null;
  resolutionPath: string | null;
  targetGateKey: string | null;
  pendingChangeRequest: boolean;
  /** Day-1 position result for in-scope contract-like items; null when not applicable. */
  day1: { ok: boolean; missing: string[] } | null;
}

export type RegisterIssue = ReconFinding['issue'] | 'pending_without_resolution' | 'day1_position_incomplete' | 'change_request_pending';

export interface RegisterFinding {
  itemId: string;
  code: string;
  issue: RegisterIssue;
  message: string;
}

export interface CategoryCoverage {
  category: PerimeterItemType;
  items: number;
  reviewed: boolean;
  status: 'items_registered' | 'reviewed_none_in_perimeter' | 'unassessed';
}

export function reconcilePerimeterRegister(input: { items: RegisterReconItem[]; reviewedCategories: PerimeterItemType[] }) {
  const findings: RegisterFinding[] = reconcilePerimeter(input.items).map((f) => ({ ...f }));
  for (const it of input.items) {
    if (it.disposition === 'pending' && (!it.ownerUserId || blank(it.resolutionPath) || blank(it.targetGateKey))) {
      findings.push({ itemId: it.id, code: it.code, issue: 'pending_without_resolution', message: 'Pending item without owner, resolution path and target resolution gate (G1-C03)' });
    }
    if (it.day1 && !it.day1.ok) {
      findings.push({ itemId: it.id, code: it.code, issue: 'day1_position_incomplete', message: `Day-1 contract position incomplete: ${it.day1.missing.join(', ')}` });
    }
    if (it.pendingChangeRequest) {
      findings.push({ itemId: it.id, code: it.code, issue: 'change_request_pending', message: 'A scope change awaits change-request decision' });
    }
  }
  const byType = new Map<PerimeterItemType, number>();
  for (const it of input.items) byType.set(it.type, (byType.get(it.type) ?? 0) + 1);
  const reviewed = new Set(input.reviewedCategories);
  const categories: CategoryCoverage[] = REQUIRED_PERIMETER_CATEGORIES.map((c) => {
    const n = byType.get(c) ?? 0;
    return { category: c, items: n, reviewed: reviewed.has(c), status: n > 0 ? 'items_registered' : reviewed.has(c) ? 'reviewed_none_in_perimeter' : 'unassessed' };
  });
  const combined = input.items.map((i) => combinedTransferStatus(i.transferStatus ?? 'not_started', i.economicTransferStatus ?? 'not_started'));
  const inScope = input.items.filter((i) => isInScope(i.disposition));
  const summary = {
    items: input.items.length,
    inScope: inScope.length,
    excluded: input.items.filter((i) => i.disposition === 'excluded').length,
    pending: input.items.filter((i) => i.disposition === 'pending').length,
    legalVerified: inScope.filter((i) => i.transferStatus === 'transferred_verified').length,
    economicVerified: inScope.filter((i) => i.economicTransferStatus === 'transferred_verified').length,
    fullyVerified: input.items.filter((i, n) => isInScope(i.disposition) && combined[n] === 'transferred_verified').length,
    categoriesUnassessed: categories.filter((c) => c.status === 'unassessed').length,
  };
  return { findings, categories, summary };
}

// ---------------------------------------------------------------------------------------------------------
// Impact of a perimeter change across modules (REQ-PER-004)

export const IMPACT_AREAS = ['financial_statements', 'valuation', 'agreements', 'tsa', 'readiness', 'schedule', 'budget', 'transaction'] as const;
export type ImpactArea = (typeof IMPACT_AREAS)[number];
export type ImpactStatus = 'identified' | 'assessment_pending' | 'none_identified' | 'not_visible';
export interface ImpactRef {
  type: string;
  id: string;
  code: string;
}
export interface ImpactEntry {
  area: ImpactArea;
  status: ImpactStatus;
  summary: string;
  references: ImpactRef[];
}

export const SPECIALIST_PENDING = 'Assessment pending — specialist';

export interface ImpactInput {
  change: { kind: 'add' | 'reclassify' | 'review'; itemCode: string; itemType: PerimeterItemType; fromDisposition: PerimeterDisposition | null; toDisposition: PerimeterDisposition; scopeAttributesChanged: boolean };
  /** Related records per area; `null` = the caller may not see that register (no titles, no counts — AT-03). */
  agreements: ImpactRef[] | null;
  consents: ImpactRef[] | null;
  tsaServices: ImpactRef[] | null;
  readinessChecks: ImpactRef[] | null;
  milestones: ImpactRef[] | null;
  budgetLines: ImpactRef[] | null;
  hasSite: boolean;
  hasWorkstream: boolean;
}

const codes = (r: ImpactRef[]) => r.map((x) => x.code).join(', ');

/**
 * Derive the cross-module impact entries of a perimeter change from the registers. Figures are never computed or
 * invented: financial, valuation and transaction effects are always marked for specialist assessment; register links
 * are listed by code only.
 */
export function derivePerimeterImpacts(i: ImpactInput): ImpactEntry[] {
  const c = i.change;
  const before = c.kind === 'add' ? false : isInScope(c.fromDisposition);
  const after = isInScope(c.toDisposition);
  const scopeMoves = before !== after || c.kind === 'add' || c.scopeAttributesChanged;
  const direction = c.kind === 'add' ? `adds ${c.itemCode} (${c.toDisposition})` : before === after ? `changes the scope attributes of ${c.itemCode}` : `moves ${c.itemCode} ${after ? 'into' : 'out of'} the transferring scope`;
  const out: ImpactEntry[] = [];
  const push = (area: ImpactArea, status: ImpactStatus, summary: string, references: ImpactRef[] = []) => out.push({ area, status, summary, references });

  const financialTypes: PerimeterItemType[] = ['liability', 'receivable', 'payable', 'financing', 'guarantee', 'asset', 'site'];
  push(
    'financial_statements',
    scopeMoves ? 'assessment_pending' : 'none_identified',
    scopeMoves
      ? `The change ${direction}; the carve-out financial statements / reporting perimeter${financialTypes.includes(c.itemType) ? ' (balance-sheet item)' : ''} must be reassessed — ${SPECIALIST_PENDING} (Finance).`
      : 'No change to the transferring scope.',
  );
  push('valuation', scopeMoves ? 'assessment_pending' : 'none_identified', scopeMoves ? `Valuation assumptions may change — ${SPECIALIST_PENDING} (Finance / Corporate Development).` : 'No change to the transferring scope.');

  if (i.agreements === null && i.consents === null) push('agreements', 'not_visible', 'Agreement register not visible to you.');
  else {
    const refs = [...(i.agreements ?? []), ...(i.consents ?? [])];
    if (refs.length) push('agreements', 'identified', `Linked agreements / consents to review: ${codes(refs)}.`, refs);
    else push('agreements', scopeMoves && after ? 'assessment_pending' : 'none_identified', scopeMoves && after ? 'No transfer instrument linked yet — TBD.' : 'No linked agreement.');
  }

  if (i.tsaServices === null) push('tsa', 'not_visible', 'TSA register not visible to you.');
  else if (i.tsaServices.length) push('tsa', 'identified', `TSA services linked through the item's agreement: ${codes(i.tsaServices)}.`, i.tsaServices);
  else if (c.toDisposition === 'shared' || c.itemType === 'shared_service') push('tsa', 'assessment_pending', `Shared item: a TSA or approved enduring arrangement is required — TBD (${SPECIALIST_PENDING}).`);
  else push('tsa', 'none_identified', 'No TSA dependency identified.');

  if (i.readinessChecks === null) push('readiness', 'not_visible', 'Readiness register not visible to you.');
  else if (i.readinessChecks.length) push('readiness', 'identified', `Day-1 readiness checks for the same site to revisit: ${codes(i.readinessChecks)}.`, i.readinessChecks);
  else if (i.hasSite && after) push('readiness', 'assessment_pending', 'No Day-1 readiness checks exist for this site yet — checklist to be defined.');
  else push('readiness', 'none_identified', 'No readiness check linked.');

  if (i.milestones === null) push('schedule', 'not_visible', 'Plan not visible to you.');
  else if (i.milestones.length) push('schedule', 'identified', `Milestones of the item's workstream that may move: ${codes(i.milestones)}.`, i.milestones);
  else push('schedule', i.hasWorkstream ? 'none_identified' : 'assessment_pending', i.hasWorkstream ? 'No open milestone in the workstream.' : 'No workstream assigned — schedule impact TBD.');

  if (i.budgetLines === null) push('budget', 'not_visible', 'Budget not visible to you.');
  else if (i.budgetLines.length) push('budget', 'identified', `Budget lines of the item's workstream to review: ${codes(i.budgetLines)}.`, i.budgetLines);
  else push('budget', scopeMoves ? 'assessment_pending' : 'none_identified', scopeMoves ? `Separation / standalone cost effect — ${SPECIALIST_PENDING} (Finance).` : 'No budget effect identified.');

  push('transaction', scopeMoves ? 'assessment_pending' : 'none_identified', scopeMoves ? `Transaction perimeter (JV scope, CPs, signing/closing documents) — ${SPECIALIST_PENDING} (Legal / Corporate Development).` : 'No change to the transaction perimeter.');
  return out;
}

/** Change-request impacts (planning `ImpactsSchema` keys) built from the derived entries — each ≤ 2000 characters. */
export function changeRequestImpacts(entries: ImpactEntry[], scopeSummary: string): Record<'scope' | 'financial' | 'tsa' | 'readiness' | 'transaction' | 'time' | 'cost', string> {
  const text = (...areas: ImpactArea[]) =>
    areas
      .map((a) => entries.find((e) => e.area === a))
      .filter((e): e is ImpactEntry => !!e)
      .map((e) => `[${e.area}] ${e.summary}`)
      .join(' ')
      .slice(0, 2000);
  return {
    scope: scopeSummary.slice(0, 2000),
    financial: text('financial_statements', 'valuation'),
    tsa: text('tsa'),
    readiness: text('readiness'),
    transaction: text('transaction', 'agreements'),
    time: text('schedule'),
    cost: text('budget'),
  };
}

// ---------------------------------------------------------------------------------------------------------
// Perimeter version approval readiness (REQ-SET-012)

export interface PerimeterVersionItem {
  id: string;
  code: string;
  disposition: PerimeterDisposition;
  workstreamId: string | null;
  ownerUserId: string | null;
  workstreamLeadUserId: string | null;
}

/** Blockers stop the proposal; warnings are shown to the approver. */
export function perimeterVersionFindings(items: PerimeterVersionItem[], unassessedCategories: PerimeterItemType[]) {
  const blockers: { code: string; issue: string }[] = [];
  const warnings: { code: string; issue: string }[] = [];
  if (items.length === 0) blockers.push({ code: '-', issue: 'The perimeter register is empty' });
  for (const it of items) {
    if (it.disposition === 'pending') blockers.push({ code: it.code, issue: 'Disposition still pending — decide Included / Excluded / Shared first' });
    if (isInScope(it.disposition) && !it.workstreamId) blockers.push({ code: it.code, issue: 'In-scope item without a workstream' });
    if (isInScope(it.disposition) && !it.ownerUserId) blockers.push({ code: it.code, issue: 'In-scope item without an accountable owner' });
    if (isInScope(it.disposition) && it.workstreamId && !it.workstreamLeadUserId) warnings.push({ code: it.code, issue: 'The workstream has no assigned lead' });
  }
  for (const c of unassessedCategories) warnings.push({ code: c, issue: 'Perimeter category not assessed' });
  return { blockers, warnings };
}

// ---------------------------------------------------------------------------------------------------------
// Agreements (REQ-AGR-001/002/003)

/** Source labels offered when registering an agreement. They are TERMS AS FOUND IN SOURCES, never expansions. */
export const AGREEMENT_LABEL_SUGGESTIONS = ['ATA', 'TSA', 'MSA', 'SHA', 'JVA', 'SPA', 'Schedule', 'Other'] as const;

export const UNCONFIRMED_EXPANSION = 'Unconfirmed';

/** REQ-AGR-002: an abbreviation's expansion is shown only once an authorized owner confirmed it. */
export function displayKindExpansion(a: { kindExpansion: string | null; kindExpansionConfirmed: boolean }): string {
  return a.kindExpansionConfirmed && a.kindExpansion?.trim() ? a.kindExpansion : UNCONFIRMED_EXPANSION;
}

export function assertExpansionConfirmation(i: { actorUserId: string; ownerUserId: string | null; legalReviewerUserId: string | null; expansion: string; basis: string }) {
  const authorized = (!!i.ownerUserId && i.ownerUserId === i.actorUserId) || (!!i.legalReviewerUserId && i.legalReviewerUserId === i.actorUserId);
  if (!authorized) throw ruleViolation('agreement.expansion_not_owner', "Only the agreement's owner or legal reviewer can confirm what the abbreviation stands for");
  if (blank(i.expansion) || blank(i.basis)) throw ruleViolation('agreement.expansion_basis_required', 'Confirming an expansion requires the expansion and its basis');
}

export type AgreementCommand = 'start_drafting' | 'start_negotiation' | 'agree_in_principle' | 'reopen_negotiation' | 'record_signing' | 'record_effective' | 'terminate' | 'record_expiry';

export const AGREEMENT_MACHINE: Machine<AgreementStage, AgreementCommand> = {
  start_drafting: { from: ['identified'], to: 'drafting', description: 'Drafting started' },
  start_negotiation: { from: ['drafting'], to: 'negotiating', description: 'Negotiation started' },
  agree_in_principle: { from: ['negotiating'], to: 'agreed_in_principle', description: 'Terms agreed in principle (legal reviewer assigned)' },
  reopen_negotiation: { from: ['agreed_in_principle'], to: 'negotiating', description: 'Negotiation reopened' },
  record_signing: { from: ['agreed_in_principle'], to: 'signed', description: 'Signing recorded with the executed copy (not an e-signature)' },
  record_effective: { from: ['signed'], to: 'effective', description: 'Effective date reached / conditions met' },
  terminate: { from: ['signed', 'effective'], to: 'terminated', description: 'Terminated' },
  record_expiry: { from: ['effective'], to: 'expired', description: 'Expired' },
};

export interface AgreementCommandInput {
  command: AgreementCommand;
  stage: AgreementStage;
  legalReviewerUserId: string | null;
  signingDate: string | null;
  effectiveDate: string | null;
  expiryDate: string | null;
  executedDocumentId: string | null;
  activeEvidence: number;
  conflictingEvidence: number;
  reason: string | null;
  today: string;
}

export function assertAgreementCommand(i: AgreementCommandInput): AgreementStage {
  const to = transition('agreement', AGREEMENT_MACHINE, i.stage, i.command);
  if ((i.command === 'agree_in_principle' || i.command === 'record_signing') && !i.legalReviewerUserId) {
    throw ruleViolation('agreement.legal_reviewer_required', 'An agreement cannot advance to agreed-in-principle or signing without an assigned legal reviewer');
  }
  if (i.command === 'record_signing') {
    if (blank(i.signingDate)) throw ruleViolation('agreement.signing_date_required', 'Record the signing date');
    if (i.signingDate! > i.today) throw ruleViolation('agreement.signing_date_in_future', 'A signing date cannot be in the future');
    if (!i.executedDocumentId && i.activeEvidence < 1) throw ruleViolation('agreement.executed_copy_required', 'Signing requires the executed copy (document) or active signing evidence');
    if (i.conflictingEvidence > 0) throw ruleViolation('agreement.evidence_conflicting', 'Conflicting signing evidence must be resolved first');
  }
  if (i.command === 'record_effective') {
    if (blank(i.effectiveDate)) throw ruleViolation('agreement.effective_date_required', 'Record the effective date');
    if (i.signingDate && i.effectiveDate! < i.signingDate) throw ruleViolation('agreement.effective_before_signing', 'The effective date cannot precede the signing date');
    if (i.effectiveDate! > i.today) throw ruleViolation('agreement.effective_date_in_future', 'An agreement becomes effective on its effective date, not before');
  }
  if (i.command === 'terminate' && blank(i.reason)) throw ruleViolation('agreement.reason_required', 'Termination requires a reason');
  if (i.command === 'record_expiry') {
    if (blank(i.expiryDate)) throw ruleViolation('agreement.expiry_date_required', 'Record the expiry date');
    if (i.expiryDate! > i.today) throw ruleViolation('agreement.not_expired', 'The expiry date has not been reached');
  }
  return to;
}

// ---------------------------------------------------------------------------------------------------------
// Consents (REQ-AGR-008)

const CONSENT_TRANSITIONS: Record<ConsentStatus, ConsentStatus[]> = {
  not_requested: ['requested', 'not_required'],
  requested: ['granted', 'conditional', 'refused', 'not_required'],
  conditional: ['granted', 'refused'],
  refused: ['requested'],
  granted: [],
  not_required: [],
};

export interface ConsentResponseInput {
  from: ConsentStatus;
  to: ConsentStatus;
  date: string | null;
  evidenceNote: string | null;
  hasDocument: boolean;
  conditions: string | null;
  today: string;
}

export function assertConsentResponse(i: ConsentResponseInput): ConsentStatus {
  if (!(CONSENT_TRANSITIONS[i.from] ?? []).includes(i.to)) {
    throw ruleViolation('consent.invalid_transition', `Cannot move a consent from "${i.from}" to "${i.to}"`, { from: i.from, to: i.to, allowed: CONSENT_TRANSITIONS[i.from] ?? [] });
  }
  if (blank(i.date)) throw ruleViolation('consent.date_required', i.to === 'requested' ? 'Record the request date' : 'Record the response date');
  if (i.date! > i.today) throw ruleViolation('consent.date_in_future', 'The date cannot be in the future');
  if (i.to !== 'requested' && blank(i.evidenceNote) && !i.hasDocument) {
    throw ruleViolation('consent.evidence_required', 'A consent response needs evidence (the counterparty letter / record or an evidence note)');
  }
  if (i.to === 'conditional' && blank(i.conditions)) throw ruleViolation('consent.conditions_required', 'A conditional consent must state its conditions');
  return i.to;
}
