import { Injectable, OnModuleInit } from '@nestjs/common';
import { and, eq, inArray, isNull, or, gt, sql } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  GATE_ASSESSMENT_MACHINE,
  NO_HUMAN_REQUESTER,
  POLICY_MATRIX,
  DECIDED_GATE_STATUSES,
  APPROVED_GATE_STATUSES,
  transition,
  planReopen,
  carryForwardCriteria,
  assertCriterionEditable,
  assertGateDecisionAllowed,
  assertGateEndorsedForSubmission,
  assertGateReviewable,
  assertGateReviewOutcomeAllowed,
  gateCriteriaComplete,
  gateReviewPending,
  gateReviewState,
  separationSubject,
  GATE_REVIEWABLE_STATUSES,
  GateReviewOutcome,
  GateReviewState,
  assertNotApplicableAllowed,
  assertWaivabilityDetermination,
  assertWaivabilityDeterminer,
  designatedWaivabilityRole,
  decidedCriterionReassessment,
  evidenceRejectedSinceAcceptance,
  gateApprovalDecisionIssue,
  gateDecisionTypeIssue,
  gateRag,
  forbidden,
  notFound,
  ruleViolation,
  CriterionStatus,
  GateBlocker,
  GateEvaluation,
  GateDecisionAuthority,
  GateDecisionBacking,
  ReassessmentReason,
  RoleKey,
  type I18nText,
  type ProjectTemplateDefinition,
} from '@hub/domain';
import { DbService } from '../../platform/db.service';
import { PolicyService } from '../../platform/policy.service';
import { AuditService } from '../../platform/audit.service';
import { OutboxService } from '../../platform/outbox.service';
import { JobQueue } from '../../platform/jobs/job-queue.service';
import type { RequestContext } from '../../platform/context';
import { assertVersion, loadInProject, nextCode, RecordVersionService, updateVersioned, visibleEvidenceCounts } from '../../platform/helpers';
import { newId } from '../../platform/ids';
import {
  AssessmentRow,
  CriterionAssessmentRow,
  CriterionRow,
  GateBundle,
  GateLoader,
  GateRow,
  ProjectRow,
  ReassessmentFlags,
  reassessmentOf,
  reviewOf,
  WaiverRow,
} from './gates.evaluation';
import { WaiverService, WaiverRecord, assertHumanActor } from './waiver.service';
import { gateDecisionAuthorities } from './gate-authority';

type DecisionRow = typeof schema.decision.$inferSelect;

/** Job kind recomputing the status dimensions (subscribed to register/evidence events in gates.jobs.ts). */
export const RECOMPUTE_DIMENSIONS_JOB = 'gates.recompute_dimensions';
export const EVIDENCE_CONFLICTS_JOB = 'gates.evidence_conflicts';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const evalFields = (e: GateEvaluation) => ({ ready: e.ready, hasWaivers: e.hasWaivers, blockers: e.blockers, counts: e.counts });

/** English wording of a reassessment reason in escalations and notifications (stored text; the flag carries the code). */
const REASSESSMENT_WHAT: Record<ReassessmentReason, string> = {
  evidence_conflict: 'is now conflicting',
  evidence_defective: 'was rejected as defective',
  evidence_superseded: 'was superseded',
};

/**
 * Business gates G0–G7 (spec §3; REQ-LCY-*): live evaluation, assessment lifecycle, criterion assessment, controlled
 * reopen and evidence-conflict reassessment. Every command: load in project (404) → policy (RBAC+ABAC) → domain rule →
 * versioned write → audit → outbox, all in the request transaction.
 */
@Injectable()
export class GatesService implements OnModuleInit {
  constructor(
    private readonly db: DbService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly loader: GateLoader,
    private readonly waivers: WaiverService,
    private readonly versions: RecordVersionService,
    private readonly queue: JobQueue,
  ) {}

  onModuleInit() {
    this.waivers.registerTarget({
      targetType: 'gate_criterion',
      resolve: async (projectId, targetId) => {
        const crit = await loadInProject(this.db, schema.gateCriterion, projectId, targetId);
        const b = await this.loader.bundle(projectId);
        const gate = b.gate(crit.gateId);
        const cur = b.current(gate.id);
        const ca = b.ca(cur.id, crit.id);
        return {
          label: crit.key,
          version: crit.version,
          waivable: crit.waivable,
          waiverAuthorityRole: crit.waiverAuthorityRole,
          classification: b.project.classification,
          requestPermission: 'gates.waiver.request',
          approvePermission: 'gates.waiver.approve',
          assertRequestable: () => {
            if (DECIDED_GATE_STATUSES.includes(cur.status)) assertCriterionEditable(gate.key, cur.status);
            if (ca && (ca.status === 'met' || ca.status === 'waived' || (ca.status === 'not_applicable' && ca.naApproved))) {
              throw ruleViolation('gates.waiver.not_needed', `Criterion ${crit.key} is already ${ca.status}`);
            }
          },
        };
      },
      onApproved: (ctx, projectId, w) => this.applyApprovedWaiver(ctx, projectId, w),
    });
  }

  // ---------------------------------------------------------------------------------------------------------
  // Reads

  async listGates(ctx: RequestContext, projectId: string) {
    const b = await this.loader.bundle(projectId);
    this.policy.assert(ctx, 'gates.gate.read', { projectId, classification: b.project.classification });
    const decisions = await this.decisionsFor(projectId, b.assessments.filter((a) => a.isCurrent).map((a) => a.decisionId), []);
    const authorities = await this.authoritiesFor(projectId, [...decisions.values()]);
    const purposes = await this.templatePurposes(b.project);
    const names = await this.userNames(b.assessments.filter((a) => a.isCurrent).flatMap((a) => [a.startedBy, a.reviewedBy]));
    return { items: b.gates.map((g) => this.summary(ctx, b, g, decisions, authorities, purposes, names)) };
  }

  async getGate(ctx: RequestContext, projectId: string, gateId: string) {
    const b = await this.loader.bundle(projectId, { allCycles: true });
    const gate = b.gate(gateId);
    this.policy.assert(ctx, 'gates.gate.read', { projectId, classification: b.project.classification });
    const cycles = b.cycles(gate.id);
    const decisions = await this.decisionsFor(projectId, cycles.map((a) => a.decisionId), [gate.key]);
    const authorities = await this.authoritiesFor(projectId, [...decisions.values()]);
    const cur = b.current(gate.id);
    const summary = this.summary(ctx, b, gate, decisions, authorities, await this.templatePurposes(b.project), await this.userNames([cur.startedBy, cur.reviewedBy]));
    const crits = b.criteriaOf(gate.id);
    const critIds = new Set(crits.map((c) => c.id));
    // Displayed counters use the evidence list's visibility (SEC-P1R-05); the evaluation above counts every link.
    const shown = await visibleEvidenceCounts(this.db, this.policy, ctx, projectId, 'gate_criterion', crits.map((c) => c.id));
    return {
      ...summary,
      criteria: crits.map((c) => this.criterionDto(b, c, cur, shown.get(c.id) ?? { active: 0, conflicting: 0 })),
      waivers: b.waivers.filter((w) => critIds.has(w.targetId)).map((w) => this.waiverDto(w, b)),
      decisions: [...decisions.values()].filter((d) => this.canSeeDecision(ctx, projectId, d)).map((d) => this.decisionDto(d, gate.key, authorities.get(d.id) ?? null)),
      cycles: cycles.map((a) => ({
        ...this.assessmentDto(a),
        criteria: crits.map((c) => {
          const ca = b.ca(a.id, c.id);
          return { criterionId: c.id, key: c.key, status: ca?.status ?? 'unmet', waiverId: ca?.waiverId ?? null };
        }),
        evaluationSnapshot: (a.evaluation as Record<string, unknown> | null) ?? null,
      })),
    };
  }

  async listWaivers(ctx: RequestContext, projectId: string, status?: string) {
    const b = await this.loader.bundle(projectId);
    this.policy.assert(ctx, 'gates.gate.read', { projectId, classification: b.project.classification });
    const rows = await this.waivers.list(projectId, 'gate_criterion', status);
    return { items: rows.map((w) => this.waiverDto(w, b)) };
  }

  // ---------------------------------------------------------------------------------------------------------
  // Assessment lifecycle commands

  /** The gate owner (owner role or project manager) starts the cycle; who started it is recorded (DOM-P2-16). */
  async startAssessment(ctx: RequestContext, projectId: string, gateId: string, body: { expectedVersion: number; note?: string }) {
    const { b, gate, cur } = await this.loadGate(projectId, gateId);
    this.assertGateOwner(ctx, projectId, b.project.classification, gate);
    const to = transition('gate_assessment', GATE_ASSESSMENT_MACHINE, cur.status, 'start_assessment');
    await updateVersioned(this.db, schema.gateAssessment, { id: cur.id, projectId, expectedVersion: body.expectedVersion }, { status: to, startedBy: ctx.principal.userId, startedAt: new Date() });
    await this.audit.record({
      action: 'gates.assessment.start',
      entityType: 'gate_assessment',
      entityId: cur.id,
      projectId,
      before: { status: cur.status },
      after: { status: to, gateKey: gate.key, cycle: cur.cycle, startedBy: ctx.principal.userId, ownerRole: gate.ownerRole },
      reason: body.note ?? null,
    });
    return this.assessmentResult(projectId, gate.id);
  }

