import { Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@hub/db';
import { assertClaimTargetField, type ImportValue } from '@hub/domain';
import { DbService } from '../../platform/db.service';
import { PolicyService } from '../../platform/policy.service';
import { AuditService } from '../../platform/audit.service';
import { RecordVersionService, nextCode } from '../../platform/helpers';
import { newId } from '../../platform/ids';
import type { RequestContext } from '../../platform/context';
import { ChangeControlService } from '../planning/change-control.service';
import type { PlanRow } from './import-planner';

type Batch = typeof schema.importBatch.$inferSelect;
export interface Output {
  rowNo: number;
  recordType: 'risk' | 'task' | 'source_claim' | 'change_request';
  recordId: string;
  recordCode: string | null;
  createdVersion: number;
}
export interface RollbackBlocker {
  recordType: string;
  recordCode: string | null;
  reason: 'changed_since_import' | 'referenced' | 'missing';
}

const txt = (v: ImportValue | undefined): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const num = (v: ImportValue | undefined): number | null => (typeof v === 'number' ? v : v === null || v === undefined || v === '' ? null : Number(v));

/**
 * Writes of an approved batch (REQ-INT-002, REQ-INT-015) and its rollback (REQ-INT-003). Everything runs in the approval's
 * request transaction with the APPROVER's authority (each record type's own manage permission is re-checked): a batch
 * never grants more than the approver holds. Records are created as drafts / proposals; an existing record is never
 * updated — a difference becomes a proposed claim, and for a governed record a draft change request. Created records name
 * the uploader as creator (the content is theirs) — so the uploader can never verify the claims of their own file.
 */
@Injectable()
export class ImportApplier {
  constructor(
    private readonly db: DbService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly versions: RecordVersionService,
    private readonly changeControl: ChangeControlService,
  ) {}

  private get tx() {
    return this.db.tx();
  }

  async apply(ctx: RequestContext, batch: Batch, rows: PlanRow[], sheet: string): Promise<Output[]> {
    const out: Output[] = [];
    for (const r of rows) {
      const loc = batch.kind === 'document_claims' ? `paragraph ${r.rowNo}` : `${sheet}!row ${r.rowNo}`;
      if (batch.kind === 'risk') await this.applyRisk(ctx, batch, r, loc, out);
      else if (batch.kind === 'task') await this.applyTask(ctx, batch, r, loc, out);
      else if (batch.kind === 'decision') await this.applyDecision(ctx, batch, r, loc, out);
      else if (batch.kind === 'source_claims') {
        const v = r.values;
        const verification = (txt(v['verification']) ?? 'historical_unverified') as 'historical_unverified' | 'proposed' | 'unknown' | 'assumed';
        out.push(await this.claim(ctx, batch, r.rowNo, { subject: String(v['subject']), value: String(v['value']), location: txt(v['location']) ?? loc, targetType: r.refs.targetType ?? null, targetId: r.refs.targetId ?? null, field: r.refs.targetId ? txt(v['field']) : null, verification, confidence: num(v['confidence']) }));
      } else {
        // Document text: an unverified claim with no target and no confidence — it never fills an official field (REQ-INT-005).
        out.push(await this.claim(ctx, batch, r.rowNo, { subject: `Paragraph ${r.rowNo}`, value: String(r.values['text']), location: loc, targetType: null, targetId: null, field: null, verification: 'unknown', confidence: null }));
      }
    }
    if (out.length) {
      await this.tx.insert(schema.importOutput).values(
        out.map((o) => ({ id: newId(), orgId: batch.orgId, projectId: batch.projectId, batchId: batch.id, rowNo: o.rowNo, recordType: o.recordType, recordId: o.recordId, recordCode: o.recordCode, createdVersion: o.createdVersion })),
      );
    }
    return out;
  }

  // ------------------------------------------------------------------------------------------------ claims
  private async claim(
    ctx: RequestContext,
    batch: Batch,
    rowNo: number,
    c: { subject: string; value: string; location: string; targetType: string | null; targetId: string | null; field: string | null; verification: 'historical_unverified' | 'proposed' | 'unknown' | 'assumed'; confidence: number | null },
  ): Promise<Output> {
    assertClaimTargetField(c.targetType, c.field);
    this.policy.assert(ctx, 'documents.source.manage', { projectId: batch.projectId, classification: batch.classification });
    const id = newId();
    await this.tx.insert(schema.sourceClaim).values({
      id,
      orgId: batch.orgId,
      projectId: batch.projectId,
      sourceId: batch.sourceId!,
      location: c.location.slice(0, 200),
      subject: c.subject.slice(0, 500),
      targetType: c.targetType,
      targetId: c.targetId,
      field: c.field,
      extractedValue: c.value.slice(0, 2000),
      sourceReportedValue: c.value.slice(0, 2000),
      confidence: c.confidence === null ? null : c.confidence.toFixed(3),
      verificationStatus: c.verification,
      originStatus: c.verification,
      isDemo: batch.isDemo,
      createdBy: batch.createdBy,
    });
    await this.audit.record({ action: 'documents.claim.create', entityType: 'source_claim', entityId: id, projectId: batch.projectId, reason: `import ${batch.code} row ${rowNo}`, after: { sourceId: batch.sourceId, subject: c.subject.slice(0, 200), targetType: c.targetType, targetId: c.targetId, field: c.field, verificationStatus: c.verification, importBatchId: batch.id } });
    return { rowNo, recordType: 'source_claim', recordId: id, recordCode: null, createdVersion: 1 };
  }

  /** A difference with an existing record → one proposed claim per field (targeted when the field is comparable). */
  private async proposalClaims(ctx: RequestContext, batch: Batch, r: PlanRow, loc: string, label: string, targetType: 'task' | null, out: Output[]) {
    const claimable: Record<string, readonly string[]> = { task: ['status', 'plannedStart', 'plannedFinish', 'actualFinish', 'reportedProgress'] };
    for (const d of r.diff) {
      const targeted = targetType && claimable[targetType]!.includes(d.field);
      out.push(
        await this.claim(ctx, batch, r.rowNo, {
          subject: `${label} — ${d.field}`,
          value: String(d.to ?? ''),
          location: loc,
          targetType: targeted ? targetType : null,
          targetId: targeted ? r.matchId : null,
          field: targeted ? d.field : null,
          verification: 'proposed',
          confidence: null,
        }),
      );
    }
  }

  /** AT-01: a source-reported status becomes a historical-unverified claim — never the current status. */
  private async reportedStatusClaim(ctx: RequestContext, batch: Batch, r: PlanRow, loc: string, taskId: string, wbs: string, out: Output[]) {
    const status = txt(r.values['reportedStatus']);
    if (!status) return;
    out.push(await this.claim(ctx, batch, r.rowNo, { subject: `Task ${wbs} — reported status`, value: status, location: loc, targetType: 'task', targetId: taskId, field: 'status', verification: 'historical_unverified', confidence: null }));
  }

  private async changeRequest(ctx: RequestContext, batch: Batch, r: PlanRow, subjectType: 'task' | 'decision', out: Output[]) {
    const fields = r.diff.map((d) => `${d.field}: ${d.from ?? '—'} → ${d.to ?? '—'}`).join('; ');
    const cr = await this.changeControl.createChangeRequestFor(ctx, {
      projectId: batch.projectId,
      subjectType,
      subjectId: r.matchId!,
      title: `Import ${batch.code}: proposed change to ${subjectType} ${r.matchCode ?? ''}`.trim().slice(0, 300),
      rationale: `Proposed by import ${batch.code} (${batch.filename}, row ${r.rowNo}). The ${subjectType} is governed (${r.governedReason}); the import did not change it. Proposed: ${fields}`.slice(0, 4000),
      impacts: {},
      proposedChange: { source: 'import', importBatchId: batch.id, importCode: batch.code, rowNo: r.rowNo, sourceId: batch.sourceId, fields: r.diff },
    });
    out.push({ rowNo: r.rowNo, recordType: 'change_request', recordId: cr.id, recordCode: cr.code, createdVersion: cr.version });
  }

  // ------------------------------------------------------------------------------------------------ targets
  private async applyRisk(ctx: RequestContext, batch: Batch, r: PlanRow, loc: string, out: Output[]) {
    const v = r.values;
    if (r.action === 'update') {
      await this.proposalClaims(ctx, batch, r, loc, `Risk ${r.matchCode}`, null, out);
      return;
    }
    const workstreamId = r.refs.workstreamId ?? null;
    this.policy.assert(ctx, 'planning.raid.manage', { projectId: batch.projectId, workstreamId, ownerUserIds: [ctx.principal.userId] });
    const id = newId();
    const code = await nextCode(this.db, schema.risk, batch.projectId, 'RSK');
    await this.tx.insert(schema.risk).values({
      id,
      orgId: batch.orgId,
      projectId: batch.projectId,
      workstreamId,
      code,
      title: String(v['title']),
      description: txt(v['description']),
      probability: num(v['probability'])!,
      impact: num(v['impact'])!,
      dueDate: txt(v['dueDate']),
      responseStrategy: txt(v['responseStrategy']),
      isDemo: batch.isDemo,
      createdBy: batch.createdBy,
    });
    await this.audit.record({ action: 'planning.raid.create', entityType: 'risk', entityId: id, projectId: batch.projectId, reason: `import ${batch.code} row ${r.rowNo}`, after: { code, title: v['title'], probability: v['probability'], impact: v['impact'], importBatchId: batch.id } });
    out.push({ rowNo: r.rowNo, recordType: 'risk', recordId: id, recordCode: code, createdVersion: 1 });
  }

  private async applyTask(ctx: RequestContext, batch: Batch, r: PlanRow, loc: string, out: Output[]) {
    const v = r.values;
    if (r.action === 'conflict') {
      await this.changeRequest(ctx, batch, r, 'task', out);
      await this.reportedStatusClaim(ctx, batch, r, loc, r.matchId!, r.matchCode!, out);
      return;
    }
    if (r.action === 'update') {
      await this.proposalClaims(ctx, batch, r, loc, `Task ${r.matchCode}`, 'task', out);
      await this.reportedStatusClaim(ctx, batch, r, loc, r.matchId!, r.matchCode!, out);
      return;
    }
    const workstreamId = r.refs.workstreamId!;
    this.policy.assert(ctx, 'planning.task.manage', { projectId: batch.projectId, workstreamId });
    const id = newId();
    const [maxSort] = await this.tx.select({ m: sql<number>`coalesce(max(${schema.task.sortOrder}), 0)::int` }).from(schema.task).where(eq(schema.task.projectId, batch.projectId));
    const duration = num(v['durationDays']);
    const values: typeof schema.task.$inferInsert = {
      id,
      orgId: batch.orgId,
      projectId: batch.projectId,
      workstreamId,
      wbsCode: String(v['wbsCode']),
      title: String(v['title']),
      description: txt(v['description']),
      // Imported activities enter as Draft / Proposed: a planner confirms them into the plan (activate).
      status: 'draft',
      verificationStatus: 'proposed',
      durationDays: duration,
      durationBasis: duration !== null ? 'estimated' : 'tbd',
      plannedStart: txt(v['plannedStart']),
      plannedFinish: txt(v['plannedFinish']),
      requiresAcceptance: true,
      sortOrder: Number(maxSort?.m ?? 0) + 1,
      isDemo: batch.isDemo,
      createdBy: batch.createdBy,
    };
    await this.tx.insert(schema.task).values(values);
    await this.audit.record({ action: 'planning.task.create', entityType: 'task', entityId: id, projectId: batch.projectId, reason: `import ${batch.code} row ${r.rowNo}`, after: { wbsCode: values.wbsCode, title: values.title, workstreamId, status: 'draft', importBatchId: batch.id } });
    await this.versions.snapshot({ projectId: batch.projectId, entityType: 'task', entityId: id, versionNo: 1, snapshot: values as Record<string, unknown>, reason: `created by import ${batch.code}` });
    out.push({ rowNo: r.rowNo, recordType: 'task', recordId: id, recordCode: String(v['wbsCode']), createdVersion: 1 });
    await this.reportedStatusClaim(ctx, batch, r, loc, id, String(v['wbsCode']), out);
  }

  private async applyDecision(ctx: RequestContext, batch: Batch, r: PlanRow, _loc: string, out: Output[]) {
    // REQ-INT-015: a committee decision is never written by an import — the difference becomes a draft change request.
    if (r.action === 'conflict') await this.changeRequest(ctx, batch, r, 'decision', out);
  }

  // ------------------------------------------------------------------------------------------------ rollback
  /** Records of the batch that block a rollback: changed since the import, referenced by other records, or missing. */
  async rollbackBlockers(projectId: string, outputs: (typeof schema.importOutput.$inferSelect)[]): Promise<RollbackBlocker[]> {
    const blockers: RollbackBlocker[] = [];
    const ids = (t: string) => outputs.filter((o) => o.recordType === t && !o.rolledBackAt);
    const check = async <T extends { id: string; version: number }>(type: string, rows: T[], list: typeof outputs, ok: (row: T) => boolean) => {
      for (const o of list) {
        const row = rows.find((x) => x.id === o.recordId);
        if (!row) blockers.push({ recordType: type, recordCode: o.recordCode, reason: 'missing' });
        else if (row.version !== o.createdVersion || !ok(row)) blockers.push({ recordType: type, recordCode: o.recordCode, reason: 'changed_since_import' });
      }
    };
    const risks = ids('risk');
    if (risks.length) await check('risk', await this.tx.select({ id: schema.risk.id, version: schema.risk.version, status: schema.risk.status }).from(schema.risk).where(and(eq(schema.risk.projectId, projectId), inArray(schema.risk.id, risks.map((o) => o.recordId)))), risks, (x) => x.status === 'open');
    const tasks = ids('task');
    if (tasks.length) await check('task', await this.tx.select({ id: schema.task.id, version: schema.task.version, status: schema.task.status }).from(schema.task).where(and(eq(schema.task.projectId, projectId), inArray(schema.task.id, tasks.map((o) => o.recordId)))), tasks, (x) => x.status === 'draft');
    const crs = ids('change_request');
    if (crs.length) await check('change_request', await this.tx.select({ id: schema.changeRequest.id, version: schema.changeRequest.version, status: schema.changeRequest.status }).from(schema.changeRequest).where(and(eq(schema.changeRequest.projectId, projectId), inArray(schema.changeRequest.id, crs.map((o) => o.recordId)))), crs, (x) => x.status === 'draft');
    const claims = ids('source_claim');
    if (claims.length) {
      const rows = await this.tx
        .select({ id: schema.sourceClaim.id, version: schema.sourceClaim.version, applied: schema.sourceClaim.appliedToRecord, reviewedAt: schema.sourceClaim.reviewedAt })
        .from(schema.sourceClaim)
        .where(and(eq(schema.sourceClaim.projectId, projectId), inArray(schema.sourceClaim.id, claims.map((o) => o.recordId))));
      await check('source_claim', rows, claims, (x) => !x.applied && !x.reviewedAt);
    }
    // References from other records (evidence, change requests, dependencies, RACI, child tasks, issues, proposals).
    const live = outputs.filter((o) => !o.rolledBackAt && o.recordType !== 'source_claim');
    if (live.length) {
      const refIds = live.map((o) => o.recordId);
      const own = new Set(outputs.map((o) => o.recordId));
      const q = await this.db.query<{ id: string }>(
        `select target_id as id from evidence_link where project_id = $1 and target_id = any($2::uuid[]) and status in ('active', 'conflicting')
         union select subject_id from change_request where project_id = $1 and subject_id = any($2::uuid[]) and not (id = any($3::uuid[])) and status <> 'withdrawn'
         union select subject_id from approval_request where project_id = $1 and subject_id = any($2::uuid[])
         union select predecessor_id from dependency where project_id = $1 and predecessor_id = any($2::uuid[])
         union select successor_id from dependency where project_id = $1 and successor_id = any($2::uuid[])
         union select entity_id from raci_assignment where project_id = $1 and entity_id = any($2::uuid[])
         union select parent_id from task where project_id = $1 and parent_id = any($2::uuid[])
         union select raised_from_risk_id from issue where project_id = $1 and raised_from_risk_id = any($2::uuid[])
         union select successor_id from record_dependency where project_id = $1 and successor_id = any($2::uuid[])
         union select local_item_id from cross_project_dependency where project_id = $1 and local_item_id = any($2::uuid[])
         union select other_item_id from cross_project_dependency where other_item_id = any($2::uuid[])
         union select target_id from source_claim where project_id = $1 and target_id = any($2::uuid[]) and not (id = any($3::uuid[]))`,
        [projectId, refIds, [...own]],
      );
      for (const { id } of q.rows) {
        const o = live.find((x) => x.recordId === id);
        if (o && !blockers.some((b) => b.recordCode === o.recordCode && b.recordType === o.recordType)) blockers.push({ recordType: o.recordType, recordCode: o.recordCode, reason: 'referenced' });
      }
    }
    return blockers;
  }

  /**
   * Rollback (feasible only without blockers): created risks and tasks are CANCELLED and change requests WITHDRAWN (codes are
   * never reused and the history stays visible); proposed claims are removed. Records the import did not create were never
   * changed by it, so there is nothing else to restore.
   */
  async rollback(ctx: RequestContext, batch: Batch, outputs: (typeof schema.importOutput.$inferSelect)[], reason: string) {
    const now = new Date();
    const live = outputs.filter((o) => !o.rolledBackAt);
    for (const o of live) {
      const why = `rollback of import ${batch.code}: ${reason}`.slice(0, 1000);
      if (o.recordType === 'source_claim') {
        await this.tx.delete(schema.sourceClaim).where(and(eq(schema.sourceClaim.id, o.recordId), eq(schema.sourceClaim.projectId, batch.projectId)));
      } else if (o.recordType === 'risk') {
        await this.tx.update(schema.risk).set({ status: 'cancelled', updatedAt: now, version: sql`${schema.risk.version} + 1` }).where(and(eq(schema.risk.id, o.recordId), eq(schema.risk.projectId, batch.projectId)));
      } else if (o.recordType === 'task') {
        await this.tx.update(schema.task).set({ status: 'cancelled', updatedAt: now, version: sql`${schema.task.version} + 1` }).where(and(eq(schema.task.id, o.recordId), eq(schema.task.projectId, batch.projectId)));
        await this.versions.snapshot({ projectId: batch.projectId, entityType: 'task', entityId: o.recordId, versionNo: o.createdVersion + 1, snapshot: { status: 'cancelled', rolledBackImport: batch.code }, reason: why });
      } else if (o.recordType === 'change_request') {
        await this.tx.update(schema.changeRequest).set({ status: 'withdrawn', decisionNote: why, updatedAt: now, version: sql`${schema.changeRequest.version} + 1` }).where(and(eq(schema.changeRequest.id, o.recordId), eq(schema.changeRequest.projectId, batch.projectId)));
      }
      await this.audit.record({ action: 'imports.record.rollback', entityType: o.recordType, entityId: o.recordId, projectId: batch.projectId, reason: why, after: { importBatchId: batch.id, recordCode: o.recordCode, result: o.recordType === 'source_claim' ? 'removed' : o.recordType === 'change_request' ? 'withdrawn' : 'cancelled' } });
    }
    if (live.length) await this.tx.update(schema.importOutput).set({ rolledBackAt: now }).where(and(eq(schema.importOutput.batchId, batch.id), eq(schema.importOutput.projectId, batch.projectId)));
    return live.length;
  }
}
