import { ruleViolation } from './errors';
import { renderMessagesEn, serverMessage, type ServerMessage } from './messages';
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
  /**
   * Legal transfer status + economic transfer status (spec §3 "legal/economic transfer", P0 review D-05). Both are
   * REQUIRED (N-01): a missing economic status fails closed (treated as not started), never as the legal status.
   */
  perimeter: { disposition: PerimeterDisposition; transferStatus: TransferStatus; economicTransferStatus: TransferStatus }[];
  /** `waivedValid` = waivable check with an approved waiver (a bare "waived" status does not count — D-02). */
  readiness: { mandatory: boolean; blocker: boolean; status: ReadinessStatus; waivedValid?: boolean }[];
  standaloneAccepted: boolean; // G4 approved
  /** The G4 approval is flagged for controlled reassessment (relied-upon evidence changed — DOM-P2-05): it does not count. */
  standaloneUnderReassessment?: boolean;
  closings: { kind: ClosingKind; status: ClosingStatus }[];
  /**
   * Stages of the project's partners (partner process) — the `jv_transaction` dimension starts with partner preparation
   * and diligence (business-gates.md §1; DOM-P4-10). Omitted = no partner recorded.
   */
  partners?: { stage: PartnerStage }[];
  /** The current cycle of gate G5 (JV Signing Readiness) is approved and not flagged for reassessment. */
  signingGatePassed?: boolean;
  /** TSAs and approved enduring arrangements affect the independence picture (spec §3, D-15). */
  tsas?: { status: TsaStatus; isEnduringArrangement: boolean }[];
  /** Whether the approved definition of operational independence exists (spec §3). */
  independenceDefinitionApproved?: boolean;
  /**
   * DOM-P3-12 (business-gates.md §1 "What moves it"): an approved perimeter version exists (the perimeter is approved).
   * Omitted = not approved.
   */
  perimeterApproved?: boolean;
  /**
   * DOM-P3-12: the project's transition (cutover) plans — the Day-1 GO and the post-transition acceptance move the
   * operational dimension. `goFlagged` = the plan is at approved_go while one of its gating checks is open again
   * (DOM-P3-04). Omitted = no plan (no GO).
   */
  cutoverPlans?: { status: CutoverPlanStatus; goFlagged: boolean }[];
}

/** Cutover-plan status values (mirrors CUTOVER_STATUSES; kept local to avoid a dependency cycle with readiness.ts). */
type CutoverPlanStatus = 'planning' | 'rehearsal' | 'ready_for_decision' | 'approved_go' | 'no_go' | 'executed' | 'accepted' | 'rolled_back';

/**
 * The state vocabulary of each dimension — business-gates.md §1 and the dc-carveout template `statusDimensions` carry the
 * same keys (DOM-P3-12; `p3-domain-dimensions.spec.ts` / `rules.test.ts` check that the rule produces only these and can
 * produce each of them). `blocked` is an exception state shown instead of the progression while a blocker is open.
 */
export const DIMENSION_STATES = {
  incorporation: ['not_started', 'unconfirmed', 'in_progress', 'incorporated_evidence_pending', 'incorporated_verified', 'not_applicable'],
  perimeter_transfer: ['perimeter_draft', 'not_started', 'perimeter_approved', 'transfer_in_progress', 'partially_transferred', 'transferred_evidence_pending', 'transferred_verified', 'blocked'],
  operational_readiness: ['not_assessed', 'readiness_in_progress', 'day1_go_approved', 'operating_with_transitional_services', 'standalone_accepted', 'transitional_services_exited', 'blocked'],
  jv_transaction: ['not_started', 'partner_preparation', 'diligence_and_negotiation', 'signing_ready', 'signed', 'closing_conditions_in_progress', 'partially_closed', 'closed', 'terminated'],
} as const satisfies Record<'incorporation' | 'perimeter_transfer' | 'operational_readiness' | 'jv_transaction', readonly string[]>;

export interface DimensionState {
  key: 'incorporation' | 'perimeter_transfer' | 'operational_readiness' | 'jv_transaction';
  state: string;
  /** English sentence(s) — kept for audit rows, record history and AI context; rendered from `explanationI18n`. */
  explanation: string;
  /** The same explanation as translatable codes + parameters (QA-P1-14); clients translate `gates.messages.<code>`. */
  explanationI18n: ServerMessage[];
  counts?: Record<string, number>;
}

/**
 * English templates of every status-dimension message code. The web catalogue (`gates.messages.dimension.*`, en + ar)
 * carries the same codes and placeholders.
 */