  /**
   * Gate-level review (DOM-P2-16, REQ-LCY-010): the gate's DESIGNATED reviewer role endorses the owner's assessment of the
   * cycle, or returns it for rework, with a note. Order (I-R3): role (designated reviewer, 403) -> state (cycle in
   * assessment; an endorsement needs every criterion satisfied - 422) -> separation of duties (never the person who started
   * the cycle; an unknown starter fails closed - 403). The review records the fingerprint of the criterion state it
   * reviewed: any later change of evidence, criterion status, waiver or applicability makes an endorsement stale, and
   * mark-ready then needs a fresh one. A return keeps the cycle in assessment and blocks mark-ready until a new endorsement.
   */
  async reviewAssessment(ctx: RequestContext, projectId: string, gateId: string, body: { expectedVersion: number; outcome: GateReviewOutcome; note: string }) {
    const { b, gate, cur } = await this.loadGate(projectId, gateId);
    const res = this.assertDesignatedGateReviewer(ctx, projectId, b.project.classification, gate);
    assertGateReviewable(gate.key, cur.status);
    const ev = b.evaluate(gate);
    assertGateReviewOutcomeAllowed({ gateKey: gate.key, outcome: body.outcome, evaluation: ev });
    this.policy.assert(ctx, 'gates.assessment.review', { ...res, requesterUserId: separationSubject(ctx.principal.userId, [cur.startedBy]) });
    const basis = b.reviewBasis(gate);
    await updateVersioned(this.db, schema.gateAssessment, { id: cur.id, projectId, expectedVersion: body.expectedVersion }, {
      reviewedBy: ctx.principal.userId,
      reviewedAt: new Date(),
      reviewOutcome: body.outcome,
      reviewNote: body.note,
      reviewBasis: basis,
    });
    await this.audit.record({
      action: body.outcome === 'endorse' ? 'gates.assessment.review_endorse' : 'gates.assessment.review_return',
      entityType: 'gate_assessment',
      entityId: cur.id,
      projectId,
      before: { reviewOutcome: cur.reviewOutcome, reviewedBy: cur.reviewedBy, reviewedAt: iso(cur.reviewedAt), reviewState: gateReviewState(reviewOf(cur), basis) },
      after: { reviewOutcome: body.outcome, reviewedBy: ctx.principal.userId, reviewerRole: gate.reviewerRole, reviewBasis: basis, gateKey: gate.key, cycle: cur.cycle, startedBy: cur.startedBy, counts: ev.counts },
      reason: body.note,
    });
    return this.assessmentResult(projectId, gate.id);
  }

  /** Submit for decision — only when the server-side evaluation is ready (task progress is not an input). */
  async markReady(ctx: RequestContext, projectId: string, gateId: string, body: { expectedVersion: number; note?: string }) {
    const { b, gate, cur } = await this.loadGate(projectId, gateId);
    this.assertGateOwner(ctx, projectId, b.project.classification, gate);
    const to = transition('gate_assessment', GATE_ASSESSMENT_MACHINE, cur.status, 'mark_ready');
    const ev = b.evaluate(gate);
    if (!ev.ready) {
      throw ruleViolation('gates.assessment.not_ready', `Gate ${gate.key} is not ready for decision: ${ev.blockers.length} blocker(s)`, { blockers: ev.blockers });
    }
    // DOM-P2-16: the gate reviewer's endorsement recorded after the cycle's last criterion change (422), by someone other
    // than the submitter (403).
    const basis = b.reviewBasis(gate);
    assertGateEndorsedForSubmission({ gateKey: gate.key, reviewerRole: gate.reviewerRole, review: reviewOf(cur), currentBasis: basis, submitterUserId: ctx.principal.userId });
    await updateVersioned(this.db, schema.gateAssessment, { id: cur.id, projectId, expectedVersion: body.expectedVersion }, {
      status: to,
      submittedBy: ctx.principal.userId,
      submittedAt: new Date(),
      evaluation: { ...((cur.evaluation as Record<string, unknown>) ?? {}), ...evalFields(ev), evaluatedAt: new Date().toISOString() },
    });
    await this.audit.record({
      action: 'gates.assessment.mark_ready',
      entityType: 'gate_assessment',
      entityId: cur.id,
      projectId,
      before: { status: cur.status },
      after: { status: to, gateKey: gate.key, counts: ev.counts, submittedBy: ctx.principal.userId, reviewedBy: cur.reviewedBy, reviewedAt: iso(cur.reviewedAt), reviewBasis: basis },
      reason: body.note ?? null,
    });
    return this.assessmentResult(projectId, gate.id);
  }

  async backToAssessment(ctx: RequestContext, projectId: string, gateId: string, body: { expectedVersion: number; note?: string }) {
    const { b, gate, cur } = await this.loadGate(projectId, gateId);
    this.assertGateOwner(ctx, projectId, b.project.classification, gate);
    const to = transition('gate_assessment', GATE_ASSESSMENT_MACHINE, cur.status, 'back_to_assessment');
    await updateVersioned(this.db, schema.gateAssessment, { id: cur.id, projectId, expectedVersion: body.expectedVersion }, { status: to, submittedBy: null, submittedAt: null });
    await this.audit.record({ action: 'gates.assessment.back_to_assessment', entityType: 'gate_assessment', entityId: cur.id, projectId, before: { status: cur.status }, after: { status: to, gateKey: gate.key }, reason: body.note ?? null });
    return this.assessmentResult(projectId, gate.id);
  }

  /** Link the governance decision that will back the gate decision; until it is final the gate shows a decision blocker. */
  async linkDecision(ctx: RequestContext, projectId: string, gateId: string, body: { expectedVersion: number; decisionId: string }) {
    const { b, gate, cur } = await this.loadGate(projectId, gateId);
    this.assertGateOwner(ctx, projectId, b.project.classification, gate);
    if (DECIDED_GATE_STATUSES.includes(cur.status)) throw ruleViolation('gates.assessment.decided', `Gate ${gate.key} cycle ${cur.cycle} is already decided`);
    const d = await this.loadDecision(ctx, projectId, body.decisionId);
    // DOM-P2-01: a decision that can never back this gate (no / other gate key, no approved matrix of the deciding
    // committee, or a decision type that matrix does not assign to this gate) is refused up front.
    const typeIssue = gateDecisionTypeIssue(this.backing(d), gate.key, (await this.authoritiesFor(projectId, [d])).get(d.id) ?? null);
    if (typeIssue) throw ruleViolation('gates.decision.not_for_gate', typeIssue.message, { decisionId: d.id, decisionTypeKey: d.decisionTypeKey, messageI18n: typeIssue.messageI18n });
    await updateVersioned(this.db, schema.gateAssessment, { id: cur.id, projectId, expectedVersion: body.expectedVersion }, { decisionId: d.id });
    await this.audit.record({ action: 'gates.assessment.link_decision', entityType: 'gate_assessment', entityId: cur.id, projectId, before: { decisionId: cur.decisionId }, after: { decisionId: d.id, decisionStatus: d.status, authorityOutcome: d.authorityOutcome, gateKey: gate.key } });
    return this.assessmentResult(projectId, gate.id);
  }

  /**
   * Gate decision (AT-04, REQ-LCY-010/011): approver role of the gate (authority), not the submitter (not_self),
   * re-evaluation at decision time, and — for approvals — a FINAL governance decision (approved within mandate or by the
   * authorized body). A recommended / pending-external decision keeps the gate blocked (422).
   */
  async decide(
    ctx: RequestContext,
    projectId: string,
    gateId: string,
    body: { expectedVersion: number; outcome: 'approve' | 'approve_with_exceptions' | 'reject'; decisionId?: string; note: string },
  ) {
    const { b, gate, cur } = await this.loadGate(projectId, gateId);
    const withinAuthority = this.rolesOf(ctx, projectId).includes(gate.approverRole);
    // Role → state → not the submitter NOR the gate reviewer (DOM-P2-16) + within authority (I-R3): deciding an assessment
    // nobody submitted is 422, not 403; an unknown submitter or reviewer fails closed (403 policy.sod_subject_unknown).
    assertHumanActor(ctx, 'gates.assessment.decide');
    const requesterUserId = separationSubject(ctx.principal.userId, [cur.submittedBy, cur.reviewedBy]);
    this.policy.assertApproval(ctx, 'gates.assessment.decide', { projectId, classification: b.project.classification, requesterUserId, withinAuthority }, () =>
      transition('gate_assessment', GATE_ASSESSMENT_MACHINE, cur.status, body.outcome),
    );
    const to = transition('gate_assessment', GATE_ASSESSMENT_MACHINE, cur.status, body.outcome);
    const decisionId = body.decisionId ?? cur.decisionId ?? null;
    const d = decisionId ? await this.loadDecision(ctx, projectId, decisionId) : null;
    const ev = b.evaluate(gate);
    const priorDecisionIds = b
      .cycles(gate.id)
      .filter((a) => a.id !== cur.id && a.decisionId && a.status !== 'rejected')
      .map((a) => a.decisionId!);
    const authority = d ? ((await this.authoritiesFor(projectId, [d])).get(d.id) ?? null) : null;
    assertGateDecisionAllowed({ gateKey: gate.key, outcome: body.outcome, evaluation: ev, decision: d ? this.backing(d) : null, authority, decisionIdsUsedByPriorCycles: priorDecisionIds, note: body.note });
    const now = new Date();
    const atDecision = {
      at: now.toISOString(),
      outcome: body.outcome,
      decidedBy: ctx.principal.userId,
      criteria: b.criteriaOf(gate.id).map((c) => {
        const ca = b.ca(cur.id, c.id);
        const e = b.evidenceOf(c.id);
        // activeEvidenceLinkIds = the evidence relied upon by this decision (a later rejection / supersession of one of
        // these links flags the approved cycle for controlled reassessment — DOM-P2-05).
        return { criterionId: c.id, key: c.key, status: ca?.status ?? 'unmet', activeEvidence: e.active, activeEvidenceLinkIds: e.activeLinkIds, verifiedEvidence: e.verified, conflictingEvidence: e.conflicting, waiverId: ca?.waiverId ?? null };
      }),
      prerequisites: b.prerequisites(gate),
      // The gate-level review the submission relied upon (DOM-P2-16).
      review: { startedBy: cur.startedBy, submittedBy: cur.submittedBy, reviewedBy: cur.reviewedBy, reviewedAt: iso(cur.reviewedAt), outcome: cur.reviewOutcome, basis: cur.reviewBasis },
      decision: d
        ? { id: d.id, code: d.code, status: d.status, authorityOutcome: d.authorityOutcome, externalAuthorityReference: d.externalAuthorityReference, decisionTypeKey: d.decisionTypeKey, gateKey: d.gateKey, committeeId: d.committeeId, matrixVersionId: authority?.matrixVersionId ?? null }
        : null,
    };
    await updateVersioned(this.db, schema.gateAssessment, { id: cur.id, projectId, expectedVersion: body.expectedVersion }, {
      status: to,
      decidedBy: ctx.principal.userId,
      decidedAt: now,
      decisionId: d?.id ?? cur.decisionId,
      decisionNote: body.note,
      evaluation: { ...((cur.evaluation as Record<string, unknown>) ?? {}), ...evalFields(ev), evaluatedAt: now.toISOString(), atDecision },
    });
    await this.audit.record({
      action: 'gates.assessment.decide',
      entityType: 'gate_assessment',
      entityId: cur.id,
      projectId,
      before: { status: cur.status },
      after: {
        status: to,
        gateKey: gate.key,
        cycle: cur.cycle,
        decisionId: d?.id ?? null,
        decisionStatus: d?.status ?? null,
        authorityOutcome: d?.authorityOutcome ?? null,
        decisionTypeKey: d?.decisionTypeKey ?? null,
        matrixVersionId: authority?.matrixVersionId ?? null,
        submittedBy: cur.submittedBy,
        reviewedBy: cur.reviewedBy,
      },
      reason: body.note,
    });
    await this.enqueueRecompute(ctx, projectId, `decide:${cur.id}:${to}`);
    return this.assessmentResult(projectId, gate.id);
  }

