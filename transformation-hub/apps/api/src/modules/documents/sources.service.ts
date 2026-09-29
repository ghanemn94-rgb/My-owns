import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, ilike, or, sql, SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { schema } from '@hub/db';
import {
  CLAIM_TARGET_PERMISSION,
  ClaimTargetType,
  Classification,
  VerificationStatus,
  assertClaimReview,
  assertClaimTargetField,
  claimApplicability,
  clearanceAllows,
  conflict,
  notFound,
  ruleViolation,
} from '@hub/domain';
import { DbService } from '../../platform/db.service';
import { PolicyService } from '../../platform/policy.service';
import { AuditService } from '../../platform/audit.service';
import { OutboxService } from '../../platform/outbox.service';
import type { RequestContext } from '../../platform/context';
import { newId, payloadHash } from '../../platform/ids';
import { assertVersion, likeContains, loadInProject, nextCode, offsetOf, pageOf, updateVersioned } from '../../platform/helpers';
import { DocumentsService } from './documents.service';

type SourceRow = typeof schema.sourceRecord.$inferSelect;
type ClaimRow = typeof schema.sourceClaim.$inferSelect;

/** Read-only map of comparable record fields (static allowlist — identifiers never come from request data). */
const CLAIM_TARGETS: Record<ClaimTargetType, { table: PgTable & { id: PgColumn; projectId: PgColumn }; fields: Record<string, PgColumn>; readPermission: string }> = {
  project: { table: schema.project as unknown as PgTable & { id: PgColumn; projectId: PgColumn }, fields: { status: schema.project.status, name: schema.project.name, plannedStart: schema.project.plannedStart }, readPermission: 'portfolio.project.read' },
  workstream: { table: schema.workstream, fields: { name: schema.workstream.name, objective: schema.workstream.objective }, readPermission: 'planning.plan.read' },
  task: {
    table: schema.task,
    fields: { status: schema.task.status, plannedStart: schema.task.plannedStart, plannedFinish: schema.task.plannedFinish, actualFinish: schema.task.actualFinish, reportedProgress: schema.task.reportedProgress },
    readPermission: 'planning.plan.read',
  },
  milestone: { table: schema.milestone, fields: { status: schema.milestone.status, plannedDate: schema.milestone.plannedDate, actualDate: schema.milestone.actualDate }, readPermission: 'planning.plan.read' },
  deliverable: { table: schema.deliverable, fields: { status: schema.deliverable.status, dueDate: schema.deliverable.dueDate }, readPermission: 'planning.plan.read' },
};

const APPLY_ACTION = 'documents.claim.apply';

@Injectable()
export class SourcesService {
  constructor(
    private readonly db: DbService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly docs: DocumentsService,
  ) {}

  // ------------------------------------------------------------------------------------------------ helpers
  private async loadSource(ctx: RequestContext, projectId: string, sourceId: string, permission = 'documents.document.read'): Promise<SourceRow> {
    const s = await loadInProject(this.db, schema.sourceRecord, projectId, sourceId);
    this.policy.assert(ctx, permission, { projectId, classification: s.classification as Classification });
    return s;
  }

  private async loadClaim(ctx: RequestContext, projectId: string, claimId: string, permission: string, requesterUserId?: string) {
    const c = await loadInProject(this.db, schema.sourceClaim, projectId, claimId);
    const s = await loadInProject(this.db, schema.sourceRecord, projectId, c.sourceId);
    this.policy.assert(ctx, permission, { projectId, classification: s.classification as Classification, requesterUserId: requesterUserId ?? null });
    return { claim: c, source: s };
  }

  /** Validate a claim target is a record of this project (404 otherwise). */
  private async assertClaimTarget(projectId: string, targetType: ClaimTargetType, targetId: string) {
    if (targetType === 'project') {
      if (targetId !== projectId) throw notFound();
      return;
    }
    await loadInProject(this.db, CLAIM_TARGETS[targetType].table, projectId, targetId);
  }

