import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, inArray, or, sql, SQL } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { schema } from '@hub/db';
import {
  applyAssumptionChanges,
  assertFigureApprovable,
  assertFigureValidatable,
  assertHumanActor,
  assertNotDeclassified,
  assertOutputs,
  compareOutputs,
  conflict,
  invalid,
  notFound,
  outputFindings,
  parseMoney,
  ruleViolation,
  transition,
  FIGURE_APPROVAL_MACHINE,
  FINANCE_DEFAULT_CLASSIFICATION,
  VALUATION_DECISION_TYPE_KEYS,
  Assumption,
  Classification,
  ModelOutput,
} from '@hub/domain';
import type { RouteInput, financeRoutes } from '@hub/contracts';
import type { RequestContext } from '../../platform/context';
import { assertVersion, likeContains, loadInProject, nextCode, offsetOf, pageOf, updateVersioned } from '../../platform/helpers';
import { orderBySort } from '../../platform/sort';
import { newId, payloadHash } from '../../platform/ids';
import { assertCurrentDecisionReliance, lockDecisionAndRecheck, registerDecisionUse, type RelianceRule } from '../governance/decision-reliance';
import { FinanceSupport, messagesOf } from './finance.support';
import { SnapshotsService } from './snapshots.service';

type ModelRow = typeof schema.financialModel.$inferSelect;
type VersionRow = typeof schema.financialModelVersion.$inferSelect;
const M = schema.financialModel;
const V = schema.financialModelVersion;
type R = typeof financeRoutes;
const actorOf = (ctx: RequestContext) => ({ kind: ctx.principal.kind, userId: ctx.principal.userId });

type OutputInput = NonNullable<RouteInput<R['createModelVersion']>['body']['outputs']>[number];

/** The content a validation / approval binds to (versions are frozen, so this never changes after insert). */
function versionContent(v: VersionRow) {
  return {
    modelId: v.modelId,
    modelCase: v.modelCase,
    versionNo: v.versionNo,
    assumptions: v.assumptions,
    outputs: v.outputs,
    headlineBasis: v.headlineBasis,
    sourceType: v.sourceType,
    sourceDocumentId: v.sourceDocumentId,
    sourceDocumentVersionId: v.sourceDocumentVersionId,
    sourceRef: v.sourceRef,
  };
}
const contentHash = (v: VersionRow) => payloadHash(versionContent(v));
const describe = (m: Pick<ModelRow, 'code'>, v: Pick<VersionRow, 'modelCase' | 'versionNo'>) => `${m.code} ${v.modelCase} v${v.versionNo}`;

function normalizeOutput(o: OutputInput): ModelOutput {
  const measure = o.measure ?? 'money';
  if (measure === 'money') {
    if (!o.currency || !o.unitScale) throw invalid('finance.output.money_unit_required', `Output ${o.key}: a money value needs its currency and unit scale`, { key: o.key });
    const m = parseMoney({ amount: o.amount, currency: o.currency, unitScale: o.unitScale });
    return { key: o.key, label: o.label, measure, amount: m.amount, currency: m.currency, unitScale: m.unitScale, basis: o.basis, sheet: o.sheet ?? null, cell: o.cell ?? null };
  }
  return { key: o.key, label: o.label, measure, amount: new Decimal(o.amount).toFixed(4), currency: o.currency ?? null, unitScale: o.unitScale ?? null, basis: o.basis, sheet: o.sheet ?? null, cell: o.cell ?? null };
}

/**
 * Business plans and valuation cases (REQ-FIN-005..008, REQ-FIN-010). A version is frozen at creation (database guard):
 * a change is a NEW version that starts from the prior version's assumptions, so prior assumptions are preserved.
 * Proposed values are the outputs; approved values stay EMPTY until an approval is recorded from a FINAL governance
 * decision (valuation_and_ownership_terms) on a version validated by a human Finance user. Not a valuation engine.
 */
@Injectable()
export class ModelsService {
  constructor(
    private readonly s: FinanceSupport,
    private readonly snapshots: SnapshotsService,
  ) {}

  // ---------------------------------------------------------------------------------------------------------
  // Reads

