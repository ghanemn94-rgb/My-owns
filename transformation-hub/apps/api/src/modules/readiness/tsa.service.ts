import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, SQL } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  CLASSIFICATIONS,
  TSA_DECISION_TYPE_KEYS,
  TSA_MACHINE,
  TSA_SIMPLE_COMMANDS,
  allowedCommands,
  assessTsaExpiry,
  assertDecisionLinkable,
  assertExtensionRequestValid,
  assertReplacementAcceptable,
  assertTsaApprovable,
  assertTsaExitAcceptable,
  assertTsaExitApprovalSeparation,
  assertTsaExitStartable,
  assertTsaExtensionAllowed,
  conflict,
  invalid,
  linkedDecisionIssue,
  notFound,
  ruleViolation,
  transition,
  tsaExpiryAction,
  Classification,
  DomainError,
  TsaCommand,
  TsaExpiryAssessment,
  TsaSimpleCommand,
  TsaStatus,
} from '@hub/domain';
import type { RequestContext } from '../../platform/context';
import { assertVersion, likeContains, loadInProject, nextCode, offsetOf, pageOf, updateVersioned } from '../../platform/helpers';
import { newId, payloadHash } from '../../platform/ids';
import { nextCronRun } from '../../platform/jobs/worker.service';
import { ReadinessSupport, ProjectRow, iso } from './readiness.support';

type TsaRow = typeof schema.tsaService.$inferSelect;
type Money = { amount: string; currency: string; unitScale: 1 | 1000 | 1000000 };

/** Days before the end date at which the expiry job starts warning (proposed default, to be confirmed). */
export const TSA_EXPIRY_WARN_DAYS = 30;
/** Scheduled job kind scanning a project's TSAs for expiry (per-project schedule, created with the first TSA). */
export const TSA_EXPIRY_JOB = 'readiness.tsa_expiry_scan';
/** Daily at 06:00 in the project timezone (proposed default). */
export const TSA_EXPIRY_CRON = '0 6 * * *';

/** Statuses the expiry job looks at (proposed/negotiating have no committed end; exit_accepted is closed). */
const LIVE_STATUSES: TsaStatus[] = ['approved', 'active', 'extended', 'exit_in_progress', 'breached', 'expired_unresolved'];
/** Statuses in which a replacement failure can be reported. */
const FAILURE_STATUSES: TsaStatus[] = ['approved', 'active', 'extended', 'exit_in_progress', 'expired_unresolved', 'breached'];

export interface TsaBody {
  name?: string;
  agreementId?: string | null;
  providerEntityId?: string | null;
  recipientEntityId?: string | null;
  scope?: string | null;
  dependentServices?: string | null;
  sla?: string | null;
  metricMethod?: string | null;
  chargeBasis?: string | null;
  charge?: Money | null;
  startDate?: string | null;
  endDate?: string | null;
  extensionTerms?: string | null;
  terminationTerms?: string | null;
  ownerUserId?: string | null;
  workstreamId?: string | null;
  replacementService?: string | null;
  replacementPlan?: string | null;
  replacementDueDate?: string | null;
  exitMilestones?: { title: string; dueDate?: string; done?: boolean }[];
  residualRisks?: string | null;
  isEnduringArrangement?: boolean;
  classification?: Classification;
}

/** Body fields → columns (money is split into its three columns). */
function columnsOf(b: TsaBody): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(b)) {
    if (v === undefined || k === 'charge') continue;
    out[k] = v;
  }
  if (b.charge !== undefined) {
    out['chargeAmount'] = b.charge?.amount ?? null;
    out['chargeCurrency'] = b.charge?.currency ?? null;
    out['chargeUnitScale'] = b.charge?.unitScale ?? null;
  }
  return out;
}

const rank = (c: Classification) => CLASSIFICATIONS.indexOf(c);

/**
 * TSA services (spec §7.3; REQ-TSA-001..006; AT-10; REQ-LCY-014). Reaching the end date is never an exit: the expiry job
 * moves an unreplaced service to expired_unresolved and escalates; extensions need a FINAL governance decision and are
 * never automatic; approveTSAExit needs an accepted replacement with evidence and an independent approver.
 */
@Injectable()
export class TsaService {
  constructor(private readonly s: ReadinessSupport) {}

  // ---------------------------------------------------------------------------------------------------------
  // Reads

  private async loadReadable(ctx: RequestContext, projectId: string, id: string): Promise<TsaRow> {
    const t = await loadInProject(this.s.db, schema.tsaService, projectId, id);
    if (!this.s.policy.can(ctx, 'readiness.register.read', { projectId, workstreamId: t.workstreamId, classification: t.classification })) throw notFound();
    return t;
  }

  scopeSql(ctx: RequestContext, projectId: string): SQL {
    const t = schema.tsaService;
    return and(eq(t.projectId, projectId), this.s.policy.visibilitySql(ctx, projectId, { classification: t.classification }), this.s.policy.reachSql(ctx, 'readiness.register.read', projectId, t.workstreamId))!;
  }

  private expiryOf(t: TsaRow, today: string): { kind: TsaExpiryAssessment['kind']; days: number | null } {
    const a = assessTsaExpiry({ status: t.status, endDate: t.endDate, replacementAccepted: t.replacementAccepted, today, warnDays: TSA_EXPIRY_WARN_DAYS });
    switch (a.kind) {
      case 'ok':
        return { kind: 'ok', days: null };
      case 'expiring':
        return { kind: 'expiring', days: a.daysLeft };
      default:
        return { kind: a.kind, days: a.daysOverdue };
    }
  }

