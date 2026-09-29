import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, inArray, or, sql, SQL } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  RAID_MACHINE,
  RaidStatus,
  RaidCommand,
  MAX_ESCALATION_LEVEL,
  OPEN_RAID_STATUSES,
  allowedCommands,
  transition,
  ruleViolation,
  invalid,
  isOverdue,
  isBlockingIssue,
  riskScore,
  riskRating,
} from '@hub/domain';
import type { z } from 'zod';
import type {
  RaidListQuery,
  CreateRiskBody,
  UpdateRiskBody,
  CreateIssueBody,
  UpdateIssueBody,
  CreateAssumptionBody,
  UpdateAssumptionBody,
  CreateRaidDependencyBody,
  UpdateRaidDependencyBody,
  RaiseIssueBody,
} from '@hub/contracts';
import { AuditService } from '../../platform/audit.service';
import { RecordVersionService, updateVersioned, loadInProject, nextCode, pageOf, offsetOf } from '../../platform/helpers';
import type { RequestContext } from '../../platform/context';
import { newId } from '../../platform/ids';
import { PlanningSupport, ProjectInfo } from './planning-support';

export type RaidKindPath = 'risks' | 'issues' | 'assumptions' | 'dependencies';
type RaidKind = 'risk' | 'issue' | 'assumption' | 'dependency';

const KINDS: Record<RaidKindPath, { kind: RaidKind; table: typeof schema.risk | typeof schema.issue | typeof schema.assumption | typeof schema.raidDependency; prefix: string; entityType: string }> = {
  risks: { kind: 'risk', table: schema.risk, prefix: 'RSK', entityType: 'risk' },
  issues: { kind: 'issue', table: schema.issue, prefix: 'ISS', entityType: 'issue' },
  assumptions: { kind: 'assumption', table: schema.assumption, prefix: 'ASM', entityType: 'assumption' },
  dependencies: { kind: 'dependency', table: schema.raidDependency, prefix: 'DEP', entityType: 'raid_dependency' },
};

type AnyRaidRow = typeof schema.risk.$inferSelect & Partial<typeof schema.issue.$inferSelect> & Partial<typeof schema.assumption.$inferSelect> & Partial<typeof schema.raidDependency.$inferSelect>;

/** RAID register (spec §9, REQ-PLN-012): risks, issues, assumptions and dependencies with lifecycle commands. */
@Injectable()
export class RaidService {
  constructor(
    private readonly s: PlanningSupport,
    private readonly audit: AuditService,
    private readonly versions: RecordVersionService,
  ) {}

  private get tx() {
    return this.s.db.tx();
  }

  private allowed(kind: RaidKind, status: RaidStatus) {
    return allowedCommands(RAID_MACHINE, status).filter((c) => !(c === 'mitigate' && kind !== 'risk') && !(c === 'monitor' && kind === 'issue'));
  }