export const DIMENSION_MESSAGES_EN: Readonly<Record<string, string>> = {
  'dimension.not_yet_assessed': 'Not yet assessed',
  'dimension.incorporation.no_entity': 'No NewCo legal entity recorded.',
  'dimension.incorporation.verified': 'Incorporation confirmed with verified evidence.',
  'dimension.incorporation.unverified': 'Reported incorporated; evidence not yet verified.',
  /** `status` is an incorporation status enum value. */
  'dimension.incorporation.status': 'Incorporation status: {status}.',
  'dimension.perimeter.not_defined': 'No included/shared perimeter items.',
  'dimension.perimeter.blocked': '{blocked} perimeter item(s) blocked.',
  'dimension.perimeter.verified': 'All in-scope items transferred with verified evidence.',
  'dimension.perimeter.in_progress': '{verified} of {inScope} in-scope items verified; {pending} item(s) with pending disposition.',
  'dimension.perimeter.not_started': '{inScope} in-scope items; none transferred.',
  'dimension.perimeter.approved': 'Perimeter version approved; {inScope} in-scope item(s), transfer not started.',
  'dimension.perimeter.evidence_pending': 'All {inScope} in-scope items reported transferred; {pendingEvidence} awaiting evidence verification.',
  'dimension.perimeter.not_applicable_in_scope': '{notApplicable} in-scope item(s) with neither a legal nor an economic transfer — reclassify them or plan the transfer.',
  'dimension.perimeter.aspect_not_applicable': '{aspects} in-scope item(s) with one transfer aspect determined not applicable.',
  'dimension.readiness.standalone_accepted': 'Standalone operations accepted (G4).',
  'dimension.readiness.standalone_reassessment': 'The standalone acceptance (G4) is under controlled reassessment: evidence it relied upon changed.',
  'dimension.readiness.tsa_blocked': '{tsaProblems} TSA(s) breached or expired without an accepted exit.',
  'dimension.readiness.no_checks': 'No mandatory readiness checks defined.',
  'dimension.readiness.blockers_failed': '{failedBlockers} blocking readiness check(s) failed or improperly waived.',
  'dimension.readiness.all_passed': 'All mandatory readiness checks passed.',
  'dimension.readiness.in_progress': '{passed} of {required} mandatory/blocking checks cleared.',
  'dimension.readiness.go_pending': '{go} of {plans} transition plan(s) with an approved Day-1 GO.',
  'dimension.readiness.go_flagged': '{flagged} GO decision(s) flagged: a gating readiness check is open again.',
  'dimension.readiness.go_approved': 'Day-1 GO approved for every transition plan ({plans}).',
  'dimension.readiness.operating': 'Every transition executed and accepted ({plans}); operating until standalone acceptance (G4).',
  'dimension.readiness.services_exited': 'No transitional service left to exit.',
  'dimension.readiness.dependencies': 'Dependencies: {active} transitional service(s) not yet exited, {enduring} approved enduring arrangement(s).',
  'dimension.readiness.definition_pending': 'The definition of operational independence is not yet approved.',
  'dimension.jv.closed': 'All {closings} closing(s) confirmed.',
  'dimension.jv.partially_closed': '{confirmed} of {closings} closing(s) confirmed.',
  'dimension.jv.closing_conditions_in_progress': 'Signing confirmed; {inProgress} closing(s) in preparation (conditions precedent being satisfied).',
  'dimension.jv.signed': 'Signing confirmed; closing pending.',
  'dimension.jv.signing_ready': 'Gate G5 (JV Signing Readiness) approved; the signing is not yet recorded.',
  'dimension.jv.diligence_and_negotiation': 'Due diligence, negotiation or signing preparation in progress.',
  'dimension.jv.partner_preparation': 'Partner preparation in progress (before due diligence).',
  'dimension.jv.terminated': 'Every partner withdrawn and every signing / closing aborted.',
  'dimension.jv.aborted_excluded': '{aborted} aborted signing / closing event(s) not counted.',
  'dimension.jv.not_started': 'No partner, signing or closing recorded.',
};

/** Message of a dimension that has never been computed (created with the project). */
export const DIMENSION_NOT_YET_ASSESSED: ServerMessage[] = [serverMessage('dimension.not_yet_assessed')];

function dimension(key: DimensionState['key'], state: string, messages: ServerMessage[], counts?: Record<string, number>): DimensionState {
  return { key, state, explanation: renderMessagesEn(messages, DIMENSION_MESSAGES_EN), explanationI18n: messages, ...(counts ? { counts } : {}) };
}

const TRANSFER_RANK: Record<TransferStatus, number> = {
  blocked: 0,
  not_started: 1,
  planned: 2,
  in_progress: 3,
  transferred_pending_evidence: 4,
  transferred_verified: 5,
  not_applicable: 6,
};

