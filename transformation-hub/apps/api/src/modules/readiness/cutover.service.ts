import { Injectable, Logger } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, inArray, or, SQL } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  CUTOVER_EDITABLE_STATUSES,
  CUTOVER_MACHINE,
  GO_DECISION_TYPE_KEYS,
  assertCutoverPlanSiteChange,
  assertCutoverSubmittable,
  assertDecisionLinkable,
  assertExecutionAllowed,
  assertGoAllowed,
  assertPostTransitionAcceptance,
  cutoverPrerequisitesOf,
  evaluateGo,
  invalid,
  linkedDecisionIssue,
  notFound,
  readinessCheckAppliesToPlan,
  ruleViolation,
  transition,
  CutoverCommand,
  CutoverStatus,
  DecisionUseRecord,
  DomainError,
  GoEvaluation,
} from '@hub/domain';
import type { RequestContext } from '../../platform/context';
import { assertVersion, likeContains, loadInProject, nextCode, offsetOf, pageOf, updateVersioned } from '../../platform/helpers';
import { orderBySort } from '../../platform/sort';
import type { RouteInput, readinessRoutes } from '@hub/contracts';
import { newId } from '../../platform/ids';
import { currentDecisionReliance, lockDecisionAndRecheck, registerDecisionUse, type RelianceRule } from '../governance/decision-reliance';
import { ReadinessSupport, DecisionRow, iso } from './readiness.support';
import { runDto, waiverEffectiveFor } from './checks.service';

/**
 * DOM-P2F-09 (docs/architecture/module-guide.md, "Relying on a governance decision"): the GO of a cutover plan CONSUMES its
 * `day1_go_no_go` decision (kind `cutover_plan`): one decision authorizes the GO of ONE plan, and a plan that goes to GO
 * again (after a rollback) needs a new decision. The evidence of an external approval is re-checked. Subject rule `if_set`
 * (a paper cannot yet be raised for a cutover plan). A NO-GO relies on no decision.
 */
const goRule = (planId: string): RelianceRule => ({
  use: { kind: 'cutover_plan', subjectType: 'cutover_plan', subjectId: planId },
  subjectRule: 'if_set',
  decisionTypeKeys: GO_DECISION_TYPE_KEYS,
  codePrefix: 'readiness.go_no_go',
});
/** States before a GO: a use of the decision registered for this plan means an EARLIER GO of it. */
const PRE_GO_STATUSES: readonly CutoverStatus[] = ['planning', 'rehearsal', 'ready_for_decision'];

type PlanRow = typeof schema.cutoverPlan.$inferSelect;
type CheckRow = typeof schema.readinessCheck.$inferSelect;
type RecordRow = typeof schema.cutoverDecisionRecord.$inferSelect;

export interface PlanBody {
  title?: string;
  siteId?: string | null;
  workstreamId?: string | null;
  runbookDocumentId?: string | null;
  runbookSummary?: string | null;
  windowStart?: string | null;
  windowEnd?: string | null;
  serviceImpact?: string | null;
  accountableUserId?: string | null;
  testingSummary?: string | null;
  contingencyPlan?: string | null;
  rollbackPlan?: string | null;
}

const DATE_FIELDS = new Set(['windowStart', 'windowEnd']);

/**
 * Cutover / transition plans and the Day-1 go/no-go (spec §7.4; AT-09; REQ-RDY-003/004/005/006). The platform documents
 * the transition and its decision; the change itself happens in approved operational systems (no device control).
 * A GO is re-evaluated on the server at decision time: open readiness blockers or missing §7.4 prerequisites (including
 * a FINAL approved governance go/no-go decision) refuse it, and the refusal is kept in the plan's decision history.
 */
@Injectable()
export class CutoverService {
  private readonly log = new Logger('readiness.cutover');

  constructor(private readonly s: ReadinessSupport) {}

  // ---------------------------------------------------------------------------------------------------------
  // Reads

  private async loadReadable(ctx: RequestContext, projectId: string, planId: string): Promise<PlanRow> {
    const p = await loadInProject(this.s.db, schema.cutoverPlan, projectId, planId);
    if (!this.s.policy.can(ctx, 'readiness.register.read', { projectId, workstreamId: p.workstreamId })) throw notFound();
    return p;
  }

  private scopeSql(ctx: RequestContext, projectId: string): SQL {
    const c = schema.cutoverPlan;
    return and(eq(c.projectId, projectId), this.s.policy.visibilitySql(ctx, projectId, {}), this.s.policy.reachSql(ctx, 'readiness.register.read', projectId, c.workstreamId))!;
  }

  async list(
    ctx: RequestContext,
    projectId: string,
    q: { page: number; pageSize: number; q?: string; status?: CutoverStatus; siteId?: string; sort?: RouteInput<typeof readinessRoutes.listCutoverPlans>['query']['sort'] },
  ) {
    await this.s.project(projectId);
    this.s.assertListable(ctx, projectId);
    const c = schema.cutoverPlan;
    const where = and(
      this.scopeSql(ctx, projectId),
      q.status ? eq(c.status, q.status) : undefined,
      q.siteId ? eq(c.siteId, q.siteId) : undefined,
      q.q ? or(ilike(c.title, likeContains(q.q)), ilike(c.code, likeContains(q.q))) : undefined,
    );
    const tx = this.s.db.tx();
    const [{ total }] = (await tx.select({ total: count() }).from(c).where(where)) as [{ total: number }];
    const order = orderBySort(q.sort, { code: c.code, title: c.title, status: c.status, windowStart: c.windowStart, updatedAt: c.updatedAt }, c.id, [asc(c.code), asc(c.id)]);
    const rows = await tx.select().from(c).where(where).orderBy(...order).limit(q.pageSize).offset(offsetOf(q));
    return { ...pageOf(rows.map(planDto), Number(total), q), people: await this.s.people(rows.flatMap((r) => [r.accountableUserId, r.submittedForDecisionBy])) };
  }

