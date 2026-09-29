import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, ilike, inArray, or, sql, SQL } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  ApplicabilityStatus,
  Classification,
  REQUIREMENT_MACHINE,
  RequirementCommand,
  RequirementStatus,
  allowedCommands,
  applicabilityLabel,
  assertApplicabilityAssessment,
  assertConditionsSatisfied,
  assertRequirementCommand,
  conditionsState,
  initialApplicability,
  invalid,
  notFound,
  validityState,
} from '@hub/domain';
import type { z } from 'zod';
import type { CreateRegulatoryBody, RegulatoryListQuery, RequirementOutcomeBody, RequirementProgressBody, UpdateRegulatoryBody } from '@hub/contracts';
import { AuditService } from '../../platform/audit.service';
import { RecordVersionService, activeEvidenceCount, assertVersion, likeContains, loadInProject, nextCode, offsetOf, pageOf, updateVersioned } from '../../platform/helpers';
import type { RequestContext } from '../../platform/context';
import { newId } from '../../platform/ids';
import { NewcoProject, NewcoSupport } from './newco.support';

type Req = typeof schema.regulatoryRequirement.$inferSelect;
const RR = schema.regulatoryRequirement;
const READ = 'newco.register.read';
/** Days before `validTo` at which an approval is flagged "expiring" (proposed default; configurable later). */
export const VALIDITY_WARN_DAYS = 30;

/**
 * Regulatory, external-party and internal approval register (spec §7.2; REQ-AGR-004/005/007). Entries start with
 * applicability "Assessment pending — specialist" whatever their origin; applicability and the authority's outcome are
 * recorded by a specialist (newco.regulatory.verify, not the registrant) with evidence and validity. Conditions stay
 * open until their satisfaction is evidenced; an expired validity is flagged even before the status is updated.
 */
@Injectable()
export class RegulatoryService {
  constructor(
    private readonly s: NewcoSupport,
    private readonly audit: AuditService,
    private readonly versions: RecordVersionService,
  ) {}

  private get tx() {
    return this.s.db.tx();
  }

  private async dtos(projectId: string, rows: Req[], today: string) {
    const names = await this.s.userNames(rows.flatMap((r) => [r.ownerUserId, r.applicabilityAssessedBy, r.outcomeRecordedBy]));
    const entIds = rows.map((r) => r.legalEntityId).filter((x): x is string => !!x);
    const ents = entIds.length ? await this.tx.select({ id: schema.legalEntity.id, name: schema.legalEntity.name }).from(schema.legalEntity).where(inArray(schema.legalEntity.id, entIds)) : [];
    const eM = new Map(ents.map((e) => [e.id, e.name]));
    const ev = await this.s.evidenceCounts(projectId, 'regulatory_requirement', rows.map((r) => r.id));
    return rows.map((r) => {
      const status = r.status as RequirementStatus;
      const applicability = r.applicability as ApplicabilityStatus;
      return {
        id: r.id,
        code: r.code,
        category: r.category,
        authority: r.authority,
        title: r.title,
        description: r.description,
        origin: r.origin as 'manual' | 'source_extraction' | 'import',
        sourceReference: r.sourceReference,
        applicability,
        applicabilityLabel: applicabilityLabel(applicability),
        applicabilityAssessment: { assessedBy: this.s.person(names, r.applicabilityAssessedBy), assessedAt: r.applicabilityAssessedAt?.toISOString() ?? null, basis: r.applicabilityNote },
        status,
        owner: this.s.person(names, r.ownerUserId),
        submittedOn: r.submittedOn,
        decisionOn: r.decisionOn,
        conditions: r.conditions,
        conditionsState: conditionsState({ status, conditions: r.conditions, conditionsSatisfiedAt: r.conditionsSatisfiedAt?.toISOString() ?? null }),
        validFrom: r.validFrom,
        validTo: r.validTo,
        validityState: validityState({ status, validFrom: r.validFrom, validTo: r.validTo, today, warnDays: VALIDITY_WARN_DAYS }),
        outcomeRecordedBy: this.s.person(names, r.outcomeRecordedBy),
        legalEntity: r.legalEntityId ? { id: r.legalEntityId, name: eM.get(r.legalEntityId) ?? '' } : null,
        gateKey: r.gateKey,
        verificationStatus: r.verificationStatus,
        evidence: ev.get(r.id) ?? { active: 0, conflicting: 0 },
        allowedCommands: allowedCommands(REQUIREMENT_MACHINE, status),
        classification: r.classification as Classification,
        isDemo: r.isDemo,
        version: r.version,
        updatedAt: r.updatedAt.toISOString(),
      };
    });
  }