  private async dtos(p: ProjectInfo, kind: RaidKind, rows: AnyRaidRow[]) {
    const ws = await this.s.workstreamCodes(p.id);
    const names = await this.s.userNames(rows.map((r) => r.ownerUserId));
    const today = this.s.today(p);
    return rows.map((r) => {
      const status = r.status as RaidStatus;
      const score = kind === 'risk' ? riskScore(r.probability, r.impact) : null;
      return {
        kind,
        id: r.id,
        workstreamId: r.workstreamId,
        workstreamCode: r.workstreamId ? (ws.get(r.workstreamId)?.code ?? null) : null,
        code: r.code,
        title: r.title,
        description: r.description,
        ownerUserId: r.ownerUserId,
        ownerName: r.ownerUserId ? (names.get(r.ownerUserId) ?? null) : null,
        status,
        escalationLevel: r.escalationLevel,
        dueDate: r.dueDate,
        gateKey: r.gateKey,
        overdue: isOverdue(kind === 'dependency' ? (r.neededBy ?? r.dueDate) : r.dueDate, today, OPEN_RAID_STATUSES.includes(status)),
        isDemo: r.isDemo,
        version: r.version,
        createdAt: r.createdAt.toISOString(),
        allowedCommands: this.allowed(kind, status),
        probability: kind === 'risk' ? r.probability : null,
        impact: kind === 'risk' ? r.impact : null,
        score,
        rating: score !== null ? riskRating(score) : null,
        trigger: kind === 'risk' ? r.trigger : null,
        response: kind === 'risk' ? r.response : null,
        responseStrategy: kind === 'risk' ? r.responseStrategy : null,
        exposure: kind === 'risk' ? exposureOf(r as unknown as Record<string, unknown>) : null,
        severity: kind === 'issue' ? (r.severity ?? null) : null,
        resolution: kind === 'issue' ? (r.resolution ?? null) : null,
        raisedFromRiskId: kind === 'issue' ? (r.raisedFromRiskId ?? null) : null,
        blocking: kind === 'issue' ? isBlockingIssue({ status, severity: r.severity ?? 0 }) : null,
        basis: kind === 'assumption' ? (r.basis ?? null) : null,
        validationPlan: kind === 'assumption' ? (r.validationPlan ?? null) : null,
        verificationStatus: kind === 'assumption' ? ((r.verificationStatus as string | undefined) ?? null) : null,
        dependsOn: kind === 'dependency' ? (r.dependsOn ?? null) : null,
        neededBy: kind === 'dependency' ? (r.neededBy ?? null) : null,
      };
    });
  }

  async list(ctx: RequestContext, projectId: string, kindPath: RaidKindPath, q: z.infer<typeof RaidListQuery>) {
    const p = await this.s.project(ctx, projectId);
    const k = KINDS[kindPath];
    const T = k.table as typeof schema.risk;
    const today = this.s.today(p);
    const conds: SQL[] = [eq(T.projectId, projectId), this.s.scopeSql(ctx, p, T.workstreamId)];
    if (q.status) conds.push(inArray(T.status, q.status));
    if (q.workstreamId) conds.push(eq(T.workstreamId, q.workstreamId));
    if (q.ownerUserId) conds.push(eq(T.ownerUserId, q.ownerUserId === 'me' ? (ctx.principal.userId ?? '00000000-0000-0000-0000-000000000000') : q.ownerUserId));
    if (q.gateKey) conds.push(eq(T.gateKey, q.gateKey));
    if (q.q) conds.push(or(ilike(T.title, `%${q.q}%`), ilike(T.code, `%${q.q}%`))!);
    const dueCol = k.kind === 'dependency' ? sql`coalesce(${(schema.raidDependency as typeof schema.raidDependency).neededBy}, ${T.dueDate})` : sql`${T.dueDate}`;
    const od = sql`(${T.status} in ('open','monitoring','escalated') and ${dueCol} < ${today})`;
    if (q.overdue === 'true') conds.push(od);
    if (q.overdue === 'false') conds.push(sql`not coalesce(${od}, false)`);
    if (q.minScore) {
      if (k.kind !== 'risk') throw invalid('raid.min_score_risks_only', 'minScore applies to risks only');
      conds.push(sql`${schema.risk.probability} * ${schema.risk.impact} >= ${q.minScore}`);
    }
    const where = and(...conds);
    const order =
      q.sort === '-score' && k.kind === 'risk'
        ? [sql`${schema.risk.probability} * ${schema.risk.impact} desc`, asc(T.code)]
        : q.sort === 'dueDate'
          ? [sql`${T.dueDate} asc nulls last`, asc(T.code)]
          : q.sort === '-updatedAt'
            ? [desc(T.updatedAt)]
            : [asc(T.code)];
    const [{ n }] = (await this.tx.select({ n: count() }).from(T).where(where)) as [{ n: number }];
    const rows = (await this.tx.select().from(T).where(where).orderBy(...order).limit(q.pageSize).offset(offsetOf(q))) as unknown as AnyRaidRow[];
    return pageOf(await this.dtos(p, k.kind, rows), Number(n), q);
  }