  /**
   * DOM-P2F-09: the reliance of this plan's GO on decision `d` as it is now — evidence of an external approval, a use for
   * another plan (registry), a paper raised for another record, or a use for an EARLIER GO of this plan (before a new GO).
   * `requireFinal: false` when the decision is only linked.
   */
  private async goReliance(projectId: string, plan: PlanRow, d: DecisionRow, requireFinal: boolean) {
    const rule = goRule(plan.id);
    const r = await currentDecisionReliance(this.s.db, projectId, d, { ...rule, requireFinal });
    const earlierGo = PRE_GO_STATUSES.includes(plan.status) && r.uses.some((u) => u.kind === 'cutover_plan' && u.subjectId === plan.id);
    const issue = earlierGo
      ? { code: 'readiness.go_no_go.decision_already_used', reason: `Decision ${d.code} already authorized an earlier GO of this plan; a new GO needs a new decision`, params: { decisionId: d.id } as Record<string, unknown> }
      : r.issue;
    return { rule, uses: r.uses, issue };
  }

  /** Checks gating the plan + the GO rule evaluated exactly as the go/no-go command evaluates it. */
  private async evaluation(
    projectId: string,
    plan: PlanRow,
  ): Promise<{ checks: CheckRow[]; inputs: Parameters<typeof evaluateGo>[0]; effective: Map<string, boolean>; evaluation: GoEvaluation; prerequisites: ReturnType<typeof cutoverPrerequisitesOf> }> {
    const c = schema.readinessCheck;
    const all = await this.s.db.tx().select().from(c).where(eq(c.projectId, projectId)).orderBy(asc(c.code));
    const checks = all.filter((x) => readinessCheckAppliesToPlan(x, plan));
    const waiverIds = checks.map((x) => x.waiverId).filter((x): x is string => !!x);
    const ws = waiverIds.length ? await this.s.db.tx().select().from(schema.waiver).where(and(eq(schema.waiver.projectId, projectId), inArray(schema.waiver.id, waiverIds))) : [];
    const wBy = new Map(ws.map((w) => [w.id, w]));
    const today = this.s.today(await this.s.project(projectId));
    const effective = new Map(checks.map((x) => [x.id, waiverEffectiveFor(x, x.waiverId ? wBy.get(x.waiverId) : null, today)]));
    // DOM-P3-09: a passed check clears the GO only while its sign-off evidence is still active and not contested.
    const evidenceValid = await this.s.signoffEvidenceValid(projectId, checks.filter((x) => x.status === 'passed').map((x) => x.id));
    const d = await this.s.decisionRow(projectId, plan.goDecisionId);
    // DOM-P2F-09: a final decision counts only while it backs no other plan (nor an earlier GO of this one) and its external
    // approval is still evidenced.
    const approved = !!d && linkedDecisionIssue(this.s.linked(d), GO_DECISION_TYPE_KEYS, 'a go-live') === null && (await this.goReliance(projectId, plan, d, true)).issue === null;
    const prerequisites = cutoverPrerequisitesOf(plan, approved);
    const inputs = checks.map((x) => ({
      id: x.id,
      title: `${x.code} — ${x.title}`,
      mandatory: x.mandatory,
      blocker: x.blocker,
      status: x.status,
      waivable: x.waivable,
      hasApprovedWaiver: effective.get(x.id) === true,
      signoffEvidenceValid: evidenceValid.get(x.id) === true,
    }));
    const evaluation = evaluateGo(inputs, prerequisites);
    return { checks, inputs, effective, evaluation, prerequisites };
  }