  async list(ctx: RequestContext, projectId: string, q: z.infer<typeof RegulatoryListQuery>) {
    const p = await this.s.project(ctx, projectId);
    this.s.assertProjectRead(ctx, p, READ);
    const today = this.s.today(p);
    const conds: SQL[] = [eq(RR.projectId, projectId), this.s.policy.visibilitySql(ctx, projectId, { classification: RR.classification })];
    if (q.category) conds.push(eq(RR.category, q.category));
    if (q.applicability) conds.push(eq(RR.applicability, q.applicability));
    if (q.status) conds.push(eq(RR.status, q.status));
    if (q.validity === 'expired') conds.push(sql`(${RR.status} = 'expired' or (${RR.status} in ('granted', 'granted_with_conditions') and ${RR.validTo} < ${today}::date))`);
    if (q.validity === 'expiring') conds.push(sql`(${RR.status} in ('granted', 'granted_with_conditions') and ${RR.validTo} >= ${today}::date and ${RR.validTo} <= ${today}::date + ${VALIDITY_WARN_DAYS}::int)`);
    if (q.q) conds.push(or(ilike(RR.title, likeContains(q.q)), ilike(RR.code, likeContains(q.q)), ilike(RR.authority, likeContains(q.q)))!);
    const where = and(...conds);
    const [{ n }] = (await this.tx.select({ n: count() }).from(RR).where(where)) as [{ n: number }];
    const rows = await this.tx.select().from(RR).where(where).orderBy(asc(RR.code)).limit(q.pageSize).offset(offsetOf(q));
    return pageOf(await this.dtos(projectId, rows, today), Number(n), q);
  }

  private async load(ctx: RequestContext, p: NewcoProject, id: string): Promise<Req> {
    this.s.assertProjectRead(ctx, p, READ);
    const r = await loadInProject(this.s.db, RR, p.id, id);
    if (!this.s.policy.canSee(ctx, { projectId: p.id, classification: r.classification as Classification })) throw notFound();
    return r;
  }

  async get(ctx: RequestContext, projectId: string, id: string) {
    const p = await this.s.project(ctx, projectId);
    const r = await this.load(ctx, p, id);
    return (await this.dtos(projectId, [r], this.s.today(p)))[0]!;
  }

  private async result(p: NewcoProject, row: Record<string, unknown>) {
    const [dto] = await this.dtos(p.id, [row as unknown as Req], this.s.today(p));
    return { id: dto!.id, status: dto!.status, applicability: dto!.applicability, applicabilityLabel: dto!.applicabilityLabel, validityState: dto!.validityState, conditionsState: dto!.conditionsState, version: dto!.version };
  }

  async create(ctx: RequestContext, projectId: string, body: z.infer<typeof CreateRegulatoryBody>) {
    const p = await this.s.project(ctx, projectId);
    const classification = body.classification ?? 'confidential';
    this.s.assertClassificationAllowed(ctx, classification);
    this.s.assertManage(ctx, p, 'newco.regulatory.manage', { classification });
    if (body.ownerUserId) await this.s.assertMember(projectId, body.ownerUserId, 'owner');
    if (body.legalEntityId) await this.s.assertEntityInProject(projectId, body.legalEntityId);
    const code = await nextCode(this.s.db, RR, projectId, 'REG');
    const id = newId();
    const applicability = initialApplicability(body.origin);
    await this.tx.insert(RR).values({
      id,
      orgId: p.orgId,
      projectId,
      code,
      category: body.category,
      authority: body.authority,
      title: body.title,
      description: body.description ?? null,
      origin: body.origin,
      sourceReference: body.sourceReference ?? null,
      applicability,
      ownerUserId: body.ownerUserId ?? null,
      legalEntityId: body.legalEntityId ?? null,
      gateKey: body.gateKey ?? null,
      // A source-extracted entry is a historical / unverified claim, never a determination (REQ-AGR-007).
      verificationStatus: body.origin === 'manual' ? 'proposed' : 'historical_unverified',
      classification,
      isDemo: p.isDemo,
      createdBy: ctx.principal.userId,
    });
    await this.versions.snapshot({ projectId, entityType: 'regulatory_requirement', entityId: id, versionNo: 1, snapshot: { code, category: body.category, authority: body.authority, title: body.title, applicability, origin: body.origin }, reason: 'Created' });
    await this.audit.record({ action: 'newco.regulatory.create', entityType: 'regulatory_requirement', entityId: id, projectId, after: { code, category: body.category, authority: body.authority, applicability, origin: body.origin } });
    return { id, code, version: 1 };
  }

