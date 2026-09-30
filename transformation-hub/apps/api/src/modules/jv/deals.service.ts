import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, ilike, or } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  NEGOTIATION_ISSUE_MACHINE,
  allowedCommands,
  assertNegotiationAgreementAllowed,
  assertNegotiationIssueLinks,
  assertOwnershipScenario,
  notFound,
  parseMoney,
  ruleViolation,
  transition,
  Classification,
  NegotiationCommand,
} from '@hub/domain';
import type { RouteInput, jvRoutes } from '@hub/contracts';
import type { RequestContext } from '../../platform/context';
import { assertVersion, likeContains, loadInProject, offsetOf, pageOf, updateVersioned } from '../../platform/helpers';
import { orderBySort } from '../../platform/sort';
import { newId } from '../../platform/ids';
import { JvSupport, money } from './jv.support';

type ScenarioRow = typeof schema.dealScenario.$inferSelect;
type IssueRow = typeof schema.negotiationIssue.$inferSelect;
type Q<K extends keyof typeof jvRoutes> = RouteInput<(typeof jvRoutes)[K]>;
type Ownership = { party: string; percent: string | null; note?: string | null }[];
type Contribution = { party: string; description: string; amount?: string | null; currency?: string | null; unitScale?: number | null }[];

/**
 * Deal structuring (REQ-JV-007, REQ-JV-008): versioned ownership / contribution / governance scenarios that never assume
 * a percentage or control, and the terms & negotiation issues register whose approval-requiring issues link the
 * governance decision that approves them.
 */
@Injectable()
export class DealsService {
  constructor(private readonly s: JvSupport) {}

  // ---------------------------------------------------------------------------------------------------------
  // Scenarios

  private normalizeOwnership(o: Ownership) {
    return o.map((x) => ({ party: x.party.trim(), percent: x.percent ?? null, note: x.note ?? null }));
  }

  private normalizeContributions(c: Contribution) {
    return c.map((x) => {
      const any = x.amount != null || x.currency != null || x.unitScale != null;
      if (any) {
        if (x.amount == null || !x.currency || !x.unitScale) throw ruleViolation('jv.scenario.contribution_money_incomplete', `The contribution of "${x.party}" needs amount, currency and unit scale together (or none)`);
        parseMoney({ amount: x.amount, currency: x.currency, unitScale: x.unitScale });
      }
      return { party: x.party.trim(), description: x.description, amount: any ? x.amount! : null, currency: any ? x.currency! : null, unitScale: any ? x.unitScale! : null };
    });
  }

  private ownershipDto(o: Ownership) {
    return o.map((x) => ({ party: x.party, percent: x.percent ?? null, note: x.note ?? null }));
  }

  private contributionDto(c: Contribution) {
    return c.map((x) => ({ party: x.party, description: x.description, amount: money(x.amount ?? null, x.currency ?? null, x.unitScale ?? null) }));
  }