  /**
   * Controlled reopen (spec §3, AT-14, REQ-LCY-015; domain planReopen): a NEW cycle is created in `reopened` that
   * supersedes the decided one. The prior cycle keeps its status, decision, evaluation snapshot and criterion rows; only
   * its `is_current` flag changes.
   */
  async reopen(ctx: RequestContext, projectId: string, gateId: string, body: { expectedVersion: number; reason: string; resetCriterionIds?: string[] }) {
    const { b, gate, cur } = await this.loadGate(projectId, gateId);
    this.commandAssert(ctx, 'gates.assessment.reopen', { projectId, classification: b.project.classification });
    assertVersion(cur, body.expectedVersion, 'gate assessment');
    const plan = planReopen({ id: cur.id, cycle: cur.cycle, status: cur.status }, body.reason);
    const crits = b.criteriaOf(gate.id);
    const reset = new Set(body.resetCriterionIds ?? []);
    for (const id of reset) if (!crits.some((c) => c.id === id)) throw notFound('gates.criterion.not_found', 'Criterion not found in this gate');
    const conflicting = new Set(crits.filter((c) => b.evidenceOf(c.id).conflicting > 0).map((c) => c.id));
    const priorCas = crits.map((c) => ({ c, ca: b.ca(cur.id, c.id) }));
    const carried = carryForwardCriteria(
      priorCas.map(({ c, ca }) => ({ criterionId: c.id, status: ca?.status ?? 'unmet', waiverId: ca?.waiverId ?? null })),
      { conflictingCriterionIds: conflicting, resetCriterionIds: reset },
    );

    await this.versions.snapshot({
      projectId,
      entityType: 'gate_assessment',
      entityId: cur.id,
      versionNo: cur.version,
      snapshot: {
        ...this.assessmentDto(cur),
        evaluation: cur.evaluation,
        criteria: priorCas.map(({ c, ca }) => ({ criterionId: c.id, key: c.key, status: ca?.status ?? 'unmet', waiverId: ca?.waiverId ?? null, note: ca?.note ?? null })),
      },
      reason: `Superseded by cycle ${plan.cycle}: ${body.reason}`,
    });
    await updateVersioned(this.db, schema.gateAssessment, { id: cur.id, projectId, expectedVersion: body.expectedVersion }, { isCurrent: false });
    const newAssessmentId = newId();
    await this.db.tx().insert(schema.gateAssessment).values({
      id: newAssessmentId,
      orgId: ctx.principal.orgId,
      projectId,
      gateId: gate.id,
      cycle: plan.cycle,
      status: plan.status,
      reopenedReason: plan.reason,
      supersedesAssessmentId: plan.supersedesAssessmentId,
      isCurrent: true,
      createdBy: ctx.principal.userId,
    });
    if (carried.length) {
      await this.db
        .tx()
        .insert(schema.criterionAssessment)
        .values(
          carried.map((x) => {
            const prev = priorCas.find((p) => p.c.id === x.criterionId)!.ca;
            const keepNa = x.status === 'not_applicable' && prev;
            return {
              id: newId(),
              orgId: ctx.principal.orgId,
              projectId,
              assessmentId: newAssessmentId,
              criterionId: x.criterionId,
              status: x.status,
              waiverId: x.waiverId,
              note:
                x.status === 'conflicting'
                  ? `Reopened: evidence relied upon is conflicting (cycle ${cur.cycle} status: ${x.carriedFrom})`
                  : reset.has(x.criterionId)
                    ? `Reopened for re-review: ${body.reason}`.slice(0, 4000)
                    : `Carried from cycle ${cur.cycle} (${x.carriedFrom})`,
              naBasis: keepNa ? prev.naBasis : null,
              naProposedBy: keepNa ? prev.naProposedBy : null,
              naProposedAt: keepNa ? prev.naProposedAt : null,
              naDeterminedBy: keepNa ? prev.naDeterminedBy : null,
              naDeterminedRole: keepNa ? prev.naDeterminedRole : null,
              naDeterminedAt: keepNa ? prev.naDeterminedAt : null,
              naApproved: keepNa ? prev.naApproved : false,
              assessedBy: x.status === x.carriedFrom ? (prev?.assessedBy ?? null) : null,
              assessedAt: x.status === x.carriedFrom ? (prev?.assessedAt ?? null) : null,
            };
          }),
        );
    }
    const keyOf = (id: string) => crits.find((c) => c.id === id)!.key;
    await this.audit.record({
      action: 'gates.assessment.reopen',
      entityType: 'gate_assessment',
      entityId: newAssessmentId,
      projectId,
      before: { previousAssessmentId: cur.id, previousCycle: cur.cycle, previousStatus: cur.status, previousDecisionId: cur.decisionId },
      after: { gateKey: gate.key, cycle: plan.cycle, status: plan.status, conflicting: [...conflicting].map(keyOf), reset: [...reset].map(keyOf) },
      reason: body.reason,
    });
    await this.enqueueRecompute(ctx, projectId, `reopen:${newAssessmentId}`);
    return this.assessmentResult(projectId, gate.id);
  }

  // ---------------------------------------------------------------------------------------------------------
  // Criterion commands

  /** Owner/contributor marks evidence as submitted (requires active, non-conflicting evidence when evidence is required). */
  async submitEvidence(ctx: RequestContext, projectId: string, gateId: string, criterionId: string, body: { expectedVersion: number; note?: string }) {
    const { b, gate, crit, cur } = await this.loadCriterion(projectId, gateId, criterionId);
    this.commandAssert(ctx, 'gates.evidence.attach', { projectId, classification: b.project.classification, ownerRoles: [crit.ownerRole as RoleKey] });
    assertCriterionEditable(gate.key, cur.status);
    const ca = await this.ensureCa(ctx, b, cur, crit);
    this.assertFrom(crit, ca, ['unmet', 'conflicting'], 'evidence_submitted');
    const ev = b.evidenceOf(crit.id);
    if (ev.conflicting > 0) throw ruleViolation('gates.criterion.evidence_conflict', `Criterion ${crit.key} has conflicting evidence that must be resolved first`);
    if (crit.evidenceRequired && ev.active === 0) throw ruleViolation('gates.criterion.no_evidence', `Criterion ${crit.key} has no active evidence linked`);
    return this.writeCriterion(ctx, projectId, gate, crit, ca, body.expectedVersion, { status: 'evidence_submitted', note: body.note ?? ca.note }, 'gates.criterion.submit_evidence', body.note);
  }

  /**
   * The criterion's designated reviewer accepts (met) or returns (unmet) it. `met` requires active evidence (when
   * evidence is required), no conflicting evidence, and a reviewer who is not an owner of that evidence (policy not_self).
   */
  async reviewCriterion(ctx: RequestContext, projectId: string, gateId: string, criterionId: string, body: { expectedVersion: number; outcome: 'met' | 'unmet'; note?: string }) {
    const { b, gate, crit, cur } = await this.loadCriterion(projectId, gateId, criterionId);
    const ev = b.evidenceOf(crit.id);
    const actor = ctx.principal.userId;
    // `met` accepts the evidence: separation of duties against its submitter(s) (not_self). With no active evidence at all
    // there is no evidence owner — stated explicitly (NO_HUMAN_REQUESTER, I-R3); the evidence rules below still refuse a
    // criterion that requires evidence (422). Returning it (`unmet`) approves nothing: role-level check only.
    const sod =
      body.outcome === 'met'
        ? { requesterUserId: ev.submitters.length ? (actor && ev.submitters.includes(actor) ? actor : ev.submitters[0]!) : NO_HUMAN_REQUESTER }
        : ('none' as const);
    this.assertDesignatedReviewer(ctx, projectId, b.project.classification, crit, sod);
    assertCriterionEditable(gate.key, cur.status);
    const ca = await this.ensureCa(ctx, b, cur, crit);
    if (body.outcome === 'met') {
      this.assertFrom(crit, ca, ['unmet', 'evidence_submitted', 'conflicting'], 'met');
      if (ev.conflicting > 0) throw ruleViolation('gates.criterion.evidence_conflict', `Criterion ${crit.key} has conflicting evidence that must be resolved before it can be met`);
      if (crit.evidenceRequired && ev.active === 0) throw ruleViolation('gates.criterion.no_evidence', `Criterion ${crit.key} cannot be met without active evidence`);
    } else {
      this.assertFrom(crit, ca, ['evidence_submitted', 'met', 'conflicting', 'not_applicable'], 'unmet');
      if (ca.status === 'not_applicable' && ca.naApproved) throw ruleViolation('gates.criterion.invalid_transition', `Criterion ${crit.key} has an approved not-applicable determination`);
    }
    return this.writeCriterion(
      ctx,
      projectId,
      gate,
      crit,
      ca,
      body.expectedVersion,
      { status: body.outcome, note: body.note ?? ca.note, assessedBy: actor, assessedAt: new Date(), ...this.clearNa() },
      body.outcome === 'met' ? 'gates.criterion.accept' : 'gates.criterion.return',
      body.note,
    );
  }