  async update(ctx: RequestContext, projectId: string, id: string, body: z.infer<typeof UpdateRegulatoryBody>) {
    const p = await this.s.project(ctx, projectId);
    const r = await this.load(ctx, p, id);
    this.s.assertManage(ctx, p, 'newco.regulatory.manage', { classification: r.classification as Classification });
    assertVersion(r, body.expectedVersion, 'regulatory requirement');
    const u: Partial<typeof schema.regulatoryRequirement.$inferInsert> = {};
    if (body.title !== undefined) u.title = body.title;
    if (body.authority !== undefined) u.authority = body.authority;
    if (body.description !== undefined) u.description = body.description;
    if (body.sourceReference !== undefined) u.sourceReference = body.sourceReference;
    if (body.ownerUserId !== undefined) {
      if (body.ownerUserId) await this.s.assertMember(projectId, body.ownerUserId, 'owner');
      u.ownerUserId = body.ownerUserId;
    }
    if (body.legalEntityId !== undefined) {
      if (body.legalEntityId) await this.s.assertEntityInProject(projectId, body.legalEntityId);
      u.legalEntityId = body.legalEntityId;
    }
    if (body.gateKey !== undefined) u.gateKey = body.gateKey;
    if (body.classification !== undefined) {
      this.s.assertClassificationAllowed(ctx, body.classification);
      u.classification = body.classification;
    }
    if (Object.keys(u).length === 0) throw invalid('newco.no_changes', 'No changes supplied');
    const row = await updateVersioned(this.s.db, RR, { id, projectId, expectedVersion: body.expectedVersion }, u);
    await this.versions.snapshot({ projectId, entityType: 'regulatory_requirement', entityId: id, versionNo: row['version'] as number, snapshot: row, reason: 'Descriptive update' });
    await this.audit.record({ action: 'newco.regulatory.update', entityType: 'regulatory_requirement', entityId: id, projectId, before: Object.fromEntries(Object.keys(u).map((k) => [k, (r as Record<string, unknown>)[k]])), after: u as Record<string, unknown> });
    return { id, version: row['version'] as number };
  }

  /** Specialist applicability assessment (not the registrant — not_self). */
  async assessApplicability(ctx: RequestContext, projectId: string, id: string, body: { expectedVersion: number; applicability: ApplicabilityStatus; basis: string }) {
    const p = await this.s.project(ctx, projectId);
    const r = await this.load(ctx, p, id);
    this.s.assertManage(ctx, p, 'newco.regulatory.verify', { classification: r.classification as Classification, requesterUserId: r.createdBy });
    assertVersion(r, body.expectedVersion, 'regulatory requirement');
    assertApplicabilityAssessment({ applicability: body.applicability, basis: body.basis, assessorUserId: ctx.principal.userId!, createdBy: r.createdBy });
    const pending = body.applicability === 'assessment_pending';
    const row = await updateVersioned(this.s.db, RR, { id, projectId, expectedVersion: body.expectedVersion }, {
      applicability: body.applicability,
      applicabilityAssessedBy: pending ? null : ctx.principal.userId,
      applicabilityAssessedAt: pending ? null : new Date(),
      applicabilityNote: body.basis,
    });
    await this.versions.snapshot({ projectId, entityType: 'regulatory_requirement', entityId: id, versionNo: row['version'] as number, snapshot: row, reason: `Applicability: ${body.applicability}` });
    await this.audit.record({ action: 'newco.regulatory.assess_applicability', entityType: 'regulatory_requirement', entityId: id, projectId, before: { applicability: r.applicability }, after: { applicability: body.applicability }, reason: body.basis });
    return this.result(p, row);
  }