  async get(ctx: RequestContext, projectId: string, planId: string) {
    const plan = await this.loadReadable(ctx, projectId, planId);
    const { checks, effective, evaluation, prerequisites } = await this.evaluation(projectId, plan);
    const ids = checks.map((x) => x.id);
    const latest = ids.length
      ? await this.s.db
          .tx()
          .selectDistinctOn([schema.readinessTestRun.readinessCheckId])
          .from(schema.readinessTestRun)
          .where(and(eq(schema.readinessTestRun.projectId, projectId), inArray(schema.readinessTestRun.readinessCheckId, ids)))
          .orderBy(schema.readinessTestRun.readinessCheckId, desc(schema.readinessTestRun.seq))
      : [];
    const latestBy = new Map(latest.map((r) => [r.readinessCheckId, r]));
    const history = await this.s.db.tx().select().from(schema.cutoverDecisionRecord).where(and(eq(schema.cutoverDecisionRecord.projectId, projectId), eq(schema.cutoverDecisionRecord.cutoverPlanId, plan.id))).orderBy(asc(schema.cutoverDecisionRecord.createdAt), asc(schema.cutoverDecisionRecord.id));
    const d = await this.s.decisionRow(projectId, plan.goDecisionId);
    return {
      ...planDto(plan),
      runbookDocumentId: plan.runbookDocumentId,
      runbookSummary: plan.runbookSummary,
      serviceImpact: plan.serviceImpact,
      communicationsApproved: plan.communicationsApproved,
      communicationsApprovalRef: plan.communicationsApprovalRef,
      testingSummary: plan.testingSummary,
      rehearsalDone: plan.rehearsalDone,
      contingencyPlan: plan.contingencyPlan,
      rollbackPlan: plan.rollbackPlan,
      goNoGoDecidedBy: plan.goNoGoDecidedBy,
      goNoGoDecidedAt: iso(plan.goNoGoDecidedAt),
      goNoGoRationale: plan.goNoGoRationale,
      submittedForDecisionAt: iso(plan.submittedForDecisionAt),
      executedBy: plan.executedBy,
      executedAt: iso(plan.executedAt),
      executionNote: plan.executionNote,
      postTransitionAcceptedBy: plan.postTransitionAcceptedBy,
      postTransitionAcceptedAt: iso(plan.postTransitionAcceptedAt),
      postTransitionAcceptanceNote: plan.postTransitionAcceptanceNote,
      prerequisites,
      goEvaluation: evaluation,
      checks: checks.map((x) => {
        const run = latestBy.get(x.id);
        return {
          id: x.id,
          code: x.code,
          area: x.area,
          title: x.title,
          mandatory: x.mandatory,
          blocker: x.blocker,
          status: x.status,
          waivable: x.waivable,
          waiverEffective: effective.get(x.id) === true,
          failureContingency: x.failureContingency,
          latestTest: run ? runDto(run) : null,
        };
      }),
      goDecision: this.s.decisionSummary(ctx, projectId, d, GO_DECISION_TYPE_KEYS, 'a go-live'),
      decisionHistory: history.map(recordDto),
      acceptanceEvidence: await this.s.visibleEvidence(ctx, projectId, 'cutover_plan', plan.id), // display: SEC-P1R-05
      people: await this.s.people([plan.accountableUserId, plan.submittedForDecisionBy, plan.goNoGoDecidedBy, plan.executedBy, plan.postTransitionAcceptedBy, plan.createdBy, ...history.map((h) => h.actorUserId)]),
    };
  }

  // ---------------------------------------------------------------------------------------------------------
  // Commands

  private assertManage(ctx: RequestContext, projectId: string, p: Pick<PlanRow, 'workstreamId' | 'accountableUserId' | 'createdBy'>) {
    this.s.policy.assert(ctx, 'readiness.cutover.manage', { projectId, workstreamId: p.workstreamId, ownerUserIds: [p.accountableUserId, p.createdBy] });
  }

  private async validateRefs(ctx: RequestContext, projectId: string, b: PlanBody) {
    await this.s.assertRefs(ctx, projectId, { siteId: b.siteId, workstreamId: b.workstreamId, documentId: b.runbookDocumentId });
    if (b.accountableUserId) await this.s.assertMember(projectId, b.accountableUserId, 'accountableUserId');
  }

  private static windowOk(start: string | Date | null | undefined, end: string | Date | null | undefined) {
    if (!start || !end) return true;
    return new Date(end).getTime() > new Date(start).getTime();
  }

  async create(ctx: RequestContext, projectId: string, body: PlanBody & { title: string }) {
    const p = await this.s.project(projectId);
    this.s.policy.assert(ctx, 'readiness.cutover.manage', { projectId, workstreamId: body.workstreamId ?? null, ownerUserIds: [ctx.principal.userId] });
    await this.validateRefs(ctx, projectId, body);
    if (!CutoverService.windowOk(body.windowStart, body.windowEnd)) throw invalid('readiness.cutover.window_invalid', 'The transition window must end after it starts');
    const id = newId();
    const code = await nextCode(this.s.db, schema.cutoverPlan, projectId, 'CO');
    const [row] = await this.s.db
      .tx()
      .insert(schema.cutoverPlan)
      .values({
        id,
        orgId: ctx.principal.orgId,
        projectId,
        code,
        title: body.title,
        siteId: body.siteId ?? null,
        workstreamId: body.workstreamId ?? null,
        runbookDocumentId: body.runbookDocumentId ?? null,
        runbookSummary: body.runbookSummary ?? null,
        windowStart: body.windowStart ? new Date(body.windowStart) : null,
        windowEnd: body.windowEnd ? new Date(body.windowEnd) : null,
        serviceImpact: body.serviceImpact ?? null,
        accountableUserId: body.accountableUserId ?? null,
        testingSummary: body.testingSummary ?? null,
        contingencyPlan: body.contingencyPlan ?? null,
        rollbackPlan: body.rollbackPlan ?? null,
        isDemo: p.isDemo,
        createdBy: ctx.principal.userId,
      })
      .returning();
    await this.s.versions.snapshot({ projectId, entityType: 'cutover_plan', entityId: id, versionNo: 1, snapshot: row!, reason: 'created' });
    await this.s.audit.record({ action: 'readiness.cutover.create', entityType: 'cutover_plan', entityId: id, projectId, after: { code, title: body.title, siteId: body.siteId ?? null, workstreamId: body.workstreamId ?? null } });
    return { id, code, version: 1 };
  }

