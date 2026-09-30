import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, ilike, inArray, or, SQL } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  aggregateFigures,
  allowedCommands,
  assertCellReference,
  assertFigureApprovable,
  assertFigureValidatable,
  assertHumanActor,
  assertLineConsistency,
  assertNotDeclassified,
  assertSnapshotSource,
  assertTsaLink,
  conflict,
  invalid,
  notFound,
  parseFinancialPeriod,
  parseMoney,
  ruleViolation,
  transition,
  BUDGET_DECISION_TYPE_KEYS,
  FIGURE_APPROVAL_MACHINE,
  FINANCE_DEFAULT_CLASSIFICATION,
  OPENING_BALANCE_DECISION_TYPE_KEYS,
  ApprovalState,
  Classification,
  FinancialCategory,
  FigureCommand,
} from '@hub/domain';
import type { RouteInput, financeRoutes } from '@hub/contracts';
import type { RequestContext } from '../../platform/context';
import { assertVersion, likeContains, loadInProject, offsetOf, pageOf, updateVersioned } from '../../platform/helpers';
import { orderBySort } from '../../platform/sort';
import { newId, payloadHash } from '../../platform/ids';
import { assertCurrentDecisionReliance } from '../governance/decision-reliance';
import { FinanceSupport, ProjectRow, iso, money } from './finance.support';
import { ReconciliationsService } from './reconciliations.service';

type SnapshotRow = typeof schema.financialSnapshot.$inferSelect;
const T = schema.financialSnapshot;
type R = typeof financeRoutes;

/** The figure a validation/approval binds to (content + source; never workflow or visibility fields). */
export function snapshotContent(r: SnapshotRow) {
  return {
    kind: r.kind,
    category: r.category,
    lineRef: r.lineRef,
    label: r.label,
    period: r.period,
    amount: r.amount,
    currency: r.currency,
    unitScale: r.unitScale,
    sourceType: r.sourceType,
    sourceRef: r.sourceRef,
    sourceDocumentId: r.sourceDocumentId,
    sourceDocumentVersionId: r.sourceDocumentVersionId,
    sourceSheet: r.sourceSheet,
    sourceCell: r.sourceCell,
    tsaServiceId: r.tsaServiceId,
  };
}
const contentHash = (r: SnapshotRow) => payloadHash(snapshotContent(r));
const describe = (r: Pick<SnapshotRow, 'lineRef' | 'kind' | 'period'>) => `Figure ${r.lineRef} (${r.kind}, ${r.period})`;
const actorOf = (ctx: RequestContext) => ({ kind: ctx.principal.kind, userId: ctx.principal.userId });
const rank = (c: Classification) => ['public', 'internal', 'confidential', 'restricted', 'strictly_confidential'].indexOf(c);

/**
 * Baseline / forecast / actual figures (REQ-FIN-001/002/004/008/010) and their aggregation (REQ-DAT-004, AT-29).
 * Human financial validation by someone other than the preparer precedes approval by a third person; approvals bind to
 * the validated content (hash) and are recorded as approval_request / approval_record rows.
 */
@Injectable()
export class SnapshotsService {
  constructor(
    private readonly s: FinanceSupport,
    private readonly recon: ReconciliationsService,
  ) {}

  // ---------------------------------------------------------------------------------------------------------
  // Reads

  dto(r: SnapshotRow, p: ProjectRow) {
    return {
      id: r.id,
      kind: r.kind,
      category: r.category,
      lineRef: r.lineRef,
      label: r.label,
      period: r.period,
      amount: money(r.amount, r.currency, r.unitScale),
      sourceType: r.sourceType,
      sourceRef: r.sourceRef,
      sourceDocumentId: r.sourceDocumentId,
      sourceDocumentVersionId: r.sourceDocumentVersionId,
      sourceSheet: r.sourceSheet,
      sourceCell: r.sourceCell,
      importBatchId: r.importBatchId,
      tsaServiceId: r.tsaServiceId,
      workstreamId: r.workstreamId,
      approvalState: r.approvalState,
      validatedBy: r.validatedBy,
      approvedBy: r.approvedBy,
      approvedAt: iso(r.approvedAt),
      approvalDate: this.s.localDate(p, r.approvedAt),
      classification: r.classification,
      isDemo: r.isDemo,
      createdAt: r.createdAt.toISOString(),
      createdBy: r.createdBy,
      updatedAt: r.updatedAt.toISOString(),
      version: r.version,
    };
  }