  private dto(t: TsaRow, today: string) {
    return {
      id: t.id,
      code: t.code,
      name: t.name,
      status: t.status,
      ownerUserId: t.ownerUserId,
      workstreamId: t.workstreamId,
      providerEntityId: t.providerEntityId,
      recipientEntityId: t.recipientEntityId,
      startDate: t.startDate,
      endDate: t.endDate,
      replacementService: t.replacementService,
      replacementAccepted: t.replacementAccepted,
      isEnduringArrangement: t.isEnduringArrangement,
      escalationId: t.escalationId,
      classification: t.classification,
      expiry: this.expiryOf(t, today),
      isDemo: t.isDemo,
      createdAt: t.createdAt.toISOString(),
      version: t.version,
    };
  }

  async list(ctx: RequestContext, projectId: string, q: { page: number; pageSize: number; q?: string; status?: TsaStatus; workstreamId?: string; enduring?: 'true' | 'false' }) {
    const p = await this.s.project(projectId);
    this.s.policy.assert(ctx, 'readiness.register.read', { projectId });
    const t = schema.tsaService;
    const where = and(
      this.scopeSql(ctx, projectId),
      q.status ? eq(t.status, q.status) : undefined,
      q.workstreamId ? eq(t.workstreamId, q.workstreamId) : undefined,
      q.enduring ? eq(t.isEnduringArrangement, q.enduring === 'true') : undefined,
      q.q ? or(ilike(t.name, likeContains(q.q)), ilike(t.code, likeContains(q.q))) : undefined,
    );
    const tx = this.s.db.tx();
    const [{ total }] = (await tx.select({ total: count() }).from(t).where(where)) as [{ total: number }];
    const rows = await tx.select().from(t).where(where).orderBy(asc(t.code)).limit(q.pageSize).offset(offsetOf(q));
    const today = this.s.today(p);
    return pageOf(
      rows.map((r) => this.dto(r, today)),
      Number(total),
      q,
    );
  }

  async get(ctx: RequestContext, projectId: string, id: string) {
    const t = await this.loadReadable(ctx, projectId, id);
    const p = await this.s.project(projectId);
    const today = this.s.today(p);
    // Charge basis/amount: finance readers only (REQ-TSA-001 security rule).
    const showCharge = this.s.policy.canInProject(ctx, 'finance.record.read', projectId);
    const esc = t.escalationId && this.s.policy.canInProject(ctx, 'governance.decision.read', projectId) ? await loadInProject(this.s.db, schema.escalation, projectId, t.escalationId) : null;
    const req = t.exitApprovalRequestId ? await loadInProject(this.s.db, schema.approvalRequest, projectId, t.exitApprovalRequestId) : null;
    const d = await this.s.decisionRow(projectId, t.extensionDecisionId);
    return {
      ...this.dto(t, today),
      agreementId: t.agreementId,
      scope: t.scope,
      dependentServices: t.dependentServices,
      sla: t.sla,
      metricMethod: t.metricMethod,
      chargeBasis: showCharge ? t.chargeBasis : null,
      charge: showCharge && t.chargeAmount && t.chargeCurrency && t.chargeUnitScale ? { amount: t.chargeAmount, currency: t.chargeCurrency, unitScale: t.chargeUnitScale as Money['unitScale'] } : null,
      chargeRedacted: !showCharge && (!!t.chargeBasis || !!t.chargeAmount),
      extensionTerms: t.extensionTerms,
      terminationTerms: t.terminationTerms,
      replacementPlan: t.replacementPlan,
      replacementDueDate: t.replacementDueDate,
      replacementAcceptedBy: t.replacementAcceptedBy,
      replacementAcceptedAt: iso(t.replacementAcceptedAt),
      replacementFailedAt: iso(t.replacementFailedAt),
      replacementFailureNote: t.replacementFailureNote,
      exitMilestones: t.exitMilestones,
      acceptanceEvidenceNote: t.acceptanceEvidenceNote,
      residualRisks: t.residualRisks,
      approvalDecisionId: t.approvalDecisionId,
      extensionDecisionId: t.extensionDecisionId,
      proposedEndDate: t.proposedEndDate,
      extensionRequestedBy: t.extensionRequestedBy,
      extensionRequestedAt: iso(t.extensionRequestedAt),
      continuityPlan: t.continuityPlan,
      exitApprovalRequestId: t.exitApprovalRequestId,
      exitApprovalStatus: req?.status ?? null,
      exitApprovalRequestedBy: req?.requestedBy ?? null,
      exitApprovedBy: t.exitApprovedBy,
      exitApprovedAt: iso(t.exitApprovedAt),
      evidence: await this.s.evidence(projectId, 'tsa_service', t.id),
      escalation: esc
        ? { id: esc.id, code: esc.code, status: esc.status, requestedAction: esc.requestedAction, decisionDeadline: esc.decisionDeadline, options: esc.options, target: esc.target }
        : null,
      extensionDecision: this.s.decisionSummary(ctx, projectId, d, TSA_DECISION_TYPE_KEYS, 'a TSA extension'),
      allowedCommands: allowedCommands(TSA_MACHINE, t.status),
    };
  }

  // ---------------------------------------------------------------------------------------------------------
  // Commands