  async update(ctx: RequestContext, projectId: string, planId: string, body: PlanBody & { expectedVersion: number }) {
    const plan = await loadInProject(this.s.db, schema.cutoverPlan, projectId, planId);
    this.assertManage(ctx, projectId, plan);
    const { expectedVersion, ...changes } = body;
    const current = plan as unknown as Record<string, unknown>;
    const norm = (k: string, v: unknown) => (DATE_FIELDS.has(k) && v ? new Date(v as string) : v);
    const same = (k: string, v: unknown) => {
      const c = current[k];
      if (DATE_FIELDS.has(k)) return (c ? (c as Date).getTime() : null) === (v ? new Date(v as string).getTime() : null);
      return c === v;
    };
    const effective = Object.fromEntries(
      Object.entries(changes)
        .filter(([k, v]) => v !== undefined && !same(k, v))
        .map(([k, v]) => [k, norm(k, v)]),
    );
    if (Object.keys(effective).length === 0) {
      assertVersion(plan, expectedVersion, 'cutover plan');
      return { id: plan.id, version: plan.version };
    }
    if (!CUTOVER_EDITABLE_STATUSES.includes(plan.status)) {
      throw ruleViolation('readiness.cutover.locked', `The plan is ${plan.status}; return it to planning before changing it (earlier decisions stay in the history)`);
    }
    if (effective['workstreamId']) this.s.policy.assert(ctx, 'readiness.cutover.manage', { projectId, workstreamId: effective['workstreamId'] as string, ownerUserIds: [plan.accountableUserId, plan.createdBy] });
    await this.validateRefs(ctx, projectId, effective as PlanBody);
    const start = 'windowStart' in effective ? (effective['windowStart'] as Date | null) : plan.windowStart;
    const end = 'windowEnd' in effective ? (effective['windowEnd'] as Date | null) : plan.windowEnd;
    if (!CutoverService.windowOk(start, end)) throw invalid('readiness.cutover.window_invalid', 'The transition window must end after it starts');
    const row = (await updateVersioned(this.s.db, schema.cutoverPlan, { id: plan.id, projectId, expectedVersion }, effective)) as PlanRow;
    await this.s.versions.snapshot({ projectId, entityType: 'cutover_plan', entityId: plan.id, versionNo: row.version, snapshot: row, reason: 'updated' });
    await this.s.audit.record({
      action: 'readiness.cutover.update',
      entityType: 'cutover_plan',
      entityId: plan.id,
      projectId,
      before: Object.fromEntries(Object.keys(effective).map((k) => [k, current[k]])),
      after: effective,
    });
    return { id: plan.id, version: row.version };
  }

  /** Cleared for the GO rule (as `evaluation` computes it): passed with valid sign-off evidence, not applicable, or effectively waived. */
  private async clearedMap(projectId: string, checks: CheckRow[]): Promise<Map<string, boolean>> {
    const waiverIds = checks.map((x) => x.waiverId).filter((x): x is string => !!x);
    const ws = waiverIds.length ? await this.s.db.tx().select().from(schema.waiver).where(and(eq(schema.waiver.projectId, projectId), inArray(schema.waiver.id, waiverIds))) : [];
    const wBy = new Map(ws.map((w) => [w.id, w]));
    const today = this.s.today(await this.s.project(projectId));
    const evidenceValid = await this.s.signoffEvidenceValid(projectId, checks.filter((x) => x.status === 'passed').map((x) => x.id));
    return new Map(
      checks.map((x) => [
        x.id,
        x.status === 'not_applicable' || (x.status === 'passed' && evidenceValid.get(x.id) === true) || (x.status === 'waived' && waiverEffectiveFor(x, x.waiverId ? wBy.get(x.waiverId) : null, today)),
      ]),
    );
  }

