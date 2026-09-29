import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { schema } from '@hub/db';
import {
  Classification,
  EVIDENCE_TARGET_PERMISSION,
  EvidenceTargetType,
  EvidenceLinkStatus,
  assertConflictMarkable,
  verifiedStatusAfterAccept,
  forbidden,
  notFound,
  ruleViolation,
} from '@hub/domain';
import { DbService } from '../../platform/db.service';
import { PolicyService } from '../../platform/policy.service';
import { AuditService } from '../../platform/audit.service';
import { OutboxService } from '../../platform/outbox.service';
import type { RequestContext } from '../../platform/context';
import { newId } from '../../platform/ids';
import { assertVersion, loadInProject, updateVersioned } from '../../platform/helpers';
import { DocumentsService, LoadedDoc, UNUSABLE_SCAN_STATUSES } from './documents.service';

type LinkRow = typeof schema.evidenceLink.$inferSelect;

/**
 * Evidence target type → table (must agree with `hub_target_table()` in post-migrate.sql, which re-checks the
 * same-project rule on insert). `transfer` targets are perimeter items (transfer status lives on the item).
 */
const TARGET_TABLES: Record<Exclude<EvidenceTargetType, 'legal_entity'>, PgTable & { id: PgColumn; projectId: PgColumn }> = {
  gate_criterion: schema.gateCriterion,
  closing_condition: schema.closingCondition,
  perimeter_item: schema.perimeterItem,
  transfer: schema.perimeterItem,
  readiness_check: schema.readinessCheck,
  tsa_service: schema.tsaService,
  decision: schema.decision,
  action_item: schema.actionItem,
  task: schema.task,
  deliverable: schema.deliverable,
  milestone: schema.milestone,
  regulatory_requirement: schema.regulatoryRequirement,
  agreement: schema.agreement,
  benefit: schema.benefit,
  financial_snapshot: schema.financialSnapshot,
  post_close_obligation: schema.postCloseObligation,
  closing_deliverable: schema.closingDeliverable,
};

@Injectable()
export class EvidenceService {
  constructor(
    private readonly db: DbService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly docs: DocumentsService,
  ) {}

  /** The target must be a record of the same project that the caller can see (404 otherwise — never trust the id). */
  async loadTarget(ctx: RequestContext, projectId: string, targetType: EvidenceTargetType, targetId: string): Promise<void> {
    if (targetType === 'legal_entity') {
      const [pe] = await this.db
        .tx()
        .select({ id: schema.projectEntity.id })
        .from(schema.projectEntity)
        .where(and(eq(schema.projectEntity.projectId, projectId), eq(schema.projectEntity.legalEntityId, targetId)));
      if (!pe) throw notFound();
      return;
    }
    const table = TARGET_TABLES[targetType];
    if (!table) throw notFound();
    const row = (await loadInProject(this.db, table, projectId, targetId)) as Record<string, unknown>;
    const classification = (row['classification'] as Classification | undefined) ?? null;
    if (classification && !this.policy.canSee(ctx, { projectId, classification })) throw notFound();
  }

  private emitChanged(projectId: string, link: Pick<LinkRow, 'id' | 'targetType' | 'targetId'>, change: string, isConflict: boolean) {
    return this.outbox.emit({
      type: 'evidence.changed',
      projectId,
      aggregateType: link.targetType,
      aggregateId: link.targetId,
      payload: { targetType: link.targetType, targetId: link.targetId, linkId: link.id, change, conflict: isConflict },
    });
  }

  /** Visible document of a link (404 when the caller cannot read it — links to hidden documents are hidden too). */
  private async linkDoc(ctx: RequestContext, link: LinkRow, permission: string): Promise<LoadedDoc | null> {
    if (!link.documentId) return null;
    const l = await this.docs.loadDoc(link.projectId, link.documentId);
    this.policy.assert(ctx, permission, this.docs.attrs(l));
    return l;
  }