  private assertManage(ctx: RequestContext, projectId: string, t: Pick<TsaRow, 'workstreamId' | 'ownerUserId' | 'createdBy' | 'classification'>) {
    this.s.policy.assert(ctx, 'readiness.tsa.manage', { projectId, workstreamId: t.workstreamId, classification: t.classification, ownerUserIds: [t.ownerUserId, t.createdBy] });
  }

  private async validate(ctx: RequestContext, projectId: string, b: TsaBody) {
    await this.s.assertRefs(ctx, projectId, { agreementId: b.agreementId, workstreamId: b.workstreamId, legalEntityIds: [b.providerEntityId, b.recipientEntityId] });
    if (b.ownerUserId) await this.s.assertMember(projectId, b.ownerUserId, 'ownerUserId');
  }

  private static assertDates(start: string | null | undefined, end: string | null | undefined) {
    if (start && end && end <= start) throw invalid('tsa.dates_invalid', 'The TSA end date must be after its start date');
  }

  async create(ctx: RequestContext, projectId: string, body: TsaBody & { name: string }) {
    const p = await this.s.project(projectId);
    const classification = body.classification ?? 'confidential';
    this.s.policy.assert(ctx, 'readiness.tsa.manage', { projectId, workstreamId: body.workstreamId ?? null, classification, ownerUserIds: [ctx.principal.userId] });
    await this.validate(ctx, projectId, body);
    TsaService.assertDates(body.startDate, body.endDate);
    const id = newId();
    const code = await nextCode(this.s.db, schema.tsaService, projectId, 'TSA');
    const [row] = await this.s.db
      .tx()
      .insert(schema.tsaService)
      .values({ ...(columnsOf(body) as Partial<TsaRow>), id, orgId: ctx.principal.orgId, projectId, code, name: body.name, classification, status: 'proposed', isDemo: p.isDemo, createdBy: ctx.principal.userId })
      .returning();
    await this.s.versions.snapshot({ projectId, entityType: 'tsa_service', entityId: id, versionNo: 1, snapshot: row!, reason: 'created' });
    await this.s.audit.record({ action: 'readiness.tsa.create', entityType: 'tsa_service', entityId: id, projectId, after: { code, name: body.name, endDate: body.endDate ?? null, ownerUserId: body.ownerUserId ?? null, isEnduringArrangement: body.isEnduringArrangement ?? false } });
    await this.ensureExpirySchedule(ctx, p);
    await this.s.enqueueDimensions(ctx, projectId, `tsa:${id}:1`);
    return { id, code, version: 1 };
  }

  async update(ctx: RequestContext, projectId: string, id: string, body: TsaBody & { expectedVersion: number }) {
    const t = await loadInProject(this.s.db, schema.tsaService, projectId, id);
    this.assertManage(ctx, projectId, t);
    const { expectedVersion, ...rest } = body;
    const cols = columnsOf(rest);
    const current = t as unknown as Record<string, unknown>;
    const effective = Object.fromEntries(Object.entries(cols).filter(([k, v]) => (typeof v === 'object' && v !== null ? JSON.stringify(current[k]) !== JSON.stringify(v) : current[k] !== v)));
    if (Object.keys(effective).length === 0) {
      assertVersion(t, expectedVersion, 'TSA service');
      return { id: t.id, version: t.version };
    }
    if (t.status === 'exit_accepted') throw ruleViolation('tsa.locked', 'The TSA exit is accepted; the record is closed');
    if (!['proposed', 'negotiating'].includes(t.status) && ('startDate' in effective || 'endDate' in effective)) {
      throw ruleViolation('tsa.dates_locked', 'The dates of an approved TSA change only through an approved extension (request-extension / record-extension)');
    }
    if (t.replacementAccepted && ('replacementService' in effective || 'replacementPlan' in effective)) {
      throw ruleViolation('tsa.replacement_locked', 'The replacement was accepted as defined; report a replacement failure before redefining it');
    }
    if (effective['classification'] && rank(effective['classification'] as Classification) < rank(t.classification)) {
      throw ruleViolation('tsa.declassification', 'Lowering the classification of a TSA record is a declassification decision outside this command');
    }
    if (effective['workstreamId']) this.s.policy.assert(ctx, 'readiness.tsa.manage', { projectId, workstreamId: effective['workstreamId'] as string, classification: t.classification, ownerUserIds: [t.ownerUserId, t.createdBy] });
    await this.validate(ctx, projectId, effective as TsaBody);
    TsaService.assertDates(('startDate' in effective ? effective['startDate'] : t.startDate) as string | null, ('endDate' in effective ? effective['endDate'] : t.endDate) as string | null);
    const row = (await updateVersioned(this.s.db, schema.tsaService, { id: t.id, projectId, expectedVersion }, effective)) as TsaRow;
    await this.s.versions.snapshot({ projectId, entityType: 'tsa_service', entityId: t.id, versionNo: row.version, snapshot: row, reason: 'updated' });
    await this.s.audit.record({
      action: 'readiness.tsa.update',
      entityType: 'tsa_service',
      entityId: t.id,
      projectId,
      before: Object.fromEntries(Object.keys(effective).map((k) => [k, current[k]])),
      after: effective,
    });
    if ('isEnduringArrangement' in effective || 'workstreamId' in effective) await this.s.enqueueDimensions(ctx, projectId, `tsa:${t.id}:${row.version}`);
    return { id: t.id, version: row.version };
  }