  /**
   * DOM-P34R-01: change the plan's site (null = project-wide) — a scope command like the check's re-binding: reason required,
   * before the go/no-go only, refused while a FAILED gating check of the current scope would stop gating the plan; the decision
   * history records the change with the checks that leave and enter the plan's scope. Taken under the readiness lock (the set of
   * checks gating a GO changes).
   */
  async changeSite(ctx: RequestContext, projectId: string, planId: string, body: { expectedVersion: number; siteId: string | null; reason: string }) {
    await this.s.lockReadiness(projectId);
    // SEC-P34R-02: the module's read rule first (a plan the caller cannot read is 404, like an unknown id), then the command.
    const plan = await this.loadReadable(ctx, projectId, planId);
    this.assertManage(ctx, projectId, plan);
    if ((body.siteId ?? null) === plan.siteId) {
      assertVersion(plan, body.expectedVersion, 'cutover plan');
      return { id: plan.id, status: plan.status, goNoGo: plan.goNoGo, version: plan.version };
    }
    await this.s.assertRefs(ctx, projectId, { siteId: body.siteId });
    const c = schema.readinessCheck;
    const all = await this.s.db.tx().select().from(c).where(eq(c.projectId, projectId)).orderBy(asc(c.code));
    const next = { ...plan, siteId: body.siteId };
    const before = all.filter((x) => readinessCheckAppliesToPlan(x, plan));
    const after = all.filter((x) => readinessCheckAppliesToPlan(x, next));
    const leaving = before.filter((x) => !after.some((a) => a.id === x.id));
    const entering = after.filter((x) => !before.some((b) => b.id === x.id));
    const cleared = await this.clearedMap(projectId, leaving);
    // SEC-P34R-08: the refusal names only the checks the caller may read (readiness reach); the rule weighs every check.
    const reach = this.s.policy.permissionReach(ctx, 'readiness.register.read', projectId);
    const readable = new Set(leaving.filter((x) => reach.all || (!!x.workstreamId && reach.workstreamIds.includes(x.workstreamId))).map((x) => x.id));
    assertCutoverPlanSiteChange({
      planCode: plan.code,
      planStatus: plan.status,
      reason: body.reason,
      leaving: leaving.map((x) => ({ id: x.id, code: x.code, status: x.status, gating: x.blocker || x.mandatory, cleared: cleared.get(x.id) === true })),
      canRead: (id) => readable.has(id),
    });
    const row = (await updateVersioned(this.s.db, schema.cutoverPlan, { id: plan.id, projectId, expectedVersion: body.expectedVersion }, { siteId: body.siteId })) as PlanRow;
    const codes = (xs: CheckRow[]) => (xs.length ? xs.map((x) => x.code).join(', ') : '—');
    await this.s.recordPlanHistory(ctx, plan, projectId, 'site_changed', `${body.reason.trim()} — no longer gating: ${codes(leaving)}; now gating: ${codes(entering)}`, null);
    await this.s.versions.snapshot({ projectId, entityType: 'cutover_plan', entityId: plan.id, versionNo: row.version, snapshot: row, reason: 'site changed' });
    await this.s.audit.record({
      action: 'readiness.cutover.change_site',
      entityType: 'cutover_plan',
      entityId: plan.id,
      projectId,
      before: { siteId: plan.siteId, gatingChecks: before.length },
      after: { siteId: body.siteId, gatingChecks: after.length, leaving: leaving.map((x) => x.code), entering: entering.map((x) => x.code) },
      reason: body.reason,
    });
    await this.s.enqueueDimensions(ctx, projectId, `plan:${plan.id}:${row.version}`);
    return { id: plan.id, status: row.status, goNoGo: row.goNoGo, version: row.version };
  }

  private async apply(ctx: RequestContext, plan: PlanRow, cmd: CutoverCommand, expectedVersion: number, values: Record<string, unknown>, rec: { kind: string; rationale?: string | null; evaluation?: GoEvaluation | null; goDecisionId?: string | null }) {
    const to = transition('cutover', CUTOVER_MACHINE, plan.status, cmd);
    const row = (await updateVersioned(this.s.db, schema.cutoverPlan, { id: plan.id, projectId: plan.projectId, expectedVersion }, { status: to, ...values })) as PlanRow;
    await this.record(ctx, plan, rec.kind, plan.status, to, rec.rationale ?? null, rec.goDecisionId ?? plan.goDecisionId, rec.evaluation ?? null);
    await this.s.versions.snapshot({ projectId: plan.projectId, entityType: 'cutover_plan', entityId: plan.id, versionNo: row.version, snapshot: row, reason: cmd });
    await this.s.audit.record({
      action: `readiness.cutover.${cmd}`,
      entityType: 'cutover_plan',
      entityId: plan.id,
      projectId: plan.projectId,
      before: { status: plan.status, goNoGo: plan.goNoGo },
      after: { status: to, goNoGo: row.goNoGo, ...(rec.evaluation ? { blockers: rec.evaluation.blockers.length, missing: rec.evaluation.missing } : {}) },
      reason: rec.rationale ?? null,
    });
    // DOM-P34R-03: the GO, its withdrawal, the execution, the rollback and the post-transition acceptance are inputs of the
    // operational dimension (business-gates.md §1 rule 8) — the gates module recomputes it on `readiness.changed`.
    await this.s.enqueueDimensions(ctx, plan.projectId, `plan:${plan.id}:${row.version}`);
    return { id: plan.id, status: to, goNoGo: row.goNoGo, version: row.version };
  }

  private async record(ctx: RequestContext, plan: PlanRow, kind: string, from: CutoverStatus | null, to: CutoverStatus | null, rationale: string | null, goDecisionId: string | null, evaluation: GoEvaluation | null) {
    await this.s.db
      .tx()
      .insert(schema.cutoverDecisionRecord)
      .values({
        id: newId(),
        orgId: ctx.principal.orgId,
        projectId: plan.projectId,
        cutoverPlanId: plan.id,
        kind,
        fromStatus: from,
        toStatus: to,
        actorUserId: ctx.principal.userId!,
        rationale,
        goDecisionId,
        evaluation: evaluation ? { blockers: evaluation.blockers, missing: evaluation.missing } : null,
        isDemo: plan.isDemo,
      });
  }

  async recordRehearsal(ctx: RequestContext, projectId: string, planId: string, body: { expectedVersion: number; testingSummary: string; note?: string }) {
    const plan = await loadInProject(this.s.db, schema.cutoverPlan, projectId, planId);
    this.assertManage(ctx, projectId, plan);
    return this.apply(ctx, plan, 'record_rehearsal', body.expectedVersion, { rehearsalDone: true, testingSummary: body.testingSummary }, { kind: 'rehearsal', rationale: body.note ?? body.testingSummary });
  }

