import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { schema } from '@hub/db';
import { Classification, DecisionAuthorityOutcome, DecisionStatus, PerimeterDisposition, PerimeterItemType, conflict, gateDecisionIssue, notFound, perimeterVersionFindings, reconcilePerimeterRegister, ruleViolation } from '@hub/domain';
import { AuditService } from '../../platform/audit.service';
import { OutboxService } from '../../platform/outbox.service';
import { RecordVersionService, assertVersion, loadInProject, updateVersioned } from '../../platform/helpers';
import type { RequestContext } from '../../platform/context';
import { newId, payloadHash } from '../../platform/ids';
import { CarveoutProject, CarveoutSupport, iso } from './carveout.support';

const V = schema.perimeterVersion;
type VersionRow = typeof schema.perimeterVersion.$inferSelect;

interface SnapshotItem {
  id: string;
  code: string;
  type: string;
  name: string;
  disposition: string;
  siteId: string | null;
  workstreamId: string | null;
  ownerUserId: string | null;
  targetEntityId: string | null;
}

/** Gate whose scope the perimeter version belongs to (business-gates G1 "Approved perimeter, exclusions"). */
const PERIMETER_GATE = 'G1';

/**
 * Perimeter versions (REQ-SET-012, setup wizard step 4): the PM freezes the register — dispositions, workstreams and
 * owners — as a proposed version; the sponsor (not the proposer) approves it with a FINAL governance decision (authority
 * per the delegation matrix). The approved version becomes the baseline perimeter: later scope changes need a change
 * request (AT-07). Snapshots are never modified; an approval supersedes the previous version.
 */
@Injectable()
export class PerimeterVersionsService {
  constructor(
    private readonly s: CarveoutSupport,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly versions: RecordVersionService,
  ) {}

  private get tx() {
    return this.s.db.tx();
  }

  /** The whole register (the version covers the full perimeter — only project-wide managers can propose it). */
  private async snapshot(projectId: string): Promise<{ items: SnapshotItem[] }> {
    const PI = schema.perimeterItem;
    const rows = await this.tx
      .select({ id: PI.id, code: PI.code, type: PI.type, name: PI.name, disposition: PI.disposition, siteId: PI.siteId, workstreamId: PI.workstreamId, ownerUserId: PI.ownerUserId, targetEntityId: PI.targetEntityId })
      .from(PI)
      .where(eq(PI.projectId, projectId))
      .orderBy(asc(PI.code));
    return { items: rows.map((r) => ({ ...r, type: r.type as string, disposition: r.disposition as string })) };
  }

  private async findings(projectId: string, snap: { items: SnapshotItem[] }) {
    const leads = await this.tx.select({ id: schema.workstream.id, lead: schema.workstream.leadUserId }).from(schema.workstream).where(eq(schema.workstream.projectId, projectId));
    const leadM = new Map(leads.map((l) => [l.id, l.lead]));
    const reviews = await this.tx.select({ c: schema.perimeterCategoryReview.category }).from(schema.perimeterCategoryReview).where(eq(schema.perimeterCategoryReview.projectId, projectId));
    const coverage = reconcilePerimeterRegister({
      items: snap.items.map((i) => ({
        id: i.id,
        code: i.code,
        type: i.type as PerimeterItemType,
        disposition: i.disposition as PerimeterDisposition,
        transferStatus: 'not_started',
        economicTransferStatus: 'not_started',
        transferMechanism: null,
        plannedEffectiveDate: null,
        consentRequired: false,
        consentGranted: false,
        evidenceCount: 0,
        hasInterimArrangement: false,
        ownerUserId: i.ownerUserId,
        resolutionPath: null,
        targetGateKey: null,
        pendingChangeRequest: false,
        day1: null,
      })),
      reviewedCategories: reviews.map((r) => r.c as PerimeterItemType),
    }).categories;
    return perimeterVersionFindings(
      snap.items.map((i) => ({ id: i.id, code: i.code, disposition: i.disposition as PerimeterDisposition, workstreamId: i.workstreamId, ownerUserId: i.ownerUserId, workstreamLeadUserId: i.workstreamId ? (leadM.get(i.workstreamId) ?? null) : null })),
      coverage.filter((c) => c.status === 'unassessed').map((c) => c.category),
    );
  }

