import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, inArray, or, SQL } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  AGREEMENT_MACHINE,
  AgreementCommand,
  AgreementStage,
  Classification,
  ConsentStatus,
  allowedCommands,
  assertAgreementCommand,
  assertConsentResponse,
  assertExpansionConfirmation,
  displayKindExpansion,
  invalid,
  notFound,
  ruleViolation,
} from '@hub/domain';
import type { z } from 'zod';
import type { AgreementListQuery, AgreementStageBody, ConsentListQuery, CreateAgreementBody, CreateConsentBody, RecordConsentResponseBody, UpdateAgreementBody, UpdateConsentBody } from '@hub/contracts';
import { AuditService } from '../../platform/audit.service';
import { OutboxService } from '../../platform/outbox.service';
import { RecordVersionService, assertVersion, likeContains, loadInProject, nextCode, offsetOf, pageOf, updateVersioned } from '../../platform/helpers';
import { orderBySort } from '../../platform/sort';
import type { RequestContext } from '../../platform/context';
import { newId } from '../../platform/ids';
import { CarveoutProject, CarveoutSupport, iso } from './carveout.support';
import { PerimeterService, pick } from './perimeter.service';

type Agreement = typeof schema.agreement.$inferSelect;
type Consent = typeof schema.consent.$inferSelect;
const A = schema.agreement;
const C = schema.consent;
const READ = 'carveout.register.read';

/**
 * Agreement register (REQ-AGR-001/002/003) and consent tracking (REQ-AGR-008). Agreements and consents are
 * project-level registers: listing needs a project-wide read grant and every row honours its classification.
 * Abbreviations are stored as source labels; an expansion is shown only after an authorized owner confirmed it.
 */
@Injectable()
export class AgreementsService {
  constructor(
    private readonly s: CarveoutSupport,
    private readonly perimeter: PerimeterService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly versions: RecordVersionService,
  ) {}

  private get tx() {
    return this.s.db.tx();
  }

  // =========================================================================================================
  // Agreements

  private async loadAgreement(ctx: RequestContext, p: CarveoutProject, id: string): Promise<Agreement> {
    const a = await loadInProject(this.s.db, A, p.id, id);
    this.s.assertProjectWide(ctx, READ, p.id);
    this.s.assertRead(ctx, READ, { projectId: p.id, classification: a.classification as Classification });
    return a;
  }