  async recordCommunicationsApproval(ctx: RequestContext, projectId: string, planId: string, body: { expectedVersion: number; approvalReference: string; note?: string }) {
    const plan = await loadInProject(this.s.db, schema.cutoverPlan, projectId, planId);
    this.assertManage(ctx, projectId, plan);
    if (!CUTOVER_EDITABLE_STATUSES.includes(plan.status)) throw ruleViolation('readiness.cutover.locked', `The plan is ${plan.status}; communications are approved before it goes to decision`);
    const row = (await updateVersioned(this.s.db, schema.cutoverPlan, { id: plan.id, projectId, expectedVersion: body.expectedVersion }, { communicationsApproved: true, communicationsApprovalRef: body.approvalReference })) as PlanRow;
    await this.s.audit.record({ action: 'readiness.cutover.communications_approved', entityType: 'cutover_plan', entityId: plan.id, projectId, before: { communicationsApproved: plan.communicationsApproved }, after: { communicationsApproved: true, approvalReference: body.approvalReference }, reason: body.note ?? null });
    return { id: plan.id, status: row.status, goNoGo: row.goNoGo, version: row.version };
  }

  /** Link the governance go/no-go decision (governance owns decisions; same project, readable, type day1_go_no_go). */
  async linkGoDecision(ctx: RequestContext, projectId: string, planId: string, body: { expectedVersion: number; decisionId: string }) {
    const plan = await loadInProject(this.s.db, schema.cutoverPlan, projectId, planId);
    this.assertManage(ctx, projectId, plan);
    if (!['planning', 'rehearsal', 'ready_for_decision'].includes(plan.status)) throw ruleViolation('readiness.cutover.locked', `The go/no-go of this plan is already ${plan.status}`);
    const d = await this.s.decision(ctx, projectId, body.decisionId);
    assertDecisionLinkable(this.s.linked(d), GO_DECISION_TYPE_KEYS, 'A go-live');
    // DOM-P2F-09: the decision may still be pending, but it must not back another plan (or an earlier GO of this one), nor
    // rest on an external approval whose evidence is no longer active and verified.
    const reliance = await this.goReliance(projectId, plan, d, false);
    if (reliance.issue) throw ruleViolation(reliance.issue.code, reliance.issue.reason, reliance.issue.params);
    const row = (await updateVersioned(this.s.db, schema.cutoverPlan, { id: plan.id, projectId, expectedVersion: body.expectedVersion }, { goDecisionId: d.id })) as PlanRow;
    await this.s.audit.record({ action: 'readiness.cutover.link_decision', entityType: 'cutover_plan', entityId: plan.id, projectId, before: { goDecisionId: plan.goDecisionId }, after: { goDecisionId: d.id, decisionStatus: d.status } });
    return { id: plan.id, status: row.status, goNoGo: row.goNoGo, version: row.version };
  }

  /** REQ-RDY-003: to go/no-go only with every §7.4 element documented; the submitter can never decide it. */
  async submitForDecision(ctx: RequestContext, projectId: string, planId: string, body: { expectedVersion: number; note?: string }) {
    const plan = await loadInProject(this.s.db, schema.cutoverPlan, projectId, planId);
    this.assertManage(ctx, projectId, plan);
    assertVersion(plan, body.expectedVersion, 'cutover plan');
    assertCutoverSubmittable(plan);
    const { evaluation } = await this.evaluation(projectId, plan);
    const res = await this.apply(ctx, plan, 'submit_for_decision', body.expectedVersion, { submittedForDecisionBy: ctx.principal.userId, submittedForDecisionAt: this.s.clock.now(), goNoGo: 'pending' }, { kind: 'submitted', rationale: body.note ?? null, evaluation });
    await this.s.outbox.emit({ type: 'approval.pending', projectId, aggregateType: 'cutover_plan', aggregateId: plan.id, payload: { cutoverPlanId: plan.id, requiredPermission: 'readiness.go_no_go.decide', openBlockers: evaluation.blockers.length } });
    return res;
  }

  async returnToPlanning(ctx: RequestContext, projectId: string, planId: string, body: { expectedVersion: number; note: string }) {
    const plan = await loadInProject(this.s.db, schema.cutoverPlan, projectId, planId);
    this.assertManage(ctx, projectId, plan);
    return this.apply(ctx, plan, 'return_to_planning', body.expectedVersion, { submittedForDecisionBy: null, submittedForDecisionAt: null, goNoGo: 'pending' }, { kind: 'returned_to_planning', rationale: body.note });
  }