  private scenarioDto(r: ScenarioRow) {
    const own = assertOwnershipScenario(r.ownership);
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      partnerId: r.partnerId,
      versionNo: r.versionNo,
      versionLabel: r.versionLabel,
      ownership: this.ownershipDto(r.ownership),
      ownershipComplete: own.complete,
      ownershipTotal: own.total,
      approvalState: r.approvalState,
      classification: r.classification,
      isDemo: r.isDemo,
      updatedAt: r.updatedAt.toISOString(),
      version: r.version,
    };
  }

  private async loadScenario(ctx: RequestContext, projectId: string, id: string, permission: string) {
    if (this.s.policy.isRoomOnly(ctx.principal, projectId)) throw notFound();
    const r = await loadInProject(this.s.db, schema.dealScenario, projectId, id);
    this.s.policy.assert(ctx, permission, { projectId, classification: r.classification as Classification });
    return r;
  }

  private async partnerRef(ctx: RequestContext, projectId: string, partnerId: string | null | undefined) {
    if (!partnerId) return;
    const p = await loadInProject(this.s.db, schema.partner, projectId, partnerId);
    if (!this.s.policy.canSee(ctx, { projectId, classification: p.classification as Classification })) throw notFound();
  }

  async listScenarios(ctx: RequestContext, projectId: string, q: Q<'listScenarios'>['query']) {
    await this.s.project(projectId);
    this.s.assertListable(ctx, projectId, 'jv.deal.read');
    const t = schema.dealScenario;
    const where = and(
      eq(t.projectId, projectId),
      this.s.policy.visibilitySql(ctx, projectId, { classification: t.classification }),
      q.partnerId ? eq(t.partnerId, q.partnerId) : undefined,
      q.q ? or(ilike(t.name, likeContains(q.q)), ilike(t.code, likeContains(q.q))) : undefined,
    );
    const tx = this.s.db.tx();
    const [{ total }] = (await tx.select({ total: count() }).from(t).where(where)) as [{ total: number }];
    const order = orderBySort(q.sort, { code: t.code, name: t.name, updatedAt: t.updatedAt }, t.id, [asc(t.code), asc(t.id)]);
    const rows = await tx.select().from(t).where(where).orderBy(...order).limit(q.pageSize).offset(offsetOf(q));
    return pageOf(rows.map((r) => this.scenarioDto(r)), Number(total), q);
  }

  async getScenario(ctx: RequestContext, projectId: string, id: string) {
    const r = await this.loadScenario(ctx, projectId, id, 'jv.deal.read');
    const versions = await this.s.db
      .tx()
      .select()
      .from(schema.dealScenarioVersion)
      .where(and(eq(schema.dealScenarioVersion.projectId, projectId), eq(schema.dealScenarioVersion.scenarioId, id)))
      .orderBy(asc(schema.dealScenarioVersion.versionNo));
    return {
      ...this.scenarioDto(r),
      contributions: this.contributionDto(r.contributions),
      governanceTerms: r.governanceTerms,
      assumptions: r.assumptions,
      versions: versions.map((v) => ({
        versionNo: v.versionNo,
        versionLabel: v.versionLabel,
        ownership: this.ownershipDto(v.ownership),
        contributions: this.contributionDto(v.contributions),
        governanceTerms: v.governanceTerms,
        assumptions: v.assumptions,
        changeNote: v.changeNote,
        createdAt: v.createdAt.toISOString(),
        createdBy: v.createdBy,
      })),
      people: await this.s.people([r.createdBy, ...versions.map((v) => v.createdBy)]),
    };
  }

  async createScenario(ctx: RequestContext, projectId: string, body: Q<'createScenario'>['body']) {
    const project = await this.s.project(projectId);
    this.s.assertListable(ctx, projectId, 'jv.scenario.manage');
    this.s.assertClassification(ctx, body.classification);
    this.s.policy.assert(ctx, 'jv.scenario.manage', { projectId, classification: body.classification });
    await this.partnerRef(ctx, projectId, body.partnerId);
    // Percentages are exactly what a person entered (null = TBD) — the platform never fills a default (REQ-JV-007).
    const ownership = this.normalizeOwnership(body.ownership);
    const own = assertOwnershipScenario(ownership);
    const contributions = this.normalizeContributions(body.contributions);
    const code = await this.s.nextCode('deal_scenario', 'code', projectId, 'SCN');
    const id = newId();
    const versionLabel = body.versionLabel?.trim() || 'v1';
    const tx = this.s.db.tx();
    await tx.insert(schema.dealScenario).values({
      id,
      orgId: ctx.principal.orgId,
      projectId,
      partnerId: body.partnerId ?? null,
      code,
      name: body.name,
      versionNo: 1,
      versionLabel,
      ownership,
      contributions,
      governanceTerms: body.governanceTerms ?? null,
      assumptions: body.assumptions ?? null,
      classification: body.classification,
      isDemo: project.isDemo,
      createdBy: ctx.principal.userId,
    });
    await tx.insert(schema.dealScenarioVersion).values({
      id: newId(),
      orgId: ctx.principal.orgId,
      projectId,
      scenarioId: id,
      versionNo: 1,
      versionLabel,
      ownership,
      contributions,
      governanceTerms: body.governanceTerms ?? null,
      assumptions: body.assumptions ?? null,
      changeNote: 'Initial version',
      createdBy: ctx.principal.userId,
    });
    await this.s.audit.record({ action: 'jv.scenario.create', entityType: 'deal_scenario', entityId: id, projectId, after: { code, versionNo: 1, parties: ownership.map((o) => o.party), ownershipComplete: own.complete } });
    return { id, code, version: 1 };
  }

  async addScenarioVersion(ctx: RequestContext, projectId: string, id: string, body: Q<'addScenarioVersion'>['body']) {
    const r = await this.loadScenario(ctx, projectId, id, 'jv.scenario.manage');
    const ownership = this.normalizeOwnership(body.ownership);
    assertOwnershipScenario(ownership);
    const contributions = this.normalizeContributions(body.contributions);
    assertVersion(r, body.expectedVersion, 'scenario');
    const versionNo = r.versionNo + 1;
    const versionLabel = body.versionLabel?.trim() || `v${versionNo}`;
    const governanceTerms = body.governanceTerms === undefined ? r.governanceTerms : body.governanceTerms;
    const assumptions = body.assumptions === undefined ? r.assumptions : body.assumptions;
    const row = await updateVersioned(this.s.db, schema.dealScenario, { id, projectId, expectedVersion: body.expectedVersion }, { versionNo, versionLabel, ownership, contributions, governanceTerms, assumptions, approvalState: 'proposed' });
    await this.s.db.tx().insert(schema.dealScenarioVersion).values({ id: newId(), orgId: ctx.principal.orgId, projectId, scenarioId: id, versionNo, versionLabel, ownership, contributions, governanceTerms, assumptions, changeNote: body.changeNote, createdBy: ctx.principal.userId });
    await this.s.audit.record({ action: 'jv.scenario.version', entityType: 'deal_scenario', entityId: id, projectId, before: { versionNo: r.versionNo }, after: { versionNo, versionLabel }, reason: body.changeNote });
    return { id, versionNo, version: row['version'] as number };
  }

  // ---------------------------------------------------------------------------------------------------------
  // Negotiation issues

  private async loadIssue(ctx: RequestContext, projectId: string, id: string, permission: string) {
    if (this.s.policy.isRoomOnly(ctx.principal, projectId)) throw notFound();
    const r = await loadInProject(this.s.db, schema.negotiationIssue, projectId, id);
    this.s.policy.assert(ctx, permission, { projectId, classification: r.classification as Classification });
    return r;
  }

  private async issueDto(ctx: RequestContext, r: IssueRow) {
    const d = await this.s.decisionRow(r.projectId, r.decisionId);
    return {
      id: r.id,
      code: r.code,
      partnerId: r.partnerId,
      agreementId: r.agreementId,
      issue: r.issue,
      positions: r.positions,
      alternatives: r.alternatives,
      requiredApproval: r.requiredApproval,
      requiresApproval: r.requiresApproval,
      decisionId: r.decisionId,
      decision: this.s.decisionSummary(ctx, r.projectId, d, null, `the approval of negotiation issue ${r.code}`),
      documentId: r.documentId,
      documentRef: r.documentRef,
      resolution: r.resolution,
      status: r.status,
      allowedCommands: allowedCommands(NEGOTIATION_ISSUE_MACHINE, r.status),
      classification: r.classification,
      isDemo: r.isDemo,
      updatedAt: r.updatedAt.toISOString(),
      version: r.version,
    };
  }

  private async issueRefs(ctx: RequestContext, projectId: string, refs: { partnerId?: string | null; agreementId?: string | null; decisionId?: string | null; documentId?: string | null }) {
    await this.partnerRef(ctx, projectId, refs.partnerId);
    if (refs.agreementId) {
      const a = await loadInProject(this.s.db, schema.agreement, projectId, refs.agreementId);
      if (!this.s.policy.canSee(ctx, { projectId, classification: a.classification as Classification })) throw notFound();
    }
    if (refs.decisionId) {
      const d = await this.s.decision(ctx, projectId, refs.decisionId);
      if (d.status === 'rejected' || d.status === 'superseded') throw ruleViolation('jv.negotiation.decision_not_linkable', `A ${d.status} decision cannot approve an issue`);
    }
    if (refs.documentId) await this.s.visibleDocument(ctx, projectId, refs.documentId);
  }

  async listIssues(ctx: RequestContext, projectId: string, q: Q<'listNegotiationIssues'>['query']) {
    await this.s.project(projectId);
    this.s.assertListable(ctx, projectId, 'jv.deal.read');
    const t = schema.negotiationIssue;
    const where = and(
      eq(t.projectId, projectId),
      this.s.policy.visibilitySql(ctx, projectId, { classification: t.classification }),
      q.status ? eq(t.status, q.status) : undefined,
      q.partnerId ? eq(t.partnerId, q.partnerId) : undefined,
      q.q ? or(ilike(t.issue, likeContains(q.q)), ilike(t.code, likeContains(q.q))) : undefined,
    );
    const tx = this.s.db.tx();
    const [{ total }] = (await tx.select({ total: count() }).from(t).where(where)) as [{ total: number }];
    const order = orderBySort(q.sort, { code: t.code, status: t.status, updatedAt: t.updatedAt }, t.id, [asc(t.code), asc(t.id)]);
    const rows = await tx.select().from(t).where(where).orderBy(...order).limit(q.pageSize).offset(offsetOf(q));
    const items = [];
    for (const r of rows) items.push(await this.issueDto(ctx, r));
    return pageOf(items, Number(total), q);
  }

  async createIssue(ctx: RequestContext, projectId: string, body: Q<'createNegotiationIssue'>['body']) {
    const project = await this.s.project(projectId);
    this.s.assertListable(ctx, projectId, 'jv.negotiation.manage');
    this.s.assertClassification(ctx, body.classification);
    this.s.policy.assert(ctx, 'jv.negotiation.manage', { projectId, classification: body.classification });
    assertNegotiationIssueLinks({ requiresApproval: body.requiresApproval, decisionId: body.decisionId });
    await this.issueRefs(ctx, projectId, body);
    const code = await this.s.nextCode('negotiation_issue', 'code', projectId, 'NEG');
    const id = newId();
    await this.s.db
      .tx()
      .insert(schema.negotiationIssue)
      .values({
        id,
        orgId: ctx.principal.orgId,
        projectId,
        code,
        partnerId: body.partnerId ?? null,
        agreementId: body.agreementId ?? null,
        issue: body.issue,
        positions: body.positions,
        alternatives: body.alternatives ?? null,
        requiredApproval: body.requiredApproval ?? null,
        requiresApproval: body.requiresApproval,
        decisionId: body.decisionId ?? null,
        documentId: body.documentId ?? null,
        documentRef: body.documentRef ?? null,
        classification: body.classification,
        isDemo: project.isDemo,
        createdBy: ctx.principal.userId,
      });
    await this.s.audit.record({ action: 'jv.negotiation.create', entityType: 'negotiation_issue', entityId: id, projectId, after: { code, requiresApproval: body.requiresApproval, decisionId: body.decisionId ?? null } });
    return { id, code, version: 1 };
  }

  async updateIssue(ctx: RequestContext, projectId: string, id: string, body: Q<'updateNegotiationIssue'>['body']) {
    const r = await this.loadIssue(ctx, projectId, id, 'jv.negotiation.manage');
    const requiresApproval = body.requiresApproval ?? r.requiresApproval;
    const decisionId = body.decisionId === undefined ? r.decisionId : body.decisionId;
    assertNegotiationIssueLinks({ requiresApproval, decisionId });
    await this.issueRefs(ctx, projectId, { decisionId: body.decisionId, documentId: body.documentId });
    if ((r.status === 'agreed' || r.status === 'closed') && (body.requiresApproval !== undefined || body.decisionId !== undefined)) {
      throw ruleViolation('jv.negotiation.agreed_frozen', 'The approval link of an agreed issue cannot change — reopen it first');
    }
    const values: Record<string, unknown> = {};
    for (const k of ['issue', 'positions', 'alternatives', 'requiredApproval', 'requiresApproval', 'decisionId', 'documentId', 'documentRef', 'resolution'] as const) if (body[k] !== undefined) values[k] = body[k];
    const row = await updateVersioned(this.s.db, schema.negotiationIssue, { id, projectId, expectedVersion: body.expectedVersion }, values);
    await this.s.audit.record({ action: 'jv.negotiation.update', entityType: 'negotiation_issue', entityId: id, projectId, before: Object.fromEntries(Object.keys(values).map((k) => [k, (r as Record<string, unknown>)[k]])), after: values });
    return { id, version: row['version'] as number };
  }

  async transitionIssue(ctx: RequestContext, projectId: string, id: string, body: Q<'transitionNegotiationIssue'>['body']) {
    const r = await this.loadIssue(ctx, projectId, id, 'jv.negotiation.manage');
    const cmd = body.command as NegotiationCommand;
    if (cmd === 'agree' || cmd === 'close') {
      assertNegotiationAgreementAllowed({ requiresApproval: r.requiresApproval, decision: this.s.decisionState(await this.s.decisionRow(projectId, r.decisionId)) });
    }
    const to = transition('negotiation_issue', NEGOTIATION_ISSUE_MACHINE, r.status, cmd);
    const row = (await updateVersioned(this.s.db, schema.negotiationIssue, { id, projectId, expectedVersion: body.expectedVersion }, { status: to })) as IssueRow;
    await this.s.audit.record({ action: `jv.negotiation.${cmd}`, entityType: 'negotiation_issue', entityId: id, projectId, before: { status: r.status }, after: { status: to, decisionId: r.decisionId }, reason: body.note ?? null });
    return { id, status: row.status, version: row.version };
  }
}
