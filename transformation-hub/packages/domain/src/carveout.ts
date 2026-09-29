import { ruleViolation } from './errors';
import type {
  IncorporationStatus,
  PerimeterDisposition,
  TransferStatus,
  ReadinessStatus,
  ContractTransferClass,
  TsaStatus,
  ClosingStatus,
  ConditionStatus,
  PartnerStage,
  ClosingKind,
} from './enums';

// ---------------------------------------------------------------------------------------------------------
// Four independent status dimensions (spec §3, AT-06)

export interface DimensionInput {
  newcoIncorporation: { status: IncorporationStatus; evidenceVerified: boolean } | null;
  perimeter: { disposition: PerimeterDisposition; transferStatus: TransferStatus }[];
  readiness: { mandatory: boolean; blocker: boolean; status: ReadinessStatus }[];
  standaloneAccepted: boolean; // G4 approved
  closings: { kind: ClosingKind; status: ClosingStatus }[];
}

export interface DimensionState {
  key: 'incorporation' | 'perimeter_transfer' | 'operational_readiness' | 'jv_transaction';
  state: string;
  explanation: string;
  counts?: Record<string, number>;
}

export function computeStatusDimensions(input: DimensionInput): DimensionState[] {
  const inc: DimensionState = (() => {
    if (!input.newcoIncorporation) return { key: 'incorporation', state: 'unconfirmed', explanation: 'No NewCo legal entity recorded.' };
    const { status, evidenceVerified } = input.newcoIncorporation;
    if (status === 'incorporated' && evidenceVerified) return { key: 'incorporation', state: 'incorporated_verified', explanation: 'Incorporation confirmed with verified evidence.' };
    if (status === 'incorporated') return { key: 'incorporation', state: 'incorporated_unverified', explanation: 'Reported incorporated; evidence not yet verified.' };
    return { key: 'incorporation', state: status, explanation: `Incorporation status: ${status}.` };
  })();

  const inScope = input.perimeter.filter((p) => p.disposition === 'included' || p.disposition === 'shared');
  const counts: Record<string, number> = {};
  for (const p of inScope) counts[p.transferStatus] = (counts[p.transferStatus] ?? 0) + 1;
  const pending = input.perimeter.filter((p) => p.disposition === 'pending').length;
  const verified = counts['transferred_verified'] ?? 0;
  const blocked = counts['blocked'] ?? 0;
  const naCount = counts['not_applicable'] ?? 0;
  const perimeter: DimensionState = (() => {
    if (inScope.length === 0) return { key: 'perimeter_transfer', state: 'perimeter_not_defined', explanation: 'No included/shared perimeter items.', counts };
    if (blocked > 0) return { key: 'perimeter_transfer', state: 'blocked', explanation: `${blocked} perimeter item(s) blocked.`, counts };
    if (verified + naCount === inScope.length && pending === 0) return { key: 'perimeter_transfer', state: 'transferred_verified', explanation: 'All in-scope items transferred with verified evidence.', counts };
    if (verified > 0 || (counts['transferred_pending_evidence'] ?? 0) > 0 || (counts['in_progress'] ?? 0) > 0) {
      return { key: 'perimeter_transfer', state: 'in_progress', explanation: `${verified} of ${inScope.length} in-scope items verified; ${pending} item(s) with pending disposition.`, counts };
    }
    return { key: 'perimeter_transfer', state: 'not_started', explanation: `${inScope.length} in-scope items; none transferred.`, counts };
  })();

  const mandatory = input.readiness.filter((r) => r.mandatory && r.status !== 'not_applicable');
  const failedBlockers = input.readiness.filter((r) => r.blocker && r.status === 'failed').length;
  const passed = mandatory.filter((r) => r.status === 'passed' || r.status === 'waived').length;
  const ops: DimensionState = (() => {
    if (input.standaloneAccepted) return { key: 'operational_readiness', state: 'standalone_accepted', explanation: 'Standalone operations accepted (G4).' };
    if (mandatory.length === 0) return { key: 'operational_readiness', state: 'not_assessed', explanation: 'No mandatory readiness checks defined.' };
    if (failedBlockers > 0) return { key: 'operational_readiness', state: 'blocked', explanation: `${failedBlockers} blocking readiness check(s) failed.` };
    if (passed === mandatory.length) return { key: 'operational_readiness', state: 'day1_ready', explanation: 'All mandatory readiness checks passed.' };
    return { key: 'operational_readiness', state: 'in_progress', explanation: `${passed} of ${mandatory.length} mandatory checks passed.` };
  })();

  const signing = input.closings.filter((c) => c.kind === 'signing');
  const closing = input.closings.filter((c) => c.kind === 'closing');
  const jv: DimensionState = (() => {
    const closingsConfirmed = closing.filter((c) => c.status === 'confirmed').length;
    if (closing.length > 0 && closingsConfirmed === closing.length) return { key: 'jv_transaction', state: 'closed', explanation: `All ${closing.length} closing(s) confirmed.` };
    if (closingsConfirmed > 0) return { key: 'jv_transaction', state: 'partially_closed', explanation: `${closingsConfirmed} of ${closing.length} closing(s) confirmed.` };
    if (signing.some((s) => s.status === 'confirmed')) return { key: 'jv_transaction', state: 'signed', explanation: 'Signing confirmed; closing pending.' };
    if (signing.length + closing.length > 0) return { key: 'jv_transaction', state: 'preparing', explanation: 'Signing/closing in preparation.' };
    return { key: 'jv_transaction', state: 'not_started', explanation: 'No signing/closing events defined.' };
  })();

  return [inc, perimeter, ops, jv];
}