  scopeSql(ctx: RequestContext, projectId: string): SQL {
    return and(eq(T.projectId, projectId), this.s.visibleSql(ctx, projectId, { classification: T.classification, workstream: T.workstreamId }))!;
  }

  async list(ctx: RequestContext, projectId: string, q: RouteInput<R['listSnapshots']>['query']) {
    const p = await this.s.project(projectId);
    this.s.assertListable(ctx, projectId);
    const where = and(
      this.scopeSql(ctx, projectId),
      q.kind ? eq(T.kind, q.kind) : undefined,
      q.category ? eq(T.category, q.category) : undefined,
      q.period ? eq(T.period, q.period) : undefined,
      q.approvalState ? eq(T.approvalState, q.approvalState) : undefined,
      q.workstreamId ? eq(T.workstreamId, q.workstreamId) : undefined,
      q.lineRef ? eq(T.lineRef, q.lineRef) : undefined,
      q.q ? or(ilike(T.label, likeContains(q.q)), ilike(T.lineRef, likeContains(q.q))) : undefined,
    );
    const tx = this.s.db.tx();
    const [{ total }] = (await tx.select({ total: count() }).from(T).where(where)) as [{ total: number }];
    const order = orderBySort(
      q.sort,
      { lineRef: T.lineRef, period: T.period, kind: T.kind, category: T.category, approvalState: T.approvalState, updatedAt: T.updatedAt },
      T.id,
      [asc(T.lineRef), asc(T.period), asc(T.kind), asc(T.id)],
    );
    const rows = await tx.select().from(T).where(where).orderBy(...order).limit(q.pageSize).offset(offsetOf(q));
    return pageOf(
      rows.map((r) => this.dto(r, p)),
      Number(total),
      q,
    );
  }

  async loadReadable(ctx: RequestContext, projectId: string, id: string): Promise<SnapshotRow> {
    const r = await loadInProject(this.s.db, T, projectId, id);
    this.s.assertReadable(ctx, projectId, r);
    return r;
  }

  async approvalDto(p: ProjectRow, r: Pick<SnapshotRow, 'approvalState' | 'preparedBy' | 'validatedBy' | 'validatedAt' | 'validatedHash' | 'approvalRequestId' | 'approvalDecisionId' | 'approvedBy' | 'approvedAt'>, note: string | null, currentHash: string) {
    const req = await this.s.approvalRequest(p.id, r.approvalRequestId);
    return {
      state: r.approvalState,
      preparedBy: r.preparedBy,
      validatedBy: r.validatedBy,
      validatedAt: iso(r.validatedAt),
      validationNote: note,
      validationCurrent: !!r.validatedHash && r.validatedHash === currentHash,
      approvalRequestId: r.approvalRequestId,
      approvalRequestStatus: req?.status ?? null,
      approvalDecisionId: r.approvalDecisionId,
      approvedBy: r.approvedBy,
      approvedAt: iso(r.approvedAt),
      approvalDate: this.s.localDate(p, r.approvedAt),
    };
  }

  async get(ctx: RequestContext, projectId: string, id: string) {
    const r = await this.loadReadable(ctx, projectId, id);
    const p = await this.s.project(projectId);
    const recons = await this.recon.forSnapshot(ctx, projectId, r.id);
    return {
      ...this.dto(r, p),
      approval: await this.approvalDto(p, r, r.validationNote, contentHash(r)),
      reconciliations: recons,
      evidence: await this.s.evidenceShown(ctx, projectId, 'financial_snapshot', r.id),
      allowedCommands: allowedCommands(FIGURE_APPROVAL_MACHINE, r.approvalState).filter((c) => c !== 'invalidate' && c !== 'supersede'),
      people: await this.s.people([r.createdBy, r.preparedBy, r.validatedBy, r.approvedBy, ...recons.flatMap((x) => [x.preparedBy, x.reviewerUserId])]),
    };
  }

  // ---------------------------------------------------------------------------------------------------------
  // Write rules shared by create / import / update

