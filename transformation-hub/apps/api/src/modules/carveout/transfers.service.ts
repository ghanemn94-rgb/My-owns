import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, SQL } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  Classification,
  ContractTransferClass,
  PerimeterDisposition,
  PerimeterItemType,
  TransferAspect,
  TransferCommand,
  TransferStatus,
  assertTransferCommand,
  consentsGranted,
  combinedTransferStatus,
  ruleViolation,
} from '@hub/domain';
import type { z } from 'zod';
import type { RecordTransferBody, TransferListQuery } from '@hub/contracts';
import { AuditService } from '../../platform/audit.service';
import { OutboxService } from '../../platform/outbox.service';
import { RecordVersionService, assertVersion, loadInProject, offsetOf, pageOf, updateVersioned } from '../../platform/helpers';
import type { RequestContext } from '../../platform/context';
import { newId } from '../../platform/ids';
import { CarveoutProject, CarveoutSupport } from './carveout.support';
import { PerimeterService } from './perimeter.service';

type Item = typeof schema.perimeterItem.$inferSelect;
const TR = schema.transferRecord;
const PI = schema.perimeterItem;

/**
 * Transfer records (REQ-PER-007, P0 review D-05): each command acts on ONE aspect — legal or economic — of a perimeter
 * item, with that aspect's own effective date, and is logged append-only in `transfer_record`. verifyTransfer needs
 * active, non-conflicting acceptance evidence (target type `transfer`) and a verifier other than the reporter.
 */
@Injectable()
export class TransfersService {
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

  async list(ctx: RequestContext, projectId: string, q: z.infer<typeof TransferListQuery>) {
    await this.s.project(ctx, projectId);
    // Records follow the visibility and workstream reach of their perimeter item.
    const conds: SQL[] = [
      eq(TR.projectId, projectId),
      this.s.policy.visibilitySql(ctx, projectId, { classification: PI.classification }),
      this.s.policy.reachSql(ctx, 'carveout.register.read', projectId, PI.workstreamId),
    ];
    if (q.perimeterItemId) conds.push(eq(TR.perimeterItemId, q.perimeterItemId));
    if (q.aspect) conds.push(eq(TR.aspect, q.aspect));
    const where = and(...conds);
    const join = and(eq(PI.id, TR.perimeterItemId), eq(PI.projectId, TR.projectId));
    const [{ n }] = (await this.tx.select({ n: count() }).from(TR).innerJoin(PI, join).where(where)) as [{ n: number }];
    const rows = await this.tx.select({ r: TR, code: PI.code }).from(TR).innerJoin(PI, join).where(where).orderBy(desc(TR.recordedAt), desc(TR.id)).limit(q.pageSize).offset(offsetOf(q));
    const names = await this.s.userNames(rows.map((x) => x.r.recordedBy));
    return pageOf(
      rows.map(({ r, code }) => ({
        id: r.id,
        perimeterItemId: r.perimeterItemId,
        itemCode: code,
        aspect: r.aspect as TransferAspect,
        command: r.command,
        fromStatus: r.fromStatus as TransferStatus,
        toStatus: r.toStatus as TransferStatus,
        mechanism: r.mechanism,
        effectiveDate: r.effectiveDate,
        note: r.note,
        evidenceCount: r.evidenceCount,
        reviewsRecordId: r.reviewsRecordId,
        recordedBy: r.recordedBy,
        recordedByName: names.get(r.recordedBy) ?? null,
        recordedAt: r.recordedAt.toISOString(),
      })),
      Number(n),
      q,
    );
  }

  private statusOf(item: Item, aspect: TransferAspect): TransferStatus {
    return (aspect === 'legal' ? item.transferStatus : item.economicTransferStatus) as TransferStatus;
  }

  private async guardInput(p: CarveoutProject, item: Item) {
    const consents = (await this.perimeter.consentsOf(p.id, [item.id])).get(item.id) ?? [];
    const ev = (await this.s.evidenceCounts(p.id, 'transfer', [item.id])).get(item.id) ?? { active: 0, conflicting: 0 };
    return {
      disposition: item.disposition as PerimeterDisposition,
      itemType: item.type as PerimeterItemType,
      activeEvidence: ev.active,
      conflictingEvidence: ev.conflicting,
      transferClass: item.transferClass as ContractTransferClass,
      transferClassAssessed: !!item.transferClassAssessedBy && item.transferClass !== 'unknown',
      consentGranted: consentsGranted(consents.map((c) => c.status)),
      today: this.s.today(p),
    };
  }