  private async loadLink(projectId: string, linkId: string) {
    return loadInProject(this.db, schema.evidenceLink, projectId, linkId);
  }

  // ------------------------------------------------------------------------------------------------ reads
  async listForTarget(ctx: RequestContext, projectId: string, q: { targetType: EvidenceTargetType; targetId: string; includeInactive: 'true' | 'false' }) {
    await this.loadTarget(ctx, projectId, q.targetType, q.targetId);
    const e = schema.evidenceLink;
    const d = schema.document;
    const conds = [
      eq(e.projectId, projectId),
      eq(e.targetType, q.targetType),
      eq(e.targetId, q.targetId),
      // Links to documents the caller cannot read are omitted entirely (no title, no count — AT-03).
      or(isNull(e.documentId), this.policy.visibilitySql(ctx, projectId, { classification: d.classification, room: d.roomId })),
    ];
    if (q.includeInactive === 'false') conds.push(inArray(e.status, ['active', 'conflicting']));
    const rows = await this.db
      .tx()
      .select({ e, title: d.title, versionNo: schema.documentVersion.versionNo })
      .from(e)
      .leftJoin(d, and(eq(d.id, e.documentId), eq(d.projectId, e.projectId)))
      .leftJoin(schema.documentVersion, and(eq(schema.documentVersion.id, e.documentVersionId), eq(schema.documentVersion.projectId, e.projectId)))
      .where(and(...conds))
      .orderBy(desc(e.createdAt));
    const items = rows.map(({ e: l, title, versionNo }) => ({
      id: l.id,
      targetType: l.targetType,
      targetId: l.targetId,
      documentId: l.documentId,
      documentVersionId: l.documentVersionId,
      documentTitle: title ?? null,
      versionNo: versionNo ?? null,
      note: l.note,
      purpose: l.purpose,
      status: l.status,
      conflictWithLinkId: l.conflictWithLinkId,
      conflictNote: l.conflictNote,
      reviewedBy: l.reviewedBy,
      reviewedAt: l.reviewedAt?.toISOString() ?? null,
      addedBy: l.addedBy,
      createdAt: l.createdAt.toISOString(),
      version: l.version,
    }));
    return { items, total: items.length };
  }