  /** Propose "not applicable" with a basis; it does not count until the criterion reviewer role approves it (D-01). */
  async proposeNotApplicable(ctx: RequestContext, projectId: string, gateId: string, criterionId: string, body: { expectedVersion: number; basis: string }) {
    const { b, gate, crit, cur } = await this.loadCriterion(projectId, gateId, criterionId);
    this.commandAssert(ctx, 'gates.evidence.attach', { projectId, classification: b.project.classification, ownerRoles: [crit.ownerRole as RoleKey] });
    assertCriterionEditable(gate.key, cur.status);
    const ca = await this.ensureCa(ctx, b, cur, crit);
    this.assertFrom(crit, ca, ['unmet', 'evidence_submitted', 'conflicting'], 'not_applicable');
    return this.writeCriterion(
      ctx,
      projectId,
      gate,
      crit,
      ca,
      body.expectedVersion,
      { status: 'not_applicable', naBasis: body.basis, naProposedBy: ctx.principal.userId, naProposedAt: new Date(), naApproved: false, naDeterminedBy: null, naDeterminedRole: null, naDeterminedAt: null },
      'gates.criterion.propose_not_applicable',
      body.basis,
    );
  }

  /** Criterion reviewer role (not the proposer) approves or rejects the not-applicable proposal. */
  async determineNotApplicable(ctx: RequestContext, projectId: string, gateId: string, criterionId: string, body: { expectedVersion: number; approve: boolean; note?: string }) {
    const { b, gate, crit, cur } = await this.loadCriterion(projectId, gateId, criterionId);
    const ca0 = b.ca(cur.id, crit.id);
    // A pending N/A proposal is approved against its proposer (unknown → fail closed, I-R3); without one the command is
    // refused below (422) after the role-level check.
    const pending = !!ca0 && ca0.status === 'not_applicable' && !ca0.naApproved;
    this.assertDesignatedReviewer(ctx, projectId, b.project.classification, crit, pending ? { requesterUserId: ca0!.naProposedBy } : 'none');
    assertCriterionEditable(gate.key, cur.status);
    if (!ca0 || ca0.status !== 'not_applicable' || ca0.naApproved) throw ruleViolation('gates.na.no_proposal', `Criterion ${crit.key} has no pending not-applicable proposal`);
    if (body.approve) {
      assertNotApplicableAllowed({
        criterionKey: crit.key,
        reviewerRole: crit.reviewerRole,
        determinerRoles: this.reviewerRolesOf(ctx, projectId),
        determinerUserId: ctx.principal.userId ?? '',
        proposerUserId: ca0.naProposedBy ?? '',
        basis: ca0.naBasis ?? '',
      });
      const r = await this.writeCriterion(
        ctx,
        projectId,
        gate,
        crit,
        ca0,
        body.expectedVersion,
        { naApproved: true, naDeterminedBy: ctx.principal.userId, naDeterminedRole: crit.reviewerRole, naDeterminedAt: new Date(), note: body.note ?? ca0.note },
        'gates.criterion.approve_not_applicable',
        body.note,
      );
      await this.setApplicability(ctx, projectId, crit, 'not_applicable', ca0.naBasis ?? '');
      return r;
    }
    const r = await this.writeCriterion(ctx, projectId, gate, crit, ca0, body.expectedVersion, { status: 'unmet', ...this.clearNa(), note: body.note ?? ca0.note }, 'gates.criterion.reject_not_applicable', body.note);
    await this.setApplicability(ctx, projectId, crit, 'applicable', body.note ?? `Not-applicable proposal rejected by the ${crit.reviewerRole} reviewer`);
    return r;
  }

  /**
   * DOM-P2-15 / REQ-LCY-005 (business-gates.md §2.1): the criterion's applicability (template value `proposed`) is set only
   * by the designated reviewer's recorded determination — `not_applicable` when a not-applicable proposal is approved,
   * `applicable` when it is rejected. Versioned (record_version) and audited.
   */
  private async setApplicability(ctx: RequestContext, projectId: string, crit: CriterionRow, value: 'applicable' | 'not_applicable', basis: string) {
    const [cur] = await this.db.tx().select({ applicability: schema.gateCriterion.applicability, version: schema.gateCriterion.version }).from(schema.gateCriterion).where(and(eq(schema.gateCriterion.id, crit.id), eq(schema.gateCriterion.projectId, projectId)));
    if (!cur || cur.applicability === value) return;
    const row = await updateVersioned(this.db, schema.gateCriterion, { id: crit.id, projectId, expectedVersion: cur.version }, { applicability: value });
    await this.versions.snapshot({
      projectId,
      entityType: 'gate_criterion',
      entityId: crit.id,
      versionNo: row['version'] as number,
      snapshot: { key: crit.key, applicability: value, previous: cur.applicability, basis, determinedBy: ctx.principal.userId, determinedRole: crit.reviewerRole },
      reason: 'applicability determination',
    });
    await this.audit.record({
      action: 'gates.criterion.set_applicability',
      entityType: 'gate_criterion',
      entityId: crit.id,
      projectId,
      before: { applicability: cur.applicability },
      after: { applicability: value, criterionKey: crit.key, determinedRole: crit.reviewerRole },
      reason: basis || null,
    });
  }

  async updateCriterionNote(ctx: RequestContext, projectId: string, gateId: string, criterionId: string, body: { expectedVersion: number; note: string }) {
    const { b, gate, crit, cur } = await this.loadCriterion(projectId, gateId, criterionId);
    this.commandAssert(ctx, 'gates.evidence.attach', { projectId, classification: b.project.classification, ownerRoles: [crit.ownerRole as RoleKey] });
    assertCriterionEditable(gate.key, cur.status);
    const ca = await this.ensureCa(ctx, b, cur, crit);
    const row = await updateVersioned(this.db, schema.criterionAssessment, { id: ca.id, projectId, expectedVersion: body.expectedVersion }, { note: body.note });
    await this.audit.record({ action: 'gates.criterion.note', entityType: 'criterion_assessment', entityId: ca.id, projectId, before: { note: ca.note }, after: { note: body.note, criterionKey: crit.key } });
    return { criterionAssessmentId: ca.id, version: row['version'] as number };
  }

  /** Specialist waivability determination: versioned (record_version) and audited; default non-waivable (REQ-LCY-013). */
  async setWaivability(
    ctx: RequestContext,
    projectId: string,
    gateId: string,
    criterionId: string,
    body: { expectedVersion: number; waivable: boolean; waiverAuthorityRole?: RoleKey | null; waivabilityBasis: string },
  ) {
    const { b, gate, crit, cur } = await this.loadCriterion(projectId, gateId, criterionId);
    this.commandAssert(ctx, 'gates.criterion.set_waivability', { projectId, classification: b.project.classification });
    // DOM-P2-15: only the criterion's designated specialist, and only while the cycle is being assessed (never on a gate
    // that is ready for decision or decided — its criteria are frozen).
    const specialists = (Object.keys(POLICY_MATRIX.roles) as RoleKey[]).filter((r) => POLICY_MATRIX.roles[r].permissions.includes('gates.criterion.set_waivability'));
    const designatedRole = designatedWaivabilityRole(crit.reviewerRole, specialists);
    assertWaivabilityDeterminer({ criterionKey: crit.key, designatedRole, actorRoles: this.allRolesOf(ctx, projectId), gateKey: gate.key, gateStatus: cur.status });
    const role = body.waivable ? (body.waiverAuthorityRole ?? null) : null;
    assertWaivabilityDetermination({
      waivable: body.waivable,
      waiverAuthorityRole: role,
      basis: body.waivabilityBasis,
      authorityRoleCanApprove: !!role && (POLICY_MATRIX.roles[role]?.permissions ?? []).includes('gates.waiver.approve'),
    });
    const before = { waivable: crit.waivable, waiverAuthorityRole: crit.waiverAuthorityRole, waivabilityBasis: crit.waivabilityBasis };
    const row = await updateVersioned(this.db, schema.gateCriterion, { id: crit.id, projectId, expectedVersion: body.expectedVersion }, {
      waivable: body.waivable,
      waiverAuthorityRole: role,
      waivabilityBasis: body.waivabilityBasis,
    });
    const version = row['version'] as number;
    await this.versions.snapshot({ projectId, entityType: 'gate_criterion', entityId: crit.id, versionNo: crit.version, snapshot: { key: crit.key, ...before }, reason: 'previous waivability' });
    await this.versions.snapshot({
      projectId,
      entityType: 'gate_criterion',
      entityId: crit.id,
      versionNo: version,
      snapshot: { key: crit.key, waivable: body.waivable, waiverAuthorityRole: role, waivabilityBasis: body.waivabilityBasis, determinedBy: ctx.principal.userId, determinedRole: designatedRole },
      reason: 'waivability determination',
    });
    await this.audit.record({
      action: 'gates.criterion.set_waivability',
      entityType: 'gate_criterion',
      entityId: crit.id,
      projectId,
      before,
      after: { waivable: body.waivable, waiverAuthorityRole: role, waivabilityBasis: body.waivabilityBasis, criterionKey: crit.key, determinedRole: designatedRole },
      reason: body.waivabilityBasis,
    });
    await this.refreshEvaluations(projectId);
    return { criterionId: crit.id, waivable: body.waivable, waiverAuthorityRole: role, version };
  }