  /**
   * Double counting guard (REQ-FIN-002): a line reference keeps ONE category, and a TSA is charged under one line
   * reference. Conflicts with rows the caller cannot see are reported without naming them (access-matrix §2.5).
   */
  private async assertConsistent(ctx: RequestContext, projectId: string, lines: { lineRef: string; category: FinancialCategory; tsaServiceId: string | null }[], excludeId?: string) {
    const refs = [...new Set(lines.map((l) => l.lineRef))];
    const tsas = [...new Set(lines.map((l) => l.tsaServiceId).filter((x): x is string => !!x))];
    const existing = await this.s.db
      .tx()
      .select({ id: T.id, lineRef: T.lineRef, category: T.category, tsaServiceId: T.tsaServiceId, classification: T.classification, workstreamId: T.workstreamId })
      .from(T)
      .where(and(eq(T.projectId, projectId), or(inArray(T.lineRef, refs), tsas.length ? inArray(T.tsaServiceId, tsas) : undefined)));
    const others = existing.filter((e) => e.id !== excludeId);
    const seen: { lineRef: string; category: FinancialCategory; tsaServiceId: string | null }[] = [];
    for (const l of lines) {
      try {
        assertLineConsistency(l, [...others, ...seen]);
      } catch (e) {
        const hidden = others.find((o) => (o.lineRef === l.lineRef || (l.tsaServiceId && o.tsaServiceId === l.tsaServiceId)) && !this.s.canRead(ctx, projectId, o));
        if (hidden) throw ruleViolation('finance.double_count.line_conflict', 'This line reference / TSA link conflicts with an existing figure (double counting); use a different line reference or contact Finance');
        throw e;
      }
      seen.push(l);
    }
  }

  private async assertNoDuplicate(projectId: string, rows: { kind: string; lineRef: string; period: string }[], excludeId?: string) {
    const existing = await this.s.db
      .tx()
      .select({ id: T.id, kind: T.kind, lineRef: T.lineRef, period: T.period })
      .from(T)
      .where(and(eq(T.projectId, projectId), inArray(T.lineRef, [...new Set(rows.map((r) => r.lineRef))])));
    const keys = new Set(existing.filter((e) => e.id !== excludeId).map((e) => `${e.kind}|${e.lineRef}|${e.period}`));
    const dup = rows.map((r, i) => ({ i, k: `${r.kind}|${r.lineRef}|${r.period}` })).filter((x) => keys.has(x.k));
    if (dup.length) {
      throw conflict('finance.snapshot.duplicate_line', 'A figure already exists for this line, kind and period — edit or reopen it instead of recording it again', { rows: dup.map((d) => d.i) });
    }
  }

  // ---------------------------------------------------------------------------------------------------------
  // Commands

  async create(ctx: RequestContext, projectId: string, body: RouteInput<R['createSnapshot']>['body']) {
    const p = await this.s.project(projectId);
    const classification = body.classification ?? FINANCE_DEFAULT_CLASSIFICATION.financial_snapshot;
    this.s.assertClassificationWritable(ctx, projectId, classification);
    this.s.assert(ctx, 'finance.budget.manage', { projectId, classification, workstreamId: body.workstreamId ?? null });
    const period = parseFinancialPeriod(body.period).period;
    const amount = parseMoney(body.amount);
    const tsaServiceId = body.tsaServiceId ?? null;
    assertSnapshotSource({ sourceType: 'manual_entry', sourceRef: body.sourceRef ?? null, sourceDocumentId: body.sourceDocumentId ?? null, sourceSheet: null, sourceCell: null });
    assertTsaLink(body.category, tsaServiceId);
    await this.s.workstream(projectId, body.workstreamId);
    await this.s.sourceDocument(ctx, projectId, body.sourceDocumentId, body.sourceDocumentVersionId);
    if (tsaServiceId) await this.s.tsa(ctx, projectId, tsaServiceId);
    await this.assertNoDuplicate(projectId, [{ kind: body.kind, lineRef: body.lineRef, period }]);
    await this.assertConsistent(ctx, projectId, [{ lineRef: body.lineRef, category: body.category, tsaServiceId }]);
    const id = newId();
    const [row] = await this.s.db
      .tx()
      .insert(T)
      .values({
        id,
        orgId: ctx.principal.orgId,
        projectId,
        kind: body.kind,
        category: body.category,
        lineRef: body.lineRef,
        label: body.label,
        period,
        amount: amount.amount,
        currency: amount.currency,
        unitScale: amount.unitScale,
        sourceType: 'manual_entry',
        sourceRef: body.sourceRef ?? null,
        sourceDocumentId: body.sourceDocumentId ?? null,
        sourceDocumentVersionId: body.sourceDocumentVersionId ?? null,
        tsaServiceId,
        workstreamId: body.workstreamId ?? null,
        classification,
        preparedBy: ctx.principal.userId,
        isDemo: p.isDemo,
        createdBy: ctx.principal.userId,
      })
      .returning();
    await this.s.snapshotVersion(projectId, 'financial_snapshot', row!, 'created');
    await this.s.audit.record({ action: 'finance.snapshot.create', entityType: 'financial_snapshot', entityId: id, projectId, after: { ...snapshotContent(row!), classification } });
    return { id, version: 1 };
  }