  private summary(v: VersionRow) {
    return {
      id: v.id,
      modelId: v.modelId,
      versionNo: v.versionNo,
      versionLabel: v.versionLabel,
      modelCase: v.modelCase,
      approvalState: v.approvalState,
      basedOnVersionId: v.basedOnVersionId,
      supersededById: v.supersededById,
      sourceType: v.sourceType,
      hasApprovedValues: v.approvedValues !== null,
      isDemo: v.isDemo,
      createdAt: v.createdAt.toISOString(),
      createdBy: v.createdBy,
    };
  }

  private modelDto(m: ModelRow, versions: VersionRow[]) {
    const latest = new Map<string, VersionRow>();
    for (const v of versions) if (v.modelId === m.id && (!latest.has(v.modelCase) || latest.get(v.modelCase)!.versionNo < v.versionNo)) latest.set(v.modelCase, v);
    return {
      id: m.id,
      code: m.code,
      kind: m.kind,
      name: m.name,
      description: m.description,
      classification: m.classification,
      isDemo: m.isDemo,
      createdAt: m.createdAt.toISOString(),
      createdBy: m.createdBy,
      version: m.version,
      latest: (['base', 'downside', 'upside'] as const)
        .filter((c) => latest.has(c))
        .map((c) => {
          const v = latest.get(c)!;
          return { modelCase: c, versionId: v.id, versionNo: v.versionNo, versionLabel: v.versionLabel, approvalState: v.approvalState };
        }),
    };
  }

  scopeSql(ctx: RequestContext, projectId: string): SQL {
    return and(eq(M.projectId, projectId), this.s.visibleSql(ctx, projectId, { classification: M.classification }))!;
  }

  async list(ctx: RequestContext, projectId: string, q: RouteInput<R['listModels']>['query']) {
    this.s.assertListable(ctx, projectId);
    const where = and(this.scopeSql(ctx, projectId), q.kind ? eq(M.kind, q.kind) : undefined, q.q ? or(ilike(M.name, likeContains(q.q)), ilike(M.code, likeContains(q.q))) : undefined);
    const tx = this.s.db.tx();
    const [{ total }] = (await tx.select({ total: count() }).from(M).where(where)) as [{ total: number }];
    const order = orderBySort(q.sort, { code: M.code, name: M.name, kind: M.kind, updatedAt: M.updatedAt }, M.id, [asc(M.code), asc(M.id)]);
    const rows = await tx.select().from(M).where(where).orderBy(...order).limit(q.pageSize).offset(offsetOf(q));
    const versions = rows.length ? await tx.select().from(V).where(and(eq(V.projectId, projectId), inArray(V.modelId, rows.map((r) => r.id)))) : [];
    return pageOf(
      rows.map((m) => this.modelDto(m, versions)),
      Number(total),
      q,
    );
  }

  private async loadModel(ctx: RequestContext, projectId: string, modelId: string): Promise<ModelRow> {
    const m = await loadInProject(this.s.db, M, projectId, modelId);
    this.s.assertReadable(ctx, projectId, m);
    return m;
  }

  /** A version of THIS model (404 otherwise) that the caller may read. */
  private async loadVersion(ctx: RequestContext, projectId: string, modelId: string, versionId: string): Promise<{ m: ModelRow; v: VersionRow }> {
    const m = await this.loadModel(ctx, projectId, modelId);
    const v = await loadInProject(this.s.db, V, projectId, versionId);
    if (v.modelId !== m.id) throw notFound();
    this.s.assertReadable(ctx, projectId, v);
    return { m, v };
  }

  async get(ctx: RequestContext, projectId: string, modelId: string) {
    const m = await this.loadModel(ctx, projectId, modelId);
    const versions = await this.s.db.tx().select().from(V).where(and(eq(V.projectId, projectId), eq(V.modelId, m.id))).orderBy(asc(V.modelCase), desc(V.versionNo));
    return { ...this.modelDto(m, versions), versions: versions.map((v) => this.summary(v)), people: await this.s.people([m.createdBy, ...versions.map((v) => v.createdBy)]) };
  }

