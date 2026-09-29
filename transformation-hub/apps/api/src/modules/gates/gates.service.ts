import { Injectable, OnModuleInit } from '@nestjs/common';
import { and, eq, inArray, isNull, or, gt, sql } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  GATE_ASSESSMENT_MACHINE,
  POLICY_MATRIX,
  DECIDED_GATE_STATUSES,
  APPROVED_GATE_STATUSES,
  transition,
  planReopen,
  carryForwardCriteria,
  assertCriterionEditable,
  assertGateDecisionAllowed,
  assertNotApplicableAllowed,
  assertWaivabilityDetermination,
  gateDecisionIssue,
  gateRag,
  notFound,
  ruleViolation,
  CriterionStatus,
  GateBlocker,
  GateEvaluation,
  GateDecisionBacking,
  RoleKey,
} from '@hub/domain';
import { DbService } from '../../platform/db.service';
import { PolicyService } from '../../platform/policy.service';
import { AuditService } from '../../platform/audit.service';
import { OutboxService } from '../../platform/outbox.service';
import { JobQueue } from '../../platform/jobs/job-queue.service';
import type { RequestContext } from '../../platform/context';
import { assertVersion, loadInProject, nextCode, RecordVersionService, updateVersioned } from '../../platform/helpers';
import { newId } from '../../platform/ids';
import {
  AssessmentRow,
  CriterionAssessmentRow,
  CriterionRow,
  GateBundle,
  GateLoader,
  GateRow,
  ReassessmentFlags,
  reassessmentOf,
  WaiverRow,
} from './gates.evaluation';
import { WaiverService, WaiverRecord, assertHumanActor } from './waiver.service';

type DecisionRow = typeof schema.decision.$inferSelect;

/** Job kind recomputing the status dimensions (subscribed to register/evidence events in gates.jobs.ts). */
export const RECOMPUTE_DIMENSIONS_JOB = 'gates.recompute_dimensions';
export const EVIDENCE_CONFLICTS_JOB = 'gates.evidence_conflicts';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const evalFields = (e: GateEvaluation) => ({ ready: e.ready, hasWaivers: e.hasWaivers, blockers: e.blockers, counts: e.counts });