  async get(ctx: RequestContext, projectId: string, kindPath: RaidKindPath, id: string) {
    const p = await this.s.project(ctx, projectId);
    const k = KINDS[kindPath];
    const r = (await loadInProject(this.s.db, k.table as typeof schema.risk, projectId, id)) as unknown as AnyRaidRow;
    this.s.assertReadable(ctx, p, r.workstreamId);
    return (await this.dtos(p, k.kind, [r]))[0]!;
  }

  private async prepareCreate(ctx: RequestContext, projectId: string, body: { workstreamId?: string; ownerUserId?: string }) {
    const p = await this.s.project(ctx, projectId);
    if (body.workstreamId) await loadInProject(this.s.db, schema.workstream, projectId, body.workstreamId);
    this.s.assert(ctx, 'planning.raid.manage', p, { workstreamId: body.workstreamId ?? null });
    if (body.ownerUserId) await this.s.assertMember(projectId, body.ownerUserId);
    return p;
  }

  private common(ctx: RequestContext, p: ProjectInfo, body: { workstreamId?: string; title: string; description?: string; ownerUserId?: string; dueDate?: string; gateKey?: string }, code: string) {
    return {
      id: newId(),
      orgId: ctx.principal.orgId,
      projectId: p.id,
      workstreamId: body.workstreamId ?? null,
      code,
      title: body.title,
      description: body.description ?? null,
      ownerUserId: body.ownerUserId ?? null,
      dueDate: body.dueDate ?? null,
      gateKey: body.gateKey ?? null,
      isDemo: p.isDemo,
      createdBy: ctx.principal.userId,
    };
  }

  async createRisk(ctx: RequestContext, projectId: string, body: z.infer<typeof CreateRiskBody>) {
    const p = await this.prepareCreate(ctx, projectId, body);
    const code = await nextCode(this.s.db, schema.risk, projectId, 'RSK');
    const v = {
      ...this.common(ctx, p, body, code),
      probability: body.probability,
      impact: body.impact,
      trigger: body.trigger ?? null,
      response: body.response ?? null,
      responseStrategy: body.responseStrategy ?? null,
      exposureAmount: body.exposure?.amount ?? null,
      exposureCurrency: body.exposure?.currency ?? null,
      exposureUnitScale: body.exposure?.unitScale ?? null,
    };
    await this.tx.insert(schema.risk).values(v);
    await this.audit.record({ action: 'planning.raid.create', entityType: 'risk', entityId: v.id, projectId, after: { code, title: body.title, probability: body.probability, impact: body.impact, score: riskScore(body.probability, body.impact) } });
    return { id: v.id, code, version: 1 };
  }

  async createIssue(ctx: RequestContext, projectId: string, body: z.infer<typeof CreateIssueBody>) {
    const p = await this.prepareCreate(ctx, projectId, body);
    const code = await nextCode(this.s.db, schema.issue, projectId, 'ISS');
    const v = { ...this.common(ctx, p, body, code), severity: body.severity, resolution: body.resolution ?? null };
    await this.tx.insert(schema.issue).values(v);
    await this.audit.record({ action: 'planning.raid.create', entityType: 'issue', entityId: v.id, projectId, after: { code, title: body.title, severity: body.severity } });
    return { id: v.id, code, version: 1 };
  }

  async createAssumption(ctx: RequestContext, projectId: string, body: z.infer<typeof CreateAssumptionBody>) {
    const p = await this.prepareCreate(ctx, projectId, body);
    const code = await nextCode(this.s.db, schema.assumption, projectId, 'ASM');
    const v = { ...this.common(ctx, p, body, code), basis: body.basis ?? null, validationPlan: body.validationPlan ?? null, verificationStatus: 'assumed' as const };
    await this.tx.insert(schema.assumption).values(v);
    await this.audit.record({ action: 'planning.raid.create', entityType: 'assumption', entityId: v.id, projectId, after: { code, title: body.title } });
    return { id: v.id, code, version: 1 };
  }