  private diffFrom(v: VersionRow, prior: VersionRow | null) {
    if (!prior) return null;
    const before = new Map(prior.assumptions.map((a) => [a.key, a]));
    const after = new Map(v.assumptions.map((a) => [a.key, a]));
    const added = [...after.keys()].filter((k) => !before.has(k));
    const removed = [...before.keys()].filter((k) => !after.has(k));
    const changed = [...after.keys()].filter((k) => {
      const b = before.get(k);
      const a = after.get(k)!;
      return !!b && (b.value !== a.value || (b.unit ?? null) !== (a.unit ?? null) || (b.source ?? null) !== (a.source ?? null));
    });
    return { added, changed, removed };
  }

  async getVersion(ctx: RequestContext, projectId: string, modelId: string, versionId: string) {
    const { v } = await this.loadVersion(ctx, projectId, modelId, versionId);
    const p = await this.s.project(projectId);
    const prior = v.basedOnVersionId ? await loadInProject(this.s.db, V, projectId, v.basedOnVersionId) : null;
    const findings = messagesOf(outputFindings(v.outputs));
    return {
      ...this.summary(v),
      kind: v.kind,
      frozen: true as const,
      assumptions: v.assumptions.map((a) => ({ key: a.key, value: a.value, unit: a.unit ?? null, source: a.source ?? null })),
      outputs: v.outputs,
      headlineBasis: v.headlineBasis,
      sourceDocumentId: v.sourceDocumentId,
      sourceDocumentVersionId: v.sourceDocumentVersionId,
      sourceRef: v.sourceRef,
      importBatchId: v.importBatchId,
      changeNote: v.changeNote,
      diffFromBasedOn: this.diffFrom(v, prior),
      approval: await this.snapshots.approvalDto(p, v, v.humanValidationNote, contentHash(v)),
      approvedValues: v.approvedValues,
      findings: findings.en,
      findingsI18n: findings.i18n,
      classification: v.classification,
      version: v.version,
      people: await this.s.people([v.createdBy, v.preparedBy, v.validatedBy, v.approvedBy]),
    };
  }

  /** REQ-FIN-007: EV / equity / currency / unit consistency, optionally against another version (never a valuation). */
  async check(ctx: RequestContext, projectId: string, modelId: string, versionId: string, body: RouteInput<R['checkModelVersion']>['body']) {
    const { v } = await this.loadVersion(ctx, projectId, modelId, versionId);
    const own = messagesOf(outputFindings(v.outputs));
    if (!body.compareToVersionId) return { findings: own.en, findingsI18n: own.i18n, comparison: null };
    const other = await loadInProject(this.s.db, V, projectId, body.compareToVersionId);
    const otherModel = await loadInProject(this.s.db, M, projectId, other.modelId);
    this.s.assertReadable(ctx, projectId, otherModel);
    this.s.assertReadable(ctx, projectId, other);
    const cmp = compareOutputs(v.outputs, other.outputs, body.conversions ?? []);
    const all = messagesOf(cmp.findings);
    return {
      findings: all.en,
      findingsI18n: all.i18n,
      comparison: {
        compareToVersionId: other.id,
        rows: cmp.rows.map((r) => {
          const n = messagesOf(r.messages);
          return { key: r.key, label: r.label, status: r.status, a: r.a, b: r.b, difference: r.difference, notes: n.en, notesI18n: n.i18n };
        }),
      },
    };
  }

  // ---------------------------------------------------------------------------------------------------------
  // Commands

  async create(ctx: RequestContext, projectId: string, body: RouteInput<R['createModel']>['body']) {
    const p = await this.s.project(projectId);
    const classification = body.classification ?? (body.kind === 'valuation' ? FINANCE_DEFAULT_CLASSIFICATION.valuation : FINANCE_DEFAULT_CLASSIFICATION.business_plan);
    this.s.assertClassificationWritable(ctx, projectId, classification);
    this.s.assert(ctx, 'finance.model.manage', { projectId, classification });
    const id = newId();
    const code = await nextCode(this.s.db, M, projectId, 'FM');
    const [row] = await this.s.db
      .tx()
      .insert(M)
      .values({ id, orgId: ctx.principal.orgId, projectId, code, kind: body.kind, name: body.name, description: body.description ?? null, classification, isDemo: p.isDemo, createdBy: ctx.principal.userId })
      .returning();
    await this.s.snapshotVersion(projectId, 'financial_model', row!, 'created');
    await this.s.audit.record({ action: 'finance.model.create', entityType: 'financial_model', entityId: id, projectId, after: { code, kind: body.kind, name: body.name, classification } });
    return { id, code, version: 1 };
  }