/** Legal + economic transfer combine to the LEAST advanced of the two (blocked dominates). */
export function combinedTransferStatus(legal: TransferStatus, economic: TransferStatus): TransferStatus {
  if (legal === 'not_applicable') return economic;
  if (economic === 'not_applicable') return legal;
  return TRANSFER_RANK[legal] <= TRANSFER_RANK[economic] ? legal : economic;
}

export function computeStatusDimensions(input: DimensionInput): DimensionState[] {
  const m = serverMessage;
  // DOM-P3-12: the states of business-gates.md §1 / the template (`DIMENSION_STATES`).
  const inc: DimensionState = (() => {
    if (!input.newcoIncorporation) return dimension('incorporation', 'not_started', [m('dimension.incorporation.no_entity')]);
    const { status, evidenceVerified } = input.newcoIncorporation;
    if (status === 'incorporated' && evidenceVerified) return dimension('incorporation', 'incorporated_verified', [m('dimension.incorporation.verified')]);
    if (status === 'incorporated') return dimension('incorporation', 'incorporated_evidence_pending', [m('dimension.incorporation.unverified')]);
    const state = status === 'incorporation_in_progress' ? 'in_progress' : status; // unconfirmed | not_applicable
    return dimension('incorporation', state, [m('dimension.incorporation.status', { status })]);
  })();

  const inScopeRaw = input.perimeter.filter((p) => p.disposition === 'included' || p.disposition === 'shared');
  const inScope = inScopeRaw.map((p) => ({ ...p, transferStatus: combinedTransferStatus(p.transferStatus ?? 'not_started', p.economicTransferStatus ?? 'not_started') }));
  const counts: Record<string, number> = {};
  for (const p of inScope) counts[p.transferStatus] = (counts[p.transferStatus] ?? 0) + 1;
  const pending = input.perimeter.filter((p) => p.disposition === 'pending').length;
  const verified = counts['transferred_verified'] ?? 0;
  const pendingEvidence = counts['transferred_pending_evidence'] ?? 0;
  const blocked = counts['blocked'] ?? 0;
  // DOM-P3-05: an in-scope item with no transfer at all (both aspects "not applicable") never counts as transferred; one
  // aspect not applicable is disclosed.
  const naInScope = counts['not_applicable'] ?? 0;
  const oneAspectNa = inScopeRaw.filter((p) => (p.transferStatus === 'not_applicable') !== (p.economicTransferStatus === 'not_applicable')).length;
  const naNotes: ServerMessage[] = [
    ...(naInScope > 0 ? [m('dimension.perimeter.not_applicable_in_scope', { notApplicable: naInScope })] : []),
    ...(oneAspectNa > 0 ? [m('dimension.perimeter.aspect_not_applicable', { aspects: oneAspectNa })] : []),
  ];
  const perimeter: DimensionState = (() => {
    const k = 'perimeter_transfer' as const;
    if (inScope.length === 0) return dimension(k, 'perimeter_draft', [m('dimension.perimeter.not_defined')], counts);
    if (blocked > 0) return dimension(k, 'blocked', [m('dimension.perimeter.blocked', { blocked }), ...naNotes], counts);
    if (verified === inScope.length && pending === 0) return dimension(k, 'transferred_verified', [m('dimension.perimeter.verified'), ...naNotes], counts);
    if (verified + pendingEvidence === inScope.length && pending === 0) {
      return dimension(k, 'transferred_evidence_pending', [m('dimension.perimeter.evidence_pending', { inScope: inScope.length, pendingEvidence }), ...naNotes], counts);
    }
    // Some in-scope items transferred (reported or verified), others not yet → partially transferred; transfer work started
    // (in progress) but nothing transferred yet → transfer in progress.
    if (verified > 0 || pendingEvidence > 0) {
      return dimension(k, 'partially_transferred', [m('dimension.perimeter.in_progress', { verified, inScope: inScope.length, pending }), ...naNotes], counts);
    }
    if ((counts['in_progress'] ?? 0) > 0) {
      return dimension(k, 'transfer_in_progress', [m('dimension.perimeter.in_progress', { verified, inScope: inScope.length, pending }), ...naNotes], counts);
    }
    if (input.perimeterApproved === true) return dimension(k, 'perimeter_approved', [m('dimension.perimeter.approved', { inScope: inScope.length }), ...naNotes], counts);
    return dimension(k, 'not_started', [m('dimension.perimeter.not_started', { inScope: inScope.length }), ...naNotes], counts);
  })();

  // Blockers count even when not flagged mandatory (D-15b); "waived" counts only as a valid waiver (D-02).
  const required = input.readiness.filter((r) => (r.mandatory || r.blocker) && r.status !== 'not_applicable');
  const cleared = (r: DimensionInput['readiness'][number]) => r.status === 'passed' || (r.status === 'waived' && r.waivedValid === true);
  const failedBlockers = input.readiness.filter((r) => r.blocker && (r.status === 'failed' || (r.status === 'waived' && r.waivedValid !== true))).length;
  const passed = required.filter(cleared).length;
  const tsas = input.tsas ?? [];
  const tsaProblems = tsas.filter((t) => t.status === 'breached' || t.status === 'expired_unresolved').length;
  const tsaActive = tsas.filter((t) => !t.isEnduringArrangement && ['approved', 'active', 'exit_in_progress', 'extended', 'breached', 'expired_unresolved'].includes(t.status)).length;
  // DOM-P3-15: an enduring arrangement counts as APPROVED only once its terms are approved (not while proposed / negotiating).
  const enduring = tsas.filter((t) => t.isEnduringArrangement && t.status !== 'proposed' && t.status !== 'negotiating').length;
  const dep: ServerMessage[] = tsas.length ? [m('dimension.readiness.dependencies', { active: tsaActive, enduring })] : [];
  const def: ServerMessage[] = input.independenceDefinitionApproved === false ? [m('dimension.readiness.definition_pending')] : [];
  const reassess: ServerMessage[] = input.standaloneAccepted && input.standaloneUnderReassessment ? [m('dimension.readiness.standalone_reassessment')] : [];
  const tsaMsg: ServerMessage[] = tsaProblems > 0 ? [m('dimension.readiness.tsa_blocked', { tsaProblems })] : [];
  // DOM-P3-12: the Day-1 GO and the post-transition acceptance move the dimension ("never Day-1 ready without a GO").
  const plans = input.cutoverPlans ?? [];
  const flagged = plans.filter((p) => p.goFlagged).length;
  const withGo = plans.filter((p) => !p.goFlagged && (p.status === 'approved_go' || p.status === 'executed' || p.status === 'accepted')).length;
  const accepted = plans.filter((p) => p.status === 'accepted').length;
  const goMsg: ServerMessage[] = [...(plans.length ? [m('dimension.readiness.go_pending', { go: withGo, plans: plans.length })] : []), ...(flagged ? [m('dimension.readiness.go_flagged', { flagged })] : [])];
  const ops: DimensionState = (() => {
    const k = 'operational_readiness' as const;
    if (input.standaloneAccepted && !input.standaloneUnderReassessment) {
      // DOM-P3-11: after G4 an expired-unresolved or breached TSA stays visible and keeps the carve-out incomplete; the
      // terminal state needs every transitional service exited (approved enduring arrangements excepted).
      if (tsaProblems > 0 || tsaActive > 0) return dimension(k, 'standalone_accepted', [m('dimension.readiness.standalone_accepted'), ...tsaMsg, ...dep]);
      return dimension(k, 'transitional_services_exited', [m('dimension.readiness.standalone_accepted'), m('dimension.readiness.services_exited'), ...dep]);
    }
    if (tsaProblems > 0) return dimension(k, 'blocked', [...reassess, ...tsaMsg, ...dep]);
    if (required.length === 0) return dimension(k, 'not_assessed', [...reassess, m('dimension.readiness.no_checks'), ...dep, ...def]);
    if (failedBlockers > 0) return dimension(k, 'blocked', [...reassess, m('dimension.readiness.blockers_failed', { failedBlockers }), ...goMsg, ...dep]);
    if (passed === required.length && plans.length > 0 && accepted === plans.length) {
      return dimension(k, 'operating_with_transitional_services', [...reassess, m('dimension.readiness.operating', { plans: plans.length }), ...dep, ...def]);
    }
    if (passed === required.length && plans.length > 0 && withGo === plans.length) {
      return dimension(k, 'day1_go_approved', [...reassess, m('dimension.readiness.all_passed'), m('dimension.readiness.go_approved', { plans: plans.length }), ...dep, ...def]);
    }
    if (passed === required.length) return dimension(k, 'readiness_in_progress', [...reassess, m('dimension.readiness.all_passed'), ...goMsg, ...dep, ...def]);
    return dimension(k, 'readiness_in_progress', [...reassess, m('dimension.readiness.in_progress', { passed, required: required.length }), ...goMsg, ...dep, ...def]);
  })();

  const jv: DimensionState = (() => {
    // DOM-P4-10 (business-gates.md §1): not_started → partner_preparation → diligence_and_negotiation → signing_ready →
    // signed → closing_conditions_in_progress → partially_closed → closed; or terminated. Aborted events are not counted
    // (one confirmed and one aborted closing is `closed`), and they are disclosed in the explanation.
    const k = 'jv_transaction' as const;
    const live = input.closings.filter((c) => c.status !== 'aborted');
    const aborted = input.closings.length - live.length;
    const note = aborted > 0 ? [m('dimension.jv.aborted_excluded', { aborted })] : [];
    const signing = live.filter((c) => c.kind === 'signing');
    const closing = live.filter((c) => c.kind === 'closing');
    const closingsConfirmed = closing.filter((c) => c.status === 'confirmed').length;
    if (closing.length > 0 && closingsConfirmed === closing.length) return dimension(k, 'closed', [m('dimension.jv.closed', { closings: closing.length }), ...note]);
    if (closingsConfirmed > 0) return dimension(k, 'partially_closed', [m('dimension.jv.partially_closed', { confirmed: closingsConfirmed, closings: closing.length }), ...note]);
    if (signing.some((s) => s.status === 'confirmed')) {
      const inProgress = closing.filter((c) => c.status === 'in_preparation' || c.status === 'ready_for_confirmation').length;
      if (inProgress > 0) return dimension(k, 'closing_conditions_in_progress', [m('dimension.jv.closing_conditions_in_progress', { inProgress }), ...note]);
      return dimension(k, 'signed', [m('dimension.jv.signed'), ...note]);
    }
    const partners = input.partners ?? [];
    const activePartners = partners.filter((p) => p.stage !== 'withdrawn');
    if ((partners.length > 0 || input.closings.length > 0) && activePartners.length === 0 && live.length === 0) return dimension(k, 'terminated', [m('dimension.jv.terminated'), ...note]);
    if (input.signingGatePassed) return dimension(k, 'signing_ready', [m('dimension.jv.signing_ready'), ...note]);
    if (live.length > 0 || activePartners.some((p) => partnerStageAtLeast(p.stage, 'dd'))) return dimension(k, 'diligence_and_negotiation', [m('dimension.jv.diligence_and_negotiation'), ...note]);
    if (activePartners.length > 0) return dimension(k, 'partner_preparation', [m('dimension.jv.partner_preparation'), ...note]);
    return dimension(k, 'not_started', [m('dimension.jv.not_started'), ...note]);
  })();

  return [inc, perimeter, ops, jv];
}