  /** Current value of an allowlisted record field — or null when the caller may not read that record type. */
  private async currentValue(ctx: RequestContext, projectId: string, targetType: string | null, targetId: string | null, field: string | null): Promise<{ value: string | null; visible: boolean }> {
    if (!targetType || !targetId || !field) return { value: null, visible: true };
    const t = CLAIM_TARGETS[targetType as ClaimTargetType];
    const col = t?.fields[field];
    if (!t || !col) return { value: null, visible: true };
    if (!this.policy.canInProject(ctx, t.readPermission, projectId)) return { value: null, visible: false };
    const idCol = targetType === 'project' ? schema.project.id : t.table.id;
    const where: SQL = targetType === 'project' ? eq(schema.project.id, projectId) : and(eq(t.table.id, targetId), eq(t.table.projectId, projectId))!;
    const rows = await this.db.tx().select({ v: col, id: idCol }).from(t.table).where(where);
    const v = rows[0]?.v;
    return { value: v === null || v === undefined ? null : String(v), visible: true };
  }

  private async pendingProposals(projectId: string, claimIds: string[]): Promise<Map<string, string>> {
    if (claimIds.length === 0) return new Map();
    const rows = await this.db.tx().execute<{ id: string; claim_id: string }>(sql`
      select id, payload->>'claimId' as claim_id from approval_request
       where project_id = ${projectId} and action = ${APPLY_ACTION} and status = 'pending'
         and payload->>'claimId' in (${sql.join(claimIds.map((c) => sql`${c}`), sql`, `)})`);
    return new Map(rows.rows.map((r) => [r.claim_id, r.id]));
  }

  private claimDto(c: ClaimRow, pending: Map<string, string>) {
    return {
      id: c.id,
      sourceId: c.sourceId,
      location: c.location,
      subject: c.subject,
      targetType: c.targetType,
      targetId: c.targetId,
      field: c.field,
      extractedValue: c.extractedValue,
      sourceReportedValue: c.sourceReportedValue,
      confirmedValue: c.confirmedValue,
      confidence: c.confidence,
      verificationStatus: c.verificationStatus,
      reviewerUserId: c.reviewerUserId,
      reviewedAt: c.reviewedAt?.toISOString() ?? null,
      conflictWithClaimId: c.conflictWithClaimId,
      appliedToRecord: c.appliedToRecord,
      pendingProposalId: pending.get(c.id) ?? null,
      isDemo: c.isDemo,
      createdAt: c.createdAt.toISOString(),
      createdBy: c.createdBy,
      version: c.version,
    };
  }

  private sourceDto(s: SourceRow, claimCount: number, supersededBy: string | null) {
    return {
      id: s.id,
      code: s.code,
      sourceType: s.sourceType,
      filename: s.filename,
      sourceVersion: s.sourceVersion,
      checksum: s.checksum,
      ownerLabel: s.ownerLabel,
      uploadedAt: s.uploadedAt?.toISOString() ?? null,
      reportDate: s.reportDate,
      asOfDate: s.asOfDate,
      extractionDate: s.extractionDate,
      extractionStatus: s.extractionStatus,
      extractionNote: s.extractionNote,
      documentVersionId: s.documentVersionId,
      supersedesSourceId: s.supersedesSourceId,
      supersededBySourceId: supersededBy,
      classification: s.classification,
      isDemo: s.isDemo,
      claimCount,
      createdAt: s.createdAt.toISOString(),
      version: s.version,
    };
  }

  // ------------------------------------------------------------------------------------------------ sources
  async list(ctx: RequestContext, projectId: string, q: { page: number; pageSize: number; q?: string }) {
    const s = schema.sourceRecord;
    const where = and(
      eq(s.projectId, projectId),
      this.policy.visibilitySql(ctx, projectId, { classification: s.classification }),
      q.q ? or(ilike(s.code, likeContains(q.q)), ilike(s.filename, likeContains(q.q))) : undefined,
    );
    const tx = this.db.tx();
    const [{ total }] = (await tx.select({ total: count() }).from(s).where(where)) as [{ total: number }];
    const rows = await tx
      .select({
        s,
        // Fully qualified outer reference (drizzle renders single-table columns unqualified inside sql fields).
        claims: sql<number>`(select count(*)::int from source_claim c where c.source_id = "source_record"."id")`,
        supersededBy: sql<string | null>`(select n.id from source_record n where n.supersedes_source_id = "source_record"."id" limit 1)`,
      })
      .from(s)
      .where(where)
      .orderBy(asc(s.code))
      .limit(q.pageSize)
      .offset(offsetOf(q));
    return pageOf(
      rows.map((r) => this.sourceDto(r.s, Number(r.claims), r.supersededBy)),
      Number(total),
      q,
    );
  }