  private async command(ctx: RequestContext, p: NewcoProject, r: Req, body: { expectedVersion: number; command: RequirementCommand; date?: string; conditions?: string; validFrom?: string; validTo?: string; note?: string }) {
    assertVersion(r, body.expectedVersion, 'regulatory requirement');
    const ev = await activeEvidenceCount(this.s.db, p.id, 'regulatory_requirement', r.id);
    const to = assertRequirementCommand({
      command: body.command,
      status: r.status as RequirementStatus,
      applicability: r.applicability as ApplicabilityStatus,
      date: body.date ?? null,
      conditions: body.conditions ?? null,
      validFrom: body.validFrom ?? null,
      validTo: body.validTo ?? r.validTo,
      note: body.note ?? null,
      activeEvidence: ev.active,
      conflictingEvidence: ev.conflicting,
      today: this.s.today(p),
    });
    const u: Partial<typeof schema.regulatoryRequirement.$inferInsert> = { status: to };
    if (body.command === 'submit') u.submittedOn = body.date!;
    if (body.command === 'record_grant' || body.command === 'record_grant_with_conditions' || body.command === 'record_refusal') {
      Object.assign(u, { decisionOn: body.date!, outcomeRecordedBy: ctx.principal.userId, outcomeRecordedAt: new Date(), verificationStatus: 'confirmed' as const, conditionsSatisfiedAt: null, conditionsSatisfiedBy: null, conditionsSatisfactionNote: null });
      if (body.command !== 'record_refusal') Object.assign(u, { validFrom: body.validFrom ?? null, validTo: body.validTo ?? null, conditions: body.command === 'record_grant_with_conditions' ? body.conditions! : (body.conditions ?? null) });
    }
    if (body.command === 'reopen') Object.assign(u, { decisionOn: null, validFrom: null, validTo: null, verificationStatus: 'proposed' as const });
    const row = await updateVersioned(this.s.db, RR, { id: r.id, projectId: p.id, expectedVersion: body.expectedVersion }, u);
    await this.versions.snapshot({ projectId: p.id, entityType: 'regulatory_requirement', entityId: r.id, versionNo: row['version'] as number, snapshot: row, reason: `${body.command}: ${r.status} → ${to}` });
    await this.audit.record({
      action: `newco.regulatory.${body.command}`,
      entityType: 'regulatory_requirement',
      entityId: r.id,
      projectId: p.id,
      before: { status: r.status },
      after: { status: to, date: body.date ?? null, validFrom: u.validFrom ?? null, validTo: u.validTo ?? null, activeEvidence: ev.active },
      reason: body.note ?? null,
    });
    return this.result(p, row);
  }

  async progress(ctx: RequestContext, projectId: string, id: string, body: z.infer<typeof RequirementProgressBody>) {
    const p = await this.s.project(ctx, projectId);
    const r = await this.load(ctx, p, id);
    this.s.assertManage(ctx, p, 'newco.regulatory.manage', { classification: r.classification as Classification });
    return this.command(ctx, p, r, body);
  }

  /** The authority's outcome is a verified fact: recorded by a verifier other than the registrant, with evidence. */
  async recordOutcome(ctx: RequestContext, projectId: string, id: string, body: z.infer<typeof RequirementOutcomeBody>) {
    const p = await this.s.project(ctx, projectId);
    const r = await this.load(ctx, p, id);
    this.s.assertManage(ctx, p, 'newco.regulatory.verify', { classification: r.classification as Classification, requesterUserId: r.createdBy });
    return this.command(ctx, p, r, body);
  }

  async conditionsSatisfied(ctx: RequestContext, projectId: string, id: string, body: { expectedVersion: number; note: string }) {
    const p = await this.s.project(ctx, projectId);
    const r = await this.load(ctx, p, id);
    this.s.assertManage(ctx, p, 'newco.regulatory.verify', { classification: r.classification as Classification, requesterUserId: r.outcomeRecordedBy });
    assertVersion(r, body.expectedVersion, 'regulatory requirement');
    const ev = await activeEvidenceCount(this.s.db, projectId, 'regulatory_requirement', id);
    const state = conditionsState({ status: r.status as RequirementStatus, conditions: r.conditions, conditionsSatisfiedAt: r.conditionsSatisfiedAt?.toISOString() ?? null });
    assertConditionsSatisfied({ state, activeEvidence: ev.active, conflictingEvidence: ev.conflicting, note: body.note, actorUserId: ctx.principal.userId!, outcomeRecordedBy: r.outcomeRecordedBy });
    const row = await updateVersioned(this.s.db, RR, { id, projectId, expectedVersion: body.expectedVersion }, { conditionsSatisfiedAt: new Date(), conditionsSatisfiedBy: ctx.principal.userId, conditionsSatisfactionNote: body.note });
    await this.versions.snapshot({ projectId, entityType: 'regulatory_requirement', entityId: id, versionNo: row['version'] as number, snapshot: row, reason: 'Conditions satisfied' });
    await this.audit.record({ action: 'newco.regulatory.conditions_satisfied', entityType: 'regulatory_requirement', entityId: id, projectId, before: { conditionsState: state }, after: { conditionsState: 'satisfied', activeEvidence: ev.active }, reason: body.note });
    return this.result(p, row);
  }
}

void newId;