  /**
   * REQ-FIN-008: model outputs imported as figures; each keeps the source document (and version), sheet and cell. The
   * import is all-or-nothing and never overwrites an existing figure. The P6 import wizard calls this after approval.
   */
  async importRows(ctx: RequestContext, projectId: string, body: RouteInput<R['importSnapshots']>['body']) {
    const p = await this.s.project(projectId);
    const classification = body.classification ?? FINANCE_DEFAULT_CLASSIFICATION.financial_snapshot;
    this.s.assertClassificationWritable(ctx, projectId, classification);
    this.s.assert(ctx, 'finance.model.manage', { projectId, classification });
    await this.s.sourceDocument(ctx, projectId, body.sourceDocumentId, body.sourceDocumentVersionId);
    await this.s.importBatch(projectId, body.importBatchId);
    const rows = body.rows.map((r, i) => {
      try {
        const period = parseFinancialPeriod(r.period).period;
        const amount = parseMoney(r.amount);
        assertTsaLink(r.category, r.tsaServiceId ?? null);
        assertCellReference(r.cell);
        assertSnapshotSource({ sourceType: body.sourceType, sourceRef: body.sourceRef ?? null, sourceDocumentId: body.sourceDocumentId, sourceSheet: r.sheet ?? null, sourceCell: r.cell });
        return { ...r, period, amount, tsaServiceId: r.tsaServiceId ?? null, sheet: r.sheet ?? null };
      } catch (e) {
        if (e && typeof e === 'object' && 'details' in e) (e as { details?: Record<string, unknown> }).details = { ...((e as { details?: Record<string, unknown> }).details ?? {}), row: i };
        throw e;
      }
    });
    const keys = new Map<string, number>();
    rows.forEach((r, i) => {
      const k = `${r.kind}|${r.lineRef}|${r.period}`;
      if (keys.has(k)) throw invalid('finance.import.duplicate_row', `Rows ${keys.get(k)} and ${i} record the same line, kind and period`, { rows: [keys.get(k), i] });
      keys.set(k, i);
    });
    for (const r of rows) {
      await this.s.workstream(projectId, r.workstreamId);
      if (r.tsaServiceId) await this.s.tsa(ctx, projectId, r.tsaServiceId);
    }
    await this.assertNoDuplicate(projectId, rows);
    await this.assertConsistent(ctx, projectId, rows.map((r) => ({ lineRef: r.lineRef, category: r.category, tsaServiceId: r.tsaServiceId })));
    const values = rows.map((r) => ({
      id: newId(),
      orgId: ctx.principal.orgId,
      projectId,
      kind: r.kind,
      category: r.category,
      lineRef: r.lineRef,
      label: r.label,
      period: r.period,
      amount: r.amount.amount,
      currency: r.amount.currency,
      unitScale: r.amount.unitScale,
      sourceType: body.sourceType,
      sourceRef: body.sourceRef ?? null,
      sourceDocumentId: body.sourceDocumentId,
      sourceDocumentVersionId: body.sourceDocumentVersionId ?? null,
      sourceSheet: r.sheet,
      sourceCell: r.cell,
      importBatchId: body.importBatchId ?? null,
      tsaServiceId: r.tsaServiceId,
      workstreamId: r.workstreamId ?? null,
      classification,
      preparedBy: ctx.principal.userId,
      isDemo: p.isDemo,
      createdBy: ctx.principal.userId,
    }));
    const inserted = await this.s.db.tx().insert(T).values(values).returning();
    for (const row of inserted) await this.s.snapshotVersion(projectId, 'financial_snapshot', row, 'imported');
    await this.s.audit.record({
      action: 'finance.snapshot.import',
      entityType: 'document',
      entityId: body.sourceDocumentId,
      projectId,
      after: {
        count: inserted.length,
        sourceDocumentId: body.sourceDocumentId,
        sourceDocumentVersionId: body.sourceDocumentVersionId ?? null,
        importBatchId: body.importBatchId ?? null,
        rows: inserted.slice(0, 100).map((r) => ({ id: r.id, lineRef: r.lineRef, kind: r.kind, period: r.period, sheet: r.sourceSheet, cell: r.sourceCell })),
      },
    });
    return { items: inserted.map((r) => ({ id: r.id, lineRef: r.lineRef, kind: r.kind, period: r.period, sourceSheet: r.sourceSheet, sourceCell: r.sourceCell! })) };
  }