/**
 * AT-06: the carve-out is complete only when every dimension reaches its terminal state — incorporation verified, the
 * perimeter transferred with verified evidence, and standalone operation accepted with every transitional service exited
 * (DOM-P3-11 / DOM-P3-12: never while a TSA is still running, breached or expired without an accepted exit).
 */
export function isCarveOutComplete(dims: DimensionState[]): boolean {
  const s = Object.fromEntries(dims.map((d) => [d.key, d.state]));
  return (
    s['incorporation'] === 'incorporated_verified' &&
    s['perimeter_transfer'] === 'transferred_verified' &&
    s['operational_readiness'] === 'transitional_services_exited'
  );
}

// ---------------------------------------------------------------------------------------------------------
// Perimeter reconciliation (spec §7.1)

export interface PerimeterReconItem {
  id: string;
  code: string;
  disposition: PerimeterDisposition;
  /** Legal transfer status. */
  transferStatus: TransferStatus;
  /** Economic transfer status (D-05) — reconciliation uses the combined (least advanced) status. */
  economicTransferStatus: TransferStatus;
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
  issue: 'no_transfer_plan' | 'no_evidence' | 'pending_disposition' | 'consent_outstanding' | 'transfer_not_applicable';
  /** English sentence (audit, AI context). */
  message: string;
  /** The same sentence as codes + parameters, translated by the client (QA-P34-01a; web `carveout.messages`). */
  messageI18n: ServerMessage[];
}