  private async applyStatus(ctx: RequestContext, t: TsaRow, cmd: TsaCommand, expectedVersion: number, values: Record<string, unknown>, reason: string | null, extraAudit: Record<string, unknown> = {}) {
    const to = transition('tsa', TSA_MACHINE, t.status, cmd);
    const row = (await updateVersioned(this.s.db, schema.tsaService, { id: t.id, projectId: t.projectId, expectedVersion }, { status: to, ...values })) as TsaRow;
    await this.s.versions.snapshot({ projectId: t.projectId, entityType: 'tsa_service', entityId: t.id, versionNo: row.version, snapshot: row, reason: cmd });
    await this.s.audit.record({ action: `readiness.tsa.${cmd}`, entityType: 'tsa_service', entityId: t.id, projectId: t.projectId, before: { status: t.status }, after: { status: to, ...extraAudit }, reason });
    await this.s.enqueueDimensions(ctx, t.projectId, `tsa:${t.id}:${row.version}`);
    return row;
  }

  /** REQ-TSA-002: plain state-machine commands (guarded commands have dedicated endpoints). Illegal transitions → 422. */
  async transitionSimple(ctx: RequestContext, projectId: string, id: string, body: { expectedVersion: number; command: TsaSimpleCommand; note?: string }) {
    const t = await loadInProject(this.s.db, schema.tsaService, projectId, id);
    this.assertManage(ctx, projectId, t);
    if (!(TSA_SIMPLE_COMMANDS as readonly string[]).includes(body.command)) throw invalid('tsa.command_not_allowed', `${body.command} has its own command`);
    if (body.command === 'start_exit') assertTsaExitStartable(t);
    if ((body.command === 'record_breach' || body.command === 'remedy_breach') && !body.note?.trim()) {
      throw ruleViolation('tsa.note_required', 'Describe the breach / the remedy');
    }
    const row = await this.applyStatus(ctx, t, body.command, body.expectedVersion, {}, body.note ?? null);
    return { id: t.id, status: row.status, version: row.version };
  }

  /** Terms approval: a FINAL governance decision of type tsa_approval_or_extension + a complete record (REQ-TSA-001). */
  async approveTerms(ctx: RequestContext, projectId: string, id: string, body: { expectedVersion: number; decisionId: string; note?: string }) {
    const t = await loadInProject(this.s.db, schema.tsaService, projectId, id);
    this.assertManage(ctx, projectId, t);
    const d = await this.s.decision(ctx, projectId, body.decisionId);
    assertDecisionLinkable(this.s.linked(d), TSA_DECISION_TYPE_KEYS, 'A TSA approval');
    const issue = linkedDecisionIssue(this.s.linked(d), TSA_DECISION_TYPE_KEYS, 'a TSA approval');
    if (issue) throw ruleViolation('tsa.approve.decision_not_final', issue, { decisionId: d.id, decisionStatus: d.status, authorityOutcome: d.authorityOutcome });
    assertTsaApprovable(t);
    const row = await this.applyStatus(ctx, t, 'approve', body.expectedVersion, { approvalDecisionId: d.id }, body.note ?? null, { decisionId: d.id, decisionCode: d.code });
    return { id: t.id, status: row.status, version: row.version };
  }

  /** Replacement acceptance on the basis of acceptance evidence linked (documents module) to the TSA service. */
  async acceptReplacement(ctx: RequestContext, projectId: string, id: string, body: { expectedVersion: number; note: string }) {
    const t = await loadInProject(this.s.db, schema.tsaService, projectId, id);
    this.assertManage(ctx, projectId, t);
    const ev = await this.s.evidence(projectId, 'tsa_service', t.id);
    assertReplacementAcceptable({ status: t.status, replacementService: t.replacementService, replacementAccepted: t.replacementAccepted, activeEvidenceCount: ev.active, conflictingEvidenceCount: ev.conflicting, note: body.note });
    const row = (await updateVersioned(this.s.db, schema.tsaService, { id: t.id, projectId, expectedVersion: body.expectedVersion }, {
      replacementAccepted: true,
      replacementAcceptedBy: ctx.principal.userId,
      replacementAcceptedAt: this.s.clock.now(),
      acceptanceEvidenceNote: body.note,
    })) as TsaRow;
    await this.s.versions.snapshot({ projectId, entityType: 'tsa_service', entityId: t.id, versionNo: row.version, snapshot: row, reason: 'replacement accepted' });
    await this.s.audit.record({ action: 'readiness.tsa.accept_replacement', entityType: 'tsa_service', entityId: t.id, projectId, before: { replacementAccepted: false }, after: { replacementAccepted: true, activeEvidence: ev.active }, reason: body.note });
    return { id: t.id, status: row.status, version: row.version };
  }