  async createDependency(ctx: RequestContext, projectId: string, body: z.infer<typeof CreateRaidDependencyBody>) {
    const p = await this.prepareCreate(ctx, projectId, body);
    const code = await nextCode(this.s.db, schema.raidDependency, projectId, 'DEP');
    const v = { ...this.common(ctx, p, body, code), dependsOn: body.dependsOn, neededBy: body.neededBy ?? null };
    await this.tx.insert(schema.raidDependency).values(v);
    await this.audit.record({ action: 'planning.raid.create', entityType: 'raid_dependency', entityId: v.id, projectId, after: { code, title: body.title, dependsOn: body.dependsOn } });
    return { id: v.id, code, version: 1 };
  }

  private async prepareUpdate(ctx: RequestContext, projectId: string, kindPath: RaidKindPath, id: string, expectedVersion: number) {
    const p = await this.s.project(ctx, projectId);
    const k = KINDS[kindPath];
    const r = (await loadInProject(this.s.db, k.table as typeof schema.risk, projectId, id)) as unknown as AnyRaidRow;
    this.s.assert(ctx, 'planning.raid.manage', p, { workstreamId: r.workstreamId });
    this.s.assertVersion(r, expectedVersion, k.kind);
    if (['closed', 'cancelled'].includes(r.status)) throw ruleViolation('raid.not_editable', `A ${r.status} item cannot be edited — reopen it first`);
    return { p, k, r };
  }

  private commonChanges(body: { title?: string; description?: string | null; dueDate?: string | null; gateKey?: string | null }) {
    const c: Record<string, unknown> = {};
    if (body.title !== undefined) c['title'] = body.title;
    if (body.description !== undefined) c['description'] = body.description;
    if (body.dueDate !== undefined) c['dueDate'] = body.dueDate;
    if (body.gateKey !== undefined) c['gateKey'] = body.gateKey;
    return c;
  }

  private async finishUpdate(projectId: string, k: (typeof KINDS)[RaidKindPath], r: AnyRaidRow, expectedVersion: number, c: Record<string, unknown>) {
    if (Object.keys(c).length === 0) throw invalid('planning.no_changes', 'No changes supplied');
    const row = await updateVersioned(this.s.db, k.table as typeof schema.risk, { id: r.id, projectId, expectedVersion }, c);
    await this.audit.record({ action: 'planning.raid.update', entityType: k.entityType, entityId: r.id, projectId, before: Object.fromEntries(Object.keys(c).map((key) => [key, (r as unknown as Record<string, unknown>)[key]])), after: c });
    await this.versions.snapshot({ projectId, entityType: k.entityType, entityId: r.id, versionNo: row['version'] as number, snapshot: row, reason: 'updated' });
    return { id: r.id, version: row['version'] as number };
  }

  async updateRisk(ctx: RequestContext, projectId: string, id: string, body: z.infer<typeof UpdateRiskBody>) {
    const { k, r } = await this.prepareUpdate(ctx, projectId, 'risks', id, body.expectedVersion);
    const c = this.commonChanges(body);
    if (body.probability !== undefined) c['probability'] = body.probability;
    if (body.impact !== undefined) c['impact'] = body.impact;
    if (body.trigger !== undefined) c['trigger'] = body.trigger;
    if (body.response !== undefined) c['response'] = body.response;
    if (body.responseStrategy !== undefined) c['responseStrategy'] = body.responseStrategy;
    if (body.exposure !== undefined) {
      c['exposureAmount'] = body.exposure?.amount ?? null;
      c['exposureCurrency'] = body.exposure?.currency ?? null;
      c['exposureUnitScale'] = body.exposure?.unitScale ?? null;
    }
    return this.finishUpdate(projectId, k, r, body.expectedVersion, c);
  }