/**
 * English templates of the perimeter reconciliation findings (REQ-PER-003 / REQ-PER-006). The web catalogue
 * `carveout.messages.perimeter.recon.*` (en + ar) carries the same codes and placeholders. `{missing}` is a comma-separated
 * list of Day-1 position gap keys (translated one by one by the client).
 */
export const RECON_MESSAGES_EN: Readonly<Record<string, string>> = {
  'perimeter.recon.pending_disposition': 'Disposition (included/excluded/shared) not decided',
  'perimeter.recon.no_transfer_plan': 'No transfer mechanism and/or planned effective date',
  'perimeter.recon.not_applicable_both': 'Included / shared item with neither a legal nor an economic transfer — reclassify it through the scope change or plan the transfer',
  'perimeter.recon.not_applicable_legal': 'Legal transfer determined not applicable — the item transfers on the other aspect only',
  'perimeter.recon.not_applicable_economic': 'Economic transfer determined not applicable — the item transfers on the other aspect only',
  'perimeter.recon.no_evidence': 'Reported transferred without acceptance evidence',
  'perimeter.recon.consent_outstanding': 'Consent required, not granted, and no interim arrangement',
  'perimeter.recon.pending_without_resolution': 'Pending item without owner, resolution path and target resolution gate (G1-C03)',
  'perimeter.recon.day1_position_incomplete': 'Day-1 contract position incomplete: {missing}',
  'perimeter.recon.change_request_pending': 'A scope change awaits change-request decision',
};