  // ---------------------------------------------------------------------------------------------------------
  // Waivers (gate_criterion) — thin wrappers over the generic WaiverService

  async requestWaiver(ctx: RequestContext, projectId: string, gateId: string, criterionId: string, body: { basis: string; impact: string; conditions?: string; expiresOn?: string }) {
    await this.loadCriterion(projectId, gateId, criterionId);
    const w = await this.waivers.request(ctx, projectId, 'gate_criterion', criterionId, body);
    return this.waiverDto(w, await this.loader.bundle(projectId));
  }

  async approveWaiver(ctx: RequestContext, projectId: string, waiverId: string, body: { expectedVersion: number; note?: string }) {
    const w = await this.waivers.approve(ctx, projectId, waiverId, body, 'gate_criterion');
    return this.waiverDto(w, await this.loader.bundle(projectId));
  }

  async rejectWaiver(ctx: RequestContext, projectId: string, waiverId: string, body: { expectedVersion: number; note: string }) {
    const w = await this.waivers.reject(ctx, projectId, waiverId, body, 'gate_criterion');
    return this.waiverDto(w, await this.loader.bundle(projectId));
  }

  /** Applies an approved waiver to the current cycle's criterion assessment (called inside the approval transaction). */
  private async applyApprovedWaiver(ctx: RequestContext, projectId: string, w: WaiverRecord) {
    const b = await this.loader.bundle(projectId);
    const crit = b.criteria.find((c) => c.id === w.targetId);
    if (!crit) throw notFound();
    const gate = b.gate(crit.gateId);
    const cur = b.current(gate.id);
    assertCriterionEditable(gate.key, cur.status);
    const ca = await this.ensureCa(ctx, b, cur, crit);
    await this.db
      .tx()
      .update(schema.criterionAssessment)
      .set({ status: 'waived', waiverId: w.id, assessedBy: ctx.principal.userId, assessedAt: new Date(), updatedAt: new Date(), version: sql`${schema.criterionAssessment.version} + 1`, ...this.clearNa() })
      .where(and(eq(schema.criterionAssessment.id, ca.id), eq(schema.criterionAssessment.projectId, projectId)));
    await this.audit.record({ action: 'gates.criterion.waive', entityType: 'criterion_assessment', entityId: ca.id, projectId, before: { status: ca.status }, after: { status: 'waived', waiverId: w.id, criterionKey: crit.key } });
    await this.refreshEvaluations(projectId);
  }

  // ---------------------------------------------------------------------------------------------------------
  // Evidence changes → controlled reassessment (AT-14, DOM-P2-05) — runs in the worker under a service principal

  /**
   * Reacts to `evidence.changed` (conflict, verification rejected as defective, supersession):
   *  - DECIDED approved cycle: never modified (status, decision, criterion rows). A criterion that relied on evidence which
   *    is now conflicting, rejected as defective or superseded (the links recorded in the decision snapshot) flags the
   *    cycle for controlled reassessment — flags + escalation + notifications + `gate.blocked` + downstream approved gates
   *    flagged for review + status dimensions recomputed. Idempotent per criterion.
   *  - UNDECIDED cycle: a criterion with conflicting evidence becomes `conflicting`; a criterion accepted as met whose
   *    accepted evidence was later rejected as defective returns to `unmet` for a fresh review (audited; a ready gate is
   *    reported blocked by `refreshEvaluations`).
   */
  async processEvidenceConflicts(projectId: string): Promise<{ markedConflicting: string[]; returnedForReview: string[]; flaggedGates: string[] }> {
    const b = await this.loader.bundle(projectId);
    const marked: string[] = [];
    const returned: string[] = [];
    const flagged: string[] = [];
    for (const gate of b.gates) {
      const cur = b.current(gate.id);
      if (cur.status === 'rejected') continue;
      const crits = b.criteriaOf(gate.id);
      if (APPROVED_GATE_STATUSES.includes(cur.status)) {
        const relied = this.reliedLinkIds(cur);
        const found = crits
          .map((c) => ({
            c,
            r: decidedCriterionReassessment({
              status: b.ca(cur.id, c.id)?.status ?? 'unmet',
              evidenceRequired: c.evidenceRequired,
              reliedLinkIds: relied.get(c.id) ?? null,
              links: b.evidenceOf(c.id).links,
            }),
          }))
          .filter((x): x is { c: CriterionRow; r: { reason: ReassessmentReason; linkIds: string[] } } => x.r !== null);
        if (!found.length) continue;
        const flags = reassessmentOf(await this.readAssessment(cur.id));
        const fresh = found.filter((x) => !flags.criteria.some((f) => f.criterionId === x.c.id));
        if (!fresh.length) continue;
        flags.needsReassessment = true;
        flags.requestedAt ??= new Date().toISOString();
        flags.criteria.push(...fresh.map((x) => ({ criterionId: x.c.id, key: x.c.key, evidenceLinkIds: x.r.linkIds, reason: x.r.reason })));
        flags.escalationId ??= await this.raiseReassessmentEscalation(b, gate, cur, fresh);
        await this.writeFlags(cur.id, flags);
        await this.audit.record({
          action: 'gates.assessment.flag_reassessment',
          entityType: 'gate_assessment',
          entityId: cur.id,
          projectId,
          after: { gateKey: gate.key, status: cur.status, needsReassessment: true, criteria: fresh.map((x) => ({ key: x.c.key, reason: x.r.reason, evidenceLinkIds: x.r.linkIds })), escalationId: flags.escalationId },
          reason: `Evidence relied upon by the approved gate changed (${[...new Set(fresh.map((x) => x.r.reason))].join(', ')}) — controlled reassessment requested`,
        });
        await this.notifyReopenAuthorities(b, gate, cur, fresh);
        await this.outbox.emit({
          type: 'gate.blocked',
          projectId,
          aggregateType: 'gate_assessment',
          aggregateId: cur.id,
          payload: {
            gateId: gate.id,
            gateKey: gate.key,
            reason: fresh.every((x) => x.r.reason === 'evidence_conflict') ? 'evidence_conflict_on_decided_gate' : 'evidence_change_on_decided_gate',
            needsReassessment: true,
            criteria: fresh.map((x) => x.c.key),
            reasons: fresh.map((x) => ({ criterion: x.c.key, reason: x.r.reason })),
          },
        });
        for (const dg of b.downstreamOf(gate.key)) {
          const dcur = await this.readAssessment(b.current(dg.id).id);
          if (!APPROVED_GATE_STATUSES.includes(dcur.status)) continue;
          const df = reassessmentOf(dcur);
          if (df.upstreamGateKeys.includes(gate.key)) continue;
          df.upstreamGateKeys.push(gate.key);
          await this.writeFlags(dcur.id, df);
          await this.audit.record({ action: 'gates.assessment.flag_upstream_review', entityType: 'gate_assessment', entityId: dcur.id, projectId, after: { gateKey: dg.key, upstreamGateKey: gate.key }, reason: `Upstream gate ${gate.key} approval is under reassessment` });
        }
        // A flagged approval (e.g. G4 standalone acceptance) no longer counts in the status dimensions.
        await this.queue.enqueue({
          kind: RECOMPUTE_DIMENSIONS_JOB,
          orgId: b.project.orgId,
          projectId,
          payload: { reason: 'reassessment' },
          idempotencyKey: `${RECOMPUTE_DIMENSIONS_JOB}:reassessment:${cur.id}:${flags.criteria.length}`,
          requestedBy: null,
        });
        flagged.push(gate.key);
        continue;
      }
      for (const c of crits) {
        const ev = b.evidenceOf(c.id);
        if (ev.conflicting > 0) {
          const ca = await this.ensureCa(null, b, cur, c);
          if (!(['met', 'evidence_submitted', 'unmet'] as CriterionStatus[]).includes(ca.status)) continue;
          await this.db
            .tx()
            .update(schema.criterionAssessment)
            .set({ status: 'conflicting', note: 'Evidence conflict detected — the criterion must be reassessed once the conflict is resolved', updatedAt: new Date(), version: sql`${schema.criterionAssessment.version} + 1` })
            .where(and(eq(schema.criterionAssessment.id, ca.id), eq(schema.criterionAssessment.projectId, projectId)));
          await this.audit.record({
            action: 'gates.criterion.mark_conflicting',
            entityType: 'criterion_assessment',
            entityId: ca.id,
            projectId,
            before: { status: ca.status },
            after: { status: 'conflicting', criterionKey: c.key, evidenceLinkIds: ev.conflictingLinkIds },
          });
          marked.push(c.key);
          continue;
        }
        const ca = b.ca(cur.id, c.id);
        if (!ca) continue;
        const defective = evidenceRejectedSinceAcceptance({ status: ca.status, assessedAtMs: ca.assessedAt ? ca.assessedAt.getTime() : null, links: ev.links });
        if (!defective.length) continue;
        await this.db
          .tx()
          .update(schema.criterionAssessment)
          .set({ status: 'unmet', note: 'Evidence relied upon when the criterion was accepted was rejected as defective — a fresh review is required', updatedAt: new Date(), version: sql`${schema.criterionAssessment.version} + 1` })
          .where(and(eq(schema.criterionAssessment.id, ca.id), eq(schema.criterionAssessment.projectId, projectId)));
        await this.audit.record({
          action: 'gates.criterion.evidence_defective',
          entityType: 'criterion_assessment',
          entityId: ca.id,
          projectId,
          before: { status: ca.status, assessedBy: ca.assessedBy },
          after: { status: 'unmet', criterionKey: c.key, gateKey: gate.key, rejectedEvidenceLinkIds: defective },
          reason: 'Evidence accepted for the criterion was rejected as defective in verification',
        });
        returned.push(c.key);
      }
    }
    await this.refreshEvaluations(projectId);
    return { markedConflicting: marked, returnedForReview: returned, flaggedGates: flagged };
  }