  async updateIssue(ctx: RequestContext, projectId: string, id: string, body: z.infer<typeof UpdateIssueBody>) {
    const { k, r } = await this.prepareUpdate(ctx, projectId, 'issues', id, body.expectedVersion);
    const c = this.commonChanges(body);
    if (body.severity !== undefined) c['severity'] = body.severity;
    if (body.resolution !== undefined) c['resolution'] = body.resolution;
    return this.finishUpdate(projectId, k, r, body.expectedVersion, c);
  }

  async updateAssumption(ctx: RequestContext, projectId: string, id: string, body: z.infer<typeof UpdateAssumptionBody>) {
    const { k, r } = await this.prepareUpdate(ctx, projectId, 'assumptions', id, body.expectedVersion);
    const c = this.commonChanges(body);
    if (body.basis !== undefined) c['basis'] = body.basis;
    if (body.validationPlan !== undefined) c['validationPlan'] = body.validationPlan;
    if (body.verificationStatus !== undefined) c['verificationStatus'] = body.verificationStatus;
    return this.finishUpdate(projectId, k, r, body.expectedVersion, c);
  }

  async updateDependency(ctx: RequestContext, projectId: string, id: string, body: z.infer<typeof UpdateRaidDependencyBody>) {
    const { k, r } = await this.prepareUpdate(ctx, projectId, 'dependencies', id, body.expectedVersion);
    const c = this.commonChanges(body);
    if (body.dependsOn !== undefined) c['dependsOn'] = body.dependsOn;
    if (body.neededBy !== undefined) c['neededBy'] = body.neededBy;
    return this.finishUpdate(projectId, k, r, body.expectedVersion, c);
  }

  async command(ctx: RequestContext, projectId: string, kindPath: RaidKindPath, id: string, command: RaidCommand, body: { expectedVersion: number; note?: string; reason?: string; level?: number }) {
    const p = await this.s.project(ctx, projectId);
    const k = KINDS[kindPath];
    const r = (await this.s.lockInProject(k.table as typeof schema.risk, projectId, id)) as unknown as AnyRaidRow;
    this.s.assert(ctx, 'planning.raid.manage', p, { workstreamId: r.workstreamId });
    this.s.assertVersion(r, body.expectedVersion, k.kind);
    if (command === 'mitigate' && k.kind !== 'risk') throw ruleViolation('raid.mitigate_risks_only', 'Only risks are mitigated — close issues, assumptions and dependencies instead');
    if (command === 'monitor' && k.kind === 'issue') throw ruleViolation('raid.monitor_not_for_issues', 'Issues are live problems — escalate, resolve or close them');
    const to = transition('raid', RAID_MACHINE, r.status as RaidStatus, command);
    const extra: Record<string, unknown> = {};
    if (command === 'escalate') {
      const level = body.level ?? 0;
      if (level <= r.escalationLevel || level > MAX_ESCALATION_LEVEL) {
        throw ruleViolation('raid.escalation_level', `Escalation must raise the level (current ${r.escalationLevel}, max ${MAX_ESCALATION_LEVEL})`, { current: r.escalationLevel });
      }
      extra['escalationLevel'] = level;
    }
    const row = await updateVersioned(this.s.db, k.table as typeof schema.risk, { id, projectId, expectedVersion: body.expectedVersion }, { ...extra, status: to });
    await this.audit.record({ action: `planning.raid.${command}`, entityType: k.entityType, entityId: id, projectId, before: { status: r.status, escalationLevel: r.escalationLevel }, after: { status: to, ...extra }, reason: body.reason ?? body.note ?? null });
    return { id, status: to as string, version: row['version'] as number };
  }