/** A finding with its English sentence and its codes, rendered from {@link RECON_MESSAGES_EN}. */
export function reconFinding<I extends string>(itemId: string, code: string, issue: I, messageCode: string, params: Record<string, string | number> = {}) {
  const msg = serverMessage(messageCode, params);
  return { itemId, code, issue, message: renderMessagesEn([msg], RECON_MESSAGES_EN), messageI18n: [msg] };
}

export function reconcilePerimeter(items: PerimeterReconItem[]): ReconFinding[] {
  const out: ReconFinding[] = [];
  for (const it of items) {
    if (it.disposition === 'pending') {
      out.push(reconFinding(it.id, it.code, 'pending_disposition', 'perimeter.recon.pending_disposition'));
      continue;
    }
    if (it.disposition === 'excluded') continue;
    const legal = it.transferStatus ?? 'not_started';
    const economic = it.economicTransferStatus ?? 'not_started'; // N-01: omitted → fails closed
    const combined = combinedTransferStatus(legal, economic);
    if (combined !== 'not_applicable' && (!it.transferMechanism || !it.plannedEffectiveDate)) {
      out.push(reconFinding(it.id, it.code, 'no_transfer_plan', 'perimeter.recon.no_transfer_plan'));
    }
    // DOM-P3-05: an in-scope item with a "not applicable" aspect is reported — it never reads as transferred on that aspect;
    // with both aspects not applicable nothing transfers at all (reclassify it through the scope change).
    if (legal === 'not_applicable' || economic === 'not_applicable') {
      const both = legal === 'not_applicable' && economic === 'not_applicable';
      out.push(
        reconFinding(it.id, it.code, 'transfer_not_applicable', both ? 'perimeter.recon.not_applicable_both' : legal === 'not_applicable' ? 'perimeter.recon.not_applicable_legal' : 'perimeter.recon.not_applicable_economic'),
      );
    }
    const reported = (s: TransferStatus) => s === 'transferred_pending_evidence' || s === 'transferred_verified';
    if ((reported(legal) || reported(economic)) && it.evidenceCount === 0) {
      out.push(reconFinding(it.id, it.code, 'no_evidence', 'perimeter.recon.no_evidence'));
    }
    if (it.consentRequired && !it.consentGranted && !it.hasInterimArrangement) {
      out.push(reconFinding(it.id, it.code, 'consent_outstanding', 'perimeter.recon.consent_outstanding'));
    }
  }
  return out;
}

/**
 * AT-07 / REQ-PER-002/005: once a baseline (planning baseline or approved perimeter version) is approved, a change
 * request is required to ADD any item, to change the scope of an item that is in the approved baseline, or to move an
 * item into or out of the transferring scope (included/shared). All inputs are required (N-01); a missing flag fails
 * closed (treated as "baseline approved" / "new" / "in baseline").
 */
export function perimeterChangeRequiresChangeRequest(opts: {
  baselineApproved: boolean;
  itemInBaseline: boolean;
  isNewItem: boolean;
  /** Disposition before the change (null for a new item). */
  fromDisposition: PerimeterDisposition | null;
  /** Disposition after the change. */
  toDisposition: PerimeterDisposition;
}): boolean {
  if (opts.baselineApproved === false) return false;
  if (opts.isNewItem !== false || opts.itemInBaseline !== false) return true;
  const inScope = (d: PerimeterDisposition | null | undefined) => d === 'included' || d === 'shared' || d === undefined;
  return inScope(opts.fromDisposition) || inScope(opts.toDisposition);
}

// ---------------------------------------------------------------------------------------------------------
// Contracts that cannot transfer on Day 1 (AT-08)