  /**
   * Evidence links relied upon by each criterion when the cycle was decided (decision snapshot, DOM-P2-05). A criterion is
   * absent when the snapshot predates the recorded link ids (the rule then falls back to "no active evidence left").
   */
  private reliedLinkIds(a: AssessmentRow): Map<string, string[]> {
    const snap = (a.evaluation as { atDecision?: { criteria?: { criterionId: string; activeEvidenceLinkIds?: unknown }[] } } | null)?.atDecision;
    const out = new Map<string, string[]>();
    for (const c of snap?.criteria ?? []) {
      if (Array.isArray(c.activeEvidenceLinkIds)) out.set(c.criterionId, c.activeEvidenceLinkIds.filter((x): x is string => typeof x === 'string'));
    }
    return out;
  }

  /**
   * Re-evaluate every undecided current cycle, cache the evaluation on the row and emit `gate.blocked` when a gate that
   * was ready becomes blocked. Decided cycles are never touched here.
   */
  async refreshEvaluations(projectId: string): Promise<{ b: GateBundle; evaluations: Map<string, GateEvaluation> }> {
    const b = await this.loader.bundle(projectId);
    const evaluations = new Map<string, GateEvaluation>();
    for (const g of b.gates) {
      const cur = b.current(g.id);
      const ev = b.evaluate(g);
      evaluations.set(g.id, ev);
      if (DECIDED_GATE_STATUSES.includes(cur.status)) continue;
      const stored = (cur.evaluation as Record<string, unknown> | null) ?? {};
      const next = { ...stored, ...evalFields(ev) };
      const pick = (o: Record<string, unknown>) => JSON.stringify([o['ready'] ?? null, o['hasWaivers'] ?? null, o['blockers'] ?? null, o['counts'] ?? null]);
      if (pick(stored) !== pick(next)) {
        await this.db
          .tx()
          .update(schema.gateAssessment)
          .set({ evaluation: { ...next, evaluatedAt: new Date().toISOString() }, updatedAt: new Date() })
          .where(and(eq(schema.gateAssessment.id, cur.id), eq(schema.gateAssessment.projectId, projectId)));
      }
      if (stored['ready'] === true && !ev.ready) {
        await this.outbox.emit({
          type: 'gate.blocked',
          projectId,
          aggregateType: 'gate_assessment',
          aggregateId: cur.id,
          payload: { gateId: g.id, gateKey: g.key, status: cur.status, blockers: ev.blockers.slice(0, 20) },
        });
      }
    }
    return { b, evaluations };
  }

  // ---------------------------------------------------------------------------------------------------------
  // Internals

  private async loadGate(projectId: string, gateId: string) {
    await loadInProject(this.db, schema.gateDefinition, projectId, gateId);
    const b = await this.loader.bundle(projectId);
    const gate = b.gate(gateId);
    return { b, gate, cur: b.current(gate.id) };
  }

  private async loadCriterion(projectId: string, gateId: string, criterionId: string) {
    const { b, gate, cur } = await this.loadGate(projectId, gateId);
    const crit = b.criteria.find((c) => c.id === criterionId && c.gateId === gate.id);
    if (!crit) throw notFound();
    return { b, gate, cur, crit };
  }

  /**
   * Gate commands are human judgments: an AI or service identity can never decide, reopen, review, waive or determine
   * applicability, whatever its permission allowlist says (AT-12, AI authority modes). Then RBAC + ABAC.
   */
  private commandAssert(ctx: RequestContext, permission: string, attrs: Parameters<PolicyService['assert']>[2]) {
    assertHumanActor(ctx, permission);
    this.policy.assert(ctx, permission, attrs);
  }

  /**
   * How the actor holds a DESIGNATED role in the project: project-wide, or through a workstream-scoped assignment (gates
   * carry no workstream, so the policy check then runs against the workstream the actor holds the role in).
   */
  private roleGrant(ctx: RequestContext, projectId: string, role: RoleKey): { held: boolean; workstreamId: string | null } {
    const s = ctx.principal.projects.get(projectId);
    if (!s) return { held: false, workstreamId: null };
    if (s.roles.has(role)) return { held: true, workstreamId: null };
    const w = s.workstreamRoles.find((x) => x.role === role);
    return w ? { held: true, workstreamId: w.workstreamId } : { held: false, workstreamId: null };
  }

  /**
   * Gate OWNER commands — start, mark ready, back to assessment, link decision (DOM-P2-16, REQ-LCY-010): the gate's owner
   * role or the project manager (access-matrix §2.4 `own_workstream`, evaluated with `ownerRoles: [gate.ownerRole]`).
   * Order: human actor; 403 `gates.not_gate_owner` for a caller who can see the project and holds
   * `gates.assessment.submit` but neither the owner role nor project manager; then RBAC + ABAC (404 visibility, 403
   * missing permission / own_workstream). A workstream-lead owner acts through the workstream it leads.
   */
  private assertGateOwner(ctx: RequestContext, projectId: string, classification: Parameters<PolicyService['assert']>[2]['classification'], gate: GateRow) {
    const permission = 'gates.assessment.submit';
    assertHumanActor(ctx, permission);
    const role = gate.ownerRole as RoleKey;
    const grant = this.roleGrant(ctx, projectId, role);
    const pm = !!ctx.principal.projects.get(projectId)?.roles.has('project_manager');
    if (!grant.held && !pm && this.policy.canSee(ctx, { projectId, classification }) && this.policy.canInProject(ctx, permission, projectId)) {
      throw forbidden('gates.not_gate_owner', `Gate ${gate.key} is owned by the ${gate.ownerRole} role: only that role or the project manager may start, prepare or submit its assessment`);
    }
    this.policy.assert(ctx, permission, { projectId, classification, ownerRoles: [role], workstreamId: pm ? null : grant.workstreamId });
  }

  /**
   * The gate-level review belongs to the gate's DESIGNATED reviewer role (DOM-P2-16). Human actor; 403
   * `gates.not_designated_gate_reviewer` for a visible caller who holds `gates.assessment.review` without that role; then
   * RBAC + visibility at role level (separation of duties is checked by the caller after the state check, I-R3).
   * Returns the policy resource to use for the not_self check.
   */
  private assertDesignatedGateReviewer(ctx: RequestContext, projectId: string, classification: Parameters<PolicyService['assert']>[2]['classification'], gate: GateRow) {
    const permission = 'gates.assessment.review';
    assertHumanActor(ctx, permission);
    const grant = this.roleGrant(ctx, projectId, gate.reviewerRole as RoleKey);
    if (!grant.held && this.policy.canSee(ctx, { projectId, classification }) && this.policy.canInProject(ctx, permission, projectId)) {
      throw forbidden('gates.not_designated_gate_reviewer', `Gate ${gate.key} can only be reviewed by its designated gate reviewer role (${gate.reviewerRole})`);
    }
    const res = { projectId, classification, workstreamId: grant.workstreamId };
    this.policy.assertGranted(ctx, permission, res);
    if (!grant.held) throw forbidden('gates.not_designated_gate_reviewer', `Gate ${gate.key} can only be reviewed by its designated gate reviewer role (${gate.reviewerRole})`);
    return res;
  }

  private rolesOf(ctx: RequestContext, projectId: string): RoleKey[] {
    const s = ctx.principal.projects.get(projectId);
    return s ? [...s.roles] : [];
  }

  /** Project roles plus every workstream-scoped role the actor holds in the project. */
  private allRolesOf(ctx: RequestContext, projectId: string): RoleKey[] {
    const s = ctx.principal.projects.get(projectId);
    if (!s) return [];
    return [...new Set<RoleKey>([...s.roles, ...s.workstreamRoles.map((w) => w.role)])];
  }

  /**
   * Roles that can stand as a criterion's designated reviewer: the project-wide roles, plus `workstream_lead` when the
   * actor leads any workstream of the project (criteria carry no workstream, so any workstream lead role qualifies).
   */
  private reviewerRolesOf(ctx: RequestContext, projectId: string): RoleKey[] {
    const s = ctx.principal.projects.get(projectId);
    if (!s) return [];
    const roles = new Set<RoleKey>(s.roles);
    if (s.workstreamRoles.some((w) => w.role === 'workstream_lead')) roles.add('workstream_lead');
    return [...roles];
  }

  /**
   * Criterion review and N/A determination belong to the criterion's DESIGNATED reviewer role, not to anyone holding
   * `gates.assessment.review`. The check order is: human actor; then 403 `gates.not_designated_reviewer` for a caller
   * who can see the project and holds the permission but not the designated role; then RBAC + ABAC (404 visibility,
   * 403 missing permission, 403 not_self: the evidence submitter / N/A proposer never reviews their own submission).
   * A workstream lead's grant is workstream-scoped, so the policy check runs against the workstream they lead.
   */
  private assertDesignatedReviewer(
    ctx: RequestContext,
    projectId: string,
    classification: Parameters<PolicyService['assert']>[2]['classification'],
    crit: CriterionRow,
    sod: { requesterUserId: string | null } | 'none',
  ) {
    const permission = 'gates.assessment.review';
    assertHumanActor(ctx, permission);
    const scope = ctx.principal.projects.get(projectId);
    const role = crit.reviewerRole as RoleKey;
    const designated = this.reviewerRolesOf(ctx, projectId).includes(role);
    const viaWorkstream = designated && !scope?.roles.has(role) ? scope?.workstreamRoles.find((w) => w.role === role) : undefined;
    const refuse = () =>
      forbidden('gates.not_designated_reviewer', `Criterion ${crit.key} can only be reviewed by its designated reviewer role (${crit.reviewerRole})`);
    if (!designated && this.policy.canSee(ctx, { projectId, classification }) && this.policy.canInProject(ctx, permission, projectId)) throw refuse();
    const res = { projectId, classification, workstreamId: viaWorkstream?.workstreamId ?? null };
    if (sod === 'none') this.policy.assertGranted(ctx, permission, res);
    else this.policy.assert(ctx, permission, { ...res, requesterUserId: sod.requesterUserId });
    if (!designated) throw refuse();
  }