  async get(ctx: RequestContext, projectId: string, sourceId: string) {
    const s = await this.loadSource(ctx, projectId, sourceId);
    const claims = await this.db.tx().select().from(schema.sourceClaim).where(and(eq(schema.sourceClaim.projectId, projectId), eq(schema.sourceClaim.sourceId, sourceId))).orderBy(asc(schema.sourceClaim.createdAt));
    const [next] = await this.db.tx().select({ id: schema.sourceRecord.id }).from(schema.sourceRecord).where(and(eq(schema.sourceRecord.projectId, projectId), eq(schema.sourceRecord.supersedesSourceId, sourceId))).limit(1);
    const pending = await this.pendingProposals(projectId, claims.map((c) => c.id));
    return { ...this.sourceDto(s, claims.length, next?.id ?? null), claims: claims.map((c) => this.claimDto(c, pending)) };
  }

  async create(
    ctx: RequestContext,
    projectId: string,
    body: {
      sourceType: SourceRow['sourceType'];
      filename?: string;
      sourceVersion?: string;
      checksum?: string;
      ownerLabel?: string;
      uploadedAt?: string;
      reportDate?: string;
      asOfDate?: string;
      extractionDate?: string;
      extractionStatus: SourceRow['extractionStatus'];
      extractionNote?: string;
      documentVersionId?: string;
      supersedesSourceId?: string;
      classification: Classification;
    },
  ) {
    if (!clearanceAllows(ctx.principal.clearance, body.classification)) throw ruleViolation('sources.classification_above_clearance', 'The source classification cannot exceed your clearance');
    this.policy.assert(ctx, 'documents.source.manage', { projectId, classification: body.classification });
    let filename = body.filename ?? null;
    let checksum = body.checksum ?? null;
    let uploadedAt = body.uploadedAt ? new Date(body.uploadedAt) : null;
    if (body.documentVersionId) {
      // File identity comes from the stored version — never from the request.
      const v = await loadInProject(this.db, schema.documentVersion, projectId, body.documentVersionId);
      await this.docs.loadVisibleDoc(ctx, projectId, v.documentId);
      if (checksum && checksum !== v.sha256) throw ruleViolation('sources.checksum_mismatch', 'The checksum does not match the linked document version');
      checksum = v.sha256;
      filename = v.filename;
      uploadedAt = v.uploadedAt;
    }
    if (body.supersedesSourceId) {
      await this.loadSource(ctx, projectId, body.supersedesSourceId);
      const [already] = await this.db.tx().select({ id: schema.sourceRecord.id }).from(schema.sourceRecord).where(and(eq(schema.sourceRecord.projectId, projectId), eq(schema.sourceRecord.supersedesSourceId, body.supersedesSourceId)));
      if (already) throw conflict('sources.already_superseded', 'That source was already superseded by a newer source');
    }
    const [p] = await this.db.tx().select({ isDemo: schema.project.isDemo }).from(schema.project).where(eq(schema.project.id, projectId));
    const id = newId();
    const code = await nextCode(this.db, schema.sourceRecord, projectId, 'SRC');
    await this.db
      .tx()
      .insert(schema.sourceRecord)
      .values({
        id,
        orgId: ctx.principal.orgId,
        projectId,
        code,
        sourceType: body.sourceType,
        filename,
        sourceVersion: body.sourceVersion ?? null,
        checksum,
        ownerLabel: body.ownerLabel ?? null,
        uploadedAt,
        reportDate: body.reportDate ?? null,
        asOfDate: body.asOfDate ?? null,
        extractionDate: body.extractionDate ?? null,
        extractionStatus: body.extractionStatus,
        extractionNote: body.extractionNote ?? null,
        documentVersionId: body.documentVersionId ?? null,
        supersedesSourceId: body.supersedesSourceId ?? null,
        classification: body.classification,
        isDemo: p?.isDemo ?? false,
        createdBy: ctx.principal.userId,
      });
    await this.audit.record({ action: 'documents.source.create', entityType: 'source_record', entityId: id, projectId, after: { code, sourceType: body.sourceType, filename, checksum, extractionStatus: body.extractionStatus, supersedesSourceId: body.supersedesSourceId ?? null } });
    await this.outbox.emit({ type: 'source.updated', projectId, aggregateType: 'source_record', aggregateId: id, payload: { sourceId: id, change: 'created', supersedesSourceId: body.supersedesSourceId ?? null } });
    return { id, code };
  }