/** AT-06: the carve-out is complete only when every dimension reaches its terminal state. */
export function isCarveOutComplete(dims: DimensionState[]): boolean {
  const s = Object.fromEntries(dims.map((d) => [d.key, d.state]));
  return (
    s['incorporation'] === 'incorporated_verified' &&
    s['perimeter_transfer'] === 'transferred_verified' &&
    s['operational_readiness'] === 'standalone_accepted'
  );
}

// ---------------------------------------------------------------------------------------------------------
// Perimeter reconciliation (spec §7.1)

export interface PerimeterReconItem {
  id: string;
  code: string;
  disposition: PerimeterDisposition;
  transferStatus: TransferStatus;
  transferMechanism: string | null;
  plannedEffectiveDate: string | null;
  consentRequired: boolean;
  consentGranted: boolean;
  evidenceCount: number;
  hasInterimArrangement: boolean;
}

export interface ReconFinding {
  itemId: string;
  code: string;
  issue: 'no_transfer_plan' | 'no_evidence' | 'pending_disposition' | 'consent_outstanding';
  message: string;
}

export function reconcilePerimeter(items: PerimeterReconItem[]): ReconFinding[] {
  const out: ReconFinding[] = [];
  for (const it of items) {
    if (it.disposition === 'pending') {
      out.push({ itemId: it.id, code: it.code, issue: 'pending_disposition', message: 'Disposition (included/excluded/shared) not decided' });
      continue;
    }
    if (it.disposition === 'excluded') continue;
    if (it.transferStatus !== 'not_applicable' && (!it.transferMechanism || !it.plannedEffectiveDate)) {
      out.push({ itemId: it.id, code: it.code, issue: 'no_transfer_plan', message: 'No transfer mechanism and/or planned effective date' });
    }
    if ((it.transferStatus === 'transferred_pending_evidence' || it.transferStatus === 'transferred_verified') && it.evidenceCount === 0) {
      out.push({ itemId: it.id, code: it.code, issue: 'no_evidence', message: 'Reported transferred without acceptance evidence' });
    }
    if (it.consentRequired && !it.consentGranted && !it.hasInterimArrangement) {
      out.push({ itemId: it.id, code: it.code, issue: 'consent_outstanding', message: 'Consent required, not granted, and no interim arrangement' });
    }
  }
  return out;
}

/** AT-07: changes to an item that belongs to an approved baseline perimeter require a change request. */
export function perimeterChangeRequiresChangeRequest(opts: { baselineApproved: boolean; itemInBaseline: boolean; isNewItem: boolean }): boolean {
  return opts.baselineApproved && (opts.itemInBaseline || opts.isNewItem);
}

// ---------------------------------------------------------------------------------------------------------
// Contracts that cannot transfer on Day 1 (AT-08)