/** Criterion states whose evidence was relied upon (conflicting evidence invalidates them). */
const RELIES_ON_EVIDENCE: CriterionStatus[] = ['met', 'evidence_submitted'];

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
    return { items: b.gates.map((g) => this.summary(ctx, b, g, decisions)) };
  }

  async getGate(ctx: RequestContext, projectId: string, gateId: string) {
    const b = await this.loader.bundle(projectId, { allCycles: true });
    const gate = b.gate(gateId);
    this.policy.assert(ctx, 'gates.gate.read', { projectId, classification: b.project.classification });
    const cycles = b.cycles(gate.id);
    const decisions = await this.decisionsFor(projectId, cycles.map((a) => a.decisionId), [gate.key]);
    const summary = this.summary(ctx, b, gate, decisions);
    const cur = b.current(gate.id);
    const crits = b.criteriaOf(gate.id);
    const critIds = new Set(crits.map((c) => c.id));
    return {
      ...summary,
      criteria: crits.map((c) => this.criterionDto(b, c, cur)),
      waivers: b.waivers.filter((w) => critIds.has(w.targetId)).map((w) => this.waiverDto(w, b)),
      decisions: [...decisions.values()].filter((d) => this.canSeeDecision(ctx, projectId, d)).map((d) => this.decisionDto(d, gate.key)),
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

  async startAssessment(ctx: RequestContext, projectId: string, gateId: string, body: { expectedVersion: number; note?: string }) {
    const { b, gate, cur } = await this.loadGate(projectId, gateId);
    this.commandAssert(ctx, 'gates.assessment.submit', { projectId, classification: b.project.classification });
    const to = transition('gate_assessment', GATE_ASSESSMENT_MACHINE, cur.status, 'start_assessment');
    await updateVersioned(this.db, schema.gateAssessment, { id: cur.id, projectId, expectedVersion: body.expectedVersion }, { status: to });
    await this.audit.record({ action: 'gates.assessment.start', entityType: 'gate_assessment', entityId: cur.id, projectId, before: { status: cur.status }, after: { status: to, gateKey: gate.key, cycle: cur.cycle }, reason: body.note ?? null });
    return this.assessmentResult(projectId, gate.id);
  }

  /** Submit for decision — only when the server-side evaluation is ready (task progress is not an input). */
  async markReady(ctx: RequestContext, projectId: string, gateId: string, body: { expectedVersion: number; note?: string }) {
    const { b, gate, cur } = await this.loadGate(projectId, gateId);
    this.commandAssert(ctx, 'gates.assessment.submit', { projectId, classification: b.project.classification });
    const to = transition('gate_assessment', GATE_ASSESSMENT_MACHINE, cur.status, 'mark_ready');
    const ev = b.evaluate(gate);
    if (!ev.ready) {
      throw ruleViolation('gates.assessment.not_ready', `Gate ${gate.key} is not ready for decision: ${ev.blockers.length} blocker(s)`, { blockers: ev.blockers });
    }
    await updateVersioned(this.db, schema.gateAssessment, { id: cur.id, projectId, expectedVersion: body.expectedVersion }, {
      status: to,
      submittedBy: ctx.principal.userId,
      submittedAt: new Date(),
      evaluation: { ...((cur.evaluation as Record<string, unknown>) ?? {}), ...evalFields(ev), evaluatedAt: new Date().toISOString() },
    });
    await this.audit.record({ action: 'gates.assessment.mark_ready', entityType: 'gate_assessment', entityId: cur.id, projectId, before: { status: cur.status }, after: { status: to, gateKey: gate.key, counts: ev.counts }, reason: body.note ?? null });
    return this.assessmentResult(projectId, gate.id);
  }

  async backToAssessment(ctx: RequestContext, projectId: string, gateId: string, body: { expectedVersion: number; note?: string }) {
    const { b, gate, cur } = await this.loadGate(projectId, gateId);
    this.commandAssert(ctx, 'gates.assessment.submit', { projectId, classification: b.project.classification });
    const to = transition('gate_assessment', GATE_ASSESSMENT_MACHINE, cur.status, 'back_to_assessment');
    await updateVersioned(this.db, schema.gateAssessment, { id: cur.id, projectId, expectedVersion: body.expectedVersion }, { status: to, submittedBy: null, submittedAt: null });
    await this.audit.record({ action: 'gates.assessment.back_to_assessment', entityType: 'gate_assessment', entityId: cur.id, projectId, before: { status: cur.status }, after: { status: to, gateKey: gate.key }, reason: body.note ?? null });
    return this.assessmentResult(projectId, gate.id);
  }

  /** Link the governance decision that will back the gate decision; until it is final the gate shows a decision blocker. */
  async linkDecision(ctx: RequestContext, projectId: string, gateId: string, body: { expectedVersion: number; decisionId: string }) {
    const { b, gate, cur } = await this.loadGate(projectId, gateId);
    this.commandAssert(ctx, 'gates.assessment.submit', { projectId, classification: b.project.classification });
    if (DECIDED_GATE_STATUSES.includes(cur.status)) throw ruleViolation('gates.assessment.decided', `Gate ${gate.key} cycle ${cur.cycle} is already decided`);
    const d = await this.loadDecision(ctx, projectId, body.decisionId);
    if (d.gateKey && d.gateKey !== gate.key) throw ruleViolation('gates.decision.other_gate', `Decision ${d.code} was raised for gate ${d.gateKey}`);
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
    this.commandAssert(ctx, 'gates.assessment.decide', { projectId, classification: b.project.classification, requesterUserId: cur.submittedBy, withinAuthority });
    const to = transition('gate_assessment', GATE_ASSESSMENT_MACHINE, cur.status, body.outcome);
    const decisionId = body.decisionId ?? cur.decisionId ?? null;
    const d = decisionId ? await this.loadDecision(ctx, projectId, decisionId) : null;
    const ev = b.evaluate(gate);
    const priorDecisionIds = b
      .cycles(gate.id)
      .filter((a) => a.id !== cur.id && a.decisionId && a.status !== 'rejected')
      .map((a) => a.decisionId!);
    assertGateDecisionAllowed({ gateKey: gate.key, outcome: body.outcome, evaluation: ev, decision: d ? this.backing(d) : null, decisionIdsUsedByPriorCycles: priorDecisionIds, note: body.note });
    const now = new Date();
    const atDecision = {
      at: now.toISOString(),
      outcome: body.outcome,
      decidedBy: ctx.principal.userId,
      criteria: b.criteriaOf(gate.id).map((c) => {
        const ca = b.ca(cur.id, c.id);
        const e = b.evidenceOf(c.id);
        return { criterionId: c.id, key: c.key, status: ca?.status ?? 'unmet', activeEvidence: e.active, conflictingEvidence: e.conflicting, waiverId: ca?.waiverId ?? null };
      }),
      prerequisites: b.prerequisites(gate),
      decision: d ? { id: d.id, code: d.code, status: d.status, authorityOutcome: d.authorityOutcome, externalAuthorityReference: d.externalAuthorityReference } : null,
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
      after: { status: to, gateKey: gate.key, cycle: cur.cycle, decisionId: d?.id ?? null, decisionStatus: d?.status ?? null, authorityOutcome: d?.authorityOutcome ?? null },
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
    this.commandAssert(ctx, 'gates.evidence.attach', { projectId, classification: b.project.classification });
    assertCriterionEditable(gate.key, cur.status);
    const ca = await this.ensureCa(ctx, b, cur, crit);
    this.assertFrom(crit, ca, ['unmet', 'conflicting'], 'evidence_submitted');
    const ev = b.evidenceOf(crit.id);
    if (ev.conflicting > 0) throw ruleViolation('gates.criterion.evidence_conflict', `Criterion ${crit.key} has conflicting evidence that must be resolved first`);
    if (crit.evidenceRequired && ev.active === 0) throw ruleViolation('gates.criterion.no_evidence', `Criterion ${crit.key} has no active evidence linked`);
    return this.writeCriterion(ctx, projectId, gate, crit, ca, body.expectedVersion, { status: 'evidence_submitted', note: body.note ?? ca.note }, 'gates.criterion.submit_evidence', body.note);
  }

  /**
   * Reviewer accepts (met) or returns (unmet) a criterion. `met` requires active evidence (when evidence is required), no
   * conflicting evidence, and a reviewer who is not an owner of that evidence (policy not_self).
   */
  async reviewCriterion(ctx: RequestContext, projectId: string, gateId: string, criterionId: string, body: { expectedVersion: number; outcome: 'met' | 'unmet'; note?: string }) {
    const { b, gate, crit, cur } = await this.loadCriterion(projectId, gateId, criterionId);
    const ev = b.evidenceOf(crit.id);
    const actor = ctx.principal.userId;
    const evidenceOwner = body.outcome === 'met' ? (actor && ev.submitters.includes(actor) ? actor : (ev.submitters[0] ?? null)) : null;
    this.commandAssert(ctx, 'gates.assessment.review', { projectId, classification: b.project.classification, requesterUserId: evidenceOwner });
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
    this.commandAssert(ctx, 'gates.evidence.attach', { projectId, classification: b.project.classification });
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
    this.commandAssert(ctx, 'gates.assessment.review', { projectId, classification: b.project.classification, requesterUserId: ca0?.naProposedBy ?? null });
    assertCriterionEditable(gate.key, cur.status);
    if (!ca0 || ca0.status !== 'not_applicable' || ca0.naApproved) throw ruleViolation('gates.na.no_proposal', `Criterion ${crit.key} has no pending not-applicable proposal`);
    if (body.approve) {
      assertNotApplicableAllowed({
        criterionKey: crit.key,
        reviewerRole: crit.reviewerRole,
        determinerRoles: this.rolesOf(ctx, projectId),
        determinerUserId: ctx.principal.userId ?? '',
        proposerUserId: ca0.naProposedBy ?? '',
        basis: ca0.naBasis ?? '',
      });
      return this.writeCriterion(
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
    }
    return this.writeCriterion(ctx, projectId, gate, crit, ca0, body.expectedVersion, { status: 'unmet', ...this.clearNa(), note: body.note ?? ca0.note }, 'gates.criterion.reject_not_applicable', body.note);
  }

  async updateCriterionNote(ctx: RequestContext, projectId: string, gateId: string, criterionId: string, body: { expectedVersion: number; note: string }) {
    const { b, gate, crit, cur } = await this.loadCriterion(projectId, gateId, criterionId);
    this.commandAssert(ctx, 'gates.evidence.attach', { projectId, classification: b.project.classification });
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
    const { b, crit } = await this.loadCriterion(projectId, gateId, criterionId);
    this.commandAssert(ctx, 'gates.criterion.set_waivability', { projectId, classification: b.project.classification });
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
      snapshot: { key: crit.key, waivable: body.waivable, waiverAuthorityRole: role, waivabilityBasis: body.waivabilityBasis, determinedBy: ctx.principal.userId },
      reason: 'waivability determination',
    });
    await this.audit.record({
      action: 'gates.criterion.set_waivability',
      entityType: 'gate_criterion',
      entityId: crit.id,
      projectId,
      before,
      after: { waivable: body.waivable, waiverAuthorityRole: role, waivabilityBasis: body.waivabilityBasis, criterionKey: crit.key },
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
  // Evidence conflicts → controlled reassessment (AT-14) — runs in the worker under a service principal

  async processEvidenceConflicts(projectId: string): Promise<{ markedConflicting: string[]; flaggedGates: string[] }> {
    const b = await this.loader.bundle(projectId);
    const marked: string[] = [];
    const flagged: string[] = [];
    for (const gate of b.gates) {
      const cur = b.current(gate.id);
      const conflictingCrits = b.criteriaOf(gate.id).filter((c) => b.evidenceOf(c.id).conflicting > 0);
      if (!conflictingCrits.length || cur.status === 'rejected') continue;
      if (APPROVED_GATE_STATUSES.includes(cur.status)) {
        // Decided cycle: NEVER modified (status, decision, criterion rows). Flag it and request a controlled reopen.
        const relied = conflictingCrits.filter((c) => RELIES_ON_EVIDENCE.includes(b.ca(cur.id, c.id)?.status ?? 'unmet'));
        const flags = reassessmentOf(await this.readAssessment(cur.id));
        const fresh = relied.filter((c) => !flags.criteria.some((x) => x.criterionId === c.id));
        if (!fresh.length) continue;
        flags.needsReassessment = true;
        flags.requestedAt ??= new Date().toISOString();
        flags.criteria.push(...fresh.map((c) => ({ criterionId: c.id, key: c.key, evidenceLinkIds: b.evidenceOf(c.id).conflictingLinkIds })));
        flags.escalationId ??= await this.raiseReassessmentEscalation(b, gate, cur, fresh);
        await this.writeFlags(cur.id, flags);
        await this.audit.record({
          action: 'gates.assessment.flag_reassessment',
          entityType: 'gate_assessment',
          entityId: cur.id,
          projectId,
          after: { gateKey: gate.key, status: cur.status, needsReassessment: true, criteria: fresh.map((c) => c.key), escalationId: flags.escalationId },
          reason: 'Evidence relied upon by the approved gate is conflicting — controlled reassessment requested',
        });
        await this.notifyReopenAuthorities(b, gate, cur, fresh);
        await this.outbox.emit({
          type: 'gate.blocked',
          projectId,
          aggregateType: 'gate_assessment',
          aggregateId: cur.id,
          payload: { gateId: gate.id, gateKey: gate.key, reason: 'evidence_conflict_on_decided_gate', needsReassessment: true, criteria: fresh.map((c) => c.key) },
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
        flagged.push(gate.key);
        continue;
      }
      for (const c of conflictingCrits) {
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
          after: { status: 'conflicting', criterionKey: c.key, evidenceLinkIds: b.evidenceOf(c.id).conflictingLinkIds },
        });
        marked.push(c.key);
      }
    }
    await this.refreshEvaluations(projectId);
    return { markedConflicting: marked, flaggedGates: flagged };
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

  private rolesOf(ctx: RequestContext, projectId: string): RoleKey[] {
    const s = ctx.principal.projects.get(projectId);
    return s ? [...s.roles] : [];
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
    return { assessmentId: cur.id, cycle: cur.cycle, status: cur.status, version: cur.version, evaluation: evaluations.get(gateId)! };
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

  private async raiseReassessmentEscalation(b: GateBundle, gate: GateRow, cur: AssessmentRow, crits: CriterionRow[]): Promise<string> {
    const id = newId();
    const code = await nextCode(this.db, schema.escalation, b.project.id, 'ESC');
    const keys = crits.map((c) => c.key).join(', ');
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
        requestedAction: `Evidence relied upon for ${keys} is now conflicting. Decide whether to reopen gate ${gate.key} through the controlled reopen; the approved cycle ${cur.cycle} and its decision remain preserved.`,
        options: [
          { title: `Reopen gate ${gate.key} (new assessment cycle)`, impact: 'Gate returns to assessment; downstream gates flagged for review' },
          { title: 'Resolve the evidence conflict and record that the approval stands', impact: 'Requires a documented resolution of the conflicting evidence' },
        ],
        status: 'open',
        isSystemGenerated: true,
        isDemo: b.project.isDemo,
      });
    await this.audit.record({ action: 'gates.escalation.raise', entityType: 'escalation', entityId: id, projectId: b.project.id, after: { code, gateKey: gate.key, criteria: keys, sourceId: cur.id } });
    return id;
  }

  /** In-app notifications to holders of `gates.assessment.reopen` in the project (deduplicated per cycle + criterion). */
  private async notifyReopenAuthorities(b: GateBundle, gate: GateRow, cur: AssessmentRow, crits: CriterionRow[]) {
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
    const keys = crits.map((c) => c.key);
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
          body: `Evidence relied upon for ${keys.join(', ')} is conflicting. The approval of cycle ${cur.cycle} is preserved; decide whether to reopen.`,
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
    return { id: d.id, status: d.status, authorityOutcome: d.authorityOutcome, externalAuthorityReference: d.externalAuthorityReference, gateKey: d.gateKey };
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

  private summary(ctx: RequestContext, b: GateBundle, g: GateRow, decisions: Map<string, DecisionRow>) {
    const cur = b.current(g.id);
    const evaluation = b.evaluate(g);
    const flags = reassessmentOf(cur);
    const d = cur.decisionId ? decisions.get(cur.decisionId) : undefined;
    const blockers: GateBlocker[] = [...evaluation.blockers];
    if (!DECIDED_GATE_STATUSES.includes(cur.status) && (cur.decisionId || cur.status === 'ready_for_decision')) {
      // The blocker exposes only the decision's status (never its title) so it is safe for every gate reader.
      const issue = gateDecisionIssue(d ? this.backing(d) : null, g.key);
      if (issue) blockers.push(issue);
    }
    return {
      id: g.id,
      key: g.key,
      name: g.name,
      nameAr: g.nameAr,
      purpose: g.purpose,
      sortOrder: g.sortOrder,
      prerequisiteGateKeys: g.prerequisiteGateKeys ?? [],
      ownerRole: g.ownerRole,
      reviewerRole: g.reviewerRole,
      approverRole: g.approverRole,
      version: g.version,
      assessment: this.assessmentDto(cur),
      evaluation,
      prerequisites: b.prerequisites(g),
      decision: d && this.canSeeDecision(ctx, b.project.id, d) ? this.decisionDto(d, g.key) : null,
      blockers,
      rag: gateRag(cur.status, evaluation, flags.needsReassessment),
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
      reopenedReason: a.reopenedReason,
      supersedesAssessmentId: a.supersedesAssessmentId,
      createdAt: a.createdAt.toISOString(),
      reassessment: reassessmentOf(a),
    };
  }

  private decisionDto(d: DecisionRow, gateKey: string) {
    return {
      id: d.id,
      code: d.code,
      title: d.title,
      status: d.status,
      authorityOutcome: d.authorityOutcome,
      gateKey: d.gateKey,
      isDemo: d.isDemo,
      blocker: gateDecisionIssue(this.backing(d), gateKey)?.message ?? null,
    };
  }

  private criterionDto(b: GateBundle, c: CriterionRow, cur: AssessmentRow) {
    const ca = b.ca(cur.id, c.id);
    const ev = b.evidenceOf(c.id);
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