  async update(ctx: RequestContext, projectId: string, modelId: string, body: RouteInput<R['updateModel']>['body']) {
    const m = await loadInProject(this.s.db, M, projectId, modelId);
    this.s.assert(ctx, 'finance.model.manage', { projectId, classification: m.classification });
    const changes: Record<string, unknown> = {};
    if (body.name !== undefined && body.name !== m.name) changes['name'] = body.name;
    if (body.description !== undefined && (body.description ?? null) !== m.description) changes['description'] = body.description ?? null;
    if (body.classification !== undefined && body.classification !== m.classification) {
      assertNotDeclassified(m.classification, body.classification, 'a financial model');
      this.s.assertClassificationWritable(ctx, projectId, body.classification);
      changes['classification'] = body.classification;
    }
    if (Object.keys(changes).length === 0) {
      assertVersion(m, body.expectedVersion, 'model');
      return { id: m.id, version: m.version };
    }
    const row = (await updateVersioned(this.s.db, M, { id: m.id, projectId, expectedVersion: body.expectedVersion }, changes)) as ModelRow;
    // The versions carry the model's classification (lists and retrieval filter on it).
    if (changes['classification']) await this.s.db.tx().update(V).set({ classification: changes['classification'] as Classification }).where(and(eq(V.projectId, projectId), eq(V.modelId, m.id)));
    await this.s.snapshotVersion(projectId, 'financial_model', row, 'updated');
    const cur = m as unknown as Record<string, unknown>;
    await this.s.audit.record({ action: 'finance.model.update', entityType: 'financial_model', entityId: m.id, projectId, before: Object.fromEntries(Object.keys(changes).map((k) => [k, cur[k]])), after: changes });
    return { id: m.id, version: row.version };
  }