  async update(ctx: RequestContext, projectId: string, id: string, body: RouteInput<R['updateSnapshot']>['body']) {
    const r = await loadInProject(this.s.db, T, projectId, id);
    this.s.assert(ctx, 'finance.budget.manage', { projectId, classification: r.classification, workstreamId: r.workstreamId });
    const changes: Partial<SnapshotRow> = {};
    if (body.label !== undefined && body.label !== r.label) changes.label = body.label;
    if (body.amount !== undefined) {
      const m = parseMoney(body.amount);
      if (m.amount !== r.amount || m.currency !== r.currency || m.unitScale !== r.unitScale) Object.assign(changes, { amount: m.amount, currency: m.currency, unitScale: m.unitScale });
    }
    for (const k of ['sourceRef', 'sourceDocumentId', 'sourceDocumentVersionId', 'workstreamId'] as const) {
      if (body[k] !== undefined && (body[k] ?? null) !== r[k]) (changes as Record<string, unknown>)[k] = body[k] ?? null;
    }
    if (body.classification !== undefined && body.classification !== r.classification) {
      assertNotDeclassified(r.classification, body.classification, 'a financial figure');
      this.s.assertClassificationWritable(ctx, projectId, body.classification);
      changes.classification = body.classification;
    }
    if (Object.keys(changes).length === 0) {
      assertVersion(r, body.expectedVersion, 'figure');
      return { id: r.id, approvalState: r.approvalState, version: r.version };
    }
    if (r.approvalState === 'approved') throw ruleViolation('finance.snapshot.locked', 'An approved figure is locked: reopen it (with a reason) before changing it');
    if (r.approvalState === 'superseded') throw ruleViolation('finance.snapshot.locked', 'A superseded figure cannot change');
    const contentKeys = ['label', 'amount', 'currency', 'unitScale', 'sourceRef', 'sourceDocumentId', 'sourceDocumentVersionId'];
    const contentChanged = Object.keys(changes).some((k) => contentKeys.includes(k));
    if (contentChanged && r.sourceType !== 'manual_entry') {
      throw ruleViolation('finance.snapshot.imported_locked', 'An imported figure keeps the value and source of its model output: import the corrected output instead of editing it');
    }
    if (changes.workstreamId) {
      await this.s.workstream(projectId, changes.workstreamId);
      this.s.assert(ctx, 'finance.budget.manage', { projectId, classification: r.classification, workstreamId: changes.workstreamId });
    }
    if (changes.sourceDocumentId !== undefined || changes.sourceDocumentVersionId !== undefined) {
      await this.s.sourceDocument(ctx, projectId, (changes.sourceDocumentId !== undefined ? changes.sourceDocumentId : r.sourceDocumentId) ?? null, (changes.sourceDocumentVersionId !== undefined ? changes.sourceDocumentVersionId : r.sourceDocumentVersionId) ?? null);
    }
    const merged = { ...r, ...changes } as SnapshotRow;
    assertSnapshotSource({ sourceType: merged.sourceType, sourceRef: merged.sourceRef, sourceDocumentId: merged.sourceDocumentId, sourceSheet: merged.sourceSheet, sourceCell: merged.sourceCell });
    const values: Record<string, unknown> = { ...changes };
    let reason = 'updated';
    if (contentChanged) {
      values['preparedBy'] = ctx.principal.userId;
      if (r.approvalState === 'under_review' || r.approvalState === 'rejected') {
        // The validation no longer covers the content: back to proposed, pending approval request invalidated.
        values['approvalState'] = r.approvalState === 'under_review' ? transition('figure', FIGURE_APPROVAL_MACHINE, r.approvalState, 'invalidate') : 'proposed';
        Object.assign(values, { validatedBy: null, validatedAt: null, validationNote: null, validatedHash: null, approvalRequestId: null });
        await this.s.closeApprovalRequest(ctx, projectId, r.approvalRequestId, 'invalidate', null, 'content changed after validation');
        reason = 'updated — validation invalidated';
      }
    }
    const row = (await updateVersioned(this.s.db, T, { id: r.id, projectId, expectedVersion: body.expectedVersion }, values)) as SnapshotRow;
    await this.s.snapshotVersion(projectId, 'financial_snapshot', row, reason);
    const cur = r as unknown as Record<string, unknown>;
    await this.s.audit.record({
      action: 'finance.snapshot.update',
      entityType: 'financial_snapshot',
      entityId: r.id,
      projectId,
      before: Object.fromEntries(Object.keys(values).map((k) => [k, cur[k]])),
      after: values,
      reason,
    });
    return { id: r.id, approvalState: row.approvalState, version: row.version };
  }