  /**
   * AT-09 / REQ-RDY-004: GO / NO-GO by the decision authority — never the person who submitted the plan. A GO is refused
   * (422) while a mandatory blocker is open or a §7.4 prerequisite (incl. the FINAL approved governance decision) is
   * missing; the refusal is recorded in the plan's decision history and the audit log although the command rolls back.
   */
  async decide(ctx: RequestContext, projectId: string, planId: string, body: { expectedVersion: number; outcome: 'go' | 'no_go'; rationale: string; decisionId?: string }) {
    // DOM-P3-03: the GO evaluates the gating checks under the project readiness lock, which every command changing a gating
    // input also takes — a failed test committed while the GO waits is seen (or waits for the GO), never missed.
    await this.s.lockReadiness(projectId);
    let plan = await loadInProject(this.s.db, schema.cutoverPlan, projectId, planId);
    const cmd: CutoverCommand = body.outcome === 'go' ? 'decide_go' : 'decide_no_go';
    // Role → version / state / pending submission → not the submitter + authority (I-R3).
    this.s.policy.assertApproval(
      ctx,
      'readiness.go_no_go.decide',
      {
        projectId,
        workstreamId: plan.workstreamId,
        requesterUserId: plan.submittedForDecisionBy,
        // Authority for a GO is carried by the linked FINAL governance decision (checked by the domain rule below).
        withinAuthority: this.s.policy.permissionReach(ctx, 'readiness.go_no_go.decide', projectId).all,
      },
      () => {
        assertVersion(plan, body.expectedVersion, 'cutover plan');
        transition('cutover', CUTOVER_MACHINE, plan.status, cmd); // state check before evaluating (422 on a wrong state)
        if (!plan.submittedForDecisionBy) throw ruleViolation('readiness.go_no_go.no_request', 'A go/no-go needs a pending submission by another person');
      },
    );
    if (body.decisionId && body.decisionId !== plan.goDecisionId) {
      const d = await this.s.decision(ctx, projectId, body.decisionId);
      assertDecisionLinkable(this.s.linked(d), GO_DECISION_TYPE_KEYS, 'A go-live');
      plan = (await updateVersioned(this.s.db, schema.cutoverPlan, { id: plan.id, projectId, expectedVersion: plan.version }, { goDecisionId: d.id })) as PlanRow;
    }
    const ev = await this.evaluation(projectId, plan);
    let goDecision: { d: DecisionRow; rule: RelianceRule; uses: DecisionUseRecord[] } | null = null;
    if (body.outcome === 'go') {
      try {
        // DOM-P2F-09: a FINAL linked decision that no longer backs this GO (used for another plan or an earlier GO of this
        // one, raised for another record, external approval no longer evidenced) is refused with its own code — before the
        // generic prerequisite check, which would only report the decision as missing.
        const d = await this.s.decisionRow(projectId, plan.goDecisionId);
        if (d && linkedDecisionIssue(this.s.linked(d), GO_DECISION_TYPE_KEYS, 'a go-live') === null) {
          const r = await this.goReliance(projectId, plan, d, true);
          if (r.issue) throw ruleViolation(r.issue.code, r.issue.reason, r.issue.params);
          goDecision = { d, rule: r.rule, uses: r.uses };
        }
        assertGoAllowed(ev.inputs, ev.prerequisites);
      } catch (e) {
        if (e instanceof DomainError) await this.recordRefusedGo(ctx, plan, body.rationale, ev.evaluation);
        throw e;
      }
      // The GO consumes the decision: row lock and re-check (a concurrent GO of another plan on it first → 409).
      if (goDecision) await lockDecisionAndRecheck(this.s.db, projectId, goDecision.d.id, goDecision.rule, goDecision.uses);
    }
    const res = await this.apply(
      ctx,
      plan,
      cmd,
      plan.version,
      { goNoGo: body.outcome, goNoGoDecidedBy: ctx.principal.userId, goNoGoDecidedAt: this.s.clock.now(), goNoGoRationale: body.rationale },
      { kind: body.outcome, rationale: body.rationale, evaluation: ev.evaluation, goDecisionId: plan.goDecisionId },
    );
    if (goDecision) {
      await registerDecisionUse(this.s.db, { orgId: ctx.principal.orgId, projectId, decisionId: goDecision.d.id, decisionCode: goDecision.d.code, kind: 'cutover_plan', subjectId: plan.id, usedBy: ctx.principal.userId, codePrefix: 'readiness.go_no_go' });
    }
    return res;
  }

  /** Autonomous transaction: the refused GO stays visible in the decision history and the audit log (AT-09). */
  private async recordRefusedGo(ctx: RequestContext, plan: PlanRow, rationale: string, evaluation: GoEvaluation) {
    try {
      await this.s.db.runDetached(ctx, async (tx) => {
        await tx.insert(schema.cutoverDecisionRecord).values({
          id: newId(),
          orgId: ctx.principal.orgId,
          projectId: plan.projectId,
          cutoverPlanId: plan.id,
          kind: 'go_blocked',
          fromStatus: plan.status,
          toStatus: plan.status,
          actorUserId: ctx.principal.userId!,
          rationale,
          goDecisionId: plan.goDecisionId,
          evaluation: { blockers: evaluation.blockers, missing: evaluation.missing },
          isDemo: plan.isDemo,
        });
      });
    } catch (e) {
      this.log.error(`failed to persist refused GO for ${plan.id}: ${(e as Error).message}`);
    }
    await this.s.audit.recordDetached(ctx, {
      action: 'readiness.cutover.decide_go',
      entityType: 'cutover_plan',
      entityId: plan.id,
      projectId: plan.projectId,
      outcome: 'rejected',
      reason: `GO refused: ${evaluation.blockers.length} open blocker(s)${evaluation.missing.length ? `; missing ${evaluation.missing.join(', ')}` : ''}`,
      after: { blockers: evaluation.blockers.map((b) => ({ id: b.id, status: b.status })), missing: evaluation.missing },
    });
  }