  /**
   * REQ-FIN-005 / REQ-FIN-008: a new version of one case. It starts from the prior version's assumptions (the latest of
   * the case unless another prior version is named) and applies explicit changes; the prior version is left untouched
   * (frozen) and marked as superseded. Imported versions keep the source document and each output's sheet/cell.
   */
  async createVersion(ctx: RequestContext, projectId: string, modelId: string, body: RouteInput<R['createModelVersion']>['body'] & { importBatchId?: string }, imported: boolean) {
    const p = await this.s.project(projectId);
    const m = await loadInProject(this.s.db, M, projectId, modelId);
    this.s.assert(ctx, 'finance.model.manage', { projectId, classification: m.classification });
    // Serialize version numbering per model and case.
    await this.s.db.query(`select pg_advisory_xact_lock(hashtextextended('hub_fin_model_version:' || $1 || ':' || $2, 0))`, [m.id, body.modelCase]);
    const [latest] = await this.s.db
      .tx()
      .select()
      .from(V)
      .where(and(eq(V.projectId, projectId), eq(V.modelId, m.id), eq(V.modelCase, body.modelCase)))
      .orderBy(desc(V.versionNo))
      .limit(1);
    let basedOn: VersionRow | null = latest ?? null;
    if (body.basedOnVersionId) {
      const b = await loadInProject(this.s.db, V, projectId, body.basedOnVersionId);
      if (b.modelId !== m.id || b.modelCase !== body.modelCase) throw invalid('finance.model.based_on_mismatch', 'The prior version must be a version of the same model and case');
      if (latest && b.id !== latest.id) throw conflict('finance.model.not_latest', `A newer version (v${latest.versionNo}) of this case exists: derive the new version from it`, { latestVersionId: latest.id });
      basedOn = b;
    }
    const { assumptions, diff } = applyAssumptionChanges((basedOn?.assumptions ?? []) as Assumption[], body.assumptionChanges ?? {});
    const outputs = body.outputs.map(normalizeOutput);
    assertOutputs(outputs, { requireCellReferences: imported });
    if (m.kind === 'valuation' && !body.headlineBasis) {
      throw invalid('finance.model.headline_basis_required', 'A valuation version states whether its headline value is enterprise value or equity value (the platform never guesses)');
    }
    if (!body.sourceDocumentId && !body.sourceRef?.trim()) throw invalid('finance.source.required', 'A model version needs its source: the original model document or a source reference');
    await this.s.sourceDocument(ctx, projectId, body.sourceDocumentId, body.sourceDocumentVersionId);
    await this.s.importBatch(projectId, body.importBatchId);
    const id = newId();
    const versionNo = (latest?.versionNo ?? 0) + 1;
    const [row] = await this.s.db
      .tx()
      .insert(V)
      .values({
        id,
        orgId: ctx.principal.orgId,
        projectId,
        modelId: m.id,
        kind: m.kind,
        versionNo,
        versionLabel: body.versionLabel,
        modelCase: body.modelCase,
        basedOnVersionId: basedOn?.id ?? null,
        assumptions,
        outputs,
        headlineBasis: body.headlineBasis ?? null,
        sourceType: imported ? 'excel' : 'manual_entry',
        sourceDocumentId: body.sourceDocumentId ?? null,
        sourceDocumentVersionId: body.sourceDocumentVersionId ?? null,
        sourceRef: body.sourceRef ?? null,
        importBatchId: body.importBatchId ?? null,
        changeNote: body.changeNote ?? null,
        preparedBy: ctx.principal.userId,
        classification: m.classification,
        isDemo: p.isDemo,
        createdBy: ctx.principal.userId,
      })
      .returning();
    if (basedOn) {
      // The prior version is frozen as recorded; an unapproved one can no longer be approved (superseded).
      const values: Record<string, unknown> = { supersededById: id };
      if (FIGURE_APPROVAL_MACHINE.supersede.from.includes(basedOn.approvalState)) {
        values['approvalState'] = transition('figure', FIGURE_APPROVAL_MACHINE, basedOn.approvalState, 'supersede');
        await this.s.closeApprovalRequest(ctx, projectId, basedOn.approvalRequestId, 'invalidate', null, 'superseded by a newer version');
      }
      if (!basedOn.supersededById) {
        const prev = (await updateVersioned(this.s.db, V, { id: basedOn.id, projectId, expectedVersion: basedOn.version }, values)) as VersionRow;
        await this.s.snapshotVersion(projectId, 'financial_model_version', prev, 'superseded');
      }
    }
    await this.s.snapshotVersion(projectId, 'financial_model_version', row!, imported ? 'imported' : 'created');
    await this.s.audit.record({
      action: imported ? 'finance.model.import_version' : 'finance.model.create_version',
      entityType: 'financial_model_version',
      entityId: id,
      projectId,
      after: {
        model: m.code,
        modelCase: body.modelCase,
        versionNo,
        basedOnVersionId: basedOn?.id ?? null,
        assumptionDiff: diff,
        outputs: outputs.map((o) => ({ key: o.key, basis: o.basis, measure: o.measure, sheet: o.sheet, cell: o.cell })),
        sourceDocumentId: body.sourceDocumentId ?? null,
      },
      reason: body.changeNote ?? null,
    });
    return { id, version: 1, versionNo, diff };
  }