  async assignOwner(ctx: RequestContext, projectId: string, kindPath: RaidKindPath, id: string, body: { expectedVersion: number; userId: string; reason?: string }) {
    const p = await this.s.project(ctx, projectId);
    const k = KINDS[kindPath];
    const r = (await this.s.lockInProject(k.table as typeof schema.risk, projectId, id)) as unknown as AnyRaidRow;
    this.s.assert(ctx, r.ownerUserId ? 'planning.ownership.reassign' : 'planning.raid.manage', p, { workstreamId: r.workstreamId });
    this.s.assertVersion(r, body.expectedVersion, k.kind);
    if (r.ownerUserId === body.userId) throw ruleViolation('planning.owner_unchanged', 'This person is already the owner');
    await this.s.assertMember(projectId, body.userId);
    const row = await updateVersioned(this.s.db, k.table as typeof schema.risk, { id, projectId, expectedVersion: body.expectedVersion }, { ownerUserId: body.userId });
    await this.audit.record({ action: r.ownerUserId ? 'planning.ownership.reassign' : 'planning.ownership.assign', entityType: k.entityType, entityId: id, projectId, before: { owner: r.ownerUserId }, after: { owner: body.userId }, reason: body.reason ?? null });
    return { id, version: row['version'] as number };
  }

  /** A risk has materialised: raise a linked issue (the risk itself stays until closed/mitigated by its owner). */
  async raiseIssueFromRisk(ctx: RequestContext, projectId: string, riskId: string, body: z.infer<typeof RaiseIssueBody>) {
    const p = await this.s.project(ctx, projectId);
    const r = await this.s.lockInProject(schema.risk, projectId, riskId);
    this.s.assert(ctx, 'planning.raid.manage', p, { workstreamId: r.workstreamId });
    this.s.assertVersion(r, body.expectedVersion, 'risk');
    if (!OPEN_RAID_STATUSES.includes(r.status as RaidStatus)) throw ruleViolation('raid.risk_not_open', 'Only an open risk can be raised as an issue');
    const code = await nextCode(this.s.db, schema.issue, projectId, 'ISS');
    const v = {
      ...this.common(ctx, p, { workstreamId: r.workstreamId ?? undefined, title: body.title ?? `Materialised risk ${r.code}: ${r.title}`, description: body.description, ownerUserId: r.ownerUserId ?? undefined, dueDate: body.dueDate, gateKey: r.gateKey ?? undefined }, code),
      severity: body.severity,
      raisedFromRiskId: r.id,
    };
    await this.tx.insert(schema.issue).values(v);
    await this.audit.record({ action: 'planning.raid.raise_issue', entityType: 'issue', entityId: v.id, projectId, after: { code, fromRisk: r.code, severity: body.severity } });
    return { id: v.id, code, version: 1 };
  }

  /** Open blocking issues per workstream (used by health/RAG). */
  async openBlockingIssues(projectId: string) {
    return this.tx
      .select({ id: schema.issue.id, code: schema.issue.code, title: schema.issue.title, workstreamId: schema.issue.workstreamId, severity: schema.issue.severity, status: schema.issue.status })
      .from(schema.issue)
      .where(and(eq(schema.issue.projectId, projectId), inArray(schema.issue.status, [...OPEN_RAID_STATUSES]), sql`${schema.issue.severity} >= 4`));
  }
}

/** Money exposure (numeric string + currency + unit scale) when all three parts are recorded. */
function exposureOf(r: Record<string, unknown>): { amount: string; currency: string; unitScale: 1 | 1000 | 1000000 } | null {
  const amount = r['exposureAmount'];
  const currency = r['exposureCurrency'];
  const unitScale = r['exposureUnitScale'];
  if (amount === null || amount === undefined || !currency || !unitScale) return null;
  return { amount: String(amount).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''), currency: String(currency), unitScale: Number(unitScale) as 1 | 1000 | 1000000 };
}