  /**
   * REQ-TSA-004 / AT-10: a replacement failure withdraws any replacement acceptance, records the continuity plan and raises
   * an escalation (decision requested) with extension / continuity options routed per the authority matrix. Nothing is
   * extended — the extension needs its own approved decision.
   */
  async reportReplacementFailure(ctx: RequestContext, projectId: string, id: string, body: { expectedVersion: number; failureSummary: string; continuityPlan: string; decisionDeadline: string }) {
    const t = await loadInProject(this.s.db, schema.tsaService, projectId, id);
    this.assertManage(ctx, projectId, t);
    if (!FAILURE_STATUSES.includes(t.status)) throw ruleViolation('tsa.replacement_failure.invalid_state', `A replacement failure cannot be reported while the TSA is ${t.status}`);
    const p = await this.s.project(projectId);
    if (body.decisionDeadline < this.s.today(p)) throw invalid('tsa.decision_deadline_past', 'The decision deadline is in the past');
    const escalationId = await this.raiseEscalation(ctx, p, t, {
      reason: 'replacement_failure',
      title: `TSA ${t.code} — replacement service failed: continuity / extension decision required`,
      requestedAction: `The replacement for TSA ${t.code} (${t.name}) failed: ${body.failureSummary}. Decide on continuity: extension of the TSA (requires an approved decision; never automatic) or an alternative interim arrangement. Continuity plan: ${body.continuityPlan}`,
      decisionDeadline: body.decisionDeadline,
    });
    await this.invalidatePendingExit(t, 'replacement failure reported');
    const row = (await updateVersioned(this.s.db, schema.tsaService, { id: t.id, projectId, expectedVersion: body.expectedVersion }, {
      replacementAccepted: false,
      replacementAcceptedBy: null,
      replacementAcceptedAt: null,
      replacementFailedAt: this.s.clock.now(),
      replacementFailureNote: body.failureSummary,
      continuityPlan: body.continuityPlan,
      escalationId,
    })) as TsaRow;
    await this.s.versions.snapshot({ projectId, entityType: 'tsa_service', entityId: t.id, versionNo: row.version, snapshot: row, reason: 'replacement failure' });
    await this.s.audit.record({
      action: 'readiness.tsa.replacement_failure',
      entityType: 'tsa_service',
      entityId: t.id,
      projectId,
      before: { replacementAccepted: t.replacementAccepted, status: t.status },
      after: { replacementAccepted: false, status: row.status, escalationId, decisionDeadline: body.decisionDeadline },
      reason: body.failureSummary,
    });
    return { id: t.id, status: row.status, version: row.version, escalationId };
  }

  /** Extension options await an approved decision: link it with the proposed end date and continuity plan. */
  async requestExtension(ctx: RequestContext, projectId: string, id: string, body: { expectedVersion: number; decisionId: string; proposedEndDate: string; continuityPlan: string; note?: string }) {
    const t = await loadInProject(this.s.db, schema.tsaService, projectId, id);
    this.assertManage(ctx, projectId, t);
    const d = await this.s.decision(ctx, projectId, body.decisionId);
    assertDecisionLinkable(this.s.linked(d), TSA_DECISION_TYPE_KEYS, 'A TSA extension');
    assertExtensionRequestValid({ status: t.status, currentEndDate: t.endDate, proposedEndDate: body.proposedEndDate, continuityPlan: body.continuityPlan });
    if (t.extensionDecisionId === d.id && t.status === 'extended' && !t.proposedEndDate) {
      throw ruleViolation('tsa.extension.decision_already_used', 'This decision already authorized the current extension; a further extension needs a new decision');
    }
    const row = (await updateVersioned(this.s.db, schema.tsaService, { id: t.id, projectId, expectedVersion: body.expectedVersion }, {
      extensionDecisionId: d.id,
      proposedEndDate: body.proposedEndDate,
      continuityPlan: body.continuityPlan,
      extensionRequestedBy: ctx.principal.userId,
      extensionRequestedAt: this.s.clock.now(),
    })) as TsaRow;
    await this.s.versions.snapshot({ projectId, entityType: 'tsa_service', entityId: t.id, versionNo: row.version, snapshot: row, reason: 'extension requested' });
    await this.s.audit.record({ action: 'readiness.tsa.request_extension', entityType: 'tsa_service', entityId: t.id, projectId, after: { decisionId: d.id, decisionStatus: d.status, proposedEndDate: body.proposedEndDate }, reason: body.note ?? null });
    return { id: t.id, status: row.status, version: row.version };
  }

  /** REQ-TSA-005: the extension takes effect ONLY when the linked decision is a final approval. Never automatic. */
  async recordExtension(ctx: RequestContext, projectId: string, id: string, body: { expectedVersion: number; note?: string }) {
    const t = await loadInProject(this.s.db, schema.tsaService, projectId, id);
    this.assertManage(ctx, projectId, t);
    if (!t.proposedEndDate || !t.extensionDecisionId) throw ruleViolation('tsa.extension.not_requested', 'Request the extension (decision, new end date, continuity plan) first');
    const d = await this.s.decisionRow(projectId, t.extensionDecisionId);
    const issue = d ? linkedDecisionIssue(this.s.linked(d), TSA_DECISION_TYPE_KEYS, 'a TSA extension') : 'The linked decision no longer exists';
    try {
      assertTsaExtensionAllowed({ extensionDecisionApproved: issue === null, newEndDate: t.proposedEndDate, continuityPlan: t.continuityPlan });
    } catch (e) {
      if (e instanceof DomainError && e.code === 'tsa.extension_requires_decision') {
        throw ruleViolation(e.code, `${e.message} (${issue})`, { decisionId: t.extensionDecisionId, decisionStatus: d?.status ?? null, issue });
      }
      throw e;
    }
    const row = await this.applyStatus(
      ctx,
      t,
      'record_extension',
      body.expectedVersion,
      { endDate: t.proposedEndDate, proposedEndDate: null },
      body.note ?? null,
      { previousEndDate: t.endDate, endDate: t.proposedEndDate, decisionId: t.extensionDecisionId },
    );
    return { id: t.id, status: row.status, version: row.version };
  }