  /** REQ-FIN-010: human financial validation of a version (not by its preparer; never a service identity). */
  async validate(ctx: RequestContext, projectId: string, modelId: string, versionId: string, body: { expectedVersion: number; note: string }) {
    const { m, v } = await this.loadWritable(ctx, projectId, modelId, versionId);
    // Validation / rejection is a role-level Finance act (separation of duties still applies); approval authority is
    // evaluated where the figure is approved.
    this.s.assert(ctx, 'finance.snapshot.approve', { projectId, classification: v.classification, requesterUserId: v.preparedBy, withinAuthority: true });
    if (v.supersededById) throw ruleViolation('finance.model.superseded', 'A newer version of this case exists: validate the latest version');
    const hash = contentHash(v);
    assertFigureValidatable({ state: v.approvalState, createdBy: v.createdBy, preparedBy: v.preparedBy, validatedBy: v.validatedBy, validatedHash: v.validatedHash, currentHash: hash }, actorOf(ctx), describe(m, v));
    assertVersion(v, body.expectedVersion, 'model version');
    const requestId = await this.s.openApprovalRequest(ctx, projectId, {
      subjectType: 'financial_model_version',
      subjectId: v.id,
      subjectVersion: v.version + 1,
      payload: { contentHash: hash, outputs: v.outputs, validatedBy: ctx.principal.userId },
      note: `Approval of ${describe(m, v)} — validated`,
    });
    const to = transition('figure', FIGURE_APPROVAL_MACHINE, v.approvalState, 'validate');
    const row = (await updateVersioned(this.s.db, V, { id: v.id, projectId, expectedVersion: body.expectedVersion }, {
      approvalState: to,
      validatedBy: ctx.principal.userId,
      validatedAt: this.s.clock.now(),
      humanValidationNote: body.note,
      validatedHash: hash,
      approvalRequestId: requestId,
    })) as VersionRow;
    await this.s.snapshotVersion(projectId, 'financial_model_version', row, 'validated');
    await this.s.audit.record({ action: 'finance.model.validate_version', entityType: 'financial_model_version', entityId: v.id, projectId, before: { approvalState: v.approvalState }, after: { approvalState: to, validatedHash: hash, approvalRequestId: requestId }, reason: body.note });
    return { id: v.id, approvalState: row.approvalState, version: row.version, approvalRequestId: requestId };
  }

  /**
   * REQ-FIN-006: approved valuation / ownership values are RECORDED — copied from the validated version — only with a
   * FINAL governance decision of type valuation_and_ownership_terms (approved within mandate, or approved by the
   * authorized body with its reference recorded). Until then they stay empty. Business plan approval is not configured
   * in the authority matrix (to be confirmed).
   * DOM-P4-06: one decision approves the values of ONE model version (decision-use registry, kind
   * `financial_model_version`: the decision that approved v1 never records v2's values — pre-check 422, then row lock and
   * re-check, a concurrent approval on the same decision is 409); a decision raised for a specific record backs only that
   * record (`if_set` — a paper cannot name a model version yet). DOM-P4-08: an external approval counts only while its
   * evidence is an active link verified by a second person.
   */
  async approveValues(ctx: RequestContext, projectId: string, modelId: string, versionId: string, body: { expectedVersion: number; decisionId: string; note?: string }) {
    const { m, v } = await this.loadWritable(ctx, projectId, modelId, versionId);
    this.s.assertGranted(ctx, 'finance.snapshot.approve', { projectId, classification: v.classification });
    if (m.kind !== 'valuation') {
      throw ruleViolation('finance.model.approval_not_configured', 'No decision type of the authority matrix covers the approval of a business plan (to be confirmed): business plan versions are validated, not approved here');
    }
    if (v.supersededById) throw ruleViolation('finance.model.superseded', 'A newer version of this case exists: approve values of the latest version');
    const d = await this.s.decision(ctx, projectId, body.decisionId);
    const issue = this.s.decisionIssue(d, VALUATION_DECISION_TYPE_KEYS, 'approved valuation / ownership values');
    if (issue.issue) throw ruleViolation('finance.model.decision_not_final', issue.issue, { decisionId: d.id, issueCode: issue.code });
    const rule: RelianceRule = {
      use: { kind: 'financial_model_version', subjectType: 'financial_model_version', subjectId: v.id },
      subjectRule: 'if_set',
      decisionTypeKeys: VALUATION_DECISION_TYPE_KEYS,
      codePrefix: 'finance.model',
    };
    const usesBefore = await assertCurrentDecisionReliance(this.s.db, projectId, d, rule);
    this.s.assert(ctx, 'finance.snapshot.approve', { projectId, classification: v.classification, requesterUserId: v.preparedBy, withinAuthority: true });
    assertFigureApprovable({ state: v.approvalState, createdBy: v.createdBy, preparedBy: v.preparedBy, validatedBy: v.validatedBy, validatedHash: v.validatedHash, currentHash: contentHash(v) }, actorOf(ctx), describe(m, v));
    assertVersion(v, body.expectedVersion, 'model version');
    const req = await this.s.approvalRequest(projectId, v.approvalRequestId);
    if (!req || req.status !== 'pending') throw ruleViolation('finance.approval.not_requested', 'No pending approval request exists for this version: validate it first');
    const to = transition('figure', FIGURE_APPROVAL_MACHINE, v.approvalState, 'approve');
    await lockDecisionAndRecheck(this.s.db, projectId, d.id, rule, usesBefore);
    const row = (await updateVersioned(this.s.db, V, { id: v.id, projectId, expectedVersion: body.expectedVersion }, {
      approvalState: to,
      approvedValues: v.outputs,
      approvedBy: ctx.principal.userId,
      approvedAt: this.s.clock.now(),
      approvalDecisionId: d.id,
    })) as VersionRow;
    await registerDecisionUse(this.s.db, { orgId: ctx.principal.orgId, projectId, decisionId: d.id, decisionCode: d.code, kind: 'financial_model_version', subjectId: v.id, usedBy: ctx.principal.userId, codePrefix: 'finance.model' });
    await this.s.closeApprovalRequest(ctx, projectId, v.approvalRequestId, 'approve', body.note ?? null, `governance decision ${d.code} (${d.decisionTypeKey})`);
    await this.s.snapshotVersion(projectId, 'financial_model_version', row, 'values approved');
    await this.s.audit.record({
      action: 'finance.model.approve_values',
      entityType: 'financial_model_version',
      entityId: v.id,
      projectId,
      before: { approvalState: v.approvalState, approvedValues: null },
      after: { approvalState: to, approvedValues: v.outputs.map((o) => ({ key: o.key, basis: o.basis, measure: o.measure })), decisionId: d.id, decisionCode: d.code, validatedBy: v.validatedBy },
      reason: body.note ?? null,
    });
    return { id: v.id, approvalState: row.approvalState, version: row.version };
  }

