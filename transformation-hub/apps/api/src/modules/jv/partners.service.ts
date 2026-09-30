import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  OUTREACH_DECISION_TYPE_KEYS,
  PARTNER_MACHINE,
  assertAssessmentEntry,
  assertCriteriaWeights,
  assertPartnerApprovalSeparation,
  assertPartnerStageGuards,
  conflict,
  nextPartnerStages,
  notFound,
  partnerAdvanceCommand,
  ruleViolation,
  transition,
  weightedScore,
  Classification,
  PartnerStage,
  ScreeningCriterion,
} from '@hub/domain';
import type { RouteInput, jvRoutes } from '@hub/contracts';
import type { RequestContext } from '../../platform/context';
import { assertVersion, likeContains, loadInProject, offsetOf, pageOf, updateVersioned } from '../../platform/helpers';
import { orderBySort } from '../../platform/sort';
import { newId } from '../../platform/ids';
import { JvSupport, iso } from './jv.support';

type PartnerRow = typeof schema.partner.$inferSelect;
type CriteriaRow = typeof schema.partnerCriteriaSet.$inferSelect;
type Q<K extends keyof typeof jvRoutes> = RouteInput<(typeof jvRoutes)[K]>;

/**
 * Partner process (spec §8; REQ-JV-002..006): longlist/shortlist with criteria, weights and conflict disclosures; the
 * engagement stage machine; outreach approval and NDA recording as separate, authorized approvals (an NDA grants no
 * access); fact/judgement assessments and proposals. No partner is ever created by the platform outside labelled Demo.
 */
@Injectable()
export class PartnersService {
  constructor(private readonly s: JvSupport) {}

  // ---------------------------------------------------------------------------------------------------------
  // helpers

  private attrs(p: PartnerRow) {
    return { projectId: p.projectId, classification: p.classification as Classification };
  }

  /** A partner the caller can read (404 otherwise — outside scope, room-only principal, above clearance). */
  async loadVisible(ctx: RequestContext, projectId: string, partnerId: string, permission = 'jv.partner.read'): Promise<PartnerRow> {
    if (this.s.policy.isRoomOnly(ctx.principal, projectId)) throw notFound();
    const p = await loadInProject(this.s.db, schema.partner, projectId, partnerId);
    this.s.policy.assert(ctx, permission, this.attrs(p));
    return p;
  }

  private async criteriaSet(projectId: string): Promise<CriteriaRow | null> {
    const [c] = await this.s.db.tx().select().from(schema.partnerCriteriaSet).where(eq(schema.partnerCriteriaSet.projectId, projectId));
    return c ?? null;
  }

  private criteriaOf(c: CriteriaRow | null): ScreeningCriterion[] {
    return (c?.criteria ?? []).map((x) => ({ key: x.key, name: x.name, nameAr: x.nameAr ?? null, weight: x.weight }));
  }

  /** Latest score per partner and criterion (insert-only entries; the newest counts). */
  private async latestScores(projectId: string, partnerIds: string[]): Promise<Map<string, Record<string, string>>> {
    const out = new Map<string, Record<string, string>>();
    if (!partnerIds.length) return out;
    const r = await this.s.db.tx().execute<{ partner_id: string; criterion_key: string; score: string }>(sql`
      select distinct on (partner_id, criterion_key) partner_id, criterion_key, score::text as score
        from partner_assessment_entry
       where project_id = ${projectId} and score is not null and criterion_key is not null
         and partner_id in (${sql.join(partnerIds.map((i) => sql`${i}::uuid`), sql`, `)})
       order by partner_id, criterion_key, created_at desc, id desc`);
    for (const row of r.rows) {
      const m = out.get(row.partner_id) ?? {};
      m[row.criterion_key] = row.score;
      out.set(row.partner_id, m);
    }
    return out;
  }