  private exitPayload(t: TsaRow, activeEvidence: number) {
    return { tsaServiceId: t.id, replacementService: t.replacementService, replacementAcceptedBy: t.replacementAcceptedBy, replacementAcceptedAt: iso(t.replacementAcceptedAt), acceptanceEvidenceNote: t.acceptanceEvidenceNote, activeEvidence };
  }

  /** approveTSAExit request, bound to the TSA version and the accepted-replacement payload (module guide: approvals). */
  async requestExitApproval(ctx: RequestContext, projectId: string, id: string, body: { expectedVersion: number; note?: string }) {
    const t = await loadInProject(this.s.db, schema.tsaService, projectId, id);
    this.assertManage(ctx, projectId, t);
    assertVersion(t, body.expectedVersion, 'TSA service');
    if (!TSA_MACHINE.accept_exit.from.includes(t.status)) throw ruleViolation('tsa.exit.invalid_state', `An exit approval cannot be requested while the TSA is ${t.status} (start the exit first)`);
    const ev = await this.s.evidence(projectId, 'tsa_service', t.id);
    assertTsaExitAcceptable({ replacementAccepted: t.replacementAccepted, acceptanceEvidenceCount: ev.active });
    if (t.exitApprovalRequestId) {
      const prev = await loadInProject(this.s.db, schema.approvalRequest, projectId, t.exitApprovalRequestId);
      if (prev.status === 'pending') throw conflict('tsa.exit.already_requested', 'An exit approval request is already pending');
    }
    const reqId = newId();
    const nextVersion = t.version + 1;
    const payload = this.exitPayload({ ...t, version: nextVersion }, ev.active);
    await this.s.db
      .tx()
      .insert(schema.approvalRequest)
      .values({
        id: reqId,
        orgId: ctx.principal.orgId,
        projectId,
        subjectType: 'tsa_service',
        subjectId: t.id,
        subjectVersion: nextVersion,
        action: 'tsa.approve_exit',
        payload,
        payloadHash: payloadHash(payload),
        requiredPermission: 'readiness.tsa.approve_exit',
        requestedBy: ctx.principal.userId!,
        status: 'pending',
        note: body.note ?? `Exit of TSA ${t.code}`,
      });
    const row = (await updateVersioned(this.s.db, schema.tsaService, { id: t.id, projectId, expectedVersion: body.expectedVersion }, { exitApprovalRequestId: reqId })) as TsaRow;
    await this.s.audit.record({ action: 'readiness.tsa.request_exit_approval', entityType: 'tsa_service', entityId: t.id, projectId, after: { approvalRequestId: reqId, activeEvidence: ev.active }, reason: body.note ?? null });
    await this.s.outbox.emit({ type: 'approval.pending', projectId, aggregateType: 'approval_request', aggregateId: reqId, payload: { tsaServiceId: t.id, requiredPermission: 'readiness.tsa.approve_exit' } });
    return { id: t.id, status: row.status, version: row.version, approvalRequestId: reqId };
  }

  private async pendingExitRequest(t: TsaRow) {
    if (!t.exitApprovalRequestId) throw ruleViolation('tsa.exit.not_requested', 'No exit approval request exists for this TSA');
    const req = await loadInProject(this.s.db, schema.approvalRequest, t.projectId, t.exitApprovalRequestId);
    if (req.status !== 'pending') throw ruleViolation('tsa.exit.not_pending', `The exit approval request is ${req.status}`);
    return req;
  }

  /** approveTSAExit (REQ-TSA-006, AT-10): replacement accepted with evidence; independent approver; binding checked. */
  async approveExit(ctx: RequestContext, projectId: string, id: string, body: { expectedVersion: number; note?: string }) {
    const t = await loadInProject(this.s.db, schema.tsaService, projectId, id);
    const req = await this.pendingExitRequest(t);
    this.s.policy.assert(ctx, 'readiness.tsa.approve_exit', { projectId, workstreamId: t.workstreamId, classification: t.classification, requesterUserId: req.requestedBy });
    assertTsaExitApprovalSeparation({ approverUserId: ctx.principal.userId!, requesterUserId: req.requestedBy, ownerUserId: t.ownerUserId, replacementAcceptedBy: t.replacementAcceptedBy });
    assertVersion(t, body.expectedVersion, 'TSA service');
    const ev = await this.s.evidence(projectId, 'tsa_service', t.id);
    assertTsaExitAcceptable({ replacementAccepted: t.replacementAccepted, acceptanceEvidenceCount: ev.active });
    const hash = payloadHash(this.exitPayload(t, ev.active));
    if (req.subjectVersion !== t.version || req.payloadHash !== hash) {
      throw conflict('tsa.exit.approval_stale', 'The TSA or its replacement evidence changed since the exit approval was requested — a fresh request is required', { requestedVersion: req.subjectVersion, currentVersion: t.version });
    }
    const row = await this.applyStatus(ctx, t, 'accept_exit', body.expectedVersion, { exitApprovedBy: ctx.principal.userId, exitApprovedAt: this.s.clock.now() }, body.note ?? null, { approvalRequestId: req.id, activeEvidence: ev.active });
    await this.s.db.tx().insert(schema.approvalRecord).values({ id: newId(), orgId: ctx.principal.orgId, projectId, approvalRequestId: req.id, approverUserId: ctx.principal.userId!, decision: 'approve', comment: body.note ?? null, authorityBasis: 'readiness.tsa.approve_exit (policy matrix)', payloadHash: hash });
    await updateVersioned(this.s.db, schema.approvalRequest, { id: req.id, projectId, expectedVersion: req.version }, { status: 'approved' });
    return { id: t.id, status: row.status, version: row.version };
  }