  private async write(
    ctx: RequestContext,
    p: CarveoutProject,
    item: Item,
    expectedVersion: number,
    rec: { aspect: TransferAspect; command: TransferCommand; from: TransferStatus; to: TransferStatus; mechanism: string | null; effectiveDate: string | null; note: string | null; evidenceCount: number; reviewsRecordId: string | null },
    itemUpdate: Partial<typeof schema.perimeterItem.$inferInsert>,
  ) {
    const statusCol = rec.aspect === 'legal' ? 'transferStatus' : 'economicTransferStatus';
    const row = await updateVersioned(this.s.db, PI, { id: item.id, projectId: p.id, expectedVersion }, { ...itemUpdate, [statusCol]: rec.to });
    const id = newId();
    await this.tx.insert(TR).values({
      id,
      orgId: p.orgId,
      projectId: p.id,
      perimeterItemId: item.id,
      aspect: rec.aspect,
      command: rec.command,
      fromStatus: rec.from,
      toStatus: rec.to,
      mechanism: rec.mechanism,
      effectiveDate: rec.effectiveDate,
      note: rec.note,
      evidenceCount: rec.evidenceCount,
      reviewsRecordId: rec.reviewsRecordId,
      recordedBy: ctx.principal.userId!,
    });
    const version = row['version'] as number;
    await this.versions.snapshot({ projectId: p.id, entityType: 'perimeter_item', entityId: item.id, versionNo: version, snapshot: row, reason: `Transfer (${rec.aspect}) ${rec.command}: ${rec.from} → ${rec.to}` });
    await this.audit.record({
      action: `carveout.transfer.${rec.command}`,
      entityType: 'perimeter_item',
      entityId: item.id,
      projectId: p.id,
      before: { aspect: rec.aspect, status: rec.from },
      after: { aspect: rec.aspect, status: rec.to, transferRecordId: id, effectiveDate: rec.effectiveDate, reviewsRecordId: rec.reviewsRecordId, evidenceCount: rec.evidenceCount },
      reason: rec.note,
    });
    await this.outbox.emit({ type: 'perimeter.changed', projectId: p.id, aggregateType: 'perimeter_item', aggregateId: item.id, payload: { change: 'transfer', aspect: rec.aspect, command: rec.command, status: rec.to } });
    const legal = (rec.aspect === 'legal' ? rec.to : item.transferStatus) as TransferStatus;
    const economic = (rec.aspect === 'economic' ? rec.to : item.economicTransferStatus) as TransferStatus;
    return { id, perimeterItemId: item.id, aspect: rec.aspect, status: rec.to, transfer: { legal, economic, combined: combinedTransferStatus(legal, economic) }, itemVersion: version };
  }

  async record(ctx: RequestContext, projectId: string, body: z.infer<typeof RecordTransferBody>) {
    const p = await this.s.project(ctx, projectId);
    const item = await this.perimeter.loadForManage(ctx, p, body.perimeterItemId, 'carveout.transfer.manage');
    assertVersion(item, body.expectedVersion, 'perimeter item');
    const from = this.statusOf(item, body.aspect);
    const g = await this.guardInput(p, item);
    const mechanism = body.mechanism?.trim() || item.transferMechanism;
    const to = assertTransferCommand({ ...g, command: body.command, aspect: body.aspect, current: from, mechanism, effectiveDate: body.effectiveDate ?? null, note: body.note ?? null, actorUserId: ctx.principal.userId!, reportedBy: null });
    const u: Partial<typeof schema.perimeterItem.$inferInsert> = {};
    if (body.command === 'plan' || body.command === 'report_transferred') u.transferMechanism = mechanism;
    if (body.command === 'plan') u[body.aspect === 'legal' ? 'plannedEffectiveDate' : 'economicPlannedEffectiveDate'] = body.effectiveDate!;
    if (body.command === 'report_transferred') u[body.aspect === 'legal' ? 'actualEffectiveDate' : 'economicActualEffectiveDate'] = body.effectiveDate!;
    return this.write(ctx, p, item, body.expectedVersion, { aspect: body.aspect, command: body.command, from, to, mechanism, effectiveDate: body.effectiveDate ?? null, note: body.note ?? null, evidenceCount: g.activeEvidence, reviewsRecordId: null }, u);
  }