  // ------------------------------------------------------------------------------------------------ commands
  async link(
    ctx: RequestContext,
    projectId: string,
    body: { targetType: EvidenceTargetType; targetId: string; documentId?: string; documentVersionId?: string; note?: string; purpose?: string; conflictsWithLinkId?: string; conflictNote?: string },
  ) {
    await this.loadTarget(ctx, projectId, body.targetType, body.targetId);
    const targetPerm = EVIDENCE_TARGET_PERMISSION[body.targetType];
    if (!this.policy.canInProject(ctx, targetPerm, projectId)) {
      throw forbidden('evidence.target_permission', `Linking evidence to a ${body.targetType} also requires ${targetPerm}`);
    }
    let documentId: string | null = null;
    let versionId: string | null = null;
    let loaded: LoadedDoc | null = null;
    if (body.documentVersionId || body.documentId) {
      let v: typeof schema.documentVersion.$inferSelect | undefined;
      if (body.documentVersionId) {
        v = await loadInProject(this.db, schema.documentVersion, projectId, body.documentVersionId);
        if (body.documentId && body.documentId !== v.documentId) throw ruleViolation('evidence.version_document_mismatch', 'The version does not belong to the given document');
      }
      documentId = v?.documentId ?? body.documentId!;
      loaded = await this.docs.loadVisibleDoc(ctx, projectId, documentId, 'documents.evidence.link');
      if (!v) {
        if (!loaded.doc.currentVersionId) throw ruleViolation('evidence.no_usable_version', 'The document has no usable version to link');
        v = await loadInProject(this.db, schema.documentVersion, projectId, loaded.doc.currentVersionId);
      }
      if (UNUSABLE_SCAN_STATUSES.has(v.scanStatus)) throw ruleViolation('evidence.version_not_usable', `A ${v.scanStatus} version cannot be used as evidence`);
      versionId = v.id;
    } else {
      this.policy.assert(ctx, 'documents.evidence.link', { projectId });
    }

    let earlier: LinkRow | null = null;
    if (body.conflictsWithLinkId) {
      earlier = await this.loadLink(projectId, body.conflictsWithLinkId);
      await this.linkDoc(ctx, earlier, 'documents.document.read');
      assertConflictMarkable({ id: earlier.id, targetType: earlier.targetType, targetId: earlier.targetId, status: earlier.status as EvidenceLinkStatus }, { id: 'new', targetType: body.targetType, targetId: body.targetId, status: 'active' });
    }
    const id = newId();
    const status: EvidenceLinkStatus = earlier ? 'conflicting' : 'active';
    await this.db
      .tx()
      .insert(schema.evidenceLink)
      .values({
        id,
        orgId: ctx.principal.orgId,
        projectId,
        targetType: body.targetType,
        targetId: body.targetId,
        documentId,
        documentVersionId: versionId,
        note: body.note ?? null,
        purpose: body.purpose ?? null,
        status,
        conflictWithLinkId: earlier?.id ?? null,
        conflictNote: earlier ? (body.conflictNote ?? 'Contradicts evidence previously relied upon') : null,
        addedBy: ctx.principal.userId!,
      });
    await this.audit.record({
      action: 'documents.evidence.link',
      entityType: 'evidence_link',
      entityId: id,
      projectId,
      after: { targetType: body.targetType, targetId: body.targetId, documentId, documentVersionId: versionId, status, conflictWithLinkId: earlier?.id ?? null },
    });
    if (earlier) {
      // AT-14: the earlier link is flagged too (never deleted; its review record is preserved).
      await updateVersioned(this.db, schema.evidenceLink, { id: earlier.id, projectId, expectedVersion: earlier.version }, {
        status: 'conflicting',
        conflictWithLinkId: earlier.conflictWithLinkId ?? id,
        conflictNote: body.conflictNote ?? 'Contradicted by newer evidence',
      });
      await this.audit.record({ action: 'documents.evidence.conflict', entityType: 'evidence_link', entityId: earlier.id, projectId, before: { status: earlier.status }, after: { status: 'conflicting', conflictWithLinkId: id }, reason: body.conflictNote ?? null });
    }
    await this.emitChanged(projectId, { id, targetType: body.targetType, targetId: body.targetId }, earlier ? 'conflict' : 'linked', !!earlier);
    return { id, status };
  }

  async verify(ctx: RequestContext, projectId: string, linkId: string, body: { expectedVersion: number; decision: 'accept' | 'reject'; note?: string }) {
    const link = await this.loadLink(projectId, linkId);
    const l = await this.linkDoc(ctx, link, 'documents.document.read');
    const attrs = l ? this.docs.attrs(l) : { projectId };
    let version: typeof schema.documentVersion.$inferSelect | null = null;
    if (link.documentVersionId) version = await loadInProject(this.db, schema.documentVersion, projectId, link.documentVersionId);
    // Separation of duties: neither the linker nor the uploader of the version may verify it.
    for (const self of new Set([link.addedBy, version?.uploadedBy].filter(Boolean) as string[])) {
      this.policy.assert(ctx, 'documents.evidence.verify', { ...attrs, requesterUserId: self });
    }
    assertVersion(link, body.expectedVersion, 'evidence link');
    let status: EvidenceLinkStatus;
    if (body.decision === 'accept') {
      let counterpart: EvidenceLinkStatus | null = null;
      if (link.conflictWithLinkId) {
        const [c] = await this.db.tx().select({ status: schema.evidenceLink.status }).from(schema.evidenceLink).where(and(eq(schema.evidenceLink.id, link.conflictWithLinkId), eq(schema.evidenceLink.projectId, projectId)));
        counterpart = (c?.status as EvidenceLinkStatus | undefined) ?? null;
      }
      status = verifiedStatusAfterAccept(link.status as EvidenceLinkStatus, counterpart);
      if (version) await this.docs.assertIntegrity(ctx, version, 'evidence verification'); // C-40
    } else {
      if (link.status === 'superseded' || link.status === 'rejected') throw ruleViolation('evidence.not_active', `Evidence link is ${link.status}`);
      status = 'rejected';
    }
    const row = await updateVersioned(this.db, schema.evidenceLink, { id: linkId, projectId, expectedVersion: body.expectedVersion }, { status, reviewedBy: ctx.principal.userId, reviewedAt: new Date() });
    await this.audit.record({
      action: 'documents.evidence.verify',
      entityType: 'evidence_link',
      entityId: linkId,
      projectId,
      before: { status: link.status, reviewedBy: link.reviewedBy },
      after: { status, decision: body.decision, sha256Verified: body.decision === 'accept' && !!version },
      reason: body.note ?? null,
    });
    await this.emitChanged(projectId, link, body.decision === 'accept' ? 'verified' : 'rejected', status === 'conflicting');
    return { id: linkId, status, version: row['version'] as number };
  }