  async update(ctx: RequestContext, projectId: string, sourceId: string, body: { expectedVersion: number; filename?: string | null; sourceVersion?: string | null; ownerLabel?: string | null; reportDate?: string | null; asOfDate?: string | null }) {
    const s = await this.loadSource(ctx, projectId, sourceId, 'documents.source.manage');
    const { expectedVersion, ...changes } = body;
    if (s.documentVersionId && changes.filename !== undefined) throw ruleViolation('sources.file_identity_locked', 'The filename of a source linked to a stored version cannot be edited');
    const row = await updateVersioned(this.db, schema.sourceRecord, { id: sourceId, projectId, expectedVersion }, changes);
    const before = Object.fromEntries(Object.keys(changes).map((k) => [k, (s as Record<string, unknown>)[k]]));
    await this.audit.record({ action: 'documents.source.update', entityType: 'source_record', entityId: sourceId, projectId, before, after: changes });
    return { id: sourceId, version: row['version'] as number };
  }

  async recordExtraction(ctx: RequestContext, projectId: string, sourceId: string, body: { expectedVersion: number; extractionStatus: SourceRow['extractionStatus']; extractionDate: string | null; extractionNote?: string }) {
    const s = await this.loadSource(ctx, projectId, sourceId, 'documents.source.manage');
    const row = await updateVersioned(this.db, schema.sourceRecord, { id: sourceId, projectId, expectedVersion: body.expectedVersion }, { extractionStatus: body.extractionStatus, extractionDate: body.extractionDate, extractionNote: body.extractionNote ?? s.extractionNote });
    await this.audit.record({ action: 'documents.source.record_extraction', entityType: 'source_record', entityId: sourceId, projectId, before: { extractionStatus: s.extractionStatus, extractionDate: s.extractionDate }, after: { extractionStatus: body.extractionStatus, extractionDate: body.extractionDate } });
    await this.outbox.emit({ type: 'source.updated', projectId, aggregateType: 'source_record', aggregateId: sourceId, payload: { sourceId, change: 'extraction' } });
    return { id: sourceId, version: row['version'] as number };
  }

  /** Claims vs. current record values vs. the previous (superseded) source — read-only proposed changes. */
  async compare(ctx: RequestContext, projectId: string, sourceId: string) {
    const s = await this.loadSource(ctx, projectId, sourceId);
    const tx = this.db.tx();
    const claims = await tx.select().from(schema.sourceClaim).where(and(eq(schema.sourceClaim.projectId, projectId), eq(schema.sourceClaim.sourceId, sourceId))).orderBy(asc(schema.sourceClaim.createdAt));
    let previous: ClaimRow[] = [];
    if (s.supersedesSourceId) {
      const prev = await loadInProject(this.db, schema.sourceRecord, projectId, s.supersedesSourceId);
      if (this.policy.canSee(ctx, { projectId, classification: prev.classification as Classification })) {
        previous = await tx.select().from(schema.sourceClaim).where(and(eq(schema.sourceClaim.projectId, projectId), eq(schema.sourceClaim.sourceId, prev.id)));
      }
    }
    const pending = await this.pendingProposals(projectId, claims.map((c) => c.id));
    const rows = [];
    for (const c of claims) {
      const cur = await this.currentValue(ctx, projectId, c.targetType, c.targetId, c.field);
      const claimValue = c.confirmedValue ?? c.extractedValue;
      // Same record field in the previous source; otherwise the same subject line.
      const prev =
        (c.targetId ? previous.find((p) => p.targetType === c.targetType && p.targetId === c.targetId && p.field === c.field) : undefined) ??
        previous.find((p) => p.subject.trim().toLowerCase() === c.subject.trim().toLowerCase());
      const chk = claimApplicability({ verificationStatus: c.verificationStatus as VerificationStatus, targetType: c.targetType, field: c.field, appliedToRecord: c.appliedToRecord, hasPendingProposal: pending.has(c.id) });
      rows.push({
        claimId: c.id,
        subject: c.subject,
        location: c.location,
        targetType: c.targetType,
        targetId: c.targetId,
        field: c.field,
        currentValue: cur.value,
        claimValue,
        sourceReportedValue: c.sourceReportedValue,
        previousSourceValue: prev ? (prev.confirmedValue ?? prev.extractedValue) : null,
        verificationStatus: c.verificationStatus,
        differs: c.targetId && c.field && cur.visible ? (cur.value ?? '').trim() !== claimValue.trim() : null,
        applicable: chk.applicable,
        reason: cur.visible ? chk.reason : `${chk.reason} (current value not shown: you cannot read that record type)`,
      });
    }
    return { sourceId, previousSourceId: s.supersedesSourceId, rows };
  }