  /** REQ-FIN-010: human financial validation (never the preparer, never a service identity) → approval request. */
  async validate(ctx: RequestContext, projectId: string, id: string, body: { expectedVersion: number; note: string }) {
    const r = await loadInProject(this.s.db, T, projectId, id);
    // Validation / rejection is a role-level Finance act (separation of duties still applies); approval authority is
    // evaluated where the figure is approved.
    this.s.assert(ctx, 'finance.snapshot.approve', { projectId, classification: r.classification, workstreamId: r.workstreamId, requesterUserId: r.preparedBy, withinAuthority: true });
    const hash = contentHash(r);
    assertFigureValidatable({ state: r.approvalState, createdBy: r.createdBy, preparedBy: r.preparedBy, validatedBy: r.validatedBy, validatedHash: r.validatedHash, currentHash: hash }, actorOf(ctx), describe(r));
    assertVersion(r, body.expectedVersion, 'figure');
    const requestId = await this.s.openApprovalRequest(ctx, projectId, {
      subjectType: 'financial_snapshot',
      subjectId: r.id,
      subjectVersion: r.version + 1,
      payload: { content: snapshotContent(r), contentHash: hash, validatedBy: ctx.principal.userId },
      note: `Approval of ${describe(r)} — validated`,
    });
    const to = transition('figure', FIGURE_APPROVAL_MACHINE, r.approvalState, 'validate');
    const row = (await updateVersioned(this.s.db, T, { id: r.id, projectId, expectedVersion: body.expectedVersion }, {
      approvalState: to,
      validatedBy: ctx.principal.userId,
      validatedAt: this.s.clock.now(),
      validationNote: body.note,
      validatedHash: hash,
      approvalRequestId: requestId,
    })) as SnapshotRow;
    await this.s.snapshotVersion(projectId, 'financial_snapshot', row, 'validated');
    await this.s.audit.record({ action: 'finance.snapshot.validate', entityType: 'financial_snapshot', entityId: r.id, projectId, before: { approvalState: r.approvalState }, after: { approvalState: to, validatedHash: hash, approvalRequestId: requestId }, reason: body.note });
    return { id: r.id, approvalState: row.approvalState, version: row.version, approvalRequestId: requestId };
  }