export function assertDay1ContractPosition(c: {
  transferClass: ContractTransferClass;
  /** Specialist who assessed the class; unassessed classes are not accepted (P0 review D-17). Required (N-01). */
  classAssessedBy: string | null;
  consentGranted: boolean;
  interimArrangement: string | null;
  serviceAccountableOwner: string | null;
  billingAccountableOwner: string | null;
  slaAccountableOwner: string | null;
  remediationPlan: string | null;
}): { ok: true } | { ok: false; missing: string[] } {
  const assessed = !!c.classAssessedBy?.trim() && c.transferClass !== 'unknown';
  if (assessed && (c.transferClass === 'transferable' || c.transferClass === 'retain')) return { ok: true };
  if (assessed && (c.transferClass === 'consent_required' || c.transferClass === 'novation_required') && c.consentGranted) return { ok: true };
  const missing: string[] = [];
  if (!assessed) missing.push('specialistClassification');
  if (!c.interimArrangement?.trim()) missing.push('interimArrangement');
  if (!c.serviceAccountableOwner) missing.push('serviceAccountableOwner');
  if (!c.billingAccountableOwner) missing.push('billingAccountableOwner');
  if (!c.slaAccountableOwner) missing.push('slaAccountableOwner');
  if (!c.remediationPlan?.trim()) missing.push('remediationPlan');
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

// ---------------------------------------------------------------------------------------------------------
// Day-1 go/no-go (AT-09)

/**
 * Open gating checks of a GO. DOM-P3-09 (business-gates.md §4 rule 9 applied to Day-1 sign-offs; REQ-RDY-001 "signed off on
 * evidence"): a `passed` check counts as cleared only while its sign-off evidence is still ACTIVE and not conflicting
 * (`signoffEvidenceValid === true` — anything else fails closed); a passed check whose evidence was rejected, superseded or
 * contested is listed with `evidenceInvalid: true`.
 */
export function goDecisionBlockers(
  checks: { id: string; title: string; titleAr?: string | null; mandatory: boolean; blocker: boolean; status: ReadinessStatus; waivable?: boolean; hasApprovedWaiver?: boolean; signoffEvidenceValid?: boolean }[],
) {
  const cleared = (c: (typeof checks)[number]) =>
    (c.status === 'passed' && c.signoffEvidenceValid === true) || c.status === 'not_applicable' || (c.status === 'waived' && c.waivable === true && c.hasApprovedWaiver === true);
  return checks
    .filter((c) => (c.blocker || c.mandatory) && !cleared(c))
    .map((c) => ({
      id: c.id,
      title: c.title,
      // QA-P34-01e: the Arabic title travels with the blocker (shown by the Arabic UI; English stays the evaluated text).
      ...(c.titleAr !== undefined ? { titleAr: c.titleAr } : {}),
      status: c.status,
      blocker: c.blocker,
      ...(c.status === 'passed' ? { evidenceInvalid: true } : {}),
    }));
}

/**
 * The §7.4 transition elements a GO needs. Every field is REQUIRED (domain review N-01: an omitted input must never
 * weaken the guard), and a GO additionally needs the approved governance go/no-go decision (REQ-RDY-004).
 */
export interface CutoverPrerequisites {
  hasRunbook: boolean;
  /** Contingency AND rollback plan documented (§7.4 "contingency/rollback"; AT-09 shows the contingency runbook). */
  hasRollbackPlan: boolean;
  communicationsApproved: boolean;
  /** §7.4: window, service-impact assessment, accountable owner and testing are also mandatory (D-14). */
  hasWindow: boolean;
  hasServiceImpact: boolean;
  hasAccountableOwner: boolean;
  testingDone: boolean;
  /** A FINAL approved governance decision authorizing the go-live is linked (the platform records authority; AT-04). */
  hasApprovedGoDecision: boolean;
}

/** Missing §7.4 prerequisites (labels) — `includeDecision` = false when checking a plan before it goes to decision. */
export function missingCutoverPrerequisites(cutover: CutoverPrerequisites, opts: { includeDecision: boolean } = { includeDecision: true }): string[] {
  const missing: string[] = [];
  // `!== true` so that a value that is not an explicit `true` (e.g. undefined from an untyped caller) fails closed.
  if (cutover.hasRunbook !== true) missing.push('runbook');
  if (cutover.hasRollbackPlan !== true) missing.push('contingency/rollback plan');
  if (cutover.communicationsApproved !== true) missing.push('approved communications');
  if (cutover.hasWindow !== true) missing.push('transition window');
  if (cutover.hasServiceImpact !== true) missing.push('service-impact assessment');
  if (cutover.hasAccountableOwner !== true) missing.push('accountable owner');
  if (cutover.testingDone !== true) missing.push('testing / rehearsal');
  if (opts.includeDecision && cutover.hasApprovedGoDecision !== true) missing.push('approved go/no-go decision');
  return missing;
}

export function assertGoAllowed(checks: Parameters<typeof goDecisionBlockers>[0], cutover: CutoverPrerequisites) {
  const blockers = goDecisionBlockers(checks);
  const missing = missingCutoverPrerequisites(cutover);
  if (blockers.length > 0 || missing.length > 0) {
    throw ruleViolation('readiness.go_blocked', 'A GO decision is blocked by open readiness blockers or missing cutover prerequisites', {
      blockers,
      missing,
    });
  }
}

/**
 * Readiness checks may be waived only if a specialist flagged them waivable, the approver holds the specialist-set
 * waiver authority role, the approver is not the requester, and the basis AND impact are documented (spec §3 "record
 * every waiver's basis, approval, and impact"; AT-13; domain review N-02 — mirrors the gate `assertWaiverAllowed`).
 */
export function assertReadinessWaiverAllowed(c: {
  checkCode?: string;
  waivable: boolean;
  blocker: boolean;
  waiverAuthorityRole: string | null;
  approverRoles: string[];
  approverUserId: string;
  requesterUserId: string;
  basis: string;
  impact: string;
}) {
  const label = c.checkCode ? `Readiness check ${c.checkCode}` : 'This readiness check';
  if (!c.waivable) throw ruleViolation('readiness.waiver.non_waivable', `${label} is not waivable`);
  if (!c.waiverAuthorityRole || !c.approverRoles.includes(c.waiverAuthorityRole)) {
    throw ruleViolation('readiness.waiver.unauthorized', `A waiver of ${label.toLowerCase()} requires the ${c.waiverAuthorityRole ?? 'designated (not yet determined)'} waiver authority`);
  }
  if (c.approverUserId === c.requesterUserId) throw ruleViolation('readiness.waiver.self_approval', 'A waiver cannot be approved by its requester');
  if (!c.basis.trim() || !c.impact.trim()) throw ruleViolation('readiness.waiver.missing_basis', 'A waiver requires a documented basis and impact');
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
  | { kind: 'expired_unresolved'; daysOverdue: number }
  /** End date passed, replacement accepted, but the exit itself is not yet approved (P0 review D-25). Not an exit. */
  | { kind: 'exit_acceptance_pending'; daysOverdue: number };

export function assessTsaExpiry(i: TsaExpiryInput): TsaExpiryAssessment {
  if (!i.endDate || ['exit_accepted', 'proposed', 'negotiating'].includes(i.status)) return { kind: 'ok' };
  const days = Math.round((Date.parse(i.endDate) - Date.parse(i.today)) / 86_400_000);
  if (days < 0 && !i.replacementAccepted) return { kind: 'expired_unresolved', daysOverdue: -days };
  if (days < 0) return { kind: 'exit_acceptance_pending', daysOverdue: -days };
  if (days <= i.warnDays) return { kind: 'expiring', daysLeft: days };
  return { kind: 'ok' };
}

/** No automatic extension: an extension needs an approved decision reference (P0 review D-06). */
export function assertTsaExtensionAllowed(t: { extensionDecisionApproved: boolean; newEndDate: string | null; continuityPlan: string | null }) {
  if (!t.extensionDecisionApproved) throw ruleViolation('tsa.extension_requires_decision', 'A TSA extension requires an approved decision; it is never automatic');
  if (!t.newEndDate) throw ruleViolation('tsa.extension_requires_end_date', 'An extension must state the new end date');
  if (!t.continuityPlan?.trim()) throw ruleViolation('tsa.extension_requires_continuity_plan', 'An extension must reference the continuity plan');
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
  conditions: {
    id: string;
    reference: string;
    blocking: boolean;
    waivable: boolean;
    status: ConditionStatus;
    hasValidWaiver: boolean;
    longStopDate: string | null;
    /** Validity end of the satisfying approval/consent (D-07). */
    validTo?: string | null;
    /** Active evidence supporting a verified condition (D-07). */
    evidenceCount?: number;
  }[];
  deliverables: { id: string; title: string; status: 'pending' | 'delivered' | 'verified' | 'not_required' }[];
  signingConfirmed: boolean;
  today: string;
}

export function closingBlockers(i: ClosingReadinessInput): { ref: string; message: string }[] {
  const out: { ref: string; message: string }[] = [];
  if (i.kind === 'closing' && !i.signingConfirmed) out.push({ ref: 'signing', message: 'Signing has not been confirmed' });
  for (const c of i.conditions) {
    if (!c.blocking) continue;
    const verifiedWithEvidence = c.status === 'verified' && (c.evidenceCount === undefined || c.evidenceCount > 0);
    const satisfied = verifiedWithEvidence || (c.status === 'waived' && c.waivable && c.hasValidWaiver);
    if (!satisfied) {
      out.push({
        ref: c.reference,
        message: c.status === 'verified' ? `Blocking condition ${c.reference} is verified without active evidence` : `Blocking condition ${c.reference} is ${c.status}`,
      });
    }
    if (satisfied && c.validTo && c.validTo < i.today) out.push({ ref: c.reference, message: `Validity of ${c.reference} lapsed on ${c.validTo}` });
    if (c.longStopDate && c.longStopDate < i.today && !satisfied) out.push({ ref: c.reference, message: `Long-stop date passed for ${c.reference}` });
  }
  for (const d of i.deliverables) {
    if (d.status !== 'verified' && d.status !== 'not_required') out.push({ ref: d.id, message: `Closing deliverable "${d.title}" not verified` });
  }
  return out;
}