  private clearNa() {
    return { naBasis: null, naProposedBy: null, naProposedAt: null, naApproved: false, naDeterminedBy: null, naDeterminedRole: null, naDeterminedAt: null };
  }

  private assertFrom(crit: CriterionRow, ca: CriterionAssessmentRow, from: CriterionStatus[], to: CriterionStatus) {
    if (!from.includes(ca.status)) {
      throw ruleViolation('gates.criterion.invalid_transition', `Criterion ${crit.key} cannot move from ${ca.status} to ${to}`, { current: ca.status, allowedFrom: from });
    }
  }

  /** Criterion assessment row of the current cycle (created lazily for criteria added after the cycle started). */
  private async ensureCa(ctx: RequestContext | null, b: GateBundle, cur: AssessmentRow, crit: CriterionRow): Promise<CriterionAssessmentRow> {
    const existing = b.ca(cur.id, crit.id);
    if (existing) return existing;
    const [row] = await this.db
      .tx()
      .insert(schema.criterionAssessment)
      .values({ id: newId(), orgId: ctx?.principal.orgId ?? b.project.orgId, projectId: b.project.id, assessmentId: cur.id, criterionId: crit.id, status: 'unmet' })
      .returning();
    b.caByKey.set(`${cur.id}:${crit.id}`, row!);
    return row!;
  }

  private async writeCriterion(
    ctx: RequestContext,
    projectId: string,
    gate: GateRow,
    crit: CriterionRow,
    ca: CriterionAssessmentRow,
    expectedVersion: number,
    values: Record<string, unknown>,
    action: string,
    reason?: string | null,
  ) {
    const row = await updateVersioned(this.db, schema.criterionAssessment, { id: ca.id, projectId, expectedVersion }, values);
    await this.audit.record({
      action,
      entityType: 'criterion_assessment',
      entityId: ca.id,
      projectId,
      before: { status: ca.status, naApproved: ca.naApproved },
      after: { status: row['status'], naApproved: row['naApproved'], criterionKey: crit.key, gateKey: gate.key },
      reason: reason ?? null,
    });
    const { evaluations } = await this.refreshEvaluations(projectId);
    return { criterionAssessmentId: ca.id, status: row['status'] as CriterionStatus, version: row['version'] as number, gateEvaluation: evaluations.get(gate.id)! };
  }

  private async assessmentResult(projectId: string, gateId: string) {
    const { b, evaluations } = await this.refreshEvaluations(projectId);
    const cur = b.current(gateId);
    const reviewState: GateReviewState = gateReviewState(reviewOf(cur), b.reviewBasis(b.gate(gateId)));
    return { assessmentId: cur.id, cycle: cur.cycle, status: cur.status, version: cur.version, evaluation: evaluations.get(gateId)!, reviewState };
  }