  private async summaries(rows: Agreement[]) {
    const names = await this.s.userNames(rows.flatMap((r) => [r.ownerUserId, r.legalReviewerUserId]));
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      kindLabel: r.kindLabel,
      kindExpansionDisplay: displayKindExpansion({ kindExpansion: r.kindExpansion, kindExpansionConfirmed: r.kindExpansionConfirmed }),
      kindExpansionConfirmed: r.kindExpansionConfirmed,
      title: r.title,
      stage: r.stage as AgreementStage,
      owner: this.s.person(names, r.ownerUserId),
      legalReviewer: this.s.person(names, r.legalReviewerUserId),
      currentDraftVersion: r.currentDraftVersion,
      signingDate: r.signingDate,
      effectiveDate: r.effectiveDate,
      expiryDate: r.expiryDate,
      classification: r.classification as Classification,
      isDemo: r.isDemo,
      version: r.version,
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async listAgreements(ctx: RequestContext, projectId: string, q: z.infer<typeof AgreementListQuery>) {
    await this.s.project(ctx, projectId);
    this.s.assertProjectWide(ctx, READ, projectId);
    const conds: SQL[] = [eq(A.projectId, projectId), this.s.policy.visibilitySql(ctx, projectId, { classification: A.classification })];
    if (q.stage) conds.push(eq(A.stage, q.stage));
    if (q.q) conds.push(or(ilike(A.title, likeContains(q.q)), ilike(A.code, likeContains(q.q)), ilike(A.kindLabel, likeContains(q.q)))!);
    const where = and(...conds);
    const [{ n }] = (await this.tx.select({ n: count() }).from(A).where(where)) as [{ n: number }];
    const order = orderBySort(
      q.sort,
      { code: A.code, title: A.title, stage: A.stage, signingDate: A.signingDate, effectiveDate: A.effectiveDate, expiryDate: A.expiryDate, updatedAt: A.updatedAt },
      A.id,
      [asc(A.code), asc(A.id)],
    );
    const rows = await this.tx.select().from(A).where(where).orderBy(...order).limit(q.pageSize).offset(offsetOf(q));
    return pageOf(await this.summaries(rows), Number(n), q);
  }

  async getAgreement(ctx: RequestContext, projectId: string, agreementId: string) {
    const p = await this.s.project(ctx, projectId);
    const a = await this.loadAgreement(ctx, p, agreementId);
    const [summary] = await this.summaries([a]);
    const AV = schema.agreementVersion;
    const vers = await this.tx.select().from(AV).where(and(eq(AV.projectId, projectId), eq(AV.agreementId, a.id))).orderBy(desc(AV.createdAt));
    const names = await this.s.userNames([a.kindExpansionConfirmedBy, ...vers.map((v) => v.recordedBy)]);
    const PI = schema.perimeterItem;
    const items = await this.tx
      .select({ id: PI.id, code: PI.code })
      .from(PI)
      .where(and(eq(PI.projectId, projectId), eq(PI.agreementId, a.id), this.s.policy.visibilitySql(ctx, projectId, { classification: PI.classification }), this.s.policy.reachSql(ctx, READ, projectId, PI.workstreamId)))
      .orderBy(asc(PI.code));
    const consents = await this.tx
      .select({ id: C.id, code: C.code, kind: C.kind, counterparty: C.counterparty, status: C.status, dueDate: C.dueDate })
      .from(C)
      .where(and(eq(C.projectId, projectId), eq(C.agreementId, a.id), this.s.policy.visibilitySql(ctx, projectId, { classification: C.classification })))
      .orderBy(asc(C.code));
    const ev = (await this.s.evidenceCounts(projectId, 'agreement', [a.id])).get(a.id) ?? { active: 0, conflicting: 0 };
    return {
      ...summary!,
      kindExpansionProposed: a.kindExpansion,
      kindExpansionConfirmation: { confirmedBy: this.s.person(names, a.kindExpansionConfirmedBy), confirmedAt: iso(a.kindExpansionConfirmedAt), basis: a.kindExpansionBasis },
      parties: (a.parties ?? []).map((x) => ({ name: x.name, role: x.role ?? null, legalEntityId: x.legalEntityId ?? null })),
      scope: a.scope,
      outstandingIssues: a.outstandingIssues,
      renewalDate: a.renewalDate,
      obligations: a.obligations,
      executedDocumentId: a.executedDocumentId,
      versions: vers.map((v) => ({ id: v.id, versionLabel: v.versionLabel, documentId: v.documentId, documentVersionId: v.documentVersionId, note: v.note, recordedByName: names.get(v.recordedBy) ?? null, createdAt: v.createdAt.toISOString() })),
      evidence: ev,
      perimeterItems: items,
      consents: consents.map((c) => ({ ...c, status: c.status as ConsentStatus })),
      allowedCommands: allowedCommands(AGREEMENT_MACHINE, a.stage as AgreementStage),
      createdAt: a.createdAt.toISOString(),
    };
  }

  private async validateAgreementRefs(p: CarveoutProject, b: { ownerUserId?: string | null; legalReviewerUserId?: string | null; parties?: { legalEntityId?: string }[] }) {
    if (b.ownerUserId) await this.s.assertMember(p.id, b.ownerUserId, 'owner');
    if (b.legalReviewerUserId) await this.s.assertMember(p.id, b.legalReviewerUserId, 'legal reviewer');
    for (const party of b.parties ?? []) if (party.legalEntityId) await this.s.assertEntityInProject(p.id, party.legalEntityId, 'party entity');
  }

  private assertManage(ctx: RequestContext, p: CarveoutProject, classification: Classification) {
    this.s.assertProjectWide(ctx, 'carveout.agreement.manage', p.id);
    this.s.policy.assert(ctx, 'carveout.agreement.manage', { projectId: p.id, classification });
  }

  async createAgreement(ctx: RequestContext, projectId: string, body: z.infer<typeof CreateAgreementBody>) {
    const p = await this.s.project(ctx, projectId);
    const classification = body.classification ?? 'confidential';
    this.s.assertClassificationAllowed(ctx, classification);
    this.assertManage(ctx, p, classification);
    await this.validateAgreementRefs(p, body);
    const code = await nextCode(this.s.db, A, projectId, 'AGR');
    const id = newId();
    await this.tx.insert(A).values({
      id,
      orgId: p.orgId,
      projectId,
      code,
      kindLabel: body.kindLabel,
      kindExpansion: body.kindExpansionProposed ?? null,
      kindExpansionConfirmed: false, // REQ-AGR-002: never assumed
      title: body.title,
      parties: body.parties.map((x) => ({ name: x.name, ...(x.role ? { role: x.role } : {}), ...(x.legalEntityId ? { legalEntityId: x.legalEntityId } : {}) })),
      scope: body.scope ?? null,
      ownerUserId: body.ownerUserId ?? null,
      legalReviewerUserId: body.legalReviewerUserId ?? null,
      outstandingIssues: body.outstandingIssues ?? null,
      renewalDate: body.renewalDate ?? null,
      expiryDate: body.expiryDate ?? null,
      obligations: body.obligations ?? null,
      classification,
      isDemo: p.isDemo,
      createdBy: ctx.principal.userId,
    });
    await this.versions.snapshot({ projectId, entityType: 'agreement', entityId: id, versionNo: 1, snapshot: { code, kindLabel: body.kindLabel, title: body.title, stage: 'identified' }, reason: 'Created' });
    await this.audit.record({ action: 'carveout.agreement.create', entityType: 'agreement', entityId: id, projectId, after: { code, kindLabel: body.kindLabel, kindExpansionProposed: body.kindExpansionProposed ?? null } });
    return { id, code, version: 1 };
  }

  async updateAgreement(ctx: RequestContext, projectId: string, agreementId: string, body: z.infer<typeof UpdateAgreementBody>) {
    const p = await this.s.project(ctx, projectId);
    const a = await this.loadAgreement(ctx, p, agreementId);
    this.assertManage(ctx, p, a.classification as Classification);
    assertVersion(a, body.expectedVersion, 'agreement');
    const u: Partial<typeof schema.agreement.$inferInsert> = {};
    if (body.title !== undefined) u.title = body.title;
    if (body.kindExpansionProposed !== undefined) {
      if (a.kindExpansionConfirmed) throw ruleViolation('agreement.expansion_confirmed', 'The confirmed expansion cannot be edited');
      u.kindExpansion = body.kindExpansionProposed;
    }
    if (body.parties !== undefined) u.parties = body.parties.map((x) => ({ name: x.name, ...(x.role ? { role: x.role } : {}), ...(x.legalEntityId ? { legalEntityId: x.legalEntityId } : {}) }));
    if (body.scope !== undefined) u.scope = body.scope;
    if (body.ownerUserId !== undefined) u.ownerUserId = body.ownerUserId;
    if (body.legalReviewerUserId !== undefined) u.legalReviewerUserId = body.legalReviewerUserId;
    if (body.outstandingIssues !== undefined) u.outstandingIssues = body.outstandingIssues;
    if (body.renewalDate !== undefined) u.renewalDate = body.renewalDate;
    if (body.expiryDate !== undefined) u.expiryDate = body.expiryDate;
    if (body.obligations !== undefined) u.obligations = body.obligations;
    if (body.classification !== undefined) {
      this.s.assertClassificationAllowed(ctx, body.classification);
      u.classification = body.classification;
    }
    if (Object.keys(u).length === 0) throw invalid('carveout.no_changes', 'No changes supplied');
    await this.validateAgreementRefs(p, body as { ownerUserId?: string | null; legalReviewerUserId?: string | null; parties?: { legalEntityId?: string }[] });
    const row = await updateVersioned(this.s.db, A, { id: agreementId, projectId, expectedVersion: body.expectedVersion }, u);
    await this.versions.snapshot({ projectId, entityType: 'agreement', entityId: agreementId, versionNo: row['version'] as number, snapshot: row, reason: 'Updated' });
    await this.audit.record({ action: 'carveout.agreement.update', entityType: 'agreement', entityId: agreementId, projectId, before: pick(a, Object.keys(u)), after: u as Record<string, unknown> });
    return { id: agreementId, version: row['version'] as number };
  }

  async stage(ctx: RequestContext, projectId: string, agreementId: string, body: z.infer<typeof AgreementStageBody>) {
    const p = await this.s.project(ctx, projectId);
    const a = await this.loadAgreement(ctx, p, agreementId);
    this.assertManage(ctx, p, a.classification as Classification);
    assertVersion(a, body.expectedVersion, 'agreement');
    let executedDocumentId = a.executedDocumentId;
    if (body.executedDocumentId) {
      const doc = await loadInProject(this.s.db, schema.document, projectId, body.executedDocumentId);
      if (!this.s.policy.canSee(ctx, { projectId, classification: doc.classification as Classification, roomId: doc.roomId })) throw notFound();
      executedDocumentId = doc.id;
    }
    const ev = (await this.s.evidenceCounts(projectId, 'agreement', [a.id])).get(a.id) ?? { active: 0, conflicting: 0 };
    const signingDate = body.signingDate ?? a.signingDate;
    const effectiveDate = body.effectiveDate ?? a.effectiveDate;
    const expiryDate = body.expiryDate ?? a.expiryDate;
    const to = assertAgreementCommand({
      command: body.command as AgreementCommand,
      stage: a.stage as AgreementStage,
      legalReviewerUserId: a.legalReviewerUserId,
      signingDate,
      effectiveDate,
      expiryDate,
      executedDocumentId,
      activeEvidence: ev.active,
      conflictingEvidence: ev.conflicting,
      reason: body.reason ?? null,
      today: this.s.today(p),
    });
    const u: Partial<typeof schema.agreement.$inferInsert> = { stage: to };
    if (body.command === 'record_signing') Object.assign(u, { signingDate, executedDocumentId });
    if (body.command === 'record_effective') u.effectiveDate = effectiveDate;
    if (body.command === 'record_expiry') u.expiryDate = expiryDate;
    const row = await updateVersioned(this.s.db, A, { id: agreementId, projectId, expectedVersion: body.expectedVersion }, u);
    await this.versions.snapshot({ projectId, entityType: 'agreement', entityId: agreementId, versionNo: row['version'] as number, snapshot: row, reason: `Stage ${a.stage} → ${to}` });
    await this.audit.record({ action: `carveout.agreement.${body.command}`, entityType: 'agreement', entityId: agreementId, projectId, before: { stage: a.stage }, after: { stage: to, signingDate: u.signingDate ?? null, effectiveDate: u.effectiveDate ?? null, executedDocumentId: u.executedDocumentId ?? null }, reason: body.reason ?? null });
    return { id: agreementId, stage: to, version: row['version'] as number };
  }

  async addVersion(ctx: RequestContext, projectId: string, agreementId: string, body: { expectedVersion: number; versionLabel: string; documentId?: string; documentVersionId?: string; note?: string }) {
    const p = await this.s.project(ctx, projectId);
    const a = await this.loadAgreement(ctx, p, agreementId);
    this.assertManage(ctx, p, a.classification as Classification);
    assertVersion(a, body.expectedVersion, 'agreement');
    if (['signed', 'effective', 'terminated', 'expired'].includes(a.stage)) throw ruleViolation('agreement.not_negotiating', `Draft versions are recorded before signing (stage: ${a.stage})`);
    let documentId = body.documentId ?? null;
    let documentVersionId = body.documentVersionId ?? null;
    if (documentVersionId) {
      const v = await loadInProject(this.s.db, schema.documentVersion, projectId, documentVersionId);
      if (documentId && documentId !== v.documentId) throw ruleViolation('agreement.version_document_mismatch', 'The document version does not belong to the document');
      documentId = v.documentId;
    }
    if (documentId) {
      const doc = await loadInProject(this.s.db, schema.document, projectId, documentId);
      if (!this.s.policy.canSee(ctx, { projectId, classification: doc.classification as Classification, roomId: doc.roomId })) throw notFound();
    }
    const AV = schema.agreementVersion;
    const [dup] = await this.tx.select({ id: AV.id }).from(AV).where(and(eq(AV.projectId, projectId), eq(AV.agreementId, a.id), eq(AV.versionLabel, body.versionLabel)));
    if (dup) throw ruleViolation('agreement.version_exists', `Version ${body.versionLabel} is already recorded`);
    const id = newId();
    await this.tx.insert(AV).values({ id, orgId: p.orgId, projectId, agreementId: a.id, versionLabel: body.versionLabel, documentId, documentVersionId, note: body.note ?? null, recordedBy: ctx.principal.userId! });
    const row = await updateVersioned(this.s.db, A, { id: a.id, projectId, expectedVersion: body.expectedVersion }, { currentDraftVersion: body.versionLabel });
    await this.audit.record({ action: 'carveout.agreement.add_version', entityType: 'agreement', entityId: a.id, projectId, before: { currentDraftVersion: a.currentDraftVersion }, after: { currentDraftVersion: body.versionLabel, agreementVersionId: id, documentId } });
    return { id, agreementId: a.id, versionLabel: body.versionLabel, version: row['version'] as number };
  }

  async confirmExpansion(ctx: RequestContext, projectId: string, agreementId: string, body: { expectedVersion: number; expansion: string; basis: string }) {
    const p = await this.s.project(ctx, projectId);
    const a = await this.loadAgreement(ctx, p, agreementId);
    this.assertManage(ctx, p, a.classification as Classification);
    assertVersion(a, body.expectedVersion, 'agreement');
    assertExpansionConfirmation({ actorUserId: ctx.principal.userId!, ownerUserId: a.ownerUserId, legalReviewerUserId: a.legalReviewerUserId, expansion: body.expansion, basis: body.basis });
    const row = await updateVersioned(this.s.db, A, { id: a.id, projectId, expectedVersion: body.expectedVersion }, {
      kindExpansion: body.expansion,
      kindExpansionConfirmed: true,
      kindExpansionConfirmedBy: ctx.principal.userId,
      kindExpansionConfirmedAt: new Date(),
      kindExpansionBasis: body.basis,
    });
    await this.audit.record({ action: 'carveout.agreement.confirm_expansion', entityType: 'agreement', entityId: a.id, projectId, before: { kindExpansion: a.kindExpansion, confirmed: a.kindExpansionConfirmed }, after: { kindExpansion: body.expansion, confirmed: true }, reason: body.basis });
    return { id: a.id, version: row['version'] as number, kindExpansionDisplay: body.expansion };
  }

  // =========================================================================================================
  // Consents

  private async consentDtos(projectId: string, rows: Consent[], today: string) {
    const names = await this.s.userNames(rows.flatMap((r) => [r.ownerUserId, r.responseRecordedBy]));
    const itemIds = rows.map((r) => r.perimeterItemId).filter((x): x is string => !!x);
    const agIds = rows.map((r) => r.agreementId).filter((x): x is string => !!x);
    const PI = schema.perimeterItem;
    const items = itemIds.length ? await this.tx.select({ id: PI.id, code: PI.code }).from(PI).where(and(eq(PI.projectId, projectId), inArray(PI.id, itemIds))) : [];
    const ags = agIds.length ? await this.tx.select({ id: A.id, code: A.code }).from(A).where(and(eq(A.projectId, projectId), inArray(A.id, agIds))) : [];
    const iM = new Map(items.map((x) => [x.id, x]));
    const aM = new Map(ags.map((x) => [x.id, x]));
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      perimeterItem: r.perimeterItemId ? (iM.get(r.perimeterItemId) ?? null) : null,
      agreement: r.agreementId ? (aM.get(r.agreementId) ?? null) : null,
      kind: r.kind,
      counterparty: r.counterparty,
      contractRef: r.contractRef,
      owner: this.s.person(names, r.ownerUserId),
      status: r.status as ConsentStatus,
      requestedOn: r.requestedOn,
      respondedOn: r.respondedOn,
      dueDate: r.dueDate,
      overdue: !!r.dueDate && r.dueDate < today && ['not_requested', 'requested'].includes(r.status),
      validTo: r.validTo,
      conditions: r.conditions,
      responseEvidenceNote: r.responseEvidenceNote,
      responseDocumentId: r.responseDocumentId,
      responseRecordedBy: this.s.person(names, r.responseRecordedBy),
      responseRecordedAt: iso(r.responseRecordedAt),
      classification: r.classification as Classification,
      isDemo: r.isDemo,
      version: r.version,
    }));
  }

  async listConsents(ctx: RequestContext, projectId: string, q: z.infer<typeof ConsentListQuery>) {
    const p = await this.s.project(ctx, projectId);
    this.s.assertProjectWide(ctx, READ, projectId);
    const conds: SQL[] = [eq(C.projectId, projectId), this.s.policy.visibilitySql(ctx, projectId, { classification: C.classification })];
    if (q.perimeterItemId) conds.push(eq(C.perimeterItemId, q.perimeterItemId));
    if (q.status) conds.push(eq(C.status, q.status));
    if (q.q) conds.push(or(ilike(C.counterparty, likeContains(q.q)), ilike(C.code, likeContains(q.q)))!);
    const where = and(...conds);
    const [{ n }] = (await this.tx.select({ n: count() }).from(C).where(where)) as [{ n: number }];
    const order = orderBySort(q.sort, { code: C.code, counterparty: C.counterparty, status: C.status, dueDate: C.dueDate, updatedAt: C.updatedAt }, C.id, [asc(C.code), asc(C.id)]);
    const rows = await this.tx.select().from(C).where(where).orderBy(...order).limit(q.pageSize).offset(offsetOf(q));
    return pageOf(await this.consentDtos(projectId, rows, this.s.today(p)), Number(n), q);
  }

  private async loadConsent(ctx: RequestContext, p: CarveoutProject, id: string): Promise<Consent> {
    const c = await loadInProject(this.s.db, C, p.id, id);
    this.s.assertProjectWide(ctx, READ, p.id);
    this.s.assertRead(ctx, READ, { projectId: p.id, classification: c.classification as Classification });
    return c;
  }

  private assertConsentManage(ctx: RequestContext, p: CarveoutProject, classification: Classification, ownerUserIds: (string | null)[] = []) {
    this.s.assertProjectWide(ctx, 'carveout.consent.manage', p.id);
    this.s.policy.assert(ctx, 'carveout.consent.manage', { projectId: p.id, classification, ownerUserIds });
  }

  async createConsent(ctx: RequestContext, projectId: string, body: z.infer<typeof CreateConsentBody>) {
    const p = await this.s.project(ctx, projectId);
    const classification = body.classification ?? 'confidential';
    this.s.assertClassificationAllowed(ctx, classification);
    this.assertConsentManage(ctx, p, classification, [ctx.principal.userId]);
    if (body.perimeterItemId) await this.perimeter.loadReadable(ctx, p, body.perimeterItemId);
    if (body.agreementId) await this.loadAgreement(ctx, p, body.agreementId);
    if (body.ownerUserId) await this.s.assertMember(projectId, body.ownerUserId, 'owner');
    const code = await nextCode(this.s.db, C, projectId, 'CNS');
    const id = newId();
    await this.tx.insert(C).values({
      id,
      orgId: p.orgId,
      projectId,
      code,
      perimeterItemId: body.perimeterItemId ?? null,
      agreementId: body.agreementId ?? null,
      kind: body.kind,
      counterparty: body.counterparty,
      contractRef: body.contractRef ?? null,
      ownerUserId: body.ownerUserId ?? null,
      dueDate: body.dueDate ?? null,
      classification,
      isDemo: p.isDemo,
      createdBy: ctx.principal.userId,
    });
    await this.audit.record({ action: 'carveout.consent.create', entityType: 'consent', entityId: id, projectId, after: { code, kind: body.kind, perimeterItemId: body.perimeterItemId ?? null, agreementId: body.agreementId ?? null } });
    if (body.perimeterItemId) await this.outbox.emit({ type: 'perimeter.changed', projectId, aggregateType: 'perimeter_item', aggregateId: body.perimeterItemId, payload: { change: 'consent_created', consentId: id } });
    return { id, code, version: 1 };
  }

  async updateConsent(ctx: RequestContext, projectId: string, consentId: string, body: z.infer<typeof UpdateConsentBody>) {
    const p = await this.s.project(ctx, projectId);
    const c = await this.loadConsent(ctx, p, consentId);
    this.assertConsentManage(ctx, p, c.classification as Classification, [c.ownerUserId, c.createdBy]);
    assertVersion(c, body.expectedVersion, 'consent');
    const u: Partial<typeof schema.consent.$inferInsert> = {};
    if (body.counterparty !== undefined) u.counterparty = body.counterparty;
    if (body.contractRef !== undefined) u.contractRef = body.contractRef;
    if (body.ownerUserId !== undefined) {
      if (body.ownerUserId) await this.s.assertMember(projectId, body.ownerUserId, 'owner');
      u.ownerUserId = body.ownerUserId;
    }
    if (body.dueDate !== undefined) u.dueDate = body.dueDate;
    if (body.validTo !== undefined) u.validTo = body.validTo;
    if (body.classification !== undefined) {
      this.s.assertClassificationAllowed(ctx, body.classification);
      u.classification = body.classification;
    }
    if (Object.keys(u).length === 0) throw invalid('carveout.no_changes', 'No changes supplied');
    const row = await updateVersioned(this.s.db, C, { id: consentId, projectId, expectedVersion: body.expectedVersion }, u);
    await this.audit.record({ action: 'carveout.consent.update', entityType: 'consent', entityId: consentId, projectId, before: pick(c, Object.keys(u)), after: u as Record<string, unknown> });
    return { id: consentId, version: row['version'] as number };
  }

  async recordResponse(ctx: RequestContext, projectId: string, consentId: string, body: z.infer<typeof RecordConsentResponseBody>) {
    const p = await this.s.project(ctx, projectId);
    const c = await this.loadConsent(ctx, p, consentId);
    this.assertConsentManage(ctx, p, c.classification as Classification, [c.ownerUserId, c.createdBy]);
    // "Not required" is a legal determination: only a transferability specialist may record it.
    if (body.status === 'not_required') this.s.policy.assert(ctx, 'carveout.contract.classify', { projectId, classification: c.classification as Classification });
    assertVersion(c, body.expectedVersion, 'consent');
    let documentId: string | null = null;
    if (body.documentId) {
      const doc = await loadInProject(this.s.db, schema.document, projectId, body.documentId);
      if (!this.s.policy.canSee(ctx, { projectId, classification: doc.classification as Classification, roomId: doc.roomId })) throw notFound();
      documentId = doc.id;
    }
    const to = assertConsentResponse({ from: c.status as ConsentStatus, to: body.status, date: body.date, evidenceNote: body.evidenceNote ?? null, hasDocument: !!documentId, conditions: body.conditions ?? null, today: this.s.today(p) });
    const u: Partial<typeof schema.consent.$inferInsert> = { status: to };
    if (to === 'requested') u.requestedOn = body.date;
    else {
      Object.assign(u, { respondedOn: body.date, responseEvidenceNote: body.evidenceNote ?? null, responseDocumentId: documentId, responseRecordedBy: ctx.principal.userId, responseRecordedAt: new Date() });
      if (body.conditions !== undefined) u.conditions = body.conditions;
    }
    const row = await updateVersioned(this.s.db, C, { id: consentId, projectId, expectedVersion: body.expectedVersion }, u);
    await this.versions.snapshot({ projectId, entityType: 'consent', entityId: consentId, versionNo: row['version'] as number, snapshot: row, reason: `${c.status} → ${to}` });
    await this.audit.record({ action: `carveout.consent.${to === 'requested' ? 'request' : 'record_response'}`, entityType: 'consent', entityId: consentId, projectId, before: { status: c.status }, after: { status: to, date: body.date, documentId }, reason: body.note ?? null });
    if (c.perimeterItemId) await this.outbox.emit({ type: 'perimeter.changed', projectId, aggregateType: 'perimeter_item', aggregateId: c.perimeterItemId, payload: { change: 'consent', consentId, status: to } });
    return { id: consentId, status: to, version: row['version'] as number };
  }
}

void desc;