  async reject(ctx: RequestContext, projectId: string, modelId: string, versionId: string, body: { expectedVersion: number; note: string }) {
    const { v } = await this.loadWritable(ctx, projectId, modelId, versionId);
    // Validation / rejection is a role-level Finance act (separation of duties still applies); approval authority is
    // evaluated where the figure is approved.
    this.s.assert(ctx, 'finance.snapshot.approve', { projectId, classification: v.classification, requesterUserId: v.preparedBy, withinAuthority: true });
    assertHumanActor(actorOf(ctx), 'Rejecting a model version');
    const to = transition('figure', FIGURE_APPROVAL_MACHINE, v.approvalState, 'reject');
    assertVersion(v, body.expectedVersion, 'model version');
    const row = (await updateVersioned(this.s.db, V, { id: v.id, projectId, expectedVersion: body.expectedVersion }, { approvalState: to })) as VersionRow;
    await this.s.closeApprovalRequest(ctx, projectId, v.approvalRequestId, 'reject', body.note, 'finance.snapshot.approve (policy matrix)');
    await this.s.snapshotVersion(projectId, 'financial_model_version', row, 'rejected');
    await this.s.audit.record({ action: 'finance.model.reject_version', entityType: 'financial_model_version', entityId: v.id, projectId, before: { approvalState: v.approvalState }, after: { approvalState: to }, reason: body.note });
    return { id: v.id, approvalState: row.approvalState, version: row.version };
  }

  private async loadWritable(ctx: RequestContext, projectId: string, modelId: string, versionId: string) {
    const m = await loadInProject(this.s.db, M, projectId, modelId);
    const v = await loadInProject(this.s.db, V, projectId, versionId);
    if (v.modelId !== m.id) throw notFound();
    // Visibility (404) is part of the policy check of each command; the version carries the model's classification.
    void ctx;
    return { m, v };
  }

  /** Count helper for the summary (visible versions of visible models). */
  async counts(ctx: RequestContext, projectId: string) {
    const tx = this.s.db.tx();
    const [mc] = (await tx.select({ n: count() }).from(M).where(this.scopeSql(ctx, projectId))) as [{ n: number }];
    const [vc] = (await tx
      .select({ n: count(), approved: sql<number>`count(*) filter (where ${V.approvedValues} is not null)::int` })
      .from(V)
      .where(and(eq(V.projectId, projectId), this.s.visibleSql(ctx, projectId, { classification: V.classification })))) as [{ n: number; approved: number }];
    return { total: Number(mc.n), versions: Number(vc.n), approvedValueVersions: Number(vc.approved) };
  }
}