  /**
   * REQ-FIN-010: approval of a VALIDATED figure by a third person. Opening balances are approved by the authorized body:
   * a FINAL governance decision of type opening_balance_sheet is mandatory (never invented).
   */
  async approve(ctx: RequestContext, projectId: string, id: string, body: { expectedVersion: number; decisionId?: string; note?: string }) {
    const r = await loadInProject(this.s.db, T, projectId, id);
    // RBAC first (a caller without the permission learns nothing more), then the separation / authority conditions.
    this.s.assertGranted(ctx, 'finance.snapshot.approve', { projectId, classification: r.classification, workstreamId: r.workstreamId });
    const needsDecision = r.category === 'opening_balance';
    const allowed = needsDecision ? OPENING_BALANCE_DECISION_TYPE_KEYS : [...OPENING_BALANCE_DECISION_TYPE_KEYS, ...BUDGET_DECISION_TYPE_KEYS];
    if (needsDecision && !body.decisionId) {
      throw ruleViolation('finance.approval.decision_required', 'An opening balance is approved by the authorized body: link its final opening_balance_sheet governance decision');
    }
    const d = body.decisionId ? await this.s.decision(ctx, projectId, body.decisionId) : null;
    if (d) {
      const issue = this.s.decisionIssue(d, allowed, `the approval of ${describe(r)}`);
      if (issue.issue) throw ruleViolation('finance.approval.decision_not_final', issue.issue, { decisionId: d.id, issueCode: issue.code });
      // DOM-P4-08: an external approval counts only while its evidence is an active link verified by a second person
      // (422 finance.approval.decision_evidence_invalid). The approval relies on the decision without consuming it (no
      // registry kind for figures yet — docs/architecture/module-guide.md, "Relying on a governance decision").
      await assertCurrentDecisionReliance(this.s.db, projectId, d, { use: { kind: null, subjectType: 'financial_snapshot', subjectId: r.id }, subjectRule: 'none', decisionTypeKeys: allowed, codePrefix: 'finance.approval' });
    }
    const withinAuthority = d ? true : this.s.policy.permissionReach(ctx, 'finance.snapshot.approve', projectId).all;
    this.s.assert(ctx, 'finance.snapshot.approve', { projectId, classification: r.classification, workstreamId: r.workstreamId, requesterUserId: r.preparedBy, withinAuthority });
    assertFigureApprovable({ state: r.approvalState, createdBy: r.createdBy, preparedBy: r.preparedBy, validatedBy: r.validatedBy, validatedHash: r.validatedHash, currentHash: contentHash(r) }, actorOf(ctx), describe(r));
    assertVersion(r, body.expectedVersion, 'figure');
    const req = await this.s.approvalRequest(projectId, r.approvalRequestId);
    if (!req || req.status !== 'pending') throw ruleViolation('finance.approval.not_requested', 'No pending approval request exists for this figure: validate it first');
    const to = transition('figure', FIGURE_APPROVAL_MACHINE, r.approvalState, 'approve');
    const row = (await updateVersioned(this.s.db, T, { id: r.id, projectId, expectedVersion: body.expectedVersion }, {
      approvalState: to,
      approvedBy: ctx.principal.userId,
      approvedAt: this.s.clock.now(),
      approvalDecisionId: d?.id ?? null,
    })) as SnapshotRow;
    await this.s.closeApprovalRequest(ctx, projectId, r.approvalRequestId, 'approve', body.note ?? null, d ? `governance decision ${d.code} (${d.decisionTypeKey})` : 'finance.snapshot.approve (policy matrix, project-wide grant)');
    await this.s.snapshotVersion(projectId, 'financial_snapshot', row, 'approved');
    await this.s.audit.record({
      action: 'finance.snapshot.approve',
      entityType: 'financial_snapshot',
      entityId: r.id,
      projectId,
      before: { approvalState: r.approvalState },
      after: { approvalState: to, validatedBy: r.validatedBy, decisionId: d?.id ?? null, decisionCode: d?.code ?? null, contentHash: r.validatedHash },
      reason: body.note ?? null,
    });
    return { id: r.id, approvalState: row.approvalState, version: row.version };
  }

  async reject(ctx: RequestContext, projectId: string, id: string, body: { expectedVersion: number; note: string }) {
    const r = await loadInProject(this.s.db, T, projectId, id);
    // Validation / rejection is a role-level Finance act (separation of duties still applies); approval authority is
    // evaluated where the figure is approved.
    this.s.assert(ctx, 'finance.snapshot.approve', { projectId, classification: r.classification, workstreamId: r.workstreamId, requesterUserId: r.preparedBy, withinAuthority: true });
    assertHumanActor(actorOf(ctx), 'Rejecting a figure');
    return this.applyState(ctx, r, 'reject', body.expectedVersion, {}, body.note, async () => this.s.closeApprovalRequest(ctx, projectId, r.approvalRequestId, 'reject', body.note, 'finance.snapshot.approve (policy matrix)'));
  }

  async reopen(ctx: RequestContext, projectId: string, id: string, body: { expectedVersion: number; note: string }) {
    const r = await loadInProject(this.s.db, T, projectId, id);
    // Reopening is a role-level act (audited with a reason); the figure then needs a fresh validation and approval.
    this.s.assertGranted(ctx, 'finance.snapshot.approve', { projectId, classification: r.classification, workstreamId: r.workstreamId });
    assertHumanActor(actorOf(ctx), 'Reopening an approved figure');
    return this.applyState(ctx, r, 'reopen', body.expectedVersion, {
      validatedBy: null,
      validatedAt: null,
      validationNote: null,
      validatedHash: null,
      approvalRequestId: null,
      approvalDecisionId: null,
      approvedBy: null,
      approvedAt: null,
    }, body.note);
  }