  /**
   * REQ-RDY-006: the platform records that the change was executed elsewhere — it never executes it. DOM-P3-04: the gating
   * checks are re-evaluated under the readiness lock; a GO flagged because a gating check is open again (failed after the
   * GO, reopened, sign-off evidence rejected) refuses the execution record until the check is cleared / waived or the GO
   * is withdrawn (return to planning) for a new decision. The refusal stays in the decision history and the audit log.
   */
  async recordExecution(ctx: RequestContext, projectId: string, planId: string, body: { expectedVersion: number; note: string }) {
    await this.s.lockReadiness(projectId);
    const plan = await loadInProject(this.s.db, schema.cutoverPlan, projectId, planId);
    this.assertManage(ctx, projectId, plan);
    assertVersion(plan, body.expectedVersion, 'cutover plan');
    transition('cutover', CUTOVER_MACHINE, plan.status, 'record_execution'); // wrong state → 422 before the evaluation
    const ev = await this.evaluation(projectId, plan);
    try {
      assertExecutionAllowed({ planCode: plan.code, blockers: ev.evaluation.blockers });
    } catch (e) {
      if (e instanceof DomainError) await this.recordRefusedExecution(ctx, plan, body.note, ev.evaluation);
      throw e;
    }
    return this.apply(ctx, plan, 'record_execution', body.expectedVersion, { executedBy: ctx.principal.userId, executedAt: this.s.clock.now(), executionNote: body.note }, { kind: 'executed', rationale: body.note });
  }

  /** Autonomous transaction: the refused execution record stays visible in the decision history and the audit log. */
  private async recordRefusedExecution(ctx: RequestContext, plan: PlanRow, note: string, evaluation: GoEvaluation) {
    try {
      await this.s.db.runDetached(ctx, async (tx) => {
        await tx.insert(schema.cutoverDecisionRecord).values({
          id: newId(),
          orgId: ctx.principal.orgId,
          projectId: plan.projectId,
          cutoverPlanId: plan.id,
          kind: 'execution_blocked',
          fromStatus: plan.status,
          toStatus: plan.status,
          actorUserId: ctx.principal.userId!,
          rationale: note,
          goDecisionId: plan.goDecisionId,
          evaluation: { blockers: evaluation.blockers, missing: [] },
          isDemo: plan.isDemo,
        });
      });
    } catch (e) {
      this.log.error(`failed to persist refused execution for ${plan.id}: ${(e as Error).message}`);
    }
    await this.s.audit.recordDetached(ctx, {
      action: 'readiness.cutover.record_execution',
      entityType: 'cutover_plan',
      entityId: plan.id,
      projectId: plan.projectId,
      outcome: 'rejected',
      reason: `Execution refused: the GO is flagged — ${evaluation.blockers.length} gating check(s) open again after the GO`,
      after: { blockers: evaluation.blockers.map((b) => ({ id: b.id, status: b.status })) },
    });
  }

  async recordRollback(ctx: RequestContext, projectId: string, planId: string, body: { expectedVersion: number; note: string }) {
    const plan = await loadInProject(this.s.db, schema.cutoverPlan, projectId, planId);
    this.assertManage(ctx, projectId, plan);
    return this.apply(ctx, plan, 'record_rollback', body.expectedVersion, {}, { kind: 'rolled_back', rationale: body.note });
  }

  /** REQ-RDY-005: post-transition acceptance by the accountable owner (not the executor) with acceptance evidence. */
  async accept(ctx: RequestContext, projectId: string, planId: string, body: { expectedVersion: number; note: string }) {
    const plan = await loadInProject(this.s.db, schema.cutoverPlan, projectId, planId);
    this.assertManage(ctx, projectId, plan);
    transition('cutover', CUTOVER_MACHINE, plan.status, 'accept');
    const ev = await this.s.evidence(projectId, 'cutover_plan', plan.id);
    assertPostTransitionAcceptance({
      acceptorUserId: ctx.principal.userId!,
      accountableUserId: plan.accountableUserId,
      executedBy: plan.executedBy,
      activeEvidenceCount: ev.active,
      conflictingEvidenceCount: ev.conflicting,
      note: body.note,
    });
    return this.apply(
      ctx,
      plan,
      'accept',
      body.expectedVersion,
      { postTransitionAccepted: true, postTransitionAcceptedBy: ctx.principal.userId, postTransitionAcceptedAt: this.s.clock.now(), postTransitionAcceptanceNote: body.note },
      { kind: 'accepted', rationale: body.note },
    );
  }
}

function planDto(p: PlanRow) {
  return {
    id: p.id,
    code: p.code,
    title: p.title,
    siteId: p.siteId,
    workstreamId: p.workstreamId,
    status: p.status,
    goNoGo: p.goNoGo,
    windowStart: iso(p.windowStart),
    windowEnd: iso(p.windowEnd),
    accountableUserId: p.accountableUserId,
    goDecisionId: p.goDecisionId,
    submittedForDecisionBy: p.submittedForDecisionBy,
    postTransitionAccepted: p.postTransitionAccepted,
    isDemo: p.isDemo,
    createdAt: p.createdAt.toISOString(),
    version: p.version,
  };
}

function recordDto(r: RecordRow) {
  return {
    id: r.id,
    kind: r.kind,
    fromStatus: r.fromStatus,
    toStatus: r.toStatus,
    actorUserId: r.actorUserId,
    rationale: r.rationale,
    goDecisionId: r.goDecisionId,
    evaluation: (r.evaluation as { blockers: { id: string; title: string; status: never; blocker: boolean }[]; missing: string[] } | null) ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}