  // ------------------------------------------------------------------------------------------------ claims
  async createClaim(
    ctx: RequestContext,
    projectId: string,
    sourceId: string,
    body: { location: string; subject: string; targetType?: string; targetId?: string; field?: string; extractedValue: string; sourceReportedValue?: string; confidence?: string; verificationStatus: VerificationStatus },
  ) {
    const s = await this.loadSource(ctx, projectId, sourceId, 'documents.source.manage');
    assertClaimTargetField(body.targetType ?? null, body.field ?? null);
    if (!!body.targetType !== !!body.targetId) throw ruleViolation('claims.target_incomplete', 'A claim target needs both a record type and a record id');
    if (body.targetType && body.targetId) await this.assertClaimTarget(projectId, body.targetType as ClaimTargetType, body.targetId);
    const id = newId();
    await this.db
      .tx()
      .insert(schema.sourceClaim)
      .values({
        id,
        orgId: ctx.principal.orgId,
        projectId,
        sourceId,
        location: body.location,
        subject: body.subject,
        targetType: body.targetType ?? null,
        targetId: body.targetId ?? null,
        field: body.field ?? null,
        extractedValue: body.extractedValue,
        sourceReportedValue: body.sourceReportedValue ?? null,
        confidence: body.confidence ?? null,
        verificationStatus: body.verificationStatus,
        isDemo: s.isDemo,
        createdBy: ctx.principal.userId,
      });
    await this.audit.record({ action: 'documents.claim.create', entityType: 'source_claim', entityId: id, projectId, after: { sourceId, subject: body.subject, targetType: body.targetType ?? null, targetId: body.targetId ?? null, field: body.field ?? null, verificationStatus: body.verificationStatus } });
    await this.outbox.emit({ type: 'source.updated', projectId, aggregateType: 'source_record', aggregateId: sourceId, payload: { sourceId, claimId: id, change: 'claim_added' } });
    return { id };
  }

  /** Descriptive corrections only; what the source said (extracted / source-reported values) is never rewritten. */
  async updateClaim(
    ctx: RequestContext,
    projectId: string,
    claimId: string,
    body: { expectedVersion: number; location?: string; subject?: string; targetType?: string | null; targetId?: string | null; field?: string | null; confidence?: string | null },
  ) {
    const { claim } = await this.loadClaim(ctx, projectId, claimId, 'documents.source.manage');
    if (claim.verificationStatus === 'confirmed' || claim.appliedToRecord) {
      throw ruleViolation('claims.locked_after_confirmation', 'A confirmed claim cannot be edited — record a new claim instead');
    }
    const { expectedVersion, ...changes } = body;
    const targetType = changes.targetType !== undefined ? changes.targetType : claim.targetType;
    const targetId = changes.targetId !== undefined ? changes.targetId : claim.targetId;
    const field = changes.field !== undefined ? changes.field : claim.field;
    assertClaimTargetField(targetType, field);
    if (!!targetType !== !!targetId) throw ruleViolation('claims.target_incomplete', 'A claim target needs both a record type and a record id');
    if (targetType && targetId) await this.assertClaimTarget(projectId, targetType as ClaimTargetType, targetId);
    const row = await updateVersioned(this.db, schema.sourceClaim, { id: claimId, projectId, expectedVersion }, changes);
    const before = Object.fromEntries(Object.keys(changes).map((k) => [k, (claim as Record<string, unknown>)[k]]));
    await this.audit.record({ action: 'documents.claim.update', entityType: 'source_claim', entityId: claimId, projectId, before, after: changes });
    return { id: claimId, version: row['version'] as number };
  }