  private dto(p: PartnerRow, score: string | null) {
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      stage: p.stage,
      shortlisted: p.shortlisted,
      ndaStatus: p.ndaStatus,
      outreachApproved: !!p.outreachApprovedAt,
      weightedScore: score,
      classification: p.classification,
      isDemo: p.isDemo,
      updatedAt: p.updatedAt.toISOString(),
      version: p.version,
    };
  }

  private async legalEntityInProject(projectId: string, legalEntityId: string) {
    const [pe] = await this.s.db
      .tx()
      .select({ id: schema.projectEntity.id })
      .from(schema.projectEntity)
      .where(and(eq(schema.projectEntity.projectId, projectId), eq(schema.projectEntity.legalEntityId, legalEntityId)));
    if (!pe) throw notFound();
  }

  /** Users with an OPEN conflict disclosure on the partner (they cannot approve its outreach / NDA). */
  private async conflictedUsers(projectId: string, partnerId: string): Promise<string[]> {
    const rows = await this.s.db
      .tx()
      .select({ u: schema.partnerConflict.declarantUserId })
      .from(schema.partnerConflict)
      .where(and(eq(schema.partnerConflict.projectId, projectId), eq(schema.partnerConflict.partnerId, partnerId), eq(schema.partnerConflict.status, 'open')));
    return rows.map((r) => r.u).filter((x): x is string => !!x);
  }

  private async signingConfirmed(projectId: string, partnerId: string): Promise<boolean> {
    const [r] = await this.s.db
      .tx()
      .select({ id: schema.closing.id })
      .from(schema.closing)
      .where(and(eq(schema.closing.projectId, projectId), eq(schema.closing.partnerId, partnerId), eq(schema.closing.kind, 'signing'), eq(schema.closing.status, 'confirmed')))
      .limit(1);
    return !!r;
  }

  private async setStage(ctx: RequestContext, p: PartnerRow, to: PartnerStage, expectedVersion: number, extra: Record<string, unknown>, reason: string | null, action: string) {
    const row = (await updateVersioned(this.s.db, schema.partner, { id: p.id, projectId: p.projectId, expectedVersion }, { stage: to, stageChangedAt: this.s.clock.now(), ...extra })) as PartnerRow;
    await this.s.audit.record({ action, entityType: 'partner', entityId: p.id, projectId: p.projectId, before: { stage: p.stage }, after: { stage: to, ...stringify(extra) }, reason });
    return row;
  }

  // ---------------------------------------------------------------------------------------------------------
  // reads

  async list(ctx: RequestContext, projectId: string, q: Q<'listPartners'>['query']) {
    await this.s.project(projectId);
    this.s.assertListable(ctx, projectId, 'jv.partner.read');
    const t = schema.partner;
    const where = and(
      eq(t.projectId, projectId),
      this.s.policy.visibilitySql(ctx, projectId, { classification: t.classification }),
      q.stage ? eq(t.stage, q.stage) : undefined,
      q.shortlisted ? eq(t.shortlisted, q.shortlisted === 'true') : undefined,
      q.q ? or(ilike(t.name, likeContains(q.q)), ilike(t.code, likeContains(q.q))) : undefined,
    );
    const tx = this.s.db.tx();
    const [{ total }] = (await tx.select({ total: count() }).from(t).where(where)) as [{ total: number }];
    const order = orderBySort(q.sort, { code: t.code, name: t.name, stage: t.stage, updatedAt: t.updatedAt }, t.id, [asc(t.code), asc(t.id)]);
    const rows = await tx.select().from(t).where(where).orderBy(...order).limit(q.pageSize).offset(offsetOf(q));
    const criteria = this.criteriaOf(await this.criteriaSet(projectId));
    const scores = await this.latestScores(projectId, rows.map((r) => r.id));
    return pageOf(
      rows.map((r) => this.dto(r, criteria.length ? weightedScore(criteria, scores.get(r.id) ?? {}).score : null)),
      Number(total),
      q,
    );
  }

  async get(ctx: RequestContext, projectId: string, partnerId: string) {
    const p = await this.loadVisible(ctx, projectId, partnerId);
    const tx = this.s.db.tx();
    const conflicts = await tx.select().from(schema.partnerConflict).where(and(eq(schema.partnerConflict.projectId, projectId), eq(schema.partnerConflict.partnerId, partnerId))).orderBy(asc(schema.partnerConflict.createdAt));
    const contacts = await tx.select().from(schema.partnerContact).where(and(eq(schema.partnerContact.projectId, projectId), eq(schema.partnerContact.partnerId, partnerId))).orderBy(asc(schema.partnerContact.createdAt));
    const outreachReq = await this.s.approvalRequest(projectId, p.outreachRequestId);
    const ndaReq = await this.s.approvalRequest(projectId, p.ndaRequestId);
    const criteria = this.criteriaOf(await this.criteriaSet(projectId));
    const scores = await this.latestScores(projectId, [p.id]);
    return {
      ...this.dto(p, criteria.length ? weightedScore(criteria, scores.get(p.id) ?? {}).score : null),
      description: p.description,
      legalEntityId: p.legalEntityId,
      stageChangedAt: iso(p.stageChangedAt),
      outreach: { request: this.s.approvalStep(outreachReq), approvedBy: p.outreachApprovedBy, approvedAt: iso(p.outreachApprovedAt) },
      nda: { status: p.ndaStatus, executedOn: p.ndaExecutedOn, documentId: p.ndaDocumentId, request: this.s.approvalStep(ndaReq), recordedBy: p.ndaRecordedBy, recordedAt: iso(p.ndaRecordedAt) },
      materialsAccessApprovedBy: p.materialsAccessApprovedBy,
      materialsAccessApprovedAt: iso(p.materialsAccessApprovedAt),
      withdrawnReason: p.withdrawnReason,
      nextStages: nextPartnerStages(p.stage),
      conflicts: conflicts.map((c) => ({ id: c.id, declarantUserId: c.declarantUserId, description: c.description, mitigation: c.mitigation, status: c.status as 'open' | 'mitigated' | 'cleared', createdAt: c.createdAt.toISOString(), createdBy: c.createdBy })),
      contacts: contacts.map((c) => ({ id: c.id, userId: c.userId, note: c.note, createdAt: c.createdAt.toISOString(), revokedAt: iso(c.revokedAt) })),
      createdAt: p.createdAt.toISOString(),
      createdBy: p.createdBy,
      people: await this.s.people([
        p.createdBy,
        p.outreachApprovedBy,
        p.ndaRecordedBy,
        p.materialsAccessApprovedBy,
        outreachReq?.requestedBy,
        ndaReq?.requestedBy,
        ...conflicts.flatMap((c) => [c.declarantUserId, c.createdBy]),
        ...contacts.map((c) => c.userId),
      ]),
    };
  }

  // ---------------------------------------------------------------------------------------------------------
  // longlist / shortlist

  async create(ctx: RequestContext, projectId: string, body: Q<'createPartner'>['body']) {
    const project = await this.s.project(projectId);
    this.s.assertClassification(ctx, body.classification);
    this.s.policy.assert(ctx, 'jv.partner.manage', { projectId, classification: body.classification });
    if (body.legalEntityId) await this.legalEntityInProject(projectId, body.legalEntityId);
    const code = body.code ?? (await this.s.nextCode('partner', 'code', projectId, 'PTR'));
    const id = newId();
    await this.s.db
      .tx()
      .insert(schema.partner)
      .values({
        id,
        orgId: ctx.principal.orgId,
        projectId,
        code,
        name: body.name,
        description: body.description ?? null,
        legalEntityId: body.legalEntityId ?? null,
        classification: body.classification,
        isDemo: project.isDemo,
        createdBy: ctx.principal.userId,
        stageChangedAt: this.s.clock.now(),
      });
    await this.s.audit.record({ action: 'jv.partner.create', entityType: 'partner', entityId: id, projectId, after: { code, stage: 'identified', classification: body.classification } });
    return { id, code, version: 1 };
  }

  async update(ctx: RequestContext, projectId: string, partnerId: string, body: Q<'updatePartner'>['body']) {
    const p = await this.loadVisible(ctx, projectId, partnerId, 'jv.partner.manage');
    if (body.legalEntityId) await this.legalEntityInProject(projectId, body.legalEntityId);
    const values: Record<string, unknown> = {};
    for (const k of ['name', 'description', 'legalEntityId'] as const) if (body[k] !== undefined) values[k] = body[k];
    assertVersion(p, body.expectedVersion, 'partner');
    const row = await updateVersioned(this.s.db, schema.partner, { id: p.id, projectId, expectedVersion: body.expectedVersion }, values);
    await this.s.audit.record({ action: 'jv.partner.update', entityType: 'partner', entityId: p.id, projectId, before: pick(p, Object.keys(values)), after: values });
    return { id: p.id, version: row['version'] as number };
  }

  async shortlist(ctx: RequestContext, projectId: string, partnerId: string, body: Q<'shortlistPartner'>['body']) {
    const p = await this.loadVisible(ctx, projectId, partnerId, 'jv.partner.manage');
    if (p.stage === 'withdrawn') throw ruleViolation('jv.partner.withdrawn', 'A withdrawn partner cannot be shortlisted');
    if (p.shortlisted === body.shortlisted) throw ruleViolation('jv.partner.shortlist_unchanged', body.shortlisted ? 'The partner is already shortlisted' : 'The partner is not shortlisted');
    const row = await updateVersioned(this.s.db, schema.partner, { id: p.id, projectId, expectedVersion: body.expectedVersion }, { shortlisted: body.shortlisted });
    await this.s.audit.record({ action: 'jv.partner.shortlist', entityType: 'partner', entityId: p.id, projectId, before: { shortlisted: p.shortlisted }, after: { shortlisted: body.shortlisted }, reason: body.reason });
    return { id: p.id, version: row['version'] as number };
  }

  // ---------------------------------------------------------------------------------------------------------
  // Outreach approval (REQ-JV-004): request → separate authorized approval within the authority matrix

  async requestOutreach(ctx: RequestContext, projectId: string, partnerId: string, body: Q<'requestOutreach'>['body']) {
    const p = await this.loadVisible(ctx, projectId, partnerId, 'jv.partner.manage');
    if (p.stage !== 'identified') throw ruleViolation('jv.partner.outreach_not_applicable', `Outreach approval is requested for an identified partner (this one is ${p.stage})`);
    assertVersion(p, body.expectedVersion, 'partner');
    const prev = await this.s.approvalRequest(projectId, p.outreachRequestId);
    if (prev?.status === 'pending') throw conflict('jv.partner.outreach_already_requested', 'An outreach approval request is already pending');
    const reqId = await this.s.createApprovalRequest(ctx, projectId, {
      subjectType: 'partner',
      subjectId: p.id,
      subjectVersion: p.version + 1,
      action: 'jv.partner.approve_contact',
      requiredPermission: 'jv.partner.approve_contact',
      payload: { partnerId: p.id, code: p.code, stage: p.stage },
      note: body.note,
    });
    const row = await updateVersioned(this.s.db, schema.partner, { id: p.id, projectId, expectedVersion: body.expectedVersion }, { outreachRequestId: reqId });
    await this.s.audit.record({ action: 'jv.partner.request_outreach', entityType: 'partner', entityId: p.id, projectId, after: { approvalRequestId: reqId }, reason: body.note });
    return { id: p.id, version: row['version'] as number };
  }

  async decideOutreach(ctx: RequestContext, projectId: string, partnerId: string, body: Q<'decideOutreach'>['body']) {
    this.s.assertHuman(ctx, 'Approving partner outreach');
    const project = await this.s.project(projectId);
    const p = await this.loadVisible(ctx, projectId, partnerId, 'jv.partner.approve_contact');
    const req = await this.s.approvalRequest(projectId, p.outreachRequestId);
    if (!req || req.status !== 'pending') throw ruleViolation('jv.partner.outreach_not_requested', 'No pending outreach approval request exists for this partner (a request by another person is required)');
    assertPartnerApprovalSeparation({ approverUserId: ctx.principal.userId!, requesterUserId: req.requestedBy, conflictedUserIds: await this.conflictedUsers(projectId, p.id), what: 'Outreach approval' });
    const authority = await this.s.matrixAuthority(project, OUTREACH_DECISION_TYPE_KEYS);
    this.s.policy.assert(ctx, 'jv.partner.approve_contact', { ...this.attrs(p), requesterUserId: req.requestedBy, withinAuthority: authority.within });
    assertVersion(p, body.expectedVersion, 'partner');
    if (req.subjectVersion !== p.version) throw conflict('jv.partner.outreach_request_stale', 'The partner changed after the outreach request — a fresh request is required');
    if (body.outcome === 'reject') {
      await this.s.decideApproval(ctx, projectId, req, 'reject', body.note ?? null, authority.basis);
      await this.s.audit.record({ action: 'jv.partner.reject_outreach', entityType: 'partner', entityId: p.id, projectId, after: { approvalRequestId: req.id }, reason: body.note ?? null });
      const row = (await updateVersioned(this.s.db, schema.partner, { id: p.id, projectId, expectedVersion: body.expectedVersion }, {})) as PartnerRow;
      return { id: p.id, stage: row.stage, version: row.version };
    }
    const to = transition('partner', PARTNER_MACHINE, p.stage, 'approve_contact');
    const now = this.s.clock.now();
    const row = await this.setStage(ctx, p, to, body.expectedVersion, { outreachApprovedBy: ctx.principal.userId, outreachApprovedAt: now }, body.note ?? null, 'jv.partner.approve_contact');
    await this.s.decideApproval(ctx, projectId, req, 'approve', body.note ?? null, authority.basis);
    return { id: p.id, stage: row.stage, version: row.version };
  }

  // ---------------------------------------------------------------------------------------------------------
  // NDA (REQ-JV-005): submitted with the executed copy, recorded by Legal — grants no document access

  async submitNda(ctx: RequestContext, projectId: string, partnerId: string, body: Q<'submitNda'>['body']) {
    const project = await this.s.project(projectId);
    const p = await this.loadVisible(ctx, projectId, partnerId, 'jv.partner.advance_stage');
    assertPartnerStageGuards({ to: 'nda', outreachApproved: !!p.outreachApprovedAt, ndaExecuted: true, signingConfirmed: false, viaApprovalCommand: true });
    if (p.stage !== 'approved_for_contact') throw ruleViolation('jv.partner.nda_not_applicable', `An NDA is recorded for a partner approved for contact (this one is ${p.stage})`);
    if (body.executedOn > this.s.today(project)) throw ruleViolation('jv.partner.nda_date_future', 'The NDA execution date cannot be in the future (project timezone)');
    await this.s.visibleDocument(ctx, projectId, body.documentId);
    assertVersion(p, body.expectedVersion, 'partner');
    const prev = await this.s.approvalRequest(projectId, p.ndaRequestId);
    if (prev?.status === 'pending') await this.s.invalidateApproval(projectId, prev, 'superseded by a new NDA submission');
    const reqId = await this.s.createApprovalRequest(ctx, projectId, {
      subjectType: 'partner',
      subjectId: p.id,
      subjectVersion: p.version + 1,
      action: 'jv.nda.record',
      requiredPermission: 'jv.nda.record',
      payload: { partnerId: p.id, documentId: body.documentId, executedOn: body.executedOn },
      note: body.note ?? `NDA of ${p.code}`,
    });
    const row = await updateVersioned(this.s.db, schema.partner, { id: p.id, projectId, expectedVersion: body.expectedVersion }, { ndaStatus: 'drafting', ndaDocumentId: body.documentId, ndaExecutedOn: body.executedOn, ndaRequestId: reqId });
    await this.s.audit.record({ action: 'jv.nda.submit', entityType: 'partner', entityId: p.id, projectId, after: { approvalRequestId: reqId, documentId: body.documentId, executedOn: body.executedOn }, reason: body.note ?? null });
    return { id: p.id, version: row['version'] as number };
  }

  async recordNda(ctx: RequestContext, projectId: string, partnerId: string, body: Q<'recordNda'>['body']) {
    this.s.assertHuman(ctx, 'Recording an NDA');
    const p = await this.loadVisible(ctx, projectId, partnerId, 'jv.nda.record');
    const req = await this.s.approvalRequest(projectId, p.ndaRequestId);
    if (!req || req.status !== 'pending') throw ruleViolation('jv.nda.not_submitted', 'No pending NDA submission exists for this partner');
    assertPartnerApprovalSeparation({ approverUserId: ctx.principal.userId!, requesterUserId: req.requestedBy, conflictedUserIds: await this.conflictedUsers(projectId, p.id), what: 'NDA recording' });
    this.s.policy.assert(ctx, 'jv.nda.record', { ...this.attrs(p), requesterUserId: req.requestedBy });
    assertVersion(p, body.expectedVersion, 'partner');
    if (req.subjectVersion !== p.version) throw conflict('jv.nda.submission_stale', 'The partner changed after the NDA submission — resubmit the NDA');
    if (body.outcome === 'reject') {
      await this.s.decideApproval(ctx, projectId, req, 'reject', body.note ?? null, 'jv.nda.record (policy matrix)');
      const row = (await updateVersioned(this.s.db, schema.partner, { id: p.id, projectId, expectedVersion: body.expectedVersion }, { ndaStatus: 'none' })) as PartnerRow;
      await this.s.audit.record({ action: 'jv.nda.reject', entityType: 'partner', entityId: p.id, projectId, after: { approvalRequestId: req.id }, reason: body.note ?? null });
      return { id: p.id, stage: row.stage, version: row.version };
    }
    assertPartnerStageGuards({ to: 'nda', outreachApproved: !!p.outreachApprovedAt, ndaExecuted: true, signingConfirmed: false, viaApprovalCommand: true });
    const to = transition('partner', PARTNER_MACHINE, p.stage, 'record_nda_executed');
    const row = await this.setStage(ctx, p, to, body.expectedVersion, { ndaStatus: 'executed', ndaRecordedBy: ctx.principal.userId, ndaRecordedAt: this.s.clock.now() }, body.note ?? null, 'jv.nda.record');
    await this.s.decideApproval(ctx, projectId, req, 'approve', body.note ?? null, 'jv.nda.record (policy matrix)');
    return { id: p.id, stage: row.stage, version: row.version };
  }

  // ---------------------------------------------------------------------------------------------------------
  // Engagement stages (REQ-JV-003)

  async advance(ctx: RequestContext, projectId: string, partnerId: string, body: Q<'advancePartner'>['body']) {
    const p = await this.loadVisible(ctx, projectId, partnerId, 'jv.partner.advance_stage');
    if (body.toStage === 'withdrawn') throw ruleViolation('jv.partner.use_withdraw', 'Withdrawal is recorded with the withdraw command (reason required)');
    assertPartnerStageGuards({
      to: body.toStage,
      outreachApproved: !!p.outreachApprovedAt,
      ndaExecuted: p.ndaStatus === 'executed',
      signingConfirmed: body.toStage === 'closing' ? await this.signingConfirmed(projectId, p.id) : false,
    });
    const cmd = partnerAdvanceCommand(p.stage, body.toStage);
    const to = transition('partner', PARTNER_MACHINE, p.stage, cmd);
    const extra: Record<string, unknown> = to === 'materials_access' ? { materialsAccessApprovedBy: ctx.principal.userId, materialsAccessApprovedAt: this.s.clock.now() } : {};
    const row = await this.setStage(ctx, p, to, body.expectedVersion, extra, body.note ?? null, 'jv.partner.advance_stage');
    return { id: p.id, stage: row.stage, version: row.version };
  }

  async withdraw(ctx: RequestContext, projectId: string, partnerId: string, body: Q<'withdrawPartner'>['body']) {
    const p = await this.loadVisible(ctx, projectId, partnerId, 'jv.partner.advance_stage');
    const to = transition('partner', PARTNER_MACHINE, p.stage, 'withdraw');
    const row = await this.setStage(ctx, p, to, body.expectedVersion, { withdrawnReason: body.reason, shortlisted: false }, body.reason, 'jv.partner.withdraw');
    for (const r of [p.outreachRequestId, p.ndaRequestId]) await this.s.invalidateApproval(projectId, await this.s.approvalRequest(projectId, r), 'partner withdrawn');
    const grantsRevoked = await this.s.revokeExternalGrants(ctx, projectId, p.id, null, `Partner withdrawn: ${body.reason}`);
    return { id: p.id, stage: row.stage, version: row.version, grantsRevoked };
  }

  // ---------------------------------------------------------------------------------------------------------
  // Conflicts and external contacts

  async addConflict(ctx: RequestContext, projectId: string, partnerId: string, body: Q<'addPartnerConflict'>['body']) {
    const p = await this.loadVisible(ctx, projectId, partnerId, 'jv.partner.manage');
    const project = await this.s.project(projectId);
    const id = newId();
    await this.s.db.tx().insert(schema.partnerConflict).values({
      id,
      orgId: ctx.principal.orgId,
      projectId,
      partnerId: p.id,
      declarantUserId: body.declarantUserId ?? null,
      description: body.description,
      mitigation: body.mitigation ?? null,
      isDemo: project.isDemo,
      createdBy: ctx.principal.userId,
    });
    await this.s.audit.record({ action: 'jv.partner.conflict_disclosed', entityType: 'partner', entityId: p.id, projectId, after: { conflictId: id, declarantUserId: body.declarantUserId ?? null } });
    return { id, version: 1 };
  }

  async addContact(ctx: RequestContext, projectId: string, partnerId: string, body: Q<'addPartnerContact'>['body']) {
    const p = await this.loadVisible(ctx, projectId, partnerId);
    this.s.policy.assert(ctx, 'jv.room.grant_access', { ...this.attrs(p), requesterUserId: body.userId });
    if (p.stage === 'withdrawn') throw ruleViolation('jv.partner.withdrawn', 'A withdrawn partner cannot receive new contacts');
    const [u] = await this.s.db.tx().select({ id: schema.appUser.id, accountType: schema.appUser.accountType, isActive: schema.appUser.isActive }).from(schema.appUser).where(eq(schema.appUser.id, body.userId));
    if (!u) throw notFound();
    if (u.accountType !== 'external') throw ruleViolation('jv.partner.contact_external_only', 'Only an external (counterparty) account can be bound to a partner');
    if (!u.isActive) throw ruleViolation('jv.partner.contact_inactive', 'The account is not active');
    const [bound] = await this.s.db
      .tx()
      .select({ partnerId: schema.partnerContact.partnerId })
      .from(schema.partnerContact)
      .where(and(eq(schema.partnerContact.projectId, projectId), eq(schema.partnerContact.userId, body.userId), isNull(schema.partnerContact.revokedAt)));
    if (bound) throw conflict('jv.partner.contact_already_bound', 'This external account is already bound to a counterparty (exactly one is allowed)');
    const id = newId();
    await this.s.db.tx().insert(schema.partnerContact).values({ id, orgId: ctx.principal.orgId, projectId, partnerId: p.id, userId: body.userId, note: body.note ?? null, createdBy: ctx.principal.userId });
    await this.s.audit.record({ action: 'jv.partner.contact_bound', entityType: 'partner', entityId: p.id, projectId, after: { contactId: id, userId: body.userId } });
    return { id };
  }

  async revokeContact(ctx: RequestContext, projectId: string, partnerId: string, contactId: string, body: Q<'revokePartnerContact'>['body']) {
    const p = await this.loadVisible(ctx, projectId, partnerId);
    const c = await loadInProject(this.s.db, schema.partnerContact, projectId, contactId);
    if (c.partnerId !== p.id) throw notFound();
    this.s.policy.assert(ctx, 'jv.room.grant_access', { ...this.attrs(p), requesterUserId: c.userId });
    if (c.revokedAt) throw ruleViolation('jv.partner.contact_already_revoked', 'The binding is already revoked');
    await this.s.db.tx().update(schema.partnerContact).set({ revokedAt: this.s.clock.now(), revokedBy: ctx.principal.userId }).where(and(eq(schema.partnerContact.id, c.id), eq(schema.partnerContact.projectId, projectId)));
    const grantsRevoked = await this.s.revokeExternalGrants(ctx, projectId, p.id, c.userId, `Counterparty binding revoked: ${body.reason}`);
    await this.s.audit.record({ action: 'jv.partner.contact_revoked', entityType: 'partner', entityId: p.id, projectId, after: { contactId: c.id, userId: c.userId, grantsRevoked }, reason: body.reason });
    return { id: c.id, grantsRevoked };
  }

  // ---------------------------------------------------------------------------------------------------------
  // Criteria, assessments, proposals, comparison (REQ-JV-002, REQ-JV-006)

  async getCriteria(ctx: RequestContext, projectId: string) {
    await this.s.project(projectId);
    this.s.assertListable(ctx, projectId, 'jv.partner.read');
    const c = await this.criteriaSet(projectId);
    if (!c) return { criteriaSet: null };
    return { criteriaSet: { id: c.id, criteria: this.criteriaOf(c).map((x) => ({ ...x, nameAr: x.nameAr ?? null })), totalWeight: assertCriteriaWeights(this.criteriaOf(c)).total, note: c.note, updatedAt: c.updatedAt.toISOString(), version: c.version } };
  }

  async setCriteria(ctx: RequestContext, projectId: string, body: Q<'setCriteria'>['body']) {
    const project = await this.s.project(projectId);
    this.s.assertListable(ctx, projectId, 'jv.partner.manage');
    this.s.policy.assert(ctx, 'jv.partner.manage', { projectId });
    const criteria = body.criteria.map((c) => ({ key: c.key, name: c.name, nameAr: c.nameAr ?? null, weight: c.weight }));
    const { total } = assertCriteriaWeights(criteria);
    const existing = await this.criteriaSet(projectId);
    if (!existing) {
      if (body.expectedVersion !== 0) throw conflict('concurrency.version_mismatch', 'No criteria set exists yet — create it with expectedVersion 0', { expectedVersion: body.expectedVersion, currentVersion: 0 });
      const id = newId();
      await this.s.db.tx().insert(schema.partnerCriteriaSet).values({ id, orgId: ctx.principal.orgId, projectId, criteria, note: body.note ?? null, isDemo: project.isDemo, createdBy: ctx.principal.userId, updatedBy: ctx.principal.userId });
      await this.s.audit.record({ action: 'jv.partner.criteria_set', entityType: 'partner_criteria_set', entityId: id, projectId, after: { criteria, total } });
      return { id, version: 1 };
    }
    const row = await updateVersioned(this.s.db, schema.partnerCriteriaSet, { id: existing.id, projectId, expectedVersion: body.expectedVersion }, { criteria, note: body.note ?? existing.note, updatedBy: ctx.principal.userId });
    await this.s.audit.record({ action: 'jv.partner.criteria_set', entityType: 'partner_criteria_set', entityId: existing.id, projectId, before: { criteria: existing.criteria }, after: { criteria, total } });
    return { id: existing.id, version: row['version'] as number };
  }

  async listAssessments(ctx: RequestContext, projectId: string, partnerId: string) {
    await this.loadVisible(ctx, projectId, partnerId, 'jv.deal.read');
    const rows = await this.s.db
      .tx()
      .select()
      .from(schema.partnerAssessmentEntry)
      .where(and(eq(schema.partnerAssessmentEntry.projectId, projectId), eq(schema.partnerAssessmentEntry.partnerId, partnerId)))
      .orderBy(desc(schema.partnerAssessmentEntry.createdAt), desc(schema.partnerAssessmentEntry.id));
    return {
      items: rows.map((r) => ({
        id: r.id,
        partnerId: r.partnerId,
        proposalId: r.proposalId,
        criterionKey: r.criterionKey,
        basis: r.basis as 'fact' | 'judgement',
        statement: r.statement,
        score: r.score,
        sourceReference: r.sourceReference,
        documentId: r.documentId,
        isDemo: r.isDemo,
        createdAt: r.createdAt.toISOString(),
        createdBy: r.createdBy,
      })),
      people: await this.s.people(rows.map((r) => r.createdBy)),
    };
  }

  async addAssessment(ctx: RequestContext, projectId: string, partnerId: string, body: Q<'addAssessment'>['body']) {
    const p = await this.loadVisible(ctx, projectId, partnerId, 'jv.proposal.manage');
    const project = await this.s.project(projectId);
    const criteria = this.criteriaOf(await this.criteriaSet(projectId));
    const basis = assertAssessmentEntry({ ...body, basis: body.basis ?? null, knownCriterionKeys: criteria.map((c) => c.key) });
    if (body.proposalId) {
      const pr = await loadInProject(this.s.db, schema.partnerProposal, projectId, body.proposalId);
      if (pr.partnerId !== p.id) throw notFound();
    }
    if (body.documentId) await this.s.visibleDocument(ctx, projectId, body.documentId);
    const id = newId();
    await this.s.db.tx().insert(schema.partnerAssessmentEntry).values({
      id,
      orgId: ctx.principal.orgId,
      projectId,
      partnerId: p.id,
      proposalId: body.proposalId ?? null,
      criterionKey: body.criterionKey ?? null,
      basis,
      statement: body.statement,
      score: body.score ?? null,
      sourceReference: body.sourceReference ?? null,
      documentId: body.documentId ?? null,
      isDemo: project.isDemo,
      createdBy: ctx.principal.userId,
    });
    await this.s.audit.record({ action: 'jv.proposal.assess', entityType: 'partner', entityId: p.id, projectId, after: { entryId: id, basis, criterionKey: body.criterionKey ?? null, score: body.score ?? null } });
    return { id };
  }

  async listProposals(ctx: RequestContext, projectId: string, partnerId: string) {
    await this.loadVisible(ctx, projectId, partnerId, 'jv.deal.read');
    const t = schema.partnerProposal;
    const rows = await this.s.db
      .tx()
      .select()
      .from(t)
      .where(and(eq(t.projectId, projectId), eq(t.partnerId, partnerId), this.s.policy.visibilitySql(ctx, projectId, { classification: t.classification })))
      .orderBy(desc(t.createdAt), desc(t.id));
    return { items: rows.map((r) => this.proposalDto(r)) };
  }

  private proposalDto(r: typeof schema.partnerProposal.$inferSelect) {
    return {
      id: r.id,
      partnerId: r.partnerId,
      code: r.code,
      title: r.title,
      receivedOn: r.receivedOn,
      scope: r.scope,
      termsSummary: r.termsSummary,
      documentId: r.documentId,
      supersedesProposalId: r.supersedesProposalId,
      classification: r.classification,
      isDemo: r.isDemo,
      createdAt: r.createdAt.toISOString(),
      createdBy: r.createdBy,
      version: r.version,
    };
  }

  async addProposal(ctx: RequestContext, projectId: string, partnerId: string, body: Q<'addProposal'>['body']) {
    const p = await this.loadVisible(ctx, projectId, partnerId, 'jv.proposal.manage');
    const project = await this.s.project(projectId);
    this.s.assertClassification(ctx, body.classification);
    if (body.receivedOn && body.receivedOn > this.s.today(project)) throw ruleViolation('jv.proposal.date_future', 'A proposal cannot be received in the future');
    if (body.documentId) await this.s.visibleDocument(ctx, projectId, body.documentId);
    if (body.supersedesProposalId) {
      const prev = await loadInProject(this.s.db, schema.partnerProposal, projectId, body.supersedesProposalId);
      if (prev.partnerId !== p.id) throw notFound();
    }
    const code = await this.s.nextCode('partner_proposal', 'code', projectId, 'PRP');
    const id = newId();
    await this.s.db.tx().insert(schema.partnerProposal).values({
      id,
      orgId: ctx.principal.orgId,
      projectId,
      partnerId: p.id,
      code,
      title: body.title,
      receivedOn: body.receivedOn ?? null,
      scope: body.scope ?? null,
      termsSummary: body.termsSummary ?? null,
      documentId: body.documentId ?? null,
      supersedesProposalId: body.supersedesProposalId ?? null,
      classification: body.classification,
      isDemo: project.isDemo,
      createdBy: ctx.principal.userId,
    });
    await this.s.audit.record({ action: 'jv.proposal.create', entityType: 'partner', entityId: p.id, projectId, after: { proposalId: id, code } });
    return { id, code, version: 1 };
  }

  async compare(ctx: RequestContext, projectId: string) {
    await this.s.project(projectId);
    this.s.assertListable(ctx, projectId, 'jv.deal.read');
    const t = schema.partner;
    const rows = await this.s.db
      .tx()
      .select()
      .from(t)
      .where(and(eq(t.projectId, projectId), this.s.policy.visibilitySql(ctx, projectId, { classification: t.classification })))
      .orderBy(asc(t.code), asc(t.id));
    const criteria = this.criteriaOf(await this.criteriaSet(projectId));
    const scores = await this.latestScores(projectId, rows.map((r) => r.id));
    const basisCounts = new Map<string, { facts: number; judgements: number }>();
    if (rows.length) {
      const r = await this.s.db.tx().execute<{ partner_id: string; facts: number; judgements: number }>(sql`
        select partner_id, count(*) filter (where basis = 'fact')::int as facts, count(*) filter (where basis = 'judgement')::int as judgements
          from partner_assessment_entry where project_id = ${projectId}
           and partner_id in (${sql.join(rows.map((x) => sql`${x.id}::uuid`), sql`, `)}) group by partner_id`);
      for (const x of r.rows) basisCounts.set(x.partner_id, { facts: x.facts, judgements: x.judgements });
    }
    return {
      criteria: criteria.map((c) => ({ ...c, nameAr: c.nameAr ?? null })),
      items: rows.map((r) => {
        const sc = scores.get(r.id) ?? {};
        const w = criteria.length ? weightedScore(criteria, sc) : { score: null, missing: [] as string[] };
        return {
          partnerId: r.id,
          code: r.code,
          name: r.name,
          stage: r.stage,
          shortlisted: r.shortlisted,
          scores: Object.fromEntries(criteria.map((c) => [c.key, sc[c.key] ?? null])),
          weightedScore: w.score,
          missing: w.missing,
          facts: basisCounts.get(r.id)?.facts ?? 0,
          judgements: basisCounts.get(r.id)?.judgements ?? 0,
        };
      }),
      basisNote:
        'Scores are team judgement unless backed by fact entries citing their source. A weighted score is shown only when every criterion is scored; unscored criteria are never estimated.',
    };
  }
}

function pick(row: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, row[k] instanceof Date ? (row[k] as Date).toISOString() : row[k]]));
}

function stringify(o: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]));
}