  async rejectExit(ctx: RequestContext, projectId: string, id: string, body: { expectedVersion: number; note: string }) {
    const t = await loadInProject(this.s.db, schema.tsaService, projectId, id);
    const req = await this.pendingExitRequest(t);
    this.s.policy.assert(ctx, 'readiness.tsa.approve_exit', { projectId, workstreamId: t.workstreamId, classification: t.classification, requesterUserId: req.requestedBy });
    assertVersion(t, body.expectedVersion, 'TSA service');
    await this.s.db.tx().insert(schema.approvalRecord).values({ id: newId(), orgId: ctx.principal.orgId, projectId, approvalRequestId: req.id, approverUserId: ctx.principal.userId!, decision: 'reject', comment: body.note, authorityBasis: 'readiness.tsa.approve_exit (policy matrix)', payloadHash: req.payloadHash });
    await updateVersioned(this.s.db, schema.approvalRequest, { id: req.id, projectId, expectedVersion: req.version }, { status: 'rejected' });
    await this.s.audit.record({ action: 'readiness.tsa.reject_exit', entityType: 'tsa_service', entityId: t.id, projectId, after: { approvalRequestId: req.id, status: t.status }, reason: body.note });
    return { id: t.id, status: t.status, version: t.version };
  }

  private async invalidatePendingExit(t: TsaRow, why: string) {
    if (!t.exitApprovalRequestId) return;
    const req = await loadInProject(this.s.db, schema.approvalRequest, t.projectId, t.exitApprovalRequestId);
    if (req.status !== 'pending') return;
    await updateVersioned(this.s.db, schema.approvalRequest, { id: req.id, projectId: t.projectId, expectedVersion: req.version }, { status: 'invalidated', note: `${req.note ?? ''} — invalidated: ${why}`.slice(0, 2000) });
  }

  // ---------------------------------------------------------------------------------------------------------
  // Escalation (governance table; system-generated, routed per the approved authority matrix)

  /** Escalation target for TSA decisions from the project's approved, effective authority matrix (REQ-TSA-004). */
  private async routing(p: ProjectRow): Promise<{ target: string; committeeId: string | null }> {
    const today = this.s.today(p);
    const rows = await this.s.db
      .tx()
      .select({ m: schema.authorityMatrixVersion, name: schema.committee.name })
      .from(schema.authorityMatrixVersion)
      .innerJoin(schema.committee, eq(schema.committee.id, schema.authorityMatrixVersion.committeeId))
      .where(and(eq(schema.authorityMatrixVersion.projectId, p.id), eq(schema.authorityMatrixVersion.status, 'approved')))
      .orderBy(desc(schema.authorityMatrixVersion.approvedAt));
    for (const { m, name } of rows) {
      if (m.effectiveFrom && m.effectiveFrom > today) continue;
      if (m.effectiveTo && m.effectiveTo < today) continue;
      const types = ((m.policy as { decisionTypes?: { key: string; withinCommitteeAuthority?: boolean; escalateTo?: string }[] }).decisionTypes ?? []).filter((d) => TSA_DECISION_TYPE_KEYS.includes(d.key));
      if (!types.length) continue;
      const dt = types[0]!;
      return dt.withinCommitteeAuthority
        ? { target: `${name} — within its delegated authority (${dt.key}, matrix v${m.versionNo})`, committeeId: m.committeeId }
        : { target: `${dt.escalateTo ?? 'Delegating authority — to be confirmed'} (${dt.key}, matrix v${m.versionNo})`, committeeId: m.committeeId };
    }
    return { target: 'Authorized body — to be confirmed (no approved authority matrix covers TSA decisions)', committeeId: null };
  }

  /** Idempotent: one open escalation per TSA at a time (reused while open / decision requested). */
  private async raiseEscalation(ctx: RequestContext, p: ProjectRow, t: TsaRow, e: { reason: 'expired_unresolved' | 'replacement_failure'; title: string; requestedAction: string; decisionDeadline: string | null }): Promise<string> {
    const [open] = await this.s.db
      .tx()
      .select({ id: schema.escalation.id })
      .from(schema.escalation)
      .where(and(eq(schema.escalation.projectId, p.id), eq(schema.escalation.sourceType, 'tsa_service'), eq(schema.escalation.sourceId, t.id), inArray(schema.escalation.status, ['open', 'decision_requested'])));
    if (open) return open.id;
    const { target, committeeId } = await this.routing(p);
    const id = newId();
    const code = await nextCode(this.s.db, schema.escalation, p.id, 'ESC');
    await this.s.db
      .tx()
      .insert(schema.escalation)
      .values({
        id,
        orgId: p.orgId,
        projectId: p.id,
        code,
        title: e.title,
        sourceType: 'tsa_service',
        sourceId: t.id,
        requestedAction: e.requestedAction,
        decisionDeadline: e.decisionDeadline,
        options: [
          { title: 'Extend the TSA', impact: 'Requires an approved decision recorded against the TSA (request-extension → record-extension); cost and obligations continue' },
          { title: 'Alternative interim / continuity arrangement', impact: 'Continuity plan executed; the TSA stays unresolved until an exit is accepted with evidence' },
          { title: 'Accelerate / re-plan the replacement service', impact: 'Exit only after the replacement is accepted with evidence and the exit approved' },
        ],
        raisedToCommitteeId: committeeId,
        target,
        status: 'decision_requested',
        raisedBy: ctx.principal.userId,
        isSystemGenerated: true,
        isDemo: p.isDemo,
      });
    await this.s.audit.record({ action: 'readiness.tsa.escalate', entityType: 'escalation', entityId: id, projectId: p.id, after: { code, tsaServiceId: t.id, reason: e.reason, target, decisionDeadline: e.decisionDeadline } });
    return id;
  }