  async flagConflict(ctx: RequestContext, projectId: string, linkId: string, body: { expectedVersion: number; withLinkId: string; note: string }) {
    const a = await this.loadLink(projectId, linkId);
    const b = await this.loadLink(projectId, body.withLinkId);
    const la = await this.linkDoc(ctx, a, 'documents.evidence.link');
    await this.linkDoc(ctx, b, 'documents.document.read');
    if (!la) this.policy.assert(ctx, 'documents.evidence.link', { projectId });
    assertConflictMarkable(
      { id: a.id, targetType: a.targetType, targetId: a.targetId, status: a.status as EvidenceLinkStatus },
      { id: b.id, targetType: b.targetType, targetId: b.targetId, status: b.status as EvidenceLinkStatus },
    );
    const row = await updateVersioned(this.db, schema.evidenceLink, { id: a.id, projectId, expectedVersion: body.expectedVersion }, { status: 'conflicting', conflictWithLinkId: b.id, conflictNote: body.note });
    await updateVersioned(this.db, schema.evidenceLink, { id: b.id, projectId, expectedVersion: b.version }, { status: 'conflicting', conflictWithLinkId: b.conflictWithLinkId ?? a.id, conflictNote: b.conflictNote ?? body.note });
    await this.audit.record({ action: 'documents.evidence.conflict', entityType: 'evidence_link', entityId: a.id, projectId, before: { status: a.status, other: { id: b.id, status: b.status } }, after: { status: 'conflicting', conflictWithLinkId: b.id }, reason: body.note });
    await this.emitChanged(projectId, a, 'conflict', true);
    return { id: a.id, status: 'conflicting' as const, version: row['version'] as number };
  }

  async supersede(ctx: RequestContext, projectId: string, linkId: string, body: { expectedVersion: number; note: string }) {
    const link = await this.loadLink(projectId, linkId);
    const l = await this.linkDoc(ctx, link, 'documents.evidence.link');
    if (!l) this.policy.assert(ctx, 'documents.evidence.link', { projectId });
    if (link.status === 'superseded' || link.status === 'rejected') throw ruleViolation('evidence.not_active', `Evidence link is already ${link.status}`);
    const row = await updateVersioned(this.db, schema.evidenceLink, { id: linkId, projectId, expectedVersion: body.expectedVersion }, { status: 'superseded' });
    await this.audit.record({ action: 'documents.evidence.supersede', entityType: 'evidence_link', entityId: linkId, projectId, before: { status: link.status }, after: { status: 'superseded' }, reason: body.note });
    await this.emitChanged(projectId, link, 'superseded', false);
    return { id: linkId, status: 'superseded' as const, version: row['version'] as number };
  }
}