  /** Load the reported transfer a reviewer acts on; it must be the latest report of its aspect. */
  private async reviewTarget(ctx: RequestContext, p: CarveoutProject, transferId: string) {
    const rec = await loadInProject(this.s.db, TR, p.id, transferId);
    const item = await this.perimeter.loadReadable(ctx, p, rec.perimeterItemId);
    // Separation of duties (not_self): the reviewer cannot be the reporter.
    this.s.policy.assert(ctx, 'carveout.transfer.verify', { projectId: p.id, classification: item.classification as Classification, requesterUserId: rec.recordedBy });
    if (rec.command !== 'report_transferred') throw ruleViolation('transfer.not_a_report', 'Only a reported transfer can be verified or have its evidence rejected');
    const [latest] = await this.tx
      .select({ id: TR.id })
      .from(TR)
      .where(and(eq(TR.projectId, p.id), eq(TR.perimeterItemId, rec.perimeterItemId), eq(TR.aspect, rec.aspect), eq(TR.command, 'report_transferred')))
      .orderBy(desc(TR.recordedAt), desc(TR.id))
      .limit(1);
    if (latest?.id !== rec.id) throw ruleViolation('transfer.superseded_report', 'A newer transfer report exists for this aspect — review that one');
    return { rec, item, aspect: rec.aspect as TransferAspect };
  }

  /** Domain command verifyTransfer (spec §14). */
  async verify(ctx: RequestContext, projectId: string, transferId: string, body: { expectedVersion: number; note?: string }) {
    const p = await this.s.project(ctx, projectId);
    const { rec, item, aspect } = await this.reviewTarget(ctx, p, transferId);
    assertVersion(item, body.expectedVersion, 'perimeter item');
    const from = this.statusOf(item, aspect);
    const g = await this.guardInput(p, item);
    const to = assertTransferCommand({ ...g, command: 'verify', aspect, current: from, mechanism: item.transferMechanism, effectiveDate: rec.effectiveDate, note: body.note ?? null, actorUserId: ctx.principal.userId!, reportedBy: rec.recordedBy });
    return this.write(ctx, p, item, body.expectedVersion, { aspect, command: 'verify', from, to, mechanism: rec.mechanism, effectiveDate: rec.effectiveDate, note: body.note ?? null, evidenceCount: g.activeEvidence, reviewsRecordId: rec.id }, {});
  }

  async rejectEvidence(ctx: RequestContext, projectId: string, transferId: string, body: { expectedVersion: number; reason: string }) {
    const p = await this.s.project(ctx, projectId);
    const { rec, item, aspect } = await this.reviewTarget(ctx, p, transferId);
    assertVersion(item, body.expectedVersion, 'perimeter item');
    const from = this.statusOf(item, aspect);
    const g = await this.guardInput(p, item);
    const to = assertTransferCommand({ ...g, command: 'reject_evidence', aspect, current: from, mechanism: item.transferMechanism, effectiveDate: rec.effectiveDate, note: body.reason, actorUserId: ctx.principal.userId!, reportedBy: rec.recordedBy });
    // The actual date reported with the rejected evidence is no longer relied upon.
    const u: Partial<typeof schema.perimeterItem.$inferInsert> = { [aspect === 'legal' ? 'actualEffectiveDate' : 'economicActualEffectiveDate']: null };
    return this.write(ctx, p, item, body.expectedVersion, { aspect, command: 'reject_evidence', from, to, mechanism: rec.mechanism, effectiveDate: null, note: body.reason, evidenceCount: g.activeEvidence, reviewsRecordId: rec.id }, u);
  }
}