  private expiryEscalation(t: TsaRow) {
    return {
      reason: 'expired_unresolved' as const,
      title: `TSA ${t.code} expired without an accepted replacement — escalation`,
      requestedAction: `TSA ${t.code} (${t.name}) reached its end date ${t.endDate} without an accepted replacement service. This is NOT an exit. Decide on continuity: an extension (approved decision required; never automatic) or an alternative arrangement.`,
      decisionDeadline: null,
    };
  }

  // ---------------------------------------------------------------------------------------------------------
  // Expiry (worker job, service identity) — AT-10, REQ-TSA-003

  /** Per-project daily schedule for the expiry scan, created idempotently with the project's first TSA. */
  async ensureExpirySchedule(ctx: RequestContext, p: ProjectRow) {
    await this.s.db.query(`select pg_advisory_xact_lock(hashtextextended('hub_tsa_expiry_schedule:' || $1, 0))`, [p.id]);
    await this.s.db.query(
      `insert into scheduled_job (id, org_id, project_id, kind, name, cron, timezone, payload, enabled, next_run_at, created_by)
       select gen_random_uuid(), $1::uuid, $2::uuid, $3::varchar, $4::text, $5::varchar, $6::text, '{}'::jsonb, true, $7::timestamptz, $8::uuid
        where not exists (select 1 from scheduled_job where org_id = $1::uuid and project_id = $2::uuid and kind = $3::varchar)`,
      [p.orgId, p.id, TSA_EXPIRY_JOB, `TSA expiry scan (${p.code})`, TSA_EXPIRY_CRON, p.timezone, nextCronRun(TSA_EXPIRY_CRON, p.timezone, this.s.clock.now()), ctx.principal.userId],
    );
  }

  /**
   * Scan one project's live TSAs: warn before the end date (`tsa.expiring`, deduplicated per TSA / end date / kind), and
   * when the end date passed without an accepted replacement move the TSA to expired_unresolved and escalate — never an
   * exit and never an extension. Idempotent: re-running changes nothing and emits nothing new.
   */
  async scanExpiry(ctx: RequestContext, projectId: string) {
    this.s.policy.assert(ctx, 'readiness.tsa.manage', { projectId });
    const p = await this.s.project(projectId);
    const today = this.s.today(p);
    const rows = await this.s.db
      .tx()
      .select()
      .from(schema.tsaService)
      .where(and(eq(schema.tsaService.projectId, projectId), inArray(schema.tsaService.status, LIVE_STATUSES)))
      .orderBy(asc(schema.tsaService.code));
    const out = { scanned: rows.length, expiring: 0, markedExpired: 0, escalations: 0, exitAcceptancePending: 0 };
    for (const t of rows) {
      if (!t.endDate) continue;
      const a = assessTsaExpiry({ status: t.status, endDate: t.endDate, replacementAccepted: t.replacementAccepted, today, warnDays: TSA_EXPIRY_WARN_DAYS });
      const act = tsaExpiryAction(t.status, a);
      const emit = (kind: string, days: number) =>
        this.s.outbox.emit({
          type: 'tsa.expiring',
          projectId,
          aggregateType: 'tsa_service',
          aggregateId: t.id,
          payload: { tsaServiceId: t.id, kind, days, endDate: t.endDate },
          dedupeKey: `tsa.expiring:${t.id}:${t.endDate}:${kind}`,
        });
      switch (act.action) {
        case 'none':
          break;
        case 'notify_expiring':
          await emit('expiring', act.daysLeft);
          out.expiring++;
          break;
        case 'notify_exit_acceptance_pending':
          await emit('exit_acceptance_pending', act.daysOverdue);
          out.exitAcceptancePending++;
          break;
        case 'mark_expired_unresolved': {
          const escalationId = await this.raiseEscalation(ctx, p, t, this.expiryEscalation(t));
          await this.applyStatus(ctx, t, 'mark_expired_unresolved', t.version, { escalationId }, `End date ${t.endDate} passed ${act.daysOverdue} day(s) ago without an accepted replacement`, { escalationId, daysOverdue: act.daysOverdue });
          out.markedExpired++;
          if (t.escalationId !== escalationId) out.escalations++;
          await emit('expired_unresolved', act.daysOverdue);
          break;
        }
        case 'ensure_escalation': {
          // Already expired_unresolved: escalate only if it never was (a resolved escalation is not re-raised daily).
          if (!t.escalationId) {
            const escalationId = await this.raiseEscalation(ctx, p, t, this.expiryEscalation(t));
            await this.s.db.tx().update(schema.tsaService).set({ escalationId }).where(and(eq(schema.tsaService.id, t.id), eq(schema.tsaService.projectId, projectId), isNull(schema.tsaService.escalationId)));
            out.escalations++;
          }
          await emit('expired_unresolved', act.daysOverdue);
          break;
        }
      }
    }
    return out;
  }
}