export function assertDay1ContractPosition(c: {
  transferClass: ContractTransferClass;
  consentGranted: boolean;
  interimArrangement: string | null;
  serviceAccountableOwner: string | null;
  billingAccountableOwner: string | null;
  slaAccountableOwner: string | null;
  remediationPlan: string | null;
}): { ok: true } | { ok: false; missing: string[] } {
  if (c.transferClass === 'transferable' || c.transferClass === 'retain') return { ok: true };
  if ((c.transferClass === 'consent_required' || c.transferClass === 'novation_required') && c.consentGranted) return { ok: true };
  const missing: string[] = [];
  if (!c.interimArrangement?.trim()) missing.push('interimArrangement');
  if (!c.serviceAccountableOwner) missing.push('serviceAccountableOwner');
  if (!c.billingAccountableOwner) missing.push('billingAccountableOwner');
  if (!c.slaAccountableOwner) missing.push('slaAccountableOwner');
  if (!c.remediationPlan?.trim()) missing.push('remediationPlan');
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

// ---------------------------------------------------------------------------------------------------------
// Day-1 go/no-go (AT-09)

export function goDecisionBlockers(checks: { id: string; title: string; mandatory: boolean; blocker: boolean; status: ReadinessStatus }[]) {
  return checks
    .filter((c) => (c.blocker || c.mandatory) && !['passed', 'waived', 'not_applicable'].includes(c.status))
    .map((c) => ({ id: c.id, title: c.title, status: c.status, blocker: c.blocker }));
}

export function assertGoAllowed(checks: Parameters<typeof goDecisionBlockers>[0], cutover: { hasRunbook: boolean; hasRollbackPlan: boolean; communicationsApproved: boolean }) {
  const blockers = goDecisionBlockers(checks);
  const missing: string[] = [];
  if (!cutover.hasRunbook) missing.push('runbook');
  if (!cutover.hasRollbackPlan) missing.push('contingency/rollback plan');
  if (!cutover.communicationsApproved) missing.push('approved communications');
  if (blockers.length > 0 || missing.length > 0) {
    throw ruleViolation('readiness.go_blocked', 'A GO decision is blocked by open readiness blockers or missing cutover prerequisites', {
      blockers,
      missing,
    });
  }
}

// ---------------------------------------------------------------------------------------------------------
// TSA expiry (AT-10)

export interface TsaExpiryInput {
  status: TsaStatus;
  endDate: string | null;
  replacementAccepted: boolean;
  today: string;
  warnDays: number;
}

export type TsaExpiryAssessment =
  | { kind: 'ok' }
  | { kind: 'expiring'; daysLeft: number }
  | { kind: 'expired_unresolved'; daysOverdue: number };

export function assessTsaExpiry(i: TsaExpiryInput): TsaExpiryAssessment {
  if (!i.endDate || ['exit_accepted', 'proposed', 'negotiating'].includes(i.status)) return { kind: 'ok' };
  const days = Math.round((Date.parse(i.endDate) - Date.parse(i.today)) / 86_400_000);
  if (days < 0 && !i.replacementAccepted) return { kind: 'expired_unresolved', daysOverdue: -days };
  if (days >= 0 && days <= i.warnDays) return { kind: 'expiring', daysLeft: days };
  return { kind: 'ok' };
}

export function assertTsaExitAcceptable(t: { replacementAccepted: boolean; acceptanceEvidenceCount: number }) {
  if (!t.replacementAccepted || t.acceptanceEvidenceCount === 0) {
    throw ruleViolation('tsa.exit_not_evidenced', 'TSA exit requires an accepted replacement service with acceptance evidence; reaching the end date is not an exit');
  }
}

// ---------------------------------------------------------------------------------------------------------
// JV partner access and closing (AT-11, AT-12)

const STAGE_ORDER: PartnerStage[] = ['identified', 'approved_for_contact', 'nda', 'materials_access', 'dd', 'proposal', 'negotiation', 'signing', 'closing'];

export function partnerStageAtLeast(stage: PartnerStage, min: PartnerStage): boolean {
  if (stage === 'withdrawn') return false;
  return STAGE_ORDER.indexOf(stage) >= STAGE_ORDER.indexOf(min);
}

/** NDA alone never grants materials access: needs stage ≥ materials_access AND an explicit room grant. */
export function partnerMayAccessRoom(p: { stage: PartnerStage; ndaStatus: string; hasActiveRoomGrant: boolean }): boolean {
  return p.ndaStatus === 'executed' && partnerStageAtLeast(p.stage, 'materials_access') && p.hasActiveRoomGrant;
}

export interface ClosingReadinessInput {
  kind: ClosingKind;
  conditions: { id: string; reference: string; blocking: boolean; waivable: boolean; status: ConditionStatus; hasValidWaiver: boolean; longStopDate: string | null }[];
  deliverables: { id: string; title: string; status: 'pending' | 'delivered' | 'verified' | 'not_required' }[];
  signingConfirmed: boolean;
  today: string;
}

export function closingBlockers(i: ClosingReadinessInput): { ref: string; message: string }[] {
  const out: { ref: string; message: string }[] = [];
  if (i.kind === 'closing' && !i.signingConfirmed) out.push({ ref: 'signing', message: 'Signing has not been confirmed' });
  for (const c of i.conditions) {
    if (!c.blocking) continue;
    const satisfied = c.status === 'verified' || (c.status === 'waived' && c.waivable && c.hasValidWaiver);
    if (!satisfied) out.push({ ref: c.reference, message: `Blocking condition ${c.reference} is ${c.status}` });
    if (c.longStopDate && c.longStopDate < i.today && !satisfied) out.push({ ref: c.reference, message: `Long-stop date passed for ${c.reference}` });
  }
  for (const d of i.deliverables) {
    if (d.status !== 'verified' && d.status !== 'not_required') out.push({ ref: d.id, message: `Closing deliverable "${d.title}" not verified` });
  }
  return out;
}