  /** Display names of users (starter / reviewer of the current cycles) for the gate views. */
  private async userNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
    const list = [...new Set(ids.filter((x): x is string => !!x))];
    if (!list.length) return new Map();
    const rows = await this.db.tx().select({ id: schema.appUser.id, displayName: schema.appUser.displayName }).from(schema.appUser).where(inArray(schema.appUser.id, list));
    return new Map(rows.map((r) => [r.id, r.displayName]));
  }

  /**
   * Gate reviews awaiting the caller (My Work `gate_review`, DOM-P2-16) — the same inputs as the review command: a cycle in
   * assessment whose criteria are all satisfied and whose current state has not been reviewed yet (never reviewed, or
   * changed after the last review), the gate's designated reviewer role, and not the person who started the cycle.
   */
  async pendingGateReviews(ctx: RequestContext, projectId: string): Promise<{ assessmentId: string; gateId: string; key: string; name: string; state: GateReviewState }[]> {
    const permission = 'gates.assessment.review';
    if (ctx.principal.kind !== 'user' || !this.policy.canInProject(ctx, permission, projectId)) return [];
    const b = await this.loader.bundle(projectId);
    const out: { assessmentId: string; gateId: string; key: string; name: string; state: GateReviewState }[] = [];
    for (const g of b.gates) {
      const cur = b.current(g.id);
      if (!GATE_REVIEWABLE_STATUSES.includes(cur.status)) continue;
      const grant = this.roleGrant(ctx, projectId, g.reviewerRole as RoleKey);
      if (!grant.held || !gateCriteriaComplete(b.evaluate(g))) continue;
      const basis = b.reviewBasis(g);
      if (!gateReviewPending(reviewOf(cur), basis)) continue;
      const res = { projectId, classification: b.project.classification, workstreamId: grant.workstreamId, requesterUserId: separationSubject(ctx.principal.userId, [cur.startedBy]) };
      if (!this.policy.can(ctx, permission, res)) continue;
      out.push({ assessmentId: cur.id, gateId: g.id, key: g.key, name: g.name, state: gateReviewState(reviewOf(cur), basis) });
    }
    return out;
  }

  private async enqueueRecompute(ctx: RequestContext, projectId: string, key: string) {
    await this.queue.enqueue({ kind: RECOMPUTE_DIMENSIONS_JOB, orgId: ctx.principal.orgId, projectId, payload: { reason: key.split(':')[0] }, idempotencyKey: `${RECOMPUTE_DIMENSIONS_JOB}:${key}`, requestedBy: ctx.principal.userId });
  }

  private async readAssessment(id: string): Promise<AssessmentRow> {
    const [a] = await this.db.tx().select().from(schema.gateAssessment).where(eq(schema.gateAssessment.id, id));
    if (!a) throw notFound();
    return a;
  }

  /** Writes reassessment flags into the decided cycle's evaluation JSON — status and decision fields are untouched. */
  private async writeFlags(assessmentId: string, flags: ReassessmentFlags) {
    const a = await this.readAssessment(assessmentId);
    const ev = (a.evaluation as Record<string, unknown> | null) ?? {};
    await this.db
      .tx()
      .update(schema.gateAssessment)
      .set({
        evaluation: {
          ...ev,
          needsReassessment: flags.needsReassessment,
          reassessment: { requestedAt: flags.requestedAt, criteria: flags.criteria, escalationId: flags.escalationId, upstreamGateKeys: flags.upstreamGateKeys },
        },
        updatedAt: new Date(),
      })
      .where(eq(schema.gateAssessment.id, assessmentId));
  }

  private async raiseReassessmentEscalation(b: GateBundle, gate: GateRow, cur: AssessmentRow, found: { c: CriterionRow; r: { reason: ReassessmentReason } }[]): Promise<string> {
    const id = newId();
    const code = await nextCode(this.db, schema.escalation, b.project.id, 'ESC');
    const keys = found.map((x) => x.c.key).join(', ');
    const what = found.map((x) => `${x.c.key} ${REASSESSMENT_WHAT[x.r.reason]}`).join('; ');
    await this.db
      .tx()
      .insert(schema.escalation)
      .values({
        id,
        orgId: b.project.orgId,
        projectId: b.project.id,
        code,
        title: `Controlled reassessment requested — gate ${gate.key} (${gate.name})`,
        sourceType: 'gate_assessment',
        sourceId: cur.id,
        requestedAction: `Evidence relied upon by the approval changed: ${what}. Decide whether to reopen gate ${gate.key} through the controlled reopen; the approved cycle ${cur.cycle} and its decision remain preserved.`,
        options: [
          { title: `Reopen gate ${gate.key} (new assessment cycle)`, impact: 'Gate returns to assessment; downstream gates flagged for review' },
          { title: 'Resolve the evidence issue and record that the approval stands', impact: 'Requires a documented resolution of the conflicting, defective or superseded evidence' },
        ],
        status: 'open',
        isSystemGenerated: true,
        isDemo: b.project.isDemo,
      });
    await this.audit.record({ action: 'gates.escalation.raise', entityType: 'escalation', entityId: id, projectId: b.project.id, after: { code, gateKey: gate.key, criteria: keys, sourceId: cur.id } });
    return id;
  }

  /** In-app notifications to holders of `gates.assessment.reopen` in the project (deduplicated per cycle + criterion). */
  private async notifyReopenAuthorities(b: GateBundle, gate: GateRow, cur: AssessmentRow, found: { c: CriterionRow; r: { reason: ReassessmentReason } }[]) {
    const roles = (Object.keys(POLICY_MATRIX.roles) as RoleKey[]).filter((r) => POLICY_MATRIX.roles[r].permissions.includes('gates.assessment.reopen'));
    const members = await this.db
      .tx()
      .selectDistinct({ userId: schema.projectMembership.userId })
      .from(schema.projectMembership)
      .where(
        and(
          eq(schema.projectMembership.projectId, b.project.id),
          inArray(schema.projectMembership.role, roles),
          isNull(schema.projectMembership.revokedAt),
          or(isNull(schema.projectMembership.validTo), gt(schema.projectMembership.validTo, new Date())),
        ),
      );
    const keys = found.map((x) => x.c.key);
    const what = found.map((x) => `${x.c.key} ${REASSESSMENT_WHAT[x.r.reason]}`).join('; ');
    for (const m of members) {
      await this.db
        .tx()
        .insert(schema.notification)
        .values({
          id: newId(),
          orgId: b.project.orgId,
          projectId: b.project.id,
          userId: m.userId,
          kind: 'gate.reassessment_requested',
          title: `Gate ${gate.key}: controlled reassessment requested`,
          body: `Evidence relied upon by the approval changed: ${what}. The approval of cycle ${cur.cycle} is preserved; decide whether to reopen.`,
          link: `/projects/${b.project.id}/gates/${gate.id}`,
          dedupeKey: `gate-reassess:${cur.id}:${keys.join(',')}`.slice(0, 200),
          sourceType: 'gate_assessment',
          sourceId: cur.id,
        })
        .onConflictDoNothing();
    }
  }

  private async loadDecision(ctx: RequestContext, projectId: string, decisionId: string): Promise<DecisionRow> {
    const d = await loadInProject(this.db, schema.decision, projectId, decisionId);
    if (!this.policy.canSee(ctx, { projectId, classification: d.classification })) throw notFound();
    return d;
  }

  private backing(d: DecisionRow): GateDecisionBacking {
    return { id: d.id, status: d.status, authorityOutcome: d.authorityOutcome, externalAuthorityReference: d.externalAuthorityReference, gateKey: d.gateKey, decisionTypeKey: d.decisionTypeKey };
  }

  /** DOM-P2-01: the deciding committee's approved matrix and the decision's type in it (see gate-authority.ts). */
  private authoritiesFor(projectId: string, decisions: DecisionRow[]): Promise<Map<string, GateDecisionAuthority>> {
    return gateDecisionAuthorities(this.db, projectId, decisions);
  }

  /** Decisions linked to cycles or raised for the given gates (all rows; visibility is applied when rendering). */
  private async decisionsFor(projectId: string, ids: (string | null)[], gateKeys: string[]): Promise<Map<string, DecisionRow>> {
    const idList = ids.filter((x): x is string => !!x);
    if (!idList.length && !gateKeys.length) return new Map();
    const conds = [];
    if (idList.length) conds.push(inArray(schema.decision.id, idList));
    if (gateKeys.length) conds.push(inArray(schema.decision.gateKey, gateKeys));
    const rows = await this.db
      .tx()
      .select()
      .from(schema.decision)
      .where(and(eq(schema.decision.projectId, projectId), or(...conds)));
    return new Map(rows.map((r) => [r.id, r]));
  }

  private canSeeDecision(ctx: RequestContext, projectId: string, d: DecisionRow): boolean {
    return this.policy.canInProject(ctx, 'governance.decision.read', projectId) && this.policy.canSee(ctx, { projectId, classification: d.classification });
  }

  /** Bilingual gate purposes of the project's pinned template version, by gate key (QA-P1-14). */
  private async templatePurposes(project: ProjectRow): Promise<Map<string, I18nText>> {
    const [tv] = await this.db
      .tx()
      .select({ definition: schema.projectTemplateVersion.definition })
      .from(schema.projectTemplateVersion)
      .where(eq(schema.projectTemplateVersion.id, project.templateVersionId));
    const def = tv?.definition as unknown as ProjectTemplateDefinition | undefined;
    return new Map((def?.gates ?? []).map((g) => [g.key, g.purpose]));
  }

  private summary(
    ctx: RequestContext,
    b: GateBundle,
    g: GateRow,
    decisions: Map<string, DecisionRow>,
    authorities: Map<string, GateDecisionAuthority>,
    purposes: Map<string, I18nText>,
    names: Map<string, string>,
  ) {
    const cur = b.current(g.id);
    const evaluation = b.evaluate(g);
    const flags = reassessmentOf(cur);
    const d = cur.decisionId ? decisions.get(cur.decisionId) : undefined;
    const blockers: GateBlocker[] = [...evaluation.blockers];
    if (!DECIDED_GATE_STATUSES.includes(cur.status) && (cur.decisionId || cur.status === 'ready_for_decision')) {
      // The blocker exposes only the decision's status (never its title) so it is safe for every gate reader.
      const issue = gateApprovalDecisionIssue(d ? this.backing(d) : null, g.key, d ? (authorities.get(d.id) ?? null) : null);
      if (issue) blockers.push(issue);
    }
    return {
      id: g.id,
      key: g.key,
      name: g.name,
      nameAr: g.nameAr,
      purpose: g.purpose,
      // The template's Arabic purpose applies only while the stored purpose is still the template's English text.
      purposeAr: ((p) => (p && p.ar && g.purpose === p.en ? p.ar : null))(purposes.get(g.key)),
      sortOrder: g.sortOrder,
      prerequisiteGateKeys: g.prerequisiteGateKeys ?? [],
      ownerRole: g.ownerRole,
      reviewerRole: g.reviewerRole,
      approverRole: g.approverRole,
      version: g.version,
      assessment: this.assessmentDto(cur),
      evaluation,
      prerequisites: b.prerequisites(g),
      decision: d && this.canSeeDecision(ctx, b.project.id, d) ? this.decisionDto(d, g.key, authorities.get(d.id) ?? null) : null,
      review: {
        state: gateReviewState(reviewOf(cur), b.reviewBasis(g)),
        reviewerRole: g.reviewerRole,
        outcome: cur.reviewOutcome ?? null,
        reviewedBy: cur.reviewedBy,
        reviewedByName: cur.reviewedBy ? (names.get(cur.reviewedBy) ?? null) : null,
        reviewedAt: iso(cur.reviewedAt),
        note: cur.reviewNote,
        startedBy: cur.startedBy,
        startedByName: cur.startedBy ? (names.get(cur.startedBy) ?? null) : null,
      },
      blockers,
      // Ready on criteria but not backed by a final decision → not green (the gate is still blocked, AT-04).
      rag: ((r) => (r === 'green' && blockers.some((b) => b.kind === 'decision') ? 'amber' : r))(gateRag(cur.status, evaluation, flags.needsReassessment)),
      history: b.cycles(g.id).filter((a) => !a.isCurrent).map((a) => this.assessmentDto(a)),
    };
  }

  private assessmentDto(a: AssessmentRow) {
    return {
      id: a.id,
      cycle: a.cycle,
      status: a.status,
      isCurrent: a.isCurrent,
      version: a.version,
      submittedBy: a.submittedBy,
      submittedAt: iso(a.submittedAt),
      decidedBy: a.decidedBy,
      decidedAt: iso(a.decidedAt),
      decisionId: a.decisionId,
      decisionNote: a.decisionNote,
      startedBy: a.startedBy,
      startedAt: iso(a.startedAt),
      reviewedBy: a.reviewedBy,
      reviewedAt: iso(a.reviewedAt),
      reviewOutcome: a.reviewOutcome ?? null,
      reviewNote: a.reviewNote,
      reopenedReason: a.reopenedReason,
      supersedesAssessmentId: a.supersedesAssessmentId,
      createdAt: a.createdAt.toISOString(),
      reassessment: reassessmentOf(a),
    };
  }

  private decisionDto(d: DecisionRow, gateKey: string, authority: GateDecisionAuthority | null) {
    return {
      id: d.id,
      code: d.code,
      title: d.title,
      status: d.status,
      authorityOutcome: d.authorityOutcome,
      gateKey: d.gateKey,
      isDemo: d.isDemo,
      // A decision that can never back this gate says so first (DOM-P2-01); otherwise its current blocker, if any.
      ...((issue) => ({ blocker: issue?.message ?? null, blockerI18n: issue?.messageI18n ?? [] }))(
        gateDecisionTypeIssue(this.backing(d), gateKey, authority) ?? gateApprovalDecisionIssue(this.backing(d), gateKey, authority),
      ),
    };
  }

  private criterionDto(b: GateBundle, c: CriterionRow, cur: AssessmentRow, ev: { active: number; conflicting: number }) {
    const ca = b.ca(cur.id, c.id);
    return {
      id: c.id,
      key: c.key,
      description: c.description,
      descriptionAr: c.descriptionAr,
      mandatory: c.mandatory,
      blocking: c.blocking,
      waivable: c.waivable,
      waiverAuthorityRole: c.waiverAuthorityRole,
      waivabilityBasis: c.waivabilityBasis,
      evidenceRequired: c.evidenceRequired,
      evidenceType: c.evidenceType,
      ownerRole: c.ownerRole,
      reviewerRole: c.reviewerRole,
      applicability: c.applicability,
      version: c.version,
      evidence: { active: ev.active, conflicting: ev.conflicting },
      assessment: {
        // A criterion added after the cycle started has no row yet; it is created on its first command.
        id: ca?.id ?? null,
        status: ca?.status ?? 'unmet',
        note: ca?.note ?? null,
        assessedBy: ca?.assessedBy ?? null,
        assessedAt: iso(ca?.assessedAt),
        waiverId: ca?.waiverId ?? null,
        waiverEffective: !!b.effectiveWaiverId(c.id, ca),
        notApplicable: {
          basis: ca?.naBasis ?? null,
          proposedBy: ca?.naProposedBy ?? null,
          proposedAt: iso(ca?.naProposedAt),
          determinedBy: ca?.naDeterminedBy ?? null,
          determinedRole: ca?.naDeterminedRole ?? null,
          determinedAt: iso(ca?.naDeterminedAt),
          approved: ca?.naApproved ?? false,
        },
        version: ca?.version ?? 1,
      },
    };
  }

  private waiverDto(w: WaiverRow, b: GateBundle) {
    const crit = b.criteria.find((c) => c.id === w.targetId);
    const gate = crit ? b.gates.find((g) => g.id === crit.gateId) : undefined;
    return {
      id: w.id,
      targetType: w.targetType,
      targetId: w.targetId,
      targetKey: crit?.key ?? null,
      gateKey: gate?.key ?? null,
      basis: w.basis,
      impact: w.impact,
      conditions: w.conditions,
      expiresOn: w.expiresOn,
      status: w.status,
      authorityRole: w.authorityRole,
      requestedBy: w.requestedBy,
      decidedBy: w.decidedBy,
      decidedAt: iso(w.decidedAt),
      decisionNote: w.decisionNote,
      effective: w.status === 'approved' && (!w.expiresOn || w.expiresOn >= b.today),
      isDemo: w.isDemo,
      createdAt: w.createdAt.toISOString(),
      version: w.version,
    };
  }
}