  private async dto(projectId: string, rows: VersionRow[]) {
    const names = await this.s.userNames(rows.flatMap((r) => [r.proposedBy, r.decidedBy]));
    return Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        versionNo: r.versionNo,
        status: r.status as 'proposed' | 'approved' | 'rejected' | 'superseded',
        itemCount: r.itemCount,
        snapshotHash: r.snapshotHash,
        note: r.note,
        proposedBy: r.proposedBy,
        proposedByName: names.get(r.proposedBy) ?? null,
        createdAt: r.createdAt.toISOString(),
        decidedBy: r.decidedBy,
        decidedByName: r.decidedBy ? (names.get(r.decidedBy) ?? null) : null,
        decidedAt: iso(r.decidedAt),
        decisionId: r.decisionId,
        decisionNote: r.decisionNote,
        warnings: ((r.snapshot as { warnings?: { code: string; issue: string }[] }).warnings ?? []).map((w) => ({ code: w.code, issue: w.issue })),
        version: r.version,
      })),
    ).then((x) => {
      void projectId;
      return x;
    });
  }

  async list(ctx: RequestContext, projectId: string) {
    const p = await this.s.project(ctx, projectId);
    this.s.assertProjectWide(ctx, 'carveout.register.read', projectId);
    this.s.assertRead(ctx, 'carveout.register.read', { projectId, classification: p.classification });
    const rows = await this.tx.select().from(V).where(eq(V.projectId, projectId)).orderBy(desc(V.versionNo));
    return { items: await this.dto(projectId, rows) };
  }

  /** Setup wizard step 4: propose the current register as a perimeter version (blockers → 422). */
  async propose(ctx: RequestContext, projectId: string, body: { note?: string }) {
    const p = await this.s.project(ctx, projectId);
    this.s.assertProjectWide(ctx, 'carveout.perimeter.manage', projectId);
    this.s.policy.assert(ctx, 'carveout.perimeter.manage', { projectId, classification: p.classification, ownerUserIds: [ctx.principal.userId] });
    const [pending] = await this.tx.select({ id: V.id }).from(V).where(and(eq(V.projectId, projectId), eq(V.status, 'proposed')));
    if (pending) throw conflict('perimeter.version.proposal_pending', 'Another perimeter version awaits a decision — approve or reject it first');
    const snap = await this.snapshot(projectId);
    const f = await this.findings(projectId, snap);
    if (f.blockers.length) throw ruleViolation('perimeter.version.not_ready', `The perimeter cannot be proposed: ${f.blockers.length} blocker(s)`, { blockers: f.blockers, warnings: f.warnings });
    const snapshotHash = payloadHash(snap);
    const [mx] = await this.tx.select({ m: sql<number>`coalesce(max(${V.versionNo}), 0)::int` }).from(V).where(eq(V.projectId, projectId));
    const versionNo = Number(mx?.m ?? 0) + 1;
    const id = newId();
    await this.tx.insert(V).values({
      id,
      orgId: p.orgId,
      projectId,
      versionNo,
      status: 'proposed',
      snapshot: { ...snap, warnings: f.warnings } as unknown as Record<string, unknown>,
      snapshotHash,
      itemCount: snap.items.length,
      note: body.note ?? null,
      proposedBy: ctx.principal.userId!,
      isDemo: p.isDemo,
    });
    await this.audit.record({ action: 'carveout.perimeter.propose_version', entityType: 'perimeter_version', entityId: id, projectId, after: { versionNo, snapshotHash, itemCount: snap.items.length, warnings: f.warnings.length }, reason: body.note ?? null });
    await this.outbox.emit({ type: 'approval.pending', projectId, aggregateType: 'perimeter_version', aggregateId: id, payload: { kind: 'perimeter_version_approval', versionNo } });
    const [row] = await this.tx.select().from(V).where(eq(V.id, id));
    return (await this.dto(projectId, [row!]))[0]!;
  }

  private async lockVersion(p: CarveoutProject, versionId: string): Promise<VersionRow> {
    await loadInProject(this.s.db, V, p.id, versionId);
    const r = await this.tx.execute<{ id: string }>(sql`select id from perimeter_version where id = ${versionId} and project_id = ${p.id} for update`);
    if (!r.rows[0]) throw notFound();
    return loadInProject(this.s.db, V, p.id, versionId);
  }

  /** Approval per authority matrix: sponsor, not the proposer, backed by a final governance decision. */
  async approve(ctx: RequestContext, projectId: string, versionId: string, body: { expectedVersion: number; decisionId: string; note?: string }) {
    const p = await this.s.project(ctx, projectId);
    const v = await this.lockVersion(p, versionId);
    const d = await loadInProject(this.s.db, schema.decision, projectId, body.decisionId);
    if (!this.s.policy.canSee(ctx, { projectId, classification: d.classification as Classification })) throw notFound();
    const issue = gateDecisionIssue({ id: d.id, status: d.status as DecisionStatus, authorityOutcome: d.authorityOutcome as DecisionAuthorityOutcome, externalAuthorityReference: d.externalAuthorityReference, gateKey: d.gateKey }, PERIMETER_GATE);
    // `authority`: the approver acts within delegated authority only with a FINAL decision of the authorized body.
    this.s.policy.assert(ctx, 'carveout.perimeter.approve', { projectId, classification: p.classification, requesterUserId: v.proposedBy, withinAuthority: issue === null });
    assertVersion(v, body.expectedVersion, 'perimeter version');
    if (v.status !== 'proposed') throw ruleViolation('perimeter.version.not_proposed', `The version is ${v.status}`);
    // The register must still be what was proposed (a later change requires a new proposal).
    const current = payloadHash(await this.snapshot(projectId));
    if (current !== v.snapshotHash) throw conflict('perimeter.version.stale', 'The perimeter changed since this version was proposed — reject it and propose again');
    const [prev] = await this.tx.select().from(V).where(and(eq(V.projectId, projectId), eq(V.status, 'approved')));
    if (prev) {
      await updateVersioned(this.s.db, V, { id: prev.id, projectId, expectedVersion: prev.version }, { status: 'superseded', supersededAt: new Date() });
      await this.audit.record({ action: 'carveout.perimeter.supersede_version', entityType: 'perimeter_version', entityId: prev.id, projectId, before: { status: 'approved' }, after: { status: 'superseded', supersededBy: v.id } });
    }
    const row = await updateVersioned(this.s.db, V, { id: v.id, projectId, expectedVersion: body.expectedVersion }, { status: 'approved', decidedBy: ctx.principal.userId, decidedAt: new Date(), decisionId: d.id, decisionNote: body.note ?? null });
    await this.versions.snapshot({ projectId, entityType: 'perimeter_version', entityId: v.id, versionNo: row['version'] as number, snapshot: { status: 'approved', snapshotHash: v.snapshotHash, decisionId: d.id, approvedBy: ctx.principal.userId }, reason: 'approved' });
    await this.audit.record({ action: 'carveout.perimeter.approve_version', entityType: 'perimeter_version', entityId: v.id, projectId, before: { status: v.status }, after: { status: 'approved', versionNo: v.versionNo, snapshotHash: v.snapshotHash, decisionId: d.id, decisionCode: d.code, supersedes: prev?.id ?? null }, reason: body.note ?? null });
    await this.outbox.emit({ type: 'perimeter.changed', projectId, aggregateType: 'perimeter_version', aggregateId: v.id, payload: { change: 'version_approved', versionNo: v.versionNo }, dedupeKey: `perimeter-version-approved:${v.id}` });
    return { id: v.id, versionNo: v.versionNo, status: 'approved', version: row['version'] as number };
  }

  async reject(ctx: RequestContext, projectId: string, versionId: string, body: { expectedVersion: number; reason: string }) {
    const p = await this.s.project(ctx, projectId);
    const v = await this.lockVersion(p, versionId);
    this.s.policy.assert(ctx, 'carveout.perimeter.approve', { projectId, classification: p.classification, requesterUserId: v.proposedBy });
    assertVersion(v, body.expectedVersion, 'perimeter version');
    if (v.status !== 'proposed') throw ruleViolation('perimeter.version.not_proposed', `The version is ${v.status}`);
    const row = await updateVersioned(this.s.db, V, { id: v.id, projectId, expectedVersion: body.expectedVersion }, { status: 'rejected', decidedBy: ctx.principal.userId, decidedAt: new Date(), decisionNote: body.reason });
    await this.audit.record({ action: 'carveout.perimeter.reject_version', entityType: 'perimeter_version', entityId: v.id, projectId, before: { status: v.status }, after: { status: 'rejected' }, reason: body.reason });
    return { id: v.id, versionNo: v.versionNo, status: 'rejected', version: row['version'] as number };
  }
}