  private async applyState(ctx: RequestContext, r: SnapshotRow, cmd: FigureCommand, expectedVersion: number, values: Record<string, unknown>, reason: string, after?: () => Promise<void>) {
    const to: ApprovalState = transition('figure', FIGURE_APPROVAL_MACHINE, r.approvalState, cmd);
    assertVersion(r, expectedVersion, 'figure');
    const row = (await updateVersioned(this.s.db, T, { id: r.id, projectId: r.projectId, expectedVersion }, { approvalState: to, ...values })) as SnapshotRow;
    if (after) await after();
    await this.s.snapshotVersion(r.projectId, 'financial_snapshot', row, cmd);
    await this.s.audit.record({ action: `finance.snapshot.${cmd}`, entityType: 'financial_snapshot', entityId: r.id, projectId: r.projectId, before: { approvalState: r.approvalState, approvedBy: r.approvedBy }, after: { approvalState: to }, reason });
    void ctx;
    return { id: r.id, approvalState: row.approvalState, version: row.version };
  }

  // ---------------------------------------------------------------------------------------------------------
  // Aggregation (REQ-DAT-004 / AT-29)

  /**
   * Adds up visible figures of ONE kind. Mixed currencies are rejected without an explicit conversion basis per currency
   * (rate, source, date — supplied by the caller, never invented), mixed unit scales without an explicit normalization;
   * the result shows its basis. Submitted ids outside the caller's visibility are 404 (existence not leaked).
   */
  async aggregate(ctx: RequestContext, projectId: string, body: RouteInput<R['aggregateFigures']>['body']) {
    this.s.assertListable(ctx, projectId);
    if (!body.snapshotIds && !body.kind) throw invalid('finance.aggregate.selection_required', 'Select the figures: snapshotIds or a kind (with optional filters)');
    const tx = this.s.db.tx();
    let rows: SnapshotRow[];
    if (body.snapshotIds) {
      const ids = [...new Set(body.snapshotIds)];
      rows = await tx.select().from(T).where(and(this.scopeSql(ctx, projectId), inArray(T.id, ids)));
      // A selected id that is not a visible figure of this project is indistinguishable from a missing one (404).
      if (rows.length !== ids.length) throw notFound();
    } else {
      rows = await tx
        .select()
        .from(T)
        .where(
          and(
            this.scopeSql(ctx, projectId),
            eq(T.kind, body.kind!),
            body.category ? eq(T.category, body.category) : undefined,
            body.period ? eq(T.period, body.period) : undefined,
            body.approvalState ? eq(T.approvalState, body.approvalState) : undefined,
            body.workstreamId ? eq(T.workstreamId, body.workstreamId) : undefined,
          ),
        )
        .orderBy(asc(T.lineRef), asc(T.period), asc(T.id))
        .limit(5001);
      if (rows.length > 5000) throw invalid('finance.aggregate.too_many', 'More than 5000 figures match: narrow the selection');
    }
    const r = aggregateFigures(
      rows.map((x) => ({ kind: x.kind, money: money(x.amount, x.currency, x.unitScale) })),
      { targetCurrency: body.targetCurrency, targetUnitScale: body.targetUnitScale, normalizeUnits: body.normalizeUnits, conversions: body.conversions },
    );
    return {
      total: money(r.total.amount, r.total.currency, r.total.unitScale),
      count: r.count,
      kind: (r.kind as SnapshotRow['kind'] | null) ?? body.kind ?? null,
      basis: r.basisText,
      basisI18n: r.basis,
      conversions: r.conversions,
      normalizedUnitScales: r.normalizedUnitScales,
      items: rows.slice(0, 200).map((x) => ({ id: x.id, lineRef: x.lineRef, label: x.label, period: x.period, kind: x.kind, amount: money(x.amount, x.currency, x.unitScale) })),
    };
  }

  /** Classification rank helper for callers that inherit a figure's classification. */
  static atLeast(a: Classification, b: Classification): Classification {
    return rank(a) >= rank(b) ? a : b;
  }
}