  async reviewClaim(ctx: RequestContext, projectId: string, claimId: string, body: { expectedVersion: number; verificationStatus: VerificationStatus; confirmedValue?: string; conflictWithClaimId?: string; note?: string }) {
    const c0 = await loadInProject(this.db, schema.sourceClaim, projectId, claimId);
    const { claim } = await this.loadClaim(ctx, projectId, claimId, 'documents.claim.verify', c0.createdBy ?? undefined);
    assertVersion(claim, body.expectedVersion, 'claim');
    assertClaimReview(claim.verificationStatus as VerificationStatus, body.verificationStatus, body.confirmedValue);
    if (body.conflictWithClaimId) {
      if (body.conflictWithClaimId === claimId) throw ruleViolation('claims.conflict_with_self', 'A claim cannot conflict with itself');
      await this.loadClaim(ctx, projectId, body.conflictWithClaimId, 'documents.document.read');
    }
    const values = {
      verificationStatus: body.verificationStatus,
      confirmedValue: body.verificationStatus === 'confirmed' ? body.confirmedValue!.trim() : null,
      reviewerUserId: ctx.principal.userId,
      reviewedAt: new Date(),
      conflictWithClaimId: body.verificationStatus === 'conflicting' ? (body.conflictWithClaimId ?? claim.conflictWithClaimId) : claim.conflictWithClaimId,
    };
    const row = await updateVersioned(this.db, schema.sourceClaim, { id: claimId, projectId, expectedVersion: body.expectedVersion }, values);
    await this.audit.record({
      action: 'documents.claim.review',
      entityType: 'source_claim',
      entityId: claimId,
      projectId,
      before: { verificationStatus: claim.verificationStatus, confirmedValue: claim.confirmedValue },
      after: { verificationStatus: values.verificationStatus, confirmedValue: values.confirmedValue, conflictWithClaimId: values.conflictWithClaimId },
      reason: body.note ?? null,
    });
    await this.outbox.emit({ type: 'source.updated', projectId, aggregateType: 'source_record', aggregateId: claim.sourceId, payload: { sourceId: claim.sourceId, claimId, change: 'claim_reviewed', verificationStatus: values.verificationStatus } });
    return { id: claimId, verificationStatus: values.verificationStatus, version: row['version'] as number };
  }

  /**
   * "Apply" a claim = create a PROPOSED change (approval_request) for the record owner. The target record is NOT
   * modified here; historical-unverified and unconfirmed claims are refused and the refusal is audited (AT-01).
   */
  async proposeChange(ctx: RequestContext, projectId: string, claimId: string, body: { expectedVersion: number; note?: string }) {
    const { claim } = await this.loadClaim(ctx, projectId, claimId, 'documents.source.manage');
    assertVersion(claim, body.expectedVersion, 'claim');
    const pending = await this.pendingProposals(projectId, [claimId]);
    const chk = claimApplicability({ verificationStatus: claim.verificationStatus as VerificationStatus, targetType: claim.targetType, field: claim.field, appliedToRecord: claim.appliedToRecord, hasPendingProposal: pending.has(claimId) });
    if (!chk.applicable) {
      await this.audit.recordDetached(ctx, { action: 'documents.claim.propose_change', entityType: 'source_claim', entityId: claimId, projectId, outcome: 'rejected', reason: `${chk.code}: ${chk.reason}` });
      throw ruleViolation(chk.code, chk.reason);
    }
    const targetType = claim.targetType as ClaimTargetType;
    const targetId = claim.targetId!;
    const field = claim.field!;
    const cur = await this.currentValue(ctx, projectId, targetType, targetId, field);
    const proposedValue = claim.confirmedValue ?? claim.extractedValue;
    const requiredPermission = CLAIM_TARGET_PERMISSION[targetType];
    const payload = { claimId, sourceId: claim.sourceId, targetType, targetId, field, currentValue: cur.value, proposedValue };
    const id = newId();
    await this.db
      .tx()
      .insert(schema.approvalRequest)
      .values({
        id,
        orgId: ctx.principal.orgId,
        projectId,
        subjectType: targetType,
        subjectId: targetId,
        action: APPLY_ACTION,
        payload,
        payloadHash: payloadHash(payload),
        requiredPermission,
        requestedBy: ctx.principal.userId!,
        note: body.note ?? null,
      });
    await this.audit.record({ action: 'documents.claim.propose_change', entityType: 'source_claim', entityId: claimId, projectId, after: { approvalRequestId: id, targetType, targetId, field, proposedValue }, reason: body.note ?? null });
    await this.outbox.emit({ type: 'approval.pending', projectId, aggregateType: 'approval_request', aggregateId: id, payload: { approvalRequestId: id, subjectType: targetType, subjectId: targetId, requiredPermission } });
    return {
      proposalId: id,
      claimId,
      targetType,
      targetId,
      field,
      currentValue: cur.value,
      proposedValue,
      status: 'pending' as const,
      requiredPermission,
      message: 'No record was changed. The proposed change awaits review by the record owner under change control.',
    };
  }
}
